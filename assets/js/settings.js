/* =====================================================================
   إعدادات المدرسة: توقيت الحصص + جداول حصص المشرفين
   (مدير النظام، الإدارة العليا، مديرو المراحل)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, confirmBox, errMsg, requireAuth } = LMS;
  await requireAuth(['admin', 'leadership', 'principal']);

  const STAGES = ['ابتدائي', 'متوسط', 'ثانوي', 'المسار الأمريكي', 'غير محدد'];
  const GRADE_AR = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'];
  let D = null;           // بيانات sch_tt_get
  let SUP = '';           // المشرف المختار

  async function load() {
    const { data, error } = await sb.rpc('sch_tt_get');
    if (error) throw error;
    D = data;
    if (!SUP || !D.supervisors.some((s) => s.id === SUP)) {
      const withTT = D.supervisors.find((s) => D.sheets.some((x) => x.owner === s.id));
      SUP = (withTT || D.supervisors[0] || {}).id || '';
    }
  }
  async function meta(p) { const { error } = await sb.rpc('sch_tt_meta', { p }); if (error) throw error; }

  /* ---------------- توقيت الحصص ---------------- */
  function drawTimes() {
    const pane = $('#tab-times');
    pane.innerHTML = `<p class="hint">لكل مرحلة توقيتها، ويظهر في «مكتب الإشراف التربوي» لكل المشرفين. يعدّل كل مدير مرحلة توقيت مرحلته فقط (حسب نطاقه في لوحة الإدارة).</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${D.profiles.map((p) => `
        <div class="glass card" data-prof="${esc(p.key)}">
          <div class="toolbar" style="margin-bottom:8px"><b>${esc(p.name)}</b><span class="grow"></span>${p.can ? '' : '<span class="chip gray">للعرض فقط</span>'}</div>
          <div class="table-wrap" style="max-height:none"><table><thead><tr><th>الحصة</th><th>من</th><th>إلى</th>${p.can ? '<th></th>' : ''}</tr></thead>
          <tbody>${rowsOf(p).map((t, i) => trTime(i + 1, t, p.can)).join('')}</tbody></table></div>
          ${p.can ? `<div class="toolbar" style="margin:10px 0 0"><button class="btn sm" data-addp>+ حصة</button><span class="grow"></span><button class="btn sm primary" data-savep>حفظ التوقيت</button></div>` : ''}
        </div>`).join('')}</div>`;
  }
  function rowsOf(p) { const a = []; (p.times || []).forEach((t) => { a[t.p - 1] = t; }); for (let i = 0; i < a.length; i++) a[i] = a[i] || { s: '', e: '' }; return a.length ? a : [{ s: '', e: '' }]; }
  function trTime(n, t, can) {
    const dis = can ? '' : 'disabled';
    return `<tr><td>${n}</td><td><input type="time" ${dis} data-s value="${esc(t.s || '')}"></td><td><input type="time" ${dis} data-e value="${esc(t.e || '')}"></td>${can ? '<td><button class="btn sm danger" data-delp>✕</button></td>' : ''}</tr>`;
  }
  $('#tab-times').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-prof]'); if (!card) return;
    const tb = $('tbody', card);
    if (e.target.matches('[data-addp]')) { tb.insertAdjacentHTML('beforeend', trTime(tb.rows.length + 1, {}, true)); return; }
    if (e.target.matches('[data-delp]')) { e.target.closest('tr').remove(); [...tb.rows].forEach((r, i) => { r.cells[0].textContent = i + 1; }); return; }
    if (e.target.matches('[data-savep]')) {
      const times = [...tb.rows].map((r) => ({ s: $('[data-s]', r).value, e: $('[data-e]', r).value }));
      const bad = times.findIndex((t) => t.s && t.e && t.s >= t.e);
      if (bad >= 0) { toast(`الحصة ${bad + 1}: وقت النهاية قبل البداية`, 'warn'); return; }
      try { const { error } = await sb.rpc('sch_times_save', { p: { profile: card.dataset.prof, times } }); if (error) throw error;
        toast('تم حفظ التوقيت ✓'); await load(); drawTimes(); } catch (er) { toast(errMsg(er), 'err'); }
    }
  });
  $('#tab-times').addEventListener('change', (e) => {
    if (e.target.matches('[data-s]') && e.target.value) { const r = e.target.closest('tr'), en = $('[data-e]', r);
      if (!en.value) { const [h, m] = e.target.value.split(':').map(Number), t = h * 60 + m + 45; en.value = String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); } }
  });

  /* ---------------- جداول الحصص ---------------- */
  function drawTT() {
    const pane = $('#tab-tt');
    const sup = D.supervisors.find((s) => s.id === SUP);
    const sheets = D.sheets.filter((x) => x.owner === SUP);
    const profOpts = (cur) => `<option value="">تلقائي حسب المرحلة</option>` + D.profiles.map((p) => `<option value="${esc(p.key)}" ${p.key === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const subs = [...new Set(D.teachers.map((t) => t.subject).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ar'));
    pane.innerHTML = `
      <div class="glass card" style="margin-bottom:14px">
        <div class="toolbar" style="margin:0">
          <label class="f" style="min-width:260px">المشرف<select id="supSel">${D.supervisors.map((s) => `<option value="${s.id}" ${s.id === SUP ? 'selected' : ''}>${esc(s.name)}${s.dept ? ' — ' + esc(s.dept) : ''} (${D.sheets.filter((x) => x.owner === s.id).length} جدول)</option>`).join('')}</select></label>
          <span class="grow"></span>
          <label class="btn primary" style="cursor:pointer">⬆ رفع جدول من Excel<input type="file" id="xls" accept=".xlsx,.xls" hidden></label>
        </div>
        <p class="hint" style="margin:8px 0 0">رفع ملف جديد <b>يستبدل</b> جدول هذا المشرف كله (أسماء الجداول ومواد المعلمين ومراحل الصفوف المحفوظة تبقى). الشكل: الأيام في العمود الأول، وأرقام الحصص في الصف العلوي، وفي كل خلية سطر لكل معلم «الاسم الصف» مثل «أحمد علي 4-أ» أو «Sara 10A»، ويمكن إضافة المادة والقاعة: «أحمد علي 4-أ | رياضيات | 12».</p>
        <div id="xlsMsg" class="hint"></div>
      </div>
      ${!sup ? '<div class="notice warn">لا يوجد مشرفون مفعّلون في مكتب الإشراف التربوي.</div>' : !sheets.length ? '<div class="notice info">لا يوجد جدول لهذا المشرف بعد — ارفع ملف Excel.</div>' : sheets.map((sh) => {
        const ts = D.teachers.filter((t) => t.sheet === sh.id), gs = D.grades.filter((g) => g.sheet === sh.id);
        return `<div class="glass card" style="margin-bottom:14px" data-sheet="${sh.id}">
          <div class="toolbar"><b>📄 ${esc(sh.name)}</b><span class="chip gray">${sh.slots} حصة أسبوعيًا</span>
            <label class="f" style="flex:1;min-width:220px;flex-direction:row;align-items:center;gap:8px">الاسم الظاهر<input data-label value="${esc(sh.label || '')}" placeholder="${esc(sh.name)}" style="flex:1"></label>
            <button class="btn sm danger" data-delsheet>حذف الجدول</button></div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))">
            <div><h4 style="margin:6px 0">مادة كل معلم</h4>
              <div class="table-wrap" style="max-height:340px"><table><thead><tr><th>المعلم</th><th>الحصص</th><th>المادة</th></tr></thead><tbody>
              ${ts.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.n}</td><td>${t.fixed ? `${esc(t.fixed)} <span class="hint">(من الجدول)</span>`
                : `<input list="subjList" data-subj="${t.id}" value="${esc(t.subject || '')}" placeholder="غير محددة" style="${t.subject ? '' : 'border-color:#e4a842;background:#fffaf0'}">`}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">لا معلمين</td></tr>'}
              </tbody></table></div></div>
            <div><h4 style="margin:6px 0">مرحلة كل صف وتوقيته</h4>
              <div class="table-wrap" style="max-height:340px"><table><thead><tr><th>الصف</th><th>الشعب</th><th>المرحلة</th><th>التوقيت</th></tr></thead><tbody>
              ${gs.map((g) => `<tr data-track="${esc(g.track)}" data-grade="${g.grade}"><td>${g.track === 'american' ? 'Grade ' + g.grade : 'الصف ' + (GRADE_AR[g.grade] || g.grade)}</td>
                <td style="white-space:normal;font-size:.82rem">${esc(g.classes || '')}</td>
                <td><select data-stage style="${g.stage === 'غير محدد' ? 'border-color:#e4a842;background:#fffaf0' : ''}">${STAGES.map((s) => `<option ${s === g.stage ? 'selected' : ''}>${s}</option>`).join('')}</select></td>
                <td><select data-prof>${profOpts(g.prof)}</select></td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا صفوف</td></tr>'}
              </tbody></table></div></div>
          </div></div>`; }).join('')}
      <datalist id="subjList">${subs.map((s) => `<option value="${esc(s)}">`).join('')}</datalist>`;
    $('#supSel', pane).onchange = (e) => { SUP = e.target.value; drawTT(); };
    $('#xls', pane).onchange = upload;
  }

  $('#tab-tt').addEventListener('change', async (e) => {
    const card = e.target.closest('[data-sheet]'); if (!card) return;
    const sheet = +card.dataset.sheet, el = e.target, tr = el.closest('tr');
    let p = null;
    if (el.matches('[data-label]')) p = { action: 'label', sheet, value: el.value };
    else if (el.matches('[data-subj]')) p = { action: 'subject', sheet, teacher: el.dataset.subj, value: el.value };
    else if (el.matches('[data-stage]')) p = { action: 'stage', sheet, track: tr.dataset.track, grade: +tr.dataset.grade, value: el.value };
    else if (el.matches('[data-prof]')) p = { action: 'prof', sheet, track: tr.dataset.track, grade: +tr.dataset.grade, value: el.value };
    if (!p) return;
    try { await meta(p); toast('تم الحفظ ✓'); await load(); if (el.matches('[data-stage]')) drawTT(); else if (el.matches('[data-subj]')) el.style.cssText = el.value ? '' : 'border-color:#e4a842;background:#fffaf0'; }
    catch (er) { toast(errMsg(er), 'err'); }
  });
  $('#tab-tt').addEventListener('click', async (e) => {
    if (!e.target.matches('[data-delsheet]')) return;
    const card = e.target.closest('[data-sheet]'), sh = D.sheets.find((x) => x.id === +card.dataset.sheet);
    if (!await confirmBox(`حذف الجدول «${sh.label || sh.name}» بكل حصصه؟ سيختفي من مكتب الإشراف التربوي ومن إسناد المعلمين.`, 'حذف')) return;
    try { await meta({ action: 'delete_sheet', sheet: sh.id }); toast('تم الحذف'); await load(); drawTT(); } catch (er) { toast(errMsg(er), 'err'); }
  });

  function loadXLSX() {
    return new Promise((res, rej) => { if (window.XLSX) return res(); const s = document.createElement('script'); s.src = 'supervision/xlsx.full.min.js';
      s.onload = res; s.onerror = () => rej(new Error('تعذّر تحميل قارئ Excel')); document.head.appendChild(s); });
  }
  async function upload(ev) {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    const msg = $('#xlsMsg'), sup = D.supervisors.find((s) => s.id === SUP);
    try {
      msg.textContent = 'جارٍ القراءة…';
      await loadXLSX();
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const raw = wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }).map((r) => r.map((c) => String(c ?? ''))) }));
      const pr = TTParse.parseSheets(raw);
      if (!pr.entries.length) throw new Error('لم أجد أيامًا وأرقام حصص في الملف');
      const nCls = pr.entries.filter((x) => x.kind === 'class').length;
      if (!await confirmBox(`استبدال جدول «${sup.name}» بالملف «${f.name}»؟ (${pr.sheets.length} جدول، ${nCls} حصة أسبوعيًا)`, 'استبدال')) { msg.textContent = ''; return; }
      msg.textContent = 'جارٍ الحفظ…';
      const p = { owner: SUP, sheets: pr.sheets.map((x) => ({ idx: x.idx, name: x.name })),
        entries: pr.entries.map((x) => ({ sheet: x.sheet, day: x.day, period: x.period, kind: x.kind, teacher: x.teacher || '', cls: x.cls || '', track: x.track || '',
          gradeNum: x.gradeNum == null ? '' : x.gradeNum, section: x.section || '', subj: x.subj || '', room: x.room || '', text: x.text || '' })) };
      const { data, error } = await sb.rpc('sv_tt_put', { p }); if (error) throw error; if (!data || !data.ok) throw new Error(data && data.error || 'تعذّر الحفظ');
      msg.textContent = `تم ✓ — ${pr.sheets.length} جدول، ${nCls} حصة أسبوعيًا.`;
      toast('تم رفع الجدول ✓'); await load(); drawTT();
    } catch (er) { msg.textContent = 'تعذّر الرفع: ' + errMsg(er); }
  }

  /* ---------------- التبويبات ---------------- */
  $('#tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
    history.replaceState(null, '', '#' + b.dataset.tab); };
  try { await load(); drawTimes(); drawTT(); }
  catch (er) { $('#tab-times').innerHTML = `<div class="notice err">${esc(errMsg(er))}</div>`; return; }
  if (location.hash === '#tt') $('#tabs button[data-tab="tt"]').click();
})();
