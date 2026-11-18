# GM Dashboard Budget Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Budget master in Farm Master (Reporting Period × farm × metric → amount) whose lines fill the GM Dashboard's Budget, Var, YTD-chart budget line and Slaughter & Financial colours for the period the dashboard shows.

**Architecture:** One new table `gm_budget`, a thin company-scoped CRUD module under `/piggery/budget` (rules in a pure spec-tested file, the way the Logistics masters do it), and two pure functions that turn lines into a Month / YTD / All-farms budget and a variance colour. `PiggeryAnalyticsService.getGmDashboard` reads the lines in one query and returns them; the web fills the existing Budget / Var slots. Entry is a normal Farm Master master config.

**Tech Stack:** NestJS + Drizzle (MySQL tenant migrations), Jest, Next.js/React. Run through `pnpm nx` with `NX_WORKSPACE_ROOT_PATH` unset (memory: nx-always-runs-in-main-checkout); cap jest workers (8 GB machine): `npx jest -w 2`.

**Spec:** `docs/superpowers/specs/2026-11-16-gm-dashboard-budget-master-design.md` (approved 16 Nov). Read its "Settled after the builder check" section too.

## Global Constraints

- Additive tenant migration only. The next number and `when` come after the highest on **any** branch, checked the day it is written; this branch's last is `0257_batch_transfer_trip`, idx 254, `when` 1792000000125, so expect `0258_gm_budget` / 1792000000126 unless another branch has moved.
- Company-scoped like every master; a line's `company_id` is its farm's company. Farm access is enforced on the server (`@FarmScoped()` controller; list and read narrow by `locationReferenceScopeConditions`).
- Permission: module `PIGGERY`, resource `BUDGET` (view / create / edit / delete). Admins get it; nobody else until granted in the role matrix.
- English strings only (`en` dictionary; `t()` falls back for other languages).
- Metrics (fixed list in code), with type, aggregation and direction exactly as the spec's table: PIGS_TO_SLAUGHTER number/sum/higher; AVG_CDM number/mean/higher; COST_OF_SALES number/sum/lower; COS_PER_TONNE number/mean/lower; GROSS_MARGIN number/sum/higher; GROSS_MARGIN_PCT percent/mean/higher; OTHER_OVERHEADS number/sum/lower; STAFF_OVERHEADS number/sum/lower; KG_SOLD_PER_SOW_YEAR number/mean/higher; PBT number/sum/higher.
- Amount ranges: all metrics ≥ 0 except GROSS_MARGIN, GROSS_MARGIN_PCT and PBT, which may be negative; GROSS_MARGIN_PCT within -100 to 100. Tolerance 0-100, blank means 10 (the default).
- A budget or Var is shown only when every farm in the comparison has a line (All farms), and every period so far has one (additive YTD); otherwise N/A with the missing names in the hover. Never a partial sum against a full actual.
- Var = actual - budget; Var % = Var / |budget| (N/A at a budget of 0); a percentage metric's variance is in points. Colour: favourable or equal = GREEN; unfavourable within tolerance (% of |budget|) = AMBER; beyond = RED; no budget or no actual = no colour. YTD / All farms tolerance = mean of the included lines' tolerances (blank counts as 10).
- Verify by driving the running app and reading MySQL, not by a green suite (CLAUDE.md). Enter test budget lines only on the local `nf_ccc`, tell Rishi first, and remove them after unless he wants them.
- One commit per task; do not push.

## Review Focus

- A budget of 0 (a farm budgets no overheads): Var % is N/A, colour green when actual ≤ budget for a LOWER metric, never a divide-by-zero. Owned by Task 4.
- A negative Gross Margin / PBT budget: favourable still means "higher", and tolerance uses |budget|. Task 4.
- A line for a period of another company, or a "farm" that is a shed or a farm of another company: refused. Task 3.
- A soft-deleted line then a new line for the same key: allowed; two live lines for one key: refused. Task 3.
- The chosen period is the first of its business year (YTD = Month), or has no lines at all, or a farm the user may not see: N/A, never 0, and All farms counts only visible farms. Tasks 4 and 5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `apps/api/src/modules/piggery/budget/budget-metrics.ts` (+ `.spec.ts`) | the fixed metric catalogue and `budgetProblems` |
| `apps/api/src/drizzle/tenant/0258_gm_budget.sql`, `meta/_journal.json`, `gm-budget-migration.spec.ts` | table |
| `apps/api/src/core/database/schema.ts` | `gmBudget` table |
| `apps/api/src/modules/piggery/budget/budget.service.ts`, `budget.controller.ts`, `budget.module.ts` (+ `budget.service.spec.ts`) | master CRUD |
| `apps/api/src/modules/piggery/analytics/gm-budget.metrics.ts` (+ `.spec.ts`) | pure: Month / YTD / All-farms budget, variance, colour |
| `apps/api/src/modules/piggery/analytics/piggery-analytics.service.ts`, `.dto.ts` | one read of the lines; `budget` and `financial_rows` in the response |
| `apps/web/src/modules/master-data/budget-configs.ts`, `configs.ts` | the master screen |
| `apps/web/src/components/console/console-tabs/roles-tab.tsx`, `apps/web/src/utils/nav-permissions.ts`, `translations.ts` | grants, nav, copy |
| `apps/web/src/components/console/piggery/piggery-gm-dashboard.tsx`, `gm-dashboard-widgets.tsx` | Budget / Var, chart line, colours |
| `docs/VERIFICATION-<date>-gm-budget.md` | live evidence |

---

### Task 1: Metric catalogue and entry rules

**Files:**
- Create: `apps/api/src/modules/piggery/budget/budget-metrics.ts`, `apps/api/src/modules/piggery/budget/budget-metrics.spec.ts`

**Interfaces:**
- Produces:
  - `type BudgetMetricCode = 'PIGS_TO_SLAUGHTER' | 'AVG_CDM' | 'COST_OF_SALES' | 'COS_PER_TONNE' | 'GROSS_MARGIN' | 'GROSS_MARGIN_PCT' | 'OTHER_OVERHEADS' | 'STAFF_OVERHEADS' | 'KG_SOLD_PER_SOW_YEAR' | 'PBT'`
  - `interface BudgetMetric { code: BudgetMetricCode; label: string; unit: string; amountType: 'NUMBER' | 'PERCENT'; aggregation: 'SUM' | 'MEAN'; better: 'HIGHER' | 'LOWER'; min: number; max: number | null; dashboardKey: string }` (`dashboardKey` is the dashboard row key: `pigs_to_slaughter`, `avg_cdm`, `cost_of_sales`, `cos_per_tonne`, `gross_margin`, `gross_margin_pct`, `other_overheads`, `staff_overheads`, `kg_sold_per_sow_year`, `pbt`)
  - `const BUDGET_METRICS: BudgetMetric[]`, `function budgetMetric(code: string): BudgetMetric | undefined`
  - `function budgetProblems(values: Record<string, unknown>): string[]` — plain-words problems for `{ metric_code, amount, tolerance_pct }`; empty means valid.

- [ ] **Step 1: Write the failing spec.** Tests: `catalogue holds the ten metrics with the spec's type, aggregation and direction` (assert each row); `rejects an unknown metric`; `rejects a negative amount for COST_OF_SALES but allows it for GROSS_MARGIN and PBT`; `GROSS_MARGIN_PCT allows -100 and 100, rejects 100.01 and -100.01`; `allows an amount of 0`; `rejects a non-numeric amount`; `tolerance must be blank or 0-100`.
- [ ] **Step 2: Run** `cd apps/api && env -u NX_WORKSPACE_ROOT_PATH npx jest -w 2 src/modules/piggery/budget/budget-metrics.spec.ts` — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** both exports in `budget-metrics.ts`; messages name the metric and the allowed range.
- [ ] **Step 4: Run the spec** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Budget master metric catalogue and entry rules`.

### Task 2: `gm_budget` table

**Files:**
- Create: `apps/api/src/drizzle/tenant/0258_gm_budget.sql`, `apps/api/src/drizzle/tenant/gm-budget-migration.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`, `apps/api/src/core/database/schema.ts` (after `reportingPeriod`)

**Interfaces:**
- Produces: `schema.gmBudget { budget_id, tenant_id, company_id, period_id, farm_id, metric_code, amount_type, amount, tolerance_pct, notes, is_active, created_by, updated_by, created_at, updated_at, deleted_at }` — `amount` decimal(18,4) not null, `tolerance_pct` decimal(6,2) null, `metric_code` varchar(40), `amount_type` varchar(10); index `idx_gm_budget_lookup (tenant_id, company_id, period_id, farm_id)`.

- [ ] **Step 1: Failing spec** in the style of `logistics-masters-migration.spec.ts`: the journal has an entry tagged `0258_gm_budget` whose `when` exceeds every earlier one, idx is contiguous, and the SQL creates `gm_budget` with the columns above.
- [ ] **Step 2: Run it** (`npx jest -w 2 src/drizzle/tenant/gm-budget-migration.spec.ts`) — FAIL.
- [ ] **Step 3: Re-check the number**: `git fetch origin` and read the last journal entry of every remote branch; use the next free number and a `when` above all of them. Write the SQL (CREATE TABLE, the index), the journal entry, and the Drizzle table.
- [ ] **Step 4: Run the spec and `env -u NX_WORKSPACE_ROOT_PATH ../../node_modules/.bin/tsc --noEmit -p tsconfig.app.json`** — spec PASS; no new type errors (the scratch `tmp-exp/probe.ts` error is old).
- [ ] **Step 5: Apply to `nf_ccc` only** with the reconcile script (`pnpm nx run api:db-reconcile-tenant-migrations -- --tenant ccc`, read-only run first, then `--apply` on its own) and read back `SHOW CREATE TABLE gm_budget`.
- [ ] **Step 6: Commit** `feat: gm_budget table`.

### Task 3: Budget master API

**Files:**
- Create: `apps/api/src/modules/piggery/budget/budget.service.ts`, `budget.controller.ts`, `budget.module.ts`, `budget.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (import `BudgetModule`)

**Interfaces:**
- Consumes: `BUDGET_METRICS`, `budgetMetric`, `budgetProblems` (Task 1); `schema.gmBudget` (Task 2).
- Produces: `BudgetService.findAll(query: { periodId?: string; farmId?: string; metricCode?: string; isActive?: string; limit?: string; offset?: string }, tenantId: string): Promise<{ data: Row[]; total: number; limit: number; offset: number }>` (rows carry `period_code`, `farm_code`, `farm_name`, `metric_label`, `unit`); `findOne(id, tenantId)`; `create(body, tenantId, user)`; `update(id, body, tenantId, user)`; `deactivate(id, tenantId, user)`; `restore(id, tenantId, user)`. Routes under `/piggery/budget`: `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id` (deactivate), `PATCH /:id/restore`, plus `GET /metrics` (the catalogue) declared before `:id`; each guarded `@RequirePermission('PIGGERY', 'BUDGET', 'view' | 'create' | 'edit' | 'delete')`, controller `@FarmScoped()`.

- [ ] **Step 1: Failing spec** with a table-keyed db double like `logistics-trip.service.spec.ts`. Tests: `creates a line with the farm's company and the metric's amount type`; `refuses a period of another company`; `refuses a farm that is not a top-level FARM, or not the user's to see`; `refuses a second live line for the same period, farm and metric`; `allows a new line after the old one was deactivated`; `edit cannot change period, farm or metric` (those are fixed once saved); `list and read hide lines of farms outside the user's scope`; `deactivate then restore`; `amount and tolerance are validated through budgetProblems`.
- [ ] **Step 2: Run** `npx jest -w 2 src/modules/piggery/budget/budget.service.spec.ts` — FAIL.
- [ ] **Step 3: Implement** service, controller, module. The line's company is the farm's `company_id`; narrow reads with `locationReferenceScopeConditions(farmScope(cls), B.farm_id)` from `common/farm-scope`; audit through `AuditLogService` like the logistics service; writes in `withTenantTransaction`; plain-words `BadRequestException`s.
- [ ] **Step 4: Run the spec, the farm-scope coverage spec** (`src/common/farm-scope-coverage.spec.ts`) **and tsc** — PASS.
- [ ] **Step 5: Commit** `feat: Budget master API`.

### Task 4: Budget aggregation and variance (pure)

**Files:**
- Create: `apps/api/src/modules/piggery/analytics/gm-budget.metrics.ts`, `gm-budget.metrics.spec.ts`

**Interfaces:**
- Consumes: `BudgetMetric`, `BudgetMetricCode` (Task 1).
- Produces:
  - `interface BudgetLine { period_id: string; farm_id: string; metric_code: BudgetMetricCode; amount: number; tolerance_pct: number | null }`
  - `interface BudgetFigure { budget: number | null; tolerance_pct: number | null; missing: string[] }` (`missing` names the farm codes or period codes that have no line)
  - `function monthBudget(lines: BudgetLine[], metric: BudgetMetric, periodId: string, farms: Array<{ farm_id: string; farm_code: string }>): BudgetFigure` — for a given farm list (one farm, or every visible farm for All farms); SUM or MEAN across them; `missing` lists farms without a line; any missing means `budget: null`.
  - `function ytdBudget(lines, metric, periodIds: Array<{ period_id: string; period_code: string }>, farms): BudgetFigure` — over the business year's periods up to the chosen one; additive: every farm × period needs a line (else null, `missing` lists them); ratio: the mean of the lines present, null only when there is none.
  - `type VarianceStatus = 'GREEN' | 'AMBER' | 'RED' | null`
  - `function variance(actual: number | null, budget: number | null, metric: BudgetMetric, tolerancePct: number | null): { var: number | null; var_pct: number | null; status: VarianceStatus }`.

- [ ] **Step 1: Failing spec.** Tests (spec values): `month budget of one farm is its line`; `All farms sums an additive metric and means a ratio metric`; `a farm without a line makes All farms null and names it`; `additive YTD needs every period; ratio YTD means the lines present`; `YTD of the first period equals its Month`; `variance is actual minus budget and % of |budget|`; `budget 0 gives var_pct null and green when favourable or equal, red otherwise`; `negative GROSS_MARGIN budget uses |budget| for tolerance`; `cost metric below budget is GREEN, above within 10% AMBER, beyond RED`; `GROSS_MARGIN_PCT 35.4 vs 32.0 is +3.4 points GREEN`; `no actual or no budget gives no colour`; `tolerance blank counts as 10, and the aggregate tolerance is the mean of the lines' (blank as 10)`.
- [ ] **Step 2: Run** `npx jest -w 2 src/modules/piggery/analytics/gm-budget.metrics.spec.ts` — FAIL.
- [ ] **Step 3: Implement** the four functions; no I/O. Round figures to 4 decimals the way `gm-dashboard.metrics.ts` does.
- [ ] **Step 4: Run the spec** — PASS.
- [ ] **Step 5: Commit** `feat: GM Dashboard budget aggregation and variance rules`.

### Task 5: Dashboard API returns budgets

**Files:**
- Modify: `apps/api/src/modules/piggery/analytics/piggery-analytics.service.ts`, `piggery-analytics.dto.ts`, `piggery-analytics.service.spec.ts` (or the nearest existing analytics service spec; create one if none)

**Interfaces:**
- Consumes: Tasks 1, 2 and 4.
- Produces, added to `PiggeryGmDashboardData`: `budget: { month: Record<string, Record<string, BudgetCell>>; ytd: Record<string, Record<string, BudgetCell>>; by_period: Array<{ period_code: string; pigs_to_slaughter: number | null; pbt: number | null }> }` keyed first by farm id or `'all'`, then by the metric's `dashboardKey`, where `interface BudgetCell extends BudgetFigure { actual: number | null; var: number | null; var_pct: number | null; status: VarianceStatus }`; and `financial_rows: MetricRow[]` (the eight Slaughter & Financial rows, each cell `{ value: actual, target: budget, status }`, the Month comparison). Alerts include a RED or AMBER financial row like the production rows (`alertsFrom([...breeding, kgRow, ...weanerGrower, ...financialRows], farms)`).

- [ ] **Step 1: Failing test.** With a db double: `reads all budget lines of the visible farms and the business year's periods in one query`; `Month and YTD cells carry budget, actual, var and status for a farm and for all`; `a metric with no actual (Avg CDM) has a budget and a null var`; `a farm the user cannot see is left out of All farms`; `no lines gives null budgets, never 0`; `a RED financial row reaches the alerts`.
- [ ] **Step 2: Run it** — FAIL.
- [ ] **Step 3: Implement** in `getGmDashboard`: one `select` of live, active `gm_budget` rows for the visible farm ids and the year's period ids; build cells with `monthBudget`, `ytdBudget`, `variance`; actuals from the figures the service already has (heads, cost_of_sales, gross_margin, gross_margin_pct per farm and `'all'`; `kgMonth` / `kgYtd`). `by_period` is the chosen farm's (or All farms') budget of PIGS_TO_SLAUGHTER and PBT per period of the business year.
- [ ] **Step 4: Run the analytics specs (`npx jest -w 2 src/modules/piggery`) and tsc.** Expected: only the 5 already-failing tests (animal-stage-history, breeding controller) fail; nothing new.
- [ ] **Step 5: Commit** `feat: GM Dashboard API returns budgets, variance and financial row colours`.

### Task 6: Budget master screen

**Files:**
- Create: `apps/web/src/modules/master-data/budget-configs.ts`, `apps/web/specs/budget-configs.spec.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts` (spread `BUDGET_CONFIGS`), `apps/web/src/components/console/console-tabs/roles-tab.tsx` (add resource `BUDGET` under module PIGGERY), `apps/web/src/utils/nav-permissions.ts`, `apps/web/src/utils/translations.ts` (en only)

**Interfaces:**
- Produces: `BUDGET_CONFIGS: MasterDataConfig[]` (one config, key `budget`, `apiBase: '/piggery/budget'`, `idKey: 'budget_id'`, `group: 'Budget'`, `supportsRestore: true`, `businessAdminOnly: true`) and `BUDGET_GRANTS: Record<string, ['PIGGERY', string]>` = `{ budget: ['PIGGERY', 'BUDGET'] }`, wired the way `LOGISTICS_GRANTS` is. Form fields in this order: Reporting Period (`select-entity`, `/reporting-period`, label `period_code`), Farm (`select-entity`, `/location?locationType=FARM&rootOnly=true&isActive=true`), Metric (`select` from `GET /piggery/budget/metrics`), Amount (number, with the metric's unit as help text), Tolerance % (number, optional, help: "Blank means 10 %"), Notes. Period, Farm and Metric are read-only when editing. Columns: Period, Farm, Metric, Amount, Tolerance %, Active.

- [ ] **Step 1: Failing spec** (style of `master-data-feed-masters.spec.ts`): `budget config is registered with its grant`, `period, farm and metric are required and read-only on edit`, `the grant appears in the role matrix list`.
- [ ] **Step 2: Run** `cd apps/web && env -u NX_WORKSPACE_ROOT_PATH npx jest -w 2 specs/budget-configs.spec.ts` — FAIL.
- [ ] **Step 3: Implement** the config, grants, role-matrix entry (labels "Budget" / actions view, create, edit, delete) and nav entry; add English strings only.
- [ ] **Step 4: Run the spec, the existing master-data specs (`npx jest -w 2 specs/master-data`) and `../../node_modules/.bin/tsc --noEmit -p tsconfig.json`** — PASS (the unused `DateInput` import error is fixed on `main`; ignore it on this branch until merged).
- [ ] **Step 5: Commit** `feat: Budget master screen in Farm Master`.

### Task 7: Dashboard shows budgets and colours

**Files:**
- Modify: `apps/web/src/components/console/piggery/piggery-gm-dashboard.tsx`, `gm-dashboard-widgets.tsx`, `apps/web/specs/piggery-gm-dashboard.spec.tsx`

**Interfaces:**
- Consumes: `budget` and `financial_rows` from Task 5 (the web type `PiggeryGmDashboardData` gains the same fields).
- Produces: nothing new for other tasks.

- [ ] **Step 1: Failing spec additions.** `KPI cards show Budget and Var from the API` (Pigs to Slaughter Month: Budget 4,500, Var +320, +7.1 %); `a percentage metric's Var reads in points` (Gross Margin %: Budget 32.0 %, Var +3.4 pp); `a cost metric under budget reads favourable`; `a null budget shows N/A and the hover names the missing farms`; `the Slaughter & Financial rows take their dot colour from financial_rows`; `the Pigs to Slaughter chart draws the budget line from budget.by_period`; `the PBT chart draws only its budget line`.
- [ ] **Step 2: Run** `npx jest -w 2 specs/piggery-gm-dashboard` — FAIL.
- [ ] **Step 3: Implement.** Fill each `Figure.budget` (and the var fields the card already renders) from `data.budget.month|ytd[farmKey][metric.dashboardKey]`, where `farmKey` is the selected farm id or `'all'`; replace the web-built `financial` rows with `data.financial_rows` when present; feed `yearPoints[].budget` from `by_period`; give each N/A budget a `HoverHint` naming `missing`. Keep the layout classes from the responsive work.
- [ ] **Step 4: Run the dashboard specs and tsc** — PASS.
- [ ] **Step 5: Commit** `feat: GM Dashboard shows Budget, Var and financial colours`.

### Task 8: Live verification

**Files:**
- Create: `docs/VERIFICATION-<date>-gm-budget.md`

- [ ] **Step 1: Ask Rishi** before writing test lines, naming the farms, period and amounts you will enter on `nf_ccc`.
- [ ] **Step 2: Restart the API cleanly** (`nx serve api` does not always rebuild) and confirm `dist/main.js` contains `gm_budget`.
- [ ] **Step 3: Through the Farm Master screen** (browser pane, `tenant.admin@ccc.com`), enter lines for Grasmere, period 2026-10: Pigs to Slaughter 100 (number), Cost of Sales 15,000, Gross Margin 25,000, Gross Margin % 40, Other Overheads 0. Read `gm_budget` in MySQL: company, amount type, tolerance NULL.
- [ ] **Step 4: On the dashboard** choose 2026-10: Budget, Var and the colours match hand arithmetic from the Month figures; All farms reads N/A with the missing farms named (only Grasmere has lines); the budget of 0 shows Var % N/A. Add the other seven farms' Pigs to Slaughter lines and check All farms becomes the sum. A user with a single-farm scope sees only that farm's figures.
- [ ] **Step 5: Refusals through the screen:** a duplicate line, a negative Cost of Sales, Gross Margin % 101, a second company's period.
- [ ] **Step 6: Remove the test lines** unless Rishi wants them kept; write the evidence file with the MySQL reads and screenshots; commit `docs: GM budget live verification`.
