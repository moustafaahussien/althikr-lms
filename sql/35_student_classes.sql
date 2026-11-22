-- =====================================================================
-- 35: توزيع الطلاب على الفصول من ملف (مدير النظام والإدارة العليا ومدير المرحلة لمرحلته)
--   المفتاح: رقم الهوية/الإقامة (من نظام التسجيل) — وإن لم يوجد فالاسم الكامل (يجب أن يكون فريدًا داخل الصف)
--   الفصل: يُطابَق داخل صف الطالب المسجّل (أ/ب/ج… أو 1/2/3… أو A/B…)، ويُنشأ إن لم يوجد
--   عمود الصف اختياري للتحقق فقط (لا يغيّر صف الطالب)
-- =====================================================================
create or replace function public.import_student_classes(rows jsonb, dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = public, private as $$
declare
  r jsonb; i int := 0; upd int := 0; same int := 0; cls int := 0; errs jsonb := '[]'::jsonb;
  v_id text; v_name text; v_cls text; pid uuid; n int; s record; st record; g record; cid int; cname text;
  letters text[] := array['أ','ب','ج','د','هـ','و','ز','ح','ط','ي'];
  my_stages int[] := private.my_stage_ids();
begin
  if not (public.me_role() in ('admin','leadership','principal')) then raise exception 'غير مصرح'; end if;
  begin
    for r in select * from jsonb_array_elements(rows) loop
      i := i + 1;
      begin
        v_id   := nullif(regexp_replace(translate(coalesce(r->>'national_id',''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
        v_name := public.norm(r->>'full_name');
        v_cls  := btrim(translate(coalesce(r->>'class',''), '٠١٢٣٤٥٦٧٨٩', '0123456789'));
        -- «4/أ» أو «4-أ» أو «أول أ» ← الجزء الأخير
        v_cls  := btrim(regexp_replace(v_cls, '^.*[/\-–\s]', ''));
        if v_cls = '' then raise exception 'اسم الفصل فارغ'; end if;
        pid := null;
        if v_id is not null then
          select sp.profile_id into pid from student_private sp where regexp_replace(coalesce(sp.national_id,''), '\D', '', 'g') = v_id;
          if pid is null then raise exception 'رقم الهوية % غير موجود في المنصة', v_id; end if;
        elsif v_name is not null then
          select count(*), min(p.id::text)::uuid into n, pid from profiles p join students x on x.profile_id = p.id
           where public.norm(p.full_name) = v_name and p.active;
          if n = 0 then raise exception 'الطالب «%» غير موجود', r->>'full_name'; end if;
          if n > 1 then raise exception 'الاسم «%» مكرر لأكثر من طالب — استخدم رقم الهوية', r->>'full_name'; end if;
        else raise exception 'رقم الهوية أو اسم الطالب مطلوب'; end if;

        select * into s from students where profile_id = pid;
        if s.grade_id is null then raise exception 'الطالب غير مسجّل في صف'; end if;
        select * into g from grades where id = s.grade_id;
        select * into st from stages where id = g.stage_id;
        if public.me_role() = 'principal' and not (st.id = any (my_stages)) then raise exception 'الطالب خارج مرحلتك'; end if;
        if nullif(btrim(coalesce(r->>'grade','')), '') is not null
           and regexp_replace(translate(r->>'grade', '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g') <> g.number::text
           and regexp_replace(translate(r->>'grade', '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g') <> '' then
          raise exception 'الصف في الملف (%) لا يطابق صف الطالب في المنصة (%)', r->>'grade', g.name_ar; end if;

        -- توحيد اسم الفصل حسب المسار: الأرقام ← حروف (عربي) أو A/B (الدبلوم الأمريكي)
        if st.code = 'american' then
          cname := case when v_cls ~ '^\d+$' then chr(64 + v_cls::int) else upper(v_cls) end;
        else
          cname := case when v_cls ~ '^\d+$' and v_cls::int between 1 and 10 then letters[v_cls::int]
                        when upper(v_cls) ~ '^[A-J]$' then letters[ascii(upper(v_cls)) - 64]
                        when v_cls = 'ه' then 'هـ' else v_cls end;
        end if;
        if length(cname) > 10 then raise exception 'اسم الفصل «%» غير صالح', v_cls; end if;

        select id into cid from classes where grade_id = g.id and public.norm(name) = public.norm(cname);
        if cid is null then
          insert into classes(grade_id, name) values (g.id, cname) returning id into cid; cls := cls + 1;
        end if;
        if s.class_id is not distinct from cid then same := same + 1;
        else update students set class_id = cid where profile_id = pid; upd := upd + 1; end if;
      exception when others then
        errs := errs || jsonb_build_object('row', i, 'msg', sqlerrm);
      end;
    end loop;
    if dry_run then raise exception 'DRY_RUN_ROLLBACK'; end if;
  exception when others then
    if sqlerrm <> 'DRY_RUN_ROLLBACK' then raise; end if;
  end;
  return jsonb_build_object('total', i, 'updated', upd, 'unchanged', same, 'classes_created', cls, 'errors', errs, 'dry_run', dry_run);
end $$;
revoke all on function public.import_student_classes(jsonb, boolean) from public, anon;
grant execute on function public.import_student_classes(jsonb, boolean) to authenticated;
