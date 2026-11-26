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
    ['interview', 'مقابلة مدير المرحلة', '🤝'], ['approved', 'موافقة مدير المرحلة', '👍'], ['file', 'فتح الملف', '📁'], ['contract', 'توقيع العقد', '✍️'], ['enrolled', 'مسجّل رسميًا', '🎓']];
  const CLOSED = { failed: ['لم يجتز الاختبار', '❌'], rejected: ['لم يوافق مدير المرحلة', '✋'], lost: ['لم يكمل', '🚫'] };
  const SL = (s) => (STAGES.find((x) => x[0] === s) || [s, (CLOSED[s] || [s])[0]])[1];
  const SI = (s) => (STAGES.find((x) => x[0] === s) || [0, 0, (CLOSED[s] || [0, '•'])[1]])[2];
  const SRC = { social: '📱 وسائل التواصل الاجتماعي', mall: '🛍️ دعاية في المولات', call: '📞 اتصال هاتفي', walkin: '🏫 زيارة المدرسة', referral: '🤝 ترشيح ولي أمر', website: '🌐 الموقع / النموذج الإلكتروني', event: '🎪 فعالية / معرض', other: '• أخرى' };
  const KIND = { call: '📞 اتصال', whatsapp: '💬 واتساب', visit: '🏫 زيارة', email: '✉️ بريد', note: '📝 ملاحظة', stage: '➡️ مرحلة', test: '📝 اختبار', interview: '🤝 مقابلة', system: '⚙️ النظام' };
  const testUrl = (tok) => location.href.split(/[?#]/)[0].replace(/admissions\.html$/, 'admission-test.html') + '?t=' + tok;
  const LOST = ['السعر / الرسوم', 'اختار مدرسة أخرى', 'بُعد المسافة / النقل', 'لا يوجد مقعد في الصف', 'لم يرد على التواصل', 'تأجيل للعام القادم', 'أخرى'];
  const GR = ME.grades || [], STAFF = ME.staff || [], CFG = ME.cfg || {};
  const PRINC = STAFF.filter((x) => ['principal', 'leadership', 'admin'].includes(x.role)).concat(STAFF.filter((x) => !['principal', 'leadership', 'admin'].includes(x.role)));
  const princOpts = (sel) => `<optgroup label="مديرو المراحل والقيادات">${PRINC.filter((x) => ['principal', 'leadership', 'admin'].includes(x.role)).map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}${x.job ? ' — ' + esc(x.job) : ''}</option>`).join('')}</optgroup>
    <optgroup label="آخرون">${PRINC.filter((x) => !['principal', 'leadership', 'admin'].includes(x.role)).map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`;
  const d10 = (t) => (t ? String(t).slice(0, 10) : '');
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };   // التاريخ المحلي (لا UTC)
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
  const tabs = CONTACT ? [['board', '🧭 رحلة التسجيل'], ['new', '➕ عميل جديد'], ['follow', '📞 المتابعات'], ['tests', '📝 اختبارات القبول'], ['interviews', '🤝 المقابلات'], ['stats', '📊 التقارير'], ['link', '🔗 النموذج الإلكتروني']]
    : R === 'principal' ? [['interviews', '🤝 مقابلات القبول'], ['tests', '📝 اختبارات القبول'], ['board', '🧭 متقدّمو مرحلتي']] : [['interviews', '🤝 مقابلات القبول'], ['tests', '📝 اختبارات القبول']];
  if (MANAGE) tabs.splice(4, 0, ['exams', '🧩 بنك اختبارات القبول']);
  if (MANAGE) tabs.push(['settings', '⚙️ الإعدادات']);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  const go = (t) => { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); paint(); };
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  const paint = () => { view.onclick = null; return ({ board: boardView, new: () => newView(), follow: followView, tests: testsView, interviews: interviewsView, exams: examsView, stats: statsView, link: linkView, settings: settingsView })[TAB](); };

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
      <div class="hint">${esc(a.grade || 'لم يُحدَّد الصف')}${a.year_name ? ' · <bdi>' + esc(a.year_name) + '</bdi>' : ''}</div>
      <div class="hint">👤 ${esc(a.guardian)}${a.phone ? ` · <a href="tel:${esc(a.phone)}" dir="ltr">${esc(a.phone)}</a>` : ''}</div>
      <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${a.source ? `<span class="pill">${esc((SRC[a.source] || '').split(' ')[0])} ${esc(a.source_label)}</span>` : ''}
        ${a.stage === 'test' && a.test_at ? `<span class="pill gold">📅 ${esc(fmt(a.test_at))}</span>` : ''}
        ${a.next_at ? `<span class="pill ${a.next_at <= today() ? 'bad' : 'gold'}">📞 متابعة ${esc(fmtD(a.next_at))}</span>` : ''}
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
    const cols = STAGES.filter((s) => F.closed || s[0] !== 'enrolled').concat(F.closed ? [['failed', CLOSED.failed[0], '❌'], ['rejected', CLOSED.rejected[0], '✋'], ['lost', CLOSED.lost[0], '🚫']] : []);
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
      return `<div class="stp">${STAGES.map(([k, l, i], n) => `<div class="st ${a.stage === k ? 'cur' : (idx > n || (a.stage === 'failed' && n < 3) || (a.stage === 'rejected' && n < 5) || (a.stage === 'lost' && n === 0)) ? 'done' : ''}" title="${esc(l)}"><span>${i}</span><small>${esc(l)}</small></div>`).join('')}</div>
        ${CLOSED[a.stage] ? `<div class="notice ${a.stage === 'lost' ? 'warn' : 'err'}" style="margin:6px 0">${CLOSED[a.stage][1]} ${esc(CLOSED[a.stage][0])}${a.lost_reason ? ' — ' + esc(a.lost_reason) : ''}</div>` : ''}`; };
    const actions = (a) => {
      if (!D.can_stage) return a.stage === 'lead' && D.can_edit ? '<span class="hint">ينقله قسم التسجيل والقبول للمراحل التالية.</span>' : '';
      const B = (s, l, c = '') => `<button class="btn sm ${c}" data-act="${s}" data-a="${a.id}">${l}</button>`;
      const att = a.attempt, live = att && ['open', 'started'].includes(att.status);
      const online = live ? B('link', '🔗 رابط الاختبار', 'primary') + B('cancel_att', '⛔ إلغاء الرابط') : B('online', '🖥️ فتح الاختبار الإلكتروني', 'primary');
      const m = { lead: B('inquiry', '☎️ تسجيل الاستفسار وبيانات ولي الأمر', 'primary'), inquiry: online + B('test', '📅 موعد اختبار حضوري') + B('file_direct', '📁 فتح الملف بدون اختبار'),
        test: online + (live ? '' : B('result', '✍️ رصد يدوي للنتيجة')) + B('test', '📅 تغيير الموعد'), passed: B('interview', '🤝 تحديد مقابلة مدير المرحلة', 'primary'),
        failed: online.replace('فتح الاختبار الإلكتروني', 'إعادة الاختبار الإلكتروني'),
        interview: B('interview', '📅 تغيير موعد المقابلة') + (a.can_decide ? B('decide', '🤝 تسجيل قرار المقابلة', 'primary') : '<span class="hint">⏳ بانتظار قرار مدير المرحلة بعد المقابلة.</span>'),
        approved: B('file', '📁 فتح ملف الطالب', 'primary'), rejected: B('interview', '🤝 مقابلة جديدة'),
        file: a.interview_decision === 'approved' ? B('contract', '✍️ توقيع العقد', 'primary') : B('interview', '🤝 تحديد مقابلة مدير المرحلة (مطلوبة قبل العقد)', 'primary'),
        contract: B('enrolled', '🎓 التسجيل الرسمي', 'primary'), lost: B('inquiry', '↩️ إعادة فتح'), enrolled: '' }[a.stage] || '';
      return m + (['enrolled', 'lost'].includes(a.stage) ? '' : B('lost', '🚫 لم يكمل', 'danger'));
    };
    const docsBox = (a) => { if (!['file', 'contract', 'enrolled'].includes(a.stage)) return ''; const docs = CFG.docs || []; const got = docs.filter((d) => a.docs && a.docs[d]).length;
      return `<details class="docs" ${got < docs.length ? 'open' : ''}><summary><b>📎 مستندات الملف</b> <span class="pill ${got === docs.length ? 'ok' : 'gold'}">${got}/${docs.length}</span></summary>
        ${docs.map((d) => `<label class="chk"><input type="checkbox" data-doc="${esc(d)}" data-a="${a.id}" ${a.docs && a.docs[d] ? 'checked' : ''} ${MANAGE ? '' : 'disabled'}> ${esc(d)}${a.docs && a.docs[d] ? ` <span class="hint">(${esc(fmtD(a.docs[d]))})</span>` : ''}</label>`).join('')}</details>`; };
    const facts = (a) => [a.grade && `🎯 ${esc(a.grade)}`, a.year_name && `📆 <bdi>${esc(a.year_name)}</bdi>`, a.birth_date && `🎂 ${esc(fmtD(a.birth_date))}`, a.current_school && `🏫 من: ${esc(a.current_school)}`,
      a.national_id && `🪪 ${esc(a.national_id)}`, a.test_at && `📅 الاختبار: ${esc(fmt(a.test_at))}${a.tester ? ' — ' + esc(a.tester) : ''}`,
      a.attempt && `🖥️ ${esc(a.attempt.exam)}: ${a.attempt.status === 'submitted' ? `<b>${esc(a.attempt.pct)}%</b> (${esc(a.attempt.score)} من ${esc(a.attempt.total)}) <a href="#" data-det="${a.attempt.id}">📄 الإجابات</a>` : a.attempt.status === 'started' ? '<span class="pill gold">⏳ يؤدي الاختبار الآن</span>' : `<span class="pill">🔗 الرابط مفتوح حتى ${esc(fmt(a.attempt.expires_at))}</span>`}`,
      a.test_score != null && !(a.attempt && a.attempt.status === 'submitted') && `📝 الدرجة: <b>${esc(a.test_score)}</b>${a.test_notes ? ' — ' + esc(a.test_notes) : ''}`,
      a.interview_at && `🤝 المقابلة: ${esc(fmt(a.interview_at))}${a.interviewer ? ' — ' + esc(a.interviewer) : ''}${a.interview_decision ? ` <span class="pill ${a.interview_decision === 'approved' ? 'ok' : 'bad'}">${a.interview_decision === 'approved' ? '👍 وافق' : '✋ لم يوافق'}${a.decided_by ? ' — ' + esc(a.decided_by) : ''}</span>` : ' <span class="pill gold">⏳ بانتظار القرار</span>'}${a.interview_notes ? ' — ' + esc(a.interview_notes) : ''}`, a.file_no && `📁 الملف: <b>${esc(a.file_no)}</b>`,
      a.contract_at && `✍️ العقد${a.contract_no ? ' ' + esc(a.contract_no) : ''}: ${esc(fmtD(a.contract_at))}${a.fees ? ` — ${Number(a.fees).toLocaleString('ar-SA')} ريال` : ''}`,
      a.enrolled_at && `🎓 سُجّل: ${esc(fmtD(a.enrolled_at))} ${a.student_id ? '<span class="pill ok">✓ مرتبط بحسابه في المنصة</span>' : '<span class="pill gold">سيرتبط تلقائيًا عند إضافته للمنصة برقم الهوية</span>'}`]
      .filter(Boolean).map((x) => `<span class="fct">${x}</span>`).join('');
    function render() {
      D.applicants.forEach((a) => { a.can_decide = ctx.profile.role === 'admin' || a.interviewer_id === ctx.profile.id; });
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
      const dt = e.target.closest('[data-det]'); if (dt) { e.preventDefault(); attemptDetail(+dt.dataset.det); return; }
      const t = e.target.closest('button,[data-doc]'); if (!t) return;
      if (t.dataset.nx) { const d = new Date(); d.setDate(d.getDate() + +t.dataset.nx); $('#ln', box).value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); return; }
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
      if (c.checked) docs[c.dataset.doc] = today(); else delete docs[c.dataset.doc];
      try { await call('adm_docs_set', { p_id: a.id, p_docs: docs }); a.docs = docs; render(); } catch (er) { toast(errMsg(er), 'err'); c.checked = !c.checked; }
    });
    modal({ title: '📂 ملف الأسرة', body: box, wide: true, actions: [{ label: 'إغلاق', value: null }] });
  }

  // نوافذ الانتقال بين المراحل
  async function stageAction(a, act) {
    const run = async (stage, p) => { await call('adm_stage', { p_id: a.id, p_stage: stage, p: p || {} }); toast('تم ✓ — ' + SL(stage)); return true; };
    try {
      if (act === 'inquiry') return await run('inquiry');
      if (act === 'online') return await openOnline(a);
      if (act === 'link') { showLink(a, a.attempt.token); return false; }
      if (act === 'cancel_att') { if (!await confirmBox('إلغاء رابط الاختبار؟ لن يتمكن الطالب من استخدامه.', 'نعم، ألغِ')) return false; await call('adm_attempt_cancel', { p_id: a.attempt.id }); toast('أُلغي الرابط'); return true; }
      if (act === 'decide') return await decideForm(a);
      if (act === 'interview') {
        const local = (t) => (t ? new Date(new Date(t) - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 16) : '');
        return await modal({ title: '🤝 مقابلة مدير المرحلة — ' + a.name, body: `<p class="hint">مقابلة إلزامية بعد اجتياز اختبار القبول، ولا يُوقَّع العقد إلا بموافقة مدير المرحلة. يصل للمقابِل إشعار في الرسائل، ويسجّل قراره من «🤝 مقابلات القبول».</p>
          ${a.test_score != null ? `<p>📝 نتيجة الاختبار: <b>${esc(a.test_score)}%</b> · ${esc(a.grade || '')}</p>` : ''}
          <div class="form-grid"><label class="f">موعد المقابلة<input type="datetime-local" id="ia" value="${local(a.interview_at)}"></label>
          <label class="f">مدير المرحلة (المقابِل)<select id="ii"><option value="">— اختر —</option>${princOpts(a.interviewer_id)}</select></label></div>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'حفظ وإشعار المدير', cls: 'primary', onClick: (w) => {
            if (!$('#ia', w).value || !$('#ii', w).value) { toast('حدّد الموعد والمقابِل', 'err'); return false; }
            return run('interview', { interview_at: new Date($('#ia', w).value).toISOString(), interviewer_id: $('#ii', w).value }); } }] });
      }
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
          <div class="form-grid"><label class="f">تاريخ التوقيع<input type="date" id="cd" value="${today()}"></label><label class="f">رقم العقد<input id="cn" dir="ltr"></label>
          <label class="f">الرسوم السنوية (ريال)<input type="number" id="cf" min="0" step="0.01"></label></div>`,
          actions: [{ label: 'إلغاء', value: false }, { label: 'تأكيد توقيع العقد', cls: 'primary', onClick: (w) => run('contract', { contract_at: $('#cd', w).value, contract_no: val(w, '#cn'), fees: $('#cf', w).value }) }] });
      }
      if (act === 'enrolled') {
        return await modal({ title: '🎓 التسجيل الرسمي — ' + a.name, body: `<p>بعد التسجيل يُرصد الطالب ضمن المسجّلين رسميًا، ويرتبط تلقائيًا بحسابه في المنصة عندما يُضاف من نظام التسجيل برقم هويته.</p>
          <div class="form-grid"><label class="f">رقم هوية/إقامة الطالب<input id="ni" dir="ltr" value="${esc(a.national_id || '')}"></label><label class="f">تاريخ التسجيل<input type="date" id="ed" value="${today()}"></label></div>`,
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
  async function decideForm(a) {
    return modal({ title: '🤝 قرار مقابلة القبول — ' + a.name, body: `<p class="hint">${esc(a.grade || '')}${a.test_score != null ? ` · نتيجة اختبار القبول: <b>${esc(a.test_score)}%</b>` : ''} · المقابلة: ${esc(fmt(a.interview_at))}</p>
      ${a.test_notes ? `<p class="hint">${esc(a.test_notes)}</p>` : ''}
      <label class="f">ملاحظات المقابلة (انطباعك عن الطالب وولي الأمر، والتوصيات)<textarea id="dn" rows="4">${esc(a.interview_notes || '')}</textarea></label>
      <p class="hint">بالموافقة يستطيع قسم التسجيل فتح ملف الطالب وتوقيع العقد. وعدم الموافقة يغلق طلب الطالب.</p>`,
      actions: [{ label: 'إلغاء', value: false }, { label: '✋ عدم موافقة', cls: 'danger', onClick: async (w) => {
        if (!val(w, '#dn')) { toast('اكتب سبب عدم الموافقة في الملاحظات', 'err'); return false; }
        await call('adm_interview_decide', { p_id: a.id, p_approve: false, p_notes: val(w, '#dn') }); toast('تم تسجيل القرار'); return true; } },
      { label: '👍 موافقة', cls: 'primary', onClick: async (w) => { await call('adm_interview_decide', { p_id: a.id, p_approve: true, p_notes: val(w, '#dn') }); toast('تمت الموافقة ✓'); return true; } }] });
  }
  // فتح الاختبار الإلكتروني: اختيار الاختبار ثم رابط لمرة واحدة
  let EXAMS = null;
  const loadExams = async () => (EXAMS = EXAMS || await call('adm_exams_list'));
  async function openOnline(a) {
    const L = (await loadExams()).filter((e) => e.active);
    if (!L.length) { toast('لا توجد اختبارات قبول إلكترونية — أنشئها من «🧩 بنك اختبارات القبول»', 'warn'); go('exams'); return false; }
    const fit = L.filter((e) => !e.grade_ids.length || e.grade_ids.includes(a.grade_id)), rest = L.filter((e) => !fit.includes(e));
    const o = (e) => `<option value="${e.id}">${esc(e.title)} — ${e.n} سؤال، ${e.duration_min} دقيقة، النجاح ${e.pass_pct}%</option>`;
    const tok = await modal({ title: '🖥️ فتح اختبار القبول الإلكتروني — ' + a.name, body: `${a.grade ? `<p class="hint">الصف المطلوب: ${esc(a.grade)}</p>` : '<div class="notice warn">لم يُحدَّد الصف المطلوب للطالب.</div>'}
      <label class="f">الاختبار<select id="oe">${fit.length ? `<optgroup label="مناسبة لصفه">${fit.map(o).join('')}</optgroup>` : ''}${rest.length ? `<optgroup label="اختبارات أخرى">${rest.map(o).join('')}</optgroup>` : ''}</select></label>
      <label class="f">صلاحية الرابط<select id="oh"><option value="2">ساعتان (في المدرسة الآن)</option><option value="24">24 ساعة</option><option value="72">3 أيام (من المنزل)</option></select></label>
      <p class="hint">الرابط يُستخدم <b>مرة واحدة</b>، ويبدأ عداد الوقت عند ضغط الطالب «ابدأ الاختبار»، ويُصحَّح آليًا عند التسليم وتنتقل حالته تلقائيًا إلى «اجتاز» أو «لم يجتز».</p>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'إنشاء الرابط', cls: 'primary', onClick: async (w) => (await call('adm_attempt_open', { p_applicant: a.id, p_exam: +$('#oe', w).value, p_hours: +$('#oh', w).value })).token }] });
    if (!tok) return false;
    showLink(a, tok); return true;
  }
  function showLink(a, tok) {
    const u = testUrl(tok);
    modal({ title: '🔗 رابط اختبار القبول — ' + a.name, body: `<label class="f">الرابط<input id="lu" dir="ltr" readonly value="${esc(u)}"></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><a class="btn primary sm" href="${esc(u)}" target="_blank" rel="noopener">🖥️ فتح على هذا الجهاز</a>
        <button class="btn sm" id="cp">📋 نسخ</button>
        <a class="btn sm" id="wa" target="_blank" rel="noopener">💬 إرسال لولي الأمر بواتساب</a></div>
      <p class="hint" style="margin-top:8px">💡 في المدرسة: افتحه على جهاز المعمل واترك الطالب يبدأ. من المنزل: أرسله لولي الأمر.</p>`, actions: [{ label: 'تم', value: null }] });
    setTimeout(() => { const w = [...document.querySelectorAll('.modal-wrap')].pop(); if (!w) return;
      $('#cp', w).onclick = async () => { try { await navigator.clipboard.writeText(u); toast('تم النسخ ✓'); } catch (_) { $('#lu', w).select(); } };
      const ph = (document.querySelector('.fam a[href^="tel:"]') || {}).textContent || '';
      $('#wa', w).href = wa(ph.replace(/[^\d+]/g, '')).replace(/\/$/, '') + '?text=' + encodeURIComponent(`السلام عليكم، هذا رابط اختبار القبول للطالب ${a.name} في مدارس دار الذكر (يُستخدم مرة واحدة):\n${u}`); }, 50);
  }
  async function attemptDetail(id) {
    let D; try { D = await call('adm_attempt_detail', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const L = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز'];
    const giv = (q) => { const g = q.given; if (g == null) return '<span class="hint">لم يُجب</span>';
      if (q.type === 'short') return esc(g); if (q.type === 'multi') return (g || []).map((i) => esc(q.options[i] ? q.options[i].t : '?')).join('، '); return esc(q.options[g] ? q.options[g].t : '?'); };
    const right = (q) => q.type === 'short' ? esc(String(q.answer).split('|').join(' / ')) : q.options.filter((o) => o.ok).map((o) => esc(o.t)).join('، ');
    modal({ title: `📄 إجابات ${D.name} — ${D.exam}`, wide: true, body: `<p><b>${esc(D.pct)}%</b> (${esc(D.score)} من ${esc(D.total)}) · درجة النجاح ${esc(D.pass_pct)}% · ${D.started_at ? 'بدأ ' + esc(fmt(D.started_at)) : ''}${D.submitted_at ? ' · سلّم ' + esc(fmt(D.submitted_at)) : ''}</p>
      ${(D.items || []).map((q, i) => `<div class="lg" style="border-color:${q.got > 0 ? '#2e7d32' : '#c0392b'}"><b>${i + 1}.</b> ${esc(q.body)} <span class="pill ${q.got > 0 ? 'ok' : 'bad'}">${q.got}/${q.points}</span>
        <div class="hint">إجابته: ${giv(q)} · الصحيحة: ${right(q)}</div></div>`).join('')}`, actions: [{ label: 'إغلاق', value: null }] });
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
    const td = today();
    const fresh = N.filter((a) => ['lead', 'inquiry'].includes(a.stage) && !a.next_at);
    const seen = new Set(); const freshFam = fresh.filter((a) => !seen.has(a.family_id) && seen.add(a.family_id));
    view.innerHTML = `<div class="row2">
      <div class="glass" style="padding:10px 12px"><h3 style="margin-top:0">📞 المتابعات المستحقة <span class="pill">${L.length}</span></h3><p class="hint">المتأخرة والمستحقة اليوم وخلال أسبوع.</p>
        ${L.map((f) => `<div class="fu ${f.next_at < td ? 'late' : f.next_at === td ? 'now' : ''}" data-fam="${f.family_id}"><b>${esc(f.guardian)}</b> <span class="pill ${f.next_at <= td ? 'bad' : 'gold'}">${f.next_at < td ? 'متأخرة · ' : f.next_at === td ? 'اليوم · ' : ''}${esc(fmtD(f.next_at))}</span>
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
      <td>${a.stage === 'test' ? (a.attempt && a.attempt.status === 'started' ? '<span class="pill gold">⏳ يؤدي الاختبار الآن</span>' : a.attempt && a.attempt.status === 'open' ? '<span class="pill">🔗 الرابط مفتوح</span>' : '<span class="pill gold">بانتظار النتيجة</span>') : `<span class="pill ${a.stage === 'failed' ? 'bad' : 'ok'}">${esc(SL(a.stage))}</span> ${a.test_score != null ? esc(a.test_score) : ''}`}</td>
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

  /* =================== المقابلات =================== */
  async function interviewsView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('adm_interviews'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const wait = L.filter((a) => a.stage === 'interview'), done = L.filter((a) => a.stage !== 'interview');
    const row = (a) => `<div class="glass xc"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b>${a.gender === 'f' ? '👧' : '👦'} ${esc(a.name)}</b><span class="hint">${esc(a.grade || '')}</span>
        ${a.interview_decision ? `<span class="pill ${a.interview_decision === 'approved' ? 'ok' : 'bad'}">${a.interview_decision === 'approved' ? '👍 وافق' : '✋ لم يوافق'}</span>` : '<span class="pill gold">⏳ بانتظار القرار</span>'}</div>
      <div class="hint">🤝 ${esc(fmt(a.interview_at))}${a.interviewer ? ' — ' + esc(a.interviewer) : ''} · 👤 ولي الأمر: ${esc(a.guardian)}${a.current_school ? ' · 🏫 من: ' + esc(a.current_school) : ''}</div>
      <div>📝 اختبار القبول: ${a.attempt && a.attempt.status === 'submitted' ? `<b>${esc(a.attempt.pct)}%</b> — ${esc(a.attempt.exam)} <a href="#" data-det="${a.attempt.id}">📄 الإجابات</a>` : a.test_score != null ? `<b>${esc(a.test_score)}</b>` : '—'}${a.test_notes && !(a.attempt && a.attempt.status === 'submitted') ? ' — ' + esc(a.test_notes) : ''}</div>
      ${a.interview_notes ? `<div>🗒️ ${esc(a.interview_notes)}</div>` : ''}
      <div class="acts">${a.can_decide ? `<button class="btn sm ${a.stage === 'interview' ? 'primary' : ''}" data-dec="${a.id}">${a.stage === 'interview' ? '🤝 تسجيل القرار' : '✏️ تعديل القرار'}</button>` : ''}${CONTACT ? ` <button class="btn sm" data-fam="${a.family_id}">📂 ملف الأسرة</button>` : ''}</div></div>`;
    view.innerHTML = `<p class="hint">مقابلة مدير المرحلة خطوة إلزامية بعد اجتياز اختبار القبول، ولا يُوقَّع العقد إلا بموافقته.</p>
      <h3>⏳ بانتظار المقابلة/القرار (${wait.length})</h3>${wait.map(row).join('') || '<div class="empty">لا مقابلات معلّقة.</div>'}
      ${done.length ? `<h3>✅ قرارات آخر 30 يومًا (${done.length})</h3>${done.map(row).join('')}` : ''}`;
    view.onclick = async (e) => {
      const dt = e.target.closest('[data-det]'); if (dt) { e.preventDefault(); attemptDetail(+dt.dataset.det); return; }
      const d = e.target.closest('[data-dec]'); if (d) { if (await decideForm(L.find((a) => a.id === +d.dataset.dec))) interviewsView(); return; }
      const f = e.target.closest('[data-fam]'); if (f) openFamily(+f.dataset.fam, interviewsView);
    };
  }

  /* =================== بنك اختبارات القبول الإلكترونية =================== */
  const QT = { mcq: '🔘 اختيار من متعدد', tf: '✔️ صح أو خطأ', multi: '☑️ أكثر من إجابة', short: '✍️ إجابة قصيرة' };
  async function examsView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { EXAMS = null; L = await loadExams(); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const gname = (ids) => ids.length ? ids.map((i) => (GR.find((g) => g.id === i) || {}).name || i).join('، ') : 'كل الصفوف';
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center"><button class="btn primary sm" id="ne">＋ اختبار قبول جديد</button><span style="flex:1"></span>
        <span class="hint">اختبار لكل صف أو مجموعة صفوف — يُصحَّح آليًا</span></div>
      ${L.map((e) => `<div class="glass xc ${e.active ? '' : 'off'}" style="${e.active ? '' : 'opacity:.6'}"><b>${esc(e.title)}</b> ${e.active ? '' : '<span class="pill">مؤرشف</span>'}
        <div class="hint">🎯 ${esc(gname(e.grade_ids))} · ${e.n} سؤال (${e.total} درجة) · ⏱️ ${e.duration_min} دقيقة · النجاح ${e.pass_pct}%${e.attempts ? ` · أدّاه ${e.attempts} طالب (المتوسط ${e.avg}%)` : ''}</div>
        <div class="acts"><button class="btn sm" data-ed="${e.id}">✏️ تعديل</button><button class="btn sm" data-pv="${e.id}">👁️ معاينة</button><button class="btn sm" data-cp="${e.id}">📄 نسخة</button><button class="btn sm danger" data-del="${e.id}">🗑️</button></div></div>`).join('')
        || '<div class="empty">لا توجد اختبارات بعد — أنشئ اختبار القبول الأول لكل صف أو مرحلة.</div>'}`;
    view.onclick = async (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.id === 'ne') return examEditor({ title: '', grade_ids: [], duration_min: 40, pass_pct: CFG.pass ?? 60, shuffle: true, active: true, questions: [] });
      const e = L.find((x) => x.id === +(b.dataset.ed || b.dataset.pv || b.dataset.cp || b.dataset.del));
      if (b.dataset.ed) return examEditor(JSON.parse(JSON.stringify(e)));
      if (b.dataset.cp) return examEditor(Object.assign(JSON.parse(JSON.stringify(e)), { id: '', title: e.title + ' (نسخة)' }));
      if (b.dataset.pv) return modal({ title: '👁️ ' + e.title, wide: true, body: (e.questions || []).map((q, i) => `<div class="lg"><b>${i + 1}.</b> ${esc(q.body)} <span class="pill">${q.points}</span>
          <div class="hint">${q.type === 'short' ? 'الإجابة: ' + esc(q.answer) : q.options.map((o) => (o.ok ? '✅ ' : '▫️ ') + esc(o.t)).join(' · ')}</div></div>`).join(''), actions: [{ label: 'إغلاق', value: null }] });
      if (b.dataset.del) { if (!await confirmBox(`حذف «${e.title}»؟ (إن كان طلاب قد أدّوه فسيُؤرشف بدل الحذف)`, 'نعم')) return;
        try { const r = await call('adm_exam_delete', { p_id: e.id }); toast(r.archived ? 'أُرشف الاختبار' : 'تم الحذف'); examsView(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function examEditor(E) {
    const box = document.createElement('div');
    const uid = () => 'q' + Math.random().toString(36).slice(2, 8);
    const qHtml = (q, i) => `<div class="glass qe" data-i="${i}" style="padding:10px;margin:8px 0">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><b>${i + 1}.</b><select data-f="type">${opts(Object.entries(QT), q.type)}</select>
          <label class="hint">الدرجة <input type="number" data-f="points" min="0.5" max="100" step="0.5" value="${q.points ?? 1}" style="width:70px"></label><span style="flex:1"></span>
          <button class="btn sm" data-qm="up" title="أعلى">▲</button><button class="btn sm" data-qm="down" title="أسفل">▼</button><button class="btn sm danger" data-qm="del">🗑️</button></div>
        <textarea data-f="body" rows="2" placeholder="نص السؤال" style="width:100%;margin-top:6px">${esc(q.body || '')}</textarea>
        ${q.type === 'short' ? `<label class="f">الإجابة الصحيحة (لأكثر من صيغة افصل بـ | مثل: الرياض|رياض)<input data-f="answer" value="${esc(q.answer || '')}"></label>`
          : `<div>${(q.options || []).map((o, j) => `<div style="display:flex;gap:6px;align-items:center;margin:4px 0"><input type="${q.type === 'multi' ? 'checkbox' : 'radio'}" name="ok${i}" data-ok="${j}" ${o.ok ? 'checked' : ''} title="الإجابة الصحيحة">
              <input data-opt="${j}" value="${esc(o.t || '')}" style="flex:1" ${q.type === 'tf' ? 'readonly' : ''}>${q.type === 'tf' ? '' : `<button class="btn sm" data-rmopt="${j}">✕</button>`}</div>`).join('')}
            ${q.type === 'tf' ? '' : '<button class="btn sm" data-addopt="1">＋ خيار</button>'}<span class="hint"> — علّم الإجابة الصحيحة</span></div>`}</div>`;
    const read = () => { E.title = val(box, '#et'); E.duration_min = +$('#ed', box).value; E.pass_pct = +$('#ep', box).value; E.instructions = val(box, '#ei');
      E.shuffle = $('#es', box).checked; E.active = $('#ea', box).checked; E.grade_ids = $$('[data-g]:checked', box).map((c) => +c.dataset.g);
      $$('.qe', box).forEach((el) => { const q = E.questions[+el.dataset.i]; q.type = $('[data-f=type]', el).value; q.points = +$('[data-f=points]', el).value || 1; q.body = $('[data-f=body]', el).value;
        if ($('[data-f=answer]', el)) q.answer = $('[data-f=answer]', el).value;
        if ($$('[data-opt]', el).length) q.options = $$('[data-opt]', el).map((o, j) => ({ t: o.value, ok: !!($(`[data-ok="${j}"]`, el) || {}).checked })); }); };
    const fix = (q) => { if (q.type === 'tf') { const ok = (q.options || []).findIndex((o) => o.ok); q.options = [{ t: 'صح', ok: ok !== 1 }, { t: 'خطأ', ok: ok === 1 }]; }
      else if (q.type !== 'short' && (!q.options || q.options.length < 2)) q.options = [{ t: '', ok: true }, { t: '', ok: false }, { t: '', ok: false }, { t: '', ok: false }]; return q; };
    const paintQ = () => { $('#qs', box).innerHTML = E.questions.map((q, i) => qHtml(fix(q), i)).join('') || '<div class="empty">أضف الأسئلة.</div>';
      const tot = E.questions.reduce((a, q) => a + (+q.points || 1), 0); $('#qn', box).textContent = `${E.questions.length} سؤال — ${tot} درجة`; };
    box.innerHTML = `<div class="form-grid"><label class="f">عنوان الاختبار<input id="et" value="${esc(E.title)}" placeholder="مثال: اختبار القبول — الصف الرابع"></label>
        <label class="f">المدة (دقيقة)<input type="number" id="ed" min="5" max="240" value="${E.duration_min}"></label><label class="f">درجة النجاح %<input type="number" id="ep" min="0" max="100" value="${E.pass_pct}"></label></div>
      <details ${E.grade_ids.length ? 'open' : ''}><summary><b>🎯 الصفوف</b> <span class="hint">(اتركها فارغة ليصلح لكل الصفوف)</span></summary><div style="columns:3 180px">${GR.map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" ${E.grade_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div></details>
      <label class="f">تعليمات تظهر للطالب قبل البدء<textarea id="ei" rows="2">${esc(E.instructions || '')}</textarea></label>
      <label class="chk"><input type="checkbox" id="es" ${E.shuffle ? 'checked' : ''}> ترتيب عشوائي للأسئلة لكل طالب</label><label class="chk"><input type="checkbox" id="ea" ${E.active ? 'checked' : ''}> متاح للاستخدام</label>
      <h4 style="margin-bottom:0">❓ الأسئلة <span class="hint" id="qn"></span></h4><div id="qs"></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${Object.entries(QT).map(([k, l]) => `<button class="btn sm" data-addq="${k}">＋ ${l}</button>`).join('')}<button class="btn sm" id="imp">📥 من بنك الأسئلة</button></div>`;
    paintQ();
    box.addEventListener('click', async (e) => {
      const b = e.target.closest('button'); if (!b) return; e.preventDefault();
      if (b.dataset.addq) { read(); E.questions.push({ id: uid(), type: b.dataset.addq, points: 1, body: '', answer: '' }); paintQ(); $$('.qe', box).pop().querySelector('textarea').focus(); return; }
      if (b.id === 'imp') { read(); await importQb(E); paintQ(); return; }
      const el = b.closest('.qe'); if (!el) return; read(); const i = +el.dataset.i, q = E.questions[i];
      if (b.dataset.qm === 'del') E.questions.splice(i, 1);
      if (b.dataset.qm === 'up' && i) E.questions.splice(i - 1, 0, E.questions.splice(i, 1)[0]);
      if (b.dataset.qm === 'down' && i < E.questions.length - 1) E.questions.splice(i + 1, 0, E.questions.splice(i, 1)[0]);
      if (b.dataset.addopt) q.options.push({ t: '', ok: false });
      if (b.dataset.rmopt && q.options.length > 2) q.options.splice(+b.dataset.rmopt, 1);
      paintQ();
    });
    box.addEventListener('change', (e) => { if (e.target.dataset.f === 'type') { read(); const q = E.questions[+e.target.closest('.qe').dataset.i]; q.options = null; paintQ(); } });
    modal({ title: E.id ? '✏️ ' + E.title : '＋ اختبار قبول جديد', wide: true, body: box, actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ الاختبار', cls: 'primary', onClick: async () => {
      read(); await call('adm_exam_save', { p: E }); toast('تم حفظ الاختبار ✓'); EXAMS = null; examsView(); return true; } }] });
  }
  async function importQb(E) {
    let D; try { D = await call('adm_qb_search', { p_subject: null, p_grade: null, p_q: '' }); } catch (e) { toast(errMsg(e), 'err'); return; }
    if (!D.subjects.length) { toast('بنك الأسئلة لا يحتوي أسئلة ذاتية التصحيح بعد', 'warn'); return; }
    const box = document.createElement('div'); let items = [];
    box.innerHTML = `<div style="display:flex;gap:6px;flex-wrap:wrap"><select id="qs1">${opts(D.subjects.map((x) => [x.id, x.name]), '', '— المادة —')}</select>
      <input type="number" id="qg" min="1" max="12" placeholder="رقم الصف" style="width:100px"><input id="qq" placeholder="بحث في نص السؤال" style="flex:1"><button class="btn sm" id="qgo">بحث</button></div>
      <div id="qr" class="hint" style="margin-top:8px">اختر المادة.</div>`;
    const search = async () => { if (!$('#qs1', box).value) return;
      const r = await call('adm_qb_search', { p_subject: +$('#qs1', box).value, p_grade: $('#qg', box).value ? +$('#qg', box).value : null, p_q: val(box, '#qq') }); items = r.items;
      $('#qr', box).innerHTML = items.length ? `<label class="chk"><input type="checkbox" id="qall"> تحديد الكل (${items.length})</label>` + items.map((q, i) => `<label class="chk" style="align-items:flex-start"><input type="checkbox" data-qi="${i}">
        <span>${esc(q.body)} <span class="hint">· ${esc(QT[q.type] || q.type)}${q.grade ? ' · صف ' + q.grade : ''}${q.topic ? ' · ' + esc(q.topic) : ''}</span></span></label>`).join('') : 'لا نتائج.';
      const all = $('#qall', box); if (all) all.onchange = () => $$('[data-qi]', box).forEach((c) => { c.checked = all.checked; }); };
    $('#qgo', box).onclick = search; $('#qs1', box).onchange = search;
    await modal({ title: '📥 استيراد من بنك الأسئلة', wide: true, body: box, actions: [{ label: 'إلغاء', value: null }, { label: 'إضافة المحدد', cls: 'primary', onClick: () => {
      const pick = $$('[data-qi]:checked', box).map((c) => items[+c.dataset.qi]);
      pick.forEach((q) => E.questions.push({ id: 'b' + q.id, type: q.type, body: q.body, points: +q.points || 1, answer: q.answer || '',
        options: (q.options || []).map((o) => ({ t: o.t, ok: !!o.ok })) }));
      toast(`أُضيف ${pick.length} سؤال`); return true; } }] });
  }

  /* =================== التقارير =================== */
  async function statsView() {
    const y = new Date(); const from0 = sessionStorage.getItem('adm_from') || `${y.getMonth() >= 7 ? y.getFullYear() : y.getFullYear() - 1}-08-01`;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">من <input type="date" id="sf" value="${from0}"> إلى <input type="date" id="st" value="${today()}">
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
            + `<p class="hint">لم يجتز الاختبار: ${S.failed} · لم يوافق مدير المرحلة: ${S.rejected || 0} · لم يكمل: ${S.lost}</p>`)}
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
