-- =====================================================================
--  الملف 18: الحضور والغياب
--  - «جلسة» = تسجيل حضور صف (أو فصل) في يوم (يومي = حصة 0، أو حصة محددة)
--  - تُحفظ الحالات غير «حاضر» فقط (غائب / متأخر / غائب بعذر)، ومن لم يُذكر في جلسة مسجّلة = حاضر
--  - يسجّل: المعلم الذي يدرّس الصف، ورائد الفصل، ومن له نطاق على الصف، والإدارة
--  - يطّلع: نفس هؤلاء + الطالب على نفسه + ولي الأمر على أبنائه
-- =====================================================================

create table if not exists public.attendance_sessions (
  id         bigserial primary key,
  day        date not null,
  grade_id   int not null references public.grades(id) on delete cascade,
  class_id   int references public.classes(id) on delete cascade,
  period     smallint not null default 0,              -- 0 = الحضور اليومي
  taken_by   uuid references public.profiles(id) on delete set null,
  taken_at   timestamptz not null default now(),
  total      int not null default 0,
  absent     int not null default 0,
  late       int not null default 0,
  excused    int not null default 0
);
create unique index if not exists attendance_sessions_uq on public.attendance_sessions(day, grade_id, coalesce(class_id, 0), period);

create table if not exists public.attendance_marks (
  session_id bigint not null references public.attendance_sessions(id) on delete cascade,
  student_id uuid not null references public.students(profile_id) on delete cascade,
  status     text not null check (status in ('absent','late','excused')),
  note       text,
  primary key (session_id, student_id)
);
create index if not exists attendance_marks_student on public.attendance_marks(student_id);

alter table public.attendance_sessions enable row level security;
alter table public.attendance_marks    enable row level security;   -- القراءة والكتابة عبر الدوال فقط

-- من يحق له تسجيل/عرض حضور صف (أو فصل)
create or replace function private.att_can(p_grade int, p_class int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null then return false; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;
  if r in ('student','parent') then return false; end if;
  if p_class is not null and public.can_view_class(p_class) then return true; end if;
  if public.can_view_grade(p_grade) then return true; end if;
  return exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id
                 where ta.teacher_id = me and c.grade_id = p_grade and (p_class is null or c.id = p_class))
      or exists (select 1 from classes c where c.homeroom_teacher_id = me and c.grade_id = p_grade and (p_class is null or c.id = p_class));
end $$;

-- الصفوف/الفصول المتاحة لي لتسجيل الحضور
create or replace function public.att_my_groups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'sort', x->>'label') from (
      select jsonb_build_object('grade_id', g.id, 'label', g.name_ar || ' — ' || st.name_ar,
               'sort', lpad(st.sort::text, 3, '0') || lpad(g.number::text, 3, '0'),
               'students', (select count(*) from students s join profiles p on p.id = s.profile_id where s.grade_id = g.id and p.active),
               'classes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                            'n', (select count(*) from students s where s.class_id = c.id)) order by c.name)
                          from classes c where c.grade_id = g.id and c.active and private.att_can(g.id, c.id)), '[]'::jsonb)) x
      from grades g join stages st on st.id = g.stage_id
      where private.att_can(g.id, null)
         or exists (select 1 from classes c where c.grade_id = g.id and private.att_can(g.id, c.id))
    ) q), '[]'::jsonb);
end $$;

-- قائمة الطلاب + الحالات المسجّلة لليوم
create or replace function public.att_roster(p_day date, p_grade int, p_class int default null, p_period int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid bigint; sess jsonb;
begin
  if not private.att_can(p_grade, p_class) then raise exception 'غير مصرح بتسجيل حضور هذا الصف'; end if;
  select a.id, jsonb_build_object('taken_at', a.taken_at, 'by', p.full_name) into sid, sess
    from attendance_sessions a left join profiles p on p.id = a.taken_by
   where a.day = p_day and a.grade_id = p_grade and coalesce(a.class_id, 0) = coalesce(p_class, 0) and a.period = p_period;
  return jsonb_build_object('session', sess, 'students', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number,
             'class', c.name, 'status', m.status, 'note', m.note,
             -- حالته في الحضور اليومي لنفس اليوم (للتنبيه عند تسجيل حصة)
             'daily', (select m2.status from attendance_marks m2 join attendance_sessions a2 on a2.id = m2.session_id
                        where m2.student_id = s.profile_id and a2.day = p_day and a2.period = 0 limit 1))
             order by c.name nulls last, p.full_name)
    from students s join profiles p on p.id = s.profile_id
    left join classes c on c.id = s.class_id
    left join attendance_marks m on m.session_id = sid and m.student_id = s.profile_id
    where p.active and s.grade_id = p_grade and (p_class is null or s.class_id = p_class)), '[]'::jsonb));
end $$;

-- حفظ الحضور: p_marks = [{"s": student_id, "st": "absent|late|excused", "n": "ملاحظة"}] (الحاضرون لا يُرسلون)
create or replace function public.att_save(p_day date, p_grade int, p_class int, p_period int, p_marks jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sid bigint; n_total int;
begin
  if not private.att_can(p_grade, p_class) then raise exception 'غير مصرح بتسجيل حضور هذا الصف'; end if;
  if p_day > current_date + 1 then raise exception 'لا يمكن تسجيل حضور لتاريخ مستقبلي'; end if;
  select count(*) into n_total from students s join profiles p on p.id = s.profile_id
   where p.active and s.grade_id = p_grade and (p_class is null or s.class_id = p_class);
  select id into sid from attendance_sessions
   where day = p_day and grade_id = p_grade and coalesce(class_id, 0) = coalesce(p_class, 0) and period = coalesce(p_period, 0);
  if sid is null then
    insert into attendance_sessions(day, grade_id, class_id, period, taken_by) values (p_day, p_grade, p_class, coalesce(p_period, 0), public.me_id())
    returning id into sid;
  end if;
  delete from attendance_marks where session_id = sid;
  insert into attendance_marks(session_id, student_id, status, note)
  select sid, (m->>'s')::uuid, m->>'st', nullif(btrim(m->>'n'), '')
  from jsonb_array_elements(coalesce(p_marks, '[]'::jsonb)) m
  join students s on s.profile_id = (m->>'s')::uuid and s.grade_id = p_grade and (p_class is null or s.class_id = p_class)
  where m->>'st' in ('absent','late','excused')
  on conflict do nothing;
  update attendance_sessions a set taken_by = public.me_id(), taken_at = now(), total = n_total,
    absent  = (select count(*) from attendance_marks where session_id = sid and status = 'absent'),
    late    = (select count(*) from attendance_marks where session_id = sid and status = 'late'),
    excused = (select count(*) from attendance_marks where session_id = sid and status = 'excused')
  where a.id = sid;
  return (select jsonb_build_object('ok', true, 'total', total, 'absent', absent, 'late', late, 'excused', excused) from attendance_sessions where id = sid);
end $$;

-- تقرير الإدارة: لكل صف في يوم + أكثر الطلاب غيابًا في فترة
create or replace function public.att_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'grades', coalesce((select jsonb_agg(x order by x->>'sort') from (
      select jsonb_build_object('grade_id', g.id, 'label', g.name_ar || ' — ' || st.name_ar,
        'sort', lpad(st.sort::text, 3, '0') || lpad(g.number::text, 3, '0'),
        'students', (select count(*) from students s join profiles p on p.id = s.profile_id where s.grade_id = g.id and p.active),
        'days_taken', (select count(distinct day) from attendance_sessions a where a.grade_id = g.id and a.period = 0 and a.day between p_from and p_to),
        'absent', coalesce((select sum(absent) from attendance_sessions a where a.grade_id = g.id and a.period = 0 and a.day between p_from and p_to), 0),
        'late', coalesce((select sum(late) from attendance_sessions a where a.grade_id = g.id and a.period = 0 and a.day between p_from and p_to), 0),
        'excused', coalesce((select sum(excused) from attendance_sessions a where a.grade_id = g.id and a.period = 0 and a.day between p_from and p_to), 0),
        'last', (select jsonb_build_object('day', a.day, 'by', p.full_name, 'at', a.taken_at) from attendance_sessions a
                  left join profiles p on p.id = a.taken_by where a.grade_id = g.id and a.period = 0 and a.day between p_from and p_to
                  order by a.day desc, a.taken_at desc limit 1)) x
      from grades g join stages st on st.id = g.stage_id
      where private.att_can(g.id, null) and exists (select 1 from students s where s.grade_id = g.id)) q), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(y order by (y->>'absent')::int desc, (y->>'late')::int desc) from (
      select jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number,
        'grade', g.name_ar || ' — ' || st.name_ar, 'class', c.name,
        'absent', count(*) filter (where m.status = 'absent'), 'late', count(*) filter (where m.status = 'late'),
        'excused', count(*) filter (where m.status = 'excused'),
        'days', jsonb_agg(jsonb_build_object('d', a.day, 's', m.status, 'n', m.note) order by a.day)) y
      from attendance_marks m join attendance_sessions a on a.id = m.session_id and a.period = 0 and a.day between p_from and p_to
      join students s on s.profile_id = m.student_id join profiles p on p.id = s.profile_id
      join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
      left join classes c on c.id = s.class_id
      where private.att_can(s.grade_id, s.class_id)
      group by s.profile_id, p.full_name, s.student_number, g.name_ar, st.name_ar, c.name) q), '[]'::jsonb));
end $$;

-- سجل حضور طالب (للإدارة والمعلم صاحب الصلاحية، وللطالب نفسه، ولولي أمره)
create or replace function public.att_student(p_student uuid, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare gid int; cid int; f date := coalesce(p_from, current_date - 120); t date := coalesce(p_to, current_date);
begin
  select grade_id, class_id into gid, cid from students where profile_id = p_student;
  if not (public.can_view_student(p_student) or private.att_can(gid, cid)) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = gid and a.period = 0
                    and (a.class_id is null or a.class_id = cid) and a.day between f and t),
    'marks', coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
               from attendance_marks m join attendance_sessions a on a.id = m.session_id
               where m.student_id = p_student and a.day between f and t), '[]'::jsonb));
end $$;

revoke all on function public.att_my_groups() from public, anon;
revoke all on function public.att_roster(date, int, int, int) from public, anon;
revoke all on function public.att_save(date, int, int, int, jsonb) from public, anon;
revoke all on function public.att_report(date, date) from public, anon;
revoke all on function public.att_student(uuid, date, date) from public, anon;
grant execute on function public.att_my_groups() to authenticated;
grant execute on function public.att_roster(date, int, int, int) to authenticated;
grant execute on function public.att_save(date, int, int, int, jsonb) to authenticated;
grant execute on function public.att_report(date, date) to authenticated;
grant execute on function public.att_student(uuid, date, date) to authenticated;
