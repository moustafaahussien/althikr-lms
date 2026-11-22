-- =====================================================================
-- 42: اعتماد التحضير — المشرف التربوي للمعلم، فإن لم يكن للمعلم مشرف
--     فمدير المرحلة التي يدرّس فيها (طلب مصطفى 23 نوفمبر)
-- =====================================================================
create or replace function private.lp_can_approve(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_teacher <> public.me_id() and (
    exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id = public.me_id())
    or (public.me_role() = 'principal'
        and not exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id <> p_teacher)
        and exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
                     where ta.teacher_id = p_teacher and g.stage_id = any (private.my_stage_ids()))))
$$;
revoke all on function private.lp_can_approve(uuid) from public, anon, authenticated;

-- خيارات الصفحة: من يعتمد (مشرف، أو مدير مرحلة فيها معلمون بلا مشرف)
create or replace function public.lp_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subjects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name_ar)) from teaching_assignments ta join subjects s on s.id = ta.subject_id where ta.teacher_id = public.me_id()), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'label', vc.label, 'subjects', x.subs) order by vc.stage_sort, vc.grade_number, vc.name)
                from (select class_id, jsonb_agg(distinct subject_id) subs from teaching_assignments where teacher_id = public.me_id() group by class_id) x join v_classes vc on vc.id = x.class_id), '[]'::jsonb),
    'is_teacher', exists (select 1 from teaching_assignments where teacher_id = public.me_id()),
    'can_review', exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id())
                  or (public.me_role() = 'principal' and exists (select 1 from (select distinct teacher_id from teaching_assignments) ta where private.lp_can_approve(ta.teacher_id))),
    'can_follow', public.me_role() in ('admin','leadership','principal','supervisor')
                  or exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id()))
$$;
