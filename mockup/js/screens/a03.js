/* A-03 Action Board — README §3.5, concept slide 43 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const BUCKETS = ['IN_PROGRESS', 'EFFECTIVE', 'DELAYED', 'COMPLETED'];
  const ui = A.boardUi;

  /** Metric the effect columns use: OP when selected (slide 43), otherwise the first selected Metric. */
  const effectMetric = () => (ui.metrics.includes('OP') ? 'OP' : METRICS.find((m) => ui.metrics.includes(m)));
  const rangeList = () => A.M.boardActions(A.state.orgId, A.state.periodId, ui.range === 'HIST')
    .sort((a, b) => a.action_id.localeCompare(b.action_id));
  const related = (list, metrics) => list.filter((a) => A.M.actionTargets(a.action_id).some((m) => metrics.includes(m)));

  function metricCard(m, list) {
    const { t, esc, fmtSigned, M, state } = A;
    if (!M.isApplicable(state.orgId, m)) {
      return `<div class="kpi na mcard"><div class="label">☐ ${esc(t(m))}</div><div class="sub faint">${esc(t('na'))}</div></div>`;
    }
    const rel = related(list, [m]);
    const plan = M.r2(rel.reduce((s, a) => s + M.actionTotals(a.action_id, state.periodId, m).planAnnual, 0));
    const act = M.r2(rel.reduce((s, a) => s + M.actionTotals(a.action_id, state.periodId, m).actualToDate, 0));
    const on = ui.metrics.includes(m);
    return `<button class="kpi mcard selectable ${on ? 'on' : ''}" data-metric="${m}" aria-pressed="${on}">
      <div class="label"><b>${on ? '☑' : '☐'} ${esc(t(m))} (${rel.length})</b></div>
      <div class="sub">${esc(t('card_plan_actual', { p: fmtSigned(plan), a: fmtSigned(act) }))} <span class="faint">(${esc(t('jpy_m'))})</span></div></button>`;
  }

  /** Apr–Mar term bar with the selected month as a red dotted line (slide 43 ⑦). */
  function periodBar(a, bucket) {
    const { M, state } = A;
    const fyP = M.fyPeriods(M.period(state.periodId).fiscal_year);
    const s = Math.max(0, fyP.indexOf(Math.max(a.start_period_id, fyP[0])));
    const eRaw = fyP.indexOf(Math.min(a.end_period_id, fyP[11]));
    const e = eRaw < 0 ? 11 : eRaw;
    const cur = fyP.indexOf(state.periodId);
    const notStarted = a.start_period_id > state.periodId;
    const cls = notStarted ? 'b-wait' : 'b-' + bucket;
    const title = `${A.periodLabel(a.start_period_id)} – ${A.periodLabel(a.end_period_id)}`;
    return `<div class="pbar" title="${A.esc(title)}"><i class="${cls}" style="left:${(s / 12) * 100}%;width:${((e - s + 1) / 12) * 100}%"></i>
      <b style="left:${((cur + 0.5) / 12) * 100}%"></b></div>`;
  }

  function judgment(a, prog, bucket) {
    const { t, esc } = A;
    const notStarted = (!prog || prog.progress_pct === 0) && a.start_period_id > A.state.periodId;
    let tag;
    if (bucket === 'COMPLETED') tag = `<span class="tag ps-COMPLETED">${esc(t('ps_COMPLETED'))}</span>`;
    else if (notStarted) tag = `<span class="tag">${esc(t('e_NOT_STARTED'))}</span>`;
    else if (prog) tag = `<span class="tag ps-${prog.ai_status}">${esc(t('ps_' + prog.ai_status))}</span>`;
    else tag = `<span class="tag">${esc(t('e_' + a.execution_state))}</span>`;
    const chat = A.M.chatUnread(a.action_id, A.state.userId);
    const chatBtn = chat ? `<button class="chat-ind ${chat.unread ? 'unread' : ''}" data-chat="${a.action_id}" title="${esc(t('chat_unread'))}">💬${chat.unread ? `<b>${chat.unread}</b>` : ''}</button>` : '';
    return `${tag} ${chatBtn}`;
  }

  function render() {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    ui.metrics = ui.metrics.filter((m) => M.isApplicable(state.orgId, m));
    if (!ui.metrics.length) ui.metrics = ['OP'];
    const em = effectMetric();
    const all = rangeList();
    const rel = related(all, ui.metrics);
    const buckets = new Map(rel.map((a) => [a.action_id, M.actionBucket(a, state.periodId)]));
    const counts = Object.fromEntries(BUCKETS.map((b) => [b, rel.filter((a) => buckets.get(a.action_id) === b).length]));
    const shown = ui.status ? rel.filter((a) => buckets.get(a.action_id) === ui.status) : rel;
    const latest = M.latestClosed();
    const canEditMonth = state.periodId === latest;
    const pct = (v) => `${v}%`;

    const seg = (key, n, label) => `<button class="cnt ${ui.status === key ? 'on' : ''} cnt-${key || 'ALL'}" data-status="${key}">${esc(label)} <b>${n}</b></button>`;
    const countsLine = [seg('', rel.length, t('cnt_ALL')), ...BUCKETS.map((b) => seg(b, counts[b], t('cnt_' + b)))].join('<span class="cnt-sep">|</span>');

    const tot = { plan: 0, actual: 0, outlook: 0, mom: 0, vs: 0 };
    const body = shown.map((a) => {
      const tt = M.actionTotals(a.action_id, state.periodId, em);
      const prog = M.actionProgress(a.action_id, state.periodId);
      const bucket = buckets.get(a.action_id);
      const excl = [...new Set(M.actionExclusions(a.action_id).map((x) => x.factor_id))];
      const editable = canEditMonth && A.canEditOrg(a.owner_org_id) && a.execution_state !== 'STOPPED';
      tot.plan += tt.planAnnual; tot.actual += tt.actualToDate; tot.outlook += tt.outlookFY; tot.mom += tt.momActual; tot.vs += tt.outlookVsPlan;
      const hasActual = M.effectRows(a.action_id, em).some((r) => r.period_id <= state.periodId && r.actual_effect !== null && r.actual_effect !== 0);
      const p = prog ? prog.progress_pct : 0;
      return `<tr class="main-row" tabindex="0" data-action="${a.action_id}">
          <td><span class="id">${a.action_id}</span>${state.orgId !== a.owner_org_id ? `<div class="faint small">${esc(A.orgName(a.owner_org_id))}</div>` : ''}</td>
          <td>${A.actionName(a)}</td>
          <td><span class="id">${a.point_id}</span></td>
          <td class="pcell">${periodBar(a, bucket)}</td>
          <td class="num prog"><span>${pct(p)}</span>${editable ? `<button class="btn ghost small edit-prog" data-prog="${a.action_id}" title="${esc(t('update_progress'))}">✎</button>` : ''}
            <div class="mini"><i style="width:${Math.min(100, p)}%"></i></div></td>
          <td class="num">${fmt(tt.planAnnual)}</td>
          <td class="num">${hasActual ? fmt(tt.actualToDate, 2) : '<span class="faint">—</span>'}</td>
          <td class="num"><b>${fmt(tt.outlookFY, 2)}</b></td>
          <td>${excl.length ? excl.map((x) => `<span class="tag warn">${esc(t('factor_excluded', { id: x }))}</span>`).join(' ') : '<span class="faint">—</span>'}</td>
          <td class="nowrap jcell">${judgment(a, prog, bucket)}</td>
        </tr>
        <tr class="sub-row" data-action-sub="${a.action_id}">
          <td></td><td class="sub-label">└ ${esc(t('sub_mom_init'))}</td><td colspan="4"></td>
          <td class="num ${A.tone(em, tt.momActual)}">${hasActual || tt.momActual ? fmtSigned(tt.momActual, 2) : '<span class="faint">—</span>'}</td>
          <td class="num ${A.tone(em, tt.outlookVsPlan)}">${fmtSigned(tt.outlookVsPlan, 2)}</td><td colspan="2"></td></tr>`;
    }).join('');
    const totalRows = shown.length ? `<tr class="other-row total-row"><td colspan="5">${esc(t('units_total'))} (${shown.length})</td>
        <td class="num">${fmt(M.r2(tot.plan))}</td><td class="num">${fmt(M.r2(tot.actual), 2)}</td><td class="num"><b>${fmt(M.r2(tot.outlook), 2)}</b></td><td colspan="2"></td></tr>
      <tr class="other-row"><td colspan="6" class="sub-label">└ ${esc(t('sub_mom_init'))}</td>
        <td class="num ${A.tone(em, tot.mom)}">${fmtSigned(M.r2(tot.mom), 2)}</td><td class="num ${A.tone(em, tot.vs)}">${fmtSigned(M.r2(tot.vs), 2)}</td><td colspan="2"></td></tr>` : '';
    const metricsTxt = ui.metrics.map((m) => t(m)).join(t('and_sep'));
    const opt = (v, label) => `<option value="${v}" ${ui.range === v ? 'selected' : ''}>${esc(label)}</option>`;

    return `
      <div class="page-head">
        <h1>A-03 ${esc(t('scr_A03'))}</h1>
        <span class="scope">${esc(A.periodLabel(state.periodId))} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">
          <button class="btn" data-go="A01">◀ ${esc(t('scr_A01'))}</button>
          <div class="seg tabs"><button class="seg-btn on" aria-pressed="true">${esc(t('tab_list'))}</button><button class="seg-btn" data-go="A04">${esc(t('tab_effect'))} (A-04)</button></div>
        </div>
      </div>
      <div class="board-bar">
        <div class="counts">${countsLine}</div>
        <div class="spacer"></div>
        <label class="muted small" for="b-range">${esc(t('show_range'))}</label>
        <select id="b-range">${opt('EXEC', t('range_EXEC'))}${opt('HIST', t('range_HIST'))}</select>
      </div>
      <div class="grid k4 mcards" style="margin-bottom:12px">${METRICS.map((m) => metricCard(m, all)).join('')}</div>
      <div class="card">
        <h2>▼ ${esc(t('selected_line', { metrics: metricsTxt, metric: t(em) }))} <span class="right hint">${esc(t('dbl_a05'))}</span></h2>
        <div class="table-wrap"><table class="grid-table board">
          <thead><tr><th>${esc(t('action_id'))}</th><th>${esc(t('action_name'))}</th><th>${esc(t('col_point'))}</th>
            <th class="pcell">${esc(t('col_period'))}</th><th class="num">${esc(t('progress'))}</th><th class="num">${esc(t('plan_lbl'))}</th>
            <th class="num">${esc(t('actual_lbl'))}</th><th class="num">${esc(t('col_outlook'))}</th><th>${esc(t('col_factors'))}</th><th>${esc(t('col_judgment'))}</th></tr></thead>
          <tbody>${body || `<tr><td colspan="10" class="muted">${esc(t('no_adopted_actions'))}</td></tr>`}${totalRows}</tbody>
        </table></div>
        <p class="hint" style="margin-top:8px">${esc(t('board_note'))}${ui.range === 'HIST' && !ui.status && em ? ' ' + esc(t('board_total_note')) : ''}
          ${canEditMonth ? '' : ' ' + esc(t('progress_locked', { month: A.periodLabel(latest) }))}</p>
      </div>`;
  }

  /* ------------------------------------------------------- progress dialog */
  function progressDialog(actionId) {
    const { t, esc, fmt, fmtSigned, M, state } = A;
    const a = M.action(actionId);
    const cur = M.actionProgress(actionId, state.periodId);
    const start = cur ? cur.progress_pct : 0;
    const before = M.forecastLive(a.owner_org_id, state.periodId, 'OP').landing;
    const preview = (pct) => {
      const rf = M.reforecast(actionId, state.periodId, pct);
      const st = (s) => (s ? `<span class="tag ps-${s}">${esc(t('ps_' + s))}</span>` : '–');
      const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
      return `<dl class="kv">${[
        row(esc(t("expected_progress")), rf.expected + "%"),
        row(esc(t("progress")), `${rf.oldPct}% → <b>${rf.newPct}%</b>`),
        row(`${esc(t("col_outlook"))} (${esc(t("OP"))})`, `${fmt(rf.outlookOld, 2)} → <b>${fmt(rf.outlookNew, 2)}</b> <span class="${A.tone("OP", rf.delta)}">(${fmtSigned(rf.delta, 2)})</span>`),
        row(esc(t("col_judgment")), `${st(rf.oldStatus)} → ${st(rf.status)}`),
        row(esc(t("f01_landing_impact", { org: A.orgName(a.owner_org_id) })), `${fmt(before, 1)} → <b>${fmt(M.r2(before + rf.delta), 1)}</b>`),
      ].join("")}</dl>`;
    };
    A.openModal(`
      <header><h3>${esc(t("update_progress"))} · <span class="id">${a.action_id}</span></h3><button class="btn ghost x" data-close>×</button></header>
      <div class="body">
        <p class="muted" style="margin-top:0">${A.actionName(a)} · ${esc(A.orgName(a.owner_org_id))} · ${esc(A.periodLabel(state.periodId))}</p>
        <div class="form-grid">
          <label for="pg-num">${esc(t("progress_pct"))}</label>
          <div class="prog-in"><input id="pg-pct" type="range" min="0" max="100" step="5" value="${start}" aria-label="${esc(t("progress_pct"))}"><input id="pg-num" type="number" min="0" max="100" step="5" value="${start}"></div>
          <label for="pg-note">${esc(t("progress_note"))}</label><textarea id="pg-note" rows="2"></textarea>
        </div>
        <h4 style="margin:14px 0 6px">${esc(t("reforecast_title"))} <span class="tag ai">${esc(t("ai_generated"))}</span></h4>
        <div id="pg-preview">${preview(start)}</div>
        <p class="hint">${esc(t("reforecast_rule"))}</p>
      </div>
      <footer><button class="btn" data-close>${esc(t("cancel"))}</button><button class="btn primary" id="pg-save" disabled>${esc(t("save"))}</button></footer>`, {
      small: true,
      onMount(wrap, close) {
        const rng = wrap.querySelector('#pg-pct'), num = wrap.querySelector('#pg-num'), save = wrap.querySelector('#pg-save');
        const sync = (v) => {
          const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
          rng.value = pct; num.value = pct;
          wrap.querySelector('#pg-preview').innerHTML = preview(pct);
          save.disabled = pct === start;
        };
        rng.addEventListener('input', () => sync(rng.value));
        num.addEventListener('input', () => sync(num.value));
        save.addEventListener('click', () => {
          const pct = Number(num.value);
          const rf = A.updateProgress(actionId, pct, wrap.querySelector('#pg-note').value.trim());
          if (!rf) return;
          close();
          A.toast(t('progress_saved', { id: actionId, a: fmt(rf.outlookOld, 2), b: fmt(rf.outlookNew, 2) }));
          A.render();
        });
      },
    });
  }

  function mount(root) {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
    root.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => { ui.status = b.dataset.status === ui.status ? '' : b.dataset.status; A.render(); }));
    root.querySelector('#b-range').addEventListener('change', (e) => { ui.range = e.target.value; A.render(); });
    root.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.metric;
      if (ui.metrics.includes(m)) { if (ui.metrics.length > 1) ui.metrics = ui.metrics.filter((x) => x !== m); }
      else ui.metrics = METRICS.filter((x) => x === m || ui.metrics.includes(x));
      ui.metric = effectMetric(); // A-04 opens on the Metric whose effect the list shows
      A.render();
    }));
    root.querySelectorAll('tr.main-row').forEach((tr) => {
      const open = () => A.go('A05', { actionId: tr.dataset.action });
      tr.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) open(); });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.target.closest('button')) open(); });
    });
    root.querySelectorAll('[data-prog]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); progressDialog(b.dataset.prog); }));
    root.querySelectorAll('[data-chat]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); A.go('C03', { actionId: b.dataset.chat }); }));
  }

  A.SCREENS.A03 = { render, mount };
})();
