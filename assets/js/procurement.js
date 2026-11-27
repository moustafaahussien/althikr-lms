/* =====================================================================
   المشتريات (sql/82)
   طلب (للإداريين فقط) ← اعتماد المدير التنفيذي ← الشراء ← التسليم من المشتريات ← تأكيد الاستلام
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('procurement', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME; const reloadMe = async () => { ME = await call('pr_me'); };
  try { await reloadMe(); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  if (!ME.can_request && !ME.viewer) { $('#tabs').remove(); view.innerHTML = '<div class="notice">🔒 طلبات الشراء للإداريين فقط.</div>'; return; }
  const STEPS = [['pending', '📝', 'الطلب'], ['approved', '✅', 'اعتماد المدير التنفيذي'], ['purchased', '🛍️', 'الشراء'], ['delivered', '📦', 'التسليم'], ['received', '🤝', 'الاستلام']];
  const ORDER = { pending: 0, approved: 1, purchasing: 1, purchased: 2, delivered: 3, received: 4 };
  const STL = { pending: ['⏳ بانتظار اعتماد المدير التنفيذي', 'gold'], approved: ['✅ معتمد — بانتظار الشراء', 'ok'], rejected: ['⛔ غير معتمد', 'bad'], purchasing: ['🛒 جارٍ الشراء', 'gold'],
    purchased: ['🛍️ تم الشراء — بانتظار التسليم', 'gold'], delivered: ['📦 سُلّم — أكّد الاستلام', 'ok'], received: ['🤝 تم الاستلام', 'ok'], cancelled: ['ملغى', 'bad'] };
  const PR = { normal: 'عادية', high: 'عالية', urgent: '🚨 عاجلة' };
  const money = (n) => (n == null ? '—' : Number(n).toLocaleString('ar-SA', { maximumFractionDigits: 2 }) + ' ريال');
  const fmt = (t) => (t ? new Date(t).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const C = ME.counts || {};
  const tabs = [].concat(ME.can_request ? [['mine', '📝 طلباتي']] : [], ME.approver ? [['approve', `✅ بانتظار الاعتماد${C.pending ? ` (${C.pending})` : ''}`]] : [],
    ME.buyer ? [['buy', `🛍️ للشراء والتسليم${C.to_buy + C.to_deliver ? ` (${C.to_buy + C.to_deliver})` : ''}`]] : [], ME.viewer ? [['all', '🗂️ كل الطلبات'], ['stats', '📊 التقارير']] : [],
    ME.settings ? [['settings', '⚙️ الإعدادات']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return TAB === 'stats' ? statsView() : TAB === 'settings' ? settingsView() : listView(); };

  let Q = '';
  async function listView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap">${TAB === 'mine' ? '<button class="btn primary sm" id="nr">＋ طلب شراء جديد</button>' : ''}
      <input id="fq" placeholder="🔎 بحث بالعنوان أو القسم أو المورد أو الرقم" value="${esc(Q)}" style="flex:1;min-width:180px"></div><div id="ls"><div class="empty">جارٍ التحميل…</div></div>`;
    if ($('#nr')) $('#nr').onclick = () => reqForm({ items: [{}], priority: 'normal' });
    let L = [];
    const load = async () => { try { L = await call('pr_list', { p: { view: TAB, q: Q } }); } catch (e) { $('#ls').innerHTML = esc(errMsg(e)); return; }
      $('#ls').innerHTML = L.map((r) => `<div class="glass xc pr-${r.priority}" data-id="${r.id}" style="cursor:pointer"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <b>#${r.id} ${esc(r.title)}</b><span class="pill ${STL[r.status][1]}">${STL[r.status][0]}</span>${r.priority !== 'normal' ? `<span class="pill bad">${PR[r.priority]}</span>` : ''}<span style="flex:1"></span><b>${money(r.actual_total ?? r.est_total)}</b></div>
        <div class="hint">${TAB !== 'mine' ? '👤 ' + esc(r.requester || '') + ' · ' : ''}${r.department ? '🏢 ' + esc(r.department) + ' · ' : ''}${r.n_items} صنف · ${esc(fmt(r.created_at))}${r.needed_by ? ' · مطلوب قبل ' + esc(r.needed_by) : ''}${r.supplier ? ' · 🏪 ' + esc(r.supplier) : ''}</div></div>`).join('')
        || `<div class="empty">${TAB === 'mine' ? 'لم ترفع طلبات شراء بعد.' : TAB === 'approve' ? 'لا طلبات بانتظار الاعتماد 👍' : TAB === 'buy' ? 'لا طلبات معتمدة للتنفيذ 👍' : 'لا توجد طلبات.'}</div>`; };
    let t; $('#fq').oninput = (e) => { Q = e.target.value; clearTimeout(t); t = setTimeout(load, 300); };
    view.onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openReq(+c.dataset.id, load); };
    await load();
  }

  function reqForm(r) {
    const box = document.createElement('div');
    const row = (i = {}) => `<div class="it" style="display:grid;grid-template-columns:2fr 70px 90px 100px 1.4fr 30px;gap:6px;margin:4px 0"><input data-k="name" value="${esc(i.name || '')}" placeholder="الصنف">
      <input type="number" data-k="qty" value="${i.qty ?? 1}" min="0.01" step="any" placeholder="الكمية"><input data-k="unit" value="${esc(i.unit || 'قطعة')}" placeholder="الوحدة">
      <input type="number" data-k="est_price" value="${i.est_price ?? ''}" step="any" placeholder="سعر تقديري"><input data-k="specs" value="${esc(i.specs || '')}" placeholder="المواصفات / الموديل"><button class="btn sm" data-rm>✕</button></div>`;
    const total = () => $$('.it', box).reduce((a, x) => a + (+$('[data-k=qty]', x).value || 0) * (+$('[data-k=est_price]', x).value || 0), 0);
    box.innerHTML = `<div class="form-grid"><label class="f">عنوان الطلب<input id="ti" value="${esc(r.title || '')}" placeholder="مثال: أحبار طابعات الإدارة"></label>
        <label class="f">القسم<input id="dp" list="dps" value="${esc(r.department || '')}"><datalist id="dps">${(ME.departments || []).map((d) => `<option value="${esc(d)}">`).join('')}</datalist></label>
        <label class="f">الأولوية<select id="pr">${Object.entries(PR).map(([k, l]) => `<option value="${k}" ${k === r.priority ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">مطلوب قبل<input type="date" id="nb" value="${esc(r.needed_by || '')}"></label></div>
      <h4 style="margin-bottom:2px">📦 الأصناف</h4><div class="hint" style="display:grid;grid-template-columns:2fr 70px 90px 100px 1.4fr 30px;gap:6px"><span>الصنف</span><span>الكمية</span><span>الوحدة</span><span>السعر التقديري</span><span>المواصفات</span><span></span></div>
      <div id="its">${(r.items.length ? r.items : [{}]).map(row).join('')}</div><button class="btn sm" id="ai">＋ صنف</button> <b id="tot" style="margin-inline-start:10px"></b>
      <label class="f">مبررات الطلب<textarea id="js" rows="2" placeholder="لماذا نحتاجه؟ ما أثر عدم توفره؟">${esc(r.justification || '')}</textarea></label>`;
    const upd = () => { $('#tot', box).textContent = 'الإجمالي التقديري: ' + money(total()); };
    box.addEventListener('click', (e) => { if (e.target.id === 'ai') { $('#its', box).insertAdjacentHTML('beforeend', row()); } if (e.target.matches('[data-rm]') && $$('.it', box).length > 1) e.target.closest('.it').remove(); upd(); });
    box.addEventListener('input', upd); upd();
    modal({ title: r.id ? '✏️ تعديل الطلب وإعادة إرساله' : '🛒 طلب شراء جديد', wide: true, body: box, actions: [{ label: 'إلغاء', value: null }, { label: '📤 إرسال للمدير التنفيذي', cls: 'primary', onClick: async (w) => {
      const items = $$('.it', w).map((x) => Object.fromEntries(['name', 'qty', 'unit', 'est_price', 'specs'].map((k) => [k, $(`[data-k=${k}]`, x).value.trim()]))).filter((x) => x.name);
      if (!$('#ti', w).value.trim() || !items.length) { toast('اكتب العنوان وصنفًا واحدًا على الأقل', 'err'); return false; }
      await call('pr_submit', { p: { id: r.id || '', title: $('#ti', w).value, department: $('#dp', w).value, priority: $('#pr', w).value, needed_by: $('#nb', w).value, justification: $('#js', w).value, items } });
      toast('أُرسل الطلب للمدير التنفيذي ✓'); go('mine'); return true; } }] });
  }

  async function openReq(id, after) {
    let R; try { R = await call('pr_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const idx = ORDER[R.status] ?? -1, closed = ['rejected', 'cancelled'].includes(R.status);
    const approvable = ME.approver && R.status === 'pending', buying = ME.buyer && ['approved', 'purchasing'].includes(R.status), delivering = ME.buyer && R.status === 'purchased';
    const body = `<div class="stp">${STEPS.map(([k, i, l], n) => `<div class="st ${closed ? '' : n < idx || (n === idx && R.status === 'received') ? 'done' : n === idx ? 'cur' : ''}"><span>${i}</span><small>${l}</small></div>`).join('')}</div>
      <p><span class="pill ${STL[R.status][1]}">${STL[R.status][0]}</span> ${R.priority !== 'normal' ? `<span class="pill bad">${PR[R.priority]}</span>` : ''} 👤 ${esc(R.requester || '')}${R.requester_job ? ' — ' + esc(R.requester_job) : ''}${R.department ? ' · 🏢 ' + esc(R.department) : ''}${R.needed_by ? ' · مطلوب قبل ' + esc(R.needed_by) : ''}</p>
      ${R.justification ? `<p>📝 ${esc(R.justification)}</p>` : ''}
      <table class="t"><thead><tr><th>الصنف</th><th>الكمية</th>${R.approved_at ? '<th>المعتمد</th>' : ''}<th>السعر التقديري</th>${R.purchased_at || buying ? '<th>السعر الفعلي</th>' : ''}</tr></thead><tbody>
        ${R.items.map((i) => `<tr><td><b>${esc(i.name)}</b>${i.specs ? `<div class="hint">${esc(i.specs)}</div>` : ''}</td><td>${esc(i.qty)} ${esc(i.unit)}</td>
          ${R.approved_at ? `<td>${i.appr_qty == null ? '—' : esc(i.appr_qty)}</td>` : ''}<td>${i.est_price == null ? '—' : money(i.est_price)}</td>
          ${buying ? `<td><input type="number" step="any" data-ap="${i.id}" value="${i.act_price ?? ''}" style="width:100px"></td>` : R.purchased_at ? `<td>${money(i.act_price)}</td>` : ''}</tr>`).join('')}</tbody></table>
      <p>التقدير: <b>${money(R.est_total)}</b>${R.actual_total != null ? ` · الفعلي: <b>${money(R.actual_total)}</b>` : ''}${R.supplier ? ` · 🏪 ${esc(R.supplier)}` : ''}${R.invoice_no ? ` · فاتورة ${esc(R.invoice_no)}` : ''}${R.invoice_url ? ` · <a href="${esc(R.invoice_url)}" target="_blank" rel="noopener">📄 الفاتورة</a>` : ''}</p>
      ${R.decision_note ? `<div class="notice ${R.status === 'rejected' ? 'err' : 'ok'}">${R.status === 'rejected' ? '⛔' : '✅'} ${esc(R.approver || 'المدير التنفيذي')}: ${esc(R.decision_note)}</div>` : ''}
      ${approvable ? `<div class="glass" style="padding:10px"><b>✅ قرار المدير التنفيذي</b><p class="hint">يمكنك تعديل الكمية المعتمدة لكل صنف:</p>${R.items.map((i) => `<label class="chk">${esc(i.name)} <input type="number" step="any" data-aq="${i.id}" value="${esc(i.qty)}" style="width:90px"> ${esc(i.unit)}</label>`).join('')}
        <label class="f">ملاحظة (إلزامية عند عدم الاعتماد)<input id="dn"></label></div>` : ''}
      ${buying ? `<div class="glass" style="padding:10px"><b>🛍️ بيانات الشراء</b><div class="form-grid"><label class="f">المورد<input id="sp"></label><label class="f">رقم الفاتورة<input id="iv"></label>
        <label class="f">الإجمالي الفعلي (يُحسب من الأسعار إن تُرك فارغًا)<input type="number" step="any" id="at"></label></div><label class="f">رابط صورة الفاتورة (اختياري)<input id="iu" dir="ltr" placeholder="https://drive.google.com/..."></label></div>` : ''}
      ${delivering ? `<label class="f">تم التسليم إلى<input id="dt" placeholder="اسم المستلم" value="${esc(R.requester || '')}"></label>` : ''}
      <h4 style="margin-bottom:4px">🕘 سير الطلب</h4>${R.log.map((l) => `<div class="lg"><span class="hint">${esc(fmt(l.at))} · ${esc(l.by || '')}</span><div>${esc(l.status || '')}${l.note ? ' — ' + esc(l.note) : ''}</div></div>`).join('')}`;
    const done = async (fn, args, msg) => { await call(fn, args); toast(msg); await reloadMe(); after && after(); return true; };
    const acts = [{ label: 'إغلاق', value: null }];
    if (R.mine && ['pending', 'rejected'].includes(R.status)) {
      acts.unshift({ label: 'إلغاء الطلب', cls: 'danger', onClick: async () => (await confirmBox('إلغاء طلب الشراء؟', 'إلغاء')) ? done('pr_requester', { p_id: id, p_action: 'cancelled' }, 'أُلغي الطلب') : false });
      acts.push({ label: '✏️ تعديل وإعادة الإرسال', onClick: () => { setTimeout(() => reqForm(R), 50); return true; } });
    }
    if (R.mine && R.status === 'delivered') acts.push({ label: '🤝 تأكيد الاستلام', cls: 'primary', onClick: () => done('pr_requester', { p_id: id, p_action: 'received' }, 'شكرًا — تم تأكيد الاستلام ✓') });
    if (approvable) {
      const qty = (w) => Object.fromEntries($$('[data-aq]', w).map((x) => [x.dataset.aq, x.value]));
      acts.push({ label: '⛔ عدم اعتماد', cls: 'danger', onClick: (w) => { if (!$('#dn', w).value.trim()) { toast('اكتب سبب عدم الاعتماد', 'err'); return false; } return done('pr_decide', { p_id: id, p_approve: false, p_note: $('#dn', w).value, p_qty: {} }, 'تم'); } });
      acts.push({ label: '✅ اعتماد', cls: 'primary', onClick: (w) => done('pr_decide', { p_id: id, p_approve: true, p_note: $('#dn', w).value, p_qty: qty(w) }, 'اعتُمد الطلب ✓ — وصل إشعار للمشتريات') });
    }
    if (buying) {
      if (R.status === 'approved') acts.push({ label: '🛒 بدء الشراء', onClick: () => done('pr_buy', { p_id: id, p: { status: 'purchasing' } }, 'تم ✓') });
      acts.push({ label: '⛔ إلغاء', cls: 'danger', onClick: async () => { const n = await modal({ title: 'إلغاء الطلب', body: '<label class="f">السبب (يصل لمقدم الطلب)<input id="cn"></label>', actions: [{ label: 'رجوع', value: null }, { label: 'إلغاء الطلب', cls: 'danger', onClick: (w) => $('#cn', w).value.trim() || false }] });
        return n ? done('pr_buy', { p_id: id, p: { status: 'cancelled', note: n } }, 'أُلغي') : false; } });
      acts.push({ label: '🛍️ تم الشراء', cls: 'primary', onClick: (w) => done('pr_buy', { p_id: id, p: { status: 'purchased', supplier: $('#sp', w).value, invoice_no: $('#iv', w).value, invoice_url: $('#iu', w).value, actual_total: $('#at', w).value,
        prices: Object.fromEntries($$('[data-ap]', w).map((x) => [x.dataset.ap, x.value])) } }, 'تم تسجيل الشراء ✓ — وصل إشعار لمقدم الطلب') });
    }
    if (delivering) acts.push({ label: '📦 تم التسليم', cls: 'primary', onClick: (w) => done('pr_buy', { p_id: id, p: { status: 'delivered', delivered_to: $('#dt', w).value } }, 'تم التسليم ✓') });
    modal({ title: `#${R.id} ${R.title}`, wide: true, body, actions: acts });
  }

  async function statsView() {
    const y = new Date(), d0 = `${y.getMonth() >= 7 ? y.getFullYear() : y.getFullYear() - 1}-08-01`;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">من <input type="date" id="f" value="${d0}"> إلى <input type="date" id="t" value="${new Date().toISOString().slice(0, 10)}"><button class="btn sm" id="r">تحديث</button></div><div id="sb"></div>`;
    const load = async () => { let S; try { S = await call('pr_stats', { p_from: $('#f').value, p_to: $('#t').value }); } catch (e) { $('#sb').innerHTML = esc(errMsg(e)); return; }
      const T = (h, rows, cols) => `<div class="glass" style="padding:10px 12px"><h4 style="margin:0 0 6px">${h}</h4><table class="t"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td class="hint">—</td></tr>`}</tbody></table></div>`;
      $('#sb').innerHTML = `<div class="kpi4"><div class="card-box glass"><b>${S.total}</b>طلب</div><div class="card-box glass"><b>${S.approved}</b>معتمد${S.rejected ? ` · ${S.rejected} مرفوض` : ''}</div>
          <div class="card-box glass"><b>${money(S.spent)}</b>المصروف الفعلي</div><div class="card-box glass"><b>${S.approve_hours ?? '—'}</b>متوسط ساعات الاعتماد${S.cycle_days != null ? ` · ${S.cycle_days} يوم للتسليم` : ''}</div></div>
        <div class="row2">${T('🏢 حسب القسم', S.by_dept.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${money(x.spent)}</td></tr>`).join(''), ['القسم', 'الطلبات', 'المصروف'])}
          ${T('🏪 حسب المورد', S.by_supplier.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${money(x.spent)}</td></tr>`).join(''), ['المورد', 'الطلبات', 'المبلغ'])}
          ${T('📆 حسب الشهر', S.by_month.map((x) => `<tr><td>${esc(x.m)}</td><td>${x.n}</td><td>${money(x.spent)}</td></tr>`).join(''), ['الشهر', 'الطلبات', 'المصروف'])}</div>`; };
    $('#r').onclick = load; await load();
  }

  async function settingsView() {
    let L; try { L = (await call('cs_lists')).staff; } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
    const ap = (ME.approvers || []).map((x) => x.id), bu = (ME.buyers || []).map((x) => x.id);
    const pick = (k, sel) => `<input placeholder="🔎 تصفية" data-flt="${k}" style="width:100%;margin-bottom:4px"><div class="pk" data-pk="${k}" style="max-height:220px;overflow:auto;columns:2 220px">${L.map((s) => `<label class="chk" data-n="${esc(s.name + ' ' + (s.job || ''))}"><input type="checkbox" data-${k}="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}> ${esc(s.name)} <span class="hint">${esc(s.job || '')}</span></label>`).join('')}</div>`;
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">⚙️ إعدادات المشتريات</h3>
      <div class="row2"><div><b>✅ من يعتمد طلبات الشراء (المدير التنفيذي)</b>${pick('ap', ap)}</div><div><b>🛍️ قسم المشتريات (ينفّذ الشراء والتسليم)</b>${pick('bu', bu)}</div></div>
      <label class="f">الأقسام (قسم في كل سطر — تظهر عند كتابة الطلب)<textarea id="dps" rows="5">${esc((ME.departments || []).join('\n'))}</textarea></label>
      <p class="hint">إن لم تحدد أحدًا يُعتمد المسمى الوظيفي: «المدير التنفيذي» للاعتماد، و«مشتريات» للشراء. <b>الطلب نفسه للإداريين فقط</b> (الموظفون والقيادات ومديرو المراحل) — لا يظهر للمعلمين.</p>
      <button class="btn primary" id="sv">حفظ</button></div>`;
    view.oninput = (e) => { const f = e.target.dataset.flt; if (!f) return; const q = e.target.value.trim(); $$(`[data-pk="${f}"] [data-n]`).forEach((l) => { l.style.display = !q || l.dataset.n.includes(q) ? '' : 'none'; }); };
    $('#sv').onclick = async () => { try { await call('pr_settings_set', { p: { approver_ids: $$('[data-ap]:checked').map((x) => x.dataset.ap), buyer_ids: $$('[data-bu]:checked').map((x) => x.dataset.bu),
      departments: $('#dps').value.split('\n').map((x) => x.trim()).filter(Boolean) } }); await reloadMe(); toast('تم الحفظ ✓'); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  paint();
})();
