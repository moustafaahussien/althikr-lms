-- =====================================================================
-- 26) دخول ولي الأمر عبر حساب ابنه + رمز سري خاص بولي الأمر (مجاني بالكامل)
--   • ولي الأمر = رقم الجوال المسجّل للطالب في المدرسة (جدول guardians)
--   • أول مرة: الإدارة تصدر «رمز تفعيل» وترسله على واتساب ولي الأمر (زر واحد يفتح واتساب برسالة جاهزة)
--   • ولي الأمر يدخل بحساب ابنه ← «دخول ولي الأمر» ← يكتب رمز التفعيل ويختار رمزه السري (6 أرقام)
--   • بعد ذلك يكفي الرمز السري. لا شيء يُحفظ على جهاز الطالب: الجلسة في الذاكرة فقط وتنتهي بعد 30 دقيقة
--   • 5 محاولات خاطئة ← يُقفل الرمز السري ويحتاج رمز تفعيل جديد
-- =====================================================================

create table if not exists public.guardians (
  id          uuid primary key default gen_random_uuid(),
  phone       text unique not null check (phone ~ '^9665[0-9]{8}$'),     -- 9665XXXXXXXX
  name        text,
  pin_hash    text,
  pin_set_at  timestamptz,
  fails       int not null default 0,
  locked      boolean not null default false,
  last_login  timestamptz,
  created_at  timestamptz not null default now()
);
create table if not exists public.guardian_students (
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  student_id  uuid not null references public.students(profile_id) on delete cascade,
  primary key (guardian_id, student_id)
);
create index if not exists guardian_students_student on public.guardian_students(student_id);
create table if not exists public.guardian_codes (
  id          bigserial primary key,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create table if not exists public.guardian_sessions (
  token_hash  text primary key,
  guardian_id uuid not null references public.guardians(id) on delete cascade,
  student_id  uuid not null,                 -- حساب الطالب الذي دخل منه
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
insert into public.app_settings(key, value) values ('gd_salt', to_jsonb(gen_random_uuid()::text)) on conflict (key) do nothing;

do $$ declare t text; begin
  foreach t in array array['guardians','guardian_students','guardian_codes','guardian_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to service_role;

-- ---------------------------------------------------------------------
create schema if not exists private;
create or replace function private.gd_phone(p text) returns text
language sql immutable as $$
  select case when d ~ '^9665[0-9]{8}$' then d when d ~ '^05[0-9]{8}$' then '966' || substr(d, 2)
              when d ~ '^5[0-9]{8}$' then '966' || d when d ~ '^009665[0-9]{8}$' then substr(d, 3) end
  from (select regexp_replace(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g') d) x
$$;
create or replace function private.gd_hash(v text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to((select value #>> '{}' from app_settings where key = 'gd_salt') || '|' || v, 'UTF8')), 'hex')
$$;
create or replace function private.gd_can_manage() returns boolean
language sql stable as $$ select coalesce(public.me_role()::text in ('admin','leadership','principal'), false) $$;
-- حساب الطالب الحالي (حتى لو كان دخول الطلاب مقفولًا: هذا المسار لولي الأمر فقط)
create or replace function private.gd_login_student() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p join students s on s.profile_id = p.id
  where p.email = public.jwt_email() and p.active and p.role = 'student' and public.email_domain_ok(p.email)
$$;
create or replace function private.gd_mask(p text) returns text
language sql immutable as $$ select '05•••••' || right(p, 3) $$;

-- ملخص الطالب (بدون فحص صلاحية — يُستدعى بعد التحقق)
create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s students; f date := current_date - 60;
begin
  select * into s from students where profile_id = p_student;
  if s.profile_id is null then return null; end if;
  return jsonb_build_object(
    'id', s.profile_id, 'name', (select full_name from profiles where id = s.profile_id),
    'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id),
    'class', (select name from classes where id = s.class_id),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('name', p.full_name, 'subject', sb.name_ar))
                 from teaching_assignments ta join classes c on c.id = ta.class_id join profiles p on p.id = ta.teacher_id and p.active
                 join subjects sb on sb.id = ta.subject_id
                 where (s.class_id is not null and ta.class_id = s.class_id) or (s.class_id is null and c.grade_id = s.grade_id)), '[]'::jsonb),
    'attendance', jsonb_build_object(
      'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = s.grade_id and a.period = 0
                      and (a.class_id is null or a.class_id = s.class_id) and a.day >= f),
      'absent',  (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'absent'),
      'late',    (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'late'),
      'excused', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'excused'),
      'recent',  coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.day >= f), '[]'::jsonb)));
end $$;

-- ================= الإدارة (مدير النظام والقيادات ومديرو المراحل) =================
-- استيراد جوالات أولياء الأمور: rows = [{key: رقم الطالب أو الهوية, phone, name}]
create or replace function public.gd_import(p_rows jsonb, p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; sid uuid; ph text; gid uuid; n_ok int := 0; n_bad int := 0; n_nost int := 0; n_new int := 0; bad jsonb := '[]'::jsonb;
begin
  if not private.gd_can_manage() then raise exception 'غير مصرح'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    ph := private.gd_phone(r->>'phone');
    select s.profile_id into sid from students s left join student_private sp on sp.profile_id = s.profile_id
      where s.student_number = btrim(r->>'key') or sp.national_id = btrim(r->>'key') or sp.agreement_id = btrim(r->>'key') limit 1;
    if sid is null then n_nost := n_nost + 1; if jsonb_array_length(bad) < 20 then bad := bad || jsonb_build_array(r->>'key'); end if; continue; end if;
    if ph is null then n_bad := n_bad + 1; continue; end if;
    n_ok := n_ok + 1;
    if p_apply then
      select id into gid from guardians where phone = ph;
      if gid is null then insert into guardians(phone, name) values (ph, nullif(btrim(r->>'name'), '')) returning id into gid; n_new := n_new + 1;
      elsif coalesce(btrim(r->>'name'), '') <> '' then update guardians set name = coalesce(name, btrim(r->>'name')) where id = gid; end if;
      insert into guardian_students values (gid, sid) on conflict do nothing;
      update students set guardian_phone = ph, guardian_name = coalesce(nullif(btrim(r->>'name'), ''), guardian_name) where profile_id = sid;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'applied', p_apply, 'matched', n_ok, 'bad_phone', n_bad, 'no_student', n_nost, 'unknown_keys', bad,
    'new_guardians', n_new, 'guardians', (select count(*) from guardians), 'linked_students', (select count(distinct student_id) from guardian_students));
end $$;

-- إضافة/تعديل جوال ولي أمر لطالب واحد
create or replace function public.gd_set_phone(p_student uuid, p_phone text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare ph text := private.gd_phone(p_phone); gid uuid;
begin
  if not private.gd_can_manage() then raise exception 'غير مصرح'; end if;
  if ph is null then raise exception 'رقم الجوال غير صحيح — اكتبه بالصيغة 05XXXXXXXX'; end if;
  if not exists (select 1 from students where profile_id = p_student) then raise exception 'الطالب غير موجود'; end if;
  select id into gid from guardians where phone = ph;
  if gid is null then insert into guardians(phone, name) values (ph, nullif(btrim(p_name), '')) returning id into gid;
  elsif coalesce(btrim(p_name), '') <> '' then update guardians set name = btrim(p_name) where id = gid; end if;
  insert into guardian_students values (gid, p_student) on conflict do nothing;
  update students set guardian_phone = ph, guardian_name = coalesce(nullif(btrim(p_name), ''), guardian_name) where profile_id = p_student;
  return jsonb_build_object('ok', true, 'guardian', gid);
end $$;

-- فك ربط ولي أمر بطالب (رقم خاطئ)
create or replace function public.gd_unlink(p_guardian uuid, p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.gd_can_manage() then raise exception 'غير مصرح'; end if;
  delete from guardian_students where guardian_id = p_guardian and student_id = p_student;
  delete from guardian_sessions where guardian_id = p_guardian;
  return jsonb_build_object('ok', true);
end $$;

-- قائمة الطلاب وأولياء أمورهم للإدارة (بحث بالاسم أو الصف)
create or replace function public.gd_list(p_q text default '', p_grade int default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.gd_can_manage() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(x order by x->>'grade_sort', x->>'name') from (
      select jsonb_build_object('student', s.profile_id, 'name', p.full_name, 'grade_id', s.grade_id,
        'grade', coalesce(vs.label, g.name_ar || ' — ' || st.name_ar), 'grade_sort', lpad(coalesce(st.sort, 9)::text, 2, '0') || lpad(coalesce(g.number, 0)::text, 2, '0'),
        'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', gd.id, 'phone', gd.phone, 'name', gd.name, 'has_pin', gd.pin_hash is not null,
                        'locked', gd.locked, 'last_login', gd.last_login,
                        'code_pending', exists (select 1 from guardian_codes c where c.guardian_id = gd.id and c.used_at is null and c.expires_at > now())))
                      from guardian_students gs join guardians gd on gd.id = gs.guardian_id where gs.student_id = s.profile_id), '[]'::jsonb)) x
      from students s join profiles p on p.id = s.profile_id and p.active
      left join v_students vs on vs.profile_id = s.profile_id
      left join grades g on g.id = s.grade_id left join stages st on st.id = g.stage_id
      where (coalesce(p_q, '') = '' or p.full_name ilike '%' || btrim(p_q) || '%' or s.student_number = btrim(p_q))
        and (p_grade is null or s.grade_id = p_grade)
      limit 400) t), '[]'::jsonb);
end $$;

-- إصدار رمز تفعيل (8 حروف/أرقام، صالح 14 يومًا، مرة واحدة) — يُعاد نصه مرة واحدة فقط لإرساله على واتساب
create or replace function public.gd_issue_code(p_guardian uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare code text; g guardians;
begin
  if not private.gd_can_manage() then raise exception 'غير مصرح'; end if;
  select * into g from guardians where id = p_guardian;
  if g.id is null then raise exception 'ولي الأمر غير موجود'; end if;
  code := (select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 8));
  update guardian_codes set expires_at = now() where guardian_id = g.id and used_at is null and expires_at > now();   -- الرمز السابق يبطل
  insert into guardian_codes(guardian_id, code_hash, expires_at, created_by) values (g.id, private.gd_hash('C|' || code), now() + interval '14 days', public.me_id());
  return jsonb_build_object('ok', true, 'code', code, 'phone', g.phone, 'name', g.name,
    'children', (select jsonb_agg(p.full_name order by p.full_name) from guardian_students gs join profiles p on p.id = gs.student_id where gs.guardian_id = g.id));
end $$;

-- ================= من حساب الطالب (ولي الأمر) =================
-- أولياء الأمور المسجلون لهذا الطالب (الجوال مخفي)
create or replace function public.pp_status() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare sid uuid := private.gd_login_student();
begin
  if sid is null then raise exception 'ادخل بحساب الطالب المدرسي أولًا'; end if;
  return jsonb_build_object('student', (select full_name from profiles where id = sid),
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'phone', private.gd_mask(g.phone), 'name', g.name,
                    'has_pin', g.pin_hash is not null, 'locked', g.locked))
                  from guardian_students gs join guardians g on g.id = gs.guardian_id where gs.student_id = sid), '[]'::jsonb));
end $$;

create or replace function private.gd_new_session(p_guardian uuid, p_student uuid) returns text
language plpgsql security definer set search_path = public, private as $$
declare tok text := encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex');
begin
  delete from guardian_sessions where expires_at < now();
  insert into guardian_sessions(token_hash, guardian_id, student_id, expires_at) values (private.gd_hash('S|' || tok), p_guardian, p_student, now() + interval '30 minutes');
  update guardians set last_login = now(), fails = 0 where id = p_guardian;
  return tok;
end $$;

-- أول مرة (أو بعد النسيان/القفل): رمز التفعيل + اختيار رمز سري جديد
create or replace function public.pp_activate(p_code text, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid uuid := private.gd_login_student(); c guardian_codes;
begin
  if sid is null then raise exception 'ادخل بحساب الطالب المدرسي أولًا'; end if;
  if coalesce(p_pin, '') !~ '^[0-9]{6}$' then raise exception 'الرمز السري يجب أن يكون 6 أرقام'; end if;
  if p_pin ~ '^(.)\1{5}$' or p_pin in ('123456','654321','012345','123123') then raise exception 'اختر رمزًا سريًا أصعب من ذلك'; end if;
  select gc.* into c from guardian_codes gc join guardian_students gs on gs.guardian_id = gc.guardian_id and gs.student_id = sid
   where gc.code_hash = private.gd_hash('C|' || upper(btrim(coalesce(p_code, '')))) and gc.used_at is null and gc.expires_at > now() limit 1;
  if c.id is null then
    perform pg_sleep(1);
    raise exception 'رمز التفعيل غير صحيح أو منتهي — اطلب رمزًا جديدًا من إدارة المدرسة';
  end if;
  update guardian_codes set used_at = now() where id = c.id;
  update guardians set pin_hash = private.gd_hash('P|' || id || '|' || p_pin), pin_set_at = now(), fails = 0, locked = false where id = c.guardian_id;
  delete from guardian_sessions where guardian_id = c.guardian_id;
  return jsonb_build_object('ok', true, 'token', private.gd_new_session(c.guardian_id, sid));
end $$;

-- الدخول بالرمز السري
create or replace function public.pp_login(p_guardian uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid uuid := private.gd_login_student(); g guardians;
begin
  if sid is null then raise exception 'ادخل بحساب الطالب المدرسي أولًا'; end if;
  select g2.* into g from guardians g2 join guardian_students gs on gs.guardian_id = g2.id and gs.student_id = sid where g2.id = p_guardian;
  if g.id is null then raise exception 'ولي الأمر غير مرتبط بهذا الطالب'; end if;
  if g.pin_hash is null then raise exception 'لم يُفعَّل الرمز السري بعد — استخدم رمز التفعيل'; end if;
  if g.locked then raise exception 'الرمز السري مقفل بعد محاولات خاطئة — اطلب رمز تفعيل جديد من إدارة المدرسة'; end if;
  if g.pin_hash <> private.gd_hash('P|' || g.id || '|' || coalesce(p_pin, '')) then
    update guardians set fails = fails + 1, locked = (fails + 1 >= 5) where id = g.id;
    perform pg_sleep(1);
    return jsonb_build_object('ok', false, 'error', case when g.fails + 1 >= 5 then 'تم قفل الرمز السري بعد 5 محاولات خاطئة — اطلب رمز تفعيل جديد'
                                                         else 'الرمز السري غير صحيح — متبقٍ ' || (4 - g.fails) || ' محاولات' end);
  end if;
  return jsonb_build_object('ok', true, 'token', private.gd_new_session(g.id, sid));
end $$;

create or replace function private.gd_session(p_token text) returns guardian_sessions
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions;
begin
  select * into s from guardian_sessions where token_hash = private.gd_hash('S|' || coalesce(p_token, '')) and expires_at > now();
  if s.token_hash is null or s.student_id is distinct from private.gd_login_student() then
    raise exception 'انتهت جلسة ولي الأمر — ادخل بالرمز السري مرة أخرى'; end if;
  update guardian_sessions set expires_at = now() + interval '30 minutes' where token_hash = s.token_hash;   -- 30 دقيقة من آخر نشاط
  return s;
end $$;

-- بيانات أبناء ولي الأمر
create or replace function public.pp_children(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); g guardians;
begin
  select * into g from guardians where id = s.guardian_id;
  return jsonb_build_object('guardian', jsonb_build_object('name', g.name, 'phone', private.gd_mask(g.phone)),
    'children', coalesce((select jsonb_agg(private.child_summary(gs.student_id) order by p.full_name)
                 from guardian_students gs join profiles p on p.id = gs.student_id and p.active where gs.guardian_id = g.id), '[]'::jsonb));
end $$;

-- تغيير الرمز السري من داخل الجلسة
create or replace function public.pp_change_pin(p_token text, p_old text, p_new text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); g guardians;
begin
  select * into g from guardians where id = s.guardian_id;
  if g.pin_hash <> private.gd_hash('P|' || g.id || '|' || coalesce(p_old, '')) then raise exception 'الرمز السري الحالي غير صحيح'; end if;
  if coalesce(p_new, '') !~ '^[0-9]{6}$' then raise exception 'الرمز السري يجب أن يكون 6 أرقام'; end if;
  update guardians set pin_hash = private.gd_hash('P|' || g.id || '|' || p_new), pin_set_at = now() where id = g.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.pp_logout(p_token text) returns jsonb
language sql security definer set search_path = public, private as $$
  delete from guardian_sessions where token_hash = private.gd_hash('S|' || coalesce(p_token, ''));
  select jsonb_build_object('ok', true);
$$;

do $$ declare f text; begin
  foreach f in array array['gd_import(jsonb,boolean)','gd_set_phone(uuid,text,text)','gd_unlink(uuid,uuid)','gd_list(text,int)','gd_issue_code(uuid)',
                           'pp_status()','pp_activate(text,text)','pp_login(uuid,text)','pp_children(text)','pp_change_pin(text,text,text)','pp_logout(text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
