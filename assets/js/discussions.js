/* =====================================================================
   نقاشات الفصول (sql/75)
   ===================================================================== */
(async function () {
  const { sb, esc, $, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (ctx.profile.role === 'parent') { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  if (!LMS.betaAllowed('discussions', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة (وحدة تجريبية).</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  $('#tabs').style.display = 'none';
  const K = { discussion: '💬 نقاش', question: '❓ سؤال', private: '🔒 سؤال خاص للمعلم', announcement: '📢 إعلان' };
  const ago = (t) => { const m = Math.round((Date.now() - new Date(t)) / 60000); return m < 1 ? 'الآن' : m < 60 ? `قبل ${m} د` : m < 1440 ? `قبل ${Math.round(m / 60)} س` : new Date(t).toLocaleDateString('ar-SA-u-ca-gregory', { day: 'numeric', month: 'short' }); };
  const linkify = (t) => esc(t || '').replace(/(https:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  let C = null, CUR = null;

  async function courses() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    try { C = await call('ds_courses'); } catch (e) { view.innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }
    if (C.length === 1) return list(C[0]);
    view.innerHTML = C.map((c, i) => `<div class="glass crs xc" data-i="${i}"><div class="toolbar" style="margin:0"><b class="grow">${esc(c.subject)}</b>
        ${c.role === 'mod' && c.open_q ? `<span class="pill bad">${c.open_q} سؤال بانتظار ردك</span>` : ''}${c.new ? `<span class="pill ok">${c.new} جديد</span>` : ''}</div><div class="hint">${esc(c.class)}${c.role === 'view' ? ' · متابعة' : ''}</div></div>`).join('')
      || '<div class="empty">لا توجد مقررات مرتبطة بك.</div>';
    view.onclick = (e) => { const c = e.target.closest('[data-i]'); if (c) list(C[+c.dataset.i]); };
  }

  async function list(c) {
    CUR = c;
    let L; try { L = await call('ds_list', { p_class: c.class_id, p_subject: c.subject_id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const can = L.role === 'mod' || (L.role === 'student' && L.students_can_post && !L.closed);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap">${C && C.length > 1 ? '<button class="btn sm ghost" id="back">→ المقررات</button>' : ''}<b class="grow">${esc(c.subject)} — ${esc(c.class)}</b>
        ${can ? '<button class="btn sm primary" id="new">＋ موضوع / سؤال</button>' : ''}${L.role === 'mod' ? '<button class="btn sm ghost" id="set">⚙️ الإعدادات</button>' : ''}</div>
      ${L.closed ? '<div class="notice">🔒 النقاش مغلق حاليًا من المعلم.</div>' : !L.students_can_post && L.role === 'student' ? '<div class="notice">يمكنك الرد فقط — أوقف المعلم إضافة مواضيع جديدة.</div>' : ''}
      ${L.threads.map((t) => `<div class="glass th ${t.hidden ? 'hid' : ''}" data-t="${t.id}"><div class="grow"><b>${t.pinned ? '📌 ' : ''}${esc(t.title)}</b>
          <div class="hint">${K[t.kind]} · ${esc(t.author || '')}${t.by_teacher ? ' (المعلم)' : ''} · ${ago(t.last_at)}${t.locked ? ' · 🔒 مقفل' : ''}${t.hidden ? ' · مخفي' : ''}</div></div>
        ${['question', 'private'].includes(t.kind) ? (t.answered ? '<span class="pill ok">✓ أُجيب</span>' : '<span class="pill gold">بانتظار الرد</span>') : ''}<span class="pill">${t.n} رد</span></div>`).join('')
        || '<div class="empty">لا توجد مواضيع بعد — ابدأ أول نقاش أو اطرح سؤالك.</div>'}`;
    if ($('#back')) $('#back').onclick = courses;
    if ($('#new')) $('#new').onclick = () => newThread(L.role);
    if ($('#set')) $('#set').onclick = () => modal({ title: 'إعدادات النقاش', body: `<label class="chk"><input type="checkbox" id="sp" ${L.students_can_post ? 'checked' : ''}> يسمح للطلاب بإضافة مواضيع وأسئلة</label>
        <label class="chk"><input type="checkbox" id="cl" ${L.closed ? 'checked' : ''}> إغلاق النقاش كاملًا (قراءة فقط للطلاب)</label>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'حفظ', cls: 'primary', onClick: async (w) => { await call('ds_settings_set', { p_class: c.class_id, p_subject: c.subject_id, p_students_can_post: $('#sp', w).checked, p_closed: $('#cl', w).checked }); list(c); return true; } }] });
    view.onclick = (e) => { const t = e.target.closest('[data-t]'); if (t) thread(+t.dataset.t); };
  }

  function newThread(role) {
    modal({ title: 'موضوع جديد', body: `<label class="f">النوع<select id="kd">${Object.entries(K).filter(([k]) => role === 'mod' || k !== 'announcement').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f">العنوان *<input id="tt" maxlength="200"></label><label class="f">التفاصيل<textarea id="bd" rows="5" maxlength="5000"></textarea></label>
      <p class="hint">${role === 'student' ? '«سؤال خاص» لا يراه إلا المعلم. التزم بأدب الحوار؛ المعلم يشرف على المشاركات.' : 'الإعلان يظهر لطلاب الفصل ويمكنهم الرد عليه.'}</p>`,
      actions: [{ label: 'إلغاء', value: null, cls: 'ghost' }, { label: 'نشر', cls: 'primary', onClick: async (w) => {
        if (!$('#tt', w).value.trim()) { toast('اكتب العنوان', 'err'); return false; }
        const id = await call('ds_thread_add', { p: { class_id: CUR.class_id, subject_id: CUR.subject_id, kind: $('#kd', w).value, title: $('#tt', w).value, body: $('#bd', w).value } });
        setTimeout(() => thread(id), 0); return true; } }] });
  }

  async function thread(id) {
    let T; try { T = await call('ds_thread', { p_id: id }); } catch (e) { return toast(errMsg(e), 'err'); }
    const mod = T.role === 'mod', canReply = mod || (T.role === 'student' && !T.locked && !T.closed);
    view.innerHTML = `<div class="toolbar glass" style="padding:10px;flex-wrap:wrap"><button class="btn sm ghost" id="back">→ المواضيع</button><b class="grow">${T.pinned ? '📌 ' : ''}${esc(T.title)}</b>
        ${mod ? `<button class="btn sm ghost" data-m="pin:${!T.pinned}">${T.pinned ? 'إلغاء التثبيت' : '📌 تثبيت'}</button><button class="btn sm ghost" data-m="lock:${!T.locked}">${T.locked ? '🔓 فتح' : '🔒 قفل'}</button>
          <button class="btn sm ghost" data-m="hide:${!T.hidden}">${T.hidden ? '👁️ إظهار' : '🙈 إخفاء'}</button><button class="btn sm danger ghost" data-m="delete:true">🗑</button>` : T.mine ? '<button class="btn sm danger ghost" data-m="delete:true">🗑</button>' : ''}</div>
      <div class="glass post ${T.kind === 'announcement' ? 'tch' : ''}"><div class="who">${esc(T.author || '')} <span class="hint">· ${K[T.kind]} · ${ago(T.created_at)}</span></div>${T.body ? `<div class="bd">${linkify(T.body)}</div>` : ''}</div>
      ${T.posts.map((p) => `<div class="post ${p.teacher ? 'tch' : ''} ${p.is_answer ? 'ans' : ''} ${p.hidden ? 'hid' : ''}"><div class="who">${esc(p.author || '')}${p.teacher ? ' 👩‍🏫' : ''} <span class="hint">· ${ago(p.created_at)}</span>${p.is_answer ? ' <span class="pill ok">✓ أفضل إجابة</span>' : ''}</div>
        <div class="bd">${p.body == null ? '<i class="hint">أُخفي هذا الرد من المعلم</i>' : linkify(p.body)}</div>
        ${mod ? `<div class="acts" style="margin-top:4px"><button class="btn sm ghost" data-p="answer:${p.id}">✓ أفضل إجابة</button><button class="btn sm ghost" data-p="hide_post:${p.id}:${!p.hidden}">${p.hidden ? 'إظهار' : 'إخفاء'}</button><button class="btn sm ghost danger" data-p="delete_post:${p.id}">🗑</button></div>`
          : p.mine ? `<div class="acts"><button class="btn sm ghost danger" data-p="delete_post:${p.id}" title="خلال 15 دقيقة">🗑</button></div>` : ''}</div>`).join('')}
      ${canReply ? `<div class="glass xc"><textarea id="rp" rows="3" style="width:100%" maxlength="5000" placeholder="اكتب ردك…"></textarea><button class="btn primary sm" id="send">إرسال</button></div>`
        : `<div class="hint">${T.locked || T.closed ? '🔒 الموضوع مغلق للردود.' : ''}</div>`}`;
    $('#back').onclick = () => list(CUR);
    if ($('#send')) $('#send').onclick = async () => { const v = $('#rp').value.trim(); if (!v) return; try { await call('ds_post_add', { p_thread: id, p_body: v }); thread(id); } catch (er) { toast(errMsg(er), 'err'); } };
    view.onclick = async (e) => {
      const m = e.target.closest('[data-m]'), p = e.target.closest('[data-p]');
      try {
        if (m) { const [a, v] = m.dataset.m.split(':'); if (a === 'delete' && !await confirmBox('حذف الموضوع بكل ردوده؟', 'حذف')) return;
          await call('ds_mod', { p_action: a, p_id: id, p_value: v === 'true' }); return a === 'delete' ? list(CUR) : thread(id); }
        if (p) { const [a, pid, v] = p.dataset.p.split(':'); if (a === 'delete_post' && !await confirmBox('حذف الرد؟', 'حذف')) return;
          await call('ds_mod', { p_action: a, p_id: +pid, p_value: v == null ? true : v === 'true' }); thread(id); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }

  courses();
})();
