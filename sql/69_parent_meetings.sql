-- ============================================================
-- 69) لقاءات أولياء الأمور: المعلم يفتح مواعيد، وولي الأمر يحجز من بوابته
-- ============================================================

create table if not exists public.mt_slots (
  id           bigserial primary key,
  teacher_id   uuid not null references public.profiles(id) on delete cascade,
  starts_at    timestamptz not null,
  duration_min smallint not null default 15 check (duration_min between 5 and 120),
  mode         text not null default 'in_person' check (mode in ('in_person','online','phone')),
  location     text,
  status       text not null default 'open' check (status in ('open','booked','cancelled','done')),
  guardian_id  uuid references public.guardians(id) on delete set null,
  student_id   uuid references public.profiles(id) on delete set null,
  topic        text,
  booked_at    timestamptz,
  outcome      text,
  created_at   timestamptz not null default now(),
  unique (teacher_id, starts_at)
);
create index if not exists mt_slots_t on public.mt_slots(teacher_id, starts_at);
create index if not exists mt_slots_g on public.mt_slots(guardian_id);
alter table public.mt_slots enable row level security;
revoke all on public.mt_slots from anon, authenticated;

create or replace function private.mt_json(s public.mt_slots, p_private boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'starts_at', s.starts_at, 'day', (s.starts_at at time zone 'Asia/Riyadh')::date,
    'time', to_char(s.starts_at at time zone 'Asia/Riyadh', 'HH24:MI'), 'duration', s.duration_min, 'mode', s.mode, 'location', s.location, 'status', s.status)
  || case when p_private then jsonb_build_object('guardian', (select name from guardians where id = s.guardian_id),
       'phone', (select phone from guardians where id = s.guardian_id), 'student', (select full_name from profiles where id = s.student_id),
       'class', (select vc.label from students st join v_classes vc on vc.id = st.class_id where st.profile_id = s.student_id),
       'topic', s.topic, 'outcome', s.outcome) else '{}'::jsonb end
$$;

-- ---------- المعلم / المنسوب ----------
create or replace function public.mt_mine(p_past boolean default false) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(private.mt_json(s, true) order by s.starts_at), '[]'::jsonb)
    from mt_slots s where s.teacher_id = public.me_id() and public.is_staff()
     and (case when p_past then s.starts_at < now() - interval '1 hour' else s.starts_at >= now() - interval '1 hour' end)
     and s.status <> 'cancelled'
$$;

-- توليد مواعيد: يوم + من ساعة إلى ساعة + مدة كل لقاء
create or replace function public.mt_slots_add(p jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare d date := (p->>'day')::date; t0 time := (p->>'from')::time; t1 time := (p->>'to')::time; du int := coalesce(nullif(p->>'duration', '')::int, 15);
        t time; n int := 0; ts timestamptz;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if d is null or t0 is null or t1 is null or t1 <= t0 then raise exception 'حدّد اليوم ووقت البداية والنهاية'; end if;
  if d < current_date then raise exception 'لا يمكن فتح مواعيد في يوم مضى'; end if;
  t := t0;
  while t + make_interval(mins => du) <= t1 loop
    ts := (d + t) at time zone 'Asia/Riyadh';
    insert into mt_slots(teacher_id, starts_at, duration_min, mode, location)
    values (public.me_id(), ts, du, coalesce(nullif(p->>'mode', ''), 'in_person'), nullif(btrim(p->>'location'), ''))
    on conflict (teacher_id, starts_at) do nothing;
    if found then n := n + 1; end if;
    t := t + make_interval(mins => du);
    exit when n > 60;
  end loop;
  return n;
end $$;

create or replace function public.mt_slot_cancel(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare s mt_slots;
begin
  select * into s from mt_slots where id = p_id and teacher_id = public.me_id();
  if s.id is null then raise exception 'غير مصرح'; end if;
  if s.status = 'open' then delete from mt_slots where id = p_id;
  else update mt_slots set status = 'cancelled' where id = p_id; end if;   -- يظهر لولي الأمر أن الموعد أُلغي
end $$;

create or replace function public.mt_slot_done(p_id bigint, p_outcome text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  update mt_slots set status = 'done', outcome = nullif(btrim(p_outcome), '') where id = p_id and teacher_id = public.me_id() and status in ('booked','done');
  if not found then raise exception 'غير مصرح'; end if;
end $$;

-- ---------- ولي الأمر ----------
-- المسموح بالحجز معهم: معلمو فصول الأبناء، رائد الفصل، والموجّه ومدير المرحلة
create or replace function private.mt_staff_for(p_guardian uuid) returns table(teacher_id uuid, student_id uuid, why text)
language sql stable security definer set search_path = public, private as $$
  select distinct ta.teacher_id, gs.student_id, sb.name_ar
    from guardian_students gs join students s on s.profile_id = gs.student_id join teaching_assignments ta on ta.class_id = s.class_id
    join subjects sb on sb.id = ta.subject_id where gs.guardian_id = p_guardian
  union
  select c.homeroom_teacher_id, gs.student_id, 'رائد الفصل'
    from guardian_students gs join students s on s.profile_id = gs.student_id join classes c on c.id = s.class_id
   where gs.guardian_id = p_guardian and c.homeroom_teacher_id is not null
  union
  select r, gs.student_id, coalesce((select job_title from profiles where id = r), 'الإدارة')
    from guardian_students gs cross join lateral unnest(private.bh_responsible(gs.student_id)) r where gs.guardian_id = p_guardian
$$;

create or replace function public.pp_meet_staff(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', x.teacher_id, 'name', p.full_name, 'student_id', x.student_id,
            'student', (select full_name from profiles where id = x.student_id), 'why', x.whys,
            'open', (select count(*) from mt_slots m where m.teacher_id = x.teacher_id and m.status = 'open' and m.starts_at > now())) order by p.full_name)
    from (select teacher_id, student_id, string_agg(distinct why, '، ') whys from private.mt_staff_for(s.guardian_id) group by 1, 2) x
    join profiles p on p.id = x.teacher_id and p.active), '[]'::jsonb);
end $$;

create or replace function public.pp_meet_slots(p_token text, p_teacher uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  if not exists (select 1 from private.mt_staff_for(s.guardian_id) where teacher_id = p_teacher) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.mt_json(m, false) order by m.starts_at) from mt_slots m
                    where m.teacher_id = p_teacher and m.status = 'open' and m.starts_at > now() + interval '30 minutes'), '[]'::jsonb);
end $$;

create or replace function public.pp_meet_book(p_token text, p_slot bigint, p_student uuid, p_topic text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); m mt_slots; mid bigint;
begin
  select * into m from mt_slots where id = p_slot for update;
  if m.id is null or m.status <> 'open' or m.starts_at <= now() then raise exception 'الموعد لم يعد متاحًا، اختر موعدًا آخر'; end if;
  if not exists (select 1 from private.mt_staff_for(s.guardian_id) where teacher_id = m.teacher_id and student_id = p_student) then raise exception 'غير مصرح'; end if;
  if exists (select 1 from mt_slots where teacher_id = m.teacher_id and guardian_id = s.guardian_id and status = 'booked' and starts_at > now()) then
    raise exception 'لديك موعد قائم مع هذا المعلم — ألغِه أولًا إن أردت تغييره'; end if;
  update mt_slots set status = 'booked', guardian_id = s.guardian_id, student_id = p_student, topic = nullif(left(btrim(p_topic), 500), ''), booked_at = now() where id = p_slot;
  insert into messages(kind, sender_id, subject, body, audience)
  values ('mail', null, left('🤝 حجز لقاء ولي أمر: ' || (select full_name from profiles where id = p_student), 200),
          'حجز ولي الأمر ' || coalesce((select name from guardians where id = s.guardian_id), '') || ' لقاءً معك.' ||
          E'\nالطالب: ' || (select full_name from profiles where id = p_student) ||
          E'\nالموعد: ' || to_char(m.starts_at at time zone 'Asia/Riyadh', 'YYYY/MM/DD HH24:MI') || ' (' || m.duration_min || ' دقيقة)' ||
          coalesce(E'\nالموضوع: ' || nullif(btrim(p_topic), ''), '') || E'\n\nالمنصة ← لقاءات أولياء الأمور', 'لقاءات أولياء الأمور') returning id into mid;
  insert into message_recipients(message_id, profile_id) values (mid, m.teacher_id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pp_meet_mine(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  return coalesce((select jsonb_agg(private.mt_json(m, false) || jsonb_build_object('teacher', (select full_name from profiles where id = m.teacher_id),
            'student', (select full_name from profiles where id = m.student_id), 'topic', m.topic) order by m.starts_at)
    from mt_slots m where m.guardian_id = s.guardian_id and m.starts_at > now() - interval '1 day' and m.status in ('booked','cancelled')), '[]'::jsonb);
end $$;

create or replace function public.pp_meet_cancel(p_token text, p_slot bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); m mt_slots; mid bigint;
begin
  select * into m from mt_slots where id = p_slot and guardian_id = s.guardian_id and status = 'booked';
  if m.id is null then raise exception 'غير موجود'; end if;
  update mt_slots set status = 'open', guardian_id = null, student_id = null, topic = null, booked_at = null where id = p_slot;
  insert into messages(kind, sender_id, subject, body, audience)
  values ('mail', null, 'إلغاء حجز لقاء ولي أمر', 'ألغى ولي الأمر حجز موعد ' || to_char(m.starts_at at time zone 'Asia/Riyadh', 'YYYY/MM/DD HH24:MI') || ' وأصبح متاحًا من جديد.', 'لقاءات أولياء الأمور') returning id into mid;
  insert into message_recipients(message_id, profile_id) values (mid, m.teacher_id) on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.mt_json(public.mt_slots, boolean), private.mt_staff_for(uuid) from public, anon, authenticated;
revoke all on function public.mt_mine(boolean), public.mt_slots_add(jsonb), public.mt_slot_cancel(bigint), public.mt_slot_done(bigint, text),
  public.pp_meet_staff(text), public.pp_meet_slots(text, uuid), public.pp_meet_book(text, bigint, uuid, text), public.pp_meet_mine(text), public.pp_meet_cancel(text, bigint) from public, anon;
grant execute on function public.mt_mine(boolean), public.mt_slots_add(jsonb), public.mt_slot_cancel(bigint), public.mt_slot_done(bigint, text),
  public.pp_meet_staff(text), public.pp_meet_slots(text, uuid), public.pp_meet_book(text, bigint, uuid, text), public.pp_meet_mine(text), public.pp_meet_cancel(text, bigint) to authenticated;
