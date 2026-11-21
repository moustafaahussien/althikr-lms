-- =====================================================================
-- 25) ربط منصة الموهبة ومنصة مهارات القرن 21 بقاعدة بيانات المنصة
--     المنصتان تبقيان بروابطهما، وتقرآن الطلاب والمعلمين من هنا مباشرة
--     (بحساب المدرسة) — لا نسخ للأسماء: يُخزَّن المعرّف فقط والاسم يُقرأ حيًّا.
-- =====================================================================

-- اسم الصف بصيغة منصة الموهبة (مثل: «الأول الابتدائي»، «الثاني الابتدائي بنات»، «Grade 7»)
create or replace function private.tp_grade_label(p_stage text, p_num int) returns text
language sql immutable as $$
  select case
    when p_stage = 'american' then 'Grade ' || p_num
    else (array['الأول','الثاني','الثالث','الرابع','الخامس','السادس'])[p_num] ||
         case p_stage when 'boys-primary' then ' الابتدائي' when 'boys-intermediate' then ' المتوسط'
                      when 'boys-secondary' then ' الثانوي' when 'girls-primary' then ' الابتدائي بنات' else '' end
  end
$$;

-- من أنا؟ (تستخدمه سكربتات Google للتحقق من حساب المدرسة بدل الرموز)
create or replace function public.talent_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p.id is null then jsonb_build_object('ok', false)
    else jsonb_build_object('ok', true, 'id', p.id, 'name', p.full_name, 'email', p.email, 'role', p.role, 'title', coalesce(p.job_title, ''),
      'staff', p.role::text not in ('student', 'parent'),
      'admin', p.role::text in ('admin', 'leadership') or coalesce(p.job_title, '') ~ '(موهب|الموهوبين)',
      'emp_no', (select d.emp_no from staff_directory d where d.profile_id = p.id limit 1))
  end
  from (select 1) x left join profiles p on p.id = public.me_id() and p.active
$$;

-- الطلاب والمنسوبون (للموظفين فقط): الاسم والصف والفصل فقط — بلا هوية ولا جوال
create or replace function public.talent_people() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'لمنسوبي المدرسة فقط'; end if;
  return jsonb_build_object(
    'students', coalesce((
      select jsonb_agg(jsonb_build_object('id', 'lms:' || s.profile_id, 'name', p.full_name,
               'grade', private.tp_grade_label(st.code, g.number), 'cls', coalesce(c.name, ''), 'section', st.code)
             order by st.sort, g.number, c.name, p.full_name)
      from students s join profiles p on p.id = s.profile_id and p.active
      left join classes c on c.id = s.class_id
      left join grades g on g.id = coalesce(s.grade_id, c.grade_id)
      left join stages st on st.id = g.stage_id), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object('id', 'lms:' || p.id, 'name', p.full_name, 'title', coalesce(p.job_title, ''), 'email', coalesce(p.email, ''))
             order by p.full_name)
      from profiles p where p.active and p.role::text not in ('student', 'parent') and coalesce(p.source, '') <> 'system'), '[]'::jsonb));
end $$;

revoke all on function public.talent_whoami() from public, anon;
revoke all on function public.talent_people() from public, anon;
grant execute on function public.talent_whoami() to authenticated;
grant execute on function public.talent_people() to authenticated;
