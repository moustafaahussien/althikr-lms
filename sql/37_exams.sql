-- =====================================================================
-- 37: وحدة «الاختبارات وبنك الأسئلة» — اختبارات إلكترونية بتصحيح تلقائي
--   بنك الأسئلة: لكل معلم أسئلته، ويرى أسئلة زملائه في نفس المادة ويستخدمها
--   أنواع الأسئلة: اختيار من متعدد (mcq) / صح وخطأ (tf) / إجابة قصيرة (short: تُطابَق تلقائيًا أو تُصحَّح يدويًا)
--   الاختبار: لفصل أو أكثر، بفترة فتح وإغلاق ومدة بالدقائق، وخلط الأسئلة والخيارات
--   الطالب لا يرى الإجابات الصحيحة إطلاقًا قبل التسليم، والتصحيح يتم في قاعدة البيانات
-- =====================================================================
create table if not exists public.qb_questions (
  id          bigserial primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  subject_id  int not null references public.subjects(id) on delete cascade,
  grade_num   smallint,
  qtype       text not null check (qtype in ('mcq','tf','short')),
  body        text not null,
  options     jsonb not null default '[]'::jsonb,   -- mcq: [{"t":"...","ok":true}]  tf: [{"t":"صح","ok":..},{"t":"خطأ","ok":..}]
  answer      text,                                   -- short: الإجابة النموذجية (مطابقة بعد التطبيع)
  points      numeric(5,2) not null default 1 check (points > 0 and points <= 100),
  topic       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists qb_questions_subject_idx on public.qb_questions (subject_id, owner_id);

create table if not exists public.ex_exams (
  id            bigserial primary key,
  teacher_id    uuid not null references public.profiles(id) on delete cascade,
  subject_id    int references public.subjects(id) on delete set null,
  class_ids     int[] not null default '{}',
  title         text not null,
  instructions  text,
  questions     jsonb not null default '[]'::jsonb,   -- لقطة ثابتة من الأسئلة وقت النشر: [{id,qtype,body,options,answer,points}]
  opens_at      timestamptz not null,
  closes_at     timestamptz not null,
  duration_min  int not null default 30 check (duration_min between 1 and 300),
  shuffle       boolean not null default true,
  show_results  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (closes_at > opens_at)
);
create index if not exists ex_exams_teacher_idx on public.ex_exams (teacher_id, opens_at desc);
create index if not exists ex_exams_classes_idx on public.ex_exams using gin (class_ids);

create table if not exists public.ex_attempts (
  id            bigserial primary key,
  exam_id       bigint not null references public.ex_exams(id) on delete cascade,
  student_id    uuid not null references public.profiles(id) on delete cascade,
  started_at    timestamptz not null default now(),
  deadline      timestamptz not null,
  submitted_at  timestamptz,
  q_order       jsonb not null default '[]'::jsonb,   -- ترتيب الأسئلة والخيارات لهذا الطالب
  answers       jsonb not null default '{}'::jsonb,
  results       jsonb not null default '{}'::jsonb,   -- {qid: {"pts":n, "ok":bool, "manual":bool}}
  score         numeric(7,2),
  max_score     numeric(7,2),
  needs_review  boolean not null default false,
  unique (exam_id, student_id)
);
create index if not exists ex_attempts_student_idx on public.ex_attempts (student_id);

alter table public.qb_questions enable row level security;
alter table public.ex_exams enable row level security;
alter table public.ex_attempts enable row level security;
revoke all on public.qb_questions, public.ex_exams, public.ex_attempts from anon, authenticated;

-- ---------- بنك الأسئلة ----------
create or replace function private.qb_can_use(p_subject int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.me_role() in ('admin','leadership','principal','supervisor')
      or exists (select 1 from teaching_assignments where teacher_id = public.me_id() and subject_id = p_subject)
$$;

create or replace function public.qb_list(p_subject int, p_grade smallint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() or not private.qb_can_use(p_subject) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'qtype', q.qtype, 'body', q.body, 'options', q.options, 'answer', q.answer,
            'points', q.points, 'topic', q.topic, 'grade', q.grade_num, 'mine', q.owner_id = public.me_id(),
            'owner', (select full_name from profiles where id = q.owner_id), 'used', (select count(*) from ex_exams e where e.questions @> jsonb_build_array(jsonb_build_object('id', q.id))))
          order by q.owner_id = public.me_id() desc, q.created_at desc)
     from qb_questions q where q.subject_id = p_subject and (p_grade is null or q.grade_num is null or q.grade_num = p_grade)), '[]'::jsonb);
end $$;

create or replace function public.qb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); qid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int;
        t text := p->>'qtype'; b text := btrim(coalesce(p->>'body','')); opts jsonb; nok int;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if sid is null or not exists (select 1 from teaching_assignments where teacher_id = me and subject_id = sid) then
    raise exception 'اختر مادة من موادك المسندة إليك'; end if;
  if t not in ('mcq','tf','short') then raise exception 'نوع السؤال غير صالح'; end if;
  if b = '' then raise exception 'اكتب نص السؤال'; end if;
  if length(b) > 5000 then raise exception 'نص السؤال طويل جدًا'; end if;
  if t = 'mcq' then
    select coalesce(jsonb_agg(jsonb_build_object('t', left(btrim(o->>'t'), 500), 'ok', coalesce((o->>'ok')::boolean, false))), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) o where btrim(coalesce(o->>'t','')) <> '';
    select count(*) into nok from jsonb_array_elements(opts) o where (o->>'ok')::boolean;
    if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'الاختيار من متعدد يحتاج من 2 إلى 8 خيارات'; end if;
    if nok <> 1 then raise exception 'حدّد إجابة صحيحة واحدة'; end if;
  elsif t = 'tf' then
    opts := jsonb_build_array(jsonb_build_object('t','صح','ok', coalesce((p->>'tf')::boolean, true)), jsonb_build_object('t','خطأ','ok', not coalesce((p->>'tf')::boolean, true)));
  else
    opts := '[]'::jsonb;
  end if;
  if qid is null then
    insert into qb_questions(owner_id, subject_id, grade_num, qtype, body, options, answer, points, topic)
    values (me, sid, nullif(p->>'grade','')::smallint, t, b, opts, nullif(btrim(coalesce(p->>'answer','')), ''), coalesce(nullif(p->>'points','')::numeric, 1), nullif(btrim(coalesce(p->>'topic','')), ''))
    returning id into qid;
  else
    update qb_questions set subject_id = sid, grade_num = nullif(p->>'grade','')::smallint, qtype = t, body = b, options = opts,
           answer = nullif(btrim(coalesce(p->>'answer','')), ''), points = coalesce(nullif(p->>'points','')::numeric, 1), topic = nullif(btrim(coalesce(p->>'topic','')), ''), updated_at = now()
     where id = qid and owner_id = me;
    if not found then raise exception 'لا يمكنك تعديل سؤال زميل — يمكنك استخدامه فقط'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', qid);
end $$;

create or replace function public.qb_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from qb_questions where id = p_id and owner_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);   -- الاختبارات المنشورة تحتفظ بلقطتها من السؤال
end $$;

-- ---------- الاختبارات ----------
create or replace function private.ex_card(e public.ex_exams) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'opens_at', e.opens_at, 'closes_at', e.closes_at, 'duration_min', e.duration_min,
    'subject', (select name_ar from subjects where id = e.subject_id), 'subject_id', e.subject_id,
    'teacher', (select full_name from profiles where id = e.teacher_id), 'teacher_id', e.teacher_id, 'n_questions', jsonb_array_length(e.questions),
    'max_score', (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q), 'show_results', e.show_results,
    'classes', coalesce((select jsonb_agg(vc.label order by vc.stage_sort, vc.grade_number, vc.name) from v_classes vc where vc.id = any (e.class_ids)), '[]'::jsonb),
    'state', case when now() < e.opens_at then 'upcoming' when now() > e.closes_at then 'closed' else 'open' end)
$$;

create or replace function public.ex_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); eid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int; cls int[];
        ttl text := btrim(coalesce(p->>'title','')); qs jsonb; op timestamptz := (p->>'opens_at')::timestamptz; cl timestamptz := (p->>'closes_at')::timestamptz;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الاختبار'; end if;
  if op is null or cl is null or cl <= op then raise exception 'حدّد وقت الفتح والإغلاق بشكل صحيح'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c and (sid is null or ta.subject_id = sid))) then
    raise exception 'اختر من فصولك التي تدرّس لها هذه المادة فقط'; end if;
  -- لقطة الأسئلة المختارة (بالترتيب) — من أسئلة المادة في البنك فقط
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'qtype', q.qtype, 'body', q.body, 'options', q.options, 'answer', q.answer,
           'points', coalesce(nullif(x->>'points','')::numeric, q.points)) order by x.ord), '[]'::jsonb)
    into qs
    from jsonb_array_elements(coalesce(p->'questions','[]'::jsonb)) with ordinality x(x, ord)
    join qb_questions q on q.id = (x->>'id')::bigint and q.subject_id = sid;
  if jsonb_array_length(qs) = 0 then raise exception 'أضف سؤالًا واحدًا على الأقل من بنك الأسئلة'; end if;
  if eid is null then
    insert into ex_exams(teacher_id, subject_id, class_ids, title, instructions, questions, opens_at, closes_at, duration_min, shuffle, show_results)
    values (me, sid, cls, left(ttl, 200), nullif(btrim(coalesce(p->>'instructions','')), ''), qs, op, cl,
            coalesce(nullif(p->>'duration_min','')::int, 30), coalesce((p->>'shuffle')::boolean, true), coalesce((p->>'show_results')::boolean, true))
    returning id into eid;
  else
    if exists (select 1 from ex_attempts where exam_id = eid) then
      -- بعد بدء الطلاب: يُسمح فقط بتعديل المواعيد والعنوان والتعليمات وإظهار النتائج
      update ex_exams set title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''), closes_at = cl,
             show_results = coalesce((p->>'show_results')::boolean, show_results), updated_at = now()
       where id = eid and teacher_id = me;
    else
      update ex_exams set subject_id = sid, class_ids = cls, title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''),
             questions = qs, opens_at = op, closes_at = cl, duration_min = coalesce(nullif(p->>'duration_min','')::int, 30),
             shuffle = coalesce((p->>'shuffle')::boolean, true), show_results = coalesce((p->>'show_results')::boolean, true), updated_at = now()
       where id = eid and teacher_id = me;
    end if;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

create or replace function public.ex_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from ex_attempts where exam_id = p_id and submitted_at is not null) then
    raise exception 'لا يمكن حذف اختبار سلّمه طلاب — غيّر موعد إغلاقه بدلًا من ذلك'; end if;
  delete from ex_exams where id = p_id and teacher_id = public.me_id();
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- mine = اختباراتي (معلم) | student = اختبارات فصلي | all = متابعة
create or replace function public.ex_list(p_box text default 'mine') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); cid int := private.my_class_id();
begin
  if p_box = 'student' then
    if cid is null then return '[]'::jsonb; end if;
    return coalesce((select jsonb_agg(private.ex_card(e) || jsonb_build_object(
              'my', (select jsonb_build_object('started', a.started_at, 'submitted', a.submitted_at, 'deadline', a.deadline,
                       'score', case when e.show_results then a.score end, 'needs_review', a.needs_review)
                     from ex_attempts a where a.exam_id = e.id and a.student_id = me)) order by e.opens_at desc)
      from ex_exams e where cid = any (e.class_ids)), '[]'::jsonb);
  end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.ex_card(e) || jsonb_build_object(
            'students', (select count(*) from students s where s.class_id = any (e.class_ids)),
            'submitted', (select count(*) from ex_attempts a where a.exam_id = e.id and a.submitted_at is not null),
            'review', (select count(*) from ex_attempts a where a.exam_id = e.id and a.needs_review),
            'avg', (select round(avg(a.score / nullif(a.max_score, 0) * 100)) from ex_attempts a where a.exam_id = e.id and a.submitted_at is not null))
          order by e.opens_at desc)
    from ex_exams e where case when p_box = 'mine' then e.teacher_id = me else private.lp_is_reviewer(e.teacher_id) end), '[]'::jsonb);
end $$;

-- تفاصيل الاختبار للمعلم/المتابع: الأسئلة بإجاباتها + النتائج
create or replace function public.ex_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e ex_exams; mine boolean;
begin
  select * into e from ex_exams where id = p_id;
  if not found then raise exception 'الاختبار غير موجود'; end if;
  mine := e.teacher_id = public.me_id();
  if not (mine or private.lp_is_reviewer(e.teacher_id)) then raise exception 'غير مصرح'; end if;
  return private.ex_card(e) || jsonb_build_object('instructions', e.instructions, 'questions', e.questions, 'class_ids', to_jsonb(e.class_ids),
    'shuffle', e.shuffle, 'mine', mine, 'locked', exists (select 1 from ex_attempts where exam_id = e.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'student', st.profile_id, 'name', p.full_name, 'class', vc.name,
                   'started', a.started_at, 'submitted', a.submitted_at, 'score', a.score, 'max', a.max_score, 'needs_review', a.needs_review,
                   'answers', a.answers, 'results', a.results) order by vc.grade_number, vc.name, p.full_name)
                 from students st join profiles p on p.id = st.profile_id join v_classes vc on vc.id = st.class_id
                 left join ex_attempts a on a.exam_id = e.id and a.student_id = st.profile_id
                where st.class_id = any (e.class_ids) and p.active), '[]'::jsonb));
end $$;

-- الطالب يبدأ (أو يستأنف) المحاولة: يحصل على الأسئلة بلا إجابات وبترتيبه الخاص
create or replace function public.ex_start(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ex_exams; me uuid := public.me_id(); cid int := private.my_class_id(); a ex_attempts; ord jsonb;
begin
  select * into e from ex_exams where id = p_id;
  if not found or cid is null or not (cid = any (e.class_ids)) then raise exception 'غير مصرح'; end if;
  select * into a from ex_attempts where exam_id = p_id and student_id = me;
  if a.id is not null and a.submitted_at is not null then raise exception 'سلّمت هذا الاختبار من قبل'; end if;
  if a.id is null then
    if now() < e.opens_at then raise exception 'لم يُفتح الاختبار بعد'; end if;
    if now() > e.closes_at then raise exception 'انتهى وقت الاختبار'; end if;
    -- ترتيب خاص بالطالب للأسئلة والخيارات (إن كان الخلط مفعّلًا)
    select coalesce(jsonb_agg(jsonb_build_object('id', q->>'id',
             'opts', case when q->>'qtype' = 'mcq' then (select jsonb_agg(i - 1 order by case when e.shuffle then random() else i end)
                                                         from generate_series(1, jsonb_array_length(q->'options')) i) else '[]'::jsonb end)
             order by case when e.shuffle then random() else qn end), '[]'::jsonb)
      into ord from jsonb_array_elements(e.questions) with ordinality t(q, qn);
    insert into ex_attempts(exam_id, student_id, deadline, q_order, max_score)
    values (p_id, me, least(e.closes_at, now() + make_interval(mins => e.duration_min)), ord,
            (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'title', e.title, 'instructions', e.instructions, 'deadline', a.deadline, 'now', now(), 'answers', a.answers,
    'questions', (select jsonb_agg(jsonb_build_object('id', q->>'id', 'qtype', q->>'qtype', 'body', q->>'body', 'points', q->'points',
                   'options', case when q->>'qtype' in ('mcq','tf') then (select jsonb_agg(jsonb_build_object('i', oi::int, 't', q->'options'->(oi::int)->>'t') order by n)
                                                                           from jsonb_array_elements_text(case when q->>'qtype' = 'mcq' then o->'opts' else '[0,1]'::jsonb end) with ordinality z(oi, n))
                                   else '[]'::jsonb end) order by k)
                  from jsonb_array_elements(a.q_order) with ordinality y(o, k)
                  join jsonb_array_elements(e.questions) q on q->>'id' = o->>'id'));
end $$;

-- حفظ الإجابات أثناء الاختبار (حفظ تلقائي) أو التسليم النهائي مع التصحيح
create or replace function public.ex_submit(p_id bigint, p_answers jsonb, p_final boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ex_exams; a ex_attempts; me uuid := public.me_id(); q jsonb; res jsonb := '{}'::jsonb; tot numeric := 0; ans text; ok boolean; review boolean := false;
        okidx int;
begin
  select * into e from ex_exams where id = p_id;
  select * into a from ex_attempts where exam_id = p_id and student_id = me for update;
  if a.id is null then raise exception 'ابدأ الاختبار أولًا'; end if;
  if a.submitted_at is not null then raise exception 'سلّمت هذا الاختبار من قبل'; end if;
  if jsonb_typeof(coalesce(p_answers,'{}'::jsonb)) <> 'object' or length(p_answers::text) > 100000 then raise exception 'إجابات غير صالحة'; end if;
  -- بعد انتهاء المهلة (+ دقيقة سماح للشبكة) يُقبل التسليم بالإجابات المحفوظة سابقًا فقط
  if now() > a.deadline + interval '1 minute' then p_answers := a.answers; p_final := true; end if;
  if not p_final then
    update ex_attempts set answers = p_answers where id = a.id;
    return jsonb_build_object('ok', true, 'saved', true);
  end if;
  for q in select * from jsonb_array_elements(e.questions) loop
    ans := btrim(coalesce(p_answers->>(q->>'id'), ''));
    if q->>'qtype' in ('mcq','tf') then
      select (i - 1)::int into okidx from jsonb_array_elements(q->'options') with ordinality o(v, i) where (v->>'ok')::boolean limit 1;
      ok := ans <> '' and ans ~ '^\d+$' and ans::int = okidx;
      res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', case when ok then (q->>'points')::numeric else 0 end, 'ok', ok));
      if ok then tot := tot + (q->>'points')::numeric; end if;
    else
      if q->>'answer' is not null and public.norm(ans) = public.norm(q->>'answer') then
        res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', (q->>'points')::numeric, 'ok', true));
        tot := tot + (q->>'points')::numeric;
      elsif ans = '' then
        res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', 0, 'ok', false));
      else
        res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', 0, 'ok', null, 'manual', true)); review := true;
      end if;
    end if;
  end loop;
  update ex_attempts set answers = p_answers, results = res, score = tot, submitted_at = now(), needs_review = review where id = a.id;
  return jsonb_build_object('ok', true, 'score', case when e.show_results then tot end, 'max', a.max_score, 'needs_review', review);
end $$;

-- نتيجة الطالب بعد التسليم (إن سمح المعلم بإظهارها)
create or replace function public.ex_my_result(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare e ex_exams; a ex_attempts;
begin
  select * into e from ex_exams where id = p_id;
  select * into a from ex_attempts where exam_id = p_id and student_id = public.me_id();
  if a.id is null or a.submitted_at is null then raise exception 'لم تسلّم هذا الاختبار'; end if;
  if not e.show_results then return jsonb_build_object('hidden', true, 'submitted', a.submitted_at); end if;
  return jsonb_build_object('score', a.score, 'max', a.max_score, 'needs_review', a.needs_review, 'submitted', a.submitted_at,
    -- تظهر الإجابات الصحيحة فقط بعد إغلاق الاختبار للجميع
    'questions', (select jsonb_agg(jsonb_build_object('body', q->>'body', 'qtype', q->>'qtype', 'points', q->'points', 'mine', a.answers->>(q->>'id'),
                    'result', a.results->(q->>'id'), 'options', (select jsonb_agg(v->>'t') from jsonb_array_elements(q->'options') v),
                    'correct', case when now() > e.closes_at then coalesce((select (i - 1)::text from jsonb_array_elements(q->'options') with ordinality o(v, i) where (v->>'ok')::boolean limit 1), q->>'answer') end))
                  from jsonb_array_elements(e.questions) q));
end $$;

-- تصحيح يدوي لسؤال إجابة قصيرة
create or replace function public.ex_grade(p_attempt bigint, p_qid text, p_points numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a ex_attempts; e ex_exams; mx numeric; res jsonb;
begin
  select * into a from ex_attempts where id = p_attempt for update;
  select * into e from ex_exams where id = a.exam_id;
  if e.teacher_id is distinct from public.me_id() then raise exception 'غير مصرح'; end if;
  select (q->>'points')::numeric into mx from jsonb_array_elements(e.questions) q where q->>'id' = p_qid;
  if mx is null then raise exception 'السؤال غير موجود'; end if;
  if p_points < 0 or p_points > mx then raise exception 'الدرجة بين 0 و %', mx; end if;
  res := jsonb_set(a.results, array[p_qid], jsonb_build_object('pts', p_points, 'ok', p_points = mx, 'manual', true, 'graded', true));
  update ex_attempts set results = res,
         score = (select coalesce(sum((v->>'pts')::numeric), 0) from jsonb_each(res) x(k, v)),
         needs_review = exists (select 1 from jsonb_each(res) x(k, v) where (v->>'manual')::boolean and not coalesce((v->>'graded')::boolean, false))
   where id = a.id;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.qb_can_use(int), private.ex_card(public.ex_exams) from public, anon, authenticated;
revoke all on function public.qb_list(int, smallint), public.qb_save(jsonb), public.qb_delete(bigint), public.ex_save(jsonb), public.ex_delete(bigint),
  public.ex_list(text), public.ex_get(bigint), public.ex_start(bigint), public.ex_submit(bigint, jsonb, boolean), public.ex_my_result(bigint),
  public.ex_grade(bigint, text, numeric) from public, anon;
grant execute on function public.qb_list(int, smallint), public.qb_save(jsonb), public.qb_delete(bigint), public.ex_save(jsonb), public.ex_delete(bigint),
  public.ex_list(text), public.ex_get(bigint), public.ex_start(bigint), public.ex_submit(bigint, jsonb, boolean), public.ex_my_result(bigint),
  public.ex_grade(bigint, text, numeric) to authenticated;
