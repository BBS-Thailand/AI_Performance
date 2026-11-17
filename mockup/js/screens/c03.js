/* C-03 Action chat — README §3.8, concept slide 46 */
(function () {
  'use strict';
  const A = window.App;
  const C = () => A.Chat;
  /** Per-session UI state: private @AI answers (never stored in the thread until shared), shown translations, unsent text. */
  const local = { actionId: null, privates: {}, shown: new Set(), draft: {}, email: true, seq: 0 };

  const fmtWhen = (iso) => C().fmtWhen(iso);
  const statusOf = (a) => {
    const p = A.M.actionProgress(a.action_id, A.state.periodId);
    return p ? { tag: `<span class="tag ps-${p.ai_status}">${A.esc(A.t('ps_' + p.ai_status))}</span>`, pct: p.progress_pct } : { tag: `<span class="tag">${A.esc(A.t('e_' + a.execution_state))}</span>`, pct: 0 };
  };

  function threadsInScope() {
    const { M, state } = A;
    return A.db.app_chat_thread.map((th) => M.action(th.action_id)).filter((a) => a && M.inScope(a.owner_org_id, state.orgId))
      .sort((x, y) => x.action_id.localeCompare(y.action_id));
  }

  /** Highlight @mentions (participants and @AI) in escaped text. */
  function richBody(text, actionId) {
    const names = C().participants(actionId).map((u) => C().firstName(u).toLowerCase());
    return A.esc(text).replace(/@([\p{L}\p{N}_]+)/gu, (m, w) => (names.includes(w.toLowerCase()) || w.toLowerCase() === 'ai' ? `<span class="mention">${m}</span>` : m));
  }

  function messageHtml(msg, a) {
    const { esc, t, state } = A;
    const lang = msg.language_code || 'en';
    const tr = local.shown.has(msg.message_id) ? C().storedTranslation(msg.message_id, state.lang) : null;
    const body = tr ? tr.body : msg.body;
    const trBtn = lang !== state.lang && msg.message_type !== 'SYSTEM'
      ? `<button class="linkbtn" data-tr="${msg.message_id}">${esc(tr ? t('c3_show_original', { lang: I18N.langName(lang) }) : t('c3_translate'))}</button>${tr ? ` <span class="hint">${esc(t('c3_translated', { by: tr.translated_by === 'AI' ? 'AI' : t('c3_tr_mock') }))}</span>` : ''}` : '';
    if (msg.message_type === 'SYSTEM') return `<div class="c3-msg sys"><span>${esc(body)}</span> <span class="hint">${esc(fmtWhen(msg.sent_at))}</span></div>`;
    const mine = msg.author_id === state.userId;
    const meta = msg.message_type === 'AI'
      ? `<b class="ai-who">AI</b> <span class="hint">${esc(t('c3_shared_by', { who: A.userName(msg.author_id) }))}${msg.ai_model ? ' · ' + esc(C().modelName(msg.ai_model)) : ' · ' + esc(t('c3_demo_tag'))}</span>`
      : `<b>${esc(A.userName(msg.author_id))}</b>`;
    const due = msg.due_date ? new Intl.DateTimeFormat(I18N.locale(), { month: 'numeric', day: 'numeric' }).format(new Date(msg.due_date + 'T00:00:00Z')) : '–';
    const req = msg.message_type === 'PROGRESS_REQUEST' ? ` <span class="tag warn">${esc(t('c3_req_tag', { d: due }))}</span>` : '';
    const q = msg.message_type === 'AI' ? `<div class="c3-q">${esc(t('c3_ai_asked', { who: A.userName(msg.author_id) }))} ${richBody(msg.ai_question || '', a.action_id)}</div>` : '';
    return `<div class="c3-msg ${msg.message_type === 'AI' ? 'ai' : mine ? 'mine' : 'other'}">
      <div class="c3-meta">${meta} <span class="hint">${esc(fmtWhen(msg.sent_at))}</span>${req}${msg.email_notified ? ` <span class="hint" title="${esc(t('c3_email_too'))}">✉</span>` : ''}</div>
      ${q}<div class="c3-body">${richBody(body, a.action_id)}</div>${trBtn ? `<div class="c3-tr">${trBtn}</div>` : ''}</div>`;
  }

  function privateHtml(p) {
    const { esc, t } = A;
    const head = p.kind === 'SUMMARY' ? t('c3_summarize') : p.kind === 'DRAFT' ? t('c3_draft') : p.question;
    const flags = p.unknown && p.unknown.length ? `<div class="warnline">⚠ ${esc(t('c3_unknown_nums', { n: p.unknown.join(', ') }))}</div>` : '';
    const actions = p.status === 'done' ? `
        ${p.kind === 'DRAFT' ? `<button class="btn small primary" data-use="${p.id}">${esc(t('c3_use_draft'))}</button>` : `<button class="btn small primary" data-share="${p.id}">${esc(t('c3_share'))}</button>`}
        <button class="btn small ghost" data-discard="${p.id}">${esc(t('c3_discard'))}</button>`
      : p.status === 'error' ? `<button class="btn small ghost" data-discard="${p.id}">${esc(t('c3_discard'))}</button>` : `<span class="hint">${esc(t('c3_thinking'))}</span>`;
    return `<div class="c3-private" data-pid="${p.id}">
      <div class="c3-meta"><b class="ai-who">AI</b> <span class="tag">🔒 ${esc(t('c3_only_you'))}</span> <span class="hint">${esc(p.demo ? t('c3_demo_tag') : C().modelName(p.model || C().settings.model))}</span></div>
      <div class="c3-q">${esc(t('c3_you_asked'))} ${esc(head)}</div>
      <div class="c3-body" data-ptext>${p.status === 'error' ? `<span class="bad">${esc(p.error)}</span>` : esc(p.text || '')}</div>
      ${flags}<div class="c3-pact">${actions}</div></div>`;
  }

  function aiBar() {
    const { esc, t } = A;
    const s = C().settings;
    const prov = C().PROVIDERS.find((p) => p.id === s.provider) || C().PROVIDERS[0];
    const keyState = s.key
      ? `<span class="tag ps-ON_TRACK">✓ ${esc(t('c3_key_set'))}</span> <button class="linkbtn" data-key-clear>${esc(t('c3_key_clear'))}</button>`
      : `<input type="password" id="c3-key" placeholder="${esc(t('c3_key_ph'))}" autocomplete="off" spellcheck="false"><button class="btn small" data-key-save>${esc(t('c3_key_save'))}</button>`;
    return `<div class="c3-aibar">
      <span class="ai-who">AI</span>
      <label class="ctl">${esc(t('c3_provider'))} <select id="c3-provider">${C().PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === prov.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="ctl">${esc(t('c3_model'))} <select id="c3-model">${prov.models.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <span class="ctl">${esc(t('c3_key'))} ${keyState}</span>
      <span class="hint c3-keyhint">${esc(s.key ? t('c3_key_hint_set') : t('c3_key_hint'))}</span>
    </div>`;
  }

  function figures(a) {
    const { esc, t, fmt, M, state } = A;
    const st = statusOf(a);
    const rows = ['REV', 'GP', 'SGA', 'OP'].filter((m) => M.actionTargets(a.action_id).includes(m)).map((m) => {
      const tot = M.actionTotals(a.action_id, state.periodId, m);
      return `<tr><td>${esc(t(m))}</td><td class="num">${fmt(tot.planAnnual, 2)}</td><td class="num">${fmt(tot.planToDate, 2)}</td><td class="num">${fmt(tot.actualToDate, 2)}</td><td class="num">${fmt(tot.outlookFY, 2)}</td></tr>`;
    }).join('');
    return `<div class="card">
      <h2>${esc(t('c3_fig_title'))}</h2>
      <div class="c3-st">${st.tag} <span>${esc(t('progress'))} <b>${st.pct}%</b></span> <span class="muted">${esc(t('c3_expected', { p: M.expectedProgress(a, state.periodId) }))}</span></div>
      <div class="table-wrap"><table class="grid-table c3-figs"><thead><tr><th></th><th class="num">${esc(t('c3_f_plan'))}</th><th class="num">${esc(t('c3_f_ptd'))}</th><th class="num">${esc(t('c3_f_atd'))}</th><th class="num">${esc(t('c3_f_out'))}</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="hint">${esc(t('c3_fig_note', { m: A.periodLabel(state.periodId) }))}</p>
      <button class="btn small" data-a05>${esc(t('c3_open_a05'))}</button>
    </div>`;
  }

  function people(a) {
    const { esc, t } = A;
    const can = C().canManage(a);
    const list = C().participants(a.action_id).map((u) => `<li><span>${esc(A.userName(u))}</span>${can && u !== A.state.userId ? `<button class="linkbtn bad" data-rm="${u}" title="${esc(t('c3_remove'))}">✕</button>` : ''}</li>`).join('');
    const cand = can ? C().candidates(a) : [];
    return `<div class="card">
      <h2>${esc(t('c3_participants'))} <span class="muted small">(${C().participants(a.action_id).length})</span></h2>
      <ul class="c3-people">${list}</ul>
      ${can ? (cand.length ? `<div class="c3-add"><select id="c3-add">${cand.map((u) => `<option value="${u}">${esc(A.userName(u))}</option>`).join('')}</select><button class="btn small" data-add>${esc(t('c3_add'))}</button></div>` : `<p class="hint">${esc(t('c3_no_cand'))}</p>`)
        : `<p class="hint">${esc(t('c3_manage_hint'))}</p>`}
    </div>`;
  }

  function threadList() {
    const { esc, t, state } = A;
    const rows = threadsInScope().map((a) => {
      const msgs = C().messages(a.action_id);
      const last = msgs.slice(-1)[0];
      const un = A.M.chatUnread(a.action_id, state.userId);
      return `<tr data-open="${a.action_id}" tabindex="0"><td><span class="id">${a.action_id}</span></td><td>${A.actionName(a)}</td><td>${esc(A.orgName(a.owner_org_id))}</td>
        <td class="small">${last ? `<b>${esc(last.author_id ? A.userName(last.author_id) : t('by_system'))}</b>: ${esc(String(last.body).slice(0, 70))}` : '<span class="muted">–</span>'}</td>
        <td class="nowrap small">${last ? esc(fmtWhen(last.sent_at)) : ''}</td><td>${un && un.unread ? `<span class="chat-ind unread">💬<b>${un.unread}</b></span>` : ''}</td></tr>`;
    }).join('');
    return `<div class="card"><h2>${esc(t('c3_threads'))}</h2><div class="table-wrap"><table class="grid-table"><thead><tr><th>ID</th><th>${esc(t('c3_action'))}</th><th>${esc(t('org'))}</th><th>${esc(t('c3_last'))}</th><th></th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6" class="muted">–</td></tr>`}</tbody></table></div><p class="hint">${esc(t('c3_threads_hint'))}</p></div>`;
  }

  function render(params) {
    const { esc, t, M, state } = A;
    if (params && params.actionId) local.actionId = params.actionId;
    const list = threadsInScope();
    const a0 = local.actionId ? M.action(local.actionId) : null;
    const a = a0 && list.includes(a0) ? a0 : null;
    const head = `<div class="page-head">
        <h1>C-03 ${esc(t('scr_C03'))}</h1>
        <span class="scope">${esc(A.orgName(state.orgId))}</span>
        <div class="actions">
          <label class="muted small" for="c3-pick">${esc(t('pick_action'))}</label>
          <select id="c3-pick"><option value="">${esc(t('c3_all_threads'))}</option>${list.map((x) => `<option value="${x.action_id}" ${a && a.action_id === x.action_id ? 'selected' : ''}>${x.action_id} ${esc(A.actionNamePlain(x))}</option>`).join('')}</select>
          ${a ? `<button class="btn" data-a05>◀ ${esc(t('scr_A05'))} (A-05)</button>` : ''}
          <button class="btn" data-go="A03">◀ ${esc(t('back_exec'))}</button>
        </div></div>`;
    if (!a) {
      const note = a0 ? `<div class="warnline">⚠ ${esc(t('not_in_scope', { id: a0.action_id }))}</div>` : '';
      return head + note + threadList();
    }
    C().markRead(a.action_id);
    const st = statusOf(a);
    const part = C().isParticipant(a.action_id);
    const msgs = C().messages(a.action_id).map((m) => messageHtml(m, a)).join('');
    const privs = (local.privates[a.action_id] || []).map(privateHtml).join('');
    const composer = part ? `
      <div class="c3-compose">
        <div class="c3-tools">
          <button class="btn small" data-ai="SUMMARY">✨ ${esc(t('c3_summarize'))}</button>
          <button class="btn small" data-ai="DRAFT">✎ ${esc(t('c3_draft'))}</button>
          <span class="c3-mentions">${['AI', ...C().participants(a.action_id).filter((u) => u !== state.userId).map((u) => C().firstName(u))].map((n) => `<button class="chip" data-mention="${esc(n)}">@${esc(n)}</button>`).join('')}</span>
        </div>
        <div class="c3-row">
          <textarea id="c3-text" rows="2" placeholder="${esc(t('c3_ph'))}">${esc(local.draft[a.action_id] || '')}</textarea>
          <button class="btn primary" data-send>${esc(t('c3_send'))}</button>
        </div>
        <div class="c3-opts"><label><input type="checkbox" id="c3-email" ${local.email ? 'checked' : ''}> ${esc(t('c3_email_opt'))}</label>
          <span class="hint">${esc(t('c3_ai_hint'))}</span></div>
      </div>` : `<div class="c3-compose"><p class="muted">${esc(t('c3_not_participant'))}</p></div>`;
    return head + `
      <div class="grid c03-main">
        <div class="card c3-thread">
          <div class="c3-head"><span class="id">${a.action_id}</span> <b>${A.actionName(a)}</b> <span class="sep">(${esc(A.orgName(a.owner_org_id))})</span></div>
          <div class="c3-sub">${esc(t('c3_participants'))}: ${C().participants(a.action_id).map((u) => esc(A.userName(u))).join(', ')} <span class="sep">|</span> ${esc(t('c3_status'))}: ${st.tag} ${esc(t('progress'))} ${st.pct}%</div>
          ${aiBar()}
          <div class="c3-msgs" id="c3-msgs">${msgs || `<p class="muted">${esc(t('c3_empty'))}</p>`}${privs}</div>
          ${composer}
        </div>
        <div class="c3-side">${figures(a)}${people(a)}</div>
      </div>`;
  }

  function scrollDown(root) { const box = root.querySelector('#c3-msgs'); if (box) box.scrollTop = box.scrollHeight; }
  function keepDraft(root) { const ta = root.querySelector('#c3-text'); if (ta && local.actionId) local.draft[local.actionId] = ta.value; }

  /** Run an @AI request privately; the answer streams into its private card. */
  async function runAi(root, kind, question) {
    const id = local.actionId;
    const p = { id: `P${++local.seq}`, kind, question, text: '', status: 'streaming', demo: !C().settings.key, model: C().settings.model, unknown: [] };
    (local.privates[id] = local.privates[id] || []).push(p);
    A.render();
    try {
      const res = await C().ask(id, kind, question, (snap) => {
        p.text = snap;
        const el = document.querySelector(`[data-pid="${p.id}"] [data-ptext]`);
        if (el) { el.textContent = snap; scrollDown(document); }
      });
      Object.assign(p, { text: res.text, status: 'done', demo: res.demo, model: res.model, unknown: res.unknown });
    } catch (e) {
      Object.assign(p, { status: 'error', error: e.message });
    }
    if (A.state.screen === 'C03' && local.actionId === id) { keepDraft(document); A.render(); }
  }

  function mount(root) {
    const { t } = A;
    root.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => A.go(b.dataset.go)));
    root.querySelectorAll('[data-a05]').forEach((b) => b.addEventListener('click', () => A.go('A05', { actionId: local.actionId })));
    const pick = root.querySelector('#c3-pick');
    if (pick) pick.addEventListener('change', () => { local.actionId = pick.value || null; A.go('C03', pick.value ? { actionId: pick.value } : {}); });
    root.querySelectorAll('[data-open]').forEach((r) => {
      const open = () => A.go('C03', { actionId: r.dataset.open });
      r.addEventListener('click', open); r.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    });
    if (!local.actionId || !root.querySelector('.c3-thread')) return;
    const id = local.actionId;
    // The shell rendered before this thread was marked read: refresh the bell count.
    const bell = document.querySelector('.bell-wrap');
    if (bell) bell.outerHTML = C().bellHtml();
    scrollDown(root);

    // AI settings
    const prov = root.querySelector('#c3-provider');
    if (prov) prov.addEventListener('change', () => { C().settings.provider = prov.value; keepDraft(root); A.render(); });
    const model = root.querySelector('#c3-model');
    if (model) model.addEventListener('change', () => { C().settings.model = model.value; });
    const save = root.querySelector('[data-key-save]');
    if (save) save.addEventListener('click', () => {
      const v = root.querySelector('#c3-key').value.trim();
      if (!v) return;
      C().settings.key = v; keepDraft(root); A.render(); A.toast(t('c3_key_saved'));
    });
    const keyIn = root.querySelector('#c3-key');
    if (keyIn) keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    const clr = root.querySelector('[data-key-clear]');
    if (clr) clr.addEventListener('click', () => { C().settings.key = ''; keepDraft(root); A.render(); });

    // Composer
    const ta = root.querySelector('#c3-text');
    const email = root.querySelector('#c3-email');
    if (email) email.addEventListener('change', () => { local.email = email.checked; });
    root.querySelectorAll('[data-mention]').forEach((b) => b.addEventListener('click', () => {
      ta.value = (ta.value && !/\s$/.test(ta.value) ? ta.value + ' ' : ta.value) + '@' + b.dataset.mention + ' '; ta.focus();
    }));
    const send = () => {
      const text = ta.value.trim();
      if (!text) return;
      local.draft[id] = '';
      if (C().parseMentions(text, id).ai) { runAi(root, 'ASK', text); return; } // @AI: private until shared
      const res = C().post(id, { body: text, email: local.email });
      A.render();
      if (local.email && res.recipients.length) C().emailPreview(res.msg, res.recipients);
      else A.toast(t('c3_sent_notified', { n: res.recipients.length }));
    };
    const sendBtn = root.querySelector('[data-send]');
    if (sendBtn) sendBtn.addEventListener('click', send);
    if (ta) ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(); } });
    root.querySelectorAll('[data-ai]').forEach((b) => b.addEventListener('click', () => { keepDraft(root); runAi(root, b.dataset.ai, null); }));

    // Private AI answers
    const privs = () => local.privates[id] || [];
    root.querySelectorAll('[data-share]').forEach((b) => b.addEventListener('click', () => {
      const p = privs().find((x) => x.id === b.dataset.share);
      if (!p) return;
      const q = p.kind === 'SUMMARY' ? t('c3_summarize') : p.question;
      const res = C().post(id, { body: p.text, type: 'AI', aiQuestion: q, aiModel: p.demo ? null : p.model, email: local.email });
      local.privates[id] = privs().filter((x) => x !== p);
      keepDraft(root); A.render();
      if (local.email && res.recipients.length) C().emailPreview(res.msg, res.recipients);
      else A.toast(t('c3_shared_ok', { n: res.recipients.length }));
    }));
    root.querySelectorAll('[data-use]').forEach((b) => b.addEventListener('click', () => {
      const p = privs().find((x) => x.id === b.dataset.use);
      if (!p) return;
      local.draft[id] = p.text;
      local.privates[id] = privs().filter((x) => x !== p);
      A.render();
      const el = document.querySelector('#c3-text'); if (el) el.focus();
    }));
    root.querySelectorAll('[data-discard]').forEach((b) => b.addEventListener('click', () => {
      local.privates[id] = privs().filter((x) => x.id !== b.dataset.discard); keepDraft(root); A.render();
    }));

    // Translation
    root.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', async () => {
      const mid = b.dataset.tr;
      if (local.shown.has(mid)) { local.shown.delete(mid); keepDraft(root); A.render(); return; }
      const msg = A.db.app_chat_message.find((m) => m.message_id === mid);
      b.disabled = true; b.textContent = t('c3_translating');
      try { await C().translate(msg, A.state.lang); local.shown.add(mid); } catch (e) { A.toast(e.message, true); }
      keepDraft(document); A.render();
    }));

    // Participants
    const add = root.querySelector('[data-add]');
    if (add) add.addEventListener('click', () => { if (C().addParticipant(id, root.querySelector('#c3-add').value)) { keepDraft(root); A.render(); } });
    root.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { if (C().removeParticipant(id, b.dataset.rm)) { keepDraft(root); A.render(); } }));
  }

  A.SCREENS.C03 = { render, mount };
})();
