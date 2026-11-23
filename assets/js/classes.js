/* =====================================================================
   الفصول والطلاب: فصول نطاق المستخدم وطلابها (cls_overview / cls_students — sql/41)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">هذه الصفحة لمنسوبي المدرسة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };

  let L = [];
  try { L = await call('cls_overview'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  window.addEventListener('hashchange', route);
  $('#fQ').oninput = list; $('#fAbs').onchange = list;
  route();
  function route() { const m = /c=(\d+)/.exec(location.hash); if (m) openClass(+m[1]); else list(); }

  function list() {
    $('#fQ').closest('.toolbar').hidden = false;
    const q = $('#fQ').value.trim(), abs = $('#fAbs').checked;
    const R = L.filter((c) => (!q || [c.label, c.homeroom].join(' ').includes(q)) && (!abs || c.absent_today));
    const tot = L.reduce((a, c) => a + c.students, 0), ab = L.reduce((a, c) => a + c.absent_today, 0);
    const SD = LMS.cal.isSchoolDay(LMS.ymd(new Date())), WHY = LMS.cal.why(LMS.ymd(new Date()));
    const groups = []; R.forEach((c) => { const k = c.stage + '|' + c.grade; let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, stage: c.stage, grade: c.grade, cs: [] }); g.cs.push(c); });
    view.innerHTML = `<div class="kpis"><span><b>${L.length}</b> فصل</span><span><b>${tot}</b> طالب</span>${SD ? `<span>غياب اليوم: <b style="color:#a3244a">${ab}</b></span>
        <span>لم يُسجَّل حضورها اليوم: <b>${L.filter((c) => !c.att_taken).length}</b> فصل</span>` : `<span>🏖️ اليوم ليس يومًا دراسيًا: <b>${esc(WHY)}</b></span>`}</div>
      ${groups.length ? groups.map((g) => `<h3 class="sec-h">${esc(g.grade)} — ${esc(g.stage)} <span class="hint">(${g.cs.reduce((a, c) => a + c.students, 0)} طالب)</span></h3>
        <div class="cls">${g.cs.map((c) => `<button class="cl" data-c="${c.id}"><b>${esc(g.grade)} / ${esc(c.name)}</b><small>${c.students} طالب · ${c.teachers} معلم</small>
          <small>رائد الفصل: ${esc(c.homeroom || '—')}</small>${!SD ? '' : !c.att_taken ? '<span class="ab no">الحضور لم يُسجَّل اليوم</span>' : c.absent_today ? `<span class="ab hot">${c.absent_today} غائب اليوم</span>` : '<span class="ab">✓ لا غياب اليوم</span>'}</button>`).join('')}</div>`).join('')
        : '<div class="empty">لا توجد فصول ضمن نطاقك.</div>'}`;
    view.onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) location.hash = 'c=' + b.dataset.c; };
  }

  async function openClass(id) {
    $('#fQ').closest('.toolbar').hidden = true; view.onclick = null;
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let D; try { D = await call('cls_students', { p_class: id }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div><a class="btn ghost" href="#">→ رجوع</a>`; return; }
    const S = D.students;
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><a class="btn ghost sm" href="#">→ الفصول</a><b class="grow">${esc(D.class)}</b><span class="hint">رائد الفصل: ${esc(D.homeroom || '—')}</span></div>
      <div class="kpis"><span><b>${S.length}</b> طالب</span><span>غياب (60 يومًا): <b>${S.reduce((a, s) => a + s.absent, 0)}</b></span><span>إنجازات معتمدة: <b>${S.reduce((a, s) => a + s.pf, 0)}</b></span></div>
      ${(D.teachers || []).length ? `<details class="glass" style="padding:8px 12px;margin-bottom:10px"><summary>معلمو الفصل (${D.teachers.length})</summary><div class="chips" style="margin-top:6px">${D.teachers.sort((a, b) => a.subject.localeCompare(b.subject, 'ar')).map((t) => `<span class="chip gray">${esc(t.subject)}: ${esc(t.name)}</span>`).join('')}</div></details>` : ''}
      <div class="toolbar"><input id="sQ" class="grow" type="search" placeholder="ابحث باسم الطالب أو رقمه…"></div>
      <div class="table-wrap" data-title="طلاب ${esc(D.class)}"><table id="sT"><thead><tr><th>#</th><th>الطالب</th><th>الرقم</th><th>ولي الأمر</th><th>الجوال</th><th>غياب</th><th>تأخر</th><th>الإنجازات</th></tr></thead><tbody>
      ${S.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.no || '')}</td><td>${esc(s.guardian || '')}</td><td dir="ltr">${esc(s.phone || '')}</td>
        <td>${s.absent ? `<b style="color:#a3244a">${s.absent}</b>` : 0}</td><td>${s.late}</td><td><a href="portfolio.html#s=${esc(s.id)}">${s.pf ? '🏅 ' + s.pf : 'فتح الملف'}</a></td></tr>`).join('') || '<tr><td colspan="8" class="empty">لا يوجد طلاب مربوطون بهذا الفصل بعد</td></tr>'}</tbody></table></div>`;
    $('#sQ').oninput = (e) => { const q = e.target.value.trim(); $$('#sT tbody tr').forEach((tr) => { tr.hidden = !!q && !tr.innerText.includes(q); }); };
  }
})();
