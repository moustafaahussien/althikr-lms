-- ============================================================
-- 71) مكتبة الكتب (مركز مصادر التعلم): الفهرس، النسخ بالباركود، الإعارة والإرجاع، الجرد
-- ============================================================

create table if not exists public.bk_books (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  author      text,
  publisher   text,
  isbn        text,
  category    text,
  pub_year    smallint,
  shelf       text,
  cover_url   text,
  summary     text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists bk_books_cat on public.bk_books(category);

create table if not exists public.bk_copies (
  id        bigserial primary key,
  book_id   bigint not null references public.bk_books(id) on delete cascade,
  barcode   text not null unique,
  status    text not null default 'available' check (status in ('available','loaned','lost','damaged','withdrawn')),
  note      text
);

create table if not exists public.bk_loans (
  id          bigserial primary key,
  copy_id     bigint not null references public.bk_copies(id) on delete cascade,
  borrower_id uuid not null references public.profiles(id) on delete cascade,
  loaned_at   timestamptz not null default now(),
  due_on      date not null,
  returned_at timestamptz,
  renewals    smallint not null default 0,
  by_id       uuid references public.profiles(id) on delete set null
);
create index if not exists bk_loans_open on public.bk_loans(borrower_id) where returned_at is null;
create unique index if not exists bk_loans_one_open on public.bk_loans(copy_id) where returned_at is null;

create table if not exists public.bk_inventory (
  id         bigserial primary key,
  title      text not null,
  started_at timestamptz not null default now(),
  closed_at  timestamptz,
  by_id      uuid references public.profiles(id) on delete set null
);
create table if not exists public.bk_inv_scans (
  inv_id  bigint not null references public.bk_inventory(id) on delete cascade,
  copy_id bigint not null references public.bk_copies(id) on delete cascade,
  at      timestamptz not null default now(),
  primary key (inv_id, copy_id)
);

alter table public.bk_books enable row level security; alter table public.bk_copies enable row level security; alter table public.bk_loans enable row level security;
alter table public.bk_inventory enable row level security; alter table public.bk_inv_scans enable row level security;
revoke all on public.bk_books, public.bk_copies, public.bk_loans, public.bk_inventory, public.bk_inv_scans from anon, authenticated;

create or replace function private.bk_lib() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role = 'admin' or coalesce(p.job_title,'') ~ '(أمين|امين|مكتبة|مصادر التعلم|مركز مصادر)'))
$$;
create or replace function public.bk_am() returns boolean language sql stable security definer set search_path = public, private as $$ select private.bk_lib() $$;

create or replace function private.bk_json(b public.bk_books) returns jsonb
language sql stable security definer set search_path = public as $$
  select to_jsonb(b) || jsonb_build_object(
    'copies', (select count(*) from bk_copies c where c.book_id = b.id and c.status in ('available','loaned')),
    'available', (select count(*) from bk_copies c where c.book_id = b.id and c.status = 'available'))
$$;

-- ---------- الفهرس (للجميع) ----------
create or replace function public.bk_search(p_q text default null, p_cat text default null, p_limit int default 60) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q text := public.norm(nullif(btrim(coalesce(p_q, '')), ''));
begin
  if public.me_id() is null then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'cats', coalesce((select jsonb_agg(distinct category) from bk_books where active and category is not null), '[]'::jsonb),
    'total', (select count(*) from bk_books where active),
    'rows', coalesce((select jsonb_agg(private.bk_json(b) order by b.title) from (select * from bk_books b where b.active
        and (q is null or public.norm(b.title || ' ' || coalesce(b.author, '') || ' ' || coalesce(b.isbn, '')) like '%' || q || '%'
             or exists (select 1 from bk_copies c where c.book_id = b.id and c.barcode = btrim(p_q)))
        and (p_cat is null or b.category = p_cat) order by b.title limit least(coalesce(p_limit, 60), 300)) b), '[]'::jsonb));
end $$;

create or replace function public.bk_my() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'title', b.title, 'author', b.author, 'barcode', c.barcode, 'loaned_at', l.loaned_at, 'due_on', l.due_on,
           'returned_at', l.returned_at, 'overdue', l.returned_at is null and l.due_on < current_date) order by l.returned_at nulls first, l.loaned_at desc), '[]'::jsonb)
    from bk_loans l join bk_copies c on c.id = l.copy_id join bk_books b on b.id = c.book_id
   where l.borrower_id = public.me_id() and (l.returned_at is null or l.returned_at > now() - interval '120 days')
$$;

-- ---------- أمين المكتبة ----------
create or replace function public.bk_book_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare bid bigint := nullif(p->>'id', '')::bigint; n int := coalesce(nullif(p->>'copies', '')::int, 0); i int; base int;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  if bid is null then
    insert into bk_books(title, author, publisher, isbn, category, pub_year, shelf, cover_url, summary)
    values (btrim(p->>'title'), nullif(btrim(p->>'author'), ''), nullif(btrim(p->>'publisher'), ''), nullif(btrim(p->>'isbn'), ''), nullif(btrim(p->>'category'), ''),
            nullif(p->>'pub_year', '')::smallint, nullif(btrim(p->>'shelf'), ''), nullif(btrim(p->>'cover_url'), ''), nullif(btrim(p->>'summary'), '')) returning id into bid;
    if n < 1 then n := 1; end if;
  else
    update bk_books set title = btrim(p->>'title'), author = nullif(btrim(p->>'author'), ''), publisher = nullif(btrim(p->>'publisher'), ''), isbn = nullif(btrim(p->>'isbn'), ''),
           category = nullif(btrim(p->>'category'), ''), pub_year = nullif(p->>'pub_year', '')::smallint, shelf = nullif(btrim(p->>'shelf'), ''),
           cover_url = nullif(btrim(p->>'cover_url'), ''), summary = nullif(btrim(p->>'summary'), ''), active = coalesce((p->>'active')::boolean, active) where id = bid;
  end if;
  if n > 0 then
    select coalesce(max(nullif(regexp_replace(barcode, '^.*-', ''), '')::int), 0) into base from bk_copies where book_id = bid and barcode ~ ('^B' || bid || '-[0-9]+$');
    for i in 1..least(n, 100) loop insert into bk_copies(book_id, barcode) values (bid, 'B' || bid || '-' || (base + i)); end loop;
  end if;
  return bid;
end $$;

-- استيراد دفعة من Excel: [{title, author, publisher, isbn, category, pub_year, shelf, copies}]
create or replace function public.bk_import(p_rows jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare r jsonb; n int := 0;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    continue when coalesce(btrim(r->>'title'), '') = '';
    perform public.bk_book_save(r - 'id'); n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.bk_book_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  return (select private.bk_json(b) from bk_books b where b.id = p_id) || jsonb_build_object(
    'copy_list', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'barcode', c.barcode, 'status', c.status, 'note', c.note,
        'borrower', (select p.full_name from bk_loans l join profiles p on p.id = l.borrower_id where l.copy_id = c.id and l.returned_at is null),
        'due_on', (select l.due_on from bk_loans l where l.copy_id = c.id and l.returned_at is null)) order by c.id) from bk_copies c where c.book_id = p_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('who', p.full_name, 'barcode', c.barcode, 'at', l.loaned_at, 'returned', l.returned_at) order by l.loaned_at desc)
        from bk_loans l join bk_copies c on c.id = l.copy_id join profiles p on p.id = l.borrower_id where c.book_id = p_id limit 50), '[]'::jsonb));
end $$;

create or replace function public.bk_copy_set(p_id bigint, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  if p_status not in ('available','lost','damaged','withdrawn') then raise exception 'حالة غير صالحة'; end if;
  if exists (select 1 from bk_loans where copy_id = p_id and returned_at is null) then raise exception 'النسخة معارة — سجّل إرجاعها أولًا'; end if;
  update bk_copies set status = p_status, note = nullif(btrim(p_note), '') where id = p_id;
end $$;

create or replace function public.bk_people(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q text := public.norm(nullif(btrim(coalesce(p_q, '')), ''));
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  if q is null or length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role,
           'info', coalesce((select vc.label from students s join v_classes vc on vc.id = s.class_id where s.profile_id = p.id), p.job_title),
           'open', (select count(*) from bk_loans l where l.borrower_id = p.id and l.returned_at is null)) x
      from profiles p left join students s on s.profile_id = p.id
     where p.active and p.role <> 'parent' and (public.norm(p.full_name) like '%' || q || '%' or s.student_number = btrim(p_q)) order by p.full_name limit 25) z), '[]'::jsonb);
end $$;

create or replace function public.bk_loan(p_barcode text, p_borrower uuid, p_days int default 14) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c bk_copies; mx int := 3;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  select * into c from bk_copies where barcode = btrim(p_barcode);
  if c.id is null then raise exception 'باركود غير موجود'; end if;
  if c.status <> 'available' then raise exception 'النسخة غير متاحة (%)', c.status; end if;
  if (select count(*) from bk_loans where borrower_id = p_borrower and returned_at is null) >= mx
     and (select role from profiles where id = p_borrower) = 'student' then raise exception 'للطالب % إعارات مفتوحة — الحد الأقصى %', mx, mx; end if;
  insert into bk_loans(copy_id, borrower_id, due_on, by_id) values (c.id, p_borrower, current_date + greatest(1, least(coalesce(p_days, 14), 90)), public.me_id());
  update bk_copies set status = 'loaned' where id = c.id;
  return jsonb_build_object('title', (select title from bk_books where id = c.book_id), 'due_on', current_date + greatest(1, least(coalesce(p_days, 14), 90)));
end $$;

create or replace function public.bk_return(p_barcode text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c bk_copies; l bk_loans;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  select * into c from bk_copies where barcode = btrim(p_barcode);
  if c.id is null then raise exception 'باركود غير موجود'; end if;
  select * into l from bk_loans where copy_id = c.id and returned_at is null;
  if l.id is null then raise exception 'هذه النسخة غير معارة'; end if;
  update bk_loans set returned_at = now() where id = l.id;
  update bk_copies set status = 'available' where id = c.id;
  return jsonb_build_object('title', (select title from bk_books where id = c.book_id), 'who', (select full_name from profiles where id = l.borrower_id),
                            'late_days', greatest(0, current_date - l.due_on));
end $$;

create or replace function public.bk_renew(p_loan bigint, p_days int default 7) returns date
language plpgsql security definer set search_path = public, private as $$
declare d date;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  update bk_loans set due_on = greatest(due_on, current_date) + greatest(1, least(p_days, 30)), renewals = renewals + 1 where id = p_loan and returned_at is null returning due_on into d;
  return d;
end $$;

create or replace function public.bk_loans_open(p_overdue boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'title', b.title, 'barcode', c.barcode, 'who', p.full_name, 'borrower_id', p.id,
           'info', coalesce((select vc.label from students s join v_classes vc on vc.id = s.class_id where s.profile_id = p.id), p.job_title),
           'loaned_at', l.loaned_at, 'due_on', l.due_on, 'late', greatest(0, current_date - l.due_on)) order by l.due_on)
    from bk_loans l join bk_copies c on c.id = l.copy_id join bk_books b on b.id = c.book_id join profiles p on p.id = l.borrower_id
   where l.returned_at is null and (not p_overdue or l.due_on < current_date)), '[]'::jsonb);
end $$;

-- تذكير المتأخرين برسالة (تصل إشعارًا للطالب/المنسوب)
create or replace function public.bk_remind_overdue() returns int
language plpgsql security definer set search_path = public, private as $$
declare r record; mid bigint; n int := 0;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  for r in select l.borrower_id, string_agg('• ' || b.title || ' (كان موعد إرجاعه ' || l.due_on || ')', E'\n') txt
             from bk_loans l join bk_copies c on c.id = l.copy_id join bk_books b on b.id = c.book_id
            where l.returned_at is null and l.due_on < current_date group by 1 loop
    insert into messages(kind, sender_id, subject, body, audience)
    values ('mail', public.me_id(), '📚 تذكير بإرجاع كتب المكتبة', 'نرجو إرجاع الكتب التالية لمركز مصادر التعلم:' || E'\n' || r.txt, 'مكتبة المدرسة') returning id into mid;
    insert into message_recipients(message_id, profile_id) values (mid, r.borrower_id) on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------- الجرد ----------
create or replace function public.bk_inv_start(p_title text) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare iid bigint;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  insert into bk_inventory(title, by_id) values (coalesce(nullif(btrim(p_title), ''), 'جرد ' || current_date), public.me_id()) returning id into iid;
  return iid;
end $$;

create or replace function public.bk_inv_scan(p_inv bigint, p_barcode text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare c bk_copies;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  select * into c from bk_copies where barcode = btrim(p_barcode);
  if c.id is null then return jsonb_build_object('ok', false, 'msg', 'باركود غير مسجل في الفهرس'); end if;
  insert into bk_inv_scans(inv_id, copy_id) values (p_inv, c.id) on conflict do nothing;
  return jsonb_build_object('ok', true, 'title', (select title from bk_books where id = c.book_id), 'status', c.status,
    'n', (select count(*) from bk_inv_scans where inv_id = p_inv));
end $$;

create or replace function public.bk_inv_report(p_inv bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  return jsonb_build_object('inv', (select to_jsonb(i) from bk_inventory i where i.id = p_inv),
    'expected', (select count(*) from bk_copies where status = 'available'),
    'scanned', (select count(*) from bk_inv_scans where inv_id = p_inv),
    'loaned', (select count(*) from bk_copies where status = 'loaned'),
    'missing', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'barcode', c.barcode, 'title', b.title, 'shelf', b.shelf) order by b.shelf nulls last, b.title)
        from bk_copies c join bk_books b on b.id = c.book_id where c.status = 'available'
         and not exists (select 1 from bk_inv_scans s where s.inv_id = p_inv and s.copy_id = c.id)), '[]'::jsonb));
end $$;

create or replace function public.bk_inv_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'started_at', i.started_at, 'closed_at', i.closed_at,
    'n', (select count(*) from bk_inv_scans s where s.inv_id = i.id)) order by i.started_at desc) from bk_inventory i), '[]'::jsonb);
end $$;

-- إغلاق الجرد مع اعتبار غير الممسوح مفقودًا (اختياري)
create or replace function public.bk_inv_close(p_inv bigint, p_mark_lost boolean default false) returns int
language plpgsql security definer set search_path = public, private as $$
declare n int := 0;
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  if p_mark_lost then
    update bk_copies c set status = 'lost', note = 'لم يُعثر عليه في ' || (select title from bk_inventory where id = p_inv)
     where c.status = 'available' and not exists (select 1 from bk_inv_scans s where s.inv_id = p_inv and s.copy_id = c.id);
    get diagnostics n = row_count;
  end if;
  update bk_inventory set closed_at = now() where id = p_inv;
  return n;
end $$;

create or replace function public.bk_stats() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bk_lib() then raise exception 'لأمين المكتبة فقط'; end if;
  return jsonb_build_object('books', (select count(*) from bk_books where active), 'copies', (select count(*) from bk_copies where status in ('available','loaned')),
    'loaned', (select count(*) from bk_loans where returned_at is null), 'overdue', (select count(*) from bk_loans where returned_at is null and due_on < current_date),
    'month', (select count(*) from bk_loans where loaned_at >= date_trunc('month', now())),
    'top_books', coalesce((select jsonb_agg(jsonb_build_object('title', x.title, 'n', x.n) order by x.n desc) from (select b.title, count(*) n from bk_loans l join bk_copies c on c.id = l.copy_id
         join bk_books b on b.id = c.book_id where l.loaned_at > now() - interval '1 year' group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
    'top_readers', coalesce((select jsonb_agg(jsonb_build_object('name', x.full_name, 'n', x.n) order by x.n desc) from (select p.full_name, count(*) n from bk_loans l join profiles p on p.id = l.borrower_id
         where l.loaned_at > now() - interval '1 year' and p.role = 'student' group by 1 order by 2 desc limit 10) x), '[]'::jsonb));
end $$;

revoke all on function private.bk_lib(), private.bk_json(public.bk_books) from public, anon, authenticated;
revoke all on function public.bk_am(), public.bk_search(text, text, int), public.bk_my(), public.bk_book_save(jsonb), public.bk_import(jsonb), public.bk_book_get(bigint),
  public.bk_copy_set(bigint, text, text), public.bk_people(text), public.bk_loan(text, uuid, int), public.bk_return(text), public.bk_renew(bigint, int),
  public.bk_loans_open(boolean), public.bk_remind_overdue(), public.bk_inv_start(text), public.bk_inv_scan(bigint, text), public.bk_inv_report(bigint),
  public.bk_inv_list(), public.bk_inv_close(bigint, boolean), public.bk_stats() from public, anon;
grant execute on function public.bk_am(), public.bk_search(text, text, int), public.bk_my(), public.bk_book_save(jsonb), public.bk_import(jsonb), public.bk_book_get(bigint),
  public.bk_copy_set(bigint, text, text), public.bk_people(text), public.bk_loan(text, uuid, int), public.bk_return(text), public.bk_renew(bigint, int),
  public.bk_loans_open(boolean), public.bk_remind_overdue(), public.bk_inv_start(text), public.bk_inv_scan(bigint, text), public.bk_inv_report(bigint),
  public.bk_inv_list(), public.bk_inv_close(bigint, boolean), public.bk_stats() to authenticated;
