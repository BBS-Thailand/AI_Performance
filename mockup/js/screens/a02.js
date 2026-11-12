/* A-02 Point Detail — README §3.2 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  let selectedAction = null;

  /** OP variance (actual − budget, YTD) grouped by the Point's analysis dimension within the Point's organizations. */
  function gapItems(p) {
    const M = A.M, pid = A.state.periodId;
    const ytd = M.ytdPeriods(pid);
    const orgs = M.pointOrgs(p.point_id);
    const filter = JSON.parse(p.indicator_filter || '{}');
    const keyCol = { CUSTOMER: 'customer_id', PRODUCT: 'product_id', ACCOUNT: 'account_id' }[p.gap_dimension];
    const totals = {};
    orgs.forEach((o) => {
      const act = M.factGroup('ACT', ytd, o, 'OP', keyCol);
      const bud = M.factGroup('BUD', ytd, o, 'OP', keyCol);
      new Set([...Object.keys(act), ...Object.keys(bud)]).forEach((k) => (totals[k] = (totals[k] || 0) + (act[k] || 0) - (bud[k] || 0)));
    });
    let highlight;
    if (p.gap_dimension === 'CUSTOMER') highlight = new Set(filter.customer_id || []);
    else if (p.gap_dimension === 'ACCOUNT') highlight = new Set(filter.account_id || []);
    else {
      highlight = new Set(A.db.fact_financial.filter((f) => (filter.customer_id || []).includes(f.customer_id)).map((f) => f.product_id));
    }
    const label = (k) => (keyCol === 'customer_id' ? (A.db.dim_customer.find((c) => c.customer_id === k) || {}).customer_name
      : keyCol === 'product_id' ? (A.db.dim_product.find((c) => c.product_id === k) || {}).product_name
        : `${k} ${(A.db.dim_account.find((c) => c.account_id === k) || {}).account_name}`);
    return Object.entries(totals).filter(([k, v]) => k !== 'NA' && Math.abs(v) >= 0.05)
      .sort((a, b) => a[1] - b[1]).slice(0, 9)
      .map(([k, v]) => ({ label: label(k), value: M.r2(v), highlight: highlight.has(k) }));
  }

  function indicator(p) {
    const M = A.M, pid = A.state.periodId;
    const f = JSON.parse(p.indicator_filter || '{}');
    const fy = M.period(pid).fiscal_year;
    const months = M.fyPeriods(fy);
    const scopeOrg = p.parent_point_id ? p.org_id : 'CO';
    const rowFilter = (r) => (!f.customer_id || f.customer_id.includes(r.customer_id))
      && (!f.account_id || f.account_id.includes(r.account_id))
      && (!f.org_id || f.org_id.includes(r.org_id));
    const metric = p.indicator_metric_id;
    // Cost-type indicators (accounts) are shown as positive cost amounts.
    const sign = f.account_id && metric !== 'REV' ? -1 * (metric === 'SGA' ? -1 : 1) : 1;
    const v = (scen, ps) => M.r2(sign * M.factValue(scen, ps, scopeOrg, metric, rowFilter));
    const name = f.customer_id
      ? `${A.t(metric)} – ${f.customer_id.map((c) => A.db.dim_customer.find((x) => x.customer_id === c).customer_name).join(', ')}`
      : `${f.account_id.map((a) => A.db.dim_account.find((x) => x.account_id === a).account_name).join(', ')}`;
    return {
      name,
      html: A.Chart.monthly([
        { name: A.t('budget'), type: 'bar', color: 'var(--chart-budget)', values: months.map((m) => v('BUD', [m])) },
        { name: A.t('actual'), type: 'bar', color: 'var(--chart-actual)', values: months.map((m) => (m <= pid ? v('ACT', [m]) : null)) },
        { name: A.t('prior_year'), type: 'line', color: 'var(--chart-py)', dash: true, values: months.map((m) => v('ACT', [m - 100])) },
      ], { labels: months.map(A.monthLabel) }),
    };
  }

  function render(params) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const p = M.point(params.pointId);
    if (!p) return `<div class="card">Point not found.</div>`;
    const snap = M.pointSnapshot(p.point_id, state.periodId);
    const order = params.order || [p.point_id];
    const idx = order.indexOf(p.point_id);
    const navBtns = `<button class="btn" data-nav="list">← ${esc(t('to_list'))}</button>
      <button class="btn" data-nav="prev" ${idx <= 0 ? 'disabled' : ''}>‹ ${esc(t('previous'))}</button>
      <span class="muted small">${idx + 1} / ${order.length}</span>
      <button class="btn" data-nav="next" ${idx < 0 || idx >= order.length - 1 ? 'disabled' : ''}>${esc(t('next'))} ›</button>
      <button class="btn primary" data-nav="board">${esc(t('action_board'))} (A-03)</button>`;
    if (!snap) {
      return `<div class="page-head"><h1>A-02 ${esc(t('scr_A02'))}</h1><div class="actions">${navBtns}</div></div>
        <div class="card"><div class="placeholder">${esc(p.point_id)} — ${esc(t('raised'))} ${esc(A.periodLabel(p.raised_period_id))}</div></div>`;
    }
    const row = M.pointRow(p.point_id, state.periodId, state.orgId);
    const causePoints = p.parent_point_id ? [p.point_id] : M.pointChildren(p.point_id).map((c) => c.point_id);
    const causes = A.db.app_point_cause.filter((c) => causePoints.includes(c.point_id) && c.as_of_period_id <= state.periodId);
    const actions = M.actionsForPoint(p.point_id).filter((a) => !p.parent_point_id || M.inScope(a.owner_org_id, state.orgId));
    if (selectedAction && !actions.some((a) => a.action_id === selectedAction)) selectedAction = null;
    const sel = selectedAction && M.action(selectedAction);
    const can = sel && A.canDecide(sel);
    const ind = indicator(p);
    const dimLabel = t('dim_' + p.gap_dimension);

    const impactCard = (m) => {
      const applicable = row.orgs.some((o) => M.isApplicable(o, m));
      if (!applicable) return `<div class="kpi na"><div class="label">${esc(t(m))}</div><div class="value">${esc(t('na'))}</div></div>`;
      const v = snap.impacts[m];
      return `<div class="kpi"><div class="label">${esc(t(m))} · ${esc(t('impact'))}</div><div class="value ${A.tone(m, v)}">${fmtSigned(v)}</div>
        <div class="sub muted small">${esc(t('vs_prev_short'))} ${row.vsPrev[m] === null ? '–' : fmtSigned(row.vsPrev[m])}</div></div>`;
    };
    const actionRows = actions.map((a) => {
      const tot = M.actionTotals(a.action_id, state.periodId, 'OP');
      const last = M.actionDecisions(a.action_id).slice(-1)[0];
      return `<tr class="main-row ${a.action_id === selectedAction ? 'selected' : ''}" tabindex="0" data-action="${a.action_id}">
        <td><span class="id">${a.action_id}</span></td>
        <td>${A.actionName(a)}</td>
        <td><span class="tag ${a.origin === 'AI' ? 'ai' : 'user'}">${esc(t('origin_' + a.origin))}</span></td>
        <td>${esc(A.orgName(a.owner_org_id))}</td>
        <td class="num">${fmt(tot.planAnnual)}</td>
        <td><span class="tag st-${a.decision_state}">${esc(t('d_' + a.decision_state))}</span>
          ${a.decision_state === 'ON_HOLD' && a.hold_until_period_id ? `<div class="small muted">→ ${esc(A.periodLabel(a.hold_until_period_id))}</div>` : ''}
          ${a.decision_state === 'REJECTED' && last && last.reason ? `<div class="small muted" title="${esc(last.reason)}">${esc(last.reason.slice(0, 48))}${last.reason.length > 48 ? '…' : ''}</div>` : ''}</td>
        <td>${esc(t('e_' + a.execution_state))}</td>
        <td>${last ? `${esc(A.userName(last.decided_by))}<div class="small muted">${esc(String(last.decided_at).slice(0, 10))}</div>` : '–'}</td>
      </tr>`;
    }).join('');

    return `
      <div class="page-head">
        <h1>A-02 ${esc(t('scr_A02'))}</h1>
        <div class="actions">${navBtns}</div>
      </div>
      <div class="card">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="id" style="font-size:14px">${p.point_id}</span>
          <span class="tag ${p.point_type === 'ISSUE' ? 'issue' : 'opp'}">${esc(t(p.point_type === 'ISSUE' ? 'issue' : 'opportunity'))}</span>
          <strong style="font-size:15px">${A.pointTitle(p)}</strong>
          <span class="tag">${esc(t('st_' + p.status))}</span>
          <span class="muted small">${esc(t('orgs'))}: ${row.orgs.map((o) => esc(A.orgName(o))).join(', ')} · ${esc(t('raised'))} ${esc(A.periodLabel(p.raised_period_id))} · ${esc(A.ytdLabel())}</span>
        </div>
      </div>
      <div class="grid" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:14px">
        ${METRICS.map(impactCard).join('')}
        <div class="kpi" style="border-color:var(--border-strong)"><div class="label">${esc(t('overall_impact'))} · ${esc(t('annual_op_impact'))}</div>
          <div class="value ${row.overall < 0 ? 'bad' : 'good'}">${fmtSigned(row.overall)}</div>
          <div class="sub muted small">${esc(t('vs_init_short'))} ${row.overallVsInit === null ? '–' : fmtSigned(row.overallVsInit)} · ${esc(t('vs_prev_short'))} ${row.overallVsPrev === null ? '–' : fmtSigned(row.overallVsPrev)}</div></div>
      </div>
      <div class="grid c2">
        <div class="card"><h2>${esc(t('gap_chart', { dim: dimLabel }))}</h2>${A.Chart.hbar(gapItems(p))}</div>
        <div class="card"><h2>${esc(t('indicator_chart', { name: ind.name }))}</h2>${ind.html}</div>
      </div>
      <div class="card">
        <h2>${esc(t('causes'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
        <div class="causes">${causes.map((c) => `<div class="cause">
            <div>${A.aiText(c.comment_id)} <span class="tag">${esc(A.orgName(M.point(c.point_id).org_id))}</span></div>
            <div class="num ${c.impact_op < 0 ? 'bad' : 'good'}"><b>${fmtSigned(c.impact_op)}</b> <span class="small muted">${esc(t('OP'))}</span></div>
            <div class="q">${esc(t('quantity'))}: ${fmtSigned(c.quantity_value)} ${esc(c.quantity_unit)}</div><div></div>
            <div class="ev">${esc(t('evidence'))}: ${esc(c.evidence_ref)}</div></div>`).join('') || '<span class="muted">–</span>'}</div>
      </div>
      <div class="card">
        <h2>${esc(t('proposed_actions'))} <span class="right hint">${esc(t('dblclick_hint'))}</span></h2>
        <div class="filters">
          <button class="btn" data-decide="ADOPT" ${sel && can && ['PROPOSED', 'ON_HOLD', 'REJECTED'].includes(sel.decision_state) ? '' : 'disabled'}>✓ ${esc(t('adopt'))}</button>
          <button class="btn danger" data-decide="REJECT" ${sel && can && sel.decision_state !== 'REJECTED' && sel.decision_state !== 'ADOPTED' ? '' : 'disabled'}>✕ ${esc(t('reject'))}</button>
          <button class="btn" data-decide="HOLD" ${sel && can && sel.decision_state === 'PROPOSED' ? '' : 'disabled'}>⏸ ${esc(t('hold'))}</button>
          <button class="btn" data-decide="CANCEL_ADOPTION" ${sel && can && sel.decision_state === 'ADOPTED' ? '' : 'disabled'}>${esc(t('cancel_adoption'))}</button>
          ${sel && !can ? `<span class="small bad">${esc(t('no_permission'))}</span>` : ''}
          <span style="flex:1"></span>
          <button class="btn primary" data-add>${esc(t('add_action'))}</button>
        </div>
        <div class="table-wrap"><table class="grid-table">
          <thead><tr><th>${esc(t('action_id'))}</th><th>${esc(t('title'))}</th><th>${esc(t('source'))}</th><th>${esc(t('owner'))}</th>
            <th class="num">${esc(t('annual_planned'))}</th><th>${esc(t('decision'))}</th><th>${esc(t('state'))}</th><th>${esc(t('decider'))}</th></tr></thead>
          <tbody>${actionRows || `<tr><td colspan="8" class="muted">–</td></tr>`}</tbody>
        </table></div>
      </div>`;
  }

  function decisionDialog(actionId, decision) {
    const { t, esc } = A;
    const open = A.M.fyPeriods(A.M.period(A.state.periodId).fiscal_year).filter((p) => p > A.state.periodId);
    const field = decision === 'REJECT'
      ? `<label class="muted small">${esc(t('reason'))} (${esc(t('required'))})</label><textarea id="dlg-reason" rows="3"></textarea>`
      : `<label class="muted small">${esc(t('hold_until'))} (${esc(t('required'))})</label>
         <select id="dlg-hold"><option value=""></option>${open.map((p) => `<option value="${p}">${esc(A.periodLabel(p))}</option>`).join('')}</select>`;
    A.openModal(`<header><h3>${esc(t(decision === 'REJECT' ? 'reject' : 'hold'))} · <span class="id">${actionId}</span></h3><button class="btn ghost x" data-close>✕</button></header>
      <div class="body">${field}</div>
      <footer><button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="dlg-ok" disabled>${esc(t('confirm'))}</button></footer>`, {
      small: true,
      onMount(wrap, close) {
        const input = wrap.querySelector('#dlg-reason, #dlg-hold');
        const ok = wrap.querySelector('#dlg-ok');
        input.addEventListener('input', () => (ok.disabled = !input.value.trim()));
        input.addEventListener('change', () => (ok.disabled = !input.value.trim()));
        ok.addEventListener('click', () => {
          const done = A.decide(actionId, decision, decision === 'REJECT' ? { reason: input.value.trim() } : { holdUntil: Number(input.value) });
          if (done) { close(); A.toast(t('decision_saved', { id: actionId, d: t(decision === 'REJECT' ? 'd_REJECTED' : 'd_ON_HOLD') })); A.render(); }
        });
      },
    });
  }

  function mount(root, params) {
    const order = params.order || [params.pointId];
    const idx = order.indexOf(params.pointId);
    root.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.nav;
      if (n === 'list') A.go('A01');
      if (n === 'board') A.go('A03');
      if (n === 'prev' && idx > 0) { selectedAction = null; A.go('A02', { pointId: order[idx - 1], order }); }
      if (n === 'next' && idx < order.length - 1) { selectedAction = null; A.go('A02', { pointId: order[idx + 1], order }); }
    }));
    root.querySelectorAll('tr[data-action]').forEach((tr) => {
      tr.addEventListener('click', () => { selectedAction = tr.dataset.action; A.render(); });
      tr.addEventListener('dblclick', () => A.openActionModal({ pointId: params.pointId, actionId: tr.dataset.action }));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') A.openActionModal({ pointId: params.pointId, actionId: tr.dataset.action }); });
    });
    root.querySelectorAll('[data-decide]').forEach((b) => b.addEventListener('click', () => {
      if (!selectedAction) { A.toast(A.t('select_action_first'), true); return; }
      const d = b.dataset.decide;
      if (d === 'REJECT' || d === 'HOLD') { decisionDialog(selectedAction, d); return; }
      if (A.decide(selectedAction, d)) {
        A.toast(d === 'ADOPT' ? A.t('registered_board', { id: selectedAction }) : A.t('decision_saved', { id: selectedAction, d: A.t('d_PROPOSED') }));
        A.render(); // stays on A-02 (README §3.2: adoption registers to A-03 without navigating away)
      }
    }));
    const add = root.querySelector('[data-add]');
    if (add) add.addEventListener('click', () => A.openActionModal({ pointId: params.pointId, actionId: null }));
  }

  A.SCREENS.A02 = { render, mount };
})();
