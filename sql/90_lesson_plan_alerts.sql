-- ============================================================
-- 90) تنبيهات الحصص بدون تحضير
--   • المعلم: قبل الحصة بيوم — رسالة واحدة (وإشعار جوال) بحصص يوم الدراسة القادم اللي مالهاش تحضير مُرسل
--     تُرسل بعد الساعة teacher_hour (الافتراضي 1 ظهرًا) في آخر يوم قبل يوم الدراسة (الخميس ← لحصص الأحد)
--   • مدير المرحلة والمشرف (صاحب الجدول): قبل بداية الحصة بـ minutes دقيقة (الافتراضي 10) لو لسه مافيش تحضير
--     رسالة واحدة لكل مستلم بكل الحصص اللي هتبدأ في نفس الوقت
--   • «التحضير» = خطة درس للمعلم في نفس اليوم ونفس الفصل (ونفس المادة إن وُجدت) حالتها مش «مسودة»
--   • أيام الدراسة من التقويم الدراسي (أسابيع الدراسة بدون أسابيع الاختبارات، وبدون الإجازات، الأحد–الخميس)
--   • الإعدادات: app_settings.lp_alert = {enabled, teacher, managers, minutes, teacher_hour}
-- ============================================================
create table if not exists public.lp_alert_sent (
  day     date not null,
  slot_id bigint not null,
  kind    text not null,      -- t = تنبيه المعلم، m = تنبيه المدير والمشرف، tday = علامة انتهاء تنبيهات المعلمين لليوم
  at      timestamptz not null default now(),
  primary key (day, slot_id, kind)
);
alter table public.lp_alert_sent enable row level security;
revoke all on public.lp_alert_sent from anon, authenticated;

insert into public.app_settings(key, value) values
  ('lp_alert', '{"enabled": false, "teacher": true, "managers": true, "minutes": 10, "teacher_hour": 13}'::jsonb)
on conflict (key) do nothing;
-- التقويم الدراسي 1448هـ على الخادم (نسخة من assets/js/academic-calendar.js — حدّثها مع الملف كل عام)
insert into public.app_settings(key, value) values ('acad_days', '{"weeks":["2026-08-30","2026-09-06","2026-09-13","2026-09-20","2026-09-27","2026-10-04","2026-10-11","2026-10-18","2026-10-25","2026-11-01","2026-11-08","2026-11-15","2026-11-29","2026-12-06","2026-12-13","2026-12-20","2026-12-27","2027-01-17","2027-01-24","2027-01-31","2027-02-07","2027-02-14","2027-02-21","2027-03-14","2027-03-21","2027-03-28","2027-04-04","2027-04-11","2027-04-18","2027-04-25","2027-05-23","2027-05-30","2027-06-06","2027-06-13","2027-06-20"],"hol":[["2026-09-23","2026-09-26"],["2026-11-20","2026-11-28"],["2027-01-08","2027-01-16"],["2027-02-19","2027-02-22"],["2027-02-26","2027-03-13"],["2027-04-30","2027-05-22"],["2027-07-01","2027-08-28"]]}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- هل اليوم يوم دراسة؟
create or replace function private.school_day(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select extract(dow from d) between 0 and 4
     and exists (select 1 from jsonb_array_elements_text((select value -> 'weeks' from app_settings where key = 'acad_days')) w
                  where w::date = d - extract(dow from d)::int)
     and not exists (select 1 from jsonb_array_elements((select value -> 'hol' from app_settings where key = 'acad_days')) h
                      where d between (h ->> 0)::date and (h ->> 1)::date)
$$;

-- حصص يوم معيّن من جداول المشرفين: المعلم، الفصل، المادة، المرحلة، وقت البداية
create or replace function private.lpa_slots(d date)
returns table (slot_id bigint, teacher_id uuid, period smallint, start_t text, class_id int, cls text, subject_id int,
               stage_id int, grade_number smallint, owner_id uuid, class_label text, subject_name text)
language sql stable security definer set search_path = public as $$
  select sl.id, sl.teacher_id, sl.period,
         coalesce(nullif((select sp.start_t from tt_stage ts join school_periods sp on sp.profile = ts.prof and sp.period = sl.period
                           where ts.sheet_id = sl.sheet_id and ts.track = sl.track and ts.grade_num = sl.grade_num), ''),
                  nullif((select sp.start_t from period_profile_stages pps join period_profiles pp on pp.key = pps.profile
                           join school_periods sp on sp.profile = pps.profile and sp.period = sl.period
                           where pps.stage_id = vc.stage_id order by pp.sort limit 1), '')) as start_t,
         sl.class_id, sl.cls, coalesce(sl.subject_id, tts.subject_id),
         coalesce(vc.stage_id, (select pps.stage_id from tt_stage ts join period_profile_stages pps on pps.profile = ts.prof
                                 where ts.sheet_id = sl.sheet_id and ts.track = sl.track and ts.grade_num = sl.grade_num limit 1)),
         coalesce(vc.grade_number, sl.grade_num), sh.owner_id,
         coalesce(vc.label, sl.cls), (select name_ar from subjects where id = coalesce(sl.subject_id, tts.subject_id))
  from tt_slots sl
  join tt_sheets sh on sh.id = sl.sheet_id
  join profiles t on t.id = sl.teacher_id and t.active
  left join tt_teacher_subject tts on tts.sheet_id = sl.sheet_id and tts.teacher_id = sl.teacher_id
  left join v_classes vc on vc.id = sl.class_id
  where sl.kind = 'class' and sl.teacher_id is not null and sl.day = extract(dow from d)::int
$$;

-- حالة التحضير: ok = فيه تحضير مُرسل، draft = مسودة بس، none = مافيش
create or replace function private.lpa_plan(p_teacher uuid, d date, p_class int, p_subject int) returns text
language sql stable security definer set search_path = public as $$
  select case when bool_or(lp.status <> 'draft') then 'ok' when count(*) > 0 then 'draft' else 'none' end
  from lesson_plans lp
  where lp.teacher_id = p_teacher and lp.lesson_date = d
    and (p_class is null or cardinality(lp.class_ids) = 0 or p_class = any (lp.class_ids))
    and (p_subject is null or lp.subject_id is null or lp.subject_id = p_subject)
$$;

-- مديرو المرحلة المسؤولون عن مرحلة/صف (من نطاقاتهم)
create or replace function private.lpa_principals(p_stage int, p_grade smallint) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}') from profiles p join staff_scopes sc on sc.profile_id = p.id
  left join stages st on st.id = p_stage
  where p.active and p.role = 'principal' and p_stage is not null
    and (sc.stage_id = p_stage or (sc.stage_id is null and sc.section_id = st.section_id) or (sc.stage_id is null and sc.section_id is null))
    and (p_grade is null or p_grade between coalesce(sc.grade_min, 0) and coalesce(sc.grade_max, 99))
$$;

create or replace function private.lpa_line(p_period smallint, p_start text, p_subject text, p_class text, st text) returns text
language sql immutable as $$
  select '• الحصة ' || p_period || coalesce(' (' || p_start || ')', '') || ' — ' || coalesce(p_subject, 'حصة') || ' — ' || coalesce(p_class, '')
         || case when st = 'draft' then ' — (فيه مسودة لسه ماتبعتتش للاعتماد)' else '' end
$$;

-- النبضة (كل دقيقة)
-- p_now و p_dry للاختبار فقط (p_dry = يرجّع الرسائل اللي كانت هتتبعت من غير ما يبعت أو يسجّل)؛ الجدولة تستدعيها بدون معاملات
drop function if exists private.lpa_tick();
create or replace function private.lpa_tick(p_now timestamp default null, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cfg jsonb := coalesce((select value from app_settings where key = 'lp_alert'), '{}');
        nowr timestamp := coalesce(p_now, now() at time zone 'Asia/Riyadh'); today date := nowr::date;
        mins int := greatest(1, least(coalesce((cfg ->> 'minutes')::int, 10), 120));
        d date; i int; r record; who uuid; lines text; n int; out jsonb := '[]'; subj text; body text;
begin
  if not coalesce((cfg ->> 'enabled')::boolean, true) then return out; end if;

  -- (1) المعلم: قبل الحصة بيوم
  if coalesce((cfg ->> 'teacher')::boolean, true) and extract(hour from nowr) >= coalesce((cfg ->> 'teacher_hour')::int, 13) then
    d := null;
    for i in 1..21 loop if private.school_day(today + i) then d := today + i; exit; end if; end loop;
    if d is not null and not exists (select 1 from lp_alert_sent where day = d and slot_id = 0 and kind = 'tday') then
      for who in select distinct s.teacher_id from private.lpa_slots(d) s loop
        select string_agg(private.lpa_line(x.period, x.start_t, x.subject_name, coalesce(x.class_label, x.cls), x.st), E'\n' order by x.period), count(*) into lines, n
        from (select s.*, private.lpa_plan(s.teacher_id, d, s.class_id, s.subject_id) st from private.lpa_slots(d) s where s.teacher_id = who) x
        where x.st <> 'ok' and not exists (select 1 from lp_alert_sent a where a.day = d and a.slot_id = x.slot_id and a.kind = 't');
        if n > 0 then
          subj := '📘 تذكير: ' || n || ' حصة ' || to_char(d, 'YYYY-MM-DD') || ' بدون تحضير';
          body := 'حصصك يوم ' || (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from d)::int + 1] || ' ' || to_char(d, 'YYYY-MM-DD')
            || E' اللي لسه مالهاش تحضير مُرسل:\n\n' || lines
            || E'\n\nحضّرها وابعتها للاعتماد من: تحضير الدروس ← تحاضيري.\nلو الحصة ماتحضّرتش قبل ما تبدأ بـ ' || mins || ' دقائق هيوصل تنبيه لمدير المرحلة والمشرف.';
          out := out || jsonb_build_object('to', who, 'kind', 'teacher', 'subject', subj, 'body', body);
          if not p_dry then
            perform private.cs_notify(array[who], subj, body);
            insert into lp_alert_sent(day, slot_id, kind)
            select d, s.slot_id, 't' from private.lpa_slots(d) s where s.teacher_id = who on conflict do nothing;
          end if;
        end if;
      end loop;
      if not p_dry then insert into lp_alert_sent(day, slot_id, kind) values (d, 0, 'tday') on conflict do nothing; end if;
    end if;
  end if;

  -- (2) مدير المرحلة والمشرف: قبل الحصة بـ mins دقيقة
  if coalesce((cfg ->> 'managers')::boolean, true) and private.school_day(today) then
    create temp table if not exists _lpa (slot_id bigint, teacher_id uuid, tname text, line text, owner_id uuid, princ uuid[]) on commit drop;
    truncate _lpa;
    insert into _lpa
    select s.slot_id, s.teacher_id, (select full_name from profiles where id = s.teacher_id),
           private.lpa_line(s.period, s.start_t, s.subject_name, coalesce(s.class_label, s.cls), x.st), s.owner_id, private.lpa_principals(s.stage_id, s.grade_number)
    from private.lpa_slots(today) s, lateral (select private.lpa_plan(s.teacher_id, today, s.class_id, s.subject_id) st) x
    where s.start_t is not null and x.st <> 'ok'
      and (today + s.start_t::time) - make_interval(mins => mins) <= nowr and nowr < today + s.start_t::time
      and not exists (select 1 from lp_alert_sent a where a.day = today and a.slot_id = s.slot_id and a.kind = 'm');
    if exists (select 1 from _lpa) then
      for who in select distinct u from (select owner_id u from _lpa where owner_id is distinct from teacher_id
                                          union select unnest(princ) from _lpa) z where u is not null loop
        if not exists (select 1 from profiles where id = who and active) then continue; end if;
        select string_agg('👤 أ. ' || tname || E'\n' || replace(line, '• ', '   '), E'\n' order by tname), count(*) into lines, n
        from _lpa where (owner_id = who and owner_id is distinct from teacher_id) or who = any (princ);
        if n > 0 then
          subj := '⚠️ ' || n || ' حصة هتبدأ بعد ' || mins || ' دقائق بدون تحضير';
          body := E'الحصص دي هتبدأ قريب والمعلم لسه مابعتش تحضيرها:\n\n' || lines || E'\n\nتقدر تتابع التحاضير من: تحضير الدروس ← متابعة الالتزام.';
          out := out || jsonb_build_object('to', who, 'kind', 'manager', 'subject', subj, 'body', body);
          if not p_dry then perform private.cs_notify(array[who], subj, body); end if;
        end if;
      end loop;
      if not p_dry then insert into lp_alert_sent(day, slot_id, kind) select today, slot_id, 'm' from _lpa on conflict do nothing; end if;
    end if;
  end if;
  if not p_dry then delete from lp_alert_sent where day < today - 30; end if;
  return out;
end $$;

-- الإعدادات (مدير النظام): {enabled, teacher, managers, minutes, teacher_hour}
create or replace function public.lpa_settings_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  v := jsonb_build_object('enabled', coalesce((p ->> 'enabled')::boolean, true), 'teacher', coalesce((p ->> 'teacher')::boolean, true),
         'managers', coalesce((p ->> 'managers')::boolean, true), 'minutes', greatest(1, least(coalesce((p ->> 'minutes')::int, 10), 120)),
         'teacher_hour', greatest(0, least(coalesce((p ->> 'teacher_hour')::int, 13), 23)));
  insert into app_settings(key, value) values ('lp_alert', v) on conflict (key) do update set value = excluded.value;
  return v;
end $$;
create or replace function public.lpa_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when public.is_admin() then coalesce((select value from app_settings where key = 'lp_alert'), '{}') end
$$;
revoke all on function public.lpa_settings_set(jsonb), public.lpa_settings() from public, anon;
grant execute on function public.lpa_settings_set(jsonb), public.lpa_settings() to authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lp-alert';
    perform cron.schedule('lp-alert', '* * * * *', 'select private.lpa_tick()');
  end if;
end $$;
