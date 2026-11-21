-- =====================================================================
--  الملف 7: أعمدة مصدر البيانات + ربط بريد المعلم عند استيراد الموظفين
--  (جدول الحصص نفسه في الملف 8)
--  - المعلم بدون بريد (لا يستطيع الدخول) إلى أن تُضاف الإيميلات لاحقًا.
--  - عند استيراد الموظفين بالبريد لاحقًا يُربط البريد بنفس المعلم (بالاسم) بدل إنشاء حساب مكرر.
-- =====================================================================

alter table public.profiles add column if not exists source text;               -- 'timetable' = أُنشئ من جداول الإشراف
alter table public.teaching_assignments add column if not exists source text not null default 'manual';



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
