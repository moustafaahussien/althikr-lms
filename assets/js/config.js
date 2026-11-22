/* =====================================================================
   إعدادات المنصة — هذا هو الملف الوحيد الذي تحتاج تعديله عند الإعداد
   ===================================================================== */
window.LMS_CONFIG = {
  // من Supabase → Project Settings → API
  SUPABASE_URL: 'https://zpbhzhpvpvehowxvlsgp.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_xPzQ55aK-_9OeBjIQwt5yw_DPAw3lC9',

  // نطاق البريد المدرسي (يُمرَّر لـ Google ليعرض حسابات المدرسة فقط)
  SCHOOL_DOMAIN: 'althikr.edu.sa',

  PLATFORM_NAME: 'منصة دار الذكر التعليمية',
  SCHOOL_NAME: 'مدارس دار الذكر',

  /* الوحدات التي تظهر في الصفحة الرئيسية.
     roles: الأدوار التي ترى الوحدة (اتركها [] لتظهر للجميع)
     url:   رابط الوحدة — اتركه '' لتظهر بعلامة «قريبًا». الرابط الداخلي (بدون https) يفتح في نفس الصفحة
     الأدوار: admin, leadership, principal, supervisor, teacher, staff, student, parent */
  MODULES: [
    // —— وحدات المنصة الجديدة (تُبنى في المراحل القادمة) ——
    { key: 'lessons',     title: 'تحضير الدروس',        icon: '📘', url: 'lessons.html', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'خطط الدروس بالقوالب واعتماد المشرف' },
    { key: 'course',      title: 'صفحات المواد',        icon: '🗂️', url: 'course.html', roles: [],  desc: 'المحتوى الأسبوعي والإعلانات لكل فصل' },
    { key: 'homework',    title: 'الواجبات',            icon: '📝', url: 'homework.html', roles: [],  desc: 'إنشاء الواجبات والتسليم والتصحيح' },
    { key: 'exams',       title: 'الاختبارات وبنك الأسئلة', icon: '🧪', url: 'exams.html', roles: [],  desc: 'اختبارات إلكترونية بتصحيح تلقائي' },
    { key: 'analytics',   title: 'التحليل والمقارنة',    icon: '📊', url: '', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'تحليل الأسئلة ومقارنة الفصول والمعلمين' },
    { key: 'gradebook',   title: 'سجل الدرجات',         icon: '🏅', url: '', roles: [],  desc: 'الدرجات مجمّعة تلقائيًا' },
    { key: 'portfolio',   title: 'ملف إنجاز الطالب',     icon: '🎒', url: '', roles: [],  desc: 'مشاريع الطالب ومسابقاته وإنجازاته' },

    // —— منصاتك الحالية (تُدمج تدريجيًا) ——
    { key: 'online',      title: 'التعليم عن بعد',       icon: '🎥', url: 'online/', roles: [], desc: 'روابط الحصص والجداول والتقرير اليومي' },
    { key: 'messages',    title: 'الرسائل والتعاميم',   icon: '✉️', url: 'messages.html', roles: [], desc: 'البريد الداخلي والتعاميم ومراسلة أولياء الأمور' },
    { key: 'attendance',  title: 'الحضور والغياب',      icon: '🗓️', url: 'attendance.html', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'تسجيل الحضور اليومي وتقارير الغياب والتأخر' },
    { key: 'duty',        title: 'جدول المناوبة',        icon: '🛡️', url: 'services.html#duty', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'المناوبة الأسبوعية ومناوبتك اليوم' },
    { key: 'requests',    title: 'المعاملات الإلكترونية', icon: '📨', url: 'services.html#req', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'استئذان، إجازة، صيانة، مستلزمات… بسير اعتماد' },
    { key: 'complaints',  title: 'الشكاوى الأكاديمية',    icon: '📣', url: 'services.html#cmp', roles: [], desc: 'تسجيل الشكوى ومتابعتها حتى الحل' },
    { key: 'training',    title: 'تدريب المعلمين',        icon: '🎓', url: 'services.html#trn', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'الساعات والشهادات وتقييم أثر التدريب' },
    { key: 'load',        title: 'نصاب الحصص',          icon: '📊', url: 'teaching-load.html', roles: ['admin','leadership','principal','supervisor'], desc: 'الحصص الأسبوعية لكل معلم وجدوله' },
    { key: 'guardians',   title: 'أولياء الأمور',        icon: '👪', url: 'guardians.html', roles: ['admin','leadership','principal'], desc: 'جوالات أولياء الأمور ورموز التفعيل على واتساب' },
    { key: 'directory',   title: 'دليل الموظفين',        icon: '📇', url: 'staff-directory.html', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'أسماء المنسوبين ومسمياتهم وطرق التواصل' },
    { key: 'supervision', title: 'مكتب الإشراف التربوي', icon: '🧭', url: 'supervision/', roles: ['admin','leadership','principal','supervisor'], desc: 'جداول الحصص والزيارات وتقييم المعلمين' },
    { key: '21csu',       title: 'مهارات القرن 21',      icon: '🚀', url: 'https://moustafaahussien.github.io/21csu/', roles: [], desc: 'البرامج الستة للوحدة' },
    { key: 'ai',          title: 'المعلم الذكي',         icon: '🤖', url: 'ai/', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'أدوات الذكاء الاصطناعي للمعلمين' },
    { key: 'talent',      title: 'منصة الموهبة',         icon: '🌟', url: 'https://moustafaahussien.github.io/Mawhiba/', roles: [], desc: 'برامج موهبة والمسابقات' },
    { key: 'gifted',      title: 'الكشف عن الموهوبين',   icon: '🧩', url: 'https://moustafaahussien.github.io/matrices-test/', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'اختبارات رافن وتورانس' }
  ]
};
