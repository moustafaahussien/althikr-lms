-- =====================================================================
-- 27) تقوية الأمان: مفتاح المنصة العام (anon / publishable) ظاهر في الكود — وهذا طبيعي —
--     فالحماية كلها في قاعدة البيانات. هذا الملف يضمن أن الزائر غير المسجّل لا يستطيع شيئًا:
--   1) RLS مفعّل على كل الجداول (يُفعَّل تلقائيًا لأي جدول ينقصه)
--   2) لا صلاحيات جداول لغير المسجّل إطلاقًا (حتى TRUNCATE/TRIGGER/REFERENCES)
--   3) لا يستطيع غير المسجّل تشغيل أي دالة (والدوال الجديدة مستقبلًا كذلك)
--   4) الدوال الداخلية لا يستدعيها أحد من المتصفح
--   5) السياسات المكتوبة لـ public تُقصر على المسجّلين
-- =====================================================================

-- 1) RLS على كل الجداول
do $$ declare t record; begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- 2) لا شيء لغير المسجّل على الجداول والعروض والتسلسلات
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, trigger, references on all tables in schema public from authenticated;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke truncate, trigger, references on tables from authenticated;

-- 3) الدوال: تُسحب من public (التي يرثها غير المسجّل) وتُعطى للمسجّلين فقط
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- 4) دوال داخلية (تُستدعى من دوال أخرى فقط)
revoke execute on function public._claim_timetable_profile(text, text) from authenticated;

-- 5) السياسات المكتوبة لـ public ← للمسجّلين فقط
do $$ declare p record; begin
  for p in select tablename, policyname from pg_policies
           where schemaname = 'public' and roles @> array['public']::name[] loop
    execute format('alter policy %I on public.%I to authenticated', p.policyname, p.tablename);
  end loop;
end $$;

-- للفحص: يجب أن تكون كل النتائج صفرًا
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity) as tables_without_rls,
  (select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon') as anon_table_grants,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'EXECUTE')) as anon_functions,
  (select count(*) from pg_policies where schemaname = 'public' and (roles @> array['public']::name[] or roles @> array['anon']::name[])) as public_policies;
