/* =====================================================================
   مسارات التعلّم المتتابعة + المحتوى التفاعلي (sql/74)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  const role = ctx.profile.role;
  if (role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('paths', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const KIND = { lesson: '📄 درس', video: '🎬 فيديو', embed: '🧩 نشاط تفاعلي (H5P وغيره)', activity: '✍️ نشاط بإجابة', quiz: '🧪 اختبار', link: '🔗 رابط' };
  const linkify = (t) => esc(t || '').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  $('#tabs').style.display = 'none';
  let TICK = null;

  // تحويل روابط الفيديو والأنشطة إلى روابط تضمين
  function embedUrl(u) {
    let m;
    if ((m = u.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/|youtube\.com\/embed\/)([\w-]{6,})/))) return { src: 'https://www.youtube-nocookie.com/embed/' + m[1] + '?rel=0', type: 'iframe' };
    if ((m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/))) return { src: 'https://drive.google.com/file/d/' + m[1] + '/preview', type: 'iframe' };
    if ((m = u.match(/vimeo\.com\/(\d+)/))) return { src: 'https://player.vimeo.com/video/' + m[1], type: 'iframe' };
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) return { src: u, type: 'video' };
    if ((m = u.match(/h5p\.org\/node\/(\d+)/))) return { src: 'https://h5p.org/h5p/embed/' + m[1], type: 'iframe', tall: true };
    return { src: u, type: 'iframe', tall: true };
  }

  if (role === 'student') return studentList();

  /* ======================= المعلم ======================= */
  let OPT = { classes: [], subjects: [] };
  try { OPT = await call('hw_options'); } catch (e) { /* */ }
  async function teacherList() {
    clearInterval(TICK);
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = []; try { L = await call('pth_list'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = `${OPT.is_teacher ? '<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="new">＋ مسار جديد</button><span class="grow"></span><span class="hint">مثال: درس ← فيديو ← نشاط H5P ← سؤال تأملي ← اختبار قصير</span></div>' : ''}
      ${L.map((p) => `<div class="glass xc"><div class="toolbar" style="margin:0"><b class="grow">🧭 ${esc(p.title)}</b>${p.published ? '<span class="pill ok">منشور</span>' : '<span class="pill gold">مسودة</span>'}${p.sequential ? '<span class="pill">متتابع</span>' : ''}</div>
        <div class="hint">${esc(p.subject || '')} · ${(p.classes || []).map(esc).join('، ')} · ${p.steps} خطوة · ${p.students} طالب${p.mine ? '' : ' · ' + esc(p.teacher)}</div>
        <div class="acts"><button class="btn sm primary" data-rep="${p.id}">📊 الإنجاز</button>${p.mine ? `<button class="btn sm" data-ed="${p.id}">✏️ تعديل</button><button class="btn sm danger ghost" data-del="${p.id}">🗑</button>` : ''}</div></div>`).join('')
        || '<div class="empty">لا توجد مسارات بعد.</div>'}`;
    if ($('#new')) $('#new').onclick = () => editor(null);
    view.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return;
      try {
        if (b.dataset.rep) return report(+b.dataset.rep);
        if (b.dataset.ed) return editor(await call('pth_get', { p_id: +b.dataset.ed }));
        if (b.dataset.del) { if (!await confirmBox('حذف المسار وكل تقدّم الطلاب فيه؟', 'حذف')) return; await call('pth_delete', { p_id: +b.dataset.del }); teacherList(); }
      } catch (er) { toast(errMsg(er), 'err'); } };
  }

  async function editor(P) {
    let EX = [];
    try { EX = (await call('ex_list', { p_box: 'mine' })) || []; } catch (e) { /* */ }
    const D = P ? JSON.parse(JSON.stringify(P)) : { title: '', description: '', subject_id: (OPT.subjects[0] || {}).id, class_ids: [], sequential: true, published: false, steps: [{ kind: 'lesson', title: '' }] };
    const myClasses = OPT.classes || [];
    const body = `<label class="f">عنوان المسار *<input id="tt" value="${esc(D.title)}" placeholder="مثال: الوحدة الثالثة — الطفو والغوص"></label>
      <label class="f">وصف (اختياري)<textarea id="ds" rows="2">${esc(D.description || '')}</textarea></label>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><label class="f">المادة<select id="sj">${(OPT.subjects || []).map((s) => `<option value="${s.id}" ${s.id === D.subject_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="sq" ${D.sequential ? 'checked' : ''}> متتابع (لا تُفتح الخطوة قبل إنجاز السابقة)</label><label class="chk"><input type="checkbox" id="pb" ${D.published ? 'checked' : ''}> منشور للطلاب</label></div>
      <b>الفصول *</b><div style="display:flex;flex-wrap:wrap;gap:4px 14px">${myClasses.map((c) => `<label class="chk" style="margin:0"><input type="checkbox" data-c value="${c.id}" ${D.class_ids.includes(c.id) ? 'checked' : ''}> ${esc(c.label || c.name)}</label>`).join('') || '<span class="hint">لا توجد فصول مسندة إليك</span>'}</div>
      <b style="display:block;margin-top:8px">الخطوات</b><div id="sts"></div><button class="btn sm" type="button" id="adds">＋ خطوة</button>
      <p class="hint">🎬 الفيديو: يوتيوب أو Google Drive أو Vimeo أو ملف mp4 — ويمكنك اشتراط مدة مشاهدة. 🧩 النشاط التفاعلي: رابط تضمين H5P أو Wordwall أو GeoGebra أو PhET أو أي نشاط يبدأ بـ https.</p>`;
    modal({ title: P ? 'تعديل المسار' : 'مسار تعلّم جديد', wide: true, body, actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => {
      read(w);
      await call('pth_save', { p: { id: D.id || null, title: $('#tt', w).value, description: $('#ds', w).value, subject_id: $('#sj', w).value, sequential: $('#sq', w).checked, published: $('#pb', w).checked,
        class_ids: $$('[data-c]:checked', w).map((x) => +x.value), steps: D.steps } });
      toast('حُفظ المسار ✓'); teacherList(); return true; } }] });
    const w = [...document.querySelectorAll('.modal-wrap')].pop();
    function read() { D.steps = $$('.sted', w).map((x) => ({ id: x.dataset.id || null, kind: $('[data-k]', x).value, title: $('[data-t]', x).value.trim(), body: ($('[data-b]', x) || {}).value || '',
      url: ($('[data-u]', x) || {}).value || '', exam_id: ($('[data-e]', x) || {}).value || null, min_pct: ($('[data-mp]', x) || {}).value || null, min_watch: ($('[data-mw]', x) || {}).value || null })); }
    const draw = () => { $('#sts', w).innerHTML = D.steps.map((s, i) => `<div class="sted" data-id="${s.id || ''}"><select data-k>${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input data-t value="${esc(s.title || '')}" placeholder="عنوان الخطوة ${i + 1}"><span style="white-space:nowrap"><button class="btn sm ghost" type="button" data-up="${i}">▲</button><button class="btn sm ghost" type="button" data-dn="${i}">▼</button><button class="btn sm ghost" type="button" data-rm="${i}">✕</button></span>
        ${['video', 'embed', 'link'].includes(s.kind) ? `<div class="x"><input data-u dir="ltr" class="grow" value="${esc(s.url || '')}" placeholder="https://…" style="flex:1">${s.kind === 'video' ? `<label class="hint">مدة المشاهدة المطلوبة (دقائق)<input data-mw type="number" min="0" max="600" value="${s.min_watch || ''}" style="width:80px"></label>` : ''}</div>` : ''}
        ${s.kind === 'quiz' ? `<div class="x"><select data-e style="flex:1"><option value="">— اختر اختبارًا من اختباراتك —</option>${EX.map((x) => `<option value="${x.id}" ${String(x.id) === String(s.exam_id) ? 'selected' : ''}>${esc(x.title)}</option>`).join('')}</select>
          <label class="hint">أقل نسبة للنجاح %<input data-mp type="number" min="0" max="100" value="${s.min_pct || ''}" style="width:70px"></label></div>` : ''}
        ${s.kind !== 'quiz' ? `<textarea data-b placeholder="${s.kind === 'activity' ? 'سؤال النشاط / المطلوب من الطالب' : 'نص أو تعليمات (اختياري)'}">${esc(s.body || '')}</textarea>` : ''}</div>`).join(''); };
    w.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'adds') { read(); D.steps.push({ kind: 'lesson', title: '' }); draw(); }
      if (b.dataset.rm) { read(); if (D.steps.length > 1) D.steps.splice(+b.dataset.rm, 1); draw(); }
      if (b.dataset.up) { read(); const i = +b.dataset.up; if (i > 0) [D.steps[i - 1], D.steps[i]] = [D.steps[i], D.steps[i - 1]]; draw(); }
      if (b.dataset.dn) { read(); const i = +b.dataset.dn; if (i < D.steps.length - 1) [D.steps[i + 1], D.steps[i]] = [D.steps[i], D.steps[i + 1]]; draw(); } });
    w.addEventListener('change', (e) => { if (e.target.dataset.k !== undefined) { read(); draw(); } });
    draw();
  }

  async function report(id) {
    let R; try { R = await call('pth_report', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const n = R.steps.length;
    const mins = (s) => s ? Math.round(s / 60) + 'د' : '';
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn sm ghost" id="back">→ المسارات</button><b class="grow">📊 ${esc(R.title)}</b></div>
      <div class="glass" style="padding:6px;overflow:auto"><table class="t mx"><thead><tr><th>الطالب</th><th>الإنجاز</th>${R.steps.map((s, i) => `<th title="${esc(s.title)}">${i + 1}. ${KIND[s.kind].split(' ')[0]}</th>`).join('')}</tr></thead><tbody>
      ${R.students.map((st) => { const d = R.steps.filter((s) => st.done[s.id]?.d).length; return `<tr><td><b>${esc(st.name)}</b><div class="hint">${esc(st.class || '')}</div></td>
        <td style="min-width:90px"><div class="pbar"><i style="width:${n ? d / n * 100 : 0}%"></i></div><small>${d}/${n}</small></td>
        ${R.steps.map((s) => { const x = st.done[s.id] || {}; return `<td class="c">${x.d ? '✅' : '⬜'}<div class="hint">${mins(x.sec)}</div>${x.a ? `<button class="btn sm ghost" data-a="${s.id}|${st.id}">✍️</button>` : ''}</td>`; }).join('')}</tr>`; }).join('') || `<tr><td colspan="${n + 2}" class="hint">لا يوجد طلاب.</td></tr>`}</tbody></table></div>`;
    $('#back').onclick = teacherList;
    view.onclick = (e) => { const b = e.target.closest('[data-a]'); if (!b) return; const [sid, uid] = b.dataset.a.split('|'); const st = R.students.find((x) => x.id === uid); const x = st.done[sid];
      modal({ title: '✍️ إجابة ' + st.name, body: `<div class="body-txt" style="background:#F5F8F6;border-radius:8px;padding:8px">${esc(x.a)}</div>
        <label class="f">تعليقك للطالب<textarea id="fb" rows="3">${esc(x.f || '')}</textarea></label><label class="chk"><input type="checkbox" id="ro"> إعادة النشاط للطالب ليعدّل إجابته</label>`,
        actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => { await call('pth_feedback', { p_step: +sid, p_student: uid, p_feedback: $('#fb', w).value, p_reopen: $('#ro', w).checked }); toast('حُفظ ✓'); report(id); return true; } }] }); };
  }

  /* ======================= الطالب ======================= */
  async function studentList() {
    clearInterval(TICK);
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L = []; try { L = await call('pth_my'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    view.innerHTML = L.map((p) => `<div class="glass xc" style="cursor:pointer" data-p="${p.id}"><div class="toolbar" style="margin:0"><b class="grow">🧭 ${esc(p.title)}</b>${p.done >= p.steps && p.steps ? '<span class="pill ok">✓ أكملته</span>' : ''}</div>
        <div class="hint">${esc(p.subject || '')} · ${esc(p.teacher || '')}</div><div class="pbar" style="margin-top:6px"><i style="width:${p.steps ? p.done / p.steps * 100 : 0}%"></i></div><small class="hint">${p.done} من ${p.steps} خطوات</small></div>`).join('')
      || '<div class="empty">لا توجد مسارات تعلّم لفصلك بعد.</div>';
    view.onclick = (e) => { const c = e.target.closest('[data-p]'); if (c) openPath(+c.dataset.p); };
  }

  async function openPath(id, focus) {
    clearInterval(TICK);
    let P; try { P = await call('pth_open', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const cur = focus != null ? P.steps.find((s) => s.id === focus) : (P.steps.find((s) => !s.done && !s.locked) || P.steps[0]);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn sm ghost" id="back">→ مساراتي</button><b class="grow">🧭 ${esc(P.title)}</b>
        <span class="hint">${P.steps.filter((s) => s.done).length} / ${P.steps.length}</span></div>${P.description ? `<p class="hint">${esc(P.description)}</p>` : ''}
      ${P.steps.map((s, i) => `<div class="glass step ${s.done ? 'done' : s.locked ? 'locked' : s === cur ? 'cur' : ''}" data-s="${s.id}"><h3>${s.done ? '✅' : s.locked ? '🔒' : '▶️'} ${i + 1}. ${esc(s.title)} <small class="hint">${KIND[s.kind]}</small></h3>
        ${s === cur && !s.locked ? stepBody(s) : ''}</div>`).join('')}`;
    $('#back').onclick = studentList;
    view.onclick = async (e) => {
      const h = e.target.closest('h3'); if (h) { const s = P.steps.find((x) => x.id === +h.closest('[data-s]').dataset.s); if (s.locked) return toast('أكمل الخطوات السابقة أولًا', 'warn'); return openPath(id, s.id); }
      const b = e.target.closest('[data-done]'); if (!b) return;
      const ta = $('[data-ans]'); b.disabled = true;
      try { await call('pth_progress_set', { p_step: cur.id, p_add_seconds: 0, p_done: true, p_answer: ta ? ta.value : null }); toast('أُنجزت الخطوة ✓');
        const nx = P.steps[P.steps.indexOf(cur) + 1]; openPath(id, nx ? nx.id : undefined); } catch (er) { b.disabled = false; toast(errMsg(er), 'err'); }
    };
    if (cur && !cur.locked && !cur.done && ['video', 'embed', 'lesson', 'link', 'activity'].includes(cur.kind)) {
      // تسجيل مدة التفاعل كل 20 ثانية (فقط والصفحة ظاهرة)؛ وللفيديو المباشر: وقت التشغيل الفعلي
      let acc = 0; const vid = $('video[data-v]');
      if (vid) vid.addEventListener('timeupdate', () => { vid._t = vid._t || vid.currentTime; });
      TICK = setInterval(async () => { if (document.hidden) return; if (vid && vid.paused) return; acc += 20;
        try { const r = await call('pth_progress_set', { p_step: cur.id, p_add_seconds: 20, p_done: false }); const el = $('#watched'); if (el) el.textContent = Math.floor(r.seconds / 60) + ' دقيقة'; } catch (_) {} }, 20000);
    }
  }
  function stepBody(s) {
    const done = s.done ? '<div class="hint" style="margin-top:6px">✅ أنجزت هذه الخطوة</div>' : '';
    const doneBtn = (lbl) => s.done ? '' : `<button class="btn primary sm" data-done style="margin-top:8px">${lbl || '✓ أنهيت هذه الخطوة'}</button>`;
    const watch = s.min_watch ? `<div class="hint">⏱️ المطلوب: ${s.min_watch} دقيقة مشاهدة · شاهدت: <b id="watched">${Math.floor(s.seconds / 60)} دقيقة</b></div>` : '';
    if (s.kind === 'lesson') return `<div class="body-txt">${linkify(s.body)}</div>${doneBtn()}${done}`;
    if (s.kind === 'video' || s.kind === 'embed') { const E = embedUrl(s.url || '');
      return `${s.body ? `<div class="body-txt">${linkify(s.body)}</div>` : ''}<div class="frame ${E.tall ? 'tall' : ''}">${E.type === 'video' ? `<video data-v src="${esc(E.src)}" controls playsinline></video>`
        : `<iframe src="${esc(E.src)}" allow="fullscreen; autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy" referrerpolicy="strict-origin-when-cross-origin"></iframe>`}</div>
        <div class="hint">إن لم يظهر المحتوى: <a href="${esc(s.url)}" target="_blank" rel="noopener">افتحه في نافذة جديدة</a></div>${watch}${doneBtn(s.kind === 'video' ? '✓ أنهيت المشاهدة' : '✓ أنهيت النشاط')}${done}`; }
    if (s.kind === 'link') return `${s.body ? `<div class="body-txt">${linkify(s.body)}</div>` : ''}<a class="btn sm" href="${esc(s.url)}" target="_blank" rel="noopener">🔗 فتح الرابط</a> ${doneBtn()}${done}`;
    if (s.kind === 'activity') return `<div class="body-txt">${linkify(s.body)}</div>${s.feedback ? `<div class="notice">💬 تعليق المعلم: ${esc(s.feedback)}</div>` : ''}
      <textarea data-ans rows="5" style="width:100%;margin-top:6px" ${s.done ? 'disabled' : ''} placeholder="اكتب إجابتك…">${esc(s.answer || '')}</textarea>${doneBtn('📤 إرسال الإجابة')}${done}`;
    if (s.kind === 'quiz') return `<div class="hint">${s.min_pct ? `تُنجز الخطوة عند الحصول على ${s.min_pct}% فأكثر.` : 'تُنجز الخطوة بتسليم الاختبار.'}</div>
      ${s.done ? done : `<a class="btn primary sm" href="exams.html#student" style="margin-top:6px">🧪 الذهاب للاختبار</a> <button class="btn sm ghost" onclick="location.reload()">🔄 تحديث بعد التسليم</button>`}`;
    return '';
  }

  teacherList();
})();
