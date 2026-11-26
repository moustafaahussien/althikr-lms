/* =====================================================================
   عرض الشهادة الفصلية وطباعتها (مشترك: صفحة الشهادات + الطالب + ولي الأمر)
   + أداة طباعة عامة لأي محتوى HTML داخل الصفحة.
   ===================================================================== */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const C = (window.LMS && LMS.C) || window.LMS_CONFIG || {};

  const css = `
    .rcard { background: #fff; border: 2px solid #007B51; border-radius: 14px; padding: 18px 22px; margin: 0 auto 18px; max-width: 820px; color: #1c2b24; font-size: 14px; }
    .rcard .rh { display: flex; align-items: center; justify-content: space-between; gap: 12px; border-bottom: 2px solid #e3ece7; padding-bottom: 10px; margin-bottom: 10px; }
    .rcard .rh img { height: 54px; } .rcard .rh h2 { margin: 0; font-size: 1.25rem; color: #007B51; text-align: center; } .rcard .rh small { color: #5b6b63; }
    .rcard .who { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px 14px; margin-bottom: 10px; } .rcard .who div { font-size: .92rem; } .rcard .who b { color: #333; }
    .rcard table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; } .rcard th, .rcard td { border: 1px solid #d6e2dc; padding: 6px 8px; text-align: center; }
    .rcard th { background: #eef6f2; font-size: .85rem; } .rcard td:first-child, .rcard th:first-child { text-align: start; }
    .rcard .avg { display: flex; gap: 10px; justify-content: center; margin: 8px 0; flex-wrap: wrap; }
    .rcard .avg div { border: 1px solid #d6e2dc; border-radius: 10px; padding: 6px 14px; text-align: center; min-width: 120px; } .rcard .avg b { display: block; font-size: 1.25rem; color: #007B51; }
    .rcard .note { border: 1px dashed #b9cfc3; border-radius: 10px; padding: 8px 10px; min-height: 40px; margin-top: 6px; }
    .rcard .sig { display: flex; justify-content: space-between; margin-top: 26px; font-size: .9rem; } .rcard .sig span { border-top: 1px solid #999; padding-top: 4px; min-width: 160px; text-align: center; }
    .rcard .foot { text-align: center; color: #7a8a82; font-size: .75rem; margin-top: 12px; }
    #printArea { display: none; }
    @media print {
      body.printing > *:not(#printArea) { display: none !important; }
      body.printing #printArea { display: block !important; }
      #printArea .pg { break-after: page; page-break-after: always; } #printArea .pg:last-child { break-after: auto; page-break-after: auto; }
      .rcard { border-width: 1.5px; margin: 0 auto; max-width: none; }
      @page { size: A4; margin: 12mm; }
    }`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function printHtml(html) {
    let a = document.getElementById('printArea');
    if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
    a.innerHTML = html;
    document.body.classList.add('printing');
    const done = () => { document.body.classList.remove('printing'); a.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(() => window.print(), 300);
  }

  const fmt = (v) => v == null ? '—' : (Math.round(v * 10) / 10) + '%';
  function html(c, issue) {
    const I = issue || c.issue || {};
    const a = c.attendance || {}, b = c.behavior || {};
    return `<div class="rcard">
      <div class="rh"><img src="${esc(C.LOGO_H || 'assets/img/brand/logo-h.svg')}" alt="">
        <div><h2>${esc(I.title || 'الشهادة الفصلية')}</h2><small>${esc(I.term || '')}${I.from ? ` · من ${esc(I.from)} إلى ${esc(I.to)}` : ''}</small></div>
        <small style="text-align:end">${esc(C.SCHOOL_NAME || '')}</small></div>
      <div class="who"><div>الطالب: <b>${esc(c.name)}</b></div><div>الفصل: <b>${esc(c.class || '—')}</b></div><div>رقم الطالب: <b>${esc(c.student_no || '—')}</b></div></div>
      <table><thead><tr><th>المادة</th><th>النسبة</th><th>التقدير</th><th>المعلم</th></tr></thead><tbody>
        ${(c.subjects || []).map((s) => `<tr><td><b>${esc(s.subject)}</b></td><td>${fmt(s.pct)}</td><td>${esc(s.label || '—')}</td><td style="font-size:.82rem">${esc(s.teacher || '')}</td></tr>`).join('')}
      </tbody></table>
      <div class="avg"><div>المعدل العام<b>${fmt(c.avg)}</b></div><div>التقدير العام<b>${esc(c.label || '—')}</b></div>
        ${I.show_att !== false && a.days ? `<div>الحضور<b>${Math.round((1 - ((a.absent || 0) + (a.excused || 0)) / a.days) * 100)}%</b><small>غياب ${a.absent || 0} · بعذر ${a.excused || 0} · تأخر ${a.late || 0}</small></div>` : ''}
        ${I.show_bh !== false ? `<div>السلوك<b>⭐ ${b.points || 0}</b><small>إيجابية ${b.positive || 0} · تحتاج متابعة ${b.negative || 0}</small></div>` : ''}</div>
      <div><b>ملاحظات رائد الفصل:</b><div class="note">${esc(c.note || '')}</div></div>
      <div class="sig"><span>رائد الفصل</span><span>وكيل شؤون الطلاب</span><span>مدير المرحلة</span></div>
      <div class="foot">التقديرات: ${(I.scale || []).map((s) => `${esc(s.label)} (${s.min}+)`).join(' · ')} — محسوبة من سجل الدرجات في المنصة</div></div>`;
  }

  window.RC = { html, printHtml, print: (cards, issue) => printHtml(cards.map((c) => `<div class="pg">${html(c, issue)}</div>`).join('')) };
})();
