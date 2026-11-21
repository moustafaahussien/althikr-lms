-- =====================================================================
--  الملف 19: الرسائل — البريد الداخلي + التعاميم والقرارات + تواصل المعلم وولي الأمر
--  - رسالة واحدة ← مستلمون كُثر (message_recipients) مع حالة القراءة والاطلاع
--  - التوجيه: أشخاص بعينهم، أو حسب الدور، أو المرحلة، أو كل الموظفين، أو أولياء أمور صف/فصل/طلاب
--  - المرفقات في مخزن «attachments» الخاص (لا يفتحها إلا المرسل والمستلمون)
--  - التعاميم: يصدرها مدير النظام والإدارة العليا ومديرو المراحل، مع «تم الاطلاع» ونسبة الاطلاع
-- =====================================================================

create table if not exists public.messages (
  id           bigserial primary key,
  kind         text not null default 'mail' check (kind in ('mail','circular')),
  sender_id    uuid references public.profiles(id) on delete set null,
  subject      text not null check (btrim(subject) <> ''),
  body         text not null default '',
  attachments  jsonb not null default '[]'::jsonb,     -- [{name, path, size, type}]
  audience     text,                                   -- وصف المستلمين (للعرض)
  ref_no       text,                                   -- رقم التعميم
  requires_ack boolean not null default false,
  parent_id    bigint references public.messages(id) on delete set null,   -- الرد على رسالة
  created_at   timestamptz not null default now()
);
create index if not exists messages_sender on public.messages(sender_id, created_at desc);
create index if not exists messages_kind on public.messages(kind, created_at desc);

create table if not exists public.message_recipients (
  message_id bigint not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  read_at    timestamptz,
  ack_at     timestamptz,
  archived   boolean not null default false,
  primary key (message_id, profile_id)
);
create index if not exists message_recipients_me on public.message_recipients(profile_id, archived, read_at);
alter table public.messages enable row level security;
alter table public.message_recipients enable row level security;   -- عبر الدوال فقط

-- ---------- من يمكنني مراسلته (للبحث في خانة «إلى») ----------
create or replace function private.msg_allowed(p_to uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role; tr public.user_role;
begin
  if me is null or p_to is null or p_to = me then return false; end if;
  select role into r from profiles where id = me;
  select role into tr from profiles where id = p_to and active;
  if tr is null then return false; end if;
  if r not in ('student','parent') then
    if tr not in ('student','parent') then return true; end if;          -- موظف ↔ موظف
    if r in ('admin','leadership') then return true; end if;
    if tr = 'student' then return public.can_view_student(p_to); end if; -- طلابي
    return exists (select 1 from parent_links pl where pl.parent_id = p_to and public.can_view_student(pl.student_id));
  end if;
  if tr in ('student','parent') then return false; end if;               -- لا مراسلة بين الطلاب/الأولياء
  if tr in ('admin','leadership','principal') then return true; end if;  -- الإدارة
  -- معلمو الطالب / معلمو أبناء ولي الأمر
  return exists (
    select 1 from students s
    left join classes c on c.id = s.class_id
    where (s.profile_id = me or s.profile_id in (select student_id from parent_links where parent_id = me))
      and (exists (select 1 from teaching_assignments ta where ta.teacher_id = p_to and ta.class_id = s.class_id)
           or exists (select 1 from teaching_assignments ta join classes c2 on c2.id = ta.class_id
                      where ta.teacher_id = p_to and c2.grade_id = s.grade_id)
           or c.homeroom_teacher_id = p_to));
end $$;

create or replace function public.msg_contacts(p_q text default '') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := public.norm(coalesce(p_q, ''));
begin
  if public.me_id() is null then raise exception 'غير مسجّل'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'title', p.job_title) x
    from profiles p
    where p.active and (q is null or public.norm(p.full_name) like '%' || q || '%' or public.norm(coalesce(p.job_title,'')) like '%' || q || '%')
      and private.msg_allowed(p.id)
    order by (p.role in ('student','parent')), p.full_name
    limit 40) z), '[]'::jsonb);
end $$;

-- ---------- المجموعات المتاحة للإرسال ----------
create or replace function public.msg_groups() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role;
begin
  select role into r from profiles where id = me;
  if r is null or r in ('student','parent') then return '{}'::jsonb; end if;
  return jsonb_build_object(
    'can_broadcast', r in ('admin','leadership','principal','supervisor'),
    'can_circular',  r in ('admin','leadership','principal'),
    'roles', case when r in ('admin','leadership','principal','supervisor') then
      '[{"k":"teacher","l":"كل المعلمين"},{"k":"supervisor","l":"كل المشرفين"},{"k":"principal","l":"مديرو المراحل"},{"k":"staff","l":"الموظفون الإداريون"},{"k":"leadership","l":"الإدارة العليا"}]'::jsonb else '[]'::jsonb end,
    'stages', case when r in ('admin','leadership','principal','supervisor') then
      coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name_ar) order by sort) from stages), '[]'::jsonb) else '[]'::jsonb end,
    -- أولياء الأمور: صفوف/فصول يحق لي مراسلة أولياء أمورها
    'parent_grades', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar,
                       'parents', (select count(distinct pl.parent_id) from parent_links pl join students s on s.profile_id = pl.student_id where s.grade_id = g.id))
                       order by st.sort, g.number)
                     from grades g join stages st on st.id = g.stage_id
                     where private.att_can(g.id, null) and exists (select 1 from students s where s.grade_id = g.id)), '[]'::jsonb));
end $$;

-- ---------- الإرسال ----------
-- p = {kind, subject, body, attachments, ref_no, requires_ack, reply_to,
--      to: {people:[uuid], roles:[text], stages:[int], all_staff:bool, parents_grades:[int], parents_students:[uuid]}}
create or replace function public.msg_send(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role; mid bigint; t jsonb := coalesce(p->'to', '{}'::jsonb);
  k text := coalesce(p->>'kind', 'mail'); n int; parts text[] := '{}'; bad int;
begin
  if me is null then raise exception 'غير مسجّل'; end if;
  select role into r from profiles where id = me;
  if btrim(coalesce(p->>'subject','')) = '' then raise exception 'اكتب عنوان الرسالة'; end if;
  if k = 'circular' and r not in ('admin','leadership','principal') then raise exception 'التعاميم يصدرها مدير النظام والإدارة العليا ومديرو المراحل'; end if;
  if (coalesce(jsonb_array_length(t->'roles'),0) > 0 or coalesce(jsonb_array_length(t->'stages'),0) > 0 or coalesce((t->>'all_staff')::boolean, false))
     and r not in ('admin','leadership','principal','supervisor') then raise exception 'الإرسال الجماعي متاح للإدارة والمشرفين'; end if;

  drop table if exists _to;
  create temp table _to (pid uuid primary key) on commit drop;
  -- أشخاص بعينهم (مع التحقق من الصلاحية)
  insert into _to select distinct x::uuid from jsonb_array_elements_text(coalesce(t->'people','[]')) x on conflict do nothing;
  -- الرد: يُسمح بالرد على مرسل رسالة وصلتني حتى لو لم يكن ضمن جهات المراسلة
  if (p->>'reply_to') is not null then
    insert into _to select m.sender_id from messages m join message_recipients mr on mr.message_id = m.id and mr.profile_id = me
     where m.id = (p->>'reply_to')::bigint and m.sender_id is not null on conflict do nothing;
  end if;
  select count(*) into bad from _to x where not private.msg_allowed(x.pid)
     and not exists (select 1 from messages m join message_recipients mr on mr.message_id = m.id and mr.profile_id = me
                     where m.id = (p->>'reply_to')::bigint and m.sender_id = x.pid);
  if bad > 0 then raise exception 'لا يمكنك مراسلة بعض المستلمين المحددين'; end if;
  if jsonb_array_length(coalesce(t->'people','[]')) > 0 then parts := parts || (jsonb_array_length(t->'people') || ' شخص'); end if;
  -- كل الموظفين / حسب الدور
  if coalesce((t->>'all_staff')::boolean, false) then
    insert into _to select id from profiles where active and role not in ('student','parent') on conflict do nothing;
    parts := parts || 'كل الموظفين'::text;
  end if;
  if coalesce(jsonb_array_length(t->'roles'),0) > 0 then
    insert into _to select id from profiles where active and role::text in (select jsonb_array_elements_text(t->'roles'))
      and role not in ('student','parent') on conflict do nothing;
    parts := parts || (select string_agg(case x when 'teacher' then 'المعلمون' when 'supervisor' then 'المشرفون' when 'principal' then 'مديرو المراحل'
                                              when 'staff' then 'الإداريون' when 'leadership' then 'الإدارة العليا' else x end, '، ')
                       from jsonb_array_elements_text(t->'roles') x);
  end if;
  -- حسب المرحلة: من يدرّس فيها + من له نطاق عليها
  if coalesce(jsonb_array_length(t->'stages'),0) > 0 then
    insert into _to
      select distinct ta.teacher_id from teaching_assignments ta join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
       where g.stage_id in (select (jsonb_array_elements_text(t->'stages'))::int)
      union select distinct sc.profile_id from staff_scopes sc where sc.stage_id in (select (jsonb_array_elements_text(t->'stages'))::int)
    on conflict do nothing;
    parts := parts || ('مرحلة: ' || (select string_agg(name_ar, '، ') from stages where id in (select (jsonb_array_elements_text(t->'stages'))::int)));
  end if;
  -- أولياء أمور صف كامل (لمن يحق له)
  if coalesce(jsonb_array_length(t->'parents_grades'),0) > 0 then
    if exists (select 1 from jsonb_array_elements_text(t->'parents_grades') g where not private.att_can(g::int, null)) then
      raise exception 'لا يمكنك مراسلة أولياء أمور هذا الصف'; end if;
    insert into _to select distinct pl.parent_id from parent_links pl join students s on s.profile_id = pl.student_id
      join profiles pp on pp.id = pl.parent_id and pp.active
     where s.grade_id in (select (jsonb_array_elements_text(t->'parents_grades'))::int) on conflict do nothing;
    parts := parts || ('أولياء أمور: ' || (select string_agg(name_ar, '، ') from grades where id in (select (jsonb_array_elements_text(t->'parents_grades'))::int)));
  end if;
  -- أولياء أمور طلاب بعينهم
  if coalesce(jsonb_array_length(t->'parents_students'),0) > 0 then
    if exists (select 1 from jsonb_array_elements_text(t->'parents_students') s where not public.can_view_student(s::uuid)) then
      raise exception 'لا يمكنك مراسلة ولي أمر هذا الطالب'; end if;
    insert into _to select distinct pl.parent_id from parent_links pl join profiles pp on pp.id = pl.parent_id and pp.active
     where pl.student_id in (select (jsonb_array_elements_text(t->'parents_students'))::uuid) on conflict do nothing;
    parts := parts || (jsonb_array_length(t->'parents_students') || ' ولي أمر');
  end if;
  delete from _to where pid = me;
  select count(*) into n from _to;
  if n = 0 then raise exception 'لا يوجد مستلمون'; end if;

  insert into messages(kind, sender_id, subject, body, attachments, audience, ref_no, requires_ack, parent_id)
  values (k, me, btrim(p->>'subject'), coalesce(p->>'body',''), coalesce(p->'attachments','[]'::jsonb),
          array_to_string(parts, ' + '), nullif(btrim(p->>'ref_no'),''), k = 'circular' and coalesce((p->>'requires_ack')::boolean, true),
          (p->>'reply_to')::bigint)
  returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, pid from _to;
  return jsonb_build_object('ok', true, 'id', mid, 'recipients', n);
end $$;

-- ---------- صندوق الوارد / المرسل / الأرشيف ----------
create or replace function public.msg_list(p_box text default 'inbox', p_kind text default null, p_q text default '', p_limit int default 50, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); q text := public.norm(coalesce(p_q,''));
begin
  if me is null then raise exception 'غير مسجّل'; end if;
  if p_box = 'sent' then
    return coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', m.id, 'kind', m.kind, 'subject', m.subject, 'at', m.created_at, 'to', m.audience, 'ref', m.ref_no,
        'att', jsonb_array_length(m.attachments), 'ack', m.requires_ack,
        'n', (select count(*) from message_recipients where message_id = m.id),
        'read', (select count(*) from message_recipients where message_id = m.id and read_at is not null),
        'acked', (select count(*) from message_recipients where message_id = m.id and ack_at is not null)) x
      from messages m where m.sender_id = me and (p_kind is null or m.kind = p_kind)
        and (q is null or public.norm(m.subject || ' ' || m.body) like '%' || q || '%')
      order by m.created_at desc limit p_limit offset p_offset) z), '[]'::jsonb);
  end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', m.id, 'kind', m.kind, 'subject', m.subject, 'at', m.created_at, 'from', sp.full_name, 'from_title', sp.job_title,
      'ref', m.ref_no, 'att', jsonb_array_length(m.attachments), 'read', mr.read_at is not null, 'ack', m.requires_ack, 'acked', mr.ack_at is not null,
      'snip', left(regexp_replace(m.body, '\s+', ' ', 'g'), 120)) x
    from message_recipients mr join messages m on m.id = mr.message_id left join profiles sp on sp.id = m.sender_id
    where mr.profile_id = me and mr.archived = (p_box = 'archive') and (p_kind is null or m.kind = p_kind)
      and (q is null or public.norm(m.subject || ' ' || m.body || ' ' || coalesce(sp.full_name,'')) like '%' || q || '%')
    order by m.created_at desc limit p_limit offset p_offset) z), '[]'::jsonb);
end $$;

create or replace function public.msg_get(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); is_rec boolean; is_snd boolean; res jsonb;
begin
  select exists (select 1 from message_recipients where message_id = p_id and profile_id = me) into is_rec;
  select exists (select 1 from messages where id = p_id and sender_id = me) into is_snd;
  if not (is_rec or is_snd or public.is_admin()) then raise exception 'غير مصرح'; end if;
  if is_rec then update message_recipients set read_at = coalesce(read_at, now()) where message_id = p_id and profile_id = me; end if;
  select jsonb_build_object('id', m.id, 'kind', m.kind, 'subject', m.subject, 'body', m.body, 'attachments', m.attachments, 'at', m.created_at,
    'from', sp.full_name, 'from_id', m.sender_id, 'from_title', sp.job_title, 'to', m.audience, 'ref', m.ref_no, 'ack', m.requires_ack,
    'acked', (select ack_at from message_recipients where message_id = p_id and profile_id = me),
    'archived', (select archived from message_recipients where message_id = p_id and profile_id = me),
    'mine', is_snd, 'can_reply', is_rec and m.sender_id is not null,
    'parent', (select jsonb_build_object('id', pm.id, 'subject', pm.subject, 'body', pm.body, 'at', pm.created_at, 'from', pp.full_name)
               from messages pm left join profiles pp on pp.id = pm.sender_id where pm.id = m.parent_id
                 and (pm.sender_id = me or exists (select 1 from message_recipients x where x.message_id = pm.id and x.profile_id = me))),
    -- للمرسل والإدارة: حالة الاطلاع لكل مستلم
    'recipients', case when is_snd or public.is_leader() then (select jsonb_agg(jsonb_build_object('name', p.full_name, 'role', p.role, 'read', mr.read_at, 'ack', mr.ack_at) order by mr.ack_at nulls last, mr.read_at nulls last, p.full_name)
                   from message_recipients mr join profiles p on p.id = mr.profile_id where mr.message_id = p_id) end)
  into res from messages m left join profiles sp on sp.id = m.sender_id where m.id = p_id;
  return res;
end $$;

create or replace function public.msg_ack(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update message_recipients set ack_at = coalesce(ack_at, now()), read_at = coalesce(read_at, now())
   where message_id = p_id and profile_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.msg_archive(p_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update message_recipients set archived = p_on, read_at = coalesce(read_at, now()) where message_id = p_id and profile_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- عدّاد الشريط العلوي + التعاميم التي تنتظر «تم الاطلاع»
create or replace function public.msg_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'unread', (select count(*) from message_recipients mr where mr.profile_id = public.me_id() and mr.read_at is null and not mr.archived),
    'pending_ack', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'subject', m.subject, 'ref', m.ref_no, 'at', m.created_at, 'from', p.full_name) order by m.created_at desc)
                   from message_recipients mr join messages m on m.id = mr.message_id left join profiles p on p.id = m.sender_id
                   where mr.profile_id = public.me_id() and m.requires_ack and mr.ack_at is null), '[]'::jsonb))
$$;

-- لوحة متابعة التعاميم (الإدارة): نسبة الاطلاع لكل تعميم
create or replace function public.msg_circulars_board(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_leader() or public.me_role() = 'principal') then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', m.id, 'subject', m.subject, 'ref', m.ref_no, 'at', m.created_at, 'from', p.full_name, 'to', m.audience,
      'n', (select count(*) from message_recipients where message_id = m.id),
      'read', (select count(*) from message_recipients where message_id = m.id and read_at is not null),
      'acked', (select count(*) from message_recipients where message_id = m.id and ack_at is not null)) x
    from messages m left join profiles p on p.id = m.sender_id
    where m.kind = 'circular' and (public.is_leader() or m.sender_id = public.me_id())
    order by m.created_at desc limit p_limit) z), '[]'::jsonb);
end $$;

do $$ declare f text; begin
  foreach f in array array['msg_contacts(text)','msg_groups()','msg_send(jsonb)','msg_list(text,text,text,int,int)','msg_get(bigint)',
                           'msg_ack(bigint)','msg_archive(bigint,boolean)','msg_counts()','msg_circulars_board(int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ---------- المرفقات (مخزن خاص) ----------
insert into storage.buckets(id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 15728640)          -- 15 ميجابايت للملف
on conflict (id) do nothing;

-- رفع: كل مستخدم في مجلده u/<رقم حسابه>/...
create or replace function public.att_folder_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_id() is not null and split_part(p_name, '/', 1) = 'u' and split_part(p_name, '/', 2) = public.me_id()::text
$$;
-- قراءة: صاحب الملف، أو مستلم رسالة مرفق بها الملف
create or replace function public.att_can_read(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.att_folder_ok(p_name) or exists (
    select 1 from messages m
    where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
      and (m.sender_id = public.me_id() or exists (select 1 from message_recipients r where r.message_id = m.id and r.profile_id = public.me_id())))
$$;
revoke all on function public.att_folder_ok(text) from public, anon;
revoke all on function public.att_can_read(text) from public, anon;
grant execute on function public.att_folder_ok(text) to authenticated;
grant execute on function public.att_can_read(text) to authenticated;

drop policy if exists "attachments upload" on storage.objects;
drop policy if exists "attachments read" on storage.objects;
drop policy if exists "attachments delete" on storage.objects;
create policy "attachments upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.att_folder_ok(name));
create policy "attachments read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.att_can_read(name));
create policy "attachments delete" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and public.att_folder_ok(name));
