/* F-01 Forecast — README §4.1, concept slide 48.
 * Numbers come from the ML notebook output (baseline = option ①), adopted Actions (option ②, progress-based outlook)
 * and included Individual Factors (option ③ = landing). Toggling a factor recalculates in the browser — no notebook
 * or AI call. Save (confirm) freezes a new version for the department. Company / division = Σ latest confirmed versions. */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const ui = { metric: 'OP', scenario: 'LANDING', view: {} }; // view: org|period → version id ('' = live)
  const selections = {}; // org|period → { factorId: included } (unsaved simulation)

  const key = () => `${A.state.orgId}|${A.state.periodId}`;
  const isLeaf = () => A.M.org(A.state.orgId).is_leaf;
  function selection() {
    const k = key();
    if (!selections[k]) selections[k] = A.M.defaultFactorSelection(A.state.orgId, A.state.periodId);
    return selections[k];
  }
  F01Api(); // expose helpers for P-02

  /** Which data the screen shows: live calculation, a confirmed version, or the read-only roll-up. */
  function context() {
    const { M, state } = A;
    if (!isLeaf()) return { mode: 'ROLLUP' };
    const run = M.modelRun(state.periodId);
    const versions = M.versionsFor(state.orgId).filter((v) => v.as_of_period_id <= state.periodId);
    let vid = ui.view[key()];
    if (vid === undefined) vid = run ? '' : (versions[0] || {}).forecast_version_id || '';
    if (vid && !versions.some((v) => v.forecast_version_id === vid)) vid = '';
    if (!vid && !run) return { mode: 'NONE', versions };
    return vid ? { mode: 'VERSION', vid, version: M.version(vid), versions, run } : { mode: 'LIVE', versions, run };
  }
  function figures(ctx, metric) {
    const { M, state } = A;
    if (ctx.mode === 'ROLLUP') return M.forecastRollup(state.orgId, state.periodId, metric);
    if (ctx.mode === 'VERSION') return M.versionFigures(ctx.vid, metric);
    return M.forecastLive(state.orgId, state.periodId, metric, selection());
  }
  function monthly(ctx, metric) {
    const { M, state } = A;
    const fy = M.period(state.periodId).fiscal_year;
    if (ctx.mode === 'ROLLUP') return M.forecastMonthlyRollup(state.orgId, state.periodId, metric);
    if (ctx.mode === 'VERSION') return M.versionMonthly([ctx.vid], metric, fy);
    return M.forecastMonthlyLive(state.orgId, state.periodId, metric, selection());
  }
  const scenValue = (f, s) => (s === 'BASE' ? f.baseline : s === 'ACTIONS' ? f.withActions : f.landing);
  const verLabel = (v) => A.t('ver_label', { n: v.version_no, date: A.periodLabel(v.as_of_period_id) });
  const confirmedOn = (v) => new Intl.DateTimeFormat(A.state.lang === 'en' ? 'en-US' : undefined, { month: 'numeric', day: 'numeric' }).format(new Date(v.confirmed_at));

  /* ------------------------------------------------------------------ parts */
  function kpiCard(ctx, metric) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const applicable = ctx.mode === 'ROLLUP' ? M.leafOrgs(state.orgId).some((o) => M.isApplicable(o, metric)) : M.isApplicable(state.orgId, metric);
    if (!applicable) return `<div class="kpi na"><div class="label">${esc(t(metric))}</div><div class="value">${esc(t('na'))}</div><div class="sub faint">&nbsp;</div></div>`;
    const f = figures(ctx, metric);
    const v = scenValue(f, ui.scenario);
    const varc = A.M.r2(v - f.budget);
    const cls = A.tone(metric, varc);
    return `<div class="kpi selectable ${metric === ui.metric ? 'selected' : ''}" data-metric="${metric}" tabindex="0">
      <div class="label">${esc(t(metric))} · ${esc(t('scen_short_' + ui.scenario))}</div>
      <div class="value">${fmt(v)}<span class="unit">${esc(t('jpy_m'))}</span></div>
      <div class="sub"><span class="pill ${cls}">${fmtSigned(varc)}</span><span class="muted">${esc(t('vs_budget'))} (${fmt(f.budget)})</span>
        ${cls === 'good' && metric === 'SGA' ? `<span class="good small">${esc(t('favorable'))}</span>` : ''}</div></div>`;
  }

  function scenarioBar(ctx) {
    const { t, esc, fmt } = A;
    const f = figures(ctx, ui.metric);
    const btn = (s, n, v) => `<button class="seg-btn sc-${s} ${ui.scenario === s ? 'on' : ''}" data-scen="${s}"><i class="sw"></i><span class="n">${n}</span>${esc(t('scen_' + s))}<b>${fmt(v)}</b></button>`;
    return `<div class="seg" role="group" aria-label="${esc(t('scenario'))}">
      ${btn('BASE', '①', f.baseline)}${btn('ACTIONS', '②', f.withActions)}${btn('LANDING', '③', f.landing)}</div>`;
  }

  function trendChart(ctx) {
    const { t, M, state } = A;
    const rows = monthly(ctx, ui.metric);
    const labels = rows.map((r) => A.monthLabel(r.period_id));
    const lastActual = rows.map((r) => r.actual).reduce((i, v, idx) => (v !== null && v !== undefined ? idx : i), -1);
    const join = (k) => rows.map((r, i) => (i === lastActual ? r.actual : r.actual === null || r.actual === undefined ? r[k] : null));
    const s = ui.scenario;
    const series = [
      { name: t('budget'), type: 'line', color: 'var(--chart-budget)', dash: '2 3', values: rows.map((r) => r.budget) },
      { name: t('actual'), type: 'line', color: 'var(--fc-actual)', width: 2.5, values: rows.map((r) => r.actual) },
      { name: '① ' + t('scen_BASE'), type: 'line', color: 'var(--fc-base)', dash: '5 3', width: s === 'BASE' ? 2.5 : 2, endLabel: true, values: join('baseline') },
    ];
    if (s !== 'BASE') series.push({ name: '② ' + t('scen_ACTIONS'), type: 'line', color: 'var(--fc-actions)', dash: '5 3', width: s === 'ACTIONS' ? 2.5 : 2, endLabel: true, values: join('withActions') });
    if (s === 'LANDING') series.push({ name: '③ ' + t('scen_LANDING'), type: 'line', color: 'var(--fc-landing)', width: 2.8, endLabel: true, values: join('forecast') });
    return A.Chart.monthly(series, { labels, width: 620, height: 250, zero: false });
  }

  function bridge(ctx) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const f = figures(ctx, ui.metric);
    const m = ui.metric;
    // Comparison column: live → latest confirmed version; version → previous version.
    let cmp = null, cmpLabel = '';
    if (ctx.mode === 'LIVE' && ctx.versions[0]) { cmp = M.versionFigures(ctx.versions[0].forecast_version_id, m); cmpLabel = verLabel(ctx.versions[0]); }
    if (ctx.mode === 'VERSION') {
      const prev = ctx.versions.find((v) => v.version_no < ctx.version.version_no);
      if (prev) { cmp = M.versionFigures(prev.forecast_version_id, m); cmpLabel = verLabel(prev); }
    }
    const range = ctx.mode !== 'VERSION' && M.modelRun(state.periodId) ? M.baselineRange(state.orgId, m) : null;
    const nAct = ctx.mode === 'LIVE' ? f.actionCount : ctx.mode === 'VERSION' ? A.db.app_forecast_version_action.filter((x) => x.forecast_version_id === ctx.vid).length : M.forecastActions(state.orgId, state.periodId).length;
    const nFac = ctx.mode === 'LIVE' ? f.factorCount : ctx.mode === 'VERSION' ? A.db.app_forecast_factor_selection.filter((x) => x.forecast_version_id === ctx.vid && x.is_included).length : null;
    const row = (cls, label, k, signed, extra = '') => {
      const v = f[k], c = cmp ? cmp[k] : null;
      const show = (x) => (signed ? fmtSigned(x) : fmt(x));
      return `<tr class="${cls}"><td>${label}${extra}</td><td class="num">${show(v)}</td>
        ${cmp ? `<td class="num muted">${show(c)}</td><td class="num ${A.tone(m, M.r2(v - c))}">${Math.abs(v - c) < 0.005 ? '<span class="faint">–</span>' : fmtSigned(M.r2(v - c))}</td>` : ''}</tr>`;
    };
    const head = ctx.mode === 'ROLLUP' ? t('rollup_total') : ctx.mode === 'VERSION' ? verLabel(ctx.version) : t('live');
    return `<table class="grid-table bridge">
      <thead><tr><th>${esc(t('landing_breakdown'))} · ${esc(t(m))}</th><th class="num">${esc(head)}</th>${cmp ? `<th class="num">${esc(cmpLabel)}</th><th class="num">Δ</th>` : ''}</tr></thead>
      <tbody>
        ${row('b-budget', esc(t('budget_original')), 'budget', false)}
        ${row('b-base', '① ' + esc(t('scen_BASE_long')), 'baseline', false, range ? `<div class="small muted">${esc(t('range80', { lo: fmt(range.low), hi: fmt(range.high) }))}</div>` : '')}
        ${row('b-add', '+ ' + esc(t('action_contribution', { n: nAct })), 'action', true)}
        ${row('b-sub', '= ② ' + esc(t('scen_ACTIONS')), 'withActions', false)}
        ${row('b-add', '+ ' + esc(nFac === null ? t('factor_contribution_plain') : t('factor_contribution', { n: nFac })), 'factor', true)}
        ${row('b-landing', '= ③ ' + esc(t('scen_LANDING')), 'landing', false)}
        ${row('b-var', esc(t('budget_variance')), 'variance', true)}
      </tbody></table>`;
  }

  function modelCard(ctx) {
    const { t, esc, fmt, M, state } = A;
    const run = ctx.mode === 'VERSION' ? (A.db.ml_model_run || []).find((r) => r.forecast_run_id === ctx.version.baseline_run_id) : M.modelRun(state.periodId);
    if (!run) return '';
    const mape = run[`backtest_mape_${ui.metric.toLowerCase()}`];
    return `<div class="model-note">
      <div><span class="tag ml">${esc(t('ml_model'))}</span> <b>${esc(run.model_name)}</b> <span class="muted">· ${esc(run.forecast_run_id)} · ${esc(run.notebook)} · ${esc(t('ml_trained', { n: run.training_months, to: A.periodLabel(run.training_to) }))}</span></div>
      <div class="muted small">${esc(t('ml_backtest', { m: t(ui.metric), v: fmt(mape) }))} · ${esc(t('ml_target_adj'))}</div>
    </div>`;
  }



  function actionsTable(ctx) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const m = ui.metric;
    let list;
    if (ctx.mode === 'VERSION') {
      list = A.db.app_forecast_version_action.filter((x) => x.forecast_version_id === ctx.vid).map((x) => ({ a: M.action(x.action_id), frozenOp: x.outlook_effect }));
    } else list = M.forecastActions(state.orgId, state.periodId).map((a) => ({ a }));
    let total = 0;
    const body = list.map(({ a, frozenOp }) => {
      const tot = M.actionTotals(a.action_id, state.periodId, m);
      const prog = M.actionProgress(a.action_id, state.periodId);
      const outlook = ctx.mode === 'VERSION' ? (m === 'OP' ? frozenOp : null) : tot.outlookFY;
      total += outlook || 0;
      const excl = M.actionExclusions(a.action_id).map((x) => x.factor_id);
      return `<tr class="main-row" data-action="${a.action_id}" title="${esc(t('open_in_a02'))}">
        <td><span class="id">${a.action_id}</span></td><td>${A.actionName(a)}</td>
        <td class="num">${prog ? prog.progress_pct + '%' : '–'}</td>
        <td>${prog ? `<span class="tag ps-${prog.ai_status}">${esc(t('ps_' + prog.ai_status))}</span>` : ''}${a.execution_state === 'COMPLETED' && (!prog || prog.ai_status !== 'COMPLETED') ? ` <span class="tag">${esc(t('e_COMPLETED'))}</span>` : ''}</td>
        <td class="num">${fmtSigned(tot.planAnnual)} → <b>${outlook === null ? '–' : fmtSigned(outlook)}</b></td>
        <td class="num">${fmtSigned(tot.actualToDate)}</td>
        <td>${excl.length ? excl.map((x) => `<span class="tag warn">${esc(t('factor_excluded', { id: x }))}</span>`).join(' ') : '<span class="faint">—</span>'}</td></tr>`;
    }).join('');
    return `<div class="card"><h2>${esc(t('basis_actions'))} · ${esc(t(m))} <span class="right hint">${esc(t('basis_actions_hint'))}</span></h2>
      <div class="table-wrap"><table class="grid-table">
      <thead><tr><th>${esc(t('action_id'))}</th><th>${esc(t('action'))}</th><th class="num">${esc(t('progress'))}</th><th>${esc(t('status'))}</th>
        <th class="num">${esc(t('contribution_plan_outlook'))}</th><th class="num">${esc(t('actual_to_date'))}</th><th>${esc(t('factors'))}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="7" class="muted">${esc(t('no_adopted_actions'))}</td></tr>`}
        ${body ? `<tr class="other-row total-row"><td colspan="4">${esc(t('units_total'))} (= ${esc(t('action_contribution_short'))})</td><td class="num">${fmtSigned(M.r2(total))}</td><td colspan="2"></td></tr>` : ''}</tbody></table></div>
      <p class="hint" style="margin-top:6px">${esc(t('outlook_note'))}</p></div>`;
  }

  function factorsTable(ctx) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const m = ui.metric;
    const factors = M.factorsFor(state.orgId, state.periodId);
    const fyP = M.fyPeriods(M.period(state.periodId).fiscal_year);
    const frozen = ctx.mode === 'VERSION' ? new Map(A.db.app_forecast_factor_selection.filter((x) => x.forecast_version_id === ctx.vid).map((x) => [x.factor_id, x.is_included])) : null;
    const rollSel = ctx.mode === 'ROLLUP' ? (() => {
      const mp = new Map();
      M.leafOrgs(state.orgId).forEach((o) => { const v = M.latestVersion(o, state.periodId); if (v) A.db.app_forecast_factor_selection.filter((x) => x.forecast_version_id === v.forecast_version_id).forEach((x) => mp.set(x.factor_id, x.is_included)); });
      return mp;
    })() : null;
    const sel = ctx.mode === 'LIVE' ? selection() : null;
    let total = 0;
    const body = factors.map((f) => {
      const on = sel ? !!sel[f.factor_id] : frozen ? !!frozen.get(f.factor_id) : !!(rollSel && rollSel.get(f.factor_id));
      const amt = M.factorAmount(f.factor_id, state.orgId, m, fyP);
      if (on) total += amt;
      const ft = M.factorType(f.category);
      const drv = f.input_mode === 'DRIVER' && f.driver_id ? M.driver(f.driver_id) : null;
      const input = drv
        ? `<span class="tag ml">${esc(t('input_driver'))}</span> ${esc(drv.value_type === 'LEVEL' ? `${fmt(f.driver_from, drv.decimals)} → ${fmt(f.driver_to, drv.decimals)} ${drv.unit}` : `${fmtSigned(f.driver_to - f.driver_from)}%`)}`
        : `<span class="tag">${esc(t('input_amount'))}</span>`;
      const period = f.start_period_id === f.end_period_id ? A.monthLabel(f.start_period_id) : `${A.monthLabel(f.start_period_id)}–${A.monthLabel(f.end_period_id)}`;
      return `<tr class="main-row ${on ? '' : 'off'}" data-factor="${f.factor_id}">
        <td><input type="checkbox" data-toggle="${f.factor_id}" ${on ? 'checked' : ''} ${ctx.mode === 'LIVE' ? '' : 'disabled'} aria-label="${esc(t('include'))} ${f.factor_id}"></td>
        <td><span class="id">${f.factor_id}</span></td><td>${esc(t('ft_' + ft.category))}</td><td>${f.title ? esc(f.title) : A.aiText(f.title_comment_id)}</td>
        <td class="nowrap">${input}</td><td class="nowrap">${esc(period)}</td>
        <td class="num ${A.tone(m, amt)}">${M.isApplicable(state.orgId, m) || !isLeaf() ? fmtSigned(amt) : '<span class="faint">' + esc(t('na')) + '</span>'}</td>
        <td class="nowrap muted">${esc(A.monthLabel(f.registered_period_id))} · ${esc(A.userName(f.created_by).split(' ')[0])}</td></tr>`;
    }).join('');
    const canAdd = ctx.mode === 'LIVE' && A.canEditOrg(state.orgId);
    return `<div class="card"><h2>${esc(t('individual_factors'))} · ${esc(t(m))}
        <span class="right hint">${esc(t('factors_hint'))}</span>
        ${canAdd ? `<button class="btn primary small" data-add-factor>+ ${esc(t('add_factor'))}</button>` : ''}</h2>
      <div class="table-wrap"><table class="grid-table factors">
      <thead><tr><th>${esc(t('include_short'))}</th><th>${esc(t('factor_id'))}</th><th>${esc(t('type'))}</th><th>${esc(t('content'))}</th><th>${esc(t('input'))}</th>
        <th>${esc(t('period'))}</th><th class="num">${esc(t(m))}</th><th>${esc(t('entered'))}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="8" class="muted">${esc(t('no_factors'))}</td></tr>`}
        ${body ? `<tr class="other-row total-row"><td colspan="6">${esc(t('factors_total'))}</td><td class="num">${fmtSigned(M.r2(total))}</td><td></td></tr>` : ''}</tbody></table></div></div>`;
  }

  function aiCard(ctx) {
    const { t, esc, fmt, M, state } = A;
    const c = A.db.ai_comment.find((x) => x.comment_type === 'F01_EXPLANATION' && x.org_id === state.orgId && x.as_of_period_id === state.periodId && x.is_current);
    let notice = '';
    if (c && c.basis_landing_op !== undefined && ctx.mode !== 'VERSION') {
      const now = figures(ctx, 'OP').landing;
      if (Math.abs(now - c.basis_landing_op) > 0.05) notice = `<div class="warnbox">${esc(t('ai_outdated', { a: fmt(c.basis_landing_op), b: fmt(now) }))}</div>`;
    }
    // The comment only (the generated text already names the most influential drivers).
    return `<div class="card"><h2>${esc(t('f01_ai_comment'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
      <div class="ai-box f1-comment">${c ? A.aiText(c.comment_id) : `<span class="muted">${esc(t('no_ai_comment'))}</span>`}</div>${notice}</div>`;
  }

  /* ----------------------------------------------------------------- render */
  function render() {
    const { t, esc, M, state } = A;
    const ctx = context();
    const fy = M.period(state.periodId).fiscal_year;
    let head = '';
    if (ctx.mode === 'ROLLUP') {
      const roll = M.forecastRollup(state.orgId, state.periodId, 'OP');
      head = `<span class="tag">${esc(t('rollup_readonly'))}</span>
        <span class="small muted">${roll.parts.map((p) => `${esc(M.org(p.org_id).org_code)} ${p.version ? esc(verLabel(p.version)) : `<span class="bad">${esc(t('not_confirmed'))}</span>`}`).join(' · ')}</span>`;
    } else if (ctx.mode !== 'NONE') {
      const opts = (ctx.run ? [`<option value="" ${ctx.mode === 'LIVE' ? 'selected' : ''}>${esc(t('live_option'))}</option>`] : [])
        .concat(ctx.versions.map((v) => `<option value="${v.forecast_version_id}" ${ctx.vid === v.forecast_version_id ? 'selected' : ''}>${esc(verLabel(v))} · ${esc(t('confirmed_on', { d: confirmedOn(v), u: A.userName(v.confirmed_by).split(' ')[0] }))}</option>`));
      const next = (M.versionsFor(state.orgId)[0] || { version_no: 0 }).version_no + 1;
      const can = A.canConfirm(state.orgId);
      head = `<label class="muted small" for="f01-version">${esc(t('version'))}</label><select id="f01-version" class="sel">${opts.join('')}</select>
        ${ctx.mode === 'LIVE' ? `<button class="btn primary" data-confirm ${can ? '' : 'disabled'} title="${esc(can ? '' : t('no_confirm_permission'))}">${esc(t('save_confirm', { n: next }))}</button>` : ''}`;
    }
    const top = `<div class="page-head"><h1>F-01 ${esc(t('scr_F01'))}</h1>
        <span class="scope">${esc(t('fy_asof', { fy, m: A.periodLabel(state.periodId) }))} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">${head}</div></div>`;
    if (ctx.mode === 'NONE') {
      return top + `<div class="card"><div class="placeholder">${esc(t('no_forecast_run', { m: A.periodLabel(state.periodId) }))}</div></div>`;
    }
    const banner = ctx.mode === 'VERSION' ? `<div class="infobox">${esc(t(ctx.run ? 'viewing_version' : 'viewing_version_norun', { v: verLabel(ctx.version) }))}</div>`
      : ctx.mode === 'LIVE' && !ctx.run ? '' : '';
    return top + banner + `
      <div class="grid k4" style="margin-bottom:10px">${METRICS.map((mt) => kpiCard(ctx, mt)).join('')}</div>
      <div class="scen-row"><span class="muted small">${esc(t('scenario'))}</span>${scenarioBar(ctx)}</div>
      <div class="grid f01-main">
        <div class="card"><h2>${esc(t('monthly_trend', { m: t(ui.metric) }))}</h2>${trendChart(ctx)}</div>
        <div class="card">${bridge(ctx)}${modelCard(ctx)}</div>
      </div>
      ${actionsTable(ctx)}
      ${factorsTable(ctx)}
      ${aiCard(ctx)}`;
  }

  function mount(root) {
    const { state } = A;
    root.querySelectorAll('[data-metric]').forEach((el) => {
      const pick = () => { ui.metric = el.dataset.metric; A.render(); };
      el.addEventListener('click', pick);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
    });
    root.querySelectorAll('[data-scen]').forEach((b) => b.addEventListener('click', () => { ui.scenario = b.dataset.scen; A.render(); }));
    const vsel = root.querySelector('#f01-version');
    if (vsel) vsel.addEventListener('change', () => { ui.view[key()] = vsel.value; A.render(); });
    root.querySelectorAll('[data-toggle]').forEach((cb) => cb.addEventListener('change', (e) => {
      e.stopPropagation();
      selection()[cb.dataset.toggle] = cb.checked;
      A.render();
    }));
    root.querySelectorAll('tr[data-factor]').forEach((tr) => tr.addEventListener('dblclick', (e) => {
      if (e.target.closest('input')) return;
      const ctx = context();
      A.openFactor(tr.dataset.factor, { readOnly: ctx.mode !== 'LIVE' });
    }));
    root.querySelectorAll('tr[data-action]').forEach((tr) => tr.addEventListener('dblclick', () => {
      const a = A.M.action(tr.dataset.action);
      const p = A.M.point(a.point_id);
      A.go('A02', { pointId: p.parent_point_id || p.point_id });
    }));
    const add = root.querySelector('[data-add-factor]');
    if (add) add.addEventListener('click', () => A.openFactor(null, {}));
    const conf = root.querySelector('[data-confirm]');
    if (conf) conf.addEventListener('click', confirmDialog);
  }

  /* ------------------------------------------------------- Save (confirm) */
  function confirmDialog() {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const f = M.forecastLive(state.orgId, state.periodId, 'OP', selection());
    const next = (M.versionsFor(state.orgId)[0] || { version_no: 0 }).version_no + 1;
    const inc = M.factorsFor(state.orgId, state.periodId).filter((x) => selection()[x.factor_id]).map((x) => x.factor_id);
    A.openModal(`<header><h3>${esc(t('save_confirm', { n: next }))}</h3><button class="btn ghost x" data-close>×</button></header>
      <div class="body"><dl class="kv">
        <dt>${esc(t('org'))}</dt><dd>${esc(A.orgName(state.orgId))}</dd>
        <dt>${esc(t('scen_LANDING'))} (${esc(t('OP'))})</dt><dd><b>${fmt(f.landing)}</b> <span class="${A.tone('OP', f.variance)}">(${esc(t('vs_budget'))} ${fmtSigned(f.variance)})</span></dd>
        <dt>${esc(t('breakdown_short'))}</dt><dd>${fmt(f.baseline)} ${fmtSigned(f.action)} ${fmtSigned(f.factor)}</dd>
        <dt>${esc(t('individual_factors'))}</dt><dd>${inc.length ? inc.join(', ') : '–'}</dd>
      </dl>
      <label class="muted small" for="ver-note" style="display:block;margin-top:12px">${esc(t('note_optional'))}</label>
      <textarea id="ver-note" rows="2"></textarea>
      <p class="hint">${esc(t('confirm_note'))}</p></div>
      <footer><button class="btn" data-close>${esc(t('close'))}</button><button class="btn primary" data-do-confirm>${esc(t('confirm'))}</button></footer>`,
    { small: true, onMount: (wrap, close) => {
      wrap.querySelector('[data-do-confirm]').addEventListener('click', () => {
        const vid = saveVersion(wrap.querySelector('#ver-note').value.trim() || null);
        if (!vid) return;
        close();
        ui.view[key()] = '';
        A.toast(t('version_saved', { v: `Ver. ${M.version(vid) ? M.version(vid).version_no : next}` }));
        A.render();
      });
    } });
  }

  /** Mock User Data Function: freezes the live figures into a new immutable version. */
  function saveVersion(note) {
    const { M, state, db } = A;
    const org = state.orgId, pid = state.periodId;
    if (!A.canConfirm(org)) { A.toast(A.t('no_confirm_permission'), true); return null; }
    const run = M.modelRun(pid);
    const fy = M.period(pid).fiscal_year;
    const no = (M.versionsFor(org)[0] || { version_no: 0 }).version_no + 1;
    const vid = `FV-${org}-${fy}-${String(no).padStart(2, '0')}`;
    const sel = { ...selection() };
    db.app_forecast_version.push({ forecast_version_id: vid, org_id: org, fiscal_year: fy, as_of_period_id: pid, version_no: no, confirmed_at: A.nowIso(), confirmed_by: state.userId, baseline_run_id: run.forecast_run_id, note });
    METRICS.forEach((mt) => {
      const f = M.forecastLive(org, pid, mt, sel);
      db.app_forecast_version_line.push({ forecast_version_id: vid, metric_id: mt, budget_annual: f.budget, baseline_no_action: f.baseline, action_contribution: f.action, factor_contribution: f.factor, landing: f.landing });
      M.forecastMonthlyLive(org, pid, mt, sel).forEach((x) => db.app_forecast_version_monthly.push({ forecast_version_id: vid, metric_id: mt, period_id: x.period_id,
        actual: x.actual, baseline: x.baseline, with_actions: x.withActions, forecast: x.forecast, budget: x.budget }));
    });
    const fyP = M.fyPeriods(fy);
    Object.entries(sel).forEach(([fid, inc]) => db.app_forecast_factor_selection.push({ forecast_version_id: vid, factor_id: fid, is_included: !!inc, applied_amount_op: inc ? M.factorAmount(fid, org, 'OP', fyP) : 0 }));
    M.forecastActions(org, pid).forEach((a) => db.app_forecast_version_action.push({ forecast_version_id: vid, action_id: a.action_id, metric_id: 'OP', outlook_effect: M.actionTotals(a.action_id, pid, 'OP').outlookFY }));
    db.app_audit_event.push({ event_id: `AE-L${db.app_audit_event.length + 1}`, resource_type: 'forecast_version', resource_id: vid, actor_type: 'USER', actor_id: state.userId,
      event_type: 'FORECAST_CONFIRMED', old_value: null, new_value: JSON.stringify({ landing_op: M.forecastLive(org, pid, 'OP', sel).landing }), occurred_at: A.nowIso() });
    A.rebuild();
    return vid;
  }

  function F01Api() {
    A.f01 = {
      selection,
      /** Called by P-02 after a factor is saved or deleted. */
      factorChanged(factorId, included) {
        const sel = selection();
        if (included === null) delete sel[factorId]; else sel[factorId] = included;
      },
    };
  }

  A.SCREENS.F01 = { render, mount };
})();
