/* الحضور والغياب: تسجيل يومي/لكل حصة + تقارير الفترة + سجل الطالب */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, ymd, hijri } = LMS;
  const ctx = await requireAuth(['admin', 'leadership', 'principal', 'supervisor', 'teacher', 'staff']);
  const ST = { '': 'حاضر', absent: 'غائب', late: 'متأخر', excused: 'غائب بعذر' };
  const today = ymd(new Date());

  // ---------- التبويبات ----------
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return;
    $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'rep' && !$('#rep').dataset.done) loadReport(); };

  // ---------- تسجيل الحضور ----------
  let GROUPS = [], ROSTER = null, MARKS = {}, DIRTY = false;
  // الافتراضي: اليوم إن كان دراسيًا، وإلا آخر يوم دراسي قبله
  $('#day').value = (() => { let d = new Date(today + 'T12:00:00'); for (let i = 0; i < 120; i++) { const k = LMS.ymd(d); if (LMS.cal.isSchoolDay(k)) return k; d.setDate(d.getDate() - 1); } return today; })(); $('#day').max = today;
  for (let i = 1; i <= 8; i++) $('#per').insertAdjacentHTML('beforeend', `<option value="${i}">الحصة ${i}</option>`);
  try {
    const { data, error } = await sb.rpc('att_my_groups'); if (error) throw error;
    GROUPS = data || [];
  } catch (e) { $('#roster').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
  if (!GROUPS.length) $('#roster').innerHTML = '<div class="notice">لا توجد صفوف مسندة لك. تُحدَّد الصفوف من جداول الحصص (إسناد المعلم) أو من نطاق الصلاحية في لوحة الإدارة.</div>';
  $('#grp').insertAdjacentHTML('beforeend', GROUPS.map((g) => `<option value="${g.grade_id}">${esc(g.label)} (${g.students} طالب)</option>`).join(''));
  try { const last = localStorage.getItem('att_grp'); if (last && GROUPS.some((g) => String(g.grade_id) === last)) $('#grp').value = last; } catch (_) {}
  const fillCls = () => { const g = GROUPS.find((x) => String(x.grade_id) === $('#grp').value);
    const withStudents = g ? g.classes.filter((c) => c.n > 0) : [];
    $('#cls').innerHTML = '<option value="">كل الفصول</option>' + withStudents.map((c) => `<option value="${c.id}">فصل ${esc(c.name)} (${c.n})</option>`).join('');
    $('#cls').style.display = withStudents.length ? '' : 'none'; };
  const guard = async () => !DIRTY || await LMS.confirmBox('لديك تعديلات لم تُحفظ. تجاهلها؟');
  ['grp', 'cls', 'per', 'day'].forEach((k) => { let prev = $('#' + k).value;
    $('#' + k).onchange = async () => { if (!(await guard())) { $('#' + k).value = prev; return; } prev = $('#' + k).value;
      if (k === 'grp') { fillCls(); try { localStorage.setItem('att_grp', $('#grp').value); } catch (_) {} } loadRoster(); }; });
  $('#find').oninput = () => paint();
  fillCls(); if ($('#grp').value) loadRoster();
  window.addEventListener('beforeunload', (e) => { if (DIRTY) { e.preventDefault(); e.returnValue = ''; } });

  async function loadRoster() {
    const g = Number($('#grp').value); if (!g) { $('#roster').innerHTML = '<div class="empty">اختر الصف لعرض الطلاب</div>'; return; }
    $('#roster').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    const { data, error } = await sb.rpc('att_roster', { p_day: $('#day').value, p_grade: g, p_class: Number($('#cls').value) || null, p_period: Number($('#per').value) });
    if (error) { $('#roster').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    ROSTER = data; MARKS = {}; DIRTY = false;
    (data.students || []).forEach((s) => { if (s.status) MARKS[s.id] = { st: s.status, n: s.note || '' }; });
    paint();
  }
  function counts() { const c = { absent: 0, late: 0, excused: 0 }; Object.values(MARKS).forEach((m) => { if (c[m.st] != null) c[m.st]++; }); return c; }
  function paint() {
    if (!ROSTER) return;
    const L = ROSTER.students || [], q = $('#find').value.trim(), c = counts(), per = Number($('#per').value);
    const sess = ROSTER.session;
    const head = `<div class="stats">
      <div class="stat glass p"><b>${L.length - c.absent - c.excused}</b><small>حاضر</small></div>
      <div class="stat glass a"><b>${c.absent}</b><small>غائب</small></div>
      <div class="stat glass l"><b>${c.late}</b><small>متأخر</small></div>
      <div class="stat glass e"><b>${c.excused}</b><small>غائب بعذر</small></div></div>
      ${!LMS.cal.isSchoolDay($('#day').value) ? `<div class="notice warn" style="margin:0 0 8px">🏖️ هذا اليوم ليس يومًا دراسيًا حسب التقويم (${esc(LMS.cal.why($('#day').value))}) — لا يلزم تسجيل الحضور.</div>` : ''}
      ${sess ? `<div class="notice" style="margin:0 0 8px">✓ مسجَّل بواسطة <b>${esc(sess.by || '')}</b> — ${esc(new Date(sess.taken_at).toLocaleString('ar-SA-u-ca-gregory-nu-latn'))}. أي حفظ جديد يستبدل التسجيل السابق.</div>`
        : `<div class="notice warn" style="margin:0 0 8px">لم يُسجَّل حضور ${per ? 'الحصة ' + per : 'اليوم'} لهذا ${$('#cls').value ? 'الفصل' : 'الصف'} بعد (${esc(hijri($('#day').value))}). الجميع «حاضر» افتراضيًا — حدّد الغائب والمتأخر فقط ثم احفظ.</div>`}`;
    const rows = L.filter((s) => !q || LMS.has(s.name, q) || LMS.has(String(s.no || ''), q));
    $('#roster').innerHTML = head + `<div class="table-wrap" data-title="كشف الحضور — ${esc($('#grp').selectedOptions[0].textContent)} — ${$('#day').value}" style="max-height:none"><table>
      <thead><tr><th>#</th><th>الطالب</th><th>رقم الطالب</th><th>الفصل</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>
      ${rows.map((s, i) => { const m = MARKS[s.id] || { st: '', n: '' };
        return `<tr class="st-${m.st}" data-id="${s.id}"><td>${i + 1}</td><td><b>${esc(s.name)}</b>${per && s.daily ? ` <span class="dot ${s.daily}" title="حالته في الحضور اليومي">${ST[s.daily]} يوميًا</span>` : ''}</td>
          <td>${esc(s.no || '')}</td><td>${esc(s.class || '')}</td>
          <td><span class="seg no-print">${['', 'absent', 'late', 'excused'].map((k) => `<button type="button" data-s="${k}" class="${m.st === k ? 'on' : ''}">${ST[k]}</button>`).join('')}</span><span style="display:none">${ST[m.st]}</span></td>
          <td><input class="note-in" value="${esc(m.n)}" placeholder="${m.st ? 'سبب / ملاحظة' : ''}" ${m.st ? '' : 'disabled'}></td></tr>`; }).join('')}
      </tbody></table>
      <div class="savebar no-print"><span class="hint">${DIRTY ? '⚠️ تعديلات غير محفوظة' : 'المحدد: ' + (c.absent + c.late + c.excused) + ' طالب'}</span>
        <span style="display:flex;gap:8px"><button class="btn sm" id="allP">الكل حاضر</button><button class="btn primary" id="save">💾 حفظ الحضور</button></span></div></div>`;
    $('#save').onclick = save;
    $('#allP').onclick = () => { MARKS = {}; DIRTY = true; paint(); };
  }
  $('#roster').addEventListener('click', (e) => {
    const b = e.target.closest('.seg button'); if (!b) return;
    const id = b.closest('tr').dataset.id; const st = b.dataset.s;
    if (st) MARKS[id] = { st, n: (MARKS[id] || {}).n || '' }; else delete MARKS[id];
    DIRTY = true; paint();
    const inp = $(`tr[data-id="${id}"] .note-in`); if (st && inp) inp.focus();
  });
  $('#roster').addEventListener('input', (e) => { const i = e.target.closest('.note-in'); if (!i) return;
    const id = i.closest('tr').dataset.id; if (MARKS[id]) { MARKS[id].n = i.value; DIRTY = true; } });
  async function save() {
    if (!LMS.cal.isSchoolDay($('#day').value) && !await LMS.confirmBox(`هذا اليوم ليس يومًا دراسيًا (${LMS.cal.why($('#day').value)}). حفظ الحضور على أي حال؟`, 'حفظ')) return;
    const b = $('#save'); b.disabled = true;
    const marks = Object.entries(MARKS).map(([s, m]) => ({ s, st: m.st, n: m.n }));
    const { data, error } = await sb.rpc('att_save', { p_day: $('#day').value, p_grade: Number($('#grp').value), p_class: Number($('#cls').value) || null, p_period: Number($('#per').value), p_marks: marks });
    b.disabled = false;
    if (error) { toast(errMsg(error), 'err'); return; }
    DIRTY = false; toast(`تم الحفظ ✓ — غائب ${data.absent}، متأخر ${data.late}، بعذر ${data.excused} من ${data.total}`);
    loadRoster();
  }

  // ---------- التقارير ----------
  const setRange = (k) => { const d = new Date();
    if (k === 'today') { $('#from').value = $('#to').value = today; }
    else if (k === 'week') { const s = new Date(d); s.setDate(d.getDate() - d.getDay()); $('#from').value = ymd(s); $('#to').value = today; }
    else { const s = new Date(d); s.setDate(d.getDate() - 30); $('#from').value = ymd(s); $('#to').value = today; } };
  setRange('week');
  $$('[data-r]').forEach((b) => { b.onclick = () => { setRange(b.dataset.r); loadReport(); }; });
  $('#repGo').onclick = loadReport;
  let REP = null;
  async function loadReport() {
    $('#rep').dataset.done = '1'; $('#rep').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    const { data, error } = await sb.rpc('att_report', { p_from: $('#from').value, p_to: $('#to').value });
    if (error) { $('#rep').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    REP = data; const G = data.grades || [], S = data.students || [];
    const tot = G.reduce((a, g) => ({ a: a.a + g.absent, l: a.l + g.late, e: a.e + g.excused }), { a: 0, l: 0, e: 0 });
    const notTaken = $('#from').value === $('#to').value ? G.filter((g) => !g.days_taken) : [];
    $('#rep').innerHTML = `<div class="stats">
        <div class="stat glass a"><b>${tot.a}</b><small>حالات غياب</small></div><div class="stat glass l"><b>${tot.l}</b><small>حالات تأخر</small></div>
        <div class="stat glass e"><b>${tot.e}</b><small>غياب بعذر</small></div><div class="stat glass"><b>${S.length}</b><small>طالب له غياب أو تأخر</small></div></div>
      ${notTaken.length ? `<div class="notice warn">لم يُسجَّل الحضور اليومي في: ${notTaken.map((g) => esc(g.label)).join('، ')}</div>` : ''}
      <div class="section-title"><h2>حسب الصف</h2><span class="hint">${esc($('#from').value)} → ${esc($('#to').value)}</span></div>
      <div class="table-wrap" data-title="تقرير الحضور حسب الصف ${esc($('#from').value)} إلى ${esc($('#to').value)}" style="max-height:none"><table>
        <thead><tr><th>الصف</th><th>الطلاب</th><th>أيام مسجّلة</th><th>غياب</th><th>تأخر</th><th>بعذر</th><th>نسبة الحضور</th><th>آخر تسجيل</th></tr></thead><tbody>
        ${G.map((g) => { const base = g.students * g.days_taken; const pct = base ? Math.round((1 - (g.absent + g.excused) / base) * 1000) / 10 : null;
          return `<tr><td><b>${esc(g.label)}</b></td><td>${g.students}</td><td>${g.days_taken}</td><td>${g.absent}</td><td>${g.late}</td><td>${g.excused}</td>
            <td>${pct == null ? '—' : pct + '%'}</td><td>${g.last ? esc(g.last.day) + ' — ' + esc(g.last.by || '') : '<span class="hint">لم يُسجَّل</span>'}</td></tr>`; }).join('')}
        </tbody></table></div>
      <div class="section-title"><h2>الطلاب الأكثر غيابًا وتأخرًا</h2></div>
      ${S.length ? `<div class="table-wrap" data-title="الطلاب الأكثر غيابًا ${esc($('#from').value)} إلى ${esc($('#to').value)}" style="max-height:none"><table>
        <thead><tr><th>#</th><th>الطالب</th><th>الصف</th><th>الفصل</th><th>غياب</th><th>تأخر</th><th>بعذر</th><th class="actions"></th></tr></thead><tbody>
        ${S.map((s, i) => `<tr><td>${i + 1}</td><td><b>${esc(s.name)}</b></td><td>${esc(s.grade)}</td><td>${esc(s.class || '')}</td><td>${s.absent}</td><td>${s.late}</td><td>${s.excused}</td>
          <td class="actions"><button class="btn sm" data-stu="${i}">السجل</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">لا يوجد غياب أو تأخر في هذه الفترة 🎉</div>'}`;
  }
  $('#rep').addEventListener('click', (e) => { const b = e.target.closest('[data-stu]'); if (!b) return;
    const s = REP.students[Number(b.dataset.stu)];
    modal({ title: 'سجل ' + s.name, body: `<p class="hint">${esc(s.grade)}${s.class ? ' / ' + esc(s.class) : ''}</p><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>هجري</th><th>الحالة</th><th>ملاحظة</th></tr></thead><tbody>
      ${s.days.map((d) => `<tr><td>${esc(d.d)}</td><td>${esc(hijri(d.d))}</td><td><span class="dot ${d.s}">${ST[d.s]}</span></td><td>${esc(d.n || '')}</td></tr>`).join('')}</tbody></table></div>`,
      actions: [{ label: 'إغلاق', cls: 'primary', value: true }] });
  });
})();
