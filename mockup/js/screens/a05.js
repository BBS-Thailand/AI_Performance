/* A-05 Action Status — README §3.7, concept slide 45 */
(function () {
  'use strict';
  const A = window.App;
  const METRICS = ['REV', 'GP', 'SGA', 'OP'];
  const local = { metric: null, actionId: null };

  /** Ratio class for "how far along vs. expectation": ≥90% good, ≥70% warn, else bad. */
  const ratioCls = (r) => (r === null ? '' : r >= 0.9 ? 'good' : r >= 0.7 ? 'warnc' : 'bad');
  const fmtDate = (iso) => new Intl.DateTimeFormat(I18N.locale(), { month: 'numeric', day: 'numeric' }).format(new Date(iso));

  function currentAction(params) {
    const { M, state } = A;
    const list = M.boardActions(state.orgId, state.periodId, true).sort((a, b) => a.action_id.localeCompare(b.action_id));
    if (params && params.actionId && params.actionId !== local.actionId) { local.actionId = params.actionId; local.metric = null; }
    const a = local.actionId ? M.action(local.actionId) : null;
    const inScope = a && M.inScope(a.owner_org_id, state.orgId);
    return { list, a: inScope ? a : null, outOfScope: a && !inScope ? a : null };
  }

  function tile(label, value, sub, cls) {
    return `<div class="kpi a05-tile"><div class="label">${label}</div><div class="value ${cls || ''}">${value}</div><div class="sub muted">${sub}</div></div>`;
  }

  function figureChart(a) {
    const { t, M, state } = A;
    const rows = M.actionFigure(a.action_id, state.periodId);
    if (!rows.length) return '';
    const labels = rows.map((r) => A.monthLabel(r.period_id));
    const lastActual = rows.map((r) => r.actual !== null).lastIndexOf(true);
    // The outlook line starts from the last measured month so the two lines join.
    const outlook = rows.map((r, i) => (r.outlook !== null ? r.outlook : i === lastActual && rows.some((x) => x.outlook !== null) ? r.actual : null));
    const series = [
      { name: t('s_without'), type: 'line', color: '#898781', dash: '5 4', values: rows.map((r) => r.without) },
      { name: t('s_plan'), type: 'line', color: '#2a78d6', dash: '6 3', values: rows.map((r) => r.plan), endLabel: true },
      { name: t('s_actual'), type: 'line', color: '#2b3440', width: 2.5, values: rows.map((r) => r.actual) },
      { name: t('s_outlook'), type: 'line', color: '#eb6834', dash: '2 3', width: 2.5, values: outlook, endLabel: true },
    ];
    return A.Chart.monthly(series, { labels, width: 600, height: 250, zero: false });
  }

  function aiBox(a) {
    const { t, esc, M, state } = A;
    const prog = M.actionProgress(a.action_id, state.periodId);
    // Latest AI assessment up to the selected month (a progress update clears comment_id until the next AI run).
    const assessed = A.db.app_action_progress.filter((p) => p.action_id === a.action_id && p.period_id <= state.periodId && p.comment_id)
      .sort((x, y) => y.period_id - x.period_id)[0];
    const excl = A.db.ai_comment.filter((c) => c.comment_type === 'EXCLUSION' && c.entity_id === a.action_id);
    const meas = M.actionMeasurement(a.action_id);
    const sec = (title, body) => `<div class="ai-sec"><div class="ai-h">${esc(title)}</div><div>${body}</div></div>`;
    let html = sec(t('ai_situation'), prog ? `<span class="tag ps-${prog.ai_status}">${esc(t('ps_' + prog.ai_status))}</span>` : `<span class="tag">${esc(t('e_' + a.execution_state))}</span>`);
    html += sec(t('ai_evaluation'), assessed ? A.aiText(assessed.comment_id) : `<span class="muted">${esc(t('no_assessment'))}</span>`);
    if (prog && prog.assessment_stale) html += `<div class="warnline">⚠ ${esc(t('ai_pending', { u: A.userName(prog.updated_by) }))}</div>`;
    if (meas) html += sec(t('ai_measure'), `${A.aiText(meas.ai_comment_id)}`);
    html += sec(t('ai_factors'), excl.length ? excl.map((c) => A.aiText(c.comment_id)).join('<br>') : `<span class="muted">${esc(t('ai_no_factor'))}</span>`);
    return html;
  }

  function history(a) {
    const { t, esc, fmt, M } = A;
    const ev = A.db.app_audit_event.filter((e) => e.resource_type === 'action' && e.resource_id === a.action_id)
      .sort((x, y) => String(x.occurred_at).localeCompare(String(y.occurred_at)));
    const rows = ev.map((e) => {
      let content, by;
      if (e.actor_type === 'AI') by = t('by_ai');
      else if (e.actor_type === 'SYSTEM' || !e.actor_id) by = t('by_system');
      else by = A.userName(e.actor_id);
      switch (e.event_type) {
        case 'DECISION_ADOPT': content = t('hist_ADOPT', { p: a.point_id }); break;
        case 'DECISION_REJECT': content = t('hist_REJECT', { r: e.new_value }); break;
        case 'DECISION_HOLD': content = t('hist_HOLD', { r: e.new_value }); break;
        case 'DECISION_CANCEL_ADOPTION': content = t('hist_CANCEL_ADOPTION'); break;
        case 'AI_ASSESSMENT': {
          const pid = Number(String(e.actor_id || '').replace('RUN-', ''));
          // The event keeps what the AI judged at that run ("STATUS / pct% / outlook x"); later progress updates do not rewrite it.
          const mm = String(e.new_value).match(/^(\w+) \/ (\d+)% \/ outlook ([-\d.]+)/);
          const tot = pid ? M.actionTotals(a.action_id, pid, 'OP') : null;
          content = mm && tot ? t('hist_AI', { m: A.monthLabel(pid), pct: mm[2], a: fmt(tot.actualToDate, 2), o: fmt(Number(mm[3]), 1), s: t('ps_' + mm[1]) }) : e.new_value;
          break;
        }
        case 'PROGRESS_UPDATE': {
          const mm = String(e.new_value).match(/^(\d+)% → (\d+)% · outlook OP ([-\d.]+) → ([-\d.]+) · (\w+)(?: · (.*))?$/);
          content = mm ? t('hist_PROGRESS', { a: mm[1], b: mm[2], o1: fmt(Number(mm[3]), 1), o2: fmt(Number(mm[4]), 1), s: t('ps_' + mm[5]) }) + (mm[6] ? ` · "${mm[6]}"` : '') : e.new_value;
          break;
        }
        case 'CHAT_MESSAGE': content = t('hist_CHAT', { b: e.new_value }); break;
        case 'CHAT_PROGRESS_REQUEST': content = t('hist_REQ', { b: e.new_value }); break;
        case 'CHAT_SYSTEM': content = t('hist_SYS', { b: e.new_value }); break;
        case 'CHAT_AI': content = t('hist_CHAT_AI', { b: e.new_value }); break;
        default: content = `${e.event_type}: ${e.new_value}`;
      }
      const kind = e.event_type.startsWith('DECISION') ? 'dec' : e.event_type === 'AI_ASSESSMENT' ? 'ai' : e.event_type.startsWith('CHAT') ? 'chat' : 'prog';
      return `<tr class="h-${kind}"><td class="nowrap">${esc(fmtDate(e.occurred_at))}</td><td>${esc(content)}</td><td class="nowrap">${esc(by)}</td></tr>`;
    }).join('');
    return `<div class="table-wrap a05-hist"><table class="grid-table"><thead><tr><th>${esc(t('col_date'))}</th><th>${esc(t('col_content'))}</th><th>${esc(t('col_by'))}</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="3" class="muted">–</td></tr>`}</tbody></table></div>`;
  }

  function render(params) {
    const { t, esc, fmt, M, state } = A;
    const { list, a, outOfScope } = currentAction(params);
    const head = (extra) => `
      <div class="page-head">
        <h1>A-05 ${esc(t('scr_A05'))}</h1>
        <span class="scope">${esc(A.periodLabel(state.periodId))} · ${esc(A.orgName(state.orgId))} · ${esc(t('jpy_m'))}</span>
        <div class="actions">
          <label class="muted small" for="a05-pick">${esc(t('pick_action'))}</label>
          <select id="a05-pick"><option value="">–</option>${list.map((x) => `<option value="${x.action_id}" ${a && a.action_id === x.action_id ? 'selected' : ''}>${x.action_id} ${esc(A.actionNamePlain(x))}</option>`).join('')}</select>
          <button class="btn" data-go="A03">◀ ${esc(t('back_exec'))}</button>
          ${extra || ''}
        </div>
      </div>`;
    if (!a) {
      const msg = outOfScope ? t('not_in_scope', { id: outOfScope.action_id }) : t('pick_hint');
      return head() + `<div class="card"><div class="placeholder">${esc(msg)}</div></div>`;
    }
    if (a.decision_state !== 'ADOPTED') return head() + `<div class="card"><div class="placeholder">${esc(t('not_adopted'))}</div></div>`;

    const targets = METRICS.filter((m) => M.actionTargets(a.action_id).includes(m));
    if (!local.metric || !targets.includes(local.metric)) local.metric = targets.includes(A.boardUi.metric) ? A.boardUi.metric : (targets.includes('OP') ? 'OP' : targets[0]);
    const m = local.metric;
    const tot = M.actionTotals(a.action_id, state.periodId, m);
    const prog = M.actionProgress(a.action_id, state.periodId);
    const expected = M.expectedProgress(a, state.periodId);
    const vsExp = tot.planToDate ? tot.actualToDate / tot.planToDate : null;
    const vsPlan = tot.planAnnual ? tot.outlookFY / tot.planAnnual : null;
    const excl = M.actionExclusions(a.action_id);
    const exclIds = [...new Set(excl.map((x) => x.factor_id))];
    const factorSub = exclIds.map((id) => {
      const f = M.factor(id);
      const amt = M.factorAmount(id, a.owner_org_id, m, M.fyPeriods(M.period(state.periodId).fiscal_year));
      return `${f ? A.aiPlain(`CM-FTITLE-${id}`) || f.title || '' : ''} ${amt ? `(${t(m)} ${A.fmtSigned(amt)})` : ''}`.trim();
    }).join(' · ');
    const chat = M.chatUnread(a.action_id, state.userId);
    const meas = M.actionMeasurement(a.action_id);
    const figLabel = t('fig_' + a.effect_kind);
    const pm = params && params.periodId ? params.periodId : null;
    const pmRow = pm ? M.actionMonthly(a.action_id, m, state.periodId).find((r) => r.period_id === pm) : null;
    const pct = (r) => (r === null ? '–' : Math.round(r * 100));

    const tiles = [
      tile(esc(t('kpi_plan')), fmt(tot.planAnnual, 2), esc(t('kpi_plan_sub'))),
      tile(esc(t('kpi_expected', { month: A.monthLabel(state.periodId) })), fmt(tot.planToDate, 2), esc(t('kpi_expected_sub'))),
      tile(esc(t('kpi_actual')), fmt(tot.actualToDate, 2), esc(t('kpi_actual_sub', { p: pct(vsExp) })), ratioCls(vsExp)),
      tile(esc(t('kpi_outlook')), fmt(tot.outlookFY, 2), esc(t('kpi_outlook_sub', { p: pct(vsPlan) })), ratioCls(vsPlan)),
      tile(esc(t('progress')), `${prog ? prog.progress_pct : 0}%`, esc(t('kpi_progress_sub', { p: expected }))),
      tile(esc(t('kpi_factor')), exclIds.length ? exclIds.join(', ') : '—', exclIds.length ? esc(factorSub) : esc(t('no_factor'))),
    ].join('');
    const metricSeg = targets.length > 1 ? `<div class="seg">${targets.map((x) => `<button class="seg-btn ${x === m ? 'on' : ''}" data-metric="${x}">${esc(t(x))}</button>`).join('')}</div>` : '';

    return head(`<button class="btn primary" data-chat>💬 ${esc(t('chat_btn'))}${chat && chat.unread ? ` <b class="badge">${chat.unread}</b>` : ''}</button>`) + `
      <div class="a05-banner">
        <span class="id">${a.action_id}</span> <b>${A.actionName(a)}</b>
        <span class="sep">|</span> ${esc(t('col_point'))} <span class="id">${a.point_id}</span>
        <span class="sep">|</span> ${esc(A.orgName(a.owner_org_id))}
        <span class="sep">|</span> ${esc(A.periodLabel(a.start_period_id))} – ${esc(A.periodLabel(a.end_period_id))}
        <span class="sep">|</span> ${esc(t('target_metrics'))}: ${targets.map((x) => esc(t(x))).join(', ')}
      </div>
      <div class="a05-metric"><span class="muted small">${esc(t('a05_effect_on'))}</span> ${metricSeg || `<b>${esc(t(m))}</b>`} <span class="muted small">(${esc(t('jpy_m'))})</span></div>
      <div class="grid a05-tiles">${tiles}</div>
      <div class="grid a05-main">
        <div class="card">
          <h2>${esc(t('fig_title', { fig: figLabel }))}</h2>
          ${figureChart(a)}
          <p class="hint" style="margin-top:4px">${meas ? esc(t('fig_basis', { b: meas.baseline_method, f: meas.formula })) : ''}</p>
          ${pmRow ? `<p class="small" style="margin:4px 0 0"><span class="tag">${esc(t('from_a04'))}</span> ${esc(t('month_detail', { m: A.monthLabel(pm), p: fmt(pmRow.plan, 2), k: pmRow.isActual ? t('actual') : t('outlook'), v: pmRow.value === null ? '–' : fmt(pmRow.value, 2), metric: t(m) }))}</p>` : ''}
        </div>
        <div class="card">
          <h2>${esc(t('ai_analysis'))} <span class="tag ai">${esc(t('ai_generated'))}</span></h2>
          <div class="ai-box a05-ai">${aiBox(a)}</div>
        </div>
      </div>
      <div class="card">
        <h2>${esc(t('hist_title'))} <span class="right hint">${esc(t('hist_hint'))}</span></h2>
        ${history(a)}
      </div>`;
  }

  function mount(root) {
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
    const pick = root.querySelector('#a05-pick');
    if (pick) pick.addEventListener('change', () => { if (pick.value) A.go('A05', { actionId: pick.value }); });
    root.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => { local.metric = b.dataset.metric; A.render(); }));
    const chat = root.querySelector('[data-chat]');
    if (chat) chat.addEventListener('click', () => A.go('C03', { actionId: local.actionId }));
  }

  A.SCREENS.A05 = { render, mount };
})();
