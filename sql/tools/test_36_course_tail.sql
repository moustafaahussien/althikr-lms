
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; st record; o record; ot record; r jsonb; pid bigint; res text := '';
begin
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id where p.role = 'teacher' and p.email is not null limit 1;
  select p.id, p.email into ot from profiles p where p.role = 'teacher' and p.id <> t.id and p.email is not null
     and not exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id and ta.class_id = t.class_id) and not exists (select 1 from v_teacher_supervisors v where v.supervisor_id = p.id) limit 1;
  select sp.id, sp.email into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  select sp.id, sp.email into o from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active and sp.id <> st.id order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;
  update students set class_id = (select id from classes where id <> t.class_id limit 1) where profile_id = o.id;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' tCourses=' || jsonb_array_length(public.cp_courses());
  r := public.cp_save(jsonb_build_object('subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'title', 'الأسبوع الأول', 'body', 'شرح', 'week', '2026-11-29'));
  pid := (r->>'id')::bigint;
  begin perform public.cp_save(jsonb_build_object('subject_id', t.subject_id, 'class_ids', jsonb_build_array(-3), 'title', 'x')); res := res || ' BAD:foreign'; exception when others then res := res || ' foreignBlocked'; end;
  r := public.cp_list(t.class_id, t.subject_id); res := res || ' canPost=' || (r->>'can_post') || ' posts=' || jsonb_array_length(r->'posts');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' sCourses=' || jsonb_array_length(public.cp_courses());
  r := public.cp_list(t.class_id, t.subject_id); res := res || ' sPosts=' || jsonb_array_length(r->'posts') || ' sCanPost=' || (r->>'can_post');
  begin perform public.cp_save(jsonb_build_object('subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'title', 'x')); res := res || ' BAD:student-posts'; exception when others then res := res || ' stuPostBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', o.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.cp_list(t.class_id, t.subject_id); res := res || ' BAD:other-class'; exception when others then res := res || ' otherClassBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', ot.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.cp_delete(pid); res := res || ' BAD:other-teacher-deletes'; exception when others then res := res || ' otherDeleteBlocked'; end;
  begin perform public.cp_list(t.class_id, t.subject_id); res := res || ' BAD:other-teacher-reads'; exception when others then res := res || ' otherTeacherBlocked'; end;
  reset role;

  set local role anon;
  begin perform public.cp_courses(); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
