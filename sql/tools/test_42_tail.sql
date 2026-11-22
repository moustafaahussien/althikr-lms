
do $T$
declare t record; ts2 record; pr record; l1 bigint; l2 bigint; r jsonb; res text := '';
begin
  -- معلم بلا مشرف ومدير مرحلته
  select p.id, p.email, ta.class_id, ta.subject_id, g.stage_id into t
    from profiles p join teaching_assignments ta on ta.teacher_id = p.id join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
   where p.active and p.email is not null and p.role = 'teacher'
     and exists (select 1 from staff_scopes sc join profiles pp on pp.id = sc.profile_id where pp.role = 'principal' and pp.active and sc.stage_id = g.stage_id) limit 1;
  -- محاكاة معلم بلا مشرف: حذف حصصه من الجداول داخل المعاملة (تُلغى مع التراجع)
  delete from tt_slots where teacher_id = t.id;
  select pp.id, pp.email into pr from staff_scopes sc join profiles pp on pp.id = sc.profile_id where pp.role = 'principal' and pp.active and pp.email is not null and sc.stage_id = t.stage_id limit 1;
  -- معلم له مشرف في نفس المرحلة
  select p.id, p.email, ta.class_id, ta.subject_id into ts2 from v_teacher_supervisors v join profiles p on p.id = v.teacher_id join teaching_assignments ta on ta.teacher_id = p.id
    join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id where v.supervisor_id <> v.teacher_id and p.active and p.email is not null and g.stage_id = t.stage_id and p.id <> t.id limit 1;
  res := res || ' found=' || (t.id is not null)::text || '/' || (pr.id is not null)::text || '/' || (ts2.id is not null)::text;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  l1 := (public.lp_save(jsonb_build_object('title', 'درس بلا مشرف', 'date', current_date::text, 'subject_id', t.subject_id, 'class_ids', jsonb_build_array(t.class_id)))->>'id')::bigint; perform public.lp_submit(l1);
  reset role;
  if ts2.id is not null then
    perform set_config('request.jwt.claims', json_build_object('email', ts2.email, 'role','authenticated')::text, true); set local role authenticated;
    l2 := (public.lp_save(jsonb_build_object('title', 'درس له مشرف', 'date', current_date::text, 'subject_id', ts2.subject_id, 'class_ids', jsonb_build_array(ts2.class_id)))->>'id')::bigint; perform public.lp_submit(l2);
    reset role;
  end if;

  perform set_config('request.jwt.claims', json_build_object('email', pr.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.lp_options(); res := res || ' prCanReview=' || (r->>'can_review');
  r := public.lp_list('review', null, null, null, null);
  res := res || ' queueHasNoSup=' || exists (select 1 from jsonb_array_elements(r) z where (z->>'id')::bigint = l1)::text
             || ' queueHasSup=' || exists (select 1 from jsonb_array_elements(r) z where (z->>'id')::bigint = l2)::text;
  res := res || ' getCanReview=' || (public.lp_get(l1)->>'can_review');
  perform public.lp_review(l1, 'approve', 'معتمد من المدير'); res := res || ' prApprovedNoSup';
  if l2 is not null then begin perform public.lp_review(l2, 'approve', null); res := res || ' BAD:prApprovedSup'; exception when others then res := res || ' prSupBlocked'; end; end if;
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
