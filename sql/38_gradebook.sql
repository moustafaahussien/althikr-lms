-- =====================================================================
-- 38: وحدة «سجل الدرجات» — تجميع تلقائي لدرجات الواجبات والاختبارات
--   لكل (فصل × مادة) سجلّ: أعمدة تلقائية من الواجبات (sql/34) والاختبارات (sql/37)
--   + أعمدة يدوية يضيفها المعلم (مشاركة، مشروع، اختبار ورقي…) بوزن لكل عمود
--   النسبة النهائية = متوسط موزون لنِسَب الأعمدة المرصودة للطالب
--   الطالب يرى درجاته فقط، والمعلم يرصد لفصوله، والمشرف/المدير يتابع
-- =====================================================================
create table if not exists public.gb_items (
  id          bigserial primary key,
  teacher_id  uuid not null references public.profiles(id) on delete cascade,
  class_id    int not null references public.classes(id) on delete cascade,
  subject_id  int not null references public.subjects(id) on delete cascade,
  src_kind    text not null default 'manual' check (src_kind in ('manual','hw','ex')),
  src_id      bigint,                                   -- لعمود تلقائي: رقم الواجب/الاختبار (الصف هنا يحفظ الوزن/الإخفاء فقط)
  title       text,
  category    text not null default 'other' check (category in ('homework','exam','quiz','participation','project','oral','other')),
  max_score   numeric(6,2) check (max_score is null or (max_score > 0 and max_score <= 1000)),
  weight      numeric(5,2) not null default 1 check (weight >= 0 and weight <= 100),
  hidden      boolean not null default false,          -- إخفاء العمود من السجل والحساب
  item_date   date not null default current_date,
  created_at  timestamptz not null default now(),
  check ((src_kind = 'manual') = (src_id is null)),
  check (src_kind <> 'manual' or (title is not null and max_score is not null))
);
create unique index if not exists gb_items_src_uq on public.gb_items (class_id, subject_id, src_kind, src_id) where src_kind <> 'manual';
create index if not exists gb_items_cs_idx on public.gb_items (class_id, subject_id);

create table if not exists public.gb_scores (
  item_id     bigint not null references public.gb_items(id) on delete cascade,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  score       numeric(6,2) not null,
  note        text,
  updated_at  timestamptz not null default now(),
  primary key (item_id, student_id)
);
create index if not exists gb_scores_student_idx on public.gb_scores (student_id);

alter table public.gb_items enable row level security;
alter table public.gb_scores enable row level security;
revoke all on public.gb_items, public.gb_scores from anon, authenticated;

-- من يرى سجل (فصل × مادة): معلمها، ومن يتابع معلمها
-- أعمدة أُضيفت لاحقًا في sql/41 وتستخدمها دوال هذا الملف — هنا حتى يعمل التثبيت من الصفر بالترتيب
alter table public.gb_items add column if not exists period text check (period in ('p1','p2','mid','final'));

create or replace function private.gb_can_view(p_class int, p_subject int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teaching_assignments ta where ta.class_id = p_class and ta.subject_id = p_subject
                   and (ta.teacher_id = public.me_id() or private.lp_is_reviewer(ta.teacher_id)))
$$;
create or replace function private.gb_can_edit(p_class int, p_subject int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from teaching_assignments ta where ta.class_id = p_class and ta.subject_id = p_subject and ta.teacher_id = public.me_id())
$$;

-- أعمدة السجل (تلقائية + يدوية) لفصل ومادة — للاستخدام الداخلي
create or replace function private.gb_columns(p_class int, p_subject int) returns table
  (key text, kind text, src_id bigint, item_id bigint, title text, category text, max_score numeric, weight numeric, hidden boolean, d date, period text)
language sql stable security definer set search_path = public as $$
  select 'hw' || h.id, 'hw', h.id, g.id, h.title, 'homework', h.max_score, coalesce(g.weight, 1), coalesce(g.hidden, false), (h.due_at at time zone 'Asia/Riyadh')::date, coalesce(g.period, h.period)
    from hw_assignments h left join gb_items g on g.class_id = p_class and g.subject_id = p_subject and g.src_kind = 'hw' and g.src_id = h.id
   where p_class = any (h.class_ids) and h.subject_id = p_subject
  union all
  select 'ex' || e.id, 'ex', e.id, g.id, e.title, 'exam', (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q),
         coalesce(g.weight, 1), coalesce(g.hidden, false), (e.opens_at at time zone 'Asia/Riyadh')::date, coalesce(g.period, e.period)
    from ex_exams e left join gb_items g on g.class_id = p_class and g.subject_id = p_subject and g.src_kind = 'ex' and g.src_id = e.id
   where p_class = any (e.class_ids) and e.subject_id = p_subject
  union all
  select 'm' || g.id, 'manual', null, g.id, g.title, g.category, g.max_score, g.weight, g.hidden, g.item_date, g.period
    from gb_items g where g.class_id = p_class and g.subject_id = p_subject and g.src_kind = 'manual'
$$;

-- درجات طالب في الأعمدة: {key: score}
create or replace function private.gb_student_scores(p_class int, p_subject int, p_student uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from (
    select 'hw' || s.hw_id k, to_jsonb(s.score) v from hw_submissions s join hw_assignments h on h.id = s.hw_id
     where s.student_id = p_student and s.status = 'graded' and s.score is not null and p_class = any (h.class_ids) and h.subject_id = p_subject
    union all
    select 'ex' || a.exam_id, to_jsonb(a.score) from ex_attempts a join ex_exams e on e.id = a.exam_id
     where a.student_id = p_student and a.submitted_at is not null and a.score is not null and p_class = any (e.class_ids) and e.subject_id = p_subject
    union all
    select 'm' || s.item_id, to_jsonb(s.score) from gb_scores s join gb_items g on g.id = s.item_id
     where s.student_id = p_student and g.class_id = p_class and g.subject_id = p_subject) z
$$;

-- النسبة الموزونة من أعمدة مرئية مرصودة
create or replace function private.gb_pct(p_cols jsonb, p_scores jsonb) returns numeric
language sql immutable as $$
  select round(sum((c->>'weight')::numeric * (p_scores->>(c->>'key'))::numeric / nullif((c->>'max')::numeric, 0)) / nullif(sum((c->>'weight')::numeric), 0) * 100, 1)
    from jsonb_array_elements(p_cols) c
   where not (c->>'hidden')::boolean and (c->>'weight')::numeric > 0 and p_scores ? (c->>'key')
$$;

-- السجل الكامل لفصل ومادة (معلم / متابع)
create or replace function public.gb_sheet(p_class int, p_subject int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cols jsonb;
begin
  if not private.gb_can_view(p_class, p_subject) then raise exception 'غير مصرح'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'kind', c.kind, 'src_id', c.src_id, 'item_id', c.item_id, 'title', c.title, 'category', c.category,
           'max', c.max_score, 'weight', c.weight, 'hidden', c.hidden, 'date', c.d, 'period', c.period) order by c.d, c.key), '[]'::jsonb)
    into cols from private.gb_columns(p_class, p_subject) c;
  return jsonb_build_object('can_edit', private.gb_can_edit(p_class, p_subject), 'columns', cols,
    'class', (select label from v_classes where id = p_class), 'subject', (select name_ar from subjects where id = p_subject),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'scores', x.sc, 'pct', private.gb_pct(cols, x.sc)) order by p.full_name)
       from students st join profiles p on p.id = st.profile_id
       cross join lateral (select private.gb_student_scores(p_class, p_subject, p.id) sc) x
      where st.class_id = p_class and p.active), '[]'::jsonb));
end $$;

-- إضافة/تعديل عمود يدوي، أو ضبط وزن/إخفاء عمود تلقائي
create or replace function public.gb_item_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); cid int := nullif(p->>'class_id','')::int; sid int := nullif(p->>'subject_id','')::int;
        k text := coalesce(p->>'kind', 'manual'); iid bigint := nullif(p->>'item_id','')::bigint; src bigint := nullif(p->>'src_id','')::bigint;
        w numeric := coalesce(nullif(p->>'weight','')::numeric, 1); hid boolean := coalesce((p->>'hidden')::boolean, false); ttl text := btrim(coalesce(p->>'title',''));
        per text := nullif(p->>'period','');
begin
  if per is not null and per not in ('p1','p2','mid','final') then raise exception 'فترة غير صالحة'; end if;
  if cid is null or sid is null or not private.gb_can_edit(cid, sid) then raise exception 'غير مصرح'; end if;
  if w < 0 or w > 100 then raise exception 'الوزن بين 0 و 100'; end if;
  if k in ('hw','ex') then
    if src is null or not exists (select 1 from private.gb_columns(cid, sid) c where c.kind = k and c.src_id = src) then raise exception 'العمود غير موجود'; end if;
    insert into gb_items(teacher_id, class_id, subject_id, src_kind, src_id, weight, hidden, period) values (me, cid, sid, k, src, w, hid, per)
      on conflict (class_id, subject_id, src_kind, src_id) where src_kind <> 'manual' do update set weight = excluded.weight, hidden = excluded.hidden, period = excluded.period
      returning id into iid;
    return jsonb_build_object('ok', true, 'id', iid);
  end if;
  if k <> 'manual' then raise exception 'نوع غير صالح'; end if;
  if ttl = '' then raise exception 'اكتب اسم العمود'; end if;
  if nullif(p->>'max_score','')::numeric is null or (p->>'max_score')::numeric <= 0 then raise exception 'حدّد الدرجة العظمى'; end if;
  if iid is null then
    insert into gb_items(teacher_id, class_id, subject_id, title, category, max_score, weight, hidden, item_date, period)
    values (me, cid, sid, left(ttl, 120), coalesce(nullif(p->>'category',''), 'other'), (p->>'max_score')::numeric, w, hid, coalesce(nullif(p->>'date','')::date, current_date), per)
    returning id into iid;
  else
    if (p->>'max_score')::numeric < coalesce((select max(score) from gb_scores where item_id = iid), 0) then
      raise exception 'توجد درجات مرصودة أعلى من الدرجة العظمى الجديدة'; end if;
    update gb_items set title = left(ttl, 120), category = coalesce(nullif(p->>'category',''), category), max_score = (p->>'max_score')::numeric,
           weight = w, hidden = hid, period = per, item_date = coalesce(nullif(p->>'date','')::date, item_date)
     where id = iid and class_id = cid and subject_id = sid and src_kind = 'manual';
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', iid);
end $$;

create or replace function public.gb_item_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gb_items;
begin
  select * into g from gb_items where id = p_id and src_kind = 'manual';
  if not found or not private.gb_can_edit(g.class_id, g.subject_id) then raise exception 'غير مصرح'; end if;
  delete from gb_items where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- رصد درجات عمود يدوي دفعة واحدة: rows = [{student, score|null, note}]  (null = مسح الدرجة)
create or replace function public.gb_scores_save(p_item bigint, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g gb_items; r jsonb; sc numeric; n int := 0;
begin
  select * into g from gb_items where id = p_item and src_kind = 'manual';
  if not found or not private.gb_can_edit(g.class_id, g.subject_id) then raise exception 'غير مصرح'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 200 then raise exception 'بيانات غير صالحة'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from students st join profiles p on p.id = st.profile_id where st.profile_id = (r->>'student')::uuid and st.class_id = g.class_id) then
      raise exception 'طالب ليس من هذا الفصل'; end if;
    sc := nullif(r->>'score','')::numeric;
    if sc is null then delete from gb_scores where item_id = p_item and student_id = (r->>'student')::uuid;
    else
      if sc < 0 or sc > g.max_score then raise exception 'الدرجة بين 0 و %', g.max_score; end if;
      insert into gb_scores(item_id, student_id, score, note) values (p_item, (r->>'student')::uuid, sc, nullif(btrim(coalesce(r->>'note','')), ''))
        on conflict (item_id, student_id) do update set score = excluded.score, note = excluded.note, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- الطالب: درجاتي في كل مواد فصلي
create or replace function public.gb_my() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); cid int := private.my_class_id();
begin
  if me is null then raise exception 'غير مصرح'; end if;
  if cid is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('subject_id', s.id, 'subject', s.name_ar, 'columns', x.cols, 'scores', x.sc, 'pct', private.gb_pct(x.cols, x.sc)) order by s.name_ar)
    from (select distinct subject_id from teaching_assignments where class_id = cid) ta join subjects s on s.id = ta.subject_id
    cross join lateral (select coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'title', c.title, 'category', c.category, 'max', c.max_score,
                                  'weight', c.weight, 'hidden', c.hidden, 'date', c.d, 'period', c.period) order by c.d, c.key)
                                from private.gb_columns(cid, s.id) c where not c.hidden), '[]'::jsonb) cols,
                              private.gb_student_scores(cid, s.id, me) sc) x
   where jsonb_array_length(x.cols) > 0), '[]'::jsonb);
end $$;

revoke all on function private.gb_can_view(int, int), private.gb_can_edit(int, int), private.gb_columns(int, int),
  private.gb_student_scores(int, int, uuid), private.gb_pct(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.gb_sheet(int, int), public.gb_item_save(jsonb), public.gb_item_delete(bigint), public.gb_scores_save(bigint, jsonb), public.gb_my() from public, anon;
grant execute on function public.gb_sheet(int, int), public.gb_item_save(jsonb), public.gb_item_delete(bigint), public.gb_scores_save(bigint, jsonb), public.gb_my() to authenticated;
