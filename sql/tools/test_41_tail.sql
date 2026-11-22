
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; t2 record; sup record; ld record; st record; r jsonb; q1 bigint; q2 bigint; eid bigint; hid bigint; lid bigint; lpid bigint; ans text := ''; qq jsonb; x jsonb; res text := '';
begin
  select ts.teacher_id id, p.email, ta.class_id, ta.subject_id, ts.supervisor_id into t from v_teacher_supervisors ts join profiles p on p.id = ts.teacher_id
    join teaching_assignments ta on ta.teacher_id = ts.teacher_id where p.email is not null and p.active and ts.supervisor_id <> ts.teacher_id limit 1;
  select id, email into sup from profiles where id = t.supervisor_id;
  select id, email into ld from profiles where role = 'leadership' and email is not null and active limit 1;
  select p.id, p.email into t2 from profiles p where p.role = 'teacher' and p.email is not null and p.active and p.id <> t.id
     and exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id) limit 1;
  select sp.id, sp.email into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  hid := (public.hw_save(jsonb_build_object('title', 'واجب ف1', 'subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'due_at', (now() + interval '1 day')::text, 'period', 'p1'))->>'id')::bigint;
  begin perform public.hw_save(jsonb_build_object('title', 'x', 'subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'due_at', now()::text, 'period', 'zz')); res := res || ' BAD:period'; exception when others then res := res || ' badPeriodBlocked'; end;
  q1 := (public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'match', 'body', 'زاوج', 'points', 4, 'image', 'data:image/png;base64,iVBORw0KGgo=',
          'pairs', jsonb_build_array(jsonb_build_object('l','مصر','r','القاهرة'), jsonb_build_object('l','السعودية','r','الرياض'), jsonb_build_object('l','الأردن','r','عمّان'))))->>'id')::bigint;
  begin perform public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'mcq', 'body', 'x', 'image', 'javascript:alert(1)', 'options', jsonb_build_array(jsonb_build_object('t','a','ok',true), jsonb_build_object('t','b')))); res := res || ' BAD:img'; exception when others then res := res || ' badImgBlocked'; end;
  q2 := (public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'tf', 'body', 'صح؟', 'tf', true))->>'id')::bigint;
  eid := (public.ex_save(jsonb_build_object('subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'title', 'اختبار مزاوجة', 'period', 'mid',
          'opens_at', (now() - interval '1 minute')::text, 'closes_at', (now() + interval '1 hour')::text, 'questions', jsonb_build_array(jsonb_build_object('id', q1), jsonb_build_object('id', q2))))->>'id')::bigint;
  perform public.hw_grade(hid, st.id, 'grade', 8, 'جيد');
  r := public.gb_sheet(t.class_id, t.subject_id);
  res := res || ' gbPeriods=' || (select string_agg(c->>'period', ',' order by c->>'key') from jsonb_array_elements(r->'columns') c where c->>'key' in ('hw' || hid, 'ex' || eid));
  perform public.lib_share('exam', eid, 'للتجربة');
  begin perform public.lib_share('hw', (select id from hw_assignments where teacher_id <> t.id limit 1), null); res := res || ' BAD:shareOthers'; exception when others then res := res || ' shareOthersBlocked'; end;
  lpid := (public.lp_save(jsonb_build_object('title', 'درس', 'date', current_date::text, 'subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id)))->>'id')::bigint;
  perform public.lp_submit(lpid);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.ex_start(eid);
  res := res || ' leak=' || (r::text like '%"ok"%' or r::text like '%"l": "مصر", "r"%')::text;
  for qq in select * from jsonb_array_elements(r->'questions') loop
    if qq->>'qtype' = 'match' then
      res := res || ' img=' || ((qq->>'image') is not null)::text;
      select string_agg((l->>'k') || ':' || (select o->>'i' from jsonb_array_elements(qq->'options') o where o->>'t' = case l->>'t' when 'مصر' then 'القاهرة' when 'السعودية' then 'الرياض' else 'عمّان' end), ',') into ans
        from jsonb_array_elements(qq->'left') l;
      x := coalesce(x, '{}'::jsonb) || jsonb_build_object(qq->>'id', ans);
    else x := coalesce(x, '{}'::jsonb) || jsonb_build_object(qq->>'id', '0'); end if;
  end loop;
  r := public.ex_submit(eid, x, true); res := res || ' score=' || (r->>'score') || '/' || (r->>'max');
  r := public.pf_get(null); res := res || ' pfExams=' || jsonb_array_length(r->'exams') || ' pfHw=' || jsonb_array_length(r->'homework');
  begin perform public.lib_list(null, null, null); res := res || ' BAD:stuLib'; exception when others then res := res || ' stuLibBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', ld.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.lp_options(); res := res || ' ldCanReview=' || (r->>'can_review') || ' ldFollow=' || (r->>'can_follow');
  begin perform public.lp_review(lpid, 'approve', null); res := res || ' BAD:leaderApproved'; exception when others then res := res || ' leaderApproveBlocked'; end;
  res := res || ' ldSees=' || exists (select 1 from jsonb_array_elements(public.lp_list('all', null, null, null, null)) z where (z->>'id')::bigint = lpid)::text;
  r := public.cls_overview(); res := res || ' cls=' || (jsonb_array_length(r) > 0)::text || ' clsStu=' || jsonb_array_length(public.cls_students(t.class_id)->'students');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', sup.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' supQueue=' || exists (select 1 from jsonb_array_elements(public.lp_list('review', null, null, null, null)) z where (z->>'id')::bigint = lpid)::text;
  perform public.lp_review(lpid, 'approve', 'ممتاز'); res := res || ' supApproved';
  res := res || ' comp=' || coalesce((select z->>'lp_ok' from jsonb_array_elements(public.an_compliance(null, null)) z where z->>'id' = t.id::text), 'null');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t2.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.lib_list('exam', null, null); select (z->>'id')::bigint into lid from jsonb_array_elements(r) z where z->>'title' = 'اختبار مزاوجة';
  res := res || ' t2SeesLib=' || (lid is not null)::text;
  r := public.lib_use(lid, (select subject_id from teaching_assignments where teacher_id = t2.id limit 1)); res := res || ' imported=' || (r->>'imported');
  begin perform public.lib_unshare(lid); res := res || ' BAD:t2Unshare'; exception when others then res := res || ' t2UnshareBlocked'; end;
  reset role;

  set local role anon;
  begin perform public.lib_list(null, null, null); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
