-- =====================================================================
-- 36: وحدة «صفحات المواد» — صفحة لكل (مادة × فصل): المحتوى الأسبوعي والإعلانات
--   المعلم: ينشر محتوى أسبوعيًا (شرح، روابط، ملفات) أو إعلانًا لفصل أو أكثر من فصول المادة نفسها
--   الطالب: يرى صفحات مواد فصله (المادة + المعلم + المنشورات)
--   المتابعة: المشرف/مدير المرحلة/الإدارة يرون صفحات معلميهم (قراءة فقط)
-- =====================================================================
create table if not exists public.course_posts (
  id          bigserial primary key,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  subject_id  int not null references public.subjects(id) on delete cascade,
  class_ids   int[] not null default '{}',
  kind        text not null default 'content' check (kind in ('content','announcement')),
  title       text not null,
  body        text,
  links       jsonb not null default '[]'::jsonb,
  week_start  date,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists course_posts_teacher_idx on public.course_posts (teacher_id, subject_id);
create index if not exists course_posts_classes_idx on public.course_posts using gin (class_ids);
alter table public.course_posts enable row level security;
revoke all on public.course_posts from anon, authenticated;

-- هل يحق لي رؤية صفحة (فصل × مادة)؟
create or replace function private.cp_can_view(p_class int, p_subject int) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
       public.me_role() in ('admin','leadership')
    or private.my_class_id() = p_class
    or exists (select 1 from teaching_assignments ta where ta.class_id = p_class and ta.subject_id = p_subject
                 and (ta.teacher_id = public.me_id() or private.lp_is_reviewer(ta.teacher_id)))
  , false)
$$;

-- المقررات: للمعلم مواده × فصوله، وللطالب مواد فصله، وللمتابع مقررات معلميه
create or replace function public.cp_courses() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); cid int := private.my_class_id();
begin
  if me is null then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('class_id', x.class_id, 'subject_id', x.subject_id, 'subject', s.name_ar, 'class', vc.label,
             'teachers', x.teachers, 'mine', x.mine,
             'posts', (select count(*) from course_posts cp where cp.subject_id = x.subject_id and x.class_id = any (cp.class_ids)),
             'last_at', (select max(cp.created_at) from course_posts cp where cp.subject_id = x.subject_id and x.class_id = any (cp.class_ids)))
           order by x.mine desc, vc.stage_sort, vc.grade_number, vc.name, s.name_ar)
      from (select ta.class_id, ta.subject_id, jsonb_agg(distinct p.full_name) teachers, bool_or(ta.teacher_id = me) mine
              from teaching_assignments ta join profiles p on p.id = ta.teacher_id
             where ta.teacher_id = me or ta.class_id = cid or private.lp_is_reviewer(ta.teacher_id)
             group by ta.class_id, ta.subject_id) x
      join subjects s on s.id = x.subject_id join v_classes vc on vc.id = x.class_id), '[]'::jsonb);
end $$;

create or replace function public.cp_list(p_class int, p_subject int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if not private.cp_can_view(p_class, p_subject) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'can_post', exists (select 1 from teaching_assignments where teacher_id = me and class_id = p_class and subject_id = p_subject),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', cp.id, 'kind', cp.kind, 'title', cp.title, 'body', cp.body, 'links', cp.links,
                'week', cp.week_start, 'pinned', cp.pinned, 'at', cp.created_at, 'updated', cp.updated_at, 'class_ids', to_jsonb(cp.class_ids),
                'teacher', (select full_name from profiles where id = cp.teacher_id), 'mine', cp.teacher_id = me)
              order by cp.pinned desc, coalesce(cp.week_start, cp.created_at::date) desc, cp.created_at desc)
              from course_posts cp where cp.subject_id = p_subject and p_class = any (cp.class_ids)), '[]'::jsonb));
end $$;

create or replace function public.cp_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); pid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int; cls int[];
        ttl text := btrim(coalesce(p->>'title','')); knd text := coalesce(nullif(p->>'kind',''), 'content');
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان المنشور'; end if;
  if sid is null then raise exception 'المادة مطلوبة'; end if;
  if knd not in ('content','announcement') then raise exception 'نوع غير صالح'; end if;
  if length(coalesce(p->>'body','')) > 30000 then raise exception 'النص طويل جدًا'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c and ta.subject_id = sid)) then
    raise exception 'اختر من فصولك التي تدرّس لها هذه المادة فقط'; end if;
  if pid is null then
    insert into course_posts(teacher_id, subject_id, class_ids, kind, title, body, links, week_start, pinned)
    values (me, sid, cls, knd, left(ttl, 200), nullif(btrim(coalesce(p->>'body','')), ''), private.hw_clean_links(p->'links'),
            nullif(p->>'week','')::date, coalesce((p->>'pinned')::boolean, false)) returning id into pid;
  else
    update course_posts set class_ids = cls, kind = knd, title = left(ttl, 200), body = nullif(btrim(coalesce(p->>'body','')), ''),
           links = private.hw_clean_links(p->'links'), week_start = nullif(p->>'week','')::date, pinned = coalesce((p->>'pinned')::boolean, false), updated_at = now()
     where id = pid and teacher_id = me and subject_id = sid;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', pid);
end $$;

create or replace function public.cp_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from course_posts where id = p_id and teacher_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.cp_can_view(int, int) from public, anon, authenticated;
revoke all on function public.cp_courses(), public.cp_list(int, int), public.cp_save(jsonb), public.cp_delete(bigint) from public, anon;
grant execute on function public.cp_courses(), public.cp_list(int, int), public.cp_save(jsonb), public.cp_delete(bigint) to authenticated;
