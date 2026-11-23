
do $T$
declare sup text; r jsonb; res text := '';
begin
  res := res || ' norm=' || (public.norm('إبراهيم مصطفى هَمَّام') = public.norm('ابراهيم مصطفي همام'))::text;
  select p.email into sup from supervision_members m join profiles p on p.id = m.profile_id where m.active and p.role = 'supervisor' and p.email is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('email', sup, 'role','authenticated')::text, true); set local role authenticated;
  r := public.sd_list('ابراهيم', null, null, null, null, 5, 0); res := res || ' supSearch=' || (r->>'total');
  r := public.sd_list('إبراهيم', null, null, null, null, 5, 0); res := res || '/' || (r->>'total');
  r := public.sd_list(null, null, null, null, 'noclass', 5, 0); res := res || ' noclass=' || (r->>'total');
  reset role;
  raise exception 'TEST %', res;
exception when others then raise exception 'TEST % || ERR %', res, sqlerrm;
end $T$;
