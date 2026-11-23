/* =====================================================================
   الرجوع من موافقة جوجل: حفظ مفتاح التجديد ليُنشئ الخادم روابط Meet لحصص المعلم (sql/47)
   ===================================================================== */
(async function () {
  const { sb, esc, errMsg, $ } = LMS;
  const box = $('#box');
  const done = (ok, html) => { box.innerHTML = `<div class="notice ${ok ? 'ok' : 'err'}" style="text-align:right">${html}</div>
    <p style="text-align:center;margin-top:14px"><a class="btn primary" href="home.html">الرئيسية</a> <a class="btn" href="online/">🎥 التعليم عن بعد</a></p>`; };
  try {
    // تبادل رمز العودة (PKCE) يتم تلقائيًا عند إنشاء العميل — ننتظر الجلسة قليلًا
    let s = null;
    for (let i = 0; i < 20 && !(s && s.provider_refresh_token); i++) { const { data } = await sb.auth.getSession(); s = data.session; if (!(s && s.provider_refresh_token)) await new Promise((r) => setTimeout(r, 250)); }
    if (!s) return done(false, 'انتهت الجلسة — سجّل الدخول ثم أعد المحاولة.');
    const q = new URLSearchParams(location.search);
    if (q.get('error')) return done(false, 'لم تتم الموافقة: ' + esc(q.get('error_description') || q.get('error')));
    if (!s.provider_refresh_token) return done(false, 'لم تصل موافقة جوجل كاملة. أعد المحاولة واضغط «متابعة» ثم «سماح» في نافذة جوجل.');
    const { error } = await sb.rpc('gm_save_token', { p_refresh: s.provider_refresh_token, p_scope: 'meetings.space.created' });
    if (error) return done(false, esc(errMsg(error)));
    done(true, '✅ <b>تم ربط Google Meet بحسابك.</b><br>ستُنشئ المنصة رابط Meet مستقلًا لكل حصة أونلاين لك قبل موعدها، ويظهر لك ولطلابك تلقائيًا في صفحة التعليم عن بعد. أنت صاحب الاجتماع ولك كل صلاحيات التحكم.');
  } catch (e) { done(false, esc(errMsg(e))); }
})();
