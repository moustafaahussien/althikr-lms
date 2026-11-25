-- =====================================================================
-- 62: قفل الوحدات التجريبية من قاعدة البيانات نفسها (وليس من الواجهة فقط) لوحدتي بيانات الطلاب الحساسة:
--   «دليل الطلاب» (students) و«أولياء الأمور» (guardians)
--   القاعدة: مدير النظام دائمًا؛ وإلا الأدوار المعلَّمة في «لوحة الإدارة ← الإعدادات ← الوحدات التجريبية»
--   وإن لم يُحفظ إعداد للوحدة بعد ← الأدوار الافتراضية
-- =====================================================================
create or replace function private.beta_ok(p_key text, p_default text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_role() = 'admin' or coalesce(
    (select public.me_role()::text in (select jsonb_array_elements_text(v.value -> p_key))
       from app_settings v where v.key = 'beta_access' and jsonb_typeof(v.value -> p_key) = 'array'),
    public.me_role()::text = any (p_default), false)
$$;

-- دليل الطلاب: نفس نطاق المراحل السابق، ويُغلق بالكامل لمن ليس له صلاحية الوحدة
create or replace function private.sd_stages() returns int[]
language sql stable security definer set search_path = public, private as $$
  select case when not private.beta_ok('students', array['leadership','principal','supervisor','staff']) then '{}'::int[]
              when public.me_role() in ('admin','leadership','staff','supervisor')
                or exists (select 1 from supervision_members m where m.profile_id = public.me_id() and m.active)
              then (select array_agg(id) from stages)
              when public.me_role() = 'principal' then private.my_stage_ids()
              else '{}'::int[] end
$$;

-- أولياء الأمور
create or replace function private.gd_can_manage() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(public.me_role()::text in ('admin','leadership','principal'), false) and private.beta_ok('guardians', array['leadership','principal'])
$$;

revoke all on function private.beta_ok(text, text[]), private.sd_stages(), private.gd_can_manage() from public, anon, authenticated;
