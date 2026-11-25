-- =====================================================================
-- 48) أرقام الشهادات غير قابلة للتخمين
--   صفحة التحقق من الشهادات عامة (لأي زائر بدون دخول) — والأرقام كانت متسلسلة (DTC-2026-00001، 00002…)
--   فكان أي شخص يستطيع تجربة الأرقام بالتتابع ومعرفة أسماء الحاصلين (ومنهم طلاب) وعناوين شهاداتهم.
--   الآن يُضاف لكل رقم جديد 4 خانات عشوائية (مثل DTC-2026-00001-K7QM)، والتحقق يحتاج الرقم كاملًا.
--   (لم تصدر أي شهادة قبل هذا التعديل، فلا يتأثر شيء مطبوع.)
-- =====================================================================
create schema if not exists private;
create or replace function private.rand_code(n int) returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, n)
$$;
revoke all on function private.rand_code(int) from public, anon, authenticated;

-- شهادات الإداريين ومكتب الإشراف (من sql/46 مع الإضافة العشوائية)
create or replace function public.cert_issue(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b uuid := gen_random_uuid(); it jsonb; n text; out jsonb := '[]'::jsonb; cnt int := 0; yr text := to_char(now() at time zone 'Asia/Riyadh', 'YYYY');
begin
  if not private.is_admin_staff() then raise exception 'إصدار الشهادات للإداريين فقط'; end if;
  if btrim(coalesce(p->>'title','')) = '' then raise exception 'اكتب عنوان الشهادة'; end if;
  if jsonb_typeof(p->'items') <> 'array' or jsonb_array_length(p->'items') = 0 then raise exception 'أضف أسماء المستلمين'; end if;
  if jsonb_array_length(p->'items') > 2000 then raise exception 'الحد الأقصى 2000 شهادة في الدفعة الواحدة'; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if btrim(coalesce(it->>'name','')) = '' then continue; end if;
    n := 'DTC-' || yr || '-' || lpad(nextval('certs_no_seq')::text, 5, '0') || '-' || private.rand_code(4);
    insert into certs(batch_id, cert_no, kind, rtype, recipient, profile_id, title, data, issued_by)
    values (b, n, coalesce(nullif(p->>'kind',''), 'thanks'),
            case when coalesce(it->>'rtype', p->>'rtype') in ('student','staff') then coalesce(it->>'rtype', p->>'rtype') else 'other' end,
            btrim(it->>'name'), case when it->>'profile_id' ~ '^[0-9a-f-]{36}$' and exists (select 1 from profiles where id = (it->>'profile_id')::uuid) then (it->>'profile_id')::uuid end,
            btrim(p->>'title'), coalesce(it->'data', '{}'::jsonb), public.me_id());
    out := out || to_jsonb(n); cnt := cnt + 1;
  end loop;
  return jsonb_build_object('batch', b, 'count', cnt, 'numbers', out);
end $$;

-- شهادات التدريب (من sql/43 مع الإضافة العشوائية)
create or replace function private.trn_issue(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  update trainings set cert_no = coalesce(cert_no, 'DTH-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(id::text, 5, '0') || '-' || private.rand_code(4)),
         cert_issued_at = coalesce(cert_issued_at, now()), cert_issued_by = coalesce(cert_issued_by, public.me_id())
   where id = p_id returning cert_no into n;
  return n;
end $$;
