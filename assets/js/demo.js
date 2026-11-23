/* =====================================================================
   الوضع التجريبي (ديمو): مدرسة افتراضية كاملة داخل المتصفح
   - لا يتصل بقاعدة البيانات الحقيقية إطلاقًا: كل البيانات وهمية ومولّدة هنا
   - يحاكي واجهة Supabase التي تستخدمها الصفحات (auth / from / rpc / storage)
   - أي تعديل يُحفظ في ذاكرة التبويب فقط ويُمسح عند الخروج من التجربة
   ===================================================================== */
(function () {
  'use strict';
  const KEY = 'lms_demo', DBKEY = 'lms_demo_db', VER = 7;
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
  // أيام دراسية حسب التقويم (academic-calendar.js): الأحد–الخميس خارج الإجازات
  const isSD = (d) => d.getDay() <= 4 && !((window.ACAD && window.ACAD.hol) || []).some((h) => ymd(d) >= h.f && ymd(d) <= h.to);
  // اليوم الدراسي رقم n قبل اليوم (n>0)، أو بعده (n<=0: 0 = أقرب يوم دراسي من اليوم)
  const sd = (n, h = 9) => { const d = new Date(); d.setHours(h, 0, 0, 0); if (n > 0) { let k = 0; while (k < n) { d.setDate(d.getDate() - 1); if (isSD(d)) k++; } }
    else { while (!isSD(d)) d.setDate(d.getDate() + 1); let k = 0; while (k < -n) { d.setDate(d.getDate() + 1); if (isSD(d)) k++; } } return d; };
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
    staff(IDS.leadership, 'خالد الشهري', 'leadership', 'المدير التنفيذي', { email: 'ceo@' + DOMAIN });
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
        const ts = teacherFor[st + '|' + s]; const t = ts[(c.id + 1) % ts.length];   // معلم الديمو يدرّس فصل طالب الديمو
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
      { key: 'student_login_enabled', value: true }, { key: 'parent_login_enabled', value: true },
      { key: 'cert_edu_title', value: 'مدير التعليم' }, { key: 'cert_edu_name', value: 'أ. فهد السبيعي (تجريبي)' }, { key: 'cert_exec_title', value: 'المدير التنفيذي' }, { key: 'cert_exec_name', value: 'د. ناصر المالكي (تجريبي)' }];
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
    const schoolDays = []; for (let i = 1; schoolDays.length < 20 && i < 90; i++) { const d = daysAgo(i); if (isSD(d)) schoolDays.push(ymd(d)); }
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
      { id: 1, pid: IDS.teacher, title: 'استراتيجيات التعلم النشط في الرياضيات', provider: 'إدارة التدريب', mode: 'حضوري', start: ymd(daysAgo(60)), end: ymd(daysAgo(59)), hours: 10, certificate: null, self_rating: 5, self_note: 'طبقت استراتيجية فكّر-زاوج-شارك في وحدة الكسور.', impact_rating: 4, impact_note: 'ظهر أثرها في الزيارة الأخيرة', impact_by: IDS.supervisor, presenter: 'د. خالد العتيبي', status: 'approved', review_by: IDS.supervisor, review_at: iso(daysAgo(55)), cert_no: 'DTH-2026-00001', cert_issued_at: iso(daysAgo(55)) },
      { id: 2, pid: IDS.teacher, title: 'التقويم البنائي', provider: 'منصة مدرستي', mode: 'عن بعد', start: ymd(daysAgo(20)), end: ymd(daysAgo(20)), hours: 3, certificate: null, self_rating: 4, self_note: '', impact_rating: null, impact_note: '', impact_by: null, presenter: 'أ. منى الشهري', status: 'pending' },
      { id: 3, pid: t2.id, title: 'تدريس العلوم بالاستقصاء', provider: 'مركز التدريب', mode: 'حضوري', start: ymd(daysAgo(30)), end: ymd(daysAgo(29)), hours: 8, certificate: null, self_rating: 4, self_note: '', impact_rating: null, impact_note: '', impact_by: null, presenter: 'د. سامي الزهراني', status: 'pending' }];

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
  function trnItem(t) { return Object.assign({ status: 'pending' }, t, { name: name(t.pid), mine: t.pid === ME_ID, impact_by: t.impact_by ? name(t.impact_by) : null, review_by: t.review_by ? name(t.review_by) : null }); }

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
    sch_tt_get() {
      const T = (start, n) => { const out = []; let m = start; for (let i = 1; i <= n; i++) { const s = m, e = m + 45; out.push({ p: i, s: `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`, e: `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}` }); m = e + (i === 3 ? 25 : 5); } return out; };
      const owner = { 1: DB.profiles.find((p) => p.job_title === 'مشرف اللغة العربية').id, 2: IDS.supervisor, 3: DB.profiles.find((p) => p.job_title === 'مشرف العلوم').id };
      const can = isManager();
      return { ok: true,
        profiles: [{ key: 'pri', name: 'الابتدائي', can, times: T(7 * 60 + 15, 7) }, { key: 'mid', name: 'المتوسط', can, times: T(7 * 60 + 15, 7) }, { key: 'sec', name: 'الثانوي', can, times: T(7 * 60 + 15, 7) }],
        supervisors: DB.profiles.filter((p) => p.role === 'supervisor').map((p) => ({ id: p.id, name: p.full_name, dept: p.job_title.replace('مشرف ', ''), email: p.email })),
        sheets: [1, 2, 3].map((st) => ({ id: st, owner: owner[st], idx: 0, name: 'جدول ' + stage(st).name_ar + '.xlsx', label: stage(st).name_ar, updated: iso(daysAgo(10)), slots: DB.tt_slots.filter((x) => x.sheet_id === st).length })),
        teachers: [1, 2, 3].flatMap((st) => [...new Set(DB.tt_slots.filter((x) => x.sheet_id === st).map((x) => x.teacher_id))].map((t) => ({ sheet: st, id: t, name: name(t),
          n: DB.tt_slots.filter((x) => x.sheet_id === st && x.teacher_id === t).length, fixed: [...new Set(DB.tt_slots.filter((x) => x.sheet_id === st && x.teacher_id === t).map((x) => subj(x.subject_id).name_ar))].join('، '), subject: null }))),
        grades: DB.grades.map((g) => ({ sheet: g.stage_id, track: 'arabic', grade: g.number, classes: DB.classes.filter((c) => c.grade_id === g.id).map((c) => `${g.number}-${c.name}`).join('، '),
          stage: { 1: 'ابتدائي', 2: 'متوسط', 3: 'ثانوي' }[g.stage_id], stage_set: true, prof: { 1: 'pri', 2: 'mid', 3: 'sec' }[g.stage_id] })) };
    },
    gd_list({ p_q, p_grade }) {
      const q = norm(p_q || '');
      return DB.students.filter((s) => (!p_grade || s.grade_id === p_grade) && (!q || norm(name(s.profile_id) + s.guardian_phone + s.student_number).includes(q))).slice(0, 300).map((s, i) => ({
        student: s.profile_id, name: name(s.profile_id), grade: grade(s.grade_id).name_ar + ' — ' + stage(grade(s.grade_id).stage_id).name_ar + ' / ' + klass(s.class_id).name,
        guardians: s.guardian_phone ? [{ id: 'g-' + s.profile_id, name: s.guardian_name, phone: '966' + s.guardian_phone.slice(1), has_pin: i % 3 !== 0, locked: i % 17 === 5 }] : [] }));
    }
  };

  // ======================================================================
  //  الوحدات التعليمية السبع (نسخة تجريبية من sql/33–40)
  // ======================================================================
  Object.assign(RPC, (function () {
    const lbl = (cid) => { const c = klass(cid), g = grade(c.grade_id), st = stage(g.stage_id); return `${g.name_ar} ${st.name_ar} / ${c.name}`; };
    const csort = (a, b) => { const A = klass(a), B = klass(b), gA = grade(A.grade_id), gB = grade(B.grade_id); return stage(gA.stage_id).sort - stage(gB.stage_id).sort || gA.number - gB.number || A.name.localeCompare(B.name, 'ar'); };
    const deny = (m) => { throw new Error(m || 'غير مصرح'); };
    const isStaff = () => !['student', 'parent'].includes(MYROLE());
    const myCid = () => (MYROLE() === 'student' ? (DB.students.find((s) => s.profile_id === ME_ID) || {}).class_id || null : null);
    const myTA = () => DB.teaching_assignments.filter((t) => t.teacher_id === ME_ID);
    const teaches = (cid, sid) => myTA().some((t) => t.class_id === cid && (sid == null || t.subject_id === sid));
    const myStage = () => (DB.staff_scopes.find((x) => x.profile_id === ME_ID) || {}).stage_id;
    const reviewer = (tid) => tid !== ME_ID && (isLeader() || DB.supervision.some((x) => x.supervisor_id === ME_ID && x.teacher_id === tid) || DB.managers[tid] === ME_ID
      || (MYROLE() === 'principal' && DB.teaching_assignments.some((t) => t.teacher_id === tid && grade(klass(t.class_id).grade_id).stage_id === myStage())));
    // الاعتماد: مشرف المعلم، فإن لم يكن له مشرف فمدير مرحلته
    const hasSup = (tid) => DB.supervision.some((x) => x.teacher_id === tid && x.supervisor_id !== tid);
    const canApprove = (tid) => tid !== ME_ID && (DB.supervision.some((x) => x.supervisor_id === ME_ID && x.teacher_id === tid)
      || (MYROLE() === 'principal' && !hasSup(tid) && DB.teaching_assignments.some((t) => t.teacher_id === tid && grade(klass(t.class_id).grade_id).stage_id === myStage())));
    const trnIssue = (t) => { if (!t.cert_no) Object.assign(t, { cert_no: 'DTH-' + new Date().getFullYear() + '-' + String(t.id).padStart(5, '0'), cert_issued_at: iso(now()), cert_issued_by: ME_ID }); };
    const canFollow = () => isSuper() || DB.supervision.some((x) => x.supervisor_id === ME_ID);
    const sname = (id) => (subj(id) || {}).name_ar || null;
    const stuIn = (cids) => DB.students.filter((s) => cids.includes(s.class_id) && (P(s.profile_id) || {}).active !== false);
    const now = () => new Date();
    const nid = (t) => (M().seq[t] = (M().seq[t] || 0) + 1);
    const cleanLinks = (L) => (Array.isArray(L) ? L : []).filter((l) => /^https?:\/\//i.test(String(l && l.url || '').trim())).slice(0, 10).map((l) => ({ url: String(l.url).trim().slice(0, 500), title: String(l.title || '').slice(0, 120) }));
    const rnum = (x, d = 0) => (x == null || isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
    const avg = (a) => { const v = a.filter((x) => x != null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
    const options = () => {
      const T = myTA(); const by = {};
      T.forEach((t) => { (by[t.class_id] = by[t.class_id] || new Set()).add(t.subject_id); });
      return { role: MYROLE(), is_teacher: T.length > 0, can_follow: canFollow(), can_review: DB.supervision.some((x) => x.supervisor_id === ME_ID) || (MYROLE() === 'principal' && [...new Set(DB.teaching_assignments.map((t) => t.teacher_id))].some(canApprove)),
        subjects: [...new Set(T.map((t) => t.subject_id))].map((id) => ({ id, name: sname(id) })),
        classes: Object.keys(by).map(Number).sort(csort).map((id) => ({ id, label: lbl(id), subjects: [...by[id]] })) };
    };

    // ---------- البيانات التجريبية (تُبنى مرة واحدة لكل جلسة تجربة) ----------
    function M() { if (!DB.M || DB.M.v !== 3) { DB.M = seed(); DB.M.v = 3; save(); } return DB.M; }
    function seed() {
      const S = { seq: {}, lp: [], hw: [], hs: [], cp: [], qb: [], ex: [], ea: [], gi: [], gs: [], pf: [] };
      const MATH = DB.subjects.find((s) => s.name_ar === 'رياضيات').id;
      const myCls = DB.teaching_assignments.filter((t) => t.teacher_id === IDS.teacher && t.subject_id === MATH).map((t) => t.class_id).sort(csort);
      const stuCls = DB.students.find((s) => s.profile_id === IDS.student).class_id;
      const cls = myCls.includes(stuCls) ? [stuCls, ...myCls.filter((c) => c !== stuCls)] : myCls;
      const c1 = cls[0], c2 = cls[1] || cls[0];
      const peer = DB.teaching_assignments.find((t) => t.subject_id === MATH && t.teacher_id !== IDS.teacher && DB.supervision.some((x) => x.supervisor_id === IDS.supervisor && x.teacher_id === t.teacher_id));
      const at = (n, h = 9) => iso(sd(n, h));
      const id = (t) => (S.seq[t] = (S.seq[t] || 0) + 1);
      // تحضير الدروس
      const C = (o, w, s, p, a, h) => ({ objectives: o, warmup: w, strategies: s, procedures: p, assessment: a, homework: h, thinking_list: ['قبعات التفكير الست'], strategies_list: ['التعلم التعاوني', 'فكّر - زاوج - شارك'],
        real_life: 'حساب مجموع مشتريات من البقالة بالريال والهللة.', cross_subject: 'العلوم: قراءة القياسات العشرية في التجارب.' });
      const lp = (tid, sid, cl, d, title, status, content, extra = {}) => S.lp.push(Object.assign({ id: id('lp'), teacher_id: tid, subject_id: sid, class_ids: cl, lesson_date: ymd(sd(d)), title, content, status,
        submitted_at: status !== 'draft' ? at(d + 2) : null, reviewed_by: null, reviewed_at: null, review_note: null, created_at: at(d + 3), updated_at: at(d + 2) }, extra));
      lp(IDS.teacher, MATH, [c1, c2], 7, 'جمع الكسور العشرية', 'approved', C('أن يجمع الطالب كسرين عشريين بدقة.', 'سؤال: كم يكلّف شراء قلمين بـ 2.5 و 3.75 ريال؟', 'فكّر-زاوج-شارك', 'مراجعة القيمة المنزلية، ثم أمثلة موجّهة، ثم تدريب في مجموعات.', 'بطاقة خروج من 3 مسائل.', 'تمارين ص 54'), { reviewed_by: IDS.supervisor, reviewed_at: at(6), review_note: 'تحضير متميز' });
      lp(IDS.teacher, MATH, [c1, c2], 5, 'طرح الكسور العشرية', 'returned', C('أن يطرح الطالب كسرين عشريين.', 'لعبة الأسعار', 'التعلم التعاوني', 'أمثلة ثم تدريب.', 'أسئلة شفهية', ''), { reviewed_by: IDS.supervisor, reviewed_at: at(4), review_note: 'أضف نشاطًا لمراعاة الفروق الفردية' });
      lp(IDS.teacher, MATH, [c1], 1, 'ضرب الكسور العشرية', 'submitted', C('أن يضرب الطالب كسرًا عشريًا في عدد كلي.', 'نمط المساحات', 'العصف الذهني', 'نمذجة بالمربعات ثم تدريب.', 'تقويم بنائي بالسبورات الصغيرة', 'تمارين ص 60'));
      lp(IDS.teacher, MATH, [c1, c2], -1, 'قسمة الكسور العشرية', 'draft', C('أن يقسم الطالب كسرًا عشريًا على عدد كلي.', '', '', '', '', ''));
      if (peer) { lp(peer.teacher_id, MATH, [peer.class_id], 2, 'المعادلات ذات الخطوتين', 'submitted', C('حل معادلة من خطوتين.', 'لغز الميزان', 'التعلم بالاكتشاف', 'ميزان تفاعلي ثم تدريب.', 'تذكرة خروج', ''));
        lp(peer.teacher_id, MATH, [peer.class_id], 9, 'خصائص العمليات', 'approved', C('تمييز الخاصية التبديلية والتجميعية.', '', 'الحوار والمناقشة', '', '', ''), { reviewed_by: IDS.supervisor, reviewed_at: at(8) }); }
      // الواجبات
      const hw = (d, title, ins, mx, closed) => { const h = { id: id('hw'), teacher_id: IDS.teacher, subject_id: MATH, class_ids: [c1, c2].filter((v, i, a) => a.indexOf(v) === i), title, instructions: ins, links: [],
        due_at: iso(sd(d, 23)), max_score: mx, allow_late: true, closed: !!closed, period: d > 3 ? 'p1' : 'p2', created_at: at(d + 4), updated_at: at(d + 4) }; S.hw.push(h); return h; };
      const h1 = hw(6, 'تمارين جمع الكسور العشرية', 'حل التمارين من 1 إلى 10 صفحة 54.', 10);
      const h2 = hw(-2, 'مسائل حياتية على الطرح', 'اكتب 3 مسائل من واقع حياتك على طرح الكسور العشرية وحلّها.', 10);
      const h3 = hw(-6, 'مشروع: ميزانية الأسبوع', 'سجّل مصروفك لأسبوع بالكسور العشرية وأرسل رابط الجدول.', 20);
      stuIn(h1.class_ids).forEach((s, i) => { if (i % 6 === 5) return; const sc = 5 + Math.floor(rnd() * 6);
        S.hs.push({ id: id('hs'), hw_id: h1.id, student_id: s.profile_id, body: 'الحل مرفق في الدفتر وصورته في الرابط.', links: [], submitted_at: at(7, 18), late: i % 7 === 3, status: 'graded', score: s.profile_id === IDS.student ? 9 : sc, feedback: sc >= 9 ? 'ممتاز' : 'راجع التمرين 7' }); });
      stuIn(h2.class_ids).forEach((s, i) => { if (i % 3 || s.profile_id === IDS.student) return; S.hs.push({ id: id('hs'), hw_id: h2.id, student_id: s.profile_id, body: 'المسألة الأولى: …', links: [], submitted_at: at(0, 17), late: false, status: 'submitted', score: null, feedback: null }); });
      void h3;
      // صفحات المواد
      const sun = (n) => { const d = sd(n); d.setDate(d.getDate() - d.getDay()); return ymd(d); };
      const cp = (kind, title, body, wk, pinned, n) => S.cp.push({ id: id('cp'), teacher_id: IDS.teacher, subject_id: MATH, class_ids: [c1, c2].filter((v, i, a) => a.indexOf(v) === i), kind, title, body, links: [], week_start: wk, pinned: !!pinned, created_at: at(n), updated_at: at(n) });
      cp('announcement', 'اختبار الفترة الأولى يوم الأربعاء', 'يشمل الاختبار دروس الكسور العشرية (الجمع والطرح والضرب). راجعوا التمارين المحلولة.', null, true, 1);
      cp('content', 'ملخص درس جمع الكسور العشرية', 'نرتّب الأعداد بحيث تتحاذى الفواصل العشرية، ثم نجمع كما نجمع الأعداد الكلية.', sun(7), false, 7);
      cp('content', 'فيديو شرح طرح الكسور العشرية', 'شاهد الفيديو قبل الحصة القادمة وسجّل سؤالًا واحدًا.', sun(0), false, 2);
      // بنك الأسئلة
      const Q = (qtype, body, opts, answer, points, topic) => { const q = { id: id('qb'), owner_id: IDS.teacher, subject_id: MATH, grade_num: null, qtype, body, points, topic, answer: answer || null,
        options: qtype === 'mcq' ? opts.map((t, i) => ({ t, ok: i === 0 })) : qtype === 'tf' ? [{ t: 'صح', ok: !!opts }, { t: 'خطأ', ok: !opts }] : [], created_at: at(20) };
        if (q.qtype === 'mcq') { const ok = q.options[0]; q.options = [q.options[2], ok, q.options[1], q.options[3]].filter(Boolean); } S.qb.push(q); return q; };
      const qs = [Q('mcq', 'ناتج 2.5 + 1.75 =', ['4.25', '3.25', '4.3', '3.75'], null, 2, 'الجمع'), Q('mcq', 'ناتج 5 − 2.4 =', ['2.6', '3.4', '2.4', '3.6'], null, 2, 'الطرح'),
        Q('tf', 'العدد 0.5 أكبر من 0.45', true, null, 1, 'المقارنة'), Q('tf', '0.3 × 10 = 0.03', false, null, 1, 'الضرب'),
        Q('mcq', 'أي الأعداد التالية يساوي ثلاثة أعشار؟', ['0.3', '3.0', '0.03', '30'], null, 1, 'القيمة المنزلية'), Q('short', 'اكتب 0.75 في صورة كسر اعتيادي في أبسط صورة', null, '3/4', 3, 'التحويل'),
        Q('mcq', 'ناتج 1.2 × 3 =', ['3.6', '3.2', '36', '0.36'], null, 2, 'الضرب'), Q('short', 'اشرح بكلماتك لماذا نحاذي الفواصل العشرية عند الجمع', null, null, 3, 'الجمع')];
      const mq = { id: id('qb'), owner_id: IDS.teacher, subject_id: MATH, grade_num: null, qtype: 'match', body: 'زاوج كل كسر عشري بما يساويه من الكسور الاعتيادية', points: 3, topic: 'التحويل', answer: null,
        options: [{ l: '0.5', r: '1/2' }, { l: '0.25', r: '1/4' }, { l: '0.75', r: '3/4' }], image: null, created_at: at(18) }; S.qb.push(mq); qs.push(mq);
      // الاختبارات
      const exam = (title, open, close, cl, qq, dur) => { const e = { id: id('ex'), teacher_id: IDS.teacher, subject_id: MATH, class_ids: cl, title, instructions: 'اقرأ كل سؤال جيدًا قبل الإجابة.',
        questions: qq.map((q) => ({ id: String(q.id), qtype: q.qtype, body: q.body, options: clone(q.options), answer: q.answer, points: q.points })), opens_at: iso(open), closes_at: iso(close), duration_min: dur, shuffle: true, show_results: true, period: open < sd(3) ? 'p1' : 'mid', created_at: iso(open) }; S.ex.push(e); return e; };
      const e1 = exam('اختبار قصير: جمع وطرح الكسور العشرية', sd(8, 8), sd(8, 14), [c1, c2].filter((v, i, a) => a.indexOf(v) === i), qs.slice(0, 6), 20);
      exam('اختبار الفترة الأولى', sd(isSD(new Date()) ? 0 : 1, 0), sd(-3, 23), [c1], [qs[0], qs[2], qs[3], qs[4], qs[6], qs[7], mq], 30);
      exam('اختبار الوحدة الثالثة', sd(-7, 8), sd(-7, 12), [c1, c2].filter((v, i, a) => a.indexOf(v) === i), qs.slice(2), 25);
      stuIn(e1.class_ids).forEach((s, i) => { if (i % 8 === 7) return; const ans = {}, res = {}; let sc = 0, rev = false;
        e1.questions.forEach((q) => { const okI = q.options.findIndex((o) => o.ok); const good = s.profile_id === IDS.student ? q.qtype !== 'short' : rnd() < (q.qtype === 'tf' ? 0.85 : 0.65);
          if (q.qtype === 'short') { ans[q.id] = good ? '3/4' : '75/100'; if (good) { res[q.id] = { pts: q.points, ok: true }; sc += q.points; } else if (i % 2) { res[q.id] = { pts: 2, ok: false, manual: true, graded: true }; sc += 2; } else { res[q.id] = { pts: 0, ok: null, manual: true }; rev = true; } }
          else { const a = good ? okI : (okI + 1) % q.options.length; ans[q.id] = String(a); res[q.id] = { pts: good ? q.points : 0, ok: good }; if (good) sc += q.points; } });
        S.ea.push({ id: id('ea'), exam_id: e1.id, student_id: s.profile_id, started_at: iso(sd(8, 9)), deadline: iso(sd(8, 9)), submitted_at: iso(sd(8, 9)), q_order: [], answers: ans, results: res,
          score: sc, max_score: e1.questions.reduce((a, q) => a + q.points, 0), needs_review: rev }); });
      // سجل الدرجات: عمود يدوي
      const gi = { id: id('gi'), teacher_id: IDS.teacher, class_id: c1, subject_id: MATH, src_kind: 'manual', src_id: null, title: 'المشاركة الصفية', category: 'participation', max_score: 10, weight: 1, hidden: false, item_date: ymd(sd(3)), period: 'p1' };
      S.gi.push(gi); stuIn([c1]).forEach((s) => S.gs.push({ item_id: gi.id, student_id: s.profile_id, score: s.profile_id === IDS.student ? 9 : 6 + Math.floor(rnd() * 5), note: null }));
      // ملف الإنجاز
      const pf = (sid, kind, title, level, result, status, d, by, desc) => S.pf.push({ id: id('pf'), student_id: sid, kind, title, description: desc || null, item_date: ymd(sd(d)), level, result, links: [],
        status, added_by: by, reviewed_by: status === 'approved' && by === sid ? IDS.teacher : status === 'approved' ? by : null, reviewed_at: status === 'approved' ? at(d - 1) : null, review_note: null, created_at: at(d) });
      pf(IDS.student, 'competition', 'أولمبياد الرياضيات المدرسي', 'school', 'المركز الثاني', 'approved', 40, IDS.teacher, 'شارك في التصفيات المدرسية لأولمبياد الرياضيات.');
      pf(IDS.student, 'project', 'روبوت فرز النفايات', 'district', 'مشاركة', 'approved', 25, IDS.student, 'مشروع جماعي في نادي الروبوت لفرز العلب البلاستيكية.');
      pf(IDS.student, 'certificate', 'دورة أساسيات البرمجة بلغة بايثون', null, 'اجتياز', 'pending', 3, IDS.student);
      stuIn([c1]).slice(1, 4).forEach((s, i) => pf(s.profile_id, ['reading', 'volunteer', 'award'][i], ['تحدي القراءة العربي', 'حملة نظافة الحي', 'الطالب المثالي'][i], 'school', ['20 كتابًا', '', 'تكريم'][i], i === 2 ? 'approved' : 'pending', 2 + i, s.profile_id));
      // مكتبة المعلمين: عناصر شاركها زملاء
      S.lib = [];
      const lib = (owner, kind, title, payload, note, n) => S.lib.push({ id: id('lib'), owner_id: owner, kind, src_id: 1000 + id('libsrc'), subject_id: MATH, grade_label: 'الصف الثاني متوسط بنين', title, note, payload, uses: n, created_at: at(n + 2) });
      const po = peer ? peer.teacher_id : IDS.teacher;
      lib(po, 'hw', 'ورقة عمل: مسائل حياتية على الكسور العشرية', { title: 'ورقة عمل: مسائل حياتية على الكسور العشرية', instructions: 'حل المسائل الخمس في الورقة المرفقة مع كتابة خطوات الحل.', links: [], max_score: 10 }, 'جرّبتها مع فصلي وكانت ممتازة', 4);
      lib(po, 'exam', 'اختبار قصير: الكسور العشرية', { title: 'اختبار قصير: الكسور العشرية', instructions: '', duration_min: 15, questions: qs.slice(0, 4).map((q) => ({ id: String(q.id), qtype: q.qtype, body: q.body, options: clone(q.options), answer: q.answer, points: q.points })) }, null, 2);
      lib(po, 'post', 'خريطة ذهنية لوحدة الكسور العشرية', { kind: 'content', title: 'خريطة ذهنية لوحدة الكسور العشرية', body: 'ملخص بصري للوحدة: القراءة والكتابة، المقارنة، الجمع والطرح، الضرب.', links: [] }, null, 1);
      return S;
    }

    // ---------- تحضير الدروس ----------
    const lpCard = (l) => ({ id: l.id, title: l.title, date: l.lesson_date, status: l.status, subject: sname(l.subject_id), subject_id: l.subject_id, classes: l.class_ids.slice().sort(csort).map(lbl),
      teacher: name(l.teacher_id), teacher_id: l.teacher_id, submitted_at: l.submitted_at, reviewed_at: l.reviewed_at, reviewer: l.reviewed_by ? name(l.reviewed_by) : null, note: l.review_note, updated_at: l.updated_at });
    const lpOf = (id) => M().lp.find((l) => l.id === +id) || deny('التحضير غير موجود');
    const checkMine = (cls, sid) => { if (cls.some((c) => !teaches(c))) deny('اختر من فصولك المسندة إليك فقط'); if (sid != null && !myTA().some((t) => t.subject_id === sid)) deny('اختر من موادك المسندة إليك فقط'); };

    // ---------- الواجبات ----------
    const hwCard = (h) => ({ id: h.id, period: h.period || null, title: h.title, due_at: h.due_at, max_score: h.max_score, allow_late: h.allow_late, closed: h.closed, subject: sname(h.subject_id), subject_id: h.subject_id,
      teacher: name(h.teacher_id), teacher_id: h.teacher_id, created_at: h.created_at, classes: h.class_ids.slice().sort(csort).map(lbl) });
    const hwOf = (id) => M().hw.find((h) => h.id === +id) || deny('الواجب غير موجود');
    const subOf = (hid, sid) => M().hs.find((s) => s.hw_id === hid && s.student_id === sid);

    // ---------- الاختبارات ----------
    const maxOf = (e) => e.questions.reduce((a, q) => a + +q.points, 0);
    const exState = (e) => (now() < new Date(e.opens_at) ? 'upcoming' : now() > new Date(e.closes_at) ? 'closed' : 'open');
    const exCard = (e) => ({ id: e.id, period: e.period || null, title: e.title, opens_at: e.opens_at, closes_at: e.closes_at, duration_min: e.duration_min, subject: sname(e.subject_id), subject_id: e.subject_id,
      teacher: name(e.teacher_id), teacher_id: e.teacher_id, n_questions: e.questions.length, max_score: maxOf(e), show_results: e.show_results, classes: e.class_ids.slice().sort(csort).map(lbl), state: exState(e) });
    const exOf = (id) => M().ex.find((e) => e.id === +id) || deny('الاختبار غير موجود');
    const attOf = (eid, sid) => M().ea.find((a) => a.exam_id === eid && a.student_id === sid);
    const qbCan = (sid) => isSuper() || myTA().some((t) => t.subject_id === sid);
    const shuffle = (a) => a.map((x) => [Math.random(), x]).sort((p, q) => p[0] - q[0]).map((p) => p[1]);
    const normA = (s) => norm(String(s || '').trim()).replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ');

    // ---------- سجل الدرجات ----------
    const gbView = (cid, sid) => DB.teaching_assignments.some((t) => t.class_id === cid && t.subject_id === sid && (t.teacher_id === ME_ID || reviewer(t.teacher_id)));
    const gbEdit = (cid, sid) => teaches(cid, sid);
    function gbCols(cid, sid) {
      const S = M(), ov = (k, id) => S.gi.find((g) => g.class_id === cid && g.subject_id === sid && g.src_kind === k && g.src_id === id);
      return [...S.hw.filter((h) => h.class_ids.includes(cid) && h.subject_id === sid).map((h) => { const g = ov('hw', h.id);
          return { key: 'hw' + h.id, kind: 'hw', src_id: h.id, item_id: g ? g.id : null, title: h.title, category: 'homework', max: h.max_score, weight: g ? g.weight : 1, hidden: g ? g.hidden : false, date: h.due_at.slice(0, 10), period: (g && g.period) || h.period || null }; }),
        ...S.ex.filter((e) => e.class_ids.includes(cid) && e.subject_id === sid).map((e) => { const g = ov('ex', e.id);
          return { key: 'ex' + e.id, kind: 'ex', src_id: e.id, item_id: g ? g.id : null, title: e.title, category: 'exam', max: maxOf(e), weight: g ? g.weight : 1, hidden: g ? g.hidden : false, date: e.opens_at.slice(0, 10), period: (g && g.period) || e.period || null }; }),
        ...S.gi.filter((g) => g.class_id === cid && g.subject_id === sid && g.src_kind === 'manual').map((g) => ({ key: 'm' + g.id, kind: 'manual', src_id: null, item_id: g.id, title: g.title, category: g.category, max: g.max_score, weight: g.weight, hidden: g.hidden, date: g.item_date, period: g.period || null }))]
        .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
    }
    function gbScores(cid, sid, stu) {
      const S = M(), o = {};
      S.hs.forEach((s) => { const h = S.hw.find((x) => x.id === s.hw_id); if (s.student_id === stu && s.status === 'graded' && s.score != null && h.class_ids.includes(cid) && h.subject_id === sid) o['hw' + h.id] = s.score; });
      S.ea.forEach((a) => { const e = S.ex.find((x) => x.id === a.exam_id); if (a.student_id === stu && a.submitted_at && a.score != null && e.class_ids.includes(cid) && e.subject_id === sid) o['ex' + e.id] = a.score; });
      S.gs.forEach((s) => { const g = S.gi.find((x) => x.id === s.item_id); if (s.student_id === stu && g.class_id === cid && g.subject_id === sid) o['m' + g.id] = s.score; });
      return o;
    }
    const gbPct = (cols, sc) => { let n = 0, w = 0; cols.forEach((c) => { if (!c.hidden && c.weight > 0 && sc[c.key] != null) { n += c.weight * sc[c.key] / c.max; w += +c.weight; } }); return w ? rnum(n / w * 100, 1) : null; };

    // ---------- ملف الإنجاز ----------
    const pfStaff = (sid) => { if (!isStaff()) return false; const s = DB.students.find((x) => x.profile_id === sid); if (!s) return false;
      if (isLeader()) return true; if (MYROLE() === 'principal') return grade(s.grade_id).stage_id === myStage();
      return DB.teaching_assignments.some((t) => t.class_id === s.class_id && (t.teacher_id === ME_ID || (MYROLE() === 'supervisor' && DB.supervision.some((x) => x.supervisor_id === ME_ID && x.teacher_id === t.teacher_id))))
        || klass(s.class_id).homeroom_teacher_id === ME_ID; };
    const pfCard = (i) => ({ id: i.id, student_id: i.student_id, kind: i.kind, title: i.title, description: i.description, date: i.item_date, level: i.level, result: i.result, links: i.links, status: i.status,
      review_note: i.review_note, created_at: i.created_at, added_by: i.added_by ? name(i.added_by) : null, self_added: i.added_by === i.student_id, reviewed_by: i.reviewed_by ? name(i.reviewed_by) : null });
    const pfOf = (id) => M().pf.find((i) => i.id === +id) || deny('غير موجود');
    const KINDS = ['project', 'competition', 'award', 'certificate', 'volunteer', 'reading', 'talent', 'other'], LEVELS = ['class', 'school', 'district', 'national', 'international'];

    const cpCan = (cid, sid) => isLeader() || myCid() === cid || DB.teaching_assignments.some((t) => t.class_id === cid && t.subject_id === sid && (t.teacher_id === ME_ID || reviewer(t.teacher_id)));

    return {
      // ===== تحضير الدروس =====
      lp_options: () => options(),
      lp_list({ p_box = 'mine', p_from, p_to, p_teacher, p_status }) {
        if (!isStaff()) deny();
        return M().lp.filter((l) => (!p_from || l.lesson_date >= p_from) && (!p_to || l.lesson_date <= p_to) && (!p_status || l.status === p_status)
          && (p_box === 'mine' ? l.teacher_id === ME_ID : p_box === 'review' ? l.status === 'submitted' && canApprove(l.teacher_id) : (!p_teacher || l.teacher_id === p_teacher) && l.status !== 'draft' && reviewer(l.teacher_id)))
          .sort((a, b) => b.lesson_date.localeCompare(a.lesson_date) || b.id - a.id).map(lpCard);
      },
      lp_get({ p_id }) { const l = lpOf(p_id), mine = l.teacher_id === ME_ID, rev = reviewer(l.teacher_id);
        if (!mine && !(rev && l.status !== 'draft')) deny();
        return Object.assign(lpCard(l), { content: l.content, class_ids: l.class_ids, can_edit: mine && ['draft', 'returned'].includes(l.status), can_review: canApprove(l.teacher_id) && l.status === 'submitted', mine }); },
      lp_save({ p }) { if (!isStaff()) deny(); const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب عنوان الدرس'); if (!p.date) deny('اختر تاريخ الدرس');
        const cls = [...new Set((p.class_ids || []).map(Number))], sid = p.subject_id ? +p.subject_id : null; checkMine(cls, sid);
        if (p.id) { const l = lpOf(p.id); if (l.teacher_id !== ME_ID || !['draft', 'returned'].includes(l.status)) deny('لا يمكن تعديل هذا التحضير (أُرسل للاعتماد أو اعتُمد)');
          Object.assign(l, { subject_id: sid, class_ids: cls, lesson_date: p.date, title: ttl.slice(0, 200), content: p.content || {}, updated_at: iso(now()) }); save(); return { ok: true, id: l.id }; }
        const l = { id: nid('lp'), teacher_id: ME_ID, subject_id: sid, class_ids: cls, lesson_date: p.date, title: ttl.slice(0, 200), content: p.content || {}, status: 'draft', submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, created_at: iso(now()), updated_at: iso(now()) };
        M().lp.push(l); save(); return { ok: true, id: l.id }; },
      lp_submit({ p_id }) { const l = lpOf(p_id); if (l.teacher_id !== ME_ID || !['draft', 'returned'].includes(l.status)) deny('لا يمكن إرسال هذا التحضير'); Object.assign(l, { status: 'submitted', submitted_at: iso(now()) }); save(); return { ok: true }; },
      lp_unsubmit({ p_id }) { const l = lpOf(p_id); if (l.teacher_id !== ME_ID || l.status !== 'submitted') deny('لا يمكن سحب هذا التحضير'); l.status = 'draft'; save(); return { ok: true }; },
      // ---- اعتماد التدريب وشهاداته (sql/43) ----
      trn_list({ p_pid, p_from, p_to }) {
        let L = DB.training.filter((t) => (!p_pid || t.pid === p_pid) && (!p_from || (t.end || t.start) >= p_from) && (!p_to || t.start <= p_to));
        if (!p_pid && !isSuper()) L = L.filter((t) => t.pid === ME_ID);
        return { rows: L.map((t) => Object.assign(trnItem(t), { can_review: canApprove(t.pid) })), can_all: isSuper() };
      },
      trn_save({ p }) { if (!String(p.title || '').trim()) deny('اكتب اسم البرنامج التدريبي');
        const row = { title: p.title, provider: p.provider, presenter: p.presenter || null, mode: p.mode, start: p.start_date || null, end: p.end_date || null, hours: Number(p.hours) || 0, self_rating: Number(p.self_rating) || null, self_note: p.self_note || '', status: 'pending' };
        if (p.id) { const t = DB.training.find((x) => x.id === p.id && x.pid === ME_ID); if (!t) deny(); if (t.status === 'approved') deny('لا يمكن تعديل تدريب معتمد — تواصل مع مشرفك'); Object.assign(t, row); }
        else DB.training.push(Object.assign({ id: Math.max(0, ...DB.training.map((t) => t.id)) + 1, pid: ME_ID, certificate: null, impact_rating: null, impact_note: '', impact_by: null }, row));
        save(); return { ok: true }; },
      trn_delete({ p_id }) { const t = DB.training.find((x) => x.id === p_id); if (!t || !((t.pid === ME_ID && t.status !== 'approved') || MYROLE() === 'admin')) deny('لا يمكن حذف تدريب معتمد');
        DB.training = DB.training.filter((x) => x.id !== p_id); save(); return { ok: true }; },
      trn_review({ p_id, p_action, p_note, p_cert }) { const t = DB.training.find((x) => x.id === p_id); if (!t) deny('غير موجود');
        if (!canApprove(t.pid)) deny('اعتماد التدريب لمشرف المعلم (أو مدير مرحلته إن لم يكن له مشرف)');
        if (p_action === 'return') { if (!String(p_note || '').trim()) deny('اكتب سبب الإعادة للمعلم'); if (t.cert_no) deny('صدرت شهادة لهذا التدريب ولا يمكن إعادته');
          Object.assign(t, { status: 'returned', review_by: ME_ID, review_at: iso(now()), review_note: p_note.trim() }); save(); return { ok: true }; }
        if (!(Number(t.hours) > 0)) deny('حدّد عدد ساعات التدريب قبل الاعتماد');
        Object.assign(t, { status: 'approved', review_by: ME_ID, review_at: iso(now()), review_note: (p_note || '').trim() || null });
        if (p_cert) trnIssue(t); save(); return { ok: true, cert_no: t.cert_no || null }; },
      trn_cert_issue({ p_id }) { const t = DB.training.find((x) => x.id === p_id); if (!t || !canApprove(t.pid)) deny(); if (t.status !== 'approved') deny('اعتمد التدريب أولًا');
        trnIssue(t); save(); return { ok: true, cert_no: t.cert_no }; },
      trn_cert({ p_id }) { const t = DB.training.find((x) => x.id === p_id); if (!t || !t.cert_no) deny('لا توجد شهادة صادرة لهذا التدريب');
        if (!(t.pid === ME_ID || isSuper() || canApprove(t.pid))) deny(); const S = (k) => (DB.app_settings.find((x) => x.key === k) || {}).value || '';
        return { cert_no: t.cert_no, issued_at: t.cert_issued_at, name: name(t.pid), job: (P(t.pid) || {}).job_title || null, title: t.title, provider: t.provider, presenter: t.presenter, mode: t.mode,
          start: t.start, end: t.end, hours: t.hours, approved_by: t.review_by ? name(t.review_by) : null, school: S('school_name'),
          edu_title: S('cert_edu_title') || 'مدير التعليم', edu_name: S('cert_edu_name'), exec_title: S('cert_exec_title') || 'المدير التنفيذي', exec_name: S('cert_exec_name') }; },
      trn_verify({ p_no }) { const t = DB.training.find((x) => x.cert_no && x.cert_no === String(p_no || '').trim().toUpperCase() && x.status === 'approved');
        return t ? { valid: true, name: name(t.pid), title: t.title, hours: t.hours, issued_at: t.cert_issued_at, start: t.start, end: t.end } : { valid: false }; },
      lp_review({ p_id, p_decision, p_note }) { const l = lpOf(p_id); if (l.status !== 'submitted' || !canApprove(l.teacher_id)) deny('اعتماد التحضير للمشرف التربوي فقط');
        if (p_decision === 'return' && !String(p_note || '').trim()) deny('اكتب ملاحظاتك للمعلم عند الإعادة');
        Object.assign(l, { status: p_decision === 'approve' ? 'approved' : 'returned', reviewed_by: ME_ID, reviewed_at: iso(now()), review_note: String(p_note || '').trim() || null }); save(); return { ok: true }; },
      lp_delete({ p_id }) { const l = lpOf(p_id); if (l.teacher_id !== ME_ID || !['draft', 'returned'].includes(l.status)) deny('لا يمكن حذف هذا التحضير'); M().lp = M().lp.filter((x) => x !== l); save(); return { ok: true }; },
      lp_copy({ p_id, p_date }) { const l = lpOf(p_id); if (l.teacher_id !== ME_ID) deny(); const n = Object.assign(clone(l), { id: nid('lp'), lesson_date: p_date || l.lesson_date, status: 'draft', submitted_at: null, reviewed_by: null, reviewed_at: null, review_note: null, created_at: iso(now()) });
        M().lp.push(n); save(); return { ok: true, id: n.id }; },

      // ===== الواجبات =====
      hw_options: () => options(),
      hw_list({ p_box = 'mine' }) { const S = M();
        if (p_box === 'student') { const cid = myCid(); if (!cid) return [];
          return S.hw.filter((h) => h.class_ids.includes(cid)).sort((a, b) => b.due_at.localeCompare(a.due_at)).map((h) => { const s = subOf(h.id, ME_ID) || {};
            return Object.assign(hwCard(h), { my_status: s.status || null, my_score: s.score ?? null, my_late: s.late ?? null, submitted_at: s.submitted_at || null }); }); }
        if (!isStaff()) deny();
        return S.hw.filter((h) => (p_box === 'mine' ? h.teacher_id === ME_ID : reviewer(h.teacher_id))).sort((a, b) => b.due_at.localeCompare(a.due_at)).map((h) => { const sub = S.hs.filter((s) => s.hw_id === h.id), gr = sub.filter((s) => s.status === 'graded');
          return Object.assign(hwCard(h), { students: stuIn(h.class_ids).length, submitted: sub.length, graded: gr.length, avg: gr.length ? Math.round(avg(gr.map((s) => s.score / h.max_score * 100))) : null }); }); },
      hw_get({ p_id }) { const h = hwOf(p_id), mine = h.teacher_id === ME_ID, rev = reviewer(h.teacher_id), cid = myCid();
        if (mine || rev) return Object.assign(hwCard(h), { instructions: h.instructions, links: h.links, class_ids: h.class_ids, mine, can_edit: mine,
          roster: stuIn(h.class_ids).sort((a, b) => csort(a.class_id, b.class_id) || name(a.profile_id).localeCompare(name(b.profile_id), 'ar')).map((st) => { const s = subOf(h.id, st.profile_id);
            return { student: st.profile_id, name: name(st.profile_id), class: klass(st.class_id).name, no: st.student_number, sub: s ? { id: s.id, body: s.body, links: s.links, at: s.submitted_at, late: s.late, status: s.status, score: s.score, feedback: s.feedback } : null }; }) });
        if (cid && h.class_ids.includes(cid)) { const s = subOf(h.id, ME_ID);
          return Object.assign(hwCard(h), { instructions: h.instructions, links: h.links, student_view: true, can_submit: !h.closed && (h.allow_late || now() <= new Date(h.due_at)) && (!s || s.status !== 'graded'),
            sub: s ? { body: s.body, links: s.links, at: s.submitted_at, late: s.late, status: s.status, score: s.score, feedback: s.feedback } : null }); }
        deny(); },
      hw_save({ p }) { if (!isStaff()) deny(); const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب عنوان الواجب'); if (!p.due_at) deny('حدّد موعد التسليم');
        const cls = [...new Set((p.class_ids || []).map(Number))]; if (!cls.length) deny('اختر فصلًا واحدًا على الأقل'); const sid = p.subject_id ? +p.subject_id : null; checkMine(cls, sid);
        const v = { subject_id: sid, class_ids: cls, title: ttl.slice(0, 200), instructions: String(p.instructions || '').trim() || null, links: cleanLinks(p.links), due_at: iso(p.due_at), max_score: +p.max_score || 10, allow_late: p.allow_late !== false, period: p.period || null, updated_at: iso(now()) };
        if (p.id) { const h = hwOf(p.id); if (h.teacher_id !== ME_ID) deny(); Object.assign(h, v); save(); return { ok: true, id: h.id }; }
        const h = Object.assign({ id: nid('hw'), teacher_id: ME_ID, closed: false, created_at: iso(now()) }, v); M().hw.push(h); save(); return { ok: true, id: h.id }; },
      hw_close({ p_id, p_closed }) { const h = hwOf(p_id); if (h.teacher_id !== ME_ID) deny(); h.closed = p_closed !== false; save(); return { ok: true }; },
      hw_delete({ p_id }) { const h = hwOf(p_id); if (M().hs.some((s) => s.hw_id === h.id && s.status === 'graded')) deny('لا يمكن حذف واجب فيه تسليمات مصحّحة — أغلقه بدلًا من ذلك'); if (h.teacher_id !== ME_ID) deny();
        M().hw = M().hw.filter((x) => x !== h); M().hs = M().hs.filter((s) => s.hw_id !== h.id); save(); return { ok: true }; },
      hw_submit({ p_id, p_body, p_links }) { const h = hwOf(p_id), cid = myCid(); if (!cid || !h.class_ids.includes(cid)) deny(); if (h.closed) deny('أُغلق هذا الواجب');
        const late = now() > new Date(h.due_at); if (late && !h.allow_late) deny('انتهى موعد التسليم'); const lk = cleanLinks(p_links); if (!String(p_body || '').trim() && !lk.length) deny('اكتب إجابتك أو أضف رابطًا');
        let s = subOf(h.id, ME_ID); if (s && s.status === 'graded') deny('صُحّح تسليمك، لا يمكن تعديله');
        if (!s) { s = { id: nid('hs'), hw_id: h.id, student_id: ME_ID, feedback: null }; M().hs.push(s); }
        Object.assign(s, { body: String(p_body || '').trim() || null, links: lk, submitted_at: iso(now()), late, status: 'submitted', score: null }); save(); return { ok: true }; },
      hw_grade({ p_id, p_student, p_action, p_score, p_feedback }) { const h = hwOf(p_id); if (h.teacher_id !== ME_ID) deny(); let s = subOf(h.id, p_student);
        if (p_action === 'grade') { if (p_score == null || p_score < 0 || p_score > h.max_score) deny('الدرجة يجب أن تكون بين 0 و ' + h.max_score);
          if (!s) { s = { id: nid('hs'), hw_id: h.id, student_id: p_student, body: null, links: [], submitted_at: iso(now()), late: false }; M().hs.push(s); }
          Object.assign(s, { status: 'graded', score: +p_score, feedback: String(p_feedback || '').trim() || null }); }
        else { if (!String(p_feedback || '').trim()) deny('اكتب ملاحظتك للطالب عند الإعادة'); if (!s) deny('لا يوجد تسليم لإعادته'); Object.assign(s, { status: 'returned', score: null, feedback: String(p_feedback).trim() }); }
        save(); return { ok: true }; },

      // ===== صفحات المواد =====
      cp_courses() { const cid = myCid(), by = {};
        DB.teaching_assignments.filter((t) => t.teacher_id === ME_ID || t.class_id === cid || (isStaff() && reviewer(t.teacher_id))).forEach((t) => { const k = t.class_id + '-' + t.subject_id;
          const o = by[k] = by[k] || { class_id: t.class_id, subject_id: t.subject_id, teachers: new Set(), mine: false }; o.teachers.add(name(t.teacher_id)); o.mine = o.mine || t.teacher_id === ME_ID; });
        return Object.values(by).sort((a, b) => b.mine - a.mine || csort(a.class_id, b.class_id) || sname(a.subject_id).localeCompare(sname(b.subject_id), 'ar')).map((o) => { const P2 = M().cp.filter((p) => p.subject_id === o.subject_id && p.class_ids.includes(o.class_id));
          return { class_id: o.class_id, subject_id: o.subject_id, subject: sname(o.subject_id), class: lbl(o.class_id), teachers: [...o.teachers], mine: o.mine, posts: P2.length, last_at: P2.length ? P2.map((p) => p.created_at).sort().pop() : null }; }); },
      cp_list({ p_class, p_subject }) { if (!cpCan(p_class, p_subject)) deny();
        return { can_post: teaches(p_class, p_subject), posts: M().cp.filter((p) => p.subject_id === p_subject && p.class_ids.includes(p_class))
          .sort((a, b) => b.pinned - a.pinned || (b.week_start || b.created_at.slice(0, 10)).localeCompare(a.week_start || a.created_at.slice(0, 10)) || b.created_at.localeCompare(a.created_at))
          .map((p) => ({ id: p.id, kind: p.kind, title: p.title, body: p.body, links: p.links, week: p.week_start, pinned: p.pinned, at: p.created_at, updated: p.updated_at, class_ids: p.class_ids, teacher: name(p.teacher_id), mine: p.teacher_id === ME_ID })) }; },
      cp_save({ p }) { if (!isStaff()) deny(); const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب عنوان المنشور'); const sid = +p.subject_id; if (!sid) deny('المادة مطلوبة');
        const cls = [...new Set((p.class_ids || []).map(Number))]; if (!cls.length) deny('اختر فصلًا واحدًا على الأقل'); if (cls.some((c) => !teaches(c, sid))) deny('اختر من فصولك التي تدرّس لها هذه المادة فقط');
        const v = { class_ids: cls, kind: p.kind === 'announcement' ? 'announcement' : 'content', title: ttl.slice(0, 200), body: String(p.body || '').trim() || null, links: cleanLinks(p.links), week_start: p.week || null, pinned: !!p.pinned, updated_at: iso(now()) };
        if (p.id) { const x = M().cp.find((c) => c.id === +p.id); if (!x || x.teacher_id !== ME_ID) deny(); Object.assign(x, v); save(); return { ok: true, id: x.id }; }
        const x = Object.assign({ id: nid('cp'), teacher_id: ME_ID, subject_id: sid, created_at: iso(now()) }, v); M().cp.push(x); save(); return { ok: true, id: x.id }; },
      cp_delete({ p_id }) { const x = M().cp.find((c) => c.id === +p_id); if (!x || x.teacher_id !== ME_ID) deny(); M().cp = M().cp.filter((c) => c !== x); save(); return { ok: true }; },

      // ===== بنك الأسئلة والاختبارات =====
      qb_list({ p_subject, p_grade }) { if (!isStaff() || !qbCan(p_subject)) deny();
        return M().qb.filter((q) => q.subject_id === p_subject && (!p_grade || !q.grade_num || q.grade_num === p_grade)).sort((a, b) => (b.owner_id === ME_ID) - (a.owner_id === ME_ID) || b.created_at.localeCompare(a.created_at))
          .map((q) => ({ id: q.id, qtype: q.qtype, body: q.body, options: q.options, answer: q.answer, points: q.points, topic: q.topic, grade: q.grade_num, image: q.image || null, mine: q.owner_id === ME_ID, owner: name(q.owner_id),
            used: M().ex.filter((e) => e.questions.some((x) => x.id === String(q.id))).length })); },
      qb_save({ p }) { if (!isStaff()) deny(); const sid = +p.subject_id; if (!sid || !myTA().some((t) => t.subject_id === sid)) deny('اختر مادة من موادك المسندة إليك');
        if (!['mcq', 'tf', 'short', 'match'].includes(p.qtype)) deny('نوع السؤال غير صالح');
        if (p.image && (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(p.image) || p.image.length > 450000)) deny('الصورة غير صالحة أو كبيرة جدًا'); const b = String(p.body || '').trim(); if (!b) deny('اكتب نص السؤال');
        let opts = [];
        if (p.qtype === 'mcq') { opts = (p.options || []).filter((o) => String(o.t || '').trim()).map((o) => ({ t: String(o.t).trim().slice(0, 500), ok: !!o.ok }));
          if (opts.length < 2 || opts.length > 8) deny('الاختيار من متعدد يحتاج من 2 إلى 8 خيارات'); if (opts.filter((o) => o.ok).length !== 1) deny('حدّد إجابة صحيحة واحدة'); }
        else if (p.qtype === 'tf') { const t = p.tf !== false; opts = [{ t: 'صح', ok: t }, { t: 'خطأ', ok: !t }]; }
        else if (p.qtype === 'match') { opts = (p.pairs || []).filter((o) => String(o.l || '').trim() && String(o.r || '').trim()).map((o) => ({ l: String(o.l).trim(), r: String(o.r).trim() }));
          if (opts.length < 2 || opts.length > 8) deny('المزاوجة تحتاج من 2 إلى 8 أزواج مكتملة'); }
        const v = { subject_id: sid, grade_num: p.grade || null, qtype: p.qtype, body: b, options: opts, answer: String(p.answer || '').trim() || null, points: +p.points || 1, topic: String(p.topic || '').trim() || null, image: p.image || null };
        if (p.id) { const q = M().qb.find((x) => x.id === +p.id); if (!q || q.owner_id !== ME_ID) deny('لا يمكنك تعديل سؤال زميل — يمكنك استخدامه فقط'); Object.assign(q, v); save(); return { ok: true, id: q.id }; }
        const q = Object.assign({ id: nid('qb'), owner_id: ME_ID, created_at: iso(now()) }, v); M().qb.push(q); save(); return { ok: true, id: q.id }; },
      qb_delete({ p_id }) { const q = M().qb.find((x) => x.id === +p_id); if (!q || q.owner_id !== ME_ID) deny(); M().qb = M().qb.filter((x) => x !== q); save(); return { ok: true }; },
      ex_save({ p }) { if (!isStaff()) deny(); const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب عنوان الاختبار');
        const op = new Date(p.opens_at), cl = new Date(p.closes_at); if (!p.opens_at || !p.closes_at || cl <= op) deny('حدّد وقت الفتح والإغلاق بشكل صحيح');
        const sid = p.subject_id ? +p.subject_id : null, cls = [...new Set((p.class_ids || []).map(Number))]; if (!cls.length) deny('اختر فصلًا واحدًا على الأقل'); if (cls.some((c) => !teaches(c, sid))) deny('اختر من فصولك التي تدرّس لها هذه المادة فقط');
        const qs = (p.questions || []).map((x) => { const q = M().qb.find((y) => y.id === +x.id && y.subject_id === sid); return q && { id: String(q.id), qtype: q.qtype, body: q.body, options: clone(q.options), answer: q.answer, image: q.image || null, points: x.points ? +x.points : q.points }; }).filter(Boolean);
        if (p.id) { const e = exOf(p.id); if (e.teacher_id !== ME_ID) deny();
          if (M().ea.some((a) => a.exam_id === e.id)) Object.assign(e, { title: ttl.slice(0, 200), instructions: String(p.instructions || '').trim() || null, closes_at: iso(cl), show_results: p.show_results !== false, period: p.period || null });
          else { if (!qs.length) deny('أضف سؤالًا واحدًا على الأقل من بنك الأسئلة'); Object.assign(e, { subject_id: sid, class_ids: cls, title: ttl.slice(0, 200), instructions: String(p.instructions || '').trim() || null, questions: qs, opens_at: iso(op), closes_at: iso(cl), duration_min: +p.duration_min || 30, shuffle: p.shuffle !== false, show_results: p.show_results !== false, period: p.period || null }); }
          save(); return { ok: true, id: e.id }; }
        if (!qs.length) deny('أضف سؤالًا واحدًا على الأقل من بنك الأسئلة');
        const e = { id: nid('ex'), teacher_id: ME_ID, subject_id: sid, class_ids: cls, title: ttl.slice(0, 200), instructions: String(p.instructions || '').trim() || null, questions: qs, opens_at: iso(op), closes_at: iso(cl), duration_min: +p.duration_min || 30, shuffle: p.shuffle !== false, show_results: p.show_results !== false, period: p.period || null, created_at: iso(now()) };
        M().ex.push(e); save(); return { ok: true, id: e.id }; },
      ex_delete({ p_id }) { const e = exOf(p_id); if (M().ea.some((a) => a.exam_id === e.id && a.submitted_at)) deny('لا يمكن حذف اختبار سلّمه طلاب — غيّر موعد إغلاقه بدلًا من ذلك'); if (e.teacher_id !== ME_ID) deny();
        M().ex = M().ex.filter((x) => x !== e); M().ea = M().ea.filter((a) => a.exam_id !== e.id); save(); return { ok: true }; },
      ex_list({ p_box = 'mine' }) { const S = M();
        if (p_box === 'student') { const cid = myCid(); if (!cid) return [];
          return S.ex.filter((e) => e.class_ids.includes(cid)).sort((a, b) => b.opens_at.localeCompare(a.opens_at)).map((e) => { const a = attOf(e.id, ME_ID);
            return Object.assign(exCard(e), { my: a ? { started: a.started_at, submitted: a.submitted_at, deadline: a.deadline, score: e.show_results ? a.score : null, needs_review: a.needs_review } : null }); }); }
        if (!isStaff()) deny();
        return S.ex.filter((e) => (p_box === 'mine' ? e.teacher_id === ME_ID : reviewer(e.teacher_id))).sort((a, b) => b.opens_at.localeCompare(a.opens_at)).map((e) => { const A = S.ea.filter((a) => a.exam_id === e.id), sub = A.filter((a) => a.submitted_at);
          return Object.assign(exCard(e), { students: stuIn(e.class_ids).length, submitted: sub.length, review: A.filter((a) => a.needs_review).length, avg: sub.length ? Math.round(avg(sub.map((a) => a.score / a.max_score * 100))) : null }); }); },
      ex_get({ p_id }) { const e = exOf(p_id), mine = e.teacher_id === ME_ID; if (!mine && !reviewer(e.teacher_id)) deny();
        return Object.assign(exCard(e), { instructions: e.instructions, questions: e.questions, class_ids: e.class_ids, shuffle: e.shuffle, mine, locked: M().ea.some((a) => a.exam_id === e.id),
          attempts: stuIn(e.class_ids).sort((a, b) => csort(a.class_id, b.class_id) || name(a.profile_id).localeCompare(name(b.profile_id), 'ar')).map((st) => { const a = attOf(e.id, st.profile_id) || {};
            return { id: a.id || null, student: st.profile_id, name: name(st.profile_id), class: klass(st.class_id).name, started: a.started_at || null, submitted: a.submitted_at || null, score: a.score ?? null, max: a.max_score ?? null,
              needs_review: !!a.needs_review, answers: a.answers || null, results: a.results || null }; }) }); },
      ex_start({ p_id }) { const e = exOf(p_id), cid = myCid(); if (!cid || !e.class_ids.includes(cid)) deny(); let a = attOf(e.id, ME_ID);
        if (a && a.submitted_at) deny('سلّمت هذا الاختبار من قبل');
        if (!a) { if (now() < new Date(e.opens_at)) deny('لم يُفتح الاختبار بعد'); if (now() > new Date(e.closes_at)) deny('انتهى وقت الاختبار');
          const ord = (e.shuffle ? shuffle(e.questions) : e.questions).map((q) => ({ id: q.id, opts: ['mcq', 'match'].includes(q.qtype) ? (e.shuffle || q.qtype === 'match' ? shuffle(q.options.map((_, i) => i)) : q.options.map((_, i) => i)) : [] }));
          a = { id: nid('ea'), exam_id: e.id, student_id: ME_ID, started_at: iso(now()), deadline: iso(Math.min(new Date(e.closes_at), Date.now() + e.duration_min * 60e3)), submitted_at: null, q_order: ord, answers: {}, results: {}, score: null, max_score: maxOf(e), needs_review: false };
          M().ea.push(a); save(); }
        return { attempt: a.id, title: e.title, instructions: e.instructions, deadline: a.deadline, now: iso(now()), answers: a.answers,
          questions: a.q_order.map((o) => { const q = e.questions.find((x) => x.id === o.id);
            if (q.qtype === 'match') return { id: q.id, qtype: q.qtype, body: q.body, points: q.points, image: q.image || null, left: q.options.map((x, k) => ({ k, t: x.l })), options: o.opts.map((pi, j) => ({ i: j, t: q.options[pi].r })) };
            return { id: q.id, qtype: q.qtype, body: q.body, points: q.points, image: q.image || null, options: q.qtype === 'mcq' ? o.opts.map((i) => ({ i, t: q.options[i].t })) : q.qtype === 'tf' ? [0, 1].map((i) => ({ i, t: q.options[i].t })) : [] }; }) }; },
      ex_submit({ p_id, p_answers, p_final = true }) { const e = exOf(p_id), a = attOf(e.id, ME_ID); if (!a) deny('ابدأ الاختبار أولًا'); if (a.submitted_at) deny('سلّمت هذا الاختبار من قبل');
        let ans = p_answers || {}; if (Date.now() > new Date(a.deadline).getTime() + 60e3) { ans = a.answers; p_final = true; }
        if (!p_final) { a.answers = ans; save(); return { ok: true, saved: true }; }
        const res = {}; let tot = 0, rev = false;
        e.questions.forEach((q) => { const v = String(ans[q.id] ?? '').trim();
          if (q.qtype === 'match') { const ord = (a.q_order.find((o) => o.id === q.id) || {}).opts || [], np = q.options.length;
            const nc = Math.min(np, v.split(',').filter((kv) => /^\d+:\d+$/.test(kv) && String(ord[+kv.split(':')[1]]) === kv.split(':')[0]).length);
            const pts = Math.round(q.points * nc / np * 100) / 100; res[q.id] = { pts, ok: nc === np, nc, np }; tot += pts; }
          else if (q.qtype !== 'short') { const ok = v !== '' && +v === q.options.findIndex((o) => o.ok); res[q.id] = { pts: ok ? q.points : 0, ok }; if (ok) tot += q.points; }
          else if (q.answer && normA(v) === normA(q.answer)) { res[q.id] = { pts: q.points, ok: true }; tot += q.points; }
          else if (!v) res[q.id] = { pts: 0, ok: false };
          else { res[q.id] = { pts: 0, ok: null, manual: true }; rev = true; } });
        Object.assign(a, { answers: ans, results: res, score: tot, submitted_at: iso(now()), needs_review: rev }); save();
        return { ok: true, score: e.show_results ? tot : null, max: a.max_score, needs_review: rev }; },
      ex_my_result({ p_id }) { const e = exOf(p_id), a = attOf(e.id, ME_ID); if (!a || !a.submitted_at) deny('لم تسلّم هذا الاختبار');
        if (!e.show_results) return { hidden: true, submitted: a.submitted_at }; const closed = now() > new Date(e.closes_at);
        return { score: a.score, max: a.max_score, needs_review: a.needs_review, submitted: a.submitted_at,
          questions: e.questions.map((q) => ({ body: q.body, qtype: q.qtype, points: q.points, image: q.image || null, mine: a.answers[q.id] ?? null, result: a.results[q.id] || null,
            options: q.qtype === 'match' ? null : q.options.map((o) => o.t), pairs: q.qtype === 'match' && closed ? q.options : null,
            correct: closed && q.qtype !== 'match' ? (q.qtype === 'short' ? q.answer : String(q.options.findIndex((o) => o.ok))) : null })) }; },
      ex_grade({ p_attempt, p_qid, p_points }) { const a = M().ea.find((x) => x.id === +p_attempt) || deny(); const e = exOf(a.exam_id); if (e.teacher_id !== ME_ID) deny();
        const q = e.questions.find((x) => x.id === String(p_qid)) || deny('السؤال غير موجود'); if (p_points < 0 || p_points > q.points) deny('الدرجة بين 0 و ' + q.points);
        a.results[q.id] = { pts: +p_points, ok: +p_points === q.points, manual: true, graded: true };
        a.score = Object.values(a.results).reduce((s, r) => s + (+r.pts || 0), 0); a.needs_review = Object.values(a.results).some((r) => r.manual && !r.graded); save(); return { ok: true }; },

      // ===== سجل الدرجات =====
      gb_sheet({ p_class, p_subject }) { if (!gbView(p_class, p_subject)) deny(); const cols = gbCols(p_class, p_subject);
        return { can_edit: gbEdit(p_class, p_subject), columns: cols, class: lbl(p_class), subject: sname(p_subject),
          students: stuIn([p_class]).sort((a, b) => name(a.profile_id).localeCompare(name(b.profile_id), 'ar')).map((s) => { const sc = gbScores(p_class, p_subject, s.profile_id); return { id: s.profile_id, name: name(s.profile_id), scores: sc, pct: gbPct(cols, sc) }; }) }; },
      gb_item_save({ p }) { const cid = +p.class_id, sid = +p.subject_id; if (!gbEdit(cid, sid)) deny(); const w = p.weight === '' || p.weight == null ? 1 : +p.weight; if (w < 0 || w > 100) deny('الوزن بين 0 و 100'); const S = M();
        if (p.kind === 'hw' || p.kind === 'ex') { if (!gbCols(cid, sid).some((c) => c.kind === p.kind && c.src_id === +p.src_id)) deny('العمود غير موجود');
          let g = S.gi.find((x) => x.class_id === cid && x.subject_id === sid && x.src_kind === p.kind && x.src_id === +p.src_id);
          if (!g) { g = { id: nid('gi'), teacher_id: ME_ID, class_id: cid, subject_id: sid, src_kind: p.kind, src_id: +p.src_id, title: null, category: 'other', max_score: null, item_date: today() }; S.gi.push(g); }
          Object.assign(g, { weight: w, hidden: !!p.hidden, period: p.period || null }); save(); return { ok: true, id: g.id }; }
        const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب اسم العمود'); if (!(+p.max_score > 0)) deny('حدّد الدرجة العظمى');
        const v = { title: ttl.slice(0, 120), category: p.category || 'other', max_score: +p.max_score, weight: w, hidden: !!p.hidden, item_date: p.date || today(), period: p.period || null };
        if (p.item_id) { const g = S.gi.find((x) => x.id === +p.item_id && x.class_id === cid && x.subject_id === sid && x.src_kind === 'manual') || deny();
          if (S.gs.some((s) => s.item_id === g.id && s.score > v.max_score)) deny('توجد درجات مرصودة أعلى من الدرجة العظمى الجديدة'); Object.assign(g, v); save(); return { ok: true, id: g.id }; }
        const g = Object.assign({ id: nid('gi'), teacher_id: ME_ID, class_id: cid, subject_id: sid, src_kind: 'manual', src_id: null }, v); S.gi.push(g); save(); return { ok: true, id: g.id }; },
      gb_item_delete({ p_id }) { const S = M(), g = S.gi.find((x) => x.id === +p_id && x.src_kind === 'manual'); if (!g || !gbEdit(g.class_id, g.subject_id)) deny();
        S.gi = S.gi.filter((x) => x !== g); S.gs = S.gs.filter((s) => s.item_id !== g.id); save(); return { ok: true }; },
      gb_scores_save({ p_item, p_rows }) { const S = M(), g = S.gi.find((x) => x.id === +p_item && x.src_kind === 'manual'); if (!g || !gbEdit(g.class_id, g.subject_id)) deny();
        (p_rows || []).forEach((r) => { if (!DB.students.some((s) => s.profile_id === r.student && s.class_id === g.class_id)) deny('طالب ليس من هذا الفصل');
          if (r.score != null && (r.score < 0 || r.score > g.max_score)) deny('الدرجة بين 0 و ' + g.max_score); });
        (p_rows || []).forEach((r) => { S.gs = S.gs.filter((s) => !(s.item_id === g.id && s.student_id === r.student)); if (r.score != null) S.gs.push({ item_id: g.id, student_id: r.student, score: +r.score, note: r.note || null }); });
        save(); return { ok: true, n: (p_rows || []).length }; },
      gb_my() { const cid = myCid(); if (!cid) return [];
        return [...new Set(DB.teaching_assignments.filter((t) => t.class_id === cid).map((t) => t.subject_id))].map((sid) => { const cols = gbCols(cid, sid).filter((c) => !c.hidden), sc = gbScores(cid, sid, ME_ID);
          return { subject_id: sid, subject: sname(sid), columns: cols.map((c) => ({ key: c.key, title: c.title, category: c.category, max: c.max, weight: c.weight, hidden: c.hidden, date: c.date, period: c.period })), scores: sc, pct: gbPct(cols, sc) }; })
          .filter((x) => x.columns.length).sort((a, b) => a.subject.localeCompare(b.subject, 'ar')); },

      // ===== التحليل والمقارنة =====
      an_overview({ p_from, p_to }) { if (!isStaff()) deny(); const S = M(), f = p_from || ymd(daysAgo(120)), t = p_to || today(), by = {};
        DB.teaching_assignments.filter((x) => x.teacher_id === ME_ID || reviewer(x.teacher_id)).forEach((x) => { const k = x.class_id + '-' + x.subject_id;
          const o = by[k] = by[k] || { class_id: x.class_id, subject_id: x.subject_id, teachers: new Set(), mine: false }; o.teachers.add(name(x.teacher_id)); o.mine = o.mine || x.teacher_id === ME_ID; });
        const inR = (d) => d.slice(0, 10) >= f && d.slice(0, 10) <= t;
        return Object.values(by).sort((a, b) => csort(a.class_id, b.class_id) || sname(a.subject_id).localeCompare(sname(b.subject_id), 'ar')).map((o) => { const c = klass(o.class_id), g = grade(c.grade_id), size = stuIn([o.class_id]).length;
          const H = S.hw.filter((h) => h.class_ids.includes(o.class_id) && h.subject_id === o.subject_id && inR(h.due_at)), E = S.ex.filter((e) => e.class_ids.includes(o.class_id) && e.subject_id === o.subject_id && inR(e.opens_at));
          const inCls = (sid) => (DB.students.find((s) => s.profile_id === sid) || {}).class_id === o.class_id;
          const hs = S.hs.filter((s) => H.some((h) => h.id === s.hw_id) && inCls(s.student_id)), ea = S.ea.filter((a) => E.some((e) => e.id === a.exam_id) && a.submitted_at && inCls(a.student_id));
          const hg = hs.filter((s) => s.status === 'graded' && s.score != null);
          return { class_id: o.class_id, subject_id: o.subject_id, class: lbl(o.class_id), stage: g.stage_id, grade: g.number, subject: sname(o.subject_id), teachers: [...o.teachers], mine: o.mine, size,
            hw_n: H.length, hw_rate: H.length && size ? Math.round(100 * hs.length / (H.length * size)) : null, hw_avg: rnum(avg(hg.map((s) => s.score / S.hw.find((h) => h.id === s.hw_id).max_score * 100)), 1),
            ex_n: E.length, ex_rate: E.length && size ? Math.round(100 * ea.length / (E.length * size)) : null, ex_avg: rnum(avg(ea.map((a) => a.score / a.max_score * 100)), 1) }; }); },
      an_questions({ p_subject, p_from, p_to }) { if (!isStaff()) deny(); const S = M(), f = p_from || ymd(daysAgo(120)), t = p_to || today(), out = [];
        S.ex.filter((e) => e.subject_id === p_subject && e.opens_at.slice(0, 10) >= f && e.opens_at.slice(0, 10) <= t && (e.teacher_id === ME_ID || reviewer(e.teacher_id))).forEach((e) => {
          const A = S.ea.filter((a) => a.exam_id === e.id && a.submitted_at);
          e.questions.forEach((q) => { const R = A.map((a) => a.results[q.id]).filter(Boolean); if (R.length >= 3) out.push({ exam: e.title, exam_id: e.id, teacher: name(e.teacher_id), body: q.body, qtype: q.qtype, n: R.length, rate: Math.round(100 * R.filter((r) => r.ok).length / R.length) }); }); });
        return out.sort((a, b) => a.rate - b.rate || b.n - a.n).slice(0, 40); },

      // ===== ملف إنجاز الطالب =====
      pf_get({ p_student }) { const sid = p_student || ME_ID, s = DB.students.find((x) => x.profile_id === sid) || deny('الطالب غير موجود'), staff = pfStaff(sid);
        if (!(sid === ME_ID || staff)) deny(); const g = grade(s.grade_id);
        return { student: { id: sid, name: name(sid), class: s.class_id ? lbl(s.class_id) : null, grade: g.name_ar + ' ' + stage(g.stage_id).name_ar }, can_add: sid === ME_ID || staff, can_review: staff, is_self: sid === ME_ID,
          items: M().pf.filter((i) => i.student_id === sid && (sid === ME_ID || staff || i.status === 'approved')).sort((a, b) => b.item_date.localeCompare(a.item_date) || b.id - a.id).map(pfCard),
          exams: M().ea.filter((a) => a.student_id === sid && a.submitted_at).map((a) => ({ a, e: exOf(a.exam_id) })).filter(({ e }) => staff || e.show_results).sort((x, y) => y.e.opens_at.localeCompare(x.e.opens_at))
            .map(({ a, e }) => ({ title: e.title, subject: sname(e.subject_id), date: e.opens_at.slice(0, 10), score: a.score, max: a.max_score, review: a.needs_review })),
          homework: M().hs.filter((x) => x.student_id === sid && x.status === 'graded' && x.score != null).map((x) => ({ x, h: hwOf(x.hw_id) })).sort((p1, p2) => p2.h.due_at.localeCompare(p1.h.due_at))
            .map(({ x, h }) => ({ title: h.title, subject: sname(h.subject_id), date: h.due_at.slice(0, 10), score: x.score, max: h.max_score, feedback: x.feedback })) }; },
      pf_save({ p }) { let sid = p.student_id || ME_ID, i = null; if (p.id) { i = pfOf(p.id); sid = i.student_id; } const staff = pfStaff(sid);
        if (!(staff || (sid === ME_ID && MYROLE() === 'student'))) deny();
        if (i && !staff && (i.added_by !== ME_ID || i.status === 'approved')) deny('لا يمكن تعديل إنجاز معتمد — تواصل مع معلمك');
        const ttl = String(p.title || '').trim(); if (!ttl) deny('اكتب عنوان الإنجاز'); if (!KINDS.includes(p.kind)) deny('اختر نوع الإنجاز'); if (p.level && !LEVELS.includes(p.level)) deny('مستوى غير صالح');
        const v = { kind: p.kind, title: ttl.slice(0, 200), description: String(p.description || '').trim() || null, item_date: p.date || today(), level: p.level || null, result: String(p.result || '').trim() || null, links: cleanLinks(p.links) };
        const direct = staff && sid !== ME_ID;
        if (i) { Object.assign(i, v, { status: direct ? i.status : 'pending' }); save(); return { ok: true, id: i.id }; }
        i = Object.assign({ id: nid('pf'), student_id: sid, status: direct ? 'approved' : 'pending', added_by: ME_ID, reviewed_by: direct ? ME_ID : null, reviewed_at: direct ? iso(now()) : null, review_note: null, created_at: iso(now()) }, v);
        M().pf.push(i); save(); return { ok: true, id: i.id }; },
      pf_delete({ p_id }) { const i = pfOf(p_id); if (!(pfStaff(i.student_id) || (i.student_id === ME_ID && i.added_by === ME_ID && i.status !== 'approved'))) deny();
        M().pf = M().pf.filter((x) => x !== i); save(); return { ok: true }; },
      pf_review({ p_id, p_action, p_note }) { const i = pfOf(p_id); if (!pfStaff(i.student_id) || i.student_id === ME_ID) deny(); if (!['approve', 'reject'].includes(p_action)) deny('إجراء غير صالح');
        if (p_action === 'reject' && !String(p_note || '').trim()) deny('اكتب سبب عدم الاعتماد للطالب');
        Object.assign(i, { status: p_action === 'approve' ? 'approved' : 'rejected', reviewed_by: ME_ID, reviewed_at: iso(now()), review_note: String(p_note || '').trim() || null }); save(); return { ok: true }; },
      pf_feed({ p_status, p_kind }) { if (!isStaff()) deny();
        return M().pf.filter((i) => (!p_status || i.status === p_status) && (!p_kind || i.kind === p_kind) && pfStaff(i.student_id)).sort((a, b) => b.created_at.localeCompare(a.created_at))
          .map((i) => { const s = DB.students.find((x) => x.profile_id === i.student_id); return Object.assign(pfCard(i), { student: name(i.student_id), class: s.class_id ? lbl(s.class_id) : null }); }); },
      pf_find({ p_q }) { if (!isStaff()) deny(); const q = norm(String(p_q || '').trim()); if (q.length < 2) return [];
        return DB.students.filter((s) => (norm(name(s.profile_id)).includes(q) || s.student_number === String(p_q).trim()) && pfStaff(s.profile_id)).sort((a, b) => name(a.profile_id).localeCompare(name(b.profile_id), 'ar')).slice(0, 30)
          .map((s) => ({ id: s.profile_id, name: name(s.profile_id), class: lbl(s.class_id), n: M().pf.filter((i) => i.student_id === s.profile_id && i.status === 'approved').length })); },

      // ===== مكتبة معلمي دار الذكر =====
      lib_share({ p_kind, p_id, p_note }) { if (!isStaff()) deny(); const S = M(); S.lib = S.lib || [];
        const src = p_kind === 'hw' ? S.hw.find((x) => x.id === +p_id) : p_kind === 'exam' ? S.ex.find((x) => x.id === +p_id) : p_kind === 'post' ? S.cp.find((x) => x.id === +p_id) : deny('نوع غير صالح');
        if (!src || src.teacher_id !== ME_ID) deny('يمكنك مشاركة ما أنشأته أنت فقط');
        const payload = p_kind === 'hw' ? { title: src.title, instructions: src.instructions, links: src.links, max_score: src.max_score } : p_kind === 'exam' ? { title: src.title, instructions: src.instructions, duration_min: src.duration_min, questions: clone(src.questions) } : { kind: src.kind, title: src.title, body: src.body, links: src.links };
        const gl = [...new Set(src.class_ids.map((c) => { const g = grade(klass(c).grade_id); return g.name_ar + ' ' + stage(g.stage_id).name_ar; }))].join('، ');
        let l = S.lib.find((x) => x.kind === p_kind && x.src_id === src.id && x.owner_id === ME_ID);
        if (!l) { l = { id: nid('lib'), owner_id: ME_ID, kind: p_kind, src_id: src.id, uses: 0, created_at: iso(now()) }; S.lib.push(l); }
        Object.assign(l, { subject_id: src.subject_id, grade_label: gl, title: src.title, note: p_note || l.note || null, payload }); save(); return { ok: true, id: l.id }; },
      lib_unshare({ p_id }) { const S = M(), l = (S.lib || []).find((x) => x.id === +p_id); if (!l || !(l.owner_id === ME_ID || MYROLE() === 'admin')) deny(); S.lib = S.lib.filter((x) => x !== l); save(); return { ok: true }; },
      lib_shared({ p_kind, p_ids }) { return (M().lib || []).filter((l) => l.kind === p_kind && (p_ids || []).includes(l.src_id) && l.owner_id === ME_ID).map((l) => l.src_id); },
      lib_list({ p_kind, p_subject, p_q }) { if (!isStaff()) deny(); const q = norm(String(p_q || '').trim());
        return (M().lib || []).filter((l) => (!p_kind || l.kind === p_kind) && (!p_subject || l.subject_id === p_subject) && (!q || norm(l.title + ' ' + (l.note || '') + ' ' + (l.grade_label || '')).includes(q)))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)).map((l) => ({ id: l.id, kind: l.kind, title: l.title, note: l.note, subject_id: l.subject_id, subject: sname(l.subject_id), grade: l.grade_label, owner: name(l.owner_id),
            mine: l.owner_id === ME_ID, created_at: l.created_at, uses: l.uses, n_questions: l.kind === 'exam' ? l.payload.questions.length : null, snip: String(l.payload.instructions || l.payload.body || '').slice(0, 220) })); },
      lib_get({ p_id }) { if (!isStaff()) deny(); const l = (M().lib || []).find((x) => x.id === +p_id) || deny('غير موجود');
        return { id: l.id, kind: l.kind, title: l.title, note: l.note, subject_id: l.subject_id, subject: sname(l.subject_id), grade: l.grade_label, owner: name(l.owner_id), payload: clone(l.payload) }; },
      lib_use({ p_id, p_subject }) { if (!isStaff()) deny(); const S = M(), l = (S.lib || []).find((x) => x.id === +p_id) || deny('غير موجود'); const ids = [];
        if (l.kind === 'exam') { if (!p_subject || !myTA().some((t) => t.subject_id === p_subject)) deny('اختر مادة من موادك');
          l.payload.questions.forEach((q) => { const n = { id: nid('qb'), owner_id: ME_ID, subject_id: p_subject, grade_num: null, qtype: q.qtype, body: q.body, options: clone(q.options || []), answer: q.answer || null,
            points: +q.points || 1, image: q.image || null, topic: 'من المكتبة: ' + l.title.slice(0, 80), created_at: iso(now()) }; S.qb.push(n); ids.push(n.id); }); }
        if (l.owner_id !== ME_ID) l.uses++; save(); return { ok: true, imported: ids.length, ids }; },

      // ===== متابعة الالتزام =====
      an_compliance({ p_from, p_to }) { if (!isStaff()) deny(); const S = M();
        const f = p_from || ymd((() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d; })()), t = p_to || ymd((() => { const d = new Date(f + 'T12:00:00'); d.setDate(d.getDate() + 4); return d; })());
        const inR = (d) => d && d.slice(0, 10) >= f && d.slice(0, 10) <= t;
        return [...new Set(DB.teaching_assignments.map((x) => x.teacher_id))].filter((tid) => reviewer(tid)).map((tid) => { const L = S.lp.filter((l) => l.teacher_id === tid && inR(l.lesson_date));
          return { id: tid, name: name(tid), subjects: [...new Set(DB.teaching_assignments.filter((x) => x.teacher_id === tid).map((x) => sname(x.subject_id)))].join('، '), periods: 0,
            lp: L.length, lp_sent: L.filter((l) => l.status !== 'draft').length, lp_ok: L.filter((l) => l.status === 'approved').length, lp_ret: L.filter((l) => l.status === 'returned').length,
            hw: S.hw.filter((h) => h.teacher_id === tid && inR(h.created_at)).length, ex: S.ex.filter((e) => e.teacher_id === tid && inR(e.opens_at)).length }; })
          .sort((a, b) => a.name.localeCompare(b.name, 'ar')); },

      // ===== الفصول والطلاب =====
      cls_overview() { if (!isStaff()) deny(); const d = today();
        const vis = (c) => isLeader() || (MYROLE() === 'principal' ? grade(c.grade_id).stage_id === myStage()
          : DB.teaching_assignments.some((t) => t.class_id === c.id && (t.teacher_id === ME_ID || DB.supervision.some((x) => x.supervisor_id === ME_ID && x.teacher_id === t.teacher_id))) || c.homeroom_teacher_id === ME_ID);
        return DB.classes.filter((c) => c.active !== false && vis(c)).map((c) => c.id).sort(csort).map((id) => { const c = klass(id), g = grade(c.grade_id), st = stage(g.stage_id);
          const sess = DB.att_sessions.filter((x) => x.day === d && x.period === 0 && x.grade_id === g.id && (!x.class_id || x.class_id === id));
          const stu = stuIn([id]);
          return { id, label: lbl(id), name: c.name, grade: g.name_ar, grade_id: g.id, stage: st.name_ar, students: stu.length, homeroom: c.homeroom_teacher_id ? name(c.homeroom_teacher_id) : null,
            teachers: new Set(DB.teaching_assignments.filter((t) => t.class_id === id).map((t) => t.teacher_id)).size,
            absent_today: DB.att_marks.filter((m) => sess.some((x) => x.id === m.session_id) && m.status === 'absent' && stu.some((s) => s.profile_id === m.student_id)).length, att_taken: sess.length > 0 }; }); },
      cls_students({ p_class }) { if (!RPC.cls_overview().some((c) => c.id === p_class)) deny(); const c = klass(p_class), f = ymd(daysAgo(60));
        const daily = DB.att_sessions.filter((x) => x.period === 0 && x.day >= f).map((x) => x.id);
        const cnt = (sid, st) => DB.att_marks.filter((m) => m.student_id === sid && m.status === st && daily.includes(m.session_id)).length;
        return { class: lbl(p_class), homeroom: c.homeroom_teacher_id ? name(c.homeroom_teacher_id) : null,
          teachers: DB.teaching_assignments.filter((t) => t.class_id === p_class).map((t) => ({ name: name(t.teacher_id), subject: sname(t.subject_id) })),
          students: stuIn([p_class]).sort((a, b) => name(a.profile_id).localeCompare(name(b.profile_id), 'ar')).map((s) => ({ id: s.profile_id, name: name(s.profile_id), no: s.student_number, guardian: s.guardian_name, phone: s.guardian_phone,
            absent: cnt(s.profile_id, 'absent'), late: cnt(s.profile_id, 'late'), pf: M().pf.filter((i) => i.student_id === s.profile_id && i.status === 'approved').length })) }; }
    };
  })());

  // ======================================================================
  //  مكتب الإشراف التربوي (نسخة تجريبية من دوال sv_* — sql/06 و sql/08)
  // ======================================================================
  Object.assign(RPC, (function () {
    const SVR = () => ({ admin: 'sys', leadership: 'admin', principal: 'admin', supervisor: 'member' })[MYROLE()] || null;
    const SV = () => (DB.SV = DB.SV || { data: {}, msgs: [{ id: 1, at: Date.now() - 864e5 * 2, title: 'اجتماع المشرفين', body: 'اجتماع المشرفين التربويين الأحد القادم بعد الحصة الرابعة في قاعة الاجتماعات.', from: 'مسؤول النظام' }], sched: [] });
    const supName = (id) => (DB.profiles.find((x) => x.id === id) || {}).full_name || '';
    const supers = () => [...new Set(DB.supervision.map((x) => x.supervisor_id))];
    const no = (e) => ({ ok: false, error: e || 'not_member' });
    // جدول المشرف: حصص المعلمين الذين يشرف عليهم (ورقة لكل مشرف)
    function ttFor(ids) {
      // ورقة لكل (مشرف × مرحلة) كما في جداول المدرسة الحقيقية (مفتاح المرحلة = الورقة + الصف)
      const SN = { 1: 'ابتدائي', 2: 'متوسط', 3: 'ثانوي' }, sheets = [], slots = [], stages = {};
      ids.forEach((sid) => { const T = new Set(DB.supervision.filter((x) => x.supervisor_id === sid).map((x) => x.teacher_id));
        [1, 2, 3].forEach((st) => { const L = DB.tt_slots.filter((x) => T.has(x.teacher_id) && x.sheet_id === st); if (!L.length) return;
          const k = sheets.length; sheets.push({ k, idx: k, owner: sid, owner_name: supName(sid), dept: '', name: SN[st], label: SN[st] + ' — ' + supName(sid) });
          L.forEach((x) => { stages[k + '|' + x.track + '|' + x.grade_num] = SN[st];
            slots.push({ s: k, d: x.day, p: x.period, k: 'class', t: supName(x.teacher_id), c: x.cls, tr: x.track, g: x.grade_num, sc: x.section,
              sj: (DB.subjects.find((b) => b.id === x.subject_id) || {}).name_ar || '', r: null }); }); }); });
      return { ok: true, mirror: ids.length > 1, sheets, slots, subjects: {}, stages };
    }
    return {
      sv_login() { const r = SVR(); if (!r) return { ok: false, error: 'not_member', name: name(ME_ID) }; const d = SV().data[ME_ID];
        return { ok: true, id: ME_ID, name: name(ME_ID), dept: MYROLE() === 'supervisor' ? 'الإشراف التربوي' : '', admin: ['sys', 'admin'].includes(r), sys: r === 'sys', role: r === 'member' ? '' : r,
          data: d ? d.data : null, stamp: d ? d.stamp : 0 }; },
      sv_ver() { return SVR() ? { ok: true, stamp: (SV().data[ME_ID] || {}).stamp || 0 } : no(); },
      sv_msgs() { return SVR() ? { ok: true, msgs: SV().msgs } : no(); },
      sv_save({ p_data, p_stamp }) { if (!SVR()) return no(); SV().data[ME_ID] = { data: p_data, stamp: p_stamp || Date.now() }; save(); return { ok: true, stamp: p_stamp || 0 }; },
      sv_push_test() { return { ok: false, error: 'demo' }; },
      sv_tt_get({ p_all }) { const r = SVR(); if (!r) return no(); if (p_all && r !== 'sys') return no('not_sys');
        const mine = supers().includes(ME_ID) ? [ME_ID] : [];
        return ttFor(p_all ? supers() : mine); },
      sv_tt_meta() { return { ok: true, updated: iso(new Date()) }; },
      sv_tt_put() { return { ok: false, error: 'في الوضع التجريبي لا يُعدّل الجدول' }; },
      sv_export() { return { ok: true, rows: [] }; },
      sv_import() { return { ok: false, error: 'demo' }; },
      sv_admin({ p }) { const r = SVR(); const a = String((p && p.action) || '');
        if (!['sys', 'admin'].includes(r)) return no('not_admin');
        const users = () => supers().concat(DB.profiles.filter((x) => x.role === 'admin').map((x) => x.id)).filter((v, i, A) => A.indexOf(v) === i)
          .map((id) => ({ code: id, name: supName(id), dept: P(id).role === 'admin' ? 'مسؤول النظام' : 'الإشراف التربوي', email: P(id).email || '', active: true, admin: P(id).role === 'admin', role: P(id).role === 'admin' ? 'sys' : '', stamp: 0 }));
        if (a === 'admin_list') return { ok: true, users: users() };
        if (a === 'admin_msgs') return { ok: true, msgs: SV().msgs };
        if (a === 'admin_sched_list') return { ok: true, sched: SV().sched };
        if (a === 'admin_push_status') return { ok: true, has_key: false };
        if (a === 'admin_school') return { ok: true, school: [] };
        if (a === 'admin_broadcast') { SV().msgs.unshift({ id: Date.now(), at: Date.now(), title: p.title || '', body: p.body || '', from: name(ME_ID) }); save(); return { ok: true }; }
        return { ok: false, error: 'في الوضع التجريبي لا تُعدّل بيانات المشرفين' }; }
    };
  })());

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
