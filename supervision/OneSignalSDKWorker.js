// عامل إشعارات OneSignal — من onesignal.com مباشرة، والـ CDN احتياطيًا
// (بعض المتصفحات يرجع لها cdn.onesignal.com بخطأ 503 عند تحميل السكربتات)
try { importScripts("https://onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); }
catch (e) { importScripts("https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js"); }
