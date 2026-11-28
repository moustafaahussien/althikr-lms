/* =====================================================================
   سجل السلوك والمواظبة (sql/51)
   تسجيل ملاحظات إيجابية/سلبية بقوالب جاهزة قابلة للتعديل والإضافة والحذف
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, hijri } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('behavior', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const DEG = { 1: 'الدرجة الأولى', 2: 'الدرجة الثانية', 3: 'الدرجة الثالثة', 4: 'الدرجة الرابعة', 5: 'الدرجة الخامسة' };
  const TODAY = LMS.ymd(new Date());
  const dshort = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'short' });
  let T = { manager: false, items: [] }, GROUPS = [], TAB = '';

  async function loadTemplates() { T = await call('bh_templates_list'); }
  try { [GROUPS] = await Promise.all([call('att_my_groups'), loadTemplates()]); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }

  const tabs = [['add', '✍️ تسجيل ملاحظة'], ['feed', '📋 السجل'], ['student', '🧑‍🎓 ملف طالب'], ['stats', '📊 إحصاءات']];
  if (T.manager) tabs.splice(3, 0, ['ref', '📨 الإحالات']);
  tabs.push(['tpl', '🗂️ القوالب']);
  TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'add';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; go(b.dataset.t); };
  function go(t, arg) { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); view.onclick = null;
    ({ add: paintAdd, feed: paintFeed, student: paintStudent, ref: paintRef, stats: paintStats, tpl: paintTpl })[t](arg); }

  const badge = (n) => n.kind === 'positive'
    ? `<span class="bh-b pos">⭐ إيجابية${n.points ? ' +' + n.points : ''}</span>`
    : `<span class="bh-b neg">⚠️ ${DEG[n.degree] || 'سلبية'}</span>`;
  const noteRow = (n, withStudent, extra = '') => `<div class="glass bh-note ${n.kind}">
      <div>${badge(n)} <b>${esc(n.text)}</b> <span class="hint">· ${esc(n.category)}</span>
        ${withStudent ? `<div><a href="#" data-stu="${n.student_id}"><b>${esc(n.student)}</b></a> <span class="hint">${esc(n.class || '')}</span></div>` : ''}
        ${n.details ? `<div class="pre">${esc(n.details)}</div>` : ''}
        <div class="hint">${dshort(n.date)} (${esc(hijri(n.date))})${n.period ? ' — الحصة ' + n.period : ''} — ${esc(n.by || '')}
          · ${n.to_parent ? '👪 تظهر لولي الأمر' : '🔒 داخلية'}${n.refer ? ` · 📨 إحالة ${n.ref_status === 'closed' ? 'مغلقة ✓' : 'مفتوحة'}` : ''}</div>
        ${n.ref_action ? `<div class="hint">الإجراء: ${esc(n.ref_action)} — ${esc(n.ref_by || '')}</div>` : ''}</div>
      ${extra || n.mine || T.manager ? `<div class="acts">${extra}${n.mine || T.manager ? `<button class="btn sm ghost" data-par="${n.id}|${n.to_parent ? 0 : 1}" title="إظهار/إخفاء لولي الأمر">${n.to_parent ? '🔒 إخفاء عن ولي الأمر' : '👪 إظهار لولي الأمر'}</button>
        <button class="btn sm ghost danger" data-del="${n.id}">🗑</button>` : ''}</div>` : ''}</div>`;
  async function noteActions(e, after) {
    const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); return go('student', s.dataset.stu); }
    const p = e.target.closest('[data-par]'); if (p) { const [id, on] = p.dataset.par.split('|');
      try { await call('bh_note_parent', { p_id: +id, p_on: on === '1' }); toast(on === '1' ? 'ستظهر لولي الأمر' : 'أصبحت داخلية'); after(); } catch (er) { toast(errMsg(er), 'err'); } return; }
    const d = e.target.closest('[data-del]'); if (d) { if (!await confirmBox('حذف هذه الملاحظة نهائيًا؟', 'حذف')) return;
      try { await call('bh_note_delete', { p_id: +d.dataset.del }); toast('حُذفت'); after(); } catch (er) { toast(errMsg(er), 'err'); } }
  }

  // ============================ تسجيل ملاحظة ============================
  let SEL = new Set(), ROSTER = [], PICK = null, G = '', C = '';
  function paintAdd() {
    const gOpts = GROUPS.map((g) => `<option value="${g.grade_id}" ${String(g.grade_id) === G ? 'selected' : ''}>${esc(g.label)}</option>`).join('');
    view.innerHTML = `<div class="bh-grid">
      <div class="glass card"><h3 style="margin-top:0">1) اختر الطلاب</h3>
        <div class="form-grid"><label class="f">الصف<select id="g"><option value="">— اختر —</option>${gOpts}</select></label>
          <label class="f">الفصل<select id="c"><option value="">كل الفصول</option></select></label></div>
        <div class="toolbar" style="margin:8px 0"><input id="q" type="search" class="grow" placeholder="ابحث باسم الطالب…"><button class="btn sm" id="all">تحديد الكل</button><button class="btn sm" id="none">إلغاء</button></div>
        <div id="roster" class="bh-roster"><div class="hint">اختر الصف لعرض الطلاب.</div></div></div>
      <div class="glass card"><h3 style="margin-top:0">2) اختر الملاحظة</h3>
        <div class="seg"><button data-k="positive" class="on">⭐ إيجابية</button><button data-k="negative">⚠️ سلبية</button></div>
        <div id="chips" class="bh-chips"></div>
        <div id="form"></div></div></div>`;
    if (!GROUPS.length) $('#roster').innerHTML = '<div class="notice">لا توجد فصول مسندة لك بعد.</div>';
    let KIND = 'positive';
    const fillClasses = () => { const g = GROUPS.find((x) => String(x.grade_id) === G);
      $('#c').innerHTML = '<option value="">كل الفصول</option>' + (g ? g.classes.map((c) => `<option value="${c.id}" ${String(c.id) === C ? 'selected' : ''}>${esc(c.name)} (${c.n})</option>`).join('') : ''); };
    const loadRoster = async () => { SEL = new Set(); if (!G) { $('#roster').innerHTML = '<div class="hint">اختر الصف لعرض الطلاب.</div>'; return paintSel(); }
      $('#roster').innerHTML = '<div class="hint">جارٍ التحميل…</div>';
      try { ROSTER = await call('bh_roster', { p_grade: +G, p_class: C ? +C : null }); } catch (e) { $('#roster').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      $('#roster').innerHTML = ROSTER.length ? ROSTER.map((s) => `<label class="bh-st" data-n="${esc(LMS.norm(s.name))}"><input type="checkbox" data-s="${s.id}">
          <span class="grow">${esc(s.name)} <small class="hint">${esc(s.class || '')}</small></span>
          ${s.points ? `<span class="bh-b pos" title="نقاط التميز">⭐ ${s.points}</span>` : ''}${s.neg ? `<span class="bh-b neg" title="ملاحظات سلبية آخر 30 يومًا">⚠️ ${s.neg}</span>` : ''}</label>`).join('')
        : '<div class="hint">لا يوجد طلاب.</div>';
      paintSel(); };
    const paintSel = () => { const n = SEL.size; const b = $('#save'); if (b) { b.textContent = n ? `حفظ الملاحظة لـ ${n} ${n === 1 ? 'طالب' : 'طلاب'}` : 'اختر الطلاب أولًا'; b.disabled = !n; } };
    $('#g').onchange = (e) => { G = e.target.value; C = ''; fillClasses(); loadRoster(); };
    $('#c').onchange = (e) => { C = e.target.value; loadRoster(); };
    $('#q').oninput = (e) => { const v = LMS.norm(e.target.value); $$('#roster .bh-st').forEach((l) => { l.style.display = LMS.has(l.dataset.n, v) ? '' : 'none'; }); };
    $('#all').onclick = () => { $$('#roster [data-s]').forEach((c) => { if (c.closest('.bh-st').style.display !== 'none') { c.checked = true; SEL.add(c.dataset.s); } }); paintSel(); };
    $('#none').onclick = () => { $$('#roster [data-s]').forEach((c) => { c.checked = false; }); SEL.clear(); paintSel(); };
    $('#roster').onchange = (e) => { const c = e.target.closest('[data-s]'); if (!c) return; c.checked ? SEL.add(c.dataset.s) : SEL.delete(c.dataset.s); paintSel(); };

    const chips = () => {
      const L = T.items.filter((t) => t.kind === KIND), cats = [...new Set(L.map((t) => t.category))];
      $('#chips').innerHTML = cats.map((c) => `<div class="bh-cat">${esc(c)}</div>` + L.filter((t) => t.category === c).map((t) =>
        `<button class="bh-chip ${KIND} ${PICK && PICK.id === t.id ? 'on' : ''}" data-tp="${t.id}">${esc(t.text)}${t.kind === 'positive' && t.points ? ` <small>+${t.points}</small>` : ''}${t.kind === 'negative' ? ` <small>د${t.degree}</small>` : ''}${t.school ? '' : ' <small title="قالبك الشخصي">👤</small>'}</button>`).join('')).join('')
        + `<button class="bh-chip ghost" data-tp="new">✏️ ملاحظة مكتوبة (بدون قالب)</button>`;
    };
    const form = () => {
      const p = PICK || { kind: KIND, text: '', category: 'عام', points: KIND === 'positive' ? 1 : 0, degree: 1, to_parent: KIND === 'positive', refer: false };
      $('#form').innerHTML = `<hr><label class="f">نص الملاحظة (يمكنك تعديله لهذه المرة)<input id="tx" value="${esc(p.text)}" placeholder="اكتب الملاحظة…"></label>
        <div class="form-grid">
          ${p.kind === 'positive' ? `<label class="f">نقاط التميز<input id="pt" type="number" min="0" max="20" value="${p.points || 0}"></label>`
            : `<label class="f">درجة المخالفة<select id="dg">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${+p.degree === d ? 'selected' : ''}>${DEG[d]}</option>`).join('')}</select></label>`}
          <label class="f">التاريخ<input id="dt" type="date" max="${TODAY}" value="${TODAY}"></label>
          <label class="f">الحصة (اختياري)<select id="pd"><option value="">—</option>${[1, 2, 3, 4, 5, 6, 7, 8].map((x) => `<option>${x}</option>`).join('')}</select></label></div>
        <label class="f">تفاصيل إضافية (اختياري)<textarea id="dl" rows="2" placeholder="ماذا حدث بالتحديد؟"></textarea></label>
        <label class="chk"><input type="checkbox" id="tp" ${p.to_parent ? 'checked' : ''}> 👪 تظهر لولي الأمر في بوابته</label>
        ${p.kind === 'negative' ? `<label class="chk"><input type="checkbox" id="rf" ${p.refer ? 'checked' : ''}> 📨 إحالة للموجّه الطلابي (تصله رسالة مع وكيل المرحلة)</label>` : ''}
        <button class="btn primary" id="save" style="margin-top:10px;width:100%" disabled>اختر الطلاب أولًا</button>`;
      paintSel();
      $('#save').onclick = async () => {
        const b = $('#save'); b.disabled = true;
        try {
          const r = await call('bh_note_add', { p: { students: [...SEL], template_id: PICK ? PICK.id : null, kind: p.kind, category: p.category, text: $('#tx').value,
            points: p.kind === 'positive' ? $('#pt').value : 0, degree: p.kind === 'negative' ? $('#dg').value : null, date: $('#dt').value, period: $('#pd').value,
            details: $('#dl').value, to_parent: $('#tp').checked, refer: p.kind === 'negative' && $('#rf').checked } });
          toast(`سُجّلت الملاحظة لـ ${r.count} ${r.count === 1 ? 'طالب' : 'طلاب'} ✓`);
          $('#dl').value = ''; $('#none').click(); loadRoster();
        } catch (e) { toast(errMsg(e), 'err'); b.disabled = false; }
      };
    };
    $$('.seg button', view).forEach((b) => b.onclick = () => { KIND = b.dataset.k; PICK = null; $$('.seg button', view).forEach((x) => x.classList.toggle('on', x === b)); chips(); form(); });
    $('#chips').onclick = (e) => { const b = e.target.closest('[data-tp]'); if (!b) return;
      PICK = b.dataset.tp === 'new' ? null : T.items.find((t) => t.id === +b.dataset.tp); chips(); form(); if (!PICK) $('#tx').focus(); };
    PICK = null; chips(); form();
    if (G) { fillClasses(); loadRoster(); }
  }

  // ============================ السجل ============================
  const F = { scope: 'mine', kind: '', from: LMS.ymd(new Date(Date.now() - 30 * 864e5)), to: TODAY };
  async function paintFeed() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap">
        <select id="fs"><option value="mine">ملاحظاتي</option><option value="all" ${F.scope === 'all' ? 'selected' : ''}>كل ملاحظات طلابي</option></select>
        <select id="fk"><option value="">الكل</option><option value="positive" ${F.kind === 'positive' ? 'selected' : ''}>⭐ إيجابية</option><option value="negative" ${F.kind === 'negative' ? 'selected' : ''}>⚠️ سلبية</option></select>
        <label>من <input type="date" id="ff" value="${F.from}"></label><label>إلى <input type="date" id="ft" value="${F.to}"></label>
        <input id="fq" type="search" class="grow" placeholder="ابحث باسم الطالب أو الملاحظة…"></div><div id="list"><div class="empty">جارٍ التحميل…</div></div>`;
    const load = async () => {
      let L; try { L = await call('bh_feed', { p_scope: F.scope, p_kind: F.kind || null, p_from: F.from, p_to: F.to, p_class: null }); } catch (e) { $('#list').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      $('#list').innerHTML = L.length ? `<p class="hint">${L.length} ملاحظة — ⭐ ${L.filter((n) => n.kind === 'positive').length} · ⚠️ ${L.filter((n) => n.kind === 'negative').length}</p>` + L.map((n) => `<div data-q="${esc(LMS.norm(n.student + ' ' + n.text))}">${noteRow(n, true)}</div>`).join('') : '<div class="empty">لا توجد ملاحظات في هذه الفترة.</div>';
    };
    ['fs', 'fk', 'ff', 'ft'].forEach((id) => { $('#' + id).onchange = (e) => { F[{ fs: 'scope', fk: 'kind', ff: 'from', ft: 'to' }[id]] = e.target.value; load(); }; });
    $('#fq').oninput = (e) => { const v = LMS.norm(e.target.value); $$('#list [data-q]').forEach((r) => { r.style.display = LMS.has(r.dataset.q, v) ? '' : 'none'; }); };
    view.onclick = (e) => noteActions(e, load);
    load();
  }

  // ============================ ملف طالب ============================
  async function paintStudent(sid) {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="sq" class="grow" type="search" placeholder="اكتب اسم الطالب أو رقمه (حرفان على الأقل)…" autofocus></div><div id="sr"></div><div id="sv"></div>`;
    let tm; $('#sq').oninput = (e) => { clearTimeout(tm); const q = e.target.value.trim(); if (q.length < 2) { $('#sr').innerHTML = ''; return; }
      tm = setTimeout(async () => { try { const L = await call('pf_find', { p_q: q });
        $('#sr').innerHTML = L.length ? `<div class="glass card">${L.map((s) => `<a href="#" class="bh-st" data-stu="${s.id}"><b>${esc(s.name)}</b> <span class="hint">${esc(s.class || '')}</span></a>`).join('')}</div>` : '<div class="hint">لا نتائج ضمن طلابك.</div>';
      } catch (er) { toast(errMsg(er), 'err'); } }, 300); };
    const show = async (id) => {
      $('#sr').innerHTML = ''; $('#sv').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
      let d; try { d = await call('bh_student', { p_student: id }); } catch (e) { $('#sv').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      $('#sv').innerHTML = `<div class="glass card"><h2 style="margin:0">🧑‍🎓 ${esc(d.student.name)}</h2><div class="hint">${esc(d.student.class || '')} — رقم ${esc(d.student.no || '')}</div>
          <div class="kpi4" style="margin-top:10px"><div class="card-box"><b style="color:#b8860b">⭐ ${d.points}</b><div class="hint">نقاط التميز</div></div>
            <div class="card-box"><b style="color:var(--brand)">${d.pos}</b><div class="hint">ملاحظة إيجابية</div></div>
            <div class="card-box"><b style="color:#c0392b">${d.neg}</b><div class="hint">ملاحظة سلبية</div></div>
            <div class="card-box"><button class="btn sm primary" id="addFor">✍️ ملاحظة لهذا الطالب</button></div></div></div>
        ${d.notes.length ? d.notes.map((n) => noteRow(n, false)).join('') : '<div class="empty">لا توجد ملاحظات لهذا الطالب.</div>'}`;
      $('#addFor').onclick = () => quickAdd(d.student, () => show(id));
      view.onclick = (e) => { const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); return show(s.dataset.stu); } noteActions(e, () => show(id)); };
    };
    view.onclick = (e) => { const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); show(s.dataset.stu); } };
    if (sid) show(sid);
  }
  function quickAdd(stu, after) {
    const opts = (k) => T.items.filter((t) => t.kind === k).map((t) => `<option value="${t.id}">${esc(t.category)} — ${esc(t.text)}</option>`).join('');
    modal({ title: `ملاحظة لـ ${stu.name}`, wide: true, body: `<label class="f">اختر من القوالب<select id="qt"><option value="">— ملاحظة مكتوبة —</option>
        <optgroup label="⭐ إيجابية">${opts('positive')}</optgroup><optgroup label="⚠️ سلبية">${opts('negative')}</optgroup></select></label>
      <div class="form-grid"><label class="f">النوع<select id="qk"><option value="positive">⭐ إيجابية</option><option value="negative">⚠️ سلبية</option></select></label>
        <label class="f">النقاط / الدرجة<input id="qv" type="number" min="0" max="20" value="1"></label></div>
      <label class="f">النص<input id="qx"></label><label class="f">تفاصيل (اختياري)<textarea id="qd" rows="2"></textarea></label>
      <label class="chk"><input type="checkbox" id="qp" checked> 👪 تظهر لولي الأمر</label><label class="chk"><input type="checkbox" id="qr"> 📨 إحالة للموجّه الطلابي (للسلبية)</label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const t = T.items.find((x) => x.id === +$('#qt', w).value), k = $('#qk', w).value;
        await call('bh_note_add', { p: { students: [stu.id], template_id: t ? t.id : null, kind: k, category: t ? t.category : 'عام', text: $('#qx', w).value,
          points: k === 'positive' ? $('#qv', w).value : 0, degree: k === 'negative' ? $('#qv', w).value : null, details: $('#qd', w).value,
          to_parent: $('#qp', w).checked, refer: k === 'negative' && $('#qr', w).checked } });
        toast('سُجّلت ✓'); after(); return true; } }] });
    setTimeout(() => { const w = document.querySelector('.modal-wrap:last-child'); if (!w) return;
      $('#qt', w).onchange = () => { const t = T.items.find((x) => x.id === +$('#qt', w).value); if (!t) return;
        $('#qk', w).value = t.kind; $('#qx', w).value = t.text; $('#qv', w).value = t.kind === 'positive' ? t.points : t.degree; $('#qp', w).checked = t.to_parent; $('#qr', w).checked = t.refer; };
      $('#qk', w).onchange = () => { $('#qv', w).max = $('#qk', w).value === 'negative' ? 5 : 20; }; }, 50);
  }

  // ============================ الإحالات ============================
  let RS = 'open';
  async function paintRef() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><div class="seg"><button data-r="open" class="${RS === 'open' ? 'on' : ''}">مفتوحة</button><button data-r="closed" class="${RS === 'closed' ? 'on' : ''}">مغلقة</button><button data-r="" class="${RS === '' ? 'on' : ''}">الكل</button></div></div><div id="rl"><div class="empty">جارٍ التحميل…</div></div>`;
    let L = []; try { L = await call('bh_referrals', { p_status: RS || null }); } catch (e) { $('#rl').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    $('#rl').innerHTML = L.length ? L.map((n) => noteRow(n, true, `<button class="btn sm primary" data-act="${n.id}">📝 ${n.ref_status === 'closed' ? 'تعديل الإجراء' : 'تسجيل الإجراء'}</button>`)).join('') : '<div class="empty">✅ لا توجد إحالات.</div>';
    view.onclick = (e) => {
      const r = e.target.closest('[data-r]'); if (r) { RS = r.dataset.r; return paintRef(); }
      const a = e.target.closest('[data-act]'); if (a) { const n = L.find((x) => x.id === +a.dataset.act);
        return modal({ title: `إجراء الإحالة — ${n.student}`, body: `<p><b>${esc(n.text)}</b> (${DEG[n.degree]})</p>${n.details ? `<div class="pre">${esc(n.details)}</div>` : ''}
            <label class="f">الإجراء المتخذ (يصل للمعلم صاحب الإحالة)<textarea id="ac" rows="4" placeholder="مثال: جلسة إرشادية مع الطالب، تواصل مع ولي الأمر، تعهد خطي…">${esc(n.ref_action || '')}</textarea></label>`,
          actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ — قيد المتابعة', onClick: async (w) => { await call('bh_referral_set', { p_id: n.id, p_action: $('#ac', w).value, p_close: false }); toast('حُفظ'); paintRef(); return true; } },
            { label: 'حفظ وإغلاق الإحالة', cls: 'primary', onClick: async (w) => { await call('bh_referral_set', { p_id: n.id, p_action: $('#ac', w).value, p_close: true }); toast('أُغلقت الإحالة ✓'); paintRef(); return true; } }] }); }
      noteActions(e, paintRef);
    };
  }

  // ============================ إحصاءات ============================
  async function paintStats() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let d; try { d = await call('bh_stats', {}); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const tbl = (rows, cols) => rows.length ? `<div class="table-wrap no-tools"><table><tbody>${rows.map(cols).join('')}</tbody></table></div>` : '<div class="hint">لا توجد بيانات.</div>';
    view.innerHTML = `<p class="hint">آخر 30 يومًا — ضمن الطلاب الذين تراهم.</p>
      <div class="kpi4"><div class="card-box glass"><b style="color:var(--brand)">${d.pos}</b><div class="hint">ملاحظة إيجابية</div></div>
        <div class="card-box glass"><b style="color:#c0392b">${d.neg}</b><div class="hint">ملاحظة سلبية</div></div>
        <div class="card-box glass"><b style="color:#b9691b">${d.open_ref}</b><div class="hint">إحالة مفتوحة</div></div>
        <div class="card-box glass"><b>${d.pos + d.neg ? Math.round(d.pos / (d.pos + d.neg) * 100) + '%' : '—'}</b><div class="hint">نسبة الإيجابي</div></div></div>
      <div class="bh-grid" style="margin-top:14px">
        <div class="glass card"><h3 style="margin-top:0">🏆 الأعلى نقاط تميز</h3>${tbl(d.top_points, (s, i) => `<tr><td>${i + 1}</td><td><a href="#" data-stu="${s.id}">${esc(s.name)}</a></td><td class="hint">${esc(s.class || '')}</td><td><b>⭐ ${s.points}</b></td></tr>`)}</div>
        <div class="glass card"><h3 style="margin-top:0">⚠️ الأكثر ملاحظات سلبية</h3>${tbl(d.top_neg, (s) => `<tr><td><a href="#" data-stu="${s.id}">${esc(s.name)}</a></td><td class="hint">${esc(s.class || '')}</td><td><b>${s.n}</b></td><td class="hint">أعلى درجة: ${s.max_degree}</td></tr>`)}</div>
        <div class="glass card" style="grid-column:1/-1"><h3 style="margin-top:0">📌 أكثر الملاحظات تكرارًا</h3>${tbl(d.top_texts, (t) => `<tr><td>${t.kind === 'positive' ? '⭐' : '⚠️'} ${esc(t.text)}</td><td><b>${t.n}</b></td></tr>`)}</div></div>`;
    view.onclick = (e) => { const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); go('student', s.dataset.stu); } };
  }

  // ============================ القوالب ============================
  async function paintTpl() {
    const row = (t) => `<tr><td>${t.kind === 'positive' ? '⭐' : '⚠️'}</td><td><b>${esc(t.text)}</b></td><td>${esc(t.category)}</td>
        <td>${t.kind === 'positive' ? '+' + t.points : DEG[t.degree]}</td><td>${t.to_parent ? '👪' : '🔒'}${t.refer ? ' 📨' : ''}</td><td class="hint">${t.uses}</td>
        <td style="white-space:nowrap">${!t.school || T.manager ? `<button class="btn sm" data-ed="${t.id}">✏️</button> <button class="btn sm danger" data-dl="${t.id}">🗑</button>` : ''}</td></tr>`;
    const sec = (title, L, school) => `<div class="glass card" style="margin-bottom:14px"><div class="toolbar" style="margin-bottom:8px"><h3 style="margin:0" class="grow">${title} (${L.length})</h3>
        ${!school || T.manager ? `<button class="btn primary sm" data-new="${school ? 1 : 0}">＋ قالب جديد</button>` : ''}</div>
        ${L.length ? `<div class="table-wrap no-tools"><table><thead><tr><th></th><th>النص</th><th>التصنيف</th><th>النقاط / الدرجة</th><th>ولي الأمر/إحالة</th><th>استُخدم</th><th></th></tr></thead>
        <tbody>${L.map(row).join('')}</tbody></table></div>` : '<div class="hint">لا توجد قوالب.</div>'}</div>`;
    view.innerHTML = `<p class="hint">القوالب تظهر كأزرار جاهزة عند تسجيل الملاحظة. <b>قوالب المدرسة</b> يراها الجميع ويعدّلها مدير النظام والقيادات ومديرو المراحل والموجّهون الطلابيون،
        و<b>قوالبي</b> خاصة بك تضيفها وتعدّلها وتحذفها بنفسك. 👪 = تظهر لولي الأمر افتراضيًا، 📨 = إحالة للموجّه افتراضيًا. حذف قالب مستخدم لا يحذف الملاحظات المسجّلة به.</p>
      ${sec('🏫 قوالب المدرسة', T.items.filter((t) => t.school), true)}${sec('👤 قوالبي الشخصية', T.items.filter((t) => !t.school), false)}`;
    view.onclick = async (e) => {
      const n = e.target.closest('[data-new]'); if (n) return tplForm({ school: n.dataset.new === '1', kind: 'positive', points: 1, degree: 1, to_parent: true });
      const ed = e.target.closest('[data-ed]'); if (ed) return tplForm(T.items.find((t) => t.id === +ed.dataset.ed));
      const dl = e.target.closest('[data-dl]'); if (dl) { const t = T.items.find((x) => x.id === +dl.dataset.dl);
        if (!await confirmBox(`حذف القالب «${t.text}»؟${t.uses ? ` (استُخدم ${t.uses} مرة — ستبقى الملاحظات المسجّلة به)` : ''}`, 'حذف')) return;
        try { await call('bh_template_delete', { p_id: t.id }); await loadTemplates(); toast('حُذف'); paintTpl(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function tplForm(t) {
    const cats = [...new Set(T.items.map((x) => x.category))];
    modal({ title: t.id ? 'تعديل قالب' : (t.school ? 'قالب جديد للمدرسة' : 'قالب شخصي جديد'), body: `
      <div class="form-grid"><label class="f">النوع<select id="k"><option value="positive" ${t.kind === 'positive' ? 'selected' : ''}>⭐ إيجابية</option><option value="negative" ${t.kind === 'negative' ? 'selected' : ''}>⚠️ سلبية</option></select></label>
        <label class="f">التصنيف<input id="c" list="cats" value="${esc(t.category || '')}" placeholder="مشاركة، انضباط، تعاون…"><datalist id="cats">${cats.map((c) => `<option>${esc(c)}</option>`).join('')}</datalist></label></div>
      <label class="f">نص الملاحظة *<input id="x" value="${esc(t.text || '')}"></label>
      <div class="form-grid"><label class="f" id="pW">نقاط التميز<input id="p" type="number" min="0" max="20" value="${t.points ?? 1}"></label>
        <label class="f" id="dW">درجة المخالفة<select id="d">${[1, 2, 3, 4, 5].map((d) => `<option value="${d}" ${+t.degree === d ? 'selected' : ''}>${DEG[d]}</option>`).join('')}</select></label>
        <label class="f">الترتيب<input id="s" type="number" value="${t.sort ?? ''}" placeholder="تلقائي"></label></div>
      <label class="chk"><input type="checkbox" id="tp" ${t.to_parent ? 'checked' : ''}> 👪 تظهر لولي الأمر افتراضيًا</label>
      <label class="chk" id="rW"><input type="checkbox" id="rf" ${t.refer ? 'checked' : ''}> 📨 إحالة للموجّه الطلابي افتراضيًا</label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('bh_template_save', { p: { id: t.id || null, school: !!t.school, kind: $('#k', w).value, category: $('#c', w).value, text: $('#x', w).value,
          points: $('#p', w).value, degree: $('#d', w).value, sort: $('#s', w).value, to_parent: $('#tp', w).checked, refer: $('#rf', w).checked } });
        await loadTemplates(); toast('تم الحفظ'); paintTpl(); return true; } }] });
    setTimeout(() => { const w = document.querySelector('.modal-wrap:last-child'); if (!w) return;
      const sync = () => { const neg = $('#k', w).value === 'negative'; $('#pW', w).style.display = neg ? 'none' : ''; $('#dW', w).style.display = neg ? '' : 'none'; $('#rW', w).style.display = neg ? '' : 'none'; };
      $('#k', w).onchange = sync; sync(); }, 50);
  }

  go(TAB, new URLSearchParams(location.search).get('s'));
})();
