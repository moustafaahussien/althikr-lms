/* =====================================================================
   النقل المدرسي (sql/81) — المسارات والحافلات، اشتراك الطلاب، كشف الركوب اليومي، طلبات أولياء الأمور
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('transport', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME, LISTS = {};
  const reloadMe = async () => { ME = await call('tr_me'); };
  try { await reloadMe(); if (ME.mgr) LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  if (!ME.mgr && !ME.routes.length) { $('#tabs').remove(); view.innerHTML = '<div class="notice">🔒 هذه الوحدة لمسؤول النقل (المسمى الوظيفي يحتوي «نقل» أو «حافلات») ولمشرفي الحافلات المكلفين بمسار.</div>'; return; }
  const MODE = { both: 'ذهاب وعودة', am: 'ذهاب فقط', pm: 'عودة فقط' };
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
  const tabs = [['run', '📋 كشف الحافلة اليوم']].concat(ME.mgr ? [['routes', '🚌 المسارات والطلاب'], ['day', '📊 متابعة اليوم'], ['requests', `📨 طلبات الاشتراك${ME.requests ? ` (${ME.requests})` : ''}`]] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : (ME.mgr ? 'routes' : 'run');
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return ({ run: runView, routes: routesView, day: dayView, requests: reqView })[TAB](); };

  /* ---------- كشف الركوب ---------- */
  let RUN = { route: '', shift: new Date().getHours() < 11 ? 'am' : 'pm' };
  async function runView() {
    const R = ME.routes.filter((r) => r.active);
    if (!R.length) { view.innerHTML = '<div class="empty">لا توجد مسارات.</div>'; return; }
    if (!R.some((r) => String(r.id) === String(RUN.route))) RUN.route = R[0].id;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select id="rr">${R.map((r) => `<option value="${r.id}" ${String(r.id) === String(RUN.route) ? 'selected' : ''}>🚌 ${esc(r.name)}${r.bus_no ? ' — حافلة ' + esc(r.bus_no) : ''}</option>`).join('')}</select>
      <div class="seg"><button data-sh="am" class="${RUN.shift === 'am' ? 'on' : ''}">🌅 الذهاب (صباحًا)</button><button data-sh="pm" class="${RUN.shift === 'pm' ? 'on' : ''}">🌇 العودة (بعد الدوام)</button></div></div><div id="rl"><div class="empty">جارٍ التحميل…</div></div>`;
    $('#rr').onchange = (e) => { RUN.route = e.target.value; load(); };
    $$('[data-sh]').forEach((b) => { b.onclick = () => { RUN.shift = b.dataset.sh; $$('[data-sh]').forEach((x) => x.classList.toggle('on', x === b)); load(); }; });
    let D;
    const load = async () => {
      try { D = await call('tr_run', { p_route: +RUN.route, p_shift: RUN.shift }); } catch (e) { $('#rl').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      const L = D.riders, on = L.filter((x) => ['boarded', 'arrived'].includes(x.status)).length, ab = L.filter((x) => x.status === 'absent').length;
      let lastStop = null;
      $('#rl').innerHTML = `<div class="kpi4"><div class="card-box glass"><b>${L.length}</b>طالب</div><div class="card-box glass"><b style="color:#007B51">${on}</b>ركب</div>
          <div class="card-box glass"><b style="color:#b3261e">${ab}</b>غائب</div><div class="card-box glass"><b>${L.length - on - ab}</b>لم يُرصد</div></div>
        ${D.closed_at ? `<div class="notice ok">✅ أُغلق الكشف ${esc(new Date(D.closed_at).toLocaleTimeString('ar-SA', { hour: 'numeric', minute: '2-digit' }))} — يمكنك التعديل عند الحاجة.</div>` : ''}
        <div class="glass" style="padding:6px">${L.map((s) => { const head = s.stop !== lastStop ? `<div class="stop">📍 ${esc(s.stop || 'بدون محطة')}${s.stop_time ? ' · ' + esc(s.stop_time) : ''}</div>` : ''; lastStop = s.stop;
          return head + `<div class="rd ${s.status || ''}"><div style="flex:1"><b>${esc(s.name)}</b><div class="hint">${esc(s.class || '')}${s.guardian_phone ? ` · <a href="tel:${esc(s.guardian_phone)}" dir="ltr">📞 ${esc(s.guardian_phone)}</a>` : ''}</div></div>
            <button class="btn sm ${['boarded', 'arrived'].includes(s.status) ? 'primary' : ''}" data-m="boarded" data-s="${s.id}">✅ ركب</button><button class="btn sm ${s.status === 'absent' ? 'danger' : ''}" data-m="absent" data-s="${s.id}">✖ غائب</button></div>`; }).join('')
          || '<div class="empty">لا طلاب مشتركين في هذه الرحلة.</div>'}</div>
        ${L.length ? `<button class="btn primary" id="cl" style="margin-top:10px">🔒 إغلاق الكشف ${RUN.shift === 'am' ? '(وصلنا المدرسة)' : '(انتهت الرحلة)'}</button><p class="hint">عند الإغلاق يُسجَّل من لم يُرصد «غائبًا»، ويرى ولي الأمر حالة ابنه في بوابته.</p>` : ''}`;
    };
    view.onclick = async (e) => {
      const b = e.target.closest('[data-m]');
      if (b) { const s = D.riders.find((x) => x.id === b.dataset.s); const nv = s.status === b.dataset.m || (b.dataset.m === 'boarded' && s.status === 'arrived') ? '' : b.dataset.m;
        try { await call('tr_mark', { p_trip: D.trip_id, p_student: s.id, p_status: nv }); load(); } catch (er) { toast(errMsg(er), 'err'); } return; }
      if (e.target.closest('#cl')) { if (!await confirmBox('إغلاق الكشف؟ من لم يُرصد سيُسجَّل غائبًا.', 'نعم، أغلق', false)) return; try { await call('tr_close', { p_trip: D.trip_id }); toast('أُغلق الكشف ✓'); load(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
    await load();
  }

  /* ---------- المسارات ---------- */
  async function routesView() {
    await reloadMe();
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="nr">＋ مسار / حافلة جديدة</button></div>
      <div class="row2">${ME.routes.map((r) => `<div class="glass xc" style="${r.active ? '' : 'opacity:.55'}"><b style="font-size:1.05rem">🚌 ${esc(r.name)}</b> ${r.active ? '' : '<span class="pill">موقوف</span>'}
        <div class="hint">${r.bus_no ? 'حافلة ' + esc(r.bus_no) : ''}${r.plate ? ' · لوحة ' + esc(r.plate) : ''}${r.area ? ' · ' + esc(r.area) : ''}</div>
        <div>👨‍✈️ ${esc(r.driver_name || '—')}${r.driver_phone ? ` <a href="tel:${esc(r.driver_phone)}" dir="ltr">${esc(r.driver_phone)}</a>` : ''} · 👤 المشرف: ${esc(r.supervisor || '—')}</div>
        <div class="hint">🌅 ${esc(r.am_time || '—')} · 🌇 ${esc(r.pm_time || '—')} · ${r.stops.length} محطة</div>
        <div style="margin:6px 0"><span class="pill ${r.capacity && r.riders >= r.capacity ? 'bad' : 'ok'}">👦 ${r.riders}${r.capacity ? ' / ' + r.capacity : ''} طالب</span></div>
        <div class="acts"><button class="btn sm primary" data-rd="${r.id}">👦 الطلاب</button><button class="btn sm" data-re="${r.id}">✏️ تعديل</button><button class="btn sm danger" data-rx="${r.id}">🗑️</button></div></div>`).join('')
        || '<div class="empty">أضف أول مسار: اسم المسار، الحافلة، السائق، المشرف، والمحطات.</div>'}</div>`;
    $('#nr').onclick = () => routeForm({ stops: [], active: true });
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const r = ME.routes.find((x) => x.id === +(b.dataset.rd || b.dataset.re || b.dataset.rx));
      if (b.dataset.re) routeForm(r);
      if (b.dataset.rd) ridersForm(r);
      if (b.dataset.rx) { if (!await confirmBox(`حذف مسار «${r.name}»؟`, 'حذف')) return; try { await call('tr_route_delete', { p_id: r.id }); routesView(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function routeForm(r) {
    const staff = LISTS.staff || [];
    const stopRow = (s = {}) => `<div class="sr" style="display:grid;grid-template-columns:1fr 90px 90px 34px;gap:6px;margin:4px 0" data-sid="${s.id || ''}"><input data-k="name" value="${esc(s.name || '')}" placeholder="اسم المحطة / الحي">
      <input data-k="am_time" value="${esc(s.am_time || '')}" placeholder="🌅 6:30"><input data-k="pm_time" value="${esc(s.pm_time || '')}" placeholder="🌇 2:15"><button class="btn sm" data-rm>✕</button></div>`;
    const body = document.createElement('div');
    body.innerHTML = `<div class="form-grid"><label class="f">اسم المسار<input id="n" value="${esc(r.name || '')}" placeholder="مثال: مسار شمال جدة"></label><label class="f">المنطقة / الأحياء<input id="ar" value="${esc(r.area || '')}"></label>
        <label class="f">رقم الحافلة<input id="bn" value="${esc(r.bus_no || '')}"></label><label class="f">اللوحة<input id="pl" value="${esc(r.plate || '')}"></label><label class="f">السعة<input type="number" id="cp" value="${r.capacity ?? ''}"></label>
        <label class="f">السائق<input id="dn" value="${esc(r.driver_name || '')}"></label><label class="f">جوال السائق<input id="dp" dir="ltr" value="${esc(r.driver_phone || '')}"></label>
        <label class="f">مشرف الحافلة (يرصد الكشف)<select id="sp"><option value="">—</option>${staff.map((s) => `<option value="${s.id}" ${s.id === r.supervisor_id ? 'selected' : ''}>${esc(s.name)}${s.job ? ' — ' + esc(s.job) : ''}</option>`).join('')}</select></label>
        <label class="f">موعد الانطلاق صباحًا<input id="am" value="${esc(r.am_time || '')}" placeholder="6:15"></label><label class="f">موعد الانطلاق بعد الدوام<input id="pm" value="${esc(r.pm_time || '')}" placeholder="1:45"></label></div>
      <label class="chk"><input type="checkbox" id="ac" ${r.active !== false ? 'checked' : ''}> المسار يعمل</label>
      <h4 style="margin-bottom:2px">📍 المحطات بالترتيب</h4><div id="st">${(r.stops.length ? r.stops : [{}]).map(stopRow).join('')}</div><button class="btn sm" id="as">＋ محطة</button>`;
    body.addEventListener('click', (e) => { if (e.target.id === 'as') $('#st', body).insertAdjacentHTML('beforeend', stopRow()); if (e.target.matches('[data-rm]')) e.target.closest('.sr').remove(); });
    modal({ title: r.id ? '✏️ ' + r.name : '＋ مسار جديد', wide: true, body, actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      const v = (s) => $(s, w).value.trim();
      await call('tr_route_save', { p: { id: r.id || '', name: v('#n'), area: v('#ar'), bus_no: v('#bn'), plate: v('#pl'), capacity: v('#cp'), driver_name: v('#dn'), driver_phone: v('#dp'),
        supervisor_id: $('#sp', w).value, am_time: v('#am'), pm_time: v('#pm'), active: $('#ac', w).checked,
        stops: $$('.sr', w).map((x) => ({ id: x.dataset.sid, name: $('[data-k=name]', x).value, am_time: $('[data-k=am_time]', x).value, pm_time: $('[data-k=pm_time]', x).value })) } });
      toast('تم الحفظ ✓'); routesView(); return true; } }] });
  }
  async function ridersForm(r) {
    const box = document.createElement('div');
    const load = async () => {
      let L; try { L = await call('tr_riders', { p_route: r.id }); } catch (e) { box.innerHTML = esc(errMsg(e)); return; }
      box.innerHTML = `<div style="display:flex;gap:6px"><input id="sq" placeholder="🔎 أضف طالبًا: اكتب اسمه أو رقمه" style="flex:1"></div><div id="sr" class="res"></div>
        <p class="hint">${L.length}${r.capacity ? ' / ' + r.capacity : ''} طالب</p>
        <table class="t"><thead><tr><th>الطالب</th><th>المحطة</th><th>الاشتراك</th><th></th></tr></thead><tbody>${L.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="hint">${esc(s.class || '')}${s.address ? ' · ' + esc(s.address) : ''}</div></td>
          <td><select data-stop="${s.id}">${r.stops.map((x) => `<option value="${x.id}" ${x.id === s.stop_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}<option value="" ${!s.stop_id ? 'selected' : ''}>—</option></select></td>
          <td><select data-mode="${s.id}">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${k === s.mode ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td><button class="btn sm danger" data-del="${s.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="hint">لا طلاب بعد.</td></tr>'}</tbody></table>`;
      let t; $('#sq', box).oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { const R = e.target.value.trim().length < 2 ? [] : await call('cs_student_search', { p_q: e.target.value });
        $('#sr', box).innerHTML = R.map((s) => `<div data-add="${s.id}">${esc(s.name)} <span class="hint">${esc(s.class || '')} · ${esc(s.no || '')}</span></div>`).join(''); }, 300); };
      const set = async (sid, extra) => { const s = L.find((x) => x.id === sid) || {}; await call('tr_rider_set', { p: Object.assign({ student_id: sid, route_id: r.id, stop_id: s.stop_id || (r.stops[0] || {}).id || '', mode: s.mode || 'both', address: s.address || '' }, extra) }); };
      box.onchange = async (e) => { const st = e.target.dataset.stop, md = e.target.dataset.mode;
        try { if (st) await set(st, { stop_id: e.target.value }); if (md) await set(md, { mode: e.target.value }); toast('تم ✓'); load(); } catch (er) { toast(errMsg(er), 'err'); } };
      box.onclick = async (e) => { const a = e.target.closest('[data-add]'), d = e.target.closest('[data-del]');
        try { if (a) { await set(a.dataset.add, {}); toast('أُضيف ✓'); load(); } if (d) { await call('tr_rider_set', { p: { student_id: d.dataset.del, route_id: r.id, remove: true } }); load(); } } catch (er) { toast(errMsg(er), 'err'); } };
    };
    await load();
    modal({ title: '👦 طلاب ' + r.name, wide: true, body: box, actions: [{ label: 'إغلاق', value: null }] }).then(() => routesView());
  }

  /* ---------- متابعة اليوم ---------- */
  async function dayView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">اليوم <input type="date" id="dd" value="${today()}"></div><div id="dl"></div>`;
    const load = async () => { let L; try { L = await call('tr_day_report', { p_day: $('#dd').value }); } catch (e) { $('#dl').innerHTML = esc(errMsg(e)); return; }
      const c = (x) => !x ? '<span class="pill bad">لم يُفتح</span>' : `<span class="pill ${x.closed ? 'ok' : 'gold'}">${x.closed ? '✓ مغلق' : '⏳ مفتوح'}</span> ركب ${x.boarded} · غاب ${x.absent}`;
      $('#dl').innerHTML = `<div class="glass" style="padding:6px"><table class="t"><thead><tr><th>المسار</th><th>المشرف</th><th>المشتركون</th><th>🌅 الذهاب</th><th>🌇 العودة</th></tr></thead><tbody>
        ${L.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.bus_no ? `<div class="hint">حافلة ${esc(r.bus_no)}</div>` : ''}</td><td>${esc(r.supervisor || '—')}</td><td>${r.riders}</td><td>${c(r.am)}</td><td>${c(r.pm)}</td></tr>`).join('')}</tbody></table></div>`; };
    $('#dd').onchange = load; await load();
  }

  /* ---------- طلبات الاشتراك ---------- */
  async function reqView() {
    let L; try { L = await call('tr_requests_list'); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
    view.innerHTML = L.map((q) => `<div class="glass xc"><b>${esc(q.name)}</b> <span class="hint">${esc(q.class || '')}</span> <span class="pill ${q.status === 'pending' ? 'gold' : q.status === 'approved' ? 'ok' : 'bad'}">${q.status === 'pending' ? 'جديد' : q.status === 'approved' ? 'مقبول' : 'مرفوض'}</span>
        <div>📍 ${esc(q.address)} · ${MODE[q.mode]}${q.current ? ` · <span class="hint">مشترك حاليًا في: ${esc(q.current)}</span>` : ''}</div>
        <div class="hint">👤 ${esc(q.guardian || 'ولي الأمر')}${q.guardian_phone ? ` <a href="tel:+${esc(q.guardian_phone)}" dir="ltr">+${esc(q.guardian_phone)}</a>` : ''} · ${esc(new Date(q.created_at).toLocaleDateString('ar-SA'))}${q.notes ? ' · ' + esc(q.notes) : ''}${q.reply ? ' · الرد: ' + esc(q.reply) : ''}</div>
        ${q.status === 'pending' ? `<div class="acts"><button class="btn sm primary" data-ok="${q.req_id}">✅ قبول وتحديد المسار</button><button class="btn sm danger" data-no="${q.req_id}">رفض</button></div>` : ''}</div>`).join('')
      || '<div class="empty">لا توجد طلبات اشتراك. يرسل ولي الأمر طلبه من بوابته (قسم النقل المدرسي).</div>';
    view.onclick = async (e) => {
      const ok = e.target.closest('[data-ok]'), no = e.target.closest('[data-no]'); if (!ok && !no) return; const q = L.find((x) => x.req_id === +(ok || no).dataset[ok ? 'ok' : 'no']);
      const R = ME.routes.filter((r) => r.active);
      modal({ title: (ok ? '✅ قبول اشتراك ' : '⛔ رفض اشتراك ') + q.name, body: ok ? `<label class="f">المسار<select id="rt">${R.map((r) => `<option value="${r.id}">${esc(r.name)} (${r.riders}${r.capacity ? '/' + r.capacity : ''})</option>`).join('')}</select></label>
          <label class="f">المحطة<select id="sp"></select></label><label class="f">رسالة لولي الأمر (اختياري)<input id="rp" placeholder="مثال: الحافلة تمر الساعة 6:30"></label>` : '<label class="f">السبب (يظهر لولي الأمر)<input id="rp"></label>',
        actions: [{ label: 'إلغاء', value: null }, { label: 'تأكيد', cls: ok ? 'primary' : 'danger', onClick: async (w) => {
          await call('tr_request_decide', { p_id: q.req_id, p_approve: !!ok, p_reply: $('#rp', w).value, p_route: ok ? +$('#rt', w).value : null, p_stop: ok && $('#sp', w).value ? +$('#sp', w).value : null });
          toast('تم ✓'); await reloadMe(); reqView(); return true; } }] });
      const w = [...document.querySelectorAll('.modal-wrap')].pop(); const fill = () => { const r = R.find((x) => x.id === +$('#rt', w).value); $('#sp', w).innerHTML = (r ? r.stops : []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('') + '<option value="">—</option>'; };
      if (ok && $('#rt', w)) { $('#rt', w).onchange = fill; fill(); }
    };
  }
  paint();
})();
