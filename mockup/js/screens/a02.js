/* A-02 Insight Detail (internally: Point) — README §3.2 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  let selectedAction = null;

  /** Metrics this Point moves (non-zero YTD impact, applicable to one of its organizations). */
  function impactedMetrics(p, snap, row) {
    const list = METRICS.filter((m) => Math.abs(snap.impacts[m] || 0) >= 0.05 && row.orgs.some((o) => A.M.isApplicable(o, m)));
    return list.length ? list : [p.indicator_metric_id];
  }

  /**
   * Waterfall (concept slide 11, graph ①): Metric budget (YTD) for the Point's organizations → the difference of each
   * customer / product / account → Metric actual. Steps are in Metric terms (a cost overrun lowers profit); the Point's
   * own customers / accounts and the largest other differences get their own step, the rest fold into "Others".
   */
  function waterfallData(p, metric) {
    const M = A.M, pid = A.state.periodId;
    const ytd = M.ytdPeriods(pid);
    const filter = JSON.parse(p.indicator_filter || '{}');
    const keyCol = { CUSTOMER: 'customer_id', PRODUCT: 'product_id', ACCOUNT: 'account_id' }[p.gap_dimension];
    const acc = {}; // key → { bud, act } in Metric terms
    M.pointOrgs(p.point_id).forEach((o) => {
      const act = M.factGroup('ACT', ytd, o, metric, keyCol);
      const bud = M.factGroup('BUD', ytd, o, metric, keyCol);
      new Set([...Object.keys(act), ...Object.keys(bud)]).forEach((k) => {
        acc[k] = acc[k] || { bud: 0, act: 0 };
        acc[k].bud += bud[k] || 0; acc[k].act += act[k] || 0;
      });
    });
    let highlight;
    if (p.gap_dimension === 'CUSTOMER') highlight = new Set(filter.customer_id || []);
    else if (p.gap_dimension === 'ACCOUNT') highlight = new Set(filter.account_id || []);
    else highlight = new Set(filter.product_id || A.db.fact_financial.filter((f) => (filter.customer_id || []).includes(f.customer_id)).map((f) => f.product_id));
    const label = (k) => (keyCol === 'customer_id' ? (A.db.dim_customer.find((c) => c.customer_id === k) || {}).customer_name
      : keyCol === 'product_id' ? (A.db.dim_product.find((c) => c.product_id === k) || {}).product_name
        : (A.db.dim_account.find((c) => c.account_id === k) || {}).account_name) || k;
    const all = Object.entries(acc).map(([k, v]) => ({ key: k, label: label(k), budget: v.bud, actual: v.act, diff: M.r2(v.act - v.bud), highlight: highlight.has(k) }));
    const budget = M.r2(all.reduce((s, r) => s + r.budget, 0));
    const actual = M.r2(all.reduce((s, r) => s + r.actual, 0));
    const moving = all.filter((r) => Math.abs(r.diff) >= 0.05).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
    const own = moving.filter((r) => r.highlight);
    const steps = own.concat(moving.filter((r) => !r.highlight).slice(0, Math.max(0, 5 - own.length)));
    const rest = M.r2(actual - budget - steps.reduce((s, r) => s + r.diff, 0));
    steps.sort((a, b) => (b.highlight - a.highlight) || (Math.abs(b.diff) - Math.abs(a.diff)));
    if (Math.abs(rest) >= 0.05) steps.push({ key: 'OTHER', label: A.t('a2_others'), diff: rest, highlight: false });
    return { budget, actual, steps };
  }

  function waterfallSvg(wf, metric) {
    const { esc, fmt, fmtSigned, t } = A;
    if (!wf.steps.length && !wf.budget && !wf.actual) return `<div class="placeholder">–</div>`;
    const bars = [{ label: t('budget'), kind: 'total', from: 0, to: wf.budget }];
    let run = wf.budget;
    wf.steps.forEach((s) => { bars.push({ label: s.label, kind: 'step', from: run, to: run + s.diff, diff: s.diff, highlight: s.highlight }); run += s.diff; });
    bars.push({ label: t('actual'), kind: 'total', from: 0, to: wf.actual });
    const W = 560, H = 260, pad = { l: 44, r: 8, t: 22, b: 48 };
    const vals = bars.flatMap((b) => [b.from, b.to]);
    let hi = Math.max(...vals, 0), lo = Math.min(...vals, 0);
    // Steps much smaller than the totals would be invisible from zero: start the axis under the lowest running total
    // and mark the total bars with a break so nobody reads their height from zero.
    const stepVals = bars.filter((b) => b.kind === 'step').flatMap((b) => [b.from, b.to]).concat([wf.budget, wf.actual]);
    const stepLo = Math.min(...stepVals);
    const broken = lo >= 0 && stepLo > 0 && (hi - stepLo) < hi * 0.35;
    if (broken) lo = Math.max(0, stepLo - (hi - stepLo) * 0.6);
    const nice = (x) => { const e = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9)))); return [1, 2, 2.5, 5, 10].map((m) => m * e).find((v) => v >= x); };
    const tick = nice((hi - lo) / 4);
    lo = Math.floor(lo / tick) * tick; hi = Math.ceil(hi / tick) * tick;
    const y = (v) => pad.t + (H - pad.t - pad.b) * (1 - (v - lo) / (hi - lo || 1));
    const n = bars.length, slot = (W - pad.l - pad.r) / n, bw = Math.min(46, slot * 0.62);
    const dir = A.db.dim_metric.find((x) => x.metric_id === metric).favorable_direction;
    const good = (b) => b.diff * dir >= 0;
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += tick) g += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
    g += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${y(Math.max(lo, Math.min(0, hi)))}" y2="${y(Math.max(lo, Math.min(0, hi)))}"/>`; // baseline (zero, or the axis floor)
    bars.forEach((b, i) => {
      const cx = pad.l + slot * i + slot / 2, x = cx - bw / 2;
      // Totals stand on zero (or on the axis floor when it is cut); steps float between the running totals.
      const base = broken ? lo : 0;
      const a0 = b.kind === 'total' ? base : b.from;
      const top = y(Math.max(a0, b.to));
      const bot = y(Math.min(a0, b.to));
      const h = Math.max(bot - top, 1.5);
      const col = b.kind === 'total' ? (i === 0 ? 'var(--chart-budget)' : 'var(--chart-actual)') : (good(b) ? 'var(--good)' : 'var(--bad)');
      const val = b.kind === 'total' ? String(fmt(b.to)).replace('-', '−') : fmtSigned(b.diff);
      g += `<rect x="${x}" y="${top}" width="${bw}" height="${h}" fill="${col}" rx="2"><title>${esc(b.label)}: ${val}</title></rect>`;
      g += `<text x="${cx}" y="${top - 5}" text-anchor="middle" class="wf-val ${b.kind === 'step' ? (good(b) ? 'good' : 'bad') : ''}">${val}</text>`;
      if (i < n - 1) { const nx = pad.l + slot * (i + 1) + slot / 2 - bw / 2; g += `<line class="wf-link" x1="${x + bw}" x2="${nx}" y1="${y(b.to)}" y2="${y(b.to)}"/>`; }
      // Up to two lines under the bar: break at a space (or a parenthesis), then shorten.
      const maxCh = Math.max(6, Math.floor(slot / 6.2));
      const cut = (x) => (x.length > maxCh ? x.slice(0, maxCh - 1) + '…' : x);
      const words = b.label.split(/\s+/);
      let l1 = '';
      while (words.length && (l1 + ' ' + words[0]).trim().length <= maxCh) l1 = (l1 + ' ' + words.shift()).trim();
      if (!l1) l1 = words.shift() || '';
      const lines = [cut(l1), cut(words.join(' '))].filter(Boolean);
      g += `<text x="${cx}" y="${H - pad.b + 15}" text-anchor="middle" class="${b.highlight || b.kind === 'total' ? 'wf-strong' : ''}">${lines.map((ln, k) => `<tspan x="${cx}" dy="${k ? 13 : 0}">${esc(ln)}</tspan>`).join('')}<title>${esc(b.label)}</title></text>`;
    });
    return `<svg class="chart wf" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(t('budget'))} ${fmt(wf.budget)} → ${esc(t('actual'))} ${fmt(wf.actual)}">${g}</svg>
      ${broken ? `<p class="hint">${esc(t('a2_axis_note'))}</p>` : ''}`;
  }

  /** Monthly budget / actual / prior year of one Metric for the Point's customers / products and organizations. */
  function indicator(p, metric) {
    const M = A.M, pid = A.state.periodId;
    const f = JSON.parse(p.indicator_filter || '{}');
    const fy = M.period(pid).fiscal_year;
    const months = M.fyPeriods(fy);
    const ytd = M.ytdPeriods(pid);
    const scopeOrg = p.parent_point_id ? p.org_id : 'CO';
    const orgs = M.pointOrgs(p.point_id);
    // Customer / product Points: the Metric for those customers. Account Points: the Metric for the Point's organizations
    // (the account itself is a step in the waterfall).
    const rowFilter = (r) => (!f.customer_id || f.customer_id.includes(r.customer_id))
      && (!f.product_id || f.product_id.includes(r.product_id))
      && (f.org_id ? f.org_id.includes(r.org_id) : f.account_id ? orgs.includes(r.org_id) : true);
    const v = (scen, ps) => M.r2(M.factValue(scen, ps, scopeOrg, metric, rowFilter));
    const name = f.customer_id
      ? f.customer_id.map((c) => A.db.dim_customer.find((x) => x.customer_id === c).customer_name).join(', ')
        + (f.product_id ? ' × ' + f.product_id.map((x) => (A.db.dim_product.find((y) => y.product_id === x) || {}).product_name).join(', ') : '')
      : orgs.map((o) => A.orgName(o)).join(', ');
    const bud = v('BUD', ytd), act = v('ACT', ytd), py = v('ACT', ytd.map((m) => m - 100));
    return {
      name, bud, act, py, diff: M.r2(act - bud),
      html: A.Chart.monthly([
        { name: A.t('budget'), type: 'bar', color: 'var(--chart-budget)', values: months.map((m) => v('BUD', [m])) },
        { name: A.t('actual'), type: 'bar', color: 'var(--chart-actual)', values: months.map((m) => (m <= pid ? v('ACT', [m]) : null)) },
        { name: A.t('prior_year'), type: 'line', color: 'var(--chart-py)', dash: true, values: months.map((m) => v('ACT', [m - 100])) },
      ], { labels: months.map(A.monthLabel) }),
    };
  }

  /** Cause impacts for the four Metrics (older data without the split shows OP only). */
  const causeImpact = (c, m) => ({ REV: c.impact_rev, GP: c.impact_gp, SGA: c.impact_sga, OP: c.impact_op }[m]);

  function render(params) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const p = M.point(params.pointId);
    if (!p) return `<div class="card">Insight not found.</div>`;
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
    // Every Metric this Insight moves gets its own row of graphs: waterfall (left) and monthly trend (right).
    const impacted = impactedMetrics(p, snap, row);
    const dimLabel = t('dim_' + p.gap_dimension);

    const impactCard = (m) => {
      const applicable = row.orgs.some((o) => M.isApplicable(o, m));
      if (!applicable) return `<div class="kpi na"><div class="label">${esc(t(m))}</div><div class="value">${esc(t('na'))}</div></div>`;
      const v = snap.impacts[m];
      return `<div class="kpi"><div class="label">${esc(t(m))} · ${esc(t('impact'))}</div><div class="value ${A.tone(m, v)}">${fmtSigned(v)}</div>
        <div class="sub muted small">${esc(t('vs_prev_short'))} ${row.vsPrev[m] === null ? '–' : fmtSigned(row.vsPrev[m])}</div></div>`;
    };
    const ytdStrip = (metric, ind) => `<div class="a2-ytd small">
      <span><span class="muted">${esc(t('budget'))}</span> <b>${fmt(ind.bud)}</b></span>
      <span><span class="muted">${esc(t('actual'))}</span> <b>${fmt(ind.act)}</b></span>
      <span><span class="muted">${esc(t('a2_diff'))}</span> <b class="${A.tone(metric, ind.diff)}">${fmtSigned(ind.diff)}</b></span>
      <span><span class="muted">${esc(t('prior_year'))}</span> <b>${fmt(ind.py)}</b></span>
      <span class="muted">${esc(A.ytdLabel())} · ${esc(t('jpy_m'))}</span></div>`;
    const graphRows = impacted.map((metric) => {
      const ind = indicator(p, metric);
      return `<div class="grid c2 a2-graphs" data-graph-metric="${metric}">
        <div class="card"><h2>${esc(t('a2_gap', { dim: dimLabel, metric: t(metric) }))}</h2>${waterfallSvg(waterfallData(p, metric), metric)}</div>
        <div class="card"><h2>${esc(t('a2_ind', { metric: t(metric), name: ind.name }))}</h2>${ytdStrip(metric, ind)}${ind.html}</div>
      </div>`;
    }).join('');
    const metricCell = (a, m) => {
      if (!M.actionTargets(a.action_id).includes(m)) return `<td class="num muted">–</td>`;
      const v = M.actionTotals(a.action_id, state.periodId, m).planAnnual;
      return `<td class="num ${A.tone(m, v)}">${fmtSigned(v)}</td>`;
    };
    const actionRows = actions.map((a) => {
      const last = M.actionDecisions(a.action_id).slice(-1)[0];
      return `<tr class="main-row ${a.action_id === selectedAction ? 'selected' : ''}" tabindex="0" data-action="${a.action_id}">
        <td><span class="id">${a.action_id}</span></td>
        <td>${A.actionName(a)}</td>
        <td><span class="tag ${a.origin === 'AI' ? 'ai' : 'user'}">${esc(t('origin_' + a.origin))}</span></td>
        <td>${esc(A.orgName(a.owner_org_id))}</td>
        <td class="nowrap">${esc(A.periodLabel(a.start_period_id))} – ${esc(A.periodLabel(a.end_period_id))}</td>
        ${METRICS.map((m) => metricCell(a, m)).join('')}
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
      ${graphRows}
      <div class="card">
        <h2>${esc(t('causes'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
        <div class="causes">${causes.map((c) => `<div class="cause">
            <div>${A.aiText(c.comment_id)} <span class="tag">${esc(A.orgName(M.point(c.point_id).org_id))}</span></div>
            <div class="a2-cause-m">${METRICS.filter((m) => causeImpact(c, m) !== undefined && causeImpact(c, m) !== null).map((m) => {
              const v = causeImpact(c, m);
              return `<span class="${m === 'OP' ? 'a2-op' : ''}"><span class="small muted">${esc(t(m))}</span> <b class="${A.tone(m, v)}">${fmtSigned(v)}</b></span>`;
            }).join('')}</div>
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
        <div class="table-wrap"><table class="grid-table a2-acts">
          <thead><tr><th rowspan="2">${esc(t('action_id'))}</th><th rowspan="2">${esc(t('title'))}</th><th rowspan="2">${esc(t('source'))}</th><th rowspan="2">${esc(t('owner'))}</th>
            <th rowspan="2">${esc(t('period'))}</th><th colspan="4" class="a2-grp">${esc(t('a2_planned_fy'))} (${esc(t('jpy_m'))})</th>
            <th rowspan="2">${esc(t('decision'))}</th><th rowspan="2">${esc(t('state'))}</th><th rowspan="2">${esc(t('decider'))}</th></tr>
            <tr>${METRICS.map((m) => `<th class="num">${esc(t(m))}</th>`).join('')}</tr></thead>
          <tbody>${actionRows || `<tr><td colspan="12" class="muted">–</td></tr>`}</tbody>
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
