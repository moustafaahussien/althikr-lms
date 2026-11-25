/* دليل الموظفين — للموظفين فقط (الطلاب وأولياء الأمور لا يصلون للصفحة ولا للبيانات) */
(async function () {
  const { sb, esc, $, toast, errMsg, requireAuth, downloadCSV } = LMS;
  const ctx = await requireAuth(['admin', 'leadership', 'principal', 'supervisor', 'teacher', 'staff']);
  const LEADER = ['admin', 'leadership'].includes(ctx.realRole || ctx.profile.role) && !ctx.viewAs;

  // ترتيب الأقسام في الدليل
  const ORDER = ['إدارة المدارس', 'التطوير التربوي', 'بنين — ابتدائي', 'بنين — متوسط', 'بنين — ثانوي', 'الدبلوم الأمريكي', 'قسم البنات',
    'الموارد البشرية', 'المالية', 'تقنية المعلومات', 'خدمة العملاء', 'المشتريات', 'التسويق والاتصال المؤسسي', 'إدارة المرافق'];
  // داخل كل قسم: القيادات أولًا ثم المشرفون ثم المعلمون ثم البقية
  const senior = (t) => { t = String(t || ''); return /تنفيذي|مدير التعليم|مدير عام/.test(t) ? 0 : /^مدير|مديرة|رئيس/.test(t) ? 1 : /وكيل/.test(t) ? 2 : /مرشد/.test(t) ? 4 : /^مشرف|منسق/.test(t) ? 3 : /^معلم/.test(t) ? 5 : 6; };
  const rank = (g) => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i; };
  const norm = (s) => String(s || '').toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/\s+/g, ' ').trim();
  const initials = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0] || '').join(' ');
  const txt = (v) => Array.isArray(v) ? v.join('، ') : String(v || '');
  const telFmt = (m) => /^05\d{8}$/.test(m) ? `${m.slice(0, 3)} ${m.slice(3, 6)} ${m.slice(6)}` : m;
  const wa = (m) => /^05\d{8}$/.test(m) ? '966' + m.slice(1) : (/^01\d{9}$/.test(m) ? '20' + m.slice(1) : '');

  let ALL = [], GRP = '';
  try {
    const { data, error } = await sb.rpc('staff_dir_list');
    if (error) throw error;
    ALL = (data || []).map((p) => Object.assign(p, {
      subj: txt(p.subjects), stg: txt(p.stages),
      key: norm([p.name, p.en, p.title, p.grp, txt(p.subjects), p.email, p.mobile, p.manager, p.no].join(' '))
    })).sort((a, b) => rank(a.grp) - rank(b.grp) || senior(a.title) - senior(b.title) || a.name.localeCompare(b.name, 'ar'));
  } catch (e) { $('#list').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }

  // أدوار المنسوبين في برامج الموهبة — تُقرأ من منصة الموهبة (المصدر الوحيد) وتظهر على بطاقاتهم
  if (window.TALENT && !LMS.DEMO) TALENT.staffMap().then((M) => { ALL.forEach((p) => { p.talent = M.get(String(p.email || '').toLowerCase()) || null; }); render(); }).catch(() => {});
  $('#list').addEventListener('click', (e) => { const b = e.target.closest('[data-tl]'); if (!b) return;
    const p = ALL.find((x) => String(x.email || x.no) === b.dataset.tl); if (!p || !p.talent) return;
    LMS.modal({ title: `🌟 ${p.name} — برامج الموهبة`, wide: true, body: TALENT.staffDetails(p.talent, p.name), actions: [{ label: 'إغلاق', value: null }] }); });
  const groups = [...new Set(ALL.map((p) => p.grp))].sort((a, b) => rank(a) - rank(b));
  $('#grps').innerHTML = [`<button data-g="" class="on">الكل (${ALL.length})</button>`]
    .concat(groups.map((g) => `<button data-g="${esc(g)}">${esc(g)} (${ALL.filter((p) => p.grp === g).length})</button>`)).join('');
  $('#grps').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; GRP = b.dataset.g;
    $('#grps').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); render(); };
  $('#q').oninput = render;
  $('#view').onchange = () => { try { localStorage.setItem('dir_view', $('#view').value); } catch (_) {} render(); };
  try { const v = localStorage.getItem('dir_view'); if (v) $('#view').value = v; } catch (_) {}
  if (LEADER) { $('#csv').style.display = ''; $('#csv').onclick = exportCSV; }

  function filtered() {
    const q = norm($('#q').value);
    return ALL.filter((p) => (!GRP || p.grp === GRP) && (!q || q.split(' ').every((w) => p.key.includes(w))));
  }
  function contact(p) {
    const out = [];
    if (p.mobile) out.push(`<a class="btn sm" href="tel:${esc(p.mobile)}" title="اتصال">📞 <span class="ltr">${esc(telFmt(p.mobile))}</span></a>`);
    if (p.mobile && wa(p.mobile)) out.push(`<a class="btn sm" href="https://wa.me/${wa(p.mobile)}" target="_blank" rel="noopener" title="واتساب">💬</a>`);
    if (p.work) out.push(`<a class="btn sm" href="tel:${esc(p.work)}" title="هاتف العمل">☎️ <span class="ltr">${esc(p.work)}</span></a>`);
    if (p.email) out.push(`<a class="btn sm" href="mailto:${esc(p.email)}" title="${esc(p.email)}">✉️ البريد</a>`);
    return out.join('');
  }
  function card(p) {
    const teach = p.subj ? `<span class="chip teal">${esc(p.subj)}</span>` : '';
    const stg = p.stg && p.stg !== p.grp ? `<span class="chip gray">${esc(p.stg)}</span>` : '';
    return `<div class="person glass">
      <div class="top"><span class="avatar">${esc(initials(p.name))}</span>
        <div><b class="nm">${esc(p.name)}</b><div class="tt">${esc(p.title || '')}</div></div></div>
      <div class="meta">${teach}${stg}</div>
      ${p.manager ? `<div class="mgr">المدير المباشر: ${esc(p.manager)}</div>` : ''}
      ${p.talent ? `<button class="tl-chip" data-tl="${esc(p.email || p.no)}" title="أدواره في برامج الموهبة">🌟 ${esc(window.TALENT.staffSummary(p.talent))}</button>` : ''}
      <div class="links">${contact(p)}</div>
    </div>`;
  }
  function render() {
    const L = filtered();
    $('#count').textContent = `${L.length} موظف`;
    if (!L.length) { $('#list').innerHTML = '<div class="empty">لا توجد نتائج</div>'; return; }
    if ($('#view').value === 'table') {
      $('#list').innerHTML = `<div class="table-wrap" style="max-height:none;margin-top:12px"><table>
        <thead><tr><th>الاسم</th><th>المسمى الوظيفي</th><th>القسم</th><th>المواد</th><th>المدير المباشر</th><th>الجوال</th><th>البريد</th></tr></thead>
        <tbody>${L.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.talent ? ` <button class="tl-chip inline" data-tl="${esc(p.email || p.no)}" title="${esc(window.TALENT.staffSummary(p.talent))}">🌟 الموهبة</button>` : ''}</td><td>${esc(p.title || '')}</td><td>${esc(p.grp || '')}</td><td>${esc(p.subj)}</td>
          <td>${esc(p.manager || '')}</td><td>${p.mobile ? `<a href="tel:${esc(p.mobile)}" class="ltr">${esc(telFmt(p.mobile))}</a>` : ''}</td>
          <td>${p.email ? `<a href="mailto:${esc(p.email)}" class="ltr">${esc(p.email)}</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
      return;
    }
    const by = {}; L.forEach((p) => (by[p.grp] = by[p.grp] || []).push(p));
    $('#list').innerHTML = Object.keys(by).sort((a, b) => rank(a) - rank(b)).map((g) =>
      `<div class="grp-h"><h2>${esc(g)}</h2><span class="hint">${by[g].length}</span></div><div class="dir-grid">${by[g].map(card).join('')}</div>`).join('');
  }
  function exportCSV() {
    downloadCSV('دليل-الموظفين.csv', [['الرقم الوظيفي', 'الاسم', 'الاسم بالإنجليزي', 'المسمى الوظيفي', 'القسم', 'المواد', 'المدير المباشر', 'الجوال', 'هاتف العمل', 'البريد']]
      .concat(filtered().map((p) => [p.no, p.name, p.en, p.title, p.grp, p.subj, p.manager, p.mobile, p.work, p.email])));
  }
  render();
})();
