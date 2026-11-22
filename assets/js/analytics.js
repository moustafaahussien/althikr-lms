/* =====================================================================
   التحليل والمقارنة: مؤشرات الواجبات والاختبارات لكل (فصل × مادة)
   الدوال: an_overview / an_questions (sql/39)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (ctx.profile.role === 'student' || ctx.profile.role === 'parent') { view.innerHTML = '<div class="notice">هذه الصفحة للمعلمين والإدارة.</div>'; $('#flt').hidden = true; return; }

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const gradeOf = (label) => String(label || '').split(' / ')[0];
  const secOf = (label) => String(label || '').split(' / ')[1] || label;
  const mean = (a) => { const v = a.filter((x) => x != null).map(Number); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length * 10) / 10 : null; };
  const cls = (p) => (p == null ? '' : p >= 75 ? '' : p >= 60 ? 'c' : 'd');
  const pv = (p) => (p == null ? '—' : `${p}%`);

  const today = new Date(), from = new Date(); from.setDate(from.getDate() - 120);
  $('#fFrom').value = ymd(from); $('#fTo').value = ymd(today);
  let ROWS = [], METRIC = 'ex_avg';
  const MET = { ex_avg: 'متوسط الاختبارات', hw_avg: 'متوسط الواجبات', hw_rate: 'نسبة تسليم الواجبات', ex_rate: 'نسبة أداء الاختبارات' };

  async function load() {
    view.innerHTML = '<div class="empty">جارٍ التحليل…</div>';
    try { ROWS = await call('an_overview', { p_from: $('#fFrom').value || null, p_to: $('#fTo').value || null }); }
    catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!ROWS.length) { view.innerHTML = '<div class="empty">لا توجد مقررات مسندة إليك أو لمعلميك.</div>'; return; }
    // خيارات الفلاتر من البيانات
    const keep = (sel, opts) => { const v = sel.value; sel.innerHTML = sel.options[0].outerHTML + opts; sel.value = [...sel.options].some((o) => o.value === v) ? v : ''; };
    keep($('#fGrade'), [...new Set(ROWS.map((r) => gradeOf(r.class)))].map((g) => `<option>${esc(g)}</option>`).join(''));
    keep($('#fSubj'), [...new Map(ROWS.map((r) => [r.subject_id, r.subject])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar')).map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join(''));
    $('#fMineL').hidden = !(ROWS.some((r) => r.mine) && ROWS.some((r) => !r.mine));
    paint();
  }
  ['fGrade', 'fSubj', 'fMine'].forEach((id) => { $('#' + id).onchange = paint; });
  $('#fGo').onclick = load;

  function filtered() {
    const g = $('#fGrade').value, s = +$('#fSubj').value || null, mine = $('#fMine').checked;
    return ROWS.filter((r) => (!g || gradeOf(r.class) === g) && (!s || r.subject_id === s) && (!mine || r.mine));
  }

  // تجميع حسب مفتاح مع متوسطات
  function group(R, keyFn) {
    const m = new Map();
    R.forEach((r) => { (Array.isArray(keyFn(r)) ? keyFn(r) : [keyFn(r)]).forEach((k) => { if (!m.has(k)) m.set(k, []); m.get(k).push(r); }); });
    return [...m.entries()].map(([k, L]) => ({ k, n: L.length, hw_n: L.reduce((a, r) => a + r.hw_n, 0), ex_n: L.reduce((a, r) => a + r.ex_n, 0),
      ex_avg: mean(L.map((r) => r.ex_avg)), hw_avg: mean(L.map((r) => r.hw_avg)), hw_rate: mean(L.map((r) => r.hw_rate)), ex_rate: mean(L.map((r) => r.ex_rate)) }));
  }
  const bars = (G, lbl) => { const L = G.filter((x) => x[METRIC] != null).sort((a, b) => b[METRIC] - a[METRIC]);
    const none = G.length - L.length;
    return (L.map((x) => `<div class="bar"><span class="lbl" title="${esc(x.k)}">${lbl ? lbl(x) : esc(x.k)}</span><span class="trk"><i class="${cls(x[METRIC])}" style="width:${Math.max(2, Math.min(100, x[METRIC]))}%"></i></span><span class="v">${pv(x[METRIC])}</span></div>`).join('')
      || '<div class="empty">لا توجد بيانات لهذا المؤشر في الفترة المحددة.</div>') + (none && L.length ? `<small class="hint">${none} بلا بيانات</small>` : ''); };

  function paint() {
    const R = filtered();
    const size = R.reduce((a, r) => a + r.size, 0);
    const hwN = R.reduce((a, r) => a + r.hw_n, 0), exN = R.reduce((a, r) => a + r.ex_n, 0);
    const subj = +$('#fSubj').value || null, grade = $('#fGrade').value;
    const byClass = group(R, (r) => (subj ? r.class : r.class)).map((x) => x);
    const byTeacher = group(R, (r) => r.teachers || []);
    const bySubject = group(R, (r) => r.subject);
    view.innerHTML = `
      ${!size ? '<div class="notice">تنبيه: لا يوجد طلاب مربوطون بفصولهم في المنصة بعد، لذلك نسب التسليم والأداء لن تظهر حتى يُربطوا (الإدارة ← استيراد توزيع الطلاب على الفصول).</div>' : ''}
      <div class="kpis">
        <div class="kpi glass"><small>المقررات (فصل × مادة)</small><b>${R.length}</b></div>
        <div class="kpi glass"><small>الواجبات المنشورة</small><b>${hwN}</b></div>
        <div class="kpi glass"><small>الاختبارات الإلكترونية</small><b>${exN}</b></div>
        <div class="kpi glass"><small>نسبة تسليم الواجبات</small><b>${pv(mean(R.map((r) => r.hw_rate)))}</b></div>
        <div class="kpi glass"><small>متوسط الاختبارات</small><b>${pv(mean(R.map((r) => r.ex_avg)))}</b></div>
        <div class="kpi glass"><small>متوسط الواجبات</small><b>${pv(mean(R.map((r) => r.hw_avg)))}</b></div>
      </div>
      <div class="toolbar"><span class="hint grow">المؤشر في المقارنات:</span><div class="seg" id="met">${Object.entries(MET).map(([k, v]) => `<button data-m="${k}" class="${k === METRIC ? 'on' : ''}">${v}</button>`).join('')}</div></div>
      <div class="two">
        <section class="bars glass"><h3 class="sec-h" style="margin-top:0">مقارنة الفصول${subj ? '' : ' <small class="hint">(اختر مادة لمقارنة أدق)</small>'}</h3>
          ${bars(byClass, (x) => grade ? esc(secOf(x.k)) : esc(x.k))}</section>
        <section class="bars glass"><h3 class="sec-h" style="margin-top:0">مقارنة المعلمين</h3>${bars(byTeacher)}</section>
        ${subj ? '' : `<section class="bars glass"><h3 class="sec-h" style="margin-top:0">مقارنة المواد</h3>${bars(bySubject)}</section>`}
        ${subj ? '<section class="glass" style="padding:10px 14px"><h3 class="sec-h" style="margin-top:0">أصعب الأسئلة في المادة</h3><div id="hq"><div class="empty">جارٍ التحميل…</div></div></section>'
          : '<section class="glass" style="padding:10px 14px"><h3 class="sec-h" style="margin-top:0">أصعب الأسئلة</h3><div class="empty">اختر مادة من الفلاتر لعرض الأسئلة الأقل إجابة صحيحة.</div></section>'}
      </div>
      <h3 class="sec-h">التفاصيل</h3>
      <div class="table-wrap"><table id="fullT"><thead><tr><th>الفصل</th><th>المادة</th><th>المعلم</th><th>الطلاب</th><th>الواجبات</th><th>تسليم الواجبات</th><th>متوسط الواجبات</th><th>الاختبارات</th><th>أداء الاختبارات</th><th>متوسط الاختبارات</th></tr></thead><tbody>
        ${R.map((r) => `<tr><td>${esc(r.class)}</td><td>${esc(r.subject)}</td><td>${esc((r.teachers || []).join('، '))}</td><td>${r.size}</td><td>${r.hw_n}</td><td>${pv(r.hw_rate)}</td><td>${pv(r.hw_avg)}</td>
          <td>${r.ex_n}</td><td>${pv(r.ex_rate)}</td><td>${pv(r.ex_avg)}</td></tr>`).join('')}</tbody></table></div>`;
    $('#met').onclick = (e) => { const b = e.target.closest('[data-m]'); if (b) { METRIC = b.dataset.m; paint(); } };
    if (subj) call('an_questions', { p_subject: subj, p_from: $('#fFrom').value || null, p_to: $('#fTo').value || null }).then((Q) => {
      $('#hq').innerHTML = Q.length ? Q.slice(0, 15).map((q) => `<div class="hq"><p>${esc(q.body)}</p><small class="hint">${esc(q.exam)} · ${esc(q.teacher || '')} · أجاب ${q.n} طالب</small>
        <div class="bar" style="grid-template-columns:1fr 54px"><span class="trk"><i class="${cls(+q.rate)}" style="width:${Math.max(2, +q.rate)}%"></i></span><span class="v">${q.rate}%</span></div></div>`).join('')
        : '<div class="empty">لا توجد اختبارات إلكترونية بإجابات كافية (3 طلاب على الأقل لكل سؤال) في هذه الفترة.</div>';
    }).catch((e) => { $('#hq').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; });
  }

  load();
})();
