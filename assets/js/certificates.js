/* =====================================================================
   قسم إصدار الشهادات (للإداريين ومعهم مكتب الإشراف)
   - قوالب جاهزة ونص قابل للتعديل بالكامل مع حقول {الاسم} {الصف} …
   - المستلمون: طلاب أو معلمون من المنصة، أو ملف Excel / Word، أو كتابة يدوية
   - إصدار وطباعة الكل بضغطة واحدة، ولكل شهادة رقم تحقق — sql/46 (cert_*)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { $('#tabs').hidden = true; view.innerHTML = '<div class="notice">إصدار الشهادات للإداريين فقط.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let DEF;
  try { DEF = await call('cert_defaults'); }
  catch (e) { $('#tabs').hidden = true; view.innerHTML = `<div class="notice">${esc(errMsg(e))}</div>`; return; }

  const today = LMS.ymd(new Date());
  const TPL = {
    thanks: { label: '🙏 شكر وتقدير', title: 'شهادة شكر وتقدير', en: 'Certificate of Appreciation',
      body: 'تتقدم {المدرسة} بخالص الشكر والتقدير إلى {اللقب}\n{الاسم}\n{الوظيفة}\nتقديرًا لجهوده/ا المتميزة وعطائه/ا المخلص، متمنين له/ا دوام التوفيق والنجاح.' },
    excel: { label: '🏅 تفوق دراسي', title: 'شهادة تفوق', en: 'Certificate of Excellence',
      body: 'تمنح {المدرسة} هذه الشهادة إلى {اللقب}\n{الاسم}\nبـ**{الصف} / {الفصل}** تقديرًا لتفوقه/ا الدراسي وتميزه/ا، متمنين له/ا مزيدًا من التقدم والنجاح.' },
    honor: { label: '⭐ تميز', title: 'شهادة تميز', en: 'Certificate of Distinction',
      body: 'تمنح {المدرسة} شهادة التميز إلى {اللقب}\n{الاسم}\nتقديرًا لتميزه/ا في [[المجال]]، متمنين له/ا دوام التألق.' },
    attend: { label: '✅ حضور', title: 'شهادة حضور', en: 'Certificate of Attendance',
      body: 'تشهد {المدرسة} بأن {اللقب}\n{الاسم}\nقد حضر/ت [[اسم البرنامج أو الفعالية]] بتاريخ {التاريخ}، متمنين له/ا دوام التوفيق.' },
    part: { label: '🤝 مشاركة', title: 'شهادة مشاركة', en: 'Certificate of Participation',
      body: 'تتقدم {المدرسة} بالشكر إلى {اللقب}\n{الاسم}\nلمشاركته/ا الفاعلة في [[اسم الفعالية]]، متمنين له/ا مزيدًا من العطاء.' },
    custom: { label: '✏️ نص حر', title: 'شهادة', en: '', body: '{الاسم}' }
  };
  const S = { kind: 'thanks', title: TPL.thanks.title, en: TPL.thanks.en, body: TPL.thanks.body, date: today,
    sigs: (DEF.sigs || []).concat([{ t: '', n: '' }]).slice(0, 3), ltr: false, lqStudent: 'الطالب/ة', lqStaff: 'الأستاذ/ة' };
  let R = [];            // المستلمون: {name, rtype, profile_id, vars}
  let PI = 0;            // رقم المعاينة
  let SRC = 'students';


  // ---------------- الحقول لكل مستلم ----------------
  const fmt = (d) => DCert.fmtDate(d, S.ltr);
  function varsOf(r) {
    const v = Object.assign({ 'المدرسة': DEF.school, 'التاريخ': fmt(S.date), 'اللقب': r.rtype === 'student' ? S.lqStudent : r.rtype === 'staff' ? S.lqStaff : '',
      'الصف': '', 'الفصل': '', 'المرحلة': '', 'الوظيفة': '' }, r.vars || {});
    return v;
  }
  function certOf(r, no) {
    return { no, name: r.name, date: S.date, title: S.title, en: S.en, ltr: S.ltr, school: DEF.school, sigs: S.sigs,
      body: DCert.fill(S.body, varsOf(r)), verify: no ? location.href.replace(/[^/]*([?#].*)?$/, '') + 'certificate.html?no=' + no : '' };
  }

  // ---------------- إصدار جديد ----------------
  function newView() {
    view.onclick = null;
    view.innerHTML = `<div class="cw"><div>
      <section class="card glass sec"><h3>١) نوع الشهادة ونصها</h3>
        <div class="tpls" id="tpls">${Object.entries(TPL).map(([k, t]) => `<button data-k="${k}" class="${S.kind === k ? 'on' : ''}">${t.label}</button>`).join('')}</div>
        <div class="form-grid"><label class="f">عنوان الشهادة<input id="title" value="${esc(S.title)}"></label>
          <label class="f">العنوان بالإنجليزي (اختياري)<input id="en" dir="ltr" value="${esc(S.en)}"></label></div>
        <label class="f">نص الشهادة<textarea id="body">${esc(S.body)}</textarea></label>
        <div class="vars" id="vars">${['الاسم', 'اللقب', 'الصف', 'الفصل', 'المرحلة', 'الوظيفة', 'التاريخ', 'المدرسة'].map((k) => `<button data-v="${k}">{${k}}</button>`).join('')}<span id="xvars"></span></div>
        <p class="hint" style="margin:4px 0 0">اضغط حقلًا لإدراجه. <b>{الاسم}</b> يظهر سطرًا كبيرًا بالأخضر، و<b>**نص**</b> بالبرتقالي، و<b>[[نص]]</b> داخل شريط أخضر. أعمدة ملف Excel تصبح حقولًا بأسمائها.</p>
        <div class="form-grid" style="margin-top:8px"><label class="f">التاريخ<input type="date" id="date" value="${esc(S.date)}"></label>
          <label class="f">لقب الطلاب<input id="lqS" value="${esc(S.lqStudent)}"></label><label class="f">لقب المعلمين<input id="lqT" value="${esc(S.lqStaff)}"></label>
          <label class="f" style="justify-content:end"><span><input type="checkbox" id="ltr" ${S.ltr ? 'checked' : ''}> شهادة بالإنجليزية (من اليسار لليمين)</span></label></div>
        <h3 style="margin-top:12px">الموقّعون</h3>
        <div class="sigs" id="sigs">${S.sigs.map((s, i) => `<label class="f">المسمّى<input data-st="${i}" value="${esc(s.t)}"></label><label class="f">الاسم<input data-sn="${i}" value="${esc(s.n)}"></label><button class="btn sm ghost" data-sx="${i}" title="مسح">✕</button>`).join('')}</div>
      </section>
      <section class="card glass sec"><h3>٢) المستلمون <span class="hint" id="rc"></span></h3>
        <div class="rt" id="rt">${[['students', '🎒 طلاب من المنصة'], ['staff', '👩‍🏫 معلمون وموظفون'], ['file', '📄 ملف Excel / Word'], ['manual', '⌨️ كتابة الأسماء']].map(([k, t]) => `<button data-s="${k}" class="${SRC === k ? 'on' : ''}">${t}</button>`).join('')}</div>
        <div id="src"></div>
        <div class="toolbar" style="margin:10px 0 6px"><b class="grow">القائمة</b><button class="btn sm ghost" id="clr">🗑 مسح القائمة</button></div>
        <div class="rl" id="rl"></div>
      </section></div>
      <div class="prev"><section class="card glass sec"><h3>معاينة</h3><div class="pv" id="pv"></div>
        <div class="toolbar" style="margin-top:8px;justify-content:center"><button class="btn sm" id="pp">→</button><span class="hint" id="pn"></span><button class="btn sm" id="pnx">←</button></div>
        <div class="toolbar" style="margin-top:10px"><button class="btn primary grow" id="go">🎓 إصدار وطباعة</button><button class="btn" id="draft" title="طباعة بدون حفظ أو أرقام">🖨️ تجربة</button></div>
        <p class="hint" style="margin:6px 0 0">«إصدار وطباعة» يحفظ الشهادات في السجل ويعطي كل شهادة رقم تحقق، ثم يفتح الطباعة: اختر «حفظ كـ PDF» واتجاه «أفقي».</p></section></div></div>`;

    $('#tpls').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; const t = TPL[b.dataset.k];
      if (S.body !== TPL[S.kind].body && !confirm('سيُستبدل النص الحالي بنص القالب. متابعة؟')) return;
      Object.assign(S, { kind: b.dataset.k, title: t.title, en: t.en, body: t.body }); $('#title').value = S.title; $('#en').value = S.en; $('#body').value = S.body;
      $$('#tpls button').forEach((x) => x.classList.toggle('on', x === b)); preview(); };
    const bind = (id, k) => { $(id).oninput = () => { S[k] = $(id).value; preview(); }; };
    bind('#title', 'title'); bind('#en', 'en'); bind('#body', 'body'); bind('#date', 'date'); bind('#lqS', 'lqStudent'); bind('#lqT', 'lqStaff');
    $('#ltr').onchange = () => { S.ltr = $('#ltr').checked; preview(); };
    $('#sigs').oninput = (e) => { const t = e.target; if (t.dataset.st != null) S.sigs[+t.dataset.st].t = t.value; if (t.dataset.sn != null) S.sigs[+t.dataset.sn].n = t.value; preview(); };
    $('#sigs').onclick = (e) => { const b = e.target.closest('[data-sx]'); if (!b) return; const i = +b.dataset.sx; S.sigs[i] = { t: '', n: '' }; $(`[data-st="${i}"]`).value = ''; $(`[data-sn="${i}"]`).value = ''; preview(); };
    $('#vars').onclick = (e) => { const b = e.target.closest('[data-v]'); if (!b) return; const ta = $('#body'), p = ta.selectionStart ?? ta.value.length, ins = `{${b.dataset.v}}`;
      ta.value = ta.value.slice(0, p) + ins + ta.value.slice(ta.selectionEnd ?? p); S.body = ta.value; ta.focus(); ta.selectionStart = ta.selectionEnd = p + ins.length; preview(); };
    $('#rt').onclick = (e) => { const b = e.target.closest('[data-s]'); if (!b) return; SRC = b.dataset.s; $$('#rt button').forEach((x) => x.classList.toggle('on', x === b)); srcView(); };
    $('#clr').onclick = () => { if (R.length && confirm(`مسح ${R.length} اسم من القائمة؟`)) { R = []; PI = 0; listR(); } };
    $('#rl').onclick = (e) => { const b = e.target.closest('[data-rx]'); if (b) { R.splice(+b.dataset.rx, 1); PI = Math.min(PI, Math.max(0, R.length - 1)); listR(); } };
    $('#pp').onclick = () => { if (PI > 0) { PI--; preview(); } };
    $('#pnx').onclick = () => { if (PI < R.length - 1) { PI++; preview(); } };
    $('#go').onclick = issue; $('#draft').onclick = () => { if (!R.length) return toast('أضف المستلمين أولًا', 'err'); printCerts(R.map((r) => certOf(r, ''))); };
    addEventListener('resize', fitPreview);
    srcView(); listR();
  }

  function listR() {
    $('#rc').textContent = R.length ? `(${R.length})` : '';
    $('#go').textContent = R.length ? `🎓 إصدار وطباعة (${R.length} شهادة)` : '🎓 إصدار وطباعة';
    $('#rl').innerHTML = R.length ? R.map((r, i) => `<div><span class="grow">${esc(r.name)} <small>${esc([r.vars && r.vars['الصف'], r.vars && r.vars['الفصل'], r.vars && r.vars['الوظيفة']].filter(Boolean).join(' · '))}</small></span><button data-rx="${i}" title="حذف">✕</button></div>`).join('')
      : '<div class="hint" style="justify-content:center">لم تُضف أسماء بعد</div>';
    const keys = new Set(); R.forEach((r) => Object.keys(r.vars || {}).forEach((k) => keys.add(k)));
    const std = ['الاسم', 'اللقب', 'الصف', 'الفصل', 'المرحلة', 'الوظيفة', 'التاريخ', 'المدرسة'];
    $('#xvars').innerHTML = [...keys].filter((k) => !std.includes(k)).map((k) => `<button data-v="${esc(k)}">{${esc(k)}}</button>`).join('');
    preview();
  }
  function addR(list) {
    const seen = new Set(R.map((r) => (r.profile_id || '') + '|' + LMS.norm(r.name)));
    let n = 0; list.forEach((r) => { const k = (r.profile_id || '') + '|' + LMS.norm(r.name); if (!r.name || seen.has(k)) return; seen.add(k); R.push(r); n++; });
    toast(n ? `أُضيف ${n} اسم` : 'الأسماء موجودة في القائمة بالفعل'); listR();
  }

  function preview() {
    const pv = $('#pv'); if (!pv) return;
    const r = R[PI] || { name: 'اسم المستلم', rtype: SRC === 'staff' ? 'staff' : SRC === 'students' ? 'student' : 'other', vars: { 'الصف': 'الصف الرابع', 'الفصل': 'أ', 'المرحلة': 'ابتدائي', 'الوظيفة': '' } };
    pv.innerHTML = DCert.render(certOf(r, R.length ? 'DTC-0000-00000' : ''), '');
    $('#pn').textContent = R.length ? `${PI + 1} / ${R.length}` : 'مثال';
    fitPreview();
  }
  function fitPreview() { const pv = $('#pv'), c = pv && pv.firstElementChild; if (!c) return; const s = pv.clientWidth / c.offsetWidth; c.style.transform = `scale(${s})`; pv.style.height = c.offsetHeight * s + 'px'; }

  // ---------------- مصادر المستلمين ----------------
  async function srcView() {
    const box = $('#src');
    if (SRC === 'students') {
      box.innerHTML = `<div class="toolbar"><select id="sS"><option value="">المرحلة</option></select><select id="sG"><option value="">الصف</option></select><select id="sC"><option value="">الفصل</option></select>
        <input id="sQ" class="grow" type="search" placeholder="أو ابحث باسم الطالب…"></div>
        <div class="toolbar" style="margin-top:6px"><label class="hint"><input type="checkbox" id="sAll"> تحديد الكل</label><span class="grow hint" id="sN"></span><button class="btn sm primary" id="sAdd">➕ إضافة المحدد</button></div><div class="pick" id="sP"></div>`;
      let F = null, rows = [], t = null;
      const load = async () => {
        const st = $('#sS').value, g = $('#sG').value, c = $('#sC').value, q = $('#sQ').value.trim();
        if (!st && !g && !c && q.length < 2) { $('#sP').innerHTML = '<div class="hint" style="padding:10px">اختر مرحلة أو صفًا أو فصلًا، أو ابحث بالاسم.</div>'; rows = []; $('#sN').textContent = ''; return; }
        rows = []; let off = 0, D;
        do { D = await call('sd_list', { p_q: q || null, p_stage: st ? +st : null, p_grade: g ? +g : null, p_class: c ? +c : null, p_flag: null, p_limit: 200, p_offset: off });
          if (!F) { F = D.filters; fill(); } rows = rows.concat(D.rows); off += 200; } while (off < D.total && off < 2000);
        $('#sN').textContent = `${rows.length} طالب`;
        $('#sP').innerHTML = rows.map((r, i) => `<label><input type="checkbox" data-i="${i}"> ${esc(r.name)} <small class="hint">${esc(r.grade)} ${esc(r.stage)}${r.class ? ' / ' + esc(r.class) : ''}</small></label>`).join('') || '<div class="hint" style="padding:10px">لا نتائج</div>';
      };
      const fill = () => {
        const o = (L, v, ph) => `<option value="">${ph}</option>` + (L || []).map((x) => `<option value="${x.id}" ${String(x.id) === v ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
        const st = $('#sS').value, g = $('#sG').value, c = $('#sC').value;
        $('#sS').innerHTML = o(F.stages, st, 'المرحلة');
        $('#sG').innerHTML = o((F.grades || []).filter((x) => !st || String(x.stage) === st), g, 'الصف');
        $('#sC').innerHTML = o((F.classes || []).filter((x) => g ? String(x.grade) === g : (!st || (F.grades || []).some((y) => y.id === x.grade && String(y.stage) === st))).map((x) => ({ id: x.id, name: (g ? '' : ((F.grades || []).find((y) => y.id === x.grade) || {}).name + ' / ') + x.name })), c, 'الفصل');
      };
      try { const D = await call('sd_list', { p_q: null, p_stage: null, p_grade: null, p_class: null, p_flag: null, p_limit: 1, p_offset: 0 }); F = D.filters; fill(); } catch (e) { box.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
      $('#sS').onchange = () => { $('#sG').value = ''; $('#sC').value = ''; fill(); load(); };
      $('#sG').onchange = () => { $('#sC').value = ''; fill(); load(); };
      $('#sC').onchange = load;
      $('#sQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
      $('#sAll').onchange = () => $$('#sP input').forEach((x) => { x.checked = $('#sAll').checked; });
      $('#sAdd').onclick = () => { const sel = $$('#sP input:checked').map((x) => rows[+x.dataset.i]); if (!sel.length) return toast('حدد طلابًا أولًا', 'err');
        addR(sel.map((r) => ({ name: r.name, rtype: 'student', profile_id: r.id, vars: { 'الصف': r.grade, 'الفصل': r.class || '', 'المرحلة': r.stage } }))); };
      load();
    } else if (SRC === 'staff') {
      box.innerHTML = `<div class="toolbar"><input id="tQ" class="grow" type="search" placeholder="ابحث بالاسم أو المسمى الوظيفي…"></div>
        <div class="toolbar" style="margin-top:6px"><label class="hint"><input type="checkbox" id="tAll"> تحديد الكل</label><span class="grow hint" id="tN"></span><button class="btn sm primary" id="tAdd">➕ إضافة المحدد</button></div><div class="pick" id="tP"></div>`;
      let rows = [], t = null;
      const load = async () => { try { rows = await call('cert_staff', { p_q: $('#tQ').value.trim() || null }); } catch (e) { $('#tP').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
        $('#tN').textContent = `${rows.length} موظف`;
        $('#tP').innerHTML = rows.map((r, i) => `<label><input type="checkbox" data-i="${i}"> ${esc(r.name)} <small class="hint">${esc(r.job || LMS.ROLE_LABELS[r.role] || '')}</small></label>`).join('') || '<div class="hint" style="padding:10px">لا نتائج</div>'; };
      $('#tQ').oninput = () => { clearTimeout(t); t = setTimeout(load, 350); };
      $('#tAll').onchange = () => $$('#tP input').forEach((x) => { x.checked = $('#tAll').checked; });
      $('#tAdd').onclick = () => { const sel = $$('#tP input:checked').map((x) => rows[+x.dataset.i]); if (!sel.length) return toast('حدد أسماء أولًا', 'err');
        addR(sel.map((r) => ({ name: r.name, rtype: 'staff', profile_id: r.id, vars: { 'الوظيفة': r.job || '' } }))); };
      load();
    } else if (SRC === 'file') {
      box.innerHTML = `<label class="drop" id="drop"><input type="file" id="fIn" accept=".xlsx,.xls,.csv,.docx,.txt" hidden><b>📂 اختر ملف Excel أو Word</b><br>
          <span class="hint">أو اسحبه وأفلته هنا — Excel: عمود فيه «الاسم» (وأي أعمدة أخرى تصبح حقولًا مثل {الصف}). Word: اسم في كل سطر أو جدول بعمود الاسم.</span></label>
        <div class="toolbar" style="margin-top:8px"><label class="f" style="margin:0">نوع المستلمين<select id="fT"><option value="other">عام</option><option value="student">طلاب</option><option value="staff">معلمون وموظفون</option></select></label></div>
        <div id="fRes"></div>`;
      const drop = $('#drop');
      drop.ondragover = (e) => { e.preventDefault(); }; drop.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
      $('#fIn').onchange = () => { if ($('#fIn').files[0]) readFile($('#fIn').files[0]); $('#fIn').value = ''; };
    } else {
      box.innerHTML = `<label class="f">اكتب اسمًا في كل سطر (ويمكن إضافة الصف أو الوظيفة بعد فاصلة: «محمد أحمد، الصف الرابع»)<textarea id="mT" rows="7"></textarea></label>
        <div class="toolbar"><label class="f" style="margin:0">نوع المستلمين<select id="mY"><option value="other">عام</option><option value="student">طلاب</option><option value="staff">معلمون وموظفون</option></select></label><span class="grow"></span><button class="btn sm primary" id="mAdd">➕ إضافة</button></div>`;
      $('#mAdd').onclick = () => { const ty = $('#mY').value;
        const L = $('#mT').value.split(/\n+/).map((l) => l.trim()).filter(Boolean).map((l) => { const [n, x] = l.split(/[،,]\s*/); return { name: cleanName(n), rtype: ty, vars: x ? (ty === 'staff' ? { 'الوظيفة': x } : { 'الصف': x }) : {} }; });
        if (!L.length) return toast('اكتب الأسماء أولًا', 'err'); addR(L); $('#mT').value = ''; };
    }
  }

  const cleanName = (s) => String(s || '').replace(/^\s*[\d٠-٩]+\s*[-.)–:]?\s*/, '').replace(/\s+/g, ' ').trim();
  async function readFile(file) {
    const res = $('#fRes'); res.innerHTML = '<div class="hint">جارٍ قراءة الملف…</div>';
    try {
      let table;   // [[...cells]]
      if (/\.docx$/i.test(file.name)) table = await readDocx(await file.arrayBuffer());
      else if (/\.txt$/i.test(file.name)) table = (await file.text()).split(/\r?\n/).map((l) => [l]);
      else { if (typeof XLSX === 'undefined') throw new Error('تعذر تحميل مكتبة قراءة Excel، تحقق من الإنترنت'); const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '', blankrows: false }); }
      table = table.map((r) => r.map((c) => String(c ?? '').replace(/[⇕‏‎]/g, '').trim())).filter((r) => r.some((c) => c));
      if (!table.length) throw new Error('الملف فارغ');
      // صف العناوين: أول صف فيه «اسم» أو name
      const isName = (h) => /اسم|الاسم|name/i.test(h);
      let hi = table.findIndex((r, i) => i < 5 && r.some(isName)); let headers, rows, ni;
      if (hi >= 0) { headers = table[hi]; rows = table.slice(hi + 1); ni = headers.findIndex((h) => /^(الاسم|اسم|الاسم الكامل|اسم الطالب|اسم الطالبة|اسم المعلم|اسم الموظف|name|full name)$/i.test(h)); if (ni < 0) ni = headers.findIndex(isName); }
      else { headers = table[0].map((_, i) => i ? `عمود${i + 1}` : 'الاسم'); rows = table; ni = 0; }
      const ty = $('#fT').value;
      const MAP = { 'الصف': ['الصف', 'grade'], 'الفصل': ['الفصل', 'الشعبة', 'class'], 'المرحلة': ['المرحلة', 'stage'], 'الوظيفة': ['الوظيفة', 'المسمى الوظيفي', 'المسمى', 'job'], 'اللقب': ['اللقب', 'title'] };
      const keyOf = (h) => { for (const [k, syn] of Object.entries(MAP)) if (syn.some((s) => LMS.norm(h) === LMS.norm(s))) return k; return h; };
      const skip = (h) => /^(م|#|رقم|الرقم|no\.?|n)$/i.test(h.trim());
      const L = rows.map((r) => { const name = cleanName(r[ni]); if (!name) return null; const vars = {};
        headers.forEach((h, i) => { if (i !== ni && h && !skip(h) && r[i]) vars[keyOf(h)] = r[i]; }); return { name, rtype: ty, vars }; }).filter(Boolean);
      if (!L.length) throw new Error('لم أجد أسماء في الملف');
      res.innerHTML = `<div class="notice ok">وُجد <b>${L.length}</b> اسم في «${esc(file.name)}»${headers.length > 1 ? ` — الحقول: ${headers.filter((h, i) => i !== ni && h && !skip(h)).map((h) => `{${esc(keyOf(h))}}`).join(' ') || '—'}` : ''}</div>`;
      addR(L);
    } catch (e) { res.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
  }

  // قراءة ملف Word (.docx) بدون مكتبات: فك ضغط word/document.xml واستخراج الجداول أو الفقرات
  async function readDocx(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf);
    let eo = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eo = i; break; }
    if (eo < 0) throw new Error('ملف Word غير صالح');
    let p = dv.getUint32(eo + 16, true); const n = dv.getUint16(eo + 10, true); let entry = null;
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nl));
      if (name === 'word/document.xml') { entry = { method, csize, lo }; break; }
      p += 46 + nl + el + cl;
    }
    if (!entry) throw new Error('لم أجد محتوى المستند داخل ملف Word');
    const lo = entry.lo, start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + entry.csize);
    const xml = entry.method === 0 ? new TextDecoder().decode(raw)
      : await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml'), W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const txt = (el) => [...el.getElementsByTagNameNS(W, 't')].map((t) => t.textContent).join('').trim();
    const tbls = [...doc.getElementsByTagNameNS(W, 'tbl')];
    if (tbls.length) return tbls.flatMap((tb) => [...tb.getElementsByTagNameNS(W, 'tr')].map((tr) => [...tr.getElementsByTagNameNS(W, 'tc')].map(txt)));
    return [...doc.getElementsByTagNameNS(W, 'p')].map((pp) => [txt(pp)]).filter((r) => r[0]);
  }

  // ---------------- الإصدار والطباعة ----------------
  async function issue() {
    if (!R.length) return toast('أضف المستلمين أولًا', 'err');
    if (!S.title.trim()) return toast('اكتب عنوان الشهادة', 'err');
    const unk = (S.body.match(/\{[^{}\n]{1,40}\}/g) || []).filter((m) => { const k = m.slice(1, -1).trim(); return !(k in varsOf(R[0])) && k !== 'الاسم'; });
    if (unk.length && !confirm(`في النص حقول غير معروفة ستظهر كما هي: ${[...new Set(unk)].join(' ')}\nمتابعة؟`)) return;
    if (!confirm(`إصدار ${R.length} شهادة «${S.title}»؟ ستُحفظ في السجل ولكل منها رقم تحقق.`)) return;
    const w = openWin(); if (!w) return;
    const btn = $('#go'); btn.disabled = true; btn.textContent = 'جارٍ الإصدار…';
    try {
      const items = R.map((r) => { const c = certOf(r, ''); return { name: r.name, rtype: r.rtype, profile_id: r.profile_id || null,
        data: { title: c.title, en: c.en, body: c.body, sigs: c.sigs, date: c.date, ltr: c.ltr, school: c.school } }; });
      const res = await call('cert_issue', { p: { kind: S.kind, title: S.title, items } });
      toast(`صدرت ${res.count} شهادة ✓`);
      printCerts(R.map((r, i) => certOf(r, res.numbers[i])), w);
    } catch (e) { w.close(); toast(errMsg(e), 'err'); }
    finally { btn.disabled = false; listR(); }
  }

  function openWin() {
    const w = window.open('', '_blank');
    if (!w) { toast('اسمح للمتصفح بفتح النوافذ المنبثقة للطباعة', 'err'); return null; }
    w.document.write('<p style="font-family:sans-serif;text-align:center;margin-top:40vh">جارٍ تجهيز الشهادات…</p>'); return w;
  }
  function printCerts(list, w) {
    const base = location.href.replace(/[^/]*([?#].*)?$/, '');
    w = w || openWin(); if (!w) return;
    w.document.open();
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(S.title)} — ${list.length} شهادة</title>
      <link rel="stylesheet" href="${base}assets/css/brand.css"><link rel="stylesheet" href="${base}assets/css/cert.css?v=202611231530">
      <style>@page{size:A4 landscape;margin:0}html,body{margin:0;background:#e9efec}.dcert{margin:0 auto 6mm;box-shadow:0 4px 18px rgba(0,0,0,.12)}@media print{body{background:#fff}.dcert{margin:0;box-shadow:none}}</style></head>
      <body>${list.map((c) => DCert.render(c, base)).join('')}
      <script>Promise.all([document.fonts.ready, ...[...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))]).then(() => setTimeout(() => print(), 300));<\/script></body></html>`);
    w.document.close();
  }

  // ---------------- السجل ----------------
  async function logView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('cert_batches', { p_limit: 100 }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.length ? `<div class="bl">${L.map((b) => `<div class="it"><span style="font-size:1.6rem">🎓</span><div class="grow"><b>${esc(b.title)}</b> <span class="hint">— ${b.count} شهادة</span>
        <div class="hint">${DCert.fmtDate(b.at)} · ${esc(b.by || '')} · أولهم: ${esc(b.first)}</div></div><button class="btn sm" data-b="${b.batch}">🖨️ إعادة الطباعة</button></div>`).join('')}</div>`
      : '<div class="empty">لم تُصدر شهادات بعد.</div>';
    view.onclick = async (e) => { const b = e.target.closest('[data-b]'); if (!b) return;
      const w = openWin(); if (!w) return;
      try { const C = await call('cert_batch', { p_batch: b.dataset.b }); const base = location.href.replace(/[^/]*([?#].*)?$/, '');
        S.title = C[0] ? C[0].title : S.title;
        printCerts(C.map((c) => Object.assign({}, c.data, { no: c.no, name: c.name, verify: base + 'certificate.html?no=' + c.no })), w); }
      catch (er) { w.close(); toast(errMsg(er), 'err'); } };
  }

  // البدء بعد تعريف كل الدوال والثوابت
  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); b.dataset.tab === 'log' ? logView() : newView(); };
  newView();
})();
