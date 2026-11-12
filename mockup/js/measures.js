/*
 * Measures layer — JavaScript stand-in for the Power BI semantic model measures
 * described in docs/data-model.md §5. Every screen reads numbers ONLY through
 * these functions so the mockup behaves like the future DAX model.
 *
 * Works in the browser (window.Measures) and in Node (globalThis.Measures),
 * so the mock-data generator can freeze Forecast versions with the same logic.
 */
(function (root) {
  'use strict';

  const r2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
  const sum = (arr, f) => r2(arr.reduce((a, x) => a + (f ? f(x) : x), 0));
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];

  function build(db) {
    const M = { db, METRICS, r2 };

    /* ---------- Organization ---------- */
    const orgById = new Map(db.dim_organization.map((o) => [o.org_id, o]));
    const children = new Map();
    db.dim_organization.forEach((o) => {
      if (!o.parent_org_id) return;
      if (!children.has(o.parent_org_id)) children.set(o.parent_org_id, []);
      children.get(o.parent_org_id).push(o.org_id);
    });
    const leafCache = new Map();
    function leafOrgs(orgId) {
      if (leafCache.has(orgId)) return leafCache.get(orgId);
      const o = orgById.get(orgId);
      const res = o.is_leaf ? [orgId] : (children.get(orgId) || []).flatMap(leafOrgs);
      leafCache.set(orgId, res);
      return res;
    }
    function inScope(orgId, scopeOrgId) {
      const a = orgById.get(orgId), s = orgById.get(scopeOrgId);
      if (!a || !s) return false;
      return a.org_path === s.org_path || a.org_path.startsWith(s.org_path + '|');
    }
    M.org = (id) => orgById.get(id);
    M.children = (id) => children.get(id) || [];
    M.leafOrgs = leafOrgs;
    M.inScope = inScope;

    const applic = new Map(db.org_metric_applicability.map((r) => [r.org_id + '|' + r.metric_id, r.is_applicable]));
    M.isApplicable = (orgId, metricId) => {
      const v = applic.get(orgId + '|' + metricId);
      if (v !== undefined) return v;
      return leafOrgs(orgId).some((l) => applic.get(l + '|' + metricId));
    };

    /* ---------- Periods ---------- */
    const periodById = new Map(db.dim_fiscal_period.map((p) => [p.period_id, p]));
    M.period = (id) => periodById.get(id);
    M.fyPeriods = (fy) => db.dim_fiscal_period
      .filter((p) => p.fiscal_year === fy)
      .sort((a, b) => a.fiscal_month_no - b.fiscal_month_no)
      .map((p) => p.period_id);
    M.ytdPeriods = (pid) => {
      const p = periodById.get(pid);
      return M.fyPeriods(p.fiscal_year).filter((x) => periodById.get(x).fiscal_month_no <= p.fiscal_month_no);
    };
    M.closedPeriods = () => db.dim_fiscal_period.filter((p) => p.is_closed).map((p) => p.period_id).sort();
    M.latestClosed = () => M.closedPeriods().slice(-1)[0];
    M.prevPeriod = (pid) => {
      const all = db.dim_fiscal_period.map((p) => p.period_id).sort();
      const i = all.indexOf(pid);
      return i > 0 ? all[i - 1] : null;
    };

    /* ---------- Financial facts ---------- */
    const signMap = new Map();
    db.account_metric_map.forEach((r) => {
      if (!signMap.has(r.account_id)) signMap.set(r.account_id, {});
      signMap.get(r.account_id)[r.metric_id] = r.sign;
    });
    M.accountSign = (acct, metric) => (signMap.get(acct) || {})[metric] || 0;

    const factIdx = new Map();
    db.fact_financial.forEach((f) => {
      const k = f.scenario_id + '|' + f.period_id;
      if (!factIdx.has(k)) factIdx.set(k, []);
      factIdx.get(k).push(f);
    });

    /** Σ amount × sign for scenario / periods / org scope / metric, optional row filter. */
    function factValue(scenario, periods, orgId, metric, filter) {
      const leaves = new Set(leafOrgs(orgId));
      let s = 0;
      for (const p of periods) {
        for (const f of factIdx.get(scenario + '|' + p) || []) {
          if (!leaves.has(f.org_id)) continue;
          const sg = M.accountSign(f.account_id, metric);
          if (!sg) continue;
          if (filter && !filter(f)) continue;
          s += f.amount * sg;
        }
      }
      return r2(s);
    }
    /** Group Σ amount × sign by a fact column. */
    function factGroup(scenario, periods, orgId, metric, key, filter) {
      const leaves = new Set(leafOrgs(orgId));
      const out = {};
      for (const p of periods) {
        for (const f of factIdx.get(scenario + '|' + p) || []) {
          if (!leaves.has(f.org_id)) continue;
          const sg = M.accountSign(f.account_id, metric);
          if (!sg || (filter && !filter(f))) continue;
          out[f[key]] = (out[f[key]] || 0) + f.amount * sg;
        }
      }
      Object.keys(out).forEach((k) => (out[k] = r2(out[k])));
      return out;
    }
    M.factValue = factValue;
    M.factGroup = factGroup;

    M.actualYTD = (orgId, pid, metric) => factValue('ACT', M.ytdPeriods(pid), orgId, metric);
    M.budgetYTD = (orgId, pid, metric) => factValue('BUD', M.ytdPeriods(pid), orgId, metric);
    M.budgetAnnual = (orgId, fy, metric) => factValue('BUD', M.fyPeriods(fy), orgId, metric);
    M.varianceYTD = (orgId, pid, metric) => r2(M.actualYTD(orgId, pid, metric) - M.budgetYTD(orgId, pid, metric));
    M.varianceMonth = (orgId, pid, metric) => r2(factValue('ACT', [pid], orgId, metric) - factValue('BUD', [pid], orgId, metric));
    M.isFavorable = (metric, variance) => {
      const d = db.dim_metric.find((m) => m.metric_id === metric).favorable_direction;
      return variance * d > 0;
    };
    M.kpi = (orgId, pid, metric) => {
      const actual = M.actualYTD(orgId, pid, metric);
      const budget = M.budgetYTD(orgId, pid, metric);
      const variance = r2(actual - budget);
      return { metric, applicable: M.isApplicable(orgId, metric), actual, budget, variance, favorable: M.isFavorable(metric, variance) };
    };

    /* ---------- Points ---------- */
    const pointById = new Map(db.app_point.map((p) => [p.point_id, p]));
    const snapIdx = new Map();
    db.app_point_impact_snapshot.forEach((s) => {
      const k = s.point_id + '|' + s.as_of_period_id;
      if (!snapIdx.has(k)) snapIdx.set(k, { overall: s.overall_impact_annual_op, impacts: {}, month: {} });
      snapIdx.get(k).impacts[s.metric_id] = s.impact_ytd;
      snapIdx.get(k).month[s.metric_id] = s.impact_month ?? null;
    });
    M.point = (id) => pointById.get(id);
    M.pointChildren = (id) => db.app_point.filter((p) => p.parent_point_id === id);
    M.pointSnapshot = (id, pid) => snapIdx.get(id + '|' + pid) || null;

    /** Points visible for a scope: company → parent Points; other levels → child Points in scope. */
    M.pointsFor = (orgId, pid) => {
      const lvl = orgById.get(orgId).org_level;
      const list = lvl === 1
        ? db.app_point.filter((p) => !p.parent_point_id)
        : db.app_point.filter((p) => p.parent_point_id && inScope(p.org_id, orgId));
      return list.filter((p) => M.pointSnapshot(p.point_id, pid)).map((p) => M.pointRow(p.point_id, pid, orgId));
    };
    M.pointOrgs = (id) => {
      const p = pointById.get(id);
      return p.parent_point_id ? [p.org_id] : M.pointChildren(id).map((c) => c.org_id);
    };
    M.pointRow = (id, pid, scopeOrgId) => {
      const p = pointById.get(id);
      const snap = M.pointSnapshot(id, pid);
      const initial = M.pointSnapshot(id, p.raised_period_id);
      const prevPid = M.prevPeriod(pid);
      const prev = prevPid ? M.pointSnapshot(id, prevPid) : null;
      const acts = M.actionsForPoint(id).filter((a) => !scopeOrgId || inScope(a.owner_org_id, scopeOrgId));
      const executing = acts.filter((a) => M.isOnBoard(a, pid));
      const planned = sum(executing, (a) => M.actionTotals(a.action_id, pid, 'OP').planAnnual);
      const actual = sum(executing, (a) => M.actionTotals(a.action_id, pid, 'OP').actualToDate);
      // A-01 second row (concept slide 38): change since the Point was raised and since last month.
      // Metric columns compare the single-month impact (YTD impacts only accumulate, so they can't
      // show improvement); the overall column compares the annualized OP impact. A Point raised in
      // the selected month has no comparison yet (isNew).
      const isNew = p.raised_period_id === pid;
      const vsInit = {}, vsPrev = {};
      METRICS.forEach((m) => {
        const cur = snap.month[m] ?? 0;
        vsInit[m] = initial && !isNew ? r2(cur - (initial.month[m] ?? 0)) : null;
        vsPrev[m] = prev && !isNew ? r2(cur - (prev.month[m] ?? 0)) : null;
      });
      return {
        point: p, impacts: snap.impacts, monthImpacts: snap.month, overall: snap.overall,
        isNew, raisedPeriodId: p.raised_period_id,
        overallVsInit: initial && !isNew ? r2(snap.overall - initial.overall) : null,
        overallVsPrev: prev && !isNew ? r2(snap.overall - prev.overall) : null,
        vsInit, vsPrev, orgs: M.pointOrgs(id),
        proposalCount: acts.length, executingCount: executing.length,
        plannedEffect: planned, actualEffect: actual,
      };
    };
    /** Other / unidentified variance so Point impacts reconcile to Metric variances.
     *  basis 'ytd' (default) uses YTD impacts; 'month' uses the selected month only (A-01 table). */
    M.otherVariance = (orgId, pid, rows, basis = 'ytd') => {
      const out = {};
      const month = basis === 'month';
      METRICS.forEach((m) => (out[m] = r2((month ? M.varianceMonth : M.varianceYTD)(orgId, pid, m)
        - sum(rows, (r) => (month ? r.monthImpacts[m] : r.impacts[m]) || 0))));
      return out;
    };

    /* ---------- Actions ---------- */
    const actionById = new Map(db.app_action.map((a) => [a.action_id, a]));
    const effIdx = new Map();
    db.app_action_effect_monthly.forEach((e) => {
      const k = e.action_id + '|' + e.metric_id;
      if (!effIdx.has(k)) effIdx.set(k, []);
      effIdx.get(k).push(e);
    });
    M.action = (id) => actionById.get(id);
    M.actionsForPoint = (pointId) => {
      const p = pointById.get(pointId);
      const ids = p.parent_point_id ? [pointId] : M.pointChildren(pointId).map((c) => c.point_id);
      return db.app_action.filter((a) => ids.includes(a.point_id));
    };
    M.actionTargets = (id) => db.app_action_target_metric.filter((t) => t.action_id === id).map((t) => t.metric_id);
    M.isOnBoard = (a, pid) => a.decision_state === 'ADOPTED' && a.adopted_period_id && a.adopted_period_id <= pid;
    M.effectRows = (id, metric) => (effIdx.get(id + '|' + metric) || []).slice().sort((a, b) => a.period_id - b.period_id);

    /** Plan / actual / outlook totals for one Action and Metric, as of a closed period. */
    M.actionTotals = (id, pid, metric) => {
      const fy = periodById.get(pid).fiscal_year;
      const fyP = new Set(M.fyPeriods(fy));
      const rows = M.effectRows(id, metric).filter((r) => fyP.has(r.period_id));
      const planAnnual = sum(rows, (r) => r.planned_effect || 0);
      const planToDate = sum(rows.filter((r) => r.period_id <= pid), (r) => r.planned_effect || 0);
      const actualToDate = sum(rows.filter((r) => r.period_id <= pid), (r) => r.actual_effect || 0);
      const outlookFY = sum(rows, (r) => (r.period_id <= pid ? r.actual_effect || 0 : (r.outlook_effect ?? r.actual_effect ?? 0)));
      const prevPid = M.prevPeriod(pid);
      const actualPrev = prevPid ? sum(rows.filter((r) => r.period_id <= prevPid), (r) => r.actual_effect || 0) : 0;
      return {
        planAnnual, planToDate, actualToDate, outlookFY,
        remaining: r2(outlookFY - actualToDate),
        momActual: r2(actualToDate - actualPrev),
        outlookVsPlan: r2(outlookFY - planAnnual),
        progressPct: planAnnual ? Math.round((actualToDate / planAnnual) * 100) : 0,
      };
    };
    M.actionProgress = (id, pid) => db.app_action_progress
      .filter((p) => p.action_id === id && p.period_id <= pid)
      .sort((a, b) => b.period_id - a.period_id)[0] || null;
    M.actionExclusions = (id) => db.app_action_factor_exclusion.filter((x) => x.action_id === id);
    M.boardActions = (orgId, pid, includeHistory) => db.app_action.filter((a) => {
      if (!inScope(a.owner_org_id, orgId) || !M.isOnBoard(a, pid)) return false;
      if (includeHistory) return true;
      return !['COMPLETED', 'STOPPED'].includes(a.execution_state);
    });
    M.actionDecisions = (id) => db.app_action_decision.filter((d) => d.action_id === id)
      .sort((a, b) => String(a.decided_at).localeCompare(String(b.decided_at)));

    /* ---------- Individual Factors ---------- */
    M.factor = (id) => db.app_factor.find((f) => f.factor_id === id);
    M.factorsFor = (orgId, pid) => {
      const fy = periodById.get(pid).fiscal_year;
      const fyP = M.fyPeriods(fy);
      return db.app_factor.filter((f) => !f.is_deleted
        && f.registered_period_id <= pid
        && f.start_period_id <= fyP[11] && f.end_period_id >= fyP[0]
        && db.app_factor_org.some((o) => o.factor_id === f.factor_id && inScope(o.org_id, orgId)));
    };
    M.factorAmount = (factorId, orgId, metric, periods) => sum(
      db.app_factor_amount.filter((a) => a.factor_id === factorId && a.metric_id === metric
        && inScope(a.org_id, orgId) && (!periods || periods.includes(a.period_id))),
      (a) => a.amount);

    /* ---------- Forecast ---------- */
    function baselineValue(orgId, periods, metric) {
      const leaves = new Set(leafOrgs(orgId));
      const ps = new Set(periods);
      let s = 0;
      for (const b of db.fact_baseline_forecast) {
        if (!leaves.has(b.org_id) || !ps.has(b.period_id)) continue;
        const sg = M.accountSign(b.account_id, metric);
        if (sg) s += b.amount * sg;
      }
      return r2(s);
    }
    M.baselineValue = baselineValue;
    M.defaultFactorSelection = (orgId, pid) => {
      const sel = {};
      M.factorsFor(orgId, pid).forEach((f) => (sel[f.factor_id] = f.default_included));
      return sel;
    };
    /** Live (unconfirmed) Forecast for a leaf organization. */
    M.forecastLive = (orgId, pid, metric, selection) => {
      const fy = periodById.get(pid).fiscal_year;
      const fyP = M.fyPeriods(fy);
      const sel = selection || M.defaultFactorSelection(orgId, pid);
      const budget = M.budgetAnnual(orgId, fy, metric);
      const baseline = baselineValue(orgId, fyP, metric);
      const actions = M.boardActions(orgId, pid, true).filter((a) => a.execution_state !== 'STOPPED');
      const action = sum(actions, (a) => M.actionTotals(a.action_id, pid, metric).outlookFY);
      const factors = M.factorsFor(orgId, pid);
      const factor = sum(factors.filter((f) => sel[f.factor_id]), (f) => M.factorAmount(f.factor_id, orgId, metric, fyP));
      const landing = r2(baseline + action + factor);
      return { metric, budget, baseline, action, factor, landing, variance: r2(landing - budget) };
    };
    M.forecastMonthlyLive = (orgId, pid, metric, selection) => {
      const fy = periodById.get(pid).fiscal_year;
      const sel = selection || M.defaultFactorSelection(orgId, pid);
      const actions = M.boardActions(orgId, pid, true).filter((a) => a.execution_state !== 'STOPPED');
      const factors = M.factorsFor(orgId, pid).filter((f) => sel[f.factor_id]);
      return M.fyPeriods(fy).map((p) => {
        const budget = factValue('BUD', [p], orgId, metric);
        if (p <= pid) return { period_id: p, actual: factValue('ACT', [p], orgId, metric), forecast: null, budget };
        const base = baselineValue(orgId, [p], metric);
        const act = sum(actions, (a) => {
          const r = M.effectRows(a.action_id, metric).find((x) => x.period_id === p);
          return r ? (r.outlook_effect ?? r.actual_effect ?? 0) : 0;
        });
        const fac = sum(factors, (f) => M.factorAmount(f.factor_id, orgId, metric, [p]));
        return { period_id: p, actual: null, forecast: r2(base + act + fac), budget };
      });
    };
    M.versionsFor = (orgId) => db.app_forecast_version.filter((v) => v.org_id === orgId)
      .sort((a, b) => b.version_no - a.version_no);
    M.latestVersion = (orgId, pid) => M.versionsFor(orgId).find((v) => v.as_of_period_id <= pid) || null;
    M.versionLine = (vid, metric) => db.app_forecast_version_line.find((l) => l.forecast_version_id === vid && l.metric_id === metric);
    /** Company / division Forecast = Σ latest confirmed versions of leaf organizations (read-only). */
    M.forecastRollup = (orgId, pid, metric) => {
      const parts = leafOrgs(orgId).map((l) => ({ org_id: l, version: M.latestVersion(l, pid) }));
      const lines = parts.filter((x) => x.version).map((x) => M.versionLine(x.version.forecast_version_id, metric));
      const f = (k) => sum(lines, (l) => l[k]);
      const landing = f('landing');
      const budget = f('budget_annual');
      return {
        metric, budget, baseline: f('baseline_no_action'), action: f('action_contribution'),
        factor: f('factor_contribution'), landing, variance: r2(landing - budget),
        parts, missing: parts.filter((x) => !x.version).map((x) => x.org_id),
      };
    };
    M.forecastMonthlyRollup = (orgId, pid, metric) => {
      const fy = periodById.get(pid).fiscal_year;
      const vids = leafOrgs(orgId).map((l) => M.latestVersion(l, pid)).filter(Boolean).map((v) => v.forecast_version_id);
      return M.fyPeriods(fy).map((p) => {
        const rows = db.app_forecast_version_monthly.filter((m) => vids.includes(m.forecast_version_id) && m.metric_id === metric && m.period_id === p);
        const pick = (k) => (rows.some((r) => r[k] !== null) ? sum(rows, (r) => r[k] || 0) : null);
        return { period_id: p, actual: pick('actual'), forecast: pick('forecast'), budget: pick('budget') };
      });
    };

    /* ---------- AI comments ---------- */
    const textIdx = new Map(db.ai_comment_text.map((t) => [t.comment_id + '|' + t.language_code, t]));
    M.commentText = (commentId, lang) => {
      if (!commentId) return null;
      const t = textIdx.get(commentId + '|' + lang);
      if (t) return { text: t.text, lang, fallback: false };
      const c = db.ai_comment.find((x) => x.comment_id === commentId);
      const base = c && textIdx.get(commentId + '|' + c.base_language);
      return base ? { text: base.text, lang: c.base_language, fallback: true } : null;
    };
    M.findComment = (type, entityId, pid, orgId) => {
      const list = db.ai_comment.filter((c) => c.is_current && c.comment_type === type
        && (entityId === undefined || c.entity_id === entityId)
        && (pid === undefined || c.as_of_period_id <= pid)
        && (orgId === undefined || c.org_id === orgId));
      return list.sort((a, b) => b.as_of_period_id - a.as_of_period_id)[0] || null;
    };

    return M;
  }

  root.Measures = { build, METRICS, r2 };
})(typeof window !== 'undefined' ? window : globalThis);
