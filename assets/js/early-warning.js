/* =====================================================================
   الإنذار المبكر (sql/64): مؤشرات تعثّر من بيانات المنصة ← حالة متابعة ← إجراءات ← إغلاق
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('earlywarn', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const IND = [['abs', '📅 الغياب', 'يوم'], ['late', '⏰ التأخر', 'يوم'], ['neg', '⚠️ السلوك', 'ملاحظة'], ['hw', '📝 الواجبات', 'لم يُسلَّم'], ['ex', '🧪 التحصيل', '%']];
  const KIND = { parent_call: '📞 اتصال بولي الأمر', parent_meeting: '🤝 اجتماع مع ولي الأمر', student_meeting: '🧑‍🎓 جلسة مع الطالب', counseling: '💬 جلسة إرشادية',
    teacher_note: '👩‍🏫 ملاحظة معلم', referral: '📨 إحالة', other: '📌 أخرى' };
  const STS = { open: 'مفتوحة', monitoring: 'تحت المتابعة', closed: 'مغلقة ✓' };
  const LVL = { red: 'خطر', yellow: 'تنبيه', green: 'سليم' };

  const tabs = [['list', '🚨 الطلاب المتعثرون'], ['mine', '📂 حالاتي'], ['all', '📁 الحالات المفتوحة']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'list';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => (TAB === 'list' ? listView() : casesView(TAB === 'mine'));

  const indChips = (r) => IND.map(([k, l]) => r.lv[k] ? `<span class="ind l${r.lv[k]}">${l}: ${k === 'ex' ? r.ex + '%' : r[k]}</span>` : '').join(' ');

  /* ---------------- القائمة ---------------- */
  let L = null, F = { lvl: '', stage: '', why: '', q: '' };
  async function listView() {
    view.innerHTML = '<div class="empty">جارٍ تحليل بيانات الطلاب…</div>';
    try { L = await call('ew_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!L.scope) { view.innerHTML = '<div class="notice">لا يوجد طلاب ضمن نطاقك في الإنذار المبكر.<br><small>تظهر القائمة للإدارة، ولمدير/وكيل/موجّه المرحلة لطلاب مرحلته، ولرائد الفصل لطلاب فصله. يمكنك متابعة الحالات المسندة إليك من «حالاتي».</small></div>'; return; }
    const R = L.rows, red = R.filter((r) => r.level === 'red'), yel = R.filter((r) => r.level === 'yellow'), cs = R.filter((r) => r.case);
    const stages = [...new Set(R.map((r) => r.stage_id).filter(Boolean))];
    view.innerHTML = `<div class="kpi4">
        <div class="glass card-box" data-k=""><b>${L.scope}</b>طالب في نطاقك</div>
        <div class="glass card-box" data-k="red"><b style="color:#c0392b">${red.length}</b>🔴 مستوى خطر</div>
        <div class="glass card-box" data-k="yellow"><b style="color:#b8860b">${yel.length}</b>🟡 مستوى تنبيه</div>
        <div class="glass card-box" data-k="case"><b style="color:#007B51">${cs.length}</b>لديهم حالة متابعة</div></div>
      <div class="toolbar glass" style="padding:10px;flex-wrap:wrap">
        <input id="q" type="search" class="grow" placeholder="ابحث باسم الطالب أو الفصل…" value="${esc(F.q)}">
        <select id="fl"><option value="">كل المستويات</option><option value="red">🔴 خطر</option><option value="yellow">🟡 تنبيه</option><option value="case">لديهم حالة</option><option value="nocase">بدون حالة</option></select>
        ${stages.length > 1 ? `<select id="fs"><option value="">كل المراحل</option>${L.stages.filter((s) => stages.includes(s.id)).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>` : ''}
        <select id="fw"><option value="">كل الأسباب</option>${IND.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
        ${L.can_cfg ? '<button class="btn sm ghost" id="cfg">⚙️ العتبات</button>' : ''}</div>
      <p class="hint">التحليل لآخر <b>${L.days}</b> يومًا من بيانات الحضور والسلوك والواجبات والاختبارات في المنصة — يتحدث تلقائيًا مع كل تسجيل جديد.</p>
      <div id="lst"></div>`;
    $('#fl').value = F.lvl; if ($('#fs')) $('#fs').value = F.stage; $('#fw').value = F.why;
    const draw = () => {
      const v = LMS.norm(F.q);
      const rows = R.filter((r) => (!F.lvl || (F.lvl === 'case' ? r.case : F.lvl === 'nocase' ? !r.case : r.level === F.lvl)) && (!F.stage || String(r.stage_id) === F.stage)
        && (!F.why || r.lv[F.why]) && (!v || LMS.norm(r.name + ' ' + (r.class || '')).includes(v)));
      $('#lst').innerHTML = rows.slice(0, 300).map((r) => `<div class="glass ew-row ${r.level}" data-s="${r.id}">
          <span class="lvl ${r.level}">${LVL[r.level]}</span>
          <div class="grow"><b>${esc(r.name)}</b> <small class="hint">${esc(r.class || '')}</small><div>${indChips(r)}</div></div>
          ${r.case ? `<span class="st ${r.case.status}">${STS[r.case.status]}${r.case.owner ? ' · ' + esc(r.case.owner) : ''}</span>` : '<span class="hint">بدون حالة</span>'}</div>`).join('') +
        (rows.length > 300 ? `<p class="hint">يُعرض أول 300 من ${rows.length} — استخدم التصفية.</p>` : '') ||
        `<div class="empty">${R.length ? 'لا نتائج مطابقة للتصفية.' : '✅ لا يوجد طلاب في مستوى تنبيه أو خطر حاليًا.'}</div>`;
    };
    $('#q').oninput = (e) => { F.q = e.target.value; draw(); };
    $('#fl').onchange = (e) => { F.lvl = e.target.value; draw(); };
    if ($('#fs')) $('#fs').onchange = (e) => { F.stage = e.target.value; draw(); };
    $('#fw').onchange = (e) => { F.why = e.target.value; draw(); };
    $$('.kpi4 [data-k]').forEach((b) => { b.onclick = () => { F.lvl = b.dataset.k; $('#fl').value = F.lvl; draw(); }; });
    if ($('#cfg')) $('#cfg').onclick = cfgForm;
    $('#lst').onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) openStudent(r.dataset.s); };
    draw();
  }

  /* ---------------- الحالات ---------------- */
  async function casesView(mine) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let C = [];
    try { C = await call('ew_cases_list', { p_mine: mine }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const fmt = (t) => t ? new Date(t).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short' }) : '—';
    view.innerHTML = C.map((c) => `<div class="glass ew-row ${c.status === 'open' ? 'red' : 'yellow'}" data-s="${c.student_id}">
        <span class="st ${c.status}">${STS[c.status]}</span>
        <div class="grow"><b>${esc(c.name)}</b> <small class="hint">${esc(c.class || '')}</small>
          <div class="hint">الأسباب: ${esc((c.reasons || []).join('، ') || '—')}${mine ? '' : ' · المسؤول: ' + esc(c.owner || '—')}</div></div>
        <div class="hint" style="text-align:center">فُتحت ${fmt(c.opened_at)}<br>${c.n} إجراء${c.last ? ' · آخرها ' + fmt(c.last) : ''}</div></div>`).join('') ||
      `<div class="empty">${mine ? 'لا توجد حالات مسندة إليك حاليًا.' : 'لا توجد حالات متابعة مفتوحة في نطاقك.'}</div>`;
    view.onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) openStudent(r.dataset.s); };
  }

  /* ---------------- ملف الطالب ---------------- */
  async function openStudent(id) {
    let S;
    try { S = await call('ew_student', { p_student: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const act = S.cases.find((c) => c.status !== 'closed');
    const fmt = (t) => new Date(t).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    const list = (arr, f) => arr.length ? `<ul class="det">${arr.slice(0, 12).map((x) => `<li>${f(x)}</li>`).join('')}</ul>` : '';
    const caseHtml = (c) => `<div class="case-box">
        <div class="toolbar" style="margin:0"><b class="grow">📂 حالة متابعة — <span class="st ${c.status}">${STS[c.status]}</span></b><small class="hint">فتحها ${esc(c.opened_by || '')} · ${fmt(c.opened_at)}</small></div>
        <div class="hint">المسؤول: <b>${esc(c.owner || '—')}</b> · الأسباب: ${esc((c.reasons || []).join('، ') || '—')}</div>
        ${c.plan ? `<div class="act" style="border-color:#e0a800"><b>الخطة:</b> ${esc(c.plan)}</div>` : ''}
        ${c.actions.map((a) => `<div class="act"><b>${KIND[a.kind] || a.kind}</b> — ${esc(a.body)}<div class="hint">${esc(a.by || '')} · ${fmt(a.at)}</div></div>`).join('')}
        ${c.status === 'closed' ? `<div class="hint">أُغلقت ${c.closed_at ? fmt(c.closed_at) : ''}${c.outcome ? ' — النتيجة: ' + esc(c.outcome) : ''}</div>` : `
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm primary" data-act="${c.id}">＋ إجراء</button>
          <button class="btn sm" data-edit="${c.id}">✏️ الخطة والمسؤول</button><button class="btn sm ghost" data-close="${c.id}">✅ إغلاق الحالة</button></div>`}</div>`;
    const body = `<div class="toolbar" style="margin:0"><span class="lvl ${S.level}">${LVL[S.level]}</span><b class="grow">${esc(S.class || '')}</b>
        ${S.guardian && S.guardian.phone ? `<span class="hint">ولي الأمر: ${esc(S.guardian.name || '')} <a href="tel:${esc(S.guardian.phone)}">${esc(S.guardian.phone)}</a></span>` : ''}</div>
      <div class="tiles" style="margin:10px 0">${IND.map(([k, l, u]) => `<div class="tile l${S.lv[k]}">${l}<b>${k === 'ex' ? (S.ex_n ? S.ex + '%' : '—') : S[k]}</b><small class="hint">${k === 'ex' ? (S.ex_n ? S.ex_n + ' اختبار' : 'لا اختبارات') : u}</small></div>`).join('')}</div>
      ${S.absences.length ? '<b>📅 الغياب والتأخر</b>' + list(S.absences, (x) => `${esc(x.d)} — ${x.s === 'absent' ? 'غائب' : 'متأخر'}${x.n ? ' (' + esc(x.n) + ')' : ''}`) : ''}
      ${S.behavior.length ? '<b>⚠️ ملاحظات سلوكية</b>' + list(S.behavior, (x) => `${esc(x.d)} — ${esc(x.t)}${x.g ? ' (الدرجة ' + x.g + ')' : ''}`) : ''}
      ${S.hw.length ? '<b>📝 واجبات لم تُسلَّم</b>' + list(S.hw, (x) => `${esc(x.t)} — ${esc(x.sub || '')} · ${esc(x.d)}`) : ''}
      ${S.exams.length ? '<b>🧪 الاختبارات</b>' + list(S.exams, (x) => `${esc(x.t)} — ${esc(x.sub || '')}: <b>${x.pct}%</b>`) : ''}
      ${act ? caseHtml(act) : `<div class="case-box"><b>لا توجد حالة متابعة مفتوحة.</b><div style="margin-top:6px"><button class="btn sm primary" data-new="1">📂 فتح حالة متابعة</button></div></div>`}
      ${S.cases.filter((c) => c.status === 'closed').map((c) => `<details style="margin-top:8px"><summary class="hint">حالة سابقة — ${fmt(c.opened_at)}</summary>${caseHtml(c)}</details>`).join('')}
      <p class="hint" style="margin-top:10px"><a href="students.html#s=${S.id}">🗂️ ملف الطالب الكامل</a> · <a href="behavior.html">🌟 سجل السلوك</a></p>`;
    modal({ title: '🚨 ' + S.name, body, wide: true, actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    const reopen = () => { w.remove(); openStudent(id); if (TAB === 'list') listView(); else casesView(TAB === 'mine'); };
    w.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.new || b.dataset.edit) return caseForm(S, b.dataset.edit ? S.cases.find((c) => c.id === +b.dataset.edit) : null, reopen);
      if (b.dataset.act) return actionForm(+b.dataset.act, reopen, false);
      if (b.dataset.close) return actionForm(+b.dataset.close, reopen, true);
    });
  }

  function caseForm(S, c, done) {
    const own = c ? c.owner_id : ctx.profile.id;
    const owners = S.owners.some((o) => o.id === ctx.profile.id) ? S.owners : [{ id: ctx.profile.id, name: ctx.profile.full_name + ' (أنا)', job: '' }].concat(S.owners);
    const rs = c ? c.reasons : S.reasons;
    modal({ title: c ? 'تعديل حالة المتابعة' : 'فتح حالة متابعة — ' + S.name, body: `
      <label class="f">أسباب الإنذار</label><div style="display:flex;flex-wrap:wrap;gap:6px">${['الغياب', 'التأخر', 'السلوك', 'الواجبات', 'التحصيل', 'نفسي/اجتماعي', 'صحي'].map((r) =>
        `<label class="chk" style="margin:0 6px 0 0"><input type="checkbox" value="${r}" ${rs.includes(r) ? 'checked' : ''}> ${r}</label>`).join('')}</div>
      <label class="f">المسؤول عن المتابعة<select id="ow">${owners.map((o) => `<option value="${o.id}" ${o.id === own ? 'selected' : ''}>${esc(o.name)}${o.job ? ' — ' + esc(o.job) : ''}</option>`).join('')}</select></label>
      <label class="f">خطة المتابعة<textarea id="pl" rows="4" placeholder="مثال: اتصال بولي الأمر خلال يومين، جلسة إرشادية أسبوعية، متابعة تسليم الواجبات مع معلمي المواد…">${esc(c ? c.plan || '' : '')}</textarea></label>
      <p class="hint">إذا أسندت الحالة لغيرك يصله إشعار فوري.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (m) => {
        const reasons = $$('input[type=checkbox]:checked', m).map((x) => x.value);
        await call('ew_case_save', { p: { id: c ? c.id : null, student_id: S.id, owner_id: $('#ow', m).value, plan: $('#pl', m).value, reasons } });
        toast(c ? 'حُفظت ✓' : 'فُتحت الحالة ✓'); done(); return true; } }] });
  }

  function actionForm(cid, done, closing) {
    modal({ title: closing ? '✅ إغلاق الحالة' : '＋ إجراء متابعة', body: closing
      ? `<label class="f">نتيجة المتابعة *<textarea id="oc" rows="3" placeholder="مثال: انتظم الطالب في الحضور وتحسّن تسليم الواجبات"></textarea></label>`
      : `<label class="f">نوع الإجراء<select id="kd">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
         <label class="f">التفاصيل *<textarea id="bd" rows="4"></textarea></label>
         <label class="f">حالة المتابعة بعد الإجراء<select id="ss"><option value="">بدون تغيير</option><option value="monitoring">تحت المتابعة</option><option value="open">مفتوحة</option></select></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: closing ? 'إغلاق الحالة' : 'حفظ', cls: 'primary', onClick: async (m) => {
        if (closing) {
          const oc = $('#oc', m).value.trim(); if (!oc) { toast('اكتب نتيجة المتابعة', 'err'); return false; }
          await call('ew_action_add', { p_case: cid, p_kind: 'other', p_body: 'إغلاق الحالة: ' + oc, p_status: 'closed', p_outcome: oc });
        } else {
          const bd = $('#bd', m).value.trim(); if (!bd) { toast('اكتب التفاصيل', 'err'); return false; }
          await call('ew_action_add', { p_case: cid, p_kind: $('#kd', m).value, p_body: bd, p_status: $('#ss', m).value || null, p_outcome: null });
        }
        toast('حُفظ ✓'); done(); return true; } }] });
  }

  function cfgForm() {
    const c = L.cfg;
    const row = (k, l, low) => `<tr><td>${l}</td><td><input type="number" id="${k}0" value="${c[k][0]}" style="width:80px"></td><td><input type="number" id="${k}1" value="${c[k][1]}" style="width:80px"></td><td class="hint">${low ? 'متوسط أقل من' : 'عدد يساوي أو أكثر من'}</td></tr>`;
    modal({ title: '⚙️ عتبات الإنذار المبكر', body: `
      <label class="f">فترة التحليل (أيام)<input type="number" id="dy" value="${c.days}" min="7" max="180"></label>
      <table style="width:100%;margin-top:8px"><thead><tr><th>المؤشر</th><th>🟡 تنبيه</th><th>🔴 خطر</th><th></th></tr></thead><tbody>
        ${row('abs', '📅 أيام الغياب')}${row('late', '⏰ أيام التأخر')}${row('neg', '⚠️ ملاحظات سلوكية سلبية')}${row('hw', '📝 واجبات لم تُسلَّم')}${row('ex', '🧪 متوسط الاختبارات %', true)}</tbody></table>
      <p class="hint">المستوى «خطر» إذا بلغ أي مؤشر حدّ الخطر أو اجتمعت 3 تنبيهات فأكثر. مؤشر التحصيل يُحسب عند وجود اختبارين على الأقل.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (m) => {
        const p = { days: +$('#dy', m).value }; ['abs', 'late', 'neg', 'hw', 'ex'].forEach((k) => { p[k] = [+$('#' + k + '0', m).value, +$('#' + k + '1', m).value]; });
        await call('ew_settings_set', { p }); toast('حُفظت العتبات ✓'); listView(); return true; } }] });
  }

  paint();
})();
