/* =====================================================================
   رسم الشهادة العامة (قالب الهوية) — يستخدمه قسم إصدار الشهادات للمعاينة والطباعة
   تنسيق النص: {الاسم} يظهر سطرًا كبيرًا بالأخضر، **نص** بالبرتقالي، [[نص]] داخل الشريط الأخضر
   ===================================================================== */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NAME = '\u0001NAME\u0001';
  // استبدال الحقول {…} بالقيم؛ الحقل غير المعروف يبقى كما هو لينتبه له المستخدم
  function fill(text, vars) {
    return String(text || '').replace(/\{([^{}\n]{1,40})\}/g, (m, k) => {
      k = k.trim(); if (k === 'الاسم' || k.toLowerCase() === 'name') return NAME;
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null && String(vars[k]).trim() !== '' ? String(vars[k]).trim() : (k in vars ? '' : m);
    }).replace(/[ \t]{2,}/g, ' ')
      // فواصل معلّقة بعد حقل فارغ: «الصف الرابع /» أو «( )»
      .replace(/\s*[/،-]\s*(?=\*\*|\]\]|\n|$|[.،])/g, '').replace(/(\*\*|\[\[|^|\n)\s*[/،-]\s*/g, '$1').replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]*\n[ \t]*(\n[ \t]*)+/g, '\n').trim();
  }
  function bodyHTML(filled, name) {
    return esc(filled).replace(/\*\*([^*\n]+)\*\*/g, '<span class="hl">$1</span>').replace(/\[\[([^\]\n]+)\]\]/g, '<span class="pill">$1</span>')
      .replace(/\n/g, '<br>').split(esc(NAME)).join(`<span class="nm">${esc(name)}</span>`);
  }
  const fmtDate = (d, en) => { if (!d) return ''; const x = new Date(String(d).length === 10 ? d + 'T12:00:00' : d);
    return en ? x.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : x.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) + ' م'; };
  // c = { no, name, date, title, en, body (نص مملوء الحقول), sigs:[{t,n}], school, ltr, verify }
  function render(c, base) {
    base = base || '';
    const sigs = (c.sigs || []).filter((s) => s && (s.t || s.n));
    const en = !!c.ltr;
    return `<div class="dcert${en ? ' ltr' : ''}">
      <img class="wm" src="${base}assets/img/brand/icon.svg" alt=""><img class="dk" src="${base}assets/img/brand/deco-corner.svg" alt="">
      <div class="head"><img class="lg" src="${base}${(window.LMS_CONFIG || {}).LOGO_H || 'assets/img/brand/logo-h.svg'}" alt="${esc(c.school || '')}">
        <div class="secs"><img src="${base}assets/img/brand/sec-girls.png" alt=""><i></i><img src="${base}assets/img/brand/sec-boys.png" alt=""><i></i><img src="${base}assets/img/brand/sec-american.png" alt=""></div></div>
      ${c.no || c.date ? `<div class="no">${c.no ? `${en ? 'Certificate No.' : 'رقم الشهادة:'} <b dir="ltr">${esc(c.no)}</b>` : ''}${c.no && c.date ? ' — ' : ''}${c.date ? `${en ? 'Date:' : 'التاريخ:'} ${esc(fmtDate(c.date, en))}` : ''}</div>` : ''}
      <div class="in"><h1>${esc(c.title || '')}</h1>${c.en ? `<div class="en">${esc(c.en)}</div>` : ''}<div class="bar2"></div>
        <div class="txt">${bodyHTML(c.body || '', c.name || '')}</div>
        ${sigs.length ? `<div class="sig" style="grid-template-columns:repeat(${sigs.length},1fr)">${sigs.map((s) => `<div><div class="t">${esc(s.t || '')}</div><div class="n">${esc(s.n || '')}</div><div class="ln">${en ? 'Signature' : 'التوقيع'}</div></div>`).join('')}</div>` : ''}
      </div>
      <div class="foot">${esc((window.LMS_CONFIG || {}).SCHOOL_WEBSITE || '')}${c.verify ? ' · ' + (en ? 'Verify: ' : 'للتحقق من الشهادة: ') + esc(c.verify) : ''}</div></div>`;
  }
  window.DCert = { fill, render, esc, fmtDate };
})();
