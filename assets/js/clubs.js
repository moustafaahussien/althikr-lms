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
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const ATT = { present: ['✅', 'حاضر', 'ok'], late: ['⏰', 'متأخر', 'gold'], absent: ['✖', 'غائب', 'bad'], excused: ['📝', 'مستأذن', ''] };
  const t12 = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'ص' : 'م'}`; };
  const when = (c) => c.train_days && c.train_days.length ? `🗓️ ${esc(c.days_label || c.days || '')}${c.time_from ? ` · ⏰ ${t12(c.time_from)}${c.time_to ? '–' + t12(c.time_to) : ''}` : ''}` : (c.schedule ? '🗓️ ' + esc(c.schedule) : '');
  // ملف تقويم (ics) بتكرار أسبوعي — يُضاف لتقويم الجوال (جوجل/آيفون/أوتلوك)
  function ics(c) {
    if (!c.train_days || !c.train_days.length) { toast('لم تُحدَّد أيام التدريب لهذا النادي', 'warn'); return; }
    const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'], pad = (n) => String(n).padStart(2, '0');
    const d0 = new Date(Math.max(Date.now() - 864e5, c.starts_on ? new Date(c.starts_on + 'T00:00:00') : 0));
    while (!c.train_days.includes(d0.getDay())) d0.setDate(d0.getDate() + 1);
    const ymd = `${d0.getFullYear()}${pad(d0.getMonth() + 1)}${pad(d0.getDate())}`, hm = (t, def) => (t || def).replace(':', '') + '00';
    const until = c.ends_on ? `;UNTIL=${c.ends_on.replace(/-/g, '')}T235959` : `;COUNT=60`;
    const txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Althikr LMS//Clubs//AR', 'BEGIN:VEVENT', `UID:club-${c.id}@althikr-lms`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
      `DTSTART;TZID=Asia/Riyadh:${ymd}T${hm(c.time_from, '13:30')}`, `DTEND;TZID=Asia/Riyadh:${ymd}T${hm(c.time_to || c.time_from, '14:30')}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${c.train_days.map((d) => BY[d]).join(',')}${until}`, `SUMMARY:${c.icon || ''} تدريب ${c.name}`,
      `LOCATION:${(c.place || '').replace(/[,;]/g, ' ')}`, `DESCRIPTION:المدرب: ${(c.coach || '—').replace(/[,;]/g, ' ')}`, 'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:تذكير بالتدريب', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar;charset=utf-8' })); a.download = `club-${c.id}.ics`; a.click();
    toast('افتح الملف الذي نزل وأضفه لتقويمك ✓');
  }
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
        <span class="ic">${esc(c.icon)}</span><button class="nm-link" data-op="${c.id}" title="فتح صفحة النادي">${esc(c.name)}</button><small>${esc(FIELD[c.field] || '')} · المشرف: ${esc(c.supervisor || '—')}${c.coach ? ' · المدرب: ' + esc(c.coach) : ''}</small>
        ${c.description ? `<small>${esc(c.description)}</small>` : ''}<small>${when(c)}${c.place ? ' · 📍 ' + esc(c.place) : ''}</small>
        <small>👥 ${c.members}${c.capacity ? ' / ' + c.capacity : ''} عضو</small>
        <div style="margin-top:6px">${c.my === 'active' ? `<span class="pill ok">✓ عضو</span> <button class="btn sm" data-ics="${c.id}">📅 أضف لتقويمي</button> <button class="btn sm ghost" data-lv="${c.id}">انسحاب</button>` : c.my === 'pending' ? `<span class="pill gold">⏳ بانتظار موافقة المشرف</span> <button class="btn sm ghost" data-lv="${c.id}">إلغاء الطلب</button>`
          : c.join_mode === 'closed' ? '<span class="pill">التسجيل مغلق</span>' : c.capacity && c.members >= c.capacity ? '<span class="pill bad">مكتمل</span>' : `<button class="btn sm primary" data-jn="${c.id}">${c.join_mode === 'open' ? 'انضم الآن' : 'اطلب الانضمام'}</button>`}</div></div>`).join('')
      || '<div class="empty">لا توجد نوادٍ متاحة لصفك حاليًا.</div>'}</div>`;
    view.onclick = async (e) => {
      const op = e.target.closest('[data-op]'); if (op) return openClub(+op.dataset.op);
      const ic = e.target.closest('[data-ics]'); if (ic) return ics(D.clubs.find((x) => x.id === +ic.dataset.ics));
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
      <div class="glass xc"><h3 style="margin-top:0">⭐ نواديّ</h3>${M.clubs.map((c) => `<p>${esc(c.icon)} <button class="nm-link" data-op="${c.id}">${esc(c.name)}</button> ${c.status === 'pending' ? '<span class="pill gold">بانتظار الموافقة</span>' : ''}<br><span class="hint">${when(c)}${c.place ? ' · ' + esc(c.place) : ''}${c.coach ? ' · المدرب: ' + esc(c.coach) : ''}</span>${c.held ? `<br><span class="hint">حضرت ${c.attended} من ${c.held} تدريب</span>` : ''}</p>`).join('') || '<p class="hint">لست عضوًا في نادٍ بعد.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">🎯 مشاركاتي في الأنشطة</h3>${M.activities.map((a) => `<p><b>${esc(a.title)}</b> <span class="pill">${esc(a.kind)}</span> ${ROLE[a.role] || ''}<br><span class="hint">${esc(a.day)}${a.note ? ' · ' + esc(a.note) : ''}</span></p>`).join('') || '<p class="hint">لا مشاركات مسجلة.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">📚 كتبي المستلمة</h3>${(M.books || []).map((b) => `<span class="pill" style="margin:2px">${esc(b.subject || '')} ${esc(b.title)}</span>`).join('') || '<p class="hint">لم تُسجَّل كتب مستلمة.</p>'}</div>
      <div class="glass xc"><h3 style="margin-top:0">🚍 الرحلات</h3>${M.trips.map((r) => `<p><b>${esc(r.title)}</b> — ${esc(r.destination)}<br><span class="hint">${esc(r.day)}${r.depart_time ? ' · ' + esc(r.depart_time) : ''} · موافقة ولي الأمر: ${r.consent === 'yes' ? '✅' : r.consent === 'no' ? '✖' : '⏳'}</span></p>`).join('') || '<p class="hint">لا رحلات.</p>'}</div></div>`;
    view.onclick = (e) => { const op = e.target.closest('[data-op]'); if (op && op.dataset.op) openClub(+op.dataset.op); };
  }

  /* ---------- الموظفون ---------- */
  function staffView() {
    const mine = D.clubs.filter((c) => c.can && !MGR), rest = MGR ? D.clubs : D.clubs.filter((c) => !c.can);
    const cardH = (c) => `<div class="glass xc" style="${c.active ? '' : 'opacity:.55'}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:1.5rem">${esc(c.icon)}</span><button class="nm-link" data-op="${c.id}" title="فتح صفحة النادي">${esc(c.name)}</button>
        <span class="pill">${esc(FIELD[c.field] || '')}</span>${c.pending ? `<span class="pill gold">${c.pending} طلب انضمام</span>` : ''}${c.active ? '' : '<span class="pill">موقوف</span>'}</div>
      <div class="hint">👤 المشرف: ${esc(c.supervisor || '—')}${c.co.length ? ' + ' + esc(c.co.join('، ')) : ''} · 🧭 مشرف الأنشطة: ${esc(c.activity_sup || '—')} · 🏅 المدرب: ${esc(c.coach || '—')}</div>
      <div class="hint">${when(c) || '🗓️ لم تُحدَّد أيام التدريب'}${c.place ? ' · 📍 ' + esc(c.place) : ''} · 🎯 ${esc(c.grades)} · 👥 ${c.members}${c.capacity ? '/' + c.capacity : ''} · ${c.sessions} تدريب مسجل · ${MODE[c.join_mode]}</div>
      ${c.today && c.active ? `<div style="margin-top:4px"><span class="pill ${c.today_done ? 'ok' : 'gold'}">${c.today_done ? '✓ سُجّل حضور تدريب اليوم' : '⏰ تدريب اليوم — لم يُسجَّل الحضور'}</span></div>` : ''}
      ${c.can ? `<div class="acts">${c.today && c.active ? `<button class="btn sm primary" data-att="${c.id}">✅ حضور اليوم</button>` : ''}<button class="btn sm ${c.today ? '' : 'primary'}" data-op="${c.id}">📂 صفحة النادي</button><button class="btn sm" data-ics="${c.id}">📅 أضف لتقويمي</button><button class="btn sm" data-ed="${c.id}">✏️</button>${MGR ? `<button class="btn sm danger" data-dl="${c.id}">🗑️</button>` : ''}</div>` : ''}</div>`;
    view.innerHTML = `${MGR ? '<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="nc">＋ نادٍ جديد</button></div>' : ''}
      ${mine.length ? `<h3>⭐ نوادٍ أشرف عليها</h3>${mine.map(cardH).join('')}<h3>كل النوادي</h3>` : ''}${rest.map(cardH).join('') || '<div class="empty">لا توجد نوادٍ بعد.' + (MGR ? ' أنشئ أول نادٍ.' : '') + '</div>'}`;
    if (MGR) $('#nc').onclick = () => clubForm({ icon: '⭐', field: 'scientific', grade_ids: [], co_ids: [], join_mode: 'approval', active: true });
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const c = D.clubs.find((x) => x.id === +(b.dataset.op || b.dataset.ed || b.dataset.dl || b.dataset.att || b.dataset.ics)); if (!c) return;
      if (b.dataset.ed) clubForm(c); if (b.dataset.op) openClub(c.id); if (b.dataset.att) openClub(c.id, 'att'); if (b.dataset.ics) ics(c);
      if (b.dataset.dl) { if (!await confirmBox(`حذف «${c.name}»؟ (إن كانت له لقاءات سيُوقف بدل الحذف)`, 'حذف')) return; try { await call('cb_delete', { p_id: c.id }); await reload(); staffView(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function clubForm(c) {
    const staff = LISTS.staff || [], grades = LISTS.grades || [];
    return modal({ title: c.id ? '✏️ ' + c.name : '＋ نادٍ جديد', wide: true, body: `<div class="form-grid"><label class="f">اسم النادي<input id="n" value="${esc(c.name || '')}"></label><label class="f">رمز<input id="ic" value="${esc(c.icon)}" maxlength="4"></label>
        <label class="f">المجال<select id="fd">${Object.entries(FIELD).map(([k, l]) => `<option value="${k}" ${k === c.field ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${MGR ? `<label class="f">مشرف النادي<select id="sp"><option value="">—</option>${staff.map((s) => `<option value="${s.id}" ${s.id === c.supervisor_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="f">مشرف الأنشطة<select id="as"><option value="">—</option>${staff.map((s) => `<option value="${s.id}" ${s.id === c.activity_sup_id ? 'selected' : ''}>${esc(s.name)}${s.job ? ' — ' + esc(s.job) : ''}</option>`).join('')}</select></label>
        <label class="f">المدرب (من المنسوبين)<select id="ch"><option value="">— مدرب من خارج المدرسة —</option>${staff.map((s) => `<option value="${s.id}" ${s.id === c.coach_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="f">أو اسم المدرب الخارجي<input id="cn" value="${esc(c.coach_name || '')}"></label><label class="f">جوال المدرب<input id="cph" dir="ltr" value="${esc(c.coach_phone || '')}"></label>` : ''}
        <label class="f">السعة<input type="number" id="cp" value="${c.capacity ?? ''}"></label><label class="f">طريقة الانضمام<select id="jm">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${k === c.join_mode ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">المكان<input id="pl" value="${esc(c.place || '')}"></label></div>
      <div class="glass" style="padding:10px;margin:8px 0"><b>🗓️ أيام التدريب الأسبوعية</b> <span class="hint">(تظهر تلقائيًا في التقويم الشخصي للمشرف والمدرب والطلاب الأعضاء)</span>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin:6px 0">${DAYS.map((d, i) => `<label class="chk" style="margin:0"><input type="checkbox" data-day="${i}" ${(c.train_days || []).includes(i) ? 'checked' : ''}> ${d}</label>`).join('')}</div>
        <div class="form-grid"><label class="f">من الساعة<input type="time" id="tf" value="${esc(c.time_from || '')}"></label><label class="f">إلى الساعة<input type="time" id="tt" value="${esc(c.time_to || '')}"></label>
          <label class="f">بداية الموسم<input type="date" id="so" value="${esc(c.starts_on || '')}"></label><label class="f">نهاية الموسم<input type="date" id="eo" value="${esc(c.ends_on || '')}"></label></div>
        <label class="f">ملاحظة على الموعد (اختياري)<input id="sc" value="${esc(c.schedule || '')}" placeholder="مثال: بعد نهاية اليوم الدراسي"></label></div>
      <label class="f">وصف النادي (يظهر للطلاب)<textarea id="ds" rows="2">${esc(c.description || '')}</textarea></label>
      ${MGR ? `<details><summary><b>👥 مشرفون مساعدون</b></summary><div style="columns:3 180px">${staff.map((s) => `<label class="chk"><input type="checkbox" data-co="${s.id}" ${c.co_ids.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></details>` : ''}
      <details ${c.grade_ids.length ? 'open' : ''}><summary><b>🎯 الصفوف المستهدفة</b> <span class="hint">(بدون تحديد = كل الصفوف)</span></summary><div style="columns:3 180px">${grades.map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" ${c.grade_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div></details>
      <label class="chk"><input type="checkbox" id="ac" ${c.active !== false ? 'checked' : ''}> النادي فعّال</label>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const p = { id: c.id || '', name: $('#n', w).value, icon: $('#ic', w).value, field: $('#fd', w).value, capacity: $('#cp', w).value, join_mode: $('#jm', w).value, schedule: $('#sc', w).value, place: $('#pl', w).value,
          train_days: $$('[data-day]:checked', w).map((x) => +x.dataset.day), time_from: $('#tf', w).value, time_to: $('#tt', w).value, starts_on: $('#so', w).value, ends_on: $('#eo', w).value,
          description: $('#ds', w).value, grade_ids: $$('[data-g]:checked', w).map((x) => +x.dataset.g), active: $('#ac', w).checked };
        if (MGR) Object.assign(p, { supervisor_id: $('#sp', w).value, activity_sup_id: $('#as', w).value, coach_id: $('#ch', w).value, coach_name: $('#ch', w).value ? '' : $('#cn', w).value, coach_phone: $('#cph', w).value,
          co_ids: $$('[data-co]:checked', w).map((x) => x.dataset.co) });
        await call('cb_save', { p }); toast('تم الحفظ ✓'); await reload(); staffView(); return true; } }] });
  }
  // صفحة النادي الكاملة — تفتح بالضغط على اسم النادي (للجميع: الإدارة والمشرف والمعلمين والطلاب)
  async function openClub(id, first) {
    const box = document.createElement('div'); let C, sub = first || '', DAY = null, attDate = '';
    const TODAY = (() => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); })();
    const load = async () => { C = await call('cb_get', { p_id: id }); if (!sub) sub = C.can ? 'att' : C.student_view ? 'ach' : 'members'; if (sub === 'att' && C.can) await loadDay(); draw(); };
    const loadDay = async () => { DAY = await call('cb_day', { p_club: id, p_day: attDate || TODAY }); attDate = DAY.day; };
    function attView() {
      if (!DAY) return '';
      const L = DAY.students, n = (k) => L.filter((s) => s.status === k).length;
      return `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label class="hint">اليوم <input type="date" id="ad" value="${esc(attDate)}" max="${TODAY}"></label>
          ${DAY.training_day ? '<span class="pill ok">يوم تدريب</span>' : '<span class="pill">ليس من أيام التدريب المحددة</span>'}<span style="flex:1"></span>
          <button class="btn sm primary" data-allst="present">✅ الكل حاضر</button></div>
        <div class="form-grid" style="margin:6px 0"><label class="f">موضوع التدريب<input id="atp" value="${esc(DAY.topic && DAY.topic !== 'تدريب' ? DAY.topic : '')}" placeholder="مثال: برمجة الحساسات"></label><label class="f">ملاحظات<input id="ant" value="${esc(DAY.notes || '')}"></label></div>
        <p class="hint">✅ ${n('present')} · ⏰ ${n('late')} · ✖ ${n('absent')} · 📝 ${n('excused')} · لم يُرصد ${L.filter((s) => !s.status).length} من ${L.length}</p>
        ${L.map((s) => `<div class="rd ${s.status || ''}"><div style="flex:1"><b>${esc(s.name)}</b>${s.role === 'leader' ? ' <span class="pill gold">⭐</span>' : ''}<div class="hint">${esc(s.class || '')}</div></div>
          ${Object.entries(ATT).map(([k, v]) => `<button class="btn sm ${s.status === k ? (v[2] === 'bad' ? 'danger' : 'primary') : ''}" data-as="${s.id}" data-v="${k}" title="${v[1]}">${v[0]}<span class="lbl"> ${v[1]}</span></button>`).join('')}</div>`).join('')
        || '<div class="empty">لا أعضاء في النادي بعد — أضف الطلاب من تبويب «الأعضاء».</div>'}`;
    }
    const kv = (k, v) => `<div class="kv"><div class="k">${k}</div><div class="v">${v || '—'}</div></div>`;
    function draw() {
      const act = C.roster.filter((m) => m.status === 'active'), pend = C.roster.filter((m) => m.status === 'pending'), CAN = !!C.can, SV = !!C.student_view;
      const tot = C.sessions_list.reduce((t, s) => { t.p += s.present + s.late; t.n += s.present + s.late + s.absent + s.excused; return t; }, { p: 0, n: 0 });
      const ma = C.my_att || {};
      const tabs = [CAN && ['att', '✅ الحضور اليومي'], !SV && ['members', `👥 الأعضاء (${act.length})`], !SV && ['sessions', `🗓️ سجل التدريبات (${C.sessions_list.length})`], ['ach', `🏆 الإنجازات (${C.achievements.length})`]].filter(Boolean);
      if (!tabs.some((t) => t[0] === sub)) sub = tabs[0][0];
      box.innerHTML = `<div class="pg-hero"><span class="ic">${esc(C.icon)}</span><div style="flex:1;min-width:200px"><h2>${esc(C.name)}</h2>
          <div style="margin-top:4px"><span class="pill">${esc(FIELD[C.field] || '')}</span> <span class="pill ${C.active ? 'ok' : ''}">${C.active ? 'نشط' : 'موقوف'}</span> <span class="pill">${MODE[C.join_mode] || ''}</span>
          ${C.pending && CAN ? `<span class="pill gold">${C.pending} طلب انضمام</span>` : ''}${SV && C.my === 'active' ? `<span class="pill ok">✓ أنت عضو${C.my_role === 'leader' ? ' — ⭐ قائد' : ''}</span>` : ''}${SV && C.my === 'pending' ? '<span class="pill gold">⏳ طلبك بانتظار الموافقة</span>' : ''}</div></div>
          <div class="acts" style="display:flex;gap:6px;flex-wrap:wrap">${C.train_days && C.train_days.length ? '<button class="btn sm" data-pics="1">📅 أضف لتقويمي</button>' : ''}
          ${CAN ? '<button class="btn sm" data-ped="1">✏️ تعديل بيانات النادي</button>' : ''}
          ${SV && !C.my && C.active && C.join_mode !== 'closed' && !(C.capacity && C.members >= C.capacity) ? `<button class="btn sm primary" data-pjn="1">${C.join_mode === 'open' ? 'انضم الآن' : 'اطلب الانضمام'}</button>` : ''}
          ${SV && ['active', 'pending'].includes(C.my) ? `<button class="btn sm ghost" data-plv="1">${C.my === 'pending' ? 'إلغاء الطلب' : 'انسحاب'}</button>` : ''}</div></div>
        ${C.description ? `<div class="pg-sec"><h3>📝 عن النادي</h3><div style="white-space:pre-line">${esc(C.description)}</div></div>` : ''}
        <div class="pg-grid">
          ${kv('👤 مشرف النادي', esc(C.supervisor))}${C.co && C.co.length ? kv('👥 المشرفون المساعدون', esc(C.co.join('، '))) : ''}
          ${kv('🧭 مشرف الأنشطة', esc(C.activity_sup))}
          ${kv('🏅 المدرب', esc(C.coach) + (C.coach_id ? ' <span class="hint">(من المنسوبين)</span>' : C.coach ? ' <span class="hint">(من خارج المدرسة)</span>' : '') + (C.coach_phone && !SV ? `<br><a href="tel:${esc(C.coach_phone)}" dir="ltr">${esc(C.coach_phone)}</a>` : ''))}
          ${kv('🗓️ أيام التدريب', C.train_days && C.train_days.length ? esc(C.days_label) : esc(C.schedule || 'لم تُحدَّد'))}
          ${kv('⏰ وقت التدريب', C.time_from ? `${t12(C.time_from)}${C.time_to ? ' – ' + t12(C.time_to) : ''}` : '')}
          ${kv('📆 فترة النادي', C.starts_on || C.ends_on ? `${esc(C.starts_on || '…')} ← ${esc(C.ends_on || '…')}` : 'طوال العام')}
          ${kv('📍 المكان', esc(C.place))}${kv('🎯 الصفوف المستهدفة', esc(C.grades))}
          ${kv('👥 الأعضاء', `${C.members}${C.capacity ? ' من ' + C.capacity : ''}${C.capacity && C.members >= C.capacity ? ' <span class="pill bad">مكتمل</span>' : ''}`)}
          ${kv('🗂️ التدريبات المسجّلة', C.sessions)}
          ${SV ? kv('✅ حضوري', ma.held ? `${Math.round((ma.present + ma.late) * 100 / ma.held)}% <span class="hint">(${ma.present + ma.late} من ${ma.held}${ma.late ? ' · تأخر ' + ma.late : ''}${ma.absent ? ' · غياب ' + ma.absent : ''})</span>` : 'لا يوجد بعد')
            : kv('📊 نسبة الحضور العامة', tot.n ? Math.round(tot.p * 100 / tot.n) + '%' : '')}
          ${kv('🏆 الإنجازات', C.achievements.length)}
        </div>
        <div class="pg-sec"><div class="seg" style="margin-bottom:10px">${tabs.map(([k, l]) => `<button data-sub="${k}" class="${sub === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        ${sub === 'att' && CAN ? attView() : ''}
        ${sub === 'members' ? `${pend.length && CAN ? `<div class="notice warn"><b>طلبات انضمام (${pend.length})</b>${pend.map((m) => `<div style="display:flex;gap:6px;align-items:center;margin:4px 0"><span style="flex:1">${esc(m.name)} <span class="hint">${esc(m.class || '')}</span></span>
            <button class="btn sm primary" data-ms="${m.id}" data-v="active">قبول</button><button class="btn sm" data-ms="${m.id}" data-v="rejected">رفض</button></div>`).join('')}</div>` : ''}
          ${CAN ? '<button class="btn sm primary" id="pick">➕ اختيار الطلاب المشاركين بالاسم</button>' : ''}
          <table class="t"><thead><tr><th>#</th><th>الطالب</th><th>الفصل</th><th>الحضور</th>${CAN ? '<th></th>' : ''}</tr></thead><tbody>${act.map((m, i) => `<tr><td>${i + 1}</td><td><b>${esc(m.name)}</b> ${m.role === 'leader' ? '<span class="pill gold">⭐ قائد</span>' : ''}</td><td class="hint">${esc(m.class || '')}</td>
            <td>${m.held ? `<b>${Math.round(m.attended * 100 / m.held)}%</b> <span class="hint">(${m.attended}/${m.held}${m.late ? ` · تأخر ${m.late}` : ''}${m.absent ? ` · غاب ${m.absent}` : ''})</span>` : '—'}</td>${CAN ? `<td style="white-space:nowrap"><button class="btn sm" data-ld="${m.id}" data-v="${m.role === 'leader' ? 'member' : 'leader'}">${m.role === 'leader' ? 'إلغاء القيادة' : '⭐ قائد'}</button>
            <button class="btn sm danger" data-ms="${m.id}" data-v="left">إخراج</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${CAN ? 5 : 4}" class="hint">لا أعضاء بعد.</td></tr>`}</tbody></table>` : ''}
        ${sub === 'sessions' ? `<table class="t"><thead><tr><th>اليوم</th><th>الموضوع</th><th>✅</th><th>⏰</th><th>✖</th><th>📝</th>${CAN ? '<th></th>' : ''}</tr></thead><tbody>${C.sessions_list.map((s) => `<tr><td><b>${esc(s.day)}</b><div class="hint">${DAYS[new Date(s.day + 'T12:00:00').getDay()]}</div></td><td>${esc(s.topic)}${s.notes ? `<div class="hint">${esc(s.notes)}</div>` : ''}</td>
            <td>${s.present}</td><td>${s.late}</td><td>${s.absent}</td><td>${s.excused}</td>${CAN ? `<td style="white-space:nowrap"><button class="btn sm" data-od="${s.day}">✏️ الحضور</button><button class="btn sm danger" data-sd="${s.id}">🗑️</button></td>` : ''}</tr>`).join('') || `<tr><td colspan="${CAN ? 7 : 6}" class="hint">لم يُسجَّل أي تدريب بعد.</td></tr>`}</tbody></table>` : ''}
        ${sub === 'ach' ? `${CAN ? '<button class="btn sm primary" id="na">＋ إنجاز</button>' : ''}${C.achievements.map((a) => `<div class="lg"><b>🏆 ${esc(a.title)}</b> <span class="hint">${esc(a.day)}</span> ${CAN ? `<button class="btn sm ghost" data-ad="${a.id}">✕</button>` : ''}
            ${a.details ? `<div>${esc(a.details)}</div>` : ''}${a.students.length ? `<div class="hint">${esc(a.students.join('، '))}</div>` : ''}</div>`).join('') || '<p class="hint">لا إنجازات مسجّلة بعد.</p>'}` : ''}</div>`;
    }
    const saveAtt = async (obj) => { await call('cb_att_set', { p_session: DAY.session_id, p: obj, p_topic: ($('#atp', box) || {}).value || null, p_notes: ($('#ant', box) || {}).value ?? null }); await loadDay(); draw(); };
    box.addEventListener('change', async (e) => { try {
      if (e.target.id === 'ad') { attDate = e.target.value; await loadDay(); draw(); }
      if ((e.target.id === 'atp' || e.target.id === 'ant') && DAY) await call('cb_att_set', { p_session: DAY.session_id, p: {}, p_topic: $('#atp', box).value, p_notes: $('#ant', box).value });
    } catch (er) { toast(errMsg(er), 'err'); } });
    box.onclick = async (e) => {
      const b = e.target.closest('[data-sub],[data-ms],[data-ld],[data-ad],[data-as],[data-allst],[data-od],[data-sd],[data-pics],[data-ped],[data-pjn],[data-plv],#pick,#na'); if (!b) return;
      try {
        if (b.dataset.pics) return ics(C);
        if (b.dataset.ped) { await clubForm(C); return load(); }
        if (b.dataset.pjn) { const r = await call('cb_join', { p_id: id }); toast(r.status === 'active' ? 'انضممت للنادي ✓' : 'أُرسل طلبك للمشرف ✓'); return load(); }
        if (b.dataset.plv) { if (!await confirmBox('الانسحاب من النادي؟', 'انسحاب')) return; await call('cb_leave', { p_id: id }); return load(); }
        if (b.dataset.sub) { sub = b.dataset.sub; if (sub === 'att') await loadDay(); return draw(); }
        if (b.dataset.as) { const s = DAY.students.find((x) => x.id === b.dataset.as); return saveAtt({ [s.id]: s.status === b.dataset.v ? '' : b.dataset.v }); }
        if (b.dataset.allst) return saveAtt(Object.fromEntries(DAY.students.filter((s) => !s.status).map((s) => [s.id, 'present'])));
        if (b.dataset.od) { sub = 'att'; attDate = b.dataset.od; await loadDay(); return draw(); }
        if (b.dataset.sd) { if (!await confirmBox('حذف هذا التدريب وحضوره؟', 'حذف')) return; await call('cb_session_delete', { p_session: +b.dataset.sd }); return load(); }
        if (b.dataset.ms) { await call('cb_member_set', { p_club: id, p_student: b.dataset.ms, p_status: b.dataset.v, p_role: null }); return load(); }
        if (b.dataset.ld) { await call('cb_member_set', { p_club: id, p_student: b.dataset.ld, p_status: null, p_role: b.dataset.v }); return load(); }
        if (b.dataset.ad) { await call('cb_achievement_save', { p: { club_id: id, id: +b.dataset.ad, delete: true } }); return load(); }
        if (b.id === 'pick') return pickStudents();
        const act = C.roster.filter((m) => m.status === 'active');
        if (b.id === 'na') modal({ title: '🏆 إنجاز للنادي', body: `<div class="form-grid"><label class="f">الإنجاز<input id="tt" placeholder="مثال: المركز الأول في مسابقة الروبوت"></label><label class="f">التاريخ<input type="date" id="d" value="${TODAY}"></label></div>
            <label class="f">تفاصيل<textarea id="dt" rows="2"></textarea></label><p><b>الطلاب أصحاب الإنجاز</b></p>${act.map((m) => `<label class="chk"><input type="checkbox" data-st="${m.id}"> ${esc(m.name)}</label>`).join('')}`,
          actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
            await call('cb_achievement_save', { p: { club_id: id, title: $('#tt', w).value, day: $('#d', w).value, details: $('#dt', w).value, students: $$('[data-st]:checked', w).map((x) => x.dataset.st) } });
            toast('تم ✓'); load(); return true; } }] });
      } catch (er) { toast(errMsg(er), 'err'); }
    };
    // اختيار الطلاب بالاسم: من فصل كامل أو بالبحث
    function pickStudents() {
      const inClub = new Set(C.roster.map((m) => m.id)), sel = new Map();
      const pb = document.createElement('div');
      pb.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap"><select id="pc" style="flex:1"><option value="">— اختر الفصل لعرض طلابه —</option>${(LISTS.classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        <input id="pq" placeholder="🔎 أو ابحث بالاسم من كل المدرسة" style="flex:1"></div><div id="pl" class="pk" style="max-height:45vh;overflow:auto;margin-top:6px"></div><p class="hint" id="pn">لم تختر أحدًا بعد.</p>`;
      const list = (L) => { $('#pl', pb).innerHTML = (L.length > 1 ? '<label class="chk"><input type="checkbox" id="pall"> <b>تحديد الكل</b></label>' : '') + L.map((s) => `<label class="chk"><input type="checkbox" data-pk="${s.id}" data-nm="${esc(s.name)}" ${sel.has(s.id) || inClub.has(s.id) ? 'checked' : ''} ${inClub.has(s.id) ? 'disabled' : ''}> ${esc(s.name)} <span class="hint">${esc(s.class || s.no || '')}${inClub.has(s.id) ? ' · عضو بالفعل' : ''}</span></label>`).join('') || '<p class="hint">لا نتائج.</p>'; };
      const count = () => { $('#pn', pb).textContent = sel.size ? `تم اختيار ${sel.size} طالب: ${[...sel.values()].join('، ')}` : 'لم تختر أحدًا بعد.'; };
      pb.onchange = async (e) => {
        if (e.target.id === 'pc' && e.target.value) list(await call('cs_class_students', { p_class: +e.target.value }));
        if (e.target.id === 'pall') $$('[data-pk]:not(:disabled)', pb).forEach((c) => { c.checked = e.target.checked; c.checked ? sel.set(c.dataset.pk, c.dataset.nm) : sel.delete(c.dataset.pk); });
        if (e.target.dataset.pk) e.target.checked ? sel.set(e.target.dataset.pk, e.target.dataset.nm) : sel.delete(e.target.dataset.pk);
        count();
      };
      let t; pb.oninput = (e) => { if (e.target.id !== 'pq') return; clearTimeout(t); t = setTimeout(async () => { if (e.target.value.trim().length >= 2) list(await call('cs_student_search', { p_q: e.target.value })); }, 300); };
      modal({ title: '➕ اختيار الطلاب المشاركين — ' + C.name, wide: true, body: pb, actions: [{ label: 'إلغاء', value: null }, { label: 'إضافة المختارين', cls: 'primary', onClick: async () => {
        if (!sel.size) { toast('اختر طالبًا واحدًا على الأقل', 'err'); return false; }
        const r = await call('cb_members_add', { p_club: id, p_students: [...sel.keys()] }); toast(`أُضيف ${r.added} طالب ✓`); sub = 'members'; load(); return true; } }] });
    }
    try { await load(); } catch (e) { toast(errMsg(e), 'err'); return; }
    LMS.openPage(`${C.icon} ${C.name}`, box).then(async () => { await reload(); paint(); });
  }
  function settingsView() {
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">⚙️ إعدادات النوادي</h3><label class="f" style="max-width:300px">الحد الأقصى للنوادي لكل طالب<input type="number" id="mx" min="1" max="10" value="${D.max}"></label>
      <p class="hint">👥 رائد النشاط (المسمى الوظيفي يحتوي «نشاط» أو «رائد») والإدارة: إنشاء النوادي وتعيين المشرفين. مشرف النادي: الأعضاء واللقاءات والإنجازات.</p><button class="btn primary" id="sv">حفظ</button></div>`;
    $('#sv').onclick = async () => { try { await call('cb_settings_set', { p_max: +$('#mx').value }); toast('تم ✓'); await reload(); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  paint();
})();
