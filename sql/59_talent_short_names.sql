-- 59: مطابقة الأسماء الثنائية في منصة الموهبة (الاسم الأول + اسم العائلة) فقط إن لم يشترك فيها طالب آخر
create or replace function public.talent_student_ref(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare nm text; w text[]; dup int;
begin
  if not public.is_staff() or not (private.sd_can(p_student) or private.bh_can(p_student)) then return jsonb_build_object('ok', false); end if;
  select full_name into nm from profiles where id = p_student;
  w := regexp_split_to_array(public.norm(btrim(nm)), '\s+');
  select count(*) into dup from students s join profiles p on p.id = s.profile_id and p.active
   where s.profile_id <> p_student
     and split_part(public.norm(btrim(p.full_name)), ' ', 1) = w[1]
     and (regexp_split_to_array(public.norm(btrim(p.full_name)), '\s+'))[array_length(regexp_split_to_array(public.norm(btrim(p.full_name)), '\s+'), 1)] = w[array_length(w, 1)];
  return jsonb_build_object('ok', true, 'name', nm, 'short_unique', dup = 0 and array_length(w, 1) >= 3);
end $$;
revoke all on function public.talent_student_ref(uuid) from public, anon;
grant execute on function public.talent_student_ref(uuid) to authenticated;
