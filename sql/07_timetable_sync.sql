-- =====================================================================
--  الملف 7: مزامنة المعلمين والإسناد من جداول منصة الإشراف إلى منصة المدرسة
--  المعلمون موجودون داخل جداول الحصص التي رفعها المشرفون (supervision_data)،
--  وهذه الدالة تنشئهم كحسابات «معلم» في منصة المدرسة مع فصولهم وموادهم.
--  - المعلم بدون بريد (لا يستطيع الدخول) إلى أن تُضاف الإيميلات لاحقًا.
--  - عند استيراد الموظفين بالبريد لاحقًا يُربط البريد بنفس المعلم (بالاسم) بدل إنشاء حساب مكرر.
-- =====================================================================

alter table public.profiles add column if not exists source text;               -- 'timetable' = أُنشئ من جداول الإشراف
alter table public.teaching_assignments add column if not exists source text not null default 'manual';

-- ربط المعلم بمشرفه/مشرفيه
create table if not exists public.teacher_supervisors (
  teacher_id    uuid not null references public.profiles(id) on delete cascade,
  supervisor_id uuid not null references public.profiles(id) on delete cascade,
  primary key (teacher_id, supervisor_id)
);
alter table public.teacher_supervisors enable row level security;
drop policy if exists ts_read on public.teacher_supervisors;
create policy ts_read on public.teacher_supervisors for select
  using (public.is_staff());
drop policy if exists ts_admin on public.teacher_supervisors;
create policy ts_admin on public.teacher_supervisors for all
  using (public.is_admin()) with check (public.is_admin());
grant select on public.teacher_supervisors to authenticated;

-- p = { teachers: [{name, subject, sups:[uuid]}],
--       assign:   [{teacher, stage, grade, cls, subject, periods}] }
create or replace function public.sv_sync_teachers(p jsonb, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  me uuid := public.me_id(); r jsonb; s text; pid uuid; v_name text; v_subj text; v_job text;
  t_new int := 0; t_upd int := 0; t_off int := 0; a_ins int := 0; cls_new int := 0; subj_new int := 0;
  seen uuid[] := '{}'; ids jsonb := '{}'::jsonb; errs jsonb := '[]'::jsonb; c record; v_subject int; i int := 0;
begin
  if coalesce(private.sv_role(me), '') not in ('owner','sys') then
    raise exception 'غير مصرح: المزامنة لمسؤول النظام فقط';
  end if;
  begin
    -- 1) المعلمون
    for r in select * from jsonb_array_elements(coalesce(p->'teachers','[]')) loop
      v_name := regexp_replace(btrim(coalesce(r->>'name','')), '\s+', ' ', 'g');
      continue when v_name = '';
      v_subj := nullif(btrim(coalesce(r->>'subject','')), '');
      v_job  := 'معلم' || coalesce(' ' || v_subj, '');
      select id into pid from profiles
       where role not in ('student','parent') and public.norm(full_name) = public.norm(v_name)
       order by (email is not null) desc, created_at limit 1;
      if pid is null then
        insert into profiles(email, full_name, role, job_title, source)
        values (null, v_name, 'teacher', v_job, 'timetable') returning id into pid;
        t_new := t_new + 1;
      else
        update profiles set active = true,
               job_title = case when source = 'timetable' or job_title is null then v_job else job_title end
         where id = pid and (not active or source = 'timetable' or job_title is null);
        t_upd := t_upd + 1;
      end if;
      seen := seen || pid;
      ids := ids || jsonb_build_object(public.norm(v_name), pid);
      delete from teacher_supervisors where teacher_id = pid;
      insert into teacher_supervisors(teacher_id, supervisor_id)
      select pid, x::uuid from jsonb_array_elements_text(coalesce(r->'sups','[]')) x
      where exists (select 1 from profiles where id = x::uuid)
      on conflict do nothing;
    end loop;

    -- المعلمون الذين أُنشئوا من الجداول ولم يعودوا فيها (وبلا بريد) → غير نشطين
    update profiles set active = false
     where source = 'timetable' and email is null and active and not (id = any(seen));
    get diagnostics t_off = row_count;

    -- 2) الإسناد (الفصول والمواد)
    delete from teaching_assignments where source = 'timetable';
    for r in select * from jsonb_array_elements(coalesce(p->'assign','[]')) loop
      i := i + 1;
      begin
        pid := (ids ->> public.norm(r->>'teacher'))::uuid;
        if pid is null then raise exception 'المعلم "%" غير موجود في القائمة', r->>'teacher'; end if;
        if public.norm(r->>'subject') is null then raise exception 'المادة غير محددة'; end if;
        select * into c from public._get_class(r->>'stage', r->>'grade', r->>'cls', true);
        if c.created then cls_new := cls_new + 1; end if;
        select id into v_subject from subjects where public.norm(name_ar) = public.norm(r->>'subject');
        if v_subject is null then
          insert into subjects(name_ar) values (btrim(r->>'subject')) returning id into v_subject;
          subj_new := subj_new + 1;
        end if;
        insert into teaching_assignments(teacher_id, class_id, subject_id, weekly_periods, source)
        values (pid, c.cid, v_subject, nullif(r->>'periods','')::smallint, 'timetable')
        on conflict (teacher_id, class_id, subject_id) do update
          set weekly_periods = coalesce(excluded.weekly_periods, teaching_assignments.weekly_periods);
        a_ins := a_ins + 1;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'teacher', r->>'teacher', 'msg', sqlerrm);
      end;
    end loop;

    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('ok', true, 'dry_run', dry_run,
    'teachers_new', t_new, 'teachers_existing', t_upd, 'teachers_deactivated', t_off,
    'assignments', a_ins, 'classes_new', cls_new, 'subjects_new', subj_new,
    'errors', errs);
end $$;
revoke all on function public.sv_sync_teachers(jsonb, boolean) from public, anon;
grant execute on function public.sv_sync_teachers(jsonb, boolean) to authenticated;

-- استيراد الموظفين بالبريد: لو المعلم موجود من الجداول (بلا بريد) بنفس الاسم يُربط به البريد بدل إنشاء حساب جديد
create or replace function public._claim_timetable_profile(p_email text, p_name text) returns void
language sql security definer set search_path = public as $$
  update profiles set email = p_email
   where id = (select id from profiles
                where email is null and source = 'timetable' and public.norm(full_name) = public.norm(p_name)
                limit 1)
     and not exists (select 1 from profiles where email = p_email);
$$;

-- نسخة محدّثة من import_staff (تربط البريد بمعلم الجداول)
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
