/* =====================================================================
   لقاءات أولياء الأمور (sql/69) — صفحة المعلم/المنسوب
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ولي الأمر يحجز اللقاءات من بوابة ولي الأمر.</div>'; return; }
  if (!LMS.betaAllowed('meetings', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const MODE = { in_person: '🏫 حضوري', online: '💻 عن بُعد', phone: '📞 هاتفي' };
  const dn = (d) => DAYS[new Date(d + 'T12:00:00').getDay()];

  const tabs = [['up', '📅 مواعيدي القادمة'], ['past', '🗂️ اللقاءات السابقة']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'up';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };

  async function paint() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('mt_mine', { p_past: TAB === 'past' }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (TAB === 'past') L.reverse();
    const booked = L.filter((s) => s.status !== 'open').length;
    const days = [...new Set(L.map((s) => s.day))];
    view.innerHTML = (TAB === 'up' ? `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="add">＋ فتح مواعيد</button><span class="grow"></span>
        <span class="hint">${L.length} موعد · <b>${booked}</b> محجوز</span></div>` : '') +
      (days.map((d) => `<div class="day-h">${dn(d)} ${esc(d)}</div>` + L.filter((s) => s.day === d).map((s) => `<div class="glass slot ${s.status === 'open' ? 'open' : 'booked'}">
          <div class="tm">${esc(s.time)}<div class="hint" style="font-size:.7rem">${s.duration} د</div></div>
          <div class="grow">${s.status === 'open' ? '<span class="hint">متاح — لم يُحجز</span>' : `<b>${esc(s.guardian || 'ولي الأمر')}</b> — ولي أمر <b>${esc(s.student || '')}</b>
              <div class="hint">${esc(s.class || '')}${s.phone ? ` · <a href="tel:+${esc(s.phone)}" dir="ltr">+${esc(s.phone)}</a>` : ''}</div>
              ${s.topic ? `<div class="hint">📝 الموضوع: ${esc(s.topic)}</div>` : ''}${s.outcome ? `<div class="hint">✅ النتيجة: ${esc(s.outcome)}</div>` : ''}`}
            <div class="hint">${MODE[s.mode]}${s.location ? ' · ' + esc(s.location) : ''}</div></div>
          ${s.status === 'booked' || s.status === 'done' ? `<button class="btn sm" data-done="${s.id}">${s.status === 'done' ? '✏️ النتيجة' : '✅ تمّ اللقاء'}</button>` : ''}
          ${TAB === 'up' ? `<button class="btn sm danger ghost" data-x="${s.id}" title="إلغاء">✕</button>` : ''}</div>`).join('')).join('') ||
      `<div class="empty">${TAB === 'up' ? 'لا توجد مواعيد مفتوحة.<br><small>اضغط «＋ فتح مواعيد» وحدد اليوم والفترة ومدة اللقاء، فتظهر لأولياء أمور طلابك في بوابتهم.</small>' : 'لا توجد لقاءات سابقة.'}</div>`);
    if ($('#add')) $('#add').onclick = addForm;
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.x) { const s = L.find((x) => x.id === +b.dataset.x);
          if (!await confirmBox(s.status === 'booked' ? 'الموعد محجوز — سيظهر لولي الأمر أنه أُلغي. يُفضّل التواصل معه. متابعة؟' : 'حذف هذا الموعد؟', 'إلغاء الموعد')) return;
          await call('mt_slot_cancel', { p_id: s.id }); toast('أُلغي'); paint(); }
        if (b.dataset.done) { const s = L.find((x) => x.id === +b.dataset.done);
          modal({ title: 'نتيجة اللقاء', body: `<label class="f">ملخص اللقاء والاتفاق *<textarea id="oc" rows="4">${esc(s.outcome || '')}</textarea></label>`,
            actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => { await call('mt_slot_done', { p_id: s.id, p_outcome: $('#oc', w).value }); toast('حُفظ ✓'); paint(); return true; } }] }); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  function addForm() {
    const d = new Date(); d.setDate(d.getDate() + 1); while ([5, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
    modal({ title: '＋ فتح مواعيد للقاءات', body: `<label class="f">اليوم<input type="date" id="dy" value="${d.toISOString().slice(0, 10)}"></label>
      <div style="display:flex;gap:8px"><label class="f grow">من<input type="time" id="fr" value="10:00"></label><label class="f grow">إلى<input type="time" id="to" value="11:00"></label>
        <label class="f">مدة اللقاء<select id="du"><option>10</option><option selected>15</option><option>20</option><option>30</option><option>45</option></select></label></div>
      <label class="f">نوع اللقاء<select id="md">${Object.entries(MODE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f">المكان أو رابط الاجتماع<input id="lc" placeholder="مثال: غرفة الاجتماعات — الدور الأول"></label>
      <p class="hint">تُقسَّم الفترة إلى مواعيد متتالية، ويراها أولياء أمور طلابك في بوابتهم.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'فتح المواعيد', cls: 'primary', onClick: async (w) => {
        const n = await call('mt_slots_add', { p: { day: $('#dy', w).value, from: $('#fr', w).value, to: $('#to', w).value, duration: $('#du', w).value, mode: $('#md', w).value, location: $('#lc', w).value } });
        toast(`فُتح ${n} موعد ✓`); paint(); return true; } }] });
  }

  paint();
})();
