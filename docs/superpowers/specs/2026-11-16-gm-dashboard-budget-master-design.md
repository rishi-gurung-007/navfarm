# GM Dashboard — Budget master design

16 Nov 2026. Status: **proposed, not approved.** Nothing in this document is built.

## Intent

The GM Dashboard shows Budget and Var on every financial card, a budget line on the two YTD charts, and a colour dot on
every Slaughter & Financial row (Rishi's mockup). None of it has data: every Budget field reads N/A, because no budget
is recorded anywhere. This adds a **Budget master** where a user records, for a Reporting Period, a farm and a metric,
what was budgeted, and the dashboard reads it for the period it is showing.

## Decided by Rishi (16 Nov)

- A Budget master, in Farm Master, where the user **selects the Reporting Period** and **what the budget is for**, and
  enters the amount **as a number or a percentage**.
- The budget is **according to the reporting period the dashboard is showing**: choose a period on the dashboard and
  its budget is what Budget and Var compare against.
- The mockup is the target for how Budget, Var and the colours look (Budget 4,500 / Var +320 +7.1 %; Gross Margin %
  Budget 32.0 % / Var +3.4 pp).
- Everything else about the dashboard (colours for the production rows, responsive layout, eight farm columns) is
  already built and out of scope here.

## Goals

- Enter a budget line: Reporting Period, farm, metric, amount, optional tolerance %.
- The dashboard fills Budget and Var on the KPI cards, the budget line on the two YTD charts, and colours the
  Slaughter & Financial rows from the budget.
- Entering, changing or removing a budget changes the dashboard the next time it loads; nothing is recomputed in a job.

## Non-goals

- No approval workflow, versions or history of a budget (an edit overwrites; the audit log records it).
- No import from the sheet or a workbook, and the sheet's third block (Pigs to Slaughter ... Staff Overheads, three
  numbers per farm) is **not** loaded as budget: it is not known whether those numbers are annual or monthly.
- No phasing of a budget inside a period, no currency conversion (amounts are in the company's currency).
- No budgets for the production rows (Farrowing Rate ...): they keep the red / yellow / green levels from the sheet.
- No new dashboard cards; the mockup's cards already exist.

## Anti-goals

- A budget must never make an actual look better than it is: a farm or period with no budget shows N/A and no colour,
  never a zero budget and a huge variance.
- The dashboard must not slow down noticeably: budgets are read with one query per request.

## Constraints

- Additive tenant migration only; the next number and `when` come after the highest on **any** branch, checked the day
  it is written (this branch's last is 0257 / ...125; other branches have moved the number before).
- Company-scoped like every master; a farm's lines belong to the farm's company. Farm access is enforced on the server
  (the farm-scope coverage spec must list the new controller).
- English strings only (the translation fallback covers other languages).
- Verified by driving the running app and reading MySQL, not by a green suite.

## Approaches

1. **A new `gm_budget` table with a master screen in Farm Master** (chosen). One row per company, period, farm and
   metric. Real period-by-period budgets; the Reporting Period master is already there to select from.
2. **Budget values inside each farm's lifecycle KPI entries**, beside the red / yellow / green levels. Cheaper, but a
   lifecycle row has no period, so it can hold one budget per farm, not one per Reporting Period. Rejected: it cannot do
   what Rishi asked.
3. **A spreadsheet-style grid (periods across, metrics down) as the only entry screen.** Faster to fill a whole year,
   but a second kind of screen for a master. Left for later; the master list and form come first.

## The design

**Metrics.** A fixed list in code, not a master, each with its unit, its type and which direction is better:

| Metric | Type | Better is |
| --- | --- | --- |
| Pigs to Slaughter (head) | number, additive | higher |
| Avg CDM (kg) | number, ratio | higher |
| Cost of Sales | number, additive | lower |
| COS per tonne | number, ratio | lower |
| Gross Margin | number, additive | higher |
| Gross Margin % | percentage, ratio | higher |
| Other Overheads | number, additive | lower |
| Staff Overheads | number, additive | lower |
| Kg Meat Sold / Sow / Year | number, ratio | higher |
| PBT | number, additive | higher |

The metric fixes whether the amount is a number or a percentage (my call: "105 % of last year" is not what the mockup
shows, and a percentage of a head count means nothing). The form shows the unit next to the amount.

**A budget line.** Company, Reporting Period, farm, metric, amount, tolerance % (optional), notes, active flag, audit
columns. Unique on company + period + farm + metric among the live rows. Farm lines only: "All farms" on the dashboard
is derived, not entered.

**Reading it.**
- **Month budget** = the chosen period's line for the farm. **YTD budget** = the lines of the business year's periods up
  to and including the chosen one: summed for additive metrics, averaged for ratio metrics (only periods that have a
  line count; none means no budget).
- **All farms** = the sum of the farms' budgets for additive metrics, the average for ratio metrics.
- **Var** = actual minus budget; **Var %** = Var / budget; for a percentage metric the variance is in points (pp).

**Colour (Slaughter & Financial rows, and the Budget / Var arrows on the cards).** Favourable or equal to the budget =
green; unfavourable but within the line's tolerance = amber; beyond it = red. "Favourable" follows the table's
direction (below budget is favourable for cost metrics). Tolerance is entered on the line, defaulting to 10 % of the
budget when blank, the same default the dashboard already uses for its lifecycle targets (my call: per line, because a
single farm's overhead can be budgeted tighter than another's). No budget or no actual = no colour.

**Parts.**
- Migration and schema for `gm_budget`.
- A small API under Farm Master's masters: list (filters: period, farm, metric), read, create, edit, deactivate,
  restore; rules in a pure, spec-tested file (type per metric, amount must be a number within its metric's range (below), tolerance 0-100, one live
  line per key, the period must belong to the farm's company).
- A master config on the web (list and form: Reporting Period select, farm select, metric select, amount with its unit,
  tolerance, notes), a permission resource (view / create / edit / delete) in the role matrix and navigation.
- `getGmDashboard` returns, per farm and for all farms, the Month and YTD budget of each metric and the Var, from one
  query; the web fills the existing Budget / Var fields, the YTD chart lines and the financial-row colours.
- The Management Alerts list includes a red or amber financial row like it does the production rows.

**Left to the builder:** the migration number and `when`; the exact permission module and resource name (my
suggestion: module PIGGERY, resource BUDGET); form layout; copy of the validation messages; how an "All farms" figure is
labelled when only some farms have a line.

## Open points for Rishi

1. The sheet's third block (three numbers per farm for Pigs to Slaughter ... Staff Overheads): are they annual budgets,
   monthly budgets or colour levels? Until known they are not loaded.
2. Is a budget for **PBT** wanted now? The mockup has its chart, but there is no PBT figure in the data yet, so its
   Var stays N/A either way.

## Settled after the builder check (16 Nov) — my calls, change any that are wrong

**Where each metric appears.** Checked against the dashboard code.

| Metric | Has an actual today | Budget / Var slot |
| --- | --- | --- |
| Pigs to Slaughter | yes (sold disposals) | KPI card, matrix row, and the "Pigs to Slaughter - Progress vs Budget (YTD)" chart (budget line by period) |
| Cost of Sales | yes | KPI card, matrix row |
| Gross Margin | yes | KPI card, matrix row |
| Gross Margin % | yes | sub-line on the Gross Margin card, matrix row |
| Kg Meat Sold / Sow / Year | yes | its card (Month, YTD) |
| Avg CDM | no | KPI card, matrix row: budget shown, Var N/A until an actual exists |
| COS per tonne | no | sub-line on the Cost of Sales card, matrix row: same |
| Other Overheads, Staff Overheads | no | KPI card, sub-line, matrix row: same |
| PBT | no | "PBT - Progress vs Budget (YTD)" chart: budget line only |

Entry is allowed for every metric; a metric with no actual shows its budget and N/A for Var and colour.

**"All farms" and YTD when budgets are partial (the anti-goal wins).** A budget or Var is shown only when *every farm
in the comparison* has a line: All farms needs a line for each farm on the dashboard, and an additive YTD needs a line
for every period of the year so far. Otherwise the cell reads N/A, and its hover names what is missing (for example
"No budget for Richlands, Villa Franca"). It is never a partial sum compared with a full actual.

**Amounts.** Cost of Sales, Overheads, Pigs to Slaughter, Avg CDM, COS per tonne and Kg Meat Sold / Sow / Year take 0
or more. Gross Margin, Gross Margin % and PBT may be negative; Gross Margin % is within -100 to 100. A budget of 0 is
allowed (a farm may budget no overheads); then Var % is N/A, and the colour is green when the actual is favourable or
equal and red otherwise, since a tolerance of 0 % of 0 is 0.

**Tolerance.** Always relative to the budget's size: 10 % of a 32 % Gross Margin is 3.2 points. For a negative budget
the band uses the budget's absolute value. For YTD and All farms, the tolerance used is the average of the included
lines' tolerances, a blank counting as the 10 % default.

**Ratio metrics over a year or across farms** use the plain average of the lines, not one weighted by volume. The
actual is computed from its totals, so the two can differ slightly. Weighted budgets are a later refinement.

**Access.** A user sees the budget lines of the farms in their workspace only, and the All farms figure sums those
farms alone, the same way the dashboard's farm list already narrows. Which roles may view or change budgets is set in
the role matrix like any master; admins get it, others do not until granted.

**Database and test data.** The migration is applied to every tenant by the usual migrate command. Nothing is seeded.
For verification I would enter a few budget lines through the app on the local `nf_ccc` and say so first; they are
test data and get removed afterwards unless Rishi wants them kept.
