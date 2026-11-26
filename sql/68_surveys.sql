-- ============================================================
-- 68) الاستبيانات: رضا أولياء الأمور، تقييم البرامج، استطلاعات المعلمين والطلاب
-- ============================================================

create table if not exists public.srv_surveys (
  id          bigserial primary key,
  title       text not null check (btrim(title) <> ''),
  intro       text,
  audience    text[] not null default '{}',     -- teacher, staff, supervisor, principal, leadership, student, parent
  stage_ids   integer[],                         -- null = كل المراحل (للطلاب وأولياء الأمور)
  questions   jsonb not null default '[]',       -- [{key, type: single|multi|scale|rating|text, text, options[], required}]
  anonymous   boolean not null default true,
  status      text not null default 'draft' check (status in ('draft','open','closed')),
  closes_at   date,
  owner_id    uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  opened_at   timestamptz
);

create table if not exists public.srv_responses (
  id          bigserial primary key,
  survey_id   bigint not null references public.srv_surveys(id) on delete cascade,
  profile_id  uuid references public.profiles(id) on delete set null,
  guardian_id uuid references public.guardians(id) on delete set null,
  role        text,
  stage_id    integer,
  answers     jsonb not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists srv_resp_profile on public.srv_responses(survey_id, profile_id) where profile_id is not null;
create unique index if not exists srv_resp_guardian on public.srv_responses(survey_id, guardian_id) where guardian_id is not null;

alter table public.srv_surveys enable row level security; alter table public.srv_responses enable row level security;
revoke all on public.srv_surveys, public.srv_responses from anon, authenticated;

create or replace function private.srv_manager() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = public.me_id() and p.active
                  and (p.role in ('admin','leadership','principal','supervisor') or coalesce(p.job_title,'') ~ '(وكيل|وكيلة|موجه|موجّه|مرشد|جودة)'))
$$;

create or replace function private.srv_my_stage() returns int
language sql stable security definer set search_path = public as $$
  select g.stage_id from students s join grades g on g.id = s.grade_id where s.profile_id = public.me_id()
$$;

-- هل الاستبيان مفتوح لي (منسوب/طالب)؟
create or replace function private.srv_for_me(v public.srv_surveys) returns boolean
language sql stable security definer set search_path = public, private as $$
  select v.status = 'open' and (v.closes_at is null or v.closes_at >= current_date)
     and public.me_role()::text = any (v.audience)
     and (public.me_role() <> 'student' or v.stage_ids is null or private.srv_my_stage() = any (v.stage_ids))
$$;

create or replace function private.srv_clean(q jsonb) returns jsonb
language plpgsql immutable as $$
declare x jsonb; out jsonb := '[]'; i int := 0; t text;
begin
  if jsonb_typeof(q) <> 'array' or jsonb_array_length(q) = 0 then raise exception 'أضف سؤالًا واحدًا على الأقل'; end if;
  for x in select * from jsonb_array_elements(q) loop
    i := i + 1; t := coalesce(x->>'type', 'single');
    if t not in ('single','multi','scale','rating','text') then raise exception 'نوع سؤال غير صالح'; end if;
    if coalesce(btrim(x->>'text'), '') = '' then raise exception 'اكتب نص السؤال %', i; end if;
    if t in ('single','multi') and coalesce(jsonb_array_length(x->'options'), 0) < 2 then raise exception 'السؤال % يحتاج خيارين على الأقل', i; end if;
    out := out || jsonb_build_object('key', coalesce(nullif(x->>'key', ''), 'q' || i || '_' || substr(md5(random()::text), 1, 4)), 'type', t,
      'text', btrim(x->>'text'), 'options', case when t in ('single','multi') then x->'options' else '[]'::jsonb end,
      'required', coalesce((x->>'required')::boolean, t <> 'text'));
  end loop;
  return out;
end $$;

create or replace function private.srv_check(v public.srv_surveys, a jsonb) returns jsonb
language plpgsql immutable as $$
declare q jsonb; val jsonb; out jsonb := '{}';
begin
  for q in select * from jsonb_array_elements(v.questions) loop
    val := a->(q->>'key');
    if val is null or val = 'null'::jsonb or val = '""'::jsonb or val = '[]'::jsonb then
      if (q->>'required')::boolean then raise exception 'أجب عن السؤال: %', q->>'text'; end if;
      continue;
    end if;
    if q->>'type' in ('scale','rating') and ((val #>> '{}')::numeric not between 1 and 5) then raise exception 'قيمة غير صالحة'; end if;
    if q->>'type' = 'text' then val := to_jsonb(left(val #>> '{}', 2000)); end if;
    out := out || jsonb_build_object(q->>'key', val);
  end loop;
  return out;
end $$;

create or replace function private.srv_json(v public.srv_surveys) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', v.id, 'title', v.title, 'intro', v.intro, 'audience', v.audience, 'stage_ids', v.stage_ids, 'questions', v.questions,
    'anonymous', v.anonymous, 'status', v.status, 'closes_at', v.closes_at, 'owner', (select full_name from profiles where id = v.owner_id),
    'mine', v.owner_id = public.me_id(), 'n', (select count(*) from srv_responses r where r.survey_id = v.id), 'created_at', v.created_at)
$$;

-- ---------- الإدارة ----------
create or replace function public.srv_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if not private.srv_manager() then raise exception 'غير مصرح'; end if;
  return coalesce((select jsonb_agg(private.srv_json(v) order by v.created_at desc) from srv_surveys v
                    where v.owner_id = public.me_id() or public.me_role() in ('admin','leadership')), '[]'::jsonb);
end $$;

create or replace function public.srv_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public, private as $$
declare sid bigint := nullif(p->>'id', '')::bigint; v srv_surveys; au text[]; st int[];
begin
  if not private.srv_manager() then raise exception 'غير مصرح'; end if;
  select array_agg(x) into au from jsonb_array_elements_text(coalesce(p->'audience', '[]')) x
   where x in ('teacher','staff','supervisor','principal','leadership','student','parent');
  if coalesce(array_length(au, 1), 0) = 0 then raise exception 'اختر الفئة المستهدفة'; end if;
  if jsonb_typeof(p->'stage_ids') = 'array' and jsonb_array_length(p->'stage_ids') > 0 then
    select array_agg(x::int) into st from jsonb_array_elements_text(p->'stage_ids') x; end if;
  if sid is not null then
    select * into v from srv_surveys where id = sid;
    if not (v.owner_id = public.me_id() or public.me_role() in ('admin','leadership')) then raise exception 'غير مصرح'; end if;
    if exists (select 1 from srv_responses where survey_id = sid) and jsonb_array_length(coalesce(p->'questions', '[]')) <> jsonb_array_length(v.questions) then
      raise exception 'لا يمكن تغيير عدد الأسئلة بعد وصول ردود — أنشئ استبيانًا جديدًا'; end if;
    update srv_surveys set title = btrim(p->>'title'), intro = nullif(btrim(p->>'intro'), ''), audience = au, stage_ids = st,
           questions = private.srv_clean(p->'questions'), anonymous = coalesce((p->>'anonymous')::boolean, anonymous), closes_at = nullif(p->>'closes_at', '')::date where id = sid;
  else
    insert into srv_surveys(title, intro, audience, stage_ids, questions, anonymous, closes_at, owner_id)
    values (btrim(p->>'title'), nullif(btrim(p->>'intro'), ''), au, st, private.srv_clean(p->'questions'), coalesce((p->>'anonymous')::boolean, true),
            nullif(p->>'closes_at', '')::date, public.me_id()) returning id into sid;
  end if;
  return sid;
end $$;

-- فتح/إغلاق، مع إشعار المنسوبين المستهدفين عند الفتح
create or replace function public.srv_status(p_id bigint, p_status text, p_notify boolean default true) returns int
language plpgsql security definer set search_path = public, private as $$
declare v srv_surveys; mid bigint; n int := 0;
begin
  select * into v from srv_surveys where id = p_id;
  if v.id is null or not (v.owner_id = public.me_id() or public.me_role() in ('admin','leadership')) then raise exception 'غير مصرح'; end if;
  if p_status not in ('draft','open','closed') then raise exception 'حالة غير صالحة'; end if;
  update srv_surveys set status = p_status, opened_at = case when p_status = 'open' then coalesce(opened_at, now()) else opened_at end where id = p_id;
  if p_status = 'open' and p_notify and v.status <> 'open'
     and exists (select 1 from unnest(v.audience) a where a in ('teacher','staff','supervisor','principal','leadership')) then
    insert into messages(kind, sender_id, subject, body, audience)
    values ('mail', public.me_id(), left('📝 استبيان: ' || v.title, 200),
            coalesce(v.intro || E'\n\n', '') || 'نرجو المشاركة في الاستبيان' || case when v.anonymous then ' (الإجابات مجهولة الهوية)' else '' end ||
            E'.\nالمنصة ← الاستبيانات' || coalesce(E'\nآخر موعد: ' || v.closes_at, ''), 'الاستبيانات') returning id into mid;
    insert into message_recipients(message_id, profile_id)
      select mid, p.id from profiles p where p.active and p.role::text = any (v.audience) and p.role::text <> 'student' and p.id <> public.me_id()
      on conflict do nothing;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

create or replace function public.srv_delete(p_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  delete from srv_surveys where id = p_id and (owner_id = public.me_id() or public.me_role() in ('admin','leadership'));
end $$;

-- التقرير: الإجابات (بدون هوية إن كان مجهولًا) + توزيع حسب الفئة/المرحلة
create or replace function public.srv_report(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare v srv_surveys;
begin
  select * into v from srv_surveys where id = p_id;
  if v.id is null or not (v.owner_id = public.me_id() or public.me_role() in ('admin','leadership')) then raise exception 'غير مصرح'; end if;
  return private.srv_json(v) || jsonb_build_object(
    'stages', (select coalesce(jsonb_object_agg(id, name_ar), '{}'::jsonb) from stages),
    'responses', coalesce((select jsonb_agg(jsonb_build_object('a', r.answers, 'role', r.role, 'stage', r.stage_id, 'at', r.created_at,
        'who', case when v.anonymous then null else coalesce((select full_name from profiles where id = r.profile_id), (select 'ولي أمر: ' || name from guardians where id = r.guardian_id)) end)
        order by r.created_at) from srv_responses r where r.survey_id = p_id), '[]'::jsonb));
end $$;

-- ---------- المشاركة (منسوب/طالب) ----------
create or replace function public.srv_open() returns jsonb
language sql stable security definer set search_path = public, private as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'intro', v.intro, 'questions', v.questions, 'anonymous', v.anonymous, 'closes_at', v.closes_at,
           'done', exists (select 1 from srv_responses r where r.survey_id = v.id and r.profile_id = public.me_id())) order by v.opened_at desc), '[]'::jsonb)
    from srv_surveys v where private.srv_for_me(v)
$$;

create or replace function public.srv_submit(p_id bigint, p_answers jsonb) returns void
language plpgsql security definer set search_path = public, private as $$
declare v srv_surveys;
begin
  select * into v from srv_surveys where id = p_id;
  if v.id is null or not private.srv_for_me(v) then raise exception 'الاستبيان غير متاح'; end if;
  insert into srv_responses(survey_id, profile_id, role, stage_id, answers)
  values (p_id, public.me_id(), public.me_role()::text, private.srv_my_stage(), private.srv_check(v, p_answers));
exception when unique_violation then raise exception 'سبق أن شاركت في هذا الاستبيان، شكرًا لك';
end $$;

-- ---------- ولي الأمر (عبر جلسة بوابة ولي الأمر) ----------
create or replace function private.srv_for_guardian(v public.srv_surveys, p_guardian uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select v.status = 'open' and (v.closes_at is null or v.closes_at >= current_date) and 'parent' = any (v.audience)
     and (v.stage_ids is null or exists (select 1 from guardian_students gs join students s on s.profile_id = gs.student_id join grades g on g.id = s.grade_id
                                         where gs.guardian_id = p_guardian and g.stage_id = any (v.stage_ids)))
$$;

create or replace function public.pp_surveys(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'intro', v.intro, 'questions', v.questions, 'anonymous', v.anonymous, 'closes_at', v.closes_at,
           'done', exists (select 1 from srv_responses r where r.survey_id = v.id and r.guardian_id = s.guardian_id)) order by v.opened_at desc)
    from srv_surveys v where private.srv_for_guardian(v, s.guardian_id)), '[]'::jsonb);
end $$;

create or replace function public.pp_survey_submit(p_token text, p_id bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare s guardian_sessions := private.gd_session(p_token); v srv_surveys;
begin
  select * into v from srv_surveys where id = p_id;
  if v.id is null or not private.srv_for_guardian(v, s.guardian_id) then raise exception 'الاستبيان غير متاح'; end if;
  insert into srv_responses(survey_id, guardian_id, role, stage_id, answers)
  values (p_id, s.guardian_id, 'parent', (select g.stage_id from students st join grades g on g.id = st.grade_id where st.profile_id = s.student_id), private.srv_check(v, p_answers));
  return jsonb_build_object('ok', true);
exception when unique_violation then raise exception 'سبق أن شاركت في هذا الاستبيان، شكرًا لك';
end $$;

revoke all on function private.srv_manager(), private.srv_my_stage(), private.srv_for_me(public.srv_surveys), private.srv_clean(jsonb),
  private.srv_check(public.srv_surveys, jsonb), private.srv_json(public.srv_surveys), private.srv_for_guardian(public.srv_surveys, uuid) from public, anon, authenticated;
revoke all on function public.srv_list(), public.srv_save(jsonb), public.srv_status(bigint, text, boolean), public.srv_delete(bigint), public.srv_report(bigint),
  public.srv_open(), public.srv_submit(bigint, jsonb), public.pp_surveys(text), public.pp_survey_submit(text, bigint, jsonb) from public, anon;
grant execute on function public.srv_list(), public.srv_save(jsonb), public.srv_status(bigint, text, boolean), public.srv_delete(bigint), public.srv_report(bigint),
  public.srv_open(), public.srv_submit(bigint, jsonb), public.pp_surveys(text), public.pp_survey_submit(text, bigint, jsonb) to authenticated;
