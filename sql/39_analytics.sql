-- =====================================================================
-- 39: وحدة «التحليل والمقارنة» — مؤشرات الواجبات والاختبارات لكل (فصل × مادة)
--   للمقارنة بين الفصول والمعلمين والمواد، وأصعب الأسئلة
--   الرؤية: المعلم لمقرراته، والمشرف/المدير/القيادة لمن يتابعهم (private.lp_is_reviewer)
-- =====================================================================
create or replace function public.an_overview(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); f timestamptz := coalesce(p_from, current_date - 120)::timestamptz; t timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((
    with ta as (
      select ta.class_id, ta.subject_id, jsonb_agg(distinct p.full_name) teachers, array_agg(distinct ta.teacher_id) tids, bool_or(ta.teacher_id = me) mine
        from teaching_assignments ta join profiles p on p.id = ta.teacher_id
       where ta.teacher_id = me or private.lp_is_reviewer(ta.teacher_id)
       group by ta.class_id, ta.subject_id),
    sz as (select class_id, count(*) n from students st join profiles p on p.id = st.profile_id where p.active and st.class_id is not null group by class_id),
    hw as (
      select c.cid class_id, h.subject_id, count(distinct h.id) n,
             count(s.hw_id) subs, round(avg(s.score / h.max_score * 100) filter (where s.status = 'graded' and s.score is not null), 1) avg
        from hw_assignments h cross join lateral unnest(h.class_ids) c(cid)
        left join (hw_submissions s join students st on st.profile_id = s.student_id) on s.hw_id = h.id and st.class_id = c.cid
       where h.due_at >= f and h.due_at < t
       group by c.cid, h.subject_id),
    ex as (
      select c.cid class_id, e.subject_id, count(distinct e.id) n,
             count(a.id) filter (where a.submitted_at is not null) subs, round(avg(a.score / nullif(a.max_score, 0) * 100) filter (where a.submitted_at is not null), 1) avg
        from ex_exams e cross join lateral unnest(e.class_ids) c(cid)
        left join (ex_attempts a join students st on st.profile_id = a.student_id) on a.exam_id = e.id and st.class_id = c.cid
       where e.opens_at >= f and e.opens_at < t
       group by c.cid, e.subject_id)
    select jsonb_agg(jsonb_build_object('class_id', ta.class_id, 'subject_id', ta.subject_id, 'class', vc.label, 'stage', vc.stage_id, 'grade', vc.grade_number,
             'subject', s.name_ar, 'teachers', ta.teachers, 'mine', ta.mine, 'size', coalesce(sz.n, 0),
             'hw_n', coalesce(hw.n, 0), 'hw_rate', case when hw.n > 0 and sz.n > 0 then round(100.0 * hw.subs / (hw.n * sz.n)) end, 'hw_avg', hw.avg,
             'ex_n', coalesce(ex.n, 0), 'ex_rate', case when ex.n > 0 and sz.n > 0 then round(100.0 * ex.subs / (ex.n * sz.n)) end, 'ex_avg', ex.avg)
           order by vc.stage_sort, vc.grade_number, s.name_ar, vc.name)
      from ta join v_classes vc on vc.id = ta.class_id join subjects s on s.id = ta.subject_id
      left join sz on sz.class_id = ta.class_id
      left join hw on hw.class_id = ta.class_id and hw.subject_id = ta.subject_id
      left join ex on ex.class_id = ta.class_id and ex.subject_id = ta.subject_id), '[]'::jsonb);
end $$;

-- أصعب الأسئلة في مادة (من الاختبارات الإلكترونية المسلّمة) — للمقررات المرئية فقط
create or replace function public.an_questions(p_subject int, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); f timestamptz := coalesce(p_from, current_date - 120)::timestamptz; t timestamptz := (coalesce(p_to, current_date) + 1)::timestamptz;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('exam', z.title, 'exam_id', z.id, 'teacher', z.teacher, 'body', z.q->>'body', 'qtype', z.q->>'qtype', 'n', z.n, 'rate', z.rate)
           order by z.rate, z.n desc) from (
      select e.id, e.title, (select full_name from profiles where id = e.teacher_id) teacher, q, count(*) n,
             round(100.0 * count(*) filter (where coalesce((a.results->(q->>'id')->>'ok')::boolean, false)) / count(*)) rate
        from ex_exams e cross join lateral jsonb_array_elements(e.questions) q
        join ex_attempts a on a.exam_id = e.id and a.submitted_at is not null and a.results ? (q->>'id')
       where e.subject_id = p_subject and e.opens_at >= f and e.opens_at < t
         and (e.teacher_id = me or private.lp_is_reviewer(e.teacher_id))
       group by e.id, e.title, e.teacher_id, q
      having count(*) >= 3
       order by rate, n desc limit 40) z), '[]'::jsonb);
end $$;

revoke all on function public.an_overview(date, date), public.an_questions(int, date, date) from public, anon;
grant execute on function public.an_overview(date, date), public.an_questions(int, date, date) to authenticated;
