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
    const { data, error } = await sb.rpc('trn_verify', { p_no: Q.get('no') });
    if (error) return fail(errMsg(error));
    app.innerHTML = `<div class="ver card glass" style="padding:22px;text-align:center"><img src="assets/img/logo.png" alt="" style="height:80px">
      <h2 style="margin:8px 0">التحقق من شهادة تدريب</h2><p class="hint" dir="ltr">${esc(Q.get('no'))}</p>
      ${data && data.valid ? `<div class="notice ok" style="text-align:right">✅ شهادة صحيحة صادرة من ${esc(C.SCHOOL_NAME || 'مدارس دار الذكر')}<br>
        <b>${esc(data.name)}</b> — ${esc(data.title)}<br>${esc(hrs(data.hours))}${data.start ? ' — ' + esc(greg(data.start)) : ''}<br><span class="hint">تاريخ الإصدار: ${esc(greg(data.issued_at))}</span></div>`
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
      <div class="frame"></div><div class="corner c1"></div><div class="corner c2"></div><div class="corner c3"></div><div class="corner c4"></div>
      <div class="wm"><img src="assets/img/logo-mark.png" alt=""></div>
      <div class="in">
        <div class="head"><div class="side r">المملكة العربية السعودية<br>${esc(c.school || C.SCHOOL_NAME)}<br>التطوير المهني للمعلمين</div>
          <img class="logo" src="assets/img/logo.png" alt="">
          <div class="side l">رقم الشهادة: <b dir="ltr">${esc(c.cert_no)}</b><br>تاريخ الإصدار: ${esc(greg(c.issued_at))}<br>${esc(hij(c.issued_at))}</div></div>
        <h1>شهادة تدريب</h1><div class="sub">Training Certificate</div>
        <div class="txt">تشهد ${esc(c.school || C.SCHOOL_NAME)} بأن الأستاذ/ة<br><span class="nm">${esc(c.name)}</span>${c.job ? `<br><span class="hint">${esc(c.job)}</span>` : ''}<br>
          قد أتمّ/ت حضور البرنامج التدريبي<br><span class="crs">«${esc(c.title)}»</span><br>
          بواقع <b>${esc(hrs(c.hours))}</b>${period ? ' ' + esc(period) : ''}${c.mode ? ` (${esc(c.mode)})` : ''}</div>
        <div class="meta">${c.provider ? `<span>الجهة المنفّذة: <b>${esc(c.provider)}</b></span>` : ''}${c.approved_by ? `<span>اعتمد التدريب: <b>${esc(c.approved_by)}</b></span>` : ''}</div>
        <p style="margin:3mm 0 0;font-size:3.8mm">متمنين له/ا دوام التوفيق والنجاح</p>
        <div class="sig">${sig('مقدّم الدورة', c.presenter)}${sig(c.edu_title, c.edu_name)}${sig(c.exec_title, c.exec_name)}</div>
      </div>
      <div class="foot">للتحقق من صحة الشهادة: <span dir="ltr">${esc(verifyUrl(c.cert_no))}</span></div>
    </div></div>`;
  document.getElementById('pr').onclick = () => print();
  // تصغير الشهادة لتناسب الشاشة (لا يؤثر على الطباعة)
  const fit = () => { const el = document.getElementById('cert'); const s = Math.min(1, (innerWidth - 20) / el.offsetWidth);
    el.style.transform = s < 1 ? `scale(${s})` : ''; el.parentElement.style.height = s < 1 ? el.offsetHeight * s + 30 + 'px' : ''; };
  addEventListener('resize', fit); fit();
})();
