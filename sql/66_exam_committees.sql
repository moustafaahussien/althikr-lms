-- ============================================================
-- 66) لجان الاختبارات (الكنترول)
-- فترة اختبارات ← اللجان (القاعات وسعتها) ← جدول الاختبارات ← توزيع الطلاب وأرقام الجلوس
-- ← توزيع الملاحظين آليًا (بدون معلم المادة) ← طباعة بطاقات الجلوس والكشوف ← نشر وإشعار.
-- ============================================================

create table if not exists public.ec_sessions (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  term_id     integer references public.terms(id) on delete set null,
  stage_ids   integer[] not null default '{}',
  starts_on   date,
  ends_on     date,
  published   boolean not null default false,
  seat_start  integer not null default 1,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.ec_rooms (
  id          bigserial primary key,
  session_id  bigint not null references public.ec_sessions(id) on delete cascade,
  no          smallint not null,
  name        text,
  location    text,
  capacity    smallint not null default 20 check (capacity between 1 and 300),
  unique (session_id, no)
);

create table if not exists public.ec_exams (
  id           bigserial primary key,
  session_id   bigint not null references public.ec_sessions(id) on delete cascade,
  day          date not null,
  slot         smallint not null default 1 check (slot between 1 and 4),
  start_time   time,
  duration_min smallint not null default 90,
  grade_id     integer not null references public.grades(id) on delete cascade,
  subject_id   integer not null references public.subjects(id) on delete cascade,
  unique (session_id, day, slot, grade_id)
);

create table if not exists public.ec_seats (
  session_id  bigint not null references public.ec_sessions(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  room_id     bigint not null references public.ec_rooms(id) on delete cascade,
  seat_no     integer not null,
  primary key (session_id, student_id),
  unique (session_id, seat_no)
);

create table if not exists public.ec_invig (
  id          bigserial primary key,
  session_id  bigint not null references public.ec_sessions(id) on delete cascade,
  day         date not null,
  slot        smallint not null,
  room_id     bigint not null references public.ec_rooms(id) on delete cascade,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  unique (session_id, day, slot, teacher_id)
);
create index if not exists ec_invig_room on public.ec_invig(room_id, day, slot);

alter table public.ec_sessions enable row level security; alter table public.ec_rooms enable row level security;
alter table public.ec_exams enable row level security; alter table public.ec_seats enable row level security; alter table public.ec_invig enable row level security;
revoke all on public.ec_sessions, public.ec_rooms, public.ec_exams, public.ec_seats, public.ec_invig from anon, authenticated;

-- مدير اللجان: الإدارة، مديرو المراحل والوكلاء، ومسؤول الكنترول/الاختبارات
create or replace function private.ec_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership','principal') or coalesce(p.job_title,'') ~ '(وكيل|وكيلة|كنترول|اختبارات|شؤون الطلاب)'))
$$;

create or replace function private.ec_slot_label(s smallint) returns text language sql immutable as $$
  select (array['الفترة الأولى','الفترة الثانية','الفترة الثالثة','الفترة الرابعة'])[s]
$$;

-- طلاب فترة الاختبارات (حسب المراحل)
create or replace function private.ec_students(p_session bigint) returns table(student_id uuid, grade_id int, class_id int, name text, stage_sort int, grade_no int)
language sql stable security definer set search_path = public as $$
  select s.profile_id, s.grade_id, s.class_id, p.full_name, st.sort, g.number
    from ec_sessions e join students s on true join profiles p on p.id = s.profile_id and p.active
    join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
   where e.id = p_session and g.stage_id = any (e.stage_ids)
$$;

-- ---------- الفترات ----------
create or replace function public.ec_sessions_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'starts_on', e.starts_on, 'ends_on', e.ends_on, 'published', e.published,
      'stages', (select string_agg(name_ar, '، ' order by sort) from stages where id = any (e.stage_ids)),
      'rooms', (select count(*) from ec_rooms where session_id = e.id), 'exams', (select count(*) from ec_exams where session_id = e.id),
      'seated', (select count(*) from ec_seats where session_id = e.id)) order by e.created_at desc)
    from ec_sessions e), '[]'::jsonb);
end $$;

create or replace function public.ec_session_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare sid bigint := nullif(p->>'id', '')::bigint; st int[];
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  select array_agg(x::int) into st from jsonb_array_elements_text(coalesce(p->'stage_ids', '[]')) x;
  if coalesce(array_length(st, 1), 0) = 0 then raise exception 'اختر مرحلة واحدة على الأقل'; end if;
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'اكتب عنوان فترة الاختبارات'; end if;
  if sid is null then
    insert into ec_sessions(title, term_id, stage_ids, starts_on, ends_on, seat_start, created_by)
    values (btrim(p->>'title'), (select id from terms where is_current), st, nullif(p->>'starts_on', '')::date, nullif(p->>'ends_on', '')::date,
            coalesce(nullif(p->>'seat_start', '')::int, 1), public.me_id()) returning id into sid;
  else
    update ec_sessions set title = btrim(p->>'title'), stage_ids = st, starts_on = nullif(p->>'starts_on', '')::date, ends_on = nullif(p->>'ends_on', '')::date,
           seat_start = coalesce(nullif(p->>'seat_start', '')::int, seat_start) where id = sid;
  end if;
  return sid;
end $$;

create or replace function public.ec_session_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  delete from ec_sessions where id = p_id;
end $$;

-- ---------- كل بيانات الفترة ----------
create or replace function public.ec_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare e ec_sessions;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  select * into e from ec_sessions where id = p_id;
  if e.id is null then raise exception 'غير موجودة'; end if;
  return jsonb_build_object('session', to_jsonb(e),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar,
                 'n', (select count(*) from private.ec_students(p_id) x where x.grade_id = g.id),
                 'subjects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', sb.id, 'name', sb.name_ar))
                     from teaching_assignments ta join classes c on c.id = ta.class_id join subjects sb on sb.id = ta.subject_id where c.grade_id = g.id), '[]'::jsonb))
                 order by st.sort, g.number) from grades g join stages st on st.id = g.stage_id where g.stage_id = any (e.stage_ids)), '[]'::jsonb),
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'no', r.no, 'name', r.name, 'location', r.location, 'capacity', r.capacity,
                 'seated', (select count(*) from ec_seats s where s.room_id = r.id),
                 'grades', (select jsonb_agg(distinct x.grade_id) from ec_seats s join private.ec_students(p_id) x on x.student_id = s.student_id where s.room_id = r.id)) order by r.no)
               from ec_rooms r where r.session_id = p_id), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'day', x.day, 'slot', x.slot, 'start', to_char(x.start_time, 'HH24:MI'), 'duration', x.duration_min,
                 'grade_id', x.grade_id, 'subject_id', x.subject_id, 'subject', (select name_ar from subjects where id = x.subject_id)) order by x.day, x.slot, x.grade_id)
               from ec_exams x where x.session_id = p_id), '[]'::jsonb),
    'invig', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'day', i.day, 'slot', i.slot, 'room_id', i.room_id, 'teacher_id', i.teacher_id,
                 'name', (select full_name from profiles where id = i.teacher_id)) order by i.day, i.slot)
               from ec_invig i where i.session_id = p_id), '[]'::jsonb),
    'students', (select count(*) from private.ec_students(p_id)),
    'seated', (select count(*) from ec_seats where session_id = p_id));
end $$;

-- ---------- اللجان ----------
create or replace function public.ec_room_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare rid bigint := nullif(p->>'id', '')::bigint; sid bigint := (p->>'session_id')::bigint;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  if rid is null then
    insert into ec_rooms(session_id, no, name, location, capacity)
    values (sid, coalesce(nullif(p->>'no', '')::smallint, (select coalesce(max(no), 0) + 1 from ec_rooms where session_id = sid)),
            nullif(btrim(p->>'name'), ''), nullif(btrim(p->>'location'), ''), coalesce(nullif(p->>'capacity', '')::smallint, 20)) returning id into rid;
  else
    update ec_rooms set no = coalesce(nullif(p->>'no', '')::smallint, no), name = nullif(btrim(p->>'name'), ''), location = nullif(btrim(p->>'location'), ''),
           capacity = coalesce(nullif(p->>'capacity', '')::smallint, capacity) where id = rid;
  end if;
  return rid;
end $$;

create or replace function public.ec_rooms_bulk(p_session bigint, p_count int, p_capacity int, p_location text default null) returns int
language plpgsql security definer set search_path = public, private as $$
declare b int; i int;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  if p_count not between 1 and 100 then raise exception 'العدد بين 1 و 100'; end if;
  select coalesce(max(no), 0) into b from ec_rooms where session_id = p_session;
  for i in 1..p_count loop
    insert into ec_rooms(session_id, no, name, location, capacity) values (p_session, b + i, 'لجنة ' || (b + i), nullif(btrim(p_location), ''), p_capacity);
  end loop;
  return p_count;
end $$;

create or replace function public.ec_room_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  delete from ec_rooms where id = p_id;
end $$;

-- ---------- الجدول ----------
create or replace function public.ec_exam_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare xid bigint := nullif(p->>'id', '')::bigint;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  if nullif(p->>'day', '') is null or nullif(p->>'grade_id', '') is null or nullif(p->>'subject_id', '') is null then raise exception 'أكمل اليوم والصف والمادة'; end if;
  if xid is null then
    insert into ec_exams(session_id, day, slot, start_time, duration_min, grade_id, subject_id)
    values ((p->>'session_id')::bigint, (p->>'day')::date, coalesce(nullif(p->>'slot', '')::smallint, 1), nullif(p->>'start', '')::time,
            coalesce(nullif(p->>'duration', '')::smallint, 90), (p->>'grade_id')::int, (p->>'subject_id')::int)
    on conflict (session_id, day, slot, grade_id) do update set subject_id = excluded.subject_id, start_time = excluded.start_time, duration_min = excluded.duration_min
    returning id into xid;
  else
    update ec_exams set day = (p->>'day')::date, slot = coalesce(nullif(p->>'slot', '')::smallint, slot), start_time = nullif(p->>'start', '')::time,
           duration_min = coalesce(nullif(p->>'duration', '')::smallint, duration_min), grade_id = (p->>'grade_id')::int, subject_id = (p->>'subject_id')::int where id = xid;
  end if;
  return xid;
end $$;

create or replace function public.ec_exam_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  delete from ec_exams where id = p_id;
end $$;

-- ---------- توزيع الطلاب على اللجان وأرقام الجلوس ----------
-- p_mode: 'grade' = كل صف متتاليًا | 'mix' = تبادل بين صفّين/أكثر داخل اللجنة (يقلل الغش)
create or replace function public.ec_seat_auto(p_session bigint, p_mode text default 'mix') returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare e ec_sessions; tot int; cap int; r record; n int := 0; seat int; placed int := 0;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  select * into e from ec_sessions where id = p_session;
  select count(*) into tot from private.ec_students(p_session);
  select coalesce(sum(capacity), 0) into cap from ec_rooms where session_id = p_session;
  if cap < tot then raise exception 'سعة اللجان (%) أقل من عدد الطلاب (%) — أضف لجانًا أو زِد السعة', cap, tot; end if;
  delete from ec_seats where session_id = p_session;
  seat := e.seat_start;
  -- ترتيب الطلاب: بالصف ثم الاسم؛ وفي وضع الخلط نرتّب بالتناوب بين الصفوف (رقم الطالب داخل صفه)
  drop table if exists _ec_order;
  create temp table _ec_order on commit drop as
    select y.student_id, row_number() over (order by
             case when p_mode = 'mix' then y.grn end, case when p_mode = 'mix' then y.stage_sort * 100 + y.grade_no end,
             y.stage_sort, y.grade_no, y.name) rn,
           y.stage_sort, y.grade_no, y.name
      from (select x.*, row_number() over (partition by x.grade_id order by x.name) grn from private.ec_students(p_session) x) y;
  -- رقم الجلوس متسلسل داخل كل لجنة بنفس ترتيب التوزيع
  for r in select id, capacity from ec_rooms where session_id = p_session order by no loop
    insert into ec_seats(session_id, student_id, room_id, seat_no)
      select p_session, o.student_id, r.id, (e.seat_start - 1 + o.rn)::int from _ec_order o
       where o.rn > placed and o.rn <= placed + r.capacity;
    get diagnostics n = row_count; placed := placed + n;
    exit when placed >= tot;
  end loop;
  return jsonb_build_object('students', tot, 'placed', placed);
end $$;

-- كشف لجنة / كل اللجان (للطباعة)
create or replace function public.ec_seats_list(p_session bigint, p_room bigint default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('seat', s.seat_no, 'room_id', s.room_id, 'room_no', r.no, 'room', coalesce(r.name, 'لجنة ' || r.no), 'location', r.location,
           'name', x.name, 'grade_id', x.grade_id, 'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = x.grade_id),
           'class', (select name from classes where id = x.class_id), 'student_no', (select student_number from students where profile_id = s.student_id)) order by r.no, s.seat_no)
    from ec_seats s join ec_rooms r on r.id = s.room_id join private.ec_students(p_session) x on x.student_id = s.student_id
   where s.session_id = p_session and (p_room is null or s.room_id = p_room)), '[]'::jsonb);
end $$;

-- ---------- توزيع الملاحظين ----------
-- لكل (يوم، فترة) فيها اختبار، ولكل لجنة بها طلاب من صفوف تختبر: p_per ملاحظ،
-- يُستبعد من يدرّس مادة الاختبار لتلك الصفوف، ويُوزَّع العبء بالتساوي.
create or replace function public.ec_invig_auto(p_session bigint, p_per int default 1, p_keep boolean default false) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare e ec_sessions; ds record; rm record; k int; t uuid; made int := 0; miss int := 0;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  if p_per not between 1 and 3 then raise exception 'عدد الملاحظين للجنة بين 1 و 3'; end if;
  select * into e from ec_sessions where id = p_session;
  if not p_keep then delete from ec_invig where session_id = p_session; end if;
  drop table if exists _pool;
  -- معلمو مراحل الفترة أولًا، ثم بقية معلمي المدرسة عند الحاجة
  create temp table _pool on commit drop as
    select p.id teacher_id, bool_or(g.stage_id = any (e.stage_ids)) own from profiles p join teaching_assignments ta on ta.teacher_id = p.id
      join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
     where p.active and p.role in ('teacher','staff') group by p.id;
  for ds in select distinct day, slot from ec_exams where session_id = p_session order by day, slot loop
    for rm in select r.id from ec_rooms r where r.session_id = p_session
                and exists (select 1 from ec_seats s join students st on st.profile_id = s.student_id join ec_exams x on x.session_id = p_session and x.day = ds.day and x.slot = ds.slot and x.grade_id = st.grade_id
                             where s.room_id = r.id) order by r.no loop
      for k in (select count(*) + 1 from ec_invig where room_id = rm.id and day = ds.day and slot = ds.slot)..p_per loop
        select pl.teacher_id into t from _pool pl
         where not exists (select 1 from ec_invig i where i.session_id = p_session and i.day = ds.day and i.slot = ds.slot and i.teacher_id = pl.teacher_id)
           and not exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id
                            join ec_exams x on x.session_id = p_session and x.day = ds.day and x.slot = ds.slot and x.grade_id = c.grade_id and x.subject_id = ta.subject_id
                            join ec_seats s on s.room_id = rm.id join students st on st.profile_id = s.student_id and st.grade_id = c.grade_id
                           where ta.teacher_id = pl.teacher_id)
         order by pl.own desc, (select count(*) from ec_invig i where i.session_id = p_session and i.teacher_id = pl.teacher_id),
                  (select count(*) from ec_invig i where i.session_id = p_session and i.teacher_id = pl.teacher_id and i.day = ds.day), random()
         limit 1;
        if t is null then miss := miss + 1;
        else insert into ec_invig(session_id, day, slot, room_id, teacher_id) values (p_session, ds.day, ds.slot, rm.id, t); made := made + 1; end if;
      end loop;
    end loop;
  end loop;
  return jsonb_build_object('assigned', made, 'missing', miss);
end $$;

-- تغيير ملاحظ يدويًا (p_teacher null = حذف)
create or replace function public.ec_invig_set(p_id bigint, p_teacher uuid) returns void
language plpgsql security definer set search_path = public, private as $$
declare i ec_invig;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  select * into i from ec_invig where id = p_id;
  if p_teacher is null then delete from ec_invig where id = p_id; return; end if;
  if exists (select 1 from ec_invig where session_id = i.session_id and day = i.day and slot = i.slot and teacher_id = p_teacher and id <> p_id) then
    raise exception 'هذا المعلم مكلّف بلجنة أخرى في نفس الفترة'; end if;
  update ec_invig set teacher_id = p_teacher where id = p_id;
end $$;

create or replace function public.ec_invig_add(p_session bigint, p_day date, p_slot smallint, p_room bigint, p_teacher uuid) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  insert into ec_invig(session_id, day, slot, room_id, teacher_id) values (p_session, p_day, p_slot, p_room, p_teacher);
exception when unique_violation then raise exception 'هذا المعلم مكلّف بلجنة أخرى في نفس الفترة';
end $$;

-- المعلمون المتاحون للملاحظة في فترة
create or replace function public.ec_invig_free(p_session bigint, p_day date, p_slot smallint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare e ec_sessions;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  select * into e from ec_sessions where id = p_session;
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.full_name, 'n', x.n, 'own', x.own) order by x.own desc, x.n, x.full_name) from (
      select p.id, p.full_name, (select count(*) from ec_invig i where i.session_id = p_session and i.teacher_id = p.id) n,
             bool_or(g.stage_id = any (e.stage_ids)) own
        from profiles p join teaching_assignments ta on ta.teacher_id = p.id join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
       where p.active and p.role in ('teacher','staff')
         and not exists (select 1 from ec_invig i where i.session_id = p_session and i.day = p_day and i.slot = p_slot and i.teacher_id = p.id)
       group by p.id, p.full_name) x), '[]'::jsonb);
end $$;

-- ---------- النشر والإشعار ----------
create or replace function public.ec_publish(p_session bigint, p_on boolean, p_notify boolean default true) returns int
language plpgsql security definer set search_path = public, private as $$
declare e ec_sessions; t record; mid bigint; n int := 0;
begin
  if not private.ec_manager() then raise exception 'غير مصرح'; end if;
  update ec_sessions set published = p_on where id = p_session returning * into e;
  if p_on and p_notify then
    for t in select i.teacher_id, string_agg(to_char(i.day, 'YYYY/MM/DD') || ' — ' || private.ec_slot_label(i.slot) || ' — ' || coalesce(r.name, 'لجنة ' || r.no) ||
                    coalesce(' (' || r.location || ')', ''), E'\n' order by i.day, i.slot) txt
               from ec_invig i join ec_rooms r on r.id = i.room_id where i.session_id = p_session group by 1 loop
      insert into messages(kind, sender_id, subject, body, audience)
      values ('mail', public.me_id(), left('📋 جدول الملاحظة: ' || e.title, 200),
              'جدول ملاحظتك في ' || e.title || ':' || E'\n' || t.txt || E'\n\nتجده أيضًا في المنصة ← لجان الاختبارات ← ملاحظتي', 'لجان الاختبارات')
      returning id into mid;
      insert into message_recipients(message_id, profile_id) values (mid, t.teacher_id) on conflict do nothing;
      n := n + 1;
    end loop;
  end if;
  return n;
end $$;

-- ---------- ما يخصّني: ملاحظتي (معلم) / رقم جلوسي وجدولي (طالب) ----------
create or replace function private.ec_student_info(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('session', e.title, 'seat', s.seat_no, 'room', coalesce(r.name, 'لجنة ' || r.no), 'location', r.location,
           'schedule', coalesce((select jsonb_agg(jsonb_build_object('day', x.day, 'slot', private.ec_slot_label(x.slot), 'start', to_char(x.start_time, 'HH24:MI'),
                         'duration', x.duration_min, 'subject', (select name_ar from subjects where id = x.subject_id)) order by x.day, x.slot)
                         from ec_exams x where x.session_id = e.id and x.grade_id = st.grade_id), '[]'::jsonb)) order by e.created_at desc), '[]'::jsonb)
    from ec_seats s join ec_sessions e on e.id = s.session_id and e.published join ec_rooms r on r.id = s.room_id
    join students st on st.profile_id = s.student_id
   where s.student_id = p_student and coalesce(e.ends_on, current_date) >= current_date - 7
$$;

create or replace function public.ec_mine() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if public.me_role() = 'student' then return jsonb_build_object('student', private.ec_student_info(public.me_id())); end if;
  return jsonb_build_object('manager', private.ec_manager(),
    'invig', coalesce((select jsonb_agg(jsonb_build_object('session', e.title, 'day', i.day, 'slot', private.ec_slot_label(i.slot),
              'room', coalesce(r.name, 'لجنة ' || r.no), 'location', r.location,
              'start', (select to_char(min(x.start_time), 'HH24:MI') from ec_exams x where x.session_id = e.id and x.day = i.day and x.slot = i.slot),
              'seated', (select count(*) from ec_seats s where s.room_id = r.id)) order by i.day, i.slot)
      from ec_invig i join ec_sessions e on e.id = i.session_id and e.published join ec_rooms r on r.id = i.room_id
     where i.teacher_id = public.me_id() and i.day >= current_date - 1), '[]'::jsonb));
end $$;

revoke all on function private.ec_manager(), private.ec_slot_label(smallint), private.ec_students(bigint), private.ec_student_info(uuid) from public, anon, authenticated;
revoke all on function public.ec_sessions_list(), public.ec_session_save(jsonb), public.ec_session_delete(bigint), public.ec_get(bigint),
  public.ec_room_save(jsonb), public.ec_rooms_bulk(bigint, int, int, text), public.ec_room_delete(bigint), public.ec_exam_save(jsonb), public.ec_exam_delete(bigint),
  public.ec_seat_auto(bigint, text), public.ec_seats_list(bigint, bigint), public.ec_invig_auto(bigint, int, boolean), public.ec_invig_set(bigint, uuid),
  public.ec_invig_add(bigint, date, smallint, bigint, uuid), public.ec_invig_free(bigint, date, smallint), public.ec_publish(bigint, boolean, boolean), public.ec_mine() from public, anon;
grant execute on function public.ec_sessions_list(), public.ec_session_save(jsonb), public.ec_session_delete(bigint), public.ec_get(bigint),
  public.ec_room_save(jsonb), public.ec_rooms_bulk(bigint, int, int, text), public.ec_room_delete(bigint), public.ec_exam_save(jsonb), public.ec_exam_delete(bigint),
  public.ec_seat_auto(bigint, text), public.ec_seats_list(bigint, bigint), public.ec_invig_auto(bigint, int, boolean), public.ec_invig_set(bigint, uuid),
  public.ec_invig_add(bigint, date, smallint, bigint, uuid), public.ec_invig_free(bigint, date, smallint), public.ec_publish(bigint, boolean, boolean), public.ec_mine() to authenticated;
