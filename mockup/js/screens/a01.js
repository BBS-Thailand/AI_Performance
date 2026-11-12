/* A-01 AI Insights (home) — README §3.1 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const filters = { type: '', status: '', org: '' };

  function kpiCard(k) {
    const { t, esc, fmt, fmtSigned } = A;
    if (!k.applicable) {
      return `<div class="kpi na"><div class="label">${esc(t(k.metric))}</div><div class="value">${esc(t('na'))}</div><div class="sub faint">&nbsp;</div></div>`;
    }
    const cls = A.tone(k.metric, k.variance);
    const fav = cls === 'good' ? t('favorable') : cls === 'bad' ? t('unfavorable') : '';
    return `<div class="kpi"><div class="label">${esc(t(k.metric))} · ${esc(t('actual'))}</div>
      <div class="value">${fmt(k.actual)}<span class="unit">${esc(t('jpy_m'))}</span></div>
      <div class="sub"><span class="pill ${cls}">${fmtSigned(k.variance)}</span><span class="muted">${esc(t('vs_budget'))} (${fmt(k.budget)})</span>
      ${fav ? `<span class="${cls} small">${esc(fav)}</span>` : ''}</div></div>`;
  }

  function sortedRows() {
    const M = A.M, s = A.state;
    let rows = M.pointsFor(s.orgId, s.periodId);
    if (filters.type) rows = rows.filter((r) => r.point.point_type === filters.type);
    if (filters.status) rows = rows.filter((r) => r.point.status === filters.status);
    if (filters.org) rows = rows.filter((r) => r.orgs.includes(filters.org));
    return rows.sort((a, b) => Math.abs(b.overall) - Math.abs(a.overall));
  }

  function render() {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const kpis = METRICS.map((m) => M.kpi(state.orgId, state.periodId, m));
    const applicable = Object.fromEntries(kpis.map((k) => [k.metric, k.applicable]));
    const all = M.pointsFor(state.orgId, state.periodId);
    const rows = sortedRows();
    const filtered = filters.type || filters.status || filters.org;
    const other = M.otherVariance(state.orgId, state.periodId, all);
    const summary = A.db.ai_comment.find((c) => c.comment_type === 'A01_SUMMARY' && c.org_id === state.orgId && c.as_of_period_id === state.periodId && c.is_current);
    const run = summary && A.db.ai_run.find((r) => r.run_id === summary.run_id);
    const pointOrgs = [...new Set(all.flatMap((r) => r.orgs))];

    const cell = (r, m) => (applicable[m] ? `<td class="num ${A.tone(m, r.impacts[m])}">${fmtSigned(r.impacts[m])}</td>` : `<td class="num faint">${esc(t('na'))}</td>`);
    const subCell = (r, m) => (applicable[m]
      ? `<td class="num">${r.vsInit[m] === null ? '' : fmtSigned(r.vsInit[m])}<br>${r.vsPrev[m] === null ? '' : fmtSigned(r.vsPrev[m])}</td>` : '<td></td>');
    const body = rows.map((r) => {
      const p = r.point;
      return `<tr class="main-row" tabindex="0" data-point="${p.point_id}">
          <td><span class="id">${p.point_id}</span></td>
          <td><span class="tag ${p.point_type === 'ISSUE' ? 'issue' : 'opp'}">${esc(t(p.point_type === 'ISSUE' ? 'issue' : 'opportunity'))}</span></td>
          <td>${A.pointTitle(p)}</td>
          <td>${r.orgs.map((o) => esc(A.orgName(o))).join(', ')}</td>
          ${METRICS.map((m) => cell(r, m)).join('')}
          <td class="num overall ${r.overall < 0 ? 'bad' : 'good'}">${fmtSigned(r.overall)}</td>
          <td>${esc(t('st_' + p.status))}</td>
          <td class="num">${r.proposalCount}</td><td class="num">${r.executingCount}</td>
          <td class="num">${fmt(r.plannedEffect)}</td><td class="num">${fmt(r.actualEffect)}</td>
        </tr>
        <tr class="sub-row" data-point-sub="${p.point_id}">
          <td colspan="3"></td><td class="small">${esc(t('vs_init_short'))}<br>${esc(t('vs_prev_short'))}</td>
          ${METRICS.map((m) => subCell(r, m)).join('')}
          <td class="num">${r.overallVsInit === null ? '' : fmtSigned(r.overallVsInit)}<br>${r.overallVsPrev === null ? '' : fmtSigned(r.overallVsPrev)}</td>
          <td colspan="5"></td></tr>`;
    }).join('');
    const otherRow = filtered ? '' : `<tr class="other-row"><td colspan="4" title="${esc(t('other_note'))}">${esc(t('other_unidentified'))} <span class="small">— ${esc(t('other_note'))}</span></td>
      ${METRICS.map((m) => (applicable[m] ? `<td class="num">${fmtSigned(other[m])}</td>` : '<td></td>')).join('')}<td colspan="6"></td></tr>
      <tr class="other-row" style="font-style:normal;font-weight:600"><td colspan="4">${esc(t('units_total'))} = ${esc(t('vs_budget'))}</td>
      ${kpis.map((k) => (k.applicable ? `<td class="num ${A.tone(k.metric, k.variance)}">${fmtSigned(k.variance)}</td>` : '<td></td>')).join('')}<td colspan="6"></td></tr>`;
    const opt = (v, label, cur) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${esc(label)}</option>`;

    return `
      <div class="page-head">
        <h1>A-01 ${esc(t('scr_A01'))}</h1>
        <span class="scope">${esc(A.ytdLabel())} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions"><button class="btn primary" data-go="A03">${esc(t('action_board'))} (A-03)</button></div>
      </div>
      <div class="grid k4" style="margin-bottom:14px">${kpis.map(kpiCard).join('')}</div>
      <div class="card">
        <h2>${esc(t('ai_summary'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
        <div class="ai-box">${summary ? A.aiText(summary.comment_id) : `<span class="muted">–</span>`}
          ${run ? `<div class="meta">${esc(t('source_ref', { src: `${run.run_id} · ${run.source_load_id} · model ${run.model_name}`, period: A.periodLabel(run.as_of_period_id) }))}</div>` : ''}</div>
      </div>
      <div class="card">
        <h2>${esc(t('points'))} <span class="right hint">${esc(t('sort_note'))} · ${esc(t('dblclick_hint'))}</span></h2>
        <div class="filters">
          <label class="muted small">${esc(t('type'))}</label>
          <select data-filter="type">${opt('', t('filter_all'), filters.type)}${opt('ISSUE', t('issue'), filters.type)}${opt('OPPORTUNITY', t('opportunity'), filters.type)}</select>
          <label class="muted small">${esc(t('status'))}</label>
          <select data-filter="status">${opt('', t('filter_all'), filters.status)}${['OPEN', 'IN_ACTION', 'RESOLVED', 'CLOSED'].map((s) => opt(s, t('st_' + s), filters.status)).join('')}</select>
          <label class="muted small">${esc(t('orgs'))}</label>
          <select data-filter="org">${opt('', t('filter_all'), filters.org)}${pointOrgs.map((o) => opt(o, A.orgName(o), filters.org)).join('')}</select>
        </div>
        <div class="table-wrap"><table class="grid-table">
          <thead>
            <tr><th rowspan="2">${esc(t('point_id'))}</th><th rowspan="2">${esc(t('type'))}</th><th rowspan="2">${esc(t('description'))}</th><th rowspan="2">${esc(t('orgs'))}</th>
              <th colspan="4" class="group-head">${esc(t('impact'))} (${esc(t('jpy_m'))})</th>
              <th class="num" rowspan="2">${esc(t('overall_impact'))}<br><span class="small">${esc(t('annual_op_impact'))}</span></th>
              <th rowspan="2">${esc(t('status'))}</th><th class="num" rowspan="2">${esc(t('proposals'))}</th><th class="num" rowspan="2">${esc(t('executing'))}</th>
              <th class="num" rowspan="2">${esc(t('planned_effect'))}</th><th class="num" rowspan="2">${esc(t('actual_effect'))}</th></tr>
            <tr>${METRICS.map((m) => `<th class="num">${esc(t(m))}</th>`).join('')}</tr>
          </thead>
          <tbody>${body || `<tr><td colspan="14" class="muted">${esc(t('no_points'))}</td></tr>`}${otherRow}</tbody>
        </table></div>
      </div>`;
  }

  function mount(root) {
    const open = (id) => A.go('A02', { pointId: id, order: sortedRows().map((r) => r.point.point_id) });
    root.querySelectorAll('tr.main-row').forEach((tr) => {
      tr.addEventListener('dblclick', () => open(tr.dataset.point));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(tr.dataset.point); });
    });
    root.querySelectorAll('[data-filter]').forEach((sel) => sel.addEventListener('change', () => { filters[sel.dataset.filter] = sel.value; A.render(); }));
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
  }

  A.SCREENS.A01 = { render, mount };
})();
