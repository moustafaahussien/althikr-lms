-- =====================================================================
--  منصة دار الذكر التعليمية (LMS) — المرحلة الأولى: الأساس الموحّد
--  الملف 1 من 3: الجداول والدوال الأساسية
--  يُشغَّل مرة واحدة في Supabase → SQL Editor
-- =====================================================================

-- ---------- الأدوار ----------
do $$ begin
  create type public.user_role as enum
    ('admin','leadership','principal','supervisor','teacher','staff','student','parent');
exception when duplicate_object then null; end $$;

-- ---------- إعدادات عامة ----------
create table if not exists public.app_settings (
  key   text primary key,
  value jsonb not null
);
insert into public.app_settings(key, value) values
  ('allowed_domains', '["althikr.edu.sa"]'::jsonb),
  ('school_name',     '"مدارس دار الذكر"'::jsonb)
on conflict (key) do nothing;

-- ---------- الهيكل المدرسي ----------
create table if not exists public.sections (           -- القسم: بنين / بنات / الدبلوم الأمريكي
  id      smallint primary key,
  code    text unique not null,
  name_ar text not null,
  name_en text,
  sort    int default 0
);

create table if not exists public.stages (             -- المرحلة
  id         serial primary key,
  section_id smallint not null references public.sections(id),
  code       text unique not null,
  name_ar    text unique not null,
  sort       int default 0
);

create table if not exists public.grades (             -- الصف
  id       serial primary key,
  stage_id int not null references public.stages(id) on delete cascade,
  number   smallint not null,
  name_ar  text not null,
  unique (stage_id, number)
);

create table if not exists public.academic_years (
  id         serial primary key,
  name       text unique not null,
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false
);
create unique index if not exists one_current_year on public.academic_years(is_current) where is_current;

create table if not exists public.terms (
  id         serial primary key,
  year_id    int not null references public.academic_years(id) on delete cascade,
  name       text not null,
  starts_on  date,
  ends_on    date,
  is_current boolean not null default false,
  unique (year_id, name)
);
create unique index if not exists one_current_term on public.terms(is_current) where is_current;

create table if not exists public.subjects (           -- المواد
  id      serial primary key,
  name_ar text unique not null,
  name_en text,
  code    text unique,
  active  boolean not null default true
);

-- ---------- المستخدمون ----------
create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  email      text unique check (email is null or email = lower(btrim(email))),
  full_name  text not null check (btrim(full_name) <> ''),
  role       public.user_role not null,
  job_title  text,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_role_idx on public.profiles(role);

create table if not exists public.classes (            -- الفصل / الشعبة
  id                  serial primary key,
  grade_id            int not null references public.grades(id) on delete restrict,
  name                text not null check (btrim(name) <> ''),
  homeroom_teacher_id uuid references public.profiles(id) on delete set null,
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (grade_id, name)
);

create table if not exists public.students (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  student_number text unique not null check (btrim(student_number) <> ''),
  class_id       int references public.classes(id) on delete restrict,
  guardian_name  text,
  guardian_phone text,
  notes          text
);
create index if not exists students_class_idx on public.students(class_id);

-- نطاق صلاحية القيادات والمشرفين (null = الكل داخل هذا البُعد)
create table if not exists public.staff_scopes (
  id         serial primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  section_id smallint references public.sections(id) on delete cascade,
  stage_id   int references public.stages(id) on delete cascade,
  grade_min  smallint,
  grade_max  smallint,
  subject_id int references public.subjects(id) on delete cascade,
  note       text
);
create index if not exists staff_scopes_profile_idx on public.staff_scopes(profile_id);

-- إسناد المعلم: معلم × فصل × مادة
create table if not exists public.teaching_assignments (
  id             serial primary key,
  teacher_id     uuid not null references public.profiles(id) on delete cascade,
  class_id       int  not null references public.classes(id) on delete cascade,
  subject_id     int  not null references public.subjects(id) on delete cascade,
  weekly_periods smallint,
  unique (teacher_id, class_id, subject_id)
);
create index if not exists ta_class_idx   on public.teaching_assignments(class_id);
create index if not exists ta_subject_idx on public.teaching_assignments(subject_id);

create table if not exists public.parent_links (
  parent_id  uuid not null references public.profiles(id) on delete cascade,
  student_id uuid not null references public.students(profile_id) on delete cascade,
  relation   text,
  primary key (parent_id, student_id)
);

create table if not exists public.audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text,
  table_name text not null,
  action     text not null,
  row_pk     text,
  old_data   jsonb,
  new_data   jsonb
);
create index if not exists audit_at_idx on public.audit_log(at desc);

-- =====================================================================
--  دوال مساعدة
-- =====================================================================

-- توحيد النص العربي للمطابقة (همزات، تاء مربوطة، ياء، أرقام عربية، مسافات)
create or replace function public.norm(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(
           translate(lower(btrim(coalesce(t,''))),
                     'أإآٱةى٠١٢٣٤٥٦٧٨٩ـ',
                     'ااااهي0123456789'),
           '\s+', ' ', 'g'), '')
$$;

create or replace function public.jwt_email() returns text
language sql stable as $$
  select lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
$$;

create or replace function public.email_domain_ok(e text) returns boolean
language sql stable security definer set search_path = public as $$
  select e is not null and e like '%@%' and exists (
    select 1 from app_settings s, jsonb_array_elements_text(s.value) d
    where s.key = 'allowed_domains' and split_part(lower(e), '@', 2) = lower(d))
$$;

-- معرّف المستخدم الحالي (من بريده الموثّق في Google) — null لو غير مسجّل أو موقوف
create or replace function public.me_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.email = public.jwt_email() and p.active and public.email_domain_ok(p.email)
$$;

create or replace function public.me_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select p.role from profiles p where p.id = public.me_id()
$$;

create or replace function public.is_admin() returns boolean
language sql stable as $$ select coalesce(public.me_role() = 'admin', false) $$;

create or replace function public.is_leader() returns boolean
language sql stable as $$ select coalesce(public.me_role() in ('admin','leadership'), false) $$;

create or replace function public.is_staff() returns boolean
language sql stable as $$ select coalesce(public.me_role() not in ('student','parent'), false) $$;

-- هل يحق للمستخدم الحالي رؤية فصل معيّن؟
create or replace function public.can_view_class(cid int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null or cid is null then return false; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;

  if r = 'student' then
    return exists (select 1 from students where profile_id = me and class_id = cid);
  end if;
  if r = 'parent' then
    return exists (select 1 from parent_links pl join students s on s.profile_id = pl.student_id
                   where pl.parent_id = me and s.class_id = cid);
  end if;

  -- موظفون: إسناد مباشر / رائد فصل / نطاق إشرافي
  return exists (select 1 from teaching_assignments where teacher_id = me and class_id = cid)
      or exists (select 1 from classes where id = cid and homeroom_teacher_id = me)
      or exists (
        select 1
        from staff_scopes sc
        join classes c  on c.id = cid
        join grades  g  on g.id = c.grade_id
        join stages  st on st.id = g.stage_id
        where sc.profile_id = me
          and (sc.section_id is null or sc.section_id = st.section_id)
          and (sc.stage_id   is null or sc.stage_id   = st.id)
          and (sc.grade_min  is null or g.number >= sc.grade_min)
          and (sc.grade_max  is null or g.number <= sc.grade_max)
          and (sc.subject_id is null or exists (
                select 1 from teaching_assignments ta
                where ta.class_id = cid and ta.subject_id = sc.subject_id)));
end $$;

-- هل يحق للمستخدم الحالي رؤية بيانات طالب (بما فيها جوال ولي الأمر)؟
create or replace function public.can_view_student(sid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role; cid int;
begin
  if me is null or sid is null then return false; end if;
  if sid = me then return true; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;
  if r = 'student' then return false; end if;
  if r = 'parent' then
    return exists (select 1 from parent_links where parent_id = me and student_id = sid);
  end if;
  select class_id into cid from students where profile_id = sid;
  return public.can_view_class(cid);
end $$;

-- هل يحق رؤية الاسم الأساسي لمستخدم (profiles)؟
create or replace function public.can_view_profile(pid uuid, prole public.user_role) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null then return false; end if;
  if pid = me then return true; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;
  -- أسماء الموظفين ومسمياتهم متاحة لكل المسجّلين
  if prole not in ('student','parent') then return true; end if;
  if prole = 'student' then
    if public.can_view_student(pid) then return true; end if;
    -- الطالب يرى أسماء زملاء فصله فقط
    return r = 'student' and exists (
      select 1 from students a join students b on a.class_id = b.class_id
      where a.profile_id = me and b.profile_id = pid);
  end if;
  -- ولي الأمر: يراه الموظف الذي يرى أحد أبنائه
  return r not in ('student','parent') and exists (
    select 1 from parent_links pl where pl.parent_id = pid and public.can_view_student(pl.student_id));
end $$;

-- ---------- updated_at ----------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ---------- سجل التغييرات ----------
create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  insert into audit_log(actor, table_name, action, row_pk, old_data, new_data)
  values (nullif(public.jwt_email(), ''), tg_table_name, tg_op,
          coalesce(n->>'id', n->>'profile_id', o->>'id', o->>'profile_id'), o, n);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['profiles','students','classes','subjects','teaching_assignments',
                           'staff_scopes','parent_links','academic_years','terms','app_settings']
  loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s
                    for each row execute function public.audit_trigger()', t);
  end loop;
end $$;

-- ---------- عرض مساعد: الفصول بأسمائها الكاملة ----------
create or replace view public.v_classes with (security_invoker = true) as
select c.id, c.name, c.active, c.homeroom_teacher_id,
       g.id as grade_id, g.number as grade_number, g.name_ar as grade_name,
       st.id as stage_id, st.name_ar as stage_name, st.sort as stage_sort,
       se.id as section_id, se.name_ar as section_name,
       (g.name_ar || ' ' || st.name_ar || ' / ' || c.name) as label,
       (select count(*) from public.students s where s.class_id = c.id) as student_count
from public.classes c
join public.grades g    on g.id = c.grade_id
join public.stages st   on st.id = g.stage_id
join public.sections se on se.id = st.section_id;
