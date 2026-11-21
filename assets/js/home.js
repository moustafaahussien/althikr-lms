/* الصفحة الرئيسية: تتغير حسب دور المستخدم */
(async function () {
  const { sb, C, ROLE_LABELS, esc, $, toast, modal, errMsg, fetchAll, requireAuth, downloadCSV } = LMS;
  const ctx = await requireAuth();
  const p = ctx.profile, role = p.role;
  const STAFF = !['student', 'parent'].includes(role);
  const main = $('#main');

  // ---------- البطاقة الترحيبية ----------
  const chips = [`<span class="chip">${esc(ROLE_LABELS[role])}</span>`];
  if (p.job_title) chips.push(`<span class="chip teal">${esc(p.job_title)}</span>`);
  if (ctx.term) chips.push(`<span class="chip gray">${esc(ctx.term.year)} — ${esc(ctx.term.term)}</span>`);
  if (ctx.student && ctx.student.class_label) chips.push(`<span class="chip pink">${esc(ctx.student.class_label)}</span>`);
  (ctx.scopes || []).forEach((s) => chips.push(`<span class="chip pink">نطاق: ${esc(scopeText(s))}</span>`));

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  main.innerHTML = `
    <section class="hero glass">
      <h1>${greet}، ${esc(p.full_name.split(' ')[0])} 👋</h1>
      <p>مرحبًا بك في ${esc(C.PLATFORM_NAME)}</p>
      <div class="chips">${chips.join('')}</div>
    </section>
    <div id="panel"></div>
    <div class="section-title"><h2>الوحدات</h2></div>
    <div class="grid modules" id="modules"></div>`;

  // ---------- الوحدات ----------
  const mods = (C.MODULES || []).filter((m) => !m.roles || !m.roles.length || m.roles.includes(role));
  $('#modules').innerHTML = mods.map((m) => m.url
    ? `<a class="module glass" href="${esc(m.url)}" target="_blank" rel="noopener"><span class="ic">${m.icon}</span><b>${esc(m.title)}</b><small>${esc(m.desc || '')}</small></a>`
    : `<div class="module glass soon"><span class="badge">قريبًا</span><span class="ic">${m.icon}</span><b>${esc(m.title)}</b><small>${esc(m.desc || '')}</small></div>`
  ).join('');

  const panel = $('#panel');
  try {
    if (role === 'admin' || role === 'leadership') await leaderPanel();
    if (STAFF) await staffPanel();
    if (role === 'student') await studentPanel();
    if (role === 'parent') await parentPanel();
  } catch (e) { toast(errMsg(e), 'err'); }

  function scopeText(s) {
    const parts = [];
    parts.push(s.stage || s.section || 'كل المدرسة');
    if (s.grade_min || s.grade_max) parts.push(`الصفوف ${s.grade_min || '…'}–${s.grade_max || '…'}`);
    if (s.subject) parts.push(s.subject);
    return parts.join(' • ');
  }

  // ---------- الإدارة العليا ومدير النظام ----------
  async function leaderPanel() {
    const { data: st, error } = await sb.rpc('school_stats');
    if (error) throw error;
    const items = [['الطلاب', st.students], ['المعلمون', st.teachers], ['كل الموظفين', st.staff],
                   ['الفصول', st.classes], ['المواد', st.subjects], ['إسنادات التدريس', st.assignments]];
    let html = `<div class="section-title"><h2>نظرة عامة على المدرسة</h2>
      ${role === 'admin' ? '<a class="btn primary sm" href="admin.html">لوحة الإدارة</a>' : ''}</div>
      <div class="grid stats">${items.map(([l, n]) => `<div class="stat glass"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}</div>`;
    if (st.by_stage && st.by_stage.length) {
      html += `<div class="grid stats" style="margin-top:14px">${st.by_stage.map((s) =>
        `<div class="stat glass"><div class="n">${s.students}</div><div class="l">${esc(s.stage)}</div></div>`).join('')}</div>`;
    } else if (st.by_section && st.by_section.length) {
      html += `<div class="grid stats" style="margin-top:14px">${st.by_section.map((s) =>
        `<div class="stat glass"><div class="n">${s.students}</div><div class="l">طلاب ${esc(s.section)} — ${s.classes} فصل</div></div>`).join('')}</div>`;
    }
    if (role === 'admin' && (st.no_class || st.no_email || st.students_no_email)) {
      html += `<div class="notice warn" style="margin-top:14px">تنبيه: ${st.no_class ? `${st.no_class} طالب لم يُوزَّعوا على فصول بعد. ` : ''}${st.students_no_email ? `${st.students_no_email} طالب بدون بريد مدرسي. ` : ''}${st.no_email ? `${st.no_email} موظف بدون بريد.` : ''}</div>`;
    }
    panel.insertAdjacentHTML('beforeend', html);
  }

  // ---------- الموظفون: فصولي + الفصول ضمن النطاق ----------
  async function staffPanel() {
    const mine = await fetchAll(() => sb.from('teaching_assignments')
      .select('id, class_id, weekly_periods, subject:subjects(name_ar)').eq('teacher_id', p.id).order('class_id'));
    const homeroom = await fetchAll(() => sb.from('classes').select('id').eq('homeroom_teacher_id', p.id));
    const scoped = (ctx.scopes || []).length > 0;
    if (!mine.length && !homeroom.length && !scoped && role !== 'admin' && role !== 'leadership') return;

    const classes = await fetchAll(() => sb.from('v_classes').select('*').order('stage_sort').order('grade_number').order('name'));
    const byId = Object.fromEntries(classes.map((c) => [c.id, c]));

    if (mine.length || homeroom.length) {
      const rows = mine.map((a) => ({ c: byId[a.class_id], subject: a.subject?.name_ar, periods: a.weekly_periods }))
        .concat(homeroom.filter((h) => !mine.some((a) => a.class_id === h.id)).map((h) => ({ c: byId[h.id], subject: 'رائد الفصل' })))
        .filter((r) => r.c);
      panel.insertAdjacentHTML('beforeend', `
        <div class="section-title"><h2>فصولي وموادي</h2><span class="hint">${rows.length} إسناد</span></div>
        <div class="table-wrap glass"><table>
          <thead><tr><th>الفصل</th><th>القسم</th><th>المادة</th><th>حصص أسبوعيًا</th><th>الطلاب</th><th></th></tr></thead>
          <tbody>${rows.map((r) => `<tr>
            <td><b>${esc(r.c.label)}</b></td><td>${esc(r.c.section_name)}</td><td>${esc(r.subject || '')}</td>
            <td>${r.periods ?? '—'}</td><td>${r.c.student_count}</td>
            <td><button class="btn sm" data-roster="${r.c.id}">قائمة الطلاب</button></td></tr>`).join('')}
          </tbody></table></div>`);
    }

    if (scoped || role === 'admin' || role === 'leadership') {
      const list = classes;
      const groups = {};
      list.forEach((c) => { (groups[c.stage_name] = groups[c.stage_name] || []).push(c); });
      panel.insertAdjacentHTML('beforeend', `
        <div class="section-title"><h2>${scoped ? 'الفصول ضمن نطاقي' : 'كل الفصول'}</h2><span class="hint">${list.length} فصل</span></div>
        ${list.length ? Object.entries(groups).map(([stage, cs]) => `
          <div class="card glass" style="margin-bottom:12px"><h3 style="font-size:1rem">${esc(stage)}</h3>
            <div class="chips">${cs.map((c) => `<button class="btn sm" data-roster="${c.id}">${esc(c.grade_name)} / ${esc(c.name)} <span class="hint">(${c.student_count})</span></button>`).join('')}</div>
          </div>`).join('') : '<div class="card glass empty">لا توجد فصول ضمن نطاقك بعد.</div>'}`);
    }

    panel.addEventListener('click', (e) => {
      const b = e.target.closest('[data-roster]');
      if (b) roster(byId[b.dataset.roster]);
    });
  }

  async function roster(c) {
    if (!c) return;
    try {
      const rows = await fetchAll(() => sb.from('students')
        .select('student_number, guardian_name, guardian_phone, profile:profiles(full_name, email, active)')
        .eq('class_id', c.id).order('student_number'));
      rows.sort((a, b) => (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '', 'ar'));
      const body = `
        <p class="hint">${rows.length} طالب</p>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>الاسم</th><th>رقم الطالب</th><th>البريد</th><th>ولي الأمر</th><th>الجوال</th></tr></thead>
          <tbody>${rows.length ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.profile?.full_name)}</td>
            <td>${esc(r.student_number)}</td><td dir="ltr">${esc(r.profile?.email || '')}</td>
            <td>${esc(r.guardian_name || '')}</td><td dir="ltr">${esc(r.guardian_phone || '')}</td></tr>`).join('')
            : '<tr><td colspan="6" class="empty">لا يوجد طلاب</td></tr>'}</tbody></table></div>`;
      modal({ title: c.label, body, wide: true, actions: [
        { label: 'تنزيل Excel (CSV)', cls: 'primary', onClick: () => {
          downloadCSV(`${c.label}.csv`, [['#', 'الاسم', 'رقم الطالب', 'البريد', 'ولي الأمر', 'الجوال']]
            .concat(rows.map((r, i) => [i + 1, r.profile?.full_name, r.student_number, r.profile?.email, r.guardian_name, r.guardian_phone])));
          return false;
        } },
        { label: 'إغلاق', cls: 'ghost' }] });
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  // ---------- الطالب ----------
  async function studentPanel() {
    const s = ctx.student;
    if (!s || !s.class_id) {
      panel.innerHTML = `<div class="notice warn">لم يتم ربطك بفصل بعد. تواصل مع إدارة المنصة.</div>`;
      return;
    }
    const ta = await fetchAll(() => sb.from('teaching_assignments')
      .select('subject:subjects(name_ar), teacher:profiles(full_name, job_title)').eq('class_id', s.class_id));
    ta.sort((a, b) => (a.subject?.name_ar || '').localeCompare(b.subject?.name_ar || '', 'ar'));
    panel.innerHTML = `
      <div class="section-title"><h2>موادي ومعلميّ — ${esc(s.class_label)}</h2></div>
      ${ta.length ? `<div class="grid modules">${ta.map((a) => `
        <div class="module glass"><span class="ic">📚</span><b>${esc(a.subject?.name_ar)}</b>
          <small>${esc(a.teacher?.full_name || '')}</small></div>`).join('')}</div>`
        : '<div class="card glass empty">لم تُسند مواد لفصلك بعد.</div>'}`;
  }

  // ---------- ولي الأمر ----------
  async function parentPanel() {
    const links = await fetchAll(() => sb.from('parent_links')
      .select('relation, student:students(student_number, class_id, profile:profiles(full_name))').eq('parent_id', p.id));
    if (!links.length) { panel.innerHTML = `<div class="notice info">لم يتم ربط أبنائك بحسابك بعد.</div>`; return; }
    const cls = await fetchAll(() => sb.from('v_classes').select('id,label'));
    const lab = Object.fromEntries(cls.map((c) => [c.id, c.label]));
    panel.innerHTML = `<div class="section-title"><h2>أبنائي</h2></div>
      <div class="grid modules">${links.map((l) => `<div class="module glass"><span class="ic">🎓</span>
        <b>${esc(l.student?.profile?.full_name)}</b><small>${esc(lab[l.student?.class_id] || '')}</small></div>`).join('')}</div>`;
  }
})();
