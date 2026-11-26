-- ============================================================
-- 74) مسارات التعلّم المتتابعة + المحتوى التفاعلي
-- خطوات: درس، فيديو (مع متابعة مدة المشاهدة)، نشاط تفاعلي H5P/رابط مضمّن، نشاط بإجابة، اختبار من المنصة.
-- في المسار المتتابع لا تُفتح الخطوة إلا بعد إنجاز السابقة، ويرى المعلم نسبة إنجاز كل طالب.
-- ============================================================

create table if not exists public.pth_paths (
  id          bigserial primary key,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  subject_id  integer references public.subjects(id) on delete set null,
  class_ids   integer[] not null default '{}',
  title       text not null check (btrim(title) <> ''),
  description text,
  sequential  boolean not null default true,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.pth_steps (
  id          bigserial primary key,
  path_id     bigint not null references public.pth_paths(id) on delete cascade,
  ord         smallint not null,
  kind        text not null check (kind in ('lesson','video','embed','activity','quiz','link')),
  title       text not null check (btrim(title) <> ''),
  body        text,
  url         text,
  exam_id     bigint references public.ex_exams(id) on delete set null,
  min_pct     smallint check (min_pct between 0 and 100),     -- للاختبار: أقل نسبة لاعتبار الخطوة منجزة
  min_watch   smallint check (min_watch between 0 and 600)    -- للفيديو: أقل مدة مشاهدة بالدقائق
);
create index if not exists pth_steps_p on public.pth_steps(path_id, ord);

create table if not exists public.pth_progress (
  step_id     bigint not null references public.pth_steps(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  done        boolean not null default false,
  seconds     integer not null default 0,
  answer      text,
  feedback    text,
  updated_at  timestamptz not null default now(),
  done_at     timestamptz,
  primary key (step_id, student_id)
);

alter table public.pth_paths enable row level security; alter table public.pth_steps enable row level security; alter table public.pth_progress enable row level security;
revoke all on public.pth_paths, public.pth_steps, public.pth_progress from anon, authenticated;

create or replace function private.pth_url(u text) returns text language sql immutable as $$
  select case when u ~* '^https://' then left(u, 1000) end
$$;

-- حالة الإنجاز الفعلية للخطوة (الاختبار يُحسب من محاولة الطالب)
create or replace function private.pth_done(s public.pth_steps, p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case when s.kind = 'quiz' then exists (select 1 from ex_attempts a where a.exam_id = s.exam_id and a.student_id = p_student and a.submitted_at is not null
                                                   and (s.min_pct is null or a.max_score = 0 or a.score * 100 / a.max_score >= s.min_pct))
              else coalesce((select done from pth_progress where step_id = s.id and student_id = p_student), false) end
$$;

-- ---------- المعلم ----------
create or replace function public.pth_list() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'subject_id', p.subject_id,
           'subject', (select name_ar from subjects where id = p.subject_id), 'class_ids', p.class_ids, 'sequential', p.sequential, 'published', p.published,
           'classes', (select jsonb_agg(label) from v_classes where id = any (p.class_ids)), 'mine', p.teacher_id = public.me_id(),
           'teacher', (select full_name from profiles where id = p.teacher_id),
           'steps', (select count(*) from pth_steps where path_id = p.id),
           'students', (select count(*) from students s where s.class_id = any (p.class_ids))) order by p.updated_at desc), '[]'::jsonb)
    from pth_paths p where p.teacher_id = public.me_id() or private.lp_is_reviewer(p.teacher_id)
$$;

create or replace function public.pth_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare p pth_paths;
begin
  select * into p from pth_paths where id = p_id;
  if p.id is null or not (p.teacher_id = public.me_id() or private.lp_is_reviewer(p.teacher_id)) then raise exception 'غير مصرح'; end if;
  return to_jsonb(p) || jsonb_build_object('steps', coalesce((select jsonb_agg(to_jsonb(s) || jsonb_build_object('exam', (select title from ex_exams where id = s.exam_id)) order by s.ord)
            from pth_steps s where s.path_id = p_id), '[]'::jsonb), 'mine', p.teacher_id = public.me_id());
end $$;

create or replace function public.pth_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare pid bigint := nullif(p->>'id', '')::bigint; me uuid := public.me_id(); cls int[]; st jsonb; i int := 0; keep bigint[] := '{}'; sid bigint; k text;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'اكتب عنوان المسار'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]')) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c)) then
    raise exception 'اختر من فصولك فقط'; end if;
  if pid is null then
    insert into pth_paths(teacher_id, subject_id, class_ids, title, description, sequential, published)
    values (me, nullif(p->>'subject_id', '')::int, cls, btrim(p->>'title'), nullif(btrim(p->>'description'), ''), coalesce((p->>'sequential')::boolean, true),
            coalesce((p->>'published')::boolean, false)) returning id into pid;
  else
    update pth_paths set subject_id = nullif(p->>'subject_id', '')::int, class_ids = cls, title = btrim(p->>'title'), description = nullif(btrim(p->>'description'), ''),
           sequential = coalesce((p->>'sequential')::boolean, sequential), published = coalesce((p->>'published')::boolean, published), updated_at = now()
     where id = pid and teacher_id = me;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  for st in select * from jsonb_array_elements(coalesce(p->'steps', '[]')) loop
    i := i + 1; k := coalesce(st->>'kind', 'lesson');
    if coalesce(btrim(st->>'title'), '') = '' then raise exception 'اكتب عنوان الخطوة %', i; end if;
    if k in ('video','embed','link') and private.pth_url(st->>'url') is null then raise exception 'الخطوة % تحتاج رابطًا يبدأ بـ https://', i; end if;
    if k = 'quiz' and not exists (select 1 from ex_exams where id = nullif(st->>'exam_id', '')::bigint and teacher_id = me) then raise exception 'اختر اختبارًا من اختباراتك للخطوة %', i; end if;
    sid := nullif(st->>'id', '')::bigint;
    if sid is not null and exists (select 1 from pth_steps where id = sid and path_id = pid) then
      update pth_steps set ord = i, kind = k, title = btrim(st->>'title'), body = nullif(left(st->>'body', 20000), ''), url = private.pth_url(st->>'url'),
             exam_id = nullif(st->>'exam_id', '')::bigint, min_pct = nullif(st->>'min_pct', '')::smallint, min_watch = nullif(st->>'min_watch', '')::smallint where id = sid;
    else
      insert into pth_steps(path_id, ord, kind, title, body, url, exam_id, min_pct, min_watch)
      values (pid, i, k, btrim(st->>'title'), nullif(left(st->>'body', 20000), ''), private.pth_url(st->>'url'), nullif(st->>'exam_id', '')::bigint,
              nullif(st->>'min_pct', '')::smallint, nullif(st->>'min_watch', '')::smallint) returning id into sid;
    end if;
    keep := keep || sid;
  end loop;
  delete from pth_steps where path_id = pid and not (id = any (keep));
  return pid;
end $$;

create or replace function public.pth_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  delete from pth_paths where id = p_id and teacher_id = public.me_id();
end $$;

-- تقرير الإنجاز: الطلاب × الخطوات
create or replace function public.pth_report(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare p pth_paths;
begin
  select * into p from pth_paths where id = p_id;
  if p.id is null or not (p.teacher_id = public.me_id() or private.lp_is_reviewer(p.teacher_id)) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('title', p.title, 'steps', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'kind', kind) order by ord) from pth_steps where path_id = p_id), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'name', pr.full_name, 'class', (select name from classes where id = s.class_id),
        'done', coalesce((select jsonb_object_agg(x.id, jsonb_build_object('d', private.pth_done(x, pr.id), 'sec', g.seconds, 'a', g.answer, 'f', g.feedback))
                          from pth_steps x left join pth_progress g on g.step_id = x.id and g.student_id = pr.id where x.path_id = p_id), '{}'::jsonb)) order by pr.full_name)
      from students s join profiles pr on pr.id = s.profile_id and pr.active where s.class_id = any (p.class_ids)), '[]'::jsonb));
end $$;

-- تعليق المعلم على إجابة نشاط
create or replace function public.pth_feedback(p_step bigint, p_student uuid, p_feedback text, p_reopen boolean default false) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not exists (select 1 from pth_steps s join pth_paths p on p.id = s.path_id where s.id = p_step and p.teacher_id = public.me_id()) then raise exception 'غير مصرح'; end if;
  update pth_progress set feedback = nullif(btrim(p_feedback), ''), done = case when p_reopen then false else done end, updated_at = now()
   where step_id = p_step and student_id = p_student;
end $$;

-- ---------- الطالب ----------
create or replace function public.pth_my() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'subject', (select name_ar from subjects where id = p.subject_id),
           'teacher', (select full_name from profiles where id = p.teacher_id), 'sequential', p.sequential,
           'steps', (select count(*) from pth_steps where path_id = p.id),
           'done', (select count(*) from pth_steps s where s.path_id = p.id and private.pth_done(s, public.me_id()))) order by p.updated_at desc), '[]'::jsonb)
    from pth_paths p where p.published and private.my_class_id() = any (p.class_ids)
$$;

create or replace function public.pth_open(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare p pth_paths; me uuid := public.me_id(); s pth_steps; out jsonb := '[]'; prev boolean := true; d boolean; g pth_progress;
begin
  select * into p from pth_paths where id = p_id and published;
  if p.id is null or not (private.my_class_id() = any (p.class_ids)) then raise exception 'غير متاح'; end if;
  for s in select * from pth_steps where path_id = p_id order by ord loop
    d := private.pth_done(s, me);
    select * into g from pth_progress where step_id = s.id and student_id = me;
    out := out || jsonb_build_object('id', s.id, 'kind', s.kind, 'title', s.title, 'done', d, 'locked', p.sequential and not prev,
      'body', case when p.sequential and not prev then null else s.body end, 'url', case when p.sequential and not prev then null else s.url end,
      'exam_id', s.exam_id, 'min_pct', s.min_pct, 'min_watch', s.min_watch, 'seconds', coalesce(g.seconds, 0), 'answer', g.answer, 'feedback', g.feedback);
    prev := prev and d;
  end loop;
  return jsonb_build_object('id', p.id, 'title', p.title, 'description', p.description, 'sequential', p.sequential, 'steps', out);
end $$;

-- تسجيل تقدّم: مدة مشاهدة/تفاعل (ثوانٍ تُضاف)، أو إنجاز، أو إجابة نشاط
create or replace function public.pth_progress_set(p_step bigint, p_add_seconds int default 0, p_done boolean default false, p_answer text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s pth_steps; p pth_paths; me uuid := public.me_id(); g pth_progress; prev_ok boolean;
begin
  select * into s from pth_steps where id = p_step;
  select * into p from pth_paths where id = s.path_id and published;
  if p.id is null or not (private.my_class_id() = any (p.class_ids)) then raise exception 'غير متاح'; end if;
  if s.kind = 'quiz' then raise exception 'تُنجز خطوة الاختبار بتسليم الاختبار'; end if;
  if p.sequential then
    select bool_and(private.pth_done(x, me)) into prev_ok from pth_steps x where x.path_id = p.id and x.ord < s.ord;
    if not coalesce(prev_ok, true) then raise exception 'أكمل الخطوات السابقة أولًا'; end if;
  end if;
  insert into pth_progress(step_id, student_id) values (p_step, me) on conflict do nothing;
  update pth_progress set seconds = least(seconds + greatest(0, least(coalesce(p_add_seconds, 0), 120)), 36000),
         answer = coalesce(nullif(left(btrim(p_answer), 8000), ''), answer), updated_at = now()
   where step_id = p_step and student_id = me returning * into g;
  if p_done then
    if s.kind = 'video' and coalesce(s.min_watch, 0) > 0 and g.seconds < s.min_watch * 60 * 0.9 then
      raise exception 'شاهد الفيديو أولًا (المطلوب % دقيقة تقريبًا)', s.min_watch; end if;
    if s.kind = 'activity' and g.answer is null then raise exception 'اكتب إجابتك للنشاط أولًا'; end if;
    update pth_progress set done = true, done_at = coalesce(done_at, now()) where step_id = p_step and student_id = me;
  end if;
  return jsonb_build_object('ok', true, 'seconds', g.seconds);
end $$;

revoke all on function private.pth_url(text), private.pth_done(public.pth_steps, uuid) from public, anon, authenticated;
revoke all on function public.pth_list(), public.pth_get(bigint), public.pth_save(jsonb), public.pth_delete(bigint), public.pth_report(bigint),
  public.pth_feedback(bigint, uuid, text, boolean), public.pth_my(), public.pth_open(bigint), public.pth_progress_set(bigint, int, boolean, text) from public, anon;
grant execute on function public.pth_list(), public.pth_get(bigint), public.pth_save(jsonb), public.pth_delete(bigint), public.pth_report(bigint),
  public.pth_feedback(bigint, uuid, text, boolean), public.pth_my(), public.pth_open(bigint), public.pth_progress_set(bigint, int, boolean, text) to authenticated;
