/* =====================================================================
   الوضع التجريبي (ديمو): مدرسة افتراضية كاملة داخل المتصفح
   - لا يتصل بقاعدة البيانات الحقيقية إطلاقًا: كل البيانات وهمية ومولّدة هنا
   - يحاكي واجهة Supabase التي تستخدمها الصفحات (auth / from / rpc / storage)
   - أي تعديل يُحفظ في ذاكرة التبويب فقط ويُمسح عند الخروج من التجربة
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'lms_demo', DBKEY = 'lms_demo_db', VER = 3;
  const ROLE = (() => { try { return sessionStorage.getItem(KEY) || ''; } catch (_) { return ''; } })();
  if (!ROLE) return;

  // ---------- أدوات ----------
  let seed = 20261122;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const uid = (p, n) => `${p}-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const iso = (d) => new Date(d).toISOString();
  const daysAgo = (n, h = 9, m = 0) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, m, 0, 0); return d; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const norm = (s) => String(s || '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').toLowerCase();
  const GRADE_AR = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس'];
  const DOMAIN = (window.LMS_CONFIG && window.LMS_CONFIG.SCHOOL_DOMAIN) || 'school.edu.sa';

  // ---------- الهويات التجريبية (حساب لكل دور) ----------
  const IDS = {
    admin: uid('a0000001', 1), leadership: uid('a0000001', 2), principal: uid('a0000001', 3),
    supervisor: uid('a0000001', 4), teacher: uid('a0000001', 5)
  };
  const ROLES_INFO = {
    admin: 'مدير النظام', leadership: 'الإدارة العليا', principal: 'مدير مرحلة', supervisor: 'مشرف',
    teacher: 'معلم', student: 'طالب', parent: 'ولي أمر'
  };

  // ======================================================================
  //  توليد المدرسة الافتراضية
  // ======================================================================
  function build() {
    seed = 20261122;
    const now = new Date();
    const DB = {};
    DB.sections = [{ id: 1, code: 'boys', name_ar: 'بنين', name_en: 'Boys', sort: 1 }];
    DB.stages = [
      { id: 1, section_id: 1, code: 'boys-primary', name_ar: 'ابتدائي بنين', sort: 1 },
      { id: 2, section_id: 1, code: 'boys-intermediate', name_ar: 'متوسط بنين', sort: 2 },
      { id: 3, section_id: 1, code: 'boys-secondary', name_ar: 'ثانوي بنين', sort: 3 }];
    DB.grades = [];
    let gid = 0;
    [[1, 6], [2, 3], [3, 3]].forEach(([st, n]) => { for (let g = 1; g <= n; g++) DB.grades.push({ id: ++gid, stage_id: st, number: g, name_ar: 'الصف ' + GRADE_AR[g] }); });
    DB.subjects = ['لغتي', 'رياضيات', 'علوم', 'English', 'إسلامية', 'قرآن', 'اجتماعيات', 'حاسب', 'تربية بدنية', 'فنية', 'فيزياء', 'كيمياء', 'أحياء', 'تفكير ناقد']
      .map((n, i) => ({ id: i + 1, name_ar: n, name_en: null, code: null, active: true }));
    const SID = Object.fromEntries(DB.subjects.map((s) => [s.name_ar, s.id]));

    // ----- الموظفون -----
    const FN = ['أحمد', 'محمد', 'خالد', 'عبدالله', 'فهد', 'سعد', 'ماجد', 'سلطان', 'ناصر', 'عمر', 'يوسف', 'إبراهيم', 'علي', 'حسن', 'طارق', 'وليد', 'سامي', 'هشام', 'بندر', 'تركي', 'نواف', 'عادل', 'مازن', 'ياسر', 'رائد', 'مشعل', 'زياد', 'هاني', 'باسل', 'أنس'];
    const LN = ['الزهراني', 'القحطاني', 'الشهري', 'العتيبي', 'الدوسري', 'الغامدي', 'الحربي', 'المطيري', 'السبيعي', 'العنزي', 'الشمري', 'البقمي', 'الأحمدي', 'الجهني', 'المالكي', 'السلمي', 'العمري', 'الرشيدي', 'الحارثي', 'الثبيتي'];
    DB.profiles = [];
    const staff = (id, full_name, role, job_title, extra = {}) => { DB.profiles.push(Object.assign({ id, email: id.slice(0, 8) + '@' + DOMAIN, full_name, role, job_title, active: true, source: 'demo', created_at: iso(daysAgo(300)), updated_at: iso(daysAgo(30)) }, extra)); return id; };
    staff(IDS.admin, 'سالم العتيبي', 'admin', 'مدير النظام', { email: 'admin@' + DOMAIN });
    staff(IDS.leadership, 'د. خالد الشهري', 'leadership', 'المدير التنفيذي', { email: 'ceo@' + DOMAIN });
    staff(IDS.principal, 'عبدالله القحطاني', 'principal', 'مدير المرحلة المتوسطة', { email: 'mid.principal@' + DOMAIN });
    staff(IDS.supervisor, 'فهد الدوسري', 'supervisor', 'مشرف الرياضيات', { email: 'math.sup@' + DOMAIN });
    staff(IDS.teacher, 'أحمد الزهراني', 'teacher', 'معلم رياضيات', { email: 'a.zahrani@' + DOMAIN });
    const P1 = staff(uid('a0000001', 6), 'ماجد الغامدي', 'principal', 'مدير المرحلة الابتدائية');
    const P3 = staff(uid('a0000001', 7), 'سعد المطيري', 'principal', 'مدير المرحلة الثانوية');
    const SUP2 = staff(uid('a0000001', 8), 'ناصر السبيعي', 'supervisor', 'مشرف اللغة العربية');
    const SUP3 = staff(uid('a0000001', 9), 'علي الشمري', 'supervisor', 'مشرف العلوم');
    staff(uid('a0000001', 10), 'وليد الحارثي', 'staff', 'أخصائي تقنية المعلومات');
    staff(uid('a0000001', 11), 'سامي الجهني', 'staff', 'مسؤول الموارد البشرية');
    staff(uid('a0000001', 12), 'هشام العمري', 'staff', 'مرشد طلابي');
    // معلمون: كل مادة لها معلمون حسب المرحلة
    const TEACH = []; let tn = 100;
    const teacherFor = {};   // `${stage}|${subject}` → teacher id(s)
    const plan = {
      1: ['لغتي', 'لغتي', 'لغتي', 'لغتي', 'رياضيات', 'رياضيات', 'رياضيات', 'علوم', 'علوم', 'English', 'English', 'إسلامية', 'إسلامية', 'قرآن', 'قرآن', 'اجتماعيات', 'تربية بدنية', 'فنية', 'حاسب'],
      2: ['لغتي', 'لغتي', 'رياضيات', 'رياضيات', 'علوم', 'English', 'إسلامية', 'قرآن', 'اجتماعيات', 'تربية بدنية', 'حاسب', 'تفكير ناقد'],
      3: ['لغتي', 'رياضيات', 'رياضيات', 'فيزياء', 'كيمياء', 'أحياء', 'English', 'إسلامية', 'اجتماعيات', 'حاسب', 'تربية بدنية']
    };
    Object.entries(plan).forEach(([st, subs]) => subs.forEach((s) => {
      const k = st + '|' + s;
      let id;
      if (st === '2' && s === 'رياضيات' && !teacherFor[k]) id = IDS.teacher;   // معلم الديمو: رياضيات المتوسط
      else id = staff(uid('b0000001', ++tn), pick(FN) + ' ' + pick(LN), 'teacher', 'معلم ' + s);
      (teacherFor[k] = teacherFor[k] || []).push(id); TEACH.push(id);
    }));
    // الإشراف: من يشرف على من
    DB.supervision = [];
    DB.profiles.filter((p) => p.role === 'teacher').forEach((p) => {
      const s = p.job_title.replace('معلم ', '');
      DB.supervision.push({ teacher_id: p.id, supervisor_id: s === 'رياضيات' ? IDS.supervisor : ['لغتي', 'إسلامية', 'قرآن'].includes(s) ? SUP2 : SUP3 });
    });
    DB.staff_scopes = [
      { id: 1, profile_id: IDS.principal, section_id: null, stage_id: 2, grade_min: null, grade_max: null, subject_id: null, note: null },
      { id: 2, profile_id: P1, section_id: null, stage_id: 1, grade_min: null, grade_max: null, subject_id: null, note: null },
      { id: 3, profile_id: P3, section_id: null, stage_id: 3, grade_min: null, grade_max: null, subject_id: null, note: null },
      { id: 4, profile_id: IDS.supervisor, section_id: null, stage_id: null, grade_min: null, grade_max: null, subject_id: SID['رياضيات'], note: null }];
    const managerOf = (p) => {
      if (['admin', 'leadership'].includes(p.role)) return IDS.leadership;
      if (p.role === 'principal' || p.role === 'supervisor' || p.role === 'staff') return IDS.leadership;
      const t = TEACH.indexOf(p.id); if (t < 0) return IDS.leadership;
      const st = Object.keys(teacherFor).find((k) => teacherFor[k].includes(p.id)).split('|')[0];
      return { 1: P1, 2: IDS.principal, 3: P3 }[st];
    };
    DB.managers = Object.fromEntries(DB.profiles.map((p) => [p.id, managerOf(p)]));

    // ----- الفصول والطلاب -----
    DB.classes = []; DB.students = []; DB.student_private = []; let cid = 0, sn = 0;
    const SFN = ['يوسف', 'عبدالرحمن', 'محمد', 'فيصل', 'سلمان', 'راكان', 'مشاري', 'عبدالعزيز', 'نايف', 'حمد', 'تميم', 'ريان', 'إياد', 'عمر', 'معاذ', 'سيف', 'جود', 'بدر', 'مالك', 'هادي', 'لؤي', 'أوس', 'وسام', 'زيد'];
    DB.grades.forEach((g) => ['أ', 'ب'].forEach((sec) => {
      const c = { id: ++cid, grade_id: g.id, name: sec, homeroom_teacher_id: null, active: true, created_at: iso(daysAgo(200)) };
      DB.classes.push(c);
      const n = 9 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const id = uid('c0000001', ++sn);
        const father = pick(FN), fam = pick(LN), first = pick(SFN);
        DB.profiles.push({ id, email: String(1100000000 + sn * 7) + '@' + DOMAIN, full_name: `${first} ${father} ${fam}`, role: 'student', job_title: null, active: true, source: 'demo', created_at: iso(daysAgo(200)), updated_at: iso(daysAgo(30)) });
        DB.students.push({ profile_id: id, student_number: String(44000 + sn), class_id: c.id, guardian_name: `${father} ${fam}`, guardian_phone: '05' + String(50000000 + Math.floor(rnd() * 49999999)).slice(0, 8), notes: null, grade_id: g.id, track: 'arabic' });
      }
    }));
    // طالب الديمو: أول طالب في الصف الثاني المتوسط / أ — وأخوه في الصف الرابع الابتدائي
    const midG2 = DB.grades.find((g) => g.stage_id === 2 && g.number === 2), cls = DB.classes.find((c) => c.grade_id === midG2.id && c.name === 'أ');
    const stu = DB.students.find((s) => s.class_id === cls.id);
    const stuP = DB.profiles.find((p) => p.id === stu.profile_id); stuP.full_name = 'يوسف أحمد الحربي';
    const g4 = DB.grades.find((g) => g.stage_id === 1 && g.number === 4), cls4 = DB.classes.find((c) => c.grade_id === g4.id && c.name === 'ب');
    const bro = DB.students.find((s) => s.class_id === cls4.id); DB.profiles.find((p) => p.id === bro.profile_id).full_name = 'سلمان أحمد الحربي';
    stu.guardian_name = bro.guardian_name = 'أحمد الحربي'; stu.guardian_phone = bro.guardian_phone = '0550001234';
    IDS.student = stu.profile_id; IDS.sibling = bro.profile_id;
    DB.classes.find((c) => c.id === cls.id).homeroom_teacher_id = IDS.teacher;

    // ----- الإسناد + الجدول الأسبوعي -----
    const WEEK = { 1: { 'لغتي': 7, 'رياضيات': 5, 'علوم': 4, 'English': 4, 'إسلامية': 3, 'قرآن': 3, 'اجتماعيات': 2, 'تربية بدنية': 2, 'فنية': 1, 'حاسب': 1 },
      2: { 'لغتي': 5, 'رياضيات': 6, 'علوم': 4, 'English': 4, 'إسلامية': 3, 'قرآن': 3, 'اجتماعيات': 3, 'تربية بدنية': 2, 'حاسب': 2, 'تفكير ناقد': 1 },
      3: { 'لغتي': 4, 'رياضيات': 5, 'فيزياء': 3, 'كيمياء': 3, 'أحياء': 3, 'English': 4, 'إسلامية': 3, 'اجتماعيات': 2, 'حاسب': 2, 'تربية بدنية': 2 } };
    DB.teaching_assignments = []; DB.tt_slots = []; let taid = 0, slid = 0;
    const busy = new Set();
    DB.classes.forEach((c) => {
      const g = DB.grades.find((x) => x.id === c.grade_id), st = g.stage_id;
      const label = `${g.number}-${c.name}`;
      const cells = []; for (let d = 0; d < 5; d++) for (let p = 1; p <= 7; p++) cells.push([d, p]);
      cells.sort(() => rnd() - 0.5);
      Object.entries(WEEK[st]).forEach(([s, n]) => {
        const ts = teacherFor[st + '|' + s]; const t = ts[(c.id) % ts.length];
        DB.teaching_assignments.push({ id: ++taid, teacher_id: t, class_id: c.id, subject_id: SID[s], weekly_periods: n, source: 'timetable' });
        for (let k = 0; k < n; k++) {
          const i = cells.findIndex(([d, p]) => !busy.has(t + '|' + d + '|' + p)); if (i < 0) break;
          const [d, p] = cells.splice(i, 1)[0]; busy.add(t + '|' + d + '|' + p);
          DB.tt_slots.push({ id: ++slid, sheet_id: st, day: d, period: p, kind: 'class', teacher_id: t, class_id: c.id, subject_id: SID[s], cls: label, room: null, txt: null, track: 'arabic', grade_num: g.number, section: c.name });
        }
      });
    });

    // ----- السنة والفصل الدراسي -----
    DB.academic_years = [{ id: 1, name: '1448هـ', starts_on: '2026-08-23', ends_on: '2027-06-10', is_current: true }];
    DB.terms = [{ id: 1, year_id: 1, name: 'الفصل الدراسي الأول', starts_on: '2026-08-23', ends_on: '2027-01-07', is_current: true },
      { id: 2, year_id: 1, name: 'الفصل الدراسي الثاني', starts_on: '2027-01-17', ends_on: '2027-06-10', is_current: false }];
    DB.app_settings = [{ key: 'school_name', value: 'مدارس النموذج الأهلية (تجريبي)' }, { key: 'allowed_domains', value: [DOMAIN] },
      { key: 'student_login_enabled', value: true }, { key: 'parent_login_enabled', value: true }];
    DB.request_types = [
      { key: 'permission', name: 'استئذان', icon: '🚪', fields: [{ k: 'date', l: 'التاريخ', t: 'date', req: true }, { k: 'from', l: 'من الساعة', t: 'time', req: true }, { k: 'to', l: 'إلى الساعة', t: 'time', req: true }, { k: 'reason', l: 'السبب', t: 'textarea', req: true }], workflow: ['manager'], active: true, sort: 1 },
      { key: 'leave', name: 'إجازة', icon: '🏖️', fields: [{ k: 'kind', l: 'نوع الإجازة', t: 'select', req: true, opts: ['اضطرارية', 'مرضية', 'زواج', 'وفاة', 'أمومة / أبوة', 'أخرى'] }, { k: 'from', l: 'من تاريخ', t: 'date', req: true }, { k: 'to', l: 'إلى تاريخ', t: 'date', req: true }, { k: 'reason', l: 'التفاصيل', t: 'textarea' }], workflow: ['manager', 'leadership'], active: true, sort: 2 },
      { key: 'cover', name: 'تعويض / انتظار حصة', icon: '🔁', fields: [{ k: 'date', l: 'التاريخ', t: 'date', req: true }, { k: 'period', l: 'الحصة', t: 'number', req: true }, { k: 'class', l: 'الفصل', t: 'text', req: true }, { k: 'reason', l: 'السبب', t: 'textarea' }], workflow: ['manager'], active: true, sort: 3 },
      { key: 'maintenance', name: 'طلب صيانة', icon: '🛠️', fields: [{ k: 'place', l: 'الموقع / الفصل', t: 'text', req: true }, { k: 'issue', l: 'وصف العطل', t: 'textarea', req: true }, { k: 'urgency', l: 'الأولوية', t: 'select', opts: ['عادية', 'عاجلة'] }], workflow: ['leadership'], active: true, sort: 4 },
      { key: 'supplies', name: 'طلب مستلزمات / مواد', icon: '📦', fields: [{ k: 'items', l: 'المطلوب والكمية', t: 'textarea', req: true }, { k: 'purpose', l: 'الغرض', t: 'text' }], workflow: ['manager', 'leadership'], active: true, sort: 5 },
      { key: 'certificate', name: 'طلب تعريف بالراتب / خطاب', icon: '📄', fields: [{ k: 'to', l: 'الجهة الموجّه إليها', t: 'text', req: true }, { k: 'lang', l: 'اللغة', t: 'select', opts: ['عربي', 'إنجليزي'] }, { k: 'notes', l: 'ملاحظات', t: 'textarea' }], workflow: ['leadership'], active: true, sort: 6 },
      { key: 'other', name: 'طلب آخر', icon: '📝', fields: [{ k: 'details', l: 'تفاصيل الطلب', t: 'textarea', req: true }], workflow: ['manager'], active: true, sort: 9 }];
    DB.parent_links = [];

    // ----- الحضور: آخر 20 يومًا دراسيًا -----
    DB.att_sessions = []; DB.att_marks = []; let asid = 0;
    const schoolDays = []; for (let i = 1; schoolDays.length < 20 && i < 60; i++) { const d = daysAgo(i); if (d.getDay() <= 4) schoolDays.push(ymd(d)); }
    schoolDays.forEach((day) => DB.grades.forEach((g) => {
      const taker = pick(DB.profiles.filter((p) => p.role === 'teacher'));
      const s = { id: ++asid, day, grade_id: g.id, class_id: null, period: 0, taken_by: taker.id, taken_at: iso(new Date(day + 'T07:20:00')) };
      DB.att_sessions.push(s);
      DB.students.filter((x) => x.grade_id === g.id).forEach((x) => {
        const r = rnd(); const st = r < 0.035 ? 'absent' : r < 0.06 ? 'late' : r < 0.07 ? 'excused' : '';
        if (st) DB.att_marks.push({ session_id: s.id, student_id: x.profile_id, status: st, note: st === 'excused' ? 'عذر طبي' : st === 'late' ? 'وصل بعد الطابور' : '' });
      });
    }));
    // طالب الديمو: غياب يوم وتأخر يومين
    [[2, 'absent', ''], [5, 'late', 'زحمة الطريق'], [9, 'late', '']].forEach(([i, st, n]) => {
      const s = DB.att_sessions.find((x) => x.day === schoolDays[i] && x.grade_id === stu.grade_id);
      DB.att_marks = DB.att_marks.filter((m) => !(m.session_id === s.id && m.student_id === stu.profile_id));
      DB.att_marks.push({ session_id: s.id, student_id: stu.profile_id, status: st, note: n });
    });

    // ----- الرسائل والتعاميم -----
    DB.msgs = []; DB.rcpt = []; let mid = 0;
    const allStaff = DB.profiles.filter((p) => !['student', 'parent'].includes(p.role)).map((p) => p.id);
    const send = (from, to, subject, body, opt = {}) => {
      const m = Object.assign({ id: ++mid, kind: 'mail', from_id: from, subject, body, at: iso(opt.at || daysAgo(1)), ref: null, ack: false, reply_to: null, to_label: opt.to_label || null, attachments: [] }, opt); delete m.at_; m.at = iso(opt.at || daysAgo(1));
      DB.msgs.push(m);
      to.forEach((t) => DB.rcpt.push({ msg_id: m.id, to_id: t, read_at: opt.readAll ? m.at : (rnd() < 0.5 ? m.at : null), ack_at: opt.ack && opt.readAll ? m.at : null, archived: false }));
      return m;
    };
    send(IDS.leadership, allStaff, 'بدء الفصل الدراسي الأول — توجيهات عامة', 'الزملاء الكرام،\nنرحب بكم في بداية الفصل الدراسي الأول، ونأمل الالتزام بمواعيد الحصص والمناوبة وتسجيل الحضور يوميًا عبر المنصة.\nمع خالص التحية.', { kind: 'circular', ref: '1/1448', ack: true, at: daysAgo(40), to_label: 'كل الموظفين', readAll: true });
    send(IDS.leadership, allStaff, 'تعميم: الاختبارات القصيرة للفترة الأولى', 'يُعتمد أسبوع الاختبارات القصيرة للفترة الأولى من الأحد القادم. يرجى رفع الدرجات خلال 3 أيام من الاختبار.', { kind: 'circular', ref: '7/1448', ack: true, at: daysAgo(3), to_label: 'كل الموظفين' });
    send(IDS.principal, [IDS.teacher], 'موعد اجتماع قسم الرياضيات', 'أخي أحمد، نذكرك باجتماع القسم يوم الثلاثاء الحصة السابعة في غرفة الاجتماعات. نرجو إحضار خطة الوحدة الثالثة.', { at: daysAgo(1, 10, 15) });
    send(IDS.supervisor, [IDS.teacher], 'ملاحظات زيارة الحصة', 'أشكرك على حصة الكسور العشرية، كانت متميزة في التهيئة وإدارة الصف. أقترح زيادة الأسئلة المفتوحة في الختام.', { at: daysAgo(4, 12) });
    send(IDS.teacher, [IDS.principal], 'طلب تجهيز معمل الحاسب', 'نأمل حجز معمل الحاسب يوم الأربعاء للحصة الرابعة لتطبيق نشاط الهندسة التفاعلي.', { at: daysAgo(2, 11), readAll: true });
    send(IDS.admin, allStaff.filter((x) => x !== IDS.admin), 'تحديث المنصة: صفحة الأنصبة', 'أُضيفت صفحة نصاب الحصص، ويمكن لكل مشرف مراجعة أنصبة معلميه منها.', { at: daysAgo(6, 13) });
    send(IDS.teacher, [IDS.student], 'واجب الرياضيات', 'يوسف، تذكير بحل تمارين صفحة 54 قبل حصة الأحد.', { at: daysAgo(2, 13), readAll: false });

    // ----- المعاملات -----
    DB.requests = []; let rid = 0;
    const req = (by, type, data, status, at, steps) => DB.requests.push({ id: ++rid, type, requester_id: by, data, at: iso(at), status, step: steps.findIndex((s) => !s.decision) < 0 ? steps.length : steps.findIndex((s) => !s.decision) + 1, steps, attachments: [] });
    req(IDS.teacher, 'permission', { date: ymd(daysAgo(-1)), from: '11:00', to: '12:30', reason: 'مراجعة مستشفى' }, 'pending', daysAgo(0, 8), [{ step: 1, kind: 'manager', approver_id: IDS.principal }]);
    req(IDS.teacher, 'supplies', { items: 'أدوات هندسية للسبورة (فرجار + مسطرة) عدد 2', purpose: 'حصص الهندسة' }, 'approved', daysAgo(12), [{ step: 1, kind: 'manager', approver_id: IDS.principal, decision: 'approve', by_id: IDS.principal, at: iso(daysAgo(11)), note: '' }, { step: 2, kind: 'leadership', approver_id: IDS.leadership, decision: 'approve', by_id: IDS.leadership, at: iso(daysAgo(10)), note: 'تم التوجيه للمشتريات' }]);
    const t2 = DB.profiles.find((p) => p.job_title === 'معلم علوم' && teacherFor['2|علوم'].includes(p.id));
    req(t2.id, 'leave', { kind: 'اضطرارية', from: ymd(daysAgo(-3)), to: ymd(daysAgo(-3)), reason: 'ظرف عائلي' }, 'pending', daysAgo(0, 7, 40), [{ step: 1, kind: 'manager', approver_id: IDS.principal }, { step: 2, kind: 'leadership', approver_id: IDS.leadership }]);
    req(IDS.supervisor, 'maintenance', { place: 'فصل 2/ب', issue: 'جهاز العرض لا يعمل', urgency: 'عاجلة' }, 'pending', daysAgo(1, 9), [{ step: 1, kind: 'leadership', approver_id: IDS.leadership }]);

    // ----- الشكاوى -----
    DB.complaints = [{ id: 1, by_id: IDS.student, category: 'الاختبارات', subject: 'تعارض موعد اختبارين في يوم واحد', details: 'لدينا اختبار رياضيات وعلوم في نفس اليوم الأربعاء، نرجو إعادة الجدولة.', student_id: IDS.student, teacher_id: null, status: 'in_progress', assignee_id: IDS.principal, at: iso(daysAgo(5)), updated: iso(daysAgo(4)), attachments: [],
      updates: [{ by_id: IDS.principal, at: iso(daysAgo(4)), status: 'in_progress', note: 'تمت مخاطبة معلمي المادتين، وسنفيدك بالموعد الجديد.', internal: false }] }];

    // ----- التدريب -----
    DB.training = [
      { id: 1, pid: IDS.teacher, title: 'استراتيجيات التعلم النشط في الرياضيات', provider: 'إدارة التدريب', mode: 'حضوري', start: ymd(daysAgo(60)), end: ymd(daysAgo(59)), hours: 10, certificate: null, self_rating: 5, self_note: 'طبقت استراتيجية فكّر-زاوج-شارك في وحدة الكسور.', impact_rating: 4, impact_note: 'ظهر أثرها في الزيارة الأخيرة', impact_by: IDS.supervisor },
      { id: 2, pid: IDS.teacher, title: 'التقويم البنائي', provider: 'منصة مدرستي', mode: 'عن بعد', start: ymd(daysAgo(20)), end: ymd(daysAgo(20)), hours: 3, certificate: null, self_rating: 4, self_note: '', impact_rating: null, impact_note: '', impact_by: null },
      { id: 3, pid: t2.id, title: 'تدريس العلوم بالاستقصاء', provider: 'مركز التدريب', mode: 'حضوري', start: ymd(daysAgo(30)), end: ymd(daysAgo(29)), hours: 8, certificate: null, self_rating: 4, self_note: '', impact_rating: null, impact_note: '', impact_by: null }];

    // ----- المناوبة -----
    DB.duty = []; let did = 0;
    const tchByStage = (st) => [...new Set(Object.keys(teacherFor).filter((k) => k.startsWith(st + '|')).flatMap((k) => teacherFor[k]))];
    [1, 2, 3].forEach((st) => { const T = tchByStage(st); for (let d = 0; d < 5; d++) ['الطابور الصباحي', 'الفسحة', 'الانصراف'].forEach((slot, i) =>
      DB.duty.push({ id: ++did, stage_id: st, dow: d, slot, place: ['الساحة الرئيسية', 'الممرات', 'البوابة'][i], staff_id: (st === 2 && slot === 'الفسحة' && d % 2 === 0) ? IDS.teacher : T[(d * 3 + i) % T.length], note: '' })); });

    // ----- سجل العمليات -----
    DB.audit_log = [{ id: 1, at: iso(daysAgo(1, 14)), actor: 'admin@' + DOMAIN, table_name: 'teaching_assignments', action: 'INSERT', row_pk: '17', old_data: null, new_data: null },
      { id: 2, at: iso(daysAgo(2, 9)), actor: 'admin@' + DOMAIN, table_name: 'classes', action: 'UPDATE', row_pk: '4', old_data: null, new_data: null }];
    DB.pp = { guardians: [{ id: 'g1', name: 'أحمد الحربي', phone: '0550001234', has_pin: true, locked: false, pin: '123456' }], children: [IDS.student, IDS.sibling] };
    DB.__v = VER; DB.__ids = IDS;
    return DB;
  }

  // ---------- تحميل/حفظ الحالة داخل التبويب ----------
  let DB;
  try { const s = JSON.parse(sessionStorage.getItem(DBKEY) || 'null'); if (s && s.__v === VER) DB = s; } catch (_) {}
  if (!DB) { DB = build(); save(); }
  Object.assign(IDS, DB.__ids);
  function save() { try { sessionStorage.setItem(DBKEY, JSON.stringify(DB)); } catch (_) {} }

  // من أنا في هذه التجربة
  const ME_ID = ROLE === 'student' || ROLE === 'parent' ? IDS.student : IDS[ROLE] || IDS.admin;
  const P = (id) => DB.profiles.find((p) => p.id === id);
  const ME = () => P(ME_ID);
  const MYROLE = () => ME().role;
  const isLeader = () => ['admin', 'leadership'].includes(MYROLE());
  const isManager = () => ['admin', 'leadership', 'principal'].includes(MYROLE());
  const isSuper = () => ['admin', 'leadership', 'principal', 'supervisor'].includes(MYROLE());

  // ======================================================================
  //  الجداول المشتقة (views)
  // ======================================================================
  const grade = (id) => DB.grades.find((g) => g.id === id);
  const stage = (id) => DB.stages.find((s) => s.id === id);
  const klass = (id) => DB.classes.find((c) => c.id === id);
  const subj = (id) => DB.subjects.find((s) => s.id === id);
  const classLabel = (c) => { const g = grade(c.grade_id), st = stage(g.stage_id); return `${g.name_ar} / ${c.name} — ${st.name_ar}`; };
  const VIEWS = {
    v_classes: () => DB.classes.map((c) => { const g = grade(c.grade_id), st = stage(g.stage_id);
      return { id: c.id, name: c.name, active: c.active, homeroom_teacher_id: c.homeroom_teacher_id, grade_id: g.id, grade_number: g.number, grade_name: g.name_ar,
        stage_id: st.id, stage_name: st.name_ar, stage_sort: st.sort, section_id: 1, section_name: 'بنين', label: classLabel(c), student_count: DB.students.filter((s) => s.class_id === c.id).length }; }),
    v_students: () => DB.students.map((s) => { const p = P(s.profile_id), c = klass(s.class_id), g = grade(s.grade_id), st = stage(g.stage_id);
      return Object.assign({}, s, { full_name: p.full_name, email: p.email, active: p.active, grade_number: g.number, grade_name: g.name_ar, stage_id: st.id, stage_name: st.name_ar, stage_sort: st.sort,
        section_name: 'بنين', class_name: c ? c.name : null, label: c ? classLabel(c) : g.name_ar }); }),
    v_class_teaching: () => DB.classes.map((c) => { const T = DB.teaching_assignments.filter((t) => t.class_id === c.id);
      return { class_id: c.id, teacher_count: new Set(T.map((t) => t.teacher_id)).size, subject_count: new Set(T.map((t) => t.subject_id)).size, weekly_periods: T.reduce((a, t) => a + t.weekly_periods, 0),
        teachers: T.map((t) => ({ teacher: (P(t.teacher_id) || {}).full_name, subject: (subj(t.subject_id) || {}).name_ar, periods: t.weekly_periods })) }; }),
    v_staff_teaching: () => { const by = {}; DB.teaching_assignments.forEach((t) => (by[t.teacher_id] = by[t.teacher_id] || []).push(t));
      return Object.entries(by).map(([tid, T]) => ({ teacher_id: tid,
        subjects: [...new Set(T.map((t) => subj(t.subject_id).name_ar))].join('، '),
        stages: [...new Set(T.map((t) => stage(grade(klass(t.class_id).grade_id).stage_id).name_ar))].join('، '),
        class_count: new Set(T.map((t) => t.class_id)).size,
        weekly_periods: new Set(DB.tt_slots.filter((s) => s.teacher_id === tid).map((s) => s.day + '|' + s.period)).size,
        classes: T.map((t) => { const c = klass(t.class_id); return { class_id: c.id, label: classLabel(c), stage: stage(grade(c.grade_id).stage_id).name_ar, subject: subj(t.subject_id).name_ar, periods: t.weekly_periods }; }),
        supervisors: DB.supervision.filter((x) => x.teacher_id === tid).map((x) => P(x.supervisor_id).full_name).join('، ') })); },
    v_timetable: () => DB.tt_slots.map((s) => Object.assign({ supervisor_id: null, sheet_idx: 0, sheet_label: 'الجدول' }, s))
  };
  const PK = { students: 'profile_id', student_private: 'profile_id', app_settings: 'key', request_types: 'key' };
  // ما يراه المستخدم (تقريب لسياسات RLS)
  function visible(table, rows) {
    const r = MYROLE(), me = ME_ID;
    if (table === 'students' || table === 'v_students') {
      if (isLeader()) return rows;
      if (r === 'principal') { const sc = DB.staff_scopes.find((x) => x.profile_id === me); return rows.filter((s) => !sc || !sc.stage_id || grade(s.grade_id).stage_id === sc.stage_id); }
      if (['teacher', 'supervisor', 'staff'].includes(r)) { const mine = new Set(DB.teaching_assignments.filter((t) => t.teacher_id === me || (r === 'supervisor' && DB.supervision.some((x) => x.supervisor_id === me && x.teacher_id === t.teacher_id))).map((t) => t.class_id));
        DB.classes.filter((c) => c.homeroom_teacher_id === me).forEach((c) => mine.add(c.id)); return rows.filter((s) => mine.has(s.class_id)); }
      return rows.filter((s) => s.profile_id === me);
    }
    if (table === 'v_classes' && r === 'principal') { const sc = DB.staff_scopes.find((x) => x.profile_id === me); return rows.filter((c) => !sc || !sc.stage_id || c.stage_id === sc.stage_id); }
    if (table === 'profiles' && ['student', 'parent'].includes(r)) return rows.filter((p) => p.id === me || p.role !== 'student');
    if (table === 'audit_log' && r !== 'admin') return [];
    return rows;
  }
  const writable = (table) => MYROLE() === 'admin' || (table === 'app_settings' && MYROLE() === 'admin');

  // ======================================================================
  //  محاكي الاستعلامات: sb.from(...)
  // ======================================================================
  function parseSelect(s) {
    const out = { cols: [], embeds: [] }; let i = 0, cur = '', depth = 0;
    const parts = []; for (; i < s.length; i++) { const ch = s[i]; if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { parts.push(cur); cur = ''; } else cur += ch; } if (cur) parts.push(cur);
    parts.map((x) => x.trim()).filter(Boolean).forEach((x) => { const m = /^(?:(\w+):)?(\w+)\((.*)\)$/.exec(x);
      if (m) out.embeds.push({ alias: m[1] || m[2], table: m[2], sel: m[3] }); else out.cols.push(x); });
    return out;
  }
  const single = (t) => ({ subjects: 'subject', stages: 'stage', students: 'student', profiles: 'profile', classes: 'class', grades: 'grade', sections: 'section' }[t] || t.replace(/s$/, ''));
  function project(table, row, sel) {
    const S = parseSelect(sel || '*'); let o = {};
    if (!S.cols.length || S.cols.includes('*')) o = clone(row); else S.cols.forEach((c) => { o[c] = row[c] === undefined ? null : clone(row[c]); });
    S.embeds.forEach((e) => {
      const fk = [e.alias + '_id', single(e.table) + '_id'].find((k) => k in row);
      const rows = tableRows(e.table);
      const pk = PK[e.table] || 'id';
      const hit = fk ? rows.find((r) => r[pk] === row[fk]) : null;
      o[e.alias] = hit ? project(e.table, hit, e.sel) : null;
    });
    return o;
  }
  function tableRows(t) {
    if (VIEWS[t]) return VIEWS[t]();
    if (!DB[t]) DB[t] = [];
    return DB[t];
  }
  function parseList(v) { return String(v).replace(/^\(|\)$/g, '').split(',').map((x) => x.trim().replace(/^"|"$/g, '')); }
  const same = (a, b) => a === b || String(a) === String(b);
  class Query {
    constructor(t) { this.t = t; this.f = []; this.ord = []; this.op = 'select'; this.sel = '*'; this.rng = null; this.one = 0; this.val = null; this.returning = false; }
    select(s, o) { if (this.op === 'select') this.sel = s || '*'; else { this.returning = true; this.sel = s || '*'; } this.countOpt = o; return this; }
    eq(c, v) { this.f.push((r) => same(r[c], v)); return this; }
    neq(c, v) { this.f.push((r) => !same(r[c], v)); return this; }
    gt(c, v) { this.f.push((r) => r[c] > v); return this; } gte(c, v) { this.f.push((r) => r[c] >= v); return this; }
    lt(c, v) { this.f.push((r) => r[c] < v); return this; } lte(c, v) { this.f.push((r) => r[c] <= v); return this; }
    in(c, v) { const s = (v || []).map(String); this.f.push((r) => s.includes(String(r[c]))); return this; }
    is(c, v) { this.f.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
    not(c, op, v) { if (op === 'in') { const s = parseList(v); this.f.push((r) => !s.includes(String(r[c]))); } else if (op === 'is') this.f.push((r) => r[c] != null); else this.f.push((r) => !same(r[c], v)); return this; }
    ilike(c, v) { const re = new RegExp('^' + String(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); this.f.push((r) => re.test(String(r[c] || ''))); return this; }
    like(c, v) { return this.ilike(c, v); }
    match(o) { Object.entries(o).forEach(([c, v]) => this.eq(c, v)); return this; }
    contains() { return this; } or() { return this; } filter() { return this; } textSearch() { return this; }
    order(c, o) { this.ord.push([c, !o || o.ascending !== false]); return this; }
    range(a, b) { this.rng = [a, b]; return this; }
    limit(n) { this.rng = [0, n - 1]; return this; }
    single() { this.one = 1; return this; } maybeSingle() { this.one = 2; return this; }
    insert(v) { this.op = 'insert'; this.val = v; return this; }
    upsert(v) { this.op = 'upsert'; this.val = v; return this; }
    update(v) { this.op = 'update'; this.val = v; return this; }
    delete() { this.op = 'delete'; return this; }
    then(res, rej) { return Promise.resolve().then(() => this.run()).then(res, rej); }
    catch(f) { return this.then(null, f); }
    run() {
      const t = this.t, err = (m) => ({ data: null, error: { message: m }, count: null });
      if (this.op !== 'select') {
        if (VIEWS[t]) return err('غير متاح');
        if (!writable(t)) return err('ليست لديك صلاحية لهذه العملية (الوضع التجريبي)');
        const rows = tableRows(t), pk = PK[t] || 'id';
        let out = [];
        if (this.op === 'insert' || this.op === 'upsert') {
          const list = Array.isArray(this.val) ? this.val : [this.val];
          list.forEach((v) => { const ex = this.op === 'upsert' ? rows.find((r) => same(r[pk], v[pk])) : null;
            if (ex) { Object.assign(ex, clone(v)); out.push(ex); return; }
            const row = clone(v); if (row[pk] == null) row[pk] = pk === 'id' && t !== 'profiles' ? Math.max(0, ...rows.map((r) => Number(r.id) || 0)) + 1 : uid('d0000001', Date.now() % 1e9 + rows.length);
            if (t === 'profiles') Object.assign(row, { active: row.active !== false, created_at: iso(new Date()), source: 'demo' });
            rows.push(row); out.push(row); });
        } else if (this.op === 'update') { rows.filter((r) => this.f.every((f) => f(r))).forEach((r) => { Object.assign(r, clone(this.val)); out.push(r); }); }
        else if (this.op === 'delete') { const keep = []; rows.forEach((r) => (this.f.every((f) => f(r)) ? out.push(r) : keep.push(r))); DB[t] = keep;
          if (t === 'profiles') out.forEach((p) => { DB.students = DB.students.filter((s) => s.profile_id !== p.id); });
          if (t === 'classes') out.forEach((c) => { DB.teaching_assignments = DB.teaching_assignments.filter((x) => x.class_id !== c.id); }); }
        save();
        const data = this.returning ? out.map((r) => project(t, r, this.sel)) : null;
        return { data: this.one && data ? data[0] || null : data, error: null, count: out.length };
      }
      let rows = visible(t, tableRows(t)).filter((r) => this.f.every((f) => f(r)));
      if (this.ord.length) rows = rows.slice().sort((a, b) => { for (const [c, asc] of this.ord) { const x = a[c], y = b[c]; if (x == y) continue;
        const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'ar'); return asc ? r : -r; } return 0; });
      const count = rows.length;
      if (this.rng) rows = rows.slice(this.rng[0], this.rng[1] + 1);
      const data = rows.map((r) => project(t, r, this.sel));
      if (this.one) { if (!data.length && this.one === 1) return err('لا توجد بيانات'); return { data: data[0] || null, error: null, count }; }
      return { data, error: null, count };
    }
  }

  // ======================================================================
  //  الدوال (RPC)
  // ======================================================================
  const today = () => ymd(new Date());
  const dow = () => { const d = new Date().getDay(); return d <= 4 ? d : -1; };
  const name = (id) => (P(id) || {}).full_name || '';
  const NA = 'هذه العملية غير متاحة في الوضع التجريبي';
  const teacherIds = () => DB.profiles.filter((p) => p.role === 'teacher').map((p) => p.id);
  function myGrades() {
    const r = MYROLE(), me = ME_ID;
    if (isLeader()) return DB.grades.map((g) => g.id);
    if (r === 'principal') { const sc = DB.staff_scopes.find((x) => x.profile_id === me); return DB.grades.filter((g) => !sc || g.stage_id === sc.stage_id).map((g) => g.id); }
    const cls = new Set(DB.teaching_assignments.filter((t) => t.teacher_id === me || (r === 'supervisor' && DB.supervision.some((x) => x.supervisor_id === me && x.teacher_id === t.teacher_id))).map((t) => t.class_id));
    return [...new Set(DB.classes.filter((c) => cls.has(c.id)).map((c) => c.grade_id))];
  }
  function childData(id) {
    const s = DB.students.find((x) => x.profile_id === id); if (!s) throw new Error('غير موجود');
    const g = grade(s.grade_id), c = klass(s.class_id);
    const recent = DB.att_marks.filter((m) => m.student_id === id).map((m) => { const se = DB.att_sessions.find((x) => x.id === m.session_id); return { d: se.day, p: se.period, s: m.status, n: m.note }; }).sort((a, b) => b.d.localeCompare(a.d));
    return { id, name: name(id), number: s.student_number, grade: g.name_ar + ' — ' + stage(g.stage_id).name_ar, class: c ? c.name : null,
      teachers: DB.teaching_assignments.filter((t) => t.class_id === s.class_id).map((t) => ({ id: t.teacher_id, name: name(t.teacher_id), subject: subj(t.subject_id).name_ar })),
      attendance: { days_taken: new Set(DB.att_sessions.filter((x) => x.grade_id === s.grade_id && x.period === 0).map((x) => x.day)).size,
        absent: recent.filter((r) => r.s === 'absent' && !r.p).length, late: recent.filter((r) => r.s === 'late' && !r.p).length, excused: recent.filter((r) => r.s === 'excused' && !r.p).length, recent } };
  }
  function msgItem(m, box) {
    const R = DB.rcpt.filter((x) => x.msg_id === m.id), mine = R.find((x) => x.to_id === ME_ID);
    const o = { id: m.id, kind: m.kind, subject: m.subject, snip: m.body.slice(0, 90), at: m.at, ref: m.ref, ack: m.ack, att: (m.attachments || []).length, from: name(m.from_id), from_title: (P(m.from_id) || {}).job_title };
    if (box === 'sent') Object.assign(o, { to: m.to_label || R.map((x) => name(x.to_id)).slice(0, 3).join('، ') + (R.length > 3 ? ` و${R.length - 3} آخرين` : ''), n: R.length, read: R.filter((x) => x.read_at).length, acked: R.filter((x) => x.ack_at).length });
    else Object.assign(o, { read: !!(mine && mine.read_at), acked: !!(mine && mine.ack_at) });
    return o;
  }
  function reqItem(r) {
    const t = DB.request_types.find((x) => x.key === r.type), u = P(r.requester_id);
    const cur = r.steps.find((s) => s.step === r.step);
    return { id: r.id, type: r.type, type_name: t.name, icon: t.icon, fields: t.fields, data: r.data, at: r.at, status: r.status, step: r.step, attachments: r.attachments,
      requester: u.full_name, requester_title: u.job_title, mine: r.requester_id === ME_ID,
      can_act: r.status === 'pending' && !!cur && (cur.approver_id === ME_ID || MYROLE() === 'admin'),
      steps: r.steps.map((s) => ({ step: s.step, kind: s.kind, approver: name(s.approver_id), decision: s.decision || null, by: s.by_id ? name(s.by_id) : null, at: s.at || null, note: s.note || '' })) };
  }
  function trnItem(t) { return Object.assign({}, t, { name: name(t.pid), mine: t.pid === ME_ID, impact_by: t.impact_by ? name(t.impact_by) : null }); }

  const RPC = {
    my_context() {
      const p = ME(); const s = DB.students.find((x) => x.profile_id === p.id);
      return { registered: true, profile: clone(p), school_name: DB.app_settings.find((x) => x.key === 'school_name').value,
        scopes: DB.staff_scopes.filter((x) => x.profile_id === p.id).map((x) => ({ section: null, stage: x.stage_id ? stage(x.stage_id).name_ar : null, subject: x.subject_id ? subj(x.subject_id).name_ar : null, grade_min: null, grade_max: null, note: null })),
        student: s ? { id: s.profile_id, student_number: s.student_number, class_id: s.class_id, grade_id: s.grade_id, class_label: classLabel(klass(s.class_id)), section: 'بنين' } : null,
        children: null, term: { year: '1448هـ', term: 'الفصل الدراسي الأول' }, demo: true };
    },
    msg_counts() {
      const R = DB.rcpt.filter((x) => x.to_id === ME_ID && !x.archived);
      return { unread: R.filter((x) => !x.read_at).length,
        pending_ack: R.filter((x) => { const m = DB.msgs.find((y) => y.id === x.msg_id); return m.ack && !x.ack_at; }).map((x) => { const m = DB.msgs.find((y) => y.id === x.msg_id); return { id: m.id, subject: m.subject, ref: m.ref, from: name(m.from_id) }; }) };
    },
    msg_groups() {
      const staffR = !['student', 'parent'].includes(MYROLE());
      return { roles: [{ k: 'teacher', l: 'المعلمون' }, { k: 'supervisor', l: 'المشرفون' }, { k: 'principal', l: 'مدراء المراحل' }, { k: 'leadership', l: 'الإدارة العليا' }, { k: 'staff', l: 'الموظفون الإداريون' }],
        stages: DB.stages.map((s) => ({ id: s.id, name: s.name_ar })), can_circular: isManager(), can_broadcast: isSuper(),
        parent_grades: staffR ? DB.grades.map((g) => ({ id: g.id, name: g.name_ar + ' — ' + stage(g.stage_id).name_ar, parents: DB.students.filter((s) => s.grade_id === g.id).length })) : [] };
    },
    msg_list({ p_box, p_kind }) {
      let L;
      if (p_box === 'sent') L = DB.msgs.filter((m) => m.from_id === ME_ID);
      else { const R = DB.rcpt.filter((x) => x.to_id === ME_ID && (p_box === 'archive' ? x.archived : !x.archived)); L = R.map((x) => DB.msgs.find((m) => m.id === x.msg_id)); }
      if (p_kind) L = L.filter((m) => m.kind === p_kind);
      return L.sort((a, b) => b.at.localeCompare(a.at)).map((m) => msgItem(m, p_box));
    },
    msg_get({ p_id }) {
      const m = DB.msgs.find((x) => x.id === p_id); if (!m) throw new Error('غير موجود');
      const R = DB.rcpt.filter((x) => x.msg_id === m.id), mine = R.find((x) => x.to_id === ME_ID), own = m.from_id === ME_ID;
      if (!mine && !own) throw new Error('غير مصرح');
      if (mine && !mine.read_at) { mine.read_at = iso(new Date()); save(); }
      const par = m.reply_to ? DB.msgs.find((x) => x.id === m.reply_to) : null;
      return { id: m.id, kind: m.kind, subject: m.subject, body: m.body, at: m.at, ref: m.ref, ack: m.ack, attachments: m.attachments || [],
        from: name(m.from_id), from_id: m.from_id, from_title: (P(m.from_id) || {}).job_title, to: m.to_label || R.map((x) => name(x.to_id)).slice(0, 5).join('، '),
        mine: own, acked: mine && mine.ack_at, archived: !!(mine && mine.archived), can_reply: !own && m.kind === 'mail',
        parent: par ? { subject: par.subject, from: name(par.from_id), body: par.body } : null,
        recipients: own ? R.map((x) => ({ name: name(x.to_id), role: (P(x.to_id) || {}).role, read: x.read_at, ack: x.ack_at })) : null };
    },
    msg_ack({ p_id }) { const r = DB.rcpt.find((x) => x.msg_id === p_id && x.to_id === ME_ID); if (r) { r.ack_at = iso(new Date()); r.read_at = r.read_at || r.ack_at; save(); } return true; },
    msg_archive({ p_id, p_on }) { const r = DB.rcpt.find((x) => x.msg_id === p_id && x.to_id === ME_ID); if (r) { r.archived = !!p_on; save(); } return true; },
    msg_contacts({ p_q }) {
      const q = norm(p_q || ''); const r = MYROLE();
      let L = DB.profiles.filter((p) => p.id !== ME_ID && p.active && p.role !== 'parent' && (p.role !== 'student' || !['student'].includes(r)));
      if (['student', 'parent'].includes(r)) { const s = DB.students.find((x) => x.profile_id === ME_ID); const T = new Set(DB.teaching_assignments.filter((t) => t.class_id === s.class_id).map((t) => t.teacher_id));
        L = L.filter((p) => T.has(p.id) || ['principal', 'leadership'].includes(p.role)); }
      else L = L.filter((p) => p.role !== 'student' || visible('students', DB.students).some((s) => s.profile_id === p.id));
      return L.filter((p) => !q || norm(p.full_name + ' ' + (p.job_title || '')).includes(q)).slice(0, 30).map((p) => ({ id: p.id, name: p.full_name, role: p.role, title: p.job_title }));
    },
    msg_send({ p }) {
      const to = new Set(p.to.people || []);
      if (p.to.all_staff) DB.profiles.filter((x) => !['student', 'parent'].includes(x.role)).forEach((x) => to.add(x.id));
      (p.to.roles || []).forEach((r) => DB.profiles.filter((x) => x.role === r).forEach((x) => to.add(x.id)));
      (p.to.stages || []).forEach((st) => { const T = new Set(DB.teaching_assignments.filter((t) => grade(klass(t.class_id).grade_id).stage_id === st).map((t) => t.teacher_id)); T.forEach((x) => to.add(x)); });
      (p.to.parents_grades || []).forEach((g) => DB.students.filter((s) => s.grade_id === g).forEach((s) => to.add(s.profile_id)));
      to.delete(ME_ID);
      const id = Math.max(0, ...DB.msgs.map((m) => m.id)) + 1;
      DB.msgs.push({ id, kind: p.kind, from_id: ME_ID, subject: p.subject, body: p.body || '', at: iso(new Date()), ref: p.ref_no || null, ack: !!p.requires_ack, reply_to: p.reply_to || null, to_label: null, attachments: [] });
      to.forEach((t) => DB.rcpt.push({ msg_id: id, to_id: t, read_at: null, ack_at: null, archived: false }));
      save(); return { id, recipients: to.size };
    },
    msg_circulars_board() {
      return DB.msgs.filter((m) => m.kind === 'circular').sort((a, b) => b.at.localeCompare(a.at)).map((m) => { const R = DB.rcpt.filter((x) => x.msg_id === m.id);
        return { id: m.id, subject: m.subject, to: m.to_label || '', ref: m.ref, at: m.at, from: name(m.from_id), n: R.length, read: R.filter((x) => x.read_at).length, acked: R.filter((x) => x.ack_at).length }; });
    },
    school_stats() {
      const S = DB.students; const staffN = DB.profiles.filter((p) => !['student', 'parent'].includes(p.role)).length;
      return { students: S.length, teachers: teacherIds().length, staff: staffN, classes: DB.classes.length, subjects: DB.subjects.length, assignments: DB.teaching_assignments.length,
        by_stage: DB.stages.map((st) => ({ stage: st.name_ar, students: S.filter((s) => grade(s.grade_id).stage_id === st.id).length })),
        by_section: [{ section: 'بنين', classes: DB.classes.length, students: S.length }], no_class: 0, no_email: 0, students_no_email: 0 };
    },
    home_today({ p_day, p_att }) {
      const tt = p_day == null ? [] : DB.tt_slots.filter((s) => s.teacher_id === ME_ID && s.day === p_day).map((s) => ({ day: s.day, period: s.period, cls: s.cls, class_id: s.class_id, subject_id: s.subject_id, txt: null }));
      return { tt, inbox: RPC.req_list({ p_box: 'inbox' }).length, att: p_att ? RPC.att_today_mine() : null, duty: RPC.duty_today() };
    },
    duty_today() { const d = dow(); return DB.duty.filter((x) => x.staff_id === ME_ID && x.dow === d).map((x) => ({ slot: x.slot, place: x.place, note: x.note })); },
    duty_get({ p_stage }) { return { can_edit: isManager(), slots: DB.duty.filter((x) => !p_stage || x.stage_id === p_stage).map((x) => Object.assign({}, x, { staff: name(x.staff_id) })) }; },
    duty_save({ p_stage, p_rows }) { if (!isManager()) throw new Error('غير مصرح'); DB.duty = DB.duty.filter((x) => (x.stage_id || null) !== (p_stage || null));
      let id = Math.max(0, ...DB.duty.map((x) => x.id)); p_rows.forEach((r) => DB.duty.push(Object.assign({ id: ++id, stage_id: p_stage || null }, r))); save(); return true; },
    req_list({ p_box }) {
      let L = DB.requests;
      if (p_box === 'mine') L = L.filter((r) => r.requester_id === ME_ID);
      else if (p_box === 'inbox') L = L.filter((r) => r.status === 'pending' && r.steps.some((s) => s.step === r.step && (s.approver_id === ME_ID || (MYROLE() === 'admin' && false))));
      else if (p_box === 'done') L = L.filter((r) => r.steps.some((s) => s.by_id === ME_ID));
      else if (p_box !== 'all' || !isLeader()) L = [];
      return L.slice().sort((a, b) => b.at.localeCompare(a.at)).map(reqItem);
    },
    req_create({ p_type, p_data }) { const t = DB.request_types.find((x) => x.key === p_type);
      const steps = t.workflow.map((k, i) => ({ step: i + 1, kind: k, approver_id: k === 'manager' ? DB.managers[ME_ID] || IDS.leadership : IDS.leadership }));
      DB.requests.push({ id: Math.max(0, ...DB.requests.map((r) => r.id)) + 1, type: p_type, requester_id: ME_ID, data: p_data, at: iso(new Date()), status: 'pending', step: 1, steps, attachments: [] }); save(); return true; },
    req_decide({ p_id, p_decision, p_note }) {
      const r = DB.requests.find((x) => x.id === p_id); const s = r.steps.find((x) => x.step === r.step);
      if (p_decision !== 'approve' && !String(p_note || '').trim()) throw new Error('اكتب سبب الرفض أو الإعادة في الملاحظة');
      Object.assign(s, { decision: p_decision, by_id: ME_ID, at: iso(new Date()), note: p_note || '' });
      if (p_decision === 'approve') { if (r.step < r.steps.length) r.step++; else r.status = 'approved'; } else r.status = p_decision === 'reject' ? 'rejected' : 'returned';
      save(); return true; },
    req_cancel({ p_id }) { const r = DB.requests.find((x) => x.id === p_id); r.status = 'cancelled'; save(); return true; },
    req_resubmit({ p_id, p_data }) { const r = DB.requests.find((x) => x.id === p_id); r.data = p_data; r.status = 'pending'; r.step = 1; r.steps.forEach((s) => { delete s.decision; delete s.by_id; delete s.at; s.note = ''; }); save(); return true; },
    cmp_list({ p_box }) {
      let L = DB.complaints;
      if (p_box === 'mine') L = L.filter((c) => c.by_id === ME_ID); else if (!isSuper()) L = L.filter((c) => c.assignee_id === ME_ID);
      return L.map((c) => ({ id: c.id, subject: c.subject, category: c.category, by: name(c.by_id), by_role: (P(c.by_id) || {}).role, student: c.student_id ? name(c.student_id) : '', assignee: c.assignee_id ? name(c.assignee_id) : null, updated: c.updated, status: c.status }));
    },
    cmp_get({ p_id }) { const c = DB.complaints.find((x) => x.id === p_id); const manage = isSuper() || c.assignee_id === ME_ID;
      return { id: c.id, by: name(c.by_id), by_role: (P(c.by_id) || {}).role, category: c.category, student: c.student_id ? name(c.student_id) : null, teacher: c.teacher_id ? name(c.teacher_id) : null,
        at: c.at, status: c.status, assignee: c.assignee_id ? name(c.assignee_id) : null, subject: c.subject, details: c.details, attachments: [], manage,
        updates: c.updates.filter((u) => manage || !u.internal).map((u) => ({ by: name(u.by_id), at: u.at, status: u.status, internal: u.internal, note: u.note })) }; },
    cmp_create({ p }) { DB.complaints.push({ id: Math.max(0, ...DB.complaints.map((c) => c.id)) + 1, by_id: ME_ID, category: p.category, subject: p.subject, details: p.details || '', student_id: p.student_id || (MYROLE() === 'student' ? ME_ID : null), teacher_id: p.teacher_id || null,
      status: 'new', assignee_id: null, at: iso(new Date()), updated: iso(new Date()), attachments: [], updates: [] }); save(); return true; },
    cmp_update({ p_id, p_status, p_note, p_internal, p_assignee }) { const c = DB.complaints.find((x) => x.id === p_id);
      if (p_status) c.status = p_status; if (p_assignee) c.assignee_id = p_assignee; c.updated = iso(new Date());
      c.updates.push({ by_id: ME_ID, at: c.updated, status: p_status || null, note: p_note || '', internal: !!p_internal }); save(); return true; },
    trn_list({ p_pid, p_from, p_to }) {
      let L = DB.training.filter((t) => (!p_pid || t.pid === p_pid) && (!p_from || (t.end || t.start) >= p_from) && (!p_to || t.start <= p_to));
      if (!p_pid && !isSuper()) L = L.filter((t) => t.pid === ME_ID);
      if (!p_pid && MYROLE() === 'supervisor') { const T = new Set(DB.supervision.filter((x) => x.supervisor_id === ME_ID).map((x) => x.teacher_id)); L = L.filter((t) => T.has(t.pid) || t.pid === ME_ID); }
      return { rows: L.map(trnItem), can_all: isSuper() };
    },
    trn_save({ p }) { const row = { title: p.title, provider: p.provider, mode: p.mode, start: p.start_date || null, end: p.end_date || null, hours: Number(p.hours) || 0, self_rating: Number(p.self_rating) || null, self_note: p.self_note || '' };
      if (p.id) Object.assign(DB.training.find((t) => t.id === p.id), row);
      else DB.training.push(Object.assign({ id: Math.max(0, ...DB.training.map((t) => t.id)) + 1, pid: ME_ID, certificate: null, impact_rating: null, impact_note: '', impact_by: null }, row));
      save(); return true; },
    trn_delete({ p_id }) { DB.training = DB.training.filter((t) => t.id !== p_id); save(); return true; },
    trn_impact({ p_id, p_rating, p_note }) { Object.assign(DB.training.find((t) => t.id === p_id), { impact_rating: p_rating, impact_note: p_note, impact_by: ME_ID }); save(); return true; },
    att_my_groups() {
      return myGrades().map((gid) => { const g = grade(gid), st = stage(g.stage_id); const C = DB.classes.filter((c) => c.grade_id === gid);
        return { grade_id: gid, label: `${g.name_ar} — ${st.name_ar}`, sort: String(st.sort) + g.number, students: DB.students.filter((s) => s.grade_id === gid).length,
          classes: C.map((c) => ({ id: c.id, name: c.name, n: DB.students.filter((s) => s.class_id === c.id).length })) }; }).sort((a, b) => a.sort.localeCompare(b.sort));
    },
    att_roster({ p_day, p_grade, p_class, p_period }) {
      const S = DB.students.filter((s) => s.grade_id === p_grade && (!p_class || s.class_id === p_class));
      const sess = DB.att_sessions.find((x) => x.day === p_day && x.grade_id === p_grade && (x.class_id || null) === (p_class || null) && x.period === (p_period || 0));
      const daily = DB.att_sessions.find((x) => x.day === p_day && x.grade_id === p_grade && x.period === 0 && !x.class_id);
      return { session: sess ? { by: name(sess.taken_by), taken_at: sess.taken_at } : null,
        students: S.map((s) => { const m = sess && DB.att_marks.find((x) => x.session_id === sess.id && x.student_id === s.profile_id); const dm = p_period && daily && DB.att_marks.find((x) => x.session_id === daily.id && x.student_id === s.profile_id);
          return { id: s.profile_id, name: name(s.profile_id), no: s.student_number, class: klass(s.class_id).name, status: m ? m.status : '', note: m ? m.note : '', daily: dm ? dm.status : '' }; })
          .sort((a, b) => a.class.localeCompare(b.class, 'ar') || a.name.localeCompare(b.name, 'ar')) };
    },
    att_save({ p_day, p_grade, p_class, p_period, p_marks }) {
      let sess = DB.att_sessions.find((x) => x.day === p_day && x.grade_id === p_grade && (x.class_id || null) === (p_class || null) && x.period === (p_period || 0));
      if (!sess) { sess = { id: Math.max(0, ...DB.att_sessions.map((x) => x.id)) + 1, day: p_day, grade_id: p_grade, class_id: p_class || null, period: p_period || 0 }; DB.att_sessions.push(sess); }
      Object.assign(sess, { taken_by: ME_ID, taken_at: iso(new Date()) });
      DB.att_marks = DB.att_marks.filter((m) => m.session_id !== sess.id);
      p_marks.forEach((m) => DB.att_marks.push({ session_id: sess.id, student_id: m.s, status: m.st, note: m.n || '' }));
      save();
      const total = DB.students.filter((s) => s.grade_id === p_grade && (!p_class || s.class_id === p_class)).length;
      return { total, absent: p_marks.filter((m) => m.st === 'absent').length, late: p_marks.filter((m) => m.st === 'late').length, excused: p_marks.filter((m) => m.st === 'excused').length };
    },
    att_report({ p_from, p_to }) {
      const G = myGrades(); const ses = DB.att_sessions.filter((x) => x.period === 0 && x.day >= p_from && x.day <= p_to && G.includes(x.grade_id));
      const grades = G.map((gid) => { const g = grade(gid), sx = ses.filter((x) => x.grade_id === gid), M = DB.att_marks.filter((m) => sx.some((x) => x.id === m.session_id));
        const last = sx.sort((a, b) => b.day.localeCompare(a.day))[0];
        return { grade_id: gid, label: `${g.name_ar} — ${stage(g.stage_id).name_ar}`, students: DB.students.filter((s) => s.grade_id === gid).length, days_taken: new Set(sx.map((x) => x.day)).size,
          absent: M.filter((m) => m.status === 'absent').length, late: M.filter((m) => m.status === 'late').length, excused: M.filter((m) => m.status === 'excused').length, last: last ? { day: last.day, by: name(last.taken_by) } : null }; });
      const by = {}; DB.att_marks.forEach((m) => { const s = ses.find((x) => x.id === m.session_id); if (!s) return;
        const o = by[m.student_id] = by[m.student_id] || { absent: 0, late: 0, excused: 0, days: [] }; o[m.status]++; o.days.push({ d: s.day, s: m.status, n: m.note }); });
      const students = Object.entries(by).map(([id, o]) => { const s = DB.students.find((x) => x.profile_id === id);
        return Object.assign(o, { name: name(id), grade: grade(s.grade_id).name_ar + ' — ' + stage(grade(s.grade_id).stage_id).name_ar, class: klass(s.class_id).name }); })
        .sort((a, b) => (b.absent * 2 + b.late) - (a.absent * 2 + a.late)).slice(0, 40);
      return { grades, students };
    },
    att_today_mine() { const d = dow(); if (d < 0) return [];
      return DB.tt_slots.filter((s) => s.teacher_id === ME_ID && s.day === d && s.class_id).map((s) => ({ period: s.period, class_id: s.class_id,
        taken: DB.att_sessions.some((x) => x.day === today() && x.class_id === s.class_id && x.period === s.period) })); },
    portal_child({ p_student }) { return childData(p_student); },
    staff_dir_list() {
      const grpOf = (p) => { if (['admin', 'leadership'].includes(p.role)) return 'إدارة المدارس'; if (p.role === 'staff') return /تقنية/.test(p.job_title) ? 'تقنية المعلومات' : /الموارد/.test(p.job_title) ? 'الموارد البشرية' : 'التطوير التربوي';
        if (p.role === 'supervisor') return 'التطوير التربوي';
        const sc = DB.staff_scopes.find((x) => x.profile_id === p.id); if (sc && sc.stage_id) return 'بنين — ' + stage(sc.stage_id).name_ar.replace(' بنين', '');
        const t = DB.teaching_assignments.find((x) => x.teacher_id === p.id); return t ? 'بنين — ' + stage(grade(klass(t.class_id).grade_id).stage_id).name_ar.replace(' بنين', '') : 'إدارة المدارس'; };
      const VT = Object.fromEntries(VIEWS.v_staff_teaching().map((v) => [v.teacher_id, v]));
      return DB.profiles.filter((p) => !['student', 'parent'].includes(p.role) && p.active).map((p, i) => ({ zid: i + 1, no: String(1000 + i), name: p.full_name, en: '', title: p.job_title, grp: grpOf(p),
        email: p.email, mobile: '05' + String(30000000 + i * 1371).slice(0, 8), work: null, manager: DB.managers[p.id] && DB.managers[p.id] !== p.id ? name(DB.managers[p.id]) : '',
        subjects: VT[p.id] ? VT[p.id].subjects.split('، ') : null, stages: VT[p.id] ? VT[p.id].stages.split('، ') : null, classes: null, periods: VT[p.id] ? VT[p.id].weekly_periods : null }));
    },
    // ----- بوابة ولي الأمر (الرمز السري التجريبي 123456) -----
    pp_status() { return { student: name(IDS.student), guardians: DB.pp.guardians.map((g) => ({ id: g.id, name: g.name, phone: g.phone, has_pin: g.has_pin, locked: false })) }; },
    pp_login({ p_pin }) { return p_pin === DB.pp.guardians[0].pin ? { ok: true, token: 'demo-token' } : { ok: false, error: 'الرمز السري غير صحيح — في التجربة استخدم 123456' }; },
    pp_activate({ p_pin }) { DB.pp.guardians[0].pin = p_pin; save(); return { token: 'demo-token' }; },
    pp_children() { const g = DB.pp.guardians[0]; return { guardian: { name: g.name, phone: g.phone }, children: DB.pp.children.map(childData) }; },
    pp_change_pin({ p_old, p_new }) { if (p_old !== DB.pp.guardians[0].pin) throw new Error('الرمز الحالي غير صحيح'); DB.pp.guardians[0].pin = p_new; save(); return true; },
    pp_logout() { return true; },
    // ----- لوحة الإدارة -----
    parents_sync() { return { ok: true, emails: 0, created: 0, links: 0, parents: 0, note: NA }; },
    sch_tt_get() { return { ok: true, profiles: [], times: {}, grades: [] }; }
  };

  // ======================================================================
  //  العميل التجريبي
  // ======================================================================
  const session = { access_token: 'demo', token_type: 'bearer', user: { id: ME_ID, email: (ME() || {}).email, role: 'authenticated' } };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const client = {
    __demo: true,
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: null }),
      signOut: async () => { exit(); return { error: null }; },
      signInWithOAuth: async () => ({ error: { message: 'أنت في الوضع التجريبي — اخرج من التجربة أولًا' } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    from: (t) => new Query(t),
    rpc: async (fn, args) => {
      await wait(60 + Math.random() * 90);
      const f = RPC[fn];
      if (!f) return { data: null, error: { message: NA } };
      try { return { data: clone(f(args || {})), error: null }; } catch (e) { return { data: null, error: { message: e.message || String(e) } }; }
    },
    storage: { from: () => ({
      upload: async () => ({ data: { path: 'demo' }, error: null }),
      createSignedUrl: async () => ({ data: null, error: { message: 'المرفقات غير متاحة في الوضع التجريبي' } }) }) },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }), removeChannel() {}
  };
  function exit() { try { sessionStorage.removeItem(KEY); sessionStorage.removeItem(DBKEY); Object.keys(sessionStorage).filter((k) => k.startsWith('lms_c:')).forEach((k) => sessionStorage.removeItem(k)); } catch (_) {} }


  window.LMS_DEMO = { role: ROLE, roles: ROLES_INFO, client, exit, me: () => clone(ME()) };
})();
