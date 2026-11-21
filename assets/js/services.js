/* الخدمات الإدارية: المناوبة + المعاملات + الشكاوى + التدريب */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, hijri, fetchAll, confirmBox, ROLE_LABELS } = LMS;
  const ctx = await requireAuth();
  const me = ctx.profile, role = me.role;
  const STAFF = !['student', 'parent'].includes(role);
  const MANAGER = ['admin', 'leadership', 'principal'].includes(role);
  const SUPER = ['admin', 'leadership', 'principal', 'supervisor'].includes(role);
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  const BUCKET = 'attachments';
  const fmt = (t) => t ? new Date(t).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const dshow = (d) => d ? `${esc(d)} <span class="hint">(${esc(hijri(d))})</span>` : '';
  const stars = (n) => n ? `<span class="stars">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>` : '<span class="hint">—</span>';

  // ---------- أدوات مشتركة ----------
  let STAFFLIST = null;
  async function staffList() {
    if (STAFFLIST) return STAFFLIST;
    STAFFLIST = await fetchAll(() => sb.from('profiles').select('id,full_name,job_title').not('role', 'in', '(student,parent)').eq('active', true).order('full_name'));
    return STAFFLIST;
  }
  async function upload(files) {
    const out = [];
    for (const f of files) {
      if (f.size > 15728640) throw new Error(`«${f.name}» أكبر من 15 ميجابايت`);
      const ext = (f.name.match(/\.[a-z0-9]{1,8}$/i) || [''])[0].toLowerCase();
      const path = `u/${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
      if (error) throw error;
      out.push({ name: f.name, path, size: f.size, type: f.type });
    }
    return out;
  }
  async function openFile(f) {
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 300, { download: f.name });
    if (error) return toast(errMsg(error), 'err'); window.open(data.signedUrl, '_blank');
  }
  const attLinks = (list) => (list || []).map((a, i) => `<a href="#" class="btn sm" data-file="${i}">📎 ${esc(a.name)}</a>`).join(' ');
  const bindFiles = (root, list) => $$('[data-file]', root).forEach((a) => { a.onclick = (e) => { e.preventDefault(); openFile(list[Number(a.dataset.file)]); }; });

  // ---------- التبويبات ----------
  if (!STAFF) $$('.staff-only').forEach((b) => b.remove());
  const loaded = {};
  const LOAD = { duty: loadDuty, req: loadReq, cmp: loadCmp, trn: loadTrn };
  function show(tab) {
    if (!LOAD[tab] || !$(`#tabs [data-tab="${tab}"]`)) tab = $('#tabs button').dataset.tab;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + tab));
    if (!loaded[tab]) { loaded[tab] = true; LOAD[tab](); }
    history.replaceState(null, '', '#' + tab);
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.tab); };
  show((location.hash || '#duty').slice(1));
  if (STAFF) sb.rpc('req_list', { p_box: 'inbox' }).then(({ data }) => { const n = (data || []).length; $('#reqBadge').hidden = !n; $('#reqBadge').textContent = n; });

  // ============================ المناوبة ============================
  let STAGES = [];
  async function loadDuty() {
    const el = $('#tab-duty');
    if (!STAGES.length) { const { data } = await sb.from('stages').select('id,name_ar,sort').order('sort'); STAGES = data || []; }
    el.innerHTML = `<div class="toolbar glass" style="padding:10px"><select id="dStage"><option value="">كل المدرسة</option>${STAGES.map((s) => `<option value="${s.id}">${esc(s.name_ar)}</option>`).join('')}</select>
      <span class="hint grow">المناوبة الأسبوعية الثابتة — مناوبتك تظهر لك أيضًا في الصفحة الرئيسية.</span>
      ${MANAGER ? '<button class="btn primary sm" id="dEdit">✏️ تعديل مناوبة هذه المرحلة</button>' : ''}<button class="btn sm" id="dPrint">🖨️ طباعة</button></div><div id="dBody"></div>`;
    $('#dStage').onchange = paintDuty; if ($('#dEdit')) $('#dEdit').onclick = editDuty;
    $('#dPrint').onclick = () => LMS.printHTML('جدول المناوبة' + ($('#dStage').value ? ' — ' + $('#dStage').selectedOptions[0].text : ''), dutyTable(true));
    paintDuty();
  }
  let DUTY = [];
  async function paintDuty() {
    const st = Number($('#dStage').value) || null;
    const { data, error } = await sb.rpc('duty_get', { p_stage: st });
    if (error) { $('#dBody').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    DUTY = (data.slots || []).filter((d) => !st || d.stage_id === st || d.stage_id == null);
    $('#dBody').innerHTML = DUTY.length ? `<div class="duty-grid">${DAYS.map((d, i) => `<div class="duty-day glass"><h3>${d}</h3>${DUTY.filter((x) => x.dow === i)
      .map((x) => `<div class="duty-item ${x.staff_id === me.id ? 'me' : ''}"><span class="hint">${esc(x.slot)} · ${esc(x.place)}</span><b>${esc(x.staff)}</b>${x.note ? `<small class="hint">${esc(x.note)}</small>` : ''}</div>`).join('') || '<div class="hint">—</div>'}</div>`).join('')}</div>`
      : '<div class="empty">لا يوجد جدول مناوبة لهذه المرحلة بعد' + (MANAGER ? ' — اضغط «تعديل» لإنشائه' : '') + '</div>';
  }
  function dutyTable() {
    return `<table><thead><tr><th>اليوم</th><th>الوقت</th><th>الموقع</th><th>المناوب</th><th>ملاحظة</th></tr></thead><tbody>${DUTY.map((x) =>
      `<tr><td>${DAYS[x.dow]}</td><td>${esc(x.slot)}</td><td>${esc(x.place)}</td><td>${esc(x.staff)}</td><td>${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>`;
  }
  async function editDuty() {
    const st = Number($('#dStage').value) || null; const staff = await staffList();
    const rows = DUTY.filter((d) => (d.stage_id || null) === st).map((d) => ({ ...d }));
    const body = document.createElement('div');
    const opt = (id) => staff.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.full_name)}</option>`).join('');
    const paint = () => { body.innerHTML = `<p class="hint">المرحلة: <b>${esc($('#dStage').selectedOptions[0].text)}</b>. أضف صفًا لكل مناوبة (اليوم، الوقت، الموقع، المناوب).</p>
      <datalist id="slotsDl"><option>قبل الطابور</option><option>الطابور الصباحي</option><option>الفسحة</option><option>الصلاة</option><option>الانصراف</option></datalist>
      <div class="table-wrap no-tools" style="max-height:55vh"><table><thead><tr><th>اليوم</th><th>الوقت</th><th>الموقع</th><th>المناوب</th><th>ملاحظة</th><th></th></tr></thead><tbody>
      ${rows.map((r, i) => `<tr data-i="${i}"><td><select data-k="dow">${DAYS.map((d, j) => `<option value="${j}" ${r.dow === j ? 'selected' : ''}>${d}</option>`).join('')}</select></td>
        <td><input data-k="slot" list="slotsDl" value="${esc(r.slot || '')}" style="width:130px"></td><td><input data-k="place" value="${esc(r.place || '')}" style="width:130px"></td>
        <td><select data-k="staff_id"><option value="">— اختر —</option>${opt(r.staff_id)}</select></td><td><input data-k="note" value="${esc(r.note || '')}" style="width:120px"></td>
        <td><button class="icon-btn" data-del="${i}">🗑️</button></td></tr>`).join('')}</tbody></table></div>
      <button class="btn sm" id="addRow" style="margin-top:8px">➕ إضافة مناوبة</button>`;
      $('#addRow', body).onclick = () => { rows.push({ dow: rows.length ? rows[rows.length - 1].dow : 0, slot: '', place: '', staff_id: '' }); paint(); };
      $$('[data-del]', body).forEach((b) => { b.onclick = () => { rows.splice(Number(b.dataset.del), 1); paint(); }; }); };
    const upd = (e) => { const tr = e.target.closest('tr[data-i]'); if (!tr || !e.target.dataset.k) return;
      rows[Number(tr.dataset.i)][e.target.dataset.k] = e.target.dataset.k === 'dow' ? Number(e.target.value) : e.target.value; };
    body.addEventListener('input', upd); body.addEventListener('change', upd);
    paint();
    modal({ title: '✏️ تعديل جدول المناوبة', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost', value: false },
      { label: '💾 حفظ', cls: 'primary', onClick: async () => {
        const bad = rows.filter((r) => !r.slot || !r.place || !r.staff_id); if (bad.length) { toast('أكمل الوقت والموقع والمناوب في كل الصفوف', 'err'); return false; }
        const { error } = await sb.rpc('duty_save', { p_stage: st, p_rows: rows.map((r) => ({ dow: r.dow, slot: r.slot, place: r.place, staff_id: r.staff_id, note: r.note || '' })) });
        if (error) { toast(errMsg(error), 'err'); return false; } toast('تم حفظ جدول المناوبة ✓'); paintDuty(); return true; } }] });
  }

  // ============================ المعاملات ============================
  let RBOX = 'mine', TYPES = [];
  const RST = { pending: 'قيد الاعتماد', approved: 'معتمد', rejected: 'مرفوض', returned: 'معاد للتعديل', cancelled: 'ملغى' };
  async function loadReq() {
    const el = $('#tab-req');
    if (!TYPES.length) { const { data } = await sb.from('request_types').select('*').eq('active', true).order('sort'); TYPES = data || []; }
    el.innerHTML = `<div class="toolbar glass" style="padding:10px"><div class="subtabs" id="rTabs" style="margin:0">
      <button data-b="mine" class="on">طلباتي</button><button data-b="inbox">بانتظار اعتمادي</button><button data-b="done">اعتمدتها</button>
      ${['admin', 'leadership'].includes(role) ? '<button data-b="all">كل الطلبات</button>' : ''}</div><span class="grow"></span>
      <button class="btn primary" id="rNew">➕ طلب جديد</button></div><div id="rBody"></div>`;
    $('#rTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; RBOX = b.dataset.b; $$('#rTabs button').forEach((x) => x.classList.toggle('on', x === b)); paintReq(); };
    $('#rNew').onclick = newReq; paintReq();
  }
  let REQS = [];
  async function paintReq() {
    $('#rBody').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    const { data, error } = await sb.rpc('req_list', { p_box: RBOX, p_status: null });
    if (error) { $('#rBody').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    REQS = data || [];
    const sum = (r) => r.fields.filter((f) => r.data[f.k]).slice(0, 3).map((f) => `${esc(f.l)}: ${esc(r.data[f.k])}`).join(' · ');
    $('#rBody').innerHTML = REQS.length ? `<div class="table-wrap" data-title="المعاملات" style="max-height:none"><table><thead><tr><th>#</th><th>الطلب</th>${RBOX === 'mine' ? '' : '<th>مقدّم الطلب</th>'}<th>التفاصيل</th><th>التاريخ</th><th>الحالة</th><th class="actions"></th></tr></thead><tbody>
      ${REQS.map((r) => { const cur = (r.steps || []).find((s) => s.step === r.step);
        return `<tr><td>${r.id}</td><td>${esc(r.icon || '')} <b>${esc(r.type_name)}</b></td>${RBOX === 'mine' ? '' : `<td>${esc(r.requester)}</td>`}<td>${sum(r)}</td><td>${esc(fmt(r.at))}</td>
          <td><span class="st ${r.status}">${RST[r.status]}</span>${r.status === 'pending' && cur ? `<div class="hint">لدى: ${esc(cur.approver)}</div>` : ''}</td>
          <td class="actions"><button class="btn sm ${r.can_act ? 'primary' : ''}" data-r="${r.id}">${r.can_act ? 'اعتماد' : 'عرض'}</button></td></tr>`; }).join('')}</tbody></table></div>`
      : `<div class="empty">${{ mine: 'لم تقدّم طلبات بعد', inbox: 'لا توجد طلبات بانتظار اعتمادك ✓', done: 'لا يوجد', all: 'لا توجد طلبات' }[RBOX]}</div>`;
    $$('[data-r]', $('#rBody')).forEach((b) => { b.onclick = () => viewReq(REQS.find((r) => r.id === Number(b.dataset.r))); });
  }
  function fieldInput(f, v) {
    const val = esc(v ?? '');
    if (f.t === 'textarea') return `<textarea data-f="${f.k}" rows="3">${val}</textarea>`;
    if (f.t === 'select') return `<select data-f="${f.k}"><option value="">— اختر —</option>${(f.opts || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    return `<input data-f="${f.k}" type="${['date', 'time', 'number'].includes(f.t) ? f.t : 'text'}" value="${val}">`;
  }
  function newReq() {
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint">اختر نوع الطلب:</p><div class="types">${TYPES.map((t) => `<button data-t="${t.key}"><span>${esc(t.icon || '📝')}</span>${esc(t.name)}</button>`).join('')}</div>`;
    const m = modal({ title: '➕ طلب جديد', wide: true, body, actions: [{ label: 'إغلاق', cls: 'ghost', value: false }] });
    body.onclick = (e) => { const b = e.target.closest('[data-t]'); if (!b) return; body.closest('.modal-wrap').querySelector('[data-x]').click(); reqForm(TYPES.find((t) => t.key === b.dataset.t)); };
    return m;
  }
  function reqForm(t, existing) {
    const files = [];
    const body = document.createElement('div');
    body.innerHTML = `<div class="form-grid">${t.fields.map((f) => `<label class="f" style="${f.t === 'textarea' ? 'grid-column:1/-1' : ''}">${esc(f.l)}${f.req ? ' *' : ''}${fieldInput(f, existing ? existing.data[f.k] : '')}</label>`).join('')}</div>
      ${existing ? '' : '<label class="f" style="margin-top:10px">مرفقات (اختياري)<input type="file" id="rFiles" multiple></label>'}
      <p class="hint">سير الاعتماد: ${t.workflow.map((w) => w === 'manager' ? 'المدير المباشر' : 'الإدارة').join(' ← ')}</p>`;
    if (!existing) $('#rFiles', body).onchange = (e) => { files.splice(0, files.length, ...e.target.files); };
    modal({ title: `${t.icon || ''} ${existing ? 'تعديل وإعادة تقديم: ' : ''}${t.name}`, wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost', value: false },
      { label: existing ? '↩️ إعادة التقديم' : '📨 تقديم الطلب', cls: 'primary', onClick: async () => {
        const data = {}; $$('[data-f]', body).forEach((i) => { data[i.dataset.f] = i.value.trim(); });
        const miss = t.fields.find((f) => f.req && !data[f.k]); if (miss) { toast('أكمل: ' + miss.l, 'err'); return false; }
        try {
          if (existing) { const { error } = await sb.rpc('req_resubmit', { p_id: existing.id, p_data: data }); if (error) throw error; }
          else { const atts = await upload(files); const { error } = await sb.rpc('req_create', { p_type: t.key, p_data: data, p_attachments: atts }); if (error) throw error; }
        } catch (e) { toast(errMsg(e), 'err'); return false; }
        toast(existing ? 'أُعيد تقديم الطلب ✓' : 'تم تقديم الطلب ✓'); RBOX = 'mine'; loadReq(); return true; } }] });
  }
  function viewReq(r) {
    if (!r) return;
    const body = document.createElement('div');
    body.innerHTML = `<div class="kv"><b>رقم الطلب</b><span>${r.id}</span><b>مقدّم الطلب</b><span>${esc(r.requester)}${r.requester_title ? ' — ' + esc(r.requester_title) : ''}</span>
      <b>التاريخ</b><span>${esc(fmt(r.at))}</span><b>الحالة</b><span><span class="st ${r.status}">${RST[r.status]}</span></span>
      ${r.fields.map((f) => `<b>${esc(f.l)}</b><span>${f.t === 'date' ? dshow(r.data[f.k]) : esc(r.data[f.k] || '—')}</span>`).join('')}</div>
      ${(r.attachments || []).length ? `<p>${attLinks(r.attachments)}</p>` : ''}
      <h4 style="margin:14px 0 4px">سير الاعتماد</h4><div class="timeline">${(r.steps || []).map((s) => `<div class="${s.decision === 'approve' ? 'ok' : s.decision ? 'no' : s.step === r.step && r.status === 'pending' ? 'wait' : ''}">
        <b>${esc(s.approver)}</b> <span class="hint">(${s.kind === 'manager' ? 'المدير المباشر' : 'الإدارة'})</span><br>
        ${s.decision ? `${{ approve: '✓ اعتمد', reject: '✕ رفض', return: '↩ أعاد للتعديل' }[s.decision]}${s.by && s.by !== s.approver ? ' (' + esc(s.by) + ')' : ''} — <span class="hint">${esc(fmt(s.at))}</span>${s.note ? `<div>«${esc(s.note)}»</div>` : ''}`
          : s.step === r.step && r.status === 'pending' ? '<span class="hint">بانتظار القرار</span>' : '<span class="hint">—</span>'}</div>`).join('')}</div>
      ${r.can_act ? '<label class="f">ملاحظة (مطلوبة عند الرفض أو الإعادة)<textarea id="rNote" rows="2"></textarea></label>' : ''}`;
    bindFiles(body, r.attachments);
    const acts = [{ label: 'إغلاق', cls: 'ghost', value: false }];
    const decide = (d) => async () => { const { error } = await sb.rpc('req_decide', { p_id: r.id, p_decision: d, p_note: $('#rNote', body).value });
      if (error) { toast(errMsg(error), 'err'); return false; } toast('تم ✓'); paintReq(); loadReqBadge(); return true; };
    if (r.can_act) acts.push({ label: '↩ إعادة للتعديل', onClick: decide('return') }, { label: '✕ رفض', cls: 'danger', onClick: decide('reject') }, { label: '✓ اعتماد', cls: 'ok', onClick: decide('approve') });
    if (r.mine && r.status === 'returned') acts.push({ label: '✏️ تعديل وإعادة تقديم', cls: 'primary', onClick: () => { setTimeout(() => reqForm(TYPES.find((t) => t.key === r.type), r), 50); return true; } });
    if (r.mine && ['pending', 'returned'].includes(r.status)) acts.push({ label: 'إلغاء الطلب', cls: 'danger', onClick: async () => {
      const { error } = await sb.rpc('req_cancel', { p_id: r.id }); if (error) { toast(errMsg(error), 'err'); return false; } toast('أُلغي الطلب'); paintReq(); return true; } });
    acts.push({ label: '🖨️ طباعة', onClick: () => { LMS.printHTML(`طلب ${r.type_name} رقم ${r.id}`, body.innerHTML.replace(/<label class="f">[\s\S]*$/, '')); return false; } });
    modal({ title: `${r.icon || ''} ${r.type_name} — #${r.id}`, wide: true, body, actions: acts });
  }
  const loadReqBadge = () => sb.rpc('req_list', { p_box: 'inbox' }).then(({ data }) => { const n = (data || []).length; $('#reqBadge').hidden = !n; $('#reqBadge').textContent = n; });

  // ============================ الشكاوى ============================
  const CST = { new: 'جديدة', in_progress: 'قيد المعالجة', resolved: 'تم الحل', closed: 'مغلقة' };
  const CATS = ['الدرجات والتقييم', 'الاختبارات', 'معلم / أسلوب التدريس', 'المنهج والواجبات', 'السلوك والانضباط', 'الخدمات والمرافق', 'أخرى'];
  let CBOX = 'mine';
  async function loadCmp() {
    const el = $('#tab-cmp');
    el.innerHTML = `<div class="toolbar glass" style="padding:10px"><div class="subtabs" id="cTabs" style="margin:0"><button data-b="mine" class="on">شكاواي</button>
      ${STAFF && (MANAGER || SUPER) ? '<button data-b="manage">إدارة الشكاوى</button>' : (STAFF ? '<button data-b="manage">المسندة إليّ</button>' : '')}</div><span class="grow"></span>
      <button class="btn primary" id="cNew">➕ شكوى جديدة</button></div><div id="cBody"></div>`;
    $('#cTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; CBOX = b.dataset.b; $$('#cTabs button').forEach((x) => x.classList.toggle('on', x === b)); paintCmp(); };
    $('#cNew').onclick = newCmp; paintCmp();
  }
  async function paintCmp() {
    const { data, error } = await sb.rpc('cmp_list', { p_box: CBOX });
    if (error) { $('#cBody').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    const L = data || [];
    $('#cBody').innerHTML = L.length ? `<div class="table-wrap" data-title="الشكاوى الأكاديمية" style="max-height:none"><table><thead><tr><th>#</th><th>الموضوع</th><th>التصنيف</th>${CBOX === 'manage' ? '<th>مقدّمها</th>' : ''}<th>الطالب</th><th>المسؤول</th><th>آخر تحديث</th><th>الحالة</th><th class="actions"></th></tr></thead><tbody>
      ${L.map((c) => `<tr><td>${c.id}</td><td><b>${esc(c.subject)}</b></td><td>${esc(c.category)}</td>${CBOX === 'manage' ? `<td>${esc(c.by)} <span class="hint">(${esc(ROLE_LABELS[c.by_role] || '')})</span></td>` : ''}
        <td>${esc(c.student || '')}</td><td>${esc(c.assignee || '—')}</td><td>${esc(fmt(c.updated))}</td><td><span class="st ${c.status}">${CST[c.status]}</span></td>
        <td class="actions"><button class="btn sm" data-c="${c.id}">فتح</button></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${CBOX === 'mine' ? 'لم تقدّم شكاوى' : 'لا توجد شكاوى'}</div>`;
    $$('[data-c]', $('#cBody')).forEach((b) => { b.onclick = () => viewCmp(Number(b.dataset.c)); });
  }
  async function newCmp() {
    let kids = [];
    if (role === 'parent') { const { data } = await sb.from('parent_links').select('student_id, student:students(profile:profiles(full_name))'); kids = (data || []).map((k) => ({ id: k.student_id, name: k.student && k.student.profile && k.student.profile.full_name })); }
    const staff = STAFF ? await staffList() : [];
    const files = []; const body = document.createElement('div');
    body.innerHTML = `<div class="form-grid"><label class="f">التصنيف<select id="kCat">${CATS.map((c) => `<option>${c}</option>`).join('')}</select></label>
      ${kids.length ? `<label class="f">الطالب<select id="kStu">${kids.map((k) => `<option value="${k.id}">${esc(k.name || '')}</option>`).join('')}</select></label>` : ''}
      ${staff.length ? `<label class="f">المعلم المعني (اختياري)<select id="kTch"><option value="">—</option>${staff.map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></label>` : ''}</div>
      <label class="f" style="margin-top:10px">الموضوع<input id="kSub"></label>
      <label class="f" style="margin-top:10px">التفاصيل<textarea id="kDet" rows="5"></textarea></label>
      <label class="f" style="margin-top:10px">مرفقات (اختياري)<input type="file" id="kFiles" multiple></label>
      <p class="hint">تصل الشكوى لإدارة المرحلة، وتتابع حالتها والردود عليها من هنا.</p>`;
    $('#kFiles', body).onchange = (e) => files.splice(0, files.length, ...e.target.files);
    modal({ title: '📣 شكوى جديدة', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost', value: false }, { label: '📨 إرسال الشكوى', cls: 'primary', onClick: async () => {
      if (!$('#kSub', body).value.trim()) { toast('اكتب الموضوع', 'err'); return false; }
      try { const atts = await upload(files);
        const { error } = await sb.rpc('cmp_create', { p: { category: $('#kCat', body).value, subject: $('#kSub', body).value, details: $('#kDet', body).value, attachments: atts,
          student_id: $('#kStu', body) ? $('#kStu', body).value : null, teacher_id: $('#kTch', body) ? $('#kTch', body).value : null } }); if (error) throw error;
      } catch (e) { toast(errMsg(e), 'err'); return false; }
      toast('تم تسجيل الشكوى ✓'); CBOX = 'mine'; loadCmp(); return true; } }] });
  }
  async function viewCmp(id) {
    const { data: c, error } = await sb.rpc('cmp_get', { p_id: id }); if (error) return toast(errMsg(error), 'err');
    const staff = c.manage ? await staffList() : [];
    const body = document.createElement('div');
    body.innerHTML = `<div class="kv"><b>رقم الشكوى</b><span>${c.id}</span><b>مقدّمها</b><span>${esc(c.by)} (${esc(ROLE_LABELS[c.by_role] || '')})</span>
      <b>التصنيف</b><span>${esc(c.category)}</span>${c.student ? `<b>الطالب</b><span>${esc(c.student)}</span>` : ''}${c.teacher ? `<b>المعلم المعني</b><span>${esc(c.teacher)}</span>` : ''}
      <b>التاريخ</b><span>${esc(fmt(c.at))}</span><b>الحالة</b><span><span class="st ${c.status}">${CST[c.status]}</span></span><b>المسؤول</b><span>${esc(c.assignee || '—')}</span></div>
      <h4 style="margin:12px 0 4px">${esc(c.subject)}</h4><div style="white-space:pre-wrap">${esc(c.details)}</div>${(c.attachments || []).length ? `<p>${attLinks(c.attachments)}</p>` : ''}
      <h4 style="margin:14px 0 4px">المتابعة</h4><div class="timeline">${(c.updates || []).map((u) => `<div class="${u.status === 'resolved' ? 'ok' : ''}"><b>${esc(u.by || '')}</b> <span class="hint">${esc(fmt(u.at))}</span>
        ${u.status ? ` <span class="st ${u.status}">${CST[u.status]}</span>` : ''}${u.internal ? ' <span class="chip gray">داخلية</span>' : ''}${u.note ? `<div>${esc(u.note)}</div>` : ''}</div>`).join('')}</div>
      ${c.manage ? `<div class="form-grid"><label class="f">تغيير الحالة<select id="uSt"><option value="">— بدون تغيير —</option>${Object.entries(CST).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
        <label class="f">إسناد إلى<select id="uAs"><option value="">— بدون تغيير —</option>${staff.map((p) => `<option value="${p.id}">${esc(p.full_name)}</option>`).join('')}</select></label></div>
        <label class="f" style="margin-top:8px">ملاحظة / رد<textarea id="uNote" rows="2"></textarea></label><label style="display:flex;gap:6px;align-items:center;margin-top:6px"><input type="checkbox" id="uInt"> ملاحظة داخلية (لا يراها مقدّم الشكوى)</label>`
        : (c.status !== 'closed' ? '<label class="f">إضافة رد / توضيح<textarea id="uNote" rows="2"></textarea></label>' : '')}`;
    bindFiles(body, c.attachments);
    const acts = [{ label: 'إغلاق', cls: 'ghost', value: false }, { label: '🖨️ طباعة', onClick: () => { LMS.printHTML('شكوى رقم ' + c.id, body.innerHTML.replace(/<div class="form-grid">[\s\S]*$|<label class="f">إضافة رد[\s\S]*$/, '')); return false; } }];
    if ($('#uNote', body)) acts.push({ label: '💾 حفظ', cls: 'primary', onClick: async () => {
      const { error } = await sb.rpc('cmp_update', { p_id: c.id, p_status: c.manage ? ($('#uSt', body).value || null) : null, p_note: $('#uNote', body).value,
        p_internal: c.manage ? $('#uInt', body).checked : false, p_assignee: c.manage ? ($('#uAs', body).value || null) : null });
      if (error) { toast(errMsg(error), 'err'); return false; } toast('تم ✓'); paintCmp(); return true; } });
    modal({ title: '📣 ' + c.subject, wide: true, body, actions: acts });
  }

  // ============================ التدريب ============================
  let TBOX = 'mine';
  async function loadTrn() {
    const el = $('#tab-trn');
    el.innerHTML = `<div class="toolbar glass" style="padding:10px"><div class="subtabs" id="tTabs" style="margin:0"><button data-b="mine" class="on">سجلي التدريبي</button>
      ${SUPER ? '<button data-b="all">سجلات المعلمين</button><button data-b="sum">ملخص الساعات</button>' : ''}</div><span class="grow"></span>
      <label class="hint">من <input type="date" id="tFrom"></label><label class="hint">إلى <input type="date" id="tTo"></label>
      <button class="btn primary" id="tNew">➕ إضافة تدريب</button></div><div id="tBody"></div>`;
    $('#tTabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TBOX = b.dataset.b; $$('#tTabs button').forEach((x) => x.classList.toggle('on', x === b)); paintTrn(); };
    $('#tFrom').onchange = $('#tTo').onchange = paintTrn;
    $('#tNew').onclick = () => trnForm(); paintTrn();
  }
  let TRN = [];
  async function paintTrn() {
    const { data, error } = await sb.rpc('trn_list', { p_pid: TBOX === 'mine' ? me.id : null, p_from: $('#tFrom').value || null, p_to: $('#tTo').value || null });
    if (error) { $('#tBody').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    TRN = data.rows || [];
    if (TBOX === 'sum') {
      const by = {}; TRN.forEach((t) => { const k = t.pid; by[k] = by[k] || { name: t.name, n: 0, h: 0, imp: [], cert: 0 }; by[k].n++; by[k].h += Number(t.hours) || 0; if (t.impact_rating) by[k].imp.push(t.impact_rating); if (t.certificate) by[k].cert++; });
      const L = Object.values(by).sort((a, b) => b.h - a.h);
      $('#tBody').innerHTML = L.length ? `<div class="table-wrap" data-title="ملخص ساعات التدريب" style="max-height:none"><table><thead><tr><th>#</th><th>المعلم</th><th>عدد البرامج</th><th>إجمالي الساعات</th><th>بشهادات</th><th>متوسط أثر التدريب</th></tr></thead><tbody>
        ${L.map((r, i) => `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td>${r.n}</td><td><b>${r.h}</b></td><td>${r.cert}</td><td>${r.imp.length ? (r.imp.reduce((a, b) => a + b, 0) / r.imp.length).toFixed(1) + ' / 5' : '—'}</td></tr>`).join('')}
        </tbody></table></div><p class="hint">الإجمالي: ${TRN.reduce((a, t) => a + (Number(t.hours) || 0), 0)} ساعة تدريبية لـ ${L.length} موظف.</p>` : '<div class="empty">لا توجد سجلات تدريب في هذه الفترة</div>';
      return;
    }
    const tot = TRN.reduce((a, t) => a + (Number(t.hours) || 0), 0);
    $('#tBody').innerHTML = TRN.length ? `<p class="hint">${TRN.length} برنامج — ${tot} ساعة</p><div class="table-wrap" data-title="${TBOX === 'mine' ? 'سجلي التدريبي' : 'سجلات تدريب المعلمين'}" style="max-height:none"><table><thead><tr>${TBOX === 'all' ? '<th>الموظف</th>' : ''}<th>البرنامج</th><th>الجهة</th><th>النوع</th><th>التاريخ</th><th>الساعات</th><th>الشهادة</th><th>تقييمي</th><th>أثر التدريب (المشرف)</th><th class="actions"></th></tr></thead><tbody>
      ${TRN.map((t) => `<tr>${TBOX === 'all' ? `<td><b>${esc(t.name)}</b></td>` : ''}<td><b>${esc(t.title)}</b></td><td>${esc(t.provider || '')}</td><td>${esc(t.mode || '')}</td>
        <td>${esc(t.start || '')}${t.end && t.end !== t.start ? ' → ' + esc(t.end) : ''}</td><td>${t.hours}</td>
        <td>${t.certificate ? `<a href="#" data-cert="${t.id}">📎 الشهادة</a>` : '—'}</td><td>${stars(t.self_rating)}</td>
        <td>${stars(t.impact_rating)}${t.impact_by ? `<div class="hint">${esc(t.impact_by)}</div>` : ''}</td>
        <td class="actions">${t.mine ? `<button class="btn sm" data-ed="${t.id}">تعديل</button>` : ''}${!t.mine && SUPER ? `<button class="btn sm" data-imp="${t.id}">تقييم الأثر</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : '<div class="empty">لا توجد سجلات تدريب' + (TBOX === 'mine' ? ' — أضف دوراتك وورشك بساعاتها وشهاداتها' : '') + '</div>';
    $$('[data-cert]', $('#tBody')).forEach((a) => { a.onclick = (e) => { e.preventDefault(); openFile(TRN.find((t) => t.id === Number(a.dataset.cert)).certificate); }; });
    $$('[data-ed]', $('#tBody')).forEach((b) => { b.onclick = () => trnForm(TRN.find((t) => t.id === Number(b.dataset.ed))); });
    $$('[data-imp]', $('#tBody')).forEach((b) => { b.onclick = () => trnImpact(TRN.find((t) => t.id === Number(b.dataset.imp))); });
  }
  function trnForm(t) {
    t = t || {}; let file = null;
    const body = document.createElement('div');
    body.innerHTML = `<div class="form-grid"><label class="f" style="grid-column:1/-1">اسم البرنامج التدريبي *<input id="xT" value="${esc(t.title || '')}"></label>
      <label class="f">الجهة المقدّمة<input id="xP" value="${esc(t.provider || '')}"></label>
      <label class="f">النوع<select id="xM">${['', 'حضوري', 'عن بعد', 'داخلي (المدرسة)', 'خارجي', 'مؤتمر / ملتقى', 'رخصة / شهادة مهنية'].map((m) => `<option ${m === (t.mode || '') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
      <label class="f">من تاريخ<input type="date" id="xS" value="${esc(t.start || '')}"></label><label class="f">إلى تاريخ<input type="date" id="xE" value="${esc(t.end || '')}"></label>
      <label class="f">عدد الساعات *<input type="number" min="0" step="0.5" id="xH" value="${t.hours ?? ''}"></label>
      <label class="f">الشهادة (PDF أو صورة)<input type="file" id="xC" accept=".pdf,image/*">${t.certificate ? `<span class="hint">الحالية: ${esc(t.certificate.name)}</span>` : ''}</label>
      <label class="f">تقييمك للتدريب<select id="xR"><option value="">—</option>${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${t.self_rating === n ? 'selected' : ''}>${'★'.repeat(n)}</option>`).join('')}</select></label></div>
      <label class="f" style="margin-top:8px">كيف طبّقت ما تعلّمته؟ (أثر التدريب على عملك)<textarea id="xN" rows="3">${esc(t.self_note || '')}</textarea></label>`;
    $('#xC', body).onchange = (e) => { file = e.target.files[0] || null; };
    const acts = [{ label: 'إلغاء', cls: 'ghost', value: false }];
    if (t.id) acts.push({ label: '🗑️ حذف', cls: 'danger', onClick: async () => { if (!(await confirmBox('حذف هذا السجل؟'))) return false;
      const { error } = await sb.rpc('trn_delete', { p_id: t.id }); if (error) { toast(errMsg(error), 'err'); return false; } paintTrn(); return true; } });
    acts.push({ label: '💾 حفظ', cls: 'primary', onClick: async () => {
      if (!$('#xT', body).value.trim()) { toast('اكتب اسم البرنامج', 'err'); return false; }
      try { const cert = file ? (await upload([file]))[0] : null;
        const { error } = await sb.rpc('trn_save', { p: { id: t.id || null, title: $('#xT', body).value, provider: $('#xP', body).value, mode: $('#xM', body).value,
          start_date: $('#xS', body).value, end_date: $('#xE', body).value, hours: $('#xH', body).value, certificate: cert, self_rating: $('#xR', body).value, self_note: $('#xN', body).value } });
        if (error) throw error; } catch (e) { toast(errMsg(e), 'err'); return false; }
      toast('تم الحفظ ✓'); paintTrn(); return true; } });
    modal({ title: t.id ? 'تعديل سجل تدريب' : '🎓 إضافة تدريب', wide: true, body, actions: acts });
  }
  function trnImpact(t) {
    const body = document.createElement('div');
    body.innerHTML = `<p><b>${esc(t.name)}</b> — ${esc(t.title)} (${t.hours} ساعة)</p>${t.self_note ? `<p class="hint">ما ذكره عن التطبيق: «${esc(t.self_note)}»</p>` : ''}
      <label class="f">أثر التدريب على أداء المعلم (من ملاحظاتك وزياراتك)<select id="iR">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}" ${t.impact_rating === n ? 'selected' : ''}>${'★'.repeat(n)} ${['', 'ضعيف', 'محدود', 'متوسط', 'واضح', 'كبير جدًا'][n]}</option>`).join('')}</select></label>
      <label class="f" style="margin-top:8px">ملاحظات / شواهد<textarea id="iN" rows="3">${esc(t.impact_note || '')}</textarea></label>`;
    modal({ title: 'تقييم أثر التدريب', body, actions: [{ label: 'إلغاء', cls: 'ghost', value: false }, { label: '💾 حفظ', cls: 'primary', onClick: async () => {
      const { error } = await sb.rpc('trn_impact', { p_id: t.id, p_rating: Number($('#iR', body).value), p_note: $('#iN', body).value });
      if (error) { toast(errMsg(error), 'err'); return false; } toast('تم ✓'); paintTrn(); return true; } }] });
  }
})();
