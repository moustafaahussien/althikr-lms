-- =====================================================================
--  الملف 9: بيانات تدريس المعلم والفصل (من الإسناد المشتق من جدول الحصص)
-- =====================================================================

-- لكل معلم: مواده، مراحله، فصوله، نصابه، مشرفوه
create or replace view public.v_staff_teaching with (security_invoker = on) as
select ta.teacher_id,
       string_agg(distinct s.name_ar, '، ')     as subjects,
       string_agg(distinct vc.stage_name, '، ') as stages,
       count(distinct ta.class_id)              as class_count,
       coalesce(sum(ta.weekly_periods), 0)      as weekly_periods,
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

-- لكل فصل: معلموه ومواده ونصابه الأسبوعي
create or replace view public.v_class_teaching with (security_invoker = on) as
select ta.class_id,
       count(distinct ta.teacher_id)        as teacher_count,
       count(distinct ta.subject_id)        as subject_count,
       coalesce(sum(ta.weekly_periods), 0)  as weekly_periods,
       jsonb_agg(jsonb_build_object('teacher', p.full_name, 'subject', s.name_ar, 'periods', ta.weekly_periods)
                 order by s.name_ar, p.full_name) as teachers
from public.teaching_assignments ta
join public.profiles p on p.id = ta.teacher_id
join public.subjects s on s.id = ta.subject_id
group by ta.class_id;
grant select on public.v_class_teaching to authenticated;
