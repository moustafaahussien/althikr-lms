-- ============================================================
-- 80) التسجيل والقبول (تكملة 79):
--  • مقابلة إلزامية مع مدير المرحلة بعد اجتياز اختبار القبول، ولا يُوقَّع العقد إلا بموافقته.
--    الرحلة: … ← اجتاز ← 🤝 مقابلة مدير المرحلة ← 👍 موافقة المدير ← 📁 فتح الملف ← ✍️ العقد ← 🎓 تسجيل رسمي
--  • اختبار قبول إلكتروني: يفتحه موظف التسجيل برابط لمرة واحدة، يؤديه الطالب (في المدرسة أو من المنزل)،
--    ويُصحَّح آليًا وتنتقل حالة الطالب إلى «اجتاز/لم يجتز» تلقائيًا حسب درجة النجاح.
-- ============================================================

alter table public.adm_applicants add column if not exists interview_at timestamptz;
alter table public.adm_applicants add column if not exists interviewer_id uuid references public.profiles(id) on delete set null;
alter table public.adm_applicants add column if not exists interview_notes text;
alter table public.adm_applicants add column if not exists interview_decision text check (interview_decision in ('approved','rejected'));
alter table public.adm_applicants add column if not exists decided_by uuid references public.profiles(id) on delete set null;
alter table public.adm_applicants add column if not exists decided_at timestamptz;
alter table public.adm_applicants drop constraint if exists adm_applicants_stage_check;
alter table public.adm_applicants add constraint adm_applicants_stage_check
  check (stage in ('lead','inquiry','test','passed','interview','approved','rejected','failed','file','contract','enrolled','lost'));
alter table public.adm_log drop constraint if exists adm_log_kind_check;
alter table public.adm_log add constraint adm_log_kind_check check (kind in ('note','call','visit','whatsapp','email','stage','test','interview','system'));

-- ---------- الاختبارات الإلكترونية ----------
create table if not exists public.adm_exams (
  id           bigserial primary key,
  title        text not null check (btrim(title) <> ''),
  grade_ids    int[] not null default '{}',
  duration_min int not null default 45 check (duration_min between 5 and 240),
  pass_pct     numeric(5,2) not null default 60 check (pass_pct between 0 and 100),
  instructions text,
  shuffle      boolean not null default true,
  questions    jsonb not null default '[]'::jsonb,   -- [{id, type: mcq|tf|multi|short, body, options:[{t, ok}], answer, points}]
  active       boolean not null default true,
  by_id        uuid references public.profiles(id) on delete set null,
  updated_at   timestamptz not null default now()
);
create table if not exists public.adm_attempts (
  id           bigserial primary key,
  applicant_id bigint not null references public.adm_applicants(id) on delete cascade,
  exam_id      bigint not null references public.adm_exams(id) on delete restrict,
  token        text not null unique,
  status       text not null default 'open' check (status in ('open','started','submitted','cancelled')),
  expires_at   timestamptz not null,
  started_at   timestamptz,
  submitted_at timestamptz,
  q_order      jsonb,
  answers      jsonb not null default '{}'::jsonb,
  score        numeric(7,2), total numeric(7,2), pct numeric(5,2),
  detail       jsonb,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists adm_att_app on public.adm_attempts(applicant_id, created_at desc);
alter table public.adm_exams enable row level security; alter table public.adm_attempts enable row level security;
revoke all on public.adm_exams, public.adm_attempts from anon, authenticated;

create or replace function private.adm_role() returns text
language sql stable security definer set search_path = public, private as $$
  select case
    when p.role in ('admin','leadership') or coalesce(p.job_title,'') ~ '(تسجيل|القبول|قبول)' then 'manage'
    when coalesce(p.job_title,'') ~ '(تسويق|علاقات عامة|الإعلام|إعلام)' then 'marketing'
    when p.role = 'principal' then 'principal'
    when exists (select 1 from adm_applicants a where (a.tester_id = p.id and a.stage in ('test','passed','failed')) or (a.interviewer_id = p.id and a.stage in ('interview','approved','rejected'))) then 'tester'
    else null end
  from profiles p where p.id = public.me_id() and p.active and private.beta_ok('admissions', array['leadership','principal','supervisor','teacher','staff'])
$$;

create or replace function private.adm_sees(a adm_applicants) returns boolean
language sql stable security definer set search_path = public, private as $$
  select case private.adm_role()
    when 'manage' then true when 'marketing' then true
    when 'principal' then a.tester_id = public.me_id() or a.interviewer_id = public.me_id() or exists (select 1 from grades g where g.id = a.grade_id and g.stage_id = any (private.my_stage_ids()))
    when 'tester' then a.tester_id = public.me_id() or a.interviewer_id = public.me_id()
    else false end
$$;

create or replace function private.adm_stage_label(s text) returns text language sql immutable as $$
  select case s when 'lead' then 'عميل محتمل' when 'inquiry' then 'استفسار — بيانات ولي الأمر' when 'test' then 'اختبار القبول'
    when 'passed' then 'اجتاز الاختبار' when 'interview' then 'مقابلة مدير المرحلة' when 'approved' then 'موافقة مدير المرحلة' when 'rejected' then 'لم يوافق مدير المرحلة' when 'failed' then 'لم يجتز الاختبار' when 'file' then 'فتح الملف' when 'contract' then 'توقيع العقد'
    when 'enrolled' then 'مسجّل رسميًا' when 'lost' then 'لم يكمل' else s end
$$;

create or replace function private.adm_row(a adm_applicants, full_info boolean) returns jsonb
language sql stable security definer set search_path = public, private as $$
  select jsonb_build_object('id', a.id, 'family_id', a.family_id, 'name', a.name, 'gender', a.gender, 'birth_date', a.birth_date,
    'national_id', case when full_info then a.national_id end, 'current_school', a.current_school,
    'grade_id', a.grade_id, 'grade', (select g.name_ar || ' — ' || st.name_ar from grades g join stages st on st.id = g.stage_id where g.id = a.grade_id),
    'year_name', a.year_name, 'stage', a.stage, 'stage_label', private.adm_stage_label(a.stage), 'stage_at', a.stage_at,
    'test_at', a.test_at, 'tester_id', a.tester_id, 'tester', (select full_name from profiles where id = a.tester_id),
    'test_score', a.test_score, 'test_notes', a.test_notes, 'file_no', a.file_no, 'docs', a.docs,
    'contract_no', case when full_info then a.contract_no end, 'contract_at', case when full_info then a.contract_at end,
    'fees', case when full_info then a.fees end, 'enrolled_at', a.enrolled_at, 'lost_reason', a.lost_reason,
    'student_id', private.adm_student_of(a), 'created_at', a.created_at,
    'interview_at', a.interview_at, 'interviewer_id', a.interviewer_id, 'interviewer', (select full_name from profiles where id = a.interviewer_id),
    'interview_notes', a.interview_notes, 'interview_decision', a.interview_decision, 'decided_at', a.decided_at,
    'decided_by', (select full_name from profiles where id = a.decided_by),
    'attempt', (select jsonb_build_object('id', t.id, 'status', t.status, 'exam', e.title, 'pct', t.pct, 'score', t.score, 'total', t.total,
                  'pass_pct', e.pass_pct, 'expires_at', t.expires_at, 'started_at', t.started_at, 'submitted_at', t.submitted_at,
                  'token', case when full_info and t.status in ('open','started') then t.token end)
                from adm_attempts t join adm_exams e on e.id = t.exam_id where t.applicant_id = a.id and t.status <> 'cancelled' order by t.created_at desc limit 1))
$$;

create or replace function public.adm_board(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role(); q text := public.norm(nullif(btrim(coalesce(p ->> 'q', '')), ''));
  full_info boolean;
begin
  if r is null then raise exception 'ليس لديك صلاحية التسجيل والقبول'; end if;
  full_info := r = 'manage';
  return coalesce((select jsonb_agg(x order by (x ->> 'stage_at') desc) from (
    select private.adm_row(a, full_info) || jsonb_build_object(
        'guardian', f.guardian_name,
        'phone', case when r in ('manage','marketing') then f.phone end,
        'source', f.source, 'source_label', private.adm_source_label(f.source), 'source_detail', f.source_detail,
        'owner_id', f.owner_id, 'owner', (select full_name from profiles where id = f.owner_id),
        'next_at', (select min(l.next_at) from adm_log l where l.family_id = f.id and l.next_at is not null and not l.done),
        'last_at', (select max(l.at) from adm_log l where l.family_id = f.id)) x
      from adm_applicants a join adm_families f on f.id = a.family_id
     where private.adm_sees(a)
       and (q is null or public.norm(a.name) like '%' || q || '%' or public.norm(f.guardian_name) like '%' || q || '%'
            or (r in ('manage','marketing') and (f.phone like '%' || btrim(p ->> 'q') || '%' or a.file_no = btrim(p ->> 'q'))))
       and (nullif(p ->> 'source', '') is null or f.source = p ->> 'source')
       and (nullif(p ->> 'owner', '') is null or f.owner_id = (p ->> 'owner')::uuid)
       and (nullif(p ->> 'grade', '') is null or a.grade_id = (p ->> 'grade')::int)
       and (nullif(p ->> 'year', '') is null or a.year_name = p ->> 'year')
       and (coalesce((p ->> 'closed')::boolean, true) or a.stage not in ('enrolled','lost','failed','rejected'))
     limit 2000) z), '[]'::jsonb);
end $$;

create or replace function public.adm_stage(p_id bigint, p_stage text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a adm_applicants; msg text; y text; n int; tester uuid;
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  select * into a from adm_applicants where id = p_id for update;
  if a.id is null then raise exception 'غير موجود'; end if;
  if p_stage not in ('lead','inquiry','test','passed','failed','interview','file','contract','enrolled','lost') then raise exception 'مرحلة غير صحيحة'; end if;
  if p_stage = 'test' then
    if nullif(p ->> 'test_at', '') is null then raise exception 'حدّد موعد اختبار القبول'; end if;
    if a.grade_id is null and nullif(p ->> 'grade_id', '') is null then raise exception 'حدّد الصف المطلوب للطالب أولًا'; end if;
    tester := nullif(p ->> 'tester_id', '')::uuid;
    update adm_applicants set stage = 'test', test_at = (p ->> 'test_at')::timestamptz, tester_id = tester,
      grade_id = coalesce(nullif(p ->> 'grade_id', '')::int, grade_id), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'تحديد موعد اختبار القبول: ' || to_char((p ->> 'test_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
           || coalesce(' — المختبِر: ' || (select full_name from profiles where id = tester), '');
    if tester is not null and tester <> public.me_id() then
      with m as (insert into messages(sender_id, subject, body, kind)
                 values (public.me_id(), 'اختبار قبول: ' || a.name, 'كُلّفت باختبار قبول للطالب ' || a.name || ' يوم ' ||
                         to_char((p ->> 'test_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || E'.\nسجّل النتيجة من: التسجيل والقبول ← اختبارات القبول.', 'mail') returning id)
      insert into message_recipients(message_id, profile_id) select id, tester from m;
    end if;
  elsif p_stage in ('passed','failed') then
    update adm_applicants set stage = p_stage, test_score = coalesce(nullif(p ->> 'test_score', '')::numeric, test_score),
      test_notes = coalesce(nullif(btrim(p ->> 'test_notes'), ''), test_notes), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'نتيجة اختبار القبول: ' || private.adm_stage_label(p_stage) || coalesce(' (' || nullif(p ->> 'test_score', '') || ')', '');
  elsif p_stage = 'interview' then
    -- مقابلة مدير المرحلة: بعد اجتياز الاختبار (أو بعد فتح الملف لمن أُعفي من الاختبار)
    if a.stage not in ('passed','interview','rejected','file') then raise exception 'تُحدَّد المقابلة بعد اجتياز اختبار القبول'; end if;
    if nullif(p ->> 'interview_at', '') is null then raise exception 'حدّد موعد المقابلة'; end if;
    tester := nullif(p ->> 'interviewer_id', '')::uuid;
    if tester is null then raise exception 'اختر مدير المرحلة الذي سيجري المقابلة'; end if;
    update adm_applicants set stage = 'interview', interview_at = (p ->> 'interview_at')::timestamptz, interviewer_id = tester,
      interview_decision = null, decided_by = null, decided_at = null, stage_at = now(), updated_at = now() where id = p_id;
    msg := 'تحديد مقابلة مدير المرحلة: ' || to_char((p ->> 'interview_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' — ' || (select full_name from profiles where id = tester);
    if tester <> public.me_id() then
      with m as (insert into messages(sender_id, subject, body, kind)
                 values (public.me_id(), 'مقابلة قبول: ' || a.name, 'مطلوب مقابلتك للطالب ' || a.name || coalesce(' (' || (select g.name_ar from grades g where g.id = a.grade_id) || ')', '') ||
                         ' يوم ' || to_char((p ->> 'interview_at')::timestamptz at time zone 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') ||
                         E'.\nبعد المقابلة سجّل قرارك (موافقة أو عدم موافقة) من: التسجيل والقبول ← المقابلات. لا يُوقَّع العقد إلا بموافقتك.', 'mail') returning id)
      insert into message_recipients(message_id, profile_id) select id, tester from m;
    end if;
  elsif p_stage = 'file' then
    if a.stage not in ('approved','file','contract','enrolled') and not (coalesce((p ->> 'skip_test')::boolean, false) and a.stage in ('inquiry','failed','test')) then
      raise exception 'يُفتح الملف بعد موافقة مدير المرحلة في المقابلة'; end if;
    y := to_char(now() at time zone 'Asia/Riyadh', 'YY');
    select count(*) + 1 into n from adm_applicants where file_no like 'ADM' || y || '-%';
    update adm_applicants set stage = 'file', file_no = coalesce(file_no, nullif(btrim(p ->> 'file_no'), ''), 'ADM' || y || '-' || lpad(n::text, 4, '0')),
      national_id = coalesce(nullif(btrim(p ->> 'national_id'), ''), national_id), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'فتح ملف الطالب رقم ' || (select file_no from adm_applicants where id = p_id);
  elsif p_stage = 'contract' then
    if a.stage not in ('file','contract','enrolled') then raise exception 'يُوقَّع العقد بعد فتح الملف'; end if;
    if a.interview_decision is distinct from 'approved' then raise exception 'لا يُوقَّع العقد قبل موافقة مدير المرحلة في المقابلة'; end if;
    if nullif(p ->> 'contract_at', '') is null then raise exception 'حدّد تاريخ توقيع العقد'; end if;
    update adm_applicants set stage = 'contract', contract_no = nullif(btrim(p ->> 'contract_no'), ''), contract_at = (p ->> 'contract_at')::date,
      fees = nullif(p ->> 'fees', '')::numeric, stage_at = now(), updated_at = now() where id = p_id;
    msg := 'توقيع العقد' || coalesce(' رقم ' || nullif(btrim(p ->> 'contract_no'), ''), '') || ' بتاريخ ' || (p ->> 'contract_at');
  elsif p_stage = 'enrolled' then
    if a.stage not in ('contract','enrolled') then raise exception 'يُسجَّل الطالب رسميًا بعد توقيع العقد'; end if;
    if coalesce(nullif(btrim(p ->> 'national_id'), ''), a.national_id) is null then raise exception 'رقم هوية الطالب مطلوب للتسجيل الرسمي'; end if;
    update adm_applicants set stage = 'enrolled', national_id = coalesce(nullif(btrim(p ->> 'national_id'), ''), national_id),
      enrolled_at = coalesce(nullif(p ->> 'enrolled_at', '')::date, (now() at time zone 'Asia/Riyadh')::date), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'التسجيل الرسمي للطالب في المدرسة';
  elsif p_stage = 'lost' then
    if btrim(coalesce(p ->> 'lost_reason', '')) = '' then raise exception 'اذكر سبب عدم الإكمال'; end if;
    update adm_applicants set stage = 'lost', lost_reason = btrim(p ->> 'lost_reason'), stage_at = now(), updated_at = now() where id = p_id;
    msg := 'لم يكمل: ' || btrim(p ->> 'lost_reason');
  else
    update adm_applicants set stage = p_stage, stage_at = now(), updated_at = now() where id = p_id;
    msg := 'نقل إلى مرحلة: ' || private.adm_stage_label(p_stage);
  end if;
  insert into adm_log(family_id, applicant_id, kind, body, by_id) values (a.family_id, a.id, 'stage', msg, public.me_id());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_tests() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role();
begin
  if r is null then raise exception 'ليس لديك صلاحية'; end if;
  return coalesce((select jsonb_agg(private.adm_row(a, false) || jsonb_build_object('guardian', f.guardian_name, 'can_grade', r in ('manage','principal') or a.tester_id = public.me_id())
            order by a.test_at) from adm_applicants a join adm_families f on f.id = a.family_id
     where a.test_at is not null and private.adm_sees(a) and (a.stage = 'test' or a.test_at >= now() - interval '30 days')), '[]'::jsonb);
end $$;

create or replace function public.adm_stats(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare f date := coalesce(p_from, (now() at time zone 'Asia/Riyadh')::date - 365); t date := coalesce(p_to, (now() at time zone 'Asia/Riyadh')::date);
begin
  if private.adm_role() not in ('manage','marketing') then raise exception 'للتسجيل والقبول والتسويق فقط'; end if;
  return (with base as (select a.*, fm.source, fm.owner_id from adm_applicants a join adm_families fm on fm.id = a.family_id
                         where (a.created_at at time zone 'Asia/Riyadh')::date between f and t),
    ord as (select s, i from unnest(array['lead','inquiry','test','passed','interview','approved','file','contract','enrolled']) with ordinality u(s, i))
  select jsonb_build_object(
    'total', (select count(*) from base), 'families', (select count(distinct family_id) from base),
    'enrolled', (select count(*) from base where stage = 'enrolled'), 'lost', (select count(*) from base where stage = 'lost'),
    'failed', (select count(*) from base where stage = 'failed'), 'rejected', (select count(*) from base where stage = 'rejected'),
    'stages', (select jsonb_object_agg(stage, n) from (select stage, count(*) n from base group by stage) z),
    -- القمع: كم وصل إلى كل مرحلة أو تجاوزها
    'funnel', (select jsonb_agg(jsonb_build_object('stage', o.s, 'label', private.adm_stage_label(o.s), 'n',
                 (select count(*) from base b where coalesce((select i from ord where s = case when b.stage = 'failed' then 'test' when b.stage = 'rejected' then 'interview' when b.stage = 'lost' then
                    case when b.contract_at is not null then 'contract' when b.file_no is not null then 'file' when b.interview_decision = 'approved' then 'approved' when b.interview_at is not null then 'interview' when b.test_score is not null then 'test' else 'inquiry' end else b.stage end), 1) >= o.i)) order by o.i) from ord o),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'label', private.adm_source_label(source), 'n', n, 'enrolled', e) order by n desc), '[]')
                from (select source, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by source) z),
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('grade', g, 'n', n, 'enrolled', e) order by n desc), '[]')
               from (select coalesce((select gr.name_ar || ' — ' || st.name_ar from grades gr join stages st on st.id = gr.stage_id where gr.id = b.grade_id), 'غير محدد') g,
                            count(*) n, count(*) filter (where stage = 'enrolled') e from base b group by 1) z),
    'owners', (select coalesce(jsonb_agg(jsonb_build_object('name', coalesce((select full_name from profiles where id = owner_id), 'غير مسند'), 'n', n, 'enrolled', e) order by n desc), '[]')
               from (select owner_id, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by owner_id) z),
    'lost_reasons', (select coalesce(jsonb_agg(jsonb_build_object('reason', lost_reason, 'n', n) order by n desc), '[]')
                     from (select lost_reason, count(*) n from base where stage = 'lost' group by lost_reason) z),
    'monthly', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'n', n, 'enrolled', e) order by m), '[]')
                from (select to_char(created_at at time zone 'Asia/Riyadh', 'YYYY-MM') m, count(*) n, count(*) filter (where stage = 'enrolled') e from base group by 1) z)));
end $$;
create or replace function private.adm_tasks() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text; out jsonb := '[]'::jsonb; n int; me uuid := public.me_id();
begin
  r := private.adm_role();
  if r is null then return out; end if;
  if r in ('manage','marketing') then
    select count(*) into n from adm_families f where not exists (select 1 from adm_log l where l.family_id = f.id and l.kind <> 'system')
       and exists (select 1 from adm_applicants a where a.family_id = f.id and a.stage in ('lead','inquiry')) and (f.owner_id is null or f.owner_id = me);
    if n > 0 then out := out || jsonb_build_object('icon', '📥', 'text', n || ' عميل جديد لم يُتواصل معه بعد', 'link', 'admissions.html#follow'); end if;
    select count(*) into n from adm_log l join adm_families f on f.id = l.family_id where l.next_at <= (now() at time zone 'Asia/Riyadh')::date and not l.done and (f.owner_id is null or f.owner_id = me);
    if n > 0 then out := out || jsonb_build_object('icon', '📞', 'text', n || ' متابعة عميل مستحقة اليوم', 'link', 'admissions.html#follow'); end if;
  end if;
  select count(*) into n from adm_applicants a where a.stage = 'test' and (a.test_at at time zone 'Asia/Riyadh')::date <= (now() at time zone 'Asia/Riyadh')::date + 1
     and (a.tester_id = me or (r = 'manage' and a.tester_id is null) or (r = 'principal' and private.adm_sees(a)));
  if n > 0 then out := out || jsonb_build_object('icon', '📝', 'text', n || ' اختبار قبول اليوم أو غدًا أو بانتظار النتيجة', 'link', 'admissions.html#tests'); end if;
  -- مقابلات القبول بانتظار قرار مدير المرحلة
  select count(*) into n from adm_applicants a where a.stage = 'interview' and (a.interview_at at time zone 'Asia/Riyadh')::date <= (now() at time zone 'Asia/Riyadh')::date + 1
     and (a.interviewer_id = me or (r = 'principal' and private.adm_sees(a)));
  if n > 0 then out := out || jsonb_build_object('icon', '🤝', 'text', n || ' مقابلة قبول بانتظار قرارك', 'link', 'admissions.html#interviews'); end if;
  return out;
end $$;

-- ---------- المقابلات ----------
-- من يقرر؟ المقابِل المكلَّف، أو مدير مرحلة الطالب، أو مدير النظام
create or replace function private.adm_can_decide(a adm_applicants) returns boolean
language sql stable security definer set search_path = public, private as $$
  select public.me_role() = 'admin' or a.interviewer_id = public.me_id()
      or (public.me_role() = 'principal' and exists (select 1 from grades g where g.id = a.grade_id and g.stage_id = any (private.my_stage_ids())))
$$;

create or replace function public.adm_interviews() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare r text := private.adm_role();
begin
  if r is null then raise exception 'ليس لديك صلاحية'; end if;
  return coalesce((select jsonb_agg(private.adm_row(a, false) || jsonb_build_object('guardian', f.guardian_name, 'can_decide', private.adm_can_decide(a))
            order by a.interview_at) from adm_applicants a join adm_families f on f.id = a.family_id
     where a.interview_at is not null and private.adm_sees(a) and (a.stage = 'interview' or a.decided_at >= now() - interval '30 days')), '[]'::jsonb);
end $$;

create or replace function public.adm_interview_decide(p_id bigint, p_approve boolean, p_notes text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a adm_applicants;
begin
  select * into a from adm_applicants where id = p_id for update;
  if a.id is null then raise exception 'غير موجود'; end if;
  if not private.adm_can_decide(a) then raise exception 'القرار لمدير المرحلة الذي أجرى المقابلة'; end if;
  if a.stage not in ('interview','approved','rejected') and not (a.stage = 'file' and a.interview_at is not null) then raise exception 'لا توجد مقابلة مفتوحة لهذا الطالب'; end if;
  update adm_applicants set interview_decision = case when p_approve then 'approved' else 'rejected' end, interview_notes = nullif(btrim(p_notes), ''),
    decided_by = public.me_id(), decided_at = now(),
    -- من فُتح ملفه مسبقًا (معفى من الاختبار) يبقى في «فتح الملف»
    stage = case when a.file_no is not null and p_approve then 'file' when p_approve then 'approved' else 'rejected' end, stage_at = now(), updated_at = now()
   where id = p_id;
  insert into adm_log(family_id, applicant_id, kind, body, by_id)
  values (a.family_id, a.id, 'interview', 'قرار مدير المرحلة بعد المقابلة: ' || case when p_approve then '👍 موافقة' else '✋ عدم موافقة' end || coalesce(' — ' || nullif(btrim(p_notes), ''), ''), public.me_id());
  -- إشعار مسؤول المتابعة في قسم التسجيل
  with o as (select f.owner_id from adm_families f where f.id = a.family_id and f.owner_id is not null and f.owner_id <> public.me_id()),
       m as (insert into messages(sender_id, subject, body, kind)
             select public.me_id(), 'قرار مقابلة القبول: ' || a.name, 'قرار مدير المرحلة: ' || case when p_approve then 'موافقة — يمكن فتح الملف وتوقيع العقد.' else 'عدم موافقة.' end ||
                    coalesce(E'\n' || nullif(btrim(p_notes), ''), ''), 'mail' from o returning id)
  insert into message_recipients(message_id, profile_id) select m.id, o.owner_id from m, o;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- الاختبارات الإلكترونية: الإدارة (قسم التسجيل) ----------
create or replace function private.adm_exam_clean(q jsonb) returns jsonb
language plpgsql immutable as $$
declare x jsonb; out jsonb := '[]'::jsonb; t text; ok int; n int := 0; ids text[] := '{}'; qid text;
begin
  if jsonb_typeof(q) <> 'array' then raise exception 'الأسئلة غير صالحة'; end if;
  for x in select * from jsonb_array_elements(q) loop
    n := n + 1; t := x ->> 'type';
    if t not in ('mcq','tf','multi','short') then raise exception 'السؤال %: نوع غير مدعوم', n; end if;
    if btrim(coalesce(x ->> 'body', '')) = '' then raise exception 'السؤال %: اكتب نص السؤال', n; end if;
    if coalesce((x ->> 'points')::numeric, 1) <= 0 or coalesce((x ->> 'points')::numeric, 1) > 100 then raise exception 'السؤال %: الدرجة بين 0 و100', n; end if;
    if t = 'short' then
      if btrim(coalesce(x ->> 'answer', '')) = '' then raise exception 'السؤال %: اكتب الإجابة الصحيحة', n; end if;
    else
      if jsonb_typeof(x -> 'options') <> 'array' or jsonb_array_length(x -> 'options') < 2 then raise exception 'السؤال %: خياران على الأقل', n; end if;
      if exists (select 1 from jsonb_array_elements(x -> 'options') o where btrim(coalesce(o ->> 't', '')) = '') then raise exception 'السؤال %: خيار فارغ', n; end if;
      select count(*) into ok from jsonb_array_elements(x -> 'options') o where (o ->> 'ok')::boolean;
      if t in ('mcq','tf') and ok <> 1 then raise exception 'السؤال %: حدّد إجابة صحيحة واحدة', n; end if;
      if t = 'multi' and ok < 1 then raise exception 'السؤال %: حدّد إجابة صحيحة على الأقل', n; end if;
    end if;
    qid := coalesce(nullif(x ->> 'id', ''), 'q' || n);
    if qid = any (ids) then qid := qid || '_' || n; end if;
    ids := ids || qid;
    out := out || jsonb_build_array(jsonb_build_object('id', qid, 'type', t, 'body', btrim(x ->> 'body'), 'points', coalesce((x ->> 'points')::numeric, 1),
      'options', case when t = 'short' then '[]'::jsonb else (select jsonb_agg(jsonb_build_object('t', btrim(o ->> 't'), 'ok', coalesce((o ->> 'ok')::boolean, false))) from jsonb_array_elements(x -> 'options') o) end,
      'answer', case when t = 'short' then btrim(x ->> 'answer') end));
  end loop;
  if n = 0 then raise exception 'أضف سؤالًا واحدًا على الأقل'; end if;
  return out;
end $$;

create or replace function public.adm_exams_list() returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title, 'grade_ids', e.grade_ids, 'duration_min', e.duration_min, 'pass_pct', e.pass_pct,
      'instructions', e.instructions, 'shuffle', e.shuffle, 'questions', e.questions, 'active', e.active, 'updated_at', e.updated_at,
      'n', jsonb_array_length(e.questions), 'total', (select coalesce(sum((q ->> 'points')::numeric), 0) from jsonb_array_elements(e.questions) q),
      'attempts', (select count(*) from adm_attempts t where t.exam_id = e.id and t.status = 'submitted'),
      'avg', (select round(avg(t.pct), 1) from adm_attempts t where t.exam_id = e.id and t.status = 'submitted')) order by e.active desc, e.title) from adm_exams e), '[]'::jsonb);
end $$;

create or replace function public.adm_exam_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare eid bigint := nullif(p ->> 'id', '')::bigint; q jsonb;
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  if btrim(coalesce(p ->> 'title', '')) = '' then raise exception 'اكتب عنوان الاختبار'; end if;
  q := private.adm_exam_clean(coalesce(p -> 'questions', '[]'));
  if eid is null then
    insert into adm_exams(title, grade_ids, duration_min, pass_pct, instructions, shuffle, questions, active, by_id)
    values (btrim(p ->> 'title'), coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
            coalesce(nullif(p ->> 'duration_min', '')::int, 45), coalesce(nullif(p ->> 'pass_pct', '')::numeric, 60), nullif(btrim(p ->> 'instructions'), ''),
            coalesce((p ->> 'shuffle')::boolean, true), q, coalesce((p ->> 'active')::boolean, true), public.me_id()) returning id into eid;
  else
    if exists (select 1 from adm_attempts where exam_id = eid and status = 'started') then raise exception 'يوجد طالب يؤدي هذا الاختبار الآن — عدّل بعد انتهائه'; end if;
    update adm_exams set title = btrim(p ->> 'title'), grade_ids = coalesce((select array_agg(x::int) from jsonb_array_elements_text(coalesce(p -> 'grade_ids', '[]')) x), '{}'),
      duration_min = coalesce(nullif(p ->> 'duration_min', '')::int, 45), pass_pct = coalesce(nullif(p ->> 'pass_pct', '')::numeric, 60),
      instructions = nullif(btrim(p ->> 'instructions'), ''), shuffle = coalesce((p ->> 'shuffle')::boolean, true), questions = q,
      active = coalesce((p ->> 'active')::boolean, true), by_id = public.me_id(), updated_at = now() where id = eid;
  end if;
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

create or replace function public.adm_exam_delete(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  if exists (select 1 from adm_attempts where exam_id = p_id) then
    update adm_exams set active = false where id = p_id;
    return jsonb_build_object('ok', true, 'archived', true);
  end if;
  delete from adm_exams where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- استيراد أسئلة من بنك الأسئلة (الأسئلة ذاتية التصحيح فقط)
create or replace function public.adm_qb_search(p_subject int, p_grade int, p_q text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  return jsonb_build_object(
    'subjects', (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name_ar) order by s.name_ar), '[]') from subjects s
                  where exists (select 1 from qb_questions q where q.subject_id = s.id and q.qtype in ('mcq','tf','multi','short'))),
    'items', case when p_subject is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'type', q.qtype, 'body', q.body, 'options', q.options,
                  'answer', q.answer, 'points', q.points, 'grade', q.grade_num, 'topic', q.topic) order by q.grade_num nulls last, q.id desc)
                from (select * from qb_questions q where q.subject_id = p_subject and q.qtype in ('mcq','tf','multi','short')
                        and (p_grade is null or q.grade_num = p_grade) and (nullif(btrim(p_q), '') is null or public.norm(q.body) like '%' || public.norm(p_q) || '%')
                      order by q.id desc limit 200) q), '[]') end);
end $$;

-- فتح الاختبار لطالب: رابط لمرة واحدة صالح لعدد ساعات
create or replace function public.adm_attempt_open(p_applicant bigint, p_exam bigint, p_hours int default 3) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare a adm_applicants; e adm_exams; tok text := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  select * into a from adm_applicants where id = p_applicant for update;
  select * into e from adm_exams where id = p_exam and active;
  if a.id is null or e.id is null then raise exception 'غير موجود'; end if;
  if a.stage not in ('inquiry','lead','test','failed') then raise exception 'يُفتح اختبار القبول قبل نتيجة الاختبار فقط (الطالب الآن: %)', private.adm_stage_label(a.stage); end if;
  if exists (select 1 from adm_attempts where applicant_id = a.id and status = 'started') then raise exception 'الطالب يؤدي اختبارًا الآن'; end if;
  update adm_attempts set status = 'cancelled' where applicant_id = a.id and status = 'open';
  insert into adm_attempts(applicant_id, exam_id, token, expires_at, created_by)
  values (a.id, e.id, tok, now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 3), 168))), public.me_id());
  update adm_applicants set stage = 'test', test_at = coalesce(case when a.stage = 'test' then a.test_at end, now()), stage_at = case when a.stage = 'test' then stage_at else now() end,
    updated_at = now() where id = a.id;
  insert into adm_log(family_id, applicant_id, kind, body, by_id) values (a.family_id, a.id, 'test', 'فتح اختبار القبول الإلكتروني: ' || e.title, public.me_id());
  return jsonb_build_object('ok', true, 'token', tok);
end $$;

create or replace function public.adm_attempt_cancel(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, private as $$
begin
  if private.adm_role() <> 'manage' then raise exception 'لقسم التسجيل والقبول فقط'; end if;
  update adm_attempts set status = 'cancelled' where id = p_id and status in ('open','started');
  return jsonb_build_object('ok', true);
end $$;

-- إجابات الطالب سؤالًا سؤالًا (التسجيل ومدير المرحلة)
create or replace function public.adm_attempt_detail(p_id bigint) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare t adm_attempts; a adm_applicants; e adm_exams;
begin
  select * into t from adm_attempts where id = p_id; select * into a from adm_applicants where id = t.applicant_id; select * into e from adm_exams where id = t.exam_id;
  if t.id is null or not private.adm_sees(a) or private.adm_role() not in ('manage','principal','tester') then raise exception 'ليس لديك صلاحية'; end if;
  return jsonb_build_object('name', a.name, 'exam', e.title, 'pct', t.pct, 'score', t.score, 'total', t.total, 'pass_pct', e.pass_pct, 'status', t.status,
    'started_at', t.started_at, 'submitted_at', t.submitted_at,
    'items', (select jsonb_agg(jsonb_build_object('body', q ->> 'body', 'type', q ->> 'type', 'options', q -> 'options', 'answer', q ->> 'answer', 'points', q -> 'points',
                'given', t.answers -> (q ->> 'id'), 'got', coalesce((t.detail -> (q ->> 'id'))::numeric, 0)) order by i)
              from jsonb_array_elements(e.questions) with ordinality z(q, i)));
end $$;

-- ---------- أداء الاختبار (صفحة عامة برابط لمرة واحدة) ----------
create or replace function private.adm_take_row(p_token text) returns adm_attempts
language plpgsql security definer set search_path = public as $$
declare t adm_attempts;
begin
  if p_token !~ '^[0-9a-f]{40}$' then raise exception 'رابط غير صالح'; end if;
  select * into t from adm_attempts where token = p_token for update;
  if t.id is null or t.status = 'cancelled' then raise exception 'الرابط غير صالح أو أُلغي — راجع قسم التسجيل والقبول'; end if;
  return t;
end $$;

create or replace function private.adm_take_questions(t adm_attempts) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', q ->> 'id', 'type', q ->> 'type', 'body', q ->> 'body', 'points', q -> 'points',
           'options', (select coalesce(jsonb_agg(o ->> 't' order by j), '[]') from jsonb_array_elements(q -> 'options') with ordinality y(o, j)))
         order by coalesce((select k from jsonb_array_elements_text(t.q_order) with ordinality w(v, k) where v = q ->> 'id'), i)), '[]')
  from adm_exams e, jsonb_array_elements(e.questions) with ordinality z(q, i) where e.id = t.exam_id
$$;

create or replace function public.adm_take_get(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t adm_attempts; e adm_exams; a adm_applicants; dl timestamptz;
begin
  t := private.adm_take_row(p_token);
  select * into e from adm_exams where id = t.exam_id; select * into a from adm_applicants where id = t.applicant_id;
  dl := t.started_at + make_interval(mins => e.duration_min);
  return jsonb_build_object('status', case when t.status = 'open' and t.expires_at < now() then 'expired' else t.status end,
    'name', split_part(a.name, ' ', 1), 'title', e.title, 'instructions', e.instructions, 'duration_min', e.duration_min,
    'n', jsonb_array_length(e.questions), 'school', (select value #>> '{}' from app_settings where key = 'school_name'),
    'remaining', case when t.status = 'started' then greatest(0, extract(epoch from dl - now())::int) end,
    'questions', case when t.status = 'started' then private.adm_take_questions(t) end, 'answers', case when t.status = 'started' then t.answers end);
end $$;

create or replace function public.adm_take_start(p_token text) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t adm_attempts; e adm_exams;
begin
  t := private.adm_take_row(p_token);
  if t.status = 'submitted' then raise exception 'سُلّم هذا الاختبار من قبل'; end if;
  if t.status = 'open' then
    if t.expires_at < now() then raise exception 'انتهت صلاحية الرابط — اطلب رابطًا جديدًا من قسم التسجيل'; end if;
    select * into e from adm_exams where id = t.exam_id;
    update adm_attempts set status = 'started', started_at = now(),
      q_order = case when e.shuffle then (select jsonb_agg(q ->> 'id' order by random()) from jsonb_array_elements(e.questions) q) end where id = t.id;
  end if;
  return public.adm_take_get(p_token);
end $$;

-- حفظ تلقائي أثناء الحل (حتى لا تضيع الإجابات عند انقطاع الاتصال)
create or replace function public.adm_take_save(p_token text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t adm_attempts; e adm_exams;
begin
  t := private.adm_take_row(p_token);
  if t.status <> 'started' then raise exception 'الاختبار غير مفتوح'; end if;
  select * into e from adm_exams where id = t.exam_id;
  if now() > t.started_at + make_interval(mins => e.duration_min) + interval '2 minutes' then return jsonb_build_object('ok', false, 'late', true); end if;
  if jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 100000 then raise exception 'بيانات غير صالحة'; end if;
  update adm_attempts set answers = p_answers where id = t.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.adm_take_submit(p_token text, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public, private as $$
declare t adm_attempts; e adm_exams; a adm_applicants; q jsonb; g jsonb; pts numeric; got numeric := 0; tot numeric := 0; det jsonb := '{}'::jsonb;
  ans jsonb; okset int[]; given int[]; v_pct numeric; late boolean;
begin
  t := private.adm_take_row(p_token);
  if t.status = 'submitted' then return jsonb_build_object('ok', true, 'already', true); end if;
  if t.status <> 'started' then raise exception 'ابدأ الاختبار أولًا'; end if;
  select * into e from adm_exams where id = t.exam_id; select * into a from adm_applicants where id = t.applicant_id for update;
  late := now() > t.started_at + make_interval(mins => e.duration_min) + interval '2 minutes';
  -- بعد انتهاء الوقت تُعتمد آخر إجابات محفوظة تلقائيًا
  ans := case when late or jsonb_typeof(p_answers) <> 'object' or length(p_answers::text) > 100000 then t.answers else p_answers end;
  for q in select * from jsonb_array_elements(e.questions) loop
    pts := coalesce((q ->> 'points')::numeric, 1); tot := tot + pts; g := ans -> (q ->> 'id');
    if q ->> 'type' in ('mcq','tf') then
      if jsonb_typeof(g) = 'number' and coalesce((q -> 'options' -> (g::text::int) ->> 'ok')::boolean, false) then got := got + pts; det := det || jsonb_build_object(q ->> 'id', pts); end if;
    elsif q ->> 'type' = 'multi' then
      select coalesce(array_agg((i - 1)::int order by i), '{}') into okset from jsonb_array_elements(q -> 'options') with ordinality z(o, i) where (o ->> 'ok')::boolean;
      given := case when jsonb_typeof(g) = 'array' then (select coalesce(array_agg(distinct x::int order by x::int), '{}') from jsonb_array_elements_text(g) x where x ~ '^\d+$') else '{}' end;
      if given = okset then got := got + pts; det := det || jsonb_build_object(q ->> 'id', pts); end if;
    elsif q ->> 'type' = 'short' then
      if jsonb_typeof(g) = 'string' and public.norm(g #>> '{}') <> '' and public.norm(g #>> '{}') in (select public.norm(btrim(x)) from unnest(string_to_array(q ->> 'answer', '|')) x) then
        got := got + pts; det := det || jsonb_build_object(q ->> 'id', pts); end if;
    end if;
  end loop;
  v_pct := case when tot > 0 then round(got * 100 / tot, 2) else 0 end;
  update adm_attempts set status = 'submitted', submitted_at = now(), answers = ans, score = got, total = tot, pct = v_pct, detail = det where id = t.id;
  if a.stage = 'test' then
    update adm_applicants set stage = case when v_pct >= e.pass_pct then 'passed' else 'failed' end, test_score = v_pct,
      test_notes = 'اختبار إلكتروني: ' || e.title || ' — ' || got || ' من ' || tot || case when late then ' (سُلّم بعد انتهاء الوقت)' else '' end,
      stage_at = now(), updated_at = now() where id = a.id;
  end if;
  insert into adm_log(family_id, applicant_id, kind, body)
  values (a.family_id, a.id, 'test', 'تصحيح آلي لاختبار القبول: ' || v_pct || '% (' || got || ' من ' || tot || ') — ' ||
          case when v_pct >= e.pass_pct then 'اجتاز' else 'لم يجتز' end || ' (درجة النجاح ' || e.pass_pct || '%)');
  -- إشعار مسؤول المتابعة ومن فتح الاختبار
  with r as (select distinct x from unnest(array[(select owner_id from adm_families where id = a.family_id), t.created_by]) x where x is not null),
       m as (insert into messages(sender_id, subject, body, kind)
             select null, 'نتيجة اختبار قبول: ' || a.name, a.name || ' أنهى اختبار القبول الإلكتروني (' || e.title || '): ' || v_pct || '% — ' ||
                    case when v_pct >= e.pass_pct then 'اجتاز ✅ — الخطوة التالية: تحديد مقابلة مدير المرحلة.' else 'لم يجتز ❌' end, 'mail'
             where exists (select 1 from r) returning id)
  insert into message_recipients(message_id, profile_id) select m.id, r.x from m, r;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function private.adm_can_decide(adm_applicants), private.adm_exam_clean(jsonb), private.adm_take_row(text), private.adm_take_questions(adm_attempts) from public, anon, authenticated;
do $$ declare f text; begin
  foreach f in array array['adm_interviews()','adm_interview_decide(bigint, boolean, text)','adm_exams_list()','adm_exam_save(jsonb)','adm_exam_delete(bigint)',
    'adm_qb_search(int, int, text)','adm_attempt_open(bigint, bigint, int)','adm_attempt_cancel(bigint)','adm_attempt_detail(bigint)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.adm_take_get(text), public.adm_take_start(text), public.adm_take_save(text, jsonb), public.adm_take_submit(text, jsonb) from public;
grant execute on function public.adm_take_get(text), public.adm_take_start(text), public.adm_take_save(text, jsonb), public.adm_take_submit(text, jsonb) to anon, authenticated;
