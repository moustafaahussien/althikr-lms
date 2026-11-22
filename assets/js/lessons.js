/* =====================================================================
   تحضير الدروس: المعلم يحضّر بقالب موحّد ← يرسل للاعتماد ← المشرف يعتمد أو يعيد بملاحظة
   الدوال: lp_options / lp_list / lp_get / lp_save / lp_submit / lp_unsubmit / lp_review / lp_delete / lp_copy (sql/33)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, printHTML, ymd } = LMS;
  await requireAuth(['admin', 'leadership', 'principal', 'supervisor', 'teacher', 'staff']);

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const ST = { draft: 'مسودة', submitted: 'بانتظار الاعتماد', approved: 'معتمد ✓', returned: 'مُعاد للتعديل' };
  const chip = (s) => `<span class="st ${esc(s)}">${esc(ST[s] || s)}</span>`;
  // قالب التحضير الموحّد
  const FIELDS = [
    ['objectives', 'الأهداف / نواتج التعلم', 'ما الذي سيتمكن منه الطالب في نهاية الدرس؟'],
    ['warmup', 'التهيئة', 'سؤال مثير، ربط بالخبرات السابقة، نشاط قصير…'],
    ['strategies', 'استراتيجيات التدريس', 'التعلم التعاوني، العصف الذهني، فكّر-زاوج-شارك…'],
    ['procedures', 'إجراءات الدرس وخطواته', 'تسلسل الأنشطة ودور المعلم والطالب والزمن التقريبي'],
    ['resources', 'الوسائل ومصادر التعلم', 'الكتاب، عرض تقديمي، فيديو، أدوات…'],
    ['differentiation', 'مراعاة الفروق الفردية', 'أنشطة للمتميزين وللطلاب المحتاجين للدعم'],
    ['assessment', 'التقويم', 'أسئلة التقويم البنائي والختامي وأدواته'],
    ['closure', 'الغلق', 'تلخيص، تذكرة خروج…'],
    ['homework', 'الواجب', ''],
    ['notes', 'ملاحظات', '']];
  const parseD = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sunday = (d) => addDays(d, -d.getDay());
  const fmtD = (s) => { const d = parseD(s); return `${DAYS[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`; };

  let OPT = { subjects: [], classes: [], can_review: false, is_teacher: false };
  try { OPT = await call('lp_options'); } catch (e) { $('#tab-mine').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
  const TABS = { mine: OPT.is_teacher || !OPT.can_review, review: OPT.can_review, all: OPT.can_review };
  Object.entries(TABS).forEach(([k, on]) => { $(`#tabs [data-tab="${k}"]`).hidden = !on; });

  let WEEK = sunday(new Date());
  const LOAD = { mine: drawMine, review: drawReview, all: drawAll };
  function show(tab) {
    if (!TABS[tab]) tab = Object.keys(TABS).find((k) => TABS[k]);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + tab));
    history.replaceState(null, '', '#' + tab);
    LOAD[tab]();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); };
  refreshBadge();
  show((location.hash || '').slice(1) || (OPT.is_teacher ? 'mine' : 'review'));

  async function refreshBadge() {
    if (!OPT.can_review) return;
    try { const n = (await call('lp_list', { p_box: 'review' })).length; const b = $('#revBadge'); b.hidden = !n; b.textContent = n; } catch (_) {}
  }

  // ---------------- تحاضيري: عرض أسبوعي ----------------
  async function drawMine() {
    const pane = $('#tab-mine');
    const from = ymd(WEEK), to = ymd(addDays(WEEK, 4));
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px">
        <div class="wk"><button class="btn sm" id="wPrev" aria-label="الأسبوع السابق">→</button>
          <b>الأسبوع: ${esc(fmtD(from))} — ${esc(fmtD(to))}</b>
          <button class="btn sm" id="wNext" aria-label="الأسبوع التالي">←</button><button class="btn sm ghost" id="wNow">هذا الأسبوع</button></div>
        <span class="grow"></span>
        ${OPT.is_teacher ? '<button class="btn primary" id="newLp">➕ تحضير جديد</button>' : ''}
      </div><div id="wk"><div class="empty">جارٍ التحميل…</div></div>`;
    $('#wPrev').onclick = () => { WEEK = addDays(WEEK, -7); drawMine(); };
    $('#wNext').onclick = () => { WEEK = addDays(WEEK, 7); drawMine(); };
    $('#wNow').onclick = () => { WEEK = sunday(new Date()); drawMine(); };
    if ($('#newLp')) $('#newLp').onclick = () => edit(null, ymd(new Date()));
    if (!OPT.is_teacher) { $('#wk').innerHTML = '<div class="empty">لا توجد مواد مسندة إليك، فلا يمكنك إنشاء تحضير.</div>'; return; }
    let L;
    try { L = await call('lp_list', { p_box: 'mine', p_from: from, p_to: to }); } catch (e) { $('#wk').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const today = ymd(new Date());
    $('#wk').innerHTML = `<div class="days">${[0, 1, 2, 3, 4].map((i) => { const d = ymd(addDays(WEEK, i)); const items = L.filter((x) => x.date === d);
      return `<div class="day glass${d === today ? ' today' : ''}"><h4>${esc(DAYS[i])} <small>${esc(fmtD(d).split(' ')[1])}</small>
          <button class="btn sm ghost" data-new="${d}" title="تحضير جديد لهذا اليوم" aria-label="تحضير جديد ليوم ${esc(DAYS[i])}">＋</button></h4>
        ${items.map(card).join('') || '<div class="hint">لا يوجد تحضير</div>'}</div>`; }).join('')}</div>`;
    $('#wk').onclick = (e) => { const n = e.target.closest('[data-new]'); if (n) return edit(null, n.dataset.new);
      const c = e.target.closest('[data-lp]'); if (c) view(+c.dataset.lp); };
  }
  const card = (x, who) => `<button class="lp" data-lp="${x.id}"><b>${esc(x.title)}</b>
    <small>${who ? esc(x.teacher) + ' · ' : ''}${esc(x.subject || '')}${x.classes.length ? ' · ' + esc(x.classes.map((c) => c.split(' — ')[0]).join('، ')) : ''}</small>${chip(x.status)}</button>`;

  // ---------------- بانتظار اعتمادي ----------------
  async function drawReview() {
    const pane = $('#tab-review'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('lp_list', { p_box: 'review' }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    pane.innerHTML = L.length ? `<p class="hint">تحاضير أرسلها معلموك وتنتظر اعتمادك — افتح التحضير لاعتماده أو إعادته بملاحظاتك.</p>
      <div class="days">${L.map((x) => `<div>${card(x, true)}<small class="hint">ليوم ${esc(fmtD(x.date))}</small></div>`).join('')}</div>`
      : '<div class="empty">🎉 لا توجد تحاضير بانتظار اعتمادك.</div>';
    pane.onclick = (e) => { const c = e.target.closest('[data-lp]'); if (c) view(+c.dataset.lp); };
  }

  // ---------------- متابعة التحاضير ----------------
  let FLT = { from: ymd(addDays(sunday(new Date()), -7)), to: ymd(addDays(sunday(new Date()), 11)), status: '', teacher: '' };
  async function drawAll() {
    const pane = $('#tab-all');
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px">
        <label class="hint">من <input type="date" id="fFrom" value="${esc(FLT.from)}"></label>
        <label class="hint">إلى <input type="date" id="fTo" value="${esc(FLT.to)}"></label>
        <select id="fSt"><option value="">كل الحالات</option>${['submitted', 'approved', 'returned'].map((s) => `<option value="${s}"${FLT.status === s ? ' selected' : ''}>${ST[s]}</option>`).join('')}</select>
        <input id="fQ" class="grow" type="search" placeholder="ابحث باسم المعلم أو المادة أو العنوان…" value="${esc(FLT.q || '')}">
      </div><div id="allList"><div class="empty">جارٍ التحميل…</div></div>`;
    const reload = () => { FLT = { from: $('#fFrom').value, to: $('#fTo').value, status: $('#fSt').value, q: $('#fQ').value }; drawAll(); };
    $('#fFrom').onchange = reload; $('#fTo').onchange = reload; $('#fSt').onchange = reload;
    let L; try { L = await call('lp_list', { p_box: 'all', p_from: FLT.from || null, p_to: FLT.to || null, p_status: FLT.status || null }); }
    catch (e) { $('#allList').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const paint = () => {
      const q = ($('#fQ').value || '').trim(); const R = L.filter((x) => !q || [x.teacher, x.subject, x.title, ...x.classes].join(' ').includes(q));
      // ملخص لكل معلم
      const by = {}; R.forEach((x) => { const o = by[x.teacher] = by[x.teacher] || { n: 0, ok: 0, wait: 0, ret: 0 }; o.n++; o[x.status === 'approved' ? 'ok' : x.status === 'submitted' ? 'wait' : 'ret']++; });
      $('#allList').innerHTML = R.length ? `<div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>المعلم</th><th>عدد التحاضير</th><th>معتمد</th><th>بانتظار الاعتماد</th><th>مُعاد</th></tr></thead><tbody>
          ${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([t, o]) => `<tr><td>${esc(t)}</td><td>${o.n}</td><td>${o.ok}</td><td>${o.wait}</td><td>${o.ret}</td></tr>`).join('')}</tbody></table></div>
        <div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>المعلم</th><th>المادة</th><th>العنوان</th><th>الفصول</th><th>الحالة</th><th></th></tr></thead><tbody>
          ${R.map((x) => `<tr><td>${esc(fmtD(x.date))}</td><td>${esc(x.teacher)}</td><td>${esc(x.subject || '')}</td><td>${esc(x.title)}</td>
            <td>${esc(x.classes.map((c) => c.split(' — ')[0]).join('، '))}</td><td>${chip(x.status)}</td><td><button class="btn sm" data-lp="${x.id}">فتح</button></td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">لا توجد تحاضير مرسلة في هذه الفترة.</div>';
    };
    paint(); $('#fQ').oninput = paint;
    $('#allList').onclick = (e) => { const c = e.target.closest('[data-lp]'); if (c) view(+c.dataset.lp); };
  }

  // ---------------- عرض التحضير ----------------
  const bodyHTML = (x) => `<div class="lpv"><div class="meta">${chip(x.status)}<span class="chip gray">${esc(fmtD(x.date))}</span>
      ${x.subject ? `<span class="chip teal">${esc(x.subject)}</span>` : ''}${x.classes.map((c) => `<span class="chip gray">${esc(c)}</span>`).join('')}</div>
    ${x.mine ? '' : `<div class="hint">المعلم: <b>${esc(x.teacher)}</b></div>`}
    ${x.note ? `<div class="note-box${x.status === 'returned' ? ' ret' : ''}"><b>${x.status === 'returned' ? '↩️ ملاحظات الإعادة' : '💬 ملاحظة المعتمِد'}</b> — ${esc(x.reviewer || '')}<br>${esc(x.note)}</div>`
      : x.status === 'approved' && x.reviewer ? `<div class="hint">اعتمده: ${esc(x.reviewer)}</div>` : ''}
    ${FIELDS.filter(([k]) => (x.content || {})[k]).map(([k, l]) => `<h5>${esc(l)}</h5><p>${esc(x.content[k])}</p>`).join('') || '<p class="hint">لا يوجد محتوى.</p>'}</div>`;
  async function view(id) {
    let x; try { x = await call('lp_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const A = [];
    if (x.can_review) {
      A.push({ label: '↩️ إعادة للتعديل', cls: 'ghost', onClick: async (w) => { const n = $('#rvNote', w).value.trim(); if (!n) { toast('اكتب ملاحظاتك للمعلم عند الإعادة', 'warn'); return false; }
        await call('lp_review', { p_id: id, p_decision: 'return', p_note: n }); toast('أُعيد التحضير للمعلم'); after(); } });
      A.push({ label: '✓ اعتماد', cls: 'primary', onClick: async (w) => { await call('lp_review', { p_id: id, p_decision: 'approve', p_note: $('#rvNote', w).value.trim() || null }); toast('تم الاعتماد'); after(); } });
    }
    if (x.can_edit) {
      A.push({ label: '🗑️ حذف', cls: 'ghost', onClick: async () => { if (!await confirmBox('حذف هذا التحضير نهائيًا؟', 'حذف')) return false; await call('lp_delete', { p_id: id }); toast('تم الحذف'); after(); } });
      A.push({ label: '✏️ تعديل', cls: 'ghost', onClick: () => { setTimeout(() => edit(x), 0); } });
      A.push({ label: '📤 إرسال للاعتماد', cls: 'primary', onClick: async () => { await call('lp_submit', { p_id: id }); toast('أُرسل للاعتماد'); after(); } });
    }
    if (x.mine && x.status === 'submitted') A.push({ label: '↩️ سحب من الاعتماد', cls: 'ghost', onClick: async () => { await call('lp_unsubmit', { p_id: id }); toast('سُحب التحضير وأصبح مسودة'); after(); } });
    if (x.mine) A.push({ label: '📄 نسخ لتاريخ آخر', cls: 'ghost', onClick: () => { setTimeout(() => copyDlg(x), 0); } });
    A.push({ label: '🖨️ طباعة', cls: 'ghost', onClick: () => { printHTML('تحضير درس: ' + x.title, bodyHTML(x) + PRINT_STYLE); return false; } });
    modal({ title: x.title, wide: true, body: bodyHTML(x) + (x.can_review ? `<label class="f" style="margin-top:12px">ملاحظاتك للمعلم (مطلوبة عند الإعادة)<textarea id="rvNote" rows="3"></textarea></label>` : ''), actions: A });
  }
  const PRINT_STYLE = '<style>.st,.chip{border:1px solid #ccc;border-radius:99px;padding:1px 8px;margin-left:4px;font-size:12px}.lpv h5{margin:14px 0 4px;color:#0f6e6a}.lpv p{white-space:pre-wrap;margin:0;line-height:1.8}.note-box{border:1px solid #ddd;padding:6px 10px;border-radius:8px;margin:8px 0}</style>';
  function after() { refreshBadge(); const t = ($('#tabs button.on') || {}).dataset; if (t) LOAD[t.tab](); }

  function copyDlg(x) {
    modal({ title: 'نسخ التحضير', body: `<p class="hint">تُنشأ نسخة جديدة كمسودة بنفس المحتوى والفصول، ويمكنك تعديلها قبل الإرسال.</p>
        <label class="f">التاريخ الجديد<input type="date" id="cpD" value="${esc(ymd(addDays(parseD(x.date), 7)))}"></label>`,
      actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: 'نسخ', cls: 'primary', onClick: async (w) => {
        const d = $('#cpD', w).value; if (!d) { toast('اختر التاريخ', 'warn'); return false; }
        const r = await call('lp_copy', { p_id: x.id, p_date: d }); toast('تم إنشاء النسخة'); WEEK = sunday(parseD(d)); show('mine'); setTimeout(() => view(r.id), 300); } }] });
  }

  // ---------------- إنشاء / تعديل ----------------
  function edit(x, date) {
    x = x || { title: '', date: date || ymd(new Date()), subject_id: OPT.subjects.length === 1 ? OPT.subjects[0].id : null, class_ids: [], content: {} };
    const C = x.content || {};
    const subOpts = OPT.subjects.map((s) => `<option value="${s.id}"${s.id === x.subject_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    const body = `<div class="form-grid ed">
        <label class="f full">عنوان الدرس *<input id="eT" maxlength="200" value="${esc(x.title)}" placeholder="مثال: جمع الكسور العشرية"></label>
        <label class="f">تاريخ الدرس *<input type="date" id="eD" value="${esc(x.date)}"></label>
        <label class="f">المادة<select id="eS"><option value="">—</option>${subOpts}</select></label>
        <div class="f full"><span>الفصول</span><div class="cls-pick" id="eC"></div></div>
        ${FIELDS.map(([k, l, ph]) => `<label class="f full">${esc(l)}<textarea data-k="${k}" rows="${['procedures', 'objectives'].includes(k) ? 4 : 2}" placeholder="${esc(ph)}">${esc(C[k] || '')}</textarea></label>`).join('')}
      </div>`;
    const paintCls = (w) => { const sid = +$('#eS', w).value || null; const sel = new Set($$('#eC input:checked', w).map((i) => +i.value).concat(paintCls.init || []));
      paintCls.init = null;
      const L = OPT.classes.filter((c) => !sid || (c.subjects || []).includes(sid));
      $('#eC', w).innerHTML = L.map((c) => `<label><input type="checkbox" value="${c.id}"${sel.has(c.id) ? ' checked' : ''}> ${esc(c.label.split(' — ')[0])}<small class="hint"> ${esc(c.label.split(' — ')[1] || '')}</small></label>`).join('') || '<span class="hint">لا توجد فصول لهذه المادة</span>'; };
    paintCls.init = x.class_ids || [];
    const collect = (w) => ({ id: x.id || null, title: $('#eT', w).value.trim(), date: $('#eD', w).value, subject_id: +$('#eS', w).value || null,
      class_ids: $$('#eC input:checked', w).map((i) => +i.value),
      content: Object.fromEntries($$('textarea[data-k]', w).map((t) => [t.dataset.k, t.value.trim()]).filter(([, v]) => v)) });
    const save = async (w, submit) => { const p = collect(w);
      if (!p.title) { toast('اكتب عنوان الدرس', 'warn'); return false; } if (!p.date) { toast('اختر تاريخ الدرس', 'warn'); return false; }
      const r = await call('lp_save', { p }); if (submit) await call('lp_submit', { p_id: r.id });
      toast(submit ? 'حُفظ وأُرسل للاعتماد' : 'حُفظ كمسودة'); WEEK = sunday(parseD(p.date)); show('mine'); };
    const p = modal({ title: x.id ? 'تعديل التحضير' : 'تحضير جديد', wide: true, body,
      actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: '💾 حفظ كمسودة', cls: 'ghost', onClick: (w) => save(w, false) }, { label: '📤 حفظ وإرسال للاعتماد', cls: 'primary', onClick: (w) => save(w, true) }] });
    const w = $$('.modal-wrap').pop(); paintCls(w); $('#eS', w).onchange = () => paintCls(w);
    return p;
  }
})();
