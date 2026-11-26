-- ============================================================
-- 75) النقاش داخل الفصل: نقاشات وأسئلة الطلاب للمعلم لكل (فصل + مادة)
-- مع إشراف المعلم: تثبيت، قفل، إخفاء، تحديد أفضل إجابة، وإيقاف مشاركة الطلاب.
-- ============================================================

create table if not exists public.ds_settings (
  class_id   integer not null references public.classes(id) on delete cascade,
  subject_id integer not null references public.subjects(id) on delete cascade,
  students_can_post boolean not null default true,
  closed     boolean not null default false,
  primary key (class_id, subject_id)
);

create table if not exists public.ds_threads (
  id         bigserial primary key,
  class_id   integer not null references public.classes(id) on delete cascade,
  subject_id integer not null references public.subjects(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  kind       text not null default 'discussion' check (kind in ('discussion','question','private','announcement')),
  title      text not null check (btrim(title) <> ''),
  body       text,
  pinned     boolean not null default false,
  locked     boolean not null default false,
  hidden     boolean not null default false,
  answered   boolean not null default false,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()
);
create index if not exists ds_threads_cs on public.ds_threads(class_id, subject_id, last_at desc);

create table if not exists public.ds_posts (
  id         bigserial primary key,
  thread_id  bigint not null references public.ds_threads(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  body       text not null check (btrim(body) <> ''),
  hidden     boolean not null default false,
  is_answer  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ds_posts_t on public.ds_posts(thread_id, created_at);

alter table public.ds_settings enable row level security; alter table public.ds_threads enable row level security; alter table public.ds_posts enable row level security;
revoke all on public.ds_settings, public.ds_threads, public.ds_posts from anon, authenticated;

-- 'mod' معلم المادة | 'view' متابع (مشرف/مدير) | 'student' طالب الفصل | null
create or replace function private.ds_role(p_class int, p_subject int) returns text
language sql stable security definer set search_path = public, private as $$
  select case when exists (select 1 from teaching_assignments where class_id = p_class and subject_id = p_subject and teacher_id = public.me_id()) then 'mod'
              when public.me_role() = 'student' and private.my_class_id() = p_class
                   and exists (select 1 from teaching_assignments where class_id = p_class and subject_id = p_subject) then 'student'
              when exists (select 1 from teaching_assignments ta where ta.class_id = p_class and ta.subject_id = p_subject and private.lp_is_reviewer(ta.teacher_id)) then 'view'
         end
$$;

create or replace function private.ds_notify(p_to uuid[], p_subject text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
declare mid bigint;
begin
  if coalesce(array_length(p_to, 1), 0) = 0 then return; end if;
  insert into messages(kind, sender_id, subject, body, audience) values ('mail', public.me_id(), left(p_subject, 200), p_body, 'نقاشات الفصول') returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, x from unnest(p_to) x where x is distinct from public.me_id() on conflict do nothing;
end $$;

-- مقرراتي (فصل + مادة)
create or replace function public.ds_courses() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(x order by x->>'class', x->>'subject'), '[]'::jsonb) from (
    select distinct jsonb_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id, 'class', vc.label, 'subject', s.name_ar,
           'role', private.ds_role(ta.class_id, ta.subject_id),
           'new', (select count(*) from ds_threads t where t.class_id = ta.class_id and t.subject_id = ta.subject_id and not t.hidden and t.last_at > now() - interval '3 days'),
           'open_q', (select count(*) from ds_threads t where t.class_id = ta.class_id and t.subject_id = ta.subject_id and t.kind in ('question','private') and not t.answered and not t.hidden)) x
      from teaching_assignments ta join v_classes vc on vc.id = ta.class_id join subjects s on s.id = ta.subject_id
     where private.ds_role(ta.class_id, ta.subject_id) is not null) z
$$;

create or replace function public.ds_list(p_class int, p_subject int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.ds_role(p_class, p_subject); st ds_settings;
begin
  if r is null then raise exception 'غير مصرح'; end if;
  select * into st from ds_settings where class_id = p_class and subject_id = p_subject;
  return jsonb_build_object('role', r, 'students_can_post', coalesce(st.students_can_post, true), 'closed', coalesce(st.closed, false),
    'threads', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'pinned', t.pinned, 'locked', t.locked, 'hidden', t.hidden,
        'answered', t.answered, 'author', (select full_name from profiles where id = t.author_id), 'mine', t.author_id = public.me_id(),
        'by_teacher', exists (select 1 from teaching_assignments where class_id = p_class and subject_id = p_subject and teacher_id = t.author_id),
        'created_at', t.created_at, 'last_at', t.last_at, 'n', (select count(*) from ds_posts p where p.thread_id = t.id and (not p.hidden or r = 'mod'))) order by t.pinned desc, t.last_at desc)
      from ds_threads t where t.class_id = p_class and t.subject_id = p_subject
       and (r <> 'student' or (not t.hidden and (t.kind <> 'private' or t.author_id = public.me_id())))), '[]'::jsonb));
end $$;

create or replace function public.ds_thread(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare t ds_threads; r text;
begin
  select * into t from ds_threads where id = p_id;
  r := private.ds_role(t.class_id, t.subject_id);
  if r is null or (r = 'student' and (t.hidden or (t.kind = 'private' and t.author_id <> public.me_id()))) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'body', t.body, 'pinned', t.pinned, 'locked', t.locked, 'hidden', t.hidden, 'answered', t.answered,
    'author', (select full_name from profiles where id = t.author_id), 'mine', t.author_id = public.me_id(), 'created_at', t.created_at, 'role', r,
    'closed', coalesce((select closed from ds_settings where class_id = t.class_id and subject_id = t.subject_id), false),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'body', case when p.hidden and r <> 'mod' then null else p.body end, 'hidden', p.hidden, 'is_answer', p.is_answer,
        'author', (select full_name from profiles where id = p.author_id), 'mine', p.author_id = public.me_id(),
        'teacher', exists (select 1 from teaching_assignments where class_id = t.class_id and subject_id = t.subject_id and teacher_id = p.author_id),
        'created_at', p.created_at) order by p.created_at) from ds_posts p where p.thread_id = p_id), '[]'::jsonb));
end $$;

create or replace function public.ds_thread_add(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare c int := (p->>'class_id')::int; s int := (p->>'subject_id')::int; r text := private.ds_role(c, s); k text := coalesce(nullif(p->>'kind', ''), 'discussion');
        st ds_settings; tid bigint; tch uuid[];
begin
  if r is null or r = 'view' then raise exception 'غير مصرح'; end if;
  select * into st from ds_settings where class_id = c and subject_id = s;
  if r = 'student' then
    if coalesce(st.closed, false) or not coalesce(st.students_can_post, true) then raise exception 'أوقف المعلم إضافة مواضيع جديدة'; end if;
    if k = 'announcement' then k := 'discussion'; end if;
    if (select count(*) from ds_threads where author_id = public.me_id() and created_at > now() - interval '1 hour') >= 5 then raise exception 'أضفت مواضيع كثيرة خلال ساعة — حاول لاحقًا'; end if;
  end if;
  if k not in ('discussion','question','private','announcement') then raise exception 'نوع غير صالح'; end if;
  insert into ds_threads(class_id, subject_id, author_id, kind, title, body)
  values (c, s, public.me_id(), k, left(btrim(p->>'title'), 200), nullif(left(btrim(p->>'body'), 5000), '')) returning id into tid;
  if r = 'student' and k in ('question','private') then
    select array_agg(teacher_id) into tch from teaching_assignments where class_id = c and subject_id = s;
    perform private.ds_notify(tch, '❓ سؤال من طالب: ' || left(btrim(p->>'title'), 120),
      (select full_name from profiles where id = public.me_id()) || ' — ' || (select label from v_classes where id = c) || E'\n\n' || coalesce(btrim(p->>'body'), '') ||
      E'\n\nللرد: المنصة ← نقاشات الفصول');
  end if;
  return tid;
end $$;

create or replace function public.ds_post_add(p_thread bigint, p_body text) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare t ds_threads; r text; pid bigint;
begin
  select * into t from ds_threads where id = p_thread;
  r := private.ds_role(t.class_id, t.subject_id);
  if r is null or r = 'view' then raise exception 'غير مصرح'; end if;
  if r = 'student' then
    if t.hidden or (t.kind = 'private' and t.author_id <> public.me_id()) then raise exception 'غير مصرح'; end if;
    if t.locked or coalesce((select closed from ds_settings where class_id = t.class_id and subject_id = t.subject_id), false) then raise exception 'الموضوع مغلق للردود'; end if;
    if (select count(*) from ds_posts where author_id = public.me_id() and created_at > now() - interval '10 minutes') >= 15 then raise exception 'ردود كثيرة — انتظر قليلًا'; end if;
  end if;
  insert into ds_posts(thread_id, author_id, body) values (p_thread, public.me_id(), left(btrim(p_body), 5000)) returning id into pid;
  update ds_threads set last_at = now(), answered = answered or (r = 'mod' and kind in ('question','private')) where id = p_thread;
  if r = 'mod' and t.author_id is not null and t.author_id <> public.me_id() then
    perform private.ds_notify(array[t.author_id], '💬 رد المعلم على: ' || left(t.title, 120), left(btrim(p_body), 1500) || E'\n\nالمنصة ← نقاشات الفصول');
  end if;
  return pid;
end $$;

-- إشراف: pin | lock | hide (موضوع) ، hide_post | answer (رد) ، delete (موضوع/رد للمعلم أو صاحب المشاركة خلال 15 دقيقة)
create or replace function public.ds_mod(p_action text, p_id bigint, p_value boolean default true) returns void
language plpgsql security definer set search_path = public, private as $$
declare t ds_threads; p ds_posts; r text;
begin
  if p_action in ('hide_post','answer','delete_post') then
    select * into p from ds_posts where id = p_id; select * into t from ds_threads where id = p.thread_id;
  else select * into t from ds_threads where id = p_id; end if;
  r := private.ds_role(t.class_id, t.subject_id);
  if p_action = 'delete_post' and p.author_id = public.me_id() and p.created_at > now() - interval '15 minutes' then delete from ds_posts where id = p_id; return; end if;
  if p_action = 'delete' and t.author_id = public.me_id() and t.created_at > now() - interval '15 minutes'
     and not exists (select 1 from ds_posts where thread_id = t.id and author_id <> public.me_id()) then delete from ds_threads where id = p_id; return; end if;
  if r is distinct from 'mod' then raise exception 'للمعلم فقط'; end if;
  case p_action
    when 'pin' then update ds_threads set pinned = p_value where id = p_id;
    when 'lock' then update ds_threads set locked = p_value where id = p_id;
    when 'hide' then update ds_threads set hidden = p_value where id = p_id;
    when 'answered' then update ds_threads set answered = p_value where id = p_id;
    when 'delete' then delete from ds_threads where id = p_id;
    when 'hide_post' then update ds_posts set hidden = p_value where id = p_id;
    when 'answer' then update ds_posts set is_answer = (id = p_id and p_value) where thread_id = p.thread_id; update ds_threads set answered = true where id = p.thread_id;
    when 'delete_post' then delete from ds_posts where id = p_id;
    else raise exception 'إجراء غير صالح';
  end case;
end $$;

create or replace function public.ds_settings_set(p_class int, p_subject int, p_students_can_post boolean, p_closed boolean) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if private.ds_role(p_class, p_subject) is distinct from 'mod' then raise exception 'للمعلم فقط'; end if;
  insert into ds_settings values (p_class, p_subject, p_students_can_post, p_closed)
  on conflict (class_id, subject_id) do update set students_can_post = excluded.students_can_post, closed = excluded.closed;
end $$;

revoke all on function private.ds_role(int, int), private.ds_notify(uuid[], text, text) from public, anon, authenticated;
revoke all on function public.ds_courses(), public.ds_list(int, int), public.ds_thread(bigint), public.ds_thread_add(jsonb), public.ds_post_add(bigint, text),
  public.ds_mod(text, bigint, boolean), public.ds_settings_set(int, int, boolean, boolean) from public, anon;
grant execute on function public.ds_courses(), public.ds_list(int, int), public.ds_thread(bigint), public.ds_thread_add(jsonb), public.ds_post_add(bigint, text),
  public.ds_mod(text, bigint, boolean), public.ds_settings_set(int, int, boolean, boolean) to authenticated;
