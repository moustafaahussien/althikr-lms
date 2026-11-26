/* =====================================================================
   التسجيل والقبول — رحلة تسجيل الطالب (sql/79)
   عميل محتمل ← استفسار ← اختبار القبول ← اجتاز ← فتح الملف ← توقيع العقد ← تسجيل رسمي
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('admissions', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let ME;
  try { ME = await call('adm_me'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const R = ME.role;
  if (!R) { $('#tabs').remove(); view.innerHTML = `<div class="notice">🔒 هذه الوحدة لقسم التسجيل والقبول والتسويق، ولمديري المراحل ومن يُكلَّف باختبارات القبول.<br><span class="hint">يُحدَّد قسم الموظف من «المسمى الوظيفي» في لوحة الإدارة (يحتوي: تسجيل / قبول / تسويق).</span></div>`; return; }
  const MANAGE = R === 'manage', CONTACT = R === 'manage' || R === 'marketing';

  const STAGES = [['lead', 'عميل محتمل', '📣'], ['inquiry', 'استفسار وبيانات ولي الأمر', '☎️'], ['test', 'اختبار القبول', '📝'], ['passed', 'اجتاز الاختبار', '✅'],
    ['file', 'فتح الملف', '📁'], ['contract', 'توقيع العقد', '✍️'], ['enrolled', 'مسجّل رسميًا', '🎓']];
  const CLOSED = { failed: ['لم يجتز الاختبار', '❌'], lost: ['لم يكمل', '🚫'] };
  const SL = (s) => (STAGES.find((x) => x[0] === s) || [s, (CLOSED[s] || [s])[0]])[1];
  const SI = (s) => (STAGES.find((x) => x[0] === s) || [0, 0, (CLOSED[s] || [0, '•'])[1]])[2];
  const SRC = { social: '📱 وسائل التواصل الاجتماعي', mall: '🛍️ دعاية في المولات', call: '📞 اتصال هاتفي', walkin: '🏫 زيارة المدرسة', referral: '🤝 ترشيح ولي أمر', website: '🌐 الموقع / النموذج الإلكتروني', event: '🎪 فعالية / معرض', other: '• أخرى' };
  const KIND = { call: '📞 اتصال', whatsapp: '💬 واتساب', visit: '🏫 زيارة', email: '✉️ بريد', note: '📝 ملاحظة', stage: '➡️ مرحلة', test: '📝 اختبار', system: '⚙️ النظام' };
  const LOST = ['السعر / الرسوم', 'اختار مدرسة أخرى', 'بُعد المسافة / النقل', 'لا يوجد مقعد في الصف', 'لم يرد على التواصل', 'تأجيل للعام القادم', 'أخرى'];
  const GR = ME.grades || [], STAFF = ME.staff || [], CFG = ME.cfg || {};
  const d10 = (t) => (t ? String(t).slice(0, 10) : '');
  const fmt = (t) => (t ? new Date(t).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
  const fmtD = (t) => (t ? new Date(String(t).length <= 10 ? t + 'T12:00:00' : t).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const ago = (t) => { const d = Math.floor((Date.now() - new Date(t)) / 864e5); return d <= 0 ? 'اليوم' : d === 1 ? 'أمس' : `منذ ${d} يوم`; };
  const wa = (ph) => { let d = String(ph || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('05')) d = '966' + d.slice(1); else if (d.startsWith('5') && d.length === 9) d = '966' + d; return 'https://wa.me/' + d; };
  const opts = (arr, sel, empty) => (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') + arr.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('');
  const grOpts = (sel, empty = '— الصف المطلوب —') => opts(GR.map((g) => [g.id, g.name]), sel, empty);
  const stOpts = (sel, empty) => opts(STAFF.map((s) => [s.id, s.name + (s.job ? ' — ' + s.job : '')]), sel, empty);
  const years = () => (CFG.years && CFG.years.length ? CFG.years : (() => { const y = new Date().getFullYear(); return [`${y}-${y + 1}`, `${y + 1}-${y + 2}`]; })());
  const val = (root, s) => { const el = $(s, root); return el ? el.value.trim() : ''; };

  // ---------- التبويبات ----------
  const tabs = CONTACT ? [['board', '🧭 رحلة التسجيل'], ['new', '➕ عميل جديد'], ['follow', '📞 المتابعات'], ['tests', '📝 اختبارات القبول'], ['stats', '📊 التقارير'], ['link', '🔗 النموذج الإلكتروني']]
    : R === 'principal' ? [['tests', '📝 اختبارات القبول'], ['board', '🧭 متقدّمو مرحلتي']] : [['tests', '📝 اختبارات القبول']];
  if (MANAGE) tabs.push(['settings', '⚙️ الإعدادات']);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return ({ board: boardView, new: () => newView(), follow: followView, tests: testsView, stats: statsView, link: linkView, settings: settingsView })[TAB](); };

  /* =================== لوحة الرحلة =================== */
  const F = { q: '', source: '', grade: '', owner: '', year: '', closed: false, mode: 'kanban' };
  try { Object.assign(F, JSON.parse(sessionStorage.getItem('adm_f') || '{}')); } catch (_) {}
  async function boardView() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="fq" placeholder="🔎 اسم الطالب أو ولي الأمر${CONTACT ? ' أو الجوال أو رقم الملف' : ''}" value="${esc(F.q)}" style="flex:1;min-width:200px">
        ${CONTACT ? `<select id="fs">${opts(Object.entries(SRC), F.source, 'كل المصادر')}</select>` : ''}
        <select id="fg">${grOpts(F.grade, 'كل الصفوف')}</select>
        ${CONTACT ? `<select id="fo">${stOpts(F.owner, 'كل المسؤولين')}</select>` : ''}
        <select id="fy">${opts(years().map((y) => [y, y]), F.year, 'كل الأعوام')}</select>
        <label class="chk" style="margin:0"><input type="checkbox" id="fc" ${F.closed ? 'checked' : ''}> إظهار المكتملة والمغلقة</label>
        <div class="seg"><button data-m="kanban" class="${F.mode === 'kanban' ? 'on' : ''}">▥ مراحل</button><button data-m="list" class="${F.mode === 'list' ? 'on' : ''}">☰ قائمة</button></div>
      </div><div id="bd"><div class="empty">جارٍ التحميل…</div></div>`;
    let t;
    const reload = async () => {
      sessionStorage.setItem('adm_f', JSON.stringify(F));
      let L = [];
      try { L = await call('adm_board', { p: { q: F.q, source: F.source, grade: F.grade, owner: F.owner, year: F.year, closed: F.closed } }); }
      catch (e) { $('#bd').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      paintBoard(L);
    };
    $('#fq').oninput = (e) => { F.q = e.target.value; clearTimeout(t); t = setTimeout(reload, 350); };
    [['#fs', 'source'], ['#fg', 'grade'], ['#fo', 'owner'], ['#fy', 'year']].forEach(([s, k]) => { if ($(s)) $(s).onchange = (e) => { F[k] = e.target.value; reload(); }; });
    $('#fc').onchange = (e) => { F.closed = e.target.checked; reload(); };
    $$('.seg [data-m]').forEach((b) => { b.onclick = () => { F.mode = b.dataset.m; $$('.seg [data-m]').forEach((x) => x.classList.toggle('on', x === b)); reload(); }; });
    view.onclick = (e) => { const c = e.target.closest('[data-fam]'); if (c && !e.target.closest('a')) openFamily(+c.dataset.fam, reload); };
    await reload();
  }
  const card = (a) => `<div class="ac glass" data-fam="${a.family_id}" title="فتح ملف الأسرة">
      <b>${esc(a.name)}</b> ${a.gender === 'f' ? '<span class="pill">طالبة</span>' : ''}
      <div class="hint">${esc(a.grade || 'لم يُحدَّد الصف')}${a.year_name ? ' · ' + esc(a.year_name) : ''}</div>
      <div class="hint">👤 ${esc(a.guardian)}${a.phone ? ` · <a href="tel:${esc(a.phone)}" dir="ltr">${esc(a.phone)}</a>` : ''}</div>
      <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${a.source ? `<span class="pill">${esc((SRC[a.source] || '').split(' ')[0])} ${esc(a.source_label)}</span>` : ''}
        ${a.stage === 'test' && a.test_at ? `<span class="pill gold">📅 ${esc(fmt(a.test_at))}</span>` : ''}
        ${a.next_at ? `<span class="pill ${a.next_at <= d10(new Date().toISOString()) ? 'bad' : 'gold'}">📞 متابعة ${esc(fmtD(a.next_at))}</span>` : ''}
        ${a.file_no ? `<span class="pill">📁 ${esc(a.file_no)}</span>` : ''}</div>
      <div class="hint" style="margin-top:3px;font-size:.75rem">في هذه المرحلة ${esc(ago(a.stage_at))}${a.owner ? ' · ' + esc(a.owner) : ''}</div></div>`;
  function paintBoard(L) {
    const bd = $('#bd');
    if (!L.length) { bd.innerHTML = `<div class="empty">لا يوجد متقدّمون${F.q || F.source || F.grade ? ' مطابقون للتصفية' : ''}.${CONTACT ? ' ابدأ من «➕ عميل جديد».' : ''}</div>`; return; }
    if (F.mode === 'list') {
      bd.innerHTML = `<div class="glass" style="padding:6px;overflow:auto"><table class="t"><thead><tr><th>الطالب</th><th>الصف</th><th>ولي الأمر</th>${CONTACT ? '<th>المصدر</th>' : ''}<th>المرحلة</th><th>منذ</th><th>المتابعة</th></tr></thead><tbody>
        ${L.map((a) => `<tr data-fam="${a.family_id}" style="cursor:pointer"><td><b>${esc(a.name)}</b>${a.file_no ? `<div class="hint">📁 ${esc(a.file_no)}</div>` : ''}</td><td>${esc(a.grade || '—')}</td>
          <td>${esc(a.guardian)}${a.phone ? `<div class="hint" dir="ltr" style="text-align:end">${esc(a.phone)}</div>` : ''}</td>${CONTACT ? `<td>${esc(a.source_label || '')}</td>` : ''}
          <td><span class="pill ${a.stage === 'enrolled' ? 'ok' : ['failed', 'lost'].includes(a.stage) ? 'bad' : ''}">${SI(a.stage)} ${esc(SL(a.stage))}</span></td><td class="hint">${esc(ago(a.stage_at))}</td>
          <td>${a.next_at ? esc(fmtD(a.next_at)) : '—'}</td></tr>`).join('')}</tbody></table></div><p class="hint">${L.length} متقدّم</p>`;
      return;
    }
    const cols = STAGES.filter((s) => F.closed || s[0] !== 'enrolled').concat(F.closed ? [['failed', ...CLOSED.failed.slice(0, 1), '❌'], ['lost', CLOSED.lost[0], '🚫']] : []);
    bd.innerHTML = `<div class="kb">${cols.map(([k, l, i]) => { const C = L.filter((a) => a.stage === k);
      return `<div class="kcol"><div class="kh">${i} ${esc(l)} <span class="pill">${C.length}</span></div>${C.map(card).join('') || '<div class="hint" style="padding:8px">—</div>'}</div>`; }).join('')}</div>
      <p class="hint">${L.length} متقدّم — اضغط على أي بطاقة لفتح ملف الأسرة والانتقال للمرحلة التالية.</p>`;
  }

  /* =================== ملف الأسرة =================== */
  async function openFamily(id, after) {
    let D;
    try { D = await call('adm_family_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const box = document.createElement('div');
    const refresh = async () => { try { D = await call('adm_family_get', { p_id: id }); render(); if (after) after(); } catch (e) { toast(errMsg(e), 'err'); } };
    const stepper = (a) => { const idx = STAGES.findIndex((s) => s[0] === a.stage);
      return `<div class="stp">${STAGES.map(([k, l, i], n) => `<div class="st ${a.stage === k ? 'cur' : (idx > n || (a.stage === 'failed' && n < 3) || (a.stage === 'lost' && n === 0)) ? 'done' : ''}" title="${esc(l)}"><span>${i}</span><small>${esc(l)}</small></div>`).join('')}</div>
        ${CLOSED[a.stage] ? `<div class="notice ${a.stage === 'lost' ? 'warn' : 'err'}" style="margin:6px 0">${CLOSED[a.stage][1]} ${esc(CLOSED[a.stage][0])}${a.lost_reason ? ' — ' + esc(a.lost_reason) : ''}</div>` : ''}`; };
    const actions = (a) => {
      if (!D.can_stage) return a.stage === 'lead' && D.can_edit ? '<span class="hint">ينقله قسم التسجيل والقبول للمراحل التالية.</span>' : '';
      const B = (s, l, c = '') => `<button class="btn sm ${c}" data-act="${s}" data-a="${a.id}">${l}</button>`;
      const m = { lead: B('inquiry', '☎️ تسجيل الاستفسار وبيانات ولي الأمر', 'primary'), inquiry: B('test', '📅 تحديد موعد اختبار القبول', 'primary') + B('file_direct', '📁 فتح الملف بدون اختبار'),
        test: B('result', '📝 رصد نتيجة الاختبار', 'primary') + B('test', '🔁 تغيير الموعد'), passed: B('file', '📁 فتح ملف الطالب', 'primary'),
        failed: B('test', '🔁 إعادة الاختبار'), file: B('contract', '✍️ توقيع العقد', 'primary'), contract: B('enrolled', '🎓 التسجيل الرسمي', 'primary'), lost: B('inquiry', '↩️ إعادة فتح'), enrolled: '' }[a.stage] || '';
      return m + (['enrolled', 'lost'].includes(a.stage) ? '' : B('lost', '🚫 لم يكمل', 'danger'));
    };
    const docsBox = (a) => { if (!['file', 'contract', 'enrolled'].includes(a.stage)) return ''; const docs = CFG.docs || []; const got = docs.filter((d) => a.docs && a.docs[d]).length;
      return `<details class="docs" ${got < docs.length ? 'open' : ''}><summary><b>📎 مستندات الملف</b> <span class="pill ${got === docs.length ? 'ok' : 'gold'}">${got}/${docs.length}</span></summary>
        ${docs.map((d) => `<label class="chk"><input type="checkbox" data-doc="${esc(d)}" data-a="${a.id}" ${a.docs && a.docs[d] ? 'checked' : ''} ${MANAGE ? '' : 'disabled'}> ${esc(d)}${a.docs && a.docs[d] ? ` <span class="hint">(${esc(fmtD(a.docs[d]))})</span>` : ''}</label>`).join('')}</details>`; };
    const facts = (a) => [a.grade && `🎯 ${esc(a.grade)}`, a.year_name && `📆 ${esc(a.year_name)}`, a.birth_date && `🎂 ${esc(fmtD(a.birth_date))}`, a.current_school && `🏫 من: ${esc(a.current_school)}`,
      a.national_id && `🪪 ${esc(a.national_id)}`, a.test_at && `📅 الاختبار: ${esc(fmt(a.test_at))}${a.tester ? ' — ' + esc(a.tester) : ''}`,
      a.test_score != null && `📝 الدرجة: <b>${esc(a.test_score)}</b>${a.test_notes ? ' — ' + esc(a.test_notes) : ''}`, a.file_no && `📁 الملف: <b>${esc(a.file_no)}</b>`,
      a.contract_at && `✍️ العقد${a.contract_no ? ' ' + esc(a.contract_no) : ''}: ${esc(fmtD(a.contract_at))}${a.fees ? ` — ${Number(a.fees).toLocaleString('ar-SA')} ريال` : ''}`,
      a.enrolled_at && `🎓 سُجّل: ${esc(fmtD(a.enrolled_at))} ${a.student_id ? '<span class="pill ok">✓ مرتبط بحسابه في المنصة</span>' : '<span class="pill gold">سيرتبط تلقائيًا عند إضافته للمنصة برقم الهوية</span>'}`]
      .filter(Boolean).map((x) => `<span class="fct">${x}</span>`).join('');
    function render() {
      box.innerHTML = `<div class="fam">
        <div class="glass" style="padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:1.05rem">👤 ${esc(D.guardian_name)}</b>${D.relation ? `<span class="hint">(${esc(D.relation)})</span>` : ''}
            <span class="grow" style="flex:1"></span>${D.can_edit ? '<button class="btn sm" id="fEdit">✏️ تعديل البيانات</button>' : ''}${MANAGE ? '<button class="btn sm danger" id="fDel">🗑️</button>' : ''}</div>
          ${D.phone ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap"><a class="btn sm" href="tel:${esc(D.phone)}" dir="ltr">📞 ${esc(D.phone)}</a><a class="btn sm" href="${esc(wa(D.phone))}" target="_blank" rel="noopener">💬 واتساب</a>
            ${D.phone2 ? `<a class="btn sm" href="tel:${esc(D.phone2)}" dir="ltr">📞 ${esc(D.phone2)}</a>` : ''}${D.email ? `<a class="btn sm" href="mailto:${esc(D.email)}">✉️ ${esc(D.email)}</a>` : ''}</div>` : ''}
          <div class="hint" style="margin-top:6px">${SRC[D.source] ? esc(SRC[D.source]) : ''}${D.source_detail ? ' — ' + esc(D.source_detail) : ''}${D.district ? ' · 📍 ' + esc(D.district) : ''} · أُضيف ${esc(fmtD(D.created_at))}${D.created_by ? ' بواسطة ' + esc(D.created_by) : D.public_form ? ' من النموذج الإلكتروني' : ''}${D.owner ? ` · المسؤول: <b>${esc(D.owner)}</b>` : ''}</div>
          ${D.notes ? `<div style="margin-top:4px">📝 ${esc(D.notes)}</div>` : ''}</div>
        ${D.applicants.map((a) => `<div class="glass app" style="padding:10px 12px;margin-bottom:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:1.05rem">${a.gender === 'f' ? '👧' : '👦'} ${esc(a.name)}</b><span class="pill ${a.stage === 'enrolled' ? 'ok' : CLOSED[a.stage] ? 'bad' : ''}">${SI(a.stage)} ${esc(SL(a.stage))}</span>
            <span style="flex:1"></span>${D.can_edit ? `<button class="btn sm" data-edit="${a.id}">✏️</button>` : ''}</div>
          ${stepper(a)}<div class="fcts">${facts(a)}</div>${docsBox(a)}<div class="acts" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${actions(a)}</div></div>`).join('')}
        ${D.can_edit ? '<button class="btn sm" id="addKid">➕ إضافة ابن آخر لنفس الأسرة</button>' : ''}
        ${D.can_edit ? `<div class="glass" style="padding:10px 12px;margin-top:12px"><b>🗒️ تسجيل تواصل / متابعة</b>
          <div style="display:grid;grid-template-columns:140px 1fr;gap:6px;margin-top:6px"><select id="lk">${opts(['call', 'whatsapp', 'visit', 'email', 'note'].map((k) => [k, KIND[k]]), 'call')}</select>
            <input id="lb" placeholder="ماذا تم؟ (مثال: اتصلت وطلب موعد زيارة)"></div>
          <div style="display:flex;gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap"><label class="hint">📅 موعد المتابعة القادمة <input type="date" id="ln"></label>
            <button class="btn sm" data-nx="1">غدًا</button><button class="btn sm" data-nx="3">بعد 3 أيام</button><button class="btn sm" data-nx="7">بعد أسبوع</button><span style="flex:1"></span><button class="btn primary sm" id="lsv">حفظ</button></div></div>` : ''}
        ${D.log.length ? `<div style="margin-top:12px"><b>🕘 سجل الرحلة</b>${D.log.map((l) => `<div class="lg ${l.next_at && !l.done ? 'nx' : ''}"><span class="hint">${esc(fmt(l.at))}${l.by ? ' · ' + esc(l.by) : ''}</span>
          <div>${KIND[l.kind] || ''} ${l.applicant ? `<b>${esc(l.applicant)}</b>: ` : ''}${esc(l.body || '')}${l.next_at ? ` <span class="pill ${l.done ? '' : 'gold'}">📞 متابعة ${esc(fmtD(l.next_at))}${l.done ? ' ✓' : ''}</span>` : ''}</div></div>`).join('')}</div>` : ''}</div>`;
    }
    render();
    box.addEventListener('click', async (e) => {
      const t = e.target.closest('button,[data-doc]'); if (!t) return;
      if (t.dataset.nx) { const d = new Date(); d.setDate(d.getDate() + +t.dataset.nx); $('#ln', box).value = d10(d.toISOString()); return; }
      if (t.id === 'lsv') {
        try { await call('adm_log_add', { p: { family_id: id, kind: $('#lk', box).value, body: val(box, '#lb'), next_at: $('#ln', box).value } }); toast('تم الحفظ ✓'); refresh(); }
        catch (er) { toast(errMsg(er), 'err'); } return;
      }
      if (t.id === 'fEdit') { if (await familyForm(D)) refresh(); return; }
      if (t.id === 'fDel') { if (!await confirmBox(`حذف ملف «${D.guardian_name}» وكل أبنائه وسجلهم نهائيًا؟`, 'نعم، احذف')) return;
        try { await call('adm_family_delete', { p_id: id }); toast('تم الحذف'); $('[data-x]', box.closest('.modal-wrap')).click(); if (after) after(); } catch (er) { toast(errMsg(er), 'err'); } return; }
      if (t.id === 'addKid') { if (await childForm({ family_id: id })) refresh(); return; }
      if (t.dataset.edit) { if (await childForm(D.applicants.find((a) => a.id === +t.dataset.edit))) refresh(); return; }
      if (t.dataset.act) { const a = D.applicants.find((x) => x.id === +t.dataset.a); if (await stageAction(a, t.dataset.act)) refresh(); }
    });
    box.addEventListener('change', async (e) => {
      const c = e.target.closest('[data-doc]'); if (!c) return;
      const a = D.applicants.find((x) => x.id === +c.dataset.a); const docs = Object.assign({}, a.docs || {});
      if (c.checked) docs[c.dataset.doc] = d10(new Date().toISOString()); else delete docs[c.dataset.doc];
      try { await call('adm_docs_set', { p_id: a.id, p_docs: docs }); a.docs = docs; render(); } catch (er) { toast(errMsg(er), 'err'); c.checked = !c.checked; }
    });
    modal({ title: '📂 ملف الأسرة', body: box, wide: true, actions: [{ label: 'إغلاق', value: null }] });
  }

  // نوافذ الانتقال بين المراحل
  async function stageAction(a, act) {
    const run = async (stage, p) => { await call('adm_stage', { p_id: a.id, p_stage: stage, p: p || {} }); toast('تم ✓ — ' + SL(stage)); return true; };
    try {
      if (act === 'inquiry') return await run('inquiry');
      if (act === 'result') return await resultForm(a);
      if (act === 'test') {
        const b = `<div class="form-grid"><label class="f">موعد الاختبار<input type="datetime-local" id="ta" value="${a.test_at ? new Date(new Date(a.test_at) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : ''}"></label>
          <label class="f">الصف المطلوب<select id="tg">${grOpts(a.grade_id)}</select></label>
          <label class="f">المختبِر (يصله إشعار)<select id="tt">${stOpts(a.tester_id, '— قسم التسجيل يرصد النتيجة —')}</select></label></div>`;
        return await modal({ title: '📅 موعد اختبار القبول — ' + a.name, body: b, actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ الموعد', cls: 'primary', onClick: async (w) => {
          if (!$('#ta', w).value) { toast('حدّد الموعد', 'err'); return false; }
          return run('test', { test_at: new Date($('#ta', w).value).toISOString(), grade_id: $('#tg', w).value, tester_id: $('#tt', w).value }); } }] });
      }
      if (act === 'file' || act === 'file_direct') {
        return await modal({ title: '📁 فتح ملف الطالب — ' + a.name, body: `<p class="hint">يُولَّد رقم الملف تلقائيًا (مثل ADM26-0001) إن تركته فارغًا. بعد الفتح تظهر قائمة المستندات المطلوبة.</p>
          ${act === 'file_direct' ? '<div class="notice warn">سيُفتح الملف بدون اختبار قبول (مثل الصفوف الأولية أو الإخوة).</div>' : ''}
          <div class="form-grid"><label class="f">رقم الملف (اختياري)<input id="fn" dir="ltr"></label><label class="f">رقم هوية/إقامة الطالب<input id="ni" dir="ltr" value="${esc(a.national_id || '')}"></label></div>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'فتح الملف', cls: 'primary', onClick: (w) => run('file', { file_no: val(w, '#fn'), national_id: val(w, '#ni'), skip_test: act === 'file_direct' }) }] });
      }
      if (act === 'contract') {
        const docs = CFG.docs || [], miss = docs.filter((d) => !(a.docs && a.docs[d]));
        return await modal({ title: '✍️ توقيع العقد — ' + a.name, body: `${miss.length ? `<div class="notice warn">مستندات ناقصة (${miss.length}): ${esc(miss.join('، '))}</div>` : '<div class="notice ok">✓ كل المستندات مكتملة</div>'}
          <div class="form-grid"><label class="f">تاريخ التوقيع<input type="date" id="cd" value="${d10(new Date().toISOString())}"></label><label class="f">رقم العقد<input id="cn" dir="ltr"></label>
          <label class="f">الرسوم السنوية (ريال)<input type="number" id="cf" min="0" step="0.01"></label></div>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'تأكيد توقيع العقد', cls: 'primary', onClick: (w) => run('contract', { contract_at: $('#cd', w).value, contract_no: val(w, '#cn'), fees: $('#cf', w).value }) }] });
      }
      if (act === 'enrolled') {
        return await modal({ title: '🎓 التسجيل الرسمي — ' + a.name, body: `<p>بعد التسجيل يُرصد الطالب ضمن المسجّلين رسميًا، ويرتبط تلقائيًا بحسابه في المنصة عندما يُضاف من نظام التسجيل برقم هويته.</p>
          <div class="form-grid"><label class="f">رقم هوية/إقامة الطالب<input id="ni" dir="ltr" value="${esc(a.national_id || '')}"></label><label class="f">تاريخ التسجيل<input type="date" id="ed" value="${d10(new Date().toISOString())}"></label></div>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'تسجيل رسمي', cls: 'primary', onClick: (w) => { if (!val(w, '#ni')) { toast('رقم الهوية مطلوب', 'err'); return false; } return run('enrolled', { national_id: val(w, '#ni'), enrolled_at: $('#ed', w).value }); } }] });
      }
      if (act === 'lost') {
        return await modal({ title: '🚫 لم يكمل — ' + a.name, body: `<label class="f">السبب<select id="lr">${opts(LOST.map((x) => [x, x]), '', '— اختر —')}</select></label><label class="f">تفاصيل (اختياري)<input id="lx"></label>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ', cls: 'danger', onClick: (w) => { const s = $('#lr', w).value, x = val(w, '#lx');
            const reason = s && s !== 'أخرى' ? (x ? s + ' — ' + x : s) : (x || s);
            if (!reason) { toast('اختر السبب', 'err'); return false; } return run('lost', { lost_reason: reason }); } }] });
      }
    } catch (e) { toast(errMsg(e), 'err'); }
    return false;
  }
  async function resultForm(a) {
    return modal({ title: '📝 نتيجة اختبار القبول — ' + a.name, body: `<p class="hint">${esc(a.grade || '')} · ${esc(fmt(a.test_at))} · درجة الاجتياز المعتمدة: ${esc(CFG.pass ?? 60)}</p>
      <div class="form-grid"><label class="f">الدرجة (من 100)<input type="number" id="rs" min="0" max="100" step="0.5" value="${a.test_score ?? ''}"></label>
      <label class="f">النتيجة<select id="rp"><option value="1">✅ اجتاز</option><option value="0">❌ لم يجتز</option></select></label></div>
      <label class="f">ملاحظات المختبِر (المستوى، نقاط القوة والدعم)<textarea id="rn" rows="3">${esc(a.test_notes || '')}</textarea></label>`,
      actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ النتيجة', cls: 'primary', onClick: async (w) => {
        await call('adm_test_result', { p_id: a.id, p_passed: $('#rp', w).value === '1', p_score: $('#rs', w).value === '' ? null : +$('#rs', w).value, p_notes: val(w, '#rn') });
        toast('تم رصد النتيجة ✓'); return true; } }],
    });
  }

  // نموذج الأسرة (إضافة/تعديل)
  const familyFields = (D = {}) => `<div class="form-grid">
      <label class="f">مصدر العميل<select id="fsrc">${opts(Object.entries(SRC), D.source || 'social')}</select></label>
      <label class="f">تفاصيل المصدر (المنصة/الحملة/المول/من رشّحه)<input id="fsd" value="${esc(D.source_detail || '')}" placeholder="مثال: إعلان سناب شات — حملة ديسمبر"></label>
      <label class="f">اسم ولي الأمر<input id="fgn" value="${esc(D.guardian_name || '')}"></label>
      <label class="f">صلة القرابة<select id="frl">${opts(['الأب', 'الأم', 'ولي أمر آخر'].map((x) => [x, x]), D.relation || 'الأب')}</select></label>
      <label class="f">الجوال<input id="fph" dir="ltr" value="${esc(D.phone || '')}" placeholder="05xxxxxxxx"></label>
      <label class="f">جوال آخر (اختياري)<input id="fp2" dir="ltr" value="${esc(D.phone2 || '')}"></label>
      <label class="f">البريد (اختياري)<input id="fem" dir="ltr" value="${esc(D.email || '')}"></label>
      <label class="f">الحي (اختياري)<input id="fds" value="${esc(D.district || '')}"></label>
      ${MANAGE ? `<label class="f">المسؤول عن المتابعة<select id="fow">${stOpts(D.id ? D.owner_id : ctx.profile.id, '— غير مسند —')}</select></label>` : ''}</div>
    <label class="f">ملاحظات<textarea id="fnt" rows="2">${esc(D.notes || '')}</textarea></label>`;
  const familyPayload = (w, id) => Object.assign({ id: id || '', source: $('#fsrc', w).value, source_detail: val(w, '#fsd'), guardian_name: val(w, '#fgn'), relation: $('#frl', w).value,
    phone: val(w, '#fph'), phone2: val(w, '#fp2'), email: val(w, '#fem'), district: val(w, '#fds'), notes: val(w, '#fnt') }, MANAGE ? { owner_id: $('#fow', w).value } : {});
  async function familyForm(D) {
    return modal({ title: '✏️ بيانات ولي الأمر', wide: true, body: familyFields(D), actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      await call('adm_family_save', { p: familyPayload(w, D.id) }); toast('تم الحفظ ✓'); return true; } }] });
  }
  const childFields = (a = {}, i = '') => `<div class="kid glass" style="padding:8px 10px;margin:6px 0"><div class="form-grid">
      <label class="f">اسم الطالب/ة<input data-k="name${i}" value="${esc(a.name || '')}"></label>
      <label class="f">الجنس<select data-k="gender${i}">${opts([['m', 'ذكر'], ['f', 'أنثى']], a.gender || 'm')}</select></label>
      <label class="f">الصف المطلوب<select data-k="grade_id${i}">${grOpts(a.grade_id)}</select></label>
      <label class="f">تاريخ الميلاد<input type="date" data-k="birth_date${i}" value="${esc(a.birth_date || '')}"></label>
      <label class="f">المدرسة الحالية<input data-k="current_school${i}" value="${esc(a.current_school || '')}"></label>
      ${MANAGE ? `<label class="f">رقم الهوية/الإقامة<input dir="ltr" data-k="national_id${i}" value="${esc(a.national_id || '')}"></label>` : ''}
      <label class="f">العام الدراسي<select data-k="year_name${i}">${opts(years().map((y) => [y, y]), a.year_name || years()[0])}</select></label></div></div>`;
  const kidOf = (root, i = '') => Object.fromEntries(['name', 'gender', 'grade_id', 'birth_date', 'current_school', 'national_id', 'year_name'].map((k) => { const el = $(`[data-k="${k}${i}"]`, root); return [k, el ? el.value.trim() : '']; }));
  async function childForm(a) {
    return modal({ title: a.id ? '✏️ بيانات الطالب' : '➕ ابن جديد', wide: true, body: childFields(a), actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      await call('adm_applicant_save', { p: Object.assign(kidOf(w), { id: a.id || '', family_id: a.family_id }) }); toast('تم الحفظ ✓'); return true; } }] });
  }

  /* =================== عميل جديد =================== */
  function newView() {
    let n = 1;
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">➕ عميل جديد</h3>
      <p class="hint">سجّل بيانات ولي الأمر وأبنائه المهتمين بالتسجيل — من إعلان، أو دعاية في مول، أو اتصال، أو زيارة للمدرسة. ${MANAGE ? '' : 'يظهر لقسم التسجيل فورًا كعميل محتمل.'}</p>
      <div id="nf">${familyFields({})}</div>
      ${MANAGE ? `<label class="f" style="max-width:340px">المرحلة الأولى<select id="nst"><option value="inquiry">☎️ استفسار — سُجّلت بيانات ولي الأمر</option><option value="lead">📣 عميل محتمل — لم يُتواصل معه بعد</option></select></label>` : ''}
      <h4>👦 الأبناء</h4><div id="kids">${childFields({}, 0)}</div><button class="btn sm" id="ak">➕ ابن آخر</button>
      <div style="margin-top:12px;display:flex;gap:8px"><button class="btn primary" id="sv">حفظ العميل</button></div></div>`;
    $('#ak').onclick = () => { $('#kids').insertAdjacentHTML('beforeend', childFields({}, n++)); };
    $('#sv').onclick = async () => {
      const p = familyPayload(view); p.children = Array.from({ length: n }, (_, i) => kidOf(view, i)).filter((k) => k.name); if (MANAGE) p.stage = $('#nst').value;
      if (!p.children.length) { toast('اكتب اسم ابن واحد على الأقل', 'err'); return; }
      try {
        let r = await call('adm_family_save', { p });
        if (!r.ok && r.duplicate) {
          const c = await modal({ title: '⚠️ رقم الجوال مسجّل من قبل', body: `<p>الرقم موجود في ملف ولي الأمر <b>${esc(r.name)}</b>.</p>`,
            actions: [{ label: 'فتح الملف الموجود', value: 'open', cls: 'primary' }, { label: 'حفظ كعميل جديد رغم ذلك', value: 'force' }, { label: 'إلغاء', value: null }] });
          if (c === 'open') { openFamily(r.duplicate); return; }
          if (c !== 'force') return;
          r = await call('adm_family_save', { p: Object.assign(p, { force: true }) });
        }
        toast('تم حفظ العميل ✓'); go('board'); setTimeout(() => openFamily(r.id, () => {}), 300);
      } catch (e) { toast(errMsg(e), 'err'); }
    };
  }

  /* =================== المتابعات =================== */
  async function followView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [], N = [];
    try { [L, N] = await Promise.all([call('adm_followups'), call('adm_board', { p: { closed: false } })]); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const today = d10(new Date().toISOString());
    const fresh = N.filter((a) => ['lead', 'inquiry'].includes(a.stage) && !a.next_at);
    const seen = new Set(); const freshFam = fresh.filter((a) => !seen.has(a.family_id) && seen.add(a.family_id));
    view.innerHTML = `<div class="row2">
      <div class="glass" style="padding:10px 12px"><h3 style="margin-top:0">📞 المتابعات المستحقة <span class="pill">${L.length}</span></h3><p class="hint">المتأخرة والمستحقة اليوم وخلال أسبوع.</p>
        ${L.map((f) => `<div class="fu ${f.next_at < today ? 'late' : f.next_at === today ? 'now' : ''}" data-fam="${f.family_id}"><b>${esc(f.guardian)}</b> <span class="pill ${f.next_at <= today ? 'bad' : 'gold'}">${f.next_at < today ? 'متأخرة · ' : f.next_at === today ? 'اليوم · ' : ''}${esc(fmtD(f.next_at))}</span>
          <div class="hint">${esc(f.children || '')}${f.owner ? ' · ' + esc(f.owner) : ''}</div>${f.body ? `<div>${esc(f.body)}</div>` : ''}
          <div style="display:flex;gap:6px;margin-top:4px"><a class="btn sm" href="tel:${esc(f.phone)}">📞 اتصال</a><a class="btn sm" href="${esc(wa(f.phone))}" target="_blank" rel="noopener">💬 واتساب</a><button class="btn sm" data-done="${f.id}">✓ تمت</button></div></div>`).join('') || '<div class="hint">لا متابعات مستحقة 👍</div>'}</div>
      <div class="glass" style="padding:10px 12px"><h3 style="margin-top:0">📥 عملاء بدون موعد متابعة <span class="pill">${freshFam.length}</span></h3><p class="hint">عملاء محتملون واستفسارات لم يُحدَّد لهم موعد متابعة — افتح الملف وسجّل التواصل.</p>
        ${freshFam.map((a) => `<div class="fu" data-fam="${a.family_id}"><b>${esc(a.guardian)}</b> <span class="hint">· ${esc(a.name)} · ${esc(a.grade || '')}</span><div class="hint">${esc(a.source_label || '')} · ${esc(ago(a.created_at))}${a.phone ? ` · <span dir="ltr">${esc(a.phone)}</span>` : ''}</div></div>`).join('') || '<div class="hint">لا يوجد 👍</div>'}</div></div>`;
    view.onclick = async (e) => {
      const d = e.target.closest('[data-done]'); if (d) { e.stopPropagation(); try { await call('adm_followup_done', { p_id: +d.dataset.done }); followView(); } catch (er) { toast(errMsg(er), 'err'); } return; }
      const c = e.target.closest('[data-fam]'); if (c && !e.target.closest('a')) openFamily(+c.dataset.fam, followView);
    };
  }

  /* =================== اختبارات القبول =================== */
  async function testsView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('adm_tests'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const wait = L.filter((a) => a.stage === 'test'), done = L.filter((a) => a.stage !== 'test');
    const row = (a) => `<tr><td>${esc(fmt(a.test_at))}</td><td><b>${esc(a.name)}</b>${CONTACT ? `<div class="hint">👤 ${esc(a.guardian)}</div>` : ''}</td><td>${esc(a.grade || '')}</td><td>${esc(a.tester || '—')}</td>
      <td>${a.stage === 'test' ? '<span class="pill gold">بانتظار النتيجة</span>' : `<span class="pill ${a.stage === 'failed' ? 'bad' : 'ok'}">${esc(SL(a.stage))}</span> ${a.test_score != null ? esc(a.test_score) : ''}`}</td>
      <td>${a.can_grade ? `<button class="btn sm ${a.stage === 'test' ? 'primary' : ''}" data-res="${a.id}">${a.stage === 'test' ? '📝 رصد النتيجة' : '✏️ تعديل'}</button>` : ''}${CONTACT ? ` <button class="btn sm" data-fam="${a.family_id}">📂</button>` : ''}</td></tr>`;
    const tbl = (A) => `<div class="glass" style="padding:6px;overflow:auto"><table class="t"><thead><tr><th>الموعد</th><th>الطالب</th><th>الصف</th><th>المختبِر</th><th>النتيجة</th><th></th></tr></thead><tbody>${A.map(row).join('')}</tbody></table></div>`;
    view.innerHTML = `<h3>⏳ بانتظار الاختبار أو النتيجة (${wait.length})</h3>${wait.length ? tbl(wait) : '<div class="empty">لا اختبارات قبول مجدولة.</div>'}
      ${done.length ? `<h3>✅ نتائج آخر 30 يومًا (${done.length})</h3>${tbl(done)}` : ''}
      <p class="hint">${MANAGE ? 'يُحدَّد موعد الاختبار والمختبِر من ملف الأسرة (زر «📅 تحديد موعد اختبار القبول»)، ويصل للمختبِر إشعار في الرسائل.' : 'تظهر هنا اختبارات القبول التي كُلّفت بها' + (R === 'principal' ? ' واختبارات المتقدّمين لمرحلتك' : '') + '.'}</p>`;
    view.onclick = async (e) => {
      const r = e.target.closest('[data-res]'); if (r) { if (await resultForm(L.find((a) => a.id === +r.dataset.res))) testsView(); return; }
      const f = e.target.closest('[data-fam]'); if (f) openFamily(+f.dataset.fam, testsView);
    };
  }

  /* =================== التقارير =================== */
  async function statsView() {
    const y = new Date(); const from0 = sessionStorage.getItem('adm_from') || `${y.getMonth() >= 7 ? y.getFullYear() : y.getFullYear() - 1}-08-01`;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">من <input type="date" id="sf" value="${from0}"> إلى <input type="date" id="st" value="${d10(new Date().toISOString())}">
      <button class="btn sm" id="sr">تحديث</button><span style="flex:1"></span><button class="btn sm" id="sp">🖨️ طباعة</button></div><div id="sb"><div class="empty">جارٍ التحميل…</div></div>`;
    const load = async () => {
      sessionStorage.setItem('adm_from', $('#sf').value);
      let S; try { S = await call('adm_stats', { p_from: $('#sf').value, p_to: $('#st').value }); } catch (e) { $('#sb').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      const max = Math.max(1, ...(S.funnel || []).map((f) => f.n)), pct = (a, b) => (b ? Math.round(a * 100 / b) + '%' : '—');
      const T = (h, rows) => `<div class="glass" style="padding:10px 12px"><h4 style="margin:0 0 6px">${h}</h4>${rows}</div>`;
      $('#sb').innerHTML = `<div class="kpi4">
          <div class="card-box glass"><b>${S.families}</b>أسرة (عميل)</div><div class="card-box glass"><b>${S.total}</b>طالب متقدّم</div>
          <div class="card-box glass"><b style="color:#007B51">${S.enrolled}</b>مسجّل رسميًا</div><div class="card-box glass"><b>${pct(S.enrolled, S.total)}</b>نسبة التحويل</div></div>
        <div class="row2">${T('🔻 قمع رحلة التسجيل', (S.funnel || []).map((f, i, A) => `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between"><span>${SI(f.stage)} ${esc(f.label)}</span><b>${f.n}${i ? ` <span class="hint">(${pct(f.n, A[i - 1].n)} من السابقة)</span>` : ''}</b></div><div class="bar"><i style="width:${f.n * 100 / max}%"></i></div></div>`).join('')
            + `<p class="hint">لم يجتز الاختبار: ${S.failed} · لم يكمل: ${S.lost}</p>`)}
          ${T('📣 مصادر العملاء (للتسويق)', `<table class="t"><thead><tr><th>المصدر</th><th>متقدّمون</th><th>مسجّلون</th><th>التحويل</th></tr></thead><tbody>${(S.sources || []).map((s) => `<tr><td>${esc(SRC[s.source] || s.label)}</td><td>${s.n}</td><td>${s.enrolled}</td><td>${pct(s.enrolled, s.n)}</td></tr>`).join('') || '<tr><td colspan="4" class="hint">—</td></tr>'}</tbody></table>`)}
          ${T('🎯 حسب الصف المطلوب', `<table class="t"><thead><tr><th>الصف</th><th>متقدّمون</th><th>مسجّلون</th></tr></thead><tbody>${(S.grades || []).map((g) => `<tr><td>${esc(g.grade)}</td><td>${g.n}</td><td>${g.enrolled}</td></tr>`).join('')}</tbody></table>`)}
          ${T('👥 حسب المسؤول عن المتابعة', `<table class="t"><thead><tr><th>الموظف</th><th>متقدّمون</th><th>مسجّلون</th><th>التحويل</th></tr></thead><tbody>${(S.owners || []).map((o) => `<tr><td>${esc(o.name)}</td><td>${o.n}</td><td>${o.enrolled}</td><td>${pct(o.enrolled, o.n)}</td></tr>`).join('')}</tbody></table>`)}
          ${T('🚫 أسباب عدم الإكمال', (S.lost_reasons || []).map((l) => `<div style="display:flex;justify-content:space-between"><span>${esc(l.reason)}</span><b>${l.n}</b></div>`).join('') || '<div class="hint">لا يوجد</div>')}
          ${T('📆 حسب الشهر', `<table class="t"><thead><tr><th>الشهر</th><th>متقدّمون</th><th>مسجّلون</th></tr></thead><tbody>${(S.monthly || []).map((m) => `<tr><td>${esc(m.m)}</td><td>${m.n}</td><td>${m.enrolled}</td></tr>`).join('')}</tbody></table>`)}</div>`;
    };
    $('#sr').onclick = load; $('#sp').onclick = () => LMS.printHTML ? LMS.printHTML('تقرير التسجيل والقبول', $('#sb').innerHTML) : window.print();
    await load();
  }

  /* =================== رابط النموذج الإلكتروني =================== */
  function linkView() {
    const base = location.href.split(/[?#]/)[0].replace(/admissions\.html$/, 'apply.html');
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">🔗 نموذج التسجيل الإلكتروني لأولياء الأمور</h3>
      <p>صفحة عامة <b>بدون تسجيل دخول</b> يعبّئها ولي الأمر من الإعلان أو الباركود في المول، فيظهر طلبه فورًا هنا كـ«عميل محتمل» مع مصدره. اصنع رابطًا مختلفًا لكل حملة لتعرف في التقارير أي إعلان جاء بالعملاء.</p>
      ${CFG.public_open === false ? '<div class="notice warn">⚠️ النموذج مغلق حاليًا من الإعدادات.</div>' : ''}
      <div class="form-grid"><label class="f">المصدر<select id="ls">${opts(Object.entries(SRC).filter(([k]) => !['walkin', 'call'].includes(k)), 'social')}</select></label>
        <label class="f">اسم الحملة (يظهر في التقارير)<input id="lc" placeholder="مثال: سناب — ديسمبر" ></label></div>
      <label class="f">الرابط<input id="lu" dir="ltr" readonly></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary sm" id="lcp">📋 نسخ الرابط</button><a class="btn sm" id="lo" target="_blank" rel="noopener">↗ فتح النموذج</a></div>
      <p class="hint" style="margin-top:10px">💡 للمولات والمطبوعات: حوّل الرابط إلى باركود QR من أي موقع لإنشاء الباركود واطبعه على الإعلان.</p></div>`;
    const upd = () => { const u = base + '?src=' + encodeURIComponent($('#ls').value) + ($('#lc').value.trim() ? '&c=' + encodeURIComponent($('#lc').value.trim()) : ''); $('#lu').value = u; $('#lo').href = u; };
    $('#ls').onchange = upd; $('#lc').oninput = upd; upd();
    $('#lcp').onclick = async () => { try { await navigator.clipboard.writeText($('#lu').value); toast('تم نسخ الرابط ✓'); } catch (_) { $('#lu').select(); } };
  }

  /* =================== الإعدادات =================== */
  function settingsView() {
    view.innerHTML = `<div class="glass" style="padding:14px"><h3 style="margin-top:0">⚙️ إعدادات التسجيل والقبول</h3>
      <label class="f">📎 مستندات ملف الطالب (مستند في كل سطر)<textarea id="sd" rows="8">${esc((CFG.docs || []).join('\n'))}</textarea></label>
      <div class="form-grid"><label class="f">درجة اجتياز اختبار القبول (للاسترشاد)<input type="number" id="sp" min="0" max="100" value="${esc(CFG.pass ?? 60)}"></label>
        <label class="f">الأعوام الدراسية المتاحة للتسجيل (افصل بفاصلة)<input id="sy" dir="ltr" value="${esc(years().join(', '))}"></label></div>
      <label class="chk"><input type="checkbox" id="so" ${CFG.public_open !== false ? 'checked' : ''}> استقبال الطلبات من النموذج الإلكتروني العام</label>
      <p class="hint">👥 <b>من يدخل الوحدة؟</b> يُحدَّد من «المسمى الوظيفي» للموظف في لوحة الإدارة: يحتوي «تسجيل» أو «قبول» ← قسم التسجيل (كامل الرحلة) · «تسويق» أو «علاقات عامة» ← التسويق (إضافة العملاء ومتابعتهم والتقارير). مدير المرحلة يرى متقدّمي مرحلته، والمعلم يرى الاختبارات التي كُلّف بها.</p>
      <button class="btn primary" id="ss">حفظ</button></div>`;
    $('#ss').onclick = async () => {
      const p = { docs: $('#sd').value.split('\n').map((x) => x.trim()).filter(Boolean), pass: $('#sp').value, years: $('#sy').value.split(/[,،]/).map((x) => x.trim()).filter(Boolean), public_open: $('#so').checked };
      try { await call('adm_settings_set', { p }); Object.assign(CFG, p); toast('تم الحفظ ✓'); } catch (e) { toast(errMsg(e), 'err'); }
    };
  }

  paint();
})();
