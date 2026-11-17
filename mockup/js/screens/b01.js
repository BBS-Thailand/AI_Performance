/* B-01 BI Analysis — README §5.1, concept slide "B-01 BI Analysis". Stand-in for the embedded Power BI report:
 * a pivot over the shared semantic-model measures (M.biQuery), so the figures agree with A-01, F-01 and B-02.
 * Layout follows the concept: left panel (Dimensions, Measures, Saved views), right: selection line, table, chart. */
(function () {
  'use strict';
  const A = window.App;
  const RANGES = ['MONTH', 'YTD', 'FY'];
  /** Dimension groups of the left panel; each lists its hierarchy levels from high to low. */
  const GROUPS = [
    { id: 'organization', levels: ['division', 'org'] },
    { id: 'period', levels: ['quarter', 'period'] },
    { id: 'customer', levels: ['region', 'customer'] },
    { id: 'product', levels: ['product_category', 'product'] },
    { id: 'account', levels: ['account_class', 'account'] },
    { id: 'scenario', levels: ['scenario'] },
  ];
  const groupOf = (dim) => GROUPS.find((g) => g.levels.includes(dim)) || null;
  /** Drill-down: next lower level of the same hierarchy. */
  const DRILL = {};
  GROUPS.forEach((g) => g.levels.forEach((d, i) => { if (g.levels[i + 1]) DRILL[d] = g.levels[i + 1]; }));
  const CLASS_ORDER = ['REVENUE', 'COGS', 'SGA'];
  const MAX_SERIES = 8;
  const OTHER_COLOR = '#898781';
  const DEFAULTS = { rows: 'region', cols: 'period', measures: ['REV'], scenario: 'ACT', range: 'YTD', filters: [] };
  const ui = Object.assign({ viewId: '', pendingDim: '' }, DEFAULTS, { measures: ['REV'], filters: [] });
  let viewSeq = 0;

  /* ------------------------------------------------- shared dimension helpers (also used by B-02) */
  const dimLabel = (d) => A.t('bi_dim_' + d);
  function memberLabel(dim, v) {
    const { t, M } = A;
    if (v === 'NA') return t('bi_unallocated');
    switch (dim) {
      case 'division': case 'org': return A.orgName(v);
      case 'quarter': return 'Q' + v;
      case 'period': return A.monthLabel(Number(v));
      case 'customer': return (M.customer(v) || {}).customer_name || String(v);
      case 'product': return (M.product(v) || {}).product_name || String(v);
      case 'account': return `${v} ${(M.account(v) || {}).account_name || ''}`;
      case 'account_class': return t('bi_cls_' + v);
      case 'scenario': return t('bi_sc_' + v);
      default: return String(v);
    }
  }
  function sortMembers(dim, list) {
    const { M } = A;
    const rank = (v) => {
      if (v === 'NA') return Infinity;
      if (dim === 'division' || dim === 'org') return M.org(v).sort_order;
      if (dim === 'quarter' || dim === 'period') return Number(v);
      if (dim === 'account') return (M.account(v) || {}).sort_order || 0;
      if (dim === 'account_class') return CLASS_ORDER.indexOf(v);
      if (dim === 'scenario') return M.BI_SCENARIOS.indexOf(v);
      return null;
    };
    return list.slice().sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== null && rb !== null && ra !== rb) return ra - rb;
      return memberLabel(dim, a).localeCompare(memberLabel(dim, b));
    });
  }
  function rangePeriods(range) {
    const { M, state } = A;
    if (range === 'MONTH') return [state.periodId];
    if (range === 'FY') return M.fyPeriods(M.period(state.periodId).fiscal_year);
    return M.ytdPeriods(state.periodId);
  }
  function rangeLabel(range) {
    const { t, state } = A;
    if (range === 'MONTH') return A.periodLabel(state.periodId);
    if (range === 'YTD') return A.ytdLabel();
    return t('bi_fy_label', { fy: A.M.period(state.periodId).fiscal_year });
  }
  A.Bi = { dimLabel, memberLabel, sortMembers, rangePeriods, rangeLabel };

  /* ---------------------------------------------------------------- saved views */
  const visibleViews = () => A.db.app_saved_bi_view.filter((v) => v.owner_id === A.state.userId || v.shared);
  function applyDefinition(def) {
    const { M } = A;
    const dim = (d) => (M.BI_DIM_KEYS.includes(d) ? d : null);
    ui.rows = dim(def.rows) || DEFAULTS.rows;
    ui.cols = def.cols ? dim(def.cols) || '' : '';
    if (ui.cols && groupOf(ui.cols) === groupOf(ui.rows)) ui.cols = ''; // one level per dimension group
    const ms = (Array.isArray(def.measures) ? def.measures : [def.measure]).filter((m) => M.BI_MEASURES.includes(m));
    ui.measures = ms.length ? M.BI_MEASURES.filter((m) => ms.includes(m)) : DEFAULTS.measures.slice();
    ui.scenario = M.BI_SCENARIOS.includes(def.scenario) ? def.scenario : 'ACT'; // "ALL" = scenario on an axis
    ui.range = RANGES.includes(def.range) ? def.range : DEFAULTS.range;
    ui.filters = Array.isArray(def.filters) ? def.filters.filter((f) => dim(f.dim) && f.dim !== 'scenario').map((f) => ({ dim: f.dim, value: String(f.value) })) : [];
    ui.pendingDim = '';
  }
  const currentDefinition = () => ({ rows: ui.rows, cols: ui.cols, measure: ui.measures[0], measures: ui.measures, scenario: scenarioOnAxis() ? 'ALL' : ui.scenario, range: ui.range, filters: ui.filters });

  /* ---------------------------------------------------------------- pivot */
  const scenarioOnAxis = () => ui.rows === 'scenario' || ui.cols === 'scenario';
  const filterObj = () => Object.fromEntries(ui.filters.map((f) => [f.dim, f.value]));

  /** One query per selected measure; cells hold one value per measure ("420 / 101" in the concept). */
  function pivot() {
    const { M, state } = A;
    const ms = ui.measures.filter((m) => M.biApplicable(state.orgId, m));
    const scenarios = scenarioOnAxis() ? M.BI_SCENARIOS : [ui.scenario];
    const groupBy = ui.cols ? [ui.rows, ui.cols] : [ui.rows];
    const cells = {}, rowSet = new Set(), colSet = new Set(), missing = new Set();
    let fcstUnsupported = false;
    ms.forEach((m) => {
      const q = M.biQuery({ orgId: state.orgId, periods: rangePeriods(ui.range), measure: m, scenarios, groupBy, filters: filterObj(), asOf: state.periodId });
      cells[m] = new Map(q.rows.map((r) => [r.key.join('\u0001'), r.value]));
      q.rows.forEach((r) => { rowSet.add(r.key[0]); if (ui.cols) colSet.add(r.key[1]); });
      q.missing.forEach((o) => missing.add(o));
      fcstUnsupported = fcstUnsupported || q.fcstUnsupported;
    });
    const rowM = sortMembers(ui.rows, [...rowSet]);
    const colM = ui.cols ? sortMembers(ui.cols, [...colSet]) : [];
    const get = (m, r, c) => { const v = cells[m].get(ui.cols ? r + '\u0001' + c : String(r)); return v === undefined ? null : v; };
    const sumOf = (vals) => { const xs = vals.filter((v) => v !== null); return xs.length ? M.r2(xs.reduce((a, b) => a + b, 0)) : null; };
    const rowTotal = (m, r) => (ui.cols ? sumOf(colM.map((c) => get(m, r, c))) : get(m, r));
    const colTotal = (m, c) => sumOf(rowM.map((r) => get(m, r, c)));
    const grand = (m) => sumOf(rowM.map((r) => rowTotal(m, r)));
    return { ms, rowM, colM, get, sumOf, rowTotal, colTotal, grand, fcstUnsupported, missing: [...missing] };
  }

  function tableHtml(p) {
    const { t, esc, fmt, fmtSigned, M } = A;
    const dash = '<span class="faint">–</span>';
    const sep = '<span class="faint"> / </span>';
    /** One cell: a value per selected measure. */
    const multi = (f, cls = '') => {
      const vals = p.ms.map(f);
      return `<td class="num ${cls}">${vals.every((v) => v === null) ? dash : vals.map((v) => (v === null ? '–' : fmt(v))).join(sep)}</td>`;
    };
    const tone = (m, v) => (v === null || Math.abs(v) < 0.005 ? '' : M.biFavorable(m, v) ? 'good' : 'bad');
    const signed = (f) => {
      const vals = p.ms.map((m) => [m, f(m)]);
      return `<td class="num">${vals.every(([, v]) => v === null) ? dash : vals.map(([m, v]) => (v === null ? '–' : `<span class="${tone(m, v)}">${fmtSigned(v)}</span>`)).join(sep)}</td>`;
    };
    const colsAdd = ui.cols && ui.cols !== 'scenario';           // column members add up to a row total
    const rowsAdd = ui.rows !== 'scenario';                       // row members add up to a total row
    // Variance column: Actual − Budget; for the full year Actual is partial, so compare the confirmed Forecast instead.
    const varBase = ui.range === 'FY' ? 'FCST' : 'ACT';
    const varCol = ui.cols === 'scenario' && p.colM.includes(varBase) && p.colM.includes('BUD');
    const diff = (a, b) => (a === null || b === null ? null : M.r2(a - b));
    const share = !ui.cols && rowsAdd && p.ms.length === 1 && p.grand(p.ms[0]);
    const child = DRILL[ui.rows];
    const canDrill = (r) => child && r !== 'NA';
    const head = `<tr><th>${esc(dimLabel(ui.rows))}${ui.cols ? ` <span class="faint">＼ ${esc(dimLabel(ui.cols))}</span>` : ''}</th>
      ${ui.cols ? p.colM.map((c) => `<th class="num">${esc(memberLabel(ui.cols, c))}</th>`).join('') : `<th class="num">${esc(p.ms.map((m) => t('bi_m_' + m)).join(' / '))}</th>`}
      ${colsAdd ? `<th class="num">${esc(t('units_total'))}</th>` : ''}${varCol ? `<th class="num">${esc(memberLabel('scenario', varBase))} ${esc(t('vs_budget'))}</th>` : ''}${share ? `<th class="num">${esc(t('bi_share'))}</th>` : ''}</tr>`;
    const body = p.rowM.map((r) => {
      const label = esc(memberLabel(ui.rows, r));
      const v0 = share ? p.get(p.ms[0], r) : null;
      return `<tr><td>${canDrill(r) ? `<button class="bi-drill" data-drill="${esc(r)}" title="${esc(t('bi_drill_hint', { dim: dimLabel(child) }))}">▸ ${label}</button>` : label}</td>
        ${ui.cols ? p.colM.map((c) => multi((m) => p.get(m, r, c))).join('') : multi((m) => p.get(m, r))}
        ${colsAdd ? multi((m) => p.rowTotal(m, r), 'bi-tot') : ''}${varCol ? signed((m) => diff(p.get(m, r, varBase), p.get(m, r, 'BUD'))) : ''}
        ${share ? `<td class="num muted">${v0 === null ? dash : fmt((v0 / share) * 100) + '%'}</td>` : ''}</tr>`;
    }).join('');
    let total = '';
    if (rowsAdd && p.rowM.length > 1) {
      total = `<tr class="other-row total-row"><td>${esc(t('units_total'))}</td>
        ${ui.cols ? p.colM.map((c) => multi((m) => p.colTotal(m, c))).join('') : multi((m) => p.grand(m))}
        ${colsAdd ? multi((m) => p.grand(m)) : ''}${varCol ? signed((m) => diff(p.colTotal(m, varBase), p.colTotal(m, 'BUD'))) : ''}${share ? '<td class="num">100%</td>' : ''}</tr>`;
    }
    return `<div class="table-wrap"><table class="grid-table bi-pivot"><thead>${head}</thead><tbody>${body}${total}</tbody></table></div>`;
  }

  /** Chart of the first selected measure (concept ④). */
  function chartHtml(p) {
    const { t } = A;
    const m = p.ms[0];
    const short = (s) => (s.length > 14 ? s.slice(0, 13) + '…' : s);
    if (!ui.cols) {
      return A.Chart.monthly([{ name: t('bi_m_' + m), type: 'bar', color: A.SERIES[0], values: p.rowM.map((r) => p.get(m, r)) }],
        { labels: p.rowM.map((r) => short(memberLabel(ui.rows, r))), width: 860, height: 260 });
    }
    // One series per row member; beyond the palette the smallest fold into "Other" (additive rows only).
    let rows = p.rowM, other = [];
    if (rows.length > MAX_SERIES && ui.rows !== 'scenario') {
      const ranked = rows.slice().sort((a, b) => Math.abs(p.rowTotal(m, b) || 0) - Math.abs(p.rowTotal(m, a) || 0));
      const keep = new Set(ranked.slice(0, MAX_SERIES - 1));
      other = rows.filter((r) => !keep.has(r)); rows = rows.filter((r) => keep.has(r));
    }
    const type = ui.cols === 'period' || ui.cols === 'quarter' ? 'line' : 'bar';
    const series = rows.slice(0, MAX_SERIES).map((r, i) => ({ name: memberLabel(ui.rows, r), type, color: A.SERIES[i], values: p.colM.map((c) => p.get(m, r, c)) }));
    if (other.length) series.push({ name: t('bi_other', { n: other.length }), type, color: OTHER_COLOR, values: p.colM.map((c) => p.sumOf(other.map((r) => p.get(m, r, c)))) });
    return A.Chart.monthly(series, { labels: p.colM.map((c) => short(memberLabel(ui.cols, c))), width: 860, height: 260 });
  }

  /* ---------------------------------------------------------------- left panel */
  function sidePanel() {
    const { t, esc, M, state } = A;
    const dims = GROUPS.map((g) => {
      const axis = g.levels.includes(ui.rows) ? 'rows' : g.levels.includes(ui.cols) ? 'cols' : '';
      const level = axis === 'rows' ? ui.rows : axis === 'cols' ? ui.cols : g.levels[0];
      const path = g.levels.length > 1 ? `<span class="bi-path">${esc(g.levels.map((d) => dimLabel(d)).join(' > '))}</span>` : '';
      return `<li class="${axis ? 'on' : ''}">
        <label class="bi-check"><input type="checkbox" data-group="${g.id}" ${axis ? 'checked' : ''}> <span>${esc(t('bi_grp_' + g.id))}${path}</span></label>
        ${axis ? `<div class="bi-assign"><span class="bi-axis">${esc(t(axis === 'rows' ? 'bi_rows' : 'bi_cols'))}</span>
          ${g.levels.length > 1 ? `<select data-level="${axis}" aria-label="${esc(t('bi_level'))}">${g.levels.map((d) => `<option value="${d}" ${d === level ? 'selected' : ''}>${esc(dimLabel(d))}</option>`).join('')}</select>` : ''}</div>` : ''}</li>`;
    }).join('');
    const measures = M.BI_MEASURES.map((m) => {
      const na = !M.biApplicable(state.orgId, m);
      return `<li><label class="bi-check ${na ? 'faint' : ''}"><input type="checkbox" data-measure="${m}" ${ui.measures.includes(m) ? 'checked' : ''} ${na ? 'disabled' : ''}> <span>${esc(t('bi_m_' + m))}${na ? ` (${esc(t('na'))})` : ''}</span></label></li>`;
    }).join('');
    const views = visibleViews().map((v) => `<li class="${v.view_id === ui.viewId ? 'on' : ''}"><button class="bi-view" data-view-id="${esc(v.view_id)}" title="${esc(v.shared ? t('bi_shared') : '')}">${esc(v.name)}</button>
      ${v.owner_id === state.userId ? `<button class="bi-view-del" data-del-view="${esc(v.view_id)}" title="${esc(t('bi_delete_view'))}" aria-label="${esc(t('bi_delete_view'))}">×</button>` : ''}</li>`).join('');
    return `<div class="card bi-side">
      <div class="bi-group"><h3>${esc(t('bi_dimensions'))}</h3><ul class="bi-dims">${dims}</ul><p class="hint">${esc(t('bi_dim_hint'))}</p></div>
      <div class="bi-group"><h3>${esc(t('bi_measures'))}</h3><ul>${measures}</ul></div>
      <div class="bi-group"><h3>${esc(t('bi_saved_views'))}</h3><ul class="bi-views">${views || `<li class="faint small">–</li>`}</ul>
        <button class="btn small" data-save-view>${esc(t('bi_save_view'))}</button></div>
    </div>`;
  }

  /* ---------------------------------------------------------------- render */
  function render(params) {
    const { t, esc, M, state } = A;
    if (params && params.def) { applyDefinition(params.def); ui.viewId = ''; state.params = {}; }
    if (ui.viewId && !visibleViews().some((v) => v.view_id === ui.viewId)) ui.viewId = '';
    // An organization without Revenue / Gross profit (e.g. Administration) falls back to Operating profit.
    if (!ui.measures.some((m) => M.biApplicable(state.orgId, m))) ui.measures = ['OP'];
    const p = pivot();
    const onAxis = scenarioOnAxis();
    const dims = M.BI_DIM_KEYS;
    const sel = (id, value, options, attrs = '') => `<select id="${id}" ${attrs}>${options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    const seg = (name, value, options) => `<div class="seg" role="group">${options.map(([v, l]) => `<button class="seg-btn ${v === value ? 'on' : ''}" data-${name}="${v}" aria-pressed="${v === value}">${esc(l)}</button>`).join('')}</div>`;

    // Filter chips + "add filter" (dimension, then member).
    const chips = ui.filters.map((f, i) => `<span class="bi-chip">${esc(dimLabel(f.dim))} = <b>${esc(memberLabel(f.dim, f.value))}</b><button data-unfilter="${i}" aria-label="${esc(t('bi_remove_filter'))}">×</button></span>`).join('');
    const freeDims = dims.filter((d) => d !== 'scenario' && !ui.filters.some((f) => f.dim === d));
    if (!freeDims.includes(ui.pendingDim)) ui.pendingDim = '';
    let memberSel = '';
    if (ui.pendingDim) {
      const q = M.biQuery({ orgId: state.orgId, periods: rangePeriods('FY'), measure: 'OP', scenarios: ['ACT', 'BUD'], groupBy: [ui.pendingDim], filters: filterObj(), asOf: state.periodId });
      const members = sortMembers(ui.pendingDim, [...new Set(q.rows.map((r) => r.key[0]))]);
      memberSel = sel('bi-fval', '', [['', t('bi_pick_member')]].concat(members.map((m) => [m, memberLabel(ui.pendingDim, m)])));
    }

    // Notes under the result (data coverage, security).
    const notes = [];
    const usesAct = onAxis || ui.scenario === 'ACT';
    if (ui.range === 'FY' && usesAct) notes.push(t('bi_note_act_closed', { to: A.periodLabel(M.latestClosed()) }));
    if (p.fcstUnsupported) notes.push(t('bi_note_fcst_dims'));
    if (p.missing.length) notes.push(t('bi_note_fcst_missing', { orgs: p.missing.map((o) => A.orgName(o)).join(', ') }));
    if ((onAxis || ui.scenario === 'FCST') && !p.fcstUnsupported) notes.push(t('bi_note_fcst_basis', { month: A.periodLabel(state.periodId) }));
    if (ui.measures.includes('COGS')) notes.push(t('bi_note_cogs'));

    const values = ui.measures.map((m) => t('bi_m_' + m)).join(' / ');
    const empty = !p.ms.length
      ? `<div class="placeholder">${esc(t('bi_na_org', { measure: values, org: A.orgName(state.orgId) }))}</div>`
      : !p.rowM.length ? `<div class="placeholder">${esc(t('bi_no_data'))}</div>` : '';
    const chartTitle = empty ? '' : `${t('bi_m_' + p.ms[0])} (${t('jpy_m')})${p.ms.length > 1 ? ' · ' + t('bi_chart_first') : ''}`;

    return `
      <div class="page-head">
        <h1>B-01 ${esc(t('scr_B01'))}</h1>
        <span class="scope">${esc(rangeLabel(ui.range))} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">
          <div class="seg tabs"><button class="seg-btn on" aria-pressed="true">${esc(t('scr_B01'))}</button><button class="seg-btn" data-go="B02">${esc(t('scr_B02'))} (B-02)</button></div>
        </div>
      </div>
      <div class="grid bi-main">
        ${sidePanel()}
        <div>
          <div class="card bi-controls">
            <div class="bi-row bi-summary">
              <span><span class="k">${esc(t('bi_rows'))}:</span> <b>${esc(dimLabel(ui.rows))}</b></span>
              <button class="btn small ghost" data-swap title="${esc(t('bi_swap'))}" ${ui.cols ? '' : 'disabled'}>⇄</button>
              <span><span class="k">${esc(t('bi_cols'))}:</span> <b>${esc(ui.cols ? dimLabel(ui.cols) : t('bi_none'))}</b></span>
              <span><span class="k">${esc(t('bi_values'))}:</span> <b>${esc(values)}</b> <span class="faint">(${esc(t('jpy_m'))})</span></span>
              <span><span class="k">${esc(t('bi_filters'))}:</span> ${chips || `<span class="faint">${esc(t('bi_no_filters'))}</span>`}</span>
              ${sel('bi-fdim', ui.pendingDim, [['', t('bi_add_filter')]].concat(freeDims.map((d) => [d, dimLabel(d)])))}${memberSel}
            </div>
            <div class="bi-row">
              <div class="ctl"><label for="bi-scenario">${esc(t('bi_dim_scenario'))}</label>${onAxis
                ? `<select id="bi-scenario" disabled><option>${esc(t('bi_on_axis'))}</option></select>`
                : sel('bi-scenario', ui.scenario, M.BI_SCENARIOS.map((s) => [s, t('bi_sc_' + s)]))}</div>
              <div class="ctl"><label>${esc(t('period'))}</label>${seg('range', ui.range, RANGES.map((r) => [r, t('bi_range_' + r)]))}</div>
              <div class="spacer"></div>
              <button class="btn small ghost" data-reset-bi>${esc(t('bi_reset'))}</button>
            </div>
          </div>
          <div class="card">
            ${empty || tableHtml(p)}
            ${empty ? '' : `<p class="hint" style="margin-top:8px">${esc(DRILL[ui.rows] ? t('bi_drill_tip') + '. ' : '')}${notes.map(esc).join(' ')}</p>`}
          </div>
          ${empty ? '' : `<div class="card"><h2>${esc(chartTitle)}</h2><div class="bi-chart">${chartHtml(p)}</div></div>`}
          <p class="hint"><span class="tag ml">Power BI</span> ${esc(t('bi_embed_note'))}. ${esc(t('bi_rls_note', { org: A.orgName(state.orgId) }))}</p>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------------- save dialog */
  function saveDialog() {
    const { t, esc, db, state } = A;
    A.openModal(`
      <header><h3>${esc(t('bi_save_view'))}</h3><button class="btn ghost x" data-close>×</button></header>
      <div class="body"><div class="form-grid">
        <label for="bv-name">${esc(t('bi_view_name'))}</label><input id="bv-name" type="text" maxlength="60">
        <label></label><label class="chk"><input id="bv-shared" type="checkbox"> ${esc(t('bi_share_view'))}</label>
      </div></div>
      <footer><button class="btn" data-close>${esc(t('cancel'))}</button><button class="btn primary" id="bv-save" disabled>${esc(t('save'))}</button></footer>`, {
      small: true,
      onMount(wrap, close) {
        const name = wrap.querySelector('#bv-name'), save = wrap.querySelector('#bv-save');
        name.addEventListener('input', () => { save.disabled = !name.value.trim(); });
        save.addEventListener('click', () => {
          const id = `BV-L${++viewSeq}`;
          db.app_saved_bi_view.push({ view_id: id, owner_id: state.userId, name: name.value.trim(), definition_json: JSON.stringify(currentDefinition()), shared: wrap.querySelector('#bv-shared').checked });
          ui.viewId = id;
          close();
          A.toast(t('bi_view_saved', { name: name.value.trim() }));
          A.render();
        });
      },
    });
  }

  /** Tick / untick a dimension group: the first ticked group goes to rows, the second to columns. */
  function toggleGroup(id) {
    const g = GROUPS.find((x) => x.id === id);
    const onRows = g.levels.includes(ui.rows), onCols = g.levels.includes(ui.cols);
    if (onCols) { ui.cols = ''; return true; }
    if (onRows) {
      if (!ui.cols) return false;              // at least one dimension stays on rows
      ui.rows = ui.cols; ui.cols = '';
      return true;
    }
    ui.cols = g.levels[0];                      // a third tick replaces the column dimension
    return true;
  }

  function mount(root) {
    const { t, db } = A;
    const changed = () => { ui.viewId = ''; A.render(); };
    const on = (sel, ev, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener(ev, fn); };
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
    root.querySelectorAll('[data-group]').forEach((c) => c.addEventListener('change', () => {
      if (!toggleGroup(c.dataset.group)) { A.toast(t('bi_need_row')); A.render(); return; }
      changed();
    }));
    root.querySelectorAll('[data-level]').forEach((s) => s.addEventListener('change', () => { ui[s.dataset.level] = s.value; changed(); }));
    root.querySelectorAll('[data-measure]').forEach((c) => c.addEventListener('change', () => {
      const m = c.dataset.measure;
      const next = A.M.BI_MEASURES.filter((x) => (x === m ? c.checked : ui.measures.includes(x)));
      if (!next.length) { A.toast(t('bi_need_measure')); A.render(); return; }
      ui.measures = next; changed();
    }));
    on('#bi-scenario', 'change', (e) => { ui.scenario = e.target.value; changed(); });
    on('[data-swap]', 'click', () => { if (!ui.cols) return; [ui.rows, ui.cols] = [ui.cols, ui.rows]; changed(); });
    root.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => { ui.range = b.dataset.range; changed(); }));
    // Drill-down: filter to the clicked member and show the next level of its hierarchy.
    root.querySelectorAll('[data-drill]').forEach((b) => b.addEventListener('click', () => {
      ui.filters = ui.filters.filter((f) => f.dim !== ui.rows).concat({ dim: ui.rows, value: b.dataset.drill });
      ui.rows = DRILL[ui.rows];
      changed();
    }));
    root.querySelectorAll('[data-unfilter]').forEach((b) => b.addEventListener('click', () => {
      const f = ui.filters[Number(b.dataset.unfilter)];
      ui.filters = ui.filters.filter((x) => x !== f);
      if (DRILL[f.dim] === ui.rows) ui.rows = f.dim; // drill back up
      changed();
    }));
    on('#bi-fdim', 'change', (e) => { ui.pendingDim = e.target.value; A.render(); });
    on('#bi-fval', 'change', (e) => { if (!e.target.value) return; ui.filters = ui.filters.concat({ dim: ui.pendingDim, value: e.target.value }); ui.pendingDim = ''; changed(); });
    on('[data-reset-bi]', 'click', () => { Object.assign(ui, DEFAULTS, { measures: DEFAULTS.measures.slice(), filters: [], viewId: '', pendingDim: '' }); A.render(); });
    root.querySelectorAll('[data-view-id]').forEach((b) => b.addEventListener('click', () => {
      const v = db.app_saved_bi_view.find((x) => x.view_id === b.dataset.viewId);
      if (!v) return;
      let def = {};
      try { def = JSON.parse(v.definition_json) || {}; } catch (err) { /* keep defaults */ }
      applyDefinition(def); ui.viewId = v.view_id; A.render();
    }));
    on('[data-save-view]', 'click', saveDialog);
    root.querySelectorAll('[data-del-view]').forEach((b) => b.addEventListener('click', () => {
      const i = db.app_saved_bi_view.findIndex((x) => x.view_id === b.dataset.delView && x.owner_id === A.state.userId);
      if (i < 0) return;
      const [gone] = db.app_saved_bi_view.splice(i, 1);
      if (ui.viewId === gone.view_id) ui.viewId = '';
      A.toast(t('bi_view_deleted', { name: gone.name }));
      A.render();
    }));
  }

  A.SCREENS.B01 = { render, mount };
})();
