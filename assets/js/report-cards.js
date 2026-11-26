/* =====================================================================
   الشهادات الفصلية (sql/67)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role;
  if (role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('reportcards', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  $('#tabs').style.display = 'none';

  if (role === 'student') {
    let L = [];
    try { L = await call('rc_my'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.length ? L.map((c, i) => `<div class="toolbar" style="justify-content:flex-end"><button class="btn sm" data-p="${i}">🖨️ طباعة / حفظ PDF</button></div>${RC.html(c)}`).join('')
      : '<div class="empty">لم تُنشر شهادات بعد.</div>';
    view.onclick = (e) => { const b = e.target.closest('[data-p]'); if (b) RC.print([L[+b.dataset.p]]); };
    return;
  }

  let STAGES = [];
  try { const { data } = await sb.from('stages').select('id,name_ar,sort').order('sort'); STAGES = data || []; } catch (e) { /* */ }

  async function listView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('rc_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const MGR = L.length ? L[0].manager : ['admin', 'leadership', 'principal'].includes(role) || /وكيل|كنترول|شؤون الطلاب/.test(ctx.profile.job_title || '');
    view.innerHTML = `${MGR ? '<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="new">＋ إصدار شهادات جديد</button><span class="grow"></span><span class="hint">الإصدار = فترة + مراحل؛ ثم تولّد الشهادات لكل الفصول</span></div>' : ''}
      ${L.map((i) => `<div class="glass rc-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(i.title)}</b>
          ${i.published ? '<span class="pill ok">✅ منشورة للطلاب وأولياء الأمور</span>' : '<span class="pill gold">غير منشورة</span>'}</div>
        <div class="hint">${esc(i.stages || '')} · من ${esc(i.from)} إلى ${esc(i.to)} · ${i.cards} شهادة مولّدة</div>
        <div class="acts"><button class="btn sm primary" data-open="${i.id}">📂 الفصول والشهادات</button>
          ${i.manager ? `<button class="btn sm" data-ed="${i.id}">✏️ الإعدادات</button>
          <button class="btn sm ${i.published ? 'ghost' : ''}" data-pub="${i.id}">${i.published ? '🙈 إلغاء النشر' : '📢 نشر'}</button>
          <button class="btn sm danger ghost" data-del="${i.id}">🗑</button>` : ''}</div></div>`).join('') ||
        `<div class="empty">${MGR ? 'لا توجد إصدارات بعد — اضغط «＋ إصدار شهادات جديد».' : 'لا توجد شهادات لفصولك بعد.'}</div>`}`;
    if ($('#new')) $('#new').onclick = () => issueForm(null);
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const i = L.find((x) => x.id === +(b.dataset.open || b.dataset.ed || b.dataset.pub || b.dataset.del));
      try {
        if (b.dataset.open) return classesView(i);
        if (b.dataset.ed) return issueForm(i);
        if (b.dataset.pub) { if (!i.published && !await confirmBox('نشر الشهادات؟ ستظهر لكل طالب في صفحته ولولي أمره في بوابة ولي الأمر.', 'نشر')) return;
          await call('rc_publish', { p_issue: i.id, p_on: !i.published }); toast(i.published ? 'أُلغي النشر' : 'نُشرت ✓'); return listView(); }
        if (b.dataset.del) { if (!await confirmBox('حذف الإصدار وكل شهاداته؟', 'حذف')) return; await call('rc_issue_delete', { p_id: i.id }); listView(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  function issueForm(i) {
    const D = i || { title: '', from: '', to: new Date().toISOString().slice(0, 10), stage_ids: [], show_att: true, show_bh: true,
      scale: [{ min: 90, label: 'ممتاز' }, { min: 80, label: 'جيد جدًا' }, { min: 70, label: 'جيد' }, { min: 60, label: 'مقبول' }, { min: 0, label: 'يحتاج إلى دعم' }] };
    modal({ title: i ? 'إعدادات الإصدار' : '＋ إصدار شهادات جديد', body: `
      <label class="f">العنوان *<input id="tt" value="${esc(D.title)}" placeholder="مثال: شهادة الفصل الدراسي الأول"></label>
      <div style="display:flex;gap:8px"><label class="f grow">من *<input type="date" id="fr" value="${esc(D.from)}"></label><label class="f grow">إلى *<input type="date" id="to" value="${esc(D.to)}"></label></div>
      <p class="hint" style="margin-top:0">تُحتسب كل الدرجات المرصودة بتاريخ داخل هذه الفترة (غير المخفية) بأوزانها في سجل الدرجات.</p>
      <label class="f">المراحل *</label><div style="display:flex;flex-wrap:wrap;gap:8px">${STAGES.map((s) => `<label class="chk" style="margin:0"><input type="checkbox" value="${s.id}" data-st ${D.stage_ids.includes(s.id) ? 'checked' : ''}> ${esc(s.name_ar)}</label>`).join('')}</div>
      <label class="chk"><input type="checkbox" id="sa" ${D.show_att ? 'checked' : ''}> إظهار ملخص الحضور</label>
      <label class="chk"><input type="checkbox" id="sbh" ${D.show_bh ? 'checked' : ''}> إظهار ملخص السلوك</label>
      <b>سلّم التقديرات</b> <small class="hint">(الحد الأدنى للنسبة ← التقدير)</small><div id="sc" style="margin-top:6px">${D.scale.map((s) => `<div class="sc-row"><input type="number" data-mn value="${s.min}" min="0" max="100"><input data-lb value="${esc(s.label)}"><button class="btn sm ghost" type="button" data-rm>✕</button></div>`).join('')}</div>
      <button class="btn sm ghost" type="button" id="addS">＋ تقدير</button>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const scale = $$('.sc-row', w).map((r) => ({ min: +$('[data-mn]', r).value, label: $('[data-lb]', r).value.trim() })).filter((s) => s.label);
        const id = await call('rc_issue_save', { p: { id: i ? i.id : null, title: $('#tt', w).value, from: $('#fr', w).value, to: $('#to', w).value,
          stage_ids: $$('[data-st]:checked', w).map((x) => +x.value), show_att: $('#sa', w).checked, show_bh: $('#sbh', w).checked, scale } });
        toast('حُفظ ✓'); if (!i) { const L = await call('rc_list'); const ni = L.find((x) => x.id === id); if (ni) { classesView(ni); return true; } } listView(); return true; } }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    w.addEventListener('click', (e) => {
      if (e.target.id === 'addS') $('#sc', w).insertAdjacentHTML('beforeend', '<div class="sc-row"><input type="number" data-mn value="0" min="0" max="100"><input data-lb><button class="btn sm ghost" type="button" data-rm>✕</button></div>');
      if (e.target.dataset.rm !== undefined) e.target.closest('.sc-row').remove();
    });
  }

  async function classesView(i) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let K = [];
    try { K = await call('rc_classes', { p_issue: i.id }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const MG = i.manager;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><button class="btn sm ghost" id="back">→ رجوع</button><b class="grow">${esc(i.title)}</b>
        ${MG ? '<button class="btn sm primary" id="genAll">⚙️ توليد/تحديث شهادات كل الفصول</button>' : ''}</div>
      <div id="pg" style="display:none"><div class="prog"><i></i></div><div class="hint" id="pgt"></div></div>
      ${MG ? '<p class="hint">التوليد يأخذ نسخة ثابتة من الدرجات الحالية؛ إذا عدّل المعلمون درجات لاحقًا أعد التوليد للفصل. ملاحظات رائد الفصل تبقى كما هي.</p>' : '<p class="hint">اكتب ملاحظاتك لطلاب فصلك، ثم يطبعها أو ينشرها المسؤول.</p>'}
      <div class="glass" style="padding:6px"><table class="cl"><thead><tr><th>الفصل</th><th>الطلاب</th><th>الشهادات</th><th>ملاحظات الرائد</th><th></th></tr></thead><tbody>
      ${K.map((k) => `<tr><td><b>${esc(k.label)}</b>${k.homeroom ? `<div class="hint">الرائد: ${esc(k.homeroom)}</div>` : ''}</td><td>${k.n}</td>
        <td data-cnt="${k.class_id}">${k.cards ? `<span class="pill ok">${k.cards}</span>` : '<span class="pill">—</span>'}</td><td>${k.notes}/${k.cards}</td>
        <td style="white-space:nowrap">${MG ? `<button class="btn sm" data-gen="${k.class_id}">⚙️ توليد</button>` : ''}
          <button class="btn sm primary" data-v="${k.class_id}" ${k.cards ? '' : 'disabled'}>📜 عرض وطباعة</button></td></tr>`).join('') || '<tr><td colspan="5" class="hint">لا توجد فصول ضمن نطاقك في هذا الإصدار.</td></tr>'}</tbody></table></div>`;
    $('#back').onclick = listView;
    const gen = async (cid) => { const n = await call('rc_generate', { p_issue: i.id, p_class: cid }); const c = $(`[data-cnt="${cid}"]`); if (c) c.innerHTML = `<span class="pill ok">${n}</span>`; const v = $(`[data-v="${cid}"]`); if (v) v.disabled = !n; return n; };
    if ($('#genAll')) $('#genAll').onclick = async (e) => {
      e.target.disabled = true; $('#pg').style.display = ''; let tot = 0, fail = 0;
      for (let x = 0; x < K.length; x++) {
        $('#pgt').textContent = `جارٍ توليد ${K[x].label} (${x + 1} من ${K.length})…`; $('.prog i').style.width = Math.round((x / K.length) * 100) + '%';
        try { tot += await gen(K[x].class_id); } catch (er) { fail++; }
      }
      $('.prog i').style.width = '100%'; $('#pgt').textContent = `✓ وُلّدت ${tot} شهادة${fail ? ` — تعذّر ${fail} فصل، أعد المحاولة له` : ''}`; e.target.disabled = false;
    };
    view.querySelector('tbody').onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.gen) { b.disabled = true; const n = await gen(+b.dataset.gen); toast(`وُلّدت ${n} شهادة ✓`); b.disabled = false; }
        if (b.dataset.v) cardsView(i, +b.dataset.v, K.find((k) => k.class_id === +b.dataset.v));
      } catch (er) { b.disabled = false; toast(errMsg(er), 'err'); }
    };
  }

  async function cardsView(i, cid, k) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let R;
    try { R = await call('rc_cards_get', { p_issue: i.id, p_class: cid }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const draw = () => {
      view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><button class="btn sm ghost" id="back">→ الفصول</button><b class="grow">${esc(k.label)} — ${R.cards.length} شهادة</b>
          <button class="btn sm primary" id="prAll">🖨️ طباعة الكل</button></div>
        ${R.cards.map((c, x) => `<div class="glass rc-card"><div class="toolbar" style="margin:0"><b class="grow">${esc(c.name)}</b><span class="pill gold">${c.avg != null ? c.avg + '% — ' + esc(c.label) : '—'}</span>
            <button class="btn sm ghost" data-show="${x}">👁️</button><button class="btn sm ghost" data-pr="${x}">🖨️</button></div>
          ${R.can_note ? `<label class="f" style="margin-top:6px">ملاحظة رائد الفصل<textarea rows="2" data-note="${x}" placeholder="مثال: طالب مجتهد، نوصي بالاستمرار في القراءة اليومية">${esc(c.note || '')}</textarea></label>` : ''}</div>`).join('')}`;
      $('#back').onclick = () => classesView(i);
      $('#prAll').onclick = () => RC.print(R.cards, R.issue);
      view.onclick = (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.pr) RC.print([R.cards[+b.dataset.pr]], R.issue);
        if (b.dataset.show) modal({ title: R.cards[+b.dataset.show].name, wide: true, body: RC.html(R.cards[+b.dataset.show], R.issue), actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }] });
      };
      view.onchange = async (e) => {
        const t = e.target; if (t.dataset.note === undefined) return; const c = R.cards[+t.dataset.note];
        try { await call('rc_note_set', { p_issue: i.id, p_student: c.id, p_note: t.value }); c.note = t.value; toast('حُفظت الملاحظة ✓'); } catch (er) { toast(errMsg(er), 'err'); }
      };
    };
    draw();
  }

  listView();
})();
