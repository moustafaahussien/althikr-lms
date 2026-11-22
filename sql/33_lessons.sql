-- =====================================================================
-- 33: وحدة «تحضير الدروس» — خطط الدروس بقالب موحّد واعتماد المشرف
--   المعلم: ينشئ التحضير (مسودة) ← يرسله للاعتماد ← يُعتمد أو يُعاد بملاحظة فيعدّله ويعيد إرساله
--   المعتمِد: مشرف المعلم (من الجدول) أو مديره المباشر أو مدير مرحلته أو الإدارة العليا
--   الوصول للجدول عبر الدوال فقط (RLS مفعّل بلا سياسات = لا قراءة/كتابة مباشرة)
-- =====================================================================

create table if not exists public.lesson_plans (
  id            bigserial primary key,
  teacher_id    uuid not null references public.profiles(id) on delete cascade,
  subject_id    int references public.subjects(id) on delete set null,
  class_ids     int[] not null default '{}',
  lesson_date   date not null,
  title         text not null,
  content       jsonb not null default '{}'::jsonb,
  status        text not null default 'draft' check (status in ('draft','submitted','approved','returned')),
  submitted_at  timestamptz,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists lesson_plans_teacher_idx on public.lesson_plans (teacher_id, lesson_date desc);
create index if not exists lesson_plans_status_idx  on public.lesson_plans (status, lesson_date desc);
alter table public.lesson_plans enable row level security;
revoke all on public.lesson_plans from anon, authenticated;

-- هل المستخدم الحالي مسؤول عن هذا المعلم؟ (مشرفه / مديره المباشر / مدير مرحلته / الإدارة العليا)
create or replace function private.lp_is_reviewer(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
       public.me_role() in ('admin','leadership')
    or exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id = public.me_id())
    or private.manager_of(p_teacher) = public.me_id()
    or (public.me_role() = 'principal' and exists (
          select 1 from public.teaching_assignments ta join public.v_classes vc on vc.id = ta.class_id
           where ta.teacher_id = p_teacher and vc.stage_id = any (private.my_stage_ids())))
  , false) and p_teacher <> public.me_id()
$$;

-- اعتماد التحضير: المشرف التربوي للمعلم فقط
create or replace function private.lp_can_approve(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_teacher <> public.me_id() and (
    exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id = public.me_id())
    or (public.me_role() = 'principal'
        and not exists (select 1 from public.v_teacher_supervisors ts where ts.teacher_id = p_teacher and ts.supervisor_id <> p_teacher)
        and exists (select 1 from teaching_assignments ta join classes c on c.id = ta.class_id join grades g on g.id = c.grade_id
                     where ta.teacher_id = p_teacher and g.stage_id = any (private.my_stage_ids()))))
$$;

-- بطاقة مختصرة للقوائم
create or replace function private.lp_card(lp public.lesson_plans) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', lp.id, 'title', lp.title, 'date', lp.lesson_date, 'status', lp.status,
    'subject', (select name_ar from subjects where id = lp.subject_id), 'subject_id', lp.subject_id,
    'classes', coalesce((select jsonb_agg(vc.label order by vc.stage_sort, vc.grade_number, vc.name) from v_classes vc where vc.id = any (lp.class_ids)), '[]'::jsonb),
    'teacher', (select full_name from profiles where id = lp.teacher_id), 'teacher_id', lp.teacher_id,
    'submitted_at', lp.submitted_at, 'reviewed_at', lp.reviewed_at,
    'reviewer', (select full_name from profiles where id = lp.reviewed_by), 'note', lp.review_note, 'updated_at', lp.updated_at)
$$;

-- خيارات المعلم: مواده وفصوله من الإسناد
create or replace function public.lp_options() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'subjects', coalesce((select jsonb_agg(distinct jsonb_build_object('id', s.id, 'name', s.name_ar)) from teaching_assignments ta join subjects s on s.id = ta.subject_id where ta.teacher_id = public.me_id()), '[]'::jsonb),
    'classes', coalesce((select jsonb_agg(jsonb_build_object('id', vc.id, 'label', vc.label, 'subjects', x.subs) order by vc.stage_sort, vc.grade_number, vc.name)
                from (select class_id, jsonb_agg(distinct subject_id) subs from teaching_assignments where teacher_id = public.me_id() group by class_id) x join v_classes vc on vc.id = x.class_id), '[]'::jsonb),
    'is_teacher', exists (select 1 from teaching_assignments where teacher_id = public.me_id()),
    'can_review', exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id())
                  or (public.me_role() = 'principal' and exists (select 1 from (select distinct teacher_id from teaching_assignments) ta where private.lp_can_approve(ta.teacher_id))),
    'can_follow', public.me_role() in ('admin','leadership','principal','supervisor')
                  or exists (select 1 from v_teacher_supervisors where supervisor_id = public.me_id()))
$$;

-- القوائم: mine = تحاضيري، review = بانتظار اعتمادي، all = متابعة تحاضير من أنا مسؤول عنهم
create or replace function public.lp_list(p_box text default 'mine', p_from date default null, p_to date default null,
                                          p_teacher uuid default null, p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.me_id();
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((
    select jsonb_agg(private.lp_card(lp) order by lp.lesson_date desc, lp.id desc)
      from (select * from lesson_plans lp
             where (p_from is null or lp.lesson_date >= p_from) and (p_to is null or lp.lesson_date <= p_to)
               and (p_status is null or lp.status = p_status)
               and case p_box
                     when 'mine'   then lp.teacher_id = me
                     when 'review' then lp.status = 'submitted' and private.lp_can_approve(lp.teacher_id)
                     else (p_teacher is null or lp.teacher_id = p_teacher) and lp.status <> 'draft' and private.lp_is_reviewer(lp.teacher_id)
                   end
             order by lp.lesson_date desc, lp.id desc limit 500) lp), '[]'::jsonb);
end $$;

create or replace function public.lp_get(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare lp lesson_plans; mine boolean; rev boolean;
begin
  select * into lp from lesson_plans where id = p_id;
  if not found then raise exception 'التحضير غير موجود'; end if;
  mine := lp.teacher_id = public.me_id();
  rev  := private.lp_is_reviewer(lp.teacher_id);
  if not mine and not (rev and lp.status <> 'draft') then raise exception 'غير مصرح'; end if;
  return private.lp_card(lp) || jsonb_build_object('content', lp.content, 'class_ids', to_jsonb(lp.class_ids),
    'can_edit', mine and lp.status in ('draft','returned'),
    'can_review', lp.status = 'submitted' and private.lp_can_approve(lp.teacher_id), 'mine', mine);
end $$;

-- حفظ (إنشاء/تعديل) — للمعلم على تحضيره فقط وهو مسودة أو مُعاد
create or replace function public.lp_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := public.me_id(); lid bigint := nullif(p->>'id','')::bigint; cls int[]; sid int := nullif(p->>'subject_id','')::int;
        d date := nullif(p->>'date','')::date; ttl text := btrim(coalesce(p->>'title',''));
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if ttl = '' then raise exception 'اكتب عنوان الدرس'; end if;
  if d is null then raise exception 'اختر تاريخ الدرس'; end if;
  select coalesce(array_agg(distinct x::int), '{}') into cls from jsonb_array_elements_text(coalesce(p->'class_ids', '[]'::jsonb)) x;
  -- الفصول والمادة يجب أن تكون من إسناد المعلم نفسه
  if exists (select 1 from unnest(cls) c where not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.class_id = c)) then
    raise exception 'اختر من فصولك المسندة إليك فقط'; end if;
  if sid is not null and not exists (select 1 from teaching_assignments ta where ta.teacher_id = me and ta.subject_id = sid) then
    raise exception 'اختر من موادك المسندة إليك فقط'; end if;
  if jsonb_typeof(coalesce(p->'content', '{}'::jsonb)) <> 'object' or length((p->'content')::text) > 60000 then
    raise exception 'محتوى التحضير غير صالح أو طويل جدًا'; end if;
  if lid is null then
    insert into lesson_plans(teacher_id, subject_id, class_ids, lesson_date, title, content)
    values (me, sid, cls, d, left(ttl, 200), coalesce(p->'content', '{}'::jsonb)) returning id into lid;
  else
    update lesson_plans set subject_id = sid, class_ids = cls, lesson_date = d, title = left(ttl, 200),
           content = coalesce(p->'content', '{}'::jsonb), updated_at = now()
     where id = lid and teacher_id = me and status in ('draft','returned');
    if not found then raise exception 'لا يمكن تعديل هذا التحضير (أُرسل للاعتماد أو اعتُمد)'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', lid);
end $$;

create or replace function public.lp_submit(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update lesson_plans set status = 'submitted', submitted_at = now(), updated_at = now()
   where id = p_id and teacher_id = public.me_id() and status in ('draft','returned');
  if not found then raise exception 'لا يمكن إرسال هذا التحضير'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- سحب التحضير من الاعتماد لإعادة تعديله (قبل أن يُراجع)
create or replace function public.lp_unsubmit(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update lesson_plans set status = 'draft', updated_at = now()
   where id = p_id and teacher_id = public.me_id() and status = 'submitted';
  if not found then raise exception 'لا يمكن سحب هذا التحضير'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lp_review(p_id bigint, p_decision text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare lp lesson_plans;
begin
  select * into lp from lesson_plans where id = p_id for update;
  if not found then raise exception 'التحضير غير موجود'; end if;
  if lp.status <> 'submitted' or not private.lp_can_approve(lp.teacher_id) then raise exception 'اعتماد التحضير للمشرف التربوي فقط'; end if;
  if p_decision not in ('approve','return') then raise exception 'قرار غير صالح'; end if;
  if p_decision = 'return' and btrim(coalesce(p_note,'')) = '' then raise exception 'اكتب ملاحظاتك للمعلم عند الإعادة'; end if;
  update lesson_plans set status = case when p_decision = 'approve' then 'approved' else 'returned' end,
         reviewed_by = public.me_id(), reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note,'')), ''), updated_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.lp_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  delete from lesson_plans where id = p_id and teacher_id = public.me_id() and status in ('draft','returned');
  if not found then raise exception 'لا يمكن حذف هذا التحضير'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- نسخ تحضير سابق (للمعلم نفسه) إلى تاريخ جديد كمسودة
create or replace function public.lp_copy(p_id bigint, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare nid bigint;
begin
  insert into lesson_plans(teacher_id, subject_id, class_ids, lesson_date, title, content)
  select teacher_id, subject_id, class_ids, coalesce(p_date, lesson_date), title, content
    from lesson_plans where id = p_id and teacher_id = public.me_id()
  returning id into nid;
  if nid is null then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

revoke all on function private.lp_can_approve(uuid), private.lp_is_reviewer(uuid), private.lp_card(public.lesson_plans) from public, anon, authenticated;
revoke all on function public.lp_options(), public.lp_list(text, date, date, uuid, text), public.lp_get(bigint), public.lp_save(jsonb),
  public.lp_submit(bigint), public.lp_unsubmit(bigint), public.lp_review(bigint, text, text), public.lp_delete(bigint), public.lp_copy(bigint, date) from public, anon;
grant execute on function public.lp_options(), public.lp_list(text, date, date, uuid, text), public.lp_get(bigint), public.lp_save(jsonb),
  public.lp_submit(bigint), public.lp_unsubmit(bigint), public.lp_review(bigint, text, text), public.lp_delete(bigint), public.lp_copy(bigint, date) to authenticated;
