# AI Management System: project overview

*Last updated: 19 Nov 2026. Repository: `BBS-Thailand/AI_Performance` (branch `main`).*

This page explains what the app is, how the mockup is built, and the main decisions behind it. It is written for anyone joining the project and for picking the work up again later. For the detailed specification see `README.md` (requirements), `docs/data-model.md` (tables and measures) and `mockup/README.md` (how to run the mockup).

---

## 1. What the app is

A multilingual **AI Management System** for monthly performance management, built to run on **Microsoft Fabric**. It connects the whole management cycle in one place:

1. See the month's results against budget (KPIs) and the **Insights** the AI found (issues and opportunities).
2. Open an Insight to see why it happened (causes) and which **Actions** are proposed.
3. Adopt, reject or hold Actions and assign each to one organization.
4. Track Action progress; the financial effect is **measured automatically** from accounting data.
5. Forecast the year-end landing from an ML model plus adopted Actions plus **Individual Factors**.
6. Confirm forecast versions, analyse the numbers (BI) and print standard reports.

**Core rule:** every screen shows the same figures for the same period and organization, and each user only sees the organizations they are authorized for.

**Status today:** a clickable HTML **mockup** with simulated data covers every screen. The production build on Fabric has not started yet.

---

## 2. Screens

The app has three menus plus common functions. Screen IDs come from the concept deck (`AI-PerformanceManagement_UI-Concept_v0_36.pptx`, slides 29–56) and are used everywhere: tickets, tests, docs.

| Menu | ID | Screen | What it does |
|---|---|---|---|
| AI analysis | **A-01** | AI Insights (home) | KPI cards, AI summary, the **Insight** list (issues / opportunities) |
| AI analysis | **A-02** | Insight Detail | Impact on all 4 Metrics, waterfall and monthly graphs, causes, Action proposals and decisions |
| AI analysis | **P-01** | Action detail (pop-up) | Define or add an Action; the AI calculates the effect and how it is measured |
| AI analysis | **A-03** | Action Board | Adopted Actions of an organization, progress, status |
| AI analysis | **A-04** | Effect Overview | Action effects stacked by month |
| AI analysis | **A-05** | Action Status | One Action: measured effect, outlook, AI assessment, history |
| AI analysis | **C-03** | Action chat | Chat per adopted Action, invitations, email and bell notifications, AI help |
| Forecast | **F-01** | Forecast | Year-end landing in three options, landing breakdown, AI comment, confirmed versions |
| Forecast | **P-02** | Individual Factor (pop-up) | Add a change not caused by an Action (FX, price, one-off event…) |
| BI+Reporting | **B-01** | BI Analysis | Pivot analysis by dimensions and measures |
| BI+Reporting | **B-02** | Reporting | Nine standard reports with an AI comment |
| Common | **C-01** | AI chat | Right-side AI assistant on every screen, linked to that screen's data |
| Common | **FN-01** | Screen output | Export the current screen to PDF or its tables to Excel |
| Common | **FN-02** | Formatted output | Predefined report templates (not built yet) |

**Shared header on every screen:** fiscal period, organization (limited to the user's scope), language (English, Japanese, Thai, Simplified/Traditional Chinese, Indonesian, Vietnamese), Screen output, Formatted output, AI chat, the 💬 Action-chat list and the 🔔 notification bell.

### Words used in the app

| Term | Meaning |
|---|---|
| **Metric** | Revenue, Gross profit, SG&A, Operating profit (OP = GP − SG&A) |
| **Insight** | An issue or opportunity the AI found, e.g. "Volume decline at Customer B". IDs `IS-001` (company) and `IS-001-SL` (per department). Called "Point" in the concept deck and inside the data model (`app_point`). |
| **Action** | A measure to address an Insight, e.g. `ACT-001-SL-A01` (Insight 001, Sales Dept., AI proposal 1; `U` = user-created) |
| **Individual Factor** | A forecast change not caused by an Action, e.g. `EV-001` exchange rate |
| **Landing** | The forecast year-end figure |

---

## 3. How it works on Fabric (target architecture)

```text
 Accounting P&L API ─► Pipeline ─► Lakehouse (Bronze → Silver → Gold: dim_*, fact_financial)
                                        │
 ML notebook (forecast baseline) ───────┤
                                        ▼
            Semantic model (Direct Lake): measures + row-level security
                    ▲                               ▲
 Fabric SQL database (app_* tables:                 │
 Insights, Actions, Factors, forecast versions,     │
 AI comments, chat, audit) ── mirrored ─────────────┘
                    ▲
          User Data Functions (validated writes)
                    ▲
           Fabric App (web screens A-01 … B-02, C-01)
```

| Layer | Where | Written by | Read by |
|---|---|---|---|
| Financial figures (gold) | Lakehouse Delta tables | Pipeline + notebook | Semantic model |
| App data (Insights, Actions, chat…) | Fabric SQL database | User Data Functions, AI jobs | Semantic model, app |
| AI output (comments) | Fabric SQL database | Monthly AI job | Semantic model, app |

- **Measures** (Actual, Budget, Variance, Landing…) are defined once in the semantic model so all screens agree. The mockup has a JavaScript copy of them (`mockup/js/measures.js`), which is the reference for the DAX.
- **Reconciliation tests** must pass in both mockup and production, for example: departments add up to the company, Insight impacts + "Other" = variance, OP = GP − SG&A, Landing = Baseline + Actions + Factors, and the same Action totals on A-03, A-04, A-05 and F-01. Full list: `docs/data-model.md` §6.

---

## 4. Key concept decisions

### 4.1 One AI, called directly by API
- **Claude (Anthropic API)** is the only AI: for the monthly analysis, the forecast explanation and both chats. A Fabric data agent was rejected because two different AIs could give different answers.
- In production the API key lives in **Azure Key Vault** and is used only server-side. In the mockup each user pastes their own key; it stays in the browser tab (sessionStorage).
- Default model: Claude Haiku 5.5 (fast, cheap). Sonnet and Opus can be chosen.

### 4.2 The AI never invents numbers
- The AI reads figures only through **read-only tools** that use the same measures as the screens. Answers cite their source and offer [Open …] buttons to the screen.
- Any figure in an answer that does not come from the tool data is flagged.
- **What-if** (e.g. "what if this Action is stopped?") is calculated by the app; the AI only explains the result.
- The AI does not write anything in v1 (no adopting Actions, no edits).

### 4.3 Forecast: ML for numbers, AI for words
- An **ML model** (regression in a Fabric notebook) produces the forecast **without Actions**. The AI only explains it.
- Three options: ① without Actions, ② + adopted Actions, ③ + Individual Factors = **Landing**.
- Only **adopted** Actions count. Their contribution = measured actual (closed months) + outlook from progress (open months).
- Individual Factors come from a **fixed list**: driver types (FX, volume, price, material) are converted through the model's sensitivity; event types (order delay, launch, one-off) take monthly amounts.
- Ticking factors recalculates in the browser; **Save (confirm)** freezes a version. The company forecast = sum of each department's latest confirmed version.
- The F-01 AI comment explains the landing and the main drivers in plain words, e.g. "If the selling price rises by 1%, revenue would increase by about 23.3M and operating profit by about 23.3M."

### 4.4 Action effects are measured, not typed
- Users enter **progress %** only. The effect is measured from accounting data.
- Whether users may ever enter an actual effect, and how an Action is "closed", is **on hold** until the concept is discussed with others.

### 4.5 C-03 Action chat
- One chat per **adopted** Action. It is not created automatically: a user starts it and invites people. The starter and users with decision rights can invite or remove people later.
- Every invitee always gets an **email** and a **bell** notification.
- `@AI` questions and **Summarize** answers are visible to all participants; **Draft reply** stays private.
- The AI quotes only the Action's existing figures. Messages cannot be edited or deleted (audit record). Each message has a Translate button.
- The 💬 header menu lists the chats a user can open, with unread counts.

### 4.6 C-01 AI chat
- Opens from the header on every screen. It knows the screen's period, organization and data, **plus related data** (e.g. on SG&A: its accounts, the OP formula, breakdowns, Insights, Actions, Forecast).
- It cannot roam into other organizations or fiscal years outside the user's scope.
- Without an API key, 3–4 suggested questions per screen still work (prepared answers from the same tools).

### 4.7 Users and access on Fabric
- **Three layers:** (1) Microsoft Entra ID sign-in; (2) Entra security groups, **managed by IT**, decide who can open the app; (3) inside the app, **Corporate Planning** maintains which organizations each person sees and what they may do.
- One tenant per app. Business users get Viewer-level access in Fabric only; workspace Admin/Member/Contributor roles bypass row-level security, so business users must never hold them.
- Roles: Corporate Planning, Organization head, Action owner. A separate read-only role is an **open question** (it is not in the requirements).
- Rights per organization: can edit (progress, Factors, new Actions), can decide Actions, can confirm the Forecast.
- **First sign-in:** view-only on the person's home organization until Corporate Planning sets the real scope.
- Users are never deleted, only deactivated, so decisions and chats stay linked. Every write is re-checked on the server.

---

## 5. The mockup

**Run it:** open `mockup/index.html` in a browser (no server needed). Deep links: `index.html#A02:IS-001`, `#A05:ACT-001-SL-A01`, `#C03:ACT-001-SL-A01`. It is also published on GitHub Pages (add the link here).

**Demo users** (switch in the header to see permissions): Sato (Corporate Planning), Tanaka (Sales Dept. Head), Somchai (Overseas Sales Head), Suzuki (Manufacturing Head), Nittaya (Administration Head), Yamada (Sales Staff).

**Sample company:** Sample Corporation with Sales, Overseas Sales, Manufacturing and Administration departments, fiscal year April–March, figures in JPY millions, closed months Apr–Jun 2027. The company figures match the concept deck (e.g. Jun 2027 YTD Operating profit 86 vs budget 98).

**How it is built**

| Path | Purpose |
|---|---|
| `mockup/tools/generate-mock-data.mjs` | Creates all simulated tables; **refuses to write data if any reconciliation check fails** |
| `mockup/data/*.json`, `mock-db.js` | One file per table (same tables as the Fabric design) |
| `mockup/js/measures.js` | Measures (stand-in for the semantic model) |
| `mockup/js/app.js` | Header, global context, charts, permissions, decisions |
| `mockup/js/screens/*.js` | One file per screen |
| `mockup/js/aichat.js`, `chat.js` | C-01 AI chat and C-03 Action chat (Claude via the official SDK) |
| `mockup/js/export.js` | FN-01 PDF / Excel export |
| `mockup/js/i18n.js` | Screen text in 7 languages |

Regenerate data: `node mockup/tools/generate-mock-data.mjs`. Changes made in the mockup stay in memory only; **Reset demo data** starts over.

**Way of working:** Ren builds and decides on `main`; a colleague works on the `bi-report` / `screen-output` branches (B-01/B-02 and FN-01 came from there). Always fetch before pushing; never force-push.

---

## 6. Timeline

| Date | Milestone |
|---|---|
| 11 Nov 2026 | Repository created |
| 12 Nov | Requirements README from the concept deck; data model draft; stage 1 mockup (A-01, A-02, P-01, decisions, permissions) |
| 13–16 Nov | Stage 2 (A-03, A-04, A-05) and stage 3 (F-01 forecast with ML options, P-02 Factors, versions) |
| 17 Nov | C-03 Action chat; FN-01 export (PDF, Excel); B-01 / B-02; C-01 AI chat on every screen; AI reply language fixed per UI language |
| 18 Nov | Fabric user-access model; 💬 chat list in the header; A-02 "Insight Detail" with waterfall graphs for every affected Metric; "Point" renamed to "Insight" (IDs `IS-`); F-01 comment explains the drivers in plain words |

---

## 7. Open items

| Item | Status |
|---|---|
| FN-02 Formatted output | Not built; coordinate with the colleague |
| Actual effect entry / closing an Action | On hold until the concept is discussed |
| Read-only (viewer) role | Open question, decide with the role-to-organization matrix |
| Home organization at first sign-in | Entra department attribute, or an "access pending" page? |
| Fabric checks | Do User Data Functions receive the caller's identity? Capacity vs Power BI Pro licences (below F64 every report reader needs Pro). RLS by object ID or UPN. |
| Source data mapping | P&L API columns, customer/product codes, budget source, organization hierarchy, account → Metric owner (`docs/data-model.md` §8) |
| Forecast drivers | Which driver data really exists monthly |
| Deferred features | C-03 progress requests with due dates; C-01 "Add to A-02" proposals |
| Translations | Older screen names in Chinese / Indonesian / Vietnamese; generated AI texts exist in English, Japanese and Thai only |
| Testing with a real API key | C-01 tool answers and Thai replies |
| Production build on Fabric | Not started |
