-- أداة: تقيس سرعة قراءة الجداول الأساسية وتقارن ما يراه كل دور قبل وبعد تطبيق sql/30 (كل شيء يُتراجع عنه)
-- ملاحظة: احذف أسطر create index من النص المضمَّن قبل التشغيل (لا تُنشأ فهارس وجدول قيد القراءة في نفس الجلسة)
create or replace function pg_temp.private_perf_measure() returns jsonb language plpgsql as $m$
declare t0 timestamptz; r jsonb := '{}'; q record; h text; ms numeric;
begin
  execute 'set local role authenticated';
  for q in select * from (values
     ('profiles','select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.profiles'),
     ('students','select md5(coalesce(string_agg(profile_id::text, '','' order by profile_id), '''')) from public.students'),
     ('parent_links','select md5(coalesce(string_agg(parent_id::text||student_id::text, '','' order by parent_id, student_id), '''')) from public.parent_links'),
     ('ta','select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.teaching_assignments'),
     ('classes','select md5(coalesce(string_agg(id::text, '','' order by id), '''')) from public.classes'),
     ('v_students','select md5(coalesce(string_agg(profile_id::text, '','' order by profile_id), '''')) from public.v_students')) y(k, sql) loop
    t0 := clock_timestamp();
    begin execute q.sql into h; exception when others then h := 'ERR ' || left(sqlerrm, 60); end;
    ms := round(extract(epoch from clock_timestamp() - t0) * 1000);
    r := r || jsonb_build_object(q.k, left(h, 8) || '/' || ms || 'ms');
  end loop;
  execute 'reset role';
  return r;
end $m$;
create temp table if not exists perf2 (who text, res text); truncate perf2;
do $t$
declare
  mig text := $mig$
create or replace function public.my_visible_class_ids() returns setof integer
language plpgsql stable security definer set search_path = public as $f$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null then return; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return query select id from classes; return; end if;
  if r = 'student' then return query select class_id from students where profile_id = me and class_id is not null; return; end if;
  if r = 'parent' then
    return query select distinct s.class_id from parent_links pl join students s on s.profile_id = pl.student_id
                 where pl.parent_id = me and s.class_id is not null;
    return;
  end if;
  return query
    select ta.class_id from teaching_assignments ta where ta.teacher_id = me and ta.class_id is not null
    union select c.id from classes c where c.homeroom_teacher_id = me
    union
    select c.id
    from staff_scopes sc
    join stages st on (sc.section_id is null or sc.section_id = st.section_id) and (sc.stage_id is null or sc.stage_id = st.id)
    join grades g on g.stage_id = st.id
                 and (sc.grade_min is null or g.number >= sc.grade_min)
                 and (sc.grade_max is null or g.number <= sc.grade_max)
    join classes c on c.grade_id = g.id
    where sc.profile_id = me
      and (sc.subject_id is null or exists (select 1 from teaching_assignments ta
                                             where ta.class_id = c.id and ta.subject_id = sc.subject_id));
end $f$;

create or replace function public.my_visible_student_ids() returns setof uuid
language plpgsql stable security definer set search_path = public as $f$
declare me uuid := public.me_id(); r public.user_role;
begin
  if me is null then return; end if;
  select role into r from profiles where id = me;
  if r in ('admin','leadership') then return query select profile_id from students; return; end if;
  if r = 'student' then return query select me; return; end if;
  if r = 'parent' then return query select student_id from parent_links where parent_id = me; return; end if;
  return query
    select s.profile_id from students s
    where s.class_id is not null and s.class_id in (select public.my_visible_class_ids())
    union
    select s.profile_id from students s
    join grades g on g.id = s.grade_id
    join stages st on st.id = g.stage_id
    where s.class_id is null and exists (
      select 1 from staff_scopes sc
      where sc.profile_id = me and sc.subject_id is null
        and (sc.section_id is null or sc.section_id = st.section_id)
        and (sc.stage_id   is null or sc.stage_id   = st.id)
        and (sc.grade_min  is null or g.number >= sc.grade_min)
        and (sc.grade_max  is null or g.number <= sc.grade_max));
end $f$;

revoke execute on function public.my_visible_class_ids() from public, anon;
revoke execute on function public.my_visible_student_ids() from public, anon;
grant execute on function public.my_visible_class_ids() to authenticated;
grant execute on function public.my_visible_student_ids() to authenticated;

drop policy if exists read_profiles on public.profiles;
create policy read_profiles on public.profiles for select to authenticated using (
  (select public.me_id()) is not null and (
       id = (select public.me_id())
    or (select public.me_role()) in ('admin','leadership')
    or role not in ('student','parent')
    or (role = 'student' and id in (select public.my_visible_student_ids()))
    or (role = 'parent' and (select public.me_role()) not in ('student','parent')
        and exists (select 1 from parent_links pl
                    where pl.parent_id = profiles.id
                      and pl.student_id in (select public.my_visible_student_ids())))));

drop policy if exists read_students on public.students;
create policy read_students on public.students for select to authenticated
  using (profile_id in (select public.my_visible_student_ids()));

drop policy if exists read_parent_links on public.parent_links;
create policy read_parent_links on public.parent_links for select to authenticated
  using (parent_id = (select public.me_id()) or student_id in (select public.my_visible_student_ids()));

drop policy if exists read_ta on public.teaching_assignments;
create policy read_ta on public.teaching_assignments for select to authenticated
  using (teacher_id = (select public.me_id()) or class_id in (select public.my_visible_class_ids()));

drop policy if exists read_classes on public.classes;
create policy read_classes on public.classes for select to authenticated
  using (id in (select public.my_visible_class_ids()));

do $$ declare p record; q text; c text; sql text; begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where schemaname = 'public' loop
    q := p.qual; c := p.with_check;
    if q is not null and q !~* 'select\s+(public\.)?(me_id|is_admin|is_staff|is_leader|can_manage_school|me_role)\(\)' then
      q := regexp_replace(q, '(public\.)?\m(me_id|is_admin|is_staff|is_leader|can_manage_school|me_role)\(\)', '(SELECT public.\2())', 'g');
    end if;
    if c is not null and c !~* 'select\s+(public\.)?(me_id|is_admin|is_staff|is_leader|can_manage_school|me_role)\(\)' then
      c := regexp_replace(c, '(public\.)?\m(me_id|is_admin|is_staff|is_leader|can_manage_school|me_role)\(\)', '(SELECT public.\2())', 'g');
    end if;
    if q is distinct from p.qual or c is distinct from p.with_check then
      sql := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
      if q is not null then sql := sql || format(' using (%s)', q); end if;
      if c is not null then sql := sql || format(' with check (%s)', c); end if;
      execute sql;
    end if;
  end loop;
end $$;

create index if not exists parent_links_student_idx      on public.parent_links(student_id);
create index if not exists classes_homeroom_idx          on public.classes(homeroom_teacher_id);
create index if not exists staff_aliases_profile_idx     on public.staff_aliases(profile_id);
create index if not exists attendance_sessions_class_idx on public.attendance_sessions(class_id);
create index if not exists complaints_submitter_idx      on public.complaints(submitter_id);
create index if not exists complaints_student_idx        on public.complaints(student_id);
create index if not exists complaints_teacher_idx        on public.complaints(teacher_id);
create index if not exists complaint_updates_c_idx       on public.complaint_updates(complaint_id);
create index if not exists requests_requester_idx        on public.requests(requester_id);
create index if not exists request_steps_approver_idx    on public.request_steps(approver_id);
create index if not exists messages_parent_idx           on public.messages(parent_id);
create index if not exists guardian_codes_guardian_idx   on public.guardian_codes(guardian_id);
create index if not exists guardian_sessions_guardian_idx on public.guardian_sessions(guardian_id);
create index if not exists duty_slots_staff_idx          on public.duty_slots(staff_id);
create index if not exists tt_slots_day_idx              on public.tt_slots(teacher_id, day);
$mig$;
  c record; o jsonb; n jsonb;
  function_body text;
begin
  for c in select * from (values
     ('admin',      (select email from profiles where role='admin' and active and email is not null limit 1)),
     ('teacher',    (select p.email from profiles p where p.role='teacher' and p.active and p.email is not null and exists (select 1 from teaching_assignments ta where ta.teacher_id=p.id) limit 1)),
     ('homeroom',   (select p.email from profiles p join classes c on c.homeroom_teacher_id = p.id where p.active and p.email is not null limit 1)),
     ('supervisor', (select p.email from profiles p where p.role='supervisor' and p.active and p.email is not null and exists (select 1 from staff_scopes s where s.profile_id=p.id) limit 1)),
     ('principal',  (select p.email from profiles p where p.role='principal' and p.active and p.email is not null limit 1)),
     ('staff',      (select p.email from profiles p where p.role='staff' and p.active and p.email is not null limit 1)),
     ('student',    (select p.email from profiles p join students s on s.profile_id=p.id where p.active and p.email is not null limit 1)),
     ('parent',     (select email from profiles where role='parent' and active and email is not null limit 1))
  ) x(who, em) loop
    if c.em is null then insert into perf2 values (c.who, 'no account'); continue; end if;
    begin
      insert into app_settings(key, value) values ('student_login_enabled','true'),('parent_login_enabled','true') on conflict (key) do update set value='true';
      perform set_config('request.jwt.claims', json_build_object('email', c.em, 'sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
      o := pg_temp.private_perf_measure();
      execute mig;
      n := pg_temp.private_perf_measure();
      raise exception 'R:%', jsonb_build_object('old', o, 'new', n)::text;
    exception when others then
      insert into perf2 values (c.who, case when sqlerrm like 'R:%' then substr(sqlerrm, 3) else 'ERR ' || sqlerrm end);
    end;
  end loop;
end $t$;
select string_agg(who || ' => ' || res, ' ;; ') from perf2;