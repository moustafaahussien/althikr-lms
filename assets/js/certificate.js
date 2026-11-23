/* =====================================================================
   شهادة التدريب: certificate.html?id=رقم التدريب  (للمعلم ومشرفه والإدارة)
   التحقق العام:   certificate.html?no=رقم الشهادة (بدون دخول)
   الدوال: trn_cert / trn_verify (sql/43)
   ===================================================================== */
(async function () {
  const { sb, esc, errMsg, hijri, C } = LMS;
  const app = document.getElementById('app');
  const Q = new URLSearchParams(location.search);
  const D = (d) => (d ? new Date(String(d).length === 10 ? d + 'T12:00:00' : d) : null);
  const greg = (d) => (d ? D(d).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }) + ' م' : '');
  const hij = (d) => (d ? hijri(D(d)) : '');
  const hrs = (h) => { const n = Number(h) || 0; return n === 1 ? 'ساعة تدريبية واحدة' : n === 2 ? 'ساعتين تدريبيتين' : n >= 3 && n <= 10 ? `${n} ساعات تدريبية` : `${n} ساعة تدريبية`; };
  const verifyUrl = (no) => location.href.replace(/[?#].*$/, '') + '?no=' + encodeURIComponent(no);
  const fail = (m) => { app.innerHTML = `<div class="ver"><div class="notice err">${esc(m)}</div><p style="text-align:center"><a class="btn" href="services.html#trn">العودة إلى التدريب</a></p></div>`; };

  // ---- التحقق العام برقم الشهادة ----
  if (Q.get('no')) {
    let { data, error } = await sb.rpc('trn_verify', { p_no: Q.get('no') });
    if (!error && !(data && data.valid)) ({ data, error } = await sb.rpc('cert_verify', { p_no: Q.get('no') }));   // شهادات قسم الإصدار (sql/46)
    if (error) return fail(errMsg(error));
    app.innerHTML = `<div class="ver card glass" style="padding:22px;text-align:center"><img src="assets/img/brand/logo-v.svg" alt="" style="height:110px">
      <h2 style="margin:8px 0">التحقق من شهادة</h2><p class="hint" dir="ltr">${esc(Q.get('no'))}</p>
      ${data && data.valid ? `<div class="notice ok" style="text-align:right">✅ شهادة صحيحة صادرة من ${esc(C.SCHOOL_NAME || 'مدارس دار الذكر')}<br>
        <b>${esc(data.name)}</b> — ${esc(data.title)}<br>${data.hours ? esc(hrs(data.hours)) : ''}${data.start ? ' — ' + esc(greg(data.start)) : ''}${data.hours || data.start ? '<br>' : ''}<span class="hint">تاريخ الإصدار: ${esc(greg(data.issued_at))}</span></div>`
        : '<div class="notice err">❌ لا توجد شهادة صادرة بهذا الرقم</div>'}</div>`;
    return;
  }

  // ---- الشهادة نفسها ----
  const id = Number(Q.get('id'));
  if (!id) return fail('رابط الشهادة غير صحيح');
  await LMS.requireAuth();
  const { data: c, error } = await sb.rpc('trn_cert', { p_id: id });
  if (error) return fail(errMsg(error));
  document.title = `شهادة تدريب — ${c.name}`;
  const period = c.start ? (c.end && c.end !== c.start ? `خلال الفترة من ${greg(c.start)} إلى ${greg(c.end)}` : `بتاريخ ${greg(c.start)} الموافق ${hij(c.start)}`) : '';
  const sig = (t, n) => `<div><div class="t">${esc(t)}</div><div class="n">${esc(n || '')}</div><div class="ln">التوقيع</div></div>`;
  app.innerHTML = `<div class="bar no-print"><button class="btn primary" id="pr">🖨️ طباعة / حفظ PDF</button><a class="btn" href="services.html#trn">↩ العودة</a>
      <span class="hint" style="align-self:center">اختر «حفظ كـ PDF» واتجاه الصفحة «أفقي»</span></div>
    <div class="wrap"><div class="cert" id="cert">
      <img class="wm" src="assets/img/brand/icon.svg" alt="">
      <img class="dk bl" src="assets/img/brand/deco-corner.svg" alt="">
      <div class="head"><img class="lg" src="assets/img/brand/logo-h.svg" alt="${esc(c.school || C.SCHOOL_NAME)}">
        <div class="secs"><img src="assets/img/brand/sec-girls.png" alt=""><i></i><img src="assets/img/brand/sec-boys.png" alt=""><i></i><img src="assets/img/brand/sec-american.png" alt=""></div></div>
      <div class="no">رقم الشهادة: <b dir="ltr">${esc(c.cert_no)}</b> — تاريخ الإصدار: ${esc(greg(c.issued_at))} الموافق ${esc(hij(c.issued_at))}</div>
      <div class="in">
        <h1>شهادة تدريب</h1><div class="en">Training Certificate</div><div class="bar2"></div>
        <div class="txt">تشهد ${esc(c.school || C.SCHOOL_NAME)} بأن <span class="to">الأستاذ/ة</span>
          <span class="nm">${esc(c.name)}</span>${c.job ? `<span class="job">${esc(c.job)}</span>` : ''}
          قد أتمّ/ت البرنامج التدريبي <span class="crs">${esc(c.title)}</span><br>
          بواقع <b>${esc(hrs(c.hours))}</b>${period ? ' ' + esc(period) : ''}${c.mode ? ` (${esc(c.mode)})` : ''}<br>متمنين له/ا دوام التوفيق والنجاح.</div>
        <div class="meta">${c.provider ? `<span>الجهة المنفّذة: <b>${esc(c.provider)}</b></span>` : ''}${c.approved_by ? `<span>اعتمد التدريب: <b>${esc(c.approved_by)}</b></span>` : ''}</div>
        <div class="sig">${sig('مقدّم الدورة', c.presenter)}${sig(c.edu_title, c.edu_name)}${sig(c.exec_title, c.exec_name)}</div>
      </div>
      <div class="foot">www.althikr.edu.sa · للتحقق من الشهادة: ${esc(verifyUrl(c.cert_no))}</div>
    </div></div>`;
  document.getElementById('pr').onclick = () => print();
  // تصغير الشهادة لتناسب الشاشة (لا يؤثر على الطباعة)
  const fit = () => { const el = document.getElementById('cert'); const s = Math.min(1, (innerWidth - 20) / el.offsetWidth);
    el.style.transform = s < 1 ? `scale(${s})` : ''; el.parentElement.style.height = s < 1 ? el.offsetHeight * s + 30 + 'px' : ''; };
  addEventListener('resize', fit); fit();
})();
