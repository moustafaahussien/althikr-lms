/* =====================================================================
   ملف إنجاز الطالب: الطالب يضيف ← المعلم يعتمد ← ولي الأمر يرى المعتمد
   الدوال: pf_get / pf_save / pf_delete / pf_review / pf_feed / pf_find (sql/40)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const ROLE = ctx.profile.role;
  const STAFF = !['student', 'parent'].includes(ROLE);
  const view = $('#view');

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const KIND = { competition: '🏅 مسابقة', award: '🏆 جائزة / تكريم', project: '🧪 مشروع', certificate: '📜 شهادة / دورة', volunteer: '🤝 عمل تطوعي', reading: '📚 قراءة', talent: '🎨 موهبة', other: '⭐ أخرى' };
  const LEVEL = { class: 'الفصل', school: 'المدرسة', district: 'إدارة التعليم', national: 'على مستوى المملكة', international: 'دولي' };
  const STS = { pending: 'بانتظار الاعتماد', approved: 'معتمد', rejected: 'غير معتمد' };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#');
  const fmtD = (d) => { if (!d) return ''; const [y, m, x] = String(d).split('-').map(Number); return new Date(y, m - 1, x).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' }); };

  const itemHTML = (i, P, extra) => `<article class="it glass ${esc(i.status)}" data-id="${i.id}">
      <h4>${esc(i.title)} <span class="chip gray">${esc(KIND[i.kind] || i.kind)}</span>${i.level ? `<span class="chip lv">${esc(LEVEL[i.level])}</span>` : ''}${i.result ? `<span class="chip res">${esc(i.result)}</span>` : ''}
        ${i.status !== 'approved' || (P && (P.can_review || P.is_self)) ? `<span class="st ${esc(i.status)}">${esc(STS[i.status])}</span>` : ''}</h4>
      <div class="meta">${esc(fmtD(i.date))}${extra || ''}${i.self_added ? ' · أضافه الطالب' : i.added_by ? ' · أضافه ' + esc(i.added_by) : ''}${i.status === 'approved' && i.reviewed_by && i.self_added ? ' · اعتمده ' + esc(i.reviewed_by) : ''}</div>
      ${i.description ? `<p>${esc(i.description)}</p>` : ''}
      ${(i.links || []).length ? `<div class="links">${i.links.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.title || 'رابط')}</a>`).join('')}</div>` : ''}
      ${i.status === 'rejected' && i.review_note ? `<div class="notice" style="margin-top:6px">ملاحظة المعلم: ${esc(i.review_note)}</div>` : ''}
      <div class="acts">${P && P.can_review && i.status !== 'approved' ? '<button class="btn sm primary" data-a="approve">✓ اعتماد</button><button class="btn sm ghost" data-a="reject">✕ عدم اعتماد</button>' : ''}
        ${P && (P.can_review || (P.is_self && i.self_added && i.status !== 'approved')) ? '<button class="btn sm ghost" data-a="edit">✏️ تعديل</button><button class="btn sm ghost" data-a="del">🗑️</button>' : ''}</div></article>`;

  // ---------------- ملف طالب ----------------
  async function openProfile(sid) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let P; try { P = await call('pf_get', { p_student: sid || null }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const I = P.items, ap = I.filter((i) => i.status === 'approved');
    const cnt = {}; ap.forEach((i) => { cnt[i.kind] = (cnt[i.kind] || 0) + 1; });
    const ini = String(P.student.name || '؟').trim().charAt(0);
    view.innerHTML = `<div class="phead glass">${STAFF ? '<a href="#" class="btn ghost sm">→ رجوع</a>' : ''}<div class="av">${esc(ini)}</div>
        <div class="grow"><h2>${esc(P.student.name)}</h2><small class="hint">${esc(P.student.class || P.student.grade || '')}</small></div>
        ${P.can_add ? `<button class="btn primary" id="pAdd">➕ ${P.is_self ? 'أضف إنجازًا' : 'إضافة إنجاز'}</button>` : ''}<button class="btn ghost" id="pPrint">🖨️ طباعة الملف</button></div>
      <div class="stats"><span><b>${ap.length}</b> إنجاز معتمد</span>${Object.entries(cnt).map(([k, n]) => `<span>${esc(KIND[k])}: <b>${n}</b></span>`).join('')}
        ${I.length > ap.length ? `<span>⏳ ${I.filter((i) => i.status === 'pending').length} بانتظار الاعتماد</span>` : ''}</div>
      ${I.length ? `<div class="tl">${I.map((i) => itemHTML(i, P)).join('')}</div>`
        : `<div class="empty">${P.is_self ? 'لم تضف إنجازات بعد — شاركنا مشاركاتك في المسابقات والمشاريع والدورات!' : 'لا توجد إنجازات مسجّلة لهذا الطالب بعد.'}</div>`}`;
    if ($('#pAdd')) $('#pAdd').onclick = () => edit(null, P);
    $('#pPrint').onclick = () => printProfile(P);
    bindActs(view, P, () => openProfile(sid));
  }

  function bindActs(root, P, after, findP) {
    root.onclick = async (e) => {
      const b = e.target.closest('[data-a]'); if (!b) return;
      const art = b.closest('[data-id]'); const id = +art.dataset.id;
      const pp = findP ? findP(id) : P; const it = (pp.items || []).find((x) => x.id === id);
      try {
        if (b.dataset.a === 'approve') { await call('pf_review', { p_id: id, p_action: 'approve' }); toast('اعتُمد الإنجاز ✓'); after(); }
        else if (b.dataset.a === 'reject') {
          modal({ title: 'عدم اعتماد الإنجاز', body: '<label class="f">السبب (يظهر للطالب) *<textarea id="rN" rows="3" placeholder="مثال: أرفق صورة الشهادة"></textarea></label>',
            actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: 'إرسال', cls: 'primary', onClick: async (w) => { const n = $('#rN', w).value.trim(); if (!n) { toast('اكتب السبب', 'warn'); return false; }
              await call('pf_review', { p_id: id, p_action: 'reject', p_note: n }); toast('أُعيد للطالب مع الملاحظة'); after(); } }] });
        } else if (b.dataset.a === 'edit') edit(it, pp, after);
        else if (b.dataset.a === 'del') { if (!await confirmBox('حذف هذا الإنجاز من الملف؟', 'حذف')) return; await call('pf_delete', { p_id: id }); toast('حُذف'); after(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  function edit(i, P, after) {
    i = i || { kind: 'competition', title: '', description: '', date: new Date().toISOString().slice(0, 10), level: 'school', result: '', links: [] };
    const body = `<div class="form-grid">
      <label class="f">النوع *<select id="eK">${Object.entries(KIND).map(([k, v]) => `<option value="${k}"${k === i.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">التاريخ<input id="eD" type="date" value="${esc(i.date || '')}"></label>
      <label class="f" style="grid-column:1/-1">العنوان *<input id="eT" maxlength="200" value="${esc(i.title)}" placeholder="مثال: أولمبياد الرياضيات الوطني"></label>
      <label class="f">المستوى<select id="eL"><option value="">—</option>${Object.entries(LEVEL).map(([k, v]) => `<option value="${k}"${k === i.level ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">النتيجة<input id="eR" maxlength="120" value="${esc(i.result || '')}" placeholder="المركز الأول، ميدالية، مشاركة…"></label>
      <label class="f" style="grid-column:1/-1">وصف مختصر<textarea id="eS" rows="3">${esc(i.description || '')}</textarea></label>
      <label class="f" style="grid-column:1/-1">روابط (شهادة، صور، فيديو — رابط في كل سطر)<textarea id="eU" rows="2" dir="ltr" placeholder="https://…">${esc((i.links || []).map((l) => l.url).join('\n'))}</textarea></label>
      ${P.is_self ? '<p class="hint" style="grid-column:1/-1">سيظهر الإنجاز في ملفك بعد اعتماد أحد معلميك.</p>' : ''}</div>`;
    modal({ title: i.id ? 'تعديل الإنجاز' : 'إنجاز جديد', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: '💾 حفظ', cls: 'primary', onClick: async (w) => {
      const links = $('#eU', w).value.split(/\n+/).map((u) => u.trim()).filter(Boolean);
      if (links.some((u) => !/^https?:\/\//i.test(u))) { toast('الروابط يجب أن تبدأ بـ https://', 'warn'); return false; }
      const p = { id: i.id || null, student_id: P.student?.id || i.student_id, kind: $('#eK', w).value, title: $('#eT', w).value.trim(), date: $('#eD', w).value, level: $('#eL', w).value,
        result: $('#eR', w).value.trim(), description: $('#eS', w).value.trim(), links: links.map((url) => ({ url })) };
      if (!p.title) { toast('اكتب عنوان الإنجاز', 'warn'); return false; }
      await call('pf_save', { p }); toast(P.is_self && !i.id ? 'أُرسل الإنجاز لمعلمك للاعتماد' : 'حُفظ'); (after || (() => openProfile(P.student.id)))(); } }] });
  }

  function printProfile(P) {
    const ap = P.items.filter((i) => i.status === 'approved');
    const w = window.open('', '_blank'); if (!w) { toast('اسمح بالنوافذ المنبثقة للطباعة', 'warn'); return; }
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>ملف إنجاز ${esc(P.student.name)}</title>
      <style>body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;padding:24px;color:#1d2b36}h1{margin:0;color:#0f6e6a}h2{margin:2px 0 16px;font-weight:500;color:#555;font-size:1rem}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd;padding:6px 8px;text-align:right;font-size:13px;vertical-align:top}th{background:#eef6f5}footer{margin-top:20px;color:#888;font-size:12px}</style></head><body>
      <h1>ملف إنجاز الطالب</h1><h2>${esc(P.student.name)} — ${esc(P.student.class || P.student.grade || '')}</h2>
      <table><thead><tr><th>#</th><th>الإنجاز</th><th>النوع</th><th>المستوى</th><th>النتيجة</th><th>التاريخ</th></tr></thead><tbody>
      ${ap.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.title)}</b>${i.description ? `<br><small>${esc(i.description)}</small>` : ''}</td><td>${esc((KIND[i.kind] || '').replace(/^\S+\s/, ''))}</td><td>${esc(LEVEL[i.level] || '')}</td><td>${esc(i.result || '')}</td><td>${esc(fmtD(i.date))}</td></tr>`).join('') || '<tr><td colspan="6">لا توجد إنجازات معتمدة</td></tr>'}
      </tbody></table><footer>منصة دار الذكر التعليمية — ${esc(new Date().toLocaleDateString('ar-SA-u-ca-gregory-nu-latn'))}</footer></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }

  // ---------------- ولي الأمر ----------------
  if (ROLE === 'parent') {
    const { data } = await sb.from('parent_links').select('student_id, student:students(profile:profiles(full_name))');
    const kids = (data || []).map((k) => ({ id: k.student_id, name: k.student?.profile?.full_name }));
    if (!kids.length) { view.innerHTML = '<div class="empty">لا يوجد أبناء مرتبطون بحسابك.</div>'; return; }
    const pick = async (id) => { await openProfile(id); if (kids.length > 1) view.insertAdjacentHTML('afterbegin', `<div class="toolbar glass" style="padding:8px">${kids.map((k) => `<button class="btn ${k.id === id ? 'primary' : 'ghost'} sm" data-k="${esc(k.id)}">${esc(k.name)}</button>`).join('')}</div>`);
      $$('[data-k]', view).forEach((b) => { b.onclick = () => pick(b.dataset.k); }); };
    pick(kids[0].id); return;
  }
  // ---------------- الطالب ----------------
  if (!STAFF) { openProfile(null); return; }

  // ---------------- المنسوبون ----------------
  $('#tabs').hidden = false;
  window.addEventListener('hashchange', route);
  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) location.hash = b.dataset.tab; };
  function route() {
    const h = location.hash.slice(1);
    const m = /^s=([0-9a-f-]{36})$/.exec(h);
    const tab = m ? 'find' : (['pending', 'recent', 'find'].includes(h) ? h : 'pending');
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    if (m) openProfile(m[1]); else if (tab === 'find') drawFind(); else drawFeed(tab);
  }

  async function drawFeed(tab) {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('pf_feed', { p_status: tab === 'pending' ? 'pending' : 'approved', p_kind: null }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const P = { can_review: true, items: L };
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><select id="fK"><option value="">كل الأنواع</option>${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <input id="fQ" class="grow" type="search" placeholder="ابحث بالاسم أو الفصل أو العنوان…"><span class="hint">${L.length} ${tab === 'pending' ? 'بانتظار اعتمادك' : 'إنجاز'}</span></div>
      ${L.length ? `<div class="tl" id="feed">${L.map((i) => itemHTML(i, P, ` · <a href="#s=${esc(i.student_id)}"><b>${esc(i.student)}</b></a> · ${esc(i.class || '')}`)).join('')}</div>`
        : `<div class="empty">${tab === 'pending' ? '🎉 لا توجد إنجازات بانتظار الاعتماد.' : 'لا توجد إنجازات معتمدة بعد.'}</div>`}`;
    const flt = () => { const k = $('#fK').value, q = $('#fQ').value.trim();
      $$('#feed .it').forEach((a) => { const i = L.find((x) => x.id === +a.dataset.id); a.hidden = (k && i.kind !== k) || (q && !a.innerText.includes(q)); }); };
    $('#fK').onchange = flt; $('#fQ').oninput = flt;
    if ($('#feed')) bindActs($('#feed'), P, () => drawFeed(tab), () => P);
  }

  function drawFind() {
    view.innerHTML = `<div class="glass" style="padding:14px"><div class="find"><input id="sQ" type="search" style="width:100%" placeholder="اكتب اسم الطالب أو رقمه أو هويته…" autocomplete="off"><div class="dd" id="sDD" hidden></div></div>
      <p class="hint">تظهر لك ملفات الطلاب الذين تدرّسهم أو ضمن نطاق صلاحيتك.</p></div>`;
    let tmr = 0, seq = 0;
    $('#sQ').oninput = (e) => { clearTimeout(tmr); const q = e.target.value.trim(); if (q.length < 2) { $('#sDD').hidden = true; return; }
      tmr = setTimeout(async () => { const my = ++seq; let L = []; try { L = await call('pf_find', { p_q: q }); } catch (er) { toast(errMsg(er), 'err'); return; } if (my !== seq) return;
        $('#sDD').innerHTML = L.length ? L.map((s) => `<button data-s="${esc(s.id)}">${esc(s.name)} <small>· ${esc(s.class || '')}${s.n ? ` · ${s.n} إنجاز` : ''}</small></button>`).join('') : '<div class="empty">لا نتائج</div>';
        $('#sDD').hidden = false; }, 300); };
    $('#sDD').onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) location.hash = 's=' + b.dataset.s; };
    $('#sQ').focus();
  }

  route();
})();
