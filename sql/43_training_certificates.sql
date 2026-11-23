-- =====================================================================
-- 43: اعتماد التدريب وإصدار شهادات التدريب (طلب مصطفى 23 نوفمبر)
--   - المعلم يسجّل تدريبه (ومعه مقدّم الدورة) ← بانتظار الاعتماد
--   - يعتمده مشرفه (أو مدير مرحلته إن لم يكن له مشرف — نفس قاعدة التحضير)
--     أو يعيده بملاحظة، ويختار المعتمِد إصدار شهادة أو لا
--   - يمكن إصدار الشهادة لاحقًا لتدريب معتمد
--   - الشهادة: شعار المدرسة، اسم مدير التعليم، المدير التنفيذي، مقدّم الدورة، رقم تحقق
--   - أسماء المسؤولين على الشهادة من إعدادات المدرسة (app_settings) يعدّلها مدير النظام
-- =====================================================================
alter table public.trainings add column if not exists presenter text;                       -- مقدّم الدورة
alter table public.trainings add column if not exists status text not null default 'pending' check (status in ('pending','approved','returned'));
alter table public.trainings add column if not exists review_by uuid references public.profiles(id) on delete set null;
alter table public.trainings add column if not exists review_at timestamptz;
alter table public.trainings add column if not exists review_note text;
alter table public.trainings add column if not exists cert_no text unique;                   -- رقم الشهادة الصادرة من المنصة
alter table public.trainings add column if not exists cert_issued_at timestamptz;
alter table public.trainings add column if not exists cert_issued_by uuid references public.profiles(id) on delete set null;

insert into app_settings(key, value) values
  ('cert_edu_title', '"مدير التعليم"'::jsonb), ('cert_edu_name', '""'::jsonb),
  ('cert_exec_title', '"المدير التنفيذي"'::jsonb), ('cert_exec_name', '""'::jsonb)
on conflict (key) do nothing;

-- من يعتمد تدريب المعلم: مشرفه التربوي، وإن لم يكن له مشرف فمدير مرحلته
create or replace function private.trn_can_approve(p_pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select private.lp_can_approve(p_pid)
$$;

-- رقم الشهادة: DTH-سنة-رقم السجل
create or replace function private.trn_issue(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  update trainings set cert_no = coalesce(cert_no, 'DTH-' || to_char(now() at time zone 'Asia/Riyadh', 'YYYY') || '-' || lpad(id::text, 5, '0')),
         cert_issued_at = coalesce(cert_issued_at, now()), cert_issued_by = coalesce(cert_issued_by, public.me_id())
   where id = p_id returning cert_no into n;
  return n;
end $$;

-- حفظ التدريب: المعتمد لا يُعدّل، والمُعاد يرجع للمراجعة بعد التعديل
create or replace function public.trn_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); tid bigint := nullif(p->>'id','')::bigint; st text;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if btrim(coalesce(p->>'title','')) = '' then raise exception 'اكتب اسم البرنامج التدريبي'; end if;
  if tid is null then
    insert into trainings(profile_id, title, provider, presenter, mode, start_date, end_date, hours, certificate, self_rating, self_note)
    values (me, btrim(p->>'title'), nullif(btrim(coalesce(p->>'provider','')),''), nullif(btrim(coalesce(p->>'presenter','')),''), nullif(p->>'mode',''),
            nullif(p->>'start_date','')::date, nullif(p->>'end_date','')::date,
            coalesce(nullif(p->>'hours','')::numeric, 0), case when jsonb_typeof(p->'certificate') = 'object' then p->'certificate' end,
            nullif(p->>'self_rating','')::smallint, nullif(p->>'self_note',''))
    returning id into tid;
  else
    select status into st from trainings where id = tid and profile_id = me;
    if not found then raise exception 'غير مصرح'; end if;
    if st = 'approved' then raise exception 'لا يمكن تعديل تدريب معتمد — تواصل مع مشرفك'; end if;
    update trainings set title = btrim(p->>'title'), provider = nullif(btrim(coalesce(p->>'provider','')),''), presenter = nullif(btrim(coalesce(p->>'presenter','')),''),
      mode = nullif(p->>'mode',''), start_date = nullif(p->>'start_date','')::date, end_date = nullif(p->>'end_date','')::date,
      hours = coalesce(nullif(p->>'hours','')::numeric, 0),
      certificate = case when jsonb_typeof(p->'certificate') = 'object' then p->'certificate' else certificate end,
      self_rating = nullif(p->>'self_rating','')::smallint, self_note = nullif(p->>'self_note',''),
      status = 'pending'
    where id = tid and profile_id = me;
  end if;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

-- الحذف: صاحبه قبل الاعتماد، أو مدير النظام
create or replace function public.trn_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from trainings where id = p_id and ((profile_id = public.me_id() and status <> 'approved') or public.is_admin());
  if not found then raise exception 'لا يمكن حذف تدريب معتمد'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- اعتماد / إعادة، مع خيار إصدار الشهادة
create or replace function public.trn_review(p_id bigint, p_action text, p_note text default null, p_cert boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t trainings; n text;
begin
  select * into t from trainings where id = p_id;
  if not found then raise exception 'غير موجود'; end if;
  if not private.trn_can_approve(t.profile_id) then raise exception 'اعتماد التدريب لمشرف المعلم (أو مدير مرحلته إن لم يكن له مشرف)'; end if;
  if p_action not in ('approve','return') then raise exception 'إجراء غير صالح'; end if;
  if p_action = 'return' then
    if btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب سبب الإعادة للمعلم'; end if;
    if t.cert_no is not null then raise exception 'صدرت شهادة لهذا التدريب ولا يمكن إعادته'; end if;
    update trainings set status = 'returned', review_by = public.me_id(), review_at = now(), review_note = btrim(p_note) where id = p_id;
    return jsonb_build_object('ok', true);
  end if;
  if coalesce(t.hours, 0) <= 0 then raise exception 'حدّد عدد ساعات التدريب قبل الاعتماد'; end if;
  update trainings set status = 'approved', review_by = public.me_id(), review_at = now(), review_note = nullif(btrim(coalesce(p_note,'')), '') where id = p_id;
  if p_cert then n := private.trn_issue(p_id); end if;
  return jsonb_build_object('ok', true, 'cert_no', n);
end $$;

-- إصدار الشهادة لاحقًا لتدريب معتمد
create or replace function public.trn_cert_issue(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t trainings;
begin
  select * into t from trainings where id = p_id;
  if not found or not private.trn_can_approve(t.profile_id) then raise exception 'غير مصرح'; end if;
  if t.status <> 'approved' then raise exception 'اعتمد التدريب أولًا'; end if;
  return jsonb_build_object('ok', true, 'cert_no', private.trn_issue(p_id));
end $$;

-- بيانات الشهادة للعرض والطباعة
create or replace function public.trn_cert(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare t trainings; s jsonb;
begin
  select * into t from trainings where id = p_id;
  if not found or t.cert_no is null then raise exception 'لا توجد شهادة صادرة لهذا التدريب'; end if;
  if not (private.trn_can_view(t.profile_id) or private.trn_can_approve(t.profile_id)) then raise exception 'غير مصرح'; end if;
  select jsonb_object_agg(key, value) into s from app_settings where key in ('school_name','cert_edu_title','cert_edu_name','cert_exec_title','cert_exec_name');
  return jsonb_build_object('cert_no', t.cert_no, 'issued_at', t.cert_issued_at, 'name', (select full_name from profiles where id = t.profile_id),
    'job', (select job_title from profiles where id = t.profile_id),
    'title', t.title, 'provider', t.provider, 'presenter', t.presenter, 'mode', t.mode, 'start', t.start_date, 'end', t.end_date, 'hours', t.hours,
    'approved_by', (select full_name from profiles where id = t.review_by),
    'school', coalesce(s->>'school_name', 'مدارس دار الذكر'), 'edu_title', coalesce(nullif(s->>'cert_edu_title',''), 'مدير التعليم'), 'edu_name', coalesce(s->>'cert_edu_name', ''),
    'exec_title', coalesce(nullif(s->>'cert_exec_title',''), 'المدير التنفيذي'), 'exec_name', coalesce(s->>'cert_exec_name', ''));
end $$;

-- التحقق من شهادة برقمها (صفحة التحقق العامة) — بيانات محدودة
create or replace function public.trn_verify(p_no text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('valid', true, 'name', p.full_name, 'title', t.title, 'hours', t.hours, 'issued_at', t.cert_issued_at,
                    'start', t.start_date, 'end', t.end_date)
                   from trainings t join profiles p on p.id = t.profile_id where t.cert_no = upper(btrim(p_no)) and t.status = 'approved'),
                  jsonb_build_object('valid', false))
$$;

-- القائمة بالحالة والمعتمِد والشهادة وصلاحية الاعتماد
create or replace function public.trn_list(p_pid uuid default null, p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id(); allv boolean := coalesce(public.me_role() in ('admin','leadership','principal','supervisor'), false);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if p_pid is not null and not private.trn_can_view(p_pid) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('can_all', allv, 'rows', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'pid', t.profile_id, 'name', p.full_name,
      'title', t.title, 'provider', t.provider, 'presenter', t.presenter, 'mode', t.mode, 'start', t.start_date, 'end', t.end_date, 'hours', t.hours,
      'certificate', t.certificate, 'self_rating', t.self_rating, 'self_note', t.self_note, 'impact_rating', t.impact_rating,
      'impact_note', t.impact_note, 'impact_by', ib.full_name, 'mine', t.profile_id = me,
      'status', t.status, 'review_by', rb.full_name, 'review_at', t.review_at, 'review_note', t.review_note,
      'cert_no', t.cert_no, 'cert_issued_at', t.cert_issued_at, 'can_review', private.trn_can_approve(t.profile_id))
      order by (t.status = 'pending' and private.trn_can_approve(t.profile_id)) desc, t.start_date desc nulls last, t.id desc)
    from trainings t join profiles p on p.id = t.profile_id left join profiles ib on ib.id = t.impact_by left join profiles rb on rb.id = t.review_by
    where (case when p_pid is not null then t.profile_id = p_pid when allv then true else t.profile_id = me end)
      and (p_from is null or coalesce(t.end_date, t.start_date) >= p_from) and (p_to is null or coalesce(t.start_date, t.end_date) <= p_to)), '[]'::jsonb));
end $$;

revoke all on function private.trn_can_approve(uuid), private.trn_issue(bigint) from public, anon, authenticated;
revoke all on function public.trn_review(bigint, text, text, boolean), public.trn_cert_issue(bigint), public.trn_cert(bigint) from public, anon;
grant execute on function public.trn_review(bigint, text, text, boolean), public.trn_cert_issue(bigint), public.trn_cert(bigint) to authenticated;
revoke all on function public.trn_verify(text) from public;
grant execute on function public.trn_verify(text) to anon, authenticated;
