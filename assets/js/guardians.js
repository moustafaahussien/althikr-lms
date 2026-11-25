/* أولياء الأمور ورموز التفعيل — مدير النظام والقيادات ومديرو المراحل */
(async function () {
  const { sb, esc, $, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  await requireAuth(['admin', 'leadership', 'principal']);
  const SITE = new URL('parent.html', location.href).href;
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const local = (p) => '0' + String(p).slice(3);   // 9665XXXXXXXX ← 05XXXXXXXX

  // الصفوف
  try {
    const { data } = await sb.from('grades').select('id,number,name_ar,stages(name_ar,sort)').order('id');
    (data || []).sort((a, b) => (a.stages?.sort || 0) - (b.stages?.sort || 0) || a.number - b.number)
      .forEach((g) => $('#grade').insertAdjacentHTML('beforeend', `<option value="${g.id}">${esc(g.name_ar)} — ${esc(g.stages?.name_ar || '')}</option>`));
  } catch (_) {}

  let ROWS = [];
  async function load() {
    const q = $('#q').value.trim(), g = $('#grade').value;
    if (!q && !g) { $('#list').innerHTML = '<div class="empty">اختر صفًا أو ابحث باسم الطالب…</div>'; $('#count').textContent = ''; return; }
    $('#list').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { ROWS = await call('gd_list', { p_q: q, p_grade: g ? +g : null }); } catch (e) { $('#list').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    draw();
  }
  function status(g) {
    return g.locked ? '<span class="chip pink">مقفل</span>' : g.has_pin ? '<span class="chip teal">مفعّل ✓</span>'
      : g.code_pending ? '<span class="chip gray">أُرسل رمز — لم يُفعَّل بعد</span>' : '<span class="chip gray">لم يُفعَّل</span>';
  }
  function draw() {
    const f = $('#flt').value;
    const rows = ROWS.filter((r) => !f || (f === 'none' ? !r.guardians.length : f === 'nopin' ? r.guardians.some((g) => !g.has_pin) :
      f === 'pin' ? r.guardians.some((g) => g.has_pin && !g.locked) : r.guardians.some((g) => g.locked)));
    $('#count').textContent = `${rows.length} طالب`;
    $('#list').innerHTML = `<div class="table-wrap" data-title="أولياء الأمور"><table><thead><tr><th>الطالب</th><th>الصف</th><th>ولي الأمر</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr class="gd-row"><td><b>${esc(r.name)}</b></td><td>${esc(r.grade || '')}</td><td>
        ${r.guardians.length ? r.guardians.map((g) => `<div class="gd"><span>${esc(g.name || 'ولي الأمر')}</span> <span class="ph">${esc(local(g.phone))}</span> ${status(g)}
          <button class="btn sm primary" data-send="${esc(g.id)}">📲 إرسال رمز التفعيل</button>
          <button class="btn sm ghost" data-unlink="${esc(g.id)}" data-st="${esc(r.student)}" title="فك ربط هذا الرقم بالطالب">✕</button></div>`).join('')
          : '<span class="hint">لا يوجد جوال مسجّل</span>'}</td>
        <td><button class="btn sm" data-phone="${esc(r.student)}" data-nm="${esc(r.name)}">✏️ جوال</button></td></tr>`).join('')}
      </tbody></table></div>`;
  }

  // إرسال رمز التفعيل على واتساب (نفتح النافذة فورًا حتى لا يمنعها المتصفح)
  async function send(gid) {
    const w = window.open('about:blank', '_blank');
    try {
      const r = await call('gd_issue_code', { p_guardian: gid });
      const kids = (r.children || []).join(' و');
      const msg = `السلام عليكم ${r.name ? r.name : 'ولي أمر الطالب ' + kids}،\n` +
        `رمز تفعيل دخول ولي الأمر في ${LMS.C.PLATFORM_NAME}${kids ? ' (للطالب: ' + kids + ')' : ''}:\n\n*${r.code}*\n\n` +
        `1) افتح: ${SITE}\n2) ادخل بحساب ابنك المدرسي.\n3) اكتب رمز التفعيل ثم اختر رمزك السري (6 أرقام) لتستخدمه بعد ذلك.\n\n` +
        `الرمز صالح 14 يومًا ولمرة واحدة. لا تشارك رمزك السري مع ابنك أو غيره.`;
      const url = `https://wa.me/${r.phone}?text=${encodeURIComponent(msg)}`;
      if (w) w.location.href = url; else location.href = url;
      toast('تم إصدار الرمز — أرسله من واتساب');
      ROWS.forEach((x) => x.guardians.forEach((g) => { if (g.id === gid) g.code_pending = true; })); draw();
    } catch (e) { if (w) w.close(); toast(errMsg(e), 'err'); }
  }

  function phoneDlg(st, nm) {
    modal({ title: 'جوال ولي أمر: ' + nm, body: `
      <label class="f">جوال ولي الأمر<input id="ph" dir="ltr" placeholder="05XXXXXXXX" inputmode="tel"></label>
      <label class="f">اسم ولي الأمر (اختياري)<input id="nm"></label>
      <p class="hint">إذا كان الرقم مسجّلًا لأخ له في المدرسة يُربط بنفس ولي الأمر تلقائيًا.</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
        await call('gd_set_phone', { p_student: st, p_phone: w.querySelector('#ph').value, p_name: w.querySelector('#nm').value || null });
        toast('تم الحفظ ✓'); load(); return true; } }] });
  }

  $('#list').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.send) return send(b.dataset.send);
    if (b.dataset.phone) return phoneDlg(b.dataset.phone, b.dataset.nm);
    if (b.dataset.unlink) {
      if (!(await confirmBox('فك ربط هذا الرقم بالطالب؟ (لن يستطيع صاحب الرقم رؤية بيانات هذا الطالب)', 'فك الربط'))) return;
      try { await call('gd_unlink', { p_guardian: b.dataset.unlink, p_student: b.dataset.st }); toast('تم'); load(); } catch (er) { toast(errMsg(er), 'err'); }
    }
  });
  let t; $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
  $('#grade').onchange = load; $('#flt').onchange = draw;

  // ---------- رفع ملف الجوالات ----------
  $('#imp').onclick = () => $('#impFile').click();
  $('#impFile').onchange = async (ev) => {
    const file = ev.target.files[0]; ev.target.value = ''; if (!file) return;
    if (typeof XLSX === 'undefined') return toast('تعذر تحميل مكتبة Excel', 'err');
    let rows;
    try { const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' }); rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false }); }
    catch (e) { return toast('تعذّرت قراءة الملف', 'err'); }
    if (!rows.length) return toast('الملف فارغ', 'err');
    const cols = Object.keys(rows[0]);
    const find = (re) => cols.find((c) => re.test(c)) || '';
    const kc = find(/هوي|iqama|national|saudi id|رقم الطالب|student (no|number)|agreement|اتفاقي/i);
    const pc = find(/جوال|موبايل|mobile|phone|هاتف|tel/i);
    const nc = find(/اسم ولي|guardian name|parent name|ولي الأمر/i);
    const opt = (sel) => cols.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
    modal({ title: 'رفع جوالات أولياء الأمور', wide: true, body: `
      <p class="hint">${rows.length} صف في الملف. تأكد من الأعمدة:</p>
      <label class="f">عمود رقم الطالب (الهوية / رقم الطالب / رقم الاتفاقية)<select id="kc">${opt(kc)}</select></label>
      <label class="f">عمود جوال ولي الأمر<select id="pc">${opt(pc)}</select></label>
      <label class="f">عمود اسم ولي الأمر (اختياري)<select id="nc"><option value="">— بدون —</option>${opt(nc)}</select></label>
      <div id="pv" class="hint"></div>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' },
        { label: 'فحص', onClick: async (w) => { const r = await run(w, false); w.querySelector('#pv').innerHTML = report(r); return false; } },
        { label: 'اعتماد', cls: 'primary', onClick: async (w) => { const r = await run(w, true); toast(`✓ ${r.matched} طالب — ${r.guardians} ولي أمر`); load(); return true; } }] });
    async function run(w, apply) {
      const k = w.querySelector('#kc').value, p = w.querySelector('#pc').value, n = w.querySelector('#nc').value;
      const data = rows.map((r) => ({ key: String(r[k] || '').trim(), phone: String(r[p] || '').trim(), name: n ? String(r[n] || '').trim() : '' })).filter((r) => r.key);
      return call('gd_import', { p_rows: data, p_apply: apply });
    }
    function report(r) {
      return `✓ سيُربط <b>${r.matched}</b> طالب بجوال وليّ أمره · جوال غير صحيح: ${r.bad_phone} · طالب غير موجود: ${r.no_student}` +
        (r.unknown_keys && r.unknown_keys.length ? `<br>أمثلة غير موجودة: <span dir="ltr">${r.unknown_keys.map(esc).join('، ')}</span>` : '');
    }
  };
})();
