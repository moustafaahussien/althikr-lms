/* =====================================================================
   الواجهة الإنجليزية (English UI) — منصة المدرسة
   • العربية هي الأصل، وعند اختيار English تُترجم الواجهة تلقائيًا ويتحول الاتجاه لليسار.
   • الترجمة للواجهة فقط (لا تمس البيانات المخزنة: الأسماء والملاحظات… تبقى كما كُتبت).
   • القاموس في assets/js/i18n-en.js (نص عربي ← إنجليزي). لإضافة ترجمة: أضف السطر هناك.
   ===================================================================== */
(function () {
  'use strict';
  var LANG = 'ar';
  try { LANG = localStorage.getItem('lms_lang') === 'en' ? 'en' : 'ar'; } catch (e) {}
  window.LMS_LANG = LANG;
  window.setLang = function (l) { try { localStorage.setItem('lms_lang', l); } catch (e) {} location.reload(); };

  // زر التبديل (أسفل الصفحة)
  function addToggle() {
    if (document.getElementById('langToggle') || !document.body) return;
    var b = document.createElement('button');
    b.id = 'langToggle'; b.type = 'button'; b.setAttribute('data-raw', '');
    b.textContent = LANG === 'en' ? 'عربي' : 'English';
    b.title = LANG === 'en' ? 'التحويل إلى العربية' : 'Switch to English';
    b.style.cssText = 'position:fixed;bottom:12px;inset-inline-start:12px;z-index:9999;border:1px solid #cfe0d8;background:#fff;color:#007B51;border-radius:99px;padding:6px 14px;font:700 13px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.12);cursor:pointer';
    b.onclick = function () { window.setLang(LANG === 'en' ? 'ar' : 'en'); };
    document.body.appendChild(b);
    var st = document.createElement('style'); st.textContent = '@media print{#langToggle{display:none!important}}'; document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', addToggle); else addToggle();

  if (LANG !== 'en') { window.TR = function (s) { return s; }; return; }

  document.documentElement.lang = 'en'; document.documentElement.dir = 'ltr';
  // التواريخ والأرقام بالإنجليزية بدل العربية
  ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach(function (fn) {
    var orig = Date.prototype[fn];
    Date.prototype[fn] = function (loc, opt) {
      if (typeof loc === 'string' && /^ar/.test(loc)) loc = 'en-GB' + (/-ca-gregory/.test(loc) ? '-u-ca-gregory' : (/-ca-islamic/.test(loc) ? '-u-ca-islamic-umalqura' : ''));
      return orig.call(this, loc, opt);
    };
  });
  // تحميل القاموس (متزامن قبل رسم الصفحة)
  if (!window.LMS_I18N) document.write('<script src="assets/js/i18n-en.js?v=202611262000"><\/script>');

  var AR = /[؀-ۿ]/;
  var RUN = /[ء-يً-ٰٟٱ-ۓـ]+(?:[  ]+[ء-يً-ٰٟٱ-ۓـ]+)*/g;
  var DIG = /[٠-٩]/g;
  function D() { return window.LMS_I18N || {}; }
  function has(k) { return Object.prototype.hasOwnProperty.call(D(), k); }
  function fixPunct(s) {
    return s.replace(DIG, function (d) { return String(d.charCodeAt(0) - 0x0660); }).replace(/،/g, ',').replace(/؛/g, ';').replace(/؟/g, '?').replace(/[«»]/g, '"');
  }
  function core(t) {
    if (has(t)) return D()[t];
    var seps = [' · ', ' — ', ' – ', ' | ', '، ', ' ← ', ' → '];
    for (var i = 0; i < seps.length; i++) {
      if (t.indexOf(seps[i]) >= 0) {
        var p = t.split(seps[i]), ok = false;
        var q = p.map(function (x) { var r = core(x.trim()); if (r != null) { ok = true; return r; } return runs(x); });
        if (ok) return q.join(seps[i] === '، ' ? ', ' : seps[i]);
      }
    }
    var m = t.match(/^([^؀-ۿA-Za-z0-9«(]+)\s*([\s\S]+)$/); if (m) { var r1 = core(m[2]); if (r1 != null) return m[1] + ' ' + r1; }
    m = t.match(/^([\s\S]+?)\s*([:.!؟?…]+)$/); if (m) { var r2 = core(m[1]); if (r2 != null) return r2 + fixPunct(m[2]); }
    m = t.match(/^([\s\S]+) \((\d+)\)$/); if (m) { var r3 = core(m[1]); if (r3 != null) return r3 + ' (' + m[2] + ')'; }
    return null;
  }
  // ترجمة كل مقطع عربي داخل النص على حدة (للنصوص المركّبة مع أرقام وأسماء)
  function runs(s) {
    return fixPunct(s.replace(RUN, function (w) {
      if (has(w)) return D()[w];
      var m = w.match(/^و(.+)$/); if (m && has(m[1])) return 'and ' + D()[m[1]];
      m = w.match(/^(.+) و(.+)$/); if (m && has(m[1]) && has(m[2])) return D()[m[1]] + ' and ' + D()[m[2]];
      return w;
    }));
  }
  function TR(s) {
    if (s == null) return s; s = String(s); if (!AR.test(s)) return s;
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    var t = m[2].replace(/\s+/g, ' ');
    var r = core(t);
    return m[1] + (r == null ? runs(m[2]) : r) + m[3];
  }
  window.TR = TR;

  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, NOSCRIPT: 1 };
  function okNode(el) { return el && !SKIP[el.tagName] && !el.isContentEditable && !(el.closest && el.closest('[data-raw],input,[contenteditable="true"]')); }
  function doText(nd) { if (!AR.test(nd.nodeValue)) return; var p = nd.parentElement; if (!okNode(p)) return; var r = TR(nd.nodeValue); if (r !== nd.nodeValue) nd.nodeValue = r; }
  function doAttrs(el) {
    if (!el.getAttribute || (el.closest && el.closest('[data-raw]'))) return;
    ['placeholder', 'title', 'aria-label', 'alt'].forEach(function (a) { var v = el.getAttribute(a); if (v && AR.test(v)) { var r = TR(v); if (r !== v) el.setAttribute(a, r); } });
    if (el.tagName === 'INPUT' && /^(button|submit|reset)$/i.test(el.type) && AR.test(el.value)) el.value = TR(el.value);
    if (el.tagName === 'OPTGROUP' && AR.test(el.label || '')) el.label = TR(el.label);
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) return doText(root);
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) { if (SKIP[root.tagName]) return; doAttrs(root); }
    var w = (root.ownerDocument || root).createTreeWalker(root, 5);
    var nd; while ((nd = w.nextNode())) { if (nd.nodeType === 3) doText(nd); else doAttrs(nd); }
  }
  window.TRwalk = walk;
  var busy = false;
  var mo = new MutationObserver(function (list) {
    if (busy) return; busy = true;
    try {
      for (var i = 0; i < list.length; i++) {
        var m = list[i];
        if (m.type === 'characterData') doText(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
      }
      if (AR.test(document.title)) document.title = TR(document.title);
    } finally { busy = false; }
  });
  function start() {
    walk(document.documentElement);
    if (AR.test(document.title)) document.title = TR(document.title);
    mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'] });
  }
  // التنبيهات والتأكيدات الأصلية في المتصفح
  var _alert = window.alert, _confirm = window.confirm, _prompt = window.prompt;
  window.alert = function (s) { return _alert.call(window, TR(s)); };
  window.confirm = function (s) { return _confirm.call(window, TR(s)); };
  window.prompt = function (s, d) { return _prompt.call(window, TR(s), d); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
