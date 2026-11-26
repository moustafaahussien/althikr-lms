/* =====================================================================
   لوحة مؤشرات القيادة (sql/72)
   ===================================================================== */
(async function () {
  const { sb, esc, $, toast, errMsg, requireAuth } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (!['admin', 'leadership', 'principal'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 لوحة المؤشرات للقيادة ومديري المراحل.</div>'; return; }
  if (!LMS.betaAllowed('leadership', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  $('#tabs').style.display = 'none';
  const COLORS = ['#007B51', '#509BB9', '#b8860b', '#8e44ad', '#c0392b', '#2c3e50'];
  const iso = (d) => d.toISOString().slice(0, 10);
  const now = new Date();
  let F = iso(new Date(now.getFullYear(), now.getMonth(), 1)), T = iso(now);
  const pct = (v) => v == null ? '—' : v + '%';
  const cls = (v, good, bad, lowGood) => v == null ? '' : (lowGood ? (v <= good ? 'g' : v >= bad ? 'r' : 'y') : (v >= good ? 'g' : v <= bad ? 'r' : 'y'));

  async function load() {
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><label class="hint">من <input type="date" id="f" value="${F}"></label><label class="hint">إلى <input type="date" id="t" value="${T}"></label>
      <div class="seg"><button data-r="w">هذا الأسبوع</button><button data-r="m">هذا الشهر</button><button data-r="y">منذ بداية العام</button></div><span class="grow"></span><button class="btn sm ghost" id="prn">🖨️</button></div><div id="db"><div class="empty">جارٍ حساب المؤشرات…</div></div>`;
    $('#f').onchange = (e) => { F = e.target.value; load(); }; $('#t').onchange = (e) => { T = e.target.value; load(); };
    $('#prn').onclick = () => window.print();
    view.querySelectorAll('[data-r]').forEach((b) => { b.onclick = () => { const d = new Date();
      if (b.dataset.r === 'w') { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); F = iso(s); }
      if (b.dataset.r === 'm') F = iso(new Date(d.getFullYear(), d.getMonth(), 1));
      if (b.dataset.r === 'y') F = iso(new Date(d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1, 7, 15));
      T = iso(d); load(); }; });
    let D;
    try { const { data, error } = await sb.rpc('ld_dashboard', { p_from: F, p_to: T }); if (error) throw error; D = data; } catch (e) { $('#db').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const S = D.stages;
    const sum = (k) => S.reduce((a, s) => a + (s[k] || 0), 0);
    const card = (s) => `<div class="glass st-card"><h3>${esc(s.name)}</h3><div class="hint" style="margin-bottom:8px">${s.students} طالب · ${s.classes} فصل · ${s.teachers} معلم</div>
      <div class="kp">
        <div class="${cls(s.attendance, 95, 90)}"><b>${pct(s.attendance)}</b>الحضور</div><div class="${cls(s.late, 3, 8, true)}"><b>${pct(s.late)}</b>التأخر</div>
        <div class="${cls(s.lp ? Math.round(s.lp_ok / s.lp * 100) : null, 80, 50)}"><b>${s.lp_ok}/${s.lp}</b>تحضير معتمد</div>
        <div class="${cls(s.hw_rate, 85, 60)}"><b>${pct(s.hw_rate)}</b>تسليم الواجبات</div><div class="${cls(s.ex_avg, 75, 60)}"><b>${pct(s.ex_avg)}</b>متوسط الاختبارات</div>
        <div><b>${s.hw} / ${s.exams}</b>واجبات / اختبارات</div>
        <div class="g"><b>⭐ ${s.bh_pos}</b>سلوك إيجابي</div><div class="${s.bh_neg ? 'y' : ''}"><b>${s.bh_neg}</b>سلوك سلبي (${s.bh_ref} إحالة)</div><div class="${s.ew_open ? 'r' : ''}"><b>${s.ew_open}</b>حالات إنذار مبكر</div>
        <div class="${cls(s.sub_cov, 95, 80)}"><b>${pct(s.sub_cov)}</b>تغطية الانتظار (${s.sub_slots})</div><div><b>${s.trn_hours}</b>ساعة تدريب (${s.trn_people} معلم)</div>
        <div><b>${s.clinic} / ${s.loans}</b>عيادة / إعارات</div></div>
      ${s.complaints ? `<div class="hint" style="margin-top:6px">الشكاوى: ${s.complaints} (${s.complaints_open} مفتوحة)</div>` : ''}</div>`;
    // الاتجاه الأسبوعي للحضور (SVG بسيط)
    const wks = [...new Set(D.trend.map((x) => x.wk))].sort();
    let chart = '';
    if (wks.length > 1) {
      const W = 640, H = 180, P = 30, vals = D.trend.map((x) => +x.att).filter((x) => !isNaN(x)); const mn = Math.max(0, Math.min(...vals) - 2), mx = Math.min(100, Math.max(...vals) + 1);
      const X = (i) => P + i * (W - 2 * P) / (wks.length - 1), Y = (v) => H - P - (v - mn) / (mx - mn || 1) * (H - 2 * P);
      const lines = S.map((s, si) => { const pts = wks.map((w, i) => { const r = D.trend.find((x) => x.wk === w && x.stage === s.id); return r && r.att != null ? `${X(i)},${Y(+r.att)}` : null; }).filter(Boolean);
        return pts.length > 1 ? `<polyline fill="none" stroke="${COLORS[si % COLORS.length]}" stroke-width="2.5" points="${pts.join(' ')}"/>` : ''; }).join('');
      chart = `<div class="glass xc"><b>📉 اتجاه نسبة الحضور الأسبوعية (آخر 10 أسابيع)</b><svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:720px;display:block;margin-top:8px">
          <line x1="${P}" y1="${H - P}" x2="${W - P}" y2="${H - P}" stroke="#ccc"/><text x="2" y="${Y(mx) + 4}" font-size="10" fill="#888">${mx.toFixed(0)}%</text><text x="2" y="${Y(mn) + 4}" font-size="10" fill="#888">${mn.toFixed(0)}%</text>
          ${wks.map((w, i) => `<text x="${X(i)}" y="${H - 10}" font-size="9" fill="#888" text-anchor="middle">${w.slice(5)}</text>`).join('')}${lines}</svg>
        <div class="lg">${S.map((s, si) => `<span><i style="background:${COLORS[si % COLORS.length]}"></i>${esc(s.name)}</span>`).join('')}</div></div>`;
    }
    $('#db').innerHTML = `<div class="kpi4"><div class="glass card-box"><b>${sum('students')}</b>طالب</div><div class="glass card-box"><b>${sum('teachers')}</b>معلم</div>
        <div class="glass card-box"><b style="color:#c0392b">${sum('ew_open')}</b>حالات إنذار مبكر مفتوحة</div><div class="glass card-box"><b>${sum('bh_pos')}</b>ملاحظة سلوك إيجابية</div></div>
      <div class="st-grid">${S.map(card).join('')}</div>
      ${chart}
      <div class="glass xc" style="overflow:auto"><b>مقارنة المراحل</b><table class="t cmp"><thead><tr><th>المؤشر</th>${S.map((s) => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>
        ${[['الحضور', (s) => pct(s.attendance)], ['التأخر', (s) => pct(s.late)], ['التحضير المعتمد', (s) => s.lp ? Math.round(s.lp_ok / s.lp * 100) + '%' : '—'], ['تسليم الواجبات', (s) => pct(s.hw_rate)],
          ['متوسط الاختبارات', (s) => pct(s.ex_avg)], ['سلوك إيجابي / سلبي', (s) => s.bh_pos + ' / ' + s.bh_neg], ['حالات الإنذار المبكر', (s) => s.ew_open], ['تغطية حصص الانتظار', (s) => pct(s.sub_cov)],
          ['ساعات التدريب', (s) => s.trn_hours], ['زيارات العيادة', (s) => s.clinic], ['إعارات المكتبة', (s) => s.loans]].map(([l, f]) => `<tr><td>${l}</td>${S.map((s) => `<td>${f(s)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="hint">الألوان: 🟢 ضمن المستهدف · 🟡 يحتاج متابعة · 🔴 أقل من المقبول. الحضور = 100% − (الغياب + الغياب بعذر) من سجلات الحضور اليومي.</p>`;
  }
  load();
})();
