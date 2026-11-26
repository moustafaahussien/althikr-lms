/* =====================================================================
   بوابة الرسائل النصية والواتساب (sql/76) — لمدير النظام
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (!['admin', 'leadership'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 لمدير النظام فقط.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const ADMIN = ctx.profile.role === 'admin';
  const EV = { absence: '📅 غياب الطالب (يوميًا)', late: '⏰ تأخر الطالب', clinic: '🩺 زيارة العيادة (عند إبلاغ ولي الأمر)', behavior: '⚠️ ملاحظة سلوكية سلبية',
    report_cards: '📜 نشر الشهادات الفصلية', exam_seat: '📋 رقم الجلوس عند نشر اللجان', meeting: '🤝 تأكيد حجز لقاء' };
  const PROV = { taqnyat: { name: 'تقنيات Taqnyat (رسائل نصية)', token: 'Bearer Token من حسابك في taqnyat.sa (الإعدادات ← API)', sender: 'اسم المرسل المعتمد (Sender Name)', app: null },
    unifonic: { name: 'يونيفونك Unifonic (رسائل نصية)', token: 'AppSid من حسابك في Unifonic', sender: 'SenderID المعتمد', app: null },
    whatsapp: { name: 'واتساب للأعمال — WhatsApp Cloud API (Meta)', token: 'Access Token الدائم (System User Token)', sender: null, app: 'Phone Number ID' } };
  const ST = { queued: 'في الطابور', sending: 'قيد الإرسال', sent: '✓ أُرسلت', failed: '✗ فشلت', skipped: 'أُلغيت' };

  const tabs = (ADMIN ? [['set', '⚙️ الإعداد'], ['ev', '🔔 الأحداث والقوالب']] : []).concat([['bulk', '📣 رسالة جماعية']]).concat(ADMIN ? [['log', '🧾 السجل']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  let G = null;
  const load = async () => { if (ADMIN) G = await call('gw_get'); };
  const paint = async () => { try { await load(); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; } ({ set: setView, ev: evView, bulk: bulkView, log: logView })[TAB](); };

  function setView() {
    const P = PROV[G.provider] || PROV.taqnyat;
    view.innerHTML = `<div class="kpi4"><div class="glass card-box"><b style="color:${G.enabled && G.has_token ? '#007B51' : '#b3261e'}">${G.enabled && G.has_token ? 'تعمل ✓' : 'متوقفة'}</b>حالة البوابة</div>
        <div class="glass card-box"><b>${G.stats.sent_today}</b>أُرسلت اليوم</div><div class="glass card-box"><b>${G.stats.queued + G.stats.sending}</b>في الطابور</div>
        <div class="glass card-box"><b>${G.phones.with_phone}/${G.phones.students}</b>طالب له رقم ولي أمر</div></div>
      <div class="row2"><div class="glass xc"><b>1) المزوّد</b>
          <label class="f">المزوّد<select id="pv">${Object.entries(PROV).map(([k, v]) => `<option value="${k}" ${k === G.provider ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label>
          <div id="pf"></div>
          <label class="f">اسم المدرسة في نهاية الرسائل<input id="sc" value="${esc(G.school || 'مدارس دار الذكر')}"></label>
          <label class="f">الحد اليومي للرسائل (حماية من الاستهلاك)<input id="cap" type="number" min="1" value="${G.daily_cap}"></label>
          <button class="btn primary sm" id="save">💾 حفظ الإعدادات</button></div>
        <div class="glass xc"><b>2) المفتاح السري</b>
          <p class="hint">يُكتب هنا مرة واحدة ويُحفظ مشفّرًا في قاعدة البيانات، ولا يظهر بعد الحفظ لأي أحد. ${G.has_token ? '<span class="pill ok">✓ محفوظ</span>' : '<span class="pill bad">غير مُدخل</span>'}</p>
          <label class="f" id="tkl">${esc(P.token)}<input id="tk" type="password" autocomplete="off" dir="ltr" placeholder="${G.has_token ? '•••••••• (اتركه فارغًا للإبقاء)' : 'الصق المفتاح هنا'}"></label>
          <button class="btn sm primary" id="stk">🔐 حفظ المفتاح</button> ${G.has_token ? '<button class="btn sm danger ghost" id="dtk">حذف المفتاح</button>' : ''}
          <hr style="margin:14px 0"><b>3) التشغيل والتجربة</b>
          <label class="chk"><input type="checkbox" id="en" ${G.enabled ? 'checked' : ''}> تفعيل الإرسال</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap"><input id="tp" dir="ltr" placeholder="05xxxxxxxx" style="width:150px"><button class="btn sm" id="tst">📨 رسالة تجريبية</button></div>
          <p class="hint">الرسالة التجريبية تُرسل خلال دقيقة، وتظهر نتيجتها في «السجل».</p></div></div>
      <div class="glass xc" style="counter-reset:s"><b>📘 خطوات التفعيل</b>${guide(G.provider)}</div>`;
    const pf = () => { const p = PROV[$('#pv').value]; $('#pf').innerHTML = (p.sender ? `<label class="f">${p.sender}<input id="sd" value="${esc(G.sender || '')}" dir="ltr"></label>` : '') +
      (p.app ? `<label class="f">${p.app}<input id="ai" value="${esc(G.app_id || '')}" dir="ltr"></label><label class="f">اسم القالب المعتمد في واتساب (بمتغير واحد {{1}})<input id="wt" value="${esc(G.wa_template || 'school_notice')}" dir="ltr"></label>
        <label class="f">لغة القالب<input id="wl" value="${esc(G.wa_lang || 'ar')}" dir="ltr" style="width:80px"></label>` : '');
      $('#tkl').firstChild.textContent = p.token; };
    pf(); $('#pv').onchange = pf;
    $('#save').onclick = async () => { try { await call('gw_set', { p: { provider: $('#pv').value, sender: $('#sd') ? $('#sd').value.trim() : '', app_id: $('#ai') ? $('#ai').value.trim() : G.app_id,
      wa_template: $('#wt') ? $('#wt').value.trim() : G.wa_template, wa_lang: $('#wl') ? $('#wl').value.trim() : G.wa_lang, school: $('#sc').value.trim(), daily_cap: +$('#cap').value || 3000 } }); toast('حُفظ ✓'); paint(); } catch (e) { toast(errMsg(e), 'err'); } };
    $('#stk').onclick = async () => { const v = $('#tk').value.trim(); if (!v) return toast('الصق المفتاح أولًا', 'warn'); try { await call('gw_set_token', { p_token: v }); $('#tk').value = ''; toast('حُفظ المفتاح ✓'); paint(); } catch (e) { toast(errMsg(e), 'err'); } };
    if ($('#dtk')) $('#dtk').onclick = async () => { if (!await confirmBox('حذف المفتاح السري؟ سيتوقف الإرسال.', 'حذف')) return; await call('gw_set_token', { p_token: '' }); paint(); };
    $('#en').onchange = async (e) => { try { await call('gw_set', { p: { enabled: e.target.checked } }); toast(e.target.checked ? 'فُعّل الإرسال ✓' : 'أُوقف الإرسال'); paint(); } catch (er) { toast(errMsg(er), 'err'); } };
    $('#tst').onclick = async () => { try { await call('gw_test', { p_phone: $('#tp').value, p_text: 'رسالة تجريبية من منصة ' + (G.school || 'المدرسة') }); toast(G.enabled && G.has_token ? 'أُضيفت للطابور — تُرسل خلال دقيقة' : 'أُضيفت للطابور، لكن البوابة متوقفة أو بلا مفتاح', G.enabled && G.has_token ? 'ok' : 'warn'); } catch (e) { toast(errMsg(e), 'err'); } };
  }
  function guide(p) {
    const s = (t) => `<div class="stp">${t}</div>`;
    if (p === 'whatsapp') return s('أنشئ حساب Meta Business وأضف رقم واتساب للأعمال من developers.facebook.com ← تطبيقك ← WhatsApp.') +
      s('أنشئ قالب رسالة من نوع «Utility» باسم <b dir="ltr">school_notice</b> ولغته العربية ونصه: <b>{{1}}</b> فقط (متغير واحد)، وانتظر اعتماده.') +
      s('انسخ <b>Phone Number ID</b> والصقه هنا، ثم أنشئ «System User» بصلاحية whatsapp_business_messaging وانسخ الـ Access Token الدائم والصقه في خانة المفتاح.') +
      s('فعّل الإرسال وجرّب رسالة لرقمك.');
    if (p === 'unifonic') return s('أنشئ حسابًا في unifonic.com واطلب اعتماد اسم مرسل (Sender ID) باسم المدرسة.') + s('من Applications أنشئ تطبيق REST وانسخ <b>AppSid</b> والصقه في خانة المفتاح.') +
      s('اكتب Sender ID المعتمد، واحفظ، ثم فعّل الإرسال وجرّب رسالة.');
    return s('أنشئ حسابًا في taqnyat.sa واشحن الرصيد، واطلب اعتماد اسم مرسل باسم المدرسة (يحتاج سجلًا تجاريًا أو خطابًا رسميًا).') +
      s('من حسابك: الإعدادات ← API ← أنشئ <b>Bearer Token</b> وانسخه والصقه في خانة المفتاح.') + s('اكتب اسم المرسل المعتمد بالضبط، واحفظ، ثم فعّل الإرسال وجرّب رسالة لرقمك.');
  }

  function evView() {
    view.innerHTML = `<div class="glass xc"><p class="hint">اختر الأحداث التي تُرسل تلقائيًا، وعدّل نص كل رسالة. المتغيرات المتاحة بين { }: الطالب، التاريخ، المدرسة، وفي بعضها: الإجراء، العنوان، رقم_الجلوس، اللجنة، المعلم، الوقت.</p>
      ${Object.entries(EV).map(([k, l]) => `<div class="ev"><label class="chk" style="margin:0"><input type="checkbox" data-e="${k}" ${G.events[k] ? 'checked' : ''}> ${l}</label><textarea data-tm="${k}">${esc(G.templates[k] || '')}</textarea></div>`).join('')}
      <button class="btn primary sm" id="sv" style="margin-top:10px">💾 حفظ</button></div>`;
    $('#sv').onclick = async () => { const events = {}, templates = {}; $$('[data-e]').forEach((x) => { events[x.dataset.e] = x.checked; }); $$('[data-tm]').forEach((x) => { templates[x.dataset.tm] = x.value.trim(); });
      try { await call('gw_set', { p: { events, templates } }); toast('حُفظ ✓'); } catch (e) { toast(errMsg(e), 'err'); } };
  }

  async function bulkView() {
    const [{ data: stg }, { data: cls }] = await Promise.all([sb.from('stages').select('id,name_ar,sort').order('sort'), sb.from('v_classes').select('id,label,stage_id,stage_sort,grade_number,name').eq('active', true)]);
    (cls || []).sort((a, b) => a.stage_sort - b.stage_sort || a.grade_number - b.grade_number || String(a.name).localeCompare(b.name, 'ar'));
    view.innerHTML = `<div class="glass xc"><label class="f">نص الرسالة * <small class="hint">({الطالب} = اسم الطالب)</small><textarea id="tx" rows="4" maxlength="600"></textarea></label>
      <b>المراحل</b><div style="display:flex;flex-wrap:wrap;gap:4px 14px">${(stg || []).map((s) => `<label class="chk" style="margin:0"><input type="checkbox" data-s value="${s.id}"> ${esc(s.name_ar)}</label>`).join('')}</div>
      <details style="margin:8px 0"><summary class="hint">أو اختر فصولًا محددة</summary><div style="display:flex;flex-wrap:wrap;gap:4px 14px;max-height:220px;overflow:auto">${(cls || []).map((c) => `<label class="chk" style="margin:0"><input type="checkbox" data-c value="${c.id}"> ${esc(c.label)}</label>`).join('')}</div></details>
      <button class="btn primary sm" id="go">📣 إرسال</button><p class="hint">بدون اختيار مرحلة أو فصل = كل أولياء أمور المدرسة. الإرسال يمر بالطابور والحد اليومي.</p></div>`;
    $('#go').onclick = async () => { const p = { text: $('#tx').value, stage_ids: $$('[data-s]:checked').map((x) => +x.value), class_ids: $$('[data-c]:checked').map((x) => +x.value) };
      if (!p.stage_ids.length) delete p.stage_ids; if (!p.class_ids.length) delete p.class_ids;
      if (!p.text.trim()) return toast('اكتب نص الرسالة', 'warn');
      if (!await confirmBox('إرسال الرسالة لأولياء أمور الفئة المختارة؟ (تُحسب من رصيد المزوّد)', 'إرسال')) return;
      try { const n = await call('gw_bulk', { p }); toast(`أُضيفت ${n} رسالة للطابور ✓`); } catch (e) { toast(errMsg(e), 'err'); } };
  }

  async function logView() {
    let L = []; try { L = await call('gw_log', { p_status: null, p_limit: 300 }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><b class="grow">آخر ${L.length} رسالة · اليوم: ${G.stats.sent_today} أُرسلت، ${G.stats.failed_today} فشلت · هذا الشهر ${G.stats.sent_month}</b>
        ${G.stats.queued ? `<button class="btn sm danger ghost" id="cq">إلغاء ${G.stats.queued} في الطابور</button>` : ''}<button class="btn sm ghost" id="rf">🔄</button></div>
      <div class="glass" style="padding:6px;overflow:auto"><table class="t"><thead><tr><th>الوقت</th><th>الرقم</th><th>الحدث</th><th>النص</th><th>الحالة</th></tr></thead><tbody>
      ${L.map((m) => `<tr><td style="white-space:nowrap">${new Date(m.at).toLocaleString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</td><td dir="ltr">${esc(m.phone)}</td>
        <td>${esc((EV[m.event] || m.event).replace(/^\S+\s/, ''))}${m.student ? `<div class="hint">${esc(m.student)}</div>` : ''}</td><td style="max-width:340px">${esc(m.body)}</td>
        <td><span class="pill ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'gold'}">${ST[m.status]}</span>${m.response && m.status === 'failed' ? `<div class="hint" style="max-width:220px;overflow-wrap:anywhere">${esc(m.response)}</div>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="hint">لا رسائل بعد.</td></tr>'}</tbody></table></div>`;
    $('#rf').onclick = paint;
    if ($('#cq')) $('#cq').onclick = async () => { if (!await confirmBox('إلغاء كل الرسائل التي لم تُرسل بعد؟', 'إلغاء')) return; const n = await call('gw_cancel_queued'); toast(`أُلغيت ${n}`); paint(); };
  }

  paint();
})();
