-- =====================================================================
--  الملف 2 من 3: الصلاحيات (Row Level Security) ودوال الاستيراد والسياق
-- =====================================================================

-- ---------- تفعيل RLS على كل الجداول (الافتراضي = منع) ----------
do $$ declare t text; begin
  foreach t in array array['app_settings','sections','stages','grades','academic_years','terms',
                           'subjects','profiles','classes','students','staff_scopes',
                           'teaching_assignments','parent_links','audit_log']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- حذف السياسات القديمة لو أُعيد تشغيل الملف
do $$ declare p record; begin
  for p in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end $$;

-- ---------- جداول الهيكل: قراءة لكل مسجّل، تعديل لمدير النظام ----------
do $$ declare t text; begin
  foreach t in array array['sections','stages','grades','academic_years','terms','subjects']
  loop
    execute format('create policy read_%1$s on public.%1$s for select to authenticated
                    using (public.me_id() is not null)', t);
    execute format('create policy admin_write_%1$s on public.%1$s for all to authenticated
                    using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

create policy read_settings  on public.app_settings for select to authenticated using (public.me_id() is not null);
create policy admin_settings on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- المستخدمون ----------
create policy read_profiles  on public.profiles for select to authenticated
  using (public.can_view_profile(id, role));
create policy admin_profiles on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- الفصول ----------
create policy read_classes  on public.classes for select to authenticated
  using (public.can_view_class(id));
create policy admin_classes on public.classes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- الطلاب ----------
create policy read_students  on public.students for select to authenticated
  using (public.can_view_student(profile_id));
create policy admin_students on public.students for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- النطاقات ----------
create policy read_scopes  on public.staff_scopes for select to authenticated
  using (profile_id = public.me_id() or public.is_leader());
create policy admin_scopes on public.staff_scopes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- الإسناد ----------
create policy read_ta  on public.teaching_assignments for select to authenticated
  using (teacher_id = public.me_id() or public.can_view_class(class_id));
create policy admin_ta on public.teaching_assignments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- أولياء الأمور ----------
create policy read_parent_links  on public.parent_links for select to authenticated
  using (parent_id = public.me_id() or public.can_view_student(student_id));
create policy admin_parent_links on public.parent_links for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- السجل: قراءة لمدير النظام فقط، والكتابة عبر المُشغِّل فقط ----------
create policy read_audit on public.audit_log for select to authenticated using (public.is_admin());

-- ---------- الصلاحيات على مستوى قاعدة البيانات ----------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.audit_log from authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- =====================================================================
--  سياق المستخدم الحالي (تستدعيه الواجهة بعد الدخول)
-- =====================================================================
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); res jsonb;
begin
  if me is null then
    return jsonb_build_object('registered', false, 'email', public.jwt_email(),
                              'domain_ok', public.email_domain_ok(public.jwt_email()));
  end if;
  select jsonb_build_object(
    'registered', true,
    'profile', to_jsonb(p) - 'created_at' - 'updated_at',
    'school_name', (select value #>> '{}' from app_settings where key = 'school_name'),
    'scopes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'section', se.name_ar, 'stage', st.name_ar, 'subject', su.name_ar,
        'grade_min', sc.grade_min, 'grade_max', sc.grade_max, 'note', sc.note))
      from staff_scopes sc
      left join sections se on se.id = sc.section_id
      left join stages st   on st.id = sc.stage_id
      left join subjects su on su.id = sc.subject_id
      where sc.profile_id = me), '[]'::jsonb),
    'student', (
      select jsonb_build_object('student_number', s.student_number, 'class_id', s.class_id,
                                'class_label', vc.label, 'section', vc.section_name)
      from students s left join v_classes vc on vc.id = s.class_id
      where s.profile_id = me),
    'term', (select jsonb_build_object('year', y.name, 'term', t.name)
             from terms t join academic_years y on y.id = t.year_id where t.is_current limit 1)
  ) into res
  from profiles p where p.id = me;
  return res;
end $$;

-- إحصاءات عامة للقيادة ومدير النظام
create or replace function public.school_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_leader() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'students', (select count(*) from students s join profiles p on p.id = s.profile_id where p.active),
    'teachers', (select count(*) from profiles where role = 'teacher' and active),
    'staff',    (select count(*) from profiles where role not in ('student','parent') and active),
    'classes',  (select count(*) from classes where active),
    'subjects', (select count(*) from subjects where active),
    'assignments', (select count(*) from teaching_assignments),
    'no_class', (select count(*) from students where class_id is null),
    'no_email', (select count(*) from profiles where email is null and active),
    'by_section', coalesce((
      select jsonb_agg(jsonb_build_object('section', x.name_ar, 'students', x.n, 'classes', x.c) order by x.sort)
      from (select se.name_ar, se.sort,
                   count(distinct s.profile_id) n, count(distinct c.id) c
            from sections se
            left join stages st on st.section_id = se.id
            left join grades g on g.stage_id = st.id
            left join classes c on c.grade_id = g.id and c.active
            left join students s on s.class_id = c.id
            group by se.id, se.name_ar, se.sort) x), '[]'::jsonb));
end $$;

-- =====================================================================
--  دوال الاستيراد الجماعي (مدير النظام فقط)
--  كل دالة تستقبل مصفوفة JSON من الصفوف، و dry_run = true للتحقق دون حفظ
-- =====================================================================

-- إيجاد الصف من (المرحلة + رقم الصف)
create or replace function public._find_grade(p_stage text, p_grade text) returns int
language sql stable security definer set search_path = public as $$
  select g.id from grades g join stages st on st.id = g.stage_id
  where (public.norm(st.name_ar) = public.norm(p_stage) or public.norm(st.code) = public.norm(p_stage))
    and (g.number::text = public.norm(p_grade)
         or public.norm(g.name_ar) = public.norm(p_grade)
         or public.norm(g.name_ar) = public.norm('الصف ' || p_grade)
         or public.norm(g.name_ar) = public.norm('grade ' || p_grade))
  limit 1
$$;

-- إيجاد الفصل أو إنشاؤه
create or replace function public._get_class(p_stage text, p_grade text, p_class text,
                                             p_create boolean, out cid int, out created boolean)
language plpgsql security definer set search_path = public as $$
declare gid int; cname text := public.norm(p_class);
begin
  created := false;
  gid := public._find_grade(p_stage, p_grade);
  if gid is null then
    raise exception 'المرحلة "%" أو الصف "%" غير موجود', coalesce(p_stage,''), coalesce(p_grade,'');
  end if;
  if cname is null then raise exception 'اسم الفصل فارغ'; end if;
  select id into cid from classes where grade_id = gid and public.norm(name) = cname;
  if cid is null then
    if not p_create then raise exception 'الفصل "%" غير موجود', p_class; end if;
    insert into classes(grade_id, name)
    values (gid, regexp_replace(translate(btrim(p_class), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\s+', ' ', 'g'))
    returning id into cid;
    created := true;
  end if;
end $$;

-- ---------- استيراد الطلاب ----------
-- الحقول: student_number*, full_name*, email, stage*, grade*, class*, guardian_name, guardian_phone
create or replace function public.import_students(rows jsonb, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; ins int := 0; upd int := 0; cls int := 0;
  errs jsonb := '[]'::jsonb; v_num text; v_name text; v_email text; pid uuid; other uuid;
  c record;
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;
  begin
    for r in select * from jsonb_array_elements(rows) loop
      i := i + 1;
      begin
        v_num   := public.norm(r->>'student_number');
        v_name  := regexp_replace(btrim(coalesce(r->>'full_name','')), '\s+', ' ', 'g');
        v_email := nullif(lower(btrim(coalesce(r->>'email',''))), '');
        if v_num is null then raise exception 'رقم الطالب مطلوب'; end if;
        if v_name = '' then raise exception 'اسم الطالب مطلوب'; end if;
        if v_email is not null and not public.email_domain_ok(v_email) then
          raise exception 'البريد "%" ليس من نطاق المدرسة', v_email; end if;

        select * into c from public._get_class(r->>'stage', r->>'grade', r->>'class', true);

        select profile_id into pid from students where student_number = v_num;
        if v_email is not null then
          select id into other from profiles where email = v_email;
          if other is not null and other is distinct from pid then
            raise exception 'البريد "%" مستخدم لحساب آخر', v_email; end if;
        end if;

        if pid is null then
          insert into profiles(email, full_name, role) values (v_email, v_name, 'student') returning id into pid;
          insert into students(profile_id, student_number, class_id, guardian_name, guardian_phone)
          values (pid, v_num, c.cid, nullif(btrim(r->>'guardian_name'),''), nullif(btrim(r->>'guardian_phone'),''));
          ins := ins + 1;
        else
          update profiles set full_name = v_name, email = coalesce(v_email, email), active = true where id = pid;
          update students set class_id = c.cid,
                 guardian_name  = coalesce(nullif(btrim(r->>'guardian_name'),''),  guardian_name),
                 guardian_phone = coalesce(nullif(btrim(r->>'guardian_phone'),''), guardian_phone)
          where profile_id = pid;
          upd := upd + 1;
        end if;
        if c.created then cls := cls + 1; end if;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'msg', sqlerrm);
      end;
    end loop;
    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('total', i, 'inserted', ins, 'updated', upd,
                            'classes_created', cls, 'errors', errs, 'dry_run', dry_run);
end $$;

-- ---------- استيراد الموظفين ----------
-- الحقول: full_name*, email*, role*, job_title, scope_stage, scope_subject, scope_grade_min, scope_grade_max
create or replace function public._role_from_text(t text) returns public.user_role
language sql immutable as $$
  select case public.norm(t)
    when 'admin' then 'admin' when 'مدير نظام' then 'admin' when 'مدير النظام' then 'admin'
    when 'leadership' then 'leadership' when 'قياده' then 'leadership' when 'اداره عليا' then 'leadership'
      when 'الاداره العليا' then 'leadership'
    when 'principal' then 'principal' when 'مدير مرحله' then 'principal' when 'وكيل' then 'principal'
    when 'supervisor' then 'supervisor' when 'مشرف' then 'supervisor'
    when 'teacher' then 'teacher' when 'معلم' then 'teacher' when 'معلمه' then 'teacher'
    when 'staff' then 'staff' when 'موظف' then 'staff' when 'اداري' then 'staff'
    when 'parent' then 'parent' when 'ولي امر' then 'parent'
    else null end::public.user_role
$$;

create or replace function public.import_staff(rows jsonb, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; ins int := 0; upd int := 0; sc int := 0;
  errs jsonb := '[]'::jsonb; v_email text; v_name text; v_role public.user_role;
  pid uuid; v_stage int; v_section smallint; v_subject int; reset_done uuid[] := '{}';
  my_email text := public.jwt_email();
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;
  begin
    for r in select * from jsonb_array_elements(rows) loop
      i := i + 1;
      begin
        v_email := nullif(lower(btrim(coalesce(r->>'email',''))), '');
        v_name  := regexp_replace(btrim(coalesce(r->>'full_name','')), '\s+', ' ', 'g');
        v_role  := public._role_from_text(r->>'role');
        if v_email is null then raise exception 'البريد مطلوب للموظف'; end if;
        if not public.email_domain_ok(v_email) then raise exception 'البريد "%" ليس من نطاق المدرسة', v_email; end if;
        if v_name = '' then raise exception 'الاسم مطلوب'; end if;
        if v_role is null then raise exception 'الدور "%" غير معروف', coalesce(r->>'role',''); end if;
        if v_role = 'student' then raise exception 'الطلاب يُستوردون من ملف الطلاب'; end if;
        if v_email = my_email and v_role <> 'admin' then
          raise exception 'لا يمكن تغيير دورك أنت (مدير النظام) من الاستيراد'; end if;

        perform public._claim_timetable_profile(v_email, v_name);
        select id into pid from profiles where email = v_email;
        if pid is not null and exists (select 1 from students where profile_id = pid) then
          raise exception 'البريد "%" مسجّل لطالب', v_email; end if;

        if pid is null then
          insert into profiles(email, full_name, role, job_title)
          values (v_email, v_name, v_role, nullif(btrim(r->>'job_title'),'')) returning id into pid;
          ins := ins + 1;
        elsif not (pid = any(reset_done)) then
          update profiles set full_name = v_name, role = v_role, active = true,
                 job_title = coalesce(nullif(btrim(r->>'job_title'),''), job_title)
          where id = pid;
          upd := upd + 1;
        end if;

        -- النطاق (اختياري). أول ظهور للشخص في الملف يستبدل نطاقاته القديمة، والصفوف التالية تُضيف.
        if coalesce(public.norm(r->>'scope_stage'), public.norm(r->>'scope_subject'),
                    public.norm(r->>'scope_grade_min'), public.norm(r->>'scope_grade_max')) is not null then
          v_stage := null; v_section := null; v_subject := null;
          if public.norm(r->>'scope_stage') is not null then
            select id, section_id into v_stage, v_section from stages
            where public.norm(name_ar) = public.norm(r->>'scope_stage') or public.norm(code) = public.norm(r->>'scope_stage');
            if v_stage is null then
              select id into v_section from sections
              where public.norm(name_ar) = public.norm(r->>'scope_stage') or public.norm(code) = public.norm(r->>'scope_stage');
              if v_section is null then raise exception 'نطاق المرحلة/القسم "%" غير موجود', r->>'scope_stage'; end if;
            end if;
          end if;
          if public.norm(r->>'scope_subject') is not null then
            select id into v_subject from subjects where public.norm(name_ar) = public.norm(r->>'scope_subject');
            if v_subject is null then
              insert into subjects(name_ar) values (btrim(r->>'scope_subject')) returning id into v_subject;
            end if;
          end if;
          if not (pid = any(reset_done)) then delete from staff_scopes where profile_id = pid; end if;
          insert into staff_scopes(profile_id, section_id, stage_id, grade_min, grade_max, subject_id)
          values (pid, v_section, v_stage,
                  nullif(public.norm(r->>'scope_grade_min'),'')::smallint,
                  nullif(public.norm(r->>'scope_grade_max'),'')::smallint, v_subject);
          sc := sc + 1;
        end if;
        reset_done := reset_done || pid;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'msg', sqlerrm);
      end;
    end loop;
    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('total', i, 'inserted', ins, 'updated', upd, 'scopes', sc,
                            'errors', errs, 'dry_run', dry_run);
end $$;

-- ---------- استيراد الإسناد ----------
-- الحقول: teacher_email*, stage*, grade*, class*, subject*, weekly_periods
create or replace function public.import_assignments(rows jsonb, dry_run boolean default true,
                                                     replace_all boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; i int := 0; ins int := 0; cls int := 0; subj_new jsonb := '[]'::jsonb;
  errs jsonb := '[]'::jsonb; tid uuid; trole public.user_role; v_subject int; c record; v_new text;
begin
  if not public.is_admin() then raise exception 'غير مصرح: هذه العملية لمدير النظام فقط'; end if;
  begin
    if replace_all then delete from teaching_assignments; end if;
    for r in select * from jsonb_array_elements(rows) loop
      i := i + 1;
      begin
        select id, role into tid, trole from profiles where email = lower(btrim(coalesce(r->>'teacher_email','')));
        if tid is null then raise exception 'المعلم "%" غير مسجّل (استورد الموظفين أولًا)', coalesce(r->>'teacher_email',''); end if;
        if trole in ('student','parent') then raise exception 'البريد "%" ليس لموظف', r->>'teacher_email'; end if;
        if public.norm(r->>'subject') is null then raise exception 'المادة مطلوبة'; end if;

        select * into c from public._get_class(r->>'stage', r->>'grade', r->>'class', true);

        v_new := null;
        select id into v_subject from subjects where public.norm(name_ar) = public.norm(r->>'subject');
        if v_subject is null then
          insert into subjects(name_ar) values (btrim(r->>'subject')) returning id into v_subject;
          v_new := btrim(r->>'subject');
        end if;

        insert into teaching_assignments(teacher_id, class_id, subject_id, weekly_periods)
        values (tid, c.cid, v_subject, nullif(public.norm(r->>'weekly_periods'),'')::smallint)
        on conflict (teacher_id, class_id, subject_id)
        do update set weekly_periods = coalesce(excluded.weekly_periods, teaching_assignments.weekly_periods);
        ins := ins + 1;
        if c.created then cls := cls + 1; end if;
        if v_new is not null then subj_new := subj_new || to_jsonb(v_new); end if;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'msg', sqlerrm);
      end;
    end loop;
    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('total', i, 'saved', ins, 'classes_created', cls,
                            'subjects_created', subj_new, 'errors', errs, 'dry_run', dry_run,
                            'replace_all', replace_all);
end $$;

-- ---------- صلاحيات تنفيذ الدوال ----------
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
-- الدوال الداخلية لا تُستدعى مباشرة من الواجهة
revoke execute on function public._get_class(text,text,text,boolean) from authenticated;
revoke execute on function public._find_grade(text,text) from authenticated;
