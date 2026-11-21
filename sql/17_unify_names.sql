-- =====================================================================
--  الملف 17: توحيد أسماء الموظفين في المنصة كلها على الاسم الرسمي من دليل الموظفين (ZenHR)
--  - الاسم القديم يُحفظ اسمًا بديلًا (staff_aliases) فتبقى جداول الحصص مربوطة بنفس الحساب
--  - سجلات مكتب الإشراف (التقييمات، الجلسات، التذكيرات، المفاتيح) تُحدَّث للاسم الجديد
--  - لا يُغيَّر الاسم إذا كان الاسم الحالي بالعربي أكمل منه (يحتوي كل كلماته)، أو إذا تعارض مع اسم موظف آخر
--  الاستخدام:  select public.staff_unify_names(false);  -- معاينة
--              select public.staff_unify_names(true);   -- تنفيذ
-- =====================================================================

create or replace function public.staff_unify_names(p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; n_ren int := 0; n_sv int := 0; d jsonb; t text; before text; v_stamp bigint := (extract(epoch from now()) * 1000)::bigint;
  out jsonb := '[]'::jsonb; kept jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;

  create temp table _ren (pid uuid primary key, old text, new text) on commit drop;
  insert into _ren(pid, old, new)
  select p.id, p.full_name, regexp_replace(btrim(s.name_ar), '\s+', ' ', 'g')
  from staff_directory s join profiles p on p.id = s.profile_id
  where public.norm(p.full_name) is distinct from public.norm(s.name_ar)
    and btrim(coalesce(s.name_ar, '')) <> '';

  -- الاسم الحالي بالعربي وأكمل من اسم الدليل (يحتوي كل كلماته): يبقى كما هو
  select coalesce(jsonb_agg(jsonb_build_object('old', old, 'new', new)), '[]') into kept from _ren
   where old ~ '[ء-ي]' and (select bool_and(position(w in public.norm(old)) > 0)
                            from unnest(string_to_array(public.norm(new), ' ')) w);
  delete from _ren where old ~ '[ء-ي]' and (select bool_and(position(w in public.norm(old)) > 0)
                                             from unnest(string_to_array(public.norm(new), ' ')) w);
  -- تعارض: الاسم الجديد مستخدم لموظف آخر، أو مكرر بين أكثر من موظف
  select kept || coalesce(jsonb_agg(jsonb_build_object('old', old, 'new', new, 'why', 'تعارض')), '[]') into kept from _ren x
   where exists (select 1 from profiles q where q.id <> x.pid and q.role not in ('student','parent') and public.norm(q.full_name) = public.norm(x.new))
      or (select count(*) from _ren y where public.norm(y.new) = public.norm(x.new)) > 1;
  delete from _ren x
   where exists (select 1 from profiles q where q.id <> x.pid and q.role not in ('student','parent') and public.norm(q.full_name) = public.norm(x.new))
      or (select count(*) from _ren y where public.norm(y.new) = public.norm(x.new)) > 1;

  select count(*), coalesce(jsonb_agg(jsonb_build_object('old', old, 'new', new) order by new), '[]') into n_ren, out from _ren;

  if p_apply then
    -- 1) الاسم القديم يبقى اسمًا بديلًا لنفس الحساب (جداول الحصص تبقى مربوطة)
    insert into staff_aliases(alias, profile_id) select public.norm(old), pid from _ren where public.norm(old) is not null
    on conflict (alias) do nothing;
    insert into staff_aliases(alias, profile_id) select public.norm(new), pid from _ren on conflict (alias) do nothing;
    -- 2) الاسم الجديد في المنصة كلها
    update profiles p set full_name = x.new from _ren x where p.id = x.pid;
    -- 3) سجلات مكتب الإشراف: الاسم كقيمة كاملة أو جزء من مفتاح (… | الاسم | …)
    for r in select profile_id, data from supervision_data loop
      t := r.data::text; before := t;
      for d in select jsonb_build_object('o', old, 'n', new) from _ren order by length(old) desc loop
        t := replace(t, '"' || (d->>'o') || '"', '"' || (d->>'n') || '"');
        t := replace(t, '"' || (d->>'o') || '|', '"' || (d->>'n') || '|');
        t := replace(t, '|' || (d->>'o') || '|', '|' || (d->>'n') || '|');
        t := replace(t, '|' || (d->>'o') || '"', '|' || (d->>'n') || '"');
      end loop;
      if t <> before then
        update supervision_data set data = t::jsonb, stamp = v_stamp, updated_at = now() where profile_id = r.profile_id;
        n_sv := n_sv + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object('applied', p_apply, 'renamed', n_ren, 'supervision_updated', n_sv, 'list', out, 'kept', kept);
end $$;
revoke all on function public.staff_unify_names(boolean) from public, anon;
grant execute on function public.staff_unify_names(boolean) to authenticated;

-- الدليل يعرض اسم الحساب (بعد التوحيد هو نفس الاسم الرسمي، أو الاسم الأكمل إن وُجد)
create or replace function public.staff_dir_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'دليل الموظفين متاح للموظفين فقط'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'zid', d.zid, 'no', d.emp_no,
      'name', coalesce(case when p.full_name ~ '[ء-ي]' then p.full_name end, d.name_ar), 'en', d.name_en,
      'title', coalesce(nullif(btrim(p.job_title),''), d.title_hr),
      'grp', d.grp, 'manager', d.manager,
      'email', coalesce(p.email, d.email), 'mobile', d.mobile, 'work', d.work_phone,
      'subjects', t.subjects, 'stages', t.stages, 'classes', t.class_count, 'periods', t.weekly_periods)
      order by d.grp, d.name_ar)
    from staff_directory d
    left join profiles p on p.id = d.profile_id
    left join v_staff_teaching t on t.teacher_id = d.profile_id
    where p.id is null or p.active), '[]'::jsonb);
end $$;
