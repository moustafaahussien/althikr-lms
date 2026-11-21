-- =====================================================================
--  الملف 20: الخدمات الإدارية
--   1) جدول المناوبة (أسبوعي لكل مرحلة) + «مناوبتي اليوم»
--   2) المعاملات الإلكترونية (طلبات بسير اعتماد: المدير المباشر ← الإدارة)
--   3) الشكاوى الأكاديمية (تسجيل ومتابعة وردود)
--   4) تدريب المعلمين (الساعات والشهادات وتقييم أثر التدريب)
-- =====================================================================

-- مدير الشؤون: مدير النظام/الإدارة العليا/مدير مرحلة
create or replace function private.is_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.me_role() in ('admin','leadership','principal'), false)
$$;

-- المدير المباشر لموظف (من دليل الموظفين، بالاسم الموحّد أو الاسم البديل)
create or replace function private.manager_of(p_pid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from staff_directory d join profiles p on public.norm(p.full_name) = public.norm(d.manager) and p.active
      where d.profile_id = p_pid and p.id <> p_pid limit 1),
    (select a.profile_id from staff_directory d join staff_aliases a on a.alias = public.norm(d.manager)
      where d.profile_id = p_pid and a.profile_id <> p_pid limit 1))
$$;

-- ============================ 1) المناوبة ============================
create table if not exists public.duty_slots (
  id        bigserial primary key,
  stage_id  int references public.stages(id) on delete cascade,     -- null = عام للمدرسة
  dow       smallint not null check (dow between 0 and 4),           -- 0 الأحد … 4 الخميس
  slot      text not null,                                           -- الوقت: قبل الطابور / الفسحة / الانصراف …
  place     text not null,                                           -- الموقع
  staff_id  uuid not null references public.profiles(id) on delete cascade,
  note      text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists duty_slots_dow on public.duty_slots(dow, stage_id);
alter table public.duty_slots enable row level security;
drop policy if exists duty_read on public.duty_slots;
create policy duty_read on public.duty_slots for select using (public.is_staff());
grant select on public.duty_slots to authenticated;

create or replace function public.duty_get(p_stage int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('can_edit', private.is_manager(),
    'slots', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'stage_id', d.stage_id, 'dow', d.dow, 'slot', d.slot, 'place', d.place,
               'staff_id', d.staff_id, 'staff', p.full_name, 'note', d.note) order by d.dow, d.slot, d.place)
             from duty_slots d join profiles p on p.id = d.staff_id
             where p_stage is null or d.stage_id = p_stage or d.stage_id is null), '[]'::jsonb));
end $$;

-- حفظ مناوبة مرحلة كاملة: p_rows = [{dow, slot, place, staff_id, note}]
create or replace function public.duty_save(p_stage int, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not private.is_manager() then raise exception 'جدول المناوبة يعدّله مدير النظام والإدارة العليا ومديرو المراحل'; end if;
  delete from duty_slots where stage_id is not distinct from p_stage;
  insert into duty_slots(stage_id, dow, slot, place, staff_id, note, updated_by)
  select p_stage, (r->>'dow')::smallint, btrim(r->>'slot'), btrim(r->>'place'), (r->>'staff_id')::uuid, nullif(btrim(r->>'note'),''), public.me_id()
  from jsonb_array_elements(coalesce(p_rows,'[]'::jsonb)) r
  where nullif(btrim(r->>'slot'),'') is not null and nullif(btrim(r->>'place'),'') is not null and (r->>'staff_id') is not null;
  return jsonb_build_object('ok', true, 'n', (select count(*) from duty_slots where stage_id is not distinct from p_stage));
end $$;

create or replace function public.duty_today() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('slot', d.slot, 'place', d.place, 'note', d.note, 'stage', s.name_ar) order by d.slot), '[]'::jsonb)
  from duty_slots d left join stages s on s.id = d.stage_id
  where d.staff_id = public.me_id() and d.dow = extract(dow from (now() at time zone 'Asia/Riyadh'))::int
$$;

-- ============================ 2) المعاملات ============================
create table if not exists public.request_types (
  key      text primary key,
  name     text not null,
  icon     text,
  fields   jsonb not null default '[]'::jsonb,      -- [{k, l, t: text|date|time|textarea|select|number, req, opts}]
  workflow jsonb not null default '["manager","leadership"]'::jsonb,   -- manager = المدير المباشر، leadership = الإدارة
  active   boolean not null default true,
  sort     int default 0
);
insert into request_types(key, name, icon, fields, workflow, sort) values
 ('permission', 'استئذان', '🚪', '[{"k":"date","l":"التاريخ","t":"date","req":true},{"k":"from","l":"من الساعة","t":"time","req":true},{"k":"to","l":"إلى الساعة","t":"time","req":true},{"k":"reason","l":"السبب","t":"textarea","req":true}]', '["manager"]', 1),
 ('leave', 'إجازة', '🏖️', '[{"k":"kind","l":"نوع الإجازة","t":"select","opts":["اضطرارية","مرضية","زواج","وفاة","أمومة / أبوة","أخرى"],"req":true},{"k":"from","l":"من تاريخ","t":"date","req":true},{"k":"to","l":"إلى تاريخ","t":"date","req":true},{"k":"reason","l":"التفاصيل","t":"textarea"}]', '["manager","leadership"]', 2),
 ('cover', 'تعويض / انتظار حصة', '🔁', '[{"k":"date","l":"التاريخ","t":"date","req":true},{"k":"period","l":"الحصة","t":"number","req":true},{"k":"class","l":"الفصل","t":"text","req":true},{"k":"reason","l":"السبب","t":"textarea"}]', '["manager"]', 3),
 ('maintenance', 'طلب صيانة', '🛠️', '[{"k":"place","l":"الموقع / الفصل","t":"text","req":true},{"k":"issue","l":"وصف العطل","t":"textarea","req":true},{"k":"urgency","l":"الأولوية","t":"select","opts":["عادية","عاجلة"]}]', '["leadership"]', 4),
 ('supplies', 'طلب مستلزمات / مواد', '📦', '[{"k":"items","l":"المطلوب والكمية","t":"textarea","req":true},{"k":"purpose","l":"الغرض","t":"text"}]', '["manager","leadership"]', 5),
 ('certificate', 'طلب تعريف بالراتب / خطاب', '📄', '[{"k":"to","l":"الجهة الموجّه إليها","t":"text","req":true},{"k":"lang","l":"اللغة","t":"select","opts":["عربي","إنجليزي"]},{"k":"notes","l":"ملاحظات","t":"textarea"}]', '["leadership"]', 6),
 ('other', 'طلب آخر', '📝', '[{"k":"details","l":"تفاصيل الطلب","t":"textarea","req":true}]', '["manager"]', 9)
on conflict (key) do nothing;
alter table public.request_types enable row level security;
drop policy if exists rt_read on public.request_types;
create policy rt_read on public.request_types for select using (public.is_staff());
drop policy if exists rt_admin on public.request_types;
create policy rt_admin on public.request_types for all using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.request_types to authenticated;

create table if not exists public.requests (
  id           bigserial primary key,
  type_key     text not null references public.request_types(key),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  data         jsonb not null default '{}'::jsonb,
  attachments  jsonb not null default '[]'::jsonb,
  status       text not null default 'pending' check (status in ('pending','approved','rejected','returned','cancelled')),
  step         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists public.request_steps (
  id          bigserial primary key,
  request_id  bigint not null references public.requests(id) on delete cascade,
  step        int not null,
  kind        text not null,                         -- manager / leadership
  approver_id uuid references public.profiles(id) on delete set null,   -- null = أي عضو من الإدارة
  decision    text check (decision in ('approve','reject','return')),
  note        text,
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  unique (request_id, step)
);
alter table public.requests enable row level security;
alter table public.request_steps enable row level security;

create or replace function private.req_can_act(p_req bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from requests r join request_steps s on s.request_id = r.id and s.step = r.step
                 where r.id = p_req and r.status = 'pending' and s.decision is null
                   and (s.approver_id = public.me_id() or (s.approver_id is null and public.is_leader()) or public.is_admin()))
$$;

create or replace function public.req_create(p_type text, p_data jsonb, p_attachments jsonb default '[]'::jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); t request_types; rid bigint; w text; i int := 0; mgr uuid; f jsonb;
begin
  if not public.is_staff() then raise exception 'المعاملات للموظفين'; end if;
  select * into t from request_types where key = p_type and active;
  if t.key is null then raise exception 'نوع الطلب غير معروف'; end if;
  for f in select * from jsonb_array_elements(t.fields) loop
    if coalesce((f->>'req')::boolean, false) and btrim(coalesce(p_data->>(f->>'k'), '')) = '' then raise exception 'أكمل الحقل: %', f->>'l'; end if;
  end loop;
  insert into requests(type_key, requester_id, data, attachments) values (p_type, me, p_data, coalesce(p_attachments,'[]')) returning id into rid;
  mgr := private.manager_of(me);
  for w in select jsonb_array_elements_text(t.workflow) loop
    -- المدير المباشر (إن لم يُعرف أو كان هو نفسه من الإدارة: تنتقل للإدارة)
    if w = 'manager' and mgr is not null then
      insert into request_steps(request_id, step, kind, approver_id) values (rid, i, 'manager', mgr);
      i := i + 1;
    elsif w = 'leadership' or (w = 'manager' and mgr is null) then
      if not exists (select 1 from request_steps where request_id = rid and kind = 'leadership') then
        insert into request_steps(request_id, step, kind, approver_id) values (rid, i, 'leadership', null); i := i + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create or replace function private.req_json(r requests) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'type', r.type_key, 'type_name', t.name, 'icon', t.icon, 'fields', t.fields, 'data', r.data,
    'attachments', r.attachments, 'status', r.status, 'step', r.step, 'at', r.created_at, 'updated', r.updated_at,
    'requester', p.full_name, 'requester_id', r.requester_id, 'requester_title', p.job_title,
    'can_act', private.req_can_act(r.id), 'mine', r.requester_id = public.me_id(),
    'steps', (select jsonb_agg(jsonb_build_object('step', s.step, 'kind', s.kind, 'approver', coalesce(ap.full_name, 'الإدارة'),
               'decision', s.decision, 'note', s.note, 'by', db.full_name, 'at', s.decided_at) order by s.step)
              from request_steps s left join profiles ap on ap.id = s.approver_id left join profiles db on db.id = s.decided_by
              where s.request_id = r.id))
  from request_types t, profiles p where t.key = r.type_key and p.id = r.requester_id
$$;

-- p_box: mine = طلباتي، inbox = بانتظار اعتمادي، all = كل الطلبات (الإدارة)
create or replace function public.req_list(p_box text default 'mine', p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if p_box = 'all' and not public.is_leader() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.req_json(r) order by r.created_at desc) from requests r
    where (p_status is null or r.status = p_status)
      and case p_box when 'mine' then r.requester_id = me
                     when 'inbox' then private.req_can_act(r.id)
                     when 'done' then exists (select 1 from request_steps s where s.request_id = r.id and s.decided_by = me)
                     else true end
    limit 300), '[]'::jsonb);
end $$;

create or replace function public.req_decide(p_id bigint, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r requests; last_step int;
begin
  if p_decision not in ('approve','reject','return') then raise exception 'قرار غير صحيح'; end if;
  if not private.req_can_act(p_id) then raise exception 'هذا الطلب ليس بانتظار اعتمادك'; end if;
  if p_decision <> 'approve' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب سبب الرفض أو الإعادة'; end if;
  select * into r from requests where id = p_id for update;
  update request_steps set decision = p_decision, note = nullif(btrim(p_note),''), decided_by = public.me_id(), decided_at = now()
   where request_id = p_id and step = r.step;
  select max(step) into last_step from request_steps where request_id = p_id;
  if p_decision = 'approve' and r.step < last_step then
    update requests set step = step + 1, updated_at = now() where id = p_id;
  else
    update requests set status = case p_decision when 'approve' then 'approved' when 'reject' then 'rejected' else 'returned' end, updated_at = now() where id = p_id;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- إلغاء الطلب (صاحبه، ما دام قيد الاعتماد)، أو إعادة تقديمه بعد التعديل
create or replace function public.req_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update requests set status = 'cancelled', updated_at = now() where id = p_id and requester_id = public.me_id() and status in ('pending','returned');
  if not found then raise exception 'لا يمكن إلغاء هذا الطلب'; end if;
  return jsonb_build_object('ok', true);
end $$;
create or replace function public.req_resubmit(p_id bigint, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update requests set data = p_data, status = 'pending', step = 0, updated_at = now() where id = p_id and requester_id = public.me_id() and status = 'returned';
  if not found then raise exception 'لا يمكن إعادة تقديم هذا الطلب'; end if;
  update request_steps set decision = null, note = null, decided_by = null, decided_at = null where request_id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ============================ 3) الشكاوى ============================
create table if not exists public.complaints (
  id           bigserial primary key,
  submitter_id uuid not null references public.profiles(id) on delete cascade,
  student_id   uuid references public.students(profile_id) on delete set null,   -- الطالب المعني (لولي الأمر)
  category     text not null,
  subject      text not null check (btrim(subject) <> ''),
  details      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,
  teacher_id   uuid references public.profiles(id) on delete set null,          -- المعلم المعني (اختياري)
  status       text not null default 'new' check (status in ('new','in_progress','resolved','closed')),
  assignee_id  uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists public.complaint_updates (
  id           bigserial primary key,
  complaint_id bigint not null references public.complaints(id) on delete cascade,
  by_id        uuid references public.profiles(id) on delete set null,
  note         text,
  status       text,
  internal     boolean not null default false,       -- ملاحظة داخلية لا يراها مقدم الشكوى
  at           timestamptz not null default now()
);
alter table public.complaints enable row level security;
alter table public.complaint_updates enable row level security;

create or replace function private.cmp_can_manage(c complaints) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_leader() or c.assignee_id = public.me_id()
      or (public.me_role() = 'principal' and (c.student_id is null or public.can_view_student(c.student_id)))
$$;

create or replace function public.cmp_create(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); cid bigint; sid uuid := nullif(p->>'student_id','')::uuid;
begin
  if me is null then raise exception 'غير مسجّل'; end if;
  if btrim(coalesce(p->>'subject','')) = '' then raise exception 'اكتب عنوان الشكوى'; end if;
  if sid is not null and not public.can_view_student(sid) then raise exception 'غير مصرح بهذا الطالب'; end if;
  insert into complaints(submitter_id, student_id, category, subject, details, attachments, teacher_id)
  values (me, sid, coalesce(nullif(p->>'category',''), 'أخرى'), btrim(p->>'subject'), coalesce(p->>'details',''),
          coalesce(p->'attachments','[]'::jsonb), nullif(p->>'teacher_id','')::uuid)
  returning id into cid;
  insert into complaint_updates(complaint_id, by_id, note, status) values (cid, me, 'تم تسجيل الشكوى', 'new');
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

create or replace function public.cmp_list(p_box text default 'mine') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if me is null then raise exception 'غير مسجّل'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'category', c.category, 'subject', c.subject, 'status', c.status,
      'at', c.created_at, 'updated', c.updated_at, 'by', sp.full_name, 'by_role', sp.role, 'student', st.full_name,
      'teacher', tp.full_name, 'assignee', ap.full_name) order by c.status = 'closed', c.updated_at desc)
    from complaints c join profiles sp on sp.id = c.submitter_id
    left join profiles st on st.id = c.student_id left join profiles tp on tp.id = c.teacher_id left join profiles ap on ap.id = c.assignee_id
    where case when p_box = 'manage' then private.cmp_can_manage(c) else c.submitter_id = me end), '[]'::jsonb);
end $$;

create or replace function public.cmp_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c complaints; mng boolean;
begin
  select * into c from complaints where id = p_id;
  if c.id is null then raise exception 'غير موجودة'; end if;
  mng := private.cmp_can_manage(c);
  if not (mng or c.submitter_id = public.me_id()) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('id', c.id, 'category', c.category, 'subject', c.subject, 'details', c.details, 'attachments', c.attachments,
    'status', c.status, 'at', c.created_at, 'manage', mng,
    'by', (select full_name from profiles where id = c.submitter_id), 'by_role', (select role from profiles where id = c.submitter_id),
    'student', (select full_name from profiles where id = c.student_id), 'teacher', (select full_name from profiles where id = c.teacher_id),
    'assignee', (select full_name from profiles where id = c.assignee_id), 'assignee_id', c.assignee_id,
    'updates', (select jsonb_agg(jsonb_build_object('note', u.note, 'status', u.status, 'internal', u.internal, 'at', u.at, 'by', p.full_name) order by u.at)
                from complaint_updates u left join profiles p on p.id = u.by_id where u.complaint_id = c.id and (mng or not u.internal)));
end $$;

create or replace function public.cmp_update(p_id bigint, p_status text default null, p_note text default null,
                                             p_internal boolean default false, p_assignee uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c complaints; me uuid := public.me_id();
begin
  select * into c from complaints where id = p_id;
  if c.id is null then raise exception 'غير موجودة'; end if;
  if not private.cmp_can_manage(c) then
    -- مقدم الشكوى يضيف ردًا فقط
    if c.submitter_id <> me or btrim(coalesce(p_note,'')) = '' then raise exception 'غير مصرح'; end if;
    insert into complaint_updates(complaint_id, by_id, note) values (p_id, me, btrim(p_note));
    update complaints set updated_at = now(), status = case when status = 'resolved' then 'in_progress' else status end where id = p_id;
    return jsonb_build_object('ok', true);
  end if;
  if p_status is not null and p_status not in ('new','in_progress','resolved','closed') then raise exception 'حالة غير صحيحة'; end if;
  update complaints set status = coalesce(p_status, status), assignee_id = coalesce(p_assignee, assignee_id), updated_at = now() where id = p_id;
  if btrim(coalesce(p_note,'')) <> '' or p_status is not null or p_assignee is not null then
    insert into complaint_updates(complaint_id, by_id, note, status, internal)
    values (p_id, me, nullif(btrim(coalesce(p_note,'')),'') || case when p_assignee is not null then ' (أُسندت إلى: ' || (select full_name from profiles where id = p_assignee) || ')' else '' end,
            p_status, coalesce(p_internal, false));
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ============================ 4) التدريب ============================
create table if not exists public.trainings (
  id            bigserial primary key,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (btrim(title) <> ''),
  provider      text,
  mode          text,                                -- حضوري / عن بعد / داخلي / خارجي
  start_date    date,
  end_date      date,
  hours         numeric(6,1) not null default 0 check (hours >= 0),
  certificate   jsonb,                               -- {name, path, size}
  self_rating   smallint check (self_rating between 1 and 5),
  self_note     text,                                -- كيف طبّقت التدريب
  impact_rating smallint check (impact_rating between 1 and 5),   -- تقييم المشرف لأثر التدريب
  impact_note   text,
  impact_by     uuid references public.profiles(id) on delete set null,
  impact_at     timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists trainings_profile on public.trainings(profile_id);
alter table public.trainings enable row level security;

create or replace function private.trn_can_view(p_pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_pid = public.me_id() or coalesce(public.me_role() in ('admin','leadership','principal','supervisor'), false)
$$;

create or replace function public.trn_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); tid bigint := nullif(p->>'id','')::bigint;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if btrim(coalesce(p->>'title','')) = '' then raise exception 'اكتب اسم البرنامج التدريبي'; end if;
  if tid is null then
    insert into trainings(profile_id, title, provider, mode, start_date, end_date, hours, certificate, self_rating, self_note)
    values (me, btrim(p->>'title'), nullif(p->>'provider',''), nullif(p->>'mode',''), nullif(p->>'start_date','')::date, nullif(p->>'end_date','')::date,
            coalesce(nullif(p->>'hours','')::numeric, 0), case when jsonb_typeof(p->'certificate') = 'object' then p->'certificate' end,
            nullif(p->>'self_rating','')::smallint, nullif(p->>'self_note',''))
    returning id into tid;
  else
    update trainings set title = btrim(p->>'title'), provider = nullif(p->>'provider',''), mode = nullif(p->>'mode',''),
      start_date = nullif(p->>'start_date','')::date, end_date = nullif(p->>'end_date','')::date, hours = coalesce(nullif(p->>'hours','')::numeric, 0),
      certificate = case when jsonb_typeof(p->'certificate') = 'object' then p->'certificate' else certificate end,
      self_rating = nullif(p->>'self_rating','')::smallint, self_note = nullif(p->>'self_note','')
    where id = tid and profile_id = me;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

create or replace function public.trn_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from trainings where id = p_id and (profile_id = public.me_id() or public.is_admin());
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- تقييم أثر التدريب (المشرف/الإدارة)
create or replace function public.trn_impact(p_id bigint, p_rating int, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(public.me_role() in ('admin','leadership','principal','supervisor'), false) then raise exception 'تقييم الأثر للمشرفين والإدارة'; end if;
  update trainings set impact_rating = p_rating, impact_note = nullif(btrim(p_note),''), impact_by = public.me_id(), impact_at = now()
   where id = p_id and profile_id <> public.me_id();
  if not found then raise exception 'لا يمكن تقييم سجلك أنت'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- p_pid null + صلاحية = الكل (تقرير)، وإلا سجلي
create or replace function public.trn_list(p_pid uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); allv boolean := coalesce(public.me_role() in ('admin','leadership','principal','supervisor'), false);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if p_pid is not null and not private.trn_can_view(p_pid) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('can_all', allv, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'pid', t.profile_id, 'name', p.full_name,
      'title', t.title, 'provider', t.provider, 'mode', t.mode, 'start', t.start_date, 'end', t.end_date, 'hours', t.hours,
      'certificate', t.certificate, 'self_rating', t.self_rating, 'self_note', t.self_note, 'impact_rating', t.impact_rating,
      'impact_note', t.impact_note, 'impact_by', ib.full_name, 'mine', t.profile_id = me) order by t.start_date desc nulls last, t.id desc)
    from trainings t join profiles p on p.id = t.profile_id left join profiles ib on ib.id = t.impact_by
    where (case when p_pid is not null then t.profile_id = p_pid when allv then true else t.profile_id = me end)
      and (p_from is null or coalesce(t.end_date, t.start_date) >= p_from) and (p_to is null or coalesce(t.start_date, t.end_date) <= p_to)), '[]'::jsonb));
end $$;

-- ============================ الصلاحيات + المرفقات ============================
do $$ declare f text; begin
  foreach f in array array['duty_get(int)','duty_save(int,jsonb)','duty_today()','req_create(text,jsonb,jsonb)','req_list(text,text)',
    'req_decide(bigint,text,text)','req_cancel(bigint)','req_resubmit(bigint,jsonb)','cmp_create(jsonb)','cmp_list(text)','cmp_get(bigint)',
    'cmp_update(bigint,text,text,boolean,uuid)','trn_save(jsonb)','trn_delete(bigint)','trn_impact(bigint,int,text)','trn_list(uuid,date,date)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- قراءة المرفقات: صاحبها، أو مستلم رسالة، أو معتمد/صاحب معاملة، أو من يدير الشكوى، أو من يرى سجل التدريب
create or replace function public.att_can_read(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.att_folder_ok(p_name)
    or exists (select 1 from messages m where m.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
                 and (m.sender_id = public.me_id() or exists (select 1 from message_recipients r where r.message_id = m.id and r.profile_id = public.me_id())))
    or exists (select 1 from requests q where q.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
                 and (q.requester_id = public.me_id() or public.is_leader()
                      or exists (select 1 from request_steps s where s.request_id = q.id and s.approver_id = public.me_id())))
    or exists (select 1 from complaints c where c.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
                 and (c.submitter_id = public.me_id() or private.cmp_can_manage(c)))
    or exists (select 1 from trainings t where t.certificate->>'path' = p_name and private.trn_can_view(t.profile_id))
$$;
