# Mill Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Feed Plan tab with a Mill Planning tab that, on Generate, shows a one-week, all-farm forecast for the mill (capacity strip, cards, production by feed type, diet changes, farm × shed × day grid with silo rows), and retire Feed Plan's background jobs.

**Architecture:** A pure rule (`mill-plan.rules.ts`) folds per-farm forecasts, approved requisitions, posted mill output and mill capacity into one `MillPlan`. A thin `MillPlanService` gathers those inputs (the existing per-farm engine via `FeedForecastService.getForecast`, `MillCapacityService`, `FeedSettingsService`) and is served at `GET /feed-forecast/mill-plan`. The web gets one new panel in the place of `feed-plan-panel.tsx`. Feed Plan's endpoints, scheduler job, post-approval refresh and alert closing are removed; the `feed_plan` tables and rows stay.

**Tech Stack:** NestJS + Drizzle (MySQL, per-tenant), Next.js 15 / React, Jest. Nx monorepo.

**Spec:** `docs/superpowers/specs/2026-11-03-mill-planning-design.md`

## Global Constraints

- Work in the main checkout `/Users/nero/Desktop/navfarm` on the current branch. No worktrees.
- Run every nx/jest command as `env -u NX_WORKSPACE_ROOT_PATH …`; jest with `--maxWorkers=2` (8 GB machine).
- New UI strings go in the `en` dict of `apps/web/src/utils/translations.ts` only.
- Every number shown comes from NAVFarm data; no constants copied from the mockup (no 120 t/day, no "+4.2 %", no farm names).
- Nothing computes until **Generate** is clicked; a filter change after Generate does not recompute.
- Horizon is exactly 7 days: Week of … Week of + 6.
- Permission: `@RequirePermission('INVENTORY', 'LEDGER', 'view')`, the same as the other Feed Forecast endpoints.
- Farm scope: only farms returned by `FeedForecastService.listFarms(tenantId, userType)`.
- Do not delete anything from the database. No migration in this plan.
- No commit or push without Rishi's OK. The commit steps below are prepared, not run, until he says so.
- Verify by driving the app (preview "api" and "web" in `.claude/launch.json`) and reading MySQL (`nf_ccc`), not by tests alone.

## Review Focus

1. **A farm whose forecast fails** (no lifecycle, no feed rows, engine throws). Expect the plan to still generate for the other farms, with the failed farm listed by name and its error, not a 500 for the whole page. Test in Task 2.
2. **The mill has no daily capacity set** (`mill_daily_capacity_kg` null) or the company has no MILL. Expect the strip to show "capacity not set" per day and the rest of the plan to render. Test in Task 1.
3. **An approved requisition already partly produced.** Expect approved-not-produced = max(0, approved − posted output) per date and item, never negative. Test in Task 1.
4. **The Feed Types filter excludes a diet-change target.** Expect the diet change to still be listed when either its from-feed or its to-feed is selected, and shed cells to count only the selected feeds. Test in Task 1.
5. **A shed with two batches, or a silo feeding several sheds.** Expect one shed row per batch line, and one silo row per silo, never summed twice. Test in Task 1.

---

### Task 1: The pure mill-plan rule

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/mill-plan.rules.ts`
- Test: `apps/api/src/modules/inventory/feed-forecast/mill-plan.rules.spec.ts`

**Interfaces:**
- Consumes: `DailyForecastRow`, `DietChange`, `SourceBalancePoint` from `./feed-forecast.engine`; `MillDemandLine`, `DietCapacity`, `MillCapacitySetup` from `./mill-capacity.rules`.
- Produces:

```ts
export interface MillPlanFarmInput {
  farm: { id: string; code: string; name: string };
  daily: DailyForecastRow[];               // the 7 dates only
  sourceBalances: Array<SourceBalancePoint & { sourceName: string | null; feedType: 'BULK' | 'BAGGED' }>;
  dietChanges: DietChange[];
}
export interface MillPlanInput {
  dates: string[];                          // exactly 7, ascending
  farms: MillPlanFarmInput[];
  failedFarms: Array<{ farmId: string; code: string; name: string; error: string }>;
  itemIds: string[] | null;                 // Feed Types filter; null = all
  items: Map<string, { itemCode: string; itemName: string; feedForm: 'BULK' | 'BAGGED' | null }>;
  approved: MillDemandLine[];               // approvedDemand(...).lines
  producedKg: Array<{ productionDate: string; itemId: string; quantityKg: number }>;
  mill: (MillCapacitySetup & { millName: string }) | null;
  capacityByDate: Map<string, Map<string, DietCapacity>>; // allocateOnDates result for the production totals
  warningPct: number;                       // capacityWarningPct, 0–100
}
export type DayStatus = 'OK' | 'WARN' | 'OVER' | 'NO_CAPACITY';
export interface MillPlan {
  dates: string[];
  mill: { millId: string; millCode: string; millName: string; dailyKg: number | null } | null;
  capacity: Array<{ date: string; productionKg: number; capacityKg: number | null; usedPct: number | null; status: DayStatus }>;
  cards: { totalKg: number; farms: number; sheds: number; silos: number; feedTypes: number; dietChanges: number; daysNearOrOver: number; silosRunningOut: number };
  production: Array<{ itemId: string; itemCode: string; itemName: string; feedForm: 'BULK' | 'BAGGED' | null;
    days: Array<{ date: string; approvedKg: number; forecastKg: number; totalKg: number; capacity: DietCapacity | null }>; totalKg: number }>;
  dietChanges: Array<{ farmId: string; farmName: string; shedCode: string; batchNo: string; changeDate: string; fromItemName: string; toItemName: string; heads: number }>;
  farms: Array<{ farmId: string; code: string; name: string; totals: number[]; // kg per date
    sheds: Array<{ key: string; shedCode: string; batchNo: string; heads: number; items: Array<{ itemId: string; itemName: string }>; changeDate: string | null; kg: number[] }>;
    silos: Array<{ sourceCode: string; sourceName: string | null; sourceType: 'SILO' | 'STORE'; itemName: string; openingKg: number; closingKg: number[]; runOutDate: string | null }> }>;
  failedFarms: MillPlanInput['failedFarms'];
}
export function buildMillPlan(input: MillPlanInput): MillPlan;
```

Definitions the tests pin:
- Shed cell kg = sum of `demandKg` of that farm's daily rows for (shedCode, batchNo) on that date whose `itemId` is selected. One shed row per (shedCode, batchNo).
- Farm total per date = sum of its shed cells; mill-total = sum of farm totals (this is the grid's top row; the web derives it from `farms[].totals`).
- `production[].days[].approvedKg` = max(0, Σ approved `millApprovedKg ?? requestedKg` − Σ `producedKg`) for that (productionDate, itemId).
- `forecastKg` = Σ `recommendedQtyKg` of daily rows whose `deliveryDate` (compute as in the engine: `shortageDate − 2` days, read from the row's `shortageDate`; a row without `shortageDate` contributes nothing) equals that date; counted once per (farm, sourceCode, itemId, date) — not per batch row sharing the source.
- `totalKg` = approvedKg + forecastKg. `capacity[].productionKg` = Σ totalKg over items that date.
- `usedPct` = productionKg ÷ mill.dailyKg × 100 (1 decimal); status `OVER` if > 100, `WARN` if ≥ warningPct, else `OK`; `NO_CAPACITY` with `usedPct` null when there is no mill or no `dailyKg`.
- Diet change `heads` = `heads` of the daily row for that `batchId` on `changeDate` (0 if none). Kept when from- or to-item is selected.
- Silo rows: one per (farm, sourceCode) from `sourceBalances`; `openingKg` = first date's `openingSystemBalanceKg`; `closingKg` per date = `projectedClosingBalanceKg`; `runOutDate` = first date whose closing ≤ 0, else null.
- `silosRunningOut` = silo rows with a `runOutDate`. `daysNearOrOver` = capacity days with WARN or OVER.

- [ ] **Step 1: Write the failing tests** in `mill-plan.rules.spec.ts`, one `it` each, with small hand-built inputs (2 farms, 7 dates starting `2026-11-02`):
  - `sums shed demand per date for the selected feeds only` — a shed with a Starter and a Grower row on the same day, filter = Grower: cell = Grower kg only.
  - `keeps two batches in one shed as two rows` — rows `S1/B-1` and `S1/B-2`: `sheds.length === 2`.
  - `approved minus produced never goes below zero` — approved 5,000, produced 6,000 → `approvedKg === 0`; approved 5,000, produced 2,000 → 3,000.
  - `counts a shared silo's recommended quantity once` — two batch rows on silo `SL-1`, same item and shortage date, each `recommendedQtyKg: 4000` → `forecastKg === 4000` on shortage − 2.
  - `marks a day WARN at the warning percent and OVER above 100` — dailyKg 10,000, warningPct 90: 9,000 → WARN, 10,001 → OVER, 8,999 → OK.
  - `reports NO_CAPACITY when the mill has no daily capacity` — `mill: null` → every status `NO_CAPACITY`, `usedPct === null`.
  - `lists a diet change when either feed is selected, with heads from the daily row` — filter = to-item only, change still listed, `heads === 120`.
  - `finds a silo's run-out date` — closing 3,000 / 1,000 / 0 → `runOutDate` = third date.
  - `carries failed farms through untouched`.

- [ ] **Step 2: Run them and see them fail**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/api/jest.config.ts apps/api/src/modules/inventory/feed-forecast/mill-plan.rules.spec.ts --maxWorkers=2`
Expected: FAIL, `Cannot find module './mill-plan.rules'`.

- [ ] **Step 3: Implement `buildMillPlan(input: MillPlanInput): MillPlan`** in `mill-plan.rules.ts`. Pure, no I/O; round kg to 4 decimals the way `mill-capacity.rules.ts` `roundKg` does (import nothing private — copy the one-liner).

- [ ] **Step 4: Run the tests and see them pass** (same command). Expected: PASS, 9 tests.

- [ ] **Step 5: Commit (after Rishi's OK)**

```bash
git add apps/api/src/modules/inventory/feed-forecast/mill-plan.rules.ts apps/api/src/modules/inventory/feed-forecast/mill-plan.rules.spec.ts
git commit -m "feat(mill-plan): pure rule folding farm forecasts, approved demand and capacity into a mill week"
```

### Task 2: `GET /feed-forecast/mill-plan`

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/mill-plan.service.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/mill-plan.service.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts` (add `QueryMillPlanDto`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts` (route + constructor)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts` (provider)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.spec.ts`

**Interfaces:**
- Consumes: `buildMillPlan`, `MillPlanInput`, `MillPlan` (Task 1); `FeedForecastService.listFarms`, `.getForecast(query, tenantId, userType, true)`; `MillCapacityService.mills`, `.approvedDemand`, `.allocateOnDates`; `FeedSettingsService.resolveForFeedPlanning(companyId, farmId)` (its `capacityWarningPct`); `schema.millProductionOutput` (`production_date`, `item_id`, `quantity_kg`, `company_id`, `tenant_id`, plus its status column — count posted rows only, as `MillOutputService` defines posted).
- Produces:

```ts
export class QueryMillPlanDto {
  weekOf: string;          // IsDateString, required
  farmIds?: string;        // comma-separated UUIDs; absent = every farm in scope
  itemIds?: string;        // comma-separated UUIDs; absent = all feed items
  millId?: string;         // IsUUID; absent = first mill of the farms' companies
}
@Injectable() export class MillPlanService {
  generate(tenantId: string, userType: string | undefined, query: QueryMillPlanDto): Promise<MillPlan & { mills: Array<{ millId: string; millCode: string; millName: string; companyId: string }> }>;
}
// controller: @Get('mill-plan') millPlan(@Query() query: QueryMillPlanDto, @Req() req) → { success: true, message: 'Mill plan generated.', data }
```

Rules the service owns:
- `weekOf` must be a calendar day (reuse `isCalendarDay` the forecast service uses); dates = weekOf … weekOf + 6.
- Farms = `listFarms` ∩ `farmIds`; a `farmIds` entry not in scope → 403 `Not authorized for this farm.`
- Mill: `mills(tenantId, companyIds of the scoped farms)`; chosen by `millId` or the first. Farms are then narrowed to the chosen mill's `companyId`.
- Each farm runs `getForecast({ farmId, view: 'CUSTOM', from: weekOf, to: weekOf+6 }, tenantId, userType, true)` **one after another** (not `Promise.all`; memory). A thrown error goes to `failedFarms` with its message; the loop continues.
- `capacityByDate` = `allocateOnDates(tenantId, [mill.companyId], demandsByDate)` where the demands are the per-item `totalKg` per date — compute in two passes: build the plan once without capacity, read `production`, call `allocateOnDates`, then build again with it. (Simple, and `buildMillPlan` is pure.)
- `warningPct` from `resolveForFeedPlanning(mill.companyId, firstFarmId)`.

- [ ] **Step 1: Write the failing tests** in `mill-plan.service.spec.ts` with jest mocks for the three services and a recording db stub for mill output:
  - `runs the forecast once per farm, in sequence, over seven days` — `getForecast` called with `{ view: 'CUSTOM', from: '2026-11-02', to: '2026-11-08' }` for each farm; second call starts after the first resolves.
  - `keeps going when one farm's forecast throws` — farm 2 throws `No lifecycle` → result `failedFarms[0].error === 'No lifecycle'`, farm 1 present.
  - `refuses a farm outside the caller's scope` — `farmIds` with an unknown id → `ForbiddenException`.
  - `rejects a rolled-over date` — `weekOf: '2026-02-31'` → `BadRequestException`.
  - `limits farms to the chosen mill's company`.
  In `feed-forecast.controller.spec.ts`: `millPlan` returns `{ data }` from the service and carries `RequirePermission` `INVENTORY/LEDGER/view`.

- [ ] **Step 2: Run them and see them fail**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/api/jest.config.ts apps/api/src/modules/inventory/feed-forecast/mill-plan.service.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.spec.ts --maxWorkers=2`
Expected: FAIL, module not found / `millPlan is not a function`.

- [ ] **Step 3: Implement** `QueryMillPlanDto`, `MillPlanService.generate`, the controller route (declared before `@Get('runs/:id')`), and the module provider.

- [ ] **Step 4: Run them and see them pass** (same command). Expected: PASS.

- [ ] **Step 5: Drive it.** Restart the api cleanly (memory: `nx serve api` does not always rebuild — grep `dist` for `mill-plan` first). Sign in to `nf_ccc` and call `GET /feed-forecast/mill-plan?weekOf=<this Monday>`. Expected: 200 with 7 dates, every active farm of the company in `farms` or `failedFarms`. Cross-check one shed cell against `GET /feed-forecast?farmId=…&view=CUSTOM&from=…&to=…` for the same farm, and one `approvedKg` against

```sql
SELECT COALESCE(r.production_date, l.proposed_delivery_date) d, l.item_id, SUM(l.quantity)
FROM requisition r JOIN requisition_line l ON l.requisition_id = r.requisition_id
WHERE r.doc_type='FEED' AND r.deleted_at IS NULL AND (r.status='APPROVED' OR r.approval_status='APPROVED')
GROUP BY d, l.item_id;
```
minus `SELECT production_date, item_id, SUM(quantity_kg) FROM mill_production_output GROUP BY 1,2;` (posted rows only).

- [ ] **Step 6: Commit (after Rishi's OK)**

```bash
git add apps/api/src/modules/inventory/feed-forecast/
git commit -m "feat(mill-plan): GET /feed-forecast/mill-plan runs every farm's week and adds it up for the mill"
```

### Task 3: Retire Feed Plan in the API

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts` — remove `feedPlan`, `feedPlanVersions`, `feedPlanVersion`, `generateFeedPlanVersion` routes (and `GenerateFeedPlanDto` if unused).
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` — remove `feedPlan`, `feedPlanCapacity`, `listFeedPlanVersions`, `findFeedPlanVersion`, `generateFeedPlanVersion`, the `planService` constructor parameter, and imports from `./feed-plan.rules` that become unused (keep the file: `isoProductionWeek` is used by the scheduler and consolidation).
- Delete: `apps/api/src/modules/inventory/feed-forecast/feed-plan.service.ts`, `feed-plan.service.spec.ts`, `feed-plan.persistence.spec.ts` (if it only covers the service), and from `feed-forecast.module.ts` providers/exports.
- Modify: `apps/api/src/modules/inventory/feed-scheduler/feed-scheduler.rules.ts` — `FEED_JOBS` without `'TENTATIVE_PLAN'`; drop its `cadence` case.
- Modify: `apps/api/src/modules/inventory/feed-scheduler/feed-scheduler.service.ts` — remove the `TENTATIVE_PLAN` branch of `execute` and `tentativePlan(...)`.
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` — remove `refreshActualPlanAfterApproval` and its call in `afterDecide` (an approval no longer writes an Actual plan version; this is part of "Screen and background").
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.rules.ts` and `feed-alert.service.ts` — an open `PLAN_AVAILABLE` alert resolves with reason `'CLOSED'` on any full (non-levels-only) evaluation; delete `closedPlans` (service) and the `closedPlans` input field and the `'SUPERSEDED' | 'APPROVED'` members of `ResolveReason` if nothing else uses them. `raisePlanAvailable` goes with the scheduler branch.
- Leave untouched: `alert-rule.rules.ts` / `alert-rule.service.ts` (existing `PLAN_AVAILABLE` rule rows must still validate), `feed-settings` DTO and columns `tentative_plan_weekday/time` (the UI hides them in Task 4), `feed-forecast-run.service.ts` plan-code read, the permanent-delete guard, every `feed_plan*` table.
- Tests: update `feed-forecast.controller.spec.ts`, `feed-forecast.plan-heads.spec.ts` (delete if it only covers `feedPlan`), `feed-scheduler.rules.spec.ts`, `feed-scheduler.service.spec.ts`, `feed-scheduler.controller.spec.ts`, `feed-alert.rules.spec.ts`, `feed-alert.service.spec.ts`, `feed-requisition.submit.spec.ts` (the "refreshes an Actual Feed Plan" case becomes "does not write a feed plan after approval").

**Interfaces:**
- Produces: `FEED_JOBS = ['REQ_REMINDER', 'REQ_CUTOFF', 'DIET_CHANGE', 'ESCALATION', 'STOCK_TAKE_DUE']`. `POST /feed-scheduler/run/TENTATIVE_PLAN` → 400 `Job must be one of …`.

- [ ] **Step 1: Write / change the failing tests**
  - `feed-alert.rules.spec.ts`: `closes an open PLAN_AVAILABLE alert on a full evaluation` → `resolve` contains `{ alertId, reason: 'CLOSED' }`; `leaves it on a levels-only pass`.
  - `feed-scheduler.rules.spec.ts`: `FEED_JOBS` equals the five above.
  - `feed-scheduler.controller.spec.ts`: running `TENTATIVE_PLAN` → `BadRequestException`.
  - `feed-requisition.submit.spec.ts`: after an approved, run-linked requisition commits, no `feed_plan` insert is recorded.
  - Remove the controller-spec cases for the four Feed Plan routes.
- [ ] **Step 2: Run and see the new cases fail**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/api/jest.config.ts feed-alert feed-scheduler feed-requisition.submit feed-forecast.controller --maxWorkers=2`
Expected: the new cases FAIL.
- [ ] **Step 3: Make the removals listed under Files.**
- [ ] **Step 4: Run the whole API suite**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/api/jest.config.ts --maxWorkers=2`
Expected: all pass (baseline 290 suites / 3,616 tests before this plan; the count changes by the deleted and added specs). `npx tsc -p apps/api/tsconfig.app.json --noEmit` shows no new errors (the untracked `scripts/tmp-exp/probe.ts` error is pre-existing).
- [ ] **Step 5: Drive it.** Restart the api. In MySQL note `SELECT COUNT(*) FROM feed_alert WHERE event_type='PLAN_AVAILABLE' AND status='OPEN';` (expect > 0 on `nf_ccc` if any exist), run a full evaluation (`POST /feed-scheduler/run/ESCALATION` or the farm evaluation endpoint), then re-run: expect 0, and those rows' `resolved_reason = 'CLOSED'`. `SELECT COUNT(*) FROM feed_plan` is unchanged. Approve a run-linked feed requisition through the UI: `feed_plan` count still unchanged.
- [ ] **Step 6: Commit (after Rishi's OK)** — `refactor: retire Feed Plan versions, the tentative-plan job and plan-available alerts`

### Task 4: Mill Planning tab in the web

**Files:**
- Create: `apps/web/src/components/console/inventory/mill-plan-panel.tsx` — filters, Generate, strip, cards, production table, diet changes, grid.
- Create: `apps/web/src/components/console/inventory/multi-pick.tsx` — a checkbox list inside the existing `Popover` (`components/ui/popover.tsx`), "All" when nothing is unticked. Used for Farms and Feed Types.
- Create: `apps/web/specs/mill-plan-panel.spec.tsx`
- Delete: `apps/web/src/components/console/inventory/feed-plan-panel.tsx`, `apps/web/specs/feed-plan-panel.spec.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-tabs.tsx` — `'feed-plan'` → `'mill-planning'` in `FEED_FORECAST_TABS`, `TAB_LABEL` (`fftTabMillPlanning`), `PANELS`; `readFeedForecastTab('feed-plan')` returns `'mill-planning'` (old bookmarks and old alert links).
- Modify: `apps/web/specs/feed-forecast-tabs.spec.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx:437` — href `?tab=mill-planning`, label key `fftTabMillPlanning`.
- Modify: `apps/web/src/components/console/console-tabs/company-tab.tsx` — remove the Tentative plan weekday / time inputs (around 2298–2410) and stop sending `tentativePlanWeekday/Time` (around 549–550); keep the rest of the Feed Planning Settings form.
- Modify: `apps/web/src/utils/translations.ts` — add `fftTabMillPlanning: 'Mill Planning'` and the `mpl*` keys the panel uses; remove `feedPlan*` keys only where no other file still uses them (`feed-consolidation-dialog.tsx` and `mill-compare-panel.tsx` use some).

**Interfaces:**
- Consumes: `GET /feed-forecast/mill-plan?weekOf&farmIds&itemIds&millId` → `MillPlan & { mills }` (Task 2); `GET /feed-forecast/farms` for the Farms list; feed items for Feed Types from the same source `feed-forecast-panel.tsx` uses for its item filter (check it; else `GET /item?itemType=FEED`).
- Produces: `export default function MillPlanPanel(): JSX.Element`; `export function MultiPick(props: { label: string; options: Array<{ id: string; label: string }>; selected: string[] | null; onChange: (ids: string[] | null) => void }): JSX.Element` (`null` = all).

Layout (match `mill-compare-panel.tsx` for tables, `StatCard`/`StatRow` for cards, 44px filter controls as in e23a4258):
1. Filter row: Week of (date, default = `useFeedForecastContext().planningDate`), Farms (MultiPick), Feed Types (MultiPick), Mill (`SearchableSelect`, filled from the last result's `mills`), **Generate**, Collapse all / Expand all.
2. Before the first Generate: `EmptyState` "Choose the filters and click Generate."
3. Capacity strip: one chip per day `Mon 02 · 82.0 t · 68 %`, tone by status (OK success / WARN warning / OVER danger / NO_CAPACITY neutral "capacity not set").
4. Cards from `cards`.
5. Production by feed type: rows = items, columns = 7 days + Total; each cell `totalKg` in t, with a hover/title giving "Approved x t + forecast y t" and the `DietCapacity` status dot (reuse `millCapacityText`).
6. Diet changes list.
7. Grid: header row of dates; "Mill total" row; per farm a collapsible group (farm total row), shed rows (shed code + batch, feed chips, heads — no average age: the engine's daily rows carry none, and the spec is amended to match — cells in t, cell highlighted when `date === changeDate`), then silo rows (opening, closing per day in t, run-out cell highlighted). Failed farms shown as a row with the error.
8. Figures in tonnes with one decimal (kg ÷ 1000).

- [ ] **Step 1: Write the failing tests** in `mill-plan-panel.spec.tsx` (mock `api.get`):
  - `does not call the API until Generate is clicked`.
  - `sends weekOf, farmIds, itemIds and millId on Generate` — exact query string.
  - `does not refetch when a filter changes after Generate`.
  - `shows a day over capacity as OVER and one without capacity as "capacity not set"`.
  - `highlights the diet-change cell and the silo run-out cell` (data attributes `data-diet-change`, `data-run-out`).
  - `lists a failed farm with its error`.
  In `feed-forecast-tabs.spec.tsx`: `readFeedForecastTab('feed-plan')` → `'mill-planning'`; the tab list contains `'mill-planning'` and not `'feed-plan'`.
- [ ] **Step 2: Run and see them fail**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/web/jest.config.ts apps/web/specs/mill-plan-panel.spec.tsx apps/web/specs/feed-forecast-tabs.spec.tsx --maxWorkers=2`
Expected: FAIL.
- [ ] **Step 3: Implement** the files listed above.
- [ ] **Step 4: Run the web suite and lint**

Run: `env -u NX_WORKSPACE_ROOT_PATH npx jest -c apps/web/jest.config.ts --maxWorkers=2` → all pass.
Run: `env -u NX_WORKSPACE_ROOT_PATH pnpm nx lint web` → no errors beyond the frozen baseline (measure before and after; gate on "no new").
- [ ] **Step 5: Drive it** in the browser pane: Inventory → Feed Forecast → Mill Planning on `nf_ccc`. Before Generate nothing loads (network tab shows no `mill-plan` call). Generate for this week: the strip, cards, production table, diet changes and grid render; pick one farm and one feed type, Generate again, and check one shed cell and one silo closing balance against the Forecast tab for that farm. Old link `/inventory/feed-forecast?tab=feed-plan` opens Mill Planning. Company → Feed Planning Settings no longer shows the Tentative plan fields and still saves. Screenshot for Rishi.
- [ ] **Step 6: Commit (after Rishi's OK)** — `feat: Mill Planning replaces the Feed Plan tab`
