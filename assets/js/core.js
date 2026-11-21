/* =====================================================================
   النواة المشتركة: الاتصال بـ Supabase، الدخول، الحماية، أدوات الواجهة
   ===================================================================== */
(function () {
  const C = window.LMS_CONFIG;
  const configured = C && !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY);
  const sb = configured
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
      })
    : null;

  const ROLE_LABELS = {
    admin: 'مدير النظام', leadership: 'الإدارة العليا', principal: 'مدير مرحلة',
    supervisor: 'مشرف', teacher: 'معلم', staff: 'موظف', student: 'طالب', parent: 'ولي أمر'
  };

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  // ---------- رسائل منبثقة ----------
  function toast(msg, type = 'ok', ms = 3800) {
    let box = $('#toasts');
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 400); }, ms);
  }

  // ---------- نافذة منبثقة عامة ----------
  function modal({ title, body, actions = [], wide = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-wrap';
      wrap.innerHTML = `
        <div class="modal glass ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
          <div class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" data-x aria-label="إغلاق">✕</button></div>
          <div class="modal-body"></div>
          <div class="modal-foot"></div>
        </div>`;
      const bodyEl = $('.modal-body', wrap);
      if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
      const foot = $('.modal-foot', wrap);
      const close = (val) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
      actions.forEach((a) => {
        const b = document.createElement('button');
        b.className = 'btn ' + (a.cls || '');
        b.textContent = a.label;
        b.onclick = async () => {
          if (a.onClick) {
            b.disabled = true;
            try { const r = await a.onClick(wrap); if (r === false) { b.disabled = false; return; } close(r ?? a.value); }
            catch (e) { b.disabled = false; toast(errMsg(e), 'err'); }
          } else close(a.value);
        };
        foot.appendChild(b);
      });
      const onKey = (e) => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      $('[data-x]', wrap).onclick = () => close(null);
      wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(null); });
      document.body.appendChild(wrap);
      const first = $('input,select,textarea', bodyEl); if (first) first.focus();
    });
  }

  const confirmBox = (msg, okLabel = 'تأكيد', danger = true) => modal({
    title: 'تأكيد', body: `<p class="confirm-msg">${esc(msg)}</p>`,
    actions: [{ label: 'إلغاء', value: false, cls: 'ghost' }, { label: okLabel, value: true, cls: danger ? 'danger' : 'primary' }]
  });

  // ---------- ترجمة أخطاء قاعدة البيانات ----------
  function errMsg(e) {
    const m = (e && (e.message || e.error_description || e.details)) || String(e);
    if (/duplicate key|unique/i.test(m)) return 'القيمة مسجّلة من قبل (تكرار).';
    if (/violates foreign key|still referenced/i.test(m)) return 'لا يمكن الحذف: هناك بيانات مرتبطة بهذا العنصر (مثل طلاب في الفصل).';
    if (/row-level security|permission denied|غير مصرح/i.test(m)) return 'ليست لديك صلاحية لهذه العملية.';
    if (/JWT|session/i.test(m)) return 'انتهت الجلسة، سجّل الدخول من جديد.';
    if (/Failed to fetch|NetworkError/i.test(m)) return 'تعذّر الاتصال بالخادم، تحقق من الإنترنت.';
    return m;
  }

  // ---------- جلب كل الصفوف (يتجاوز حد 1000 صف للطلب) ----------
  async function fetchAll(build, pageSize = 1000) {
    let out = [], from = 0;
    for (;;) {
      const { data, error } = await build().range(from, from + pageSize - 1);
      if (error) throw error;
      out = out.concat(data || []);
      if (!data || data.length < pageSize) break;
      from += pageSize;
    }
    return out;
  }

  // ---------- الدخول ----------
  // صفحة داخلية للرجوع إليها بعد الدخول (مثل supervision/) — مسارات نسبية فقط
  function safeNext(n) { return n && /^[a-z0-9][a-z0-9/_.-]*$/i.test(n) && !n.includes('..') ? n : ''; }
  function rememberNext() {
    const n = safeNext(new URLSearchParams(location.search).get('next'));
    try { if (n) sessionStorage.setItem('lms_next', n); } catch (_) {}
  }
  function takeNext() {
    let n = ''; try { n = safeNext(sessionStorage.getItem('lms_next')); sessionStorage.removeItem('lms_next'); } catch (_) {}
    return n;
  }

  async function signInWithGoogle() {
    const redirectTo = new URL('index.html', location.href.replace(/[^/]*([?#].*)?$/, '')).href;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { hd: C.SCHOOL_DOMAIN, prompt: 'select_account' } }
    });
    if (error) toast(errMsg(error), 'err');
  }

  async function signOut() {
    try { await sb.auth.signOut(); } catch (_) {}
    location.href = 'index.html';
  }

  async function getContext() {
    const { data, error } = await sb.rpc('my_context');
    if (error) throw error;
    return data;
  }

  /* حماية الصفحة: تُعيد سياق المستخدم أو تُحوّله لصفحة الدخول
     roles: الأدوار المسموح لها بهذه الصفحة (فارغ = أي مسجّل) */
  /* ---------- تبديل الواجهة: صاحب الصفتين (مدير النظام + مشرف) ----------
     «مشرف» = يرى المنصة ومكتب الإشراف كما يراها المشرف تمامًا، و«مدير النظام» يرجع للوضع الكامل */
  const VIEW_KEY = 'lms_view';
  function getView() { try { return localStorage.getItem(VIEW_KEY) || ''; } catch (_) { return ''; } }
  function setView(v) { try { v ? localStorage.setItem(VIEW_KEY, v) : localStorage.removeItem(VIEW_KEY); } catch (_) {} }
  function canSwitch(p) { return !!p && ['admin', 'leadership', 'principal'].includes(p.role) && /مشرف/.test(p.job_title || ''); }
  function applyView(ctx) {
    if (!ctx || !ctx.profile) return ctx;
    ctx.realRole = ctx.profile.role;
    ctx.canSwitch = canSwitch(ctx.profile);
    ctx.viewAs = ctx.canSwitch && getView() === 'supervisor' ? 'supervisor' : '';
    if (ctx.viewAs) ctx.profile = Object.assign({}, ctx.profile, { role: 'supervisor' });
    else if (!ctx.canSwitch) setView('');
    return ctx;
  }

  async function requireAuth(roles = []) {
    if (!sb) { location.href = 'index.html'; return new Promise(() => {}); }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = 'index.html'; return new Promise(() => {}); }
    let ctx;
    try { ctx = await getContext(); } catch (e) { toast(errMsg(e), 'err'); throw e; }
    if (!ctx || !ctx.registered) { location.href = 'index.html'; return new Promise(() => {}); }
    applyView(ctx);
    if (roles.length && !roles.includes(ctx.profile.role)) { location.href = 'home.html'; return new Promise(() => {}); }
    renderTopbar(ctx);
    return ctx;
  }

  function renderTopbar(ctx) {
    const bar = $('#topbar');
    if (!bar) return;
    const p = ctx.profile;
    const here = location.pathname.split('/').pop() || 'index.html';
    const links = [['home.html', 'الرئيسية', true],
      ['admin.html', 'لوحة الإدارة', p.role === 'admin'],
      ['settings.html', 'إعدادات المدرسة', ['admin', 'leadership', 'principal'].includes(p.role)],
      ['supervision/', '🧭 مكتب الإشراف التربوي', ['admin', 'leadership', 'principal', 'supervisor'].includes(p.role)],
      ['staff-directory.html', '📇 دليل الموظفين', !['student', 'parent'].includes(p.role)]];
    bar.innerHTML = `
      <div class="hrow">
        <a class="brand" href="home.html"><span class="logo-tile"><img src="assets/img/logo-mark.png" alt="مدارس دار الذكر"></span><span>${esc(C.PLATFORM_NAME)}<small>${esc(C.SCHOOL_NAME)}</small></span></a>
        <div class="clock">
          <span class="who"><b>${esc(p.full_name)}</b><small>${esc(ctx.viewAs ? (p.job_title || ROLE_LABELS.supervisor) : ctx.canSwitch ? ROLE_LABELS[p.role] : (p.job_title || ROLE_LABELS[p.role]))}</small></span>
          <button class="btn sm hbtn" id="logoutBtn">خروج</button>
          <span id="todayLbl"></span><b id="clk">--:--</b>
        </div>
      </div>
      <nav class="nav">
        ${links.filter((l) => l[2]).map(([href, label]) => `<a href="${href}" class="${here === href ? 'on' : ''}">${label}</a>`).join('')}
        <div id="calBar" class="calbar" role="button" tabindex="0" title="التقويم الدراسي"></div>
      </nav>`;
    $('#logoutBtn').onclick = signOut;
    const cal = $('#calBar');
    cal.onclick = openCalendar;
    cal.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCalendar(); } };
    startClock();
  }

  /* ---------- الساعة والتاريخ والتقويم الدراسي (نفس شريط مكتب الإشراف التربوي) ---------- */
  const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const LOC = 'ar-SA-u-ca-gregory-nu-latn';
  const calDay = (s) => { try { return parseYmd(s).toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }).replace('،', ''); } catch (e) { return s; } };
  const daysWord = (n) => n === 1 ? 'يوم' : n === 2 ? 'يومين' : n <= 10 ? n + ' أيام' : n + ' يومًا';
  const calRange = (f, t) => { const a = parseYmd(f), b = parseYmd(t), mo = (d) => d.toLocaleDateString(LOC, { month: 'long' });
    return a.getMonth() === b.getMonth() ? `${a.getDate()}–${b.getDate()} ${mo(b)}` : `${a.getDate()} ${mo(a)} – ${b.getDate()} ${mo(b)}`; };
  function renderCal() {
    const bar = $('#calBar'), A = window.ACAD; if (!bar || !A) return;
    const now = new Date(), today = ymd(now), dow = now.getDay();
    const weekOf = (ds) => A.weeks.find((w) => ds >= w.s && ds <= ymd(new Date(parseYmd(w.s).getTime() + 6 * 864e5)));
    const weekTxt = (w) => `الأسبوع ${w.n} · الفصل ${w.t === 1 ? 'الأول' : 'الثاني'}${w.ex ? ' (اختبارات)' : ''}`;
    const cur = A.hol.find((h) => today >= h.f && today <= h.to), w = weekOf(today);
    let wk = '', hl = '';
    if (cur) wk = `🏖️ <b>${esc(cur.ar)}</b> · العودة ${esc(calDay(cur.back))}`;
    else if (w) {
      if (dow >= 5) { const nw = weekOf(ymd(new Date(now.getTime() + (7 - dow) * 864e5))); wk = nw ? `📅 القادم: <b>${esc(weekTxt(nw))}</b>` : `📅 <b>${esc(weekTxt(w))}</b>`; }
      else wk = `📅 <b>${esc(weekTxt(w))}</b>`;
    } else if (today < A.weeks[0].s) wk = `📅 بداية الدراسة ${esc(calDay(A.weeks[0].s))}`;
    else wk = '📅 انتهى التقويم الدراسي — يلزم تحديثه';
    const nx = A.hol.find((h) => h.f > today);
    if (nx) { const d = Math.round((parseYmd(nx.f) - parseYmd(today)) / 864e5);
      hl = `🏖️ أقرب إجازة: <b>${esc(nx.ar)}</b> (${esc(calRange(nx.f, nx.to))}) · ${d === 1 ? 'تبدأ غدًا' : 'بعد ' + daysWord(d)}`; }
    bar.innerHTML = `<span class="cc">${wk}</span>${hl ? `<span class="cc hol">${hl}</span>` : ''}`;
  }
  function openCalendar() {
    const A = window.ACAD; if (!A) return;
    const today = ymd(new Date());
    const rows = [...A.hol.map((h) => ({ d: h.f, e: h.to, name: h.ar, h: h.h, hol: true, back: h.back })), ...A.other.map((o) => ({ d: o.d, name: o.ar, h: o.h }))]
      .sort((a, b) => a.d.localeCompare(b.d));
    modal({ title: '📅 التقويم الدراسي ' + A.year, wide: true, body: `<p class="hint" style="margin:0 0 8px">مكة · المدينة · جدة · الطائف</p>
      <div class="table-wrap"><table class="caltbl"><thead><tr><th>البيان</th><th>التاريخ</th><th>هجري</th></tr></thead><tbody>
      ${rows.map((r) => { const past = (r.e || r.d) < today, now = r.hol && today >= r.d && today <= r.e;
        return `<tr class="${now ? 'now' : past ? 'past' : ''}"><td>${r.hol ? '🏖️ ' : ''}${esc(r.name)}${r.hol ? `<div class="hint" style="margin:0">العودة ${esc(calDay(r.back))}</div>` : ''}</td>
          <td>${esc(calDay(r.d))}${r.e ? '<br>– ' + esc(calDay(r.e)) : ''}</td><td>${esc(r.h || '')}</td></tr>`; }).join('')}
      </tbody></table></div>`, actions: [{ label: 'إغلاق', cls: 'primary', value: true }] });
  }
  let clockTimer = null, calKey = '';
  function startClock() {
    const tick = () => {
      const n = new Date(), c = $('#clk'), t = $('#todayLbl'); if (!c) return;
      if (ymd(n) !== calKey) { calKey = ymd(n); renderCal(); }
      c.textContent = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
      try { t.textContent = n.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long' }); } catch (e) { t.textContent = ymd(n); }
    };
    tick(); clearInterval(clockTimer); clockTimer = setInterval(tick, 10000);
  }

  // تنزيل ملف CSV بترميز يقرؤه Excel بالعربية
  function downloadCSV(name, rows) {
    const csv = rows.map((r) => r.map((v) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  window.LMS = { sb, C, configured, ROLE_LABELS, esc, $, $$, toast, modal, confirmBox, errMsg,
                 fetchAll, signInWithGoogle, signOut, getContext, requireAuth, downloadCSV, rememberNext, takeNext,
                 getView, setView, canSwitch, applyView };
})();
