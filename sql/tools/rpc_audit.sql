-- =====================================================================
-- فحص الصلاحيات: يشغّل كل دالة عامة وكل جدول بهوية (طالب / ولي أمر / معلم / حساب خارجي)
-- كل استدعاء يتم داخل معاملة فرعية يُتراجع عنها فورًا ← لا يُحفظ أي تغيير مهما فعلت الدالة.
-- المدخلات: قيم تجريبية (uuid = طالب آخر غير الفاحص، رقم = 1، نص = 'x'، jsonb = {} ...)
-- النتيجة: ZZOK:... = نجحت الدالة (تُراجع يدويًا)، غير ذلك = رسالة الخطأ (رفض أو مدخلات غير صالحة)
-- لا يُشغَّل على الموقع؛ أداة فحص من SQL Editor فقط.
-- =====================================================================
drop table if exists pg_temp.rpc_audit;
create temp table rpc_audit (who text, kind text, name text, res text);

do $audit$
declare
  idn record; r record; args text; res text; vic uuid; ok boolean;
begin
  for idn in
    select 'student' who, (select p.email from profiles p join students s on s.profile_id = p.id
                           where p.role = 'student' and p.active and p.email is not null order by p.email limit 1) em
    union all select 'parent', (select email from profiles where role = 'parent' and active and email is not null order by email limit 1)
    union all select 'teacher', (select p.email from profiles p where p.role = 'teacher' and p.active and p.email is not null
                                   and exists (select 1 from teaching_assignments ta where ta.teacher_id = p.id) order by p.email limit 1)
    union all select 'outsider', 'someone.outside@gmail.com'
  loop
    if idn.em is null then insert into rpc_audit values (idn.who, '-', '-', 'لا يوجد حساب بهذا الدور'); continue; end if;
    -- «الضحية»: طالب آخر غير الفاحص
    select s.profile_id into vic from students s join profiles p on p.id = s.profile_id
      where p.email is distinct from idn.em order by s.student_number desc limit 1;

    -- ---------- الدوال ----------
    for r in
      select p.oid, p.proname,
             (select string_agg(case
                  when t = 'uuid'::regtype then quote_literal(vic) || '::uuid'
                  when t in ('integer'::regtype, 'bigint'::regtype, 'smallint'::regtype, 'numeric'::regtype) then '1'
                  when t in ('text'::regtype, 'character varying'::regtype) then '''x'''
                  when t = 'boolean'::regtype then 'false'
                  when t = 'date'::regtype then 'current_date'
                  when t = 'timestamp with time zone'::regtype then 'now()'
                  when t = 'jsonb'::regtype then '''{}''::jsonb'
                  when t = 'json'::regtype then '''{}''::json'
                  when t = 'text[]'::regtype then '''{}''::text[]'
                  when t = 'integer[]'::regtype then '''{}''::int[]'
                  when t = 'uuid[]'::regtype then 'array[' || quote_literal(vic) || '::uuid]'
                  else 'null::' || format_type(t, null) end, ', ' order by o)
              from unnest(p.proargtypes::regtype[]) with ordinality u(t, o)) as a
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')   -- دوال الإضافات
      order by p.proname
    loop
      args := coalesce(r.a, '');
      begin
        insert into app_settings(key, value) values ('student_login_enabled', 'true'), ('parent_login_enabled', 'true')
          on conflict (key) do update set value = 'true';
        perform set_config('request.jwt.claims', json_build_object('email', idn.em, 'sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        execute format('select left(coalesce((public.%I(%s))::text, ''<null>''), 220)', r.proname, args) into res;
        raise exception 'ZZOK:%', res;
      exception when others then
        insert into rpc_audit values (idn.who, 'fn', r.proname || '(' || args || ')', left(sqlerrm, 260));
      end;
    end loop;

    -- ---------- الجداول والعروض (قراءة مباشرة عبر REST) ----------
    for r in
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
        and has_table_privilege('authenticated', c.oid, 'SELECT')
      order by c.relname
    loop
      begin
        insert into app_settings(key, value) values ('student_login_enabled', 'true'), ('parent_login_enabled', 'true')
          on conflict (key) do update set value = 'true';
        perform set_config('request.jwt.claims', json_build_object('email', idn.em, 'sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
        execute 'set local role authenticated';
        execute format('select count(*)::text from public.%I', r.relname) into res;
        raise exception 'ZZOK:%', res;
      exception when others then
        insert into rpc_audit values (idn.who, 'tbl', r.relname, left(sqlerrm, 200));
      end;
    end loop;
  end loop;
end $audit$;

-- الملخص: كل ما نجح (لغير المعلم) + الأخطاء غير المتوقعة
select who, kind, name, res from rpc_audit
where res like 'ZZOK:%' and res not in ('ZZOK:0', 'ZZOK:[]', 'ZZOK:<null>', 'ZZOK:false', 'ZZOK:{}')
order by who, kind, name;
