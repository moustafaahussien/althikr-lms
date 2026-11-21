-- =====================================================================
--  الملف 21: بوابتا الطالب وولي الأمر
--  - حسابات أولياء الأمور تُنشأ من «بريد ولي الأمر» في بيانات الطلاب وتُربط بأبنائهم (parents_sync)
--  - ولي الأمر يدخل بحساب Google الشخصي (أي نطاق)، ودخولهم مقفول افتراضيًا ويُفتح من لوحة الإدارة
--  - portal_child: ملخص الطالب (الصف، المعلمون، الحضور) للطالب نفسه ولولي أمره وللمعلم صاحب الصلاحية
-- =====================================================================

insert into public.app_settings(key, value) values ('parent_login_enabled', 'false'::jsonb) on conflict (key) do nothing;

create or replace function public.parent_login_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'parent_login_enabled'), false)
$$;

-- المستخدم الحالي: ولي الأمر يُقبل بأي نطاق بريد (عند فتح دخول أولياء الأمور)
create or replace function public.me_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.email = public.jwt_email() and p.active
    and (public.email_domain_ok(p.email) or (p.role = 'parent' and public.parent_login_enabled()))
    and (p.role <> 'student' or public.student_login_enabled())
    and (p.role <> 'parent' or public.parent_login_enabled())
$$;

create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); res jsonb;
begin
  if me is null then
    return jsonb_build_object('registered', false, 'email', public.jwt_email(),
      'domain_ok', public.email_domain_ok(public.jwt_email())
                   or exists (select 1 from profiles where email = public.jwt_email() and role = 'parent' and active),
      'students_closed', exists (select 1 from profiles where email = public.jwt_email() and role = 'student' and active) and not public.student_login_enabled(),
      'parents_closed',  exists (select 1 from profiles where email = public.jwt_email() and role = 'parent' and active) and not public.parent_login_enabled());
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
      select jsonb_build_object('id', s.profile_id, 'student_number', s.student_number, 'class_id', s.class_id, 'grade_id', s.grade_id,
                                'class_label', coalesce(vs.label, g.name_ar || ' — ' || stg.name_ar), 'section', vs.section_name)
      from students s left join v_students vs on vs.profile_id = s.profile_id
      left join grades g on g.id = s.grade_id left join stages stg on stg.id = g.stage_id
      where s.profile_id = me),
    'children', (select jsonb_agg(pl.student_id) from parent_links pl where pl.parent_id = me),
    'term', (select jsonb_build_object('year', y.name, 'term', t.name)
             from terms t join academic_years y on y.id = t.year_id where t.is_current limit 1)
  ) into res
  from profiles p where p.id = me;
  return res;
end $$;

-- إنشاء حسابات أولياء الأمور وربطهم بأبنائهم من «بريد ولي الأمر» (مدير النظام)
create or replace function public.parents_sync(p_apply boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new int := 0; n_link int := 0; n_emails int; r record; pid uuid;
begin
  if not public.is_admin() then raise exception 'غير مصرح'; end if;
  drop table if exists _pe;
  create temp table _pe on commit drop as
    select lower(btrim(sp.parent_email)) as email, s.profile_id as student_id, s.guardian_name, pr.full_name as student_name
    from student_private sp join students s on s.profile_id = sp.profile_id join profiles pr on pr.id = s.profile_id and pr.active
    where sp.parent_email ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$';
  select count(distinct email) into n_emails from _pe;
  if not p_apply then
    return jsonb_build_object('emails', n_emails, 'students', (select count(*) from _pe),
      'new_accounts', (select count(distinct e.email) from _pe e where not exists (select 1 from profiles p where p.email = e.email)),
      'existing_staff', (select count(distinct e.email) from _pe e join profiles p on p.email = e.email and p.role not in ('parent','student')),
      'student_emails', (select count(distinct e.email) from _pe e join profiles p on p.email = e.email and p.role = 'student'));
  end if;
  for r in select email, min(coalesce(nullif(btrim(guardian_name),''), 'ولي أمر ' || split_part(student_name, ' ', 1) || ' ' || split_part(student_name, ' ', 2))) as nm
           from _pe group by email loop
    select id into pid from profiles where email = r.email;
    if pid is null then
      insert into profiles(email, full_name, role, job_title, source) values (r.email, r.nm, 'parent', 'ولي أمر', 'registration') returning id into pid;
      n_new := n_new + 1;
    end if;
    -- لا نربط بريد طالب (خطأ في الإدخال) كولي أمر
    if exists (select 1 from profiles where id = pid and role = 'student') then continue; end if;
    insert into parent_links(parent_id, student_id, relation)
    select pid, e.student_id, 'ولي الأمر' from _pe e where e.email = r.email
    on conflict do nothing;
    get diagnostics n_link = row_count;
  end loop;
  return jsonb_build_object('ok', true, 'emails', n_emails, 'created', n_new,
    'links', (select count(*) from parent_links), 'parents', (select count(distinct parent_id) from parent_links));
end $$;

-- ملخص الطالب للبوابة
create or replace function public.portal_child(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s students; f date := current_date - 60;
begin
  select * into s from students where profile_id = p_student;
  if s.profile_id is null then raise exception 'غير موجود'; end if;
  if not (public.can_view_student(p_student) or private.att_can(s.grade_id, s.class_id)) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object(
    'id', s.profile_id, 'name', (select full_name from profiles where id = s.profile_id), 'number', s.student_number,
    'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id),
    'class', (select name from classes where id = s.class_id),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('id', p.id, 'name', p.full_name, 'subject', sb.name_ar))
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
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.day >= f), '[]'::jsonb)));
end $$;

revoke all on function public.parents_sync(boolean) from public, anon;
revoke all on function public.portal_child(uuid) from public, anon;
grant execute on function public.parents_sync(boolean) to authenticated;
grant execute on function public.portal_child(uuid) to authenticated;

-- ---------- إشعار ولي الأمر تلقائيًا عند تسجيل غياب ابنه (مرة واحدة لكل يوم) ----------
create table if not exists public.attendance_notices (
  student_id uuid not null references public.students(profile_id) on delete cascade,
  day        date not null,
  message_id bigint references public.messages(id) on delete set null,
  primary key (student_id, day)
);
alter table public.attendance_notices enable row level security;

create or replace function private.att_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare a attendance_sessions; mid bigint; nm text;
begin
  if new.status <> 'absent' or not public.parent_login_enabled() then return new; end if;
  select * into a from attendance_sessions where id = new.session_id;
  if a.period <> 0 or a.day < current_date - 1 then return new; end if;
  if exists (select 1 from attendance_notices where student_id = new.student_id and day = a.day) then return new; end if;
  if not exists (select 1 from parent_links where student_id = new.student_id) then return new; end if;
  select full_name into nm from profiles where id = new.student_id;
  insert into messages(kind, sender_id, subject, body, audience)
  values ('mail', a.taken_by, 'إشعار غياب: ' || nm,
          'ولي الأمر الكريم،' || chr(10) || 'نفيدكم بأن ابنكم/ابنتكم ' || nm || ' سُجّل غائبًا اليوم ' || to_char(a.day, 'YYYY-MM-DD') || '.'
          || coalesce(chr(10) || 'ملاحظة: ' || new.note, '') || chr(10) || chr(10)
          || 'إن كان الغياب بعذر نرجو الرد على هذه الرسالة بتوضيح السبب.' || chr(10) || 'مع تحيات إدارة المدرسة',
          'ولي أمر ' || nm)
  returning id into mid;
  insert into message_recipients(message_id, profile_id) select mid, parent_id from parent_links where student_id = new.student_id on conflict do nothing;
  insert into attendance_notices(student_id, day, message_id) values (new.student_id, a.day, mid) on conflict do nothing;
  return new;
end $$;
drop trigger if exists att_notify on public.attendance_marks;
create trigger att_notify after insert on public.attendance_marks for each row execute function private.att_notify();
