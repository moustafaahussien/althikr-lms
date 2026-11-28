-- ============================================================
-- 83) النوادي المدرسية: مشرف الأنشطة + المدرب + أيام التدريب الأسبوعية (تظهر في التقويم الشخصي)
--     + اختيار الطلاب بالاسم أو من الفصل + الحضور اليومي (حاضر/متأخر/غائب/مستأذن)
-- ============================================================
alter table public.cb_clubs add column if not exists activity_sup_id uuid references public.profiles(id) on delete set null;   -- مشرف الأنشطة
alter table public.cb_clubs add column if not exists coach_id uuid references public.profiles(id) on delete set null;          -- المدرب (من المنسوبين)
alter table public.cb_clubs add column if not exists coach_name text;                                                         -- أو مدرب من خارج المدرسة
alter table public.cb_clubs add column if not exists coach_phone text;
alter table public.cb_clubs add column if not exists train_days smallint[] not null default '{}';                            -- 0 = الأحد … 6 = السبت
alter table public.cb_clubs add column if not exists time_from text;
alter table public.cb_clubs add column if not exists time_to text;
alter table public.cb_clubs add column if not exists starts_on date;
alter table public.cb_clubs add column if not exists ends_on date;

create table if not exists public.cb_att (
  session_id bigint not null references public.cb_sessions(id) on delete cascade,
  student_id uuid not null references public.students(profile_id) on delete cascade,
  status     text not null check (status in ('present','late','absent','excused')),
  at         timestamptz not null default now(),
  primary key (session_id, student_id)
);
alter table public.cb_att enable row level security;
revoke all on public.cb_att from anon, authenticated;
create unique index if not exists cb_sessions_day on public.cb_sessions(club_id, day);

-- ترحيل الحضور القديم (مصفوفة الغياب) إلى الجدول الجديد
insert into cb_att(session_id, student_id, status)
  select s.id, m.student_id, case when m.student_id = any (s.absent) then 'absent' else 'present' end
  from cb_sessions s join cb_members m on m.club_id = s.club_id and m.status = 'active' and (m.joined_at at time zone 'Asia/Riyadh')::date <= s.day
  where not exists (select 1 from cb_att a where a.session_id = s.id)
on conflict do nothing;

-- صلاحية إدارة النادي: رائد النشاط/الإدارة، المشرف، المشرفون المساعدون، مشرف الأنشطة، المدرب
create or replace function private.cb_can(c cb_clubs) returns boolean language sql stable security definer set search_path = public, private as $$
  select private.act_mgr() or public.me_id() in (c.supervisor_id, c.activity_sup_id, c.coach_id) or public.me_id() = any (c.co_ids) $$;

create or replace function private.cb_days_label(d smallint[]) returns text language sql immutable as $$
  select string_agg((array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[x + 1], '، ' order by x) from unnest(d) x $$;

create or replace function private.cb_json(c cb_clubs) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'field', c.field, 'field_label', private.cb_field(c.field), 'description', c.description,
    'supervisor_id', c.supervisor_id, 'supervisor', (select full_name from profiles where id = c.supervisor_id), 'co_ids', c.co_ids,
    'co', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (c.co_ids)),
    'activity_sup_id', c.activity_sup_id, 'activity_sup', (select full_name from profiles where id = c.activity_sup_id),
    'coach_id', c.coach_id, 'coach', coalesce((select full_name from profiles where id = c.coach_id), c.coach_name), 'coach_name', c.coach_name, 'coach_phone', c.coach_phone,
    'train_days', c.train_days, 'days_label', private.cb_days_label(c.train_days), 'time_from', c.time_from, 'time_to', c.time_to, 'starts_on', c.starts_on, 'ends_on', c.ends_on,
    'grade_ids', c.grade_ids,
    'grades', (select coalesce(string_agg(g.name_ar || ' ' || st.name_ar, '، ' order by st.sort, g.number), 'كل الصفوف') from grades g join stages st on st.id = g.stage_id where g.id = any (c.grade_ids)),
    'capacity', c.capacity, 'schedule', c.schedule, 'place', c.place, 'join_mode', c.join_mode, 'active', c.active,
    'members', (select count(*) from cb_members m where m.club_id = c.id and m.status = 'active'),
    'pending', (select count(*) from cb_members m where m.club_id = c.id and m.status = 'pending'),
    'sessions', (select count(*) from cb_sessions s where s.club_id = c.id), 'can', private.cb_can(c),
    'today', extract(dow from (now() at time zone 'Asia/Riyadh'))::smallint = any (c.train_days),
    'today_done', exists (select 1 from cb_sessions s join cb_att a on a.session_id = s.id where s.club_id = c.id and s.day = (now() at time zone 'Asia/Riyadh')::date))
$$;

create or replace function public.cb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cid bigint := nullif(p ->> 'id', '')::bigint; c cb_clubs; m boolean := private.act_mgr();
begin
  if cid is not null then select * into c from cb_clubs where id = cid; if not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  elsif not m then raise exception 'إنشاء النوادي لرائد النشاط والإدارة'; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'اكتب اسم النادي'; end if;
  if nullif(p ->> 'time_from', '') is not null and nullif(p ->> 'time_to', '') is not null and (p ->> 'time_to') <= (p ->> 'time_from') then raise exception 'وقت نهاية التدريب قبل بدايته'; end if;
  if cid is null then insert into cb_clubs(name) values (btrim(p ->> 'name')) returning id into cid; end if;
  update cb_clubs set name = btrim(p ->> 'name'), icon = coalesce(nullif(btrim(p ->> 'icon'), ''), '⭐'), field = coalesce(nullif(p ->> 'field', ''), 'other'),
    description = nullif(btrim(p ->> 'description'), ''),
    supervisor_id = case when m then nullif(p ->> 'supervisor_id', '')::uuid else supervisor_id end,
    activity_sup_id = case when m then nullif(p ->> 'activity_sup_id', '')::uuid else activity_sup_id end,
    coach_id = case when m then nullif(p ->> 'coach_id', '')::uuid else coach_id end,
    coach_name = case when m then nullif(btrim(p ->> 'coach_name'), '') else coach_name end,
    coach_phone = case when m then nullif(btrim(p ->> 'coach_phone'), '') else coach_phone end,
    co_ids = case when m then coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'co_ids', '[]')) x), '{}') else co_ids end,
    train_days = coalesce((select array_agg(distinct x::smallint order by x::smallint) from jsonb_array_elements_text(coalesce(p -> 'train_days', '[]')) x where x ~ '^[0-6]$'), '{}'),
    time_from = nullif(btrim(p ->> 'time_from'), ''), time_to = nullif(btrim(p ->> 'time_to'), ''),
    starts_on = nullif(p ->> 'starts_on', '')::date, ends_on = nullif(p ->> 'ends_on', '')::date,
    grade_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
    capacity = nullif(p ->> 'capacity', '')::int, schedule = nullif(btrim(p ->> 'schedule'), ''), place = nullif(btrim(p ->> 'place'), ''),
    join_mode = coalesce(nullif(p ->> 'join_mode', ''), 'approval'), active = coalesce((p ->> 'active')::boolean, true) where id = cid;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

-- الأعضاء مع نسبة الحضور (حاضر + متأخر)
create or replace function public.cb_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select * into c from cb_clubs where id = p_id;
  if c.id is null or not public.is_staff() then raise exception 'غير متاح'; end if;
  return private.cb_json(c) || jsonb_build_object(
    'roster', coalesce((select jsonb_agg(private.cs_stu(m.student_id) || jsonb_build_object('status', m.status, 'role', m.role, 'joined_at', m.joined_at,
        'attended', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status in ('present','late')),
        'late', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status = 'late'),
        'absent', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status = 'absent'),
        'held', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id))
        order by m.status <> 'pending', m.role desc, (select full_name from profiles where id = m.student_id)) from cb_members m where m.club_id = c.id and m.status in ('pending','active')), '[]'),
    'sessions_list', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'topic', s.topic, 'notes', s.notes,
        'present', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'present'), 'late', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'late'),
        'absent', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'absent'), 'excused', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'excused'))
        order by s.day desc) from cb_sessions s where s.club_id = c.id), '[]'),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'title', a.title, 'details', a.details,
        'students', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (a.students))) order by a.day desc) from cb_achievements a where a.club_id = c.id), '[]'));
end $$;

-- كشف حضور يوم: يُنشئ لقاء اليوم إن لم يوجد، ويعيد الأعضاء بحالتهم
create or replace function public.cb_day(p_club bigint, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs; d date := coalesce(p_day, (now() at time zone 'Asia/Riyadh')::date); sid bigint;
begin
  select * into c from cb_clubs where id = p_club;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  if d > (now() at time zone 'Asia/Riyadh')::date then raise exception 'لا يُسجَّل حضور يوم لم يأتِ بعد'; end if;
  insert into cb_sessions(club_id, day, topic, by_id) values (c.id, d, 'تدريب', public.me_id()) on conflict (club_id, day) do nothing;
  select id into sid from cb_sessions where club_id = c.id and day = d;
  return jsonb_build_object('session_id', sid, 'day', d, 'training_day', extract(dow from d)::smallint = any (c.train_days),
    'topic', (select topic from cb_sessions where id = sid), 'notes', (select notes from cb_sessions where id = sid),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', m.student_id, 'name', p.full_name, 'class', (private.cs_stu(m.student_id) ->> 'class'), 'role', m.role,
        'status', (select a.status from cb_att a where a.session_id = sid and a.student_id = m.student_id)) order by p.full_name)
      from cb_members m join profiles p on p.id = m.student_id where m.club_id = c.id and m.status = 'active'), '[]'));
end $$;

-- p: {student_id: status|null} — تسجيل حالة طالب أو أكثر
create or replace function public.cb_att_set(p_session bigint, p jsonb, p_topic text default null, p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs; k text; v text;
begin
  select cl.* into c from cb_clubs cl join cb_sessions s on s.club_id = cl.id where s.id = p_session;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  for k, v in select * from jsonb_each_text(coalesce(p, '{}')) loop
    if v is null or v = '' then delete from cb_att where session_id = p_session and student_id = k::uuid;
    elsif v in ('present','late','absent','excused') and exists (select 1 from cb_members where club_id = c.id and student_id = k::uuid) then
      insert into cb_att(session_id, student_id, status) values (p_session, k::uuid, v) on conflict (session_id, student_id) do update set status = excluded.status, at = now();
    end if;
  end loop;
  if p_topic is not null or p_notes is not null then
    update cb_sessions set topic = coalesce(nullif(btrim(p_topic), ''), topic), notes = case when p_notes is not null then nullif(btrim(p_notes), '') else notes end where id = p_session;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cb_session_delete(p_session bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select cl.* into c from cb_clubs cl join cb_sessions s on s.club_id = cl.id where s.id = p_session;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  delete from cb_sessions where id = p_session; return jsonb_build_object('ok', true);
end $$;

-- إضافة مجموعة طلاب دفعة واحدة (اختيار بالاسم أو من الفصل)
create or replace function public.cb_members_add(p_club bigint, p_students jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs; n int;
begin
  select * into c from cb_clubs where id = p_club;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  insert into cb_members(club_id, student_id, status) select p_club, x::uuid, 'active' from jsonb_array_elements_text(p_students) x
    where exists (select 1 from students where profile_id = x::uuid)
  on conflict (club_id, student_id) do update set status = 'active', joined_at = case when cb_members.status <> 'active' then now() else cb_members.joined_at end;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'added', n);
end $$;

-- طلاب فصل (للاختيار بالاسم)
create or replace function public.cs_class_students(p_class int) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then coalesce((select jsonb_agg(jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number) order by p.full_name)
    from students s join profiles p on p.id = s.profile_id and p.active where s.class_id = p_class), '[]'::jsonb) end
$$;

-- مواعيد تدريب النوادي بين تاريخين (للتقويم)
create or replace function private.cb_dates(p_from date, p_to date, p_me uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('src', 'club', 'kind', 'club', 'title', c.icon || ' تدريب ' || c.name || coalesce(' ' || c.time_from || coalesce('–' || c.time_to, ''), ''),
           'date', d::date, 'note', concat_ws(' · ', nullif(c.place, ''), 'المدرب: ' || coalesce((select full_name from profiles where id = c.coach_id), c.coach_name)), 'link', 'clubs.html') order by d), '[]')
  from cb_clubs c, generate_series(greatest(p_from, coalesce(c.starts_on, p_from)), least(p_to, coalesce(c.ends_on, p_to)), interval '1 day') d
  where c.active and cardinality(c.train_days) > 0 and extract(dow from d)::smallint = any (c.train_days)
    and (p_me in (c.supervisor_id, c.activity_sup_id, c.coach_id) or p_me = any (c.co_ids)
         or exists (select 1 from cb_members m where m.club_id = c.id and m.status = 'active'
                     and (m.student_id = p_me or m.student_id in (select student_id from parent_links where parent_id = p_me))))
$$;

-- مهام: كشف حضور تدريب اليوم لم يُسجَّل
create or replace function private.cb_tasks() returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare n int; me uuid := public.me_id(); d date := (now() at time zone 'Asia/Riyadh')::date;
begin
  select count(*) into n from cb_clubs c where c.active and extract(dow from d)::smallint = any (c.train_days)
    and (me in (c.supervisor_id, c.activity_sup_id, c.coach_id) or me = any (c.co_ids))
    and not exists (select 1 from cb_sessions s join cb_att a on a.session_id = s.id where s.club_id = c.id and s.day = d);
  if n > 0 then return jsonb_build_array(jsonb_build_object('icon', '⭐', 'text', n || ' تدريب نادٍ اليوم — سجّل الحضور', 'link', 'clubs.html')); end if;
  return '[]'::jsonb;
end $$;

-- خدمات الطالب: النوادي مع أيام التدريب
create or replace function private.cs_child(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'transport', private.tr_info(p_student),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'icon', c.icon, 'status', m.status, 'schedule', c.schedule, 'place', c.place,
                'supervisor', (select full_name from profiles where id = c.supervisor_id),
                'days', private.cb_days_label(c.train_days), 'train_days', c.train_days, 'time_from', c.time_from, 'time_to', c.time_to, 'ends_on', c.ends_on,
                'coach', coalesce((select full_name from profiles where id = c.coach_id), c.coach_name),
                'attended', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = p_student and a.status in ('present','late')),
                'held', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = p_student))), '[]')
              from cb_members m join cb_clubs c on c.id = m.club_id where m.student_id = p_student and m.status in ('active','pending')),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'kind', private.ac_kind(a.kind), 'day', a.day, 'role', s.role, 'note', s.note) order by a.day desc), '[]')
              from ac_students s join ac_activities a on a.id = s.activity_id where s.student_id = p_student and a.status <> 'cancelled' and a.day > current_date - 365),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'destination', t.destination, 'purpose', t.purpose, 'day', t.day,
                'depart_time', t.depart_time, 'return_time', t.return_time, 'cost', t.cost, 'transport', t.transport, 'consent_by', t.consent_by, 'status', t.status,
                'consent', x.consent, 'paid', x.paid, 'attended', x.attended, 'organizer', (select full_name from profiles where id = t.organizer_id)) order by t.day desc), '[]')
              from tp_people x join tp_trips t on t.id = x.trip_id where x.student_id = p_student and t.status in ('approved','done') and t.day > current_date - 120),
    'uniform', (select coalesce(jsonb_agg(private.un_order_json(o) order by o.created_at desc), '[]') from un_orders o where o.student_id = p_student and o.created_at > now() - interval '365 days'),
    'books', private.tb_child(p_student),
    'transport_request', (select jsonb_build_object('status', q.status, 'reply', q.reply, 'created_at', q.created_at) from tr_requests q where q.student_id = p_student order by q.created_at desc limit 1))
$$;


-- التقويم: + مواعيد تدريب النوادي
create or replace function public.cal_feed(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := public.me_role()::text; my_stages int[];
begin
  if me is null then raise exception 'غير مصرح'; end if;
  if p_to - p_from > 100 then raise exception 'الفترة طويلة'; end if;
  my_stages := array(select distinct g.stage_id from students s join grades g on g.id = s.grade_id
                      where s.profile_id = me or s.profile_id in (select student_id from parent_links where parent_id = me));
  return jsonb_build_object('manager', private.cal_manager(), 'items',
    coalesce((select jsonb_agg(x order by x->>'date') from (
      select jsonb_build_object('src', 'event', 'id', e.id, 'kind', e.kind, 'title', e.title, 'date', e.start_date, 'end', e.end_date, 'note', e.note,
               'stage', (select name_ar from stages where id = e.stage_id), 'audience', e.audience, 'stage_id', e.stage_id,
               'can_edit', public.is_admin() or r = 'leadership' or e.created_by = me) x
        from sc_events e
       where coalesce(e.end_date, e.start_date) >= p_from and e.start_date <= p_to
         and (r = 'admin' or r = any (e.audience)) and (e.stage_id is null or r not in ('student','parent') or e.stage_id = any (my_stages))
      union all
      select jsonb_build_object('src', 'lab', 'kind', 'booking', 'title', l.icon || ' ' || l.name || ': ' || b.title, 'date', b.day, 'period', b.period, 'status', b.status, 'link', 'labs.html?lab=' || l.code)
        from lab_bookings b join labs l on l.id = b.lab_id
       where r not in ('student','parent') and b.teacher_id = me and b.day between p_from and p_to and b.status in ('pending','prepared','done')

      union all
      select jsonb_build_object('src', 'exam', 'kind', 'exam', 'title', '🧪 ' || x.title, 'date', (x.opens_at at time zone 'Asia/Riyadh')::date, 'link', 'exams.html')
        from ex_exams x where x.teacher_id = me and (x.opens_at at time zone 'Asia/Riyadh')::date between p_from and p_to
      union all
      select jsonb_build_object('src', 'hw', 'kind', 'deadline', 'title', '📝 تسليم: ' || h.title, 'date', (h.due_at at time zone 'Asia/Riyadh')::date, 'link', 'homework.html')
        from hw_assignments h where h.teacher_id = me and (h.due_at at time zone 'Asia/Riyadh')::date between p_from and p_to
      union all
      select x from jsonb_array_elements(private.cb_dates(p_from, p_to, me)) x
    ) q), '[]'::jsonb));
end $$;

-- المهام اليومية: نسخة 82 + النوادي
create or replace function public.my_tasks() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := public.me_role()::text; out jsonb := '[]'::jsonb; n int;
begin
  if me is null or r in ('student','parent') then return '[]'::jsonb; end if;
  -- إحالات سلوكية مفتوحة (للموجّه والإدارة)
  if private.bh_manager() then
    select count(*) into n from bh_notes where refer and ref_status = 'open' and private.bh_can(student_id);
    if n > 0 then out := out || jsonb_build_object('icon', '📨', 'text', n || ' إحالة سلوكية مفتوحة', 'link', 'behavior.html#ref'); end if;
  end if;
  -- مبادرات بانتظار اعتمادي
  select count(*) into n from in_initiatives where status = 'pending' and private.in_reviewer(owner_id);
  if n > 0 then out := out || jsonb_build_object('icon', '💡', 'text', n || ' مبادرة بانتظار اعتمادك', 'link', 'initiatives.html#review'); end if;
  -- مبادراتي المعتمدة التي لم يُسجَّل أثرها
  select count(*) into n from in_initiatives where owner_id = me and status = 'approved' and (plan_date is null or plan_date <= current_date);
  if n > 0 then out := out || jsonb_build_object('icon', '✅', 'text', n || ' مبادرة معتمدة — سجّل أثرها بعد التنفيذ', 'link', 'initiatives.html#mine'); end if;
  -- مبادراتي المعادة بملاحظات
  select count(*) into n from in_initiatives where owner_id = me and status = 'returned';
  if n > 0 then out := out || jsonb_build_object('icon', '↩️', 'text', n || ' مبادرة أُعيدت لك بملاحظات', 'link', 'initiatives.html#mine'); end if;
  -- حجوزاتي في المختبرات/المرافق اليوم وغدًا
  select count(*) into n from lab_bookings where teacher_id = me and day between current_date and current_date + 1 and status in ('pending','prepared');
  if n > 0 then out := out || jsonb_build_object('icon', '🔬', 'text', n || ' حجز لك في المختبرات/المرافق اليوم أو غدًا', 'link', 'calendar.html'); end if;
  -- أحداث المدرسة اليوم
  select count(*) into n from sc_events e where current_date between e.start_date and coalesce(e.end_date, e.start_date) and (r = 'admin' or r = any (e.audience));
  if n > 0 then out := out || jsonb_build_object('icon', '📅', 'text', n || ' حدث في تقويم المدرسة اليوم', 'link', 'calendar.html'); end if;
  -- حصص انتظار مكلّف بها اليوم أو غدًا
  select count(*) into n from sub_assignments where sub_id = me and day between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '⏱️', 'text', n || ' حصة انتظار مكلّف بها اليوم أو غدًا', 'link', 'substitutes.html#mine'); end if;
  -- حصص انتظار لم تُسند بعد (للوكيل والإدارة)
  if private.sub_manager() then
    select count(*) into n from sub_assignments where status = 'open' and day between current_date and current_date + 1;
    if n > 0 then out := out || jsonb_build_object('icon', '🧩', 'text', n || ' حصة انتظار لم تُسند بعد', 'link', 'substitutes.html'); end if;
  end if;
  -- حالات إنذار مبكر مسندة إليّ
  select count(*) into n from ew_cases where owner_id = me and status <> 'closed';
  if n > 0 then out := out || jsonb_build_object('icon', '⚠️', 'text', n || ' حالة إنذار مبكر تتابعها', 'link', 'early-warning.html#mine'); end if;
  -- استبيانات بانتظار مشاركتي
  select count(*) into n from srv_surveys v where private.srv_for_me(v) and not exists (select 1 from srv_responses r where r.survey_id = v.id and r.profile_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' استبيان بانتظار مشاركتك', 'link', 'surveys.html'); end if;
  -- لقاءات أولياء أمور محجوزة اليوم أو غدًا
  select count(*) into n from mt_slots where teacher_id = me and status = 'booked' and (starts_at at time zone 'Asia/Riyadh')::date between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '🤝', 'text', n || ' لقاء ولي أمر محجوز اليوم أو غدًا', 'link', 'meetings.html'); end if;
  -- أسئلة طلاب بانتظار ردي
  select count(*) into n from ds_threads t where t.kind in ('question','private') and not t.answered and not t.hidden
     and exists (select 1 from teaching_assignments ta where ta.class_id = t.class_id and ta.subject_id = t.subject_id and ta.teacher_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '❓', 'text', n || ' سؤال من الطلاب بانتظار ردك', 'link', 'discussions.html'); end if;
  -- كتب مكتبة متأخرة عندي
  select count(*) into n from bk_loans where borrower_id = me and returned_at is null and due_on < current_date;
  if n > 0 then out := out || jsonb_build_object('icon', '📚', 'text', n || ' كتاب متأخر الإرجاع للمكتبة', 'link', 'books.html#my'); end if;
  -- لأمين المكتبة: الإعارات المتأخرة
  if private.bk_lib() then
    select count(*) into n from bk_loans where returned_at is null and due_on < current_date;
    if n > 0 then out := out || jsonb_build_object('icon', '⏰', 'text', n || ' إعارة متأخرة في المكتبة', 'link', 'books.html#late'); end if;
  end if;
  -- التسجيل والقبول (sql/79)
  out := out || private.adm_tasks();
  -- خدمات المدرسة (sql/81)
  out := out || private.cs_tasks();
  -- المشتريات (sql/82)
  out := out || private.pt_tasks();
  -- تدريب النوادي اليوم (sql/83)
  out := out || private.cb_tasks();
  return out;
end $$;

do $$ declare f text; begin
  foreach f in array array['private.cb_can(cb_clubs)','private.cb_days_label(smallint[])','private.cb_json(cb_clubs)','private.cb_dates(date, date, uuid)','private.cb_tasks()','private.cs_child(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['cb_save(jsonb)','cb_get(bigint)','cb_day(bigint, date)','cb_att_set(bigint, jsonb, text, text)','cb_session_delete(bigint)','cb_members_add(bigint, jsonb)',
    'cs_class_students(int)','cal_feed(date, date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
