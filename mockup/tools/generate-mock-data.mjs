/*
 * Mock data generator for the AI Management System mockup.
 *
 *   node mockup/tools/generate-mock-data.mjs
 *
 * Writes one JSON file per table (docs/data-model.md) to mockup/data/ and a
 * bundle mockup/data/mock-db.js (so index.html works from file:// without a server).
 *
 * ALL DATA IS SIMULATED. Figures are calibrated to the UI-concept slides:
 *   Company YTD Jun 2027 (JPY M): Revenue 1,250 (-55) / GP 301 (-14) / SG&A 215 (+2 fav) / OP 86 (-12)
 *   Company FY2027 OP: budget 370, baseline 328, Actions +22, Factors +2.5, landing 352.5
 * The script asserts these reconciliations before writing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
require('../js/measures.js');
const { build } = globalThis.Measures;
const outDir = path.join(here, '..', 'data');
fs.mkdirSync(outDir, { recursive: true });

/* ------------------------------------------------------------------ helpers */
const c = (v) => Math.round(v * 100);       // JPY M → cents of JPY M
const m = (v) => Math.round(v) / 100;       // cents → JPY M
const pad = (n) => String(n).padStart(2, '0');
function allocate(totalCents, weights) {
  const s = weights.reduce((a, b) => a + b, 0);
  const w = s === 0 ? weights.map(() => 1) : weights;
  const ws = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (totalCents * x) / ws);
  const fl = raw.map(Math.floor);
  let rem = totalCents - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - fl[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < rem; k++) fl[order[k % order.length][1]] += 1;
  return fl;
}
function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20270630);
const assertEq = (label, actual, expected) => {
  if (Math.abs(actual - expected) > 0.005) throw new Error(`Reconciliation failed: ${label} = ${actual}, expected ${expected}`);
  console.log(`  ✓ ${label} = ${expected}`);
};

/* ------------------------------------------------------------- dimensions */
const dim_organization = [
  { org_id: 'CO', org_code: 'CO', org_name: 'Sample Corporation', parent_org_id: null, org_level: 1, org_path: 'CO', is_leaf: false, sort_order: 1 },
  { org_id: 'DSL', org_code: 'DSL', org_name: 'Sales Division', parent_org_id: 'CO', org_level: 2, org_path: 'CO|DSL', is_leaf: false, sort_order: 2 },
  { org_id: 'SL', org_code: 'SL', org_name: 'Sales Dept.', parent_org_id: 'DSL', org_level: 3, org_path: 'CO|DSL|SL', is_leaf: true, sort_order: 3 },
  { org_id: 'OS', org_code: 'OS', org_name: 'Overseas Sales Dept.', parent_org_id: 'DSL', org_level: 3, org_path: 'CO|DSL|OS', is_leaf: true, sort_order: 4 },
  { org_id: 'DOP', org_code: 'DOP', org_name: 'Operations Division', parent_org_id: 'CO', org_level: 2, org_path: 'CO|DOP', is_leaf: false, sort_order: 5 },
  { org_id: 'MF', org_code: 'MF', org_name: 'Manufacturing Dept.', parent_org_id: 'DOP', org_level: 3, org_path: 'CO|DOP|MF', is_leaf: true, sort_order: 6 },
  { org_id: 'DCP', org_code: 'DCP', org_name: 'Corporate Division', parent_org_id: 'CO', org_level: 2, org_path: 'CO|DCP', is_leaf: false, sort_order: 7 },
  { org_id: 'AD', org_code: 'AD', org_name: 'Administration Dept.', parent_org_id: 'DCP', org_level: 3, org_path: 'CO|DCP|AD', is_leaf: true, sort_order: 8 },
];
const dim_organization_text = [
  ['CO', 'ja', 'サンプル株式会社'], ['DSL', 'ja', '営業本部'], ['SL', 'ja', '営業部'], ['OS', 'ja', '海外営業部'],
  ['DOP', 'ja', '生産本部'], ['MF', 'ja', '製造部'], ['DCP', 'ja', 'コーポレート本部'], ['AD', 'ja', '管理部'],
  ['CO', 'th', 'บริษัทตัวอย่าง'], ['DSL', 'th', 'สายงานขาย'], ['SL', 'th', 'ฝ่ายขาย'], ['OS', 'th', 'ฝ่ายขายต่างประเทศ'],
  ['DOP', 'th', 'สายงานปฏิบัติการ'], ['MF', 'th', 'ฝ่ายผลิต'], ['DCP', 'th', 'สายงานองค์กร'], ['AD', 'th', 'ฝ่ายบริหาร'],
].map(([org_id, language_code, org_name]) => ({ org_id, language_code, org_name }));

const dim_fiscal_period = [];
for (const fy of [2026, 2027]) {
  for (let fm = 1; fm <= 12; fm++) {
    const cm = ((fm + 2) % 12) + 1;
    const cy = fm <= 9 ? fy : fy + 1;
    const pid = cy * 100 + cm;
    const last = new Date(Date.UTC(cy, cm, 0)).getUTCDate();
    dim_fiscal_period.push({
      period_id: pid, fiscal_year: fy, fiscal_month_no: fm, fiscal_quarter: Math.ceil(fm / 3),
      calendar_year: cy, calendar_month: cm, start_date: `${cy}-${pad(cm)}-01`, end_date: `${cy}-${pad(cm)}-${pad(last)}`,
      is_closed: pid <= 202706,
    });
  }
}
const FY26 = dim_fiscal_period.filter((p) => p.fiscal_year === 2026).map((p) => p.period_id);
const FY27 = dim_fiscal_period.filter((p) => p.fiscal_year === 2027).map((p) => p.period_id);
const AS_OF = 202706;
const CLOSED27 = FY27.filter((p) => p <= AS_OF);
const OPEN27 = FY27.filter((p) => p > AS_OF);

const dim_metric = [
  { metric_id: 'REV', metric_name: 'Revenue', favorable_direction: 1, sort_order: 1 },
  { metric_id: 'GP', metric_name: 'Gross profit', favorable_direction: 1, sort_order: 2 },
  { metric_id: 'SGA', metric_name: 'SG&A', favorable_direction: -1, sort_order: 3 },
  { metric_id: 'OP', metric_name: 'Operating profit', favorable_direction: 1, sort_order: 4 },
];
const dim_account = [
  ['4010', 'Product sales', 'REVENUE'], ['4020', 'Service revenue', 'REVENUE'],
  ['5010', 'Cost of sales (standard)', 'COGS'], ['5030', 'Material price variance', 'COGS'], ['5040', 'Production efficiency variance', 'COGS'],
  ['6010', 'Personnel expenses', 'SGA'], ['6020', 'Sales promotion', 'SGA'], ['6030', 'Logistics', 'SGA'],
  ['6040', 'Rent & facilities', 'SGA'], ['6050', 'Other SG&A', 'SGA'],
].map(([account_id, account_name, account_class], i) => ({ account_id, account_name, account_class, sort_order: i + 1 }));
const CLASS = Object.fromEntries(dim_account.map((a) => [a.account_id, a.account_class]));
const account_metric_map = dim_account.flatMap((a) => ({
  REVENUE: [['REV', 1], ['GP', 1], ['OP', 1]],
  COGS: [['GP', -1], ['OP', -1]],
  SGA: [['SGA', 1], ['OP', -1]],
}[a.account_class].map(([metric_id, sign]) => ({ account_id: a.account_id, metric_id, sign }))));

const dim_customer = [
  ['C01', 'Customer A', 'Japan', 'JP', 'SL'], ['C02', 'Customer B', 'Japan', 'JP', 'SL'], ['C03', 'Customer C', 'Japan', 'JP', 'SL'],
  ['C04', 'Customer D', 'ASEAN', 'TH', 'OS'], ['C05', 'Customer E', 'ASEAN', 'VN', 'OS'], ['C06', 'Customer B (Thailand)', 'ASEAN', 'TH', 'OS'],
  ['C07', 'Customer F', 'ASEAN', 'ID', 'OS'], ['C08', 'Customer G', 'China', 'CN', 'OS'], ['NA', '(not applicable)', '-', '-', null],
].map(([customer_id, customer_name, region, country, owner_org_id]) => ({ customer_id, customer_name, region, country, owner_org_id }));
const dim_product = [
  ['P01', 'Precision gear', 'Components'], ['P02', 'Sensor housing', 'Components'], ['P03', 'Drive module', 'Modules'],
  ['P04', 'Control module', 'Modules'], ['P05', 'Maintenance service', 'Services'], ['NA', '(not applicable)', '-'],
].map(([product_id, product_name, product_category]) => ({ product_id, product_name, product_category }));
const dim_scenario = [{ scenario_id: 'ACT', scenario_name: 'Actual' }, { scenario_id: 'BUD', scenario_name: 'Budget (original)' }];

const org_metric_applicability = [];
const NA = { MF: ['REV'], AD: ['REV', 'GP'], DOP: ['REV'], DCP: ['REV', 'GP'] };
dim_organization.forEach((o) => dim_metric.forEach((mt) => org_metric_applicability.push({
  org_id: o.org_id, metric_id: mt.metric_id, is_applicable: !(NA[o.org_id] || []).includes(mt.metric_id),
})));

/* ------------------------------------------------------------------ budget */
// org → class → [annual, Q1]
const ORG_BUDGET = {
  SL: { REVENUE: [3200, 790], COGS: [2430, 600], SGA: [480, 115] },
  OS: { REVENUE: [2100, 515], COGS: [1590, 390], SGA: [330, 77] },
  MF: { SGA: [40, 10] },
  AD: { SGA: [60, 15] },
};
const W_Q1 = [32, 33, 35];
const W_REST = { REVENUE: [100, 98, 105, 108, 110, 100, 95, 102, 112], COGS: [100, 98, 105, 108, 110, 100, 95, 102, 112], SGA: [100, 100, 102, 100, 100, 105, 98, 98, 110] };
// [customer, product, account, weight, gross margin]
const PAIRS = {
  SL: [['C01', 'P01', '4010', 22, 0.24], ['C01', 'P02', '4010', 12, 0.25], ['C02', 'P01', '4010', 20, 0.22], ['C02', 'P03', '4010', 14, 0.23],
    ['C03', 'P03', '4010', 15, 0.24], ['C03', 'P04', '4010', 10, 0.26], ['C01', 'P05', '4020', 7, 0.3]],
  OS: [['C04', 'P01', '4010', 22, 0.24], ['C04', 'P03', '4010', 12, 0.24], ['C05', 'P02', '4010', 13, 0.25], ['C06', 'P01', '4010', 15, 0.23],
    ['C07', 'P03', '4010', 14, 0.24], ['C07', 'P04', '4010', 10, 0.25], ['C08', 'P02', '4010', 9, 0.24], ['C08', 'P05', '4020', 5, 0.3]],
};
const SGA_W = {
  SL: [['6010', 50], ['6020', 20], ['6030', 20], ['6050', 10]],
  OS: [['6010', 45], ['6020', 25], ['6030', 20], ['6050', 10]],
  MF: [['6010', 60], ['6040', 30], ['6050', 10]],
  AD: [['6010', 50], ['6040', 35], ['6050', 15]],
};

const key = (s, p, o, a, cu, pr) => [s, p, o, a, cu, pr].join('|');
const factMap = new Map(); // key → cents
const addFact = (s, p, o, a, cu, pr, cents) => {
  const k = key(s, p, o, a, cu, pr);
  factMap.set(k, (factMap.get(k) || 0) + cents);
};

for (const [org, classes] of Object.entries(ORG_BUDGET)) {
  for (const [cls, [annual, q1]] of Object.entries(classes)) {
    const monthTotals = [...allocate(c(q1), W_Q1), ...allocate(c(annual - q1), W_REST[cls])];
    FY27.forEach((p, i) => {
      if (cls === 'SGA') {
        const parts = allocate(monthTotals[i], SGA_W[org].map((x) => x[1]));
        SGA_W[org].forEach(([acct], j) => addFact('BUD', p, org, acct, 'NA', 'NA', parts[j]));
      } else {
        const pairs = PAIRS[org];
        const w = pairs.map(([, , , wt, gm]) => (cls === 'REVENUE' ? wt : wt * (1 - gm)));
        const parts = allocate(monthTotals[i], w);
        pairs.forEach(([cu, pr, acct], j) => addFact('BUD', p, org, cls === 'REVENUE' ? acct : '5010', cu, pr, parts[j]));
      }
    });
  }
}

/* ----------------------------------------------- actual = budget + Point deltas */
for (const [k, v] of [...factMap]) {
  const [s, p, o, a, cu, pr] = k.split('|');
  if (s === 'BUD' && Number(p) <= AS_OF) addFact('ACT', Number(p), o, a, cu, pr, v);
}
// Child Point variance drivers (YTD Apr–Jun 2027). rev / cogs / sga are JPY M deltas vs budget.
const POINT_DRIVERS = {
  'PT-001-SL': { w: [20, 35, 45], rows: [{ o: 'SL', cu: 'C02', pr: 'P01', a: '4010', rev: -14.4, cogs: -10.2 }, { o: 'SL', cu: 'C02', pr: 'P03', a: '4010', rev: -9.6, cogs: -6.8 }] },
  'PT-001-OS': { w: [20, 35, 45], rows: [{ o: 'OS', cu: 'C06', pr: 'P01', a: '4010', rev: -8, cogs: -6 }] },
  // PT-002 and PT-004 ease month by month (A-01 shows them improving vs initial / vs last month).
  'PT-002-MF': { w: [38, 34, 28], rows: [{ o: 'MF', a: '5030', cogs: 8 }] },
  'PT-003-OS': { w: [20, 35, 45], rows: [{ o: 'OS', cu: 'C04', pr: 'P03', a: '4010', rev: 5, cogs: 3.3 }, { o: 'OS', cu: 'C05', pr: 'P02', a: '4010', rev: 4, cogs: 2.7 }] },
  'PT-004-SL': { w: [40, 32, 28], rows: [{ o: 'SL', a: '6030', sga: 3 }] },
  'PT-005-AD': { w: [20, 40, 40], rows: [{ o: 'AD', a: '6040', sga: -4 }] },
  // PT-006 first appears in June, so A-01 shows it as "Raised in Jun (new)".
  'PT-006-OS': { w: [0, 0, 100], rows: [{ o: 'OS', cu: 'C07', pr: 'P03', a: '4010', rev: -14, cogs: -10.5 }, { o: 'OS', cu: 'C07', pr: 'P04', a: '4010', rev: -10, cogs: -7.5 }] },
  'PT-007-MF': { w: [0, 45, 55], rows: [{ o: 'MF', a: '5040', cogs: -5 }] },
  // PT-008 is a new opportunity in June (concept slide 38: "Growth of high value-added products", Raised in Jun (new)).
  'PT-008-SL': { w: [0, 0, 100], rows: [{ o: 'SL', cu: 'C03', pr: 'P04', a: '4010', rev: 8, cogs: 5 }] },
  // OTHER absorbs PT-008 (rev −8, cogs −5 on SL) so the company KPIs stay on the concept figures.
  OTHER: { w: [33, 33, 34], rows: [
    { o: 'SL', cu: 'C01', pr: 'P01', a: '4010', rev: -13, cogs: -10.5 }, { o: 'OS', cu: 'C08', pr: 'P02', a: '4010', rev: -3, cogs: -3.5 },
    { o: 'SL', a: '6050', sga: -0.5 }, { o: 'OS', a: '6050', sga: -0.5 }] },
};
const pointMonthly = {}; // child point → period → {REV, GP, SGA, OP} (cents, monthly)
for (const [pt, d] of Object.entries(POINT_DRIVERS)) {
  pointMonthly[pt] = Object.fromEntries(CLOSED27.map((p) => [p, { REV: 0, GP: 0, SGA: 0, OP: 0 }]));
  for (const r of d.rows) {
    const cu = r.cu || 'NA', pr = r.pr || 'NA';
    const revA = allocate(c(r.rev || 0), d.w), cogsA = allocate(c(r.cogs || 0), d.w), sgaA = allocate(c(r.sga || 0), d.w);
    CLOSED27.forEach((p, i) => {
      if (revA[i]) addFact('ACT', p, r.o, r.a, cu, pr, revA[i]);
      if (cogsA[i]) addFact('ACT', p, r.o, r.a === '4010' || r.a === '4020' ? '5010' : r.a, cu, pr, cogsA[i]);
      if (sgaA[i]) addFact('ACT', p, r.o, r.a, cu, pr, sgaA[i]);
      const pm = pointMonthly[pt][p];
      pm.REV += revA[i]; pm.GP += revA[i] - cogsA[i]; pm.SGA += sgaA[i]; pm.OP += revA[i] - cogsA[i] - sgaA[i];
    });
  }
}
// Prior-year actuals (FY2026) for trend / prior-year comparison: ~95% of FY2027 budget with noise.
for (const [k, v] of [...factMap]) {
  const [s, p, o, a, cu, pr] = k.split('|');
  if (s !== 'BUD') continue;
  const py = Number(p) - 100;
  addFact('ACT', py, o, a, cu, pr, Math.round(v * (0.93 + rand() * 0.05)));
}
FY26.forEach((p) => { addFact('ACT', p, 'MF', '5030', 'NA', 'NA', Math.round((rand() - 0.5) * 120)); addFact('ACT', p, 'MF', '5040', 'NA', 'NA', Math.round((rand() - 0.3) * 150)); });

/* ----------------------------------------------------------------- Points */
const POINTS = [
  // parent, type, raised, gap dimension, indicator metric, indicator filter, children with annual OP impact by month [Apr, May, Jun]
  { id: 'PT-001', type: 'ISSUE', raised: 202704, gap: 'CUSTOMER', ind: 'REV', filter: { customer_id: ['C02', 'C06'] }, kids: { 'PT-001-SL': [-23, -26, -28], 'PT-001-OS': [-7, -8, -8] } },
  { id: 'PT-002', type: 'ISSUE', raised: 202704, gap: 'ACCOUNT', ind: 'GP', filter: { account_id: ['5030'] }, kids: { 'PT-002-MF': [-34, -32, -30] } },
  { id: 'PT-003', type: 'OPPORTUNITY', raised: 202704, gap: 'CUSTOMER', ind: 'REV', filter: { customer_id: ['C04', 'C05'] }, kids: { 'PT-003-OS': [14, 16, 18] } },
  { id: 'PT-004', type: 'ISSUE', raised: 202704, gap: 'ACCOUNT', ind: 'SGA', filter: { account_id: ['6030'], org_id: ['SL'] }, kids: { 'PT-004-SL': [-15, -13, -12] } },
  { id: 'PT-005', type: 'OPPORTUNITY', raised: 202704, gap: 'ACCOUNT', ind: 'SGA', filter: { account_id: ['6040'], org_id: ['AD'] }, kids: { 'PT-005-AD': [10, 12, 14] } },
  { id: 'PT-006', type: 'ISSUE', raised: 202706, gap: 'PRODUCT', ind: 'REV', filter: { customer_id: ['C07'] }, kids: { 'PT-006-OS': [null, null, -14] } },
  { id: 'PT-007', type: 'OPPORTUNITY', raised: 202705, gap: 'ACCOUNT', ind: 'GP', filter: { account_id: ['5040'] }, kids: { 'PT-007-MF': [null, 14, 16] } },
  { id: 'PT-008', type: 'OPPORTUNITY', raised: 202706, gap: 'PRODUCT', ind: 'REV', filter: { customer_id: ['C03'], product_id: ['P04'] }, kids: { 'PT-008-SL': [null, null, 12] } },
];
const POINT_STATUS = { 'PT-001': 'IN_ACTION', 'PT-002': 'IN_ACTION', 'PT-003': 'IN_ACTION', 'PT-004': 'IN_ACTION', 'PT-005': 'IN_ACTION', 'PT-006': 'OPEN', 'PT-007': 'IN_ACTION', 'PT-008': 'OPEN' };
const app_point = [], app_point_impact_snapshot = [];
for (const pt of POINTS) {
  app_point.push({ point_id: pt.id, parent_point_id: null, point_no: Number(pt.id.slice(3)), org_id: 'CO', point_type: pt.type, status: POINT_STATUS[pt.id],
    raised_period_id: pt.raised, title_comment_id: `CM-TITLE-${pt.id}`, gap_dimension: pt.gap, indicator_metric_id: pt.ind, indicator_filter: JSON.stringify(pt.filter) });
  const parentSnap = {};
  for (const [kid, annual] of Object.entries(pt.kids)) {
    const org = kid.split('-')[2];
    app_point.push({ point_id: kid, parent_point_id: pt.id, point_no: Number(pt.id.slice(3)), org_id: org, point_type: pt.type, status: POINT_STATUS[pt.id],
      raised_period_id: pt.raised, title_comment_id: `CM-TITLE-${pt.id}`, gap_dimension: pt.gap, indicator_metric_id: pt.ind, indicator_filter: JSON.stringify({ ...pt.filter, org_id: [org] }) });
    const cum = { REV: 0, GP: 0, SGA: 0, OP: 0 };
    CLOSED27.forEach((p, i) => {
      Object.keys(cum).forEach((k) => (cum[k] += pointMonthly[kid][p][k]));
      if (p < pt.raised) return;
      ['REV', 'GP', 'SGA', 'OP'].forEach((mt) => {
        const month = pointMonthly[kid][p][mt];
        app_point_impact_snapshot.push({ point_id: kid, as_of_period_id: p, metric_id: mt, impact_ytd: m(cum[mt]), impact_month: m(month), overall_impact_annual_op: annual[i] });
        const pk = p + '|' + mt;
        parentSnap[pk] = parentSnap[pk] || { ytd: 0, month: 0 };
        parentSnap[pk].ytd += cum[mt];
        parentSnap[pk].month += month;
        if (mt === 'OP') parentSnap[pk].annualOp = (parentSnap[pk].annualOp || 0) + annual[i];
      });
    });
  }
  CLOSED27.filter((p) => p >= pt.raised).forEach((p) => {
    const annual = parentSnap[p + '|OP'].annualOp;
    ['REV', 'GP', 'SGA', 'OP'].forEach((mt) => app_point_impact_snapshot.push({
      point_id: pt.id, as_of_period_id: p, metric_id: mt, impact_ytd: m(parentSnap[p + '|' + mt].ytd), impact_month: m(parentSnap[p + '|' + mt].month), overall_impact_annual_op: annual }));
  });
}
// Causes (as of Jun 2027) — numbers here, wording in ai_comment_text.
const CAUSES = [
  ['PT-001-SL', -18000, 'units', -4.2, 'fact_financial: customer C02 × product P01, Apr–Jun 2027 vs budget'],
  ['PT-001-SL', -1200, 'units', -2.8, 'fact_financial: customer C02 × product P03, Apr–Jun 2027 vs budget'],
  ['PT-001-OS', -6500, 'units', -2.0, 'fact_financial: customer C06 × product P01, Apr–Jun 2027 vs budget'],
  ['PT-002-MF', 9, '%', -6.0, 'fact_financial: account 5030 (MF), purchase price index'],
  ['PT-002-MF', 3, 'lots', -2.0, 'fact_financial: account 5030 (MF), spot purchase lots May 2027'],
  ['PT-003-OS', 4100, 'units', 1.8, 'fact_financial: customer C04 × product P03, Apr–Jun 2027'],
  ['PT-003-OS', 2600, 'units', 1.2, 'fact_financial: customer C05 × product P02, Apr–Jun 2027'],
  ['PT-004-SL', 140, 'shipments', -2.1, 'fact_financial: account 6030 (SL), express freight'],
  ['PT-004-SL', 12, '%', -0.9, 'fact_financial: account 6030 (SL), carrier fuel surcharge'],
  ['PT-005-AD', 1, 'floor', 2.8, 'fact_financial: account 6040 (AD), rent'],
  ['PT-005-AD', -18, '% kWh', 1.2, 'fact_financial: account 6040 (AD), utilities'],
  ['PT-006-OS', 3, 'orders', -4.5, 'fact_financial: customer C07 × products P03/P04, Jun 2027'],
  ['PT-006-OS', 2.4, 'months stock', -1.5, 'Distributor inventory report (proxy), Jun 2027'],
  ['PT-007-MF', 3.5, 'pt yield', 5.0, 'fact_financial: account 5040 (MF); production yield log Line 1'],
  ['PT-008-SL', 1300, 'units', 2.0, 'fact_financial: customer C03 × product P04, Jun 2027 vs budget'],
  ['PT-008-SL', 6, '% price', 1.0, 'fact_financial: customer C03 × product P04, average selling price Jun 2027'],
];
const app_point_cause = CAUSES.map(([point_id, quantity_value, quantity_unit, impact_op, evidence_ref], i) => ({
  cause_id: `CS-${pad(i + 1)}`, point_id, as_of_period_id: AS_OF, sort_order: i + 1, quantity_value, quantity_unit, impact_op, evidence_ref, comment_id: `CM-CAUSE-${pad(i + 1)}`,
}));

/* ---------------------------------------------------------------- Actions */
// kind: REV (revenue driven, GM 25%), COGS (cost), SGA. acct = account where effect lands.
const ACTIONS = [
  { id: 'ACT-001-SL-A01', point: 'PT-001-SL', org: 'SL', origin: 'AI', kind: 'REV', acct: '4010', start: 202706, end: 202712, plan: 7, outlook: 6, realized: { 202706: 0.4 },
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202706, prog: { 202706: [20, 'ON_TRACK', 6] } },
  { id: 'ACT-001-SL-A02', point: 'PT-001-SL', org: 'SL', origin: 'AI', kind: 'REV', acct: '4010', start: 202708, end: 202803, plan: 5, decision: 'PROPOSED', exec: 'NOT_STARTED' },
  { id: 'ACT-001-SL-U01', point: 'PT-001-SL', org: 'SL', origin: 'USER', kind: 'REV', acct: '4010', start: 202707, end: 202709, plan: 2, decision: 'ON_HOLD', exec: 'NOT_STARTED', holdUntil: 202709 },
  { id: 'ACT-001-OS-A01', point: 'PT-001-OS', org: 'OS', origin: 'AI', kind: 'REV', acct: '4010', start: 202706, end: 202803, plan: 3, outlook: 2.5, realized: { 202706: 0.2 },
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202706, prog: { 202706: [15, 'ON_TRACK', 2.5] } },
  { id: 'ACT-002-MF-A01', point: 'PT-002-MF', org: 'MF', origin: 'AI', kind: 'COGS', acct: '5030', start: 202707, end: 202803, plan: 6, outlook: 5, realized: {},
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202706, prog: { 202706: [25, 'ON_TRACK', 5] } },
  { id: 'ACT-002-MF-A02', point: 'PT-002-MF', org: 'MF', origin: 'AI', kind: 'COGS', acct: '5030', start: 202707, end: 202803, plan: 3.5, decision: 'REJECTED', exec: 'NOT_STARTED' },
  { id: 'ACT-003-OS-A01', point: 'PT-003-OS', org: 'OS', origin: 'AI', kind: 'REV', acct: '4010', start: 202707, end: 202803, plan: 4, outlook: 3, realized: {},
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202705, prog: { 202705: [5, 'ON_TRACK', 4], 202706: [10, 'DELAYED', 3] } },
  { id: 'ACT-004-SL-A01', point: 'PT-004-SL', org: 'SL', origin: 'AI', kind: 'SGA', acct: '6030', start: 202704, end: 202706, plan: 3, outlook: 2.5, realized: { 202704: 0.7, 202705: 0.9, 202706: 0.9 },
    decision: 'ADOPTED', exec: 'COMPLETED', adopted: 202704, prog: { 202704: [30, 'ON_TRACK', 3], 202705: [65, 'EFFECTIVE', 2.8], 202706: [100, 'COMPLETED', 2.5] } },
  { id: 'ACT-005-AD-U01', point: 'PT-005-AD', org: 'AD', origin: 'USER', kind: 'SGA', acct: '6040', start: 202705, end: 202803, plan: 2.5, outlook: 1.5, realized: { 202705: 0.1, 202706: 0.2 },
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202705, prog: { 202705: [20, 'ON_TRACK', 2.5], 202706: [40, 'AT_RISK', 1.5] } },
  { id: 'ACT-006-OS-A01', point: 'PT-006-OS', org: 'OS', origin: 'AI', kind: 'REV', acct: '4010', start: 202707, end: 202712, plan: 2, decision: 'PROPOSED', exec: 'NOT_STARTED' },
  { id: 'ACT-007-MF-A01', point: 'PT-007-MF', org: 'MF', origin: 'AI', kind: 'COGS', acct: '5040', start: 202706, end: 202803, plan: 4.5, outlook: 1.5, realized: { 202706: 0 },
    decision: 'ADOPTED', exec: 'IN_PROGRESS', adopted: 202705, prog: { 202705: [0, 'ON_TRACK', 4.5], 202706: [10, 'DELAYED', 1.5] } },
  { id: 'ACT-008-SL-A01', point: 'PT-008-SL', org: 'SL', origin: 'AI', kind: 'REV', acct: '4010', start: 202708, end: 202803, plan: 4, decision: 'PROPOSED', exec: 'NOT_STARTED' },
];
const TARGETS = { REV: ['REV', 'GP', 'OP'], COGS: ['GP', 'OP'], SGA: ['SGA', 'OP'] };
const toMetric = (kind, metric, opCents) => {
  if (metric === 'OP' || metric === 'GP') return opCents;
  if (metric === 'REV') return opCents * 4;          // GM 25%
  if (metric === 'SGA') return -opCents;             // cost saving
  return 0;
};
const app_action = [], app_action_target_metric = [], app_action_effect_monthly = [], app_action_progress = [], app_action_measurement = [];
for (const a of ACTIONS) {
  const seq = a.id.slice(-2);
  app_action.push({
    action_id: a.id, point_id: a.point, owner_org_id: a.org, origin: a.origin, seq_no: Number(seq),
    action_name_comment_id: `CM-ANAME-${a.id}`, description_comment_id: `CM-ADESC-${a.id}`,
    start_period_id: a.start, end_period_id: a.end, decision_state: a.decision, execution_state: a.exec,
    hold_until_period_id: a.holdUntil || null, adopted_period_id: a.adopted || null, effect_kind: a.kind,
  });
  TARGETS[a.kind].forEach((mt) => app_action_target_metric.push({ action_id: a.id, metric_id: mt }));
  const months = FY27.filter((p) => p >= a.start && p <= a.end);
  const plan = allocate(c(a.plan), months.map(() => 1));
  const adopted = a.decision === 'ADOPTED';
  const realizedC = Object.fromEntries(Object.entries(a.realized || {}).map(([p, v]) => [p, c(v)]));
  const realizedTotal = Object.values(realizedC).reduce((x, y) => x + y, 0);
  const openMonths = months.filter((p) => p > AS_OF);
  const outlook = adopted ? allocate(c(a.outlook) - realizedTotal, openMonths.map(() => 1)) : [];
  months.forEach((p, i) => {
    const actualOp = adopted && p <= AS_OF ? realizedC[p] || 0 : null;
    const outlookOp = adopted && p > AS_OF ? outlook[openMonths.indexOf(p)] : null;
    TARGETS[a.kind].forEach((mt) => app_action_effect_monthly.push({
      action_id: a.id, metric_id: mt, period_id: p,
      planned_effect: m(toMetric(a.kind, mt, plan[i])),
      actual_effect: actualOp === null ? null : m(toMetric(a.kind, mt, actualOp)),
      outlook_effect: outlookOp === null ? null : m(toMetric(a.kind, mt, outlookOp)),
      excluded_factor_amount: null,
    }));
  });
  for (const [p, [pct, status, outlookTotal]] of Object.entries(a.prog || {})) {
    app_action_progress.push({ action_id: a.id, period_id: Number(p), progress_pct: pct, ai_status: status, outlook_total_op: outlookTotal,
      comment_id: `CM-ASSESS-${a.id}-${p}`, updated_by: null });
  }
}
// Measurement configuration (P-01 output)
const MEAS = {
  'ACT-001-SL-A01': ['DIRECT', 'fact_financial (4010, 5010)', 'customer_id = C02; product_id IN (P01, P03)', '3-month average before start (Mar–May 2027)', '(actual revenue − baseline revenue) × gross margin 25%'],
  'ACT-001-SL-A02': ['DIRECT', 'fact_financial (4010, 5010)', 'customer_id = C02; product_id = P04', 'Budgeted P04 revenue for C02 (zero)', 'actual P04 revenue from C02 × gross margin 25%'],
  'ACT-001-SL-U01': ['DIRECT', 'fact_financial (4010, 5010)', 'customer_id = C02', '3-month average before start (Apr–Jun 2027)', '(actual revenue − baseline revenue) × gross margin 25%'],
  'ACT-001-OS-A01': ['DIRECT', 'fact_financial (4010, 5010)', 'customer_id = C06; product_id = P01', '3-month average before start (Mar–May 2027)', '(actual revenue − baseline revenue) × gross margin 25%'],
  'ACT-002-MF-A01': ['DIRECT', 'fact_financial (5030); purchase price list', 'org_id = MF; account 5030; supplier = local', 'Imported unit price × volume (Apr–Jun 2027 average)', '(imported unit price − local unit price) × local volume, excluding EV-001 FX effect'],
  'ACT-002-MF-A02': ['PROXY', 'Treasury FX contracts (not imported)', 'currency = THB/JPY', 'Spot rate at month start', 'hedged volume × (spot − forward rate)'],
  'ACT-003-OS-A01': ['DIRECT', 'fact_financial (4010, 5010)', 'customer region = ASEAN; country = VN', '3-month average before start (Apr–Jun 2027)', '(actual revenue − baseline revenue) × gross margin 25%, excluding EV-002'],
  'ACT-004-SL-A01': ['DIRECT', 'fact_financial (6030)', 'org_id = SL; account 6030', 'Budgeted logistics cost per shipment × shipments', 'baseline cost − actual logistics cost'],
  'ACT-005-AD-U01': ['DIRECT', 'fact_financial (6040)', 'org_id = AD; account 6040', 'Rent contract amount before renegotiation', 'baseline rent − actual rent'],
  'ACT-006-OS-A01': ['PROXY', 'Distributor order backlog (CSV import)', 'customer_id = C07', 'Order backlog Apr–Jun 2027 average', 'recovered backlog × average price × gross margin 25%'],
  'ACT-007-MF-A01': ['DIRECT', 'fact_financial (5040); production yield log', 'org_id = MF; Line 2', 'Line 2 yield 92.0% (Apr–May 2027)', '(actual yield − baseline yield) × material cost per point'],
  'ACT-008-SL-A01': ['DIRECT', 'fact_financial (4010, 5010)', 'org_id = SL; product_id = P04; customer_id IN (C01, C02)', 'Budgeted P04 revenue for C01 and C02', '(actual revenue − baseline revenue) × gross margin 25%'],
};
for (const [id, [mode, src, filter, baseline, formula]] of Object.entries(MEAS)) {
  app_action_measurement.push({ action_id: id, measurement_mode: mode, is_measurable: id !== 'ACT-002-MF-A02', source_tables: src, source_filter: filter,
    baseline_method: baseline, formula, proxy_indicator: mode === 'PROXY' ? src : null, proxy_reliability: mode === 'PROXY' ? (id === 'ACT-006-OS-A01' ? 'MEDIUM' : 'LOW') : null,
    ai_comment_id: `CM-AEXPL-${id}` });
}
const DECISIONS = [
  ['ACT-004-SL-A01', 'ADOPT', null, null, 'u02', '2027-04-08T09:12:00Z'],
  ['ACT-003-OS-A01', 'ADOPT', null, null, 'u03', '2027-05-12T03:40:00Z'],
  ['ACT-005-AD-U01', 'ADOPT', null, null, 'u05', '2027-05-06T02:10:00Z'],
  ['ACT-007-MF-A01', 'ADOPT', null, null, 'u04', '2027-05-20T06:00:00Z'],
  ['ACT-001-SL-A01', 'ADOPT', null, null, 'u02', '2027-06-03T01:30:00Z'],
  ['ACT-001-OS-A01', 'ADOPT', null, null, 'u03', '2027-06-05T04:20:00Z'],
  ['ACT-002-MF-A01', 'ADOPT', null, null, 'u04', '2027-06-10T02:00:00Z'],
  ['ACT-002-MF-A02', 'ADOPT', null, null, 'u04', '2027-06-10T02:05:00Z'],
  ['ACT-002-MF-A02', 'REJECT', 'FX exposure is hedged centrally by Treasury; local forward contracts are not permitted.', null, 'u01', '2027-06-12T08:15:00Z'],
  ['ACT-001-SL-U01', 'HOLD', 'Wait for Customer B mid-term plan announcement.', 202709, 'u02', '2027-06-20T05:00:00Z'],
];
const app_action_decision = DECISIONS.map(([action_id, decision, reason, hold, by, at], i) => ({
  decision_id: `DC-${pad(i + 1)}`, action_id, decision, reason, hold_until_period_id: hold, decided_by: by, decided_at: at,
  overrides_decision_id: action_id === 'ACT-002-MF-A02' && decision === 'REJECT' ? 'DC-08' : null,
}));
app_action.forEach((a) => {
  const last = app_action_decision.filter((d) => d.action_id === a.action_id).slice(-1)[0];
  a.latest_decider = last ? last.decided_by : null;
  a.latest_decided_at = last ? last.decided_at : null;
});

/* --------------------------------------------------------- Individual Factors */
const FACTORS = [
  { id: 'EV-001', cat: 'FX', org: 'MF', start: 202707, end: 202803, reg: 202706, incl: true, by: 'u04',
    amounts: { GP: -4.5, OP: -4.5 }, memo: 'Treasury FX outlook 2027-06: JPY/THB assumed 4.6 (budget 4.3).' },
  { id: 'EV-002', cat: 'EVENT', org: 'OS', start: 202710, end: 202710, reg: 202706, incl: true, by: 'u03',
    amounts: { SGA: 1.0, OP: -1.0 }, memo: 'Booth and travel cost estimate for the Bangkok industrial exhibition.' },
  { id: 'EV-003', cat: 'LAUNCH', org: 'SL', start: 202711, end: 202803, reg: 202706, incl: true, by: 'u02',
    amounts: { REV: 32, GP: 8, OP: 8 }, memo: 'Launch plan for sensor housing v2 (P02) approved 2027-06-15.' },
  { id: 'EV-004', cat: 'ORDER_DELAY', org: 'OS', start: 202710, end: 202712, reg: 202706, incl: false, by: 'u03',
    amounts: { REV: -8, GP: -2, OP: -2 }, memo: 'Possible delay of Customer F Q3 orders; under confirmation.' },
];
const app_factor = [], app_factor_org = [], app_factor_amount = [];
for (const f of FACTORS) {
  app_factor.push({ factor_id: f.id, category: f.cat, title_comment_id: `CM-FTITLE-${f.id}`, start_period_id: f.start, end_period_id: f.end,
    evidence_memo: f.memo, registered_period_id: f.reg, default_included: f.incl, is_deleted: false, created_by: f.by, created_at: '2027-06-25T00:00:00Z' });
  app_factor_org.push({ factor_id: f.id, org_id: f.org });
  const months = FY27.filter((p) => p >= f.start && p <= f.end);
  for (const [mt, total] of Object.entries(f.amounts)) {
    allocate(c(total), months.map(() => 1)).forEach((v, i) => app_factor_amount.push({ factor_id: f.id, org_id: f.org, metric_id: mt, period_id: months[i], amount: m(v) }));
  }
}
const app_action_factor_exclusion = [
  { action_id: 'ACT-002-MF-A01', factor_id: 'EV-001', metric_id: 'OP', period_from: 202707, period_to: 202803, excluded_amount: -4.5, method_comment_id: 'CM-EXCL-1' },
  { action_id: 'ACT-003-OS-A01', factor_id: 'EV-002', metric_id: 'OP', period_from: 202710, period_to: 202710, excluded_amount: -1.0, method_comment_id: 'CM-EXCL-2' },
];

/* ---------------------------------------------- Baseline forecast (no Actions) */
const BASELINE_OP = { SL: 255, OS: 165, MF: -42, AD: -50 };
const R_REV = { SL: 0.965, OS: 0.97 };
const R_SGA = { SL: 1.01, OS: 1.0, MF: 1.0 };
const fact_baseline_forecast = [];
const RUN = 'FCB-202706-01';
// closed months: actual − realized Action effect, at org × account
const acctTotals = new Map(); // scenario|period|org|acct → cents
for (const [k, v] of factMap) {
  const [s, p, o, a] = k.split('|');
  const kk = [s, p, o, a].join('|');
  acctTotals.set(kk, (acctTotals.get(kk) || 0) + v);
}
const realizedByAcct = new Map(); // period|org|acct → cents to subtract from actual amount
for (const a of ACTIONS.filter((x) => x.decision === 'ADOPTED')) {
  for (const [p, v] of Object.entries(a.realized || {})) {
    const op = c(v);
    const add = (acct, cents) => realizedByAcct.set([p, a.org, acct].join('|'), (realizedByAcct.get([p, a.org, acct].join('|')) || 0) + cents);
    if (a.kind === 'REV') { add('4010', op * 4); add('5010', op * 3); }
    if (a.kind === 'COGS') add(a.acct, -op);
    if (a.kind === 'SGA') add(a.acct, -op);
  }
}
for (const org of ['SL', 'OS', 'MF', 'AD']) {
  let opClosed = 0;
  for (const p of CLOSED27) {
    for (const acct of dim_account.map((x) => x.account_id)) {
      const act = acctTotals.get(['ACT', p, org, acct].join('|'));
      if (act === undefined) continue;
      const amt = act - (realizedByAcct.get([p, org, acct].join('|')) || 0);
      fact_baseline_forecast.push({ forecast_run_id: RUN, as_of_period_id: AS_OF, period_id: p, org_id: org, account_id: acct, amount: m(amt) });
      opClosed += amt * (CLASS[acct] === 'REVENUE' ? 1 : -1);
    }
  }
  const opOpen = c(BASELINE_OP[org]) - opClosed;
  const budOpen = (cls) => {
    const rows = [];
    for (const p of OPEN27) for (const a of dim_account.filter((x) => x.account_class === cls)) {
      const v = acctTotals.get(['BUD', p, org, a.account_id].join('|'));
      if (v !== undefined) rows.push({ p, a: a.account_id, v });
    }
    return rows;
  };
  const push = (rows, total) => allocate(total, rows.map((r) => r.v)).forEach((v, i) =>
    fact_baseline_forecast.push({ forecast_run_id: RUN, as_of_period_id: AS_OF, period_id: rows[i].p, org_id: org, account_id: rows[i].a, amount: m(v) }));
  const revRows = budOpen('REVENUE'), sgaRows = budOpen('SGA');
  const revOpen = Math.round(revRows.reduce((x, r) => x + r.v, 0) * (R_REV[org] || 0));
  let sgaOpen = Math.round(sgaRows.reduce((x, r) => x + r.v, 0) * (R_SGA[org] || 1));
  if (org === 'AD') sgaOpen = -opOpen;
  const cogsOpen = revOpen - sgaOpen - opOpen;
  if (revRows.length) push(revRows, revOpen);
  push(sgaRows, sgaOpen);
  if (org === 'AD') continue;
  const cogsRows = org === 'MF'
    ? OPEN27.flatMap((p) => [{ p, a: '5030', v: 1 }, { p, a: '5040', v: 1 }])
    : budOpen('COGS');
  push(cogsRows, cogsOpen);
}

/* -------------------------------------------------------- users & AI text */
const app_user = [
  { user_id: 'u01', display_name: 'Sato (Corporate Planning)', email: 'sato@sample.example', role: 'CORP_PLANNING', home_org_id: 'CO' },
  { user_id: 'u02', display_name: 'Tanaka (Sales Dept. Head)', email: 'tanaka@sample.example', role: 'ORG_HEAD', home_org_id: 'SL' },
  { user_id: 'u03', display_name: 'Somchai (Overseas Sales Head)', email: 'somchai@sample.example', role: 'ORG_HEAD', home_org_id: 'OS' },
  { user_id: 'u04', display_name: 'Suzuki (Manufacturing Head)', email: 'suzuki@sample.example', role: 'ORG_HEAD', home_org_id: 'MF' },
  { user_id: 'u05', display_name: 'Nittaya (Administration Head)', email: 'nittaya@sample.example', role: 'ORG_HEAD', home_org_id: 'AD' },
  { user_id: 'u06', display_name: 'Yamada (Sales Staff)', email: 'yamada@sample.example', role: 'ACTION_OWNER', home_org_id: 'SL' },
];
const app_user_org_scope = [
  { user_id: 'u01', org_id: 'CO', can_decide_action: true, can_confirm_forecast: false },
  { user_id: 'u02', org_id: 'SL', can_decide_action: true, can_confirm_forecast: true },
  { user_id: 'u03', org_id: 'OS', can_decide_action: true, can_confirm_forecast: true },
  { user_id: 'u04', org_id: 'MF', can_decide_action: true, can_confirm_forecast: true },
  { user_id: 'u05', org_id: 'AD', can_decide_action: true, can_confirm_forecast: true },
  { user_id: 'u06', org_id: 'SL', can_decide_action: false, can_confirm_forecast: false },
];
const app_user_preference = app_user.map((u) => ({ user_id: u.user_id, language_code: u.user_id === 'u03' || u.user_id === 'u05' ? 'th' : u.user_id === 'u01' ? 'en' : 'ja', last_period_id: null, last_org_id: null }));

const ai_run = [202704, 202705, 202706].map((p) => ({
  run_id: `RUN-${p}`, run_type: 'MONTHLY_ANALYSIS', as_of_period_id: p, model_name: 'TBD (mock)', prompt_version: 'mock-v1',
  source_load_id: `LOAD-PL-${p}`, status: 'SUCCEEDED', started_at: `${String(p).slice(0, 4)}-${String(p + 1).slice(4)}-03T00:00:00Z`, finished_at: null,
}));
const ai_comment = [], ai_comment_text = [];
function comment(id, type, entityType, entityId, pid, org, t) {
  ai_comment.push({ comment_id: id, run_id: `RUN-${pid}`, as_of_period_id: pid, org_id: org, comment_type: type, entity_type: entityType, entity_id: entityId, base_language: 'en', version: 1, is_current: true });
  for (const [lang, text] of Object.entries(t)) ai_comment_text.push({ comment_id: id, language_code: lang, text, is_base: lang === 'en', translated_at: lang === 'en' ? null : '2027-07-03T00:00:00Z', reviewed_by: null });
}
// A-01 summaries
comment('CM-SUM-202704-CO', 'A01_SUMMARY', 'org', 'CO', 202704, 'CO', {
  en: 'April operating profit is below budget. Main drivers: lower volume at Customer B, higher imported material prices and logistics cost overrun in domestic sales. Office cost savings and Southeast Asian demand are partial offsets.',
  ja: '4月の営業利益は予算を下回りました。主因は顧客Bの数量減少、輸入材料価格の上昇、国内営業の物流費超過です。オフィスコスト削減と東南アジアの需要増が一部を相殺しています。',
  th: 'กำไรจากการดำเนินงานเดือนเมษายนต่ำกว่างบประมาณ สาเหตุหลักคือยอดขายลูกค้า B ลดลง ราคาวัตถุดิบนำเข้าสูงขึ้น และค่าขนส่งในประเทศเกินงบ การลดต้นทุนสำนักงานและความต้องการในเอเชียตะวันออกเฉียงใต้ช่วยชดเชยบางส่วน' });
comment('CM-SUM-202705-CO', 'A01_SUMMARY', 'org', 'CO', 202705, 'CO', {
  en: 'The YTD gap to budget widened in May. One new Point was raised: a yield improvement opportunity in manufacturing. Imported material cost pressure eased slightly after April. Three Actions were adopted this month.',
  ja: '5月は予算差異が拡大しました。新たに1件のポイント（製造歩留まり改善の機会）を検出しました。輸入材料費の圧力は4月以降わずかに緩和しています。今月は3件のアクションが採用されました。',
  th: 'ช่องว่างสะสมเทียบกับงบประมาณกว้างขึ้นในเดือนพฤษภาคม มีประเด็นใหม่ 1 เรื่อง คือโอกาสปรับปรุงผลผลิตในการผลิต แรงกดดันจากต้นทุนวัตถุดิบนำเข้าลดลงเล็กน้อยหลังเดือนเมษายน เดือนนี้อนุมัติแอคชัน 3 รายการ' });
comment('CM-SUM-202706-CO', 'A01_SUMMARY', 'org', 'CO', 202706, 'CO', {
  en: 'YTD operating profit is JPY 86M, JPY 12M below budget. The largest issue is volume decline at Customer B (annualized −36M), followed by imported material cost increase (−30M, improved +4M since April). Two new Points were raised this month: order delays from Customer F in Indonesia (−14M) and an opportunity from domestic growth of high value-added control modules (+12M). Southeast Asian demand (+18M) and manufacturing yield (+16M) partly offset the issues. Adopted Actions have realized JPY 3.4M so far; their year-end outlook is JPY 22M against a plan of 30M, mainly because the Vietnam distributor expansion and the Line 2 yield rollout are delayed.',
  ja: '当期累計の営業利益は86百万円で、予算を12百万円下回っています。最大の課題は顧客Bの数量減少（年換算−36百万円）、次いで輸入材料費の上昇（−30百万円、4月比+4百万円改善）です。今月は新たに2件のポイントを検出しました。顧客F（インドネシア）の受注遅延（−14百万円）と、高付加価値の制御モジュールの国内での伸長という機会（+12百万円）です。東南アジアの需要拡大（+18百万円）と製造歩留まり改善（+16百万円）が課題を一部相殺しています。採用済みアクションの実現効果は3.4百万円、年度末見込みは計画30百万円に対し22百万円です。主因はベトナム販売網拡大とライン2歩留まり展開の遅れです。',
  th: 'กำไรจากการดำเนินงานสะสมอยู่ที่ 86 ล้านเยน ต่ำกว่างบประมาณ 12 ล้านเยน ประเด็นใหญ่ที่สุดคือยอดขายลูกค้า B ลดลง (ผลกระทบรายปี −36 ล้านเยน) รองลงมาคือต้นทุนวัตถุดิบนำเข้าสูงขึ้น (−30 ล้านเยน ดีขึ้น +4 ล้านเยนจากเดือนเมษายน) เดือนนี้พบประเด็นใหม่ 2 เรื่อง คือคำสั่งซื้อล่าช้าจากลูกค้า F ในอินโดนีเซีย (−14 ล้านเยน) และโอกาสจากการเติบโตของโมดูลควบคุมมูลค่าเพิ่มสูงในประเทศ (+12 ล้านเยน) ความต้องการในเอเชียตะวันออกเฉียงใต้ (+18 ล้านเยน) และการปรับปรุงผลผลิต (+16 ล้านเยน) ช่วยชดเชยบางส่วน แอคชันที่อนุมัติแล้วสร้างผลจริง 3.4 ล้านเยน และคาดการณ์ ณ สิ้นปี 22 ล้านเยน เทียบกับแผน 30 ล้านเยน เนื่องจากการขยายตัวแทนจำหน่ายในเวียดนามและการปรับปรุงผลผลิตสายการผลิต 2 ล่าช้า' });
comment('CM-SUM-202706-SL', 'A01_SUMMARY', 'org', 'SL', 202706, 'SL', {
  en: 'Sales Dept. YTD operating profit is JPY 9M below budget. Customer B volume decline (annualized −28M) and logistics cost overrun (−12M) are the main issues. Joint demand planning with Customer B started in June; the shipment consolidation Action was completed with JPY 2.5M realized. New this month: Customer C adopted the high-spec control module (+12M opportunity); the AI proposes offering it to Customers A and B.',
  ja: '営業部の当期累計営業利益は予算比9百万円の未達です。顧客Bの数量減少（年換算−28百万円）と物流費超過（−12百万円）が主な課題です。6月に顧客Bとの共同需要計画を開始し、出荷集約アクションは2.5百万円の効果を実現して完了しました。今月新たに、顧客Cが高仕様制御モジュールを採用した機会（+12百万円）を検出しました。AIは顧客A・Bへの提案を推奨しています。' });
comment('CM-SUM-202706-OS', 'A01_SUMMARY', 'org', 'OS', 202706, 'OS', {
  en: 'Overseas Sales YTD operating profit is JPY 4M below budget. Order delays from Customer F (−14M annualized) outweigh Southeast Asian demand growth (+18M opportunity not yet captured in Actions). The Vietnam distributor expansion is delayed.',
  ja: '海外営業部の当期累計営業利益は予算比4百万円の未達です。顧客Fの受注遅延（年換算−14百万円）が東南アジアの需要拡大を上回っています。ベトナム販売網拡大は遅延しています。',
  th: 'กำไรจากการดำเนินงานสะสมของฝ่ายขายต่างประเทศต่ำกว่างบ 4 ล้านเยน คำสั่งซื้อล่าช้าจากลูกค้า F (−14 ล้านเยนต่อปี) มากกว่าการเติบโตของความต้องการในเอเชียตะวันออกเฉียงใต้ การขยายตัวแทนจำหน่ายในเวียดนามล่าช้า' });
comment('CM-SUM-202706-MF', 'A01_SUMMARY', 'org', 'MF', 202706, 'MF', {
  en: 'Manufacturing cost variances are JPY 3M unfavorable YTD: imported material price increase (−8M) partly offset by the Line 1 yield improvement (+5M). Local supplier switch starts in July.',
  ja: '製造部の原価差異は累計で3百万円の不利差異です。輸入材料価格上昇（−8百万円）をライン1の歩留まり改善（+5百万円）が一部相殺しています。現地調達への切替は7月に開始します。' });
comment('CM-SUM-202706-AD', 'A01_SUMMARY', 'org', 'AD', 202706, 'AD', {
  en: 'Administration SG&A is JPY 4M below budget (favorable) thanks to the returned office floor and lower utilities. The lease renegotiation is behind schedule.',
  ja: '管理部の販管費はオフィスフロア返却と光熱費削減により予算比4百万円の有利です。賃料再交渉は予定より遅れています。',
  th: 'ค่าใช้จ่ายขายและบริหารของฝ่ายบริหารต่ำกว่างบ 4 ล้านเยน (เป็นผลดี) จากการคืนพื้นที่สำนักงานและค่าสาธารณูปโภคที่ลดลง การเจรจาค่าเช่าใหม่ล่าช้ากว่ากำหนด' });
// Point titles
const TITLES = {
  'PT-001': ['Volume decline at Customer B (Japan and Thailand)', '顧客B（日本・タイ）の数量減少', 'ยอดขายลูกค้า B (ญี่ปุ่นและไทย) ลดลง'],
  'PT-002': ['Imported material cost increase', '輸入材料費の上昇', 'ต้นทุนวัตถุดิบนำเข้าสูงขึ้น'],
  'PT-003': ['Demand growth in Southeast Asia', '東南アジアの需要拡大', 'ความต้องการเติบโตในเอเชียตะวันออกเฉียงใต้'],
  'PT-004': ['Logistics cost overrun in domestic sales', '国内営業の物流費超過', 'ค่าขนส่งในประเทศเกินงบ'],
  'PT-005': ['Office cost reduction', 'オフィスコストの削減', 'การลดต้นทุนสำนักงาน'],
  'PT-006': ['Order delays from Customer F (Indonesia)', '顧客F（インドネシア）の受注遅延', 'คำสั่งซื้อล่าช้าจากลูกค้า F (อินโดนีเซีย)'],
  'PT-007': ['Manufacturing yield improvement', '製造歩留まりの改善', 'การปรับปรุงผลผลิตการผลิต'],
  'PT-008': ['Growth of high value-added control modules (domestic)', '高付加価値製品（制御モジュール）の国内での伸長', 'การเติบโตของโมดูลควบคุมมูลค่าเพิ่มสูงในประเทศ'],
};
for (const [id, [en, ja, th]] of Object.entries(TITLES)) {
  const p = POINTS.find((x) => x.id === id);
  comment(`CM-TITLE-${id}`, 'POINT_TITLE', 'point', id, p.raised, 'CO', { en, ja, th });
}
const CAUSE_TEXT = [
  ['Customer B (Japan) moved part of its gear production in-house, reducing precision gear orders.', '顧客B（日本）がギア生産の一部を内製化し、精密ギアの受注が減少しました。'],
  ['Drive module orders fell after Customer B postponed its model change.', '顧客Bのモデルチェンジ延期により、駆動モジュールの受注が減少しました。'],
  ['Ramp-up of Customer B\'s Thailand plant is two months behind schedule.', '顧客Bタイ工場の立上げが2か月遅れています。'],
  ['Imported steel price is 9% above standard cost, mainly due to the weaker JPY.', '主に円安により、輸入鋼材価格が標準原価を9%上回っています。'],
  ['Spot purchases at premium prices covered a supplier shortage in May.', '5月の仕入先供給不足をプレミアム価格のスポット購入で補いました。'],
  ['Demand from EV component makers in Thailand exceeded budget.', 'タイのEV部品メーカーからの需要が予算を上回りました。'],
  ['A new distributor in Vietnam added volume from Customer E.', 'ベトナムの新規代理店により顧客Eの数量が増加しました。'],
  ['Express shipments increased because of short-notice orders.', '短納期受注により特急出荷が増加しました。'],
  ['Carriers raised fuel surcharges in May.', '5月に運送会社が燃料サーチャージを引き上げました。'],
  ['Returning one office floor in April reduced rent ahead of budget.', '4月にオフィス1フロアを返却し、予算より早く賃料が減少しました。'],
  ['Utility costs fell after LED replacement.', 'LED化により光熱費が減少しました。'],
  ['Customer F postponed module orders while renewing its import license.', '顧客Fが輸入ライセンス更新のためモジュールの発注を延期しました。'],
  ['Distributor inventory is above target, reducing reorders.', '代理店在庫が目標を上回り、再発注が減少しています。'],
  ['Line 1 yield improved from 92.0% to 95.5% after the process change.', '工程変更によりライン1の歩留まりが92.0%から95.5%に改善しました。'],
  ['Customer C adopted the control module for its new automation line; June volume exceeded budget.', '顧客Cが新自動化ラインに制御モジュールを採用し、6月の数量が予算を上回りました。'],
  ['The higher-spec version sells at a 6% premium over the standard model.', '高仕様版は標準品より6%高い価格で販売されています。'],
];
CAUSE_TEXT.forEach(([en, ja], i) => comment(`CM-CAUSE-${pad(i + 1)}`, 'POINT_CAUSE', 'point_cause', `CS-${pad(i + 1)}`, AS_OF, app_point_cause[i].point_id.split('-')[2], { en, ja }));
// Action names / descriptions / explanations / assessments
const ACT_TEXT = {
  'ACT-001-SL-A01': ['Joint demand planning with Customer B', '顧客Bとの共同需要計画', 'Share a rolling 6-month demand forecast with Customer B procurement and secure framework orders for precision gears and drive modules.', '顧客B購買部門と6か月ローリング需要予測を共有し、精密ギアと駆動モジュールの枠注文を確保する。'],
  'ACT-001-SL-A02': ['Propose control module as alternative to Customer B', '顧客Bへ制御モジュールを代替提案', 'Offer the control module (P04) for Customer B\'s next platform to replace lost gear volume.', '失注したギア数量を補うため、顧客Bの次期プラットフォームに制御モジュール（P04）を提案する。'],
  'ACT-001-SL-U01': ['Executive visit to Customer B headquarters', '顧客B本社へのトップ訪問', 'Management visit to confirm Customer B\'s mid-term sourcing plan.', '顧客Bの中期調達方針を確認するため経営層が訪問する。'],
  'ACT-001-OS-A01': ['Win orders for Customer B Thailand new line', '顧客Bタイ新ラインの受注獲得', 'Qualify precision gears for the new line at Customer B Thailand before its ramp-up.', '顧客Bタイ工場の新ライン立上げ前に精密ギアの認定を取得する。'],
  'ACT-002-MF-A01': ['Switch to local material supplier', '現地材料サプライヤーへの切替', 'Move 40% of imported steel volume to a qualified local supplier.', '輸入鋼材数量の40%を認定済み現地サプライヤーに切り替える。'],
  'ACT-002-MF-A02': ['FX forward contracts for material imports', '材料輸入の為替予約', 'Hedge THB/JPY exposure on material imports with forward contracts.', '材料輸入のTHB/JPYエクスポージャーを為替予約でヘッジする。'],
  'ACT-003-OS-A01': ['Expand distributor network in Vietnam', 'ベトナム販売網の拡大', 'Appoint two additional distributors in northern Vietnam.', 'ベトナム北部に代理店を2社追加する。'],
  'ACT-004-SL-A01': ['Consolidate shipments and optimize routes', '出荷集約とルート最適化', 'Consolidate small shipments into scheduled routes and limit express freight to approved cases.', '小口出荷を定期便に集約し、特急便を承認案件に限定する。'],
  'ACT-005-AD-U01': ['Renegotiate office lease', 'オフィス賃料の再交渉', 'Renegotiate the head-office lease based on current market rent.', '市場賃料に基づき本社の賃貸契約を再交渉する。'],
  'ACT-006-OS-A01': ['Weekly order-backlog review with Customer F', '顧客Fとの週次受注残レビュー', 'Review open orders weekly with Customer F and the distributor to release delayed orders after license renewal.', 'ライセンス更新後に遅延注文を解放するため、顧客Fと代理店で受注残を毎週確認する。'],
  'ACT-007-MF-A01': ['Roll out yield improvement to Line 2', 'ライン2への歩留まり改善の展開', 'Apply the Line 1 process change to Line 2.', 'ライン1の工程変更をライン2に展開する。'],
  'ACT-008-SL-A01': ['Offer the high-spec control module to Customers A and B', '顧客A・Bへ高仕様制御モジュールを提案', 'Use the Customer C installation as a reference and propose the high-spec control module (P04) to Customers A and B for their automation projects.', '顧客Cの導入事例を活用し、顧客A・Bの自動化案件に高仕様制御モジュール（P04）を提案する。'],
};
const ASSESS = {
  'ACT-001-SL-A01-202706': { en: 'On track. June revenue from Customer B recovered JPY 1.6M above baseline (JPY 0.4M operating profit). Framework order for Q3 is under negotiation. Outlook lowered from 7.0 to 6.0 because the drive-module model change remains postponed. Next step: confirm Q3 framework volume by July 20.',
    ja: '順調です。6月の顧客B売上はベースライン比1.6百万円回復（営業利益0.4百万円）。第3四半期の枠注文を交渉中です。駆動モジュールのモデルチェンジ延期が続くため、見込みを7.0から6.0に引き下げました。次のステップ：7月20日までに第3四半期の枠数量を確定。' },
  'ACT-003-OS-A01-202706': { en: 'Delayed. Distributor contracts in northern Vietnam are not yet signed (planned for June). Outlook reduced to JPY 3.0M. Alternative: start with one distributor in Hanoi and add the second in Q3. EV-002 exhibition effect is excluded from measurement.',
    ja: '遅延しています。ベトナム北部の代理店契約が未締結です（6月予定）。見込みを3.0百万円に引き下げました。代替案：まずハノイの1社で開始し、2社目は第3四半期に追加。EV-002（展示会）の効果は測定から除外しています。' },
  'ACT-005-AD-U01-202706': { en: 'At risk. Landlord rejected the first proposal; savings so far come only from the May interim discount. Outlook lowered to JPY 1.5M. Next step: present market-rent evidence in the July meeting.',
    ja: 'リスクあり。家主が初回提案を拒否し、現時点の削減は5月の暫定値引きのみです。見込みを1.5百万円に引き下げました。次のステップ：7月の協議で市場賃料の根拠を提示。' },
  'ACT-007-MF-A01-202706': { en: 'Delayed. Line 2 equipment modification slipped to September because of parts lead time. No effect yet. Outlook reduced from 4.5 to 1.5. Alternative: apply the process parameters without equipment change from August (estimated +0.5M).',
    ja: '遅延しています。部品の納期によりライン2の設備改造が9月にずれ込みました。効果はまだありません。見込みを4.5から1.5に引き下げました。代替案：設備改造なしで工程条件のみを8月から適用（推定+0.5百万円）。' },
  'ACT-004-SL-A01-202706': { en: 'Completed. Realized JPY 2.5M against a plan of 3.0M. Express freight requests fell by 35%; fuel surcharge increase (not controllable) explains the remaining gap.',
    ja: '完了しました。計画3.0百万円に対し2.5百万円を実現。特急便依頼は35%減少し、残りの差は燃料サーチャージ上昇（管理不能）によるものです。' },
  'ACT-002-MF-A01-202706': { en: 'On track (preparation). Supplier qualification finished; first local deliveries start in July. Outlook JPY 5.0M after excluding the EV-001 FX effect.',
    ja: '順調（準備段階）。サプライヤー認定が完了し、7月から現地納入を開始します。EV-001（為替）の影響を除外した見込みは5.0百万円です。' },
  'ACT-001-OS-A01-202706': { en: 'On track. Sample approval received; first order JPY 0.8M revenue in June. Outlook 2.5M because the plant ramp-up is two months late.',
    ja: '順調です。サンプル承認を取得し、6月に初回受注（売上0.8百万円）。工場立上げが2か月遅れているため見込みは2.5百万円です。' },
};
for (const [id, [nEn, nJa, dEn, dJa]] of Object.entries(ACT_TEXT)) {
  const a = ACTIONS.find((x) => x.id === id);
  comment(`CM-ANAME-${id}`, 'ACTION_NAME', 'action', id, 202706, a.org, { en: nEn, ja: nJa });
  comment(`CM-ADESC-${id}`, 'ACTION_DESCRIPTION', 'action', id, 202706, a.org, { en: dEn, ja: dJa });
  const meas = MEAS[id];
  comment(`CM-AEXPL-${id}`, 'ACTION_EXPLANATION', 'action', id, 202706, a.org, id === 'ACT-002-MF-A02'
    ? { en: 'Not measurable with available data: Treasury FX contract data is not imported to Fabric. Saving is blocked. Suggestion: import Treasury contract data or redefine the Action as a local purchase-price negotiation.',
        ja: '現在のデータでは測定できません。財務部の為替予約データがFabricに取り込まれていないため、保存はブロックされます。提案：財務部の契約データを取り込むか、現地購買価格交渉としてアクションを再定義してください。' }
    : { en: `Measured ${meas[0].toLowerCase()}ly from ${meas[1]}. Baseline: ${meas[3]}. Formula: ${meas[4]}. Planned FY effect on operating profit: JPY ${a.plan}M, allocated evenly from ${a.start} to ${a.end}.`,
        ja: `${meas[1]} から${meas[0] === 'DIRECT' ? '直接' : '代替指標で'}測定します。ベースライン：${meas[3]}。計算式：${meas[4]}。営業利益への年度計画効果は${a.plan}百万円（${a.start}〜${a.end}に均等配分）。` });
  for (const [p, [pct, status]] of Object.entries(a.prog || {})) {
    const t = ASSESS[`${id}-${p}`] || ASSESS_DEFAULT(status, pct);
    comment(`CM-ASSESS-${id}-${p}`, 'ACTION_ASSESSMENT', 'action', id, Number(p), a.org, t);
  }
}
function ASSESS_DEFAULT(status, pct) {
  return { en: `Status ${status.replace('_', ' ').toLowerCase()}, progress ${pct}%.`, ja: `状況：${status}、進捗${pct}%。` };
}
const FTITLE = {
  'EV-001': ['JPY weakness on imported materials', '輸入材料に対する円安影響'],
  'EV-002': ['Bangkok industrial exhibition', 'バンコク産業展示会'],
  'EV-003': ['Launch of sensor housing v2', 'センサーハウジングv2の発売'],
  'EV-004': ['Possible order delay – Customer F Q3', '顧客F第3四半期の受注遅延の可能性'],
};
for (const [id, [en, ja]] of Object.entries(FTITLE)) comment(`CM-FTITLE-${id}`, 'FACTOR_TITLE', 'factor', id, 202706, FACTORS.find((f) => f.id === id).org, { en, ja });
comment('CM-EXCL-1', 'EXCLUSION', 'action', 'ACT-002-MF-A01', 202706, 'MF', { en: 'FX movement (EV-001) is removed from the measured price difference using the Treasury monthly rate.', ja: '財務部の月次レートを用いて、測定した価格差から為替変動（EV-001）を除外します。' });
comment('CM-EXCL-2', 'EXCLUSION', 'action', 'ACT-003-OS-A01', 202706, 'OS', { en: 'Leads generated at the Bangkok exhibition (EV-002) are tagged and excluded from Vietnam distributor revenue.', ja: 'バンコク展示会（EV-002）由来の引合いはタグ付けし、ベトナム代理店売上から除外します。' });
comment('CM-F01-202706-CO', 'F01_EXPLANATION', 'org', 'CO', 202706, 'CO', {
  en: 'Company landing for operating profit is JPY 352.5M, JPY 17.5M below the original budget of 370M. Without Actions the forecast would be 328M. Adopted Actions contribute +22M (plan 30M) and included Individual Factors +2.5M (sensor housing launch +8M, FX −4.5M, exhibition −1M). Excluding the possible Customer F delay (EV-004) keeps 2M of risk outside the landing.',
  ja: '全社の営業利益着地見込みは352.5百万円で、当初予算370百万円を17.5百万円下回ります。アクションなしの予測は328百万円です。採用済みアクションが+22百万円（計画30百万円）、個別要因が+2.5百万円（センサーハウジング発売+8、為替−4.5、展示会−1）寄与します。顧客Fの遅延可能性（EV-004）は2百万円のリスクとして着地見込みに含めていません。',
  th: 'คาดการณ์กำไรจากการดำเนินงานทั้งบริษัท ณ สิ้นปีอยู่ที่ 352.5 ล้านเยน ต่ำกว่างบประมาณเดิม 370 ล้านเยนอยู่ 17.5 ล้านเยน หากไม่มีแอคชันจะอยู่ที่ 328 ล้านเยน แอคชันที่อนุมัติแล้วเพิ่ม +22 ล้านเยน (แผน 30) และปัจจัยเฉพาะที่รวมไว้ +2.5 ล้านเยน' });
comment('CM-A04-202706-CO', 'A04_INSIGHT', 'org', 'CO', 202706, 'CO', {
  en: 'Action effects peak in Q3 (Jul–Dec) when joint demand planning and the local supplier switch run together. From January only three Actions remain active, and expected monthly effect falls below JPY 1.5M. Line 2 yield (−3.0M vs plan) and the Vietnam expansion (−1.0M) are the largest shortfalls.',
  ja: 'アクション効果は共同需要計画と現地調達切替が重なる第3四半期（7〜12月）にピークとなります。1月以降は3件のみが継続し、月次見込み効果は1.5百万円を下回ります。最大の未達はライン2歩留まり（計画比−3.0百万円）とベトナム展開（−1.0百万円）です。' });

/* ------------------------------------------------------------- chat & audit */
const app_chat_thread = ACTIONS.filter((a) => a.decision !== 'PROPOSED').map((a) => ({ thread_id: `TH-${a.id}`, action_id: a.id }));
const app_chat_participant = app_chat_thread.flatMap((t) => {
  const org = t.action_id.split('-')[2];
  const owners = app_user_org_scope.filter((s) => s.org_id === org).map((s) => s.user_id);
  return ['u01', ...owners].map((u) => ({ thread_id: t.thread_id, user_id: u, added_by: 'u01' }));
});
const MSG = [
  ['ACT-001-SL-A01', 'u02', 'MESSAGE', 'Kick-off with Customer B procurement held. They will share the 6-month forecast every month.', [], false, null, '2027-06-05T02:00:00Z'],
  ['ACT-001-SL-A01', 'u06', 'MESSAGE', 'First forecast received. Q3 gear demand is 8% below last year, drive modules flat.', [], false, null, '2027-06-18T07:30:00Z'],
  ['ACT-001-SL-A01', 'u01', 'PROGRESS_REQUEST', '@Tanaka please update the Q3 framework order status before the July review.', ['u02'], true, '2027-07-20', '2027-07-02T01:00:00Z'],
  ['ACT-002-MF-A02', null, 'SYSTEM', 'Adoption by Suzuki (Manufacturing Head) was overridden: rejected by Sato (Corporate Planning). Reason: FX exposure is hedged centrally by Treasury.', ['u04'], true, null, '2027-06-12T08:15:00Z'],
  ['ACT-005-AD-U01', 'u05', 'MESSAGE', 'Landlord rejected the first proposal. Preparing market rent comparison for July.', [], false, null, '2027-06-24T03:00:00Z'],
  ['ACT-005-AD-U01', 'u01', 'PROGRESS_REQUEST', '@Nittaya please share the market rent comparison when ready.', ['u05'], true, '2027-07-15', '2027-07-01T02:00:00Z'],
  ['ACT-007-MF-A01', 'u04', 'MESSAGE', 'Equipment parts delayed to end of August. Evaluating parameter-only change for August.', [], false, null, '2027-06-28T06:00:00Z'],
  ['ACT-007-MF-A01', 'u01', 'MESSAGE', 'Thanks. Please include the expected effect of the parameter-only option in the next update.', ['u04'], true, null, '2027-07-01T03:00:00Z'],
  ['ACT-003-OS-A01', 'u03', 'MESSAGE', 'Second distributor candidate withdrew. Restarting search in Hai Phong.', [], false, null, '2027-06-26T09:00:00Z'],
];
const app_chat_message = MSG.map(([action, author, type, body, mentions, email, due, at], i) => ({
  message_id: `MS-${pad(i + 1)}`, thread_id: `TH-${action}`, author_id: author, message_type: type, body, mentions: mentions.join(','), email_notified: email, due_date: due, sent_at: at,
}));
const app_chat_read = [
  { thread_id: 'TH-ACT-001-SL-A01', user_id: 'u01', last_read_message_id: 'MS-02' },
  { thread_id: 'TH-ACT-005-AD-U01', user_id: 'u01', last_read_message_id: 'MS-05' },
  { thread_id: 'TH-ACT-007-MF-A01', user_id: 'u01', last_read_message_id: 'MS-07' },
  { thread_id: 'TH-ACT-001-SL-A01', user_id: 'u02', last_read_message_id: 'MS-02' },
];
const app_audit_event = [];
app_action_decision.forEach((d) => app_audit_event.push({ event_id: `AE-${pad(app_audit_event.length + 1)}`, resource_type: 'action', resource_id: d.action_id, actor_type: 'USER', actor_id: d.decided_by,
  event_type: `DECISION_${d.decision}`, old_value: null, new_value: d.reason || d.decision, occurred_at: d.decided_at }));
app_action_progress.forEach((p) => app_audit_event.push({ event_id: `AE-${pad(app_audit_event.length + 1)}`, resource_type: 'action', resource_id: p.action_id, actor_type: 'AI', actor_id: `RUN-${p.period_id}`,
  event_type: 'AI_ASSESSMENT', old_value: null, new_value: `${p.ai_status} / ${p.progress_pct}% / outlook ${p.outlook_total_op}`, occurred_at: `${String(p.period_id).slice(0, 4)}-${String(p.period_id + 1).slice(4)}-03T00:00:00Z` }));
app_chat_message.forEach((msg) => app_audit_event.push({ event_id: `AE-${pad(app_audit_event.length + 1)}`, resource_type: 'action', resource_id: msg.thread_id.slice(3), actor_type: msg.author_id ? 'USER' : 'SYSTEM', actor_id: msg.author_id,
  event_type: `CHAT_${msg.message_type}`, old_value: null, new_value: msg.body, occurred_at: msg.sent_at }));

/* ----------------------------------------------------------- assemble facts */
const fact_financial = [];
for (const [k, v] of factMap) {
  const [s, p, o, a, cu, pr] = k.split('|');
  fact_financial.push({ period_id: Number(p), org_id: o, account_id: a, customer_id: cu, product_id: pr, scenario_id: s, amount: m(v), load_id: s === 'BUD' ? 'LOAD-BUD-FY2027' : `LOAD-PL-${p}` });
}
fact_financial.sort((a, b) => a.period_id - b.period_id || a.org_id.localeCompare(b.org_id) || a.account_id.localeCompare(b.account_id));

const db = {
  dim_organization, dim_organization_text, dim_fiscal_period, dim_metric, dim_account, account_metric_map, dim_customer, dim_product, dim_scenario,
  org_metric_applicability, fact_financial, fact_baseline_forecast,
  app_user, app_user_org_scope, app_user_preference,
  app_point, app_point_impact_snapshot, app_point_cause,
  app_action, app_action_decision, app_action_measurement, app_action_target_metric, app_action_effect_monthly, app_action_progress,
  app_factor, app_factor_org, app_factor_amount, app_action_factor_exclusion,
  app_forecast_version: [], app_forecast_version_line: [], app_forecast_version_monthly: [], app_forecast_factor_selection: [], app_forecast_version_action: [],
  ai_run, ai_comment, ai_comment_text,
  app_chat_thread, app_chat_participant, app_chat_message, app_chat_read, app_audit_event,
  app_saved_bi_view: [
    { view_id: 'BV-01', owner_id: 'u01', name: 'Regional revenue trend', definition_json: JSON.stringify({ rows: 'region', cols: 'period', measure: 'REV', scenario: 'ACT' }), shared: true },
    { view_id: 'BV-02', owner_id: 'u01', name: 'Product cost ratio', definition_json: JSON.stringify({ rows: 'product_category', cols: 'scenario', measure: 'GP', scenario: 'ALL' }), shared: true },
  ],
};

/* ------------------------------------------------ Forecast versions (frozen) */
let M = build(db);
const VERSIONS = [
  { org: 'SL', no: 1, asOf: 202705, by: 'u02', at: '2027-06-08T09:00:00Z', opDelta: -6.5, sel: {} },
  { org: 'SL', no: 2, asOf: 202706, by: 'u02', at: '2027-07-07T09:00:00Z', opDelta: 0, sel: null },
  { org: 'OS', no: 1, asOf: 202705, by: 'u03', at: '2027-06-09T03:00:00Z', opDelta: 3.5, sel: {} },
  { org: 'OS', no: 2, asOf: 202706, by: 'u03', at: '2027-07-07T04:00:00Z', opDelta: 0, sel: null },
  { org: 'MF', no: 1, asOf: 202706, by: 'u04', at: '2027-07-06T07:00:00Z', opDelta: 0, sel: null },
  { org: 'AD', no: 1, asOf: 202706, by: 'u05', at: '2027-07-06T02:00:00Z', opDelta: 0, sel: null },
];
for (const v of VERSIONS) {
  const vid = `FV-${v.org}-2027-${pad(v.no)}`;
  const sel = v.sel || M.defaultFactorSelection(v.org, AS_OF);
  db.app_forecast_version.push({ forecast_version_id: vid, org_id: v.org, fiscal_year: 2027, as_of_period_id: v.asOf, version_no: v.no, confirmed_at: v.at, confirmed_by: v.by, baseline_run_id: RUN, note: null });
  for (const mt of ['REV', 'GP', 'SGA', 'OP']) {
    const f = M.forecastLive(v.org, AS_OF, mt, sel);
    const shift = mt === 'OP' || mt === 'GP' ? v.opDelta : 0;
    db.app_forecast_version_line.push({ forecast_version_id: vid, metric_id: mt, budget_annual: f.budget, baseline_no_action: M.r2(f.baseline + shift),
      action_contribution: f.action, factor_contribution: f.factor, landing: M.r2(f.landing + shift) });
    const monthly = M.forecastMonthlyLive(v.org, AS_OF, mt, sel);
    const open = monthly.filter((x) => x.period_id > v.asOf);
    const shiftParts = allocate(c(shift), open.map(() => 1));
    monthly.forEach((x) => {
      const isActual = x.period_id <= v.asOf;
      let fc = isActual ? null : (x.forecast ?? x.actual);
      if (!isActual) fc = M.r2(fc + m(shiftParts[open.indexOf(x)]));
      db.app_forecast_version_monthly.push({ forecast_version_id: vid, metric_id: mt, period_id: x.period_id, actual: isActual ? x.actual : null, forecast: fc, budget: x.budget });
    });
  }
  Object.entries(sel).forEach(([fid, inc]) => db.app_forecast_factor_selection.push({ forecast_version_id: vid, factor_id: fid, is_included: inc,
    applied_amount_op: inc ? M.factorAmount(fid, v.org, 'OP', M.fyPeriods(2027)) : 0 }));
  M.boardActions(v.org, AS_OF, true).forEach((a) => db.app_forecast_version_action.push({ forecast_version_id: vid, action_id: a.action_id, metric_id: 'OP', outlook_effect: M.actionTotals(a.action_id, AS_OF, 'OP').outlookFY }));
}
M = build(db);

/* ------------------------------------------------------------ reconciliation */
console.log('Reconciliation checks:');
assertEq('Company YTD Revenue', M.actualYTD('CO', AS_OF, 'REV'), 1250);
assertEq('Company YTD Revenue variance', M.varianceYTD('CO', AS_OF, 'REV'), -55);
assertEq('Company YTD GP', M.actualYTD('CO', AS_OF, 'GP'), 301);
assertEq('Company YTD GP variance', M.varianceYTD('CO', AS_OF, 'GP'), -14);
assertEq('Company YTD SG&A', M.actualYTD('CO', AS_OF, 'SGA'), 215);
assertEq('Company YTD SG&A variance', M.varianceYTD('CO', AS_OF, 'SGA'), -2);
assertEq('Company YTD OP', M.actualYTD('CO', AS_OF, 'OP'), 86);
assertEq('Company YTD OP variance', M.varianceYTD('CO', AS_OF, 'OP'), -12);
assertEq('Company FY OP budget', M.budgetAnnual('CO', 2027, 'OP'), 370);
const leafSum = ['SL', 'OS', 'MF', 'AD'].reduce((s, o) => s + M.actualYTD(o, AS_OF, 'OP'), 0);
assertEq('Σ leaf OP = company OP', M.r2(leafSum), 86);
const pts = M.pointsFor('CO', AS_OF);
const other = M.otherVariance('CO', AS_OF, pts);
assertEq('Point OP impacts + Other = OP variance', M.r2(pts.reduce((s, r) => s + r.impacts.OP, 0) + other.OP), -12);
assertEq('Other / unidentified OP', other.OP, -1);
const otherJun = M.otherVariance('CO', AS_OF, pts, 'month');
assertEq('June: Point OP impacts + Other = June OP variance', M.r2(pts.reduce((s, r) => s + r.monthImpacts.OP, 0) + otherJun.OP), M.varianceMonth('CO', AS_OF, 'OP'));
const roll = M.forecastRollup('CO', AS_OF, 'OP');
assertEq('Company baseline (no Actions)', roll.baseline, 328);
assertEq('Company Action contribution', roll.action, 22);
assertEq('Company included Factors', roll.factor, 2.5);
assertEq('Company landing', roll.landing, 352.5);
assertEq('Company landing vs budget', roll.variance, -17.5);
for (const pid of [202704, 202705, 202706]) {
  for (const o of ['CO', 'SL', 'OS', 'MF', 'AD']) {
    const g = M.actualYTD(o, pid, 'GP'), s = M.actualYTD(o, pid, 'SGA'), op = M.actualYTD(o, pid, 'OP');
    if (Math.abs(g - s - op) > 0.005) throw new Error(`OP ≠ GP − SG&A for ${o} ${pid}`);
  }
}
console.log('  ✓ OP = GP − SG&A for all orgs and periods');

/* ------------------------------------------------------------------- write */
for (const [name, rows] of Object.entries(db)) fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(rows, null, 1));
fs.writeFileSync(path.join(outDir, 'mock-db.js'),
  `/* GENERATED by tools/generate-mock-data.mjs — SIMULATED DATA, do not edit by hand. */\nwindow.MOCK_DB = ${JSON.stringify(db)};\n`);
console.log(`Wrote ${Object.keys(db).length} tables (${fact_financial.length} fact rows) to ${path.relative(process.cwd(), outDir)}`);
