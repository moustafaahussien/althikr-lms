-- =====================================================================
-- 45: مكتب الإشراف التربوي يرى دليل الطلاب + البحث يتجاهل التشكيل
--   - norm: كانت تتجاهل همزات الألف (أ إ آ ٱ = ا) والياء/الألف المقصورة (ى = ي) والتاء المربوطة؛ أُضيف حذف التشكيل
--   - sd_stages: المشرفون وأعضاء مكتب الإشراف النشطون يرون كل الطلاب
-- =====================================================================
create or replace function public.norm(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(
           translate(regexp_replace(lower(btrim(coalesce(t,''))), '[ً-ْٰ]', '', 'g'),
                     'أإآٱةى٠١٢٣٤٥٦٧٨٩ـ',
                     'ااااهي0123456789'),
           '\s+', ' ', 'g'), '')
$$;

create or replace function private.sd_stages() returns int[]
language sql stable security definer set search_path = public as $$
  select case when public.me_role() in ('admin','leadership','staff','supervisor')
                or exists (select 1 from supervision_members m where m.profile_id = public.me_id() and m.active)
              then (select array_agg(id) from stages)
              when public.me_role() = 'principal' then private.my_stage_ids()
              else '{}'::int[] end
$$;
revoke all on function private.sd_stages() from public, anon, authenticated;
