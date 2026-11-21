-- =====================================================================
--  الملف 4: سجلات الطلاب من نظام التسجيل (ShereEDU)
--  - الطالب يمكن أن يكون له «صف» بدون «فصل» حتى تُوزَّع الفصول
--  - البيانات الحساسة (الهوية، الميلاد، بريد ولي الأمر...) في جدول منفصل
--    لا يراه إلا مدير النظام والإدارة العليا
-- =====================================================================

-- ---------- تعديلات جدول الطلاب ----------
alter table public.students alter column student_number drop not null;
alter table public.students add column if not exists grade_id int references public.grades(id) on delete set null;
alter table public.students add column if not exists track text;
create index if not exists students_grade_idx on public.students(grade_id);

-- الصف يُضبط تلقائيًا من الفصل عند وجوده
create or replace function public.students_sync_grade() returns trigger
language plpgsql as $$
begin
  if new.class_id is not null then
    select grade_id into new.grade_id from public.classes where id = new.class_id;
  end if;
  return new;
end $$;
drop trigger if exists students_sync_grade on public.students;
create trigger students_sync_grade before insert or update on public.students
  for each row execute function public.students_sync_grade();
update public.students s set grade_id = c.grade_id from public.classes c where c.id = s.class_id;

-- ---------- البيانات الشخصية الحساسة ----------
create table if not exists public.student_private (
  profile_id         uuid primary key references public.students(profile_id) on delete cascade,
  national_id        text unique not null check (btrim(national_id) <> ''),
  agreement_id       text unique,
  first_name         text,
  father_name        text,
  grandfather_name   text,
  family_name        text,
  parent_email       text,
  nationality        text,
  date_of_birth      date,
  source             text,
  source_modified_at timestamptz,
  raw                jsonb,
  updated_at         timestamptz not null default now()
);
alter table public.student_private enable row level security;
drop policy if exists read_student_private on public.student_private;
drop policy if exists admin_student_private on public.student_private;
create policy read_student_private on public.student_private for select to authenticated using (public.is_leader());
create policy admin_student_private on public.student_private for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.student_private to authenticated;
revoke all on public.student_private from anon;

drop trigger if exists audit_student_private on public.student_private;
create trigger audit_student_private after insert or update or delete on public.student_private
  for each row execute function public.audit_trigger();

-- ---------- صلاحية رؤية «صف» كامل (للطلاب الذين لم يُوزَّعوا على فصول بعد) ----------
create or replace function public.can_view_grade(gid int) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null or gid is null then return false; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;
  if r in ('student','parent') then return false; end if;
  return exists (
    select 1 from staff_scopes sc
    join grades g on g.id = gid
    join stages st on st.id = g.stage_id
    where sc.profile_id = me
      and sc.subject_id is null
      and (sc.section_id is null or sc.section_id = st.section_id)
      and (sc.stage_id   is null or sc.stage_id   = st.id)
      and (sc.grade_min  is null or g.number >= sc.grade_min)
      and (sc.grade_max  is null or g.number <= sc.grade_max));
end $$;

create or replace function public.can_view_student(sid uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); r public.user_role; cid int; gid int;
begin
  if me is null or sid is null then return false; end if;
  if sid = me then return true; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return true; end if;
  if r = 'student' then return false; end if;
  if r = 'parent' then
    return exists (select 1 from parent_links where parent_id = me and student_id = sid);
  end if;
  select class_id, grade_id into cid, gid from students where profile_id = sid;
  if cid is not null then return public.can_view_class(cid); end if;
  return public.can_view_grade(gid);
end $$;

-- ---------- عرض الطلاب بأسماء الصفوف ----------
create or replace view public.v_students with (security_invoker = true) as
select s.profile_id, s.student_number, s.class_id, s.grade_id, s.track,
       s.guardian_name, s.guardian_phone, s.notes,
       p.full_name, p.email, p.active,
       g.number as grade_number, g.name_ar as grade_name,
       st.id as stage_id, st.name_ar as stage_name, st.sort as stage_sort,
       se.name_ar as section_name,
       c.name as class_name,
       case when c.id is not null then g.name_ar || ' ' || st.name_ar || ' / ' || c.name
            when g.id is not null then g.name_ar || ' ' || st.name_ar
       end as label
from public.students s
join public.profiles p on p.id = s.profile_id
left join public.grades g on g.id = s.grade_id
left join public.stages st on st.id = g.stage_id
left join public.sections se on se.id = st.section_id
left join public.classes c on c.id = s.class_id;
grant select on public.v_students to authenticated;

-- ---------- الإحصاءات (تحسب الطالب بصفه حتى لو بدون فصل) ----------
create or replace function public.school_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_leader() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'students', (select count(*) from students s join profiles p on p.id = s.profile_id where p.active),
    'teachers', (select count(*) from profiles where role = 'teacher' and active),
    'staff',    (select count(*) from profiles where role not in ('student','parent') and active),
    'classes',  (select count(*) from classes where active),
    'subjects', (select count(*) from subjects where active),
    'assignments', (select count(*) from teaching_assignments),
    'no_class', (select count(*) from students s join profiles p on p.id = s.profile_id where p.active and s.class_id is null),
    'no_email', (select count(*) from profiles where email is null and active and role <> 'student'),
    'students_no_email', (select count(*) from profiles where email is null and active and role = 'student'),
    'by_section', coalesce((
      select jsonb_agg(jsonb_build_object('section', x.name_ar, 'students', x.n, 'classes', x.c) order by x.sort)
      from (select se.name_ar, se.sort,
                   (select count(*) from students s join profiles p on p.id = s.profile_id
                      join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
                    where st.section_id = se.id and p.active) n,
                   (select count(*) from classes c join grades g on g.id = c.grade_id join stages st on st.id = g.stage_id
                    where st.section_id = se.id and c.active) c
            from sections se) x), '[]'::jsonb),
    'by_stage', coalesce((
      select jsonb_agg(jsonb_build_object('stage', st.name_ar, 'students',
             (select count(*) from students s join profiles p on p.id = s.profile_id
                join grades g on g.id = s.grade_id where g.stage_id = st.id and p.active)) order by st.sort)
      from stages st), '[]'::jsonb));
end $$;

-- ---------- تحويل اسم الصف في نظام التسجيل إلى صف المنصة ----------
-- أمثلة: "Dar Grade 7 - Ethraa Plus" ← متوسط بنين/الأول ، "Dar Grade 3 - Girls" ← ابتدائي بنات/الثالث
create or replace function public._grade_from_sis(t text, out gid int, out track text)
language plpgsql stable security definer set search_path = public as $$
declare m text[]; n int; k text; scode text; num int;
begin
  m := regexp_match(coalesce(t,''), 'grade\s*(\d{1,2})\s*-\s*(.+)$', 'i');
  if m is null then raise exception 'صف غير معروف: "%"', coalesce(t,''); end if;
  n := m[1]::int; track := btrim(m[2]); k := lower(track);
  if k like '%girl%' then
    scode := 'girls-primary'; num := n;
  elsif k like '%diploma%' or k like '%american%' then
    scode := 'american'; num := n;
  else -- المسار الوطني بنين (Ethraa Plus وغيره)
    if n between 1 and 6 then scode := 'boys-primary'; num := n;
    elsif n between 7 and 9 then scode := 'boys-intermediate'; num := n - 6;
    elsif n between 10 and 12 then scode := 'boys-secondary'; num := n - 9;
    end if;
  end if;
  select g.id into gid from grades g join stages st on st.id = g.stage_id
  where st.code = scode and g.number = num;
  if gid is null then raise exception 'الصف "%" غير موجود في المنصة', t; end if;
end $$;

-- ---------- استيراد الطلاب من نظام التسجيل ----------
-- المفتاح: رقم الهوية/الإقامة. الحقول: national_id*, full_name*, grade*, agreement_id, first_name,
-- father_name, grandfather_name, family_name, parent_email, nationality, date_of_birth, modified_on, raw
drop function if exists public.import_students_sis(jsonb, boolean, boolean);
create or replace function public.import_students_sis(rows jsonb, dry_run boolean default true,
                                                      deactivate_missing boolean default false,
                                                      keep_ids text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; ins int := 0; upd int := 0; moved int := 0; deact int := 0;
  errs jsonb := '[]'::jsonb; v_id text; v_name text; v_dob date; v_mod timestamptz;
  pid uuid; g record; old_grade int; seen text[] := '{}';
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;
  begin
    for r in select * from jsonb_array_elements(rows) loop
      i := i + 1;
      begin
        v_id   := regexp_replace(translate(coalesce(r->>'national_id',''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\s', '', 'g');
        v_name := regexp_replace(btrim(coalesce(r->>'full_name','')), '\s+', ' ', 'g');
        if v_id = '' then raise exception 'رقم الهوية/الإقامة مطلوب'; end if;
        if v_name = '' then
          v_name := regexp_replace(btrim(concat_ws(' ', r->>'first_name', r->>'father_name',
                                                   r->>'grandfather_name', r->>'family_name')), '\s+', ' ', 'g');
        end if;
        if v_name = '' then raise exception 'اسم الطالب مطلوب'; end if;
        select * into g from public._grade_from_sis(r->>'grade');
        v_dob := nullif(btrim(coalesce(r->>'date_of_birth','')), '')::date;
        v_mod := nullif(btrim(coalesce(r->>'modified_on','')), '')::timestamptz;
        seen := seen || v_id;

        select profile_id into pid from student_private where national_id = v_id;
        if pid is null then
          insert into profiles(full_name, role) values (v_name, 'student') returning id into pid;
          insert into students(profile_id, grade_id, track, guardian_name)
          values (pid, g.gid, g.track,
                  nullif(btrim(concat_ws(' ', btrim(r->>'father_name'), btrim(r->>'family_name'))), ''));
          insert into student_private(profile_id, national_id) values (pid, v_id);
          ins := ins + 1;
        else
          update profiles set full_name = v_name, active = true where id = pid;
          select grade_id into old_grade from students where profile_id = pid;
          if old_grade is distinct from g.gid then
            -- تغيّر الصف (ترفيع/تصحيح): يُلغى الفصل القديم لأنه من صف آخر
            update students set class_id = null, grade_id = g.gid, track = g.track where profile_id = pid;
            moved := moved + 1;
          else
            update students set track = g.track where profile_id = pid;
          end if;
          upd := upd + 1;
        end if;

        update student_private set
          agreement_id       = coalesce(nullif(btrim(r->>'agreement_id'),''), agreement_id),
          first_name         = nullif(btrim(r->>'first_name'),''),
          father_name        = nullif(btrim(r->>'father_name'),''),
          grandfather_name   = nullif(btrim(r->>'grandfather_name'),''),
          family_name        = nullif(btrim(r->>'family_name'),''),
          parent_email       = nullif(lower(btrim(r->>'parent_email')),''),
          nationality        = nullif(btrim(r->>'nationality'),''),
          date_of_birth      = v_dob,
          source             = 'ShereEDU',
          source_modified_at = v_mod,
          raw                = r->'raw',
          updated_at         = now()
        where profile_id = pid;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'msg', sqlerrm);
      end;
    end loop;

    -- إيقاف الطلاب غير الموجودين في الملف (منسحبون) — اختياري
    if deactivate_missing then
      update profiles p set active = false
      from student_private sp
      where sp.profile_id = p.id and sp.source = 'ShereEDU' and p.active
        and not (sp.national_id = any(coalesce(keep_ids, seen)));
      get diagnostics deact = row_count;
    end if;

    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('total', i, 'inserted', ins, 'updated', upd, 'grade_changed', moved,
                            'deactivated', deact, 'errors', errs, 'dry_run', dry_run);
end $$;

revoke execute on function public._grade_from_sis(text) from public, anon, authenticated;
revoke execute on function public.import_students_sis(jsonb, boolean, boolean, text[]) from public, anon;
grant execute on function public.import_students_sis(jsonb, boolean, boolean, text[]) to authenticated;
grant execute on function public.can_view_grade(int) to authenticated;
revoke execute on function public.can_view_grade(int) from public, anon;
