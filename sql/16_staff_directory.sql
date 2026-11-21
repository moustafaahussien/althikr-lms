-- =====================================================================
--  الملف 16: دليل الموظفين (من ZenHR) مربوط بحسابات المنصة
--  - البيانات نفسها (الأسماء والبريد والجوال) لا تُحفظ في المستودع: تُستورد من لوحة الإدارة
--  - المسمى الوظيفي المعروض = الواقع في المنصة (job_title) إن وُجد، وإلا مسمى ZenHR
--  - يراه كل الموظفين فقط (لا الطلاب ولا أولياء الأمور)
-- =====================================================================

create table if not exists public.staff_directory (
  zid        bigint primary key,           -- رقم الموظف في ZenHR
  emp_no     text,                          -- الرقم الوظيفي
  name_ar    text not null,
  name_en    text,
  title_hr   text,                          -- المسمى في ZenHR (قد يختلف عن الواقع)
  email      text,
  mobile     text,
  work_phone text,
  grp        text,                          -- الإدارة / المرحلة
  manager    text,                          -- المدير المباشر
  profile_id uuid unique references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.staff_directory enable row level security;   -- بلا سياسات: القراءة عبر الدوال فقط

-- ---------- الاستيراد (مدير النظام): يستبدل الدليل كاملًا ثم يربطه بالحسابات ----------
create or replace function public.staff_dir_import(p_rows jsonb, p_apply boolean default false, p_manual jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; v_pid uuid; n_mail int := 0; n_name int := 0; n_man int := 0; n_new int := 0; n_email_set int := 0;
  unmatched jsonb := '[]'::jsonb; orphans jsonb := '[]'::jsonb; dom text := public.school_domain();
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;

  create temp table _d (zid bigint primary key, emp_no text, name_ar text, name_en text, title_hr text, email text,
                        mobile text, work_phone text, grp text, manager text, pid uuid, how text) on commit drop;
  insert into _d(zid, emp_no, name_ar, name_en, title_hr, email, mobile, work_phone, grp, manager)
  select (x->>'zid')::bigint, x->>'no', btrim(x->>'name_ar'), nullif(btrim(x->>'name_en'),''), nullif(btrim(x->>'title'),''),
         nullif(lower(btrim(x->>'email')),''), nullif(x->>'mobile',''), nullif(x->>'work',''), x->>'grp', nullif(x->>'manager','')
  from jsonb_array_elements(p_rows) x;

  -- 1) ربط يدوي (zid → id الحساب)
  -- (القيمة "skip" = لا يُربط الآن ولا يُنشأ له حساب، حتى يُحسم من هو)
  update _d set how = 'skip' where p_manual->>(zid::text) = 'skip';
  update _d set pid = (p_manual->>(zid::text))::uuid, how = 'manual' where p_manual ? (zid::text) and p_manual->>(zid::text) <> 'skip';
  -- 2) بالبريد
  update _d d set pid = p.id, how = 'email' from profiles p
   where d.pid is null and d.how is null and d.email is not null and p.email = d.email;
  -- 3) بالاسم العربي / الإنجليزي / الأسماء البديلة في الجداول (تطابق وحيد فقط، والحساب غير مربوط بغيره)
  update _d d set pid = m.id, how = 'name' from (
    select d2.zid, min(p.id::text)::uuid id, count(distinct p.id) c
    from _d d2 join profiles p on p.role not in ('student','parent')
      and (public.norm(p.full_name) in (public.norm(d2.name_ar), public.norm(d2.name_en))
           or exists (select 1 from staff_aliases a where a.profile_id = p.id and a.alias in (public.norm(d2.name_ar), public.norm(d2.name_en))))
    where d2.pid is null and d2.how is null
    group by d2.zid) m
   where d.zid = m.zid and m.c = 1 and d.pid is null
     and not exists (select 1 from _d o where o.pid = m.id);

  select count(*) filter (where how = 'email'), count(*) filter (where how = 'name'), count(*) filter (where how = 'manual')
    into n_mail, n_name, n_man from _d;
  select coalesce(jsonb_agg(jsonb_build_object('zid', zid, 'name', name_ar, 'en', name_en, 'title', title_hr, 'email', email) order by name_ar), '[]')
    into unmatched from _d where pid is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role, 'title', p.job_title, 'email', p.email) order by p.full_name), '[]')
    into orphans from profiles p
   where p.role not in ('student','parent') and p.active and not exists (select 1 from _d where pid = p.id);

  if p_apply then
    -- الحسابات المربوطة: البريد من الدليل إن لم يكن لها بريد، والمسمى من الدليل إن لم يكن لها مسمى (الواقع في المنصة يبقى)
    for r in select * from _d where pid is not null loop
      if r.email is not null and r.email like '%@' || dom
         and not exists (select 1 from profiles where email = r.email and id <> r.pid) then
        update profiles set email = r.email where id = r.pid and email is null;
        if found then n_email_set := n_email_set + 1; end if;
      end if;
      update profiles set job_title = r.title_hr where id = r.pid and nullif(btrim(job_title),'') is null and r.title_hr is not null;
    end loop;
    -- موظفون في الدليل ليس لهم حساب: يُنشأ لهم حساب (بريد المدرسة فقط) — معلم أو موظف
    for r in select * from _d where pid is null and how is null and email like '%@' || dom loop
      if not exists (select 1 from profiles where email = r.email) then
        insert into profiles(email, full_name, role, job_title, source)
        values (r.email, r.name_ar, case when r.title_hr like 'معلم%' then 'teacher' else 'staff' end::public.user_role, r.title_hr, 'zenhr')
        returning id into v_pid;
        update _d set pid = v_pid, how = 'new' where zid = r.zid;
        n_new := n_new + 1;
      end if;
    end loop;
    delete from staff_directory where true;   -- (Supabase يمنع DELETE بلا WHERE)
    insert into staff_directory(zid, emp_no, name_ar, name_en, title_hr, email, mobile, work_phone, grp, manager, profile_id)
    select zid, emp_no, name_ar, name_en, title_hr, email, mobile, work_phone, grp, manager, pid from _d;
  end if;

  return jsonb_build_object('total', (select count(*) from _d), 'by_email', n_mail, 'by_name', n_name, 'manual', n_man,
    'created', n_new, 'emails_filled', n_email_set, 'applied', p_apply, 'unmatched', unmatched, 'orphans', orphans);
end $$;
revoke all on function public.staff_dir_import(jsonb, boolean, jsonb) from public, anon;
grant execute on function public.staff_dir_import(jsonb, boolean, jsonb) to authenticated;

-- ---------- العرض (كل الموظفين) ----------
create or replace function public.staff_dir_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'دليل الموظفين متاح للموظفين فقط'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'zid', d.zid, 'no', d.emp_no,
      'name', d.name_ar, 'en', d.name_en,
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
revoke all on function public.staff_dir_list() from public, anon;
grant execute on function public.staff_dir_list() to authenticated;
