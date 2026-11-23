/* =====================================================================
   مكتبة معلمي دار الذكر: ما شاركه المعلمون من واجبات واختبارات ومحتوى
   الدوال: lib_list / lib_get / lib_use / lib_unshare (sql/41) + hw_options / hw_save / cp_courses / cp_save
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role)) { view.innerHTML = '<div class="notice">المكتبة للمعلمين والإدارة.</div>'; return; }

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const KN = { hw: '📝 واجب', exam: '🧪 اختبار', post: '🗂️ محتوى مادة' };
  const QT = { mcq: 'اختيار من متعدد', tf: 'صح وخطأ', short: 'إجابة قصيرة', match: 'مزاوجة' };
  const PER = { p1: 'الفترة الأولى', p2: 'الفترة الثانية', mid: 'منتصف الفصل', final: 'نهاية العام' };
  const when = (t) => new Date(t).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#');
  const linksHTML = (L) => (L || []).length ? `<div>${L.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.title || l.url)}</a>`).join(' ')}</div>` : '';
  const imgHTML = (src) => (src && /^data:image\//.test(src) ? `<img class="qimg" src="${esc(src)}" alt="">` : '');

  let OPT = null;
  const opts = async () => OPT || (OPT = await call('hw_options'));
  let KIND = '', ALL = [];

  async function load() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { ALL = await call('lib_list', { p_kind: null, p_subject: null, p_q: null }); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    const subs = [...new Map(ALL.filter((x) => x.subject_id).map((x) => [x.subject_id, x.subject])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'ar'));
    $('#fS').innerHTML = '<option value="">كل المواد</option>' + subs.map(([id, n]) => `<option value="${id}">${esc(n)}</option>`).join('');
    paint();
  }
  function paint() {
    const sid = +$('#fS').value || null, q = $('#fQ').value.trim();
    const L = ALL.filter((x) => (KIND === 'mine' ? x.mine : !KIND || x.kind === KIND) && (!sid || x.subject_id === sid) && (!q || LMS.has([x.title, x.grade, x.owner, x.subject, x.note].join(' '), q)));
    view.innerHTML = L.length ? `<div class="lib">${L.map((x) => `<button class="li" data-id="${x.id}"><span><span class="k ${x.kind}">${KN[x.kind]}</span> ${x.subject ? `<small>${esc(x.subject)}</small>` : ''}</span>
        <b>${esc(x.title)}</b>${x.snip ? `<p>${esc(x.snip)}</p>` : ''}${x.n_questions ? `<small>${x.n_questions} سؤال</small>` : ''}
        <small>${esc(x.grade || '')}</small><small>شاركه: ${esc(x.owner)} · ${esc(when(x.created_at))}${x.uses ? ` · استُخدم ${x.uses} مرة` : ''}</small></button>`).join('')}</div>`
      : `<div class="empty">${KIND === 'mine' ? 'لم تشارك شيئًا بعد — من صفحة الواجب أو الاختبار أو منشور صفحة المادة اضغط «📚 مشاركة».' : 'لا توجد عناصر مشتركة بعد.'}</div>`;
  }
  $('#tabs').onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; KIND = b.dataset.k; $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); paint(); };
  $('#fS').onchange = paint; $('#fQ').oninput = paint;
  view.onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) open(+b.dataset.id); };

  async function open(id) {
    let x; try { x = await call('lib_get', { p_id: id }); } catch (e) { toast(errMsg(e), 'err'); return; }
    const P = x.payload || {}, me = ALL.find((a) => a.id === id) || {};
    let body = `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px"><span class="k ${x.kind}">${KN[x.kind]}</span>${x.subject ? `<span class="chip teal">${esc(x.subject)}</span>` : ''}
      ${x.grade ? `<span class="chip gray">${esc(x.grade)}</span>` : ''}<span class="chip gray">شاركه: ${esc(x.owner)}</span></div>${x.note ? `<div class="notice">${esc(x.note)}</div>` : ''}`;
    if (x.kind === 'hw') body += `${P.instructions ? `<div class="pv">${esc(P.instructions)}</div>` : '<p class="hint">بدون تعليمات مكتوبة.</p>'}${linksHTML(P.links)}<p class="hint">الدرجة العظمى: ${esc(String(P.max_score ?? 10))}</p>`;
    else if (x.kind === 'post') body += `${P.body ? `<div class="pv">${esc(P.body)}</div>` : ''}${linksHTML(P.links)}`;
    else body += `${P.instructions ? `<p class="hint">${esc(P.instructions)}</p>` : ''}<p class="hint">${(P.questions || []).length} سؤال · ${esc(String(P.duration_min || ''))} دقيقة</p>
      ${(P.questions || []).map((q, i) => `<div class="qb"><b>${i + 1}. ${esc(q.body)}</b> <small class="hint">(${esc(QT[q.qtype] || q.qtype)} · ${esc(String(q.points))} د)</small>${imgHTML(q.image)}
        ${q.qtype === 'short' ? `<div class="hint">النموذجية: ${esc(q.answer || '—')}</div>` : q.qtype === 'match' ? `<div>${(q.options || []).map((o) => `${esc(o.l)} ⟵⟶ <b>${esc(o.r)}</b>`).join('<br>')}</div>`
          : `<ol>${(q.options || []).map((o) => `<li class="${o.ok ? 'ok' : ''}">${esc(o.t)}</li>`).join('')}</ol>`}</div>`).join('')}`;
    const A = [{ label: 'إغلاق', cls: 'ghost' }];
    if (me.mine || ctx.profile.role === 'admin') A.unshift({ label: '🗑️ إلغاء المشاركة', cls: 'ghost', onClick: async () => { if (!await confirmBox('إزالة هذا العنصر من المكتبة؟ (لن يُحذف من حسابك)', 'إزالة')) return false; await call('lib_unshare', { p_id: id }); toast('أُزيل من المكتبة'); load(); } });
    A.push({ label: x.kind === 'exam' ? '📥 نسخ الأسئلة إلى بنكي' : '📤 استخدمه في فصولي', cls: 'primary', onClick: () => { setTimeout(() => use(x), 0); } });
    modal({ title: x.title, wide: true, body, actions: A });
  }

  async function use(x) {
    const O = await opts().catch(() => null);
    if (!O || !O.is_teacher) { toast('الاستخدام متاح للمعلمين المسند إليهم مواد', 'warn'); return; }
    const P = x.payload || {};
    const subOpts = O.subjects.map((s) => `<option value="${s.id}"${s.id === x.subject_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    const clsBox = (sid) => O.classes.filter((c) => !sid || (c.subjects || []).includes(sid)).map((c) => `<label style="display:inline-flex;align-items:center;gap:4px;background:#f4f7f8;padding:4px 10px;border-radius:99px;margin:2px;font-size:.86rem"><input type="checkbox" value="${c.id}"> ${esc(c.label)}</label>`).join('') || '<span class="hint">لا توجد فصول لهذه المادة</span>';
    if (x.kind === 'exam') {
      modal({ title: 'نسخ الأسئلة إلى بنك أسئلتي', body: `<p class="hint">تُنسخ ${(P.questions || []).length} سؤالًا إلى بنك أسئلتك (تقدر تعدّلها بعد النسخ)، ثم تنشئ منها اختبارًا لفصولك.</p>
          <label class="f">المادة<select id="uS">${subOpts}</select></label>`,
        actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: '📥 نسخ', cls: 'primary', onClick: async (w) => {
          const r = await call('lib_use', { p_id: x.id, p_subject: +$('#uS', w).value }); toast(`نُسخ ${r.imported} سؤال إلى بنكك ✓`);
          if (await confirmBox('فتح بنك الأسئلة الآن؟', 'فتح')) location.href = 'exams.html#bank'; } }] });
      return;
    }
    const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(23, 59, 0, 0);
    const dl = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T23:59`;
    const body = `<div class="form-grid"><label class="f">المادة<select id="uS">${subOpts}</select></label>
      ${x.kind === 'hw' ? `<label class="f">موعد التسليم<input type="datetime-local" id="uD" value="${dl}"></label>
        <label class="f">فترة التقويم<select id="uP"><option value="">— غير محدد —</option>${Object.entries(PER).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>` : ''}
      <label class="f" style="grid-column:1/-1">عنوان<input id="uT" maxlength="200" value="${esc(P.title || x.title)}"></label>
      <div class="f" style="grid-column:1/-1"><span>الفصول *</span><div id="uC"></div></div></div>`;
    modal({ title: x.kind === 'hw' ? 'نشر الواجب لفصولي' : 'نشر المحتوى في صفحة مادتي', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: '📤 نشر', cls: 'primary', onClick: async (w) => {
      const sid = +$('#uS', w).value, cls = $$('#uC input:checked', w).map((i) => +i.value), ttl = $('#uT', w).value.trim();
      if (!cls.length) { toast('اختر فصلًا واحدًا على الأقل', 'warn'); return false; } if (!ttl) { toast('اكتب العنوان', 'warn'); return false; }
      if (x.kind === 'hw') await call('hw_save', { p: { title: ttl, subject_id: sid, class_ids: cls, instructions: P.instructions || '', links: P.links || [], max_score: P.max_score || 10, allow_late: true,
        due_at: new Date($('#uD', w).value).toISOString(), period: $('#uP', w).value || null } });
      else await call('cp_save', { p: { title: ttl, subject_id: sid, class_ids: cls, kind: P.kind || 'content', body: P.body || '', links: P.links || [], pinned: false } });
      await call('lib_use', { p_id: x.id, p_subject: null }).catch(() => {});
      toast(x.kind === 'hw' ? 'نُشر الواجب لطلاب الفصول المختارة ✓' : 'نُشر المحتوى في صفحة المادة ✓'); } }] });
    const w = $$('.modal-wrap').pop(); const paint = () => { $('#uC', w).innerHTML = clsBox(+$('#uS', w).value); }; paint(); $('#uS', w).onchange = paint;
  }

  load();
})();
