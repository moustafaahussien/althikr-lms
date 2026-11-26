-- ============================================================
-- 64) نظام الإنذار المبكر: يرصد الطلاب المتعثرين من بيانات المنصة نفسها
-- (الغياب، التأخر، السلوك السلبي، الواجبات غير المسلّمة، درجات الاختبارات)
-- ويفتح «حالة متابعة» بخطة وإجراءات موثّقة حتى الإغلاق.
-- لا بيانات جديدة: يقرأ فقط من جداول الحضور والسلوك والواجبات والاختبارات.
-- ============================================================

create table if not exists public.ew_cases (
  id         bigserial primary key,
  student_id uuid not null references public.profiles(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','monitoring','closed')),
  owner_id   uuid references public.profiles(id) on delete set null,
  reasons    text[] not null default '{}',
  plan       text,
  opened_by  uuid references public.profiles(id) on delete set null,
  opened_at  timestamptz not null default now(),
  closed_at  timestamptz,
  outcome    text
);
create unique index if not exists ew_cases_one_active on public.ew_cases(student_id) where status <> 'closed';

create table if not exists public.ew_actions (
  id         bigserial primary key,
  case_id    bigint not null references public.ew_cases(id) on delete cascade,
  kind       text not null check (kind in ('parent_call','parent_meeting','student_meeting','counseling','teacher_note','referral','other')),
  body       text not null check (btrim(body) <> ''),
  by_id      uuid references public.profiles(id) on delete set null,
  at         timestamptz not null default now()
);

alter table public.ew_cases enable row level security;
alter table public.ew_actions enable row level security;
revoke all on public.ew_cases, public.ew_actions from anon, authenticated;

-- الإعدادات (عتبات الإنذار) — قيم افتراضية قابلة للتعديل من لوحة الإنذار
create or replace function private.ew_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('days', 30, 'abs', jsonb_build_array(3, 5), 'late', jsonb_build_array(3, 6),
                            'neg', jsonb_build_array(2, 4), 'hw', jsonb_build_array(3, 5), 'ex', jsonb_build_array(65, 50))
         || coalesce((select value from app_settings where key = 'early_warning'), '{}'::jsonb)
$$;

-- الطلاب الذين يراهم المستخدم في الإنذار المبكر:
-- الإدارة كلها، مدير/وكيل/موجّه المرحلة لمراحله، ورائد الفصل لفصله
create or replace function private.ew_scope() returns table(student_id uuid)
language sql stable security definer set search_path = public, private as $$
  with z as materialized (select private.bh_manager() bm, private.my_stage_ids() ms, public.me_role()::text r, public.me_id() me, public.is_staff() st)
  select s.profile_id from z, students s join grades g on g.id = s.grade_id join profiles p on p.id = s.profile_id and p.active
   where z.st and (z.r in ('admin','leadership') or (z.bm and g.stage_id = any (z.ms))
      or s.class_id in (select id from classes where homeroom_teacher_id = z.me))
$$;

create or replace function private.ew_can(p_student uuid) returns boolean
language sql stable security definer set search_path = public, private as $$
  select exists (select 1 from private.ew_scope() where student_id = p_student)
      or exists (select 1 from ew_cases where student_id = p_student and owner_id = public.me_id() and status <> 'closed')
$$;

-- المؤشرات لكل طالب ضمن النطاق خلال آخر N يوم
create or replace function private.ew_metrics(p_days int, p_student uuid default null)
returns table(student_id uuid, abs int, late int, neg int, hw_miss int, ex_avg numeric, ex_n int)
language sql stable security definer set search_path = public, private as $$
  -- مع p_student: الطالب نفسه (الصلاحية يتحقق منها المستدعي ew_can)
  with sc as (select p_student as student_id where p_student is not null
              union all select x.student_id from private.ew_scope() x where p_student is null),
  f as (select current_date - p_days as d0),
  att as (select m.student_id, count(distinct a.day) filter (where m.status = 'absent') ab, count(distinct a.day) filter (where m.status = 'late') lt
            from attendance_marks m join attendance_sessions a on a.id = m.session_id, f
           where a.period = 0 and a.day >= f.d0 and m.student_id in (select student_id from sc) group by 1),
  bh as (select n.student_id, count(*) c from bh_notes n, f
          where n.kind = 'negative' and n.note_date >= f.d0 and n.student_id in (select student_id from sc) group by 1),
  hw as (select s.profile_id student_id, count(*) c
           from students s join hw_assignments h on s.class_id = any (h.class_ids), f
          where s.profile_id in (select student_id from sc) and h.due_at >= f.d0 and h.due_at < now()
            and not exists (select 1 from hw_submissions x where x.hw_id = h.id and x.student_id = s.profile_id) group by 1),
  ex as (select a.student_id, round(avg(a.score * 100 / nullif(a.max_score, 0)), 1) av, count(*) n
           from ex_attempts a, f where a.submitted_at >= f.d0 and a.score is not null and a.max_score > 0
            and a.student_id in (select student_id from sc) group by 1)
  select sc.student_id, coalesce(att.ab, 0)::int, coalesce(att.lt, 0)::int, coalesce(bh.c, 0)::int, coalesce(hw.c, 0)::int, ex.av, coalesce(ex.n, 0)::int
    from sc left join att using (student_id) left join bh using (student_id) left join hw using (student_id) left join ex using (student_id)
$$;

-- مستوى المؤشر: 0 سليم، 1 تنبيه، 2 خطر
create or replace function private.ew_lv(v numeric, th jsonb, p_low boolean default false) returns int
language sql immutable as $$
  select case when v is null then 0
              when not p_low and v >= (th->>1)::numeric then 2 when not p_low and v >= (th->>0)::numeric then 1
              when p_low and v < (th->>1)::numeric then 2 when p_low and v < (th->>0)::numeric then 1 else 0 end
$$;

create or replace function private.ew_row(m record, cfg jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare la int; ll int; ln int; lh int; le int; tot int; lvl text; c ew_cases; rs text[] := '{}';
begin
  la := private.ew_lv(m.abs, cfg->'abs'); ll := private.ew_lv(m.late, cfg->'late'); ln := private.ew_lv(m.neg, cfg->'neg');
  lh := private.ew_lv(m.hw_miss, cfg->'hw'); le := case when m.ex_n >= 2 then private.ew_lv(m.ex_avg, cfg->'ex', true) else 0 end;
  tot := la + ll + ln + lh + le;
  lvl := case when greatest(la, ll, ln, lh, le) = 2 or tot >= 3 then 'red' when tot >= 1 then 'yellow' else 'green' end;
  if la > 0 then rs := rs || 'الغياب'::text; end if; if ll > 0 then rs := rs || 'التأخر'::text; end if; if ln > 0 then rs := rs || 'السلوك'::text; end if;
  if lh > 0 then rs := rs || 'الواجبات'::text; end if; if le > 0 then rs := rs || 'التحصيل'::text; end if;
  select * into c from ew_cases where student_id = m.student_id and status <> 'closed';
  return jsonb_build_object('id', m.student_id, 'abs', m.abs, 'late', m.late, 'neg', m.neg, 'hw', m.hw_miss, 'ex', m.ex_avg, 'ex_n', m.ex_n,
    'lv', jsonb_build_object('abs', la, 'late', ll, 'neg', ln, 'hw', lh, 'ex', le), 'score', tot, 'level', lvl, 'reasons', rs,
    'case', case when c.id is null then null else jsonb_build_object('id', c.id, 'status', c.status, 'owner', (select full_name from profiles where id = c.owner_id)) end);
end $$;

-- القائمة: الطلاب في مستوى تنبيه/خطر + من لديهم حالة مفتوحة
create or replace function public.ew_list(p_days int default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare cfg jsonb := private.ew_cfg(); d int; out jsonb;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  d := coalesce(p_days, (cfg->>'days')::int, 30);
  select coalesce(jsonb_agg(r || jsonb_build_object('name', p.full_name, 'class', vc.label, 'stage_id', vc.stage_id, 'grade_id', s.grade_id)
           order by (r->>'level') = 'red' desc, (r->>'score')::int desc, p.full_name), '[]'::jsonb)
    into out
    from (select private.ew_row(m, cfg) r from private.ew_metrics(d) m
           where m.abs + m.late + m.neg + m.hw_miss > 0 or m.ex_n >= 2
              or exists (select 1 from ew_cases c where c.student_id = m.student_id and c.status <> 'closed')) x
    join profiles p on p.id = (x.r->>'id')::uuid
    join students s on s.profile_id = p.id
    left join v_classes vc on vc.id = s.class_id
   where x.r->>'level' <> 'green' or x.r->'case' <> 'null'::jsonb;
  return jsonb_build_object('cfg', cfg, 'days', d, 'scope', (select count(*) from private.ew_scope()), 'rows', out,
    'can_cfg', public.me_role() in ('admin','leadership'),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name_ar) order by sort), '[]'::jsonb) from stages));
end $$;

-- ملف الطالب في الإنذار المبكر
create or replace function public.ew_student(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare cfg jsonb := private.ew_cfg(); d int := (cfg->>'days')::int; r jsonb; f date := current_date - (cfg->>'days')::int;
begin
  if not private.ew_can(p_student) then raise exception 'غير مصرح'; end if;
  select private.ew_row(m, cfg) into r from private.ew_metrics(d, p_student) m;
  return r || jsonb_build_object(
    'name', (select full_name from profiles where id = p_student),
    'class', (select vc.label from students s join v_classes vc on vc.id = s.class_id where s.profile_id = p_student),
    'guardian', (select jsonb_build_object('name', guardian_name, 'phone', guardian_phone) from students where profile_id = p_student),
    'absences', coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 's', m.status, 'n', m.note) order by a.day desc)
        from attendance_marks m join attendance_sessions a on a.id = m.session_id
       where m.student_id = p_student and a.period = 0 and a.day >= f and m.status in ('absent','late')), '[]'::jsonb),
    'behavior', coalesce((select jsonb_agg(jsonb_build_object('d', n.note_date, 't', n.text, 'g', n.degree) order by n.note_date desc)
        from bh_notes n where n.student_id = p_student and n.kind = 'negative' and n.note_date >= f), '[]'::jsonb),
    'hw', coalesce((select jsonb_agg(jsonb_build_object('t', h.title, 'd', (h.due_at at time zone 'Asia/Riyadh')::date, 'sub', (select name_ar from subjects where id = h.subject_id)) order by h.due_at desc)
        from students s join hw_assignments h on s.class_id = any (h.class_ids)
       where s.profile_id = p_student and h.due_at >= f and h.due_at < now()
         and not exists (select 1 from hw_submissions x where x.hw_id = h.id and x.student_id = p_student)), '[]'::jsonb),
    'exams', coalesce((select jsonb_agg(jsonb_build_object('t', e.title, 'pct', round(a.score * 100 / nullif(a.max_score, 0)), 'sub', (select name_ar from subjects where id = e.subject_id)) order by a.submitted_at desc)
        from ex_attempts a join ex_exams e on e.id = a.exam_id where a.student_id = p_student and a.submitted_at >= f and a.score is not null), '[]'::jsonb),
    'cases', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'reasons', c.reasons, 'plan', c.plan, 'outcome', c.outcome,
        'owner_id', c.owner_id, 'owner', (select full_name from profiles where id = c.owner_id), 'opened_by', (select full_name from profiles where id = c.opened_by),
        'opened_at', c.opened_at, 'closed_at', c.closed_at,
        'actions', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'body', x.body, 'by', (select full_name from profiles where id = x.by_id), 'at', x.at) order by x.at desc)
                    from ew_actions x where x.case_id = c.id), '[]'::jsonb)) order by c.opened_at desc)
        from ew_cases c where c.student_id = p_student), '[]'::jsonb),
    'owners', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.full_name, 'job', p.job_title) order by p.full_name)
        from profiles p where p.id = any (private.bh_responsible(p_student) ||
              (select array_agg(homeroom_teacher_id) from classes c join students s on s.class_id = c.id where s.profile_id = p_student and c.homeroom_teacher_id is not null))), '[]'::jsonb));
end $$;

-- فتح حالة متابعة (أو تعديل خطتها/مسؤولها)
create or replace function public.ew_case_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare sid uuid := (p->>'student_id')::uuid; cid bigint := nullif(p->>'id', '')::bigint; own uuid := nullif(p->>'owner_id', '')::uuid; mid bigint; old uuid;
  rs text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(p->'reasons') x), '{}');
begin
  if cid is not null then select student_id, owner_id into sid, old from ew_cases where id = cid; end if;
  if sid is null or not private.ew_can(sid) then raise exception 'غير مصرح'; end if;
  if cid is null then
    if exists (select 1 from ew_cases where student_id = sid and status <> 'closed') then raise exception 'للطالب حالة متابعة مفتوحة بالفعل'; end if;
    insert into ew_cases(student_id, owner_id, reasons, plan, opened_by)
    values (sid, coalesce(own, public.me_id()), rs, nullif(btrim(p->>'plan'), ''), public.me_id()) returning id into cid;
  else
    update ew_cases set owner_id = coalesce(own, owner_id), plan = nullif(btrim(p->>'plan'), ''), reasons = case when cardinality(rs) > 0 then rs else reasons end where id = cid;
  end if;
  own := (select owner_id from ew_cases where id = cid);
  if own is distinct from public.me_id() and own is distinct from old then
    insert into messages(kind, sender_id, subject, body, audience)
    values ('mail', public.me_id(), left('⚠️ حالة إنذار مبكر: ' || (select full_name from profiles where id = sid), 200),
            'أُسندت إليك متابعة الطالب: ' || (select full_name from profiles where id = sid) ||
            coalesce(' — ' || (select vc.label from students s join v_classes vc on vc.id = s.class_id where s.profile_id = sid), '') ||
            E'\nأسباب الإنذار: ' || coalesce(array_to_string((select reasons from ew_cases where id = cid), '، '), '—') ||
            coalesce(E'\nالخطة: ' || (select plan from ew_cases where id = cid), '') ||
            E'\n\nالمنصة ← الإنذار المبكر ← حالاتي', 'الإنذار المبكر') returning id into mid;
    insert into message_recipients(message_id, profile_id) values (mid, own) on conflict do nothing;
  end if;
  return cid;
end $$;

-- إضافة إجراء، وتغيير الحالة (متابعة/إغلاق)
create or replace function public.ew_action_add(p_case bigint, p_kind text, p_body text, p_status text default null, p_outcome text default null) returns void
language plpgsql security definer set search_path = public, private as $$
declare c ew_cases;
begin
  select * into c from ew_cases where id = p_case;
  if c.id is null or not private.ew_can(c.student_id) then raise exception 'غير مصرح'; end if;
  if nullif(btrim(p_body), '') is not null then
    insert into ew_actions(case_id, kind, body, by_id) values (p_case, coalesce(p_kind, 'other'), btrim(p_body), public.me_id());
  end if;
  if p_status in ('open','monitoring','closed') and p_status <> c.status then
    update ew_cases set status = p_status, closed_at = case when p_status = 'closed' then now() end,
           outcome = case when p_status = 'closed' then coalesce(nullif(btrim(p_outcome), ''), outcome) else outcome end where id = p_case;
  end if;
end $$;

create or replace function public.ew_action_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  delete from ew_actions x where x.id = p_id and (x.by_id = public.me_id() or public.me_role() in ('admin','leadership'));
end $$;

-- حالاتي (المسندة إليّ) + كل الحالات المفتوحة في نطاقي
create or replace function public.ew_cases_list(p_mine boolean default true) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'student_id', c.student_id, 'name', p.full_name, 'class', vc.label, 'status', c.status,
           'reasons', c.reasons, 'owner', (select full_name from profiles where id = c.owner_id), 'opened_at', c.opened_at,
           'last', (select max(at) from ew_actions where case_id = c.id), 'n', (select count(*) from ew_actions where case_id = c.id))
           order by c.status, c.opened_at desc), '[]'::jsonb)
    from ew_cases c join profiles p on p.id = c.student_id left join students s on s.profile_id = c.student_id left join v_classes vc on vc.id = s.class_id
   where c.status <> 'closed' and (case when p_mine then c.owner_id = public.me_id() else private.ew_can(c.student_id) end)
$$;

create or replace function public.ew_settings_set(p jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := '{}'::jsonb; k text;
begin
  if public.me_role() not in ('admin','leadership') then raise exception 'للإدارة فقط'; end if;
  if (p->>'days')::int between 7 and 180 then v := v || jsonb_build_object('days', (p->>'days')::int); end if;
  foreach k in array array['abs','late','neg','hw','ex'] loop
    if jsonb_typeof(p->k) = 'array' and jsonb_array_length(p->k) = 2 then
      v := v || jsonb_build_object(k, jsonb_build_array((p->k->>0)::numeric, (p->k->>1)::numeric));
    end if;
  end loop;
  insert into app_settings(key, value) values ('early_warning', v)
  on conflict (key) do update set value = coalesce(app_settings.value, '{}'::jsonb) || excluded.value;
end $$;

revoke all on function private.ew_cfg(), private.ew_scope(), private.ew_can(uuid), private.ew_metrics(int, uuid), private.ew_row(record, jsonb) from public, anon, authenticated;
revoke all on function public.ew_list(int), public.ew_student(uuid), public.ew_case_save(jsonb), public.ew_action_add(bigint, text, text, text, text),
  public.ew_action_delete(bigint), public.ew_cases_list(boolean), public.ew_settings_set(jsonb) from public, anon;
grant execute on function public.ew_list(int), public.ew_student(uuid), public.ew_case_save(jsonb), public.ew_action_add(bigint, text, text, text, text),
  public.ew_action_delete(bigint), public.ew_cases_list(boolean), public.ew_settings_set(jsonb) to authenticated;

-- «مهامي»: حالات الإنذار المبكر
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
  return out;
end $$;
