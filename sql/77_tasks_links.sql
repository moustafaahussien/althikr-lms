-- ============================================================
-- 77) ربط الوحدات الجديدة بـ «مهامي» وبملخص الابن في بوابة ولي الأمر
-- ============================================================

create or replace function public.my_tasks() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := public.me_role()::text; out jsonb := '[]'::jsonb; n int;
begin
  if me is null or r in ('student','parent') then return '[]'::jsonb; end if;
  -- إحالات سلوكية مفتوحة (للموجّه والإدارة)
  if private.bh_manager() then
    select count(*) into n from bh_notes where refer and ref_status = 'open' and private.bh_can(student_id);
    if n > 0 then out := out || jsonb_build_object('icon', '📨', 'text', n || ' إحالة سلوكية مفتوحة', 'link', 'behavior.html#ref'); end if;
  end if;
  -- مبادرات بانتظار اعتمادي
  select count(*) into n from in_initiatives where status = 'pending' and private.in_reviewer(owner_id);
  if n > 0 then out := out || jsonb_build_object('icon', '💡', 'text', n || ' مبادرة بانتظار اعتمادك', 'link', 'initiatives.html#review'); end if;
  -- مبادراتي المعتمدة التي لم يُسجَّل أثرها
  select count(*) into n from in_initiatives where owner_id = me and status = 'approved' and (plan_date is null or plan_date <= current_date);
  if n > 0 then out := out || jsonb_build_object('icon', '✅', 'text', n || ' مبادرة معتمدة — سجّل أثرها بعد التنفيذ', 'link', 'initiatives.html#mine'); end if;
  -- مبادراتي المعادة بملاحظات
  select count(*) into n from in_initiatives where owner_id = me and status = 'returned';
  if n > 0 then out := out || jsonb_build_object('icon', '↩️', 'text', n || ' مبادرة أُعيدت لك بملاحظات', 'link', 'initiatives.html#mine'); end if;
  -- حجوزاتي في المختبرات/المرافق اليوم وغدًا
  select count(*) into n from lab_bookings where teacher_id = me and day between current_date and current_date + 1 and status in ('pending','prepared');
  if n > 0 then out := out || jsonb_build_object('icon', '🔬', 'text', n || ' حجز لك في المختبرات/المرافق اليوم أو غدًا', 'link', 'calendar.html'); end if;
  -- أحداث المدرسة اليوم
  select count(*) into n from sc_events e where current_date between e.start_date and coalesce(e.end_date, e.start_date) and (r = 'admin' or r = any (e.audience));
  if n > 0 then out := out || jsonb_build_object('icon', '📅', 'text', n || ' حدث في تقويم المدرسة اليوم', 'link', 'calendar.html'); end if;
  -- حصص انتظار مكلّف بها اليوم أو غدًا
  select count(*) into n from sub_assignments where sub_id = me and day between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '⏱️', 'text', n || ' حصة انتظار مكلّف بها اليوم أو غدًا', 'link', 'substitutes.html#mine'); end if;
  -- حصص انتظار لم تُسند بعد (للوكيل والإدارة)
  if private.sub_manager() then
    select count(*) into n from sub_assignments where status = 'open' and day between current_date and current_date + 1;
    if n > 0 then out := out || jsonb_build_object('icon', '🧩', 'text', n || ' حصة انتظار لم تُسند بعد', 'link', 'substitutes.html'); end if;
  end if;
  -- حالات إنذار مبكر مسندة إليّ
  select count(*) into n from ew_cases where owner_id = me and status <> 'closed';
  if n > 0 then out := out || jsonb_build_object('icon', '⚠️', 'text', n || ' حالة إنذار مبكر تتابعها', 'link', 'early-warning.html#mine'); end if;
  -- استبيانات بانتظار مشاركتي
  select count(*) into n from srv_surveys v where private.srv_for_me(v) and not exists (select 1 from srv_responses r where r.survey_id = v.id and r.profile_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' استبيان بانتظار مشاركتك', 'link', 'surveys.html'); end if;
  -- لقاءات أولياء أمور محجوزة اليوم أو غدًا
  select count(*) into n from mt_slots where teacher_id = me and status = 'booked' and (starts_at at time zone 'Asia/Riyadh')::date between current_date and current_date + 1;
  if n > 0 then out := out || jsonb_build_object('icon', '🤝', 'text', n || ' لقاء ولي أمر محجوز اليوم أو غدًا', 'link', 'meetings.html'); end if;
  -- أسئلة طلاب بانتظار ردي
  select count(*) into n from ds_threads t where t.kind in ('question','private') and not t.answered and not t.hidden
     and exists (select 1 from teaching_assignments ta where ta.class_id = t.class_id and ta.subject_id = t.subject_id and ta.teacher_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '❓', 'text', n || ' سؤال من الطلاب بانتظار ردك', 'link', 'discussions.html'); end if;
  -- كتب مكتبة متأخرة عندي
  select count(*) into n from bk_loans where borrower_id = me and returned_at is null and due_on < current_date;
  if n > 0 then out := out || jsonb_build_object('icon', '📚', 'text', n || ' كتاب متأخر الإرجاع للمكتبة', 'link', 'books.html#my'); end if;
  -- لأمين المكتبة: الإعارات المتأخرة
  if private.bk_lib() then
    select count(*) into n from bk_loans where returned_at is null and due_on < current_date;
    if n > 0 then out := out || jsonb_build_object('icon', '⏰', 'text', n || ' إعارة متأخرة في المكتبة', 'link', 'books.html#late'); end if;
  end if;
  return out;
end $$;

create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare s students; f date := current_date - 60;
begin
  select * into s from students where profile_id = p_student;
  if s.profile_id is null then return null; end if;
  return jsonb_build_object(
    'id', s.profile_id, 'name', (select full_name from profiles where id = s.profile_id),
    'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id),
    'class', (select name from classes where id = s.class_id),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('name', p.full_name, 'subject', sb.name_ar))
                 from teaching_assignments ta join classes c on c.id = ta.class_id join profiles p on p.id = ta.teacher_id and p.active
                 join subjects sb on sb.id = ta.subject_id
                 where (s.class_id is not null and ta.class_id = s.class_id) or (s.class_id is null and c.grade_id = s.grade_id)), '[]'::jsonb),
    'attendance', jsonb_build_object(
      'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = s.grade_id and a.period = 0
                      and (a.class_id is null or a.class_id = s.class_id) and a.day >= f),
      'absent',  (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'absent'),
      'late',    (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'late'),
      'excused', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'excused'),
      'recent',  coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.day >= f), '[]'::jsonb)),
    'behavior', private.child_behavior(s.profile_id),
    'report_cards', private.rc_of(s.profile_id),
    'exams', private.ec_student_info(s.profile_id),
    'clinic', private.cl_child(s.profile_id));
end $$;

-- مهام الطالب (استبيانات، مسارات لم تكتمل، كتب متأخرة، أسئلة أُجيب عنها)
create or replace function public.my_tasks_student() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); out jsonb := '[]'::jsonb; n int;
begin
  if public.me_role() <> 'student' then return '[]'::jsonb; end if;
  select count(*) into n from srv_surveys v where private.srv_for_me(v) and not exists (select 1 from srv_responses r where r.survey_id = v.id and r.profile_id = me);
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' استبيان بانتظار مشاركتك', 'link', 'surveys.html'); end if;
  select count(*) into n from pth_paths p where p.published and private.my_class_id() = any (p.class_ids)
     and exists (select 1 from pth_steps s where s.path_id = p.id and not private.pth_done(s, me));
  if n > 0 then out := out || jsonb_build_object('icon', '🧭', 'text', n || ' مسار تعلّم لم تكمله', 'link', 'paths.html'); end if;
  select count(*) into n from bk_loans where borrower_id = me and returned_at is null and due_on < current_date;
  if n > 0 then out := out || jsonb_build_object('icon', '📚', 'text', n || ' كتاب متأخر الإرجاع للمكتبة', 'link', 'books.html#my'); end if;
  select count(*) into n from ds_threads where author_id = me and answered and last_at > now() - interval '3 days';
  if n > 0 then out := out || jsonb_build_object('icon', '💬', 'text', n || ' من أسئلتك رد عليها المعلم', 'link', 'discussions.html'); end if;
  return out;
end $$;
revoke all on function public.my_tasks_student() from public, anon;
grant execute on function public.my_tasks_student() to authenticated;
revoke all on function private.child_summary(uuid) from public, anon, authenticated;
