/* =====================================================================
   لجان الاختبارات (sql/66)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role;
  if (role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('committees', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const C = LMS.C || {};
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const SLOTS = ['', 'الفترة الأولى', 'الفترة الثانية', 'الفترة الثالثة', 'الفترة الرابعة'];
  const dn = (d) => DAYS[new Date(d + 'T12:00:00').getDay()];
  const head = (t, sub) => `<div class="phead"><img src="${esc(C.LOGO_H || 'assets/img/brand/logo-h.svg')}" alt=""><h2>${esc(t)}</h2>${sub ? `<div>${esc(sub)}</div>` : ''}</div>`;

  let MINE;
  try { MINE = await call('ec_mine'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }

  /* ---------- الطالب ---------- */
  if (role === 'student') {
    $('#tabs').style.display = 'none';
    const L = MINE.student || [];
    view.innerHTML = L.map((x) => `<div class="glass ec-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(x.session)}</b></div>
        <div class="mine-row" style="padding:6px 0"><div><div class="hint">رقم الجلوس</div><div class="big-seat">${x.seat}</div></div>
          <div class="grow"><b>${esc(x.room)}</b>${x.location ? `<div class="hint">📍 ${esc(x.location)}</div>` : ''}</div></div>
        <table class="t"><thead><tr><th>اليوم</th><th>التاريخ</th><th>الفترة</th><th>المادة</th><th>البداية</th><th>المدة</th></tr></thead><tbody>
        ${x.schedule.map((s) => `<tr><td>${dn(s.day)}</td><td>${esc(s.day)}</td><td>${esc(s.slot)}</td><td><b>${esc(s.subject)}</b></td><td>${esc(s.start || '—')}</td><td>${s.duration} د</td></tr>`).join('')}</tbody></table></div>`).join('')
      || '<div class="empty">لا توجد لجان اختبارات منشورة لك حاليًا.</div>';
    return;
  }

  const tabs = (MINE.manager ? [['sessions', '📋 فترات الاختبارات']] : []).concat([['mine', '👁️ ملاحظتي']]);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => (TAB === 'mine' ? mineView() : sessionsView());

  async function mineView() {
    try { MINE = await call('ec_mine'); } catch (e) { /* */ }
    view.innerHTML = (MINE.invig || []).map((x) => `<div class="glass mine-row"><div style="text-align:center;min-width:90px"><b>${dn(x.day)}</b><div class="hint">${esc(x.day)}</div></div>
        <div class="grow"><b>${esc(x.room)}</b>${x.location ? ' — 📍 ' + esc(x.location) : ''}<div class="hint">${esc(x.slot)}${x.start ? ' · تبدأ ' + esc(x.start) : ''} · ${x.seated} طالب · ${esc(x.session)}</div></div></div>`).join('')
      || '<div class="empty">لا توجد لديك ملاحظة في لجان منشورة حاليًا.</div>';
  }

  /* ---------- الفترات ---------- */
  let STAGES = [];
  try { const { data } = await sb.from('stages').select('id,name_ar,sort').order('sort'); STAGES = data || []; } catch (e) { /* */ }

  async function sessionsView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('ec_sessions_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="new">＋ فترة اختبارات جديدة</button></div>
      ${L.map((s) => `<div class="glass ec-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(s.title)}</b>${s.published ? '<span class="pill ok">✅ منشورة</span>' : '<span class="pill gold">مسودة</span>'}</div>
        <div class="hint">${esc(s.stages || '')}${s.starts_on ? ' · ' + esc(s.starts_on) + (s.ends_on ? ' ← ' + esc(s.ends_on) : '') : ''} · ${s.rooms} لجنة · ${s.exams} اختبار · ${s.seated} طالب موزّع</div>
        <div class="acts"><button class="btn sm primary" data-open="${s.id}">📂 فتح</button><button class="btn sm danger ghost" data-del="${s.id}">🗑</button></div></div>`).join('') ||
        '<div class="empty">لا توجد فترات اختبارات بعد.<br><small>الخطوات: ١) أنشئ الفترة ٢) أضف اللجان ٣) أدخل الجدول ٤) وزّع الطلاب ٥) وزّع الملاحظين ٦) اطبع وانشر.</small></div>'}`;
    $('#new').onclick = () => sessionForm(null);
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.open) return openSession(+b.dataset.open, 'rooms');
      if (b.dataset.del) { if (!await confirmBox('حذف فترة الاختبارات بكل لجانها وتوزيعها؟', 'حذف')) return; try { await call('ec_session_delete', { p_id: +b.dataset.del }); sessionsView(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }

  function sessionForm(s) {
    const D = s || { title: '', stage_ids: [], starts_on: '', ends_on: '', seat_start: 1 };
    modal({ title: s ? 'إعدادات الفترة' : '＋ فترة اختبارات جديدة', body: `
      <label class="f">العنوان *<input id="tt" value="${esc(D.title)}" placeholder="مثال: اختبارات نهاية الفصل الدراسي الأول"></label>
      <div style="display:flex;gap:8px"><label class="f grow">من<input type="date" id="fr" value="${esc(D.starts_on || '')}"></label><label class="f grow">إلى<input type="date" id="to" value="${esc(D.ends_on || '')}"></label>
        <label class="f">أول رقم جلوس<input type="number" id="ss" value="${D.seat_start}" min="1" style="width:110px"></label></div>
      <label class="f">المراحل المشمولة *</label><div style="display:flex;flex-wrap:wrap;gap:8px">${STAGES.map((x) => `<label class="chk" style="margin:0"><input type="checkbox" data-st value="${x.id}" ${D.stage_ids.includes(x.id) ? 'checked' : ''}> ${esc(x.name_ar)}</label>`).join('')}</div>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const id = await call('ec_session_save', { p: { id: s ? s.id : null, title: $('#tt', w).value, starts_on: $('#fr', w).value, ends_on: $('#to', w).value,
          seat_start: $('#ss', w).value, stage_ids: $$('[data-st]:checked', w).map((x) => +x.value) } });
        toast('حُفظ ✓'); openSession(id, s ? SUB : 'rooms'); return true; } }] });
  }

  /* ---------- داخل الفترة ---------- */
  let S = null, SUB = 'rooms';
  async function openSession(id, sub) {
    SUB = sub || SUB;
    try { S = await call('ec_get', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const ss = S.session, cap = S.rooms.reduce((a, r) => a + r.capacity, 0);
    const subs = [['rooms', '🏫 اللجان'], ['exams', '🗓️ الجدول'], ['seats', '🪑 توزيع الطلاب'], ['invig', '👁️ الملاحظون'], ['print', '🖨️ الطباعة والنشر']];
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><button class="btn sm ghost" id="back">→ الفترات</button><b class="grow">${esc(ss.title)}</b>
        ${ss.published ? '<span class="pill ok">✅ منشورة</span>' : '<span class="pill gold">مسودة</span>'}<button class="btn sm ghost" id="edS">⚙️</button></div>
      <div class="kpi4"><div class="glass card-box"><b>${S.students}</b>طالب</div><div class="glass card-box"><b>${S.rooms.length}</b>لجنة (سعة ${cap})</div>
        <div class="glass card-box"><b>${S.exams.length}</b>اختبار في الجدول</div><div class="glass card-box"><b style="color:${S.seated === S.students && S.students ? '#007B51' : '#b3261e'}">${S.seated}</b>موزّع على اللجان</div></div>
      <div class="seg" id="sub" style="margin-bottom:10px">${subs.map(([k, l]) => `<button data-s="${k}" class="${k === SUB ? 'on' : ''}">${l}</button>`).join('')}</div><div id="sv"></div>`;
    $('#back').onclick = sessionsView; $('#edS').onclick = () => sessionForm(ss);
    $('#sub').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; SUB = b.dataset.s; $$('#sub button').forEach((x) => x.classList.toggle('on', x === b)); drawSub(); };
    view.onclick = null;
    drawSub();
  }
  const reload = () => openSession(S.session.id, SUB);
  const gName = (id) => (S.grades.find((g) => g.id === id) || {}).name || '';
  const room = (id) => S.rooms.find((r) => r.id === id) || {};
  const rName = (r) => r.name || 'لجنة ' + r.no;

  function drawSub() {
    const sv = $('#sv');
    const wrap = (fn) => async (e) => { try { await fn(e); } catch (er) { toast(errMsg(er), 'err'); } };
    if (SUB === 'rooms') {
      sv.innerHTML = `<div class="toolbar"><button class="btn sm primary" id="bulk">＋ إضافة عدة لجان</button><button class="btn sm" id="one">＋ لجنة</button></div>
        <div class="glass" style="padding:6px"><table class="t"><thead><tr><th>رقم</th><th>الاسم</th><th>المكان</th><th>السعة</th><th>الموزّعون</th><th></th></tr></thead><tbody>
        ${S.rooms.map((r) => `<tr><td><b>${r.no}</b></td><td>${esc(rName(r))}</td><td>${esc(r.location || '—')}</td><td>${r.capacity}</td><td>${r.seated}</td>
          <td><button class="btn sm ghost" data-ed="${r.id}">✏️</button><button class="btn sm danger ghost" data-del="${r.id}">🗑</button></td></tr>`).join('') || '<tr><td colspan="6" class="hint">لا توجد لجان — أضفها دفعة واحدة (مثلًا 20 لجنة × 24 طالبًا).</td></tr>'}</tbody></table></div>`;
      $('#bulk').onclick = () => modal({ title: 'إضافة عدة لجان', body: `<div style="display:flex;gap:8px"><label class="f">العدد<input type="number" id="n" value="${Math.max(1, Math.ceil(S.students / 24))}" min="1" max="100"></label>
          <label class="f">سعة كل لجنة<input type="number" id="c" value="24" min="1" max="300"></label></div><label class="f">المكان (اختياري)<input id="l" placeholder="مثال: المبنى أ — الدور الأول"></label>
          <p class="hint">عدد الطلاب ${S.students}؛ السعة الحالية ${S.rooms.reduce((a, r) => a + r.capacity, 0)}.</p>`,
        actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إضافة', cls: 'primary', onClick: async (w) => { await call('ec_rooms_bulk', { p_session: S.session.id, p_count: +$('#n', w).value, p_capacity: +$('#c', w).value, p_location: $('#l', w).value }); reload(); return true; } }] });
      const roomForm = (r) => modal({ title: r.id ? 'تعديل اللجنة' : '＋ لجنة', body: `<div style="display:flex;gap:8px"><label class="f">الرقم<input type="number" id="no" value="${r.no || ''}" style="width:90px"></label>
          <label class="f grow">الاسم<input id="nm" value="${esc(r.name || '')}"></label><label class="f">السعة<input type="number" id="cp" value="${r.capacity || 24}" style="width:90px"></label></div>
          <label class="f">المكان<input id="lc" value="${esc(r.location || '')}"></label>`,
        actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => { await call('ec_room_save', { p: { id: r.id || null, session_id: S.session.id, no: $('#no', w).value, name: $('#nm', w).value, capacity: $('#cp', w).value, location: $('#lc', w).value } }); reload(); return true; } }] });
      $('#one').onclick = () => roomForm({});
      sv.onclick = wrap(async (e) => { const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.ed) roomForm(room(+b.dataset.ed));
        if (b.dataset.del) { if (!await confirmBox('حذف اللجنة؟ سيُلغى توزيع طلابها وملاحظيها.', 'حذف')) return; await call('ec_room_delete', { p_id: +b.dataset.del }); reload(); } });
    }
    if (SUB === 'exams') {
      const days = [...new Set(S.exams.map((x) => x.day))];
      sv.innerHTML = `<div class="toolbar"><button class="btn sm primary" id="add">＋ اختبار</button><span class="hint">لكل صف اختبار واحد في الفترة الواحدة من اليوم</span></div>
        ${days.map((d) => `<div class="glass ec-card"><b>${dn(d)} ${esc(d)}</b><table class="t"><tbody>${S.exams.filter((x) => x.day === d).map((x) => `<tr><td>${SLOTS[x.slot]}${x.start ? ' · ' + esc(x.start) : ''}</td>
          <td>${esc(gName(x.grade_id))}</td><td><b>${esc(x.subject)}</b></td><td>${x.duration} د</td><td><button class="btn sm ghost" data-ed="${x.id}">✏️</button><button class="btn sm danger ghost" data-del="${x.id}">🗑</button></td></tr>`).join('')}</tbody></table></div>`).join('')
          || '<div class="empty">لم يُدخل جدول الاختبارات بعد.</div>'}`;
      const exForm = (x) => {
        const g0 = x.grade_id || (S.grades[0] || {}).id;
        const subOpts = (gid) => { const g = S.grades.find((y) => y.id === +gid) || { subjects: [] }; return g.subjects.sort((a, b) => a.name.localeCompare(b.name, 'ar')).map((s) => `<option value="${s.id}" ${s.id === x.subject_id ? 'selected' : ''}>${esc(s.name)}</option>`).join(''); };
        modal({ title: x.id ? 'تعديل اختبار' : '＋ اختبار', body: `<div style="display:flex;gap:8px;flex-wrap:wrap"><label class="f">اليوم<input type="date" id="dy" value="${esc(x.day || S.session.starts_on || '')}"></label>
            <label class="f">الفترة<select id="sl">${[1, 2, 3, 4].map((n) => `<option value="${n}" ${n === (x.slot || 1) ? 'selected' : ''}>${SLOTS[n]}</option>`).join('')}</select></label>
            <label class="f">البداية<input type="time" id="st" value="${esc(x.start || '08:00')}"></label><label class="f">المدة (د)<input type="number" id="du" value="${x.duration || 90}" style="width:90px"></label></div>
          <label class="f">الصف<select id="gr">${S.grades.map((g) => `<option value="${g.id}" ${g.id === g0 ? 'selected' : ''}>${esc(g.name)} (${g.n})</option>`).join('')}</select></label>
          <label class="f">المادة<select id="sj">${subOpts(g0)}</select></label>`,
          actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }].concat(x.id ? [] : [{ label: 'حفظ وإضافة آخر', cls: '', onClick: async (w) => { await save(w); toast('أُضيف ✓'); return false; } }])
            .concat([{ label: 'حفظ', cls: 'primary', onClick: async (w) => { await save(w); reload(); return true; } }]) });
        const w = [...document.querySelectorAll('.modal-wrap')].pop();
        $('#gr', w).onchange = (e) => { $('#sj', w).innerHTML = subOpts(e.target.value); };
        async function save(w) { await call('ec_exam_save', { p: { id: x.id || null, session_id: S.session.id, day: $('#dy', w).value, slot: $('#sl', w).value, start: $('#st', w).value, duration: $('#du', w).value, grade_id: $('#gr', w).value, subject_id: $('#sj', w).value } }); }
      };
      $('#add').onclick = () => exForm({});
      sv.onclick = wrap(async (e) => { const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.ed) exForm(S.exams.find((x) => x.id === +b.dataset.ed));
        if (b.dataset.del) { await call('ec_exam_delete', { p_id: +b.dataset.del }); reload(); } });
    }
    if (SUB === 'seats') {
      const cap = S.rooms.reduce((a, r) => a + r.capacity, 0);
      sv.innerHTML = `<div class="glass ec-card"><b>التوزيع الآلي</b>
          <p class="hint">${S.students} طالب على ${S.rooms.length} لجنة بسعة ${cap}. ${cap < S.students ? '<span class="pill bad">السعة غير كافية — أضف لجانًا</span>' : ''}</p>
          <label class="chk"><input type="radio" name="md" value="mix" checked> خلط الصفوف داخل اللجنة (طالب من كل صف بالتناوب — يقلل الغش)</label>
          <label class="chk"><input type="radio" name="md" value="grade"> كل صف في لجان متتالية</label>
          <button class="btn primary sm" id="go" ${cap < S.students || !S.rooms.length ? 'disabled' : ''}>🪑 ${S.seated ? 'إعادة التوزيع' : 'توزيع الطلاب وأرقام الجلوس'}</button>
          ${S.seated ? '<p class="hint">⚠️ إعادة التوزيع تغيّر أرقام الجلوس — لا تُعدها بعد الطباعة والنشر.</p>' : ''}</div>
        <div class="glass" style="padding:6px"><table class="t"><thead><tr><th>اللجنة</th><th>المكان</th><th>الطلاب</th><th>الصفوف</th><th></th></tr></thead><tbody>
        ${S.rooms.map((r) => `<tr><td><b>${esc(rName(r))}</b></td><td>${esc(r.location || '—')}</td><td>${r.seated} / ${r.capacity}</td><td style="font-size:.8rem">${(r.grades || []).map(gName).map(esc).join('، ')}</td>
          <td>${r.seated ? `<button class="btn sm ghost" data-list="${r.id}">📄 الكشف</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      $('#go').onclick = wrap(async () => {
        if (S.seated && !await confirmBox('إعادة توزيع كل الطلاب؟ ستتغير أرقام الجلوس واللجان.', 'إعادة التوزيع')) return;
        const r = await call('ec_seat_auto', { p_session: S.session.id, p_mode: $('input[name=md]:checked').value }); toast(`وُزّع ${r.placed} طالب ✓`); reload(); });
      sv.onclick = wrap(async (e) => { const b = e.target.closest('[data-list]'); if (!b) return; const L = await call('ec_seats_list', { p_session: S.session.id, p_room: +b.dataset.list });
        modal({ title: '📄 ' + rName(room(+b.dataset.list)), wide: true, body: `<table class="t"><thead><tr><th>رقم الجلوس</th><th>الطالب</th><th>الصف</th></tr></thead><tbody>${L.map((x) => `<tr><td><b>${x.seat}</b></td><td>${esc(x.name)}</td><td>${esc(x.grade)}${x.class ? ' / ' + esc(x.class) : ''}</td></tr>`).join('')}</tbody></table>`,
          actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }] }); });
    }
    if (SUB === 'invig') {
      const DS = [...new Map(S.exams.map((x) => [x.day + '|' + x.slot, { day: x.day, slot: x.slot }])).values()];
      const used = S.rooms.filter((r) => r.seated);
      const cnt = {}; S.invig.forEach((i) => { cnt[i.name] = (cnt[i.name] || 0) + 1; });
      sv.innerHTML = `<div class="glass ec-card"><b>التوزيع الآلي للملاحظين</b>
          <p class="hint">يُستبعد معلم المادة من لجان طلابه في اختبار مادته، ويُوزَّع العبء بالتساوي بين المعلمين، ولا يُكلَّف المعلم بلجنتين في نفس الفترة.</p>
          <label class="f" style="display:inline-block">ملاحظون لكل لجنة <select id="per"><option>1</option><option selected>2</option><option>3</option></select></label>
          <button class="btn primary sm" id="go" ${DS.length && used.length ? '' : 'disabled'}>👁️ ${S.invig.length ? 'إعادة التوزيع' : 'توزيع الملاحظين'}</button>
          ${!DS.length ? '<p class="hint">أدخل جدول الاختبارات أولًا.</p>' : !used.length ? '<p class="hint">وزّع الطلاب على اللجان أولًا.</p>' : ''}</div>
        ${DS.length && used.length ? `<div class="iv-wrap"><table><thead><tr><th>اليوم / الفترة</th>${used.map((r) => `<th>${esc(rName(r))}</th>`).join('')}</tr></thead><tbody>
          ${DS.map((d) => `<tr><th>${dn(d.day)} ${esc(d.day)}<br><small>${SLOTS[d.slot]}</small></th>${used.map((r) => `<td>${S.invig.filter((i) => i.day === d.day && i.slot === d.slot && i.room_id === r.id)
            .map((i) => `<span class="iv" data-iv="${i.id}">${esc(i.name)}</span>`).join('')}<span class="iv-add" data-add="${d.day}|${d.slot}|${r.id}">＋ إضافة</span></td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <details style="margin-top:10px"><summary class="hint">عبء الملاحظة لكل معلم</summary><table class="t">${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([n, c]) => `<tr><td>${esc(n)}</td><td><b>${c}</b></td></tr>`).join('')}</table></details>` : ''}`;
      $('#go').onclick = wrap(async () => {
        if (S.invig.length && !await confirmBox('إعادة توزيع كل الملاحظين؟ ستُستبدل التعديلات اليدوية.', 'إعادة التوزيع')) return;
        const r = await call('ec_invig_auto', { p_session: S.session.id, p_per: +$('#per').value }); toast(`كُلّف ${r.assigned}${r.missing ? ` — نقص ${r.missing} (لا يوجد معلمون متاحون)` : ''} ✓`); reload(); });
      const pick = async (day, slot, cb, cur) => {
        const F = await call('ec_invig_free', { p_session: S.session.id, p_day: day, p_slot: slot });
        modal({ title: `اختيار ملاحظ — ${dn(day)} ${SLOTS[slot]}`, body: `<input id="q" type="search" placeholder="ابحث…" style="width:100%;margin-bottom:6px"><div style="max-height:340px;overflow:auto" id="fl">
            ${F.map((t) => `<div class="mine-row" style="padding:6px 8px;margin:0;cursor:pointer" data-t="${t.id}" data-q="${esc(LMS.norm(t.name))}"><span class="grow">${esc(t.name)}${t.own ? "" : " <small class=\"hint\">(مرحلة أخرى)</small>"}</span><span class="pill">${t.n} ملاحظة</span></div>`).join('') || '<div class="empty">لا يوجد معلمون متاحون.</div>'}</div>`,
          actions: (cur ? [{ label: '🗑 إزالة', cls: 'danger ghost', onClick: async () => { await cb(null); return true; } }] : []).concat([{ label: 'إغلاق', value: null, cls: 'ghost' }]) });
        const w = [...document.querySelectorAll('.modal-wrap')].pop();
        $('#q', w).oninput = (e) => { const v = LMS.norm(e.target.value); $$('[data-q]', w).forEach((x) => { x.style.display = LMS.has(x.dataset.q, v) ? '' : 'none'; }); };
        $('#fl', w).onclick = wrap(async (e) => { const r = e.target.closest('[data-t]'); if (!r) return; await cb(r.dataset.t); w.remove(); });
      };
      sv.onclick = wrap(async (e) => {
        const a = e.target.closest('[data-add]'), v = e.target.closest('[data-iv]');
        if (a) { const [day, slot, rid] = a.dataset.add.split('|'); return pick(day, +slot, async (t) => { await call('ec_invig_add', { p_session: S.session.id, p_day: day, p_slot: +slot, p_room: +rid, p_teacher: t }); reload(); }); }
        if (v) { const i = S.invig.find((x) => x.id === +v.dataset.iv); return pick(i.day, i.slot, async (t) => { await call('ec_invig_set', { p_id: i.id, p_teacher: t }); reload(); }, true); }
      });
    }
    if (SUB === 'print') {
      const ss = S.session;
      sv.innerHTML = `<div class="glass ec-card"><b>🖨️ الطباعة</b><div class="acts">
          <button class="btn sm" data-pr="cards">🪪 بطاقات أرقام الجلوس</button><button class="btn sm" data-pr="lists">📄 كشوف اللجان (حضور وتوقيع)</button>
          <button class="btn sm" data-pr="doors">🚪 لوحات أبواب اللجان</button><button class="btn sm" data-pr="invig">👁️ جدول الملاحظين</button>
          <button class="btn sm" data-pr="sched">🗓️ جدول الاختبارات</button></div></div>
        <div class="glass ec-card"><b>📢 النشر</b><p class="hint">عند النشر: يرى كل طالب رقم جلوسه ولجنته وجدوله في المنصة، ويظهر لولي الأمر في بوابته، ويصل لكل ملاحظ إشعار بجدول ملاحظته.</p>
          <button class="btn sm ${ss.published ? 'ghost' : 'primary'}" id="pub">${ss.published ? '🙈 إلغاء النشر' : '📢 نشر وإشعار الملاحظين'}</button></div>`;
      $('#pub').onclick = wrap(async () => {
        if (!ss.published && !await confirmBox('نشر لجان الاختبارات للطلاب وأولياء الأمور وإرسال جداول الملاحظة للمعلمين؟', 'نشر')) return;
        const n = await call('ec_publish', { p_session: ss.id, p_on: !ss.published, p_notify: true }); toast(ss.published ? 'أُلغي النشر' : `نُشرت ✓ — أُرسل الإشعار لـ ${n} ملاحظ`); reload(); });
      sv.onclick = wrap(async (e) => { const b = e.target.closest('[data-pr]'); if (!b) return; await printDoc(b.dataset.pr); });
    }
  }

  async function printDoc(kind) {
    const ss = S.session;
    if (['cards', 'lists', 'doors'].includes(kind) && !S.seated) return toast('وزّع الطلاب أولًا', 'err');
    if (kind === 'sched') {
      const days = [...new Set(S.exams.map((x) => x.day))];
      return RC.printHtml(`<div class="pg">${head('جدول ' + ss.title)}<table class="ptbl"><thead><tr><th>اليوم</th><th>التاريخ</th><th>الفترة</th><th>الصف</th><th>المادة</th><th>البداية</th><th>المدة</th></tr></thead><tbody>
        ${days.map((d) => S.exams.filter((x) => x.day === d).map((x) => `<tr><td>${dn(d)}</td><td>${esc(d)}</td><td>${SLOTS[x.slot]}</td><td>${esc(gName(x.grade_id))}</td><td><b>${esc(x.subject)}</b></td><td>${esc(x.start || '')}</td><td>${x.duration} د</td></tr>`).join('')).join('')}</tbody></table></div>`);
    }
    if (kind === 'invig') {
      const DS = [...new Map(S.exams.map((x) => [x.day + '|' + x.slot, { day: x.day, slot: x.slot }])).values()];
      const used = S.rooms.filter((r) => r.seated);
      return RC.printHtml(`<div class="pg">${head('جدول الملاحظين — ' + ss.title)}<table class="ptbl"><thead><tr><th>اليوم / الفترة</th>${used.map((r) => `<th>${esc(rName(r))}</th>`).join('')}</tr></thead><tbody>
        ${DS.map((d) => `<tr><td>${dn(d.day)} ${esc(d.day)}<br>${SLOTS[d.slot]}</td>${used.map((r) => `<td>${S.invig.filter((i) => i.day === d.day && i.slot === d.slot && i.room_id === r.id).map((i) => esc(i.name)).join('<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
    }
    const L = await call('ec_seats_list', { p_session: ss.id, p_room: null });
    const byRoom = {}; L.forEach((x) => { (byRoom[x.room_id] = byRoom[x.room_id] || []).push(x); });
    if (kind === 'cards') {
      const pages = []; for (let i = 0; i < L.length; i += 10) pages.push(L.slice(i, i + 10));
      return RC.printHtml(pages.map((p) => `<div class="pg"><div class="seatcards">${p.map((x) => `<div class="seatcard"><div style="display:flex;justify-content:space-between;align-items:center">
          <img src="${esc(C.LOGO_H || 'assets/img/brand/logo-h.svg')}" style="height:28px"><small>${esc(ss.title)}</small></div>
          <div class="n">${x.seat}</div><div><b>${esc(x.name)}</b></div><div>${esc(x.grade)}${x.class ? ' / ' + esc(x.class) : ''}</div><div>${esc(x.room)}${x.location ? ' — ' + esc(x.location) : ''}</div></div>`).join('')}</div></div>`).join(''));
    }
    if (kind === 'lists') {
      return RC.printHtml(S.rooms.filter((r) => byRoom[r.id]).map((r) => `<div class="pg">${head(ss.title, 'كشف ' + rName(r) + (r.location ? ' — ' + r.location : ''))}
        <table class="ptbl"><thead><tr><th>م</th><th>رقم الجلوس</th><th>اسم الطالب</th><th>الصف</th><th>الحضور</th><th>التوقيع</th></tr></thead><tbody>
        ${byRoom[r.id].map((x, i) => `<tr><td>${i + 1}</td><td><b>${x.seat}</b></td><td class="s">${esc(x.name)}</td><td>${esc(x.grade)}</td><td style="width:70px"></td><td style="width:110px"></td></tr>`).join('')}</tbody></table>
        <p style="margin-top:14px">الملاحظ: ........................................ التوقيع: ................ &nbsp;&nbsp; عدد الحاضرين: ...... عدد الغائبين: ......</p></div>`).join(''));
    }
    if (kind === 'doors') {
      return RC.printHtml(S.rooms.filter((r) => byRoom[r.id]).map((r) => { const a = byRoom[r.id]; return `<div class="pg">${head(ss.title)}<div class="door"><div style="font-size:30px">${esc(rName(r).replace(/\d+$/, '').trim() || 'لجنة')}</div>
        <div class="big">${r.no}</div>${r.location ? `<div style="font-size:22px">${esc(r.location)}</div>` : ''}
        <div style="font-size:26px;margin-top:20px">أرقام الجلوس من <b>${a[0].seat}</b> إلى <b>${a[a.length - 1].seat}</b></div>
        <div style="font-size:18px;margin-top:10px">${[...new Set(a.map((x) => x.grade))].map(esc).join(' · ')}</div></div></div>`; }).join(''));
    }
  }

  paint();
})();
