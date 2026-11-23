-- =====================================================================
-- 47: رابط Google Meet تلقائي لكل حصة أونلاين
--   - المعلم يوافق مرة واحدة (حساب جوجل المدرسي) فيُحفظ «مفتاح التجديد» في gm_tokens
--   - خادم «التعليم عن بعد» (action=meetGen) يقرأ حصص اليوم والغد من الجدول/حصص بالتاريخ،
--     ويُنشئ لكل حصة غرفة Meet باسم معلمها، ويحفظ الرابط في ol_meet_links
--   - صفحة التعليم عن بعد تعرض رابط الحصة تلقائيًا (الرابط المُدخل يدويًا للحصة له الأولوية)
-- =====================================================================
create table if not exists public.gm_tokens (
  profile_id    uuid primary key references public.profiles(id) on delete cascade,
  email         text,
  refresh_token text not null,
  scope         text,
  updated_at    timestamptz not null default now(),
  last_ok       timestamptz,
  last_error    text
);
create table if not exists public.ol_meet_links (
  day        date not null,
  room       text not null,          -- مفتاح الفصل في التعليم عن بعد: الصف|الفصل
  period     int  not null,
  teacher    text,
  profile_id uuid references public.profiles(id) on delete set null,
  uri        text not null,
  space      text,
  created_at timestamptz not null default now(),
  primary key (day, room, period)
);
alter table public.gm_tokens enable row level security;
alter table public.ol_meet_links enable row level security;
revoke all on public.gm_tokens, public.ol_meet_links from anon, authenticated;
grant select, insert, update, delete on public.gm_tokens, public.ol_meet_links to service_role;

-- حفظ موافقة المعلم (بعد الرجوع من جوجل)
create or replace function public.gm_save_token(p_refresh text, p_scope text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if me is null or not public.is_staff() then raise exception 'غير مصرح'; end if;
  if coalesce(btrim(p_refresh), '') = '' then raise exception 'لم تصل موافقة جوجل — أعد المحاولة'; end if;
  insert into gm_tokens(profile_id, email, refresh_token, scope)
  values (me, (select email from profiles where id = me), btrim(p_refresh), p_scope)
  on conflict (profile_id) do update set refresh_token = excluded.refresh_token, scope = excluded.scope, email = excluded.email,
    updated_at = now(), last_error = null;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.gm_unlink() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from gm_tokens where profile_id = public.me_id();
  return jsonb_build_object('ok', true);
end $$;

-- حالة المعلم: مربوط؟ وأسماؤه في الجداول، وروابطه القادمة
create or replace function public.gm_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); t gm_tokens;
begin
  if me is null then raise exception 'غير مصرح'; end if;
  select * into t from gm_tokens where profile_id = me;
  return jsonb_build_object('linked', t.profile_id is not null, 'since', t.updated_at, 'last_ok', t.last_ok, 'error', t.last_error,
    'upcoming', coalesce((select jsonb_agg(jsonb_build_object('d', day, 'r', room, 'p', period, 'u', uri) order by day, period)
                          from ol_meet_links where profile_id = me and day >= current_date), '[]'::jsonb));
end $$;

-- روابط الحصص لفترة (لكل مستخدم مسجّل: الطلاب يحتاجونها للدخول)
create or replace function public.olm_links(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if public.me_id() is null then raise exception 'غير مصرح'; end if;
  if p_to < p_from or p_to - p_from > 14 then raise exception 'نطاق غير صالح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('d', day, 'r', room, 'p', period, 'u', uri))
                   from ol_meet_links where day between p_from and p_to), '[]'::jsonb);
end $$;

-- ربط أسماء المعلمين في جداول التعليم عن بعد بحساباتهم (للخادم فقط):
-- أولًا جدول الأسماء البديلة staff_aliases، ثم تطابق فريد للاسم الأول واسم العائلة
create or replace function public.olm_resolve(p_names text[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(nm, pid), '{}'::jsonb) from (
    select n.nm, coalesce(
      (select a.profile_id from staff_aliases a where a.alias = public.norm(n.nm) limit 1),
      (select min(p.id::text)::uuid from profiles p where p.active and p.role not in ('student','parent')
         and split_part(public.norm(p.full_name), ' ', 1) = split_part(public.norm(n.nm), ' ', 1)
         and array_length(regexp_split_to_array(public.norm(n.nm), ' '), 1) >= 2
         and (' ' || public.norm(p.full_name) || ' ') like '% ' || (regexp_split_to_array(public.norm(n.nm), ' '))[array_length(regexp_split_to_array(public.norm(n.nm), ' '), 1)] || ' %'
       having count(*) = 1)) pid
    from (select distinct btrim(x) nm from unnest(p_names) x where coalesce(btrim(x), '') <> '') n) z
  where pid is not null
$$;

-- لوحة الإدارة: من ربط حسابه، وروابط اليوم
create or replace function public.gm_admin() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.me_role() in ('admin','leadership','principal','supervisor') or exists (select 1 from supervision_members m where m.profile_id = public.me_id() and m.active)) then
    raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'linked', coalesce((select jsonb_agg(jsonb_build_object('name', p.full_name, 'since', t.updated_at, 'ok', t.last_ok, 'error', t.last_error) order by p.full_name)
                        from gm_tokens t join profiles p on p.id = t.profile_id), '[]'::jsonb),
    'today', (select count(*) from ol_meet_links where day = (now() at time zone 'Asia/Riyadh')::date),
    'tomorrow', (select count(*) from ol_meet_links where day = (now() at time zone 'Asia/Riyadh')::date + 1));
end $$;

revoke all on function public.gm_save_token(text, text), public.gm_unlink(), public.gm_status(), public.olm_links(date, date), public.gm_admin() from public, anon;
grant execute on function public.gm_save_token(text, text), public.gm_unlink(), public.gm_status(), public.olm_links(date, date), public.gm_admin() to authenticated;
revoke all on function public.olm_resolve(text[]) from public, anon, authenticated;
grant execute on function public.olm_resolve(text[]) to service_role;
