-- ============================================================
-- 91) تعديلات تنبيهات الحصص بدون تحضير
--   • استثناء مواد التربية البدنية (PE / بدنية / تايكوندو) والسباحة والقيادة — app_settings.lp_alert.exclude_re
--   • تنبيه مدير المرحلة والمشرف بقى يظهر على الصفحة الرئيسية بس (بدون رسالة أو إشعار)
--     وكل واحد يقدر يفعّل لنفسه «رسالة وإشعار على الجوال» ويحدد عدد الدقايق (lpa_prefs)
-- ============================================================
update public.app_settings set value = value || '{"exclude_re": "(^|[^a-z])pe([^a-z]|$)|بدني|سباحة|swim|القيادة|تايكوندو|taekwondo"}'::jsonb
 where key = 'lp_alert' and not value ? 'exclude_re';

create table if not exists public.lpa_prefs (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  notify     boolean not null default false,     -- رسالة + إشعار جوال
  minutes    smallint not null default 10 check (minutes between 1 and 120)
);
alter table public.lpa_prefs enable row level security;
revoke all on public.lpa_prefs from anon, authenticated;

-- الحصص بعد الدمج والاستثناء
create or replace function private.lpa_slots(d date)
returns table (slot_id bigint, teacher_id uuid, period smallint, start_t text, class_id int, cls text, subject_id int,
               stage_id int, grade_number smallint, owners uuid[], class_label text, subject_name text)
language sql stable security definer set search_path = public as $$
  select * from (
    select min(r.slot_id) slot_id, r.teacher_id, r.period, min(r.start_t) start_t, max(r.class_id) class_id, min(r.cls) cls, max(r.subject_id) subject_id,
           max(r.stage_id) stage_id, max(r.grade_number) grade_number, array_agg(distinct r.owner_id) owners, min(r.class_label) class_label, min(r.subject_name) subject_name
    from private.lpa_slots_raw(d) r
    group by r.teacher_id, r.period, coalesce(r.class_id::text, lower(regexp_replace(coalesce(r.cls, ''), '[\s/-]', '', 'g')))) s
  where coalesce((select value ->> 'exclude_re' from app_settings where key = 'lp_alert'), '') = ''
     or coalesce(s.subject_name, '') !~* (select value ->> 'exclude_re' from app_settings where key = 'lp_alert')
$$;

-- النبضة (كل دقيقة)
create or replace function private.lpa_tick(p_now timestamp default null, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cfg jsonb := coalesce((select value from app_settings where key = 'lp_alert'), '{}');
        nowr timestamp := coalesce(p_now, now() at time zone 'Asia/Riyadh'); today date := nowr::date;
        d date; i int; who uuid; lines text; n int; out jsonb := '[]'; subj text; body text; pm int; mins int;
begin
  if not coalesce((cfg ->> 'enabled')::boolean, true) then return out; end if;
  mins := greatest(1, least(coalesce((cfg ->> 'minutes')::int, 10), 120));

  -- (1) المعلم: قبل الحصة بيوم
  if coalesce((cfg ->> 'teacher')::boolean, true) and extract(hour from nowr) >= coalesce((cfg ->> 'teacher_hour')::int, 13) then
    d := null;
    for i in 1..21 loop if private.school_day(today + i) then d := today + i; exit; end if; end loop;
    if d is not null and not exists (select 1 from lp_alert_sent where day = d and slot_id = 0 and kind = 'tday') then
      create temp table if not exists _lpt on commit drop as select * from private.lpa_slots(d) limit 0;
      truncate _lpt; insert into _lpt select * from private.lpa_slots(d);
      for who in select distinct teacher_id from _lpt loop
        select string_agg(private.lpa_line(x.period, x.start_t, x.subject_name, coalesce(x.class_label, x.cls), x.st), E'\n' order by x.period), count(*) into lines, n
        from (select s.*, private.lpa_plan(s.teacher_id, d, s.class_id, s.subject_id) st from _lpt s where s.teacher_id = who) x
        where x.st <> 'ok' and not exists (select 1 from lp_alert_sent a where a.day = d and a.slot_id = x.slot_id and a.kind = 't');
        if n > 0 then
          subj := '📘 تذكير: ' || n || ' حصة ' || to_char(d, 'YYYY-MM-DD') || ' بدون تحضير';
          body := 'حصصك يوم ' || (array['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'])[extract(dow from d)::int + 1] || ' ' || to_char(d, 'YYYY-MM-DD')
            || E' اللي لسه مالهاش تحضير مُرسل:\n\n' || lines || E'\n\nحضّرها وابعتها للاعتماد من: تحضير الدروس ← تحاضيري.';
          out := out || jsonb_build_object('to', who, 'kind', 'teacher', 'subject', subj, 'body', body);
          if not p_dry then
            perform private.cs_notify(array[who], subj, body);
            insert into lp_alert_sent(day, slot_id, kind) select d, s.slot_id, 't' from _lpt s where s.teacher_id = who on conflict do nothing;
          end if;
        end if;
      end loop;
      if not p_dry then insert into lp_alert_sent(day, slot_id, kind) values (d, 0, 'tday') on conflict do nothing; end if;
    end if;
  end if;

  -- (2) مدير المرحلة والمشرف: رسالة + إشعار لمن فعّلها لنفسه بس (والكل يشوف التنبيه على الصفحة الرئيسية)
  if coalesce((cfg ->> 'managers')::boolean, true) and private.school_day(today) and exists (select 1 from lpa_prefs where notify) then
    create temp table if not exists _lpa (slot_id bigint, teacher_id uuid, tname text, line text, owners uuid[], princ uuid[], st timestamp) on commit drop;
    truncate _lpa;
    insert into _lpa
    select s.slot_id, s.teacher_id, (select full_name from profiles where id = s.teacher_id),
           private.lpa_line(s.period, s.start_t, s.subject_name, coalesce(s.class_label, s.cls), x.st), array_remove(s.owners, s.teacher_id),
           private.lpa_principals(s.stage_id, s.grade_number), today + s.start_t::time
    from private.lpa_slots(today) s, lateral (select private.lpa_plan(s.teacher_id, today, s.class_id, s.subject_id) st) x
    where s.start_t is not null and x.st <> 'ok' and nowr < today + s.start_t::time and today + s.start_t::time <= nowr + interval '2 hours';
    for who, pm in select p.profile_id, p.minutes from lpa_prefs p join profiles pr on pr.id = p.profile_id and pr.active where p.notify loop
      select string_agg('👤 أ. ' || tname || E'\n' || replace(line, '• ', '   '), E'\n' order by tname), count(*) into lines, n
      from _lpa where (who = any (owners) or who = any (princ)) and st - make_interval(mins => pm) <= nowr
        and not exists (select 1 from lp_alert_sent a where a.day = today and a.slot_id = _lpa.slot_id and a.kind = 'm:' || who);
      if n > 0 then
        subj := '⚠️ ' || n || ' حصة هتبدأ قريب بدون تحضير';
        body := E'الحصص دي هتبدأ خلال ' || pm || E' دقيقة والمعلم لسه مابعتش تحضيرها:\n\n' || lines
          || E'\n\nوصلتك الرسالة دي لأنك مفعّل «رسالة وإشعار» في تنبيه الحصص بدون تحضير (الصفحة الرئيسية ← ⚙️).';
        out := out || jsonb_build_object('to', who, 'kind', 'manager', 'subject', subj, 'body', body);
        if not p_dry then
          perform private.cs_notify(array[who], subj, body);
          insert into lp_alert_sent(day, slot_id, kind) select today, slot_id, 'm:' || who from _lpa
          where (who = any (owners) or who = any (princ)) and st - make_interval(mins => pm) <= nowr on conflict do nothing;
        end if;
      end if;
    end loop;
  end if;
  if not p_dry then delete from lp_alert_sent where day < today - 30; end if;
  return out;
end $$;

-- تنبيهات الصفحة الرئيسية لمدير المرحلة/المشرف: حصص اليوم (بدأت أو هتبدأ خلال دقايقه) لسه بدون تحضير
create or replace function public.lpa_my() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id(); cfg jsonb := coalesce((select value from app_settings where key = 'lp_alert'), '{}');
        nowr timestamp := now() at time zone 'Asia/Riyadh'; today date := (now() at time zone 'Asia/Riyadh')::date;
        pf lpa_prefs; mins int; items jsonb; mine boolean;
begin
  if me is null or public.me_role()::text not in ('principal', 'supervisor', 'admin', 'leadership') then return jsonb_build_object('on', false); end if;
  if not coalesce((cfg ->> 'enabled')::boolean, false) or not coalesce((cfg ->> 'managers')::boolean, true) then return jsonb_build_object('on', false); end if;
  select * into pf from lpa_prefs where profile_id = me;
  mins := coalesce(pf.minutes, greatest(1, least(coalesce((cfg ->> 'minutes')::int, 10), 120)));
  if not private.school_day(today) then return jsonb_build_object('on', true, 'school_day', false, 'notify', coalesce(pf.notify, false), 'minutes', mins, 'items', '[]'::jsonb); end if;
  select coalesce(jsonb_agg(jsonb_build_object('teacher', (select full_name from profiles where id = s.teacher_id), 'period', s.period, 'start', s.start_t,
           'subject', s.subject_name, 'class', coalesce(s.class_label, s.cls), 'draft', x.st = 'draft',
           'in', extract(epoch from ((today + s.start_t::time) - nowr))::int / 60) order by s.start_t desc, s.period), '[]'),
         bool_or(true)
    into items, mine
  from private.lpa_slots(today) s, lateral (select private.lpa_plan(s.teacher_id, today, s.class_id, s.subject_id) st) x
  where s.start_t is not null and x.st <> 'ok' and s.teacher_id <> me
    and (me = any (s.owners) or me = any (private.lpa_principals(s.stage_id, s.grade_number)))
    and today + s.start_t::time <= nowr + make_interval(mins => mins);
  return jsonb_build_object('on', true, 'school_day', true, 'notify', coalesce(pf.notify, false), 'minutes', mins, 'items', items,
    'relevant', exists (select 1 from tt_sheets where owner_id = me) or public.me_role()::text = 'principal');
end $$;

create or replace function public.lpa_prefs_set(p_notify boolean, p_minutes int) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if public.me_id() is null or public.me_role()::text not in ('principal', 'supervisor', 'admin', 'leadership') then raise exception 'غير متاح'; end if;
  insert into lpa_prefs(profile_id, notify, minutes) values (public.me_id(), coalesce(p_notify, false), greatest(1, least(coalesce(p_minutes, 10), 120)))
  on conflict (profile_id) do update set notify = excluded.notify, minutes = excluded.minutes;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lpa_my(), public.lpa_prefs_set(boolean, int) from public, anon;
grant execute on function public.lpa_my(), public.lpa_prefs_set(boolean, int) to authenticated;

-- إعدادات مدير النظام (مع قائمة المواد المستثناة)
create or replace function public.lpa_settings_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  v := jsonb_build_object('enabled', coalesce((p ->> 'enabled')::boolean, true), 'teacher', coalesce((p ->> 'teacher')::boolean, true),
         'managers', coalesce((p ->> 'managers')::boolean, true), 'minutes', greatest(1, least(coalesce((p ->> 'minutes')::int, 10), 120)),
         'teacher_hour', greatest(0, least(coalesce((p ->> 'teacher_hour')::int, 13), 23)),
         'exclude_re', coalesce(p ->> 'exclude_re', (select value ->> 'exclude_re' from app_settings where key = 'lp_alert'), ''));
  perform '' ~* (v ->> 'exclude_re');   -- يتأكد إن النمط صحيح
  insert into app_settings(key, value) values ('lp_alert', v) on conflict (key) do update set value = excluded.value;
  return v;
end $$;
