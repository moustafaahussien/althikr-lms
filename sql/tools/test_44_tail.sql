
-- اختبار 44 (يُلغى بالتراجع)
do $T$
declare adm text; tch text; prn text; sid uuid; r jsonb; res text := ''; mid uuid; mname text; pg int; ns int;
begin
  select email into adm from profiles where role = 'admin' and active and email is not null limit 1;
  select email into tch from profiles where role = 'teacher' and active and email is not null limit 1;
  select p.email into prn from profiles p where p.role = 'principal' and p.active and p.email is not null
     and exists (select 1 from staff_scopes sc where sc.profile_id = p.id and sc.stage_id is not null) limit 1;
  -- طالب متوسط (فصوله أرقام) بدون فصل
  select s.profile_id, p.full_name into mid, mname from students s join profiles p on p.id = s.profile_id join grades g on g.id = s.grade_id
   where g.stage_id = 2 and p.active limit 1;

  perform set_config('request.jwt.claims', json_build_object('email', adm, 'role','authenticated')::text, true); set local role authenticated;
  r := public.sd_list(null, null, null, null, null, 5, 0); res := res || ' adminTotal=' || (r->>'total') || ' rows=' || jsonb_array_length(r->'rows');
  sid := ((r->'rows'->0)->>'id')::uuid;
  r := public.sd_get(sid); res := res || ' get=' || (r->'info'->>'name' is not null)::text || ' att=' || (r->'attendance'->>'days_taken');
  r := public.sd_list('الحربي', null, null, null, null, 5, 0); res := res || ' search=' || (r->>'total');
  r := public.sd_list(null, null, null, null, 'noclass', 5, 0); res := res || ' noclass=' || (r->>'total');
  r := public.sd_list(null, null, null, null, 'absent', 5, 0); res := res || ' absent=' || (r->>'total');
  -- التوزيع: الفصل «1» في المتوسط لا يُنشئ «أ»
  select count(*) into ns from classes;
  r := public.import_student_classes(jsonb_build_array(jsonb_build_object('full_name', mname, 'class', '1')), false);
  res := res || ' imp=' || (r->>'updated') || '/' || (r->>'classes_created') || ' cls=' || (select c.name from students s join classes c on c.id = s.class_id where s.profile_id = mid);
  reset role;

  perform set_config('request.jwt.claims', json_build_object('email', tch, 'role','authenticated')::text, true); set local role authenticated;
  begin perform public.sd_list(null, null, null, null, null, 5, 0); res := res || ' BAD:teacher'; exception when others then res := res || ' teacherBlocked'; end;
  begin perform public.sd_get(sid); res := res || ' BAD:teacherGet'; exception when others then res := res || ' teacherGetBlocked'; end;
  reset role;

  if prn is not null then
    perform set_config('request.jwt.claims', json_build_object('email', prn, 'role','authenticated')::text, true); set local role authenticated;
    r := public.sd_list(null, null, null, null, null, 5, 0); res := res || ' principalTotal=' || (r->>'total') || ' stages=' || jsonb_array_length(r->'filters'->'stages');
    reset role;
  end if;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
