/* =====================================================================
   دليل الطلاب (للإداريين فقط): البحث والتصفية وملف الطالب الكامل
   الدوال: sd_list / sd_get (sql/44)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, errMsg, requireAuth } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const ROLES = ['admin', 'leadership', 'principal', 'staff'];
  if (!ROLES.includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">دليل الطلاب متاح للإداريين فقط.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const PAGE = 60;
  const F = { q: '', stage: '', grade: '', cls: '', flag: '', off: 0 };
  let META = null, timer = null;
  const ini = (n) => esc(String(n || '؟').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' '));
  const d = (x) => (x ? new Date(String(x).length === 10 ? x + 'T12:00:00' : x).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
  const ST = { absent: ['غائب', 'bad'], late: ['متأخر', 'warn'], excused: ['غياب بعذر', ''] };

  window.addEventListener('hashchange', route);
  route();
  function route() { const m = /s=([0-9a-f-]{36})/.exec(location.hash); if (m) openStudent(m[1]); else listView(); }

  // ---------------- القائمة ----------------
  async function listView() {
    view.innerHTML = `<div class="sd-bar glass">
        <label class="f grow">بحث<input id="q" type="search" placeholder="اسم الطالب أو رقمه أو رقم الهوية…" value="${esc(F.q)}"></label>
        <label class="f">المرحلة<select id="fs"><option value="">الكل</option></select></label>
        <label class="f">الصف<select id="fg"><option value="">الكل</option></select></label>
        <label class="f">الفصل<select id="fc"><option value="">الكل</option></select></label></div>
      <div class="chips" id="flags">${[['', 'الكل'], ['absent', '⚠️ غياب متكرر (3+ في 30 يومًا)'], ['noclass', 'بدون فصل'], ['noguardian', 'بدون ولي أمر'], ['inactive', 'حسابات موقوفة']]
        .map(([k, t]) => `<button data-f="${k}" class="${F.flag === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div id="sum" class="hint"></div><div id="res"><div class="empty">جارٍ التحميل…</div></div>`;
    $('#q').oninput = () => { clearTimeout(timer); timer = setTimeout(() => { F.q = $('#q').value.trim(); F.off = 0; load(); }, 300); };
    $('#fs').onchange = () => { F.stage = $('#fs').value; F.grade = ''; F.cls = ''; F.off = 0; fillSel(); load(); };
    $('#fg').onchange = () => { F.grade = $('#fg').value; F.cls = ''; F.off = 0; fillSel(); load(); };
    $('#fc').onchange = () => { F.cls = $('#fc').value; F.off = 0; load(); };
    $('#flags').onclick = (e) => { const b = e.target.closest('[data-f]'); if (!b) return; F.flag = b.dataset.f; F.off = 0;
      $$('#flags button').forEach((x) => x.classList.toggle('on', x === b)); load(); };
    if (META) fillSel();
    load();
  }
  function fillSel() {
    const f = META; if (!f) return;
    const opt = (L, v) => '<option value="">الكل</option>' + (L || []).map((x) => `<option value="${x.id}" ${String(x.id) === String(v) ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
    $('#fs').innerHTML = opt(f.stages, F.stage);
    $('#fg').innerHTML = opt((f.grades || []).filter((g) => !F.stage || String(g.stage) === F.stage), F.grade);
    $('#fc').innerHTML = opt((f.classes || []).filter((c) => (!F.grade || String(c.grade) === F.grade) && (F.grade || F.stage === '' ? true : (f.grades || []).some((g) => g.id === c.grade && String(g.stage) === F.stage)))
      .map((c) => ({ id: c.id, name: (F.grade ? '' : ((f.grades || []).find((g) => g.id === c.grade) || {}).name + ' / ') + c.name })), F.cls);
  }
  async function load() {
    const res = $('#res'); if (!res) return;
    let D;
    try { D = await call('sd_list', { p_q: F.q || null, p_stage: F.stage ? +F.stage : null, p_grade: F.grade ? +F.grade : null, p_class: F.cls ? +F.cls : null,
      p_flag: F.flag || null, p_limit: PAGE, p_offset: F.off }); }
    catch (e) { res.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!META) { META = D.filters; fillSel(); }
    $('#sum').innerHTML = `<b>${D.total}</b> طالب${F.q || F.stage || F.flag ? ' مطابق' : ''} من ${D.summary.all}${D.summary.noclass ? ` — <span style="color:#a3244a">${D.summary.noclass} بدون فصل</span>` : ''}`;
    res.innerHTML = D.rows.length ? `<div class="sl">${D.rows.map((s) => `<button class="st ${s.active ? '' : 'off'}" data-s="${s.id}"><span class="av">${ini(s.name)}</span>
        <span><b>${esc(s.name)}</b><small>${esc(s.grade)} ${esc(s.stage)}${s.class ? ' / ' + esc(s.class) : ' — <span class="ab">بدون فصل</span>'}</small>
        <small>رقم ${esc(s.number)}${s.absent30 ? ` · <span class="ab">${s.absent30} غياب (30 يومًا)</span>` : ''}</small></span></button>`).join('')}</div>
      <div class="toolbar" style="justify-content:center;margin-top:10px">${F.off > 0 ? '<button class="btn sm" id="prev">→ السابق</button>' : ''}
        <span class="hint">${F.off + 1}–${F.off + D.rows.length} من ${D.total}</span>${F.off + PAGE < D.total ? '<button class="btn sm" id="next">التالي ←</button>' : ''}</div>`
      : '<div class="empty">لا يوجد طلاب مطابقون.</div>';
    res.onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) location.hash = 's=' + b.dataset.s; };
    if ($('#prev')) $('#prev').onclick = () => { F.off = Math.max(0, F.off - PAGE); load(); };
    if ($('#next')) $('#next').onclick = () => { F.off += PAGE; load(); };
  }

  // ---------------- ملف الطالب ----------------
  async function openStudent(id) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>'; scrollTo(0, 0);
    let D; try { D = await call('sd_get', { p_id: id }); }
    catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div><a class="btn ghost" href="#">→ دليل الطلاب</a>`; return; }
    const I = D.info, A = D.attendance, H = D.homework, P = D.private;
    const rate = A.days_taken ? Math.round(100 * (A.days_taken - A.absent) / A.days_taken) : null;
    const gAvg = D.grades.filter((g) => g.pct != null); const avg = gAvg.length ? Math.round(gAvg.reduce((a, g) => a + Number(g.pct), 0) / gAvg.length) : null;
    const exDone = D.exams.filter((e) => e.status === 'done' && e.max);
    const exAvg = exDone.length ? Math.round(100 * exDone.reduce((a, e) => a + e.score / e.max, 0) / exDone.length) : null;
    const dl = (rows) => `<div class="dl">${rows.filter((r) => r).map(([k, v]) => `<div><span>${esc(k)}</span>${v == null || v === '' ? '—' : v}</div>`).join('')}</div>`;
    const tbl = (head, rows, empty) => rows.length ? `<div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="empty">${empty}</div>`;

    view.innerHTML = `<div class="toolbar no-print" style="margin-bottom:8px"><a class="btn ghost sm" href="#">→ دليل الطلاب</a><span class="grow"></span>
        ${I.class_id ? `<a class="btn sm" href="classes.html#c=${I.class_id}">🏫 الفصل</a>` : ''}<a class="btn sm" href="portfolio.html#s=${I.id}">🏆 ملف الإنجاز</a><button class="btn sm" id="pr">🖨️ طباعة</button></div>
      <div id="sheet">
      <div class="card glass pf-head"><span class="av">${ini(I.name)}</span><div class="grow"><h2>${esc(I.name)}</h2>
        <div class="meta">${esc(I.grade)} ${esc(I.stage)}${I.class ? ' / ' + esc(I.class) : ' — بدون فصل'} · رقم الطالب <b dir="ltr">${esc(I.number)}</b>${I.active ? '' : ' · <span class="tag bad">الحساب موقوف</span>'}</div>
        <div class="meta">رائد الفصل: ${esc(I.homeroom || '—')}</div></div></div>
      <div class="kp"><div><b class="${rate != null && rate < 90 ? 'bad' : ''}">${rate == null ? '—' : rate + '%'}</b><small>نسبة الحضور</small></div>
        <div><b class="${A.absent >= 5 ? 'bad' : ''}">${A.absent}</b><small>أيام الغياب</small></div><div><b>${A.late}</b><small>التأخر</small></div>
        <div><b>${avg == null ? '—' : avg + '%'}</b><small>متوسط الدرجات</small></div>
        <div><b class="${H.missing ? 'bad' : ''}">${H.submitted}/${H.assigned}</b><small>الواجبات المسلّمة</small></div>
        <div><b>${exAvg == null ? '—' : exAvg + '%'}</b><small>متوسط الاختبارات</small></div>
        <div><b>${D.portfolio.filter((x) => x.status === 'approved').length}</b><small>إنجازات معتمدة</small></div></div>

      <section class="card glass sec"><h3>👤 البيانات الأساسية</h3>${dl([['الاسم', esc(I.name)], ['رقم الطالب', `<span dir="ltr">${esc(I.number)}</span>`], ['المرحلة', esc(I.stage)], ['الصف', esc(I.grade)],
        ['الفصل', esc(I.class || 'بدون فصل')], ['المسار', esc({ arabic: 'عربي', american: 'الدبلوم الأمريكي', english: 'إنجليزي' }[I.track] || I.track || '')], ['البريد', I.email ? `<span dir="ltr">${esc(I.email)}</span>` : ''],
        P && D.can_private ? ['رقم الهوية / الإقامة', `<span dir="ltr">${esc(P.national_id)}</span>`] : null, P ? ['الجنسية', esc(P.nationality || '')] : null,
        P ? ['تاريخ الميلاد', P.dob ? d(P.dob) : ''] : null, ['ملاحظات', esc(I.notes || '')]])}</section>

      <section class="card glass sec"><h3>👨‍👩‍👦 أولياء الأمور والإخوة</h3>
        ${dl([['ولي الأمر (من التسجيل)', esc(I.guardian_name || '')], ['جوال ولي الأمر', I.guardian_phone ? `<a dir="ltr" href="tel:${esc(I.guardian_phone)}">${esc(I.guardian_phone)}</a>` : ''],
          P ? ['بريد ولي الأمر', P.parent_email ? `<span dir="ltr">${esc(P.parent_email)}</span>` : ''] : null])}
        ${D.guardians.length ? `<div style="margin-top:8px">${D.guardians.map((g) => `<div>• ${esc(g.name || 'ولي أمر')} ${g.phone ? `<a dir="ltr" href="tel:+${esc(g.phone)}">+${esc(g.phone)}</a>` : g.email ? `<span dir="ltr">${esc(g.email)}</span>` : ''}
            ${g.kind === 'pin' ? (g.active ? `<span class="tag">مفعّل على بوابة أولياء الأمور</span>${g.last_login ? ` <span class="hint">آخر دخول ${d(g.last_login)}</span>` : ''}` : '<span class="tag warn">لم يفعّل الدخول بعد</span>') : `<span class="tag">حساب ولي أمر${g.relation ? ' — ' + esc(g.relation) : ''}</span>`}</div>`).join('')}</div>` : '<p class="hint">لا يوجد ولي أمر مرتبط بالطالب على المنصة.</p>'}
        ${D.siblings.length ? `<p style="margin:8px 0 0"><b>الإخوة في المدرسة:</b> ${D.siblings.map((x) => `<a href="#s=${x.id}">${esc(x.name)}</a> <span class="hint">(${esc(x.class || '—')})</span>`).join('، ')}</p>` : ''}</section>

      <section class="card glass sec"><h3>📅 الحضور والغياب <span class="hint">منذ ${d(A.from)}</span></h3>
        <div class="dl"><div><span>أيام سُجّل فيها الحضور</span>${A.days_taken}</div><div><span>غياب</span>${A.absent}</div><div><span>تأخر</span>${A.late}</div><div><span>غياب بعذر</span>${A.excused}</div><div><span>غياب عن حصص</span>${A.period_absent}</div></div>
        ${rate != null ? `<div class="bar" style="margin-top:8px"><i style="width:${rate}%"></i></div>` : ''}
        ${tbl(['التاريخ', 'الحصة', 'الحالة', 'ملاحظة'], A.marks.slice(0, 60).map((m) => `<tr><td>${d(m.d)}</td><td>${m.p ? 'الحصة ' + m.p : 'اليوم الدراسي'}</td><td><span class="tag ${(ST[m.s] || [])[1] || ''}">${(ST[m.s] || [m.s])[0]}</span></td><td>${esc(m.n || '')}</td></tr>`), 'لا يوجد غياب أو تأخر مسجّل ✓')}</section>

      <section class="card glass sec"><h3>🏅 الدرجات</h3>${tbl(['المادة', 'النسبة', 'الأعمدة المرصودة'], D.grades.map((g) => {
          const got = (g.columns || []).filter((c) => g.scores && g.scores[c.key] != null).length;
          return `<tr><td><b>${esc(g.subject)}</b></td><td>${g.pct == null ? '—' : `<b>${Math.round(g.pct)}%</b><div class="bar"><i style="width:${Math.min(100, g.pct)}%"></i></div>`}</td><td>${got} من ${(g.columns || []).length}</td></tr>`; }), 'لا توجد درجات مرصودة بعد')}</section>

      <section class="card glass sec"><h3>📝 الواجبات <span class="hint">${H.submitted} مسلّم · ${H.late} متأخر · ${H.missing} لم يُسلَّم</span></h3>
        ${tbl(['الواجب', 'المادة', 'التسليم', 'الحالة', 'الدرجة'], H.items.map((h) => `<tr><td>${esc(h.title)}</td><td>${esc(h.subject || '')}</td><td>${d(h.due)}</td>
          <td>${h.status === 'missing' ? '<span class="tag bad">لم يُسلَّم</span>' : h.status === 'open' ? '<span class="tag">مفتوح</span>' : `<span class="tag">${h.status === 'graded' ? 'مصحّح' : h.status === 'returned' ? 'مُعاد' : 'مسلّم'}</span>${h.late ? ' <span class="tag warn">متأخر</span>' : ''}`}</td>
          <td>${h.score == null ? '—' : `${h.score} / ${h.max}`}</td></tr>`), 'لا توجد واجبات لهذا الفصل')}</section>

      <section class="card glass sec"><h3>🧪 الاختبارات</h3>${tbl(['الاختبار', 'المادة', 'التاريخ', 'النتيجة'], D.exams.map((e) => `<tr><td>${esc(e.title)}</td><td>${esc(e.subject || '')}</td><td>${d(e.opens)}</td>
          <td>${e.status === 'done' ? `<b>${e.score ?? '—'} / ${e.max ?? '—'}</b>${e.review ? ' <span class="tag warn">بانتظار التصحيح</span>' : ''}` : e.status === 'missed' ? '<span class="tag bad">لم يختبر</span>' : e.status === 'started' ? '<span class="tag warn">بدأ ولم يسلّم</span>' : '<span class="tag">مفتوح</span>'}</td></tr>`), 'لا توجد اختبارات إلكترونية لهذا الفصل')}</section>

      <section class="card glass sec"><h3>🏆 الإنجازات</h3>${tbl(['الإنجاز', 'المستوى', 'النتيجة', 'التاريخ', 'الحالة'], D.portfolio.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc({ class: 'الفصل', school: 'المدرسة', district: 'إدارة التعليم', national: 'وطني', international: 'دولي' }[x.level] || '—')}</td>
          <td>${esc(x.result || '')}</td><td>${d(x.date)}</td><td>${x.status === 'approved' ? '<span class="tag">معتمد</span>' : x.status === 'rejected' ? '<span class="tag bad">مرفوض</span>' : '<span class="tag warn">بانتظار الاعتماد</span>'}</td></tr>`), 'لا توجد إنجازات مسجّلة')}</section>

      <section class="card glass sec"><h3>👩‍🏫 معلمو الطالب</h3>${D.teachers.length ? `<div class="dl">${D.teachers.map((t) => `<div><span>${esc(t.subject)}</span>${esc(t.teacher)}</div>`).join('')}</div>` : '<div class="empty">لا يوجد إسناد لفصل الطالب</div>'}</section>

      ${D.complaints.length ? `<section class="card glass sec"><h3>📮 الشكاوى والملاحظات المتعلقة بالطالب</h3>${tbl(['الموضوع', 'التصنيف', 'التاريخ', 'الحالة'], D.complaints.map((c) => `<tr><td>${esc(c.subject)}</td><td>${esc(c.category)}</td><td>${d(c.at)}</td>
          <td><span class="tag ${c.status === 'new' ? 'warn' : ''}">${esc({ new: 'جديدة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة' }[c.status] || c.status)}</span></td></tr>`), '')}</section>` : ''}
      </div>`;
    $('#pr').onclick = () => LMS.printHTML(`ملف الطالب: ${I.name}`, $('#sheet').innerHTML);
  }
})();
