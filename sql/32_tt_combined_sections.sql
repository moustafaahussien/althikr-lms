-- 32: حصص الإنجليزي المقسّمة حسب المستوى (خانة واحدة فيها أكثر من فصل مثل «د/٦/ج/٦/ب/٦/أ»)
-- طلاب الصف كله يُعاد توزيعهم على مجموعات مستوى مع معلمين مختلفين في نفس الوقت،
-- فلا تُربط الحصة بفصل بعينه: تبقى في الجدول بلا فصل، ولا يُنشأ لها فصل وهمي.
create or replace function private.tt_class(p_sheet integer, p_track text, g smallint, p_sec text)
returns integer language plpgsql security definer set search_path to 'public' as $function$
declare st text; code text; n int; girls boolean; sec text := btrim(regexp_replace(coalesce(p_sec, ''), '^-+', '')); c record;
begin
  if g is null or sec = '' then return null; end if;
  -- أكثر من فصل في خانة واحدة (مجموعات مستوى) ← بلا فصل
  if sec ~ '[/،,]' then return null; end if;
  st := private.tt_stage_of(p_sheet, p_track, g);
  select (coalesce(label, '') || ' ' || src_name) ~ 'بنات' into girls from tt_sheets where id = p_sheet;
  if p_track = 'american' or st = 'المسار الأمريكي' then
    if g not between 4 and 12 then return null; end if; code := 'american'; n := g;
  elsif st = 'ابتدائي' then
    if g not between 1 and 6 then return null; end if;
    code := case when girls then 'girls-primary' else 'boys-primary' end; n := g;
  elsif st = 'متوسط' then code := 'boys-intermediate'; n := case when g >= 7 then g - 6 else g end;
  elsif st = 'ثانوي' then code := 'boys-secondary';    n := case when g >= 10 then g - 9 else g end;
  elsif g between 7 and 9 then code := 'boys-intermediate'; n := g - 6;
  elsif g between 10 and 12 then code := 'boys-secondary'; n := g - 9;
  else return null; end if;
  if code in ('boys-intermediate','boys-secondary') and n not between 1 and 3 then return null; end if;
  select * into c from public._get_class(code, n::text, sec, true);
  return c.cid;
exception when others then return null;
end $function$;

-- حذف الفصول الوهمية التي أنشأها الاستيراد سابقًا — فقط إن لم يكن فيها طلاب ولا جلسات حضور.
-- (tt_slots.class_id ← null تلقائيًا، وإسناداتها المشتقة من الجدول تُحذف بالتتابع)
delete from public.classes c
where c.name ~ '[/،,]'
  and not exists (select 1 from public.students s where s.class_id = c.id)
  and not exists (select 1 from public.attendance_sessions a where a.class_id = c.id)
  and not exists (select 1 from public.teaching_assignments t where t.class_id = c.id and t.source <> 'timetable');
