/* =====================================================================
   مكتبة المدرسة — مركز مصادر التعلم (sql/71)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (ctx.profile.role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('books', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const LIB = await call('bk_am').catch(() => false);
  const CST = { available: 'متاحة', loaned: 'معارة', lost: 'مفقودة', damaged: 'تالفة', withdrawn: 'مستبعدة' };

  const tabs = [['cat', '📚 الفهرس'], ['my', '📖 إعاراتي']].concat(LIB ? [['desk', '🔁 الإعارة والإرجاع'], ['late', '⏰ الإعارات'], ['inv', '📦 الجرد'], ['stats', '📊 الإحصاءات']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : (LIB ? 'desk' : 'cat');
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => ({ cat: catView, my: myView, desk: deskView, late: lateView, inv: invView, stats: statsView })[TAB]();
  const err = (e) => toast(errMsg(e), 'err');

  /* ---------- الفهرس ---------- */
  let F = { q: '', cat: '' };
  async function catView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><input id="q" type="search" class="grow" placeholder="ابحث بالعنوان أو المؤلف أو ISBN أو الباركود…" value="${esc(F.q)}">
      <select id="ct"><option value="">كل التصنيفات</option></select>${LIB ? '<button class="btn sm primary" id="add">＋ كتاب</button><label class="btn sm" style="cursor:pointer">📥 استيراد Excel<input type="file" id="imp" accept=".xlsx,.xls,.csv" hidden></label>' : ''}</div>
      <div id="res"><div class="empty">جارٍ التحميل…</div></div>`;
    let tm; const load = async () => {
      try { const R = await call('bk_search', { p_q: F.q || null, p_cat: F.cat || null, p_limit: 200 });
        const ct = $('#ct'); if (ct.options.length === 1) { ct.innerHTML += R.cats.map((c) => `<option>${esc(c)}</option>`).join(''); ct.value = F.cat; }
        $('#res').innerHTML = `<p class="hint">${R.total} عنوان في المكتبة${F.q || F.cat ? ` · ${R.rows.length} نتيجة` : ''}</p><div class="bk-grid">${R.rows.map((b) => `<div class="glass bk" data-b="${b.id}">
            <b>📕 ${esc(b.title)}</b><span class="hint">${esc(b.author || '')}${b.category ? ' · ' + esc(b.category) : ''}</span>
            <span>${b.available ? `<span class="pill ok">${b.available} متاحة</span>` : '<span class="pill bad">كلها معارة</span>'} <span class="pill">${b.copies} نسخة</span>${b.shelf ? ` <span class="pill">رف ${esc(b.shelf)}</span>` : ''}</span></div>`).join('')}</div>` ||
          '<div class="empty">لا نتائج.</div>';
      } catch (e) { $('#res').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; } };
    $('#q').oninput = (e) => { F.q = e.target.value; clearTimeout(tm); tm = setTimeout(load, 300); };
    $('#ct').onchange = (e) => { F.cat = e.target.value; load(); };
    if ($('#add')) $('#add').onclick = () => bookForm({});
    if ($('#imp')) $('#imp').onchange = importXlsx;
    $('#res').onclick = async (e) => { const c = e.target.closest('[data-b]'); if (!c) return; if (LIB) bookDetails(+c.dataset.b); };
    load();
  }
  function bookForm(b) {
    modal({ title: b.id ? 'تعديل الكتاب' : '＋ كتاب جديد', body: `<label class="f">العنوان *<input id="ti" value="${esc(b.title || '')}"></label>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><label class="f">المؤلف<input id="au" value="${esc(b.author || '')}"></label><label class="f">الناشر<input id="pb" value="${esc(b.publisher || '')}"></label>
        <label class="f">التصنيف<input id="ct" value="${esc(b.category || '')}" placeholder="قصص، علوم، دين…"></label><label class="f">ISBN<input id="is" value="${esc(b.isbn || '')}" dir="ltr"></label>
        <label class="f">سنة النشر<input id="yr" type="number" value="${b.pub_year || ''}"></label><label class="f">الرف<input id="sh" value="${esc(b.shelf || '')}"></label></div>
      <label class="f">${b.id ? 'إضافة نسخ جديدة' : 'عدد النسخ'}<input id="cp" type="number" min="0" max="100" value="${b.id ? 0 : 1}"></label>
      <label class="f">نبذة<textarea id="sm" rows="2">${esc(b.summary || '')}</textarea></label>
      <p class="hint">يُنشأ لكل نسخة باركود تلقائي (مثل B12-1) تطبعه وتلصقه على الكتاب.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const id = await call('bk_book_save', { p: { id: b.id || null, title: $('#ti', w).value, author: $('#au', w).value, publisher: $('#pb', w).value, category: $('#ct', w).value,
          isbn: $('#is', w).value, pub_year: $('#yr', w).value, shelf: $('#sh', w).value, copies: $('#cp', w).value, summary: $('#sm', w).value } });
        toast('حُفظ ✓'); setTimeout(() => bookDetails(id), 0); return true; } }] });
  }
  async function importXlsx(e) {
    const f = e.target.files[0]; if (!f) return;
    if (typeof XLSX === 'undefined') return toast('تعذر تحميل مكتبة Excel', 'err');
    let rows; try { const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }); } catch (_) { return toast('تعذّرت قراءة الملف', 'err'); }
    const pick = (r, ...ks) => { for (const k of Object.keys(r)) if (ks.some((x) => k.trim().toLowerCase().includes(x))) return String(r[k]).trim(); return ''; };
    const L = rows.map((r) => ({ title: pick(r, 'العنوان', 'عنوان', 'title', 'اسم الكتاب'), author: pick(r, 'المؤلف', 'author'), publisher: pick(r, 'الناشر', 'publisher'),
      category: pick(r, 'التصنيف', 'category', 'الفئة'), isbn: pick(r, 'isbn', 'ردمك'), pub_year: pick(r, 'سنة', 'year'), shelf: pick(r, 'الرف', 'shelf'), copies: pick(r, 'النسخ', 'عدد', 'copies') || 1 })).filter((r) => r.title);
    if (!L.length) return toast('لم أجد عمود «العنوان» في الملف', 'err');
    if (!await confirmBox(`استيراد ${L.length} كتاب؟ (الأعمدة: العنوان، المؤلف، الناشر، التصنيف، ISBN، سنة النشر، الرف، عدد النسخ)`, 'استيراد')) return;
    try { let n = 0; for (let i = 0; i < L.length; i += 200) n += await call('bk_import', { p_rows: L.slice(i, i + 200) }); toast(`استُورد ${n} كتاب ✓`); catView(); } catch (er) { err(er); }
  }
  async function bookDetails(id) {
    let B; try { B = await call('bk_book_get', { p_id: id }); } catch (e) { return err(e); }
    modal({ title: '📕 ' + B.title, wide: true, body: `<div class="hint">${esc(B.author || '')}${B.publisher ? ' · ' + esc(B.publisher) : ''}${B.category ? ' · ' + esc(B.category) : ''}${B.shelf ? ' · رف ' + esc(B.shelf) : ''}</div>
      <table class="t" style="margin-top:8px"><thead><tr><th>الباركود</th><th>الحالة</th><th>المستعير / الموعد</th><th></th></tr></thead><tbody>${B.copy_list.map((c) => `<tr><td dir="ltr" style="text-align:start"><b>${esc(c.barcode)}</b></td>
        <td>${CST[c.status]}${c.note ? `<div class="hint">${esc(c.note)}</div>` : ''}</td><td>${c.borrower ? esc(c.borrower) + ' · ' + esc(c.due_on) : '—'}</td>
        <td>${c.status !== 'loaned' ? `<select data-cs="${c.id}">${Object.entries(CST).filter(([k]) => k !== 'loaned').map(([k, v]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}</td></tr>`).join('')}</tbody></table>
      ${B.history.length ? `<details><summary class="hint">سجل الإعارة (${B.history.length})</summary><table class="t">${B.history.map((h) => `<tr><td>${esc(h.who)}</td><td dir="ltr">${esc(h.barcode)}</td><td>${esc(h.at.slice(0, 10))}</td><td>${h.returned ? 'أُرجع ' + esc(h.returned.slice(0, 10)) : '<b>معار</b>'}</td></tr>`).join('')}</table></details>` : ''}`,
      actions: [{ label: '🏷️ طباعة الباركودات', cls: 'ghost', onClick: () => { printLabels(B); return false; } }, { label: '✏️ تعديل', cls: 'ghost', onClick: () => { setTimeout(() => bookForm(B), 0); return true; } }, { label: 'إغلاق', value: null, cls: 'ghost' }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    w.addEventListener('change', async (e) => { const s = e.target.closest('[data-cs]'); if (!s) return; try { await call('bk_copy_set', { p_id: +s.dataset.cs, p_status: s.value }); toast('حُدّثت الحالة ✓'); } catch (er) { err(er); } });
  }
  // ملصقات باركود (Code 39 بخط SVG بسيط)
  function code39(txt) {
    const M = { 0: 'nnnwwnwnn', 1: 'wnnwnnnnw', 2: 'nnwwnnnnw', 3: 'wnwwnnnnn', 4: 'nnnwwnnnw', 5: 'wnnwwnnnn', 6: 'nnwwwnnnn', 7: 'nnnwnnwnw', 8: 'wnnwnnwnn', 9: 'nnwwnnwnn',
      A: 'wnnnnwnnw', B: 'nnwnnwnnw', '-': 'nwnnnnwnw', '*': 'nwnnwnwnn' };
    let x = 0, bars = ''; const s = '*' + txt.toUpperCase() + '*';
    for (const ch of s) { const p = M[ch] || M['-']; for (let i = 0; i < 9; i++) { const w = p[i] === 'w' ? 3 : 1; if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w}" height="40"/>`; x += w; } x += 1; }
    return `<svg viewBox="0 0 ${x} 40" width="${Math.min(220, x * 1.3)}" height="40" xmlns="http://www.w3.org/2000/svg">${bars}</svg>`;
  }
  function printLabels(B) {
    const html = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${B.copy_list.filter((c) => c.status !== 'withdrawn').map((c) => `<div style="border:1px dashed #999;padding:6px;text-align:center;font-size:11px">
      <div style="font-weight:700">${esc(B.title.slice(0, 40))}</div>${code39(c.barcode)}<div dir="ltr">${esc(c.barcode)}</div>${B.shelf ? `<div>رف ${esc(B.shelf)}</div>` : ''}</div>`).join('')}</div>`;
    if (window.RC) return RC.printHtml(html);
    const a = document.createElement('div'); a.id = 'printArea'; a.innerHTML = html; document.body.appendChild(a);
    const st = document.createElement('style'); st.textContent = '@media print{body>*:not(#printArea){display:none!important}}#printArea{display:none}@media print{#printArea{display:block}}'; document.head.appendChild(st);
    window.print(); setTimeout(() => { a.remove(); st.remove(); }, 500);
  }

  /* ---------- إعاراتي ---------- */
  async function myView() {
    let L = []; try { L = await call('bk_my'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.map((l) => `<div class="glass xc" style="border-inline-start:4px solid ${l.overdue ? '#c0392b' : l.returned_at ? '#ccc' : '#007B51'}"><b>📕 ${esc(l.title)}</b> <span class="hint">${esc(l.author || '')}</span>
        <div class="hint">استُعير ${esc(l.loaned_at.slice(0, 10))} · ${l.returned_at ? 'أُرجع ' + esc(l.returned_at.slice(0, 10)) : `موعد الإرجاع <b style="color:${l.overdue ? '#c0392b' : 'inherit'}">${esc(l.due_on)}</b>${l.overdue ? ' — متأخر، نرجو الإرجاع' : ''}`}</div></div>`).join('')
      || '<div class="empty">لا توجد إعارات.</div>';
  }

  /* ---------- مكتب الإعارة ---------- */
  let MODE = 'loan', WHO = null;
  function deskView() {
    view.innerHTML = `<div class="seg" style="margin-bottom:10px"><button data-m="loan" class="${MODE === 'loan' ? 'on' : ''}">📤 إعارة</button><button data-m="return" class="${MODE === 'return' ? 'on' : ''}">📥 إرجاع</button></div>
      <div class="row2"><div class="glass xc">${MODE === 'loan' ? `<label class="f">المستعير (طالب أو منسوب)<input id="pq" type="search" placeholder="ابحث بالاسم أو رقم الطالب…"></label>
          <div class="res" id="pr" style="max-height:220px;overflow:auto"></div><div id="who" class="hint" style="margin:6px 0">${WHO ? `المستعير: <b>${esc(WHO.name)}</b> (${esc(WHO.info || '')})` : 'اختر المستعير أولًا'}</div>
          <label class="f">مدة الإعارة<select id="dy"><option value="7">أسبوع</option><option value="14" selected>أسبوعان</option><option value="30">شهر</option></select></label>` : ''}
        <label class="f">امسح باركود النسخة أو اكتبه ثم Enter<input id="bc" class="scan" dir="ltr" autocomplete="off" placeholder="B12-1"></label><div id="fl"></div></div>
        <div class="glass xc"><b>سجل الجلسة</b><div id="log" class="hint"></div></div></div>`;
    $$('[data-m]').forEach((b) => { b.onclick = () => { MODE = b.dataset.m; deskView(); }; });
    const flash = (ok, t) => { $('#fl').innerHTML = `<div class="flash ${ok ? 'ok' : 'err'}">${esc(t)}</div>`; if (ok) $('#log').insertAdjacentHTML('afterbegin', `<div>✓ ${esc(t)}</div>`); };
    if ($('#pq')) { let tm; $('#pq').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => { try { const R = await call('bk_people', { p_q: e.target.value });
        $('#pr').innerHTML = R.map((p, i) => `<div data-i="${i}"><b>${esc(p.name)}</b> <small class="hint">${esc(p.info || '')}${p.open ? ' · ' + p.open + ' معار' : ''}</small></div>`).join('');
        $('#pr').onclick = (ev) => { const r = ev.target.closest('[data-i]'); if (!r) return; WHO = R[+r.dataset.i]; $('#who').innerHTML = `المستعير: <b>${esc(WHO.name)}</b> (${esc(WHO.info || '')})`; $('#pr').innerHTML = ''; $('#pq').value = ''; $('#bc').focus(); };
      } catch (er) { err(er); } }, 300); }; }
    $('#bc').onkeydown = async (e) => {
      if (e.key !== 'Enter') return; const v = e.target.value.trim(); if (!v) return; e.target.value = '';
      try {
        if (MODE === 'loan') { if (!WHO) return flash(false, 'اختر المستعير أولًا'); const r = await call('bk_loan', { p_barcode: v, p_borrower: WHO.id, p_days: +$('#dy').value }); flash(true, `أُعير «${r.title}» لـ ${WHO.name} حتى ${r.due_on}`); }
        else { const r = await call('bk_return', { p_barcode: v }); flash(true, `أُرجع «${r.title}» من ${r.who}${r.late_days ? ` — متأخر ${r.late_days} يوم` : ''}`); }
      } catch (er) { flash(false, errMsg(er)); }
    };
    setTimeout(() => (MODE === 'loan' && !WHO ? $('#pq') : $('#bc')).focus(), 50);
  }

  async function lateView() {
    let L = []; try { L = await call('bk_loans_open', { p_overdue: false }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const late = L.filter((l) => l.late > 0);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><b class="grow">${L.length} إعارة مفتوحة · <span style="color:#c0392b">${late.length} متأخرة</span></b>
        <button class="btn sm primary" id="rm" ${late.length ? '' : 'disabled'}>🔔 تذكير المتأخرين</button></div>
      <div class="glass" style="padding:6px"><table class="t"><thead><tr><th>الكتاب</th><th>المستعير</th><th>الإرجاع</th><th></th></tr></thead><tbody>
      ${L.map((l) => `<tr><td><b>${esc(l.title)}</b><div class="hint" dir="ltr" style="text-align:start">${esc(l.barcode)}</div></td><td>${esc(l.who)}<div class="hint">${esc(l.info || '')}</div></td>
        <td style="color:${l.late ? '#c0392b' : 'inherit'}">${esc(l.due_on)}${l.late ? `<div><b>متأخر ${l.late} يوم</b></div>` : ''}</td><td><button class="btn sm ghost" data-rn="${l.id}">⏩ تمديد أسبوع</button></td></tr>`).join('') || '<tr><td colspan="4" class="hint">لا إعارات مفتوحة.</td></tr>'}</tbody></table></div>`;
    $('#rm').onclick = async () => { try { const n = await call('bk_remind_overdue'); toast(`أُرسل التذكير لـ ${n} مستعير ✓`); } catch (er) { err(er); } };
    view.onclick = async (e) => { const b = e.target.closest('[data-rn]'); if (!b) return; try { const d = await call('bk_renew', { p_loan: +b.dataset.rn, p_days: 7 }); toast('مُدّد حتى ' + d); lateView(); } catch (er) { err(er); } };
  }

  async function invView(cur) {
    let L = []; try { L = await call('bk_inv_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const open = cur || L.find((i) => !i.closed_at);
    if (!open) {
      view.innerHTML = `<div class="glass xc"><b>بدء جرد جديد</b><p class="hint">امسح باركود كل نسخة موجودة على الرفوف؛ وفي النهاية يعرض النظام النسخ «المتاحة» التي لم تُمسح (المفقودة المحتملة).</p>
        <button class="btn primary sm" id="st">📦 بدء الجرد</button></div>${L.map((i) => `<div class="glass xc"><b>${esc(i.title)}</b><div class="hint">${esc(i.started_at.slice(0, 10))} · ${i.n} نسخة ممسوحة · أُغلق ${esc((i.closed_at || '').slice(0, 10))}</div></div>`).join('')}`;
      $('#st').onclick = async () => { try { const id = await call('bk_inv_start', { p_title: 'جرد ' + new Date().toISOString().slice(0, 10) }); invView({ id, title: 'جرد', n: 0 }); } catch (er) { err(er); } };
      return;
    }
    view.innerHTML = `<div class="row2"><div class="glass xc"><b>📦 ${esc(open.title)}</b><label class="f">امسح الباركود ثم Enter<input id="bc" class="scan" dir="ltr" autocomplete="off"></label><div id="fl"></div><div class="hint">ممسوح: <b id="cnt">${open.n}</b></div></div>
      <div class="glass xc"><button class="btn sm" id="rep">📋 تقرير النسخ غير الممسوحة</button><button class="btn sm danger ghost" id="cl">✅ إنهاء الجرد</button><div id="rp" style="margin-top:8px"></div></div></div>`;
    $('#bc').onkeydown = async (e) => { if (e.key !== 'Enter') return; const v = e.target.value.trim(); e.target.value = ''; if (!v) return;
      try { const r = await call('bk_inv_scan', { p_inv: open.id, p_barcode: v }); $('#fl').innerHTML = `<div class="flash ${r.ok ? 'ok' : 'err'}">${r.ok ? '✓ ' + esc(r.title) + (r.status !== 'available' ? ' (' + CST[r.status] + ')' : '') : esc(r.msg)}</div>`; if (r.ok) $('#cnt').textContent = r.n; } catch (er) { err(er); } };
    $('#rep').onclick = async () => { try { const R = await call('bk_inv_report', { p_inv: open.id });
      $('#rp').innerHTML = `<div class="hint">المتاح المتوقع ${R.expected} · ممسوح ${R.scanned} · معار ${R.loaned} · <b style="color:#c0392b">غير ممسوح ${R.missing.length}</b></div>
        <table class="t">${R.missing.slice(0, 300).map((m) => `<tr><td dir="ltr" style="text-align:start">${esc(m.barcode)}</td><td>${esc(m.title)}</td><td>${esc(m.shelf || '')}</td></tr>`).join('')}</table>`; } catch (er) { err(er); } };
    $('#cl').onclick = async () => { const lost = await confirmBox('إنهاء الجرد؟ هل تريد اعتبار النسخ غير الممسوحة «مفقودة»؟ (اضغط «اعتبارها مفقودة» أو أغلق النافذة لإنهاء الجرد دون تغيير)', 'اعتبارها مفقودة');
      try { const n = await call('bk_inv_close', { p_inv: open.id, p_mark_lost: !!lost }); toast(lost ? `أُغلق الجرد — ${n} نسخة سُجلت مفقودة` : 'أُغلق الجرد'); invView(); } catch (er) { err(er); } };
    setTimeout(() => $('#bc').focus(), 50);
  }

  async function statsView() {
    let S; try { S = await call('bk_stats'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div class="kpi4"><div class="glass card-box"><b>${S.books}</b>عنوان</div><div class="glass card-box"><b>${S.copies}</b>نسخة</div>
        <div class="glass card-box"><b>${S.loaned}</b>معار الآن</div><div class="glass card-box"><b style="color:#c0392b">${S.overdue}</b>متأخر</div></div>
      <p class="hint">إعارات هذا الشهر: <b>${S.month}</b></p>
      <div class="row2"><div class="glass xc"><b>📈 الأكثر إعارة (سنة)</b><table class="t">${S.top_books.map((x) => `<tr><td>${esc(x.title)}</td><td><b>${x.n}</b></td></tr>`).join('') || '<tr><td class="hint">—</td></tr>'}</table></div>
        <div class="glass xc"><b>🏆 أكثر الطلاب قراءة (سنة)</b><table class="t">${S.top_readers.map((x) => `<tr><td>${esc(x.name)}</td><td><b>${x.n}</b></td></tr>`).join('') || '<tr><td class="hint">—</td></tr>'}</table></div></div>`;
  }

  paint();
})();
