/* B-02 Reporting — README §5.2. Standard reports by category, built on the same measures as B-01
 * (M.biQuery) and F-01 (confirmed Forecast versions), so the figures agree across screens. */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const CATS = ['REVENUE', 'COST', 'PERIODIC', 'BUDGET', 'ACTIONS'];
  /** basis: single-month / YTD option applies · cmp: budget / prior-year options apply · version: uses a confirmed Forecast version. */
  const REPORTS = [
    { id: 'REV_CUSTOMER', cat: 'REVENUE', basis: true, cmp: true },
    { id: 'REV_REGION_PRODUCT', cat: 'REVENUE', basis: true, cmp: true },
    { id: 'COST_PRODUCT', cat: 'COST', basis: true, cmp: true },
    { id: 'COST_VARIANCE', cat: 'COST', basis: true, cmp: true },
    { id: 'MONTHLY', cat: 'PERIODIC', basis: true, cmp: true, version: true },
    { id: 'QUARTERLY', cat: 'PERIODIC', cmp: true },
    { id: 'BVA', cat: 'BUDGET', basis: true, cmp: true },
    { id: 'LANDING', cat: 'BUDGET', version: true },
    { id: 'ACTIONS', cat: 'ACTIONS' },
  ];
  const ui = { reportId: 'MONTHLY', basis: 'YTD', budget: true, py: true, ai: true, version: '' };

  const dash = '<span class="faint">–</span>';
  const report = () => REPORTS.find((r) => r.id === ui.reportId) || REPORTS[0];
  const basisPeriods = () => (ui.basis === 'MONTH' ? [A.state.periodId] : A.M.ytdPeriods(A.state.periodId));
  const basisLabel = () => (ui.basis === 'MONTH' ? A.periodLabel(A.state.periodId) : A.ytdLabel());
  const fyOf = () => A.M.period(A.state.periodId).fiscal_year;
  const val = (measure, scenario, filters, periods, orgId) => A.M.biValue(orgId || A.state.orgId, periods || basisPeriods(), measure, scenario, filters, A.state.periodId);
  const sumBy = (rows, k) => { const xs = rows.map((r) => r[k]).filter((v) => v !== null && v !== undefined); return xs.length ? A.M.r2(xs.reduce((a, b) => a + b, 0)) : null; };
  const toneOf = (measure, v) => (v === null || Math.abs(v) < 0.005 ? '' : A.M.biFavorable(measure, v) ? 'good' : 'bad');
  const pct = (a, b) => (a === null || b === null || !b ? null : ((a - b) / Math.abs(b)) * 100);
  const numCell = (v, cls = '', digits = 1) => `<td class="num ${cls}">${v === null || v === undefined ? dash : A.fmt(v, digits)}</td>`;
  const signCell = (v, cls = '', suffix = '') => `<td class="num ${cls}">${v === null || v === undefined ? dash : A.fmtSigned(v) + suffix}</td>`;

  /* ---------------------------------------------------------------- favorites */
  /* In-memory stand-in for a per-user favorites table (app_report_favorite: user_id, report_id). */
  const favTable = () => (A.db.app_report_favorite = A.db.app_report_favorite || []);
  const isFav = (id) => favTable().some((f) => f.user_id === A.state.userId && f.report_id === id);
  function toggleFav(id) {
    const tbl = favTable();
    const i = tbl.findIndex((f) => f.user_id === A.state.userId && f.report_id === id);
    if (i >= 0) tbl.splice(i, 1); else tbl.push({ user_id: A.state.userId, report_id: id });
  }

  /* ---------------------------------------------------------------- confirmed Forecast version */
  /** Department: its own confirmed versions. Company / division: Σ latest confirmed versions as of a closed month. */
  function versionChoices() {
    const { M, state, t } = A;
    const org = M.org(state.orgId);
    if (org.is_leaf) {
      return M.versionsFor(state.orgId).filter((v) => v.as_of_period_id <= state.periodId)
        .map((v) => ({ key: 'V:' + v.forecast_version_id, label: t('ver_label', { n: v.version_no, date: A.periodLabel(v.as_of_period_id) }), vid: v.forecast_version_id, asOf: v.as_of_period_id }));
    }
    const leaves = new Set(M.leafOrgs(state.orgId));
    const asOfs = [...new Set(A.db.app_forecast_version.filter((v) => leaves.has(v.org_id) && v.as_of_period_id <= state.periodId).map((v) => v.as_of_period_id))].sort((a, b) => b - a);
    return asOfs.map((p) => ({ key: 'P:' + p, label: t('rp_latest_asof', { month: A.periodLabel(p) }), asOf: p }));
  }
  function versionCtx() {
    const choices = versionChoices();
    const cur = choices.find((c) => c.key === ui.version) || choices[0] || null;
    if (!cur) return { choices, cur: null };
    const { M, state } = A;
    const figures = (m) => (cur.vid ? M.versionFigures(cur.vid, m) : M.forecastRollup(state.orgId, cur.asOf, m));
    const monthly = (m) => (cur.vid ? M.versionMonthly([cur.vid], m, fyOf()) : M.forecastMonthlyRollup(state.orgId, cur.asOf, m));
    const missing = cur.vid ? [] : M.forecastRollup(state.orgId, cur.asOf, 'OP').missing;
    return { choices, cur, figures, monthly, missing };
  }

  /* ---------------------------------------------------------------- comparison table */
  /** rows: [{ label, measure, act, bud, py, cls, indent, na }] → Actual | Budget, Variance, % | Prior year, YoY %. */
  function cmpTable(firstHead, rows, extra = []) {
    const { t, esc } = A;
    const head = `<tr><th>${esc(firstHead)}</th><th class="num">${esc(t('actual'))}</th>
      ${ui.budget ? `<th class="num">${esc(t('budget'))}</th><th class="num">${esc(t('rp_variance'))}</th><th class="num">${esc(t('rp_var_pct'))}</th>` : ''}
      ${ui.py ? `<th class="num">${esc(t('prior_year'))}</th><th class="num">${esc(t('rp_yoy'))}</th>` : ''}
      ${extra.map((x) => `<th class="num">${esc(x.head)}</th>`).join('')}</tr>`;
    const span = 1 + (ui.budget ? 3 : 0) + (ui.py ? 2 : 0) + extra.length;
    const body = rows.map((r) => {
      const label = `<td class="${r.indent ? 'rp-indent' : ''}">${r.html || esc(r.label)}</td>`;
      if (r.na) return `<tr class="${r.cls || ''}">${label}<td class="num faint" colspan="${span}">${esc(t('na'))}</td></tr>`;
      const v = r.act !== null && r.bud !== null ? A.M.r2(r.act - r.bud) : null;
      const y = r.act !== null && r.py !== null ? A.M.r2(r.act - r.py) : null;
      return `<tr class="${r.cls || ''}">${label}${numCell(r.act)}
        ${ui.budget ? numCell(r.bud, 'muted') + signCell(v, toneOf(r.measure, v)) + signCell(pct(r.act, r.bud), toneOf(r.measure, v), '%') : ''}
        ${ui.py ? numCell(r.py, 'muted') + signCell(pct(r.act, r.py), toneOf(r.measure, y), '%') : ''}
        ${extra.map((x) => x.cell(r)).join('')}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table class="grid-table rp-table"><thead>${head}</thead><tbody>${body || `<tr><td colspan="${span + 1}" class="muted">${esc(t('bi_no_data'))}</td></tr>`}</tbody></table></div>`;
  }
  /** One row per member of a dimension, plus a total row. */
  function dimRows(dim, measure, filters = {}) {
    const { M, state } = A;
    const q = M.biQuery({ orgId: state.orgId, periods: basisPeriods(), measure, scenarios: ['ACT', 'BUD', 'PY'], groupBy: [dim, 'scenario'], filters, asOf: state.periodId });
    const by = new Map();
    q.rows.forEach((r) => { if (!by.has(r.key[0])) by.set(r.key[0], {}); by.get(r.key[0])[r.key[1]] = r.value; });
    return A.Bi.sortMembers(dim, [...by.keys()]).map((m) => {
      const x = by.get(m);
      return { member: m, label: A.Bi.memberLabel(dim, m), measure, act: x.ACT ?? null, bud: x.BUD ?? null, py: x.PY ?? null };
    });
  }
  const totalRow = (rows, measure, label) => ({ label: label || A.t('units_total'), measure, act: sumBy(rows, 'act'), bud: sumBy(rows, 'bud'), py: sumBy(rows, 'py'), cls: 'other-row total-row' });
  const metricRow = (m, extra = {}) => (A.M.biApplicable(A.state.orgId, m)
    ? Object.assign({ label: A.t('bi_m_' + m), measure: m, act: val(m, 'ACT'), bud: val(m, 'BUD'), py: val(m, 'PY') }, extra)
    : Object.assign({ label: A.t('bi_m_' + m), measure: m, na: true }, extra));

  /** Grouped bars: Actual vs Budget (and prior year) per label. */
  function cmpChart(rows, labelOf) {
    const { t } = A;
    const short = (s) => (s.length > 14 ? s.slice(0, 13) + '…' : s);
    const list = rows.filter((r) => !r.na);
    if (!list.length) return '';
    const series = [{ name: t('actual'), type: 'bar', color: 'var(--chart-actual)', values: list.map((r) => r.act) }];
    if (ui.budget) series.push({ name: t('budget'), type: 'bar', color: 'var(--chart-budget)', values: list.map((r) => r.bud) });
    if (ui.py) series.push({ name: t('prior_year'), type: 'bar', color: 'var(--chart-py)', values: list.map((r) => r.py) });
    return A.Chart.monthly(series, { labels: list.map((r) => short(labelOf ? labelOf(r) : r.label)), width: 760, height: 240 });
  }
  const naBox = (m) => `<div class="placeholder">${A.esc(A.t('bi_na_org', { measure: A.t('bi_m_' + m), org: A.orgName(A.state.orgId) }))}</div>`;
  const section = (title, html, hint) => ({ title, html, hint });

  /* ---------------------------------------------------------------- report builders */
  const BUILD = {
    REV_CUSTOMER() {
      const { t, esc, M, state } = A;
      if (!M.biApplicable(state.orgId, 'REV')) return { sections: [section('', naBox('REV'))] };
      const rows = dimRows('customer', 'REV').map((r) => Object.assign(r, { region: (M.customer(r.member) || {}).region || '' }));
      const total = totalRow(rows, 'REV');
      const share = { head: t('bi_share'), cell: (r) => `<td class="num muted">${r.act === null || !total.act || r.cls ? (r.cls ? '100%' : dash) : A.fmt((r.act / total.act) * 100) + '%'}</td>` };
      rows.forEach((r) => { r.html = `${esc(r.label)} <span class="faint small">${esc(r.region)}</span>`; });
      return { chart: cmpChart(rows), sections: [section(t('rp_by', { dim: A.Bi.dimLabel('customer') }), cmpTable(A.Bi.dimLabel('customer'), rows.concat(total), [share]))] };
    },
    REV_REGION_PRODUCT() {
      const { t, M, state } = A;
      if (!M.biApplicable(state.orgId, 'REV')) return { sections: [section('', naBox('REV'))] };
      const reg = dimRows('region', 'REV'), cat = dimRows('product_category', 'REV');
      // Region × product category matrix (actual).
      const q = M.biQuery({ orgId: state.orgId, periods: basisPeriods(), measure: 'REV', scenarios: ['ACT'], groupBy: ['region', 'product_category'], asOf: state.periodId });
      const cell = new Map(q.rows.map((r) => [r.key.join('|'), r.value]));
      const matrix = `<div class="table-wrap"><table class="grid-table rp-table"><thead><tr><th>${A.esc(A.Bi.dimLabel('region'))} <span class="faint">＼ ${A.esc(A.Bi.dimLabel('product_category'))}</span></th>
        ${cat.map((c) => `<th class="num">${A.esc(c.label)}</th>`).join('')}<th class="num">${A.esc(t('units_total'))}</th></tr></thead><tbody>
        ${reg.map((r) => `<tr><td>${A.esc(r.label)}</td>${cat.map((c) => numCell(cell.get(r.member + '|' + c.member) ?? null)).join('')}${numCell(r.act, 'bi-tot')}</tr>`).join('')}
        <tr class="other-row total-row"><td>${A.esc(t('units_total'))}</td>${cat.map((c) => numCell(c.act)).join('')}${numCell(sumBy(reg, 'act'))}</tr></tbody></table></div>`;
      return { chart: cmpChart(reg), sections: [
        section(t('rp_by', { dim: A.Bi.dimLabel('region') }), cmpTable(A.Bi.dimLabel('region'), reg.concat(totalRow(reg, 'REV')))),
        section(t('rp_by', { dim: A.Bi.dimLabel('product_category') }), cmpTable(A.Bi.dimLabel('product_category'), cat.concat(totalRow(cat, 'REV')))),
        section(t('rp_matrix', { a: A.Bi.dimLabel('region'), b: A.Bi.dimLabel('product_category') }), matrix),
      ] };
    },
    COST_PRODUCT() {
      const { t, M, state } = A;
      if (!M.biApplicable(state.orgId, 'COGS')) return { sections: [section('', naBox('COGS'))] };
      const rows = dimRows('product', 'COGS');
      const rev = new Map(dimRows('product', 'REV').map((r) => [r.member, r]));
      const ratioOf = (c, r) => (c === null || !r ? null : (c / r) * 100);
      const total = totalRow(rows, 'COGS');
      const revTot = { act: val('REV', 'ACT'), bud: val('REV', 'BUD') };
      const ratio = (k) => (r) => {
        const base = r.cls ? revTot[k] : (rev.get(r.member) || {})[k];
        const v = ratioOf(r[k], base);
        return `<td class="num muted">${v === null ? dash : A.fmt(v) + '%'}</td>`;
      };
      const extra = [{ head: t('rp_cost_ratio'), cell: ratio('act') }].concat(ui.budget ? [{ head: t('rp_cost_ratio_bud'), cell: ratio('bud') }] : []);
      return { chart: cmpChart(rows), sections: [section(t('rp_by', { dim: A.Bi.dimLabel('product') }), cmpTable(A.Bi.dimLabel('product'), rows.concat(total), extra), t('rp_cost_note'))] };
    },
    COST_VARIANCE() {
      const { t, M, state } = A;
      const rows = [];
      [['COGS', 'COGS'], ['SGA', 'SGA']].forEach(([cls, measure]) => {
        if (!M.biApplicable(state.orgId, measure)) return;
        const list = dimRows('account', measure).map((r) => Object.assign(r, { indent: true }));
        if (!list.length) return;
        rows.push(Object.assign(totalRow(list, measure, t('bi_cls_' + cls)), { cls: 'rp-sub' }), ...list);
      });
      const accounts = rows.filter((r) => r.indent);
      return { chart: cmpChart(accounts, (r) => String(r.member)), sections: [section(t('rp_by', { dim: A.Bi.dimLabel('account') }), cmpTable(A.Bi.dimLabel('account'), rows), t('rp_cost_var_note'))] };
    },
    MONTHLY(ctx) {
      const { t, esc, M, state } = A;
      const v = ctx.version;
      const extra = v && v.cur ? [
        { head: t('rp_fy_budget'), cell: (r) => numCell(r.na ? null : v.figures(r.measure).budget, 'muted') },
        { head: t('rp_fy_landing'), cell: (r) => numCell(r.na ? null : v.figures(r.measure).landing) },
      ] : [];
      const rows = METRICS.map((m) => metricRow(m, m === 'GP' || m === 'OP' ? { cls: 'rp-sub' } : {}));
      const sections = [section(t('rp_metrics'), cmpTable(t('rp_metric'), rows, extra), v && v.cur ? t('rp_version_used', { v: v.cur.label }) : t('rp_no_version', { month: A.periodLabel(state.periodId) }))];
      const kids = M.children(state.orgId);
      if (kids.length) {
        const orgRows = kids.map((o) => ({ label: A.orgName(o), measure: 'OP', act: val('OP', 'ACT', null, null, o), bud: val('OP', 'BUD', null, null, o), py: val('OP', 'PY', null, null, o) }));
        sections.push(section(`${t('bi_m_OP')} · ${t('rp_by', { dim: t('org') })}`, cmpTable(t('org'), orgRows.concat(totalRow(orgRows, 'OP')))));
      }
      // Monthly operating profit across the fiscal year.
      const fyP = M.fyPeriods(fyOf());
      const one = (sc, p) => (sc === 'ACT' && p > state.periodId ? null : M.biValue(state.orgId, [p], 'OP', sc, null, state.periodId));
      const series = [{ name: t('actual'), type: 'bar', color: 'var(--chart-actual)', values: fyP.map((p) => one('ACT', p)) }];
      if (ui.budget) series.push({ name: t('budget'), type: 'bar', color: 'var(--chart-budget)', values: fyP.map((p) => one('BUD', p)) });
      if (ui.py) series.push({ name: t('prior_year'), type: 'line', color: 'var(--chart-py)', values: fyP.map((p) => one('PY', p)) });
      return { chartTitle: `${t('bi_m_OP')} · ${t('rp_monthly_trend')}`, chart: A.Chart.monthly(series, { labels: fyP.map((p) => A.monthLabel(p)), width: 760, height: 240 }), sections };
    },
    QUARTERLY() {
      const { t, esc, M, state } = A;
      const fyP = M.fyPeriods(fyOf());
      const quarters = [1, 2, 3, 4].map((q) => {
        const all = fyP.filter((p) => M.period(p).fiscal_quarter === q);
        const closed = all.filter((p) => p <= state.periodId);
        return { q, all, closed, partial: closed.length > 0 && closed.length < all.length };
      });
      const closedAll = quarters.flatMap((x) => x.closed);
      const cols = quarters.map((x) => `<th class="num">Q${x.q}${x.partial ? ' *' : ''}</th>`).join('') + `<th class="num">${esc(t('rp_fy_total'))}</th>`;
      const line = (label, cls, f, fyVal, render = numCell, measure) => `<tr class="${cls}"><td class="rp-indent">${esc(label)}</td>${quarters.map((x) => render(f(x), measure)).join('')}${render(fyVal, measure)}</tr>`;
      const varCell = (v, m) => signCell(v, toneOf(m, v));
      const body = METRICS.map((m) => {
        if (!M.biApplicable(state.orgId, m)) return `<tr class="rp-sub"><td>${esc(t('bi_m_' + m))}</td><td class="num faint" colspan="5">${esc(t('na'))}</td></tr>`;
        const act = (ps) => (ps.length ? val(m, 'ACT', null, ps) : null);
        const bud = (ps) => (ps.length ? val(m, 'BUD', null, ps) : null);
        const py = (ps) => (ps.length ? val(m, 'PY', null, ps) : null);
        const diff = (a, b) => (a === null || b === null ? null : M.r2(a - b));
        return `<tr class="rp-sub"><td colspan="6">${esc(t('bi_m_' + m))}</td></tr>
          ${line(t('actual'), '', (x) => act(x.closed), act(closedAll))}
          ${ui.budget ? line(t('budget'), 'rp-muted', (x) => bud(x.all), bud(fyP)) + line(t('rp_variance'), '', (x) => diff(act(x.closed), bud(x.closed)), diff(act(closedAll), bud(closedAll)), varCell, m) : ''}
          ${ui.py ? line(t('prior_year'), 'rp-muted', (x) => py(x.all), py(fyP)) : ''}`;
      }).join('');
      const table = `<div class="table-wrap"><table class="grid-table rp-table"><thead><tr><th>${esc(t('rp_metric'))}</th>${cols}</tr></thead><tbody>${body}</tbody></table></div>`;
      const series = [{ name: t('actual'), type: 'bar', color: 'var(--chart-actual)', values: quarters.map((x) => (x.closed.length ? val('OP', 'ACT', null, x.closed) : null)) }];
      if (ui.budget) series.push({ name: t('budget'), type: 'bar', color: 'var(--chart-budget)', values: quarters.map((x) => val('OP', 'BUD', null, x.all)) });
      if (ui.py) series.push({ name: t('prior_year'), type: 'bar', color: 'var(--chart-py)', values: quarters.map((x) => val('OP', 'PY', null, x.all)) });
      return { chartTitle: `${t('bi_m_OP')} · ${t('bi_dim_quarter')}`, chart: A.Chart.monthly(series, { labels: quarters.map((x) => 'Q' + x.q + (x.partial ? ' *' : '')), width: 760, height: 240 }),
        sections: [section(t('rp_by', { dim: t('bi_dim_quarter') }), table, t('rp_quarter_note', { to: A.periodLabel(state.periodId) }))] };
    },
    BVA() {
      const { t, M, state } = A;
      const rows = [];
      const block = (measure, subCls) => {
        if (!M.biApplicable(state.orgId, measure)) { rows.push({ label: t('bi_m_' + measure), measure, na: true, cls: subCls }); return; }
        const list = dimRows('account', measure).map((r) => Object.assign(r, { indent: true }));
        rows.push(...list, Object.assign(totalRow(list, measure, t('bi_m_' + measure)), { cls: subCls }));
      };
      block('REV', 'rp-sub'); block('COGS', 'rp-sub');
      rows.push(metricRow('GP', { cls: 'rp-key' }));
      block('SGA', 'rp-sub');
      rows.push(metricRow('OP', { cls: 'rp-key' }));
      return { chart: cmpChart(METRICS.map((m) => metricRow(m))), sections: [section(t('rp_pl_statement'), cmpTable(A.Bi.dimLabel('account'), rows), t('rp_pl_note'))] };
    },
    LANDING(ctx) {
      const { t, esc, fmt, M, state } = A;
      const v = ctx.version;
      if (!v.cur) return { sections: [section('', `<div class="placeholder">${esc(t('rp_no_version', { month: A.periodLabel(state.periodId) }))}</div>`)] };
      const head = `<tr><th>${esc(t('rp_metric'))}</th><th class="num">${esc(t('budget_original'))}</th><th class="num">① ${esc(t('scen_BASE'))}</th><th class="num">+ ${esc(t('actions'))}</th>
        <th class="num">+ ${esc(t('factor_contribution_plain'))}</th><th class="num">= ③ ${esc(t('scen_LANDING'))}</th><th class="num">${esc(t('budget_variance'))}</th></tr>`;
      const body = METRICS.map((m) => {
        if (!M.biApplicable(state.orgId, m)) return `<tr><td>${esc(t('bi_m_' + m))}</td><td class="num faint" colspan="6">${esc(t('na'))}</td></tr>`;
        const f = v.figures(m);
        if (!f) return `<tr><td>${esc(t('bi_m_' + m))}</td><td class="num faint" colspan="6">–</td></tr>`;
        return `<tr class="${m === 'OP' ? 'rp-key' : ''}"><td>${esc(t('bi_m_' + m))}</td>${numCell(f.budget, 'muted')}${numCell(f.baseline)}${signCell(f.action, toneOf(m, f.action))}${signCell(f.factor, toneOf(m, f.factor))}
          <td class="num"><b>${fmt(f.landing)}</b></td>${signCell(f.variance, toneOf(m, f.variance))}</tr>`;
      }).join('');
      const sections = [section(t('landing_breakdown'), `<div class="table-wrap"><table class="grid-table rp-table"><thead>${head}</thead><tbody>${body}</tbody></table></div>`, t('rp_landing_note'))];
      // Departments in scope, each with the confirmed version that feeds the total.
      const leaves = M.leafOrgs(state.orgId);
      if (leaves.length > 1) {
        const parts = M.forecastRollup(state.orgId, v.cur.asOf, 'OP').parts;
        const rowsH = parts.map((p) => {
          const f = p.version ? M.versionFigures(p.version.forecast_version_id, 'OP') : null;
          const ver = p.version ? esc(t('ver_label', { n: p.version.version_no, date: A.periodLabel(p.version.as_of_period_id) })) : `<span class="bad">${esc(t('not_confirmed'))}</span>`;
          return `<tr><td>${esc(A.orgName(p.org_id))}</td><td>${ver}</td>${numCell(f ? f.budget : null, 'muted')}<td class="num"><b>${f ? fmt(f.landing) : '–'}</b></td>${signCell(f ? f.variance : null, f ? toneOf('OP', f.variance) : '')}</tr>`;
        }).join('');
        const tot = v.figures('OP');
        sections.push(section(`${t('bi_m_OP')} · ${t('rp_by', { dim: t('bi_dim_org') })}`, `<div class="table-wrap"><table class="grid-table rp-table"><thead><tr><th>${esc(t('bi_dim_org'))}</th><th>${esc(t('version'))}</th>
          <th class="num">${esc(t('budget_original'))}</th><th class="num">${esc(t('scen_LANDING'))}</th><th class="num">${esc(t('budget_variance'))}</th></tr></thead><tbody>${rowsH}
          <tr class="other-row total-row"><td colspan="2">${esc(t('units_total'))}</td>${numCell(tot.budget)}${numCell(tot.landing)}${signCell(tot.variance, toneOf('OP', tot.variance))}</tr></tbody></table></div>`));
      }
      const mon = v.monthly('OP');
      const lastActual = mon.reduce((i, r, idx) => (r.actual !== null && r.actual !== undefined ? idx : i), -1);
      const series = [
        { name: t('budget'), type: 'line', color: 'var(--chart-budget)', dash: '2 3', values: mon.map((r) => r.budget) },
        { name: t('actual'), type: 'line', color: 'var(--chart-actual)', width: 2.5, values: mon.map((r) => r.actual) },
        { name: t('scen_LANDING'), type: 'line', color: 'var(--chart-forecast)', dash: '5 3', width: 2.5, endLabel: true, values: mon.map((r, i) => (i === lastActual ? r.actual : r.actual === null || r.actual === undefined ? r.forecast : null)) },
      ];
      return { chartTitle: `${t('bi_m_OP')} · ${t('rp_monthly_trend')}`, chart: A.Chart.monthly(series, { labels: mon.map((r) => A.monthLabel(r.period_id)), width: 760, height: 240, zero: false }), sections,
        warn: v.missing.length ? t('bi_note_fcst_missing', { orgs: v.missing.map((o) => A.orgName(o)).join(', ') }) : '' };
    },
    ACTIONS() {
      const { t, esc, fmt, M, state } = A;
      const list = M.boardActions(state.orgId, state.periodId, true).sort((a, b) => a.action_id.localeCompare(b.action_id));
      if (!list.length) return { sections: [section('', `<div class="placeholder">${esc(t('no_adopted_actions'))}</div>`)] };
      const rows = list.map((a) => ({ a, tot: M.actionTotals(a.action_id, state.periodId, 'OP'), prog: M.actionProgress(a.action_id, state.periodId) }));
      const status = (r) => (r.a.execution_state === 'COMPLETED' || r.a.execution_state === 'STOPPED' || !r.prog
        ? `<span class="tag ${r.a.execution_state === 'COMPLETED' ? 'ps-COMPLETED' : ''}">${esc(t('e_' + r.a.execution_state))}</span>`
        : `<span class="tag ps-${r.prog.ai_status}">${esc(t('ps_' + r.prog.ai_status))}</span>`);
      const body = rows.map((r) => `<tr class="main-row" tabindex="0" data-action="${r.a.action_id}"><td><span class="id">${r.a.action_id}</span></td><td>${A.actionName(r.a)}</td><td>${esc(A.orgName(r.a.owner_org_id))}</td>
        <td class="nowrap">${esc(A.periodLabel(r.a.start_period_id))} – ${esc(A.periodLabel(r.a.end_period_id))}</td><td class="num">${r.prog ? r.prog.progress_pct : 0}%</td>
        ${numCell(r.tot.planAnnual)}${numCell(r.tot.actualToDate, '', 2)}<td class="num"><b>${fmt(r.tot.outlookFY, 2)}</b></td>
        <td class="num ${toneOf('OP', r.tot.outlookVsPlan)}">${A.fmtSigned(r.tot.outlookVsPlan, 2)}</td><td class="nowrap">${status(r)}</td></tr>`).join('');
      const s = (k) => M.r2(rows.reduce((x, r) => x + r.tot[k], 0));
      const table = `<div class="table-wrap"><table class="grid-table rp-table"><thead><tr><th>${esc(t('action_id'))}</th><th>${esc(t('action_name'))}</th><th>${esc(t('owner_org'))}</th><th>${esc(t('rp_term'))}</th>
        <th class="num">${esc(t('progress'))}</th><th class="num">${esc(t('plan_lbl'))}</th><th class="num">${esc(t('actual_lbl'))}</th><th class="num">${esc(t('col_outlook'))}</th><th class="num">${esc(t('rp_vs_plan'))}</th><th>${esc(t('col_judgment'))}</th></tr></thead>
        <tbody>${body}<tr class="other-row total-row"><td colspan="5">${esc(t('units_total'))} (${rows.length})</td>${numCell(s('planAnnual'))}${numCell(s('actualToDate'), '', 2)}${numCell(s('outlookFY'), '', 2)}
        <td class="num ${toneOf('OP', s('outlookVsPlan'))}">${A.fmtSigned(s('outlookVsPlan'), 2)}</td><td></td></tr></tbody></table></div>`;
      const series = [
        { name: t('plan_lbl'), type: 'bar', color: 'var(--chart-budget)', values: rows.map((r) => r.tot.planAnnual) },
        { name: t('col_outlook'), type: 'bar', color: 'var(--chart-actual)', values: rows.map((r) => r.tot.outlookFY) },
      ];
      return { chartTitle: t('rp_actions_chart'), chart: A.Chart.monthly(series, { labels: rows.map((r) => r.a.action_id.replace(/^ACT-/, '')), width: 760, height: 240 }),
        sections: [section(t('rp_actions_table'), table, t('rp_actions_note'))] };
    },
  };

  /* ---------------------------------------------------------------- render */
  function chooser() {
    const { t, esc } = A;
    const item = (r) => `<li class="${r.id === ui.reportId ? 'on' : ''}"><button class="rp-pick" data-report="${r.id}">${esc(t('rp_' + r.id))}</button>
      <button class="rp-star ${isFav(r.id) ? 'on' : ''}" data-fav="${r.id}" aria-pressed="${isFav(r.id)}" title="${esc(t(isFav(r.id) ? 'rp_unfav' : 'rp_fav'))}">${isFav(r.id) ? '★' : '☆'}</button></li>`;
    const favs = REPORTS.filter((r) => isFav(r.id));
    return `<div class="rp-group"><h3>★ ${esc(t('rp_favorites'))}</h3>${favs.length ? `<ul>${favs.map(item).join('')}</ul>` : `<p class="faint small">${esc(t('rp_no_favorites'))}</p>`}</div>
      ${CATS.map((c) => `<div class="rp-group"><h3>${esc(t('rp_cat_' + c))}</h3><ul>${REPORTS.filter((r) => r.cat === c).map(item).join('')}</ul></div>`).join('')}`;
  }

  function render() {
    const { t, esc, state } = A;
    const rep = report();
    const version = rep.version ? versionCtx() : null;
    if (version && version.cur) ui.version = version.cur.key;
    const out = BUILD[rep.id]({ version });
    const seg = (name, value, options, disabled) => `<div class="seg ${disabled ? 'disabled' : ''}" role="group">${options.map(([v, l]) => `<button class="seg-btn ${v === value && !disabled ? 'on' : ''}" data-${name}="${v}" ${disabled ? 'disabled' : ''}>${esc(l)}</button>`).join('')}</div>`;
    const chk = (id, on, label, disabled) => `<label class="chk ${disabled ? 'faint' : ''}"><input type="checkbox" id="${id}" ${on && !disabled ? 'checked' : ''} ${disabled ? 'disabled' : ''}> ${esc(label)}</label>`;
    const summary = A.db.ai_comment.find((c) => c.comment_type === 'A01_SUMMARY' && c.org_id === state.orgId && c.as_of_period_id === state.periodId && c.is_current);
    const scope = rep.basis ? basisLabel() : rep.id === 'ACTIONS' ? A.periodLabel(state.periodId) : t('bi_fy_label', { fy: fyOf() });

    return `
      <div class="page-head">
        <h1>B-02 ${esc(t('scr_B02'))}</h1>
        <span class="scope">${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">
          <div class="seg tabs"><button class="seg-btn" data-go="B01">${esc(t('scr_B01'))} (B-01)</button><button class="seg-btn on" aria-pressed="true">${esc(t('scr_B02'))}</button></div>
        </div>
      </div>
      <div class="grid rp-main">
        <div class="card rp-chooser"><h2>${esc(t('rp_reports'))}</h2>${chooser()}</div>
        <div>
          <div class="card rp-options">
            <div class="ctl"><label>${esc(t('rp_basis'))}</label>${seg('basis', ui.basis, [['MONTH', t('rp_basis_MONTH')], ['YTD', t('rp_basis_YTD')]], !rep.basis)}</div>
            <div class="ctl"><label>${esc(t('rp_compare'))}</label>${chk('rp-budget', ui.budget, t('rp_cmp_budget'), !rep.cmp)}${chk('rp-py', ui.py, t('prior_year'), !rep.cmp)}</div>
            ${rep.version ? `<div class="ctl"><label for="rp-version">${esc(t('rp_fc_version'))}</label><select id="rp-version" ${version.cur ? '' : 'disabled'}>${version.choices.length
              ? version.choices.map((c) => `<option value="${esc(c.key)}" ${c.key === ui.version ? 'selected' : ''}>${esc(c.label)}</option>`).join('') : `<option>${esc(t('not_confirmed'))}</option>`}</select></div>` : ''}
            <div class="ctl">${chk('rp-ai', ui.ai, t('rp_ai_toggle'))}</div>
          </div>
          <div class="card rp-report">
            <div class="rp-title"><h2>${esc(t('rp_' + rep.id))}</h2>
              <span class="muted">${esc(scope)} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span></div>
            <p class="muted small" style="margin:2px 0 12px">${esc(t('rp_desc_' + rep.id))}</p>
            ${out.warn ? `<div class="warnbox">⚠ ${esc(out.warn)}</div>` : ''}
            ${out.chart ? `<div class="rp-section"><h3>${esc(out.chartTitle || t('rp_chart'))}</h3><div class="rp-chart">${out.chart}</div></div>` : ''}
            ${out.sections.map((s) => `<div class="rp-section">${s.title ? `<h3>${esc(s.title)}</h3>` : ''}${s.html}${s.hint ? `<p class="hint" style="margin-top:6px">${esc(s.hint)}</p>` : ''}</div>`).join('')}
          </div>
          ${ui.ai ? `<div class="card rp-ai"><h2>${esc(t('rp_ai_comment'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
            <div class="ai-box">${summary ? A.aiText(summary.comment_id) : `<span class="muted">${esc(t('rp_no_ai'))}</span>`}</div>
            <p class="hint" style="margin-top:6px">${esc(t('rp_ai_note', { month: A.periodLabel(state.periodId) }))}</p></div>` : ''}
        </div>
      </div>`;
  }

  function mount(root) {
    const on = (sel, ev, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener(ev, fn); };
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
    root.querySelectorAll('[data-report]').forEach((b) => b.addEventListener('click', () => { ui.reportId = b.dataset.report; A.render(); }));
    root.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => { toggleFav(b.dataset.fav); A.render(); }));
    root.querySelectorAll('[data-basis]').forEach((b) => b.addEventListener('click', () => { ui.basis = b.dataset.basis; A.render(); }));
    on('#rp-budget', 'change', (e) => { ui.budget = e.target.checked; A.render(); });
    on('#rp-py', 'change', (e) => { ui.py = e.target.checked; A.render(); });
    on('#rp-ai', 'change', (e) => { ui.ai = e.target.checked; A.render(); });
    on('#rp-version', 'change', (e) => { ui.version = e.target.value; A.render(); });
    // Action progress report → Action Status (A-05).
    root.querySelectorAll('tr.main-row[data-action]').forEach((tr) => {
      const open = () => A.go('A05', { actionId: tr.dataset.action });
      tr.addEventListener('dblclick', open);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
  }

  A.SCREENS.B02 = { render, mount };
})();
