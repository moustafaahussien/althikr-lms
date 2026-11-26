/* =====================================================================
   الاختبارات وبنك الأسئلة: المعلم يبني البنك وينشئ الاختبار ويصحّح القصيرة،
   الطالب يؤدي الاختبار بمؤقت وحفظ تلقائي، والمشرف يتابع
   الدوال: hw_options (sql/34) + qb_* / ex_* (sql/37)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, printTable } = LMS;
  await requireAuth();

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); };
  const num = (v) => (v == null ? '' : String(+v));
  const short = (c) => String(c).split(' — ')[0];
  const QT = { mcq: 'اختيار من متعدد', multi: 'اختيار متعدد (أكثر من إجابة)', tf: 'صح وخطأ', short: 'إجابة قصيرة', fill: 'أكمل الفراغ', match: 'مزاوجة', order: 'ترتيب', essay: 'مقالي', image: 'إجابة بصورة' };
  const fillView = (b) => esc(b).replace(/\[\[([^\]]*)\]\]/g, (m, a) => `<b class="ok" style="border-bottom:2px solid">${a.split('|').join(' / ')}</b>`);
  const PER = { p1: 'الفترة الأولى', p2: 'الفترة الثانية', mid: 'منتصف الفصل', final: 'نهاية العام' };
  const perSel = (v) => `<option value="">— غير محدد —</option>${Object.entries(PER).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}`;
  const imgHTML = (src) => (src && /^data:image\//.test(src) ? `<img class="qimg" src="${esc(src)}" alt="صورة السؤال">` : '');
  // ضغط الصورة في المتصفح قبل الحفظ (أقصى عرض 900 بكسل، JPEG) لتبقى صغيرة
  const readImg = (file) => new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) { rej(new Error('اختر ملف صورة')); return; }
    const fr = new FileReader(); fr.onerror = () => rej(new Error('تعذّرت قراءة الصورة'));
    fr.onload = () => { const im = new Image(); im.onerror = () => rej(new Error('صورة غير صالحة'));
      im.onload = () => { const k = Math.min(1, 900 / im.width, 900 / im.height); const c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        let q = 0.82, out = c.toDataURL('image/jpeg', q); while (out.length > 420000 && q > 0.4) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
        out.length > 440000 ? rej(new Error('الصورة كبيرة جدًا')) : res(out); };
      im.src = fr.result; };
    fr.readAsDataURL(file); });
  const STATE = { open: 'مفتوح الآن', upcoming: 'لم يبدأ', closed: 'انتهى' };
  const chip = (cls, txt) => `<span class="st ${esc(cls)}">${esc(txt)}</span>`;

  let OPT = { is_teacher: false, can_follow: false, classes: [], subjects: [], role: '' };
  try { OPT = await call('hw_options'); } catch (e) { $('#main').insertAdjacentHTML('beforeend', `<div class="notice err">${esc(errMsg(e))}</div>`); return; }
  const STUDENT = OPT.role === 'student';
  const TABS = { mine: !STUDENT && (OPT.is_teacher || !OPT.can_follow), bank: !STUDENT && OPT.is_teacher, student: STUDENT, all: !STUDENT && OPT.can_follow };
  Object.entries(TABS).forEach(([k, on]) => { $(`#tabs [data-tab="${k}"]`).hidden = !on; });

  let TIMER = null;   // مؤقت الاختبار الجاري (يتوقف عند تغيير التبويب)
  const LOAD = { mine: drawMine, bank: drawBank, student: drawStudent, all: drawAll };
  function show(tab) {
    if (!TABS[tab]) tab = Object.keys(TABS).find((k) => TABS[k]);
    if (!tab) return;
    if (TIMER) { clearInterval(TIMER); TIMER = null; }
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + tab));
    history.replaceState(null, '', '#' + tab);
    LOAD[tab]();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); };
  const current = () => ($('#tabs button.on') || {}).dataset?.tab;
  const refresh = () => { const t = current(); if (t) LOAD[t](); };
  const subjOpts = (sel) => OPT.subjects.map((s) => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');

  // عرض سؤال (للمعلم) مع إبراز الإجابة الصحيحة
  const qHTML = (q, extra) => `<div class="qb"><div class="qh"><div class="grow">${esc(q.body)}</div>
      <span class="chip gray">${esc(QT[q.qtype])}</span><span class="chip teal">${esc(num(q.points))} د</span>${extra || ''}</div>
    ${imgHTML(q.image)}
    ${q.qtype === 'fill' ? `<div class="hint">الإجابات: ${fillView(q.body)}</div>`
      : ['essay', 'image'].includes(q.qtype) ? `<small class="hint">${q.qtype === 'image' ? '📷 يرفع الطالب صورة حلّه' : '✍️ إجابة مقالية'} — تصحيح يدوي${q.answer ? ' · النموذجية: ' + esc(q.answer) : ''}</small>`
      : q.qtype === 'order' ? `<small class="hint">الترتيب الصحيح (يُعرض للطالب مخلوطًا):</small><ol>${(q.options || []).map((o) => `<li>${esc(o.t)}</li>`).join('')}</ol>`
      : q.qtype === 'short' ? `<small class="hint">الإجابة النموذجية: ${esc(q.answer || '— (تصحيح يدوي)')}</small>`
      : q.qtype === 'match' ? `<table class="mt">${(q.options || []).map((o) => `<tr><td>${esc(o.l)}</td><td>⟵⟶</td><td class="ok">${esc(o.r)}</td></tr>`).join('')}</table>`
      : `<ol>${(q.options || []).map((o) => `<li class="${o.ok ? 'ok' : ''}">${esc(o.t)}${o.ok ? ' ✓' : ''}</li>`).join('')}</ol>`}
    ${q.topic || q.owner ? `<small class="hint">${esc(q.topic || '')}${q.topic && q.owner && !q.mine ? ' · ' : ''}${!q.mine && q.owner ? 'من: ' + esc(q.owner) : ''}</small>` : ''}</div>`;

  // ---------------- بنك الأسئلة ----------------
  let BANK_SUBJ = OPT.subjects[0]?.id || null;
  async function drawBank() {
    const pane = $('#tab-bank');
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px"><label>المادة <select id="bS">${subjOpts(BANK_SUBJ)}</select></label>
      <input id="bQ" class="grow" type="search" placeholder="ابحث في نص السؤال أو الموضوع…">
      <select id="bT"><option value="">كل الأنواع</option>${Object.entries(QT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <button class="btn primary" id="bNew">➕ سؤال جديد</button></div><div id="bList"><div class="empty">جارٍ التحميل…</div></div>`;
    $('#bS').onchange = (e) => { BANK_SUBJ = +e.target.value; drawBank(); };
    $('#bNew').onclick = () => editQ(null);
    if (!BANK_SUBJ) { $('#bList').innerHTML = '<div class="empty">لا توجد مواد مسندة إليك.</div>'; return; }
    let L; try { L = await call('qb_list', { p_subject: BANK_SUBJ }); } catch (e) { $('#bList').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const paint = () => { const q = $('#bQ').value.trim(), t = $('#bT').value;
      const F = L.filter((x) => (!t || x.qtype === t) && (!q || LMS.has((x.body + ' ' + (x.topic || '')), q)));
      const mine = F.filter((x) => x.mine), others = F.filter((x) => !x.mine);
      const row = (x) => qHTML(x, `${x.used ? `<span class="chip gray" title="عدد الاختبارات التي استخدمته">في ${x.used} اختبار</span>` : ''}
        ${x.mine ? `<button class="btn sm ghost" data-ed="${x.id}" title="تعديل">✏️</button><button class="btn sm ghost" data-del="${x.id}" title="حذف">🗑️</button>` : ''}`);
      $('#bList').innerHTML = L.length ? `<h3 class="sec-h">أسئلتي (${mine.length})</h3>${mine.map(row).join('') || '<div class="empty">لا توجد</div>'}
        ${others.length ? `<h3 class="sec-h">أسئلة زملائك في نفس المادة (${others.length}) — يمكنك استخدامها في اختباراتك</h3>${others.map(row).join('')}` : ''}`
        : '<div class="empty">البنك فارغ لهذه المادة — أضف أول سؤال بـ «سؤال جديد».</div>'; };
    paint(); $('#bQ').oninput = paint; $('#bT').onchange = paint;
    $('#bList').onclick = async (e) => {
      const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
      if (ed) editQ(L.find((x) => x.id === +ed.dataset.ed));
      if (del) { if (!await confirmBox('حذف السؤال من البنك؟ (الاختبارات المنشورة تحتفظ بنسختها)', 'حذف')) return;
        try { await call('qb_delete', { p_id: +del.dataset.del }); toast('حُذف السؤال'); drawBank(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }

  function editQ(q, after) {
    q = q || { qtype: 'mcq', body: '', options: [{ t: '' }, { t: '' }, { t: '' }, { t: '' }], points: 1, subject_id: BANK_SUBJ };
    const sid = q.subject_id || BANK_SUBJ;
    const body = `<div class="form-grid">
      <label class="f">المادة<select id="qS">${subjOpts(sid)}</select></label>
      <label class="f">نوع السؤال<select id="qT">${Object.entries(QT).map(([k, v]) => `<option value="${k}"${k === q.qtype ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">الدرجة<input id="qP" type="number" min="0.5" max="100" step="0.5" value="${esc(num(q.points))}"></label>
      <label class="f">الموضوع / الدرس (اختياري)<input id="qX" maxlength="120" value="${esc(q.topic || '')}"></label>
      <label class="f" style="grid-column:1/-1">نص السؤال *<textarea id="qB" rows="3">${esc(q.body)}</textarea></label>
      <div class="f" style="grid-column:1/-1"><span>صورة للسؤال (اختياري)</span><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label class="btn sm ghost" style="cursor:pointer">🖼️ اختيار صورة<input type="file" id="qI" accept="image/*" hidden></label><button class="btn sm ghost" type="button" id="qIx"${q.image ? '' : ' hidden'}>✕ إزالة الصورة</button></div>
        <div id="qIv">${imgHTML(q.image)}</div></div>
      <div class="f" style="grid-column:1/-1" id="qArea"></div></div>`;
    modal({ title: q.id ? 'تعديل سؤال' : 'سؤال جديد', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: '💾 حفظ', cls: 'primary', onClick: async (w) => {
      const t = $('#qT', w).value;
      const p = { id: q.id || null, subject_id: +$('#qS', w).value, qtype: t, body: $('#qB', w).value.trim(), points: +$('#qP', w).value || 1, topic: $('#qX', w).value.trim() };
      if (!p.body) { toast('اكتب نص السؤال', 'warn'); return false; }
      if (t === 'mcq') { p.options = $$('.opt-row', w).map((r) => ({ t: $('input[type=text]', r).value.trim(), ok: $('input[type=radio]', r).checked })).filter((o) => o.t);
        if (p.options.length < 2) { toast('أضف خيارين على الأقل', 'warn'); return false; }
        if (!p.options.some((o) => o.ok)) { toast('حدّد الإجابة الصحيحة', 'warn'); return false; } }
      if (t === 'multi') { p.options = $$('.opt-row', w).map((r) => ({ t: $('input[type=text]', r).value.trim(), ok: $('input[type=checkbox]', r).checked })).filter((o) => o.t);
        if (p.options.length < 3) { toast('أضف 3 خيارات على الأقل', 'warn'); return false; } if (!p.options.some((o) => o.ok)) { toast('حدّد الإجابات الصحيحة', 'warn'); return false; } }
      if (t === 'order') { p.options = $$('.opt-row', w).map((r) => ({ t: $('input[type=text]', r).value.trim() })).filter((o) => o.t); if (p.options.length < 2) { toast('أضف عنصرين على الأقل', 'warn'); return false; } }
      if (t === 'fill' && !/\[\[[^\]]+\]\]/.test(p.body)) { toast('ضع كل إجابة بين قوسين مزدوجين [[ ]] داخل نص السؤال', 'warn'); return false; }
      if (['essay', 'image'].includes(t)) p.answer = ($('#qA', w) || { value: '' }).value.trim();
      if (t === 'tf') p.tf = $('input[name=qtf]:checked', w)?.value === '1';
      if (t === 'short') p.answer = $('#qA', w).value.trim();
      if (t === 'match') { p.pairs = $$('.pair-row', w).map((r) => ({ l: $$('input', r)[0].value.trim(), r: $$('input', r)[1].value.trim() })).filter((x) => x.l || x.r);
        if (p.pairs.some((x) => !x.l || !x.r)) { toast('أكمل طرفي كل زوج', 'warn'); return false; } if (p.pairs.length < 2) { toast('أضف زوجين على الأقل', 'warn'); return false; } }
      p.image = IMG || null;
      const r = await call('qb_save', { p }); toast('حُفظ السؤال'); if (after) after(r.id, p.subject_id); else { BANK_SUBJ = p.subject_id; drawBank(); } } }] });
    const w = $$('.modal-wrap').pop();
    let IMG = q.image || null;
    $('#qI', w).onchange = async (e) => { const f = e.target.files[0]; if (!f) return;
      try { IMG = await readImg(f); $('#qIv', w).innerHTML = imgHTML(IMG); $('#qIx', w).hidden = false; } catch (er) { toast(er.message, 'err'); } e.target.value = ''; };
    $('#qIx', w).onclick = () => { IMG = null; $('#qIv', w).innerHTML = ''; $('#qIx', w).hidden = true; };
    const pairRow = (o, i) => `<div class="opt-row pair-row"><input type="text" maxlength="300" value="${esc(o.l || '')}" placeholder="العمود (أ) ${i + 1}"><span>⟵⟶</span>
      <input type="text" maxlength="300" value="${esc(o.r || '')}" placeholder="العمود (ب) ${i + 1}"><button class="btn sm ghost" type="button" data-rm title="حذف الزوج">✕</button></div>`;
    const area = () => { const t = $('#qT', w).value; const A = $('#qArea', w);
      if (t === 'match') { const O = (q.qtype === 'match' && q.options?.length) ? q.options : [{}, {}, {}];
        A.innerHTML = `<span>الأزواج الصحيحة — يُعرض العمود (ب) للطالب مخلوطًا ويختار لكل عنصر ما يقابله</span><div id="qO">${O.map(pairRow).join('')}</div>
          <button class="btn sm ghost" id="qAdd" type="button">➕ زوج</button>`;
        $('#qAdd', w).onclick = () => { const n = $$('.pair-row', w).length; if (n >= 8) return; $('#qO', w).insertAdjacentHTML('beforeend', pairRow({}, n)); };
        $('#qO', w).onclick = (e) => { const x = e.target.closest('[data-rm]'); if (x && $$('.pair-row', w).length > 2) x.closest('.pair-row').remove(); };
        return; }
      if (t === 'multi' || t === 'order') { const O = (q.qtype === t && q.options?.length) ? q.options : [{ t: '' }, { t: '' }, { t: '' }, { t: '' }];
        const row = (o, i) => t === 'multi' ? `<div class="opt-row"><input type="checkbox" ${o.ok ? 'checked' : ''} aria-label="صحيحة ${i + 1}"><input type="text" maxlength="500" value="${esc(o.t || '')}" placeholder="الخيار ${i + 1}"><button class="btn sm ghost" type="button" data-rm>✕</button></div>`
          : `<div class="opt-row"><b style="min-width:22px">${i + 1}</b><input type="text" maxlength="300" value="${esc(o.t || '')}" placeholder="العنصر ${i + 1}"><button class="btn sm ghost" type="button" data-rm>✕</button></div>`;
        A.innerHTML = `<span>${t === 'multi' ? 'الخيارات — علّم كل الإجابات الصحيحة (درجة جزئية: الصحيح المختار ناقص الخطأ المختار)' : 'العناصر بالترتيب الصحيح — تُعرض للطالب مخلوطة ويرتبها (درجة لكل موضع صحيح)'}</span>
          <div id="qO">${O.map(row).join('')}</div><button class="btn sm ghost" id="qAdd" type="button">➕ ${t === 'multi' ? 'خيار' : 'عنصر'}</button>`;
        $('#qAdd', w).onclick = () => { const n = $$('.opt-row', w).length; if (n >= 8) return; $('#qO', w).insertAdjacentHTML('beforeend', row({ t: '' }, n)); };
        $('#qO', w).onclick = (e) => { const x = e.target.closest('[data-rm]'); if (x && $$('.opt-row', w).length > 2) x.closest('.opt-row').remove(); };
        return; }
      if (t === 'fill') { A.innerHTML = `<div class="notice">اكتب الإجابات داخل نص السؤال بين قوسين مزدوجين، مثل: <b>عاصمة السعودية [[الرياض]]</b>. وللإجابات البديلة استخدم |، مثل: [[القاهرة|القاهره]].<br>
          يظهر للطالب مكان كل إجابة فراغًا يكتب فيه، ويُصحَّح تلقائيًا مع تجاهل التشكيل والهمزات (حتى 10 فراغات).</div>`; return; }
      if (t === 'essay' || t === 'image') { A.innerHTML = `${t === 'image' ? '<div class="notice">📷 يحلّ الطالب على ورقة ثم يصوّر حلّه من الجوال ويرفعه داخل الاختبار، وتصححه أنت يدويًا.</div>' : ''}
          <label class="f">إجابة نموذجية أو معايير التصحيح (تظهر لك فقط أثناء التصحيح)<textarea id="qA" rows="2" maxlength="300">${esc(q.answer || '')}</textarea></label>`; return; }
      if (t === 'mcq') { const O = (q.qtype === 'mcq' && q.options?.length) ? q.options : [{ t: '' }, { t: '' }, { t: '' }, { t: '' }];
        A.innerHTML = `<span>الخيارات — اختر الدائرة بجوار الإجابة الصحيحة</span><div id="qO">${O.map((o, i) => optRow(o, i)).join('')}</div>
          <button class="btn sm ghost" id="qAdd" type="button">➕ خيار</button>`;
        $('#qAdd', w).onclick = () => { const n = $$('.opt-row', w).length; if (n >= 8) return; $('#qO', w).insertAdjacentHTML('beforeend', optRow({ t: '' }, n)); };
        $('#qO', w).onclick = (e) => { const x = e.target.closest('[data-rm]'); if (x && $$('.opt-row', w).length > 2) x.closest('.opt-row').remove(); };
      } else if (t === 'tf') { const ok = q.qtype === 'tf' ? !!q.options?.[0]?.ok : true;
        A.innerHTML = `<span>الإجابة الصحيحة</span><div style="display:flex;gap:16px"><label><input type="radio" name="qtf" value="1"${ok ? ' checked' : ''}> صح</label><label><input type="radio" name="qtf" value="0"${ok ? '' : ' checked'}> خطأ</label></div>`;
      } else A.innerHTML = `<label class="f">الإجابة النموذجية (تُطابق تلقائيًا مع تجاهل التشكيل والهمزات — اتركها فارغة للتصحيح اليدوي)<input id="qA" maxlength="300" value="${esc(q.answer || '')}"></label>
        <small class="hint">أي إجابة لا تطابقها حرفيًا تظهر لك للتصحيح اليدوي.</small>`; };
    area(); $('#qT', w).onchange = area;
  }
  const optRow = (o, i) => `<div class="opt-row"><input type="radio" name="qok" ${o.ok ? 'checked' : ''} aria-label="الإجابة الصحيحة ${i + 1}">
    <input type="text" maxlength="500" value="${esc(o.t || '')}" placeholder="الخيار ${i + 1}"><button class="btn sm ghost" type="button" data-rm title="حذف الخيار">✕</button></div>`;

  // ---------------- المعلم: اختباراتي ----------------
  async function drawMine() {
    const pane = $('#tab-mine');
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px"><span class="hint grow">اختباراتك لكل فصولك — اضغط الاختبار لعرض النتائج والتصحيح.</span>
      ${OPT.is_teacher ? '<button class="btn primary" id="newEx">➕ اختبار جديد</button>' : ''}</div><div id="mineList"><div class="empty">جارٍ التحميل…</div></div>`;
    if (!OPT.is_teacher) { $('#mineList').innerHTML = '<div class="empty">لا توجد مواد مسندة إليك، فلا يمكنك إنشاء اختبارات.</div>'; return; }
    $('#newEx').onclick = () => editEx(null);
    let L; try { L = await call('ex_list', { p_box: 'mine' }); } catch (e) { $('#mineList').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const card = (x) => { const pct = x.students ? Math.round(100 * x.submitted / x.students) : 0;
      return `<button class="hw" data-ex="${x.id}"><b>${esc(x.title)}</b><small>${esc(x.subject || '')} · ${esc(x.classes.map(short).join('، '))}</small>
        <small>${esc(fmt(x.opens_at))} ← ${esc(fmt(x.closes_at))} · ${x.duration_min} دقيقة · ${x.n_questions} سؤال</small>
        <div class="prog" title="${pct}%"><i style="width:${pct}%"></i></div>
        <div class="row"><small>سلّم ${x.submitted} من ${x.students}${x.avg != null ? ` · المتوسط ${x.avg}%` : ''}</small>
        <span>${chip(x.state, STATE[x.state])}${x.review ? ' ' + chip('review', `${x.review} بانتظار التصحيح`) : ''}</span></div></button>`; };
    const act = L.filter((x) => x.state !== 'closed'), done = L.filter((x) => x.state === 'closed');
    $('#mineList').innerHTML = L.length ? `${act.length ? `<h3 class="sec-h">الجارية والقادمة</h3><div class="hw-list">${act.map(card).join('')}</div>` : ''}
      ${done.length ? `<h3 class="sec-h">المنتهية</h3><div class="hw-list">${done.map(card).join('')}</div>` : ''}`
      : '<div class="empty">لم تنشئ اختبارات بعد — أضف أسئلة في «بنك الأسئلة» ثم أنشئ اختبارًا.</div>';
    $('#mineList').onclick = (e) => { const c = e.target.closest('[data-ex]'); if (c) teacherView(+c.dataset.ex); };
  }

  const localDT = (t, addH) => { const d = t ? new Date(t) : (() => { const x = new Date(); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + (addH || 1)); return x; })();
    const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };

  async function editEx(x) {
    x = x || { title: '', instructions: '', class_ids: [], subject_id: BANK_SUBJ, duration_min: 30, shuffle: true, show_results: true, questions: [] };
    const locked = !!x.locked;
    let BANK = [];
    const picked = new Map((x.questions || []).map((q) => [+q.id, +q.points]));
    const body = `${locked ? '<div class="notice">بدأ بعض الطلاب هذا الاختبار، فيمكنك تعديل العنوان والتعليمات وموعد الإغلاق وإظهار النتائج فقط.</div>' : ''}
      <div class="form-grid">
      <label class="f" style="grid-column:1/-1">عنوان الاختبار *<input id="eT" maxlength="200" value="${esc(x.title)}" placeholder="مثال: اختبار الوحدة الأولى"></label>
      <label class="f">المادة *<select id="eS"${locked ? ' disabled' : ''}>${subjOpts(x.subject_id)}</select></label>
      <label class="f">المدة (دقيقة)<input id="eM" type="number" min="1" max="300" value="${esc(num(x.duration_min))}"${locked ? ' disabled' : ''}></label>
      <label class="f">يُفتح في *<input id="eO" type="datetime-local" value="${esc(localDT(x.opens_at, 1))}"${locked ? ' disabled' : ''}></label>
      <label class="f">يُغلق في *<input id="eC" type="datetime-local" value="${esc(localDT(x.closes_at, 25))}"></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="eSh"${x.shuffle ? ' checked' : ''}${locked ? ' disabled' : ''}> خلط ترتيب الأسئلة والخيارات لكل طالب</label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="eR"${x.show_results ? ' checked' : ''}> إظهار الدرجة للطالب بعد التسليم</label>
      <label class="f">فترة التقويم (لسجل الدرجات)<select id="eP">${perSel(x.period || localStorage.getItem('lms_per') || '')}</select></label>
      <div class="f" style="grid-column:1/-1"><span>الفصول *</span><div id="eCl" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>
      <label class="f" style="grid-column:1/-1">تعليمات للطالب (اختياري)<textarea id="eI" rows="2">${esc(x.instructions || '')}</textarea></label>
      <div class="f" style="grid-column:1/-1"><div class="toolbar"><b class="grow" id="eSum">الأسئلة</b>${locked ? '' : '<button class="btn sm ghost" type="button" id="eNewQ">➕ سؤال جديد للبنك</button>'}</div>
        <div id="eQ" style="max-height:46vh;overflow:auto"></div></div></div>`;
    modal({ title: x.id ? 'تعديل الاختبار' : 'اختبار جديد', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: x.id ? '💾 حفظ' : '📤 نشر الاختبار', cls: 'primary', onClick: async (w) => {
      const p = { id: x.id || null, title: $('#eT', w).value.trim(), subject_id: +$('#eS', w).value || null, duration_min: +$('#eM', w).value || 30,
        opens_at: $('#eO', w).value ? new Date($('#eO', w).value).toISOString() : '', closes_at: $('#eC', w).value ? new Date($('#eC', w).value).toISOString() : '',
        shuffle: $('#eSh', w).checked, show_results: $('#eR', w).checked, instructions: $('#eI', w).value.trim(), period: $('#eP', w).value || null,
        class_ids: locked ? x.class_ids : $$('#eCl input:checked', w).map((i) => +i.value),
        questions: locked ? x.questions.map((q) => ({ id: q.id })) : BANK.filter((q) => picked.has(q.id)).map((q) => ({ id: q.id, points: picked.get(q.id) })) };
      if (!p.title) { toast('اكتب عنوان الاختبار', 'warn'); return false; }
      if (!p.opens_at || !p.closes_at || new Date(p.closes_at) <= new Date(p.opens_at)) { toast('وقت الإغلاق يجب أن يكون بعد وقت الفتح', 'warn'); return false; }
      if (!p.class_ids.length) { toast('اختر فصلًا واحدًا على الأقل', 'warn'); return false; }
      if (!p.questions.length) { toast('اختر سؤالًا واحدًا على الأقل', 'warn'); return false; }
      try { localStorage.setItem('lms_per', p.period || ''); } catch (_) {}
      { const od = LMS.ymd(new Date(p.opens_at)); if (!LMS.cal.isSchoolDay(od) && !await confirmBox(`موعد فتح الاختبار يقع في يوم غير دراسي (${LMS.cal.why(od)}). المتابعة؟`, 'متابعة')) return false; }
      await call('ex_save', { p }); toast(x.id ? 'حُفظ الاختبار' : 'نُشر الاختبار لطلاب الفصول المختارة'); show('mine'); } }] });
    const w = $$('.modal-wrap').pop();
    let init = new Set(x.class_ids || []);
    const paintCls = () => { const sid = +$('#eS', w).value || null; const sel = new Set([...$$('#eCl input:checked', w).map((i) => +i.value), ...init]); init = new Set();
      const L = OPT.classes.filter((c) => !sid || (c.subjects || []).includes(sid));
      $('#eCl', w).innerHTML = L.map((c) => `<label style="display:flex;align-items:center;gap:4px;background:#f4f7f8;padding:4px 10px;border-radius:99px;font-size:.86rem;cursor:pointer"><input type="checkbox" value="${c.id}"${sel.has(c.id) ? ' checked' : ''}${locked ? ' disabled' : ''}> ${esc(short(c.label))}<small class="hint"> ${esc(c.label.split(' — ')[1] || '')}</small></label>`).join('') || '<span class="hint">لا توجد فصول لهذه المادة</span>'; };
    const sum = () => { let n = 0, t = 0; picked.forEach((pt) => { n++; t += pt; }); $('#eSum', w).textContent = `الأسئلة المختارة: ${n} — المجموع ${t} درجة`; };
    const paintQ = async () => {
      if (locked) { $('#eQ', w).innerHTML = x.questions.map((q) => qHTML(q)).join(''); BANK = x.questions; x.questions.forEach((q) => picked.set(+q.id, +q.points)); sum(); return; }
      const sid = +$('#eS', w).value; $('#eQ', w).innerHTML = '<div class="empty">جارٍ تحميل البنك…</div>';
      try { BANK = await call('qb_list', { p_subject: sid }); } catch (e) { $('#eQ', w).innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      [...picked.keys()].forEach((k) => { if (!BANK.some((q) => q.id === k)) picked.delete(k); });
      $('#eQ', w).innerHTML = BANK.length ? BANK.map((q) => `<label class="pick" style="display:block">${qHTML(q, `<input type="checkbox" data-q="${q.id}"${picked.has(q.id) ? ' checked' : ''} aria-label="اختيار السؤال">
          <input type="number" class="sc" data-pt="${q.id}" min="0.5" max="100" step="0.5" value="${esc(num(picked.get(q.id) ?? q.points))}" style="width:64px" title="درجة السؤال في هذا الاختبار">`)}</label>`).join('')
        : '<div class="empty">لا توجد أسئلة لهذه المادة في البنك — أضف بـ «سؤال جديد للبنك».</div>';
      sum(); };
    $('#eQ', w).addEventListener('change', (e) => {
      const c = e.target.closest('[data-q]'), pt = e.target.closest('[data-pt]');
      if (c) { const id = +c.dataset.q; if (c.checked) picked.set(id, +$(`[data-pt="${id}"]`, w).value || 1); else picked.delete(id); }
      if (pt) { const id = +pt.dataset.pt; if (picked.has(id)) picked.set(id, +pt.value || 1); }
      sum(); });
    $('#eS', w).onchange = () => { paintCls(); paintQ(); };
    if ($('#eNewQ', w)) $('#eNewQ', w).onclick = () => editQ({ qtype: 'mcq', body: '', points: 1, subject_id: +$('#eS', w).value }, (id, sid) => {
      if (sid === +$('#eS', w).value) { picked.set(id, 1); paintQ(); } });
    paintCls(); paintQ();
  }

  // تفاصيل الاختبار للمعلم/المتابع: النتائج والتصحيح اليدوي
  async function teacherView(id) {
    let x; try { x = await call('ex_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const A = x.attempts || [], Q = x.questions || [];
    const sub = A.filter((a) => a.submitted), rev = A.filter((a) => a.needs_review);
    const avg = sub.length ? Math.round(sub.reduce((s, a) => s + (a.max ? a.score / a.max : 0), 0) / sub.length * 100) : null;
    // نسبة الإجابة الصحيحة لكل سؤال (تحليل الأسئلة)
    const qStat = Q.map((q) => { const R = sub.map((a) => a.results?.[q.id]).filter(Boolean); return R.length ? Math.round(100 * R.filter((r) => r.ok).length / R.length) : null; });
    const body = `<div class="hwv"><div class="meta" style="display:flex;flex-wrap:wrap;gap:6px">${chip(x.state, STATE[x.state])}
        <span class="chip teal">${esc(x.subject || '')}</span><span class="chip gray">${esc(fmt(x.opens_at))} ← ${esc(fmt(x.closes_at))}</span>
        <span class="chip gray">${x.duration_min} دقيقة</span>${x.period ? `<span class="chip gray">${esc(PER[x.period])}</span>` : ''}<span class="chip gray">من ${esc(num(x.max_score))}</span>${x.mine ? '' : `<span class="chip gray">المعلم: ${esc(x.teacher)}</span>`}</div>
      <p><b>سلّم ${sub.length} من ${A.length}</b>${avg != null ? ` · المتوسط ${avg}%` : ''}${rev.length ? ` · <span class="st review">${rev.length} بانتظار التصحيح اليدوي</span>` : ''}</p>
      <nav class="tabs" id="vTabs" style="margin:6px 0"><button class="on" data-v="r">النتائج</button><button data-v="q">الأسئلة وتحليلها</button>${x.mine && rev.length ? '<button data-v="g">✍️ التصحيح اليدوي</button>' : ''}</nav>
      <div data-vp="r">${A.length ? `<div class="toolbar"><select id="rf"><option value="">الكل</option><option value="done">سلّم</option><option value="none">لم يسلّم</option><option value="rev">بانتظار التصحيح</option></select></div>
        <div class="table-wrap ros"><table><thead><tr><th>الطالب</th><th>الفصل</th><th>الحالة</th><th>الدرجة</th><th>%</th></tr></thead><tbody>
        ${A.map((a) => `<tr data-f="${a.needs_review ? 'rev' : a.submitted ? 'done' : 'none'}"><td>${esc(a.name)}</td><td>${esc(a.class)}</td>
          <td>${a.submitted ? chip('graded', 'سلّم ' + fmt(a.submitted)) : a.started ? chip('submitted', 'بدأ ولم يسلّم') : chip('none', 'لم يبدأ')}${a.needs_review ? ' ' + chip('review', 'يحتاج تصحيح') : ''}</td>
          <td>${a.submitted ? esc(num(a.score)) + ' / ' + esc(num(a.max)) : ''}</td><td>${a.submitted && a.max ? Math.round(100 * a.score / a.max) + '%' : ''}</td></tr>`).join('')}</tbody></table></div>`
        : '<div class="notice">لا يوجد طلاب مربوطون بهذه الفصول في المنصة بعد.</div>'}</div>
      <div data-vp="q" hidden>${Q.map((q, i) => qHTML(q, qStat[i] != null ? `<span class="chip ${qStat[i] >= 50 ? 'teal' : 'pink'}" title="نسبة من أجاب صحيحًا">✔ ${qStat[i]}%</span>` : '')).join('')}</div>
      <div data-vp="g" hidden>${rev.map((a) => `<div class="qb" data-att="${a.id}"><b>${esc(a.name)}</b> <small class="hint">${esc(a.class)}</small>
        ${Q.filter((q) => a.results?.[q.id]?.manual && !a.results[q.id].graded).map((q) => `<div style="margin-top:8px" data-q="${esc(q.id)}"><div class="hint">${esc(q.body)}</div>
          ${/^data:image\//.test(a.answers?.[q.id] || '') ? `<img class="qimg" src="${esc(a.answers[q.id])}" alt="حل الطالب" style="max-width:100%">` : `<div style="white-space:pre-wrap;background:#f6f8f9;border-radius:8px;padding:6px 10px;margin:4px 0">${esc(a.answers?.[q.id] || '')}</div>`}
          <small class="hint">النموذجية: ${esc(q.answer || '—')}</small>
          <div style="display:flex;gap:6px;align-items:center;margin-top:4px"><input class="sc" type="number" min="0" max="${esc(num(q.points))}" step="0.5" placeholder="الدرجة"> / ${esc(num(q.points))}
            <button class="btn sm primary" data-gr>حفظ</button><button class="btn sm ghost" data-full>كاملة</button><button class="btn sm ghost" data-zero>صفر</button></div></div>`).join('')}</div>`).join('')}</div></div>`;
    const acts = [];
    if (x.mine) {
      acts.push({ label: '🗑️ حذف', cls: 'ghost', onClick: async () => { if (!await confirmBox('حذف الاختبار؟', 'حذف')) return false; await call('ex_delete', { p_id: id }); toast('تم الحذف'); refresh(); } });
      acts.push({ label: '✏️ تعديل', cls: 'ghost', onClick: () => { setTimeout(() => editEx(x), 0); } });
      acts.push({ label: '📚 مشاركة في مكتبة المعلمين', cls: 'ghost', onClick: async () => { await call('lib_share', { p_kind: 'exam', p_id: id, p_note: null }); toast('شُورك الاختبار في «مكتبة معلمي دار الذكر» ✓'); return false; } });
    }
    acts.push({ label: '🖨️ طباعة النتائج', cls: 'ghost', onClick: (w) => { const t = $('[data-vp="r"] table', w); if (t) printTable(t, 'نتائج: ' + x.title); return false; } });
    acts.push({ label: 'إغلاق', cls: 'primary', onClick: () => { refresh(); } });
    modal({ title: '🧪 ' + x.title, wide: true, body, actions: acts });
    const w = $$('.modal-wrap').pop();
    $('#vTabs', w).onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; $$('#vTabs button', w).forEach((k) => k.classList.toggle('on', k === b)); $$('[data-vp]', w).forEach((p) => { p.hidden = p.dataset.vp !== b.dataset.v; }); };
    if ($('#rf', w)) $('#rf', w).onchange = (e) => { const f = e.target.value; $$('[data-vp="r"] tbody tr', w).forEach((tr) => { tr.hidden = !!f && tr.dataset.f !== f; }); };
    $('[data-vp="g"]', w).addEventListener('click', async (e) => {
      const b = e.target.closest('[data-gr],[data-full],[data-zero]'); if (!b) return;
      const box = b.closest('[data-q]'), inp = $('.sc', box);
      if (b.dataset.full !== undefined) inp.value = inp.max; if (b.dataset.zero !== undefined) inp.value = 0;
      if (inp.value === '') { toast('اكتب الدرجة', 'warn'); return; }
      try { await call('ex_grade', { p_attempt: +b.closest('[data-att]').dataset.att, p_qid: box.dataset.q, p_points: +inp.value });
        box.innerHTML = `<small class="hint">✓ صُحّح: ${esc(inp.value)} / ${esc(inp.max)}</small>`; toast('حُفظت الدرجة'); } catch (er) { toast(errMsg(er), 'err'); }
    });
  }

  // ---------------- الطالب ----------------
  async function drawStudent() {
    const pane = $('#tab-student'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('ex_list', { p_box: 'student' }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const st = (x) => x.my?.submitted ? 'done' : x.state === 'open' ? 'open' : x.state;
    const card = (x) => { const s = st(x);
      return `<button class="hw" data-ex="${x.id}" data-s="${s}"><b>${esc(x.title)}</b><small>${esc(x.subject || '')} · ${esc(x.teacher || '')}</small>
        <small>${esc(fmt(x.opens_at))} ← ${esc(fmt(x.closes_at))} · ${x.duration_min} دقيقة · ${x.n_questions} سؤال</small>
        <div class="row">${s === 'done' ? chip('graded', x.my.score != null ? `درجتك: ${num(x.my.score)} / ${num(x.max_score)}` : 'سلّمت') + (x.my.needs_review ? ' ' + chip('review', 'بعض الإجابات قيد التصحيح') : '')
          : s === 'open' ? chip('open', x.my?.started ? 'بدأته — أكمل الآن' : 'مفتوح — ابدأ الآن') : s === 'upcoming' ? chip('upcoming', 'يُفتح ' + fmt(x.opens_at)) : chip('closed', 'انتهى ولم تسلّم')}</div></button>`; };
    const now = L.filter((x) => st(x) === 'open'), up = L.filter((x) => st(x) === 'upcoming'), done = L.filter((x) => ['done', 'closed'].includes(st(x)));
    pane.innerHTML = L.length ? `${now.length ? `<h3 class="sec-h">متاح الآن (${now.length})</h3><div class="hw-list">${now.map(card).join('')}</div>` : '<div class="notice">لا يوجد اختبار مفتوح الآن.</div>'}
      ${up.length ? `<h3 class="sec-h">قادمة</h3><div class="hw-list">${up.map(card).join('')}</div>` : ''}
      ${done.length ? `<h3 class="sec-h">السابقة</h3><div class="hw-list">${done.map(card).join('')}</div>` : ''}`
      : '<div class="empty">لا توجد اختبارات لفصلك حتى الآن.</div>';
    pane.onclick = async (e) => { const c = e.target.closest('[data-ex]'); if (!c) return; const s = c.dataset.s, x = L.find((k) => k.id === +c.dataset.ex);
      if (s === 'open') { if (x.my?.started || await confirmBox(`سيبدأ المؤقت (${x.duration_min} دقيقة) بمجرد البدء ولا يمكن إيقافه. هل أنت مستعد؟`, 'ابدأ الاختبار')) take(x.id); }
      else if (s === 'done') result(x.id);
      else if (s === 'upcoming') toast('يُفتح الاختبار ' + fmt(x.opens_at), 'warn');
      else toast('انتهى وقت الاختبار', 'warn'); };
  }

  async function take(id) {
    const pane = $('#tab-student'); pane.innerHTML = '<div class="empty">جارٍ فتح الاختبار…</div>';
    let x; try { x = await call('ex_start', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); drawStudent(); return; }
    const skew = Date.now() - new Date(x.now).getTime();          // فرق ساعة الجهاز عن الخادم
    const deadline = new Date(x.deadline).getTime() + skew;
    const ans = Object.assign({}, x.answers || {});
    let dirty = false, saving = false, finished = false;
    pane.innerHTML = `<div class="take"><div class="timer glass"><span><b id="tLeft">--:--</b> <small class="hint">متبقٍ</small></span>
        <span class="hint" id="tSave">الإجابات تُحفظ تلقائيًا</span><span id="tCount"></span><button class="btn primary" id="tSubmit">📤 تسليم</button></div>
      <h2 style="margin:4px 0 6px">${esc(x.title)}</h2>${x.instructions ? `<p class="notice">${esc(x.instructions)}</p>` : ''}
      ${x.questions.map((q, i) => `<div class="q" data-q="${esc(q.id)}" data-t="${esc(q.qtype)}"${q.qtype === 'match' ? ' data-match="1"' : ''}><h4>${i + 1}. ${q.qtype === 'fill' ? '' : esc(q.body)} <small>(${esc(num(q.points))} درجة)</small></h4>${imgHTML(q.image)}
        ${q.qtype === 'short' ? `<textarea rows="2" maxlength="2000" style="width:100%" aria-label="إجابة السؤال ${i + 1}">${esc(ans[q.id] || '')}</textarea>`
          : q.qtype === 'essay' ? `<textarea rows="7" maxlength="8000" style="width:100%" aria-label="إجابة السؤال ${i + 1}">${esc(ans[q.id] || '')}</textarea>`
          : q.qtype === 'fill' ? (() => { let cur = []; try { cur = JSON.parse(ans[q.id] || '[]'); } catch (_) {}
            return `<div style="line-height:2.4">${(q.parts || []).map((t, k) => esc(t) + (k < q.parts.length - 1 ? `<input data-b="${k}" value="${esc(cur[k] || '')}" style="width:140px;margin:0 4px" aria-label="الفراغ ${k + 1}">` : '')).join('')}</div>`; })()
          : q.qtype === 'multi' ? (() => { const cur = String(ans[q.id] || '').split(','); return `<small class="hint">اختر كل الإجابات الصحيحة</small>` + q.options.map((o) => `<label class="opt"><input type="checkbox" value="${o.i}"${cur.includes(String(o.i)) ? ' checked' : ''}> ${esc(o.t)}</label>`).join(''); })()
          : q.qtype === 'order' ? (() => { const cur = ans[q.id] ? String(ans[q.id]).split(',') : q.options.map((o) => String(o.i)); const T = Object.fromEntries(q.options.map((o) => [String(o.i), o.t]));
            return `<small class="hint">رتّب العناصر بالأسهم ▲▼</small><ol class="ord">${cur.filter((k) => k in T).map((k) => `<li data-i="${k}" style="display:flex;gap:6px;align-items:center;margin:4px 0"><span class="grow">${esc(T[k])}</span><button type="button" class="btn sm ghost" data-up>▲</button><button type="button" class="btn sm ghost" data-dn>▼</button></li>`).join('')}</ol>`; })()
          : q.qtype === 'image' ? `<div><label class="btn sm" style="cursor:pointer">📷 تصوير / رفع صورة الحل<input type="file" accept="image/*" capture="environment" data-img hidden></label>
              <div data-prev>${ans[q.id] && /^data:image\//.test(ans[q.id]) ? `<img class="qimg" src="${esc(ans[q.id])}" alt="حلّك">` : '<small class="hint">لم تُرفع صورة بعد</small>'}</div></div>`
          : q.qtype === 'match' ? (() => { const cur = Object.fromEntries(String(ans[q.id] || '').split(',').filter(Boolean).map((kv) => kv.split(':')));
            return `<table class="mt">${(q.left || []).map((l) => `<tr><td><b>${esc(l.t)}</b></td><td><select data-k="${l.k}" aria-label="ما يقابل ${esc(l.t)}"><option value="">— اختر —</option>
              ${q.options.map((o) => `<option value="${o.i}"${String(cur[l.k]) === String(o.i) ? ' selected' : ''}>${esc(o.t)}</option>`).join('')}</select></td></tr>`).join('')}</table>`; })()
          : q.options.map((o) => `<label class="opt"><input type="radio" name="q${esc(q.id)}" value="${o.i}"${String(ans[q.id]) === String(o.i) ? ' checked' : ''}> ${esc(o.t)}</label>`).join('')}</div>`).join('')}
      <div style="text-align:center;margin:16px 0"><button class="btn primary" id="tSubmit2">📤 تسليم الاختبار</button></div></div>`;
    const count = () => { const n = x.questions.filter((q) => String(ans[q.id] ?? '').trim() !== '').length; $('#tCount').textContent = `أجبت ${n} من ${x.questions.length}`; return n; };
    count();
    const setOrder = (box) => { ans[box.dataset.q] = $$('.ord li', box).map((li) => li.dataset.i).join(','); dirty = true; count(); };
    pane.onclick = (e) => { const b = e.target.closest('[data-up],[data-dn]'); if (!b) return; const li = b.closest('li'), box = b.closest('[data-q]');
      if (b.dataset.up !== undefined && li.previousElementSibling) li.parentNode.insertBefore(li, li.previousElementSibling);
      if (b.dataset.dn !== undefined && li.nextElementSibling) li.parentNode.insertBefore(li.nextElementSibling, li);
      setOrder(box); };
    pane.oninput = pane.onchange = async (e) => { const box = e.target.closest('[data-q]'); if (!box) return; const t = box.dataset.t;
      if (t === 'image') { if (e.type !== 'change' || !e.target.files || !e.target.files[0]) return;
        try { const d = await readImg(e.target.files[0]); ans[box.dataset.q] = d; $('[data-prev]', box).innerHTML = `<img class="qimg" src="${d}" alt="حلّك">`; dirty = true; count(); save(); } catch (er) { toast(er.message, 'err'); } return; }
      if (t === 'multi') ans[box.dataset.q] = $$('input[type=checkbox]:checked', box).map((x) => x.value).join(',');
      else if (t === 'fill') { const v = $$('input[data-b]', box).map((x) => x.value.trim()); ans[box.dataset.q] = v.some(Boolean) ? JSON.stringify(v) : ''; }
      else ans[box.dataset.q] = box.dataset.match ? $$('select[data-k]', box).filter((x) => x.value !== '').map((x) => x.dataset.k + ':' + x.value).join(',') : e.target.value;
      dirty = true; count(); };
    const save = async () => { if (!dirty || saving || finished) return; saving = true; dirty = false;
      try { await call('ex_submit', { p_id: id, p_answers: ans, p_final: false }); $('#tSave').textContent = '✓ حُفظ ' + new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); }
      catch (e) { dirty = true; $('#tSave').textContent = '⚠️ تعذّر الحفظ — تحقق من الاتصال'; } finally { saving = false; } };
    const finish = async (auto) => {
      if (finished) return;
      if (!auto) { const left = x.questions.length - count(); if (!await confirmBox(left ? `لم تجب عن ${left} سؤال. تسليم نهائي؟` : 'تسليم الاختبار نهائيًا؟ لا يمكن التعديل بعده.', 'تسليم')) return; }
      finished = true; if (TIMER) { clearInterval(TIMER); TIMER = null; }
      try { const r = await call('ex_submit', { p_id: id, p_answers: ans, p_final: true });
        toast(auto ? 'انتهى الوقت وسُلّم الاختبار تلقائيًا' : 'تم التسليم ✓');
        if (r.score != null) toast(`درجتك: ${num(r.score)} / ${num(r.max)}${r.needs_review ? ' (بعض الإجابات قيد التصحيح)' : ''}`);
        result(id);
      } catch (e) { finished = false; toast(errMsg(e), 'err'); }
    };
    $('#tSubmit').onclick = () => finish(false); $('#tSubmit2').onclick = () => finish(false);
    let tick = 0;
    const loop = () => { const ms = deadline - Date.now();
      if (ms <= 0) { $('#tLeft').textContent = '00:00'; finish(true); return; }
      const s = Math.floor(ms / 1000); $('#tLeft').textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      $('.timer').classList.toggle('low', s < 120);
      if (++tick % 15 === 0) save(); };
    loop(); TIMER = setInterval(loop, 1000);
    window.addEventListener('beforeunload', (e) => { if (!finished && TIMER) { save(); e.preventDefault(); e.returnValue = ''; } });
    document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  }

  async function result(id) {
    const pane = $('#tab-student'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let r; try { r = await call('ex_my_result', { p_id: id }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const back = '<button class="btn ghost" id="rBack">→ رجوع للاختبارات</button>';
    if (r.hidden) { pane.innerHTML = `<div class="take">${back}<div class="notice" style="margin-top:10px">✅ سلّمت الاختبار في ${esc(fmt(r.submitted))}. سيعلن المعلم النتيجة لاحقًا.</div></div>`; }
    else {
      const anyCorrect = r.questions.some((q) => q.correct != null);
      pane.innerHTML = `<div class="take res">${back}<div class="glass" style="padding:14px;margin:10px 0;text-align:center"><div class="hint">درجتك</div>
        <b style="font-size:2rem">${esc(num(r.score))} / ${esc(num(r.max))}</b> <span class="hint">(${r.max ? Math.round(100 * r.score / r.max) : 0}%)</span>
        ${r.needs_review ? '<div class="hint">بعض الإجابات القصيرة قيد تصحيح المعلم وقد تتغير الدرجة.</div>' : ''}
        ${anyCorrect ? '' : '<div class="hint">ستظهر الإجابات الصحيحة بعد انتهاء موعد الاختبار لكل الطلاب.</div>'}</div>
        ${r.questions.map((q, i) => { const res = q.result || {}; const cls = res.manual && !res.graded ? 'man' : res.ok ? 'ok' : 'bad';
          if (q.qtype === 'match') { const pr = q.pairs; return `<div class="q ${res.ok ? 'ok' : res.nc ? 'man' : 'bad'}"><h4>${i + 1}. ${esc(q.body)} <small>(${esc(num(res.pts ?? 0))} / ${esc(num(q.points))})</small></h4>${imgHTML(q.image)}
            <div>أزواج صحيحة: <b>${res.nc ?? 0} من ${res.np ?? (pr ? pr.length : '?')}</b> ${res.ok ? '✅' : ''}</div>
            ${pr ? `<table class="mt">${pr.map((o) => `<tr><td>${esc(o.l)}</td><td>⟵⟶</td><td class="ok">${esc(o.r)}</td></tr>`).join('')}</table>` : ''}</div>`; }
          if (['multi', 'order', 'fill', 'essay', 'image'].includes(q.qtype)) {
            let mineH = '—';
            if (q.qtype === 'multi') mineH = esc(String(q.mine || '').split(',').filter(Boolean).map((k) => q.options?.[+k]).filter(Boolean).join('، ') || '—');
            if (q.qtype === 'order') mineH = esc(String(q.mine || '').split(',').filter(Boolean).map((k) => q.options?.[+k]).filter(Boolean).join(' ← ') || '—');
            if (q.qtype === 'fill') { let v = []; try { v = JSON.parse(q.mine || '[]'); } catch (_) {} mineH = esc(v.join('، ') || '—'); }
            if (q.qtype === 'essay') mineH = `<div style="white-space:pre-wrap">${esc(q.mine || '—')}</div>`;
            if (q.qtype === 'image') mineH = q.mine && /^data:image\//.test(q.mine) ? `<img class="qimg" src="${esc(q.mine)}" alt="حلّك">` : '—';
            const sol = q.solution ? (q.qtype === 'order' ? q.solution.join(' ← ') : q.solution.map((x) => String(x).split('|')[0]).join('، ')) : '';
            return `<div class="q ${cls}"><h4>${i + 1}. ${esc(q.qtype === 'fill' ? (q.body_view || q.body) : q.body)} <small>(${esc(num(res.pts ?? 0))} / ${esc(num(q.points))})</small></h4>${imgHTML(q.image)}
              <div>إجابتك: <b>${mineH}</b> ${cls === 'ok' ? '✅' : cls === 'man' ? '⏳' : res.nc ? `(${res.nc} من ${res.np})` : '❌'}</div>${sol && cls !== 'ok' ? `<div class="hint">الإجابة الصحيحة: ${esc(sol)}</div>` : ''}</div>`; }
          const mine = q.qtype === 'short' ? (q.mine || '—') : (q.options?.[+q.mine] ?? '—');
          const corr = q.correct == null ? '' : q.qtype === 'short' ? q.correct : q.options?.[+q.correct];
          return `<div class="q ${cls}"><h4>${i + 1}. ${esc(q.body)} <small>(${esc(num(res.pts ?? 0))} / ${esc(num(q.points))})</small></h4>${imgHTML(q.image)}
            <div>إجابتك: <b>${esc(mine)}</b> ${cls === 'ok' ? '✅' : cls === 'man' ? '⏳' : '❌'}</div>${corr && cls !== 'ok' ? `<div class="hint">الإجابة الصحيحة: ${esc(corr)}</div>` : ''}</div>`; }).join('')}</div>`;
    }
    $('#rBack').onclick = drawStudent;
  }

  // ---------------- متابعة (مشرف / مدير) ----------------
  async function drawAll() {
    const pane = $('#tab-all'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('ex_list', { p_box: 'all' }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!L.length) { pane.innerHTML = '<div class="empty">لم ينشئ معلموك اختبارات بعد.</div>'; return; }
    const by = {}; L.forEach((x) => { const o = by[x.teacher] = by[x.teacher] || { n: 0, stu: 0, sub: 0, avg: [] }; o.n++; o.stu += x.students; o.sub += x.submitted; if (x.avg != null) o.avg.push(x.avg); });
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="aQ" class="grow" type="search" placeholder="ابحث باسم المعلم أو المادة أو الفصل…"></div>
      <h3 class="sec-h">ملخص المعلمين</h3><div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>المعلم</th><th>الاختبارات</th><th>نسبة التسليم</th><th>متوسط الدرجات</th></tr></thead><tbody>
      ${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([t, o]) => `<tr><td>${esc(t)}</td><td>${o.n}</td><td>${o.stu ? Math.round(100 * o.sub / o.stu) + '%' : '—'}</td>
        <td>${o.avg.length ? Math.round(o.avg.reduce((a, b) => a + b, 0) / o.avg.length) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <h3 class="sec-h">كل الاختبارات</h3><div class="table-wrap"><table id="aT"><thead><tr><th>المعلم</th><th>العنوان</th><th>المادة</th><th>الفصول</th><th>الموعد</th><th>الحالة</th><th>سلّم</th><th>المتوسط</th><th></th></tr></thead><tbody>
      ${L.map((x) => `<tr><td>${esc(x.teacher)}</td><td>${esc(x.title)}</td><td>${esc(x.subject || '')}</td><td>${esc(x.classes.map(short).join('، '))}</td><td>${esc(fmt(x.opens_at))}</td>
        <td>${chip(x.state, STATE[x.state])}</td><td>${x.submitted} / ${x.students}</td><td>${x.avg != null ? x.avg + '%' : '—'}</td><td><button class="btn sm" data-ex="${x.id}">فتح</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#aQ').oninput = (e) => { const q = e.target.value.trim(); $$('#aT tbody tr').forEach((tr) => { tr.hidden = !!q && !LMS.has(tr.innerText, q); }); };
    pane.onclick = (e) => { const c = e.target.closest('[data-ex]'); if (c) teacherView(+c.dataset.ex); };
  }

  show((location.hash || '').slice(1) || (STUDENT ? 'student' : OPT.is_teacher ? 'mine' : 'all'));
})();
