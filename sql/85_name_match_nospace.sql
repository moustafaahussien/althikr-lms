-- ============================================================
-- 85) البحث بالأسماء: تجاهل كل المسافات داخل الاسم المخزَّن (لكل الأسماء المركبة: منة الله، سعد الدين، غرم الله، صفي الدين، عبد الرحمن…)
--     مع إبقاء كلمات البحث منفصلة حتى يبقى البحث بأجزاء الاسم وبأي ترتيب يعمل.
--     «منة الله» = «منةالله» · «سعدالدين» يجد «سعد الدين» · «محمد الشهاوي» يجد «محمد جميل طارق الشهاوي»
-- ============================================================
create or replace function public.name_match(p_hay text, p_q text) returns boolean
language sql immutable as $$
  select coalesce((select bool_and(position(w in replace(coalesce(public.norm(p_hay), ''), ' ', '')) > 0)
                     from unnest(string_to_array(public.norm(p_q), ' ')) w where w <> ''), true)
$$;
