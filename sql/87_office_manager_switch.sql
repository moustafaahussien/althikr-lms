-- ============================================================
-- 87) زر التبديل لمدير مكتب الإشراف: المشرف الذي يحمل صلاحية «مدير» أو «مسؤول النظام» في مكتب الإشراف
--     يتنقّل بين «مدير مكتب الإشراف» (أدوات الإدارة) و«مشرف المادة» (نفس واجهة أي مشرف)
--     my_context يُرجع sv_role
-- ============================================================
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); res jsonb; r text;
begin
  if me is null then
    select role::text into r from profiles where email = public.jwt_email() and active limit 1;
    return jsonb_build_object('registered', false, 'email', public.jwt_email(),
      'domain_ok', public.email_domain_ok(public.jwt_email())
                   or exists (select 1 from profiles where email = public.jwt_email() and role = 'parent' and active),
      'all_closed', r is not null and r <> 'admin' and not public.setting_on('all_login_enabled'),
      'teachers_closed', r = 'teacher' and not public.setting_on('teacher_login_enabled'),
      'students_closed', r = 'student' and not public.student_login_enabled(),
      'parents_closed',  r = 'parent' and not public.parent_login_enabled());
  end if;
  select jsonb_build_object(
    'registered', true,
    'profile', to_jsonb(p) - 'created_at' - 'updated_at',
    'school_name', (select value #>> '{}' from app_settings where key = 'school_name'),
    'beta', coalesce((select value from app_settings where key = 'beta_access'), '{}'::jsonb),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', se.name_ar, 'stage', st.name_ar, 'subject', su.name_ar,
        'grade_min', sc.grade_min, 'grade_max', sc.grade_max, 'note', sc.note))
      from staff_scopes sc
      left join sections se on se.id = sc.section_id
      left join stages st   on st.id = sc.stage_id
      left join subjects su on su.id = sc.subject_id
      where sc.profile_id = me), '[]'::jsonb),
    'student', (
      select jsonb_build_object('id', s.profile_id, 'student_number', s.student_number, 'class_id', s.class_id, 'grade_id', s.grade_id,
                                'class_label', coalesce(vs.label, g.name_ar || ' — ' || stg.name_ar), 'section', vs.section_name)
      from students s left join v_students vs on vs.profile_id = s.profile_id
      left join grades g on g.id = s.grade_id left join stages stg on stg.id = g.stage_id
      where s.profile_id = me),
    'children', (select jsonb_agg(pl.student_id) from parent_links pl where pl.parent_id = me),
    -- دوره في مكتب الإشراف التربوي (owner/sys/admin/member) — لزر التبديل بين «مدير مكتب الإشراف» و«المشرف»
    'sv_role', private.sv_role(me),
    'term', (select jsonb_build_object('year', y.name, 'term', t.name)
             from terms t join academic_years y on y.id = t.year_id where t.is_current limit 1)
  ) into res
  from profiles p where p.id = me;
  return res;
end $$;

