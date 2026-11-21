-- =====================================================================
--  الملف 15: التقرير اليومي للتعليم عن بعد — يُحفظ تلقائيًا الساعة 2:00 ظهرًا (بتوقيت الرياض)
--  (بدل مشغّل Apps Script القديم) — المفتاح السري يُقرأ من ol_props داخل قاعدة البيانات
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'ol-daily-report';
select cron.schedule('ol-daily-report', '0 11 * * *', $job$
  select net.http_post(
    url     := 'https://zpbhzhpvpvehowxvlsgp.supabase.co/functions/v1/online',
    headers := jsonb_build_object('Content-Type', 'application/json',
                 'x-ol-secret', (select value from public.ol_props where key = 'ADMIN_SECRET')),
    body    := '{"action":"dailyReport"}'::jsonb,
    timeout_milliseconds := 60000)
$job$);

select jobname, schedule, active from cron.job where jobname = 'ol-daily-report';
