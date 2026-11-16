/* A-04 Effect Overview — README §3.6, concept slide 44 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const MAX_SERIES = 8; // categorical palette size; more Actions fold into "Other" (never a generated hue)
  const ui = A.boardUi;

  /** All adopted Actions incl. completed / stopped, so totals equal F-01's Action contribution. */
  const actionsFor = (m) => A.M.boardActions(A.state.orgId, A.state.periodId, true)
    .filter((a) => A.M.actionTargets(a.action_id).includes(m))
    .sort((a, b) => a.action_id.localeCompare(b.action_id));

  function card(m) {
    const { t, esc, fmtSigned, M, state } = A;
    if (!M.isApplicable(state.orgId, m)) {
      return `<div class="kpi na mcard"><div class="label">○ ${esc(t(m))} (${esc(t('jpy_m'))})</div><div class="sub faint">${esc(t('na'))}</div></div>`;
    }
    const list = actionsFor(m);
    const plan = M.r2(list.reduce((s, a) => s + M.actionTotals(a.action_id, state.periodId, m).planAnnual, 0));
    const act = M.r2(list.reduce((s, a) => s + M.actionTotals(a.action_id, state.periodId, m).actualToDate, 0));
    const on = ui.metric === m;
    return `<button class="kpi mcard selectable ${on ? 'on' : ''}" data-metric="${m}" role="radio" aria-checked="${on}">
      <div class="label"><b>${on ? '◉' : '○'} ${esc(t(m))} (${esc(t('jpy_m'))})</b></div>
      <div class="sub">${esc(t('a04_card_sub', { p: fmtSigned(plan), a: fmtSigned(act) }))}</div></button>`;
  }

  function render() {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    if (!M.isApplicable(state.orgId, ui.metric)) ui.metric = 'OP';
    const m = ui.metric;
    const fyP = M.fyPeriods(M.period(state.periodId).fiscal_year);
    const splitAt = fyP.indexOf(state.periodId);
    const list = actionsFor(m);
    const rows = list.map((a) => ({ a, tot: M.actionTotals(a.action_id, state.periodId, m), monthly: M.actionMonthly(a.action_id, m, state.periodId) }));

    // Chart series: one fixed color per Action; beyond the palette size the smallest fold into "Other".
    let chartRows = rows, other = [];
    if (rows.length > MAX_SERIES) {
      const ranked = rows.slice().sort((x, y) => Math.abs(y.tot.outlookFY) - Math.abs(x.tot.outlookFY));
      const keep = new Set(ranked.slice(0, MAX_SERIES - 1).map((r) => r.a.action_id));
      chartRows = rows.filter((r) => keep.has(r.a.action_id));
      other = rows.filter((r) => !keep.has(r.a.action_id));
    }
    const series = chartRows.map((r) => ({ id: r.a.action_id, name: `${r.a.action_id} ${A.actionNamePlain(r.a)}`, color: A.actionColor(r.a.action_id), values: r.monthly.map((x) => x.value || 0) }));
    if (other.length) series.push({ id: '__OTHER', name: t('other_actions', { n: other.length }), color: '#898781', values: fyP.map((_, i) => M.r2(other.reduce((s, r) => s + (r.monthly[i].value || 0), 0))) });
    const chart = rows.length ? A.Chart.stacked(series, { labels: fyP.map((p) => A.monthLabel(p)), keys: fyP, splitAt, width: 660, height: 280 }) : `<div class="placeholder">${esc(t('no_adopted_actions'))}</div>`;

    const legend = series.map((s) => {
      const r = rows.find((x) => x.a.action_id === s.id);
      const vals = r ? r.tot : { planAnnual: other.reduce((x, o) => x + o.tot.planAnnual, 0), actualToDate: other.reduce((x, o) => x + o.tot.actualToDate, 0) };
      return `<li data-series="${esc(s.id)}"><span class="sw2"><i style="background:${s.color}"></i><i style="background:${s.color};opacity:.38"></i></span>
        <div><div>${s.id === '__OTHER' ? esc(s.name) : `<span class="id">${s.id}</span> ${A.actionName(r.a)}`}</div>
        <div class="small muted">${esc(t('card_plan_actual', { p: fmt(M.r2(vals.planAnnual), 1), a: fmt(M.r2(vals.actualToDate), 2) }))}</div></div></li>`;
    }).join('');

    const from = A.monthLabel(fyP[0]), to = A.monthLabel(state.periodId);
    const openFrom = splitAt < 11 ? A.monthLabel(fyP[splitAt + 1]) : null, openTo = A.monthLabel(fyP[11]);
    const sumOf = (k) => M.r2(rows.reduce((s, r) => s + r.tot[k], 0));
    const tbody = rows.map((r) => `<tr class="main-row" tabindex="0" data-action="${r.a.action_id}">
        <td><span class="sw-dot" style="background:${A.actionColor(r.a.action_id)}"></span><span class="id">${r.a.action_id}</span> <span class="small muted">${A.actionName(r.a)}</span></td>
        <td class="num">${fmt(r.tot.planAnnual, 1)}</td>
        <td class="num">${r.tot.actualToDate ? fmt(r.tot.actualToDate, 2) : '<span class="faint">—</span>'}</td>
        <td class="num">${r.tot.remaining ? fmt(r.tot.remaining, 2) : '<span class="faint">—</span>'}</td>
        <td class="num"><b>${fmt(r.tot.outlookFY, 2)}</b></td>
        <td class="num ${A.tone(m, r.tot.outlookVsPlan)}">${fmtSigned(r.tot.outlookVsPlan, 2)}</td></tr>`).join('');
    const totalRow = rows.length ? `<tr class="other-row total-row"><td>${esc(t('units_total'))}</td><td class="num">${fmt(sumOf('planAnnual'), 1)}</td><td class="num">${fmt(sumOf('actualToDate'), 2)}</td>
      <td class="num">${fmt(sumOf('remaining'), 2)}</td><td class="num"><b>${fmt(sumOf('outlookFY'), 2)}</b></td><td class="num ${A.tone(m, sumOf('outlookVsPlan'))}">${fmtSigned(sumOf('outlookVsPlan'), 2)}</td></tr>` : '';

    // AI comment (A04_INSIGHT) — flagged when a progress update changed the outlook after the AI run.
    const cm = A.db.ai_comment.find((c) => c.comment_type === 'A04_INSIGHT' && c.org_id === state.orgId && c.metric_id === m && c.as_of_period_id === state.periodId && c.is_current);
    const outdated = cm && cm.basis_outlook !== undefined && Math.abs(cm.basis_outlook - sumOf('outlookFY')) > 0.005;
    const ai = cm ? `${A.aiText(cm.comment_id)}${outdated ? `<div class="warnline">⚠ ${esc(t('a04_outdated'))}</div>` : ''}` : `<span class="muted">${esc(t('a04_no_comment'))}</span>`;

    return `
      <div class="page-head">
        <h1>A-04 ${esc(t('scr_A04'))}</h1>
        <span class="scope">${esc(A.periodLabel(state.periodId))} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">
          <button class="btn" data-go="A01">◀ ${esc(t('scr_A01'))}</button>
          <div class="seg tabs"><button class="seg-btn" data-go="A03">${esc(t('tab_list'))} (A-03)</button><button class="seg-btn on" aria-pressed="true">${esc(t('tab_effect'))}</button></div>
        </div>
      </div>
      <div class="grid k4 mcards" role="radiogroup" style="margin-bottom:12px">${METRICS.map(card).join('')}</div>
      <div class="grid a04-main">
        <div class="card">
          <h2>${esc(t('a04_chart_title', { metric: t(m) }))} <span class="right hint">${esc(t('dbl_seg'))}</span></h2>
          <div class="a04-chart">${chart}</div>
        </div>
        <div class="card">
          <h2>${esc(t('legend_actions'))}</h2>
          <ul class="a04-legend">${legend || `<li class="muted">${esc(t('no_adopted_actions'))}</li>`}</ul>
        </div>
      </div>
      <div class="grid a04-main">
        <div class="card">
          <h2>${esc(t('a04_table_title', { metric: t(m) }))} <span class="right hint">${esc(t('jpy_m'))}</span></h2>
          <div class="table-wrap"><table class="grid-table">
            <thead><tr><th>${esc(t('action_id'))}</th><th class="num">${esc(t('col_plan_initial'))}</th><th class="num">${esc(t('col_actual_range', { from, to }))}</th>
              <th class="num">${openFrom ? esc(t('col_outlook_range', { from: openFrom, to: openTo })) : esc(t('outlook'))}</th><th class="num">${esc(t('col_outlook'))}</th><th class="num">${esc(t('vs_initial'))}</th></tr></thead>
            <tbody>${tbody || `<tr><td colspan="6" class="muted">${esc(t('no_adopted_actions'))}</td></tr>`}${totalRow}</tbody>
          </table></div>
          <p class="hint" style="margin-top:6px">${esc(t('a04_scope_note'))}</p>
        </div>
        <div class="card">
          <h2>AI <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
          <div class="ai-box">${ai}</div>
        </div>
      </div>`;
  }

  function mount(root) {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
      // A-04 → A-03: keep the list's Metrics if they already include this one, else show just this one.
      if (b.dataset.go === 'A03' && !ui.metrics.includes(ui.metric)) ui.metrics = [ui.metric];
      A.go(b.dataset.go);
    }));
    root.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { ui.metric = b.dataset.metric; A.render(); }));
    const open = (id, period) => {
      if (id === '__OTHER') { A.toast(A.t('other_pick_row')); return; }
      A.go('A05', { actionId: id, periodId: period ? Number(period) : null });
    };
    root.querySelectorAll('rect.seg').forEach((r) => r.addEventListener('dblclick', () => open(r.dataset.series, r.dataset.key)));
    root.querySelectorAll('tr.main-row').forEach((tr) => {
      tr.addEventListener('dblclick', () => open(tr.dataset.action));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(tr.dataset.action); });
    });
    // Hover a legend item, a table row or a segment → emphasize that Action across all months.
    const chart = root.querySelector('svg.stacked');
    const focus = (id) => { if (!chart) return; chart.classList.toggle('focus', !!id); chart.querySelectorAll('rect.seg').forEach((r) => r.classList.toggle('hi', r.dataset.series === id)); };
    root.querySelectorAll('.a04-legend li[data-series], tr.main-row, rect.seg').forEach((el) => {
      const id = el.dataset.series || el.dataset.action;
      el.addEventListener('mouseenter', () => focus(id));
      el.addEventListener('mouseleave', () => focus(null));
    });
  }

  A.SCREENS.A04 = { render, mount };
})();
