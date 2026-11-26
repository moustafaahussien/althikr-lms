/* =====================================================================
   سلالم التقدير ونواتج التعلم (sql/65)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role;
  if (role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('rubrics', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const topW = () => [...document.querySelectorAll('.modal-wrap')].pop();

  if (role === 'student') return studentView();

  let CTX;
  try { CTX = await call('rb_ctx'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const PAIRS = CTX.mine.map((m) => Object.assign({ own: true }, m)).concat(CTX.review.map((m) => Object.assign({ own: false }, m)));
  const pairKey = (p) => p.class_id + ':' + p.subject_id;
  let PAIR = PAIRS[0] ? pairKey(PAIRS[0]) : '';
  const pairSel = () => PAIRS.length ? `<select id="pair">${CTX.mine.length ? '<optgroup label="فصولي">' + CTX.mine.map((p) => `<option value="${pairKey(p)}">${esc(p.class)} — ${esc(p.subject)}</option>`).join('') + '</optgroup>' : ''}
      ${CTX.review.length ? '<optgroup label="فصول أتابعها">' + CTX.review.map((p) => `<option value="${pairKey(p)}">${esc(p.class)} — ${esc(p.subject)} (${esc(p.teacher)})</option>`).join('') + '</optgroup>' : ''}</select>` : '';
  const curPair = () => PAIRS.find((p) => pairKey(p) === PAIR);

  const tabs = [['eval', '📝 التقييم'], ['rubrics', '🧩 سلالم التقدير'], ['lo', '🎯 نواتج التعلم'], ['mastery', '📈 إتقان النواتج']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : (PAIRS.length ? 'eval' : 'rubrics');
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => ({ eval: evalTab, rubrics: rubricsTab, lo: loTab, mastery: masteryTab })[TAB]();
  const bindPair = (fn) => { const s = $('#pair'); if (!s) return; s.value = PAIR; s.onchange = () => { PAIR = s.value; fn(); }; };
  const noPairs = '<div class="empty">لا توجد لديك فصول مسندة في «الإسناد» (فصل + مادة).<br><small>التقييم بالسلالم لمعلم المادة في فصله؛ ويمكنك الآن تصميم السلالم وإدارة نواتج التعلم.</small></div>';

  /* ======================= التقييم ======================= */
  async function evalTab() {
    if (!PAIRS.length) { view.innerHTML = noPairs; return; }
    const p = curPair();
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap">${pairSel()}<span class="grow"></span>
      ${p.own ? '<button class="btn primary sm" id="new">＋ تقييم جديد بسلّم</button>' : ''}</div><div id="lst"><div class="empty">جارٍ التحميل…</div></div>`;
    bindPair(evalTab);
    let L = [];
    try { L = await call('rb_evals_list', { p_class: p.class_id, p_subject: p.subject_id }); } catch (e) { $('#lst').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    $('#lst').innerHTML = L.map((e) => `<div class="glass rb-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(e.title)}</b>
        ${e.gb ? '<span class="pill ok">📒 مرحّل لسجل الدرجات</span>' : ''}${e.avg != null ? `<span class="pill gold">متوسط الفصل ${e.avg}%</span>` : ''}</div>
        <div class="hint">${esc(e.date)} · السلّم: ${esc(e.rubric)} · من ${e.max} · قُيّم ${e.done} طالب${e.show ? '' : ' · مخفي عن الطلاب'}</div>
        <div class="acts"><button class="btn sm primary" data-open="${e.id}">${p.own ? '✍️ رصد التقييم' : '👁️ عرض'}</button>
        ${p.own ? `<button class="btn sm danger ghost" data-del="${e.id}">🗑</button>` : ''}</div></div>`).join('') ||
      `<div class="empty">لا توجد تقييمات بالسلالم لهذا الفصل بعد.${p.own ? '<br><small>اضغط «＋ تقييم جديد بسلّم» واختر سلّمًا من سلالمك أو من قوالب المدرسة.</small>' : ''}</div>`;
    if ($('#new')) $('#new').onclick = () => newEval(p);
    $('#lst').onclick = async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.dataset.open) return gradeGrid(+b.dataset.open);
      if (b.dataset.del) { if (!await confirmBox('حذف التقييم ودرجاته؟ إن كان مرحّلًا لسجل الدرجات فسيُحذف عموده أيضًا.', 'حذف')) return;
        try { await call('rb_eval_delete', { p_id: +b.dataset.del }); toast('حُذف'); evalTab(); } catch (e) { toast(errMsg(e), 'err'); } }
    };
  }

  async function newEval(p) {
    let R = [];
    try { R = await call('rb_list'); } catch (e) { return toast(errMsg(e), 'err'); }
    if (!R.length) return toast('لا توجد سلالم — أنشئ سلّمًا أولًا من تبويب «سلالم التقدير»', 'err');
    const rel = (r) => (!r.subject_id || r.subject_id === p.subject_id);
    const opt = (r) => `<option value="${r.id}">${esc(r.title)}${r.template ? ' — قالب المدرسة' : r.mine ? '' : ' — ' + esc(r.owner || '')} (من ${r.max})</option>`;
    modal({ title: '＋ تقييم جديد — ' + p.class + ' — ' + p.subject, body: `
      <label class="f">سلّم التقدير *<select id="rb">${R.filter(rel).map(opt).join('')}${R.some((r) => !rel(r)) ? '<optgroup label="مواد أخرى">' + R.filter((r) => !rel(r)).map(opt).join('') + '</optgroup>' : ''}</select></label>
      <label class="f">عنوان التقييم *<input id="tt" placeholder="مثال: عرض مشروع الوحدة الثانية"></label>
      <label class="f">التاريخ<input type="date" id="dt" value="${new Date().toISOString().slice(0, 10)}"></label>
      <label class="chk"><input type="checkbox" id="gb" checked> ترحيل المجموع تلقائيًا إلى سجل الدرجات (عمود جديد)</label>
      <div id="gbo" style="display:flex;gap:8px;flex-wrap:wrap"><label class="f">الفترة<select id="pr"><option value="">—</option><option value="p1">الفترة الأولى</option><option value="p2">الفترة الثانية</option><option value="mid">منتصف الفصل</option><option value="final">نهائي</option></select></label>
        <label class="f">التصنيف<select id="ct"><option value="project">مشروع</option><option value="oral">شفهي</option><option value="participation">مشاركة</option><option value="quiz">اختبار قصير</option><option value="other">أخرى</option></select></label>
        <label class="f">الوزن<input type="number" id="wt" value="1" min="0" max="100" style="width:80px"></label></div>
      <label class="chk"><input type="checkbox" id="sh" checked> يظهر للطالب مع تفاصيل المعايير</label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إنشاء وفتح الرصد', cls: 'primary', onClick: async (w) => {
        const id = await call('rb_eval_create', { p: { rubric_id: +$('#rb', w).value, class_id: p.class_id, subject_id: p.subject_id, title: $('#tt', w).value, date: $('#dt', w).value,
          to_gradebook: $('#gb', w).checked, period: $('#pr', w).value, category: $('#ct', w).value, weight: $('#wt', w).value, show_student: $('#sh', w).checked } });
        setTimeout(() => { evalTab(); gradeGrid(id); }, 0); return true; } }] });
    const w = topW(); $('#gb', w).onchange = (e) => { $('#gbo', w).style.display = e.target.checked ? 'flex' : 'none'; };
  }

  async function gradeGrid(id) {
    let E;
    try { E = await call('rb_eval_get', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const C = E.rubric.criteria, LV = E.rubric.levels, ed = E.can_edit;
    const tot = (m) => { let t = 0, full = true; C.forEach((c) => { const v = m[c.key]; if (v == null || v === '') full = false; else t += +v * (c.weight || 1); }); return full ? Math.round(t * 100) / 100 : null; };
    const sel = (s, c) => ed ? `<select data-s="${s.id}" data-k="${c.key}"><option value="">—</option>${LV.map((l) => `<option value="${l.points}" ${String(s.marks[c.key]) === String(l.points) ? 'selected' : ''}>${esc(l.label)} (${l.points})</option>`).join('')}</select>`
      : esc((LV.find((l) => String(l.points) === String(s.marks[c.key])) || {}).label || '—');
    const body = `<div class="hint">${esc(E.class)} — ${esc(E.subject)} · ${esc(E.date)} · السلّم: <b>${esc(E.rubric.title)}</b> · الدرجة من ${E.max}${E.gb ? ' · 📒 يُرحَّل لسجل الدرجات' : ''}</div>
      <details class="noprint" style="margin:6px 0"><summary class="hint">عرض وصف المستويات لكل معيار</summary>${rubricTable(E.rubric, E.outcomes)}</details>
      <div class="grid-wrap"><table><thead><tr><th>الطالب</th>${C.map((c) => `<th title="${esc(E.outcomes[c.outcome_id] || '')}">${esc(c.name)}${c.weight !== 1 ? ` <small>×${c.weight}</small>` : ''}${c.outcome_id ? ' 🎯' : ''}
          ${ed ? `<br><select class="noprint" data-all="${c.key}" style="min-width:70px;font-size:.75rem"><option value="">للجميع…</option>${LV.map((l) => `<option value="${l.points}">${esc(l.label)}</option>`).join('')}</select>` : ''}</th>`).join('')}
        <th>المجموع</th><th>ملاحظة</th></tr></thead><tbody>
        ${E.students.map((s) => `<tr data-row="${s.id}"><td><b>${esc(s.name)}</b></td>${C.map((c) => `<td>${sel(s, c)}</td>`).join('')}
          <td class="tot" data-t="${s.id}">${s.total != null ? s.total : '—'}</td>
          <td>${ed ? `<input data-n="${s.id}" value="${esc(s.note || '')}" style="min-width:140px">` : esc(s.note || '')}</td></tr>`).join('')}</tbody></table></div>
      ${ed ? '<p class="hint">اختر مستوى كل معيار؛ يُحسب المجموع تلقائيًا (المستوى × وزن المعيار). المجموع يُرحَّل فقط عند اكتمال كل المعايير للطالب.</p>' : ''}`;
    const dirty = new Set();
    modal({ title: '✍️ ' + E.title, wide: true, body, actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }, { label: '🖨️ طباعة', cls: 'ghost', onClick: () => { window.print(); return false; } }]
      .concat(ed ? [{ label: '💾 حفظ', cls: 'primary', onClick: async (w) => {
        const rows = [...dirty].map((sid) => { const m = {}; $$(`select[data-s="${sid}"]`, w).forEach((x) => { if (x.value !== '') m[x.dataset.k] = +x.value; });
          return { student: sid, marks: m, note: $(`input[data-n="${sid}"]`, w).value }; });
        if (!rows.length) return true;
        for (let i = 0; i < rows.length; i += 150) await call('rb_eval_save', { p_id: E.id, p_rows: rows.slice(i, i + 150) });
        toast(`حُفظ تقييم ${rows.length} طالب ✓`); evalTab(); return true; } }] : []) });
    const w = topW(); if (!ed) return;
    const recalc = (sid) => { const m = {}; $$(`select[data-s="${sid}"]`, w).forEach((x) => { m[x.dataset.k] = x.value; }); const t = tot(m); $(`[data-t="${sid}"]`, w).textContent = t != null ? t : '—'; dirty.add(sid); };
    w.addEventListener('change', (e) => {
      const t = e.target;
      if (t.dataset.s) recalc(t.dataset.s);
      if (t.dataset.n) dirty.add(t.dataset.n);
      if (t.dataset.all) { if (t.value === '') return; $$(`select[data-k="${t.dataset.all}"]`, w).forEach((x) => { if (x.value === '') { x.value = t.value; recalc(x.dataset.s); } }); t.value = ''; toast('طُبّق على من لم يُقيَّم بعد — راجع وعدّل الاستثناءات'); }
    });
  }

  const rubricTable = (r, outs) => `<div style="overflow:auto"><table class="rb"><thead><tr><th>المعيار</th>${r.levels.map((l) => `<th>${esc(l.label)} (${l.points})</th>`).join('')}</tr></thead><tbody>
    ${r.criteria.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.weight !== 1 ? ` <small class="hint">×${c.weight}</small>` : ''}${c.outcome_id && outs && outs[c.outcome_id] ? `<div class="hint">🎯 ${esc(outs[c.outcome_id])}</div>` : ''}</td>
      ${r.levels.map((l, i) => `<td>${esc((c.desc || [])[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

  /* ======================= سلالم التقدير ======================= */
  async function rubricsTab() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let R = [];
    try { R = await call('rb_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const grp = (t, a) => a.length ? `<h3 style="margin:14px 0 6px">${t}</h3>` + a.map((r) => `<div class="glass rb-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(r.title)}</b>
        ${r.shared && r.mine ? '<span class="pill ok">مشارَك</span>' : ''}<span class="pill">${r.criteria.length} معايير · ${r.levels.length} مستويات · من ${r.max}</span></div>
        <div class="hint">${r.subject ? esc(r.subject) : 'كل المواد'}${r.grade ? ' · ' + esc(r.grade) : ''}${!r.mine && !r.template ? ' · ' + esc(r.owner || '') : ''}${r.uses ? ' · استُخدم ' + r.uses + ' مرة' : ''}</div>
        <div class="acts"><button class="btn sm" data-view="${r.id}">👁️ عرض</button>${r.can_edit ? `<button class="btn sm" data-ed="${r.id}">✏️ تعديل</button>` : ''}
          <button class="btn sm ghost" data-cp="${r.id}">📄 نسخ إلى سلالمي</button>${r.can_edit ? `<button class="btn sm danger ghost" data-del="${r.id}">🗑</button>` : ''}</div></div>`).join('') : '';
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="new">＋ سلّم تقدير جديد</button>
        ${['admin', 'leadership'].includes(role) ? '<button class="btn sm" id="newT">＋ قالب للمدرسة</button>' : ''}<span class="grow"></span><span class="hint">السلّم يحدّد المعايير ومستويات الأداء ووصف كل مستوى</span></div>
      ${grp('🧩 سلالمي', R.filter((r) => r.mine))}${grp('🏫 قوالب المدرسة الجاهزة', R.filter((r) => r.template))}${grp('🤝 سلالم يشاركها الزملاء', R.filter((r) => !r.mine && !r.template))}`;
    $('#new').onclick = () => rubricForm(null, false);
    if ($('#newT')) $('#newT').onclick = () => rubricForm(null, true);
    view.onclick = async (e) => {
      const b = e.target.closest('button[data-view],button[data-ed],button[data-cp],button[data-del]'); if (!b) return;
      const r = R.find((x) => x.id === +(b.dataset.view || b.dataset.ed || b.dataset.cp || b.dataset.del));
      try {
        if (b.dataset.view) { let outs = {}; if (r.subject_id) (await call('lo_list', { p_subject: r.subject_id, p_grade: r.grade_id })).forEach((o) => { outs[o.id] = (o.code ? o.code + ' — ' : '') + o.text; });
          return modal({ title: '🧩 ' + r.title, wide: true, body: rubricTable(r, outs), actions: [{ label: '🖨️ طباعة', cls: 'ghost', onClick: () => { window.print(); return false; } }, { label: 'إغلاق', value: null, cls: 'ghost' }] }); }
        if (b.dataset.ed) return rubricForm(r, r.template);
        if (b.dataset.cp) { const id = await call('rb_copy', { p_id: r.id }); toast('نُسخ إلى سلالمك ✓ — يمكنك تعديله'); await rubricsTab(); const nr = (await call('rb_list')).find((x) => x.id === id); if (nr) rubricForm(nr, false); return; }
        if (b.dataset.del) { if (!await confirmBox('حذف السلّم؟', 'حذف')) return; await call('rb_delete', { p_id: r.id }); toast('حُذف'); rubricsTab(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  function rubricForm(r, tpl) {
    const D = r ? JSON.parse(JSON.stringify(r)) : { title: '', subject_id: (CTX.mine[0] || {}).subject_id || null, grade_id: null, shared: false,
      levels: [{ label: 'متميز', points: 4 }, { label: 'متقدم', points: 3 }, { label: 'متمكن', points: 2 }, { label: 'مبتدئ', points: 1 }],
      criteria: [{ name: '', weight: 1, outcome_id: null, desc: [] }] };
    let OUT = [];
    const opts = (a, v, ph) => `<option value="">${ph}</option>` + a.map((x) => `<option value="${x.id}" ${x.id === v ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    const body = `<div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px"><label class="f">عنوان السلّم *<input id="tt" value="${esc(D.title)}" placeholder="مثال: تقرير المختبر"></label>
        <label class="f">المادة<select id="sj">${opts(CTX.subjects, D.subject_id, 'كل المواد')}</select></label><label class="f">الصف<select id="gr">${opts(CTX.grades, D.grade_id, 'كل الصفوف')}</select></label></div>
      ${tpl ? '<p class="hint">🏫 قالب للمدرسة: يظهر لكل المعلمين ويمكنهم نسخه واستخدامه.</p>' : `<label class="chk"><input type="checkbox" id="shr" ${D.shared ? 'checked' : ''}> مشاركة السلّم مع زملائي (يمكنهم استخدامه ونسخه)</label>`}
      <b>مستويات الأداء</b> <small class="hint">(من الأعلى للأدنى)</small><div id="lvs" style="margin:6px 0 10px"></div>
      <b>المعايير</b> <small class="hint">— لكل معيار: الاسم، الوزن، ناتج التعلم المرتبط، ووصف الأداء في كل مستوى</small><div id="crs" style="margin-top:6px"></div>
      <button class="btn sm" id="addc" type="button">＋ معيار</button>`;
    modal({ title: r ? 'تعديل سلّم التقدير' : tpl ? 'قالب جديد للمدرسة' : 'سلّم تقدير جديد', wide: true, body, actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      read(w);
      await call('rb_save', { p: { id: r ? r.id : null, template: tpl, title: $('#tt', w).value, subject_id: $('#sj', w).value, grade_id: $('#gr', w).value,
        shared: $('#shr', w) ? $('#shr', w).checked : false, levels: D.levels, criteria: D.criteria } });
      toast('حُفظ السلّم ✓'); rubricsTab(); return true; } }] });
    const w = topW();
    const read = () => {
      D.levels = $$('.lv-row', w).map((x) => ({ label: $('[data-l]', x).value.trim(), points: +$('[data-p]', x).value }));
      D.criteria = $$('.cr', w).map((x) => ({ key: x.dataset.key || '', name: $('[data-cn]', x).value.trim(), weight: +$('[data-cw]', x).value || 1,
        outcome_id: $('[data-co]', x).value ? +$('[data-co]', x).value : null, desc: $$('[data-cd]', x).map((t) => t.value.trim()) }));
    };
    const draw = () => {
      $('#lvs', w).innerHTML = D.levels.map((l, i) => `<div class="lv-row"><input data-l value="${esc(l.label)}" placeholder="اسم المستوى"><input data-p type="number" min="0" step="0.5" value="${l.points}">
          <button class="btn sm ghost" data-rl="${i}" type="button" ${D.levels.length <= 2 ? 'disabled' : ''}>✕</button></div>`).join('') +
        (D.levels.length < 6 ? '<button class="btn sm ghost" id="addl" type="button">＋ مستوى</button>' : '');
      $('#crs', w).innerHTML = D.criteria.map((c, i) => `<div class="cr" data-key="${esc(c.key || '')}"><div class="ed-row"><input data-cn value="${esc(c.name)}" placeholder="المعيار ${i + 1}">
          <input data-cw type="number" min="0.1" step="0.5" value="${c.weight || 1}" title="الوزن">
          <select data-co><option value="">— بدون ناتج تعلم —</option>${OUT.map((o) => `<option value="${o.id}" ${o.id === c.outcome_id ? 'selected' : ''}>${esc((o.code ? o.code + ' — ' : '') + o.text).slice(0, 90)}</option>`).join('')}</select>
          <button class="btn sm ghost" data-rc="${i}" type="button" ${D.criteria.length <= 1 ? 'disabled' : ''}>✕</button></div>
          <div class="ed-desc">${D.levels.map((l, j) => `<textarea data-cd placeholder="وصف «${esc(l.label)}»">${esc((c.desc || [])[j] || '')}</textarea>`).join('')}</div></div>`).join('');
    };
    const loadOut = async () => { read(); const sj = $('#sj', w).value; OUT = sj ? await call('lo_list', { p_subject: +sj, p_grade: $('#gr', w).value ? +$('#gr', w).value : null }).catch(() => []) : []; draw(); };
    w.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'addl') { read(); D.levels.push({ label: '', points: 0 }); draw(); }
      if (b.dataset.rl) { read(); D.levels.splice(+b.dataset.rl, 1); D.criteria.forEach((c) => (c.desc || []).splice(+b.dataset.rl, 1)); draw(); }
      if (b.id === 'addc') { read(); D.criteria.push({ name: '', weight: 1, outcome_id: null, desc: [] }); draw(); }
      if (b.dataset.rc) { read(); D.criteria.splice(+b.dataset.rc, 1); draw(); }
    });
    $('#sj', w).onchange = loadOut; $('#gr', w).onchange = loadOut;
    draw(); loadOut();
  }

  /* ======================= نواتج التعلم ======================= */
  let LO_S = (CTX.mine[0] || {}).subject_id || (CTX.subjects[0] || {}).id, LO_G = (CTX.mine[0] || {}).grade_id || '';
  async function loTab() {
    const so = CTX.subjects.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><select id="ls">${so}</select><select id="lg"><option value="">كل الصفوف</option>${CTX.grades.map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      <span class="grow"></span><button class="btn sm primary" id="add">＋ ناتج</button><button class="btn sm" id="bulk">📋 لصق قائمة نواتج</button></div><div id="lst" class="glass" style="padding:4px"></div>`;
    $('#ls').value = LO_S || ''; $('#lg').value = LO_G || '';
    $('#ls').onchange = (e) => { LO_S = +e.target.value; loTab(); }; $('#lg').onchange = (e) => { LO_G = e.target.value; loTab(); };
    if (!LO_S) { $('#lst').innerHTML = '<div class="empty">لا توجد مواد.</div>'; return; }
    let L = [];
    try { L = await call('lo_list', { p_subject: +LO_S, p_grade: LO_G ? +LO_G : null }); } catch (e) { $('#lst').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const canEd = L.length ? L[0].can_edit : true;
    $('#lst').innerHTML = L.map((o) => `<div class="lo-row"><div class="grow">${o.code ? `<code>${esc(o.code)}</code> ` : ''}${esc(o.text)}
        <div class="hint">${o.grade ? esc(o.grade) : 'كل الصفوف'}${o.domain ? ' · ' + esc(o.domain) : ''} · أضافه ${esc(o.by || '')}</div></div>
        ${o.can_edit ? `<button class="btn sm ghost" data-ed="${o.id}">✏️</button><button class="btn sm danger ghost" data-del="${o.id}">🗑</button>` : ''}</div>`).join('') ||
      '<div class="empty">لا توجد نواتج تعلم لهذه المادة والصف بعد.<br><small>أضفها واحدًا واحدًا، أو الصق القائمة كاملة من وثيقة المنهج دفعة واحدة.</small></div>';
    $('#add').onclick = () => loForm({}); $('#bulk').onclick = loBulk;
    if (!canEd) { $('#add').disabled = $('#bulk').disabled = true; }
    $('#lst').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const o = L.find((x) => x.id === +(b.dataset.ed || b.dataset.del));
      if (b.dataset.ed) return loForm(o);
      if (b.dataset.del) { if (!await confirmBox('حذف الناتج؟ (يبقى في التقييمات السابقة)', 'حذف')) return; try { await call('lo_delete', { p_id: o.id }); loTab(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function loForm(o) {
    modal({ title: o.id ? 'تعديل ناتج التعلم' : '＋ ناتج تعلم', body: `<div style="display:grid;grid-template-columns:110px 1fr;gap:8px"><label class="f">الرمز<input id="cd" value="${esc(o.code || '')}" placeholder="ع.1"></label>
        <label class="f">المجال (اختياري)<input id="dm" value="${esc(o.domain || '')}" placeholder="مثال: المادة وخصائصها"></label></div>
      <label class="f">نص الناتج *<textarea id="tx" rows="3" placeholder="يتوقع من الطالب أن…">${esc(o.text || '')}</textarea></label>
      <label class="f">الصف<select id="gg"><option value="">كل الصفوف</option>${CTX.grades.map((g) => `<option value="${g.id}" ${String(g.id) === String(o.id ? o.grade_id || '' : LO_G) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('lo_save', { p: { id: o.id || null, subject_id: +LO_S, grade_id: $('#gg', w).value, code: $('#cd', w).value, domain: $('#dm', w).value, text: $('#tx', w).value } });
        toast('حُفظ ✓'); loTab(); return true; } }] });
  }
  function loBulk() {
    modal({ title: '📋 لصق قائمة نواتج', body: `<p class="hint">سطر لكل ناتج. لإضافة رمز اكتبه في بداية السطر متبوعًا بشرطة أو نقطتين، مثل: <code>ع.1 - يحدد خصائص المادة</code></p>
      <label class="f">الصف<select id="gg"><option value="">كل الصفوف</option>${CTX.grades.map((g) => `<option value="${g.id}" ${String(g.id) === String(LO_G) ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
      <textarea id="ln" rows="10" style="width:100%"></textarea>`, actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إضافة', cls: 'primary', onClick: async (w) => {
        const n = await call('lo_bulk', { p_subject: +LO_S, p_grade: $('#gg', w).value ? +$('#gg', w).value : null, p_lines: $('#ln', w).value });
        toast(`أُضيف ${n} ناتج ✓`); loTab(); return true; } }] });
  }

  /* ======================= إتقان النواتج ======================= */
  async function masteryTab() {
    if (!PAIRS.length) { view.innerHTML = noPairs; return; }
    const p = curPair();
    view.innerHTML = `<div class="toolbar glass" style="padding:10px">${pairSel()}<span class="grow"></span><button class="btn sm ghost" id="prn">🖨️ طباعة</button></div><div id="mt"><div class="empty">جارٍ التحميل…</div></div>`;
    bindPair(masteryTab); $('#prn').onclick = () => window.print();
    let M;
    try { M = await call('lo_mastery', { p_class: p.class_id, p_subject: p.subject_id }); } catch (e) { $('#mt').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!M.outcomes.length) { $('#mt').innerHTML = '<div class="empty">لا توجد بيانات إتقان بعد.<br><small>اربط معايير سلالم التقدير بنواتج التعلم (من تعديل السلّم)، ثم قيّم الطلاب — يظهر هنا مستوى إتقان كل طالب لكل ناتج.</small></div>'; return; }
    const col = (v) => v == null ? '#fff' : v >= 85 ? '#cdeedd' : v >= 70 ? '#e6f6ee' : v >= 50 ? '#fff4d6' : '#fde2df';
    $('#mt').innerHTML = `<p class="hint">نسبة الإتقان = متوسط مستوى الطالب في كل المعايير المرتبطة بالناتج عبر كل التقييمات (أعلى مستوى = 100%).
        <span class="pill" style="background:#cdeedd">85%+ متقن</span> <span class="pill" style="background:#e6f6ee">70–84</span> <span class="pill" style="background:#fff4d6">50–69</span> <span class="pill" style="background:#fde2df">أقل من 50 يحتاج دعمًا</span></p>
      <div class="grid-wrap"><table class="heat"><thead><tr><th>الطالب</th>${M.outcomes.map((o) => `<th title="${esc(o.text)}">${esc(o.code || ('ن' + o.id))}</th>`).join('')}</tr>
        <tr><th>متوسط الفصل</th>${M.outcomes.map((o) => `<th style="background:${col(o.avg)}">${o.avg}%</th>`).join('')}</tr></thead><tbody>
        ${M.students.map((s) => `<tr><td>${esc(s.name)}</td>${M.outcomes.map((o) => { const v = s.v[o.id]; return `<td class="c" style="background:${col(v)}">${v != null ? v + '%' : '—'}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
      <h3 style="margin-top:14px">النواتج</h3>${M.outcomes.map((o) => `<div class="lo-row"><div class="grow">${o.code ? `<code>${esc(o.code)}</code> ` : ''}${esc(o.text)}</div>
        <span class="pill" style="background:${col(o.avg)}">${o.avg}% · ${o.n} طالب</span></div>`).join('')}`;
  }

  /* ======================= الطالب ======================= */
  async function studentView() {
    $('#tabs').style.display = 'none';
    let L = [];
    try { L = await call('rb_my'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.map((x) => `<div class="glass rb-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(x.title)}</b><span class="pill gold">${x.total != null ? x.total + ' / ' + x.max : 'قيد التقييم'}</span></div>
        <div class="hint">${esc(x.subject || '')} · ${esc(x.date)}</div>
        <div style="overflow:auto;margin-top:6px"><table class="rb"><tbody>${x.rubric.criteria.map((c) => { const lv = x.rubric.levels.findIndex((l) => String(l.points) === String(x.marks[c.key]));
          return `<tr><td><b>${esc(c.name)}</b></td><td>${lv >= 0 ? `<span class="pill ok">${esc(x.rubric.levels[lv].label)}</span> ${esc((c.desc || [])[lv] || '')}` : '—'}</td></tr>`; }).join('')}</tbody></table></div>
        ${x.note ? `<div class="hint">📝 ${esc(x.note)}</div>` : ''}</div>`).join('') || '<div class="empty">لا توجد تقييمات بسلالم التقدير بعد.</div>';
  }

  paint();
})();
