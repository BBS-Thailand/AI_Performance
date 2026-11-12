/* P-01 Action detail / add (modal) — README §3.3
 * The effect is never entered by the user: it is produced by "AI analysis" (simulated here)
 * and saving is blocked unless the effect is measurable with available data. */
(function () {
  'use strict';
  const A = window.App;
  const TARGETS = { REV: ['REV', 'GP', 'OP'], COGS: ['GP', 'OP'], SGA: ['SGA', 'OP'] };
  const KEYWORDS = {
    REV: /revenue|order|sales|customer|price|demand|volume|distributor|受注|売上|顧客|販売|代理店|ยอดขาย|ลูกค้า|คำสั่งซื้อ/i,
    COGS: /cost of|material|supplier|yield|scrap|purchase|procure|原価|材料|歩留|購買|調達|ต้นทุน|วัตถุดิบ|ผลผลิต/i,
    SGA: /rent|lease|logistics|freight|shipping|office|travel|advertis|utilit|賃料|物流|運賃|家賃|広告|光熱|ค่าเช่า|ขนส่ง|สำนักงาน/i,
  };

  /** Simulated P-01 AI analysis. Production: AI service + measurability check against Fabric metadata. */
  function simulate(point, form) {
    const M = A.M, lang = A.state.lang;
    const issues = [];
    if (!form.name.trim()) issues.push('name');
    if (form.desc.trim().length < 20) issues.push('desc');
    if (form.start > form.end) issues.push('period');
    const kind = ['SGA', 'COGS', 'REV'].find((k) => KEYWORDS[k].test(form.name + ' ' + form.desc));
    const parent = point.parent_point_id ? M.point(point.parent_point_id) : point;
    const filter = JSON.parse(parent.indicator_filter || '{}');
    const ja = lang === 'ja';
    if (issues.length || !kind) {
      const why = issues.length
        ? (ja ? '必須項目（名称、20文字以上の内容、開始≦終了）を確認してください。' : 'Check required fields: name, content of at least 20 characters, and start ≤ end.')
        : (ja ? '内容を測定可能なデータ（対象の顧客・製品、原価科目、または経費科目）に結び付けられませんでした。対象を具体的に記載してください。例：「顧客Bの駆動モジュール受注を回復する」'
          : 'AI could not link the content to measurable data (target customer/product, cost account or expense account). Name the target explicitly, e.g. "Recover drive-module orders from Customer B".');
      return { measurable: false, explanation: why, targets: [], planOp: 0, monthly: [], overlaps: [] };
    }
    const fyP = M.fyPeriods(M.period(A.state.periodId).fiscal_year);
    const months = fyP.filter((p) => p >= form.start && p <= form.end);
    const share = months.length / 12;
    const planOp = Math.max(0.5, Math.round(Math.min(Math.abs(M.pointSnapshot(parent.point_id, A.state.periodId)?.overall || 10) * 0.15, 6) * share * 10) / 10);
    const per = Math.round((planOp / months.length) * 100) / 100;
    const monthly = fyP.map((p) => (months.includes(p) ? per : 0));
    monthly[fyP.indexOf(months[months.length - 1])] = Math.round((planOp - per * (months.length - 1)) * 100) / 100;
    const custNames = (filter.customer_id || []).map((c) => A.db.dim_customer.find((x) => x.customer_id === c).customer_name).join(', ');
    const acct = kind === 'REV' ? '4010, 5010' : (filter.account_id || [kind === 'SGA' ? '6050' : '5010']).join(', ');
    const src = {
      mode: 'DIRECT',
      source: `fact_financial (${acct})`,
      filter: kind === 'REV' && custNames ? `customer_id IN (${(filter.customer_id || []).join(', ')}); org_id = ${form.owner}` : `org_id = ${form.owner}; account ${acct}`,
      baseline: ja ? `開始前3か月平均（${A.periodLabel(M.prevPeriod(M.prevPeriod(M.prevPeriod(form.start))))}〜${A.periodLabel(M.prevPeriod(form.start))}）` : `3-month average before start (${A.periodLabel(M.prevPeriod(M.prevPeriod(M.prevPeriod(form.start))))}–${A.periodLabel(M.prevPeriod(form.start))})`,
      formula: kind === 'REV' ? '(actual revenue − baseline revenue) × gross margin 25%' : kind === 'COGS' ? 'baseline cost − actual cost (volume-adjusted)' : 'baseline expense − actual expense',
    };
    // Overlap checks: other live Actions on the same Point with the same effect type, and Factors on the same org / period.
    const siblings = M.actionsForPoint(parent.point_id).filter((a) => a.action_id !== form.actionId && a.effect_kind === kind && ['ADOPTED', 'PROPOSED'].includes(a.decision_state));
    const factors = A.db.app_factor.filter((f) => !f.is_deleted && f.start_period_id <= form.end && f.end_period_id >= form.start
      && A.db.app_factor_org.some((o) => o.factor_id === f.factor_id && o.org_id === form.owner));
    const overlaps = [
      ...siblings.map((a) => ({ id: a.action_id, text: (ja ? '同一ポイント・同種の効果：' : 'Same Point and effect type: ') + A.actionNamePlain(a) })),
      ...factors.map((f) => ({ id: f.factor_id, text: (ja ? '期間が重なる個別要因（測定から除外）：' : 'Individual Factor in the same org/period (excluded from measurement): ') + A.aiPlain(f.title_comment_id) })),
    ];
    const explanation = ja
      ? `対象指標：${TARGETS[kind].map((m) => A.t(m)).join('、')}。${src.source} から直接測定します。ベースライン：${src.baseline}。計算式：${src.formula}。年度計画効果（営業利益）は${planOp}百万円、${months.length}か月に均等配分しました（ポイント年換算影響の15%を上限に期間按分）。`
      : `Target Metrics: ${TARGETS[kind].map((m) => A.t(m)).join(', ')}. Measured directly from ${src.source}. Baseline: ${src.baseline}. Formula: ${src.formula}. Planned FY operating-profit effect JPY ${planOp}M, spread evenly over ${months.length} months (capped at 15% of the Point's annualized impact, prorated by term).`;
    return { measurable: true, kind, targets: TARGETS[kind], planOp, monthly, months, overlaps, explanation, src, reliability: null };
  }

  function fromStored(a) {
    const M = A.M;
    const meas = A.db.app_action_measurement.find((x) => x.action_id === a.action_id) || {};
    const fyP = M.fyPeriods(M.period(A.state.periodId).fiscal_year);
    const rows = M.effectRows(a.action_id, 'OP');
    const overlaps = M.actionExclusions(a.action_id).map((x) => ({ id: x.factor_id, text: A.aiPlain(x.method_comment_id) }));
    return {
      measurable: meas.is_measurable !== false, kind: a.effect_kind, targets: M.actionTargets(a.action_id),
      planOp: M.actionTotals(a.action_id, A.state.periodId, 'OP').planAnnual,
      monthly: fyP.map((p) => (rows.find((r) => r.period_id === p) || {}).planned_effect || 0),
      overlaps, explanation: A.aiPlain(meas.ai_comment_id), explanationId: meas.ai_comment_id,
      src: { mode: meas.measurement_mode, source: meas.source_tables, filter: meas.source_filter, baseline: meas.baseline_method, formula: meas.formula },
      reliability: meas.proxy_reliability,
    };
  }

  function persistAction(point, form, an, existing) {
    const db = A.db, M = A.M;
    const childPointId = point.parent_point_id ? point.point_id : `${point.point_id}-${form.owner}`;
    let a = existing;
    if (!a) {
      const seq = db.app_action.filter((x) => x.point_id === childPointId && x.origin === 'USER').length + 1;
      const id = `ACT-${String(M.point(childPointId).point_no).padStart(3, '0')}-${form.owner}-U${String(seq).padStart(2, '0')}`;
      a = { action_id: id, point_id: childPointId, owner_org_id: form.owner, origin: 'USER', seq_no: seq, action_name_comment_id: null, description_comment_id: null,
        decision_state: 'PROPOSED', execution_state: 'NOT_STARTED', hold_until_period_id: null, adopted_period_id: null, latest_decider: null, latest_decided_at: null };
      db.app_action.push(a);
      A.audit(id, 'CREATE', form.name);
    } else {
      A.audit(a.action_id, 'UPDATE', form.name);
    }
    Object.assign(a, { action_name: form.name, description: form.desc, start_period_id: form.start, end_period_id: form.end, effect_kind: an.kind });
    db.app_action_target_metric = db.app_action_target_metric.filter((x) => x.action_id !== a.action_id);
    an.targets.forEach((m) => db.app_action_target_metric.push({ action_id: a.action_id, metric_id: m }));
    db.app_action_effect_monthly = db.app_action_effect_monthly.filter((x) => x.action_id !== a.action_id);
    const fyP = M.fyPeriods(M.period(A.state.periodId).fiscal_year);
    fyP.forEach((p, i) => {
      if (!an.monthly[i]) return;
      an.targets.forEach((m) => db.app_action_effect_monthly.push({ action_id: a.action_id, metric_id: m, period_id: p,
        planned_effect: M.r2(m === 'REV' ? an.monthly[i] * 4 : m === 'SGA' ? -an.monthly[i] : an.monthly[i]), actual_effect: null, outlook_effect: null, excluded_factor_amount: null }));
    });
    const cid = `CM-AEXPL-${a.action_id}-L${Date.now()}`;
    db.ai_comment.push({ comment_id: cid, run_id: 'P01-INTERACTIVE', as_of_period_id: A.state.periodId, org_id: form.owner, comment_type: 'ACTION_EXPLANATION', entity_type: 'action', entity_id: a.action_id, base_language: A.state.lang, version: 1, is_current: true });
    db.ai_comment_text.push({ comment_id: cid, language_code: A.state.lang, text: an.explanation, is_base: true, translated_at: null, reviewed_by: null });
    db.app_action_measurement = db.app_action_measurement.filter((x) => x.action_id !== a.action_id);
    db.app_action_measurement.push({ action_id: a.action_id, measurement_mode: an.src.mode, is_measurable: true, source_tables: an.src.source, source_filter: an.src.filter,
      baseline_method: an.src.baseline, formula: an.src.formula, proxy_indicator: null, proxy_reliability: null, ai_comment_id: cid });
    A.rebuild();
    return a.action_id;
  }

  A.openActionModal = function ({ pointId, actionId }) {
    const { t, esc, fmt } = A;
    const M = A.M;
    const point = M.point(pointId);
    const existing = actionId ? M.action(actionId) : null;
    const childOrgs = point.parent_point_id ? [point.org_id] : M.pointChildren(point.point_id).map((c) => c.org_id);
    const ownerOptions = existing ? [existing.owner_org_id] : childOrgs.filter((o) => A.userOrgs().includes(o));
    const fyP = M.fyPeriods(M.period(A.state.periodId).fiscal_year);
    const editable = !existing || ['PROPOSED', 'ON_HOLD'].includes(existing.decision_state);
    const form = existing
      ? { actionId: existing.action_id, name: A.actionNamePlain(existing), desc: existing.description || A.aiPlain(existing.description_comment_id), owner: existing.owner_org_id, start: existing.start_period_id, end: existing.end_period_id }
      : { actionId: null, name: '', desc: '', owner: ownerOptions[0] || childOrgs[0], start: fyP.find((p) => p > A.state.periodId) || fyP[0], end: fyP[11] };
    let analysis = existing ? fromStored(existing) : null;
    let dirty = false;
    let busy = false;

    const periodSel = (id, val) => `<select id="${id}" ${editable ? '' : 'disabled'}>${fyP.map((p) => `<option value="${p}" ${p === val ? 'selected' : ''}>${esc(A.periodLabel(p))}</option>`).join('')}</select>`;
    function resultHtml() {
      if (busy) return `<div class="placeholder">${esc(t('ai_analysis'))}…</div>`;
      if (!analysis) return `<div class="placeholder">${esc(t('run_ai_first'))}</div>`;
      const an = analysis;
      const chart = an.measurable ? A.Chart.monthly([{ name: `${t('planned_effect')} (${t('OP')})`, type: 'bar', color: 'var(--accent)', values: an.monthly }], { labels: fyP.map(A.monthLabel), height: 150 }) : '';
      return `
        <dl class="kv">
          <dt>${esc(t('target_metrics'))}</dt><dd>${an.targets.map((m) => `<span class="tag">${esc(t(m))}</span>`).join(' ') || '–'}</dd>
          <dt>${esc(t('annual_planned'))}</dt><dd><b>${an.measurable ? fmt(an.planOp) + ' ' + esc(t('jpy_m')) : '–'}</b></dd>
          ${an.src ? `<dt>${esc(t('measurement_method'))}</dt><dd>${esc(t('mode_' + an.src.mode))}${an.reliability ? ` · ${esc(t('reliability'))}: ${esc(an.reliability)}` : ''}</dd>
          <dt>${esc(t('source_data'))}</dt><dd><code>${esc(an.src.source)}</code><div class="small muted">${esc(an.src.filter)}</div></dd>
          <dt>${esc(t('baseline'))}</dt><dd>${esc(an.src.baseline)}</dd>
          <dt>${esc(t('formula'))}</dt><dd><code>${esc(an.src.formula)}</code></dd>` : ''}
        </dl>
        ${an.measurable ? `<div class="section-title">${esc(t('monthly_allocation'))}</div>${chart}` : ''}
        <div class="section-title">${esc(t('ai_explanation'))} <span class="tag ai">${esc(t('ai_generated'))}</span></div>
        <div class="ai-box small">${an.explanationId ? A.aiText(an.explanationId) : esc(an.explanation)}</div>
        <div class="verdict ${an.measurable ? 'ok' : 'ng'}">${an.measurable ? '✓ ' + esc(t('measurable')) : '✕ ' + esc(t('not_measurable'))}</div>
        ${an.overlaps.length ? `<div class="warnbox"><b>${esc(t('overlap_warning'))}:</b><ul style="margin:4px 0 0 18px;padding:0">${an.overlaps.map((o) => `<li><span class="id">${esc(o.id)}</span> ${esc(o.text)}</li>`).join('')}</ul></div>`
          : `<div class="small muted" style="margin-top:8px">${esc(t('no_overlap'))}</div>`}`;
    }
    function historyHtml() {
      if (!existing) return '';
      const ds = M.actionDecisions(existing.action_id);
      if (!ds.length) return '';
      return `<div class="section-title">${esc(t('history'))}</div><table class="grid-table"><tbody>${ds.map((d) => `<tr>
        <td>${esc(String(d.decided_at).slice(0, 16).replace('T', ' '))}</td><td>${esc(A.userName(d.decided_by))}</td>
        <td><span class="tag st-${d.decision === 'ADOPT' ? 'ADOPTED' : d.decision === 'REJECT' ? 'REJECTED' : d.decision === 'HOLD' ? 'ON_HOLD' : 'PROPOSED'}">${esc(d.decision)}</span></td>
        <td class="small">${esc(d.reason || (d.hold_until_period_id ? '→ ' + A.periodLabel(d.hold_until_period_id) : ''))}</td></tr>`).join('')}</tbody></table>`;
    }
    const canAdopt = () => A.db.app_user_org_scope.some((s) => s.user_id === A.state.userId && s.can_decide_action && A.M.inScope(form.owner, s.org_id));

    const html = `
      <header><h3>P-01 ${esc(existing ? t('scr_P01') : t('new_action'))}</h3>
        <span class="id">${existing ? existing.action_id : esc(t('id_on_save'))}</span>
        ${existing ? `<span class="tag ${existing.origin === 'AI' ? 'ai' : 'user'}">${esc(t('origin_' + existing.origin))}</span><span class="tag st-${existing.decision_state}">${esc(t('d_' + existing.decision_state))}</span>` : `<span class="tag user">${esc(t('origin_USER'))}</span>`}
        <span class="muted small">${point.point_id}</span>
        <button class="btn ghost x" data-close>✕</button></header>
      <div class="body two-col">
        <div>
          <div class="form-grid">
            <label for="p01-name">${esc(t('action_name'))}</label><input id="p01-name" value="${esc(form.name)}" ${editable ? '' : 'disabled'}>
            <label for="p01-desc">${esc(t('action_content'))}</label><textarea id="p01-desc" ${editable ? '' : 'disabled'}>${esc(form.desc)}</textarea>
            <label for="p01-owner">${esc(t('owner_org'))}</label>
            <select id="p01-owner" ${editable && !existing ? '' : 'disabled'}>${ownerOptions.map((o) => `<option value="${o}" ${o === form.owner ? 'selected' : ''}>${esc(A.orgName(o))}</option>`).join('')}</select>
            <label>${esc(t('start_period'))} / ${esc(t('end_period'))}</label><div style="display:flex;gap:8px">${periodSel('p01-start', form.start)}${periodSel('p01-end', form.end)}</div>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
            <button class="btn primary" id="p01-run" ${editable ? '' : 'disabled'}>✦ ${esc(t('ai_analysis'))}</button>
            <span class="small muted">${esc(t('run_ai_first'))}</span>
          </div>
          <div id="p01-history">${historyHtml()}</div>
        </div>
        <div id="p01-result">${resultHtml()}</div>
      </div>
      <footer>
        <span class="left small muted">${esc(t('simulated_note'))}</span>
        <button class="btn" data-close>${esc(t('close'))}</button>
        <button class="btn" id="p01-save">${esc(t('save'))}</button>
        <button class="btn primary" id="p01-save-adopt">${esc(t('save_adopt'))}</button>
      </footer>`;

    A.openModal(html, {
      onMount(wrap, close) {
        const $ = (s) => wrap.querySelector(s);
        const sync = () => {
          const okToSave = editable && analysis && analysis.measurable && !dirty && !busy && (existing ? true : ownerOptions.length > 0);
          $('#p01-save').disabled = !okToSave || (existing && !wrap.dataset.reanalyzed);
          $('#p01-save-adopt').disabled = !okToSave || !canAdopt();
          $('#p01-result').innerHTML = resultHtml();
        };
        ['#p01-name', '#p01-desc', '#p01-owner', '#p01-start', '#p01-end'].forEach((s) => $(s).addEventListener('input', () => {
          form.name = $('#p01-name').value; form.desc = $('#p01-desc').value; form.owner = $('#p01-owner').value;
          form.start = Number($('#p01-start').value); form.end = Number($('#p01-end').value);
          dirty = true; sync();
        }));
        $('#p01-run').addEventListener('click', () => {
          busy = true; sync();
          setTimeout(() => { analysis = simulate(point, form); busy = false; dirty = false; wrap.dataset.reanalyzed = '1'; sync(); }, 700);
        });
        const save = (adopt) => {
          const id = existing && !wrap.dataset.reanalyzed ? existing.action_id : persistAction(point, form, analysis, existing);
          A.toast(t('saved_action', { id }));
          if (adopt && A.decide(id, 'ADOPT')) A.toast(t('registered_board', { id }));
          close(); A.render();
        };
        $('#p01-save').addEventListener('click', () => save(false));
        $('#p01-save-adopt').addEventListener('click', () => save(true));
        sync();
      },
    });
  };
})();
