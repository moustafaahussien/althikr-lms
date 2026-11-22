
insert into app_settings(key, value) values ('student_login_enabled', 'true'::jsonb) on conflict (key) do update set value = 'true'::jsonb;
do $T$
declare t record; st record; o record; r jsonb; q1 bigint; q2 bigint; q3 bigint; eid bigint; att bigint; ans jsonb := '{}'::jsonb; okI text; res text := ''; qq jsonb;
begin
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id where p.role = 'teacher' and p.email is not null limit 1;
  select sp.id, sp.email into st from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active order by sp.email limit 1;
  select sp.id, sp.email into o from students s join profiles sp on sp.id = s.profile_id where sp.email is not null and sp.active and sp.id <> st.id order by sp.email limit 1;
  update students set class_id = t.class_id where profile_id = st.id;
  update students set class_id = (select id from classes where id <> t.class_id limit 1) where profile_id = o.id;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  q1 := (public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'mcq', 'body', '2+2؟', 'points', 2,
          'options', jsonb_build_array(jsonb_build_object('t','3'), jsonb_build_object('t','4','ok',true), jsonb_build_object('t','5'))))->>'id')::bigint;
  q2 := (public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'tf', 'body', 'الأرض كروية', 'tf', true))->>'id')::bigint;
  q3 := (public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'short', 'body', 'عاصمة السعودية؟', 'answer', 'الرياض', 'points', 3))->>'id')::bigint;
  begin perform public.qb_save(jsonb_build_object('subject_id', t.subject_id, 'qtype', 'mcq', 'body', 'x', 'options', jsonb_build_array(jsonb_build_object('t','a','ok',true), jsonb_build_object('t','b','ok',true)))); res := res || ' BAD:two-correct'; exception when others then res := res || ' twoCorrectBlocked'; end;
  eid := (public.ex_save(jsonb_build_object('subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id), 'title', 'اختبار تجريبي',
          'opens_at', (now() - interval '1 minute')::text, 'closes_at', (now() + interval '1 hour')::text, 'duration_min', 20,
          'questions', jsonb_build_array(jsonb_build_object('id', q1), jsonb_build_object('id', q2), jsonb_build_object('id', q3))))->>'id')::bigint;
  res := res || ' bank=' || jsonb_array_length(public.qb_list(t.subject_id));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', st.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' stuList=' || jsonb_array_length(public.ex_list('student'));
  begin perform public.ex_get(eid); res := res || ' BAD:student-ex_get'; exception when others then res := res || ' exGetBlocked'; end;
  begin perform public.qb_list(t.subject_id); res := res || ' BAD:student-bank'; exception when others then res := res || ' bankBlocked'; end;
  r := public.ex_start(eid);
  res := res || ' leak=' || (r::text like '%"ok"%' or r::text like '%الرياض%')::text || ' nQ=' || jsonb_array_length(r->'questions');
  -- أجب: mcq صحيح، tf خطأ، قصيرة نص آخر (تحتاج تصحيح يدوي)
  for qq in select * from jsonb_array_elements(r->'questions') loop
    if qq->>'qtype' = 'mcq' then ans := ans || jsonb_build_object(qq->>'id', (select x->>'i' from jsonb_array_elements(qq->'options') x where x->>'t' = '4'));
    elsif qq->>'qtype' = 'tf' then ans := ans || jsonb_build_object(qq->>'id', '1');
    else ans := ans || jsonb_build_object(qq->>'id', 'مدينة الرياض'); end if;
  end loop;
  perform public.ex_submit(eid, ans, false);
  r := public.ex_submit(eid, ans, true); res := res || ' score=' || (r->>'score') || '/' || (r->>'max') || ' review=' || (r->>'needs_review');
  begin perform public.ex_submit(eid, ans, true); res := res || ' BAD:resubmit'; exception when others then res := res || ' resubmitBlocked'; end;
  r := public.ex_my_result(eid); res := res || ' correctHidden=' || ((r->'questions'->0->>'correct') is null)::text;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', o.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.ex_start(eid); res := res || ' BAD:other-class-start'; exception when others then res := res || ' otherStartBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.ex_get(eid);
  select (x->>'id')::bigint into att from jsonb_array_elements(r->'attempts') x where x->>'student' = st.id::text;
  perform public.ex_grade(att, q3::text, 3);
  r := public.ex_list('mine'); res := res || ' afterManual avg=' || (r->0->>'avg') || ' review=' || (r->0->>'review');
  begin perform public.ex_grade(att, q3::text, 9); res := res || ' BAD:over'; exception when others then res := res || ' overBlocked'; end;
  begin perform public.ex_delete(eid); res := res || ' BAD:delete-with-attempts'; exception when others then res := res || ' deleteLocked'; end;
  reset role;

  set local role anon;
  begin perform public.ex_list('mine'); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  begin set local role authenticated; perform count(*) from public.ex_attempts; res := res || ' BAD:direct'; exception when others then res := res || ' tableBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
