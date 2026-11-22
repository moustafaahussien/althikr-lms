
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; st record; o record; r jsonb; i1 bigint; i2 bigint; res text := '';
begin
  select p.id, p.email, ta.class_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id where p.role = 'teacher' and p.email is not null and p.active limit 1;
  select sp.id, sp.email, sp.full_name into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  select sp.id, sp.email into o from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active and sp.id <> st.id order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;
  update students set class_id = (select c.id from classes c where c.id <> t.class_id and not exists (select 1 from teaching_assignments ta where ta.teacher_id = t.id and ta.class_id = c.id)
                                     and (select grade_id from classes where id = t.class_id) <> c.grade_id limit 1) where profile_id = o.id;

  -- الطالب يضيف إنجازه → بانتظار الاعتماد
  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  i1 := (public.pf_save(jsonb_build_object('kind', 'competition', 'title', 'أولمبياد الرياضيات', 'level', 'national', 'result', 'ميدالية فضية',
          'links', jsonb_build_array(jsonb_build_object('url', 'https://example.com/cert'), jsonb_build_object('url', 'javascript:alert(1)'))))->>'id')::bigint;
  r := public.pf_get(null); res := res || ' stuItems=' || jsonb_array_length(r->'items') || ' status=' || (r->'items'->0->>'status') || ' links=' || jsonb_array_length(r->'items'->0->'links');
  begin perform public.pf_save(jsonb_build_object('student_id', o.id, 'kind', 'award', 'title', 'x')); res := res || ' BAD:stuForOther'; exception when others then res := res || ' stuForOtherBlocked'; end;
  begin perform public.pf_get(o.id); res := res || ' BAD:stuViewOther'; exception when others then res := res || ' stuViewOtherBlocked'; end;
  begin perform public.pf_review(i1, 'approve'); res := res || ' BAD:selfApprove'; exception when others then res := res || ' selfApproveBlocked'; end;
  begin perform public.pf_feed(); res := res || ' BAD:stuFeed'; exception when others then res := res || ' stuFeedBlocked'; end;
  reset role;

  -- المعلم يعتمد ويضيف
  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' pending=' || jsonb_array_length(public.pf_feed('pending'));
  res := res || ' find=' || jsonb_array_length(public.pf_find(st.full_name));
  begin perform public.pf_review(i1, 'reject', ''); res := res || ' BAD:rejectNoNote'; exception when others then res := res || ' rejectNeedsNote'; end;
  perform public.pf_review(i1, 'approve');
  i2 := (public.pf_save(jsonb_build_object('student_id', st.id, 'kind', 'project', 'title', 'مشروع روبوت'))->>'id')::bigint;
  r := public.pf_get(st.id); res := res || ' tItems=' || jsonb_array_length(r->'items') || ' allApproved=' || (not exists (select 1 from jsonb_array_elements(r->'items') x where x->>'status' <> 'approved'))::text;
  begin perform public.pf_get(o.id); res := res || ' BAD:tViewUnrelated'; exception when others then res := res || ' tUnrelatedBlocked'; end;
  reset role;

  -- الطالب لا يعدّل/يحذف المعتمد
  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.pf_save(jsonb_build_object('id', i1, 'kind', 'competition', 'title', 'تعديل')); res := res || ' BAD:editApproved'; exception when others then res := res || ' editApprovedBlocked'; end;
  begin perform public.pf_delete(i2); res := res || ' BAD:delApproved'; exception when others then res := res || ' delApprovedBlocked'; end;
  reset role;

  set local role anon;
  begin perform public.pf_get(st.id); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  begin set local role authenticated; perform count(*) from public.pf_items; res := res || ' BAD:direct'; exception when others then res := res || ' tableBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
