-- =====================================================================
-- 55: بنك المبادرات + تقويم المدرسة الموحّد + «مهامي» في الرئيسية
-- =====================================================================

-- ================= بنك المبادرات =================
--   المعلم/الموظف يقترح مبادرة ← يعتمدها مشرفه (نفس منطق اعتماد تحضير الدروس) أو مدير المرحلة/الإدارة
--   ← بعد التنفيذ يرفع الأثر والأدلة وعدد المستفيدين ← تُعرض في ملف إنجاز المعلم وبنك المبادرات للجميع
create table if not exists public.in_initiatives (
  id            bigserial primary key,
  owner_id      uuid not null references public.profiles(id) on delete cascade,
  title         text not null check (btrim(title) <> ''),
  field         text not null default 'educational' check (field in ('educational','values','community','professional','tech','health','environment','other')),
  goals         text,
  target        text,
  plan_date     date,
  partners      text,
  status        text not null default 'draft' check (status in ('draft','pending','approved','returned','done')),
  reviewer_id   uuid references public.profiles(id) on delete set null,
  review_note   text,
  reviewed_at   timestamptz,
  impact        text,
  beneficiaries int,
  evidence      jsonb not null default '[]'::jsonb,
  done_at       date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists in_initiatives_owner_idx on public.in_initiatives (owner_id, created_at desc);
create index if not exists in_initiatives_status_idx on public.in_initiatives (status);
alter table public.in_initiatives enable row level security;
revoke all on public.in_initiatives from anon, authenticated;

create or replace function private.in_reviewer(p_owner uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select p_owner <> public.me_id() and (public.me_role() in ('admin','leadership') or private.lp_can_approve(p_owner)
    or (public.me_role() = 'principal' and exists (
          select 1 from staff_scopes sc join profiles o on o.id = p_owner
           where sc.profile_id = public.me_id() and (
             exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id join stages st on st.id = g.stage_id
                      where ta.teacher_id = p_owner and (sc.section_id is null or sc.section_id = st.section_id) and (sc.stage_id is null or sc.stage_id = st.id))
             or exists (select 1 from staff_scopes so where so.profile_id = p_owner and so.stage_id is not distinct from sc.stage_id and so.section_id is not distinct from sc.section_id)))))
$$;

create or replace function private.in_json(i public.in_initiatives) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select to_jsonb(i) || jsonb_build_object('owner', (select full_name from profiles where id = i.owner_id), 'owner_title', (select job_title from profiles where id = i.owner_id),
    'reviewer', (select full_name from profiles where id = i.reviewer_id), 'mine', i.owner_id = public.me_id(), 'can_review', private.in_reviewer(i.owner_id))
$$;

-- p_box: mine | review (بانتظار اعتمادي) | bank (المنفّذة والمعتمدة للجميع)
create or replace function public.in_list(p_box text default 'mine') returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id();
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.in_json(i) order by i.updated_at desc) from (
      select * from in_initiatives i
       where case p_box when 'mine' then i.owner_id = me
                        when 'review' then i.status = 'pending' and private.in_reviewer(i.owner_id)
                        else i.status in ('approved','done') end
       order by i.updated_at desc limit 500) i), '[]'::jsonb);
end $$;

create or replace function public.in_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); iid bigint := nullif(p->>'id','')::bigint; i in_initiatives; ttl text := btrim(coalesce(p->>'title','')); sub boolean := coalesce((p->>'submit')::boolean, false);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if iid is not null then select * into i from in_initiatives where id = iid; if not found or i.owner_id <> me then raise exception 'غير مصرح'; end if;
    if i.status in ('approved','done') then raise exception 'المبادرة معتمدة — سجّل التنفيذ والأثر بدل تعديلها'; end if; end if;
  if ttl = '' then raise exception 'اكتب عنوان المبادرة'; end if;
  if iid is null then
    insert into in_initiatives(owner_id, title, field, goals, target, plan_date, partners, status)
    values (me, left(ttl, 200), coalesce(nullif(p->>'field',''), 'educational'), nullif(left(btrim(coalesce(p->>'goals','')), 3000), ''),
            nullif(left(btrim(coalesce(p->>'target','')), 200), ''), nullif(p->>'plan_date','')::date, nullif(left(btrim(coalesce(p->>'partners','')), 300), ''),
            case when sub then 'pending' else 'draft' end) returning id into iid;
  else
    update in_initiatives set title = left(ttl, 200), field = coalesce(nullif(p->>'field',''), field), goals = nullif(left(btrim(coalesce(p->>'goals','')), 3000), ''),
           target = nullif(left(btrim(coalesce(p->>'target','')), 200), ''), plan_date = nullif(p->>'plan_date','')::date, partners = nullif(left(btrim(coalesce(p->>'partners','')), 300), ''),
           status = case when sub then 'pending' else status end, updated_at = now() where id = iid;
  end if;
  return jsonb_build_object('ok', true, 'id', iid);
end $$;

create or replace function public.in_review(p_id bigint, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare i in_initiatives; mid bigint;
begin
  select * into i from in_initiatives where id = p_id; if not found then raise exception 'غير موجودة'; end if;
  if not private.in_reviewer(i.owner_id) then raise exception 'غير مصرح'; end if;
  if p_decision not in ('approve','return') then raise exception 'قرار غير صالح'; end if;
  if p_decision = 'return' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب ملاحظاتك لصاحب المبادرة'; end if;
  update in_initiatives set status = case when p_decision = 'approve' then 'approved' else 'returned' end, reviewer_id = public.me_id(), reviewed_at = now(),
         review_note = nullif(left(btrim(coalesce(p_note,'')), 1000), ''), updated_at = now() where id = p_id;
  begin
    insert into messages(kind, sender_id, subject, body, audience) values ('mail', public.me_id(),
      left(case when p_decision = 'approve' then 'اعتُمدت مبادرتك: ' else 'ملاحظات على مبادرتك: ' end || i.title, 200),
      case when p_decision = 'approve' then 'تم اعتماد مبادرتك «' || i.title || '». بعد التنفيذ سجّل الأثر والأدلة من: المنصة ← بنك المبادرات.'
           else 'أُعيدت مبادرتك «' || i.title || '» بالملاحظات التالية:' || E'\n' || btrim(p_note) end, 'بنك المبادرات') returning id into mid;
    insert into message_recipients(message_id, profile_id) values (mid, i.owner_id) on conflict do nothing;
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.in_complete(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare i in_initiatives; ev jsonb;
begin
  select * into i from in_initiatives where id = p_id; if not found or i.owner_id <> public.me_id() then raise exception 'غير مصرح'; end if;
  if i.status not in ('approved','done') then raise exception 'تُسجَّل نتائج المبادرة بعد اعتمادها'; end if;
  if btrim(coalesce(p->>'impact','')) = '' then raise exception 'اكتب أثر المبادرة'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('url', left(btrim(l->>'url'), 500), 'title', left(btrim(coalesce(l->>'title','')), 120))), '[]'::jsonb) into ev
    from (select l from jsonb_array_elements(coalesce(p->'evidence','[]'::jsonb)) l where btrim(coalesce(l->>'url','')) ~* '^https?://' limit 10) z;
  update in_initiatives set status = 'done', impact = left(btrim(p->>'impact'), 3000), beneficiaries = nullif(p->>'beneficiaries','')::int, evidence = ev,
         done_at = coalesce(nullif(p->>'done_at','')::date, current_date), updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.in_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare i in_initiatives;
begin
  select * into i from in_initiatives where id = p_id; if not found then raise exception 'غير موجودة'; end if;
  if not ((i.owner_id = public.me_id() and i.status in ('draft','returned','pending')) or public.is_admin()) then raise exception 'لا يمكن حذف مبادرة معتمدة'; end if;
  delete from in_initiatives where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ================= تقويم المدرسة الموحّد =================
create table if not exists public.sc_events (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  kind        text not null default 'event' check (kind in ('exam','event','meeting','holiday','visit','deadline','other')),
  start_date  date not null,
  end_date    date,
  audience    text[] not null default '{leadership,principal,supervisor,teacher,staff}',
  stage_id    int references public.stages(id) on delete set null,
  note        text,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists sc_events_date_idx on public.sc_events (start_date);
alter table public.sc_events enable row level security;
revoke all on public.sc_events from anon, authenticated;

create or replace function private.cal_manager() returns boolean
language sql stable security definer set search_path = public as $$ select public.me_role() in ('admin','leadership','principal') $$;

create or replace function public.cal_event_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare eid bigint := nullif(p->>'id','')::bigint; ttl text := btrim(coalesce(p->>'title','')); aud text[];
begin
  if not private.cal_manager() then raise exception 'إضافة أحداث التقويم للإدارة ومديري المراحل'; end if;
  if eid is not null and not (public.is_admin() or public.me_role() = 'leadership' or exists (select 1 from sc_events where id = eid and created_by = public.me_id())) then raise exception 'يعدّل الحدث من أضافه أو الإدارة'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الحدث'; end if;
  if nullif(p->>'start_date','') is null then raise exception 'اختر تاريخ الحدث'; end if;
  aud := array(select x from jsonb_array_elements_text(coalesce(p->'audience','[]'::jsonb)) x where x in ('leadership','principal','supervisor','teacher','staff','student','parent'));
  if coalesce(array_length(aud, 1), 0) = 0 then aud := '{leadership,principal,supervisor,teacher,staff}'; end if;
  if eid is null then
    insert into sc_events(title, kind, start_date, end_date, audience, stage_id, note, created_by)
    values (left(ttl, 200), coalesce(nullif(p->>'kind',''), 'event'), (p->>'start_date')::date, nullif(p->>'end_date','')::date, aud, nullif(p->>'stage_id','')::int,
            nullif(left(btrim(coalesce(p->>'note','')), 1000), ''), public.me_id()) returning id into eid;
  else
    update sc_events set title = left(ttl, 200), kind = coalesce(nullif(p->>'kind',''), kind), start_date = (p->>'start_date')::date, end_date = nullif(p->>'end_date','')::date,
           audience = aud, stage_id = nullif(p->>'stage_id','')::int, note = nullif(left(btrim(coalesce(p->>'note','')), 1000), '') where id = eid;
  end if;
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

create or replace function public.cal_event_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not (public.is_admin() or public.me_role() = 'leadership' or exists (select 1 from sc_events where id = p_id and created_by = public.me_id())) then raise exception 'غير مصرح'; end if;
  delete from sc_events where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- كل ما يخصني في فترة: أحداث المدرسة + حجوزاتي في المختبرات والمرافق + مواعيد المسابقات + اختباراتي وواجباتي (للمعلم) + مناوبتي
create or replace function public.cal_feed(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := public.me_role()::text; my_stages int[];
begin
  if me is null then raise exception 'غير مصرح'; end if;
  if p_to - p_from > 100 then raise exception 'الفترة طويلة'; end if;
  my_stages := array(select distinct g.stage_id from students s join grades g on g.id = s.grade_id
                      where s.profile_id = me or s.profile_id in (select student_id from parent_links where parent_id = me));
  return jsonb_build_object('manager', private.cal_manager(), 'items',
    coalesce((select jsonb_agg(x order by x->>'date') from (
      select jsonb_build_object('src', 'event', 'id', e.id, 'kind', e.kind, 'title', e.title, 'date', e.start_date, 'end', e.end_date, 'note', e.note,
               'stage', (select name_ar from stages where id = e.stage_id), 'audience', e.audience, 'stage_id', e.stage_id,
               'can_edit', public.is_admin() or r = 'leadership' or e.created_by = me) x
        from sc_events e
       where coalesce(e.end_date, e.start_date) >= p_from and e.start_date <= p_to
         and (r = 'admin' or r = any (e.audience)) and (e.stage_id is null or r not in ('student','parent') or e.stage_id = any (my_stages))
      union all
      select jsonb_build_object('src', 'lab', 'kind', 'booking', 'title', l.icon || ' ' || l.name || ': ' || b.title, 'date', b.day, 'period', b.period, 'status', b.status, 'link', 'labs.html?lab=' || l.code)
        from lab_bookings b join labs l on l.id = b.lab_id
       where r not in ('student','parent') and b.teacher_id = me and b.day between p_from and p_to and b.status in ('pending','prepared','done')
      union all
      select jsonb_build_object('src', 'comp', 'kind', 'deadline', 'title', '🏆 ' || c.name || ' — ' || d.lbl, 'date', d.dt, 'link', 'talent.html')
        from tl_competitions c cross join lateral (values (c.reg_deadline, 'آخر تسجيل'), (c.test_date, 'الاختبار'), (c.final_date, 'النهائي')) d(dt, lbl)
       where r not in ('student','parent') and c.active and d.dt between p_from and p_to
      union all
      select jsonb_build_object('src', 'exam', 'kind', 'exam', 'title', '🧪 ' || x.title, 'date', (x.opens_at at time zone 'Asia/Riyadh')::date, 'link', 'exams.html')
        from ex_exams x where x.teacher_id = me and (x.opens_at at time zone 'Asia/Riyadh')::date between p_from and p_to
      union all
      select jsonb_build_object('src', 'hw', 'kind', 'deadline', 'title', '📝 تسليم: ' || h.title, 'date', (h.due_at at time zone 'Asia/Riyadh')::date, 'link', 'homework.html')
        from hw_assignments h where h.teacher_id = me and (h.due_at at time zone 'Asia/Riyadh')::date between p_from and p_to
    ) q), '[]'::jsonb));
end $$;

-- ================= «مهامي» في الرئيسية =================
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
  -- مواعيد مسابقات خلال 7 أيام (لمسؤوليها والمنسق)
  select count(*) into n from tl_competitions c where c.active and (c.owner_id = me or private.tl_manager())
     and (c.reg_deadline between current_date and current_date + 7 or c.test_date between current_date and current_date + 7);
  if n > 0 then out := out || jsonb_build_object('icon', '🏆', 'text', n || ' موعد مسابقة خلال أسبوع', 'link', 'talent.html'); end if;
  -- ترشيحات جديدة على مسابقاتي
  select count(*) into n from tl_entries e join tl_competitions c on c.id = e.comp_id where c.owner_id = me and e.status = 'nominated';
  if n > 0 then out := out || jsonb_build_object('icon', '🌟', 'text', n || ' ترشيح بانتظار المراجعة في مسابقاتك', 'link', 'talent.html'); end if;
  -- أحداث المدرسة اليوم
  select count(*) into n from sc_events e where current_date between e.start_date and coalesce(e.end_date, e.start_date) and (r = 'admin' or r = any (e.audience));
  if n > 0 then out := out || jsonb_build_object('icon', '📅', 'text', n || ' حدث في تقويم المدرسة اليوم', 'link', 'calendar.html'); end if;
  return out;
end $$;

revoke all on function private.in_reviewer(uuid), private.in_json(public.in_initiatives), private.cal_manager() from public, anon, authenticated;
revoke all on function public.in_list(text), public.in_save(jsonb), public.in_review(bigint, text, text), public.in_complete(bigint, jsonb), public.in_delete(bigint),
  public.cal_event_save(jsonb), public.cal_event_delete(bigint), public.cal_feed(date, date), public.my_tasks() from public, anon;
grant execute on function public.in_list(text), public.in_save(jsonb), public.in_review(bigint, text, text), public.in_complete(bigint, jsonb), public.in_delete(bigint),
  public.cal_event_save(jsonb), public.cal_event_delete(bigint), public.cal_feed(date, date), public.my_tasks() to authenticated;
