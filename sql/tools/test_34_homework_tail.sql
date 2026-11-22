
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; st record; o record; r jsonb; hid bigint; res text := '';
begin
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id
   where p.role = 'teacher' and p.email is not null limit 1;
  -- (للاختبار فقط، يُلغى مع التراجع) لا يوجد طلاب مربوطون بفصول حاليًا: نربط طالبين مؤقتًا
  select sp.id, sp.email into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  select sp.id, sp.email into o from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active and sp.id <> st.id order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;
  update students set class_id = (select id from classes where id <> t.class_id limit 1) where profile_id = o.id;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.hw_save(jsonb_build_object('title','واجب تجريبي','due_at', (now() + interval '2 days')::text,'max_score',10,'subject_id',t.subject_id,
        'class_ids',jsonb_build_array(t.class_id),'links',jsonb_build_array(jsonb_build_object('url','javascript:alert(1)'),jsonb_build_object('url','https://example.com/a','title','ملف'))));
  hid := (r->>'id')::bigint;
  r := public.hw_get(hid); res := res || ' links=' || jsonb_array_length(r->'links') || ' roster=' || jsonb_array_length(r->'roster');
  begin perform public.hw_save(jsonb_build_object('title','x','due_at',now()::text,'class_ids',jsonb_build_array(-1))); res := res || ' BAD:foreign'; exception when others then res := res || ' foreignBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' stuList=' || jsonb_array_length(public.hw_list('student'));
  r := public.hw_get(hid); res := res || ' canSubmit=' || (r->>'can_submit');
  perform public.hw_submit(hid, 'إجابتي', '[]'::jsonb);
  begin perform public.hw_grade(hid, st.id, 'grade', 10, null); res := res || ' BAD:student-grades'; exception when others then res := res || ' stuGradeBlocked'; end;
  begin perform public.hw_save(jsonb_build_object('title','x','due_at',now()::text,'class_ids',jsonb_build_array(t.class_id))); res := res || ' BAD:student-creates'; exception when others then res := res || ' stuCreateBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', o.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.hw_get(hid); res := res || ' BAD:other-class-reads'; exception when others then res := res || ' otherClassBlocked'; end;
  begin perform public.hw_submit(hid, 'x', '[]'::jsonb); res := res || ' BAD:other-submits'; exception when others then res := res || ' otherSubmitBlocked'; end;
  res := res || ' otherList=' || jsonb_array_length(public.hw_list('student'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.hw_list('mine'); res := res || ' submitted=' || (r->0->>'submitted');
  begin perform public.hw_grade(hid, st.id, 'grade', 11, null); res := res || ' BAD:over-max'; exception when others then res := res || ' overMaxBlocked'; end;
  perform public.hw_grade(hid, st.id, 'grade', 9, 'أحسنت');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.hw_get(hid); res := res || ' myScore=' || (r->'sub'->>'score') || ' canSubmitAfterGrade=' || (r->>'can_submit');
  begin perform public.hw_submit(hid, 'تعديل', '[]'::jsonb); res := res || ' BAD:resubmit-graded'; exception when others then res := res || ' gradedLocked'; end;
  reset role;

  set local role anon;
  begin perform public.hw_list('mine'); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  begin set local role authenticated; perform count(*) from public.hw_submissions; res := res || ' BAD:direct'; exception when others then res := res || ' tableBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
