/* =====================================================================
   الرحلات المدرسية (sql/81)
   المعلم ينشئ الرحلة ← يرسلها للاعتماد ← مدير المرحلة يعتمد ← تظهر لأولياء الأمور للموافقة في بوابتهم
   ← المنظم يتابع الموافقات والدفع ← يوم الرحلة: الحضور ← تقرير وإغلاق
   ===================================================================== */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, confirmBox } = LMS;
  const ctx = await requireAuth();
  const view = $('#view');
  if (['student', 'parent'].includes(ctx.profile.role) || !LMS.betaAllowed('trips', ctx)) { view.innerHTML = '<div class="notice">🔒 ليس لديك صلاحيات الدخول لهذه الوحدة.</div>'; return; }
  const call = async (fn, args) => { const { data, error } = await sb.rpc(fn, args || {}); if (error) throw error; return data; };
  let LISTS; try { LISTS = await call('cs_lists'); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
  const ST = { draft: ['📝 مسودة', ''], pending: ['⏳ بانتظار الاعتماد', 'gold'], approved: ['✅ معتمدة — جمع الموافقات', 'ok'], rejected: ['⛔ غير معتمدة', 'bad'], done: ['🏁 نُفّذت', 'ok'], cancelled: ['ملغاة', 'bad'] };
  const CON = { pending: '⏳', yes: '✅', no: '✖' };
  $('#tabs').innerHTML = '<button class="on" data-f="">كل الرحلات</button><button data-f="pending">⏳ بانتظار الاعتماد</button><button data-f="approved">✅ المعتمدة</button><button data-f="done">🏁 المنفذة</button>';
  let FLT = '';
  $('#tabs').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; FLT = b.dataset.f; $$('#tabs button').forEach((x) => x.classList.toggle('on', x === b)); listView(); };

  async function listView() {
    view.innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    let L; try { L = await call('tp_list', { p: { status: FLT } }); } catch (e) { view.innerHTML = esc(errMsg(e)); return; }
    view.innerHTML = `<div class="toolbar glass" style="padding:10px"><button class="btn primary sm" id="nt">＋ رحلة جديدة</button></div>
      ${L.map((t) => `<div class="glass xc"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:1.05rem">🚍 ${esc(t.title)}</b><span class="pill ${ST[t.status][1]}">${ST[t.status][0]}</span>
          ${t.status === 'pending' && t.approver ? '<span class="pill gold">بانتظار قرارك</span>' : ''}</div>
        <div>📍 ${esc(t.destination)} · 📅 ${esc(t.day)}${t.depart_time ? ' · ' + esc(t.depart_time) + (t.return_time ? '–' + esc(t.return_time) : '') : ''}${+t.cost ? ` · 💰 ${esc(t.cost)} ريال` : ''}</div>
        <div class="hint">👤 ${esc(t.organizer || '')} · 🎯 ${esc(t.targets || '')}${['approved', 'done'].includes(t.status) ? ` · الموافقات: ✅ ${t.yes} · ✖ ${t.no} · ⏳ ${t.n - t.yes - t.no} من ${t.n}${+t.cost ? ` · دفع ${t.paid}` : ''}` : ''}</div>
        ${t.decision_note ? `<div class="hint">📝 ${esc(t.decision_note)}</div>` : ''}
        <div class="acts">${t.can ? `<button class="btn sm primary" data-op="${t.id}">📂 فتح</button>` : ''}${t.mine && ['draft', 'rejected'].includes(t.status) ? `<button class="btn sm" data-ed="${t.id}">✏️ تعديل</button><button class="btn sm primary" data-sb="${t.id}">📤 إرسال للاعتماد</button>` : ''}
          ${t.status === 'pending' && t.approver ? `<button class="btn sm primary" data-ap="${t.id}">✅ اعتماد</button><button class="btn sm danger" data-rj="${t.id}">⛔ عدم اعتماد</button>` : ''}</div></div>`).join('')
        || '<div class="empty">لا توجد رحلات.</div>'}`;
    $('#nt').onclick = () => tripForm({ grade_ids: [], class_ids: [], supervisors: [], cost: 0 });
    view.onclick = async (e) => {
      const b = e.target.closest('button'); if (!b) return; const t = L.find((x) => x.id === +(b.dataset.op || b.dataset.ed || b.dataset.sb || b.dataset.ap || b.dataset.rj)); if (!t) return;
      try {
        if (b.dataset.ed) tripForm(t);
        if (b.dataset.op) openTrip(t.id);
        if (b.dataset.sb) { if (!await confirmBox('إرسال الرحلة لمدير المرحلة لاعتمادها؟', 'إرسال', false)) return; await call('tp_submit', { p_id: t.id }); toast('أُرسلت للاعتماد ✓'); listView(); }
        if (b.dataset.ap || b.dataset.rj) { const ok = !!b.dataset.ap;
          modal({ title: (ok ? '✅ اعتماد ' : '⛔ عدم اعتماد ') + t.title, body: `${ok ? '<p class="hint">بعد الاعتماد يُنشأ كشف الطلاب المستهدفين، وتظهر الرحلة لأولياء أمورهم في البوابة لإرسال الموافقة.</p>' : ''}<label class="f">${ok ? 'ملاحظة (اختياري)' : 'السبب'}<textarea id="nn" rows="2"></textarea></label>`,
            actions: [{ label: 'إلغاء', value: null }, { label: ok ? 'اعتماد' : 'عدم اعتماد', cls: ok ? 'primary' : 'danger', onClick: async (w) => { await call('tp_decide', { p_id: t.id, p_approve: ok, p_note: $('#nn', w).value }); toast('تم ✓'); listView(); return true; } }] }); }
      } catch (er) { toast(errMsg(er), 'err'); }
    };
  }
  function tripForm(t) {
    const staff = LISTS.staff || [];
    modal({ title: t.id ? '✏️ ' + t.title : '＋ رحلة جديدة', wide: true, body: `<div class="form-grid"><label class="f">عنوان الرحلة<input id="ti" value="${esc(t.title || '')}" placeholder="مثال: زيارة متحف الطيبات"></label><label class="f">الوجهة<input id="de" value="${esc(t.destination || '')}"></label>
        <label class="f">التاريخ<input type="date" id="dy" value="${esc(t.day || '')}"></label><label class="f">الانطلاق<input id="dp" value="${esc(t.depart_time || '')}" placeholder="8:00 ص"></label><label class="f">العودة<input id="rt" value="${esc(t.return_time || '')}" placeholder="12:30 م"></label>
        <label class="f">التكلفة على الطالب (ريال)<input type="number" id="co" value="${t.cost ?? 0}"></label><label class="f">السعة<input type="number" id="cp" value="${t.capacity ?? ''}"></label>
        <label class="f">وسيلة النقل<input id="tr" value="${esc(t.transport || '')}" placeholder="حافلات المدرسة"></label><label class="f">آخر موعد لموافقة ولي الأمر<input type="date" id="cb" value="${esc(t.consent_by || '')}"></label></div>
      <label class="f">الهدف التربوي من الرحلة<textarea id="pu" rows="2">${esc(t.purpose || '')}</textarea></label>
      <details open><summary><b>🎯 الصفوف المشاركة</b></summary><div style="columns:3 180px">${(LISTS.grades || []).map((g) => `<label class="chk"><input type="checkbox" data-g="${g.id}" ${t.grade_ids.includes(g.id) ? 'checked' : ''}> ${esc(g.name)}</label>`).join('')}</div></details>
      <details><summary><b>🏫 أو فصول محددة</b></summary><div style="columns:3 200px">${(LISTS.classes || []).map((c) => `<label class="chk"><input type="checkbox" data-c="${c.id}" ${t.class_ids.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div></details>
      <details><summary><b>👥 المعلمون المرافقون</b></summary><div style="columns:3 180px">${staff.map((s) => `<label class="chk"><input type="checkbox" data-s="${s.id}" ${t.supervisors.includes(s.id) ? 'checked' : ''}> ${esc(s.name)}</label>`).join('')}</div></details>`,
      actions: [{ label: 'إلغاء', value: null }, { label: 'حفظ كمسودة', cls: 'primary', onClick: async (w) => {
        const v = (s) => $(s, w).value.trim();
        await call('tp_save', { p: { id: t.id || '', title: v('#ti'), destination: v('#de'), day: v('#dy'), depart_time: v('#dp'), return_time: v('#rt'), cost: v('#co'), capacity: v('#cp'), transport: v('#tr'), consent_by: v('#cb'), purpose: v('#pu'),
          grade_ids: $$('[data-g]:checked', w).map((x) => +x.dataset.g), class_ids: $$('[data-c]:checked', w).map((x) => +x.dataset.c), supervisors: $$('[data-s]:checked', w).map((x) => x.dataset.s) } });
        toast('تم الحفظ ✓ — أرسلها للاعتماد عند الجاهزية'); listView(); return true; } }] });
  }
  async function openTrip(id) {
    const box = document.createElement('div'); let T, F = '';
    const load = async () => { T = await call('tp_get', { p_id: id }); draw(); };
    function draw() {
      const P = T.people.filter((p) => !F || (F === 'yes' ? p.consent === 'yes' : F === 'no' ? p.consent === 'no' : F === 'pending' ? p.consent === 'pending' : true));
      const day = T.day <= new Date().toISOString().slice(0, 10);
      box.innerHTML = `<p>📍 ${esc(T.destination)} · 📅 ${esc(T.day)} · <span class="pill ${ST[T.status][1]}">${ST[T.status][0]}</span></p>
        <div class="kpi4"><div class="card-box glass"><b>${T.n}</b>مستهدف</div><div class="card-box glass"><b style="color:#007B51">${T.yes}</b>موافقة</div><div class="card-box glass"><b style="color:#b3261e">${T.no}</b>رفض</div><div class="card-box glass"><b>${T.attended}</b>حضر</div></div>
        <div class="seg">${[['', 'الكل'], ['yes', '✅ وافقوا'], ['pending', '⏳ لم يردوا'], ['no', '✖ رفضوا']].map(([k, l]) => `<button data-f="${k}" class="${F === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <table class="t"><thead><tr><th>الطالب</th><th>موافقة ولي الأمر</th>${+T.cost ? '<th>الدفع</th>' : ''}${day ? '<th>الحضور</th>' : ''}</tr></thead><tbody>${P.map((p) => `<tr><td><b>${esc(p.name)}</b><div class="hint">${esc(p.class || '')}</div></td>
          <td><select data-cn="${p.id}">${Object.entries({ pending: '⏳ لم يرد', yes: '✅ موافق', no: '✖ غير موافق' }).map(([k, l]) => `<option value="${k}" ${k === p.consent ? 'selected' : ''}>${l}</option>`).join('')}</select>${p.consent_src ? `<div class="hint">${esc(p.consent_src)}</div>` : ''}</td>
          ${+T.cost ? `<td><input type="checkbox" data-pd="${p.id}" ${p.paid ? 'checked' : ''}></td>` : ''}${day ? `<td><input type="checkbox" data-at="${p.id}" ${p.attended ? 'checked' : ''} ${p.consent !== 'yes' ? 'disabled' : ''}></td>` : ''}</tr>`).join('') || '<tr><td colspan="4" class="hint">—</td></tr>'}</tbody></table>
        <p class="hint">موافقات أولياء الأمور تصل من بوابتهم تلقائيًا. للموافقة الورقية غيّرها يدويًا من القائمة.</p>
        ${T.status === 'approved' ? `<label class="f">تقرير الرحلة (بعد التنفيذ)<textarea id="rp" rows="3">${esc(T.report || '')}</textarea></label><button class="btn primary sm" id="dn">🏁 إغلاق الرحلة كمنفّذة</button> <button class="btn sm danger" id="cx">إلغاء الرحلة</button>` : T.report ? `<div class="notice ok">📝 ${esc(T.report)}</div>` : ''}`;
    }
    box.onclick = async (e) => { const f = e.target.closest('[data-f]'); if (f) { F = f.dataset.f; return draw(); }
      try { if (e.target.id === 'dn' || e.target.id === 'cx') { const done = e.target.id === 'dn'; if (!await confirmBox(done ? 'إغلاق الرحلة كمنفّذة؟' : 'إلغاء الرحلة؟', 'تأكيد', !done)) return;
        await call('tp_close', { p_id: id, p_status: done ? 'done' : 'cancelled', p_report: ($('#rp', box) || {}).value || '' }); toast('تم ✓'); load(); } } catch (er) { toast(errMsg(er), 'err'); } };
    box.onchange = async (e) => { const el = e.target; const sid = el.dataset.cn || el.dataset.pd || el.dataset.at; if (!sid) return;
      const p = el.dataset.cn ? { consent: el.value } : el.dataset.pd ? { paid: el.checked } : { attended: el.checked };
      try { await call('tp_person_set', { p_trip: id, p_student: sid, p }); load(); } catch (er) { toast(errMsg(er), 'err'); } };
    try { await load(); } catch (e) { toast(errMsg(e), 'err'); return; }
    modal({ title: '🚍 ' + T.title, wide: true, body: box, actions: [{ label: 'إغلاق', value: null }] }).then(listView);
  }
  listView();
})();
