# HTML mockup (Phase 1)

Clickable mockup of the AI Management System. **All data and AI text are simulated.**
It reads only the tables defined in [../docs/data-model.md](../docs/data-model.md), through a
JavaScript copy of the semantic-model measures, so the Fabric app can later swap the data source.

## Open
Double-click `index.html` (no server or internet needed). Deep links: `index.html#A02:PT-001`.

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
| 2 | A-03, A-04, A-05, C-03 |
| 3 | F-01, P-02, version confirmation |
| 4 | B-01, B-02, C-01, FN-01, FN-02 |

Demo tips: switch **Demo user** to see permission scopes (for example, the Overseas Sales head can't decide
Sales Dept. Actions). Changes are kept in memory only; reload or **Reset demo data** to start over.
