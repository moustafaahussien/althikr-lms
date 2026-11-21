-- =====================================================================
--  الملف 6: منصة الإشراف التربوي — الخادم الكامل على Supabase
--  (بديل Google Sheets / Apps Script)
--  - أعضاء المنصة = حسابات منصة المدرسة (الدخول الموحّد بحساب Google)
--  - بيانات كل مشرف (جدوله، إعداداته، تذكيراته، تقييماته، جلساته) في supervision_data
--  - الرسائل، الإشعارات المجدولة، وإرسال الإشعارات للجوال كل دقيقة (pg_cron + pg_net + OneSignal)
--  كل الجداول مغلقة تمامًا، والوصول فقط عبر دوال sv_* التي تتحقق من الصلاحية.
-- =====================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.secrets (key text primary key, value text not null);

-- ---------- الجداول ----------
create table if not exists public.supervision_members (
  profile_id  uuid primary key references public.profiles(id) on delete cascade,
  dept        text not null default '',
  sup_role    text not null default 'member' check (sup_role in ('member','admin','sys')),
  active      boolean not null default true,
  added_at    timestamptz not null default now(),
  legacy_code text
);

create table if not exists public.supervision_data (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  stamp      bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.supervision_messages (
  id         text primary key,
  created_at timestamptz not null default now(),
  title      text not null default '',
  body       text not null default '',
  targets    uuid[],                      -- null = كل المشرفين
  sender     text not null default '',
  pushed     boolean not null default false
);
create index if not exists sv_msgs_at on public.supervision_messages(created_at desc);

create table if not exists public.supervision_schedules (
  id         text primary key,
  title      text not null default '',
  body       text not null default '',
  targets    text not null default 'all', -- 'all' أو معرّفات مفصولة بفاصلة
  kind       text not null default 'repeat' check (kind in ('once','repeat')),
  on_date    text not null default '',
  days       text not null default '',
  at_time    text not null default '',
  active     boolean not null default true,
  inbox      boolean not null default false,
  last_sent  text not null default '',
  created_by text not null default ''
);

create table if not exists public.supervision_push_log (
  key     text primary key,
  sent_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['supervision_members','supervision_data','supervision_messages',
                           'supervision_schedules','supervision_push_log']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- تنبيه صلاة الظهر اليومي (كما في المنصة القديمة)
insert into public.supervision_schedules(id, title, body, targets, kind, days, at_time, active, inbox, created_by)
values ('dhuhr', '🕌 صلاة الظهر', 'حان الآن وقت التوجه لصلاة الظهر.', 'all', 'repeat', '0,1,2,3,4', '12:55', true, false, 'النظام')
on conflict (id) do nothing;

-- ---------- أدوات ----------
create or replace function private.ms(t timestamptz) returns bigint
language sql immutable as $$ select (extract(epoch from t) * 1000)::bigint $$;

-- معرّف الجهاز في OneSignal (نفس صيغة المنصة القديمة)
create or replace function private.sv_ext_id(pid uuid) returns text
language sql immutable as $$
  select 'tt_' || left(encode(sha256(convert_to('tt:' || pid::text, 'UTF8')), 'hex'), 24)
$$;

-- دوري في منصة الإشراف: owner (مدير نظام المنصة) / sys / admin / member — أو null إن لم أكن عضوًا مفعّلًا
create or replace function private.sv_role(pid uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare r public.user_role; m record;
begin
  if pid is null then return null; end if;
  select role into r from profiles where id = pid and active;
  if r is null then return null; end if;
  if r = 'admin' then return 'owner'; end if;
  select * into m from supervision_members where profile_id = pid;
  if m is null or not m.active then return null; end if;
  return m.sup_role;
end $$;

create or replace function private.sv_users() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(u order by (u->>'role') = 'owner' desc, u->>'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'code', p.id, 'name', p.full_name, 'email', p.email, 'dept', coalesce(m.dept, ''),
      'active', coalesce(m.active, true) and p.active,
      'role', case when p.role = 'admin' then 'owner' when m.sup_role = 'member' then '' else m.sup_role end,
      'admin', p.role = 'admin' or m.sup_role in ('admin','sys'),
      'added', private.ms(coalesce(m.added_at, p.created_at)),
      'updated', coalesce(private.ms(d.updated_at), 0)) u
    from profiles p
    left join supervision_members m on m.profile_id = p.id
    left join supervision_data d on d.profile_id = p.id
    where m.profile_id is not null or p.role = 'admin') x
$$;

-- إرسال إشعار OneSignal (غير متزامن عبر pg_net)
create or replace function private.sv_push(ids text[], p_title text, p_body text, p_ref text, p_url text, p_ttl int)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare k text; payload jsonb;
begin
  select value into k from private.secrets where key = 'onesignal_key';
  if k is null or coalesce(array_length(ids, 1), 0) = 0 then return false; end if;
  payload := jsonb_build_object(
    'app_id', '0ab398f6-a82a-4bc6-ac4d-aab5d6cfb915',
    'target_channel', 'push',
    'include_aliases', jsonb_build_object('external_id', to_jsonb(ids)),
    'headings', jsonb_build_object('en', p_title, 'ar', p_title),
    'contents', jsonb_build_object('en', p_body, 'ar', p_body),
    'url', coalesce(p_url, 'https://moustafaahussien.github.io/althikr-lms/supervision/'),
    'web_push_topic', left(coalesce(p_ref, ''), 60),
    'priority', 10);
  if p_ttl is not null then payload := payload || jsonb_build_object('ttl', p_ttl); end if;
  perform net.http_post(
    url := 'https://api.onesignal.com/notifications',
    body := payload,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Key ' || k));
  return true;
end $$;

-- معرّفات أجهزة مجموعة أعضاء (null = كل الأعضاء المفعّلين)
create or replace function private.sv_targets(want uuid[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}') from profiles p
  left join supervision_members m on m.profile_id = p.id
  where p.active and ((m.profile_id is not null and m.active) or p.role = 'admin')
    and (want is null or p.id = any(want))
$$;

create or replace function private.sv_parse_targets(t text) returns uuid[]
language plpgsql immutable as $$
declare out uuid[] := '{}'; x text;
begin
  if t is null or btrim(t) = '' or btrim(t) = 'all' then return null; end if;
  foreach x in array string_to_array(t, ',') loop
    begin out := out || btrim(x)::uuid; exception when others then null; end;
  end loop;
  return out;
end $$;

-- =====================================================================
--  دوال الصفحة
-- =====================================================================

-- الدخول: بياناتي + صلاحياتي
create or replace function public.sv_login() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); r text; p record; d record; m record;
begin
  if me is null then return jsonb_build_object('ok', false, 'error', 'no_session'); end if;
  select * into p from profiles where id = me;
  -- مدير نظام منصة المدرسة يصبح عضوًا تلقائيًا (مسؤول نظام)
  if p.role = 'admin' and not exists (select 1 from supervision_members where profile_id = me) then
    insert into supervision_members(profile_id, sup_role, dept) values (me, 'sys', coalesce(p.job_title, ''));
  end if;
  r := private.sv_role(me);
  if r is null then return jsonb_build_object('ok', false, 'error', 'not_member', 'name', p.full_name); end if;
  select * into m from supervision_members where profile_id = me;
  select * into d from supervision_data where profile_id = me;
  return jsonb_build_object('ok', true, 'id', me, 'name', p.full_name, 'dept', coalesce(m.dept, ''),
    'admin', r in ('owner','sys','admin'), 'sys', r in ('owner','sys'),
    'role', case r when 'member' then '' else r end,
    'data', d.data, 'stamp', coalesce(d.stamp, 0));
end $$;

create or replace function public.sv_ver() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  return jsonb_build_object('ok', true, 'stamp', coalesce((select stamp from supervision_data where profile_id = me), 0));
end $$;

create or replace function public.sv_save(p_data jsonb, p_stamp bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad_data'); end if;
  insert into supervision_data(profile_id, data, stamp, updated_at) values (me, p_data, coalesce(p_stamp, 0), now())
  on conflict (profile_id) do update set data = excluded.data, stamp = excluded.stamp, updated_at = now();
  return jsonb_build_object('ok', true, 'stamp', coalesce(p_stamp, 0));
end $$;

create or replace function public.sv_msgs() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  return jsonb_build_object('ok', true, 'msgs', coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'at', private.ms(created_at), 'title', title, 'body', body, 'from', sender)
                     order by created_at desc)
    from (select * from supervision_messages where targets is null or me = any(targets)
          order by created_at desc limit 30) x), '[]'::jsonb));
end $$;

create or replace function public.sv_push_test() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  if not exists (select 1 from private.secrets where key = 'onesignal_key') then
    return jsonb_build_object('ok', false, 'error', 'no_key'); end if;
  perform private.sv_push(array[private.sv_ext_id(me)], '🔔 تنبيه تجريبي',
    'التنبيهات تعمل على هذا الجهاز ✓ — ستصلك تنبيهات حصصك هكذا.', 'test-' || private.ms(now()), null, null);
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
--  إدارة المنصة (مدير / مسؤول نظام)
-- =====================================================================
create or replace function public.sv_admin(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me uuid := public.me_id(); my_role text := private.sv_role(me); is_sys boolean; act text := p->>'action';
  my_name text; tgt uuid; t_role text; v_email text; v_name text; v_pid uuid; v_prole public.user_role;
  ids uuid[]; v_id text; n int; v_title text; v_body text; pushed boolean; x jsonb;
begin
  if my_role is null or my_role not in ('owner','sys','admin') then return jsonb_build_object('ok', false, 'error', 'not_admin'); end if;
  is_sys := my_role in ('owner','sys');
  select full_name into my_name from profiles where id = me;

  if act = 'admin_list' then return jsonb_build_object('ok', true, 'users', private.sv_users()); end if;

  if act = 'admin_broadcast' then
    v_title := left(btrim(coalesce(p->>'title', '')), 80);
    v_body  := left(btrim(coalesce(p->>'body', '')), 600);
    if v_body = '' then return jsonb_build_object('ok', false, 'error', 'no_body'); end if;
    ids := private.sv_targets(private.sv_parse_targets(p->>'targets'));
    if coalesce(array_length(ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'no_targets'); end if;
    v_id := 'm' || private.ms(now());
    if v_title = '' then v_title := 'رسالة من ' || my_name; end if;
    pushed := private.sv_push(array(select private.sv_ext_id(i) from unnest(ids) i), '📩 ' || v_title, v_body, v_id,
                              'https://moustafaahussien.github.io/althikr-lms/supervision/#msgs', null);
    insert into supervision_messages(id, title, body, targets, sender, pushed)
    values (v_id, v_title, v_body, case when coalesce(btrim(p->>'targets'), 'all') = 'all' then null else ids end, my_name, pushed);
    return jsonb_build_object('ok', true, 'count', array_length(ids, 1), 'pushed', pushed,
                              'pushError', case when pushed then '' else 'no_key' end);
  end if;

  if act = 'admin_msgs' then
    return jsonb_build_object('ok', true, 'msgs', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'at', private.ms(created_at), 'title', title, 'body', body, 'from', sender,
               'targets', case when targets is null then 'all' else array_to_string(targets, ',') end) order by created_at desc)
      from (select * from supervision_messages order by created_at desc limit 50) z), '[]'::jsonb));
  end if;

  -- ===== لمسؤول النظام فقط =====
  if act ~ '^admin_(school|sched_|role|setpush)' and not is_sys then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;

  if act = 'admin_school' then
    return jsonb_build_object('ok', true, 'school', coalesce((
      select jsonb_agg(jsonb_build_object('code', pr.id, 'name', pr.full_name, 'dept', coalesce(m.dept, ''),
        'cfg', jsonb_build_object('raw', d.data->'cfg'->'raw', 'sheetNames', coalesce(d.data->'cfg'->'sheetNames', '{}'),
                                  'stages', coalesce(d.data->'cfg'->'stages', '{}'), 'subjects', coalesce(d.data->'cfg'->'subjects', '{}'))))
      from supervision_data d join profiles pr on pr.id = d.profile_id
      left join supervision_members m on m.profile_id = d.profile_id
      where pr.active and coalesce(m.active, pr.role = 'admin')
        and jsonb_typeof(d.data->'cfg'->'raw') = 'array' and jsonb_array_length(d.data->'cfg'->'raw') > 0), '[]'::jsonb));
  end if;

  if act = 'admin_setpush' then
    if coalesce(p->>'key', '') !~ '^os_v2_app_[a-z0-9]+$' then return jsonb_build_object('ok', false, 'error', 'bad_key'); end if;
    insert into private.secrets(key, value) values ('onesignal_key', p->>'key')
    on conflict (key) do update set value = excluded.value;
    return jsonb_build_object('ok', true);
  end if;
  if act = 'admin_push_status' then
    return jsonb_build_object('ok', true, 'has_key', exists (select 1 from private.secrets where key = 'onesignal_key'));
  end if;

  if act = 'admin_sched_list' or act = 'admin_sched_save' or act = 'admin_sched_delete' then
    if act = 'admin_sched_delete' then delete from supervision_schedules where id = p->>'id'; end if;
    if act = 'admin_sched_save' then
      declare
        s_type text := case when p->>'type' = 'once' then 'once' else 'repeat' end;
        s_time text := btrim(coalesce(p->>'time', '')); s_date text := btrim(coalesce(p->>'date', ''));
        s_days text := (select coalesce(string_agg(d, ',' order by d), '') from unnest(string_to_array(coalesce(p->>'days', ''), ',')) d where btrim(d) ~ '^[0-6]$');
        s_tg text := coalesce(nullif(btrim(p->>'targets'), ''), 'all');
        s_id text := coalesce(nullif(p->>'id', ''), 's' || private.ms(now()));
        old record;
      begin
        v_title := left(btrim(coalesce(p->>'title', '')), 80); v_body := left(btrim(coalesce(p->>'body', '')), 600);
        if v_title = '' and v_body = '' then return jsonb_build_object('ok', false, 'error', 'no_body'); end if;
        if s_time !~ '^\d{2}:\d{2}$' then return jsonb_build_object('ok', false, 'error', 'bad_time'); end if;
        if s_type = 'once' and s_date !~ '^\d{4}-\d{2}-\d{2}$' then return jsonb_build_object('ok', false, 'error', 'bad_date'); end if;
        if s_type = 'repeat' and s_days = '' then return jsonb_build_object('ok', false, 'error', 'no_days'); end if;
        if s_tg <> 'all' then
          s_tg := array_to_string(private.sv_parse_targets(s_tg), ',');
          if coalesce(s_tg, '') = '' then return jsonb_build_object('ok', false, 'error', 'no_targets'); end if;
        end if;
        select * into old from supervision_schedules where id = s_id;
        insert into supervision_schedules(id, title, body, targets, kind, on_date, days, at_time, active, inbox, last_sent, created_by)
        values (s_id, v_title, v_body, s_tg, s_type, case when s_type = 'once' then s_date else '' end,
                case when s_type = 'repeat' then s_days else '' end, s_time,
                coalesce(p->>'active', '1') <> '0', coalesce(p->>'inbox', '0') = '1', '', my_name)
        on conflict (id) do update set title = excluded.title, body = excluded.body, targets = excluded.targets,
          kind = excluded.kind, on_date = excluded.on_date, days = excluded.days, at_time = excluded.at_time,
          active = excluded.active, inbox = excluded.inbox,
          last_sent = case when supervision_schedules.kind is distinct from excluded.kind
                             or supervision_schedules.on_date is distinct from excluded.on_date
                             or supervision_schedules.at_time is distinct from excluded.at_time
                           then '' else supervision_schedules.last_sent end;
      end;
    end if;
    return jsonb_build_object('ok', true, 'sched', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'targets', targets, 'type', kind,
        'date', on_date, 'days', days, 'time', at_time, 'active', active, 'inbox', inbox, 'last', last_sent, 'by', created_by)
        order by kind, on_date, at_time)
      from supervision_schedules), '[]'::jsonb));
  end if;

  -- ===== إضافة عضو =====
  if act = 'admin_add' then
    v_name := btrim(coalesce(p->>'name', '')); v_email := lower(btrim(coalesce(p->>'email', '')));
    if v_email = '' or not public.email_domain_ok(v_email) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
    select id, role into v_pid, v_prole from profiles where email = v_email;
    if v_pid is not null and v_prole in ('student','parent') then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
    if v_pid is not null and (exists (select 1 from supervision_members where profile_id = v_pid) or v_prole = 'admin') then
      return jsonb_build_object('ok', false, 'error', 'exists'); end if;
    if v_pid is null then
      if v_name = '' then return jsonb_build_object('ok', false, 'error', 'no_name'); end if;
      insert into profiles(email, full_name, role, job_title) values (v_email, v_name, 'supervisor', 'مشرف تربوي') returning id into v_pid;
    end if;
    insert into supervision_members(profile_id, dept, sup_role)
    values (v_pid, btrim(coalesce(p->>'dept', '')),
            case when is_sys and p->>'role' in ('admin','sys') then p->>'role' else 'member' end);
    return jsonb_build_object('ok', true, 'code', v_pid, 'users', private.sv_users());
  end if;

  -- ===== إجراءات على عضو محدد =====
  begin tgt := (p->>'target')::uuid; exception when others then tgt := null; end;
  if tgt is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  t_role := private.sv_role(tgt);
  if t_role is null and not exists (select 1 from supervision_members where profile_id = tgt) then
    return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if t_role is null then select sup_role into t_role from supervision_members where profile_id = tgt; end if;
  if tgt = me and act <> 'admin_edit' then return jsonb_build_object('ok', false, 'error', 'self'); end if;
  if t_role = 'owner' and tgt <> me then return jsonb_build_object('ok', false, 'error', 'owner'); end if;
  if t_role in ('admin','sys') and not is_sys and tgt <> me then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;

  if act = 'admin_role' then
    update supervision_members set sup_role = case when p->>'role' in ('admin','sys') then p->>'role' else 'member' end where profile_id = tgt;
  elsif act = 'admin_toggle' then
    update supervision_members set active = (p->>'active') = '1' where profile_id = tgt;
  elsif act = 'admin_edit' then
    if btrim(coalesce(p->>'name', '')) <> '' then update profiles set full_name = btrim(p->>'name') where id = tgt; end if;
    if p ? 'dept' then
      insert into supervision_members(profile_id, dept, sup_role) values (tgt, btrim(p->>'dept'), 'sys')
      on conflict (profile_id) do update set dept = excluded.dept;
    end if;
    if p ? 'email' and lower(btrim(p->>'email')) is distinct from (select email from profiles where id = tgt) then
      -- تغيير البريد = تغيير حساب الدخول؛ لمسؤول النظام فقط، ولا يشمل حسابات إدارة منصة المدرسة
      v_email := lower(btrim(p->>'email'));
      if not is_sys or (select role from profiles where id = tgt) in ('admin','leadership') then
        return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;
      if not public.email_domain_ok(v_email) then return jsonb_build_object('ok', false, 'error', 'bad_email'); end if;
      if exists (select 1 from profiles where email = v_email and id <> tgt) then return jsonb_build_object('ok', false, 'error', 'email_taken'); end if;
      update profiles set email = v_email where id = tgt;
    end if;
  elsif act = 'admin_delete' then
    delete from supervision_data where profile_id = tgt;
    delete from supervision_members where profile_id = tgt;
  else
    return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true, 'users', private.sv_users());
end $$;

-- =====================================================================
--  نقل البيانات من المنصة القديمة (Google Sheets) — لمسؤول النظام
--  p = { members:[{profile_id, dept, role, active, data, stamp, legacy_code}],
--        messages:[{id, at, title, body, targets:[uuid]|null, from}], schedules:[{...}] }
-- =====================================================================
create or replace function public.sv_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); x jsonb; nm int := 0; nmsg int := 0; ns int := 0; pid uuid;
begin
  if private.sv_role(me) not in ('owner','sys') then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;
  for x in select * from jsonb_array_elements(coalesce(p->'members', '[]')) loop
    pid := (x->>'profile_id')::uuid;
    if not exists (select 1 from profiles where id = pid and role not in ('student','parent')) then continue; end if;
    insert into supervision_members(profile_id, dept, sup_role, active, legacy_code)
    values (pid, coalesce(x->>'dept', ''), case when x->>'role' in ('admin','sys') then x->>'role' else 'member' end,
            coalesce((x->>'active')::boolean, true), x->>'legacy_code')
    on conflict (profile_id) do update set dept = excluded.dept, sup_role = excluded.sup_role,
      active = excluded.active, legacy_code = excluded.legacy_code;
    if x->'data' is not null and jsonb_typeof(x->'data') = 'object' then
      insert into supervision_data(profile_id, data, stamp, updated_at)
      values (pid, x->'data', coalesce((x->>'stamp')::bigint, 0), now())
      on conflict (profile_id) do update set data = excluded.data, stamp = excluded.stamp, updated_at = now();
    end if;
    nm := nm + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'messages', '[]')) loop
    insert into supervision_messages(id, created_at, title, body, targets, sender, pushed)
    values (x->>'id', to_timestamp(coalesce((x->>'at')::bigint, 0) / 1000.0), coalesce(x->>'title', ''), coalesce(x->>'body', ''),
            case when jsonb_typeof(x->'targets') = 'array' then array(select jsonb_array_elements_text(x->'targets')::uuid) end,
            coalesce(x->>'from', ''), false)
    on conflict (id) do nothing;
    nmsg := nmsg + 1;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p->'schedules', '[]')) loop
    insert into supervision_schedules(id, title, body, targets, kind, on_date, days, at_time, active, inbox, last_sent, created_by)
    values (x->>'id', coalesce(x->>'title', ''), coalesce(x->>'body', ''), coalesce(x->>'targets', 'all'),
            case when x->>'type' = 'once' then 'once' else 'repeat' end, coalesce(x->>'date', ''), coalesce(x->>'days', ''),
            coalesce(x->>'time', ''), coalesce((x->>'active')::boolean, true), coalesce((x->>'inbox')::boolean, false),
            coalesce(x->>'last', ''), coalesce(x->>'by', ''))
    on conflict (id) do update set title = excluded.title, body = excluded.body, targets = excluded.targets, kind = excluded.kind,
      on_date = excluded.on_date, days = excluded.days, at_time = excluded.at_time, active = excluded.active,
      inbox = excluded.inbox, last_sent = excluded.last_sent, created_by = excluded.created_by;
    ns := ns + 1;
  end loop;
  return jsonb_build_object('ok', true, 'members', nm, 'messages', nmsg, 'schedules', ns);
end $$;

-- =====================================================================
--  تصدير (بدل أوراق «التقييمات» و«الجلسات الفردية» و«خطط التطوير» في الشيت)
-- =====================================================================
create or replace function public.sv_export(kind text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r text := private.sv_role(me);
begin
  if r is null or r not in ('owner','sys','admin') then return jsonb_build_object('ok', false, 'error', 'not_admin'); end if;
  if kind = 'evals' then
    return jsonb_build_object('ok', true, 'rows', coalesce((
      select jsonb_agg(row order by row->>'التاريخ') from (
        select jsonb_build_object('المشرف', pr.full_name, 'الاستمارة', case when e->>'form' = 'dasc' then 'DASC' else 'المسار الوطني' end,
          'المعلم', e->>'teacher', 'المادة', e->>'subj', 'الفصل', e->>'cls', 'المرحلة', e->>'stage', 'التاريخ', e->>'date',
          'الحصة', e->>'period', 'موضوع الدرس', e->>'topic', 'رقم الزيارة', e->>'visitNo', 'نوع الزيارة', e->>'visitType',
          'المُقيِّم', e->>'evaluator',
          'المجموع', (select sum(v::numeric) from jsonb_array_elements_text(coalesce(e->'scores', '[]')) v where v ~ '^[0-9.]+$'),
          'عدد البنود المقيّمة', (select count(*) from jsonb_array_elements_text(coalesce(e->'scores', '[]')) v where v ~ '^[0-9.]+$'),
          'الدرجات', e->'scores', 'ممارسات جيدة', e->>'good', 'توصيات', e->>'rec', 'تأملات المعلم', e->>'refl',
          'ملاحظات', e->>'notes') as row
        from supervision_data d join profiles pr on pr.id = d.profile_id,
             jsonb_array_elements(case when jsonb_typeof(d.data->'prefs'->'evals') = 'array' then d.data->'prefs'->'evals' else '[]' end) e
        where e ? 'id') z), '[]'::jsonb));
  elsif kind = 'sessions' then
    return jsonb_build_object('ok', true, 'rows', coalesce((
      select jsonb_agg(row order by row->>'التاريخ') from (
        select jsonb_build_object('المشرف', pr.full_name, 'التاريخ', x->>'date', 'المعلم', x->>'teacher', 'المادة', x->>'subj',
          'عنوان الجلسة', x->>'title', 'أسئلة المناقشة', x->>'questions', 'التوصيات', x->>'recs', 'التزامات المعلم', x->>'commits',
          'موعد المتابعة', x->>'follow', 'تمت المتابعة', case when (x->>'followDone')::boolean then 'نعم' else '' end,
          'تأكيد المعلم', case when (x->>'ack')::boolean then 'نعم' else '' end, 'تاريخ التأكيد', x->>'ackDate') as row
        from supervision_data d join profiles pr on pr.id = d.profile_id,
             jsonb_array_elements(case when jsonb_typeof(d.data->'prefs'->'sessions') = 'array' then d.data->'prefs'->'sessions' else '[]' end) x
        where x ? 'id') z), '[]'::jsonb));
  elsif kind = 'plans' then
    return jsonb_build_object('ok', true, 'rows', coalesce((
      select jsonb_agg(row) from (
        select jsonb_build_object('المشرف', pr.full_name, 'المعلم', e->>'teacher', 'المادة', e->>'subj', 'الفصل', e->>'cls',
          'تاريخ الزيارة', e->>'date', 'الاستمارة', case when e->>'form' = 'dasc' then 'DASC' else 'العادية' end,
          'بداية الخطة', e->'plan'->>'start', 'موعد المتابعة', e->'plan'->>'follow',
          'تمت المتابعة', case when (e->'plan'->>'followDone')::boolean then 'نعم' else '' end,
          'رقم البند', (i->>'i')::int + 1, 'الدرجة', i->>'sc', 'الهدف', i->>'goal', 'الإجراءات', i->>'acts',
          'الأداة', i->>'res', 'المدة', i->>'dur', 'مؤشر النجاح', i->>'ind', 'ملاحظات المشرف', e->'plan'->>'notes') as row
        from supervision_data d join profiles pr on pr.id = d.profile_id,
             jsonb_array_elements(case when jsonb_typeof(d.data->'prefs'->'evals') = 'array' then d.data->'prefs'->'evals' else '[]' end) e,
             jsonb_array_elements(case when jsonb_typeof(e->'plan'->'items') = 'array' then e->'plan'->'items' else '[]' end) i
        where coalesce((i->>'on')::boolean, false)) z), '[]'::jsonb));
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $$;

-- =====================================================================
--  الإرسال التلقائي كل دقيقة (بديل pushTick في Apps Script)
-- =====================================================================
create or replace function private.sv_push_tick() returns void
language plpgsql security definer set search_path = public as $$
declare
  now_r timestamp := now() at time zone 'Asia/Riyadh';
  today text := to_char(now_r, 'YYYY-MM-DD');
  dow int := extract(dow from now_r)::int;          -- 0=الأحد ... 6=السبت
  cur int := extract(hour from now_r)::int * 60 + extract(minute from now_r)::int;
  t_ms bigint := private.ms(now());
  s record; tg int; ids uuid[]; mem record; it jsonb; ok boolean;
begin
  delete from supervision_push_log where sent_at < now() - interval '3 days';

  -- 1) الإشعارات المجدولة
  for s in select * from supervision_schedules where active and at_time ~ '^\d{2}:\d{2}$' loop
    tg := split_part(s.at_time, ':', 1)::int * 60 + split_part(s.at_time, ':', 2)::int;
    if cur < tg or cur > tg + 4 then continue; end if;
    if s.kind = 'once' then
      if s.on_date <> today or s.last_sent <> '' then continue; end if;
    else
      if not (dow::text = any(string_to_array(s.days, ','))) or left(s.last_sent, 10) = today then continue; end if;
    end if;
    insert into supervision_push_log(key) values ('sch_' || s.id || '_' || today) on conflict do nothing;
    if not found then continue; end if;
    update supervision_schedules set last_sent = to_char(now_r, 'YYYY-MM-DD HH24:MI') where id = s.id;
    ids := private.sv_targets(private.sv_parse_targets(s.targets));
    if coalesce(array_length(ids, 1), 0) = 0 then continue; end if;
    ok := private.sv_push(array(select private.sv_ext_id(i) from unnest(ids) i), coalesce(nullif(s.title, ''), '🔔 تنبيه'),
           coalesce(nullif(s.body, ''), s.title), 'sch-' || s.id || '-' || today,
           case when s.inbox then 'https://moustafaahussien.github.io/althikr-lms/supervision/#msgs' end, 15 * 60);
    if s.inbox then
      insert into supervision_messages(id, title, body, targets, sender, pushed)
      values ('m' || t_ms || s.id, coalesce(nullif(s.title, ''), '🔔 تنبيه'), coalesce(nullif(s.body, ''), s.title),
              case when s.targets = 'all' then null else ids end, coalesce(nullif(s.created_by, ''), 'مسؤول النظام'), ok)
      on conflict (id) do nothing;
    end if;
  end loop;

  -- 2) تذكيرات الحصص الشخصية (أيام الدوام 6 ص – 3 م)
  if dow in (5, 6) or cur < 6 * 60 or cur >= 15 * 60 then return; end if;
  for mem in
    select d.profile_id, d.data->'prefs'->'push' as q from supervision_data d
    where d.profile_id = any(private.sv_targets(null)) and jsonb_typeof(d.data->'prefs'->'push') = 'array'
  loop
    for it in select * from jsonb_array_elements(mem.q) loop
      if it->>'at' is null or (it->>'at') !~ '^\d+$' then continue; end if;
      if (it->>'at')::bigint > t_ms + 20000 or (it->>'at')::bigint < t_ms - 5 * 60000 then continue; end if;
      insert into supervision_push_log(key) values ('p_' || mem.profile_id || '_' || coalesce(it->>'id', it->>'at')) on conflict do nothing;
      if not found then continue; end if;
      perform private.sv_push(array[private.sv_ext_id(mem.profile_id)], coalesce(it->>'title', '🔔'), coalesce(it->>'body', ''),
                              coalesce(it->>'id', ''), null, 10 * 60);
    end loop;
  end loop;
end $$;

-- جدولة كل دقيقة
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'sv_push_tick';
  perform cron.schedule('sv_push_tick', '* * * * *', 'select private.sv_push_tick()');
end $$;

-- ---------- صلاحيات التنفيذ ----------
revoke execute on all functions in schema private from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['sv_login()','sv_ver()','sv_save(jsonb,bigint)','sv_msgs()','sv_push_test()',
                           'sv_admin(jsonb)','sv_import(jsonb)','sv_export(text)']
  loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
