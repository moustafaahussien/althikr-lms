-- =====================================================================
-- 54: جواز مهارات القرن 21 — سجل مشاركة الطالب في برامج الوحدة الستة ومستواه في كل برنامج
--   • يسجّل المنسوب (معلمو البرامج) مشاركة لطالب أو لعدة طلاب: البرنامج، النشاط، المستوى، الساعات، رابط دليل
--   • الطالب يرى جوازه، وولي الأمر يراه في بوابته، والمنسوبون لطلابهم
--   • إحصاءات الوحدة جاهزة لتقرير نهاية الفصل
-- =====================================================================
create table if not exists public.sk_programs (
  code  text primary key,
  name  text not null,
  icon  text not null,
  sort  int not null default 0
);
insert into public.sk_programs(code, name, icon, sort) values
  ('eq', 'الذكاء العاطفي', '💚', 1), ('research', 'البحث العلمي', '🔬', 2), ('dfc', 'التصميم من أجل التغيير', '💡', 3),
  ('entre', 'ريادة الأعمال', '🚀', 4), ('robotics', 'الروبوت والطباعة ثلاثية الأبعاد', '🤖', 5), ('stem', 'STEM', '⚙️', 6)
on conflict (code) do nothing;

create table if not exists public.sk_records (
  id          bigserial primary key,
  student_id  uuid not null references public.students(profile_id) on delete cascade,
  program     text not null references public.sk_programs(code),
  activity    text not null check (btrim(activity) <> ''),
  kind        text not null default 'activity' check (kind in ('session','activity','project','competition','exhibition','other')),
  level       smallint not null default 1 check (level between 1 and 4),   -- 1 مستكشف، 2 ممارس، 3 متقن، 4 مُلهِم
  hours       numeric(5,1) not null default 0,
  rec_date    date not null default current_date,
  evidence    text,
  note        text,
  added_by    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sk_records_student_idx on public.sk_records (student_id, program);
create index if not exists sk_records_date_idx on public.sk_records (rec_date desc);
alter table public.sk_programs enable row level security;
alter table public.sk_records enable row level security;
revoke all on public.sk_programs, public.sk_records from anon, authenticated;

create or replace function private.sk_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership') or p.job_title ~ 'مهارات القرن'))
$$;
create or replace function private.sk_sees(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (private.sk_manager() or exists (select 1 from students s where s.profile_id = p_student
           and (public.can_view_student(p_student) or private.att_can(s.grade_id, s.class_id))))
$$;

create or replace function private.sk_passport_of(p_student uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'programs', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'icon', g.icon,
        'level', (select max(level) from sk_records r where r.student_id = p_student and r.program = g.code),
        'count', (select count(*) from sk_records r where r.student_id = p_student and r.program = g.code),
        'hours', (select coalesce(sum(hours), 0) from sk_records r where r.student_id = p_student and r.program = g.code)) order by g.sort)
      from sk_programs g), '[]'::jsonb),
    'records', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'program', r.program, 'activity', r.activity, 'kind', r.kind, 'level', r.level, 'hours', r.hours,
        'date', r.rec_date, 'evidence', r.evidence, 'note', r.note, 'by', (select full_name from profiles where id = r.added_by), 'mine', r.added_by = public.me_id())
        order by r.rec_date desc, r.id desc) from sk_records r where r.student_id = p_student), '[]'::jsonb))
$$;

-- جواز طالب (افتراضيًا: جوازي)
create or replace function public.sk_passport(p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); sid uuid := coalesce(p_student, me); s students;
begin
  select * into s from students where profile_id = sid;
  if s.profile_id is null then raise exception 'الطالب غير موجود'; end if;
  if not (sid = me or private.sk_sees(sid) or (public.me_role() = 'parent' and exists (select 1 from parent_links where parent_id = me and student_id = sid))) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('student', jsonb_build_object('id', sid, 'name', (select full_name from profiles where id = sid), 'no', s.student_number,
      'class', (select label from v_classes where id = s.class_id)),
    'can_add', private.sk_sees(sid), 'manager', private.sk_manager()) || private.sk_passport_of(sid);
end $$;

-- تسجيل مشاركة لعدة طلاب
create or replace function public.sk_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid uuid; n int := 0; act text := btrim(coalesce(p->>'activity','')); d date := coalesce(nullif(p->>'date','')::date, current_date);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if not exists (select 1 from sk_programs where code = p->>'program') then raise exception 'اختر البرنامج'; end if;
  if act = '' then raise exception 'اكتب النشاط أو المشاركة'; end if;
  if jsonb_array_length(coalesce(p->'students','[]'::jsonb)) = 0 then raise exception 'اختر طالبًا واحدًا على الأقل'; end if;
  if jsonb_array_length(p->'students') > 200 then raise exception 'الحد الأقصى 200 طالب في المرة الواحدة'; end if;
  if d > current_date + 1 then raise exception 'التاريخ لا يكون في المستقبل'; end if;
  if nullif(btrim(coalesce(p->>'evidence','')), '') is not null and p->>'evidence' !~* '^https?://' then raise exception 'رابط الدليل يجب أن يبدأ بـ https://'; end if;
  for sid in select (x)::uuid from jsonb_array_elements_text(p->'students') x loop
    if not private.sk_sees(sid) then raise exception 'غير مصرح لك بأحد الطلاب المختارين'; end if;
    insert into sk_records(student_id, program, activity, kind, level, hours, rec_date, evidence, note, added_by)
    values (sid, p->>'program', left(act, 200), coalesce(nullif(p->>'kind',''), 'activity'), greatest(1, least(coalesce(nullif(p->>'level','')::int, 1), 4)),
            greatest(0, least(coalesce(nullif(p->>'hours','')::numeric, 0), 500)), d, nullif(btrim(coalesce(p->>'evidence','')), ''),
            nullif(left(btrim(coalesce(p->>'note','')), 500), ''), public.me_id());
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', n);
end $$;

create or replace function public.sk_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r sk_records;
begin
  select * into r from sk_records where id = p_id; if not found then raise exception 'غير موجود'; end if;
  if not ((r.added_by = public.me_id() or private.sk_manager()) and private.sk_sees(r.student_id)) then raise exception 'يحذف السجل من أضافه أو مشرف الوحدة'; end if;
  delete from sk_records where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.sk_programs_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'icon', icon) order by sort), '[]'::jsonb) from sk_programs
$$;

-- إحصاءات الوحدة
create or replace function public.sk_stats(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare f date := coalesce(p_from, current_date - 365); t date := coalesce(p_to, current_date);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return (with r as (select r.* from sk_records r where r.rec_date between f and t and private.sk_sees(r.student_id))
    select jsonb_build_object('students', (select count(distinct student_id) from r), 'records', (select count(*) from r), 'hours', (select coalesce(sum(hours), 0) from r),
      'teachers', (select count(distinct added_by) from r),
      'by_program', coalesce((select jsonb_agg(jsonb_build_object('code', g.code, 'name', g.name, 'icon', g.icon,
            'students', (select count(distinct student_id) from r where r.program = g.code), 'records', (select count(*) from r where r.program = g.code),
            'hours', (select coalesce(sum(hours), 0) from r where r.program = g.code),
            'levels', (select jsonb_object_agg(lv, n) from (select lv, count(*) n from (select student_id, max(level) lv from r where r.program = g.code group by student_id) a group by lv) b)) order by g.sort)
          from sk_programs g), '[]'::jsonb),
      'by_stage', coalesce((select jsonb_agg(jsonb_build_object('stage', st.name_ar, 'students', x.n) order by st.sort) from
          (select g.stage_id, count(distinct r.student_id) n from r join students s on s.profile_id = r.student_id join grades g on g.id = s.grade_id group by g.stage_id) x
          join stages st on st.id = x.stage_id), '[]'::jsonb),
      'multi', (select count(*) from (select student_id from r group by student_id having count(distinct program) >= 3) z)));
end $$;

-- عرض الجواز لولي الأمر في بوابته (ضمن ملخص الابن)
create or replace function private.child_skills(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$ select private.sk_passport_of(p_student) $$;

-- ملخص الابن لولي الأمر: + جواز المهارات
create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'skills', private.child_skills(s.profile_id));
end $$;

revoke all on function private.sk_manager(), private.sk_sees(uuid), private.sk_passport_of(uuid), private.child_skills(uuid), private.child_summary(uuid) from public, anon, authenticated;
revoke all on function public.sk_passport(uuid), public.sk_add(jsonb), public.sk_delete(bigint), public.sk_programs_list(), public.sk_stats(date, date) from public, anon;
grant execute on function public.sk_passport(uuid), public.sk_add(jsonb), public.sk_delete(bigint), public.sk_programs_list(), public.sk_stats(date, date) to authenticated;
