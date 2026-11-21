-- =====================================================================
--  الملف 22: تصحيح النصاب — الحصة تُحسب مرة واحدة حتى لو تكرر نفس الجدول في أكثر من ورقة مشرف
--  (مثال: جدول المسار الأمريكي مرفوع عند مشرفين، فكانت حصص المعلم تُحسب مرتين)
-- =====================================================================
create or replace function private.tt_refresh() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from teaching_assignments where source = 'timetable';
  insert into teaching_assignments(teacher_id, class_id, subject_id, weekly_periods, source)
  select sl.teacher_id, sl.class_id, coalesce(sl.subject_id, ts.subject_id),
         least(count(distinct (sl.day, sl.period)), 99), 'timetable'
  from tt_slots sl left join tt_teacher_subject ts on ts.sheet_id = sl.sheet_id and ts.teacher_id = sl.teacher_id
  where sl.kind = 'class' and sl.teacher_id is not null and sl.class_id is not null
    and coalesce(sl.subject_id, ts.subject_id) is not null
  group by 1, 2, 3
  on conflict (teacher_id, class_id, subject_id) do nothing;
  update profiles p set active = x.has
  from (select pr.id, exists (select 1 from tt_slots s where s.teacher_id = pr.id) has
        from profiles pr where pr.source = 'timetable' and pr.email is null) x
  where p.id = x.id and p.active <> x.has;
end $$;

-- النصاب الأسبوعي للمعلم = عدد الحصص الفعلية (يوم × حصة) بدون تكرار، حتى لو درّس فصلين معًا في نفس الحصة
create or replace view public.v_staff_teaching with (security_invoker = on) as
select ta.teacher_id,
       string_agg(distinct s.name_ar, '، ')     as subjects,
       string_agg(distinct vc.stage_name, '، ') as stages,
       count(distinct ta.class_id)              as class_count,
       coalesce((select count(distinct (sl.day, sl.period)) from public.tt_slots sl
                  where sl.teacher_id = ta.teacher_id and sl.kind = 'class'), sum(ta.weekly_periods), 0) as weekly_periods,
       jsonb_agg(jsonb_build_object('class_id', vc.id, 'label', vc.label, 'stage', vc.stage_name,
                                    'subject', s.name_ar, 'periods', ta.weekly_periods)
                 order by vc.stage_sort, vc.grade_number, vc.name, s.name_ar) as classes,
       (select string_agg(distinct p.full_name, '، ')
          from public.v_teacher_supervisors ts join public.profiles p on p.id = ts.supervisor_id
         where ts.teacher_id = ta.teacher_id) as supervisors
from public.teaching_assignments ta
join public.v_classes vc on vc.id = ta.class_id
join public.subjects s   on s.id = ta.subject_id
group by ta.teacher_id;
grant select on public.v_staff_teaching to authenticated;

select private.tt_refresh();
