/* =====================================================================
   تنبيهات الجوال للمنصة (sql/57) — عبر OneSignal ونفس عامل الخدمة الخاص بمكتب الإشراف
   (اشتراك واحد لكل جهاز يخدم المنصة ومكتب الإشراف معًا)
   الاستخدام: LMS_PUSH.mount(عنصر) — يرسم بطاقة التفعيل/الحالة داخل العنصر
   ===================================================================== */
(function () {
  const APP = '0ab398f6-a82a-4bc6-ac4d-aab5d6cfb915';
  const BASE = (window.LMS && LMS.BASE) || '/althikr-lms/';
  const UA = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(UA) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  const isAndroid = /Android/i.test(UA);
  const otherAndroid = /SamsungBrowser|HuaweiBrowser|HONORBrowser|HiBrowser|MiuiBrowser|OPR\/|EdgA|Firefox|FBAN|FBAV|Instagram|WhatsApp|; wv\)/i.test(UA);
  const KEY = 'lms_push_on';
  let ready = null;

  function load() {
    if (window.LMS && LMS.DEMO) return Promise.reject(new Error('demo'));
    if (ready) return ready;
    ready = new Promise((res, rej) => {
      window.OneSignalDeferred = window.OneSignalDeferred || [];
      const add = (src, next) => { const s = document.createElement('script'); s.src = src; s.defer = true; s.onerror = () => { s.remove(); next(); }; document.head.appendChild(s); };
      add('https://onesignal.com/sdks/web/v16/OneSignalSDK.page.es6.js?v=202611231330',
        () => add(BASE + 'supervision/os/OneSignalSDK.page.es6.js?v=202611231330',
          () => add('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js', () => { ready = null; rej(new Error('sdk')); })));
      OneSignalDeferred.push(async (OS) => {
        try { await OS.init({ appId: APP, serviceWorkerPath: 'althikr-lms/supervision/OneSignalSDKWorker.js', serviceWorkerParam: { scope: '/althikr-lms/supervision/' } }); res(OS); }
        catch (e) { ready = null; rej(e); }
      });
    });
    return ready;
  }

  const HELP_IOS = `<b>على الآيفون/الآيباد:</b> افتح المنصة من <b>Safari</b> ← زر المشاركة <b>⬆️</b> ← <b>«إضافة إلى الشاشة الرئيسية»</b> ← افتح المنصة من الأيقونة الجديدة ← سجّل الدخول ← اضغط «تفعيل التنبيهات». (يتطلب iOS 16.4 أو أحدث)`;
  const HELP_ANDROID = `<b>على أندرويد:</b> افتح المنصة في <b>Google Chrome</b> (وليس من داخل واتساب أو متصفح الجوال الافتراضي) ← اضغط «تفعيل التنبيهات» ← «سماح».
    لو لم تظهر نافذة السماح: Chrome ⋮ ← الإعدادات ← إعدادات المواقع ← الإشعارات ← تأكد أن الموقع غير محظور.`;
  const HELP_BLOCK = `<b>المتصفح منع خدمة الإشعارات</b> — غالبًا مانع إعلانات أو «منع التتبع»: أوقفه لموقع moustafaahussien.github.io (في Edge: الخصوصية ← منع التتبع ← أساسي)، ثم أعد المحاولة. الأسهل: Google Chrome بدون إضافات.`;

  async function mount(box) {
    if (!box || !window.LMS || !LMS.sb) return;
    const me = (await LMS.getContext().catch(() => null)) || {};
    const pid = me.profile && me.profile.id; if (!pid) return;
    const on = () => { try { return localStorage.getItem(KEY) === pid; } catch (_) { return false; } };
    const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    // مفعّلة ومسموحة: سطر صغير فقط
    if (on() && supported && Notification.permission === 'granted') {
      box.innerHTML = `<div class="push-mini">🔔 تنبيهات الجوال مفعّلة على هذا الجهاز · <a href="#" data-pt>إرسال تنبيه تجريبي</a> · <a href="#" data-off>إيقاف</a></div>`;
    } else {
      box.innerHTML = `<div class="glass card push-card"><div class="toolbar" style="margin:0;flex-wrap:wrap"><span class="grow">🔔 <b>فعّل تنبيهات الجوال</b> — تصلك رسائل المنصة وتعاميمها وتنبيهاتها فورًا على جوالك أو حاسبك حتى والمنصة مغلقة.</span>
        <button class="btn primary sm" data-on>تفعيل التنبيهات على هذا الجهاز</button><button class="btn sm ghost" data-later title="إخفاء">لاحقًا</button></div>
        <div class="hint" data-st></div><div class="push-help" data-help style="display:none"></div></div>`;
      try { if (sessionStorage.getItem('lms_push_later')) { box.innerHTML = ''; return; } } catch (_) {}
      if (isIOS && !isStandalone) { const h = box.querySelector('[data-help]'); h.innerHTML = HELP_IOS; h.style.display = 'block'; }
    }
    const st = (t) => { const e = box.querySelector('[data-st]'); if (e) e.textContent = t; };
    const help = (html) => { const h = box.querySelector('[data-help]'); if (h) { h.innerHTML = html; h.style.display = 'block'; } };
    box.onclick = async (e) => {
      const t = e.target.closest('[data-on],[data-later],[data-pt],[data-off]'); if (!t) return; e.preventDefault();
      if (t.dataset.later !== undefined) { try { sessionStorage.setItem('lms_push_later', '1'); } catch (_) {} box.innerHTML = ''; return; }
      if (t.dataset.pt !== undefined) { try { const { data, error } = await LMS.sb.rpc('push_test_me'); if (error) throw error;
          LMS.toast(data && data.ok ? '✓ أُرسل — يصلك خلال ثوانٍ' : 'تعذّر الإرسال'); } catch (er) { LMS.toast(LMS.errMsg(er), 'err'); } return; }
      if (t.dataset.off !== undefined) { try { const OS = await load(); await OS.User.PushSubscription.optOut(); } catch (_) {}
        try { localStorage.removeItem(KEY); } catch (_) {} LMS.toast('أُوقفت التنبيهات على هذا الجهاز'); mount(box); return; }
      // تفعيل
      if (isIOS && !isStandalone) { help(HELP_IOS); st('أضف المنصة للشاشة الرئيسية أولًا'); return; }
      if (isAndroid && otherAndroid) { help(HELP_ANDROID); st('هذا المتصفح لا يدعم التنبيهات'); return; }
      if (!supported) { st('هذا المتصفح لا يدعم التنبيهات'); if (isAndroid) help(HELP_ANDROID); return; }
      if (Notification.permission === 'denied') { st('الإشعارات محظورة لهذا الموقع من إعدادات المتصفح'); help(HELP_ANDROID.replace('على أندرويد', 'لإلغاء الحظر')); return; }
      st('جارٍ التفعيل…'); t.disabled = true;
      try {
        const OS = await Promise.race([load(), new Promise((_, j) => setTimeout(() => j(new Error('load_timeout')), 20000))]);
        await OS.Notifications.requestPermission();
        if (Notification.permission !== 'granted') { st('لم تتم الموافقة على الإشعارات'); t.disabled = false; return; }
        await OS.User.PushSubscription.optIn();
        const { data: ext, error } = await LMS.sb.rpc('push_my_id'); if (error) throw error;
        await OS.login(ext);
        let sid = null; for (let k = 0; k < 20 && !sid; k++) { sid = OS.User.PushSubscription.id; if (!sid) await new Promise((r) => setTimeout(r, 500)); }
        if (!sid) { st('لم يكتمل الاشتراك على هذا الجهاز — أعد المحاولة'); t.disabled = false; return; }
        try { localStorage.setItem(KEY, pid); } catch (_) {}
        LMS.toast('تم تفعيل التنبيهات ✓'); await LMS.sb.rpc('push_test_me'); mount(box);
      } catch (er) {
        const m = String((er && er.message) || er); t.disabled = false;
        st('تعذّر التفعيل' + (m ? ' (' + m.slice(0, 60) + ')' : ''));
        if (m === 'sdk' || m === 'load_timeout') help(HELP_BLOCK); else if (isAndroid) help(HELP_ANDROID);
      }
    };
  }
  window.LMS_PUSH = { mount, load };
})();
