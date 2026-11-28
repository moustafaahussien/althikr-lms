-- ============================================================
-- 84) البحث الذكي بالأسماء في كل المنصة
--   • تجاهل المسافة في الأسماء المركبة: «عبد السلام» = «عبدالسلام» (وكذلك «أبو بكر» = «أبوبكر»)
--   • تجاهل همزات الألف: أ = إ = آ = ا — ونقاط الياء الأخيرة: ى = ي — والتاء المربوطة: ة = ه — والتشكيل والتطويل
--   • البحث بأي أجزاء من الاسم وبأي ترتيب: «محمد الشهاوي» يجد «محمد جميل طارق الشهاوي»
-- ============================================================

create or replace function public.norm(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(
           regexp_replace(
             translate(regexp_replace(lower(btrim(coalesce(t,''))), '[ً-ْٰ]', '', 'g'),
                       'أإآٱةى٠١٢٣٤٥٦٧٨٩ـ',
                       'ااااهي0123456789'),
             '\s+', ' ', 'g'),
           '(^| )(عبد|ابو) ', '\1\2', 'g'), '')
$$;

-- كل كلمة من البحث موجودة في النص (بأي ترتيب)
create or replace function public.name_match(p_hay text, p_q text) returns boolean
language sql immutable as $$
  select coalesce((select bool_and(position(w in coalesce(public.norm(p_hay), '')) > 0)
                     from unnest(string_to_array(public.norm(p_q), ' ')) w where w <> ''), true)
$$;
grant execute on function public.name_match(text, text) to anon, authenticated;

-- تحويل كل دوال البحث القائمة إلى البحث الذكي (من تعريفها الحالي في قاعدة البيانات)
do $$
declare f record; def text; nd text; n int := 0;
begin
  for f in select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public','private') and p.prokind = 'f'
              and (p.prosrc ~ $r$norm\(.*like '%' \|\|$r$ or p.prosrc ~ $r$full_name ilike '%' \|\| btrim\(p_q\)$r$) loop
    def := pg_get_functiondef(f.oid);
    nd := regexp_replace(def,
      $r$public\.norm\(((?:[^()]|\([^()]*\))*)\) like '%' \|\| (q|public\.norm\(p_q\)|public\.norm\(p ->> 'q'\)) \|\| '%'$r$,
      'public.name_match(\1, \2)', 'g');
    nd := regexp_replace(nd, $r$p\.full_name ilike '%' \|\| btrim\(p_q\) \|\| '%'$r$, 'public.name_match(p.full_name, p_q)', 'g');
    if nd <> def then execute nd; n := n + 1; end if;
  end loop;
  raise notice 'حُوّلت % دالة بحث', n;
end $$;
