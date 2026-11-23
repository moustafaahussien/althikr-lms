
do $T$
declare sup text; tch text; r jsonb; b uuid; res text := ''; no1 text;
begin
  select p.email into sup from supervision_members m join profiles p on p.id = m.profile_id where m.active and p.role = 'supervisor' and p.email is not null limit 1;
  select p.email into tch from profiles p where p.role = 'teacher' and p.active and p.email is not null
     and not exists (select 1 from supervision_members m where m.profile_id = p.id and m.active) limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', sup, 'role','authenticated')::text, true); set local role authenticated;
  r := public.cert_defaults(); res := res || ' def=' || (r->>'school') || '/' || jsonb_array_length(r->'sigs');
  r := public.cert_staff('محمد'); res := res || ' staff=' || jsonb_array_length(r);
  r := public.cert_issue(jsonb_build_object('kind','thanks','title','شهادة شكر وتقدير','items', jsonb_build_array(
        jsonb_build_object('name','أحمد اختبار','rtype','staff','data', jsonb_build_object('body','نص')),
        jsonb_build_object('name','  ','data','{}'::jsonb),
        jsonb_build_object('name','سارة اختبار','rtype','student'))));
  res := res || ' issued=' || (r->>'count'); b := (r->>'batch')::uuid; no1 := r->'numbers'->>0;
  r := public.cert_batches(10); res := res || ' batches=' || (jsonb_array_length(r) > 0)::text;
  r := public.cert_batch(b); res := res || ' batch=' || jsonb_array_length(r) || ' no=' || no1;
  begin perform public.cert_issue(jsonb_build_object('title','','items','[]'::jsonb)); res := res || ' BAD:empty'; exception when others then res := res || ' emptyBlocked'; end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('email', tch, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.cert_defaults(); res := res || ' BAD:teacher'; exception when others then res := res || ' teacherBlocked'; end;
  begin perform public.cert_batch(b); res := res || ' BAD:teacherBatch'; exception when others then res := res || ' teacherBatchBlocked'; end;
  reset role;
  set local role anon;
  r := public.cert_verify(no1); res := res || ' verify=' || (r->>'valid') || '/' || (r->>'name');
  r := public.cert_verify('DTC-0000-00000'); res := res || ' fake=' || (r->>'valid');
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
