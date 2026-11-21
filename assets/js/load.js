/* نصاب الحصص: عدد الحصص الأسبوعية لكل معلم من جداول الحصص المعتمدة + جدوله */
(async function () {
  const { sb, esc, $, toast, errMsg, fetchAll, requireAuth, modal, printHTML } = LMS;
  await requireAuth(['admin', 'leadership', 'principal', 'supervisor']);

  const DAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
  let ALL = [], SUBJ = {};
  const stdKey = 'load_std';
  const getStd = () => { try { return Number(localStorage.getItem(stdKey)) || 24; } catch (_) { return 24; } };
  $('#std').value = getStd();

  try {
    const [vt, subs] = await Promise.all([
      fetchAll(() => sb.from('v_staff_teaching').select('*')),
      fetchAll(() => sb.from('subjects').select('id,name_ar'))
    ]);
    subs.forEach((s) => { SUBJ[s.id] = s.name_ar; });
    const ids = vt.map((v) => v.teacher_id);
    const profs = [];
    for (let i = 0; i < ids.length; i += 150) {
      const { data, error } = await sb.from('profiles').select('id,full_name,job_title,active').in('id', ids.slice(i, i + 150));
      if (error) throw error; profs.push(...data);
    }
    const P = {}; profs.forEach((p) => { P[p.id] = p; });
    ALL = vt.filter((v) => !P[v.teacher_id] || P[v.teacher_id].active !== false).map((v) => ({
      id: v.teacher_id, name: (P[v.teacher_id] || {}).full_name || '—', title: (P[v.teacher_id] || {}).job_title || '',
      subjects: v.subjects || '', stages: v.stages || '', classes: v.class_count || 0, periods: Number(v.weekly_periods) || 0,
      sup: v.supervisors || '', list: v.classes || []
    }));
  } catch (e) { $('#list').innerHTML = `<div class="notice err">${esc(errMsg(e))}</div>`; return; }

  const uniq = (f) => [...new Set(ALL.flatMap((r) => String(r[f] || '').split('، ').filter(Boolean)))].sort((a, b) => a.localeCompare(b, 'ar'));
  $('#stg').insertAdjacentHTML('beforeend', uniq('stages').map((x) => `<option>${esc(x)}</option>`).join(''));
  $('#sub').insertAdjacentHTML('beforeend', uniq('subjects').map((x) => `<option>${esc(x)}</option>`).join(''));
  $('#sup').insertAdjacentHTML('beforeend', uniq('sup').map((x) => `<option>${esc(x)}</option>`).join(''));
  ['q', 'stg', 'sub', 'sup'].forEach((k) => { $('#' + k).oninput = render; });
  $('#std').oninput = () => { try { localStorage.setItem(stdKey, $('#std').value); } catch (_) {} render(); };

  function filtered() {
    const q = $('#q').value.trim(), st = $('#stg').value, su = $('#sub').value, sp = $('#sup').value;
    return ALL.filter((r) => (!st || r.stages.split('، ').includes(st)) && (!su || r.subjects.split('، ').includes(su))
      && (!sp || r.sup.split('، ').includes(sp))
      && (!q || [r.name, r.subjects, r.title, r.list.map((c) => c.label).join(' ')].join(' ').includes(q)))
      .sort((a, b) => b.periods - a.periods || a.name.localeCompare(b.name, 'ar'));
  }
  function render() {
    const L = filtered(), std = getStd();
    const tot = L.reduce((s, r) => s + r.periods, 0), avg = L.length ? tot / L.length : 0;
    const over = L.filter((r) => r.periods > std).length, under = L.filter((r) => r.periods < std * 0.75).length;
    $('#stats').innerHTML = [
      ['المعلمون', L.length], ['إجمالي الحصص الأسبوعية', tot], ['متوسط النصاب', avg.toFixed(1)],
      [`فوق النصاب (${std})`, over], ['أقل من 75% من النصاب', under]
    ].map(([l, v]) => `<div class="stat glass"><b>${v}</b><small>${l}</small></div>`).join('');
    if (!L.length) { $('#list').innerHTML = '<div class="empty">لا توجد نتائج</div>'; return; }
    $('#list').innerHTML = `<div class="table-wrap" data-title="نصاب الحصص الأسبوعي" style="max-height:none"><table>
      <thead><tr><th>#</th><th>المعلم</th><th>المواد</th><th>المراحل</th><th>الفصول</th><th>الحصص / الأسبوع</th><th class="no-export">النسبة من النصاب</th><th>المشرف</th><th class="actions"></th></tr></thead>
      <tbody>${L.map((r, i) => { const pct = Math.min(100, Math.round(r.periods / std * 100));
        const cls = r.periods > std ? 'over' : r.periods < std * 0.75 ? 'under' : '';
        return `<tr><td>${i + 1}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.subjects)}</td><td>${esc(r.stages)}</td><td>${r.classes}</td>
          <td><b>${r.periods}</b></td><td class="no-export"><div class="bar ${cls}" title="${Math.round(r.periods / std * 100)}%"><i style="width:${pct}%"></i></div></td>
          <td>${esc(r.sup)}</td><td class="actions"><button class="btn sm" data-tt="${esc(r.id)}">📅 الجدول</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  $('#list').onclick = (e) => { const b = e.target.closest('[data-tt]'); if (b) showTT(ALL.find((r) => r.id === b.dataset.tt)); };

  async function showTT(r) {
    if (!r) return;
    let rows;
    try { rows = await fetchAll(() => sb.from('v_timetable').select('day,period,kind,cls,subject_id,txt').eq('teacher_id', r.id).eq('kind', 'class')); }
    catch (e) { toast(errMsg(e), 'err'); return; }
    const maxP = Math.max(7, ...rows.map((x) => x.period || 0));
    // نفس الحصة قد تتكرر إذا كان الجدول مرفوعًا عند أكثر من مشرف: تُعرض مرة واحدة
    const cell = {}, seen = new Set();
    rows.forEach((x) => { const k = x.day + '|' + x.period, u = k + '|' + x.cls + '|' + x.subject_id; if (seen.has(u)) return; seen.add(u); (cell[k] = cell[k] || []).push(x); });
    const grid = `<table class="tt-grid"><thead><tr><th>اليوم</th>${Array.from({ length: maxP }, (_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody>
      ${DAYS.map((d, di) => `<tr><th>${d}</th>${Array.from({ length: maxP }, (_, pi) => { const c = cell[di + '|' + (pi + 1)];
        return c ? `<td>${c.map((x) => `<b>${esc(SUBJ[x.subject_id] || x.txt || '')}</b>${esc(x.cls || '')}`).join('<hr style="margin:3px 0;border:0;border-top:1px dashed #ccd">')}</td>` : '<td class="off">—</td>'; }).join('')}</tr>`).join('')}
      </tbody></table>`;
    const info = `<p style="margin:0 0 8px"><b>${esc(r.name)}</b> — ${esc(r.subjects)} · ${esc(r.stages)} · <b>${r.periods}</b> حصة أسبوعيًا · ${r.classes} فصول${r.sup ? ' · المشرف: ' + esc(r.sup) : ''}</p>`;
    modal({ title: '📅 جدول ' + r.name, wide: true, body: info + `<div class="table-wrap no-tools" style="max-height:none">${grid}</div>`,
      actions: [{ label: '🖨️ طباعة الجدول', cls: 'primary', onClick: () => { printHTML('جدول حصص المعلم: ' + r.name, info + grid); return false; } }, { label: 'إغلاق', value: true }] });
  }
  render();
})();
