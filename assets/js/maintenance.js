/* =====================================================================
   طلبات الصيانة (sql/81)
   أي موظف يرفع طلبًا ← قسم الصيانة يسنده لفني ← الفني ينفّذ ويحدّث الحالة ← مقدم الطلب يقيّم
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('maintenance', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME; try { ME = await call('mn_me'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const CAT = { electric: '💡 كهرباء', plumbing: '🚿 سباكة', ac: '❄️ تكييف', carpentry: '🚪 نجارة وأبواب', it: '💻 أجهزة وشبكات', cleaning: '🧹 نظافة', furniture: '🪑 أثاث', safety: '🧯 أمن وسلامة', other: '🔧 أخرى' };
  const PR = { low: 'منخفضة', normal: 'عادية', high: 'عالية', urgent: '🚨 عاجلة' };
  const ST = { new: ['جديد', ''], assigned: ['مسند لفني', 'gold'], in_progress: ['قيد التنفيذ', 'gold'], waiting: ['بانتظار قطع/مورد', 'gold'], done: ['منجز', 'ok'], rejected: ['مرفوض', 'bad'], cancelled: ['ملغى', 'bad'] };
  const opts = (o, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') + Object.entries(o).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(Array.isArray(v) ? v[0] : v)}</option>`).join('');
  const fmt = (t) => (t ? new Date(t).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const stars = (n) => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));

  const tabs = [['mine', '📝 طلباتي'], ['assigned', '🔧 المسندة إليّ']].concat(ME.mgr ? [['all', '🗂️ كل الطلبات'], ['stats', '📊 التقارير'], ['settings', '⚙️ المواقع']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : (ME.mgr ? 'all' : 'mine');
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return TAB === 'stats' ? statsView() : TAB === 'settings' ? settingsView() : listView(); };

  let F = { status: 'open', category: '', q: '' };
  async function listView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn primary sm" id="nr">＋ طلب صيانة جديد</button>
        <select id="fs"><option value="open" ${F.status === 'open' ? 'selected' : ''}>المفتوحة</option><option value="" ${F.status === '' ? 'selected' : ''}>الكل</option>${opts(ST, F.status)}</select>
        <select id="fc">${opts(CAT, F.category, 'كل التصنيفات')}</select><input id="fq" placeholder="🔎 بحث" value="${esc(F.q)}" style="flex:1;min-width:140px"></div><div id="ls"><div class="empty">جارٍ التحميل…</div></div>`;
    $('#nr').onclick = newReq;
    const load = async () => {
      let L; try { L = await call('mn_list', { p: { view: TAB, status: F.status, category: F.category, q: F.q } }); } catch (e) { $('#ls').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      $('#ls').innerHTML = L.map((r) => `<div class="glass xc req ${r.priority}" data-id="${r.id}" style="cursor:pointer">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>#${r.id} ${esc(r.title)}</b><span class="pill ${ST[r.status][1]}">${esc(ST[r.status][0])}</span>
            ${r.priority === 'urgent' || r.priority === 'high' ? `<span class="pill bad">${esc(PR[r.priority])}</span>` : ''}${r.rating ? `<span class="pill" style="color:#c79100">${stars(r.rating)}</span>` : ''}</div>
          <div class="hint">${esc(CAT[r.category] || '')} · 📍 ${esc(r.location)} · ${esc(fmt(r.created_at))}${TAB !== 'mine' ? ' · من ' + esc(r.requester || '') : ''}${r.assignee ? ' · 🔧 ' + esc(r.assignee) : ''}${r.status !== 'done' && r.age_days > 0 ? ` · منذ ${r.age_days} يوم` : ''}</div></div>`).join('')
        || `<div class="empty">${TAB === 'mine' ? 'لم ترفع طلبات بعد. اضغط «＋ طلب صيانة جديد» لأي عطل في فصلك أو مكتبك.' : 'لا توجد طلبات.'}</div>`;
    };
    let t; $('#fq').oninput = (e) => { F.q = e.target.value; clearTimeout(t); t = setTimeout(load, 300); };
    $('#fs').onchange = (e) => { F.status = e.target.value; load(); }; $('#fc').onchange = (e) => { F.category = e.target.value; load(); };
    view.onclick = (e) => { const c = e.target.closest('[data-id]'); if (c) openReq(+c.dataset.id, load); };
    await load();
  }

  function newReq() {
    const locs = ME.locations || [];
    modal({ title: '🛠️ طلب صيانة جديد', body: `<label class="f">ما المشكلة؟<input id="t" placeholder="مثال: مكيف الفصل لا يبرد" maxlength="120"></label>
      <div class="form-grid"><label class="f">التصنيف<select id="c">${opts(CAT, 'other')}</select></label>
        <label class="f">الموقع<input id="l" list="locs" placeholder="مثال: فصل 3/أ — المبنى ب"><datalist id="locs">${locs.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
        <label class="f">الأولوية<select id="p">${opts(PR, 'normal')}</select></label></div>
      <label class="f">تفاصيل (اختياري)<textarea id="d" rows="3" placeholder="متى بدأت المشكلة؟ هل تؤثر على الحصص أو السلامة؟"></textarea></label>
      <p class="hint">🚨 «عاجلة» للأعطال التي تمس السلامة أو تعطل العمل (تسريب ماء، كهرباء مكشوفة…) — تصل للإدارة العليا أيضًا.</p>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'إرسال الطلب', cls: 'primary', onClick: async (w) => {
        const p = { title: $('#t', w).value.trim(), category: $('#c', w).value, location: $('#l', w).value.trim(), priority: $('#p', w).value, details: $('#d', w).value.trim() };
        if (!p.title || !p.location) { toast('اكتب المشكلة والموقع', 'err'); return false; }
        await call('mn_create', { p }); toast('تم إرسال الطلب ✓ — وصل إشعار لقسم الصيانة'); go('mine'); return true; } }] });
  }

  async function openReq(id, after) {
    let R; try { R = await call('mn_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const closed = ['done', 'rejected', 'cancelled'].includes(R.status);
    const techs = ME.techs || [];
    const body = `<div class="fcts" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px"><span class="pill ${ST[R.status][1]}">${esc(ST[R.status][0])}</span><span class="pill">${esc(CAT[R.category])}</span>
        <span class="pill">📍 ${esc(R.location)}</span><span class="pill">الأولوية: ${esc(PR[R.priority])}</span>${R.cost != null ? `<span class="pill">💰 ${esc(R.cost)} ريال</span>` : ''}</div>
      ${R.details ? `<p>${esc(R.details)}</p>` : ''}<p class="hint">من: ${esc(R.requester || '')} · ${esc(fmt(R.created_at))}${R.assignee ? ' · الفني: <b>' + esc(R.assignee) + '</b>' : ''}${R.due_on ? ' · موعد التنفيذ: ' + esc(R.due_on) : ''}</p>
      ${R.resolution ? `<div class="notice ok">✅ ${esc(R.resolution)}</div>` : ''}${R.rating ? `<p>تقييم مقدم الطلب: <span style="color:#c79100">${stars(R.rating)}</span> ${esc(R.rating_note || '')}</p>` : ''}
      <h4 style="margin-bottom:4px">🕘 سير الطلب</h4>${R.updates.map((u) => `<div class="lg"><span class="hint">${esc(fmt(u.at))} · ${esc(u.by || '')}</span><div>${u.status ? '<b>' + esc(u.status) + '</b> ' : ''}${esc(u.note || '')}</div></div>`).join('')}
      ${ME.mgr && !closed ? `<div class="glass" style="padding:10px;margin-top:10px"><b>⚙️ إدارة الطلب</b><div class="form-grid" style="margin-top:6px">
          <label class="f">الفني المسؤول<select id="as"><option value="">— غير مسند —</option>${techs.map((t) => `<option value="${t.id}" ${t.id === R.assignee_id ? 'selected' : ''}>${esc(t.name)}${t.job ? ' — ' + esc(t.job) : ''}</option>`).join('')}
            ${R.assignee_id && !techs.some((t) => t.id === R.assignee_id) ? `<option value="${R.assignee_id}" selected>${esc(R.assignee)}</option>` : ''}</select></label>
          <label class="f">الأولوية<select id="pr">${opts(PR, R.priority)}</select></label><label class="f">موعد التنفيذ<input type="date" id="du" value="${esc(R.due_on || '')}"></label>
          <label class="f">الحالة<select id="st">${opts(ST, R.status)}</select></label><label class="f">التكلفة (ريال)<input type="number" id="co" value="${R.cost ?? ''}"></label></div>
          <label class="f">ملاحظة (سبب الرفض / ما تم تنفيذه)<input id="no"></label></div>` : ''}
      ${!ME.mgr && R.assigned_me && !closed ? `<div class="glass" style="padding:10px;margin-top:10px"><b>🔧 تحديث التنفيذ</b>
          <div class="form-grid" style="margin-top:6px"><label class="f">الحالة<select id="st"><option value="in_progress">قيد التنفيذ</option><option value="waiting">بانتظار قطع/مورد</option><option value="done">✅ تم التنفيذ</option></select></label>
          <label class="f">التكلفة (ريال، إن وجدت)<input type="number" id="co"></label></div><label class="f">ما تم عمله<input id="no"></label></div>` : ''}
      ${R.mine && R.status === 'done' && !R.rating ? `<div class="glass" style="padding:10px;margin-top:10px"><b>⭐ قيّم الخدمة</b><div id="rt" style="font-size:1.8rem;color:#c79100;cursor:pointer;letter-spacing:4px">${[1, 2, 3, 4, 5].map((n) => `<span data-s="${n}">☆</span>`).join('')}</div>
          <input id="rn" placeholder="ملاحظة (اختياري)"></div>` : ''}`;
    let star = 0;
    const acts = [{ label: 'إغلاق', value: null }];
    if (R.mine && R.status === 'new') acts.unshift({ label: 'إلغاء الطلب', cls: 'danger', onClick: async () => { await call('mn_update', { p_id: id, p: { status: 'cancelled' } }); toast('أُلغي الطلب'); after && after(); return true; } });
    if ((ME.mgr || R.assigned_me) && !closed) acts.push({ label: 'حفظ', cls: 'primary', onClick: async (w) => {
      const p = { status: $('#st', w).value, note: $('#no', w).value.trim(), cost: $('#co', w).value };
      if (ME.mgr) { Object.assign(p, { assignee_id: $('#as', w).value, priority: $('#pr', w).value, due_on: $('#du', w).value }); if (p.status === R.status) delete p.status; }
      if (p.status === 'done' && !p.note) { toast('اكتب ما تم تنفيذه', 'err'); return false; }
      await call('mn_update', { p_id: id, p }); toast('تم الحفظ ✓'); after && after(); return true; } });
    if (R.mine && R.status === 'done' && !R.rating) acts.push({ label: 'إرسال التقييم', cls: 'primary', onClick: async (w) => {
      if (!star) { toast('اختر عدد النجوم', 'err'); return false; } await call('mn_rate', { p_id: id, p_stars: star, p_note: $('#rn', w).value }); toast('شكرًا لتقييمك ✓'); after && after(); return true; } });
    modal({ title: `#${R.id} ${R.title}`, wide: true, body, actions: acts });
    const w = [...document.querySelectorAll('.modal-wrap')].pop(), rt = w && $('#rt', w);
    if (rt) rt.onclick = (e) => { const s = e.target.closest('[data-s]'); if (!s) return; star = +s.dataset.s; $$('[data-s]', rt).forEach((x) => { x.textContent = +x.dataset.s <= star ? '★' : '☆'; }); };
  }

  async function statsView() {
    const y = new Date(); const d0 = new Date(y.getFullYear(), y.getMonth() - 2, 1).toISOString().slice(0, 10);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">من <input type="date" id="f" value="${d0}"> إلى <input type="date" id="t" value="${new Date().toISOString().slice(0, 10)}"><button class="btn sm" id="r">تحديث</button></div><div id="sb"></div>`;
    const load = async () => {
      let S; try { S = await call('mn_stats', { p_from: $('#f').value, p_to: $('#t').value }); } catch (e) { $('#sb').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      const T = (h, rows, cols) => `<div class="glass" style="padding:10px 12px"><h4 style="margin:0 0 6px">${h}</h4><table class="t"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`;
      $('#sb').innerHTML = `<div class="kpi4"><div class="card-box glass"><b>${S.total}</b>طلب</div><div class="card-box glass"><b style="color:#b3261e">${S.open}</b>مفتوح${S.urgent_open ? ` (${S.urgent_open} عاجل)` : ''}</div>
          <div class="card-box glass"><b>${S.avg_hours ?? '—'}</b>متوسط ساعات الإنجاز</div><div class="card-box glass"><b style="color:#c79100">${S.rating ?? '—'}</b>متوسط التقييم من 5</div></div>
        <div class="row2">${T('🔧 حسب التصنيف', S.by_cat.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${x.open}</td></tr>`).join(''), ['التصنيف', 'الطلبات', 'مفتوح'])}
          ${T('📍 أكثر المواقع أعطالًا', S.by_loc.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td></tr>`).join(''), ['الموقع', 'الطلبات'])}
          ${T('👷 أداء الفنيين', S.by_tech.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td><td>${x.done}</td><td>${x.rating ?? '—'}</td></tr>`).join(''), ['الفني', 'مسند', 'منجز', 'التقييم'])}</div>
        <p class="hint">إجمالي التكاليف المسجلة: ${esc(S.cost)} ريال</p>`;
    };
    $('#r').onclick = load; await load();
  }

  function settingsView() {
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">📍 مواقع المدرسة</h3><p class="hint">قائمة تظهر للمعلم عند كتابة الموقع (مبنى، فصل، معمل، دورة مياه…) — موقع في كل سطر. ويمكنه كتابة موقع آخر.</p>
      <textarea id="lc" rows="12" style="width:100%">${esc((ME.locations || []).join('\n'))}</textarea><button class="btn primary" id="sv">حفظ</button></div>`;
    $('#sv').onclick = async () => { try { const L = $('#lc').value.split('\n').map((x) => x.trim()).filter(Boolean); await call('mn_settings_set', { p_locations: L }); ME.locations = L; toast('تم الحفظ ✓'); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  paint();
})();
