-- =====================================================================
-- 49) التحكم في الدخول من لوحة الإدارة
--   • teacher_login_enabled: السماح للمعلمين بالدخول (افتراضيًا مسموح)
--   • all_login_enabled:     السماح لكل المستخدمين بالدخول (إيقافه = وضع الصيانة؛ مدير النظام يدخل دائمًا)
--   • beta_access:           الوحدات التجريبية ومن يفتحها من الأدوار {مفتاح_الوحدة: [أدوار]}
--     (الوحدة غير المذكورة تبقى لأدوارها الافتراضية في config.js، ومدير النظام يفتح كل شيء دائمًا)
-- =====================================================================

insert into public.app_settings(key, value) values ('teacher_login_enabled', 'true'::jsonb) on conflict (key) do nothing;
insert into public.app_settings(key, value) values ('all_login_enabled', 'true'::jsonb) on conflict (key) do nothing;
insert into public.app_settings(key, value) values ('beta_access', '{}'::jsonb) on conflict (key) do nothing;

create or replace function public.setting_on(p_key text, p_default boolean default true) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = p_key), p_default)
$$;

-- المستخدم الحالي (نفس الملف 21 + المعلمون + الكل)
create or replace function public.me_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.email = public.jwt_email() and p.active
    and (public.email_domain_ok(p.email) or (p.role = 'parent' and public.parent_login_enabled()))
    and (p.role <> 'student' or public.student_login_enabled())
    and (p.role <> 'parent' or public.parent_login_enabled())
    and (p.role <> 'teacher' or public.setting_on('teacher_login_enabled'))
    and (p.role = 'admin' or public.setting_on('all_login_enabled'))
$$;

-- سياق المستخدم: نفس الملف 21 + سبب المنع للمعلم/الجميع + إعدادات الوحدات التجريبية
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); res jsonb; r text;
begin
  if me is null then
    select role::text into r from profiles where email = public.jwt_email() and active limit 1;
    return jsonb_build_object('registered', false, 'email', public.jwt_email(),
      'domain_ok', public.email_domain_ok(public.jwt_email())
                   or exists (select 1 from profiles where email = public.jwt_email() and role = 'parent' and active),
      'all_closed', r is not null and r <> 'admin' and not public.setting_on('all_login_enabled'),
      'teachers_closed', r = 'teacher' and not public.setting_on('teacher_login_enabled'),
      'students_closed', r = 'student' and not public.student_login_enabled(),
      'parents_closed',  r = 'parent' and not public.parent_login_enabled());
  end if;
  select jsonb_build_object(
    'registered', true,
    'profile', to_jsonb(p) - 'created_at' - 'updated_at',
    'school_name', (select value #>> '{}' from app_settings where key = 'school_name'),
    'beta', coalesce((select value from app_settings where key = 'beta_access'), '{}'::jsonb),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', se.name_ar, 'stage', st.name_ar, 'subject', su.name_ar,
        'grade_min', sc.grade_min, 'grade_max', sc.grade_max, 'note', sc.note))
      from staff_scopes sc
      left join sections se on se.id = sc.section_id
      left join stages st   on st.id = sc.stage_id
      left join subjects su on su.id = sc.subject_id
      where sc.profile_id = me), '[]'::jsonb),
    'student', (
      select jsonb_build_object('id', s.profile_id, 'student_number', s.student_number, 'class_id', s.class_id, 'grade_id', s.grade_id,
                                'class_label', coalesce(vs.label, g.name_ar || ' — ' || stg.name_ar), 'section', vs.section_name)
      from students s left join v_students vs on vs.profile_id = s.profile_id
      left join grades g on g.id = s.grade_id left join stages stg on stg.id = g.stage_id
      where s.profile_id = me),
    'children', (select jsonb_agg(pl.student_id) from parent_links pl where pl.parent_id = me),
    'term', (select jsonb_build_object('year', y.name, 'term', t.name)
             from terms t join academic_years y on y.id = t.year_id where t.is_current limit 1)
  ) into res
  from profiles p where p.id = me;
  return res;
end $$;

-- ولي الأمر من حساب ابنه: يُمنع أيضًا عند إيقاف دخول الجميع
create or replace function private.gd_login_student() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p join students s on s.profile_id = p.id
  where p.email = public.jwt_email() and p.active and p.role = 'student' and public.email_domain_ok(p.email)
    and public.setting_on('all_login_enabled')
$$;

-- قراءة الإعدادات الجديدة للمسجّلين (السياسة من الملف 29 + المفاتيح الجديدة)
drop policy if exists read_settings on public.app_settings;
create policy read_settings on public.app_settings for select to authenticated
  using (public.me_id() is not null
         and key in ('allowed_domains', 'school_name', 'student_login_enabled', 'parent_login_enabled',
                     'teacher_login_enabled', 'all_login_enabled', 'beta_access'));

-- حفظ إعدادات الوحدات التجريبية (مدير النظام)
create or replace function public.beta_access_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; out jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k !~ '^[a-z0-9_]{1,30}$' or jsonb_typeof(v) <> 'array' then continue; end if;
    out := out || jsonb_build_object(k, (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v) x
             where x in ('leadership','principal','supervisor','teacher','staff','student','parent')));
  end loop;
  insert into app_settings(key, value) values ('beta_access', out) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true, 'beta', out);
end $$;

revoke all on function public.setting_on(text, boolean) from public, anon;
grant execute on function public.setting_on(text, boolean) to authenticated, service_role;
revoke all on function public.beta_access_save(jsonb) from public, anon;
grant execute on function public.beta_access_save(jsonb) to authenticated;
