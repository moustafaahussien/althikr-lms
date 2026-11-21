-- =====================================================================
-- 24) المعلم الذكي — معرض منتجات المعلمين ونجم الشهر (بديل خادم Apps Script)
--     الصفحة داخل المنصة: ai/  — للموظفين فقط بحساب المدرسة
--     كل الإجراءات عبر دالة واحدة ai_call(action, p) بنفس أسماء وأشكال الخادم القديم
-- =====================================================================

create table if not exists public.ai_products (
  id             text primary key,
  status         text not null default 'pending' check (status in ('pending','approved','rejected')),
  featured       boolean not null default false,
  verified       boolean not null default false,
  owner_id       uuid references public.profiles(id) on delete set null,
  edit_hash      text,
  d              jsonb not null default '{}'::jsonb,   -- بيانات المنتج + الملفات (coverId, fileId, imageIds ...)
  app_html       text,                                 -- تطبيق HTML المرفوع
  draft          jsonb,                                -- تعديل منتج منشور بانتظار الاعتماد
  draft_app_html text,
  views          int not null default 0,
  likes          int not null default 0,
  ratings        jsonb,                                -- {s:{content:..}, n}
  admin_note     text not null default '',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists ai_products_status on public.ai_products(status);
create index if not exists ai_products_owner on public.ai_products(owner_id);

create table if not exists public.ai_settings (k text primary key, v jsonb);
insert into public.ai_settings(k, v) values ('salt', to_jsonb(gen_random_uuid()::text)) on conflict do nothing;
insert into public.ai_settings(k, v) values ('star', '{"cur":null,"hist":[]}'::jsonb) on conflict do nothing;
insert into public.ai_settings(k, v) values ('notify', '""'::jsonb) on conflict do nothing;

alter table public.ai_products enable row level security;
alter table public.ai_settings enable row level security;
revoke all on public.ai_products, public.ai_settings from anon, authenticated;
grant all on public.ai_products, public.ai_settings to service_role;

-- مخزن ملفات المنتجات (قراءة عامة بالرابط مثل Drive سابقًا، والرفع للموظفين في مجلدهم)
insert into storage.buckets(id, name, public, file_size_limit)
values ('ai', 'ai', true, 10485760) on conflict (id) do update set public = true;
drop policy if exists "ai upload" on storage.objects;
create policy "ai upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'ai' and public.is_staff() and split_part(name, '/', 1) = 'u' and split_part(name, '/', 2) = public.me_id()::text);

-- ---------------------------------------------------------------------
create schema if not exists private;

create or replace function private.ai_str(v jsonb, k text, mx int) returns text
language sql immutable as $$ select left(btrim(coalesce(v->>k, '')), mx) $$;

create or replace function private.ai_arr(v jsonb, mxn int, mxl int) returns jsonb
language sql immutable as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select left(btrim(e), mxl) x from jsonb_array_elements_text(case when jsonb_typeof(v) = 'array' then v else '[]'::jsonb end) with ordinality t(e, i)
    where btrim(e) <> '' order by i limit mxn) s
$$;

create or replace function private.ai_url(s text) returns text
language plpgsql immutable as $$
begin
  s := left(btrim(coalesce(s, '')), 600);
  if s = '' then return ''; end if;
  if s !~* '^https?://[^\s]+$' then raise exception 'الرابط غير صحيح — يجب أن يبدأ بـ https://'; end if;
  return s;
end $$;

-- التحقق من بيانات المنتج (نفس قواعد الخادم القديم)
create or replace function private.ai_clean(x jsonb) returns jsonb
language plpgsql as $$
declare o jsonb; s text := private.ai_str(x, 'type', 10);
begin
  x := coalesce(x, '{}'::jsonb);
  o := jsonb_build_object(
    'teacher', private.ai_str(x,'teacher',80), 'email', private.ai_str(x,'email',120),
    'subject', private.ai_str(x,'subject',40), 'subjectOther', private.ai_str(x,'subjectOther',60),
    'stage', private.ai_str(x,'stage',30), 'grades', private.ai_str(x,'grades',60),
    'title', private.ai_str(x,'title',120), 'type', s,
    'tasks', private.ai_arr(x->'tasks', 11, 30), 'tools', private.ai_arr(x->'tools', 12, 40),
    'summary', private.ai_str(x,'summary',300), 'idea', private.ai_str(x,'idea',2000),
    'url', private.ai_url(x->>'url'), 'prompt', private.ai_str(x,'prompt',8000),
    'video', private.ai_url(x->>'video'),
    'buildSteps', private.ai_arr(x->'buildSteps', 20, 600), 'useSteps', private.ai_arr(x->'useSteps', 20, 600),
    'tips', private.ai_str(x,'tips',1500), 'goal', private.ai_str(x,'goal',300), 'skill', private.ai_str(x,'skill',120),
    'level', case when x->>'level' in ('b','m','a') then x->>'level' else '' end,
    'duration', private.ai_str(x,'duration',60), 'impact', private.ai_str(x,'impact',1000), 'notes', private.ai_str(x,'notes',1500));
  if o->>'email' <> '' and o->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'البريد الإلكتروني غير صحيح'; end if;
  if o->>'teacher' = '' then raise exception 'اكتب اسم المعلم'; end if;
  if o->>'title' = '' then raise exception 'اكتب عنوان المنتج'; end if;
  if o->>'subject' = '' then raise exception 'اختر المادة'; end if;
  if o->>'stage' = '' then raise exception 'اختر المرحلة'; end if;
  if s not in ('link','html','agent','file','prompt') then raise exception 'اختر نوع المنتج'; end if;
  if o->>'summary' = '' then raise exception 'اكتب وصفاً مختصراً'; end if;
  if o->>'idea' = '' then raise exception 'اكتب المشكلة التعليمية التي يعالجها المنتج'; end if;
  if jsonb_array_length(o->'tasks') = 0 then raise exception 'اختر استخداماً واحداً على الأقل'; end if;
  if s in ('link','agent') and o->>'url' = '' then raise exception 'ضع رابط المنتج'; end if;
  if s = 'prompt' and o->>'prompt' = '' then raise exception 'اكتب نص البرومبت'; end if;
  return o;
end $$;

-- الملفات: المتصفح يرفعها للمخزن ويرسل مساراتها. base = ملفات المنتج الحالية
create or replace function private.ai_files(f jsonb, typ text, base jsonb, me uuid, out fs jsonb, out html text, out has_new_app boolean)
language plpgsql as $$
declare im jsonb; ids jsonb := '[]'::jsonb; pfx text := 'sb:u/' || coalesce(me::text, '-') || '/';
begin
  f := coalesce(f, '{}'::jsonb); base := coalesce(base, '{}'::jsonb);
  fs := jsonb_build_object('appFileName', coalesce(base->>'appFileName',''), 'fileId', coalesce(base->>'fileId',''),
    'fileName', coalesce(base->>'fileName',''), 'fileMime', coalesce(base->>'fileMime',''), 'coverId', coalesce(base->>'coverId',''),
    'imageIds', coalesce(base->'imageIds','[]'::jsonb));
  has_new_app := false; html := null;
  if coalesce(f->'app'->>'html','') <> '' then
    html := f->'app'->>'html';
    if octet_length(html) > 5242880 then raise exception 'حجم ملف التطبيق أكبر من المسموح (5 ميجابايت)'; end if;
    if html !~* '<(html|body|script|div|canvas|svg)[\s>]' then raise exception 'الملف المرفوع ليس صفحة HTML صالحة'; end if;
    fs := fs || jsonb_build_object('appFileName', left(coalesce(nullif(f->'app'->>'name',''), 'app.html'), 80));
    has_new_app := true;
  end if;
  if coalesce(f->'file'->>'path','') <> '' then
    if left(f->'file'->>'path', length(pfx)) <> pfx then raise exception 'مسار ملف غير مسموح'; end if;
    if coalesce(f->'file'->>'mime','') not in ('application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') then
      raise exception 'نوع الملف غير مدعوم — المسموح: PDF و Word و PowerPoint و Excel'; end if;
    fs := fs || jsonb_build_object('fileId', f->'file'->>'path', 'fileName', left(coalesce(f->'file'->>'name','file'), 80), 'fileMime', f->'file'->>'mime');
  end if;
  if coalesce(f->'cover'->>'path','') <> '' then
    if left(f->'cover'->>'path', length(pfx)) <> pfx then raise exception 'مسار ملف غير مسموح'; end if;
    fs := fs || jsonb_build_object('coverId', f->'cover'->>'path');
  elsif coalesce((f->>'removeCover')::boolean, false) then fs := fs || '{"coverId":""}'::jsonb;
  end if;
  if jsonb_typeof(f->'images') = 'array' then
    for im in select e from jsonb_array_elements(f->'images') with ordinality t(e, i) order by i limit 4 loop
      if coalesce(im->>'keep','') <> '' and (fs->'imageIds') ? (im->>'keep') then ids := ids || to_jsonb(im->>'keep');
      elsif coalesce(im->>'path','') <> '' then
        if left(im->>'path', length(pfx)) <> pfx then raise exception 'مسار ملف غير مسموح'; end if;
        ids := ids || to_jsonb(im->>'path');
      end if;
    end loop;
    fs := fs || jsonb_build_object('imageIds', ids);
  end if;
  if typ = 'file' and fs->>'fileId' = '' then raise exception 'ارفع الملف'; end if;
end $$;

create or replace function private.ai_hash(code text) returns text
language sql stable security definer set search_path = public as $$
  select encode(sha256(convert_to((select s0.v->>0 from ai_settings s0 where s0.k = 'salt') || '|' || upper(btrim(code)), 'UTF8')), 'hex')
$$;
create or replace function private.ai_code() returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6)
$$;

create or replace function private.ai_rating(r jsonb) returns jsonb
language plpgsql immutable as $$
declare n int := coalesce((r->>'n')::int, 0); w jsonb := '{"content":25,"pedagogy":25,"design":20,"ease":15,"reuse":15}';
        k text; av numeric; tot numeric := 0;bym jsonb := '{}'::jsonb;
begin
  if n = 0 then return jsonb_build_object('ratingCount', 0, 'ratingAvg', 0, 'ratingBy', '{}'::jsonb); end if;
  for k in select jsonb_object_keys(w) loop
    av := coalesce((r->'s'->>k)::numeric, 0) / n;
    bym := bym || jsonb_build_object(k, round(av, 1));
    tot := tot + (w->>k)::numeric * av / 5;
  end loop;
  return jsonb_build_object('ratingCount', n, 'ratingAvg', round(tot, 1), 'ratingBy', bym);
end $$;

-- تمثيل المنتج كما كان يعيده الخادم القديم
create or replace function private.ai_full(p ai_products, extra boolean) returns jsonb
language sql stable as $$
  select (p.d - 'email') || jsonb_build_object('id', p.id, 'featured', case when p.featured then 'yes' else '' end,
      'verified', case when p.verified then 'yes' else '' end, 'createdAt', p.created_at, 'updatedAt', p.updated_at,
      'views', p.views, 'likes', p.likes, 'hasApp', p.app_html is not null)
    || private.ai_rating(p.ratings)
    || case when extra then jsonb_build_object('status', p.status, 'email', coalesce(p.d->>'email',''), 'adminNote', p.admin_note) else '{}'::jsonb end
$$;
create or replace function private.ai_card(p ai_products) returns jsonb
language sql stable as $$
  select jsonb_build_object('id', p.id, 'featured', case when p.featured then 'yes' else '' end, 'createdAt', p.created_at,
      'teacher', p.d->'teacher', 'subject', p.d->'subject', 'subjectOther', p.d->'subjectOther', 'stage', p.d->'stage',
      'grades', p.d->'grades', 'title', p.d->'title', 'type', p.d->'type', 'tasks', p.d->'tasks', 'tools', p.d->'tools',
      'summary', p.d->'summary', 'url', p.d->'url', 'coverId', p.d->'coverId', 'views', p.views, 'likes', p.likes,
      'skill', p.d->'skill', 'level', p.d->'level', 'verified', case when p.verified then 'yes' else '' end,
      'hasApp', p.app_html is not null, 'hasPrompt', coalesce(p.d->>'prompt','') <> '',
      'prompt', case when p.d->>'type' = 'prompt' then left(coalesce(p.d->>'prompt',''), 4000) else '' end)
    || private.ai_rating(p.ratings)
$$;

create or replace function private.ai_star_public() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare x jsonb := (select s0.v from ai_settings s0 where s0.k = 'star'); h jsonb := '[]'::jsonb; e jsonb;
  pub jsonb;
begin
  create temp table if not exists _ai_live(id text primary key, r jsonb) on commit drop;
  truncate _ai_live;
  insert into _ai_live select id, d || jsonb_build_object('id', id) from ai_products where status = 'approved';
  for e in select v from jsonb_array_elements(coalesce(x->'hist','[]'::jsonb)) with ordinality t(v, i) order by i limit 12 loop
    h := h || jsonb_build_array(private.ai_star_one(e));
  end loop;
  return jsonb_build_object('cur', private.ai_star_one(x->'cur'), 'hist', h);
end $$;
create or replace function private.ai_star_one(s jsonb) returns jsonb
language plpgsql volatile as $$
declare o jsonb; r jsonb;
begin
  if s is null or s = 'null'::jsonb then return null; end if;
  o := jsonb_build_object('teacher', s->'teacher', 'role', s->'role', 'month', s->'month', 'title', s->'title',
    'reason', s->'reason', 'quote', s->'quote', 'points', coalesce(s->'points', '[]'::jsonb));
  select l.r into r from _ai_live l where l.id = s->>'productId';
  if r is not null then
    o := o || jsonb_build_object('productId', r->'id', 'title', coalesce(nullif(s->>'title',''), r->>'title'), 'subject', r->'subject',
      'subjectOther', r->'subjectOther', 'stage', r->'stage', 'type', r->'type', 'coverId', r->'coverId');
  end if;
  return o;
end $$;

-- إشعار داخل بريد المنصة
create or replace function private.ai_notify(p_to uuid[], p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
  p_to := array(select distinct x from unnest(p_to) x where x is not null);
  if coalesce(array_length(p_to, 1), 0) = 0 then return; end if;
  insert into messages(kind, sender_id, subject, body, audience) values ('mail', null, left(p_subject, 200), p_body, 'المعلم الذكي')
  returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, x from unnest(p_to) x on conflict do nothing;
exception when others then null;   -- الإشعار لا يُفشل العملية الأساسية
end $$;
create or replace function private.ai_admins() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(array(select id from profiles where active and lower(email) = any (
      string_to_array(lower(replace(coalesce((select s0.v->>0 from ai_settings s0 where s0.k = 'notify'), ''), ' ', '')), ','))), '{}'),
    array(select id from profiles where active and role = 'admin' and coalesce(source,'') <> 'system'))
$$;

-- ---------------------------------------------------------------------
create or replace function public.ai_call(action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := public.me_id(); adm boolean := public.is_admin(); r ai_products; o jsonb; fs record; dd jsonb;
  k text; v int; sc jsonb; rr jsonb; x jsonb; nid text; code text; site text := 'https://moustafaahussien.github.io/althikr-lms/ai/';
  old_status text;
begin
  p := coalesce(p, '{}'::jsonb);
  if me is null or not public.is_staff() then raise exception 'المعلم الذكي متاح لمنسوبي المدرسة فقط — سجّل الدخول بحساب المدرسة'; end if;
  if action like 'admin%' and not adm then raise exception 'هذه الصفحة لمدير النظام فقط'; end if;

  if action in ('get','app','view','like','rate','teacherGet','teacherApp','teacherUpdate')
     or (action like 'admin%' and action not in ('adminLogin','adminList','adminSettings','adminStar')) then
    select * into r from ai_products where id = p->>'id';
    if r.id is null then raise exception 'المنتج غير موجود'; end if;
  end if;
  -- صاحب المنتج: حسابه في المنصة، أو كود التعديل (للمنتجات المنقولة من المنصة القديمة)
  if action in ('teacherGet','teacherApp','teacherUpdate') then
    if not (r.owner_id = me or (coalesce(p->>'code','') <> '' and r.edit_hash = private.ai_hash(p->>'code'))) then
      raise exception 'كود التعديل غير صحيح'; end if;
  end if;

  case action
  when 'ping' then return jsonb_build_object('ok', true, 'time', now());
  when 'list' then
    return jsonb_build_object('ok', true,
      'items', coalesce((select jsonb_agg(private.ai_card(a) order by a.created_at desc) from ai_products a where a.status = 'approved'), '[]'::jsonb),
      'star', private.ai_star_public(),
      'mine', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.d->>'title', 'status', a.status, 'note', a.admin_note, 'draft', a.draft is not null) order by a.created_at desc)
                        from ai_products a where a.owner_id = me), '[]'::jsonb));
  when 'get' then
    if r.status <> 'approved' then
      return jsonb_build_object('ok', false, 'notPublic', true, 'status', r.status, 'mine', r.owner_id = me, 'error', 'هذا المنتج غير منشور حالياً'); end if;
    return jsonb_build_object('ok', true, 'item', private.ai_full(r, false), 'mine', r.owner_id = me);
  when 'app' then
    if r.status <> 'approved' then raise exception 'هذا المنتج غير منشور حالياً'; end if;
    if r.app_html is null then raise exception 'لا يوجد تطبيق مرفوع لهذا المنتج'; end if;
    return jsonb_build_object('ok', true, 'html', r.app_html);
  when 'view', 'like' then
    if r.status <> 'approved' then return jsonb_build_object('ok', false); end if;
    if action = 'view' then update ai_products set views = views + 1 where id = r.id returning views into v;
    else update ai_products set likes = greatest(0, likes + case when (p->>'delta')::int < 0 then -1 else 1 end) where id = r.id returning likes into v; end if;
    return jsonb_build_object('ok', true, 'value', v);
  when 'rate' then
    if r.status <> 'approved' then return jsonb_build_object('ok', false, 'error', 'المنتج غير منشور'); end if;
    sc := coalesce(p->'scores', '{}'::jsonb); rr := coalesce(r.ratings, '{"s":{},"n":0}'::jsonb);
    foreach k in array array['content','pedagogy','design','ease','reuse'] loop
      v := round(coalesce((sc->>k)::numeric, 0));
      if v < 1 or v > 5 then raise exception 'قيّم كل المعايير من 1 إلى 5'; end if;
      rr := jsonb_set(rr, array['s', k], to_jsonb(coalesce((rr->'s'->>k)::int, 0) + v), true);
    end loop;
    rr := jsonb_set(rr, '{n}', to_jsonb(coalesce((rr->>'n')::int, 0) + 1));
    update ai_products set ratings = rr where id = r.id;
    return jsonb_build_object('ok', true) || private.ai_rating(rr);

  when 'submit' then
    if not coalesce((p->>'agree')::boolean, false) then raise exception 'يجب الموافقة على تعهد المشاركة'; end if;
    dd := private.ai_clean(p->'data');
    if dd->>'email' = '' then dd := dd || jsonb_build_object('email', (select email from profiles where id = me)); end if;
    select * into fs from private.ai_files(p->'files', dd->>'type', null, me);
    if dd->>'type' = 'html' and fs.html is null then raise exception 'ارفع ملف التطبيق (.html)'; end if;
    nid := to_char(now() at time zone 'Asia/Riyadh', 'YYMMDD') || '-' || substr(md5(random()::text), 1, 4);
    code := private.ai_code();
    insert into ai_products(id, status, owner_id, edit_hash, d, app_html)
    values (nid, 'pending', me, private.ai_hash(code), dd || fs.fs, fs.html);
    perform private.ai_notify(private.ai_admins(), 'منتج جديد بانتظار المراجعة: ' || (dd->>'title'),
      (dd->>'teacher') || ' — ' || (dd->>'title') || E'\n\n' || (dd->>'summary') || E'\n\nللمراجعة: ' || site || 'admin.html');
    return jsonb_build_object('ok', true, 'id', nid, 'code', code);

  when 'teacherGet' then
    o := private.ai_full(r, true);
    if r.draft is not null then o := o || (r.draft - 'at') || jsonb_build_object('hasApp', r.draft_app_html is not null or r.app_html is not null); end if;
    return jsonb_build_object('ok', true, 'item', o, 'hasDraft', r.draft is not null);
  when 'teacherApp', 'adminApp' then
    x := to_jsonb(case when coalesce((p->>'draft')::boolean, false) and r.draft_app_html is not null then r.draft_app_html else r.app_html end);
    if x = 'null'::jsonb then raise exception 'لا يوجد تطبيق مرفوع لهذا المنتج'; end if;
    return jsonb_build_object('ok', true, 'html', x);
  when 'teacherUpdate' then
    dd := private.ai_clean(p->'data');
    if r.status = 'approved' then
      -- المنتج المنشور يبقى كما هو، والتعديل مسودة حتى يعتمدها المدير
      select * into fs from private.ai_files(p->'files', dd->>'type', coalesce(r.draft, r.d), me);
      if dd->>'type' = 'html' and fs.html is null and r.draft_app_html is null and r.app_html is null then raise exception 'ارفع ملف التطبيق (.html)'; end if;
      update ai_products set draft = dd || fs.fs || jsonb_build_object('at', now()),
        draft_app_html = coalesce(fs.html, draft_app_html), updated_at = now() where id = r.id;
      perform private.ai_notify(private.ai_admins(), 'تعديل بانتظار المراجعة: ' || (dd->>'title'), (dd->>'teacher') || ' عدّل منتجه المنشور: ' || (dd->>'title') || E'\n\nللمراجعة: ' || site || 'admin.html');
      return jsonb_build_object('ok', true, 'draft', true);
    end if;
    select * into fs from private.ai_files(p->'files', dd->>'type', r.d, me);
    if dd->>'type' = 'html' and fs.html is null and r.app_html is null then raise exception 'ارفع ملف التطبيق (.html)'; end if;
    update ai_products set d = dd || fs.fs, app_html = coalesce(fs.html, app_html), status = 'pending', draft = null, draft_app_html = null, updated_at = now() where id = r.id;
    perform private.ai_notify(private.ai_admins(), 'منتج معدّل بانتظار المراجعة: ' || (dd->>'title'), (dd->>'teacher') || ' — ' || (dd->>'title') || E'\n\nللمراجعة: ' || site || 'admin.html');
    return jsonb_build_object('ok', true, 'draft', false);

  -- ================= الإدارة =================
  when 'adminLogin' then return jsonb_build_object('ok', true);
  when 'adminList' then
    return jsonb_build_object('ok', true,
      'items', coalesce((select jsonb_agg(private.ai_full(a, true) || jsonb_build_object('prompt', a.d->'prompt',
                   'draft', case when a.draft is null then null else (a.draft - 'at') || jsonb_build_object('at', a.draft->'at', 'hasApp', a.draft_app_html is not null) end,
                   'ownerName', (select full_name from profiles where id = a.owner_id))
                 order by a.created_at desc) from ai_products a), '[]'::jsonb),
      'settings', jsonb_build_object('notifyEmail', coalesce((select s0.v->>0 from ai_settings s0 where s0.k = 'notify'), ''), 'siteUrl', site, 'folderUrl', ''),
      'star', (select s0.v from ai_settings s0 where s0.k = 'star'));
  when 'adminSet' then
    if coalesce(p->>'status','') not in ('pending','approved','rejected') then raise exception 'حالة غير صحيحة'; end if;
    old_status := r.status;
    if p->>'status' = 'approved' and r.draft is not null then
      update ai_products set d = r.draft - 'at', app_html = coalesce(r.draft_app_html, r.app_html), draft = null, draft_app_html = null where id = r.id;
    end if;
    update ai_products set status = p->>'status', admin_note = left(coalesce(p->>'note',''), 600), updated_at = now() where id = r.id;
    if old_status <> p->>'status' and p->>'status' <> 'pending' then
      perform private.ai_notify(array[r.owner_id],
        case when p->>'status' = 'approved' then 'تم نشر منتجك في منصة المعلم الذكي 🎉' else 'منتجك في منصة المعلم الذكي يحتاج تعديلاً' end,
        'أهلاً ' || coalesce(r.d->>'teacher','') || E'\n\n' || case when p->>'status' = 'approved'
          then 'تم اعتماد ونشر منتجك «' || (r.d->>'title') || E'».\nرابط المنتج: ' || site || 'product.html?id=' || r.id
          else 'منتجك «' || (r.d->>'title') || '» لم يُنشر بعد.' || case when coalesce(p->>'note','') <> '' then E'\nملاحظة المشرف: ' || (p->>'note') else '' end
               || E'\nيمكنك تعديله من صفحة المنتج: ' || site || 'product.html?id=' || r.id end);
    end if;
    return jsonb_build_object('ok', true);
  when 'adminFeature' then update ai_products set featured = coalesce((p->>'featured')::boolean, false), updated_at = now() where id = r.id; return '{"ok":true}';
  when 'adminVerify' then update ai_products set verified = coalesce((p->>'verified')::boolean, false), updated_at = now() where id = r.id; return '{"ok":true}';
  when 'adminDraft' then
    if r.draft is null then return '{"ok":true}'; end if;
    if coalesce((p->>'apply')::boolean, false) then
      update ai_products set d = r.draft - 'at', app_html = coalesce(r.draft_app_html, r.app_html), draft = null, draft_app_html = null, updated_at = now() where id = r.id;
    else update ai_products set draft = null, draft_app_html = null, updated_at = now() where id = r.id; end if;
    return '{"ok":true}';
  when 'adminDelete' then delete from ai_products where id = r.id; return '{"ok":true}';
  when 'adminUpdate' then
    dd := private.ai_clean(p->'data');
    select * into fs from private.ai_files(p->'files', dd->>'type', r.d, me);
    if dd->>'type' = 'html' and fs.html is null and r.app_html is null then raise exception 'ارفع ملف التطبيق (.html)'; end if;
    update ai_products set d = dd || fs.fs, app_html = coalesce(fs.html, app_html), updated_at = now() where id = r.id;
    return '{"ok":true}';
  when 'adminResetCode' then
    code := private.ai_code();
    update ai_products set edit_hash = private.ai_hash(code) where id = r.id;
    return jsonb_build_object('ok', true, 'code', code);
  when 'adminSettings' then
    if p ? 'notifyEmail' then
      if coalesce(p->>'notifyEmail','') <> '' and p->>'notifyEmail' !~ '^[^\s@,]+@[^\s@,]+\.[^\s@,]+$' then raise exception 'البريد غير صحيح'; end if;
      update ai_settings s0 set v = to_jsonb(coalesce(p->>'notifyEmail','')) where s0.k = 'notify';
    end if;
    return jsonb_build_object('ok', true, 'settings', jsonb_build_object('notifyEmail', coalesce((select s0.v->>0 from ai_settings s0 where s0.k = 'notify'), ''), 'siteUrl', site, 'folderUrl', ''));
  when 'adminStar' then
    x := coalesce((select s0.v from ai_settings s0 where s0.k = 'star'), '{"cur":null,"hist":[]}'::jsonb);
    if p->>'mode' = 'set' then
      sc := p->'star';
      o := jsonb_build_object('teacher', private.ai_str(sc,'teacher',120), 'role', private.ai_str(sc,'role',160), 'month', private.ai_str(sc,'month',60),
        'productId', private.ai_str(sc,'productId',40), 'title', private.ai_str(sc,'title',200), 'reason', private.ai_str(sc,'reason',2500),
        'quote', private.ai_str(sc,'quote',400),
        'points', private.ai_arr(case when jsonb_typeof(sc->'points') = 'array' then sc->'points' else to_jsonb(string_to_array(coalesce(sc->>'points',''), E'\n')) end, 8, 300),
        'at', now());
      if o->>'teacher' = '' then raise exception 'اكتب اسم المعلم'; end if;
      if o->>'month' = '' then raise exception 'اكتب الشهر'; end if;
      if o->>'reason' = '' then raise exception 'اكتب شرح المشروع وسبب الاختيار'; end if;
      if o->>'productId' <> '' and not exists (select 1 from ai_products where id = o->>'productId') then raise exception 'المنتج غير موجود'; end if;
      if x->'cur' is not null and x->'cur' <> 'null'::jsonb and x->'cur'->>'month' is distinct from o->>'month' then
        x := jsonb_set(x, '{hist}', jsonb_build_array(x->'cur') || coalesce(x->'hist','[]'::jsonb)); end if;
      x := jsonb_set(x, '{cur}', o);
    elsif p->>'mode' = 'archive' then
      if x->'cur' is not null and x->'cur' <> 'null'::jsonb then x := jsonb_set(x, '{hist}', jsonb_build_array(x->'cur') || coalesce(x->'hist','[]'::jsonb)); end if;
      x := jsonb_set(x, '{cur}', 'null'::jsonb);
    elsif p->>'mode' = 'delHist' then
      v := (p->>'index')::int;
      if v is null or v < 0 or v >= jsonb_array_length(coalesce(x->'hist','[]'::jsonb)) then raise exception 'عنصر غير موجود'; end if;
      x := jsonb_set(x, '{hist}', (x->'hist') - v);
    else raise exception 'إجراء غير معروف'; end if;
    x := jsonb_set(x, '{hist}', coalesce((select jsonb_agg(e order by i) from jsonb_array_elements(x->'hist') with ordinality t(e, i) where i <= 36), '[]'::jsonb));
    update ai_settings s0 set v = x where s0.k = 'star';
    return jsonb_build_object('ok', true, 'star', x);
  else raise exception 'إجراء غير معروف';
  end case;
end $$;

-- نقل منتجات المنصة القديمة (مدير النظام فقط) — items: [{...item, status, html}]
create or replace function public.ai_import(p_items jsonb, p_star jsonb default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare it jsonb; n int := 0; own uuid;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  for it in select * from jsonb_array_elements(p_items) loop
    own := (select id from profiles where lower(email) = lower(nullif(it->>'email','')) limit 1);
    insert into ai_products(id, status, featured, verified, owner_id, d, app_html, views, likes, ratings, admin_note, created_at, updated_at)
    values (it->>'id', coalesce(it->>'status','approved'), coalesce(it->>'featured','') not in ('', 'false'), coalesce(it->>'verified','') not in ('', 'false'),
      own,
      jsonb_strip_nulls(jsonb_build_object('teacher', it->'teacher', 'email', it->'email', 'subject', it->'subject', 'subjectOther', it->'subjectOther',
        'stage', it->'stage', 'grades', it->'grades', 'title', it->'title', 'type', it->'type', 'tasks', coalesce(it->'tasks','[]'), 'tools', coalesce(it->'tools','[]'),
        'summary', it->'summary', 'idea', it->'idea', 'url', it->'url', 'prompt', it->'prompt', 'video', it->'video',
        'buildSteps', coalesce(it->'buildSteps','[]'), 'useSteps', coalesce(it->'useSteps','[]'), 'tips', it->'tips', 'goal', it->'goal', 'skill', it->'skill',
        'level', it->'level', 'duration', it->'duration', 'impact', it->'impact', 'notes', it->'notes',
        'appFileName', it->'appFileName', 'fileId', it->'fileId', 'fileName', it->'fileName', 'fileMime', it->'fileMime',
        'coverId', it->'coverId', 'imageIds', coalesce(it->'imageIds','[]'))),
      nullif(it->>'html',''), coalesce((it->>'views')::int, 0), coalesce((it->>'likes')::int, 0), it->'ratings', coalesce(it->>'adminNote',''),
      coalesce((it->>'createdAt')::timestamptz, now()), coalesce((it->>'updatedAt')::timestamptz, now()))
    on conflict (id) do update set d = excluded.d, app_html = coalesce(excluded.app_html, ai_products.app_html), views = excluded.views, likes = excluded.likes,
      featured = excluded.featured, verified = excluded.verified, status = excluded.status, ratings = coalesce(excluded.ratings, ai_products.ratings);
    n := n + 1;
  end loop;
  if p_star is not null then update ai_settings s0 set v = p_star where s0.k = 'star'; end if;
  return jsonb_build_object('imported', n, 'total', (select count(*) from ai_products));
end $$;

revoke all on function public.ai_call(text, jsonb) from public, anon;
revoke all on function public.ai_import(jsonb, jsonb) from public, anon;
grant execute on function public.ai_call(text, jsonb) to authenticated;
grant execute on function public.ai_import(jsonb, jsonb) to authenticated;
