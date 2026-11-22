/* =====================================================================
   صفحات المواد: صفحة لكل (مادة × فصل) — محتوى أسبوعي وإعلانات
   الدوال: cp_courses / cp_list / cp_save / cp_delete (sql/36) + hw_list (واجبات المادة للطالب)
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox, ymd } = LMS;
  const ctx = await requireAuth();
  const STUDENT = ctx.profile.role === 'student';

  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '').trim()) ? String(u).trim() : '#');
  const linksHTML = (L) => (L || []).length ? `<div class="links">${L.map((l) => `<a href="${esc(safeUrl(l.url))}" target="_blank" rel="noopener noreferrer">🔗 ${esc(l.title || l.url)}</a>`).join('')}</div>` : '';
  const short = (c) => String(c || '').split(' — ')[0];
  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const parseD = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
  const sunday = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); return x; };
  const weekLbl = (s) => { const d = parseD(s), e = new Date(d); e.setDate(e.getDate() + 4); return `أسبوع ${d.getDate()}/${d.getMonth() + 1} — ${e.getDate()}/${e.getMonth() + 1}`; };
  const when = (t) => new Date(t).toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });

  let COURSES = [];
  async function load() {
    try { COURSES = await call('cp_courses'); } catch (e) { $('#view').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    route();
  }
  window.addEventListener('hashchange', route);
  function route() {
    const m = /c=(\d+)-(\d+)/.exec(location.hash);
    if (m) openCourse(+m[1], +m[2]); else drawList();
  }

  // ---------------- قائمة المقررات ----------------
  function drawList() {
    if (!COURSES.length) {
      $('#view').innerHTML = `<div class="empty">${STUDENT ? 'لا توجد مواد مسندة لفصلك بعد (أو لم تُربط بفصلك في المنصة).' : 'لا توجد مقررات مسندة إليك أو لمعلميك.'}</div>`; return;
    }
    const mine = COURSES.filter((c) => c.mine), other = COURSES.filter((c) => !c.mine);
    const card = (c) => `<button data-c="${c.class_id}-${c.subject_id}"><b>${esc(c.subject)}</b><small>${esc(short(c.class))} · ${esc((c.class.split(' — ')[1]) || '')}</small>
      <small>${esc((c.teachers || []).join('، '))}</small><span class="cnt">${c.posts ? `${c.posts} منشور · آخرها ${esc(when(c.last_at))}` : 'لا منشورات بعد'}</span></button>`;
    $('#view').innerHTML = `<div class="toolbar glass" style="padding:10px"><input id="cq" class="grow" type="search" placeholder="ابحث بالمادة أو الفصل أو المعلم…"></div>
      ${mine.length ? `<h3 class="sec-h">${STUDENT ? '' : 'مقرراتي'}</h3><div class="crs">${mine.map(card).join('')}</div>` : ''}
      ${other.length ? `<h3 class="sec-h">${STUDENT ? 'موادي' : 'مقررات معلميّ (متابعة)'}</h3><div class="crs">${other.map(card).join('')}</div>` : ''}`;
    $('#cq').oninput = (e) => { const q = e.target.value.trim(); $$('.crs button').forEach((b) => { b.hidden = !!q && !b.innerText.includes(q); }); };
    $('#view').onclick = (e) => { const b = e.target.closest('[data-c]'); if (b) location.hash = 'c=' + b.dataset.c; };
  }

  // ---------------- صفحة مقرر ----------------
  async function openCourse(cid, sid) {
    const c = COURSES.find((x) => x.class_id === cid && x.subject_id === sid) || { subject: '', class: '', teachers: [] };
    $('#view').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let D; try { D = await call('cp_list', { p_class: cid, p_subject: sid }); } catch (e) { $('#view').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    let HW = [];
    if (STUDENT) { try { HW = (await call('hw_list', { p_box: 'student' })).filter((h) => h.subject_id === sid && !h.my_status && !h.closed); } catch (_) {} }
    const P = D.posts || [];
    const pinned = P.filter((p) => p.pinned), rest = P.filter((p) => !p.pinned);
    const groups = []; rest.forEach((p) => { const k = p.week || ymd(sunday(new Date(p.at))); let g = groups.find((x) => x.k === k); if (!g) groups.push(g = { k, items: [] }); g.items.push(p); });
    const post = (p) => `<article class="post glass${p.kind === 'announcement' ? ' ann' : ''}${p.pinned ? ' pin' : ''}">
        <h4>${p.pinned ? '📌' : ''}${p.kind === 'announcement' ? '📢' : '📖'} ${esc(p.title)}</h4>
        <div class="meta">${esc(p.teacher)} · ${esc(when(p.at))}${p.updated && p.updated !== p.at ? ' · عُدّل' : ''}</div>
        ${p.body ? `<p>${esc(p.body)}</p>` : ''}${linksHTML(p.links)}
        ${p.mine ? `<div class="acts"><button class="btn sm ghost" data-ed="${p.id}">✏️ تعديل</button><button class="btn sm ghost" data-del="${p.id}">🗑️ حذف</button></div>` : ''}</article>`;
    $('#view').innerHTML = `<div class="chead glass"><button class="btn sm ghost" id="back">→ كل المواد</button>
        <div class="grow"><h2>${esc(c.subject)} — ${esc(short(c.class))}</h2><div class="hint">${esc(c.class.split(' — ')[1] || '')} · ${esc((c.teachers || []).join('، '))}</div></div>
        ${D.can_post ? '<button class="btn primary" id="newPost">➕ منشور جديد</button>' : ''}</div>
      ${HW.length ? `<div class="hwbox notice"><b>📝 واجبات مطلوبة في هذه المادة:</b>${HW.map((h) => `<a href="homework.html#student">• ${esc(h.title)} — التسليم ${esc(when(h.due_at))}</a>`).join('')}</div>` : ''}
      ${pinned.map(post).join('')}
      ${groups.map((g) => `<div class="wk-h">${esc(weekLbl(g.k))}</div>${g.items.map(post).join('')}`).join('')}
      ${!P.length ? `<div class="empty">${D.can_post ? 'لا منشورات بعد — ابدأ بنشر محتوى الأسبوع.' : 'لم ينشر المعلم محتوى بعد.'}</div>` : ''}`;
    $('#back').onclick = () => { location.hash = ''; };
    if ($('#newPost')) $('#newPost').onclick = () => edit(null, cid, sid);
    $('#view').onclick = async (e) => {
      const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]');
      if (ed) edit(P.find((p) => p.id === +ed.dataset.ed), cid, sid);
      if (del) { if (!await confirmBox('حذف هذا المنشور من كل الفصول المنشور لها؟', 'حذف')) return;
        try { await call('cp_delete', { p_id: +del.dataset.del }); toast('تم الحذف'); await refresh(cid, sid); } catch (er) { toast(errMsg(er), 'err'); } }
    };
  }
  async function refresh(cid, sid) { try { COURSES = await call('cp_courses'); } catch (_) {} openCourse(cid, sid); }

  // ---------------- إنشاء / تعديل منشور ----------------
  function edit(p, cid, sid) {
    // الفصول التي يدرّس لها المعلم هذه المادة (للنشر لأكثر من فصل دفعة واحدة)
    const mineCls = COURSES.filter((c) => c.mine && c.subject_id === sid);
    p = p || { kind: 'content', title: '', body: '', links: [], week: ymd(sunday(new Date())), pinned: false, class_ids: [cid] };
    const sel = new Set(p.class_ids || [cid]);
    const body = `<div class="form-grid">
      <label class="f">النوع<select id="pK"><option value="content"${p.kind === 'content' ? ' selected' : ''}>📖 محتوى / شرح</option><option value="announcement"${p.kind === 'announcement' ? ' selected' : ''}>📢 إعلان</option></select></label>
      <label class="f">الأسبوع (يبدأ الأحد)<input type="date" id="pW" value="${esc(p.week || '')}"></label>
      <label class="f" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="pP"${p.pinned ? ' checked' : ''}> تثبيت أعلى الصفحة</label>
      <label class="f" style="grid-column:1/-1">العنوان *<input id="pT" maxlength="200" value="${esc(p.title)}" placeholder="مثال: الوحدة الثالثة — الكسور العشرية"></label>
      <label class="f" style="grid-column:1/-1">المحتوى<textarea id="pB" rows="7">${esc(p.body || '')}</textarea></label>
      <label class="f" style="grid-column:1/-1">روابط (رابط في كل سطر — عرض، فيديو، ملف درايف…)<textarea id="pL" rows="3" dir="ltr" placeholder="https://…">${esc((p.links || []).map((l) => l.url).join('\n'))}</textarea></label>
      ${mineCls.length > 1 ? `<div class="f" style="grid-column:1/-1"><span>انشر أيضًا في فصولك الأخرى لنفس المادة</span><div style="display:flex;flex-wrap:wrap;gap:6px">
        ${mineCls.map((c) => `<label style="display:flex;align-items:center;gap:4px;background:#f4f7f8;padding:4px 10px;border-radius:99px;font-size:.86rem"><input type="checkbox" class="pc" value="${c.class_id}"${sel.has(c.class_id) ? ' checked' : ''}> ${esc(short(c.class))}</label>`).join('')}</div></div>` : ''}
    </div>`;
    modal({ title: p.id ? 'تعديل المنشور' : 'منشور جديد', wide: true, body, actions: [{ label: 'إلغاء', cls: 'ghost' }, { label: p.id ? '💾 حفظ' : '📤 نشر', cls: 'primary', onClick: async (w) => {
      const links = $('#pL', w).value.split(/\n+/).map((u) => u.trim()).filter(Boolean).map((u) => ({ url: u }));
      if (links.some((l) => !/^https?:\/\//i.test(l.url))) { toast('الروابط يجب أن تبدأ بـ https://', 'warn'); return false; }
      const cls = $$('.pc', w).length ? $$('.pc:checked', w).map((i) => +i.value) : [cid];
      const q = { id: p.id || null, subject_id: sid, class_ids: cls, kind: $('#pK', w).value, title: $('#pT', w).value.trim(), body: $('#pB', w).value.trim(),
        links, week: $('#pW', w).value || null, pinned: $('#pP', w).checked };
      if (!q.title) { toast('اكتب العنوان', 'warn'); return false; } if (!q.class_ids.length) { toast('اختر فصلًا واحدًا على الأقل', 'warn'); return false; }
      await call('cp_save', { p: q }); toast(p.id ? 'حُفظ المنشور' : 'نُشر'); await refresh(cid, sid); } }] });
  }

  load();
})();
