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
