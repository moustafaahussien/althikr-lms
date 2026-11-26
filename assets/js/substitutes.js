/* =====================================================================
   حصص الانتظار (sql/63): غياب المعلم ← حصصه من الجدول ← ترشيح البدلاء ← إسناد + إشعار
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('substitutes', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const MGR = await call('sub_am_manager').catch(() => false);
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const dayName = (s) => DAYS[new Date(s + 'T12:00:00').getDay()];
  const schoolDay = () => { const d = new Date(); while ([5, 6].includes(d.getDay())) d.setDate(d.getDate() + 1); return iso(d); };
  let DAY = schoolDay();

  const tabs = MGR ? [['day', '📋 لوحة اليوم'], ['mine', '⏱️ حصصي'], ['stats', '📊 الإحصاءات']] : [['mine', '⏱️ حصصي']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };

  const paint = () => (TAB === 'day' ? dayView() : TAB === 'stats' ? statsView() : mineView());

  /* ---------------- لوحة اليوم (للوكيل والإدارة) ---------------- */
  let D = null;
  async function dayView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { D = await call('sub_day', { p_day: DAY }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const slots = D.absences.flatMap((a) => a.slots);
    const open = slots.filter((s) => s.status === 'open').length;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap">
        <label class="hint">اليوم: <input type="date" id="dd" value="${DAY}"></label><b>${dayName(DAY)}</b>
        <span class="grow"></span>
        <button class="btn primary sm" id="add">＋ تسجيل غياب معلم</button>
        <button class="btn sm" id="auto" ${open ? '' : 'disabled'}>⚡ إسناد تلقائي (${open})</button>
        <button class="btn sm ghost" id="prn">🖨️ طباعة</button></div>
      <div class="kpi4">
        <div class="glass card-box"><b>${D.absences.length}</b>معلم غائب</div>
        <div class="glass card-box"><b>${slots.length}</b>حصة تحتاج تغطية</div>
        <div class="glass card-box"><b style="color:#007B51">${slots.length - open}</b>أُسندت</div>
        <div class="glass card-box"><b style="color:${open ? '#b3261e' : 'inherit'}">${open}</b>لم تُسند</div></div>
      <h2 class="print-only">حصص الانتظار — ${dayName(DAY)} ${DAY}</h2>
      ${D.absences.map((a) => `<div class="glass ab-card">
          <div class="toolbar" style="margin:0"><b class="grow">👤 ${esc(a.name)}</b>
            <span class="pill">${a.periods ? 'الحصص: ' + a.periods.join('، ') : 'اليوم كاملًا'}</span>
            <span class="noprint"><button class="btn sm ghost" data-ed="${a.id}">✏️</button><button class="btn sm danger ghost" data-del="${a.id}">🗑</button></span></div>
          ${a.reason ? `<div class="hint">السبب: ${esc(a.reason)}</div>` : ''}
          ${a.slots.length ? `<table><thead><tr><th>الحصة</th><th>الفصل</th><th>المادة</th><th>المعلم البديل</th><th class="noprint"></th></tr></thead><tbody>
            ${a.slots.map((s) => `<tr><td><b>${s.period}</b></td><td>${esc(s.cls || '—')}</td><td>${esc(s.subject || '—')}</td>
              <td>${s.sub_id ? `<span class="pill ok">✓ ${esc(s.sub)}</span>` : '<span class="pill open">لم تُسند</span>'}${s.note ? `<div class="hint">${esc(s.note)}</div>` : ''}</td>
              <td class="noprint" style="white-space:nowrap"><button class="btn sm ${s.sub_id ? '' : 'primary'}" data-pick="${s.id}">${s.sub_id ? '🔁 تغيير' : '👥 اختيار بديل'}</button>
              ${s.sub_id ? `<button class="btn sm ghost" data-un="${s.id}" title="إلغاء الإسناد">✕</button>` : ''}</td></tr>`).join('')}</tbody></table>`
            : '<div class="hint">لا توجد حصص لهذا المعلم في الجدول المدرسي لهذا اليوم.</div>'}</div>`).join('') ||
        `<div class="empty">✅ لا يوجد غياب مسجّل في هذا اليوم.<br><small>عند غياب معلم اضغط «＋ تسجيل غياب معلم» وستظهر حصصه تلقائيًا من الجدول المدرسي.</small></div>`}`;
    $('#dd').onchange = (e) => { DAY = e.target.value || schoolDay(); dayView(); };
    $('#add').onclick = () => absenceForm({});
    $('#prn').onclick = () => window.print();
    $('#auto').onclick = async () => {
      if (!await confirmBox(`إسناد تلقائي لـ ${open} حصة؟ سيُختار لكل حصة أنسب معلم متاح (يدرّس الفصل نفسه ← نفس المرحلة ← الأقل انتظارًا)، ويصله إشعار فوري.`, 'إسناد')) return;
      try { const r = await call('sub_auto', { p_day: DAY }); toast(`أُسندت ${r.assigned} حصة${r.unfilled ? ` — ${r.unfilled} بلا معلم متاح` : ''} ✓`); dayView(); } catch (e) { toast(errMsg(e), 'err'); }
    };
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.ed) return absenceForm(D.absences.find((a) => a.id === +b.dataset.ed));
        if (b.dataset.del) { if (!await confirmBox('حذف الغياب وكل حصص الانتظار المرتبطة به؟ سيصل إشعار إلغاء للمعلمين البدلاء.', 'حذف')) return;
          await call('sub_absent_delete', { p_id: +b.dataset.del }); toast('حُذف'); return dayView(); }
        if (b.dataset.pick) return pickSub(slots.find((s) => s.id === +b.dataset.pick));
        if (b.dataset.un) { if (!await confirmBox('إلغاء إسناد هذه الحصة؟ سيصل إشعار إلغاء للمعلم.', 'إلغاء الإسناد')) return;
          await call('sub_assign', { p_id: +b.dataset.un, p_sub: null }); toast('أُلغي الإسناد'); dayView(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  async function absenceForm(a) {
    let T = [];
    try { T = await call('sub_teachers', { p_day: DAY }); } catch (e) { return toast(errMsg(e), 'err'); }
    if (!T.length) return toast('لا توجد حصص في الجدول المدرسي لهذا اليوم — تأكد من رفع الجدول في منصة الإشراف.', 'err');
    const per = new Set(a.periods || []);
    const body = `<div class="hint" style="margin-bottom:6px">${dayName(DAY)} ${DAY}</div>
      ${a.id ? `<b>👤 ${esc(a.name)}</b>` : `<label class="f">المعلم الغائب *<input id="tq" type="search" placeholder="ابحث بالاسم…"></label>
      <div class="tlist" id="tl">${T.map((t) => `<label data-q="${esc(LMS.norm(t.name + ' ' + (t.job || '')))}"><input type="radio" name="tt" value="${t.id}">
        <span class="grow">${esc(t.name)}<br><small class="hint">${esc(t.job || '')}</small></span><span class="pill">${t.n} حصص</span></label>`).join('')}</div>`}
      <label class="chk" style="margin-top:10px"><input type="checkbox" id="all" ${per.size ? '' : 'checked'}> غائب اليوم كاملًا</label>
      <div class="pgrid" id="pg" style="${per.size ? '' : 'display:none'}">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => `<label><input type="checkbox" value="${p}" ${per.has(p) ? 'checked' : ''}> الحصة ${p}</label>`).join('')}</div>
      <label class="f" style="margin-top:10px">السبب (اختياري)<select id="rs"><option value="">—</option>${['إجازة مرضية', 'إجازة اضطرارية', 'إجازة رسمية', 'مهمة عمل / تدريب', 'استئذان', 'تأخر صباحي', 'أخرى']
        .map((r) => `<option ${a.reason === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>`;
    modal({ title: a.id ? 'تعديل الغياب' : 'تسجيل غياب معلم', body, actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, {
      label: 'حفظ وعرض الحصص', cls: 'primary', onClick: async (w) => {
        const tid = a.teacher_id || ($('input[name=tt]:checked', w) || {}).value;
        if (!tid) { toast('اختر المعلم', 'err'); return false; }
        const all = $('#all', w).checked; const ps = all ? [] : $$('#pg input:checked', w).map((x) => +x.value);
        if (!all && !ps.length) { toast('اختر الحصص أو «اليوم كاملًا»', 'err'); return false; }
        const r = await call('sub_absent_set', { p: { teacher_id: tid, day: DAY, periods: ps, reason: $('#rs', w).value } });
        toast(`سُجّل الغياب — ${r.slots} حصة تحتاج تغطية`); dayView(); return true; } }] });
    setTimeout(() => {
      const w = [...document.querySelectorAll('.modal-wrap')].pop(); if (!w) return;
      $('#all', w).onchange = (e) => { $('#pg', w).style.display = e.target.checked ? 'none' : ''; };
      const q = $('#tq', w); if (q) q.oninput = () => { const v = LMS.norm(q.value); $$('#tl label', w).forEach((l) => { l.style.display = !v || l.dataset.q.includes(v) ? '' : 'none'; }); };
    }, 0);
  }

  async function pickSub(s) {
    let C = [];
    try { C = await call('sub_candidates', { p_id: s.id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const body = `<div class="hint">الحصة <b>${s.period}</b> — ${esc(s.cls || '')}${s.subject ? ' — ' + esc(s.subject) : ''}${s.sub ? ` · الحالي: <b>${esc(s.sub)}</b>` : ''}</div>
      <p class="hint" style="margin:6px 0">مرتّبون حسب الأنسب: من يدرّس الفصل نفسه، ثم نفس المرحلة، ثم الأقل حصص انتظار. (الحد اليومي: ${D.max} حصة)</p>
      <label class="f">ملاحظة للبديل (اختياري)<input id="nt" placeholder="مثال: حل تمارين صفحة 40"></label>
      <div style="max-height:340px;overflow:auto">${C.map((c) => `<div class="cand"><div class="grow"><b>${esc(c.name)}</b><div>
          ${c.same_class ? '<span class="pill gold">⭐ يدرّس الفصل</span> ' : ''}${c.same_stage ? '<span class="pill ok">نفس المرحلة</span> ' : ''}
          <span class="pill">اليوم: ${c.today_subs} انتظار · ${c.today_periods} حصص</span> <span class="pill">الشهر: ${c.month_subs}</span></div></div>
          <button class="btn sm primary" data-c="${c.teacher_id}">إسناد</button></div>`).join('') || '<div class="empty">لا يوجد معلم متاح في هذه الحصة.</div>'}</div>`;
    modal({ title: '👥 اختيار المعلم البديل', body, wide: true, actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }] });
    setTimeout(() => {
      const w = [...document.querySelectorAll('.modal-wrap')].pop(); if (!w) return;
      w.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-c]'); if (!b) return; b.disabled = true;
        try { await call('sub_assign', { p_id: s.id, p_sub: b.dataset.c, p_note: $('#nt', w).value || null }); w.remove(); toast('أُسندت ✓ — وصل إشعار للمعلم'); dayView(); }
        catch (er) { b.disabled = false; toast(errMsg(er), 'err'); }
      });
    }, 0);
  }

  /* ---------------- حصصي ---------------- */
  async function mineView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('sub_mine'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const today = iso(new Date());
    const up = L.filter((x) => x.day >= today), past = L.filter((x) => x.day < today);
    const row = (x) => `<div class="glass mine-row"><div class="p">${x.period}</div><div class="grow"><b>${esc(x.cls || '')}</b>${x.subject ? ' — ' + esc(x.subject) : ''}
        <div class="hint">${dayName(x.day)} ${x.day}${x.day === today ? ' · <b style="color:#b3261e">اليوم</b>' : ''} · بدلًا من: ${esc(x.absent || '')}</div>
        ${x.note ? `<div class="hint">📝 ${esc(x.note)}</div>` : ''}</div></div>`;
    view.innerHTML = `<h3>القادمة</h3>${up.map(row).join('') || '<div class="empty">لا توجد حصص انتظار مكلّف بها حاليًا.</div>'}
      ${past.length ? `<h3 style="margin-top:16px">آخر أسبوع</h3>${past.reverse().map(row).join('')}` : ''}`;
  }

  /* ---------------- الإحصاءات ---------------- */
  async function statsView() {
    const d = new Date(); const f0 = iso(new Date(d.getFullYear(), d.getMonth(), 1)), t0 = iso(d);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><label class="hint">من <input type="date" id="f" value="${f0}"></label>
      <label class="hint">إلى <input type="date" id="t" value="${t0}"></label><button class="btn sm primary" id="go">عرض</button><span class="grow"></span>
      <label class="hint">الحد الأقصى لحصص الانتظار للمعلم يوميًا: <select id="mx">${[1, 2, 3, 4].map((n) => `<option>${n}</option>`).join('')}</select></label></div><div id="st"></div>`;
    const load = async () => {
      try {
        const S = await call('sub_stats', { p_from: $('#f').value, p_to: $('#t').value });
        $('#st').innerHTML = `<div class="kpi4"><div class="glass card-box"><b>${S.absences}</b>يوم غياب</div><div class="glass card-box"><b>${S.slots}</b>حصة احتاجت تغطية</div>
          <div class="glass card-box"><b style="color:#007B51">${S.covered}</b>غُطّيت</div><div class="glass card-box"><b>${S.slots ? Math.round(S.covered * 100 / S.slots) : 0}%</b>نسبة التغطية</div></div>
          <div class="grid-2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
          <div class="glass ab-card"><b>🙌 أكثر المعلمين تغطية</b><table><tbody>${S.subs.map((x) => `<tr><td>${esc(x.name)}</td><td><b>${x.n}</b></td></tr>`).join('') || '<tr><td class="hint">—</td></tr>'}</tbody></table></div>
          <div class="glass ab-card"><b>📅 الغياب حسب المعلم</b><table><thead><tr><th>المعلم</th><th>أيام</th><th>حصص</th></tr></thead><tbody>${S.absent.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.days}</td><td>${x.periods}</td></tr>`).join('') || '<tr><td class="hint" colspan="3">—</td></tr>'}</tbody></table></div></div>`;
      } catch (e) { $('#st').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
    };
    try { const d0 = await call('sub_day', { p_day: DAY }); $('#mx').value = String(d0.max); } catch (e) { /* */ }
    $('#mx').onchange = async (e) => { try { await call('sub_settings_set', { p_max: +e.target.value }); toast('حُفظ الحد اليومي ✓'); } catch (er) { toast(errMsg(er), 'err'); } };
    $('#go').onclick = load; load();
  }

  paint();
})();
