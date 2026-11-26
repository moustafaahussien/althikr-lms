-- ============================================================
-- 76) بوابة الرسائل النصية والواتساب لأولياء الأمور — جاهزة، ولا ينقصها إلا بيانات حساب المزوّد.
-- المزوّدون المدعومون:
--   taqnyat   = تقنيات (SMS)      : https://api.taqnyat.sa/v1/messages  (Bearer Token + اسم مرسل معتمد)
--   unifonic  = يونيفونك (SMS)    : https://el.cloud.unifonic.com/rest/SMS/messages (AppSid + SenderID)
--   whatsapp  = واتساب Cloud API (Meta): graph.facebook.com/{phone_number_id}/messages (Access Token + قالب معتمد بمتغير واحد)
-- المفتاح السري يُحفظ في private.secrets (لا يُقرأ من المتصفح أبدًا).
-- الإرسال عبر طابور: الأحداث تضيف رسائل، ومهمة مجدولة كل دقيقة ترسلها وتسجّل نتيجتها.
-- ============================================================

create table if not exists public.gw_outbox (
  id          bigserial primary key,
  phone       text not null,
  body        text not null,
  event       text not null,
  ref         text,
  student_id  uuid references public.profiles(id) on delete set null,
  status      text not null default 'queued' check (status in ('queued','sending','sent','failed','skipped')),
  request_id  bigint,
  response    text,
  attempts    smallint not null default 0,
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists gw_outbox_q on public.gw_outbox(status, id);
create unique index if not exists gw_outbox_dedupe on public.gw_outbox(event, ref, phone) where ref is not null;
alter table public.gw_outbox enable row level security;
revoke all on public.gw_outbox from anon, authenticated;

-- الإعدادات (غير السرية)
create or replace function private.gw_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'enabled', false, 'provider', 'taqnyat', 'sender', '', 'app_id', '', 'wa_template', 'school_notice', 'wa_lang', 'ar', 'daily_cap', 3000,
    'events', jsonb_build_object('absence', true, 'late', false, 'clinic', true, 'behavior', false, 'report_cards', true, 'exam_seat', true, 'meeting', true),
    'templates', jsonb_build_object(
      'absence', 'ولي أمر الطالب {الطالب}: نفيدكم بغياب ابنكم اليوم {التاريخ}. {المدرسة}',
      'late', 'ولي أمر الطالب {الطالب}: نفيدكم بتأخر ابنكم صباح اليوم {التاريخ}. {المدرسة}',
      'clinic', 'ولي أمر الطالب {الطالب}: زار ابنكم العيادة المدرسية اليوم ({الإجراء}). للتفاصيل: بوابة ولي الأمر. {المدرسة}',
      'behavior', 'ولي أمر الطالب {الطالب}: سُجّلت ملاحظة سلوكية لابنكم. للتفاصيل: بوابة ولي الأمر. {المدرسة}',
      'report_cards', 'ولي أمر الطالب {الطالب}: صدرت {العنوان} ويمكنكم الاطلاع عليها في بوابة ولي الأمر. {المدرسة}',
      'exam_seat', 'ولي أمر الطالب {الطالب}: رقم جلوس ابنكم {رقم_الجلوس} في {اللجنة} — {العنوان}. {المدرسة}',
      'meeting', 'تم تأكيد موعد لقائكم مع {المعلم} يوم {التاريخ} الساعة {الوقت} بخصوص الطالب {الطالب}. {المدرسة}'))
  || coalesce((select value from app_settings where key = 'messaging'), '{}'::jsonb)
$$;

create or replace function private.gw_phone(p text) returns text
language sql immutable as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') x)
  select case when x ~ '^9665\d{8}$' then x
              when x ~ '^009665\d{8}$' then substr(x, 3)
              when x ~ '^05\d{8}$' then '966' || substr(x, 2)
              when x ~ '^5\d{8}$' then '966' || x end
    from d
$$;

-- هواتف أولياء أمور الطالب (من بوابة ولي الأمر، وإلا من سجل الطالب)
create or replace function private.gw_parent_phones(p_student uuid) returns text[]
language sql stable security definer set search_path = public, private as $$
  select coalesce(array_agg(distinct ph) filter (where ph is not null), '{}') from (
    select private.gw_phone(g.phone) ph from guardian_students gs join guardians g on g.id = gs.guardian_id where gs.student_id = p_student
    union all select private.gw_phone(guardian_phone) from students where profile_id = p_student) z
$$;

create or replace function private.gw_fill(t text, v jsonb) returns text
language plpgsql immutable as $$
declare k text; out text := coalesce(t, '');
begin
  for k in select jsonb_object_keys(v) loop out := replace(out, '{' || k || '}', coalesce(v->>k, '')); end loop;
  return btrim(regexp_replace(out, '\{[^}]*\}', '', 'g'));
end $$;

-- إضافة رسالة حدث لأولياء أمور طالب (لا شيء إن كانت البوابة أو الحدث متوقفين)
create or replace function private.gw_event(p_event text, p_student uuid, p_ref text, p_vars jsonb default '{}') returns int
language plpgsql security definer set search_path = public, private as $$
declare c jsonb := private.gw_cfg(); ph text; n int := 0; txt text;
begin
  if not coalesce((c->>'enabled')::boolean, false) or not coalesce((c->'events'->>p_event)::boolean, false) then return 0; end if;
  if not exists (select 1 from private.secrets where key = 'gw_token') then return 0; end if;
  txt := private.gw_fill(c->'templates'->>p_event, p_vars || jsonb_build_object('الطالب', (select full_name from profiles where id = p_student),
           'المدرسة', coalesce(nullif(c->>'school', ''), 'مدارس دار الذكر'), 'التاريخ', coalesce(p_vars->>'التاريخ', to_char(current_date, 'YYYY/MM/DD'))));
  foreach ph in array private.gw_parent_phones(p_student) loop
    insert into gw_outbox(phone, body, event, ref, student_id) values (ph, left(txt, 600), p_event, p_ref, p_student) on conflict do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- ---------- الإرسال (مهمة مجدولة كل دقيقة) ----------
create or replace function private.gw_dispatch() returns int
language plpgsql security definer set search_path = public, private, extensions as $$
declare c jsonb := private.gw_cfg(); tk text; m gw_outbox; rid bigint; n int := 0; sent_today int; r record;
begin
  -- 1) تحديث نتائج الطلبات السابقة
  for r in select o.id, h.status_code, left(coalesce(h.content::text, h.error_msg, ''), 500) body
             from gw_outbox o join net._http_response h on h.id = o.request_id where o.status = 'sending' loop
    update gw_outbox set status = case when r.status_code between 200 and 299 then 'sent' else 'failed' end, response = r.status_code || ' ' || r.body,
           sent_at = case when r.status_code between 200 and 299 then now() end where id = r.id;
  end loop;
  update gw_outbox set status = 'failed', response = coalesce(response, 'لا استجابة من المزوّد') where status = 'sending' and created_at < now() - interval '30 minutes';
  -- 2) إرسال الجديد
  if not coalesce((c->>'enabled')::boolean, false) then return 0; end if;
  select value into tk from private.secrets where key = 'gw_token';
  if tk is null then return 0; end if;
  select count(*) into sent_today from gw_outbox where status in ('sent','sending') and created_at >= current_date;
  for m in select * from gw_outbox where status = 'queued' order by id limit least(60, greatest(0, coalesce((c->>'daily_cap')::int, 3000) - sent_today)) for update skip locked loop
    if c->>'provider' = 'taqnyat' then
      select net.http_post(url := 'https://api.taqnyat.sa/v1/messages',
        body := jsonb_build_object('recipients', jsonb_build_array(m.phone::bigint), 'body', m.body, 'sender', c->>'sender'),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json', 'Authorization', 'Bearer ' || tk)) into rid;
    elsif c->>'provider' = 'unifonic' then
      select net.http_post(url := 'https://el.cloud.unifonic.com/rest/SMS/messages', body := '{}'::jsonb,
        params := jsonb_build_object('AppSid', tk, 'SenderID', c->>'sender', 'Recipient', m.phone, 'Body', m.body, 'responseType', 'JSON'),
        headers := jsonb_build_object('Accept', 'application/json')) into rid;
    elsif c->>'provider' = 'whatsapp' then
      select net.http_post(url := 'https://graph.facebook.com/v21.0/' || (c->>'app_id') || '/messages',
        body := jsonb_build_object('messaging_product', 'whatsapp', 'to', m.phone, 'type', 'template',
                  'template', jsonb_build_object('name', c->>'wa_template', 'language', jsonb_build_object('code', coalesce(nullif(c->>'wa_lang', ''), 'ar')),
                    'components', jsonb_build_array(jsonb_build_object('type', 'body', 'parameters', jsonb_build_array(jsonb_build_object('type', 'text', 'text', m.body)))))),
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || tk)) into rid;
    else
      update gw_outbox set status = 'failed', response = 'مزوّد غير معروف' where id = m.id; continue;
    end if;
    update gw_outbox set status = 'sending', request_id = rid, attempts = attempts + 1 where id = m.id;
    n := n + 1;
  end loop;
  return n;
end $$;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'gw-dispatch';
  perform cron.schedule('gw-dispatch', '* * * * *', 'select private.gw_dispatch()');
exception when others then raise notice 'pg_cron غير متاح هنا: %', sqlerrm;
end $$;

-- ---------- الأحداث ----------
-- الغياب/التأخر اليومي
create or replace function private.gw_att_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare a attendance_sessions;
begin
  if new.status not in ('absent','late') then return new; end if;
  if tg_op = 'UPDATE' and old.status = new.status then return new; end if;
  select * into a from attendance_sessions where id = new.session_id;
  if a.period <> 0 or a.day <> current_date then return new; end if;
  perform private.gw_event(case when new.status = 'absent' then 'absence' else 'late' end, new.student_id, new.status || ':' || a.day || ':' || new.student_id,
                           jsonb_build_object('التاريخ', to_char(a.day, 'YYYY/MM/DD')));
  return new;
end $$;
drop trigger if exists gw_att on public.attendance_marks;
create trigger gw_att after insert or update of status on public.attendance_marks for each row execute function private.gw_att_trg();

-- زيارة العيادة (عند اختيار إبلاغ ولي الأمر)
create or replace function private.gw_clinic_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.to_parent then perform private.gw_event('clinic', new.student_id, 'clinic:' || new.id, jsonb_build_object('الإجراء', private.cl_action_label(new.action))); end if;
  return new;
end $$;
drop trigger if exists gw_clinic on public.cl_visits;
create trigger gw_clinic after insert on public.cl_visits for each row execute function private.gw_clinic_trg();

-- ملاحظة سلوكية سلبية تظهر لولي الأمر
create or replace function private.gw_bh_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.to_parent and new.kind = 'negative' then perform private.gw_event('behavior', new.student_id, 'bh:' || new.id, '{}'); end if;
  return new;
end $$;
drop trigger if exists gw_bh on public.bh_notes;
create trigger gw_bh after insert on public.bh_notes for each row execute function private.gw_bh_trg();

-- نشر الشهادات الفصلية
create or replace function private.gw_rc_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare s uuid;
begin
  if new.published and not coalesce(old.published, false) then
    for s in select student_id from rc_cards where issue_id = new.id loop
      perform private.gw_event('report_cards', s, 'rc:' || new.id || ':' || s, jsonb_build_object('العنوان', new.title));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists gw_rc on public.rc_issues;
create trigger gw_rc after update of published on public.rc_issues for each row execute function private.gw_rc_trg();

-- نشر لجان الاختبارات (رقم الجلوس)
create or replace function private.gw_ec_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare r record;
begin
  if new.published and not coalesce(old.published, false) then
    for r in select s.student_id, s.seat_no, coalesce(rm.name, 'لجنة ' || rm.no) room from ec_seats s join ec_rooms rm on rm.id = s.room_id where s.session_id = new.id loop
      perform private.gw_event('exam_seat', r.student_id, 'ec:' || new.id || ':' || r.student_id, jsonb_build_object('رقم_الجلوس', r.seat_no, 'اللجنة', r.room, 'العنوان', new.title));
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists gw_ec on public.ec_sessions;
create trigger gw_ec after update of published on public.ec_sessions for each row execute function private.gw_ec_trg();

-- تأكيد حجز لقاء ولي الأمر
create or replace function private.gw_mt_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.status = 'booked' and old.status is distinct from 'booked' and new.student_id is not null then
    perform private.gw_event('meeting', new.student_id, 'mt:' || new.id || ':' || new.booked_at, jsonb_build_object(
      'المعلم', (select full_name from profiles where id = new.teacher_id), 'التاريخ', to_char(new.starts_at at time zone 'Asia/Riyadh', 'YYYY/MM/DD'),
      'الوقت', to_char(new.starts_at at time zone 'Asia/Riyadh', 'HH24:MI')));
  end if;
  return new;
end $$;
drop trigger if exists gw_mt on public.mt_slots;
create trigger gw_mt after update of status on public.mt_slots for each row execute function private.gw_mt_trg();

-- ---------- لوحة الإدارة ----------
create or replace function public.gw_get() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  return private.gw_cfg() || jsonb_build_object('has_token', exists (select 1 from private.secrets where key = 'gw_token'),
    'stats', jsonb_build_object('queued', (select count(*) from gw_outbox where status = 'queued'), 'sending', (select count(*) from gw_outbox where status = 'sending'),
      'sent_today', (select count(*) from gw_outbox where status = 'sent' and created_at >= current_date), 'failed_today', (select count(*) from gw_outbox where status = 'failed' and created_at >= current_date),
      'sent_month', (select count(*) from gw_outbox where status = 'sent' and created_at >= date_trunc('month', now()))),
    'phones', jsonb_build_object('students', (select count(*) from students s join profiles p on p.id = s.profile_id and p.active),
      'with_phone', (select count(*) from students s join profiles p on p.id = s.profile_id and p.active where cardinality(private.gw_parent_phones(s.profile_id)) > 0)));
end $$;

create or replace function public.gw_set(p jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
declare v jsonb := '{}';
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  if p ? 'provider' and p->>'provider' not in ('taqnyat','unifonic','whatsapp') then raise exception 'مزوّد غير مدعوم'; end if;
  select coalesce(jsonb_object_agg(k, p->k), '{}') into v from unnest(array['enabled','provider','sender','app_id','wa_template','wa_lang','daily_cap','events','templates','school']) k where p ? k;
  insert into app_settings(key, value) values ('messaging', v)
  on conflict (key) do update set value = coalesce(app_settings.value, '{}'::jsonb) || excluded.value;
end $$;

-- حفظ المفتاح السري (يكتبه مدير النظام بنفسه؛ لا يُعاد عرضه أبدًا)
create or replace function public.gw_set_token(p_token text) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  if nullif(btrim(p_token), '') is null then delete from private.secrets where key = 'gw_token'; return; end if;
  insert into private.secrets(key, value) values ('gw_token', btrim(p_token)) on conflict (key) do update set value = excluded.value;
end $$;

create or replace function public.gw_test(p_phone text, p_text text) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare ph text := private.gw_phone(p_phone); nid bigint;
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  if ph is null then raise exception 'رقم غير صالح — اكتبه مثل 05xxxxxxxx'; end if;
  insert into gw_outbox(phone, body, event, created_by) values (ph, left(coalesce(nullif(btrim(p_text), ''), 'رسالة تجريبية من منصة المدرسة'), 600), 'test', public.me_id()) returning gw_outbox.id into nid;
  return nid;
end $$;

-- رسالة مخصصة لأولياء أمور مرحلة/صف/فصل (تمر بنفس الطابور والحد اليومي)
create or replace function public.gw_bulk(p jsonb) returns int
language plpgsql security definer set search_path = public, private as $$
declare st int[]; cl int[]; s record; ph text; n int := 0; txt text := left(btrim(p->>'text'), 600); ref text := 'bulk:' || extract(epoch from now())::bigint;
begin
  if public.me_role() not in ('admin','leadership') then raise exception 'للإدارة فقط'; end if;
  if coalesce(txt, '') = '' then raise exception 'اكتب نص الرسالة'; end if;
  select array_agg(x::int) into st from jsonb_array_elements_text(coalesce(p->'stage_ids', '[]')) x;
  select array_agg(x::int) into cl from jsonb_array_elements_text(coalesce(p->'class_ids', '[]')) x;
  for s in select st0.profile_id from students st0 join profiles pr on pr.id = st0.profile_id and pr.active join grades g on g.id = st0.grade_id
            where (st is null or g.stage_id = any (st)) and (cl is null or st0.class_id = any (cl)) loop
    foreach ph in array private.gw_parent_phones(s.profile_id) loop
      insert into gw_outbox(phone, body, event, ref, student_id, created_by)
      values (ph, replace(txt, '{الطالب}', (select full_name from profiles where id = s.profile_id)), 'bulk', ref || ':' || s.profile_id, s.profile_id, public.me_id()) on conflict do nothing;
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;

create or replace function public.gw_log(p_status text default null, p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'phone', o.phone, 'body', o.body, 'event', o.event, 'status', o.status, 'response', o.response,
           'student', (select full_name from profiles where id = o.student_id), 'at', o.created_at, 'sent_at', o.sent_at) order by o.id desc)
    from (select * from gw_outbox where p_status is null or status = p_status order by id desc limit least(coalesce(p_limit, 200), 1000)) o), '[]'::jsonb);
end $$;

create or replace function public.gw_cancel_queued() returns int
language plpgsql security definer set search_path = public, private as $$
declare n int;
begin
  if public.me_role() <> 'admin' then raise exception 'لمدير النظام فقط'; end if;
  update gw_outbox set status = 'skipped', response = 'أُلغيت يدويًا' where status = 'queued'; get diagnostics n = row_count; return n;
end $$;

revoke all on function private.gw_cfg(), private.gw_phone(text), private.gw_parent_phones(uuid), private.gw_fill(text, jsonb), private.gw_event(text, uuid, text, jsonb),
  private.gw_dispatch(), private.gw_att_trg(), private.gw_clinic_trg(), private.gw_bh_trg(), private.gw_rc_trg(), private.gw_ec_trg(), private.gw_mt_trg() from public, anon, authenticated;
revoke all on function public.gw_get(), public.gw_set(jsonb), public.gw_set_token(text), public.gw_test(text, text), public.gw_bulk(jsonb), public.gw_log(text, int), public.gw_cancel_queued() from public, anon;
grant execute on function public.gw_get(), public.gw_set(jsonb), public.gw_set_token(text), public.gw_test(text, text), public.gw_bulk(jsonb), public.gw_log(text, int), public.gw_cancel_queued() to authenticated;
