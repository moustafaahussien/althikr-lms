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
  async function requireAuth(roles = []) {
    if (!sb) { location.href = 'index.html'; return new Promise(() => {}); }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { location.href = 'index.html'; return new Promise(() => {}); }
    let ctx;
    try { ctx = await getContext(); } catch (e) { toast(errMsg(e), 'err'); throw e; }
    if (!ctx || !ctx.registered) { location.href = 'index.html'; return new Promise(() => {}); }
    if (roles.length && !roles.includes(ctx.profile.role)) { location.href = 'home.html'; return new Promise(() => {}); }
    renderTopbar(ctx);
    return ctx;
  }

  function renderTopbar(ctx) {
    const bar = $('#topbar');
    if (!bar) return;
    const p = ctx.profile;
    const isAdmin = p.role === 'admin';
    const here = location.pathname.split('/').pop() || 'index.html';
    bar.innerHTML = `
      <a class="brand" href="home.html"><span class="logo-dot">د</span><span>${esc(C.PLATFORM_NAME)}</span></a>
      <nav class="nav">
        <a href="home.html" class="${here === 'home.html' ? 'on' : ''}">الرئيسية</a>
        ${isAdmin ? `<a href="admin.html" class="${here === 'admin.html' ? 'on' : ''}">لوحة الإدارة</a>` : ''}
      </nav>
      <div class="me">
        <div class="me-text"><b>${esc(p.full_name)}</b><small>${esc(p.job_title || ROLE_LABELS[p.role])}</small></div>
        <button class="btn ghost sm" id="logoutBtn">خروج</button>
      </div>`;
    $('#logoutBtn').onclick = signOut;
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
                 fetchAll, signInWithGoogle, signOut, getContext, requireAuth, downloadCSV };
})();
