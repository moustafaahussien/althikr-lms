/* =====================================================================
   الاستبيانات (sql/68)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role;
  if (role === 'parent') { view.innerHTML = '<div class="notice">🔒 ولي الأمر يشارك في الاستبيانات من بوابة ولي الأمر.</div>'; return; }
  if (!LMS.betaAllowed('surveys', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const AUD = { teacher: 'المعلمون', staff: 'الإداريون', supervisor: 'المشرفون', principal: 'مديرو المراحل', leadership: 'القيادة', student: 'الطلاب', parent: 'أولياء الأمور' };
  const QT = { single: 'اختيار واحد', multi: 'اختيار متعدد', scale: 'مقياس موافقة (5)', rating: 'تقييم نجوم (5)', text: 'إجابة نصية' };
  const ST = { draft: 'مسودة', open: 'مفتوح', closed: 'مغلق' };
  let MGR = false;
  try { await call('srv_list'); MGR = true; } catch (e) { MGR = false; }
  let STAGES = [];
  if (MGR) { const { data } = await sb.from('stages').select('id,name_ar,sort').order('sort'); STAGES = data || []; }

  const tabs = [['open', '📝 استبيانات لي']].concat(MGR ? [['manage', '🛠️ إدارة الاستبيانات']] : []);
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const paint = () => (TAB === 'manage' ? manageView() : openView());

  async function openView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('srv_open'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.map((v) => `<div class="glass xc"><div class="toolbar" style="margin:0"><b class="grow">${esc(v.title)}</b>${v.done ? '<span class="pill ok">✓ شاركت</span>' : '<span class="pill gold">بانتظار مشاركتك</span>'}</div>
        <div class="hint">${v.questions.length} سؤال${v.closes_at ? ' · حتى ' + esc(v.closes_at) : ''}${v.anonymous ? ' · مجهول الهوية' : ''}</div>
        ${v.done ? '' : `<div class="acts"><button class="btn sm primary" data-a="${v.id}">✍️ شارك الآن</button></div>`}</div>`).join('') || '<div class="empty">لا توجد استبيانات مفتوحة لك حاليًا.</div>';
    view.onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; answer(L.find((x) => x.id === +b.dataset.a)); };
  }
  function answer(v) {
    modal({ title: '📝 ' + v.title, wide: true, body: SRV.form(v), actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إرسال', cls: 'primary', onClick: async (w) => {
      const a = SRV.collect(w, v); await call('srv_submit', { p_id: v.id, p_answers: a }); toast('شكرًا لمشاركتك ✓'); openView(); return true; } }] });
    SRV.bind([...document.querySelectorAll('.modal-wrap')].pop());
  }

  async function manageView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = [];
    try { L = await call('srv_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="new">＋ استبيان جديد</button><button class="btn sm" id="tpl">📋 من قالب جاهز</button></div>
      ${L.map((v) => `<div class="glass xc"><div class="toolbar" style="margin:0"><b class="grow">${esc(v.title)}</b><span class="pill ${v.status === 'open' ? 'ok' : v.status === 'closed' ? '' : 'gold'}">${ST[v.status]}</span></div>
        <div class="hint">${v.audience.map((a) => AUD[a]).join('، ')} · ${v.questions.length} سؤال · <b>${v.n}</b> رد${v.closes_at ? ' · حتى ' + esc(v.closes_at) : ''}${v.mine ? '' : ' · ' + esc(v.owner || '')}</div>
        <div class="acts"><button class="btn sm primary" data-rep="${v.id}">📊 النتائج</button><button class="btn sm" data-ed="${v.id}">✏️ تعديل</button>
          ${v.status !== 'open' ? `<button class="btn sm" data-st="${v.id}:open">▶️ فتح${v.status === 'draft' ? ' وإشعار' : ''}</button>` : `<button class="btn sm" data-st="${v.id}:closed">⏹ إغلاق</button>`}
          <button class="btn sm danger ghost" data-del="${v.id}">🗑</button></div></div>`).join('') || '<div class="empty">لا توجد استبيانات بعد.</div>'}`;
    $('#new').onclick = () => builder(null);
    $('#tpl').onclick = templates;
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.rep) return report(+b.dataset.rep);
        if (b.dataset.ed) return builder(L.find((x) => x.id === +b.dataset.ed));
        if (b.dataset.st) { const [id, s] = b.dataset.st.split(':'); const n = await call('srv_status', { p_id: +id, p_status: s, p_notify: true }); toast(s === 'open' ? `فُتح ✓${n ? ` — وصل إشعار لـ ${n} منسوب` : ''}` : 'أُغلق'); return manageView(); }
        if (b.dataset.del) { if (!await confirmBox('حذف الاستبيان وكل ردوده؟', 'حذف')) return; await call('srv_delete', { p_id: +b.dataset.del }); manageView(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  const TEMPLATES = [
    { title: 'استبيان رضا أولياء الأمور', audience: ['parent'], intro: 'رأيكم يهمنا لتطوير خدماتنا التعليمية.', questions: [
      { type: 'scale', text: 'أنا راضٍ عن المستوى التعليمي الذي يقدمه المعلمون' }, { type: 'scale', text: 'التواصل بين المدرسة وولي الأمر فعّال وفي الوقت المناسب' },
      { type: 'scale', text: 'البيئة المدرسية آمنة ومحفزة لابني' }, { type: 'scale', text: 'أنشطة المدرسة اللاصفية مفيدة ومتنوعة' },
      { type: 'scale', text: 'المنصة الإلكترونية سهلة الاستخدام وتفيدني في متابعة ابني' }, { type: 'rating', text: 'تقييمك العام للمدرسة' },
      { type: 'text', text: 'ما أبرز ما تقترحه لتطوير المدرسة؟', required: false }] },
    { title: 'استبيان رضا المعلمين', audience: ['teacher'], intro: 'استبيان مجهول الهوية لقياس رضا المعلمين وبيئة العمل.', questions: [
      { type: 'scale', text: 'أشعر بالتقدير لجهودي في المدرسة' }, { type: 'scale', text: 'أحصل على الدعم الكافي من القيادة والمشرفين' },
      { type: 'scale', text: 'النصاب والمهام الإضافية مناسبة' }, { type: 'scale', text: 'فرص التطوير المهني كافية ومفيدة' },
      { type: 'scale', text: 'المنصة الإلكترونية تختصر وقتي وجهدي' }, { type: 'text', text: 'ما الذي يساعدك على أداء أفضل؟', required: false }] },
    { title: 'تقييم برنامج / فعالية', audience: ['student'], intro: 'شاركنا رأيك في البرنامج.', questions: [
      { type: 'rating', text: 'تقييمك العام للبرنامج' }, { type: 'scale', text: 'استفدت من البرنامج' }, { type: 'scale', text: 'التنظيم والوقت كانا مناسبين' },
      { type: 'single', text: 'هل تنصح زملاءك بالمشاركة؟', options: ['نعم', 'ربما', 'لا'] }, { type: 'text', text: 'ملاحظاتك', required: false }] },
    { title: 'رضا الطلاب عن البيئة المدرسية', audience: ['student'], intro: 'استبيان مجهول الهوية.', questions: [
      { type: 'scale', text: 'أشعر بالأمان في المدرسة' }, { type: 'scale', text: 'المعلمون يساعدونني عندما أحتاج' }, { type: 'scale', text: 'أحب الذهاب إلى المدرسة' },
      { type: 'multi', text: 'ما الأنشطة التي تتمنى زيادتها؟', options: ['الرياضة', 'المسابقات العلمية', 'الرحلات', 'الأندية', 'الفنون', 'التقنية والروبوت'] },
      { type: 'text', text: 'اقتراحك', required: false }] }];
  function templates() {
    modal({ title: '📋 قوالب جاهزة', body: TEMPLATES.map((t, i) => `<div class="glass xc" style="cursor:pointer" data-i="${i}"><b>${esc(t.title)}</b><div class="hint">${t.audience.map((a) => AUD[a]).join('، ')} · ${t.questions.length} سؤال</div></div>`).join(''),
      actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    w.addEventListener('click', (e) => { const c = e.target.closest('[data-i]'); if (!c) return; w.remove(); builder(Object.assign({ anonymous: true, stage_ids: null }, JSON.parse(JSON.stringify(TEMPLATES[+c.dataset.i])), { id: null })); });
  }

  function builder(v) {
    const D = v ? JSON.parse(JSON.stringify(v)) : { title: '', intro: '', audience: [], stage_ids: null, anonymous: true, closes_at: '', questions: [{ type: 'scale', text: '' }] };
    const body = `<label class="f">العنوان *<input id="tt" value="${esc(D.title)}"></label>
      <label class="f">مقدمة (اختياري)<textarea id="in" rows="2">${esc(D.intro || '')}</textarea></label>
      <b>الفئة المستهدفة *</b><div style="display:flex;flex-wrap:wrap;gap:4px 14px">${Object.entries(AUD).map(([k, l]) => `<label class="chk" style="margin:0"><input type="checkbox" data-au value="${k}" ${D.audience.includes(k) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
      <b>المراحل</b> <small class="hint">(للطلاب وأولياء الأمور — بدون اختيار = كل المراحل)</small><div style="display:flex;flex-wrap:wrap;gap:4px 14px">${STAGES.map((s) => `<label class="chk" style="margin:0"><input type="checkbox" data-sg value="${s.id}" ${(D.stage_ids || []).includes(s.id) ? 'checked' : ''}> ${esc(s.name_ar)}</label>`).join('')}</div>
      <div style="display:flex;gap:14px;align-items:end;flex-wrap:wrap"><label class="chk"><input type="checkbox" id="an" ${D.anonymous ? 'checked' : ''}> مجهول الهوية في التقارير</label>
        <label class="f">آخر موعد<input type="date" id="cl" value="${esc(D.closes_at || '')}"></label></div>
      <b>الأسئلة</b><div id="qs" style="margin-top:6px"></div><button class="btn sm" type="button" id="addq">＋ سؤال</button>`;
    modal({ title: v && v.id ? 'تعديل الاستبيان' : 'استبيان جديد', wide: true, body, actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      read(w);
      await call('srv_save', { p: { id: D.id || null, title: $('#tt', w).value, intro: $('#in', w).value, audience: $$('[data-au]:checked', w).map((x) => x.value),
        stage_ids: $$('[data-sg]:checked', w).map((x) => +x.value), anonymous: $('#an', w).checked, closes_at: $('#cl', w).value, questions: D.questions } });
      toast('حُفظ ✓ — افتحه من «▶️ فتح» ليصل للمستهدفين'); manageView(); return true; } }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    function read() { D.questions = $$('.qed', w).map((x) => ({ key: x.dataset.key || '', type: $('[data-ty]', x).value, text: $('[data-tx]', x).value.trim(),
      options: ($('[data-op]', x).value || '').split('\n').map((s) => s.trim()).filter(Boolean), required: $('[data-rq]', x).checked })); }
    const draw = () => { $('#qs', w).innerHTML = D.questions.map((q, i) => `<div class="qed" data-key="${esc(q.key || '')}"><select data-ty>${Object.entries(QT).map(([k, l]) => `<option value="${k}" ${q.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input data-tx value="${esc(q.text)}" placeholder="نص السؤال ${i + 1}"><button class="btn sm ghost" type="button" data-rm="${i}">✕</button>
        <label class="chk" style="margin:0;font-size:.8rem"><input type="checkbox" data-rq ${q.required !== false ? 'checked' : ''}> إلزامي</label>
        <textarea data-op placeholder="الخيارات — خيار في كل سطر" style="${['single', 'multi'].includes(q.type) ? '' : 'display:none'}">${esc((q.options || []).join('\n'))}</textarea></div>`).join(''); };
    w.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'addq') { read(); D.questions.push({ type: 'single', text: '', options: [] }); draw(); }
      if (b.dataset.rm) { read(); D.questions.splice(+b.dataset.rm, 1); draw(); } });
    w.addEventListener('change', (e) => { if (e.target.dataset.ty !== undefined) { const t = e.target.closest('.qed').querySelector('[data-op]'); t.style.display = ['single', 'multi'].includes(e.target.value) ? '' : 'none'; } });
    draw();
  }

  async function report(id) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let R;
    try { R = await call('srv_report', { p_id: id }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    let F = '';
    const draw = () => {
      const rs = R.responses.filter((r) => !F || r.role === F);
      const roles = [...new Set(R.responses.map((r) => r.role))];
      const qHtml = (q, i) => {
        const vals = rs.map((r) => r.a[q.key]).filter((x) => x != null);
        let inner = '';
        if (['scale', 'rating'].includes(q.type)) {
          const avg = vals.length ? (vals.reduce((a, b) => a + +b, 0) / vals.length) : 0;
          inner = `<div class="hint">المتوسط <b style="font-size:1.2rem;color:var(--brand)">${avg.toFixed(2)}</b> من 5 (${Math.round(avg / 5 * 100)}%) · ${vals.length} إجابة</div>` +
            [5, 4, 3, 2, 1].map((n) => { const c = vals.filter((x) => +x === n).length; return `<div class="rep-row"><span>${q.type === 'scale' ? SRV.SCALE[n - 1] : '★'.repeat(n)}</span><div class="bar"><i style="width:${vals.length ? c / vals.length * 100 : 0}%"></i></div><span>${c} (${vals.length ? Math.round(c / vals.length * 100) : 0}%)</span></div>`; }).join('');
        } else if (['single', 'multi'].includes(q.type)) {
          const flat = vals.flat(); const base = q.type === 'multi' ? vals.length : flat.length;
          inner = q.options.map((o) => { const c = flat.filter((x) => x === o).length; return `<div class="rep-row"><span>${esc(o)}</span><div class="bar"><i style="width:${base ? c / base * 100 : 0}%"></i></div><span>${c} (${base ? Math.round(c / base * 100) : 0}%)</span></div>`; }).join('');
        } else {
          inner = vals.map((t, j) => `<div class="txt-a">${esc(t)}${!R.anonymous && rs.filter((r) => r.a[q.key] != null)[j].who ? `<div class="hint">— ${esc(rs.filter((r) => r.a[q.key] != null)[j].who)}</div>` : ''}</div>`).join('') || '<div class="hint">لا إجابات</div>';
        }
        return `<div class="glass rep-q"><b>${i + 1}. ${esc(q.text)}</b> <small class="hint">${QT[q.type]}</small><div style="margin-top:6px">${inner}</div></div>`;
      };
      view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><button class="btn sm ghost" id="back">→ رجوع</button><b class="grow">${esc(R.title)}</b>
          <select id="fr"><option value="">كل الفئات (${R.responses.length})</option>${roles.map((r) => `<option value="${r}" ${r === F ? 'selected' : ''}>${AUD[r] || r} (${R.responses.filter((x) => x.role === r).length})</option>`).join('')}</select>
          <button class="btn sm" id="csv">⬇️ Excel/CSV</button><button class="btn sm ghost" id="prn">🖨️</button></div>
        <div class="kpi4"><div class="glass card-box"><b>${rs.length}</b>رد</div><div class="glass card-box"><b>${R.questions.length}</b>سؤال</div>
          <div class="glass card-box"><b>${ST[R.status]}</b>الحالة</div><div class="glass card-box"><b>${R.anonymous ? '🔒' : '👤'}</b>${R.anonymous ? 'مجهول الهوية' : 'بالأسماء'}</div></div>
        ${R.questions.map(qHtml).join('')}`;
      $('#back').onclick = manageView; $('#prn').onclick = () => window.print();
      $('#fr').onchange = (e) => { F = e.target.value; draw(); };
      $('#csv').onclick = () => {
        const head = ['التاريخ', 'الفئة', 'المرحلة'].concat(R.anonymous ? [] : ['المشارك']).concat(R.questions.map((q) => q.text));
        const rows = rs.map((r) => [r.at.slice(0, 10), AUD[r.role] || r.role, R.stages[r.stage] || ''].concat(R.anonymous ? [] : [r.who || '']).concat(R.questions.map((q) => { const v = r.a[q.key]; return Array.isArray(v) ? v.join(' | ') : (v ?? ''); })));
        const csv = '﻿' + [head].concat(rows).map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = R.title + '.csv'; a.click();
      };
    };
    draw();
  }

  paint();
})();
