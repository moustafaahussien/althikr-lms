// @ts-nocheck
/* =====================================================================
   خادم «التعليم عن بعد» على منصة المدرسة (Supabase Edge Function)
   نفس منطق سكربت Google القديم حرفيًا، لكن «الأوراق» أصبحت جداول في قاعدة البيانات (ol_rows)
   والدخول بحساب المنصة نفسه (لا رموز ولا جلسات Google منفصلة).
   ===================================================================== */
import { createClient } from "npm:@supabase/supabase-js@2";
const SB = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

/* ---------- الأوراق في الذاكرة (نسخة لكل خادم، تتحدّث حسب الإصدار) ---------- */
const BOOK = {};            // اسم الورقة ← { name, vals: [[...]], ver, dirty, appended: [] }
let META = {};              // اسم الورقة ← الإصدار في قاعدة البيانات
const LAZY = { "سجل الدخول": true, "التقارير اليومية": true };
async function loadMeta() {
  const { data, error } = await SB.from("ol_meta").select("sheet,ver");
  if (error) throw error;
  META = {}; (data || []).forEach((m) => { META[m.sheet] = Number(m.ver); });
}
async function loadSheet(name) {
  const rows = []; let from = 0;
  for (;;) {
    const { data, error } = await SB.from("ol_rows").select("cells").eq("sheet", name).order("id").range(from, from + 999);
    if (error) throw error;
    (data || []).forEach((r) => rows.push((r.cells || []).map((c) => c == null ? "" : String(c))));
    if (!data || data.length < 1000) break; from += 1000;
  }
  BOOK[name] = { name, vals: rows, ver: META[name] || 0, dirty: false, appended: [] };
}
async function syncBook(extra) {
  await loadMeta();
  const names = Object.keys(META).filter((n) => !LAZY[n] || (extra || []).includes(n));
  await Promise.all(names.map((n) => (!BOOK[n] || BOOK[n].ver !== META[n] || BOOK[n].dirty) ? loadSheet(n) : null));
  Object.keys(BOOK).forEach((n) => { if (!(n in META) && !BOOK[n].isNew) delete BOOK[n]; BOOK[n] && (BOOK[n].dirty = false, BOOK[n].appended = []); });
}
async function flushBook() {
  for (const n of Object.keys(BOOK)) {
    const s = BOOK[n];
    if (s.dirty) { const { error } = await SB.rpc("ol_put_sheet", { p_sheet: n, p_rows: s.vals }); if (error) throw error; s.dirty = false; s.appended = []; s.isNew = false; META[n] = (META[n] || 0) + 1; s.ver = META[n]; }
    else if (s.appended.length) { const { error } = await SB.rpc("ol_append", { p_sheet: n, p_rows: s.appended }); if (error) throw error; s.appended = []; META[n] = (META[n] || 0) + 1; s.ver = META[n]; }
  }
  for (const k of Object.keys(PROPS_DIRTY)) { await SB.from("ol_props").upsert({ key: k, value: PROPS[k] }); delete PROPS_DIRTY[k]; }
}
const lastRowOf = (s) => { let n = s.vals.length; while (n > 0 && !s.vals[n - 1].some((c) => String(c).trim())) n--; return n; };
function makeRange(s, r, c, nr, nc) {
  const R = {
    getDisplayValues() { const out = []; for (let i = 0; i < nr; i++) { const row = s.vals[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? "" : String(row[c - 1 + j])); out.push(o); } return out; },
    getValues() { return R.getDisplayValues(); },
    setValues(v) { for (let i = 0; i < v.length; i++) { const row = s.vals[r - 1 + i] || (s.vals[r - 1 + i] = []); for (let j = 0; j < v[i].length; j++) { while (row.length < c - 1 + j) row.push(""); row[c - 1 + j] = v[i][j] == null ? "" : String(v[i][j]); } } for (let i = 0; i < s.vals.length; i++) if (!s.vals[i]) s.vals[i] = []; s.dirty = true; return R; },
    setValue(v) { return R.setValues([[v]]); },
    clearContent() { for (let i = 0; i < nr; i++) { const row = s.vals[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) if (c - 1 + j < row.length) row[c - 1 + j] = ""; } s.dirty = true; return R; },
    setNumberFormat() { return R; }, setFontWeight() { return R; },
    sort(spec) { const col = (spec && spec.column) || 1, asc = !spec || spec.ascending !== false; const part = s.vals.slice(r - 1, r - 1 + nr);
      part.sort((a, b) => { const x = String(a[col - 1] || ""), y = String(b[col - 1] || ""); return asc ? x.localeCompare(y) : y.localeCompare(x); });
      s.vals.splice(r - 1, part.length, ...part); s.dirty = true; return R; }
  };
  return R;
}
function makeSheet(s) {
  return {
    getName() { return s.name; },
    getLastRow() { return lastRowOf(s); },
    getLastColumn() { return s.vals.reduce((m, r) => Math.max(m, r.length), 0); },
    getRange(a, b, c, d) {
      if (typeof a === "string") return makeRange(s, 1, 1, Math.max(1, s.vals.length), 26);
      return makeRange(s, a, b, c == null ? 1 : c, d == null ? 1 : d);
    },
    appendRow(row) { const r = row.map((x) => x == null ? "" : String(x)); const n = lastRowOf(s); s.vals.splice(n, s.vals.length - n, r); if (!s.dirty) s.appended.push(r); return this; },
    deleteRows(start, n) { s.vals.splice(start - 1, n); s.dirty = true; },
    setFrozenRows() {}, insertRowsAfter() {}
  };
}
const SpreadsheetApp = {
  getActiveSpreadsheet() {
    return {
      getSheets() { return Object.keys(BOOK).map((n) => makeSheet(BOOK[n])); },
      getSheetByName(n) { return BOOK[n] ? makeSheet(BOOK[n]) : null; },
      insertSheet(n) { BOOK[n] = { name: n, vals: [], ver: 0, dirty: true, appended: [], isNew: true }; return makeSheet(BOOK[n]); }
    };
  },
  flush() {}
};

/* ---------- خدمات Google البديلة ---------- */
const MEM = new Map();
const CacheService = { getScriptCache() { return {
  get(k) { const v = MEM.get(k); if (!v) return null; if (v.exp < Date.now()) { MEM.delete(k); return null; } return v.val; },
  put(k, val, ttl) { MEM.set(k, { val: String(val), exp: Date.now() + (ttl || 600) * 1000 }); },
  remove(k) { MEM.delete(k); },
  putAll(o, ttl) { Object.keys(o).forEach((k) => this.put(k, o[k], ttl)); },
  getAll(keys) { const o = {}; keys.forEach((k) => { const v = this.get(k); if (v != null) o[k] = v; }); return o; }
}; } };
const LockService = { getScriptLock() { return { tryLock() { return true; }, releaseLock() {} }; } };
let PROPS = {}; const PROPS_DIRTY = {};
async function loadProps() { const { data } = await SB.from("ol_props").select("key,value"); PROPS = {}; (data || []).forEach((p) => { PROPS[p.key] = p.value; }); }
const PropertiesService = { getScriptProperties() { return {
  getProperty(k) { return k in PROPS ? PROPS[k] : null; },
  setProperty(k, v) { PROPS[k] = String(v); PROPS_DIRTY[k] = true; }
}; } };
function fmtParts(d, tz) {
  const p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" })
    .formatToParts(d).forEach((x) => { p[x.type] = x.value; }); return p;
}
const Utilities = {
  formatDate(d, tz, f) {
    const p = fmtParts(d, tz);
    const u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday];
    if (f === "H") return String(Number(p.hour));
    if (f === "u") return String(u);
    return f.replace("yyyy", p.year).replace("MM", p.month).replace("dd", p.day).replace("HH", p.hour).replace("mm", p.minute);
  },
  getUuid() { return crypto.randomUUID(); }
};
const ScriptApp = { getProjectTriggers() { return []; }, deleteTrigger() {}, newTrigger() { return { timeBased() { return this; }, everyMinutes() { return this; }, everyDays() { return this; }, atHour() { return this; }, inTimezone() { return this; }, create() {} }; } };
const ContentService = { MimeType: {}, createTextOutput(s) { return s; } };
const UrlFetchApp = { fetch() { throw new Error("not available"); } };

/* ======== السكربت الأصلي (online-learning-script.gs) ======== */
/**
 * ==================================================================
 *  خادم «التعليم أونلاين» — Google Apps Script
 *  وحدة مهارات القرن 21 — مدارس دار الذكر
 * ==================================================================
 *  الفكرة: جدول Google يبقى «مقيَّدًا» (لا يراه أحد غيرك).
 *  هذا السكربت يعمل بصلاحيتك، فيقرأ الجدول ويرسل للطالب
 *  روابط وجدول فصله فقط — بعد التحقق من «رمز الدخول».
 *
 *  التركيب (مرة واحدة):
 *   1) افتح جدول Google ← الإضافات (Extensions) ← Apps Script
 *   2) احذف أي كود موجود والصق هذا الملف كاملًا ← احفظ
 *   3) نشر (Deploy) ← نشر جديد (New deployment) ← النوع: تطبيق ويب (Web app)
 *        التنفيذ باسم (Execute as): أنا (Me)
 *        من يمكنه الوصول (Who has access): أي شخص (Anyone)
 *   4) انسخ رابط /exec وضعه في SCRIPT_URL داخل online-learning.html
 *  بعد أي تعديل على هذا الكود: نشر ← إدارة عمليات النشر ← تعديل ← إصدار جديد
 *  (تعديل بيانات الجدول نفسه لا يحتاج أي نشر.)
 * ==================================================================
 */

const TABS = {
  links:       "الروابط",
  schedule:    "الجدول",
  timing:      "التوقيت",
  supervisors: "المشرفون",
  supCodes:    "رموز المشرفين",
  subjSup:     "مشرفو المواد",
  dated:       "حصص بالتاريخ",
  subjects:    "المواد",
  teacherCodes: "رموز المعلمين",
  accounts:    "الحسابات"
};
// الدخول بحساب المدرسة من Google: الإيميل ← «رمز الدخول» الذي يحدد صلاحيته (في ورقة «الحسابات»)
const GOOGLE_CLIENT_ID = "671363806838-cmjkkjv91v0nuqar7gn7i1q6mmlnu4qc.apps.googleusercontent.com";
const SCHOOL_DOMAIN = "althikr.edu.sa";
const SESSION_DAYS = 60;   // مدة بقاء الدخول على الجهاز قبل طلب الدخول بحساب Google مرة أخرى
// مدير النظام: الوحيد الذي يرى زر «إيقاف التعليم عن بعد» ويستطيع الدخول أثناء الإيقاف (بإيميله عند الدخول بحساب Google)
const SYSTEM_ADMINS = ["m.hussien@althikr.edu.sa"];
// أوراق السجل والتقارير (يُنشئها السكربت تلقائيًا عند الحاجة، ولا تُقرأ مع بيانات الطلاب)
const LOG_TAB    = "سجل الدخول";
const REPORT_TAB = "التقارير اليومية";
const REPORT_HOUR = 14;        // ساعة قفل تقرير اليوم: لا يُحسب أي دخول بعدها، وفيها يعمل الحفظ التلقائي (بعد تغييرها شغّل setupDailyReport مرة)
const MIN_ATTEND_MIN = 5;      // أقل مدة (بالدقائق) ليُحسب الطالب حاضرًا، أو لتُحسب الحصة منفذة
const LOG_KEEP_DAYS = 90;      // مدة الاحتفاظ بسجل ضغطات الدخول
const TZ = "Asia/Riyadh";
const SERVER_VER = "2026-11-07g";   // غيّره مع أي تعديل في الكود: تُهمل الردود المحفوظة من النسخة السابقة فورًا
const CACHE_SECONDS = 60;   // نسخة مؤقتة من الجدول خارج وقت الدوام
const CACHE_SCHOOL_SECONDS = 300;   // وقت الدوام: التحديث التلقائي (warmCache) يجدّدها كل دقيقة، وهذه مدة أمان فقط
const SCHOOL_HOURS = [6, 15];       // من 6 ص إلى 3 م (الأحد–الخميس): وقت الضغط العالي

// الحماية من تخمين الرموز (الرموز 4 أرقام فقط، لذلك نحدّ من المحاولات الخاطئة):
// إذا تجاوزت المحاولات الخاطئة هذا العدد خلال 10 دقائق، يتوقف قبول الرموز مؤقتًا.
// الطلاب الذين دخلوا قبل ذلك تبقى بياناتهم ظاهرة على أجهزتهم.
const MAX_FAILS_10MIN = 600;   // محاولات رموز خاطئة (من كل الأجهزة) قبل تفعيل الحماية
const LOCK_MINUTES    = 10;    // الحماية ترفض الرموز غير الصحيحة فقط — الرموز الصحيحة تعمل دائمًا

/* ---------------- إيقاف التعليم عن بعد (مدير النظام فقط) ----------------
   الحالة محفوظة في إعدادات السكربت (OL_PAUSED) ونسخة سريعة في الذاكرة المؤقتة.
   أثناء الإيقاف: كل الرموز والحسابات تُرفض برسالة paused، إلا مدير النظام الداخل بحساب Google. */
/* isSysAdmin_ — مُعاد تعريفه في آخر الملف */
/* adminFromCode_ — مُعاد تعريفه في آخر الملف */
function isPaused_() {
  const c = CacheService.getScriptCache();
  const v = c.get("ol-paused");
  if (v !== null) return v === "1";
  const p = PropertiesService.getScriptProperties().getProperty("OL_PAUSED") === "1";
  try { c.put("ol-paused", p ? "1" : "0", 120); } catch (e) {}
  return p;
}
function setPause_(body) {
  const email = adminFromCode_(body.code);
  if (!email) return { ok: false, error: "forbidden" };
  const on = !!body.paused;
  PropertiesService.getScriptProperties().setProperty("OL_PAUSED", on ? "1" : "0");
  PropertiesService.getScriptProperties().setProperty("OL_PAUSED_AT", Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm") + " — " + email);
  CacheService.getScriptCache().put("ol-paused", on ? "1" : "0", 120);
  return { ok: true, paused: on };
}
/* طلب البيانات من الصفحة: يمر على حالة الإيقاف أولًا */
function gate_(rawCode) {
  const admin = adminFromCode_(rawCode);
  const paused = isPaused_();
  if (paused && !admin) return { ok: false, error: "paused" };
  const out = cachedHandle_(rawCode);
  if (!admin || !out || !out.ok) return out;
  const o = JSON.parse(JSON.stringify(out));
  o.sysAdmin = true; o.paused = paused;
  return o;
}

/* التحقق من أن الرمز رمز مدير (ورقة «رموز المشرفين») وإرجاع نطاقه وفصوله */
function editorAuth_(rawCode) {
  const sc = sessionCode_(rawCode); if (sc.error) return { error: "invalid" };
  const code = normCode_(sc.code);
  if (code.length < 6) { const d = deny_(); return { error: d.error }; }
  const T = readAll_();
  if (!T.supCodes || !T.links) return { error: "setup" };
  const sx = colIndex_(T.supCodes.headers);
  const grades = {}; let name = "";
  if (sx.code >= 0) T.supCodes.rows.forEach(function (r) {
    if (normCode_(r[sx.code]) !== code) return;
    parseScope_(sx.scope >= 0 ? r[sx.scope] : "").forEach(function (g) { grades[g] = true; });
    if (sx.name >= 0 && r[sx.name]) name = String(r[sx.name]);
  });
  if (!Object.keys(grades).length) { const d = deny_(); return { error: d.error }; }
  if (sc.name) name = sc.name;   // الداخل بحساب Google: اسمه هو يظهر في «أُدخلت بواسطة»
  // فصول النطاق كما هي في ورقة «الروابط»: المفتاح ← خلايا الصف والفصول
  const lx = colIndex_(T.links.headers); const rooms = {};
  T.links.rows.forEach(function (r) {
    const gid = parseGrade_(r[lx.scope]); if (!gid || !grades[gid]) return;
    const cls = lx.cls >= 0 ? String(r[lx.cls] || "") : "";
    rooms[gid + "|" + classKey_(cls)] = { grade: String(r[lx.scope]), cls: cls };
  });
  return { T: T, grades: grades, rooms: rooms, name: name };
}

function todayStr_(offsetDays) {
  return Utilities.formatDate(new Date(Date.now() + (offsetDays || 0) * 86400000), TZ, "yyyy-MM-dd");
}
function normDate_(s) {
  s = norm_(s).replace(/\//g, "-");
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return m[1] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[3]).slice(-2);
  m = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);   // يوم-شهر-سنة
  if (m) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
  return "";
}

/* حصص يوم معيّن ضمن نطاق المدير (لتعبئة النموذج) */
function listDay_(body) {
  const A = editorAuth_(body.code); if (A.error) return { ok: false, error: A.error };
  const date = normDate_(body.date); if (!date) return { ok: false, error: "date" };
  const D = A.T.dated; const out = [];
  if (D) {
    const dx = datedIndex_(D.headers);
    D.rows.forEach(function (r) {
      if (normDate_(r[dx.date]) !== date) return;
      const gid = parseGrade_(r[dx.grade]); if (!gid) return;
      const key = gid + "|" + classKey_(r[dx.cls]);
      if (!A.rooms[key]) return;
      out.push({ room: key, p: String(r[dx.p] || ""), start: String(r[dx.start] || ""), end: String(r[dx.end] || ""),
        subject: String(r[dx.subject] || ""), teacher: String(r[dx.teacher] || ""), link: String(r[dx.link] || "") });
    });
  }
  return { ok: true, date: date, entries: out };
}

/* حفظ حصص يوم أو عدة أيام: يستبدل حصص الفصول المحددة في تلك الأيام */
function saveDays_(body) {
  const A = editorAuth_(body.code); if (A.error) return { ok: false, error: A.error };
  const minD = todayStr_(-7), maxD = todayStr_(180);
  const dates = (body.dates || []).map(normDate_).filter(function (d) { return d && d >= minD && d <= maxD; });
  if (!dates.length || dates.length > 60) return { ok: false, error: "date" };
  const rooms = (body.rooms || []).filter(function (k) { return A.rooms[k]; });
  const entries = body.entries || [];
  if (entries.length > 400) return { ok: false, error: "tooMany" };
  const clean = [];
  for (let i = 0; i < entries.length; i++) {
    const x = entries[i] || {};
    const room = A.rooms[x.room];
    if (!room) return { ok: false, error: "room", row: i + 1 };
    const p = parseInt(norm_(x.p), 10);
    if (!(p >= 1 && p <= 12)) return { ok: false, error: "period", row: i + 1 };
    const subject = String(x.subject || "").trim().slice(0, 80);
    if (!subject) return { ok: false, error: "subject", row: i + 1 };
    const link = String(x.link || "").trim().slice(0, 300);
    if (link && !/^https:\/\/[\w.-]+\.[a-z]{2,}(\/|$)/i.test(link)) return { ok: false, error: "link", row: i + 1 };
    const time = function (v) { v = norm_(v); return /^\d{1,2}:\d{2}$/.test(v) ? v : ""; };
    clean.push({ key: x.room, room: room, p: String(p), start: time(x.start), end: time(x.end), subject: subject,
      teacher: String(x.teacher || "").trim().slice(0, 80), link: link });
    if (rooms.indexOf(x.room) < 0) rooms.push(x.room);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: "busy" };
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = findSheets_(ss).dated;
    if (!sh) return { ok: false, error: "setup" };
    const lastRow = sh.getLastRow(), lastCol = Math.max(11, sh.getLastColumn());
    const all = sh.getRange(1, 1, Math.max(1, lastRow), lastCol).getDisplayValues();
    const headers = all[0]; const dx = datedIndex_(headers);
    const keepRows = all.slice(1).filter(function (r) {
      if (!r.some(function (c) { return String(c).trim(); })) return false;
      const d = normDate_(r[dx.date]);
      if (dates.indexOf(d) < 0) return true;
      const gid = parseGrade_(r[dx.grade]);
      return !(gid && rooms.indexOf(gid + "|" + classKey_(r[dx.cls])) >= 0);
    });
    const stamp = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm");
    const added = [];
    dates.forEach(function (d) {
      clean.forEach(function (c) {
        const row = new Array(lastCol).fill("");
        row[dx.date] = d; row[dx.grade] = c.room.grade; row[dx.cls] = c.room.cls; row[dx.p] = c.p;
        row[dx.start] = c.start; row[dx.end] = c.end; row[dx.subject] = c.subject; row[dx.teacher] = c.teacher;
        row[dx.link] = c.link; if (dx.by >= 0) row[dx.by] = A.name; if (dx.at >= 0) row[dx.at] = stamp;
        added.push(row);
      });
    });
    const rows = keepRows.concat(added).sort(function (a, b) {
      return String(a[dx.date]).localeCompare(String(b[dx.date])) || String(a[dx.grade]).localeCompare(String(b[dx.grade]))
        || String(a[dx.cls]).localeCompare(String(b[dx.cls])) || (parseInt(a[dx.p], 10) - parseInt(b[dx.p], 10));
    });
    // نكتب فوق القديم مباشرة ثم نمسح الزائد فقط (بدون لحظة يكون فيها الجدول فارغًا)
    if (rows.length) {
      const rg = sh.getRange(2, 1, rows.length, lastCol);
      rg.setNumberFormat("@");
      rg.setValues(rows);
    }
    if (lastRow - 1 > rows.length) sh.getRange(rows.length + 2, 1, lastRow - 1 - rows.length, lastCol).clearContent();
    SpreadsheetApp.flush();
    refreshData_();
    return { ok: true, saved: added.length, dates: dates.length };
  } finally { lock.releaseLock(); }
}

/* تعديل الرابط الثابت ومسؤول الرابط لفصول ضمن نطاق المدير (ورقة «الروابط») */
function saveLinks_(body) {
  const A = editorAuth_(body.code); if (A.error) return { ok: false, error: A.error };
  const items = (body.links || []).slice(0, 80);
  const want = {};
  for (let i = 0; i < items.length; i++) {
    const x = items[i] || {};
    if (!A.rooms[x.room]) return { ok: false, error: "room", row: i + 1 };
    let link = String(x.link || "").trim().slice(0, 300);
    const m = link.match(/^https?:\/\/meet\.google\.com\/(?:meet\/)?([a-z]{3}-[a-z]{4}-[a-z]{3})/i);
    if (m) link = "https://meet.google.com/" + m[1].toLowerCase();
    if (!/^https:\/\/[\w.-]+\.[a-z]{2,}(\/|$)/i.test(link)) return { ok: false, error: "link", room: A.rooms[x.room].grade + " " + A.rooms[x.room].cls };
    want[x.room] = { link: link, owner: String(x.owner || "").trim().slice(0, 80) };
  }
  if (!Object.keys(want).length) return { ok: true, saved: 0 };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: "busy" };
  try {
    const sh = findSheets_(SpreadsheetApp.getActiveSpreadsheet()).links;
    if (!sh) return { ok: false, error: "setup" };
    const n = sh.getLastRow(), w = sh.getLastColumn();
    const vals = sh.getRange(1, 1, n, w).getDisplayValues();
    const H = vals[0], lx = colIndex_(H);
    const cLink = findCol_(H, ["رابط الحصه", "رابط الفصل", "الرابط", "link", "url"]);
    const cOwner = findCol_(H, ["مسؤول الرابط", "المسؤول", "host", "owner"]);
    if (cLink < 0 || lx.scope < 0) return { ok: false, error: "setup" };
    let saved = 0;
    for (let r = 1; r < n; r++) {
      const gid = parseGrade_(vals[r][lx.scope]); if (!gid) continue;
      const key = gid + "|" + classKey_(lx.cls >= 0 ? vals[r][lx.cls] : "");
      const x = want[key]; if (!x) continue;
      sh.getRange(r + 1, cLink + 1).setValue(x.link);
      if (cOwner >= 0) sh.getRange(r + 1, cOwner + 1).setValue(x.owner);
      saved++;
    }
    SpreadsheetApp.flush();
    refreshData_();
    return { ok: true, saved: saved };
  } finally { lock.releaseLock(); }
}

function datedIndex_(headers) {
  const f = function (names) { return findCol_(headers, names); };
  return {
    date: f(["التاريخ", "date"]), grade: f(["الصف", "grade"]), cls: f(["الفصول", "الفصل", "classes", "class"]),
    p: f(["الحصه", "period"]), start: f(["من", "start", "from"]), end: f(["الي", "end", "to"]),
    subject: f(["الماده", "subject"]), teacher: f(["المعلم", "المعلمه", "teacher"]), link: f(["رابط الحصه", "الرابط", "link"]),
    by: f(["ادخلت بواسطه", "by"]), at: f(["وقت الادخال", "saved at"])
  };
}

/* زر تجربة من داخل محرر Apps Script: غيّر الرمز ثم شغّل الدالة وانظر في السجل */
/* testCode — مُعاد تعريفه في آخر الملف */

/* ---------------- المنطق ---------------- */
function handle_(rawCode) {
  const code = normCode_(rawCode);
  if (code.length < 4) return deny_();

  const T = readAll_();
  const links = T.links;
  if (!links) return { ok: false, error: "setup" };

  const ix = colIndex_(links.headers);
  if (ix.code < 0 || ix.scope < 0) return { ok: false, error: "setup" };

  let allowedRooms = null;   // مفاتيح الفصول المسموحة (لرمز فصل)
  let allowedGrades = {};    // الصفوف المسموحة

  // 1) رمز فصل؟
  links.rows.forEach(function (r) {
    if (normCode_(r[ix.code]) !== code) return;
    const gid = parseGrade_(r[ix.scope]);
    if (!gid) return;
    allowedRooms = allowedRooms || {};
    allowedRooms[gid + "|" + classKey_(ix.cls >= 0 ? r[ix.cls] : "")] = true;
    allowedGrades[gid] = true;
  });

  // 2) رمز مشرف؟ (يرى كل فصول النطاق المحدد)
  let label = "";
  let editor = false;
  if (!allowedRooms && T.supCodes) {
    const sx = colIndex_(T.supCodes.headers);
    if (sx.code >= 0) T.supCodes.rows.forEach(function (r) {
      if (normCode_(r[sx.code]) !== code) return;
      editor = true;
      parseScope_(sx.scope >= 0 ? r[sx.scope] : "").forEach(function (g) { allowedGrades[g] = true; });
      if (sx.name >= 0 && r[sx.name]) label = String(r[sx.name]);
    });
  }
  // 2ب) رمز معلمين؟ (يرى روابط وجداول فصول نطاقه فقط — بدون إدخال جداول ولا تقارير)
  //     إن كُتب اسم في عمود «المعلم»: رمز شخصي لمعلم واحد — يرى حصصه هو فقط وفصولها
  let teacherNames = null;
  if (!allowedRooms && !Object.keys(allowedGrades).length && T.teacherCodes) {
    const tx = colIndex_(T.teacherCodes.headers);
    const tc = findCol_(T.teacherCodes.headers, ["المعلم", "المعلمه", "اسم المعلم في الجدول", "teacher"]);
    if (tx.code >= 0) T.teacherCodes.rows.forEach(function (r) {
      if (normCode_(r[tx.code]) !== code) return;
      parseScope_(tx.scope >= 0 ? r[tx.scope] : "").forEach(function (g) { allowedGrades[g] = true; });
      if (tx.name >= 0 && r[tx.name]) label = String(r[tx.name]);
      const tn = tc >= 0 ? String(r[tc] || "").split(/[،,\/]+/).map(normKey_).filter(Boolean) : [];
      if (tn.length) teacherNames = (teacherNames || []).concat(tn);
    });
  }
  // 3) رمز مشرف مادة؟ (يرى حصص مواده فقط، في النطاق المحدد)
  let subjectKw = null, supName = "";
  if (!allowedRooms && !Object.keys(allowedGrades).length && T.subjSup) {
    const mx = colIndex_(T.subjSup.headers);
    if (mx.code >= 0) T.subjSup.rows.forEach(function (r) {
      if (normCode_(r[mx.code]) !== code) return;
      // قسم البنات لا يظهر لمشرفي المواد إلا إذا ذُكر «بنات» صراحة في نطاق المشرف
      const sc = mx.scope >= 0 ? r[mx.scope] : "";
      const girlsOk = /بنات|girls/.test(norm_(sc));
      parseScope_(sc).forEach(function (g) { if (/^girls/.test(g) && !girlsOk) return; allowedGrades[g] = true; });
      subjectKw = parseKeywords_(mx.kw >= 0 ? r[mx.kw] : "");
      if (mx.name >= 0 && r[mx.name]) label = String(r[mx.name]);
      supName = mx.name >= 0 ? String(r[mx.name] || "") : "";
    });
  }
  if (!Object.keys(allowedGrades).length) return deny_();

  const SM = subjectMap_(T);
  const owns = function (subject) { return ownsSubject_(subject, supName, subjectKw, SM); };
  // ما يراه صاحب الرمز من الحصص: مشرف المادة ← مواده، والمعلم ← حصصه هو (بالاسم كما في الجدول)
  const filtered = !!(subjectKw || teacherNames);
  const keep = function (subject, teacher) {
    if (teacherNames) return teacherNames.indexOf(normKey_(teacher)) >= 0;
    return owns(subject);
  };
  if (filtered) {
    // نحصر الفصول والصفوف في التي فيها حصة واحدة على الأقل من مواده
    const sx = T.schedule ? colIndex_(T.schedule.headers) : {};
    const subjCol = T.schedule ? findCol_(T.schedule.headers, ["الماده", "subject"]) : -1;
    const tchCol = T.schedule ? findCol_(T.schedule.headers, ["المعلم", "المعلمه", "teacher"]) : -1;
    allowedRooms = {};
    const grades2 = {};
    if (T.schedule && sx.scope >= 0 && subjCol >= 0) T.schedule.rows.forEach(function (r) {
      const gid = parseGrade_(r[sx.scope]);
      if (!gid || !allowedGrades[gid] || !keep(r[subjCol], tchCol >= 0 ? r[tchCol] : "")) return;
      allowedRooms[gid + "|" + classKey_(sx.cls >= 0 ? r[sx.cls] : "")] = true;
      grades2[gid] = true;
    });
    if (T.dated) { const dx = datedIndex_(T.dated.headers); T.dated.rows.forEach(function (r) {
      const gid = parseGrade_(r[dx.grade]);
      if (!gid || !allowedGrades[gid] || !keep(r[dx.subject], dx.teacher >= 0 ? r[dx.teacher] : "")) return;
      allowedRooms[gid + "|" + classKey_(r[dx.cls])] = true; grades2[gid] = true;
    }); }
    allowedGrades = grades2;
    if (!Object.keys(allowedGrades).length) return { ok: true, label: label, mode: teacherNames ? "teacher" : "subject", grades: [],
      links: { headers: [], rows: [] }, schedule: { headers: [], rows: [] }, timing: { headers: [], rows: [] }, supervisors: { headers: [], rows: [] } };
  }

  const roomOk = function (scopeCell, clsCell) {
    const gid = parseGrade_(scopeCell);
    if (!gid || !allowedGrades[gid]) return false;
    return !allowedRooms || !!allowedRooms[gid + "|" + classKey_(clsCell)];
  };
  const scopeOk = function (scopeCell) {
    return parseScope_(scopeCell).some(function (g) { return allowedGrades[g]; });
  };

  let schedule = filterTable_(T.schedule, roomOk, false);
  if (filtered) {
    const c = findCol_(schedule.headers, ["الماده", "subject"]), ct = findCol_(schedule.headers, ["المعلم", "المعلمه", "teacher"]);
    schedule = { headers: schedule.headers, rows: schedule.rows.filter(function (r) { return c >= 0 && keep(r[c], ct >= 0 ? r[ct] : ""); }) };
  }
  // الحصص المُدخلة بالتاريخ (من أمس إلى 30 يومًا قادمة)
  let dated = { headers: [], rows: [] }, datedDays = [];
  if (T.dated) {
    const dx = datedIndex_(T.dated.headers), d0 = todayStr_(-1), d1 = todayStr_(30);
    const f = filterTable_(T.dated, roomOk, false);
    const fx = datedIndex_(f.headers);
    dated = { headers: f.headers.slice(0, 9), rows: f.rows.filter(function (r) {
      const d = normDate_(r[fx.date]);
      return d >= d0 && d <= d1 && (!filtered || keep(r[fx.subject], fx.teacher >= 0 ? r[fx.teacher] : ""));
    }).map(function (r) { return r.slice(0, 9); }) };
    // لمشرف المادة: الأيام التي لها حصص مُدخلة بالتاريخ لكل فصل (حتى لو لم تكن فيها حصص من مواده)
    // حتى لا تعرض الصفحة الجدول الأسبوعي القديم في يوم له جدول خاص
    if (filtered) {
      const seen = {};
      f.rows.forEach(function (r) {
        const d = normDate_(r[fx.date]); if (!(d >= d0 && d <= d1)) return;
        const k = r[fx.grade] + "\u0001" + r[fx.cls] + "\u0001" + d; if (seen[k]) return;
        seen[k] = [String(r[fx.grade] || ""), String(r[fx.cls] || ""), d];
      });
      datedDays = Object.keys(seen).map(function (k) { return seen[k]; });
    }
  }
  return {
    ok: true,
    label: label,
    editor: editor,
    subjects: editor ? SM.list : [],
    today: todayStr_(0),
    dated: dated,
    datedDays: datedDays,
    mode: teacherNames ? "teacher" : subjectKw ? "subject" : (allowedRooms ? "class" : "stage"),
    grades: Object.keys(allowedGrades),
    links:       filterTable_(links, roomOk, true),
    schedule:    schedule,
    timing:      filterTable_(T.timing, null, false, scopeOk),
    supervisors: filterTable_(T.supervisors, null, false, scopeOk)
  };
}

function deny_() {
  // أثناء الحماية: الرمز الخاطئ يُرفض فورًا (الرموز الصحيحة لا تصل إلى هنا أصلًا)
  if (isLocked_()) return { ok: false, error: "busy" };
  recordFail_();
  return { ok: false, error: "invalid" };
}

/* عدّاد المحاولات الخاطئة في آخر 10 دقائق (خانة لكل دقيقة) */
function recordFail_() {
  const c = CacheService.getScriptCache();
  const k = "ol-fail-" + Math.floor(Date.now() / 60000);
  const n = Number(c.get(k) || 0) + 1;
  c.put(k, String(n), 900);
  let total = 0;
  const now = Math.floor(Date.now() / 60000);
  const keys = []; for (let i = 0; i < 10; i++) keys.push("ol-fail-" + (now - i));
  const got = c.getAll(keys);
  keys.forEach(function (x) { total += Number(got[x] || 0); });
  if (total > MAX_FAILS_10MIN) c.put("ol-lock", "1", LOCK_MINUTES * 60);
}
function isLocked_() { return CacheService.getScriptCache().get("ol-lock") === "1"; }

/* يرجع نسخة من الورقة فيها الأسطر المسموحة فقط، ويحذف عمود الرمز دائمًا */
function filterTable_(tbl, roomOk, isLinks, scopeOk) {
  if (!tbl) return { headers: [], rows: [] };
  const ix = colIndex_(tbl.headers);
  const keep = tbl.headers.map(function (_, i) { return i !== ix.code; });
  const rows = tbl.rows.filter(function (r) {
    if (roomOk) return ix.scope >= 0 && roomOk(r[ix.scope], ix.cls >= 0 ? r[ix.cls] : "");
    if (scopeOk) return ix.scope >= 0 && scopeOk(r[ix.scope]);
    return false;
  }).map(function (r) { return r.filter(function (_, i) { return keep[i]; }); });
  return { headers: tbl.headers.filter(function (_, i) { return keep[i]; }), rows: rows };
}

/* ---------------- قراءة الجدول (مع نسخة مؤقتة) ---------------- */
let DATA_ = null, DATA_VER_ = "";   // نسخة واحدة لكل تنفيذ
/* readAll_ — مُعاد تعريفه في آخر الملف */
function inSchoolHours_() {
  const d = new Date(), wd = Number(Utilities.formatDate(d, TZ, "u")) % 7;   // u: 1=الاثنين … 7=الأحد ← 0=الأحد
  const h = Number(Utilities.formatDate(d, TZ, "H"));
  return wd <= 4 && h >= SCHOOL_HOURS[0] && h < SCHOOL_HOURS[1];
}
function readSheet_(cache) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = {};
  const found = findSheets_(ss);
  Object.keys(TABS).forEach(function (k) {
    if (k === "accounts") return;   // «الحسابات» لها نسخة مؤقتة منفصلة (accountsMap_) — لا تُحمَّل مع كل طلب
    const sh = found[k];
    if (!sh || sh.getLastRow() < 1) return;
    const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues();
    out[k] = {
      headers: vals[0].map(String),
      rows: vals.slice(1).filter(function (r) { return r.some(function (c) { return String(c).trim(); }); })
    };
  });
  DATA_ = out;
  DATA_VER_ = cachePutBig_(cache, "ol-data", JSON.stringify(out), inSchoolHours_() ? CACHE_SCHOOL_SECONDS : CACHE_SECONDS) || String(Date.now());
  return out;
}

/* ---------------- الدخول بحساب المدرسة (Google) ---------------- */
/* الصفحة ترسل «بطاقة الدخول» من Google؛ نتحقق منها عند Google نفسها، ثم نعطي الجهاز «جلسة» موقّعة
   (لا يمكن تزويرها بدون المفتاح السري المحفوظ في إعدادات السكربت) */
/* gsignin_ — مُعاد تعريفه في آخر الملف */
function isStudentEmail_(email) { return /^\d{5,20}@/.test(String(email || "")) && String(email).slice(-(SCHOOL_DOMAIN.length + 1)) === "@" + SCHOOL_DOMAIN; }

/* ربط الطالب بفصله أول مرة: يكتب رمز فصله (من ورقة «الروابط» فقط — رموز المشرفين والمعلمين لا تُقبل هنا)،
   فيُضاف سطر باسمه في «الحسابات» ويظهر أمام الإدارة (تقدر تعدّله أو تمسحه في أي وقت) */
function bind_(body) {
  const sess = normCode_(body.session);
  if (!isSession_(sess)) return { ok: false, error: "session" };
  const s = parseSession_(sess); if (!s) return { ok: false, error: "session" };
  if (!isStudentEmail_(s.email)) return { ok: false, error: "noaccount", email: s.email };
  const had = accountFor_(s.email);
  if (had) return { ok: true, already: true };                    // مربوط من قبل: لا نغيّر شيئًا
  const T = readAll_(); if (!T.links) return { ok: false, error: "setup" };
  const ix = colIndex_(T.links.headers); if (ix.code < 0) return { ok: false, error: "setup" };
  let row = null, how = "";
  if (body.pick != null && body.pick !== "") {
    // اختيار الفصل من القائمة: رقم سطره في ورقة «الروابط» + نص الصف والفصل للتأكد أن القائمة لم تتغيّر
    const i = Number(body.pick), r = T.links.rows[i];
    if (!(i >= 0) || !r || normCode_(r[ix.code]).length < 4 || String(r[ix.scope] || "") !== String(body.g || "") ||
        (ix.cls >= 0 ? String(r[ix.cls] || "") : "") !== String(body.c || "")) return { ok: false, error: "stale" };
    row = r; how = "اختيار من القائمة";
  } else {
    const code = normCode_(body.code);
    if (code.length < 4 || code.length > 12) return deny_();
    row = T.links.rows.find(function (r) { return normCode_(r[ix.code]) === code; });
    if (!row) return deny_();
    how = "برمز الفصل";
  }
  const code = normCode_(row[ix.code]);
  const sh = accountsSheet_();
  const when = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm");
  sh.appendRow([s.email, s.name || "", code, "", "تسجيل ذاتي (" + how + ") " + when + " — " + String(row[ix.scope] || "") + (ix.cls >= 0 && row[ix.cls] ? " " + row[ix.cls] : "")]);
  const a = { e: s.email, n: s.name || "", c: code, s: "" };
  try { CacheService.getScriptCache().put("ol-a|" + s.email, JSON.stringify(a), ACCT_SECONDS); } catch (e) {}
  return { ok: true };
}
/* قائمة الفصول لاختيار الطالب فصله (للطالب الداخل بحساب المدرسة فقط — بدون أي رموز) */
function classList_(body) {
  const sess = normCode_(body.session);
  if (!isSession_(sess)) return { ok: false, error: "session" };
  const s = parseSession_(sess); if (!s) return { ok: false, error: "session" };
  if (!isStudentEmail_(s.email)) return { ok: false, error: "noaccount", email: s.email };
  const T = readAll_(); if (!T.links) return { ok: false, error: "setup" };
  const ix = colIndex_(T.links.headers); if (ix.code < 0) return { ok: false, error: "setup" };
  const list = [];
  T.links.rows.forEach(function (r, i) {
    if (normCode_(r[ix.code]).length < 4) return;
    list.push({ i: i, g: String(r[ix.scope] || ""), c: ix.cls >= 0 ? String(r[ix.cls] || "") : "" });
  });
  return { ok: true, classes: list };
}
/* sessionSecret_ — مُعاد تعريفه في آخر الملف */
/* hexOf_ — مُعاد تعريفه في آخر الملف */
/* الجلسة = إيميل|يوم الانتهاء|الاسم من Google (موقّعة) */
/* makeSession_ — مُعاد تعريفه في آخر الملف */
/* isSession_ — مُعاد تعريفه في آخر الملف */
/* parseSession_ — مُعاد تعريفه في آخر الملف */

/* ---- ورقة «الحسابات»: نسخة مؤقتة منفصلة عن بيانات الجداول ----
   (آلاف الطلاب: لا نحمّلها مع كل طلب؛ لكل إيميل نسخة صغيرة، والجدول كله يُقرأ مرة كل بضع دقائق) */
const ACCT_SECONDS = 300;
let ACCT_ = null;
function accountsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = findSheets_(ss).accounts || ss.getSheetByName(TABS.accounts);
  if (!sh) {
    sh = ss.insertSheet(TABS.accounts);
    sh.getRange(1, 1, 1, 5).setValues([["الإيميل", "الاسم", "رمز الدخول", "رقم الطالب", "ملاحظات"]]).setFontWeight("bold");
    sh.setFrozenRows(1); sh.getRange("A:E").setNumberFormat("@");
  }
  return sh;
}
function readAccounts_() {
  const sh = accountsSheet_(); const map = {};
  if (sh.getLastRow() >= 2) {
    const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(1, sh.getLastColumn())).getDisplayValues();
    const h = vals[0].map(String);
    const cE = findCol_(h, ["الايميل", "البريد الالكتروني", "البريد", "email"]);
    const cN = findCol_(h, ["الاسم", "name"]);
    const cC = colIndex_(h).code;
    const cS = findCol_(h, ["رقم الطالب", "الرقم", "student number", "student id"]);
    if (cE >= 0 && cC >= 0) vals.slice(1).forEach(function (r) {
      const e = String(r[cE] || "").trim().toLowerCase(), c = String(r[cC] || "").trim();
      if (!e || !c || map[e]) return;                                   // أول سطر للإيميل هو المعتمد
      map[e] = { e: e, n: cN >= 0 ? String(r[cN] || "").trim() : "", c: c, s: cS >= 0 ? String(r[cS] || "").trim() : "" };
    });
  }
  return map;
}
/* accountsMap_ — مُعاد تعريفه في آخر الملف */
/* حساب إيميل: النسخة الصغيرة الخاصة به أولًا، ثم نسخة الجدول كله */
/* accountFor_ — مُعاد تعريفه في آخر الملف */
/* أي «رمز» يصل للخادم: جلسة Google ← رمز صلاحية صاحبها؛ أو رمز عادي كما هو */
/* sessionCode_ — مُعاد تعريفه في آخر الملف */
/* إعداد الدخول بحساب Google مرة واحدة من المحرر: ينشئ ورقة «الحسابات» ويطلب صلاحية الاتصال بـ Google */
/* setupGoogleSignIn — مُعاد تعريفه في آخر الملف */

/* رد رمز الدخول من نسخة مؤقتة (لكل رمز، مرتبطة بإصدار البيانات واليوم) — الطالب لا ينتظر حساب جدوله من جديد */
function cachedHandle_(rawCode) {
  const code = normCode_(rawCode);
  if (isSession_(code)) {
    const sc = sessionCode_(code);
    if (sc.error) return { ok: false, error: sc.error, email: sc.email || "", name: sc.name || "" };
    const base = cachedHandle_(sc.code);
    if (!base || !base.ok) return base;
    const out = JSON.parse(JSON.stringify(base));
    out.label = sc.name || out.label; out.me = { email: sc.email, name: sc.name, sno: sc.sno || "" };
    return out;
  }
  if (code.length < 4 || code.length > 12) return handle_(rawCode);
  readAll_();
  const cache = CacheService.getScriptCache();
  const key = "ol-r|" + SERVER_VER + "|" + DATA_VER_ + "|" + todayStr_(0) + "|" + code;
  const hit = cache.get(key);
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  const out = handle_(rawCode);
  // نحفظ ردود الفصول (صغيرة) فقط؛ ردود المديرين كبيرة وقليلة العدد فتُحسب مباشرة
  if (out && out.ok) { const js = JSON.stringify(out); if (js.length < 30000) { try { cache.put(key, js, 150); } catch (e) {} } }
  return out;
}

/* التحديث التلقائي كل دقيقة وقت الدوام: يقرأ الجدول ويجهّز ردود رموز الفصول مسبقًا،
   فلا يقرأ أي طالب الجدول بنفسه، وتظهر تعديلاتك المباشرة في الجدول خلال دقيقة.
   يُضبط مرة واحدة بتشغيل setupWarmCache من المحرر */
/* warmCache — مُعاد تعريفه في آخر الملف */
/* setupWarmCache — مُعاد تعريفه في آخر الملف */
/* بعد أي حفظ من الصفحة: نسخة جديدة فورًا بدل حذف النسخة (حتى لا يقرأ المئات الجدول معًا بعده) */
function refreshData_() {
  try { CacheService.getScriptCache().remove("ol-data"); DATA_ = null; readAll_(true); } catch (e) { console.error(e); }
}
/* نسخة مؤقتة لنص كبير: حد القيمة الواحدة في CacheService حوالي 100KB، فنقسّم النص على أجزاء
   (كل جزء 30 ألف حرف ≈ 90KB كحد أقصى للعربي) ونحفظها مع مفتاح رئيسي فيه عدد الأجزاء ورقم إصدار */
function cachePutBig_(cache, key, s, ttl) {
  try {
    const size = 30000, n = Math.ceil(s.length / size);
    if (n > 40) return;
    const ver = String(Date.now()), o = {};
    for (let i = 0; i < n; i++) o[key + "|" + ver + "|" + i] = s.slice(i * size, (i + 1) * size);
    cache.putAll(o, ttl);
    cache.put(key, "chunks:" + n + ":" + ver, ttl);   // الرئيسي آخرًا: لا يُقرأ إلا بعد اكتمال الأجزاء
    return ver;
  } catch (e) { return ""; }
}
function cacheGetBig_(cache, key) {
  try {
    const meta = cache.get(key); if (!meta) return null;
    const m = /^chunks:(\d+):(\d+)$/.exec(meta); if (!m) return null;
    const keys = []; for (let i = 0; i < +m[1]; i++) keys.push(key + "|" + m[2] + "|" + i);
    const got = cache.getAll(keys);
    let s = ""; for (let i = 0; i < keys.length; i++) { if (got[keys[i]] == null) return null; s += got[keys[i]]; }
    return { s: s, ver: m[2] };
  } catch (e) { return null; }
}

/* العثور على الأوراق حتى لو اختلف اسمها قليلًا (مسافة زائدة، همزة…)،
   وإن لم يوجد الاسم نتعرّف على الورقة من عناوين أعمدتها */
function findSheets_(ss) {
  const sheets = ss.getSheets();
  const key = function (n) { return norm_(n).replace(/[\s\u200e\u200f\u202a-\u202e]/g, ""); };
  const found = {};
  Object.keys(TABS).forEach(function (k) {
    found[k] = sheets.find(function (sh) { return key(sh.getName()) === key(TABS[k]); }) || null;
  });
  const used = function (sh) { return Object.keys(found).some(function (k) { return found[k] === sh; }); };
  const sig = {
    links:       function (H) { return has_(H, "رابط") && has_(H, "رمز"); },
    dated:       function (H) { return has_(H, "التاريخ") && has_(H, "الحصه"); },
    teacherCodes: function () { return false; },   // تُعرف بالاسم فقط
    accounts:    function () { return false; },   // تُعرف بالاسم فقط
    subjects:    function (H) { return has_(H, "الماده") && has_(H, "المشرف") && !has_(H, "الحصه"); },
    schedule:    function (H) { return has_(H, "الماده") && has_(H, "الحصه") && !has_(H, "التاريخ"); },
    timing:      function (H) { return has_(H, "الحصه") && (H.indexOf("من") >= 0 || has_(H, "البدايه")) && !has_(H, "الماده"); },
    supervisors: function (H) { return has_(H, "الاسم") && !has_(H, "رمز") && !has_(H, "رابط"); },
    subjSup:     function (H) { return has_(H, "رمز") && (has_(H, "كلمات") || has_(H, "المواد")); },
    supCodes:    function (H) { return has_(H, "رمز") && !has_(H, "رابط") && !has_(H, "كلمات") && !has_(H, "المواد"); }
  };
  Object.keys(sig).forEach(function (k) {
    if (found[k]) return;
    found[k] = sheets.find(function (sh) {
      if (used(sh) || sh.getLastRow() < 1 || sh.getLastColumn() < 1) return false;
      const H = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(norm_);
      return sig[k](H);
    }) || null;
  });
  return found;
}
/* الكلمات المفتاحية لمشرف المادة: «علوم، فيزياء، science» — أو «الكل» لكل الحصص */
function parseKeywords_(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s || /^(الكل|كل المواد|جميع المواد|\*|all)$/i.test(norm_(s))) return ["*"];
  return s.split(/[،,؛;\n\/|]+/).map(function (k) { return stripAl_(norm_(k).replace(/\s+/g, " ")); }).filter(Boolean);
}
function stripAl_(w) { return w.replace(/^(وال|بال|لل|ال)(?=..)/, ""); }
/* تطابق المادة: بداية أي كلمة في اسم المادة (بعد حذف «ال») تساوي بداية كلمة مفتاحية.
   مثال: «علوم» تطابق «العلوم» و«علوم الأرض» لكنها لا تطابق «معلومات» */
function subjectMatch_(subject, kws) {
  if (kws.indexOf("*") >= 0) return true;
  const words = norm_(subject).split(/[^a-z0-9\u0621-\u064A]+/).filter(Boolean).map(stripAl_);
  return kws.some(function (k) {
    const kw = k.split(" ");
    return words.some(function (w, i) {
      return kw.every(function (part, j) { return words[i + j] && words[i + j].indexOf(part) === 0; });
    });
  });
}
/* ورقة «المواد»: الاسم الرسمي لكل مادة ومشرفها وأسماؤها الأخرى */
function subjectKey_(s) {
  return norm_(s).replace(/\([^)]*\)/g, " ").split(/[^a-z\u0621-\u064A]+/).filter(Boolean).map(stripAl_).join(" ");
}
function subjectMap_(T) {
  const map = {}, list = [];
  const tb = T.subjects;
  if (!tb) return { map: map, list: list };
  const cN = findCol_(tb.headers, ["الماده", "subject"]), cS = findCol_(tb.headers, ["المشرف", "supervisor"]);
  const cA = tb.headers.map(norm_).findIndex(function (h) { return h.indexOf("اسماء") >= 0 || h.indexOf("alias") >= 0; });
  if (cN < 0) return { map: map, list: list };
  tb.rows.forEach(function (r) {
    const name = String(r[cN] || "").trim(); if (!name) return;
    const sup = cS >= 0 ? String(r[cS] || "").trim() : "";
    const aliases = cA >= 0 ? String(r[cA] || "").split(/[،,؛;\n\/|]+/).map(function (x) { return x.trim(); }).filter(Boolean) : [];
    list.push({ name: name, sup: sup, aliases: aliases });
    [name].concat(aliases).forEach(function (n) { const k = subjectKey_(n); if (k && !(k in map)) map[k] = sup; });
  });
  return { map: map, list: list };
}
/* هل المادة تتبع هذا المشرف؟ أولًا حسب ورقة «المواد»، وإن لم تكن فيها فبالكلمات المفتاحية */
function ownsSubject_(subject, supName, kws, SM) {
  if (kws && kws.indexOf("*") >= 0) return true;
  const k = subjectKey_(subject);
  if (SM && k in SM.map) return normKey_(SM.map[k]) === normKey_(supName) && !!SM.map[k];
  return !!kws && subjectMatch_(subject, kws);
}
function normKey_(s) { return norm_(s).replace(/\s+/g, ""); }

function findCol_(headers, names) {
  const H = headers.map(norm_); const nn = names.map(norm_);
  return H.findIndex(function (h) { return nn.indexOf(h) >= 0; });
}

function has_(H, word) { return H.some(function (h) { return h.indexOf(norm_(word)) >= 0; }); }

/* فحص سريع: أضف ?diag=1 لرابط /exec لترى أسماء الأوراق وما تعرّف عليه الخادم (بدون أي بيانات) */
function diag_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const f = findSheets_(ss);
  const res = { tabs: ss.getSheets().map(function (sh) { return sh.getName(); }), found: {} };
  Object.keys(TABS).forEach(function (k) { res.found[TABS[k]] = f[k] ? f[k].getName() + " (" + Math.max(0, f[k].getLastRow() - 1) + " سطر)" : "غير موجودة"; });
  // المواد التي لا يغطيها أي مشرف مادة (عدا مشرفي «الكل»)
  try {
    const T = readAll_();
    if (T.schedule && T.subjSup) {
      const mx = colIndex_(T.subjSup.headers);
      const SM = subjectMap_(T);
      const sups = T.subjSup.rows.map(function (r) { return { name: mx.name >= 0 ? String(r[mx.name] || "") : "", kw: parseKeywords_(mx.kw >= 0 ? r[mx.kw] : "") }; })
        .filter(function (x) { return x.kw.indexOf("*") < 0; });
      const miss = {};
      [T.schedule, T.dated].forEach(function (tb) {
        if (!tb) return;
        const c = findCol_(tb.headers, ["الماده", "subject"]);
        tb.rows.forEach(function (r) { const sub = String(r[c] || "").trim();
          if (sub && !sups.some(function (x) { return ownsSubject_(sub, x.name, x.kw, SM); })) miss[sub] = (miss[sub] || 0) + 1; });
      });
      res.unassignedSubjects = miss;
    }
  } catch (e) {}
  return res;
}

/* ---------------- أدوات تفسير النصوص (نفس منطق الصفحة) ----------------
   ⚠️ هذه الدوال وهيكل الصفوف (GRADES_) نسخة مطابقة لما في online-learning.html
   (norm / parseScope / parseGrade / classKey / parsePeriod / parseDay / parseTime / SCHOOL).
   أي تعديل هنا يجب أن يُنقل للصفحة، والعكس — وإلا يختلف فهم الخادم عن الصفحة. */
function norm_(s) {
  return String(s == null ? "" : s).trim().toLowerCase()
    .replace(/[٠-٩]/g, function (d) { return "٠١٢٣٤٥٦٧٨٩".indexOf(d); })
    .replace(/[۰-۹]/g, function (d) { return "۰۱۲۳۴۵۶۷۸۹".indexOf(d); })
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ـًٌٍَُِّْ]/g, "")
    .replace(/\s+/g, " ");
}
function normCode_(s) { return norm_(s).toUpperCase().replace(/[^A-Z0-9]/g, ""); }

const COLS_ = {
  code:  ["رمز الدخول", "الرمز", "code", "access code"],
  scope: ["ينطبق علي", "الصف", "المرحله", "الفئه", "grade", "applies to"],
  cls:   ["الفصول", "الفصل", "الشعبه", "classes", "class", "section"],
  name:  ["الاسم", "name"],
  kw:    ["المواد (كلمات مفتاحيه)", "المواد", "الكلمات المفتاحيه", "كلمات", "keywords", "subjects"]
};
function colIndex_(headers) {
  const H = headers.map(norm_);
  const idx = {};
  Object.keys(COLS_).forEach(function (k) {
    const nn = COLS_[k].map(norm_);
    let i = H.findIndex(function (h) { return nn.indexOf(h) >= 0; });
    if (i < 0) i = H.findIndex(function (h) { return nn.some(function (n) { return n.length > 3 && h.indexOf(n) >= 0; }); });
    idx[k] = i;
  });
  return idx;
}

function range_(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
const GRADES_ = (function () {
  const L = [];
  [["boys", "primary", range_(1, 6)], ["boys", "middle", range_(1, 3)], ["boys", "secondary", range_(1, 3)],
   ["girls", "primary", range_(1, 5)], ["american", "g", range_(4, 9)]].forEach(function (x) {
    x[2].forEach(function (n) { L.push({ id: x[0] === "american" ? "american-" + n : x[0] + "-" + x[1] + "-" + n, sec: x[0], st: x[1], n: n }); });
  });
  return L;
})();
const ORD_WORDS_ = [["الحادي عشر", 11], ["الثاني عشر", 12], ["العاشر", 10], ["تاسع", 9], ["ثامن", 8], ["سابع", 7], ["سادس", 6], ["خامس", 5], ["رابع", 4], ["ثالث", 3], ["ثاني", 2], ["اول", 1]];
function ordinalIn_(s) {
  for (let i = 0; i < ORD_WORDS_.length; i++) if (s.indexOf(norm_(ORD_WORDS_[i][0])) >= 0) return ORD_WORDS_[i][1];
  return null;
}
function parseScope_(raw) {
  const s = norm_(raw);
  if (!s || /كل المدرس|الكل|جميع الصفوف|^all|whole school/.test(s)) return GRADES_.map(function (g) { return g.id; });
  const isAm = /امريك|american|diploma|دبلوم/.test(s);
  const sec = isAm ? "american" : /بنات|girls/.test(s) ? "girls" : /بنين|boys/.test(s) ? "boys" : null;
  const st = isAm ? "g" : /ابتدا|primary|elementary/.test(s) ? "primary" : /متوسط|middle|intermediate/.test(s) ? "middle" : /ثانو|secondary|high/.test(s) ? "secondary" : null;
  const rest = s.replace(/ثانوي|ثانويه/g, " # ");
  let nums = null;
  const rg = rest.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})/);
  if (rg) nums = range_(Math.min(+rg[1], +rg[2]), Math.max(+rg[1], +rg[2]));
  else {
    const ds = rest.match(/\d{1,2}/g);
    if (ds) nums = ds.map(Number);
    else { const o = ordinalIn_(rest.replace(/الصفوف|صفوف/g, "")); if (o) nums = [o]; }
  }
  return GRADES_.filter(function (g) {
    if (sec && g.sec !== sec) return false;
    if (st && g.st !== st) return false;
    if (!sec && !st && !nums) return false;
    if (nums && nums.indexOf(g.n) < 0) return false;
    return true;
  }).map(function (g) { return g.id; });
}
function parseGrade_(raw) { const ids = parseScope_(raw); return ids.length === 1 ? ids[0] : null; }
function classKey_(raw) { return norm_(raw).replace(/\s+و\s*/g, "/").replace(/[^a-z0-9ء-ي]/g, ""); }


/* ==================================================================
   التقرير اليومي لكل مرحلة (يظهر لمديري المراحل ومدير التعليم)
   ==================================================================
   مصدر الحضور — يختار السكربت الأدق المتاح تلقائيًا:
   1) سجل Google Meet الرسمي (حضور حقيقي): يحتاج أن يكون مالك السكربت «مسؤول نظام»
      في Google Workspace بالمدرسة، وتفعيل خدمة Admin SDK Reports — الخطوات في دليل التشغيل.
   2) ضغطات زر «الدخول إلى الحصة» في الصفحة (تقديري): يعمل دائمًا بدون أي صلاحيات.
      كل جهاز يُحسب طالبًا واحدًا في اليوم.
   ================================================================== */

/* تسجيل ضغطة «الدخول إلى الحصة» (من رمز فصل فقط — المشرفون والمديرون لا يُحسبون) */
function logJoin_(body) {
  const sc = sessionCode_(body.code); if (sc.error) return { ok: true };
  const code = normCode_(sc.code);
  if (code.length < 4) return { ok: true };
  const T = readAll_(); if (!T.links) return { ok: true };
  const ix = colIndex_(T.links.headers);
  const row = T.links.rows.find(function (r) { return ix.code >= 0 && normCode_(r[ix.code]) === code; });
  if (!row) return { ok: true };                       // نفس الرد دائمًا (لا يكشف صحة الرمز)
  // الداخل بحساب المدرسة: يُسجَّل بإيميله (حضور بالشخص)، وإلا برقم الجهاز
  const dev = sc.email ? sc.email : /^[a-z0-9]{6,32}$/i.test(String(body.dev || "")) ? String(body.dev) : "x" + Utilities.getUuid().slice(0, 8);
  const now = new Date();
  logSheet_().appendRow([Utilities.formatDate(now, TZ, "yyyy-MM-dd HH:mm"), Utilities.formatDate(now, TZ, "yyyy-MM-dd"),
    String(row[ix.scope] || ""), ix.cls >= 0 ? String(row[ix.cls] || "") : "", dev]);
  return { ok: true };
}
function logSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(LOG_TAB);
  if (!sh) {
    sh = ss.insertSheet(LOG_TAB);
    sh.getRange(1, 1, 1, 5).setValues([["وقت الضغط", "اليوم", "الصف", "الفصول", "الجهاز"]]).setFontWeight("bold");
    sh.setFrozenRows(1); sh.getRange("A:E").setNumberFormat("@");
  }
  return sh;
}
function reportSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(REPORT_TAB);
  if (!sh) {
    sh = ss.insertSheet(REPORT_TAB);
    sh.getRange(1, 1, 1, 8).setValues([["اليوم", "المصدر", "الحصص المنفذة", "الحصص المجدولة", "المعلمون المشاركون", "الطلاب الحضور", "وقت الإنشاء", "البيانات (لا تعدّلها)"]]).setFontWeight("bold");
    sh.setFrozenRows(1); sh.getRange("A:H").setNumberFormat("@");
  }
  return sh;
}

/* طلب التقرير من الصفحة */
function report_(body) {
  const A = editorAuth_(body.code); if (A.error) return { ok: false, error: A.error };
  const today = todayStr_(0);
  const date = normDate_(body.date) || today;
  if (date > today || date < todayStr_(-120)) return { ok: false, error: "date" };
  const hour = Number(Utilities.formatDate(new Date(), TZ, "H"));
  const final = date < today || hour >= REPORT_HOUR;
  let day = (!body.force && final) ? storedDay_(date) : null;
  if (!day) {
    day = cachedCompute_(date, !!body.force);
    if (final) storeDay_(day);
  }
  return { ok: true, date: date, partial: !final, source: day.source, note: day.note || "", at: day.at,
    stages: aggregate_(day, A.grades) };
}

function cachedCompute_(date, force) {
  const c = CacheService.getScriptCache(), k = "ol-rep-" + date;
  if (!force) { const hit = c.get(k); if (hit) { try { return JSON.parse(hit); } catch (e) {} } }
  const day = computeDay_(date);
  const s = JSON.stringify(day); if (s.length < 95000) { try { c.put(k, s, 300); } catch (e) {} }
  return day;
}

/* التشغيل التلقائي اليومي — يُضبط مرة واحدة بتشغيل setupDailyReport من المحرر */
function dailyReport() {
  const date = todayStr_(0);
  const wd = new Date(date + "T12:00:00+03:00").getUTCDay();
  const day = computeDay_(date);
  if (wd <= 4 || day.planned || day.students) storeDay_(day);   // الجمعة والسبت: يُحفظ فقط إن وُجدت حصص
  cleanLog_();
}
/* setupDailyReport — مُعاد تعريفه في آخر الملف */
/* زر تجربة: يحسب تقرير اليوم ويعرض ملخصه في السجل (لا يحفظ) */
/* testReport — مُعاد تعريفه في آخر الملف */

function cleanLog_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_TAB);
  if (!sh || sh.getLastRow() < 2) return;
  const cut = todayStr_(-LOG_KEEP_DAYS);
  const vals = sh.getRange(2, 2, sh.getLastRow() - 1, 1).getDisplayValues();
  let n = 0; while (n < vals.length && String(vals[n][0]) < cut) n++;   // السجل مرتب زمنيًا
  if (n) sh.deleteRows(2, n);
}

function storedDay_(date) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(REPORT_TAB);
  if (!sh || sh.getLastRow() < 2) return null;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 8).getDisplayValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] === date) { try { return JSON.parse(vals[i][7]); } catch (e) { return null; } }
  return null;
}
function storeDay_(day) {
  const lock = LockService.getScriptLock(); if (!lock.tryLock(20000)) return;
  try {
    const sh = reportSheet_();
    const row = [day.date, day.source === "meet" ? "سجل Google Meet" : "ضغطات زر الدخول (تقديري)", day.done, day.planned, day.teachers, day.students, day.at, JSON.stringify(day)];
    const n = sh.getLastRow();
    const dates = n > 1 ? sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(function (r) { return r[0]; }) : [];
    const i = dates.indexOf(day.date);
    const rg = i >= 0 ? sh.getRange(i + 2, 1, 1, 8) : sh.getRange(n + 1, 1, 1, 8);
    rg.setNumberFormat("@"); rg.setValues([row.map(String)]);
    if (i < 0 && n > 1) sh.getRange(2, 1, n, 8).sort({ column: 1, ascending: true });
  } finally { lock.releaseLock(); }
}

/* -------- خطة اليوم: حصص كل فصل (الجدول الأسبوعي أو «حصص بالتاريخ») مع توقيتها ورابطها -------- */
function plannedDay_(T, date) {
  const rooms = {};
  const room = function (gid, cls) {
    const k = gid + "|" + classKey_(cls);
    return rooms[k] || (rooms[k] = { key: k, gid: gid, label: classLabel_(cls), codes: {}, periods: [], dated: [], weekly: [] });
  };
  if (T.links) { const lx = colIndex_(T.links.headers), lc = findCol_(T.links.headers, ["رابط الحصه", "رابط الفصل", "الرابط", "link", "url"]);
    T.links.rows.forEach(function (r) { const gid = parseGrade_(r[lx.scope]); if (!gid) return;
      const R = room(gid, lx.cls >= 0 ? r[lx.cls] : ""); const mc = meetCode_(lc >= 0 ? r[lc] : ""); if (mc) R.codes[mc] = true; }); }
  const wd = new Date(date + "T12:00:00+03:00").getUTCDay();
  if (T.schedule && wd <= 4) { const sx = colIndex_(T.schedule.headers), H = T.schedule.headers;
    const cP = findCol_(H, ["الحصه", "رقم الحصه", "period"]), cS = findCol_(H, ["الماده", "subject"]), cT = findCol_(H, ["المعلم", "المعلمه", "teacher"]), cD = findCol_(H, ["اليوم", "day"]);
    T.schedule.rows.forEach(function (r) { const gid = parseGrade_(r[sx.scope]); if (!gid) return;
      const p = parsePeriod_(r[cP]); if (typeof p !== "number") return;
      const d = cD >= 0 ? parseDay_(r[cD]) : "all"; if (d !== "all" && d !== wd) return;
      room(gid, sx.cls >= 0 ? r[sx.cls] : "").weekly.push({ p: p, day: d, subject: String(r[cS] || "").trim(), teacher: cT >= 0 ? String(r[cT] || "").trim() : "" }); }); }
  if (T.dated) { const dx = datedIndex_(T.dated.headers);
    T.dated.rows.forEach(function (r) { if (normDate_(r[dx.date]) !== date) return; const gid = parseGrade_(r[dx.grade]); if (!gid) return;
      const p = parsePeriod_(r[dx.p]); if (typeof p !== "number") return;
      room(gid, r[dx.cls]).dated.push({ p: p, subject: String(r[dx.subject] || "").trim(), teacher: String(r[dx.teacher] || "").trim(),
        start: parseTime_(r[dx.start]), end: parseTime_(r[dx.end]), code: meetCode_(r[dx.link]) }); }); }
  const timing = timingRows_(T);
  Object.keys(rooms).forEach(function (k) {
    const R = rooms[k], tm = timingFor_(timing, R.gid);
    if (R.dated.length) R.periods = R.dated;
    else { const byP = {}; R.weekly.forEach(function (x) { if (!byP[x.p] || x.day !== "all") byP[x.p] = x; });
      R.periods = Object.keys(byP).map(function (p) { return byP[p]; }); }
    R.periods = R.periods.map(function (x) { const t = tm[x.p] || {};
      return { p: x.p, subject: x.subject, teacher: x.teacher, start: x.start != null ? x.start : (t.start != null ? t.start : null),
        end: x.end != null ? x.end : (t.end != null ? t.end : null), code: x.code || "" }; }).sort(function (a, b) { return a.p - b.p; });
    R.periods.forEach(function (x) { if (x.code) R.codes[x.code] = true; });
    delete R.dated; delete R.weekly;
  });
  return rooms;
}
function timingRows_(T) {
  if (!T.timing) return [];
  const H = T.timing.headers, sx = colIndex_(H);
  const cP = findCol_(H, ["الحصه", "رقم الحصه", "period"]), cA = findCol_(H, ["من", "وقت البدايه", "البدايه", "start", "from"]), cB = findCol_(H, ["الي", "وقت النهايه", "النهايه", "end", "to"]);
  return T.timing.rows.map(function (r) { const ids = parseScope_(r[sx.scope]);
    return { ids: ids, p: parsePeriod_(r[cP]), start: parseTime_(cA >= 0 ? r[cA] : ""), end: parseTime_(cB >= 0 ? r[cB] : "") }; })
    .filter(function (x) { return x.ids.length && typeof x.p === "number" && x.start != null; });
}
function timingFor_(rows, gid) {   // لكل حصة: أدق نطاق ينطبق على الصف
  const best = {};
  rows.forEach(function (x) { if (x.ids.indexOf(gid) < 0) return; const c = best[x.p]; if (!c || x.ids.length < c.ids.length) best[x.p] = x; });
  return best;
}

/* -------- حساب اليوم -------- */
function computeDay_(date) {
  const T = readAll_();
  const rooms = plannedDay_(T, date);
  const SM = subjectMap_(T); const official = {};
  SM.list.forEach(function (x) { [x.name].concat(x.aliases).forEach(function (n) { const k = subjectKey_(n); if (k && !(k in official)) official[k] = x.name; }); });
  const subjName = function (s) { return official[subjectKey_(s)] || s || "—"; };

  let source = "clicks", note = "", meet = null;
  try { meet = meetDay_(date); if (meet) source = "meet"; }
  catch (e) { note = "تعذّر قراءة سجل Meet: " + String(e && e.message || e).slice(0, 160); }

  const day0 = Date.parse(date + "T00:00:00+03:00");
  const MIN = MIN_ATTEND_MIN * 60000;
  // ساعة القفل: لا يُحسب أي دخول بعدها (حتى مع «إعادة الحساب الآن»)
  const cutMs = day0 + REPORT_HOUR * 3600000;
  if (meet) meet = meet.filter(function (m) { return m.start < cutMs; }).map(function (m) { return Object.assign({}, m, { end: Math.min(m.end, cutMs) }); });
  const out = [];

  if (source === "meet") {
    // كل مشارك: في أي فصول ظهر اليوم؟ (من يظهر في فصلين أو أكثر = معلم/موظف)
    const codeRooms = {}; Object.keys(rooms).forEach(function (k) { Object.keys(rooms[k].codes).forEach(function (c) { (codeRooms[c] = codeRooms[c] || []).push(k); }); });
    const seen = {}, staff = {};
    const teacherNames = []; Object.keys(rooms).forEach(function (k) { rooms[k].periods.forEach(function (x) { if (x.teacher) teacherNames.push(x.teacher); }); });
    const isTeacherName = nameMatcher_(teacherNames);
    meet.forEach(function (m) {
      (codeRooms[m.code] || []).forEach(function (k) { (seen[m.id] = seen[m.id] || {})[k] = true; });
      if (m.org && m.id === m.org) staff[m.id] = true;
      if (m.name && isTeacherName(m.name)) staff[m.id] = true;
    });
    meet.forEach(function (m) { if (m.org) staff[m.org] = true; });
    Object.keys(seen).forEach(function (id) { if (Object.keys(seen[id]).length >= 2) staff[id] = true; });

    Object.keys(rooms).forEach(function (k) {
      const R = rooms[k];
      const recs = meet.filter(function (m) { return R.codes[m.code]; });
      const dur = {}; recs.forEach(function (m) { if (!staff[m.id]) dur[m.id] = (dur[m.id] || 0) + (m.end - m.start); });
      const students = Object.keys(dur).filter(function (id) { return dur[id] >= MIN; }).length;
      const anyDay = Object.keys(recs.reduce(function (a, m) { a[m.id] = 1; return a; }, {})).length >= 2;
      const periods = R.periods.map(function (x) {
        let done;
        if (x.start == null) done = anyDay;
        else {
          const ws = day0 + x.start * 60000, we = day0 + (x.end != null ? x.end : x.start + 30) * 60000;
          const need = Math.min(MIN, (we - ws) / 2);
          const pool = x.code ? meet.filter(function (m) { return m.code === x.code; }) : recs;
          const ov = {}; pool.forEach(function (m) { const o = Math.min(we, m.end) - Math.max(ws, m.start); if (o > 0) ov[m.id] = (ov[m.id] || 0) + o; });
          done = Object.keys(ov).filter(function (id) { return ov[id] >= need; }).length >= 2;
        }
        return { p: x.p, s: subjName(x.subject), t: x.teacher, d: done ? 1 : 0 };
      });
      out.push({ k: k, g: R.gid, l: R.label, n: students, ps: periods });
    });
  } else {
    const devs = {};
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(LOG_TAB);
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 5).getDisplayValues().forEach(function (r) {
      if (r[1] !== date) return;
      const hh = parseInt((String(r[0]).split(" ")[1] || "").split(":")[0], 10);   // الجدول قد يعرض الساعة بدون صفر (8:18)
      if (!isNaN(hh) && hh >= REPORT_HOUR) return;
      const gid = parseGrade_(r[2]); if (!gid) return;
      const k = gid + "|" + classKey_(r[3]); (devs[k] = devs[k] || {})[r[4]] = true;
    });
    Object.keys(devs).forEach(function (k) { if (!rooms[k]) { const p = k.split("|"); rooms[k] = { key: k, gid: p[0], label: "", codes: {}, periods: [] }; } });
    Object.keys(rooms).forEach(function (k) {
      const R = rooms[k], n = devs[k] ? Object.keys(devs[k]).length : 0;
      out.push({ k: k, g: R.gid, l: R.label, n: n, ps: R.periods.map(function (x) { return { p: x.p, s: subjName(x.subject), t: x.teacher, d: n ? 1 : 0 }; }) });
    });
  }
  const sum = aggregate_({ rooms: out }, null)[0] || {};
  return { date: date, source: source, note: note, at: Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd HH:mm"),
    planned: sum.planned || 0, done: sum.done || 0, teachers: sum.teachers || 0, students: sum.students || 0, rooms: out };
}

/* سجل Google Meet لليوم (يحتاج خدمة AdminReports وصلاحية مسؤول) — يرجع null إن لم تكن الخدمة مفعّلة */
/* meetDay_ — مُعاد تعريفه في آخر الملف */
function meetCode_(url) {
  const m = String(url || "").match(/meet\.google\.com\/(?:meet\/)?([a-z]{3}-?[a-z]{4}-?[a-z]{3})/i);
  return m ? m[1].toLowerCase().replace(/-/g, "") : "";
}
/* هل الاسم الظاهر في Meet اسمُ أحد المعلمين؟ (أول كلمتين من اسم المعلم بعد حذف الألقاب) */
function nameMatcher_(names) {
  const toks = function (s) { return norm_(s).replace(/^(ا|استاذ|الاستاذ|استاذه|الاستاذه|م|د|mr|ms|mrs|miss)[.\/\s]+/, "").split(/[^a-zء-ي]+/).filter(function (w) { return w.length > 1; }); };
  const keys = {}; names.forEach(function (n) { const t = toks(n); if (t.length >= 2) keys[t[0] + " " + t[1]] = true; });
  return function (display) { const t = toks(display); for (let i = 0; i + 1 < t.length; i++) if (keys[t[i] + " " + t[i + 1]]) return true; return false; };
}

/* تجميع التقرير حسب المرحلة (ضمن صلاحية صاحب الرمز) + إجمالي عام إن كانت أكثر من مرحلة */
const STAGES_ = [["boys-primary", "بنين — المرحلة الابتدائية"], ["boys-middle", "بنين — المرحلة المتوسطة"], ["boys-secondary", "بنين — المرحلة الثانوية"],
  ["girls-primary", "بنات — المرحلة الابتدائية"], ["american", "الدبلوما الأمريكية"]];
function stageOf_(gid) { return /^american/.test(gid) ? "american" : gid.replace(/-\d+$/, ""); }
function aggregate_(day, gradesMap) {
  const rooms = (day.rooms || []).filter(function (r) { return !gradesMap || gradesMap[r.g]; });
  const one = function (key, label, list) {
    const subj = {}, tch = {}, gr = {}; let planned = 0, done = 0, students = 0;
    list.forEach(function (r) {
      students += r.n;
      const G = gr[r.g] = gr[r.g] || { g: r.g, n: 0, classes: [] }; G.n += r.n; G.classes.push({ l: r.l, n: r.n });
      r.ps.forEach(function (x) {
        planned++; done += x.d;
        const S = subj[x.s] = subj[x.s] || { name: x.s, done: 0, planned: 0 }; S.planned++; S.done += x.d;
        if (x.t) { const t = tch[x.t] = tch[x.t] || { name: x.t, done: 0, planned: 0 }; t.planned++; t.done += x.d; }
      });
    });
    const byDone = function (a, b) { return b.done - a.done || b.planned - a.planned || a.name.localeCompare(b.name, "ar"); };
    const tl = Object.keys(tch).map(function (k) { return tch[k]; }).sort(byDone);
    return { key: key, label: label, planned: planned, done: done, students: students,
      teachers: tl.filter(function (t) { return t.done > 0; }).length, teachersPlanned: tl.length,
      bySubject: Object.keys(subj).map(function (k) { return subj[k]; }).sort(byDone), byTeacher: tl,
      byGrade: Object.keys(gr).map(function (k) { const G = gr[k]; G.classes.sort(function (a, b) { return a.l.localeCompare(b.l, "ar"); }); return G; })
        .sort(function (a, b) { return GRADES_.findIndex(function (x) { return x.id === a.g; }) - GRADES_.findIndex(function (x) { return x.id === b.g; }); }) };
  };
  if (!gradesMap) return [one("all", "المدرسة كاملة", rooms)];
  const res = [];
  STAGES_.forEach(function (st) { const list = rooms.filter(function (r) { return stageOf_(r.g) === st[0]; });
    if (list.length || Object.keys(gradesMap).some(function (g) { return stageOf_(g) === st[0]; })) res.push(one(st[0], st[1], list)); });
  if (res.length > 1) res.unshift(one("all", "كل المراحل", rooms));
  return res;
}

/* أدوات تفسير (نفس منطق الصفحة) */
function parsePeriod_(raw) {
  const s = norm_(raw); if (!s) return null;
  if (/فسح|استراح|راحه|صلاه|break|recess|prayer/.test(s)) return "break";
  if (/دوام|اليوم الدراسي|متاح|اتاح|school day|available|window/.test(s)) return "window";
  const d = s.match(/\d{1,2}/); if (d) return +d[0];
  return ordinalIn_(s);
}
function parseDay_(raw) {
  const s = norm_(raw).replace(/ء/g, "");
  if (!s || /يومي|كل الايام|daily|every/.test(s)) return "all";
  const K = [["احد", "sun"], ["اثنين", "mon"], ["ثلاثا", "tue"], ["اربعا", "wed"], ["خميس", "thu"]];
  for (let i = 0; i < K.length; i++) if (s.indexOf(K[i][0]) >= 0 || s.indexOf(K[i][1]) === 0) return i;
  return "all";
}
function parseTime_(raw) {
  const s = norm_(raw); if (!s) return null;
  const m = s.match(/(\d{1,2})(?:[:.٫](\d{2}))?/); if (!m) return null;
  let h = +m[1]; const min = +(m[2] || 0);
  const pm = /(\bpm\b|p\.m|مساء|(^|\s|\d)م(\s|$))/.test(s), am = /(\bam\b|a\.m|صباح|(^|\s|\d)ص(\s|$))/.test(s);
  if (pm && h < 12) h += 12; if (am && h === 12) h = 0;
  if (!pm && !am && h >= 1 && h <= 5) h += 12;
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}
function classLabel_(raw) { return String(raw == null ? "" : raw).split(/\s*[\/،,\-]\s*|\s+و\s*/).map(function (x) { return x.trim(); }).filter(Boolean).join(" / "); }

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

    // ---- رابط Meet تجريبي لصاحب الجلسة (للتأكد من أن الربط يعمل) ----
    if (act === "meetTest") {
      const m = await whoAmI(req);
      if (!m || m.bad || !m.known) return json({ ok: false, error: "forbidden" }, 403);
      const CID = Deno.env.get("GOOGLE_CLIENT_ID"), CSEC = Deno.env.get("GOOGLE_CLIENT_SECRET");
      if (!CID || !CSEC) return json({ ok: false, error: "google_secrets" });
      const { data: t } = await SB.from("gm_tokens").select("profile_id,refresh_token").eq("email", m.email).maybeSingle();
      if (!t) return json({ ok: false, error: "not_linked" });
      const tr = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: t.refresh_token, grant_type: "refresh_token" }) });
      const tj = await tr.json().catch(() => ({}));
      if (!tr.ok || !tj.access_token) { const msg = "token: " + (tj.error_description || tj.error || tr.status);
        await SB.from("gm_tokens").update({ last_error: msg.slice(0, 300) }).eq("profile_id", t.profile_id); return json({ ok: false, error: msg }); }
      const r = await fetch("https://meet.googleapis.com/v2/spaces", { method: "POST", headers: { Authorization: "Bearer " + tj.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ config: { accessType: "TRUSTED", entryPointAccess: "ALL" } }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.meetingUri) { const msg = "meet: " + ((j.error && j.error.message) || r.status);
        await SB.from("gm_tokens").update({ last_error: msg.slice(0, 300) }).eq("profile_id", t.profile_id); return json({ ok: false, error: msg }); }
      await SB.from("gm_tokens").update({ last_ok: new Date().toISOString(), last_error: null }).eq("profile_id", t.profile_id);
      return json({ ok: true, uri: j.meetingUri });
    }

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
