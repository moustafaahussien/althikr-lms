
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; t2 record; s1 uuid; s2 uuid; s3 uuid; se text; r jsonb; hid bigint; eid bigint; res text := '';
begin
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id where p.role = 'teacher' and p.email is not null limit 1;
  select p.id, p.email into t2 from profiles p where p.role = 'teacher' and p.email is not null and p.active
     and not exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id and ta.class_id = t.class_id)
     and exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id) limit 1;
  select (array_agg(sp.id order by sp.email))[1], (array_agg(sp.id order by sp.email))[2], (array_agg(sp.id order by sp.email))[3], (array_agg(sp.email order by sp.email))[1]
    into s1, s2, s3, se from (select sp.id, sp.email from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 3) sp;
  update students set class_id = t.class_id where profile_id in (s1, s2, s3);
  insert into hw_assignments(teacher_id, subject_id, class_ids, title, due_at, max_score) values (t.id, t.subject_id, array[t.class_id], 'واجب', now(), 10) returning id into hid;
  insert into hw_submissions(hw_id, student_id, status, score) values (hid, s1, 'graded', 8), (hid, s2, 'graded', 6);
  insert into ex_exams(teacher_id, subject_id, class_ids, title, questions, opens_at, closes_at)
    values (t.id, t.subject_id, array[t.class_id], 'اختبار', '[{"id":"q1","qtype":"mcq","body":"س1","options":[{"t":"a","ok":true},{"t":"b","ok":false}],"points":2}]', now() - interval '1 hour', now()) returning id into eid;
  insert into ex_attempts(exam_id, student_id, deadline, submitted_at, results, score, max_score) values
    (eid, s1, now(), now(), '{"q1":{"pts":2,"ok":true}}', 2, 2), (eid, s2, now(), now(), '{"q1":{"pts":2,"ok":true}}', 2, 2), (eid, s3, now(), now(), '{"q1":{"pts":0,"ok":false}}', 0, 2);

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.an_overview(null, null);
  select x into r from jsonb_array_elements(r) x where (x->>'class_id')::int = t.class_id and (x->>'subject_id')::int = t.subject_id;
  res := res || ' size=' || (r->>'size') || ' hw=' || (r->>'hw_n') || '/' || (r->>'hw_rate') || '%/' || (r->>'hw_avg') || ' ex=' || (r->>'ex_n') || '/' || (r->>'ex_rate') || '%/' || (r->>'ex_avg') || ' mine=' || (r->>'mine');
  r := public.an_questions(t.subject_id, null, null); res := res || ' hardQ=' || jsonb_array_length(r) || ' rate=' || coalesce(r->0->>'rate', 'null');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t2.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.an_overview(null, null);
  res := res || ' t2rows=' || jsonb_array_length(r) || ' t2seesClass=' || exists (select 1 from jsonb_array_elements(r) x where (x->>'class_id')::int = t.class_id and (x->>'subject_id')::int = t.subject_id)::text;
  res := res || ' t2Q=' || jsonb_array_length(public.an_questions(t.subject_id, null, null));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', se, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.an_overview(null, null); res := res || ' BAD:stu'; exception when others then res := res || ' stuBlocked'; end;
  reset role;
  set local role anon;
  begin perform public.an_overview(null, null); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
