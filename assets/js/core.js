/* =====================================================================
   النواة المشتركة: الاتصال بـ Supabase، الدخول، الحماية، أدوات الواجهة
   ===================================================================== */
(function () {
  const C = window.LMS_CONFIG;
  // جذر المنصة (المجلد الذي فيه assets/) — من مسار هذا الملف نفسه
  const BASE = (document.currentScript && document.currentScript.src || location.href).replace(/assets\/js\/core\.js.*$/, '').replace(/[^/]*([?#].*)?$/, '');
  const configured = C && !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY);
  /* الوضع التجريبي (ديمو): مدرسة افتراضية داخل المتصفح بدل قاعدة البيانات الحقيقية — assets/js/demo.js
     يُحمَّل مباشرة بعد هذا الملف (قبل سكربت الصفحة)، ولا يُنشأ اتصال حقيقي إطلاقًا أثناء التجربة */
  const DEMO = (() => { try { return sessionStorage.getItem('lms_demo') || ''; } catch (_) { return ''; } })();
  if (DEMO && !window.LMS_DEMO) document.write('<script src="' + BASE + 'assets/js/demo.js?v=202611230100"><\/script>');
  const sb = DEMO
    ? new Proxy({}, { get: (_, k) => (window.LMS_DEMO ? window.LMS_DEMO.client[k] : undefined) })
    : configured
    ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
      })
    : null;
  // شريط «وضع تجريبي» أعلى كل الصفحات + تغيير الدور + الخروج من التجربة
  if (DEMO) {
    const band = () => {
      if (document.getElementById('demoBand')) return;
      const D = window.LMS_DEMO || {}, R = D.roles || {};
      const b = document.createElement('div'); b.id = 'demoBand'; b.className = 'demo-band no-print'; b.setAttribute('role', 'note');
      b.innerHTML = `<span>🎬 <b>وضع تجريبي</b> — مدرسة افتراضية ببيانات وهمية، ولا شيء يُحفظ</span>
        <span class="db-r">الدور: <b>${esc(R[DEMO] || DEMO)}</b>${DEMO === 'parent' ? ' · الرمز السري: <b dir="ltr">123456</b>' : ''}</span>
        <a href="${BASE}index.html?demo=1">🔄 تغيير الدور</a><a href="#" id="demoExit">✕ خروج من التجربة</a>`;
      document.body.prepend(b);
      b.querySelector('#demoExit').onclick = (e) => { e.preventDefault(); if (D.exit) D.exit(); clearCache(); location.href = BASE + 'index.html'; };
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', band) : setTimeout(band, 0);
  }

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
    if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
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
  function safeNext(n) { return n && /^(\/(Mawhiba|21csu)\/)?[a-z0-9][a-z0-9/_.?=&%-]*$/i.test(n) && !n.includes('..') ? n : ''; }   // منصتا الموهبة والقرن 21 على نفس النطاق
  function rememberNext() {
    const n = safeNext(new URLSearchParams(location.search).get('next'));
    try { if (n) sessionStorage.setItem('lms_next', n); } catch (_) {}
  }
  function takeNext() {
    let n = ''; try { n = safeNext(sessionStorage.getItem('lms_next')); sessionStorage.removeItem('lms_next'); } catch (_) {}
    return n;
  }

  // parent = true: حساب Google الشخصي لولي الأمر (بدون تقييد نطاق المدرسة)
  async function signInWithGoogle(parent) {
    const redirectTo = BASE + 'index.html';
    const queryParams = parent === true ? { prompt: 'select_account' } : { hd: C.SCHOOL_DOMAIN, prompt: 'select_account' };
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, queryParams } });
    if (error) toast(errMsg(error), 'err');
  }

  async function signOut() {
    clearCache();
    try { await sb.auth.signOut(); } catch (_) {}
    location.href = BASE + 'index.html';
  }

  /* كاش قصير داخل التبويب (sessionStorage — يُمسح بإغلاق التبويب وعند الخروج)
     لبيانات قليلة التغيّر: يوفّر طلبًا أو أكثر في كل انتقال بين الصفحات ويخفّف الضغط وقت الذروة.
     الصلاحيات الفعلية تُفرض في قاعدة البيانات (RLS)، فالكاش لا يمنح أي وصول. */
  const CK = 'lms_c:';
  async function uidKey() { try { const { data } = await sb.auth.getSession(); return (data.session && data.session.user.id) || ''; } catch (_) { return ''; } }
  async function cached(key, ttlMs, fn) {
    const k = CK + (await uidKey()) + ':' + key;
    try { const v = JSON.parse(sessionStorage.getItem(k) || 'null'); if (v && Date.now() - v.t < ttlMs) return v.d; } catch (_) {}
    const d = await fn();
    try { sessionStorage.setItem(k, JSON.stringify({ t: Date.now(), d })); } catch (_) {}
    return d;
  }
  function clearCache() { try { Object.keys(sessionStorage).filter((k) => k.startsWith(CK)).forEach((k) => sessionStorage.removeItem(k)); } catch (_) {} }

  // fresh = true: تجاهل الكاش (صفحة الدخول مثلًا)
  async function getContext(fresh) {
    const load = async () => { const { data, error } = await sb.rpc('my_context'); if (error) throw error; return data; };
    if (fresh) { clearCache(); }
    return cached('ctx', 5 * 60e3, load);
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
    if (!sb) { location.href = BASE + 'index.html'; return new Promise(() => {}); }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = BASE + 'index.html'; return new Promise(() => {}); }
    let ctx;
    try { ctx = await getContext(); } catch (e) { toast(errMsg(e), 'err'); throw e; }
    if (!ctx || !ctx.registered) { location.href = BASE + 'index.html'; return new Promise(() => {}); }
    applyView(ctx);
    if (roles.length && !roles.includes(ctx.profile.role)) { location.href = BASE + 'home.html'; return new Promise(() => {}); }
    renderTopbar(ctx);
    return ctx;
  }

  /* ---------- الشريط العلوي الموحّد ----------
     الروابط مطلقة من جذر المنصة (BASE) فيعمل الشريط في الصفحات الفرعية أيضًا (مثل online/) */
  function pageKey() {
    let k = location.href.split(/[?#]/)[0];
    k = k.startsWith(BASE) ? k.slice(BASE.length) : k.split('/').pop();
    return k.replace(/(^|\/)index\.html$/, '$1') || 'index.html';
  }
  // قائمة منسدلة عامة (المزيد / ☰) — تُرسم خارج الشريط حتى لا يقصّها التمرير الأفقي
  function dropMenu(btn, html, full) {
    let menu = null;
    const close = () => { if (!menu) return; menu.remove(); menu = null; btn.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', onEsc); };
    const outside = (e) => { if (menu && !menu.contains(e.target) && !btn.contains(e.target)) close(); };
    const onEsc = (e) => { if (e.key === 'Escape') { close(); btn.focus(); } };
    btn.onclick = () => {
      if (menu) return close();
      menu = document.createElement('div'); menu.className = 'more-menu' + (full ? ' full' : ''); menu.setAttribute('role', 'menu');
      menu.innerHTML = html;
      const n = (window.LMS_MSG && window.LMS_MSG.unread) || 0;   // عدّاد الرسائل داخل القائمة
      $$('.nbadge', menu).forEach((b) => { b.removeAttribute('id'); b.hidden = !n; b.textContent = n; });
      document.body.appendChild(menu);
      const r = (full ? $('#topbar') : btn).getBoundingClientRect(), w = menu.offsetWidth;
      menu.style.top = (r.bottom + (full ? 0 : 4)) + 'px';
      if (!full) menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
      btn.setAttribute('aria-expanded', 'true');
      document.addEventListener('mousedown', outside); document.addEventListener('keydown', onEsc);
      const f = $('a,button', menu); if (f) f.focus();
    };
    window.addEventListener('resize', close);
  }

  function renderTopbar(ctx) {
    const bar = $('#topbar');
    if (!bar) return;
    const p = ctx.profile, LIM = !!ctx.limited;   // limited: طالب يدخل «التعليم عن بعد» ودخول الطلاب للمنصة مقفول
    const here = pageKey();
    const R = p.role, STAFF = !LIM && !['student', 'parent'].includes(R), MGR = ['admin', 'leadership', 'principal'].includes(R);
    // روابط أساسية دائمًا في الشريط، والباقي في قائمة «المزيد»
    const links = [['home.html', '🏠 الرئيسية', !LIM],
      ['online/', '🎥 التعليم عن بعد', true],
      ['messages.html', '✉️ الرسائل <span class="nbadge" id="navMsg" hidden></span>', !LIM],
      ['services.html', '🗂️ الخدمات', !LIM],
      ['attendance.html', '🗓️ الحضور والغياب', STAFF],
      ['supervision/', '🧭 مكتب الإشراف', MGR || R === 'supervisor']].filter((l) => l[2]);
    const more = [['admin.html', '⚙️ لوحة الإدارة', R === 'admin'],
      ['settings.html', '🏫 إعدادات المدرسة', MGR],
      ['teaching-load.html', '📊 نصاب الحصص', MGR || R === 'supervisor'],
      ['staff-directory.html', '📇 دليل الموظفين', STAFF],
      ['guardians.html', '👪 أولياء الأمور', MGR]].filter((l) => l[2] && !LIM);
    const curMore = more.find((l) => l[0] === here);
    const navA = ([href, label]) => `<a href="${BASE + href}" class="${here === href ? 'on' : ''}"${here === href ? ' aria-current="page"' : ''}>${label}</a>`;
    const roleTxt = LIM ? 'طالب' : ctx.viewAs ? (p.job_title || ROLE_LABELS.supervisor) : ctx.canSwitch ? ROLE_LABELS[p.role] : (p.job_title || ROLE_LABELS[p.role]);
    bar.innerHTML = `
      <a class="skip-link" href="#main">تخطَّ إلى المحتوى</a>
      <div class="hrow">
        <a class="brand" href="${BASE + (LIM ? 'online/' : 'home.html')}"><span class="logo-tile"><img src="${BASE}assets/img/logo-mark.png" alt="مدارس دار الذكر"></span><span>${esc(C.PLATFORM_NAME)}<small>${esc(C.SCHOOL_NAME)}</small></span></a>
        <div class="clock">
          <span class="who"><b>${esc(p.full_name)}</b><small>${esc(roleTxt)}</small></span>
          <button class="btn sm hbtn" id="lmsLogout" type="button">خروج</button>
          <span id="todayLbl"></span><b id="clk">--:--</b>
          <button type="button" class="menu-btn" id="menuBtn" aria-label="القائمة" aria-haspopup="true" aria-expanded="false">☰</button>
        </div>
      </div>
      <nav class="lms-nav" aria-label="القائمة الرئيسية">
        ${links.map(navA).join('')}
        ${more.length ? `<button type="button" class="more-btn ${curMore ? 'on' : ''}" id="moreBtn" aria-haspopup="true" aria-expanded="false">${curMore ? esc(curMore[1].replace(/^\S+\s/, '')) : 'المزيد'} ▾</button>` : ''}
        <div id="calBar" class="calbar" role="button" tabindex="0" title="التقويم الدراسي"></div>
      </nav>`;
    $('#lmsLogout').onclick = signOut;
    if ($('#moreBtn')) dropMenu($('#moreBtn'), more.map(navA).join(''));
    // الجوال: كل الروابط في قائمة ☰ (مع الاسم والمسمى)
    dropMenu($('#menuBtn'), `<div class="mm-who"><b>${esc(p.full_name)}</b><small>${esc(roleTxt)}</small></div>${links.concat(more).map(navA).join('')}`, true);
    if (!$('#main')) { const m = $('main'); if (m) m.id = 'main'; }
    // عدّاد الرسائل غير المقروءة والتعاميم التي تنتظر «تم الاطلاع»
    const msgBadge = async () => { try { const { data } = await sb.rpc('msg_counts'); if (!data) return;
      const n = (data.unread || 0); $$('#navMsg').forEach((b) => { b.hidden = !n; b.textContent = n; });
      window.LMS_MSG = data; document.dispatchEvent(new CustomEvent('lms:msg', { detail: data })); } catch (_) {} };
    if (!LIM) { msgBadge(); clearInterval(window.__msgT); window.__msgT = setInterval(msgBadge, 90000); }
    const cal = $('#calBar');
    cal.onclick = openCalendar;
    cal.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCalendar(); } };
    startClock();
  }

  /* شريط المنصة في صفحة لها دخولها الخاص (مثل «التعليم عن بعد»):
     بلا جلسة ← صفحة الدخول ثم الرجوع (next)، والطالب غير المفعّل في المنصة يرى شريطًا مختصرًا */
  async function mountTopbar(next) {
    if (!sb) return null;
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.replace(BASE + 'index.html' + (next ? '?next=' + encodeURIComponent(next) : '')); return new Promise(() => {}); }
    let ctx = null;
    try { ctx = await getContext(); } catch (_) {}
    if (ctx && ctx.registered) applyView(ctx);
    else ctx = { limited: true, profile: { full_name: (ctx && ctx.email) || session.user.email || '', role: 'student' } };
    renderTopbar(ctx);
    return ctx;
  }

  /* ---------- الساعة والتاريخ والتقويم الدراسي (نفس شريط مكتب الإشراف التربوي) ---------- */
  /* نص الفصل في الجدول للعرض: حصص المجموعات (الإنجليزي حسب المستوى) خانتها فيها أكثر من فصل
     مثل «6-د/٦/ج/٦/ب/٦/أ» ← تُعرض «الصف السادس» بدل الأسماء المتداخلة */
  const GRADE_AR = ['', 'الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر'];
  function isGroupCls(cls) { const m = /^\s*(\d+)\s*-\s*(.+)$/.exec(cls || ''); return !!(m && /[/،,]/.test(m[2])); }
  function clsText(cls) {
    const m = /^\s*(\d+)\s*-\s*(.+)$/.exec(cls || '');
    if (!m || !/[/،,]/.test(m[2])) return cls || '';
    return 'الصف ' + (GRADE_AR[+m[1]] || m[1]);
  }
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

  /* ---------- التاريخ الهجري (أم القرى) ---------- */
  function hijri(d, opts) {
    try {
      const dt = d instanceof Date ? d : (/^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? parseYmd(String(d)) : new Date(d));
      if (isNaN(dt)) return '';
      return dt.toLocaleDateString('ar-SA-u-ca-islamic-umalqura-nu-latn', opts || { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (e) { return ''; }
  }
  const dateLine = (d) => { const dt = d || new Date();
    return `${dt.toLocaleDateString(LOC, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} م — ${hijri(dt)}`; };
  // كل حقل تاريخ في المنصة يظهر بجانبه التاريخ الهجري تلقائيًا
  function hijriHint(inp) {
    let h = inp.nextElementSibling;
    if (!h || !h.classList || !h.classList.contains('hijri-hint')) {
      h = document.createElement('small'); h.className = 'hijri-hint'; inp.after(h);
      inp.addEventListener('input', () => hijriHint(inp)); inp.addEventListener('change', () => hijriHint(inp));
    }
    h.textContent = inp.value ? hijri(inp.value) : '';
  }

  /* ---------- الطباعة والتصدير الموحّدان لكل التقارير ---------- */
  const PRINT_CSS = `@page{size:A4;margin:14mm 12mm}*{box-sizing:border-box}body{font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;color:#1b2430;margin:0;direction:rtl;font-size:12px}
    .ph{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0f6e6a;padding-bottom:8px;margin-bottom:12px}
    .ph img{width:62px;height:62px;object-fit:contain}.ph h1{margin:0;font-size:18px;color:#0f6e6a}.ph .s{color:#66727f;font-size:11px}.ph .d{margin-inline-start:auto;text-align:left;font-size:11px;color:#444}
    h2{font-size:15px;margin:10px 0 6px}table{width:100%;border-collapse:collapse;margin:6px 0 12px}th,td{border:1px solid #c9d3dc;padding:5px 7px;text-align:right;vertical-align:top}
    th{background:#e8f2f1;color:#0b5653}tr:nth-child(even) td{background:#fafcfc}.btn,.no-print,.hijri-hint,button{display:none!important}a{color:inherit;text-decoration:none}
    .pf{margin-top:14px;border-top:1px solid #ddd;padding-top:6px;color:#888;font-size:10px;display:flex;justify-content:space-between}`;
  function printHTML(title, html) {
    const w = window.open('', '_blank');
    if (!w) { toast('اسمح للمتصفح بفتح نافذة الطباعة', 'warn'); return; }
    const base = location.href.replace(/[^/]*([?#].*)?$/, '').replace(/supervision\/$/, '');
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap" rel="stylesheet"><style>${PRINT_CSS}</style></head><body>
      <div class="ph"><img src="${base}assets/img/logo.png" alt=""><div><h1>${esc(title)}</h1><div class="s">${esc(C.SCHOOL_NAME || 'مدارس دار الذكر')} — ${esc(C.PLATFORM_NAME || '')}</div></div>
      <div class="d">${esc(dateLine())}</div></div>${html}
      <div class="pf"><span>${esc(C.PLATFORM_NAME || '')}</span><span>طُبع في ${esc(new Date().toLocaleString('ar-SA-u-ca-gregory-nu-latn'))}</span></div>
      <script>document.fonts&&document.fonts.ready.then(()=>setTimeout(()=>print(),250));<\/script></body></html>`);
    w.document.close();
  }
  function tableRows(tbl) {
    return $$('tr', tbl).filter((tr) => tr.offsetParent !== null || !tr.closest('tbody'))
      .map((tr) => $$('th,td', tr).filter((c) => !c.classList.contains('actions') && !c.classList.contains('no-export'))
        .map((c) => (c.innerText || '').replace(/\s+/g, ' ').trim()));
  }
  function titleFor(el) {
    if (el.dataset.title) return el.dataset.title;
    let n = el;
    for (let i = 0; i < 12 && n; i++) {
      let p = n.previousElementSibling;
      while (p) { const h = p.matches('h1,h2,h3') ? p : p.querySelector && p.querySelector('h1,h2,h3'); if (h) return h.textContent.trim(); p = p.previousElementSibling; }
      n = n.parentElement;
    }
    return document.title.split('—')[0].trim();
  }
  function printTable(wrapOrTable, title) {
    const tbl = wrapOrTable.tagName === 'TABLE' ? wrapOrTable : $('table', wrapOrTable);
    const c = tbl.cloneNode(true);
    $$('.actions,.no-export,button,input,select', c).forEach((x) => { if (x.matches('td,th')) x.remove(); else x.replaceWith(document.createTextNode(x.value || x.textContent || '')); });
    $$('tr', c).forEach((tr, i) => { const o = $$('tr', tbl)[i]; if (o && o.closest('tbody') && o.offsetParent === null) tr.remove(); });
    printHTML(title || titleFor(wrapOrTable), c.outerHTML);
  }
  function exportTable(wrapOrTable, title) {
    const tbl = wrapOrTable.tagName === 'TABLE' ? wrapOrTable : $('table', wrapOrTable);
    const t = (title || titleFor(wrapOrTable)).replace(/[\\/:*?"<>|]+/g, '-');
    downloadCSV(`${t} ${ymd(new Date())}.csv`, tableRows(tbl));
  }
  // كل جدول في المنصة يحصل تلقائيًا على زري «طباعة» و«Excel»
  function addTableTools(wrap) {
    if (wrap.dataset.tools || wrap.classList.contains('no-tools') || !$('table', wrap) || wrap.closest('.modal-wrap.no-tools')) return;
    wrap.dataset.tools = '1';
    const bar = document.createElement('div'); bar.className = 'tbl-tools no-print';
    bar.innerHTML = '<button type="button" class="btn sm" data-a="p">🖨️ طباعة</button><button type="button" class="btn sm" data-a="x">⬇️ Excel</button>';
    bar.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; b.dataset.a === 'p' ? printTable(wrap) : exportTable(wrap); };
    wrap.before(bar);
  }
  function enhance(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches('input[type=date]')) hijriHint(root);
    $$('input[type=date]', root).forEach(hijriHint);
    if (root.matches && root.matches('.table-wrap')) addTableTools(root);
    $$('.table-wrap', root).forEach(addTableTools);
  }
  if (typeof MutationObserver !== 'undefined' && !window.LMS_NO_ENHANCE) {
    const start = () => { enhance(document.body);
      new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.nodeType === 1 && enhance(n)))).observe(document.body, { childList: true, subtree: true });
      // تغيير قيمة حقل التاريخ من الكود (بدون حدث) — نحدّث الهجري دوريًا وبخفة
      setInterval(() => $$('input[type=date]').forEach((i) => { const h = i.nextElementSibling; if (h && h.classList.contains('hijri-hint') && h.dataset.v !== i.value) { h.dataset.v = i.value; h.textContent = i.value ? hijri(i.value) : ''; } }), 1500);
    };
    document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', start) : start();
  }

  window.LMS = { sb, C, configured, ROLE_LABELS, esc, $, $$, toast, modal, confirmBox, errMsg,
                 fetchAll, signInWithGoogle, signOut, getContext, cached, clearCache, requireAuth, downloadCSV, rememberNext, takeNext,
                 getView, setView, canSwitch, applyView, mountTopbar, BASE, hijri, dateLine, printHTML, printTable, exportTable, tableRows, ymd, clsText, isGroupCls, DEMO };
})();
