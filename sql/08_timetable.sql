-- =====================================================================
--  الملف 8: جدول الحصص جزء من قاعدة بيانات المنصة (مصدر واحد للبيانات)
--  - كل حصة صف في جدول tt_slots مرتبط مباشرة بالمعلم (profiles) والفصل (classes) والمادة (subjects).
--  - مكتب الإشراف التربوي تقرأ الجدول وتكتبه من هنا مباشرة (لا يُخزَّن الجدول داخل بيانات المشرف).
--  - إسناد المعلمين (teaching_assignments) مشتق تلقائيًا من الجدول داخل قاعدة البيانات.
--  - يلغي أسلوب «المزامنة» في الملف 7.
-- =====================================================================

drop function if exists public.sv_sync_teachers(jsonb, boolean);
drop table if exists public.teacher_supervisors;

-- أوراق الجدول (لكل مشرف ورقة أو أكثر من ملف Excel)
create table if not exists public.tt_sheets (
  id         serial primary key,
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  idx        smallint not null,
  src_name   text not null default '',
  label      text,
  updated_at timestamptz not null default now(),
  unique (owner_id, idx)
);

-- الحصص
create table if not exists public.tt_slots (
  id         bigserial primary key,
  sheet_id   int not null references public.tt_sheets(id) on delete cascade,
  day        smallint not null check (day between 0 and 6),
  period     smallint not null check (period between 0 and 30),
  kind       text not null check (kind in ('class','free','event')),
  teacher_id uuid references public.profiles(id) on delete cascade,
  class_id   int references public.classes(id) on delete set null,
  subject_id int references public.subjects(id) on delete set null,  -- مادة مكتوبة في خلية الحصة نفسها
  cls        text,          -- اسم الفصل كما في الجدول (مثل 4-أ / 10A)
  track      text,          -- arabic / american
  grade_num  smallint,
  section    text,
  room       text,
  txt        text           -- نص الاجتماع، أو اسم غير معروف في خانة «بدون حصة»
);
create index if not exists tt_slots_sheet   on public.tt_slots(sheet_id);
create index if not exists tt_slots_teacher on public.tt_slots(teacher_id);
create index if not exists tt_slots_class   on public.tt_slots(class_id);

-- مادة المعلم الافتراضية في ورقة (عندما لا تُكتب المادة داخل الخلية)
create table if not exists public.tt_teacher_subject (
  sheet_id   int  not null references public.tt_sheets(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  subject_id int  not null references public.subjects(id) on delete cascade,
  primary key (sheet_id, teacher_id)
);

-- مرحلة كل صف في ورقة
create table if not exists public.tt_stage (
  sheet_id  int not null references public.tt_sheets(id) on delete cascade,
  track     text not null,
  grade_num smallint not null,
  stage     text not null,
  primary key (sheet_id, track, grade_num)
);

-- أسماء المعلم كما تُكتب في الجداول (حتى لو تغيّر اسمه في المنصة يبقى مربوطًا بنفس الحساب)
create table if not exists public.staff_aliases (
  alias      text primary key,          -- norm(الاسم)
  profile_id uuid not null references public.profiles(id) on delete cascade
);

alter table public.tt_sheets          enable row level security;
alter table public.tt_slots           enable row level security;
alter table public.tt_teacher_subject enable row level security;
alter table public.tt_stage           enable row level security;
alter table public.staff_aliases      enable row level security;
do $$ declare t text; begin
  foreach t in array array['tt_sheets','tt_slots','tt_teacher_subject','tt_stage'] loop
    execute format('drop policy if exists %I on public.%I', t||'_read', t);
    execute format('create policy %I on public.%I for select using (public.is_staff())', t||'_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
drop policy if exists staff_aliases_admin on public.staff_aliases;
create policy staff_aliases_admin on public.staff_aliases for all using (public.is_admin()) with check (public.is_admin());
grant select on public.staff_aliases to authenticated;

-- عرض موحّد للجدول (المادة الفعلية = مادة الخلية أو مادة المعلم الافتراضية)
create or replace view public.v_timetable with (security_invoker = on) as
select sl.id, sh.owner_id as supervisor_id, sh.idx as sheet_idx, coalesce(sh.label, sh.src_name) as sheet_label,
       sl.day, sl.period, sl.kind, sl.teacher_id, sl.class_id,
       coalesce(sl.subject_id, ts.subject_id) as subject_id, sl.cls, sl.room, sl.txt
from public.tt_slots sl
join public.tt_sheets sh on sh.id = sl.sheet_id
left join public.tt_teacher_subject ts on ts.sheet_id = sl.sheet_id and ts.teacher_id = sl.teacher_id;
grant select on public.v_timetable to authenticated;

-- المعلم ↔ مشرفه (من الجدول مباشرة)
create or replace view public.v_teacher_supervisors with (security_invoker = on) as
select distinct sl.teacher_id, sh.owner_id as supervisor_id
from public.tt_slots sl join public.tt_sheets sh on sh.id = sl.sheet_id
where sl.teacher_id is not null;
grant select on public.v_teacher_supervisors to authenticated;

-- ---------- دوال داخلية ----------
create or replace function private.tt_subject(p text) returns int
language plpgsql security definer set search_path = public as $$
declare sid int;
begin
  if public.norm(p) is null then return null; end if;
  select id into sid from subjects where public.norm(name_ar) = public.norm(p) order by id limit 1;
  if sid is null then insert into subjects(name_ar) values (regexp_replace(btrim(p), '\s+', ' ', 'g')) returning id into sid; end if;
  return sid;
end $$;

-- إيجاد المعلم بالاسم (أو إنشاؤه إن طُلب)
create or replace function private.tt_teacher(p text, p_create boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(btrim(coalesce(p, '')), '\s+', ' ', 'g'); n text := public.norm(v); pid uuid;
begin
  if n is null then return null; end if;
  select profile_id into pid from staff_aliases where alias = n;
  if pid is null then
    select id into pid from profiles
     where role not in ('student','parent') and public.norm(full_name) = n
     order by (email is not null) desc, created_at limit 1;
  end if;
  if pid is null and p_create then
    insert into profiles(email, full_name, role, job_title, source)
    values (null, v, 'teacher', 'معلم', 'timetable') returning id into pid;
  end if;
  if pid is not null then
    insert into staff_aliases(alias, profile_id) values (n, pid) on conflict (alias) do nothing;
  end if;
  return pid;
end $$;

create or replace function private.tt_stage_of(p_sheet int, p_track text, g smallint) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select stage from tt_stage where sheet_id = p_sheet and track = coalesce(p_track, 'arabic') and grade_num = g),
    case when p_track = 'american' then 'المسار الأمريكي' when g between 4 and 6 then 'ابتدائي' else 'غير محدد' end)
$$;

-- الفصل في المنصة لحصة في الجدول (يُنشأ الفصل إن لم يوجد)
create or replace function private.tt_class(p_sheet int, p_track text, g smallint, p_sec text) returns int
language plpgsql security definer set search_path = public as $$
declare st text; code text; n int; girls boolean; sec text := btrim(regexp_replace(coalesce(p_sec, ''), '^-+', '')); c record;
begin
  if g is null or sec = '' then return null; end if;
  st := private.tt_stage_of(p_sheet, p_track, g);
  select (coalesce(label, '') || ' ' || src_name) ~ 'بنات' into girls from tt_sheets where id = p_sheet;
  if p_track = 'american' or st = 'المسار الأمريكي' then
    if g not between 4 and 12 then return null; end if; code := 'american'; n := g;
  elsif st = 'ابتدائي' then
    if g not between 1 and 6 then return null; end if;
    code := case when girls then 'girls-primary' else 'boys-primary' end; n := g;
  elsif st = 'متوسط' then code := 'boys-intermediate'; n := case when g >= 7 then g - 6 else g end;
  elsif st = 'ثانوي' then code := 'boys-secondary';    n := case when g >= 10 then g - 9 else g end;
  elsif g between 7 and 9 then code := 'boys-intermediate'; n := g - 6;
  elsif g between 10 and 12 then code := 'boys-secondary'; n := g - 9;
  else return null; end if;
  if code in ('boys-intermediate','boys-secondary') and n not between 1 and 3 then return null; end if;
  select * into c from public._get_class(code, n::text, sec, true);
  return c.cid;
exception when others then return null;
end $$;

-- الإسناد مشتق من الجدول + حالة معلمي الجدول (نشط إن كان له حصص)
create or replace function private.tt_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from teaching_assignments where source = 'timetable';
  insert into teaching_assignments(teacher_id, class_id, subject_id, weekly_periods, source)
  select sl.teacher_id, sl.class_id, coalesce(sl.subject_id, ts.subject_id), least(count(*), 99), 'timetable'
  from tt_slots sl left join tt_teacher_subject ts on ts.sheet_id = sl.sheet_id and ts.teacher_id = sl.teacher_id
  where sl.kind = 'class' and sl.teacher_id is not null and sl.class_id is not null
    and coalesce(sl.subject_id, ts.subject_id) is not null
  group by 1, 2, 3
  on conflict (teacher_id, class_id, subject_id) do nothing;
  update profiles p set active = x.has
  from (select pr.id, exists (select 1 from tt_slots s where s.teacher_id = pr.id) has
        from profiles pr where pr.source = 'timetable' and pr.email is null) x
  where p.id = x.id and p.active <> x.has;
end $$;

-- ---------- قراءة الجدول ----------
-- p_all = جدول المدرسة كله (لمسؤول النظام)؛ وإلا جدول المشرف نفسه بأرقام أوراقه الأصلية
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
                       from tt_stage st join sh on sh.id = st.sheet_id), '{}'::jsonb))
  into res;
  return res;
end $$;

-- ---------- رفع الجدول (يستبدل جدول المشرف كله) ----------
-- p = { owner?: uuid (لمسؤول النظام فقط), sheets:[{idx,name,label?}],
--       entries:[{sheet,day,period,kind,teacher,cls,track,gradeNum,section,subj,room,text}],
--       stages?: {"idx|track|grade": stage}, subjects?: {"idx|teacher": subject} }
create or replace function public.sv_tt_put(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := public.me_id(); r text := private.sv_role(me); v_owner uuid; s jsonb; e jsonb; k text; v text;
  sid int; ids jsonb := '{}'::jsonb; idxs int[] := '{}'; tid uuid; n int := 0; j int;
begin
  if r is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  v_owner := coalesce(nullif(p->>'owner', '')::uuid, me);
  if v_owner <> me and r not in ('owner','sys') then return jsonb_build_object('ok', false, 'error', 'not_sys'); end if;

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

-- ---------- تعديلات من صفحة الإعدادات ----------
-- p = {action:'label', idx, value} | {action:'subject', idx, teacher, value} | {action:'stage', idx, track, grade, value}
create or replace function public.sv_tt_meta(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); sid int; tid uuid; act text := p->>'action'; val text := btrim(coalesce(p->>'value', ''));
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  select id into sid from tt_sheets where owner_id = me and idx = (p->>'idx')::smallint;
  if sid is null then return jsonb_build_object('ok', false, 'error', 'no_sheet'); end if;
  if act = 'label' then
    update tt_sheets set label = nullif(val, ''), updated_at = now() where id = sid;
  elsif act = 'subject' then
    tid := private.tt_teacher(p->>'teacher', false);
    if tid is null then return jsonb_build_object('ok', false, 'error', 'no_teacher'); end if;
    if val = '' then delete from tt_teacher_subject where sheet_id = sid and teacher_id = tid;
    else insert into tt_teacher_subject(sheet_id, teacher_id, subject_id) values (sid, tid, private.tt_subject(val))
         on conflict (sheet_id, teacher_id) do update set subject_id = excluded.subject_id; end if;
    perform private.tt_refresh();
  elsif act = 'stage' then
    insert into tt_stage(sheet_id, track, grade_num, stage) values (sid, p->>'track', (p->>'grade')::smallint, val)
    on conflict (sheet_id, track, grade_num) do update set stage = excluded.stage;
    update tt_slots set class_id = private.tt_class(sheet_id, track, grade_num, section)
     where sheet_id = sid and kind = 'class' and coalesce(track, 'arabic') = p->>'track' and grade_num = (p->>'grade')::smallint;
    perform private.tt_refresh();
  else return jsonb_build_object('ok', false, 'error', 'bad_action');
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.sv_tt_get(boolean) from public, anon;
revoke all on function public.sv_tt_put(jsonb)   from public, anon;
revoke all on function public.sv_tt_meta(jsonb)  from public, anon;
grant execute on function public.sv_tt_get(boolean) to authenticated;
grant execute on function public.sv_tt_put(jsonb)   to authenticated;
grant execute on function public.sv_tt_meta(jsonb)  to authenticated;

-- حفظ بيانات المشرف: الجدول لا يُخزَّن هنا (مكانه tt_*)
create or replace function public.sv_save(p_data jsonb, p_stamp bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if private.sv_role(me) is null then return jsonb_build_object('ok', false, 'error', 'not_member'); end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then return jsonb_build_object('ok', false, 'error', 'bad_data'); end if;
  p_data := p_data #- '{cfg,raw}' #- '{cfg,sheetNames}' #- '{cfg,stages}' #- '{cfg,subjects}' #- '{cfg,schoolMirror}';
  insert into supervision_data(profile_id, data, stamp, updated_at) values (me, p_data, coalesce(p_stamp, 0), now())
  on conflict (profile_id) do update set data = excluded.data, stamp = excluded.stamp, updated_at = now();
  return jsonb_build_object('ok', true, 'stamp', coalesce(p_stamp, 0));
end $$;

-- ربط البريد عند استيراد الموظفين: بالاسم أو بأي اسم ظهر به المعلم في الجداول
create or replace function public._claim_timetable_profile(p_email text, p_name text) returns void
language sql security definer set search_path = public as $$
  update profiles set email = p_email
   where id = coalesce(
           (select a.profile_id from staff_aliases a join profiles x on x.id = a.profile_id
             where a.alias = public.norm(p_name) and x.email is null limit 1),
           (select id from profiles where email is null and source = 'timetable'
             and public.norm(full_name) = public.norm(p_name) limit 1))
     and not exists (select 1 from profiles where email = p_email);
$$;

-- أسماء المعلمين الحاليين كأسماء بديلة (حتى يُربط الجدول بهم)
insert into public.staff_aliases(alias, profile_id)
select distinct on (public.norm(full_name)) public.norm(full_name), id from public.profiles
where role not in ('student','parent') and public.norm(full_name) is not null
order by public.norm(full_name), (email is not null) desc, created_at
on conflict (alias) do nothing;
