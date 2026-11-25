/* =====================================================================
   إدارة المختبرات (مختبر العلوم / معمل STEM) — sql/50
   labs.html?lab=science | labs.html?lab=stem
   - الحجز: كل منسوبي المدرسة (المعلم يحجز الحصة ويكتب التجهيزات ويختار من المخزون)
   - التجهيز والمخزون والتنبيهات: محضّر المختبر ومشرف المعمل (ومدير النظام)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, hijri } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول — المختبرات لمنسوبي المدرسة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const CODE = new URLSearchParams(location.search).get('lab') || 'science';
  const modKey = CODE === 'stem' ? 'stemlab' : 'scilab';
  if (!LMS.betaAllowed(modKey, ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }

  const PERIODS = 8, DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  const CAT = { tool: 'أداة', device: 'جهاز', material: 'مادة', chemical: 'مادة كيميائية', consumable: 'مستهلك', safety: 'أدوات سلامة', other: 'أخرى' };
  const COND = { good: 'سليم', maintenance: 'يحتاج صيانة', damaged: 'تالف' };
  const STL = { pending: 'بانتظار التجهيز', prepared: 'تم التجهيز ✓', done: 'تمت الحصة', rejected: 'اعتذر المحضّر' };
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const TODAY = ymd(new Date());
  const num = (n) => (Math.round(Number(n) * 100) / 100).toLocaleString('en-US');
  const dlabel = (d) => new Date(d + 'T12:00:00').toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  // بداية الأسبوع (الأحد)
  let WEEK = (() => { const d = new Date(); d.setHours(12, 0, 0, 0); if (d.getDay() >= 5) d.setDate(d.getDate() + (7 - d.getDay())); d.setDate(d.getDate() - d.getDay()); return d; })();
  let D = null, TAB = '';

  async function load() {
    const from = ymd(new Date(WEEK.getTime() - 7 * 864e5)), to = ymd(new Date(WEEK.getTime() + 35 * 864e5));
    D = await call('lab_get', { p_code: CODE, p_from: from, p_to: to });
    $('#hT').textContent = `${D.lab.icon} ${D.lab.name}`;
    document.title = D.lab.name + ' — منصة دار الذكر التعليمية';
    $('#hP').textContent = D.my_role
      ? 'احجز الحصص، وجهّز الطلبات، وتابع المخزون والتنبيهات من هنا.'
      : 'احجز حصتك في المعمل واكتب التجهيزات المطلوبة واختر ما تحتاجه من المخزون، فيجهزها محضّر المختبر قبل الحصة ويصلك إشعار.';
    const ROLE = { admin: 'مدير النظام', supervisor: 'مشرف المعمل', tech: 'محضّر المختبر' };
    $('#labChips').innerHTML = (D.my_role ? `<span class="chip">${ROLE[D.my_role]}</span>` : '') +
      D.staff.map((s) => `<span class="chip gray">${s.role === 'tech' ? '🧑‍🔬 المحضّر' : '👤 المشرف'}: ${esc(s.name)}</span>`).join('');
    const tabs = [['book', '📅 الحجز'], ['mine', '🗒️ حجوزاتي']];
    if (D.my_role) tabs.push(['prep', '🧰 التجهيز'], ['inv', '📦 المخزون'], ['alerts', `⚠️ التنبيهات${D.alerts.length ? ' (' + D.alerts.length + ')' : ''}`], ['staff', '👥 الطاقم']);
    else tabs.push(['inv', '📦 محتويات المعمل']);
    if (!TAB || !tabs.some((t) => t[0] === TAB)) TAB = location.hash.slice(1) && tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : (D.my_role && D.alerts.length ? 'alerts' : 'book');
    $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
    paint();
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; TAB = b.dataset.t; history.replaceState(null, '', '#' + TAB);
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  const reload = async () => { try { await load(); } catch (e) { toast(errMsg(e), 'err'); } };

  function paint() {
    ({ book: paintWeek, mine: paintMine, prep: paintPrep, inv: paintInv, alerts: paintAlerts, staff: paintStaff })[TAB]();
  }

  // ============================ الحجز: جدول الأسبوع ============================
  function paintWeek() {
    const days = DAYS.map((n, i) => { const d = new Date(WEEK); d.setDate(d.getDate() + i); return ymd(d); });
    const by = {}; D.bookings.forEach((b) => { by[b.day + '|' + b.period] = b; });
    let g = `<div class="h"></div>` + days.map((d, i) => `<div class="h${d === TODAY ? ' today' : ''}">${DAYS[i]}<br><small>${d.slice(5).replace('-', '/')}</small></div>`).join('');
    for (let p = 1; p <= PERIODS; p++) {
      g += `<div class="pn">${p}</div>`;
      days.forEach((d) => {
        const b = by[d + '|' + p];
        if (b) g += `<button class="cell bk${b.mine ? ' mine' : ''}" data-bk="${b.id}"><b>${esc(b.title)}</b><small>${esc(b.teacher)}${b.class ? ' · ' + esc(b.class) : ''}</small><span class="st ${b.status}">${STL[b.status]}</span></button>`;
        else if (d < TODAY) g += `<div class="cell past"></div>`;
        else g += `<button class="cell free" data-free="${d}|${p}" title="احجز الحصة ${p}">＋ احجز</button>`;
      });
    }
    view.innerHTML = `<div class="toolbar glass wk" style="padding:10px"><button class="btn sm" id="prv">→ الأسبوع السابق</button>
        <b>${dlabel(days[0])} — ${dlabel(days[4])}</b><button class="btn sm" id="nxt">الأسبوع التالي ←</button><button class="btn sm" id="tdy">هذا الأسبوع</button>
        <span class="grow"></span><button class="btn primary sm" id="newBk">＋ حجز جديد</button></div>
      <div class="glass card" style="overflow:auto"><div class="grid-wk" style="grid-template-columns:44px repeat(5,1fr)">${g}</div></div>
      <p class="hint">اضغط على خانة فارغة لحجزها، أو على حجزك لتعديله أو إلغائه. يصل للمحضّر إشعار بكل حجز، ويصلك إشعار عند تجهيز المعمل.</p>`;
    $('#prv').onclick = () => { WEEK.setDate(WEEK.getDate() - 7); reload(); };
    $('#nxt').onclick = () => { WEEK.setDate(WEEK.getDate() + 7); reload(); };
    $('#tdy').onclick = () => { WEEK = new Date(); WEEK.setHours(12, 0, 0, 0); if (WEEK.getDay() >= 5) WEEK.setDate(WEEK.getDate() + (7 - WEEK.getDay())); WEEK.setDate(WEEK.getDate() - WEEK.getDay()); reload(); };
    $('#newBk').onclick = () => bookForm({ day: days.find((d) => d >= TODAY) || '', period: '' });
    view.onclick = (e) => {
      const f = e.target.closest('[data-free]'); if (f) { const [d, p] = f.dataset.free.split('|'); return bookForm({ day: d, period: +p }); }
      const k = e.target.closest('[data-bk]'); if (k) return showBooking(D.bookings.find((b) => b.id === +k.dataset.bk));
    };
  }

  function itemsText(list) {
    return (list || []).map((x) => { const it = D.items.find((i) => i.id === +x.id); return it ? `${esc(it.name)} × ${num(x.qty)} ${esc(it.unit)}` : ''; }).filter(Boolean).join('، ');
  }

  function showBooking(b) {
    if (!b) return;
    const canEdit = (b.mine || D.my_role) && ['pending', 'prepared'].includes(b.status) && b.day >= TODAY;
    modal({ title: `${b.title}`, wide: true, body: `
      <p><b>${dlabel(b.day)}</b> (${esc(hijri(b.day))}) — الحصة ${b.period}${b.class ? ' — ' + esc(b.class) : ''}${b.subject ? ' — ' + esc(b.subject) : ''}</p>
      <p>المعلم: <b>${esc(b.teacher)}</b> · <span class="st ${b.status}">${STL[b.status]}</span></p>
      ${b.needs ? `<div><b>التجهيزات المطلوبة:</b><div class="pre">${esc(b.needs)}</div></div>` : ''}
      ${b.items && b.items.length ? `<p><b>من المخزون:</b> ${itemsText(b.items)}</p>` : ''}
      ${b.tech_note ? `<p><b>ملاحظة المحضّر:</b> ${esc(b.tech_note)}</p>` : ''}`,
      actions: [{ label: 'إغلاق', value: null, cls: 'ghost' }].concat(canEdit ? [
        { label: 'إلغاء الحجز', cls: 'danger', onClick: async () => { if (!await confirmBox('إلغاء هذا الحجز؟', 'نعم، ألغِ')) return false; await call('lab_book_cancel', { p_id: b.id }); toast('أُلغي الحجز'); reload(); return true; } },
        { label: 'تعديل', cls: 'primary', onClick: () => { setTimeout(() => bookForm(b), 50); return true; } }] : []) });
  }

  function bookForm(b) {
    const its = D.items.filter((i) => i.condition !== 'damaged');
    const sel = Object.fromEntries((b.items || []).map((x) => [x.id, x.qty]));
    modal({ title: b.id ? 'تعديل الحجز' : 'حجز حصة في ' + D.lab.name, wide: true, body: `
      <div class="form-grid">
        <label class="f">التاريخ<input type="date" id="bD" min="${TODAY}" value="${esc(b.day || '')}"></label>
        <label class="f">الحصة<select id="bP">${Array.from({ length: PERIODS }, (_, i) => `<option value="${i + 1}" ${+b.period === i + 1 ? 'selected' : ''}>الحصة ${i + 1}</option>`).join('')}</select></label>
        <label class="f">الصف / الفصل<input id="bC" value="${esc(b.class || '')}" placeholder="مثال: الثاني المتوسط أ"></label>
        <label class="f">المادة<input id="bS" value="${esc(b.subject || '')}" placeholder="علوم، فيزياء، كيمياء…"></label>
      </div>
      <label class="f">عنوان الحصة أو التجربة *<input id="bT" value="${esc(b.title || '')}" placeholder="مثال: تفاعل الأحماض مع الفلزات"></label>
      <label class="f">التجهيزات المطلوبة (اكتب كل ما يحتاجه المحضّر)<textarea id="bN" rows="4" placeholder="الأدوات، المواد، الأعداد، طريقة توزيع المجموعات، أي ملاحظة للسلامة…">${esc(b.needs || '')}</textarea></label>
      <div class="f"><span>اختر من مخزون المعمل (اختياري) — اكتب الكمية لكل ما تحتاجه</span>
        <input id="bQ" type="search" placeholder="ابحث في المخزون…" style="margin:6px 0">
        <div class="picker" id="bI">${its.length ? its.map((i) => `<label data-n="${esc(LMS.norm(i.name))}"><input type="number" min="0" step="any" data-it="${i.id}" value="${sel[i.id] || ''}" placeholder="0">
          <span>${esc(i.name)} <small class="hint">(${esc(CAT[i.category] || '')} — المتوفر ${num(i.qty)} ${esc(i.unit)})</small></span></label>`).join('') : '<div class="hint">لم يُسجَّل مخزون للمعمل بعد — اكتب احتياجك في التجهيزات.</div>'}</div></div>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: b.id ? 'حفظ التعديل' : 'احجز', cls: 'primary', onClick: async (w) => {
        const items = $$('[data-it]', w).filter((x) => Number(x.value) > 0).map((x) => ({ id: +x.dataset.it, qty: Number(x.value) }));
        const r = await call('lab_book_save', { p: { id: b.id || null, lab: CODE, day: $('#bD', w).value, period: +$('#bP', w).value, class: $('#bC', w).value,
          subject: $('#bS', w).value, title: $('#bT', w).value, needs: $('#bN', w).value, items } });
        toast(b.id ? 'تم حفظ التعديل' : 'تم الحجز ✓ — وصل إشعار للمحضّر'); reload(); return !!r; } }] });
    setTimeout(() => { const q = document.getElementById('bQ'); if (q) q.oninput = () => { const v = LMS.norm(q.value); $$('#bI label').forEach((l) => { l.style.display = !v || l.dataset.n.includes(v) ? '' : 'none'; }); }; }, 50);
  }

  // ============================ حجوزاتي ============================
  function paintMine() {
    const L = D.bookings.filter((b) => b.mine).sort((a, b) => (b.day + b.period).localeCompare(a.day + a.period));
    view.innerHTML = L.length ? L.map((b) => `<div class="glass bkcard"><b>${esc(b.title)}</b> <span class="st ${b.status}">${STL[b.status]}</span>
        <div class="hint">${dlabel(b.day)} — الحصة ${b.period}${b.class ? ' — ' + esc(b.class) : ''}</div>
        ${b.tech_note ? `<div class="hint">ملاحظة المحضّر: ${esc(b.tech_note)}</div>` : ''}
        <div class="acts"><button class="btn sm" data-open="${b.id}">التفاصيل</button></div></div>`).join('')
      : '<div class="empty">لا توجد لك حجوزات في الفترة المعروضة. احجز من تبويب «📅 الحجز».</div>';
    view.onclick = (e) => { const o = e.target.closest('[data-open]'); if (o) showBooking(D.bookings.find((b) => b.id === +o.dataset.open)); };
  }

  // ============================ التجهيز (المحضّر) ============================
  function paintPrep() {
    const up = D.bookings.filter((b) => b.day >= TODAY && ['pending', 'prepared'].includes(b.status));
    const past = D.bookings.filter((b) => b.day <= TODAY && b.status === 'prepared');
    const card = (b) => `<div class="glass bkcard"><b>${esc(b.title)}</b> <span class="st ${b.status}">${STL[b.status]}</span>
        <div class="hint">${dlabel(b.day)} — الحصة ${b.period} — ${esc(b.teacher)}${b.class ? ' — ' + esc(b.class) : ''}${b.subject ? ' — ' + esc(b.subject) : ''}</div>
        ${b.needs ? `<div class="pre">${esc(b.needs)}</div>` : ''}${b.items && b.items.length ? `<div class="hint" style="margin-top:4px">من المخزون: ${itemsText(b.items)}</div>` : ''}
        ${b.tech_note ? `<div class="hint">ملاحظتك: ${esc(b.tech_note)}</div>` : ''}
        <div class="acts">${b.status === 'pending' ? `<button class="btn sm primary" data-prep="${b.id}">✅ تم التجهيز</button>` : `<button class="btn sm" data-unprep="${b.id}">↩ لم يُجهَّز بعد</button>`}
          <button class="btn sm" data-done="${b.id}">🏁 تمت الحصة (خصم المستهلَك)</button><button class="btn sm danger" data-rej="${b.id}">اعتذار عن التجهيز</button></div></div>`;
    view.innerHTML = `<h3 style="margin:4px 0 10px">الحجوزات القادمة (${up.length})</h3>${up.length ? up.map(card).join('') : '<div class="empty">لا توجد حجوزات قادمة.</div>'}
      ${past.filter((b) => !up.includes(b)).length ? `<h3 style="margin:16px 0 10px">حصص مضت ولم تُسجَّل «تمت»</h3>${past.filter((b) => !up.includes(b)).map(card).join('')}` : ''}`;
    view.onclick = async (e) => {
      const t = e.target.closest('button'); if (!t) return;
      const id = +(t.dataset.prep || t.dataset.unprep || t.dataset.done || t.dataset.rej); const b = D.bookings.find((x) => x.id === id); if (!b) return;
      try {
        if (t.dataset.prep) { await call('lab_book_set', { p_id: id, p_status: 'prepared', p_note: b.tech_note || '', p_used: null }); toast('تم — وصل إشعار للمعلم'); }
        else if (t.dataset.unprep) { await call('lab_book_set', { p_id: id, p_status: 'pending', p_note: b.tech_note || '', p_used: null }); }
        else if (t.dataset.rej) {
          return modal({ title: 'اعتذار عن تجهيز الحصة', body: '<label class="f">السبب (يصل للمعلم)<textarea id="rj" rows="3"></textarea></label>',
            actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'إرسال الاعتذار', cls: 'danger', onClick: async (w) => { await call('lab_book_set', { p_id: id, p_status: 'rejected', p_note: $('#rj', w).value, p_used: null }); toast('أُرسل الاعتذار للمعلم'); reload(); return true; } }] });
        } else if (t.dataset.done) return doneForm(b);
        reload();
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }
  function doneForm(b) {
    const req = Object.fromEntries((b.items || []).map((x) => [x.id, x.qty]));
    const cons = D.items.filter((i) => ['material', 'chemical', 'consumable'].includes(i.category) || req[i.id]);
    modal({ title: 'تمت الحصة — المستهلَك من المخزون', wide: true, body: `<p class="hint">اكتب الكمية التي استُهلكت فعلًا من كل صنف لتُخصم من المخزون (المقترَح = ما طلبه المعلم من المواد المستهلكة). الأدوات والأجهزة التي رجعت سليمة لا تُكتب.</p>
      <div class="picker">${cons.map((i) => `<label><input type="number" min="0" step="any" data-us="${i.id}" value="${req[i.id] && ['material', 'chemical', 'consumable'].includes(i.category) ? req[i.id] : ''}" placeholder="0">
        <span>${esc(i.name)} <small class="hint">(المتوفر ${num(i.qty)} ${esc(i.unit)})</small></span></label>`).join('') || '<div class="hint">لا توجد مواد مستهلكة في المخزون.</div>'}</div>
      <label class="f">ملاحظة (اختياري)<input id="dn" value="${esc(b.tech_note || '')}"></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ وخصم', cls: 'primary', onClick: async (w) => {
        const used = $$('[data-us]', w).filter((x) => Number(x.value) > 0).map((x) => ({ id: +x.dataset.us, qty: Number(x.value) }));
        await call('lab_book_set', { p_id: b.id, p_status: 'done', p_note: $('#dn', w).value, p_used: used }); toast('سُجّلت الحصة وخُصم المستهلَك'); reload(); return true; } }] });
  }

  // ============================ المخزون ============================
  let INVF = '';
  function flags(i) {
    return [i.out ? '<span class="chip-s out">نفد</span>' : i.low ? '<span class="chip-s low">عند الحد الأدنى</span>' : '',
      i.expired ? '<span class="chip-s expired">منتهي الصلاحية</span>' : i.expiring ? '<span class="chip-s expiring">صلاحية قريبة</span>' : '',
      i.condition !== 'good' ? `<span class="chip-s ${i.condition}">${COND[i.condition]}</span>` : ''].join('');
  }
  function paintInv() {
    const M = !!D.my_role;
    const L = D.items.filter((i) => !INVF || (INVF === 'alert' ? (i.low || i.out || i.expired || i.expiring || i.bad) : i.category === INVF));
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><select id="iF"><option value="">كل الأصناف (${D.items.length})</option><option value="alert" ${INVF === 'alert' ? 'selected' : ''}>⚠️ عليها تنبيه</option>
        ${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${INVF === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input id="iQ" class="grow" type="search" placeholder="ابحث بالاسم أو المكان…">
        ${M ? '<button class="btn sm" id="iImp">⬆️ رفع من Excel</button><input type="file" id="iFile" accept=".xlsx,.xls,.csv" hidden><button class="btn primary sm" id="iAdd">＋ صنف جديد</button>' : ''}</div>
      <div class="table-wrap" data-title="مخزون ${esc(D.lab.name)}"><table id="iT"><thead><tr><th>الصنف</th><th>النوع</th><th>العدد</th><th>الحد الأدنى</th><th>الحالة</th><th>الصلاحية</th><th>المكان</th>${M ? '<th></th>' : ''}</tr></thead><tbody>
      ${L.map((i) => `<tr class="${i.expired || i.out || i.condition === 'damaged' ? 'row-bad' : (i.low || i.expiring || i.bad ? 'row-alert' : '')}" data-n="${esc(LMS.norm(i.name + ' ' + (i.location || '')))}">
        <td><b>${esc(i.name)}</b>${flags(i)}${i.notes ? `<div class="hint">${esc(i.notes)}</div>` : ''}</td><td>${esc(CAT[i.category] || '')}</td>
        <td><b>${num(i.qty)}</b> ${esc(i.unit)}</td><td>${i.min_qty > 0 ? num(i.min_qty) : '—'}</td><td>${COND[i.condition]}</td>
        <td>${i.expiry ? esc(i.expiry) : '—'}</td><td>${esc(i.location || '')}</td>
        ${M ? `<td style="white-space:nowrap"><button class="btn sm" data-ed="${i.id}">✏️</button> <button class="btn sm" data-adj="${i.id}" title="توريد / خصم">±</button> <button class="btn sm" data-his="${i.id}" title="سجل الحركة">🕘</button>${['admin', 'supervisor'].includes(D.my_role) ? ` <button class="btn sm danger" data-del="${i.id}">🗑</button>` : ''}</td>` : ''}</tr>`).join('')}
      </tbody></table></div>${L.length ? '' : '<div class="empty">لا توجد أصناف.</div>'}`;
    $('#iF').onchange = (e) => { INVF = e.target.value; paintInv(); };
    $('#iQ').oninput = (e) => { const v = LMS.norm(e.target.value); $$('#iT tbody tr').forEach((r) => { r.style.display = !v || r.dataset.n.includes(v) ? '' : 'none'; }); };
    if (!M) return;
    $('#iAdd').onclick = () => itemForm({});
    $('#iImp').onclick = () => $('#iFile').click();
    $('#iFile').onchange = importItems;
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const it = D.items.find((i) => i.id === +(b.dataset.ed || b.dataset.adj || b.dataset.his || b.dataset.del));
      if (!it) return;
      if (b.dataset.ed) return itemForm(it);
      if (b.dataset.adj) return adjForm(it);
      if (b.dataset.his) return itemHistory(it);
      if (b.dataset.del) { if (!await confirmBox(`حذف «${it.name}» من المخزون نهائيًا مع سجل حركته؟ (للأصناف التالفة يكفي تغيير الحالة إلى «تالف»)`, 'حذف')) return;
        try { await call('lab_item_delete', { p_id: it.id }); toast('حُذف'); reload(); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  function itemForm(i) {
    modal({ title: i.id ? 'تعديل صنف' : 'صنف جديد في المخزون', wide: true, body: `<div class="form-grid">
      <label class="f">اسم الصنف *<input id="n" value="${esc(i.name || '')}"></label>
      <label class="f">النوع<select id="c">${Object.entries(CAT).map(([k, v]) => `<option value="${k}" ${(i.category || 'tool') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">العدد / الكمية<input id="q" type="number" min="0" step="any" value="${i.qty ?? ''}"></label>
      <label class="f">الوحدة<input id="u" value="${esc(i.unit || 'قطعة')}" list="units"><datalist id="units"><option>قطعة</option><option>جهاز</option><option>علبة</option><option>لتر</option><option>مل</option><option>جرام</option><option>كيلو</option><option>عبوة</option><option>طقم</option></datalist></label>
      <label class="f">الحد الأدنى (ينبّه عند الوصول إليه)<input id="m" type="number" min="0" step="any" value="${i.min_qty ?? ''}"></label>
      <label class="f">الحالة<select id="s">${Object.entries(COND).map(([k, v]) => `<option value="${k}" ${(i.condition || 'good') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f">تاريخ انتهاء الصلاحية (إن وُجد)<input id="e" type="date" value="${esc(i.expiry || '')}"></label>
      <label class="f">المكان (خزانة/رف)<input id="l" value="${esc(i.location || '')}"></label></div>
      <label class="f">ملاحظات<input id="o" value="${esc(i.notes || '')}"></label>
      ${i.id ? '<label class="f">سبب تغيير العدد (إن غيّرته)<input id="r" placeholder="جرد، توريد، تالف…"></label>' : ''}`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('lab_item_save', { p: { lab: CODE, id: i.id || null, name: $('#n', w).value, category: $('#c', w).value, qty: $('#q', w).value, unit: $('#u', w).value,
          min_qty: $('#m', w).value, condition: $('#s', w).value, expiry: $('#e', w).value, location: $('#l', w).value, notes: $('#o', w).value, reason: i.id ? $('#r', w).value : '' } });
        toast('تم الحفظ'); reload(); return true; } }] });
  }
  function adjForm(i) {
    modal({ title: `حركة مخزون: ${i.name}`, body: `<p>المتوفر الآن: <b>${num(i.qty)} ${esc(i.unit)}</b></p>
      <div class="form-grid"><label class="f">النوع<select id="k"><option value="1">➕ توريد / إضافة</option><option value="-1">➖ خصم (تالف، استهلاك، فقد)</option></select></label>
      <label class="f">الكمية<input id="q" type="number" min="0" step="any"></label></div><label class="f">السبب *<input id="r" placeholder="مثال: توريد جديد، كسر أثناء الحصة…"></label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        const q = Number($('#q', w).value); if (!(q > 0)) { toast('اكتب الكمية', 'err'); return false; }
        await call('lab_item_adjust', { p_id: i.id, p_delta: q * Number($('#k', w).value), p_reason: $('#r', w).value }); toast('تم'); reload(); return true; } }] });
  }
  async function itemHistory(i) {
    let L = []; try { L = await call('lab_item_history', { p_item: i.id }); } catch (e) { return toast(errMsg(e), 'err'); }
    modal({ title: `سجل حركة: ${i.name}`, wide: true, body: L.length ? `<div class="table-wrap no-tools"><table><thead><tr><th>التاريخ</th><th>الحركة</th><th>السبب</th><th>بواسطة</th></tr></thead><tbody>
      ${L.map((x) => `<tr><td>${new Date(x.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}</td><td dir="ltr" style="text-align:right;color:${x.delta < 0 ? '#b3261e' : '#007B51'}">${x.delta > 0 ? '+' : ''}${num(x.delta)}</td><td>${esc(x.reason || '')}</td><td>${esc(x.by || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد حركة.</div>',
      actions: [{ label: 'إغلاق', value: null }] });
  }
  async function importItems(ev) {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    if (typeof XLSX === 'undefined') return toast('تعذر تحميل مكتبة Excel', 'err');
    let rows; try { const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false, dateNF: 'yyyy-mm-dd' }); } catch (_) { return toast('تعذّرت قراءة الملف', 'err'); }
    if (!rows.length) return toast('الملف فارغ', 'err');
    const cols = Object.keys(rows[0]), find = (re) => cols.find((c) => re.test(c)) || '';
    const M = { name: find(/اسم|الصنف|item|name/i), category: find(/نوع|فئة|category|type/i), qty: find(/عدد|كمية|qty|quantity/i), unit: find(/وحدة|unit/i),
      min_qty: find(/أدنى|ادنى|min/i), condition: find(/حالة|condition/i), expiry: find(/صلاحية|انتهاء|expiry|exp/i), location: find(/مكان|موقع|location/i), notes: find(/ملاحظ|note/i) };
    const catOf = (v) => { v = String(v || ''); const k = Object.entries(CAT).find(([, a]) => v.includes(a) || a.includes(v) && v); return k ? k[0] : /كيم|chem/i.test(v) ? 'chemical' : /جهاز|device/i.test(v) ? 'device' : /مستهلك/.test(v) ? 'consumable' : /مادة|material/i.test(v) ? 'material' : /سلامة/.test(v) ? 'safety' : 'tool'; };
    const condOf = (v) => /تالف|damag/i.test(v) ? 'damaged' : /صيانة|maint/i.test(v) ? 'maintenance' : 'good';
    const dt = (v) => { v = String(v || '').trim(); const m = v.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/) || v.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (!m) return ''; return m[1].length === 4 ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; };
    const items = rows.map((r) => ({ name: String(r[M.name] || '').trim(), category: catOf(r[M.category]), qty: Number(String(r[M.qty] || '0').replace(/[^\d.]/g, '')) || 0,
      unit: String(r[M.unit] || '').trim() || 'قطعة', min_qty: Number(String(r[M.min_qty] || '0').replace(/[^\d.]/g, '')) || 0, condition: condOf(r[M.condition]),
      expiry: dt(r[M.expiry]), location: String(r[M.location] || '').trim(), notes: String(r[M.notes] || '').trim() })).filter((x) => x.name);
    const ex = new Map(D.items.map((i) => [LMS.norm(i.name), i]));
    const add = items.filter((x) => !ex.has(LMS.norm(x.name))), upd = items.filter((x) => ex.has(LMS.norm(x.name)));
    if (!await confirmBox(`في الملف ${items.length} صنف: ${add.length} جديد و${upd.length} موجود (سيُحدَّث عدده وبياناته). الأعمدة: ${Object.entries(M).filter(([, c]) => c).map(([k, c]) => c).join('، ')}. متابعة؟`, 'نعم، ارفع', false)) return;
    let ok = 0, bad = 0;
    for (const x of items) { try { const old = ex.get(LMS.norm(x.name)); await call('lab_item_save', { p: Object.assign({ lab: CODE, id: old ? old.id : null, reason: 'رفع من ملف Excel' }, x) }); ok++; } catch (_) { bad++; } }
    toast(`تم رفع ${ok} صنف${bad ? ` — تعذّر ${bad}` : ''}`); reload();
  }

  // ============================ التنبيهات ============================
  function paintAlerts() {
    view.innerHTML = D.alerts.length ? `<div class="glass card">${D.alerts.map((a) => `<div class="al sev${a.sev}">${a.sev === 2 ? '⛔' : '⚠️'} <b>${esc(a.name)}</b> — ${esc(a.msg)}
        <span class="grow"></span><button class="btn sm" data-goto="${a.id}">تعديل</button></div>`).join('')}</div>
      <p class="hint">تصل هذه التنبيهات أيضًا في «الرسائل» للمحضّر ومشرف المعمل عند ظهورها، وفي ملخص يومي (الأحد–الخميس). تختفي تلقائيًا بعد التوريد أو تغيير الحالة أو الصلاحية.</p>`
      : '<div class="empty">✅ لا توجد تنبيهات — المخزون سليم.</div>';
    view.onclick = (e) => { const b = e.target.closest('[data-goto]'); if (b) itemForm(D.items.find((i) => i.id === +b.dataset.goto)); };
  }

  // ============================ الطاقم ============================
  async function paintStaff() {
    const canEdit = ['admin', 'supervisor'].includes(D.my_role), adm = D.my_role === 'admin';
    view.innerHTML = `<div class="glass card"><h3 style="margin-top:0">طاقم ${esc(D.lab.name)}</h3>
      ${D.staff.length ? D.staff.map((s) => `<div class="gd" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">${s.role === 'tech' ? '🧑‍🔬 محضّر المختبر' : '👤 مشرف المعمل'}: <b>${esc(s.name)}</b>
        ${canEdit && (s.role === 'tech' || adm) ? `<button class="btn sm ghost" data-rm="${s.profile_id}|${s.role}">✕ إزالة</button>` : ''}</div>`).join('') : '<div class="hint">لم يُحدَّد طاقم بعد.</div>'}
      ${canEdit ? `<hr><div class="form-grid"><label class="f">الموظف<select id="sP"><option value="">— اختر —</option></select></label>
        <label class="f">الدور<select id="sR"><option value="tech">محضّر المختبر</option>${adm ? '<option value="supervisor">مشرف المعمل</option>' : ''}</select></label></div>
        <button class="btn primary sm" id="sAdd">إضافة</button>
        <p class="hint">المحضّر: يرى الحجوزات ويجهّزها ويدير المخزون وتصله التنبيهات. المشرف: كل ذلك + حذف الأصناف وتعيين المحضّرين.</p>` : ''}</div>`;
    if (canEdit) {
      const { data } = await sb.from('profiles').select('id,full_name,job_title').not('role', 'in', '(student,parent)').eq('active', true).order('full_name');
      $('#sP').innerHTML = '<option value="">— اختر —</option>' + (data || []).map((p) => `<option value="${p.id}">${esc(p.full_name)}${p.job_title ? ' — ' + esc(p.job_title) : ''}</option>`).join('');
      $('#sAdd').onclick = async () => { const pid = $('#sP').value; if (!pid) return toast('اختر الموظف', 'err');
        try { await call('lab_staff_set', { p_lab: CODE, p_profile: pid, p_role: $('#sR').value, p_on: true }); toast('أُضيف'); reload(); } catch (e) { toast(errMsg(e), 'err'); } };
    }
    view.onclick = async (e) => { const b = e.target.closest('[data-rm]'); if (!b) return; const [pid, role] = b.dataset.rm.split('|');
      if (!await confirmBox('إزالة من طاقم المعمل؟', 'إزالة')) return;
      try { await call('lab_staff_set', { p_lab: CODE, p_profile: pid, p_role: role, p_on: false }); reload(); } catch (er) { toast(errMsg(er), 'err'); } };
  }

  try { await load(); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
})();
