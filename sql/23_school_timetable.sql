-- =====================================================================
--  الملف 23: «جدول المدرسة الرسمي» الكامل (من ملفات aSc لكل مرحلة)
--  - يُحفظ تحت حساب نظامي غير نشط، فلا يظهر لأي مشرف في مكتب الإشراف، لكنه يدخل في
--    نصاب المعلمين والإسناد وجداولهم — ومنه الحصص التي ليس لمادتها مشرف (بدنية، فنية، قرآن…)
--  - الأسماء المختلفة في الملف تُربط بحساب المعلم الصحيح عبر staff_aliases
-- =====================================================================
create or replace function public.school_tt_import(p jsonb, p_aliases jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare v_owner uuid; k text; v text; r jsonb;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  select id into v_owner from profiles where source = 'system' and full_name = 'جدول المدرسة الرسمي';
  if v_owner is null then
    insert into profiles(full_name, role, job_title, active, source) values ('جدول المدرسة الرسمي', 'staff', 'حساب نظامي', false, 'system')
    returning id into v_owner;
  end if;
  for k, v in select * from jsonb_each_text(coalesce(p_aliases, '{}')) loop
    insert into staff_aliases(alias, profile_id) values (public.norm(k), v::uuid)
    on conflict (alias) do update set profile_id = excluded.profile_id;
  end loop;
  r := private.tt_put(v_owner, p);
  -- الحساب النظامي يبقى غير نشط دائمًا
  update profiles set active = false where id = v_owner;
  return r || jsonb_build_object('owner', v_owner);
end $$;
revoke all on function public.school_tt_import(jsonb, jsonb) from public, anon;
grant execute on function public.school_tt_import(jsonb, jsonb) to authenticated;
