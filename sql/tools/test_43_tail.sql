
-- اختبار 43 (يُلغى كله بالتراجع): معلم له مشرف ← يسجّل تدريبًا ← لا يعتمد نفسه ← مشرفه يعيده ثم يعتمده بدون شهادة ← يصدرها لاحقًا ← المعلم يرى الشهادة ← التحقق العام
do $T$
declare t record; sv record; x record; tid bigint; r jsonb; res text := ''; cno text;
begin
  select v.teacher_id, tp.email temail, v.supervisor_id, sp.email semail into t
    from v_teacher_supervisors v join profiles tp on tp.id = v.teacher_id join profiles sp on sp.id = v.supervisor_id
   where v.supervisor_id <> v.teacher_id and tp.active and sp.active and tp.email is not null and sp.email is not null limit 1;
  -- موظف آخر ليس مشرف هذا المعلم ولا مديرًا
  select p.id, p.email into x from profiles p where p.active and p.email is not null and p.role = 'teacher' and p.id <> t.teacher_id limit 1;
  res := res || ' found=' || (t.teacher_id is not null)::text;

  perform set_config('request.jwt.claims', json_build_object('email', t.temail, 'role','authenticated')::text, true); set local role authenticated;
  tid := (public.trn_save(jsonb_build_object('title', 'دورة اختبار', 'provider', 'جهة', 'presenter', 'د. مقدم', 'hours', 6, 'start_date', current_date::text))->>'id')::bigint;
  r := public.trn_list(t.teacher_id, null, null);
  res := res || ' st=' || (select z->>'status' from jsonb_array_elements(r->'rows') z where (z->>'id')::bigint = tid)
             || ' selfCan=' || (select z->>'can_review' from jsonb_array_elements(r->'rows') z where (z->>'id')::bigint = tid);
  begin perform public.trn_review(tid, 'approve', null, true); res := res || ' BAD:self'; exception when others then res := res || ' selfBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', x.email, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.trn_review(tid, 'approve', null, false); res := res || ' BAD:other'; exception when others then res := res || ' otherBlocked'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t.semail, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.trn_review(tid, 'return', '', false); res := res || ' BAD:noNote'; exception when others then res := res || ' noteReq'; end;
  perform public.trn_review(tid, 'return', 'أرفق الشهادة', false);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t.temail, 'role','authenticated')::text, true); set local role authenticated;
  perform public.trn_save(jsonb_build_object('id', tid, 'title', 'دورة اختبار', 'provider', 'جهة', 'presenter', 'د. مقدم', 'hours', 6, 'start_date', current_date::text));
  reset role;
  res := res || ' afterEdit=' || (select status from trainings where id = tid);

  perform set_config('request.jwt.claims', json_build_object('email', t.semail, 'role','authenticated')::text, true); set local role authenticated;
  r := public.trn_review(tid, 'approve', null, false); res := res || ' approvedNoCert=' || coalesce(r->>'cert_no', 'null');
  begin perform public.trn_cert(tid); res := res || ' BAD:certBeforeIssue'; exception when others then res := res || ' noCertYet'; end;
  r := public.trn_cert_issue(tid); res := res || ' issued=' || (r->>'cert_no');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', t.temail, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.trn_save(jsonb_build_object('id', tid, 'title', 'تعديل', 'hours', 9)); res := res || ' BAD:editApproved'; exception when others then res := res || ' editLocked'; end;
  begin perform public.trn_delete(tid); res := res || ' BAD:delApproved'; exception when others then res := res || ' delLocked'; end;
  r := public.trn_cert(tid); res := res || ' cert=' || (r->>'name' is not null)::text || '/' || (r->>'presenter') || '/' || (r->>'edu_title') || '/' || (r->>'exec_title');
  reset role;

  cno := (select cert_no from trainings where id = tid);
  set local role anon;
  r := public.trn_verify(cno); res := res || ' verify=' || (r->>'valid');
  r := public.trn_verify('DTH-0000-99999'); res := res || ' fake=' || (r->>'valid');
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
