-- ============================================================
-- 70) العيادة المدرسية — صلاحيات مشددة
-- • الممرض/الطبيب (حسب المسمى الوظيفي) + مدير النظام: كامل البيانات.
-- • المعلمون: يرون فقط «التنبيهات الصحية» التي قرر الممرض مشاركتها لطلاب فصولهم (مثل الحساسية وخطة الطوارئ).
-- • ولي الأمر: يرى زيارات ابنه التي اختار الممرض إبلاغه بها.
-- ============================================================

create table if not exists public.cl_conditions (
  id          bigserial primary key,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  kind        text not null default 'chronic' check (kind in ('allergy','chronic','medication','disability','other')),
  title       text not null check (btrim(title) <> ''),
  details     text,
  emergency   text,
  share_staff boolean not null default false,
  active      boolean not null default true,
  by_id       uuid references public.profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists cl_cond_st on public.cl_conditions(student_id);

create table if not exists public.cl_visits (
  id          bigserial primary key,
  student_id  uuid not null references public.profiles(id) on delete cascade,
  visited_at  timestamptz not null default now(),
  complaint   text not null check (btrim(complaint) <> ''),
  temp        numeric(4,1),
  action      text not null default 'first_aid' check (action in ('rest','first_aid','medication','returned','sent_home','hospital','parent_called')),
  notes       text,
  to_parent   boolean not null default false,
  by_id       uuid references public.profiles(id) on delete set null
);
create index if not exists cl_visits_st on public.cl_visits(student_id, visited_at desc);

alter table public.cl_conditions enable row level security; alter table public.cl_visits enable row level security;
revoke all on public.cl_conditions, public.cl_visits from anon, authenticated;

create or replace function private.cl_nurse() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role = 'admin' or coalesce(p.job_title,'') ~ '(ممرض|ممرضة|طبيب|طبيبة|صحي|صحية|عيادة|الصحة المدرسية)'))
$$;

create or replace function private.cl_action_label(a text) returns text language sql immutable as $$
  select case a when 'rest' then 'راحة في العيادة' when 'first_aid' then 'إسعافات أولية' when 'medication' then 'إعطاء دواء'
    when 'returned' then 'عاد للفصل' when 'sent_home' then 'خرج مع ولي الأمر' when 'hospital' then 'تحويل للمستشفى' when 'parent_called' then 'تم الاتصال بولي الأمر' else a end
$$;

-- ---------- الممرض ----------
create or replace function public.cl_search(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare q text := public.norm(nullif(btrim(coalesce(p_q, '')), ''));
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  if q is null or length(q) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', p.id, 'name', p.full_name, 'no', s.student_number, 'class', vc.label,
           'flags', (select count(*) from cl_conditions c where c.student_id = p.id and c.active)) x
      from students s join profiles p on p.id = s.profile_id and p.active left join v_classes vc on vc.id = s.class_id
     where public.norm(p.full_name) like '%' || q || '%' or s.student_number = btrim(p_q) order by p.full_name limit 30) z), '[]'::jsonb);
end $$;

create or replace function public.cl_student(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  return jsonb_build_object('id', p_id, 'name', (select full_name from profiles where id = p_id),
    'class', (select vc.label from students s join v_classes vc on vc.id = s.class_id where s.profile_id = p_id),
    'guardian', (select jsonb_build_object('name', guardian_name, 'phone', guardian_phone) from students where profile_id = p_id),
    'guardians', coalesce((select jsonb_agg(jsonb_build_object('name', g.name, 'phone', g.phone)) from guardian_students gs join guardians g on g.id = gs.guardian_id where gs.student_id = p_id), '[]'::jsonb),
    'conditions', coalesce((select jsonb_agg(to_jsonb(c) - 'by_id' order by c.active desc, c.kind) from cl_conditions c where c.student_id = p_id), '[]'::jsonb),
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'at', v.visited_at, 'complaint', v.complaint, 'temp', v.temp, 'action', v.action,
                'action_label', private.cl_action_label(v.action), 'notes', v.notes, 'to_parent', v.to_parent, 'by', (select full_name from profiles where id = v.by_id)) order by v.visited_at desc)
                from cl_visits v where v.student_id = p_id), '[]'::jsonb));
end $$;

-- تسجيل زيارة (+ إشعار رائد الفصل عند خروج الطالب أو تحويله)
create or replace function public.cl_visit_add(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare vid bigint; sid uuid := (p->>'student_id')::uuid; a text := coalesce(nullif(p->>'action', ''), 'first_aid'); hr uuid; mid bigint;
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  insert into cl_visits(student_id, visited_at, complaint, temp, action, notes, to_parent, by_id)
  values (sid, coalesce(nullif(p->>'at', '')::timestamptz, now()), btrim(p->>'complaint'), nullif(p->>'temp', '')::numeric, a,
          nullif(btrim(p->>'notes'), ''), coalesce((p->>'to_parent')::boolean, false), public.me_id()) returning id into vid;
  if a in ('sent_home','hospital') or coalesce((p->>'notify_teacher')::boolean, false) then
    select c.homeroom_teacher_id into hr from students s join classes c on c.id = s.class_id where s.profile_id = sid;
    if hr is not null then
      insert into messages(kind, sender_id, subject, body, audience)
      values ('mail', public.me_id(), left('🩺 العيادة: ' || (select full_name from profiles where id = sid), 200),
              'الطالب ' || (select full_name from profiles where id = sid) || ' — ' || private.cl_action_label(a) || '.' ||
              E'\n(تفاصيل الحالة الصحية سرية لدى العيادة)', 'العيادة المدرسية') returning id into mid;
      insert into message_recipients(message_id, profile_id) values (mid, hr) on conflict do nothing;
    end if;
  end if;
  return vid;
end $$;

create or replace function public.cl_visit_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.cl_nurse() then raise exception 'غير مصرح'; end if;
  delete from cl_visits where id = p_id and (by_id = public.me_id() or public.me_role() = 'admin');
end $$;

create or replace function public.cl_condition_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare cid bigint := nullif(p->>'id', '')::bigint;
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  if cid is null then
    insert into cl_conditions(student_id, kind, title, details, emergency, share_staff, by_id)
    values ((p->>'student_id')::uuid, coalesce(nullif(p->>'kind', ''), 'chronic'), btrim(p->>'title'), nullif(btrim(p->>'details'), ''),
            nullif(btrim(p->>'emergency'), ''), coalesce((p->>'share_staff')::boolean, false), public.me_id()) returning id into cid;
  else
    update cl_conditions set kind = coalesce(nullif(p->>'kind', ''), kind), title = btrim(p->>'title'), details = nullif(btrim(p->>'details'), ''),
           emergency = nullif(btrim(p->>'emergency'), ''), share_staff = coalesce((p->>'share_staff')::boolean, share_staff),
           active = coalesce((p->>'active')::boolean, active), by_id = public.me_id(), updated_at = now() where id = cid;
  end if;
  return cid;
end $$;

create or replace function public.cl_today(p_day date default current_date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'student_id', v.student_id, 'name', p.full_name, 'class', vc.label,
           'time', to_char(v.visited_at at time zone 'Asia/Riyadh', 'HH24:MI'), 'complaint', v.complaint, 'temp', v.temp, 'action', private.cl_action_label(v.action)) order by v.visited_at desc)
    from cl_visits v join profiles p on p.id = v.student_id left join students s on s.profile_id = v.student_id left join v_classes vc on vc.id = s.class_id
   where (v.visited_at at time zone 'Asia/Riyadh')::date = p_day), '[]'::jsonb);
end $$;

create or replace function public.cl_stats(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.cl_nurse() then raise exception 'للعيادة المدرسية فقط'; end if;
  return jsonb_build_object(
    'visits', (select count(*) from cl_visits where (visited_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    'students', (select count(distinct student_id) from cl_visits where (visited_at at time zone 'Asia/Riyadh')::date between p_from and p_to),
    'by_action', coalesce((select jsonb_object_agg(private.cl_action_label(action), n) from (select action, count(*) n from cl_visits
                  where (visited_at at time zone 'Asia/Riyadh')::date between p_from and p_to group by 1) x), '{}'::jsonb),
    'top', coalesce((select jsonb_agg(jsonb_build_object('id', x.student_id, 'name', p.full_name, 'n', x.n) order by x.n desc) from (select student_id, count(*) n from cl_visits
                  where (visited_at at time zone 'Asia/Riyadh')::date between p_from and p_to group by 1 order by 2 desc limit 15) x join profiles p on p.id = x.student_id), '[]'::jsonb),
    'conditions', (select count(*) from cl_conditions where active), 'shared', (select count(*) from cl_conditions where active and share_staff));
end $$;

-- ---------- المعلم: التنبيهات الصحية المشارَكة لطلاب فصوله ----------
create or replace function public.cl_alerts() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', p.full_name, 'class', vc.label, 'kind', c.kind, 'title', c.title, 'emergency', c.emergency) order by vc.label, p.full_name), '[]'::jsonb)
    from cl_conditions c join students s on s.profile_id = c.student_id join profiles p on p.id = s.profile_id and p.active
    join v_classes vc on vc.id = s.class_id
   where c.active and c.share_staff and public.is_staff()
     and (private.cl_nurse() or s.class_id in (select class_id from teaching_assignments where teacher_id = public.me_id())
          or s.class_id in (select id from classes where homeroom_teacher_id = public.me_id())
          or (public.me_role() in ('leadership','principal') and vc.stage_id = any (private.my_stage_ids())))
$$;

create or replace function public.cl_am_nurse() returns boolean language sql stable security definer set search_path = public, private as $$ select private.cl_nurse() $$;

-- ---------- ولي الأمر: زيارات ابنه التي أُبلغ بها (تُضاف لملخص الابن) ----------
create or replace function private.cl_child(p_student uuid) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', v.visited_at, 'complaint', v.complaint, 'action', private.cl_action_label(v.action), 'notes', v.notes) order by v.visited_at desc), '[]'::jsonb)
    from cl_visits v where v.student_id = p_student and v.to_parent and v.visited_at > now() - interval '60 days'
$$;

revoke all on function private.cl_nurse(), private.cl_action_label(text), private.cl_child(uuid) from public, anon, authenticated;
revoke all on function public.cl_search(text), public.cl_student(uuid), public.cl_visit_add(jsonb), public.cl_visit_delete(bigint), public.cl_condition_save(jsonb),
  public.cl_today(date), public.cl_stats(date, date), public.cl_alerts(), public.cl_am_nurse() from public, anon;
grant execute on function public.cl_search(text), public.cl_student(uuid), public.cl_visit_add(jsonb), public.cl_visit_delete(bigint), public.cl_condition_save(jsonb),
  public.cl_today(date), public.cl_stats(date, date), public.cl_alerts(), public.cl_am_nurse() to authenticated;
