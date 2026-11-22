-- =====================================================================
-- 34: وحدة «الواجبات» — إنشاء الواجب، تسليم الطالب، التصحيح والتغذية الراجعة
--   المعلم: ينشئ واجبًا لفصل أو أكثر من فصوله (موعد تسليم + درجة عظمى + روابط مرفقة)
--   الطالب: يرى واجبات فصله، يسلّم نصًا و/أو روابط، ويعيد التسليم ما لم يُصحَّح
--   المعلم يصحّح (درجة + ملاحظة) أو يعيد التسليم للطالب لتعديله
--   المتابعة: المشرف/مدير المرحلة/الإدارة يرون إحصاءات واجبات معلميهم (قراءة فقط)
--   الوصول للجداول عبر الدوال فقط
-- =====================================================================

create table if not exists public.hw_assignments (
  id            bigserial primary key,
  teacher_id    uuid not null references public.profiles(id) on delete cascade,
  subject_id    int references public.subjects(id) on delete set null,
  class_ids     int[] not null default '{}',
  title         text not null,
  instructions  text,
  links         jsonb not null default '[]'::jsonb,
  due_at        timestamptz not null,
  max_score     numeric(6,2) not null default 10 check (max_score > 0 and max_score <= 1000),
  allow_late    boolean not null default true,
  closed        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists hw_assignments_teacher_idx on public.hw_assignments (teacher_id, due_at desc);
create index if not exists hw_assignments_classes_idx on public.hw_assignments using gin (class_ids);

create table if not exists public.hw_submissions (
  id            bigserial primary key,
  hw_id         bigint not null references public.hw_assignments(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  body          text,
  links         jsonb not null default '[]'::jsonb,
  submitted_at  timestamptz not null default now(),
  late          boolean not null default false,
  status        text not null default 'submitted' check (status in ('submitted','graded','returned')),
  score         numeric(6,2),
  feedback      text,
  graded_by     uuid references public.profiles(id) on delete set null,
  graded_at     timestamptz,
  unique (hw_id, student_id)
);
create index if not exists hw_submissions_student_idx on public.hw_submissions (student_id);

alter table public.hw_assignments enable row level security;
alter table public.hw_submissions enable row level security;
revoke all on public.hw_assignments, public.hw_submissions from anon, authenticated;

-- روابط آمنة فقط (http/https) وبحد أقصى 10
create or replace function private.hw_clean_links(p jsonb) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(jsonb_build_object('url', left(btrim(x->>'url'), 1000), 'title', left(coalesce(nullif(btrim(x->>'title'), ''), btrim(x->>'url')), 200))), '[]'::jsonb)
    from (select x from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) x limit 10) q
   where btrim(coalesce(x->>'url', '')) ~* '^https?://[^\s<>"]+$'
$$;

-- فصل الطالب الحالي
create or replace function private.my_class_id() returns int
language sql stable security definer set search_path = public as $$
  select class_id from students where profile_id = public.me_id()
$$;

create or replace function private.hw_card(h public.hw_assignments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', h.id, 'title', h.title, 'due_at', h.due_at, 'max_score', h.max_score, 'allow_late', h.allow_late, 'closed', h.closed,
    'subject', (select name_ar from subjects where id = h.subject_id), 'subject_id', h.subject_id, 'period', h.period,
    'teacher', (select full_name from profiles where id = h.teacher_id), 'teacher_id', h.teacher_id, 'created_at', h.created_at,
    'classes', coalesce((select jsonb_agg(vc.label order by vc.stage_sort, vc.grade_number, vc.name) from v_classes vc where vc.id = any (h.class_ids)), '[]'::jsonb))
$$;

create or replace function public.hw_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', public.me_role(),
    'subjects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name_ar))
                 from teaching_assignments ta join subjects s on s.id = ta.subject_id where ta.teacher_id = public.me_id()), '[]'::jsonb),
    'classes',  coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'label', vc.label, 'subjects', x.subs) order by vc.stage_sort, vc.grade_number, vc.name)
                 from (select class_id, jsonb_agg(distinct subject_id) subs from teaching_assignments where teacher_id = public.me_id() group by class_id) x
                 join v_classes vc on vc.id = x.class_id), '[]'::jsonb),
    'is_teacher', exists (select 1 from teaching_assignments where teacher_id = public.me_id()),
    'can_follow', public.me_role() in ('admin','leadership','principal','supervisor')
                  or exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id()))
$$;

-- mine = واجباتي (معلم) | student = واجبات فصلي (طالب) | all = متابعة معلميّ (مشرف/مدير)
create or replace function public.hw_list(p_box text default 'mine', p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); cid int;
begin
  if p_box = 'student' then
    cid := private.my_class_id();
    if cid is null then return '[]'::jsonb; end if;
    return coalesce((select jsonb_agg(private.hw_card(h) || jsonb_build_object(
              'my_status', s.status, 'my_score', s.score, 'my_late', s.late, 'submitted_at', s.submitted_at)
              order by h.due_at desc)
      from hw_assignments h left join hw_submissions s on s.hw_id = h.id and s.student_id = me
     where cid = any (h.class_ids) and (p_from is null or h.due_at >= p_from) and (p_to is null or h.due_at < p_to + 1)), '[]'::jsonb);
  end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.hw_card(h) || jsonb_build_object(
            'students', (select count(*) from students st where st.class_id = any (h.class_ids)),
            'submitted', (select count(*) from hw_submissions s where s.hw_id = h.id),
            'graded', (select count(*) from hw_submissions s where s.hw_id = h.id and s.status = 'graded'),
            'avg', (select round(avg(s.score / h.max_score * 100)) from hw_submissions s where s.hw_id = h.id and s.status = 'graded'))
            order by h.due_at desc)
    from (select * from hw_assignments h
           where (p_from is null or h.due_at >= p_from) and (p_to is null or h.due_at < p_to + 1)
             and case when p_box = 'mine' then h.teacher_id = me else private.lp_is_reviewer(h.teacher_id) end
           order by h.due_at desc limit 500) h), '[]'::jsonb);
end $$;

create or replace function public.hw_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare h hw_assignments; me uuid := public.me_id(); mine boolean; rev boolean; cid int;
begin
  select * into h from hw_assignments where id = p_id;
  if not found then raise exception 'الواجب غير موجود'; end if;
  mine := h.teacher_id = me;
  rev := private.lp_is_reviewer(h.teacher_id);
  cid := private.my_class_id();
  if mine or rev then
    return private.hw_card(h) || jsonb_build_object('instructions', h.instructions, 'links', h.links, 'class_ids', to_jsonb(h.class_ids),
      'mine', mine, 'can_edit', mine,
      'roster', coalesce((select jsonb_agg(jsonb_build_object('student', st.profile_id, 'name', p.full_name, 'class', vc.name, 'no', st.student_number,
                    'sub', case when s.id is null then null else jsonb_build_object('id', s.id, 'body', s.body, 'links', s.links, 'at', s.submitted_at, 'late', s.late,
                           'status', s.status, 'score', s.score, 'feedback', s.feedback) end)
                    order by vc.grade_number, vc.name, p.full_name)
                  from students st join profiles p on p.id = st.profile_id join v_classes vc on vc.id = st.class_id
                  left join hw_submissions s on s.hw_id = h.id and s.student_id = st.profile_id
                 where st.class_id = any (h.class_ids) and p.active), '[]'::jsonb));
  elsif cid is not null and cid = any (h.class_ids) then
    return private.hw_card(h) || jsonb_build_object('instructions', h.instructions, 'links', h.links, 'student_view', true,
      'can_submit', not h.closed and (h.allow_late or now() <= h.due_at)
                    and coalesce((select status from hw_submissions where hw_id = h.id and student_id = me), 'none') <> 'graded',
      'sub', (select jsonb_build_object('body', s.body, 'links', s.links, 'at', s.submitted_at, 'late', s.late, 'status', s.status, 'score', s.score, 'feedback', s.feedback)
                from hw_submissions s where s.hw_id = h.id and s.student_id = me));
  end if;
  raise exception 'غير مصرح';
end $$;

create or replace function public.hw_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); hid bigint := nullif(p->>'id','')::bigint; cls int[]; sid int := nullif(p->>'subject_id','')::int;
        ttl text := btrim(coalesce(p->>'title','')); due timestamptz := nullif(p->>'due_at','')::timestamptz;
        mx numeric := coalesce(nullif(p->>'max_score','')::numeric, 10); per text := nullif(p->>'period','');
begin
  if per is not null and per not in ('p1','p2','mid','final') then raise exception 'فترة غير صالحة'; end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الواجب'; end if;
  if due is null then raise exception 'حدّد موعد التسليم'; end if;
  if mx <= 0 or mx > 1000 then raise exception 'الدرجة العظمى غير صالحة'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c)) then
    raise exception 'اختر من فصولك المسندة إليك فقط'; end if;
  if sid is not null and not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.subject_id = sid) then
    raise exception 'اختر من موادك المسندة إليك فقط'; end if;
  if length(coalesce(p->>'instructions','')) > 20000 then raise exception 'نص الواجب طويل جدًا'; end if;
  if hid is null then
    insert into hw_assignments(teacher_id, subject_id, class_ids, title, instructions, links, due_at, max_score, allow_late, period)
    values (me, sid, cls, left(ttl, 200), nullif(btrim(coalesce(p->>'instructions','')), ''), private.hw_clean_links(p->'links'), due, mx,
            coalesce((p->>'allow_late')::boolean, true), per) returning id into hid;
  else
    update hw_assignments set subject_id = sid, class_ids = cls, title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''),
           links = private.hw_clean_links(p->'links'), due_at = due, max_score = mx, allow_late = coalesce((p->>'allow_late')::boolean, true), period = per, updated_at = now()
     where id = hid and teacher_id = me;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', hid);
end $$;

create or replace function public.hw_close(p_id bigint, p_closed boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update hw_assignments set closed = coalesce(p_closed, true), updated_at = now() where id = p_id and teacher_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.hw_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from hw_submissions where hw_id = p_id and status = 'graded') then
    raise exception 'لا يمكن حذف واجب فيه تسليمات مصحّحة — أغلقه بدلًا من ذلك'; end if;
  delete from hw_assignments where id = p_id and teacher_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- تسليم الطالب (أو تعديل تسليمه ما لم يُصحَّح)
create or replace function public.hw_submit(p_id bigint, p_body text, p_links jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h hw_assignments; me uuid := public.me_id(); cid int := private.my_class_id(); lk jsonb := private.hw_clean_links(p_links);
begin
  select * into h from hw_assignments where id = p_id;
  if not found or cid is null or not (cid = any (h.class_ids)) then raise exception 'غير مصرح'; end if;
  if h.closed then raise exception 'أُغلق هذا الواجب'; end if;
  if now() > h.due_at and not h.allow_late then raise exception 'انتهى موعد التسليم'; end if;
  if btrim(coalesce(p_body,'')) = '' and jsonb_array_length(lk) = 0 then raise exception 'اكتب إجابتك أو أضف رابطًا'; end if;
  if length(coalesce(p_body,'')) > 20000 then raise exception 'الإجابة طويلة جدًا'; end if;
  insert into hw_submissions(hw_id, student_id, body, links, late)
  values (p_id, me, nullif(btrim(p_body), ''), lk, now() > h.due_at)
  on conflict (hw_id, student_id) do update set body = excluded.body, links = excluded.links, submitted_at = now(), late = excluded.late,
     status = 'submitted', score = null, feedback = hw_submissions.feedback
   where hw_submissions.status <> 'graded';
  if not found then raise exception 'صُحّح تسليمك، لا يمكن تعديله'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- تصحيح المعلم: p_action = grade | return
create or replace function public.hw_grade(p_id bigint, p_student uuid, p_action text, p_score numeric default null, p_feedback text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h hw_assignments;
begin
  select * into h from hw_assignments where id = p_id;
  if not found or h.teacher_id <> public.me_id() then raise exception 'غير مصرح'; end if;
  if p_action = 'grade' then
    if p_score is null or p_score < 0 or p_score > h.max_score then raise exception 'الدرجة يجب أن تكون بين 0 و %', h.max_score; end if;
    -- يمكن رصد درجة لطالب لم يسلّم إلكترونيًا (سلّم ورقيًا مثلًا)
    if not exists (select 1 from students where profile_id = p_student and class_id = any (h.class_ids)) then raise exception 'الطالب ليس من فصول هذا الواجب'; end if;
    insert into hw_submissions(hw_id, student_id, status, score, feedback, graded_by, graded_at)
    values (p_id, p_student, 'graded', p_score, nullif(btrim(coalesce(p_feedback,'')), ''), public.me_id(), now())
    on conflict (hw_id, student_id) do update set status = 'graded', score = p_score, feedback = nullif(btrim(coalesce(p_feedback,'')), ''),
       graded_by = public.me_id(), graded_at = now();
  elsif p_action = 'return' then
    if btrim(coalesce(p_feedback,'')) = '' then raise exception 'اكتب ملاحظتك للطالب عند الإعادة'; end if;
    update hw_submissions set status = 'returned', score = null, feedback = btrim(p_feedback), graded_by = public.me_id(), graded_at = now()
     where hw_id = p_id and student_id = p_student;
    if not found then raise exception 'لا يوجد تسليم لإعادته'; end if;
  else raise exception 'إجراء غير صالح'; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.hw_clean_links(jsonb), private.my_class_id(), private.hw_card(public.hw_assignments) from public, anon, authenticated;
revoke all on function public.hw_options(), public.hw_list(text, date, date), public.hw_get(bigint), public.hw_save(jsonb), public.hw_close(bigint, boolean),
  public.hw_delete(bigint), public.hw_submit(bigint, text, jsonb), public.hw_grade(bigint, uuid, text, numeric, text) from public, anon;
grant execute on function public.hw_options(), public.hw_list(text, date, date), public.hw_get(bigint), public.hw_save(jsonb), public.hw_close(bigint, boolean),
  public.hw_delete(bigint), public.hw_submit(bigint, text, jsonb), public.hw_grade(bigint, uuid, text, numeric, text) to authenticated;
