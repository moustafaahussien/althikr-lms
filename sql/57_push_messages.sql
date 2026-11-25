-- =====================================================================
-- 57: تنبيهات الجوال لكل رسائل المنصة
--   كل رسالة تصل لـ«الرسائل والتعاميم» (رسالة عادية، تعميم، إحالة سلوكية، تجهيز المختبر، اعتماد مبادرة،
--   ترشيح مسابقة، تنبيهات المخزون…) تُرسل أيضًا تنبيهًا على جوال/حاسب المستلم إن فعّل التنبيهات على جهازه.
--   يستخدم خدمة OneSignal ومفتاحها المحفوظ مسبقًا (private.secrets) — نفس تنبيهات مكتب الإشراف.
-- =====================================================================
create or replace function private.msg_push_trg() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare r record; ids text[]; i int;
begin
  for r in select m.id, m.kind, m.subject, m.body, (select full_name from profiles where id = m.sender_id) sender,
                  array_agg(n.profile_id) who
             from new_rows n join messages m on m.id = n.message_id
            group by m.id, m.kind, m.subject, m.body, m.sender_id
  loop
    ids := array(select private.sv_ext_id(x) from unnest(r.who) x);
    -- دفعات من 2000 مستلم
    i := 1;
    while i <= coalesce(array_length(ids, 1), 0) loop
      begin
        perform private.sv_push(ids[i:i + 1999],
          case when r.kind = 'circular' then '📢 ' else '📩 ' end || left(r.subject, 80),
          coalesce(r.sender || ': ', '') || left(regexp_replace(coalesce(r.body, ''), '\s+', ' ', 'g'), 160),
          'msg' || r.id, 'https://moustafaahussien.github.io/althikr-lms/messages.html?m=' || r.id, 86400 * 3);
      exception when others then null;   -- فشل التنبيه لا يمنع وصول الرسالة
      end;
      i := i + 2000;
    end loop;
  end loop;
  return null;
end $$;

drop trigger if exists msg_push on public.message_recipients;
create trigger msg_push after insert on public.message_recipients
  referencing new table as new_rows for each statement execute function private.msg_push_trg();

-- تنبيه تجريبي لجهازي
create or replace function public.push_test_me() returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); ok boolean;
begin
  if me is null then raise exception 'غير مصرح'; end if;
  ok := private.sv_push(array[private.sv_ext_id(me)], '🔔 تنبيه تجريبي', 'التنبيهات تعمل على هذا الجهاز ✓ — ستصلك رسائل المنصة وتعاميمها هنا.',
                        'test' || extract(epoch from now())::bigint, 'https://moustafaahussien.github.io/althikr-lms/home.html', 600);
  return jsonb_build_object('ok', ok);
end $$;

-- معرّف جهازي في خدمة التنبيهات (لربط الجهاز بحسابي)
create or replace function public.push_my_id() returns text
language sql stable security definer set search_path = public, private as $$ select private.sv_ext_id(public.me_id()) $$;

revoke all on function private.msg_push_trg() from public, anon, authenticated;
revoke all on function public.push_test_me(), public.push_my_id() from public, anon;
grant execute on function public.push_test_me(), public.push_my_id() to authenticated;
