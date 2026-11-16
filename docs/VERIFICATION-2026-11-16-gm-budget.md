# GM Dashboard Budget master — live verification, 16 Nov 2026

Driven through the running app (API and web from `feat/monthly-ops-report`, tenant `nf_ccc`, signed in as
`tenant.admin@ccc.com`) and read back from local MySQL. Not a test-suite result. Spec:
`docs/superpowers/specs/2026-11-16-gm-dashboard-budget-master-design.md`; plan:
`docs/superpowers/plans/2026-11-16-gm-dashboard-budget-master.md`.

## What the live run found that the suites did not
| Found | Fixed in |
| --- | --- |
| The Budget screen could not create a line: the web form posted `location_id`, the API reads `farm_id`. Each side's tests passed over the broken contract. | fe6bba5b |
| The Budget list returned 400 for any user with an active company: the master table sends `companyId`, `search`, `sort`, `dir`, `filter[...]`, which the list DTO did not declare (`forbidNonWhitelisted`). | 90787cb4 |
| The Reporting Period picker offered only the one active period (2024-07) of 36, because the generic table forces `isActive=true` on every picker. | e5ae9e6b (opt-in `entityIncludeInactive`) |

## Proven against MySQL (`nf_ccc.gm_budget`)
| Check | Result |
| --- | --- |
| Create through the API | 201; `company_id` = the farm's company (all-zero), `amount_type` from the metric (NUMBER / PERCENT), `tolerance_pct` NULL when blank |
| Create through the real screen (period 2026-11, farm MUL100, Pigs to Slaughter) | row written with company, farm, period, metric, creator. (Amount read 143143: the tester entered it twice, not an app fault; corrected to 143 by an edit.) |
| Duplicate live line | 409 |
| Cost of Sales -5; Gross Margin % 101; tolerance 101; unknown metric; unknown farm; a shed as the farm | 400 each |
| Negative Gross Margin (-500) | allowed (201) |
| Deactivate, then create the same key again | 200, then 201 (a deactivated line does not block) |
| Restore while a live line for the key exists | 409 |
| Edit tries to change the metric | 400; editing amount and tolerance 200 |
| `GET /piggery/budget/metrics` | min / max `null` where there is no bound (never the MIN_SAFE_INTEGER stand-in) |
| List with `companyId`, `search`, `sort`, `dir`, `limit`, `offset` | 200 (was 400) |
| A farm-bound user (`user@ccc.com`, Porta) | 403 on list, read and edit of Grasmere lines; the existing dashboard also 403 for that user |
| Reporting Period picker on the Budget form | lists all 36 periods incl. 2026-10 and 2026-11 |
| Farm picker | all 8 farms |

## The dashboard with budgets (period 2026-10, Grasmere = MUL100)
399 lines were loaded through the API (10 metrics x 8 farms x periods 2026-07..2026-11) plus the one line above made on the
screen: 400 rows. Hand arithmetic against the API response and the page:

| Metric | Actual | Budget | Var | Colour |
| --- | --- | --- | --- | --- |
| Pigs to Slaughter | 147 | 138 | +9, +6.5 % | GREEN |
| Cost of Sales (lower is better) | 20,872.04 | 20,140 | +732.04, +3.6 % over | AMBER (within 10 %) |
| Gross Margin | 15,554.56 | 18,020 | -2,465.44, -13.7 % | RED |
| Gross Margin % | 42.7 | 40 | +2.7 points (var % null) | GREEN |
| Kg Meat Sold / Sow / Year | 0 (no sale recorded) | 3,095 | -3,095 | RED |
| Avg CDM, COS per tonne, overheads, PBT | none exist | shown | N/A | no colour |

- The Slaughter & Financial matrix dots, the hover "Budget 138" wording, the one-farm Var and the cumulative `by_period`
  series (781, 1,576, 2,387, 3,214, 4,057) match.
- "All Farms" compares the budget of all eight farms with the actuals of Grasmere only (the one farm with records), so it
  reads far under budget; that is the data, not the arithmetic.
- A red or amber financial row reaches the alerts (Grasmere Gross Margin RED, Cost of Sales AMBER).

## Not done / still open
- A budgeted farm that sold nothing in the month shows no colour (a null actual); whether it should read as 0 sold (red)
  is Rishi's call.
- Nothing was driven in a second company or with a farm-scoped user who holds the PIGGERY/BUDGET grant.
- The charts' dashed budget line was proven by the data handed to the chart, and by the page rendering; look at it once in
  a browser at full width.
- The test data (400 lines) stays on `nf_ccc`; remove with `DELETE FROM nf_ccc.gm_budget;`.
