-- ============================================================
-- 89) صلاحيات «مدير» مكتب الإشراف:
--     - حذف مشرف من المكتب (يمسح كل بياناته نهائيًا) صار لمسؤول النظام فقط
--     - «جدول المدرسة الموحد» (sv_tt_get بكل الجداول) متاح للمدير أيضًا — قراءة فقط
-- ============================================================
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
  if act ~ '^admin_(school|sched_|role|setpush|delete)' and not is_sys then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;

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

create or replace function public.sv_tt_get(p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := private.sv_role(me); res jsonb;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  if p_all and r not in ('owner','sys','admin') then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;
  with sh as (
    select s.*, pr.full_name as owner_name, coalesce(m.dept, '') as dept,
           case when p_all then (row_number() over (order by pr.full_name, s.owner_id, s.idx) - 1)::int else s.idx::int end as k
    from tt_sheets s join profiles pr on pr.id = s.owner_id
    left join supervision_members m on m.profile_id = s.owner_id
    where case when p_all then pr.active and coalesce(m.active, pr.role = 'admin') else s.owner_id = me end)
  select jsonb_build_object('ok', true, 'mirror', p_all,
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('k', k, 'idx', idx, 'owner', owner_id, 'owner_name', owner_name,
                         'dept', dept, 'name', src_name, 'label', label) order by k) from sh), '[]'::jsonb),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('s', sh.k, 'd', sl.day, 'p', sl.period, 'k', sl.kind,
                         't', coalesce(t.full_name, sl.txt), 'c', sl.cls, 'tr', sl.track, 'g', sl.grade_num, 'sc', sl.section,
                         'sj', sb.name_ar, 'r', sl.room, 'x', case when sl.kind = 'event' then sl.txt end)
                         order by sh.k, sl.day, sl.period, sl.id)
                       from tt_slots sl join sh on sh.id = sl.sheet_id
                       left join profiles t on t.id = sl.teacher_id
                       left join subjects sb on sb.id = sl.subject_id), '[]'::jsonb),
    'subjects', coalesce((select jsonb_object_agg(sh.k || '|' || t.full_name, sb.name_ar)
                       from tt_teacher_subject ts join sh on sh.id = ts.sheet_id
                       join profiles t on t.id = ts.teacher_id join subjects sb on sb.id = ts.subject_id), '{}'::jsonb),
    'stages', coalesce((select jsonb_object_agg(sh.k || '|' || st.track || '|' || st.grade_num, st.stage)
                       from tt_stage st join sh on sh.id = st.sheet_id where st.stage is not null), '{}'::jsonb),
    'profs', coalesce((select jsonb_object_agg(sh.k || '|' || st.track || '|' || st.grade_num, st.prof)
                       from tt_stage st join sh on sh.id = st.sheet_id where st.prof is not null), '{}'::jsonb),
    'times', coalesce((select jsonb_object_agg(pp.key, coalesce((select jsonb_agg(jsonb_build_object('p', sp.period, 's', sp.start_t, 'e', sp.end_t) order by sp.period)
                                  from school_periods sp where sp.profile = pp.key), '[]'::jsonb)) from period_profiles pp), '{}'::jsonb))
  into res;
  return res;
end $$;
