-- ============================================================
-- 67) الشهادات الفصلية (كشف الدرجات)
-- تُحسب من سجل الدرجات نفسه (الواجبات + الاختبارات + الأعمدة اليدوية + سلالم التقدير)
-- خلال فترة محددة، مع ملخص الحضور والسلوك وملاحظة رائد الفصل،
-- وتُحفظ نسخة ثابتة (لا تتغير بعد الإصدار إلا بإعادة التوليد)، ثم تُنشر للطالب وولي الأمر.
-- ============================================================

create table if not exists public.rc_issues (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  term_id     integer references public.terms(id) on delete set null,
  from_date   date not null,
  to_date     date not null,
  stage_ids   integer[] not null default '{}',
  scale       jsonb not null default '[{"min":90,"label":"ممتاز"},{"min":80,"label":"جيد جدًا"},{"min":70,"label":"جيد"},{"min":60,"label":"مقبول"},{"min":0,"label":"يحتاج إلى دعم"}]',
  show_att    boolean not null default true,
  show_bh     boolean not null default true,
  published   boolean not null default false,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.rc_cards (
  issue_id    bigint not null references public.rc_issues(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  class_id    integer,
  data        jsonb not null,
  note        text,
  generated_at timestamptz not null default now(),
  primary key (issue_id, student_id)
);
create index if not exists rc_cards_class on public.rc_cards(issue_id, class_id);

alter table public.rc_issues enable row level security; alter table public.rc_cards enable row level security;
revoke all on public.rc_issues, public.rc_cards from anon, authenticated;

create or replace function private.rc_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership','principal') or coalesce(p.job_title,'') ~ '(وكيل|وكيلة|كنترول|شؤون الطلاب)'))
$$;

-- من يرى/يكتب ملاحظة فصل: المدير أو رائد الفصل
create or replace function private.rc_can_class(p_class int) returns boolean
language sql stable security definer set search_path = public, private as $$
  select private.rc_manager() or exists (select 1 from classes where id = p_class and homeroom_teacher_id = public.me_id())
$$;

create or replace function private.rc_label(p_scale jsonb, p numeric) returns text
language sql immutable as $$
  select case when p is null then null else
    (select s->>'label' from jsonb_array_elements(p_scale) s where p >= (s->>'min')::numeric order by (s->>'min')::numeric desc limit 1) end
$$;

-- ---------- الإصدارات ----------
create or replace function public.rc_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'from', i.from_date, 'to', i.to_date, 'published', i.published,
      'stage_ids', i.stage_ids, 'scale', i.scale, 'show_att', i.show_att, 'show_bh', i.show_bh,
      'stages', (select string_agg(name_ar, '، ' order by sort) from stages where id = any (i.stage_ids)),
      'cards', (select count(*) from rc_cards c where c.issue_id = i.id), 'manager', private.rc_manager()) order by i.created_at desc)
    from rc_issues i
   where private.rc_manager() or exists (select 1 from classes c join grades g on g.id = c.grade_id where c.homeroom_teacher_id = public.me_id() and g.stage_id = any (i.stage_ids))), '[]'::jsonb);
end $$;

create or replace function public.rc_issue_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare iid bigint := nullif(p->>'id', '')::bigint; st int[];
begin
  if not private.rc_manager() then raise exception 'غير مصرح'; end if;
  select array_agg(x::int) into st from jsonb_array_elements_text(coalesce(p->'stage_ids', '[]')) x;
  if coalesce(array_length(st, 1), 0) = 0 then raise exception 'اختر مرحلة واحدة على الأقل'; end if;
  if nullif(p->>'from', '') is null or nullif(p->>'to', '') is null or (p->>'from')::date > (p->>'to')::date then raise exception 'حدّد فترة صحيحة'; end if;
  if iid is null then
    insert into rc_issues(title, term_id, from_date, to_date, stage_ids, scale, show_att, show_bh, created_by)
    values (btrim(p->>'title'), (select id from terms where is_current), (p->>'from')::date, (p->>'to')::date, st,
            coalesce(case when jsonb_typeof(p->'scale') = 'array' and jsonb_array_length(p->'scale') > 0 then p->'scale' end, '[{"min":90,"label":"ممتاز"},{"min":80,"label":"جيد جدًا"},{"min":70,"label":"جيد"},{"min":60,"label":"مقبول"},{"min":0,"label":"يحتاج إلى دعم"}]'::jsonb),
            coalesce((p->>'show_att')::boolean, true), coalesce((p->>'show_bh')::boolean, true), public.me_id()) returning id into iid;
  else
    update rc_issues set title = btrim(p->>'title'), from_date = (p->>'from')::date, to_date = (p->>'to')::date, stage_ids = st,
           scale = coalesce(case when jsonb_typeof(p->'scale') = 'array' and jsonb_array_length(p->'scale') > 0 then p->'scale' end, scale), show_att = coalesce((p->>'show_att')::boolean, show_att), show_bh = coalesce((p->>'show_bh')::boolean, show_bh) where id = iid;
  end if;
  return iid;
end $$;

create or replace function public.rc_issue_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.rc_manager() then raise exception 'غير مصرح'; end if;
  delete from rc_issues where id = p_id;
end $$;

-- الفصول المشمولة (للمدير كلها، ولرائد الفصل فصله)
create or replace function public.rc_classes(p_issue bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare i rc_issues;
begin
  select * into i from rc_issues where id = p_issue;
  if i.id is null then raise exception 'غير موجود'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('class_id', vc.id, 'label', vc.label, 'n', vc.student_count,
      'cards', (select count(*) from rc_cards c where c.issue_id = p_issue and c.class_id = vc.id),
      'notes', (select count(*) from rc_cards c where c.issue_id = p_issue and c.class_id = vc.id and c.note is not null),
      'homeroom', (select full_name from profiles where id = vc.homeroom_teacher_id)) order by vc.stage_sort, vc.grade_number, vc.name)
    from v_classes vc where vc.active and vc.stage_id = any (i.stage_ids) and private.rc_can_class(vc.id)), '[]'::jsonb);
end $$;

-- توليد شهادات فصل واحد (يُستدعى لكل فصل من الواجهة مع شريط تقدم)
create or replace function public.rc_generate(p_issue bigint, p_class int) returns int
language plpgsql security definer set search_path = public, private as $$
declare i rc_issues; sb record; cols jsonb; st record; n int := 0; subs jsonb; pct numeric; avgp numeric; att jsonb; bh jsonb;
begin
  if not private.rc_manager() then raise exception 'غير مصرح'; end if;
  select * into i from rc_issues where id = p_issue;
  if not exists (select 1 from v_classes where id = p_class and stage_id = any (i.stage_ids)) then raise exception 'الفصل خارج نطاق الإصدار'; end if;
  drop table if exists _rc_cols;
  create temp table _rc_cols on commit drop as
    select ta.subject_id, s.name_ar subject, (select string_agg(distinct p.full_name, '، ') from teaching_assignments t2 join profiles p on p.id = t2.teacher_id
                                                where t2.class_id = p_class and t2.subject_id = ta.subject_id) teacher,
           coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'weight', c.weight, 'max', c.max_score, 'hidden', c.hidden))
                       from private.gb_columns(p_class, ta.subject_id) c where not c.hidden and c.d between i.from_date and i.to_date), '[]'::jsonb) cols
      from (select distinct subject_id from teaching_assignments where class_id = p_class) ta join subjects s on s.id = ta.subject_id;
  for st in select s.profile_id, s.student_number, p.full_name from students s join profiles p on p.id = s.profile_id and p.active where s.class_id = p_class loop
    select coalesce(jsonb_agg(jsonb_build_object('subject', c.subject, 'teacher', c.teacher, 'pct', x.pct, 'label', private.rc_label(i.scale, x.pct)) order by c.subject), '[]'::jsonb),
           round(avg(x.pct), 1)
      into subs, avgp
      from _rc_cols c cross join lateral (select case when jsonb_array_length(c.cols) = 0 then null
                                                       else private.gb_pct(c.cols, private.gb_student_scores(p_class, c.subject_id, st.profile_id)) end pct) x;
    att := (select jsonb_build_object('days', count(distinct a.day), 'absent', count(*) filter (where m.status = 'absent'),
                    'late', count(*) filter (where m.status = 'late'), 'excused', count(*) filter (where m.status = 'excused'))
              from attendance_sessions a left join attendance_marks m on m.session_id = a.id and m.student_id = st.profile_id
             where a.period = 0 and a.day between i.from_date and i.to_date and a.grade_id = (select grade_id from students where profile_id = st.profile_id)
               and (a.class_id is null or a.class_id = p_class));
    bh := (select jsonb_build_object('points', coalesce(sum(points) filter (where kind = 'positive'), 0),
                    'positive', count(*) filter (where kind = 'positive'), 'negative', count(*) filter (where kind = 'negative'))
             from bh_notes where student_id = st.profile_id and note_date between i.from_date and i.to_date);
    insert into rc_cards(issue_id, student_id, class_id, data, generated_at)
    values (p_issue, st.profile_id, p_class, jsonb_build_object('name', st.full_name, 'student_no', st.student_number,
              'class', (select label from v_classes where id = p_class), 'subjects', subs, 'avg', avgp, 'label', private.rc_label(i.scale, avgp),
              'attendance', att, 'behavior', bh), now())
    on conflict (issue_id, student_id) do update set data = excluded.data, class_id = excluded.class_id, generated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;

-- شهادات فصل (للعرض والطباعة)
create or replace function public.rc_cards_get(p_issue bigint, p_class int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare i rc_issues;
begin
  if not private.rc_can_class(p_class) then raise exception 'غير مصرح'; end if;
  select * into i from rc_issues where id = p_issue;
  return jsonb_build_object('issue', jsonb_build_object('id', i.id, 'title', i.title, 'from', i.from_date, 'to', i.to_date, 'scale', i.scale,
             'show_att', i.show_att, 'show_bh', i.show_bh, 'published', i.published, 'term', (select t.name || ' — ' || y.name from terms t join academic_years y on y.id = t.year_id where t.id = i.term_id)),
    'can_note', private.rc_can_class(p_class),
    'cards', coalesce((select jsonb_agg(c.data || jsonb_build_object('id', c.student_id, 'note', c.note, 'generated_at', c.generated_at) order by c.data->>'name')
              from rc_cards c where c.issue_id = p_issue and c.class_id = p_class), '[]'::jsonb));
end $$;

create or replace function public.rc_note_set(p_issue bigint, p_student uuid, p_note text) returns void
language plpgsql security definer set search_path = public, private as $$
declare c rc_cards;
begin
  select * into c from rc_cards where issue_id = p_issue and student_id = p_student;
  if c.issue_id is null or not private.rc_can_class(c.class_id) then raise exception 'غير مصرح'; end if;
  update rc_cards set note = nullif(btrim(p_note), '') where issue_id = p_issue and student_id = p_student;
end $$;

create or replace function public.rc_publish(p_issue bigint, p_on boolean) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.rc_manager() then raise exception 'غير مصرح'; end if;
  if p_on and not exists (select 1 from rc_cards where issue_id = p_issue) then raise exception 'ولّد الشهادات أولًا'; end if;
  update rc_issues set published = p_on where id = p_issue;
end $$;

-- الشهادات المنشورة لطالب
create or replace function private.rc_of(p_student uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(c.data || jsonb_build_object('note', c.note, 'issue', jsonb_build_object('title', i.title, 'from', i.from_date, 'to', i.to_date, 'scale', i.scale,
           'show_att', i.show_att, 'show_bh', i.show_bh, 'term', (select t.name || ' — ' || y.name from terms t join academic_years y on y.id = t.year_id where t.id = i.term_id)))
           order by i.to_date desc), '[]'::jsonb)
    from rc_cards c join rc_issues i on i.id = c.issue_id and i.published where c.student_id = p_student
$$;

create or replace function public.rc_my() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select case when public.me_role() = 'student' then private.rc_of(public.me_id()) else '[]'::jsonb end
$$;

-- لولي الأمر: إضافة الشهادات ورقم الجلوس وجدول الاختبارات إلى ملخص الابن
create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare s students; f date := current_date - 60;
begin
  select * into s from students where profile_id = p_student;
  if s.profile_id is null then return null; end if;
  return jsonb_build_object(
    'id', s.profile_id, 'name', (select full_name from profiles where id = s.profile_id),
    'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id),
    'class', (select name from classes where id = s.class_id),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('name', p.full_name, 'subject', sb.name_ar))
                 from teaching_assignments ta join classes c on c.id = ta.class_id join profiles p on p.id = ta.teacher_id and p.active
                 join subjects sb on sb.id = ta.subject_id
                 where (s.class_id is not null and ta.class_id = s.class_id) or (s.class_id is null and c.grade_id = s.grade_id)), '[]'::jsonb),
    'attendance', jsonb_build_object(
      'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = s.grade_id and a.period = 0
                      and (a.class_id is null or a.class_id = s.class_id) and a.day >= f),
      'absent',  (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'absent'),
      'late',    (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'late'),
      'excused', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'excused'),
      'recent',  coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.day >= f), '[]'::jsonb)),
    'behavior', private.child_behavior(s.profile_id),
    'report_cards', private.rc_of(s.profile_id),
    'exams', private.ec_student_info(s.profile_id));
end $$;

revoke all on function private.rc_manager(), private.rc_can_class(int), private.rc_label(jsonb, numeric), private.rc_of(uuid), private.child_summary(uuid) from public, anon, authenticated;
revoke all on function public.rc_list(), public.rc_issue_save(jsonb), public.rc_issue_delete(bigint), public.rc_classes(bigint), public.rc_generate(bigint, int),
  public.rc_cards_get(bigint, int), public.rc_note_set(bigint, uuid, text), public.rc_publish(bigint, boolean), public.rc_my() from public, anon;
grant execute on function public.rc_list(), public.rc_issue_save(jsonb), public.rc_issue_delete(bigint), public.rc_classes(bigint), public.rc_generate(bigint, int),
  public.rc_cards_get(bigint, int), public.rc_note_set(bigint, uuid, text), public.rc_publish(bigint, boolean), public.rc_my() to authenticated;
