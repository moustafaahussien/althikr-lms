/* الرسائل: البريد الداخلي + التعاميم (مع «تم الاطلاع») + تواصل المعلم وولي الأمر */
(async function () {
  const { sb, esc, $, $$, toast, errMsg, requireAuth, modal, hijri, printHTML, ROLE_LABELS } = LMS;
  const ctx = await requireAuth();
  const me = ctx.profile;
  const BUCKET = 'attachments';
  let BOX = 'inbox', LIST = [], CUR = null, GROUPS = {};

  const fmt = (t) => { const d = new Date(t); return d.toLocaleDateString('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('ar-SA-u-ca-gregory-nu-latn', { hour: '2-digit', minute: '2-digit' }); };
  const full = (t) => { const d = new Date(t); return `${d.toLocaleString('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })} — ${hijri(d)}`; };
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const size = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب';

  try { const { data } = await sb.rpc('msg_groups'); GROUPS = data || {}; } catch (_) {}
  if (GROUPS.can_circular) $('#newCirc').style.display = '';
  if (['admin', 'leadership', 'principal'].includes(ctx.realRole || me.role)) $('#boardBtn').style.display = '';
  if (['student', 'parent'].includes(me.role)) $('#newMsg').textContent = '✏️ مراسلة معلم أو الإدارة';

  $('#folders').onclick = (e) => { const b = e.target.closest('[data-box]'); if (!b) return;
    BOX = b.dataset.box; $$('#folders [data-box]').forEach((x) => x.classList.toggle('on', x === b)); CUR = null;
    $('#reader').innerHTML = '<div class="empty">اختر رسالة لعرضها</div>'; loadList(); };
  $('#newMsg').onclick = () => compose({ kind: 'mail' });
  $('#newCirc').onclick = () => compose({ kind: 'circular' });

  async function counts() {
    try { const { data } = await sb.rpc('msg_counts'); if (!data) return;
      $('#cIn').hidden = !data.unread; $('#cIn').textContent = data.unread;
      const p = (data.pending_ack || []).length; $('#cCirc').hidden = !p; $('#cCirc').textContent = p; } catch (_) {}
  }
  async function loadList() {
    $('#mlist').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    if (BOX === 'board') return board();
    const box = BOX === 'circ' ? 'inbox' : BOX, kind = BOX === 'circ' ? 'circular' : null;
    const { data, error } = await sb.rpc('msg_list', { p_box: box, p_kind: kind, p_q: '', p_limit: 100, p_offset: 0 });
    if (error) { $('#mlist').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    LIST = data || [];
    $('#mlist').innerHTML = LIST.length ? LIST.map((m) => `<div class="mitem ${m.read === false ? 'unread' : ''} ${CUR === m.id ? 'on' : ''}" data-id="${m.id}">
        <small>${BOX === 'sent' ? 'إلى: ' + esc(m.to || '') : esc(m.from || '—')}</small>
        <b class="s">${m.kind === 'circular' ? '📢 ' : ''}${esc(m.subject)}</b>
        ${m.snip ? `<small>${esc(m.snip)}</small>` : ''}
        <div class="tags"><span class="chip gray">${esc(fmt(m.at))}</span>${m.att ? '<span class="chip gray">📎 ' + m.att + '</span>' : ''}
          ${m.ref ? `<span class="chip gray">رقم ${esc(m.ref)}</span>` : ''}
          ${BOX === 'sent' ? `<span class="chip teal">قرأها ${m.read}/${m.n}</span>${m.ack ? `<span class="chip">اطّلع ${m.acked}/${m.n}</span>` : ''}` : ''}
          ${BOX !== 'sent' && m.ack && !m.acked ? '<span class="chip pink">بانتظار «تم الاطلاع»</span>' : ''}</div></div>`).join('')
      : `<div class="empty">${{ inbox: 'لا رسائل واردة', circ: 'لا تعاميم', sent: 'لم ترسل رسائل بعد', archive: 'الأرشيف فارغ' }[BOX]}</div>`;
  }
  $('#mlist').onclick = (e) => { const it = e.target.closest('.mitem'); if (it) open(Number(it.dataset.id)); };

  async function open(id) {
    CUR = id; $$('.mitem').forEach((x) => x.classList.toggle('on', Number(x.dataset.id) === id));
    $('#reader').innerHTML = '<div class="empty">جارٍ التحميل…</div>';
    const { data: m, error } = await sb.rpc('msg_get', { p_id: id });
    if (error) { $('#reader').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    const it = $(`.mitem[data-id="${id}"]`); if (it) it.classList.remove('unread');
    counts();
    const atts = (m.attachments || []).map((a, i) => `<a class="btn sm" href="#" data-att="${i}">📎 ${esc(a.name)} <span class="hint">(${size(a.size || 0)})</span></a>`).join('');
    const rec = m.recipients ? (() => { const n = m.recipients.length, rd = m.recipients.filter((x) => x.read).length, ak = m.recipients.filter((x) => x.ack).length;
      return `<div class="section-title"><h2 style="font-size:1rem">حالة الاستلام</h2><span class="hint">قرأها ${rd} من ${n}${m.ack ? ` · اطّلع ${ak}` : ''}</span></div>
        <div class="table-wrap" data-title="حالة الاطلاع: ${esc(m.subject)}"><table><thead><tr><th>المستلم</th><th>الصفة</th><th>القراءة</th>${m.ack ? '<th>تم الاطلاع</th>' : ''}</tr></thead><tbody>
        ${m.recipients.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(ROLE_LABELS[r.role] || '')}</td><td>${r.read ? esc(fmt(r.read)) : '<span class="hint">لم تُقرأ</span>'}</td>
          ${m.ack ? `<td>${r.ack ? '✓ ' + esc(fmt(r.ack)) : '—'}</td>` : ''}</tr>`).join('')}</tbody></table></div>`; })() : '';
    $('#reader').innerHTML = `<h2>${m.kind === 'circular' ? '📢 ' : ''}${esc(m.subject)}</h2>
      <div class="meta"><span>من: <b>${esc(m.from || '—')}</b>${m.from_title ? ' — ' + esc(m.from_title) : ''}</span><span>إلى: ${esc(m.to || '')}</span>
        <span>${esc(full(m.at))}</span>${m.ref ? `<span>رقم التعميم: <b>${esc(m.ref)}</b></span>` : ''}</div>
      ${m.ack && !m.mine ? (m.acked ? `<div class="notice" style="margin:0 0 10px">✓ أكّدت الاطلاع على هذا التعميم (${esc(fmt(m.acked))})</div>`
        : `<div class="ackbox"><span>هذا التعميم يتطلب تأكيد الاطلاع.</span><button class="btn primary" id="ackBtn">✓ تم الاطلاع</button></div>`) : ''}
      <div class="body">${linkify(m.body)}</div>
      ${atts ? `<div class="atts">${atts}</div>` : ''}
      ${m.parent ? `<div class="quote"><b>ردًا على: ${esc(m.parent.subject)}</b> — ${esc(m.parent.from || '')}\n${esc(m.parent.body)}</div>` : ''}
      <div class="acts">${m.can_reply ? '<button class="btn primary" id="rep">↩️ رد</button>' : ''}
        ${m.mine ? '' : `<button class="btn" id="arc">${m.archived ? '📥 إرجاع للوارد' : '🗄️ أرشفة'}</button>`}
        <button class="btn" id="prn">🖨️ طباعة</button></div>${rec}`;
    $$('[data-att]', $('#reader')).forEach((a) => { a.onclick = async (e) => { e.preventDefault();
      const f = m.attachments[Number(a.dataset.att)];
      const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(f.path, 300, { download: f.name });
      if (error) { toast(errMsg(error), 'err'); return; } window.open(data.signedUrl, '_blank'); }; });
    if ($('#ackBtn')) $('#ackBtn').onclick = async () => { const { error } = await sb.rpc('msg_ack', { p_id: id }); if (error) return toast(errMsg(error), 'err'); toast('تم تسجيل الاطلاع ✓'); open(id); loadList(); };
    if ($('#arc')) $('#arc').onclick = async () => { const { error } = await sb.rpc('msg_archive', { p_id: id, p_on: !m.archived }); if (error) return toast(errMsg(error), 'err');
      toast(m.archived ? 'أُعيدت للوارد' : 'نُقلت للأرشيف'); CUR = null; $('#reader').innerHTML = '<div class="empty">اختر رسالة لعرضها</div>'; loadList(); };
    if ($('#rep')) $('#rep').onclick = () => compose({ kind: 'mail', reply: m });
    $('#prn').onclick = () => printHTML(m.kind === 'circular' ? 'تعميم' + (m.ref ? ' رقم ' + m.ref : '') : 'رسالة',
      `<h2>${esc(m.subject)}</h2><p><b>من:</b> ${esc(m.from || '')}${m.from_title ? ' — ' + esc(m.from_title) : ''}<br><b>إلى:</b> ${esc(m.to || '')}<br><b>التاريخ:</b> ${esc(full(m.at))}</p>
       <div style="white-space:pre-wrap;line-height:1.9;font-size:13px;border-top:1px solid #ddd;padding-top:10px">${esc(m.body)}</div>
       ${(m.attachments || []).length ? '<p><b>المرفقات:</b> ' + m.attachments.map((a) => esc(a.name)).join('، ') + '</p>' : ''}`);
  }

  // ---------- لوحة متابعة التعاميم ----------
  async function board() {
    const { data, error } = await sb.rpc('msg_circulars_board', { p_limit: 60 });
    if (error) { $('#mlist').innerHTML = `<div class="notice err">${esc(errMsg(error))}</div>`; return; }
    $('#mlist').innerHTML = '<div class="empty">التفاصيل في اللوحة ←</div>';
    $('#reader').innerHTML = `<h2>📊 متابعة التعاميم</h2><p class="hint">نسبة القراءة وتأكيد الاطلاع لكل تعميم. اضغط التعميم لعرض المستلمين واحدًا واحدًا.</p>
      ${(data || []).length ? `<div class="table-wrap" data-title="لوحة متابعة التعاميم" style="max-height:none"><table><thead><tr><th>التعميم</th><th>الرقم</th><th>التاريخ</th><th>المُصدر</th><th>المستلمون</th><th>قرأه</th><th>اطّلع</th><th class="no-export">نسبة الاطلاع</th></tr></thead><tbody>
      ${data.map((c) => { const pct = c.n ? Math.round(c.acked / c.n * 100) : 0;
        return `<tr data-open="${c.id}" style="cursor:pointer"><td><b>${esc(c.subject)}</b><div class="hint">${esc(c.to || '')}</div></td><td>${esc(c.ref || '')}</td><td>${esc(fmt(c.at))}<div class="hint">${esc(hijri(c.at))}</div></td>
          <td>${esc(c.from || '')}</td><td>${c.n}</td><td>${c.read}</td><td>${c.acked}</td><td class="no-export"><div class="progress" title="${pct}%"><i style="width:${pct}%"></i></div> ${pct}%</td></tr>`; }).join('')}</tbody></table></div>`
        : '<div class="empty">لم تصدر تعاميم بعد</div>'}`;
    $$('[data-open]', $('#reader')).forEach((tr) => { tr.onclick = () => open(Number(tr.dataset.open)); });
  }

  // ---------- إنشاء رسالة / تعميم ----------
  function compose({ kind, reply }) {
    const circ = kind === 'circular';
    const TO = new Map(); const files = [];
    if (reply && reply.from_id) TO.set(reply.from_id, reply.from);
    const G = GROUPS;
    const groupsHtml = (G.can_broadcast ? `
      <div class="grp-box"><label><input type="checkbox" data-all> كل الموظفين</label>
        ${(G.roles || []).map((r) => `<label><input type="checkbox" data-role="${r.k}"> ${esc(r.l)}</label>`).join('')}</div>
      <div class="grp-box"><span class="hint">مرحلة:</span>${(G.stages || []).map((s) => `<label><input type="checkbox" data-stage="${s.id}"> ${esc(s.name)}</label>`).join('')}</div>` : '')
      + ((G.parent_grades || []).length && !circ ? `<details><summary class="hint" style="cursor:pointer">أولياء أمور صف كامل…</summary><div class="grp-box">
        ${G.parent_grades.map((g) => `<label><input type="checkbox" data-pgrade="${g.id}" ${g.parents ? '' : 'disabled'}> ${esc(g.name)} <span class="hint">(${g.parents})</span></label>`).join('')}</div></details>` : '')
      + (circ && (G.parent_grades || []).length ? `<details><summary class="hint" style="cursor:pointer">إرسال التعميم لأولياء أمور…</summary><div class="grp-box">
        ${G.parent_grades.map((g) => `<label><input type="checkbox" data-pgrade="${g.id}" ${g.parents ? '' : 'disabled'}> ${esc(g.name)} <span class="hint">(${g.parents})</span></label>`).join('')}</div></details>` : '');
    const body = document.createElement('div'); body.className = 'compose';
    body.innerHTML = `
      ${circ ? '<label class="f">رقم التعميم<input id="cRef" placeholder="مثال: 12/1448"></label>' : ''}
      <label class="f">إلى</label>
      <div class="to-chips" id="cTo"></div>
      <input id="cFind" placeholder="${['student', 'parent'].includes(me.role) ? 'ابحث باسم المعلم أو الإداري…' : 'ابحث بالاسم أو المسمى لإضافة مستلم…'}" autocomplete="off">
      <div class="sug" id="cSug" hidden></div>
      ${groupsHtml}
      <label class="f">العنوان<input id="cSub" value="${reply ? esc('رد: ' + reply.subject.replace(/^رد: /, '')) : ''}"></label>
      <label class="f">${circ ? 'نص التعميم' : 'نص الرسالة'}<textarea id="cBody"></textarea></label>
      <label class="f">المرفقات <input type="file" id="cFiles" multiple></label>
      <div class="hint">الحد الأقصى 15 ميجابايت للملف.</div><div id="cFl" class="atts"></div>
      ${circ ? '<label style="display:flex;gap:8px;align-items:center;margin-top:10px"><input type="checkbox" id="cAck" checked> يتطلب «تم الاطلاع» من كل مستلم</label>' : ''}`;
    const paintTo = () => { $('#cTo', body).innerHTML = [...TO].map(([id, n]) => `<span class="chip" data-rm="${id}">${esc(n)}</span>`).join(''); };
    paintTo();
    $('#cTo', body).onclick = (e) => { const c = e.target.closest('[data-rm]'); if (c) { TO.delete(c.dataset.rm); paintTo(); } };
    let tmr = null;
    $('#cFind', body).oninput = () => { clearTimeout(tmr); tmr = setTimeout(async () => {
      const q = $('#cFind', body).value.trim(); const box = $('#cSug', body);
      if (q.length < 2) { box.hidden = true; return; }
      const { data } = await sb.rpc('msg_contacts', { p_q: q });
      box.hidden = !(data || []).length;
      box.innerHTML = (data || []).map((p) => `<div data-id="${p.id}" data-n="${esc(p.name)}"><b>${esc(p.name)}</b> <span class="hint">${esc(p.title || ROLE_LABELS[p.role] || '')}</span></div>`).join('');
    }, 250); };
    $('#cSug', body).onclick = (e) => { const d = e.target.closest('[data-id]'); if (!d) return; TO.set(d.dataset.id, d.dataset.n); paintTo(); $('#cFind', body).value = ''; $('#cSug', body).hidden = true; };
    $('#cFiles', body).onchange = () => { [...$('#cFiles', body).files].forEach((f) => { if (f.size > 15728640) toast(`«${f.name}» أكبر من 15 ميجابايت`, 'err'); else files.push(f); });
      $('#cFiles', body).value = ''; $('#cFl', body).innerHTML = files.map((f, i) => `<span class="chip gray" data-rf="${i}" style="cursor:pointer">📎 ${esc(f.name)} ✕</span>`).join(''); };
    $('#cFl', body).onclick = (e) => { const c = e.target.closest('[data-rf]'); if (!c) return; files.splice(Number(c.dataset.rf), 1); c.remove(); };

    modal({ title: circ ? '📢 تعميم جديد' : reply ? '↩️ رد' : '✏️ رسالة جديدة', body, wide: true, actions: [
      { label: 'إلغاء', cls: 'ghost', value: false },
      { label: circ ? '📢 إصدار التعميم' : '📨 إرسال', cls: 'primary', onClick: async () => {
        const to = { people: [...TO.keys()],
          roles: $$('[data-role]:checked', body).map((x) => x.dataset.role),
          stages: $$('[data-stage]:checked', body).map((x) => Number(x.dataset.stage)),
          all_staff: !!($('[data-all]', body) && $('[data-all]', body).checked),
          parents_grades: $$('[data-pgrade]:checked', body).map((x) => Number(x.dataset.pgrade)) };
        if (!to.people.length && !to.roles.length && !to.stages.length && !to.all_staff && !to.parents_grades.length) { toast('حدّد المستلمين', 'err'); return false; }
        if (!$('#cSub', body).value.trim()) { toast('اكتب العنوان', 'err'); return false; }
        // رفع المرفقات أولًا
        const atts = [];
        for (const f of files) {
          const ext = (f.name.match(/\.[a-z0-9]{1,8}$/i) || [''])[0].toLowerCase();
          const path = `u/${me.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
          const { error } = await sb.storage.from(BUCKET).upload(path, f, { contentType: f.type || 'application/octet-stream' });
          if (error) { toast(`تعذّر رفع «${f.name}»: ${errMsg(error)}`, 'err'); return false; }
          atts.push({ name: f.name, path, size: f.size, type: f.type });
        }
        const { data, error } = await sb.rpc('msg_send', { p: { kind, subject: $('#cSub', body).value, body: $('#cBody', body).value, attachments: atts, to,
          ref_no: circ ? $('#cRef', body).value : null, requires_ack: circ ? $('#cAck', body).checked : false, reply_to: reply ? reply.id : null } });
        if (error) { toast(errMsg(error), 'err'); return false; }
        toast(`${circ ? 'صدر التعميم' : 'أُرسلت الرسالة'} إلى ${data.recipients} مستلم ✓`);
        BOX = 'sent'; $$('#folders [data-box]').forEach((x) => x.classList.toggle('on', x.dataset.box === 'sent')); loadList(); open(data.id);
        return true; } }] });
  }

  // فتح رسالة من رابط (?m=رقم)
  const qid = Number(new URLSearchParams(location.search).get('m'));
  counts(); await loadList(); if (qid) open(qid);
  setInterval(counts, 60000);
})();
