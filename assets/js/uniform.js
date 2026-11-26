/* =====================================================================
   الزي المدرسي (sql/81) — الأصناف والمقاسات والأسعار، المخزون، طلبات أولياء الأمور، التسليم
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('uniform', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME, LISTS = {};
  const reloadMe = async () => { ME = await call('un_me'); };
  try { await reloadMe(); LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const ST = { pending: ['🆕 طلب جديد', 'gold'], confirmed: ['✔️ مؤكَّد', ''], paid: ['💳 مدفوع', ''], ready: ['📦 جاهز للاستلام', 'ok'], delivered: ['✅ تم التسليم', 'ok'], cancelled: ['ملغى', 'bad'] };
  const NEXT = { pending: 'confirmed', confirmed: 'paid', paid: 'ready', ready: 'delivered' };
  const money = (n) => Number(n || 0).toLocaleString('ar-SA') + ' ريال';
  const names = (ids, list) => (ids || []).map((i) => (list.find((x) => x.id === i) || {}).name).filter(Boolean).join('، ') || 'الكل';
  const tabs = ME.mgr ? [['orders', `📦 الطلبات${ME.pending ? ` (${ME.pending})` : ''}`], ['items', `👕 الأصناف والمخزون${ME.low ? ` ⚠️${ME.low}` : ''}`], ['new', '➕ طلب لطالب'], ['stats', '📊 التقارير']] : [['catalog', '👕 قائمة الزي والأسعار']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return ({ orders: ordersView, items: itemsView, new: () => orderForm(), stats: statsView, catalog: catalogView })[TAB](); };

  function catalogView() {
    view.innerHTML = `<div class="glass" style="padding:6px"><table class="t"><thead><tr><th>الصنف</th><th>القسم</th><th>المراحل</th><th>المقاسات</th><th>السعر</th></tr></thead><tbody>
      ${ME.items.map((i) => `<tr><td><b>${esc(i.name)}</b>${i.required ? ' <span class="pill">إلزامي</span>' : ''}${i.notes ? `<div class="hint">${esc(i.notes)}</div>` : ''}</td><td>${esc(names(i.section_ids, LISTS.sections || []))}</td>
        <td>${esc(names(i.stage_ids, LISTS.stages || []))}</td><td>${esc(i.sizes.join('، '))}</td><td>${money(i.price)}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">لم تُضف أصناف بعد.</td></tr>'}</tbody></table></div>
      <p class="hint">يطلب ولي الأمر الزي من بوابته، ويتابع قسم الزي التجهيز والتسليم.</p>`;
  }

  let F = { status: 'open', q: '' };
  async function ordersView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap"><select id="fs"><option value="open">المفتوحة</option><option value="">الكل</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${F.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select>
      <input id="fq" placeholder="🔎 اسم الطالب أو رقمه أو رقم الطلب" value="${esc(F.q)}" style="flex:1"></div><div id="ol"></div>`;
    $('#fs').value = F.status;
    let L = [];
    const load = async () => { try { L = await call('un_orders_list', { p: F }); } catch (e) { $('#ol').innerHTML = esc(errMsg(e)); return; }
      $('#ol').innerHTML = L.map((o) => `<div class="glass xc"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>#${o.id} — ${esc(o.student.name)}</b><span class="hint">${esc(o.student.class || '')}</span>
          <span class="pill ${ST[o.status][1]}">${ST[o.status][0]}</span>${o.by_parent ? '<span class="pill">👪 من ولي الأمر</span>' : ''}<span style="flex:1"></span><b>${money(o.total)}</b></div>
        <div>${o.lines.map((l) => `${esc(l.item)} <span class="pill">${esc(l.size)}</span> × ${l.qty}`).join(' · ')}</div>
        <div class="hint">${esc(new Date(o.created_at).toLocaleDateString('ar-SA'))}${o.guardian ? ' · 👤 ' + esc(o.guardian) : ''}${o.guardian_phone ? ` <a href="tel:+${esc(o.guardian_phone)}" dir="ltr">+${esc(o.guardian_phone)}</a>` : ''}${o.notes ? ' · 📝 ' + esc(o.notes) : ''}${o.reply ? ' · ↩️ ' + esc(o.reply) : ''}</div>
        ${NEXT[o.status] ? `<div class="acts"><button class="btn sm primary" data-nx="${o.id}">${ST[NEXT[o.status]][0]}</button>${o.status !== 'ready' ? '<span class="hint">أو</span>' : ''}<select data-st="${o.id}"><option value="">تغيير الحالة…</option>${Object.entries(ST).filter(([k]) => k !== o.status).map(([k, v]) => `<option value="${k}">${v[0]}</option>`).join('')}</select></div>` : ''}</div>`).join('')
        || '<div class="empty">لا توجد طلبات.</div>'; };
    const setSt = async (id, st) => { let reply = '';
      if (st === 'cancelled') { reply = await modal({ title: 'إلغاء الطلب', body: '<label class="f">السبب (يظهر لولي الأمر)<input id="cr"></label>',
        actions: [{ label: 'رجوع', value: null }, { label: 'إلغاء الطلب', cls: 'danger', onClick: (w) => $('#cr', w).value || ' ' }] }); if (reply === null) return; }
      if (st === 'delivered' && !await confirmBox('تأكيد تسليم الطلب؟ سيُخصم من المخزون.', 'تم التسليم', false)) return;
      try { await call('un_order_status', { p_id: id, p_status: st, p_reply: reply }); toast('تم ✓'); await reloadMe(); load(); } catch (er) { toast(errMsg(er), 'err'); } };
    let t; $('#fq').oninput = (e) => { F.q = e.target.value; clearTimeout(t); t = setTimeout(load, 300); }; $('#fs').onchange = (e) => { F.status = e.target.value; load(); };
    view.onclick = (e) => { const b = e.target.closest('[data-nx]'); if (b) { const o = L.find((x) => x.id === +b.dataset.nx); setSt(o.id, NEXT[o.status]); } };
    view.onchange = (e) => { const s = e.target.closest('[data-st]'); if (s && s.value) setSt(+s.dataset.st, s.value); };
    await load();
  }

  async function itemsView() {
    await reloadMe();
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="ni">＋ صنف جديد</button></div>
      ${ME.items.map((i) => `<div class="glass xc" style="${i.active ? '' : 'opacity:.55'}"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${esc(i.name)}</b>${i.required ? '<span class="pill">إلزامي</span>' : ''}${i.active ? '' : '<span class="pill">موقوف</span>'}
          <span class="hint">${esc(names(i.section_ids, LISTS.sections || []))} · ${esc(names(i.stage_ids, LISTS.stages || []))}</span><span style="flex:1"></span><b>${money(i.price)}</b><button class="btn sm" data-ed="${i.id}">✏️</button></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:6px">${i.sizes.map((s) => { const q = i.stock[s] ?? 0, m = i.min[s] ?? 5;
          return `<button class="szb ${q <= m ? 'low' : ''}" data-it="${i.id}" data-sz="${esc(s)}" title="اضغط للتوريد أو الجرد">${esc(s)}<b>${q}</b></button>`; }).join('')}</div></div>`).join('')
        || '<div class="empty">أضف أصناف الزي: الثوب، القميص، البنطال، الجاكيت، الزي الرياضي… مع المقاسات والسعر.</div>'}
      <p class="hint">🔴 المقاس الأحمر وصل للحد الأدنى. اضغط على أي مقاس لتسجيل توريد أو جرد.</p>`;
    $('#ni').onclick = () => itemForm({ sizes: [], section_ids: [], stage_ids: [], active: true, price: 0 });
    view.onclick = (e) => {
      const ed = e.target.closest('[data-ed]'); if (ed) return itemForm(ME.items.find((x) => x.id === +ed.dataset.ed));
      const sz = e.target.closest('[data-sz]'); if (!sz) return; const it = ME.items.find((x) => x.id === +sz.dataset.it), s = sz.dataset.sz;
      modal({ title: `📦 ${it.name} — مقاس ${s}`, body: `<p>المتوفر حاليًا: <b>${it.stock[s] ?? 0}</b></p><div class="form-grid"><label class="f">كمية واردة (+) أو منصرفة/تالفة (−)<input type="number" id="dl" value=""></label>
          <label class="f">الحد الأدنى للتنبيه<input type="number" id="mn" value="${it.min[s] ?? 5}"></label></div><label class="f">السبب<input id="rs" value="توريد"></label>`,
        actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
          await call('un_stock_set', { p_item: it.id, p_size: s, p_delta: +$('#dl', w).value || 0, p_min: +$('#mn', w).value, p_reason: $('#rs', w).value }); toast('تم ✓'); itemsView(); return true; } }] });
    };
  }
  function itemForm(i) {
    const chk = (list, sel, k) => list.map((x) => `<label class="chk" style="display:inline-flex;margin-inline-end:10px"><input type="checkbox" data-${k}="${x.id}" ${sel.includes(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('');
    modal({ title: i.id ? '✏️ ' + i.name : '＋ صنف جديد', wide: true, body: `<div class="form-grid"><label class="f">اسم الصنف<input id="n" value="${esc(i.name || '')}" placeholder="مثال: ثوب شتوي"></label>
        <label class="f">السعر (ريال)<input type="number" id="p" value="${i.price ?? 0}" step="0.5"></label><label class="f">الترتيب<input type="number" id="so" value="${i.sort ?? 0}"></label></div>
      <label class="f">المقاسات (افصل بفاصلة)<input id="sz" value="${esc((i.sizes || []).join('، '))}" placeholder="8، 10، 12، 14، S، M، L"></label>
      <div><b>القسم</b> <span class="hint">(بدون تحديد = الكل)</span><br>${chk(LISTS.sections || [], i.section_ids, 'sec')}</div>
      <div><b>المراحل</b> <span class="hint">(بدون تحديد = الكل)</span><br>${chk(LISTS.stages || [], i.stage_ids, 'stg')}</div>
      <label class="f">ملاحظة لولي الأمر<input id="nt" value="${esc(i.notes || '')}"></label>
      <label class="chk"><input type="checkbox" id="rq" ${i.required ? 'checked' : ''}> صنف إلزامي</label><label class="chk"><input type="checkbox" id="ac" ${i.active !== false ? 'checked' : ''}> متاح للطلب</label>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('un_item_save', { p: { id: i.id || '', name: $('#n', w).value, price: $('#p', w).value, sort: $('#so', w).value, sizes: $('#sz', w).value.split(/[,،]/).map((x) => x.trim()).filter(Boolean),
          section_ids: $$('[data-sec]:checked', w).map((x) => +x.dataset.sec), stage_ids: $$('[data-stg]:checked', w).map((x) => +x.dataset.stg), notes: $('#nt', w).value, required: $('#rq', w).checked, active: $('#ac', w).checked } });
        toast('تم الحفظ ✓'); itemsView(); return true; } }] });
  }

  function orderForm() {
    let stu = null; const lines = [];
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">➕ طلب زي لطالب</h3><input id="sq" placeholder="🔎 اسم الطالب أو رقمه" style="width:100%"><div id="sr" class="res"></div><div id="sf"></div></div>`;
    const paintF = () => {
      const items = ME.items.filter((i) => i.active && (!i.section_ids.length || i.section_ids.includes(stu.section_id)) && (!i.stage_ids.length || i.stage_ids.includes(stu.stage_id)));
      const tot = lines.reduce((a, l) => a + l.qty * l.price, 0);
      $('#sf').innerHTML = `<p>👦 <b>${esc(stu.name)}</b> <span class="hint">${esc(stu.class || '')}</span></p>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><select id="it">${items.map((i) => `<option value="${i.id}">${esc(i.name)} — ${money(i.price)}</option>`).join('')}</select><select id="sz"></select>
          <input type="number" id="qt" value="1" min="1" max="20" style="width:70px"><button class="btn sm" id="ad">＋ إضافة</button></div>
        <table class="t" style="margin-top:8px"><tbody>${lines.map((l, k) => `<tr><td>${esc(l.name)}</td><td>${esc(l.size)}</td><td>× ${l.qty}</td><td>${money(l.qty * l.price)}</td><td><button class="btn sm" data-rm="${k}">✕</button></td></tr>`).join('')}</tbody></table>
        <p><b>الإجمالي: ${money(tot)}</b></p><input id="nt" placeholder="ملاحظة (اختياري)" style="width:100%"><button class="btn primary" id="sv" style="margin-top:8px" ${lines.length ? '' : 'disabled'}>حفظ الطلب</button>`;
      const fillSz = () => { const i = items.find((x) => x.id === +$('#it').value); $('#sz').innerHTML = (i ? i.sizes : []).map((s) => `<option>${esc(s)}</option>`).join(''); };
      if ($('#it')) { $('#it').onchange = fillSz; fillSz(); }
      $('#ad').onclick = () => { const i = items.find((x) => x.id === +$('#it').value); if (!i) return; lines.push({ item_id: i.id, name: i.name, size: $('#sz').value, qty: +$('#qt').value || 1, price: +i.price }); paintF(); };
      $('#sf').onclick = (e) => { const r = e.target.closest('[data-rm]'); if (r) { lines.splice(+r.dataset.rm, 1); paintF(); } };
      $('#sv').onclick = async () => { try { const r = await call('un_order_create', { p_student: stu.id, p_lines: lines.map((l) => ({ item_id: l.item_id, size: l.size, qty: l.qty })), p_notes: $('#nt').value });
        toast('تم حفظ الطلب #' + r.id + ' ✓'); go('orders'); } catch (e) { toast(errMsg(e), 'err'); } };
    };
    let t; $('#sq').oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { const R = e.target.value.trim().length < 2 ? [] : await call('cs_student_search', { p_q: e.target.value });
      $('#sr').innerHTML = R.map((s, k) => `<div data-k="${k}">${esc(s.name)} <span class="hint">${esc(s.class || '')}</span></div>`).join(''); $('#sr').onclick = (ev) => { const d = ev.target.closest('[data-k]'); if (!d) return; stu = R[+d.dataset.k]; $('#sr').innerHTML = ''; paintF(); }; }, 300); };
  }

  async function statsView() {
    const d0 = new Date(new Date().getFullYear(), new Date().getMonth() - 2, 1).toISOString().slice(0, 10);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">من <input type="date" id="f" value="${d0}"> إلى <input type="date" id="t" value="${new Date().toISOString().slice(0, 10)}"><button class="btn sm" id="r">تحديث</button></div><div id="sb"></div>`;
    const load = async () => { let S; try { S = await call('un_stats', { p_from: $('#f').value, p_to: $('#t').value }); } catch (e) { $('#sb').innerHTML = esc(errMsg(e)); return; }
      const T = (h, rows, cols) => `<div class="glass" style="padding:10px 12px"><h4 style="margin:0 0 6px">${h}</h4><table class="t"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td colspan="${cols.length}" class="hint">—</td></tr>`}</tbody></table></div>`;
      $('#sb').innerHTML = `<div class="kpi4"><div class="card-box glass"><b>${S.orders}</b>طلب</div><div class="card-box glass"><b>${S.delivered}</b>مُسلَّم</div><div class="card-box glass"><b>${money(S.sales)}</b>المبيعات المسلَّمة</div><div class="card-box glass"><b style="color:#b3261e">${S.low.length}</b>مقاس تحت الحد</div></div>
        <div class="row2">${T('⚠️ مقاسات تحتاج توريد', S.low.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.size)}</td><td><b>${x.qty}</b></td><td>${x.min}</td></tr>`).join(''), ['الصنف', 'المقاس', 'المتوفر', 'الحد'])}
          ${T('📦 محجوز لطلبات مفتوحة', S.reserved.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.size)}</td><td>${x.qty}</td></tr>`).join(''), ['الصنف', 'المقاس', 'الكمية'])}
          ${T('📈 الأكثر طلبًا', S.items.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.size)}</td><td>${x.qty}</td></tr>`).join(''), ['الصنف', 'المقاس', 'المُسلَّم'])}</div>`; };
    $('#r').onclick = load; await load();
  }
  paint();
})();
