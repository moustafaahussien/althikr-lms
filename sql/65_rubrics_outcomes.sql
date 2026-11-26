-- ============================================================
-- 65) سلالم التقدير (Rubrics) ونواتج التعلم
-- • نواتج التعلم لكل مادة وصف.
-- • سلالم تقدير بمعايير ومستويات، يُربط كل معيار بناتج تعلم.
-- • تقييم فصل كامل بالسلّم، وترحيل المجموع اختياريًا إلى سجل الدرجات.
-- • تقرير إتقان النواتج لكل طالب وللفصل.
-- ============================================================

create table if not exists public.lo_outcomes (
  id          bigserial primary key,
  subject_id  integer not null references public.subjects(id) on delete cascade,
  grade_id    integer references public.grades(id) on delete cascade,   -- null = كل الصفوف
  code        text,
  text        text not null check (btrim(text) <> ''),
  domain      text,
  active      boolean not null default true,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists lo_outcomes_sg on public.lo_outcomes(subject_id, grade_id);

create table if not exists public.rb_rubrics (
  id          bigserial primary key,
  owner_id    uuid references public.profiles(id) on delete cascade,      -- null = قالب المدرسة
  title       text not null check (btrim(title) <> ''),
  subject_id  integer references public.subjects(id) on delete set null,
  grade_id    integer references public.grades(id) on delete set null,
  levels      jsonb not null,      -- [{label, points}] من الأعلى للأدنى
  criteria    jsonb not null,      -- [{key, name, weight, outcome_id, desc: [وصف لكل مستوى]}]
  shared      boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.rb_evals (
  id          bigserial primary key,
  rubric_id   bigint not null references public.rb_rubrics(id) on delete restrict,
  snapshot    jsonb not null,      -- نسخة السلّم وقت التقييم (حتى لا يتأثر بتعديله لاحقًا)
  class_id    integer not null references public.classes(id) on delete cascade,
  subject_id  integer not null references public.subjects(id) on delete cascade,
  teacher_id  uuid references public.profiles(id) on delete set null,
  title       text not null,
  eval_date   date not null default current_date,
  gb_item_id  bigint references public.gb_items(id) on delete set null,
  show_student boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists rb_evals_cs on public.rb_evals(class_id, subject_id);

create table if not exists public.rb_scores (
  eval_id     bigint not null references public.rb_evals(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  marks       jsonb not null default '{}'::jsonb,   -- {criterion_key: points}
  total       numeric(7,2),
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (eval_id, student_id)
);

alter table public.lo_outcomes enable row level security;
alter table public.rb_rubrics enable row level security;
alter table public.rb_evals enable row level security;
alter table public.rb_scores enable row level security;
revoke all on public.lo_outcomes, public.rb_rubrics, public.rb_evals, public.rb_scores from anon, authenticated;

-- من يحرر نواتج مادة: الإدارة/المشرفون/مديرو المراحل، أو معلم يدرّس المادة
create or replace function private.lo_can_edit(p_subject int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_role() in ('admin','leadership','supervisor','principal')
      or exists (select 1 from teaching_assignments where teacher_id = public.me_id() and subject_id = p_subject)
$$;

create or replace function private.rb_max(r jsonb) returns numeric
language sql immutable as $$
  select coalesce(sum(coalesce((c->>'weight')::numeric, 1)), 0) * coalesce((select max((l->>'points')::numeric) from jsonb_array_elements(r->'levels') l), 0)
    from jsonb_array_elements(r->'criteria') c
$$;

create or replace function private.rb_json(r public.rb_rubrics) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'title', r.title, 'subject_id', r.subject_id, 'grade_id', r.grade_id,
    'subject', (select name_ar from subjects where id = r.subject_id), 'grade', (select name_ar from grades where id = r.grade_id),
    'levels', r.levels, 'criteria', r.criteria, 'shared', r.shared, 'template', r.owner_id is null,
    'mine', r.owner_id = public.me_id(), 'owner', (select full_name from profiles where id = r.owner_id),
    'can_edit', r.owner_id = public.me_id() or (r.owner_id is null and public.me_role() in ('admin','leadership')),
    'max', private.rb_max(jsonb_build_object('levels', r.levels, 'criteria', r.criteria)),
    'uses', (select count(*) from rb_evals where rubric_id = r.id))
$$;

-- ---------- السياق: فصولي وموادي + المواد والصفوف ----------
create or replace function public.rb_ctx() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'role', public.me_role(),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id, 'class', vc.label, 'grade_id', vc.grade_id,
              'subject', s.name_ar) order by vc.stage_sort, vc.grade_number, vc.name, s.name_ar)
            from teaching_assignments ta join v_classes vc on vc.id = ta.class_id join subjects s on s.id = ta.subject_id where ta.teacher_id = public.me_id()), '[]'::jsonb),
    'review', coalesce((select jsonb_agg(distinct jsonb_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id, 'class', vc.label, 'subject', s.name_ar,
              'teacher', p.full_name))
            from teaching_assignments ta join v_classes vc on vc.id = ta.class_id join subjects s on s.id = ta.subject_id join profiles p on p.id = ta.teacher_id
           where ta.teacher_id <> public.me_id() and private.lp_is_reviewer(ta.teacher_id)
             and exists (select 1 from rb_evals e where e.class_id = ta.class_id and e.subject_id = ta.subject_id)), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name_ar) order by name_ar) from subjects where active), '[]'::jsonb),
    'grades', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name_ar || ' — ' || st.name_ar) order by st.sort, g.number)
            from grades g join stages st on st.id = g.stage_id), '[]'::jsonb))
$$;

-- ---------- نواتج التعلم ----------
create or replace function public.lo_list(p_subject int, p_grade int default null) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'code', o.code, 'text', o.text, 'domain', o.domain, 'grade_id', o.grade_id,
           'grade', (select name_ar from grades where id = o.grade_id), 'by', (select full_name from profiles where id = o.created_by),
           'can_edit', private.lo_can_edit(o.subject_id)) order by o.grade_id nulls first, o.code nulls last, o.id), '[]'::jsonb)
    from lo_outcomes o
   where public.is_staff() and o.active and o.subject_id = p_subject and (p_grade is null or o.grade_id is null or o.grade_id = p_grade)
$$;

create or replace function public.lo_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare oid bigint := nullif(p->>'id', '')::bigint; sid int := (p->>'subject_id')::int; o lo_outcomes;
begin
  if oid is not null then select * into o from lo_outcomes where id = oid; sid := o.subject_id; end if;
  if sid is null or not private.lo_can_edit(sid) then raise exception 'غير مصرح'; end if;
  if nullif(btrim(p->>'text'), '') is null then raise exception 'اكتب نص الناتج'; end if;
  if oid is null then
    insert into lo_outcomes(subject_id, grade_id, code, text, domain, created_by)
    values (sid, nullif(p->>'grade_id', '')::int, nullif(btrim(p->>'code'), ''), btrim(p->>'text'), nullif(btrim(p->>'domain'), ''), public.me_id())
    returning id into oid;
  else
    update lo_outcomes set grade_id = nullif(p->>'grade_id', '')::int, code = nullif(btrim(p->>'code'), ''), text = btrim(p->>'text'),
           domain = nullif(btrim(p->>'domain'), '') where id = oid;
  end if;
  return oid;
end $$;

-- إضافة عدة نواتج دفعة واحدة (سطر لكل ناتج، ويمكن بدء السطر برمز مثل «ع.1 - …»)
create or replace function public.lo_bulk(p_subject int, p_grade int, p_lines text) returns int
language plpgsql security definer set search_path = public, private as $$
declare ln text; n int := 0; m text[];
begin
  if not private.lo_can_edit(p_subject) then raise exception 'غير مصرح'; end if;
  foreach ln in array regexp_split_to_array(coalesce(p_lines, ''), E'\\n') loop
    ln := btrim(ln); if ln = '' then continue; end if;
    m := regexp_match(ln, '^([^\s\-–:]{1,12})\s*[\-–:]\s*(.+)$');
    insert into lo_outcomes(subject_id, grade_id, code, text, created_by)
    values (p_subject, p_grade, case when m is not null then m[1] end, coalesce(m[2], ln), public.me_id());
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.lo_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare o lo_outcomes;
begin
  select * into o from lo_outcomes where id = p_id;
  if o.id is null or not private.lo_can_edit(o.subject_id) then raise exception 'غير مصرح'; end if;
  update lo_outcomes set active = false where id = p_id;   -- حذف ناعم حتى لا تتأثر التقارير السابقة
end $$;

-- ---------- سلالم التقدير ----------
create or replace function public.rb_list() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(private.rb_json(r) order by r.owner_id is null, r.owner_id = public.me_id() desc, r.updated_at desc), '[]'::jsonb)
    from rb_rubrics r where public.is_staff() and (r.owner_id is null or r.owner_id = public.me_id() or r.shared)
$$;

create or replace function private.rb_clean(p jsonb, out lv jsonb, out cr jsonb) language plpgsql immutable as $$
declare c jsonb; i int := 0;
begin
  if jsonb_typeof(p->'levels') <> 'array' or jsonb_array_length(p->'levels') not between 2 and 6 then raise exception 'حدّد من 2 إلى 6 مستويات'; end if;
  select jsonb_agg(jsonb_build_object('label', btrim(l->>'label'), 'points', (l->>'points')::numeric) order by (l->>'points')::numeric desc)
    into lv from jsonb_array_elements(p->'levels') l;
  if exists (select 1 from jsonb_array_elements(lv) l where coalesce(l->>'label', '') = '' or (l->>'points')::numeric < 0) then raise exception 'أكمل أسماء المستويات ونقاطها'; end if;
  if jsonb_typeof(p->'criteria') <> 'array' or jsonb_array_length(p->'criteria') not between 1 and 15 then raise exception 'أضف من 1 إلى 15 معيارًا'; end if;
  cr := '[]'::jsonb;
  for c in select * from jsonb_array_elements(p->'criteria') loop
    i := i + 1;
    if coalesce(btrim(c->>'name'), '') = '' then raise exception 'اكتب اسم المعيار %', i; end if;
    cr := cr || jsonb_build_object('key', coalesce(nullif(c->>'key', ''), 'c' || i || '_' || substr(md5(random()::text), 1, 4)), 'name', btrim(c->>'name'),
      'weight', greatest(coalesce(nullif(c->>'weight', '')::numeric, 1), 0.1), 'outcome_id', nullif(c->>'outcome_id', '')::bigint,
      'desc', coalesce(c->'desc', '[]'::jsonb));
  end loop;
end $$;

create or replace function public.rb_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare rid bigint := nullif(p->>'id', '')::bigint; r rb_rubrics; lv jsonb; cr jsonb; tpl boolean := coalesce((p->>'template')::boolean, false);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'اكتب عنوان السلّم'; end if;
  select * into lv, cr from private.rb_clean(p);
  if rid is null then
    if tpl and public.me_role() not in ('admin','leadership') then raise exception 'قوالب المدرسة للإدارة فقط'; end if;
    insert into rb_rubrics(owner_id, title, subject_id, grade_id, levels, criteria, shared)
    values (case when tpl then null else public.me_id() end, btrim(p->>'title'), nullif(p->>'subject_id', '')::int, nullif(p->>'grade_id', '')::int,
            lv, cr, coalesce((p->>'shared')::boolean, false)) returning id into rid;
  else
    select * into r from rb_rubrics where id = rid;
    if not (r.owner_id = public.me_id() or (r.owner_id is null and public.me_role() in ('admin','leadership'))) then raise exception 'غير مصرح'; end if;
    update rb_rubrics set title = btrim(p->>'title'), subject_id = nullif(p->>'subject_id', '')::int, grade_id = nullif(p->>'grade_id', '')::int,
           levels = lv, criteria = cr, shared = coalesce((p->>'shared')::boolean, shared), updated_at = now() where id = rid;
  end if;
  return rid;
end $$;

create or replace function public.rb_copy(p_id bigint) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare r rb_rubrics; nid bigint;
begin
  select * into r from rb_rubrics where id = p_id and (owner_id is null or owner_id = public.me_id() or shared);
  if r.id is null or not public.is_staff() then raise exception 'غير مصرح'; end if;
  insert into rb_rubrics(owner_id, title, subject_id, grade_id, levels, criteria, shared)
  values (public.me_id(), left(r.title || ' (نسخة)', 150), r.subject_id, r.grade_id, r.levels, r.criteria, false) returning id into nid;
  return nid;
end $$;

create or replace function public.rb_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare r rb_rubrics;
begin
  select * into r from rb_rubrics where id = p_id;
  if not (r.owner_id = public.me_id() or (r.owner_id is null and public.me_role() in ('admin','leadership'))) then raise exception 'غير مصرح'; end if;
  if exists (select 1 from rb_evals where rubric_id = p_id) then
    raise exception 'هذا السلّم مستخدم في تقييمات سابقة، فلا يمكن حذفه — عدّله أو أنشئ نسخة جديدة';
  end if;
  delete from rb_rubrics where id = p_id;
end $$;

-- ---------- التقييم بالسلّم ----------
create or replace function public.rb_evals_list(p_class int, p_subject int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.gb_can_view(p_class, p_subject) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'date', e.eval_date, 'rubric', e.snapshot->>'title',
            'max', private.rb_max(e.snapshot), 'gb', e.gb_item_id is not null, 'show', e.show_student,
            'done', (select count(*) from rb_scores s where s.eval_id = e.id and s.total is not null),
            'avg', (select round(avg(s.total) * 100 / nullif(private.rb_max(e.snapshot), 0)) from rb_scores s where s.eval_id = e.id and s.total is not null))
           order by e.eval_date desc, e.id desc)
    from rb_evals e where e.class_id = p_class and e.subject_id = p_subject), '[]'::jsonb);
end $$;

create or replace function public.rb_eval_create(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare cid int := (p->>'class_id')::int; sid int := (p->>'subject_id')::int; r rb_rubrics; eid bigint; gid jsonb; snap jsonb;
begin
  if cid is null or sid is null or not private.gb_can_edit(cid, sid) then raise exception 'غير مصرح — التقييم لمعلم المادة في هذا الفصل'; end if;
  select * into r from rb_rubrics where id = (p->>'rubric_id')::bigint and (owner_id is null or owner_id = public.me_id() or shared);
  if r.id is null then raise exception 'اختر سلّم التقدير'; end if;
  if coalesce(btrim(p->>'title'), '') = '' then raise exception 'اكتب عنوان التقييم'; end if;
  snap := jsonb_build_object('title', r.title, 'levels', r.levels, 'criteria', r.criteria);
  insert into rb_evals(rubric_id, snapshot, class_id, subject_id, teacher_id, title, eval_date, show_student)
  values (r.id, snap, cid, sid, public.me_id(), left(btrim(p->>'title'), 150), coalesce(nullif(p->>'date', '')::date, current_date),
          coalesce((p->>'show_student')::boolean, true)) returning id into eid;
  if coalesce((p->>'to_gradebook')::boolean, false) then
    gid := public.gb_item_save(jsonb_build_object('class_id', cid, 'subject_id', sid, 'kind', 'manual', 'title', '🧩 ' || left(btrim(p->>'title'), 110),
             'category', coalesce(nullif(p->>'category', ''), 'project'), 'max_score', private.rb_max(snap),
             'weight', coalesce(nullif(p->>'weight', ''), '1'), 'period', nullif(p->>'period', ''), 'date', coalesce(nullif(p->>'date', ''), current_date::text)));
    update rb_evals set gb_item_id = (gid->>'id')::bigint where id = eid;
  end if;
  return eid;
end $$;

create or replace function public.rb_eval_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare e rb_evals;
begin
  select * into e from rb_evals where id = p_id;
  if e.id is null or not private.gb_can_view(e.class_id, e.subject_id) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('id', e.id, 'title', e.title, 'date', e.eval_date, 'rubric', e.snapshot, 'max', private.rb_max(e.snapshot),
    'class', (select label from v_classes where id = e.class_id), 'subject', (select name_ar from subjects where id = e.subject_id),
    'gb', e.gb_item_id is not null, 'show', e.show_student, 'can_edit', private.gb_can_edit(e.class_id, e.subject_id),
    'outcomes', coalesce((select jsonb_object_agg(o.id, coalesce(o.code || ' — ', '') || o.text) from lo_outcomes o
                 where o.id in (select (c->>'outcome_id')::bigint from jsonb_array_elements(e.snapshot->'criteria') c where c->>'outcome_id' is not null)), '{}'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'marks', coalesce(s.marks, '{}'::jsonb), 'total', s.total, 'note', s.note) order by p.full_name)
                 from students st join profiles p on p.id = st.profile_id and p.active left join rb_scores s on s.eval_id = e.id and s.student_id = p.id
                where st.class_id = e.class_id), '[]'::jsonb));
end $$;

-- حفظ التقييمات: rows = [{student, marks:{key:points}, note}] — المجموع يُحسب هنا ويُرحّل لسجل الدرجات إن كان مربوطًا
create or replace function public.rb_eval_save(p_id bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare e rb_evals; r jsonb; mk jsonb; tot numeric; c jsonb; v numeric; pts numeric[]; n int := 0; gb jsonb := '[]'::jsonb; full_ boolean;
begin
  select * into e from rb_evals where id = p_id;
  if e.id is null or not private.gb_can_edit(e.class_id, e.subject_id) then raise exception 'غير مصرح'; end if;
  select array_agg((l->>'points')::numeric) into pts from jsonb_array_elements(e.snapshot->'levels') l;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if not exists (select 1 from students where profile_id = (r->>'student')::uuid and class_id = e.class_id) then raise exception 'طالب ليس من هذا الفصل'; end if;
    mk := '{}'::jsonb; tot := 0; full_ := true;
    for c in select * from jsonb_array_elements(e.snapshot->'criteria') loop
      v := nullif(r->'marks'->>(c->>'key'), '')::numeric;
      if v is null then full_ := false; continue; end if;
      if not (v = any (pts)) then raise exception 'قيمة غير صالحة للمعيار %', c->>'name'; end if;
      mk := mk || jsonb_build_object(c->>'key', v);
      tot := tot + v * coalesce((c->>'weight')::numeric, 1);
    end loop;
    if mk = '{}'::jsonb and nullif(btrim(r->>'note'), '') is null then
      delete from rb_scores where eval_id = p_id and student_id = (r->>'student')::uuid;
      if e.gb_item_id is not null then gb := gb || jsonb_build_object('student', r->>'student', 'score', null); end if;
    else
      insert into rb_scores(eval_id, student_id, marks, total, note)
      values (p_id, (r->>'student')::uuid, mk, case when full_ then tot end, nullif(btrim(r->>'note'), ''))
      on conflict (eval_id, student_id) do update set marks = excluded.marks, total = excluded.total, note = excluded.note, updated_at = now();
      if e.gb_item_id is not null then gb := gb || jsonb_build_object('student', r->>'student', 'score', case when full_ then round(tot, 2) end); end if;
    end if;
    n := n + 1;
  end loop;
  if e.gb_item_id is not null and jsonb_array_length(gb) > 0 then perform public.gb_scores_save(e.gb_item_id, gb); end if;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

create or replace function public.rb_eval_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
declare e rb_evals;
begin
  select * into e from rb_evals where id = p_id;
  if e.id is null or not private.gb_can_edit(e.class_id, e.subject_id) then raise exception 'غير مصرح'; end if;
  if e.gb_item_id is not null then delete from gb_items where id = e.gb_item_id; end if;
  delete from rb_evals where id = p_id;
end $$;

-- ---------- إتقان نواتج التعلم (فصل + مادة) ----------
create or replace function public.lo_mastery(p_class int, p_subject int) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.gb_can_view(p_class, p_subject) then raise exception 'غير مصرح'; end if;
  return (with m as (
      select s.student_id, (c->>'outcome_id')::bigint oid,
             (s.marks->>(c->>'key'))::numeric / nullif((select max((l->>'points')::numeric) from jsonb_array_elements(e.snapshot->'levels') l), 0) * 100 pct
        from rb_evals e join rb_scores s on s.eval_id = e.id cross join lateral jsonb_array_elements(e.snapshot->'criteria') c
       where e.class_id = p_class and e.subject_id = p_subject and c->>'outcome_id' is not null and s.marks ? (c->>'key')),
    o as (select distinct oid from m)
    select jsonb_build_object(
      'outcomes', coalesce((select jsonb_agg(jsonb_build_object('id', lo.id, 'code', lo.code, 'text', lo.text,
                     'avg', (select round(avg(pct)) from m where m.oid = lo.id), 'n', (select count(distinct student_id) from m where m.oid = lo.id)) order by lo.code nulls last, lo.id)
                   from lo_outcomes lo where lo.id in (select oid from o)), '[]'::jsonb),
      'students', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name,
                     'v', coalesce((select jsonb_object_agg(x.oid, x.a) from (select oid, round(avg(pct)) a from m where m.student_id = p.id group by oid) x), '{}'::jsonb)) order by p.full_name)
                   from students st join profiles p on p.id = st.profile_id and p.active where st.class_id = p_class), '[]'::jsonb)));
end $$;

-- ---------- الطالب: نتائجي بسلالم التقدير ----------
create or replace function public.rb_my() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('title', e.title, 'date', e.eval_date, 'subject', (select name_ar from subjects where id = e.subject_id),
           'rubric', e.snapshot, 'marks', s.marks, 'total', s.total, 'max', private.rb_max(e.snapshot), 'note', s.note) order by e.eval_date desc), '[]'::jsonb)
    from rb_scores s join rb_evals e on e.id = s.eval_id
   where s.student_id = public.me_id() and e.show_student
$$;

-- ---------- قوالب جاهزة للمدرسة ----------
do $$
declare lv jsonb := '[{"label":"متميز","points":4},{"label":"متقدم","points":3},{"label":"متمكن","points":2},{"label":"مبتدئ","points":1}]';
begin
  if not exists (select 1 from rb_rubrics where owner_id is null) then
    insert into rb_rubrics(owner_id, title, levels, criteria) values
    (null, 'عرض تقديمي شفهي', lv, '[
      {"key":"c1","name":"المحتوى ودقة المعلومات","weight":2,"desc":["معلومات دقيقة وشاملة ومدعومة بأدلة","معلومات دقيقة مع نقص بسيط","معلومات صحيحة لكنها سطحية","معلومات ناقصة أو غير دقيقة"]},
      {"key":"c2","name":"التنظيم والتسلسل","weight":1,"desc":["تسلسل منطقي واضح ومقدمة وخاتمة قويتان","تسلسل واضح غالبًا","تسلسل مقبول مع بعض التشتت","عرض غير منظم"]},
      {"key":"c3","name":"مهارات الإلقاء والتواصل","weight":1,"desc":["صوت واضح وتواصل بصري مستمر وثقة عالية","إلقاء جيد مع تواصل بصري غالبًا","إلقاء مقبول مع قراءة متكررة","قراءة من الورقة دون تواصل"]},
      {"key":"c4","name":"الوسائل المساندة","weight":1,"desc":["وسائل جذابة تخدم الفكرة بدقة","وسائل مناسبة","وسائل محدودة الفائدة","لا توجد وسائل أو غير مناسبة"]},
      {"key":"c5","name":"إدارة الوقت والإجابة عن الأسئلة","weight":1,"desc":["التزام تام بالوقت وإجابات واثقة","التزام بالوقت وإجابات جيدة","تجاوز بسيط أو إجابات مترددة","تجاوز كبير وعجز عن الإجابة"]}]'),
    (null, 'مشروع بحثي / تطبيقي', lv, '[
      {"key":"c1","name":"تحديد المشكلة والأهداف","weight":1,"desc":["مشكلة واضحة وأهداف قابلة للقياس","مشكلة وأهداف واضحة","مشكلة عامة وأهداف غير محددة","لا توجد مشكلة واضحة"]},
      {"key":"c2","name":"جمع المعلومات والمصادر","weight":1,"desc":["مصادر متنوعة وموثوقة وموثّقة","مصادر موثوقة كافية","مصادر قليلة","مصادر غير موثوقة أو منعدمة"]},
      {"key":"c3","name":"التنفيذ والمنتج","weight":2,"desc":["منتج متقن ومبتكر يحقق الأهداف","منتج جيد يحقق معظم الأهداف","منتج مكتمل جزئيًا","منتج ضعيف أو غير مكتمل"]},
      {"key":"c4","name":"التفكير الناقد والإبداع","weight":1,"desc":["حلول أصيلة وتحليل عميق","أفكار جيدة وتحليل مناسب","أفكار مألوفة وتحليل محدود","لا يوجد تحليل"]},
      {"key":"c5","name":"العرض والتوثيق","weight":1,"desc":["توثيق كامل وعرض احترافي","توثيق وعرض جيدان","توثيق ناقص","لا يوجد توثيق"]}]'),
    (null, 'الكتابة والتعبير', lv, '[
      {"key":"c1","name":"الفكرة والمضمون","weight":2,"desc":["أفكار عميقة مترابطة ومدعومة بالأمثلة","أفكار واضحة مترابطة","أفكار بسيطة متفرقة","أفكار غامضة أو خارج الموضوع"]},
      {"key":"c2","name":"البناء والتنظيم","weight":1,"desc":["مقدمة وعرض وخاتمة متقنة مع فقرات مترابطة","بناء واضح","بناء مقبول","لا يوجد بناء واضح"]},
      {"key":"c3","name":"اللغة والأسلوب","weight":1,"desc":["أسلوب جميل وثروة لغوية","أسلوب سليم","أسلوب بسيط مع تكرار","أسلوب ركيك"]},
      {"key":"c4","name":"السلامة اللغوية والإملائية","weight":1,"desc":["لا أخطاء تقريبًا","أخطاء قليلة","أخطاء متكررة","أخطاء كثيرة تعيق الفهم"]},
      {"key":"c5","name":"علامات الترقيم والخط","weight":1,"desc":["توظيف دقيق وخط واضح","توظيف جيد","توظيف محدود","إهمال واضح"]}]'),
    (null, 'العمل التعاوني', lv, '[
      {"key":"c1","name":"المشاركة وتحمّل المسؤولية","weight":1,"desc":["يبادر وينجز دوره كاملًا ويساعد غيره","ينجز دوره كاملًا","ينجز دوره جزئيًا","لا يشارك"]},
      {"key":"c2","name":"التواصل واحترام الآراء","weight":1,"desc":["يستمع ويحاور ويحترم الجميع","يتواصل باحترام","يتواصل أحيانًا","يقاطع ولا يحترم الآراء"]},
      {"key":"c3","name":"حل المشكلات واتخاذ القرار","weight":1,"desc":["يقترح حلولًا ويقود للتوافق","يسهم في الحلول","يسهم قليلًا","لا يسهم"]},
      {"key":"c4","name":"جودة الإنجاز المشترك","weight":1,"desc":["إنجاز متميز في الوقت","إنجاز جيد في الوقت","إنجاز مقبول متأخر قليلًا","إنجاز ضعيف"]}]');
  end if;
end $$;

revoke all on function private.lo_can_edit(int), private.rb_max(jsonb), private.rb_json(public.rb_rubrics), private.rb_clean(jsonb) from public, anon, authenticated;
revoke all on function public.rb_ctx(), public.lo_list(int, int), public.lo_save(jsonb), public.lo_bulk(int, int, text), public.lo_delete(bigint),
  public.rb_list(), public.rb_save(jsonb), public.rb_copy(bigint), public.rb_delete(bigint), public.rb_evals_list(int, int), public.rb_eval_create(jsonb),
  public.rb_eval_get(bigint), public.rb_eval_save(bigint, jsonb), public.rb_eval_delete(bigint), public.lo_mastery(int, int), public.rb_my() from public, anon;
grant execute on function public.rb_ctx(), public.lo_list(int, int), public.lo_save(jsonb), public.lo_bulk(int, int, text), public.lo_delete(bigint),
  public.rb_list(), public.rb_save(jsonb), public.rb_copy(bigint), public.rb_delete(bigint), public.rb_evals_list(int, int), public.rb_eval_create(jsonb),
  public.rb_eval_get(bigint), public.rb_eval_save(bigint, jsonb), public.rb_eval_delete(bigint), public.lo_mastery(int, int), public.rb_my() to authenticated;
