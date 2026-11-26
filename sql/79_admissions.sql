-- ============================================================
-- 79) التسجيل والقبول — رحلة تسجيل الطالب
-- عميل محتمل (التسويق) ← استفسار وتسجيل بيانات ولي الأمر ← اختبار القبول ← ناجح/لم يجتز
--   ← فتح الملف (المستندات) ← توقيع العقد ← تسجيل رسمي (ويُربط تلقائيًا بحساب الطالب عند ظهوره في المنصة برقم الهوية)
-- الصلاحيات:
--   • قسم التسجيل والقبول (المسمى: تسجيل/قبول) + مدير النظام + الإدارة العليا: كامل الرحلة.
--   • التسويق (المسمى: تسويق/علاقات عامة/إعلام): إضافة العملاء ومتابعتهم واستعراض اللوحة والتقارير (بلا العقود).
--   • مدير المرحلة: متقدّمو مرحلته (بدون بيانات تواصل ولي الأمر) ورصد نتائج اختبار القبول.
--   • المختبِر (معلم/مشرف يكلَّف باختبار طالب): يرى موعد الاختبار ويرصد النتيجة فقط.
--   • نموذج عام بلا تسجيل دخول (apply.html) لاستقبال طلبات أولياء الأمور من الإعلانات.
-- ============================================================

create table if not exists public.adm_families (
  id            bigserial primary key,
  guardian_name text not null check (btrim(guardian_name) <> ''),
  relation      text,
  phone         text not null check (btrim(phone) <> ''),
  phone2        text,
  email         text,
  district      text,
  source        text not null default 'other' check (source in ('social','mall','call','walkin','referral','website','event','other')),
  source_detail text,
  owner_id      uuid references public.profiles(id) on delete set null,
  notes         text,
  public_form   boolean not null default false,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists adm_fam_phone on public.adm_families(phone);

create table if not exists public.adm_applicants (
  id             bigserial primary key,
  family_id      bigint not null references public.adm_families(id) on delete cascade,
  name           text not null check (btrim(name) <> ''),
  gender         text not null default 'm' check (gender in ('m','f')),
  birth_date     date,
  national_id    text,
  current_school text,
  grade_id       int references public.grades(id) on delete set null,
  year_name      text,
  stage          text not null default 'lead' check (stage in ('lead','inquiry','test','passed','failed','file','contract','enrolled','lost')),
  test_at        timestamptz,
  tester_id      uuid references public.profiles(id) on delete set null,
  test_score     numeric(5,2),
  test_notes     text,
  file_no        text,
  docs           jsonb not null default '{}'::jsonb,
  contract_no    text,
  contract_at    date,
  fees           numeric(10,2),
  enrolled_at    date,
  lost_reason    text,
  stage_at       timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists adm_app_fam on public.adm_applicants(family_id);
create index if not exists adm_app_stage on public.adm_applicants(stage);
create unique index if not exists adm_app_file on public.adm_applicants(file_no) where file_no is not null;

create table if not exists public.adm_log (
  id           bigserial primary key,
  family_id    bigint not null references public.adm_families(id) on delete cascade,
  applicant_id bigint references public.adm_applicants(id) on delete cascade,
  kind         text not null default 'note' check (kind in ('note','call','visit','whatsapp','email','stage','test','system')),
  body         text,
  next_at      date,
  done         boolean not null default false,
  by_id        uuid references public.profiles(id) on delete set null,
  at           timestamptz not null default now()
);
create index if not exists adm_log_fam on public.adm_log(family_id, at desc);
create index if not exists adm_log_next on public.adm_log(next_at) where next_at is not null and not done;

alter table public.adm_families enable row level security; alter table public.adm_applicants enable row level security; alter table public.adm_log enable row level security;
revoke all on public.adm_families, public.adm_applicants, public.adm_log from anon, authenticated;

-- ---------- الأدوار ----------
create or replace function private.adm_role() returns text
language sql stable security definer set search_path = public, private as $$
  select case
    when p.role in ('admin','leadership') or coalesce(p.job_title,'') ~ '(تسجيل|القبول|قبول)' then 'manage'
    when coalesce(p.job_title,'') ~ '(تسويق|علاقات عامة|الإعلام|إعلام)' then 'marketing'
    when p.role = 'principal' then 'principal'
    when exists (select 1 from adm_applicants a where a.tester_id = p.id and a.stage in ('test','passed','failed')) then 'tester'
    else null end
  from profiles p where p.id = public.me_id() and p.active and private.beta_ok('admissions', array['leadership','principal','supervisor','teacher','staff'])
$$;

-- هل يرى المستخدم هذا المتقدّم؟ (التسجيل والتسويق: الكل؛ المدير: مرحلته؛ المختبِر: من كُلّف باختباره)
create or replace function private.adm_sees(a adm_applicants) returns boolean
language sql stable security definer set search_path = public, private as $$
  select case private.adm_role()
    when 'manage' then true when 'marketing' then true
    when 'principal' then a.tester_id = public.me_id() or exists (select 1 from grades g where g.id = a.grade_id and g.stage_id = any (private.my_stage_ids()))
    when 'tester' then a.tester_id = public.me_id()
    else false end
$$;

create or replace function private.adm_stage_label(s text) returns text language sql immutable as $$
  select case s when 'lead' then 'عميل محتمل' when 'inquiry' then 'استفسار — بيانات ولي الأمر' when 'test' then 'اختبار القبول'
    when 'passed' then 'اجتاز الاختبار' when 'failed' then 'لم يجتز الاختبار' when 'file' then 'فتح الملف' when 'contract' then 'توقيع العقد'
    when 'enrolled' then 'مسجّل رسميًا' when 'lost' then 'لم يكمل' else s end
$$;
create or replace function private.adm_source_label(s text) returns text language sql immutable as $$
  select case s when 'social' then 'وسائل التواصل الاجتماعي' when 'mall' then 'دعاية في المولات' when 'call' then 'اتصال هاتفي'
    when 'walkin' then 'زيارة المدرسة' when 'referral' then 'ترشيح ولي أمر' when 'website' then 'الموقع / النموذج الإلكتروني'
    when 'event' then 'فعالية / معرض' else 'أخرى' end
$$;

create or replace function private.adm_cfg() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'docs', coalesce((select value -> 'docs' from app_settings where key = 'admissions'),
      '["صورة هوية/إقامة الطالب","شهادة الميلاد","صورة هوية ولي الأمر","آخر شهادة دراسية","صور شخصية","سجل التطعيمات","إخلاء طرف من المدرسة السابقة"]'::jsonb),
    'pass', coalesce((select (value ->> 'pass')::numeric from app_settings where key = 'admissions' and value ? 'pass'), 60),
    'public_open', coalesce((select (value ->> 'public_open')::boolean from app_settings where key = 'admissions' and value ? 'public_open'), true),
    'years', coalesce((select value -> 'years' from app_settings where key = 'admissions'), '[]'::jsonb))
$$;

-- رابط الطالب الرسمي في المنصة (بالهوية = رقم الطالب)
create or replace function private.adm_student_of(a adm_applicants) returns uuid
language sql stable security definer set search_path = public as $$
  select s.profile_id from students s where a.national_id is not null and btrim(a.national_id) <> '' and s.student_number = btrim(a.national_id) limit 1
$$;

create or replace function private.adm_row(a adm_applicants, full_info boolean) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', a.id, 'family_id', a.family_id, 'name', a.name, 'gender', a.gender, 'birth_date', a.birth_date,
    'national_id', case when full_info then a.national_id end, 'current_school', a.current_school,
    'grade_id', a.grade_id, 'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = a.grade_id),
    'year_name', a.year_name, 'stage', a.stage, 'stage_label', private.adm_stage_label(a.stage), 'stage_at', a.stage_at,
    'test_at', a.test_at, 'tester_id', a.tester_id, 'tester', (select full_name from profiles where id = a.tester_id),
    'test_score', a.test_score, 'test_notes', a.test_notes, 'file_no', a.file_no, 'docs', a.docs,
    'contract_no', case when full_info then a.contract_no end, 'contract_at', case when full_info then a.contract_at end,
    'fees', case when full_info then a.fees end, 'enrolled_at', a.enrolled_at, 'lost_reason', a.lost_reason,
    'student_id', private.adm_student_of(a), 'created_at', a.created_at)
$$;

-- ---------- السياق ----------
create or replace function public.adm_me() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role();
begin
  if r is null then return jsonb_build_object('role', null); end if;
  return jsonb_build_object('role', r, 'cfg', private.adm_cfg(),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar, 'section', se.name_ar) order by se.sort, st.sort, g.number), '[]')
                 from grades g join stages st on st.id = g.stage_id join sections se on se.id = st.section_id),
    'staff', case when r in ('manage','marketing','principal') then (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title, 'role', p.role) order by p.full_name), '[]')
                 from profiles p where p.active and p.role in ('admin','leadership','principal','supervisor','teacher','staff')) else '[]'::jsonb end);
end $$;

-- ---------- لوحة الرحلة ----------
create or replace function public.adm_board(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role(); q text := public.norm(nullif(btrim(coalesce(p ->> 'q', '')), ''));
  full_info boolean;
begin
  if r is null then raise exception 'ليس لديك صلاحية التسجيل والقبول'; end if;
  full_info := r = 'manage';
  return coalesce((select jsonb_agg(x order by (x ->> 'stage_at') desc) from (
    select private.adm_row(a, full_info) || jsonb_build_object(
        'guardian', f.guardian_name,
        'phone', case when r in ('manage','marketing') then f.phone end,
        'source', f.source, 'source_label', private.adm_source_label(f.source), 'source_detail', f.source_detail,
        'owner_id', f.owner_id, 'owner', (select full_name from profiles where id = f.owner_id),
        'next_at', (select min(l.next_at) from adm_log l where l.family_id = f.id and l.next_at is not null and not l.done),
        'last_at', (select max(l.at) from adm_log l where l.family_id = f.id)) x
      from adm_applicants a join adm_families f on f.id = a.family_id
     where private.adm_sees(a)
       and (q is null or public.norm(a.name) like '%' || q || '%' or public.norm(f.guardian_name) like '%' || q || '%'
            or (r in ('manage','marketing') and (f.phone like '%' || btrim(p ->> 'q') || '%' or a.file_no = btrim(p ->> 'q'))))
       and (nullif(p ->> 'source', '') is null or f.source = p ->> 'source')
       and (nullif(p ->> 'owner', '') is null or f.owner_id = (p ->> 'owner')::uuid)
       and (nullif(p ->> 'grade', '') is null or a.grade_id = (p ->> 'grade')::int)
       and (nullif(p ->> 'year', '') is null or a.year_name = p ->> 'year')
       and (coalesce((p ->> 'closed')::boolean, true) or a.stage not in ('enrolled','lost','failed'))
     limit 2000) z), '[]'::jsonb);
end $$;

-- ---------- ملف الأسرة ----------
create or replace function public.adm_family_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role(); f adm_families; contact boolean;
begin
  if r is null then raise exception 'ليس لديك صلاحية التسجيل والقبول'; end if;
  select * into f from adm_families where id = p_id;
  if f.id is null then raise exception 'غير موجود'; end if;
  if not exists (select 1 from adm_applicants a where a.family_id = f.id and private.adm_sees(a)) and r not in ('manage','marketing') then raise exception 'ليس لديك صلاحية'; end if;
  contact := r in ('manage','marketing');
  return jsonb_build_object('id', f.id, 'guardian_name', f.guardian_name, 'relation', f.relation,
    'phone', case when contact then f.phone end, 'phone2', case when contact then f.phone2 end, 'email', case when contact then f.email end,
    'district', f.district, 'source', f.source, 'source_label', private.adm_source_label(f.source), 'source_detail', f.source_detail,
    'owner_id', f.owner_id, 'owner', (select full_name from profiles where id = f.owner_id), 'notes', case when contact then f.notes end,
    'public_form', f.public_form, 'created_at', f.created_at, 'created_by', (select full_name from profiles where id = f.created_by),
    'can_edit', r in ('manage','marketing'), 'can_stage', r = 'manage',
    'applicants', coalesce((select jsonb_agg(private.adm_row(a, r = 'manage') order by a.id) from adm_applicants a where a.family_id = f.id and private.adm_sees(a)), '[]'),
    'log', case when contact then coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'body', l.body, 'next_at', l.next_at, 'done', l.done,
              'applicant', (select name from adm_applicants where id = l.applicant_id), 'by', (select full_name from profiles where id = l.by_id), 'at', l.at) order by l.at desc)
              from adm_log l where l.family_id = f.id), '[]') else '[]'::jsonb end);
end $$;

-- حفظ الأسرة (+ أبناء جدد عند الإنشاء) — التسجيل والتسويق
create or replace function public.adm_family_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r text := private.adm_role(); fid bigint := nullif(p ->> 'id', '')::bigint; ch jsonb; dup bigint; st text;
begin
  if r not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  if btrim(coalesce(p ->> 'guardian_name', '')) = '' or btrim(coalesce(p ->> 'phone', '')) = '' then raise exception 'اسم ولي الأمر ورقم الجوال مطلوبان'; end if;
  if fid is null then
    select id into dup from adm_families where regexp_replace(phone, '\D', '', 'g') = regexp_replace(p ->> 'phone', '\D', '', 'g') limit 1;
    if dup is not null and not coalesce((p ->> 'force')::boolean, false) then
      return jsonb_build_object('ok', false, 'duplicate', dup, 'name', (select guardian_name from adm_families where id = dup));
    end if;
    insert into adm_families(guardian_name, relation, phone, phone2, email, district, source, source_detail, owner_id, notes, created_by)
    values (btrim(p ->> 'guardian_name'), nullif(btrim(p ->> 'relation'), ''), btrim(p ->> 'phone'), nullif(btrim(p ->> 'phone2'), ''), nullif(lower(btrim(p ->> 'email')), ''),
            nullif(btrim(p ->> 'district'), ''), coalesce(nullif(p ->> 'source', ''), 'other'), nullif(btrim(p ->> 'source_detail'), ''),
            coalesce(nullif(p ->> 'owner_id', '')::uuid, case when r = 'manage' then public.me_id() end), nullif(btrim(p ->> 'notes'), ''), public.me_id())
    returning id into fid;
    -- المرحلة الأولى: التسويق يسجّل «عميل محتمل»، والتسجيل يسجّل «استفسار» مباشرة
    st := case when coalesce(p ->> 'stage', '') in ('lead','inquiry') then p ->> 'stage' when r = 'manage' then 'inquiry' else 'lead' end;
    for ch in select * from jsonb_array_elements(coalesce(p -> 'children', '[]')) loop
      continue when btrim(coalesce(ch ->> 'name', '')) = '';
      insert into adm_applicants(family_id, name, gender, birth_date, national_id, current_school, grade_id, year_name, stage)
      values (fid, btrim(ch ->> 'name'), coalesce(nullif(ch ->> 'gender', ''), 'm'), nullif(ch ->> 'birth_date', '')::date, nullif(btrim(ch ->> 'national_id'), ''),
              nullif(btrim(ch ->> 'current_school'), ''), nullif(ch ->> 'grade_id', '')::int, nullif(btrim(coalesce(ch ->> 'year_name', p ->> 'year_name')), ''), st);
    end loop;
    insert into adm_log(family_id, kind, body, by_id) values (fid, 'system', 'إضافة العميل — المصدر: ' || private.adm_source_label(coalesce(nullif(p ->> 'source', ''), 'other')), public.me_id());
  else
    update adm_families set guardian_name = btrim(p ->> 'guardian_name'), relation = nullif(btrim(p ->> 'relation'), ''), phone = btrim(p ->> 'phone'),
      phone2 = nullif(btrim(p ->> 'phone2'), ''), email = nullif(lower(btrim(p ->> 'email')), ''), district = nullif(btrim(p ->> 'district'), ''),
      source = coalesce(nullif(p ->> 'source', ''), source), source_detail = nullif(btrim(p ->> 'source_detail'), ''),
      owner_id = case when p ? 'owner_id' then nullif(p ->> 'owner_id', '')::uuid else owner_id end, notes = nullif(btrim(p ->> 'notes'), ''), updated_at = now()
     where id = fid;
    if not found then raise exception 'غير موجود'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', fid);
end $$;

-- إضافة/تعديل ابن — بيانات أساسية (المرحلة تتغير من adm_stage فقط)
create or replace function public.adm_applicant_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r text := private.adm_role(); aid bigint := nullif(p ->> 'id', '')::bigint;
begin
  if r not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  if btrim(coalesce(p ->> 'name', '')) = '' then raise exception 'اسم الطالب مطلوب'; end if;
  if aid is null then
    insert into adm_applicants(family_id, name, gender, birth_date, national_id, current_school, grade_id, year_name, stage)
    values ((p ->> 'family_id')::bigint, btrim(p ->> 'name'), coalesce(nullif(p ->> 'gender', ''), 'm'), nullif(p ->> 'birth_date', '')::date,
            nullif(btrim(p ->> 'national_id'), ''), nullif(btrim(p ->> 'current_school'), ''), nullif(p ->> 'grade_id', '')::int, nullif(btrim(p ->> 'year_name'), ''),
            case when r = 'manage' then 'inquiry' else 'lead' end) returning id into aid;
  else
    update adm_applicants set name = btrim(p ->> 'name'), gender = coalesce(nullif(p ->> 'gender', ''), gender), birth_date = nullif(p ->> 'birth_date', '')::date,
      national_id = case when r = 'manage' then nullif(btrim(p ->> 'national_id'), '') else national_id end,
      current_school = nullif(btrim(p ->> 'current_school'), ''), grade_id = nullif(p ->> 'grade_id', '')::int, year_name = nullif(btrim(p ->> 'year_name'), ''), updated_at = now()
     where id = aid;
    if not found then raise exception 'غير موجود'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', aid);
end $$;

-- ---------- الانتقال بين مراحل الرحلة (قسم التسجيل) ----------
create or replace function public.adm_stage(p_id bigint, p_stage text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a adm_applicants; msg text; y text; n int; tester uuid;
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  select * into a from adm_applicants where id = p_id for update;
  if a.id is null then raise exception 'غير موجود'; end if;
  if p_stage not in ('lead','inquiry','test','passed','failed','file','contract','enrolled','lost') then raise exception 'مرحلة غير صحيحة'; end if;
  if p_stage = 'test' then
    if nullif(p ->> 'test_at', '') is null then raise exception 'حدّد موعد اختبار القبول'; end if;
    if a.grade_id is null and nullif(p ->> 'grade_id', '') is null then raise exception 'حدّد الصف المطلوب للطالب أولًا'; end if;
    tester := nullif(p ->> 'tester_id', '')::uuid;
    update adm_applicants set stage = 'test', test_at = (p ->> 'test_at')::timestamptz, tester_id = tester,
      grade_id = coalesce(nullif(p ->> 'grade_id', '')::int, grade_id), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'تحديد موعد اختبار القبول: ' || to_char((p ->> 'test_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
           || coalesce(' — المختبِر: ' || (select full_name from profiles where id = tester), '');
    if tester is not null and tester <> public.me_id() then
      with m as (insert into messages(sender_id, subject, body, kind)
                 values (public.me_id(), 'اختبار قبول: ' || a.name, 'كُلّفت باختبار قبول للطالب ' || a.name || ' يوم ' ||
                         to_char((p ->> 'test_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || E'.\nسجّل النتيجة من: التسجيل والقبول ← اختبارات القبول.', 'mail') returning id)
      insert into message_recipients(message_id, profile_id) select id, tester from m;
    end if;
  elsif p_stage in ('passed','failed') then
    update adm_applicants set stage = p_stage, test_score = coalesce(nullif(p ->> 'test_score', '')::numeric, test_score),
      test_notes = coalesce(nullif(btrim(p ->> 'test_notes'), ''), test_notes), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'نتيجة اختبار القبول: ' || private.adm_stage_label(p_stage) || coalesce(' (' || nullif(p ->> 'test_score', '') || ')', '');
  elsif p_stage = 'file' then
    if a.stage not in ('passed','file','contract','enrolled') and not coalesce((p ->> 'skip_test')::boolean, false) then raise exception 'يُفتح الملف بعد اجتياز اختبار القبول'; end if;
    y := to_char(now() at time zone 'Asia/Riyadh', 'YY');
    select count(*) + 1 into n from adm_applicants where file_no like 'ADM' || y || '-%';
    update adm_applicants set stage = 'file', file_no = coalesce(file_no, nullif(btrim(p ->> 'file_no'), ''), 'ADM' || y || '-' || lpad(n::text, 4, '0')),
      national_id = coalesce(nullif(btrim(p ->> 'national_id'), ''), national_id), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'فتح ملف الطالب رقم ' || (select file_no from adm_applicants where id = p_id);
  elsif p_stage = 'contract' then
    if a.stage not in ('file','contract','enrolled') then raise exception 'يُوقَّع العقد بعد فتح الملف'; end if;
    if nullif(p ->> 'contract_at', '') is null then raise exception 'حدّد تاريخ توقيع العقد'; end if;
    update adm_applicants set stage = 'contract', contract_no = nullif(btrim(p ->> 'contract_no'), ''), contract_at = (p ->> 'contract_at')::date,
      fees = nullif(p ->> 'fees', '')::numeric, stage_at = now(), updated_at = now() where id = p_id;
    msg := 'توقيع العقد' || coalesce(' رقم ' || nullif(btrim(p ->> 'contract_no'), ''), '') || ' بتاريخ ' || (p ->> 'contract_at');
  elsif p_stage = 'enrolled' then
    if a.stage not in ('contract','enrolled') then raise exception 'يُسجَّل الطالب رسميًا بعد توقيع العقد'; end if;
    if coalesce(nullif(btrim(p ->> 'national_id'), ''), a.national_id) is null then raise exception 'رقم هوية الطالب مطلوب للتسجيل الرسمي'; end if;
    update adm_applicants set stage = 'enrolled', national_id = coalesce(nullif(btrim(p ->> 'national_id'), ''), national_id),
      enrolled_at = coalesce(nullif(p ->> 'enrolled_at', '')::date, (now() at time zone 'Asia/Riyadh')::date), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'التسجيل الرسمي للطالب في المدرسة';
  elsif p_stage = 'lost' then
    if btrim(coalesce(p ->> 'lost_reason', '')) = '' then raise exception 'اذكر سبب عدم الإكمال'; end if;
    update adm_applicants set stage = 'lost', lost_reason = btrim(p ->> 'lost_reason'), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'لم يكمل: ' || btrim(p ->> 'lost_reason');
  else
    update adm_applicants set stage = p_stage, stage_at = now(), updated_at = now() where id = p_id;
    msg := 'نقل إلى مرحلة: ' || private.adm_stage_label(p_stage);
  end if;
  insert into adm_log(family_id, applicant_id, kind, body, by_id) values (a.family_id, a.id, 'stage', msg, public.me_id());
  return jsonb_build_object('ok', true);
end $$;

-- المستندات (قائمة تحقق) — التسجيل
create or replace function public.adm_docs_set(p_id bigint, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  if jsonb_typeof(p_docs) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  update adm_applicants set docs = p_docs, updated_at = now() where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- السجل والمتابعات ----------
create or replace function public.adm_log_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare r text := private.adm_role();
begin
  if r not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  if btrim(coalesce(p ->> 'body', '')) = '' and nullif(p ->> 'next_at', '') is null then raise exception 'اكتب الملاحظة'; end if;
  -- إغلاق المتابعات السابقة لهذه الأسرة عند تسجيل تواصل جديد
  if coalesce((p ->> 'close_prev')::boolean, true) then update adm_log set done = true where family_id = (p ->> 'family_id')::bigint and next_at is not null and not done; end if;
  insert into adm_log(family_id, applicant_id, kind, body, next_at, by_id)
  values ((p ->> 'family_id')::bigint, nullif(p ->> 'applicant_id', '')::bigint, coalesce(nullif(p ->> 'kind', ''), 'note'), nullif(btrim(p ->> 'body'), ''),
          nullif(p ->> 'next_at', '')::date, public.me_id());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_followup_done(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  update adm_log set done = true where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_followups() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if private.adm_role() not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  return coalesce((select jsonb_agg(x order by (x ->> 'next_at')) from (
    select jsonb_build_object('id', l.id, 'family_id', f.id, 'guardian', f.guardian_name, 'phone', f.phone, 'next_at', l.next_at, 'body', l.body,
      'owner', (select full_name from profiles where id = f.owner_id), 'mine', f.owner_id = public.me_id(),
      'children', (select string_agg(a.name || ' (' || private.adm_stage_label(a.stage) || ')', '، ') from adm_applicants a where a.family_id = f.id)) x
    from adm_log l join adm_families f on f.id = l.family_id where l.next_at is not null and not l.done and l.next_at <= (now() at time zone 'Asia/Riyadh')::date + 7) z), '[]'::jsonb);
end $$;

-- ---------- اختبارات القبول ----------
create or replace function public.adm_tests() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role();
begin
  if r is null then raise exception 'ليس لديك صلاحية'; end if;
  return coalesce((select jsonb_agg(private.adm_row(a, false) || jsonb_build_object('guardian', f.guardian_name, 'can_grade', r in ('manage','principal') or a.tester_id = public.me_id())
            order by a.test_at) from adm_applicants a join adm_families f on f.id = a.family_id
     where a.test_at is not null and private.adm_sees(a) and (a.stage = 'test' or a.test_at >= now() - interval '30 days')), '[]'::jsonb);
end $$;

create or replace function public.adm_test_result(p_id bigint, p_passed boolean, p_score numeric, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a adm_applicants; r text := private.adm_role();
begin
  select * into a from adm_applicants where id = p_id for update;
  if a.id is null then raise exception 'غير موجود'; end if;
  if not (r = 'manage' or (r = 'principal' and private.adm_sees(a)) or a.tester_id = public.me_id()) then raise exception 'ليس لديك صلاحية رصد النتيجة'; end if;
  if a.stage not in ('test','passed','failed') then raise exception 'الطالب ليس في مرحلة اختبار القبول'; end if;
  update adm_applicants set stage = case when p_passed then 'passed' else 'failed' end, test_score = p_score, test_notes = nullif(btrim(p_notes), ''),
    stage_at = now(), updated_at = now() where id = p_id;
  insert into adm_log(family_id, applicant_id, kind, body, by_id)
  values (a.family_id, a.id, 'test', 'نتيجة اختبار القبول: ' || case when p_passed then 'اجتاز' else 'لم يجتز' end || coalesce(' — الدرجة ' || p_score, '') || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), public.me_id());
  return jsonb_build_object('ok', true);
end $$;

-- ---------- التقارير ----------
create or replace function public.adm_stats(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare f date := coalesce(p_from, (now() at time zone 'Asia/Riyadh')::date - 365); t date := coalesce(p_to, (now() at time zone 'Asia/Riyadh')::date);
begin
  if private.adm_role() not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  return (with base as (select a.*, fm.source, fm.owner_id from adm_applicants a join adm_families fm on fm.id = a.family_id
                         where (a.created_at at time zone 'Asia/Riyadh')::date between f and t),
    ord as (select s, i from unnest(array['lead','inquiry','test','passed','file','contract','enrolled']) with ordinality u(s, i))
  select jsonb_build_object(
    'total', (select count(*) from base), 'families', (select count(distinct family_id) from base),
    'enrolled', (select count(*) from base where stage = 'enrolled'), 'lost', (select count(*) from base where stage = 'lost'),
    'failed', (select count(*) from base where stage = 'failed'),
    'stages', (select jsonb_object_agg(stage, n) from (select stage, count(*) n from base group by stage) z),
    -- القمع: كم وصل إلى كل مرحلة أو تجاوزها
    'funnel', (select jsonb_agg(jsonb_build_object('stage', o.s, 'label', private.adm_stage_label(o.s), 'n',
                 (select count(*) from base b where coalesce((select i from ord where s = case when b.stage = 'failed' then 'test' when b.stage = 'lost' then
                    case when b.contract_at is not null then 'contract' when b.file_no is not null then 'file' when b.test_score is not null then 'test' else 'inquiry' end else b.stage end), 1) >= o.i)) order by o.i) from ord o),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'label', private.adm_source_label(source), 'n', n, 'enrolled', e) order by n desc), '[]')
                from (select source, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by source) z),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('grade', g, 'n', n, 'enrolled', e) order by n desc), '[]')
               from (select coalesce((select gr.name_ar || ' — ' || st.name_ar from grades gr join stages st on st.id = gr.stage_id where gr.id = b.grade_id), 'غير محدد') g,
                            count(*) n, count(*) filter (where stage = 'enrolled') e from base b group by 1) z),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce((select full_name from profiles where id = owner_id), 'غير مسند'), 'n', n, 'enrolled', e) order by n desc), '[]')
               from (select owner_id, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by owner_id) z),
    'lost_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', lost_reason, 'n', n) order by n desc), '[]')
                     from (select lost_reason, count(*) n from base where stage = 'lost' group by lost_reason) z),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'enrolled', e) order by m), '[]')
                from (select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM') m, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by 1) z)));
end $$;

-- ---------- الإعدادات ----------
create or replace function public.adm_settings_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  insert into app_settings(key, value) values ('admissions', jsonb_build_object(
      'docs', coalesce((select jsonb_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'docs', '[]')) x where btrim(x) <> ''), '[]'::jsonb),
      'pass', coalesce(nullif(p ->> 'pass', '')::numeric, 60),
      'public_open', coalesce((p ->> 'public_open')::boolean, true),
      'years', coalesce((select jsonb_agg(btrim(x)) from jsonb_array_elements_text(coalesce(p -> 'years', '[]')) x where btrim(x) <> ''), '[]'::jsonb)))
  on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_family_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  if exists (select 1 from adm_applicants where family_id = p_id and stage in ('contract','enrolled')) and public.me_role() <> 'admin' then
    raise exception 'لا يُحذف عميل وقّع عقدًا — غيّر حالته إلى «لم يكمل» بدلًا من الحذف';
  end if;
  delete from adm_families where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- النموذج العام (بلا تسجيل دخول) ----------
create or replace function public.adm_public_info() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('open', (private.adm_cfg() ->> 'public_open')::boolean,
    'school', (select value #>> '{}' from app_settings where key = 'school_name'), 'years', private.adm_cfg() -> 'years',
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar) order by se.sort, st.sort, g.number), '[]')
                 from grades g join stages st on st.id = g.stage_id join sections se on se.id = st.section_id))
$$;

create or replace function public.adm_public_submit(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare fid bigint; ph text := regexp_replace(coalesce(p ->> 'phone', ''), '[^0-9+]', '', 'g'); ch jsonb; n int := 0; src text;
begin
  if not (private.adm_cfg() ->> 'public_open')::boolean then raise exception 'استقبال الطلبات مغلق حاليًا'; end if;
  if coalesce(p ->> 'website', '') <> '' then return jsonb_build_object('ok', true); end if;           -- مصيدة الروبوتات
  if length(btrim(coalesce(p ->> 'guardian_name', ''))) not between 3 and 80 then raise exception 'اكتب اسم ولي الأمر'; end if;
  if length(regexp_replace(ph, '\D', '', 'g')) not between 9 and 14 then raise exception 'رقم الجوال غير صحيح'; end if;
  if jsonb_typeof(p -> 'children') <> 'array' or jsonb_array_length(p -> 'children') not between 1 and 6 then raise exception 'أضف ابنًا واحدًا على الأقل'; end if;
  -- منع التكرار: نفس الجوال خلال 10 دقائق، وحد أقصى عام 60 طلبًا في الساعة
  if exists (select 1 from adm_families where regexp_replace(phone, '\D', '', 'g') = regexp_replace(ph, '\D', '', 'g') and public_form and created_at > now() - interval '10 minutes') then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from adm_families where public_form and created_at > now() - interval '1 hour') >= 60 then raise exception 'ضغط كبير على النموذج — حاول بعد قليل'; end if;
  src := case when p ->> 'source' in ('social','mall','call','walkin','referral','website','event','other') then p ->> 'source' else 'website' end;
  insert into adm_families(guardian_name, relation, phone, email, district, source, source_detail, notes, public_form)
  values (left(btrim(p ->> 'guardian_name'), 80), left(nullif(btrim(p ->> 'relation'), ''), 30), left(ph, 20), left(nullif(lower(btrim(p ->> 'email')), ''), 120),
          left(nullif(btrim(p ->> 'district'), ''), 60), src, left(nullif(btrim(p ->> 'campaign'), ''), 80), left(nullif(btrim(p ->> 'notes'), ''), 1000), true)
  returning id into fid;
  for ch in select * from jsonb_array_elements(p -> 'children') loop
    continue when length(btrim(coalesce(ch ->> 'name', ''))) < 2;
    insert into adm_applicants(family_id, name, gender, birth_date, current_school, grade_id, year_name, stage)
    values (fid, left(btrim(ch ->> 'name'), 80), case when ch ->> 'gender' = 'f' then 'f' else 'm' end,
            case when ch ->> 'birth_date' ~ '^\d{4}-\d{2}-\d{2}$' then (ch ->> 'birth_date')::date end, left(nullif(btrim(ch ->> 'current_school'), ''), 80),
            (select id from grades where id = nullif(ch ->> 'grade_id', '')::int), left(nullif(btrim(p ->> 'year_name'), ''), 20), 'lead');
    n := n + 1;
  end loop;
  if n = 0 then delete from adm_families where id = fid; raise exception 'اكتب اسم الابن'; end if;
  insert into adm_log(family_id, kind, body) values (fid, 'system', 'طلب من النموذج الإلكتروني — ' || private.adm_source_label(src) || coalesce(' (' || nullif(btrim(p ->> 'campaign'), '') || ')', ''));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- المهام في الصفحة الرئيسية ----------
create or replace function private.adm_tasks() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text; out jsonb := '[]'::jsonb; n int; me uuid := public.me_id();
begin
  r := private.adm_role();
  if r is null then return out; end if;
  if r in ('manage','marketing') then
    select count(*) into n from adm_families f where not exists (select 1 from adm_log l where l.family_id = f.id and l.kind <> 'system')
       and exists (select 1 from adm_applicants a where a.family_id = f.id and a.stage in ('lead','inquiry')) and (f.owner_id is null or f.owner_id = me);
    if n > 0 then out := out || jsonb_build_object('icon', '📥', 'text', n || ' عميل جديد لم يُتواصل معه بعد', 'link', 'admissions.html#follow'); end if;
    select count(*) into n from adm_log l join adm_families f on f.id = l.family_id where l.next_at <= (now() at time zone 'Asia/Riyadh')::date and not l.done and (f.owner_id is null or f.owner_id = me);
    if n > 0 then out := out || jsonb_build_object('icon', '📞', 'text', n || ' متابعة عميل مستحقة اليوم', 'link', 'admissions.html#follow'); end if;
  end if;
  select count(*) into n from adm_applicants a where a.stage = 'test' and (a.test_at at time zone 'Asia/Riyadh')::date <= (now() at time zone 'Asia/Riyadh')::date + 1
     and (a.tester_id = me or (r = 'manage' and a.tester_id is null) or (r = 'principal' and private.adm_sees(a)));
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' اختبار قبول اليوم أو غدًا أو بانتظار النتيجة', 'link', 'admissions.html#tests'); end if;
  return out;
end $$;

revoke all on function private.adm_role(), private.adm_sees(adm_applicants), private.adm_cfg(), private.adm_student_of(adm_applicants),
  private.adm_row(adm_applicants, boolean), private.adm_tasks() from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['adm_me()','adm_board(jsonb)','adm_family_get(bigint)','adm_family_save(jsonb)','adm_applicant_save(jsonb)','adm_stage(bigint, text, jsonb)',
    'adm_docs_set(bigint, jsonb)','adm_log_add(jsonb)','adm_followup_done(bigint)','adm_followups()','adm_tests()','adm_test_result(bigint, boolean, numeric, text)',
    'adm_stats(date, date)','adm_settings_set(jsonb)','adm_family_delete(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.adm_public_info(), public.adm_public_submit(jsonb) from public;
grant execute on function public.adm_public_info(), public.adm_public_submit(jsonb) to anon, authenticated;

-- المهام اليومية: نسخة 77 + التسجيل والقبول
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
  -- أحداث المدرسة اليوم
  select count(*) into n from sc_events e where current_date between e.start_date and coalesce(e.end_date, e.start_date) and (r = 'admin' or r = any (e.audience));
  if n > 0 then out := out || jsonb_build_object('icon', '📅', 'text', n || ' حدث في تقويم المدرسة اليوم', 'link', 'calendar.html'); end if;
  -- حصص انتظار مكلّف بها اليوم أو غدًا
  select count(*) into n from sub_assignments where sub_id = me and day between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '⏱️', 'text', n || ' حصة انتظار مكلّف بها اليوم أو غدًا', 'link', 'substitutes.html#mine'); end if;
  -- حصص انتظار لم تُسند بعد (للوكيل والإدارة)
  if private.sub_manager() then
    select count(*) into n from sub_assignments where status = 'open' and day between current_date and current_date + 1;
    if n > 0 then out := out || jsonb_build_object('icon', '🧩', 'text', n || ' حصة انتظار لم تُسند بعد', 'link', 'substitutes.html'); end if;
  end if;
  -- حالات إنذار مبكر مسندة إليّ
  select count(*) into n from ew_cases where owner_id = me and status <> 'closed';
  if n > 0 then out := out || jsonb_build_object('icon', '⚠️', 'text', n || ' حالة إنذار مبكر تتابعها', 'link', 'early-warning.html#mine'); end if;
  -- استبيانات بانتظار مشاركتي
  select count(*) into n from srv_surveys v where private.srv_for_me(v) and not exists (select 1 from srv_responses r where r.survey_id = v.id and r.profile_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' استبيان بانتظار مشاركتك', 'link', 'surveys.html'); end if;
  -- لقاءات أولياء أمور محجوزة اليوم أو غدًا
  select count(*) into n from mt_slots where teacher_id = me and status = 'booked' and (starts_at at time zone 'Asia/Riyadh')::date between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '🤝', 'text', n || ' لقاء ولي أمر محجوز اليوم أو غدًا', 'link', 'meetings.html'); end if;
  -- أسئلة طلاب بانتظار ردي
  select count(*) into n from ds_threads t where t.kind in ('question','private') and not t.answered and not t.hidden
     and exists (select 1 from teaching_assignments ta where ta.class_id = t.class_id and ta.subject_id = t.subject_id and ta.teacher_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '❓', 'text', n || ' سؤال من الطلاب بانتظار ردك', 'link', 'discussions.html'); end if;
  -- كتب مكتبة متأخرة عندي
  select count(*) into n from bk_loans where borrower_id = me and returned_at is null and due_on < current_date;
  if n > 0 then out := out || jsonb_build_object('icon', '📚', 'text', n || ' كتاب متأخر الإرجاع للمكتبة', 'link', 'books.html#my'); end if;
  -- لأمين المكتبة: الإعارات المتأخرة
  if private.bk_lib() then
    select count(*) into n from bk_loans where returned_at is null and due_on < current_date;
    if n > 0 then out := out || jsonb_build_object('icon', '⏰', 'text', n || ' إعارة متأخرة في المكتبة', 'link', 'books.html#late'); end if;
  end if;
  -- التسجيل والقبول (sql/79)
  out := out || private.adm_tasks();
  return out;
end $$;
