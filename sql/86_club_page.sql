-- ============================================================
-- 86) صفحة النادي الكاملة: الضغط على اسم النادي يفتح صفحة بكل بياناته
--     الموظفون: كل البيانات (كما في 83)، والطالب: بيانات النادي والإنجازات وعضويته وحضوره هو فقط
-- ============================================================
create or replace function public.cb_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare c cb_clubs;
begin
  select * into c from cb_clubs where id = p_id;
  if c.id is null then raise exception 'غير متاح'; end if;
  -- الطالب: صفحة النادي العامة (بيانات النادي + الإنجازات + عضويته وحضوره هو فقط) بدون بيانات زملائه
  if not public.is_staff() then
    if public.me_role()::text <> 'student' then raise exception 'غير متاح'; end if;
    if not exists (select 1 from cb_members m where m.club_id = c.id and m.student_id = public.me_id() and m.status in ('active','pending'))
       and (not c.active or (cardinality(c.grade_ids) > 0 and not ((private.cs_stu(public.me_id()) ->> 'grade_id')::int = any (c.grade_ids)))) then raise exception 'غير متاح'; end if;
    return private.cb_json(c) || jsonb_build_object('student_view', true,
      'my', (select m.status from cb_members m where m.club_id = c.id and m.student_id = public.me_id()),
      'my_role', (select m.role from cb_members m where m.club_id = c.id and m.student_id = public.me_id()),
      'my_att', (select jsonb_build_object('present', count(*) filter (where a.status = 'present'), 'late', count(*) filter (where a.status = 'late'),
          'absent', count(*) filter (where a.status = 'absent'), 'excused', count(*) filter (where a.status = 'excused'), 'held', count(*))
        from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = public.me_id()),
      'roster', '[]'::jsonb, 'sessions_list', '[]'::jsonb,
      'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'title', a.title, 'details', a.details,
          'students', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (a.students))) order by a.day desc) from cb_achievements a where a.club_id = c.id), '[]'));
  end if;
  return private.cb_json(c) || jsonb_build_object(
    'roster', coalesce((select jsonb_agg(private.cs_stu(m.student_id) || jsonb_build_object('status', m.status, 'role', m.role, 'joined_at', m.joined_at,
        'attended', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status in ('present','late')),
        'late', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status = 'late'),
        'absent', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id and a.status = 'absent'),
        'held', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = m.student_id))
        order by m.status <> 'pending', m.role desc, (select full_name from profiles where id = m.student_id)) from cb_members m where m.club_id = c.id and m.status in ('pending','active')), '[]'),
    'sessions_list', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'day', s.day, 'topic', s.topic, 'notes', s.notes,
        'present', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'present'), 'late', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'late'),
        'absent', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'absent'), 'excused', (select count(*) from cb_att a where a.session_id = s.id and a.status = 'excused'))
        order by s.day desc) from cb_sessions s where s.club_id = c.id), '[]'),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'day', a.day, 'title', a.title, 'details', a.details,
        'students', (select coalesce(jsonb_agg(full_name), '[]') from profiles where id = any (a.students))) order by a.day desc) from cb_achievements a where a.club_id = c.id), '[]'));
end $$;


-- «مشاركاتي» وبوابة ولي الأمر: إضافة رقم النادي ليفتح اسم النادي صفحته
create or replace function private.cs_child(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object(
    'transport', private.tr_info(p_student),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'icon', c.icon, 'status', m.status, 'schedule', c.schedule, 'place', c.place,
                'supervisor', (select full_name from profiles where id = c.supervisor_id),
                'days', private.cb_days_label(c.train_days), 'train_days', c.train_days, 'time_from', c.time_from, 'time_to', c.time_to, 'ends_on', c.ends_on,
                'coach', coalesce((select full_name from profiles where id = c.coach_id), c.coach_name),
                'attended', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = p_student and a.status in ('present','late')),
                'held', (select count(*) from cb_att a join cb_sessions s on s.id = a.session_id where s.club_id = c.id and a.student_id = p_student))), '[]')
              from cb_members m join cb_clubs c on c.id = m.club_id where m.student_id = p_student and m.status in ('active','pending')),
    'activities', (select coalesce(jsonb_agg(jsonb_build_object('title', a.title, 'kind', private.ac_kind(a.kind), 'day', a.day, 'role', s.role, 'note', s.note) order by a.day desc), '[]')
              from ac_students s join ac_activities a on a.id = s.activity_id where s.student_id = p_student and a.status <> 'cancelled' and a.day > current_date - 365),
    'trips', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'destination', t.destination, 'purpose', t.purpose, 'day', t.day,
                'depart_time', t.depart_time, 'return_time', t.return_time, 'cost', t.cost, 'transport', t.transport, 'consent_by', t.consent_by, 'status', t.status,
                'consent', x.consent, 'paid', x.paid, 'attended', x.attended, 'organizer', (select full_name from profiles where id = t.organizer_id)) order by t.day desc), '[]')
              from tp_people x join tp_trips t on t.id = x.trip_id where x.student_id = p_student and t.status in ('approved','done') and t.day > current_date - 120),
    'uniform', (select coalesce(jsonb_agg(private.un_order_json(o) order by o.created_at desc), '[]') from un_orders o where o.student_id = p_student and o.created_at > now() - interval '365 days'),
    'books', private.tb_child(p_student),
    'transport_request', (select jsonb_build_object('status', q.status, 'reply', q.reply, 'created_at', q.created_at) from tr_requests q where q.student_id = p_student order by q.created_at desc limit 1))
$$;

