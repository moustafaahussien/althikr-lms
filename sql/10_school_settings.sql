-- =====================================================================
--  الملف 10: إعدادات المدرسة للجداول (يديرها مدير النظام والإدارة العليا ومديرو المراحل)
--  - توقيت الحصص لكل مرحلة (مرة واحدة للمدرسة كلها بدل نسخة لكل مشرف)
--  - إدارة جداول المشرفين: رفع الجدول، أسماء الجداول، مادة المعلم، مرحلة الصف وتوقيته
--  مكتب الإشراف التربوي يقرأ هذه الإعدادات فقط.
-- =====================================================================

-- أنظمة التوقيت (ابتدائي، متوسط، ثانوي، أمريكي ابتدائي/متوسط)
create table if not exists public.period_profiles (
  key   text primary key,
  name  text not null,
  sort  smallint not null default 0
);
-- المراحل التي يتبعها كل نظام توقيت (لتحديد صلاحية مدير المرحلة)
create table if not exists public.period_profile_stages (
  profile  text not null references public.period_profiles(key) on delete cascade,
  stage_id int  not null references public.stages(id) on delete cascade,
  primary key (profile, stage_id)
);
create table if not exists public.school_periods (
  profile   text not null references public.period_profiles(key) on delete cascade,
  period    smallint not null check (period between 1 and 30),
  start_t   text not null default '' check (start_t = '' or start_t ~ '^\d{2}:\d{2}$'),
  end_t     text not null default '' check (end_t = '' or end_t ~ '^\d{2}:\d{2}$'),
  primary key (profile, period)
);
alter table public.tt_stage add column if not exists prof text references public.period_profiles(key) on delete set null;
alter table public.tt_stage alter column stage drop not null;

insert into public.period_profiles(key, name, sort) values
  ('pri','ابتدائي (الصفوف العليا)',1), ('mid','متوسط',2), ('sec','ثانوي',3), ('amp','المسار الأمريكي – Primary',4), ('amm','المسار الأمريكي – Middle',5)
on conflict (key) do update set name = excluded.name, sort = excluded.sort;
insert into public.period_profile_stages(profile, stage_id)
select x.p, st.id from (values ('pri','boys-primary'),('pri','girls-primary'),('mid','boys-intermediate'),
  ('sec','boys-secondary'),('amp','american'),('amm','american')) x(p, code)
join public.stages st on st.code = x.code
on conflict do nothing;
insert into public.school_periods(profile, period, start_t, end_t) values
  ('pri',1,'07:15','07:54'), ('pri',2,'07:55','08:34'), ('pri',3,'08:35','09:14'), ('pri',4,'09:46','10:21'), ('pri',5,'10:22','10:57'), ('pri',6,'10:58','11:33'), ('pri',7,'11:34','12:09'), ('pri',8,'12:10','12:45'), ('pri',9,'13:10','13:45'), ('mid',1,'07:15','07:55'), ('mid',2,'07:55','08:35'), ('mid',3,'08:35','09:15'), ('mid',4,'09:40','10:20'), ('mid',5,'10:21','11:01'), ('mid',6,'11:02','11:42'), ('mid',7,'11:43','12:23'), ('mid',8,'12:24','13:04'), ('mid',9,'13:20','14:00'), ('sec',1,'07:30','08:15'), ('sec',2,'08:15','09:00'), ('sec',3,'09:00','09:45'), ('sec',4,'10:10','10:55'), ('sec',5,'10:55','11:40'), ('sec',6,'11:40','12:25'), ('sec',7,'12:25','13:10'), ('amp',1,'07:15','07:55'), ('amp',2,'07:55','08:35'), ('amp',3,'08:35','09:15'), ('amp',4,'09:15','09:55'), ('amp',5,'10:21','11:01'), ('amp',6,'11:02','11:42'), ('amp',7,'11:43','12:23'), ('amp',8,'12:24','13:04'), ('amp',9,'13:20','14:00'), ('amm',1,'07:15','07:55'), ('amm',2,'07:55','08:35'), ('amm',3,'08:35','09:15'), ('amm',4,'09:40','10:20'), ('amm',5,'10:21','11:01'), ('amm',6,'11:02','11:42'), ('amm',7,'11:43','12:23'), ('amm',8,'12:24','13:04'), ('amm',9,'13:20','14:00')
on conflict (profile, period) do nothing;

alter table public.period_profiles enable row level security;
alter table public.period_profile_stages enable row level security;
alter table public.school_periods enable row level security;
do $$ declare t text; begin
  foreach t in array array['period_profiles','period_profile_stages','school_periods'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_staff())', t||'_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------- الصلاحيات ----------
-- من يدير إعدادات الجداول: مدير النظام، الإدارة العليا، مدير المرحلة
create or replace function public.can_manage_school() returns boolean
language sql stable as $$ select coalesce(public.me_role() in ('admin','leadership','principal'), false) $$;

-- المراحل المسموحة لمدير المرحلة (من نطاقاته)؛ المدير والإدارة العليا: كل المراحل
create or replace function private.my_stage_ids() returns int[]
language sql stable security definer set search_path = public as $$
  select case when public.me_role() in ('admin','leadership') then (select array_agg(id) from stages)
    else coalesce((select array_agg(distinct st.id) from staff_scopes sc
                    join stages st on st.id = sc.stage_id or (sc.stage_id is null and sc.section_id = st.section_id)
                     or (sc.stage_id is null and sc.section_id is null)
                   where sc.profile_id = public.me_id()), '{}') end
$$;
create or replace function private.can_edit_profile(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_school() and exists (
    select 1 from period_profile_stages ps where ps.profile = p and ps.stage_id = any(private.my_stage_ids()))
$$;

-- ---------- القراءة (لصفحة الإعدادات) ----------
create or replace function public.sch_tt_get() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.can_manage_school() then raise exception 'غير مصرح: إعدادات الجداول لمدير النظام والإدارة العليا ومديري المراحل'; end if;
  return jsonb_build_object('ok', true,
    'profiles', coalesce((select jsonb_agg(jsonb_build_object('key', pp.key, 'name', pp.name, 'can', private.can_edit_profile(pp.key),
                   'times', coalesce((select jsonb_agg(jsonb_build_object('p', sp.period, 's', sp.start_t, 'e', sp.end_t) order by sp.period)
                                        from school_periods sp where sp.profile = pp.key), '[]'::jsonb)) order by pp.sort)
                 from period_profiles pp), '[]'::jsonb),
    'supervisors', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'dept', coalesce(m.dept, ''), 'email', p.email) order by p.full_name)
                 from supervision_members m join profiles p on p.id = m.profile_id where m.active and p.active), '[]'::jsonb),
    'sheets', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'owner', s.owner_id, 'idx', s.idx, 'name', s.src_name, 'label', s.label,
                   'updated', s.updated_at, 'slots', (select count(*) from tt_slots x where x.sheet_id = s.id and x.kind = 'class')) order by s.owner_id, s.idx)
                 from tt_sheets s), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(jsonb_build_object('sheet', q.sheet_id, 'id', q.teacher_id, 'name', p.full_name, 'n', q.n,
                   'fixed', q.fixed, 'subject', sb.name_ar) order by q.sheet_id, p.full_name)
                 from (select sl.sheet_id, sl.teacher_id, count(*) filter (where sl.kind = 'class') n,
                              string_agg(distinct sj.name_ar, '، ') fixed
                         from tt_slots sl left join subjects sj on sj.id = sl.subject_id
                        where sl.teacher_id is not null group by 1, 2) q
                 join profiles p on p.id = q.teacher_id
                 left join tt_teacher_subject ts on ts.sheet_id = q.sheet_id and ts.teacher_id = q.teacher_id
                 left join subjects sb on sb.id = ts.subject_id), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('sheet', g.sheet_id, 'track', g.track, 'grade', g.grade_num, 'classes', g.classes,
                   'stage', private.tt_stage_of(g.sheet_id, g.track, g.grade_num), 'stage_set', st.stage is not null, 'prof', st.prof)
                   order by g.sheet_id, g.track, g.grade_num)
                 from (select sheet_id, coalesce(track, 'arabic') track, grade_num, string_agg(distinct cls, '، ') classes
                         from tt_slots where kind = 'class' and grade_num is not null group by 1, 2, 3) g
                 left join tt_stage st on st.sheet_id = g.sheet_id and st.track = g.track and st.grade_num = g.grade_num), '[]'::jsonb));
end $$;

-- ---------- التعديل ----------
-- توقيت نظام: p = {profile, times:[{s,e}...]} (الحصة 1 أولًا)
create or replace function public.sch_times_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare k text := p->>'profile'; t jsonb; i int := 0;
begin
  if not private.can_edit_profile(k) then raise exception 'غير مصرح: هذا التوقيت يعدّله مدير المرحلة التابعة له'; end if;
  delete from school_periods where profile = k;
  for t in select * from jsonb_array_elements(coalesce(p->'times', '[]')) loop
    i := i + 1;
    if coalesce(t->>'s', '') <> '' or coalesce(t->>'e', '') <> '' then
      insert into school_periods(profile, period, start_t, end_t) values (k, i, coalesce(t->>'s', ''), coalesce(t->>'e', ''));
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- تعديل جدول: p = {action:'label', sheet, value} | {action:'subject', sheet, teacher(uuid), value}
--             | {action:'stage', sheet, track, grade, value} | {action:'prof', sheet, track, grade, value} | {action:'delete_sheet', sheet}
create or replace function public.sch_tt_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid int := (p->>'sheet')::int; act text := p->>'action'; val text := btrim(coalesce(p->>'value', ''));
begin
  if not public.can_manage_school() then raise exception 'غير مصرح'; end if;
  if not exists (select 1 from tt_sheets where id = sid) then raise exception 'الجدول غير موجود'; end if;
  if act = 'label' then
    update tt_sheets set label = nullif(val, ''), updated_at = now() where id = sid;
  elsif act = 'subject' then
    if val = '' then delete from tt_teacher_subject where sheet_id = sid and teacher_id = (p->>'teacher')::uuid;
    else insert into tt_teacher_subject(sheet_id, teacher_id, subject_id) values (sid, (p->>'teacher')::uuid, private.tt_subject(val))
         on conflict (sheet_id, teacher_id) do update set subject_id = excluded.subject_id; end if;
    perform private.tt_refresh();
  elsif act in ('stage','prof') then
    insert into tt_stage(sheet_id, track, grade_num, stage, prof)
    values (sid, p->>'track', (p->>'grade')::smallint,
            case when act = 'stage' then nullif(val, '') end, case when act = 'prof' then nullif(val, '') end)
    on conflict (sheet_id, track, grade_num) do update
      set stage = case when act = 'stage' then nullif(val, '') else tt_stage.stage end,
          prof  = case when act = 'prof'  then nullif(val, '') else tt_stage.prof end;
    if act = 'stage' then
      update tt_slots set class_id = private.tt_class(sheet_id, track, grade_num, section)
       where sheet_id = sid and kind = 'class' and coalesce(track, 'arabic') = p->>'track' and grade_num = (p->>'grade')::smallint;
      perform private.tt_refresh();
    end if;
  elsif act = 'delete_sheet' then
    delete from tt_sheets where id = sid; perform private.tt_refresh();
  else raise exception 'إجراء غير معروف';
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- مرحلة الصف: «غير محدد» إذا لم تُحدَّد (بعد السماح بقيمة فارغة)
create or replace function private.tt_stage_of(p_sheet int, p_track text, g smallint) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select stage from tt_stage where sheet_id = p_sheet and track = coalesce(p_track, 'arabic') and grade_num = g and stage is not null),
    case when p_track = 'american' then 'المسار الأمريكي' when g between 4 and 6 then 'ابتدائي' else 'غير محدد' end)
$$;

create or replace function private.tt_put(v_owner uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  s jsonb; e jsonb; k text; v text;
  sid int; ids jsonb := '{}'::jsonb; idxs int[] := '{}'; tid uuid; n int := 0; j int;
begin

  for s in select * from jsonb_array_elements(coalesce(p->'sheets', '[]')) loop
    insert into tt_sheets(owner_id, idx, src_name, label)
    values (v_owner, (s->>'idx')::smallint, coalesce(s->>'name', ''), nullif(btrim(coalesce(s->>'label', '')), ''))
    on conflict (owner_id, idx) do update
      set src_name = excluded.src_name, updated_at = now(),
          label = case when s ? 'label' then excluded.label else tt_sheets.label end
    returning id into sid;
    ids := ids || jsonb_build_object(s->>'idx', sid); idxs := idxs || (s->>'idx')::int;
  end loop;
  delete from tt_sheets where owner_id = v_owner and not (idx = any(idxs));
  delete from tt_slots where sheet_id in (select id from tt_sheets where owner_id = v_owner);

  for k, v in select * from jsonb_each_text(coalesce(p->'stages', '{}')) loop
    sid := (ids ->> split_part(k, '|', 1))::int;
    continue when sid is null or split_part(k, '|', 3) !~ '^\d+$';
    insert into tt_stage(sheet_id, track, grade_num, stage) values (sid, split_part(k, '|', 2), split_part(k, '|', 3)::smallint, v)
    on conflict (sheet_id, track, grade_num) do update set stage = excluded.stage;
  end loop;

  -- الحصص: الصفية أولًا (تنشئ المعلمين)، ثم «بدون حصة» والاجتماعات
  for j in 1..2 loop
    for e in select * from jsonb_array_elements(coalesce(p->'entries', '[]')) loop
      continue when (j = 1) <> (e->>'kind' = 'class');
      sid := (ids ->> (e->>'sheet'))::int;
      continue when sid is null or e->>'kind' not in ('class','free','event');
      tid := case when e->>'kind' = 'event' then null else private.tt_teacher(e->>'teacher', e->>'kind' = 'class') end;
      insert into tt_slots(sheet_id, day, period, kind, teacher_id, class_id, subject_id, cls, track, grade_num, section, room, txt)
      values (sid, (e->>'day')::smallint, (e->>'period')::smallint, e->>'kind', tid,
              case when e->>'kind' = 'class' then private.tt_class(sid, e->>'track', nullif(e->>'gradeNum', '')::smallint, e->>'section') end,
              private.tt_subject(e->>'subj'), nullif(e->>'cls', ''), nullif(e->>'track', ''),
              nullif(e->>'gradeNum', '')::smallint, nullif(e->>'section', ''), nullif(e->>'room', ''),
              case when e->>'kind' = 'event' then e->>'text' when tid is null then e->>'teacher' end);
      n := n + 1;
    end loop;
  end loop;

  for k, v in select * from jsonb_each_text(coalesce(p->'subjects', '{}')) loop
    sid := (ids ->> split_part(k, '|', 1))::int;
    tid := private.tt_teacher(substr(k, strpos(k, '|') + 1), false);
    continue when sid is null or tid is null or public.norm(v) is null;
    insert into tt_teacher_subject(sheet_id, teacher_id, subject_id) values (sid, tid, private.tt_subject(v))
    on conflict (sheet_id, teacher_id) do update set subject_id = excluded.subject_id;
  end loop;

  -- الجدول لم يعد يُخزَّن داخل بيانات المشرف
  update supervision_data set data = data #- '{cfg,raw}' #- '{cfg,sheetNames}' #- '{cfg,stages}' #- '{cfg,subjects}' #- '{cfg,schoolMirror}'
   where profile_id = v_owner;
  perform private.tt_refresh();
  return jsonb_build_object('ok', true, 'slots', n);
end $$;

create or replace function public.sv_tt_get(p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := private.sv_role(me); res jsonb;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  if p_all and r not in ('owner','sys') then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;
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

drop function if exists public.sv_tt_meta(jsonb);

-- رفع الجدول: مدير النظام/الإدارة العليا/مدير المرحلة لأي مشرف، ومسؤول نظام الإشراف (للنقل)
create or replace function public.sv_tt_put(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := private.sv_role(me); v_owner uuid := nullif(p->>'owner', '')::uuid;
begin
  if not (public.can_manage_school() or coalesce(r, '') in ('owner','sys')) then
    return jsonb_build_object('ok', false, 'error', 'not_allowed'); end if;
  if v_owner is null then return jsonb_build_object('ok', false, 'error', 'no_owner'); end if;
  if not exists (select 1 from profiles where id = v_owner and role not in ('student','parent')) then
    return jsonb_build_object('ok', false, 'error', 'bad_owner'); end if;
  return private.tt_put(v_owner, p);
end $$;

revoke all on function public.sch_tt_get() from public, anon;
revoke all on function public.sch_times_save(jsonb) from public, anon;
revoke all on function public.sch_tt_meta(jsonb) from public, anon;
revoke all on function private.tt_put(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sch_tt_get() to authenticated;
grant execute on function public.sch_times_save(jsonb) to authenticated;
grant execute on function public.sch_tt_meta(jsonb) to authenticated;
grant execute on function public.can_manage_school() to authenticated;
