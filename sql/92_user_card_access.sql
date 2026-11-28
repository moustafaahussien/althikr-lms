-- ============================================================
-- 92) صلاحيات البطاقات لكل موظف بشكل فردي
--   profiles.card_access = {مفتاح البطاقة: use | show | none}
--     use  = تظهر ويستخدمها   · show = تظهر مقفلة 🔒   · none = لا تظهر
--   البطاقة اللي مالهاش قيمة للموظف = حسب دوره (زي ما هو في الإعدادات). الإعداد الفردي يغلب إعداد الدور.
--   الكتابة لمدير النظام فقط (سياسة admin_profiles الموجودة)، و my_context بيرجّعها داخل profile.
-- ============================================================
alter table public.profiles add column if not exists card_access jsonb not null default '{}'::jsonb;

create or replace function private.beta_ok(p_key text, p_default text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_role() = 'admin' or coalesce(
    (select case p.card_access ->> p_key when 'use' then true when 'show' then false when 'none' then false end
       from profiles p where p.id = public.me_id()),
    coalesce((select v.value -> '_cards' -> p_key ->> 'status' from app_settings v where v.key = 'beta_access'), '') <> 'hidden'
    and coalesce(
      (select public.me_role()::text in (select jsonb_array_elements_text(v.value -> p_key))
         from app_settings v where v.key = 'beta_access' and jsonb_typeof(v.value -> p_key) = 'array'),
      public.me_role()::text = any (p_default), false))
$$;
revoke all on function private.beta_ok(text, text[]) from public, anon, authenticated;
