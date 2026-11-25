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
    { key: 'lessons',     title: 'تحضير الدروس',        icon: '📘', url: 'lessons.html', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'خطط الدروس بالقوالب واعتماد المشرف' , beta: true },
    { key: 'course',      title: 'صفحات المواد',        icon: '🗂️', url: 'course.html', roles: [],  desc: 'المحتوى الأسبوعي والإعلانات لكل فصل' , beta: true },
    { key: 'homework',    title: 'الواجبات',            icon: '📝', url: 'homework.html', roles: [],  desc: 'إنشاء الواجبات والتسليم والتصحيح' , beta: true },
    { key: 'exams',       title: 'الاختبارات وبنك الأسئلة', icon: '🧪', url: 'exams.html', roles: [],  desc: 'اختبارات إلكترونية بتصحيح تلقائي' , beta: true },
    { key: 'analytics',   title: 'التحليل والمقارنة',    icon: '📊', url: 'analytics.html', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'تحليل الأسئلة ومقارنة الفصول والمعلمين' , beta: true },
    { key: 'gradebook',   title: 'سجل الدرجات',         icon: '🏅', url: 'gradebook.html', roles: [],  desc: 'الدرجات مجمّعة تلقائيًا' , beta: true },
    { key: 'library',     title: 'مكتبة معلمي دار الذكر', icon: '📚', url: 'library.html', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'واجبات واختبارات ومحتوى يشاركه المعلمون' , beta: true },
    { key: 'scilab',      title: 'إدارة مختبرات العلوم', icon: '🔬', url: 'labs.html?lab=science', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'حجز حصة في مختبر العلوم مع التجهيزات المطلوبة، ومخزون المختبر وتنبيهات النفاد والصلاحية والتلف' },
    { key: 'stemlab',     title: 'معمل STEM',            icon: '🤖', url: 'labs.html?lab=stem', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'حجز حصة في معمل STEM وتجهيزاتها، ومخزون المعمل وأدواته وتنبيهاته' },
    { key: 'certs',       title: 'إصدار الشهادات',       icon: '🎓', url: 'certificates.html', roles: ['admin','leadership','principal','supervisor','staff'], desc: 'شهادات شكر وتفوق وحضور للطلاب والمعلمين — من المنصة أو ملف Excel / Word بضغطة واحدة' },
    { key: 'students',    title: 'دليل الطلاب',          icon: '📇', url: 'students.html', roles: ['admin','leadership','principal','supervisor','staff'], desc: 'بحث عن أي طالب وملفه الكامل: البيانات وأولياء الأمور والحضور والدرجات والواجبات' },
    { key: 'classes',     title: 'الفصول والطلاب',       icon: '🏫', url: 'classes.html', roles: ['admin','leadership','principal','supervisor'], desc: 'فصول نطاقك وطلابها وحضورهم اليوم' , beta: true },
    { key: 'portfolio',   title: 'ملف إنجاز الطالب',     icon: '🎒', url: 'portfolio.html', roles: [],  desc: 'مشاريع الطالب ومسابقاته وإنجازاته' , beta: true },

    // —— منصاتك الحالية (تُدمج تدريجيًا) ——
    { key: 'online',      title: 'التعليم عن بعد',       icon: '🎥', url: 'online/', roles: [], desc: 'روابط الحصص والجداول والتقرير اليومي' },
    { key: 'messages',    title: 'الرسائل والتعاميم',   icon: '✉️', url: 'messages.html', roles: [], desc: 'البريد الداخلي والتعاميم ومراسلة أولياء الأمور' },
    { key: 'attendance',  title: 'الحضور والغياب',      icon: '🗓️', url: 'attendance.html', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'تسجيل الحضور اليومي وتقارير الغياب والتأخر' , beta: true },
    { key: 'duty',        title: 'جدول المناوبة',        icon: '🛡️', url: 'services.html#duty', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'المناوبة الأسبوعية ومناوبتك اليوم' , beta: true },
    { key: 'requests',    title: 'المعاملات الإلكترونية', icon: '📨', url: 'services.html#req', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'استئذان، إجازة، صيانة، مستلزمات… بسير اعتماد' , beta: true },
    { key: 'complaints',  title: 'الشكاوى الأكاديمية',    icon: '📣', url: 'services.html#cmp', roles: [], desc: 'تسجيل الشكوى ومتابعتها حتى الحل' , beta: true },
    { key: 'training',    title: 'تدريب المعلمين',        icon: '🎓', url: 'services.html#trn', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'الساعات والشهادات وتقييم أثر التدريب' , beta: true },
    { key: 'load',        title: 'نصاب الحصص',          icon: '📊', url: 'teaching-load.html', roles: ['admin','leadership','principal','supervisor'], desc: 'الحصص الأسبوعية لكل معلم وجدوله' , beta: true },
    { key: 'guardians',   title: 'أولياء الأمور',        icon: '👪', url: 'guardians.html', roles: ['admin','leadership','principal'], desc: 'جوالات أولياء الأمور ورموز التفعيل على واتساب' , beta: true },
    { key: 'directory',   title: 'دليل الموظفين',        icon: '📇', url: 'staff-directory.html', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'أسماء المنسوبين ومسمياتهم وطرق التواصل' },
    { key: 'supervision', title: 'مكتب الإشراف التربوي', icon: '🧭', url: 'supervision/', roles: ['admin','leadership','principal','supervisor'], desc: 'جداول الحصص والزيارات وتقييم المعلمين' },
    { key: '21csu',       title: 'مهارات القرن 21',      icon: '🚀', url: 'https://moustafaahussien.github.io/21csu/', roles: [], desc: 'البرامج الستة للوحدة' },
    { key: 'ai',          title: 'المعلم الذكي',         icon: '🤖', url: 'ai/', roles: ['admin','leadership','principal','supervisor','teacher','staff'], desc: 'أدوات الذكاء الاصطناعي للمعلمين' },
    { key: 'talent',      title: 'منصة الموهبة',         icon: '🌟', url: 'https://moustafaahussien.github.io/Mawhiba/', roles: [], desc: 'برامج موهبة والمسابقات' },
    { key: 'gifted',      title: 'الكشف عن الموهوبين',   icon: '🧩', url: 'https://moustafaahussien.github.io/matrices-test/', roles: ['admin','leadership','principal','supervisor','teacher'], desc: 'اختبارات رافن وتورانس' }
  ]
};
