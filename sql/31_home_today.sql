-- 31: لوحة «يومي» في طلب واحد بدل أربعة (حصصي اليوم + عدد المعاملات الواردة + حالة الحضور + مناوبتي)
-- security invoker: تعمل بصلاحيات المستخدم نفسه، فتطبّق نفس سياسات RLS ونفس فحوص الدوال الأصلية —
-- لا تكشف شيئًا لم يكن المستخدم يستطيع قراءته بالطلبات المنفصلة.
create or replace function public.home_today(p_day smallint default null, p_att boolean default false)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'tt', case when p_day is null then '[]'::jsonb else coalesce((
            select jsonb_agg(jsonb_build_object('day', t.day, 'period', t.period, 'cls', t.cls, 'class_id', t.class_id,
                                                'subject_id', t.subject_id, 'txt', t.txt))
            from public.v_timetable t
            where t.teacher_id = (select public.me_id()) and t.kind = 'class' and t.day = p_day), '[]'::jsonb) end,
    'inbox', coalesce(jsonb_array_length(public.req_list('inbox')), 0),
    'att', case when p_att then public.att_today_mine() end,
    'duty', public.duty_today()
  );
$$;

revoke all on function public.home_today(smallint, boolean) from public, anon;
grant execute on function public.home_today(smallint, boolean) to authenticated;
