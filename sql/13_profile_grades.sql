-- =====================================================================
--  الملف 13: صلاحية تعديل التوقيت حسب الصفوف أيضًا (وكيل الصفوف الأولية يعدّل توقيت 1–3 فقط ...)
-- =====================================================================
alter table public.period_profile_stages add column if not exists grade_min smallint;
alter table public.period_profile_stages add column if not exists grade_max smallint;
update public.period_profile_stages set grade_min = 1, grade_max = 3  where profile = 'prl';
update public.period_profile_stages set grade_min = 4, grade_max = 6  where profile = 'pri';
update public.period_profile_stages set grade_min = 4, grade_max = 6  where profile = 'amp';
update public.period_profile_stages set grade_min = 7, grade_max = 12 where profile = 'amm';

create or replace function private.can_edit_profile(p text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when public.me_role() in ('admin','leadership') then true
    when public.me_role() <> 'principal' then false
    else exists (
      select 1 from period_profile_stages ps
      join stages st on st.id = ps.stage_id
      join staff_scopes sc on sc.profile_id = public.me_id()
       and (sc.stage_id = st.id or (sc.stage_id is null and (sc.section_id = st.section_id or sc.section_id is null)))
      where ps.profile = p
        and coalesce(sc.grade_min, 0)  <= coalesce(ps.grade_max, 99)
        and coalesce(sc.grade_max, 99) >= coalesce(ps.grade_min, 0))
  end
$$;
