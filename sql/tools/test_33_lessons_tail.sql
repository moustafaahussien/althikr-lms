
do $T$
declare t record; s record; o record; r jsonb; pid bigint; res text := ''; ok boolean;
begin
  -- معلم له إسناد ومشرف من الجدول
  select p.id, p.email, ta.class_id, ta.subject_id into t from profiles p join teaching_assignments ta on ta.teacher_id = p.id
   where p.role = 'teacher' and p.email is not null and exists (select 1 from v_teacher_supervisors v where v.teacher_id = p.id) limit 1;
  select p.id, p.email into s from v_teacher_supervisors v join profiles p on p.id = v.supervisor_id where v.teacher_id = t.id limit 1;
  select p.id, p.email into o from profiles p where p.role = 'teacher' and p.id <> t.id and p.email is not null
     and not exists (select 1 from v_teacher_supervisors v where v.supervisor_id = p.id) limit 1;

  perform set_config('request.jwt.claims', json_build_object('email', t.email, 'role','authenticated')::text, true); set local role authenticated;
  r := public.lp_options(); res := res || ' opts=' || jsonb_array_length(r->'classes');
  r := public.lp_save(jsonb_build_object('title','درس تجريبي','date','2026-11-30','subject_id',t.subject_id,'class_ids',jsonb_build_array(t.class_id),'content',jsonb_build_object('objectives','هدف')));
  pid := (r->>'id')::bigint;
  begin perform public.lp_save(jsonb_build_object('title','x','date','2026-11-30','class_ids',jsonb_build_array(-5))); res := res || ' BAD:foreign-class-allowed'; exception when others then res := res || ' foreignClassBlocked'; end;
  perform public.lp_submit(pid);
  begin perform public.lp_save(jsonb_build_object('id',pid,'title','y','date','2026-11-30')); res := res || ' BAD:edit-after-submit'; exception when others then res := res || ' editLocked'; end;
  begin perform public.lp_review(pid,'approve',null); res := res || ' BAD:self-approve'; exception when others then res := res || ' selfApproveBlocked'; end;
  res := res || ' mine=' || jsonb_array_length(public.lp_list('mine'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', o.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.lp_get(pid); res := res || ' BAD:other-teacher-reads'; exception when others then res := res || ' otherBlocked'; end;
  res := res || ' otherReview=' || jsonb_array_length(public.lp_list('review'));
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', s.email, 'role','authenticated')::text, true); set local role authenticated;
  res := res || ' supReview=' || jsonb_array_length(public.lp_list('review'));
  r := public.lp_get(pid); res := res || ' canReview=' || (r->>'can_review');
  begin perform public.lp_review(pid,'return',''); res := res || ' BAD:return-no-note'; exception when others then res := res || ' noteRequired'; end;
  perform public.lp_review(pid,'approve','ممتاز');
  r := public.lp_get(pid); res := res || ' status=' || (r->>'status');
  begin perform public.lp_save(jsonb_build_object('id',pid,'title','z','date','2026-11-30')); res := res || ' BAD:sup-edits'; exception when others then res := res || ' supEditBlocked'; end;
  reset role;

  set local role anon;
  begin perform public.lp_list('mine'); res := res || ' BAD:anon'; exception when others then res := res || ' anonBlocked'; end;
  reset role;
  begin set local role authenticated; perform count(*) from public.lesson_plans; res := res || ' BAD:direct-table'; exception when others then res := res || ' tableBlocked'; end;
  reset role;
  raise exception 'TEST %', res;
end $T$;
