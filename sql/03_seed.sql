-- =====================================================================
--  الملف 3 من 3: البيانات الأولية (الأقسام والمراحل والصفوف + حساب مدير النظام)
--  ⚠️ قبل التشغيل: غيّر البريد في السطر الأخير إلى بريدك المدرسي
-- =====================================================================

insert into public.sections(id, code, name_ar, name_en, sort) values
  (1, 'boys',     'بنين',             'Boys',              1),
  (2, 'girls',    'بنات',             'Girls',             2),
  (3, 'american', 'الدبلوم الأمريكي', 'American Diploma',  3)
on conflict (id) do nothing;

insert into public.stages(section_id, code, name_ar, sort) values
  (1, 'boys-primary',      'ابتدائي بنين',     1),
  (1, 'boys-intermediate', 'متوسط بنين',       2),
  (1, 'boys-secondary',    'ثانوي بنين',       3),
  (2, 'girls-primary',     'ابتدائي بنات',     4),
  (3, 'american',          'الدبلوم الأمريكي', 5)
on conflict (code) do nothing;

-- أسماء الصفوف
with ord(n, name) as (values
  (1,'الأول'),(2,'الثاني'),(3,'الثالث'),(4,'الرابع'),(5,'الخامس'),(6,'السادس'))
insert into public.grades(stage_id, number, name_ar)
select st.id, o.n, 'الصف ' || o.name
from public.stages st
join ord o on (st.code in ('boys-primary','girls-primary') and o.n between 1 and 6)
           or (st.code in ('boys-intermediate','boys-secondary') and o.n between 1 and 3)
on conflict (stage_id, number) do nothing;

insert into public.grades(stage_id, number, name_ar)
select st.id, g, 'Grade ' || g
from public.stages st, generate_series(4, 12) g
where st.code = 'american'
on conflict (stage_id, number) do nothing;

-- العام الدراسي والفصل الحالي
insert into public.academic_years(name, is_current) values ('1448هـ', true)
on conflict (name) do nothing;
insert into public.terms(year_id, name, is_current)
select id, 'الفصل الدراسي الأول', true from public.academic_years where name = '1448هـ'
on conflict (year_id, name) do nothing;

-- ⚠️ حساب مدير النظام الأول — ضع بريدك المدرسي واسمك
insert into public.profiles(email, full_name, role, job_title)
values (lower('m.hussien@althikr.edu.sa'), 'مصطفى أحمد حسين', 'admin', 'مشرف مهارات القرن 21')
on conflict (email) do update set role = 'admin', active = true;
