-- ============================================================
-- 78) التحكم الكامل في بطاقات المنصة من لوحة الإدارة
-- لكل بطاقة: الحالة (مفتوح / تجريبي / مخفي) + لكل دور: يستخدمها، أو تظهر له مقفلة، أو لا تظهر.
-- التخزين في app_settings.beta_access:
--   {مفتاح_البطاقة: [أدوار الاستخدام], ..., "_cards": {مفتاح: {"status": "open|beta|hidden", "show": [أدوار الظهور]}}, "_locked": [...]}
-- ============================================================

create or replace function public.card_control_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; ck text; cv jsonb; out jsonb := '{}'::jsonb; cards jsonb := '{}'::jsonb; roles text[] := array['leadership','principal','supervisor','teacher','staff','student','parent'];
  clean_roles jsonb;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  if jsonb_typeof(p) <> 'object' then raise exception 'بيانات غير صالحة'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k = '_cards' and jsonb_typeof(v) = 'object' then
      for ck, cv in select * from jsonb_each(v) loop
        continue when ck !~ '^[a-z0-9_]{1,30}$' or jsonb_typeof(cv) <> 'object';
        select coalesce(jsonb_agg(distinct x), '[]'::jsonb) into clean_roles from jsonb_array_elements_text(case when jsonb_typeof(cv -> 'show') = 'array' then cv -> 'show' else '[]'::jsonb end) x where x = any (roles);
        cards := cards || jsonb_build_object(ck, jsonb_build_object(
          'status', case when cv ->> 'status' in ('open','beta','hidden') then cv ->> 'status' else 'open' end, 'show', clean_roles));
      end loop;
      continue;
    end if;
    if k = '_order' and jsonb_typeof(v) = 'array' then   -- ترتيب البطاقات في الصفحة الرئيسية
      out := out || jsonb_build_object('_order', (select coalesce(jsonb_agg(x order by i), '[]'::jsonb) from (
        select x, min(i) i from jsonb_array_elements_text(v) with ordinality t(x, i) where x ~ '^[a-z0-9_]{1,30}$' group by x) q));
      continue;
    end if;
    continue when k !~ '^_?[a-z0-9_]{1,30}$' or jsonb_typeof(v) <> 'array';
    out := out || jsonb_build_object(k, (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements_text(v) x where x = any (roles)));
  end loop;
  out := out || jsonb_build_object('_cards', cards);
  insert into app_settings(key, value) values ('beta_access', out) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.card_control_save(jsonb) from public, anon;
grant execute on function public.card_control_save(jsonb) to authenticated;

-- بوابة الخادم: البطاقة المخفية مغلقة لغير مدير النظام
create or replace function private.beta_ok(p_key text, p_default text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_role() = 'admin' or (
    coalesce((select v.value -> '_cards' -> p_key ->> 'status' from app_settings v where v.key = 'beta_access'), '') <> 'hidden'
    and coalesce(
      (select public.me_role()::text in (select jsonb_array_elements_text(v.value -> p_key))
         from app_settings v where v.key = 'beta_access' and jsonb_typeof(v.value -> p_key) = 'array'),
      public.me_role()::text = any (p_default), false))
$$;
revoke all on function private.beta_ok(text, text[]) from public, anon, authenticated;
