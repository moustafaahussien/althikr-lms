/* =====================================================================
   الواجبات: المعلم ينشئ ويصحّح، الطالب يسلّم، المشرف يتابع
   الدوال: hw_options / hw_list / hw_get / hw_save / hw_close / hw_delete / hw_submit / hw_grade (sql/34)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, printTable } = LMS;
  await requireAuth();

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'short', day: 'numeric', month: 'numeric' }) + ' ' + d.toLocaleTimeString('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' }); };
  const num = (v) => (v == null ? '' : String(+v));
  const past = (t) => new Date(t) < new Date();
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#');
  const linksHTML = (L) => (L || []).length ? `<div class="links">${L.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.title || l.url)}</a>`).join('')}</div>` : '';
  const short = (c) => String(c).split(' — ')[0];
  const ST = { none: 'لم يُسلَّم', submitted: 'سُلِّم — بانتظار التصحيح', graded: 'مُصحَّح', returned: 'مُعاد للتعديل' };
  const PER = { p1: 'الفترة الأولى', p2: 'الفترة الثانية', mid: 'منتصف الفصل', final: 'نهاية العام' };
  const perSel = (v) => `<option value="">— غير محدد —</option>${Object.entries(PER).map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}`;
  const chip = (s, extra) => `<span class="st ${esc(s)}">${esc(extra || ST[s] || s)}</span>`;

  let OPT = { is_teacher: false, can_follow: false, classes: [], subjects: [], role: '' };
  try { OPT = await call('hw_options'); } catch (e) { $('#main').insertAdjacentHTML('beforeend', `<div class="notice err">${esc(errMsg(e))}</div>`); return; }
  const STUDENT = OPT.role === 'student';
  const TABS = { mine: !STUDENT && (OPT.is_teacher || !OPT.can_follow), student: STUDENT, all: !STUDENT && OPT.can_follow };
  Object.entries(TABS).forEach(([k, on]) => { $(`#tabs [data-tab="${k}"]`).hidden = !on; });

  const LOAD = { mine: drawMine, student: drawStudent, all: drawAll };
  function show(tab) {
    if (!TABS[tab]) tab = Object.keys(TABS).find((k) => TABS[k]);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + tab));
    history.replaceState(null, '', '#' + tab);
    LOAD[tab]();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); };
  const current = () => ($('#tabs button.on') || {}).dataset?.tab;
  const refresh = () => { const t = current(); if (t) LOAD[t](); };

  // ---------------- المعلم: واجباتي ----------------
  async function drawMine() {
    const pane = $('#tab-mine');
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px"><span class="hint grow">واجباتك لكل فصولك — اضغط الواجب لعرض التسليمات والتصحيح.</span>
      ${OPT.is_teacher ? '<button class="btn primary" id="newHw">➕ واجب جديد</button>' : ''}</div><div id="mineList"><div class="empty">جارٍ التحميل…</div></div>`;
    if ($('#newHw')) $('#newHw').onclick = () => edit(null);
    if (!OPT.is_teacher) { $('#mineList').innerHTML = '<div class="empty">لا توجد مواد مسندة إليك، فلا يمكنك إنشاء واجبات.</div>'; return; }
    let L; try { L = await call('hw_list', { p_box: 'mine' }); } catch (e) { $('#mineList').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const open = L.filter((x) => !x.closed && !past(x.due_at)), done = L.filter((x) => x.closed || past(x.due_at));
    const cardT = (x) => { const pct = x.students ? Math.round(100 * x.submitted / x.students) : 0;
      return `<button class="hw" data-hw="${x.id}"><b>${esc(x.title)}</b><small>${esc(x.subject || '')} · ${esc(x.classes.map(short).join('، '))}</small>
        <small>التسليم: ${esc(fmt(x.due_at))}</small><div class="prog" title="${pct}%"><i style="width:${pct}%"></i></div>
        <div class="row"><small>سلّم ${x.submitted} من ${x.students} · صُحّح ${x.graded}${x.avg != null ? ` · المتوسط ${x.avg}%` : ''}</small>${x.closed ? chip('closed', 'مغلق') : ''}</div></button>`; };
    $('#mineList').innerHTML = L.length ? `${open.length ? `<h3 class="sec-h">الواجبات الجارية</h3><div class="hw-list">${open.map(cardT).join('')}</div>` : ''}
      ${done.length ? `<h3 class="sec-h">انتهى موعدها</h3><div class="hw-list">${done.map(cardT).join('')}</div>` : ''}`
      : '<div class="empty">لم تنشئ واجبات بعد — ابدأ بـ «واجب جديد».</div>';
    $('#mineList').onclick = (e) => { const c = e.target.closest('[data-hw]'); if (c) teacherView(+c.dataset.hw); };
  }

  // عرض واجب للمعلم/المتابع: التعليمات + قائمة الطلاب والتسليمات + التصحيح
  async function teacherView(id) {
    let x; try { x = await call('hw_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const R = x.roster || [];
    const sub = R.filter((r) => r.sub && r.sub.status !== 'graded' && r.sub.at).length;
    const body = `<div class="hwv"><div class="meta" style="display:flex;flex-wrap:wrap;gap:6px">
        <span class="chip gray">التسليم: ${esc(fmt(x.due_at))}</span><span class="chip teal">${esc(x.subject || '')}</span>
        <span class="chip gray">الدرجة من ${esc(num(x.max_score))}</span>${x.period ? `<span class="chip gray">${esc(PER[x.period])}</span>` : ''}${x.closed ? chip('closed', 'مغلق') : ''}${x.allow_late ? '' : '<span class="chip pink">لا يُقبل التأخير</span>'}
        ${x.mine ? '' : `<span class="chip gray">المعلم: ${esc(x.teacher)}</span>`}</div>
      ${x.instructions ? `<p>${esc(x.instructions)}</p>` : ''}${linksHTML(x.links)}
      <div class="toolbar" style="margin-top:10px"><b class="grow">الطلاب (${R.length}) — سلّم ${R.filter((r) => r.sub && r.sub.at).length}، بانتظار التصحيح ${sub}</b>
        <select id="rf"><option value="">الكل</option><option value="wait">بانتظار التصحيح</option><option value="none">لم يسلّم</option><option value="graded">مصحّح</option></select></div>
      ${R.length ? `<div class="table-wrap ros" id="rosWrap"><table><thead><tr><th>الطالب</th><th>الفصل</th><th>الحالة</th><th>الإجابة</th>${x.mine ? '<th>الدرجة</th><th>ملاحظة</th><th></th>' : '<th>الدرجة</th>'}</tr></thead><tbody>
        ${R.map((r) => { const s = r.sub || {}; const st = s.status || 'none';
          return `<tr data-st="${esc(r.student)}" data-f="${st === 'submitted' ? 'wait' : st === 'graded' ? 'graded' : st === 'none' ? 'none' : 'wait'}">
            <td>${esc(r.name)}</td><td>${esc(r.class)}</td><td>${chip(st)}${s.late ? ' ' + chip('late', 'متأخر') : ''}${s.at ? `<br><small class="hint">${esc(fmt(s.at))}</small>` : ''}</td>
            <td class="ans">${esc(s.body || '')}${linksHTML(s.links)}</td>
            ${x.mine ? `<td><input class="sc" type="number" min="0" max="${esc(num(x.max_score))}" step="0.5" value="${esc(num(s.score))}" aria-label="درجة ${esc(r.name)}"></td>
              <td><input class="fbk" value="${esc(s.feedback || '')}" placeholder="ملاحظة للطالب" aria-label="ملاحظة لـ ${esc(r.name)}"></td>
              <td style="white-space:nowrap"><button class="btn sm primary" data-g="grade">حفظ</button>${s.at && st !== 'graded' ? ' <button class="btn sm ghost" data-g="return" title="إعادة التسليم للطالب لتعديله">↩️</button>' : ''}</td>`
              : `<td>${s.score != null ? esc(num(s.score)) + ' / ' + esc(num(x.max_score)) : ''}</td>`}</tr>`; }).join('')}
        </tbody></table></div>` : '<div class="notice">لا يوجد طلاب مربوطون بهذه الفصول في المنصة بعد.</div>'}</div>`;
    const A = [];
    if (x.mine) {
      A.push({ label: '🗑️ حذف', cls: 'ghost', onClick: async () => { if (!await confirmBox('حذف الواجب وكل تسليماته؟', 'حذف')) return false; await call('hw_delete', { p_id: id }); toast('تم الحذف'); refresh(); } });
      A.push({ label: x.closed ? '🔓 إعادة فتح' : '🔒 إغلاق التسليم', cls: 'ghost', onClick: async () => { await call('hw_close', { p_id: id, p_closed: !x.closed }); toast(x.closed ? 'أُعيد فتح الواجب' : 'أُغلق التسليم'); refresh(); } });
      A.push({ label: '✏️ تعديل', cls: 'ghost', onClick: () => { setTimeout(() => edit(x), 0); } });
      A.push({ label: '📚 مشاركة في مكتبة المعلمين', cls: 'ghost', onClick: async () => { await call('lib_share', { p_kind: 'hw', p_id: id, p_note: null }); toast('شُورك الواجب في «مكتبة معلمي دار الذكر» ✓'); return false; } });
    }
    A.push({ label: '🖨️ طباعة', cls: 'ghost', onClick: (w) => { const t = $('table', w); if (t) printTable(t, 'واجب: ' + x.title); return false; } });
    A.push({ label: 'إغلاق', cls: 'primary', onClick: () => { refresh(); } });
    modal({ title: '📝 ' + x.title, wide: true, body, actions: A });
    const w = $$('.modal-wrap').pop();
    $('#rf', w).onchange = (e) => { const f = e.target.value; $$('tbody tr', w).forEach((tr) => { tr.hidden = !!f && tr.dataset.f !== f; }); };
    if (x.mine) $('#rosWrap', w)?.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-g]'); if (!b) return; const tr = b.closest('tr');
      const sc = $('.sc', tr).value, fb = $('.fbk', tr).value.trim();
      try {
        if (b.dataset.g === 'grade') { if (sc === '') { toast('اكتب الدرجة', 'warn'); return; }
          await call('hw_grade', { p_id: id, p_student: tr.dataset.st, p_action: 'grade', p_score: +sc, p_feedback: fb || null });
          tr.cells[2].innerHTML = chip('graded'); b.nextElementSibling?.remove(); tr.dataset.f = 'graded'; toast('حُفظت الدرجة');
        } else { if (!fb) { toast('اكتب ملاحظتك للطالب في خانة الملاحظة قبل الإعادة', 'warn'); return; }
          await call('hw_grade', { p_id: id, p_student: tr.dataset.st, p_action: 'return', p_feedback: fb }); tr.cells[2].innerHTML = chip('returned'); b.remove(); toast('أُعيد للطالب'); }
      } catch (er) { toast(errMsg(er), 'err'); }
    });
  }

  // ---------------- إنشاء / تعديل واجب ----------------
  const localDT = (t) => { const d = t ? new Date(t) : (() => { const x = new Date(); x.setDate(x.getDate() + 2); x.setHours(23, 59, 0, 0); return x; })();
    const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  function edit(x) {
    x = x || { title: '', instructions: '', links: [], due_at: null, max_score: 10, allow_late: true, class_ids: [], subject_id: OPT.subjects.length === 1 ? OPT.subjects[0].id : null };
    const body = `<div class="form-grid">
      <label class="f" style="grid-column:1/-1">عنوان الواجب *<input id="hT" maxlength="200" value="${esc(x.title)}" placeholder="مثال: تمارين صفحة 54"></label>
      <label class="f">المادة<select id="hS"><option value="">—</option>${OPT.subjects.map((s) => `<option value="${s.id}"${s.id === x.subject_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <label class="f">موعد التسليم *<input type="datetime-local" id="hD" value="${esc(localDT(x.due_at))}"></label>
      <label class="f">الدرجة العظمى<input type="number" id="hM" min="1" max="1000" step="0.5" value="${esc(num(x.max_score))}"></label>
      <label class="f">فترة التقويم (لسجل الدرجات)<select id="hP">${perSel(x.period || localStorage.getItem('lms_per') || '')}</select></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="hL"${x.allow_late ? ' checked' : ''}> قبول التسليم المتأخر</label>
      <div class="f" style="grid-column:1/-1"><span>الفصول *</span><div class="cls-pick" id="hC" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>
      <label class="f" style="grid-column:1/-1">نص الواجب والتعليمات<textarea id="hI" rows="5">${esc(x.instructions || '')}</textarea></label>
      <label class="f" style="grid-column:1/-1">روابط مرفقة (رابط في كل سطر — ملف درايف، فيديو، نموذج…)<textarea id="hK" rows="3" dir="ltr" placeholder="https://…">${esc((x.links || []).map((l) => l.url).join('\n'))}</textarea></label>
    </div>`;
    let init = new Set(x.class_ids || []);
    const paint = (w) => { const sid = +$('#hS', w).value || null; const sel = new Set([...$$('#hC input:checked', w).map((i) => +i.value), ...init]); init = new Set();
      const L = OPT.classes.filter((c) => !sid || (c.subjects || []).includes(sid));
      $('#hC', w).innerHTML = L.map((c) => `<label style="display:flex;align-items:center;gap:4px;background:#f4f7f8;padding:4px 10px;border-radius:99px;font-size:.86rem;cursor:pointer"><input type="checkbox" value="${c.id}"${sel.has(c.id) ? ' checked' : ''}> ${esc(short(c.label))}<small class="hint"> ${esc(c.label.split(' — ')[1] || '')}</small></label>`).join('') || '<span class="hint">لا توجد فصول لهذه المادة</span>'; };
    modal({ title: x.id ? 'تعديل الواجب' : 'واجب جديد', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: x.id ? '💾 حفظ' : '📤 نشر الواجب', cls: 'primary', onClick: async (w) => {
      try { localStorage.setItem('lms_per', $('#hP', w).value); } catch (_) {}
      const p = { id: x.id || null, period: $('#hP', w).value || null, title: $('#hT', w).value.trim(), subject_id: +$('#hS', w).value || null, max_score: +$('#hM', w).value || 10, allow_late: $('#hL', w).checked,
        due_at: $('#hD', w).value ? new Date($('#hD', w).value).toISOString() : '', instructions: $('#hI', w).value.trim(),
        class_ids: $$('#hC input:checked', w).map((i) => +i.value),
        links: $('#hK', w).value.split(/\n+/).map((u) => u.trim()).filter(Boolean).map((u) => ({ url: u })) };
      if (!p.title) { toast('اكتب عنوان الواجب', 'warn'); return false; } if (!p.due_at) { toast('حدّد موعد التسليم', 'warn'); return false; }
      if (!p.class_ids.length) { toast('اختر فصلًا واحدًا على الأقل', 'warn'); return false; }
      if (p.links.some((l) => !/^https?:\/\//i.test(l.url))) { toast('الروابط يجب أن تبدأ بـ https://', 'warn'); return false; }
      { const dd = LMS.ymd(new Date(p.due_at)); if (!LMS.cal.isSchoolDay(dd) && !await confirmBox(`موعد التسليم يقع في يوم غير دراسي (${LMS.cal.why(dd)}). المتابعة؟`, 'متابعة')) return false; }
      await call('hw_save', { p }); toast(x.id ? 'حُفظ الواجب' : 'نُشر الواجب لطلاب الفصول المختارة'); show('mine'); } }] });
    const w = $$('.modal-wrap').pop(); paint(w); $('#hS', w).onchange = () => paint(w);
  }

  // ---------------- الطالب: واجباتي ----------------
  async function drawStudent() {
    const pane = $('#tab-student'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('hw_list', { p_box: 'student' }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const todo = L.filter((x) => !x.my_status || x.my_status === 'returned'), rest = L.filter((x) => !todo.includes(x));
    const cardS = (x) => { const st = x.my_status || 'none'; const over = !x.my_status && past(x.due_at);
      return `<button class="hw" data-hw="${x.id}"><b>${esc(x.title)}</b><small>${esc(x.subject || '')} · ${esc(x.teacher || '')}</small>
        <small>التسليم: ${esc(fmt(x.due_at))}</small><div class="row">${st === 'graded' ? chip('graded', `مُصحَّح: ${num(x.my_score)} / ${num(x.max_score)}`) : chip(st)}
        ${over ? chip('late', x.closed || !x.allow_late ? 'فات الموعد' : 'متأخر — ما زال التسليم متاحًا') : ''}${x.my_late ? chip('late', 'سُلّم متأخرًا') : ''}</div></button>`; };
    pane.innerHTML = L.length ? `${todo.length ? `<h3 class="sec-h">مطلوب منك (${todo.length})</h3><div class="hw-list">${todo.map(cardS).join('')}</div>` : '<div class="notice">🎉 لا توجد واجبات مطلوبة منك الآن.</div>'}
      ${rest.length ? `<h3 class="sec-h">سلّمتها</h3><div class="hw-list">${rest.map(cardS).join('')}</div>` : ''}`
      : '<div class="empty">لا توجد واجبات لفصلك حتى الآن.</div>';
    pane.onclick = (e) => { const c = e.target.closest('[data-hw]'); if (c) studentView(+c.dataset.hw); };
  }
  async function studentView(id) {
    let x; try { x = await call('hw_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const s = x.sub || {};
    const st = s.status || 'none';
    const form = `<label class="f" style="margin-top:6px">${s.at ? 'تعديل إجابتك' : 'إجابتك'}<textarea id="sB" rows="6">${esc(s.body || '')}</textarea></label>
        <label class="f">روابط (رابط في كل سطر — ملف درايف، صورة، عرض…)<textarea id="sL" rows="2" dir="ltr" placeholder="https://…">${esc((s.links || []).map((l) => l.url).join('\n'))}</textarea></label>`;
    const body = `<div class="hwv"><div class="meta" style="display:flex;flex-wrap:wrap;gap:6px">${chip(st)}<span class="chip teal">${esc(x.subject || '')}</span><span class="chip gray">${esc(x.teacher || '')}</span>
        <span class="chip gray">التسليم: ${esc(fmt(x.due_at))}</span><span class="chip gray">الدرجة من ${esc(num(x.max_score))}</span></div>
      <section class="sv"><h5>📄 الواجب</h5>${x.instructions ? `<p>${esc(x.instructions)}</p>` : '<p class="hint">لا توجد تعليمات مكتوبة.</p>'}${linksHTML(x.links)}</section>
      <section class="sv"><h5>✍️ إجابتك</h5>${s.at ? `<p>${esc(s.body || '—')}</p>${linksHTML(s.links)}<small class="hint">سُلّمت ${esc(fmt(s.at))}${s.late ? ' · متأخر' : ''}</small>`
        : '<p class="hint">لم تسلّم بعد.</p>'}</section>
      <section class="sv"><h5>✅ التصحيح</h5>${st === 'graded' ? `<div class="fb"><b>الدرجة: ${esc(num(s.score))} / ${esc(num(x.max_score))}</b>${s.feedback ? `<br>ملاحظة المعلم: ${esc(s.feedback)}` : ''}</div>`
        : st === 'returned' ? `<div class="fb ret"><b>↩️ أعاده المعلم للتعديل:</b><br>${esc(s.feedback || '')}</div>` : `<p class="hint">${s.at ? 'بانتظار تصحيح المعلم.' : '—'}</p>`}</section>
      ${x.can_submit ? (s.at ? `<details class="sv"><summary class="btn sm ghost">✏️ تعديل الإجابة وإعادة التسليم</summary>${form}</details>` : form)
        : !s.at ? '<div class="notice">انتهى موعد التسليم أو أُغلق الواجب.</div>' : ''}</div>`;
    const A = [{ label: 'إغلاق', cls: 'ghost' }];
    if (x.can_submit) A.push({ label: s.at ? '📤 إعادة التسليم' : '📤 تسليم', cls: 'primary', onClick: async (w) => {
      if (s.at && !$('details.sv', w)?.open) { $('details.sv', w).open = true; toast('عدّل إجابتك ثم اضغط إعادة التسليم', 'warn'); return false; }
      const links = $('#sL', w).value.split(/\n+/).map((u) => u.trim()).filter(Boolean).map((u) => ({ url: u }));
      if (links.some((l) => !/^https?:\/\//i.test(l.url))) { toast('الروابط يجب أن تبدأ بـ https://', 'warn'); return false; }
      await call('hw_submit', { p_id: id, p_body: $('#sB', w).value, p_links: links }); toast('تم التسليم ✓'); drawStudent(); } });
    modal({ title: '📚 ' + x.title, wide: true, body, actions: A });
  }

  // ---------------- متابعة (مشرف / مدير) ----------------
  async function drawAll() {
    const pane = $('#tab-all'); pane.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('hw_list', { p_box: 'all' }); } catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!L.length) { pane.innerHTML = '<div id="noHw"></div><div class="empty">لم ينشئ معلموك واجبات بعد.</div>'; noHwBox(); return; }
    const by = {}; L.forEach((x) => { const o = by[x.teacher] = by[x.teacher] || { n: 0, stu: 0, sub: 0, gr: 0, avg: [] }; o.n++; o.stu += x.students; o.sub += x.submitted; o.gr += x.graded; if (x.avg != null) o.avg.push(x.avg); });
    pane.innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="aQ" class="grow" type="search" placeholder="ابحث باسم المعلم أو المادة أو الفصل…"></div>
      <div id="noHw"></div><h3 class="sec-h">ملخص المعلمين</h3><div class="table-wrap" style="margin-bottom:12px"><table><thead><tr><th>المعلم</th><th>الواجبات</th><th>نسبة التسليم</th><th>المصحّح</th><th>متوسط الدرجات</th></tr></thead><tbody>
      ${Object.entries(by).sort((a, b) => b[1].n - a[1].n).map(([t, o]) => `<tr><td>${esc(t)}</td><td>${o.n}</td><td>${o.stu ? Math.round(100 * o.sub / o.stu) + '%' : '—'}</td><td>${o.gr}</td>
        <td>${o.avg.length ? Math.round(o.avg.reduce((a, b) => a + b, 0) / o.avg.length) + '%' : '—'}</td></tr>`).join('')}</tbody></table></div>
      <h3 class="sec-h">كل الواجبات</h3><div class="table-wrap"><table id="aT"><thead><tr><th>المعلم</th><th>العنوان</th><th>المادة</th><th>الفصول</th><th>التسليم</th><th>سلّم</th><th>صُحّح</th><th></th></tr></thead><tbody>
      ${L.map((x) => `<tr><td>${esc(x.teacher)}</td><td>${esc(x.title)}</td><td>${esc(x.subject || '')}</td><td>${esc(x.classes.map(short).join('، '))}</td><td>${esc(fmt(x.due_at))}</td>
        <td>${x.submitted} / ${x.students}</td><td>${x.graded}</td><td><button class="btn sm" data-hw="${x.id}">فتح</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#aQ').oninput = (e) => { const q = e.target.value.trim(); $$('#aT tbody tr').forEach((tr) => { tr.hidden = !!q && !LMS.has(tr.innerText, q); }); };
    pane.onclick = (e) => { const c = e.target.closest('[data-hw]'); if (c) teacherView(+c.dataset.hw); };
    noHwBox();
  }
  async function noHwBox() {
    const d = new Date(), f = new Date(d); f.setDate(d.getDate() - 13);
    const y = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (!LMS.cal.count(y(f), y(d))) return;   // الفترة كلها إجازة حسب التقويم
    let C; try { C = await call('an_compliance', { p_from: y(f), p_to: y(d) }); } catch (_) { return; }
    const N = C.filter((t) => !t.hw); if (!N.length || !$('#noHw')) return;
    $('#noHw').innerHTML = `<details class="glass" style="padding:10px 14px;margin:10px 0"><summary><b>معلمون بدون واجبات في آخر أسبوعين</b> <span class="hint">(${N.length} · ${LMS.cal.count(y(f), y(d))} يوم دراسي)</span></summary>
      <div class="chips" style="margin-top:8px">${N.map((t) => `<span class="chip gray">${esc(t.name)} — ${esc(t.subjects || '')}</span>`).join('')}</div></details>`;
  }

  const OPEN = /open=(\d+)/.exec(location.hash);
  show(OPEN ? (STUDENT ? 'student' : OPT.is_teacher ? 'mine' : 'all') : (location.hash || '').slice(1) || (STUDENT ? 'student' : OPT.is_teacher ? 'mine' : 'all'));
  if (OPEN) (STUDENT ? studentView : teacherView)(+OPEN[1]);
})();
