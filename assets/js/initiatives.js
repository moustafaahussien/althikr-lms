/* =====================================================================
   بنك المبادرات (sql/55): اقتراح ← اعتماد ← تنفيذ وأثر ← بنك للجميع
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('initiatives', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const FIELD = { educational: 'تعليمية', values: 'قيمية', community: 'مجتمعية', professional: 'مهنية', tech: 'تقنية', health: 'صحية', environment: 'بيئية', other: 'أخرى' };
  const ST = { draft: 'مسودة', pending: 'بانتظار الاعتماد', approved: 'معتمدة', returned: 'أُعيدت بملاحظات', done: 'منفّذة ✓' };
  const tabs = [['mine', '💡 مبادراتي'], ['review', '✅ بانتظار اعتمادي'], ['bank', '🏦 بنك المبادرات']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : 'mine';
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };

  const card = (i) => `<div class="glass in-card">
      <div class="toolbar" style="margin:0"><b class="grow">${esc(i.title)}</b><span class="st s-${i.status}">${ST[i.status]}</span></div>
      <div class="hint">${FIELD[i.field]}${i.target ? ' · الفئة: ' + esc(i.target) : ''}${i.plan_date ? ' · موعد التنفيذ: ' + esc(i.plan_date) : ''}${TAB !== 'mine' ? ` · <b>${esc(i.owner)}</b>${i.owner_title ? ' — ' + esc(i.owner_title) : ''}` : ''}</div>
      ${i.goals ? `<div class="pre">${esc(i.goals)}</div>` : ''}
      ${i.partners ? `<div class="hint">الشركاء: ${esc(i.partners)}</div>` : ''}
      ${i.review_note ? `<div class="hint" style="color:#8a5a00">ملاحظات ${esc(i.reviewer || 'المعتمد')}: ${esc(i.review_note)}</div>` : (i.reviewer && i.status !== 'pending' ? `<div class="hint">اعتمدها: ${esc(i.reviewer)}</div>` : '')}
      ${i.status === 'done' ? `<div class="impact"><b>🎯 الأثر${i.beneficiaries ? ` — ${i.beneficiaries} مستفيد` : ''}${i.done_at ? ` · نُفّذت ${esc(i.done_at)}` : ''}</b><div>${esc(i.impact || '')}</div>
        ${(i.evidence || []).map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">📎 ${esc(l.title || 'دليل')}</a>`).join(' ')}</div>` : ''}
      <div class="acts">
        ${i.mine && ['draft', 'returned'].includes(i.status) ? `<button class="btn sm" data-ed="${i.id}">✏️ تعديل</button><button class="btn sm primary" data-sub="${i.id}">📤 إرسال للاعتماد</button>` : ''}
        ${i.mine && ['approved', 'done'].includes(i.status) ? `<button class="btn sm primary" data-done="${i.id}">🎯 ${i.status === 'done' ? 'تعديل الأثر' : 'سجّل التنفيذ والأثر'}</button>` : ''}
        ${i.can_review && i.status === 'pending' ? `<button class="btn sm primary" data-ap="${i.id}">✅ اعتماد</button><button class="btn sm" data-ret="${i.id}">↩️ إعادة بملاحظات</button>` : ''}
        ${i.mine && ['draft', 'returned', 'pending'].includes(i.status) ? `<button class="btn sm danger ghost" data-del="${i.id}">🗑</button>` : ''}</div></div>`;

  let L = [];
  async function paint() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { L = await call('in_list', { p_box: TAB }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const done = L.filter((i) => i.status === 'done');
    view.innerHTML = `<div class="toolbar glass" style="padding:10px">${TAB === 'mine' ? '<button class="btn primary sm" id="new">＋ مبادرة جديدة</button>' : ''}
        <input id="q" type="search" class="grow" placeholder="ابحث…"><select id="ff"><option value="">كل المجالات</option>${Object.entries(FIELD).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
      ${TAB === 'bank' ? `<p class="hint">${L.length} مبادرة معتمدة، نُفّذ منها ${done.length} واستفاد منها ${done.reduce((a, i) => a + (i.beneficiaries || 0), 0)} — استلهم منها أو تواصل مع أصحابها.</p>` : ''}
      <div id="list">${L.map((i) => `<div data-q="${esc(LMS.norm(i.title + ' ' + (i.owner || '') + ' ' + (i.goals || '')))}" data-f="${i.field}">${card(i)}</div>`).join('') ||
        `<div class="empty">${TAB === 'mine' ? 'لم تضف مبادرات بعد — شارك فكرتك!' : TAB === 'review' ? '✅ لا توجد مبادرات بانتظار اعتمادك.' : 'لا توجد مبادرات بعد.'}</div>`}</div>`;
    const flt = () => { const v = LMS.norm($('#q').value), f = $('#ff').value; $$('#list [data-q]').forEach((r) => { r.style.display = (!v || r.dataset.q.includes(v)) && (!f || r.dataset.f === f) ? '' : 'none'; }); };
    $('#q').oninput = flt; $('#ff').onchange = flt;
    if ($('#new')) $('#new').onclick = () => form({ field: 'educational' });
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const id = +(b.dataset.ed || b.dataset.sub || b.dataset.done || b.dataset.ap || b.dataset.ret || b.dataset.del); const i = L.find((x) => x.id === id); if (!i) return;
      try {
        if (b.dataset.ed) return form(i);
        if (b.dataset.sub) { await call('in_save', { p: Object.assign({}, i, { submit: true }) }); toast('أُرسلت للاعتماد ✓'); return paint(); }
        if (b.dataset.done) return doneForm(i);
        if (b.dataset.ap) { await call('in_review', { p_id: id, p_decision: 'approve', p_note: null }); toast('اعتُمدت ✓ — وصل إشعار لصاحبها'); return paint(); }
        if (b.dataset.ret) return modal({ title: 'إعادة المبادرة بملاحظات', body: '<label class="f">ملاحظاتك لصاحب المبادرة *<textarea id="nt" rows="4"></textarea></label>',
          actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إعادة', cls: 'primary', onClick: async (w) => { await call('in_review', { p_id: id, p_decision: 'return', p_note: $('#nt', w).value }); toast('أُعيدت'); paint(); return true; } }] });
        if (b.dataset.del) { if (!await confirmBox('حذف المبادرة؟', 'حذف')) return; await call('in_delete', { p_id: id }); paint(); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }
  function form(i) {
    modal({ title: i.id ? 'تعديل المبادرة' : 'مبادرة جديدة', wide: true, body: `
      <label class="f">عنوان المبادرة *<input id="t" value="${esc(i.title || '')}"></label>
      <div class="form-grid"><label class="f">المجال<select id="f">${Object.entries(FIELD).map(([k, v]) => `<option value="${k}" ${i.field === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">الفئة المستهدفة<input id="g" value="${esc(i.target || '')}" placeholder="طلاب الصف الخامس، المعلمون، أولياء الأمور…"></label>
        <label class="f">موعد التنفيذ المتوقع<input id="d" type="date" value="${esc(i.plan_date || '')}"></label>
        <label class="f">الشركاء (اختياري)<input id="p" value="${esc(i.partners || '')}"></label></div>
      <label class="f">الفكرة والأهداف وخطة التنفيذ<textarea id="o" rows="6" placeholder="ما المشكلة/الفرصة؟ ما الأهداف؟ كيف ستُنفَّذ؟ ما الموارد المطلوبة؟">${esc(i.goals || '')}</textarea></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ كمسودة', onClick: async (w) => { await save(w, false); return true; } },
        { label: 'حفظ وإرسال للاعتماد', cls: 'primary', onClick: async (w) => { await save(w, true); return true; } }] });
    async function save(w, submit) {
      await call('in_save', { p: { id: i.id || null, title: $('#t', w).value, field: $('#f', w).value, target: $('#g', w).value, plan_date: $('#d', w).value, partners: $('#p', w).value, goals: $('#o', w).value, submit } });
      toast(submit ? 'أُرسلت للاعتماد ✓' : 'حُفظت'); paint();
    }
  }
  function doneForm(i) {
    const ev = (i.evidence || []).concat([{}, {}]).slice(0, Math.max(3, (i.evidence || []).length + 1));
    modal({ title: `التنفيذ والأثر: ${i.title}`, wide: true, body: `
      <div class="form-grid"><label class="f">تاريخ التنفيذ<input id="d" type="date" value="${esc(i.done_at || LMS.ymd(new Date()))}"></label>
        <label class="f">عدد المستفيدين<input id="b" type="number" min="0" value="${i.beneficiaries ?? ''}"></label></div>
      <label class="f">الأثر والنتائج *<textarea id="m" rows="5" placeholder="ماذا تحقق؟ ما المؤشرات؟ ما الذي تعلّمته؟">${esc(i.impact || '')}</textarea></label>
      <div class="f"><span>روابط الأدلة (صور، فيديو، تقرير…)</span>${ev.map((l) => `<div class="form-grid"><input class="eu" dir="ltr" placeholder="https://" value="${esc(l.url || '')}"><input class="et" placeholder="وصف الرابط" value="${esc(l.title || '')}"></div>`).join('')}</div>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const us = $$('.eu', w), ts = $$('.et', w);
        await call('in_complete', { p_id: i.id, p: { done_at: $('#d', w).value, beneficiaries: $('#b', w).value, impact: $('#m', w).value,
          evidence: us.map((u, k) => ({ url: u.value.trim(), title: ts[k].value.trim() })).filter((x) => x.url) } });
        toast('سُجّل الأثر ✓ — تظهر المبادرة في البنك'); paint(); return true; } }] });
  }
  paint();
})();
