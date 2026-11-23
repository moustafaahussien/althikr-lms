/* =====================================================================
   المعلم الذكي داخل المنصة — الربط بحساب المدرسة وقاعدة بيانات المنصة
   - الصفحة للموظفين فقط (الطلاب وأولياء الأمور يُعادون للرئيسية)
   - كل طلبات الخادم القديم (Apps Script) تذهب لدالة ai_call في Supabase
   - الملفات والصور تُرفع لمخزن «ai» في المنصة
   ===================================================================== */
(function () {
  'use strict';
  const C = window.LMS_CONFIG;
  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY,
    { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
  const PUB = C.SUPABASE_URL + '/storage/v1/object/public/ai/';
  const page = (location.pathname.split('/').pop() || 'index.html');

  // ستارة حتى يتم التحقق من الحساب
  const veil = document.createElement('style');
  veil.textContent = 'body>*:not(#lmsGate){visibility:hidden} #lmsGate{position:fixed;inset:0;display:grid;place-items:center;font-family:Tahoma,sans-serif;color:#5E6662;z-index:99999}';
  document.head.appendChild(veil);
  function gateMsg(html) {
    let g = document.getElementById('lmsGate');
    if (!g) { g = document.createElement('div'); g.id = 'lmsGate'; (document.body || document.documentElement).appendChild(g); }
    g.innerHTML = '<div style="text-align:center;max-width:460px;padding:24px;line-height:2">' + html + '</div>';
  }
  const toLogin = () => { location.href = '../index.html?next=' + encodeURIComponent('ai/' + (page === 'index.html' ? '' : page + location.search)); };

  // الوضع التجريبي للمنصة: المعلم الذكي يحتاج الخادم الحقيقي، فلا يعمل داخل التجربة
  let DEMO_ON = false; try { DEMO_ON = !!sessionStorage.getItem('lms_demo'); } catch (_) {}
  const ready = (async () => {
    if (DEMO_ON) { const msg = () => gateMsg('🎬<br><b>المعلم الذكي</b> غير متاح في الوضع التجريبي.<br><a href="../home.html" style="color:#007B51">← العودة للمنصة التجريبية</a>');
      document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', msg) : msg(); return new Promise(() => {}); }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { toLogin(); return new Promise(() => {}); }
    const { data: ctx, error } = await sb.rpc('my_context');
    if (error || !ctx || !ctx.registered) { toLogin(); return new Promise(() => {}); }
    const p = ctx.profile;
    if (['student', 'parent'].includes(p.role)) {
      document.addEventListener('DOMContentLoaded', () => gateMsg('🤖<br><b>المعلم الذكي</b> متاح لمنسوبي المدرسة فقط.<br><a href="../home.html" style="color:#007B51">← العودة للمنصة</a>'));
      return new Promise(() => {});
    }
    veil.remove(); const g = document.getElementById('lmsGate'); if (g) g.remove();
    if (p.role !== 'admin') { const st = document.createElement('style'); st.textContent = 'a[href^="admin.html"]{display:none!important}'; document.head.appendChild(st); }
    return { session, ctx, me: p, isAdmin: p.role === 'admin' };
  })();
  document.addEventListener('DOMContentLoaded', () => { if (document.contains(veil)) gateMsg('<div style="font-size:28px">⏳</div>جارٍ التحقق من حساب المدرسة…'); });

  // ---------- رفع الملفات ----------
  function dataUrlToBlob(u, mime) {
    const s = String(u || ''), i = s.indexOf(',');
    const bin = atob(i >= 0 ? s.slice(i + 1) : s);
    const a = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) a[k] = bin.charCodeAt(k);
    return new Blob([a], { type: mime || (s.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream' });
  }
  function b64Text(u) { return new TextDecoder('utf-8').decode(new Uint8Array(Array.from(atob(String(u).replace(/^data:[^,]*,/, '')), c => c.charCodeAt(0)))); }
  const EXT = { 'application/pdf': 'pdf', 'application/msword': 'doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.ms-powerpoint': 'ppt', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.ms-excel': 'xls', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  async function upload(b64, mime, me, maxMB, label) {
    const blob = dataUrlToBlob(b64, mime);
    if (blob.size > maxMB * 1048576) throw new Error('حجم ' + label + ' أكبر من المسموح (' + maxMB + ' ميجابايت)');
    const path = 'u/' + me + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + (EXT[blob.type] || 'bin');
    const { error } = await sb.storage.from('ai').upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('تعذّر رفع ' + label + ': ' + error.message);
    return 'sb:' + path;
  }
  async function prepFiles(f, me) {
    if (!f) return f;
    const o = {};
    if (f.app && f.app.b64) {
      const html = b64Text(f.app.b64);
      if (new Blob([html]).size > 5 * 1048576) throw new Error('حجم ملف التطبيق أكبر من المسموح (5 ميجابايت)');
      o.app = { name: f.app.name, html };
    }
    if (f.file && f.file.b64) o.file = { name: f.file.name, mime: f.file.mime, path: await upload(f.file.b64, f.file.mime, me, 10, 'الملف') };
    if (f.cover && f.cover.b64) o.cover = { path: await upload(f.cover.b64, f.cover.mime || 'image/jpeg', me, 2, 'صورة الغلاف') };
    if (f.removeCover) o.removeCover = true;
    if (Array.isArray(f.images)) {
      o.images = [];
      for (let i = 0; i < f.images.length && i < 4; i++) {
        const im = f.images[i];
        if (im && im.keep) o.images.push({ keep: im.keep });
        else if (im && im.b64) o.images.push({ path: await upload(im.b64, im.mime || 'image/jpeg', me, 2, 'الصورة ' + (i + 1)) });
      }
    }
    return o;
  }

  async function call(action, params) {
    const st = await ready;
    const p = Object.assign({}, params || {});
    delete p.adminCode;
    if (p.files) p.files = await prepFiles(p.files, st.me.id);
    const { data, error } = await sb.rpc('ai_call', { action, p });
    if (error) return { ok: false, error: String(error.message || error).replace(/^.*?ERROR:\s*/, '') };
    return data;
  }

  // روابط الملفات: «sb:...» من مخزن المنصة، وغيرها معرّفات Google Drive (منتجات المنصة القديمة)
  const isSb = id => String(id || '').indexOf('sb:') === 0;
  const pub = id => PUB + String(id).slice(3).split('/').map(encodeURIComponent).join('/');
  function fileUrl(id, kind, mime) {
    if (!id) return '';
    if (isSb(id)) {
      const u = pub(id);
      if (kind === 'download') return u + '?download=';
      if (kind === 'preview') return /pdf/.test(mime || '') || /\.pdf$/i.test(id) ? u : 'https://view.officeapps.live.com/op/embed.aspx?src=' + encodeURIComponent(u);
      return u;
    }
    if (kind === 'download') return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(id);
    if (kind === 'preview') return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/preview';
    return 'https://drive.google.com/file/d/' + encodeURIComponent(id) + '/view';
  }
  function imgUrl(id, w) {
    if (!id) return '';
    if (String(id).indexOf('data:') === 0) return id;
    if (isSb(id)) return pub(id);
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (w || 800);
  }

  window.AI_LMS = { sb, ready, call, fileUrl, imgUrl };
})();
