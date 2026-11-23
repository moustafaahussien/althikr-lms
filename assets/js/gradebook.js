/* =====================================================================
   سجل الدرجات: لكل (فصل × مادة) — أعمدة تلقائية (واجبات/اختبارات) + يدوية بأوزان
   الدوال: cp_courses (sql/36) + gb_sheet / gb_item_save / gb_item_delete / gb_scores_save / gb_my (sql/38)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, printTable } = LMS;
  const ctx = await requireAuth();
  const STUDENT = ctx.profile.role === 'student';

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const num = (v) => (v == null || v === '' ? '' : String(+v));
  const short = (c) => String(c || '').split(' — ')[0];
  const CAT = { homework: 'واجب', exam: 'اختبار إلكتروني', quiz: 'اختبار قصير', participation: 'مشاركة', project: 'مشروع', oral: 'شفهي', other: 'أخرى' };
  const KIND = { hw: 'واجب', ex: 'اختبار', manual: 'يدوي' };
  const PER = { p1: 'الفترة الأولى', p2: 'الفترة الثانية', mid: 'منتصف الفصل', final: 'نهاية العام', '': 'غير محدد' };
  const PORD = ['p1', 'p2', 'mid', 'final', ''];
  const perSel = (v) => PORD.map((k) => `<option value="${k}"${k === (v || '') ? ' selected' : ''}>${PER[k]}</option>`).join('');
  // نسبة موزونة لمجموعة أعمدة (نفس معادلة الخادم)
  const pctOf = (cols, sc) => { let n = 0, w = 0; cols.forEach((c) => { if (!c.hidden && +c.weight > 0 && sc[c.key] != null) { n += c.weight * sc[c.key] / c.max; w += +c.weight; } }); return w ? Math.round(n / w * 1000) / 10 : null; };
  const byPeriod = (C) => PORD.map((k) => [k, C.filter((c) => (c.period || '') === k)]).filter(([, L]) => L.length);
  const pctCls = (p) => (p == null ? '' : p >= 90 ? 'a' : p >= 75 ? 'b' : p >= 60 ? 'c' : 'd');
  const pctHTML = (p) => (p == null ? '<span class="hint">—</span>' : `<span class="pct ${pctCls(+p)}">${num(p)}%</span>`);
  const dshort = (d) => { if (!d) return ''; const [y, m, x] = String(d).split('-').map(Number); return `${x}/${m}`; };
  const view = $('#view');

  if (STUDENT) { drawStudent(); return; }

  // ---------------- المعلم / المتابع ----------------
  let COURSES = [];
  try { COURSES = await call('cp_courses'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  window.addEventListener('hashchange', route);
  route();
  function route() { const m = /c=(\d+)-(\d+)/.exec(location.hash); if (m) openSheet(+m[1], +m[2]); else drawList(); }

  function drawList() {
    if (!COURSES.length) { view.innerHTML = '<div class="empty">لا توجد مقررات مسندة إليك أو لمعلميك.</div>'; return; }
    const mine = COURSES.filter((c) => c.mine), other = COURSES.filter((c) => !c.mine);
    const card = (c) => `<button data-c="${c.class_id}-${c.subject_id}"><b>${esc(c.subject)}</b><small>${esc(c.class)}</small><small>${esc((c.teachers || []).join('، '))}</small></button>`;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="cq" class="grow" type="search" placeholder="ابحث بالمادة أو الفصل أو المعلم…"></div>
      ${mine.length ? `<h3 class="sec-h">سجلاتي</h3><div class="crs">${mine.map(card).join('')}</div>` : ''}
      ${other.length ? `<h3 class="sec-h">سجلات للمتابعة (${other.length})</h3><div class="crs">${other.map(card).join('')}</div>` : ''}`;
    $('#cq').oninput = (e) => { const q = e.target.value.trim(); $$('.crs button', view).forEach((b) => { b.hidden = !!q && !LMS.has(b.innerText, q); }); };
    view.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) location.hash = 'c=' + b.dataset.c; };
  }

  let S = null, CID = 0, SID = 0;
  async function openSheet(cid, sid) {
    CID = cid; SID = sid; view.onclick = null;
    view.innerHTML = '<div class="empty">جارٍ تحميل السجل…</div>';
    try { S = await call('gb_sheet', { p_class: cid, p_subject: sid }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div><a href="#" class="btn ghost">→ رجوع</a>`; return; }
    paint();
  }

  function paint() {
    const G = byPeriod(S.columns), C = G.flatMap(([, L]) => L), ST = S.students, ed = S.can_edit;
    const vis = C.filter((c) => !c.hidden && +c.weight > 0);
    const totW = vis.reduce((a, c) => a + +c.weight, 0);
    const avg = (k) => { const v = ST.map((s) => s.scores[k]).filter((x) => x != null); return v.length ? v.reduce((a, b) => a + +b, 0) / v.length : null; };
    const P = ST.map((s) => s.pct).filter((p) => p != null);
    view.innerHTML = `<div class="chead glass"><a href="#" class="btn ghost sm">→ السجلات</a><div class="grow"><h2>🏅 ${esc(S.subject)} — ${esc(short(S.class))}</h2>
        <small class="hint">${esc(S.class)} · ${ST.length} طالب · ${C.length} عمود${P.length ? ` · متوسط الفصل ${Math.round(P.reduce((a, b) => a + +b, 0) / P.length)}%` : ''}</small></div>
        ${ed ? '<button class="btn primary" id="gAdd">➕ عمود يدوي</button><button class="btn" id="gSave" disabled>💾 حفظ الدرجات</button>' : ''}
        <button class="btn ghost" id="gCsv" title="تصدير يُفتح في Excel">⬇️ تصدير</button><button class="btn ghost" id="gPrint">🖨️ طباعة</button></div>
      <div class="legend"><span><i style="background:#6c8ebf"></i>واجب (تلقائي)</span><span><i style="background:#339574"></i>اختبار إلكتروني (تلقائي)</span><span><i style="background:#00A657"></i>يدوي</span>
        ${ed ? '<span>اضغط عنوان أي عمود لتغيير وزنه أو إخفائه</span>' : ''}<span>النسبة النهائية = متوسط موزون للأعمدة المرصودة للطالب</span></div>
      ${!ST.length ? '<div class="notice">لا يوجد طلاب مربوطون بهذا الفصل في المنصة بعد — اربطهم من الإدارة (استيراد توزيع الطلاب على الفصول أو يدويًا).</div>' : ''}
      ${!C.length ? `<div class="empty">لا توجد أعمدة بعد. ستظهر الواجبات والاختبارات الإلكترونية هنا تلقائيًا${ed ? '، ويمكنك إضافة أعمدة يدوية' : ''}.</div>` : ''}
      ${C.length && ST.length ? `<div class="table-wrap gb"><table id="gT"><thead><tr class="pr"><th rowspan="2">الطالب</th>${G.map(([k, L]) => `<th colspan="${L.length + 1}" class="per">${esc(PER[k])}</th>`).join('')}<th rowspan="2">النهائي</th></tr><tr>
        ${G.map(([, L]) => L.map((c) => `<th class="col k-${c.kind}${c.hidden || +c.weight === 0 ? ' off' : ''}" data-k="${esc(c.key)}" title="${esc(KIND[c.kind])} · ${esc(CAT[c.category] || '')}">${esc(c.title)}
          <small>${esc(dshort(c.date))} · من ${esc(num(c.max))}${totW && !c.hidden && +c.weight > 0 ? ` · ${Math.round(100 * c.weight / totW)}%` : c.hidden ? ' · مخفي' : ' · وزن 0'}</small></th>`).join('') + '<th class="sub">مجموع الفترة</th>').join('')}
        </tr></thead><tbody>
        ${ST.map((s) => `<tr data-s="${esc(s.id)}"><td>${esc(s.name)}</td>${G.map(([, L]) => L.map((c) => { const v = s.scores[c.key]; const off = c.hidden || +c.weight === 0 ? ' off' : '';
          return c.kind === 'manual' && ed ? `<td class="${off}"><input class="sc" type="number" min="0" max="${esc(num(c.max))}" step="0.25" data-i="${c.item_id}" value="${esc(num(v))}" data-o="${esc(num(v))}" aria-label="${esc(c.title)} — ${esc(s.name)}"></td>`
            : `<td class="${off}">${v != null ? esc(num(v)) : '<span class="hint">—</span>'}</td>`; }).join('') + `<td class="sub">${pctHTML(pctOf(L, s.scores))}</td>`).join('')}<td class="fin">${pctHTML(s.pct)}</td></tr>`).join('')}
        <tr><td><b>متوسط الفصل</b></td>${G.map(([, L]) => L.map((c) => { const a = avg(c.key); return `<td class="hint">${a == null ? '' : Math.round(a * 10) / 10}</td>`; }).join('') + '<td class="sub"></td>').join('')}
          <td class="fin">${P.length ? pctHTML(Math.round(P.reduce((a, b) => a + +b, 0) / P.length * 10) / 10) : ''}</td></tr></tbody></table></div>` : ''}`;
    const dirty = () => $$('input.sc.dirty', view);
    if (ed && $('#gT')) $('#gT').addEventListener('input', (e) => { const i = e.target.closest('input.sc'); if (!i) return;
      i.classList.toggle('dirty', i.value !== i.dataset.o); $('#gSave').disabled = !dirty().length; });
    if (ed) {
      $('#gAdd').onclick = () => editCol(null);
      $('#gSave').onclick = async () => {
        const by = {}; let bad = false;
        dirty().forEach((i) => { const v = i.value.trim(); if (v !== '' && (+v < 0 || +v > +i.max)) bad = true;
          (by[i.dataset.i] = by[i.dataset.i] || []).push({ student: i.closest('tr').dataset.s, score: v === '' ? null : +v }); });
        if (bad) { toast('بعض الدرجات خارج المدى المسموح', 'warn'); return; }
        $('#gSave').disabled = true;
        try { for (const [item, rows] of Object.entries(by)) await call('gb_scores_save', { p_item: +item, p_rows: rows });
          toast('حُفظت الدرجات ✓'); openSheet(CID, SID); } catch (er) { $('#gSave').disabled = false; toast(errMsg(er), 'err'); }
      };
      $$('th.col', view).forEach((th) => { th.onclick = () => { if (dirty().length) { toast('احفظ الدرجات المعدّلة أولًا', 'warn'); return; } editCol(C.find((c) => c.key === th.dataset.k)); }; });
    }
    window.onbeforeunload = () => (dirty().length ? true : undefined);
    $('#gPrint').onclick = () => { const t = $('#gT'); if (!t) return; const c = t.cloneNode(true); $$('input', c).forEach((i) => { i.replaceWith(document.createTextNode(i.value)); });
      printTable(c, `سجل درجات ${S.subject} — ${S.class}`); };
    $('#gCsv').onclick = () => {
      const q = (x) => `"${String(x ?? '').replace(/"/g, '""')}"`;
      const rows = [['الطالب', ...C.map((c) => `${PER[c.period || '']}: ${c.title} (من ${num(c.max)})`), 'النهائي %'].map(q).join(','),
        ...ST.map((s) => [s.name, ...C.map((c) => num(s.scores[c.key])), num(s.pct)].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = `درجات ${S.subject} ${short(S.class)}.csv`.replace(/[\\/:*?"<>|]/g, '-'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  }

  function editCol(c) {
    const manual = !c || c.kind === 'manual';
    c = c || { kind: 'manual', title: '', category: 'participation', max: 10, weight: 1, hidden: false, period: localStorage.getItem('lms_per') || '', date: new Date().toISOString().slice(0, 10) };
    const body = `<div class="form-grid">
      ${manual ? `<label class="f" style="grid-column:1/-1">اسم العمود *<input id="cT" maxlength="120" value="${esc(c.title)}" placeholder="مثال: مشاركة الفترة الأولى"></label>
        <label class="f">النوع<select id="cC">${Object.entries(CAT).filter(([k]) => !['homework', 'exam'].includes(k)).map(([k, v]) => `<option value="${k}"${k === c.category ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="f">الدرجة العظمى *<input id="cM" type="number" min="0.5" max="1000" step="0.5" value="${esc(num(c.max))}"></label>
        <label class="f">التاريخ<input id="cD" type="date" value="${esc(c.date || '')}"></label>`
        : `<div class="notice" style="grid-column:1/-1">${esc(KIND[c.kind])} «${esc(c.title)}» — درجاته تأتي تلقائيًا من ${c.kind === 'hw' ? 'تصحيح الواجب' : 'الاختبار الإلكتروني'} (من ${esc(num(c.max))}).</div>`}
      <label class="f">فترة التقويم<select id="cP">${perSel(c.period)}</select></label>
      <label class="f">الوزن في النسبة النهائية<input id="cW" type="number" min="0" max="100" step="0.5" value="${esc(num(c.weight))}"><small class="hint">1 = وزن عادي، 2 = ضعف، 0 = لا يُحسب</small></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="cH"${c.hidden ? ' checked' : ''}> إخفاء العمود (لا يظهر للطالب ولا يُحسب)</label></div>`;
    const A = [{ label: 'إلغاء', cls: 'ghost' }];
    if (manual && c.item_id) A.unshift({ label: '🗑️ حذف العمود', cls: 'ghost', onClick: async () => { if (!await confirmBox(`حذف العمود «${c.title}» وكل درجاته؟`, 'حذف')) return false;
      await call('gb_item_delete', { p_id: c.item_id }); toast('حُذف العمود'); openSheet(CID, SID); } });
    A.push({ label: '💾 حفظ', cls: 'primary', onClick: async (w) => {
      const p = { class_id: CID, subject_id: SID, kind: c.kind, weight: $('#cW', w).value === '' ? 1 : +$('#cW', w).value, hidden: $('#cH', w).checked, period: $('#cP', w).value || null };
      if (manual) { Object.assign(p, { item_id: c.item_id || null, title: $('#cT', w).value.trim(), category: $('#cC', w).value, max_score: +$('#cM', w).value, date: $('#cD', w).value });
        if (!p.title) { toast('اكتب اسم العمود', 'warn'); return false; } if (!(p.max_score > 0)) { toast('حدّد الدرجة العظمى', 'warn'); return false; } }
      else p.src_id = c.src_id;
      await call('gb_item_save', { p }); toast('حُفظ'); openSheet(CID, SID); } });
    modal({ title: c.item_id || !manual ? 'إعدادات العمود' : 'عمود يدوي جديد', body, actions: A });
  }

  // ---------------- الطالب ----------------
  async function drawStudent() {
    let L; try { L = await call('gb_my'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (!L.length) { view.innerHTML = '<div class="empty">لا توجد درجات مرصودة لك بعد.</div>'; return; }
    view.innerHTML = `<div class="crs" style="margin-bottom:12px">${L.map((s) => `<button data-s="${s.subject_id}"><b>${esc(s.subject)}</b><span class="cnt">${s.pct != null ? num(s.pct) + '%' : 'لم تُرصد بعد'}</span></button>`).join('')}</div>
      ${L.map((s) => `<section class="sub glass" id="s${s.subject_id}"><h3>${esc(s.subject)} <span>النهائي ${pctHTML(s.pct)}</span></h3>
        ${byPeriod(s.columns).map(([k, C]) => `<h4 class="perh">${esc(PER[k])} <span>${pctHTML(pctOf(C, s.scores))}</span></h4>
        <div class="table-wrap"><table><thead><tr><th>البند</th><th>النوع</th><th>التاريخ</th><th>درجتك</th></tr></thead><tbody>
        ${C.map((c) => { const v = s.scores[c.key]; return `<tr${+c.weight === 0 ? ' class="hint"' : ''}><td>${esc(c.title)}</td><td>${esc(CAT[c.category] || '')}</td><td>${esc(dshort(c.date))}</td>
          <td>${v != null ? `<b>${esc(num(v))}</b> / ${esc(num(c.max))}` : '<span class="hint">لم تُرصد</span>'}</td></tr>`; }).join('')}</tbody></table></div>`).join('')}</section>`).join('')}`;
    view.onclick = (e) => { const b = e.target.closest('[data-s]'); if (b) $('#s' + b.dataset.s)?.scrollIntoView({ behavior: 'smooth' }); };
  }
})();
