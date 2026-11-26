-- ============================================================
-- 63) حصص الانتظار (تغطية حصص المعلم الغائب)
-- الوكيل/الإدارة يسجّل غياب المعلم ← تُولَّد حصصه من الجدول المدرسي
-- ← يرشّح النظام المعلمين المتاحين ← يُسنِد يدويًا أو تلقائيًا ← يصل إشعار للمعلم البديل.
-- ============================================================

create table if not exists public.sub_absences (
  id          bigserial primary key,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  periods     smallint[],                  -- null = اليوم كاملًا
  reason      text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (teacher_id, day)
);

create table if not exists public.sub_assignments (
  id          bigserial primary key,
  absence_id  bigint not null references public.sub_absences(id) on delete cascade,
  day         date not null,
  period      smallint not null,
  class_id    integer references public.classes(id) on delete set null,
  cls         text,
  subject_id  integer,
  absent_id   uuid not null references public.profiles(id) on delete cascade,
  sub_id      uuid references public.profiles(id) on delete set null,
  status      text not null default 'open' check (status in ('open','assigned')),
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz,
  note        text,
  unique (absence_id, period, cls)
);
create index if not exists sub_asg_day_idx on public.sub_assignments(day, period);
create index if not exists sub_asg_sub_idx on public.sub_assignments(sub_id, day);

alter table public.sub_absences enable row level security;
alter table public.sub_assignments enable row level security;
revoke all on public.sub_absences, public.sub_assignments from anon, authenticated;

-- من يدير حصص الانتظار: الإدارة ومديرو المراحل والوكلاء
create or replace function private.sub_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership','principal') or coalesce(p.job_title,'') ~ '(وكيل|وكيلة)'))
$$;

create or replace function private.sub_max_day() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'max_per_day')::int from app_settings where key = 'substitutes'), 2)
$$;

-- حصص المعلم في يوم من أيام الأسبوع (بدون تكرار بين جداول المشرفين)
create or replace function private.sub_slots(p_teacher uuid, p_dow int)
returns table(period smallint, class_id int, cls text, subject_id int)
language sql stable security definer set search_path = public as $$
  select distinct on (t.period, coalesce(t.cls, t.class_id::text)) t.period, t.class_id, t.cls, t.subject_id
  from v_timetable t
  where t.teacher_id = p_teacher and t.day = p_dow and t.kind = 'class'
  order by t.period, coalesce(t.cls, t.class_id::text), t.subject_id nulls last
$$;

create or replace function private.sub_notify(p_to uuid, p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
  if p_to is null then return; end if;
  insert into messages(kind, sender_id, subject, body, audience)
  values ('mail', public.me_id(), left(p_subject, 200), p_body, 'حصص الانتظار') returning id into mid;
  insert into message_recipients(message_id, profile_id) values (mid, p_to) on conflict do nothing;
end $$;

create or replace function private.sub_day_name(d date) returns text
language sql immutable as $$
  select (array['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from d)::int + 1] || ' ' || to_char(d, 'YYYY/MM/DD')
$$;

create or replace function private.sub_asg_text(a public.sub_assignments) returns text
language sql stable security definer set search_path = public as $$
  select 'الحصة ' || a.period || ' — ' || coalesce(a.cls, '') ||
         coalesce(' (' || (select name_ar from subjects where id = a.subject_id) || ')', '') ||
         ' — ' || private.sub_day_name(a.day) ||
         E'\nبدلًا من: ' || coalesce((select full_name from profiles where id = a.absent_id), '')
$$;

-- قائمة المعلمين الذين لهم حصص في هذا اليوم (لاختيار الغائب)
create or replace function public.sub_teachers(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare dw int := extract(dow from p_day)::int;
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title, 'n', x.n) order by p.full_name)
    from (select teacher_id, count(distinct period) n from v_timetable where day = dw and kind = 'class' and teacher_id is not null group by 1) x
    join profiles p on p.id = x.teacher_id and p.active), '[]'::jsonb);
end $$;

-- تسجيل/تعديل غياب معلم وتوليد حصصه
create or replace function public.sub_absent_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t uuid := (p->>'teacher_id')::uuid; d date := (p->>'day')::date; per smallint[]; ab sub_absences; s record; a sub_assignments; n int := 0;
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  if t is null or d is null then raise exception 'اختر المعلم واليوم'; end if;
  if extract(dow from d) in (5, 6) then raise exception 'هذا اليوم عطلة نهاية الأسبوع'; end if;
  if jsonb_typeof(p->'periods') = 'array' and jsonb_array_length(p->'periods') > 0 then
    select array_agg(distinct x::smallint order by x::smallint) into per from jsonb_array_elements_text(p->'periods') x;
  end if;
  insert into sub_absences(teacher_id, day, periods, reason, created_by)
  values (t, d, per, nullif(btrim(p->>'reason'), ''), public.me_id())
  on conflict (teacher_id, day) do update set periods = excluded.periods, reason = excluded.reason
  returning * into ab;
  -- حصص لم تعد ضمن فترة الغياب: تُحذف ويُبلَّغ البديل إن وُجد
  for a in select * from sub_assignments where absence_id = ab.id and per is not null and not (period = any (per)) loop
    if a.sub_id is not null then
      perform private.sub_notify(a.sub_id, 'إلغاء حصة انتظار', 'أُلغي تكليفك بحصة الانتظار التالية:' || E'\n' || private.sub_asg_text(a));
    end if;
    delete from sub_assignments where id = a.id;
  end loop;
  for s in select * from private.sub_slots(t, extract(dow from d)::int) where per is null or period = any (per) loop
    insert into sub_assignments(absence_id, day, period, class_id, cls, subject_id, absent_id)
    values (ab.id, d, s.period, s.class_id, coalesce(s.cls, ''), s.subject_id, t)
    on conflict (absence_id, period, cls) do nothing;
    n := n + 1;
  end loop;
  return jsonb_build_object('id', ab.id, 'slots', n);
end $$;

create or replace function public.sub_absent_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare a sub_assignments;
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  for a in select * from sub_assignments where absence_id = p_id and sub_id is not null and day >= current_date loop
    perform private.sub_notify(a.sub_id, 'إلغاء حصة انتظار', 'أُلغي تكليفك بحصة الانتظار التالية (عاد المعلم):' || E'\n' || private.sub_asg_text(a));
  end loop;
  delete from sub_absences where id = p_id;
end $$;

-- المرشحون لتغطية حصة: غير مشغولين في الحصة، ليسوا غائبين، لهم حصص في نفس اليوم، ولم يتجاوزوا الحد اليومي
create or replace function private.sub_rank(p_day date, p_period smallint, p_class int)
returns table(teacher_id uuid, name text, same_class boolean, same_stage boolean, today_subs int, month_subs int, today_periods int)
language sql stable security definer set search_path = public as $$
  with dw as (select extract(dow from p_day)::int d),
  st as (select g.stage_id from classes c join grades g on g.id = c.grade_id where c.id = p_class),
  day_t as (select v.teacher_id, count(distinct v.period)::int n
            from v_timetable v, dw where v.day = dw.d and v.kind = 'class' and v.teacher_id is not null group by 1),
  busy as (select v.teacher_id from v_timetable v, dw where v.day = dw.d and v.period = p_period and v.kind = 'class' and v.teacher_id is not null
           union select sub_id from sub_assignments where day = p_day and period = p_period and sub_id is not null),
  absent as (select b.teacher_id from sub_absences b where b.day = p_day and (b.periods is null or p_period = any (b.periods))),
  subs as (select sub_id, count(*) filter (where day = p_day)::int td,
                  count(*) filter (where date_trunc('month', day) = date_trunc('month', p_day))::int md
           from sub_assignments where sub_id is not null and day >= date_trunc('month', p_day)::date - 1 group by 1)
  select t.teacher_id, p.full_name,
         exists (select 1 from v_timetable v where v.teacher_id = t.teacher_id and v.class_id = p_class) as same_class,
         exists (select 1 from v_timetable v join classes c on c.id = v.class_id join grades g on g.id = c.grade_id
                  where v.teacher_id = t.teacher_id and g.stage_id = (select stage_id from st)) as same_stage,
         coalesce(s.td, 0), coalesce(s.md, 0), t.n
  from day_t t
  join profiles p on p.id = t.teacher_id and p.active
  left join subs s on s.sub_id = t.teacher_id
  where t.teacher_id not in (select teacher_id from busy where teacher_id is not null)
    and t.teacher_id not in (select teacher_id from absent)
    and coalesce(s.td, 0) < private.sub_max_day()
$$;

create or replace function public.sub_candidates(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare a sub_assignments;
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  select * into a from sub_assignments where id = p_id;
  if a.id is null then raise exception 'الحصة غير موجودة'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.same_class desc, r.same_stage desc, r.today_subs, r.month_subs, r.today_periods, r.name)
    from (select * from private.sub_rank(a.day, a.period, a.class_id) where teacher_id is distinct from a.sub_id
          order by same_class desc, same_stage desc, today_subs, month_subs, today_periods, name limit 25) r), '[]'::jsonb);
end $$;

create or replace function private.sub_do_assign(p_id bigint, p_sub uuid, p_note text) returns void
language plpgsql security definer set search_path = public, private as $$
declare a sub_assignments;
begin
  select * into a from sub_assignments where id = p_id for update;
  if a.id is null then raise exception 'الحصة غير موجودة'; end if;
  if a.sub_id is not distinct from p_sub then return; end if;
  if p_sub is not null and not exists (select 1 from private.sub_rank(a.day, a.period, a.class_id) where teacher_id = p_sub) then
    raise exception 'هذا المعلم غير متاح في هذه الحصة (مشغول أو غائب أو تجاوز الحد اليومي)';
  end if;
  if a.sub_id is not null then
    perform private.sub_notify(a.sub_id, 'إلغاء حصة انتظار', 'أُلغي تكليفك بحصة الانتظار التالية:' || E'\n' || private.sub_asg_text(a));
  end if;
  update sub_assignments set sub_id = p_sub, status = case when p_sub is null then 'open' else 'assigned' end,
         assigned_by = public.me_id(), assigned_at = now(), note = coalesce(nullif(btrim(p_note), ''), note)
   where id = p_id returning * into a;
  if p_sub is not null then
    perform private.sub_notify(p_sub, '⏱️ حصة انتظار: الحصة ' || a.period || ' — ' || coalesce(a.cls, ''),
      'كُلّفت بحصة انتظار:' || E'\n' || private.sub_asg_text(a) || coalesce(E'\nملاحظة: ' || a.note, '') ||
      E'\n\nتجدها في المنصة ← حصص الانتظار ← حصصي');
  end if;
end $$;

create or replace function public.sub_assign(p_id bigint, p_sub uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  perform private.sub_do_assign(p_id, p_sub, p_note);
end $$;

-- إسناد تلقائي لكل الحصص المفتوحة في اليوم (أفضل مرشح لكل حصة بالترتيب)
create or replace function public.sub_auto(p_day date) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a sub_assignments; c uuid; ok int := 0; miss int := 0;
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  for a in select * from sub_assignments where day = p_day and status = 'open' order by period, cls loop
    select teacher_id into c from private.sub_rank(a.day, a.period, a.class_id)
     order by same_class desc, same_stage desc, today_subs, month_subs, today_periods, name limit 1;
    if c is null then miss := miss + 1; else perform private.sub_do_assign(a.id, c, null); ok := ok + 1; end if;
  end loop;
  return jsonb_build_object('assigned', ok, 'unfilled', miss);
end $$;

-- لوحة اليوم
create or replace function public.sub_day(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'day', p_day, 'max', private.sub_max_day(),
    'absences', coalesce((select jsonb_agg(jsonb_build_object(
        'id', b.id, 'teacher_id', b.teacher_id, 'name', p.full_name, 'periods', b.periods, 'reason', b.reason,
        'by', (select full_name from profiles where id = b.created_by),
        'slots', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'period', a.period, 'cls', a.cls, 'class_id', a.class_id,
                    'subject', (select name_ar from subjects where id = a.subject_id), 'status', a.status, 'sub_id', a.sub_id,
                    'sub', (select full_name from profiles where id = a.sub_id), 'note', a.note) order by a.period, a.cls)
                  from sub_assignments a where a.absence_id = b.id), '[]'::jsonb)) order by p.full_name)
      from sub_absences b join profiles p on p.id = b.teacher_id where b.day = p_day), '[]'::jsonb));
end $$;

-- حصصي (للمعلم البديل)
create or replace function public.sub_mine() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'period', a.period, 'cls', a.cls,
           'subject', (select name_ar from subjects where id = a.subject_id),
           'absent', (select full_name from profiles where id = a.absent_id), 'note', a.note) order by a.day, a.period), '[]'::jsonb)
  from sub_assignments a where a.sub_id = public.me_id() and a.day >= current_date - 7
$$;

-- إحصاءات فترة: من غطّى أكثر، ومن غاب أكثر
create or replace function public.sub_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'slots', (select count(*) from sub_assignments where day between p_from and p_to),
    'covered', (select count(*) from sub_assignments where day between p_from and p_to and status = 'assigned'),
    'absences', (select count(*) from sub_absences where day between p_from and p_to),
    'subs', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'n', x.n) order by x.n desc, p.full_name)
       from (select sub_id, count(*) n from sub_assignments where day between p_from and p_to and sub_id is not null group by 1) x
       join profiles p on p.id = x.sub_id), '[]'::jsonb),
    'absent', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'days', x.d, 'periods', x.n) order by x.d desc, p.full_name)
       from (select b.teacher_id, count(distinct b.day) d, (select count(*) from sub_assignments a where a.absence_id = any (array_agg(b.id))) n
               from sub_absences b where b.day between p_from and p_to group by 1) x
       join profiles p on p.id = x.teacher_id), '[]'::jsonb));
end $$;

create or replace function public.sub_settings_set(p_max int) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.sub_manager() then raise exception 'غير مصرح'; end if;
  if p_max not between 1 and 6 then raise exception 'الحد بين 1 و 6'; end if;
  insert into app_settings(key, value) values ('substitutes', jsonb_build_object('max_per_day', p_max))
  on conflict (key) do update set value = coalesce(app_settings.value, '{}'::jsonb) || excluded.value;
end $$;

create or replace function public.sub_am_manager() returns boolean
language sql stable security definer set search_path = public, private as $$ select private.sub_manager() $$;

revoke all on function private.sub_manager(), private.sub_max_day(), private.sub_slots(uuid, int), private.sub_notify(uuid, text, text),
  private.sub_asg_text(public.sub_assignments), private.sub_rank(date, smallint, int), private.sub_do_assign(bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.sub_teachers(date), public.sub_absent_set(jsonb), public.sub_absent_delete(bigint), public.sub_candidates(bigint),
  public.sub_assign(bigint, uuid, text), public.sub_auto(date), public.sub_day(date), public.sub_mine(), public.sub_stats(date, date),
  public.sub_settings_set(int), public.sub_am_manager() from public, anon;
grant execute on function public.sub_teachers(date), public.sub_absent_set(jsonb), public.sub_absent_delete(bigint), public.sub_candidates(bigint),
  public.sub_assign(bigint, uuid, text), public.sub_auto(date), public.sub_day(date), public.sub_mine(), public.sub_stats(date, date),
  public.sub_settings_set(int), public.sub_am_manager() to authenticated;

-- «مهامي»: حصص الانتظار
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
  return out;
end $$;
