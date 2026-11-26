-- ============================================================
-- 73) أنواع أسئلة جديدة في الاختبارات وبنك الأسئلة:
--   multi  = اختيار متعدد (أكثر من إجابة صحيحة، درجة جزئية)
--   order  = ترتيب العناصر (درجة لكل موضع صحيح)
--   fill   = أكمل الفراغ: الإجابات بين [[ ]] داخل النص، والبدائل بـ | مثل [[الرياض|رياض]]
--   essay  = سؤال مقالي (تصحيح يدوي)
--   image  = إجابة بصورة: الطالب يصوّر حلّه من الجوال ويرفعه (تصحيح يدوي)
-- ============================================================
alter table public.qb_questions drop constraint if exists qb_questions_qtype_check;
alter table public.qb_questions add constraint qb_questions_qtype_check check (qtype in ('mcq','tf','short','match','multi','order','fill','essay','image'));

create or replace function public.qb_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); qid bigint := nullif(p->>'id','')::bigint; sid int := nullif(p->>'subject_id','')::int;
        t text := p->>'qtype'; b text := btrim(coalesce(p->>'body','')); opts jsonb; nok int; img text := nullif(p->>'image','');
begin
  if img is not null and (img !~ '^data:image/(png|jpeg|webp|gif);base64,' or length(img) > 450000) then raise exception 'الصورة غير صالحة أو كبيرة جدًا'; end if;
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if sid is null or not exists (select 1 from teaching_assignments where teacher_id = me and subject_id = sid) then
    raise exception 'اختر مادة من موادك المسندة إليك'; end if;
  if t not in ('mcq','tf','short','match','multi','order','fill','essay','image') then raise exception 'نوع السؤال غير صالح'; end if;
  if b = '' then raise exception 'اكتب نص السؤال'; end if;
  if length(b) > 5000 then raise exception 'نص السؤال طويل جدًا'; end if;
  if t = 'mcq' then
    select coalesce(jsonb_agg(jsonb_build_object('t', left(btrim(o->>'t'), 500), 'ok', coalesce((o->>'ok')::boolean, false))), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) o where btrim(coalesce(o->>'t','')) <> '';
    select count(*) into nok from jsonb_array_elements(opts) o where (o->>'ok')::boolean;
    if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'الاختيار من متعدد يحتاج من 2 إلى 8 خيارات'; end if;
    if nok <> 1 then raise exception 'حدّد إجابة صحيحة واحدة'; end if;
  elsif t = 'multi' then
    select coalesce(jsonb_agg(jsonb_build_object('t', left(btrim(o->>'t'), 500), 'ok', coalesce((o->>'ok')::boolean, false))), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) o where btrim(coalesce(o->>'t','')) <> '';
    select count(*) into nok from jsonb_array_elements(opts) o where (o->>'ok')::boolean;
    if jsonb_array_length(opts) < 3 or jsonb_array_length(opts) > 8 then raise exception 'الاختيار المتعدد يحتاج من 3 إلى 8 خيارات'; end if;
    if nok < 1 then raise exception 'حدّد إجابة صحيحة واحدة على الأقل'; end if;
  elsif t = 'order' then
    select coalesce(jsonb_agg(jsonb_build_object('t', left(btrim(o->>'t'), 300)) order by n), '[]'::jsonb)
      into opts from jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) with ordinality x(o, n) where btrim(coalesce(o->>'t','')) <> '';
    if jsonb_array_length(opts) < 2 or jsonb_array_length(opts) > 8 then raise exception 'الترتيب يحتاج من 2 إلى 8 عناصر'; end if;
  elsif t = 'fill' then
    if b !~ '\[\[[^\]]+\]\]' then raise exception 'ضع الإجابة بين قوسين مزدوجين داخل النص، مثل: عاصمة السعودية [[الرياض]]'; end if;
    if (select count(*) from regexp_matches(b, '\[\[[^\]]+\]\]', 'g')) > 10 then raise exception 'الحد الأقصى 10 فراغات'; end if;
    opts := '[]'::jsonb;
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
             'opts', case when q->>'qtype' in ('mcq','match','multi') then (select jsonb_agg(i - 1 order by case when e.shuffle then random() else i end)
                                                         from generate_series(1, jsonb_array_length(q->'options')) i)
                          when q->>'qtype' = 'order' then (select jsonb_agg(i - 1 order by random()) from generate_series(1, jsonb_array_length(q->'options')) i)
                          else '[]'::jsonb end)
             order by case when e.shuffle then random() else qn end), '[]'::jsonb)
      into ord from jsonb_array_elements(e.questions) with ordinality t(q, qn);
    insert into ex_attempts(exam_id, student_id, deadline, q_order, max_score)
    values (p_id, me, least(e.closes_at, now() + make_interval(mins => e.duration_min)), ord,
            (select coalesce(sum((q->>'points')::numeric), 0) from jsonb_array_elements(e.questions) q))
    returning * into a;
  end if;
  return jsonb_build_object('attempt', a.id, 'title', e.title, 'instructions', e.instructions, 'deadline', a.deadline, 'now', now(), 'answers', a.answers,
    'questions', (select jsonb_agg(jsonb_build_object('id', q->>'id', 'qtype', q->>'qtype', 'points', q->'points', 'image', q->>'image',
                   -- أكمل الفراغ: لا يُرسل النص الأصلي (فيه الإجابات) بل أجزاؤه بين الفراغات
                   'body', case when q->>'qtype' = 'fill' then regexp_replace(q->>'body', '\[\[[^\]]*\]\]', ' ＿＿＿ ', 'g') else q->>'body' end,
                   'parts', case when q->>'qtype' = 'fill' then to_jsonb(regexp_split_to_array(q->>'body', '\[\[[^\]]*\]\]')) end,
                   -- المزاوجة: العمود الأول بترتيبه، والثاني مخلوط ويُرسل بموضعه فقط (لا يكشف الزوج الصحيح)
                   'left', case when q->>'qtype' = 'match' then (select jsonb_agg(jsonb_build_object('k', i - 1, 't', v->>'l') order by i) from jsonb_array_elements(q->'options') with ordinality w(v, i)) end,
                   'options', case when q->>'qtype' = 'match' then (select jsonb_agg(jsonb_build_object('i', n - 1, 't', q->'options'->(oi::int)->>'r') order by n)
                                                                     from jsonb_array_elements_text(o->'opts') with ordinality z(oi, n))
                                   when q->>'qtype' in ('mcq','tf','multi','order') then (select jsonb_agg(jsonb_build_object('i', oi::int, 't', q->'options'->(oi::int)->>'t') order by n)
                                                                           from jsonb_array_elements_text(case when q->>'qtype' = 'tf' then '[0,1]'::jsonb else o->'opts' end) with ordinality z(oi, n))
                                   else '[]'::jsonb end) order by k)
                  from jsonb_array_elements(a.q_order) with ordinality y(o, k)
                  join jsonb_array_elements(e.questions) q on q->>'id' = o->>'id'));
end $$;

create or replace function public.ex_submit(p_id bigint, p_answers jsonb, p_final boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ex_exams; a ex_attempts; me uuid := public.me_id(); q jsonb; res jsonb := '{}'::jsonb; tot numeric := 0; ans text; ok boolean; review boolean := false;
        okidx int; ord jsonb; np int; nc int; kv text; ncor int; nwr int; arr text[]; blanks text[]; i int; sa jsonb; pts numeric;
begin
  select * into e from ex_exams where id = p_id;
  select * into a from ex_attempts where exam_id = p_id and student_id = me for update;
  if a.id is null then raise exception 'ابدأ الاختبار أولًا'; end if;
  if a.submitted_at is not null then raise exception 'سلّمت هذا الاختبار من قبل'; end if;
  if jsonb_typeof(coalesce(p_answers,'{}'::jsonb)) <> 'object' or length(p_answers::text) > 1500000 then raise exception 'إجابات غير صالحة'; end if;
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
    elsif q->>'qtype' = 'multi' then
      arr := string_to_array(nullif(ans, ''), ',');
      select count(*) into np from jsonb_array_elements(q->'options') v where (v->>'ok')::boolean;
      select count(*) filter (where (q->'options'->(x::int)->>'ok')::boolean), count(*) filter (where not coalesce((q->'options'->(x::int)->>'ok')::boolean, false))
        into ncor, nwr from unnest(coalesce(arr, '{}')) x where x ~ '^\d+$' and x::int < jsonb_array_length(q->'options');
      pts := round((q->>'points')::numeric * greatest(0, ncor - nwr) / greatest(np, 1), 2);
      res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', pts, 'ok', ncor = np and nwr = 0, 'nc', ncor, 'np', np));
      tot := tot + pts;
    elsif q->>'qtype' = 'order' then
      arr := string_to_array(nullif(ans, ''), ','); np := jsonb_array_length(q->'options'); nc := 0;
      for i in 1..coalesce(array_length(arr, 1), 0) loop
        if arr[i] ~ '^\d+$' and arr[i]::int = i - 1 then nc := nc + 1; end if;
      end loop;
      nc := least(nc, np); pts := round((q->>'points')::numeric * nc / np, 2);
      res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', pts, 'ok', nc = np, 'nc', nc, 'np', np));
      tot := tot + pts;
    elsif q->>'qtype' = 'fill' then
      select array_agg(m[1] order by n) into blanks from regexp_matches(q->>'body', '\[\[([^\]]*)\]\]', 'g') with ordinality r(m, n);
      begin sa := ans::jsonb; exception when others then sa := '[]'::jsonb; end;
      if jsonb_typeof(sa) <> 'array' then sa := '[]'::jsonb; end if;
      np := coalesce(array_length(blanks, 1), 0); nc := 0;
      for i in 1..np loop
        if exists (select 1 from unnest(string_to_array(blanks[i], '|')) alt where public.norm(btrim(alt)) = public.norm(btrim(coalesce(sa->>(i - 1), '')))
                    and btrim(coalesce(sa->>(i - 1), '')) <> '') then nc := nc + 1; end if;
      end loop;
      pts := case when np > 0 then round((q->>'points')::numeric * nc / np, 2) else 0 end;
      res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', pts, 'ok', np > 0 and nc = np, 'nc', nc, 'np', np));
      tot := tot + pts;
    elsif q->>'qtype' in ('essay','image') then
      if ans = '' or (q->>'qtype' = 'image' and ans !~ '^data:image/') then
        res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', 0, 'ok', false));
      else
        res := res || jsonb_build_object(q->>'id', jsonb_build_object('pts', 0, 'ok', null, 'manual', true)); review := true;
      end if;
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
    'questions', (select jsonb_agg(jsonb_build_object('body', case when q->>'qtype' = 'fill' and now() <= e.closes_at then regexp_replace(q->>'body', '\[\[[^\]]*\]\]', ' ＿＿＿ ', 'g') else q->>'body' end, 'qtype', q->>'qtype', 'points', q->'points', 'mine', a.answers->>(q->>'id'), 'image', q->>'image',
                    'pairs', case when q->>'qtype' = 'match' and now() > e.closes_at then q->'options' end,
                    'solution', case when now() > e.closes_at then case q->>'qtype'
                        when 'multi' then (select jsonb_agg(v->>'t') from jsonb_array_elements(q->'options') v where (v->>'ok')::boolean)
                        when 'order' then (select jsonb_agg(v->>'t') from jsonb_array_elements(q->'options') v)
                        when 'fill' then (select jsonb_agg(m[1]) from regexp_matches(q->>'body', '\[\[([^\]]*)\]\]', 'g') m) end end,
                    'body_view', case when q->>'qtype' = 'fill' then regexp_replace(q->>'body', '\[\[[^\]]*\]\]', ' ＿＿＿ ', 'g') end,
                    'result', a.results->(q->>'id'), 'options', case when q->>'qtype' in ('match','fill','essay','image') then null else (select jsonb_agg(v->>'t') from jsonb_array_elements(q->'options') v) end,
                    'correct', case when now() > e.closes_at and q->>'qtype' in ('mcq','tf','short') then coalesce((select (i - 1)::text from jsonb_array_elements(q->'options') with ordinality o(v, i) where (v->>'ok')::boolean limit 1), q->>'answer') end))
                  from jsonb_array_elements(e.questions) q));
end $$;
