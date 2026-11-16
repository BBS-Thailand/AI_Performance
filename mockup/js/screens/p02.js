/* P-02 Individual Factor (modal) — README §4.2, concept slide 49.
 * The type comes from a fixed list. DRIVER types (FX, volume, price, material) take a driver change and the
 * forecast model's sensitivity turns it into monthly P&L amounts. AMOUNT types (order delay, launch, event)
 * take monthly amounts typed by the user. Amounts are stored per org × Metric × month, so F-01 just adds them. */
(function () {
  'use strict';
  const A = window.App;
  const EDIT = ['REV', 'GP', 'SGA'];       // OP = GP − SG&A, always calculated
  const ALL = ['REV', 'GP', 'SGA', 'OP'];

  function openFactor(factorId, { readOnly = false, category = null } = {}) {
    const { t, esc, fmt, M, state, db } = A;
    const existing = factorId ? M.factor(factorId) : null;
    const pid = state.periodId;
    const fy = M.period(pid).fiscal_year;
    const openMonths = M.fyPeriods(fy).filter((p) => p > pid);
    const run = M.modelRun(pid);
    const leafChoices = A.userOrgs().filter((o) => M.org(o).is_leaf);
    const orgsOf = existing ? M.factorOrgs(existing.factor_id) : [M.org(state.orgId).is_leaf ? state.orgId : leafChoices[0]];
    const ro = readOnly || (existing && !orgsOf.every((o) => A.canEditOrg(o))) || (!existing && !leafChoices.length);
    if (!existing && !openMonths.length) { A.toast(t('no_open_months'), true); return; }

    // Form state
    const f = {
      category: existing ? existing.category : category || 'ORDER_DELAY',
      title: existing ? (existing.title || A.aiPlain(existing.title_comment_id)) : '',
      orgs: orgsOf.slice(),
      start: existing ? existing.start_period_id : openMonths[0],
      end: existing ? existing.end_period_id : openMonths[Math.min(2, openMonths.length - 1)],
      memo: existing ? existing.evidence_memo || '' : '',
      drvFrom: existing && existing.driver_from !== null ? existing.driver_from : null,
      drvTo: existing && existing.driver_to !== null ? existing.driver_to : null,
      amounts: {}, // org → metric → period → value (AMOUNT mode)
    };
    if (existing) {
      db.app_factor_amount.filter((a) => a.factor_id === existing.factor_id).forEach((a) => {
        ((f.amounts[a.org_id] ||= {})[a.metric_id] ||= {})[a.period_id] = a.amount;
      });
    }
    const months = () => M.fyPeriods(fy).filter((p) => p >= f.start && p <= f.end);
    const type = () => M.factorType(f.category);
    const drv = () => (type().driver_id ? M.driver(type().driver_id) : null);
    function initDriver() {
      const d = drv();
      if (!d) return;
      if (f.drvFrom === null || existing?.driver_id !== d.driver_id) { f.drvFrom = d.value_type === 'LEVEL' ? d.budget_value : 0; }
      if (f.drvTo === null || existing?.driver_id !== d.driver_id) { f.drvTo = f.drvFrom; }
    }
    initDriver();

    /** Monthly amounts for one org: { period: {REV, GP, SGA, OP} } — calculated (DRIVER) or typed (AMOUNT). */
    function amountsFor(org) {
      const out = {};
      if (type().input_mode === 'DRIVER') {
        const rows = M.driverAmounts(org, type().driver_id, A.M.r2(f.drvTo - f.drvFrom), months(), existing?.sensitivity_run_id || run?.forecast_run_id);
        if (!rows) return null;
        rows.forEach((r) => (out[r.period_id] = r));
        return out;
      }
      months().forEach((p) => {
        const r = { period_id: p };
        EDIT.forEach((mt) => { const v = f.amounts[org]?.[mt]?.[p]; if (v !== undefined && v !== null && v !== '') r[mt] = Number(v); });
        r.OP = A.M.r2((r.GP || 0) - (r.SGA || 0));
        out[p] = r;
      });
      return out;
    }

    function amountTable(org) {
      const ms = months();
      const calc = amountsFor(org);
      const isDriver = type().input_mode === 'DRIVER';
      if (!calc) return `<div class="warnbox">${esc(t('no_sensitivity', { d: t('drv_' + type().driver_id), o: A.orgName(org) }))}</div>`;
      const rows = ALL.map((mt) => {
        const na = !M.isApplicable(org, mt);
        const editable = !isDriver && !ro && mt !== 'OP' && !na;
        const tot = A.M.r2(ms.reduce((s, p) => s + (calc[p]?.[mt] || 0), 0));
        const cells = ms.map((p) => {
          const v = calc[p]?.[mt];
          if (na) return `<td class="num faint">–</td>`;
          return editable
            ? `<td><input class="amt" type="number" step="0.1" data-amt="${org}|${mt}|${p}" value="${v ?? ''}" aria-label="${esc(t(mt))} ${esc(A.monthLabel(p))}"></td>`
            : `<td class="num ${A.tone(mt, v)}">${v === undefined ? '–' : A.fmtSigned(v, 2)}</td>`;
        }).join('');
        const totCell = editable
          ? `<td><input class="amt tot" type="number" step="0.1" data-tot="${org}|${mt}" value="${tot || ''}" title="${esc(t('spread_evenly'))}"></td>`
          : `<td class="num"><b>${na ? '–' : A.fmtSigned(tot)}</b></td>`;
        return `<tr class="${mt === 'OP' ? 'op-row' : ''}"><td class="nowrap">${esc(t(mt))}</td>${cells}${totCell}</tr>`;
      }).join('');
      return `<div class="table-wrap"><table class="grid-table amount-grid"><thead><tr><th>${esc(A.orgName(org))}</th>${ms.map((p) => `<th class="num">${esc(A.monthLabel(p))}</th>`).join('')}<th class="num">${esc(t('units_total'))}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }

    function driverBlock() {
      const d = drv();
      if (!d) return '';
      const runId = existing?.sensitivity_run_id || run?.forecast_run_id;
      const sens = f.orgs.map((o) => {
        const k = M.sensitivity(o, d.driver_id, runId);
        const step = d.value_type === 'LEVEL' ? 0.1 : 1;
        return k ? `<li>${esc(A.orgName(o))}: ${esc(t('sens_line', { step: d.value_type === 'LEVEL' ? `+${step} ${d.unit}` : '+1%', op: A.fmtSigned(A.M.r2(k.OP * step), 2) }))} <span class="tag sig-${k.significance}">${esc(t('sig_' + k.significance))}</span></li>` : '';
      }).join('');
      const input = d.value_type === 'LEVEL'
        ? `<input type="number" step="0.01" id="drv-from" value="${f.drvFrom}" ${ro ? 'disabled' : ''} style="width:90px"> → <input type="number" step="0.01" id="drv-to" value="${f.drvTo}" ${ro ? 'disabled' : ''} style="width:90px"> ${esc(d.unit)}
           <span class="hint">${esc(t('budget_assumption', { v: fmt(d.budget_value, d.decimals) + ' ' + d.unit }))}</span>`
        : `<input type="number" step="0.5" id="drv-to" value="${f.drvTo}" ${ro ? 'disabled' : ''} style="width:90px"> %  <span class="hint">${esc(t('pct_hint'))}</span>`;
      return `<label>${esc(t('driver_change'))} *</label><div>${input}
        <ul class="sens-list">${sens}</ul><div class="hint">${esc(t('driver_calc_note', { run: runId || '–' }))}</div></div>`;
    }

    function aiBlock() {
      // Simulated AI checks (production: AI service + rules over the same tables).
      const ms = months();
      const items = [];
      const totals = {};
      let missing = false;
      f.orgs.forEach((o) => { const c = amountsFor(o); if (!c) { missing = true; return; } ALL.forEach((mt) => (totals[mt] = A.M.r2((totals[mt] || 0) + ms.reduce((s, p) => s + (c[p]?.[mt] || 0), 0)))); });
      if (!missing) items.push(t('ai_landing_effect', { v: A.fmtSigned(totals.OP || 0) }));
      const touched = ALL.filter((mt) => Math.abs(totals[mt] || 0) > 0.0001);
      M.db.app_action.filter((a) => f.orgs.includes(a.owner_org_id) && a.decision_state === 'ADOPTED' && a.start_period_id <= f.end && a.end_period_id >= f.start)
        .forEach((a) => {
          const shared = M.actionTargets(a.action_id).filter((mt) => mt !== 'OP' && touched.includes(mt));
          if (shared.length) items.push(t('ai_action_overlap', { id: a.action_id, name: A.actionNamePlain(a), m: shared.map((x) => t(x)).join(', ') }));
        });
      const dup = M.db.app_factor.filter((x) => !x.is_deleted && x.factor_id !== existing?.factor_id && x.category === f.category
        && x.start_period_id <= f.end && x.end_period_id >= f.start && M.factorOrgs(x.factor_id).some((o) => f.orgs.includes(o)));
      dup.forEach((x) => items.push(t('ai_factor_dup', { id: x.factor_id })));
      if (type().input_mode === 'DRIVER') items.push(t('ai_driver_baseline', { v: drv().value_type === 'LEVEL' ? `${fmt(drv().budget_value, drv().decimals)} ${drv().unit}` : '0%' }));
      if (!dup.length) items.push(t('ai_no_overlap'));
      return `<div class="ai-box small"><b>${esc(t('ai_affected'))}</b><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
    }

    function body() {
      const typeOpts = M.factorTypes().map((x) => `<option value="${x.category}" ${x.category === f.category ? 'selected' : ''}>${esc(t('ft_' + x.category))} · ${esc(t(x.input_mode === 'DRIVER' ? 'input_driver' : 'input_amount'))}</option>`).join('');
      const monthOpt = (sel) => openMonths.concat(existing && !openMonths.includes(sel) ? [sel] : []).sort().map((p) => `<option value="${p}" ${p === sel ? 'selected' : ''}>${esc(A.periodLabel(p))}</option>`).join('');
      const orgBoxes = (existing ? [...new Set([...leafChoices, ...orgsOf])] : leafChoices).map((o) => `<label class="chk"><input type="checkbox" data-org="${o}" ${f.orgs.includes(o) ? 'checked' : ''} ${ro ? 'disabled' : ''}> ${esc(A.orgName(o))}</label>`).join('');
      return `<div class="form-grid">
          <label>${esc(t('factor_id'))}</label><div class="ro"><span class="id">${existing ? existing.factor_id : esc(t('id_on_save'))}</span></div>
          <label for="p02-type">${esc(t('type'))} *</label><select id="p02-type" ${ro || existing ? 'disabled' : ''}>${typeOpts}</select>
          <label>${esc(t('entered'))}</label><div class="ro">${esc(A.periodLabel(existing ? existing.registered_period_id : pid))} / ${esc(A.userName(existing ? existing.created_by : state.userId))}</div>
          <label for="p02-title">${esc(t('content'))} *</label><input id="p02-title" value="${esc(f.title)}" ${ro ? 'disabled' : ''} placeholder="${esc(t('content_ph'))}">
          <label>${esc(t('target_orgs'))} *</label><div class="chk-row">${orgBoxes}</div>
          <label>${esc(t('period'))} *</label><div class="inline-sel"><select id="p02-start" ${ro ? 'disabled' : ''}>${monthOpt(f.start)}</select> – <select id="p02-end" ${ro ? 'disabled' : ''}>${monthOpt(f.end)}</select></div>
          ${driverBlock()}
        </div>
        <div class="section-title">${esc(t(type().input_mode === 'DRIVER' ? 'calc_by_model' : 'change_by_metric'))} (${esc(t('jpy_m'))})</div>
        ${type().input_mode === 'AMOUNT' && !ro ? `<p class="hint">${esc(t('amount_hint'))}</p>` : ''}
        ${f.orgs.length ? f.orgs.map(amountTable).join('') : `<div class="warnbox">${esc(t('pick_org'))}</div>`}
        <div class="form-grid" style="margin-top:12px"><label for="p02-memo">${esc(t('basis_memo'))}</label><textarea id="p02-memo" ${ro ? 'disabled' : ''}>${esc(f.memo)}</textarea></div>
        <div style="margin-top:12px">${aiBlock()}</div>
        <div id="p02-err"></div>`;
    }

    const title = existing ? `${existing.factor_id} ${esc(f.title)}` : esc(t('new_factor'));
    A.openModal(`<header><h3>P-02 ${esc(t('scr_P02'))} | ${title}</h3>${ro ? `<span class="tag">${esc(t('read_only'))}</span>` : ''}<button class="btn ghost x" data-close>×</button></header>
      <div class="body" id="p02-body">${body()}</div>
      <footer>${existing && !ro ? `<button class="btn danger left" data-delete>${esc(t('delete'))}</button>` : ''}<button class="btn" data-close>${esc(t('close'))}</button>${ro ? '' : `<button class="btn primary" data-save>${esc(t('save'))}</button>`}</footer>`,
    { onMount: (wrap, close) => {
      const bodyEl = wrap.querySelector('#p02-body');
      const refresh = () => {
        const focusId = document.activeElement && (document.activeElement.id || document.activeElement.dataset.amt || document.activeElement.dataset.tot);
        bodyEl.innerHTML = body(); bind();
        if (focusId) { const el = bodyEl.querySelector(`#${CSS.escape(focusId)}`) || bodyEl.querySelector(`[data-amt="${focusId}"]`) || bodyEl.querySelector(`[data-tot="${focusId}"]`); if (el) el.focus(); }
      };
      function bind() {
        const on = (sel, ev, fn) => { const el = bodyEl.querySelector(sel); if (el) el.addEventListener(ev, fn); };
        on('#p02-type', 'change', (e) => { f.category = e.target.value; f.drvFrom = null; f.drvTo = null; initDriver(); refresh(); });
        on('#p02-title', 'input', (e) => { f.title = e.target.value; });
        on('#p02-memo', 'input', (e) => { f.memo = e.target.value; });
        on('#p02-start', 'change', (e) => { f.start = Number(e.target.value); if (f.end < f.start) f.end = f.start; refresh(); });
        on('#p02-end', 'change', (e) => { f.end = Number(e.target.value); if (f.end < f.start) f.start = f.end; refresh(); });
        on('#drv-from', 'change', (e) => { f.drvFrom = Number(e.target.value); refresh(); });
        on('#drv-to', 'change', (e) => { f.drvTo = Number(e.target.value); refresh(); });
        bodyEl.querySelectorAll('[data-org]').forEach((cb) => cb.addEventListener('change', () => {
          f.orgs = cb.checked ? [...new Set([...f.orgs, cb.dataset.org])] : f.orgs.filter((o) => o !== cb.dataset.org);
          refresh();
        }));
        bodyEl.querySelectorAll('[data-amt]').forEach((inp) => inp.addEventListener('change', () => {
          const [o, mt, p] = inp.dataset.amt.split('|');
          ((f.amounts[o] ||= {})[mt] ||= {})[p] = inp.value === '' ? null : Number(inp.value);
          refresh();
        }));
        bodyEl.querySelectorAll('[data-tot]').forEach((inp) => inp.addEventListener('change', () => {
          const [o, mt] = inp.dataset.tot.split('|');
          const ms = months(), total = Number(inp.value || 0);
          const each = Math.round((total / ms.length) * 100) / 100;
          ms.forEach((p, i) => (((f.amounts[o] ||= {})[mt] ||= {})[p] = i === ms.length - 1 ? A.M.r2(total - each * (ms.length - 1)) : each));
          refresh();
        }));
      }
      bind();
      const save = wrap.querySelector('[data-save]');
      if (save) save.addEventListener('click', () => {
        const err = validate();
        if (err) { bodyEl.querySelector('#p02-err').innerHTML = `<div class="verdict ng">${esc(err)}</div>`; return; }
        const id = persist();
        close();
        A.toast(t('factor_saved', { id }));
        A.render();
      });
      const del = wrap.querySelector('[data-delete]');
      if (del) del.addEventListener('click', () => {
        if (!window.confirm(t('confirm_delete_factor', { id: existing.factor_id }))) return;
        existing.is_deleted = true;
        A.audit(existing.factor_id, 'FACTOR_DELETED', null);
        A.db.app_audit_event[A.db.app_audit_event.length - 1].resource_type = 'factor';
        if (A.f01) A.f01.factorChanged(existing.factor_id, null);
        A.rebuild(); close(); A.toast(t('factor_deleted', { id: existing.factor_id })); A.render();
      });
    } });

    function validate() {
      if (!f.title.trim()) return t('err_content');
      if (!f.orgs.length) return t('pick_org');
      if (f.start > f.end) return t('err_period');
      const ms = months();
      for (const o of f.orgs) {
        const c = amountsFor(o);
        if (!c) return t('no_sensitivity', { d: t('drv_' + type().driver_id), o: A.orgName(o) });
        const any = ms.some((p) => ALL.some((mt) => Math.abs(c[p]?.[mt] || 0) > 0.0001));
        if (!any) return t('err_zero');
      }
      return null;
    }

    /** Mock User Data Function: writes app_factor / app_factor_org / app_factor_amount and exclusion rows. */
    function persist() {
      const dbx = A.db, Mx = A.M;
      let id = existing ? existing.factor_id : null;
      if (!id) {
        const n = Math.max(0, ...dbx.app_factor.map((x) => Number(x.factor_id.split('-')[1]) || 0)) + 1;
        id = `EV-${String(n).padStart(3, '0')}`;
      }
      const d = drv();
      const rec = existing || { factor_id: id, title_comment_id: null, registered_period_id: pid, default_included: true, is_deleted: false, created_by: state.userId, created_at: A.nowIso() };
      Object.assign(rec, {
        category: f.category, title: f.title.trim(), start_period_id: f.start, end_period_id: f.end, evidence_memo: f.memo.trim() || null,
        input_mode: type().input_mode, driver_id: d ? d.driver_id : null, driver_from: d ? f.drvFrom : null, driver_to: d ? f.drvTo : null,
        sensitivity_run_id: d ? existing?.sensitivity_run_id || run?.forecast_run_id || null : null,
      });
      if (!existing) dbx.app_factor.push(rec);
      dbx.app_factor_org = dbx.app_factor_org.filter((x) => x.factor_id !== id).concat(f.orgs.map((o) => ({ factor_id: id, org_id: o })));
      dbx.app_factor_amount = dbx.app_factor_amount.filter((x) => x.factor_id !== id);
      f.orgs.forEach((o) => {
        const c = amountsFor(o);
        months().forEach((p) => ALL.forEach((mt) => {
          const v = c[p]?.[mt];
          if (v !== undefined && Mx.isApplicable(o, mt) && (Math.abs(v) > 0.0001 || mt === 'OP')) dbx.app_factor_amount.push({ factor_id: id, org_id: o, metric_id: mt, period_id: p, amount: v });
        }));
      });
      // Overlapping adopted Actions exclude this factor from their effect measurement (measured at the next run).
      Mx.db.app_action.filter((a) => f.orgs.includes(a.owner_org_id) && a.decision_state === 'ADOPTED' && a.start_period_id <= f.end && a.end_period_id >= f.start).forEach((a) => {
        const touched = ALL.filter((mt) => mt !== 'OP' && dbx.app_factor_amount.some((x) => x.factor_id === id && x.metric_id === mt && x.org_id === a.owner_org_id));
        if (!Mx.actionTargets(a.action_id).some((mt) => touched.includes(mt))) return;
        if (dbx.app_action_factor_exclusion.some((x) => x.action_id === a.action_id && x.factor_id === id)) return;
        const from = Math.max(a.start_period_id, f.start), to = Math.min(a.end_period_id, f.end);
        const amt = Mx.r2(dbx.app_factor_amount.filter((x) => x.factor_id === id && x.org_id === a.owner_org_id && x.metric_id === 'OP' && x.period_id >= from && x.period_id <= to).reduce((s, x) => s + x.amount, 0));
        dbx.app_action_factor_exclusion.push({ action_id: a.action_id, factor_id: id, metric_id: 'OP', period_from: from, period_to: to, excluded_amount: amt, method_comment_id: null });
      });
      dbx.app_audit_event.push({ event_id: `AE-L${dbx.app_audit_event.length + 1}`, resource_type: 'factor', resource_id: id, actor_type: 'USER', actor_id: state.userId,
        event_type: existing ? 'FACTOR_UPDATED' : 'FACTOR_CREATED', old_value: null, new_value: f.title.trim(), occurred_at: A.nowIso() });
      A.rebuild();
      if (A.f01 && !existing) A.f01.factorChanged(id, true);
      return id;
    }
  }

  A.openFactor = openFactor;
})();
