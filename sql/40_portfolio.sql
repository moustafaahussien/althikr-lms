-- =====================================================================
-- 40: وحدة «ملف إنجاز الطالب» — مشاريع ومسابقات وجوائز وشهادات وتطوع
--   الطالب يضيف إنجازه (بانتظار اعتماد معلم)، والمعلم/الإدارة يضيف ويعتمد مباشرة
--   الرؤية: الطالب نفسه، وولي أمره (المعتمد فقط)، ومنسوبو المدرسة الذين يرون الطالب
--   (public.can_view_student / private.att_can)
-- =====================================================================
create table if not exists public.pf_items (
  id           bigserial primary key,
  student_id   uuid not null references public.students(profile_id) on delete cascade,
  kind         text not null check (kind in ('project','competition','award','certificate','volunteer','reading','talent','other')),
  title        text not null,
  description  text,
  item_date    date not null default current_date,
  level        text check (level in ('class','school','district','national','international')),
  result       text,                                     -- مثال: المركز الأول، ميدالية فضية، مشاركة
  links        jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending','approved','rejected')),
  added_by     uuid references public.profiles(id) on delete set null,
  reviewed_by  uuid references public.profiles(id) on delete set null,
  reviewed_at  timestamptz,
  review_note  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists pf_items_student_idx on public.pf_items (student_id, item_date desc);
create index if not exists pf_items_status_idx on public.pf_items (status, created_at desc);
alter table public.pf_items enable row level security;
revoke all on public.pf_items from anon, authenticated;

-- منسوب يرى هذا الطالب (ويحق له الإضافة والاعتماد)
create or replace function private.pf_staff_can(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (select 1 from students s where s.profile_id = p_student
           and (public.can_view_student(p_student) or private.att_can(s.grade_id, s.class_id)))
$$;

create or replace function private.pf_card(i public.pf_items) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', i.id, 'student_id', i.student_id, 'kind', i.kind, 'title', i.title, 'description', i.description, 'date', i.item_date,
    'level', i.level, 'result', i.result, 'links', i.links, 'status', i.status, 'review_note', i.review_note, 'created_at', i.created_at,
    'added_by', (select full_name from profiles where id = i.added_by), 'self_added', i.added_by = i.student_id,
    'reviewed_by', (select full_name from profiles where id = i.reviewed_by))
$$;

-- ملف طالب (افتراضيًا: ملفي)
create or replace function public.pf_get(p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); sid uuid := coalesce(p_student, me); r text := public.me_role(); staff boolean; parent boolean; s students;
begin
  select * into s from students where profile_id = sid;
  if s.profile_id is null then raise exception 'الطالب غير موجود'; end if;
  staff := private.pf_staff_can(sid);
  parent := r = 'parent' and exists (select 1 from parent_links where parent_id = me and student_id = sid);
  if not (sid = me or staff or parent) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('student', jsonb_build_object('id', sid, 'name', (select full_name from profiles where id = sid),
      'class', (select label from v_classes where id = s.class_id),
      'grade', (select g.name_ar || ' ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id)),
    'can_add', sid = me or staff, 'can_review', staff, 'is_self', sid = me,
    'items', coalesce((select jsonb_agg(private.pf_card(i) order by i.item_date desc, i.id desc) from pf_items i
                        where i.student_id = sid and (sid = me or staff or i.status = 'approved')), '[]'::jsonb),
    -- النتائج الأكاديمية: الاختبارات الإلكترونية المسلّمة (إن سمح المعلم بإظهار النتيجة) والواجبات المصحّحة
    'exams', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'subject', (select name_ar from subjects where id = e.subject_id),
                  'date', (e.opens_at at time zone 'Asia/Riyadh')::date, 'score', a.score, 'max', a.max_score, 'review', a.needs_review) order by e.opens_at desc)
                from ex_attempts a join ex_exams e on e.id = a.exam_id
               where a.student_id = sid and a.submitted_at is not null and (staff or e.show_results)), '[]'::jsonb),
    'homework', coalesce((select jsonb_agg(jsonb_build_object('title', h.title, 'subject', (select name_ar from subjects where id = h.subject_id),
                  'date', (h.due_at at time zone 'Asia/Riyadh')::date, 'score', x.score, 'max', h.max_score, 'feedback', x.feedback) order by h.due_at desc)
                from hw_submissions x join hw_assignments h on h.id = x.hw_id
               where x.student_id = sid and x.status = 'graded' and x.score is not null), '[]'::jsonb));
end $$;

create or replace function public.pf_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); iid bigint := nullif(p->>'id','')::bigint; sid uuid := nullif(p->>'student_id','')::uuid;
        staff boolean; i pf_items; ttl text := btrim(coalesce(p->>'title','')); lk jsonb;
begin
  if iid is not null then select * into i from pf_items where id = iid; if not found then raise exception 'غير موجود'; end if; sid := i.student_id; end if;
  sid := coalesce(sid, me);
  staff := private.pf_staff_can(sid);
  if not (staff or sid = me) then raise exception 'غير مصرح'; end if;
  if sid = me and not exists (select 1 from students where profile_id = me) then raise exception 'غير مصرح'; end if;
  -- الطالب يعدّل ما أضافه هو فقط، وقبل الاعتماد
  if iid is not null and not staff and (i.added_by is distinct from me or i.status = 'approved') then raise exception 'لا يمكن تعديل إنجاز معتمد — تواصل مع معلمك'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الإنجاز'; end if;
  if coalesce(p->>'kind','') not in ('project','competition','award','certificate','volunteer','reading','talent','other') then raise exception 'اختر نوع الإنجاز'; end if;
  if nullif(p->>'level','') is not null and p->>'level' not in ('class','school','district','national','international') then raise exception 'مستوى غير صالح'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('url', left(btrim(l->>'url'), 500), 'title', left(btrim(coalesce(l->>'title','')), 120))), '[]'::jsonb) into lk
    from (select l from jsonb_array_elements(coalesce(p->'links','[]'::jsonb)) l where btrim(coalesce(l->>'url','')) ~* '^https?://' limit 10) z;
  if iid is null then
    insert into pf_items(student_id, kind, title, description, item_date, level, result, links, status, added_by, reviewed_by, reviewed_at)
    values (sid, p->>'kind', left(ttl, 200), nullif(left(btrim(coalesce(p->>'description','')), 4000), ''), coalesce(nullif(p->>'date','')::date, current_date),
            nullif(p->>'level',''), nullif(left(btrim(coalesce(p->>'result','')), 120), ''), lk,
            case when staff and sid <> me then 'approved' else 'pending' end, me, case when staff and sid <> me then me end, case when staff and sid <> me then now() end)
    returning id into iid;
  else
    update pf_items set kind = p->>'kind', title = left(ttl, 200), description = nullif(left(btrim(coalesce(p->>'description','')), 4000), ''),
           item_date = coalesce(nullif(p->>'date','')::date, item_date), level = nullif(p->>'level',''), result = nullif(left(btrim(coalesce(p->>'result','')), 120), ''),
           links = lk, updated_at = now(),
           status = case when staff and sid <> me then status else 'pending' end   -- تعديل الطالب يعيده للمراجعة
     where id = iid;
  end if;
  return jsonb_build_object('ok', true, 'id', iid);
end $$;

create or replace function public.pf_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pf_items; me uuid := public.me_id();
begin
  select * into i from pf_items where id = p_id;
  if not found then raise exception 'غير موجود'; end if;
  if not (private.pf_staff_can(i.student_id) or (i.student_id = me and i.added_by = me and i.status <> 'approved')) then raise exception 'غير مصرح'; end if;
  delete from pf_items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pf_review(p_id bigint, p_action text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare i pf_items;
begin
  select * into i from pf_items where id = p_id;
  if not found or not private.pf_staff_can(i.student_id) or i.student_id = public.me_id() then raise exception 'غير مصرح'; end if;
  if p_action not in ('approve','reject') then raise exception 'إجراء غير صالح'; end if;
  if p_action = 'reject' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب سبب عدم الاعتماد للطالب'; end if;
  update pf_items set status = case when p_action = 'approve' then 'approved' else 'rejected' end, reviewed_by = public.me_id(), reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note,'')), 500), '') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- سجل الإنجازات للمنسوبين (بانتظار الاعتماد / الأحدث) ضمن الطلاب المرئيين
create or replace function public.pf_feed(p_status text default null, p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.pf_card(i) || jsonb_build_object('student', p.full_name, 'class', vc.label) order by i.created_at desc)
    from (select * from pf_items i where (p_status is null or i.status = p_status) and (p_kind is null or i.kind = p_kind)
           order by i.created_at desc limit 600) i
    join profiles p on p.id = i.student_id join students s on s.profile_id = i.student_id left join v_classes vc on vc.id = s.class_id
   where private.pf_staff_can(i.student_id)), '[]'::jsonb);
end $$;

-- بحث المنسوب عن طالب بالاسم أو الرقم لفتح ملفه
create or replace function public.pf_find(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := public.norm(btrim(coalesce(p_q,'')));
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'class', coalesce(vc.label, (select g.name_ar from grades g where g.id = s.grade_id)),
             'n', (select count(*) from pf_items i where i.student_id = p.id and i.status = 'approved')) x
      from students s join profiles p on p.id = s.profile_id left join v_classes vc on vc.id = s.class_id
     where p.active and (public.norm(p.full_name) like '%' || q || '%' or s.student_number = btrim(p_q) or exists (select 1 from student_private sp where sp.profile_id = s.profile_id and sp.national_id = btrim(p_q)))
       and private.pf_staff_can(p.id)
     order by p.full_name limit 30) z), '[]'::jsonb);
end $$;

revoke all on function private.pf_staff_can(uuid), private.pf_card(public.pf_items) from public, anon, authenticated;
revoke all on function public.pf_get(uuid), public.pf_save(jsonb), public.pf_delete(bigint), public.pf_review(bigint, text, text), public.pf_feed(text, text), public.pf_find(text) from public, anon;
grant execute on function public.pf_get(uuid), public.pf_save(jsonb), public.pf_delete(bigint), public.pf_review(bigint, text, text), public.pf_feed(text, text), public.pf_find(text) to authenticated;
