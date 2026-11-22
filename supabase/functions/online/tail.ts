
/* =====================================================================
   التعديلات على السكربت القديم: الدخول بحساب المنصة بدل الرموز/جلسات Google
   ===================================================================== */
let REQ = { email: "", name: "", role: "" };       // صاحب الطلب الحالي (من جلسة المنصة)
const SSO = "SSO";
function isSession_(code) { return normCode_(code) === SSO; }
function parseSession_(code) { return isSession_(code) && REQ.email ? { email: REQ.email, name: REQ.name } : null; }
function isSysAdmin_(email) { return REQ.role === "admin" && String(email || "").toLowerCase() === REQ.email; }
// «الحسابات»: تُقرأ من الذاكرة في كل طلب (بدون نسخ مؤقتة قديمة)
function accountsMap_() { if (!ACCT_) ACCT_ = readAccounts_(); return ACCT_; }
function accountFor_(email) {
  const a = accountsMap_()[String(email || "").trim().toLowerCase()];
  return a ? { email: a.e, name: a.n, code: a.c, sno: a.s } : null;
}
// رمز «كل المدرسة» (مدير التعليم) لمدير النظام والإدارة العليا إن لم يكن لهما سطر في «الحسابات»
function schoolCode_() {
  const T = readAll_(); if (!T.supCodes) return "";
  const sx = colIndex_(T.supCodes.headers); if (sx.code < 0) return "";
  const all = GRADES_.length;
  const r = T.supCodes.rows.find(function (r) { return parseScope_(sx.scope >= 0 ? r[sx.scope] : "").length === all && normCode_(r[sx.code]).length >= 4; });
  return r ? String(r[sx.code]) : "";
}
function sessionCode_(raw) {
  if (!isSession_(raw)) return { error: "invalid" };          // الرموز القديمة لم تعد تُقبل: الدخول بحساب المنصة فقط
  if (!REQ.email) return { error: "session" };
  let a = accountFor_(REQ.email);
  if (!a && (REQ.role === "admin" || REQ.role === "leadership")) { const c = schoolCode_(); if (c) a = { email: REQ.email, name: REQ.name, code: c, sno: "" }; }
  if (!a) return { error: isStudentEmail_(REQ.email) ? "unbind" : "noaccount", email: REQ.email, name: REQ.name };
  return { code: a.code, email: REQ.email, name: REQ.name || a.name, sno: a.sno };
}
function adminFromCode_(raw) { return isSession_(raw) && REQ.role === "admin" ? REQ.email : ""; }
// الحساب الحالي فقط: الطالب يربط حسابه (بريده من جلسة المنصة) بفصله
function readAll_(force) { if (DATA_ && !force) return DATA_; return readSheet_(CacheService.getScriptCache()); }
// سجل Google Meet يصل من «الجسر» إلى جدول ol_meet
let MEET_ = {};
function meetDay_(date) { return MEET_[date] || null; }

/* =====================================================================
   نقطة الدخول
   ===================================================================== */
const CORS = { "Access-Control-Allow-Origin": "https://moustafaahussien.github.io", "Vary": "Origin", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ol-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (o, st) => new Response(JSON.stringify(o), { status: st || 200, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
const SCHOOL_DOMAIN_ = "althikr.edu.sa";
async function whoAmI(req) {
  const h = req.headers.get("authorization") || ""; const tok = h.replace(/^Bearer\s+/i, "");
  if (!tok || tok.split(".").length !== 3) return null;
  const { data, error } = await SB.auth.getUser(tok);
  if (error || !data || !data.user || !data.user.email) return null;
  const email = String(data.user.email).toLowerCase();
  if (!email.endsWith("@" + SCHOOL_DOMAIN_)) return { email, bad: "domain" };
  const { data: p } = await SB.from("profiles").select("full_name, role, active").eq("email", email).maybeSingle();
  const meta = data.user.user_metadata || {};
  return { email, name: (p && p.full_name) || meta.full_name || meta.name || "", role: p && p.active ? p.role : "", known: !!p };
}
async function loadMeet(dates) {
  MEET_ = {};
  if (!dates.length) return;
  const { data } = await SB.from("ol_meet").select("day,recs").in("day", dates);
  (data || []).forEach((m) => { MEET_[m.day] = m.recs; });
}
function resetRequest_() { DATA_ = null; DATA_VER_ = ""; ACCT_ = null; }

// ⚠️ حالة مشتركة (BOOK/PROPS/REQ) بين الطلبات المتزامنة داخل نفس الخادم:
// كل ما يقرأ أو يغيّر هذه الحالة يمرّ بالدور (طلب واحد في كل مرة) حتى لا يأخذ طالب بيانات طالب آخر
// أو تضيع كتابة طلب بسبب تحديث طلب آخر. التحقق من الهوية يبقى خارج الدور (متوازيًا).
let LOCK_ = Promise.resolve();
function withLock(fn) { const run = LOCK_.then(fn, fn); LOCK_ = run.catch(() => {}); return run; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    let body = {};
    if (req.method === "POST") { try { body = await req.json(); } catch (e) { body = {}; } }
    const act = String(body.action || "");

    // ---- عمليات النظام (بالمفتاح السري): استيراد الأوراق، سجل Meet، التقرير اليومي ----
    const secret = req.headers.get("x-ol-secret") || body.secret || "";
    if (act === "import" || act === "meetIngest" || act === "dailyReport") return await withLock(async () => {
      await loadProps();
      let okSecret = !!PROPS.ADMIN_SECRET && secret === PROPS.ADMIN_SECRET;
      if (!okSecret && act === "import") { const m = await whoAmI(req); okSecret = !!(m && !m.bad && m.role === "admin"); }   // مدير النظام يستورد بجلسته
      if (!okSecret) return json({ ok: false, error: "forbidden" }, 403);
      if (act === "import") {
        const sheets = body.sheets || {};
        for (const n of Object.keys(sheets)) { const { error } = await SB.rpc("ol_put_sheet", { p_sheet: n, p_rows: sheets[n] }); if (error) throw error; }
        return json({ ok: true, sheets: Object.keys(sheets).length });
      }
      if (act === "meetIngest") {
        const day = normDate_(body.date); if (!day) return json({ ok: false, error: "date" });
        const { error } = await SB.from("ol_meet").upsert({ day, recs: body.recs || [], at: new Date().toISOString() }); if (error) throw error;
        return json({ ok: true, n: (body.recs || []).length });
      }
      await syncBook(["سجل الدخول", "التقارير اليومية"]); resetRequest_();
      await loadMeet([todayStr_(0)]);
      dailyReport(); await flushBook();
      return json({ ok: true });
    });

    // ---- حالة الإيقاف (بدون دخول) ----
    if (req.method === "GET" && url.searchParams.get("status")) return await withLock(async () => { await loadProps(); return json({ ok: true, paused: isPaused_() }); });

    // ---- المستخدم من جلسة المنصة ----
    const me = await whoAmI(req);
    if (!me) return json({ ok: false, error: "session" });
    if (me.bad) return json({ ok: false, error: "domain", email: me.email });
    const myReq = { email: me.email, name: me.name, role: me.role };
    return await withLock(async () => {
    await loadProps();
    REQ = myReq;
    const needLogs = act === "report" ? ["سجل الدخول", "التقارير اليومية"] : [];
    await syncBook(needLogs); resetRequest_();
    if (act === "report") { const d = normDate_(body.date) || todayStr_(0); await loadMeet([d]); }

    let out;
    if (req.method === "GET" || act === "gate") out = gate_(SSO);
    else {
      body.code = SSO; body.session = SSO;
      if (act === "setPause") out = setPause_(body);
      else if (isPaused_() && !isSysAdmin_(REQ.email)) out = act === "join" ? { ok: true } : { ok: false, error: "paused" };
      else if (act === "listDay") out = listDay_(body);
      else if (act === "saveDays") out = saveDays_(body);
      else if (act === "join") out = logJoin_(body);
      else if (act === "saveLinks") out = saveLinks_(body);
      else if (act === "report") out = report_(body);
      else if (act === "bind") out = bind_(body);
      else if (act === "classes") out = classList_(body);
      else out = { ok: false, error: "action" };
    }
    await flushBook();
    if (out && out.ok && (req.method === "GET" || act === "gate")) out.me = { email: myReq.email, name: myReq.name || out.label || "", sno: (out.me && out.me.sno) || "" };
    return json(out);
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "server", msg: String(e && e.message || e).slice(0, 200) });
  }
});
