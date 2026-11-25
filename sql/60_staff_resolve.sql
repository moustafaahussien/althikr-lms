-- 60: ربط أسماء المنسوبين في منصة الموهبة (قد تكون ثنائية أو مختصرة) بحساباتهم في المنصة
--   الترتيب: الاسم الكامل ← الأسماء البديلة (staff_aliases من جداول الحصص) ← الأول+العائلة إن تفرّد ← بداية الاسم (3 أسماء فأكثر) إن تفرّدت
create or replace function public.staff_resolve(p_names text[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare n text; k text; w text[]; pid uuid; out jsonb := '{}'::jsonb; c int;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  foreach n in array coalesce(p_names, '{}') loop
    k := public.norm(btrim(regexp_replace(coalesce(n, ''), '\s+', ' ', 'g'))); pid := null;
    if k = '' then continue; end if;
    w := regexp_split_to_array(k, ' ');
    select p.id into pid from profiles p where p.active and p.role not in ('student','parent') and public.norm(p.full_name) = k limit 1;
    if pid is null then select a.profile_id into pid from staff_aliases a join profiles p on p.id = a.profile_id and p.active where a.alias = k limit 1; end if;
    if pid is null and array_length(w, 1) = 2 then
      select count(*), min(p.id::text)::uuid into c, pid from profiles p
       where p.active and p.role not in ('student','parent') and split_part(public.norm(p.full_name), ' ', 1) = w[1]
         and (regexp_split_to_array(public.norm(p.full_name), ' '))[array_length(regexp_split_to_array(public.norm(p.full_name), ' '), 1)] = w[2];
      if c <> 1 then pid := null; end if;
    end if;
    if pid is null and array_length(w, 1) >= 3 then
      select count(*), min(p.id::text)::uuid into c, pid from profiles p
       where p.active and p.role not in ('student','parent') and (public.norm(p.full_name) || ' ') like k || ' %';
      if c <> 1 then pid := null; end if;
    end if;
    if pid is not null then out := out || jsonb_build_object(n, pid); end if;
  end loop;
  return out;
end $$;
revoke all on function public.staff_resolve(text[]) from public, anon;
grant execute on function public.staff_resolve(text[]) to authenticated;
