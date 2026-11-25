-- =====================================================================
-- 52: حجز المرافق — نفس نظام المختبرات (sql/50) لمرافق المدرسة العامة
--   labs.kind: lab (مختبر) | facility (مرفق: مصادر التعلم، المسرح، الصالة…)
--   مدير النظام يضيف المرافق ويعدّلها، ويعيّن لكل مرفق مسؤولًا من تبويب الطاقم
-- =====================================================================
alter table public.labs add column if not exists kind text not null default 'lab';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'labs_kind_chk') then
    alter table public.labs add constraint labs_kind_chk check (kind in ('lab','facility'));
  end if;
end $$;

insert into public.labs(code, name, icon, sort, kind) values
  ('lrc', 'مركز مصادر التعلم', '📚', 10, 'facility'),
  ('theater', 'المسرح', '🎭', 11, 'facility'),
  ('gym', 'الصالة الرياضية', '⚽', 12, 'facility'),
  ('meeting', 'قاعة الاجتماعات', '🗣️', 13, 'facility'),
  ('computer', 'معمل الحاسب', '💻', 14, 'facility')
on conflict (code) do nothing;

create or replace function public.lab_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'لمنسوبي المدرسة فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'code', l.code, 'name', l.name, 'icon', l.icon, 'kind', l.kind, 'sort', l.sort,
      'my_role', private.lab_role(l.id),
      'alerts', case when private.lab_role(l.id) is not null then jsonb_array_length(private.lab_alerts_of(l.id)) else 0 end) order by l.sort, l.id)
    from labs l where l.active), '[]'::jsonb);
end $$;

-- إضافة/تعديل مرفق أو مختبر (مدير النظام)
create or replace function public.lab_upsert(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c text := nullif(btrim(coalesce(p->>'code','')), ''); nm text := btrim(coalesce(p->>'name',''));
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  if nm = '' then raise exception 'اكتب اسم المرفق'; end if;
  if c is null then
    c := 'f' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    insert into labs(code, name, icon, sort, kind) values (c, left(nm, 80), coalesce(nullif(left(btrim(p->>'icon'), 4), ''), '🏫'),
      coalesce(nullif(p->>'sort','')::int, (select coalesce(max(sort), 0) + 1 from labs)), case when p->>'kind' = 'lab' then 'lab' else 'facility' end);
  else
    update labs set name = left(nm, 80), icon = coalesce(nullif(left(btrim(p->>'icon'), 4), ''), icon), sort = coalesce(nullif(p->>'sort','')::int, sort),
           active = coalesce((p->>'active')::boolean, active) where code = c;
    if not found then raise exception 'غير موجود'; end if;
  end if;
  return jsonb_build_object('ok', true, 'code', c);
end $$;

revoke all on function public.lab_list(), public.lab_upsert(jsonb) from public, anon;
grant execute on function public.lab_list(), public.lab_upsert(jsonb) to authenticated;
