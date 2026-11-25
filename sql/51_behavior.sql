-- =====================================================================
-- 51: سجل السلوك والمواظبة — ملاحظات إيجابية/سلبية على الطلاب بقوالب جاهزة
--   • القوالب: قوالب المدرسة (يديرها مدير النظام والقيادات ومديرو المراحل والموجّهون الطلابيون)
--              + قوالب شخصية لكل منسوب (يضيفها ويعدّلها ويحذفها لنفسه)
--   • الملاحظة: لطالب أو عدة طلاب دفعة واحدة، مع إظهارها لولي الأمر أو لا، وإحالتها للموجّه الطلابي
--   • الرؤية: منسوبو المدرسة الذين يرون الطالب (نفس قاعدة ملف الإنجاز)، وولي الأمر يرى ما سُمح له فقط
--   • الإحالة: تصل رسالة للموجّه الطلابي ووكيل/مدير المرحلة حسب نطاقهم، ويسجّل الموجّه الإجراء ويغلقها
-- =====================================================================

create table if not exists public.bh_templates (
  id          bigserial primary key,
  owner_id    uuid references public.profiles(id) on delete cascade,     -- null = قالب المدرسة
  kind        text not null check (kind in ('positive','negative')),
  category    text not null default 'عام',
  text        text not null check (btrim(text) <> ''),
  points      smallint not null default 0,                               -- نقاط التميز (للإيجابية)
  degree      smallint check (degree between 1 and 5),                   -- درجة المخالفة (للسلبية)
  to_parent   boolean not null default true,
  refer       boolean not null default false,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists bh_templates_owner_idx on public.bh_templates (owner_id, kind, sort);

create table if not exists public.bh_notes (
  id           bigserial primary key,
  student_id   uuid not null references public.students(profile_id) on delete cascade,
  kind         text not null check (kind in ('positive','negative')),
  category     text not null default 'عام',
  text         text not null,
  details      text,
  points       smallint not null default 0,
  degree       smallint check (degree between 1 and 5),
  note_date    date not null default current_date,
  period       smallint,
  to_parent    boolean not null default true,
  refer        boolean not null default false,
  ref_status   text check (ref_status in ('open','closed')),
  ref_action   text,
  ref_by       uuid references public.profiles(id) on delete set null,
  ref_at       timestamptz,
  template_id  bigint references public.bh_templates(id) on delete set null,
  added_by     uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists bh_notes_student_idx on public.bh_notes (student_id, note_date desc);
create index if not exists bh_notes_date_idx on public.bh_notes (note_date desc, id desc);
create index if not exists bh_notes_ref_idx on public.bh_notes (ref_status) where refer;

alter table public.bh_templates enable row level security;
alter table public.bh_notes enable row level security;
revoke all on public.bh_templates, public.bh_notes from anon, authenticated;

-- ================= صلاحيات =================
-- يدير قوالب المدرسة ويتابع الإحالات: مدير النظام، القيادات، مديرو/وكلاء المراحل، الموجّهون والمرشدون الطلابيون
create or replace function private.bh_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership','principal') or p.job_title ~ '(موجه|موجّه|مرشد|توجيه|إرشاد|ارشاد)'))
$$;

-- منسوب يرى هذا الطالب
create or replace function private.bh_can(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and exists (select 1 from students s where s.profile_id = p_student
           and (public.can_view_student(p_student) or private.att_can(s.grade_id, s.class_id)))
$$;

-- الموجّهون ووكلاء/مديرو المرحلة المسؤولون عن الطالب (حسب نطاقاتهم)
create or replace function private.bh_responsible(p_student uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct p.id), '{}')
    from students s join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
    join staff_scopes sc on true join profiles p on p.id = sc.profile_id and p.active
   where s.profile_id = p_student
     and (p.job_title ~ '(موجه|موجّه|مرشد)' or p.role = 'principal')
     and sc.subject_id is null
     and (sc.section_id is null or sc.section_id = st.section_id)
     and (sc.stage_id is null or sc.stage_id = st.id)
     and (sc.grade_min is null or g.number >= sc.grade_min)
     and (sc.grade_max is null or g.number <= sc.grade_max)
$$;

create or replace function private.bh_card(n public.bh_notes) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', n.id, 'student_id', n.student_id, 'kind', n.kind, 'category', n.category, 'text', n.text, 'details', n.details,
    'points', n.points, 'degree', n.degree, 'date', n.note_date, 'period', n.period, 'to_parent', n.to_parent,
    'refer', n.refer, 'ref_status', n.ref_status, 'ref_action', n.ref_action, 'ref_at', n.ref_at,
    'ref_by', (select full_name from profiles where id = n.ref_by),
    'by', (select full_name from profiles where id = n.added_by), 'mine', n.added_by = public.me_id(), 'created_at', n.created_at)
$$;

-- ================= القوالب =================
create or replace function public.bh_templates_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('manager', private.bh_manager(),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'kind', t.kind, 'category', t.category, 'text', t.text, 'points', t.points,
                 'degree', t.degree, 'to_parent', t.to_parent, 'refer', t.refer, 'sort', t.sort, 'school', t.owner_id is null,
                 'uses', (select count(*) from bh_notes n where n.template_id = t.id))
               order by t.owner_id is not null, t.kind desc, t.category, t.sort, t.id)
     from bh_templates t where t.active and (t.owner_id is null or t.owner_id = public.me_id())), '[]'::jsonb));
end $$;

create or replace function public.bh_template_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); tid bigint := nullif(p->>'id','')::bigint; t bh_templates; school boolean := coalesce((p->>'school')::boolean, false);
        k text := p->>'kind'; tx text := btrim(coalesce(p->>'text','')); dg smallint := nullif(p->>'degree','')::smallint;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if tid is not null then
    select * into t from bh_templates where id = tid and active; if not found then raise exception 'القالب غير موجود'; end if;
    school := t.owner_id is null;
  end if;
  if school and not private.bh_manager() then raise exception 'قوالب المدرسة يعدّلها مدير النظام والقيادات ومديرو المراحل والموجّهون الطلابيون — أضف قالبًا شخصيًا لك'; end if;
  if not school and tid is not null and t.owner_id is distinct from me then raise exception 'غير مصرح'; end if;
  if k not in ('positive','negative') then raise exception 'اختر نوع الملاحظة'; end if;
  if tx = '' then raise exception 'اكتب نص الملاحظة'; end if;
  if k = 'negative' and (dg is null or dg not between 1 and 5) then dg := 1; end if;
  if k = 'positive' then dg := null; end if;
  if tid is null then
    insert into bh_templates(owner_id, kind, category, text, points, degree, to_parent, refer, sort)
    values (case when school then null else me end, k, coalesce(nullif(left(btrim(p->>'category'), 40), ''), 'عام'), left(tx, 300),
            case when k = 'positive' then greatest(0, least(coalesce(nullif(p->>'points','')::int, 1), 20)) else 0 end, dg,
            coalesce((p->>'to_parent')::boolean, true), coalesce((p->>'refer')::boolean, false),
            coalesce(nullif(p->>'sort','')::int, (select coalesce(max(sort), 0) + 1 from bh_templates)))
    returning id into tid;
  else
    update bh_templates set kind = k, category = coalesce(nullif(left(btrim(p->>'category'), 40), ''), 'عام'), text = left(tx, 300),
           points = case when k = 'positive' then greatest(0, least(coalesce(nullif(p->>'points','')::int, 1), 20)) else 0 end, degree = dg,
           to_parent = coalesce((p->>'to_parent')::boolean, true), refer = coalesce((p->>'refer')::boolean, false),
           sort = coalesce(nullif(p->>'sort','')::int, sort)
     where id = tid;
  end if;
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

-- الحذف: القالب المستخدم يُخفى (تبقى ملاحظاته كما هي)، وغير المستخدم يُحذف نهائيًا
create or replace function public.bh_template_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t bh_templates;
begin
  select * into t from bh_templates where id = p_id and active; if not found then raise exception 'القالب غير موجود'; end if;
  if t.owner_id is null and not private.bh_manager() then raise exception 'غير مصرح'; end if;
  if t.owner_id is not null and t.owner_id is distinct from public.me_id() then raise exception 'غير مصرح'; end if;
  if exists (select 1 from bh_notes where template_id = p_id) then update bh_templates set active = false where id = p_id;
  else delete from bh_templates where id = p_id; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ================= تسجيل الملاحظات =================
-- p: {students:[uuid], template_id?, kind, category, text, details, points, degree, date, period, to_parent, refer}
create or replace function public.bh_note_add(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare me uuid := public.me_id(); sid uuid; n int := 0; k text := p->>'kind'; tx text := btrim(coalesce(p->>'text',''));
        dg smallint := nullif(p->>'degree','')::smallint; ref boolean := coalesce((p->>'refer')::boolean, false);
        d date := coalesce(nullif(p->>'date','')::date, current_date); nid bigint; ids bigint[] := '{}'; who uuid[]; mid bigint;
        names text; tpl bigint := nullif(p->>'template_id','')::bigint;
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  if k not in ('positive','negative') then raise exception 'اختر نوع الملاحظة'; end if;
  if tx = '' then raise exception 'اختر قالبًا أو اكتب نص الملاحظة'; end if;
  if jsonb_array_length(coalesce(p->'students','[]'::jsonb)) = 0 then raise exception 'اختر طالبًا واحدًا على الأقل'; end if;
  if jsonb_array_length(p->'students') > 60 then raise exception 'الحد الأقصى 60 طالبًا في المرة الواحدة'; end if;
  if d > current_date or d < current_date - 60 then raise exception 'التاريخ يجب أن يكون خلال آخر 60 يومًا'; end if;
  if tpl is not null and not exists (select 1 from bh_templates where id = tpl and (owner_id is null or owner_id = me)) then tpl := null; end if;
  if k = 'positive' then dg := null; ref := false; elsif dg is null or dg not between 1 and 5 then dg := 1; end if;
  for sid in select (x)::uuid from jsonb_array_elements_text(p->'students') x loop
    if not private.bh_can(sid) then raise exception 'غير مصرح لك بأحد الطلاب المختارين'; end if;
    insert into bh_notes(student_id, kind, category, text, details, points, degree, note_date, period, to_parent, refer, ref_status, template_id, added_by)
    values (sid, k, coalesce(nullif(left(btrim(p->>'category'), 40), ''), 'عام'), left(tx, 300), nullif(left(btrim(coalesce(p->>'details','')), 2000), ''),
            case when k = 'positive' then greatest(0, least(coalesce(nullif(p->>'points','')::int, 0), 20)) else 0 end, dg, d,
            nullif(p->>'period','')::smallint, coalesce((p->>'to_parent')::boolean, true), ref, case when ref then 'open' end, tpl, me)
    returning id into nid;
    ids := ids || nid; n := n + 1;
    -- إحالة: رسالة للموجّه الطلابي ووكيل/مدير المرحلة
    if ref then
      who := private.bh_responsible(sid);
      if coalesce(array_length(who, 1), 0) > 0 then
        begin
          select full_name into names from profiles where id = sid;
          insert into messages(kind, sender_id, subject, body, audience)
          values ('mail', me, left('إحالة سلوكية: ' || names, 200),
                  'الطالب: ' || names || coalesce(' — ' || (select label from v_classes where id = (select class_id from students where profile_id = sid)), '') || E'\n' ||
                  'الملاحظة: ' || tx || ' (الدرجة ' || dg || ')' || E'\n' || coalesce('التفاصيل: ' || nullif(btrim(p->>'details'), '') || E'\n', '') ||
                  'التاريخ: ' || d || E'\n\nلتسجيل الإجراء: المنصة ← سجل السلوك ← الإحالات', 'سجل السلوك')
          returning id into mid;
          insert into message_recipients(message_id, profile_id) select mid, x from unnest(who) x where x is distinct from me on conflict do nothing;
        exception when others then null;
        end;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'count', n, 'ids', to_jsonb(ids));
end $$;

-- حذف ملاحظة: كاتبها أو من يدير السلوك
create or replace function public.bh_note_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n bh_notes;
begin
  select * into n from bh_notes where id = p_id; if not found then raise exception 'غير موجودة'; end if;
  if not ((n.added_by = public.me_id() or private.bh_manager()) and private.bh_can(n.student_id)) then raise exception 'يحذف الملاحظة كاتبها أو الموجّه/الإدارة'; end if;
  delete from bh_notes where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- تعديل إظهار الملاحظة لولي الأمر
create or replace function public.bh_note_parent(p_id bigint, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n bh_notes;
begin
  select * into n from bh_notes where id = p_id; if not found then raise exception 'غير موجودة'; end if;
  if not ((n.added_by = public.me_id() or private.bh_manager()) and private.bh_can(n.student_id)) then raise exception 'غير مصرح'; end if;
  update bh_notes set to_parent = coalesce(p_on, false) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- الإحالات (للموجّه والإدارة) — p_status: open | closed | null (الكل)
create or replace function public.bh_referrals(p_status text default 'open') returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.bh_manager() then raise exception 'الإحالات للموجّه الطلابي والإدارة'; end if;
  return coalesce((select jsonb_agg(private.bh_card(n) || jsonb_build_object('student', p.full_name, 'class', vc.label) order by n.ref_status, n.note_date desc, n.id desc)
    from (select * from bh_notes where refer and (p_status is null or ref_status = p_status) order by note_date desc limit 500) n
    join profiles p on p.id = n.student_id join students s on s.profile_id = n.student_id left join v_classes vc on vc.id = s.class_id
   where private.bh_can(n.student_id)), '[]'::jsonb);
end $$;

create or replace function public.bh_referral_set(p_id bigint, p_action text, p_close boolean default true) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare n bh_notes; mid bigint;
begin
  select * into n from bh_notes where id = p_id and refer; if not found then raise exception 'الإحالة غير موجودة'; end if;
  if not (private.bh_manager() and private.bh_can(n.student_id)) then raise exception 'غير مصرح'; end if;
  if btrim(coalesce(p_action,'')) = '' then raise exception 'اكتب الإجراء المتخذ'; end if;
  update bh_notes set ref_action = left(btrim(p_action), 2000), ref_by = public.me_id(), ref_at = now(),
         ref_status = case when p_close then 'closed' else 'open' end where id = p_id;
  -- إشعار المعلم صاحب الإحالة بالإجراء
  if n.added_by is not null and n.added_by <> public.me_id() then
    begin
      insert into messages(kind, sender_id, subject, body, audience)
      values ('mail', public.me_id(), left('إجراء على إحالتك: ' || (select full_name from profiles where id = n.student_id), 200),
              'الملاحظة: ' || n.text || E'\n' || 'الإجراء: ' || btrim(p_action) || E'\n' || case when p_close then 'الحالة: أُغلقت الإحالة' else 'الحالة: قيد المتابعة' end, 'سجل السلوك')
      returning id into mid;
      insert into message_recipients(message_id, profile_id) values (mid, n.added_by) on conflict do nothing;
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- ================= العرض =================
-- سجل الملاحظات ضمن نطاقي: p_scope mine | all ؛ مع فلاتر
create or replace function public.bh_feed(p_scope text default 'mine', p_kind text default null, p_from date default null, p_to date default null, p_class int default null)
returns jsonb language plpgsql stable security definer set search_path = public, private as $$
declare me uuid := public.me_id();
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.bh_card(n) || jsonb_build_object('student', p.full_name, 'class', vc.label) order by n.note_date desc, n.id desc)
    from (select * from bh_notes n
           where (p_scope <> 'mine' or n.added_by = me) and (p_kind is null or n.kind = p_kind)
             and n.note_date between coalesce(p_from, current_date - 30) and coalesce(p_to, current_date)
             and (p_class is null or exists (select 1 from students s where s.profile_id = n.student_id and s.class_id = p_class))
           order by n.note_date desc, n.id desc limit 800) n
    join profiles p on p.id = n.student_id join students s on s.profile_id = n.student_id left join v_classes vc on vc.id = s.class_id
   where n.added_by = me or private.bh_can(n.student_id)), '[]'::jsonb);
end $$;

-- ملف سلوك طالب
create or replace function public.bh_student(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare s students;
begin
  if not private.bh_can(p_student) then raise exception 'غير مصرح'; end if;
  select * into s from students where profile_id = p_student;
  return jsonb_build_object('student', jsonb_build_object('id', p_student, 'name', (select full_name from profiles where id = p_student),
      'class', (select label from v_classes where id = s.class_id), 'no', s.student_number),
    'manager', private.bh_manager(),
    'points', (select coalesce(sum(points), 0) from bh_notes where student_id = p_student and kind = 'positive'),
    'pos', (select count(*) from bh_notes where student_id = p_student and kind = 'positive'),
    'neg', (select count(*) from bh_notes where student_id = p_student and kind = 'negative'),
    'notes', coalesce((select jsonb_agg(private.bh_card(n) order by n.note_date desc, n.id desc) from bh_notes n where n.student_id = p_student), '[]'::jsonb));
end $$;

-- قائمة طلاب صف/فصل مع ملخص سلوكهم (لاختيار الطلاب)
create or replace function public.bh_roster(p_grade int, p_class int default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.att_can(p_grade, p_class) then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.profile_id, 'name', p.full_name, 'no', s.student_number, 'class', c.name,
             'points', (select coalesce(sum(points), 0) from bh_notes n where n.student_id = s.profile_id and n.kind = 'positive'),
             'neg', (select count(*) from bh_notes n where n.student_id = s.profile_id and n.kind = 'negative' and n.note_date >= current_date - 30))
           order by c.name nulls last, p.full_name)
    from students s join profiles p on p.id = s.profile_id left join classes c on c.id = s.class_id
   where p.active and s.grade_id = p_grade and (p_class is null or s.class_id = p_class)), '[]'::jsonb);
end $$;

-- إحصاء (للإدارة/الموجّه): أكثر الملاحظات، وأعلى الطلاب نقاطًا، والأكثر مخالفات (آخر 30 يومًا ضمن النطاق)
create or replace function public.bh_stats(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare f date := coalesce(p_from, current_date - 30); t date := coalesce(p_to, current_date);
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return (with n as (select * from bh_notes where note_date between f and t and private.bh_can(student_id))
    select jsonb_build_object(
      'pos', (select count(*) from n where kind = 'positive'), 'neg', (select count(*) from n where kind = 'negative'),
      'open_ref', (select count(*) from n where refer and ref_status = 'open'),
      'top_texts', coalesce((select jsonb_agg(x) from (select jsonb_build_object('kind', kind, 'text', text, 'n', count(*)) x from n group by kind, text order by count(*) desc limit 10) z), '[]'::jsonb),
      'top_points', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', n.student_id, 'name', p.full_name, 'class', vc.label, 'points', sum(n.points)) x
            from n join profiles p on p.id = n.student_id join students s on s.profile_id = n.student_id left join v_classes vc on vc.id = s.class_id
           where n.kind = 'positive' group by n.student_id, p.full_name, vc.label order by sum(n.points) desc limit 10) z), '[]'::jsonb),
      'top_neg', coalesce((select jsonb_agg(x) from (select jsonb_build_object('id', n.student_id, 'name', p.full_name, 'class', vc.label, 'n', count(*), 'max_degree', max(n.degree)) x
            from n join profiles p on p.id = n.student_id join students s on s.profile_id = n.student_id left join v_classes vc on vc.id = s.class_id
           where n.kind = 'negative' group by n.student_id, p.full_name, vc.label order by count(*) desc, max(n.degree) desc limit 10) z), '[]'::jsonb)));
end $$;

-- ================= ولي الأمر (بوابة الرمز السري) =================
create or replace function private.child_behavior(p_student uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'points', (select coalesce(sum(points), 0) from bh_notes where student_id = p_student and kind = 'positive' and to_parent),
    'notes', coalesce((select jsonb_agg(jsonb_build_object('kind', n.kind, 'category', n.category, 'text', n.text, 'details', n.details, 'points', n.points,
                 'date', n.note_date, 'by', (select full_name from profiles where id = n.added_by)) order by n.note_date desc, n.id desc)
               from (select * from bh_notes where student_id = p_student and to_parent and note_date >= current_date - 90 order by note_date desc, id desc limit 60) n), '[]'::jsonb))
$$;

create or replace function private.child_summary(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s students; f date := current_date - 60;
begin
  select * into s from students where profile_id = p_student;
  if s.profile_id is null then return null; end if;
  return jsonb_build_object(
    'id', s.profile_id, 'name', (select full_name from profiles where id = s.profile_id),
    'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = s.grade_id),
    'class', (select name from classes where id = s.class_id),
    'teachers', coalesce((select jsonb_agg(distinct jsonb_build_object('name', p.full_name, 'subject', sb.name_ar))
                 from teaching_assignments ta join classes c on c.id = ta.class_id join profiles p on p.id = ta.teacher_id and p.active
                 join subjects sb on sb.id = ta.subject_id
                 where (s.class_id is not null and ta.class_id = s.class_id) or (s.class_id is null and c.grade_id = s.grade_id)), '[]'::jsonb),
    'attendance', jsonb_build_object(
      'days_taken', (select count(distinct a.day) from attendance_sessions a where a.grade_id = s.grade_id and a.period = 0
                      and (a.class_id is null or a.class_id = s.class_id) and a.day >= f),
      'absent',  (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'absent'),
      'late',    (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'late'),
      'excused', (select count(*) from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.period = 0 and a.day >= f and m.status = 'excused'),
      'recent',  coalesce((select jsonb_agg(jsonb_build_object('d', a.day, 'p', a.period, 's', m.status, 'n', m.note) order by a.day desc, a.period)
                  from attendance_marks m join attendance_sessions a on a.id = m.session_id where m.student_id = s.profile_id and a.day >= f), '[]'::jsonb)),
    'behavior', private.child_behavior(s.profile_id));
end $$;

-- ================= قوالب جاهزة (تُضاف مرة واحدة) =================
insert into public.bh_templates(owner_id, kind, category, text, points, degree, to_parent, refer, sort)
select null, x.kind, x.category, x.text, x.points, x.degree, x.to_parent, x.refer, x.sort
from (values
  ('positive','مشاركة','شارك بفاعلية في الحصة',2,null::smallint,true,false,1),
  ('positive','مشاركة','قدّم إجابة متميزة أو سؤالًا عميقًا',2,null,true,false,2),
  ('positive','انضباط','التزم بالهدوء والنظام طوال الحصة',1,null,true,false,3),
  ('positive','انضباط','حضر مبكرًا ومستعدًا بكتبه وأدواته',1,null,true,false,4),
  ('positive','تعاون','ساعد زميله في فهم الدرس',2,null,true,false,5),
  ('positive','تعاون','عمل بروح الفريق في النشاط الجماعي',2,null,true,false,6),
  ('positive','إنجاز','أنجز واجبه بإتقان',2,null,true,false,7),
  ('positive','إنجاز','قدّم عملًا إبداعيًا مميزًا',3,null,true,false,8),
  ('positive','إنجاز','تحسّن ملحوظ في مستواه',2,null,true,false,9),
  ('positive','قيم','أظهر الأمانة والصدق',3,null,true,false,10),
  ('positive','قيم','بادر بخدمة زملائه أو بعمل تطوعي',3,null,true,false,11),
  ('positive','قيم','حافظ على نظافة الفصل وممتلكات المدرسة',1,null,true,false,12),
  ('negative','انضباط','التأخر عن الحصة دون عذر',0,1::smallint,false,false,20),
  ('negative','انضباط','عدم إحضار الكتب والأدوات',0,1,false,false,21),
  ('negative','انضباط','الحديث الجانبي وإزعاج الحصة',0,1,false,false,22),
  ('negative','انضباط','النوم أثناء الحصة',0,1,true,false,23),
  ('negative','واجبات','عدم حل الواجب',0,1,true,false,24),
  ('negative','انضباط','عدم الالتزام بالزي المدرسي',0,1,true,false,25),
  ('negative','انضباط','استخدام الجوال أثناء الحصة',0,2,true,false,26),
  ('negative','انضباط','الخروج من الحصة دون استئذان',0,2,true,false,27),
  ('negative','أمانة','الغش في اختبار أو واجب',0,2,true,true,28),
  ('negative','تعامل','عدم احترام المعلم أو التلفظ بألفاظ غير لائقة',0,3,true,true,29),
  ('negative','تعامل','التنمر على زميل أو السخرية منه',0,3,true,true,30),
  ('negative','تعامل','الشجار مع زميل',0,3,true,true,31),
  ('negative','ممتلكات','إتلاف ممتلكات المدرسة',0,3,true,true,32)
) as x(kind, category, text, points, degree, to_parent, refer, sort)
where not exists (select 1 from public.bh_templates where owner_id is null);

-- ================= الصلاحيات =================
revoke all on function private.bh_manager(), private.bh_can(uuid), private.bh_responsible(uuid), private.bh_card(public.bh_notes),
  private.child_behavior(uuid), private.child_summary(uuid) from public, anon, authenticated;
revoke all on function public.bh_templates_list(), public.bh_template_save(jsonb), public.bh_template_delete(bigint), public.bh_note_add(jsonb),
  public.bh_note_delete(bigint), public.bh_note_parent(bigint, boolean), public.bh_referrals(text), public.bh_referral_set(bigint, text, boolean),
  public.bh_feed(text, text, date, date, int), public.bh_student(uuid), public.bh_roster(int, int), public.bh_stats(date, date) from public, anon;
grant execute on function public.bh_templates_list(), public.bh_template_save(jsonb), public.bh_template_delete(bigint), public.bh_note_add(jsonb),
  public.bh_note_delete(bigint), public.bh_note_parent(bigint, boolean), public.bh_referrals(text), public.bh_referral_set(bigint, text, boolean),
  public.bh_feed(text, text, date, date, int), public.bh_student(uuid), public.bh_roster(int, int), public.bh_stats(date, date) to authenticated;
