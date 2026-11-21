-- =====================================================================
--  الملف 5: بريد الطلاب من رقم الهوية + مفتاح تفعيل دخول الطلاب
--  بريد الطالب = رقم الهوية@althikr.edu.sa
--  دخول الطلاب مقفول افتراضيًا ويُفتح من لوحة الإدارة ← الإعدادات
-- =====================================================================

insert into public.app_settings(key, value) values ('student_login_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public.student_login_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true'::jsonb from app_settings where key = 'student_login_enabled'), false)
$$;

create or replace function public.school_domain() returns text
language sql stable security definer set search_path = public as $$
  select lower(value->>0) from app_settings where key = 'allowed_domains'
$$;

-- المستخدم الحالي: الطالب لا يُعتبر مسجّلًا ما دام دخول الطلاب مقفولًا
create or replace function public.me_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.email = public.jwt_email() and p.active and public.email_domain_ok(p.email)
    and (p.role <> 'student' or public.student_login_enabled())
$$;

-- سياق المستخدم: يوضح سبب الرفض للطالب
create or replace function public.my_context() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); res jsonb;
begin
  if me is null then
    return jsonb_build_object('registered', false, 'email', public.jwt_email(),
      'domain_ok', public.email_domain_ok(public.jwt_email()),
      'students_closed', exists (select 1 from profiles where email = public.jwt_email()
                                   and role = 'student' and active) and not public.student_login_enabled());
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
      select jsonb_build_object('student_number', s.student_number, 'class_id', s.class_id,
                                'class_label', vs.label, 'section', vs.section_name)
      from students s left join v_students vs on vs.profile_id = s.profile_id
      where s.profile_id = me),
    'term', (select jsonb_build_object('year', y.name, 'term', t.name)
             from terms t join academic_years y on y.id = t.year_id where t.is_current limit 1)
  ) into res
  from profiles p where p.id = me;
  return res;
end $$;

-- إعطاء كل طالب بريده من رقم هويته (لمن ليس له بريد، وبشرط ألا يكون البريد مستخدمًا)
update public.profiles p
set email = lower(sp.national_id || '@' || public.school_domain())
from public.student_private sp
where sp.profile_id = p.id and p.email is null
  and not exists (select 1 from public.profiles x where x.email = lower(sp.national_id || '@' || public.school_domain()));

-- الاستيراد من نظام التسجيل: يضبط البريد تلقائيًا للطلاب الجدد ولمن ليس له بريد
create or replace function public._student_email_fill(pid uuid, nid text) returns void
language plpgsql security definer set search_path = public as $$
declare e text := lower(nid || '@' || public.school_domain());
begin
  update profiles set email = e
  where id = pid and email is null
    and not exists (select 1 from profiles where email = e and id <> pid);
end $$;
revoke execute on function public._student_email_fill(uuid, text) from public, anon, authenticated;

create or replace function public._after_private_upsert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public._student_email_fill(new.profile_id, new.national_id);
  return new;
end $$;
drop trigger if exists student_private_email on public.student_private;
create trigger student_private_email after insert or update of national_id on public.student_private
  for each row execute function public._after_private_upsert();

grant execute on function public.student_login_enabled() to authenticated;
grant execute on function public.school_domain() to authenticated;

-- بريد الطالب يحتوي رقم هويته: لا يظهر في عرض الطلاب إلا للإدارة (وللطالب نفسه)
create or replace view public.v_students with (security_invoker = true) as
select s.profile_id, s.student_number, s.class_id, s.grade_id, s.track,
       s.guardian_name, s.guardian_phone, s.notes,
       p.full_name,
       case when public.is_leader() or p.id = public.me_id() then p.email end as email,
       p.active,
       g.number as grade_number, g.name_ar as grade_name,
       st.id as stage_id, st.name_ar as stage_name, st.sort as stage_sort,
       se.name_ar as section_name,
       c.name as class_name,
       case when c.id is not null then g.name_ar || ' ' || st.name_ar || ' / ' || c.name
            when g.id is not null then g.name_ar || ' ' || st.name_ar
       end as label
from public.students s
join public.profiles p on p.id = s.profile_id
left join public.grades g on g.id = s.grade_id
left join public.stages st on st.id = g.stage_id
left join public.sections se on se.id = st.section_id
left join public.classes c on c.id = s.class_id;
grant select on public.v_students to authenticated;
