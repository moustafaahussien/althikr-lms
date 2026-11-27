-- ============================================================
-- 82) المشتريات + الكتب المدرسية
-- المشتريات: طلب (للإداريين فقط) ← اعتماد المدير التنفيذي ← الشراء ← التسليم من المشتريات ← تأكيد الاستلام
-- الكتب المدرسية: طلب الكتب ← استلامها ← توزيعها على الطلاب والمعلمين ← المخزون
-- المسؤولون يُحدَّدون بالاسم من تبويب الإعدادات (وإلا بالمسمى الوظيفي افتراضيًا)
-- ============================================================

-- ======================= المشتريات =======================
create table if not exists public.pr_requests (
  id            bigserial primary key,
  title         text not null check (btrim(title) <> ''),
  department    text,
  priority      text not null default 'normal' check (priority in ('normal','high','urgent')),
  needed_by     date,
  justification text,
  requester_id  uuid references public.profiles(id) on delete set null,
  status        text not null default 'pending' check (status in ('pending','approved','rejected','purchasing','purchased','delivered','received','cancelled')),
  est_total     numeric(12,2) not null default 0,
  approver_id   uuid references public.profiles(id) on delete set null,
  approved_at   timestamptz,
  decision_note text,
  buyer_id      uuid references public.profiles(id) on delete set null,
  supplier      text,
  invoice_no    text,
  invoice_url   text,
  actual_total  numeric(12,2),
  purchased_at  timestamptz,
  delivered_at  timestamptz,
  delivered_to  text,
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.pr_items (
  id         bigserial primary key,
  request_id bigint not null references public.pr_requests(id) on delete cascade,
  name       text not null check (btrim(name) <> ''),
  specs      text,
  qty        numeric(10,2) not null check (qty > 0),
  unit       text not null default 'قطعة',
  est_price  numeric(12,2),
  appr_qty   numeric(10,2),
  act_price  numeric(12,2)
);
create table if not exists public.pr_log (
  id         bigserial primary key,
  request_id bigint not null references public.pr_requests(id) on delete cascade,
  by_id      uuid references public.profiles(id) on delete set null,
  status     text,
  note       text,
  at         timestamptz not null default now()
);
alter table public.pr_requests enable row level security; alter table public.pr_items enable row level security; alter table public.pr_log enable row level security;
revoke all on public.pr_requests, public.pr_items, public.pr_log from anon, authenticated;

create or replace function private.pr_ids(p_key text, p_re text) returns uuid[]
language sql stable security definer set search_path = public as $$
  select case when jsonb_typeof((select value -> p_key from app_settings where key = 'procurement')) = 'array'
              and jsonb_array_length((select value -> p_key from app_settings where key = 'procurement')) > 0
    then (select array_agg(x::uuid) from jsonb_array_elements_text((select value -> p_key from app_settings where key = 'procurement')) x)
    else (select coalesce(array_agg(id), '{}') from profiles where active and coalesce(job_title,'') ~ p_re) end
$$;
create or replace function private.pr_approvers() returns uuid[] language sql stable security definer set search_path = public, private as $$
  select private.pr_ids('approver_ids', '(المدير التنفيذي|الرئيس التنفيذي)') $$;
create or replace function private.pr_buyers() returns uuid[] language sql stable security definer set search_path = public, private as $$
  select private.pr_ids('buyer_ids', '(مشتريات|المشتريات)') $$;
create or replace function private.pr_is_approver() returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role() = 'admin' or public.me_id() = any (private.pr_approvers()) $$;
create or replace function private.pr_is_buyer() returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role() = 'admin' or public.me_id() = any (private.pr_buyers()) $$;
create or replace function private.pr_can_request() returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role()::text in ('admin','leadership','principal','staff') and private.beta_ok('procurement', array['leadership','principal','staff']) $$;
create or replace function private.pr_viewer() returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role()::text in ('admin','leadership') or private.pr_is_approver() or private.pr_is_buyer() $$;
create or replace function private.pr_st(v text) returns text language sql immutable as $$
  select case v when 'pending' then 'بانتظار اعتماد المدير التنفيذي' when 'approved' then 'معتمد — بانتظار الشراء' when 'rejected' then 'غير معتمد'
    when 'purchasing' then 'جارٍ الشراء' when 'purchased' then 'تم الشراء — بانتظار التسليم' when 'delivered' then 'سُلّم لمقدم الطلب'
    when 'received' then 'استلمه مقدم الطلب ✓' when 'cancelled' then 'ملغى' else v end $$;

create or replace function private.pr_json(r pr_requests, p_full boolean) returns jsonb language sql stable security definer set search_path = public, private as $$
  select to_jsonb(r) || jsonb_build_object('status_label', private.pr_st(r.status), 'requester', (select full_name from profiles where id = r.requester_id),
    'requester_job', (select job_title from profiles where id = r.requester_id), 'approver', (select full_name from profiles where id = r.approver_id),
    'buyer', (select full_name from profiles where id = r.buyer_id), 'mine', r.requester_id = public.me_id(),
    'items', case when p_full then coalesce((select jsonb_agg(to_jsonb(i) order by i.id) from pr_items i where i.request_id = r.id), '[]') end,
    'n_items', (select count(*) from pr_items where request_id = r.id),
    'log', case when p_full then coalesce((select jsonb_agg(jsonb_build_object('at', l.at, 'by', (select full_name from profiles where id = l.by_id), 'status', private.pr_st(l.status), 'note', l.note) order by l.at)
              from pr_log l where l.request_id = r.id), '[]') end)
$$;

create or replace function public.pr_me() returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('can_request', private.pr_can_request(), 'approver', private.pr_is_approver(), 'buyer', private.pr_is_buyer(), 'viewer', private.pr_viewer(),
    'settings', public.me_role()::text in ('admin','leadership'),
    'approvers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name)), '[]') from profiles where id = any (private.pr_approvers())),
    'buyers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name)), '[]') from profiles where id = any (private.pr_buyers())),
    'departments', coalesce((select value -> 'departments' from app_settings where key = 'procurement'), '[]'::jsonb),
    'counts', jsonb_build_object('pending', (select count(*) from pr_requests where status = 'pending'),
                                 'to_buy', (select count(*) from pr_requests where status in ('approved','purchasing')),
                                 'to_deliver', (select count(*) from pr_requests where status = 'purchased')))
$$;

create or replace function public.pr_list(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v text := coalesce(p ->> 'view', 'mine');
begin
  if v <> 'mine' and not private.pr_viewer() then v := 'mine'; end if;
  return coalesce((select jsonb_agg(private.pr_json(r, false) order by case r.priority when 'urgent' then 0 when 'high' then 1 else 2 end, r.created_at desc) from pr_requests r
    where case v when 'mine' then r.requester_id = public.me_id()
                 when 'approve' then r.status = 'pending'
                 when 'buy' then r.status in ('approved','purchasing','purchased')
                 else true end
      and (nullif(p ->> 'status', '') is null or r.status = p ->> 'status')
      and (nullif(btrim(p ->> 'q'), '') is null or public.norm(r.title || ' ' || coalesce(r.department, '') || ' ' || coalesce(r.supplier, '')) like '%' || public.norm(p ->> 'q') || '%' or r.id::text = btrim(p ->> 'q'))
    limit 500), '[]'::jsonb);
end $$;

create or replace function public.pr_get(p_id bigint) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare r pr_requests;
begin
  select * into r from pr_requests where id = p_id;
  if r.id is null or not (r.requester_id = public.me_id() or private.pr_viewer()) then raise exception 'غير متاح'; end if;
  return private.pr_json(r, true);
end $$;

create or replace function public.pr_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare rid bigint := nullif(p ->> 'id', '')::bigint; r pr_requests; it jsonb; n int := 0;
begin
  if not private.pr_can_request() then raise exception 'طلبات الشراء للإداريين فقط'; end if;
  if btrim(coalesce(p ->> 'title', '')) = '' then raise exception 'اكتب عنوان الطلب'; end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then raise exception 'أضف صنفًا واحدًا على الأقل'; end if;
  if rid is not null then
    select * into r from pr_requests where id = rid;
    if r.requester_id is distinct from public.me_id() or r.status not in ('pending','rejected') then raise exception 'لا يُعدَّل الطلب بعد اعتماده'; end if;
    delete from pr_items where request_id = rid;
  else
    insert into pr_requests(title, requester_id) values (btrim(p ->> 'title'), public.me_id()) returning id into rid;
  end if;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    continue when btrim(coalesce(it ->> 'name', '')) = '';
    insert into pr_items(request_id, name, specs, qty, unit, est_price) values (rid, btrim(it ->> 'name'), nullif(btrim(it ->> 'specs'), ''),
      greatest(coalesce(nullif(it ->> 'qty', '')::numeric, 1), 0.01), coalesce(nullif(btrim(it ->> 'unit'), ''), 'قطعة'), nullif(it ->> 'est_price', '')::numeric);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'أضف صنفًا واحدًا على الأقل'; end if;
  update pr_requests set title = btrim(p ->> 'title'), department = nullif(btrim(p ->> 'department'), ''), priority = coalesce(nullif(p ->> 'priority', ''), 'normal'),
    needed_by = nullif(p ->> 'needed_by', '')::date, justification = nullif(btrim(p ->> 'justification'), ''), status = 'pending', decision_note = null, approver_id = null, approved_at = null,
    est_total = (select coalesce(sum(qty * coalesce(est_price, 0)), 0) from pr_items where request_id = rid), updated_at = now() where id = rid returning * into r;
  insert into pr_log(request_id, by_id, status, note) values (rid, public.me_id(), 'pending', case when p ? 'id' and nullif(p ->> 'id', '') is not null then 'إعادة إرسال بعد التعديل' else 'رفع الطلب' end);
  perform private.cs_notify(private.pr_approvers(), case when r.priority = 'urgent' then '🚨 ' else '' end || '🛒 طلب شراء بانتظار اعتمادك: ' || r.title,
    'من: ' || (select full_name from profiles where id = public.me_id()) || coalesce(' — ' || r.department, '') || E'\nالأصناف: ' || n || ' · التقدير: ' || r.est_total || E' ريال\n' ||
    coalesce(r.justification || E'\n', '') || E'\nاعتمده من: المشتريات ← بانتظار الاعتماد.');
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

-- اعتماد المدير التنفيذي (يمكنه تعديل الكميات المعتمدة)
create or replace function public.pr_decide(p_id bigint, p_approve boolean, p_note text, p_qty jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r pr_requests;
begin
  if not private.pr_is_approver() then raise exception 'الاعتماد للمدير التنفيذي'; end if;
  select * into r from pr_requests where id = p_id for update;
  if r.status <> 'pending' then raise exception 'الطلب ليس بانتظار الاعتماد'; end if;
  if not p_approve and nullif(btrim(p_note), '') is null then raise exception 'اذكر سبب عدم الاعتماد'; end if;
  update pr_items set appr_qty = case when p_approve then coalesce(nullif(p_qty ->> id::text, '')::numeric, qty) end where request_id = p_id;
  update pr_requests set status = case when p_approve then 'approved' else 'rejected' end, approver_id = public.me_id(), approved_at = now(),
    decision_note = nullif(btrim(p_note), ''), updated_at = now() where id = p_id;
  insert into pr_log(request_id, by_id, status, note) values (p_id, public.me_id(), case when p_approve then 'approved' else 'rejected' end, nullif(btrim(p_note), ''));
  perform private.cs_notify(array[r.requester_id], case when p_approve then '✅ اعتُمد طلب الشراء: ' else '⛔ لم يُعتمد طلب الشراء: ' end || r.title, coalesce(nullif(btrim(p_note), ''), ''));
  if p_approve then perform private.cs_notify(private.pr_buyers(), '🛒 طلب شراء معتمد للتنفيذ: ' || r.title,
    'مقدم الطلب: ' || (select full_name from profiles where id = r.requester_id) || coalesce(E'\nمطلوب قبل: ' || r.needed_by, '') || E'\nنفّذه من: المشتريات ← للشراء والتسليم.'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- المشتريات: بدء الشراء ← تم الشراء (المورد والفاتورة والأسعار) ← التسليم
create or replace function public.pr_buy(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r pr_requests; st text := p ->> 'status'; k text; v text;
begin
  if not private.pr_is_buyer() then raise exception 'لقسم المشتريات'; end if;
  select * into r from pr_requests where id = p_id for update;
  if st = 'purchasing' and r.status = 'approved' then
    update pr_requests set status = 'purchasing', buyer_id = public.me_id(), updated_at = now() where id = p_id;
  elsif st = 'purchased' and r.status in ('approved','purchasing') then
    for k, v in select * from jsonb_each_text(coalesce(p -> 'prices', '{}')) loop
      update pr_items set act_price = nullif(v, '')::numeric where id = k::bigint and request_id = p_id;
    end loop;
    update pr_requests set status = 'purchased', buyer_id = coalesce(buyer_id, public.me_id()), supplier = nullif(btrim(p ->> 'supplier'), ''), invoice_no = nullif(btrim(p ->> 'invoice_no'), ''),
      invoice_url = case when btrim(coalesce(p ->> 'invoice_url', '')) ~ '^https?://' then btrim(p ->> 'invoice_url') end,
      actual_total = coalesce(nullif(p ->> 'actual_total', '')::numeric, (select sum(coalesce(appr_qty, qty) * act_price) from pr_items where request_id = p_id)),
      purchased_at = now(), updated_at = now() where id = p_id;
    perform private.cs_notify(array[r.requester_id], '📦 تم شراء طلبك: ' || r.title, 'سيتواصل معك قسم المشتريات للتسليم.');
  elsif st = 'delivered' and r.status = 'purchased' then
    update pr_requests set status = 'delivered', delivered_at = now(), delivered_to = nullif(btrim(p ->> 'delivered_to'), ''), updated_at = now() where id = p_id;
    perform private.cs_notify(array[r.requester_id], '✅ سُلّم طلب الشراء: ' || r.title, 'أكّد الاستلام من: المشتريات ← طلباتي.');
  elsif st = 'cancelled' and r.status in ('approved','purchasing') then
    if nullif(btrim(p ->> 'note'), '') is null then raise exception 'اذكر سبب الإلغاء'; end if;
    update pr_requests set status = 'cancelled', updated_at = now() where id = p_id;
    perform private.cs_notify(array[r.requester_id], '⛔ أُلغي طلب الشراء: ' || r.title, p ->> 'note');
  else raise exception 'انتقال غير مسموح من «%»', private.pr_st(r.status);
  end if;
  insert into pr_log(request_id, by_id, status, note) values (p_id, public.me_id(), st, nullif(btrim(p ->> 'note'), ''));
  return jsonb_build_object('ok', true);
end $$;

-- مقدم الطلب: تأكيد الاستلام أو إلغاء الطلب قبل اعتماده
create or replace function public.pr_requester(p_id bigint, p_action text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r pr_requests;
begin
  select * into r from pr_requests where id = p_id for update;
  if r.requester_id is distinct from public.me_id() then raise exception 'لمقدم الطلب'; end if;
  if p_action = 'received' and r.status = 'delivered' then update pr_requests set status = 'received', received_at = now(), updated_at = now() where id = p_id;
  elsif p_action = 'cancelled' and r.status in ('pending','rejected') then update pr_requests set status = 'cancelled', updated_at = now() where id = p_id;
  else raise exception 'غير مسموح الآن'; end if;
  insert into pr_log(request_id, by_id, status) values (p_id, public.me_id(), p_action);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pr_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.pr_viewer() then raise exception 'للمدير التنفيذي والمشتريات والإدارة'; end if;
  return (with b as (select * from pr_requests where (created_at at time zone 'Asia/Riyadh')::date between p_from and p_to)
  select jsonb_build_object('total', (select count(*) from b), 'pending', (select count(*) from b where status = 'pending'),
    'approved', (select count(*) from b where status not in ('pending','rejected','cancelled')), 'rejected', (select count(*) from b where status = 'rejected'),
    'est', (select coalesce(sum(est_total), 0) from b where status not in ('rejected','cancelled')), 'spent', (select coalesce(sum(actual_total), 0) from b where status in ('purchased','delivered','received')),
    'approve_hours', (select round(avg(extract(epoch from approved_at - created_at) / 3600)::numeric, 1) from b where approved_at is not null),
    'cycle_days', (select round(avg(extract(epoch from delivered_at - created_at) / 86400)::numeric, 1) from b where delivered_at is not null),
    'by_dept', (select coalesce(jsonb_agg(jsonb_build_object('label', coalesce(department, '—'), 'n', n, 'spent', s) order by s desc nulls last), '[]')
                from (select department, count(*) n, sum(actual_total) s from b where status not in ('rejected','cancelled') group by 1) z),
    'by_supplier', (select coalesce(jsonb_agg(jsonb_build_object('label', supplier, 'n', n, 'spent', s) order by s desc), '[]')
                    from (select supplier, count(*) n, sum(actual_total) s from b where supplier is not null group by 1) z),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'spent', s) order by m), '[]')
                 from (select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM') m, count(*) n, coalesce(sum(actual_total), 0) s from b group by 1) z)));
end $$;

create or replace function public.pr_settings_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if public.me_role()::text not in ('admin','leadership') then raise exception 'لمدير النظام والإدارة العليا'; end if;
  insert into app_settings(key, value) values ('procurement', jsonb_build_object(
    'approver_ids', coalesce(p -> 'approver_ids', '[]'), 'buyer_ids', coalesce(p -> 'buyer_ids', '[]'),
    'departments', coalesce((select jsonb_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'departments', '[]')) x where btrim(x) <> ''), '[]'::jsonb)))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- ======================= الكتب المدرسية =======================
create table if not exists public.tb_titles (
  id        bigserial primary key,
  title     text not null check (btrim(title) <> ''),
  subject   text,
  grade_id  int references public.grades(id) on delete set null,
  term      smallint not null default 0 check (term between 0 and 3),     -- 0 = كل الفصول
  kind      text not null default 'student' check (kind in ('student','activity','teacher','other')),
  per_student int not null default 1,
  active    boolean not null default true
);
create table if not exists public.tb_orders (
  id         bigserial primary key,
  label      text not null,
  term       smallint not null default 1,
  supplier   text,
  status     text not null default 'draft' check (status in ('draft','sent','partial','received','closed')),
  notes      text,
  sent_at    timestamptz,
  by_id      uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.tb_order_lines (
  order_id bigint not null references public.tb_orders(id) on delete cascade,
  title_id bigint not null references public.tb_titles(id) on delete restrict,
  qty      int not null check (qty >= 0),
  received int not null default 0,
  primary key (order_id, title_id)
);
-- حركة المخزون: استلام (+)، توزيع (−)، إرجاع (+)، تالف/مفقود (−)، تسوية
create table if not exists public.tb_moves (
  id         bigserial primary key,
  title_id   bigint not null references public.tb_titles(id) on delete cascade,
  delta      int not null,
  kind       text not null check (kind in ('receive','distribute','return','damaged','adjust')),
  order_id   bigint references public.tb_orders(id) on delete set null,
  student_id uuid references public.profiles(id) on delete set null,
  teacher_id uuid references public.profiles(id) on delete set null,
  note       text,
  by_id      uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists tb_moves_title on public.tb_moves(title_id);
create index if not exists tb_moves_student on public.tb_moves(student_id) where student_id is not null;
-- من استلم أي كتاب (للمنع من التكرار والمتابعة)
create table if not exists public.tb_holders (
  title_id   bigint not null references public.tb_titles(id) on delete cascade,
  holder_id  uuid not null references public.profiles(id) on delete cascade,
  qty        int not null default 1,
  at         timestamptz not null default now(),
  returned_at timestamptz,
  primary key (title_id, holder_id)
);
alter table public.tb_titles enable row level security; alter table public.tb_orders enable row level security; alter table public.tb_order_lines enable row level security;
alter table public.tb_moves enable row level security; alter table public.tb_holders enable row level security;
revoke all on public.tb_titles, public.tb_orders, public.tb_order_lines, public.tb_moves, public.tb_holders from anon, authenticated;

create or replace function private.tb_mgr() returns boolean language sql stable security definer set search_path = public, private as $$
  select public.me_role()::text in ('admin','leadership') or public.me_id() = any (
    case when jsonb_array_length(coalesce((select value -> 'officer_ids' from app_settings where key = 'textbooks'), '[]')) > 0
      then (select array_agg(x::uuid) from jsonb_array_elements_text((select value -> 'officer_ids' from app_settings where key = 'textbooks')) x)
      else (select coalesce(array_agg(id), '{}') from profiles where active and coalesce(job_title,'') ~ '(الكتب|كتب|مستودع|المستودع|مخازن|مصادر التعلم)') end) $$;
-- رائد الفصل يوزّع على فصله
create or replace function private.tb_can_class(p_class int) returns boolean language sql stable security definer set search_path = public, private as $$
  select private.tb_mgr() or exists (select 1 from classes where id = p_class and homeroom_teacher_id = public.me_id()) $$;
create or replace function private.tb_stock(p_title bigint) returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from tb_moves where title_id = p_title $$;
create or replace function private.tb_kind(v text) returns text language sql immutable as $$
  select case v when 'student' then 'كتاب الطالب' when 'activity' then 'كتاب النشاط' when 'teacher' then 'دليل المعلم' else 'أخرى' end $$;

create or replace function public.tb_me() returns jsonb language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('mgr', private.tb_mgr(), 'settings', public.me_role()::text in ('admin','leadership'),
    'my_classes', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.label, 'grade_id', c.grade_id) order by c.label), '[]') from v_classes c
                   where c.active and (private.tb_mgr() or c.homeroom_teacher_id = public.me_id())),
    'officers', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', full_name)), '[]') from profiles where id::text in
                 (select jsonb_array_elements_text(coalesce((select value -> 'officer_ids' from app_settings where key = 'textbooks'), '[]')))))
$$;

-- الكتالوج مع المخزون والاحتياج
create or replace function public.tb_titles_list(p_term int default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'للموظفين فقط'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'sort') from (select jsonb_build_object('id', t.id, 'title', t.title, 'subject', t.subject, 'grade_id', t.grade_id,
      'grade', g.name_ar || ' — ' || st.name_ar, 'term', t.term, 'kind', t.kind, 'kind_label', private.tb_kind(t.kind), 'per_student', t.per_student, 'active', t.active,
      'sort', lpad(coalesce(se.sort, 0)::text, 3, '0') || lpad(coalesce(st.sort, 0)::text, 3, '0') || lpad(coalesce(g.number, 0)::text, 3, '0') || coalesce(t.subject, '') || t.title,
      'stock', private.tb_stock(t.id),
      'received', (select coalesce(sum(delta), 0) from tb_moves where title_id = t.id and kind = 'receive'),
      'given', (select count(*) from tb_holders h where h.title_id = t.id and h.returned_at is null),
      -- الطلاب المستهدفون (كتب الطالب والنشاط) أو المعلمون (دليل المعلم)
      'need', case when t.kind = 'teacher' then (select count(distinct ta.teacher_id) from teaching_assignments ta join classes c on c.id = ta.class_id where c.grade_id = t.grade_id)
                   else (select count(*) from students s join profiles p on p.id = s.profile_id and p.active left join classes c on c.id = s.class_id where coalesce(c.grade_id, s.grade_id) = t.grade_id) * t.per_student end,
      'ordered', (select coalesce(sum(l.qty - l.received), 0) from tb_order_lines l join tb_orders o on o.id = l.order_id where l.title_id = t.id and o.status in ('sent','partial'))) x
    from tb_titles t left join grades g on g.id = t.grade_id left join stages st on st.id = g.stage_id left join sections se on se.id = st.section_id
    where p_term is null or t.term in (0, p_term)) z), '[]'::jsonb);
end $$;

create or replace function public.tb_title_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare tid bigint := nullif(p ->> 'id', '')::bigint;
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  if coalesce((p ->> 'delete')::boolean, false) then
    if exists (select 1 from tb_moves where title_id = tid) then update tb_titles set active = false where id = tid; return jsonb_build_object('ok', true, 'archived', true); end if;
    delete from tb_titles where id = tid; return jsonb_build_object('ok', true);
  end if;
  if btrim(coalesce(p ->> 'title', '')) = '' then raise exception 'اكتب اسم الكتاب'; end if;
  if tid is null then insert into tb_titles(title) values (btrim(p ->> 'title')) returning id into tid; end if;
  update tb_titles set title = btrim(p ->> 'title'), subject = nullif(btrim(p ->> 'subject'), ''), grade_id = nullif(p ->> 'grade_id', '')::int,
    term = coalesce(nullif(p ->> 'term', '')::smallint, 0), kind = coalesce(nullif(p ->> 'kind', ''), 'student'),
    per_student = greatest(1, coalesce(nullif(p ->> 'per_student', '')::int, 1)), active = coalesce((p ->> 'active')::boolean, true) where id = tid;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

-- استيراد سريع: سطر لكل كتاب «الصف | المادة | العنوان | الفصل | النوع»
create or replace function public.tb_titles_bulk(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; n int := 0;
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when btrim(coalesce(r ->> 'title', '')) = '' or nullif(r ->> 'grade_id', '') is null;
    if not exists (select 1 from tb_titles where grade_id = (r ->> 'grade_id')::int and title = btrim(r ->> 'title') and term = coalesce(nullif(r ->> 'term', '')::smallint, 0)) then
      insert into tb_titles(title, subject, grade_id, term, kind) values (btrim(r ->> 'title'), nullif(btrim(r ->> 'subject'), ''), (r ->> 'grade_id')::int,
        coalesce(nullif(r ->> 'term', '')::smallint, 0), coalesce(nullif(r ->> 'kind', ''), 'student'));
      n := n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'added', n);
end $$;

-- ---------- الطلب ----------
create or replace function public.tb_orders_list() returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  return coalesce((select jsonb_agg(to_jsonb(o) || jsonb_build_object('by', (select full_name from profiles where id = o.by_id),
      'qty', (select coalesce(sum(qty), 0) from tb_order_lines where order_id = o.id), 'received', (select coalesce(sum(received), 0) from tb_order_lines where order_id = o.id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('title_id', l.title_id, 'title', t.title, 'subject', t.subject, 'kind', private.tb_kind(t.kind),
          'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = t.grade_id), 'qty', l.qty, 'received', l.received) order by t.grade_id, t.subject, t.title), '[]')
        from tb_order_lines l join tb_titles t on t.id = l.title_id where l.order_id = o.id)) order by o.created_at desc) from tb_orders o), '[]'::jsonb);
end $$;

create or replace function public.tb_order_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare oid bigint := nullif(p ->> 'id', '')::bigint; l jsonb;
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  if oid is not null and (select status from tb_orders where id = oid) <> 'draft' then raise exception 'لا يُعدَّل الطلب بعد إرساله'; end if;
  if oid is null then insert into tb_orders(label, term, by_id) values (coalesce(nullif(btrim(p ->> 'label'), ''), 'طلب كتب'), coalesce(nullif(p ->> 'term', '')::smallint, 1), public.me_id()) returning id into oid; end if;
  update tb_orders set label = coalesce(nullif(btrim(p ->> 'label'), ''), label), term = coalesce(nullif(p ->> 'term', '')::smallint, term), supplier = nullif(btrim(p ->> 'supplier'), ''),
    notes = nullif(btrim(p ->> 'notes'), '') where id = oid;
  delete from tb_order_lines where order_id = oid;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]')) loop
    continue when coalesce((l ->> 'qty')::int, 0) <= 0;
    insert into tb_order_lines(order_id, title_id, qty) values (oid, (l ->> 'title_id')::bigint, (l ->> 'qty')::int) on conflict (order_id, title_id) do update set qty = excluded.qty;
  end loop;
  if coalesce((p ->> 'send')::boolean, false) then
    if not exists (select 1 from tb_order_lines where order_id = oid) then raise exception 'الطلب فارغ'; end if;
    update tb_orders set status = 'sent', sent_at = now() where id = oid;
  end if;
  return jsonb_build_object('ok', true, 'id', oid);
end $$;

-- ---------- الاستلام ----------
create or replace function public.tb_receive(p_order bigint, p_lines jsonb, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare k text; v text; q int; tot int := 0;
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  for k, v in select * from jsonb_each_text(p_lines) loop
    q := coalesce(nullif(v, '')::int, 0); continue when q = 0;
    if p_order is not null then
      update tb_order_lines set received = received + q where order_id = p_order and title_id = k::bigint;
    end if;
    insert into tb_moves(title_id, delta, kind, order_id, note, by_id) values (k::bigint, q, 'receive', p_order, nullif(btrim(p_note), ''), public.me_id());
    tot := tot + q;
  end loop;
  if p_order is not null then
    update tb_orders set status = case when (select bool_and(received >= qty) from tb_order_lines where order_id = p_order) then 'received' else 'partial' end where id = p_order and status in ('sent','partial','draft');
  end if;
  return jsonb_build_object('ok', true, 'received', tot);
end $$;

-- ---------- التوزيع ----------
-- كشف فصل: الطلاب × كتب صفهم، ومن استلم
create or replace function public.tb_class_sheet(p_class int, p_term int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare g int := (select grade_id from classes where id = p_class);
begin
  if not private.tb_can_class(p_class) then raise exception 'التوزيع لمسؤول الكتب ورائد الفصل'; end if;
  return jsonb_build_object(
    'titles', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'subject', t.subject, 'kind', private.tb_kind(t.kind), 'stock', private.tb_stock(t.id)) order by t.subject, t.title), '[]')
               from tb_titles t where t.active and t.grade_id = g and t.kind in ('student','activity','other') and t.term in (0, p_term)),
    'students', (select coalesce(jsonb_agg(jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number,
        'has', (select coalesce(jsonb_agg(h.title_id), '[]') from tb_holders h where h.holder_id = s.profile_id and h.returned_at is null)) order by p.full_name), '[]')
               from students s join profiles p on p.id = s.profile_id and p.active where s.class_id = p_class));
end $$;

-- توزيع/إلغاء/إرجاع: items = [{holder_id, title_id, action: give|undo|return|lost}]
create or replace function public.tb_distribute(p_items jsonb, p_class int default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare it jsonb; a text; hid uuid; tid bigint; n int := 0; short text := null; is_stu boolean;
begin
  if not (private.tb_mgr() or (p_class is not null and private.tb_can_class(p_class))) then raise exception 'التوزيع لمسؤول الكتب ورائد الفصل'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    a := it ->> 'action'; hid := (it ->> 'holder_id')::uuid; tid := (it ->> 'title_id')::bigint;
    if p_class is not null and not private.tb_mgr() and not exists (select 1 from students where profile_id = hid and class_id = p_class) then continue; end if;
    is_stu := exists (select 1 from students where profile_id = hid);
    if a = 'give' then
      continue when exists (select 1 from tb_holders where title_id = tid and holder_id = hid and returned_at is null);
      if private.tb_stock(tid) < 1 then short := (select title from tb_titles where id = tid); continue; end if;
      insert into tb_holders(title_id, holder_id) values (tid, hid) on conflict (title_id, holder_id) do update set returned_at = null, at = now();
      insert into tb_moves(title_id, delta, kind, student_id, teacher_id, by_id) values (tid, -1, 'distribute', case when is_stu then hid end, case when not is_stu then hid end, public.me_id());
    elsif a = 'undo' then
      delete from tb_holders where title_id = tid and holder_id = hid and returned_at is null;
      continue when not found;
      insert into tb_moves(title_id, delta, kind, student_id, teacher_id, note, by_id) values (tid, 1, 'adjust', case when is_stu then hid end, case when not is_stu then hid end, 'تراجع عن تسليم', public.me_id());
    elsif a in ('return','lost') then
      update tb_holders set returned_at = now() where title_id = tid and holder_id = hid and returned_at is null;
      continue when not found;
      if a = 'return' then insert into tb_moves(title_id, delta, kind, student_id, teacher_id, by_id) values (tid, 1, 'return', case when is_stu then hid end, case when not is_stu then hid end, public.me_id());
      else insert into tb_moves(title_id, delta, kind, student_id, note, by_id) values (tid, 0, 'damaged', case when is_stu then hid end, 'فقده الطالب', public.me_id()); end if;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'done', n, 'short', short);
end $$;

-- أدلة المعلم: المعلمون المسندون لمادة/صف الكتاب
create or replace function public.tb_teacher_sheet(p_title bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare t tb_titles;
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  select * into t from tb_titles where id = p_title;
  return jsonb_build_object('title', t.title, 'stock', private.tb_stock(t.id), 'teachers', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
      'subjects', (select string_agg(distinct sb.name_ar, '، ') from teaching_assignments ta join subjects sb on sb.id = ta.subject_id join classes c on c.id = ta.class_id where ta.teacher_id = p.id and c.grade_id = t.grade_id),
      'has', exists (select 1 from tb_holders h where h.title_id = t.id and h.holder_id = p.id and h.returned_at is null)) order by p.full_name)
    from profiles p where p.active and exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id where ta.teacher_id = p.id and c.grade_id = t.grade_id)), '[]'));
end $$;

-- ---------- المخزون ----------
create or replace function public.tb_adjust(p_title bigint, p_delta int, p_kind text, p_note text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  if p_kind not in ('damaged','adjust','receive') then raise exception 'نوع غير صحيح'; end if;
  if nullif(btrim(p_note), '') is null and p_kind <> 'receive' then raise exception 'اذكر السبب'; end if;
  insert into tb_moves(title_id, delta, kind, note, by_id) values (p_title, case when p_kind = 'damaged' then -abs(p_delta) else p_delta end, p_kind, nullif(btrim(p_note), ''), public.me_id());
  return jsonb_build_object('ok', true, 'stock', private.tb_stock(p_title));
end $$;

create or replace function public.tb_moves_list(p_title bigint) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('at', m.at, 'delta', m.delta, 'kind', m.kind, 'note', m.note, 'by', (select full_name from profiles where id = m.by_id),
      'who', (select full_name from profiles where id = coalesce(m.student_id, m.teacher_id)), 'order', (select label from tb_orders where id = m.order_id)) order by m.at desc)
    from (select * from tb_moves where title_id = p_title order by at desc limit 300) m), '[]'::jsonb);
end $$;

-- تقدّم التوزيع لكل فصل
create or replace function public.tb_progress(p_term int) returns jsonb language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tb_mgr() then raise exception 'لمسؤول الكتب'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('class_id', c.id, 'class', c.label, 'homeroom', (select full_name from profiles where id = c.homeroom_teacher_id),
      'students', c.student_count, 'titles', (select count(*) from tb_titles t where t.active and t.grade_id = c.grade_id and t.kind in ('student','activity','other') and t.term in (0, p_term)),
      'given', (select count(*) from tb_holders h join students s on s.profile_id = h.holder_id join tb_titles t on t.id = h.title_id
                 where s.class_id = c.id and h.returned_at is null and t.kind in ('student','activity','other') and t.term in (0, p_term)))
      order by c.section_id, c.stage_sort, c.grade_number, c.name) from v_classes c where c.active), '[]'::jsonb);
end $$;

create or replace function public.tb_settings_set(p_officers jsonb) returns jsonb language plpgsql security definer set search_path = public, private as $$
begin
  if public.me_role()::text not in ('admin','leadership') then raise exception 'لمدير النظام والإدارة العليا'; end if;
  insert into app_settings(key, value) values ('textbooks', jsonb_build_object('officer_ids', coalesce(p_officers, '[]'))) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

-- كتب الطالب (له ولولي أمره)
create or replace function private.tb_child(p_student uuid) returns jsonb language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', t.title, 'subject', t.subject, 'at', h.at) order by t.subject), '[]')
  from tb_holders h join tb_titles t on t.id = h.title_id where h.holder_id = p_student and h.returned_at is null
$$;

-- ---------- المهام ----------
create or replace function private.pt_tasks() returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare out jsonb := '[]'::jsonb; n int; me uuid := public.me_id();
begin
  if me = any (private.pr_approvers()) then
    select count(*) into n from pr_requests where status = 'pending';
    if n > 0 then out := out || jsonb_build_object('icon', '🛒', 'text', n || ' طلب شراء بانتظار اعتمادك', 'link', 'procurement.html#approve'); end if;
  end if;
  if me = any (private.pr_buyers()) then
    select count(*) into n from pr_requests where status in ('approved','purchasing','purchased');
    if n > 0 then out := out || jsonb_build_object('icon', '🛍️', 'text', n || ' طلب شراء معتمد للتنفيذ أو التسليم', 'link', 'procurement.html#buy'); end if;
  end if;
  select count(*) into n from pr_requests where requester_id = me and status = 'delivered';
  if n > 0 then out := out || jsonb_build_object('icon', '📦', 'text', n || ' طلب شراء سُلّم لك — أكّد الاستلام', 'link', 'procurement.html#mine'); end if;
  return out;
end $$;

-- my_tasks: نسخة 81 + المشتريات
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
  return out;
end $$;

-- خدمات الطالب (81) + كتبه المستلمة
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
    'books', private.tb_child(p_student),
    'transport_request', (select jsonb_build_object('status', q.status, 'reply', q.reply, 'created_at', q.created_at) from tr_requests q where q.student_id = p_student order by q.created_at desc limit 1))
$$;


do $$ declare f text; begin
  foreach f in array array['private.pr_ids(text, text)','private.pr_approvers()','private.pr_buyers()','private.pr_is_approver()','private.pr_is_buyer()','private.pr_can_request()',
    'private.pr_viewer()','private.pr_st(text)','private.pr_json(pr_requests, boolean)','private.tb_mgr()','private.tb_can_class(int)','private.tb_stock(bigint)','private.tb_kind(text)',
    'private.tb_child(uuid)','private.pt_tasks()','private.cs_child(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
  foreach f in array array['pr_me()','pr_list(jsonb)','pr_get(bigint)','pr_submit(jsonb)','pr_decide(bigint, boolean, text, jsonb)','pr_buy(bigint, jsonb)','pr_requester(bigint, text)',
    'pr_stats(date, date)','pr_settings_set(jsonb)','tb_me()','tb_titles_list(int)','tb_title_save(jsonb)','tb_titles_bulk(jsonb)','tb_orders_list()','tb_order_save(jsonb)',
    'tb_receive(bigint, jsonb, text)','tb_class_sheet(int, int)','tb_distribute(jsonb, int)','tb_teacher_sheet(bigint)','tb_adjust(bigint, int, text, text)','tb_moves_list(bigint)',
    'tb_progress(int)','tb_settings_set(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
