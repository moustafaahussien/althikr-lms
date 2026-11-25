/* =====================================================================
   الموهبة والمسابقات (sql/53): المسابقات والترشيح والنتائج، قاعدة الموهوبين، المؤشرات والتقرير
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('talentlms', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const FIELD = { math: 'رياضيات', science: 'علوم', informatics: 'معلوماتية وبرمجة', robotics: 'روبوت', research: 'بحث علمي', innovation: 'ابتكار', language: 'لغات', quran: 'قرآن', arts: 'فنون', sports: 'رياضة', other: 'أخرى' };
  const LEVEL = { school: 'مدرسي', district: 'إدارة تعليم', national: 'وطني', international: 'دولي' };
  const ST = { nominated: 'مرشّح', training: 'في التدريب', registered: 'مسجّل', participated: 'شارك', qualified: 'متأهل', awarded: 'فائز 🏅', withdrawn: 'منسحب' };
  const AW = { gold: '🥇 ذهبية', silver: '🥈 فضية', bronze: '🥉 برونزية', honorable: 'شهادة تقدير', qualified: 'تأهل', other: 'أخرى' };
  const PRI = { 1: 'أولوية عليا', 2: 'متوسطة', 3: 'منخفضة' };
  const TODAY = LMS.ymd(new Date());
  const dl = (d) => d ? new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  let C = { manager: false, items: [] }, TAB = '';

  const tabs = [['comps', '🏆 المسابقات'], ['pool', '🌟 قاعدة الموهوبين'], ['kpi', '📊 المؤشرات والتقرير']];
  TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'comps';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; go(b.dataset.t); };
  function go(t) { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); view.onclick = null;
    ({ comps: paintComps, pool: paintPool, kpi: paintKpi })[t](); }

  // ============================ المسابقات ============================
  let SHOWALL = false, FF = '';
  async function paintComps() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { C = await call('tl_comps', { p_all: SHOWALL }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const L = C.items.filter((c) => !FF || c.field === FF);
    const next = (c) => [['reg_deadline', 'آخر تسجيل'], ['test_date', 'الاختبار'], ['final_date', 'النهائي']].map(([k, l]) => c[k] ? `<span class="${c[k] < TODAY ? 'hint' : c[k] <= LMS.ymd(new Date(Date.now() + 14 * 864e5)) ? 'soon' : ''}">${l}: ${dl(c[k])}</span>` : '').filter(Boolean).join(' · ');
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><select id="ff"><option value="">كل المجالات</option>${Object.entries(FIELD).map(([k, v]) => `<option value="${k}" ${FF === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${C.manager ? `<label class="chk" style="margin:0"><input type="checkbox" id="sa" ${SHOWALL ? 'checked' : ''}> عرض المؤرشفة</label>` : ''}<span class="grow"></span>
        ${C.manager ? '<button class="btn primary sm" id="add">＋ مسابقة / برنامج</button>' : ''}</div>
      <div class="tl-grid">${L.map((c) => `<div class="glass tl-card ${c.active ? '' : 'off'}" data-open="${c.id}">
          <div class="toolbar" style="margin:0"><b class="grow">${esc(c.name)}</b><span class="pri p${c.priority}">${PRI[c.priority]}</span></div>
          <div class="hint">${FIELD[c.field]} · ${LEVEL[c.level]}${c.organizer ? ' · ' + esc(c.organizer) : ''}${c.stages ? ' · ' + esc(c.stages) : ''}${c.year ? ' · ' + esc(c.year) : ''}</div>
          <div class="hint dates">${next(c) || 'لم تُحدَّد المواعيد بعد'}</div>
          <div class="pipe">${['nominated', 'registered', 'participated', 'qualified', 'awarded'].map((s) => `<span title="${ST[s]}">${ST[s].replace(' 🏅', '')}: <b>${(c.counts || {})[s] || 0}</b></span>`).join('')}</div>
          ${c.owner ? `<div class="hint">المسؤول: ${esc(c.owner)}</div>` : ''}</div>`).join('') || '<div class="empty">لا توجد مسابقات.</div>'}</div>`;
    $('#ff').onchange = (e) => { FF = e.target.value; paintComps(); };
    if ($('#sa')) $('#sa').onchange = (e) => { SHOWALL = e.target.checked; paintComps(); };
    if ($('#add')) $('#add').onclick = () => compForm({ field: 'math', level: 'national', priority: 2 });
    view.onclick = (e) => { const c = e.target.closest('[data-open]'); if (c) openComp(+c.dataset.open); };
  }

  let STAFF = null;
  async function staffOpts(sel) {
    if (!STAFF) { const { data } = await sb.from('profiles').select('id,full_name,job_title').not('role', 'in', '(student,parent)').eq('active', true).order('full_name'); STAFF = data || []; }
    return '<option value="">— بدون —</option>' + STAFF.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.full_name)}${p.job_title ? ' — ' + esc(p.job_title) : ''}</option>`).join('');
  }
  async function compForm(c) {
    const own = C.manager ? await staffOpts(c.owner_id) : '';
    modal({ title: c.id ? 'تعديل مسابقة' : 'مسابقة / برنامج جديد', wide: true, body: `
      <label class="f">الاسم *<input id="n" value="${esc(c.name || '')}"></label>
      <div class="form-grid">
        <label class="f">المجال<select id="fd">${Object.entries(FIELD).map(([k, v]) => `<option value="${k}" ${c.field === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">المستوى<select id="lv">${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}" ${c.level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">الأولوية<select id="pr">${[1, 2, 3].map((p) => `<option value="${p}" ${+c.priority === p ? 'selected' : ''}>${PRI[p]}</option>`).join('')}</select></label>
        <label class="f">الجهة المنظمة<input id="og" value="${esc(c.organizer || '')}"></label>
        <label class="f">الفئة المستهدفة<input id="sg" value="${esc(c.stages || '')}" placeholder="مثال: متوسط وثانوي"></label>
        <label class="f">العام الدراسي<input id="yr" value="${esc(c.year || '')}" placeholder="1448هـ"></label>
        <label class="f">آخر موعد للتسجيل<input id="rd" type="date" value="${esc(c.reg_deadline || '')}"></label>
        <label class="f">موعد الاختبار / التصفيات<input id="td" type="date" value="${esc(c.test_date || '')}"></label>
        <label class="f">موعد النهائي / النتائج<input id="fdt" type="date" value="${esc(c.final_date || '')}"></label></div>
      <label class="f">الرابط<input id="lk" dir="ltr" value="${esc(c.link || '')}" placeholder="https://"></label>
      ${C.manager ? `<label class="f">المسؤول (المشرف المختص — يحدّث النتائج ويصله إشعار بالترشيحات)<select id="ow">${own}</select></label>` : ''}
      <label class="f">ملاحظات / معايير الترشيح<textarea id="nt" rows="3">${esc(c.notes || '')}</textarea></label>
      ${c.id && C.manager ? `<label class="chk"><input type="checkbox" id="ac" ${c.active !== false ? 'checked' : ''}> نشطة (تظهر للمنسوبين)</label>` : ''}`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }].concat(c.id && C.manager ? [{ label: 'حذف', cls: 'danger', onClick: async () => {
        if (!await confirmBox('حذف المسابقة؟ (إن كان فيها نتائج تُؤرشف بدل الحذف)', 'حذف')) return false;
        const r = await call('tl_comp_delete', { p_id: c.id }); toast(r.archived ? 'أُرشفت (فيها نتائج)' : 'حُذفت'); paintComps(); return true; } }] : [])
        .concat([{ label: 'حفظ', cls: 'primary', onClick: async (w) => {
          await call('tl_comp_save', { p: { id: c.id || null, name: $('#n', w).value, field: $('#fd', w).value, level: $('#lv', w).value, priority: $('#pr', w).value,
            organizer: $('#og', w).value, stages: $('#sg', w).value, year: $('#yr', w).value, reg_deadline: $('#rd', w).value, test_date: $('#td', w).value,
            final_date: $('#fdt', w).value, link: $('#lk', w).value, owner_id: $('#ow', w) ? $('#ow', w).value : null, notes: $('#nt', w).value,
            active: $('#ac', w) ? $('#ac', w).checked : true } });
          toast('تم الحفظ'); paintComps(); return true; } }]) });
  }

  async function openComp(id) {
    let d; try { d = await call('tl_entries_of', { p_comp: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const c = d.comp, E = d.entries, can = c.can_edit;
    view.innerHTML = `<button class="btn sm" id="back">→ كل المسابقات</button>
      <div class="glass card" style="margin-top:10px"><div class="toolbar" style="margin:0"><h2 class="grow" style="margin:0">🏆 ${esc(c.name)}</h2>
          ${can ? '<button class="btn sm" id="ed">✏️ تعديل</button>' : ''}${c.link ? `<a class="btn sm" href="${esc(c.link)}" target="_blank" rel="noopener">↗ الموقع</a>` : ''}</div>
        <div class="hint">${FIELD[c.field]} · ${LEVEL[c.level]}${c.organizer ? ' · ' + esc(c.organizer) : ''}${c.stages ? ' · ' + esc(c.stages) : ''} · ${PRI[c.priority]}</div>
        <div class="hint">آخر تسجيل: ${dl(c.reg_deadline)} · الاختبار: ${dl(c.test_date)} · النهائي: ${dl(c.final_date)}${c.owner ? ' · المسؤول: ' + esc(c.owner) : ''}</div>
        ${c.notes ? `<div class="pre">${esc(c.notes)}</div>` : ''}</div>
      <div class="toolbar glass" style="padding:10px;margin-top:10px"><b class="grow">المشاركون (${E.length})</b><button class="btn primary sm" id="nom">＋ ترشيح طلاب</button></div>
      ${E.length ? `<div class="table-wrap" data-title="${esc(c.name)}"><table><thead><tr><th>الطالب</th><th>الفصل</th><th>الحالة</th><th>النتيجة</th><th>رشّحه</th><th class="no-export"></th></tr></thead><tbody>
        ${E.map((e) => `<tr><td><a href="#" data-stu="${e.student_id}">${esc(e.name)}</a>${e.in_pool ? ' <span title="في قاعدة الموهوبين">🌟</span>' : ''}</td><td>${esc(e.class || '')}</td>
          <td><span class="st s-${e.status}">${ST[e.status]}</span></td><td>${e.award_level ? AW[e.award_level] + ' ' : ''}${esc(e.result || '')}${e.notes ? `<div class="hint">${esc(e.notes)}</div>` : ''}</td>
          <td class="hint">${esc(e.by || '')}</td><td class="no-export" style="white-space:nowrap">${can ? `<button class="btn sm" data-set="${e.id}">تحديث</button>` : ''}
          ${can || (e.mine && e.status === 'nominated') ? ` <button class="btn sm danger" data-del="${e.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا يوجد مرشحون بعد — رشّح طلابك المتميزين.</div>'}`;
    $('#back').onclick = paintComps;
    if ($('#ed')) $('#ed').onclick = () => compForm(c);
    $('#nom').onclick = () => nominate(c);
    view.onclick = async (e) => {
      const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); return studentCard(s.dataset.stu); }
      const st = e.target.closest('[data-set]'); if (st) return entryForm(E.find((x) => x.id === +st.dataset.set), () => openComp(id));
      const dl2 = e.target.closest('[data-del]'); if (dl2) { if (!await confirmBox('إزالة الطالب من المسابقة؟', 'إزالة')) return;
        try { await call('tl_entry_delete', { p_id: +dl2.dataset.del }); openComp(id); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function entryForm(e, after) {
    modal({ title: `تحديث: ${e.name}`, body: `<label class="f">الحالة<select id="s">${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <div class="form-grid"><label class="f">الجائزة<select id="a"><option value="">—</option>${Object.entries(AW).map(([k, v]) => `<option value="${k}" ${e.award_level === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">النتيجة (نص)<input id="r" value="${esc(e.result || '')}" placeholder="المركز الأول، 87 درجة، تأهل للنهائي…"></label></div>
      <label class="f">ملاحظات<input id="n" value="${esc(e.notes || '')}"></label>
      <p class="hint">عند «متأهل» أو «فائز» تُضاف المسابقة تلقائيًا لملف إنجاز الطالب.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('tl_entry_set', { p_id: e.id, p: { status: $('#s', w).value, award_level: $('#a', w).value, result: $('#r', w).value, notes: $('#n', w).value } });
        toast('تم التحديث'); after(); return true; } }] });
  }
  function nominate(c) {
    const picked = new Map();
    modal({ title: `ترشيح لـ ${c.name}`, wide: true, body: `<input id="q" type="search" placeholder="ابحث باسم الطالب أو رقمه…" style="width:100%"><div id="res" class="tl-res"></div>
      <div id="pk" class="hint" style="margin:8px 0">لم تختر أحدًا بعد.</div><label class="f">سبب الترشيح (اختياري)<input id="nt" placeholder="مثال: متفوق في الرياضيات، حصل على 98…"></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'رشّح', cls: 'primary', onClick: async (w) => {
        if (!picked.size) { toast('اختر طالبًا واحدًا على الأقل', 'err'); return false; }
        const r = await call('tl_nominate', { p_comp: c.id, p_students: [...picked.keys()], p_notes: $('#nt', w).value });
        toast(`رُشّح ${r.added} طالب ✓`); openComp(c.id); return true; } }] });
    setTimeout(() => { const w = document.querySelector('.modal-wrap:last-child'); let tm;
      const paintPk = () => { $('#pk', w).innerHTML = picked.size ? [...picked].map(([id, n]) => `<span class="chip">${esc(n)} <a href="#" data-x="${id}">✕</a></span>`).join(' ') : 'لم تختر أحدًا بعد.'; };
      $('#q', w).oninput = (e) => { clearTimeout(tm); const q = e.target.value.trim(); if (q.length < 2) { $('#res', w).innerHTML = ''; return; }
        tm = setTimeout(async () => { try { const L = await call('pf_find', { p_q: q });
          $('#res', w).innerHTML = L.map((s) => `<a href="#" data-p="${s.id}" data-n="${esc(s.name)}">${esc(s.name)} <span class="hint">${esc(s.class || '')}</span></a>`).join('') || '<div class="hint">لا نتائج.</div>'; } catch (er) { toast(errMsg(er), 'err'); } }, 300); };
      w.addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (p) { e.preventDefault(); picked.set(p.dataset.p, p.dataset.n); paintPk(); }
        const x = e.target.closest('[data-x]'); if (x) { e.preventDefault(); picked.delete(x.dataset.x); paintPk(); } }); }, 50);
  }
  async function studentCard(sid) {
    let d; try { d = await call('tl_student', { p_student: sid }); } catch (e) { return toast(errMsg(e), 'err'); }
    const p = d.pool;
    modal({ title: `🌟 ${d.name}`, wide: true, body: `${p ? `<p>${(p.fields || []).map((f) => `<span class="chip">${FIELD[f] || esc(f)}</span>`).join(' ')}
        ${p.mawhiba_score ? ` · مقياس موهبة: <b>${p.mawhiba_score}</b>${p.mawhiba_year ? ' (' + esc(p.mawhiba_year) + ')' : ''}` : ''}${p.mawhiba_class ? ' · فصول موهبة ✓' : ''}${p.duroob ? ' · منحة دروب ✓' : ''}</p>` : '<p class="hint">ليس في قاعدة الموهوبين.</p>'}
      ${d.entries.length ? `<div class="table-wrap no-tools"><table><thead><tr><th>المسابقة</th><th>المجال</th><th>العام</th><th>الحالة</th><th>النتيجة</th></tr></thead><tbody>
        ${d.entries.map((e) => `<tr><td>${esc(e.comp)}</td><td>${FIELD[e.field]}</td><td>${esc(e.year || '')}</td><td>${ST[e.status]}</td><td>${esc(e.result || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="hint">لا مشاركات بعد.</div>'}`,
      actions: [{ label: 'إغلاق', value: null }] });
  }

  // ============================ قاعدة الموهوبين ============================
  async function paintPool() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let d; try { d = await call('tl_pool_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const L = d.items;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="pq" type="search" class="grow" placeholder="ابحث…"><select id="pf"><option value="">كل المجالات</option>${Object.entries(FIELD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        ${d.manager ? '<button class="btn primary sm" id="padd">＋ إضافة طالب</button>' : ''}</div>
      <p class="hint">${L.length} طالب — فصول موهبة: ${L.filter((x) => x.mawhiba_class).length} · منحة دروب: ${L.filter((x) => x.duroob).length}</p>
      <div class="table-wrap" data-title="قاعدة الموهوبين"><table id="pt"><thead><tr><th>الطالب</th><th>الفصل</th><th>مجالات التميز</th><th>مقياس موهبة</th><th>فصول موهبة</th><th>دروب</th><th>مشاركات</th><th>فوز</th>${d.manager ? '<th class="no-export"></th>' : ''}</tr></thead><tbody>
      ${L.map((x) => `<tr data-q="${esc(LMS.norm(x.name))}" data-f="${(x.fields || []).join(' ')}"><td><a href="#" data-stu="${x.student_id}">${esc(x.name)}</a>${x.notes ? `<div class="hint">${esc(x.notes)}</div>` : ''}</td><td>${esc(x.class || '')}</td>
        <td>${(x.fields || []).map((f) => FIELD[f] || f).join('، ')}</td><td>${x.mawhiba_score ?? '—'}${x.mawhiba_year ? ` <span class="hint">${esc(x.mawhiba_year)}</span>` : ''}</td>
        <td>${x.mawhiba_class ? '✓' : ''}</td><td>${x.duroob ? '✓' : ''}</td><td>${x.entries}</td><td>${x.awards || ''}</td>
        ${d.manager ? `<td class="no-export"><button class="btn sm" data-pe="${x.student_id}">✏️</button> <button class="btn sm danger" data-pr="${x.student_id}">✕</button></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    const flt = () => { const v = LMS.norm($('#pq').value), f = $('#pf').value; $$('#pt tbody tr').forEach((r) => { r.style.display = (!v || r.dataset.q.includes(v)) && (!f || r.dataset.f.split(' ').includes(f)) ? '' : 'none'; }); };
    $('#pq').oninput = flt; $('#pf').onchange = flt;
    if ($('#padd')) $('#padd').onclick = () => poolForm(null);
    view.onclick = async (e) => {
      const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); return studentCard(s.dataset.stu); }
      const pe = e.target.closest('[data-pe]'); if (pe) return poolForm(L.find((x) => x.student_id === pe.dataset.pe));
      const pr = e.target.closest('[data-pr]'); if (pr) { if (!await confirmBox('إزالة الطالب من قاعدة الموهوبين؟ (تبقى مشاركاته)', 'إزالة')) return; await call('tl_pool_remove', { p_student: pr.dataset.pr }); paintPool(); }
    };
  }
  function poolForm(x) {
    const sel = new Set((x && x.fields) || []);
    modal({ title: x ? `تعديل: ${x.name}` : 'إضافة طالب لقاعدة الموهوبين', wide: true, body: `
      ${x ? '' : '<input id="q" type="search" placeholder="ابحث باسم الطالب…" style="width:100%"><div id="res" class="tl-res"></div><div id="who" class="hint" style="margin:6px 0">لم تختر طالبًا.</div>'}
      <div class="f"><span>مجالات التميز</span><div>${Object.entries(FIELD).map(([k, v]) => `<label class="chk" style="display:inline-flex;margin-inline-end:12px"><input type="checkbox" data-f="${k}" ${sel.has(k) ? 'checked' : ''}> ${v}</label>`).join('')}</div></div>
      <div class="form-grid"><label class="f">درجة مقياس موهبة<input id="ms" type="number" value="${x && x.mawhiba_score != null ? x.mawhiba_score : ''}"></label>
        <label class="f">عام المقياس<input id="my" value="${esc((x && x.mawhiba_year) || '')}"></label></div>
      <label class="chk"><input type="checkbox" id="mc" ${x && x.mawhiba_class ? 'checked' : ''}> ملتحق بفصول موهبة</label>
      <label class="chk"><input type="checkbox" id="du" ${x && x.duroob ? 'checked' : ''}> مستفيد من منحة دروب</label>
      <label class="f">ملاحظات<input id="nt" value="${esc((x && x.notes) || '')}"></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const sid = x ? x.student_id : w.dataset.sid; if (!sid) { toast('اختر الطالب', 'err'); return false; }
        await call('tl_pool_save', { p: { student_id: sid, fields: $$('[data-f]', w).filter((c) => c.checked).map((c) => c.dataset.f), mawhiba_score: $('#ms', w).value,
          mawhiba_year: $('#my', w).value, mawhiba_class: $('#mc', w).checked, duroob: $('#du', w).checked, notes: $('#nt', w).value } });
        toast('تم الحفظ'); paintPool(); return true; } }] });
    if (x) return;
    setTimeout(() => { const w = document.querySelector('.modal-wrap:last-child'); let tm;
      $('#q', w).oninput = (e) => { clearTimeout(tm); const q = e.target.value.trim(); if (q.length < 2) return;
        tm = setTimeout(async () => { const L = await call('pf_find', { p_q: q }).catch(() => []);
          $('#res', w).innerHTML = L.map((s) => `<a href="#" data-p="${s.id}" data-n="${esc(s.name)}">${esc(s.name)} <span class="hint">${esc(s.class || '')}</span></a>`).join(''); }, 300); };
      w.addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (!p) return; e.preventDefault(); w.dataset.sid = p.dataset.p; $('#who', w).innerHTML = `الطالب: <b>${esc(p.dataset.n)}</b>`; $('#res', w).innerHTML = ''; }); }, 50);
  }

  // ============================ المؤشرات ============================
  let YR = '';
  async function paintKpi() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let k; try { k = await call('tl_kpis', { p_year: YR || null }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const f = k.funnel, pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><select id="yr"><option value="">كل الأعوام</option>${(k.years || []).map((y) => `<option ${YR === y ? 'selected' : ''}>${esc(y)}</option>`).join('')}</select>
        <span class="grow"></span><button class="btn sm" id="pr">🖨️ طباعة التقرير</button></div>
      <div id="rep">
      <div class="kpi4"><div class="card-box glass"><b>${k.competitions}</b><div class="hint">مسابقة وبرنامج (${k.priority1} أولوية عليا)</div></div>
        <div class="card-box glass"><b>${k.participants}</b><div class="hint">طالب مشارك (من ${k.nominated} مرشح)</div></div>
        <div class="card-box glass"><b style="color:#b8860b">${k.awards}</b><div class="hint">جائزة — ${Object.entries(k.medals || {}).map(([a, n]) => `${AW[a]}: ${n}`).join('، ') || '—'}</div></div>
        <div class="card-box glass"><b style="color:var(--brand)">${k.pool}</b><div class="hint">في قاعدة الموهوبين (فصول موهبة ${k.mawhiba_class} · دروب ${k.duroob})</div></div></div>
      <div class="glass card" style="margin-top:14px"><h3 style="margin-top:0">مسار الانتقال بين المراحل</h3><div class="funnel">
        ${[['nominated', 'مرشح'], ['registered', 'مسجّل'], ['participated', 'شارك'], ['qualified', 'تأهل'], ['awarded', 'فاز']].map(([s, l], i, a) => `<div><b>${f[s]}</b><span>${l}</span>${i ? `<small>${pct(f[s], f[a[i - 1][0]])} من السابق</small>` : ''}</div>`).join('<i>←</i>')}</div></div>
      <div class="glass card" style="margin-top:14px"><h3 style="margin-top:0">حسب المجال</h3><div class="table-wrap no-tools"><table><thead><tr><th>المجال</th><th>مسابقات</th><th>مشاركات</th><th>جوائز</th></tr></thead><tbody>
        ${k.by_field.map((x) => `<tr><td>${FIELD[x.field]}</td><td>${x.comps}</td><td>${x.participants}</td><td>${x.awards}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="glass card" style="margin-top:14px"><h3 style="margin-top:0">حسب المسابقة</h3><div class="table-wrap" data-title="نتائج المسابقات"><table><thead><tr><th>المسابقة</th><th>المستوى</th><th>الأولوية</th><th>مرشح</th><th>شارك</th><th>تأهل</th><th>فاز</th></tr></thead><tbody>
        ${k.by_comp.map((x) => `<tr><td>${esc(x.name)}</td><td>${LEVEL[x.level]}</td><td>${PRI[x.priority]}</td><td>${x.nominated}</td><td>${x.participated}</td><td>${x.qualified}</td><td>${x.awarded}</td></tr>`).join('')}</tbody></table></div></div></div>`;
    $('#yr').onchange = (e) => { YR = e.target.value; paintKpi(); };
    $('#pr').onclick = () => LMS.printHTML ? LMS.printHTML(`تقرير الموهبة والمسابقات${YR ? ' — ' + YR : ''}`, $('#rep').innerHTML) : window.print();
  }

  go(TAB);
})();
