/* C-01 AI chat — right panel on every screen (concept slides 7 and 36).
 * The AI answers about the current screen's period, organization and data, and about data related to it
 * (accounts and formula, breakdowns, budget / prior year, Points, Actions, Factors, Forecast).
 * It reads data only through the read-only tools below (the mockup's stand-in for DAX queries on the
 * semantic model as the signed-in user): every figure comes from a tool, the app draws the charts and
 * lists the sources. No writes; answers can carry [Open …] buttons. Provider / model / key are shared with C-03. */
(function () {
  'use strict';
  const A = window.App;
  const C = () => A.Chat;
  const t = (...x) => A.t(...x);
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const MEASURES = ['REV', 'COGS', 'GP', 'SGA', 'OP'];
  const DIMS = ['org', 'division', 'customer', 'region', 'product', 'product_category', 'account', 'account_class', 'period', 'quarter'];
  const SCENARIOS = ['ACT', 'BUD', 'PY', 'FCST'];
  const RANGES = ['MONTH', 'YTD', 'FY'];
  const OPENABLE = ['A01', 'A02', 'A03', 'A04', 'A05', 'C03', 'F01', 'B01', 'B02'];
  const MAX_TURNS = 6; // conversation turns sent back to the AI
  const MAX_STEPS = 8; // tool rounds per question

  /* ================================================================ context */
  const ctx = () => {
    const { state, M } = A;
    return { pid: state.periodId, fy: M.period(state.periodId).fiscal_year, orgId: state.orgId, screen: state.screen, params: state.params || {} };
  };
  const scrName = (s) => `${A.SCREEN_ID[s] || s} ${t('scr_' + s)}`;
  function ctxLabel() {
    const c = ctx();
    return `${A.periodLabel(c.pid)} | ${A.orgName(c.orgId)} | ${scrName(c.screen)}`;
  }
  const ytdRange = (pid) => { const ps = A.M.ytdPeriods(pid); return `${A.periodLabel(ps[0])} – ${A.periodLabel(ps[ps.length - 1])}`; };
  /** Tools run in English (names, labels) so the AI gets one consistent data language; it answers in the viewer's. */
  function inEnglish(fn) {
    const prev = I18N.get();
    I18N.set('en');
    try { return fn(); } finally { I18N.set(prev); }
  }
  const actionOk = (a) => a && A.M.inScope(a.owner_org_id, A.state.orgId);
  const pointOk = (p) => p && (A.M.pointOrgs(p.point_id).some((o) => A.M.inScope(o, A.state.orgId)) || A.M.inScope(p.org_id, A.state.orgId));

  /* ================================================================== tools */
  const S = (type, extra = {}) => ({ type, ...extra });
  const TOOLS = [
    { name: 'get_screen_context', description: 'What the user is looking at: screen, period (fiscal month, YTD range), organization (and its departments), the Point or Action in focus, and the Metric selection on A-03/A-04. Call this first when the question refers to "this", "here" or the screen.',
      input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_kpis', description: 'Revenue, gross profit, SG&A and operating profit of the selected organization: month and YTD actual vs budget with variance, full-year budget, prior-year YTD and whether each Metric applies to the organization (A-01).',
      input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_metric_definition', description: 'How a Metric is calculated: formula, the accounts that make it up (with sign), favorable direction, and which departments it applies to. Use for "how is SG&A calculated", "what is included in".',
      input_schema: { type: 'object', properties: { metric: S('string', { enum: MEASURES, description: 'REV, COGS (cost of sales), GP, SGA or OP' }) }, required: ['metric'] } },
    { name: 'query_financials', description: 'Financial figures of the selected organization from the BI model (same data as B-01): one measure for scenarios ACT (actual), BUD (budget), PY (prior year), FCST (latest confirmed forecast), grouped by up to two dimensions, with optional filters. Returns rows with each scenario, the ACT−BUD variance and share of total, sorted by the size of the variance (or value). Set chart=true to show a chart to the user for a breakdown or monthly trend.',
      input_schema: { type: 'object', properties: {
        measure: S('string', { enum: MEASURES }),
        scenarios: S('array', { items: { type: 'string', enum: SCENARIOS }, description: 'Default ["ACT","BUD"]' }),
        group_by: S('array', { items: { type: 'string', enum: DIMS }, description: 'Up to two dimensions; org = department, period = month' }),
        filters: S('object', { description: 'Dimension → member id, e.g. {"customer":"C02"} or {"account":"6210"}', additionalProperties: { type: 'string' } }),
        range: S('string', { enum: RANGES, description: 'MONTH = the selected month, YTD (default) = fiscal year to date, FY = full fiscal year (actuals exist only for closed months)' }),
        top: S('integer', { description: 'Rows to return (default 10, max 20); the rest is summed as Other' }),
        chart: S('boolean', { description: 'Show a chart of the result in the chat' }),
      }, required: ['measure'] } },
    { name: 'get_points', description: 'Points (issues / opportunities the AI found) for the selected organization and month: impact on each Metric YTD and this month, annual operating-profit impact, change vs last month, proposals and executing Actions, plus variance not explained by Points. With point_id: details, causes with evidence and the Actions under it.',
      input_schema: { type: 'object', properties: { point_id: S('string', { description: 'e.g. PT-001 or PT-001-SL' }) }, required: [] } },
    { name: 'get_actions', description: 'Actions of the selected organization: decision and execution state, progress vs expected, AI status, effect plan / actual to date / year-end outlook for a Metric. With action_id: all target Metrics, monthly effect, measurement method, latest AI assessment, excluded Factors and decision history (A-03 / A-05).',
      input_schema: { type: 'object', properties: { action_id: S('string'), metric: S('string', { enum: METRICS, description: 'Default OP' }) }, required: [] } },
    { name: 'get_forecast', description: 'Year-end Forecast (F-01) of the selected organization for a Metric: budget, ML forecast without Actions, adopted Action contribution, Individual Factors, landing and variance to budget; for a division or the company the sum of the departments\' latest confirmed versions with each department\'s landing.',
      input_schema: { type: 'object', properties: { metric: S('string', { enum: METRICS, description: 'Default OP' }) }, required: [] } },
    { name: 'what_if_stop_action', description: 'Recalculates the year-end landing if an adopted Action stopped now (same rule as F-01: a stopped Action keeps the effect already realized and loses its open-month outlook). The app calculates; quote the result.',
      input_schema: { type: 'object', properties: { action_id: S('string'), metric: S('string', { enum: METRICS, description: 'Default OP' }) }, required: ['action_id'] } },
    { name: 'open_screen', description: 'Add a button under your answer that opens a screen: A02 needs a point_id, A05 / C03 an action_id. Use when the user should look at or act on something (the chat itself cannot change data).',
      input_schema: { type: 'object', properties: { screen: S('string', { enum: OPENABLE }), id: S('string', { description: 'point_id for A02, action_id for A05 / C03' }) }, required: ['screen'] } },
  ].map((x) => ({ ...x, eager_input_streaming: true }));

  /** Minimal JSON-schema check (eager input streaming: the API does not validate tool input). */
  function validate(tool, input) {
    const sch = tool.input_schema;
    if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
    for (const k of sch.required || []) if (input[k] === undefined) return `missing ${k}`;
    for (const [k, v] of Object.entries(input)) {
      const p = sch.properties[k];
      if (!p) return `unknown field ${k}`;
      if (p.type === 'string' && typeof v !== 'string') return `${k} must be a string`;
      if (p.type === 'integer' && !Number.isInteger(v)) return `${k} must be an integer`;
      if (p.type === 'boolean' && typeof v !== 'boolean') return `${k} must be true/false`;
      if (p.type === 'array' && (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || (p.items.enum && !p.items.enum.includes(x))))) return `${k} must be a list of ${(p.items.enum || ['strings']).join('/')}`;
      if (p.type === 'object' && (typeof v !== 'object' || Array.isArray(v) || Object.values(v).some((x) => typeof x !== 'string'))) return `${k} must map names to strings`;
      if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(', ')}`;
    }
    return null;
  }

  const label = (dim, id) => {
    const { M } = A;
    if (id === 'Other') return 'Other';
    switch (dim) {
      case 'org': case 'division': return A.orgName(id);
      case 'customer': return (M.customer(id) || {}).customer_name || id;
      case 'product': return (M.product(id) || {}).product_name || id;
      case 'account': return `${id} ${(M.account(id) || {}).account_name || ''}`.trim();
      case 'period': return A.periodLabel(Number(id));
      case 'quarter': return `Q${id}`;
      default: return String(id);
    }
  };
  const src = (screen, range, extra) => ({ screen, range, org: A.state.orgId, extra: extra || '' });

  const RUN = {
    get_screen_context() {
      const { M, state } = A;
      const c = ctx();
      const o = M.org(c.orgId);
      const out = {
        screen: scrName(c.screen), period: A.periodLabel(c.pid), period_id: c.pid, fiscal_year: c.fy, ytd: ytdRange(c.pid),
        latest_closed_month: A.periodLabel(M.latestClosed()),
        organization: { id: o.org_id, name: A.orgName(o.org_id), level: ['company', 'division', 'department'][o.org_level - 1], departments: M.leafOrgs(o.org_id).map((x) => A.orgName(x)) },
        user: A.userName(state.userId), currency: 'JPY million',
      };
      if (c.params.pointId && M.point(c.params.pointId)) out.point_in_focus = { point_id: c.params.pointId, title: A.aiPlain(M.point(c.params.pointId).title_comment_id) };
      if (c.params.actionId && M.action(c.params.actionId)) out.action_in_focus = { action_id: c.params.actionId, name: A.actionNamePlain(M.action(c.params.actionId)) };
      if (['A03', 'A04'].includes(c.screen)) out.metric_selection = A.boardUi.metrics;
      return { data: out, source: src(c.screen, 'CTX') };
    },

    get_kpis() {
      const { M } = A;
      const c = ctx();
      const ytd = M.ytdPeriods(c.pid);
      const rows = METRICS.map((m) => {
        const k = M.kpi(c.orgId, c.pid, m);
        const mA = M.factValue('ACT', [c.pid], c.orgId, m), mB = M.factValue('BUD', [c.pid], c.orgId, m);
        const py = M.biValue(c.orgId, ytd, m, 'PY');
        return { metric: m, name: A.metricName(m), applicable: k.applicable,
          month: { actual: mA, budget: mB, variance: M.r2 ? M.r2(mA - mB) : M.varianceMonth(c.orgId, c.pid, m) },
          ytd: { actual: k.actual, budget: k.budget, variance: k.variance, favorable: k.favorable },
          full_year_budget: M.budgetAnnual(c.orgId, c.fy, m),
          prior_year_ytd: py, vs_prior_year: py === null ? null : Math.round((k.actual - py) * 100) / 100 };
      });
      return { data: { period: A.periodLabel(c.pid), ytd: ytdRange(c.pid), organization: A.orgName(c.orgId), unit: 'JPY million; SG&A is a cost (a negative variance = spent less than budget)', kpis: rows }, source: src('A01', 'YTD') };
    },

    get_metric_definition({ metric }) {
      const { M, db } = A;
      const c = ctx();
      const formula = {
        REV: 'Revenue = sum of revenue accounts',
        COGS: 'Cost of sales = Revenue − Gross profit (derived; not one of the four Metrics)',
        GP: 'Gross profit = Revenue − Cost of sales (revenue accounts minus cost-of-sales accounts)',
        SGA: 'SG&A = sum of selling, general and administrative expense accounts (shown as a positive cost)',
        OP: 'Operating profit = Gross profit − SG&A',
      }[metric];
      const accounts = db.dim_account.slice().sort((a, b) => a.sort_order - b.sort_order)
        .map((a) => ({ account_id: a.account_id, name: a.account_name, class: a.account_class, sign: M.biSign(a.account_id, metric) }))
        .filter((a) => a.sign);
      const fav = metric === 'COGS' || metric === 'SGA' ? 'lower is better' : 'higher is better';
      const applies = M.leafOrgs(c.orgId).map((o) => ({ department: A.orgName(o), applies: M.biApplicable(o, metric) }));
      const ytd = M.ytdPeriods(c.pid);
      const actual = M.biValue(c.orgId, ytd, metric, 'ACT'), budget = M.biValue(c.orgId, ytd, metric, 'BUD');
      return { data: { metric, formula, favorable_direction: fav, accounts, applicability: applies,
        ytd: { actual, budget, variance: actual === null || budget === null ? null : Math.round((actual - budget) * 100) / 100, range: ytdRange(c.pid) },
        related: 'Use query_financials with group_by ["account"] for the YTD amount of each account; get_points / get_actions for Points and Actions affecting it.' },
        source: src('B01', 'DEF', 'account mapping') };
    },

    query_financials({ measure, scenarios = ['ACT', 'BUD'], group_by = [], filters = {}, range = 'YTD', top = 10, chart = false }) {
      const { M } = A;
      const c = ctx();
      if (group_by.length > 2) return { error: 'group_by takes at most two dimensions' };
      for (const d of Object.keys(filters)) if (!DIMS.includes(d)) return { error: `unknown filter dimension ${d}` };
      const periods = range === 'MONTH' ? [c.pid] : range === 'FY' ? M.fyPeriods(c.fy) : M.ytdPeriods(c.pid);
      const sc = [...new Set(scenarios.length ? scenarios : ['ACT', 'BUD'])];
      const q = M.biQuery({ orgId: c.orgId, periods, measure, scenarios: sc, groupBy: [...group_by, 'scenario'], filters, asOf: c.pid });
      const by = new Map();
      q.rows.forEach((r) => {
        const key = r.key.slice(0, -1);
        const k = key.join('|');
        if (!by.has(k)) by.set(k, { key, values: {} });
        by.get(k).values[r.key[r.key.length - 1]] = r.value;
      });
      const r2 = (v) => Math.round(v * 100) / 100;
      const hasVar = sc.includes('ACT') && sc.includes('BUD');
      let rows = [...by.values()].map((x) => {
        const row = { key: x.key.join(' / '), label: x.key.map((m, i) => label(group_by[i], m)).join(' / ') };
        sc.forEach((s) => { row[s] = x.values[s] ?? 0; });
        if (hasVar) row.variance_vs_budget = r2(row.ACT - row.BUD);
        return row;
      });
      const total = {};
      sc.forEach((s) => { total[s] = r2(rows.reduce((a, r) => a + (r[s] || 0), 0)); });
      if (hasVar) total.variance_vs_budget = r2(total.ACT - total.BUD);
      const lead = sc.includes('ACT') ? 'ACT' : sc[0];
      rows.forEach((r) => { if (total[lead]) r.share_of_total_pct = Math.round((r[lead] / total[lead]) * 1000) / 10; });
      const isTime = group_by.length === 1 && ['period', 'quarter'].includes(group_by[0]);
      if (isTime) rows.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      else rows.sort((a, b) => (hasVar ? Math.abs(b.variance_vs_budget) - Math.abs(a.variance_vs_budget) : Math.abs(b[lead]) - Math.abs(a[lead])));
      const n = Math.min(Math.max(top || 10, 1), 20);
      if (!isTime && rows.length > n) {
        const rest = rows.slice(n);
        const other = { key: 'Other', label: `Other (${rest.length})` };
        sc.forEach((s) => { other[s] = r2(rest.reduce((a, r) => a + (r[s] || 0), 0)); });
        if (hasVar) other.variance_vs_budget = r2(other.ACT - other.BUD);
        rows = [...rows.slice(0, n), other];
      }
      const data = { measure, measure_name: measure === 'COGS' ? 'Cost of sales' : A.metricName(measure), range, periods: range === 'MONTH' ? A.periodLabel(c.pid) : `${A.periodLabel(periods[0])} – ${A.periodLabel(periods[periods.length - 1])}`,
        organization: A.orgName(c.orgId), group_by, filters, scenarios: sc, rows, total, unit: 'JPY million' };
      if (q.fcstUnsupported) data.note = 'FCST exists only by organization and month; it was left out for these dimensions.';
      if (range === 'FY' && sc.includes('ACT')) data.note = (data.note ? data.note + ' ' : '') + `ACT covers closed months only (to ${A.periodLabel(A.M.latestClosed())}).`;
      const out = { data, source: src('B01', range) };
      if (chart && group_by.length === 1 && rows.length) out.chart = { measure, group_by: group_by[0], scenarios: sc, rows, isTime, hasVar };
      return out;
    },

    get_points({ point_id } = {}) {
      const { M, db } = A;
      const c = ctx();
      const rowOut = (r) => ({ point_id: r.point.point_id, title: A.aiPlain(r.point.title_comment_id), type: r.point.point_type, status: r.point.status,
        raised: A.periodLabel(r.raisedPeriodId), departments: r.orgs.map((o) => A.orgName(o)),
        impact_ytd: r.impacts, impact_this_month: r.monthImpacts, annual_op_impact: r.overall, annual_op_impact_vs_last_month: r.overallVsPrev,
        proposals: r.proposalCount, executing_actions: r.executingCount, executing_plan_op: r.plannedEffect, executing_actual_op: r.actualEffect });
      if (point_id) {
        const p = M.point(point_id);
        if (!pointOk(p)) return { error: `${point_id} is not a Point of ${A.orgName(c.orgId)}` };
        if (!M.pointSnapshot(point_id, c.pid)) return { error: `${point_id} has no figures for ${A.periodLabel(c.pid)}` };
        const r = M.pointRow(point_id, c.pid, c.orgId);
        const ids = [point_id, ...M.pointChildren(point_id).map((x) => x.point_id)];
        const asOf = db.app_point_cause.filter((x) => ids.includes(x.point_id) && x.as_of_period_id <= c.pid).reduce((m, x) => Math.max(m, x.as_of_period_id), 0);
        const causes = db.app_point_cause.filter((x) => ids.includes(x.point_id) && x.as_of_period_id === asOf).sort((a, b) => a.sort_order - b.sort_order)
          .map((x) => ({ text: A.aiPlain(x.comment_id), op_impact: x.impact_op, quantity: x.quantity_value, unit: x.quantity_unit, evidence: x.evidence_ref }));
        const actions = M.actionsForPoint(point_id).filter(actionOk).map((a) => ({ action_id: a.action_id, name: A.actionNamePlain(a), owner: A.orgName(a.owner_org_id), decision: a.decision_state, execution: a.execution_state }));
        return { data: { ...rowOut(r), indicator_metric: p.indicator_metric_id, causes, actions }, source: src('A02', 'YTD', point_id) };
      }
      const list = M.pointsFor(c.orgId, c.pid);
      const other = M.otherVariance(c.orgId, c.pid, list);
      list.sort((a, b) => Math.abs(b.overall) - Math.abs(a.overall));
      return { data: { period: A.periodLabel(c.pid), organization: A.orgName(c.orgId), points: list.map(rowOut), variance_not_explained_by_points_ytd: other, unit: 'JPY million' }, source: src('A01', 'YTD', 'Points') };
    },

    get_actions({ action_id, metric = 'OP' } = {}) {
      const { M, db } = A;
      const c = ctx();
      const totals = (id, m) => { const x = M.actionTotals(id, c.pid, m); return { plan_full_year: x.planAnnual, plan_to_date: x.planToDate, actual_to_date: x.actualToDate, outlook_full_year: x.outlookFY, outlook_vs_plan: x.outlookVsPlan }; };
      const base = (a) => {
        const prog = M.actionProgress(a.action_id, c.pid);
        return { action_id: a.action_id, name: A.actionNamePlain(a), point_id: a.point_id, owner: A.orgName(a.owner_org_id), decision: a.decision_state, execution: a.execution_state,
          term: `${A.periodLabel(a.start_period_id)} – ${A.periodLabel(a.end_period_id)}`, progress_pct: prog ? prog.progress_pct : 0,
          expected_progress_pct: M.expectedProgress(a, c.pid), ai_status: prog ? prog.ai_status : null, targets: M.actionTargets(a.action_id) };
      };
      if (action_id) {
        const a = M.action(action_id);
        if (!actionOk(a)) return { error: `${action_id} is not an Action of ${A.orgName(c.orgId)}` };
        const tg = M.actionTargets(action_id);
        const mm = tg.includes(metric) ? metric : tg[0];
        const assessed = db.app_action_progress.filter((p) => p.action_id === action_id && p.period_id <= c.pid && p.comment_id).sort((x, y) => y.period_id - x.period_id)[0];
        const meas = M.actionMeasurement(action_id);
        return { data: { ...base(a), description: A.aiPlain(a.description_comment_id) || a.description || null,
          effect: Object.fromEntries(tg.map((m) => [m, totals(action_id, m)])),
          monthly: { metric: mm, months: M.actionMonthly(action_id, mm, c.pid).map((r) => ({ month: A.periodLabel(r.period_id), plan: r.plan, [r.isActual ? 'actual' : 'outlook']: r.value })) },
          measurement: meas ? { baseline: meas.baseline_method, formula: meas.formula } : null,
          latest_ai_assessment: assessed ? { month: A.periodLabel(assessed.period_id), text: A.aiPlain(assessed.comment_id) } : null,
          excluded_factors: [...new Set(M.actionExclusions(action_id).map((x) => x.factor_id))],
          decisions: M.actionDecisions(action_id).map((d) => ({ decision: d.decision, by: A.userName(d.decided_by), at: String(d.decided_at).slice(0, 10), reason: d.reason || null })),
          unit: 'JPY million' }, source: src('A05', 'YTD', action_id) };
      }
      const board = M.boardActions(c.orgId, c.pid, true).map((a) => ({ ...base(a), effect: M.actionTargets(a.action_id).includes(metric) ? totals(a.action_id, metric) : 'not a target Metric' }));
      const proposals = db.app_action.filter((a) => actionOk(a) && ['PROPOSED', 'ON_HOLD'].includes(a.decision_state)).map((a) => ({ action_id: a.action_id, name: A.actionNamePlain(a), point_id: a.point_id, decision: a.decision_state }));
      return { data: { period: A.periodLabel(c.pid), organization: A.orgName(c.orgId), metric, adopted_actions: board, proposals_not_adopted: proposals, unit: 'JPY million' }, source: src('A03', 'YTD') };
    },

    get_forecast({ metric = 'OP' } = {}) {
      const { M } = A;
      const c = ctx();
      const leaf = M.org(c.orgId).is_leaf;
      const shape = (f) => f && { budget: f.budget, forecast_without_actions: f.baseline, adopted_actions: f.action, individual_factors: f.factor, with_actions: f.withActions, landing: f.landing, landing_vs_budget: f.variance };
      if (!leaf) {
        const roll = M.forecastRollup(c.orgId, c.pid, metric);
        return { data: { metric, basis: 'sum of each department\'s latest confirmed Forecast version', ...shape(roll),
          departments: roll.parts.map((p) => ({ department: A.orgName(p.org_id), version: p.version ? p.version.version_no : null, landing: p.version ? (M.versionLine(p.version.forecast_version_id, metric) || {}).landing ?? null : null })),
          departments_without_version: roll.missing.map((o) => A.orgName(o)), unit: 'JPY million' }, source: src('F01', 'FY') };
      }
      const run = M.modelRun(c.pid);
      const ver = M.latestVersion(c.orgId, c.pid);
      if (!run && !ver) return { data: { metric, note: `No forecast for ${A.periodLabel(c.pid)} yet.` }, source: src('F01', 'FY') };
      const f = run ? M.forecastLive(c.orgId, c.pid, metric) : M.versionFigures(ver.forecast_version_id, metric);
      const sel = M.defaultFactorSelection(c.orgId, c.pid);
      const fyP = M.fyPeriods(c.fy);
      const factors = M.factorsFor(c.orgId, c.pid).map((x) => ({ factor_id: x.factor_id, category: x.category, title: A.aiPlain(x.title_comment_id), included: !!sel[x.factor_id], full_year_amount: M.factorAmount(x.factor_id, c.orgId, metric, fyP) }));
      const range = run ? M.baselineRange(c.orgId, metric, run.forecast_run_id) : null;
      const drivers = run ? M.keyDrivers(c.orgId, run.forecast_run_id).slice(0, 3).map((d) => ({ driver: d.driver_id, typical_full_year_op_impact: d.typicalOp })) : [];
      return { data: { metric, basis: run ? 'live forecast (ML run + adopted Actions + included Factors), not yet confirmed' : `confirmed version ${ver.version_no}`, ...shape(f),
        ml_range_80pct_without_actions: range, factors, key_drivers: drivers, latest_confirmed_version: ver ? { version: ver.version_no, as_of: A.periodLabel(ver.as_of_period_id) } : null, unit: 'JPY million' },
        source: src('F01', 'FY') };
    },

    what_if_stop_action({ action_id, metric = 'OP' }) {
      const { M } = A;
      const c = ctx();
      const a = M.action(action_id);
      if (!actionOk(a)) return { error: `${action_id} is not an Action of ${A.orgName(c.orgId)}` };
      if (!M.isOnBoard(a, c.pid)) return { error: `${action_id} is not adopted, so it is not in the Forecast` };
      if (!M.actionTargets(action_id).includes(metric)) return { error: `${metric} is not a target Metric of ${action_id} (targets: ${M.actionTargets(action_id).join(', ')})` };
      const fyP = new Set(M.fyPeriods(c.fy));
      const rows = M.effectRows(action_id, metric).filter((r) => fyP.has(r.period_id));
      const r2 = (v) => Math.round(v * 100) / 100;
      const realized = r2(rows.filter((r) => r.period_id <= c.pid).reduce((s, r) => s + (r.actual_effect || 0), 0));
      const lost = a.execution_state === 'STOPPED' ? 0 : r2(rows.filter((r) => r.period_id > c.pid).reduce((s, r) => s + (r.outlook_effect ?? r.actual_effect ?? 0), 0));
      const fc = RUN.get_forecast({ metric }).data;
      if (fc.landing === undefined) return { error: 'no Forecast to compare with' };
      const after = r2(fc.landing - lost);
      return { data: { action_id, name: A.actionNamePlain(a), metric, rule: 'A stopped Action keeps the effect realized in closed months and loses its outlook for open months (F-01).',
        realized_to_date_kept: realized, open_month_outlook_lost: lost, landing_now: fc.landing, landing_if_stopped: after, change: r2(-lost),
        budget: fc.budget, landing_vs_budget_now: fc.landing_vs_budget, landing_vs_budget_if_stopped: r2(after - fc.budget), forecast_basis: fc.basis,
        note: a.execution_state === 'STOPPED' ? 'The Action is already stopped.' : null, unit: 'JPY million' }, source: src('F01', 'WHATIF', action_id) };
    },

    open_screen({ screen, id }, turn) {
      const { M } = A;
      let params = {};
      if (screen === 'A02') {
        const p = M.point(id);
        if (!pointOk(p)) return { error: 'A02 needs a point_id of the selected organization' };
        params = { pointId: id };
      } else if (screen === 'A05' || screen === 'C03') {
        if (!actionOk(M.action(id))) return { error: `${screen} needs an action_id of the selected organization` };
        params = { actionId: id };
      }
      if (turn && !turn.buttons.some((b) => b.screen === screen && b.id === (id || null))) turn.buttons.push({ screen, id: id || null, params });
      return { data: { ok: true, button: `${scrName(screen)}${id ? ' ' + id : ''}` } };
    },
  };

  function runTool(name, input, turn) {
    const tool = TOOLS.find((x) => x.name === name);
    if (!tool) return { error: `unknown tool ${name}` };
    const bad = validate(tool, input);
    if (bad) return { error: `INVALID_INPUT: ${bad}` };
    try {
      return inEnglish(() => RUN[name](input, turn));
    } catch (e) {
      return { error: `tool failed: ${e.message}` };
    }
  }

  /* =========================================================== conversation */
  // Session-only: turns of { q, ctx, text, steps[], sources[], charts[], buttons[], status, demo, model, unknown[] }.
  const S0 = () => ({ turns: [], history: [], busy: false, draft: '' });
  let conv = S0();

  function systemPrompt(lang) {
    return [
      'You are the AI assistant (C-01) of an AI performance management app. It is a mockup: all data is simulated. The user asks about the screen they are looking at.',
      'Rules:',
      '1. Scope: answer about the period and organization in the context line, the data on the current screen, and data related to it: what the figures are made of or calculated from (accounts, formulas), breakdowns (department, customer, product, region, account, month), budget and prior-year comparisons, and the Points, Actions, Individual Factors and Forecast that affect them. Do not answer about other fiscal years or organizations outside the selected one: say it is outside the current context and suggest switching the period or organization in the header. Decline unrelated topics in one sentence.',
      '2. Numbers: get every figure from the tools and quote it as returned (JPY million unless stated). Never estimate, forecast or invent a number and do not do arithmetic yourself: the tools return variances, shares and what-if results. If no tool gives the figure, say so.',
      '3. What-if: only what_if_stop_action exists. For other scenarios explain that options are changed in F-01 (Forecast).',
      '4. Read-only: you cannot change data. If asked to add, adopt or update something, name the screen that does it and add an open_screen button.',
      '5. Charts: for a breakdown or a monthly trend call query_financials with chart=true; the app draws it under your answer. Call open_screen when the user should look at a screen.',
      '6. Mention where figures come from briefly when it helps, e.g. "(A-01, YTD Jun 2027)"; the app also lists the tool sources under your answer.',
      `7. Write in ${C().LANG_EN[lang] || 'English'}. Plain text: short paragraphs or lines starting with "- "; no markdown headings, tables or bold. Keep it under about 150 words unless asked for a report comment. Do not narrate your tool calls.`,
    ].join('\n');
  }

  function contextLine() {
    return inEnglish(() => {
      const c = ctx();
      const focus = c.params.pointId ? `; point in focus ${c.params.pointId}` : c.params.actionId ? `; action in focus ${c.params.actionId}` : '';
      return `[Context: screen ${scrName(c.screen)}; period ${A.periodLabel(c.pid)} (YTD ${ytdRange(c.pid)}); organization ${A.orgName(c.orgId)}${focus}]`;
    });
  }

  async function askAi(turn, rerender, update) {
    let Anthropic;
    try { Anthropic = await C().loadSdk(); } catch (e) { throw new Error(t('c3_err_sdk')); }
    const settings = C().settings;
    const client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true });
    const model = settings.model;
    turn.model = model;
    const msgs = [...conv.history, { role: 'user', content: `${contextLine()}\n${turn.q}` }];
    const toolText = [];
    let jsonRetries = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
      const body = { model, max_tokens: 2048, system: systemPrompt(A.state.lang), tools: TOOLS, messages: msgs };
      if (model === 'claude-haiku-5-5') body.thinking = { type: 'disabled' }; // quick answers; other models keep their default
      turn.text = '';
      let msg;
      try {
        const stream = client.messages.stream(body);
        stream.on('text', (_d, snap) => { turn.text = snap; update(); });
        msg = await stream.finalMessage();
        jsonRetries = 0;
      } catch (e) {
        if (e && e.status === 401) throw new Error(t('c3_err_key'));
        if (e && e.status === 429) throw new Error(t('c3_err_rate'));
        if ((Anthropic.APIError && e instanceof Anthropic.APIError) || jsonRetries++ >= 2) throw new Error(e && e.message ? e.message : String(e));
        continue; // a tool input that could not be parsed at all: re-issue the turn
      }
      if (msg.stop_reason === 'refusal') throw new Error(t('c3_err_refusal'));
      const uses = msg.content.filter((b) => b.type === 'tool_use');
      msgs.push({ role: 'assistant', content: msg.content });
      if (!uses.length) {
        turn.text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
        break;
      }
      if (msg.stop_reason === 'max_tokens') throw new Error('The answer was cut off. Please ask a narrower question.');
      const results = uses.map((u) => {
        turn.steps.push(u.name);
        rerender();
        const res = runTool(u.name, u.input, turn);
        if (res.source) addSource(turn, res.source);
        if (res.chart) turn.charts.push(res.chart);
        const content = JSON.stringify(res.error ? { error: res.error } : res.data);
        toolText.push(content);
        return { type: 'tool_result', tool_use_id: u.id, content, ...(res.error ? { is_error: true } : {}) };
      });
      msgs.push({ role: 'user', content: results });
      if (step === MAX_STEPS - 1) turn.text = turn.text || t('ac_too_many');
    }
    turn.unknown = C().unknownNumbers(turn.text, toolText.join(' ') + ' ' + contextLine());
    // Keep the exchange (with its tool calls) for follow-up questions; drop the oldest turns.
    conv.history = msgs;
    const starts = conv.history.map((m, i) => (m.role === 'user' && typeof m.content === 'string' ? i : -1)).filter((i) => i >= 0);
    if (starts.length > MAX_TURNS) conv.history = conv.history.slice(starts[starts.length - MAX_TURNS]);
  }

  function addSource(turn, s) {
    const k = `${s.screen}|${s.range}|${s.extra}`;
    if (!turn.sources.some((x) => `${x.screen}|${x.range}|${x.extra}` === k)) turn.sources.push(s);
  }

  /* ===================================================== suggested questions */
  // Work without an API key: each answer is built from the same tools (prepared wording, real figures).
  const fmt = (v) => A.fmt(v, 2);
  const fs = (v) => A.fmtSigned(v, 2);
  function suggestions() {
    const { M } = A;
    const c = ctx();
    const list = [];
    const a = c.params.actionId && actionOk(M.action(c.params.actionId)) ? M.action(c.params.actionId) : null;
    if (c.params.pointId && pointOk(M.point(c.params.pointId)) && M.pointSnapshot(c.params.pointId, c.pid)) list.push({ id: 'point', q: t('ac_s_point', { id: c.params.pointId }) });
    if (a && M.isOnBoard(a, c.pid) && M.actionTargets(a.action_id).includes('OP')) list.push({ id: 'whatif', q: t('ac_s_whatif', { id: a.action_id }) });
    if (['A03', 'A04', 'A05', 'C03'].includes(c.screen)) list.push({ id: 'behind', q: t('ac_s_behind') });
    if (c.screen === 'F01') list.push({ id: 'fcst', q: t('ac_s_fcst') });
    list.push({ id: 'op', q: t('ac_s_op') });
    list.push({ id: 'break', q: t('ac_s_break', { dim: t(M.org(c.orgId).is_leaf ? 'ac_dim_customer' : 'ac_dim_org') }) });
    list.push({ id: 'sga', q: t('ac_s_sga') });
    return list.slice(0, 4);
  }

  function demoAnswer(id, turn) {
    const { M } = A;
    const c = ctx();
    const tool = (name, input = {}) => {
      turn.steps.push(name);
      const res = runTool(name, input, turn);
      if (res.source) addSource(turn, res.source);
      if (res.chart) turn.charts.push(res.chart);
      return res;
    };
    const metricName = (m) => A.metricName(m);
    if (id === 'op') {
      const k = tool('get_kpis').data.kpis.find((x) => x.metric === 'OP');
      const pts = tool('get_points');
      const top = pts.data.points.slice(0, 3).map((p) => `${p.point_id} (${fs(p.impact_ytd.OP ?? 0)})`).join(', ') || '–';
      tool('open_screen', { screen: 'A01' });
      return t('ac_d_op', { a: fmt(k.ytd.actual), b: fmt(k.ytd.budget), v: fs(k.ytd.variance), dir: t(k.ytd.variance >= 0 ? 'ac_above' : 'ac_below'), pts: top, o: fs(pts.data.variance_not_explained_by_points_ytd.OP) });
    }
    if (id === 'break') {
      const dim = M.org(c.orgId).is_leaf ? 'customer' : 'org';
      const q = tool('query_financials', { measure: 'OP', group_by: [dim], chart: true, top: 6 }).data;
      const list = q.rows.slice(0, 3).map((r) => `${r.label} ${fs(r.variance_vs_budget)}`).join(', ');
      return t('ac_d_break', { dim: t(dim === 'org' ? 'ac_dim_org' : 'ac_dim_customer'), list, v: fs(q.total.variance_vs_budget) });
    }
    if (id === 'sga') {
      const d = tool('get_metric_definition', { metric: 'SGA' }).data;
      tool('query_financials', { measure: 'SGA', group_by: ['account'], chart: true });
      return t('ac_d_sga', { accounts: d.accounts.map((x) => x.name).join(', '), a: fmt(d.ytd.actual), b: fmt(d.ytd.budget), v: fs(d.ytd.variance) });
    }
    if (id === 'point') {
      const d = tool('get_points', { point_id: c.params.pointId }).data;
      const causes = d.causes.slice(0, 2).map((x) => `${x.text} (${fs(x.op_impact)})`).join(' / ') || '–';
      return t('ac_d_point', { id: d.point_id, title: d.title, op: fs(d.impact_ytd.OP ?? 0), causes, n: d.proposals, e: d.executing_actions });
    }
    if (id === 'whatif') {
      const d = tool('what_if_stop_action', { action_id: c.params.actionId, metric: 'OP' }).data;
      tool('open_screen', { screen: 'F01' });
      return t('ac_d_whatif', { id: d.action_id, r: fmt(d.realized_to_date_kept), rem: fmt(d.open_month_outlook_lost), l0: fmt(d.landing_now), l1: fmt(d.landing_if_stopped), b: fmt(d.budget) });
    }
    if (id === 'behind') {
      const d = tool('get_actions', { metric: 'OP' }).data;
      const behind = d.adopted_actions.filter((x) => typeof x.effect === 'object' && (x.effect.outlook_vs_plan < 0 || ['DELAYED', 'AT_RISK'].includes(x.ai_status)));
      behind.slice(0, 2).forEach((x) => tool('open_screen', { screen: 'A05', id: x.action_id }));
      return behind.length
        ? t('ac_d_behind', { list: behind.map((x) => `${x.action_id} ${x.name} (${t('ac_progress')} ${x.progress_pct}% / ${x.expected_progress_pct}%, ${t('ac_outlook_vs_plan')} ${fs(x.effect.outlook_vs_plan)})`).join('\n- ') })
        : t('ac_d_behind_none', { m: A.periodLabel(c.pid) });
    }
    if (id === 'fcst') {
      const d = tool('get_forecast', { metric: 'OP' }).data;
      if (d.landing === undefined) return d.note;
      return t('ac_d_fcst', { l: fmt(d.landing), b: fmt(d.budget), v: fs(d.landing_vs_budget), base: fmt(d.forecast_without_actions), act: fs(d.adopted_actions), fac: fs(d.individual_factors) });
    }
    return '';
  }

  /* ==================================================================== UI */
  const panel = () => document.getElementById('chatpanel');
  function newTurn(q) { return { q, ctx: ctxLabel(), text: '', steps: [], sources: [], charts: [], buttons: [], status: 'working', demo: false, model: null, unknown: [] }; }

  function chartHtml(ch) {
    const { Chart } = A;
    const r2 = (v) => Math.round(v * 100) / 100;
    if (ch.isTime) {
      const colors = { ACT: '#2a78d6', BUD: '#9aa4b2', PY: '#eda100', FCST: '#1baf7a' };
      const series = ch.scenarios.map((s) => ({ name: t('ac_sc_' + s), type: s === 'ACT' || s === 'BUD' ? 'bar' : 'line', color: colors[s], values: ch.rows.map((r) => r[s] ?? null) }));
      return Chart.monthly(series, { width: 360, height: 180, labels: ch.rows.map((r) => (ch.group_by === 'period' ? A.monthLabel(Number(r.key)) : r.label)) });
    }
    // Variance bars: green / red by whether the gap is favorable for this measure (over budget on a cost is red).
    // Plain breakdowns (no budget comparison) are magnitudes, so one neutral color.
    const items = ch.rows.map((r) => {
      const value = ch.hasVar ? r.variance_vs_budget : r2(r[ch.scenarios.includes('ACT') ? 'ACT' : ch.scenarios[0]]);
      const color = !ch.hasVar ? 'var(--accent)' : value === 0 ? 'var(--muted)' : A.M.biFavorable(ch.measure, value) ? 'var(--good)' : 'var(--bad)';
      return { label: r.label, value, color };
    });
    return `<div class="hint">${A.esc(ch.hasVar ? t('ac_chart_var', { m: ch.measure === 'COGS' ? 'COGS' : A.metricName(ch.measure) }) : (ch.measure === 'COGS' ? 'COGS' : A.metricName(ch.measure)))}</div>${Chart.hbar(items, { width: 360, rowH: 20, labelW: 130 })}`;
  }
  function sourceLabel(s) {
    const scr = { A01: 'A01', A02: 'A02', A03: 'A03', A05: 'A05', B01: 'B01', F01: 'F01' }[s.screen] || s.screen;
    const range = s.range === 'YTD' ? `${t('ac_ytd')} ${A.periodLabel(A.state.periodId)}` : s.range === 'MONTH' ? A.periodLabel(A.state.periodId)
      : s.range === 'FY' || s.range === 'WHATIF' ? `FY${A.M.period(A.state.periodId).fiscal_year}` : s.range === 'DEF' ? t('ac_def') : A.periodLabel(A.state.periodId);
    return `${A.SCREEN_ID[scr] || scr} ${t('scr_' + scr)} · ${range} · ${A.orgName(s.org)}${s.extra ? ' · ' + s.extra : ''}`;
  }
  function turnHtml(turn, i) {
    const { esc } = A;
    const stepLine = turn.status === 'working'
      ? `<div class="ac-steps">${esc(t('ac_working'))}${turn.steps.length ? ' ' + turn.steps.map((s) => `<span class="ac-step">🔎 ${esc(t('ac_tool_' + s))}</span>`).join(' ') : ''}</div>` : '';
    const body = turn.status === 'error' ? `<span class="bad">${esc(turn.error)}</span>` : esc(turn.text || '');
    const meta = turn.status === 'done' ? `<span class="hint">${esc(turn.demo ? t('ac_demo_tag') : C().modelName(turn.model))}</span>` : '';
    const warn = turn.unknown && turn.unknown.length ? `<div class="warnline">⚠ ${esc(t('ac_unverified', { n: turn.unknown.join(', ') }))}</div>` : '';
    const charts = turn.status === 'done' ? turn.charts.map((ch) => `<div class="ac-chart">${chartHtml(ch)}</div>`).join('') : '';
    const btns = turn.status === 'done' && turn.buttons.length ? `<div class="ac-btns">${turn.buttons.map((b, k) => `<button class="btn small" data-ac-open="${i}:${k}">${esc(t('ac_open', { s: scrName(b.screen) }))}${b.id ? ' ' + esc(b.id) : ''}</button>`).join('')}</div>` : '';
    const srcs = turn.status === 'done' && turn.sources.length ? `<div class="ac-src"><b>${esc(t('ac_sources'))}</b> ${turn.sources.map((s) => `<span>${esc(sourceLabel(s))}</span>`).join('')}</div>` : '';
    return `<div class="ac-q"><div class="ac-ctx">${esc(turn.ctx)}</div>${esc(turn.q)}</div>
      <div class="ac-a" data-turn="${i}"><div class="c3-meta"><b class="ai-who">AI</b> ${meta}</div>${stepLine}<div class="c3-body" data-ac-text>${body}</div>${warn}${charts}${btns}${srcs}</div>`;
  }

  function render() {
    const p = panel();
    if (!p) return;
    const { esc } = A;
    const turns = conv.turns.map(turnHtml).join('');
    const sugg = conv.busy ? '' : `<div class="ac-sugg"><div class="hint">${esc(t('ac_suggest'))}</div>${suggestions().map((s) => `<button class="chip" data-ac-sugg="${s.id}">${esc(s.q)}</button>`).join('')}</div>`;
    const keyNote = C().settings.key ? '' : `<p class="hint">${esc(t('ac_needs_key'))}</p>`;
    p.innerHTML = `<div class="ac-wrap">
      <div class="ac-head"><h2>C-01 ${esc(t('ai_chat'))}</h2>
        <button class="btn small ghost" data-ac-new ${conv.turns.length ? '' : 'disabled'}>${esc(t('ac_new'))}</button>
        <button class="btn small ghost" data-ac-close aria-label="${esc(t('ac_close'))}" title="${esc(t('ac_close'))}">✕</button></div>
      <div class="ac-context"><b>${esc(t('ac_context'))}:</b> ${esc(ctxLabel())}</div>
      ${C().aiBarHtml()}
      <div class="ac-msgs" id="ac-msgs">${turns || `<p class="muted small">${esc(t('ac_hello'))}</p>`}${sugg}</div>
      <div class="ac-compose">${keyNote}
        <div class="c3-row"><textarea id="ac-text" rows="2" placeholder="${esc(t('ac_ph'))}" ${conv.busy ? 'disabled' : ''}>${esc(conv.draft)}</textarea>
        <button class="btn primary" data-ac-send ${conv.busy ? 'disabled' : ''}>${esc(t('c3_send'))}</button></div></div>
    </div>`;
    mount(p);
  }
  const scrollDown = () => { const b = document.getElementById('ac-msgs'); if (b) b.scrollTop = b.scrollHeight; };

  async function ask(q, suggestionId) {
    if (conv.busy || !q.trim()) return;
    const turn = newTurn(q.trim());
    conv.turns.push(turn);
    conv.busy = true;
    conv.draft = '';
    render(); scrollDown();
    const update = () => {
      const el = document.querySelector(`#chatpanel [data-turn="${conv.turns.indexOf(turn)}"] [data-ac-text]`);
      if (el) { el.textContent = turn.text; scrollDown(); }
    };
    try {
      if (!C().settings.key) {
        if (!suggestionId) throw new Error(t('ac_needs_key'));
        const text = demoAnswer(suggestionId, turn);
        turn.demo = true;
        const full = `${text}\n${t('ac_demo_note')}`;
        for (let k = 0; k <= full.length; k += 8) { turn.text = full.slice(0, k); update(); await new Promise((r) => setTimeout(r, 10)); }
        turn.text = full;
      } else {
        await askAi(turn, () => { if (A.state.chatOpen) { render(); scrollDown(); } }, update);
      }
      turn.status = 'done';
    } catch (e) {
      Object.assign(turn, { status: 'error', error: e.message });
    }
    conv.busy = false;
    if (A.state.chatOpen) { render(); scrollDown(); }
  }

  function mount(p) {
    const ta = p.querySelector('#ac-text');
    if (ta) {
      ta.addEventListener('input', () => { conv.draft = ta.value; });
      ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); ask(ta.value); } });
    }
    const send = p.querySelector('[data-ac-send]');
    if (send) send.addEventListener('click', () => ask(ta.value));
    p.querySelectorAll('[data-ac-sugg]').forEach((b) => b.addEventListener('click', () => ask(b.textContent, b.dataset.acSugg)));
    p.querySelectorAll('[data-ac-open]').forEach((b) => b.addEventListener('click', () => {
      const [i, k] = b.dataset.acOpen.split(':').map(Number);
      const btn = conv.turns[i] && conv.turns[i].buttons[k];
      if (btn) A.go(btn.screen, btn.params);
    }));
    const nw = p.querySelector('[data-ac-new]');
    if (nw) nw.addEventListener('click', () => { if (!conv.busy) { conv = S0(); render(); } });
    const cl = p.querySelector('[data-ac-close]');
    if (cl) cl.addEventListener('click', () => { A.state.chatOpen = false; A.render(); });
    C().bindAiBar(p, () => { if (ta) conv.draft = ta.value; });
    scrollDown();
  }

  A.AiChat = { render, ask, TOOLS, runTool, reset: () => { conv = S0(); }, get conv() { return conv; } };

  /* ================================================================ strings */
  I18N.add({
    en: {
      ac_new: 'New chat', ac_close: 'Close', ac_context: 'Context', ac_ph: 'Ask about this screen… (Ctrl+Enter to send)',
      ac_hello: 'Ask about the figures on this screen and the data behind them (accounts, breakdowns, Points, Actions, Forecast). Answers use the period and organization above; the AI only quotes figures from the app and cannot change data.',
      ac_suggest: 'Suggested questions', ac_needs_key: 'Free-text questions need an API key. Try a suggested question, or set a key above.',
      ac_working: 'Looking at the data…', ac_sources: 'Sources:', ac_open: 'Open {s}', ac_demo_tag: 'pre-written demo answer',
      ac_demo_note: '(Pre-written demo answer built from the app\'s data. Set an API key to ask your own questions.)',
      ac_unverified: 'Check: {n} does not appear in the data the AI looked at.', ac_too_many: 'The question needed too many steps. Please ask a narrower question.',
      ac_ytd: 'YTD', ac_def: 'definition', ac_chart_var: '{m}: actual − budget', ac_sc_ACT: 'Actual', ac_sc_BUD: 'Budget', ac_sc_PY: 'Prior year', ac_sc_FCST: 'Forecast',
      ac_tool_get_screen_context: 'screen', ac_tool_get_kpis: 'KPIs', ac_tool_get_metric_definition: 'Metric definition', ac_tool_query_financials: 'BI query',
      ac_tool_get_points: 'Points', ac_tool_get_actions: 'Actions', ac_tool_get_forecast: 'Forecast', ac_tool_what_if_stop_action: 'what-if', ac_tool_open_screen: 'link',
      ac_dim_org: 'department', ac_dim_customer: 'customer', ac_above: 'above', ac_below: 'below', ac_progress: 'progress', ac_outlook_vs_plan: 'outlook vs plan',
      ac_s_op: 'Why is operating profit different from budget?', ac_s_break: 'Break down the operating profit gap by {dim}', ac_s_sga: 'How is SG&A calculated?',
      ac_s_point: 'Summarize Point {id}', ac_s_whatif: 'What if {id} is stopped?', ac_s_behind: 'Which Actions are behind plan?', ac_s_fcst: 'What drives the landing versus budget?',
      ac_d_op: 'Operating profit YTD is {a} against a budget of {b}, {v} ({dir} budget). The largest Points are {pts}. Variance not explained by Points: {o}.',
      ac_d_break: 'Operating profit actual minus budget YTD by {dim}: the largest gaps are {list}. Total gap {v}.',
      ac_d_sga: 'SG&A is the sum of these expense accounts: {accounts}. Operating profit = gross profit − SG&A, so higher SG&A lowers profit. YTD SG&A is {a} against a budget of {b} ({v}).',
      ac_d_point: '{id} {title}: operating profit impact YTD {op}. Main causes: {causes}. Actions: {n} proposed, {e} executing.',
      ac_d_whatif: 'If {id} stopped now, it keeps the {r} already realized and loses {rem} of open-month outlook. The operating profit landing would move from {l0} to {l1} (budget {b}).',
      ac_d_behind: 'Behind plan:\n- {list}', ac_d_behind_none: 'No adopted Action is behind plan as of {m}.',
      ac_d_fcst: 'The operating profit landing is {l} against a budget of {b} ({v}). Without Actions the forecast is {base}; adopted Actions add {act} and Individual Factors {fac}.',
    },
    ja: {
      ac_new: '新しいチャット', ac_close: '閉じる', ac_context: '文脈', ac_ph: 'この画面について質問…（Ctrl+Enterで送信）',
      ac_hello: 'この画面の数値と、その元になるデータ（科目・内訳・ポイント・施策・着地見込）について質問できます。回答は上の年月度・組織が前提です。AIはアプリの数値だけを引用し、データは変更できません。',
      ac_suggest: '質問の例', ac_needs_key: '自由入力の質問にはAPIキーが必要です。質問の例を試すか、上でキーを設定してください。',
      ac_working: 'データを確認中…', ac_sources: '出典：', ac_open: '{s} を開く', ac_demo_tag: 'デモ用の定型回答',
      ac_demo_note: '（アプリのデータから作成したデモ用の定型回答です。自由な質問にはAPIキーを設定してください。）',
      ac_unverified: '確認：{n} はAIが参照したデータにありません。', ac_too_many: '手順が多すぎました。質問を絞ってください。',
      ac_ytd: '累計', ac_def: '定義', ac_chart_var: '{m}：実績－予算', ac_sc_ACT: '実績', ac_sc_BUD: '予算', ac_sc_PY: '前年', ac_sc_FCST: '着地見込',
      ac_tool_get_screen_context: '画面', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: 'Metricsの定義', ac_tool_query_financials: 'BI照会',
      ac_tool_get_points: 'ポイント', ac_tool_get_actions: '施策', ac_tool_get_forecast: '着地見込', ac_tool_what_if_stop_action: '試算', ac_tool_open_screen: 'リンク',
      ac_dim_org: '部門', ac_dim_customer: '顧客', ac_above: '上回る', ac_below: '下回る', ac_progress: '進捗', ac_outlook_vs_plan: '見込－計画',
      ac_s_op: '営業利益が予算と違うのはなぜ？', ac_s_break: '営業利益の差を{dim}別に分解して', ac_s_sga: '販管費はどう計算されている？',
      ac_s_point: 'ポイント {id} を要約して', ac_s_whatif: '{id} を中止したら？', ac_s_behind: '計画より遅れている施策は？', ac_s_fcst: '着地見込と予算の差の要因は？',
      ac_d_op: '営業利益の累計は {a}（予算 {b}）で、差は {v}（予算を{dir}）です。主なポイントは {pts} です。ポイントで説明できない差：{o}。',
      ac_d_break: '{dim}別の営業利益（累計、実績－予算）で差が大きいのは {list} です。差の合計 {v}。',
      ac_d_sga: '販管費は次の費用科目の合計です：{accounts}。営業利益＝売上総利益－販管費のため、販管費が増えると利益が減ります。販管費の累計は {a}（予算 {b}、差 {v}）です。',
      ac_d_point: '{id} {title}：営業利益への影響（累計）{op}。主な原因：{causes}。施策：提案 {n} 件、実行中 {e} 件。',
      ac_d_whatif: '{id} を今中止すると、実現済みの {r} は残り、未経過月の見込 {rem} がなくなります。営業利益の着地見込は {l0} から {l1} になります（予算 {b}）。',
      ac_d_behind: '計画より遅れている施策：\n- {list}', ac_d_behind_none: '{m} 時点で計画より遅れている採用済み施策はありません。',
      ac_d_fcst: '営業利益の着地見込は {l}（予算 {b}、差 {v}）です。施策なしの予測は {base}、採用済み施策が {act}、個別要因が {fac} です。',
    },
    th: {
      ac_new: 'แชทใหม่', ac_close: 'ปิด', ac_context: 'บริบท', ac_ph: 'ถามเกี่ยวกับหน้าจอนี้… (Ctrl+Enter เพื่อส่ง)',
      ac_hello: 'ถามเกี่ยวกับตัวเลขในหน้าจอนี้และข้อมูลเบื้องหลัง (บัญชี การแยกย่อย Point แอคชัน การคาดการณ์) คำตอบอ้างอิงงวดและองค์กรด้านบน AI อ้างอิงเฉพาะตัวเลขในแอปและแก้ไขข้อมูลไม่ได้',
      ac_suggest: 'ตัวอย่างคำถาม', ac_needs_key: 'คำถามแบบพิมพ์เองต้องใช้ API key ลองใช้ตัวอย่างคำถาม หรือตั้งค่า key ด้านบน',
      ac_working: 'กำลังดูข้อมูล…', ac_sources: 'แหล่งที่มา:', ac_open: 'เปิด {s}', ac_demo_tag: 'คำตอบตัวอย่างสำหรับเดโม',
      ac_demo_note: '(คำตอบตัวอย่างที่สร้างจากข้อมูลในแอป ตั้งค่า API key เพื่อถามคำถามของคุณเอง)',
      ac_unverified: 'ตรวจสอบ: {n} ไม่มีอยู่ในข้อมูลที่ AI ใช้', ac_too_many: 'คำถามนี้ใช้หลายขั้นตอนเกินไป โปรดถามให้แคบลง',
      ac_ytd: 'สะสม', ac_def: 'นิยาม', ac_chart_var: '{m}: ผลจริง − งบประมาณ', ac_sc_ACT: 'ผลจริง', ac_sc_BUD: 'งบประมาณ', ac_sc_PY: 'ปีก่อน', ac_sc_FCST: 'คาดการณ์',
      ac_tool_get_screen_context: 'หน้าจอ', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: 'นิยาม Metric', ac_tool_query_financials: 'คิวรี BI',
      ac_tool_get_points: 'Point', ac_tool_get_actions: 'แอคชัน', ac_tool_get_forecast: 'คาดการณ์', ac_tool_what_if_stop_action: 'จำลอง', ac_tool_open_screen: 'ลิงก์',
      ac_dim_org: 'แผนก', ac_dim_customer: 'ลูกค้า', ac_above: 'สูงกว่า', ac_below: 'ต่ำกว่า', ac_progress: 'ความคืบหน้า', ac_outlook_vs_plan: 'คาดการณ์เทียบแผน',
      ac_s_op: 'ทำไมกำไรจากการดำเนินงานต่างจากงบประมาณ?', ac_s_break: 'แยกส่วนต่างกำไรจากการดำเนินงานตาม{dim}', ac_s_sga: 'ค่าใช้จ่ายขายและบริหารคำนวณอย่างไร?',
      ac_s_point: 'สรุป Point {id}', ac_s_whatif: 'ถ้าหยุด {id} จะเป็นอย่างไร?', ac_s_behind: 'แอคชันใดล่าช้ากว่าแผน?', ac_s_fcst: 'อะไรทำให้คาดการณ์ต่างจากงบประมาณ?',
      ac_d_op: 'กำไรจากการดำเนินงานสะสมอยู่ที่ {a} เทียบงบประมาณ {b} ส่วนต่าง {v} ({dir}งบประมาณ) Point ที่ใหญ่ที่สุดคือ {pts} ส่วนต่างที่ Point อธิบายไม่ได้: {o}',
      ac_d_break: 'กำไรจากการดำเนินงานสะสม (ผลจริง − งบประมาณ) ตาม{dim}: ส่วนต่างมากที่สุดคือ {list} ส่วนต่างรวม {v}',
      ac_d_sga: 'ค่าใช้จ่ายขายและบริหารคือผลรวมของบัญชีค่าใช้จ่ายเหล่านี้: {accounts} กำไรจากการดำเนินงาน = กำไรขั้นต้น − ค่าใช้จ่ายขายและบริหาร ค่าใช้จ่ายที่สูงขึ้นจึงลดกำไร ยอดสะสม {a} เทียบงบประมาณ {b} ({v})',
      ac_d_point: '{id} {title}: ผลกระทบต่อกำไรจากการดำเนินงานสะสม {op} สาเหตุหลัก: {causes} แอคชัน: เสนอ {n} รายการ กำลังดำเนินการ {e} รายการ',
      ac_d_whatif: 'ถ้าหยุด {id} ตอนนี้ จะคงผลที่เกิดขึ้นแล้ว {r} และเสียคาดการณ์ของเดือนที่เหลือ {rem} คาดการณ์กำไรจากการดำเนินงานจะเปลี่ยนจาก {l0} เป็น {l1} (งบประมาณ {b})',
      ac_d_behind: 'ล่าช้ากว่าแผน:\n- {list}', ac_d_behind_none: 'ไม่มีแอคชันที่อนุมัติแล้วล่าช้ากว่าแผน ณ {m}',
      ac_d_fcst: 'คาดการณ์กำไรจากการดำเนินงานอยู่ที่ {l} เทียบงบประมาณ {b} ({v}) หากไม่มีแอคชันจะเป็น {base} แอคชันที่อนุมัติเพิ่ม {act} และปัจจัยเฉพาะ {fac}',
    },
    'zh-Hans': {
      ac_new: '新对话', ac_close: '关闭', ac_context: '上下文', ac_ph: '询问此画面…（Ctrl+Enter 发送）',
      ac_hello: '可询问此画面上的数值及其背后的数据（科目、细分、要点、行动、预测）。回答以上方的期间和组织为前提；AI只引用应用中的数值，不能修改数据。',
      ac_suggest: '推荐问题', ac_needs_key: '自由输入的问题需要API密钥。请尝试推荐问题，或在上方设置密钥。',
      ac_working: '正在查看数据…', ac_sources: '来源：', ac_open: '打开 {s}', ac_demo_tag: '演示用预设回答',
      ac_demo_note: '（根据应用数据生成的演示用预设回答。设置API密钥后可自由提问。）',
      ac_unverified: '请确认：{n} 不在AI查看的数据中。', ac_too_many: '此问题需要的步骤过多，请缩小问题范围。',
      ac_ytd: '累计', ac_def: '定义', ac_chart_var: '{m}：实际－预算', ac_sc_ACT: '实际', ac_sc_BUD: '预算', ac_sc_PY: '上年', ac_sc_FCST: '预测',
      ac_tool_get_screen_context: '画面', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: '指标定义', ac_tool_query_financials: 'BI查询',
      ac_tool_get_points: '要点', ac_tool_get_actions: '行动', ac_tool_get_forecast: '预测', ac_tool_what_if_stop_action: '模拟', ac_tool_open_screen: '链接',
      ac_dim_org: '部门', ac_dim_customer: '客户', ac_above: '高于', ac_below: '低于', ac_progress: '进度', ac_outlook_vs_plan: '预测－计划',
      ac_s_op: '营业利润为什么与预算不同？', ac_s_break: '按{dim}分解营业利润差异', ac_s_sga: '销售及管理费用如何计算？',
      ac_s_point: '总结要点 {id}', ac_s_whatif: '如果停止 {id} 会怎样？', ac_s_behind: '哪些行动落后于计划？', ac_s_fcst: '年末预测与预算差异的原因是什么？',
      ac_d_op: '营业利润累计 {a}，预算 {b}，差异 {v}（{dir}预算）。最大的要点是 {pts}。要点无法解释的差异：{o}。',
      ac_d_break: '按{dim}的营业利润累计（实际－预算）：差异最大的是 {list}。差异合计 {v}。',
      ac_d_sga: '销售及管理费用是以下费用科目的合计：{accounts}。营业利润＝毛利－销售及管理费用，因此费用增加会降低利润。累计 {a}，预算 {b}（{v}）。',
      ac_d_point: '{id} {title}：营业利润影响（累计）{op}。主要原因：{causes}。行动：提案 {n} 项，执行中 {e} 项。',
      ac_d_whatif: '如果现在停止 {id}，已实现的 {r} 保留，剩余月份的预测 {rem} 将消失。营业利润年末预测将从 {l0} 变为 {l1}（预算 {b}）。',
      ac_d_behind: '落后于计划：\n- {list}', ac_d_behind_none: '截至 {m}，没有落后于计划的已采纳行动。',
      ac_d_fcst: '营业利润年末预测为 {l}，预算 {b}（{v}）。无行动时的预测为 {base}；已采纳行动 {act}，个别因素 {fac}。',
    },
    'zh-Hant': {
      ac_new: '新對話', ac_close: '關閉', ac_context: '情境', ac_ph: '詢問此畫面…（Ctrl+Enter 傳送）',
      ac_hello: '可詢問此畫面上的數值及其背後的資料（科目、細分、要點、行動、預測）。回答以上方的期間與組織為前提；AI只引用應用程式中的數值，無法修改資料。',
      ac_suggest: '建議問題', ac_needs_key: '自由輸入的問題需要API金鑰。請嘗試建議問題，或在上方設定金鑰。',
      ac_working: '正在查看資料…', ac_sources: '來源：', ac_open: '開啟 {s}', ac_demo_tag: '示範用預設回答',
      ac_demo_note: '（根據應用程式資料產生的示範用預設回答。設定API金鑰後即可自由提問。）',
      ac_unverified: '請確認：{n} 不在AI查看的資料中。', ac_too_many: '此問題需要的步驟過多，請縮小問題範圍。',
      ac_ytd: '累計', ac_def: '定義', ac_chart_var: '{m}：實際－預算', ac_sc_ACT: '實際', ac_sc_BUD: '預算', ac_sc_PY: '前一年', ac_sc_FCST: '預測',
      ac_tool_get_screen_context: '畫面', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: '指標定義', ac_tool_query_financials: 'BI查詢',
      ac_tool_get_points: '要點', ac_tool_get_actions: '行動', ac_tool_get_forecast: '預測', ac_tool_what_if_stop_action: '模擬', ac_tool_open_screen: '連結',
      ac_dim_org: '部門', ac_dim_customer: '客戶', ac_above: '高於', ac_below: '低於', ac_progress: '進度', ac_outlook_vs_plan: '預測－計畫',
      ac_s_op: '營業利益為什麼與預算不同？', ac_s_break: '按{dim}分解營業利益差異', ac_s_sga: '銷售及管理費用如何計算？',
      ac_s_point: '摘要要點 {id}', ac_s_whatif: '如果停止 {id} 會怎樣？', ac_s_behind: '哪些行動落後於計畫？', ac_s_fcst: '年底預測與預算差異的原因是什麼？',
      ac_d_op: '營業利益累計 {a}，預算 {b}，差異 {v}（{dir}預算）。最大的要點是 {pts}。要點無法解釋的差異：{o}。',
      ac_d_break: '按{dim}的營業利益累計（實際－預算）：差異最大的是 {list}。差異合計 {v}。',
      ac_d_sga: '銷售及管理費用是以下費用科目的合計：{accounts}。營業利益＝毛利－銷售及管理費用，因此費用增加會降低利益。累計 {a}，預算 {b}（{v}）。',
      ac_d_point: '{id} {title}：營業利益影響（累計）{op}。主要原因：{causes}。行動：提案 {n} 項，執行中 {e} 項。',
      ac_d_whatif: '如果現在停止 {id}，已實現的 {r} 保留，剩餘月份的預測 {rem} 將消失。營業利益年底預測將從 {l0} 變為 {l1}（預算 {b}）。',
      ac_d_behind: '落後於計畫：\n- {list}', ac_d_behind_none: '截至 {m}，沒有落後於計畫的已採納行動。',
      ac_d_fcst: '營業利益年底預測為 {l}，預算 {b}（{v}）。無行動時的預測為 {base}；已採納行動 {act}，個別因素 {fac}。',
    },
    id: {
      ac_new: 'Obrolan baru', ac_close: 'Tutup', ac_context: 'Konteks', ac_ph: 'Tanya tentang layar ini… (Ctrl+Enter untuk mengirim)',
      ac_hello: 'Tanyakan angka di layar ini dan data di baliknya (akun, rincian, Point, aksi, proyeksi). Jawaban memakai periode dan organisasi di atas; AI hanya mengutip angka dari aplikasi dan tidak dapat mengubah data.',
      ac_suggest: 'Contoh pertanyaan', ac_needs_key: 'Pertanyaan bebas memerlukan kunci API. Coba contoh pertanyaan, atau atur kunci di atas.',
      ac_working: 'Memeriksa data…', ac_sources: 'Sumber:', ac_open: 'Buka {s}', ac_demo_tag: 'jawaban demo yang sudah disiapkan',
      ac_demo_note: '(Jawaban demo yang disusun dari data aplikasi. Atur kunci API untuk mengajukan pertanyaan sendiri.)',
      ac_unverified: 'Periksa: {n} tidak ada di data yang dilihat AI.', ac_too_many: 'Pertanyaan ini memerlukan terlalu banyak langkah. Persempit pertanyaannya.',
      ac_ytd: 'YTD', ac_def: 'definisi', ac_chart_var: '{m}: aktual − anggaran', ac_sc_ACT: 'Aktual', ac_sc_BUD: 'Anggaran', ac_sc_PY: 'Tahun lalu', ac_sc_FCST: 'Proyeksi',
      ac_tool_get_screen_context: 'layar', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: 'definisi metrik', ac_tool_query_financials: 'kueri BI',
      ac_tool_get_points: 'Point', ac_tool_get_actions: 'aksi', ac_tool_get_forecast: 'proyeksi', ac_tool_what_if_stop_action: 'simulasi', ac_tool_open_screen: 'tautan',
      ac_dim_org: 'departemen', ac_dim_customer: 'pelanggan', ac_above: 'di atas', ac_below: 'di bawah', ac_progress: 'progres', ac_outlook_vs_plan: 'proyeksi vs rencana',
      ac_s_op: 'Mengapa laba operasi berbeda dari anggaran?', ac_s_break: 'Rinci selisih laba operasi per {dim}', ac_s_sga: 'Bagaimana SG&A dihitung?',
      ac_s_point: 'Ringkas Point {id}', ac_s_whatif: 'Bagaimana jika {id} dihentikan?', ac_s_behind: 'Aksi mana yang tertinggal dari rencana?', ac_s_fcst: 'Apa penyebab selisih proyeksi dengan anggaran?',
      ac_d_op: 'Laba operasi YTD {a} dibanding anggaran {b}, selisih {v} ({dir} anggaran). Point terbesar: {pts}. Selisih yang tidak dijelaskan Point: {o}.',
      ac_d_break: 'Laba operasi YTD (aktual − anggaran) per {dim}: selisih terbesar adalah {list}. Total selisih {v}.',
      ac_d_sga: 'SG&A adalah jumlah akun beban berikut: {accounts}. Laba operasi = laba kotor − SG&A, jadi SG&A yang lebih tinggi menurunkan laba. SG&A YTD {a} dibanding anggaran {b} ({v}).',
      ac_d_point: '{id} {title}: dampak laba operasi YTD {op}. Penyebab utama: {causes}. Aksi: {n} diusulkan, {e} berjalan.',
      ac_d_whatif: 'Jika {id} dihentikan sekarang, {r} yang sudah terealisasi tetap ada dan {rem} proyeksi bulan berikutnya hilang. Proyeksi laba operasi berubah dari {l0} menjadi {l1} (anggaran {b}).',
      ac_d_behind: 'Tertinggal dari rencana:\n- {list}', ac_d_behind_none: 'Tidak ada aksi yang diadopsi yang tertinggal dari rencana per {m}.',
      ac_d_fcst: 'Proyeksi laba operasi {l} dibanding anggaran {b} ({v}). Tanpa aksi proyeksinya {base}; aksi yang diadopsi menambah {act} dan faktor individual {fac}.',
    },
    vi: {
      ac_new: 'Trò chuyện mới', ac_close: 'Đóng', ac_context: 'Ngữ cảnh', ac_ph: 'Hỏi về màn hình này… (Ctrl+Enter để gửi)',
      ac_hello: 'Hỏi về số liệu trên màn hình này và dữ liệu phía sau (tài khoản, phân tích chi tiết, Point, hành động, dự báo). Câu trả lời dựa trên kỳ và tổ chức ở trên; AI chỉ trích dẫn số liệu của ứng dụng và không thể thay đổi dữ liệu.',
      ac_suggest: 'Câu hỏi gợi ý', ac_needs_key: 'Câu hỏi tự do cần khóa API. Hãy thử câu hỏi gợi ý hoặc đặt khóa ở trên.',
      ac_working: 'Đang xem dữ liệu…', ac_sources: 'Nguồn:', ac_open: 'Mở {s}', ac_demo_tag: 'câu trả lời demo soạn sẵn',
      ac_demo_note: '(Câu trả lời demo soạn sẵn từ dữ liệu của ứng dụng. Đặt khóa API để tự đặt câu hỏi.)',
      ac_unverified: 'Kiểm tra: {n} không có trong dữ liệu AI đã xem.', ac_too_many: 'Câu hỏi cần quá nhiều bước. Hãy hỏi hẹp hơn.',
      ac_ytd: 'Lũy kế', ac_def: 'định nghĩa', ac_chart_var: '{m}: thực tế − ngân sách', ac_sc_ACT: 'Thực tế', ac_sc_BUD: 'Ngân sách', ac_sc_PY: 'Năm trước', ac_sc_FCST: 'Dự báo',
      ac_tool_get_screen_context: 'màn hình', ac_tool_get_kpis: 'KPI', ac_tool_get_metric_definition: 'định nghĩa chỉ số', ac_tool_query_financials: 'truy vấn BI',
      ac_tool_get_points: 'Point', ac_tool_get_actions: 'hành động', ac_tool_get_forecast: 'dự báo', ac_tool_what_if_stop_action: 'mô phỏng', ac_tool_open_screen: 'liên kết',
      ac_dim_org: 'phòng ban', ac_dim_customer: 'khách hàng', ac_above: 'cao hơn', ac_below: 'thấp hơn', ac_progress: 'tiến độ', ac_outlook_vs_plan: 'dự báo so với kế hoạch',
      ac_s_op: 'Vì sao lợi nhuận hoạt động khác ngân sách?', ac_s_break: 'Phân tích chênh lệch lợi nhuận hoạt động theo {dim}', ac_s_sga: 'Chi phí bán hàng và quản lý được tính thế nào?',
      ac_s_point: 'Tóm tắt Point {id}', ac_s_whatif: 'Nếu dừng {id} thì sao?', ac_s_behind: 'Hành động nào chậm so với kế hoạch?', ac_s_fcst: 'Điều gì tạo ra chênh lệch giữa dự báo và ngân sách?',
      ac_d_op: 'Lợi nhuận hoạt động lũy kế là {a} so với ngân sách {b}, chênh lệch {v} ({dir} ngân sách). Các Point lớn nhất: {pts}. Chênh lệch không được Point giải thích: {o}.',
      ac_d_break: 'Lợi nhuận hoạt động lũy kế (thực tế − ngân sách) theo {dim}: chênh lệch lớn nhất là {list}. Tổng chênh lệch {v}.',
      ac_d_sga: 'Chi phí bán hàng và quản lý là tổng các tài khoản chi phí sau: {accounts}. Lợi nhuận hoạt động = lợi nhuận gộp − chi phí này, nên chi phí cao hơn làm giảm lợi nhuận. Lũy kế {a} so với ngân sách {b} ({v}).',
      ac_d_point: '{id} {title}: tác động lũy kế đến lợi nhuận hoạt động {op}. Nguyên nhân chính: {causes}. Hành động: {n} đề xuất, {e} đang thực hiện.',
      ac_d_whatif: 'Nếu dừng {id} ngay bây giờ, phần {r} đã thực hiện được giữ lại và mất {rem} dự báo của các tháng còn lại. Dự báo lợi nhuận hoạt động sẽ đổi từ {l0} thành {l1} (ngân sách {b}).',
      ac_d_behind: 'Chậm so với kế hoạch:\n- {list}', ac_d_behind_none: 'Không có hành động đã thông qua nào chậm so với kế hoạch tính đến {m}.',
      ac_d_fcst: 'Dự báo lợi nhuận hoạt động là {l} so với ngân sách {b} ({v}). Không có hành động, dự báo là {base}; hành động đã thông qua thêm {act} và yếu tố riêng {fac}.',
    },
  });
})();
