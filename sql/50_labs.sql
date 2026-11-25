-- =====================================================================
-- 50) إدارة المختبرات: مختبر العلوم ومعمل STEM (ونفس النظام لأي معمل يُضاف لاحقًا)
--   • المعلم يحجز حصة في المعمل (التاريخ + الحصة + الفصل + التجربة) ويكتب التجهيزات المطلوبة
--     ويختار من مخزون المعمل الأدوات/المواد وكمياتها
--   • محضّر المختبر يرى الحجوزات القادمة ويجهّزها (تم التجهيز / ملاحظة)، وبعد الحصة يسجّل المستهلَك فيُخصم من المخزون
--   • المخزون: الاسم، النوع، العدد، الحد الأدنى، الحالة، تاريخ الصلاحية، المكان، الملاحظات + سجل الحركة
--   • التنبيهات (للمحضّر ومشرف المعمل): كمية عند الحد الأدنى أو نفدت، صلاحية تنتهي خلال 30 يومًا أو انتهت، تلف/يحتاج صيانة
-- =====================================================================

create table if not exists public.labs (
  id      serial primary key,
  code    text unique not null check (code ~ '^[a-z0-9_]{2,30}$'),
  name    text not null,
  icon    text not null default '🔬',
  active  boolean not null default true,
  sort    int not null default 0
);
insert into public.labs(code, name, icon, sort) values ('science', 'مختبر العلوم', '🔬', 1), ('stem', 'معمل STEM', '🤖', 2)
on conflict (code) do nothing;

create table if not exists public.lab_staff (
  lab_id     int  not null references public.labs(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('tech','supervisor')),     -- tech = محضّر المختبر، supervisor = مشرف المعمل
  primary key (lab_id, profile_id, role)
);

create table if not exists public.lab_items (
  id         bigserial primary key,
  lab_id     int not null references public.labs(id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  category   text not null default 'tool' check (category in ('tool','device','material','chemical','consumable','safety','other')),
  qty        numeric not null default 0 check (qty >= 0),
  unit       text not null default 'قطعة',
  min_qty    numeric not null default 0 check (min_qty >= 0),
  condition  text not null default 'good' check (condition in ('good','maintenance','damaged')),
  expiry     date,
  location   text,
  notes      text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index if not exists lab_items_lab on public.lab_items(lab_id);

create table if not exists public.lab_item_log (
  id       bigserial primary key,
  item_id  bigint not null references public.lab_items(id) on delete cascade,
  delta    numeric not null,
  reason   text,
  booking  bigint,
  by_id    uuid references public.profiles(id) on delete set null,
  at       timestamptz not null default now()
);
create index if not exists lab_item_log_item on public.lab_item_log(item_id, at desc);

create table if not exists public.lab_bookings (
  id          bigserial primary key,
  lab_id      int  not null references public.labs(id) on delete cascade,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  period      smallint not null check (period between 1 and 10),
  class_label text not null default '',
  subject     text not null default '',
  title       text not null check (btrim(title) <> ''),
  needs       text not null default '',
  items       jsonb not null default '[]'::jsonb,      -- [{id, qty}] من مخزون المعمل
  status      text not null default 'pending' check (status in ('pending','prepared','done','cancelled','rejected')),
  tech_note   text not null default '',
  used        jsonb,                                   -- [{id, qty}] المستهلَك فعليًا (يُخصم من المخزون عند «تمت الحصة»)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists lab_bookings_slot on public.lab_bookings(lab_id, day, period) where status in ('pending','prepared','done');
create index if not exists lab_bookings_day on public.lab_bookings(lab_id, day);

do $$ declare t text; begin
  foreach t in array array['labs','lab_staff','lab_items','lab_item_log','lab_bookings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- البذرة: مشرف شعبة العلوم = مشرف مختبر العلوم، ومشرف مهارات القرن 21 = مشرف معمل STEM
insert into public.lab_staff(lab_id, profile_id, role)
select (select id from labs where code = 'science'), p.id, 'supervisor' from profiles p
 where p.active and p.role = 'supervisor' and p.job_title ~ 'مشرف.*العلوم' on conflict do nothing;
insert into public.lab_staff(lab_id, profile_id, role)
select (select id from labs where code = 'stem'), p.id, 'supervisor' from profiles p
 where p.active and p.email = 'm.hussien@althikr.edu.sa' on conflict do nothing;

-- ---------------------------------------------------------------------
create schema if not exists private;
create or replace function private.lab_role(p_lab int) returns text   -- 'admin' / 'supervisor' / 'tech' / null
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then 'admin'
    else (select case when bool_or(role = 'supervisor') then 'supervisor' when bool_or(role = 'tech') then 'tech' end
          from lab_staff where lab_id = p_lab and profile_id = public.me_id()) end
$$;
create or replace function private.lab_id(p_code text) returns int
language sql stable security definer set search_path = public as $$ select id from labs where code = p_code and active $$;

create or replace function private.lab_item_json(i lab_items) returns jsonb
language sql stable as $$
  select to_jsonb(i) - 'updated_by' || jsonb_build_object(
    'low', i.qty <= i.min_qty and i.min_qty > 0, 'out', i.qty = 0 and i.category in ('material','chemical','consumable'),
    'expired', i.expiry is not null and i.expiry < current_date,
    'expiring', i.expiry is not null and i.expiry >= current_date and i.expiry <= current_date + 30,
    'bad', i.condition <> 'good')
$$;

create or replace function private.lab_alerts_of(p_lab int) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(x order by x->>'sev' desc, x->>'name'), '[]'::jsonb) from (
    select jsonb_build_object('id', i.id, 'name', i.name, 'sev', 2, 'kind', 'expired', 'msg', 'انتهت صلاحيته في ' || i.expiry) x from lab_items i where i.lab_id = p_lab and i.expiry < current_date
    union all
    select jsonb_build_object('id', i.id, 'name', i.name, 'sev', 1, 'kind', 'expiring', 'msg', 'تنتهي صلاحيته في ' || i.expiry || ' (بعد ' || (i.expiry - current_date) || ' يوم)') from lab_items i where i.lab_id = p_lab and i.expiry between current_date and current_date + 30
    union all
    select jsonb_build_object('id', i.id, 'name', i.name, 'sev', case when i.qty = 0 then 2 else 1 end, 'kind', case when i.qty = 0 then 'out' else 'low' end,
             'msg', case when i.qty = 0 then 'نفدت الكمية' else 'الكمية ' || trim(to_char(i.qty, 'FM999999990.##')) || ' ' || i.unit || ' (الحد الأدنى ' || trim(to_char(i.min_qty, 'FM999999990.##')) || ')' end)
      from lab_items i where i.lab_id = p_lab and i.min_qty > 0 and i.qty <= i.min_qty
    union all
    select jsonb_build_object('id', i.id, 'name', i.name, 'sev', case when i.condition = 'damaged' then 2 else 1 end, 'kind', i.condition,
             'msg', case when i.condition = 'damaged' then 'تالف' else 'يحتاج صيانة' end) from lab_items i where i.lab_id = p_lab and i.condition <> 'good'
  ) t
$$;

create or replace function private.lab_notify(p_lab int, p_roles text[], p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint; ids uuid[];
begin
  ids := array(select distinct profile_id from lab_staff where lab_id = p_lab and role = any (p_roles));
  if coalesce(array_length(ids, 1), 0) = 0 then return; end if;
  insert into messages(kind, sender_id, subject, body, audience) values ('mail', public.me_id(), left(p_subject, 200), p_body, (select name from labs where id = p_lab))
  returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, x from unnest(ids) x where x is distinct from public.me_id() on conflict do nothing;
exception when others then null;
end $$;

-- ================= القراءة =================
-- المعامل ودوري فيها وعدد التنبيهات
create or replace function public.lab_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'لمنسوبي المدرسة فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name, 'icon', l.icon, 'my_role', private.lab_role(l.id),
      'alerts', case when private.lab_role(l.id) is not null then jsonb_array_length(private.lab_alerts_of(l.id)) else 0 end) order by l.sort, l.id)
    from labs l where l.active), '[]'::jsonb);
end $$;

-- صفحة المعمل كاملة: الحجوزات في الفترة + المخزون + التنبيهات + الطاقم
create or replace function public.lab_get(p_code text, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare lid int := private.lab_id(p_code); r text; f date := coalesce(p_from, current_date - 7); t date := coalesce(p_to, current_date + 21);
begin
  if not public.is_staff() then raise exception 'لمنسوبي المدرسة فقط'; end if;
  if lid is null then raise exception 'المعمل غير موجود'; end if;
  r := private.lab_role(lid);
  return jsonb_build_object(
    'lab', (select jsonb_build_object('id', id, 'code', code, 'name', name, 'icon', icon) from labs where id = lid),
    'my_role', r, 'me', public.me_id(),
    'bookings', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'day', b.day, 'period', b.period, 'class', b.class_label, 'subject', b.subject,
                    'title', b.title, 'needs', b.needs, 'items', b.items, 'status', b.status, 'tech_note', b.tech_note, 'used', b.used,
                    'teacher_id', b.teacher_id, 'teacher', p.full_name, 'mine', b.teacher_id = public.me_id(), 'created_at', b.created_at)
                  order by b.day, b.period)
                 from lab_bookings b join profiles p on p.id = b.teacher_id
                 where b.lab_id = lid and b.day between f and t and b.status <> 'cancelled'), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(private.lab_item_json(i) order by i.category, i.name) from lab_items i where i.lab_id = lid), '[]'::jsonb),
    'alerts', case when r is not null then private.lab_alerts_of(lid) else '[]'::jsonb end,
    'staff', coalesce((select jsonb_agg(jsonb_build_object('profile_id', s.profile_id, 'name', p.full_name, 'role', s.role) order by s.role desc, p.full_name)
                 from lab_staff s join profiles p on p.id = s.profile_id where s.lab_id = lid), '[]'::jsonb));
end $$;

-- سجل حركة صنف
create or replace function public.lab_item_history(p_item bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare lid int := (select lab_id from lab_items where id = p_item);
begin
  if private.lab_role(lid) is null then raise exception 'للمحضّر ومشرف المعمل فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('delta', g.delta, 'reason', g.reason, 'booking', g.booking, 'at', g.at, 'by', p.full_name) order by g.at desc)
    from lab_item_log g left join profiles p on p.id = g.by_id where g.item_id = p_item), '[]'::jsonb);
end $$;

-- تنبيهات معاملي (للرئيسية)
create or replace function public.lab_my_alerts() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', l.code, 'name', l.name, 'icon', l.icon, 'count', jsonb_array_length(private.lab_alerts_of(l.id)),
           'pending', (select count(*) from lab_bookings b where b.lab_id = l.id and b.status = 'pending' and b.day between current_date and current_date + 2)))
           filter (where jsonb_array_length(private.lab_alerts_of(l.id)) > 0
                      or exists (select 1 from lab_bookings b where b.lab_id = l.id and b.status = 'pending' and b.day between current_date and current_date + 2)), '[]'::jsonb)
  from labs l where l.active and exists (select 1 from lab_staff s where s.lab_id = l.id and s.profile_id = public.me_id())
$$;

-- ================= الحجز (المعلم) =================
create or replace function public.lab_book_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare lid int := private.lab_id(p->>'lab'); me uuid := public.me_id(); bid bigint := nullif(p->>'id','')::bigint; b lab_bookings;
        d date := (p->>'day')::date; per int := (p->>'period')::int; its jsonb := '[]'::jsonb; x jsonb;
begin
  if me is null or not public.is_staff() then raise exception 'لمنسوبي المدرسة فقط'; end if;
  if lid is null then raise exception 'المعمل غير موجود'; end if;
  if d is null or per is null or per not between 1 and 10 then raise exception 'اختر التاريخ والحصة'; end if;
  if d < current_date then raise exception 'لا يمكن الحجز في تاريخ مضى'; end if;
  if extract(dow from d) in (5, 6) then raise exception 'يوما الجمعة والسبت عطلة'; end if;
  if btrim(coalesce(p->>'title','')) = '' then raise exception 'اكتب عنوان الحصة أو التجربة'; end if;
  for x in select * from jsonb_array_elements(coalesce(p->'items','[]'::jsonb)) loop
    if exists (select 1 from lab_items where id = (x->>'id')::bigint and lab_id = lid) and coalesce((x->>'qty')::numeric, 0) > 0 then
      its := its || jsonb_build_array(jsonb_build_object('id', (x->>'id')::bigint, 'qty', (x->>'qty')::numeric)); end if;
  end loop;
  if bid is not null then
    select * into b from lab_bookings where id = bid;
    if b.id is null or b.lab_id <> lid then raise exception 'الحجز غير موجود'; end if;
    if b.teacher_id <> me and private.lab_role(lid) is null then raise exception 'تعديل الحجز لصاحبه فقط'; end if;
    if b.status in ('done','cancelled','rejected') then raise exception 'لا يمكن تعديل هذا الحجز'; end if;
  end if;
  if exists (select 1 from lab_bookings where lab_id = lid and day = d and period = per and status in ('pending','prepared','done') and id is distinct from bid) then
    raise exception 'هذه الحصة محجوزة في المعمل — اختر حصة أخرى'; end if;
  if bid is null then
    insert into lab_bookings(lab_id, teacher_id, day, period, class_label, subject, title, needs, items)
    values (lid, me, d, per, left(coalesce(p->>'class',''), 80), left(coalesce(p->>'subject',''), 80), left(btrim(p->>'title'), 200), left(coalesce(p->>'needs',''), 3000), its)
    returning * into b;
    perform private.lab_notify(lid, array['tech'], 'حجز جديد في ' || (select name from labs where id = lid) || ': ' || b.title,
      (select full_name from profiles where id = me) || ' حجز الحصة ' || per || ' يوم ' || d || coalesce(' — ' || nullif(b.class_label, ''), '') ||
      E'\n\nالتجهيزات المطلوبة:\n' || coalesce(nullif(b.needs, ''), '—') ||
      coalesce(E'\n\nمن المخزون:\n' || (select string_agg('• ' || i.name || ' × ' || trim(to_char((e->>'qty')::numeric, 'FM999999990.##')) || ' ' || i.unit, E'\n')
                                          from jsonb_array_elements(its) e join lab_items i on i.id = (e->>'id')::bigint), ''));
  else
    update lab_bookings set day = d, period = per, class_label = left(coalesce(p->>'class',''), 80), subject = left(coalesce(p->>'subject',''), 80),
      title = left(btrim(p->>'title'), 200), needs = left(coalesce(p->>'needs',''), 3000), items = its,
      status = 'pending', updated_at = now() where id = bid returning * into b;
    perform private.lab_notify(lid, array['tech'], 'تعديل حجز في ' || (select name from labs where id = lid) || ': ' || b.title,
      (select full_name from profiles where id = me) || ' عدّل حجزه: الحصة ' || per || ' يوم ' || d || E'\n\nالتجهيزات:\n' || coalesce(nullif(b.needs, ''), '—'));
  end if;
  return jsonb_build_object('ok', true, 'id', b.id);
end $$;

create or replace function public.lab_book_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare b lab_bookings;
begin
  select * into b from lab_bookings where id = p_id;
  if b.id is null then raise exception 'الحجز غير موجود'; end if;
  if b.teacher_id <> public.me_id() and private.lab_role(b.lab_id) is null then raise exception 'إلغاء الحجز لصاحبه فقط'; end if;
  if b.status = 'done' then raise exception 'الحصة تمت ولا يمكن إلغاؤها'; end if;
  update lab_bookings set status = 'cancelled', updated_at = now() where id = p_id;
  if b.teacher_id = public.me_id() then
    perform private.lab_notify(b.lab_id, array['tech'], 'إلغاء حجز: ' || b.title, 'أُلغي حجز الحصة ' || b.period || ' يوم ' || b.day || '.');
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ================= المحضّر ومشرف المعمل =================
-- تحديث حالة الحجز: prepared / done (مع المستهلَك) / rejected / pending
create or replace function public.lab_book_set(p_id bigint, p_status text, p_note text default '', p_used jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare b lab_bookings; x jsonb; q numeric; mid bigint; me uuid := public.me_id();
begin
  select * into b from lab_bookings where id = p_id;
  if b.id is null then raise exception 'الحجز غير موجود'; end if;
  if private.lab_role(b.lab_id) is null then raise exception 'للمحضّر ومشرف المعمل فقط'; end if;
  if p_status not in ('pending','prepared','done','rejected') then raise exception 'حالة غير صحيحة'; end if;
  if b.status = 'done' and p_status <> 'done' then raise exception 'الحصة مسجّلة «تمت» وخُصم المستهلَك من المخزون'; end if;
  if p_status = 'rejected' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب سبب الاعتذار للمعلم'; end if;
  if p_status = 'done' and b.status <> 'done' and jsonb_typeof(p_used) = 'array' then
    for x in select * from jsonb_array_elements(p_used) loop
      q := coalesce((x->>'qty')::numeric, 0);
      if q <= 0 then continue; end if;
      update lab_items set qty = greatest(0, qty - q), updated_at = now(), updated_by = me where id = (x->>'id')::bigint and lab_id = b.lab_id;
      if found then insert into lab_item_log(item_id, delta, reason, booking, by_id) values ((x->>'id')::bigint, -q, 'استُهلك في حصة: ' || b.title, b.id, me); end if;
    end loop;
  end if;
  update lab_bookings set status = p_status, tech_note = left(coalesce(p_note, ''), 1000),
    used = case when p_status = 'done' and b.status <> 'done' then p_used else used end, updated_at = now() where id = p_id;
  if p_status in ('prepared','rejected') and p_status <> b.status then
    insert into messages(kind, sender_id, subject, body, audience)
    values ('mail', me, case when p_status = 'prepared' then '✅ تم تجهيز المعمل لحصتك: ' else '⚠️ تعذّر تجهيز حصتك في المعمل: ' end || b.title,
            'الحصة ' || b.period || ' يوم ' || b.day || coalesce(E'\n\n' || nullif(btrim(p_note), ''), ''), (select name from labs where id = b.lab_id))
    returning id into mid;
    insert into message_recipients(message_id, profile_id) values (mid, b.teacher_id) on conflict do nothing;
  end if;
  return jsonb_build_object('ok', true);
exception when unique_violation then raise exception 'تعارض في الحجز';
end $$;

-- إضافة/تعديل صنف في المخزون
create or replace function public.lab_item_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare lid int := private.lab_id(p->>'lab'); iid bigint := nullif(p->>'id','')::bigint; old lab_items; me uuid := public.me_id(); nq numeric; i lab_items; was_alert boolean; now_alert boolean;
begin
  if lid is null then raise exception 'المعمل غير موجود'; end if;
  if private.lab_role(lid) is null then raise exception 'للمحضّر ومشرف المعمل فقط'; end if;
  if btrim(coalesce(p->>'name','')) = '' then raise exception 'اكتب اسم الصنف'; end if;
  nq := coalesce(nullif(p->>'qty','')::numeric, 0);
  if nq < 0 or coalesce(nullif(p->>'min_qty','')::numeric, 0) < 0 then raise exception 'الكمية لا تكون سالبة'; end if;
  if iid is not null then select * into old from lab_items where id = iid and lab_id = lid; if old.id is null then raise exception 'الصنف غير موجود'; end if; end if;
  was_alert := old.id is not null and ((old.min_qty > 0 and old.qty <= old.min_qty) or old.condition <> 'good' or (old.expiry is not null and old.expiry <= current_date + 30));
  if iid is null then
    insert into lab_items(lab_id, name, category, qty, unit, min_qty, condition, expiry, location, notes, updated_by)
    values (lid, left(btrim(p->>'name'), 150), coalesce(nullif(p->>'category',''), 'tool'), nq, coalesce(nullif(btrim(p->>'unit'),''), 'قطعة'),
            coalesce(nullif(p->>'min_qty','')::numeric, 0), coalesce(nullif(p->>'condition',''), 'good'), nullif(p->>'expiry','')::date,
            nullif(btrim(coalesce(p->>'location','')), ''), nullif(btrim(coalesce(p->>'notes','')), ''), me) returning * into i;
    insert into lab_item_log(item_id, delta, reason, by_id) values (i.id, nq, 'إضافة للمخزون', me);
  else
    update lab_items set name = left(btrim(p->>'name'), 150), category = coalesce(nullif(p->>'category',''), 'tool'), qty = nq,
      unit = coalesce(nullif(btrim(p->>'unit'),''), 'قطعة'), min_qty = coalesce(nullif(p->>'min_qty','')::numeric, 0),
      condition = coalesce(nullif(p->>'condition',''), 'good'), expiry = nullif(p->>'expiry','')::date,
      location = nullif(btrim(coalesce(p->>'location','')), ''), notes = nullif(btrim(coalesce(p->>'notes','')), ''), updated_at = now(), updated_by = me
     where id = iid returning * into i;
    if nq <> old.qty then insert into lab_item_log(item_id, delta, reason, by_id) values (iid, nq - old.qty, coalesce(nullif(btrim(p->>'reason'),''), 'تعديل الجرد'), me); end if;
  end if;
  -- تنبيه فوري لمشرف المعمل والمحضّر عند ظهور مشكلة جديدة في الصنف
  now_alert := (i.min_qty > 0 and i.qty <= i.min_qty) or i.condition <> 'good' or (i.expiry is not null and i.expiry <= current_date + 30);
  if now_alert and not coalesce(was_alert, false) then
    perform private.lab_notify(lid, array['tech','supervisor'], '⚠️ تنبيه مخزون ' || (select name from labs where id = lid) || ': ' || i.name,
      concat_ws(E'\n',
        case when i.min_qty > 0 and i.qty <= i.min_qty then '• الكمية ' || trim(to_char(i.qty, 'FM999999990.##')) || ' ' || i.unit || ' (الحد الأدنى ' || trim(to_char(i.min_qty, 'FM999999990.##')) || ')' end,
        case when i.condition = 'damaged' then '• الحالة: تالف' when i.condition = 'maintenance' then '• الحالة: يحتاج صيانة' end,
        case when i.expiry < current_date then '• انتهت الصلاحية في ' || i.expiry when i.expiry <= current_date + 30 then '• تنتهي الصلاحية في ' || i.expiry end));
  end if;
  return jsonb_build_object('ok', true, 'id', i.id);
end $$;

-- حركة سريعة: إضافة كمية (توريد) أو خصم (تالف/مستهلك)
create or replace function public.lab_item_adjust(p_id bigint, p_delta numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare i lab_items; me uuid := public.me_id(); before_low boolean;
begin
  select * into i from lab_items where id = p_id;
  if i.id is null then raise exception 'الصنف غير موجود'; end if;
  if private.lab_role(i.lab_id) is null then raise exception 'للمحضّر ومشرف المعمل فقط'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'اكتب الكمية'; end if;
  if btrim(coalesce(p_reason,'')) = '' then raise exception 'اكتب سبب الحركة (توريد، تالف، استهلاك…)'; end if;
  before_low := i.min_qty > 0 and i.qty <= i.min_qty;
  update lab_items set qty = greatest(0, qty + p_delta), updated_at = now(), updated_by = me where id = p_id returning * into i;
  insert into lab_item_log(item_id, delta, reason, by_id) values (p_id, p_delta, left(btrim(p_reason), 200), me);
  if i.min_qty > 0 and i.qty <= i.min_qty and not before_low then
    perform private.lab_notify(i.lab_id, array['tech','supervisor'], '⚠️ تنبيه مخزون ' || (select name from labs where id = i.lab_id) || ': ' || i.name,
      '• الكمية ' || trim(to_char(i.qty, 'FM999999990.##')) || ' ' || i.unit || ' (الحد الأدنى ' || trim(to_char(i.min_qty, 'FM999999990.##')) || ')');
  end if;
  return jsonb_build_object('ok', true, 'qty', i.qty);
end $$;

create or replace function public.lab_item_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare lid int := (select lab_id from lab_items where id = p_id);
begin
  if lid is null then raise exception 'الصنف غير موجود'; end if;
  if private.lab_role(lid) not in ('admin','supervisor') then raise exception 'حذف الأصناف لمشرف المعمل فقط (المحضّر يغيّر الحالة إلى «تالف»)'; end if;
  delete from lab_items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- الطاقم: مدير النظام ومشرف المعمل يحددون المحضّرين والمشرفين
create or replace function public.lab_staff_set(p_lab text, p_profile uuid, p_role text, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare lid int := private.lab_id(p_lab);
begin
  if lid is null then raise exception 'المعمل غير موجود'; end if;
  if coalesce(private.lab_role(lid), '') not in ('admin','supervisor') then raise exception 'لمدير النظام ومشرف المعمل فقط'; end if;
  if p_role not in ('tech','supervisor') then raise exception 'دور غير صحيح'; end if;
  if p_role = 'supervisor' and not public.is_admin() then raise exception 'تعيين مشرف المعمل لمدير النظام فقط'; end if;
  if p_on then
    if not exists (select 1 from profiles where id = p_profile and active and role::text not in ('student','parent')) then raise exception 'الموظف غير موجود'; end if;
    insert into lab_staff values (lid, p_profile, p_role) on conflict do nothing;
  else delete from lab_staff where lab_id = lid and profile_id = p_profile and role = p_role; end if;
  return jsonb_build_object('ok', true);
end $$;

-- تذكير يومي للمحضّر بالمخزون والحجوزات (يُستدعى من الجدولة)
create or replace function private.lab_daily_digest() returns void
language plpgsql security definer set search_path = public, private as $$
declare l record; a jsonb; nb int;
begin
  for l in select * from labs where active loop
    a := private.lab_alerts_of(l.id);
    nb := (select count(*) from lab_bookings where lab_id = l.id and day = current_date + 1 and status = 'pending');
    if jsonb_array_length(a) = 0 and nb = 0 then continue; end if;
    perform private.lab_notify(l.id, array['tech','supervisor'], '📋 ملخص ' || l.name || ' اليومي',
      case when nb > 0 then 'حجوزات الغد بانتظار التجهيز: ' || nb || E'\n\n' else '' end ||
      case when jsonb_array_length(a) > 0 then E'تنبيهات المخزون:\n' || (select string_agg('• ' || (x->>'name') || ' — ' || (x->>'msg'), E'\n') from jsonb_array_elements(a) x) else '' end);
  end loop;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lab-daily';
    perform cron.schedule('lab-daily', '0 11 * * 0-4', 'select private.lab_daily_digest()');   -- 2 ظهرًا بتوقيت الرياض، الأحد–الخميس
  end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['lab_list()','lab_get(text,date,date)','lab_item_history(bigint)','lab_my_alerts()','lab_book_save(jsonb)','lab_book_cancel(bigint)',
                           'lab_book_set(bigint,text,text,jsonb)','lab_item_save(jsonb)','lab_item_adjust(bigint,numeric,text)','lab_item_delete(bigint)',
                           'lab_staff_set(text,uuid,text,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function private.lab_role(int), private.lab_id(text), private.lab_alerts_of(int), private.lab_notify(int,text[],text,text), private.lab_daily_digest() from public, anon, authenticated;
