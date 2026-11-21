-- =====================================================================
--  الملف 11: توقيت مستقل للصفوف الأولية (ابتدائي 1–3)
--  يبدأ بنفس توقيت الصفوف العليا، ويعدّله مدير المرحلة من «إعدادات المدرسة».
-- =====================================================================
insert into public.period_profiles(key, name, sort) values ('prl', 'ابتدائي (الصفوف الأولية)', 0)
on conflict (key) do update set name = excluded.name, sort = excluded.sort;
insert into public.period_profile_stages(profile, stage_id)
select 'prl', id from public.stages where code in ('boys-primary','girls-primary')
on conflict do nothing;
insert into public.school_periods(profile, period, start_t, end_t)
select 'prl', period, start_t, end_t from public.school_periods where profile = 'pri'
on conflict (profile, period) do nothing;
