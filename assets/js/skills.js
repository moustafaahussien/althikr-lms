/* =====================================================================
   جواز مهارات القرن 21 (sql/54)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role, STAFF = !['student', 'parent'].includes(role);
  if (role === 'parent') { view.innerHTML = '<div class="notice">جواز المهارات يظهر لولي الأمر في بوابته من حساب ابنه.</div>'; return; }
  if (!LMS.betaAllowed('skills', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  const LV = { 1: 'مستكشف', 2: 'ممارس', 3: 'متقن', 4: 'مُلهِم' };
  const KIND = { session: 'حصة / جلسة', activity: 'نشاط', project: 'مشروع', competition: 'مسابقة', exhibition: 'معرض / عرض', other: 'أخرى' };
  const TODAY = LMS.ymd(new Date());
  let PROGS = [], GROUPS = [];
  try { [PROGS, GROUPS] = await Promise.all([call('sk_programs_list'), STAFF ? call('att_my_groups') : []]); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  const P = Object.fromEntries(PROGS.map((p) => [p.code, p]));

  const tabs = STAFF ? [['add', '✍️ تسجيل مشاركة'], ['pass', '🎫 جواز طالب'], ['stats', '📊 إحصاءات الوحدة']] : [['pass', '🎫 جوازي']];
  let TAB = tabs.some((t) => t[0] === location.hash.slice(1)) ? location.hash.slice(1) : tabs[0][0];
  $('#tabs').innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${k === TAB ? 'on' : ''}">${l}</button>`).join('');
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (b) go(b.dataset.t); };
  function go(t, arg) { TAB = t; history.replaceState(null, '', '#' + t); $$('#tabs button').forEach((x) => x.classList.toggle('on', x.dataset.t === t)); view.onclick = null;
    ({ add: paintAdd, pass: paintPass, stats: paintStats })[t](arg); }

  // ============================ تسجيل ============================
  let G = '', C = '', SEL = new Set();
  function paintAdd() {
    view.innerHTML = `<div class="sk-grid"><div class="glass card"><h3 style="margin-top:0">1) الطلاب</h3>
        <div class="form-grid"><label class="f">الصف<select id="g"><option value="">— اختر —</option>${GROUPS.map((g) => `<option value="${g.grade_id}" ${String(g.grade_id) === G ? 'selected' : ''}>${esc(g.label)}</option>`).join('')}</select></label>
          <label class="f">الفصل<select id="c"><option value="">كل الفصول</option></select></label></div>
        <div class="toolbar" style="margin:8px 0"><input id="q" type="search" class="grow" placeholder="ابحث…"><button class="btn sm" id="all">تحديد الكل</button><button class="btn sm" id="none">إلغاء</button></div>
        <div id="roster" class="sk-roster"><div class="hint">اختر الصف.</div></div></div>
      <div class="glass card"><h3 style="margin-top:0">2) المشاركة</h3>
        <div class="sk-progs">${PROGS.map((p, i) => `<label><input type="radio" name="pg" value="${p.code}" ${i ? '' : 'checked'}><span>${p.icon} ${esc(p.name)}</span></label>`).join('')}</div>
        <label class="f">النشاط / المشاركة *<input id="act" placeholder="مثال: مهرجان الذكاء العاطفي، مشروع «حديقتي الذكية»…"></label>
        <div class="form-grid"><label class="f">النوع<select id="kd">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
          <label class="f">المستوى<select id="lv">${Object.entries(LV).map(([k, v]) => `<option value="${k}">${k} — ${v}</option>`).join('')}</select></label>
          <label class="f">الساعات<input id="hr" type="number" min="0" step="0.5" value="1"></label>
          <label class="f">التاريخ<input id="dt" type="date" value="${TODAY}" max="${TODAY}"></label></div>
        <label class="f">رابط الدليل (صور/فيديو/ملف — اختياري)<input id="ev" dir="ltr" placeholder="https://"></label>
        <label class="f">ملاحظة (اختياري)<input id="nt"></label>
        <p class="hint">المستويات: <b>1 مستكشف</b> (يتعرّف ويشارك) · <b>2 ممارس</b> (يطبّق بتوجيه) · <b>3 متقن</b> (ينفّذ مشروعًا مستقلًا) · <b>4 مُلهِم</b> (يقود زملاءه أو يمثّل المدرسة).</p>
        <button class="btn primary" id="save" style="width:100%" disabled>اختر الطلاب أولًا</button></div></div>`;
    const fillC = () => { const g = GROUPS.find((x) => String(x.grade_id) === G); $('#c').innerHTML = '<option value="">كل الفصول</option>' + (g ? g.classes.map((c) => `<option value="${c.id}" ${String(c.id) === C ? 'selected' : ''}>${esc(c.name)}</option>`).join('') : ''); };
    const sel = () => { const b = $('#save'); b.disabled = !SEL.size; b.textContent = SEL.size ? `تسجيل المشاركة لـ ${SEL.size} طالب` : 'اختر الطلاب أولًا'; };
    const load = async () => { SEL = new Set(); sel(); if (!G) return;
      $('#roster').innerHTML = '<div class="hint">جارٍ التحميل…</div>';
      try { const L = await call('bh_roster', { p_grade: +G, p_class: C ? +C : null });
        $('#roster').innerHTML = L.map((s) => `<label class="sk-st" data-n="${esc(LMS.norm(s.name))}"><input type="checkbox" data-s="${s.id}"><span class="grow">${esc(s.name)} <small class="hint">${esc(s.class || '')}</small></span></label>`).join('') || '<div class="hint">لا يوجد طلاب.</div>';
      } catch (e) { $('#roster').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; } };
    $('#g').onchange = (e) => { G = e.target.value; C = ''; fillC(); load(); };
    $('#c').onchange = (e) => { C = e.target.value; load(); };
    $('#q').oninput = (e) => { const v = LMS.norm(e.target.value); $$('#roster .sk-st').forEach((l) => { l.style.display = !v || l.dataset.n.includes(v) ? '' : 'none'; }); };
    $('#all').onclick = () => { $$('#roster [data-s]').forEach((c) => { if (c.closest('.sk-st').style.display !== 'none') { c.checked = true; SEL.add(c.dataset.s); } }); sel(); };
    $('#none').onclick = () => { $$('#roster [data-s]').forEach((c) => { c.checked = false; }); SEL.clear(); sel(); };
    $('#roster').onchange = (e) => { const c = e.target.closest('[data-s]'); if (c) { c.checked ? SEL.add(c.dataset.s) : SEL.delete(c.dataset.s); sel(); } };
    $('#save').onclick = async () => {
      const b = $('#save'); b.disabled = true;
      try { const r = await call('sk_add', { p: { students: [...SEL], program: $('[name=pg]:checked').value, activity: $('#act').value, kind: $('#kd').value, level: $('#lv').value,
          hours: $('#hr').value, date: $('#dt').value, evidence: $('#ev').value, note: $('#nt').value } });
        toast(`سُجّلت المشاركة لـ ${r.count} طالب ✓`); $('#none').click();
      } catch (e) { toast(errMsg(e), 'err'); sel(); }
    };
    if (!GROUPS.length) $('#roster').innerHTML = '<div class="notice">لا توجد فصول ضمن نطاقك.</div>';
    if (G) { fillC(); load(); }
  }

  // ============================ الجواز ============================
  function paintPass(sid) {
    view.innerHTML = STAFF ? `<div class="toolbar glass" style="padding:10px"><input id="sq" class="grow" type="search" placeholder="اكتب اسم الطالب أو رقمه…"></div><div id="sr"></div><div id="pv"></div>` : '<div id="pv"></div>';
    const show = async (id) => {
      $('#pv').innerHTML = '<div class="empty">جارٍ التحميل…</div>'; if ($('#sr')) $('#sr').innerHTML = '';
      let d; try { d = await call('sk_passport', { p_student: id || null }); } catch (e) { $('#pv').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      const done = d.programs.filter((p) => p.count).length, hrs = d.programs.reduce((a, p) => a + Number(p.hours || 0), 0);
      $('#pv').innerHTML = `<div class="glass card passport" id="ppt">
          <div class="pp-head"><div><div class="hint">مدارس دار الذكر — وحدة مهارات القرن 21</div><h2 style="margin:4px 0">🎫 جواز مهارات القرن 21</h2>
            <b style="font-size:1.15rem">${esc(d.student.name)}</b> <span class="hint">${esc(d.student.class || '')}</span></div>
            <div class="pp-sum"><div><b>${done}/6</b><span>برامج</span></div><div><b>${d.records.length}</b><span>مشاركة</span></div><div><b>${hrs}</b><span>ساعة</span></div></div></div>
          <div class="pp-grid">${d.programs.map((p) => `<div class="pp-card ${p.count ? 'on' : ''}"><div class="ic">${p.icon}</div><b>${esc(p.name)}</b>
            <div class="stars">${[1, 2, 3, 4].map((i) => `<span class="${i <= (p.level || 0) ? 'f' : ''}">★</span>`).join('')}</div>
            <small>${p.count ? `${LV[p.level]} · ${p.count} مشاركة · ${Number(p.hours)} س` : 'لم يبدأ بعد'}</small></div>`).join('')}</div>
          ${d.records.length ? `<h3 style="margin:16px 0 8px">سجل المشاركات</h3><div class="table-wrap no-tools"><table><thead><tr><th>التاريخ</th><th>البرنامج</th><th>المشاركة</th><th>المستوى</th><th>س</th><th class="no-print"></th></tr></thead><tbody>
            ${d.records.map((r) => `<tr><td>${esc(r.date)}</td><td>${P[r.program] ? P[r.program].icon + ' ' + esc(P[r.program].name) : ''}</td><td>${esc(r.activity)} <span class="hint">(${KIND[r.kind]})</span>
              ${r.evidence ? ` <a href="${esc(r.evidence)}" target="_blank" rel="noopener" class="no-print">📎 الدليل</a>` : ''}${r.note ? `<div class="hint">${esc(r.note)}</div>` : ''}</td><td>${LV[r.level]}</td><td>${Number(r.hours)}</td>
              <td class="no-print">${(r.mine || d.manager) && STAFF ? `<button class="btn sm ghost danger" data-del="${r.id}">✕</button>` : ''}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا توجد مشاركات مسجّلة بعد.</div>'}
        </div><div style="margin-top:10px"><button class="btn" id="prt">🖨️ طباعة الجواز</button></div>`;
      $('#prt').onclick = () => { const h = $('#ppt').cloneNode(true); h.querySelectorAll('.no-print').forEach((x) => x.remove()); LMS.printHTML(`جواز مهارات القرن 21 — ${d.student.name}`, `<style>${PASS_CSS}</style>` + h.outerHTML); };
      view.onclick = async (e) => { const b = e.target.closest('[data-del]'); if (!b) return; if (!await confirmBox('حذف هذه المشاركة من الجواز؟', 'حذف')) return;
        try { await call('sk_delete', { p_id: +b.dataset.del }); show(id); } catch (er) { toast(errMsg(er), 'err'); } };
    };
    if (STAFF) { let tm; $('#sq').oninput = (e) => { clearTimeout(tm); const q = e.target.value.trim(); if (q.length < 2) { $('#sr').innerHTML = ''; return; }
      tm = setTimeout(async () => { try { const L = await call('pf_find', { p_q: q });
        $('#sr').innerHTML = `<div class="glass card">${L.map((s) => `<a href="#" class="sk-st" data-stu="${s.id}"><b>${esc(s.name)}</b> <span class="hint">${esc(s.class || '')}</span></a>`).join('') || '<div class="hint">لا نتائج.</div>'}</div>`;
      } catch (er) { toast(errMsg(er), 'err'); } }, 300); };
      $('#sr').onclick = (e) => { const s = e.target.closest('[data-stu]'); if (s) { e.preventDefault(); show(s.dataset.stu); } };
      if (sid) show(sid);
    } else show(null);
  }
  const PASS_CSS = `.pp-head{display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap}.pp-sum{display:flex;gap:10px}.pp-sum div{text-align:center;background:#F5F8F6;border-radius:10px;padding:6px 12px}.pp-sum b{display:block;font-size:1.3rem;color:#007B51}.pp-sum span{font-size:.75rem;color:#667}
    .pp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}.pp-card{border:1px dashed #cfd8d3;border-radius:14px;padding:12px;text-align:center;opacity:.55}.pp-card.on{opacity:1;border:1px solid #007B51;background:#f3fbf7}
    .pp-card .ic{font-size:1.8rem}.pp-card small{display:block;color:#667;font-size:.78rem}.stars span{color:#d6dbd8;font-size:1.1rem}.stars span.f{color:#e0a800}`;

  // ============================ إحصاءات ============================
  async function paintStats() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let d; try { d = await call('sk_stats', {}); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `<div id="rep"><p class="hint">آخر 12 شهرًا — ضمن الطلاب الذين تراهم.</p>
      <div class="kpi4"><div class="card-box glass"><b>${d.students}</b><div class="hint">طالب مستفيد</div></div><div class="card-box glass"><b>${d.records}</b><div class="hint">مشاركة مسجّلة</div></div>
        <div class="card-box glass"><b>${Number(d.hours)}</b><div class="hint">ساعة</div></div><div class="card-box glass"><b>${d.multi}</b><div class="hint">طالب في 3 برامج أو أكثر</div></div></div>
      <div class="glass card" style="margin-top:14px"><h3 style="margin-top:0">حسب البرنامج</h3><div class="table-wrap" data-title="إحصاءات برامج الوحدة"><table><thead><tr><th>البرنامج</th><th>طلاب</th><th>مشاركات</th><th>ساعات</th>${Object.values(LV).map((l) => `<th>${l}</th>`).join('')}</tr></thead><tbody>
        ${d.by_program.map((p) => `<tr><td>${p.icon} ${esc(p.name)}</td><td><b>${p.students}</b></td><td>${p.records}</td><td>${Number(p.hours)}</td>${[1, 2, 3, 4].map((l) => `<td>${(p.levels || {})[l] || 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>
      <div class="glass card" style="margin-top:14px"><h3 style="margin-top:0">حسب المرحلة</h3>${d.by_stage.map((s) => `<div class="toolbar" style="margin:4px 0"><span class="grow">${esc(s.stage)}</span><b>${s.students}</b></div>`).join('') || '<div class="hint">لا بيانات.</div>'}</div></div>
      <button class="btn" id="prt" style="margin-top:10px">🖨️ طباعة التقرير</button>`;
    $('#prt').onclick = () => LMS.printHTML('تقرير وحدة مهارات القرن 21', $('#rep').innerHTML);
  }

  go(TAB);
})();
