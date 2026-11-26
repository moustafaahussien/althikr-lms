-- ============================================================
-- 72) لوحة مؤشرات القيادة: مؤشرات كل مرحلة في صفحة واحدة (من بيانات المنصة نفسها)
-- الإدارة العليا ترى كل المراحل، ومدير المرحلة يرى مرحلته.
-- ============================================================

create or replace function public.ld_dashboard(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare f date := coalesce(p_from, date_trunc('month', current_date)::date); t date := coalesce(p_to, current_date); st int[]; out jsonb;
begin
  if public.me_role() in ('admin','leadership') then select array_agg(id) into st from stages;
  elsif public.me_role() = 'principal' then st := private.my_stage_ids();
  else raise exception 'لوحة المؤشرات للقيادة ومديري المراحل'; end if;

  with sg as (select s.id, s.name_ar, s.sort from stages s where s.id = any (st)),
  cls as (select c.id, g.stage_id from classes c join grades g on g.id = c.grade_id where c.active),
  stu as (select s.profile_id, g.stage_id, s.class_id from students s join grades g on g.id = s.grade_id join profiles p on p.id = s.profile_id and p.active),
  tch as (select distinct ta.teacher_id, c.stage_id from teaching_assignments ta join cls c on c.id = ta.class_id join profiles p on p.id = ta.teacher_id and p.active),
  att as (select g.stage_id, sum(a.total) tot, sum(a.absent) ab, sum(a.late) lt, sum(a.excused) ex, count(distinct a.day) days
            from attendance_sessions a join grades g on g.id = a.grade_id where a.period = 0 and a.day between f and t group by 1),
  lp as (select tc.stage_id, count(distinct l.id) n, count(distinct l.id) filter (where l.status <> 'draft') sent, count(distinct l.id) filter (where l.status = 'approved') ok
           from lesson_plans l join tch tc on tc.teacher_id = l.teacher_id
          where l.lesson_date between f and t and exists (select 1 from cls c where c.id = any (l.class_ids) and c.stage_id = tc.stage_id) group by 1),
  hw as (select c.stage_id, count(distinct h.id) n,
                sum((select count(*) from stu x where x.class_id = c.id)) expected,
                sum((select count(*) from hw_submissions s join stu x on x.profile_id = s.student_id where s.hw_id = h.id and x.class_id = c.id)) got
           from hw_assignments h join cls c on c.id = any (h.class_ids) where (h.due_at at time zone 'Asia/Riyadh')::date between f and t group by 1),
  ex as (select x.stage_id, count(distinct a.exam_id) n, round(avg(a.score * 100 / nullif(a.max_score, 0)), 1) avg
           from ex_attempts a join stu x on x.profile_id = a.student_id where a.submitted_at::date between f and t and a.score is not null group by 1),
  bh as (select x.stage_id, count(*) filter (where n.kind = 'positive') pos, count(*) filter (where n.kind = 'negative') neg,
                count(*) filter (where n.refer) refs
           from bh_notes n join stu x on x.profile_id = n.student_id where n.note_date between f and t group by 1),
  ew as (select x.stage_id, count(*) n from ew_cases c join stu x on x.profile_id = c.student_id where c.status <> 'closed' group by 1),
  sub as (select tc.stage_id, count(distinct a.id) slots, count(distinct a.id) filter (where a.status = 'assigned') covered, count(distinct b.id) absences
            from sub_absences b join tch tc on tc.teacher_id = b.teacher_id left join sub_assignments a on a.absence_id = b.id
           where b.day between f and t group by 1),
  trn as (select tc.stage_id, coalesce(sum(r.hours), 0) hrs, count(distinct r.profile_id) ppl
            from trainings r join tch tc on tc.teacher_id = r.profile_id where coalesce(r.end_date, r.start_date) between f and t group by 1),
  cl as (select x.stage_id, count(*) n from cl_visits v join stu x on x.profile_id = v.student_id where (v.visited_at at time zone 'Asia/Riyadh')::date between f and t group by 1),
  bk as (select x.stage_id, count(*) n from bk_loans l join stu x on x.profile_id = l.borrower_id where l.loaned_at::date between f and t group by 1),
  cp as (select x.stage_id, count(*) filter (where c.status not in ('closed','resolved')) open_n, count(*) n
           from complaints c join stu x on x.profile_id = c.student_id where c.created_at::date between f and t group by 1)
  select jsonb_build_object('from', f, 'to', t, 'stages', coalesce(jsonb_agg(jsonb_build_object(
      'id', sg.id, 'name', sg.name_ar,
      'students', (select count(*) from stu where stu.stage_id = sg.id),
      'classes', (select count(*) from cls where cls.stage_id = sg.id),
      'teachers', (select count(*) from tch where tch.stage_id = sg.id),
      'att_days', coalesce(att.days, 0),
      'attendance', case when att.tot > 0 then round(100 - (att.ab + att.ex) * 100.0 / att.tot, 1) end,
      'absence', case when att.tot > 0 then round(att.ab * 100.0 / att.tot, 1) end,
      'late', case when att.tot > 0 then round(att.lt * 100.0 / att.tot, 1) end,
      'lp', coalesce(lp.n, 0), 'lp_sent', coalesce(lp.sent, 0), 'lp_ok', coalesce(lp.ok, 0),
      'hw', coalesce(hw.n, 0), 'hw_rate', case when hw.expected > 0 then round(hw.got * 100.0 / hw.expected, 1) end,
      'exams', coalesce(ex.n, 0), 'ex_avg', ex.avg,
      'bh_pos', coalesce(bh.pos, 0), 'bh_neg', coalesce(bh.neg, 0), 'bh_ref', coalesce(bh.refs, 0),
      'ew_open', coalesce(ew.n, 0),
      'sub_slots', coalesce(sub.slots, 0), 'sub_cov', case when sub.slots > 0 then round(sub.covered * 100.0 / sub.slots, 1) end, 'sub_abs', coalesce(sub.absences, 0),
      'trn_hours', coalesce(trn.hrs, 0), 'trn_people', coalesce(trn.ppl, 0),
      'clinic', coalesce(cl.n, 0), 'loans', coalesce(bk.n, 0),
      'complaints', coalesce(cp.n, 0), 'complaints_open', coalesce(cp.open_n, 0)) order by sg.sort), '[]'::jsonb),
    'trend', coalesce((select jsonb_agg(jsonb_build_object('wk', w.wk, 'stage', w.stage_id, 'att', w.att) order by w.wk)
       from (select date_trunc('week', a.day + 1)::date - 1 wk, g.stage_id, round(100 - (sum(a.absent) + sum(a.excused)) * 100.0 / nullif(sum(a.total), 0), 1) att
               from attendance_sessions a join grades g on g.id = a.grade_id
              where a.period = 0 and a.day >= current_date - 70 and g.stage_id = any (st) group by 1, 2) w), '[]'::jsonb))
    into out
    from sg left join att on att.stage_id = sg.id left join lp on lp.stage_id = sg.id left join hw on hw.stage_id = sg.id left join ex on ex.stage_id = sg.id
    left join bh on bh.stage_id = sg.id left join ew on ew.stage_id = sg.id left join sub on sub.stage_id = sg.id left join trn on trn.stage_id = sg.id
    left join cl on cl.stage_id = sg.id left join bk on bk.stage_id = sg.id left join cp on cp.stage_id = sg.id;
  return out;
end $$;

revoke all on function public.ld_dashboard(date, date) from public, anon;
grant execute on function public.ld_dashboard(date, date) to authenticated;
