/* =====================================================================
   ربط منصة المدرسة بمنصة الموهبة — قراءة فقط (المصدر الوحيد: جدول «السجل التام» في منصة الموهبة)
   - TALENT.student(id): مسابقات الطالب وبرامجه وجلساته ونماذج السجل التام
   - TALENT.staffAll(): أدوار المنسوبين في برامج الموهبة (الفريق والجلسات المنفّذة ونماذج السجل)
   الطلب بحساب المدرسة؛ والسكربت يتحقق من المنصة أن الطالب ضمن من يحق للمستخدم رؤيتهم.
   ===================================================================== */
(function () {
  const URL = 'https://script.google.com/macros/s/AKfycbwBoz7RCMQa3fqq1T3UQkjz30G-NUqUS3F5Fc0N-DYcIOjtT4_2Zk0NSFdv7ASR8yyE/exec';
  const SITE = 'https://moustafaahussien.github.io/Mawhiba/';
  const COMP = { kangaroo: 'مسابقة كانجارو موهبة للرياضيات', bebras: 'مسابقة بيبراس موهبة للمعلوماتية', nsmo: 'أولمبياد الموهبة الوطني — المسار العلمي «نسمو»',
                 ibdaa: 'أولمبياد الموهبة الوطني — المسار البحثي «إبداع»', isef: 'معرض ريجينيرون الدولي للعلوم والهندسة ISEF' };
  const PROG = { 'general-enrichment': 'برنامج الإثراء العام', skills: 'برنامج تنمية المهارات', clusters: 'برنامج الأنشطة الموجهة', specialty: 'برنامج الإثراء المتخصص',
                 projects: 'برنامج المشاريع الهادفة', acceleration: 'برنامج التسريع الأكاديمي', mentorship: 'برنامج الرعاية الخاصة', support: 'البرامج المساندة' };
  const STAGE_CLS = { 'فائز': 'win', 'نهائي': 'fin', 'متأهل': 'q', 'مسجّل': '' };

  async function post(body) {
    const { data: { session } } = await LMS.sb.auth.getSession();
    if (!session) throw new Error('سجّل الدخول');
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 25000);
    try {
      // text/plain = طلب بسيط بلا preflight (يقبله Apps Script)، والرمز في جسم الطلب لا في الرابط
      const r = await fetch(URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ code: 'lms:' + session.access_token }, body)), signal: ctl.signal, redirect: 'follow' });
      const d = await r.json();
      if (!d || !d.ok) throw new Error((d && d.error) || 'تعذّر الاتصال بمنصة الموهبة');
      return d;
    } finally { clearTimeout(t); }
  }
  let staffCache = null;
  const nameKey = (x) => String(x || '').replace(/[ً-ْـ]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    .replace(/(^|\s)عبد\s+/g, '$1عبد').replace(/\s+/g, ' ').trim().toLowerCase();
  const nameMatch = (a, full) => { a = nameKey(a); full = nameKey(full); if (!a || !full) return false; if (a === full) return true;
    const aw = a.split(' '), bw = full.split(' '); return aw.length >= 3 && aw.length <= bw.length && aw.every((w, i) => w === bw[i]); };

  // قسم «الموهبة» في ملف الطالب
  async function renderStudent(box, id) {
    const esc = LMS.esc;
    box.innerHTML = '<h3>🌟 الموهبة والمسابقات <span class="hint">من منصة الموهبة</span></h3><div class="hint">جارٍ القراءة من منصة الموهبة…</div>';
    let d; try { d = await post({ action: 'lmsPerson', student: id }); }
    catch (e) { box.innerHTML = `<h3>🌟 الموهبة والمسابقات</h3><div class="hint">تعذّرت القراءة من منصة الموهبة الآن (${esc(e.message || '')}).</div>`; return; }
    const C = d.competitions || [], P = d.programs || [], S = d.sessions || [], R = d.records || [];
    if (!C.length && !P.length && !R.length && !S.length) { box.innerHTML = `<h3>🌟 الموهبة والمسابقات <span class="hint">من منصة الموهبة</span></h3><div class="empty">لا توجد مشاركات مسجّلة للطالب في منصة الموهبة.</div>`; return; }
    const att = S.filter((s) => s.attended === true).length, done = S.filter((s) => s.attended !== null).length;
    const byName = C.some((x) => x.by_name) || P.some((x) => x.by_name);
    box.innerHTML = `<h3>🌟 الموهبة والمسابقات <span class="hint">من منصة الموهبة</span> <a class="hint" href="${SITE}sijil.html" target="_blank" rel="noopener">↗ فتح منصة الموهبة</a></h3>
      ${C.length ? `<h4 class="tl-h">🏆 المسابقات (${C.length})</h4><div class="table-wrap"><table><thead><tr><th>المسابقة</th><th>العام</th><th>المرحلة</th><th>المادة</th><th>ملاحظة</th></tr></thead><tbody>
        ${C.map((c) => `<tr><td><b>${esc(COMP[c.comp] || c.comp)}</b></td><td>${esc(c.year)}</td><td><span class="tag ${STAGE_CLS[c.stage] || ''}">${esc(c.stage)}${c.stage === 'فائز' ? ' 🏅' : ''}</span></td><td>${esc(c.subject || '')}</td><td>${esc(c.note || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${P.length ? `<h4 class="tl-h">🎯 برامج الموهبة (${P.length})</h4><div class="table-wrap"><table><thead><tr><th>البرنامج</th><th>العام</th><th>المجال</th><th>المشرف</th><th>الانضمام</th><th>الحالة</th></tr></thead><tbody>
        ${P.map((p) => `<tr><td><b>${esc(PROG[p.prog] || p.prog)}</b>${p.note ? `<div class="hint">${esc(p.note)}</div>` : ''}</td><td>${esc(p.year)}</td><td>${esc(p.field || '')}</td><td>${esc(p.lead || '')}</td><td>${esc(p.joined || '')}</td>
          <td><span class="tag ${p.status === 'نشط' ? '' : 'warn'}">${esc(p.status || '')}</span></td></tr>`).join('')}</tbody></table></div>` : ''}
      ${S.length ? `<h4 class="tl-h">🗓️ جلسات البرامج <span class="hint">${done ? `حضر ${att} من ${done} جلسة منفّذة` : 'لم تُنفَّذ جلسات بعد'}${S.length - done ? ` · ${S.length - done} جلسة مجدولة` : ''}</span></h4><details><summary class="hint" style="cursor:pointer">عرض الجلسات (${S.length})</summary><div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>البرنامج</th><th>الجلسة</th><th>المنفّذ</th><th>الحضور</th></tr></thead><tbody>
        ${S.map((s) => `<tr><td>${esc(s.date)}</td><td>${esc(PROG[s.prog] || s.prog)}</td><td>${esc(s.title || '')}</td><td>${esc(s.lead || '')}</td><td>${s.attended === null ? `<span class="hint">${esc(s.status)}</span>` : s.attended ? '✓ حضر' : '<span class="tag bad">غائب</span>'}</td></tr>`).join('')}</tbody></table></div></details>` : ''}
      ${R.length ? `<h4 class="tl-h">📋 السجل التام لتطور الموهبة (${R.length})</h4><div class="table-wrap"><table><thead><tr><th>النموذج</th><th>التاريخ</th><th>العام</th><th>عبّأه</th><th>الخلاصة</th></tr></thead><tbody>
        ${R.map((r) => `<tr><td>${esc(r.form)}</td><td>${esc(r.date)}</td><td>${esc(r.year)}</td><td>${esc(r.teacher)}</td><td>${esc(r.summary || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${byName ? '<p class="hint">بعض السطور طوبقت بالاسم لأنها سُجّلت في منصة الموهبة قبل ربطها بالمنصة — للتأكد اختر الطالب من قائمة المنصة عند التسجيل.</p>' : ''}`;
  }

  // أدوار المنسوبين في برامج الموهبة (لدليل الموظفين)
  async function staffAll() {
    if (!staffCache) staffCache = post({ action: 'lmsStaffAll' }).then((d) => d.staff || []).catch((e) => { staffCache = null; throw e; });
    return staffCache;
  }
  // ربط أسماء منصة الموهبة بحسابات المنسوبين (الاسم الكامل، الأسماء البديلة، الأول+العائلة إن تفرّد) — sql/60
  async function staffMap() {
    const L = await staffAll();
    const { data, error } = await LMS.sb.rpc('staff_resolve', { p_names: [...new Set(L.map((x) => x.name))] });
    if (error) throw error;
    const m = new Map();
    L.forEach((x) => { const id = String((data || {})[x.name] || '').toLowerCase(); if (!id) return;
      const t = m.get(id) || { roles: [], sessions: [], records: 0 };
      t.roles.push(...x.roles); t.sessions.push(...x.sessions); t.records += x.records || 0; m.set(id, t); });
    return m;
  }
  function staffSummary(t) {
    const progs = [...new Set(t.roles.map((r) => r.prog).concat(t.sessions.map((s) => s.prog)))].filter(Boolean);
    return progs.map((p) => PROG[p] || p).join('، ') || (t.records ? 'نماذج السجل التام' : '');
  }
  function staffDetails(t, name) {
    const esc = LMS.esc;
    return `<p class="hint">من منصة الموهبة — <a href="${SITE}sijil-programs.html" target="_blank" rel="noopener">↗ فتح إدارة البرامج</a></p>
      ${t.roles.length ? `<h4 class="tl-h">👥 فريق البرامج</h4><div class="table-wrap no-tools"><table><thead><tr><th>البرنامج</th><th>العام</th><th>الدور</th><th>التخصص / المجال</th></tr></thead><tbody>
        ${t.roles.map((r) => `<tr><td>${esc(PROG[r.prog] || r.prog)}</td><td>${esc(r.year)}</td><td>${esc(r.role || '')}</td><td>${esc([r.spec, r.field].filter(Boolean).join(' — '))}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${t.sessions.length ? `<h4 class="tl-h">🗓️ الجلسات التي قدّمها</h4><div class="table-wrap no-tools"><table><thead><tr><th>البرنامج</th><th>العام</th><th>منفّذة</th><th>مجدولة/أخرى</th></tr></thead><tbody>
        ${t.sessions.map((s) => `<tr><td>${esc(PROG[s.prog] || s.prog)}</td><td>${esc(s.year)}</td><td><b>${s.done}</b></td><td>${s.planned}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${t.records ? `<p>📋 عبّأ <b>${t.records}</b> نموذجًا من نماذج السجل التام لتطور الموهبة.</p>` : ''}`;
  }
  window.TALENT = { renderStudent, staffAll, staffMap, staffSummary, staffDetails, PROG, COMP };
})();
