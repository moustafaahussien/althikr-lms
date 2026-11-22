-- =====================================================================
-- 28) لوحة «يومي» في الرئيسية: هل سُجّل حضور كل حصة من حصص المعلم اليوم؟
--     تُعيد حصص المعلم اليوم (من جدول الحصص) مع taken = true إذا سُجّل حضور تلك الحصة
--     لفصلها (أو لصفها كله) في نفس اليوم. التاريخ بتوقيت الرياض.
--     تشغيل الملف مرة ثانية آمن.
-- =====================================================================
create or replace function public.att_today_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select (now() at time zone 'Asia/Riyadh')::date as day),
  sl as (
    select distinct s.period, s.class_id, c.grade_id
    from tt_slots s join classes c on c.id = s.class_id, d
    where s.teacher_id = public.me_id() and s.kind = 'class' and s.period > 0
      and s.day = extract(dow from d.day)::int)
  select coalesce(jsonb_agg(jsonb_build_object(
           'period', sl.period, 'class_id', sl.class_id,
           'taken', exists (select 1 from attendance_sessions a, d
                            where a.day = d.day and a.grade_id = sl.grade_id and a.period = sl.period
                              and (a.class_id = sl.class_id or a.class_id is null)))
         order by sl.period), '[]'::jsonb)
  from sl
$$;
revoke execute on function public.att_today_mine() from public, anon;
grant execute on function public.att_today_mine() to authenticated;
