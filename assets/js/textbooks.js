/* =====================================================================
   الكتب المدرسية (sql/82) — الكتالوج والاحتياج، طلب الكتب، الاستلام، التوزيع على الطلاب والمعلمين، المخزون
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('textbooks', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME, LISTS = {};
  try { ME = await call('tb_me'); if (ME.mgr) LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  if (!ME.mgr && !ME.my_classes.length) { $('#tabs').remove(); view.innerHTML = '<div class="notice">🔒 هذه الوحدة لمسؤول الكتب المدرسية، ولرائد الفصل لتوزيع كتب فصله.</div>'; return; }
  const KIND = { student: '📘 كتاب الطالب', activity: '📗 كتاب النشاط', teacher: '📙 دليل المعلم', other: '📄 أخرى' };
  const TERM = { 0: 'كل الفصول', 1: 'الفصل الأول', 2: 'الفصل الثاني', 3: 'الفصل الثالث' };
  let T = +(sessionStorage.getItem('tb_term') || 1);
  const tabs = ME.mgr ? [['stock', '📚 الكتب والمخزون'], ['orders', '📝 طلب الكتب'], ['receive', '📥 الاستلام'], ['dist', '🎒 التوزيع'], ['progress', '📊 تقدّم التوزيع']].concat(ME.settings ? [['settings', '⚙️ الإعدادات']] : []) : [['dist', '🎒 توزيع كتب فصلي']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; view.onchange = null; return ({ stock: stockView, orders: ordersView, receive: receiveView, dist: distView, progress: progressView, settings: settingsView })[TAB](); };
  const termSel = () => `<select id="tm">${[1, 2, 3].map((k) => `<option value="${k}" ${k === T ? 'selected' : ''}>${TERM[k]}</option>`).join('')}</select>`;
  const bindTerm = (fn) => { $('#tm').onchange = (e) => { T = +e.target.value; sessionStorage.setItem('tb_term', T); fn(); }; };

  /* ---------- الكتب والمخزون ---------- */
  async function stockView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${termSel()}<select id="gf"><option value="">كل الصفوف</option>${(LISTS.grades || []).map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select>
      <label class="chk" style="margin:0"><input type="checkbox" id="sh"> النواقص فقط</label><span style="flex:1"></span><button class="btn sm primary" id="nt">＋ كتاب</button><button class="btn sm" id="bk">📋 إضافة جماعية</button></div><div id="tl"></div>`;
    let L = [];
    const draw = () => { const g = $('#gf').value, sh = $('#sh').checked;
      const R = L.filter((t) => t.active && (!g || String(t.grade_id) === g) && (!sh || t.stock + t.given < t.need));
      $('#tl').innerHTML = `<div class="glass" style="padding:6px;overflow:auto"><table class="t"><thead><tr><th>الكتاب</th><th>الصف</th><th>الفصل</th><th title="عدد الطلاب (أو المعلمين) × النسخ">الاحتياج</th><th>المستلم من المورد</th><th>وُزّع</th><th>في المخزن</th><th>تحت الطلب</th><th>العجز</th><th></th></tr></thead><tbody>
        ${R.map((t) => { const short = Math.max(0, t.need - t.given - t.stock - t.ordered); return `<tr><td><button class="nm-link" data-mv="${t.id}">${esc(t.title)}</button><div class="hint">${esc(KIND[t.kind])}${t.subject ? ' · ' + esc(t.subject) : ''}</div></td><td>${esc(t.grade || '')}</td><td>${esc(TERM[t.term])}</td>
          <td>${t.need}</td><td>${t.received}</td><td>${t.given}</td><td><b>${t.stock}</b></td><td>${t.ordered || '—'}</td><td>${short ? `<span class="pill bad">${short}</span>` : '<span class="pill ok">✓</span>'}</td>
          <td style="white-space:nowrap"><button class="btn sm" data-adj="${t.id}" title="تسوية / تالف">±</button><button class="btn sm" data-mv="${t.id}" title="الحركات">🕘</button><button class="btn sm" data-ed="${t.id}">✏️</button></td></tr>`; }).join('') || '<tr><td colspan="10" class="hint">لا كتب. أضف كتب كل صف (كتاب الطالب، النشاط، دليل المعلم).</td></tr>'}</tbody></table></div>
        <p class="hint">العجز = الاحتياج − الموزَّع − المخزون − المطلوب من المورد. الاحتياج يُحسب تلقائيًا من عدد طلاب الصف (ولدليل المعلم: معلمو الصف).</p>`; };
    const load = async () => { try { L = await call('tb_titles_list', { p_term: T }); } catch (e) { $('#tl').innerHTML = esc(errMsg(e)); return; } draw(); };
    bindTerm(load); $('#gf').onchange = draw; $('#sh').onchange = draw;
    $('#nt').onclick = () => titleForm({ term: T, kind: 'student', per_student: 1, active: true }, load);
    $('#bk').onclick = () => bulkForm(load);
    view.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; const t = L.find((x) => x.id === +(b.dataset.adj || b.dataset.mv || b.dataset.ed)); if (!t) return;
      if (b.dataset.ed) titleForm(t, load);
      if (b.dataset.adj) modal({ title: '± ' + t.title, body: `<p>في المخزن: <b>${t.stock}</b></p><label class="f">النوع<select id="k"><option value="damaged">تالف / مفقود (−)</option><option value="adjust">تسوية جرد (+ أو −)</option><option value="receive">استلام خارج الطلبات (+)</option></select></label>
          <label class="f">الكمية<input type="number" id="q"></label><label class="f">السبب<input id="n"></label>`, actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
          await call('tb_adjust', { p_title: t.id, p_delta: +$('#q', w).value, p_kind: $('#k', w).value, p_note: $('#n', w).value }); toast('تم ✓'); load(); return true; } }] });
      if (b.dataset.mv) { const M = await call('tb_moves_list', { p_title: t.id }); const KM = { receive: '📥 استلام', distribute: '🎒 توزيع', return: '↩️ إرجاع', damaged: '⚠️ تالف/مفقود', adjust: '± تسوية' };
        const short = Math.max(0, t.need - t.given - t.stock - t.ordered), kv = (k, v) => `<div class="kv"><div class="k">${k}</div><div class="v">${v ?? '—'}</div></div>`;
        modal({ title: '📘 ' + t.title, wide: true, body: `<div class="pg-hero"><span class="ic">📘</span><div style="flex:1"><h2>${esc(t.title)}</h2><span class="pill">${esc(KIND[t.kind])}</span> ${short ? `<span class="pill bad">عجز ${short}</span>` : '<span class="pill ok">✓ مكتمل</span>'}</div></div>
          <div class="pg-grid">${kv('📚 المادة', esc(t.subject || '—'))}${kv('🎓 الصف', esc(t.grade || '—'))}${kv('🗓️ الفصل الدراسي', esc(TERM[t.term] || '—'))}${kv('🧮 الاحتياج', t.need)}
            ${kv('📥 المستلم من المورد', t.received)}${kv('🎒 وُزّع', t.given)}${kv('📦 في المخزن', `<b>${t.stock}</b>`)}${kv('🛒 تحت الطلب', t.ordered || 0)}</div>
          <div class="pg-sec"><h3>🕘 سجل الحركات (${M.length})</h3><table class="t"><tbody>${M.map((m) => `<tr><td class="hint">${esc(new Date(m.at).toLocaleString('ar-SA', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</td><td>${KM[m.kind] || m.kind}</td>
          <td><b dir="ltr">${m.delta > 0 ? '+' : ''}${m.delta}</b></td><td>${esc(m.who || m.order || '')}${m.note ? ' · ' + esc(m.note) : ''}</td><td class="hint">${esc(m.by || '')}</td></tr>`).join('') || '<tr><td>لا حركات</td></tr>'}</tbody></table></div>`, actions: [{ label: 'إغلاق', value: null }] }); } };
    await load();
  }
  function titleForm(t, after) {
    modal({ title: t.id ? '✏️ ' + t.title : '＋ كتاب', body: `<label class="f">اسم الكتاب<input id="ti" value="${esc(t.title || '')}" placeholder="مثال: لغتي الجميلة — الجزء الأول"></label>
      <div class="form-grid"><label class="f">المادة<input id="sb" value="${esc(t.subject || '')}"></label><label class="f">الصف<select id="gr"><option value="">—</option>${(LISTS.grades || []).map((g) => `<option value="${g.id}" ${g.id === t.grade_id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
        <label class="f">الفصل الدراسي<select id="tr">${Object.entries(TERM).map(([k, l]) => `<option value="${k}" ${+k === t.term ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">النوع<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">نسخ لكل طالب<input type="number" id="ps" min="1" value="${t.per_student || 1}"></label></div>`,
      actions: [t.id ? { label: '🗑️', cls: 'danger', onClick: async () => { if (!await confirmBox('حذف الكتاب؟ (إن كانت له حركات سيُؤرشف)', 'حذف')) return false; await call('tb_title_save', { p: { id: t.id, delete: true } }); after(); return true; } } : null,
        { label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('tb_title_save', { p: { id: t.id || '', title: $('#ti', w).value, subject: $('#sb', w).value, grade_id: $('#gr', w).value, term: $('#tr', w).value, kind: $('#kd', w).value, per_student: $('#ps', w).value } });
        toast('تم ✓'); after(); return true; } }].filter(Boolean) });
  }
  function bulkForm(after) {
    modal({ title: '📋 إضافة كتب صف دفعة واحدة', wide: true, body: `<div class="form-grid"><label class="f">الصف<select id="gr">${(LISTS.grades || []).map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join('')}</select></label>
        <label class="f">الفصل الدراسي<select id="tr">${Object.entries(TERM).map(([k, l]) => `<option value="${k}" ${+k === T ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">النوع<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label></div>
      <label class="f">كتاب في كل سطر: «المادة | اسم الكتاب» (أو اسم الكتاب فقط)<textarea id="ls" rows="10" placeholder="لغتي | لغتي الجميلة&#10;رياضيات | الرياضيات&#10;علوم | العلوم"></textarea></label>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'إضافة', cls: 'primary', onClick: async (w) => {
        const rows = $('#ls', w).value.split('\n').map((x) => x.trim()).filter(Boolean).map((x) => { const p = x.split('|').map((y) => y.trim()); return { subject: p.length > 1 ? p[0] : '', title: p.length > 1 ? p[1] : p[0], grade_id: $('#gr', w).value, term: $('#tr', w).value, kind: $('#kd', w).value }; });
        const r = await call('tb_titles_bulk', { p_rows: rows }); toast(`أُضيف ${r.added} كتاب ✓`); after(); return true; } }] });
  }

  /* ---------- طلب الكتب ---------- */
  async function ordersView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">${termSel()}<button class="btn primary sm" id="no">＋ طلب كتب جديد</button></div><div id="ol"></div>`;
    let L = [];
    const OST = { draft: ['📝 مسودة', ''], sent: ['📤 أُرسل للمورد', 'gold'], partial: ['📥 استلام جزئي', 'gold'], received: ['✅ اكتمل الاستلام', 'ok'], closed: ['مغلق', ''] };
    const load = async () => { try { L = await call('tb_orders_list'); } catch (e) { $('#ol').innerHTML = esc(errMsg(e)); return; }
      $('#ol').innerHTML = L.map((o) => `<div class="glass xc"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="nm-link" data-${o.status === 'draft' ? 'ed' : 'vw'}="${o.id}">${esc(o.label)}</button><span class="pill">${TERM[o.term]}</span><span class="pill ${OST[o.status][1]}">${OST[o.status][0]}</span><span style="flex:1"></span>
          <span>${o.lines.length} كتاب · ${o.qty} نسخة · استُلم ${o.received}</span></div><div class="hint">${o.supplier ? '🏪 ' + esc(o.supplier) + ' · ' : ''}${esc(o.by || '')} · ${esc(new Date(o.created_at).toLocaleDateString('ar-SA'))}${o.notes ? ' · ' + esc(o.notes) : ''}</div>
        <div class="acts">${o.status === 'draft' ? `<button class="btn sm primary" data-ed="${o.id}">✏️ تعديل وإرسال</button>` : `<button class="btn sm" data-vw="${o.id}">👁️ التفاصيل</button>`}${['sent', 'partial'].includes(o.status) ? `<button class="btn sm primary" data-rc="${o.id}">📥 تسجيل استلام</button>` : ''}</div></div>`).join('')
        || '<div class="empty">لا طلبات بعد. اضغط «＋ طلب كتب جديد» — تُقترح الكميات تلقائيًا من عدد الطلاب والمخزون.</div>'; };
    bindTerm(() => {}); $('#no').onclick = () => orderForm({ term: T, lines: [] }, load);
    view.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const o = L.find((x) => x.id === +(b.dataset.ed || b.dataset.vw || b.dataset.rc)); if (!o) return;
      if (b.dataset.ed) orderForm(o, load); if (b.dataset.rc) { go('receive'); setTimeout(() => { const s = $('#ro'); if (s) { s.value = o.id; s.onchange(); } }, 400); }
      if (b.dataset.vw) modal({ title: '🛒 ' + o.label, wide: true, body: `<div class="pg-grid">${[['الحالة', OST[o.status][0]], ['الفصل الدراسي', TERM[o.term]], ['المورد', o.supplier], ['أنشأه', o.by], ['التاريخ', new Date(o.created_at).toLocaleDateString('ar-SA')], ['عدد الكتب', o.lines.length], ['النسخ المطلوبة', o.qty], ['المستلم', o.received], ['ملاحظات', o.notes]].map(([k, v]) => `<div class="kv"><div class="k">${k}</div><div class="v">${esc(v ?? '—') || '—'}</div></div>`).join('')}</div><table class="t"><thead><tr><th>الكتاب</th><th>الصف</th><th>المطلوب</th><th>المستلم</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td>${esc(l.title)}<div class="hint">${esc(l.kind)}</div></td><td>${esc(l.grade || '')}</td><td>${l.qty}</td><td>${l.received}${l.received < l.qty ? ` <span class="pill bad">ناقص ${l.qty - l.received}</span>` : ' ✓'}</td></tr>`).join('')}</tbody></table>`, actions: [{ label: 'إغلاق', value: null }] }); };
    await load();
  }
  async function orderForm(o, after) {
    const term = o.term || T; let titles;
    try { titles = (await call('tb_titles_list', { p_term: term })).filter((t) => t.active); } catch (e) { toast(errMsg(e), 'err'); return; }
    const cur = Object.fromEntries((o.lines || []).map((l) => [l.title_id, l.qty]));
    const box = document.createElement('div');
    box.innerHTML = `<div class="form-grid"><label class="f">عنوان الطلب<input id="lb" value="${esc(o.label || 'طلب كتب ' + TERM[term])}"></label><label class="f">المورد / الجهة<input id="sp" value="${esc(o.supplier || '')}" placeholder="مثال: إدارة التعليم — مستودع الكتب"></label>
        <label class="f">نسبة احتياط %<input type="number" id="sv" value="5" min="0" max="50"></label></div><button class="btn sm" id="sg">✨ اقتراح الكميات تلقائيًا</button> <span class="hint">= الاحتياج + الاحتياط − المخزون − الموزَّع − تحت الطلب</span>
      <div style="max-height:50vh;overflow:auto;margin-top:6px"><table class="t"><thead><tr><th>الكتاب</th><th>الصف</th><th>الاحتياج</th><th>المخزون+الموزَّع</th><th>الكمية المطلوبة</th></tr></thead><tbody>
        ${titles.map((t) => `<tr><td>${esc(t.title)}<div class="hint">${esc(KIND[t.kind])}</div></td><td>${esc(t.grade || '')}</td><td>${t.need}</td><td>${t.stock + t.given}${t.ordered ? ` <span class="hint">(+${t.ordered} مطلوب)</span>` : ''}</td>
          <td><input type="number" min="0" data-q="${t.id}" value="${cur[t.id] ?? ''}" style="width:90px"></td></tr>`).join('') || '<tr><td colspan="5" class="hint">أضف الكتب أولًا من «📚 الكتب والمخزون».</td></tr>'}</tbody></table></div>
      <label class="f">ملاحظات<input id="nt" value="${esc(o.notes || '')}"></label>`;
    box.onclick = (e) => { if (e.target.id !== 'sg') return; const sv = (+$('#sv', box).value || 0) / 100;
      titles.forEach((t) => { const q = Math.max(0, Math.ceil(t.need * (1 + sv)) - t.stock - t.given - (t.ordered || 0)); $(`[data-q="${t.id}"]`, box).value = q || ''; }); };
    const save = async (w, send) => { const lines = $$('[data-q]', w).map((x) => ({ title_id: +x.dataset.q, qty: +x.value || 0 })).filter((x) => x.qty > 0);
      await call('tb_order_save', { p: { id: o.id || '', label: $('#lb', w).value, supplier: $('#sp', w).value, term, notes: $('#nt', w).value, lines, send } }); toast(send ? 'أُرسل الطلب ✓' : 'حُفظت المسودة ✓'); after(); return true; };
    modal({ title: o.id ? '✏️ ' + o.label : '＋ طلب كتب — ' + TERM[term], wide: true, body: box, actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ كمسودة', onClick: (w) => save(w, false) }, { label: '📤 حفظ وإرسال', cls: 'primary', onClick: (w) => save(w, true) }] });
  }

  /* ---------- الاستلام ---------- */
  async function receiveView() {
    let O = []; try { O = (await call('tb_orders_list')).filter((o) => ['sent', 'partial'].includes(o.status)); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">📥 تسجيل استلام كتب</h3>
      <label class="f">الطلب<select id="ro"><option value="">— اختر الطلب —</option>${O.map((o) => `<option value="${o.id}">${esc(o.label)} (استُلم ${o.received} من ${o.qty})</option>`).join('')}</select></label><div id="rl"></div>
      <p class="hint">لكتب وصلت بدون طلب مسبق استخدم زر «±» ← «استلام خارج الطلبات» في تبويب الكتب والمخزون.</p></div>`;
    $('#ro').onchange = () => { const o = O.find((x) => x.id === +$('#ro').value); if (!o) { $('#rl').innerHTML = ''; return; }
      $('#rl').innerHTML = `<table class="t"><thead><tr><th>الكتاب</th><th>الصف</th><th>المطلوب</th><th>المستلم سابقًا</th><th>المستلم الآن</th></tr></thead><tbody>${o.lines.map((l) => `<tr><td>${esc(l.title)}</td><td>${esc(l.grade || '')}</td><td>${l.qty}</td><td>${l.received}</td>
          <td><input type="number" min="0" data-r="${l.title_id}" value="${Math.max(0, l.qty - l.received) || ''}" style="width:90px"></td></tr>`).join('')}</tbody></table>
        <label class="f">ملاحظة (رقم محضر الاستلام، الحالة…)<input id="rn"></label><button class="btn primary" id="rs">📥 تسجيل الاستلام وإضافته للمخزون</button>`;
      $('#rs').onclick = async () => { const lines = Object.fromEntries($$('[data-r]').map((x) => [x.dataset.r, +x.value || 0]));
        try { const r = await call('tb_receive', { p_order: o.id, p_lines: lines, p_note: $('#rn').value }); toast(`استُلم ${r.received} نسخة ✓`); receiveView(); } catch (e) { toast(errMsg(e), 'err'); } }; };
  }

  /* ---------- التوزيع ---------- */
  let CLS = '';
  async function distView() {
    const classes = ME.mgr ? (LISTS.classes || []) : ME.my_classes;
    if (!classes.some((c) => String(c.id) === String(CLS))) CLS = classes[0] ? classes[0].id : '';
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">${termSel()}<select id="cs">${classes.map((c) => `<option value="${c.id}" ${String(c.id) === String(CLS) ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      ${ME.mgr ? '<button class="btn sm" id="tg">📙 أدلة المعلمين</button>' : ''}</div><div id="dg"></div>`;
    let S;
    const load = async () => { if (!CLS) { $('#dg').innerHTML = '<div class="empty">لا فصول.</div>'; return; }
      try { S = await call('tb_class_sheet', { p_class: +CLS, p_term: T }); } catch (e) { $('#dg').innerHTML = esc(errMsg(e)); return; }
      if (!S.titles.length) { $('#dg').innerHTML = '<div class="empty">لا كتب مسجلة لصف هذا الفصل في هذا الفصل الدراسي.</div>'; return; }
      const full = S.students.filter((s) => S.titles.every((t) => s.has.includes(t.id))).length;
      $('#dg').innerHTML = `<p>استلم كل كتبه: <b>${full}</b> من ${S.students.length} طالب</p><div class="glass" style="padding:6px;overflow:auto"><table class="t dg"><thead><tr><th>الطالب</th>
          ${S.titles.map((t) => `<th style="text-align:center;min-width:90px">${esc(t.subject || t.title)}<div class="hint" style="font-weight:400">${esc(t.title)}<br>المخزن: ${t.stock}</div><button class="btn sm" data-all="${t.id}">✓ للجميع</button></th>`).join('')}<th></th></tr></thead><tbody>
        ${S.students.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="hint">${esc(s.no || '')}</div></td>${S.titles.map((t) => `<td style="text-align:center"><input type="checkbox" data-s="${s.id}" data-t="${t.id}" ${s.has.includes(t.id) ? 'checked' : ''} style="width:20px;height:20px"></td>`).join('')}
          <td><button class="btn sm" data-row="${s.id}">✓ الكل</button></td></tr>`).join('')}</tbody></table></div>
        <p class="hint">علّم الكتاب عند تسليمه للطالب فيُخصم من المخزون. إلغاء العلامة يتراجع عن التسليم ويعيده للمخزون.${ME.mgr ? ' للإرجاع في نهاية العام استخدم «±» في المخزون.' : ''}</p>`; };
    const send = async (items) => { try { const r = await call('tb_distribute', { p_items: items, p_class: +CLS }); if (r.short) toast(`المخزون نفد: ${r.short}`, 'warn'); else toast(`تم (${r.done}) ✓`); load(); } catch (e) { toast(errMsg(e), 'err'); load(); } };
    view.onchange = (e) => { const c = e.target.closest('[data-s]'); if (c) return send([{ holder_id: c.dataset.s, title_id: +c.dataset.t, action: c.checked ? 'give' : 'undo' }]);
      if (e.target.id === 'cs') { CLS = e.target.value; load(); } };
    view.onclick = (e) => { const a = e.target.closest('[data-all]'), r = e.target.closest('[data-row]');
      if (a) send(S.students.filter((s) => !s.has.includes(+a.dataset.all)).map((s) => ({ holder_id: s.id, title_id: +a.dataset.all, action: 'give' })));
      if (r) { const s = S.students.find((x) => x.id === r.dataset.row); send(S.titles.filter((t) => !s.has.includes(t.id)).map((t) => ({ holder_id: s.id, title_id: t.id, action: 'give' }))); }
      if (e.target.id === 'tg') teacherGuides(); };
    bindTerm(load); await load();
  }
  async function teacherGuides() {
    const G = (await call('tb_titles_list', { p_term: T })).filter((t) => t.kind === 'teacher' && t.active);
    if (!G.length) { toast('لا توجد أدلة معلم مسجلة — أضفها بنوع «دليل المعلم»', 'warn'); return; }
    const box = document.createElement('div');
    const draw = async (id) => { const D = await call('tb_teacher_sheet', { p_title: +id });
      $('#gl', box).innerHTML = `<p class="hint">المخزن: ${D.stock}</p>${D.teachers.map((t) => `<label class="chk"><input type="checkbox" data-tt="${t.id}" ${t.has ? 'checked' : ''}> ${esc(t.name)} <span class="hint">${esc(t.subjects || '')}</span></label>`).join('') || '<p class="hint">لا معلمون مسندون لهذا الصف.</p>'}`; };
    box.innerHTML = `<select id="gs">${G.map((g) => `<option value="${g.id}">${esc(g.title)} — ${esc(g.grade || '')}</option>`).join('')}</select><div id="gl"></div>`;
    box.onchange = async (e) => { if (e.target.id === 'gs') return draw(e.target.value); const c = e.target.closest('[data-tt]'); if (!c) return;
      try { const r = await call('tb_distribute', { p_items: [{ holder_id: c.dataset.tt, title_id: +$('#gs', box).value, action: c.checked ? 'give' : 'undo' }] }); if (r.short) toast('المخزون نفد', 'warn'); draw($('#gs', box).value); } catch (er) { toast(errMsg(er), 'err'); } };
    await draw(G[0].id);
    modal({ title: '📙 توزيع أدلة المعلمين', wide: true, body: box, actions: [{ label: 'إغلاق', value: null }] });
  }

  /* ---------- تقدّم التوزيع ---------- */
  async function progressView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px">${termSel()}</div><div id="pg"></div>`;
    const load = async () => { let L; try { L = await call('tb_progress', { p_term: T }); } catch (e) { $('#pg').innerHTML = esc(errMsg(e)); return; }
      L = L.filter((c) => c.students && c.titles); const tot = L.reduce((a, c) => a + c.students * c.titles, 0), got = L.reduce((a, c) => a + c.given, 0);
      $('#pg').innerHTML = `<p>الإجمالي: <b>${got}</b> من ${tot} نسخة (${tot ? Math.round(got * 100 / tot) : 0}%)</p><div class="glass" style="padding:6px"><table class="t"><thead><tr><th>الفصل</th><th>رائد الفصل</th><th>الطلاب</th><th>التقدّم</th></tr></thead><tbody>
        ${L.map((c) => { const p = Math.round(c.given * 100 / (c.students * c.titles)); return `<tr><td><b>${esc(c.class)}</b></td><td>${esc(c.homeroom || '—')}</td><td>${c.students}</td><td style="min-width:180px"><div class="bar"><i style="width:${p}%;${p === 100 ? '' : 'background:#e0a800'}"></i></div><span class="hint">${p}% (${c.given}/${c.students * c.titles})</span></td></tr>`; }).join('') || '<tr><td colspan="4" class="hint">لا كتب مسجلة لهذا الفصل الدراسي.</td></tr>'}</tbody></table></div>`; };
    bindTerm(load); await load();
  }

  async function settingsView() {
    const L = LISTS.staff || [], sel = (ME.officers || []).map((x) => x.id);
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">⚙️ مسؤولو الكتب المدرسية</h3><p class="hint">من يدير الطلب والاستلام والمخزون والتوزيع. إن لم تحدد أحدًا يُعتمد المسمى الوظيفي (كتب / مستودع / مخازن / مصادر التعلم). رائد كل فصل يوزّع كتب فصله دائمًا.</p>
      <input id="fl" placeholder="🔎 تصفية" style="width:100%"><div style="max-height:320px;overflow:auto;columns:2 220px">${L.map((s) => `<label class="chk" data-n="${esc(s.name + ' ' + (s.job || ''))}"><input type="checkbox" data-o="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}> ${esc(s.name)} <span class="hint">${esc(s.job || '')}</span></label>`).join('')}</div>
      <button class="btn primary" id="sv">حفظ</button></div>`;
    $('#fl').oninput = (e) => $$('[data-n]').forEach((l) => { l.style.display = LMS.has(l.dataset.n, e.target.value) ? '' : 'none'; });
    $('#sv').onclick = async () => { try { await call('tb_settings_set', { p_officers: $$('[data-o]:checked').map((x) => x.dataset.o) }); toast('تم ✓'); ME = await call('tb_me'); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  paint();
})();
