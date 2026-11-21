-- =====================================================================
--  الملف 14: «التعليم عن بعد» داخل المنصة — جداوله الخاصة
--  كل ورقة من جدول Google القديم أصبحت جدولًا هنا (صف لكل سطر):
--  الروابط، الجدول، حصص بالتاريخ، التوقيت، المشرفون، رموز المشرفين، مشرفو المواد،
--  المواد، رموز المعلمين، الحسابات، سجل الدخول، التقارير اليومية …
--  يقرؤها ويكتبها خادم الصفحة (Edge Function «online») فقط، والإدارة تعدّلها من «إعدادات المدرسة».
-- =====================================================================

create table if not exists public.ol_rows (
  id    bigserial primary key,
  sheet text  not null,
  cells jsonb not null          -- مصفوفة نصوص (السطر الأول في كل ورقة = العناوين)
);
create index if not exists ol_rows_sheet on public.ol_rows(sheet, id);

create table if not exists public.ol_meta (      -- إصدار كل ورقة (لتحديث النسخ المؤقتة في الخادم)
  sheet      text primary key,
  ver        bigint not null default 1,
  updated_at timestamptz not null default now()
);
create table if not exists public.ol_props (     -- إعدادات الخادم (الإيقاف، المفتاح السري …)
  key   text primary key,
  value text
);
create table if not exists public.ol_meet (      -- سجل Google Meet اليومي (يصل من الجسر)
  day  date primary key,
  recs jsonb not null,
  at   timestamptz not null default now()
);

alter table public.ol_rows  enable row level security;
alter table public.ol_meta  enable row level security;
alter table public.ol_props enable row level security;
alter table public.ol_meet  enable row level security;
-- بلا سياسات: لا قراءة ولا كتابة من المتصفح مباشرة (الخادم يعمل بمفتاح الخدمة)
grant select, insert, update, delete on public.ol_rows, public.ol_meta, public.ol_props, public.ol_meet to service_role;
grant usage, select on sequence public.ol_rows_id_seq to service_role;

-- استبدال ورقة كاملة
create or replace function public.ol_put_sheet(p_sheet text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from ol_rows where sheet = p_sheet;
  insert into ol_rows(sheet, cells)
  select p_sheet, r from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality t(r, n) order by n;
  insert into ol_meta(sheet, ver) values (p_sheet, 1)
  on conflict (sheet) do update set ver = ol_meta.ver + 1, updated_at = now();
end $$;

-- إضافة سطور في آخر الورقة
create or replace function public.ol_append(p_sheet text, p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into ol_rows(sheet, cells)
  select p_sheet, r from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality t(r, n) order by n;
  insert into ol_meta(sheet, ver) values (p_sheet, 1)
  on conflict (sheet) do update set ver = ol_meta.ver + 1, updated_at = now();
end $$;

revoke all on function public.ol_put_sheet(text, jsonb) from public, anon, authenticated;
revoke all on function public.ol_append(text, jsonb) from public, anon, authenticated;
grant execute on function public.ol_put_sheet(text, jsonb) to service_role;
grant execute on function public.ol_append(text, jsonb) to service_role;

-- ---------- تعديل الأوراق من «إعدادات المدرسة» (مدير النظام والإدارة العليا) ----------
create or replace function public.ol_sheet_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_leader() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('sheet', m.sheet, 'rows', (select count(*) from ol_rows r where r.sheet = m.sheet),
                   'updated', m.updated_at) order by m.sheet) from ol_meta m), '[]'::jsonb);
end $$;
create or replace function public.ol_sheet_get(p_sheet text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_leader() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(cells order by id) from ol_rows where sheet = p_sheet), '[]'::jsonb);
end $$;
create or replace function public.ol_sheet_save(p_sheet text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_leader() then raise exception 'غير مصرح'; end if;
  if p_sheet in ('سجل الدخول') then raise exception 'هذه الورقة يكتبها النظام فقط'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1 then raise exception 'بيانات غير صالحة'; end if;
  perform public.ol_put_sheet(p_sheet, p_rows);
  return jsonb_build_object('ok', true, 'rows', jsonb_array_length(p_rows) - 1);
end $$;
revoke all on function public.ol_sheet_list() from public, anon;
revoke all on function public.ol_sheet_get(text) from public, anon;
revoke all on function public.ol_sheet_save(text, jsonb) from public, anon;
grant execute on function public.ol_sheet_list() to authenticated;
grant execute on function public.ol_sheet_get(text) to authenticated;
grant execute on function public.ol_sheet_save(text, jsonb) to authenticated;
