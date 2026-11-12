# AI Management System — Data Model (v0.1, draft)

> **Status:** Draft target design for the Microsoft Fabric implementation.
> The HTML mockup (`mockup/`) uses **mock data with exactly these tables and columns**, so the
> production Fabric app can replace the mock data source without redesigning screens.
> **Source mapping is TBD** — see §7.

## 1. Architecture overview

```text
 Glasiaous API (P&L)                                     Budget / master data (source TBD)
        │  Pipeline: Glasiaous_API_Pipeline (Copy data, replace)        │
        ▼                                                               ▼
 ┌──────────────────────── Lakehouse (Delta tables) ─────────────────────────┐
 │ Bronze  stg_glasiaous_pl (working table, replaced each run)               │
 │         raw_glasiaous_pl_archive (append, keeps load history)  [proposed] │
 │ Silver  slv_pl_line (typed, mapped, de-duplicated)                         │
 │ Gold    dim_* / fact_financial / fact_baseline_forecast                    │
 └───────────────────────────────────────────────────────────────────────────┘
        │                                         ▲ (OneLake mirroring)
        ▼                                         │
 ┌──────────── Semantic model (Direct Lake) ─────────────┐   ┌─── Fabric SQL database ───┐
 │ Measures: Actual, Budget, Variance, Landing, ...      │◄──│ app_* tables (Points,      │
 │ RLS: user_org_scope × dim_organization                │   │ Actions, Factors, Forecast │
 └───────────────────────────────────────────────────────┘   │ versions, AI comments,     │
        │ DAX (Rayfin connector)                              │ chat, audit)              │
        ▼                                                     └──────────▲────────────────┘
 ┌──────────────── Fabric App (web UI) ──────────────────┐               │ User Data Functions
 │ A-01 … B-02, C-01, FN-01/02                            │───────────────┘ (validated writes)
 └────────────────────────────────────────────────────────┘
```

| Layer | Storage | Written by | Read by |
|---|---|---|---|
| Financial (gold) | Lakehouse Delta | Pipeline + Notebook | Semantic model |
| Application | Fabric SQL database | User Data Functions, AI jobs | Semantic model (via OneLake mirror), App |
| AI output | Fabric SQL database | Monthly AI job | Semantic model, App |

## 2. Conventions

| Topic | Rule |
|---|---|
| Unit | Amounts in **JPY millions**, `DECIMAL(18,2)`. Never float. |
| Fiscal year | April–March. `FY2027` = Apr 2027 – Mar 2028. |
| Period key | `period_id` = `YYYYMM` integer of the **calendar** month (e.g. `202706`). |
| Fact sign | `fact_financial.amount` is stored as a **natural positive balance** (revenue positive, costs positive). Metrics apply signs through `account_metric_map`. |
| Metric-level values | Every metric-level number (variance, Point impact, Action effect, Factor amount) is a **signed change in the metric's own value**. SG&A `+3` = SG&A increased by 3. |
| Favorable | `value × dim_metric.favorable_direction > 0` is favorable. SG&A has direction `-1`. |
| Variance | `actual − budget`. |
| Header period (mockup) | Interpreted as **YTD as of the selected closed month** (open question README §12-6). |
| IDs | Business IDs per README §3.4 (`PT-001`, `PT-001-SL`, `ACT-001-SL-A01`, `EV-001`). |
| Audit columns | All `app_*` tables: `created_at`, `created_by`, `modified_at`, `modified_by` (UTC). Omitted below for brevity. |
| Languages | `en`, `ja`, `th`, `zh-Hans`, `zh-Hant`, `id`, `vi`. |

## 3. Gold layer — Lakehouse (financial, read-only for the app)

### 3.1 Dimensions

**`dim_organization`** — company → division → department
| Column | Type | Notes |
|---|---|---|
| org_id | STRING (PK) | Stable code, e.g. `CO`, `DSL`, `SL` |
| org_code | STRING | Short code used in IDs (`SL`, `OS`, `MF`, `AD`) |
| org_name | STRING | Display name (localized names: `dim_organization_text`) |
| parent_org_id | STRING | NULL for company |
| org_level | INT | 1 company, 2 division, 3 department |
| org_path | STRING | `CO|DSL|SL` — used by RLS and roll-ups |
| is_leaf | BOOLEAN | Facts are loaded at leaf level only (prevents double counting) |
| sort_order | INT | |

**`dim_fiscal_period`**
| Column | Type | Notes |
|---|---|---|
| period_id | INT (PK) | `YYYYMM` |
| fiscal_year | INT | 2027 for Apr 2027 – Mar 2028 |
| fiscal_month_no | INT | 1 = April … 12 = March |
| fiscal_quarter | INT | 1–4 |
| calendar_year, calendar_month | INT | |
| start_date, end_date | DATE | |
| is_closed | BOOLEAN | Set by corporate planning close process |

**`dim_metric`** — the four fixed company Metrics
| Column | Type | Notes |
|---|---|---|
| metric_id | STRING (PK) | `REV`, `GP`, `SGA`, `OP` |
| metric_name | STRING | |
| favorable_direction | INT | `+1` (REV, GP, OP), `-1` (SGA) |
| sort_order | INT | |

**`dim_account`**
| Column | Type | Notes |
|---|---|---|
| account_id | STRING (PK) | e.g. `4010` |
| account_name | STRING | |
| account_class | STRING | `REVENUE`, `COGS`, `SGA` |
| sort_order | INT | |

**`account_metric_map`** — how accounts build Metrics
| Column | Type | Notes |
|---|---|---|
| account_id | STRING | |
| metric_id | STRING | |
| sign | INT | REVENUE → REV `+1`, GP `+1`, OP `+1`; COGS → GP `-1`, OP `-1`; SGA → SGA `+1`, OP `-1` |

**`dim_organization_text`**: `org_id`, `language_code`, `org_name` (localized names)
**`dim_customer`**: `customer_id`, `customer_name`, `region`, `country`, `owner_org_id`
**`dim_product`**: `product_id`, `product_name`, `product_category`
**`dim_scenario`**: `scenario_id` (`ACT`, `BUD`), `scenario_name`

**`org_metric_applicability`** — drives N/A rendering
| Column | Type | Notes |
|---|---|---|
| org_id, metric_id | STRING | |
| is_applicable | BOOLEAN | e.g. Administration: REV/GP = false |

### 3.2 Facts

**`fact_financial`** — actuals and original budget (leaf organizations only)
| Column | Type | Notes |
|---|---|---|
| period_id | INT | |
| org_id | STRING | Leaf org |
| account_id | STRING | |
| customer_id | STRING | `NA` when not applicable (e.g. SG&A) |
| product_id | STRING | `NA` when not applicable |
| scenario_id | STRING | `ACT`, `BUD` |
| amount | DECIMAL(18,2) | Natural positive balance |
| load_id | STRING | Pipeline run that produced the row (traceability) |

**`fact_baseline_forecast`** — forecast **without Actions** (output of forecast model, TBD)
| Column | Type | Notes |
|---|---|---|
| forecast_run_id | STRING | |
| as_of_period_id | INT | Closed month the forecast was made from |
| period_id | INT | Forecasted month (whole fiscal year) |
| org_id, account_id | STRING | |
| amount | DECIMAL(18,2) | Closed months: actual **minus measured Action effect**; open months: no-Action forecast |

> **Why closed months exclude Action effects:** `Landing = Baseline + Action contribution + Factors`
> counts realized Action effect once, in the Action contribution. Otherwise it would be counted
> twice (already inside actuals).

## 4. Application layer — Fabric SQL database

### 4.1 Security and user context
| Table | Columns |
|---|---|
| `app_user` | user_id (UPN), display_name, role (`CORP_PLANNING`, `ORG_HEAD`, `ACTION_OWNER`, `VIEWER`), home_org_id |
| `app_user_org_scope` | user_id, org_id, can_decide_action, can_confirm_forecast (scope includes descendants via org_path) |
| `app_user_preference` | user_id, language_code, last_period_id, last_org_id |

### 4.2 Points (AI-detected Issues / Opportunities)
| Table | Columns |
|---|---|
| `app_point` | point_id (`PT-001` / `PT-001-SL`), parent_point_id, point_no, org_id, point_type (`ISSUE`/`OPPORTUNITY`), status (`OPEN`, `IN_ACTION`, `RESOLVED`, `CLOSED`), raised_period_id, title_comment_id, gap_dimension (`CUSTOMER`/`PRODUCT`/`ACCOUNT` — A-02 decomposition chart), indicator_metric_id + indicator_filter (JSON — A-02 related-indicator chart) |
| `app_point_impact_snapshot` | point_id, as_of_period_id, metric_id, impact_ytd, overall_impact_annual_op — one row per month the Point exists; gives **vs initial** and **vs previous month** |
| `app_point_cause` | cause_id, point_id, as_of_period_id, sort_order, quantity_value, quantity_unit, impact_op, evidence_ref (table/filter used), comment_id |

> Parent Point impact = Σ child Point impacts (enforced by AI job + reconciliation test).
> An **Other / unidentified** row is derived (`Metric variance − Σ Point impacts`), not stored.

### 4.3 Actions
| Table | Columns |
|---|---|
| `app_action` | action_id, point_id (child Point), owner_org_id, origin (`AI`/`USER`), seq_no, action_name + description (user-entered, original language), action_name_comment_id + description_comment_id (AI-generated, multilingual via `ai_comment_text`), effect_kind (`REV`/`COGS`/`SGA`), start_period_id, end_period_id, decision_state (`PROPOSED`, `ADOPTED`, `REJECTED`, `ON_HOLD`), execution_state (`NOT_STARTED`, `IN_PROGRESS`, `PAUSED`, `STOPPED`, `COMPLETED`), hold_until_period_id, adopted_period_id, latest_decider, latest_decided_at |
| `app_action_decision` | decision_id, action_id, decision (`ADOPT`, `REJECT`, `HOLD`, `CANCEL_ADOPTION`), reason, hold_until_period_id, decided_by, decided_at, overrides_decision_id — **append-only** |
| `app_action_measurement` | action_id, measurement_mode (`DIRECT`/`PROXY`), is_measurable, source_tables, source_filter, baseline_method, baseline_value, formula, proxy_indicator, proxy_reliability, ai_comment_id |
| `app_action_target_metric` | action_id, metric_id |
| `app_action_effect_monthly` | action_id, metric_id, period_id, planned_effect (frozen at adoption), actual_effect (measured, after Factor exclusion; NULL for open months), outlook_effect (current reforecast; open months), excluded_factor_amount |
| `app_action_progress` | action_id, period_id, progress_pct, ai_status (`ON_TRACK`, `DELAYED`, `AT_RISK`, `EFFECTIVE`, `COMPLETED`), outlook_total_op (snapshot for "outlook vs initial plan"), comment_id, updated_by |

> **No manual effect entry.** `actual_effect` is written only by the measurement job.
> `planned_effect` is written once by P-01 AI analysis and never overwritten after adoption.

### 4.4 Individual Factors
| Table | Columns |
|---|---|
| `app_factor` | factor_id (`EV-001`), category (`FX`, `ORDER_DELAY`, `LAUNCH`, `EVENT`, `OTHER`), title_comment_id, start_period_id, end_period_id, evidence_memo, registered_period_id, default_included (default checkbox in F-01), is_deleted |
| `app_factor_org` | factor_id, org_id |
| `app_factor_amount` | factor_id, org_id, metric_id, period_id, amount (signed metric change) |
| `app_action_factor_exclusion` | action_id, factor_id, metric_id, period_from, period_to, excluded_amount, method_comment_id |

### 4.5 Forecast versions
| Table | Columns |
|---|---|
| `app_forecast_version` | forecast_version_id, org_id, fiscal_year, as_of_period_id, version_no, confirmed_at, confirmed_by, baseline_run_id, note |
| `app_forecast_version_line` | forecast_version_id, metric_id, budget_annual, baseline_no_action, action_contribution, factor_contribution, landing — **frozen snapshot** |
| `app_forecast_version_monthly` | forecast_version_id, metric_id, period_id, actual, forecast, budget |
| `app_forecast_factor_selection` | forecast_version_id, factor_id, is_included, applied_amount_op |
| `app_forecast_version_action` | forecast_version_id, action_id, metric_id, outlook_effect |

> Company Forecast is **not stored** — it is Σ of each organization's latest confirmed version.

### 4.6 AI output (monthly, multilingual)
| Table | Columns |
|---|---|
| `ai_run` | run_id, run_type (`MONTHLY_ANALYSIS`, `ACTION_ASSESSMENT`, `FORECAST_EXPLANATION`), as_of_period_id, model_name, prompt_version, source_load_id, status, started_at, finished_at |
| `ai_comment` | comment_id, run_id, as_of_period_id, org_id, comment_type (`A01_SUMMARY`, `POINT_TITLE`, `POINT_CAUSE`, `ACTION_EXPLANATION`, `ACTION_ASSESSMENT`, `F01_EXPLANATION`, `A04_INSIGHT`), entity_type, entity_id, base_language, version, is_current |
| `ai_comment_text` | comment_id, language_code, text, is_base, translated_at, reviewed_by |

Rules: numbers live in structured tables, not only in text; analysis is generated once in the base
language and **translated** to the other six; re-runs create a new `version` (never overwrite).

### 4.7 Collaboration and audit
| Table | Columns |
|---|---|
| `app_chat_thread` | thread_id, action_id (1:1) |
| `app_chat_participant` | thread_id, user_id, added_by |
| `app_chat_message` | message_id, thread_id, author_id, message_type (`MESSAGE`, `PROGRESS_REQUEST`, `SYSTEM`), body, mentions, email_notified, due_date, sent_at |
| `app_chat_read` | thread_id, user_id, last_read_message_id (unread counts) |
| `app_audit_event` | event_id, resource_type, resource_id, actor_type (`USER`/`AI`/`SYSTEM`), actor_id, event_type, old_value, new_value, occurred_at |
| `app_saved_bi_view` | view_id, owner_id, name, definition_json, shared |

## 5. Semantic model (Direct Lake) — key measures

```DAX
Metric Value  := SUMX ( fact_financial, fact_financial[amount] * RELATED ( account_metric_map[sign] ) )
-- (implemented via the account_metric_map bridge filtered by selected dim_metric)
Actual        := CALCULATE ( [Metric Value], dim_scenario[scenario_id] = "ACT" )
Budget        := CALCULATE ( [Metric Value], dim_scenario[scenario_id] = "BUD" )
Actual YTD    := CALCULATE ( [Actual], DATESYTD-equivalent on dim_fiscal_period (fiscal_year, fiscal_month_no <= selected) )
Variance YTD  := [Actual YTD] - [Budget YTD]
Is Favorable  := [Variance YTD] * SELECTEDVALUE ( dim_metric[favorable_direction] ) > 0
Budget Annual := CALCULATE ( [Budget], ALLEXCEPT on fiscal_year )
Baseline No Action  := SUM ( fact_baseline_forecast[amount] × sign )  -- latest run for as-of period
Action Contribution := Σ realized actual_effect (closed months) + Σ outlook_effect (open months)
Included Factors    := Σ app_factor_amount where factor is included
Landing             := [Baseline No Action] + [Action Contribution] + [Included Factors]
Landing vs Budget   := [Landing] - [Budget Annual]
Other Unidentified  := [Variance YTD] - Σ Point impacts (current snapshot, org level)
```

**RLS:** role `OrgScope` filters `dim_organization` to rows whose `org_path` starts with any
`org_path` in `app_user_org_scope` for `USERPRINCIPALNAME()`. All app tables relate through `org_id`.

## 6. Reconciliation tests (must pass in mock and production)
1. Σ leaf org metrics = company metric (no double counting).
2. Company variance per Metric = Σ parent Point impacts + Other.
3. Parent Point impact = Σ child Point impacts.
4. `OP = GP − SGA` for actual, budget, baseline, landing.
5. `Landing = Baseline + Action contribution + Included Factors`.
6. Company Forecast = Σ latest confirmed org versions.
7. A-03 / A-04 / A-05 / F-01 Action totals are identical for the same scope.

## 7. Mockup implementation notes
- `mockup/tools/generate-mock-data.mjs` writes every table above to `mockup/data/<table>.json` (and a `mock-db.js` bundle) and **fails if any §6 reconciliation breaks**.
- `mockup/js/measures.js` implements the §5 measures in JavaScript; it is the reference for the DAX implementation and its results are the expected values for semantic-model tests.
- Mockup writes (Adopt / Reject / Hold / Cancel, new Actions) mutate the in-memory tables the same way the production User Data Functions should (append-only decisions, audit events, override notices).

## 8. Open source-mapping items (TBD)
| Item | Status |
|---|---|
| Glasiaous API P&L columns → `slv_pl_line` | Pending working-table column list |
| Customer / product codes in P&L rows | Unknown |
| Budget source and grain (account vs Metric) | Unknown |
| Organization hierarchy source | Unknown |
| Account → Metric mapping owner | Unknown |
| Archive of replaced working table | Proposed `raw_glasiaous_pl_archive` |
