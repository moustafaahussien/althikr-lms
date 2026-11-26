/* نموذج الإجابة عن استبيان (مشترك: صفحة الاستبيانات + بوابة ولي الأمر) */
(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const SCALE = ['غير موافق بشدة', 'غير موافق', 'محايد', 'موافق', 'موافق بشدة'];
  const st = document.createElement('style');
  st.textContent = `.srvq{margin:12px 0;padding:10px 12px;border:1px solid var(--line,#dde5e1);border-radius:12px;background:#fff}
    .srvq .qt{font-weight:700;margin-bottom:6px}.srvq .qt i{color:#c0392b;font-style:normal}
    .srvq .opts{display:flex;flex-wrap:wrap;gap:6px}.srvq .opts label{border:1px solid var(--line,#dde5e1);border-radius:99px;padding:5px 12px;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
    .srvq .opts label:has(input:checked){background:#e6f6ee;border-color:#007B51;color:#00603f}
    .srvq .stars label{font-size:1.6rem;cursor:pointer;color:#ccc}.srvq .stars input{display:none}.srvq .stars label.on{color:#e0b000}
    .srvq textarea{width:100%;min-height:70px}`;
  document.head.appendChild(st);

  function form(v) {
    return `${v.intro ? `<p class="hint" style="white-space:pre-wrap">${esc(v.intro)}</p>` : ''}${v.anonymous ? '<p class="hint">🔒 الإجابات مجهولة الهوية.</p>' : ''}
      ${v.questions.map((q, i) => `<div class="srvq" data-k="${esc(q.key)}" data-t="${q.type}"><div class="qt">${i + 1}. ${esc(q.text)} ${q.required ? '<i>*</i>' : ''}</div>
        ${q.type === 'single' ? `<div class="opts">${q.options.map((o) => `<label><input type="radio" name="r_${esc(q.key)}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>` : ''}
        ${q.type === 'multi' ? `<div class="opts">${q.options.map((o) => `<label><input type="checkbox" value="${esc(o)}"> ${esc(o)}</label>`).join('')}</div>` : ''}
        ${q.type === 'scale' ? `<div class="opts">${SCALE.map((o, j) => `<label><input type="radio" name="r_${esc(q.key)}" value="${j + 1}"> ${o}</label>`).join('')}</div>` : ''}
        ${q.type === 'rating' ? `<div class="stars">${[1, 2, 3, 4, 5].map((n) => `<label data-n="${n}"><input type="radio" name="r_${esc(q.key)}" value="${n}">★</label>`).join('')}</div>` : ''}
        ${q.type === 'text' ? '<textarea maxlength="2000"></textarea>' : ''}</div>`).join('')}`;
  }
  function bind(root) {
    root.addEventListener('change', (e) => {
      const s = e.target.closest('.stars'); if (!s) return;
      const n = +e.target.value; s.querySelectorAll('label').forEach((l) => l.classList.toggle('on', +l.dataset.n <= n));
    });
  }
  function collect(root, v) {
    const a = {};
    for (const q of v.questions) {
      const box = root.querySelector(`.srvq[data-k="${CSS.escape(q.key)}"]`); let val = null;
      if (q.type === 'multi') { val = [...box.querySelectorAll('input:checked')].map((x) => x.value); if (!val.length) val = null; }
      else if (q.type === 'text') { val = box.querySelector('textarea').value.trim() || null; }
      else { const c = box.querySelector('input:checked'); val = c ? (['scale', 'rating'].includes(q.type) ? +c.value : c.value) : null; }
      if (val == null && q.required) { box.scrollIntoView({ behavior: 'smooth', block: 'center' }); throw new Error('أجب عن السؤال: ' + q.text); }
      if (val != null) a[q.key] = val;
    }
    return a;
  }
  window.SRV = { form, bind, collect, SCALE };
})();
