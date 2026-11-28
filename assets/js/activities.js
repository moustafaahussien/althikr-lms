/* =====================================================================
   الأنشطة المدرسية (sql/81) — خطة الأنشطة، التوثيق والتقرير، مشاركات الطلاب، الإحصاءات
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('activities', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let LISTS; try { LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
  const KIND = { cultural: '📚 ثقافي', sports: '⚽ رياضي', scientific: '🔬 علمي', social: '🤝 اجتماعي وتطوعي', arts: '🎨 فني', religious: '🕌 ديني', national: '🇸🇦 وطني', health: '🩺 صحي', environmental: '🌱 بيئي', competition: '🏆 مسابقة', other: '⭐ متنوع' };
  const ST = { planned: ['🗓️ مخطط', 'gold'], done: ['✅ نُفّذ', 'ok'], cancelled: ['ملغى', 'bad'] };
  const ROLE = { participant: 'مشارك', organizer: 'منظم', winner: '🏆 فائز', honored: '🎖️ مكرَّم' };
  const y = new Date(), yStart = `${y.getMonth() >= 7 ? y.getFullYear() : y.getFullYear() - 1}-08-01`;
  const tabs = [['list', '🎯 الأنشطة'], ['stats', '📊 الإحصاءات']];
  let TAB = location.hash.slice(1) === 'stats' ? 'stats' : 'list';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB); $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => { view.onclick = null; return TAB === 'stats' ? statsView() : listView(); };

  const F = { from: yStart, to: '', kind: '', mine: false };
  async function listView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary sm" id="na">＋ نشاط جديد</button>
      من <input type="date" id="ff" value="${F.from}"> إلى <input type="date" id="ft" value="${F.to}"><select id="fk"><option value="">كل الأنواع</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === F.kind ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="chk" style="margin:0"><input type="checkbox" id="fm" ${F.mine ? 'checked' : ''}> أنشطتي فقط</label></div><div id="al"></div>`;
    let D;
    const load = async () => { try { D = await call('ac_list', { p: F }); } catch (e) { $('#al').innerHTML = esc(errMsg(e)); return; }
      $('#al').innerHTML = D.items.map((a) => `<div class="glass xc"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="nm-link" style="font-size:1.05rem" data-op="${a.id}">${esc(a.title)}</button><span class="pill">${esc(KIND[a.kind])}</span><span class="pill ${ST[a.status][1]}">${ST[a.status][0]}</span></div>
          <div class="hint">📅 ${esc(a.day)}${a.end_day ? ' → ' + esc(a.end_day) : ''}${a.place ? ' · 📍 ' + esc(a.place) : ''} · 👤 ${esc(a.organizer || '')}${a.team_names.length ? ' + ' + esc(a.team_names.join('، ')) : ''} · 🎯 ${esc(a.grades)} · 👦 ${a.students_n} طالب</div>
          ${a.description ? `<div>${esc(a.description)}</div>` : ''}<div class="acts"><button class="btn sm" data-op="${a.id}">📂 فتح</button>${a.can ? `<button class="btn sm" data-ed="${a.id}">✏️</button>${a.status === 'planned' ? `<button class="btn sm primary" data-rp="${a.id}">📝 توثيق التنفيذ</button>` : ''}` : ''}</div></div>`).join('')
        || '<div class="empty">لا أنشطة في هذه الفترة. أضف خطة أنشطة المدرسة: اليوم الوطني، المسابقات، الأيام العالمية، الحملات…</div>'; };
    $('#na').onclick = () => form({ kind: 'cultural', team: [], grade_ids: [], links: [], status: 'planned' }, load);
    [['#ff', 'from'], ['#ft', 'to'], ['#fk', 'kind']].forEach(([s, k]) => { $(s).onchange = (e) => { F[k] = e.target.value; load(); }; }); $('#fm').onchange = (e) => { F.mine = e.target.checked; load(); };
    view.onclick = (e) => { const b = e.target.closest('button'); if (!b || b.id === 'na') return; const a = D.items.find((x) => x.id === +(b.dataset.op || b.dataset.ed || b.dataset.rp)); if (!a) return;
      if (b.dataset.ed) form(a, load); if (b.dataset.op) open(a.id, load); if (b.dataset.rp) report(a, load); };
    await load();
  }
  function form(a, after) {
    const staff = LISTS.staff || [];
    modal({ title: a.id ? '✏️ ' + a.title : '＋ نشاط جديد', wide: true, body: `<div class="form-grid"><label class="f">عنوان النشاط<input id="ti" value="${esc(a.title || '')}"></label>
        <label class="f">النوع<select id="kd">${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${k === a.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f">التاريخ<input type="date" id="dy" value="${esc(a.day || '')}"></label><label class="f">إلى (اختياري)<input type="date" id="ed" value="${esc(a.end_day || '')}"></label>
        <label class="f">المكان<input id="pl" value="${esc(a.place || '')}"></label><label class="f">الميزانية (ريال)<input type="number" id="bg" value="${a.budget ?? ''}"></label>
        <label class="f">الحالة<select id="st">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></label></div>
      <label class="f">وصف النشاط<textarea id="ds" rows="2">${esc(a.description || '')}</textarea></label><label class="f">الأهداف<textarea id="gl" rows="2">${esc(a.goals || '')}</textarea></label>
      <details><summary><b>🎯 الصفوف المستهدفة</b> <span class="hint">(بدون تحديد = الكل)</span></summary><div style="columns:3 180px">${(LISTS.grades || []).map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" ${a.grade_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div></details>
      <details><summary><b>👥 فريق التنفيذ</b></summary><div style="columns:3 180px">${staff.map((s) => `<label class="chk"><input type="checkbox" data-s="${s.id}" ${a.team.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></details>`,
      actions: [a.id && a.can ? { label: '🗑️ حذف', cls: 'danger', onClick: async () => { if (!await confirmBox('حذف النشاط؟', 'حذف')) return false; await call('ac_delete', { p_id: a.id }); after(); return true; } } : null,
        { label: 'إلغاء', value: null }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const v = (s) => $(s, w).value.trim();
        await call('ac_save', { p: Object.assign({}, a, { id: a.id || '', title: v('#ti'), kind: v('#kd'), day: v('#dy'), end_day: v('#ed'), place: v('#pl'), budget: v('#bg'), status: v('#st'), description: v('#ds'), goals: v('#gl'),
          grade_ids: $$('[data-g]:checked', w).map((x) => +x.dataset.g), team: $$('[data-s]:checked', w).map((x) => x.dataset.s) }) });
        toast('تم الحفظ ✓'); after(); return true; } }].filter(Boolean) });
  }
  function report(a, after) {
    modal({ title: '📝 توثيق تنفيذ: ' + a.title, wide: true, body: `<div class="form-grid"><label class="f">عدد المشاركين الفعلي<input type="number" id="pc" value="${a.participants ?? a.students_n ?? ''}"></label></div>
      <label class="f">تقرير التنفيذ (ماذا تم؟)<textarea id="rp" rows="4">${esc(a.report || '')}</textarea></label><label class="f">النتائج والأثر والتوصيات<textarea id="oc" rows="3">${esc(a.outcomes || '')}</textarea></label>
      <label class="f">روابط الصور والفيديو (رابط في كل سطر — مثل مجلد Google Drive)<textarea id="lk" rows="2" dir="ltr">${esc((a.links || []).join('\n'))}</textarea></label>`,
      actions: [{ label: 'إلغاء', value: null }, { label: '✅ حفظ وتعيين كمنفّذ', cls: 'primary', onClick: async (w) => {
        await call('ac_save', { p: Object.assign({}, a, { status: 'done', participants: $('#pc', w).value, report: $('#rp', w).value, outcomes: $('#oc', w).value, links: $('#lk', w).value.split('\n').map((x) => x.trim()).filter(Boolean) }) });
        toast('تم التوثيق ✓'); after(); return true; } }] });
  }
  async function open(id, after) {
    const box = document.createElement('div'); let A;
    const load = async () => { A = await call('ac_get', { p_id: id }); draw(); };
    function draw() {
      box.innerHTML = `<p><span class="pill">${esc(KIND[A.kind])}</span> <span class="pill ${ST[A.status][1]}">${ST[A.status][0]}</span> 📅 ${esc(A.day)}${A.place ? ' · 📍 ' + esc(A.place) : ''}</p>
        ${A.goals ? `<p><b>الأهداف:</b> ${esc(A.goals)}</p>` : ''}${A.report ? `<div class="notice ok"><b>التقرير:</b> ${esc(A.report)}${A.outcomes ? `<br><b>الأثر:</b> ${esc(A.outcomes)}` : ''}</div>` : ''}
        ${(A.links || []).length ? `<p>${A.links.map((l, i) => `<a href="${esc(l)}" target="_blank" rel="noopener">📷 رابط ${i + 1}</a>`).join(' · ')}</p>` : ''}
        <h4 style="margin-bottom:4px">👦 الطلاب المشاركون (${A.students.length})</h4>
        ${A.can ? `<div style="display:flex;gap:6px;flex-wrap:wrap"><input id="sq" placeholder="🔎 أضف طالبًا" style="flex:1"><select id="cl"><option value="">أو أضف فصلًا كاملًا…</option>${(LISTS.classes || []).map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div><div id="sr" class="res"></div>` : ''}
        <table class="t"><tbody>${A.students.map((s) => `<tr><td><b>${esc(s.name)}</b><div class="hint">${esc(s.class || '')}</div></td><td>${A.can ? `<select data-rl="${s.id}">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${k === s.role ? 'selected' : ''}>${l}</option>`).join('')}</select>` : esc(ROLE[s.role])}</td>
          <td>${A.can ? `<button class="btn sm danger" data-rm="${s.id}">✕</button>` : ''}</td></tr>`).join('') || '<tr><td class="hint">لا مشاركون مسجلون.</td></tr>'}</tbody></table>
        <p class="hint">المشاركات تظهر للطالب في «مشاركاتي» ولولي أمره في البوابة.</p>`;
      const sq = $('#sq', box); let t;
      if (sq) sq.oninput = (e) => { clearTimeout(t); t = setTimeout(async () => { const R = e.target.value.trim().length < 2 ? [] : await call('cs_student_search', { p_q: e.target.value });
        $('#sr', box).innerHTML = R.map((s) => `<div data-add="${s.id}">${esc(s.name)} <span class="hint">${esc(s.class || '')}</span></div>`).join(''); }, 300); };
    }
    box.onclick = async (e) => { const a = e.target.closest('[data-add]'), r = e.target.closest('[data-rm]');
      try { if (a) { await call('ac_student_set', { p_id: id, p: { student_id: a.dataset.add } }); load(); } if (r) { await call('ac_student_set', { p_id: id, p: { student_id: r.dataset.rm, remove: true } }); load(); } } catch (er) { toast(errMsg(er), 'err'); } };
    box.onchange = async (e) => { try {
      if (e.target.id === 'cl' && e.target.value) { const r = await call('ac_student_set', { p_id: id, p: { class_id: e.target.value } }); toast(`أُضيف ${r.added} طالب ✓`); load(); }
      if (e.target.dataset.rl) { await call('ac_student_set', { p_id: id, p: { student_id: e.target.dataset.rl, role: e.target.value } }); toast('تم ✓'); } } catch (er) { toast(errMsg(er), 'err'); } };
    try { await load(); } catch (e) { toast(errMsg(e), 'err'); return; }
    modal({ title: '🎯 ' + A.title, wide: true, body: box, actions: [{ label: 'إغلاق', value: null }] }).then(after);
  }
  async function statsView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center">من <input type="date" id="f" value="${yStart}"> إلى <input type="date" id="t" value="${new Date().toISOString().slice(0, 10)}"><button class="btn sm" id="r">تحديث</button></div><div id="sb"></div>`;
    const load = async () => { let S; try { S = await call('ac_stats', { p_from: $('#f').value, p_to: $('#t').value }); } catch (e) { $('#sb').innerHTML = esc(errMsg(e)); return; }
      const T = (h, rows, cols) => `<div class="glass" style="padding:10px 12px"><h4 style="margin:0 0 6px">${h}</h4><table class="t"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows || `<tr><td class="hint">—</td></tr>`}</tbody></table></div>`;
      $('#sb').innerHTML = `<div class="kpi4"><div class="card-box glass"><b>${S.total}</b>نشاط</div><div class="card-box glass"><b>${S.done}</b>منفّذ</div><div class="card-box glass"><b>${S.students}</b>طالب مشارك</div><div class="card-box glass"><b>${S.participations}</b>مشاركة</div></div>
        <div class="row2">${T('حسب النوع', S.by_kind.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td></tr>`).join(''), ['النوع', 'العدد'])}${T('حسب الشهر', S.by_month.map((x) => `<tr><td>${esc(x.m)}</td><td>${x.n}</td></tr>`).join(''), ['الشهر', 'العدد'])}
          ${T('حسب المنظم', S.by_org.map((x) => `<tr><td>${esc(x.label)}</td><td>${x.n}</td></tr>`).join(''), ['المنظم', 'الأنشطة'])}${T('🌟 الطلاب الأكثر مشاركة', S.top_students.map((x) => `<tr><td>${esc(x.name)}<div class="hint">${esc(x.class || '')}</div></td><td>${x.n}</td></tr>`).join(''), ['الطالب', 'المشاركات'])}</div>
        <p class="hint">الميزانية المصروفة: ${esc(S.budget)} ريال</p>`; };
    $('#r').onclick = load; await load();
  }
  paint();
})();
