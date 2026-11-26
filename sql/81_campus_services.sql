-- ============================================================
-- 81) خدمات المدرسة: طلبات الصيانة · النقل المدرسي · الزي المدرسي · النوادي · الرحلات · الأنشطة
-- الأقسام المسؤولة تُحدَّد من «المسمى الوظيفي» (مثل العيادة):
--   الصيانة: صيانة/تشغيل/خدمات/مرافق · النقل: نقل/حافلات/مواصلات · الزي: زي/مستودع/مخازن/مشتريات
--   النوادي والأنشطة والرحلات: نشاط/الأنشطة/رائد (+ مديرو المراحل لاعتماد الرحلات) — والإدارة العليا ومدير النظام دائمًا.
-- ============================================================

-- ---------- مساعدات مشتركة ----------
create or replace function private.cs_job(p_re text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership') or coalesce(p.job_title,'') ~ p_re))
$$;
create or replace function private.cs_people(p_re text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from profiles p where p.active and p.role <> 'admin' and coalesce(p.job_title,'') ~ p_re
$$;
create or replace function private.cs_notify(p_to uuid[], p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint; tos uuid[];
begin
  select array_agg(distinct x) into tos from unnest(p_to) x where x is not null and x is distinct from public.me_id();
  if tos is null or cardinality(tos) = 0 then return; end if;
  insert into messages(sender_id, subject, body, kind) values (public.me_id(), left(p_subject, 200), coalesce(p_body, ''), 'mail') returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, x from unnest(tos) x on conflict do nothing;
end $$;
create or replace function private.cs_stu(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number, 'class', vc.label, 'class_id', s.class_id,
         'grade_id', coalesce(vc.grade_id, s.grade_id), 'stage_id', g.stage_id, 'section_id', st.section_id)
  from students s join profiles p on p.id = s.profile_id left join v_classes vc on vc.id = s.class_id
  left join grades g on g.id = coalesce(vc.grade_id, s.grade_id) left join stages st on st.id = g.stage_id where s.profile_id = p_id
$$;
-- بحث عن طالب (للموظفين)
create or replace function public.cs_student_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q text := public.norm(nullif(btrim(coalesce(p_q, '')), ''));
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  if q is null or length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(private.cs_stu(s.profile_id) order by p.full_name) from (select s.profile_id from students s join profiles p on p.id = s.profile_id and p.active
     where public.norm(p.full_name) like '%' || q || '%' or s.student_number = btrim(p_q) order by p.full_name limit 25) s join profiles p on p.id = s.profile_id), '[]'::jsonb);
end $$;
-- قوائم مشتركة: الصفوف والفصول والأقسام والموظفون
create or replace function public.cs_lists() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_staff() then jsonb_build_object(
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar, 'stage_id', st.id, 'section_id', st.section_id) order by se.sort, st.sort, g.number), '[]')
               from grades g join stages st on st.id = g.stage_id join sections se on se.id = st.section_id),
    'classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.label, 'grade_id', c.grade_id) order by c.section_id, c.stage_sort, c.grade_number, c.name), '[]') from v_classes c where c.active),
    'sections', (select coalesce(jsonb_agg(jsonb_build_object('id', se.id, 'name', se.name_ar) order by se.sort), '[]') from sections se),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', st.id, 'name', st.name_ar) order by st.sort), '[]') from stages st),
    'staff', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title, 'role', p.role) order by p.full_name), '[]')
              from profiles p where p.active and p.role in ('admin','leadership','principal','supervisor','teacher','staff'))) else '{}'::jsonb end
$$;

-- ============================================================
-- 1) طلبات الصيانة
-- ============================================================
create table if not exists public.mn_requests (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  category    text not null default 'other' check (category in ('electric','plumbing','ac','carpentry','it','cleaning','furniture','safety','other')),
  location    text not null check (btrim(location) <> ''),
  priority    text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  details     text,
  requester_id uuid references public.profiles(id) on delete set null,
  status      text not null default 'new' check (status in ('new','assigned','in_progress','waiting','done','rejected','cancelled')),
  assignee_id uuid references public.profiles(id) on delete set null,
  due_on      date,
  resolution  text,
  cost        numeric(10,2),
  rating      smallint check (rating between 1 and 5),
  rating_note text,
  done_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists mn_req_status on public.mn_requests(status, created_at desc);
create table if not exists public.mn_updates (
  id      bigserial primary key,
  req_id  bigint not null references public.mn_requests(id) on delete cascade,
  by_id   uuid references public.profiles(id) on delete set null,
  status  text,
  note    text,
  at      timestamptz not null default now()
);
create index if not exists mn_upd_req on public.mn_updates(req_id, at);
alter table public.mn_requests enable row level security; alter table public.mn_updates enable row level security;
revoke all on public.mn_requests, public.mn_updates from anon, authenticated;

create or replace function private.mn_mgr() returns boolean language sql stable security definer set search_path = public, private as $$
  select private.cs_job('(صيانة|تشغيل|الخدمات|خدمات مساندة|مرافق|المرافق|شؤون إدارية|الشؤون الإدارية)') $$;
create or replace function private.mn_label(t text, v text) returns text language sql immutable as $$
  select case t
    when 'cat' then case v when 'electric' then 'كهرباء' when 'plumbing' then 'سباكة' when 'ac' then 'تكييف' when 'carpentry' then 'نجارة وأبواب'
      when 'it' then 'أجهزة وشبكات' when 'cleaning' then 'نظافة' when 'furniture' then 'أثاث' when 'safety' then 'أمن وسلامة' else 'أخرى' end
    when 'st' then case v when 'new' then 'جديد' when 'assigned' then 'مسند لفني' when 'in_progress' then 'قيد التنفيذ' when 'waiting' then 'بانتظار قطع/مورد'
      when 'done' then 'منجز' when 'rejected' then 'مرفوض' when 'cancelled' then 'ملغى' else v end
    when 'pr' then case v when 'low' then 'منخفضة' when 'normal' then 'عادية' when 'high' then 'عالية' when 'urgent' then 'عاجلة' else v end end
$$;

create or replace function public.mn_me() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('mgr', private.mn_mgr(), 'staff', public.is_staff(),
    'locations', coalesce((select value -> 'locations' from app_settings where key = 'maintenance'), '[]'::jsonb),
    'techs', case when private.mn_mgr() then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title) order by p.full_name), '[]')
       from profiles p where p.active and p.role in ('staff','teacher','supervisor','leadership','principal') and coalesce(p.job_title,'') ~ '(صيان|فني|كهرب|سباك|نجار|تكييف|تشغيل|عامل|خدمات|شبكات|تقنية)') end)
$$;

create or replace function private.mn_row(r mn_requests) returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(r) || jsonb_build_object('category_label', private.mn_label('cat', r.category), 'status_label', private.mn_label('st', r.status),
    'priority_label', private.mn_label('pr', r.priority), 'requester', (select full_name from profiles where id = r.requester_id),
    'assignee', (select full_name from profiles where id = r.assignee_id), 'mine', r.requester_id = public.me_id(), 'assigned_me', r.assignee_id = public.me_id(),
    'age_days', (current_date - (r.created_at at time zone 'Asia/Riyadh')::date))
$$;

create or replace function public.mn_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v text := coalesce(p ->> 'view', 'mine'); m boolean := private.mn_mgr();
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  return coalesce((select jsonb_agg(private.mn_row(r) order by case r.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, r.created_at desc) from mn_requests r
    where case v when 'mine' then r.requester_id = public.me_id() when 'assigned' then r.assignee_id = public.me_id() else m end
      and (nullif(p ->> 'status', '') is null or (p ->> 'status' = 'open' and r.status not in ('done','rejected','cancelled')) or r.status = p ->> 'status')
      and (nullif(p ->> 'category', '') is null or r.category = p ->> 'category')
      and (nullif(btrim(p ->> 'q'), '') is null or public.norm(r.title || ' ' || r.location || ' ' || coalesce(r.details, '')) like '%' || public.norm(p ->> 'q') || '%')
    limit 500), '[]'::jsonb);
end $$;

create or replace function public.mn_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r mn_requests;
begin
  select * into r from mn_requests where id = p_id;
  if r.id is null or not (private.mn_mgr() or r.requester_id = public.me_id() or r.assignee_id = public.me_id()) then raise exception 'غير متاح'; end if;
  return private.mn_row(r) || jsonb_build_object('updates', coalesce((select jsonb_agg(jsonb_build_object('at', u.at, 'by', (select full_name from profiles where id = u.by_id),
     'status', private.mn_label('st', u.status), 'note', u.note) order by u.at) from mn_updates u where u.req_id = r.id), '[]'));
end $$;

create or replace function public.mn_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare nid bigint; r mn_requests;
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  insert into mn_requests(title, category, location, priority, details, requester_id)
  values (btrim(p ->> 'title'), coalesce(nullif(p ->> 'category', ''), 'other'), btrim(p ->> 'location'), coalesce(nullif(p ->> 'priority', ''), 'normal'),
          nullif(btrim(p ->> 'details'), ''), public.me_id()) returning * into r;
  insert into mn_updates(req_id, by_id, status, note) values (r.id, public.me_id(), 'new', 'إنشاء الطلب');
  perform private.cs_notify(private.cs_people('(صيانة|تشغيل|الخدمات|مرافق|المرافق|شؤون إدارية|الشؤون الإدارية)') ||
     case when r.priority = 'urgent' then (select coalesce(array_agg(id), '{}') from profiles where active and role = 'leadership') else '{}'::uuid[] end,
    case when r.priority = 'urgent' then '🚨 طلب صيانة عاجل: ' else '🛠️ طلب صيانة جديد: ' end || r.title,
    'الموقع: ' || r.location || E'\nالتصنيف: ' || private.mn_label('cat', r.category) || E'\nالأولوية: ' || private.mn_label('pr', r.priority) ||
    coalesce(E'\n' || r.details, '') || E'\n\nمن: ' || (select full_name from profiles where id = public.me_id()) || E'\nافتح: طلبات الصيانة.');
  return jsonb_build_object('ok', true, 'id', r.id);
end $$;

-- تحديث الطلب: المسؤول (إسناد/أولوية/حالة)، الفني المسند (حالة وملاحظة)، مقدم الطلب (إلغاء طلب جديد)
create or replace function public.mn_update(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r mn_requests; m boolean := private.mn_mgr(); st text := nullif(p ->> 'status', ''); note text := nullif(btrim(p ->> 'note'), ''); asg uuid;
begin
  select * into r from mn_requests where id = p_id for update;
  if r.id is null then raise exception 'غير موجود'; end if;
  if m then
    asg := case when p ? 'assignee_id' then nullif(p ->> 'assignee_id', '')::uuid else r.assignee_id end;
    if st is null and asg is distinct from r.assignee_id and asg is not null and r.status = 'new' then st := 'assigned'; end if;
    if st = 'rejected' and note is null then raise exception 'اذكر سبب الرفض'; end if;
    update mn_requests set assignee_id = asg, priority = coalesce(nullif(p ->> 'priority', ''), priority), status = coalesce(st, status),
      due_on = case when p ? 'due_on' then nullif(p ->> 'due_on', '')::date else due_on end,
      resolution = coalesce(case when st = 'done' then note end, resolution), cost = case when p ? 'cost' then nullif(p ->> 'cost', '')::numeric else cost end,
      done_at = case when st = 'done' then now() when st is not null then null else done_at end, updated_at = now() where id = p_id;
    if asg is distinct from r.assignee_id and asg is not null then
      perform private.cs_notify(array[asg], '🛠️ أُسند إليك طلب صيانة: ' || r.title, 'الموقع: ' || r.location || E'\nالأولوية: ' || private.mn_label('pr', coalesce(nullif(p ->> 'priority', ''), r.priority)) ||
        coalesce(E'\n' || r.details, '') || E'\n\nحدّث حالته من: طلبات الصيانة ← المسندة إليّ.');
    end if;
  elsif r.assignee_id = public.me_id() then
    if st is null or st not in ('in_progress','waiting','done') then raise exception 'حالة غير مسموحة'; end if;
    update mn_requests set status = st, resolution = coalesce(case when st = 'done' then note end, resolution), done_at = case when st = 'done' then now() end,
      cost = case when p ? 'cost' then nullif(p ->> 'cost', '')::numeric else cost end, updated_at = now() where id = p_id;
  elsif r.requester_id = public.me_id() then
    if st is distinct from 'cancelled' or r.status <> 'new' then raise exception 'يمكنك إلغاء الطلب قبل إسناده فقط'; end if;
    update mn_requests set status = 'cancelled', updated_at = now() where id = p_id;
  else raise exception 'ليس لديك صلاحية';
  end if;
  insert into mn_updates(req_id, by_id, status, note) values (p_id, public.me_id(), st, coalesce(note, case when asg is distinct from r.assignee_id then 'إسناد إلى ' || (select full_name from profiles where id = asg) end));
  if st in ('done','rejected') then
    perform private.cs_notify(array[r.requester_id], case when st = 'done' then '✅ تم تنفيذ طلب الصيانة: ' else '⛔ رُفض طلب الصيانة: ' end || r.title,
      coalesce(note, '') || case when st = 'done' then E'\n\nقيّم الخدمة من: طلبات الصيانة ← طلباتي.' else '' end);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mn_rate(p_id bigint, p_stars int, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  update mn_requests set rating = greatest(1, least(5, p_stars)), rating_note = nullif(btrim(p_note), '') where id = p_id and requester_id = public.me_id() and status = 'done';
  if not found then raise exception 'التقييم لمقدم الطلب بعد التنفيذ'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.mn_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.mn_mgr() then raise exception 'لقسم الصيانة والإدارة'; end if;
  return (with b as (select * from mn_requests where (created_at at time zone 'Asia/Riyadh')::date between p_from and p_to)
  select jsonb_build_object('total', (select count(*) from b), 'open', (select count(*) from b where status not in ('done','rejected','cancelled')),
    'done', (select count(*) from b where status = 'done'), 'urgent_open', (select count(*) from b where priority = 'urgent' and status not in ('done','rejected','cancelled')),
    'avg_hours', (select round(avg(extract(epoch from done_at - created_at) / 3600)::numeric, 1) from b where status = 'done'),
    'rating', (select round(avg(rating)::numeric, 1) from b where rating is not null), 'cost', (select coalesce(sum(cost), 0) from b),
    'by_cat', (select coalesce(jsonb_agg(jsonb_build_object('label', private.mn_label('cat', category), 'n', n, 'open', o) order by n desc), '[]')
               from (select category, count(*) n, count(*) filter (where status not in ('done','rejected','cancelled')) o from b group by category) z),
    'by_loc', (select coalesce(jsonb_agg(jsonb_build_object('label', location, 'n', n) order by n desc), '[]') from (select location, count(*) n from b group by location order by 2 desc limit 15) z),
    'by_tech', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce((select full_name from profiles where id = assignee_id), 'غير مسند'), 'n', n, 'done', d, 'rating', rt) order by n desc), '[]')
                from (select assignee_id, count(*) n, count(*) filter (where status = 'done') d, round(avg(rating)::numeric, 1) rt from b group by assignee_id) z)));
end $$;

create or replace function public.mn_settings_set(p_locations jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.mn_mgr() then raise exception 'لقسم الصيانة والإدارة'; end if;
  insert into app_settings(key, value) values ('maintenance', jsonb_build_object('locations',
    coalesce((select jsonb_agg(distinct btrim(x)) from jsonb_array_elements_text(p_locations) x where btrim(x) <> ''), '[]'::jsonb)))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 2) النقل المدرسي
-- ============================================================
create table if not exists public.tr_routes (
  id            bigserial primary key,
  name          text not null check (btrim(name) <> ''),
  area          text,
  bus_no        text,
  plate         text,
  capacity      int,
  driver_name   text,
  driver_phone  text,
  supervisor_id uuid references public.profiles(id) on delete set null,
  am_time       text,
  pm_time       text,
  notes         text,
  active        boolean not null default true
);
create table if not exists public.tr_stops (
  id       bigserial primary key,
  route_id bigint not null references public.tr_routes(id) on delete cascade,
  name     text not null,
  seq      int not null default 0,
  am_time  text,
  pm_time  text
);
create table if not exists public.tr_riders (
  student_id uuid primary key references public.students(profile_id) on delete cascade,
  route_id   bigint not null references public.tr_routes(id) on delete cascade,
  stop_id    bigint references public.tr_stops(id) on delete set null,
  mode       text not null default 'both' check (mode in ('both','am','pm')),
  address    text,
  since      date not null default current_date,
  notes      text
);
create table if not exists public.tr_trips (
  id        bigserial primary key,
  route_id  bigint not null references public.tr_routes(id) on delete cascade,
  day       date not null,
  shift     text not null check (shift in ('am','pm')),
  closed_at timestamptz,
  by_id     uuid references public.profiles(id) on delete set null,
  unique (route_id, day, shift)
);
create table if not exists public.tr_boarding (
  trip_id    bigint not null references public.tr_trips(id) on delete cascade,
  student_id uuid not null references public.students(profile_id) on delete cascade,
  status     text not null check (status in ('boarded','absent','arrived')),
  at         timestamptz not null default now(),
  primary key (trip_id, student_id)
);
create table if not exists public.tr_requests (
  id          bigserial primary key,
  student_id  uuid not null references public.students(profile_id) on delete cascade,
  guardian_id uuid,
  address     text not null,
  mode        text not null default 'both' check (mode in ('both','am','pm')),
  notes       text,
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  reply       text,
  created_at  timestamptz not null default now()
);
alter table public.tr_routes enable row level security; alter table public.tr_stops enable row level security; alter table public.tr_riders enable row level security;
alter table public.tr_trips enable row level security; alter table public.tr_boarding enable row level security; alter table public.tr_requests enable row level security;
revoke all on public.tr_routes, public.tr_stops, public.tr_riders, public.tr_trips, public.tr_boarding, public.tr_requests from anon, authenticated;

create or replace function private.tr_mgr() returns boolean language sql stable security definer set search_path = public, private as $$
  select private.cs_job('(النقل|نقل|حافلات|الحافلات|مواصلات|باصات)') $$;
create or replace function private.tr_can_route(p_route bigint) returns boolean language sql stable security definer set search_path = public, private as $$
  select private.tr_mgr() or exists (select 1 from tr_routes where id = p_route and supervisor_id = public.me_id()) $$;
create or replace function private.tr_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Riyadh')::date $$;

create or replace function public.tr_me() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('mgr', private.tr_mgr(),
    'routes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'area', r.area, 'bus_no', r.bus_no, 'plate', r.plate, 'capacity', r.capacity,
        'driver_name', r.driver_name, 'driver_phone', r.driver_phone, 'supervisor_id', r.supervisor_id, 'supervisor', (select full_name from profiles where id = r.supervisor_id),
        'am_time', r.am_time, 'pm_time', r.pm_time, 'notes', r.notes, 'active', r.active,
        'riders', (select count(*) from tr_riders x where x.route_id = r.id),
        'stops', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'seq', s.seq, 'am_time', s.am_time, 'pm_time', s.pm_time) order by s.seq, s.id) from tr_stops s where s.route_id = r.id), '[]'))
        order by r.active desc, r.name) from tr_routes r where private.tr_mgr() or r.supervisor_id = public.me_id()), '[]'),
    'requests', case when private.tr_mgr() then (select count(*) from tr_requests where status = 'pending') end)
$$;

create or replace function public.tr_route_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare rid bigint := nullif(p ->> 'id', '')::bigint; s jsonb; keep bigint[] := '{}'; sid bigint; i int := 0;
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'اكتب اسم المسار'; end if;
  if rid is null then
    insert into tr_routes(name) values (btrim(p ->> 'name')) returning id into rid;
  end if;
  update tr_routes set name = btrim(p ->> 'name'), area = nullif(btrim(p ->> 'area'), ''), bus_no = nullif(btrim(p ->> 'bus_no'), ''), plate = nullif(btrim(p ->> 'plate'), ''),
    capacity = nullif(p ->> 'capacity', '')::int, driver_name = nullif(btrim(p ->> 'driver_name'), ''), driver_phone = nullif(btrim(p ->> 'driver_phone'), ''),
    supervisor_id = nullif(p ->> 'supervisor_id', '')::uuid, am_time = nullif(btrim(p ->> 'am_time'), ''), pm_time = nullif(btrim(p ->> 'pm_time'), ''),
    notes = nullif(btrim(p ->> 'notes'), ''), active = coalesce((p ->> 'active')::boolean, true) where id = rid;
  for s in select * from jsonb_array_elements(coalesce(p -> 'stops', '[]')) loop
    continue when btrim(coalesce(s ->> 'name', '')) = '';
    i := i + 1; sid := nullif(s ->> 'id', '')::bigint;
    if sid is not null and exists (select 1 from tr_stops where id = sid and route_id = rid) then
      update tr_stops set name = btrim(s ->> 'name'), seq = i, am_time = nullif(btrim(s ->> 'am_time'), ''), pm_time = nullif(btrim(s ->> 'pm_time'), '') where id = sid;
    else insert into tr_stops(route_id, name, seq, am_time, pm_time) values (rid, btrim(s ->> 'name'), i, nullif(btrim(s ->> 'am_time'), ''), nullif(btrim(s ->> 'pm_time'), '')) returning id into sid;
    end if;
    keep := keep || sid;
  end loop;
  delete from tr_stops where route_id = rid and not (id = any (keep));
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create or replace function public.tr_route_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  if exists (select 1 from tr_riders where route_id = p_id) then raise exception 'انقل طلاب المسار أولًا أو أوقف المسار بدل حذفه'; end if;
  delete from tr_routes where id = p_id; return jsonb_build_object('ok', true);
end $$;

create or replace function public.tr_riders(p_route bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tr_can_route(p_route) then raise exception 'ليس لديك صلاحية على هذا المسار'; end if;
  return coalesce((select jsonb_agg(private.cs_stu(x.student_id) || jsonb_build_object('stop_id', x.stop_id, 'stop', (select name from tr_stops where id = x.stop_id),
      'mode', x.mode, 'address', x.address, 'notes', x.notes, 'since', x.since,
      'guardian_phone', (select s.guardian_phone from students s where s.profile_id = x.student_id))
      order by (select seq from tr_stops where id = x.stop_id) nulls last, (select full_name from profiles where id = x.student_id)) from tr_riders x where x.route_id = p_route), '[]'::jsonb);
end $$;

create or replace function public.tr_rider_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare rid bigint := (p ->> 'route_id')::bigint; n int; cap int;
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  if coalesce((p ->> 'remove')::boolean, false) then delete from tr_riders where student_id = (p ->> 'student_id')::uuid; return jsonb_build_object('ok', true); end if;
  select capacity into cap from tr_routes where id = rid;
  select count(*) into n from tr_riders where route_id = rid and student_id <> (p ->> 'student_id')::uuid;
  if cap is not null and n >= cap and not coalesce((p ->> 'force')::boolean, false) then raise exception 'الحافلة ممتلئة (% من %) — زِد السعة أو اختر مسارًا آخر', n, cap; end if;
  insert into tr_riders(student_id, route_id, stop_id, mode, address, notes)
  values ((p ->> 'student_id')::uuid, rid, nullif(p ->> 'stop_id', '')::bigint, coalesce(nullif(p ->> 'mode', ''), 'both'), nullif(btrim(p ->> 'address'), ''), nullif(btrim(p ->> 'notes'), ''))
  on conflict (student_id) do update set route_id = excluded.route_id, stop_id = excluded.stop_id, mode = excluded.mode, address = excluded.address, notes = excluded.notes;
  return jsonb_build_object('ok', true);
end $$;

-- كشف رحلة اليوم (صباحية/مسائية) لمشرف الحافلة
create or replace function public.tr_run(p_route bigint, p_shift text, p_day date default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare d date := coalesce(p_day, private.tr_today()); t tr_trips;
begin
  if not private.tr_can_route(p_route) then raise exception 'ليس لديك صلاحية على هذا المسار'; end if;
  insert into tr_trips(route_id, day, shift, by_id) values (p_route, d, p_shift, public.me_id()) on conflict (route_id, day, shift) do nothing;
  select * into t from tr_trips where route_id = p_route and day = d and shift = p_shift;
  return jsonb_build_object('trip_id', t.id, 'day', d, 'shift', p_shift, 'closed_at', t.closed_at,
    'riders', coalesce((select jsonb_agg(private.cs_stu(x.student_id) || jsonb_build_object('stop', s.name, 'stop_time', case when p_shift = 'am' then s.am_time else s.pm_time end,
        'status', b.status, 'at', b.at, 'guardian_phone', (select st.guardian_phone from students st where st.profile_id = x.student_id))
        order by case when p_shift = 'am' then s.seq else -s.seq end nulls last, (select full_name from profiles where id = x.student_id))
      from tr_riders x left join tr_stops s on s.id = x.stop_id left join tr_boarding b on b.trip_id = t.id and b.student_id = x.student_id
      where x.route_id = p_route and (x.mode = 'both' or x.mode = p_shift)), '[]'));
end $$;

create or replace function public.tr_mark(p_trip bigint, p_student uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tr_trips;
begin
  select * into t from tr_trips where id = p_trip;
  if t.id is null or not private.tr_can_route(t.route_id) then raise exception 'ليس لديك صلاحية'; end if;
  if p_status is null or p_status = '' then delete from tr_boarding where trip_id = p_trip and student_id = p_student;
  else insert into tr_boarding(trip_id, student_id, status) values (p_trip, p_student, p_status)
       on conflict (trip_id, student_id) do update set status = excluded.status, at = now(); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tr_close(p_trip bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tr_trips;
begin
  select * into t from tr_trips where id = p_trip;
  if t.id is null or not private.tr_can_route(t.route_id) then raise exception 'ليس لديك صلاحية'; end if;
  -- من لم يُرصد يُعتبر غائبًا عن الحافلة
  insert into tr_boarding(trip_id, student_id, status)
    select t.id, x.student_id, 'absent' from tr_riders x where x.route_id = t.route_id and (x.mode = 'both' or x.mode = t.shift) on conflict do nothing;
  update tr_trips set closed_at = now() where id = p_trip;
  return jsonb_build_object('ok', true);
end $$;

-- تقرير يوم لكل المسارات
create or replace function public.tr_day_report(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare d date := coalesce(p_day, private.tr_today());
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'bus_no', r.bus_no, 'supervisor', (select full_name from profiles where id = r.supervisor_id),
      'riders', (select count(*) from tr_riders x where x.route_id = r.id),
      'am', (select jsonb_build_object('closed', t.closed_at, 'boarded', count(*) filter (where b.status in ('boarded','arrived')), 'absent', count(*) filter (where b.status = 'absent'))
             from tr_trips t left join tr_boarding b on b.trip_id = t.id where t.route_id = r.id and t.day = d and t.shift = 'am' group by t.closed_at),
      'pm', (select jsonb_build_object('closed', t.closed_at, 'boarded', count(*) filter (where b.status in ('boarded','arrived')), 'absent', count(*) filter (where b.status = 'absent'))
             from tr_trips t left join tr_boarding b on b.trip_id = t.id where t.route_id = r.id and t.day = d and t.shift = 'pm' group by t.closed_at)) order by r.name)
    from tr_routes r where r.active), '[]'::jsonb);
end $$;

create or replace function public.tr_requests_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  return coalesce((select jsonb_agg(private.cs_stu(q.student_id) || jsonb_build_object('req_id', q.id, 'address', q.address, 'mode', q.mode, 'notes', q.notes, 'status', q.status,
     'reply', q.reply, 'created_at', q.created_at, 'guardian', (select g.name from guardians g where g.id = q.guardian_id), 'guardian_phone', (select g.phone from guardians g where g.id = q.guardian_id),
     'current', (select r.name from tr_riders x join tr_routes r on r.id = x.route_id where x.student_id = q.student_id)) order by q.status <> 'pending', q.created_at desc)
    from tr_requests q where q.created_at > now() - interval '180 days'), '[]'::jsonb);
end $$;

create or replace function public.tr_request_decide(p_id bigint, p_approve boolean, p_reply text, p_route bigint, p_stop bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare q tr_requests;
begin
  if not private.tr_mgr() then raise exception 'لمسؤول النقل فقط'; end if;
  select * into q from tr_requests where id = p_id for update;
  if q.id is null then raise exception 'غير موجود'; end if;
  if p_approve then
    if p_route is null then raise exception 'اختر المسار'; end if;
    perform public.tr_rider_set(jsonb_build_object('student_id', q.student_id, 'route_id', p_route, 'stop_id', p_stop, 'mode', q.mode, 'address', q.address, 'force', true));
  end if;
  update tr_requests set status = case when p_approve then 'approved' else 'rejected' end, reply = nullif(btrim(p_reply), '') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- معلومات النقل لطالب (للطالب نفسه ولبوابة ولي الأمر)
create or replace function private.tr_info(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select (select jsonb_build_object('route', r.name, 'area', r.area, 'bus_no', r.bus_no, 'plate', r.plate, 'driver_name', r.driver_name, 'driver_phone', r.driver_phone,
      'supervisor', (select full_name from profiles where id = r.supervisor_id), 'stop', s.name, 'mode', x.mode,
      'am_time', coalesce(s.am_time, r.am_time), 'pm_time', coalesce(s.pm_time, r.pm_time),
      'today_am', (select b.status from tr_trips t join tr_boarding b on b.trip_id = t.id and b.student_id = p_student where t.route_id = r.id and t.day = private.tr_today() and t.shift = 'am'),
      'today_pm', (select b.status from tr_trips t join tr_boarding b on b.trip_id = t.id and b.student_id = p_student where t.route_id = r.id and t.day = private.tr_today() and t.shift = 'pm'))
    from tr_riders x join tr_routes r on r.id = x.route_id left join tr_stops s on s.id = x.stop_id where x.student_id = p_student)
$$;

-- ============================================================
-- 3) الزي المدرسي
-- ============================================================
create table if not exists public.un_items (
  id          bigserial primary key,
  name        text not null check (btrim(name) <> ''),
  section_ids int[] not null default '{}',     -- الأقسام (بنين/بنات/دبلوم) — فارغ = الكل
  stage_ids   int[] not null default '{}',     -- المراحل — فارغ = الكل
  sizes       text[] not null default '{}',
  price       numeric(10,2) not null default 0,
  required    boolean not null default false,
  notes       text,
  active      boolean not null default true,
  sort        int not null default 0
);
create table if not exists public.un_stock (
  item_id bigint not null references public.un_items(id) on delete cascade,
  size    text not null,
  qty     int not null default 0,
  min_qty int not null default 5,
  primary key (item_id, size)
);
create table if not exists public.un_orders (
  id           bigserial primary key,
  student_id   uuid not null references public.students(profile_id) on delete cascade,
  guardian_id  uuid,
  created_by   uuid references public.profiles(id) on delete set null,
  status       text not null default 'pending' check (status in ('pending','confirmed','paid','ready','delivered','cancelled')),
  total        numeric(10,2) not null default 0,
  notes        text,
  reply        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  delivered_at timestamptz
);
create table if not exists public.un_lines (
  order_id bigint not null references public.un_orders(id) on delete cascade,
  item_id  bigint not null references public.un_items(id) on delete restrict,
  size     text not null,
  qty      int not null check (qty between 1 and 20),
  price    numeric(10,2) not null,
  primary key (order_id, item_id, size)
);
create table if not exists public.un_moves (
  id      bigserial primary key,
  item_id bigint not null references public.un_items(id) on delete cascade,
  size    text not null,
  delta   int not null,
  reason  text not null,
  ref     bigint,
  by_id   uuid references public.profiles(id) on delete set null,
  at      timestamptz not null default now()
);
alter table public.un_items enable row level security; alter table public.un_stock enable row level security; alter table public.un_orders enable row level security;
alter table public.un_lines enable row level security; alter table public.un_moves enable row level security;
revoke all on public.un_items, public.un_stock, public.un_orders, public.un_lines, public.un_moves from anon, authenticated;

create or replace function private.un_mgr() returns boolean language sql stable security definer set search_path = public, private as $$
  select private.cs_job('(الزي|زي مدرسي|مستودع|المستودع|مخازن|مخزن|المشتريات|مشتريات)') $$;
create or replace function private.un_st(v text) returns text language sql immutable as $$
  select case v when 'pending' then 'طلب جديد' when 'confirmed' then 'مؤكَّد' when 'paid' then 'مدفوع' when 'ready' then 'جاهز للاستلام'
    when 'delivered' then 'تم التسليم' when 'cancelled' then 'ملغى' else v end $$;

create or replace function private.un_items_json(p_section int, p_stage int, p_all boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'section_ids', i.section_ids, 'stage_ids', i.stage_ids, 'sizes', i.sizes, 'price', i.price,
      'required', i.required, 'notes', i.notes, 'active', i.active, 'sort', i.sort,
      'stock', (select coalesce(jsonb_object_agg(s.size, s.qty), '{}') from un_stock s where s.item_id = i.id),
      'min', (select coalesce(jsonb_object_agg(s.size, s.min_qty), '{}') from un_stock s where s.item_id = i.id)) order by i.sort, i.name), '[]')
  from un_items i where (p_all or i.active)
    and (p_section is null or cardinality(i.section_ids) = 0 or p_section = any (i.section_ids))
    and (p_stage is null or cardinality(i.stage_ids) = 0 or p_stage = any (i.stage_ids))
$$;
create or replace function private.un_order_json(o un_orders) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'status_label', private.un_st(o.status), 'total', o.total, 'notes', o.notes, 'reply', o.reply,
    'created_at', o.created_at, 'delivered_at', o.delivered_at, 'by_parent', o.guardian_id is not null,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('item_id', l.item_id, 'item', i.name, 'size', l.size, 'qty', l.qty, 'price', l.price)) from un_lines l join un_items i on i.id = l.item_id where l.order_id = o.id), '[]'))
$$;

create or replace function public.un_me() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('mgr', private.un_mgr(), 'items', case when private.un_mgr() then private.un_items_json(null, null, true) else private.un_items_json(null, null, false) end,
    'pending', case when private.un_mgr() then (select count(*) from un_orders where status = 'pending') end,
    'low', case when private.un_mgr() then (select count(*) from un_stock s join un_items i on i.id = s.item_id and i.active where s.qty <= s.min_qty) end)
$$;

create or replace function public.un_item_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare iid bigint := nullif(p ->> 'id', '')::bigint; sz text[];
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'اكتب اسم الصنف'; end if;
  sz := coalesce((select array_agg(distinct btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'sizes', '[]')) x where btrim(x) <> ''), '{}');
  if cardinality(sz) = 0 then sz := array['موحّد']; end if;
  if iid is null then insert into un_items(name) values (btrim(p ->> 'name')) returning id into iid; end if;
  update un_items set name = btrim(p ->> 'name'), sizes = sz, price = coalesce(nullif(p ->> 'price', '')::numeric, 0), required = coalesce((p ->> 'required')::boolean, false),
    section_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'section_ids', '[]')) x), '{}'),
    stage_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'stage_ids', '[]')) x), '{}'),
    notes = nullif(btrim(p ->> 'notes'), ''), active = coalesce((p ->> 'active')::boolean, true), sort = coalesce(nullif(p ->> 'sort', '')::int, 0) where id = iid;
  insert into un_stock(item_id, size) select iid, x from unnest(sz) x on conflict do nothing;
  return jsonb_build_object('ok', true, 'id', iid);
end $$;

-- تعديل المخزون: توريد أو جرد
create or replace function public.un_stock_set(p_item bigint, p_size text, p_delta int, p_min int, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  insert into un_stock(item_id, size, qty, min_qty) values (p_item, p_size, greatest(0, coalesce(p_delta, 0)), coalesce(p_min, 5))
  on conflict (item_id, size) do update set qty = greatest(0, un_stock.qty + coalesce(p_delta, 0)), min_qty = coalesce(p_min, un_stock.min_qty);
  if coalesce(p_delta, 0) <> 0 then insert into un_moves(item_id, size, delta, reason, by_id) values (p_item, p_size, p_delta, coalesce(nullif(btrim(p_reason), ''), 'توريد'), public.me_id()); end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.un_make_order(p_student uuid, p_lines jsonb, p_notes text, p_guardian uuid) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare oid bigint; l jsonb; it un_items; tot numeric := 0;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'اختر صنفًا واحدًا على الأقل'; end if;
  insert into un_orders(student_id, guardian_id, created_by, notes) values (p_student, p_guardian, case when p_guardian is null then public.me_id() end, nullif(btrim(p_notes), ''))
  returning id into oid;
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from un_items where id = (l ->> 'item_id')::bigint and active;
    if it.id is null then raise exception 'صنف غير متاح'; end if;
    if not (l ->> 'size') = any (it.sizes) then raise exception 'مقاس غير متاح للصنف %', it.name; end if;
    insert into un_lines(order_id, item_id, size, qty, price) values (oid, it.id, l ->> 'size', greatest(1, least(20, coalesce((l ->> 'qty')::int, 1))), it.price)
    on conflict (order_id, item_id, size) do update set qty = least(20, un_lines.qty + excluded.qty);
  end loop;
  update un_orders set total = (select coalesce(sum(qty * price), 0) from un_lines where order_id = oid) where id = oid;
  return oid;
end $$;

create or replace function public.un_order_create(p_student uuid, p_lines jsonb, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare oid bigint;
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  oid := private.un_make_order(p_student, p_lines, p_notes, null);
  update un_orders set status = 'confirmed' where id = oid;
  return jsonb_build_object('ok', true, 'id', oid);
end $$;

create or replace function public.un_orders_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  return coalesce((select jsonb_agg(private.un_order_json(o) || jsonb_build_object('student', private.cs_stu(o.student_id),
      'guardian', (select g.name from guardians g where g.id = o.guardian_id), 'guardian_phone', (select g.phone from guardians g where g.id = o.guardian_id)) order by o.created_at desc)
    from un_orders o where (nullif(p ->> 'status', '') is null or (p ->> 'status' = 'open' and o.status not in ('delivered','cancelled')) or o.status = p ->> 'status')
      and (nullif(btrim(p ->> 'q'), '') is null or exists (select 1 from profiles pr join students s on s.profile_id = pr.id where pr.id = o.student_id
           and (public.norm(pr.full_name) like '%' || public.norm(p ->> 'q') || '%' or s.student_number = btrim(p ->> 'q'))) or o.id::text = btrim(p ->> 'q'))
    limit 500), '[]'::jsonb);
end $$;

-- تغيير حالة الطلب — عند التسليم يُخصم المخزون (ويُمنع إن لم يكفِ)
create or replace function public.un_order_status(p_id bigint, p_status text, p_reply text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare o un_orders; l record;
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  select * into o from un_orders where id = p_id for update;
  if o.id is null then raise exception 'غير موجود'; end if;
  if o.status in ('delivered','cancelled') then raise exception 'الطلب مغلق'; end if;
  if p_status = 'delivered' then
    for l in select ln.*, i.name, coalesce(s.qty, 0) have from un_lines ln join un_items i on i.id = ln.item_id left join un_stock s on s.item_id = ln.item_id and s.size = ln.size where ln.order_id = p_id loop
      if l.have < l.qty then raise exception 'المخزون لا يكفي: % مقاس % (المتوفر %)', l.name, l.size, l.have; end if;
    end loop;
    update un_stock s set qty = s.qty - ln.qty from un_lines ln where ln.order_id = p_id and s.item_id = ln.item_id and s.size = ln.size;
    insert into un_moves(item_id, size, delta, reason, ref, by_id) select item_id, size, -qty, 'تسليم طلب', p_id, public.me_id() from un_lines where order_id = p_id;
  end if;
  update un_orders set status = p_status, reply = coalesce(nullif(btrim(p_reply), ''), reply), delivered_at = case when p_status = 'delivered' then now() end, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.un_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.un_mgr() then raise exception 'لمسؤول الزي المدرسي فقط'; end if;
  return jsonb_build_object(
    'orders', (select count(*) from un_orders where (created_at at time zone 'Asia/Riyadh')::date between p_from and p_to and status <> 'cancelled'),
    'delivered', (select count(*) from un_orders where (delivered_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    'sales', (select coalesce(sum(total), 0) from un_orders where (delivered_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'size', l.size, 'qty', l.q) order by l.q desc), '[]')
              from (select ln.item_id, ln.size, sum(ln.qty) q from un_lines ln join un_orders o on o.id = ln.order_id
                     where o.status = 'delivered' and (o.delivered_at at time zone 'Asia/Riyadh')::date between p_from and p_to group by 1, 2) l join un_items i on i.id = l.item_id),
    'low', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'size', s.size, 'qty', s.qty, 'min', s.min_qty) order by s.qty), '[]')
            from un_stock s join un_items i on i.id = s.item_id and i.active where s.qty <= s.min_qty),
    'reserved', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'size', l.size, 'qty', l.q)), '[]')
                 from (select ln.item_id, ln.size, sum(ln.qty) q from un_lines ln join un_orders o on o.id = ln.order_id where o.status in ('pending','confirmed','paid','ready') group by 1, 2) l
                 join un_items i on i.id = l.item_id));
end $$;

-- ============================================================
-- 4) النوادي المدرسية
-- ============================================================
create table if not exists public.cb_clubs (
  id            bigserial primary key,
  name          text not null check (btrim(name) <> ''),
  icon          text not null default '⭐',
  field         text not null default 'other' check (field in ('scientific','tech','sports','arts','cultural','social','religious','other')),
  description   text,
  supervisor_id uuid references public.profiles(id) on delete set null,
  co_ids        uuid[] not null default '{}',
  grade_ids     int[] not null default '{}',
  capacity      int,
  schedule      text,
  place         text,
  join_mode     text not null default 'approval' check (join_mode in ('open','approval','closed')),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create table if not exists public.cb_members (
  club_id    bigint not null references public.cb_clubs(id) on delete cascade,
  student_id uuid not null references public.students(profile_id) on delete cascade,
  status     text not null default 'pending' check (status in ('pending','active','left','rejected')),
  role       text not null default 'member' check (role in ('member','leader')),
  joined_at  timestamptz not null default now(),
  primary key (club_id, student_id)
);
create table if not exists public.cb_sessions (
  id      bigserial primary key,
  club_id bigint not null references public.cb_clubs(id) on delete cascade,
  day     date not null,
  topic   text not null,
  notes   text,
  absent  uuid[] not null default '{}',
  by_id   uuid references public.profiles(id) on delete set null
);
create table if not exists public.cb_achievements (
  id       bigserial primary key,
  club_id  bigint not null references public.cb_clubs(id) on delete cascade,
  day      date not null default current_date,
  title    text not null,
  details  text,
  students uuid[] not null default '{}'
);
alter table public.cb_clubs enable row level security; alter table public.cb_members enable row level security;
alter table public.cb_sessions enable row level security; alter table public.cb_achievements enable row level security;
revoke all on public.cb_clubs, public.cb_members, public.cb_sessions, public.cb_achievements from anon, authenticated;

create or replace function private.act_mgr() returns boolean language sql stable security definer set search_path = public, private as $$
  select private.cs_job('(نشاط|النشاط|الأنشطة|رائد)') $$;
create or replace function private.cb_can(c cb_clubs) returns boolean language sql stable security definer set search_path = public, private as $$
  select private.act_mgr() or c.supervisor_id = public.me_id() or public.me_id() = any (c.co_ids) $$;
create or replace function private.cb_field(v text) returns text language sql immutable as $$
  select case v when 'scientific' then 'علمي' when 'tech' then 'تقني' when 'sports' then 'رياضي' when 'arts' then 'فني' when 'cultural' then 'ثقافي'
    when 'social' then 'اجتماعي وتطوعي' when 'religious' then 'ديني' else 'متنوع' end $$;
create or replace function private.cb_max() returns int language sql stable security definer set search_path = public as $$
  select coalesce((select (value ->> 'max_clubs')::int from app_settings where key = 'clubs'), 2) $$;

create or replace function private.cb_json(c cb_clubs) returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'field', c.field, 'field_label', private.cb_field(c.field), 'description', c.description,
    'supervisor_id', c.supervisor_id, 'supervisor', (select full_name from profiles where id = c.supervisor_id), 'co_ids', c.co_ids,
    'co', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (c.co_ids)), 'grade_ids', c.grade_ids,
    'grades', (select coalesce(string_agg(g.name_ar || ' ' || st.name_ar, '، ' order by st.sort, g.number), 'كل الصفوف') from grades g join stages st on st.id = g.stage_id where g.id = any (c.grade_ids)),
    'capacity', c.capacity, 'schedule', c.schedule, 'place', c.place, 'join_mode', c.join_mode, 'active', c.active,
    'members', (select count(*) from cb_members m where m.club_id = c.id and m.status = 'active'),
    'pending', (select count(*) from cb_members m where m.club_id = c.id and m.status = 'pending'),
    'sessions', (select count(*) from cb_sessions s where s.club_id = c.id), 'can', private.cb_can(c))
$$;

create or replace function public.cb_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := public.me_role()::text; me uuid := public.me_id(); s jsonb;
begin
  if r = 'student' then
    s := private.cs_stu(me);
    return jsonb_build_object('role', 'student', 'max', private.cb_max(), 'clubs', coalesce((select jsonb_agg(private.cb_json(c) || jsonb_build_object(
        'my', (select m.status from cb_members m where m.club_id = c.id and m.student_id = me),
        'eligible', cardinality(c.grade_ids) = 0 or (s ->> 'grade_id')::int = any (c.grade_ids)) order by c.name)
      from cb_clubs c where c.active and (cardinality(c.grade_ids) = 0 or (s ->> 'grade_id')::int = any (c.grade_ids)
            or exists (select 1 from cb_members m where m.club_id = c.id and m.student_id = me))), '[]'));
  end if;
  if not public.is_staff() then raise exception 'غير متاح'; end if;
  return jsonb_build_object('role', case when private.act_mgr() then 'mgr' else 'staff' end, 'max', private.cb_max(),
    'clubs', coalesce((select jsonb_agg(private.cb_json(c) order by c.active desc, private.cb_can(c) desc, c.name) from cb_clubs c), '[]'));
end $$;

create or replace function public.cb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cid bigint := nullif(p ->> 'id', '')::bigint; c cb_clubs;
begin
  if cid is not null then select * into c from cb_clubs where id = cid; if not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  elsif not private.act_mgr() then raise exception 'إنشاء النوادي لرائد النشاط والإدارة'; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'اكتب اسم النادي'; end if;
  if cid is null then insert into cb_clubs(name) values (btrim(p ->> 'name')) returning id into cid; end if;
  update cb_clubs set name = btrim(p ->> 'name'), icon = coalesce(nullif(btrim(p ->> 'icon'), ''), '⭐'), field = coalesce(nullif(p ->> 'field', ''), 'other'),
    description = nullif(btrim(p ->> 'description'), ''),
    supervisor_id = case when private.act_mgr() then nullif(p ->> 'supervisor_id', '')::uuid else supervisor_id end,
    co_ids = case when private.act_mgr() then coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'co_ids', '[]')) x), '{}') else co_ids end,
    grade_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
    capacity = nullif(p ->> 'capacity', '')::int, schedule = nullif(btrim(p ->> 'schedule'), ''), place = nullif(btrim(p ->> 'place'), ''),
    join_mode = coalesce(nullif(p ->> 'join_mode', ''), 'approval'), active = coalesce((p ->> 'active')::boolean, true) where id = cid;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

create or replace function public.cb_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.act_mgr() then raise exception 'لرائد النشاط والإدارة'; end if;
  if exists (select 1 from cb_sessions where club_id = p_id) then update cb_clubs set active = false where id = p_id; return jsonb_build_object('ok', true, 'archived', true); end if;
  delete from cb_clubs where id = p_id; return jsonb_build_object('ok', true);
end $$;

create or replace function public.cb_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select * into c from cb_clubs where id = p_id;
  if c.id is null or not public.is_staff() then raise exception 'غير متاح'; end if;
  return private.cb_json(c) || jsonb_build_object(
    'roster', coalesce((select jsonb_agg(private.cs_stu(m.student_id) || jsonb_build_object('status', m.status, 'role', m.role, 'joined_at', m.joined_at,
        'attended', (select count(*) from cb_sessions s where s.club_id = c.id and s.day >= (m.joined_at at time zone 'Asia/Riyadh')::date and not (m.student_id = any (s.absent))),
        'held', (select count(*) from cb_sessions s where s.club_id = c.id and s.day >= (m.joined_at at time zone 'Asia/Riyadh')::date))
        order by m.status <> 'pending', m.role desc, (select full_name from profiles where id = m.student_id)) from cb_members m where m.club_id = c.id and m.status in ('pending','active')), '[]'),
    'sessions_list', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'topic', s.topic, 'notes', s.notes, 'absent', s.absent) order by s.day desc) from cb_sessions s where s.club_id = c.id), '[]'),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'title', a.title, 'details', a.details,
        'students', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (a.students))) order by a.day desc) from cb_achievements a where a.club_id = c.id), '[]'));
end $$;

-- انضمام الطالب بنفسه
create or replace function public.cb_join(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs; me uuid := public.me_id(); s jsonb := private.cs_stu(public.me_id()); n int;
begin
  if public.me_role()::text <> 'student' then raise exception 'للطلاب فقط'; end if;
  select * into c from cb_clubs where id = p_id and active;
  if c.id is null or c.join_mode = 'closed' then raise exception 'التسجيل في هذا النادي مغلق'; end if;
  if cardinality(c.grade_ids) > 0 and not ((s ->> 'grade_id')::int = any (c.grade_ids)) then raise exception 'النادي غير متاح لصفك'; end if;
  select count(*) into n from cb_members where student_id = me and status in ('active','pending') and club_id <> p_id;
  if n >= private.cb_max() then raise exception 'الحد الأقصى % نادي لكل طالب — انسحب من نادٍ آخر أولًا', private.cb_max(); end if;
  if c.capacity is not null and (select count(*) from cb_members where club_id = p_id and status = 'active') >= c.capacity then raise exception 'اكتمل عدد أعضاء النادي'; end if;
  insert into cb_members(club_id, student_id, status) values (p_id, me, case when c.join_mode = 'open' then 'active' else 'pending' end)
  on conflict (club_id, student_id) do update set status = case when c.join_mode = 'open' then 'active' else 'pending' end, joined_at = now()
    where cb_members.status in ('left','rejected');
  if c.join_mode = 'approval' then perform private.cs_notify(array[c.supervisor_id], '⭐ طلب انضمام لنادي ' || c.name, (s ->> 'name') || ' (' || coalesce(s ->> 'class', '') || E') يطلب الانضمام.\nوافق أو ارفض من: النوادي المدرسية.'); end if;
  return jsonb_build_object('ok', true, 'status', case when c.join_mode = 'open' then 'active' else 'pending' end);
end $$;

create or replace function public.cb_leave(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  update cb_members set status = 'left' where club_id = p_id and student_id = public.me_id() and status in ('active','pending');
  return jsonb_build_object('ok', true);
end $$;

-- إدارة الأعضاء (المشرف): إضافة، قبول، رفض، إخراج، قائد
create or replace function public.cb_member_set(p_club bigint, p_student uuid, p_status text, p_role text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select * into c from cb_clubs where id = p_club;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  insert into cb_members(club_id, student_id, status, role) values (p_club, p_student, coalesce(p_status, 'active'), coalesce(p_role, 'member'))
  on conflict (club_id, student_id) do update set status = coalesce(p_status, cb_members.status), role = coalesce(p_role, cb_members.role),
    joined_at = case when cb_members.status <> 'active' and p_status = 'active' then now() else cb_members.joined_at end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cb_session_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs; sid bigint := nullif(p ->> 'id', '')::bigint;
begin
  select * into c from cb_clubs where id = (p ->> 'club_id')::bigint;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  if btrim(coalesce(p ->> 'topic', '')) = '' then raise exception 'اكتب موضوع اللقاء'; end if;
  if sid is null then
    insert into cb_sessions(club_id, day, topic, notes, absent, by_id) values (c.id, coalesce(nullif(p ->> 'day', '')::date, private.tr_today()), btrim(p ->> 'topic'),
      nullif(btrim(p ->> 'notes'), ''), coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'absent', '[]')) x), '{}'), public.me_id()) returning id into sid;
  else
    update cb_sessions set day = coalesce(nullif(p ->> 'day', '')::date, day), topic = btrim(p ->> 'topic'), notes = nullif(btrim(p ->> 'notes'), ''),
      absent = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'absent', '[]')) x), '{}') where id = sid and club_id = c.id;
  end if;
  return jsonb_build_object('ok', true, 'id', sid);
end $$;

create or replace function public.cb_achievement_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select * into c from cb_clubs where id = (p ->> 'club_id')::bigint;
  if c.id is null or not private.cb_can(c) then raise exception 'ليس لديك صلاحية'; end if;
  if coalesce((p ->> 'delete')::boolean, false) then delete from cb_achievements where id = (p ->> 'id')::bigint and club_id = c.id; return jsonb_build_object('ok', true); end if;
  insert into cb_achievements(club_id, day, title, details, students) values (c.id, coalesce(nullif(p ->> 'day', '')::date, private.tr_today()), btrim(p ->> 'title'),
    nullif(btrim(p ->> 'details'), ''), coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'students', '[]')) x), '{}'));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.cb_settings_set(p_max int) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.act_mgr() then raise exception 'لرائد النشاط والإدارة'; end if;
  insert into app_settings(key, value) values ('clubs', jsonb_build_object('max_clubs', greatest(1, least(10, p_max)))) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 5) الرحلات المدرسية: إنشاء ← اعتماد مدير المرحلة ← موافقات أولياء الأمور ← يوم الرحلة (الحضور) ← تقرير
-- ============================================================
create table if not exists public.tp_trips (
  id            bigserial primary key,
  title         text not null check (btrim(title) <> ''),
  destination   text not null,
  purpose       text,
  day           date not null,
  depart_time   text,
  return_time   text,
  grade_ids     int[] not null default '{}',
  class_ids     int[] not null default '{}',
  capacity      int,
  cost          numeric(10,2) not null default 0,
  transport     text,
  organizer_id  uuid references public.profiles(id) on delete set null,
  supervisors   uuid[] not null default '{}',
  consent_by    date,
  status        text not null default 'draft' check (status in ('draft','pending','approved','rejected','done','cancelled')),
  decided_by    uuid references public.profiles(id) on delete set null,
  decision_note text,
  report        text,
  created_at    timestamptz not null default now()
);
create table if not exists public.tp_people (
  trip_id     bigint not null references public.tp_trips(id) on delete cascade,
  student_id  uuid not null references public.students(profile_id) on delete cascade,
  consent     text not null default 'pending' check (consent in ('pending','yes','no')),
  consent_src text,
  consent_at  timestamptz,
  paid        boolean not null default false,
  attended    boolean,
  primary key (trip_id, student_id)
);
alter table public.tp_trips enable row level security; alter table public.tp_people enable row level security;
revoke all on public.tp_trips, public.tp_people from anon, authenticated;

create or replace function private.tp_st(v text) returns text language sql immutable as $$
  select case v when 'draft' then 'مسودة' when 'pending' then 'بانتظار الاعتماد' when 'approved' then 'معتمدة — جمع الموافقات' when 'rejected' then 'غير معتمدة'
    when 'done' then 'نُفّذت' when 'cancelled' then 'ملغاة' else v end $$;
create or replace function private.tp_stages(t tp_trips) returns int[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct g.stage_id), '{}') from grades g where g.id = any (t.grade_ids) or g.id in (select c.grade_id from classes c where c.id = any (t.class_ids)) $$;
create or replace function private.tp_approver(t tp_trips) returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role() in ('admin','leadership') or (public.me_role() = 'principal' and private.tp_stages(t) && private.my_stage_ids()) $$;
create or replace function private.tp_can(t tp_trips) returns boolean language sql stable security definer set search_path = public, private as $$
  select t.organizer_id = public.me_id() or public.me_id() = any (t.supervisors) or private.act_mgr() or private.tp_approver(t) $$;
create or replace function private.tp_json(t tp_trips) returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(t) || jsonb_build_object('status_label', private.tp_st(t.status), 'organizer', (select full_name from profiles where id = t.organizer_id),
    'supervisors_names', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (t.supervisors)),
    'targets', concat_ws('، ', (select string_agg(g.name_ar || ' ' || st.name_ar, '، ') from grades g join stages st on st.id = g.stage_id where g.id = any (t.grade_ids)),
                         (select string_agg(c.label, '، ') from v_classes c where c.id = any (t.class_ids))),
    'n', (select count(*) from tp_people p where p.trip_id = t.id), 'yes', (select count(*) from tp_people p where p.trip_id = t.id and p.consent = 'yes'),
    'no', (select count(*) from tp_people p where p.trip_id = t.id and p.consent = 'no'), 'paid', (select count(*) from tp_people p where p.trip_id = t.id and p.paid),
    'attended', (select count(*) from tp_people p where p.trip_id = t.id and p.attended),
    'can', private.tp_can(t), 'approver', private.tp_approver(t), 'mine', t.organizer_id = public.me_id())
$$;

create or replace function public.tp_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  return coalesce((select jsonb_agg(private.tp_json(t) order by t.day desc) from tp_trips t
    where (t.status not in ('draft') or t.organizer_id = public.me_id()) and (private.tp_can(t) or t.status in ('approved','done'))
      and (nullif(p ->> 'status', '') is null or t.status = p ->> 'status')), '[]'::jsonb);
end $$;

create or replace function public.tp_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tid bigint := nullif(p ->> 'id', '')::bigint; t tp_trips;
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  if tid is not null then select * into t from tp_trips where id = tid;
    if not (t.organizer_id = public.me_id() or private.act_mgr()) then raise exception 'التعديل لمنظم الرحلة'; end if;
    if t.status not in ('draft','rejected','pending') and not private.act_mgr() then raise exception 'لا تُعدّل الرحلة بعد اعتمادها'; end if; end if;
  if btrim(coalesce(p ->> 'title', '')) = '' or btrim(coalesce(p ->> 'destination', '')) = '' or nullif(p ->> 'day', '') is null then raise exception 'العنوان والوجهة والتاريخ مطلوبة'; end if;
  if tid is null then insert into tp_trips(title, destination, day, organizer_id) values (btrim(p ->> 'title'), btrim(p ->> 'destination'), (p ->> 'day')::date, public.me_id()) returning id into tid; end if;
  update tp_trips set title = btrim(p ->> 'title'), destination = btrim(p ->> 'destination'), purpose = nullif(btrim(p ->> 'purpose'), ''), day = (p ->> 'day')::date,
    depart_time = nullif(btrim(p ->> 'depart_time'), ''), return_time = nullif(btrim(p ->> 'return_time'), ''),
    grade_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
    class_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'class_ids', '[]')) x), '{}'),
    capacity = nullif(p ->> 'capacity', '')::int, cost = coalesce(nullif(p ->> 'cost', '')::numeric, 0), transport = nullif(btrim(p ->> 'transport'), ''),
    supervisors = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'supervisors', '[]')) x), '{}'),
    consent_by = nullif(p ->> 'consent_by', '')::date, status = case when status = 'rejected' then 'draft' else status end where id = tid;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

create or replace function public.tp_submit(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tp_trips;
begin
  select * into t from tp_trips where id = p_id for update;
  if t.organizer_id is distinct from public.me_id() and not private.act_mgr() then raise exception 'لمنظم الرحلة'; end if;
  if t.status not in ('draft','rejected') then raise exception 'الرحلة مرسلة من قبل'; end if;
  if cardinality(t.grade_ids) = 0 and cardinality(t.class_ids) = 0 then raise exception 'حدّد الصفوف أو الفصول المشاركة'; end if;
  update tp_trips set status = 'pending' where id = p_id;
  perform private.cs_notify((select coalesce(array_agg(p.id), '{}') from profiles p where p.active and p.role = 'principal'
      and exists (select 1 from staff_scopes sc join stages st on st.id = sc.stage_id or (sc.stage_id is null and sc.section_id = st.section_id) where sc.profile_id = p.id and st.id = any (private.tp_stages(t)))),
    '🚌 رحلة بانتظار اعتمادك: ' || t.title, 'الوجهة: ' || t.destination || E'\nالتاريخ: ' || t.day || E'\nالمنظم: ' || (select full_name from profiles where id = t.organizer_id) || E'\n\nاعتمدها من: الرحلات المدرسية.');
  return jsonb_build_object('ok', true);
end $$;

-- الاعتماد: ينشئ كشف الطلاب المستهدفين لجمع موافقات أولياء الأمور
create or replace function public.tp_decide(p_id bigint, p_approve boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tp_trips;
begin
  select * into t from tp_trips where id = p_id for update;
  if t.id is null or not private.tp_approver(t) then raise exception 'الاعتماد لمدير المرحلة أو الإدارة العليا'; end if;
  if t.status <> 'pending' then raise exception 'الرحلة ليست بانتظار الاعتماد'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'اذكر سبب عدم الاعتماد'; end if;
  update tp_trips set status = case when p_approve then 'approved' else 'rejected' end, decided_by = public.me_id(), decision_note = nullif(btrim(p_note), '') where id = p_id;
  if p_approve then
    insert into tp_people(trip_id, student_id)
      select t.id, s.profile_id from students s join profiles p on p.id = s.profile_id and p.active left join classes c on c.id = s.class_id
       where s.class_id = any (t.class_ids) or coalesce(c.grade_id, s.grade_id) = any (t.grade_ids) on conflict do nothing;
  end if;
  perform private.cs_notify(array[t.organizer_id] || t.supervisors, case when p_approve then '✅ اعتُمدت الرحلة: ' else '⛔ لم تُعتمد الرحلة: ' end || t.title,
    coalesce(nullif(btrim(p_note), ''), '') || case when p_approve then E'\nتظهر الآن لأولياء الأمور في بوابتهم لإرسال الموافقة.' else '' end);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tp_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare t tp_trips;
begin
  select * into t from tp_trips where id = p_id;
  if t.id is null or not public.is_staff() then raise exception 'غير متاح'; end if;
  return private.tp_json(t) || jsonb_build_object('people', case when private.tp_can(t) then coalesce((select jsonb_agg(private.cs_stu(x.student_id) ||
      jsonb_build_object('consent', x.consent, 'consent_src', x.consent_src, 'consent_at', x.consent_at, 'paid', x.paid, 'attended', x.attended,
        'guardian_phone', (select s.guardian_phone from students s where s.profile_id = x.student_id))
      order by (select label from v_classes vc join students s on s.class_id = vc.id where s.profile_id = x.student_id), (select full_name from profiles where id = x.student_id))
    from tp_people x where x.trip_id = t.id), '[]') else '[]'::jsonb end);
end $$;

create or replace function public.tp_person_set(p_trip bigint, p_student uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tp_trips;
begin
  select * into t from tp_trips where id = p_trip;
  if t.id is null or not private.tp_can(t) then raise exception 'ليس لديك صلاحية'; end if;
  if coalesce((p ->> 'remove')::boolean, false) then delete from tp_people where trip_id = p_trip and student_id = p_student; return jsonb_build_object('ok', true); end if;
  insert into tp_people(trip_id, student_id) values (p_trip, p_student) on conflict do nothing;
  update tp_people set consent = coalesce(nullif(p ->> 'consent', ''), consent), consent_src = case when p ? 'consent' then 'ورقي — ' || (select full_name from profiles where id = public.me_id()) else consent_src end,
    consent_at = case when p ? 'consent' then now() else consent_at end, paid = coalesce((p ->> 'paid')::boolean, paid),
    attended = case when p ? 'attended' then (p ->> 'attended')::boolean else attended end where trip_id = p_trip and student_id = p_student;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tp_close(p_id bigint, p_status text, p_report text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t tp_trips;
begin
  select * into t from tp_trips where id = p_id;
  if t.id is null or not private.tp_can(t) then raise exception 'ليس لديك صلاحية'; end if;
  if p_status not in ('done','cancelled') then raise exception 'حالة غير صحيحة'; end if;
  update tp_trips set status = p_status, report = nullif(btrim(p_report), '') where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- 6) الأنشطة المدرسية (الخطة والتوثيق ومشاركات الطلاب)
-- ============================================================
create table if not exists public.ac_activities (
  id           bigserial primary key,
  title        text not null check (btrim(title) <> ''),
  kind         text not null default 'cultural' check (kind in ('cultural','sports','scientific','social','arts','religious','national','health','environmental','competition','other')),
  day          date not null,
  end_day      date,
  place        text,
  description  text,
  goals        text,
  organizer_id uuid references public.profiles(id) on delete set null,
  team         uuid[] not null default '{}',
  grade_ids    int[] not null default '{}',
  status       text not null default 'planned' check (status in ('planned','done','cancelled')),
  budget       numeric(10,2),
  participants int,
  report       text,
  outcomes     text,
  links        text[] not null default '{}',
  created_at   timestamptz not null default now()
);
create table if not exists public.ac_students (
  activity_id bigint not null references public.ac_activities(id) on delete cascade,
  student_id  uuid not null references public.students(profile_id) on delete cascade,
  role        text not null default 'participant' check (role in ('participant','organizer','winner','honored')),
  note        text,
  primary key (activity_id, student_id)
);
alter table public.ac_activities enable row level security; alter table public.ac_students enable row level security;
revoke all on public.ac_activities, public.ac_students from anon, authenticated;

create or replace function private.ac_kind(v text) returns text language sql immutable as $$
  select case v when 'cultural' then 'ثقافي' when 'sports' then 'رياضي' when 'scientific' then 'علمي' when 'social' then 'اجتماعي وتطوعي' when 'arts' then 'فني'
    when 'religious' then 'ديني' when 'national' then 'وطني' when 'health' then 'صحي' when 'environmental' then 'بيئي' when 'competition' then 'مسابقة' else 'متنوع' end $$;
create or replace function private.ac_can(a ac_activities) returns boolean language sql stable security definer set search_path = public, private as $$
  select private.act_mgr() or a.organizer_id = public.me_id() or public.me_id() = any (a.team) $$;
create or replace function private.ac_json(a ac_activities) returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(a) || jsonb_build_object('kind_label', private.ac_kind(a.kind), 'organizer', (select full_name from profiles where id = a.organizer_id),
    'team_names', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (a.team)),
    'grades', (select coalesce(string_agg(g.name_ar || ' ' || st.name_ar, '، ' order by st.sort, g.number), 'كل الصفوف') from grades g join stages st on st.id = g.stage_id where g.id = any (a.grade_ids)),
    'students_n', (select count(*) from ac_students s where s.activity_id = a.id), 'can', private.ac_can(a))
$$;

create or replace function public.ac_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  return jsonb_build_object('mgr', private.act_mgr(), 'items', coalesce((select jsonb_agg(private.ac_json(a) order by a.day desc) from ac_activities a
    where (nullif(p ->> 'from', '') is null or a.day >= (p ->> 'from')::date) and (nullif(p ->> 'to', '') is null or a.day <= (p ->> 'to')::date)
      and (nullif(p ->> 'kind', '') is null or a.kind = p ->> 'kind') and (not coalesce((p ->> 'mine')::boolean, false) or private.ac_can(a))), '[]'));
end $$;

create or replace function public.ac_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare aid bigint := nullif(p ->> 'id', '')::bigint; a ac_activities;
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  if aid is not null then select * into a from ac_activities where id = aid; if not private.ac_can(a) then raise exception 'ليس لديك صلاحية'; end if; end if;
  if btrim(coalesce(p ->> 'title', '')) = '' or nullif(p ->> 'day', '') is null then raise exception 'العنوان والتاريخ مطلوبان'; end if;
  if aid is null then insert into ac_activities(title, day, organizer_id) values (btrim(p ->> 'title'), (p ->> 'day')::date, public.me_id()) returning id into aid; end if;
  update ac_activities set title = btrim(p ->> 'title'), kind = coalesce(nullif(p ->> 'kind', ''), 'other'), day = (p ->> 'day')::date, end_day = nullif(p ->> 'end_day', '')::date,
    place = nullif(btrim(p ->> 'place'), ''), description = nullif(btrim(p ->> 'description'), ''), goals = nullif(btrim(p ->> 'goals'), ''),
    team = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p -> 'team', '[]')) x), '{}'),
    grade_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
    budget = nullif(p ->> 'budget', '')::numeric, status = coalesce(nullif(p ->> 'status', ''), status), participants = nullif(p ->> 'participants', '')::int,
    report = nullif(btrim(p ->> 'report'), ''), outcomes = nullif(btrim(p ->> 'outcomes'), ''),
    links = coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'links', '[]')) x where btrim(x) ~ '^https?://'), '{}') where id = aid;
  return jsonb_build_object('ok', true, 'id', aid);
end $$;

create or replace function public.ac_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a ac_activities;
begin
  select * into a from ac_activities where id = p_id;
  if a.id is null or not (private.act_mgr() or a.organizer_id = public.me_id()) then raise exception 'ليس لديك صلاحية'; end if;
  delete from ac_activities where id = p_id; return jsonb_build_object('ok', true);
end $$;

create or replace function public.ac_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare a ac_activities;
begin
  select * into a from ac_activities where id = p_id;
  if a.id is null or not public.is_staff() then raise exception 'غير متاح'; end if;
  return private.ac_json(a) || jsonb_build_object('students', coalesce((select jsonb_agg(private.cs_stu(s.student_id) || jsonb_build_object('role', s.role, 'note', s.note)
    order by s.role desc, (select full_name from profiles where id = s.student_id)) from ac_students s where s.activity_id = a.id), '[]'));
end $$;

-- إضافة/تعديل/حذف مشاركة طالب (أو فصل كامل)
create or replace function public.ac_student_set(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a ac_activities; n int := 0;
begin
  select * into a from ac_activities where id = p_id;
  if a.id is null or not private.ac_can(a) then raise exception 'ليس لديك صلاحية'; end if;
  if nullif(p ->> 'class_id', '') is not null then
    insert into ac_students(activity_id, student_id, role) select p_id, s.profile_id, coalesce(nullif(p ->> 'role', ''), 'participant')
      from students s join profiles pr on pr.id = s.profile_id and pr.active where s.class_id = (p ->> 'class_id')::int on conflict do nothing;
    get diagnostics n = row_count; return jsonb_build_object('ok', true, 'added', n);
  end if;
  if coalesce((p ->> 'remove')::boolean, false) then delete from ac_students where activity_id = p_id and student_id = (p ->> 'student_id')::uuid; return jsonb_build_object('ok', true); end if;
  insert into ac_students(activity_id, student_id, role, note) values (p_id, (p ->> 'student_id')::uuid, coalesce(nullif(p ->> 'role', ''), 'participant'), nullif(btrim(p ->> 'note'), ''))
  on conflict (activity_id, student_id) do update set role = excluded.role, note = coalesce(excluded.note, ac_students.note);
  return jsonb_build_object('ok', true, 'added', 1);
end $$;

create or replace function public.ac_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  return (with b as (select * from ac_activities where day between p_from and p_to and status <> 'cancelled')
  select jsonb_build_object('total', (select count(*) from b), 'done', (select count(*) from b where status = 'done'),
    'students', (select count(distinct s.student_id) from ac_students s join b on b.id = s.activity_id),
    'participations', (select count(*) from ac_students s join b on b.id = s.activity_id),
    'budget', (select coalesce(sum(budget), 0) from b),
    'by_kind', (select coalesce(jsonb_agg(jsonb_build_object('label', private.ac_kind(kind), 'n', n) order by n desc), '[]') from (select kind, count(*) n from b group by kind) z),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n) order by m), '[]') from (select to_char(day, 'YYYY-MM') m, count(*) n from b group by 1) z),
    'by_org', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce((select full_name from profiles where id = organizer_id), '—'), 'n', n) order by n desc), '[]')
               from (select organizer_id, count(*) n from b group by organizer_id) z),
    'top_students', (select coalesce(jsonb_agg(jsonb_build_object('name', (select full_name from profiles where id = sid), 'class', (private.cs_stu(sid) ->> 'class'), 'n', n) order by n desc), '[]')
               from (select s.student_id sid, count(*) n from ac_students s join b on b.id = s.activity_id group by 1 order by 2 desc limit 15) z)));
end $$;

-- ============================================================
-- مشاركات الطالب (له ولولي أمره)
-- ============================================================
create or replace function private.cs_child(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'transport', private.tr_info(p_student),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'icon', c.icon, 'status', m.status, 'schedule', c.schedule, 'place', c.place,
                'supervisor', (select full_name from profiles where id = c.supervisor_id))), '[]')
              from cb_members m join cb_clubs c on c.id = m.club_id where m.student_id = p_student and m.status in ('active','pending')),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'kind', private.ac_kind(a.kind), 'day', a.day, 'role', s.role, 'note', s.note) order by a.day desc), '[]')
              from ac_students s join ac_activities a on a.id = s.activity_id where s.student_id = p_student and a.status <> 'cancelled' and a.day > current_date - 365),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'destination', t.destination, 'purpose', t.purpose, 'day', t.day,
                'depart_time', t.depart_time, 'return_time', t.return_time, 'cost', t.cost, 'transport', t.transport, 'consent_by', t.consent_by, 'status', t.status,
                'consent', x.consent, 'paid', x.paid, 'attended', x.attended, 'organizer', (select full_name from profiles where id = t.organizer_id)) order by t.day desc), '[]')
              from tp_people x join tp_trips t on t.id = x.trip_id where x.student_id = p_student and t.status in ('approved','done') and t.day > current_date - 120),
    'uniform', (select coalesce(jsonb_agg(private.un_order_json(o) order by o.created_at desc), '[]') from un_orders o where o.student_id = p_student and o.created_at > now() - interval '365 days'),
    'transport_request', (select jsonb_build_object('status', q.status, 'reply', q.reply, 'created_at', q.created_at) from tr_requests q where q.student_id = p_student order by q.created_at desc limit 1))
$$;

create or replace function public.cs_my() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if public.me_role()::text <> 'student' then return null; end if;
  return private.cs_child(public.me_id()) - 'uniform' - 'transport_request';
end $$;

-- بوابة ولي الأمر
create or replace function public.pp_campus(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  return coalesce((select jsonb_agg(private.cs_stu(gs.student_id) || private.cs_child(gs.student_id) || jsonb_build_object('uniform_items',
       private.un_items_json((private.cs_stu(gs.student_id) ->> 'section_id')::int, (private.cs_stu(gs.student_id) ->> 'stage_id')::int, false)))
    from guardian_students gs where gs.guardian_id = s.guardian_id), '[]'::jsonb);
end $$;

create or replace function private.pp_own(s guardian_sessions, p_student uuid) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from guardian_students where guardian_id = s.guardian_id and student_id = p_student) then raise exception 'الطالب غير مرتبط بحسابك'; end if;
end $$;

create or replace function public.pp_trip_consent(p_token text, p_trip bigint, p_student uuid, p_yes boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); t tp_trips;
begin
  perform private.pp_own(s, p_student);
  select * into t from tp_trips where id = p_trip;
  if t.status <> 'approved' then raise exception 'الرحلة غير متاحة للموافقة'; end if;
  if t.consent_by is not null and private.tr_today() > t.consent_by then raise exception 'انتهى موعد إرسال الموافقات'; end if;
  update tp_people set consent = case when p_yes then 'yes' else 'no' end, consent_src = 'بوابة ولي الأمر', consent_at = now() where trip_id = p_trip and student_id = p_student;
  if not found then raise exception 'ابنك غير مدرج في هذه الرحلة'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pp_transport_request(p_token text, p_student uuid, p_address text, p_mode text, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  perform private.pp_own(s, p_student);
  if length(btrim(coalesce(p_address, ''))) < 4 then raise exception 'اكتب العنوان / الحي'; end if;
  if exists (select 1 from tr_requests where student_id = p_student and status = 'pending') then raise exception 'لديك طلب قيد المراجعة'; end if;
  insert into tr_requests(student_id, guardian_id, address, mode, notes) values (p_student, s.guardian_id, left(btrim(p_address), 200),
    case when p_mode in ('both','am','pm') then p_mode else 'both' end, left(nullif(btrim(p_notes), ''), 500));
  perform private.cs_notify(private.cs_people('(النقل|نقل|حافلات|الحافلات|مواصلات|باصات)'), '🚌 طلب اشتراك في النقل', 'طلب جديد من ولي أمر ' ||
    (private.cs_stu(p_student) ->> 'name') || E' — الحي: ' || btrim(p_address) || E'\nافتح: النقل المدرسي ← الطلبات.');
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pp_uniform_order(p_token text, p_student uuid, p_lines jsonb, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); oid bigint;
begin
  perform private.pp_own(s, p_student);
  if (select count(*) from un_orders where guardian_id = s.guardian_id and status = 'pending') >= 5 then raise exception 'لديك طلبات كثيرة قيد المراجعة'; end if;
  oid := private.un_make_order(p_student, p_lines, p_notes, s.guardian_id);
  perform private.cs_notify(private.cs_people('(الزي|زي مدرسي|مستودع|المستودع|مخازن|مخزن|المشتريات|مشتريات)'), '👕 طلب زي مدرسي جديد #' || oid,
    'من ولي أمر ' || (private.cs_stu(p_student) ->> 'name') || E'\nافتح: الزي المدرسي ← الطلبات.');
  return jsonb_build_object('ok', true, 'id', oid);
end $$;

create or replace function public.pp_uniform_cancel(p_token text, p_order bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  update un_orders set status = 'cancelled', updated_at = now() where id = p_order and guardian_id = s.guardian_id and status = 'pending';
  if not found then raise exception 'يمكن إلغاء الطلب قبل تأكيده فقط'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================================================
-- المهام اليومية
-- ============================================================
create or replace function private.cs_tasks() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare out jsonb := '[]'::jsonb; n int; me uuid := public.me_id();
begin
  if private.mn_mgr() then
    select count(*) into n from mn_requests where status = 'new';
    if n > 0 then out := out || jsonb_build_object('icon', '🛠️', 'text', n || ' طلب صيانة جديد لم يُسند', 'link', 'maintenance.html#all'); end if;
  end if;
  select count(*) into n from mn_requests where assignee_id = me and status in ('assigned','in_progress','waiting');
  if n > 0 then out := out || jsonb_build_object('icon', '🔧', 'text', n || ' طلب صيانة مسند إليك', 'link', 'maintenance.html#assigned'); end if;
  select count(*) into n from mn_requests where requester_id = me and status = 'done' and rating is null and done_at > now() - interval '14 days';
  if n > 0 then out := out || jsonb_build_object('icon', '⭐', 'text', n || ' طلب صيانة منجز — قيّم الخدمة', 'link', 'maintenance.html#mine'); end if;
  select count(*) into n from tr_routes r where r.supervisor_id = me and r.active
     and not exists (select 1 from tr_trips t where t.route_id = r.id and t.day = private.tr_today() and t.shift = 'am' and t.closed_at is not null)
     and extract(isodow from private.tr_today()) not in (5, 6);
  if n > 0 then out := out || jsonb_build_object('icon', '🚌', 'text', 'كشف الحافلة الصباحي لم يُغلق بعد', 'link', 'transport.html#run'); end if;
  if private.tr_mgr() then
    select count(*) into n from tr_requests where status = 'pending';
    if n > 0 then out := out || jsonb_build_object('icon', '🚌', 'text', n || ' طلب اشتراك نقل جديد', 'link', 'transport.html#requests'); end if;
  end if;
  if private.un_mgr() then
    select count(*) into n from un_orders where status = 'pending';
    if n > 0 then out := out || jsonb_build_object('icon', '👕', 'text', n || ' طلب زي مدرسي جديد', 'link', 'uniform.html#orders'); end if;
  end if;
  select count(*) into n from cb_members m join cb_clubs c on c.id = m.club_id where m.status = 'pending' and (c.supervisor_id = me or me = any (c.co_ids));
  if n > 0 then out := out || jsonb_build_object('icon', '⭐', 'text', n || ' طلب انضمام لناديك', 'link', 'clubs.html'); end if;
  select count(*) into n from tp_trips t where t.status = 'pending' and private.tp_approver(t);
  if n > 0 then out := out || jsonb_build_object('icon', '🚌', 'text', n || ' رحلة مدرسية بانتظار اعتمادك', 'link', 'trips.html'); end if;
  return out;
end $$;

-- my_tasks: نسخة 79 + خدمات المدرسة
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
  return out;
end $$;

-- ---------- الصلاحيات ----------
do $$ declare f text; begin
  foreach f in array array['private.cs_job(text)','private.cs_people(text)','private.cs_notify(uuid[], text, text)','private.cs_stu(uuid)','private.mn_mgr()','private.mn_label(text, text)',
    'private.mn_row(mn_requests)','private.tr_mgr()','private.tr_can_route(bigint)','private.tr_today()','private.tr_info(uuid)','private.un_mgr()','private.un_st(text)',
    'private.un_items_json(int, int, boolean)','private.un_order_json(un_orders)','private.un_make_order(uuid, jsonb, text, uuid)','private.act_mgr()','private.cb_can(cb_clubs)',
    'private.cb_field(text)','private.cb_max()','private.cb_json(cb_clubs)','private.tp_st(text)','private.tp_stages(tp_trips)','private.tp_approver(tp_trips)','private.tp_can(tp_trips)',
    'private.tp_json(tp_trips)','private.ac_kind(text)','private.ac_can(ac_activities)','private.ac_json(ac_activities)','private.cs_child(uuid)','private.pp_own(guardian_sessions, uuid)','private.cs_tasks()'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['cs_student_search(text)','cs_lists()','mn_me()','mn_list(jsonb)','mn_get(bigint)','mn_create(jsonb)','mn_update(bigint, jsonb)','mn_rate(bigint, int, text)',
    'mn_stats(date, date)','mn_settings_set(jsonb)','tr_me()','tr_route_save(jsonb)','tr_route_delete(bigint)','tr_riders(bigint)','tr_rider_set(jsonb)','tr_run(bigint, text, date)',
    'tr_mark(bigint, uuid, text)','tr_close(bigint)','tr_day_report(date)','tr_requests_list()','tr_request_decide(bigint, boolean, text, bigint, bigint)','un_me()','un_item_save(jsonb)',
    'un_stock_set(bigint, text, int, int, text)','un_order_create(uuid, jsonb, text)','un_orders_list(jsonb)','un_order_status(bigint, text, text)','un_stats(date, date)',
    'cb_list()','cb_save(jsonb)','cb_delete(bigint)','cb_get(bigint)','cb_join(bigint)','cb_leave(bigint)','cb_member_set(bigint, uuid, text, text)','cb_session_save(jsonb)',
    'cb_achievement_save(jsonb)','cb_settings_set(int)','tp_list(jsonb)','tp_save(jsonb)','tp_submit(bigint)','tp_decide(bigint, boolean, text)','tp_get(bigint)',
    'tp_person_set(bigint, uuid, jsonb)','tp_close(bigint, text, text)','ac_list(jsonb)','ac_save(jsonb)','ac_delete(bigint)','ac_get(bigint)','ac_student_set(bigint, jsonb)',
    'ac_stats(date, date)','cs_my()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  foreach f in array array['pp_campus(text)','pp_trip_consent(text, bigint, uuid, boolean)','pp_transport_request(text, uuid, text, text, text)','pp_uniform_order(text, uuid, jsonb, text)','pp_uniform_cancel(text, bigint)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
end $$;
