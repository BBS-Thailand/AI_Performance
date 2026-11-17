/* Action chat (C-03) — thread data, notifications and the AI client. README §3.8, concept slide 46.
 * One chat per adopted Action, started by a user who invites the participants; AI answers are visible to every participant.
 * Writes mirror User Data Functions: messages are append-only, every post is logged for A-05 history,
 * and each post creates in-app notifications (plus a simulated email when ticked). */
(function () {
  'use strict';
  const A = window.App;
  const t = (...x) => A.t(...x);

  /* ============================================================ AI settings */
  const PROVIDERS = [
    { id: 'anthropic', name: 'Anthropic (Claude)', models: [
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
    ] },
  ];
  // Official SDK, loaded only when a key is set (pinned version; the browser calls the API directly with the user's own key).
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm';
  const SS = 'aims.ai.';
  const mem = {}; // fallback when sessionStorage is blocked
  const ssGet = (k) => { try { return sessionStorage.getItem(SS + k); } catch (e) { return mem[k] ?? null; } };
  const ssSet = (k, v) => {
    try { if (v === null) sessionStorage.removeItem(SS + k); else sessionStorage.setItem(SS + k, v); } catch (e) { if (v === null) delete mem[k]; else mem[k] = v; }
  };
  const settings = {
    get provider() { return ssGet('provider') || PROVIDERS[0].id; },
    set provider(v) { ssSet('provider', v); },
    get model() { const p = PROVIDERS.find((x) => x.id === settings.provider) || PROVIDERS[0]; const m = ssGet('model'); return p.models.some((x) => x.id === m) ? m : p.models[0].id; },
    set model(v) { ssSet('model', v); },
    get key() { return ssGet('key') || ''; },
    set key(v) { ssSet('key', v || null); },
  };
  const modelName = (id) => PROVIDERS.flatMap((p) => p.models).find((m) => m.id === id)?.name || id;

  /** AI settings bar (provider · model · API key) shared by C-03 and the C-01 panel; one key serves both. */
  function aiBarHtml() {
    const { esc } = A;
    const s = settings;
    const prov = PROVIDERS.find((p) => p.id === s.provider) || PROVIDERS[0];
    const keyState = s.key
      ? `<span class="tag ps-ON_TRACK">✓ ${esc(t('c3_key_set'))}</span> <button class="linkbtn" data-key-clear>${esc(t('c3_key_clear'))}</button>`
      : `<input type="password" data-ai-key placeholder="${esc(t('c3_key_ph'))}" autocomplete="off" spellcheck="false" aria-label="${esc(t('c3_key'))}"><button class="btn small" data-key-save>${esc(t('c3_key_save'))}</button>`;
    return `<div class="c3-aibar">
      <span class="ai-who">AI</span>
      <label class="ctl">${esc(t('c3_provider'))} <select data-ai-provider>${PROVIDERS.map((p) => `<option value="${p.id}" ${p.id === prov.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="ctl">${esc(t('c3_model'))} <select data-ai-model>${prov.models.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <span class="ctl">${esc(t('c3_key'))} ${keyState}</span>
      <span class="hint c3-keyhint">${esc(s.key ? t('c3_key_hint_set') : t('c3_key_hint'))}</span>
    </div>`;
  }
  /** Wire the bar inside root. before(): save unsent text before the page re-renders. */
  function bindAiBar(root, before = () => {}) {
    const rerender = () => { before(); A.render(); };
    const prov = root.querySelector('[data-ai-provider]');
    if (prov) prov.addEventListener('change', () => { settings.provider = prov.value; rerender(); });
    const model = root.querySelector('[data-ai-model]');
    if (model) model.addEventListener('change', () => { settings.model = model.value; rerender(); });
    const save = root.querySelector('[data-key-save]');
    const keyIn = root.querySelector('[data-ai-key]');
    if (save) save.addEventListener('click', () => {
      const v = keyIn.value.trim();
      if (!v) return;
      settings.key = v; rerender(); A.toast(t('c3_key_saved'));
    });
    if (keyIn) keyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    const clr = root.querySelector('[data-key-clear]');
    if (clr) clr.addEventListener('click', () => { settings.key = ''; rerender(); });
  }

  /* ============================================================ thread data */
  const db = () => A.db;
  const thread = (actionId) => db().app_chat_thread.find((x) => x.action_id === actionId);
  const messages = (actionId) => {
    const th = thread(actionId);
    return th ? db().app_chat_message.filter((m) => m.thread_id === th.thread_id).sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at))) : [];
  };
  const participants = (actionId) => {
    const th = thread(actionId);
    return th ? db().app_chat_participant.filter((p) => p.thread_id === th.thread_id).map((p) => p.user_id) : [];
  };
  const isParticipant = (actionId, userId = A.state.userId) => participants(actionId).includes(userId);
  const scopesOf = (userId) => db().app_user_org_scope.filter((s) => s.user_id === userId);
  /** Users who can see the Action: their scope covers the owning org (upper / same) or sits inside it (staff). */
  const canSee = (a, userId) => scopesOf(userId).some((s) => A.M.inScope(a.owner_org_id, s.org_id) || A.M.inScope(s.org_id, a.owner_org_id));
  /** Managers of a chat: the user who started it, plus authorized users (decision right over the owning organization). */
  const canManage = (a) => {
    const th = thread(a.action_id);
    return !!th && (th.created_by === A.state.userId || scopesOf(A.state.userId).some((s) => s.can_decide_action && A.M.inScope(a.owner_org_id, s.org_id)));
  };
  /** One chat per adopted Action; any user who can see the Action may start it (nothing is created automatically). */
  const canStart = (a) => !thread(a.action_id) && a.decision_state === 'ADOPTED' && canSee(a, A.state.userId);
  /** People who can be invited: users who can see the Action and are not in the chat yet. */
  const candidates = (a) => db().app_user.filter((u) => u.user_id !== A.state.userId && !isParticipant(a.action_id, u.user_id) && canSee(a, u.user_id)).map((u) => u.user_id);

  const firstName = (userId) => String(A.userName(userId)).split(/[\s(]/)[0];
  /** @mentions: "@Tanaka" matches the first word of a participant's display name; "@AI" asks the AI. */
  function parseMentions(body, actionId) {
    const words = [...String(body).matchAll(/@([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase());
    const users = participants(actionId).filter((u) => words.includes(firstName(u).toLowerCase()));
    return { users, ai: words.includes('ai') };
  }

  function newId(prefix, list) { return `${prefix}-L${list.length + 1}`; }
  /** fromId: who caused it (the bell names this person; INVITE comes from a SYSTEM message). */
  function notify(userIds, msg, kind, fromId = msg.author_id) {
    const list = db().app_notification || (db().app_notification = []);
    userIds.forEach((u) => list.push({ notification_id: newId('NT', list), user_id: u, thread_id: msg.thread_id, message_id: msg.message_id, kind, from_id: fromId || null,
      email_sent: !!msg.email_notified, created_at: msg.sent_at, read_at: null }));
  }

  /**
   * Post to an existing Action chat. type: MESSAGE | AI (an AI answer, visible to every participant) | SYSTEM.
   * AI messages keep the requester as author_id; ai_question is the question, or 'SUMMARY' for the Summarize button.
   * notifyKind: override the notification kind; null = no notification (e.g. the AI reply right after its @AI question).
   * Returns { msg, recipients } — recipients are the participants who get a notification (and the email if ticked).
   */
  function post(actionId, { body, type = 'MESSAGE', email = false, aiQuestion = null, aiModel = null, aiUnverified = null, lang = A.state.lang, notifyKind }) {
    const th = thread(actionId);
    if (!th) return { msg: null, recipients: [] };
    const author = type === 'SYSTEM' ? null : A.state.userId;
    // An AI answer may quote "@Name" from the thread; only people's own text creates mentions.
    const ment = type === 'MESSAGE' ? parseMentions(body, actionId) : { users: [], ai: false };
    const msg = { message_id: newId('MS', db().app_chat_message), thread_id: th.thread_id, author_id: author, message_type: type, body,
      mentions: ment.users.join(','), email_notified: !!email, due_date: null, sent_at: A.nowIso(), language_code: lang, ai_question: aiQuestion, ai_model: aiModel,
      ai_unverified: aiUnverified && aiUnverified.length ? aiUnverified.join(', ') : null };
    db().app_chat_message.push(msg);
    A.audit(actionId, `CHAT_${type}`, type === 'AI' ? `${aiQuestion === 'SUMMARY' ? 'Summarize' : aiQuestion} → ${body}` : body, author ? 'USER' : 'SYSTEM');
    const recipients = notifyKind === null ? [] : participants(actionId).filter((u) => u !== author);
    const mentioned = recipients.filter((u) => ment.users.includes(u));
    notify(mentioned, msg, 'MENTION');
    notify(recipients.filter((u) => !mentioned.includes(u)), msg, notifyKind || (type === 'AI' ? 'AI' : type === 'SYSTEM' ? 'SYSTEM' : 'MESSAGE'));
    if (author) markRead(actionId, author);
    return { msg, recipients };
  }

  /**
   * Start the Action's chat: the starter becomes its first participant and invites the others.
   * Every invitee always gets an email plus an in-app INVITE notification (not optional).
   */
  function startThread(actionId, inviteIds) {
    const email = true;
    const a = A.M.action(actionId);
    if (!canStart(a)) return null;
    const me = A.state.userId;
    const th = { thread_id: `TH-${actionId}`, action_id: actionId, created_by: me, created_at: A.nowIso() };
    db().app_chat_thread.push(th);
    const invited = [...new Set(inviteIds)].filter((u) => u !== me && canSee(a, u));
    [me, ...invited].forEach((u) => db().app_chat_participant.push({ thread_id: th.thread_id, user_id: u, added_by: me }));
    const res = post(actionId, { body: t('c3_sys_started', { by: A.userName(me), u: invited.map((u) => A.userName(u)).join(', ') || '–' }), type: 'SYSTEM', email, notifyKind: null });
    notify(invited, res.msg, 'INVITE', me);
    markRead(actionId, me);
    return { msg: res.msg, recipients: invited };
  }

  /** Invite one more person later; like at the start, the invitee always gets an email plus an INVITE notification. */
  function addParticipant(actionId, userId) {
    const a = A.M.action(actionId);
    if (!canManage(a) || isParticipant(actionId, userId)) return null;
    db().app_chat_participant.push({ thread_id: thread(actionId).thread_id, user_id: userId, added_by: A.state.userId });
    const res = post(actionId, { body: t('c3_sys_added', { u: A.userName(userId), by: A.userName(A.state.userId) }), type: 'SYSTEM', email: true, notifyKind: null });
    notify([userId], res.msg, 'INVITE', A.state.userId);
    return { msg: res.msg, recipients: [userId] };
  }
  function removeParticipant(actionId, userId) {
    const a = A.M.action(actionId);
    if (!canManage(a) || userId === A.state.userId) return false;
    const th = thread(actionId);
    const i = db().app_chat_participant.findIndex((p) => p.thread_id === th.thread_id && p.user_id === userId);
    if (i < 0) return false;
    db().app_chat_participant.splice(i, 1);
    post(actionId, { body: t('c3_sys_removed', { u: A.userName(userId), by: A.userName(A.state.userId) }), type: 'SYSTEM', notifyKind: null });
    return true;
  }

  /** Opening a thread marks its messages and notifications as read for that user (unread badges on A-03 / A-05 / bell). */
  function markRead(actionId, userId = A.state.userId) {
    const th = thread(actionId);
    const last = messages(actionId).slice(-1)[0];
    if (!th || !last) return;
    const rd = db().app_chat_read.find((x) => x.thread_id === th.thread_id && x.user_id === userId);
    if (rd) rd.last_read_message_id = last.message_id; else db().app_chat_read.push({ thread_id: th.thread_id, user_id: userId, last_read_message_id: last.message_id });
    (db().app_notification || []).filter((n) => n.user_id === userId && n.thread_id === th.thread_id && !n.read_at).forEach((n) => { n.read_at = A.nowIso(); });
  }

  /* ========================================================== notifications */
  const myNotifications = (userId = A.state.userId) => (db().app_notification || []).filter((n) => n.user_id === userId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const actionOfThread = (threadId) => (db().app_chat_thread.find((x) => x.thread_id === threadId) || {}).action_id;
  const fmtWhen = (iso) => new Intl.DateTimeFormat(I18N.locale(), { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

  function bellHtml() {
    const n = myNotifications().filter((x) => !x.read_at).length;
    return `<div class="bell-wrap"><button class="bell" data-bell title="${A.esc(t('c3_notifications'))}" aria-label="${A.esc(t('c3_notifications'))}">🔔${n ? `<b>${n}</b>` : ''}</button></div>`;
  }
  function bellMenu() {
    const { esc } = A;
    const list = myNotifications().slice(0, 10);
    const rows = list.map((n) => {
      const msg = db().app_chat_message.find((m) => m.message_id === n.message_id) || {};
      const act = actionOfThread(n.thread_id);
      const who = n.from_id ? A.userName(n.from_id) : msg.author_id ? A.userName(msg.author_id) : t('by_system');
      return `<button class="bell-item ${n.read_at ? '' : 'unread'}" data-notif="${n.notification_id}">
        <span class="small">${esc(t('c3_nk_' + n.kind, { who, id: act }))}</span>
        <span class="bell-snip">${esc(String(msg.body || '').slice(0, 90))}</span>
        <span class="hint">${esc(fmtWhen(n.created_at))}${n.email_sent ? ' · ✉ ' + esc(t('c3_email_too')) : ''}</span></button>`;
    }).join('');
    return `<div class="bell-menu" role="menu"><div class="bell-h">${esc(t('c3_notifications'))}</div>${rows || `<div class="muted small" style="padding:10px">${esc(t('c3_no_notif'))}</div>`}</div>`;
  }
  document.addEventListener('click', (e) => {
    const bell = e.target.closest('[data-bell]');
    const open = document.querySelector('.bell-menu');
    if (bell) {
      if (open) { open.remove(); return; }
      bell.parentElement.insertAdjacentHTML('beforeend', bellMenu());
      return;
    }
    const item = e.target.closest('[data-notif]');
    if (item) {
      const n = myNotifications().find((x) => x.notification_id === item.dataset.notif);
      if (n) { n.read_at = n.read_at || A.nowIso(); A.go('C03', { actionId: actionOfThread(n.thread_id) }); }
      return;
    }
    if (open && !e.target.closest('.bell-menu')) open.remove();
  });

  /** Simulated email (the real app sends it through Power Automate / Microsoft Graph with the same deep link). */
  function emailPreview(msg, recipients) {
    const { esc } = A;
    const sender = msg.author_id || A.state.userId;
    const act = actionOfThread(msg.thread_id);
    const a = A.M.action(act);
    const link = `${location.origin === 'null' ? 'file://' : location.origin}${location.pathname}#C03:${act}`;
    const to = recipients.map((u) => db().app_user.find((x) => x.user_id === u)).filter(Boolean);
    A.openModal(`<header><h3>✉ ${esc(t('c3_email_title'))}</h3><button class="btn ghost x" data-close>✕</button></header>
      <div class="body">
        <div class="mail">
          <div><span class="muted">${esc(t('c3_mail_to'))}</span> ${to.map((u) => `${esc(u.display_name)} &lt;${esc(u.email)}&gt;`).join(', ')}</div>
          <div><span class="muted">${esc(t('c3_mail_subject'))}</span> [${esc(t('app_title'))}] ${esc(act)} ${esc(A.actionNamePlain(a))} — ${esc(t(msg.message_type === 'AI' ? 'c3_mail_subj_ai' : msg.message_type === 'SYSTEM' ? 'c3_mail_subj_invite' : 'c3_mail_subj', { who: A.userName(sender) }))}</div>
          <hr>
          ${msg.message_type === 'AI' ? `<p class="muted">${esc(msg.ai_question === 'SUMMARY' ? t('c3_ai_summary_by', { who: A.userName(sender) }) : t('c3_ai_asked', { who: A.userName(sender) }) + ' ' + msg.ai_question)}</p>` : ''}
          <p style="white-space:pre-wrap">${esc(msg.body)}</p>
          <p><a href="#C03:${esc(act)}" data-close>${esc(t('c3_mail_open'))}</a><br><span class="hint">${esc(link)}</span></p>
        </div>
        <p class="hint">${esc(t('c3_mail_note'))}</p>
      </div>
      <footer><button class="btn primary" data-close>OK</button></footer>`, { small: false });
  }

  /* ================================================================== AI */
  const LANG_EN = { en: 'English', ja: 'Japanese', th: 'Thai', 'zh-Hans': 'Simplified Chinese', 'zh-Hant': 'Traditional Chinese', id: 'Indonesian', vi: 'Vietnamese' };
  const isoDay = (iso) => String(iso).slice(0, 16).replace('T', ' ');

  /** The only facts the AI may use: this Action's figures, assessment, history and thread (all from the mock data). */
  function actionContext(actionId) {
    const { M, state } = A;
    const a = M.action(actionId);
    const pid = state.periodId;
    const prevLang = I18N.get(); I18N.set('en'); // the data block is always English; the AI answers in the viewer's language
    try {
      const prog = M.actionProgress(actionId, pid);
      const pt = M.point(a.point_id);
      const lines = [];
      lines.push(`Action: ${a.action_id} "${A.actionNamePlain(a)}"`);
      lines.push(`Description: ${A.aiPlain(a.description_comment_id) || a.description || '-'}`);
      lines.push(`Point: ${a.point_id}${pt ? ` "${A.aiPlain(pt.title_comment_id)}"` : ''}`);
      lines.push(`Owning organization: ${A.orgName(a.owner_org_id)}`);
      lines.push(`Execution period: ${A.periodLabel(a.start_period_id)} to ${A.periodLabel(a.end_period_id)}`);
      lines.push(`As of: ${A.periodLabel(pid)} (latest closed month in the app: ${A.periodLabel(M.latestClosed())})`);
      lines.push(`Decision: ${a.decision_state}; execution state: ${a.execution_state}`);
      lines.push(`Progress: ${prog ? prog.progress_pct : 0}% (expected by now from the schedule: ${M.expectedProgress(a, pid)}%); AI status: ${prog ? prog.ai_status : 'none'}`);
      lines.push('Effect figures (JPY million, favorable effect is positive):');
      M.actionTargets(actionId).forEach((m) => {
        const tot = M.actionTotals(actionId, pid, m);
        lines.push(`- ${t(m)}: plan full year ${tot.planAnnual}; plan to date ${tot.planToDate}; actual to date ${tot.actualToDate}; year-end outlook ${tot.outlookFY}`);
      });
      const tg = M.actionTargets(actionId);
      const mm = tg.includes('OP') ? 'OP' : tg[0];
      lines.push(`Monthly ${t(mm)} effect (plan / actual or outlook):`);
      M.actionMonthly(actionId, mm, pid).forEach((r) => lines.push(`- ${A.periodLabel(r.period_id)}: plan ${r.plan}; ${r.isActual ? 'actual' : 'outlook'} ${r.value === null ? '-' : r.value}`));
      const assessed = db().app_action_progress.filter((p) => p.action_id === actionId && p.period_id <= pid && p.comment_id).sort((x, y) => y.period_id - x.period_id)[0];
      if (assessed) lines.push(`Latest AI assessment (${A.periodLabel(assessed.period_id)}): ${A.aiPlain(assessed.comment_id)}${prog && prog.assessment_stale ? ' (progress was updated afterwards; the assessment is pending a re-run)' : ''}`);
      const meas = M.actionMeasurement(actionId);
      if (meas) lines.push(`Measurement: baseline ${meas.baseline_method}; formula ${meas.formula}`);
      const excl = [...new Set(M.actionExclusions(actionId).map((x) => x.factor_id))];
      lines.push(`Excluded Factors: ${excl.length ? excl.map((id) => `${id} ${A.aiPlain(`CM-FTITLE-${id}`)}`).join('; ') : 'none'}`);
      lines.push('History (oldest first):');
      db().app_audit_event.filter((e) => e.resource_id === actionId && !String(e.event_type).startsWith('CHAT'))
        .sort((x, y) => String(x.occurred_at).localeCompare(String(y.occurred_at)))
        .forEach((e) => lines.push(`- ${isoDay(e.occurred_at)} ${e.event_type} by ${e.actor_type === 'USER' ? A.userName(e.actor_id) : e.actor_type}: ${e.new_value}`));
      lines.push(`Participants: ${participants(actionId).map((u) => A.userName(u)).join(', ')}`);
      lines.push('Thread messages (oldest first):');
      messages(actionId).slice(-40).forEach((m) => lines.push(`- ${isoDay(m.sent_at)} ${m.author_id ? A.userName(m.author_id) : 'System'}${m.message_type === 'AI' ? ' (AI answer to: ' + (m.ai_question === 'SUMMARY' ? 'Summarize' : m.ai_question) + ')' : m.message_type === 'PROGRESS_REQUEST' ? ' (progress request, due ' + m.due_date + ')' : ''}: ${m.body}`));
      return lines.join('\n');
    } finally { I18N.set(prevLang); }
  }

  function systemPrompt(kind, lang) {
    const viewer = A.userName(A.state.userId);
    const task = {
      ASK: `Answer the question from ${viewer}.`,
      SUMMARY: `Summarize the current status of this Action for ${viewer}: where it stands against plan, what the thread says, and any open request. 3 to 5 sentences.`,
      DRAFT: `Draft the next message that ${viewer} could post in this thread, written in the first person as ${viewer}, ready to send. Respond to the latest open points in the thread. Output only the message text.`,
    }[kind];
    return [
      'You are the AI assistant inside the Action chat (screen C-03) of a performance management app. People use this thread to talk about one improvement Action. Your answer is posted in the thread and every participant reads it.',
      'Rules:',
      '1. Talk only about this Action: its progress, effect, plan, history and the conversation in the thread. If asked about anything else, reply in one sentence that this chat is for this Action and suggest the AI chat (C-01) for other questions.',
      '2. Use only figures that appear in the ACTION DATA. Quote them as given, in JPY million. Never estimate, forecast, recalculate, add up or invent a number, and do not answer what-if questions with numbers. If a question needs a new number (for example "what if it starts in August?"), say the app has not calculated it and suggest updating progress on A-03, which recalculates the outlook.',
      '3. If the data does not contain the answer, say so plainly.',
      `4. Write in ${LANG_EN[lang] || 'English'}. Plain text only: no markdown headings, tables or bold. Keep it under about 120 words.`,
      `Task: ${task}`,
    ].join('\n');
  }

  let sdkPromise = null;
  const loadSdk = () => (sdkPromise = sdkPromise || import(SDK_URL).then((mod) => mod.default || mod.Anthropic).catch((e) => { sdkPromise = null; throw e; }));

  /** Numbers in an AI answer that are not in the Action data (rule 2 check, flagged on the posted answer for everyone). */
  function unknownNumbers(answer, context) {
    const strip = (s) => String(s).replace(/\b(?:ACT|PT|FV|FC|EV|MS|TH)-[\w-]+/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{1,2}[/:]\d{1,2}\b/g, ' ').replace(/\b20\d{2}\b/g, ' ');
    const nums = (s) => [...strip(s).matchAll(/[-−]?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace('−', '-').replace(',', '.'))).filter((n) => !Number.isNaN(n));
    const known = nums(context);
    const ok = (n) => Math.abs(n) <= 12 && Number.isInteger(n) || known.some((k) => Math.abs(Math.abs(k) - Math.abs(n)) < 0.051);
    return [...new Set(nums(answer).filter((n) => !ok(n)))];
  }

  /** Pre-written reply when no API key is set — built only from the same Action data. */
  function demoReply(kind, actionId) {
    const { M, state, fmt } = A;
    const a = M.action(actionId);
    const tg = M.actionTargets(actionId);
    const m = tg.includes('OP') ? 'OP' : tg[0];
    const tot = M.actionTotals(actionId, state.periodId, m);
    const prog = M.actionProgress(actionId, state.periodId);
    // Latest human message, not the @AI question being answered or an earlier AI answer.
    const msgs = messages(actionId).filter((x) => x.message_type !== 'SYSTEM' && x.message_type !== 'AI' && !/@AI\b/i.test(x.body));
    const last = msgs.slice(-1)[0];
    const v = { id: a.action_id, name: A.actionNamePlain(a), status: prog ? t('ps_' + prog.ai_status) : t('e_' + a.execution_state), p: prog ? prog.progress_pct : 0,
      e: M.expectedProgress(a, state.periodId), metric: t(m), a: fmt(tot.actualToDate, 2), pt: fmt(tot.planToDate, 2), o: fmt(tot.outlookFY, 2), pa: fmt(tot.planAnnual, 2),
      who: last ? (last.author_id ? A.userName(last.author_id) : t('by_system')) : '', last: last ? String(last.body).slice(0, 80) : '' };
    const summary = t('c3_demo_summary', v) + (last ? ' ' + t('c3_demo_last', v) : '');
    if (kind === 'SUMMARY') return summary;
    if (kind === 'DRAFT') return t('c3_demo_draft', v);
    return t('c3_demo_ask') + ' ' + summary;
  }

  /**
   * Ask the AI. kind: ASK | SUMMARY | DRAFT. onText(snapshot) streams the text.
   * Resolves { text, model, demo, unknown[] }; rejects with a readable message.
   */
  async function ask(actionId, kind, question, onText) {
    const context = actionContext(actionId);
    const lang = A.state.lang;
    if (!settings.key) {
      const text = demoReply(kind, actionId);
      for (let i = 0; i <= text.length; i += 6) { onText(text.slice(0, i)); await new Promise((r) => setTimeout(r, 12)); }
      onText(text);
      return { text, model: null, demo: true, unknown: [] };
    }
    let Anthropic;
    try { Anthropic = await loadSdk(); } catch (e) { throw new Error(t('c3_err_sdk')); }
    const client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true });
    const model = settings.model;
    const body = {
      model, max_tokens: 1024,
      system: systemPrompt(kind, lang) + '\n\nACTION DATA\n' + context,
      messages: [{ role: 'user', content: question || (kind === 'SUMMARY' ? 'Summarize this Action.' : 'Draft my next reply.') }],
    };
    if (model === 'claude-haiku-5-5') body.thinking = { type: 'disabled' }; // quick chat replies; other models keep their default
    try {
      const stream = client.messages.stream(body);
      stream.on('text', (_d, snap) => onText(snap));
      const final = await stream.finalMessage();
      if (final.stop_reason === 'refusal') throw new Error(t('c3_err_refusal'));
      const text = final.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      return { text, model, demo: false, unknown: unknownNumbers(text, context) };
    } catch (e) {
      if (e && e.status === 401) throw new Error(t('c3_err_key'));
      if (e && e.status === 429) throw new Error(t('c3_err_rate'));
      throw new Error(e && e.message ? e.message : String(e));
    }
  }

  /* =========================================================== translation */
  const translations = () => db().app_chat_message_text || (db().app_chat_message_text = []);
  const storedTranslation = (messageId, lang) => translations().find((x) => x.message_id === messageId && x.language_code === lang);
  async function translate(msg, lang) {
    const hit = storedTranslation(msg.message_id, lang);
    if (hit) return hit.body;
    if (!settings.key) throw new Error(t('c3_tr_needs_key'));
    const Anthropic = await loadSdk().catch(() => { throw new Error(t('c3_err_sdk')); });
    const client = new Anthropic({ apiKey: settings.key, dangerouslyAllowBrowser: true });
    const body = { model: settings.model, max_tokens: 1024,
      system: `Translate the chat message into ${LANG_EN[lang] || lang}. Keep names, IDs, numbers and @mentions unchanged. Output only the translation.`,
      messages: [{ role: 'user', content: msg.body }] };
    if (settings.model === 'claude-haiku-5-5') body.thinking = { type: 'disabled' };
    try {
      const res = await client.messages.create(body);
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
      translations().push({ message_id: msg.message_id, language_code: lang, body: text, translated_by: 'AI', translated_at: A.nowIso() });
      return text;
    } catch (e) {
      if (e && e.status === 401) throw new Error(t('c3_err_key'));
      throw new Error(e && e.message ? e.message : String(e));
    }
  }

  A.Chat = {
    PROVIDERS, settings, modelName, aiBarHtml, bindAiBar, loadSdk, LANG_EN, unknownNumbers, thread, messages, participants, isParticipant, canManage, canStart, candidates, parseMentions,
    post, startThread, addParticipant, removeParticipant, markRead, bellHtml, emailPreview, ask, translate, storedTranslation, actionContext, firstName, fmtWhen,
  };
})();
