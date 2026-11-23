
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
// البيانات المشتركة تُحدَّث من قاعدة البيانات مرة كل بضع ثوانٍ (داخل الدور) بدل كل طلب،
// فطلبات القراءة لا تنتظر الدور إلا عند التحديث، وحسابها نفسه متزامن (لا يتداخل مع طلب آخر).
let FRESH_AT_ = 0;
const FRESH_MS_ = 5000;
async function refreshShared_(needLogs, force) {
  const stale = () => force || needLogs.length || Date.now() - FRESH_AT_ > FRESH_MS_;
  if (!stale()) return;
  await withLock(async () => { if (!stale()) return; await loadProps(); await syncBook(needLogs); resetRequest_(); FRESH_AT_ = Date.now(); });
}
// هوية صاحب الجلسة: تُحفظ دقيقة واحدة لكل رمز دخول (بدل سؤال خادم الدخول وجدول الحسابات في كل طلب)
const WHO_ = new Map();
async function whoAmICached_(req) {
  const tok = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const hit = tok && WHO_.get(tok);
  if (hit && hit.exp > Date.now()) return hit.me;
  const me = await whoAmI(req);
  if (tok && me) { if (WHO_.size > 4000) WHO_.clear(); WHO_.set(tok, { me, exp: Date.now() + 60000 }); }
  return me;
}


/* =====================================================================
   رابط Google Meet تلقائي لكل حصة (sql/47) — action=meetGen
   يُستدعى من الجدولة اليومية (بالمفتاح السري) أو من مدير النظام بجلسته
   ===================================================================== */
async function meetGen_(prep) {
  const items = prep.items || [], days = prep.days || [];
  const CID = Deno.env.get("GOOGLE_CLIENT_ID"), CSEC = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!CID || !CSEC) return { ok: false, error: "google_secrets", planned: items.length };
  await SB.from("ol_meet_links").delete().lt("day", todayStr_(-30));
  if (!items.length) return { ok: true, planned: 0, created: 0 };
  const { data: ex } = await SB.from("ol_meet_links").select("day,room,period").in("day", days);
  const have = new Set((ex || []).map((r) => r.day + "|" + r.room + "|" + r.period));
  const todo = items.filter((i) => !have.has(i.day + "|" + i.room + "|" + i.period));
  if (!todo.length) return { ok: true, planned: items.length, todo: 0, created: 0 };
  const { data: map, error: e1 } = await SB.rpc("olm_resolve", { p_names: [...new Set(todo.map((i) => i.teacher))] });
  if (e1) throw e1;
  const pids = [...new Set(Object.values(map || {}))];
  const { data: toks } = pids.length ? await SB.from("gm_tokens").select("profile_id,refresh_token").in("profile_id", pids) : { data: [] };
  const tokOf = Object.fromEntries((toks || []).map((t) => [t.profile_id, t.refresh_token]));
  const byT = {}; let noMatch = 0, noLink = 0, created = 0, failed = 0; const errors = [], unmatched = new Set();
  todo.forEach((i) => { const pid = (map || {})[i.teacher]; if (!pid) { noMatch++; unmatched.add(i.teacher); return; } if (!tokOf[pid]) { noLink++; return; } (byT[pid] = byT[pid] || []).push(i); });
  await Promise.all(Object.keys(byT).map(async (pid) => {
    const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: tokOf[pid], grant_type: "refresh_token" }) });
    const tj = await tr.json().catch(() => ({}));
    if (!tr.ok || !tj.access_token) { failed++; const msg = "token: " + (tj.error_description || tj.error || tr.status); errors.push(msg);
      await SB.from("gm_tokens").update({ last_error: msg.slice(0, 300) }).eq("profile_id", pid); return; }
    for (const i of byT[pid]) {
      const r = await fetch("https://meet.googleapis.com/v2/spaces", { method: "POST", headers: { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ config: { accessType: "TRUSTED", entryPointAccess: "ALL" } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.meetingUri) { failed++; const msg = "meet: " + ((j.error && j.error.message) || r.status); errors.push(msg);
        await SB.from("gm_tokens").update({ last_error: msg.slice(0, 300) }).eq("profile_id", pid); return; }
      const { error } = await SB.from("ol_meet_links").insert({ day: i.day, room: i.room, period: i.period, teacher: i.teacher, profile_id: pid, uri: j.meetingUri, space: j.name || null });
      if (!error) created++;
    }
    await SB.from("gm_tokens").update({ last_ok: new Date().toISOString(), last_error: null }).eq("profile_id", pid);
  }));
  return { ok: true, planned: items.length, todo: todo.length, created, noMatch, noLink, failed, errors: errors.slice(0, 5), unmatched: [...unmatched].slice(0, 40) };
}

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
      await syncBook(["سجل الدخول", "التقارير اليومية"]); FRESH_AT_ = Date.now();
      await loadMeet([todayStr_(0)]);
      REQ = { email: "", name: "", role: "" }; resetRequest_();
      dailyReport(); await flushBook(); resetRequest_();
      return json({ ok: true });
    });

    // ---- روابط Meet التلقائية: الجدولة (بالمفتاح السري) أو مدير النظام/الإدارة العليا بجلستهم ----
    if (act === "meetGen") {
      const prep = await withLock(async () => {
        await loadProps();
        let ok = !!PROPS.ADMIN_SECRET && secret === PROPS.ADMIN_SECRET;
        if (!ok) { const m = await whoAmI(req); ok = !!(m && !m.bad && (m.role === "admin" || m.role === "leadership")); }
        if (!ok) return { forbidden: true };
        await syncBook([]); FRESH_AT_ = Date.now(); REQ = { email: "", name: "", role: "" }; resetRequest_();
        const T = readAll_(true);
        const days = (Array.isArray(body.days) && body.days.length ? body.days.map(normDate_).filter(Boolean) : [todayStr_(0), todayStr_(1), todayStr_(2)]).slice(0, 5);
        const items = [];
        days.forEach((d) => { const rooms = plannedDay_(T, d); Object.keys(rooms).forEach((k) => { const R = rooms[k];
          R.periods.forEach((x) => { if (!x.teacher || x.code) return; items.push({ day: d, room: R.key, period: x.p, teacher: x.teacher }); }); }); });
        resetRequest_();
        return { items, days };
      });
      if (prep.forbidden) return json({ ok: false, error: "forbidden" }, 403);
      return json(await meetGen_(prep));
    }

    // ---- حالة الإيقاف (بدون دخول) ----
    if (req.method === "GET" && url.searchParams.get("status")) { await refreshShared_([], false); return json({ ok: true, paused: isPaused_() }); }

    // ---- المستخدم من جلسة المنصة ----
    const me = await whoAmICached_(req);
    if (!me) return json({ ok: false, error: "session" });
    if (me.bad) return json({ ok: false, error: "domain", email: me.email });
    const myReq = { email: me.email, name: me.name, role: me.role };

    // ---- قراءة (فتح الصفحة): تحديث مشترك عند الحاجة، ثم حساب متزامن بالكامل ----
    if (req.method === "GET" || act === "gate") {
      await refreshShared_([], false);
      REQ = myReq;                                  // من هنا حتى الرد: لا انتظار ← لا يتداخل طلب آخر
      // (البيانات المقروءة DATA_/ACCT_ تُشتق من الأوراق فقط، فتبقى محفوظة حتى يتغيّر شيء)
      const out = gate_(SSO);
      if (out && out.ok) out.me = { email: myReq.email, name: myReq.name || out.label || "", sno: (out.me && out.me.sno) || "" };
      return json(out);
    }

    // ---- كتابة/تقارير: داخل الدور (طلب واحد في كل مرة) ----
    return await withLock(async () => {
      await loadProps();
      const needLogs = act === "report" ? ["سجل الدخول", "التقارير اليومية"] : [];
      await syncBook(needLogs); FRESH_AT_ = Date.now();
      if (act === "report") { const d = normDate_(body.date) || todayStr_(0); await loadMeet([d]); }
      REQ = myReq; resetRequest_();                 // بعد آخر انتظار وقبل الحساب المتزامن
      let out;
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
      await flushBook(); resetRequest_();          // تغيّرت الأوراق ← تُعاد قراءتها في الطلب التالي
      return json(out);
    });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "server", msg: String(e && e.message || e).slice(0, 200) });
  }
});
