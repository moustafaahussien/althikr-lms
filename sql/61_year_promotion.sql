-- =====================================================================
-- 61: ترحيل الطلاب للصف الأعلى في نهاية العام الدراسي (مدير النظام فقط)
--   • كل طالب نشط ينتقل للصف التالي في مرحلته؛ وآخر صف في المرحلة ← أول صف في المرحلة التالية من نفس القسم
--     (السادس الابتدائي ← الأول المتوسط، الثالث المتوسط ← الأول الثانوي)؛ وآخر صف في القسم ← خريج
--   • الفصل: يُنقل لفصل بنفس الاسم في الصف الجديد إن وُجد (اختياري)، وإلا يبقى بلا فصل حتى يُوزَّع
--   • الخريجون: يُوقف حسابهم (اختياري) وتبقى كل بياناتهم محفوظة
--   • المستثنون (الباقون للإعادة): يبقون في صفهم
--   • العام الجديد: يُنشأ ويُجعل الحالي مع فصله الدراسي الأول (اختياري)
--   • كل عملية تُحفظ بلقطة كاملة للتراجع عنها (آخر عملية فقط)
-- =====================================================================
create table if not exists public.promo_runs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  by_id       uuid references public.profiles(id) on delete set null,
  from_year   text,
  to_year     text,
  summary     jsonb not null default '{}'::jsonb,
  snapshot    jsonb not null default '[]'::jsonb,      -- [{s: student, g: grade, c: class, a: active}]
  year_state  jsonb,                                    -- الأعوام/الفصول الحالية قبل التغيير
  undone_at   timestamptz
);
alter table public.promo_runs enable row level security;
revoke all on public.promo_runs from anon, authenticated;

-- الصف التالي لكل صف (null = خريج)
create or replace function private.promo_next_grade(p_grade int) returns int
language sql stable security definer set search_path = public as $$
  with g as (select g.*, st.section_id, st.sort st_sort from grades g join stages st on st.id = g.stage_id where g.id = p_grade)
  select coalesce(
    (select g2.id from grades g2, g where g2.stage_id = g.stage_id and g2.number > g.number order by g2.number limit 1),
    (select g2.id from grades g2 join stages s2 on s2.id = g2.stage_id, g
      where s2.section_id = g.section_id and s2.sort > g.st_sort order by s2.sort, g2.number limit 1))
$$;

-- p: { exclude: [uuid] الباقون للإعادة, keep_class: bool, deactivate_graduates: bool, new_year: text, new_term: text }
create or replace function public.promo_plan(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare ex uuid[] := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p->'exclude','[]'::jsonb)) x);
begin
  if not public.is_admin() then raise exception 'ترحيل الطلاب لمدير النظام فقط'; end if;
  return (with s as (
      select s.profile_id, s.grade_id, s.class_id, private.promo_next_grade(s.grade_id) ng, s.profile_id = any (ex) kept
        from students s join profiles p on p.id = s.profile_id and p.active where s.grade_id is not null)
    select jsonb_build_object(
      'current_year', (select name from academic_years where is_current limit 1),
      'last_run', (select jsonb_build_object('id', id, 'at', at, 'from', from_year, 'to', to_year, 'undone', undone_at is not null) from promo_runs order by id desc limit 1),
      'total', (select count(*) from s), 'kept', (select count(*) from s where kept),
      'promoted', (select count(*) from s where not kept and ng is not null),
      'graduates', (select count(*) from s where not kept and ng is null),
      'rows', coalesce((select jsonb_agg(x order by x->>'sort') from (
          select jsonb_build_object('from', g.name_ar || ' — ' || st.name_ar, 'to', coalesce(g2.name_ar || ' — ' || st2.name_ar, '🎓 تخرّج'),
                   'n', count(*) filter (where not s.kept), 'kept', count(*) filter (where s.kept),
                   'sort', lpad(st.sort::text, 3, '0') || lpad(g.number::text, 3, '0')) x
            from s join grades g on g.id = s.grade_id join stages st on st.id = g.stage_id
            left join grades g2 on g2.id = s.ng left join stages st2 on st2.id = g2.stage_id
           group by g.id, g.name_ar, st.name_ar, st.sort, g.number, g2.name_ar, st2.name_ar) z), '[]'::jsonb)));
end $$;

create or replace function public.promo_run(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare
  ex uuid[] := array(select (x)::uuid from jsonb_array_elements_text(coalesce(p->'exclude','[]'::jsonb)) x);
  keep_cls boolean := coalesce((p->>'keep_class')::boolean, true);
  deact boolean := coalesce((p->>'deactivate_graduates')::boolean, true);
  ny text := nullif(btrim(coalesce(p->>'new_year','')), ''); nt text := coalesce(nullif(btrim(coalesce(p->>'new_term','')), ''), 'الفصل الدراسي الأول');
  cy text := (select name from academic_years where is_current limit 1);
  snap jsonb; ys jsonb; rid bigint; n_prom int; n_grad int; n_cls int; yid int;
begin
  if not public.is_admin() then raise exception 'ترحيل الطلاب لمدير النظام فقط'; end if;
  if coalesce(p->>'confirm','') <> 'ترحيل' then raise exception 'اكتب كلمة «ترحيل» للتأكيد'; end if;
  if ny is not null and exists (select 1 from academic_years where name = ny and is_current) then raise exception 'العام % هو الحالي بالفعل — يبدو أن الترحيل تم', ny; end if;
  if exists (select 1 from promo_runs where undone_at is null and at > now() - interval '30 days') and not coalesce((p->>'force')::boolean, false) then
    raise exception 'تم ترحيل الطلاب خلال آخر 30 يومًا — تراجع عن العملية السابقة أولًا إن أردت إعادتها'; end if;

  -- لقطة كاملة قبل التغيير
  select coalesce(jsonb_agg(jsonb_build_object('s', s.profile_id, 'g', s.grade_id, 'c', s.class_id, 'a', p2.active)), '[]'::jsonb) into snap
    from students s join profiles p2 on p2.id = s.profile_id;
  select jsonb_build_object('year', (select id from academic_years where is_current), 'term', (select id from terms where is_current)) into ys;

  create temp table _promo on commit drop as
    select s.profile_id, s.grade_id, s.class_id, private.promo_next_grade(s.grade_id) ng,
           (select c.name from classes c where c.id = s.class_id) cname
      from students s join profiles p2 on p2.id = s.profile_id and p2.active
     where s.grade_id is not null and not (s.profile_id = any (ex));

  -- الخريجون
  select count(*) into n_grad from _promo where ng is null;
  update students s set class_id = null, notes = trim(both ' ' from coalesce(s.notes, '') || ' [خريج ' || coalesce(cy, to_char(now(), 'YYYY')) || ']')
    from _promo t where t.profile_id = s.profile_id and t.ng is null;
  if deact then update profiles p2 set active = false from _promo t where t.profile_id = p2.id and t.ng is null; end if;

  -- المرحَّلون: الصف التالي، ونفس اسم الفصل إن وُجد في الصف الجديد
  select count(*) into n_prom from _promo where ng is not null;
  update students s set grade_id = t.ng,
         class_id = case when keep_cls then (select c.id from classes c where c.grade_id = t.ng and c.active and public.norm(c.name) = public.norm(t.cname) limit 1) end
    from _promo t where t.profile_id = s.profile_id and t.ng is not null;
  select count(*) into n_cls from students s join _promo t on t.profile_id = s.profile_id where t.ng is not null and s.class_id is not null;

  -- العام الدراسي الجديد
  if ny is not null then
    update terms set is_current = false where is_current;
    update academic_years set is_current = false where is_current;
    insert into academic_years(name, is_current) values (ny, true) on conflict (name) do update set is_current = true returning id into yid;
    insert into terms(year_id, name, is_current) values (yid, nt, true) on conflict (year_id, name) do update set is_current = true;
  end if;

  insert into promo_runs(by_id, from_year, to_year, summary, snapshot, year_state)
  values (public.me_id(), cy, coalesce(ny, cy), jsonb_build_object('promoted', n_prom, 'graduates', n_grad, 'kept', coalesce(array_length(ex, 1), 0),
          'with_class', n_cls, 'without_class', n_prom - n_cls, 'deactivated', deact, 'keep_class', keep_cls), snap, ys)
  returning id into rid;
  return jsonb_build_object('ok', true, 'run', rid, 'promoted', n_prom, 'graduates', n_grad, 'kept', coalesce(array_length(ex, 1), 0),
                            'with_class', n_cls, 'without_class', n_prom - n_cls, 'new_year', ny);
end $$;

-- التراجع عن آخر عملية ترحيل: يعيد صف كل طالب وفصله وحالة حسابه والعام/الفصل الحاليين كما كانت
create or replace function public.promo_undo(p_run bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r promo_runs; n int;
begin
  if not public.is_admin() then raise exception 'لمدير النظام فقط'; end if;
  select * into r from promo_runs where id = p_run;
  if not found or r.undone_at is not null then raise exception 'العملية غير موجودة أو تم التراجع عنها'; end if;
  if exists (select 1 from promo_runs where id > p_run and undone_at is null) then raise exception 'يمكن التراجع عن آخر عملية فقط'; end if;
  update students s set grade_id = (x->>'g')::int, class_id = nullif(x->>'c','')::int,
         notes = nullif(trim(regexp_replace(coalesce(s.notes,''), '\s*\[خريج [^\]]*\]', '', 'g')), '')
    from jsonb_array_elements(r.snapshot) x where s.profile_id = (x->>'s')::uuid;
  get diagnostics n = row_count;
  update profiles p set active = (x->>'a')::boolean from jsonb_array_elements(r.snapshot) x where p.id = (x->>'s')::uuid and p.active is distinct from (x->>'a')::boolean;
  if r.year_state is not null and r.year_state->>'year' is not null then
    update terms set is_current = false where is_current;
    update academic_years set is_current = false where is_current;
    update academic_years set is_current = true where id = (r.year_state->>'year')::int;
    if r.year_state->>'term' is not null then update terms set is_current = true where id = (r.year_state->>'term')::int; end if;
  end if;
  update promo_runs set undone_at = now() where id = p_run;
  return jsonb_build_object('ok', true, 'restored', n);
end $$;

revoke all on function private.promo_next_grade(int) from public, anon, authenticated;
revoke all on function public.promo_plan(jsonb), public.promo_run(jsonb), public.promo_undo(bigint) from public, anon;
grant execute on function public.promo_plan(jsonb), public.promo_run(jsonb), public.promo_undo(bigint) to authenticated;
