/* =====================================================================
   لوحة الإدارة — لمدير النظام فقط
   ===================================================================== */
(async function () {
  const { sb, ROLE_LABELS, esc, $, $$, toast, modal, confirmBox, errMsg, fetchAll, requireAuth, downloadCSV } = LMS;
  const D0 = (LMS.C && LMS.C.SCHOOL_DOMAIN) || 'school.edu.sa';   // نطاق بريد المدرسة في أمثلة ملفات الاستيراد
  const ctx = await requireAuth(['admin']);
  const ME = ctx.profile;

  // ---------- أدوات ----------
  const norm = LMS.norm;   // التطبيع الموحد (همزات، ى، ة، الأسماء المركبة)
  const opts = (items, val, lab, sel, empty) =>
    (empty !== undefined ? `<option value="">${esc(empty)}</option>` : '') +
    items.map((x) => `<option value="${esc(val(x))}" ${String(val(x)) === String(sel ?? '') ? 'selected' : ''}>${esc(lab(x))}</option>`).join('');
  const pill = (on) => `<span class="pill ${on ? 'on' : 'off'}">${on ? 'نشط' : 'موقوف'}</span>`;
  const run = async (q) => { const { data, error } = await q; if (error) throw error; return data; };
  const fmtDate = (d) => new Date(d).toLocaleString('ar-SA-u-ca-gregory', { dateStyle: 'short', timeStyle: 'short' });
  const val = (root, sel) => { const el = $(sel, root); return el ? el.value.trim() : ''; };

  // ---------- البيانات المرجعية ----------
  const R = { sections: [], stages: [], grades: [], subjects: [], classes: [], staff: [] };
  async function loadRefs() {
    const [sections, stages, grades, subjects, classes, staff] = await Promise.all([
      run(sb.from('sections').select('*').order('sort')),
      run(sb.from('stages').select('*').order('sort')),
      fetchAll(() => sb.from('grades').select('*').order('stage_id').order('number')),
      fetchAll(() => sb.from('subjects').select('*').order('name_ar')),
      fetchAll(() => sb.from('v_classes').select('*').order('stage_sort').order('grade_number').order('name')),
      fetchAll(() => sb.from('profiles').select('id, full_name, email, role, job_title, active')
        .not('role', 'in', '(student,parent)').order('full_name'))
    ]);
    Object.assign(R, { sections, stages, grades, subjects, classes, staff });
  }
  const stageById = (id) => R.stages.find((s) => s.id === id);
  const gradeLabel = (g) => `${g.name_ar} — ${stageById(g.stage_id)?.name_ar || ''}`;

  // ---------- التبويبات ----------
  const loaded = {};
  const tabs = { overview, import: importTab, staff: staffTab, students: studentsTab, classes: classesTab,
                 subjects: subjectsTab, assign: assignTab, years: yearsTab, audit: auditTab, settings: settingsTab };
  async function openTab(name, force = false) {
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab-pane').forEach((p) => p.classList.toggle('on', p.id === 'tab-' + name));
    if (!loaded[name] || force) {
      const pane = $('#tab-' + name);
      pane.innerHTML = '<div class="loader"><div class="spin"></div>جارٍ التحميل…</div>';
      try { await tabs[name](pane); loaded[name] = true; }
      catch (e) { pane.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; }
    }
    history.replaceState(null, '', '#' + name);
  }
  // عند تغيير البيانات: إعادة تحميل المراجع وتعليم التبويبات الأخرى لإعادة البناء
  async function changed(current) {
    await loadRefs();
    Object.keys(loaded).forEach((k) => { if (k !== current) loaded[k] = false; });
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('button[data-tab]'); if (b) openTab(b.dataset.tab); };


  /* ===================================================================
     نظرة عامة
     =================================================================== */
  async function overview(pane) {
    const st = await run(sb.rpc('school_stats'));
    const steps = [
      ['1', 'استيراد الموظفين', 'المعلمون والمشرفون ومديرو المراحل والإدارة، مع نطاق كل مشرف ومدير.', st.staff > 1],
      ['2', 'استيراد الطلاب', 'كل طالب برقمه وبريده وفصله. الفصول الناقصة تُنشأ تلقائيًا.', st.students > 0],
      ['3', 'استيراد الإسناد', 'من يدرّس ماذا لأي فصل — يحدد ما يراه كل معلم.', st.assignments > 0],
      ['4', 'المراجعة', 'افتح الصفحة الرئيسية بحساب معلم ومشرف وطالب للتأكد من الصلاحيات.', false]
    ];
    pane.innerHTML = `
      <div class="grid stats">
        ${[['الطلاب', st.students], ['المعلمون', st.teachers], ['كل الموظفين', st.staff], ['الفصول', st.classes],
           ['المواد', st.subjects], ['الإسنادات', st.assignments]]
          .map(([l, n]) => `<div class="stat glass"><div class="n">${n}</div><div class="l">${l}</div></div>`).join('')}
      </div>
      ${(st.by_stage || []).length ? `<div class="grid stats" style="margin-top:14px">${st.by_stage.map((x) =>
        `<div class="stat glass"><div class="n">${x.students}</div><div class="l">${esc(x.stage)}</div></div>`).join('')}</div>` : ''}
      ${(st.no_class || st.no_email || st.students_no_email) ? `<div class="notice warn" style="margin-top:14px">
        ${st.no_class ? `• ${st.no_class} طالب لم يُوزَّعوا على فصول بعد — وزّعهم من تبويب «الطلاب» (حدد ← «توزيع المحددين على فصل»).<br>` : ''}
        ${st.students_no_email ? `• ${st.students_no_email} طالب بدون بريد مدرسي — لن يستطيعوا الدخول للمنصة حتى يُضاف بريدهم (البيانات محفوظة).<br>` : ''}
        ${st.no_email ? `• ${st.no_email} موظف بدون بريد — لن يستطيع الدخول.` : ''}</div>` : ''}
      <div class="section-title"><h2>خطوات تجهيز المنصة</h2></div>
      <div class="grid modules">${steps.map(([n, t, d, done]) => `
        <div class="module glass"><span class="badge" style="${done ? 'background:#E5F6EC;color:#007D41;border-color:#99D9B8' : ''}">${done ? 'تم ✓' : 'الخطوة ' + n}</span>
          <span class="ic">${['👥', '🎓', '🧑‍🏫', '✅'][n - 1]}</span><b>${t}</b><small>${d}</small></div>`).join('')}
      </div>`;
  }

  /* ===================================================================
     الاستيراد الجماعي
     =================================================================== */
  const IMPORTS = {
    staff: {
      title: 'الموظفون', rpc: 'import_staff', order: 1,
      desc: 'يُستورد أولًا. البريد هو المفتاح: إذا كان الموظف موجودًا تُحدَّث بياناته. أول صف لكل موظف يستبدل نطاقاته القديمة، والصفوف التالية لنفس البريد تضيف نطاقات أخرى.',
      fields: [
        ['full_name', 'الاسم الكامل', true, ['الاسم الكامل', 'الاسم', 'اسم الموظف', 'اسم المعلم', 'name', 'full name', 'full_name']],
        ['email', 'البريد الإلكتروني', true, ['البريد الإلكتروني', 'البريد الالكتروني', 'البريد', 'الايميل', 'الإيميل', 'email', 'e-mail', 'mail']],
        ['role', 'الدور', true, ['الدور', 'الصلاحيه', 'نوع الحساب', 'role']],
        ['job_title', 'المسمى الوظيفي', false, ['المسمى الوظيفي', 'الوظيفه', 'المسمى', 'job title', 'job_title']],
        ['scope_stage', 'نطاق المرحلة أو القسم', false, ['نطاق المرحله', 'نطاق المرحله او القسم', 'المرحله', 'scope_stage']],
        ['scope_subject', 'نطاق المادة', false, ['نطاق الماده', 'الماده', 'scope_subject']],
        ['scope_grade_min', 'من صف', false, ['من صف', 'scope_grade_min']],
        ['scope_grade_max', 'إلى صف', false, ['الي صف', 'إلى صف', 'scope_grade_max']]
      ],
      sample: [['أ. أحمد محمد', 'ahmed@' + D0, 'معلم', 'معلم علوم', '', '', '', ''],
               ['أ. خالد بخيت', 'khaled@' + D0, 'مدير مرحلة', 'مدير المرحلة الابتدائية', 'ابتدائي بنين', '', '', ''],
               ['أ. مشرف الأولية', 'sup1@' + D0, 'مشرف', 'مشرف الصفوف الأولية', 'ابتدائي بنين', '', '1', '3'],
               ['أ. مشرف الأولية', 'sup1@' + D0, 'مشرف', 'مشرف الصفوف الأولية', 'ابتدائي بنات', '', '1', '3'],
               ['أ. مشرف العلوم', 'sci@' + D0, 'مشرف', 'مشرف العلوم', '', 'العلوم', '', '']]
    },
    students: {
      title: 'الطلاب (قالب المنصة مع الفصول)', rpc: 'import_students', order: 4,
      desc: 'رقم الطالب هو المفتاح: إذا كان موجودًا تُحدَّث بياناته وفصله (مفيد للترفيع السنوي). الفصل غير الموجود يُنشأ تلقائيًا داخل الصف.',
      fields: [
        ['student_number', 'رقم الطالب', true, ['رقم الطالب', 'الرقم', 'رقم', 'student number', 'student_number', 'id']],
        ['full_name', 'الاسم الكامل', true, ['الاسم الكامل', 'اسم الطالب', 'اسم الطالبه', 'الاسم', 'name', 'full_name']],
        ['email', 'البريد الإلكتروني', false, ['البريد الإلكتروني', 'البريد الالكتروني', 'البريد', 'الايميل', 'email']],
        ['stage', 'المرحلة', true, ['المرحله', 'stage']],
        ['grade', 'الصف', true, ['الصف', 'grade']],
        ['class', 'الفصل', true, ['الفصل', 'الشعبه', 'class', 'section']],
        ['guardian_name', 'اسم ولي الأمر', false, ['اسم ولي الامر', 'ولي الامر', 'guardian_name']],
        ['guardian_phone', 'جوال ولي الأمر', false, ['جوال ولي الامر', 'الجوال', 'رقم الجوال', 'جوال', 'guardian_phone', 'phone', 'mobile']]
      ],
      sample: [['10234', 'محمد أحمد علي', '10234@' + D0, 'ابتدائي بنين', '4', '1', 'أحمد علي', '0500000000'],
               ['20456', 'سارة خالد', '20456@' + D0, 'ابتدائي بنات', '5', '2', 'خالد محمد', '0550000000'],
               ['30111', 'Omar Hassan', '30111@' + D0, 'الدبلوم الأمريكي', '7', 'A', '', '']]
    },
    sis: {
      title: 'الطلاب من نظام التسجيل (ShereEDU)', rpc: 'import_students_sis', order: 2, raw: true,
      desc: 'ارفع ملف «Active Agreements» كما هو من نظام التسجيل. المفتاح هو رقم الهوية/الإقامة: الطالب الموجود تُحدَّث بياناته، والجديد يُضاف. يُحفظ كل عمود في الملف. رقم الهوية وتاريخ الميلاد وبريد ولي الأمر لا يراها إلا مدير النظام والإدارة العليا. الطالب يُسجَّل في صفه، ثم يُوزَّع على الفصول من تبويب «الطلاب».',
      fields: [
        ['national_id', 'رقم الهوية / الإقامة', true, ['saudi id number / iqama (student) (students)', 'رقم الهويه', 'الهويه', 'national_id']],
        ['full_name', 'الاسم الكامل', true, ['full name (student) (students)', 'الاسم الكامل', 'full_name']],
        ['grade', 'الصف (كما في نظام التسجيل)', true, ['grade', 'الصف']],
        ['agreement_id', 'رقم الاتفاقية', false, ['(do not modify) agreement']],
        ['first_name', 'الاسم الأول', false, ['student name (student) (students)']],
        ['father_name', 'اسم الأب', false, ['father’s name (student) (students)', "father's name (student) (students)"]],
        ['grandfather_name', 'اسم الجد', false, ['grandfather’s name (student) (students)', "grandfather's name (student) (students)"]],
        ['family_name', 'اسم العائلة', false, ['family name  (student) (students)', 'family name (student) (students)']],
        ['parent_email', 'بريد ولي الأمر', false, ['email (parent/guardian) (contact)']],
        ['nationality', 'الجنسية', false, ['nationality new (student) (students)', 'nationality']],
        ['date_of_birth', 'تاريخ الميلاد', false, ['date of birth (student) (students)', 'تاريخ الميلاد']],
        ['modified_on', 'آخر تعديل في نظام التسجيل', false, ['(do not modify) modified on']]
      ],
      sample: [['1000000000', 'محمد أحمد علي الغامدي', 'Dar Grade 4 - Ethraa Plus', '', 'محمد', 'أحمد', 'علي', 'الغامدي', 'parent@example.com', 'Saudi', '2015-03-01', '']]
    },
    classes_dist: {
      title: 'توزيع الطلاب على الفصول', rpc: 'import_student_classes', order: 3,
      desc: 'لربط الطلاب المسجّلين بفصولهم. المفتاح رقم الهوية/الإقامة (أو الاسم الكامل إن لم يوجد رقم الهوية، بشرط ألا يتكرر). الفصل يُكتب «أ» أو «1» أو «4/أ» ويُطابَق داخل صف الطالب المسجّل في المنصة، ويُنشأ إن لم يوجد. عمود الصف اختياري للتحقق فقط. يمكن أيضًا التوزيع يدويًا من تبويب «الطلاب» (تحديد عدة طلاب ← نقل لفصل).',
      fields: [
        ['national_id', 'رقم الهوية / الإقامة', false, ['رقم الهويه', 'رقم الهويه / الاقامه', 'الهويه', 'رقم الاقامه', 'السجل المدني', 'saudi id number / iqama (student) (students)', 'national_id', 'id number']],
        ['full_name', 'اسم الطالب', false, ['اسم الطالب', 'الاسم الكامل', 'الاسم', 'full name (student) (students)', 'full_name', 'name']],
        ['grade', 'الصف (للتحقق)', false, ['الصف', 'grade']],
        ['class', 'الفصل', true, ['الفصل', 'الشعبه', 'class', 'section', 'رقم الفصل']]
      ],
      sample: [['1000000000', 'محمد أحمد علي', '4', 'أ'], ['1000000001', 'سعد خالد', '4', '2'], ['', 'عمر حسن', '', '4/ج']]
    },
    assignments: {
      title: 'الإسناد (معلم × فصل × مادة)', rpc: 'import_assignments', order: 5,
      desc: 'يُستورد بعد الموظفين. كل صف = معلم يدرّس مادة لفصل. المادة غير الموجودة تُضاف تلقائيًا (راجع قائمة المواد الجديدة في التقرير لاكتشاف الأخطاء الإملائية).',
      fields: [
        ['teacher_email', 'بريد المعلم', true, ['بريد المعلم', 'البريد', 'البريد الإلكتروني', 'email', 'teacher_email']],
        ['stage', 'المرحلة', true, ['المرحله', 'stage']],
        ['grade', 'الصف', true, ['الصف', 'grade']],
        ['class', 'الفصل', true, ['الفصل', 'الشعبه', 'class']],
        ['subject', 'المادة', true, ['الماده', 'subject']],
        ['weekly_periods', 'عدد الحصص الأسبوعية', false, ['عدد الحصص الاسبوعيه', 'عدد الحصص', 'الحصص', 'weekly_periods']]
      ],
      sample: [['ahmed@' + D0, 'ابتدائي بنين', '4', '1', 'العلوم', '4'],
               ['ahmed@' + D0, 'ابتدائي بنين', '4', '2', 'العلوم', '4']]
    }
  };
  const CHUNK = 200;

  async function importTab(pane) {
    pane.innerHTML = `
      <div class="card glass">
        <div class="toolbar">
          <label class="f grow">نوع البيانات
            <select id="impType">${Object.entries(IMPORTS).sort((a, b) => a[1].order - b[1].order)
              .map(([k, v]) => `<option value="${k}">${v.order}) ${v.title}</option>`).join('')}</select></label>
          <button class="btn" id="tplBtn">⬇ تنزيل القالب</button>
          <button class="btn" id="refBtn">⬇ أسماء المراحل والصفوف المعتمدة</button>
        </div>
        <p class="hint" id="impDesc"></p>
        <label class="drop" id="drop">
          <input type="file" id="impFile" accept=".xlsx,.xls,.csv" hidden>
          <b>📂 اختر ملف Excel أو CSV</b><br><span class="hint">أو اسحبه وأفلته هنا</span>
          <div id="fileName" class="hint"></div>
        </label>
        <div id="impWork"></div>
      </div>`;

    const typeSel = $('#impType', pane);
    const showDesc = () => { $('#impDesc', pane).textContent = IMPORTS[typeSel.value].desc; };
    showDesc();
    let sheet = null; // { headers, rows, headerRow }
    let wb = null;
    typeSel.onchange = () => { showDesc(); if (sheet) renderMapping(); };

    $('#tplBtn', pane).onclick = () => {
      const T = IMPORTS[typeSel.value];
      downloadCSV(`قالب-${T.title}.csv`, [T.fields.map((f) => f[1])].concat(T.sample));
    };
    $('#refBtn', pane).onclick = () => {
      const rows = [['المرحلة (اكتبها كما هي)', 'القسم', 'الصفوف المتاحة']];
      R.stages.forEach((s) => rows.push([s.name_ar, R.sections.find((x) => x.id === s.section_id)?.name_ar,
        R.grades.filter((g) => g.stage_id === s.id).map((g) => g.number).join(' ، ')]));
      rows.push([], ['الأدوار المقبولة'], ['مدير نظام'], ['قيادة (للمدير التنفيذي ومدير التعليم)'], ['مدير مرحلة'], ['مشرف'], ['معلم'], ['موظف'], ['ولي أمر']);
      downloadCSV('المراحل-والصفوف-والأدوار.csv', rows);
    };

    const drop = $('#drop', pane), fileInput = $('#impFile', pane);
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.style.background = '#fff'; });
    drop.addEventListener('dragleave', () => { drop.style.background = ''; });
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.style.background = ''; if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });
    fileInput.onchange = () => { if (fileInput.files[0]) readFile(fileInput.files[0]); fileInput.value = ''; };

    async function readFile(file) {
      if (typeof XLSX === 'undefined') { toast('تعذر تحميل مكتبة قراءة Excel، تحقق من الإنترنت وأعد تحميل الصفحة.', 'err'); return; }
      try {
        const buf = await file.arrayBuffer();
        wb = XLSX.read(buf, { type: 'array', codepage: 65001, cellDates: false, cellNF: true });
        $('#fileName', pane).textContent = `${file.name} — ${wb.SheetNames.length} ورقة`;
        loadSheet(wb.SheetNames[0]);
      } catch (e) { toast('تعذرت قراءة الملف: ' + errMsg(e), 'err'); }
    }

    function loadSheet(name) {
      const ws = wb.Sheets[name];
      // التواريخ تُحوَّل إلى صيغة ثابتة (yyyy-mm-dd) بدل تنسيق Excel المحلي مثل 4/15/09
      const p2 = (n) => String(n).padStart(2, '0');
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
      for (let R = range.s.r; R <= range.e.r; R++) for (let C = range.s.c; C <= range.e.c; C++) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
          const d = XLSX.SSF.parse_date_code(cell.v);
          if (d) {
            const day = `${d.y}-${p2(d.m)}-${p2(d.d)}`;
            cell.w = (d.H || d.M) ? `${day}T${p2(d.H)}:${p2(d.M)}:${p2(Math.floor(d.S))}` : day;
          }
        }
      }
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: false });
      // أول صف يحتوي على عمودين فأكثر غير فارغين = صف العناوين
      let h = aoa.findIndex((r) => r.filter((c) => String(c).trim() !== '').length >= 2);
      if (h < 0) { sheet = { name, headers: [], rows: [], headerRow: 0 }; renderMapping(); return; }
      const headers = aoa[h].map((c, i) => String(c).trim() || `عمود ${i + 1}`);
      const rows = aoa.slice(h + 1).filter((r) => r.some((c) => String(c).trim() !== ''));
      sheet = { name, headers, rows, headerRow: h + 1 };
      renderMapping();
    }

    function guess(field) {
      const syn = field[3].map(norm);
      const H = sheet.headers.map(norm);
      let i = H.findIndex((x) => syn.includes(x));
      if (i < 0) i = H.findIndex((x) => syn.some((s) => s.length > 2 && x.includes(s)));
      return i;
    }

    function renderMapping() {
      const T = IMPORTS[typeSel.value];
      const work = $('#impWork', pane);
      if (!sheet.rows.length) { work.innerHTML = `<div class="notice warn">الورقة فارغة أو لا تحتوي صف عناوين.</div>`; return; }
      const used = new Set();
      work.innerHTML = `
        ${wb.SheetNames.length > 1 ? `<label class="f" style="margin-top:14px;max-width:320px">الورقة
          <select id="sheetSel">${wb.SheetNames.map((n) => `<option ${n === sheet.name ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>` : ''}
        <h3 style="margin-top:16px">ربط الأعمدة <span class="hint">(${sheet.rows.length} صف — العناوين في الصف ${sheet.headerRow})</span></h3>
        <p class="hint">اختر لكل حقل العمود المقابل في ملفك. إذا كان الحقل نفسه لكل الصفوف (مثلًا ملف لمرحلة واحدة) اختر «قيمة ثابتة» واكتبها.</p>
        <div class="map-grid">${T.fields.map((f) => {
          let g = guess(f); if (used.has(g)) g = -1; if (g >= 0) used.add(g);
          return `<label class="f">${esc(f[1])}${f[2] ? ' <span class="star">*</span>' : ''}
            <select data-map="${f[0]}">
              <option value="">— لا يوجد —</option>
              ${sheet.headers.map((hh, i) => `<option value="${i}" ${i === g ? 'selected' : ''}>${esc(hh)}</option>`).join('')}
              <option value="const">✎ قيمة ثابتة لكل الصفوف</option>
            </select>
            <input data-const="${f[0]}" placeholder="اكتب القيمة الثابتة" style="display:none"></label>`;
        }).join('')}</div>
        ${typeSel.value === 'assignments' ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:700">
          <input type="checkbox" id="replaceAll"> حذف كل الإسنادات الحالية قبل الاستيراد (لبداية فصل/عام جديد)</label>` : ''}
        ${typeSel.value === 'sis' ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px;font-weight:700">
          <input type="checkbox" id="deactMissing"> إيقاف حسابات الطلاب غير الموجودين في هذا الملف (المنسحبين)</label>
          <p class="hint">فعّل هذا الخيار فقط إذا كان الملف يضم <b>كل</b> طلاب المدرسة. «تحقق بدون حفظ» يعرض لك عدد من سيتم إيقافهم قبل الحفظ.</p>` : ''}
        <h3 style="margin-top:16px">معاينة أول 8 صفوف</h3>
        <div class="table-wrap" id="preview"></div>
        <div class="toolbar" style="margin-top:14px">
          <button class="btn" id="dryBtn">🔍 تحقق بدون حفظ</button>
          <button class="btn primary" id="saveBtn">💾 استيراد وحفظ</button>
          <span class="hint" id="progress"></span>
        </div>
        <div id="report"></div>`;
      const ss = $('#sheetSel', work); if (ss) ss.onchange = () => loadSheet(ss.value);
      $$('[data-map]', work).forEach((s) => s.onchange = () => {
        $(`[data-const="${s.dataset.map}"]`, work).style.display = s.value === 'const' ? '' : 'none';
        preview();
      });
      $$('[data-const]', work).forEach((i) => i.oninput = preview);
      $('#dryBtn', work).onclick = () => execute(true);
      $('#saveBtn', work).onclick = () => execute(false);
      preview();
    }

    function mapped() {
      const T = IMPORTS[typeSel.value];
      const m = {};
      T.fields.forEach((f) => {
        const s = $(`[data-map="${f[0]}"]`, pane);
        m[f[0]] = s.value === 'const' ? { c: $(`[data-const="${f[0]}"]`, pane).value } : (s.value === '' ? null : { i: +s.value });
      });
      return sheet.rows.map((r) => {
        const o = {};
        T.fields.forEach((f) => {
          const x = m[f[0]];
          o[f[0]] = x == null ? '' : ('c' in x ? x.c : String(r[x.i] ?? '').trim());
        });
        if (T.raw) {
          // كل أعمدة الملف كما هي (عدا رمز التحقق الداخلي لنظام التسجيل)
          o.raw = {};
          sheet.headers.forEach((h, i) => { if (!/checksum/i.test(h) && String(r[i] ?? '').trim() !== '') o.raw[h] = String(r[i]).trim(); });
        }
        return o;
      });
    }

    function preview() {
      const T = IMPORTS[typeSel.value];
      const rows = mapped().slice(0, 8);
      $('#preview', pane).innerHTML = `<table><thead><tr>${T.fields.map((f) => `<th>${esc(f[1])}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${T.fields.map((f) => `<td>${esc(r[f[0]])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }

    async function execute(dry) {
      const T = IMPORTS[typeSel.value];
      const missing = T.fields.filter((f) => f[2]).filter((f) => {
        const s = $(`[data-map="${f[0]}"]`, pane);
        return s.value === '' || (s.value === 'const' && !$(`[data-const="${f[0]}"]`, pane).value.trim());
      });
      if (missing.length) { toast('اربط الحقول المطلوبة: ' + missing.map((f) => f[1]).join('، '), 'warn'); return; }
      const replaceAll = !!$('#replaceAll', pane)?.checked;
      const deactMissing = !!$('#deactMissing', pane)?.checked;
      if (!dry) {
        const ok = await confirmBox(`سيتم حفظ ${sheet.rows.length} صف في «${T.title}»${replaceAll ? ' بعد حذف كل الإسنادات الحالية' : ''}. هل تريد المتابعة؟`, 'نعم، احفظ', replaceAll);
        if (!ok) return;
      }
      const rows = mapped();
      const total = { total: 0, inserted: 0, updated: 0, saved: 0, scopes: 0, classes_created: 0, grade_changed: 0, deactivated: 0, subjects_created: [], errors: [] };
      const btns = [$('#dryBtn', pane), $('#saveBtn', pane)]; btns.forEach((b) => b.disabled = true);
      const prog = $('#progress', pane);
      try {
        for (let i = 0; i < rows.length; i += CHUNK) {
          prog.textContent = `${dry ? 'جارٍ التحقق' : 'جارٍ الحفظ'}… ${Math.min(i + CHUNK, rows.length)} / ${rows.length}`;
          const args = { rows: rows.slice(i, i + CHUNK), dry_run: dry };
          if (typeSel.value === 'assignments') args.replace_all = replaceAll && i === 0 && !dry;
          const res = await run(sb.rpc(T.rpc, args));
          ['total', 'inserted', 'updated', 'saved', 'scopes', 'classes_created', 'grade_changed'].forEach((k) => { total[k] += res[k] || 0; });
          (res.subjects_created || []).forEach((s) => { if (!total.subjects_created.includes(s)) total.subjects_created.push(s); });
          (res.errors || []).forEach((e) => total.errors.push({ row: e.row + i + sheet.headerRow, msg: e.msg }));
        }
        if (typeSel.value === 'sis' && deactMissing) {
          const ids = rows.map((r) => String(r.national_id || '').replace(/\s/g, '')).filter(Boolean);
          if (ids.length) {
            prog.textContent = 'جارٍ مطابقة المنسحبين…';
            const res = await run(sb.rpc('import_students_sis', { rows: [], dry_run: dry, deactivate_missing: true, keep_ids: ids }));
            total.deactivated = res.deactivated || 0;
          }
        }
        prog.textContent = '';
        renderReport(total, dry, T);
        if (!dry) { await changed('import'); toast('تم الحفظ بنجاح'); }
      } catch (e) {
        prog.textContent = '';
        toast(errMsg(e), 'err');
      } finally { btns.forEach((b) => b.disabled = false); }
    }

    function renderReport(t, dry, T) {
      const ok = t.total - t.errors.length;
      const parts = [`<span class="chip">${dry ? 'نتيجة التحقق (لم يُحفظ شيء)' : 'تم الحفظ'}</span>`,
        `<span class="chip teal">صفوف سليمة: ${ok}</span>`,
        t.errors.length ? `<span class="chip pink">أخطاء: ${t.errors.length}</span>` : `<span class="chip teal">لا أخطاء ✓</span>`];
      if (t.inserted) parts.push(`<span class="chip gray">جديد: ${t.inserted}</span>`);
      if (t.updated) parts.push(`<span class="chip gray">تحديث: ${t.updated}</span>`);
      if (t.saved) parts.push(`<span class="chip gray">إسنادات: ${t.saved}</span>`);
      if (t.scopes) parts.push(`<span class="chip gray">نطاقات: ${t.scopes}</span>`);
      if (t.grade_changed) parts.push(`<span class="chip gray">تغيّر صفهم: ${t.grade_changed}</span>`);
      if (t.deactivated) parts.push(`<span class="chip pink">${dry ? 'سيتم إيقاف' : 'أُوقف'}: ${t.deactivated} طالب غير موجود في الملف</span>`);
      if (t.classes_created) parts.push(`<span class="chip gray">فصول ${dry ? 'ستُنشأ' : 'أُنشئت'}: ${t.classes_created}</span>`);
      $('#report', pane).innerHTML = `<div class="report">
        <div class="row">${parts.join('')}</div>
        ${t.subjects_created.length ? `<div class="notice info">مواد جديدة ${dry ? 'ستُضاف' : 'أُضيفت'}: ${t.subjects_created.map(esc).join('، ')} — تأكد أنها ليست أخطاء إملائية لمواد موجودة.</div>` : ''}
        ${t.errors.length ? `<h4>الصفوف التي بها أخطاء (رقم الصف في ملف Excel)</h4>
          <div class="errors-list">${t.errors.map((e) => `<div>صف ${e.row}: ${esc(e.msg)}</div>`).join('')}</div>
          <button class="btn sm" id="errCsv" style="margin-top:8px">⬇ تنزيل الأخطاء</button>` : ''}
        ${dry && !t.errors.length ? '<p class="hint">كل شيء سليم — اضغط «استيراد وحفظ».</p>' : ''}
        ${dry && t.errors.length && ok ? '<p class="hint">عند الحفظ تُحفظ الصفوف السليمة فقط وتُتجاهل صفوف الأخطاء. يمكنك تصحيحها ثم إعادة استيراد الملف كاملًا بأمان (لن تتكرر البيانات).</p>' : ''}
      </div>`;
      const b = $('#errCsv', pane);
      if (b) b.onclick = () => downloadCSV(`أخطاء-${T.title}.csv`, [['رقم الصف', 'الخطأ']].concat(t.errors.map((e) => [e.row, e.msg])));
    }
  }

  /* ===================================================================
     الموظفون
     =================================================================== */
  async function staffTab(pane) {
    const all = await fetchAll(() => sb.from('profiles').select('*').neq('role', 'student').order('full_name'));
    const scopes = await fetchAll(() => sb.from('staff_scopes').select('*'));
    const teach = await fetchAll(() => sb.from('v_staff_teaching').select('*'));
    const T = Object.fromEntries(teach.map((t) => [t.teacher_id, t]));
    const scCount = {}; scopes.forEach((s) => { scCount[s.profile_id] = (scCount[s.profile_id] || 0) + 1; });
    const uniq = (f) => [...new Set(teach.flatMap((t) => String(t[f] || '').split('، ').filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'ar'));
    pane.innerHTML = `
      <div class="toolbar">
        <input class="grow" id="q" placeholder="بحث بالاسم أو البريد أو الفصل…">
        <select id="roleF"><option value="">كل الأدوار</option>${Object.entries(ROLE_LABELS).filter(([k]) => k !== 'student')
          .map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        <select id="stgF"><option value="">كل المراحل</option>${uniq('stages').map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        <select id="subF"><option value="">كل المواد</option>${uniq('subjects').map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        <select id="supF"><option value="">كل المشرفين</option>${uniq('supervisors').map((x) => `<option>${esc(x)}</option>`).join('')}</select>
        <button class="btn primary" id="add">+ إضافة موظف</button>
        <button class="btn" id="csv">⬇ تنزيل</button>
      </div>
      <div class="table-wrap glass" id="tbl"></div>`;
    const draw = () => {
      const q = norm(val(pane, '#q')), rf = val(pane, '#roleF'), sf = val(pane, '#stgF'), bf = val(pane, '#subF'), pf = val(pane, '#supF');
      const has = (t, f, v) => !v || (t && String(t[f] || '').split('، ').includes(v));
      const rows = all.filter((p) => { const t = T[p.id];
        return (!rf || p.role === rf) && has(t, 'stages', sf) && has(t, 'subjects', bf) && has(t, 'supervisors', pf)
          && (!q || LMS.has(p.full_name + ' ' + (p.email || '') + ' ' + (t ? t.classes.map((c) => c.label).join(' ') : ''), q)); });
      $('#tbl', pane).innerHTML = `<p class="hint" style="margin:0 0 8px">${rows.length} موظف — المادة والمرحلة والفصول والنصاب من جدول الحصص في مكتب الإشراف التربوي.</p>
        <table><thead><tr><th>الاسم</th><th>المادة</th><th>المرحلة</th><th>الفصول</th><th>الحصص/أسبوع</th><th>المشرف</th><th>البريد</th><th>الدور</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((p) => { const t = T[p.id]; return `<tr>
          <td><b>${esc(p.full_name)}</b>${p.job_title ? `<div class="hint" style="margin:0">${esc(p.job_title)}</div>` : ''}</td>
          <td>${esc(t?.subjects || '—')}</td><td>${esc(t?.stages || '—')}</td>
          <td title="${esc(t ? t.classes.map((c) => c.label + ' — ' + c.subject).join('\n') : '')}">${t ? t.class_count : '—'}</td>
          <td>${t ? t.weekly_periods : '—'}</td><td>${esc(t?.supervisors || '—')}</td>
          <td dir="ltr">${esc(p.email || '—')}</td><td>${esc(ROLE_LABELS[p.role])}${scCount[p.id] ? ` <span class="chip pink" title="نطاقات">${scCount[p.id]}</span>` : ''}</td><td>${pill(p.active)}</td>
          <td class="actions"><button class="btn sm" data-edit="${p.id}">تعديل</button>
            ${p.id !== ME.id ? `<button class="btn sm danger" data-del="${p.id}">حذف</button>` : ''}</td></tr>`; }).join('')
          : '<tr><td colspan="10" class="empty">لا نتائج</td></tr>'}</tbody></table>`;
    };
    draw();
    $('#q', pane).oninput = draw; ['#roleF', '#stgF', '#subF', '#supF'].forEach((x) => { $(x, pane).onchange = draw; });
    $('#add', pane).onclick = () => editStaff(null);
    $('#csv', pane).onclick = () => downloadCSV('الموظفون.csv', [['الاسم', 'البريد', 'الدور', 'المسمى', 'المادة', 'المرحلة', 'عدد الفصول', 'الفصول', 'الحصص/أسبوع', 'المشرف', 'الحالة']]
      .concat(all.map((p) => { const t = T[p.id] || {}; return [p.full_name, p.email, ROLE_LABELS[p.role], p.job_title, t.subjects || '', t.stages || '',
        t.class_count || 0, (t.classes || []).map((c) => c.label + ' (' + c.subject + ')').join(' | '), t.weekly_periods || 0, t.supervisors || '', p.active ? 'نشط' : 'موقوف']; })));
    $('#tbl', pane).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) editStaff(all.find((p) => p.id === ed.dataset.edit));
      if (dl) {
        const p = all.find((x) => x.id === dl.dataset.del);
        if (!await confirmBox(`حذف «${p.full_name}» نهائيًا؟ سيُحذف معه إسناده ونطاقاته. (للإيقاف المؤقت استخدم «تعديل» ← موقوف)`, 'حذف نهائي')) return;
        try { await run(sb.from('profiles').delete().eq('id', p.id)); toast('تم الحذف'); await changed('staff'); openTab('staff', true); }
        catch (er) { toast(errMsg(er), 'err'); }
      }
    };

    async function editStaff(p) {
      const isNew = !p; p = p || { role: 'teacher', active: true };
      const myScopes = scopes.filter((s) => s.profile_id === p.id);
      const body = document.createElement('div');
      body.innerHTML = `
        <div class="form-grid">
          <label class="f">الاسم الكامل<input id="fn" value="${esc(p.full_name || '')}"></label>
          <label class="f">البريد المدرسي<input id="em" dir="ltr" value="${esc(p.email || '')}" placeholder="name@${esc(LMS.C.SCHOOL_DOMAIN)}"></label>
          <label class="f">الدور<select id="rl" ${p.id === ME.id ? 'disabled' : ''}>${Object.entries(ROLE_LABELS).filter(([k]) => k !== 'student')
            .map(([k, v]) => `<option value="${k}" ${k === p.role ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
          <label class="f">المسمى الوظيفي<input id="jt" value="${esc(p.job_title || '')}"></label>
          <label class="f">الحالة<select id="ac" ${p.id === ME.id ? 'disabled' : ''}><option value="1" ${p.active ? 'selected' : ''}>نشط</option><option value="0" ${!p.active ? 'selected' : ''}>موقوف</option></select></label>
        </div>
        ${T[p.id] ? `<h4 style="margin:14px 0 6px">التدريس (من جدول الحصص) — ${T[p.id].class_count} فصل، ${T[p.id].weekly_periods} حصة أسبوعيًا${T[p.id].supervisors ? ' — المشرف: ' + esc(T[p.id].supervisors) : ''}</h4>
          <div class="table-wrap" style="max-height:240px;overflow:auto"><table><thead><tr><th>الفصل</th><th>المادة</th><th>الحصص</th></tr></thead><tbody>
          ${T[p.id].classes.map((c) => `<tr><td>${esc(c.label)}</td><td>${esc(c.subject)}</td><td>${c.periods ?? '—'}</td></tr>`).join('')}</tbody></table></div>
          <p class="hint">لتعديل فصول المعلم أو مادته: من مكتب الإشراف التربوي (جدول الحصص / الإعدادات).</p>` : ''}
        <p class="hint">«الإدارة العليا» ترى كل المدرسة للقراءة. «مدير مرحلة» و«مشرف» يريان ما يحدده النطاق أدناه. «المعلم» يرى فصوله المُسندة فقط.</p>
        <h4 style="margin:14px 0 6px">النطاقات</h4>
        ${isNew ? '<p class="hint">احفظ الموظف أولًا ثم افتح «تعديل» لإضافة النطاقات.</p>' : `
          <div id="scList">${myScopes.length ? myScopes.map((s) => `<div class="toolbar" style="margin:0 0 6px">
            <span class="chip pink">${esc(scopeLabel(s))}</span><button class="btn sm danger" data-sdel="${s.id}">حذف</button></div>`).join('')
            : '<p class="hint">لا توجد نطاقات.</p>'}</div>
          <div class="form-grid" style="margin-top:8px">
            <label class="f">القسم/المرحلة<select id="scStage"><option value="">كل المدرسة</option>
              <optgroup label="قسم كامل">${R.sections.map((s) => `<option value="sec:${s.id}">${esc(s.name_ar)} (كل مراحله)</option>`).join('')}</optgroup>
              <optgroup label="مرحلة">${R.stages.map((s) => `<option value="st:${s.id}">${esc(s.name_ar)}</option>`).join('')}</optgroup></select></label>
            <label class="f">من صف<input id="scMin" type="number" min="1" max="12"></label>
            <label class="f">إلى صف<input id="scMax" type="number" min="1" max="12"></label>
            <label class="f">المادة<select id="scSub"><option value="">كل المواد</option>${opts(R.subjects, (s) => s.id, (s) => s.name_ar)}</select></label>
          </div>
          <button class="btn sm ok" id="scAdd" style="margin-top:8px">+ إضافة نطاق</button>`}`;
      if (!isNew) {
        body.addEventListener('click', async (e) => {
          const d = e.target.closest('[data-sdel]');
          if (d) { try { await run(sb.from('staff_scopes').delete().eq('id', +d.dataset.sdel)); d.parentElement.remove(); scopes.splice(scopes.findIndex((s) => s.id === +d.dataset.sdel), 1); toast('حُذف النطاق'); } catch (er) { toast(errMsg(er), 'err'); } }
          if (e.target.id === 'scAdd') {
            const v = val(body, '#scStage');
            const row = { profile_id: p.id, section_id: null, stage_id: null,
              grade_min: val(body, '#scMin') ? +val(body, '#scMin') : null, grade_max: val(body, '#scMax') ? +val(body, '#scMax') : null,
              subject_id: val(body, '#scSub') ? +val(body, '#scSub') : null };
            if (v.startsWith('sec:')) row.section_id = +v.slice(4);
            if (v.startsWith('st:')) { row.stage_id = +v.slice(3); row.section_id = stageById(row.stage_id).section_id; }
            if (row.grade_min && row.grade_max && row.grade_min > row.grade_max) { toast('«من صف» أكبر من «إلى صف»', 'warn'); return; }
            try {
              const [ins] = await run(sb.from('staff_scopes').insert(row).select());
              scopes.push(ins);
              const list = $('#scList', body); if (!scopes.some((s) => s.profile_id === p.id && s.id !== ins.id)) list.innerHTML = '';
              list.insertAdjacentHTML('beforeend', `<div class="toolbar" style="margin:0 0 6px"><span class="chip pink">${esc(scopeLabel(ins))}</span><button class="btn sm danger" data-sdel="${ins.id}">حذف</button></div>`);
              toast('أُضيف النطاق');
            } catch (er) { toast(errMsg(er), 'err'); }
          }
        });
      }
      const saved = await modal({ title: isNew ? 'إضافة موظف' : 'تعديل: ' + p.full_name, body, wide: true, actions: [
        { label: 'حفظ', cls: 'primary', onClick: async (w) => {
          const row = { full_name: val(w, '#fn'), email: val(w, '#em').toLowerCase() || null, job_title: val(w, '#jt') || null };
          if (p.id !== ME.id) { row.role = val(w, '#rl'); row.active = val(w, '#ac') === '1'; }
          if (!row.full_name) { toast('الاسم مطلوب', 'warn'); return false; }
          if (row.email && !row.email.endsWith('@' + LMS.C.SCHOOL_DOMAIN)) { toast('البريد يجب أن يكون على نطاق المدرسة', 'warn'); return false; }
          if (!row.email && row.role !== 'teacher' && p.role !== 'teacher') { toast('البريد مطلوب لهذا الدور', 'warn'); return false; }
          if (isNew) await run(sb.from('profiles').insert(row)); else await run(sb.from('profiles').update(row).eq('id', p.id));
          LMS.clearCache(); toast('تم الحفظ'); return true;
        } },
        { label: 'إغلاق', cls: 'ghost', value: 'closed' }] });
      if (saved === true || (!isNew && saved !== undefined)) { await changed('staff'); openTab('staff', true); }
    }
  }
  function scopeLabel(s) {
    const parts = [];
    if (s.stage_id) parts.push(stageById(s.stage_id)?.name_ar);
    else if (s.section_id) parts.push('قسم ' + R.sections.find((x) => x.id === s.section_id)?.name_ar);
    else parts.push('كل المدرسة');
    if (s.grade_min || s.grade_max) parts.push(`الصفوف ${s.grade_min || '…'}–${s.grade_max || '…'}`);
    if (s.subject_id) parts.push(R.subjects.find((x) => x.id === s.subject_id)?.name_ar);
    return parts.join(' • ');
  }

  /* ===================================================================
     الطلاب
     =================================================================== */
  async function studentsTab(pane) {
    const all = await fetchAll(() => sb.from('v_students').select('*').order('stage_sort').order('grade_number').order('full_name'));
    pane.innerHTML = `
      <div class="toolbar">
        <input class="grow" id="q" placeholder="بحث بالاسم أو الرقم أو البريد…">
        <select id="stF"><option value="">كل المراحل</option>${opts(R.stages, (s) => s.id, (s) => s.name_ar)}</select>
        <select id="grF"><option value="">كل الصفوف</option></select>
        <select id="clF"><option value="">كل الفصول</option><option value="none">بدون فصل</option></select>
        <select id="acF"><option value="1">النشطون</option><option value="0">الموقوفون</option><option value="">الكل</option></select>
      </div>
      <div class="toolbar">
        <button class="btn primary" id="add">+ إضافة طالب</button>
        <button class="btn" id="move">📦 توزيع المحددين على فصل</button>
        <button class="btn" id="csv">⬇ تنزيل</button>
        <span class="hint grow" id="cnt"></span>
      </div>
      <div class="table-wrap glass" id="tbl"></div>`;
    const stF = $('#stF', pane), grF = $('#grF', pane), clF = $('#clF', pane);
    let current = [];
    stF.onchange = () => {
      const gs = R.grades.filter((g) => !stF.value || String(g.stage_id) === stF.value);
      grF.innerHTML = `<option value="">كل الصفوف</option>${opts(gs, (g) => g.id, gradeLabel)}`;
      grF.onchange();
    };
    grF.onchange = () => {
      const cs = R.classes.filter((c) => (!stF.value || String(c.stage_id) === stF.value) && (!grF.value || String(c.grade_id) === grF.value));
      clF.innerHTML = `<option value="">كل الفصول</option><option value="none">بدون فصل</option>${opts(cs, (c) => c.id, (c) => c.label)}`;
      draw();
    };
    function draw() {
      const q = norm(val(pane, '#q')), ac = val(pane, '#acF');
      current = all.filter((s) => {
        if (stF.value && String(s.stage_id) !== stF.value) return false;
        if (grF.value && String(s.grade_id) !== grF.value) return false;
        if (clF.value === 'none') { if (s.class_id) return false; }
        else if (clF.value && String(s.class_id) !== clF.value) return false;
        if (ac !== '' && String(s.active ? 1 : 0) !== ac) return false;
        return !q || LMS.has(`${s.full_name} ${s.student_number || ''} ${s.email || ''}`, q);
      });
      $('#cnt', pane).textContent = `${current.length} طالب${current.length > 600 ? ' — يُعرض أول 600، استخدم التصفية' : ''}`;
      const shown = current.slice(0, 600);
      $('#tbl', pane).innerHTML = `<table><thead><tr><th><input type="checkbox" id="all" title="تحديد الكل"></th><th>الاسم</th><th>الصف</th><th>الفصل</th><th>رقم الطالب</th><th>البريد</th><th>ولي الأمر</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${shown.length ? shown.map((s) => `<tr>
          <td><input type="checkbox" data-pick="${s.profile_id}"></td>
          <td><b>${esc(s.full_name)}</b></td>
          <td>${esc(s.grade_name ? s.grade_name + ' ' + s.stage_name : '—')}</td>
          <td>${s.class_name ? esc(s.class_name) : '<span class="hint">—</span>'}</td>
          <td>${esc(s.student_number || '—')}</td><td dir="ltr">${esc(s.email || '—')}</td>
          <td>${esc(s.guardian_name || '')} <span dir="ltr">${esc(s.guardian_phone || '')}</span></td>
          <td>${pill(s.active)}</td>
          <td class="actions"><button class="btn sm" data-edit="${s.profile_id}">تعديل</button><button class="btn sm danger" data-del="${s.profile_id}">حذف</button></td></tr>`).join('')
          : '<tr><td colspan="9" class="empty">لا نتائج</td></tr>'}</tbody></table>`;
      const allBox = $('#all', pane); if (allBox) allBox.onchange = () => $$('[data-pick]', pane).forEach((b) => b.checked = allBox.checked);
    }
    stF.onchange();
    $('#q', pane).oninput = draw; clF.onchange = draw; $('#acF', pane).onchange = draw;
    $('#csv', pane).onclick = () => downloadCSV('الطلاب.csv', [['الاسم', 'المرحلة', 'الصف', 'الفصل', 'رقم الطالب', 'البريد', 'ولي الأمر', 'الجوال', 'الحالة']]
      .concat(current.map((s) => [s.full_name, s.stage_name, s.grade_number, s.class_name, s.student_number, s.email, s.guardian_name, s.guardian_phone, s.active ? 'نشط' : 'موقوف'])));
    $('#add', pane).onclick = () => editStudent(null);

    $('#move', pane).onclick = async () => {
      const ids = $$('[data-pick]:checked', pane).map((b) => b.dataset.pick);
      if (!ids.length) { toast('حدد طلابًا أولًا (من مربعات الاختيار في الجدول)', 'warn'); return; }
      const picked = all.filter((s) => ids.includes(s.profile_id));
      const grades = [...new Set(picked.map((s) => s.grade_id))];
      if (grades.length > 1) { toast('الطلاب المحددون من أكثر من صف — اختر طلاب صف واحد (استخدم تصفية الصف).', 'warn'); return; }
      const gid = grades[0];
      const cs = R.classes.filter((c) => !gid || c.grade_id === gid);
      const g = R.grades.find((x) => x.id === gid);
      await modal({ title: `توزيع ${ids.length} طالب على فصل`, body: `
          <p class="hint">${g ? 'الصف: ' + esc(gradeLabel(g)) : ''}</p>
          <label class="f">فصل موجود<select id="to"><option value="">— اختر —</option>${opts(cs, (c) => c.id, (c) => c.label)}<option value="none">إزالة من الفصل</option></select></label>
          ${gid ? `<label class="f" style="margin-top:10px">أو أنشئ فصلًا جديدًا في هذا الصف (اكتب اسمه، مثل 1 أو أ)<input id="newCls"></label>` : ''}`,
        actions: [{ label: 'تنفيذ', cls: 'primary', onClick: async (w) => {
          let to = val(w, '#to'); const nc = val(w, '#newCls');
          if (!to && !nc) { toast('اختر فصلًا أو اكتب اسم فصل جديد', 'warn'); return false; }
          if (nc) {
            const exist = R.classes.find((c) => c.grade_id === gid && norm(c.name) === norm(nc));
            to = exist ? exist.id : (await run(sb.from('classes').insert({ grade_id: gid, name: nc }).select('id')))[0].id;
          }
          const cid = to === 'none' ? null : +to;
          for (let i = 0; i < ids.length; i += 200) await run(sb.from('students').update({ class_id: cid }).in('profile_id', ids.slice(i, i + 200)));
          toast('تم التوزيع'); await changed('students'); openTab('students', true); return true;
        } }, { label: 'إلغاء', cls: 'ghost' }] });
    };

    $('#tbl', pane).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) editStudent(all.find((s) => s.profile_id === ed.dataset.edit));
      if (dl) {
        const s = all.find((x) => x.profile_id === dl.dataset.del);
        if (!await confirmBox(`حذف الطالب «${s.full_name}» نهائيًا مع كل بياناته؟ (للإيقاف المؤقت استخدم «تعديل» ← موقوف)`, 'حذف نهائي')) return;
        try { await run(sb.from('profiles').delete().eq('id', s.profile_id)); toast('تم الحذف'); await changed('students'); openTab('students', true); }
        catch (er) { toast(errMsg(er), 'err'); }
      }
    };

    async function editStudent(s) {
      const isNew = !s; s = s || { active: true };
      let pv = null;
      if (!isNew) { try { pv = (await run(sb.from('student_private').select('*').eq('profile_id', s.profile_id)))[0] || null; } catch (_) {} }
      const cs = R.classes.filter((c) => !s.grade_id || c.grade_id === s.grade_id);
      const rawRows = pv && pv.raw ? Object.entries(pv.raw) : [];
      const body = `<div class="form-grid">
        <label class="f">الاسم الكامل<input id="fn" value="${esc(s.full_name || '')}"></label>
        <label class="f">رقم الطالب (اختياري)<input id="num" value="${esc(s.student_number || '')}"></label>
        <label class="f">البريد المدرسي<input id="em" dir="ltr" value="${esc(s.email || '')}" placeholder="للدخول إلى المنصة"></label>
        <label class="f">الصف<select id="gr">${opts(R.grades, (g) => g.id, gradeLabel, s.grade_id, '— اختر —')}</select></label>
        <label class="f">الفصل<select id="cl">${opts(cs, (c) => c.id, (c) => c.label, s.class_id, '— بدون فصل —')}</select></label>
        <label class="f">اسم ولي الأمر<input id="gn" value="${esc(s.guardian_name || '')}"></label>
        <label class="f">جوال ولي الأمر<input id="gp" dir="ltr" value="${esc(s.guardian_phone || '')}"></label>
        <label class="f">الحالة<select id="ac"><option value="1" ${s.active ? 'selected' : ''}>نشط</option><option value="0" ${!s.active ? 'selected' : ''}>موقوف</option></select></label>
      </div>
      ${pv ? `<h4 style="margin:16px 0 6px">🔒 بيانات نظام التسجيل <span class="hint">(تظهر لمدير النظام والإدارة العليا فقط)</span></h4>
        <div class="form-grid">
          <label class="f">رقم الهوية / الإقامة<input id="nid" dir="ltr" value="${esc(pv.national_id || '')}"></label>
          <label class="f">تاريخ الميلاد<input id="dob" type="date" value="${esc(pv.date_of_birth || '')}"></label>
          <label class="f">الجنسية<input id="nat" value="${esc(pv.nationality || '')}"></label>
          <label class="f">بريد ولي الأمر<input id="pem" dir="ltr" value="${esc(pv.parent_email || '')}"></label>
        </div>
        ${rawRows.length ? `<details style="margin-top:10px"><summary class="hint">كل أعمدة الملف الأصلي (${rawRows.length})</summary>
          <div class="table-wrap" style="margin-top:6px"><table><tbody>${rawRows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
        <p class="hint">آخر تحديث من نظام التسجيل: ${pv.source_modified_at ? fmtDate(pv.source_modified_at) : '—'} — إعادة استيراد الملف ستستبدل هذه القيم.</p>` : ''}`;
      const ok = await modal({ title: isNew ? 'إضافة طالب' : 'تعديل: ' + s.full_name, body, wide: true, actions: [
        { label: 'حفظ', cls: 'primary', onClick: async (w) => {
          const prof = { full_name: val(w, '#fn'), email: val(w, '#em').toLowerCase() || null, active: val(w, '#ac') === '1' };
          const st = { student_number: val(w, '#num') || null, grade_id: val(w, '#gr') ? +val(w, '#gr') : null,
                       class_id: val(w, '#cl') ? +val(w, '#cl') : null,
                       guardian_name: val(w, '#gn') || null, guardian_phone: val(w, '#gp') || null };
          if (!prof.full_name) { toast('الاسم مطلوب', 'warn'); return false; }
          if (!st.grade_id && !st.class_id) { toast('اختر الصف', 'warn'); return false; }
          if (st.class_id) {
            const c = R.classes.find((x) => x.id === st.class_id);
            if (c && st.grade_id && c.grade_id !== st.grade_id) { toast('الفصل المختار ليس من نفس الصف', 'warn'); return false; }
          }
          if (prof.email && !prof.email.endsWith('@' + LMS.C.SCHOOL_DOMAIN)) { toast('البريد يجب أن يكون على نطاق المدرسة', 'warn'); return false; }
          if (isNew) {
            const [np] = await run(sb.from('profiles').insert({ ...prof, role: 'student' }).select('id'));
            const { error } = await sb.from('students').insert({ ...st, profile_id: np.id });
            if (error) { await sb.from('profiles').delete().eq('id', np.id); throw error; }
          } else {
            await run(sb.from('profiles').update(prof).eq('id', s.profile_id));
            await run(sb.from('students').update(st).eq('profile_id', s.profile_id));
            if (pv) {
              const nid = val(w, '#nid').replace(/\s/g, '');
              if (!nid) { toast('رقم الهوية لا يمكن أن يكون فارغًا', 'warn'); return false; }
              await run(sb.from('student_private').update({ national_id: nid, date_of_birth: val(w, '#dob') || null,
                nationality: val(w, '#nat') || null, parent_email: val(w, '#pem').toLowerCase() || null, updated_at: new Date().toISOString() })
                .eq('profile_id', s.profile_id));
            }
          }
          toast('تم الحفظ'); return true;
        } }, { label: 'إلغاء', cls: 'ghost' }] });
      if (ok === true) { await changed('students'); openTab('students', true); }
    }
    // عند تغيير الصف في نافذة التعديل تُحدَّث قائمة الفصول
    if (!window.__grListener) {
      window.__grListener = true;
      document.addEventListener('change', (e) => {
        if (e.target.id !== 'gr') return;
        const w = e.target.closest('.modal'); if (!w) return;
        const clSel = $('#cl', w); const gid = +e.target.value;
        clSel.innerHTML = opts(R.classes.filter((c) => c.grade_id === gid), (c) => c.id, (c) => c.label, '', '— بدون فصل —');
      });
    }
  }

  /* ===================================================================
     الفصول
     =================================================================== */
  async function classesTab(pane) {
    const teachers = R.staff.filter((s) => s.active);
    const CT = Object.fromEntries((await fetchAll(() => sb.from('v_class_teaching').select('*'))).map((x) => [x.class_id, x]));
    const tName = Object.fromEntries(R.staff.map((s) => [s.id, s.full_name]));
    pane.innerHTML = `
      <div class="toolbar">
        <select id="stF"><option value="">كل المراحل</option>${opts(R.stages, (s) => s.id, (s) => s.name_ar)}</select>
        <span class="grow"></span>
        <button class="btn primary" id="add">+ إضافة فصل</button>
      </div>
      <div class="table-wrap glass" id="tbl"></div>`;
    const draw = () => {
      const f = val(pane, '#stF');
      const rows = R.classes.filter((c) => !f || String(c.stage_id) === f);
      $('#tbl', pane).innerHTML = `<p class="hint" style="margin:0 0 8px">${rows.length} فصل — المعلمون والمواد من جدول الحصص في مكتب الإشراف التربوي.</p>
        <table><thead><tr><th>الفصل</th><th>القسم</th><th>المعلمون</th><th>المواد</th><th>الحصص/أسبوع</th><th>الطلاب</th><th>رائد الفصل</th><th>الحالة</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.map((c) => { const t = CT[c.id]; return `<tr><td><b>${esc(c.label)}</b></td><td>${esc(c.section_name)}</td>
          <td title="${esc(t ? t.teachers.map((x) => x.subject + ': ' + x.teacher).join('\n') : '')}">${t ? t.teacher_count : 0}</td>
          <td>${t ? t.subject_count : 0}</td><td>${t ? t.weekly_periods : 0}</td><td>${c.student_count}</td>
          <td>${esc(tName[c.homeroom_teacher_id] || '—')}</td><td>${pill(c.active)}</td>
          <td class="actions"><button class="btn sm" data-edit="${c.id}">تعديل</button><button class="btn sm danger" data-del="${c.id}">حذف</button></td></tr>`; }).join('')
          : '<tr><td colspan="9" class="empty">لا توجد فصول — تُنشأ تلقائيًا عند استيراد الطلاب، أو أضفها يدويًا.</td></tr>'}</tbody></table>`;
    };
    draw(); $('#stF', pane).onchange = draw;
    $('#add', pane).onclick = () => edit(null);
    $('#tbl', pane).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) edit(R.classes.find((c) => c.id === +ed.dataset.edit));
      if (dl) {
        const c = R.classes.find((x) => x.id === +dl.dataset.del);
        if (c.student_count > 0) { toast(`لا يمكن حذف فصل به ${c.student_count} طالب — انقلهم أولًا أو أوقف الفصل.`, 'warn'); return; }
        if (!await confirmBox(`حذف الفصل «${c.label}»؟ سيُحذف إسناد المعلمين له.`, 'حذف')) return;
        try { await run(sb.from('classes').delete().eq('id', c.id)); toast('تم الحذف'); await changed('classes'); openTab('classes', true); }
        catch (er) { toast(errMsg(er), 'err'); }
      }
    };
    async function edit(c) {
      const isNew = !c; c = c || { active: true };
      const body = `<div class="form-grid">
        <label class="f">الصف<select id="gr" ${isNew ? '' : 'disabled'}>${opts(R.grades, (g) => g.id, gradeLabel, c.grade_id)}</select></label>
        <label class="f">اسم الفصل/الشعبة<input id="nm" value="${esc(c.name || '')}" placeholder="مثال: 1 أو أ أو A"></label>
        <label class="f">رائد الفصل<select id="hr">${opts(teachers, (t) => t.id, (t) => t.full_name, c.homeroom_teacher_id, '— لا يوجد —')}</select></label>
        <label class="f">الحالة<select id="ac"><option value="1" ${c.active ? 'selected' : ''}>نشط</option><option value="0" ${!c.active ? 'selected' : ''}>موقوف</option></select></label>
      </div>`;
      const ok = await modal({ title: isNew ? 'إضافة فصل' : 'تعديل: ' + c.label, body, actions: [
        { label: 'حفظ', cls: 'primary', onClick: async (w) => {
          const row = { name: val(w, '#nm'), homeroom_teacher_id: val(w, '#hr') || null, active: val(w, '#ac') === '1' };
          if (!row.name) { toast('اسم الفصل مطلوب', 'warn'); return false; }
          if (isNew) await run(sb.from('classes').insert({ ...row, grade_id: +val(w, '#gr') }));
          else await run(sb.from('classes').update(row).eq('id', c.id));
          toast('تم الحفظ'); return true;
        } }, { label: 'إلغاء', cls: 'ghost' }] });
      if (ok === true) { await changed('classes'); openTab('classes', true); }
    }
  }

  /* ===================================================================
     المواد
     =================================================================== */
  async function subjectsTab(pane) {
    const ta = await fetchAll(() => sb.from('teaching_assignments').select('subject_id'));
    const use = {}; ta.forEach((t) => { use[t.subject_id] = (use[t.subject_id] || 0) + 1; });
    pane.innerHTML = `<div class="toolbar"><span class="grow hint">المواد تُضاف تلقائيًا من ملف الإسناد، ويمكن تعديلها هنا.</span>
      <button class="btn primary" id="add">+ إضافة مادة</button></div><div class="table-wrap glass" id="tbl"></div>`;
    $('#tbl', pane).innerHTML = `<table><thead><tr><th>المادة</th><th>بالإنجليزية</th><th>الرمز</th><th>عدد الإسنادات</th><th>الحالة</th><th></th></tr></thead>
      <tbody>${R.subjects.length ? R.subjects.map((s) => `<tr><td><b>${esc(s.name_ar)}</b></td><td>${esc(s.name_en || '')}</td><td>${esc(s.code || '')}</td>
        <td>${use[s.id] || 0}</td><td>${pill(s.active)}</td>
        <td class="actions"><button class="btn sm" data-edit="${s.id}">تعديل</button><button class="btn sm danger" data-del="${s.id}">حذف</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">لا توجد مواد</td></tr>'}</tbody></table>`;
    $('#add', pane).onclick = () => edit(null);
    $('#tbl', pane).onclick = async (e) => {
      const ed = e.target.closest('[data-edit]'), dl = e.target.closest('[data-del]');
      if (ed) edit(R.subjects.find((s) => s.id === +ed.dataset.edit));
      if (dl) {
        const s = R.subjects.find((x) => x.id === +dl.dataset.del);
        if (!await confirmBox(`حذف مادة «${s.name_ar}»؟${use[s.id] ? ` سيُحذف معها ${use[s.id]} إسناد ونطاقات المشرفين المرتبطة بها.` : ''}`, 'حذف')) return;
        try { await run(sb.from('subjects').delete().eq('id', s.id)); toast('تم الحذف'); await changed('subjects'); openTab('subjects', true); }
        catch (er) { toast(errMsg(er), 'err'); }
      }
    };
    async function edit(s) {
      const isNew = !s; s = s || { active: true };
      const ok = await modal({ title: isNew ? 'إضافة مادة' : 'تعديل مادة', body: `<div class="form-grid">
          <label class="f">الاسم بالعربية<input id="ar" value="${esc(s.name_ar || '')}"></label>
          <label class="f">الاسم بالإنجليزية<input id="en" dir="ltr" value="${esc(s.name_en || '')}"></label>
          <label class="f">الرمز (اختياري)<input id="cd" dir="ltr" value="${esc(s.code || '')}"></label>
          <label class="f">الحالة<select id="ac"><option value="1" ${s.active ? 'selected' : ''}>نشط</option><option value="0" ${!s.active ? 'selected' : ''}>موقوف</option></select></label></div>`,
        actions: [{ label: 'حفظ', cls: 'primary', onClick: async (w) => {
          const row = { name_ar: val(w, '#ar'), name_en: val(w, '#en') || null, code: val(w, '#cd') || null, active: val(w, '#ac') === '1' };
          if (!row.name_ar) { toast('اسم المادة مطلوب', 'warn'); return false; }
          if (isNew) await run(sb.from('subjects').insert(row)); else await run(sb.from('subjects').update(row).eq('id', s.id));
          toast('تم الحفظ'); return true;
        } }, { label: 'إلغاء', cls: 'ghost' }] });
      if (ok === true) { await changed('subjects'); openTab('subjects', true); }
    }
  }

  /* ===================================================================
     الإسناد
     =================================================================== */
  async function assignTab(pane) {
    const all = await fetchAll(() => sb.from('teaching_assignments').select('*').order('id'));
    const cls = Object.fromEntries(R.classes.map((c) => [c.id, c]));
    const sub = Object.fromEntries(R.subjects.map((s) => [s.id, s.name_ar]));
    const stf = Object.fromEntries(R.staff.map((s) => [s.id, s]));
    pane.innerHTML = `
      <div class="toolbar">
        <select id="tF"><option value="">كل المعلمين</option>${opts(R.staff, (s) => s.id, (s) => s.full_name)}</select>
        <select id="cF"><option value="">كل الفصول</option>${opts(R.classes, (c) => c.id, (c) => c.label)}</select>
        <select id="sF"><option value="">كل المواد</option>${opts(R.subjects, (s) => s.id, (s) => s.name_ar)}</select>
        <span class="grow"></span>
        <button class="btn primary" id="add">+ إسناد جديد</button>
        <button class="btn" id="csv">⬇ تنزيل</button>
      </div>
      <p class="hint" id="cnt"></p>
      <div class="table-wrap glass" id="tbl"></div>`;
    let rows = [];
    const draw = () => {
      const t = val(pane, '#tF'), c = val(pane, '#cF'), s = val(pane, '#sF');
      rows = all.filter((a) => (!t || a.teacher_id === t) && (!c || String(a.class_id) === c) && (!s || String(a.subject_id) === s));
      rows.sort((a, b) => (stf[a.teacher_id]?.full_name || '').localeCompare(stf[b.teacher_id]?.full_name || '', 'ar') || a.class_id - b.class_id);
      $('#cnt', pane).textContent = `${rows.length} إسناد`;
      $('#tbl', pane).innerHTML = `<table><thead><tr><th>المعلم</th><th>الفصل</th><th>المادة</th><th>حصص/أسبوع</th><th></th></tr></thead>
        <tbody>${rows.length ? rows.slice(0, 800).map((a) => `<tr><td><b>${esc(stf[a.teacher_id]?.full_name || '؟')}</b></td>
          <td>${esc(cls[a.class_id]?.label || '؟')}</td><td>${esc(sub[a.subject_id] || '؟')}</td><td>${a.weekly_periods ?? '—'}</td>
          <td><button class="btn sm danger" data-del="${a.id}">حذف</button></td></tr>`).join('')
          : '<tr><td colspan="5" class="empty">لا توجد إسنادات</td></tr>'}</tbody></table>`;
    };
    draw(); ['#tF', '#cF', '#sF'].forEach((s) => { $(s, pane).onchange = draw; });
    $('#csv', pane).onclick = () => downloadCSV('الإسناد.csv', [['بريد المعلم', 'المعلم', 'المرحلة', 'الصف', 'الفصل', 'المادة', 'عدد الحصص الأسبوعية']]
      .concat(rows.map((a) => { const c = cls[a.class_id] || {}; return [stf[a.teacher_id]?.email, stf[a.teacher_id]?.full_name, c.stage_name, c.grade_number, c.name, sub[a.subject_id], a.weekly_periods]; })));
    $('#add', pane).onclick = async () => {
      const ok = await modal({ title: 'إسناد جديد', body: `<div class="form-grid">
          <label class="f">المعلم<select id="t">${opts(R.staff.filter((s) => s.active), (s) => s.id, (s) => s.full_name, val(pane, '#tF'))}</select></label>
          <label class="f">الفصل<select id="c">${opts(R.classes, (c) => c.id, (c) => c.label, val(pane, '#cF'))}</select></label>
          <label class="f">المادة<select id="s">${opts(R.subjects, (s) => s.id, (s) => s.name_ar, val(pane, '#sF'))}</select></label>
          <label class="f">حصص أسبوعيًا<input id="w" type="number" min="0" max="40"></label></div>`,
        actions: [{ label: 'حفظ', cls: 'primary', onClick: async (w) => {
          if (!val(w, '#t') || !val(w, '#c') || !val(w, '#s')) { toast('أكمل الحقول', 'warn'); return false; }
          await run(sb.from('teaching_assignments').insert({ teacher_id: val(w, '#t'), class_id: +val(w, '#c'), subject_id: +val(w, '#s'),
            weekly_periods: val(w, '#w') ? +val(w, '#w') : null }));
          toast('تم الحفظ'); return true;
        } }, { label: 'إلغاء', cls: 'ghost' }] });
      if (ok === true) { await changed('assign'); openTab('assign', true); }
    };
    $('#tbl', pane).onclick = async (e) => {
      const dl = e.target.closest('[data-del]'); if (!dl) return;
      if (!await confirmBox('حذف هذا الإسناد؟', 'حذف')) return;
      try { await run(sb.from('teaching_assignments').delete().eq('id', +dl.dataset.del)); toast('تم الحذف'); await changed('assign'); openTab('assign', true); }
      catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  /* ===================================================================
     الأعوام والفصول الدراسية
     =================================================================== */
  /* ---------- ترحيل الطلاب للعام الجديد (sql/61) ---------- */
  async function promoSetup(pane, reload) {
    const rpc = async (fn, a) => { const { data, error } = await sb.rpc(fn, a || {}); if (error) throw error; return data; };
    let plan; try { plan = await rpc('promo_plan', { p: {} }); } catch (e) { $('#promoLast', pane).innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const L = plan.last_run;
    if (L) $('#promoLast', pane).innerHTML = `<div class="hint" style="margin-top:8px">آخر ترحيل: ${new Date(L.at).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })}
      (${esc(L.from || '')} ← ${esc(L.to || '')}) ${L.undone ? '— <b>تم التراجع عنه</b>' : `<button class="btn sm ghost" id="promoUndo">↩ تراجع عن هذا الترحيل</button>`}</div>`;
    if ($('#promoUndo', pane)) $('#promoUndo', pane).onclick = async () => {
      if (!await confirmBox('التراجع عن آخر ترحيل؟ سيعود كل طالب لصفه وفصله السابق، وتعود حسابات الخريجين كما كانت، ويعود العام الدراسي السابق هو الحالي.', 'نعم، تراجع')) return;
      try { const r = await rpc('promo_undo', { p_run: L.id }); toast(`تم التراجع — أُعيد ${r.restored} طالب`); await changed('years'); reload(); } catch (e) { toast(errMsg(e), 'err'); }
    };
    $('#promo', pane).onclick = () => promoWizard(plan, rpc, reload);
  }
  function promoWizard(plan0, rpc, reload) {
    const cy = plan0.current_year || '';
    const m = cy.match(/(\d{4})/); const ny = m ? cy.replace(m[1], String(+m[1] + 1)) : '';
    const ex = new Map();
    modal({ title: '🎓 ترحيل الطلاب للعام الدراسي الجديد', wide: true, body: `
      <div class="notice warn" style="margin-bottom:10px">هذه العملية تغيّر صف <b>كل طلاب المدرسة</b> مرة واحدة. استخدمها <b>بعد انتهاء العام الدراسي واعتماد النتائج</b> فقط. ستظهر لك معاينة كاملة قبل التنفيذ، ويمكن التراجع بعدها.</div>
      <div class="form-grid"><label class="f">العام الدراسي الحالي<input value="${esc(cy)}" disabled></label>
        <label class="f">العام الدراسي الجديد<input id="ny" value="${esc(ny)}" placeholder="1449هـ"></label>
        <label class="f">الفصل الدراسي الأول في العام الجديد<input id="nt" value="الفصل الدراسي الأول"></label></div>
      <label class="chk"><input type="checkbox" id="kc" checked> نقل الطالب لفصل بنفس الاسم في الصف الجديد إن وُجد (مثال: ٣/أ ← ٤/أ)، وإلا يبقى بلا فصل حتى توزّعه</label>
      <label class="chk"><input type="checkbox" id="dg" checked> إيقاف حسابات الخريجين (طلاب الثالث الثانوي، والسادس بنات، وGrade 12) — تبقى بياناتهم محفوظة</label>
      <div class="f" style="margin-top:8px"><span>طلاب باقون للإعادة (لا يُرحَّلون) — اختياري</span>
        <input id="q" type="search" placeholder="ابحث باسم الطالب أو رقمه لإضافته…" style="width:100%"><div id="res" class="promo-res"></div><div id="exl" class="hint">لا يوجد.</div></div>
      <div id="pv"></div>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: '👁️ معاينة', onClick: async (w) => { await preview(w); return false; } },
        { label: 'متابعة للتأكيد ←', cls: 'primary', onClick: async (w) => { const pl = await preview(w); if (!pl) return false; setTimeout(() => confirmStep(w.__opts, pl), 50); return true; } }] });
    setTimeout(() => {
      const w = document.querySelector('.modal-wrap:last-child'); let tm;
      const paintEx = () => { $('#exl', w).innerHTML = ex.size ? [...ex].map(([id, n]) => `<span class="chip">${esc(n)} <a href="#" data-x="${id}">✕</a></span>`).join(' ') : 'لا يوجد.'; $('#pv', w).innerHTML = ''; };
      $('#q', w).oninput = (e) => { clearTimeout(tm); const q = e.target.value.trim(); if (q.length < 2) { $('#res', w).innerHTML = ''; return; }
        tm = setTimeout(async () => { const R2 = await rpc('pf_find', { p_q: q }).catch(() => []);
          $('#res', w).innerHTML = R2.map((x) => `<a href="#" data-p="${x.id}" data-n="${esc(x.name)} (${esc(x.class || '')})">${esc(x.name)} <span class="hint">${esc(x.class || '')}</span></a>`).join('') || '<div class="hint">لا نتائج.</div>'; }, 300); };
      w.addEventListener('click', (e) => { const p = e.target.closest('[data-p]'); if (p) { e.preventDefault(); ex.set(p.dataset.p, p.dataset.n); $('#res', w).innerHTML = ''; $('#q', w).value = ''; paintEx(); }
        const x = e.target.closest('[data-x]'); if (x) { e.preventDefault(); ex.delete(x.dataset.x); paintEx(); } });
      ['#kc', '#dg', '#ny'].forEach((id) => { $(id, w).onchange = () => { $('#pv', w).innerHTML = ''; }; });
    }, 50);
    async function preview(w) {
      const opts = { exclude: [...ex.keys()], keep_class: $('#kc', w).checked, deactivate_graduates: $('#dg', w).checked, new_year: $('#ny', w).value.trim(), new_term: $('#nt', w).value.trim() };
      if (!opts.new_year) { toast('اكتب اسم العام الدراسي الجديد', 'warn'); return null; }
      if (opts.new_year === cy) { toast('العام الجديد يجب أن يختلف عن الحالي', 'warn'); return null; }
      const pl = await rpc('promo_plan', { p: opts }); w.__opts = opts;
      $('#pv', w).innerHTML = `<h3 style="margin:14px 0 6px">المعاينة</h3>
        ${pl.last_run && !pl.last_run.undone ? `<div class="notice warn">آخر ترحيل تم في ${new Date(pl.last_run.at).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn')} (${esc(pl.last_run.from || '')} ← ${esc(pl.last_run.to || '')}) — تأكد أنك لا تكرر الترحيل.</div>` : ''}
        <div class="promo-kpi"><div><b>${pl.promoted}</b><span>يُرحَّل للصف الأعلى</span></div><div><b>${pl.graduates}</b><span>يتخرّج 🎓</span></div><div><b>${pl.kept}</b><span>باقٍ للإعادة</span></div><div><b>${pl.total}</b><span>إجمالي الطلاب</span></div></div>
        <div class="table-wrap no-tools" style="max-height:320px"><table><thead><tr><th>من</th><th>إلى</th><th>عدد الطلاب</th><th>باقون</th></tr></thead><tbody>
        ${pl.rows.map((r) => `<tr><td>${esc(r.from)}</td><td>${r.to.includes('تخرّج') ? `<b>${esc(r.to)}</b>` : esc(r.to)}</td><td><b>${r.n}</b></td><td>${r.kept || ''}</td></tr>`).join('')}</tbody></table></div>`;
      return pl;
    }
    function confirmStep(opts, pl) {
      modal({ title: '⚠️ تأكيد ترحيل الطلاب', body: `
        <div class="notice err" style="line-height:1.9">أنت على وشك:<br>• نقل <b>${pl.promoted}</b> طالبًا إلى الصف الأعلى<br>• تخريج <b>${pl.graduates}</b> طالبًا${opts.deactivate_graduates ? ' وإيقاف حساباتهم' : ''}<br>
          • بدء العام الدراسي <b>${esc(opts.new_year)}</b> (${esc(opts.new_term)}) وجعله الحالي${pl.kept ? `<br>• إبقاء <b>${pl.kept}</b> طالبًا في صفوفهم` : ''}<br>
          ${opts.keep_class ? '• الطالب يُنقل لفصل بنفس الاسم إن وُجد، والباقي بلا فصل حتى توزّعهم' : '• كل الطلاب سيكونون <b>بلا فصل</b> حتى توزّعهم من جديد'}</div>
        <p>يمكنك التراجع لاحقًا من نفس الصفحة («↩ تراجع عن هذا الترحيل»).</p>
        <label class="f">للتأكيد اكتب كلمة <b>ترحيل</b><input id="cf" autocomplete="off"></label>`,
        actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: '🎓 تنفيذ الترحيل', cls: 'danger', onClick: async (w) => {
          if ($('#cf', w).value.trim() !== 'ترحيل') { toast('اكتب كلمة «ترحيل» للتأكيد', 'warn'); return false; }
          const r = await rpc('promo_run', { p: Object.assign({ confirm: 'ترحيل' }, opts) });
          await changed('years'); LMS.clearCache && LMS.clearCache();
          modal({ title: '✅ تم ترحيل الطلاب', body: `<p>رُحّل <b>${r.promoted}</b> طالبًا، وتخرّج <b>${r.graduates}</b>${r.kept ? `، وبقي <b>${r.kept}</b> للإعادة` : ''}. العام الحالي الآن: <b>${esc(r.new_year || '')}</b>.</p>
            <p>${r.with_class} طالبًا نُقلوا لفصول بنفس الاسم، و<b>${r.without_class}</b> بلا فصل.</p>
            ${r.without_class ? '<div class="notice">الخطوة التالية: وزّع الطلاب على فصولهم من <b>لوحة الإدارة ← الاستيراد ← توزيع الطلاب على الفصول</b> (ملف Excel فيه الهوية والفصل)، أو من تبويب «الفصول».</div>' : ''}`,
            actions: [{ label: 'تم', value: null, cls: 'primary' }] });
          reload(); return true; } }] });
    }
  }

  async function yearsTab(pane) {
    const years = await run(sb.from('academic_years').select('*').order('id'));
    const terms = await run(sb.from('terms').select('*').order('id'));
    pane.innerHTML = `<div class="card glass promo-card" style="margin-bottom:14px"><div class="toolbar" style="margin:0;flex-wrap:wrap">
        <div class="grow"><b style="font-size:1.05rem">🎓 ترحيل الطلاب للعام الدراسي الجديد</b>
          <div class="hint">في نهاية العام: ينقل كل طالب للصف الأعلى (السادس الابتدائي ← الأول المتوسط، الثالث المتوسط ← الأول الثانوي)، ويُخرّج طلاب آخر صف، ويبدأ العام الجديد — مع معاينة قبل التنفيذ وإمكانية التراجع.</div></div>
        <button class="btn primary" id="promo">🎓 ترحيل الطلاب…</button></div><div id="promoLast"></div></div>
      <div class="toolbar"><span class="grow hint">العام والفصل «الحالي» يظهران للمستخدمين، وستُربط بهما الواجبات والاختبارات في المراحل القادمة.</span>
      <button class="btn primary" id="addY">+ عام دراسي</button></div>
      ${years.map((y) => `<div class="card glass" style="margin-bottom:12px">
        <div class="toolbar"><h3 class="grow" style="margin:0">${esc(y.name)} ${y.is_current ? '<span class="chip teal">الحالي</span>' : ''}</h3>
          ${!y.is_current ? `<button class="btn sm" data-ycur="${y.id}">اجعله الحالي</button>` : ''}
          <button class="btn sm" data-tadd="${y.id}">+ فصل دراسي</button>
          <button class="btn sm danger" data-ydel="${y.id}">حذف</button></div>
        <div class="chips">${terms.filter((t) => t.year_id === y.id).map((t) => `<span class="chip ${t.is_current ? 'teal' : 'gray'}">${esc(t.name)}
          ${t.starts_on ? `(${t.starts_on} ← ${t.ends_on || '…'})` : ''}
          ${!t.is_current ? `<button class="icon-btn" title="اجعله الحالي" data-tcur="${t.id}">★</button>` : ' ★'}
          <button class="icon-btn" title="حذف" data-tdel="${t.id}">✕</button></span>`).join('') || '<span class="hint">لا توجد فصول دراسية</span>'}</div>
      </div>`).join('') || '<div class="card glass empty">لا توجد أعوام</div>'}`;
    const reload = async () => { loaded.years = false; await openTab('years', true); };
    promoSetup(pane, reload);
    $('#addY', pane).onclick = async () => {
      const ok = await modal({ title: 'عام دراسي جديد', body: `<div class="form-grid">
        <label class="f">الاسم<input id="n" placeholder="1449هـ"></label>
        <label class="f">البداية<input id="s" type="date"></label><label class="f">النهاية<input id="e" type="date"></label></div>`,
        actions: [{ label: 'حفظ', cls: 'primary', onClick: async (w) => {
          if (!val(w, '#n')) { toast('الاسم مطلوب', 'warn'); return false; }
          await run(sb.from('academic_years').insert({ name: val(w, '#n'), starts_on: val(w, '#s') || null, ends_on: val(w, '#e') || null }));
          return true; } }, { label: 'إلغاء', cls: 'ghost' }] });
      if (ok === true) reload();
    };
    pane.onclick = async (e) => {
      const d = e.target.closest('[data-ycur],[data-tadd],[data-ydel],[data-tcur],[data-tdel]'); if (!d) return;
      try {
        if (d.dataset.ycur) {
          await run(sb.from('academic_years').update({ is_current: false }).eq('is_current', true));
          await run(sb.from('academic_years').update({ is_current: true }).eq('id', +d.dataset.ycur));
        }
        if (d.dataset.tcur) {
          const t = terms.find((x) => x.id === +d.dataset.tcur);
          await run(sb.from('terms').update({ is_current: false }).eq('is_current', true));
          await run(sb.from('terms').update({ is_current: true }).eq('id', t.id));
          await run(sb.from('academic_years').update({ is_current: false }).eq('is_current', true).neq('id', t.year_id));
          await run(sb.from('academic_years').update({ is_current: true }).eq('id', t.year_id));
        }
        if (d.dataset.ydel) {
          if (!await confirmBox('حذف العام الدراسي وكل فصوله الدراسية؟', 'حذف')) return;
          await run(sb.from('academic_years').delete().eq('id', +d.dataset.ydel));
        }
        if (d.dataset.tdel) {
          if (!await confirmBox('حذف هذا الفصل الدراسي؟', 'حذف')) return;
          await run(sb.from('terms').delete().eq('id', +d.dataset.tdel));
        }
        if (d.dataset.tadd) {
          const ok = await modal({ title: 'فصل دراسي جديد', body: `<div class="form-grid">
            <label class="f">الاسم<input id="n" placeholder="الفصل الدراسي الثاني"></label>
            <label class="f">البداية<input id="s" type="date"></label><label class="f">النهاية<input id="e" type="date"></label></div>`,
            actions: [{ label: 'حفظ', cls: 'primary', onClick: async (w) => {
              if (!val(w, '#n')) { toast('الاسم مطلوب', 'warn'); return false; }
              await run(sb.from('terms').insert({ year_id: +d.dataset.tadd, name: val(w, '#n'), starts_on: val(w, '#s') || null, ends_on: val(w, '#e') || null }));
              return true; } }, { label: 'إلغاء', cls: 'ghost' }] });
          if (ok !== true) return;
        }
        toast('تم'); reload();
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  /* ===================================================================
     سجل التغييرات
     =================================================================== */
  const TABLE_AR = { profiles: 'المستخدمون', students: 'الطلاب', classes: 'الفصول', subjects: 'المواد', teaching_assignments: 'الإسناد',
    staff_scopes: 'النطاقات', parent_links: 'أولياء الأمور', academic_years: 'الأعوام', terms: 'الفصول الدراسية', app_settings: 'الإعدادات' };
  const ACT_AR = { INSERT: 'إضافة', UPDATE: 'تعديل', DELETE: 'حذف' };
  async function auditTab(pane) {
    pane.innerHTML = `<div class="toolbar"><select id="tf"><option value="">كل الجداول</option>${Object.entries(TABLE_AR).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <span class="hint grow">آخر 300 تغيير</span><button class="btn" id="rf">تحديث</button></div><div class="table-wrap glass" id="tbl"></div>`;
    const load = async () => {
      let q = sb.from('audit_log').select('*').order('at', { ascending: false }).limit(300);
      if (val(pane, '#tf')) q = q.eq('table_name', val(pane, '#tf'));
      const rows = await run(q);
      $('#tbl', pane).innerHTML = `<table><thead><tr><th>الوقت</th><th>بواسطة</th><th>الجدول</th><th>العملية</th><th>التفاصيل</th></tr></thead>
        <tbody>${rows.length ? rows.map((r) => `<tr><td>${fmtDate(r.at)}</td><td dir="ltr">${esc(r.actor || 'النظام')}</td>
          <td>${esc(TABLE_AR[r.table_name] || r.table_name)}</td><td>${ACT_AR[r.action] || r.action}</td>
          <td style="white-space:normal;max-width:520px">${esc(summary(r))}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">لا يوجد</td></tr>'}</tbody></table>`;
    };
    const summary = (r) => {
      const o = r.old_data || {}, n = r.new_data || {};
      const name = n.full_name || o.full_name || n.name_ar || o.name_ar || n.name || o.name || n.student_number || o.student_number || '';
      if (r.action !== 'UPDATE') return name;
      const ch = Object.keys(n).filter((k) => k !== 'updated_at' && JSON.stringify(n[k]) !== JSON.stringify(o[k]))
        .map((k) => `${k}: ${o[k] ?? '—'} ← ${n[k] ?? '—'}`);
      return `${name} — ${ch.join('، ')}`;
    };
    $('#tf', pane).onchange = load; $('#rf', pane).onclick = load;
    await load();
  }

  /* ===================================================================
     الإعدادات
     =================================================================== */
  // التحكم الكامل في البطاقات (sql/78) — كل بطاقات الصفحة الرئيسية
  const ALL_MODS = (LMS.C.MODULES || []);
  const BETA_ROLES = ['leadership', 'principal', 'supervisor', 'teacher', 'staff', 'student', 'parent'];
  const defBeta = (m) => (m._defBeta !== undefined ? m._defBeta : !!m.beta);
  const defUse = (m) => (!m.roles || !m.roles.length ? BETA_ROLES.slice() : m.roles.filter((r) => r !== 'admin'));
  const defStatus = (m) => (defBeta(m) ? 'beta' : 'open');
  const betaRoles = (m, saved) => Array.isArray(saved && saved[m.key]) ? saved[m.key] : defUse(m);
  const LOCK_DEFAULT = ['leadership', 'principal', 'supervisor', 'teacher', 'staff'];
  const lockedRoles = (saved) => Array.isArray(saved && saved._locked) ? saved._locked : LOCK_DEFAULT;
  const cardOf = (m, saved) => (saved && saved._cards && saved._cards[m.key]) || {};
  const sameSet = (x, y) => x.length === y.length && x.every((v) => y.includes(v));
  // الترتيب الحالي: المحفوظ (_order) وإلا الافتراضي (المفتوحة ثم التجريبية، و«قريبًا» آخرًا)
  const sortedMods = (saved) => { const o = Array.isArray(saved && saved._order) ? saved._order : null;
    const def = ALL_MODS.filter((m) => m.url && !defBeta(m)).concat(ALL_MODS.filter((m) => m.url && defBeta(m)), ALL_MODS.filter((m) => !m.url));
    if (!o) return def; const r = (m) => { const i = o.indexOf(m.key); return i < 0 ? 1e4 + def.indexOf(m) : i; };
    return def.slice().sort((a, b) => r(a) - r(b)); };
  const CST = { open: '✅ مفتوحة', beta: '🧪 تجريبية', hidden: '🚫 مخفية' };
  const RST = { use: '✅ تستخدم', show: '🔒 تظهر مقفلة', none: '➖ لا تظهر' };
  const ICO = (t) => t.split(' ')[0];   // الأيقونة فقط داخل الجدول (والنص الكامل في التلميح)
  async function settingsTab(pane) {
    const rows = await run(sb.from('app_settings').select('*'));
    const get = (k) => rows.find((r) => r.key === k)?.value;
    pane.innerHTML = `<div class="notice info" style="margin:0 0 14px">⏰ توقيت الحصص و🗓️ جداول حصص المشرفين (رفع الجدول، مادة كل معلم، مرحلة كل صف) في <a href="settings.html"><b>إعدادات المدرسة</b></a> — يديرها أيضًا الإدارة العليا ومديرو المراحل.</div>
      <div class="card glass">
      <div class="form-grid">
        <label class="f">اسم المدرسة<input id="sn" value="${esc(get('school_name') || '')}"></label>
        <label class="f">نطاقات البريد المسموحة (افصل بفاصلة)<input id="dm" dir="ltr" value="${esc((get('allowed_domains') || []).join(', '))}"></label>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px"><b>🎓 الأسماء على شهادات التدريب</b>
        <div class="form-grid" style="margin-top:8px">
          <label class="f">المسمّى الأول<input id="ceT" value="${esc(get('cert_edu_title') || 'مدير التعليم')}"></label><label class="f">الاسم<input id="ceN" value="${esc(get('cert_edu_name') || '')}"></label>
          <label class="f">المسمّى الثاني<input id="cxT" value="${esc(get('cert_exec_title') || 'المدير التنفيذي')}"></label><label class="f">الاسم<input id="cxN" value="${esc(get('cert_exec_name') || '')}"></label></div>
        <p class="hint" style="margin:6px 0 0">تظهر على كل شهادة تدريب يصدرها المشرف من «الخدمات ← التدريب»، ومعها اسم مقدّم الدورة من بيانات التدريب.</p>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px">
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;font-size:1.02rem">
          <input type="checkbox" id="allLogin" ${get('all_login_enabled') !== false ? 'checked' : ''}> السماح لكل المستخدمين بالدخول إلى المنصة</label>
        <p class="hint" style="margin:6px 0 0">عند الإيقاف تُغلق المنصة أمام الجميع (وضع الصيانة) — الموظفون والمعلمون والطلاب وأولياء الأمور — ويرون رسالة «المنصة مغلقة مؤقتًا». <b>مدير النظام يدخل دائمًا.</b></p>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px">
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;font-size:1.02rem">
          <input type="checkbox" id="tchLogin" ${get('teacher_login_enabled') !== false ? 'checked' : ''}> السماح للمعلمين بالدخول إلى المنصة</label>
        <p class="hint" style="margin:6px 0 0">عند الإيقاف يُمنع كل حساب دوره «معلم» من الدخول ويرى رسالة «دخول المعلمين غير متاح حاليًا». المشرفون والإدارة والموظفون غير متأثرين.</p>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px"><b>🗂️ التحكم في بطاقات المنصة — الحالة والظهور وصلاحية الاستخدام</b>
        <p class="hint" style="margin:6px 0 10px">لكل بطاقة: <b>الحالة</b> (✅ مفتوحة · 🧪 تجريبية بشارة «تجريبي» · 🚫 مخفية عن الجميع وتُغلق صفحتها) — ولكل دور: <b>✅ تستخدم</b> (تفتح له) أو <b>🔒 تظهر مقفلة</b> (يراها ويظهر له «ليس لديك صلاحيات الدخول») أو <b>— لا تظهر</b>. مدير النظام يرى ويفتح كل البطاقات دائمًا. صف «الافتراضي للظهور» يحدد من يرى البطاقات المقفلة ما لم تخصّص البطاقة. ⚠️ يمكنك دائمًا <b>تضييق</b> الاستخدام أو الإخفاء؛ أما فتح بطاقة لدور خارج أدوارها الأصلية فيعمل للوحدات التجريبية، بينما بعض الوحدات بياناتها محمية أصلًا لأدوار محددة (مثل الإشراف أو شؤون الموظفين) فتبقى الصفحة فارغة أو مغلقة لذلك الدور.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px"><input id="cardQ" placeholder="🔎 ابحث عن بطاقة…" style="max-width:240px">
          <select id="cardSt" style="max-width:170px"><option value="">كل الحالات</option>${Object.entries(CST).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <p class="hint" style="margin:0 0 6px"><b>الرموز:</b> الحالة ✅ مفتوحة · 🧪 تجريبية · 🚫 مخفية — الأدوار ✅ تستخدم · 🔒 تظهر مقفلة · ➖ لا تظهر (مرّر الفأرة على أي خانة لترى معناها).</p>
        <div class="table-wrap no-tools" style="max-height:70vh;overflow-y:auto;overflow-x:hidden"><table id="betaTbl"><thead><tr><th title="الترتيب في الصفحة الرئيسية">#</th><th>البطاقة</th><th title="حالة البطاقة">الحالة</th>${BETA_ROLES.map((r) => `<th style="text-align:center">${esc(ROLE_LABELS[r] || r)}<div><button class="colr" type="button" data-colr="${r}" title="تطبيق اختيار واحد على كل البطاقات الظاهرة لهذا الدور">⋯</button></div></th>`).join('')}</tr></thead>
        <tbody><tr style="background:#F5F8F6"><td colspan="3"><b>🔒 الافتراضي للظهور</b><div class="hint" style="font-weight:400">يرى الدور البطاقات غير المسموح له بها (مقفلة) للتعريف بالمنصة</div></td>${BETA_ROLES.map((r) => `<td style="text-align:center"><input type="checkbox" data-lk="${r}" ${lockedRoles(get('beta_access')).includes(r) ? 'checked' : ''}></td>`).join('')}</tr>
        ${sortedMods(get('beta_access')).map((m) => { const sv = get('beta_access'), cd = cardOf(m, sv), use = betaRoles(m, sv), lk = lockedRoles(sv);
          const show = Array.isArray(cd.show) ? cd.show : (m.url ? lk : []);
          return `<tr data-row="${m.key}" data-q="${esc(m.title + ' ' + (m.desc || ''))}" draggable="true"><td class="ord"><span class="ordn"></span><span class="mv"><button type="button" data-mv="top" title="إلى الأول">⤒</button><button type="button" data-mv="up" title="أعلى">▲</button><button type="button" data-mv="down" title="أسفل">▼</button></span><span title="اسحب لتغيير الترتيب" style="cursor:grab">⠿</span></td><td class="nm">${m.icon} <b>${esc(m.title)}</b>${m.url ? '' : ' <span class="hint">(قريبًا)</span>'}</td>
          <td style="text-align:center"><select class="ic-sel" data-cs="${m.key}" title="حالة البطاقة">${Object.entries(CST).map(([k, v]) => `<option value="${k}" title="${v}" ${(cd.status || defStatus(m)) === k ? 'selected' : ''}>${ICO(v)}</option>`).join('')}</select></td>
          ${BETA_ROLES.map((r) => { const st = use.includes(r) ? 'use' : show.includes(r) ? 'show' : 'none';
            return `<td style="text-align:center"><select class="ic-sel" data-bm="${m.key}" data-br="${r}" data-st="${st}" title="${esc(ROLE_LABELS[r] || r)}: ${RST[st]}">${Object.entries(RST).map(([k, v]) => (k === 'show' && !m.url) ? '' : `<option value="${k}" title="${v}" ${st === k ? 'selected' : ''}>${ICO(v)}</option>`).join('')}</select></td>`; }).join('')}</tr>`; }).join('')}</tbody></table></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn sm" id="betaAll">↺ استعادة الإعدادات الافتراضية</button><button class="btn sm" id="betaOpen">✅ الكل يستخدم كل البطاقات</button><button class="btn sm" id="betaNone">إخفاء الكل عدا مدير النظام</button><button class="btn sm" id="ordReset">↺ الترتيب الافتراضي</button></div>
        <p class="hint" style="margin:6px 0 0">↕️ <b>الترتيب</b>: بأزرار ⤒ ▲ ▼ أو بسحب الصف ⠿ — يطبّق على الصفحة الرئيسية لكل المستخدمين بعد الحفظ (بطاقات «قريبًا» تبقى في قسمها آخر الصفحة).</p>
        <style>#betaTbl{width:100%;table-layout:auto;font-size:.9rem}#betaTbl th,#betaTbl td{padding:4px 3px}#betaTbl th{font-size:.78rem;line-height:1.25;white-space:normal}
          #betaTbl .ic-sel{appearance:none;-webkit-appearance:none;width:34px;height:30px;padding:0;text-align:center;text-align-last:center;font-size:1rem;border-radius:8px;border:1px solid #d6e3dc;cursor:pointer;background-image:none}
          #betaTbl td.nm{min-width:130px;font-size:.85rem}#betaTbl td.ord{white-space:nowrap;font-size:.8rem}#betaTbl .ordn{display:inline-block;min-width:16px;color:#888}
          #betaTbl .mv button,#betaTbl .colr{border:0;background:none;cursor:pointer;padding:0 2px;font-size:.8rem;color:#1F7A4D}#betaTbl .colr{font-size:1rem;line-height:1}
          #betaTbl select[data-st="use"]{background:#E7F6EC}#betaTbl select[data-st="show"]{background:#FFF6E0}#betaTbl select[data-st="none"]{background:#F1F1F1;color:#777}#betaTbl tr.cs-hidden td{opacity:.55}#betaTbl tr.cs-beta td:first-child{color:#7c3aed}</style>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px">
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;font-size:1.02rem">
          <input type="checkbox" id="stLogin" ${get('student_login_enabled') === true ? 'checked' : ''}> السماح للطلاب بالدخول إلى المنصة</label>
        <p class="hint" style="margin:6px 0 0">بريد كل طالب = رقم هويته@${esc(LMS.C.SCHOOL_DOMAIN)} ويُضبط تلقائيًا من نظام التسجيل. عند الإيقاف تبقى بيانات الطلاب محفوظة، لكن أي طالب يحاول الدخول يرى رسالة «دخول الطلاب غير متاح حاليًا». المعلمون والإدارة غير متأثرين.</p>
      </div>
      <div class="card glass" style="margin:16px 0;padding:14px">
        <label style="display:flex;gap:10px;align-items:center;font-weight:800;font-size:1.02rem">
          <input type="checkbox" id="paLogin" ${get('parent_login_enabled') === true ? 'checked' : ''}> (الطريقة القديمة) دخول ولي الأمر ببريده الشخصي</label>
        <p class="hint" style="margin:6px 0 8px">✅ <b>الطريقة المعتمدة الآن:</b> ولي الأمر يدخل من <b>حساب ابنه المدرسي</b> برمزه السري — لا تحتاج هذا الخيار. جوالات أولياء الأمور ورموز التفعيل من صفحة <a href="guardians.html">👪 أولياء الأمور</a>. اترك هذا الخيار مقفولًا (يحتاج تحويل إعداد Google إلى خارجي).</p>
        <button class="btn sm" id="paSync">👪 إنشاء حسابات أولياء الأمور وربطهم بأبنائهم</button> <span class="hint" id="paInfo"></span>
      </div>
      <p class="hint">⚠️ أي حساب خارج هذه النطاقات لن يرى أي بيانات حتى لو كان مسجّلًا. لا تحذف نطاق المدرسة وإلا ستفقد الدخول أنت أيضًا.</p>
      <button class="btn primary" id="sv">حفظ الإعدادات</button></div>`;
    const setCell = (c, st) => { if (st === 'show' && !c.querySelector('option[value="show"]')) st = 'none'; c.value = st; c.dataset.st = st; c.title = `${ROLE_LABELS[c.dataset.br] || c.dataset.br}: ${RST[st]}`; };
    const paintRow = (tr) => { const st = $('[data-cs]', tr).value; tr.classList.toggle('cs-hidden', st === 'hidden'); tr.classList.toggle('cs-beta', st === 'beta'); };
    $$('#betaTbl tr[data-row]', pane).forEach(paintRow);
    const tbody = $('#betaTbl tbody', pane);
    const renum = () => $$('#betaTbl tr[data-row]', pane).forEach((tr, i) => { $('.ordn', tr).textContent = i + 1; });
    renum();
    tbody.addEventListener('click', (e) => { const b = e.target.closest('[data-mv]'); if (!b) return; const tr = b.closest('tr');
      if (b.dataset.mv === 'top') tbody.insertBefore(tr, tbody.querySelector('tr[data-row]'));
      else if (b.dataset.mv === 'up') { const p = tr.previousElementSibling; if (p && p.dataset.row) tbody.insertBefore(tr, p); }
      else { const n = tr.nextElementSibling; if (n) tbody.insertBefore(n, tr); }
      renum(); tr.style.outline = '2px solid #1F7A4D'; setTimeout(() => { tr.style.outline = ''; }, 700); });
    let drag = null;
    tbody.addEventListener('dragstart', (e) => { drag = e.target.closest && e.target.closest('tr[data-row]'); if (drag) { e.dataTransfer.effectAllowed = 'move'; drag.style.opacity = '.4'; } });
    tbody.addEventListener('dragend', () => { if (drag) drag.style.opacity = ''; drag = null; renum(); });
    tbody.addEventListener('dragover', (e) => { const tr = e.target.closest('tr[data-row]'); if (!drag || !tr || tr === drag) return; e.preventDefault();
      const r = tr.getBoundingClientRect(); tbody.insertBefore(drag, e.clientY > r.top + r.height / 2 ? tr.nextSibling : tr); });
    $('#ordReset', pane).onclick = () => { sortedMods(null).forEach((m) => tbody.appendChild($(`tr[data-row="${m.key}"]`, pane))); renum(); };
    $('#betaTbl', pane).addEventListener('change', (e) => { const t = e.target;
      if (t.dataset.bm) { t.dataset.st = t.value; t.title = `${ROLE_LABELS[t.dataset.br] || t.dataset.br}: ${RST[t.value]}`; }
      if (t.dataset.cs) paintRow(t.closest('tr'));
      if (t.dataset.lk) { const r = t.dataset.lk; $$(`[data-br="${r}"]`, pane).forEach((c) => { if (c.value !== 'use') setCell(c, t.checked ? 'show' : 'none'); }); } });
    const filt = () => { const q = val(pane, '#cardQ').trim(), st = $('#cardSt', pane).value;
      $$('#betaTbl tr[data-row]', pane).forEach((tr) => { tr.style.display = ((!q || tr.dataset.q.includes(q)) && (!st || $('[data-cs]', tr).value === st)) ? '' : 'none'; }); };
    $('#cardQ', pane).oninput = filt; $('#cardSt', pane).onchange = filt;
    const shownRows = () => $$('#betaTbl tr[data-row]', pane).filter((tr) => tr.style.display !== 'none');
    $$('[data-colr]', pane).forEach((b) => { b.onclick = async () => { const r = b.dataset.colr;
      const v = await modal({ title: `تطبيق على «${ROLE_LABELS[r] || r}» لكل البطاقات الظاهرة (${shownRows().length})`, body: '<p class="hint">يمكنك تصفية الجدول أولًا بالبحث أو الحالة.</p>',
        actions: [{ label: RST.use, value: 'use', cls: 'primary' }, { label: RST.show, value: 'show' }, { label: RST.none, value: 'none' }, { label: 'إلغاء', value: null }] });
      if (v) shownRows().forEach((tr) => setCell($(`[data-br="${r}"]`, tr), v)); }; });
    $('#betaAll', pane).onclick = () => { $$('[data-lk]', pane).forEach((c) => { c.checked = LOCK_DEFAULT.includes(c.dataset.lk); });
      ALL_MODS.forEach((m) => { const tr = $(`tr[data-row="${m.key}"]`, pane); $('[data-cs]', tr).value = defStatus(m); paintRow(tr);
        BETA_ROLES.forEach((r) => setCell($(`[data-br="${r}"]`, tr), defUse(m).includes(r) ? 'use' : (m.url && LOCK_DEFAULT.includes(r)) ? 'show' : 'none')); }); };
    $('#betaOpen', pane).onclick = () => shownRows().forEach((tr) => $$('[data-br]', tr).forEach((c) => setCell(c, 'use')));
    $('#betaNone', pane).onclick = () => shownRows().forEach((tr) => $$('[data-br]', tr).forEach((c) => setCell(c, 'none')));
    $('#paSync', pane).onclick = async () => {
      try {
        const pre = await run(sb.rpc('parents_sync', { p_apply: false }));
        if (!await confirmBox(`سيتم: ${pre.new_accounts} حساب ولي أمر جديد من ${pre.emails} بريد، وربط ${pre.students} طالب بأولياء أمورهم${pre.existing_staff ? ` (منهم ${pre.existing_staff} موظف ولي أمر يُربط بحسابه الحالي)` : ''}. الحسابات لا تعمل إلا بعد فتح البوابة.`, 'نعم، أنشئ واربط', false)) return;
        const r = await run(sb.rpc('parents_sync', { p_apply: true }));
        $('#paInfo', pane).textContent = `✓ ${r.created} حساب جديد — ${r.parents} ولي أمر مربوط بـ ${r.links} طالب`;
        toast('تم إنشاء الحسابات والربط ✓');
      } catch (er) { toast(errMsg(er), 'err'); }
    };
    $('#sv', pane).onclick = async () => {
      const domains = val(pane, '#dm').split(/[,،\s]+/).map((d) => d.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
      const myDomain = (ME.email || '').split('@')[1];
      if (!domains.includes(myDomain)) { toast(`يجب أن تبقى «${myDomain}» ضمن النطاقات وإلا ستفقد الدخول.`, 'warn'); return; }
      try {
        const stOn = $('#stLogin', pane).checked;
        if (stOn !== (get('student_login_enabled') === true)) {
          if (!await confirmBox(stOn ? 'فتح دخول الطلاب؟ سيتمكن كل طالب نشط من الدخول ببريده المدرسي فورًا.' : 'إيقاف دخول الطلاب؟ سيُمنع كل الطلاب من الدخول فورًا.', stOn ? 'نعم، افتح الدخول' : 'نعم، أوقف', !stOn)) return;
        }
        const allOn = $('#allLogin', pane).checked, tchOn = $('#tchLogin', pane).checked;
        if (allOn !== (get('all_login_enabled') !== false) && !await confirmBox(allOn ? 'فتح المنصة لكل المستخدمين؟' : 'إغلاق المنصة أمام كل المستخدمين (عدا مدير النظام)؟ سيُمنع الجميع من الدخول فورًا.', allOn ? 'نعم، افتح' : 'نعم، أغلق', !allOn)) return;
        if (tchOn !== (get('teacher_login_enabled') !== false) && !await confirmBox(tchOn ? 'فتح دخول المعلمين؟' : 'إيقاف دخول المعلمين؟ سيُمنع كل المعلمين من الدخول فورًا.', tchOn ? 'نعم، افتح' : 'نعم، أوقف', !tchOn)) return;
        const beta = { _cards: {} };
        const ord = $$('#betaTbl tr[data-row]', pane).map((tr) => tr.dataset.row);
        if (ord.join() !== sortedMods(null).map((m) => m.key).join()) beta._order = ord;   // يُحفظ فقط إن اختلف عن الافتراضي
        beta._locked = BETA_ROLES.filter((r) => $(`[data-lk="${r}"]`, pane).checked);
        ALL_MODS.forEach((m) => {
          const cell = (r) => $(`[data-bm="${m.key}"][data-br="${r}"]`, pane).value;
          const use = BETA_ROLES.filter((r) => cell(r) === 'use'), show = BETA_ROLES.filter((r) => cell(r) !== 'none');
          const status = $(`[data-cs="${m.key}"]`, pane).value;
          // تُحفظ فقط القيم المختلفة عن الافتراضي، فتبقى البطاقات غير المعدّلة تتبع إعدادات config.js
          if (defBeta(m) || !sameSet(use, defUse(m))) beta[m.key] = use;
          const defShow = m.url ? Array.from(new Set(use.concat(beta._locked))) : use;
          if (status !== defStatus(m) || !sameSet(show, defShow)) beta._cards[m.key] = { status, show };
        });
        const hid = ALL_MODS.filter((m) => beta._cards[m.key] && beta._cards[m.key].status === 'hidden' && cardOf(m, get('beta_access')).status !== 'hidden');
        if (hid.length && !await confirmBox(`إخفاء ${hid.length} بطاقة عن الجميع (${hid.map((m) => m.title).join('، ')})؟ ستُغلق صفحاتها لكل المستخدمين عدا مدير النظام.`, 'نعم، أخفِ', true)) return;
        const paOn = $('#paLogin', pane).checked;
        if (paOn !== (get('parent_login_enabled') === true)) {
          if (!await confirmBox(paOn ? 'فتح بوابة أولياء الأمور؟ سيتمكن كل ولي أمر مربوط بابنه من الدخول فورًا.' : 'إغلاق بوابة أولياء الأمور؟', paOn ? 'نعم، افتح' : 'نعم، أغلق', !paOn)) return;
        }
        await run(sb.from('app_settings').upsert([{ key: 'school_name', value: val(pane, '#sn') }, { key: 'allowed_domains', value: domains },
                                                  { key: 'student_login_enabled', value: stOn }, { key: 'parent_login_enabled', value: paOn },
                                                  { key: 'cert_edu_title', value: val(pane, '#ceT') }, { key: 'cert_edu_name', value: val(pane, '#ceN') },
                                                  { key: 'cert_exec_title', value: val(pane, '#cxT') }, { key: 'cert_exec_name', value: val(pane, '#cxN') },
                                                  { key: 'all_login_enabled', value: allOn }, { key: 'teacher_login_enabled', value: tchOn }]));
        await run(sb.rpc('card_control_save', { p: beta }));
        LMS.clearCache();
        rows.splice(0, rows.length, ...(await run(sb.from('app_settings').select('*'))));
        toast('تم حفظ الإعدادات');
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  // البدء بعد تعريف كل الثوابت (مثل IMPORTS) — فتح تبويب الاستيراد مباشرة من الرابط كان يسبق تعريفها
  try { await loadRefs(); } catch (e) { toast(errMsg(e), 'err'); }
  const startTab = location.hash.slice(1);
  openTab(Object.prototype.hasOwnProperty.call(tabs, startTab) ? startTab : 'overview');
})();
