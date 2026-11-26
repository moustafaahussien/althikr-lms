/* =====================================================================
   العيادة المدرسية (sql/70)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('clinic', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const NURSE = await call('cl_am_nurse').catch(() => false);
  const KIND = { allergy: '⚠️ حساسية', chronic: '🩺 مرض مزمن', medication: '💊 دواء مستمر', disability: '♿ احتياج خاص', other: '📌 أخرى' };
  const ACT = { first_aid: 'إسعافات أولية', rest: 'راحة في العيادة', medication: 'إعطاء دواء', returned: 'عاد للفصل', parent_called: 'تم الاتصال بولي الأمر', sent_home: 'خرج مع ولي الأمر', hospital: 'تحويل للمستشفى' };
  const fmt = (t) => new Date(t).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

  const tabs = (NURSE ? [['today', '📋 زيارات اليوم'], ['student', '🔎 ملف طالب'], ['stats', '📊 الإحصاءات']] : []).concat([['alerts', '⚠️ تنبيهات صحية لطلابي']]);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => ({ today: todayView, student: () => searchView(), stats: statsView, alerts: alertsView })[TAB]();

  async function alertsView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('cl_alerts'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<p class="hint">🔒 معلومات سرية لسلامة الطالب فقط — لا تُشارك خارج نطاق العمل.</p>` + (L.map((a) => `<div class="glass cond"><b>${esc(a.name)}</b> <small class="hint">${esc(a.class)}</small>
        <div>${KIND[a.kind] || ''} — <b>${esc(a.title)}</b></div>${a.emergency ? `<div>🚑 عند الطوارئ: ${esc(a.emergency)}</div>` : ''}</div>`).join('') || '<div class="empty">لا توجد تنبيهات صحية لطلاب فصولك.</div>');
  }

  async function todayView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('cl_today'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="nv">＋ تسجيل زيارة</button><span class="grow"></span><b>${L.length}</b>&nbsp;زيارة اليوم</div>
      <div class="glass" style="padding:6px"><table class="t"><thead><tr><th>الوقت</th><th>الطالب</th><th>الشكوى</th><th>الحرارة</th><th>الإجراء</th></tr></thead><tbody>
      ${L.map((v) => `<tr style="cursor:pointer" data-s="${v.student_id}"><td>${esc(v.time)}</td><td><b>${esc(v.name)}</b><div class="hint">${esc(v.class || '')}</div></td><td>${esc(v.complaint)}</td><td>${v.temp ?? '—'}</td><td>${esc(v.action)}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="hint">لا زيارات اليوم.</td></tr>'}</tbody></table></div>`;
    $('#nv').onclick = () => searchView(true);
    view.onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) { TAB = 'student'; $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'student')); studentView(r.dataset.s); } };
  }

  function searchView(forVisit) {
    if (TAB !== 'student') { TAB = 'student'; $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'student')); }
    view.innerHTML = `<div class="glass xc"><label class="f">ابحث عن الطالب بالاسم أو رقم الطالب<input id="q" type="search" autofocus placeholder="اكتب حرفين على الأقل…"></label><div class="res" id="res"></div></div><div id="st"></div>`;
    let tm;
    $('#q').oninput = (e) => { clearTimeout(tm); tm = setTimeout(async () => {
      try { const R = await call('cl_search', { p_q: e.target.value });
        $('#res').innerHTML = R.map((s) => `<div data-s="${s.id}"><b>${esc(s.name)}</b> <small class="hint">${esc(s.class || '')}${s.no ? ' · ' + esc(s.no) : ''}</small>${s.flags ? ` <span class="pill bad">${s.flags} حالة صحية</span>` : ''}</div>`).join('') || (e.target.value.length > 1 ? '<div class="hint">لا نتائج</div>' : '');
      } catch (er) { toast(errMsg(er), 'err'); } }, 300); };
    $('#res').onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) studentView(r.dataset.s, forVisit); };
    setTimeout(() => $('#q') && $('#q').focus(), 50);
  }

  async function studentView(id, openVisit) {
    let S;
    try { S = await call('cl_student', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const box = $('#st') || view;
    if (!$('#st')) view.innerHTML = '<div id="st"></div>';
    const ph = [S.guardian && S.guardian.phone ? S.guardian : null].concat(S.guardians).filter(Boolean);
    $('#st').innerHTML = `<div class="glass xc"><div class="toolbar" style="margin:0"><b class="grow" style="font-size:1.1rem">${esc(S.name)}</b><span class="hint">${esc(S.class || '')}</span></div>
        <div class="hint">أولياء الأمور: ${ph.map((g) => `${esc(g.name || '')} <a href="tel:${esc(g.phone)}" dir="ltr">${esc(g.phone)}</a>`).join(' · ') || '—'}</div>
        <div class="acts"><button class="btn sm primary" id="av">＋ تسجيل زيارة</button><button class="btn sm" id="ac">＋ حالة صحية</button></div></div>
      <div class="row2"><div class="glass xc"><b>الحالات الصحية</b>${S.conditions.map((c) => `<div class="cond ${c.active ? '' : 'off'}"><div class="toolbar" style="margin:0"><b class="grow">${KIND[c.kind]} — ${esc(c.title)}</b>
            ${c.share_staff ? '<span class="pill gold">مشارَكة مع المعلمين</span>' : '<span class="pill">سرية</span>'}<button class="btn sm ghost" data-ec="${c.id}">✏️</button></div>
          ${c.details ? `<div class="hint">${esc(c.details)}</div>` : ''}${c.emergency ? `<div>🚑 ${esc(c.emergency)}</div>` : ''}</div>`).join('') || '<div class="hint">لا توجد حالات مسجلة.</div>'}</div>
        <div class="glass xc"><b>سجل الزيارات</b>${S.visits.map((v) => `<div class="visit"><div class="toolbar" style="margin:0"><b class="grow">${esc(v.complaint)}</b><small class="hint">${fmt(v.at)}</small>
            <button class="btn sm ghost danger" data-dv="${v.id}">🗑</button></div>
          <div class="hint">${esc(v.action_label)}${v.temp ? ' · 🌡️ ' + v.temp : ''}${v.to_parent ? ' · أُبلغ ولي الأمر' : ''} · ${esc(v.by || '')}</div>${v.notes ? `<div class="hint">${esc(v.notes)}</div>` : ''}</div>`).join('') || '<div class="hint">لا زيارات سابقة.</div>'}</div></div>`;
    const visitForm = () => modal({ title: 'زيارة العيادة — ' + S.name, body: `<label class="f">الشكوى *<input id="cp" list="cpl" placeholder="صداع، مغص، إصابة في الملعب…"><datalist id="cpl">${['صداع', 'مغص', 'ارتفاع حرارة', 'غثيان', 'إصابة أثناء اللعب', 'جرح', 'دوخة', 'ألم أسنان', 'حساسية', 'كدمة'].map((x) => `<option>${x}</option>`).join('')}</datalist></label>
        <div style="display:flex;gap:8px"><label class="f">الحرارة<input id="tm" type="number" step="0.1" min="34" max="43" style="width:100px"></label>
          <label class="f grow">الإجراء<select id="ac2">${Object.entries(ACT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label></div>
        <label class="f">ملاحظات<textarea id="nt" rows="2"></textarea></label>
        <label class="chk"><input type="checkbox" id="tp"> إبلاغ ولي الأمر (تظهر في بوابته)</label>
        <label class="chk"><input type="checkbox" id="tt"> إشعار رائد الفصل (دون تفاصيل الحالة) — يُرسل تلقائيًا عند الخروج أو التحويل</label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        if (!$('#cp', w).value.trim()) { toast('اكتب الشكوى', 'err'); return false; }
        await call('cl_visit_add', { p: { student_id: S.id, complaint: $('#cp', w).value, temp: $('#tm', w).value, action: $('#ac2', w).value, notes: $('#nt', w).value, to_parent: $('#tp', w).checked, notify_teacher: $('#tt', w).checked } });
        toast('سُجّلت الزيارة ✓'); studentView(S.id); return true; } }] });
    const condForm = (c) => modal({ title: c.id ? 'تعديل الحالة الصحية' : 'حالة صحية جديدة', body: `<label class="f">النوع<select id="kd">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">العنوان *<input id="ti" value="${esc(c.title || '')}" placeholder="مثال: ربو، سكري، حساسية فول سوداني"></label>
        <label class="f">التفاصيل (سرية)<textarea id="dt" rows="2">${esc(c.details || '')}</textarea></label>
        <label class="f">خطة الطوارئ<textarea id="em" rows="2" placeholder="مثال: البخاخ في حقيبته — اتصل بولي الأمر فورًا">${esc(c.emergency || '')}</textarea></label>
        <label class="chk"><input type="checkbox" id="sh" ${c.share_staff ? 'checked' : ''}> مشاركة العنوان وخطة الطوارئ مع معلمي الطالب (بدون التفاصيل)</label>
        ${c.id ? `<label class="chk"><input type="checkbox" id="ac3" ${c.active ? 'checked' : ''}> حالة قائمة</label>` : ''}`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('cl_condition_save', { p: { id: c.id || null, student_id: S.id, kind: $('#kd', w).value, title: $('#ti', w).value, details: $('#dt', w).value, emergency: $('#em', w).value,
          share_staff: $('#sh', w).checked, active: $('#ac3', w) ? $('#ac3', w).checked : true } }); toast('حُفظ ✓'); studentView(S.id); return true; } }] });
    $('#av').onclick = visitForm; $('#ac').onclick = () => condForm({ kind: 'allergy' });
    $('#st').onclick = async (e) => { const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.ec) condForm(S.conditions.find((c) => c.id === +b.dataset.ec));
      if (b.dataset.dv) { if (!await confirmBox('حذف الزيارة؟', 'حذف')) return; try { await call('cl_visit_delete', { p_id: +b.dataset.dv }); studentView(S.id); } catch (er) { toast(errMsg(er), 'err'); } } };
    if (openVisit) visitForm();
    void box;
  }

  async function statsView() {
    const d = new Date(); const f0 = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10), t0 = d.toISOString().slice(0, 10);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><label class="hint">من <input type="date" id="f" value="${f0}"></label><label class="hint">إلى <input type="date" id="t" value="${t0}"></label><button class="btn sm primary" id="go">عرض</button></div><div id="sv"></div>`;
    const load = async () => { try { const S = await call('cl_stats', { p_from: $('#f').value, p_to: $('#t').value });
      const mx = Math.max(1, ...Object.values(S.by_action));
      $('#sv').innerHTML = `<div class="kpi4"><div class="glass card-box"><b>${S.visits}</b>زيارة</div><div class="glass card-box"><b>${S.students}</b>طالب</div>
          <div class="glass card-box"><b>${S.conditions}</b>حالة صحية قائمة</div><div class="glass card-box"><b>${S.shared}</b>مشارَكة مع المعلمين</div></div>
        <div class="row2"><div class="glass xc"><b>الإجراءات</b>${Object.entries(S.by_action).map(([k, n]) => `<div style="display:grid;grid-template-columns:150px 1fr 40px;gap:8px;align-items:center;margin:4px 0"><span>${esc(k)}</span><div class="bar"><i style="width:${n / mx * 100}%"></i></div><b>${n}</b></div>`).join('') || '<div class="hint">—</div>'}</div>
          <div class="glass xc"><b>الأكثر زيارة</b><table class="t">${S.top.map((x) => `<tr style="cursor:pointer" data-s="${x.id}"><td>${esc(x.name)}</td><td><b>${x.n}</b></td></tr>`).join('') || '<tr><td class="hint">—</td></tr>'}</table></div></div>`;
      $('#sv').onclick = (e) => { const r = e.target.closest('[data-s]'); if (r) { TAB = 'student'; $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === 'student')); view.innerHTML = '<div id="st"></div>'; studentView(r.dataset.s); } };
    } catch (e) { $('#sv').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; } };
    $('#go').onclick = load; load();
  }

  paint();
})();
