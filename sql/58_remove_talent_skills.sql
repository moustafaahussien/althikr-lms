-- =====================================================================
-- 58: إزالة «الموهبة والمسابقات» و«جواز مهارات القرن 21» من منصة المدرسة
--   منصة الموهبة هي المصدر الوحيد لبيانات الموهبة والمسابقات والبرامج، ومنصة مهارات القرن 21 لبرامج الوحدة.
--   منصة المدرسة تعرض بيانات منصة الموهبة في ملف الطالب ودليل الموظفين بالقراءة المباشرة منها (بلا نسخ).
-- =====================================================================

-- 1) الدوال التي كانت تقرأ من جداول المسابقات
create or replace function public.cal_feed(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); r text := public.me_role()::text; my_stages int[];
begin
  if me is null then raise exception 'غير مصرح'; end if;
  if p_to - p_from > 100 then raise exception 'الفترة طويلة'; end if;
  my_stages := array(select distinct g.stage_id from students s join grades g on g.id = s.grade_id
                      where s.profile_id = me or s.profile_id in (select student_id from parent_links where parent_id = me));
  return jsonb_build_object('manager', private.cal_manager(), 'items',
    coalesce((select jsonb_agg(x order by x->>'date') from (
      select jsonb_build_object('src', 'event', 'id', e.id, 'kind', e.kind, 'title', e.title, 'date', e.start_date, 'end', e.end_date, 'note', e.note,
               'stage', (select name_ar from stages where id = e.stage_id), 'audience', e.audience, 'stage_id', e.stage_id,
               'can_edit', public.is_admin() or r = 'leadership' or e.created_by = me) x
        from sc_events e
       where coalesce(e.end_date, e.start_date) >= p_from and e.start_date <= p_to
         and (r = 'admin' or r = any (e.audience)) and (e.stage_id is null or r not in ('student','parent') or e.stage_id = any (my_stages))
      union all
      select jsonb_build_object('src', 'lab', 'kind', 'booking', 'title', l.icon || ' ' || l.name || ': ' || b.title, 'date', b.day, 'period', b.period, 'status', b.status, 'link', 'labs.html?lab=' || l.code)
        from lab_bookings b join labs l on l.id = b.lab_id
       where r not in ('student','parent') and b.teacher_id = me and b.day between p_from and p_to and b.status in ('pending','prepared','done')

      union all
      select jsonb_build_object('src', 'exam', 'kind', 'exam', 'title', '🧪 ' || x.title, 'date', (x.opens_at at time zone 'Asia/Riyadh')::date, 'link', 'exams.html')
        from ex_exams x where x.teacher_id = me and (x.opens_at at time zone 'Asia/Riyadh')::date between p_from and p_to
      union all
      select jsonb_build_object('src', 'hw', 'kind', 'deadline', 'title', '📝 تسليم: ' || h.title, 'date', (h.due_at at time zone 'Asia/Riyadh')::date, 'link', 'homework.html')
        from hw_assignments h where h.teacher_id = me and (h.due_at at time zone 'Asia/Riyadh')::date between p_from and p_to
    ) q), '[]'::jsonb));
end $$;

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
  return out;
end $$;

-- 2) ملخص الابن لولي الأمر (بدون جواز المهارات)
create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
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
    'behavior', private.child_behavior(s.profile_id));
end $$;

-- 3) حذف الوحدتين
drop function if exists public.tl_comps(boolean), public.tl_comp_save(jsonb), public.tl_comp_delete(bigint), public.tl_entries_of(bigint),
  public.tl_nominate(bigint, uuid[], text), public.tl_entry_set(bigint, jsonb), public.tl_entry_delete(bigint), public.tl_pool_list(),
  public.tl_pool_save(jsonb), public.tl_pool_remove(uuid), public.tl_student(uuid), public.tl_kpis(text);
drop function if exists private.tl_comp_json(public.tl_competitions), private.tl_manager(), private.tl_can_comp(bigint), private.tl_sees(uuid);
drop table if exists public.tl_entries, public.tl_pool, public.tl_competitions;

drop function if exists public.sk_passport(uuid), public.sk_add(jsonb), public.sk_delete(bigint), public.sk_programs_list(), public.sk_stats(date, date);
drop function if exists private.child_skills(uuid), private.sk_passport_of(uuid), private.sk_manager(), private.sk_sees(uuid);
drop table if exists public.sk_records, public.sk_programs;

-- 4) لسكربت منصة الموهبة: هل يحق للمستخدم رؤية هذا الطالب؟ (يعيد الاسم الكامل للمطابقة فقط)
create or replace function public.talent_student_ref(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() or not (private.sd_can(p_student) or private.bh_can(p_student)) then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'name', (select full_name from profiles where id = p_student));
end $$;

revoke all on function private.child_summary(uuid) from public, anon, authenticated;
revoke all on function public.cal_feed(date, date), public.my_tasks(), public.talent_student_ref(uuid) from public, anon;
grant execute on function public.cal_feed(date, date), public.my_tasks(), public.talent_student_ref(uuid) to authenticated;
