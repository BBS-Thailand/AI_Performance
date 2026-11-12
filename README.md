# AI Management System — Application Requirements

> **Status:** Draft implementation specification  
> **Source:** `AI-PerformanceManagement_UI-Concept_v0_36.pptx`, **slides 29–56** (English UI concept, November 2026). Slide 57 is blank.  
> **Purpose:** Use this README as the primary functional brief for designing and implementing the application. The source presentation is a UI concept, **not** a complete technical or integration specification. Unspecified decisions are explicitly marked **TBD**.

## 1. Product vision

Build a multilingual, role-aware **AI Management System** that unifies financial performance analysis, AI-detected issues/opportunities, action execution and effect measurement, year-end forecasting, and business intelligence/reporting. Financial data is shared through **Microsoft Fabric**, and multidimensional BI uses **Power BI**.

The application must connect the business workflow end-to-end:

1. Review KPIs and AI-detected **Points** (issues/opportunities).
2. Investigate each Point, including data-backed root causes and proposed **Actions**.
3. Adopt, reject or hold Actions; assign execution to an organization.
4. Track Action progress and automatically measured financial effects.
5. Use measured Action contribution plus independent **Individual Factors** in forecasts.
6. Confirm versioned Forecasts and analyze/report consistent results.

**All financial screens must use the same authoritative figures**, scoped to the selected fiscal period and the user's authorized organization(s).

## 2. Application structure

### 2.1 Navigation

The application has **three top-level menus**, with the following screens, pop-ups and common features:

| Menu | ID | Screen / component | Main responsibility |
|---|---|---|---|
| AI analysis | **A-01** | AI Insights | Top landing screen: KPIs, AI analysis, Point list |
| AI analysis | **A-02** | Point Detail | Point impact/causes; review and decide on Action proposals |
| AI analysis | **P-01** | Action detail / add | Modal for Action definition and AI-calculated effect/measurement |
| AI analysis | **A-03** | Action Board | Organization's adopted/executing Actions and progress |
| AI analysis | **A-04** | Effect Overview | Action effects stacked by month and Action |
| AI analysis | **A-05** | Action Status | Detailed progress, measured effect, outlook, AI assessment, history |
| AI analysis | **C-03** | Action chat / email | Action-specific communication, notifications and audit trail |
| Forecast | **F-01** | Forecast | Year-end landing, contributing Actions/Factors, confirmed versions |
| Forecast | **P-02** | Individual Factor | Modal for independent financial changes by period/Metric |
| BI+Reporting | **B-01** | BI Analysis | Multidimensional Power BI analysis |
| BI+Reporting | **B-02** | Reporting | Standard financial and management reports |
| Common | **C-01** | AI chat | Context-aware AI assistant in a right-side panel |
| Common | **FN-01** | Screen output | Export current on-screen content |
| Common | **FN-02** | Formatted output | Generate predefined report templates |

The **10 primary screens** described in the slide deck's overview are complemented by the pop-ups and shared utilities above. Preserve the source screen IDs in navigation, tickets, testing and documentation.

### 2.2 Shared shell and global context

Every screen has a consistent header:

- Product title, top-level menu selector and current screen name/breadcrumb.
- **Fiscal period** selector (e.g., Jun 2027).
- **Organization** selector, limited to the logged-in user's authorized scope (company → division → department).
- Language selector, **Screen output**, **Formatted output**, and **AI chat** controls.
- Main content and an optionally expanded AI-chat panel on the right.

**Global behavior:**

- Changing period or organization re-queries/recalculates all data on the active screen.
- Preserve selected period and organization across all navigation and menu changes.
- At login, open **A-01**; restore the last period/organization, or use the latest closed fiscal month and user's organization on first use.
- Company-wide values roll up subordinate organizations without double counting.
- Global Metrics are fixed: **Revenue, Gross profit, SG&A, Operating profit**. Render a Metric irrelevant to the selected organization in light gray as **N/A** rather than hiding it.
- Monetary values in the concepts use **JPY millions (JPY M)**. A fiscal year runs **April–March** in the examples. Confirm calendar/currency configuration before production deployment.
- Use breadcrumb/context indicators in drill-downs. Screen-specific tabs and return buttons follow the transition matrix in §10.

### 2.3 Internationalization

Support **seven UI languages**: English, Japanese, Thai, Simplified Chinese, Traditional Chinese, Indonesian and Vietnamese. Language controls must affect UI labels, AI responses and exported reports; persist the selection per user. Localize dates, numbers, financial symbols, status labels and report templates consistently.

## 3. AI analysis module

### 3.1 A-01 — AI Insights (home)

**Goal:** Identify and rank financial problems (**Issue**) and improvement opportunities (**Opportunity**) with their financial impact.

**Screen elements:**

- Four Metric cards showing actual amount and variance against budget; distinguish favorable/unfavorable SG&A movement.
- AI-generated narrative summarizing major Points and changes resulting from Actions.
- Points table with: Point ID, type, description, affected organizations, impact for each Metric, **overall impact**, status, Action proposal/execution counts, planned Action effect, actual Action effect.
- A second row per Point for **change vs. initial** (when raised) and **vs. previous month**.
- Filters for type, status and organization; sort primarily by **absolute overall impact**.
- Direct **Action Board (A-03)** button.

**Rules:**

- AI creates Points monthly; retain older Points that have executing Actions.
- Overall impact is **annualized operating-profit impact**, not the sum of Action effects. Issue values indicate deterioration; Opportunity values indicate potential upside.
- **Company scope:** show parent Points; **department scope:** show corresponding child Points.
- Aggregate Point-related Action proposal count separately from executing Action count.
- Include an **Other / unidentified variance** row if necessary so the Point impact columns reconcile to Metric budget variances.
- Double-click a Point row to open **A-02**, preserving its ID and the current filtered/sorted ordering for Previous/Next.

**Reference case (sample data, not hard-coded):** In Jun 2027, company Revenue = 1,250 (budget variance -55), Gross profit = 301 (-14), SG&A = 215 (+2 favorable), Operating profit = 86 (-12), all JPY M.

### 3.2 A-02 — Point Detail

**Goal:** Understand why a Point exists and decide how to address it.

**Screen elements:**

- Point identity, type, affected departments, Metric impacts and annual overall impact.
- Chart decomposing budget-to-actual operating-profit gap by customer/other relevant dimension.
- Monthly related-indicator chart with **budget vs. actual**.
- Scrollable AI-identified causes, each with quantity, financial impact and evidence/source.
- Proposed Actions table: Action ID, title, annual operating-profit effect, owner, decision, status, decider.
- **Adopt**, **Reject**, **Hold** and **+ Add action (user)** controls.
- **To list**, **Previous**, **Next**, **Action Board** navigation.

**Rules:**

- Both AI-proposed and user-created Actions appear in the same table.
- On company Points, list proposals from all relevant organizations; on child Points, show proposals for the selected organization.
- Double-click Action proposal → **P-01**.
- Newly added user proposal → **P-01** initially blank; generate its ID on save.
- Adoption registers the Action with **A-03** **without navigating away**.
- Rejection requires a reason; Hold requires a fiscal period for re-proposal.
- Show the decision maker and latest outcome; latest authorized decision wins.

### 3.3 P-01 — Action detail / add (modal)

**User-entered fields:** Action name, Action content/description, owning organization (**exactly one**), start/end fiscal period.

**Read-only/generated fields:** Action ID, source (AI/user), state, target Metrics, annual planned effect, monthly effect allocation, measurement method, source data, baseline, measurement formula, AI explanation, data-measurability verdict and potential overlap/double-counting warnings.

**Required AI Analysis workflow:**

1. User enters Action description, owner and dates.
2. User clicks **AI analysis**.
3. AI determines affected Metrics and **data-measurable** planned effect, monthly distribution and measurement configuration.
4. AI explains assumptions, formula, source tables and exclusions/overlaps with other Actions.
5. Enable **Save** / **Save & adopt** only if the Action effect can be measured with available data (directly or with a supported proxy indicator). If not measurable, propose changes and block saving.

**Measurement modes:**

- **Direct:** identify source transaction/account/customer/product/organization data, pre-Action baseline and monthly calculation formula.
- **Proxy:** define related measurable indicator, conversion method and reliability; proxy data must actually be available/imported.

**Critical constraint:** Do **not** allow manual entry or manual reporting of Action financial effects. Actual effects are calculated from data. The planned effect generated here is shared unchanged with A-03 and F-01.

**Example:** An Action to protect customer revenue may use the three-month pre-Action average as baseline and `(actual - baseline) × gross margin` as the effect formula. The presentation's numerical worked examples illustrate the UI; implementation should calculate from authoritative records, not hard-code examples.

### 3.4 Action decision lifecycle, authority and IDs

Action lifecycle:

```text
Proposed
  ├─ Adopted → In progress → Completed
  │                  └─ Paused / Stopped
  ├─ Rejected (reason required)
  └─ On hold (re-proposal period required) → Proposed when due
```

- The source distinguishes **adoption** from **execution/in progress**. Track decision and execution state without losing the history.
- A company-wide authorized management/corporate-planning user may decide on Actions across organizations.
- An authorized organization head/action owner may decide and execute only their organization's Actions.
- A later authorized decision supersedes an earlier one; if company management overrides an organization's decision, notify it through **C-03**.
- Only an authorized user may cancel adoption, and **not if actual effects have already been recorded**.
- Record who/when for all decisions in A-02 and the A-05 audit trail.

**Identifiers:**

| Entity | Format | Example |
|---|---|---|
| Parent Point | `PT-{number}` | `PT-001` |
| Organization child Point | `PT-{number}-{orgCode}` | `PT-001-SL` |
| AI-proposed Action | `ACT-{pointNumber}-{orgCode}-A{sequence}` | `ACT-001-SL-A01` |
| User-created Action | `ACT-{pointNumber}-{orgCode}-U{sequence}` | `ACT-001-SL-U01` |
| Individual Factor | `EV-{sequence}` | `EV-002` |

Example organization codes: `SL` Sales, `OS` Overseas Sales, `MF` Manufacturing, `AD` Administration. Parent Point impact equals the sum of child Point impacts. Each Action has **one** owning organization; its effect rolls up under that organization. **Point impact and Action effect are different measures** and must not be conflated.

### 3.5 A-03 — Action Board

**Goal:** Track adopted/executing Actions by organization with history, progress and measured effects.

**Screen elements:**

- Counts: executing, in progress, effective, delayed and completed; clickable count filters.
- Scope selector: executing only vs. include completed/stopped history.
- Four **multi-select Metric cards** showing affected Action counts and planned/actual Action-effect totals; list includes Actions related to **any** selected Metric.
- Action table with ID/name/linked Point, Apr–Mar period bar, progress %, planned effect, actual effect, year-end outlook, excluded Individual Factors, AI status/judgment and chat unread count.
- Two-line comparison: base planned/actual/outlook, then **month-over-month actual increase** and **outlook minus initial plan**.
- Vertical indicator of selected fiscal month on Action timing bars.
- **AI Insights** link; **List** and **Effect Overview** tabs.

**Rules:**

- An Action enters this board following adoption; owning organization updates progress.
- Planned effect originates from P-01; actual effect comes from measured accounting/indicator data and **excludes overlapping Individual Factors**.
- AI provides status/assessment; users do not manually enter monetary effect.
- Double-click Action row → **A-05**; click chat indicator → **C-03**.

### 3.6 A-04 — Effect Overview

**Goal:** Compare Action contributions across the fiscal year.

- Choose **one Metric** at a time; show planned and actual totals.
- **Monthly stacked bar chart**: X = fiscal month (Apr–Mar), Y = effect (JPY M), stack = Action, **dark = realized actual**, **light = expected outlook**; display monthly totals.
- Legend has one consistent color per Action with its plan/actual values.
- Table of original plan, accumulated actual, remaining outlook, full-year outlook, and variance to original plan, plus reconciled totals.
- AI highlights gaps, peaks and insufficient expected effects.
- A-03/A-04 are tabs that preserve the selected Metric when switching.
- Double-click chart segment/bar → A-05 with **Action ID and month**. If a month contains multiple Actions, the selection must resolve to a specific Action; chart interaction design is **TBD**.

### 3.7 A-05 — Action Status

**Goal:** Review a single Action in detail.

- Action metadata: ID, Point, owner, term and Metrics.
- KPI cards: original planned effect, plan-to-date, realized effect, year-end outlook, % progress, and excluded `EV-*` factors.
- Monthly comparison graph with **no-action baseline**, **with-action plan**, **actual**, and **outlook if continued**.
- AI assessment: on track/delayed/etc., evaluation, alternative scenarios, recommended next steps, exclusion explanation.
- Change history: adoption, owner updates, progress, AI judgments and chat messages.
- Back to **A-03**, open **C-03** action thread.

### 3.8 C-03 — Action chat / email

- One persistent thread **per Action ID**.
- Participants: authorized company/upper-organization users and action-owning staff; authorized users manage participants.
- Send messages, `@mentions`, optional **email notification**, and **progress update requests with due dates**.
- Notify on messages, mentions and progress requests; show unread counts on A-03.
- AI can summarize status, estimate impact and suggest replies.
- Append all messages/events to A-05 change history and make them available to action-progress reports.
- Deep-link notifications back to the matching Action thread, enforcing authorization.

## 4. Forecast module

### 4.1 F-01 — Forecast

**Goal:** Explain and confirm an organization's expected year-end financial landing.

**Screen elements:**

- Version selector with confirmation time/person, previous-version comparison, **Save (confirm)** button.
- Four Metric cards showing projected year-end landing and budget variance; select one for chart/details.
- Monthly **actual / forecast / budget** graph.
- Financial landing bridge: **initial budget → forecast without Actions → Action contribution → included Individual Factors → final landing**.
- Read-only contributing Action list, linked to the same Action data as A-03, with progress, initial-to-current expected contribution and excluded factor IDs.
- Individual Factor table with include/exclude checkboxes, period, value, input date; **+ Add factor** and double-click edit via P-02.
- AI explanation for calculated forecast and effect of unchecked factors.

**Required formula (for a Metric, fiscal year, organization and confirmed version):**

```text
Year-end landing
  = Baseline forecast without Actions
  + Action contribution (current adjusted outlook)
  + Sum of included Individual Factors

Budget variance = Year-end landing - Initial annual budget
```

Use the original annual budget in the breakdown for comparison; **do not add the budget a second time** to the baseline forecast.

**Illustrative values from slide 48 (Operating profit, JPY M):** budget `370`, no-Action forecast `328`, Actions `+22`, included Factors `+2.5`, landing `352.5`, variance `-17.5`.

**Rules:**

- Action adoption/stopping/ownership changes happen on A-02/A-03, **not** in F-01.
- Included factors contribute to Forecast only when checked; they remain registered even when unchecked.
- Factors entered in earlier periods remain visible while their effective date range overlaps the displayed period.
- Confirming saves an immutable snapshot as the next version, with timestamp and confirming user.
- Organization heads confirm only their organizations. **Company-wide Forecast is read-only**, assembled from each organization's **latest confirmed version**, by Metric/account.
- Corporate planning sets company closing deadlines.

### 4.2 P-02 — Individual Factor modal

**Goal:** Enter a financial change that affects values **independently of Actions** (e.g., FX movement, order delay, product launch, exhibition).

**Fields:** generated Factor ID `EV-*`, category/type, description, target organization(s), start/end period, **monthly change by Metric**, evidence/memo, created/modified metadata. Allow multiple organizations where permitted.

**Behavior:**

- Open blank from **+ Add factor** or populated by double-clicking a factor row in F-01.
- Enter monetary adjustments directly (unlike Action effects); calculate monthly/fiscal total.
- Show AI-derived affected Actions, values, expected forecast impact, and potential overlaps.
- Save/edit/delete subject to permissions; persist factor and audit record.
- F-01 include/exclude decisions determine its contribution to a **specific confirmed Forecast version**.
- Exclude a matching Factor's impact from Action-effect measurement to avoid double counting. Display the excluded Factor ID in A-03/A-04/A-05 and F-01.
- Avoid double-counting across organization targets; allocation rules for cross-organization Factors are **TBD**.

### 4.3 Versioning and organization aggregation

- Each `Save (confirm)` creates organization-local **Version N+1** with user, timestamp, selected factors and input references.
- Historical versions can be viewed and compared; prior confirmed snapshots must not change retroactively.
- Company-wide Forecast = sum of **latest confirmed** organizational Forecasts (not a separately editable company version).
- Store/derive figures consistently at Metric and accounting-account level, so F-01, B-01 and B-02 agree.

## 5. BI + Reporting module

### 5.1 B-01 — BI Analysis (Microsoft Fabric / Power BI)

Offer multidimensional P&L exploration using shared authoritative Fabric data:

- **Dimensions:** organization (company/division/department), fiscal period (year/quarter/month), customer (region/customer), product (category/product), account, and scenario (budget/actual/forecast).
- **Measures:** Revenue, Gross profit, Operating profit, Cost (and others only if defined by shared Metrics).
- User-configurable pivot rows, columns, filters, chart view and drill-down to lower dimensions or details.
- Allow saving/reopening custom analysis views (e.g., regional revenue trend, product cost ratio).
- Default period/organization from the common header, with authorization respected inside the embedded BI content.
- AI-chat graph responses may offer **Open in BI**.

### 5.2 B-02 — Reporting

Standard reports organized by category:

| Category | Report examples |
|---|---|
| Revenue | Revenue by customer; Revenue by region/product |
| Cost | Cost by product; Cost variance analysis |
| Periodic | Monthly performance; Quarterly report |
| Budget / forecast | Budget vs. actual; Year-end landing Forecast |
| Actions | Action progress report |

Features:

- Report chooser and favorites.
- Report options: single-month vs. YTD, organization, comparison to initial budget, prior year, and chosen **confirmed Forecast version**.
- Tabular/chart report content with consistent accounting definitions and units.
- Optional AI summary commentary aligned with the analysis on A-01.
- Switch between **B-01** and **B-02** with tabs.

## 6. Common AI chat and exports

### 6.1 C-01 — Context-aware AI chat

- Available on **every screen** as a right-side panel toggled from the common header.
- Provide selected **period, organization, screen ID and visible/filtered data** as context. Display this context prominently in the chat.
- Answer user questions about budget shortfall, root causes, customer breakdown and Actions; generate charts and contextual links.
- Support proposing Actions and inserting them into A-02 via an explicit user action.
- Support **what-if** questions, e.g. impact of stopping an Action, **within chat without silently editing confirmed figures**.
- Support draft report commentary for FN-02 and **Open in BI** links when applicable.
- Strictly constrain data retrieval and generated responses to the user's authorized organization/data scope.
- Cite provenance for numeric answers (at least screen/data source and fiscal period).
- The underlying AI model, retrieval design, orchestration and approval workflow are **TBD**.

### 6.2 FN-01 — Screen output

A global, **no-navigation** export action. Export exactly the currently displayed content including tables/charts, applied filters, ordering and expansion state.

Supported formats: **PDF, Excel (tables as actual structured data), PowerPoint, image**.

Include automatically: fiscal period, organization, screen name, export timestamp and exporting user. Export only authorized data and use the chosen language.

### 6.3 FN-02 — Formatted output

A **separate** global no-navigation action that first selects an available **predefined template** (available templates depend on current screen), then generates the requested report.

Template examples: monthly performance, Points & Actions, Action progress, year-end landing, budget vs. actual, board/HQ report. Formats are set by template: **PowerPoint, Excel or PDF**. Include optional AI-generated comments appropriate to the selected template.

## 7. Conceptual data model

The following is a **proposed implementation-oriented model inferred from the screens**, not a database schema explicitly defined by the presentation. Adjust storage technology and field names after data-source review.

| Entity | Minimum fields / associations |
|---|---|
| `User` | identity, locale, authorized org scope, role, previous context |
| `Organization` | ID/code, name, parent ID, hierarchy level |
| `FiscalPeriod` | fiscal year, fiscal month, calendar start/end, closed flag |
| `MetricDefinition` | Metric ID/name, unit, account mapping, applicability by org, favorable-direction logic |
| `FinancialActual` | fiscal period, org, account, customer/product dimensions, actual amount, source/loaded-at |
| `InitialBudget` | fiscal year/period, org, account/Metric, fixed amount |
| `Point` | `PT-*`, parent ID, org, Issue/Opportunity, title, created period, status, impact by Metric, overall annual OP impact |
| `PointCause` | Point ID, narrative, quantitative evidence, reference/source, relevance period |
| `Action` | `ACT-*`, Point ID, owner org, origin A/U, content, dates, decision/execution state, latest decider |
| `ActionMeasurement` | Action ID, target Metrics, data scope, baseline, calculation formula, monthly planned effect, expected annual effect, proxy reliability, exclusions |
| `ActionProgress` | Action ID, period, progress %, plan-to-date, measured actual, current outlook, AI judgment |
| `IndividualFactor` | `EV-*`, category/content, org targets, date range, monthly Metric amounts, evidence, creator |
| `ActionFactorExclusion` | Action ID, Factor ID, affected source/Metric/time range, exclusion calculation |
| `ForecastVersion` | organization, fiscal year/as-of period, version number, confirmed timestamp/user, frozen figures and inputs |
| `ForecastFactorSelection` | Forecast version, Factor ID, included/excluded, applied adjustment |
| `ActionChatThread` / `Message` | Action ID, participants, message, author, timestamp, mentions, email/progress-request metadata |
| `AuditEvent` | resource ID, user/AI actor, time, change/action, old/new states, source |
| `SavedBIView` / `ReportDefinition` | owner/access, dimensions/filters, template, supported formats |

**Important modeling choices:**

- Use stable IDs and authoritative organization hierarchy mappings for all joins.
- Financial values need a well-defined **sign convention**, precision, aggregation level and temporal alignment; use decimal numeric types.
- Separate **original Action plan**, **actual measured effects**, and **reforecast remaining/outlook**; never overwrite original plan after adoption.
- Keep independent Factors separate from Actions and explicitly track excluded overlap.
- Freeze confirmed Forecast versions while retaining provenance to underlying actuals, budgets, Actions and factor selections.
- Preserve a human-readable audit trail of all decisions, progress updates, chat events and confirmations.

## 8. Cross-screen invariants (non-negotiable)

1. **One source of truth:** Fabric supplies consistent actuals, original budgets, forecasts and shared business definitions to all modules.
2. **Same context:** fiscal period and authorized organization persist across navigation, common AI chat and exports.
3. **Same KPI values:** A-01, F-01, B-01 and B-02 must reconcile for an equivalent scope and reporting basis.
4. **Fixed company Metrics:** irrelevant Metrics show as N/A; do not change the Metric list per department.
5. **Parent/child Points:** parent overall impact equals sum of child organization impact; company and org-level views choose the appropriate level.
6. **Action integrity:** one owning org, stable linked Point, calculated planned effect, data-measured actual effect, no manual financial-effect reporting.
7. **Factor integrity:** selected Individual Factors affect the Forecast and matching factors are excluded from Action-effect measurement. Avoid duplicate counting.
8. **Action vs. Point:** Action effect is not identical to Point impact and must not be aggregated as if it were.
9. **Version integrity:** confirm creates a new immutable org Forecast version; company view totals latest confirmed org versions.
10. **Permissions everywhere:** filter queries, BI embeds, AI context, chat, export and notifications server-side—not just UI visibility.
11. **Traceability:** AI-generated numeric conclusions must show underlying period/source; Action analysis records assumptions and formulas.
12. **Auditability:** decisions, overrides, confirmations, factor edits and Action communications remain reviewable.

## 9. Implementation guidance and delivery phases

The slides do **not** specify frontend/backend frameworks, hosting, identity provider configuration, database engine, Fabric lakehouse/warehouse schemas, Power BI embed mode, AI model, email transport, or deployment environments. Select these with stakeholders; do not assume a particular stack is a business requirement.

**Suggested delivery sequence (implementation guidance, not a source mandate):**

1. **Foundation:** auth/permissions, org hierarchy, fiscal periods, common header, localization, Fabric data contracts, shared Metrics.
2. **Read-only financial MVP:** A-01 Point list/KPIs, A-02 causes, F-01 view, B-01 embedded BI and B-02 reports against consistent data.
3. **Actions:** P-01 AI-assisted measurable Action definition, decisions, A-03 progress, A-04 effects, A-05 status/history.
4. **Forecast authoring:** P-02 Factors, overlap exclusions, forecast calculation, immutable version confirmation and org roll-up.
5. **Collaboration and intelligence:** C-01 screen-aware chat, C-03 Action threads/email, AI evaluations, full export/report templates.
6. **Hardening:** permission tests, financial reconciliation, observability, performance, localization QA, audit/security review.

For a functional prototype without real Fabric/AI services, **label simulated data and AI responses clearly**. Do not present simulated analysis as independently computed or connected to live financial records.

## 10. Required navigation and context transfer

In **all** transitions carry selected fiscal period and organization.

| From | Trigger | Destination | Extra context |
|---|---|---|---|
| Login | Start | A-01 | Previous or initial context |
| Common header | Menu choice | A-01 / F-01 / B-01 | Top-level switch only |
| A-01 | Double-click Point | A-02 | Point ID, current list sort/order |
| A-01 | Action Board button | A-03 | — |
| A-02 | Prev/Next | A-02 | Next Point in source list |
| A-02 | Double-click Action / Add | P-01 | Point ID, existing Action ID if any |
| A-02 | To list | A-01 | Updated Action decisions |
| A-02 | Action Board button | A-03 | — |
| A-03 | AI Insights button | A-01 | — |
| A-03 / A-04 | List / Effect tabs | A-04 / A-03 | Selected Metric(s), sensibly mapped between single/multi select |
| A-03 | Double-click Action | A-05 | Action ID |
| A-04 | Double-click chart Action segment | A-05 | Action ID, month |
| A-03 / A-05 | Chat | C-03 | Action ID |
| A-05 | Back | A-03 | — |
| F-01 | Add / double-click Factor | P-02 | Existing Factor ID or new |
| F-01 | Save (confirm) | F-01 | Newly confirmed version |
| B-01 / B-02 | Tab switch | B-02 / B-01 | — |
| Any screen | AI chat | C-01 right panel | Screen ID and displayed data |

FN-01 and FN-02 **do not change screens**.

## 11. Acceptance criteria

A build is functionally aligned with this UI concept when the following can be demonstrated:

- [ ] Login opens A-01 with correct initial/restored period and authorized organization.
- [ ] Global selectors preserve context across every transition and refresh shown data.
- [ ] All seven languages work in screens, AI responses and exports; preference is remembered.
- [ ] Fixed four-Metric cards render correct values and N/A for irrelevant Metrics.
- [ ] A-01 ranks Points by absolute annual operating-profit impact; parent/child scoping and KPI reconciliation work.
- [ ] A-02 charts, evidence-backed causes, Action proposals and Prev/Next preserve ordering.
- [ ] P-01 calculates measurable planned effects and formulas, prevents saving non-measurable Actions, checks overlaps, generates proper IDs.
- [ ] Authorized users adopt/reject/hold Actions with required fields, override notices, and immutable decision audit records.
- [ ] Adopting an Action makes it appear in A-03; progress is editable by the owning organization; monetary effect is never entered manually.
- [ ] A-03 and A-04 maintain coherent selected Metrics and reconcile Action plan/actual/outlook totals.
- [ ] A-05 explains baseline, plan, actual and outlook and displays all change history.
- [ ] Action chat is per-ID, permission-controlled, supports mentions/email/progress requests and writes to history.
- [ ] F-01 landing exactly reconciles `baseline + Action outlook + included Factors` and reports budget variance.
- [ ] P-02 creates/edits independent monthly Factor impacts and shows factor/action overlap exclusions.
- [ ] Saving F-01 creates a new immutable organization version; company Forecast equals latest confirmed organization totals.
- [ ] B-01 supports multidimensional drill-down and B-02 provides standard reports based on the same figures.
- [ ] C-01 visibly declares its period/org/screen context, enforces access, supports cited numbers and what-if analysis without mutation.
- [ ] FN-01 exports current filters/sort/chart/table state to PDF/Excel/PPTX/image; FN-02 generates permitted templates separately.
- [ ] Server/API/BI/AI/export permissions, versioning, audit, and cross-screen finance reconciliation pass tests.

## 12. Open questions / specifications required before production

These items are **not resolved by slides 29–56** and need explicit design approval:

1. Exact Fabric data products/tables, ingestion frequency, source accounting system, dimensional keys and row-level access policies.
2. User authentication/SSO, role-to-organization matrix and who may approve, override, pause, delete or confirm each record.
3. Detailed algorithms for AI Point detection, root-cause attribution, confidence, sign conventions and **overall impact** annualization.
4. Action-effect causal attribution, baseline adjustments, proxy reliability thresholds and Factor-vs-Action overlap exclusion method.
5. Forecast baseline algorithm, how progress affects future contribution, comparison of versions, year-end cutoff and company close process.
6. Whether header period means as-of month for YTD data, single-month analysis, full fiscal year, or context-dependent views; define explicit labels.
7. Detailed data validation for Individual Factors, cross-org splits, factors outside current period, deletion rules and audit.
8. Exact chart interactions, accessible keyboard equivalents for double-click, loading/error/empty states and responsive/mobile layout.
9. Approved formatted-report templates, branding, export behavior for Power BI content and per-screen formats.
10. AI provider, prompt/data-protection policies, human review, explanations, retention and model monitoring.
11. Email integration, event/notification delivery, chat retention, unread semantics and progress-request escalation.
12. Nonfunctional targets: performance, concurrency, audit retention, availability, backups, compliance and observability.

## 13. Source slide reference

| Slides | Content |
|---|---|
| 29–33 | English title, overview, screen flow and screen inventory |
| 34–36 | Common UI shell, localization, exports and AI chat |
| 37–42 | AI Insights, Point Detail, Action modal, decisions and identifier rules |
| 43–46 | Action Board, Effect Overview, Action Status and Action chat |
| 47–50 | Forecast, Individual Factors, confirmation/version rules |
| 51–53 | Power BI analysis and Reporting |
| 54–56 | Data consistency and screen transitions |

---

**Implementation principle:** Preserve the concepts' screen identities, business rules, navigation and financial consistency. Treat example figures as sample/mock data and resolve all **TBD** items before claiming production correctness.
