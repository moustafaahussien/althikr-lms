
do $T$
declare nid text; nm text; r jsonb;
begin
  select sp.national_id, p.full_name into nid, nm from student_private sp join profiles p on p.id = sp.profile_id join students s on s.profile_id = p.id
   join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id where st.code = 'boys-primary' and g.number = 4 limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', 'm.hussien@althikr.edu.sa', 'role','authenticated')::text, true); set local role authenticated;
  r := public.import_student_classes(jsonb_build_array(
         jsonb_build_object('national_id', nid, 'class', '2'),
         jsonb_build_object('full_name', nm, 'class', '4/ج'),
         jsonb_build_object('national_id', '999', 'class', 'أ'),
         jsonb_build_object('national_id', nid, 'class', 'ب', 'grade', '5')), false);
  reset role;
  raise exception 'TEST % | class now: %', r, (select vc.label from students s join v_classes vc on vc.id = s.class_id join student_private sp on sp.profile_id = s.profile_id where sp.national_id = nid);
end $T$;
