-- =====================================================================
-- 53: الموهبة والمسابقات — قاعدة الموهوبين + المسابقات والترشيح والنتائج + المؤشرات
--   • المدير: مدير النظام، القيادات، ومن مسمّاه يحوي «موهبة/مسابقات» (المنسق التنفيذي)، ومسؤول كل مسابقة لمسابقته
--   • المنسوبون (معلم/مشرف/مدير مرحلة) يرون المسابقات ويرشّحون طلابًا يرونهم
--   • الفوز (awarded) يُضاف تلقائيًا لملف إنجاز الطالب معتمدًا
-- =====================================================================
create table if not exists public.tl_competitions (
  id           bigserial primary key,
  name         text not null check (btrim(name) <> ''),
  field        text not null default 'other' check (field in ('math','science','informatics','robotics','research','innovation','language','quran','arts','sports','other')),
  organizer    text,
  level        text not null default 'national' check (level in ('school','district','national','international')),
  stages       text,                         -- الفئة المستهدفة (نص حر: ابتدائي عليا، متوسط…)
  priority     smallint not null default 2 check (priority between 1 and 3),
  year         text,
  reg_deadline date,
  test_date    date,
  final_date   date,
  link         text,
  owner_id     uuid references public.profiles(id) on delete set null,
  notes        text,
  active       boolean not null default true,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.tl_entries (
  id           bigserial primary key,
  comp_id      bigint not null references public.tl_competitions(id) on delete cascade,
  student_id   uuid not null references public.students(profile_id) on delete cascade,
  status       text not null default 'nominated' check (status in ('nominated','training','registered','participated','qualified','awarded','withdrawn')),
  result       text,
  award_level  text check (award_level in ('gold','silver','bronze','honorable','qualified','other')),
  notes        text,
  nominated_by uuid references public.profiles(id) on delete set null,
  pf_item_id   bigint,
  updated_at   timestamptz not null default now(),
  unique (comp_id, student_id)
);
create index if not exists tl_entries_student_idx on public.tl_entries (student_id);

create table if not exists public.tl_pool (
  student_id      uuid primary key references public.students(profile_id) on delete cascade,
  fields          text[] not null default '{}',
  mawhiba_score   numeric,
  mawhiba_year    text,
  mawhiba_class   boolean not null default false,
  duroob          boolean not null default false,
  notes           text,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

alter table public.tl_competitions enable row level security;
alter table public.tl_entries enable row level security;
alter table public.tl_pool enable row level security;
revoke all on public.tl_competitions, public.tl_entries, public.tl_pool from anon, authenticated;

create or replace function private.tl_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership') or p.job_title ~ '(موهبة|موهوب|مسابقات|الموهوبين)'))
$$;
create or replace function private.tl_can_comp(p_comp bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select private.tl_manager() or exists (select 1 from tl_competitions where id = p_comp and owner_id = public.me_id())
$$;
create or replace function private.tl_sees(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (private.tl_manager() or exists (select 1 from students s where s.profile_id = p_student
           and (public.can_view_student(p_student) or private.att_can(s.grade_id, s.class_id))))
$$;

create or replace function private.tl_comp_json(c public.tl_competitions) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select to_jsonb(c) - 'created_by' || jsonb_build_object('owner', (select full_name from profiles where id = c.owner_id),
    'can_edit', private.tl_can_comp(c.id),
    'counts', (select jsonb_object_agg(status, n) from (select status, count(*) n from tl_entries where comp_id = c.id group by status) z),
    'total', (select count(*) from tl_entries where comp_id = c.id))
$$;

-- ================= المسابقات =================
create or replace function public.tl_comps(p_all boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('manager', private.tl_manager(),
    'items', coalesce((select jsonb_agg(private.tl_comp_json(c) order by c.priority, coalesce(c.reg_deadline, c.test_date, c.final_date) nulls last, c.name)
               from tl_competitions c where c.active or (p_all and private.tl_manager())), '[]'::jsonb));
end $$;

create or replace function public.tl_comp_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare cid bigint := nullif(p->>'id','')::bigint; nm text := btrim(coalesce(p->>'name',''));
begin
  if cid is null and not private.tl_manager() then raise exception 'إضافة المسابقات للمنسق التنفيذي والإدارة'; end if;
  if cid is not null and not private.tl_can_comp(cid) then raise exception 'غير مصرح'; end if;
  if nm = '' then raise exception 'اكتب اسم المسابقة'; end if;
  if nullif(btrim(coalesce(p->>'link','')), '') is not null and p->>'link' !~* '^https?://' then raise exception 'الرابط يجب أن يبدأ بـ https://'; end if;
  if cid is null then
    insert into tl_competitions(name, field, organizer, level, stages, priority, year, reg_deadline, test_date, final_date, link, owner_id, notes, created_by)
    values (left(nm, 150), coalesce(nullif(p->>'field',''), 'other'), nullif(left(btrim(coalesce(p->>'organizer','')), 120), ''), coalesce(nullif(p->>'level',''), 'national'),
            nullif(left(btrim(coalesce(p->>'stages','')), 120), ''), coalesce(nullif(p->>'priority','')::smallint, 2), nullif(btrim(coalesce(p->>'year','')), ''),
            nullif(p->>'reg_deadline','')::date, nullif(p->>'test_date','')::date, nullif(p->>'final_date','')::date, nullif(btrim(coalesce(p->>'link','')), ''),
            nullif(p->>'owner_id','')::uuid, nullif(left(btrim(coalesce(p->>'notes','')), 2000), ''), public.me_id())
    returning id into cid;
  else
    update tl_competitions set name = left(nm, 150), field = coalesce(nullif(p->>'field',''), field), organizer = nullif(left(btrim(coalesce(p->>'organizer','')), 120), ''),
           level = coalesce(nullif(p->>'level',''), level), stages = nullif(left(btrim(coalesce(p->>'stages','')), 120), ''), priority = coalesce(nullif(p->>'priority','')::smallint, priority),
           year = nullif(btrim(coalesce(p->>'year','')), ''), reg_deadline = nullif(p->>'reg_deadline','')::date, test_date = nullif(p->>'test_date','')::date,
           final_date = nullif(p->>'final_date','')::date, link = nullif(btrim(coalesce(p->>'link','')), ''),
           owner_id = case when private.tl_manager() then nullif(p->>'owner_id','')::uuid else owner_id end,
           notes = nullif(left(btrim(coalesce(p->>'notes','')), 2000), ''), active = coalesce((p->>'active')::boolean, active)
     where id = cid;
  end if;
  return jsonb_build_object('ok', true, 'id', cid);
end $$;

create or replace function public.tl_comp_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.tl_manager() then raise exception 'غير مصرح'; end if;
  if exists (select 1 from tl_entries where comp_id = p_id and status in ('participated','qualified','awarded')) then
    update tl_competitions set active = false where id = p_id;   -- فيها نتائج: تُؤرشف ولا تُحذف
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from tl_competitions where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ================= المشاركون =================
create or replace function public.tl_entries_of(p_comp bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare c tl_competitions;
begin
  select * into c from tl_competitions where id = p_comp; if not found or not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('comp', private.tl_comp_json(c),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'student_id', e.student_id, 'name', p.full_name, 'class', vc.label, 'status', e.status,
                 'result', e.result, 'award_level', e.award_level, 'notes', e.notes, 'by', (select full_name from profiles where id = e.nominated_by),
                 'mine', e.nominated_by = public.me_id(), 'in_pool', exists (select 1 from tl_pool t where t.student_id = e.student_id)) order by e.status, p.full_name)
               from tl_entries e join profiles p on p.id = e.student_id join students s on s.profile_id = e.student_id left join v_classes vc on vc.id = s.class_id
              where e.comp_id = p_comp and (private.tl_can_comp(p_comp) or private.tl_sees(e.student_id))), '[]'::jsonb));
end $$;

-- ترشيح طلاب (أي منسوب يرى الطالب)
create or replace function public.tl_nominate(p_comp bigint, p_students uuid[], p_notes text default null) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid uuid; n int := 0; c tl_competitions; mid bigint;
begin
  select * into c from tl_competitions where id = p_comp and active; if not found then raise exception 'المسابقة غير موجودة'; end if;
  foreach sid in array coalesce(p_students, '{}') loop
    if not private.tl_sees(sid) then raise exception 'غير مصرح لك بأحد الطلاب'; end if;
    insert into tl_entries(comp_id, student_id, notes, nominated_by) values (p_comp, sid, nullif(left(btrim(coalesce(p_notes,'')), 500), ''), public.me_id())
    on conflict (comp_id, student_id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  -- إشعار مسؤول المسابقة
  if n > 0 and c.owner_id is not null and c.owner_id <> public.me_id() then
    begin
      insert into messages(kind, sender_id, subject, body, audience) values ('mail', public.me_id(), left('ترشيح جديد: ' || c.name, 200),
        n || ' طالب رُشّحوا لمسابقة «' || c.name || '». راجعهم من: المنصة ← الموهبة والمسابقات.', 'الموهبة والمسابقات') returning id into mid;
      insert into message_recipients(message_id, profile_id) values (mid, c.owner_id) on conflict do nothing;
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'added', n);
end $$;

-- تحديث حالة/نتيجة مشارك (مسؤول المسابقة أو المنسق)
create or replace function public.tl_entry_set(p_id bigint, p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare e tl_entries; c tl_competitions; st text := coalesce(p->>'status',''); lv text; pid bigint;
begin
  select * into e from tl_entries where id = p_id; if not found then raise exception 'غير موجود'; end if;
  select * into c from tl_competitions where id = e.comp_id;
  if not private.tl_can_comp(e.comp_id) then raise exception 'تحديث النتائج لمسؤول المسابقة والمنسق'; end if;
  if st not in ('nominated','training','registered','participated','qualified','awarded','withdrawn') then raise exception 'حالة غير صالحة'; end if;
  update tl_entries set status = st, result = nullif(left(btrim(coalesce(p->>'result','')), 150), ''), award_level = nullif(p->>'award_level',''),
         notes = nullif(left(btrim(coalesce(p->>'notes','')), 500), ''), updated_at = now() where id = p_id returning * into e;
  -- الفوز أو التأهل يُسجَّل في ملف إنجاز الطالب (مرة واحدة، ويُحدَّث بعدها)
  if st in ('awarded','qualified') then
    lv := case c.level when 'school' then 'school' when 'district' then 'district' when 'international' then 'international' else 'national' end;
    if e.pf_item_id is not null and exists (select 1 from pf_items where id = e.pf_item_id) then
      update pf_items set result = coalesce(e.result, case st when 'awarded' then 'فائز' else 'متأهل' end), kind = case when st = 'awarded' then 'award' else 'competition' end, updated_at = now()
       where id = e.pf_item_id;
    else
      insert into pf_items(student_id, kind, title, description, item_date, level, result, status, added_by, reviewed_by, reviewed_at)
      values (e.student_id, case when st = 'awarded' then 'award' else 'competition' end, left(c.name, 200), c.organizer,
              coalesce(c.final_date, c.test_date, current_date), lv, coalesce(e.result, case st when 'awarded' then 'فائز' else 'متأهل' end), 'approved', public.me_id(), public.me_id(), now())
      returning id into pid;
      update tl_entries set pf_item_id = pid where id = p_id;
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tl_entry_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare e tl_entries;
begin
  select * into e from tl_entries where id = p_id; if not found then raise exception 'غير موجود'; end if;
  if not (private.tl_can_comp(e.comp_id) or (e.nominated_by = public.me_id() and e.status = 'nominated')) then raise exception 'غير مصرح'; end if;
  delete from tl_entries where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ================= قاعدة الموهوبين =================
create or replace function public.tl_pool_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('manager', private.tl_manager(),
    'items', coalesce((select jsonb_agg(jsonb_build_object('student_id', t.student_id, 'name', p.full_name, 'class', vc.label, 'fields', t.fields,
                 'mawhiba_score', t.mawhiba_score, 'mawhiba_year', t.mawhiba_year, 'mawhiba_class', t.mawhiba_class, 'duroob', t.duroob, 'notes', t.notes,
                 'entries', (select count(*) from tl_entries e where e.student_id = t.student_id),
                 'awards', (select count(*) from tl_entries e where e.student_id = t.student_id and e.status = 'awarded')) order by p.full_name)
               from tl_pool t join profiles p on p.id = t.student_id and p.active join students s on s.profile_id = t.student_id left join v_classes vc on vc.id = s.class_id
              where private.tl_sees(t.student_id)), '[]'::jsonb));
end $$;

create or replace function public.tl_pool_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare sid uuid := (p->>'student_id')::uuid;
begin
  if not (private.tl_manager() and private.tl_sees(sid)) then raise exception 'قاعدة الموهوبين يديرها المنسق التنفيذي والإدارة'; end if;
  insert into tl_pool(student_id, fields, mawhiba_score, mawhiba_year, mawhiba_class, duroob, notes, updated_by, updated_at)
  values (sid, coalesce(array(select jsonb_array_elements_text(coalesce(p->'fields','[]'::jsonb))), '{}'), nullif(p->>'mawhiba_score','')::numeric,
          nullif(btrim(coalesce(p->>'mawhiba_year','')), ''), coalesce((p->>'mawhiba_class')::boolean, false), coalesce((p->>'duroob')::boolean, false),
          nullif(left(btrim(coalesce(p->>'notes','')), 1000), ''), public.me_id(), now())
  on conflict (student_id) do update set fields = excluded.fields, mawhiba_score = excluded.mawhiba_score, mawhiba_year = excluded.mawhiba_year,
     mawhiba_class = excluded.mawhiba_class, duroob = excluded.duroob, notes = excluded.notes, updated_by = excluded.updated_by, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.tl_pool_remove(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if not private.tl_manager() then raise exception 'غير مصرح'; end if;
  delete from tl_pool where student_id = p_student;
  return jsonb_build_object('ok', true);
end $$;

-- ملف موهبة طالب: المسابقات التي شارك فيها عبر السنوات
create or replace function public.tl_student(p_student uuid) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.tl_sees(p_student) then raise exception 'غير مصرح'; end if;
  return jsonb_build_object('name', (select full_name from profiles where id = p_student),
    'pool', (select to_jsonb(t) - 'updated_by' from tl_pool t where t.student_id = p_student),
    'entries', coalesce((select jsonb_agg(jsonb_build_object('comp', c.name, 'field', c.field, 'level', c.level, 'year', c.year, 'status', e.status, 'result', e.result,
                 'date', coalesce(c.final_date, c.test_date, c.reg_deadline)) order by coalesce(c.final_date, c.test_date, c.reg_deadline) desc nulls last)
               from tl_entries e join tl_competitions c on c.id = e.comp_id where e.student_id = p_student), '[]'::jsonb));
end $$;

-- ================= المؤشرات =================
create or replace function public.tl_kpis(p_year text default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not public.is_staff() then raise exception 'غير مصرح'; end if;
  return (with c as (select * from tl_competitions where (p_year is null or year = p_year)),
               e as (select e.* from tl_entries e join c on c.id = e.comp_id where private.tl_sees(e.student_id) or private.tl_manager())
    select jsonb_build_object(
      'competitions', (select count(*) from c), 'priority1', (select count(*) from c where priority = 1),
      'nominated', (select count(distinct student_id) from e),
      'participants', (select count(distinct student_id) from e where status in ('participated','qualified','awarded')),
      'qualified', (select count(*) from e where status in ('qualified','awarded')),
      'awards', (select count(*) from e where status = 'awarded'),
      'medals', (select jsonb_object_agg(award_level, n) from (select award_level, count(*) n from e where status = 'awarded' and award_level is not null group by award_level) z),
      'pool', (select count(*) from tl_pool), 'mawhiba_class', (select count(*) from tl_pool where mawhiba_class), 'duroob', (select count(*) from tl_pool where duroob),
      'funnel', jsonb_build_object(
        'nominated', (select count(*) from e where status <> 'withdrawn'),
        'registered', (select count(*) from e where status in ('registered','participated','qualified','awarded')),
        'participated', (select count(*) from e where status in ('participated','qualified','awarded')),
        'qualified', (select count(*) from e where status in ('qualified','awarded')),
        'awarded', (select count(*) from e where status = 'awarded')),
      'by_field', coalesce((select jsonb_agg(x) from (select jsonb_build_object('field', c.field, 'comps', count(distinct c.id),
              'participants', count(e.id) filter (where e.status in ('participated','qualified','awarded')), 'awards', count(e.id) filter (where e.status = 'awarded')) x
            from c left join e on e.comp_id = c.id group by c.field order by count(e.id) desc) z), '[]'::jsonb),
      'by_comp', coalesce((select jsonb_agg(x) from (select jsonb_build_object('name', c.name, 'level', c.level, 'priority', c.priority,
              'nominated', count(e.id), 'participated', count(e.id) filter (where e.status in ('participated','qualified','awarded')),
              'qualified', count(e.id) filter (where e.status in ('qualified','awarded')), 'awarded', count(e.id) filter (where e.status = 'awarded')) x
            from c left join e on e.comp_id = c.id group by c.id, c.name, c.level, c.priority order by c.priority, count(e.id) desc) z), '[]'::jsonb),
      'years', coalesce((select jsonb_agg(distinct year) from tl_competitions where year is not null), '[]'::jsonb)));
end $$;

-- مسابقات مقترحة (تُضاف مرة واحدة وتُعدَّل مواعيدها من الصفحة)
insert into public.tl_competitions(name, field, organizer, level, stages, priority)
select x.* from (values
  ('كانجارو موهبة للرياضيات', 'math', 'موهبة', 'international', 'جميع المراحل', 1::smallint),
  ('بيبراس موهبة للمعلوماتية', 'informatics', 'موهبة', 'international', 'جميع المراحل', 1::smallint),
  ('الأولمبياد الوطني للإبداع العلمي (إبداع)', 'research', 'موهبة', 'national', 'متوسط وثانوي', 1::smallint),
  ('أولمبياد العلوم', 'science', 'موهبة', 'national', 'متوسط وثانوي', 2::smallint),
  ('أولمبياد الروبوت العالمي WRO', 'robotics', 'WRO', 'international', 'جميع المراحل', 2::smallint),
  ('مقياس موهبة للقدرات العقلية المتعددة', 'other', 'موهبة', 'national', 'الثالث–السادس ابتدائي والمتوسط', 1::smallint)
) as x(name, field, organizer, level, stages, priority)
where not exists (select 1 from public.tl_competitions);

revoke all on function private.tl_manager(), private.tl_can_comp(bigint), private.tl_sees(uuid), private.tl_comp_json(public.tl_competitions) from public, anon, authenticated;
revoke all on function public.tl_comps(boolean), public.tl_comp_save(jsonb), public.tl_comp_delete(bigint), public.tl_entries_of(bigint), public.tl_nominate(bigint, uuid[], text),
  public.tl_entry_set(bigint, jsonb), public.tl_entry_delete(bigint), public.tl_pool_list(), public.tl_pool_save(jsonb), public.tl_pool_remove(uuid),
  public.tl_student(uuid), public.tl_kpis(text) from public, anon;
grant execute on function public.tl_comps(boolean), public.tl_comp_save(jsonb), public.tl_comp_delete(bigint), public.tl_entries_of(bigint), public.tl_nominate(bigint, uuid[], text),
  public.tl_entry_set(bigint, jsonb), public.tl_entry_delete(bigint), public.tl_pool_list(), public.tl_pool_save(jsonb), public.tl_pool_remove(uuid),
  public.tl_student(uuid), public.tl_kpis(text) to authenticated;
