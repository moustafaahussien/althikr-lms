-- =====================================================================
-- 46: قسم إصدار الشهادات (للإداريين ومعهم مكتب الإشراف)
--   - شهادات شكر/تقدير/تفوق/حضور/مشاركة للطلاب أو المعلمين أو أي أسماء (من ملف Excel/Word أو يدويًا)
--   - نص الشهادة يُكتب بحرية مع حقول مثل {الاسم} و{الصف}، ويُحفظ نصها النهائي لكل شخص
--   - كل شهادة لها رقم تحقق فريد (DTC-سنة-رقم) ويُتحقق منها من صفحة الشهادة العامة
-- =====================================================================
create sequence if not exists public.certs_no_seq;
create table if not exists public.certs (
  id          bigserial primary key,
  batch_id    uuid not null,
  cert_no     text unique not null,
  kind        text not null default 'thanks',
  rtype       text not null default 'other' check (rtype in ('student','staff','other')),
  recipient   text not null check (btrim(recipient) <> ''),
  profile_id  uuid references public.profiles(id) on delete set null,
  title       text not null,
  data        jsonb not null default '{}'::jsonb,       -- النص النهائي والموقّعون والتاريخ — لإعادة الطباعة كما هي
  issued_by   uuid references public.profiles(id) on delete set null,
  issued_at   timestamptz not null default now(),
  revoked     boolean not null default false
);
create index if not exists certs_batch on public.certs(batch_id);
create index if not exists certs_profile on public.certs(profile_id);
alter table public.certs enable row level security;
revoke all on public.certs from anon, authenticated;

-- الإداريون: مدير النظام، القيادة، مدير المرحلة، الموظفون الإداريون، ومكتب الإشراف (المشرفون والأعضاء النشطون)
create or replace function private.is_admin_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.me_role() in ('admin','leadership','principal','staff','supervisor'), false)
      or exists (select 1 from supervision_members m where m.profile_id = public.me_id() and m.active)
$$;

-- الإعدادات الافتراضية للشهادة (اسم المدرسة والموقّعون)
create or replace function public.cert_defaults() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s jsonb;
begin
  if not private.is_admin_staff() then raise exception 'إصدار الشهادات للإداريين فقط'; end if;
  select jsonb_object_agg(key, value) into s from app_settings where key in ('school_name','cert_edu_title','cert_edu_name','cert_exec_title','cert_exec_name');
  return jsonb_build_object('school', coalesce(s->>'school_name', 'مدارس دار الذكر'),
    'sigs', jsonb_build_array(
      jsonb_build_object('t', coalesce(nullif(s->>'cert_edu_title',''), 'مدير التعليم'), 'n', coalesce(s->>'cert_edu_name','')),
      jsonb_build_object('t', coalesce(nullif(s->>'cert_exec_title',''), 'المدير التنفيذي'), 'n', coalesce(s->>'cert_exec_name',''))),
    'me', (select full_name from profiles where id = public.me_id()), 'job', (select job_title from profiles where id = public.me_id()));
end $$;

-- المعلمون والموظفون (للاختيار كمستلمين)
create or replace function public.cert_staff(p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := public.norm(nullif(btrim(coalesce(p_q,'')), ''));
begin
  if not private.is_admin_staff() then raise exception 'إصدار الشهادات للإداريين فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title, 'role', p.role) order by p.full_name)
    from (select * from profiles p where p.active and p.role not in ('student','parent')
            and (q is null or public.norm(p.full_name) like '%' || q || '%' or public.norm(coalesce(p.job_title,'')) like '%' || q || '%')
          order by p.full_name limit 300) p), '[]'::jsonb);
end $$;

-- إصدار دفعة: p = {kind, title, rtype?, items:[{name, profile_id?, rtype?, data:{...}}]}
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
    n := 'DTC-' || yr || '-' || lpad(nextval('certs_no_seq')::text, 5, '0');
    insert into certs(batch_id, cert_no, kind, rtype, recipient, profile_id, title, data, issued_by)
    values (b, n, coalesce(nullif(p->>'kind',''), 'thanks'),
            case when coalesce(it->>'rtype', p->>'rtype') in ('student','staff') then coalesce(it->>'rtype', p->>'rtype') else 'other' end,
            btrim(it->>'name'), case when it->>'profile_id' ~ '^[0-9a-f-]{36}$' and exists (select 1 from profiles where id = (it->>'profile_id')::uuid) then (it->>'profile_id')::uuid end,
            btrim(p->>'title'), coalesce(it->'data', '{}'::jsonb), public.me_id());
    out := out || to_jsonb(n); cnt := cnt + 1;
  end loop;
  return jsonb_build_object('batch', b, 'count', cnt, 'numbers', out);
end $$;

-- سجل الدفعات
create or replace function public.cert_batches(p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare allv boolean := public.me_role() in ('admin','leadership');
begin
  if not private.is_admin_staff() then raise exception 'إصدار الشهادات للإداريين فقط'; end if;
  return coalesce((select jsonb_agg(x order by x->>'at' desc) from (
      select jsonb_build_object('batch', c.batch_id, 'title', min(c.title), 'kind', min(c.kind), 'count', count(*), 'at', min(c.issued_at),
             'by', (select full_name from profiles where id = min(c.issued_by::text)::uuid), 'first', min(c.recipient), 'mine', bool_or(c.issued_by = public.me_id())) x
        from certs c where allv or c.issued_by = public.me_id() group by c.batch_id order by min(c.issued_at) desc limit least(greatest(p_limit,1), 200)) z), '[]'::jsonb);
end $$;

-- شهادات دفعة (لإعادة الطباعة)
create or replace function public.cert_batch(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not private.is_admin_staff() then raise exception 'إصدار الشهادات للإداريين فقط'; end if;
  if not (public.me_role() in ('admin','leadership') or exists (select 1 from certs where batch_id = p_batch and issued_by = public.me_id())) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('no', cert_no, 'name', recipient, 'title', title, 'kind', kind, 'data', data, 'at', issued_at) order by id)
    from certs where batch_id = p_batch), '[]'::jsonb);
end $$;

-- التحقق العام من الشهادة برقمها
create or replace function public.cert_verify(p_no text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('valid', true, 'name', recipient, 'title', title, 'issued_at', issued_at)
                     from certs where cert_no = upper(btrim(p_no)) and not revoked), jsonb_build_object('valid', false))
$$;

revoke all on function private.is_admin_staff() from public, anon, authenticated;
revoke all on function public.cert_defaults(), public.cert_staff(text), public.cert_issue(jsonb), public.cert_batches(int), public.cert_batch(uuid) from public, anon;
grant execute on function public.cert_defaults(), public.cert_staff(text), public.cert_issue(jsonb), public.cert_batches(int), public.cert_batch(uuid) to authenticated;
revoke all on function public.cert_verify(text) from public;
grant execute on function public.cert_verify(text) to anon, authenticated;
