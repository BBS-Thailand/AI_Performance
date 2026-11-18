# HTML mockup (Phase 1)

Clickable mockup of the AI Management System. **All data and AI text are simulated.**
It reads only the tables defined in [../docs/data-model.md](../docs/data-model.md), through a
JavaScript copy of the semantic-model measures, so the Fabric app can later swap the data source.

## Open
Double-click `index.html` (no server or internet needed). Deep links: `index.html#A02:PT-001`, `index.html#A05:ACT-001-SL-A01`, `index.html#C03:ACT-001-SL-A01`. The C-03 AI uses the internet only when an API key is set.

## Regenerate mock data
```sh
node mockup/tools/generate-mock-data.mjs
```
The generator asserts the reconciliations (slide figures, Point + Other = variance, Forecast bridge,
Σ departments = company, OP = GP − SG&A) and refuses to write data if any check fails.

## Structure
| Path | Purpose |
|---|---|
| `data/*.json` | One file per table (review / load into Fabric for tests) |
| `data/mock-db.js` | Same tables bundled for the browser |
| `js/measures.js` | Semantic-model measure stand-in (also used by the generator) |
| `js/i18n.js` | UI labels: en / ja / th complete; zh-Hans / zh-Hant / id / vi core labels |
| `js/app.js` | Shell, global context, charts, permissions, decision writes |
| `js/screens/*.js` | One file per screen |

## Status
| Stage | Screens |
|---|---|
| 1 (done) | Shell and global context, A-01, A-02, P-01, Adopt / Reject / Hold / Cancel adoption, permissions, override notice |
| 2 | A-03 (done: Action Board, Metric filter, status counts, progress update → outlook reforecast → F-01), A-04 (done: stacked monthly effects, legend, reconciled table, AI comment), A-05 (done: effect figures, measured-figure graph, AI assessment, change history), C-03 (done: one chat per adopted Action started by a user who invites participants, @mentions, in-app bell + simulated email, 💬 header list of the chats each user can open with unread counts, @AI and Summarize answers visible to all participants, private Draft reply, Translate) |
| 3 (done) | F-01 (three forecast options, model info, key drivers), P-02 (fixed factor list; driver or amount input), version confirmation and company roll-up |
| 4 | B-01 (done: left panel with Dimensions, Measures and Saved views as in the concept slide; pivot table with one or more measures, scenario, filters, drill-down, and a chart below), B-02 (done: nine standard reports by category, favorites, single-month / YTD, budget and prior-year comparison, confirmed Forecast version, AI Comment section under the report), C-01 (done: right panel from the header AI chat button on every screen; context line; read-only data tools anchored to the screen’s period and organization plus related data; app-drawn charts, sources, [Open …] buttons; what-if “stop this Action” calculated by the app; suggested questions without a key), FN-01, FN-02 |

Demo tips: on A-03, the ✎ next to a progress value (owning organization, latest closed month) reforecasts the outlook; F-01 and A-04 update at once. Switch **Demo user** to see permission scopes (for example, the Overseas Sales head can't decide
Sales Dept. Actions). On B-01, tick up to two dimensions in the left panel (first = rows, second = columns), click ▸ on a row to drill down (region → customer, quarter → month …) and click a saved view to reload a layout. On C-03, pick an Action marked “no chat yet” to start a chat and invite people (every invitee always gets an email and a bell notification); in a chat, type `@AI …` or click **Summarize**: the AI answer is posted for every participant (Draft reply stays private). Click **AI chat** in the header on any screen for C-01: try a suggested question (works without a key) or, with a key, ask your own (e.g. “break SG&A down by account”, “what if ACT-001-SL-A01 is stopped?”). Paste a Claude API key in the AI bar (C-01 and C-03 share it) for real answers (kept in this browser tab only); without one the AI gives pre-written replies. Changes are kept in memory only; reload or **Reset demo data** to start over.
