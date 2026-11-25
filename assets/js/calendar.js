/* =====================================================================
   تقويم المدرسة الموحّد (sql/55): التقويم الدراسي + أحداث المدرسة + حجوزاتي + مواعيد المسابقات + اختباراتي وواجباتي
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, hijri } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (!LMS.betaAllowed('calendar', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const ymd = LMS.ymd, TODAY = ymd(new Date());
  const KIND = { exam: ['📝', 'اختبارات', '#c0392b'], event: ['🎉', 'فعالية', '#007B51'], meeting: ['🗣️', 'اجتماع', '#509BB9'], holiday: ['🏖️', 'إجازة', '#8e44ad'],
                 visit: ['🧭', 'زيارة', '#b9691b'], deadline: ['⏰', 'موعد نهائي', '#d35400'], booking: ['🔬', 'حجز', '#16a085'], other: ['📌', 'أخرى', '#556'] };
  const ROLES = { leadership: 'الإدارة العليا', principal: 'مديرو المراحل', supervisor: 'المشرفون', teacher: 'المعلمون', staff: 'الموظفون', student: 'الطلاب', parent: 'أولياء الأمور' };
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  let M = new Date(); M.setDate(1); M.setHours(12, 0, 0, 0);
  let D = { manager: false, items: [] }, STAGES = null, MODE = 'month';

  function acadItems(from, to) {
    const A = window.ACAD || { hol: [], other: [] }, out = [];
    (A.hol || []).forEach((h) => { if (h.to >= from && h.f <= to) out.push({ src: 'acad', kind: 'holiday', title: h.ar, date: h.f, end: h.to, note: h.h }); });
    (A.other || []).forEach((o) => { if (o.d >= from && o.d <= to) out.push({ src: 'acad', kind: 'event', title: o.ar, date: o.d, note: o.h }); });
    return out;
  }
  async function load() {
    const first = new Date(M), last = new Date(M.getFullYear(), M.getMonth() + 1, 0, 12);
    const from = ymd(new Date(first.getTime() - first.getDay() * 864e5)), to = ymd(new Date(last.getTime() + (6 - last.getDay()) * 864e5));
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { D = await call('cal_feed', { p_from: from, p_to: to }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    D.items = acadItems(from, to).concat(D.items);
    paint(from, to);
  }
  const onDay = (d) => D.items.filter((x) => d >= x.date && d <= (x.end || x.date));
  const chip = (x) => { const k = KIND[x.kind] || KIND.other; return `<div class="ev" style="--c:${k[2]}" data-ev="${D.items.indexOf(x)}" title="${esc(x.title)}">${k[0]} ${esc(x.title)}${x.period ? ` <small>ح${x.period}</small>` : ''}</div>`; };

  function paint(from, to) {
    const title = M.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
    let grid = DAYS.map((d) => `<div class="h">${d}</div>`).join('');
    for (let t = new Date(from + 'T12:00:00'); ymd(t) <= to; t = new Date(t.getTime() + 864e5)) {
      const d = ymd(t), L = onDay(d), out = t.getMonth() !== M.getMonth();
      grid += `<div class="day ${out ? 'out' : ''} ${d === TODAY ? 'today' : ''} ${t.getDay() >= 5 ? 'wk' : ''}" data-d="${d}"><div class="n">${t.getDate()} <small>${esc(hijri(d).split(' ').slice(0, 2).join(' '))}</small></div>
        ${L.slice(0, 4).map(chip).join('')}${L.length > 4 ? `<div class="more">+${L.length - 4} أخرى</div>` : ''}</div>`;
    }
    const up = D.items.filter((x) => (x.end || x.date) >= TODAY).sort((a, b) => a.date.localeCompare(b.date));
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn sm" id="prv">→</button><b style="min-width:150px;text-align:center">${title}</b><button class="btn sm" id="nxt">←</button>
        <button class="btn sm" id="tdy">هذا الشهر</button><div class="seg"><button data-m="month" class="${MODE === 'month' ? 'on' : ''}">شهر</button><button data-m="list" class="${MODE === 'list' ? 'on' : ''}">قائمة</button></div>
        <span class="grow"></span>${D.manager ? '<button class="btn primary sm" id="add">＋ حدث</button>' : ''}</div>
      <div class="legend">${Object.entries(KIND).map(([, k]) => `<span style="--c:${k[2]}">${k[0]} ${k[1]}</span>`).join('')}</div>
      ${MODE === 'month' ? `<div class="glass card" style="overflow:auto;padding:8px"><div class="cal">${grid}</div></div>`
        : `<div class="glass card">${up.length ? up.map((x) => `<div class="li">${chip(x)}<span class="hint">${esc(x.date)}${x.end && x.end !== x.date ? ' ← ' + esc(x.end) : ''} · ${esc(hijri(x.date))}</span></div>`).join('') : '<div class="empty">لا مواعيد قادمة هذا الشهر.</div>'}</div>`}
      <p class="hint">يجمع التقويم: التقويم الدراسي الرسمي، وأحداث المدرسة التي تخصّك، وحجوزاتك في المختبرات والمرافق${['student', 'parent'].includes(ctx.profile.role) ? '' : '، واختباراتك ومواعيد تسليم واجباتك'}.</p>`;
    $('#prv').onclick = () => { M.setMonth(M.getMonth() - 1); load(); };
    $('#nxt').onclick = () => { M.setMonth(M.getMonth() + 1); load(); };
    $('#tdy').onclick = () => { M = new Date(); M.setDate(1); M.setHours(12, 0, 0, 0); load(); };
    $$('.seg button', view).forEach((b) => b.onclick = () => { MODE = b.dataset.m; paint(from, to); });
    if ($('#add')) $('#add').onclick = () => evForm({ start_date: TODAY, kind: 'event', audience: ['leadership', 'principal', 'supervisor', 'teacher', 'staff'] });
    view.onclick = (e) => {
      const ev = e.target.closest('[data-ev]'); if (ev) return showEv(D.items[+ev.dataset.ev]);
      const day = e.target.closest('[data-d]'); if (day) { const L = onDay(day.dataset.d);
        if (!L.length) { if (D.manager) evForm({ start_date: day.dataset.d, kind: 'event', audience: ['leadership', 'principal', 'supervisor', 'teacher', 'staff'] }); return; }
        modal({ title: `${DAYS[new Date(day.dataset.d + 'T12:00:00').getDay()]} ${day.dataset.d} — ${hijri(day.dataset.d)}`, body: L.map(chip).join(''),
          actions: [{ label: 'إغلاق', value: null }].concat(D.manager ? [{ label: '＋ حدث في هذا اليوم', cls: 'primary', onClick: () => { setTimeout(() => evForm({ start_date: day.dataset.d, kind: 'event', audience: ['leadership', 'principal', 'supervisor', 'teacher', 'staff'] }), 50); return true; } }] : []) });
        setTimeout(() => { const w = document.querySelector('.modal-wrap:last-child'); if (w) w.addEventListener('click', (e2) => { const c = e2.target.closest('[data-ev]'); if (c) { w.remove(); showEv(D.items[+c.dataset.ev]); } }); }, 50); }
    };
  }
  function showEv(x) {
    if (!x) return; const k = KIND[x.kind] || KIND.other;
    modal({ title: `${k[0]} ${x.title}`, body: `<p><b>${esc(x.date)}</b>${x.end && x.end !== x.date ? ' ← <b>' + esc(x.end) + '</b>' : ''} · ${esc(hijri(x.date))}${x.period ? ' · الحصة ' + x.period : ''}</p>
      <p class="hint">${k[1]}${x.stage ? ' · ' + esc(x.stage) : ''}${x.src === 'acad' ? ' · التقويم الدراسي الرسمي' : ''}${x.audience ? ' · لـ: ' + x.audience.map((r) => ROLES[r] || r).join('، ') : ''}</p>
      ${x.note ? `<div class="pre">${esc(x.note)}</div>` : ''}`,
      actions: [{ label: 'إغلاق', value: null }].concat(x.link ? [{ label: 'فتح', cls: 'primary', onClick: () => { location.href = x.link; return true; } }] : [])
        .concat(x.can_edit ? [{ label: 'حذف', cls: 'danger', onClick: async () => { if (!await confirmBox('حذف الحدث من التقويم؟', 'حذف')) return false; await call('cal_event_delete', { p_id: x.id }); load(); return true; } },
          { label: 'تعديل', onClick: () => { setTimeout(() => evForm({ id: x.id, title: x.title, kind: x.kind, start_date: x.date, end_date: x.end, note: x.note, audience: x.audience, stage_id: x.stage_id }), 50); return true; } }] : []) });
  }
  async function evForm(x) {
    if (!STAGES) { const { data } = await sb.from('stages').select('id,name_ar').order('sort'); STAGES = data || []; }
    const aud = new Set(x.audience || []);
    modal({ title: x.id ? 'تعديل حدث' : 'حدث جديد في تقويم المدرسة', wide: true, body: `
      <label class="f">العنوان *<input id="t" value="${esc(x.title || '')}"></label>
      <div class="form-grid"><label class="f">النوع<select id="k">${Object.entries(KIND).filter(([k]) => k !== 'booking').map(([k, v]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${v[0]} ${v[1]}</option>`).join('')}</select></label>
        <label class="f">من<input id="s" type="date" value="${esc(x.start_date || '')}"></label><label class="f">إلى (اختياري)<input id="e" type="date" value="${esc(x.end_date || '')}"></label>
        <label class="f">المرحلة<select id="st"><option value="">كل المراحل</option>${STAGES.map((s) => `<option value="${s.id}" ${+x.stage_id === s.id ? 'selected' : ''}>${esc(s.name_ar)}</option>`).join('')}</select></label></div>
      <div class="f"><span>يظهر لـ</span><div>${Object.entries(ROLES).map(([r, l]) => `<label class="chk" style="display:inline-flex;margin-inline-end:12px"><input type="checkbox" data-r="${r}" ${aud.has(r) ? 'checked' : ''}> ${l}</label>`).join('')}</div></div>
      <label class="f">تفاصيل<textarea id="n" rows="3">${esc(x.note || '')}</textarea></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('cal_event_save', { p: { id: x.id || null, title: $('#t', w).value, kind: $('#k', w).value, start_date: $('#s', w).value, end_date: $('#e', w).value,
          stage_id: $('#st', w).value, note: $('#n', w).value, audience: $$('[data-r]', w).filter((c) => c.checked).map((c) => c.dataset.r) } });
        toast('تم الحفظ'); load(); return true; } }] });
  }
  load();
})();
