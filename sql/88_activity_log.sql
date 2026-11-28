-- ============================================================
-- 88) سجل النشاطات: مين دخل المنصة، إمتى، من أي جهاز، وفتح أي صفحات
--     - كل مستخدم يسجّل نشاطه هو فقط (act_log) — لا يقدر يكتب باسم غيره
--     - «دخول» = أول صفحة في جلسة المتصفح، و«صفحة» = كل صفحة يفتحها (لا تتكرر نفس الصفحة خلال دقيقتين)
--     - القراءة لمدير النظام فقط (act_list / act_people / act_stats)
--     - يُحذف تلقائيًا ما زاد عمره عن 400 يوم
-- ============================================================
create table if not exists public.activity_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role       text,
  kind       text not null check (kind in ('login', 'page', 'action')),
  page       text,
  title      text,
  detail     text,
  device     text
);
create index if not exists activity_log_at_idx on public.activity_log (at desc);
create index if not exists activity_log_who_idx on public.activity_log (profile_id, at desc);
alter table public.activity_log enable row level security;
revoke all on public.activity_log from anon, authenticated;
revoke all on sequence public.activity_log_id_seq from anon, authenticated;

-- تسجيل نشاط المستخدم الحالي
create or replace function public.act_log(p_kind text, p_page text, p_title text, p_detail text, p_device text) returns void
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); k text := case when p_kind in ('login', 'page', 'action') then p_kind else 'page' end;
begin
  if me is null then return; end if;
  -- نفس الصفحة خلال دقيقتين لا تتكرر (تحديث الصفحة)
  if k = 'page' and exists (select 1 from activity_log where profile_id = me and kind = 'page' and page = left(p_page, 200) and at > now() - interval '2 minutes') then return; end if;
  insert into activity_log(profile_id, role, kind, page, title, detail, device)
  values (me, public.me_role()::text, k, left(p_page, 200), left(p_title, 200), left(p_detail, 500), left(p_device, 120));
  -- تنظيف دوري خفيف
  if random() < 0.01 then delete from activity_log where at < now() - interval '400 days'; end if;
end $$;
revoke all on function public.act_log(text, text, text, text, text) from public, anon;
grant execute on function public.act_log(text, text, text, text, text) to authenticated;

-- السجل التفصيلي (مدير النظام): p = {from, to (YYYY-MM-DD بتوقيت الرياض), role, kind, q (اسم), who (uuid), limit}
create or replace function public.act_list(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d1 date := coalesce(nullif(p ->> 'from', '')::date, (now() at time zone 'Asia/Riyadh')::date);
        d2 date := coalesce(nullif(p ->> 'to', '')::date, (now() at time zone 'Asia/Riyadh')::date);
        lim int := least(greatest(coalesce((p ->> 'limit')::int, 500), 1), 3000);
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
    select jsonb_build_object('id', a.id, 'at', a.at, 'kind', a.kind, 'page', a.page, 'title', a.title, 'detail', a.detail, 'device', a.device,
             'role', a.role, 'who', a.profile_id, 'name', pr.full_name, 'job', pr.job_title, 'email', pr.email) x
    from activity_log a join profiles pr on pr.id = a.profile_id
    where (a.at at time zone 'Asia/Riyadh')::date between d1 and d2
      and (coalesce(p ->> 'role', '') = '' or a.role = p ->> 'role')
      and (coalesce(p ->> 'kind', '') = '' or a.kind = p ->> 'kind')
      and (coalesce(p ->> 'who', '') = '' or a.profile_id = (p ->> 'who')::uuid)
      and (coalesce(p ->> 'q', '') = '' or public.name_match(pr.full_name || ' ' || coalesce(pr.email, ''), p ->> 'q'))
    order by a.at desc limit lim) s), '[]');
end $$;

-- ملخص لكل مستخدم في الفترة: أول وآخر ظهور، مرات الدخول، عدد الصفحات، أكثر الصفحات
create or replace function public.act_people(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d1 date := coalesce(nullif(p ->> 'from', '')::date, (now() at time zone 'Asia/Riyadh')::date);
        d2 date := coalesce(nullif(p ->> 'to', '')::date, (now() at time zone 'Asia/Riyadh')::date);
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  return coalesce((select jsonb_agg(x order by x ->> 'last' desc) from (
    select jsonb_build_object('who', pr.id, 'name', pr.full_name, 'job', pr.job_title, 'role', pr.role, 'email', pr.email,
             'first', min(a.at), 'last', max(a.at), 'logins', count(*) filter (where a.kind = 'login'), 'pages', count(*) filter (where a.kind = 'page'),
             'days', count(distinct (a.at at time zone 'Asia/Riyadh')::date),
             'device', (array_agg(a.device order by a.at desc))[1],
             'top', (select string_agg(t, '، ') from (select coalesce(b.title, b.page) t from activity_log b where b.profile_id = pr.id and b.kind = 'page'
                       and (b.at at time zone 'Asia/Riyadh')::date between d1 and d2 group by 1 order by count(*) desc limit 3) z)) x
    from activity_log a join profiles pr on pr.id = a.profile_id
    where (a.at at time zone 'Asia/Riyadh')::date between d1 and d2
      and (coalesce(p ->> 'role', '') = '' or a.role = p ->> 'role')
      and (coalesce(p ->> 'q', '') = '' or public.name_match(pr.full_name || ' ' || coalesce(pr.email, ''), p ->> 'q'))
    group by pr.id) s), '[]');
end $$;

-- إحصاءات الفترة: المستخدمون الفريدون، حسب الدور، حسب اليوم، حسب الساعة، أكثر الصفحات، ومن لم يدخل من الموظفين
create or replace function public.act_stats(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d1 date := coalesce(nullif(p ->> 'from', '')::date, (now() at time zone 'Asia/Riyadh')::date);
        d2 date := coalesce(nullif(p ->> 'to', '')::date, (now() at time zone 'Asia/Riyadh')::date);
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  return (with a as (select * from activity_log where (at at time zone 'Asia/Riyadh')::date between d1 and d2)
    select jsonb_build_object(
      'from', d1, 'to', d2,
      'users', (select count(distinct profile_id) from a),
      'logins', (select count(*) from a where kind = 'login'),
      'pages', (select count(*) from a where kind = 'page'),
      'now', (select count(distinct profile_id) from activity_log where at > now() - interval '15 minutes'),
      'by_role', coalesce((select jsonb_object_agg(role, n) from (select role, count(distinct profile_id) n from a group by role) r), '{}'),
      'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'users', u, 'logins', l) order by d) from (
          select (at at time zone 'Asia/Riyadh')::date d, count(distinct profile_id) u, count(*) filter (where kind = 'login') l from a group by 1) r), '[]'),
      'by_hour', coalesce((select jsonb_agg(jsonb_build_object('h', h, 'n', n) order by h) from (
          select extract(hour from at at time zone 'Asia/Riyadh')::int h, count(*) n from a group by 1) r), '[]'),
      'top_pages', coalesce((select jsonb_agg(jsonb_build_object('page', t, 'n', n, 'users', u) order by n desc) from (
          select coalesce(title, page) t, count(*) n, count(distinct profile_id) u from a where kind = 'page' group by 1 order by 2 desc limit 12) r), '[]'),
      'absent_staff', coalesce((select jsonb_agg(jsonb_build_object('name', full_name, 'job', job_title, 'role', role) order by full_name) from profiles pr
          where pr.active and pr.role::text not in ('student', 'parent') and not exists (select 1 from a where a.profile_id = pr.id)), '[]')));
end $$;

revoke all on function public.act_list(jsonb), public.act_people(jsonb), public.act_stats(jsonb) from public, anon;
grant execute on function public.act_list(jsonb), public.act_people(jsonb), public.act_stats(jsonb) to authenticated;
