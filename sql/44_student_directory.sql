-- =====================================================================
-- 44: دليل الطلاب (للإداريين فقط) + إصلاح مطابقة أسماء الفصول في استيراد التوزيع
--   - يرى الدليل: مدير النظام، القيادة، الموظفون الإداريون (الكل)، ومدير المرحلة (مراحله فقط)
--   - لا يراه المعلم ولا المشرف ولا الطالب ولا ولي الأمر
--   - sd_list: البحث والتصفية | sd_get: ملف الطالب الكامل
-- =====================================================================

-- ---------- إصلاح: الفصل «1» في المتوسط/الثانوي اسمه «1» فعلًا، فلا يُحوَّل إلى «أ» ----------
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

        -- 1) فصل موجود بنفس الاسم كما في الملف (مثل «1» في المتوسط والثانوي)
        select id into cid from classes where grade_id = g.id and public.norm(name) = public.norm(v_cls);
        if cid is null then
          -- 2) توحيد الاسم حسب المسار: الأرقام ← حروف (عربي) أو A/B (الدبلوم الأمريكي)
          if st.code = 'american' then
            cname := case when v_cls ~ '^\d+$' then chr(64 + v_cls::int) else upper(v_cls) end;
          else
            cname := case when v_cls ~ '^\d+$' and v_cls::int between 1 and 10 then letters[v_cls::int]
                          when upper(v_cls) ~ '^[A-J]$' then letters[ascii(upper(v_cls)) - 64]
                          when v_cls = 'ه' then 'هـ' else v_cls end;
            -- صفوف المرحلة تستخدم الأرقام (المتوسط/الثانوي) ← يبقى الرقم كما هو
            if v_cls ~ '^\d+$' and exists (select 1 from classes c join grades g2 on g2.id = c.grade_id
                                           where g2.stage_id = st.id and c.name ~ '^\d+$') then cname := v_cls; end if;
          end if;
          if length(cname) > 10 then raise exception 'اسم الفصل «%» غير صالح', v_cls; end if;
          select id into cid from classes where grade_id = g.id and public.norm(name) = public.norm(cname);
        end if;
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

-- ---------- صلاحية الدليل ----------
create or replace function private.sd_stages() returns int[]
language sql stable security definer set search_path = public as $$
  select case when public.me_role() in ('admin','leadership','staff') then (select array_agg(id) from stages)
              when public.me_role() = 'principal' then private.my_stage_ids()
              else '{}'::int[] end
$$;

create or replace function private.sd_can(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from students s join grades g on g.id = s.grade_id
                 where s.profile_id = p_student and g.stage_id = any (private.sd_stages()))
$$;

-- ---------- القائمة ----------
create or replace function public.sd_list(p_q text default null, p_stage int default null, p_grade int default null,
                                          p_class int default null, p_flag text default null, p_limit int default 60, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare stg int[] := private.sd_stages(); q text := public.norm(nullif(btrim(coalesce(p_q,'')), '')); qd text;
begin
  if coalesce(array_length(stg, 1), 0) = 0 then raise exception 'دليل الطلاب للإداريين فقط'; end if;
  qd := nullif(regexp_replace(translate(coalesce(p_q,''), '٠١٢٣٤٥٦٧٨٩', '0123456789'), '\D', '', 'g'), '');
  return (with base as (
      select s.profile_id id, p.full_name, p.email, p.active, s.student_number, s.grade_id, s.class_id, g.stage_id, g.number gn,
             g.name_ar gname, st.name_ar sname, c.name cname, s.guardian_phone
        from students s join profiles p on p.id = s.profile_id join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
        left join classes c on c.id = s.class_id
       where g.stage_id = any (stg)
         and (p_stage is null or g.stage_id = p_stage) and (p_grade is null or s.grade_id = p_grade)
         and (p_class is null or s.class_id = p_class)
         and (q is null or public.norm(p.full_name) like '%' || q || '%' or s.student_number = btrim(p_q)
              or (qd is not null and length(qd) >= 4 and exists (select 1 from student_private sp where sp.profile_id = s.profile_id
                    and regexp_replace(coalesce(sp.national_id,''), '\D', '', 'g') like qd || '%')))
         and (p_flag is null
              or (p_flag = 'noclass' and s.class_id is null)
              or (p_flag = 'inactive' and not p.active)
              or (p_flag = 'noguardian' and not exists (select 1 from guardian_students gs where gs.student_id = s.profile_id)
                                         and not exists (select 1 from parent_links pl where pl.student_id = s.profile_id)
                                         and coalesce(btrim(s.guardian_phone), '') = '')
              or (p_flag = 'absent' and (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id
                                         where m.student_id = s.profile_id and m.status = 'absent' and a.period = 0
                                           and a.day >= current_date - 30) >= 3)))
    select jsonb_build_object(
      'total', (select count(*) from base),
      'rows', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.full_name, 'number', b.student_number, 'active', b.active,
                 'stage', b.sname, 'grade', b.gname, 'class', b.cname, 'class_id', b.class_id,
                 'absent30', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id
                              where m.student_id = b.id and m.status = 'absent' and a.period = 0 and a.day >= current_date - 30)) order by b.full_name)
               from (select * from base order by full_name limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)) b), '[]'::jsonb),
      'filters', jsonb_build_object(
        'stages', (select jsonb_agg(jsonb_build_object('id', id, 'name', name_ar) order by sort) from stages where id = any (stg)),
        'grades', (select jsonb_agg(jsonb_build_object('id', g.id, 'stage', g.stage_id, 'name', g.name_ar) order by g.stage_id, g.number)
                   from grades g where g.stage_id = any (stg) and exists (select 1 from students s where s.grade_id = g.id)),
        'classes', (select jsonb_agg(jsonb_build_object('id', c.id, 'grade', c.grade_id, 'name', c.name) order by c.grade_id, c.name)
                    from classes c join grades g on g.id = c.grade_id where g.stage_id = any (stg) and c.active)),
      'summary', jsonb_build_object(
        'all', (select count(*) from students s join grades g on g.id = s.grade_id where g.stage_id = any (stg)),
        'noclass', (select count(*) from students s join grades g on g.id = s.grade_id where g.stage_id = any (stg) and s.class_id is null)),
      'can_private', public.me_role() in ('admin','leadership','principal','staff')));
end $$;

-- ---------- ملف الطالب الكامل ----------
create or replace function public.sd_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s students; p profiles; g grades; cid int; yf date;
begin
  if not private.sd_can(p_id) then raise exception 'دليل الطلاب للإداريين فقط'; end if;
  select * into s from students where profile_id = p_id;
  select * into p from profiles where id = p_id;
  select * into g from grades where id = s.grade_id;
  cid := s.class_id;
  yf := coalesce((select starts_on from academic_years where is_current), (current_date - 300));
  return jsonb_build_object(
    'info', jsonb_build_object('id', p.id, 'name', p.full_name, 'email', p.email, 'active', p.active, 'number', s.student_number,
        'stage', (select name_ar from stages where id = g.stage_id), 'grade', g.name_ar, 'grade_id', g.id, 'class', (select name from classes where id = cid),
        'class_id', cid, 'track', s.track, 'notes', s.notes, 'guardian_name', s.guardian_name, 'guardian_phone', s.guardian_phone,
        'homeroom', (select pr.full_name from classes c join profiles pr on pr.id = c.homeroom_teacher_id where c.id = cid),
        'created_at', p.created_at),
    'private', (select jsonb_build_object('national_id', sp.national_id, 'nationality', sp.nationality, 'dob', sp.date_of_birth,
        'parent_email', sp.parent_email, 'agreement', sp.agreement_id, 'updated_at', sp.updated_at)
        from student_private sp where sp.profile_id = p_id),
    'guardians', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('name', gd.name, 'phone', gd.phone, 'kind', 'pin', 'last_login', gd.last_login, 'active', gd.pin_hash is not null) x
          from guardian_students gs join guardians gd on gd.id = gs.guardian_id where gs.student_id = p_id
        union all
        select jsonb_build_object('name', pr.full_name, 'phone', null, 'email', pr.email, 'kind', 'account', 'relation', pl.relation, 'active', pr.active)
          from parent_links pl join profiles pr on pr.id = pl.parent_id where pl.student_id = p_id) z), '[]'::jsonb),
    'siblings', coalesce((select jsonb_agg(distinct jsonb_build_object('id', o.student_id, 'name', op.full_name,
          'class', (select label from v_classes where id = os.class_id)))
        from guardian_students gs join guardian_students o on o.guardian_id = gs.guardian_id and o.student_id <> p_id
        join profiles op on op.id = o.student_id join students os on os.profile_id = o.student_id where gs.student_id = p_id), '[]'::jsonb),
    'teachers', coalesce((select jsonb_agg(jsonb_build_object('teacher', pr.full_name, 'subject', sb.name_ar) order by sb.name_ar)
        from teaching_assignments ta join profiles pr on pr.id = ta.teacher_id join subjects sb on sb.id = ta.subject_id where ta.class_id = cid), '[]'::jsonb),
    'attendance', jsonb_build_object(
        'from', yf,
        'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = s.grade_id and a.period = 0
                        and (a.class_id is null or a.class_id = cid) and a.day >= yf),
        'absent', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = p_id and a.period = 0 and m.status = 'absent' and a.day >= yf),
        'late', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = p_id and a.period = 0 and m.status = 'late' and a.day >= yf),
        'excused', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = p_id and a.period = 0 and m.status = 'excused' and a.day >= yf),
        'period_absent', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = p_id and a.period > 0 and m.status = 'absent' and a.day >= yf),
        'marks', coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = p_id and a.day >= yf), '[]'::jsonb)),
    'grades', case when cid is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('subject', sb.name_ar, 'pct', private.gb_pct(x.cols, x.sc),
          'columns', x.cols, 'scores', x.sc) order by sb.name_ar)
        from (select distinct subject_id from teaching_assignments where class_id = cid) ta join subjects sb on sb.id = ta.subject_id
        cross join lateral (select coalesce((select jsonb_agg(jsonb_build_object('key', c.key, 'title', c.title, 'max', c.max_score, 'weight', c.weight, 'period', c.period) order by c.d, c.key)
                                   from private.gb_columns(cid, sb.id) c where not c.hidden), '[]'::jsonb) cols,
                                   private.gb_student_scores(cid, sb.id, p_id) sc) x
        where jsonb_array_length(x.cols) > 0), '[]'::jsonb) end,
    'homework', jsonb_build_object(
        'assigned', (select count(*) from hw_assignments h where cid = any (h.class_ids) and h.created_at >= yf),
        'submitted', (select count(*) from hw_submissions hs join hw_assignments h on h.id = hs.hw_id where hs.student_id = p_id and h.created_at >= yf),
        'late', (select count(*) from hw_submissions hs join hw_assignments h on h.id = hs.hw_id where hs.student_id = p_id and hs.late and h.created_at >= yf),
        'missing', (select count(*) from hw_assignments h where cid = any (h.class_ids) and h.created_at >= yf and h.due_at < now()
                     and not exists (select 1 from hw_submissions hs where hs.hw_id = h.id and hs.student_id = p_id)),
        'items', coalesce((select jsonb_agg(z order by z->>'due' desc) from (
              select jsonb_build_object('title', h.title, 'subject', (select name_ar from subjects where id = h.subject_id), 'due', h.due_at, 'max', h.max_score,
                     'status', coalesce(hs.status, case when h.due_at < now() then 'missing' else 'open' end), 'score', hs.score, 'late', hs.late) z
                from hw_assignments h left join hw_submissions hs on hs.hw_id = h.id and hs.student_id = p_id
               where cid = any (h.class_ids) and h.created_at >= yf order by h.due_at desc limit 40) q), '[]'::jsonb)),
    'exams', coalesce((select jsonb_agg(z order by z->>'opens' desc) from (
          select jsonb_build_object('title', e.title, 'subject', (select name_ar from subjects where id = e.subject_id), 'opens', e.opens_at,
                 'score', a.score, 'max', a.max_score, 'submitted', a.submitted_at is not null, 'review', a.needs_review,
                 'status', case when a.id is null then (case when e.closes_at < now() then 'missed' else 'open' end) when a.submitted_at is null then 'started' else 'done' end) z
            from ex_exams e left join ex_attempts a on a.exam_id = e.id and a.student_id = p_id
           where cid = any (e.class_ids) and e.created_at >= yf order by e.opens_at desc limit 40) q), '[]'::jsonb),
    'portfolio', coalesce((select jsonb_agg(jsonb_build_object('title', i.title, 'kind', i.kind, 'date', i.item_date, 'level', i.level, 'result', i.result, 'status', i.status) order by i.item_date desc)
        from pf_items i where i.student_id = p_id), '[]'::jsonb),
    'complaints', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'subject', c.subject, 'category', c.category, 'status', c.status, 'at', c.created_at) order by c.created_at desc)
        from complaints c where c.student_id = p_id), '[]'::jsonb),
    'can_private', public.me_role() in ('admin','leadership','principal','staff'));
end $$;

revoke all on function private.sd_stages(), private.sd_can(uuid) from public, anon, authenticated;
revoke all on function public.sd_list(text, int, int, int, text, int, int), public.sd_get(uuid) from public, anon;
grant execute on function public.sd_list(text, int, int, int, text, int, int), public.sd_get(uuid) to authenticated;
