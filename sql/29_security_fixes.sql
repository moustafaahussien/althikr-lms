-- =====================================================================
-- 29) إصلاحات أمنية من فحص الصلاحيات (تشغيل كل دالة بهوية طالب / ولي أمر / معلم / حساب خارجي)
--   1) sv_import: الشرط «not in» مع قيمة null كان يُعدّ مسموحًا ← أي حساب مسجّل (حتى غير المسجّل في المدرسة)
--      كان يستطيع استيراد أعضاء وبيانات ورسائل مكتب الإشراف. الآن لمدير النظام فقط.
--   2) الملف 27 أعاد صلاحية التشغيل لكل الدوال، ومنها دوال داخلية كانت مقفولة عمدًا
--      (_student_email_fill يغيّر بريد حساب، _get_class ينشئ فصولًا…) ← تُقفل كل الدوال التي تبدأ بـ _
--   3) جدول الإعدادات: غير المدير يقرأ الإعدادات العامة فقط (كان يقرأ ملح رموز أولياء الأمور gd_salt)
--   4) الطالب لا يقرأ ملفات زملائه من جدول الحسابات (كان يظهر بريدهم = رقم الهوية)؛ لا تستخدمه أي صفحة
--   تشغيل الملف مرة ثانية آمن.
-- =====================================================================

-- 1) sv_import لمدير النظام / مالك مكتب الإشراف فقط
do $$ declare src text; begin
  select pg_get_functiondef('public.sv_import(jsonb)'::regprocedure) into src;
  src := replace(src, 'if private.sv_role(me) not in (''owner'',''sys'') then',
                      'if coalesce(private.sv_role(me), '''') not in (''owner'',''sys'') then');
  if src not like '%coalesce(private.sv_role(me), '''') not in%' then raise exception 'sv_import: لم يُعثر على الشرط المطلوب تعديله'; end if;
  execute src;
end $$;

-- 2) الدوال الداخلية (اسمها يبدأ بـ _) لا يستدعيها أحد من المتصفح
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' and p.proname like '\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;

-- 3) الإعدادات العامة فقط لغير المدير (المدير يقرأ الكل بسياسة admin_settings)
drop policy if exists read_settings on public.app_settings;
create policy read_settings on public.app_settings for select to authenticated
  using (public.me_id() is not null
         and key in ('allowed_domains', 'school_name', 'student_login_enabled', 'parent_login_enabled'));

-- 4) رؤية الحسابات: الطالب يرى نفسه والموظفين فقط
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
    return public.can_view_student(pid);   -- الموظف حسب نطاقه، وولي الأمر لأبنائه (الطالب: لا)
  end if;
  -- ولي الأمر: يراه الموظف الذي يرى أحد أبنائه
  return r not in ('student','parent') and exists (
    select 1 from parent_links pl where pl.parent_id = pid and public.can_view_student(pl.student_id));
end $$;

-- للفحص: يجب أن تكون النتائج كلها صفرًا
select
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like '\_%' and has_function_privilege('authenticated', p.oid, 'EXECUTE')) as internal_fns_open,
  (select count(*) from pg_proc where proname = 'sv_import' and pg_get_functiondef(oid) not like '%coalesce(private.sv_role(me)%') as sv_import_unfixed;
