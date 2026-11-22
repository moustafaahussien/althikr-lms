/* الصفحة الرئيسية: تتغير حسب دور المستخدم */
(async function () {
  const { sb, C, ROLE_LABELS, esc, $, toast, modal, errMsg, fetchAll, requireAuth, downloadCSV } = LMS;
  const ctx = await requireAuth();
  const p = ctx.profile, role = p.role;
  const STAFF = !['student', 'parent'].includes(role);
  const LEADER = role === 'admin' || role === 'leadership';
  const main = $('#main');
  const STL = { absent: 'غائب', late: 'متأخر', excused: 'غائب بعذر' };
  const KIDS = {};   // بيانات بطاقات الطلاب (لتفاصيل الغياب) — قبل أي await   // قبل أي await (تستخدمها بطاقة الطالب)

  // ---------- البطاقة الترحيبية ----------
  const chips = [];
  if (ctx.canSwitch) {
    // صاحب الصفتين: الضغط على «مدير النظام» يرجع للوضع الكامل، والضغط على «مشرف …» يفتح واجهة المشرف
    chips.push(`<button type="button" class="chip view-sw ${ctx.viewAs ? '' : 'on'}" data-view="" title="الواجهة الكاملة">${esc(ROLE_LABELS[ctx.realRole])}</button>`);
    chips.push(`<button type="button" class="chip teal view-sw ${ctx.viewAs ? 'on' : ''}" data-view="supervisor" title="واجهة المشرف">${esc(p.job_title)}</button>`);
  } else {
    chips.push(`<span class="chip">${esc(ROLE_LABELS[role])}</span>`);
    if (p.job_title) chips.push(`<span class="chip teal">${esc(p.job_title)}</span>`);
  }
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
    ${ctx.viewAs ? `<div class="notice" style="margin-bottom:14px">أنت الآن في <b>واجهة المشرف</b> — اضغط «${esc(ROLE_LABELS[ctx.realRole])}» تحت اسمك للرجوع للوضع الكامل.</div>` : ''}
    <div id="dutyToday"></div>
    <div id="acks"></div>
    <div id="today"></div>
    <div id="panel"></div>
    <div class="section-title"><h2>الوحدات</h2></div>
    <div class="grid modules" id="modules"></div>
    <div id="soonBox"></div>`;

  main.querySelectorAll('.view-sw').forEach((b) => b.onclick = () => {
    const v = b.dataset.view;
    if (v === (ctx.viewAs || '')) { if (v) location.href = 'supervision/'; return; }
    LMS.setView(v);
    location.href = v ? 'supervision/' : 'home.html';
  });

  // ---------- تعاميم بانتظار «تم الاطلاع» ----------
  const showAcks = (d) => { const L = (d && d.pending_ack) || []; const box = $('#acks'); if (!box) return;
    box.innerHTML = L.length ? `<div class="notice warn" style="margin-bottom:14px"><b>📢 تعاميم بانتظار اطلاعك (${L.length}):</b>
      <ul style="margin:6px 0 0;padding-inline-start:18px">${L.slice(0, 5).map((c) => `<li><a href="messages.html?m=${c.id}">${esc(c.subject)}</a>${c.ref ? ` <span class="hint">رقم ${esc(c.ref)}</span>` : ''} — <span class="hint">${esc(c.from || '')}</span></li>`).join('')}</ul></div>` : ''; };
  if (window.LMS_MSG) showAcks(window.LMS_MSG);
  /* لوحة «يومي» + مناوبتي في طلب واحد (home_today — sql/31)؛ إن تعذّر نرجع للطلبات المنفصلة القديمة */
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const NOW = new Date(), A = window.ACAD, TODAY = LMS.ymd(NOW);
  // في الوضع التجريبي نعرض يومًا دراسيًا عاديًا حتى لو كانت المدرسة في إجازة
  const HOL = !LMS.DEMO && A && (A.hol || []).find((h) => TODAY >= h.f && TODAY <= h.to);
  let DAY = NOW.getDay(); const DAY_LBL = DAY >= 5 ? 'حصصي يوم الأحد' : 'حصصي اليوم'; if (DAY >= 5) DAY = 0;
  const IS_TODAY = DAY === NOW.getDay();
  const HT = STAFF ? sb.rpc('home_today', { p_day: HOL ? null : DAY, p_att: !HOL && IS_TODAY }).then(({ data, error }) => error ? null : data, () => null) : Promise.resolve(null);
  if (STAFF) HT.then((ht) => ht ? { data: ht.duty } : sb.rpc('duty_today')).then(({ data }) => { if (!data || !data.length) return;
    $('#dutyToday').innerHTML = (`<div class="notice" style="margin-bottom:14px">🛡️ <b>مناوبتك اليوم:</b> ${data.map((d) => `${esc(d.slot)} — ${esc(d.place)}${d.note ? ' (' + esc(d.note) + ')' : ''}`).join(' · ')} <a href="services.html#duty">الجدول</a></div>`); }).catch(() => {});
  document.addEventListener('lms:msg', (e) => showAcks(e.detail));

  // ---------- الوحدات ----------
  // الجاهزة أولًا؛ و«قريبًا» في قسم مطوي آخر الصفحة (لا تظهر للمشرف والطالب وولي الأمر)
  const mods = (C.MODULES || []).filter((m) => !m.roles || !m.roles.length || m.roles.includes(role));
  const ready = mods.filter((m) => m.url), soon = mods.filter((m) => !m.url);
  const ext = (u) => /^https?:/i.test(u);
  $('#modules').innerHTML = ready.map((m) =>
    `<a class="module glass" href="${esc(m.url)}" ${ext(m.url) ? 'target="_blank" rel="noopener" title="يفتح في نافذة جديدة"' : ''}>${ext(m.url) ? '<span class="ext" aria-label="منصة خارجية — نافذة جديدة">↗</span>' : ''}<span class="ic">${m.icon}</span><b>${esc(m.title)}</b><small>${esc(m.desc || '')}</small></a>`).join('');
  if (soon.length && !['supervisor', 'student', 'parent'].includes(role)) {
    $('#soonBox').innerHTML = `<details class="soon-box"><summary><h2>🛠️ قيد الإنشاء <span class="hint">(${soon.length})</span></h2></summary>
      <div class="grid modules">${soon.map((m) => `<div class="module glass soon"><span class="badge">قريبًا</span><span class="ic">${m.icon}</span><b>${esc(m.title)}</b><small>${esc(m.desc || '')}</small></div>`).join('')}</div></details>`;
  }

  // ---------- يومي: حصصي اليوم + معاملات تنتظر قراري + الرسائل غير المقروءة ----------
  if (STAFF) todayPanel().catch(() => {});
  async function todayPanel() {
    const hol = HOL, day = DAY, dayLbl = DAY_LBL, isToday = IS_TODAY, now = NOW;
    const subsP = LMS.cached('subjects', 30 * 60e3, () => fetchAll(() => sb.from('subjects').select('id,name_ar'))).catch(() => []);
    const ht = await HT;
    const [tt, subs, inbox, att] = ht ? [ht.tt || [], await subsP, { length: ht.inbox || 0 }, ht.att || (!hol && isToday ? [] : null)] : await Promise.all([
      hol ? [] : LMS.cached('tt:' + day, 3 * 60e3, () => fetchAll(() => sb.from('v_timetable').select('day,period,cls,class_id,subject_id,txt').eq('teacher_id', p.id).eq('kind', 'class').eq('day', day))).catch(() => []),
      subsP,
      sb.rpc('req_list', { p_box: 'inbox' }).then(({ data }) => data || [], () => []),
      // حالة تسجيل الحضور لحصص اليوم
      hol || !isToday ? null : sb.rpc('att_today_mine').then(({ data, error }) => error ? null : data || [], () => null)
    ]);
    const TAKEN = att ? new Set(att.filter((x) => x.taken).map((x) => x.period + '|' + x.class_id)) : null;
    const SUBJ = Object.fromEntries(subs.map((x) => [x.id, x.name_ar]));
    // نفس الحصة قد تتكرر إذا كان الجدول مرفوعًا عند أكثر من مشرف
    const seen = new Set(), periods = tt.filter((x) => { const k = x.period + '|' + x.cls + '|' + x.subject_id; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.period - b.period);
    const box = $('#today'); if (!box) return;
    const unread = () => (window.LMS_MSG && window.LMS_MSG.unread) || 0;
    const attP = periods.filter((x) => x.class_id), nTaken = TAKEN ? attP.filter((x) => TAKEN.has(x.period + '|' + x.class_id)).length : 0;
    const tiles = () => [
      ['🗓️', TAKEN && attP.length ? 'حصص سُجّل حضورها' : 'تسجيل الحضور', 'attendance.html', TAKEN && attP.length ? `${nTaken}/${attP.length}` : ''],
      ['📨', 'معاملات بانتظار قرارك', 'services.html#req', inbox.length],
      ['✉️', 'رسائل غير مقروءة', 'messages.html', unread()]
    ].map(([ic, l, href, n]) => `<a class="today-tile${n ? ' hot' : ''}" href="${href}"><span>${ic}</span><b>${n === '' ? '' : n}</b><small>${l}</small></a>`).join('');
    const ppl = hol ? `<div class="hint">🏖️ ${esc(hol.ar)} — لا حصص اليوم</div>`
      : periods.length ? `<div class="today-periods">${periods.map((x) => { const ok = TAKEN && TAKEN.has(x.period + '|' + x.class_id);
        return `<div class="tp${ok ? ' ok' : ''}${x.class_id ? ' clk' : ''}" ${x.class_id ? `role="button" tabindex="0" data-per="${x.period}" data-cls="${x.class_id}" data-sub="${x.subject_id || ''}" title="تفاصيل الحصة: الحضور والتحضير"` : ''}><i>${x.period}</i><b>${esc(SUBJ[x.subject_id] || x.txt || '')}</b><small>${esc(LMS.clsText(x.cls))}${TAKEN && x.class_id ? (ok ? ' · <span class="att-ok">✓ الحضور مسجّل</span>' : ' · <span class="att-no">الحضور لم يُسجّل</span>') : ''}</small></div>`; }).join('')}</div>`
      : `<div class="hint">لا توجد لك حصص مسجلة في الجدول ${day === now.getDay() ? 'اليوم' : 'يوم ' + DAYS[day]}.</div>`;
    // لغير المعلم: اللوحة تظهر فقط إذا كان عنده ما يخصه
    if (role !== 'teacher' && !periods.length && !inbox.length && !unread()) return;
    // قسم الحصص يظهر لمن يدرّس فقط (المدير والمشرف بلا حصص لا يرونه)
    const showP = periods.length > 0 || role === 'teacher';
    const paint = () => { box.innerHTML = `<section class="card glass today">
      <div class="section-title" style="margin-top:0"><h2>📌 يومي</h2><span class="hint">${esc(LMS.dateLine())}</span></div>
      <div class="today-grid"${showP ? '' : ' style="grid-template-columns:1fr"'}>${showP ? `<div><h3>${dayLbl}${periods.length ? ` <span class="hint">(${periods.length})</span>` : ''}</h3>${ppl}</div>` : ''}
      <div class="today-tiles">${tiles()}</div></div></section>`; };
    paint();
    const dayDate = (() => { const d = new Date(now); d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7)); return LMS.ymd(d); })();
    box.addEventListener('click', (e) => { const t = e.target.closest('[data-per]'); if (t) periodInfo(+t.dataset.per, +t.dataset.cls, +t.dataset.sub || null, dayDate, t.querySelector('b')?.textContent || '', isToday); });
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-per]')) e.target.click(); });
    document.addEventListener('lms:msg', paint);
  }

  // تفاصيل حصة: حضورها وتحضيرها، مع تنبيه إذا لم يُسجَّل أي منهما
  async function periodInfo(per, cid, sid, d, subjName, isToday) {
    const classes = await LMS.cached('v_classes', 3 * 60e3, () => fetchAll(() => sb.from('v_classes').select('*').order('stage_sort').order('grade_number').order('name'))).catch(() => []);
    const c = classes.find((x) => x.id === cid);
    const [att, plans] = await Promise.all([
      c ? sb.rpc('att_roster', { p_day: d, p_grade: c.grade_id, p_class: cid, p_period: per }).then(({ data, error }) => error ? null : data) : null,
      sb.rpc('lp_list', { p_box: 'mine', p_from: d, p_to: d }).then(({ data }) => (data || []), () => [])]);
    const myPlans = plans.filter((x) => (!sid || x.subject_id === sid) && (x.classes || []).some((l) => c && (l === c.label || (String(l).split(' — ')[0].trim().endsWith('/ ' + c.name) && String(l).includes(c.grade_name)))));
    const S = (att && att.students) || [], miss = S.filter((x) => x.status);
    const STX = { absent: 'غائب', late: 'متأخر', excused: 'بعذر' }, LPS = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد', returned: 'مُعاد للتعديل' };
    const warn = [];
    if (isToday && att && !att.session) warn.push('لم تسجّل حضور هذه الحصة بعد');
    if (!myPlans.length) warn.push('لا يوجد تحضير لهذه الحصة');
    else if (!myPlans.some((x) => x.status !== 'draft')) warn.push('التحضير ما زال مسودة ولم يُرسل للاعتماد');
    const body = `${warn.length ? `<div class="notice warn" style="margin-bottom:10px">⚠️ ${warn.map(esc).join(' · ')}</div>` : '<div class="notice" style="margin-bottom:10px">✓ الحضور والتحضير مكتملان</div>'}
      <h3 style="font-size:1rem;margin:6px 0">🗓️ الحضور</h3>
      ${!att ? '<p class="hint">تعذّر تحميل الحضور.</p>' : att.session ? `<p class="hint">سُجّل بواسطة ${esc(att.session.by || '')} · ${S.length} طالب</p>
        ${miss.length ? `<div class="chips">${miss.map((x) => `<span class="chip ${x.status === 'absent' ? 'pink' : 'gray'}">${esc(x.name)} — ${STX[x.status] || x.status}</span>`).join('')}</div>` : '<p>✓ كل الطلاب حاضرون</p>'}`
        : `<p class="hint">لم يُسجَّل بعد (${S.length} طالب).</p>`}
      <h3 style="font-size:1rem;margin:14px 0 6px">📘 التحضير</h3>
      ${myPlans.length ? myPlans.map((x) => `<div class="card-box" style="padding:8px 12px;margin-bottom:6px"><b>${esc(x.title)}</b> <span class="hint">· ${esc(LPS[x.status] || x.status)}</span>${x.note ? `<div class="hint">ملاحظة: ${esc(x.note)}</div>` : ''}</div>`).join('')
        : '<p class="hint">لم تُحضّر هذه الحصة.</p>'}`;
    modal({ title: `الحصة ${per} — ${subjName} · ${c ? c.label : ''}`, wide: true, body, actions: [
      { label: '📘 ' + (myPlans.length ? 'فتح التحضير' : 'تحضير الحصة'), cls: 'ghost', onClick: () => { location.href = 'lessons.html#mine'; } },
      { label: '🗓️ تسجيل الحضور', cls: isToday && att && !att.session ? 'primary' : 'ghost', onClick: () => { location.href = 'attendance.html'; } },
      { label: 'إغلاق', cls: 'ghost' }] });
  }

  const panel = $('#panel');
  try {
    if (role === 'admin' || role === 'leadership') await leaderPanel();
    if (STAFF) await staffPanel();
    if (role === 'student') await studentPanel();
    if (role === 'parent' || (ctx.children || []).length) await parentPanel();
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
    const [mine, homeroom] = await Promise.all([
      LMS.cached('ta', 3 * 60e3, () => fetchAll(() => sb.from('teaching_assignments')
        .select('id, class_id, weekly_periods, subject:subjects(name_ar)').eq('teacher_id', p.id).order('class_id'))),
      LMS.cached('homeroom', 3 * 60e3, () => fetchAll(() => sb.from('classes').select('id').eq('homeroom_teacher_id', p.id)))]);
    const scoped = (ctx.scopes || []).length > 0;
    if (!mine.length && !homeroom.length && !scoped && role !== 'admin' && role !== 'leadership') return;

    const classes = await LMS.cached('v_classes', 3 * 60e3, () => fetchAll(() => sb.from('v_classes').select('*').order('stage_sort').order('grade_number').order('name')));
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
      panel.insertAdjacentHTML('beforeend', `<a class="card glass" href="classes.html" style="display:flex;gap:12px;align-items:center;margin:14px 0;text-decoration:none">
        <span style="font-size:1.8rem">🏫</span><span><b>الفصول والطلاب</b><br><small class="hint">${classes.length} فصل ضمن نطاقك — الطلاب والحضور اليوم وملفات الإنجاز</small></span></a>`);
    }
    if (false) {
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
        .select(`student_number, guardian_name, guardian_phone, profile:profiles(full_name${LEADER ? ', email' : ''}, active)`)
        .eq('class_id', c.id).order('student_number'));
      rows.sort((a, b) => (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '', 'ar'));
      const body = `
        <p class="hint">${rows.length} طالب</p>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>الاسم</th><th>رقم الطالب</th>${LEADER ? '<th>البريد</th>' : ''}<th>ولي الأمر</th><th>الجوال</th></tr></thead>
          <tbody>${rows.length ? rows.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.profile?.full_name)}</td>
            <td>${esc(r.student_number || '')}</td>${LEADER ? `<td dir="ltr">${esc(r.profile?.email || '')}</td>` : ''}
            <td>${esc(r.guardian_name || '')}</td><td dir="ltr">${esc(r.guardian_phone || '')}</td></tr>`).join('')
            : '<tr><td colspan="6" class="empty">لا يوجد طلاب</td></tr>'}</tbody></table></div>`;
      modal({ title: c.label, body, wide: true, actions: [
        { label: 'تنزيل Excel (CSV)', cls: 'primary', onClick: () => {
          downloadCSV(`${c.label}.csv`, [['#', 'الاسم', 'رقم الطالب', 'ولي الأمر', 'الجوال']]
            .concat(rows.map((r, i) => [i + 1, r.profile?.full_name, r.student_number, r.guardian_name, r.guardian_phone])));
          return false;
        } },
        { label: 'إغلاق', cls: 'ghost' }] });
    } catch (e) { toast(errMsg(e), 'err'); }
  }

  // ---------- الطالب ----------
  // ---------- بطاقة طالب (للطالب نفسه ولولي أمره) ----------
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-att]'); if (!b) return; const c = KIDS[b.dataset.kid]; if (!c) return;
    const st = b.dataset.att, L = ((c.attendance || {}).recent || []).filter((r) => r.s === st && !r.p);
    modal({ title: `${STL[st]} — ${c.name}`, body: L.length ? `<p class="hint">آخر 60 يومًا · ${L.length} ${st === 'late' ? 'مرة' : 'يوم'}</p><div class="table-wrap"><table><thead><tr><th>اليوم</th><th>التاريخ</th><th>هجري</th><th>الحصة</th><th>ملاحظة</th></tr></thead><tbody>
      ${L.map((r) => `<tr><td>${esc(DAYS[new Date(r.d + 'T12:00:00').getDay()])}</td><td>${esc(r.d)}</td><td>${esc(LMS.hijri(r.d))}</td><td>${r.p ? r.p : 'يومي'}</td><td>${esc(r.n || '')}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">لا يوجد ${STL[st]} في آخر 60 يومًا 🎉</div>`, actions: [{ label: 'إغلاق', cls: 'ghost' }] });
  });
  async function childCard(id, mine) {
    const { data: c, error } = await sb.rpc('portal_child', { p_student: id });
    if (error) return `<div class="notice err">${esc(errMsg(error))}</div>`;
    KIDS[c.id] = c;
    const a = c.attendance || {};
    const pct = a.days_taken ? Math.round((1 - (a.absent + a.excused) / a.days_taken) * 100) : null;
    return `<div class="card glass" style="margin-bottom:14px">
      <div class="section-title" style="margin-top:0"><h2>🎓 ${esc(c.name)}</h2><span class="hint">${esc(c.grade || '')}${c.class ? ' / فصل ' + esc(c.class) : ''}${c.number ? ' · رقم ' + esc(c.number) : ''}</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px">
        <div class="card-box" style="padding:10px"><b style="font-size:1.4rem;color:var(--accent)">${pct == null ? '—' : pct + '%'}</b><div class="hint">نسبة الحضور (60 يومًا)</div></div>
        <button class="card-box att-box" data-att="absent" data-kid="${esc(c.id)}" style="padding:10px"><b style="font-size:1.4rem;color:#c0392b">${a.absent || 0}</b><div class="hint">غياب ›</div></button>
        <button class="card-box att-box" data-att="late" data-kid="${esc(c.id)}" style="padding:10px"><b style="font-size:1.4rem;color:#b9691b">${a.late || 0}</b><div class="hint">تأخر ›</div></button>
        <button class="card-box att-box" data-att="excused" data-kid="${esc(c.id)}" style="padding:10px"><b style="font-size:1.4rem;color:#2c7be5">${a.excused || 0}</b><div class="hint">غياب بعذر ›</div></button></div>
      ${(a.recent || []).length ? `<details style="margin-top:10px"><summary class="hint" style="cursor:pointer">سجل الغياب والتأخر</summary><div class="table-wrap" data-title="سجل حضور ${esc(c.name)}" style="margin-top:6px"><table>
        <thead><tr><th>التاريخ</th><th>هجري</th><th>الحصة</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>${a.recent.map((r) => `<tr><td>${esc(r.d)}</td><td>${esc(LMS.hijri(r.d))}</td>
        <td>${r.p ? r.p : 'يومي'}</td><td>${STL[r.s] || r.s}</td><td>${esc(r.n || '')}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      <h3 style="margin:14px 0 8px;font-size:1rem">المعلمون</h3>
      ${(c.teachers || []).length ? `<div class="grid modules">${c.teachers.sort((x, y) => (x.subject || '').localeCompare(y.subject || '', 'ar')).map((t) => `
        <div class="module glass"><span class="ic">📚</span><b>${esc(t.subject)}</b><small>${esc(t.name)}</small>
          <a class="btn sm" style="margin-top:6px" href="messages.html?to=${esc(t.id)}">✉️ مراسلة</a></div>`).join('')}</div>`
        : '<div class="hint">لم تُسند مواد لهذا الصف بعد.</div>'}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><a class="btn" href="messages.html">✉️ الرسائل</a><a class="btn" href="services.html#cmp">📣 تقديم شكوى</a></div>
    </div>`;
  }
  async function studentPanel() {
    const s = ctx.student;
    if (!s) { panel.innerHTML = `<div class="notice warn">لم يُستكمل ملفك الدراسي بعد. تواصل مع إدارة المدرسة.</div>`; return; }
    panel.innerHTML = await childCard(s.id, true) + `<div class="card glass" style="margin-bottom:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <span>👪 ولي الأمر: يدخل من هنا برمزه السري لمتابعة أبنائه</span><a class="btn primary" href="parent.html">دخول ولي الأمر</a></div>`;
  }

  // ---------- ولي الأمر (وأي موظف له أبناء في المدرسة) ----------
  async function parentPanel() {
    const kids = ctx.children || [];
    if (!kids.length) { panel.innerHTML = role === 'parent' ? `<div class="notice info">لم يتم ربط أبنائك بحسابك بعد. تواصل مع إدارة المدرسة.</div>` : ''; return; }
    const cards = await Promise.all(kids.map((k) => childCard(k)));
    panel.insertAdjacentHTML(role === 'parent' ? 'afterbegin' : 'beforeend', `<div class="section-title"><h2>👪 أبنائي</h2></div>${cards.join('')}`);
  }
})();
