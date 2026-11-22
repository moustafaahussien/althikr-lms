
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; t2 record; st record; o record; r jsonb; iid bigint; hid bigint; res text := '';
begin
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id where p.role = 'teacher' and p.email is not null limit 1;
  select p.id, p.email into t2 from profiles p where p.role = 'teacher' and p.email is not null and p.active
     and not exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id and ta.class_id = t.class_id)
     and not private.lp_is_reviewer(p.id) limit 1;
  select sp.id, sp.email into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  select sp.id, sp.email into o from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active and sp.id <> st.id order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;
  update students set class_id = (select id from classes where id <> t.class_id limit 1) where profile_id = o.id;
  insert into hw_assignments(teacher_id, subject_id, class_ids, title, due_at, max_score) values (t.id, t.subject_id, array[t.class_id], 'واجب اختبار', now(), 10) returning id into hid;
  insert into hw_submissions(hw_id, student_id, status, score) values (hid, st.id, 'graded', 5);

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  iid := (public.gb_item_save(jsonb_build_object('class_id', t.class_id, 'subject_id', t.subject_id, 'title', 'مشاركة', 'category', 'participation', 'max_score', 10, 'weight', 2))->>'id')::bigint;
  perform public.gb_scores_save(iid, jsonb_build_array(jsonb_build_object('student', st.id, 'score', 8)));
  begin perform public.gb_scores_save(iid, jsonb_build_array(jsonb_build_object('student', st.id, 'score', 11))); res := res || ' BAD:over'; exception when others then res := res || ' overBlocked'; end;
  begin perform public.gb_scores_save(iid, jsonb_build_array(jsonb_build_object('student', o.id, 'score', 3))); res := res || ' BAD:otherClass'; exception when others then res := res || ' otherClassBlocked'; end;
  r := public.gb_sheet(t.class_id, t.subject_id);
  res := res || ' cols=' || jsonb_array_length(r->'columns') || ' edit=' || (r->>'can_edit') || ' pct=' || coalesce((select x->>'pct' from jsonb_array_elements(r->'students') x where x->>'id' = st.id::text), 'null');
  perform public.gb_item_save(jsonb_build_object('class_id', t.class_id, 'subject_id', t.subject_id, 'kind', 'hw', 'src_id', hid, 'weight', 0));
  r := public.gb_sheet(t.class_id, t.subject_id);
  res := res || ' pctNoHw=' || coalesce((select x->>'pct' from jsonb_array_elements(r->'students') x where x->>'id' = st.id::text), 'null');
  begin perform public.gb_item_save(jsonb_build_object('class_id', t.class_id, 'subject_id', t.subject_id, 'kind', 'hw', 'src_id', 999999999)); res := res || ' BAD:fakeSrc'; exception when others then res := res || ' fakeSrcBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.gb_my(); res := res || ' stuSubjects=' || jsonb_array_length(r) || ' stuPct=' || coalesce((select x->>'pct' from jsonb_array_elements(r) x where (x->>'subject_id')::int = t.subject_id), 'null')
     || ' stuSeesHidden=' || (r::text like '%"weight": 0%')::text;
  begin perform public.gb_sheet(t.class_id, t.subject_id); res := res || ' BAD:stuSheet'; exception when others then res := res || ' stuSheetBlocked'; end;
  begin perform public.gb_scores_save(iid, jsonb_build_array(jsonb_build_object('student', st.id, 'score', 10))); res := res || ' BAD:stuWrite'; exception when others then res := res || ' stuWriteBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t2.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.gb_sheet(t.class_id, t.subject_id); res := res || ' BAD:t2Sheet'; exception when others then res := res || ' t2SheetBlocked'; end;
  begin perform public.gb_item_delete(iid); res := res || ' BAD:t2Del'; exception when others then res := res || ' t2DelBlocked'; end;
  reset role;

  set local role anon;
  begin perform public.gb_my(); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  begin set local role authenticated; perform count(*) from public.gb_scores; res := res || ' BAD:direct'; exception when others then res := res || ' tableBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
