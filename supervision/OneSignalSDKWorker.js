// عامل إشعارات OneSignal — من onesignal.com مباشرة، والـ CDN احتياطيًا
// (بعض المتصفحات يرجع لها cdn.onesignal.com بخطأ 503 عند تحميل السكربتات)
try { importScripts("https://onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); }
catch (e) { importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); }

// تحديثات منصة الإشراف تظهر فور النشر (بدل ذاكرة GitHub Pages لعشر دقائق):
// الصفحات والملفات بلا رقم نسخة (?v=) تُطلب مع إعادة التحقق من الخادم (304 إن لم تتغير). لا يمس الإشعارات ولا الطلبات الخارجية.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.searchParams.has('v')) return;
  const fresh = req.mode === 'navigate'
    ? new Request(url.href, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' })
    : new Request(req, { cache: 'no-cache' });
  e.respondWith(fetch(fresh).catch(() => fetch(req)));
});
