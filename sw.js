/* عامل خدمة المنصة: يجعل تحديثات النشر تظهر فورًا بدل انتظار ذاكرة GitHub Pages (10 دقائق)
   - الصفحات والملفات بلا رقم نسخة (?v=) تُطلب من الخادم كل مرة مع إعادة التحقق (ETag ⇐ 304 إن لم تتغير)
   - الملفات ذات رقم النسخة تُترك لذاكرة المتصفح العادية (تتغير أرقامها مع كل تحديث)
   - لا يتدخل في الطلبات الخارجية (Supabase وغيرها) ولا في منصة الإشراف (لها عامل OneSignal الخاص بها)
   - لا يخزّن أي بيانات */
const SCOPE = new URL('./', self.location).pathname;   // /althikr-lms/

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(SCOPE)) return;
  if (url.pathname.startsWith(SCOPE + 'supervision/')) return;
  if (url.searchParams.has('v')) return;                 // ملف بنسخة محددة: الذاكرة العادية تكفي
  // طلب تنقّل (فتح صفحة) لا يقبل نسخه مع خيارات، فنبني طلبًا جديدًا بنفس العنوان
  const fresh = req.mode === 'navigate'
    ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
    : new Request(req, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).catch(() => fetch(req)));
});
