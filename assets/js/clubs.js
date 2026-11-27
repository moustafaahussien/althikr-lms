/* =====================================================================
   النوادي المدرسية (sql/81)
   رائد النشاط ينشئ النوادي ويعيّن مشرفيها ← الطالب يطلب الانضمام ← المشرف يقبل ويسجل اللقاءات والحضور والإنجازات
   الطالب يرى أيضًا «مشاركاتي»: النوادي والأنشطة والرحلات وحافلته
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (ctx.profile.role === 'parent' || !LMS.betaAllowed('clubs', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const FIELD = { scientific: '🔬 علمي', tech: '🤖 تقني', sports: '⚽ رياضي', arts: '🎨 فني', cultural: '📚 ثقافي', social: '🤝 اجتماعي وتطوعي', religious: '🕌 ديني', other: '⭐ متنوع' };
  const MODE = { open: 'انضمام مباشر', approval: 'بموافقة المشرف', closed: 'التسجيل مغلق' };
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const STU = ctx.profile.role === 'student';
  let D, LISTS = {};
  const reload = async () => { D = await call('cb_list'); };
  try { await reload(); if (!STU) LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const MGR = D.role === 'mgr';
  const tabs = STU ? [['clubs', '⭐ النوادي'], ['mine', '🏅 مشاركاتي']] : [['clubs', '⭐ النوادي']].concat(MGR ? [['settings', '⚙️ الإعدادات']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'clubs';
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return TAB === 'mine' ? mineView() : TAB === 'settings' ? settingsView() : (STU ? studentView() : staffView()); };

  /* ---------- الطالب ---------- */
  async function studentView() {
    await reload();
    const mine = D.clubs.filter((c) => ['active', 'pending'].includes(c.my)).length;
    view.innerHTML = `<p class="hint">يمكنك الانضمام إلى ${D.max} ${D.max > 2 ? 'نوادٍ' : 'ناديين'} كحد أقصى — أنت الآن في ${mine}.</p><div class="grid modules">${D.clubs.map((c) => `<div class="module glass club" style="text-align:start">
        <span class="ic">${esc(c.icon)}</span><b>${esc(c.name)}</b><small>${esc(FIELD[c.field] || '')} · المشرف: ${esc(c.supervisor || '—')}</small>
        ${c.description ? `<small>${esc(c.description)}</small>` : ''}<small>${c.schedule ? '🗓️ ' + esc(c.schedule) : ''}${c.place ? ' · 📍 ' + esc(c.place) : ''}</small>
        <small>👥 ${c.members}${c.capacity ? ' / ' + c.capacity : ''} عضو</small>
        <div style="margin-top:6px">${c.my === 'active' ? `<span class="pill ok">✓ عضو</span> <button class="btn sm ghost" data-lv="${c.id}">انسحاب</button>` : c.my === 'pending' ? `<span class="pill gold">⏳ بانتظار موافقة المشرف</span> <button class="btn sm ghost" data-lv="${c.id}">إلغاء الطلب</button>`
          : c.join_mode === 'closed' ? '<span class="pill">التسجيل مغلق</span>' : c.capacity && c.members >= c.capacity ? '<span class="pill bad">مكتمل</span>' : `<button class="btn sm primary" data-jn="${c.id}">${c.join_mode === 'open' ? 'انضم الآن' : 'اطلب الانضمام'}</button>`}</div></div>`).join('')
      || '<div class="empty">لا توجد نوادٍ متاحة لصفك حاليًا.</div>'}</div>`;
    view.onclick = async (e) => {
      const j = e.target.closest('[data-jn]'), l = e.target.closest('[data-lv]');
      try { if (j) { const r = await call('cb_join', { p_id: +j.dataset.jn }); toast(r.status === 'active' ? 'انضممت للنادي ✓' : 'أُرسل طلبك للمشرف ✓'); studentView(); }
        if (l) { if (!await confirmBox('الانسحاب من النادي؟', 'انسحاب')) return; await call('cb_leave', { p_id: +l.dataset.lv }); studentView(); } } catch (er) { toast(errMsg(er), 'err'); }
    };
  }
  async function mineView() {
    let M; try { M = await call('cs_my'); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
    const t = M.transport, ROLE = { participant: 'مشارك', organizer: 'منظم', winner: '🏆 فائز', honored: '🎖️ مكرَّم' };
    const BS = { boarded: '✅ ركب الحافلة', arrived: '✅ وصل', absent: '✖ لم يركب' };
    view.innerHTML = `<div class="row2">
      <div class="glass xc"><h3 style="margin-top:0">🚌 حافلتي</h3>${t ? `<p><b>${esc(t.route)}</b>${t.bus_no ? ' — حافلة ' + esc(t.bus_no) : ''}</p><p class="hint">📍 ${esc(t.stop || '—')} · 🌅 ${esc(t.am_time || '—')} · 🌇 ${esc(t.pm_time || '—')}</p>
        <p class="hint">👨‍✈️ ${esc(t.driver_name || '—')} · 👤 المشرف: ${esc(t.supervisor || '—')}</p><p>اليوم: ${t.today_am ? BS[t.today_am] : '—'}${t.today_pm ? ' · العودة: ' + BS[t.today_pm] : ''}</p>` : '<p class="hint">غير مشترك في النقل المدرسي.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">⭐ نواديّ</h3>${M.clubs.map((c) => `<p>${esc(c.icon)} <b>${esc(c.name)}</b> ${c.status === 'pending' ? '<span class="pill gold">بانتظار الموافقة</span>' : ''}<br><span class="hint">${esc(c.schedule || '')}${c.place ? ' · ' + esc(c.place) : ''}</span></p>`).join('') || '<p class="hint">لست عضوًا في نادٍ بعد.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">🎯 مشاركاتي في الأنشطة</h3>${M.activities.map((a) => `<p><b>${esc(a.title)}</b> <span class="pill">${esc(a.kind)}</span> ${ROLE[a.role] || ''}<br><span class="hint">${esc(a.day)}${a.note ? ' · ' + esc(a.note) : ''}</span></p>`).join('') || '<p class="hint">لا مشاركات مسجلة.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">📚 كتبي المستلمة</h3>${(M.books || []).map((b) => `<span class="pill" style="margin:2px">${esc(b.subject || '')} ${esc(b.title)}</span>`).join('') || '<p class="hint">لم تُسجَّل كتب مستلمة.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">🚍 الرحلات</h3>${M.trips.map((r) => `<p><b>${esc(r.title)}</b> — ${esc(r.destination)}<br><span class="hint">${esc(r.day)}${r.depart_time ? ' · ' + esc(r.depart_time) : ''} · موافقة ولي الأمر: ${r.consent === 'yes' ? '✅' : r.consent === 'no' ? '✖' : '⏳'}</span></p>`).join('') || '<p class="hint">لا رحلات.</p>'}</div></div>`;
  }

  /* ---------- الموظفون ---------- */
  function staffView() {
    const mine = D.clubs.filter((c) => c.can && !MGR), rest = MGR ? D.clubs : D.clubs.filter((c) => !c.can);
    const cardH = (c) => `<div class="glass xc" style="${c.active ? '' : 'opacity:.55'}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:1.5rem">${esc(c.icon)}</span><b>${esc(c.name)}</b>
        <span class="pill">${esc(FIELD[c.field] || '')}</span>${c.pending ? `<span class="pill gold">${c.pending} طلب انضمام</span>` : ''}${c.active ? '' : '<span class="pill">موقوف</span>'}</div>
      <div class="hint">👤 ${esc(c.supervisor || 'بدون مشرف')}${c.co.length ? ' + ' + esc(c.co.join('، ')) : ''} · 🎯 ${esc(c.grades)} · 👥 ${c.members}${c.capacity ? '/' + c.capacity : ''} · 🗓️ ${c.sessions} لقاء · ${MODE[c.join_mode]}</div>
      ${c.can ? `<div class="acts"><button class="btn sm primary" data-op="${c.id}">📂 إدارة النادي</button><button class="btn sm" data-ed="${c.id}">✏️</button>${MGR ? `<button class="btn sm danger" data-dl="${c.id}">🗑️</button>` : ''}</div>` : ''}</div>`;
    view.innerHTML = `${MGR ? '<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="nc">＋ نادٍ جديد</button></div>' : ''}
      ${mine.length ? `<h3>⭐ نوادٍ أشرف عليها</h3>${mine.map(cardH).join('')}<h3>كل النوادي</h3>` : ''}${rest.map(cardH).join('') || '<div class="empty">لا توجد نوادٍ بعد.' + (MGR ? ' أنشئ أول نادٍ.' : '') + '</div>'}`;
    if (MGR) $('#nc').onclick = () => clubForm({ icon: '⭐', field: 'scientific', grade_ids: [], co_ids: [], join_mode: 'approval', active: true });
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const c = D.clubs.find((x) => x.id === +(b.dataset.op || b.dataset.ed || b.dataset.dl));
      if (b.dataset.ed) clubForm(c); if (b.dataset.op) openClub(c.id);
      if (b.dataset.dl) { if (!await confirmBox(`حذف «${c.name}»؟ (إن كانت له لقاءات سيُوقف بدل الحذف)`, 'حذف')) return; try { await call('cb_delete', { p_id: c.id }); await reload(); staffView(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function clubForm(c) {
    const staff = LISTS.staff || [], grades = LISTS.grades || [];
    modal({ title: c.id ? '✏️ ' + c.name : '＋ نادٍ جديد', wide: true, body: `<div class="form-grid"><label class="f">اسم النادي<input id="n" value="${esc(c.name || '')}"></label><label class="f">رمز<input id="ic" value="${esc(c.icon)}" maxlength="4"></label>
        <label class="f">المجال<select id="fd">${Object.entries(FIELD).map(([k, l]) => `<option value="${k}" ${k === c.field ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${MGR ? `<label class="f">المشرف<select id="sp"><option value="">—</option>${staff.map((s) => `<option value="${s.id}" ${s.id === c.supervisor_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <label class="f">السعة<input type="number" id="cp" value="${c.capacity ?? ''}"></label><label class="f">طريقة الانضمام<select id="jm">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${k === c.join_mode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">الموعد<input id="sc" value="${esc(c.schedule || '')}" placeholder="مثال: الثلاثاء الحصة السابعة"></label><label class="f">المكان<input id="pl" value="${esc(c.place || '')}"></label></div>
      <label class="f">وصف النادي (يظهر للطلاب)<textarea id="ds" rows="2">${esc(c.description || '')}</textarea></label>
      ${MGR ? `<details><summary><b>👥 مشرفون مساعدون</b></summary><div style="columns:3 180px">${staff.map((s) => `<label class="chk"><input type="checkbox" data-co="${s.id}" ${c.co_ids.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></details>` : ''}
      <details ${c.grade_ids.length ? 'open' : ''}><summary><b>🎯 الصفوف المستهدفة</b> <span class="hint">(بدون تحديد = كل الصفوف)</span></summary><div style="columns:3 180px">${grades.map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" ${c.grade_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div></details>
      <label class="chk"><input type="checkbox" id="ac" ${c.active !== false ? 'checked' : ''}> النادي فعّال</label>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const p = { id: c.id || '', name: $('#n', w).value, icon: $('#ic', w).value, field: $('#fd', w).value, capacity: $('#cp', w).value, join_mode: $('#jm', w).value, schedule: $('#sc', w).value, place: $('#pl', w).value,
          description: $('#ds', w).value, grade_ids: $$('[data-g]:checked', w).map((x) => +x.dataset.g), active: $('#ac', w).checked };
        if (MGR) Object.assign(p, { supervisor_id: $('#sp', w).value, co_ids: $$('[data-co]:checked', w).map((x) => x.dataset.co) });
        await call('cb_save', { p }); toast('تم الحفظ ✓'); await reload(); staffView(); return true; } }] });
  }
  async function openClub(id) {
    const box = document.createElement('div'); let C, sub = 'members';
    const load = async () => { C = await call('cb_get', { p_id: id }); draw(); };
    function draw() {
      const act = C.roster.filter((m) => m.status === 'active'), pend = C.roster.filter((m) => m.status === 'pending');
      box.innerHTML = `<div class="seg" style="margin-bottom:8px"><button data-sub="members" class="${sub === 'members' ? 'on' : ''}">👥 الأعضاء (${act.length})</button><button data-sub="sessions" class="${sub === 'sessions' ? 'on' : ''}">🗓️ اللقاءات (${C.sessions_list.length})</button><button data-sub="ach" class="${sub === 'ach' ? 'on' : ''}">🏆 الإنجازات (${C.achievements.length})</button></div>
        ${sub === 'members' ? `${pend.length ? `<div class="notice warn"><b>طلبات انضمام (${pend.length})</b>${pend.map((m) => `<div style="display:flex;gap:6px;align-items:center;margin:4px 0"><span style="flex:1">${esc(m.name)} <span class="hint">${esc(m.class || '')}</span></span>
            <button class="btn sm primary" data-ms="${m.id}" data-v="active">قبول</button><button class="btn sm" data-ms="${m.id}" data-v="rejected">رفض</button></div>`).join('')}</div>` : ''}
          <input id="sq" placeholder="🔎 أضف طالبًا مباشرة" style="width:100%"><div id="sr" class="res"></div>
          <table class="t"><thead><tr><th>الطالب</th><th>الحضور</th><th></th></tr></thead><tbody>${act.map((m) => `<tr><td><b>${esc(m.name)}</b> ${m.role === 'leader' ? '<span class="pill gold">⭐ قائد</span>' : ''}<div class="hint">${esc(m.class || '')}</div></td>
            <td>${m.held ? `${m.attended}/${m.held}` : '—'}</td><td><button class="btn sm" data-ld="${m.id}" data-v="${m.role === 'leader' ? 'member' : 'leader'}">${m.role === 'leader' ? 'إلغاء القيادة' : '⭐ قائد'}</button>
            <button class="btn sm danger" data-ms="${m.id}" data-v="left">إخراج</button></td></tr>`).join('') || '<tr><td colspan="3" class="hint">لا أعضاء بعد.</td></tr>'}</tbody></table>` : ''}
        ${sub === 'sessions' ? `<button class="btn sm primary" id="ns">＋ تسجيل لقاء وحضور</button>${C.sessions_list.map((s) => `<div class="lg"><b>${esc(s.day)}</b> — ${esc(s.topic)} <span class="hint">غياب: ${s.absent.length}</span>${s.notes ? `<div class="hint">${esc(s.notes)}</div>` : ''}</div>`).join('')}` : ''}
        ${sub === 'ach' ? `<button class="btn sm primary" id="na">＋ إنجاز</button>${C.achievements.map((a) => `<div class="lg"><b>🏆 ${esc(a.title)}</b> <span class="hint">${esc(a.day)}</span> <button class="btn sm ghost" data-ad="${a.id}">✕</button>
            ${a.details ? `<div>${esc(a.details)}</div>` : ''}${a.students.length ? `<div class="hint">${esc(a.students.join('، '))}</div>` : ''}</div>`).join('')}` : ''}`;
      const sq = $('#sq', box); let t;
      if (sq) sq.oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { const R = e.target.value.trim().length < 2 ? [] : await call('cs_student_search', { p_q: e.target.value });
        $('#sr', box).innerHTML = R.map((s) => `<div data-add="${s.id}">${esc(s.name)} <span class="hint">${esc(s.class || '')}</span></div>`).join(''); }, 300); };
    }
    box.onclick = async (e) => {
      const b = e.target.closest('[data-sub],[data-ms],[data-ld],[data-add],[data-ad],#ns,#na'); if (!b) return;
      try {
        if (b.dataset.sub) { sub = b.dataset.sub; return draw(); }
        if (b.dataset.ms) { await call('cb_member_set', { p_club: id, p_student: b.dataset.ms, p_status: b.dataset.v, p_role: null }); return load(); }
        if (b.dataset.ld) { await call('cb_member_set', { p_club: id, p_student: b.dataset.ld, p_status: null, p_role: b.dataset.v }); return load(); }
        if (b.dataset.add) { await call('cb_member_set', { p_club: id, p_student: b.dataset.add, p_status: 'active', p_role: null }); toast('أُضيف ✓'); return load(); }
        if (b.dataset.ad) { await call('cb_achievement_save', { p: { club_id: id, id: +b.dataset.ad, delete: true } }); return load(); }
        const act = C.roster.filter((m) => m.status === 'active');
        if (b.id === 'ns') modal({ title: '🗓️ لقاء جديد — ' + C.name, body: `<div class="form-grid"><label class="f">التاريخ<input type="date" id="d" value="${today()}"></label><label class="f">الموضوع<input id="tp"></label></div>
            <label class="f">ملاحظات<input id="nt"></label><p><b>الحضور</b> <span class="hint">(ألغِ علامة الغائب)</span></p>${act.map((m) => `<label class="chk"><input type="checkbox" data-pr="${m.id}" checked> ${esc(m.name)}</label>`).join('') || '<p class="hint">لا أعضاء.</p>'}`,
          actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
            await call('cb_session_save', { p: { club_id: id, day: $('#d', w).value, topic: $('#tp', w).value, notes: $('#nt', w).value, absent: $$('[data-pr]', w).filter((x) => !x.checked).map((x) => x.dataset.pr) } });
            toast('تم ✓'); load(); return true; } }] });
        if (b.id === 'na') modal({ title: '🏆 إنجاز للنادي', body: `<div class="form-grid"><label class="f">الإنجاز<input id="tt" placeholder="مثال: المركز الأول في مسابقة الروبوت"></label><label class="f">التاريخ<input type="date" id="d" value="${today()}"></label></div>
            <label class="f">تفاصيل<textarea id="dt" rows="2"></textarea></label><p><b>الطلاب أصحاب الإنجاز</b></p>${act.map((m) => `<label class="chk"><input type="checkbox" data-st="${m.id}"> ${esc(m.name)}</label>`).join('')}`,
          actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
            await call('cb_achievement_save', { p: { club_id: id, title: $('#tt', w).value, day: $('#d', w).value, details: $('#dt', w).value, students: $$('[data-st]:checked', w).map((x) => x.dataset.st) } });
            toast('تم ✓'); load(); return true; } }] });
      } catch (er) { toast(errMsg(er), 'err'); }
    };
    try { await load(); } catch (e) { toast(errMsg(e), 'err'); return; }
    modal({ title: `${C.icon} ${C.name}`, wide: true, body: box, actions: [{ label: 'إغلاق', value: null }] }).then(async () => { await reload(); staffView(); });
  }
  function settingsView() {
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">⚙️ إعدادات النوادي</h3><label class="f" style="max-width:300px">الحد الأقصى للنوادي لكل طالب<input type="number" id="mx" min="1" max="10" value="${D.max}"></label>
      <p class="hint">👥 رائد النشاط (المسمى الوظيفي يحتوي «نشاط» أو «رائد») والإدارة: إنشاء النوادي وتعيين المشرفين. مشرف النادي: الأعضاء واللقاءات والإنجازات.</p><button class="btn primary" id="sv">حفظ</button></div>`;
    $('#sv').onclick = async () => { try { await call('cb_settings_set', { p_max: +$('#mx').value }); toast('تم ✓'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  paint();
})();
