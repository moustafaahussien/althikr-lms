-- =====================================================================
-- 41: تحسينات الوحدات (طلب مصطفى 22 نوفمبر):
--   فترات التقويم في الواجبات والاختبارات وسجل الدرجات، صور الأسئلة وسؤال المزاوجة،
--   نتائج الطالب في ملف الإنجاز، اعتماد التحضير للمشرف فقط، مكتبة معلمي دار الذكر،
--   متابعة الالتزام، الفصول والطلاب
--   (الدوال المعدّلة مأخوذة من ملفاتها الأصلية 33/34/37/38/40 بعد التعديل)
-- =====================================================================
alter table public.hw_assignments add column if not exists period text check (period in ('p1','p2','mid','final'));
alter table public.ex_exams add column if not exists period text check (period in ('p1','p2','mid','final'));
alter table public.gb_items add column if not exists period text check (period in ('p1','p2','mid','final'));
alter table public.qb_questions add column if not exists image text;
alter table public.qb_questions drop constraint if exists qb_questions_qtype_check;
alter table public.qb_questions add constraint qb_questions_qtype_check check (qtype in ('mcq','tf','short','match'));
drop function if exists private.gb_columns(int, int);

create or replace function private.lp_can_approve(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_teacher <> public.me_id() and exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id = public.me_id())
$$;

create or replace function public.lp_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subjects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name_ar))
                 from teaching_assignments ta join subjects s on s.id = ta.subject_id where ta.teacher_id = public.me_id()), '[]'::jsonb),
    'classes',  coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'label', vc.label, 'subjects', x.subs) order by vc.stage_sort, vc.grade_number, vc.name)
                 from (select class_id, jsonb_agg(distinct subject_id) subs from teaching_assignments where teacher_id = public.me_id() group by class_id) x
                 join v_classes vc on vc.id = x.class_id), '[]'::jsonb),
    -- الاعتماد للمشرف فقط، والمتابعة (اطلاع) للمشرف والمدير والقيادة
    'can_review', exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id()),
    'can_follow', public.me_role() in ('admin','leadership','principal','supervisor')
                  or exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id()),
    'is_teacher', exists (select 1 from teaching_assignments where teacher_id = public.me_id()))
$$;

create or replace function public.lp_list(p_box text default 'mine', p_from date default null, p_to date default null,
                                          p_teacher uuid default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(private.lp_card(lp) order by lp.lesson_date desc, lp.id desc)
      from (select * from lesson_plans lp
             where (p_from is null or lp.lesson_date >= p_from) and (p_to is null or lp.lesson_date <= p_to)
               and (p_status is null or lp.status = p_status)
               and case p_box
                     when 'mine'   then lp.teacher_id = me
                     when 'review' then lp.status = 'submitted' and private.lp_can_approve(lp.teacher_id)
                     else (p_teacher is null or lp.teacher_id = p_teacher) and lp.status <> 'draft' and private.lp_is_reviewer(lp.teacher_id)
                   end
             order by lp.lesson_date desc, lp.id desc limit 500) lp), '[]'::jsonb);
end $$;

create or replace function public.lp_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lp lesson_plans; mine boolean; rev boolean;
begin
  select * into lp from lesson_plans where id = p_id;
  if not found then raise exception 'التحضير غير موجود'; end if;
  mine := lp.teacher_id = public.me_id();
  rev  := private.lp_is_reviewer(lp.teacher_id);
  if not mine and not (rev and lp.status <> 'draft') then raise exception 'غير مصرح'; end if;
  return private.lp_card(lp) || jsonb_build_object('content', lp.content, 'class_ids', to_jsonb(lp.class_ids),
    'can_edit', mine and lp.status in ('draft','returned'),
    'can_review', lp.status = 'submitted' and private.lp_can_approve(lp.teacher_id), 'mine', mine);
end $$;

create or replace function public.lp_review(p_id bigint, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lp lesson_plans;
begin
  select * into lp from lesson_plans where id = p_id for update;
  if not found then raise exception 'التحضير غير موجود'; end if;
  if lp.status <> 'submitted' or not private.lp_can_approve(lp.teacher_id) then raise exception 'اعتماد التحضير للمشرف التربوي فقط'; end if;
  if p_decision not in ('approve','return') then raise exception 'قرار غير صالح'; end if;
  if p_decision = 'return' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب ملاحظاتك للمعلم عند الإعادة'; end if;
  update lesson_plans set status = case when p_decision = 'approve' then 'approved' else 'returned' end,
         reviewed_by = public.me_id(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note,'')), ''), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function private.hw_card(h public.hw_assignments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', h.id, 'title', h.title, 'due_at', h.due_at, 'max_score', h.max_score, 'allow_late', h.allow_late, 'closed', h.closed,
    'subject', (select name_ar from subjects where id = h.subject_id), 'subject_id', h.subject_id, 'period', h.period,
    'teacher', (select full_name from profiles where id = h.teacher_id), 'teacher_id', h.teacher_id, 'created_at', h.created_at,
    'classes', coalesce((select jsonb_agg(vc.label order by vc.stage_sort, vc.grade_number, vc.name) from v_classes vc where vc.id = any (h.class_ids)), '[]'::jsonb))
$$;

create or replace function public.hw_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); hid bigint := nullif(p->>'id','')::bigint; cls int[]; sid int := nullif(p->>'subject_id','')::int;
        ttl text := btrim(coalesce(p->>'title','')); due timestamptz := nullif(p->>'due_at','')::timestamptz;
        mx numeric := coalesce(nullif(p->>'max_score','')::numeric, 10); per text := nullif(p->>'period','');
begin
  if per is not null and per not in ('p1','p2','mid','final') then raise exception 'فترة غير صالحة'; end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الواجب'; end if;
  if due is null then raise exception 'حدّد موعد التسليم'; end if;
  if mx <= 0 or mx > 1000 then raise exception 'الدرجة العظمى غير صالحة'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c)) then
    raise exception 'اختر من فصولك المسندة إليك فقط'; end if;
  if sid is not null and not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.subject_id = sid) then
    raise exception 'اختر من موادك المسندة إليك فقط'; end if;
  if length(coalesce(p->>'instructions','')) > 20000 then raise exception 'نص الواجب طويل جدًا'; end if;
  if hid is null then
    insert into hw_assignments(teacher_id, subject_id, class_ids, title, instructions, links, due_at, max_score, allow_late, period)
    values (me, sid, cls, left(ttl, 200), nullif(btrim(coalesce(p->>'instructions','')), ''), private.hw_clean_links(p->'links'), due, mx,
            coalesce((p->>'allow_late')::boolean, true), per) returning id into hid;
  else
    update hw_assignments set subject_id = sid, class_ids = cls, title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''),
           links = private.hw_clean_links(p->'links'), due_at = due, max_score = mx, allow_late = coalesce((p->>'allow_late')::boolean, true), period = per, updated_at = now()
     where id = hid and teacher_id = me;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', hid);
end $$;

create or replace function public.qb_list(p_subject int, p_grade smallint default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() or not private.qb_can_use(p_subject) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'qtype', q.qtype, 'body', q.body, 'options', q.options, 'answer', q.answer,
            'points', q.points, 'topic', q.topic, 'grade', q.grade_num, 'image', q.image, 'mine', q.owner_id = public.me_id(),
            'owner', (select full_name from profiles where id = q.owner_id), 'used', (select count(*) from ex_exams e where e.questions @> jsonb_build_array(jsonb_build_object('id', q.id))))
          order by q.owner_id = public.me_id() desc, q.created_at desc)
     from qb_questions q where q.subject_id = p_subject and (p_grade is null or q.grade_num is null or q.grade_num = p_grade)), '[]'::jsonb);
end $$;

create or replace function public.qb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); qid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int;
        t text := p->>'qtype'; b text := btrim(coalesce(p->>'body','')); opts jsonb; nok int; img text := nullif(p->>'image','');
begin
  if img is not null and (img !~ '^data:image/(png|jpeg|webp|gif);base64,' or length(img) > 450000) then raise exception 'الصورة غير صالحة أو كبيرة جدًا'; end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if sid is null or not exists (select 1 from teaching_assignments where teacher_id = me and subject_id = sid) then
    raise exception 'اختر مادة من موادك المسندة إليك'; end if;
  if t not in ('mcq','tf','short','match') then raise exception 'نوع السؤال غير صالح'; end if;
  if b = '' then raise exception 'اكتب نص السؤال'; end if;
  if length(b) > 5000 then raise exception 'نص السؤال طويل جدًا'; end if;
  if t = 'mcq' then
    select coalesce(jsonb_agg(jsonb_build_object('t', left(btrim(o->>'t'), 500), 'ok', coalesce((o->>'ok')::boolean, false))), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) o where btrim(coalesce(o->>'t','')) <> '';
    select count(*) into nok from jsonb_array_elements(opts) o where (o->>'ok')::boolean;
    if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'الاختيار من متعدد يحتاج من 2 إلى 8 خيارات'; end if;
    if nok <> 1 then raise exception 'حدّد إجابة صحيحة واحدة'; end if;
  elsif t = 'match' then
    select coalesce(jsonb_agg(jsonb_build_object('l', left(btrim(o->>'l'), 300), 'r', left(btrim(o->>'r'), 300))), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'pairs','[]'::jsonb)) o where btrim(coalesce(o->>'l','')) <> '' and btrim(coalesce(o->>'r','')) <> '';
    if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'المزاوجة تحتاج من 2 إلى 8 أزواج مكتملة'; end if;
  elsif t = 'tf' then
    opts := jsonb_build_array(jsonb_build_object('t','صح','ok', coalesce((p->>'tf')::boolean, true)), jsonb_build_object('t','خطأ','ok', not coalesce((p->>'tf')::boolean, true)));
  else
    opts := '[]'::jsonb;
  end if;
  if qid is null then
    insert into qb_questions(owner_id, subject_id, grade_num, qtype, body, options, answer, points, topic, image)
    values (me, sid, nullif(p->>'grade','')::smallint, t, b, opts, nullif(btrim(coalesce(p->>'answer','')), ''), coalesce(nullif(p->>'points','')::numeric, 1), nullif(btrim(coalesce(p->>'topic','')), ''), img)
    returning id into qid;
  else
    update qb_questions set subject_id = sid, grade_num = nullif(p->>'grade','')::smallint, qtype = t, body = b, options = opts,
           answer = nullif(btrim(coalesce(p->>'answer','')), ''), points = coalesce(nullif(p->>'points','')::numeric, 1), topic = nullif(btrim(coalesce(p->>'topic','')), ''), image = img, updated_at = now()
     where id = qid and owner_id = me;
    if not found then raise exception 'لا يمكنك تعديل سؤال زميل — يمكنك استخدامه فقط'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', qid);
end $$;

create or replace function private.ex_card(e public.ex_exams) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'title', e.title, 'opens_at', e.opens_at, 'closes_at', e.closes_at, 'duration_min', e.duration_min,
    'subject', (select name_ar from subjects where id = e.subject_id), 'subject_id', e.subject_id, 'period', e.period,
    'teacher', (select full_name from profiles where id = e.teacher_id), 'teacher_id', e.teacher_id, 'n_questions', jsonb_array_length(e.questions),
    'max_score', (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q), 'show_results', e.show_results,
    'classes', coalesce((select jsonb_agg(vc.label order by vc.stage_sort, vc.grade_number, vc.name) from v_classes vc where vc.id = any (e.class_ids)), '[]'::jsonb),
    'state', case when now() < e.opens_at then 'upcoming' when now() > e.closes_at then 'closed' else 'open' end)
$$;

create or replace function public.ex_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); eid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int; cls int[];
        ttl text := btrim(coalesce(p->>'title','')); qs jsonb; op timestamptz := (p->>'opens_at')::timestamptz; cl timestamptz := (p->>'closes_at')::timestamptz;
        per text := nullif(p->>'period','');
begin
  if per is not null and per not in ('p1','p2','mid','final') then raise exception 'فترة غير صالحة'; end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الاختبار'; end if;
  if op is null or cl is null or cl <= op then raise exception 'حدّد وقت الفتح والإغلاق بشكل صحيح'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  if cardinality(cls) = 0 then raise exception 'اختر فصلًا واحدًا على الأقل'; end if;
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c and (sid is null or ta.subject_id = sid))) then
    raise exception 'اختر من فصولك التي تدرّس لها هذه المادة فقط'; end if;
  -- لقطة الأسئلة المختارة (بالترتيب) — من أسئلة المادة في البنك فقط
  select coalesce(jsonb_agg(jsonb_build_object('id', q.id, 'qtype', q.qtype, 'body', q.body, 'options', q.options, 'answer', q.answer, 'image', q.image,
           'points', coalesce(nullif(x->>'points','')::numeric, q.points)) order by x.ord), '[]'::jsonb)
    into qs
    from jsonb_array_elements(coalesce(p->'questions','[]'::jsonb)) with ordinality x(x, ord)
    join qb_questions q on q.id = (x->>'id')::bigint and q.subject_id = sid;
  if jsonb_array_length(qs) = 0 then raise exception 'أضف سؤالًا واحدًا على الأقل من بنك الأسئلة'; end if;
  if eid is null then
    insert into ex_exams(teacher_id, subject_id, class_ids, title, instructions, questions, opens_at, closes_at, duration_min, shuffle, show_results, period)
    values (me, sid, cls, left(ttl, 200), nullif(btrim(coalesce(p->>'instructions','')), ''), qs, op, cl,
            coalesce(nullif(p->>'duration_min','')::int, 30), coalesce((p->>'shuffle')::boolean, true), coalesce((p->>'show_results')::boolean, true), per)
    returning id into eid;
  else
    if exists (select 1 from ex_attempts where exam_id = eid) then
      -- بعد بدء الطلاب: يُسمح فقط بتعديل المواعيد والعنوان والتعليمات وإظهار النتائج
      update ex_exams set title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''), closes_at = cl,
             show_results = coalesce((p->>'show_results')::boolean, show_results), period = per, updated_at = now()
       where id = eid and teacher_id = me;
    else
      update ex_exams set subject_id = sid, class_ids = cls, title = left(ttl, 200), instructions = nullif(btrim(coalesce(p->>'instructions','')), ''),
             questions = qs, opens_at = op, closes_at = cl, duration_min = coalesce(nullif(p->>'duration_min','')::int, 30),
             shuffle = coalesce((p->>'shuffle')::boolean, true), show_results = coalesce((p->>'show_results')::boolean, true), period = per, updated_at = now()
       where id = eid and teacher_id = me;
    end if;
    if not found then raise exception 'غير مصرح'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

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
             'opts', case when q->>'qtype' in ('mcq','match') then (select jsonb_agg(i - 1 order by case when e.shuffle then random() else i end)
                                                         from generate_series(1, jsonb_array_length(q->'options')) i) else '[]'::jsonb end)
             order by case when e.shuffle then random() else qn end), '[]'::jsonb)
      into ord from jsonb_array_elements(e.questions) with ordinality t(q, qn);
    insert into ex_attempts(exam_id, student_id, deadline, q_order, max_score)
    values (p_id, me, least(e.closes_at, now() + make_interval(mins => e.duration_min)), ord,
            (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'title', e.title, 'instructions', e.instructions, 'deadline', a.deadline, 'now', now(), 'answers', a.answers,
    'questions', (select jsonb_agg(jsonb_build_object('id', q->>'id', 'qtype', q->>'qtype', 'body', q->>'body', 'points', q->'points', 'image', q->>'image',
                   -- المزاوجة: العمود الأول بترتيبه، والثاني مخلوط ويُرسل بموضعه فقط (لا يكشف الزوج الصحيح)
                   'left', case when q->>'qtype' = 'match' then (select jsonb_agg(jsonb_build_object('k', i - 1, 't', v->>'l') order by i) from jsonb_array_elements(q->'options') with ordinality w(v, i)) end,
                   'options', case when q->>'qtype' = 'match' then (select jsonb_agg(jsonb_build_object('i', n - 1, 't', q->'options'->(oi::int)->>'r') order by n)
                                                                     from jsonb_array_elements_text(o->'opts') with ordinality z(oi, n))
                                   when q->>'qtype' in ('mcq','tf') then (select jsonb_agg(jsonb_build_object('i', oi::int, 't', q->'options'->(oi::int)->>'t') order by n)
                                                                           from jsonb_array_elements_text(case when q->>'qtype' = 'mcq' then o->'opts' else '[0,1]'::jsonb end) with ordinality z(oi, n))
                                   else '[]'::jsonb end) order by k)
                  from jsonb_array_elements(a.q_order) with ordinality y(o, k)
                  join jsonb_array_elements(e.questions) q on q->>'id' = o->>'id'));
end $$;

create or replace function public.ex_submit(p_id bigint, p_answers jsonb, p_final boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ex_exams; a ex_attempts; me uuid := public.me_id(); q jsonb; res jsonb := '{}'::jsonb; tot numeric := 0; ans text; ok boolean; review boolean := false;
        okidx int; ord jsonb; np int; nc int; kv text;
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
    if q->>'qtype' = 'match' then
      -- الإجابة: "k:j,k:j" حيث j موضع الخيار المعروض للطالب
      select o->'opts' into ord from jsonb_array_elements(a.q_order) o where o->>'id' = q->>'id';
      np := jsonb_array_length(q->'options'); nc := 0;
      foreach kv in array string_to_array(ans, ',') loop
        if kv ~ '^\d+:\d+$' and (ord->>(split_part(kv, ':', 2)::int)) = split_part(kv, ':', 1) then nc := nc + 1; end if;
      end loop;
      nc := least(nc, np);
      res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', round((q->>'points')::numeric * nc / np, 2), 'ok', nc = np, 'nc', nc, 'np', np));
      tot := tot + round((q->>'points')::numeric * nc / np, 2);
    elsif q->>'qtype' in ('mcq','tf') then
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
    'questions', (select jsonb_agg(jsonb_build_object('body', q->>'body', 'qtype', q->>'qtype', 'points', q->'points', 'mine', a.answers->>(q->>'id'), 'image', q->>'image',
                    'pairs', case when q->>'qtype' = 'match' and now() > e.closes_at then q->'options' end,
                    'result', a.results->(q->>'id'), 'options', case when q->>'qtype' = 'match' then null else (select jsonb_agg(v->>'t') from jsonb_array_elements(q->'options') v) end,
                    'correct', case when now() > e.closes_at and q->>'qtype' <> 'match' then coalesce((select (i - 1)::text from jsonb_array_elements(q->'options') with ordinality o(v, i) where (v->>'ok')::boolean limit 1), q->>'answer') end))
                  from jsonb_array_elements(e.questions) q));
end $$;

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

create or replace function public.pf_get(p_student uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); sid uuid := coalesce(p_student, me); r text := public.me_role(); staff boolean; parent boolean; s students;
begin
  select * into s from students where profile_id = sid;
  if s.profile_id is null then raise exception 'الطالب غير موجود'; end if;
  staff := private.pf_staff_can(sid);
  parent := r = 'parent' and exists (select 1 from parent_links where parent_id = me and student_id = sid);
  if not (sid = me or staff or parent) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('student', jsonb_build_object('id', sid, 'name', (select full_name from profiles where id = sid),
      'class', (select label from v_classes where id = s.class_id),
      'grade', (select g.name_ar || ' ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id)),
    'can_add', sid = me or staff, 'can_review', staff, 'is_self', sid = me,
    'items', coalesce((select jsonb_agg(private.pf_card(i) order by i.item_date desc, i.id desc) from pf_items i
                        where i.student_id = sid and (sid = me or staff or i.status = 'approved')), '[]'::jsonb),
    -- النتائج الأكاديمية: الاختبارات الإلكترونية المسلّمة (إن سمح المعلم بإظهار النتيجة) والواجبات المصحّحة
    'exams', coalesce((select jsonb_agg(jsonb_build_object('title', e.title, 'subject', (select name_ar from subjects where id = e.subject_id),
                  'date', (e.opens_at at time zone 'Asia/Riyadh')::date, 'score', a.score, 'max', a.max_score, 'review', a.needs_review) order by e.opens_at desc)
                from ex_attempts a join ex_exams e on e.id = a.exam_id
               where a.student_id = sid and a.submitted_at is not null and (staff or e.show_results)), '[]'::jsonb),
    'homework', coalesce((select jsonb_agg(jsonb_build_object('title', h.title, 'subject', (select name_ar from subjects where id = h.subject_id),
                  'date', (h.due_at at time zone 'Asia/Riyadh')::date, 'score', x.score, 'max', h.max_score, 'feedback', x.feedback) order by h.due_at desc)
                from hw_submissions x join hw_assignments h on h.id = x.hw_id
               where x.student_id = sid and x.status = 'graded' and x.score is not null), '[]'::jsonb));
end $$;

revoke all on function private.lp_can_approve(uuid), private.gb_columns(int, int) from public, anon, authenticated;

-- =====================================================================
-- مكتبة معلمي دار الذكر: مشاركة الواجبات والاختبارات ومحتوى صفحات المواد بين المعلمين
-- =====================================================================
create table if not exists public.lib_items (
  id          bigserial primary key,
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('hw','exam','post')),
  src_id      bigint not null,
  subject_id  int references public.subjects(id) on delete set null,
  grade_label text,
  title       text not null,
  note        text,
  payload     jsonb not null,
  uses        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (kind, src_id)
);
create index if not exists lib_items_subject_idx on public.lib_items (subject_id, created_at desc);
alter table public.lib_items enable row level security;
revoke all on public.lib_items from anon, authenticated;

create or replace function public.lib_share(p_kind text, p_id bigint, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); pl jsonb; ttl text; sid int; cls int[]; lid bigint;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if p_kind = 'hw' then
    select jsonb_build_object('title', title, 'instructions', instructions, 'links', links, 'max_score', max_score), title, subject_id, class_ids
      into pl, ttl, sid, cls from hw_assignments where id = p_id and teacher_id = me;
  elsif p_kind = 'exam' then
    select jsonb_build_object('title', title, 'instructions', instructions, 'duration_min', duration_min, 'questions', questions), title, subject_id, class_ids
      into pl, ttl, sid, cls from ex_exams where id = p_id and teacher_id = me;
  elsif p_kind = 'post' then
    select jsonb_build_object('kind', kind, 'title', title, 'body', body, 'links', links), title, subject_id, class_ids
      into pl, ttl, sid, cls from course_posts where id = p_id and teacher_id = me;
  else raise exception 'نوع غير صالح'; end if;
  if pl is null then raise exception 'يمكنك مشاركة ما أنشأته أنت فقط'; end if;
  insert into lib_items(owner_id, kind, src_id, subject_id, grade_label, title, note, payload)
  values (me, p_kind, p_id, sid, (select string_agg(distinct g.name_ar || ' ' || st.name_ar, '، ') from classes c join grades g on g.id = c.grade_id join stages st on st.id = g.stage_id where c.id = any (cls)),
          ttl, nullif(left(btrim(coalesce(p_note,'')), 500), ''), pl)
  on conflict (kind, src_id) do update set payload = excluded.payload, title = excluded.title, note = coalesce(excluded.note, lib_items.note), grade_label = excluded.grade_label, subject_id = excluded.subject_id
  returning id into lid;
  return jsonb_build_object('ok', true, 'id', lid);
end $$;

create or replace function public.lib_unshare(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from lib_items where id = p_id and (owner_id = public.me_id() or public.is_admin());
  if not found then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- هل شاركتُ هذا العنصر؟ (لزر المشاركة)
create or replace function public.lib_shared(p_kind text, p_ids bigint[]) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(src_id), '[]'::jsonb) from lib_items where kind = p_kind and src_id = any (p_ids) and owner_id = public.me_id()
$$;

create or replace function public.lib_list(p_kind text default null, p_subject int default null, p_q text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := coalesce(public.norm(nullif(btrim(coalesce(p_q,'')), '')), '');
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title, 'note', l.note, 'subject_id', l.subject_id,
            'subject', (select name_ar from subjects where id = l.subject_id), 'grade', l.grade_label, 'owner', p.full_name, 'mine', l.owner_id = public.me_id(),
            'created_at', l.created_at, 'uses', l.uses,
            'n_questions', case when l.kind = 'exam' then jsonb_array_length(l.payload->'questions') end,
            'snip', left(coalesce(l.payload->>'instructions', l.payload->>'body', ''), 220)) order by l.created_at desc)
    from (select * from lib_items l where (p_kind is null or l.kind = p_kind) and (p_subject is null or l.subject_id = p_subject)
            and (q = '' or public.norm(l.title || ' ' || coalesce(l.note,'') || ' ' || coalesce(l.grade_label,'')) like '%' || q || '%')
          order by l.created_at desc limit 300) l join profiles p on p.id = l.owner_id), '[]'::jsonb);
end $$;

create or replace function public.lib_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  select jsonb_build_object('id', l.id, 'kind', l.kind, 'title', l.title, 'note', l.note, 'subject_id', l.subject_id, 'subject', (select name_ar from subjects where id = l.subject_id),
           'grade', l.grade_label, 'owner', (select full_name from profiles where id = l.owner_id), 'payload', l.payload) into r from lib_items l where l.id = p_id;
  if r is null then raise exception 'غير موجود'; end if;
  return r;
end $$;

-- استخدام عنصر من المكتبة: يُسجّل الاستخدام، وللاختبار تُنسخ أسئلته إلى بنك أسئلتي
create or replace function public.lib_use(p_id bigint, p_subject int default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare l lib_items; me uuid := public.me_id(); q jsonb; n int := 0; ids jsonb := '[]'::jsonb; nid bigint;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  select * into l from lib_items where id = p_id;
  if not found then raise exception 'غير موجود'; end if;
  if l.kind = 'exam' then
    if p_subject is null or not exists (select 1 from teaching_assignments where teacher_id = me and subject_id = p_subject) then raise exception 'اختر مادة من موادك'; end if;
    for q in select * from jsonb_array_elements(l.payload->'questions') loop
      insert into qb_questions(owner_id, subject_id, qtype, body, options, answer, points, image, topic)
      values (me, p_subject, q->>'qtype', q->>'body', coalesce(q->'options','[]'::jsonb), q->>'answer', coalesce((q->>'points')::numeric, 1), q->>'image', 'من المكتبة: ' || left(l.title, 80))
      returning id into nid;
      ids := ids || to_jsonb(nid); n := n + 1;
    end loop;
  end if;
  update lib_items set uses = uses + 1 where id = p_id and owner_id <> me;
  return jsonb_build_object('ok', true, 'imported', n, 'ids', ids);
end $$;

revoke all on function public.lib_share(text, bigint, text), public.lib_unshare(bigint), public.lib_shared(text, bigint[]), public.lib_list(text, int, text), public.lib_get(bigint), public.lib_use(bigint, int) from public, anon;
grant execute on function public.lib_share(text, bigint, text), public.lib_unshare(bigint), public.lib_shared(text, bigint[]), public.lib_list(text, int, text), public.lib_get(bigint), public.lib_use(bigint, int) to authenticated;

-- =====================================================================
-- متابعة الالتزام: المعلمون (ضمن من أتابعهم) بعدد التحاضير والواجبات والاختبارات في فترة
-- =====================================================================
create or replace function public.an_compliance(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := coalesce(p_from, current_date - extract(dow from current_date)::int); t date := coalesce(p_to, f + 4);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    select jsonb_build_object('id', p.id, 'name', p.full_name,
             'subjects', (select string_agg(distinct s.name_ar, '، ') from teaching_assignments ta join subjects s on s.id = ta.subject_id where ta.teacher_id = p.id),
             'periods', (select count(*) from tt_slots sl where sl.teacher_id = p.id and sl.kind = 'class'),
             'lp', (select count(*) from lesson_plans l where l.teacher_id = p.id and l.lesson_date between f and t),
             'lp_sent', (select count(*) from lesson_plans l where l.teacher_id = p.id and l.lesson_date between f and t and l.status <> 'draft'),
             'lp_ok', (select count(*) from lesson_plans l where l.teacher_id = p.id and l.lesson_date between f and t and l.status = 'approved'),
             'lp_ret', (select count(*) from lesson_plans l where l.teacher_id = p.id and l.lesson_date between f and t and l.status = 'returned'),
             'hw', (select count(*) from hw_assignments h where h.teacher_id = p.id and (h.created_at at time zone 'Asia/Riyadh')::date between f and t),
             'ex', (select count(*) from ex_exams e where e.teacher_id = p.id and (e.opens_at at time zone 'Asia/Riyadh')::date between f and t)) x
      from profiles p
     where p.active and exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id) and private.lp_is_reviewer(p.id)) z), '[]'::jsonb);
end $$;
revoke all on function public.an_compliance(date, date) from public, anon;
grant execute on function public.an_compliance(date, date) to authenticated;

-- =====================================================================
-- الفصول والطلاب (ضمن صلاحية المستخدم)
-- =====================================================================
create or replace function public.cls_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'label', vc.label, 'name', vc.name, 'grade', vc.grade_name, 'grade_id', vc.grade_id, 'stage', vc.stage_name,
             'students', vc.student_count, 'homeroom', (select full_name from profiles where id = vc.homeroom_teacher_id),
             'teachers', (select count(distinct teacher_id) from teaching_assignments where class_id = vc.id),
             'absent_today', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id join students s on s.profile_id = m.student_id
                               where a.day = d and a.period = 0 and m.status = 'absent' and s.class_id = vc.id),
             'att_taken', exists (select 1 from attendance_sessions a where a.day = d and a.period = 0 and a.grade_id = vc.grade_id and (a.class_id is null or a.class_id = vc.id)))
           order by vc.stage_sort, vc.grade_number, vc.name)
    from v_classes vc where vc.active and public.can_view_class(vc.id)), '[]'::jsonb);
end $$;

create or replace function public.cls_students(p_class int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := (now() at time zone 'Asia/Riyadh')::date - 60;
begin
  if not public.is_staff() or not public.can_view_class(p_class) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('class', (select label from v_classes where id = p_class),
    'homeroom', (select p.full_name from classes c join profiles p on p.id = c.homeroom_teacher_id where c.id = p_class),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('name', p.full_name, 'subject', s.name_ar)) from teaching_assignments ta join profiles p on p.id = ta.teacher_id join subjects s on s.id = ta.subject_id where ta.class_id = p_class), '[]'::jsonb),
    'students', coalesce((select jsonb_agg(jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number, 'guardian', s.guardian_name, 'phone', s.guardian_phone,
             'absent', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'absent'),
             'late', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'late'),
             'pf', (select count(*) from pf_items i where i.student_id = s.profile_id and i.status = 'approved')) order by p.full_name)
       from students s join profiles p on p.id = s.profile_id where s.class_id = p_class and p.active), '[]'::jsonb));
end $$;
revoke all on function public.cls_overview(), public.cls_students(int) from public, anon;
grant execute on function public.cls_overview(), public.cls_students(int) to authenticated;
