/* AI Management System — mockup shell, shared helpers and state. */
(function (root) {
  'use strict';
  const { t } = I18N;
  const db = root.MOCK_DB;
  let M = Measures.build(db);

  /* ======================================================== state & storage */
  const STORE_KEY = 'aims.mockup.context';
  const saved = (() => { try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; } })();
  const state = {
    userId: saved.userId || 'u01',
    lang: saved.lang || null,
    periodId: saved.periodId || null,
    orgId: saved.orgId || null,
    screen: 'A01',
    params: {},
    chatOpen: false,
  };
  function persist() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ userId: state.userId, lang: state.lang, periodId: state.periodId, orgId: state.orgId })); } catch (e) { /* storage unavailable */ }
  }
  /** README §2.2: restore last context, else latest closed month and user's organization. */
  function initContext() {
    const pref = db.app_user_preference.find((p) => p.user_id === state.userId) || {};
    if (!state.lang) state.lang = pref.language_code || 'en';
    const periods = selectablePeriods();
    if (!periods.includes(state.periodId)) state.periodId = periods[periods.length - 1];
    if (!userOrgs().includes(state.orgId)) state.orgId = user().home_org_id;
    I18N.set(state.lang);
  }

  /* ================================================================ helpers */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
  function fmt(v, digits = 1) {
    if (v === null || v === undefined || Number.isNaN(v)) return '–';
    const r = Math.round(v * 10 ** digits) / 10 ** digits;
    return new Intl.NumberFormat(I18N.locale(), { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(r === 0 ? 0 : r);
  }
  function fmtSigned(v, digits = 1) {
    if (v === null || v === undefined) return '–';
    const s = fmt(Math.abs(v), digits);
    if (Math.round(v * 10 ** digits) === 0) return '±0';
    return (v > 0 ? '+' : '−') + s;
  }
  /** Colour class for a metric change: favorable → good, unfavorable → bad. */
  function tone(metric, v) {
    if (!v || Math.abs(v) < 0.005) return '';
    return M.isFavorable(metric, v) ? 'good' : 'bad';
  }
  function periodLabel(pid, opts) {
    const p = M.period(pid);
    if (!p) return String(pid);
    return new Intl.DateTimeFormat(I18N.locale(), opts || { year: 'numeric', month: 'short' }).format(new Date(Date.UTC(p.calendar_year, p.calendar_month - 1, 15)));
  }
  const monthLabel = (pid) => periodLabel(pid, { month: 'short' });
  function orgName(id) {
    const tr = db.dim_organization_text.find((x) => x.org_id === id && x.language_code === I18N.get());
    return tr ? tr.org_name : (M.org(id) || {}).org_name || id;
  }
  const userName = (id) => (db.app_user.find((u) => u.user_id === id) || {}).display_name || id || 'System';
  const user = () => db.app_user.find((u) => u.user_id === state.userId);
  const metricName = (m) => t(m);

  /** AI text in the current language; falls back to base language with a visible note. */
  function aiText(commentId) {
    const r = M.commentText(commentId, I18N.get());
    if (!r) return '';
    return esc(r.text) + (r.fallback ? `<span class="fallback-note">${esc(t('translation_pending', { lang: I18N.langName(r.lang) }))}</span>` : '');
  }
  function aiPlain(commentId) { const r = M.commentText(commentId, I18N.get()); return r ? r.text : ''; }
  const actionName = (a) => (a.action_name ? esc(a.action_name) : aiText(a.action_name_comment_id));
  const actionNamePlain = (a) => a.action_name || aiPlain(a.action_name_comment_id);
  const actionDesc = (a) => (a.description ? esc(a.description) : aiText(a.description_comment_id));
  const pointTitle = (p) => aiText(p.title_comment_id);

  function selectablePeriods() {
    // Closed months of the current fiscal year (Points / budgets exist only for FY2027 in mock data).
    const fy = M.period(M.latestClosed()).fiscal_year;
    return M.fyPeriods(fy).filter((p) => M.period(p).is_closed);
  }
  function userScopes(userId = state.userId) { return db.app_user_org_scope.filter((s) => s.user_id === userId); }
  function userOrgs() {
    const scopes = userScopes();
    return db.dim_organization.slice().sort((a, b) => a.sort_order - b.sort_order)
      .filter((o) => scopes.some((s) => M.inScope(o.org_id, s.org_id))).map((o) => o.org_id);
  }
  /** Org heads confirm Forecast versions only for organizations in their scope (README §4.3). */
  function canConfirm(orgId) {
    return userScopes().some((s) => s.can_confirm_forecast && M.inScope(orgId, s.org_id));
  }
  /** Individual Factors can be registered for organizations in the user's scope. */
  function canEditOrg(orgId) {
    return userScopes().some((s) => M.inScope(orgId, s.org_id));
  }
  function canDecide(action) {
    return userScopes().some((s) => s.can_decide_action && M.inScope(action.owner_org_id, s.org_id));
  }
  function ytdLabel() {
    const ps = M.ytdPeriods(state.periodId);
    return t('ytd_asof', { from: monthLabel(ps[0]), to: periodLabel(ps[ps.length - 1]) });
  }

  /* ================================================================ charts */
  const Chart = {
    /** Diverging horizontal bars. items: [{label, value, highlight}] */
    hbar(items, { width = 640, rowH = 24, labelW = 190 } = {}) {
      if (!items.length) return `<div class="placeholder">–</div>`;
      const h = items.length * rowH + 24;
      const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.01);
      const valPad = 46; // room for value labels on both sides
      const plotW = width - labelW - 10;
      const zero = labelW + plotW / 2;
      const sc = (v) => (v / max) * (plotW / 2 - valPad);
      const rows = items.map((it, i) => {
        const y = 8 + i * rowH;
        const w = sc(it.value);
        const x = w >= 0 ? zero : zero + w;
        const col = it.value >= 0 ? 'var(--good)' : 'var(--bad)';
        const op = it.highlight === false ? 0.35 : 1;
        const short = it.label.length > 26 ? it.label.slice(0, 25) + '…' : it.label;
        return `<text x="${labelW - 8}" y="${y + rowH / 2 + 4}" text-anchor="end" ${it.highlight ? 'style="font-weight:600;fill:var(--text)"' : ''}>${esc(short)}<title>${esc(it.label)}</title></text>
          <rect x="${x}" y="${y + 4}" width="${Math.max(Math.abs(w), 1)}" height="${rowH - 9}" fill="${col}" opacity="${op}" rx="2"><title>${esc(it.label)}: ${fmtSigned(it.value)}</title></rect>
          <text x="${w >= 0 ? zero + w + 4 : zero + w - 4}" y="${y + rowH / 2 + 4}" text-anchor="${w >= 0 ? 'start' : 'end'}">${fmtSigned(it.value)}</text>`;
      }).join('');
      return `<svg class="chart" viewBox="0 0 ${width} ${h}" role="img"><line class="axis" x1="${zero}" x2="${zero}" y1="4" y2="${h - 12}"/>${rows}</svg>`;
    },
    /** Monthly grouped bars (budget / actual) with optional line series (prior year, forecast). */
    monthly(series, { width = 560, height = 220, labels, zero = true }) {
      const pad = { l: 44, r: series.some((s) => s.endLabel) ? 56 : 10, t: 10, b: 26 };
      const n = labels.length;
      const vals = series.flatMap((s) => s.values.filter((v) => v !== null && v !== undefined));
      let min = zero ? Math.min(0, ...vals) : Math.min(...vals), max = zero ? Math.max(0, ...vals) : Math.max(...vals);
      if (max === min) max = min + 1;
      const span = max - min; max += span * 0.08; if (min < 0 || !zero) min -= span * 0.08;
      const pw = width - pad.l - pad.r, ph = height - pad.t - pad.b;
      const y = (v) => pad.t + ph - ((v - min) / (max - min)) * ph;
      const bw = pw / n;
      const bars = series.filter((s) => s.type === 'bar');
      const ticks = 4;
      const tickDigits = max - min < 8 ? 1 : 0;
      let out = '';
      for (let i = 0; i <= ticks; i++) {
        const v = min + ((max - min) * i) / ticks;
        out += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, tickDigits)}</text>`;
      }
      if (min <= 0 && max >= 0) out += `<line class="axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
      labels.forEach((lb, i) => { out += `<text x="${pad.l + bw * i + bw / 2}" y="${height - 8}" text-anchor="middle">${esc(lb)}</text>`; });
      const inner = bw * 0.72, each = inner / Math.max(bars.length, 1);
      bars.forEach((s, si) => s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        const x = pad.l + bw * i + (bw - inner) / 2 + si * each;
        const top = Math.min(y(v), y(0)), hh = Math.abs(y(v) - y(0));
        out += `<rect x="${x}" y="${top}" width="${each - 1}" height="${Math.max(hh, 0.5)}" fill="${s.color}" rx="1.5"><title>${esc(s.name)} ${esc(labels[i])}: ${fmt(v)}</title></rect>`;
      }));
      series.filter((s) => s.type === 'line').forEach((s) => {
        const pts = s.values.map((v, i) => (v === null || v === undefined ? null : [pad.l + bw * i + bw / 2, y(v)]));
        let d = '', pen = false;
        pts.forEach((p) => { if (!p) { pen = false; return; } d += (pen ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); pen = true; });
        out += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash === true ? '4 3' : s.dash}"` : ''}/>`;
        pts.forEach((p, i) => { if (p) out += `<circle cx="${p[0]}" cy="${p[1]}" r="2.5" fill="${s.color}"><title>${esc(s.name)} ${esc(labels[i])}: ${fmt(s.values[i])}</title></circle>`; });
      });
      // Direct end labels (value in text ink beside a colored marker), nudged apart so they never overlap.
      const ends = series.filter((s) => s.type === 'line' && s.endLabel).map((s) => {
        const i = s.values.map((v) => v !== null && v !== undefined).lastIndexOf(true);
        return i < 0 ? null : { s, x: pad.l + bw * i + bw / 2, y: y(s.values[i]), v: s.values[i] };
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      ends.forEach((e, k) => { e.ly = k ? Math.max(e.y, ends[k - 1].ly + 12) : e.y; });
      ends.forEach((e) => {
        out += `<circle cx="${e.x}" cy="${e.y}" r="4" fill="${e.s.color}" stroke="var(--surface)" stroke-width="2"/>`
          + `<rect x="${e.x + 8}" y="${e.ly - 4}" width="8" height="8" rx="2" fill="${e.s.color}"/><text x="${e.x + 19}" y="${e.ly + 4}" class="end-label">${fmt(e.v)}</text>`;
      });
      const legend = series.map((s) => (s.type === 'line'
        ? `<span><svg width="18" height="8" style="vertical-align:middle;margin-right:5px"><line x1="0" x2="18" y1="4" y2="4" stroke="${s.color}" stroke-width="${s.width || 2}" ${s.dash ? `stroke-dasharray="${s.dash === true ? '4 3' : s.dash}"` : ''}/></svg>${esc(s.name)}</span>`
        : `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`)).join('');
      return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img">${out}</svg><div class="legend">${legend}</div>`;
    },
  };

  /**
   * Monthly stacked bars (A-04). series: [{id, name, color, values[]}]; months up to splitAt (index) are
   * actual (solid), later months outlook (light). Positive values stack up, negative values stack down.
   */
  Chart.stacked = function (series, { width = 640, height = 270, labels, keys, splitAt = -1 }) {
    const pad = { l: 44, r: 10, t: 22, b: 40 };
    const n = labels.length;
    const posT = labels.map((_, i) => series.reduce((s, x) => s + Math.max(0, x.values[i] || 0), 0));
    const negT = labels.map((_, i) => series.reduce((s, x) => s + Math.min(0, x.values[i] || 0), 0));
    let max = Math.max(0, ...posT), min = Math.min(0, ...negT);
    if (max === min) max = 1;
    // Round tick step (1 / 2 / 2.5 / 5 × 10^k) so the axis reads 0, 0.5, 1.0 … like the concept chart.
    const raw = (max - min) / 4, mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw);
    max = Math.ceil((max * 1.08) / step) * step; min = Math.floor((min * 1.08) / step) * step;
    const pw = width - pad.l - pad.r, ph = height - pad.t - pad.b;
    const y = (v) => pad.t + ph - ((v - min) / (max - min)) * ph;
    const bw = pw / n, barW = Math.min(bw * 0.62, 34);
    const digits = step < 1 ? (step * 10 % 1 ? 2 : 1) : 0;
    let out = '';
    for (let v = min; v <= max + step / 2; v += step) {
      out += `<line class="gridline" x1="${pad.l}" x2="${width - pad.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v, digits)}</text>`;
    }
    out += `<line class="axis" x1="${pad.l}" x2="${width - pad.r}" y1="${y(0)}" y2="${y(0)}"/>`;
    labels.forEach((lb, i) => {
      const cx = pad.l + bw * i + bw / 2;
      out += `<text x="${cx}" y="${height - pad.b + 16}" text-anchor="middle">${esc(lb)}</text>`;
      let up = 0, down = 0;
      series.forEach((s) => {
        const v = s.values[i];
        if (!v) return;
        const from = v > 0 ? up : down, to = from + v;
        if (v > 0) up = to; else down = to;
        const top = Math.min(y(from), y(to)), hh = Math.abs(y(to) - y(from));
        const light = i > splitAt;
        out += `<rect class="seg" data-series="${esc(s.id)}" data-key="${keys ? keys[i] : i}" x="${cx - barW / 2}" y="${top}" width="${barW}" height="${Math.max(hh, 0.8)}"
          fill="${s.color}" fill-opacity="${light ? 0.38 : 1}" stroke="var(--surface)" stroke-width="1"><title>${esc(s.name)} · ${esc(lb)}: ${fmtSigned(v, 2)} (${esc(light ? t('outlook') : t('actual'))})</title></rect>`;
      });
      const net = posT[i] + negT[i];
      if (posT[i] || negT[i]) {
        const ty = net >= 0 ? y(posT[i]) - 5 : y(negT[i]) + 13;
        out += `<text class="bar-total" x="${cx}" y="${ty}" text-anchor="middle">${fmt(net, 2)}</text>`;
      }
    });
    if (splitAt >= 0 && splitAt < n - 1) {
      const sx = pad.l + bw * (splitAt + 1);
      out += `<line class="split" x1="${sx}" x2="${sx}" y1="${pad.t - 14}" y2="${height - pad.b}"/>`
        + `<text class="split-label" x="${sx}" y="${height - 6}" text-anchor="middle">← ${esc(t('actual'))} | ${esc(t('outlook'))} →</text>`;
    }
    return `<svg class="chart stacked" viewBox="0 0 ${width} ${height}" role="img">${out}</svg>`;
  };

  /* Categorical colors per Action (dataviz reference palette, fixed slot order). The color follows the
   * Action, not its rank: initial Actions get slots by ID, Actions adopted later take the next free slot. */
  const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const colorSlot = new Map();
  db.app_action.filter((a) => a.decision_state === 'ADOPTED').map((a) => a.action_id).sort().forEach((id, i) => colorSlot.set(id, i));
  function actionColor(id) {
    if (!colorSlot.has(id)) colorSlot.set(id, colorSlot.size);
    return SERIES[colorSlot.get(id) % SERIES.length];
  }

  /* ========================================================= modal & toast */
  function openModal(html, { small = false, onMount } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal ${small ? 'small' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(wrap);
    const close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    if (onMount) onMount(wrap, close);
    const first = wrap.querySelector('input, textarea, select, button');
    if (first) first.focus();
    return close;
  }
  function toast(msg, err) {
    let box = $('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3800);
  }

  /* ============================================== mutations (mock "UDF" writes) */
  const nowIso = () => new Date().toISOString();
  function rebuild() { M = Measures.build(db); App.M = M; }
  function audit(resourceId, eventType, newValue, actorType = 'USER') {
    db.app_audit_event.push({ event_id: `AE-L${db.app_audit_event.length + 1}`, resource_type: 'action', resource_id: resourceId, actor_type: actorType,
      actor_id: actorType === 'USER' ? state.userId : null, event_type: eventType, old_value: null, new_value: newValue, occurred_at: nowIso() });
  }
  /** Adopt / Reject / Hold / Cancel adoption. Mirrors a User Data Function with server-side checks. */
  function decide(actionId, decision, { reason = null, holdUntil = null } = {}) {
    const a = M.action(actionId);
    if (!canDecide(a)) { toast(t('no_permission'), true); return false; }
    if (decision === 'REJECT' && !reason) return false;
    if (decision === 'HOLD' && !holdUntil) return false;
    if (decision === 'CANCEL_ADOPTION') {
      const tot = M.actionTotals(actionId, state.periodId, 'OP');
      if (Math.abs(tot.actualToDate) > 0.0001) { toast(t('cannot_cancel'), true); return false; }
    }
    const prev = M.actionDecisions(actionId).slice(-1)[0];
    const id = `DC-L${db.app_action_decision.length + 1}`;
    db.app_action_decision.push({ decision_id: id, action_id: actionId, decision, reason, hold_until_period_id: holdUntil, decided_by: state.userId, decided_at: nowIso(),
      overrides_decision_id: prev && prev.decided_by !== state.userId ? prev.decision_id : null });
    a.latest_decider = state.userId; a.latest_decided_at = nowIso();
    if (decision === 'ADOPT') {
      a.decision_state = 'ADOPTED';
      a.adopted_period_id = state.periodId;
      a.execution_state = a.start_period_id <= state.periodId ? 'IN_PROGRESS' : 'NOT_STARTED';
      // Outlook starts equal to plan; actuals for closed months are measured (0 until the next measurement run).
      db.app_action_effect_monthly.filter((e) => e.action_id === actionId).forEach((e) => {
        if (M.period(e.period_id).is_closed) { e.actual_effect = 0; e.outlook_effect = null; } else { e.outlook_effect = e.planned_effect; e.actual_effect = null; }
      });
    } else if (decision === 'REJECT') { a.decision_state = 'REJECTED'; a.adopted_period_id = null; }
    else if (decision === 'HOLD') { a.decision_state = 'ON_HOLD'; a.hold_until_period_id = holdUntil; a.adopted_period_id = null; }
    else if (decision === 'CANCEL_ADOPTION') {
      a.decision_state = 'PROPOSED'; a.adopted_period_id = null; a.execution_state = 'NOT_STARTED';
      db.app_action_effect_monthly.filter((e) => e.action_id === actionId).forEach((e) => { e.actual_effect = null; e.outlook_effect = null; });
    }
    audit(actionId, `DECISION_${decision}`, reason || (holdUntil ? `hold until ${holdUntil}` : decision));
    // Override by a different (higher-level) user → system notice in the Action thread (C-03).
    if (prev && prev.decided_by !== state.userId) {
      let th = db.app_chat_thread.find((x) => x.action_id === actionId);
      if (!th) { th = { thread_id: `TH-${actionId}`, action_id: actionId }; db.app_chat_thread.push(th); }
      db.app_chat_message.push({ message_id: `MS-L${db.app_chat_message.length + 1}`, thread_id: th.thread_id, author_id: null, message_type: 'SYSTEM',
        body: `Decision by ${userName(prev.decided_by)} (${prev.decision}) was overridden: ${decision} by ${userName(state.userId)}.${reason ? ' Reason: ' + reason : ''}`,
        mentions: prev.decided_by, email_notified: true, due_date: null, sent_at: nowIso() });
      toast(t('override_notice'));
    }
    rebuild();
    return true;
  }

  /**
   * Progress update by the owning organization (A-03). Writes the progress row for the latest closed month,
   * reforecasts the open-month outlook for every target Metric (simulated AI rule in M.reforecast) and logs
   * the change. F-01 reads the new outlook immediately; confirmed Forecast versions stay unchanged.
   */
  function updateProgress(actionId, pct, note) {
    const a = M.action(actionId);
    const pid = M.latestClosed();
    if (!canEditOrg(a.owner_org_id)) { toast(t('progress_no_perm'), true); return null; }
    if (state.periodId !== pid) { toast(t('progress_locked', { month: periodLabel(pid) }), true); return null; }
    const rf = M.reforecast(actionId, pid, pct);
    db.app_action_effect_monthly.filter((e) => e.action_id === actionId && e.period_id > pid).forEach((e) => {
      if (rf.scale !== null) e.outlook_effect = M.r2((e.outlook_effect ?? 0) * rf.scale);
      else e.outlook_effect = M.r2((e.planned_effect || 0) * rf.planScale);
    });
    const old = db.app_action_progress.find((p) => p.action_id === actionId && p.period_id === pid);
    const row = { action_id: actionId, period_id: pid, progress_pct: pct, ai_status: rf.status, outlook_total_op: M.r2(rf.outlookNew),
      comment_id: old && pct === old.progress_pct ? old.comment_id : null, updated_by: state.userId, updated_at: nowIso() };
    if (old) Object.assign(old, row); else db.app_action_progress.push(row);
    if (pct >= 100 && a.end_period_id <= pid) a.execution_state = 'COMPLETED';
    else if (pct > 0 && a.execution_state === 'NOT_STARTED') a.execution_state = 'IN_PROGRESS';
    audit(actionId, 'PROGRESS_UPDATE', `${rf.oldPct}% → ${pct}% · outlook OP ${rf.outlookOld} → ${row.outlook_total_op} · ${rf.status}${note ? ' · ' + note : ''}`);
    if (note) {
      let th = db.app_chat_thread.find((x) => x.action_id === actionId);
      if (!th) { th = { thread_id: `TH-${actionId}`, action_id: actionId }; db.app_chat_thread.push(th); }
      db.app_chat_message.push({ message_id: `MS-L${db.app_chat_message.length + 1}`, thread_id: th.thread_id, author_id: state.userId, message_type: 'MESSAGE',
        body: `[${t('update_progress')}: ${rf.oldPct}% → ${pct}%] ${note}`, mentions: '', email_notified: false, due_date: null, sent_at: nowIso() });
    }
    rebuild();
    return rf;
  }

  /* ================================================================ shell */
  const SCREENS = {};
  const MENU = [
    { key: 'menu_ai', home: 'A01', screens: ['A01', 'A02', 'A03', 'A04', 'A05', 'C03'] },
    { key: 'menu_forecast', home: 'F01', screens: ['F01'] },
    { key: 'menu_bi', home: 'B01', screens: ['B01', 'B02'] },
  ];
  const SCREEN_ID = { A01: 'A-01', A02: 'A-02', A03: 'A-03', A04: 'A-04', A05: 'A-05', C03: 'C-03', F01: 'F-01', B01: 'B-01', B02: 'B-02' };

  function go(screen, params = {}) {
    state.screen = screen; state.params = params;
    render();
    $('main').scrollTop = 0;
  }
  function renderShell() {
    const activeMenu = MENU.find((m) => m.screens.includes(state.screen)) || MENU[0];
    const crumbs = [`<span>${esc(t(activeMenu.key))}</span>`, `<span class="sep">›</span>`, `<span class="sid">${SCREEN_ID[state.screen]}</span><span>${esc(t('scr_' + state.screen))}</span>`];
    $('#topbar').innerHTML = `
      <div class="product">${esc(t('app_title'))}</div>
      <nav>${MENU.map((m) => `<button data-menu="${m.home}" class="${m === activeMenu ? 'active' : ''}">${esc(t(m.key))}</button>`).join('')}</nav>
      <div class="spacer"></div>
      <span class="sim-badge" title="${esc(t('simulated_note'))}">${esc(t('simulated'))}</span>`;
    $('#contextbar').innerHTML = `
      <div class="crumb">${crumbs.join('')}</div>
      <div class="spacer"></div>
      <div class="ctl"><label for="ctx-period">${esc(t('period'))}</label>
        <select id="ctx-period">${selectablePeriods().map((p) => `<option value="${p}" ${p === state.periodId ? 'selected' : ''}>${esc(periodLabel(p))}</option>`).join('')}</select></div>
      <div class="ctl"><label for="ctx-org">${esc(t('org'))}</label>
        <select id="ctx-org">${userOrgs().map((o) => `<option value="${o}" ${o === state.orgId ? 'selected' : ''}>${'  '.repeat(M.org(o).org_level - 1)}${esc(orgName(o))}</option>`).join('')}</select></div>
      <div class="ctl"><label for="ctx-lang">${esc(t('language'))}</label>
        <select id="ctx-lang">${I18N.LANGS.map((l) => `<option value="${l.code}" ${l.code === I18N.get() ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <button class="btn" data-fn="FN01">${esc(t('screen_output'))}</button>
      <button class="btn" data-fn="FN02">${esc(t('formatted_output'))}</button>
      <button class="btn toggle ${state.chatOpen ? 'on' : ''}" data-fn="C01">${esc(t('ai_chat'))}</button>
      <div class="ctl"><label for="ctx-user">${esc(t('user'))}</label>
        <select id="ctx-user">${db.app_user.map((u) => `<option value="${u.user_id}" ${u.user_id === state.userId ? 'selected' : ''}>${esc(u.display_name)}</option>`).join('')}</select></div>`;
  }
  function renderChat() {
    const panel = $('#chatpanel');
    panel.classList.toggle('hidden', !state.chatOpen);
    if (!state.chatOpen) return;
    panel.innerHTML = `<div class="card" style="margin:12px;box-shadow:none">
      <h2>C-01 ${esc(t('ai_chat'))}</h2>
      <div class="ai-box small">
        <div><b>${esc(t('period'))}:</b> ${esc(ytdLabel())}</div>
        <div><b>${esc(t('org'))}:</b> ${esc(orgName(state.orgId))}</div>
        <div><b>Screen:</b> ${SCREEN_ID[state.screen]} ${esc(t('scr_' + state.screen))}</div>
      </div>
      <p class="muted small" style="margin-top:12px">${esc(t('coming_next'))}</p></div>`;
  }
  function render() {
    renderShell();
    const scr = SCREENS[state.screen] || SCREENS.placeholder;
    $('main').innerHTML = scr.render(state.params) + `<p class="hint" style="margin-top:24px">${esc(t('simulated_note'))} <button class="btn ghost small" data-reset>${esc(t('reset_demo'))}</button></p>`;
    if (scr.mount) scr.mount($('main'), state.params);
    renderChat();
    persist();
  }
  function bindShell() {
    document.addEventListener('change', (e) => {
      const id = e.target.id;
      if (id === 'ctx-period') { state.periodId = Number(e.target.value); render(); }
      if (id === 'ctx-org') { state.orgId = e.target.value; if (state.screen === 'A02') state.screen = 'A01'; render(); }
      if (id === 'ctx-lang') { state.lang = e.target.value; I18N.set(state.lang); render(); }
      if (id === 'ctx-user') {
        state.userId = e.target.value;
        if (!userOrgs().includes(state.orgId)) state.orgId = user().home_org_id;
        if (state.screen === 'A02') state.screen = 'A01';
        render();
      }
    });
    document.addEventListener('click', (e) => {
      const menu = e.target.closest('[data-menu]');
      if (menu) { go(menu.dataset.menu); return; }
      const fn = e.target.closest('[data-fn]');
      if (fn) {
        if (fn.dataset.fn === 'C01') { state.chatOpen = !state.chatOpen; renderShell(); renderChat(); }
        else toast(`${fn.dataset.fn === 'FN01' ? 'FN-01' : 'FN-02'}: ${t('coming_next')}`);
        return;
      }
      if (e.target.closest('[data-reset]')) { try { localStorage.removeItem(STORE_KEY); } catch (err) { /* ignore */ } location.reload(); }
    });
  }

  SCREENS.placeholder = {
    render: () => `<div class="page-head"><h1>${SCREEN_ID[state.screen]} ${esc(t('scr_' + state.screen))}</h1></div>
      <div class="card"><div class="placeholder">${esc(t('coming_next'))}</div></div>`,
  };

  const App = {
    db, state, get M() { return M; }, set M(v) { M = v; }, t, esc, $, $$, fmt, fmtSigned, tone, periodLabel, monthLabel, orgName, userName, user, metricName,
    aiText, aiPlain, actionName, actionNamePlain, actionDesc, pointTitle, selectablePeriods, userOrgs, canDecide, canConfirm, canEditOrg, ytdLabel,
    Chart, openModal, toast, decide, rebuild, audit, go, render, SCREENS, SCREEN_ID, nowIso, actionColor, updateProgress,
    /** Metric selection shared by the A-03 / A-04 tabs (README §10: kept when switching). */
    boardUi: { metrics: ['OP'], metric: 'OP', range: 'HIST', status: '' },
    start() {
      initContext(); bindShell();
      // Deep link (e.g. notifications): #A02:PT-001, #A01
      const [scr, id] = decodeURIComponent(location.hash.slice(1)).split(':');
      if (scr === 'A02' && id && M.point(id)) { state.screen = 'A02'; state.params = { pointId: id, order: M.pointsFor(state.orgId, state.periodId).sort((a, b) => Math.abs(b.overall) - Math.abs(a.overall)).map((r) => r.point.point_id) }; }
      else if (scr && SCREEN_ID[scr]) state.screen = scr;
      render();
    },
  };
  root.App = App;
})(window);
