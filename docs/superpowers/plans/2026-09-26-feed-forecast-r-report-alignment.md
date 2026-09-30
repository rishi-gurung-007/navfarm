# Feed Forecast — Plan R: Report Alignment with the Field Specification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inventory → Feed Forecast shows the client's field specification: one row per Batch + Feed Item + date (grouped for Weekly and Reporting Period views, never blended across a diet change), for a selectable as-of Planning Date in the farm's time zone, with projected Current Inventory, heads, Per Day Intake without wastage, silo-level Days of Stock (shared-silo count, "indicative" flag), Run-Down to the silo's low level with confirmed incoming, Date to Refill / Required On with the new 2-day lead-time default, Item No, DD/MM/YY dates and a current/next stage block — backed by a new Reporting Period Master — while the requisition auto-draft and DIET_CHANGE alerts read the same numbers.

**Architecture:** The engine keeps its single daily walk in integer micrograms; it gains an opening-balance date (`stockDate`), a run-down horizon (`horizonTo`), per-silo low levels and confirmed incoming (D19), and emits per-date rows (`daily`) next to the Plan A/B outputs. A new pure module (`feed-forecast.view.ts`) turns a view (Daily / Weekly / Reporting Period / Custom) into a date range and groups daily rows without recomputing anything. The service reads silo/store stock *as of* a date from the ledger (a signed sum before the date plus posted non-feeding movements and saved transfers after it), takes "today" from the company time zone, and builds the report and the stage block. Reporting periods are a small company master with a pure "generate a July–June year" rule behind an admin action.

**Tech Stack:** NestJS 11 + Drizzle (MySQL, per-tenant DBs, hand-written SQL migrations in `apps/api/src/drizzle/tenant` with `meta/_journal.json` entries), Jest (SWC — no type checking in tests; `typecheck` catches spec types); Next.js 16 / React 19, React Testing Library; Nx (`pnpm nx …`).

**Spec:** `docs/superpowers/specs/2026-09-25-feed-forecast-design.md` — decisions **D16–D20** (26 Sep; they refine D2, D3 and D5), with D1–D15 still binding. Client sources below the spec's decisions: `.superpowers/feed-forecast-sources/field-specification-2026-09-26.txt` (Report Filters, Report Grid column by column, Supporting Stage / Diet Reference Block) and `.superpowers/feed-forecast-sources/workbook-extract.txt` (*Feed Forecast Engine* row 20 "Date grouping never changes underlying daily calculation", Step 6 "Build dated forecast", row 67 View and Period; *Master Setup* row 10 Reporting Period Master; *Silo Balance and Stock Take* rows 36–37 and 49; *Checkpoints* 15 and 40). Builds on Plans A and B (`docs/superpowers/plans/2026-09-25-feed-forecast-a-silo-and-report.md`, `docs/superpowers/plans/2026-09-26-feed-forecast-b-alerts-requisition.md`), both complete on `feat/feed-forecast-report`.

## Open questions for Rishi

Each has a default the plan uses, so the plan is executable as written. An answer that differs changes only the task named. Batch numbering is out of scope (Rishi, 26 Sep).

| # | Question | Why it is open | Default used (task) |
|---|---|---|---|
| Q1 | **Run-down on the exact day the balance reaches the level.** D19: "first date the projected balance falls to the silo's Below Feed Level … or to zero". | D2 counted the first day the silo *cannot* feed (500 kg at 100 kg/day → day 6); "falls to zero" reads as day 5. | **At or below**: the first day with demand whose closing balance is ≤ the low level (≤ 0 with none). 500 kg at 100 kg/day runs down on day 5; 525 kg still on day 6 (D1's sample unchanged). Same "at or below" as the low-feed alert (checkpoint 11). (Task 2) |
| Q2 | **What is a "confirmed incoming transfer"?** Field spec Step 7: "opening ledger balance + confirmed incoming TO quantities". | Nothing in NAVFarm is in transit: a stock transfer is DRAFT → POSTED in one step, posting both sides at once (`stock-transfer.service.ts:451`, statuses DRAFT/POSTED/CANCELLED only; nf_devco 26 Sep: 12 POSTED, 1 DRAFT). Transfer Orders are Plan C. Approved requisitions have no receipt link until Plan C, so counting them would count the feed twice once it arrives. | **Incoming = (a)** posted ledger movements into or out of the silo/store dated on or after the stock date that are not feeding (receipts, transfers, adjustments), **plus (b)** saved-but-not-posted (DRAFT) stock transfers into the silo/store with a posting date inside the window, and DRAFT transfers out of them as negative. Approved requisitions are not counted. Plan C replaces (b) with dispatched Transfer Orders. (Tasks 6, 2) |
| Q3 | **Requisition quantity once run-down is to the low level and incoming counts.** | The Worked Example's `MAX(0, requirement − opening)` ignores both; drafting to zero while the report plans to the low level leaves a refill date with no requisition line. | Unrounded need = the largest projected deficit below the low level through `to`, after confirmed incoming (`shortfallKg`). With no low level and no incoming it is exactly the Worked Example's figure (4,500 kg / 9,000 kg — the Plan B tests keep passing). (Tasks 2, 8) |
| Q4 | **Requisition line date.** Field spec: Required On "is the date used to populate the auto-drafted Requisition line". | Plan B used the run-down date. | `proposed_delivery_date` = Required On, or the planning date when Required On has already passed (the line is then flagged overdue by its first shortage date as before). (Task 8) |
| Q5 | **Days of Stock with or without wastage.** D17 takes wastage out of *Per Day Intake*; D18 divides by "everything that silo feeds per day". | The two columns would disagree if Days of Stock used the no-wastage rate. | Days of Stock divides by the silo's demand **including** wastage (what leaves the silo), so it agrees with Run-Down; Per Day Intake shows heads × rate without wastage, and the screen says which allowance was used (D17). (Task 3) |
| Q6 | **"Current Inventory as of the Planning Date" — start or end of day?** | Today's daily entry may already be posted when the report is opened. | The System Balance at the **start** of the date (ledger postings dated before it) plus deliveries dated that day; that day's feeding is the forecast's own standard demand, so a posted daily entry is not subtracted twice. (Tasks 2, 6) |
| Q7 | **Dates before the Planning Date inside the chosen range** (e.g. a Reporting Period of 30 Aug–26 Sep viewed on 26 Sep). | An "as of" forecast has no projection for days already past. | Rows start at the planning date; earlier days are not forecast and the screen says so. Move the planning date back to see them. (Tasks 3, 7) |
| Q8 | **Back-dated planning date.** Field spec: "posted count for past/today's dates". | The forecast reads heads from batch_header's current closing count; rebuilding a past date's count from daily-entry lines and batch transactions is not built, and the register's batch set is today's. | Balances are as of the chosen date (ledger); batches, head counts and stages are today's register, and the report says so (`AS_OF_PAST` note). The planning date may be at most 45 days either side of today. (Tasks 6, 7) |
| Q9 | **Reporting period dates.** D20: End Date = month-end Saturday, Production Start = Sunday after, July–June year. The workbook's illustrative September 2026 is 23 Aug–26 Sep ("Example dates require customer confirmation"); the last Saturday of August 2026 is 29 Aug. No client period list exists. | The client's calendar is not given. | Nothing is seeded. An admin runs **Generate July–June periods** (API `POST /reporting-period/generate`, button on the forecast's Reporting Period view): End = last Saturday of the month, Start = the day after the previous period's End, Stock Take = End, Production Start = End + 1, code `YYYY-MM` (workbook example `2026-09`). Every row stays editable. September 2026 generates as 30 Aug–26 Sep. (Task 5) |
| Q10 | **Must a period's End Date be a Saturday?** | D20 says so; the client may have exceptions. | Enforced on create and edit; Stock Take Date must fall inside the period. (Task 5) |
| Q11 | **Lead time default 0 → 2 (D19): what happens to farms already at 0?** | All 11 FARM rows in nf_devco hold 0 — the old column default, never edited (checked 26 Sep). A deliberate 0 cannot be told from the default. | Migration 0120 changes the column default to 2 **and** sets FARM rows still at 0 (or NULL) to 2. A farm that really wants 0 re-enters it on the farm form. (Task 1) |
| Q12 | **What each view shows.** Workbook: "Forecast runs for a user selected day, week, reporting period or custom From Date and To Date"; field spec: one row per date, "or per Feed-Item period if the view is Weekly/Reporting Period". | Daily and Custom are not distinguished further. | **Daily** = one chosen date; **Weekly** = 7 days from the chosen week start, one row per batch + item + source; **Reporting Period** = the period's dates, one row per batch + item + source; **Custom** = one row per date from From to To. Whatever the view, Run-Down / Date to Refill / Required On look up to 45 days past the planning date, so a one-day view still shows them. (Tasks 4, 7) |
| Q13 | **When is Days of Stock "indicative"?** Field spec: "whenever a lifecycle rate/diet change falls inside the forecast window". | "Change" is not defined further. | When the silo's (or store's) daily demand for that item changes on any later date up to the end of the range — a diet, rate or stage change of any batch it feeds. (Task 3) |
| Q14 | **Whose time zone?** D16: farm time zone, Africa/Harare. | A farm row has no zone; the company has `default_timezone_id` (TRIPLEC = `Africa/Harare`, 26 Sep). | The company's zone; a missing or unknown zone falls back to the server's day, as before, and the report shows which zone it used. (Task 1) |

Record the answers in `docs/decisions.md` (Task 11 adds the Plan R entry with these defaults marked "default, awaiting Rishi").

## Global Constraints

- Read `AGENTS.md` first. Comments explain **why**, in prose, matching the dense style of the file being edited. Say which document a value comes from; label our own inventions as ours.
- New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`); `t()` falls back to English.
- Web lint baseline: gate on **no new errors** against the count taken before your change (`pnpm nx lint web 2>&1 | grep -c " error "` — record it in Task 9 Step 0); never "fix" pre-existing `exhaustive-deps`. An effect that reads `t` uses the **tRef pattern** (`const tRef = useRef(t); tRef.current = t;`), never an `eslint-disable`.
- Every list read off an API response is guarded with `Array.isArray(…) ? … : []`.
- Run through Nx: `pnpm nx test api -- <pattern>`, `pnpm nx test web -- <pattern>`, `pnpm nx run-many -t typecheck -p api,web`; full runs add `--maxWorkers=2` (8 GB machine).
- Every `@RequirePermission(module, resource, action)` pair must also be offered in `apps/web/src/components/console/console-tabs/roles-tab.tsx` (guarded by `apps/web/specs/role-permissions-coverage.spec.ts`), with an `en` label key.
- Every new controller is listed in `apps/api/src/common/farm-scope-coverage.spec.ts`, as SCOPED (with `@FarmScoped()` and `RolesGuard`) or EXEMPT with a reason. Farm-level reads go through `resolveFarm` then `withFarmScope`; `resolveFarm` requires `userType` and fails closed.
- Databases are `nf_`-prefixed; the dev tenant is `nf_devco`. MySQL: `cd apps/api && set -a && . ./.env && set +a && MYSQL_PWD="$DATABASE_PASSWORD" mysql -h 127.0.0.1 -u root -t -e "…"`.
- Tenant migrations start at **0120**; each gets a `meta/_journal.json` entry whose `when` is the previous entry's + 86400000 (0119 is `1790962800000`, so 0120 is `1791049200000`, 0121 is `1791135600000`). Apply with `pnpm nx run api:db-migrate-all-tenants`.
- **Verify by writing and reading MySQL**, not by a green suite. `nx serve api` does not rebuild: `pnpm nx run api:build`, then restart the API by the PID from `lsof -ti :2877`. Never `pkill`.
- Dates are `YYYY-MM-DD` farm-local calendar days; date arithmetic on UTC midnights of those strings, with the engine's `addDays`/`diffDays` (Ruling L12: one implementation). The screen shows dates as **DD/MM/YY** (D16).
- Tests that depend on the current date compute it (`todayLocal()`, `todayIso()`, fake timers) — never a literal "today". Pure calendar arithmetic may use fixed dates.
- Silo balance is labelled **System Balance** on every screen (checkpoint 37); never "physical stock".
- Only the report, the Reporting Period Master and the numbers the requisition and alerts read change. No stock take, period close, run versions or Transfer Orders (Plan C/D). No batch numbering.
- Do not run `db-rebuild-demo`, `setup-fresh-database` or any DROP. Do not start dev servers or browsers (8 GB machine); Rishi's servers stay up.
- Commit only the files of the task, by explicit path; never stage `nx.json` or `apps/web/next-env.d.ts`. Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A silo shared by two batches where one of them changes diet inside the range** — Days of Stock is the silo's (both batches' demand), each row says the silo is shared by 2 until the change and by 1 after it, the earlier rows are "indicative", and the diet change gives a separate row for the new item, never a blended one. (Task 3 describe "shared silo, one batch changes diet (Review Focus 1)".)
2. **A balance landing exactly on the low level or on zero** — run-down is that day, not the next (Q1), and the requisition for the same silo is non-zero whenever the run-down falls inside the window. (Task 2 test "with no low level, an exact multiple runs down on the day it empties"; Task 8 test "a run-down inside the window always drafts a line".)
3. **A Reporting Period longer than the 45-day horizon, or none covering the planning date** — the API answers 400 naming the period and its length (or telling the admin where to add one) and computes nothing. (Task 7 tests "refuses a reporting period longer than the 45-day horizon…" and "says where to add a period when none covers the planning date…".)
4. **A confirmed delivery that arrives after the silo has already run down** — the run-down date is still reported (the silo empties before the truck), and the requisition's shortfall is the deficit before the delivery, not after. (Task 2 test "a delivery after the run-down does not hide it".)
5. **A planning date in the future or the past** — a forward date walks today's stock through the days in between (they consume feed but produce no rows and no run-down before the planning date); a past date takes the ledger balance as of that date and says heads are today's. (Task 2 tests "consumes the days between the stock date and the planning date without reporting them" and "a silo that ran out before the planning date runs down on the planning date itself"; Task 6 test "a past planning date reads stock as of that date and says heads are today's".)

---

## File map

| File | Responsibility |
|---|---|
| `apps/api/src/drizzle/tenant/0120_feed_lead_time_default.sql` (new) | Lead-time column default 2; FARM rows still at 0 → 2 (D19, Q11) |
| `apps/api/src/drizzle/tenant/0121_reporting_period.sql` (new) | Reporting Period Master table (D20) |
| `apps/api/src/core/database/schema.ts` | `feed_lead_time_days` default; `reportingPeriod` table |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` | `todayInZone`; D19 walk (stock date, horizon, low level, incoming, shortfall); per-date rows (D16–D18) |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts` (new) | Pure: view → date range, span check, grouping of daily rows |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.ts` (new) | Pure: ledger rows → silo/store opening balances and incoming (Q2, Q6) |
| `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts` | `getFeedStockAsOf` — farm-scoped as-of sums and movements |
| `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` | `farmToday`; as-of loading; planning date and horizon; views; periods; stage block; report |
| `apps/api/src/modules/inventory/feed-forecast/{feed-forecast.controller.ts,dto/feed-forecast.dto.ts}` | Query `planningDate`, `view`, `periodId`; `GET /feed-forecast/periods` |
| `apps/api/src/modules/master-data/reporting-period/*` (new) | Reporting Period Master: pure rules, DTO, service, controller, module |
| `apps/api/src/modules/procurement/feed-requisition/{feed-requisition.rules.ts,feed-requisition.service.ts}` | Need from `shortfallKg`, line date from Required On; farm-today check |
| `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts` | Alert "today" in the farm's time zone |
| `apps/web/src/modules/master-data/configs.ts`, `roles-tab.tsx`, `translations.ts` | Reporting Periods master, permission pair, labels, lead-time help text |
| `apps/web/src/components/console/inventory/feed-format.ts` | `formatDateShort` (DD/MM/YY), shared `addDaysIso` |
| `apps/web/src/components/console/inventory/feed-forecast-grid.tsx` (new) | Report grid, stage block, wastage note |
| `apps/web/src/components/console/inventory/feed-forecast-query.ts` (new) | Pure: query string per view; business-year start |
| `apps/web/src/components/console/inventory/feed-forecast-panel.tsx` | Planning date, view, period, generate-year; uses the grid |

## Order and parallelism

```
Task 1 (farm time zone, lead time 2, 0120) ─┐
Task 2 (engine: D19 walk) ── Task 3 (engine: daily rows) ── Task 4 (view + grouping, pure)
Task 5 (Reporting Period Master, 0121 + web master)          │
Task 6 (service: as-of stock, incoming) ← 1, 2, 3            │
Task 7 (service: planning date, views, periods, stages, report) ← 4, 5, 6
Task 8 (requisition consistency) ← 2 (and 1)
Task 9 (web: grid + stage block components) ← 7's response shape
Task 10 (web: panel controls and integration) ← 9, 7
Task 11 (MySQL verification + decisions) last
```

Tasks 1, 2 and 5 can run in parallel; 8 can run as soon as 2 lands.

---
### Task 1: Farm time zone for "today", and the 2-day lead-time default

D16: "Defaults to today's system date (server date, farm time zone Africa/Harare)". Until now the forecast, the alerts and the requisition took the **server's** day (`todayLocal`), so between midnight in Harare and midnight on the server the planning date was a day off. A farm row has no zone; the company's `default_timezone_id` is the zone on record (TRIPLEC = `Africa/Harare`, nf_devco 26 Sep) — Q14. D19 changes the lead-time default from 0 to 2 (Q11: column default and the FARM rows still at 0).

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` (after `todayLocal`, ~line 121)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (imports; `FarmClock`; `farmToday`; `computeForFarm` planning date; `loadFarm` fallback)
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts` (`evaluateFarm`, ~line 96)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` (`autoDraft`, ~lines 256–262)
- Create: `apps/api/src/drizzle/tenant/0120_feed_lead_time_default.sql`; modify `apps/api/src/drizzle/tenant/meta/_journal.json` (idx 120)
- Modify: `apps/api/src/core/database/schema.ts:1035`
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts` (both `feed_lead_time_days` descriptions, ~lines 172 and 369)
- Modify: `apps/web/src/modules/master-data/configs.ts` (`feed_lead_time_days` help text, ~line 150)
- Test: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.spec.ts`, `feed-forecast.service.farm.spec.ts`, `feed-forecast.service.spec.ts`, `apps/api/src/modules/inventory/feed-alert/feed-alert.service.spec.ts`, `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`

**Interfaces:**
- Produces (engine): `export function isTimeZone(zone: string): boolean`; `export function todayInZone(zone: string | null | undefined, ms?: number): string`.
- Produces (service): `export interface FarmClock { today: string; timeZone: string | null }`; `FeedForecastService.farmToday(companyId: string, tenantId: string, nowMs?: number): Promise<FarmClock>` (public — the alert and requisition services call it).
- `computeForFarm` keeps its signature; its planning date is now `farmToday(...).today`.

- [ ] **Step 1: Write the failing tests**

Append to `feed-forecast.engine.spec.ts` (add `todayInZone` to the existing import from `./feed-forecast.engine`):

```ts
describe('todayInZone — D16 planning date in the farm time zone', () => {
  it('is already the 26th in Harare at 22:30 UTC on the 25th', () => {
    expect(todayInZone('Africa/Harare', Date.UTC(2026, 8, 25, 22, 30))).toBe('2026-09-26');
  });
  it('is still the 25th in Harare at 21:59 UTC', () => {
    expect(todayInZone('Africa/Harare', Date.UTC(2026, 8, 25, 21, 59))).toBe('2026-09-25');
  });
  it('falls back to the server day for an unknown or missing zone', () => {
    const ms = Date.UTC(2026, 8, 25, 12, 0);
    expect(todayInZone('Not/AZone', ms)).toBe(todayLocal(ms));
    expect(todayInZone(null, ms)).toBe(todayLocal(ms));
  });
});
```

Append inside `describe('FeedForecastService — Plan B entry points', …)` in `feed-forecast.service.farm.spec.ts` (add `import * as schema from '../../../core/database/schema';` and `import { todayLocal } from './feed-forecast.engine';` at the top):

```ts
  /** A tenantDb answering the two zone lookups farmToday makes: company_master, then timezone_master. */
  function zoneDb(companyZone: string | null, tzRows: Array<{ code: string }> = []) {
    return {
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            limit: async () => (table === schema.companyMaster ? (companyZone === null ? [] : [{ zone: companyZone }]) : tzRows),
          }),
        }),
      }),
    };
  }

  it('farmToday reads the company zone: 22:30 UTC on 25 Sep is 26 Sep in Harare (D16)', async () => {
    const service = new FeedForecastService(transactionCls(zoneDb('Africa/Harare')), {} as any, {} as any);
    await expect(service.farmToday('co-1', 'tenant-1', Date.UTC(2026, 8, 25, 22, 30))).resolves.toEqual({ today: '2026-09-26', timeZone: 'Africa/Harare' });
  });

  it('farmToday looks a stored timezone_master id up to its IANA code', async () => {
    const service = new FeedForecastService(transactionCls(zoneDb('tz-id-1', [{ code: 'Africa/Harare' }])), {} as any, {} as any);
    await expect(service.farmToday('co-1', 'tenant-1', Date.UTC(2026, 8, 25, 22, 30))).resolves.toEqual({ today: '2026-09-26', timeZone: 'Africa/Harare' });
  });

  it('farmToday falls back to the server day, and says so with a null zone, when the company has none', async () => {
    const service = new FeedForecastService(transactionCls(zoneDb(null)), {} as any, {} as any);
    const ms = Date.UTC(2026, 8, 25, 12, 0);
    await expect(service.farmToday('co-1', 'tenant-1', ms)).resolves.toEqual({ today: todayLocal(ms), timeZone: null });
  });

  it('computeForFarm plans from the farm day, not the server day', async () => {
    const cls = transactionCls({});
    const service = new FeedForecastService(cls, {} as any, {} as any);
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    jest.spyOn(service as any, 'loadFarm').mockResolvedValue(farm);
    const loadInput = jest.spyOn(service as any, 'loadInput').mockResolvedValue({ input: { ...emptyInput, planningDate: '2026-09-26' }, flags: [] });
    const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1'));
    expect(loadInput.mock.calls[0][1]).toBe('2026-09-26');
    expect(result.planningDate).toBe('2026-09-26');
  });
```

In the same file, the existing test `'runs every loader under the computed farm and returns sources and diet changes'` now reaches `farmToday` — add, right after `const service = new FeedForecastService(cls, {} as any, {} as any);` in that test:

```ts
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-23', timeZone: null });
```

In `feed-forecast.service.spec.ts`, inside the top-level `beforeEach` of `describe('FeedForecastService', …)`, after the `loadInput` spy, add (the main `service` sits on `transactionCls({})`, which has no `select`):

```ts
    jest.spyOn(service, 'farmToday').mockImplementation(async () => ({ today: todayLocal(), timeZone: null }));
```

and add `todayLocal` to that file's import from `./feed-forecast.engine`. The happy-path test fakes the clock to 25 Sep 10:30 local, and `todayLocal()` reads the faked clock, so its expectations stand.

In `feed-alert.service.spec.ts`, give both forecast stubs a farm day — in the `forecast` object of the test `'evaluateFarm ensures the company defaults first (M8)…'` and in `build()`'s `forecast` object, add:

```ts
      farmToday: jest.fn(async () => ({ today: '2026-09-25', timeZone: 'Africa/Harare' })),
```

and append to the `build()` describe:

```ts
    it('evaluates on the farm day from farmToday, not the server day (D16)', async () => {
      const computeForFarm = jest.fn().mockResolvedValue({ dietChanges: [] });
      const { service } = build(computeForFarm);
      await service.evaluateNow('farm-a', 't', 'COMPANY_ADMIN');
      expect(computeForFarm).toHaveBeenCalledWith('farm-a', 'co', 't', expect.objectContaining({ from: '2026-09-25' }));
    });
```

In `feed-requisition.service.spec.ts`, in `setup()`'s `forecast` object add:

```ts
    farmToday: jest.fn(async () => ({ today: serverToday(), timeZone: null })),
```

and append to `describe('FeedRequisitionService.autoDraft', …)`:

```ts
  it('checks `to` against the farm day, after resolving the farm (D16)', async () => {
    const { service, forecast } = setup([source()], new Map());
    forecast.farmToday.mockResolvedValueOnce({ today: '2026-09-26', timeZone: 'Africa/Harare' });
    await expect(service.autoDraft({ to: '2026-11-11' }, 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' }))
      .rejects.toThrow('to must be between today and 45 days ahead.');
    expect(forecast.resolveFarm).toHaveBeenCalled();
    expect(forecast.farmToday).toHaveBeenCalledWith('co-1', 'tenant-1');
    expect(forecast.computeForFarm).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-forecast feed-alert.service feed-requisition.service 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: FAIL — `todayInZone is not a function`, `service.farmToday is not a function`, the alert test sees the server day, the requisition test sees no `farmToday` call.

- [ ] **Step 3: Engine helpers** — in `feed-forecast.engine.ts`, directly after `todayLocal`:

```ts
/** True when the runtime knows `zone` as an IANA time zone (Intl throws a RangeError otherwise). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar day in `zone` — spec D16: the planning date defaults to today
 * in the farm's time zone (Africa/Harare for Triple C). Without a usable zone
 * it is todayLocal, the server's day, which is what Plans A and B used, so a
 * company with no zone on record behaves exactly as before.
 */
export function todayInZone(zone: string | null | undefined, ms: number = Date.now()): string {
  if (!zone || !isTimeZone(zone)) return todayLocal(ms);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
```

- [ ] **Step 4: Service** — in `feed-forecast.service.ts`: change the engine import to also take `isTimeZone` and `todayInZone`; add after `ResolvedFarm`:

```ts
/** "Today" for a farm (D16) and the zone it was read in; timeZone null = the server's day (no usable zone on record). */
export interface FarmClock {
  today: string;
  timeZone: string | null;
}
```

Add this method to `FeedForecastService`, right after `resolveFarm`:

```ts
  /**
   * Today in the farm's time zone (D16, open question Q14). A farm row carries
   * no zone, so the company's default_timezone_id is the one on record —
   * Africa/Harare for Triple C. The column is a free varchar with no foreign
   * key, so a value the runtime does not know as an IANA zone is tried as a
   * timezone_master id before giving up. No usable zone → the server's day,
   * which is what the forecast used before, and timeZone null says so.
   */
  async farmToday(companyId: string, tenantId: string, nowMs: number = Date.now()): Promise<FarmClock> {
    const [company] = await this.db
      .select({ zone: schema.companyMaster.default_timezone_id })
      .from(schema.companyMaster)
      .where(and(eq(schema.companyMaster.company_id, companyId), eq(schema.companyMaster.tenant_id, tenantId)))
      .limit(1);
    let zone: string | null = company?.zone ?? null;
    if (zone && !isTimeZone(zone)) {
      const [tz] = await this.db
        .select({ code: schema.timezoneMaster.tz_code })
        .from(schema.timezoneMaster)
        .where(eq(schema.timezoneMaster.tz_id, zone))
        .limit(1);
      zone = tz?.code && isTimeZone(tz.code) ? tz.code : null;
    }
    return { today: todayInZone(zone, nowMs), timeZone: zone };
  }
```

In `computeForFarm`, replace `const planningDate = todayLocal();` with:

```ts
    const { today: planningDate } = await this.farmToday(companyId, tenantId);
```

and drop `todayLocal` from the engine import if nothing else in the file uses it. In `loadFarm`, change `leadTimeDays: row.feed_lead_time_days ?? 0,` to `leadTimeDays: row.feed_lead_time_days ?? 2,` (D19).

- [ ] **Step 5: Alerts** — in `feed-alert.service.ts` `evaluateFarm`, replace `const today = todayLocal(nowMs);` with:

```ts
      // D16: the diet-change and deadline windows count farm days, the same day the forecast plans from.
      const { today } = await this.forecast.farmToday(companyId, tenantId, nowMs);
```

(`todayLocal` stays imported — `lastNotifiedDay` still uses it.)

- [ ] **Step 6: Requisition** — in `feed-requisition.service.ts` `autoDraft`, replace the opening lines (from `const today = serverToday();` through the `resolveFarm` line) with:

```ts
    const { farmId, companyId } = await this.forecast.resolveFarm(dto.farmId, tenantId, user?.userType);
    // D16: the forecast plans from today in the farm's time zone, so `to` is held to the same day.
    const { today } = await this.forecast.farmToday(companyId, tenantId);
    if (dto.to && (dto.to < today || diffDaysIso(today, dto.to) > MAX_SPAN_DAYS)) {
      throw new BadRequestException(`to must be between today and ${MAX_SPAN_DAYS} days ahead.`);
    }
```

- [ ] **Step 7: Migration** `apps/api/src/drizzle/tenant/0120_feed_lead_time_default.sql`:

```sql
-- Spec D19 (Rishi, 26 Sep): Required On = Date to Refill - lead time, and the
-- lead time's default changes from 0 to 2 days. 0114 created the column with
-- DEFAULT 0 on 25 Sep; on nf_devco all 11 FARM rows still held that 0 on
-- 26 Sep, never edited. A deliberate 0 cannot be told from the old default,
-- so FARM rows still at 0 (or NULL) take the new default too — open question
-- Q11; a farm that really wants 0 re-enters it on the farm form.
ALTER TABLE `location_master` ALTER COLUMN `feed_lead_time_days` SET DEFAULT 2;
--> statement-breakpoint
UPDATE `location_master` SET `feed_lead_time_days` = 2
WHERE `location_type` = 'FARM' AND (`feed_lead_time_days` IS NULL OR `feed_lead_time_days` = 0);
```

Append to `meta/_journal.json` `entries`:

```json
    {
      "idx": 120,
      "version": "5",
      "when": 1791049200000,
      "tag": "0120_feed_lead_time_default",
      "breakpoints": true
    }
```

In `schema.ts:1035`: `feed_lead_time_days: int('feed_lead_time_days').default(2),`.

In `location.dto.ts`, both `feed_lead_time_days` `@ApiProperty` descriptions become `'Feed Forecast: Required On is this many days before the Date to Refill (spec D19, default 2). Applies to FARM.'`, and the comment above each reads `// Spec D19: Required On = Date to Refill - this many days; default 2.` In `configs.ts` the field's `helpText` becomes `"Feed Forecast: Required On is this many days before the Date to Refill. Default 2."`.

- [ ] **Step 8: Run to verify they pass**

Run: `pnpm nx test api -- feed-forecast feed-alert feed-requisition location 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → all pass.
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts apps/api/src/modules/inventory/feed-alert/feed-alert.service.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts apps/api/src/drizzle/tenant/0120_feed_lead_time_default.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/master-data/location/dto/location.dto.ts apps/web/src/modules/master-data/configs.ts
git commit -m "feat(feed-forecast): today in the farm time zone; lead time defaults to 2 days

The forecast, the feed alerts and the requisition auto-draft all took the
server's calendar day, so for the hours between midnight in Harare and
midnight on the server the planning date was a day off (spec D16: 'farm
time zone Africa/Harare'). They now read the company's time zone. D19
changes the lead-time default from 0 to 2; 0120 moves the column default
and the farm rows still at the old 0.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 2: Engine — D19 walk: stock date, horizon, low level, confirmed incoming, shortfall

D19: "Run-Down = first date the projected balance falls to the silo's Below Feed Level (`low_level_kg`), or to zero when none is set; projection adds confirmed incoming transfers." Field spec Step 7: "opening ledger balance + confirmed incoming TO quantities − daily use, compared against Below Feed Level KG". The walk stays one daily loop in integer micrograms (Plan A fix round 1); what changes is where it starts (`stockDate`, for a forward planning date — Review Focus 5), how far it looks for the run-down (`horizonTo`, Q12), what it adds each day (incoming, Q2) and what it compares against (the low level, Q1). Rows, flags, `walkDemandKg` and diet changes keep their Plan A/B windows. Each source also carries Date to Refill / Required On / overdue and the **shortfall** the requisition drafts from (Q3).

Three Plan A tests pinned D2's "cannot feed the whole day" at exact multiples; under Q1 they run down one day earlier (the day the balance reaches zero). They are updated here, with the reason, and nothing else in the Plan A/B engine suites changes.

**Files:**
- Modify (replace whole file): `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.walk.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.spec.ts` (three expectations, ~lines 511–542)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts` (the Worked Example `toEqual`, ~lines 36–48)
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts` and `feed-requisition.service.spec.ts` (source fixtures gain the new fields — type-only here; their behaviour changes in Task 8)

**Interfaces:**
- Consumes: `FeedRow`, `feedRowFor` (`production/lifecycle/feed-row-days.ts`); `todayLocal`, `isTimeZone`, `todayInZone` from Task 1 (kept verbatim).
- Produces:

```ts
export interface IncomingFeed { locationId: string; itemId: string; date: string; kg: number } // kg signed: out of the container is negative
// ForecastInput gains (all optional, so Plan A/B callers and tests are unchanged):
//   stockDate?: string            — balances are openings of this day; defaults to planningDate; later than planningDate is ignored
//   horizonTo?: string            — run-down searched up to here; defaults to `to`; earlier than `to` is ignored
//   silos[].lowLevelKg?: number | null
//   incoming?: IncomingFeed[]
//   itemCodes?: Record<string, string> — itemId -> item code (Item No), read in Task 3
// ForecastFlag gains: { kind: 'AS_OF_PAST'; planningDate: string; today: string } (raised by the service, Task 6)
// ForecastSource gains (appended): thresholdKg: number; incomingKg: number; shortfallKg: number;
//   refillDate: string | null; requiredOn: string | null; overdue: boolean
// ForecastSource.balanceKg is now the projected opening balance on the planning date (== input balance when stockDate == planningDate and nothing arrives that day).
```

- [ ] **Step 1: Write the failing tests** — create `feed-forecast.engine.walk.spec.ts`:

```ts
import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan R, spec D19: run-down to the silo's low level (or zero), confirmed
 * incoming, a forward planning date walked from today's stock, a run-down
 * horizon past the visible range, and the shortfall a requisition drafts.
 * One shed, one silo, one batch of 100 pigs at 1 kg/head/day = 100 kg/day.
 */
const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower Diet',
  fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

function oneSilo(over: Partial<ForecastInput> = {}, silo: Partial<ForecastInput['silos'][number]> = {}): ForecastInput {
  return {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525, ...silo }],
    store: null,
    items: { r1: 'Grower Diet' },
    batches: [{
      batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }],
    }],
    feedRows: [row()],
    ...over,
  };
}

describe('buildFeedForecast — D19 run-down to the low level', () => {
  it('runs down on the first day the closing balance is at or below the silo low level', () => {
    // 525 → closes 425, 325, 225, 125 (26 Sep) — the first close at or below 200.
    const { sources, rows } = buildFeedForecast(oneSilo({}, { lowLevelKg: 200 }));
    expect(sources[0]).toMatchObject({
      runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true, thresholdKg: 200, daysLeft: 5,
    });
    expect(rows[0]).toMatchObject({ runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true });
  });

  it('with no low level, an exact multiple runs down on the day it empties — 500 kg at 100 kg/day on day 5 (Q1)', () => {
    const { sources } = buildFeedForecast(oneSilo({}, { balanceKg: 500 }));
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-27', daysLeft: 5, thresholdKg: 0 });
  });

  it("keeps D1's 525 kg sample on day 6", () => {
    expect(buildFeedForecast(oneSilo()).sources[0].runDownDate).toBe('2026-09-28');
  });
});

describe('buildFeedForecast — confirmed incoming (D19, Q2)', () => {
  it('adds a delivery on its date and counts it as incoming for the requisition window', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-25', kg: 300 }] }, { lowLevelKg: 200 });
    // Closes 425, 325, 525 (+300), 425, 325, 225, 125 (29 Sep).
    const { sources } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-09-29', incomingKg: 300, balanceKg: 525 });
    // Deficit below 200 kg at the end of 29 Sep: 700 demand + 200 level − 525 opening − 300 incoming.
    expect(sources[0].shortfallKg).toBe(75);
  });

  it('a delivery after the run-down does not hide it, and the shortfall is the deficit before it arrives', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-28', kg: 1000 }] }, { balanceKg: 100 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0].runDownDate).toBe('2026-09-23');
    // End of 27 Sep: 500 demanded against 100 held — 400 short before the truck; after it the silo is ahead.
    expect(sources[0].shortfallKg).toBe(400);
  });

  it('a transfer out never takes the opening below zero', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-23', kg: -300 }] }, { balanceKg: 100 });
    const { sources } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ balanceKg: 0, runDownDate: '2026-09-23', daysLeft: 0 });
  });

  it('a delivery on the planning date is part of its opening balance, not of incomingKg', () => {
    const input = oneSilo({ incoming: [{ locationId: 's1', itemId: 'r1', date: '2026-09-23', kg: 100 }] });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 625, incomingKg: 0 });
  });
});

describe('buildFeedForecast — forward planning date walks today\'s stock (Review Focus 5)', () => {
  it('consumes the days between the stock date and the planning date without reporting them', () => {
    const input = oneSilo({ stockDate: '2026-09-23', planningDate: '2026-09-25', from: '2026-09-25' });
    // 525 → 425 (23) → 325 (24) = the opening on 25 Sep; then 225, 125, 25, −75 on 28 Sep.
    const { sources, rows } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ balanceKg: 325, daysLeft: 3, runDownDate: '2026-09-28' });
    expect(rows[0].currentInventoryKg).toBe(325);
  });

  it('a silo that ran out before the planning date runs down on the planning date itself', () => {
    const input = oneSilo({ stockDate: '2026-09-23', planningDate: '2026-09-25', from: '2026-09-25' }, { balanceKg: 150 });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 0, runDownDate: '2026-09-25' });
  });

  it('ignores a stock date after the planning date', () => {
    const input = oneSilo({ stockDate: '2026-09-27' });
    expect(buildFeedForecast(input).sources[0]).toMatchObject({ balanceKg: 525, runDownDate: '2026-09-28' });
  });
});

describe('buildFeedForecast — run-down horizon past the range (Q12)', () => {
  it('finds a run-down after `to` while walk demand, rows and shortfall stay on the range', () => {
    const input = oneSilo({ to: '2026-09-25', horizonTo: '2026-10-10' }, { balanceKg: 1000 });
    const { sources, rows } = buildFeedForecast(input);
    expect(sources[0]).toMatchObject({ runDownDate: '2026-10-02', walkDemandKg: 300, shortfallKg: 0 });
    expect(rows[0].rangeDemandKg).toBe(300);
  });

  it('flags a projected stage change only when it falls inside from..to', () => {
    const batch = (start: string): ForecastInput['batches'][number] => ({
      batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [
        { stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: '2026-10-04', projected: false },
        { stageId: 'finisher', stageCode: 'FINISHER', start, end: null, projected: true },
      ],
    });
    const outside = buildFeedForecast(oneSilo({ horizonTo: '2026-10-20', batches: [batch('2026-10-05')] }));
    expect(outside.flags.filter((f) => f.kind === 'STAGE_CHANGE_PROJECTED')).toEqual([]);
  });
});

describe('buildFeedForecast — the Worked Example is unchanged by D19 (Plan B numbers)', () => {
  it('shortfall equals requirement − opening when there is no low level and nothing incoming', () => {
    const input = oneSilo({ leadTimeDays: 0 }, { balanceKg: 1500 });
    input.batches[0].heads = 2000; // 2,000 kg/day for 7 days = 14,000 kg against 1,500 kg
    expect(buildFeedForecast(input).sources[0].shortfallKg).toBe(12500);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-forecast.engine 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: the new suite fails (`thresholdKg`, `shortfallKg`, `incomingKg` undefined; run-down ignores the low level and incoming).

- [ ] **Step 3: Update the three Plan A exact-multiple expectations** in `feed-forecast.engine.spec.ts` (`describe('buildFeedForecast — fix round 1: integer-gram balance walk at exact multiples', …)`). The daysLeft lines stay; only the run-down lines change:

```ts
    expect(rows[0].runDownDate).toBe('2026-09-25'); // D19/Q1: closes at 0 kg at the end of the 3rd day (was D2's day 4)
```
```ts
    expect(rows[0].runDownDate).toBe('2026-09-26'); // D19/Q1: closes at 0 kg at the end of the 4th day (was D2's day 5)
```
```ts
    expect(rows[0].runDownDate).toBe('2026-09-23'); // D19/Q1: one day of stock empties on the planning day itself
```

(replacing `'2026-09-26'; // planning + 3`, `'2026-09-27'; // planning + 4` and `'2026-09-24'; // planning + 1` respectively).

In `feed-forecast.engine.sources.spec.ts`, the first test's `toEqual` gains the new fields — the SILO-001 object ends `lifecycleIds: ['row-r1'], thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,` and the SILO-002 object ends `lifecycleIds: ['row-r2'], thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, refillDate: '2026-09-24', requiredOn: '2026-09-24', overdue: false,`.

In `feed-requisition.rules.spec.ts`, append to the `r1` fixture `thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,` and to `r2` `thresholdKg: 0, incomingKg: 0, shortfallKg: 9000, refillDate: '2026-09-24', requiredOn: '2026-09-24', overdue: false,`. In `feed-requisition.service.spec.ts` the `source()` fixture gains `thresholdKg: 0, incomingKg: 0, shortfallKg: 4500, refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,` before `...over`.

- [ ] **Step 4: Replace `feed-forecast.engine.ts`** with:

```ts
/**
 * Pure feed-forecast engine (Task 6 of the Feed Forecast Plan A design,
 * docs/superpowers/specs/2026-09-25-feed-forecast-design.md, D1-D20). No DB,
 * no Nest — it takes a plain snapshot of sheds/silos/batches/feed rows and
 * returns forecast rows plus data-quality flags. The service layer is
 * responsible for assembling ForecastInput from MySQL and for turning this
 * into the GET /feed-forecast response; this file only does the math, so it
 * can be unit-tested against the workbook's worked example without a
 * database.
 *
 * Ideas that don't fall out of the types by themselves:
 *
 * 1. Balance projection is per (source, item), not per (batch, item) — D9
 *    already guarantees at most one silo per shed holds a given item, but a
 *    single silo can feed several sheds (D7) and the farm STORE is shared by
 *    every shed that falls back to it. So before walking the calendar we
 *    group demand by the physical container ("key" below) and run the
 *    depletion once per container; every row drawing on that container then
 *    reads off the same daysLeft/runDownDate.
 * 2. The balance is a **stock-date snapshot**. Plan A walked from
 *    `planningDate`; Plan R (D16, D19) walks from `stockDate` — the planning
 *    date itself, or today when the planning date is in the future, so the
 *    days in between consume stock without producing rows. Run-down, refill
 *    and required-on are only ever reported on or after the planning date. If
 *    `to` is before planningDate there is nothing to walk and runDownDate is
 *    null. `rangeDemandKg` and `perDayIntakeKg` still describe the requested
 *    `from…to` window.
 * 3. `sourceDailyDemandKg` (used for D1's daysLeft) is the combined demand
 *    on the *planning date specifically* — a diet can start later in the
 *    window (D15), in which case it is legitimately 0 and daysLeft is null.
 * 4. All balance/demand arithmetic is done in integer micrograms
 *    (`Math.round(kg * 1_000_000)`), converted back to kg only for output.
 *    Kg-denominated floats don't divide or subtract exactly in IEEE 754
 *    doubles — `floor(123.6 / 41.2)` can come out 2 instead of 3.
 * 5. Plan B reads `sources` (one entry per physical container and item — the
 *    unit a feed requisition line is drafted for) and `dietChanges` off the
 *    same walk, so the requisition, the alert and the report can never
 *    disagree about demand or dates.
 * 6. D19 (Plan R): each day opens with what the day before left plus what
 *    arrives that day (confirmed incoming), and closes after that day's
 *    demand. A silo cannot go below empty, so demand it cannot meet is not
 *    carried. Run-Down is the first day, on or after the planning date, whose
 *    closing balance is at or below the silo's low level — at or below zero
 *    when none is set (open question Q1). The run-down may be looked for past
 *    `to` (`horizonTo`) so a one-day view still shows it; everything else
 *    keeps its window.
 */
import { FeedRow, feedRowFor } from '../../production/lifecycle/feed-row-days';

/** D19 "confirmed incoming" into (or, negative, out of) one container, on one day. What counts is the service's rule (Q2). */
export interface IncomingFeed {
  locationId: string; // silo_id or the store's location_id
  itemId: string;
  date: string;
  kg: number;
}

export interface ForecastInput {
  planningDate: string;
  from: string;
  to: string;
  /** Balances below are opening balances of this day (D19). Defaults to planningDate; a later date is ignored. */
  stockDate?: string;
  /** Run-down, refill and required-on are searched up to here (Q12). Defaults to `to`; an earlier date is ignored. */
  horizonTo?: string;
  refillBufferDays: number;
  leadTimeDays: number;
  sheds: { shedId: string; shedCode: string; siloIds: string[] }[];
  silos: { siloId: string; siloCode: string; itemId: string | null; balanceKg: number; lowLevelKg?: number | null }[];
  store: { storeId: string; storeCode: string; balances: Record<string, number> } | null;
  incoming?: IncomingFeed[];
  items: Record<string, string>; // itemId -> item name
  itemCodes?: Record<string, string>; // itemId -> item code (Item No, D16)
  batches: {
    batchId: string;
    batchNo: string;
    breedId: string;
    shedId: string;
    heads: number;
    segments: { stageId: string; stageCode: string; start: string; end: string | null; projected: boolean }[];
  }[];
  feedRows: FeedRow[];
}

export type ForecastFlag =
  | { kind: 'NO_FEED_ROW'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'OVERLAPPING_FEED_ROWS'; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: 'NO_SILO_HOLDS_ITEM'; shedCode: string; itemName: string }
  | { kind: 'STAGE_CHANGE_PROJECTED'; batchNo: string; stageCode: string; date: string }
  | { kind: 'HEADS_ASSUMED_FLAT'; batchNo: string }
  // Raised by the service, not this engine: the batch's location did not resolve to an active SHED of the farm, so it
  // was passed with no shed and draws on the STORE — flagged so it is not mistaken for a D6 shed-without-silo.
  | { kind: 'BATCH_SHED_UNKNOWN'; batchNo: string }
  // Raised by the service (Plan R, Q8): the planning date is in the past — balances are as of it, heads are today's.
  | { kind: 'AS_OF_PAST'; planningDate: string; today: string };

export interface ForecastRow {
  batchNo: string;
  itemId: string;
  itemName: string;
  shedCode: string;
  planningDate: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number | null; // this row, first day it has demand in range
  sourceDailyDemandKg: number | null; // all rows on the same source+item, planning day
  daysLeft: number | null; // D1
  runDownDate: string | null; // D19; null = lasts to the horizon
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean; // D3/D19
  rangeDemandKg: number;
}

export interface ForecastSource {
  sourceType: 'SILO' | 'STORE';
  sourceCode: string;
  locationId: string; // silo_id or the store's location_id
  itemId: string;
  itemName: string;
  balanceKg: number; // projected System Balance at the start of the planning date
  planningDayDemandKg: number; // combined demand on the planning date
  firstDemandDate: string | null; // first day (planningDate..to) with demand
  firstDayDemandKg: number; // combined demand on firstDemandDate
  walkDemandKg: number; // combined demand planningDate..to
  daysLeft: number | null; // D1
  runDownDate: string | null; // D19
  isNextDiet: boolean; // a batch changes onto this item in the window and nothing eats it today
  noSiloHoldsItem: boolean; // a shed with silos draws it from the store because no silo holds it
  lifecycleIds: string[]; // lifecycle rows that produce its demand in the window, sorted
  thresholdKg: number; // D19: the silo's low level, 0 for none and for a store
  incomingKg: number; // confirmed incoming after the planning date, up to `to`
  shortfallKg: number; // Q3: largest deficit below thresholdKg through `to` after incoming — what an order must bring
  refillDate: string | null; // D19: runDownDate − refill buffer
  requiredOn: string | null; // D19: refillDate − lead time
  overdue: boolean; // requiredOn before the planning date
}

export interface DietChange {
  batchId: string;
  batchNo: string;
  shedCode: string;
  fromItemId: string;
  fromItemName: string;
  toItemId: string;
  toItemName: string;
  changeDate: string; // first day of the new diet, > planningDate
  nextSourceType: 'SILO' | 'STORE' | 'NONE';
  nextSourceCode: string | null; // the silo that will feed it, null unless SILO
}

export interface ForecastResult {
  rows: ForecastRow[];
  flags: ForecastFlag[];
  sources: ForecastSource[];
  dietChanges: DietChange[];
}

/** Date arithmetic on UTC midnights — farm-local calendar days in, UTC midnight math internally. */
function parseIsoUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatIsoUtc(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Exported for Plan B's requisition rules (feed-requisition.rules.ts, ruling L12) so calendar-date arithmetic has one
// implementation, not a second copy.
export function addDays(iso: string, n: number): string {
  return formatIsoUtc(parseIsoUtc(iso) + n * 86_400_000);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parseIsoUtc(b) - parseIsoUtc(a)) / 86_400_000);
}

/**
 * The server's own calendar day, not the UTC one: `toISOString()` would hand a
 * farm east of Greenwich yesterday's date for the first hours of every
 * morning. Lives here, beside addDays/diffDays, so the forecast service, the
 * alert evaluator and the requisition rules share one pure implementation
 * (Ruling L12). todayInZone below is what the forecast now plans from (D16).
 */
export function todayLocal(ms: number = Date.now()): string {
  const now = new Date(ms);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** True when the runtime knows `zone` as an IANA time zone (Intl throws a RangeError otherwise). */
export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar day in `zone` — spec D16: the planning date defaults to today
 * in the farm's time zone (Africa/Harare for Triple C). Without a usable zone
 * it is todayLocal, the server's day, which is what Plans A and B used, so a
 * company with no zone on record behaves exactly as before.
 */
export function todayInZone(zone: string | null | undefined, ms: number = Date.now()): string {
  if (!zone || !isTimeZone(zone)) return todayLocal(ms);
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

/**
 * Timestamps Plan B writes from JavaScript follow the codebase's convention
 * for JS-written datetime columns: UTC as `YYYY-MM-DD HH:MM:SS` — the
 * `toISOString().slice(0, 19)` form some forty services use.
 * `parseUtcTimestamp` reads back only what `utcTimestamp` wrote.
 */
export function utcTimestamp(ms: number = Date.now()): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function parseUtcTimestamp(s: string): number {
  return Date.parse(`${s.replace(' ', 'T')}Z`);
}

/** Inclusive list of ISO dates from `from` to `to`; empty if `to` is before `from`. */
function dateRange(from: string, to: string): string[] {
  const days = diffDays(from, to);
  const dates: string[] = [];
  for (let i = 0; i <= days; i++) dates.push(addDays(from, i));
  return dates;
}

/**
 * kg -> integer micrograms, so the balance walk divides and subtracts exactly. Whole grams aren't fine-grained
 * enough: 50 heads x 0.35 kg/day x 2.5% wastage is exactly 17.9375 kg/day, a half-gram at 1e3x scale.
 */
function toMicrograms(kg: number): number {
  return Math.round(kg * 1_000_000);
}

function toKg(micrograms: number): number {
  return micrograms / 1_000_000;
}

type SourceResolution = {
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  // The shed has silos but none holds this item, so it falls back to the store (Plan A Task 4's rule).
  noSiloHoldsItem: boolean;
};

/** One physical container (a silo, or the shared farm store) holding one item — the unit balance projection runs over. */
interface SourceKey {
  key: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  siloId: string | null;
  storeId: string | null;
  itemId: string;
}

export function buildFeedForecast(input: ForecastInput): ForecastResult {
  const flags: ForecastFlag[] = [];

  // Plan R: the walk may start before the planning date and look past `to`; neither widens what rows, flags, walk
  // demand or diet changes cover (see #2 and #6 above).
  const stockDate = input.stockDate && input.stockDate < input.planningDate ? input.stockDate : input.planningDate;
  const horizonTo = input.horizonTo && input.horizonTo > input.to ? input.horizonTo : input.to;

  // The visible/reporting window (rangeDemandKg, perDayIntakeKg, NO_FEED_ROW/OVERLAP flags).
  const rangeDates = dateRange(input.from, input.to);
  const isInRange = (date: string) => date >= input.from && date <= input.to;

  // Planning window: planningDate..to — Plan B's requisition window (walk demand, lifecycle ids, diet changes).
  const planDates = input.planningDate <= input.to ? dateRange(input.planningDate, input.to) : [];

  // Balance walk: stockDate..horizonTo, and nothing at all when `to` precedes the planning date.
  const walkDates = planDates.length ? dateRange(stockDate, horizonTo) : [];

  const demandDates = Array.from(new Set([...rangeDates, ...walkDates, input.planningDate])).sort();

  const siloById = new Map(input.silos.map((s) => [s.siloId, s]));
  const shedById = new Map(input.sheds.map((s) => [s.shedId, s]));

  // D19 incoming, per container and item, per day, in micrograms (several transfers on one day add up).
  const incomingByLocation = new Map<string, Map<string, number>>();
  for (const inc of input.incoming ?? []) {
    const k = `${inc.locationId}|${inc.itemId}`;
    let byDate = incomingByLocation.get(k);
    if (!byDate) {
      byDate = new Map();
      incomingByLocation.set(k, byDate);
    }
    byDate.set(inc.date, (byDate.get(inc.date) ?? 0) + toMicrograms(inc.kg));
  }

  // D9: no shed has two silos holding the same item, so this lookup is safe — at most one match per (shed, item).
  const sourceCache = new Map<string, SourceResolution>();
  function resolveSource(shedId: string, itemId: string): SourceResolution {
    const cacheKey = `${shedId}:${itemId}`;
    const cached = sourceCache.get(cacheKey);
    if (cached) return cached;

    const shed = shedById.get(shedId);
    const shedSilos = (shed?.siloIds ?? []).map((id) => siloById.get(id)).filter((s): s is NonNullable<typeof s> => !!s);
    const matching = shedSilos.find((s) => s.itemId === itemId);

    let resolution: SourceResolution;
    if (matching) {
      resolution = { sourceType: 'SILO', sourceCode: matching.siloCode, siloId: matching.siloId, storeId: null, noSiloHoldsItem: false };
    } else if (shedSilos.length === 0) {
      // D6: sheds without a silo are included, fed from the farm STORE — no flag, this is expected.
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: false }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: false };
    } else {
      // The shed has silos, but none of them hold this item — falls back to STORE (Task 4's daily-entry rule).
      resolution = input.store
        ? { sourceType: 'STORE', sourceCode: input.store.storeCode, siloId: null, storeId: input.store.storeId, noSiloHoldsItem: true }
        : { sourceType: 'NONE', sourceCode: null, siloId: null, storeId: null, noSiloHoldsItem: true };
    }
    sourceCache.set(cacheKey, resolution);
    return resolution;
  }

  // NO_SILO_HOLDS_ITEM once per (shed, item), and only for demand up to `to` — a diet that starts only in the
  // run-down horizon past the range is not something the user asked to see (Plan R; Plan A never walked past `to`).
  const flaggedNoSilo = new Set<string>();
  function flagNoSilo(shedId: string, itemId: string) {
    const k = `${shedId}:${itemId}`;
    if (flaggedNoSilo.has(k)) return;
    flaggedNoSilo.add(k);
    flags.push({ kind: 'NO_SILO_HOLDS_ITEM', shedCode: shedById.get(shedId)?.shedCode ?? '', itemName: input.items[itemId] ?? itemId });
  }

  function sourceKeyFor(resolution: SourceResolution, itemId: string): SourceKey {
    return {
      key: `${resolution.sourceType}:${resolution.sourceCode ?? 'NONE'}:${itemId}`,
      sourceType: resolution.sourceType,
      sourceCode: resolution.sourceCode,
      siloId: resolution.siloId,
      storeId: resolution.storeId,
      itemId,
    };
  }

  /** Opening balance at stockDate in micrograms — silos are looked up by siloId (the stable key), not siloCode. */
  function balanceMicrogramsFor(sk: SourceKey): number {
    if (sk.sourceType === 'SILO') {
      const silo = sk.siloId ? siloById.get(sk.siloId) : undefined;
      return toMicrograms(silo?.balanceKg ?? 0);
    }
    if (sk.sourceType === 'STORE') {
      return toMicrograms(input.store?.balances[sk.itemId] ?? 0);
    }
    return 0;
  }

  /** D19: the silo's Below Feed Level; a store and a silo without one run down to zero. */
  function thresholdMicrogramsFor(sk: SourceKey): number {
    if (sk.sourceType !== 'SILO' || !sk.siloId) return 0;
    const low = siloById.get(sk.siloId)?.lowLevelKg;
    return low != null && low > 0 ? toMicrograms(low) : 0;
  }

  // Demand per source-key per calendar day, in micrograms, accumulated across every batch that draws on that container.
  const demandMicrogramsByKeyByDate = new Map<string, Map<string, number>>();
  const keyMeta = new Map<string, SourceKey>();

  // Per (batch, item) row aggregate — one ForecastRow per pair that has at least one day of demand > 0 in range.
  interface RowAgg {
    batchNo: string;
    itemId: string;
    shedCode: string;
    heads: number;
    key: string;
    sourceType: 'SILO' | 'STORE' | 'NONE';
    sourceCode: string | null;
    rangeDemandMicrograms: number;
    perDayIntakeMicrograms: number; // set once, on the first in-range day with demand > 0
    firstDemandDate: string;
  }
  const rowAggs = new Map<string, RowAgg>(); // keyed by batchId:itemId

  // Plan B: which lifecycle rows feed each container inside the planning window, which item each batch eats on each
  // planning day (for diet changes), and which containers are a store fallback for a shed that has silos.
  const lifecycleIdsByKey = new Map<string, Set<string>>();
  const itemByBatchDate = new Map<string, string>();
  const noSiloKeys = new Set<string>();

  for (const batch of input.batches) {
    flags.push({ kind: 'HEADS_ASSUMED_FLAT', batchNo: batch.batchNo }); // D11: heads assumed flat unless movements say otherwise
    for (const segment of batch.segments) {
      // The service projects stages to the run-down horizon; only a change the user can see in from..to is flagged.
      if (segment.projected && segment.start <= input.to) {
        flags.push({ kind: 'STAGE_CHANGE_PROJECTED', batchNo: batch.batchNo, stageCode: segment.stageCode, date: segment.start });
      }
    }

    const feedRowsForBreed = input.feedRows.filter((r) => r.breedId === batch.breedId);

    for (const date of demandDates) {
      const segment = batch.segments.find((s) => s.start <= date && (s.end === null || date <= s.end));
      if (!segment) continue;

      const dayOfStage = diffDays(segment.start, date) + 1;
      const candidates = feedRowsForBreed.filter((r) => r.stageId === segment.stageId);
      const result = feedRowFor(candidates, dayOfStage);

      if ('error' in result) {
        // Flags are reserved for the visible window; a gap outside it still correctly contributes no demand.
        if (isInRange(date)) {
          flags.push({
            kind: result.error === 'NONE' ? 'NO_FEED_ROW' : 'OVERLAPPING_FEED_ROWS',
            batchNo: batch.batchNo,
            stageCode: segment.stageCode,
            day: dayOfStage,
            date,
          });
        }
        continue;
      }

      const feedRow = result.row;
      const demandMicrograms = toMicrograms(batch.heads * feedRow.kgPerHeadPerDay * (1 + feedRow.wastagePct / 100));
      if (demandMicrograms <= 0) continue; // zero demand: no row, no source resolution, nothing to project

      const resolution = resolveSource(batch.shedId, feedRow.itemId);
      if (resolution.noSiloHoldsItem && date <= input.to) flagNoSilo(batch.shedId, feedRow.itemId);
      const sk = sourceKeyFor(resolution, feedRow.itemId);
      keyMeta.set(sk.key, sk);

      let byDate = demandMicrogramsByKeyByDate.get(sk.key);
      if (!byDate) {
        byDate = new Map();
        demandMicrogramsByKeyByDate.set(sk.key, byDate);
      }
      byDate.set(date, (byDate.get(date) ?? 0) + demandMicrograms);

      if (date >= input.planningDate && date <= input.to) {
        let ids = lifecycleIdsByKey.get(sk.key);
        if (!ids) {
          ids = new Set();
          lifecycleIdsByKey.set(sk.key, ids);
        }
        ids.add(feedRow.lifecycleId);
        itemByBatchDate.set(`${batch.batchId}|${date}`, feedRow.itemId);
        if (resolution.noSiloHoldsItem) noSiloKeys.add(sk.key);
      }

      if (!isInRange(date)) continue; // walk-only date: contributes to the balance, not to the row

      const aggKey = `${batch.batchId}:${feedRow.itemId}`;
      let agg = rowAggs.get(aggKey);
      if (!agg) {
        const shed = shedById.get(batch.shedId);
        agg = {
          batchNo: batch.batchNo,
          itemId: feedRow.itemId,
          shedCode: shed?.shedCode ?? '',
          heads: batch.heads,
          key: sk.key,
          sourceType: sk.sourceType,
          sourceCode: sk.sourceCode,
          rangeDemandMicrograms: 0,
          perDayIntakeMicrograms: demandMicrograms,
          firstDemandDate: date,
        };
        rowAggs.set(aggKey, agg);
      }
      agg.rangeDemandMicrograms += demandMicrograms;
    }
  }

  // Balance projection per source key (D1, D19), computed once and shared by every row drawing on that container.
  interface KeyProjection {
    currentInventoryKg: number;
    sourceDailyDemandKg: number | null;
    daysLeft: number | null;
    runDownDate: string | null;
    refillDate: string | null;
    requiredOn: string | null;
    overdue: boolean;
    walkDemandKg: number;
    firstDemandDate: string | null;
    firstDayDemandKg: number;
    thresholdKg: number;
    incomingKg: number;
    shortfallKg: number;
  }
  const projectionByKey = new Map<string, KeyProjection>();
  // Opening balance of every walked day, per key — the per-date rows (Task 3) read Current Inventory off it.
  const openingByKey = new Map<string, Map<string, number>>();

  for (const [key, sk] of keyMeta) {
    const byDate = demandMicrogramsByKeyByDate.get(key) ?? new Map<string, number>();
    const locationId = sk.siloId ?? sk.storeId;
    const inflow = (locationId ? incomingByLocation.get(`${locationId}|${sk.itemId}`) : undefined) ?? new Map<string, number>();
    const threshold = thresholdMicrogramsFor(sk);

    const opening = new Map<string, number>();
    let carried = balanceMicrogramsFor(sk);
    let runDownDate: string | null = null;
    for (const date of walkDates) {
      // A transfer out can exceed what is there on paper; a silo is never below empty.
      const open = Math.max(0, carried + (inflow.get(date) ?? 0));
      opening.set(date, open);
      const demand = byDate.get(date) ?? 0;
      const closing = open - demand;
      if (runDownDate === null && date >= input.planningDate && demand > 0 && closing <= threshold) runDownDate = date;
      carried = Math.max(0, closing); // demand the silo cannot meet is not carried into the next day
    }
    openingByKey.set(key, opening);
    const planningOpening = opening.get(input.planningDate) ?? balanceMicrogramsFor(sk);

    const sourceDailyDemandMicrograms = byDate.get(input.planningDate) ?? 0;
    const daysLeft = sourceDailyDemandMicrograms > 0 ? Math.floor(planningOpening / sourceDailyDemandMicrograms) : null;

    const refillDate = runDownDate !== null ? addDays(runDownDate, -input.refillBufferDays) : null;
    const requiredOn = refillDate !== null ? addDays(refillDate, -input.leadTimeDays) : null;
    const overdue = requiredOn !== null && requiredOn < input.planningDate;

    // Plan B's window (planningDate..to): walk demand, first demand day, and — Plan R, Q3 — the shortfall: the largest
    // amount by which the balance would sit below the threshold at the end of any day if nothing more were ordered.
    // Without a low level or incoming it is simply requirement − opening, the Worked Example's column G.
    let walkDemandMicrograms = 0;
    let firstDemandDate: string | null = null;
    let firstDayDemandMicrograms = 0;
    let incomingMicrograms = 0;
    let shortfallMicrograms = 0;
    for (const date of planDates) {
      const m = byDate.get(date) ?? 0;
      if (m > 0 && firstDemandDate === null) {
        firstDemandDate = date;
        firstDayDemandMicrograms = m;
      }
      walkDemandMicrograms += m;
      if (date !== input.planningDate) incomingMicrograms += inflow.get(date) ?? 0; // the planning day's is in its opening
      shortfallMicrograms = Math.max(shortfallMicrograms, walkDemandMicrograms + threshold - planningOpening - incomingMicrograms);
    }

    projectionByKey.set(key, {
      currentInventoryKg: toKg(planningOpening),
      sourceDailyDemandKg: toKg(sourceDailyDemandMicrograms),
      daysLeft,
      runDownDate,
      refillDate,
      requiredOn,
      overdue,
      walkDemandKg: toKg(walkDemandMicrograms),
      firstDemandDate,
      firstDayDemandKg: toKg(firstDayDemandMicrograms),
      thresholdKg: toKg(threshold),
      incomingKg: toKg(incomingMicrograms),
      shortfallKg: toKg(shortfallMicrograms),
    });
  }

  // Diet changes (checkpoint 30): a batch whose item changes between two planning days, compared against the last day
  // that HAD an item — not strictly the day before (a gap day with no feed row must not hide the change).
  const dietChanges: DietChange[] = [];
  const nextDietKeys = new Set<string>();
  for (const batch of input.batches) {
    let lastItem: string | null = null;
    for (const date of planDates) {
      const item = itemByBatchDate.get(`${batch.batchId}|${date}`);
      if (!item) continue;
      if (lastItem !== null && item !== lastItem) {
        const next = resolveSource(batch.shedId, item); // cached: already resolved by the demand loop
        nextDietKeys.add(sourceKeyFor(next, item).key);
        dietChanges.push({
          batchId: batch.batchId,
          batchNo: batch.batchNo,
          shedCode: shedById.get(batch.shedId)?.shedCode ?? '',
          fromItemId: lastItem,
          fromItemName: input.items[lastItem] ?? lastItem,
          toItemId: item,
          toItemName: input.items[item] ?? item,
          changeDate: date,
          nextSourceType: next.sourceType,
          nextSourceCode: next.sourceType === 'SILO' ? next.sourceCode : null,
        });
      }
      lastItem = item;
    }
  }
  dietChanges.sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
    return a.changeDate < b.changeDate ? -1 : a.changeDate > b.changeDate ? 1 : 0;
  });

  // One summary per real container and item. NONE (no silo, no store) has nowhere to deliver to, so no requisition line.
  const sources: ForecastSource[] = [];
  for (const [key, sk] of keyMeta) {
    if (sk.sourceType === 'NONE') continue;
    const p = projectionByKey.get(key)!;
    // Demand only before the planning date or only past `to` (the run-down horizon) is nothing to requisition now.
    if (p.walkDemandKg <= 0) continue;
    const planningDayDemandKg = p.sourceDailyDemandKg ?? 0;
    sources.push({
      sourceType: sk.sourceType,
      sourceCode: sk.sourceCode!,
      locationId: (sk.siloId ?? sk.storeId)!,
      itemId: sk.itemId,
      itemName: input.items[sk.itemId] ?? sk.itemId,
      balanceKg: p.currentInventoryKg,
      planningDayDemandKg,
      firstDemandDate: p.firstDemandDate,
      firstDayDemandKg: p.firstDayDemandKg,
      walkDemandKg: p.walkDemandKg,
      daysLeft: p.daysLeft,
      runDownDate: p.runDownDate,
      isNextDiet: nextDietKeys.has(key) && planningDayDemandKg === 0,
      noSiloHoldsItem: noSiloKeys.has(key),
      lifecycleIds: [...(lifecycleIdsByKey.get(key) ?? [])].sort(),
      thresholdKg: p.thresholdKg,
      incomingKg: p.incomingKg,
      shortfallKg: p.shortfallKg,
      refillDate: p.refillDate,
      requiredOn: p.requiredOn,
      overdue: p.overdue,
    });
  }
  sources.sort((a, b) => (a.sourceCode !== b.sourceCode ? (a.sourceCode < b.sourceCode ? -1 : 1) : a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0));

  const entries: { row: ForecastRow; firstDemandDate: string }[] = [];
  for (const agg of rowAggs.values()) {
    const projection = projectionByKey.get(agg.key)!;
    entries.push({
      firstDemandDate: agg.firstDemandDate,
      row: {
        batchNo: agg.batchNo,
        itemId: agg.itemId,
        itemName: input.items[agg.itemId] ?? agg.itemId,
        shedCode: agg.shedCode,
        planningDate: input.planningDate,
        sourceType: agg.sourceType,
        sourceCode: agg.sourceCode,
        currentInventoryKg: projection.currentInventoryKg,
        heads: agg.heads,
        perDayIntakeKg: toKg(agg.perDayIntakeMicrograms),
        sourceDailyDemandKg: projection.sourceDailyDemandKg,
        daysLeft: projection.daysLeft,
        runDownDate: projection.runDownDate,
        refillDate: projection.refillDate,
        requiredOn: projection.requiredOn,
        overdue: projection.overdue,
        rangeDemandKg: toKg(agg.rangeDemandMicrograms),
      },
    });
  }

  entries.sort((a, b) => {
    if (a.row.shedCode !== b.row.shedCode) return a.row.shedCode < b.row.shedCode ? -1 : 1;
    if (a.row.batchNo !== b.row.batchNo) return a.row.batchNo < b.row.batchNo ? -1 : 1;
    return a.firstDemandDate < b.firstDemandDate ? -1 : a.firstDemandDate > b.firstDemandDate ? 1 : 0;
  });

  return { rows: entries.map((e) => e.row), flags, sources, dietChanges };
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `pnpm nx test api -- feed-forecast feed-requisition feed-alert 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: PASS — the new walk suite, the updated Plan A suite, the sources suite, and the requisition/alert suites unchanged in behaviour.
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS (the fixtures carry the new required fields).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.walk.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts
git commit -m "feat(feed-forecast): run down to the silo low level with confirmed incoming (D19)

The walk ran every silo to empty and ignored anything on its way in, so a
silo with a 1,000 kg low level showed its run-down days after the farm
needed to act, and a truck already booked did not move it. Run-Down is now
the first day the closing balance is at or below the silo's Below Feed
Level (zero without one), incoming is added on its date, a forward
planning date walks today's stock up to it, and the run-down can be found
past the visible range. Each source carries its refill and required-on
dates and the shortfall a requisition must bring. Three Plan A tests that
pinned D2's 'cannot feed the whole day' at exact multiples now run down on
the day the balance reaches zero (Q1).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Engine — one row per batch, item and date (D16–D18)

Field spec, Report Grid: "One row is produced per Batch + Feed Item + Forecast Date … If a batch's diet changes inside the selected Range, it produces two rows — one for the old Feed Item and one for the new — never one blended row." Each row carries what the specification's columns need **for that date**: projected Current Inventory (Q6), heads, Per Day Intake = heads × rate **without** wastage (D17), the demand **with** wastage (what leaves the silo), Days of Stock at silo level with the number of batches sharing the silo (D18, Q5), the "indicative" flag (Q13), Item No (D16) and the source's run-down / refill / required-on. Rows start at the planning date or `from`, whichever is later (Q7). The existing `rows` (one per batch + item) stay for the engine's own tests.

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` (Task 2's version)
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.daily.spec.ts`

**Interfaces:**
- Consumes: Task 2's `ForecastInput` (incl. `itemCodes`), `openingByKey`, `projectionByKey`, `planDates`.
- Produces:

```ts
export interface DailyForecastRow {
  date: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string; // item code, '' when unknown
  itemName: string;
  lifecycleId: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  currentInventoryKg: number; // projected System Balance at the start of `date` (Q6)
  heads: number;
  feedRateKg: number; // kg per head per day
  perDayIntakeKg: number; // D17: heads × rate, no wastage
  wastagePct: number;
  demandKg: number; // heads × rate × (1 + wastage %): what leaves the silo
  daysOfStock: number | null; // D18: floor(currentInventory ÷ the container's demand that day)
  sharedBatchCount: number; // batches drawing on the same container and item that day
  indicative: boolean; // Q13
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}
// ForecastResult gains: daily: DailyForecastRow[]  (sorted by shedCode, batchNo, date, itemName)
```

- [ ] **Step 1: Write the failing tests** — create `feed-forecast.engine.daily.spec.ts`:

```ts
import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';

/**
 * Plan R, spec D16–D18: one row per batch, item and date. The first fixture is
 * the workbook's Worked Example (GRS H3, WG-2026-38, 1,000 pigs; R1 days 25–27
 * at 2.0 kg = 23–25 Sep, R2 days 28–31 at 2.5 kg = 26–29 Sep; SILO1 R1 1,500 kg,
 * SILO2 R2 1,000 kg).
 */
const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 0 },
  ],
};

describe('buildFeedForecast — daily rows on the Worked Example', () => {
  const { daily } = buildFeedForecast(workedExample);

  it('gives R1 its three days and R2 its four as separate rows, never blended', () => {
    expect(daily.map((d) => `${d.date} ${d.itemNo}`)).toEqual([
      '2026-09-23 FEED-R1', '2026-09-24 FEED-R1', '2026-09-25 FEED-R1',
      '2026-09-26 FEED-R2', '2026-09-27 FEED-R2', '2026-09-28 FEED-R2', '2026-09-29 FEED-R2',
    ]);
  });

  it('projects Current Inventory per date: SILO1 opens 1,500 then is empty; SILO2 opens 1,000 on the change day', () => {
    expect(daily.map((d) => d.currentInventoryKg)).toEqual([1500, 0, 0, 1000, 0, 0, 0]);
    expect(daily[0]).toMatchObject({
      batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER', itemName: 'Weaner Diet R1', sourceCode: 'GRS/SILO-001',
      heads: 1000, feedRateKg: 2, perDayIntakeKg: 2000, demandKg: 2000, daysOfStock: 0, sharedBatchCount: 1,
      runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-21', overdue: true,
    });
    expect(daily[3]).toMatchObject({ sourceCode: 'GRS/SILO-002', perDayIntakeKg: 2500, daysOfStock: 0, runDownDate: '2026-09-26' });
  });

  it('flags R1 rows indicative (their silo stops being eaten on 26 Sep) and R2 rows not (Q13)', () => {
    expect(daily.map((d) => d.indicative)).toEqual([true, true, true, false, false, false, false]);
  });
});

const row = (over: Partial<FeedRow> = {}): FeedRow => ({
  lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower Diet',
  fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
});

describe('buildFeedForecast — D17 intake without wastage, D18 days of stock with it (Q5)', () => {
  it('shows 100 kg intake but divides the silo by the 110 kg it loses a day', () => {
    const input: ForecastInput = {
      planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-23', refillBufferDays: 2, leadTimeDays: 2,
      sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
      silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 525 }],
      store: null, items: { r1: 'Grower Diet' },
      batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
      feedRows: [row({ wastagePct: 10 })],
    };
    expect(buildFeedForecast(input).daily[0]).toMatchObject({ perDayIntakeKg: 100, wastagePct: 10, demandKg: 110, daysOfStock: 4, itemNo: '' });
  });
});

describe('buildFeedForecast — shared silo, one batch changes diet (Review Focus 1)', () => {
  // Shed H1 has SILO-001 (R1, 1,000 kg) and SILO-002 (R2, 500 kg). GR-01 eats R1 all week; GR-02 eats R1 until
  // 25 Sep and R2 from 26 Sep (its own breed's rows: R1 days 1–25, R2 from day 26, stage entered 1 Sep).
  const input: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1', 's2'] }],
    silos: [
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 500 },
    ],
    store: null,
    items: { r1: 'Grower R1', r2: 'Grower R2' },
    batches: [
      { batchId: 'b1', batchNo: 'GR-01', breedId: 'l', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
      { batchId: 'b2', batchNo: 'GR-02', breedId: 'l2', shedId: 'h1', heads: 100,
        segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] },
    ],
    feedRows: [
      row(),
      row({ lifecycleId: 'b-r1', breedId: 'l2', toDay: 25 }),
      row({ lifecycleId: 'b-r2', breedId: 'l2', itemId: 'r2', itemName: 'Grower R2', fromDay: 26, toDay: 200 }),
    ],
  };
  const { daily } = buildFeedForecast(input);
  const at = (batchNo: string, date: string, itemId: string) => daily.find((d) => d.batchNo === batchNo && d.date === date && d.itemId === itemId)!;

  it('divides the shared silo by both batches while both eat from it, and says it is shared', () => {
    // SILO-001 feeds 200 kg/day to 25 Sep: opens 1,000 on 23 Sep → 5 days.
    expect(at('GR-01', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 5, sharedBatchCount: 2, indicative: true });
    expect(at('GR-02', '2026-09-23', 'r1')).toMatchObject({ currentInventoryKg: 1000, daysOfStock: 5, sharedBatchCount: 2, indicative: true });
  });

  it('after the change the silo feeds one batch: 400 kg at 100 kg/day is 4 days, not indicative any more', () => {
    expect(at('GR-01', '2026-09-26', 'r1')).toMatchObject({ currentInventoryKg: 400, daysOfStock: 4, sharedBatchCount: 1, indicative: false });
  });

  it('gives GR-02 an R1 row up to 25 Sep and a separate R2 row from 26 Sep', () => {
    expect(daily.filter((d) => d.batchNo === 'GR-02').map((d) => `${d.date} ${d.itemId}`)).toEqual([
      '2026-09-23 r1', '2026-09-24 r1', '2026-09-25 r1',
      '2026-09-26 r2', '2026-09-27 r2', '2026-09-28 r2', '2026-09-29 r2',
    ]);
    expect(at('GR-02', '2026-09-26', 'r2')).toMatchObject({ sourceCode: 'GRS/SILO-002', currentInventoryKg: 500, daysOfStock: 5, sharedBatchCount: 1 });
  });
});

describe('buildFeedForecast — rows start at the planning date (Q7)', () => {
  const base: ForecastInput = {
    planningDate: '2026-09-23', from: '2026-09-20', to: '2026-09-25', refillBufferDays: 2, leadTimeDays: 2,
    sheds: [{ shedId: 'h1', shedCode: 'GRS/SHED-001', siloIds: ['s1'] }],
    silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 5000 }],
    store: null, items: { r1: 'Grower Diet' },
    batches: [{ batchId: 'b1', batchNo: 'GR-2026-01', breedId: 'l', shedId: 'h1', heads: 100,
      segments: [{ stageId: 'grower', stageCode: 'GROWER', start: '2026-09-01', end: null, projected: false }] }],
    feedRows: [row()],
  };

  it('does not forecast 20–22 Sep when the planning date is the 23rd', () => {
    expect(buildFeedForecast(base).daily.map((d) => d.date)).toEqual(['2026-09-23', '2026-09-24', '2026-09-25']);
  });

  it('has no rows at all when the range ends before the planning date', () => {
    expect(buildFeedForecast({ ...base, from: '2026-09-10', to: '2026-09-15' }).daily).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-forecast.engine.daily 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: FAIL — `daily` is undefined.

- [ ] **Step 3: Implement** — five edits to `feed-forecast.engine.ts`.

(a) After the `ForecastRow` interface, add the `DailyForecastRow` interface exactly as in **Interfaces** above, with this comment above it:

```ts
/**
 * Plan R (spec D16–D18; field specification of 26 Sep, Report Grid): one row
 * per batch, feed item and forecast date. A diet change is a new item, so it
 * is a new row — never blended. Current Inventory is the container's
 * projected opening balance that day; Days of Stock is the container's, not
 * the batch's (D18); Per Day Intake leaves wastage out (D17) while demandKg
 * keeps it, because wasted feed still leaves the silo.
 */
```

(b) In `ForecastResult`, add `daily: DailyForecastRow[];` after `dietChanges: DietChange[];`.

(c) Directly after `const noSiloKeys = new Set<string>();` add:

```ts

  // Plan R: per-date rows run from the planning date (or `from`, if later) to `to` (Q7). The batches eating from a
  // container on a day give its shared count (D18); an ANIMAL_WISE batch's stage groups count as separate batches,
  // because each is fed its own stage's diet.
  const rowFrom = input.from > input.planningDate ? input.from : input.planningDate;
  interface DailyEntry {
    date: string;
    batchId: string;
    batchNo: string;
    shedId: string;
    heads: number;
    stageCode: string;
    feedRow: FeedRow;
    key: string;
    sourceType: 'SILO' | 'STORE' | 'NONE';
    sourceCode: string | null;
    demandMicrograms: number;
  }
  const dailyEntries: DailyEntry[] = [];
  const batchesByKeyDate = new Map<string, Set<string>>();
```

(d) Directly before `if (!isInRange(date)) continue; // walk-only date: contributes to the balance, not to the row` add:

```ts
      if (date >= rowFrom && date <= input.to) {
        dailyEntries.push({
          date, batchId: batch.batchId, batchNo: batch.batchNo, shedId: batch.shedId, heads: batch.heads,
          stageCode: segment.stageCode, feedRow, key: sk.key, sourceType: sk.sourceType, sourceCode: sk.sourceCode, demandMicrograms,
        });
        const shareKey = `${sk.key}|${date}`;
        let sharing = batchesByKeyDate.get(shareKey);
        if (!sharing) {
          sharing = new Set();
          batchesByKeyDate.set(shareKey, sharing);
        }
        sharing.add(batch.batchId);
      }

```

(e) Directly after the `sources.sort(…);` line add:

```ts

  const daily: DailyForecastRow[] = dailyEntries.map((e) => {
    const p = projectionByKey.get(e.key)!;
    const byDate = demandMicrogramsByKeyByDate.get(e.key) ?? new Map<string, number>();
    const opening = openingByKey.get(e.key)?.get(e.date) ?? 0;
    const containerDemand = byDate.get(e.date) ?? 0;
    // Q13: indicative when what this container feeds per day changes later in the window — a diet, rate or stage
    // change of any batch on it — because the days-of-stock division assumes today's rate holds.
    let indicative = false;
    for (const d of planDates) {
      if (d > e.date && (byDate.get(d) ?? 0) !== containerDemand) {
        indicative = true;
        break;
      }
    }
    const itemId = e.feedRow.itemId;
    return {
      date: e.date,
      batchId: e.batchId,
      batchNo: e.batchNo,
      shedCode: shedById.get(e.shedId)?.shedCode ?? '',
      stageCode: e.stageCode,
      itemId,
      itemNo: input.itemCodes?.[itemId] ?? '',
      itemName: input.items[itemId] ?? itemId,
      lifecycleId: e.feedRow.lifecycleId,
      sourceType: e.sourceType,
      sourceCode: e.sourceCode,
      currentInventoryKg: toKg(opening),
      heads: e.heads,
      feedRateKg: e.feedRow.kgPerHeadPerDay,
      perDayIntakeKg: toKg(toMicrograms(e.heads * e.feedRow.kgPerHeadPerDay)),
      wastagePct: e.feedRow.wastagePct,
      demandKg: toKg(e.demandMicrograms),
      daysOfStock: containerDemand > 0 ? Math.floor(opening / containerDemand) : null,
      sharedBatchCount: batchesByKeyDate.get(`${e.key}|${e.date}`)?.size ?? 1,
      indicative,
      runDownDate: p.runDownDate,
      refillDate: p.refillDate,
      requiredOn: p.requiredOn,
      overdue: p.overdue,
    };
  });
  daily.sort((a, b) => {
    if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
    if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0;
  });
```

and change the final `return` to `return { rows: entries.map((e) => e.row), flags, sources, dietChanges, daily };`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm nx test api -- feed-forecast feed-requisition feed-alert 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS.
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS. If a spec builds a `ForecastResult` literal and typecheck now asks for `daily`, add `daily: []` to that literal.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.daily.spec.ts
git commit -m "feat(feed-forecast): one row per batch, item and date (D16-D18)

The report had one row per batch and item for the whole range, with the
planning date's balance on it, so a week's view could not show the silo
emptying day by day and a diet change mid-week left the old diet's row
carrying the new diet's dates. The engine now emits a row per batch, item
and date from its existing daily walk: the projected balance that day,
intake without wastage (D17), days of stock for the whole silo with the
number of batches sharing it (D18), an indicative flag when the silo's
daily demand changes later in the window, and the item code.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Views and grouping (pure)

Workbook *Feed Forecast Engine* row 20: "View controls are daily, weekly, reporting period and custom From Date to To Date. Date grouping never changes underlying daily calculation." Step 6: "Group daily demand into week, reporting period or custom range. Current and next diet remain separate lines" — its example, "R1 3 days times 2,000 equals 6,000 KG; R2 4 days times 2,500 equals 10,000 KG", is this task's first test. Row 67: "Weekly uses selected week start date; reporting period uses configured dates … Custom uses From and To." Checkpoint 15's 45-day limit moves here with its message, and gains a Reporting Period wording (Review Focus 3).

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.spec.ts`

**Interfaces:**
- Consumes: `addDays`, `diffDays`, `DailyForecastRow` (engine, Task 3).
- Produces:

```ts
export const MAX_SPAN_DAYS = 45;
export const DEFAULT_SPAN_DAYS = 7;
export const FORECAST_VIEWS = ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];
export interface PeriodRange { periodId: string; periodCode: string; startDate: string; endDate: string; stockTakeDate: string; productionStartDate: string }
export function resolveViewRange(args: { view: ForecastView; planningDate: string; from?: string; to?: string; period?: PeriodRange | null }): { from: string; to: string };
export function spanProblem(from: string, to: string, period?: PeriodRange | null): string | null;
export interface ReportRow { key: string; batchId: string; batchNo: string; shedCode: string; stageCode: string; itemId: string; itemNo: string; itemName: string; sourceType: 'SILO' | 'STORE' | 'NONE'; sourceCode: string | null; date: string; dateTo: string; days: number; currentInventoryKg: number; heads: number; perDayIntakeKg: number; wastagePct: number; intakeKg: number; demandKg: number; daysOfStock: number | null; sharedBatchCount: number; indicative: boolean; runDownDate: string | null; refillDate: string | null; requiredOn: string | null; overdue: boolean }
export function bucketStart(view: ForecastView, from: string, date: string): string;
export function groupRows(daily: DailyForecastRow[], view: ForecastView, from: string): ReportRow[];
```

- [ ] **Step 1: Write the failing tests** — create `feed-forecast.view.spec.ts`:

```ts
import { FeedRow } from '../../production/lifecycle/feed-row-days';
import { buildFeedForecast, ForecastInput } from './feed-forecast.engine';
import { groupRows, MAX_SPAN_DAYS, resolveViewRange, spanProblem } from './feed-forecast.view';

const workedExample: ForecastInput = {
  planningDate: '2026-09-23', from: '2026-09-23', to: '2026-09-29', refillBufferDays: 2, leadTimeDays: 0,
  sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1', 's2'] }],
  silos: [
    { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500 },
    { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: 'r2', balanceKg: 1000 },
  ],
  store: null,
  items: { r1: 'Weaner Diet R1', r2: 'Weaner Diet R2' },
  itemCodes: { r1: 'FEED-R1', r2: 'FEED-R2' },
  batches: [{
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId: 'wean', stageCode: 'WEANER', start: '2026-08-30', end: null, projected: false }],
  }],
  feedRows: [
    { lifecycleId: 'row-r1', breedId: 'l', stageId: 'wean', itemId: 'r1', itemName: 'Weaner Diet R1', fromDay: 25, toDay: 27, kgPerHeadPerDay: 2.0, wastagePct: 0 },
    { lifecycleId: 'row-r2', breedId: 'l', stageId: 'wean', itemId: 'r2', itemName: 'Weaner Diet R2', fromDay: 28, toDay: 31, kgPerHeadPerDay: 2.5, wastagePct: 5 },
  ],
};
const { daily } = buildFeedForecast(workedExample);
const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 1e6) / 1e6;

describe('groupRows — Step 6 "Build dated forecast"', () => {
  it('WEEKLY: R1 3 days × 2,000 = 6,000 kg and R2 4 days × 2,500 = 10,000 kg, as two rows', () => {
    const rows = groupRows(daily, 'WEEKLY', '2026-09-23');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      itemNo: 'FEED-R1', date: '2026-09-23', dateTo: '2026-09-25', days: 3, intakeKg: 6000, demandKg: 6000,
      currentInventoryKg: 1500, perDayIntakeKg: 2000, heads: 1000, indicative: true,
    });
    // R2 carries 5 % wastage: intake 10,000 kg, 10,500 kg leaves the silo.
    expect(rows[1]).toMatchObject({ itemNo: 'FEED-R2', date: '2026-09-26', dateTo: '2026-09-29', days: 4, intakeKg: 10000, demandKg: 10500, wastagePct: 5 });
  });

  it('never changes the daily numbers: grouped totals equal the daily sums for every view', () => {
    for (const view of ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'] as const) {
      const rows = groupRows(daily, view, '2026-09-23');
      expect(sum(rows.map((r) => r.demandKg))).toBe(sum(daily.map((d) => d.demandKg)));
      expect(sum(rows.map((r) => r.intakeKg))).toBe(sum(daily.map((d) => d.perDayIntakeKg)));
    }
  });

  it('DAILY and CUSTOM keep one row per date', () => {
    expect(groupRows(daily, 'CUSTOM', '2026-09-23')).toHaveLength(7);
    expect(groupRows(daily, 'DAILY', '2026-09-23').every((r) => r.days === 1 && r.date === r.dateTo)).toBe(true);
  });

  it('WEEKLY cuts a longer range into 7-day buckets from the week start', () => {
    const row = (over: Partial<FeedRow> = {}): FeedRow => ({
      lifecycleId: 'a', breedId: 'l', stageId: 'grower', itemId: 'r1', itemName: 'Grower', fromDay: 1, toDay: 200, kgPerHeadPerDay: 1, wastagePct: 0, ...over,
    });
    const long: ForecastInput = {
      ...workedExample, to: '2026-10-06', silos: [{ siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 100000 }],
      sheds: [{ shedId: 'h3', shedCode: 'GRS/SHED-003', siloIds: ['s1'] }], feedRows: [row({ stageId: 'wean' })],
      batches: [{ ...workedExample.batches[0], heads: 100 }],
    };
    const rows = groupRows(buildFeedForecast(long).daily, 'WEEKLY', '2026-09-23');
    expect(rows.map((r) => `${r.date}..${r.dateTo} ${r.days}`)).toEqual(['2026-09-23..2026-09-29 7', '2026-09-30..2026-10-06 7']);
  });
});

describe('resolveViewRange and spanProblem', () => {
  const period = { periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' };

  it('DAILY is one date (the planning date unless one is chosen); WEEKLY is 7 days from the week start', () => {
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-23' });
    expect(resolveViewRange({ view: 'DAILY', planningDate: '2026-09-23', from: '2026-09-25' })).toEqual({ from: '2026-09-25', to: '2026-09-25' });
    expect(resolveViewRange({ view: 'WEEKLY', planningDate: '2026-09-23', from: '2026-09-27' })).toEqual({ from: '2026-09-27', to: '2026-10-03' });
  });

  it('PERIOD takes the Reporting Period Master dates; CUSTOM defaults to 7 days', () => {
    expect(resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period })).toEqual({ from: '2026-08-30', to: '2026-09-26' });
    expect(resolveViewRange({ view: 'CUSTOM', planningDate: '2026-09-23' })).toEqual({ from: '2026-09-23', to: '2026-09-30' });
    expect(() => resolveViewRange({ view: 'PERIOD', planningDate: '2026-09-23', period: null })).toThrow('A Reporting Period view needs a period.');
  });

  it('accepts exactly 45 days after from and refuses 46, naming a reporting period when it is one (checkpoint 15)', () => {
    expect(MAX_SPAN_DAYS).toBe(45);
    expect(spanProblem('2026-09-25', '2026-11-09')).toBeNull();
    expect(spanProblem('2026-09-25', '2026-11-10')).toBe('The forecast covers at most 45 days after from.');
    expect(spanProblem('2026-09-25', '2026-09-24')).toBe('to must not be before from.');
    expect(spanProblem('2026-08-01', '2026-09-19', { ...period, periodCode: '2026-X', startDate: '2026-08-01', endDate: '2026-09-19' }))
      .toBe('Reporting period 2026-X runs 50 days (2026-08-01 to 2026-09-19); the forecast covers at most 46.');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-forecast.view 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: FAIL — cannot find module `./feed-forecast.view`.

- [ ] **Step 3: Implement** `feed-forecast.view.ts`:

```ts
/**
 * Feed Forecast report views (spec D16; workbook Feed Forecast Engine row 20,
 * Step 6 and row 67). A view is only a date range and a way of grouping the
 * engine's per-date rows for display: "Date grouping never changes underlying
 * daily calculation", so nothing here recomputes a balance or a demand — it
 * adds up what the engine already worked out day by day. "Current and next
 * diet remain separate lines": a group is one batch, one item and one source,
 * so a diet change is always a new line. Pure — no database, no Nest.
 */
import { addDays, diffDays, type DailyForecastRow } from './feed-forecast.engine';

/** Workbook checkpoint 15: the forecast looks at most 45 days past `from` ("for example 45 days"). */
export const MAX_SPAN_DAYS = 45;
export const DEFAULT_SPAN_DAYS = 7;

/** Open question Q12: Daily = one date, Weekly = 7 days grouped, Reporting Period = the period grouped, Custom = per date. */
export const FORECAST_VIEWS = ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];

/** A Reporting Period Master row as the forecast uses it (D20). */
export interface PeriodRange {
  periodId: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  stockTakeDate: string;
  productionStartDate: string;
}

export function resolveViewRange(args: {
  view: ForecastView;
  planningDate: string;
  from?: string;
  to?: string;
  period?: PeriodRange | null;
}): { from: string; to: string } {
  const start = args.from ?? args.planningDate;
  switch (args.view) {
    case 'DAILY':
      return { from: start, to: start };
    case 'WEEKLY':
      // Row 67: "Weekly uses selected week start date" — any weekday; which one is a scheduler setting, not ours.
      return { from: start, to: addDays(start, 6) };
    case 'PERIOD':
      // Field spec: "When 'Reporting Period' is chosen, From/To are pulled from the Reporting Period Master … not typed".
      if (!args.period) throw new Error('A Reporting Period view needs a period.');
      return { from: args.period.startDate, to: args.period.endDate };
    default:
      return { from: start, to: args.to ?? addDays(start, DEFAULT_SPAN_DAYS) };
  }
}

/** Why a range cannot be forecast, or null. A reporting period is named, since its dates were not typed by the user. */
export function spanProblem(from: string, to: string, period?: PeriodRange | null): string | null {
  if (to < from) return 'to must not be before from.';
  const span = diffDays(from, to);
  if (span <= MAX_SPAN_DAYS) return null;
  return period
    ? `Reporting period ${period.periodCode} runs ${span + 1} days (${period.startDate} to ${period.endDate}); the forecast covers at most ${MAX_SPAN_DAYS + 1}.`
    : `The forecast covers at most ${MAX_SPAN_DAYS} days after from.`;
}

/** One line of the report grid: a single date (Daily, Custom) or a batch + item's days in a week or period. */
export interface ReportRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: 'SILO' | 'STORE' | 'NONE';
  sourceCode: string | null;
  date: string; // first date of the line (field spec: "the period start date when grouped")
  dateTo: string; // last date of the line
  days: number;
  currentInventoryKg: number; // as of `date`
  heads: number; // as of `date`
  perDayIntakeKg: number; // as of `date`, no wastage (D17)
  wastagePct: number;
  intakeKg: number; // sum of per-day intake over the line
  demandKg: number; // sum of demand incl. wastage over the line
  daysOfStock: number | null; // as of `date` (D18)
  sharedBatchCount: number; // the most batches sharing the container on any day of the line
  indicative: boolean; // any day of the line
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}

/** The first date of the group `date` belongs to. */
export function bucketStart(view: ForecastView, from: string, date: string): string {
  if (view === 'WEEKLY') return addDays(from, 7 * Math.floor(diffDays(from, date) / 7));
  if (view === 'PERIOD') return from;
  return date;
}

export function groupRows(daily: DailyForecastRow[], view: ForecastView, from: string): ReportRow[] {
  const byDate = [...daily].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // Sums in integer micrograms, like the engine, so 7 × 17.9375 kg is exactly 125.5625 kg.
  const groups = new Map<string, { row: ReportRow; intake: number; demand: number }>();
  for (const d of byDate) {
    const key = `${d.batchId}|${d.itemId}|${d.sourceCode ?? 'NONE'}|${bucketStart(view, from, d.date)}`;
    const intake = Math.round(d.perDayIntakeKg * 1e6);
    const demand = Math.round(d.demandKg * 1e6);
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        intake,
        demand,
        row: {
          key, batchId: d.batchId, batchNo: d.batchNo, shedCode: d.shedCode, stageCode: d.stageCode,
          itemId: d.itemId, itemNo: d.itemNo, itemName: d.itemName, sourceType: d.sourceType, sourceCode: d.sourceCode,
          date: d.date, dateTo: d.date, days: 1,
          currentInventoryKg: d.currentInventoryKg, heads: d.heads, perDayIntakeKg: d.perDayIntakeKg, wastagePct: d.wastagePct,
          intakeKg: d.perDayIntakeKg, demandKg: d.demandKg,
          daysOfStock: d.daysOfStock, sharedBatchCount: d.sharedBatchCount, indicative: d.indicative,
          runDownDate: d.runDownDate, refillDate: d.refillDate, requiredOn: d.requiredOn, overdue: d.overdue,
        },
      });
      continue;
    }
    group.intake += intake;
    group.demand += demand;
    group.row.dateTo = d.date;
    group.row.days += 1;
    group.row.intakeKg = group.intake / 1e6;
    group.row.demandKg = group.demand / 1e6;
    group.row.indicative = group.row.indicative || d.indicative;
    group.row.sharedBatchCount = Math.max(group.row.sharedBatchCount, d.sharedBatchCount);
  }
  return [...groups.values()]
    .map((g) => g.row)
    .sort((a, b) => {
      if (a.shedCode !== b.shedCode) return a.shedCode < b.shedCode ? -1 : 1;
      if (a.batchNo !== b.batchNo) return a.batchNo < b.batchNo ? -1 : 1;
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.itemName < b.itemName ? -1 : a.itemName > b.itemName ? 1 : 0;
    });
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm nx test api -- feed-forecast.view 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS. Typecheck `api,web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.spec.ts
git commit -m "feat(feed-forecast): daily, weekly, reporting-period and custom views

The workbook asks for four views over one daily calculation ('Date
grouping never changes underlying daily calculation') and pins the weekly
example: R1 3 days x 2,000 = 6,000 kg, R2 4 days x 2,500 = 10,000 kg, as
two lines. The views are a pure range-and-grouping layer over the engine's
per-date rows; the 45-day limit moves with them and names a reporting
period that is too long.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Reporting Period Master (API, generate-a-year, web master)

D20: "Built now (pulled forward from Plan D, master only): Period Code, Start Date, End Date (month-end Saturday), Stock Take Date, Production Start Date (Sunday after), business year July–June, entered in NAVFarm (BC import later)." Workbook *Master Setup* row 10 lists the same five fields; *Silo Balance and Stock Take* row 37: "Stock Take Date — Auto = Period End Date"; row 49: "Production Start Date Next Period — Sunday after month-end Saturday"; checkpoint 40: "Reporting periods July to June year. Must be defined in NAVFarm or imported from D365BC". No client period list exists, so nothing is seeded: an admin generates a year from the rule and edits it (Q9); End Date must be a Saturday (Q10). Stock take and period close stay in Plan D.

**Files:**
- Create: `apps/api/src/drizzle/tenant/0121_reporting_period.sql`; modify `meta/_journal.json` (idx 121)
- Modify: `apps/api/src/core/database/schema.ts` (new `reportingPeriod` table, after `alertRule`)
- Create: `apps/api/src/modules/master-data/reporting-period/reporting-period.rules.ts`, `reporting-period.dto.ts`, `reporting-period.service.ts`, `reporting-period.controller.ts`, `reporting-period.module.ts`
- Test: `apps/api/src/modules/master-data/reporting-period/reporting-period.rules.spec.ts`, `reporting-period.service.spec.ts`
- Modify: `apps/api/src/app.module.ts` (register `ReportingPeriodModule` after `AlertRuleModule`)
- Modify: `apps/api/src/common/master-data-scope.ts` (`MASTER_TABLES`: `'reporting-period': schema.reportingPeriod`)
- Modify: `apps/api/src/common/farm-scope-coverage.spec.ts` (EXEMPT entry)
- Modify: `apps/web/src/components/console/console-tabs/roles-tab.tsx`, `apps/web/src/utils/translations.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts` (new `reportingPeriod` config, registered after `alertRule`), `apps/web/specs/master-data-singular-label.spec.ts`

**Interfaces:**
- Produces: `schema.reportingPeriod` (columns in the migration below).
- From `reporting-period.rules.ts`:

```ts
export function isCalendarDay(iso: string): boolean;
export function weekdayOf(iso: string): number; // 0 = Sunday … 6 = Saturday
export function lastSaturdayOfMonth(year: number, month: number): string; // month 1–12
export function businessYearOf(date: string): string; // '2026-27' for July 2026 … June 2027
export interface PeriodDraft { period_code: string; business_year: string; start_date: string; end_date: string; stock_take_date: string; production_start_date: string }
export function generateBusinessYear(startYear: number): PeriodDraft[]; // July startYear … June startYear+1
export function periodProblems(p: { period_code: string; start_date: string; end_date: string; stock_take_date: string }): string[];
export function periodsOverlap(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }): boolean;
```
- REST `/reporting-period`: `GET` (query `companyId`, `isActive`, `businessYear`, `limit`, `offset`, `sort`, `dir`, `filter`), `GET /:id`, `POST`, `POST /generate` (`{ business_year_start: number, company_id?: string }` → `{ created: string[]; skipped: { period_code: string; reason: string }[] }`), `PUT /:id`, `DELETE /:id` (deactivate), `PATCH /:id/restore`, guarded by `('MASTER_DATA', 'REPORTING_PERIOD', view|create|edit|delete)`.

- [ ] **Step 1: Write the failing tests**

`reporting-period.rules.spec.ts`:

```ts
import { businessYearOf, generateBusinessYear, lastSaturdayOfMonth, periodProblems, periodsOverlap, weekdayOf } from './reporting-period.rules';

describe('Reporting Period rules (D20)', () => {
  it('finds the month-end Saturday', () => {
    expect(lastSaturdayOfMonth(2026, 9)).toBe('2026-09-26');
    expect(lastSaturdayOfMonth(2026, 6)).toBe('2026-06-27');
    expect(lastSaturdayOfMonth(2026, 10)).toBe('2026-10-31'); // the last day itself is a Saturday
    expect(lastSaturdayOfMonth(2027, 1)).toBe('2027-01-30');
    expect(weekdayOf('2026-09-26')).toBe(6);
  });

  it('names the July–June business year', () => {
    expect(businessYearOf('2026-07-25')).toBe('2026-27');
    expect(businessYearOf('2027-06-26')).toBe('2026-27');
    expect(businessYearOf('2026-06-27')).toBe('2025-26');
  });

  it('generates twelve contiguous periods, July to June, each ending on its month-end Saturday (Q9)', () => {
    const year = generateBusinessYear(2026);
    expect(year).toHaveLength(12);
    expect(year[0]).toEqual({
      period_code: '2026-07', business_year: '2026-27', start_date: '2026-06-28', end_date: '2026-07-25',
      stock_take_date: '2026-07-25', production_start_date: '2026-07-26',
    });
    // September 2026: the workbook's stock-take day (26 Sep) and production start (27 Sep); its illustrative start
    // (23 Aug) does not follow the month-end-Saturday rule for August, which gives 30 Aug.
    expect(year[2]).toEqual({
      period_code: '2026-09', business_year: '2026-27', start_date: '2026-08-30', end_date: '2026-09-26',
      stock_take_date: '2026-09-26', production_start_date: '2026-09-27',
    });
    expect(year[11]).toMatchObject({ period_code: '2027-06', end_date: '2027-06-26' });
    for (let i = 1; i < 12; i++) {
      const [y, m, d] = year[i - 1].end_date.split('-').map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
      expect(year[i].start_date).toBe(next);
      expect(weekdayOf(year[i].end_date)).toBe(6);
    }
  });

  it('checks a period by hand (Q10)', () => {
    const ok = { period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', stock_take_date: '2026-09-26' };
    expect(periodProblems(ok)).toEqual([]);
    expect(periodProblems({ ...ok, end_date: '2026-09-25' })).toContain('End Date must be a Saturday (the month-end stock-take Saturday).');
    expect(periodProblems({ ...ok, start_date: '2026-09-27' })).toContain('End Date must be on or after Start Date.');
    expect(periodProblems({ ...ok, stock_take_date: '2026-09-27' })).toContain('Stock Take Date must fall within the period.');
    expect(periodProblems({ ...ok, start_date: '2026-02-31' })).toContain('Start Date must be a calendar date (YYYY-MM-DD).');
    expect(periodProblems({ ...ok, period_code: 'sep 2026' })).toContain('Period Code may use letters, digits and hyphens only, up to 20.');
  });

  it('knows when two periods overlap', () => {
    expect(periodsOverlap({ start_date: '2026-08-30', end_date: '2026-09-26' }, { start_date: '2026-09-26', end_date: '2026-10-31' })).toBe(true);
    expect(periodsOverlap({ start_date: '2026-08-30', end_date: '2026-09-26' }, { start_date: '2026-09-27', end_date: '2026-10-31' })).toBe(false);
  });
});
```

`reporting-period.service.spec.ts`:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { ReportingPeriodService } from './reporting-period.service';

describe('ReportingPeriodService', () => {
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, where: () => self, orderBy: () => self, offset: () => self, limit: async () => rows,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const values = jest.fn(async () => undefined);
  const db = { select: jest.fn(() => chain(selectQueue.shift() ?? [])), insert: jest.fn(() => ({ values })) };
  const service = new ReportingPeriodService(transactionCls(db), { log: jest.fn() } as any);
  const september = { company_id: 'co-1', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26' };

  beforeEach(() => {
    selectQueue.length = 0;
    values.mockClear();
    db.select.mockClear();
    db.insert.mockClear();
  });

  it('refuses an End Date that is not a Saturday before reading anything', async () => {
    await expect(service.create({ ...september, end_date: '2026-09-25' }, 'tenant-1', { userId: 'u' })).rejects.toThrow(BadRequestException);
    expect(db.select).not.toHaveBeenCalled();
  });

  it('refuses a period that overlaps an active one of the same company', async () => {
    selectQueue.push([{ period_id: 'p8', period_code: '2026-08', start_date: '2026-07-26', end_date: '2026-08-30', is_active: true }]);
    await expect(service.create(september, 'tenant-1', { userId: 'u' })).rejects.toThrow(
      new ConflictException('2026-09 (2026-08-30 to 2026-09-26) overlaps 2026-08 (2026-07-26 to 2026-08-30).'),
    );
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses a code already used, even by an inactive period', async () => {
    selectQueue.push([{ period_id: 'old', period_code: '2026-09', start_date: '2025-08-31', end_date: '2025-09-27', is_active: false }]);
    await expect(service.create(september, 'tenant-1', { userId: 'u' })).rejects.toThrow(
      new ConflictException('Reporting period 2026-09 already exists for this company.'),
    );
  });

  it('derives Stock Take (= End), Production Start (End + 1) and the business year', async () => {
    selectQueue.push([], [{ period_id: 'new', ...september }]);
    await service.create(september, 'tenant-1', { userId: 'u' });
    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'co-1', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26',
      stock_take_date: '2026-09-26', production_start_date: '2026-09-27', business_year: '2026-27',
    }));
  });

  it('generates a year and skips the codes that exist (Q9)', async () => {
    selectQueue.push([{ period_id: 'p9', period_code: '2026-09', start_date: '2026-08-30', end_date: '2026-09-26', is_active: true }]);
    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });
    expect(out.created).toHaveLength(11);
    expect(out.skipped).toEqual([{ period_code: '2026-09', reason: 'already exists' }]);
    const rows = (values.mock.calls[0] as unknown[])[0] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ company_id: 'co-1', period_code: '2026-07', start_date: '2026-06-28', end_date: '2026-07-25' });
  });

  it('generate skips a period that would overlap one the admin edited by hand', async () => {
    selectQueue.push([{ period_id: 'p-custom', period_code: 'SEP-26', start_date: '2026-08-23', end_date: '2026-09-26', is_active: true }]);
    const out = await service.generate({ company_id: 'co-1', business_year_start: 2026 }, 'tenant-1', { userId: 'u' });
    expect(out.skipped).toEqual(expect.arrayContaining([
      { period_code: '2026-08', reason: 'overlaps SEP-26' },
      { period_code: '2026-09', reason: 'overlaps SEP-26' },
    ]));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- reporting-period 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|Cannot find"`
Expected: FAIL — cannot find module `./reporting-period.rules` / `./reporting-period.service`.

- [ ] **Step 3: Migration** `apps/api/src/drizzle/tenant/0121_reporting_period.sql`:

```sql
-- Reporting Period Master (spec D20; workbook Master Setup row 10: "Period
-- Code, Start Date, End Date (month-end Saturday), Stock Take Date,
-- Production Start Date (Sunday after month-end)"; checkpoint 40: July-June
-- business year, defined in NAVFarm or imported from D365BC). Built now for
-- the Feed Forecast's Reporting Period view; Plan D's stock take and period
-- close will read the same rows. business_year and production_start_date are
-- derived on save (production start = end + 1) and stored so the stock-take
-- screens can filter on them. Nothing is seeded — the client's calendar is
-- not given (open question Q9); an admin generates a year and edits it.
CREATE TABLE `reporting_period` (
  `period_id` varchar(36) NOT NULL,
  `tenant_id` varchar(36) NOT NULL,
  `company_id` varchar(36),
  `period_code` varchar(20) NOT NULL,
  `business_year` varchar(7) NOT NULL,
  `start_date` date NOT NULL,
  `end_date` date NOT NULL,
  `stock_take_date` date NOT NULL,
  `production_start_date` date NOT NULL,
  `is_active` boolean NOT NULL DEFAULT true,
  `status` varchar(20) NOT NULL DEFAULT 'ACTIVE',
  `created_by` varchar(36),
  `updated_by` varchar(36),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()),
  `deleted_at` timestamp NULL,
  CONSTRAINT `reporting_period_period_id` PRIMARY KEY(`period_id`),
  CONSTRAINT `uq_reporting_period_code` UNIQUE(`tenant_id`,`company_id`,`period_code`)
);
--> statement-breakpoint
ALTER TABLE `reporting_period` ADD CONSTRAINT `reporting_period_company_fk` FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`) ON DELETE cascade;
--> statement-breakpoint
CREATE INDEX `idx_reporting_period_dates` ON `reporting_period` (`tenant_id`,`company_id`,`start_date`);
```

Journal entry:

```json
    {
      "idx": 121,
      "version": "5",
      "when": 1791135600000,
      "tag": "0121_reporting_period",
      "breakpoints": true
    }
```

`schema.ts`, after `alertRule`:

```ts
/** Reporting Period Master (spec D20, migration 0121). One row per company and period; business_year and production_start_date are derived on save. */
export const reportingPeriod = mysqlTable('reporting_period', {
  period_id: varchar('period_id', { length: 36 }).primaryKey().$defaultFn(() => randomUUID()),
  tenant_id: varchar('tenant_id', { length: 36 }).notNull(),
  company_id: varchar('company_id', { length: 36 }).references(() => companyMaster.company_id, { onDelete: 'cascade' }),
  period_code: varchar('period_code', { length: 20 }).notNull(),
  business_year: varchar('business_year', { length: 7 }).notNull(),
  start_date: date('start_date', { mode: 'string' }).notNull(),
  end_date: date('end_date', { mode: 'string' }).notNull(),
  stock_take_date: date('stock_take_date', { mode: 'string' }).notNull(),
  production_start_date: date('production_start_date', { mode: 'string' }).notNull(),
  is_active: boolean('is_active').default(true).notNull(),
  status: varchar('status', { length: 20 }).default('ACTIVE').notNull(),
  created_by: varchar('created_by', { length: 36 }),
  updated_by: varchar('updated_by', { length: 36 }),
  created_at: timestamp('created_at', { mode: 'string' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { mode: 'string' }).defaultNow().notNull(),
  deleted_at: timestamp('deleted_at', { mode: 'string' }),
}, (table) => ({
  uqCode: uniqueIndex('uq_reporting_period_code').on(table.tenant_id, table.company_id, table.period_code),
  idxDates: index('idx_reporting_period_dates').on(table.tenant_id, table.company_id, table.start_date),
}));
```

- [ ] **Step 4: Rules** `reporting-period.rules.ts`:

```ts
/**
 * Reporting Period Master rules — pure (spec D20). A period runs from the day
 * after the previous period's end to its month-end Saturday (workbook Master
 * Setup row 10, Silo Balance and Stock Take row 37 "Stock Take Date — Auto =
 * Period End Date", row 49 "Sunday after month-end Saturday"); the business
 * year runs July to June (checkpoint 40). generateBusinessYear is our rule for
 * a first draft of the client's calendar (open question Q9) — every row it
 * makes can be edited. Calendar arithmetic is the forecast engine's (L12).
 */
import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9-]{1,20}$/;

/** YYYY-MM-DD and a real day (Date.UTC would roll 2026-02-31 over to 3 March). */
export function isCalendarDay(iso: string): boolean {
  if (!ISO_DAY.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function lastSaturdayOfMonth(year: number, month: number): string {
  const last = new Date(Date.UTC(year, month, 0)); // day 0 of the next month = the last day of this one
  const lastIso = `${year}-${String(month).padStart(2, '0')}-${String(last.getUTCDate()).padStart(2, '0')}`;
  return addDays(lastIso, -((last.getUTCDay() + 1) % 7)); // Saturday → 0 days back, Sunday → 1, Friday → 6
}

/** "2026-27" for any date from July 2026 to June 2027 (checkpoint 40). */
export function businessYearOf(date: string): string {
  const year = Number(date.slice(0, 4));
  const start = Number(date.slice(5, 7)) >= 7 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export interface PeriodDraft {
  period_code: string;
  business_year: string;
  start_date: string;
  end_date: string;
  stock_take_date: string;
  production_start_date: string;
}

/** Our first draft of a July–June year (Q9): code YYYY-MM (the workbook's example "2026-09"), end = month-end Saturday. */
export function generateBusinessYear(startYear: number): PeriodDraft[] {
  const periods: PeriodDraft[] = [];
  let previousEnd = lastSaturdayOfMonth(startYear, 6);
  for (let i = 0; i < 12; i++) {
    const month = ((6 + i) % 12) + 1; // 7, 8, … 12, 1, … 6
    const year = month >= 7 ? startYear : startYear + 1;
    const end = lastSaturdayOfMonth(year, month);
    periods.push({
      period_code: `${year}-${String(month).padStart(2, '0')}`,
      business_year: businessYearOf(end),
      start_date: addDays(previousEnd, 1),
      end_date: end,
      stock_take_date: end,
      production_start_date: addDays(end, 1),
    });
    previousEnd = end;
  }
  return periods;
}

export function periodProblems(p: { period_code: string; start_date: string; end_date: string; stock_take_date: string }): string[] {
  const problems: string[] = [];
  if (!CODE.test(p.period_code)) problems.push('Period Code may use letters, digits and hyphens only, up to 20.');
  const days: Array<[string, string]> = [['Start Date', p.start_date], ['End Date', p.end_date], ['Stock Take Date', p.stock_take_date]];
  const bad = days.filter(([, value]) => !isCalendarDay(value));
  for (const [label] of bad) problems.push(`${label} must be a calendar date (YYYY-MM-DD).`);
  if (bad.length) return problems;
  if (p.end_date < p.start_date) problems.push('End Date must be on or after Start Date.');
  // Q10: D20 "End Date (month-end Saturday)".
  if (weekdayOf(p.end_date) !== 6) problems.push('End Date must be a Saturday (the month-end stock-take Saturday).');
  if (p.stock_take_date < p.start_date || p.stock_take_date > p.end_date) problems.push('Stock Take Date must fall within the period.');
  return problems;
}

export function periodsOverlap(a: { start_date: string; end_date: string }, b: { start_date: string; end_date: string }): boolean {
  return a.start_date <= b.end_date && b.start_date <= a.end_date;
}
```

- [ ] **Step 5: DTO** `reporting-period.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsInt, IsOptional, IsString, IsUUID, Matches, Max, Min } from 'class-validator';
import { MasterListQueryDto } from '../../../common/master-list-query';

/** The master form sends a cleared date as ''. */
const blankToNull = ({ value }: { value: unknown }) => (value === '' ? null : value);

export class CreateReportingPeriodDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'e.g. 2026-09' }) @IsString() @Matches(/^[A-Za-z0-9-]{1,20}$/) period_code: string;
  @ApiProperty() @IsDateString() start_date: string;
  @ApiProperty({ description: 'The month-end Saturday' }) @IsDateString() end_date: string;
  @ApiPropertyOptional({ description: 'Blank = End Date' }) @IsOptional() @Transform(blankToNull) @IsDateString() stock_take_date?: string | null;
}

export class UpdateReportingPeriodDto extends PartialType(CreateReportingPeriodDto) {}

export class QueryReportingPeriodDto extends MasterListQueryDto {
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsString() businessYear?: string;
  @IsOptional() @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value)) @IsBoolean() isActive?: boolean;
}

export class GenerateReportingPeriodsDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() company_id?: string;
  @ApiProperty({ description: 'The calendar year the July–June business year starts in, e.g. 2026 for 2026-27' })
  @Type(() => Number) @IsInt() @Min(2000) @Max(2100) business_year_start: number;
}
```

- [ ] **Step 6: Service** `reporting-period.service.ts`:

```ts
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { companyCondition, masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';
import { businessYearOf, generateBusinessYear, periodProblems, periodsOverlap } from './reporting-period.rules';
import { CreateReportingPeriodDto, GenerateReportingPeriodsDto, QueryReportingPeriodDto, UpdateReportingPeriodDto } from './reporting-period.dto';

const table = schema.reportingPeriod;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
type Row = typeof table.$inferSelect;
type Shaped = { period_code: string; start_date: string; end_date: string; stock_take_date: string; production_start_date: string; business_year: string };

/**
 * Reporting Period Master CRUD (spec D20), scoped like every other master
 * (master-data-scope.ts). A period is never deleted — Plan D's stock takes
 * will point at it — only deactivated. Active periods of one company may not
 * overlap: the forecast picks "the period covering the planning date", and
 * two would make that ambiguous.
 */
@Injectable()
export class ReportingPeriodService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private companyOf(requested?: string | null): string | null {
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    return scope?.kind ? scope.companyId : requested ?? null;
  }

  async findOne(id: string, tenantId: string): Promise<Row> {
    const [row] = await this.db.select().from(table)
      .where(and(eq(table.period_id, id), eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)))
      .limit(1);
    if (!row) throw new NotFoundException('Reporting period is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryReportingPeriodDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), isNull(table.deleted_at), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.businessYear) conditions.push(eq(table.business_year, query.businessYear));
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions))
      .orderBy(listOrderBy(table, { ...query, sort: query.sort ?? 'start_date' }, table.start_date))
      .limit(query.limit || 50).offset(query.offset || 0);
  }

  /** Every period of the company (active or not) — codes are unique across all of them, overlaps only matter among active ones. */
  private async companyRows(companyId: string | null, tenantId: string): Promise<Row[]> {
    return this.db.select().from(table)
      .where(and(eq(table.tenant_id, tenantId), companyCondition(table.company_id, companyId), isNull(table.deleted_at)));
  }

  private shape(p: { period_code: string; start_date: string; end_date: string; stock_take_date?: string | null }): Shaped {
    const period_code = p.period_code.trim().toUpperCase();
    const stock_take_date = p.stock_take_date || p.end_date; // Silo Balance and Stock Take row 37: "Auto = Period End Date"
    const problems = periodProblems({ period_code, start_date: p.start_date, end_date: p.end_date, stock_take_date });
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return {
      period_code, start_date: p.start_date, end_date: p.end_date, stock_take_date,
      production_start_date: addDays(p.end_date, 1), // row 49: the Sunday after the month-end Saturday
      business_year: businessYearOf(p.end_date),
    };
  }

  private assertFree(candidate: Shaped, rows: Row[], excludeId?: string) {
    const others = rows.filter((r) => r.period_id !== excludeId);
    if (others.some((r) => r.period_code === candidate.period_code)) {
      throw new ConflictException(`Reporting period ${candidate.period_code} already exists for this company.`);
    }
    const clash = others.find((r) => r.is_active && periodsOverlap(candidate, r));
    if (clash) {
      throw new ConflictException(
        `${candidate.period_code} (${candidate.start_date} to ${candidate.end_date}) overlaps ${clash.period_code} (${clash.start_date} to ${clash.end_date}).`,
      );
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'reporting_period', entityId: row.period_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateReportingPeriodDto, tenantId: string, user?: any) {
    const shaped = this.shape(dto);
    const companyId = this.companyOf(dto.company_id);
    this.assertFree(shaped, await this.companyRows(companyId, tenantId));
    const period_id = randomUUID();
    await this.db.insert(table).values({ period_id, tenant_id: tenantId, company_id: companyId, ...shaped, created_by: user?.userId, updated_by: user?.userId });
    return this.log('CREATE', await this.findOne(period_id, tenantId), user);
  }

  async update(id: string, dto: UpdateReportingPeriodDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.period_code !== undefined && dto.period_code.trim().toUpperCase() !== before.period_code) {
      throw new BadRequestException('Period codes cannot be renamed. Deactivate the period and create a new one.');
    }
    const shaped = this.shape({
      period_code: before.period_code,
      start_date: dto.start_date ?? before.start_date,
      end_date: dto.end_date ?? before.end_date,
      // A moved End Date moves a stock take that was on the old End Date with it, unless a new one is given.
      stock_take_date: dto.stock_take_date !== undefined ? dto.stock_take_date : before.stock_take_date === before.end_date ? null : before.stock_take_date,
    });
    if (before.is_active) this.assertFree(shaped, await this.companyRows(before.company_id, tenantId), id);
    await this.db.update(table).set({ ...shaped, updated_by: user?.userId, updated_at: nowTs() }).where(eq(table.period_id, id));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active && !before.is_active) this.assertFree(before as unknown as Shaped, await this.companyRows(before.company_id, tenantId), id);
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', updated_by: user?.userId, updated_at: nowTs() }).where(eq(table.period_id, id));
    return this.log(active ? 'RESTORE' : 'DEACTIVATE', await this.findOne(id, tenantId), user, before);
  }

  /** Open question Q9: an admin's first draft of a July–June year; codes that exist, or dates an active period already covers, are skipped. */
  async generate(dto: GenerateReportingPeriodsDto, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto.company_id);
    const existing = await this.companyRows(companyId, tenantId);
    const created: Shaped[] = [];
    const skipped: { period_code: string; reason: string }[] = [];
    for (const draft of generateBusinessYear(dto.business_year_start)) {
      if (existing.some((r) => r.period_code === draft.period_code)) {
        skipped.push({ period_code: draft.period_code, reason: 'already exists' });
        continue;
      }
      const clash = existing.find((r) => r.is_active && periodsOverlap(draft, r));
      if (clash) {
        skipped.push({ period_code: draft.period_code, reason: `overlaps ${clash.period_code}` });
        continue;
      }
      created.push(draft);
    }
    if (created.length) {
      await this.db.insert(table).values(created.map((p) => ({
        period_id: randomUUID(), tenant_id: tenantId, company_id: companyId, ...p, created_by: user?.userId, updated_by: user?.userId,
      })));
      await this.audit.log({
        tenantId, companyId: companyId || undefined, userId: user?.userId, action: 'GENERATE', entityName: 'reporting_period',
        entityId: created[0].period_code, newValues: { business_year_start: dto.business_year_start, created: created.map((p) => p.period_code) },
      });
    }
    return { created: created.map((p) => p.period_code), skipped };
  }
}
```

If `audit.log`'s parameter type requires `entityId` to be a UUID-like string or lacks `oldValues`, match its signature in `apps/api/src/modules/system/audit-log/audit-log.service.ts` (line ~56) exactly as `alert-rule.service.ts` does.

- [ ] **Step 7: Controller and module**

`reporting-period.controller.ts`:

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { RequirePermission } from '../../../common/decorators/require-permission.decorator';
import { ReportingPeriodService } from './reporting-period.service';
import { CreateReportingPeriodDto, GenerateReportingPeriodsDto, QueryReportingPeriodDto, UpdateReportingPeriodDto } from './reporting-period.dto';

// A company master (spec D20). Periods are company-wide, not a farm's — exempt from farm scope.
@ApiTags('Reporting Period Master') @ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reporting-period')
export class ReportingPeriodController {
  constructor(private readonly periods: ReportingPeriodService) {}
  @Get() @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'view')
  async list(@Query() query: QueryReportingPeriodDto, @Req() req: any) { return { data: await this.periods.findAll(query, req.user.tenantId) }; }
  @Get(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'view')
  async get(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.findOne(id, req.user.tenantId) }; }
  @Post('generate') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'create')
  async generate(@Body() dto: GenerateReportingPeriodsDto, @Req() req: any) { return { data: await this.periods.generate(dto, req.user.tenantId, req.user) }; }
  @Post() @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'create')
  async create(@Body() dto: CreateReportingPeriodDto, @Req() req: any) { return { data: await this.periods.create(dto, req.user.tenantId, req.user) }; }
  @Put(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'edit')
  async update(@Param('id') id: string, @Body() dto: UpdateReportingPeriodDto, @Req() req: any) { return { data: await this.periods.update(id, dto, req.user.tenantId, req.user) }; }
  @Delete(':id') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'delete')
  async deactivate(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.setActive(id, false, req.user.tenantId, req.user) }; }
  @Patch(':id/restore') @RequirePermission('MASTER_DATA', 'REPORTING_PERIOD', 'edit')
  async restore(@Param('id') id: string, @Req() req: any) { return { data: await this.periods.setActive(id, true, req.user.tenantId, req.user) }; }
}
```

`reporting-period.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ReportingPeriodController } from './reporting-period.controller';
import { ReportingPeriodService } from './reporting-period.service';

@Module({ controllers: [ReportingPeriodController], providers: [ReportingPeriodService], exports: [ReportingPeriodService] })
export class ReportingPeriodModule {}
```

Register `ReportingPeriodModule` in `app.module.ts` (import next to `AlertRuleModule`, and in `imports` right after `AlertRuleModule,`). In `master-data-scope.ts` `MASTER_TABLES`, after `'alert-rule': schema.alertRule,` add `'reporting-period': schema.reportingPeriod,`. In `farm-scope-coverage.spec.ts` `EXEMPT`, beside the other `master-data/…` entries:

```ts
  'master-data/reporting-period/reporting-period.controller.ts': 'Company master (Reporting Period Master, D20); periods are company-wide, not a farm\'s.',
```

- [ ] **Step 8: Web** — `roles-tab.tsx`, after the `ALERT_RULE` line:

```ts
  { module_code: "MASTER_DATA", resource: "REPORTING_PERIOD", name: "Reporting Periods", nameKey: "rolReportingPeriods" },
```

`translations.ts` `en`, after `rolAlertRules`: `rolReportingPeriods: "Reporting Periods",`.

`configs.ts`, after the `alertRule` config:

```ts
// Reporting Period Master — spec D20; workbook Master Setup row 10 in its
// order. Business Year and Production Start Date are derived by the API
// (Production Start = the Sunday after End), so they are table columns only
// and never form fields. A year is drafted with "Generate July–June periods"
// on Inventory → Feed Forecast (Reporting Period view) and edited here.
const reportingPeriod: MasterDataConfig = {
  key: "reporting-period", label: "Reporting Periods", singular: "Reporting Period", apiBase: "/reporting-period", idKey: "period_id",
  group: "Inventory", businessAdminOnly: true,
  description: "Reporting Period Master: each month's period up to its month-end Saturday stock take, in a July–June business year. The Feed Forecast's Reporting Period view takes its dates from here.",
  columns: [
    { key: "period_code", label: "Period Code" }, { key: "business_year", label: "Business Year" },
    { key: "start_date", label: "Start Date" }, { key: "end_date", label: "End Date" },
    { key: "stock_take_date", label: "Stock Take Date" }, { key: "production_start_date", label: "Production Start Date" },
  ],
  fields: [
    { key: "company_id", label: "Company", type: "text", hideInForm: true },
    { key: "period_code", label: "Period Code", type: "text", required: true, createOnly: true, maxLength: 20, helpText: "For example 2026-09 for the September 2026 period." },
    { key: "start_date", label: "Start Date", type: "date", required: true, helpText: "Normally the Sunday after the previous period's End Date." },
    { key: "end_date", label: "End Date", type: "date", required: true, helpText: "The month-end Saturday. Production Start Date is set to the Sunday after it." },
    { key: "stock_take_date", label: "Stock Take Date", type: "date", helpText: "Leave blank to use the End Date." },
  ],
};
```

Add `reportingPeriod` to `MASTER_DATA_CONFIGS` right after `alertRule`, and `"reporting-period": "Reporting Period",` to `EXPECTED` in `apps/web/specs/master-data-singular-label.spec.ts`.

- [ ] **Step 9: Run**

`pnpm nx test api -- reporting-period farm-scope-coverage 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS; `pnpm nx test web -- role-permissions-coverage master-data-singular-label` → PASS; `pnpm nx run-many -t typecheck -p api,web` → PASS; web lint error count unchanged.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/drizzle/tenant/0121_reporting_period.sql apps/api/src/drizzle/tenant/meta/_journal.json apps/api/src/core/database/schema.ts apps/api/src/modules/master-data/reporting-period apps/api/src/app.module.ts apps/api/src/common/master-data-scope.ts apps/api/src/common/farm-scope-coverage.spec.ts apps/web/src/components/console/console-tabs/roles-tab.tsx apps/web/src/utils/translations.ts apps/web/src/modules/master-data/configs.ts apps/web/specs/master-data-singular-label.spec.ts
git commit -m "feat(master-data): Reporting Period Master with a July-June year generator

D20 pulls the Reporting Period Master forward from Plan D so the Feed
Forecast's Reporting Period view can take its From/To from it (field
specification: 'pulled from the Reporting Period Master … not typed').
Period Code, Start, End (month-end Saturday, enforced), Stock Take Date
(defaults to End) and Production Start (the Sunday after, derived), with
the business year. No client calendar was given, so nothing is seeded; an
admin generates a year from the month-end-Saturday rule and edits it.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 6: Service — stock as of a date, confirmed incoming, low levels, planning date and horizon

Field spec, Current Inventory: "The System Balance of this feed item in the shed's silo as of the Planning Date"; Step 7: "opening ledger balance + confirmed incoming TO quantities − daily use". Until now the service read the *current* FIFO remaining quantity (`getStockBalance` via `SiloFeedService.currentItems`), which has no date. The ledger's signed quantities do: on nf_devco (26 Sep) the signed sum of POSITIVE and NEGATIVE entries equals the remaining-quantity sum for every silo and store. So the forecast now reads (Q6) everything posted **before** the stock date as the opening balance, and every posted movement from the stock date on that is **not feeding** (daily entry posts `document_type = 'BATCH'`; a goods issue posts `transaction_type = 'CONSUMPTION'`) as incoming, plus DRAFT stock transfers (Q2). `computeForFarm` takes an optional planning date (bounded to ±45 days of today, Q8) and run-down horizon (Q12), sets the stock date (the planning date, or today when planning ahead), and raises `AS_OF_PAST` for a past date.

**Files:**
- Modify: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts` (types + `getFeedStockAsOf`, after `getStockBalance`)
- Create: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.feed-stock.spec.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.ts`, `feed-forecast.stock.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (imports, constants, constructor, `FeedForecastResponse`, `computeForFarm`, `loadInput`, new `loadDraftTransfers`; delete `siloInput`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts` (drop `SiloFeedModule`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts`, `feed-forecast.service.farm.spec.ts`, `apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts` (constructor arity only)

**Interfaces:**
- Consumes: Task 1's `farmToday`/`FarmClock`; Task 2's `ForecastInput` (`stockDate`, `horizonTo`, `incoming`, `silos[].lowLevelKg`, `itemCodes`) and `AS_OF_PAST`; Task 3's `daily`; Task 4's `MAX_SPAN_DAYS`, `DEFAULT_SPAN_DAYS`, `spanProblem`.
- Produces:

```ts
// inventory-ledger.service.ts
export interface FeedStockRow { warehouse_id: string; item_id: string; item_code: string; uom: string; qty: number }
export interface FeedStockMovement extends FeedStockRow { posting_date: string }
InventoryLedgerService.getFeedStockAsOf(params: { companyId: string; warehouseIds: string[]; stockDate: string; horizonTo: string }, tenantId: string): Promise<{ opening: FeedStockRow[]; movements: FeedStockMovement[] }>
// feed-forecast.stock.ts
export function stockAsOf(args: {
  silos: { siloId: string; siloCode: string; lowLevelKg: number | null }[];
  store: { storeId: string; storeCode: string } | null;
  feedItemIds: Set<string>;
  opening: FeedStockRow[]; movements: FeedStockMovement[]; drafts: FeedStockMovement[];
}): { silos: ForecastInput['silos']; store: ForecastInput['store']; incoming: IncomingFeed[] }
// feed-forecast.service.ts
export { MAX_SPAN_DAYS }  // re-exported from feed-forecast.view (the requisition imports it from here)
export interface FeedForecastResponse {
  planningDate: string; today: string; timeZone: string | null; from: string; to: string; horizonTo: string;
  farm: { id: string; code: string; name: string }; refillBufferDays: number; leadTimeDays: number;
  rows: ForecastRow[]; daily: DailyForecastRow[]; flags: ForecastFlag[]; sources: ForecastSource[]; dietChanges: DietChange[];
}
computeForFarm(farmId, companyId, tenantId, range?: { from?: string; to?: string; planningDate?: string; horizonTo?: string }, clock?: FarmClock): Promise<FeedForecastResponse>
constructor(cls: ClsService, ledgerService: InventoryLedgerService)   // SiloFeedService is no longer read here
```

- [ ] **Step 1: Write the failing tests**

`inventory-ledger.feed-stock.spec.ts`:

```ts
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { InventoryLedgerService } from './inventory-ledger.service';

describe('InventoryLedgerService.getFeedStockAsOf (Plan R, D19 / Q6)', () => {
  const wheres: unknown[] = [];
  const results: unknown[][] = [];
  const chain = () => {
    const rows = results.shift() ?? [];
    const self: any = {
      from: () => self,
      where: (w: unknown) => { wheres.push(w); return self; },
      groupBy: () => self,
      then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej),
    };
    return self;
  };
  const db = { select: jest.fn(() => chain()) };
  const render = (w: unknown) => new MySqlDialect().sqlToQuery(w as any);

  beforeEach(() => {
    wheres.length = 0;
    results.length = 0;
    db.select.mockClear();
  });

  it('sums what was posted before the stock date, and reads non-feeding movements from it to the horizon', async () => {
    const cls = transactionCls(db);
    useFarmScope(cls, { farmId: 'farm-1', restricted: false, companyId: 'co-1', lobId: null });
    results.push(
      [
        { warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', qty: '1500.0000' },
        { warehouse_id: null, item_id: 'i9', item_code: 'X', uom: 'KG', qty: '5.0000' },
      ],
      [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-27', qty: '3000.0000' }],
    );
    const out = await new InventoryLedgerService(cls).getFeedStockAsOf(
      { companyId: 'co-1', warehouseIds: ['s1'], stockDate: '2026-09-26', horizonTo: '2026-11-10' }, 'tenant-1',
    );
    expect(out).toEqual({
      opening: [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 }],
      movements: [{ warehouse_id: 's1', item_id: 'i1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-27', qty: 3000 }],
    });
    const [opening, movements] = wheres.map(render);
    expect(opening.sql).toMatch(/`posting_date` < \?/);
    expect(opening.params).toEqual(expect.arrayContaining(['tenant-1', 'co-1', 's1', 'POSITIVE', 'NEGATIVE', '2026-09-26']));
    expect(movements.sql).toMatch(/`posting_date` >= \?/);
    expect(movements.sql).toMatch(/`document_type` <> \?/);
    expect(movements.sql).toMatch(/`transaction_type` <> \?/);
    expect(movements.params).toEqual(expect.arrayContaining(['2026-09-26', '2026-11-10', 'BATCH', 'CONSUMPTION']));
  });

  it('reads nothing for no locations', async () => {
    const out = await new InventoryLedgerService(transactionCls(db)).getFeedStockAsOf(
      { companyId: 'co-1', warehouseIds: [], stockDate: '2026-09-26', horizonTo: '2026-09-30' }, 'tenant-1',
    );
    expect(out).toEqual({ opening: [], movements: [] });
    expect(db.select).not.toHaveBeenCalled();
  });
});
```

`feed-forecast.stock.spec.ts`:

```ts
import { ConflictException } from '@nestjs/common';
import { stockAsOf } from './feed-forecast.stock';

const silos = [
  { siloId: 's1', siloCode: 'GRS/SILO-001', lowLevelKg: 1000 },
  { siloId: 's2', siloCode: 'GRS/SILO-002', lowLevelKg: null },
];
const base = { silos, store: { storeId: 'st', storeCode: 'GRS/STORE-001' }, feedItemIds: new Set(['r1', 'r2']), opening: [], movements: [], drafts: [] };

describe('stockAsOf — silo and store stock for the forecast (Q2, Q6)', () => {
  it('takes each silo\'s resident item and opening balance, and carries its low level', () => {
    const out = stockAsOf({
      ...base,
      opening: [
        { warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 },
        { warehouse_id: 's1', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', qty: 0 }, // emptied before the changeover
        { warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', qty: 800 },
        { warehouse_id: 'st', item_id: 'med', item_code: 'MED-1', uom: 'PCS', qty: 40 }, // not feed: ignored
      ],
    });
    expect(out.silos).toEqual([
      { siloId: 's1', siloCode: 'GRS/SILO-001', itemId: 'r1', balanceKg: 1500, lowLevelKg: 1000 },
      { siloId: 's2', siloCode: 'GRS/SILO-002', itemId: null, balanceKg: 0, lowLevelKg: null },
    ]);
    expect(out.store).toEqual({ storeId: 'st', storeCode: 'GRS/STORE-001', balances: { r2: 800 } });
    expect(out.incoming).toEqual([]);
  });

  it('an empty silo with a booked transfer holds that transfer\'s item from its date', () => {
    const out = stockAsOf({
      ...base,
      drafts: [{ warehouse_id: 's2', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-28', qty: 6000 }],
    });
    expect(out.silos[1]).toMatchObject({ itemId: 'r2', balanceKg: 0 });
    expect(out.incoming).toEqual([{ locationId: 's2', itemId: 'r2', date: '2026-09-28', kg: 6000 }]);
  });

  it('keeps posted movements and drafts, signed, and drops a silo movement of another item', () => {
    const out = stockAsOf({
      ...base,
      opening: [{ warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', qty: 1500 }],
      movements: [
        { warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-26', qty: 3000 },
        { warehouse_id: 's1', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-27', qty: 500 },
        { warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'KG', posting_date: '2026-09-27', qty: -200 },
      ],
      drafts: [{ warehouse_id: 'st', item_id: 'r1', item_code: 'FEED-R1', uom: 'KG', posting_date: '2026-09-29', qty: -1000 }],
    });
    expect(out.incoming).toEqual([
      { locationId: 's1', itemId: 'r1', date: '2026-09-26', kg: 3000 },
      { locationId: 'st', itemId: 'r2', date: '2026-09-27', kg: -200 },
      { locationId: 'st', itemId: 'r1', date: '2026-09-29', kg: -1000 },
    ]);
  });

  it('refuses feed held in anything but KG, naming the silo or the store item', () => {
    expect(() => stockAsOf({ ...base, opening: [{ warehouse_id: 's1', item_id: 'r1', item_code: 'FEED-R1', uom: 'BAG', qty: 10 }] }))
      .toThrow(new ConflictException("Silo 'GRS/SILO-001' holds its feed in BAG, not KG — the forecast cannot add bags to kilograms."));
    expect(() => stockAsOf({ ...base, opening: [{ warehouse_id: 'st', item_id: 'r2', item_code: 'FEED-R2', uom: 'BAG', qty: 10 }] }))
      .toThrow(new ConflictException("Store 'GRS/STORE-001' holds 'FEED-R2' in BAG, not KG — the forecast cannot add bags to kilograms."));
  });
});
```

Append to `feed-forecast.service.farm.spec.ts` (inside the top-level describe):

```ts
  describe('computeForFarm — planning date, stock date and horizon (D16, D19, Q8, Q12)', () => {
    function withToday(today: string) {
      const cls = transactionCls({});
      const service = new FeedForecastService(cls, {} as any);
      jest.spyOn(service, 'farmToday').mockResolvedValue({ today, timeZone: 'Africa/Harare' });
      jest.spyOn(service as any, 'loadFarm').mockResolvedValue(farm);
      const loadInput = jest.spyOn(service as any, 'loadInput').mockImplementation(async (...args: any[]) => ({
        input: { ...emptyInput, planningDate: args[1], from: args[2], to: args[3] }, flags: [],
      }));
      return { cls, service, loadInput };
    }

    it('a past planning date reads stock as of that date and says heads are today\'s', async () => {
      const { cls, service, loadInput } = withToday('2026-09-26');
      const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { planningDate: '2026-09-19' }));
      expect(loadInput.mock.calls[0][5]).toEqual({ stockDate: '2026-09-19', horizonTo: '2026-09-26' });
      expect(result.flags).toContainEqual({ kind: 'AS_OF_PAST', planningDate: '2026-09-19', today: '2026-09-26' });
    });

    it('a future planning date walks from today\'s stock and raises no as-of note', async () => {
      const { cls, service, loadInput } = withToday('2026-09-26');
      const result = await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { planningDate: '2026-10-01' }));
      expect(loadInput.mock.calls[0][5]).toEqual({ stockDate: '2026-09-26', horizonTo: '2026-10-08' });
      expect(result.flags.some((f) => f.kind === 'AS_OF_PAST')).toBe(false);
    });

    it('caps the run-down horizon at 45 days past the planning date, and never below `to`', async () => {
      const { cls, service, loadInput } = withToday('2026-09-26');
      await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { from: '2026-09-26', to: '2026-09-26', horizonTo: '2026-12-31' }));
      await cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { from: '2026-09-26', to: '2026-09-30', horizonTo: '2026-09-20' }));
      expect(loadInput.mock.calls.map((c) => (c[5] as { horizonTo: string }).horizonTo)).toEqual(['2026-11-10', '2026-09-30']);
    });

    it('refuses a planning date more than 45 days from today, before loading anything', async () => {
      const { cls, service, loadInput } = withToday('2026-09-26');
      await expect(cls.run(() => service.computeForFarm('farm-b', 'co-1', 'tenant-1', { planningDate: '2026-11-11' })))
        .rejects.toThrow('The planning date must be within 45 days of today (2026-09-26).');
      expect(loadInput).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- inventory-ledger.feed-stock feed-forecast.stock feed-forecast.service.farm 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|Cannot find"`
Expected: FAIL — `getFeedStockAsOf` is not a function, `./feed-forecast.stock` not found, `loadInput` gets no sixth argument.

- [ ] **Step 3: Ledger read** — in `inventory-ledger.service.ts` add `inArray, lt, ne` to the `drizzle-orm` import; above `@Injectable()` add:

```ts
/** A silo or store's signed stock of one item and unit, summed (Feed Forecast Plan R). */
export interface FeedStockRow {
  warehouse_id: string;
  item_id: string;
  item_code: string;
  uom: string;
  qty: number;
}

/** The same, for one posting date. */
export interface FeedStockMovement extends FeedStockRow {
  posting_date: string;
}
```

and after `getStockBalance`:

```ts
  /**
   * Feed Forecast (Plan R, spec D19, open question Q6): feed stock of the given
   * silos and stores *as of a date*. getStockBalance reads FIFO remaining
   * quantities, which have no date; the signed quantities do, and their sum is
   * the same number (checked on nf_devco, 26 Sep: every silo and store
   * agreed) — only POSITIVE and NEGATIVE entries move stock. `opening` is
   * everything posted before `stockDate`; `movements` is every posted
   * movement from `stockDate` to `horizonTo` that is not feeding — daily entry
   * posts its feed as document_type BATCH and a goods issue as transaction_type
   * CONSUMPTION — because feeding from the stock date on is exactly what the
   * forecast projects, and counting both would take it twice. Farm-scoped like
   * every read here.
   */
  async getFeedStockAsOf(
    params: { companyId: string; warehouseIds: string[]; stockDate: string; horizonTo: string },
    tenantId: string,
  ): Promise<{ opening: FeedStockRow[]; movements: FeedStockMovement[] }> {
    if (!params.warehouseIds.length) return { opening: [], movements: [] };
    const L = schema.inventoryLedger;
    const base = [
      eq(L.tenant_id, tenantId),
      eq(L.company_id, params.companyId),
      inArray(L.warehouse_id, params.warehouseIds),
      inArray(L.entry_type, ['POSITIVE', 'NEGATIVE']),
      ...this.farmConditions(),
    ];
    const qty = sql<string>`COALESCE(SUM(${L.quantity}), 0)`;
    const itemCode = sql<string>`MAX(${L.item_code})`;
    const opening = await this.db
      .select({ warehouse_id: L.warehouse_id, item_id: L.item_id, item_code: itemCode, uom: L.uom, qty })
      .from(L)
      .where(and(...base, lt(L.posting_date, params.stockDate)))
      .groupBy(L.warehouse_id, L.item_id, L.uom);
    const movements = await this.db
      .select({ warehouse_id: L.warehouse_id, item_id: L.item_id, item_code: itemCode, uom: L.uom, posting_date: L.posting_date, qty })
      .from(L)
      .where(and(
        ...base,
        gte(L.posting_date, params.stockDate),
        lte(L.posting_date, params.horizonTo),
        ne(L.document_type, 'BATCH'),
        ne(L.transaction_type, 'CONSUMPTION'),
      ))
      .groupBy(L.warehouse_id, L.item_id, L.uom, L.posting_date);
    return {
      opening: opening
        .filter((r) => r.warehouse_id)
        .map((r) => ({ warehouse_id: r.warehouse_id!, item_id: r.item_id, item_code: r.item_code, uom: r.uom, qty: Number(r.qty) })),
      movements: movements
        .filter((r) => r.warehouse_id)
        .map((r) => ({ warehouse_id: r.warehouse_id!, item_id: r.item_id, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: Number(r.qty) })),
    };
  }
```

- [ ] **Step 4: Pure stock shaping** — create `feed-forecast.stock.ts`:

```ts
/**
 * Silo and store stock for the forecast, shaped from ledger sums (Plan R,
 * spec D19; open questions Q2 and Q6). Pure — the service reads the rows
 * (InventoryLedgerService.getFeedStockAsOf for posted stock, its own query
 * for DRAFT transfers) and this decides what they mean:
 * - A silo holds one item (D8). Its item is the one with the largest positive
 *   opening balance; an empty silo takes the item of the first transfer or
 *   receipt booked into it, so the shed that will eat it finds its source.
 * - Incoming is every posted non-feeding movement and every DRAFT transfer
 *   from the stock date on, signed. A silo's movements of another item are
 *   dropped — it can only take a different item once empty (D8), and that is
 *   the changeover the requisition flags, not stock the forecast can use.
 * - Feed is counted in KG only. A silo holding anything in another unit, or a
 *   store holding a *feed* item in one, is refused, as Plan A did: adding bags
 *   to kilograms would move every date the report shows.
 */
import { ConflictException } from '@nestjs/common';
import type { FeedStockMovement, FeedStockRow } from '../inventory-ledger/inventory-ledger.service';
import type { ForecastInput, IncomingFeed } from './feed-forecast.engine';

const EPS = 0.0001;

export function stockAsOf(args: {
  silos: { siloId: string; siloCode: string; lowLevelKg: number | null }[];
  store: { storeId: string; storeCode: string } | null;
  feedItemIds: Set<string>;
  opening: FeedStockRow[];
  movements: FeedStockMovement[];
  drafts: FeedStockMovement[];
}): { silos: ForecastInput['silos']; store: ForecastInput['store']; incoming: IncomingFeed[] } {
  const siloCode = new Map(args.silos.map((s) => [s.siloId, s.siloCode]));
  const isStoreFeed = (r: FeedStockRow) => !!args.store && r.warehouse_id === args.store.storeId && args.feedItemIds.has(r.item_id);

  for (const r of [...args.opening, ...args.movements, ...args.drafts]) {
    if (r.uom === 'KG' || Math.abs(r.qty) < EPS) continue;
    if (siloCode.has(r.warehouse_id)) {
      throw new ConflictException(`Silo '${siloCode.get(r.warehouse_id)}' holds its feed in ${r.uom}, not KG — the forecast cannot add bags to kilograms.`);
    }
    if (isStoreFeed(r)) {
      throw new ConflictException(`Store '${args.store!.storeCode}' holds '${r.item_code}' in ${r.uom}, not KG — the forecast cannot add bags to kilograms.`);
    }
  }

  const openingKg = new Map<string, number>(); // `${location}|${item}`
  for (const r of args.opening) {
    if (r.uom !== 'KG') continue;
    const k = `${r.warehouse_id}|${r.item_id}`;
    openingKg.set(k, (openingKg.get(k) ?? 0) + r.qty);
  }
  const flows = [...args.movements, ...args.drafts]
    .filter((r) => r.uom === 'KG' && Math.abs(r.qty) >= EPS)
    .sort((a, b) => (a.posting_date < b.posting_date ? -1 : a.posting_date > b.posting_date ? 1 : 0));

  const silos = args.silos.map((s) => {
    const held = args.opening
      .filter((r) => r.warehouse_id === s.siloId && r.uom === 'KG')
      .map((r) => ({ itemId: r.item_id, kg: openingKg.get(`${s.siloId}|${r.item_id}`) ?? 0 }))
      .filter((h) => h.kg > EPS)
      .sort((a, b) => b.kg - a.kg);
    const firstIn = flows.find((f) => f.warehouse_id === s.siloId && f.qty > 0);
    const itemId = held[0]?.itemId ?? firstIn?.item_id ?? null;
    return { siloId: s.siloId, siloCode: s.siloCode, itemId, balanceKg: held[0]?.kg ?? 0, lowLevelKg: s.lowLevelKg };
  });
  const residentOf = new Map(silos.map((s) => [s.siloId, s.itemId]));

  let store: ForecastInput['store'] = null;
  if (args.store) {
    const balances: Record<string, number> = {};
    for (const [k, kg] of openingKg) {
      const [location, itemId] = k.split('|');
      if (location === args.store.storeId && args.feedItemIds.has(itemId) && kg > EPS) balances[itemId] = kg;
    }
    store = { storeId: args.store.storeId, storeCode: args.store.storeCode, balances };
  }

  const incoming: IncomingFeed[] = [];
  for (const f of flows) {
    if (siloCode.has(f.warehouse_id)) {
      if (f.item_id !== residentOf.get(f.warehouse_id)) continue;
    } else if (!isStoreFeed(f)) {
      continue;
    }
    incoming.push({ locationId: f.warehouse_id, itemId: f.item_id, date: f.posting_date, kg: f.qty });
  }
  return { silos, store, incoming };
}
```

- [ ] **Step 5: Service** — in `feed-forecast.service.ts`:

Imports: add `gte, lte` to the `drizzle-orm` import; replace the `InventoryLedgerService` import with `import { FeedStockMovement, InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';`; delete the `SiloFeedService` import; the engine import becomes `import { buildFeedForecast, DailyForecastRow, DietChange, ForecastFlag, ForecastInput, ForecastRow, ForecastSource, isTimeZone, todayInZone } from './feed-forecast.engine';`; add `import { DEFAULT_SPAN_DAYS, MAX_SPAN_DAYS, spanProblem } from './feed-forecast.view';` and `import { stockAsOf } from './feed-forecast.stock';`.

Replace the two constants

```ts
/** Workbook checkpoint 15: the forecast looks at most 45 days past `from`. */
export const MAX_SPAN_DAYS = 45;
const DEFAULT_SPAN_DAYS = 7;
```

with

```ts
// Checkpoint 15's limit lives with the views (feed-forecast.view.ts); re-exported for the requisition, which imports it from here.
export { MAX_SPAN_DAYS };
```

Replace `FeedForecastResponse` with the one in **Interfaces** above. Delete the exported `siloInput` function and its docblock (stockAsOf carries its rule). Change the constructor to:

```ts
  constructor(
    private readonly cls: ClsService,
    private readonly ledgerService: InventoryLedgerService,
  ) {}
```

Replace `computeForFarm` (docblock kept, with this paragraph appended to it: "Plan R: the planning date may be chosen (±45 days of the farm's today, Q8); stock is read as of the stock date — the planning date, or today when planning ahead, the days in between being walked (D19); the run-down may be looked for up to `horizonTo`, capped at 45 days past the planning date and never before `to` (Q12).") with:

```ts
  async computeForFarm(
    farmId: string,
    companyId: string,
    tenantId: string,
    range: { from?: string; to?: string; planningDate?: string; horizonTo?: string } = {},
    clock?: FarmClock,
  ): Promise<FeedForecastResponse> {
    const { today, timeZone } = clock ?? (await this.farmToday(companyId, tenantId));
    const planningDate = range.planningDate ?? today;
    if (!isCalendarDay(planningDate)) throw new BadRequestException('planningDate must be a calendar date (YYYY-MM-DD).');
    // Q8: heads and stages are always today's register, so an as-of date far from today would mislead.
    if (Math.abs(diffDays(today, planningDate)) > MAX_SPAN_DAYS) {
      throw new BadRequestException(`The planning date must be within ${MAX_SPAN_DAYS} days of today (${today}).`);
    }
    const from = range.from ?? planningDate;
    const to = range.to ?? addDays(from, DEFAULT_SPAN_DAYS);
    if (!isCalendarDay(from) || !isCalendarDay(to)) {
      throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    }
    const span = spanProblem(from, to);
    if (span) throw new BadRequestException(span);
    const cap = addDays(planningDate, MAX_SPAN_DAYS);
    const wanted = range.horizonTo && isCalendarDay(range.horizonTo) ? range.horizonTo : to;
    const capped = wanted < cap ? wanted : cap;
    const horizonTo = capped > to ? capped : to;
    const stockDate = planningDate < today ? planningDate : today;
    return this.withFarmScope(farmId, companyId, async () => {
      const farm = await this.loadFarm(farmId, tenantId);
      const { input, flags: loadFlags } = await this.loadInput(farm, planningDate, from, to, tenantId, { stockDate, horizonTo });
      const { rows, flags, sources, dietChanges, daily } = buildFeedForecast(input);
      const asOf: ForecastFlag[] = planningDate < today ? [{ kind: 'AS_OF_PAST', planningDate, today }] : [];
      return {
        planningDate, today, timeZone, from, to, horizonTo,
        farm: { id: farm.id, code: farm.code, name: farm.name },
        refillBufferDays: farm.refillBufferDays,
        leadTimeDays: farm.leadTimeDays,
        rows, daily, flags: [...flags, ...loadFlags, ...asOf], sources, dietChanges,
      };
    });
  }
```

Replace `loadInput` with:

```ts
  private async loadInput(
    farm: ForecastFarm,
    planningDate: string,
    from: string,
    to: string,
    tenantId: string,
    opts: { stockDate: string; horizonTo: string },
  ): Promise<{ input: ForecastInput; flags: ForecastFlag[] }> {
    const companyId = farm.companyId;
    // computeForFarm has already replaced the CLS scope with the effective one
    // (fix round 2, finding 1) — every read below, direct or through the
    // ledger service, sees the chosen farm this way.
    const scope = farmScope(this.cls);

    // Every location on the farm in one read: sheds, silos and the store are
    // picked out of it below, and scheduler/batch locations (often a PEN, or a
    // CRATE under a pen) are walked up to their SHED through it in memory.
    const locations = await this.db
      .select({
        location_id: schema.locationMaster.location_id,
        location_code: schema.locationMaster.location_code,
        location_type: schema.locationMaster.location_type,
        parent_location_id: schema.locationMaster.parent_location_id,
        is_active: schema.locationMaster.is_active,
        low_level_kg: schema.locationMaster.low_level_kg,
      })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.company_id, companyId),
          eq(schema.locationMaster.farm_id, farm.id),
          isNull(schema.locationMaster.deleted_at),
          ...locationLobConditions(scope),
        ),
      );
    const locationById = new Map(locations.map((l) => [l.location_id, l]));
    const activeOfType = (type: string) =>
      locations.filter((l) => l.location_type === type && l.is_active).sort((a, b) => a.location_code.localeCompare(b.location_code));

    const shedRows = activeOfType('SHED');
    const siloRows = activeOfType('SILO');
    const activeSiloIds = new Set(siloRows.map((s) => s.location_id));

    // silo_shed_link (D7) is the only silo<->shed source; the feed_silo_id column it replaced went in 0115.
    const shedIds = shedRows.map((s) => s.location_id);
    const links = shedIds.length
      ? await this.db
          .select({ silo_id: schema.siloShedLink.silo_id, shed_id: schema.siloShedLink.shed_id })
          .from(schema.siloShedLink)
          .where(and(eq(schema.siloShedLink.tenant_id, tenantId), inArray(schema.siloShedLink.shed_id, shedIds)))
      : [];
    const siloIdsByShed = new Map<string, string[]>();
    for (const link of links) {
      if (!activeSiloIds.has(link.silo_id)) continue; // a link to a retired silo feeds nothing
      siloIdsByShed.set(link.shed_id, [...(siloIdsByShed.get(link.shed_id) ?? []), link.silo_id]);
    }
    const sheds = shedRows.map((s) => ({ shedId: s.location_id, shedCode: s.location_code, siloIds: siloIdsByShed.get(s.location_id) ?? [] }));
    const linkedSiloIds = [...new Set(links.map((l) => l.silo_id).filter((id) => activeSiloIds.has(id)))];

    // Stages are projected to the run-down horizon, so a stage change just past `to` still moves the run-down (Q12).
    const { batches, flags } = await this.loadBatches(farm, planningDate, opts.horizonTo, tenantId, locationById, new Set(shedIds));
    const feedRows = await this.loadFeedRows([...new Set(batches.map((b) => b.breedId))], companyId, tenantId);

    // The farm's STORE (D6 fallback). One per farm in every template; if a farm
    // somehow has two, the first by code is used — the forecast needs one pool.
    const storeRow = activeOfType('STORE')[0];
    const stockIds = [...linkedSiloIds, ...(storeRow ? [storeRow.location_id] : [])];
    const ledger = stockIds.length
      ? await this.ledgerService.getFeedStockAsOf({ companyId, warehouseIds: stockIds, stockDate: opts.stockDate, horizonTo: opts.horizonTo }, tenantId)
      : { opening: [], movements: [] };
    const drafts = stockIds.length ? await this.loadDraftTransfers(stockIds, companyId, tenantId, opts.stockDate, opts.horizonTo) : [];
    const stock = stockAsOf({
      silos: siloRows
        .filter((s) => linkedSiloIds.includes(s.location_id))
        .map((s) => ({ siloId: s.location_id, siloCode: s.location_code, lowLevelKg: s.low_level_kg == null ? null : Number(s.low_level_kg) })),
      store: storeRow ? { storeId: storeRow.location_id, storeCode: storeRow.location_code } : null,
      feedItemIds: new Set(feedRows.map((r) => r.itemId)),
      opening: ledger.opening,
      movements: ledger.movements,
      drafts,
    });

    const itemIds = new Set<string>(feedRows.map((r) => r.itemId));
    for (const s of stock.silos) if (s.itemId) itemIds.add(s.itemId);
    const items: Record<string, string> = {};
    const itemCodes: Record<string, string> = {};
    if (itemIds.size) {
      const itemRows = await this.db
        .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, item_code: schema.itemMaster.item_code })
        .from(schema.itemMaster)
        .where(and(eq(schema.itemMaster.tenant_id, tenantId), inArray(schema.itemMaster.item_id, [...itemIds])));
      for (const i of itemRows) {
        items[i.item_id] = i.item_name;
        itemCodes[i.item_id] = i.item_code; // Item No (D16)
      }
    }

    return {
      input: {
        planningDate,
        from,
        to,
        stockDate: opts.stockDate,
        horizonTo: opts.horizonTo,
        refillBufferDays: farm.refillBufferDays,
        leadTimeDays: farm.leadTimeDays,
        sheds,
        silos: stock.silos,
        store: stock.store,
        incoming: stock.incoming,
        items,
        itemCodes,
        batches,
        feedRows,
      },
      flags,
    };
  }

  /**
   * D19 "confirmed incoming", part (b) of open question Q2: stock transfers
   * saved but not yet posted, dated inside the walk. Nothing in NAVFarm is in
   * transit — a transfer posts both sides at once (stock-transfer.service
   * post()) — so a dated DRAFT is the only booked-but-not-arrived feed until
   * Plan C's Transfer Orders. Into one of the farm's silos or its store it is
   * incoming; out of one it is negative, so a store-to-silo transfer is not
   * counted in both places. A POSTED transfer is already among the ledger
   * movements, so it is never counted here as well.
   */
  private async loadDraftTransfers(
    locationIds: string[],
    companyId: string,
    tenantId: string,
    stockDate: string,
    horizonTo: string,
  ): Promise<FeedStockMovement[]> {
    const T = schema.stockTransfer;
    const TL = schema.stockTransferLine;
    const common = [
      eq(T.tenant_id, tenantId),
      eq(T.company_id, companyId),
      eq(T.status, 'DRAFT'),
      isNull(T.deleted_at),
      gte(T.posting_date, stockDate),
      lte(T.posting_date, horizonTo),
    ];
    const qty = sql<string>`COALESCE(SUM(${TL.quantity}), 0)`;
    const into = await this.db
      .select({ warehouse_id: T.to_warehouse_id, item_id: TL.item_id, item_code: schema.itemMaster.item_code, uom: TL.uom, posting_date: T.posting_date, qty })
      .from(T)
      .innerJoin(TL, eq(TL.transfer_id, T.transfer_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, TL.item_id))
      .where(and(...common, inArray(T.to_warehouse_id, locationIds)))
      .groupBy(T.to_warehouse_id, TL.item_id, schema.itemMaster.item_code, TL.uom, T.posting_date);
    const out = await this.db
      .select({ warehouse_id: T.from_warehouse_id, item_id: TL.item_id, item_code: schema.itemMaster.item_code, uom: TL.uom, posting_date: T.posting_date, qty })
      .from(T)
      .innerJoin(TL, eq(TL.transfer_id, T.transfer_id))
      .innerJoin(schema.itemMaster, eq(schema.itemMaster.item_id, TL.item_id))
      .where(and(...common, inArray(T.from_warehouse_id, locationIds)))
      .groupBy(T.from_warehouse_id, TL.item_id, schema.itemMaster.item_code, TL.uom, T.posting_date);
    return [
      ...into.map((r) => ({ warehouse_id: r.warehouse_id, item_id: r.item_id, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: Number(r.qty) })),
      ...out.map((r) => ({ warehouse_id: r.warehouse_id, item_id: r.item_id, item_code: r.item_code, uom: r.uom, posting_date: r.posting_date, qty: -Number(r.qty) })),
    ];
  }
```

`loadBatches` keeps its signature; its third parameter (named `to`) now receives the horizon — rename it `horizonTo` and pass it on to `buildInputBatches({ …, to: horizonTo })`.

In `feed-forecast.module.ts` remove `SiloFeedModule` from `imports` and its import line.

- [ ] **Step 6: Existing specs follow the new shape**

`feed-forecast.service.spec.ts`:
- The engine mock's default becomes `buildFeedForecast: jest.fn(() => ({ rows: [], flags: [], sources: [], dietChanges: [], daily: [] })),`.
- Remove `siloInput` from the import and delete `describe('siloInput', …)` (its three cases now live in `feed-forecast.stock.spec.ts`).
- In `'an admin pinned to farm A (header) asking for farm B …'`, the `loadInput` expectation becomes `expect(loadInput).toHaveBeenCalledWith(FARM, expect.any(String), expect.any(String), expect.any(String), 'tenant-1', expect.any(Object));`.
- Replace the happy-path test (`'happy path: planningDate is today, …'`) with:

```ts
  it('happy path: planning date is the farm day, from/to default to it..+7, stock is read as of it, the loaded input goes to the engine as-is, loader flags are appended', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] }).setSystemTime(new Date(2026, 8, 25, 10, 30));
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: 'lob-1' });
    const input = { planningDate: '2026-09-25', marker: 'loaded' } as unknown as ForecastInput;
    loadInput.mockResolvedValueOnce({ input, flags: [{ kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }] });
    (buildFeedForecast as jest.Mock).mockReturnValueOnce({
      rows: [{ batchNo: 'B1' }], flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }], sources: [], dietChanges: [], daily: [],
    });

    const result = await service.computeForFarm('farm-A', 'comp-1', 'tenant-1');

    expect(loadInput).toHaveBeenCalledWith(FARM, '2026-09-25', '2026-09-25', '2026-10-02', 'tenant-1', { stockDate: '2026-09-25', horizonTo: '2026-10-02' });
    expect(buildFeedForecast).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      planningDate: '2026-09-25', today: '2026-09-25', timeZone: null, from: '2026-09-25', to: '2026-10-02', horizonTo: '2026-10-02',
      farm: { id: 'farm-A', code: 'VIL100', name: 'Village 100' }, refillBufferDays: 2, leadTimeDays: 0,
      rows: [{ batchNo: 'B1' }], daily: [],
      // The engine's flags, then the loader's own (a batch placed on no known shed).
      flags: [{ kind: 'HEADS_ASSUMED_FLAT', batchNo: 'B1' }, { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'B2' }],
      sources: [], dietChanges: [],
    });
  });
```

- In `describe('the effective farm scope reaches every downstream loader …')`: in `dbForLoadInput`'s `thenable`, add `innerJoin: () => thenable(rows),` and `groupBy: () => thenable(rows),`; the `InventoryLedgerService` stub there becomes

```ts
            {
              provide: InventoryLedgerService,
              useValue: {
                getFeedStockAsOf: jest.fn(async () => {
                  capturedFarmId = farmScope(localCls).farmId;
                  return { opening: [], movements: [] };
                }),
              },
            },
```

and its two `it` titles read "the stock read sees …" instead of "the store balance read sees …".
- In the `resolveFarm — fails closed` LOB test, `new FeedForecastService(lobCls, {} as any, {} as any)` becomes `new FeedForecastService(lobCls, {} as any)`.

`feed-forecast.service.farm.spec.ts` and `apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts` (line ~71): every `new FeedForecastService(<cls>, {} as any, {} as any)` becomes `new FeedForecastService(<cls>, {} as any)`:

```bash
sed -i '' '/new FeedForecastService(/s/, {} as any, {} as any)/, {} as any)/' apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts
grep -rn "new FeedForecastService(" apps/api/src --include='*.spec.ts'
```

The grep must show no call with three arguments.

- [ ] **Step 7: Run to verify they pass**

Run: `pnpm nx test api -- inventory-ledger feed-forecast feed-alert feed-requisition 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS.
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.feed-stock.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.module.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.farm.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.approve.spec.ts
git commit -m "feat(feed-forecast): stock as of the planning date, with booked transfers

The forecast read each silo's current FIFO remainder, which has no date,
so a back-dated or forward planning date could not be answered and a
transfer already booked into a silo moved nothing. It now sums the ledger
before the stock date, adds posted non-feeding movements and DRAFT
transfers after it as incoming (daily-entry feed is left to the
projection so it is not taken twice), passes each silo's low level to the
engine, and reads the item code for the Item No column. A planning date
up to 45 days either side of today is accepted; a past one is marked as
such because head counts have no history.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Service — planning date, views, reporting periods, stage block and the report

Field spec, Report Filters: Planning Date "can be used as the 'as of' date for a back-dated or forward-run forecast"; Range "Daily, Weekly, Reporting Period, or Custom From–To … When 'Reporting Period' is chosen, From/To are pulled from the Reporting Period Master". Supporting block: "Current Stage / Date From / Date To … based on when the batch actually entered the stage"; "Next Stage / Date From / Date To … the next sequential row"; "Date of Stage Change … the calculated date the batch is due to transition". `GET /feed-forecast` takes `planningDate`, `view` and `periodId`, resolves the range (Task 4), refuses a period longer than the horizon (Review Focus 3), asks for a run-down horizon of 45 days past the planning date (Q12), and answers the grouped rows, the stage block and the period. `GET /feed-forecast/periods` lists the periods a farm user may choose from under the same `INVENTORY/LEDGER` view grant as the report — a farm login has no Master Data grant.

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts` (`StageBlock`, `stageBlocksFor`, `FeedForecastReport`, `getForecast`, `listPeriods`, `loadPeriods`; `loadBatches` and `loadInput` return the stage map / blocks; `FeedForecastResponse` gains `stages`)
- Modify: `apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts`
- Test: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`ForecastView`, `FORECAST_VIEWS`, `PeriodRange`, `ReportRow`, `resolveViewRange`, `spanProblem`, `groupRows`, `MAX_SPAN_DAYS`); Task 5 (`schema.reportingPeriod`); Task 6 (`computeForFarm(…, range, clock)`, `FeedForecastResponse`).
- Produces:

```ts
export interface StageBlock {
  batchId: string; batchNo: string; shedCode: string;
  currentStageCode: string; currentFrom: string; currentTo: string | null;
  nextStageCode: string | null; nextFrom: string | null; nextTo: string | null;
  stageChangeDate: string | null; stageChangeOverdue: boolean; // due on or before the planning date but not posted
}
export function stageBlocksFor(batches: ForecastInput['batches'], stages: Map<string, StageInfo>, shedCodeById: Map<string, string>, planningDate: string): StageBlock[];
export interface FeedForecastReport {
  planningDate: string; today: string; timeZone: string | null;
  view: ForecastView; from: string; to: string; forecastFrom: string | null; horizonTo: string;
  period: PeriodRange | null;
  farm: { id: string; code: string; name: string }; refillBufferDays: number; leadTimeDays: number;
  rows: ReportRow[]; stages: StageBlock[]; flags: ForecastFlag[]; sources: ForecastSource[]; dietChanges: DietChange[];
}
FeedForecastService.getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string): Promise<FeedForecastReport>
FeedForecastService.listPeriods(queryFarmId: string | undefined, tenantId: string, userType: string | undefined): Promise<PeriodRange[]>
// FeedForecastResponse gains: stages: StageBlock[]
// REST: GET /feed-forecast?farmId&planningDate&view=DAILY|WEEKLY|PERIOD|CUSTOM&from&to&periodId
//       GET /feed-forecast/periods?farmId  → PeriodRange[]
```

- [ ] **Step 1: Write the failing tests** — append to `feed-forecast.service.spec.ts` (add `stageBlocksFor` to the import from `./feed-forecast.service`):

```ts
describe('FeedForecastService.getForecast — views, periods and the report (Plan R)', () => {
  let service: FeedForecastService;
  let compute: jest.SpyInstance;
  const daily = (over: Record<string, unknown> = {}) => ({
    date: '2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
    itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', lifecycleId: 'row-r1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
    currentInventoryKg: 1500, heads: 1000, feedRateKg: 2, perDayIntakeKg: 2000, wastagePct: 0, demandKg: 2000,
    daysOfStock: 0, sharedBatchCount: 1, indicative: true,
    runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-19', overdue: true, ...over,
  });
  const computed = {
    planningDate: '2026-09-23', today: '2026-09-23', timeZone: 'Africa/Harare', from: '2026-09-23', to: '2026-09-29', horizonTo: '2026-11-07',
    farm: { id: 'farm-A', code: 'GRS', name: 'Grasmere' }, refillBufferDays: 2, leadTimeDays: 2, rows: [],
    daily: [daily(), daily({ date: '2026-09-24', currentInventoryKg: 0 }), daily({ date: '2026-09-25', currentInventoryKg: 0 })],
    flags: [], sources: [], dietChanges: [], stages: [],
  };
  const september = { periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' };

  beforeEach(() => {
    const cls = transactionCls({});
    useFarmScope(cls, { farmId: 'farm-A', restricted: true, companyId: 'comp-1', lobId: null });
    service = new FeedForecastService(cls, {} as any);
    jest.spyOn(service, 'farmToday').mockResolvedValue({ today: '2026-09-23', timeZone: 'Africa/Harare' });
    compute = jest.spyOn(service, 'computeForFarm').mockResolvedValue(computed as any);
  });

  it('WEEKLY: 7 days from the week start, one row per batch and item with the week\'s totals, run-down looked for 45 days ahead', async () => {
    const report = await service.getForecast({ view: 'WEEKLY' }, 'tenant-1', 'STANDARD_USER');
    expect(compute).toHaveBeenCalledWith(
      'farm-A', 'comp-1', 'tenant-1',
      { from: '2026-09-23', to: '2026-09-29', planningDate: '2026-09-23', horizonTo: '2026-11-07' },
      { today: '2026-09-23', timeZone: 'Africa/Harare' },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({ date: '2026-09-23', dateTo: '2026-09-25', days: 3, intakeKg: 6000, currentInventoryKg: 1500, itemNo: 'FEED-R1' });
    expect(report).toMatchObject({ view: 'WEEKLY', forecastFrom: '2026-09-23', period: null, timeZone: 'Africa/Harare', leadTimeDays: 2 });
  });

  it('DAILY: one date, the planning date unless another is chosen', async () => {
    await service.getForecast({ view: 'DAILY', from: '2026-09-25' }, 'tenant-1', 'STANDARD_USER');
    expect(compute.mock.calls[0][3]).toMatchObject({ from: '2026-09-25', to: '2026-09-25', horizonTo: '2026-11-07' });
  });

  it('PERIOD: From/To come from the period covering the planning date; days before the planning date are not forecast (Q7)', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    const report = await service.getForecast({ view: 'PERIOD' }, 'tenant-1', 'STANDARD_USER');
    expect(compute.mock.calls[0][3]).toMatchObject({ from: '2026-08-30', to: '2026-09-26' });
    expect(report).toMatchObject({ from: '2026-08-30', to: '2026-09-26', forecastFrom: '2026-09-23', period: { periodCode: '2026-09' } });
  });

  it('refuses a reporting period longer than the 45-day horizon, naming it, and computes nothing (Review Focus 3)', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([{ ...september, periodId: 'p-long', periodCode: '2026-X', startDate: '2026-08-01', endDate: '2026-09-19' }]);
    await expect(service.getForecast({ view: 'PERIOD', periodId: 'p-long' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('Reporting period 2026-X runs 50 days (2026-08-01 to 2026-09-19); the forecast covers at most 46.'),
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('says where to add a period when none covers the planning date, and refuses an unknown period id', async () => {
    jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([]);
    await expect(service.getForecast({ view: 'PERIOD' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('No reporting period covers 2026-09-23. Add one under Master Data → Reporting Periods.'),
    );
    await expect(service.getForecast({ view: 'PERIOD', periodId: 'nope' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(
      new BadRequestException('Reporting period not found.'),
    );
    expect(compute).not.toHaveBeenCalled();
  });

  it('marks a range that ends before the planning date as not forecast', async () => {
    const report = await service.getForecast({ from: '2026-09-10', to: '2026-09-15' }, 'tenant-1', 'STANDARD_USER');
    expect(report.forecastFrom).toBeNull();
  });

  it('refuses a planning date that is not a calendar day', async () => {
    await expect(service.getForecast({ planningDate: '2026-02-31' }, 'tenant-1', 'STANDARD_USER')).rejects.toThrow(BadRequestException);
    expect(compute).not.toHaveBeenCalled();
  });

  it('listPeriods answers the farm company\'s periods after resolving the farm', async () => {
    const loadPeriods = jest.spyOn(service as any, 'loadPeriods').mockResolvedValue([september]);
    await expect(service.listPeriods(undefined, 'tenant-1', 'STANDARD_USER')).resolves.toEqual([september]);
    expect(loadPeriods).toHaveBeenCalledWith('comp-1', 'tenant-1');
    await expect(service.listPeriods('farm-B', 'tenant-1', 'STANDARD_USER')).rejects.toThrow(NotFoundException);
  });
});

describe('stageBlocksFor — current / next stage block (field spec supporting block)', () => {
  const stages = new Map<string, StageInfo>([
    ['wean', { stageId: 'wean', stageCode: 'WEANER', durationDays: 42, nextStageId: 'grow', isActive: true }],
    ['grow', { stageId: 'grow', stageCode: 'GROWER', durationDays: 56, nextStageId: null, isActive: true }],
    ['sow', { stageId: 'sow', stageCode: 'DRY_SOW', durationDays: null, nextStageId: 'grow', isActive: true }],
  ]);
  const sheds = new Map([['h3', 'GRS/SHED-003']]);
  const batch = (stageId: string, stageCode: string, start: string) => ({
    batchId: 'b', batchNo: 'WG-2026-38', breedId: 'l', shedId: 'h3', heads: 1000,
    segments: [{ stageId, stageCode, start, end: null, projected: false }],
  });

  it('dates the current stage from its entry, the next from the day after, and names the change date', () => {
    expect(stageBlocksFor([batch('wean', 'WEANER', '2026-09-01')], stages, sheds, '2026-09-23')).toEqual([{
      batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003',
      currentStageCode: 'WEANER', currentFrom: '2026-09-01', currentTo: '2026-10-12',
      nextStageCode: 'GROWER', nextFrom: '2026-10-13', nextTo: '2026-12-07',
      stageChangeDate: '2026-10-13', stageChangeOverdue: false,
    }]);
  });

  it('marks a change that fell due on or before the planning date but was not posted', () => {
    const [block] = stageBlocksFor([batch('wean', 'WEANER', '2026-08-01')], stages, sheds, '2026-09-23');
    expect(block).toMatchObject({ currentTo: '2026-09-11', stageChangeDate: '2026-09-12', stageChangeOverdue: true });
  });

  it('leaves the dates open when Stage Master gives no duration, and the next stage empty when there is none', () => {
    expect(stageBlocksFor([batch('sow', 'DRY_SOW', '2026-09-01')], stages, sheds, '2026-09-23')[0])
      .toMatchObject({ currentTo: null, nextStageCode: 'GROWER', nextFrom: null, stageChangeDate: null });
    expect(stageBlocksFor([batch('grow', 'GROWER', '2026-09-01')], stages, sheds, '2026-09-23')[0])
      .toMatchObject({ currentTo: '2026-10-26', nextStageCode: null, nextFrom: null, stageChangeDate: null, stageChangeOverdue: false });
  });
});
```

In the Task 6 happy-path test's `toEqual`, add `stages: [],` after `dietChanges: [],` (the stubbed `loadInput` returns no stage blocks).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-forecast.service 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: FAIL — `stageBlocksFor` is not a function, `listPeriods` is not a function, the report has no `view`.

- [ ] **Step 3: DTO** — `dto/feed-forecast.dto.ts` becomes:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { FORECAST_VIEWS, ForecastView } from '../feed-forecast.view';

export class QueryFeedForecastDto {
  // Optional because a farm-bound user already has exactly one farm (spec
  // D13); tenant and company admins must name the farm they want to see.
  @ApiProperty({ description: 'Farm (top-level Location Master row) to forecast', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;

  @ApiProperty({ description: 'As-of date (YYYY-MM-DD); defaults to today in the farm time zone (D16), within 45 days of it', required: false })
  @IsOptional()
  @IsDateString()
  planningDate?: string;

  @ApiProperty({ description: 'DAILY (one date), WEEKLY (7 days grouped), PERIOD (a reporting period grouped) or CUSTOM (per date); default CUSTOM', required: false, enum: FORECAST_VIEWS })
  @IsOptional()
  @IsIn(FORECAST_VIEWS as unknown as string[])
  view?: ForecastView;

  @ApiProperty({ description: 'DAILY: the date; WEEKLY: the week start; CUSTOM: the first day. Defaults to the planning date. Ignored for PERIOD.', required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ description: 'CUSTOM only: the last day; defaults to from + 7, at most from + 45', required: false })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ description: 'PERIOD only: the reporting period; defaults to the one covering the planning date', required: false })
  @IsOptional()
  @IsUUID()
  periodId?: string;
}

export class QueryFeedPeriodsDto {
  @ApiProperty({ description: 'Farm whose company periods are listed', required: false })
  @IsOptional()
  @IsUUID()
  farmId?: string;
}
```

- [ ] **Step 4: Service** — in `feed-forecast.service.ts`:

Import from the view module: `import { DEFAULT_SPAN_DAYS, ForecastView, groupRows, MAX_SPAN_DAYS, PeriodRange, ReportRow, resolveViewRange, spanProblem } from './feed-forecast.view';`.

After `FarmClock`, add:

```ts
/**
 * Field specification, Supporting Stage / Diet Reference Block: the stage the
 * batch is in (dated from when it actually entered it — its scheduler header,
 * else the batch start), the next stage from Stage Master, and the day the
 * batch is due to change. Stage Master's typical duration dates both; without
 * one the dates stay open rather than being guessed. A change that fell due
 * on or before the planning date and was not posted is marked, because the
 * forecast keeps feeding the recorded stage (Plan A fix round 1).
 */
export interface StageBlock {
  batchId: string;
  batchNo: string;
  shedCode: string;
  currentStageCode: string;
  currentFrom: string;
  currentTo: string | null;
  nextStageCode: string | null;
  nextFrom: string | null;
  nextTo: string | null;
  stageChangeDate: string | null;
  stageChangeOverdue: boolean;
}

export function stageBlocksFor(
  batches: ForecastInput['batches'],
  stages: Map<string, StageInfo>,
  shedCodeById: Map<string, string>,
  planningDate: string,
): StageBlock[] {
  return batches
    .map((b) => {
      const current = b.segments[0];
      const stage = stages.get(current.stageId);
      const currentTo = stage?.durationDays && stage.durationDays >= 1 ? addDays(current.start, stage.durationDays - 1) : null;
      const candidate = stage?.nextStageId ? stages.get(stage.nextStageId) : undefined;
      const next = candidate && candidate.isActive ? candidate : undefined;
      const nextFrom = currentTo && next ? addDays(currentTo, 1) : null;
      const nextTo = nextFrom && next?.durationDays && next.durationDays >= 1 ? addDays(nextFrom, next.durationDays - 1) : null;
      return {
        batchId: b.batchId,
        batchNo: b.batchNo,
        shedCode: shedCodeById.get(b.shedId) ?? '',
        currentStageCode: current.stageCode,
        currentFrom: current.start,
        currentTo,
        nextStageCode: next?.stageCode ?? null,
        nextFrom,
        nextTo,
        stageChangeDate: nextFrom,
        stageChangeOverdue: nextFrom !== null && nextFrom <= planningDate,
      };
    })
    .sort((a, b) => (a.shedCode !== b.shedCode ? a.shedCode.localeCompare(b.shedCode) : a.batchNo.localeCompare(b.batchNo)));
}

/** GET /feed-forecast (Plan R): the field specification's report — grouped rows, the stage block and the range it covers. */
export interface FeedForecastReport {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  forecastFrom: string | null; // first date forecast (Q7); null when the range ends before the planning date
  horizonTo: string;
  period: PeriodRange | null;
  farm: { id: string; code: string; name: string };
  refillBufferDays: number;
  leadTimeDays: number;
  rows: ReportRow[];
  stages: StageBlock[];
  flags: ForecastFlag[];
  sources: ForecastSource[];
  dietChanges: DietChange[];
}
```

Add `stages: StageBlock[];` to `FeedForecastResponse`.

Replace `getForecast` with:

```ts
  async getForecast(query: QueryFeedForecastDto, tenantId: string, userType?: string): Promise<FeedForecastReport> {
    const { farmId, companyId } = await this.resolveFarm(query.farmId, tenantId, userType);
    const clock = await this.farmToday(companyId, tenantId);
    const planningDate = query.planningDate ?? clock.today;
    if (!isCalendarDay(planningDate)) throw new BadRequestException('planningDate must be a calendar date (YYYY-MM-DD).');
    const view: ForecastView = query.view ?? 'CUSTOM';
    let period: PeriodRange | null = null;
    if (view === 'PERIOD') {
      const periods = await this.loadPeriods(companyId, tenantId);
      period = query.periodId
        ? periods.find((p) => p.periodId === query.periodId) ?? null
        : periods.find((p) => p.startDate <= planningDate && planningDate <= p.endDate) ?? null;
      if (!period) {
        throw new BadRequestException(
          query.periodId ? 'Reporting period not found.' : `No reporting period covers ${planningDate}. Add one under Master Data → Reporting Periods.`,
        );
      }
    }
    const { from, to } = resolveViewRange({ view, planningDate, from: query.from, to: query.to, period });
    if (!isCalendarDay(from) || !isCalendarDay(to)) throw new BadRequestException('from and to must be calendar dates (YYYY-MM-DD).');
    const span = spanProblem(from, to, period);
    if (span) throw new BadRequestException(span);
    // Q12: whatever the view, Run-Down / Date to Refill / Required On look 45 days past the planning date.
    const result = await this.computeForFarm(farmId, companyId, tenantId, { from, to, planningDate, horizonTo: addDays(planningDate, MAX_SPAN_DAYS) }, clock);
    return {
      planningDate: result.planningDate,
      today: result.today,
      timeZone: result.timeZone,
      view,
      from,
      to,
      forecastFrom: to < planningDate ? null : from > planningDate ? from : planningDate,
      horizonTo: result.horizonTo,
      period,
      farm: result.farm,
      refillBufferDays: result.refillBufferDays,
      leadTimeDays: result.leadTimeDays,
      rows: groupRows(result.daily, view, from),
      stages: result.stages,
      flags: result.flags,
      sources: result.sources,
      dietChanges: result.dietChanges,
    };
  }

  /** GET /feed-forecast/periods: the periods the Reporting Period view may use, for the caller's farm (D13, D20). */
  async listPeriods(queryFarmId: string | undefined, tenantId: string, userType: string | undefined): Promise<PeriodRange[]> {
    const { companyId } = await this.resolveFarm(queryFarmId, tenantId, userType);
    return this.loadPeriods(companyId, tenantId);
  }

  /**
   * The company's active reporting periods by start date (D20); a tenant-wide
   * list when the company has none of its own — the master allows both scopes
   * and the company's own list wins, as it would for any master.
   */
  private async loadPeriods(companyId: string, tenantId: string): Promise<PeriodRange[]> {
    const P = schema.reportingPeriod;
    const rows = await this.db
      .select({
        period_id: P.period_id, company_id: P.company_id, period_code: P.period_code, start_date: P.start_date,
        end_date: P.end_date, stock_take_date: P.stock_take_date, production_start_date: P.production_start_date,
      })
      .from(P)
      .where(and(eq(P.tenant_id, tenantId), or(eq(P.company_id, companyId), isNull(P.company_id)), eq(P.is_active, true), isNull(P.deleted_at)))
      .orderBy(P.start_date);
    const own = rows.filter((r) => r.company_id === companyId);
    return (own.length ? own : rows).map((r) => ({
      periodId: r.period_id, periodCode: r.period_code, startDate: r.start_date, endDate: r.end_date,
      stockTakeDate: r.stock_take_date, productionStartDate: r.production_start_date,
    }));
  }
```

In `computeForFarm`, destructure `const { input, flags: loadFlags, stageBlocks } = await this.loadInput(…);` and add `stages: stageBlocks ?? [],` to the returned object after `dietChanges`.

`loadBatches`: its return type becomes `Promise<{ batches: InputBatch[]; flags: ForecastFlag[]; stages: Map<string, StageInfo> }>`; the early return becomes `return { batches: [], flags: [], stages: new Map() };`; the final return becomes

```ts
    return { ...buildInputBatches({ batchRows: fed, animalGroups, headers, stages, locationById, activeShedIds, planningDate, to: horizonTo }), stages };
```

`loadInput`: its return type becomes `Promise<{ input: ForecastInput; flags: ForecastFlag[]; stageBlocks: StageBlock[] }>`; destructure `const { batches, flags, stages } = await this.loadBatches(…);` and, before the `return`, add

```ts
    const stageBlocks = stageBlocksFor(batches, stages, new Map(shedRows.map((s) => [s.location_id, s.location_code])), planningDate);
```

and return `{ input: { … }, flags, stageBlocks }`.

- [ ] **Step 5: Controller** — in `feed-forecast.controller.ts` import `QueryFeedPeriodsDto` beside `QueryFeedForecastDto` and add, above the existing `@Get()`:

```ts
  // Read under the same grant as the report (INVENTORY/LEDGER view): a farm
  // login choosing a period has no Master Data grant, and needs none to read
  // the dates its own report is cut by.
  @Get('periods')
  @RequirePermission('INVENTORY', 'LEDGER', 'view')
  @ApiOperation({ summary: "Reporting periods the Feed Forecast's Reporting Period view can use, for one farm's company (D20)" })
  async periods(@Query() query: QueryFeedPeriodsDto, @Req() req: any) {
    const tenantId = req.user?.tenantId || req['tenantId'];
    const data = await this.feedForecastService.listPeriods(query.farmId, tenantId, req.user?.userType);
    return { success: true, message: 'Reporting periods retrieved successfully.', data };
  }
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm nx test api -- feed-forecast feed-alert feed-requisition farm-scope-coverage 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS.
Run: `pnpm nx test web -- role-permissions-coverage` → PASS (no new pair: `INVENTORY/LEDGER` is already offered).
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts
git commit -m "feat(feed-forecast): planning date, views, reporting periods and the stage block

The report answered one fixed shape: today, a typed From/To, one row per
batch and item. The field specification asks for an as-of Planning Date,
Daily/Weekly/Reporting Period/Custom views with the period's dates taken
from the Reporting Period Master, and a current/next stage block with the
date of stage change. GET /feed-forecast now takes planningDate, view and
periodId, refuses a period longer than the 45-day horizon by name, and
answers the grouped rows, the stage block and the period; GET
/feed-forecast/periods lists the periods under the report's own grant.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Requisition — draft the shortfall, date the line Required On

D19's run-down change "must flow to requisitions": the auto-draft reads the same sources as the report, so its **first shortage date** is already the new run-down (Task 2). Two things still differ: the quantity (Q3 — `shortfallKg`, which counts the low level and confirmed incoming) and the line's date (Q4 — the field specification's Required On: "the date used to populate the auto-drafted Requisition line"). Wastage stays in the quantities (D17: "requisition quantities use heads × rate × (1 + wastage %)"), because `shortfallKg` is built from the with-wastage demand. A silo that lands exactly on its level inside the window still gets a line — one compartment or bag — so a run-down on the report never comes without a requisition line (Review Focus 2).

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts` (`recommendLines`)
- Test: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts`, `feed-requisition.service.spec.ts`

**Interfaces:**
- Consumes: `ForecastSource.shortfallKg`, `.requiredOn`, `.runDownDate` (Task 2).
- Produces: `recommendLines` unchanged in signature; `DraftLine.unroundedNeedKg` = `shortfallKg`; `DraftLine.proposedDeliveryDate` = Required On (or the planning date when that has passed; `to` when nothing runs down).

- [ ] **Step 1: Write the failing tests** — in `feed-requisition.rules.spec.ts`:

In `describe('recommendLines — Worked Example', …)`, the R2 expectation's `proposedDeliveryDate: '2026-09-26'` becomes `proposedDeliveryDate: '2026-09-24', // Q4: Required On (run-down 26 Sep − 2 buffer − 0 lead)`, and the test `'drafts nothing for a source whose stock covers the window'` becomes:

```ts
  it('drafts nothing for a source whose stock covers the window', () => {
    const covered = { ...r1, balanceKg: 6000, shortfallKg: 0, runDownDate: null, refillDate: null, requiredOn: null, overdue: false };
    expect(recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [covered], destinations: new Map([silo('s1')]), settings: S })).toEqual([]);
  });
```

Append a new describe:

```ts
describe('recommendLines — Plan R (D19, Q3, Q4)', () => {
  const draft = (source: ForecastSource) =>
    recommendLines({ planningDate: '2026-09-23', to: '2026-09-29', sources: [source], destinations: new Map([silo('s1')]), settings: S });

  it('drafts the engine\'s shortfall (low level and incoming counted), not requirement − opening', () => {
    const [line] = draft({ ...r1, shortfallKg: 7000 });
    expect(line).toMatchObject({ unroundedNeedKg: 7000, recommendedQtyKg: 9000 });
  });

  it('dates the line Required On, or the planning date when Required On has passed', () => {
    expect(draft({ ...r1, requiredOn: '2026-09-25', overdue: false })[0].proposedDeliveryDate).toBe('2026-09-25');
    expect(draft(r1)[0].proposedDeliveryDate).toBe('2026-09-23'); // Required On 21 Sep is already past
  });

  it('a run-down inside the window always drafts a line — landing exactly on the level orders one compartment (Review Focus 2)', () => {
    const [line] = draft({ ...r1, shortfallKg: 0, runDownDate: '2026-09-29', refillDate: '2026-09-27', requiredOn: '2026-09-25', overdue: false });
    expect(line).toMatchObject({ unroundedNeedKg: 0, recommendedQtyKg: 3000, firstShortageDate: '2026-09-29', proposedDeliveryDate: '2026-09-25' });
  });

  it('a run-down found only past the window drafts nothing', () => {
    expect(draft({ ...r1, shortfallKg: 0, runDownDate: '2026-10-05', refillDate: '2026-10-03', requiredOn: '2026-10-01', overdue: false })).toEqual([]);
  });
});
```

In `feed-requisition.service.spec.ts`, the rerun test's source becomes `setup([source({ walkDemandKg: 9000, shortfallKg: 7500 })], queues)` (the recommendation it expects, 9,000 kg, is 7,500 rounded up).

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test api -- feed-requisition 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"`
Expected: FAIL — need still `walkDemandKg − balanceKg`, line dated at run-down, no line for an exact landing.

- [ ] **Step 3: Implement** — in `feed-requisition.rules.ts`, update the header docblock's first bullet to read:

```ts
 * - Recommended quantity: the forecast's shortfall (Plan R, Q3) — the
 *   largest deficit below the silo's low level through the window after
 *   confirmed incoming — then `CEILING(…, 3000)`; with no low level and
 *   nothing incoming that is the Worked Example's `MAX(0, requirement −
 *   opening)` (columns G–H). Engine Step 8 "Bulk rounding defaults to 3000 KG
 *   per compartment … Bagged rounds to 50 KG". Silo free capacity is not
 *   applied (Q9 of Plan B).
```

and in `recommendLines` replace the body of the loop from `const unroundedNeedKg = …` down to the `lines.push({` opening with:

```ts
    // Q3 (Plan R): what an order must bring so the silo stays above its low level through `to`, incoming counted.
    const unroundedNeedKg = Math.max(0, round3(s.shortfallKg));
    const runsDownInWindow = s.runDownDate !== null && s.runDownDate <= to;
    if (unroundedNeedKg <= 0 && !runsDownInWindow) continue;
    const dest = destinations.get(s.locationId) ?? { locationId: s.locationId, locationType: s.sourceType, feedInBags: null, lowLevelKg: null };
    const feedType = feedTypeOf(dest);
    // A silo that lands exactly on its level still needs the next delivery: the smallest order, one compartment or bag.
    const recommendedQtyKg = unroundedNeedKg > 0
      ? roundOrderKg(unroundedNeedKg, feedType, settings)
      : feedType === 'BULK' ? settings.bulkMultipleKg : settings.bagSizeKg;
```

and replace the `proposedDeliveryDate` property with:

```ts
      // Q4 (Plan R): the field specification's Required On "is the date used to populate the auto-drafted
      // Requisition line"; one already past is due now. Nothing runs down in the window: `to`, as before.
      proposedDeliveryDate: s.requiredOn ? (s.requiredOn < planningDate ? planningDate : s.requiredOn) : to,
```

(The `firstShortageDate: s.runDownDate` line is unchanged — it now carries D19's run-down.)

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm nx test api -- feed-requisition feed-alert 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS. Typecheck `api,web` → PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.rules.spec.ts apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts
git commit -m "feat(feed-requisition): draft the forecast's shortfall, dated Required On

With run-down now to the silo's low level and booked transfers counted
(D19), drafting MAX(0, requirement - opening) and dating the line at the
run-down left the requisition planning to empty while the report planned
to the low level. The draft now takes the forecast's shortfall (the same
number when no low level or transfer is involved, so the Worked Example
still drafts 6,000 and 9,000 kg), dates the line Required On as the field
specification says, and orders one compartment when a silo lands exactly
on its level inside the window. Wastage stays in the quantities (D17).

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Web — report grid and stage block components

The field specification's Report Grid, in its column order: Batch No, Item Name, **Item No**, Shed No, Planning Date, Current Inventory (Kg), Current No. of Pigs (NOS), Per Day Intake (Kg), Current No of Days Stock, Scale of Silo Level (Run Down), Date to Refill, Required On Date — with our Source column kept after Planning Date (D6: a shed without a silo draws on the store, and the user must see which) and a last "Feed incl. Wastage (Kg)" column (D17: what leaves the silo over the line, which is what run-down and the requisition use). Dates DD/MM/YY (D16). Days of Stock carries the **Indicative** badge (Q13) and "Silo shared by N batches" (D18). The wastage note states the allowance used (D17). The stage block renders as a list of cards, not a second `<table>`, so the panel's existing `findByRole('table')` tests keep one table to find.

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-format.ts`
- Create: `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`
- Create: `apps/web/specs/feed-forecast-grid.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts` (`en` only, in the "Console — Inventory — Feed Forecast panel" block)

**Interfaces:**
- Consumes: the API's `ReportRow` and `StageBlock` shapes (Task 4, Task 7) — mirrored as TypeScript interfaces here.
- Produces:

```ts
// feed-format.ts
export function formatDateShort(iso: string | null | undefined): string; // "2026-09-23" -> "23/09/26"; else "—"
export function addDaysIso(iso: string, days: number): string;
// feed-forecast-grid.tsx
export interface ReportRow { /* exactly the API's ReportRow (Task 4) */ }
export interface StageBlock { /* exactly the API's StageBlock (Task 7) */ }
export const GRID_COLUMNS: readonly string[]; // 14 translation keys, in order
export function fmtKg(n: number | null | undefined): string;
export function wastageNote(rows: ReportRow[], t: (key: any, vars?: any) => string): string;
export function FeedForecastGrid(props: { rows: ReportRow[]; loading: boolean; horizonTo: string | null; t: (key: any, vars?: any) => string }): JSX.Element;
export function FeedForecastStages(props: { stages: StageBlock[]; t: (key: any, vars?: any) => string }): JSX.Element | null;
```

- [ ] **Step 0: Record the web lint baseline** — `pnpm nx lint web 2>&1 | grep -c " error "` → note the number (Task 10 gates on it).

- [ ] **Step 1: Write the failing tests** — create `apps/web/specs/feed-forecast-grid.spec.tsx`:

```tsx
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { FeedForecastGrid, FeedForecastStages, GRID_COLUMNS, ReportRow, StageBlock, wastageNote } from '../src/components/console/inventory/feed-forecast-grid';
import { addDaysIso, formatDateShort } from '../src/components/console/inventory/feed-format';

const t = (key: string, vars?: Record<string, unknown>) => (vars ? `${key}:${JSON.stringify(vars)}` : key);

const row = (over: Partial<ReportRow> = {}): ReportRow => ({
  key: 'b|r1|GRS/SILO-001|2026-09-23', batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', stageCode: 'WEANER',
  itemId: 'r1', itemNo: 'FEED-R1', itemName: 'Weaner Diet R1', sourceType: 'SILO', sourceCode: 'GRS/SILO-001',
  date: '2026-09-23', dateTo: '2026-09-23', days: 1, currentInventoryKg: 1500, heads: 1000, perDayIntakeKg: 2000, wastagePct: 0,
  intakeKg: 2000, demandKg: 2000, daysOfStock: 0, sharedBatchCount: 1, indicative: false,
  runDownDate: '2026-09-23', refillDate: '2026-09-21', requiredOn: '2026-09-19', overdue: true, ...over,
});

describe('feed-format date helpers (D16)', () => {
  it('formats DD/MM/YY and dashes anything unusable', () => {
    expect(formatDateShort('2026-09-23')).toBe('23/09/26');
    expect(formatDateShort(null)).toBe('—');
    expect(formatDateShort('nonsense')).toBe('—');
  });
  it('adds calendar days across a month end', () => {
    expect(addDaysIso('2026-09-28', 7)).toBe('2026-10-05');
  });
});

describe('FeedForecastGrid', () => {
  it("renders the field specification's columns in order", () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const headers = within(screen.getByRole('table')).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'ffColBatchNo', 'ffColItemName', 'ffColItemNo', 'ffColShedNo', 'ffColPlanningDate', 'ffColSource',
      'ffColCurrentInventoryKg', 'ffColCurrentPigs', 'ffColPerDayIntakeKg', 'ffColDaysOfStock',
      'ffColRunDown', 'ffColDateToRefill', 'ffColRequiredOn', 'ffColFeedOutKg',
    ]);
    expect(headers).toEqual([...GRID_COLUMNS]);
  });

  it('shows the Item No, DD/MM/YY dates and an Overdue badge', () => {
    render(<FeedForecastGrid rows={[row()]} loading={false} horizonTo="2026-11-07" t={t} />);
    const table = screen.getByRole('table');
    expect(within(table).getByText('FEED-R1')).toBeTruthy();
    expect(within(table).getAllByText('23/09/26').length).toBe(2); // planning date and run-down
    expect(within(table).getByText('21/09/26')).toBeTruthy();
    expect(within(table).getByText('19/09/26')).toBeTruthy();
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
  });

  it('marks an indicative days-of-stock and a shared silo (Q13, D18)', () => {
    render(<FeedForecastGrid rows={[row({ indicative: true, sharedBatchCount: 2, daysOfStock: 5 })]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText('ffIndicative')).toBeTruthy();
    expect(screen.getByText('ffSharedSilo:{"count":2}')).toBeTruthy();
    expect(screen.getByText('5')).toBeTruthy();
  });

  it("shows a grouped line's dates and says the silo lasts beyond the horizon when nothing runs down", () => {
    render(
      <FeedForecastGrid
        rows={[row({ days: 3, dateTo: '2026-09-25', runDownDate: null, refillDate: null, requiredOn: null, overdue: false })]}
        loading={false}
        horizonTo="2026-11-07"
        t={t}
      />,
    );
    expect(screen.getByText('23/09/26 – 25/09/26')).toBeTruthy();
    expect(screen.getByText('ffBeyondHorizon:{"date":"07/11/26"}')).toBeTruthy();
    expect(screen.queryByText('ffOverdue')).toBeNull();
  });

  it('shows an empty state and a loading state', () => {
    const { rerender } = render(<FeedForecastGrid rows={[]} loading={false} horizonTo={null} t={t} />);
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
    rerender(<FeedForecastGrid rows={[]} loading horizonTo={null} t={t} />);
    expect(screen.getByText(/ffLoading/)).toBeTruthy();
  });
});

describe('wastageNote (D17)', () => {
  it('names each allowance used, or says there is none', () => {
    expect(wastageNote([row({ wastagePct: 5 }), row({ wastagePct: 2.5 }), row({ wastagePct: 5 })], t)).toBe('ffWastageUsed:{"pcts":"2.5%, 5%"}');
    expect(wastageNote([row()], t)).toBe('ffWastageNone');
  });
});

describe('FeedForecastStages (field spec supporting block)', () => {
  const block: StageBlock = {
    batchId: 'b', batchNo: 'WG-2026-38', shedCode: 'GRS/SHED-003', currentStageCode: 'WEANER', currentFrom: '2026-08-01', currentTo: '2026-09-11',
    nextStageCode: 'GROWER', nextFrom: '2026-09-12', nextTo: '2026-11-06', stageChangeDate: '2026-09-12', stageChangeOverdue: true,
  };
  it('lists each batch with its current and next stage, the change date and a not-posted mark', () => {
    render(<FeedForecastStages stages={[block]} t={t} />);
    const list = screen.getByRole('list');
    expect(within(list).getByText('WG-2026-38 · GRS/SHED-003')).toBeTruthy();
    expect(within(list).getByText(/WEANER \(01\/08\/26 – 11\/09\/26\)/)).toBeTruthy();
    expect(within(list).getByText(/GROWER \(12\/09\/26 – 06\/11\/26\)/)).toBeTruthy();
    expect(within(list).getByText('ffStageChangeNotPosted')).toBeTruthy();
  });
  it('renders nothing without batches', () => {
    const { container } = render(<FeedForecastStages stages={[]} t={t} />);
    expect(container.innerHTML).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test web -- feed-forecast-grid 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|Cannot find"`
Expected: FAIL — cannot find `feed-forecast-grid`; `formatDateShort`/`addDaysIso` not exported.

- [ ] **Step 3: Helpers** — append to `feed-format.ts`:

```ts
/** "YYYY-MM-DD" -> "DD/MM/YY", the field specification's date format (spec D16); null/undefined/unparseable -> "—". */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "—";
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${String(y % 100).padStart(2, "0")}`;
}

/** Calendar-day arithmetic on "YYYY-MM-DD" at UTC midnight, the same way the API does it. */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Components** — create `feed-forecast-grid.tsx`:

```tsx
"use client";

/**
 * Inventory -> Feed Forecast: the report grid and the stage block (Feed
 * Forecast Plan R; the client's field specification of 26 Sep; spec
 * D16–D19). Presentational only — feed-forecast-panel.tsx fetches, these
 * render — so the column rules can be tested without the panel's farm and
 * fetch plumbing. Dates are DD/MM/YY (D16). Current Inventory is the System
 * Balance (checkpoint 37), never "physical stock".
 */
import { Inbox, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateShort } from "./feed-format";

/** One grid line as GET /feed-forecast sends it (apps/api …/feed-forecast.view.ts ReportRow). */
export interface ReportRow {
  key: string;
  batchId: string;
  batchNo: string;
  shedCode: string;
  stageCode: string;
  itemId: string;
  itemNo: string;
  itemName: string;
  sourceType: "SILO" | "STORE" | "NONE";
  sourceCode: string | null;
  date: string;
  dateTo: string;
  days: number;
  currentInventoryKg: number;
  heads: number;
  perDayIntakeKg: number;
  wastagePct: number;
  intakeKg: number;
  demandKg: number;
  daysOfStock: number | null;
  sharedBatchCount: number;
  indicative: boolean;
  runDownDate: string | null;
  refillDate: string | null;
  requiredOn: string | null;
  overdue: boolean;
}

/** The current / next stage of one batch (apps/api …/feed-forecast.service.ts StageBlock). */
export interface StageBlock {
  batchId: string;
  batchNo: string;
  shedCode: string;
  currentStageCode: string;
  currentFrom: string;
  currentTo: string | null;
  nextStageCode: string | null;
  nextFrom: string | null;
  nextTo: string | null;
  stageChangeDate: string | null;
  stageChangeOverdue: boolean;
}

type Translate = (key: any, vars?: any) => string;

/**
 * The field specification's Report Grid in its order, with two of ours: Source
 * after Planning Date (D6 — a shed without a silo draws on the store, and the
 * user must see which), and the feed that leaves the silo, wastage included,
 * last (D17 — what run-down and the requisition use).
 */
export const GRID_COLUMNS = [
  "ffColBatchNo", "ffColItemName", "ffColItemNo", "ffColShedNo", "ffColPlanningDate", "ffColSource",
  "ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock",
  "ffColRunDown", "ffColDateToRefill", "ffColRequiredOn", "ffColFeedOutKg",
] as const;

const RIGHT_ALIGNED = new Set<string>(["ffColCurrentInventoryKg", "ffColCurrentPigs", "ffColPerDayIntakeKg", "ffColDaysOfStock", "ffColFeedOutKg"]);

export function fmtKg(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** D17: "The screen states the wastage allowance used." */
export function wastageNote(rows: ReportRow[], t: Translate): string {
  const pcts = [...new Set(rows.map((r) => r.wastagePct).filter((p) => p > 0))].sort((a, b) => a - b);
  return pcts.length ? t("ffWastageUsed", { pcts: pcts.map((p) => `${p}%`).join(", ") }) : t("ffWastageNone");
}

const primary = { color: "var(--text-primary)" };
const secondary = { color: "var(--text-secondary)" };

export function FeedForecastGrid({ rows, loading, horizonTo, t }: { rows: ReportRow[]; loading: boolean; horizonTo: string | null; t: Translate }) {
  return (
    <Table>
      <TableHeader>
        <tr>
          {GRID_COLUMNS.map((c) => (
            <TableHead key={c} className={RIGHT_ALIGNED.has(c) ? "text-right" : undefined}>{t(c)}</TableHead>
          ))}
        </tr>
      </TableHeader>
      <TableBody>
        {loading ? (
          <TableRow>
            <TableCell colSpan={GRID_COLUMNS.length} className="py-10 text-center" style={secondary}>
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" style={{ color: "var(--accent)" }} /> {t("ffLoading")}
            </TableCell>
          </TableRow>
        ) : rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={GRID_COLUMNS.length} className="py-10 text-center" style={secondary}>
              <Inbox className="mx-auto mb-2 h-6 w-6" style={{ color: "var(--text-muted)" }} /> {t("ffNoRows")}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="whitespace-nowrap" style={primary}>{row.batchNo}</TableCell>
              <TableCell className="whitespace-nowrap" style={primary}>{row.itemName}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{row.itemNo || "—"}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{row.shedCode || "—"}</TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.days > 1 ? `${formatDateShort(row.date)} – ${formatDateShort(row.dateTo)}` : formatDateShort(row.date)}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.sourceType === "NONE" ? t("ffNoSource") : row.sourceCode ?? "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.currentInventoryKg)}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{row.heads}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.perDayIntakeKg)}</TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>
                <div className="flex items-center justify-end gap-1.5">
                  <span>{row.daysOfStock ?? "—"}</span>
                  {row.indicative && <Badge variant="warning">{t("ffIndicative")}</Badge>}
                </div>
                {row.sharedBatchCount > 1 && (
                  <p className="text-xs" style={secondary}>{t("ffSharedSilo", { count: row.sharedBatchCount })}</p>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>
                {row.runDownDate
                  ? formatDateShort(row.runDownDate)
                  : horizonTo
                    ? t("ffBeyondHorizon", { date: formatDateShort(horizonTo) })
                    : "—"}
              </TableCell>
              <TableCell className="whitespace-nowrap" style={secondary}>{formatDateShort(row.refillDate)}</TableCell>
              <TableCell className="whitespace-nowrap">
                <div className="flex items-center gap-1.5">
                  <span style={secondary}>{formatDateShort(row.requiredOn)}</span>
                  {row.overdue && <Badge variant="danger">{t("ffOverdue")}</Badge>}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right" style={primary}>{fmtKg(row.demandKg)}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export function FeedForecastStages({ stages, t }: { stages: StageBlock[]; t: Translate }) {
  if (!stages.length) return null;
  return (
    <section aria-label={t("ffStagesTitle")} className="flex flex-col gap-2">
      <p className="nf-text-caption">{t("ffStagesTitle")}</p>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {stages.map((s) => (
          <li
            key={s.batchId}
            className="rounded-[var(--radius-md)] border p-3 text-xs"
            style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)", color: "var(--text-secondary)" }}
          >
            <p className="text-sm font-medium" style={primary}>{s.shedCode ? `${s.batchNo} · ${s.shedCode}` : s.batchNo}</p>
            <p>{t("ffStageCurrent")}: {s.currentStageCode} ({formatDateShort(s.currentFrom)} – {formatDateShort(s.currentTo)})</p>
            <p>
              {t("ffStageNext")}: {s.nextStageCode ?? "—"}
              {s.nextStageCode ? ` (${formatDateShort(s.nextFrom)} – ${formatDateShort(s.nextTo)})` : ""}
            </p>
            <div className="flex items-center gap-1.5">
              <span>{t("ffStageChangeDate")}: {formatDateShort(s.stageChangeDate)}</span>
              {s.stageChangeOverdue && <Badge variant="warning">{t("ffStageChangeNotPosted")}</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Translations** — in `translations.ts` `en`, in the Feed Forecast panel block, change `ffColRunDown` to `"Scale of Silo Level (Run Down)"` and add:

```ts
    ffColItemNo: "Item No",
    ffColDaysOfStock: "Current No. of Days Stock",
    ffColFeedOutKg: "Feed incl. Wastage (Kg)",
    ffIndicative: "Indicative",
    ffSharedSilo: "Silo shared by {{count}} batches",
    ffBeyondHorizon: "Beyond {{date}}",
    ffWastageUsed: "Per Day Intake is heads × feed rate, without wastage. Run-down, refill dates and requisition quantities add each diet's wastage allowance ({{pcts}}), because wasted feed still leaves the silo.",
    ffWastageNone: "Per Day Intake is heads × feed rate. No wastage allowance is set on these diets, so run-down, refill dates and requisition quantities use the same rate.",
    ffStagesTitle: "Current and next stage",
    ffStageCurrent: "Current stage",
    ffStageNext: "Next stage",
    ffStageChangeDate: "Date of stage change",
    ffStageChangeNotPosted: "Due, not posted",
```

(`ffColDaysLeft`, `ffColDemandInRangeKg` and `ffLastsRange` stay — other language dictionaries carry them; nothing reads them after Task 10.)

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm nx test web -- feed-forecast-grid 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS. Typecheck `api,web` → PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/console/inventory/feed-format.ts apps/web/src/components/console/inventory/feed-forecast-grid.tsx apps/web/specs/feed-forecast-grid.spec.tsx apps/web/src/utils/translations.ts
git commit -m "feat(web): feed forecast grid and stage block per the field specification

The client's field specification fixes the report's columns and adds a
current/next stage block. The grid now follows its order with Item No,
Days of Stock with an Indicative mark and the silo-sharing count, run-down
'beyond' the horizon instead of 'lasts the range', DD/MM/YY dates, the
wastage allowance stated, and the feed that leaves the silo last. The stage
block lists each batch's stages and date of stage change, marking a change
that fell due and was not posted.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Web — planning date, views, reporting period and generate-year on the panel

Field spec, Report Filters: Primary Location (farm-bound users cannot change it — D13, unchanged), **Planning Date** (default today in the farm time zone — the panel sends nothing until the user picks one, so the API's farm-zone day applies, D16), **Range** Daily / Weekly / Reporting Period / Custom with the period's dates "not typed manually" (Q12). When the company has no periods, the Reporting Period view offers **Generate July–June periods** (Q9); the API refuses it without the `MASTER_DATA/REPORTING_PERIOD create` grant, and the panel shows that refusal.

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-forecast-query.ts`
- Create: `apps/web/specs/feed-forecast-query.spec.ts`
- Modify (replace whole file): `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Modify: `apps/web/specs/feed-forecast-panel.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts` (`en` only)

**Interfaces:**
- Consumes: Task 9's `FeedForecastGrid`, `FeedForecastStages`, `wastageNote`, `ReportRow`, `StageBlock`, `formatDateShort`; Task 7's `GET /feed-forecast` query and `GET /feed-forecast/periods`; Task 5's `POST /reporting-period/generate`.
- Produces:

```ts
export const FORECAST_VIEWS: readonly ['DAILY', 'WEEKLY', 'PERIOD', 'CUSTOM'];
export type ForecastView = (typeof FORECAST_VIEWS)[number];
export interface ForecastQueryState { farmId: string; view: ForecastView; planningDate: string; from: string; to: string; periodId: string }
export function forecastQueryString(s: ForecastQueryState): string;
export function businessYearStartOf(iso: string): number;
```

- [ ] **Step 1: Write the failing tests**

`apps/web/specs/feed-forecast-query.spec.ts`:

```ts
import { businessYearStartOf, forecastQueryString } from '../src/components/console/inventory/feed-forecast-query';

const base = { farmId: 'farm-1', view: 'CUSTOM' as const, planningDate: '', from: '', to: '', periodId: '' };

describe('forecastQueryString', () => {
  it('leaves blank fields to the API, so the planning date is the farm\'s today (D16)', () => {
    expect(forecastQueryString(base)).toBe('farmId=farm-1&view=CUSTOM');
  });
  it('sends what the user picked, per view', () => {
    expect(forecastQueryString({ ...base, planningDate: '2026-09-19', from: '2026-09-20', to: '2026-09-27' }))
      .toBe('farmId=farm-1&view=CUSTOM&planningDate=2026-09-19&from=2026-09-20&to=2026-09-27');
    expect(forecastQueryString({ ...base, view: 'WEEKLY', from: '2026-09-20', to: '2026-09-27' })).toBe('farmId=farm-1&view=WEEKLY&from=2026-09-20');
    expect(forecastQueryString({ ...base, view: 'PERIOD', from: '2026-09-20', periodId: 'p9' })).toBe('farmId=farm-1&view=PERIOD&periodId=p9');
  });
});

describe('businessYearStartOf (checkpoint 40, July–June)', () => {
  it('starts the year in July', () => {
    expect(businessYearStartOf('2026-09-23')).toBe(2026);
    expect(businessYearStartOf('2027-06-30')).toBe(2026);
    expect(businessYearStartOf('2026-07-01')).toBe(2026);
  });
});
```

`apps/web/specs/feed-forecast-panel.spec.tsx` — change the api mock to `jest.mock('../src/services/api-client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));`, add `const post = api.post as jest.Mock;`, and make `forecastCallCount` count only report calls:

```ts
function forecastCallCount(): number {
  return get.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/feed-forecast?')).length;
}
```

Replace `forecastResponse` with:

```ts
const forecastResponse = {
  success: true,
  message: 'Feed forecast retrieved successfully.',
  data: {
    planningDate: '2026-09-25',
    today: '2026-09-25',
    timeZone: 'Africa/Harare',
    view: 'CUSTOM',
    from: '2026-09-25',
    to: '2026-10-02',
    forecastFrom: '2026-09-25',
    horizonTo: '2026-11-09',
    period: null,
    farm: { id: 'farm-vil100', code: 'VIL100', name: 'VILLA FRANCA FARM' },
    rows: [
      {
        key: 'b10|item-1|VIL100/STORE-001|2026-09-25', batchId: 'b10', batchNo: 'BATCH-000010', shedCode: '', stageCode: 'WEANER',
        itemId: 'item-1', itemNo: 'FEED-WG', itemName: 'Weaner Grower Mash (18% CP)', sourceType: 'STORE', sourceCode: 'VIL100/STORE-001',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 35525.6, heads: 58, perDayIntakeKg: 127, wastagePct: 2.5,
        intakeKg: 127, demandKg: 130.175, daysOfStock: 108, sharedBatchCount: 3, indicative: false,
        runDownDate: null, refillDate: null, requiredOn: null, overdue: false,
      },
      {
        key: 'b20|item-2|VIL100/SILO-002|2026-09-25', batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', stageCode: 'DRY_SOW',
        itemId: 'item-2', itemNo: 'FEED-DS', itemName: 'Dry Sow Gestation Mash (14% CP)', sourceType: 'SILO', sourceCode: 'VIL100/SILO-002',
        date: '2026-09-25', dateTo: '2026-09-25', days: 1, currentInventoryKg: 200, heads: 40, perDayIntakeKg: 100, wastagePct: 0,
        intakeKg: 100, demandKg: 100, daysOfStock: 2, sharedBatchCount: 1, indicative: true,
        runDownDate: '2026-09-26', refillDate: '2026-09-24', requiredOn: '2026-09-22', overdue: true,
      },
    ],
    stages: [
      {
        batchId: 'b20', batchNo: 'BATCH-000020', shedCode: 'SHED-1', currentStageCode: 'DRY_SOW', currentFrom: '2026-09-01', currentTo: null,
        nextStageCode: null, nextFrom: null, nextTo: null, stageChangeDate: null, stageChangeOverdue: false,
      },
    ],
    flags: [
      { kind: 'HEADS_ASSUMED_FLAT', batchNo: 'BATCH-000010' },
      { kind: 'BATCH_SHED_UNKNOWN', batchNo: 'BATCH-000010' },
    ],
  },
};
```

and `routedGet` with a periods route:

```ts
function routedGet(overrides?: { location?: any; feedForecast?: () => Promise<any>; periods?: any }) {
  return (url: string) => {
    if (url.startsWith('/location')) return Promise.resolve(overrides?.location ?? farmList);
    if (url.startsWith('/feed-forecast/periods')) return Promise.resolve(overrides?.periods ?? { success: true, data: [] });
    return overrides?.feedForecast ? overrides.feedForecast() : Promise.resolve(forecastResponse);
  };
}
```

In `describe('FeedForecastPanel — tenant admin', …)`: add `post.mockReset();` to `beforeEach`, and replace these three tests:

```ts
  it('renders the field specification\'s 14 columns in order', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([
      'ffColBatchNo', 'ffColItemName', 'ffColItemNo', 'ffColShedNo', 'ffColPlanningDate', 'ffColSource',
      'ffColCurrentInventoryKg', 'ffColCurrentPigs', 'ffColPerDayIntakeKg', 'ffColDaysOfStock',
      'ffColRunDown', 'ffColDateToRefill', 'ffColRequiredOn', 'ffColFeedOutKg',
    ]);
  });

  it('shows Overdue, Indicative, the shared-silo count, "beyond" the horizon, the wastage note and the stage block', async () => {
    render(<FeedForecastPanel />);
    const table = await screen.findByRole('table');
    expect(within(table).getByText('ffOverdue')).toBeTruthy();
    expect(within(table).getByText('ffIndicative')).toBeTruthy();
    expect(within(table).getByText('ffSharedSilo:{"count":3}')).toBeTruthy();
    expect(within(table).getByText('ffBeyondHorizon:{"date":"09/11/26"}')).toBeTruthy();
    expect(screen.getByText('ffWastageUsed:{"pcts":"2.5%"}')).toBeTruthy();
    // The stage block: a <section aria-label> is a region (the notes below are a list too, so not getByRole('list')).
    expect(screen.getByRole('region', { name: 'ffStagesTitle' })).toBeTruthy();
  });
```

(replacing `'renders all 13 report columns in order'` and `'shows an Overdue badge for an overdue row and "Lasts the range" for a null run-down date'`), and

```ts
  it('says nothing is forecast before the planning date when the range ends before it (Q7)', async () => {
    get.mockImplementation(
      routedGet({
        feedForecast: () => Promise.resolve({
          success: true,
          data: { ...forecastResponse.data, from: '2026-09-10', to: '2026-09-20', forecastFrom: null, rows: [], stages: [], flags: [] },
        }),
      }),
    );
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(screen.getByText(/ffNoteRangeBeforePlanning/)).toBeTruthy();
    expect(screen.getByText(/ffNoRows/)).toBeTruthy();
  });
```

(replacing `'shows a note and "—" in the Run Down column when the range ends before the planning date'`). Append to the same describe:

```ts
  it('first asks for the Custom view with no dates, so the API plans from the farm\'s today (D16)', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    expect(get.mock.calls.find(([url]) => url.startsWith('/feed-forecast?'))![0]).toBe('/feed-forecast?farmId=farm-vil100&view=CUSTOM');
  });

  it('sends a picked planning date as the as-of date', async () => {
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    const input = screen.getByLabelText('ffPlanningDate') as HTMLInputElement;
    const earlier = new Date(`${input.value}T00:00:00Z`);
    earlier.setUTCDate(earlier.getUTCDate() - 3);
    const picked = earlier.toISOString().slice(0, 10);
    fireEvent.change(input, { target: { value: picked } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url.includes(`planningDate=${picked}`))).toBe(true));
  });

  it('the Reporting Period view lists the farm\'s periods and asks for the one covering the planning date', async () => {
    get.mockImplementation(routedGet({
      periods: { success: true, data: [{ periodId: 'p9', periodCode: '2026-09', startDate: '2026-08-30', endDate: '2026-09-26', stockTakeDate: '2026-09-26', productionStartDate: '2026-09-27' }] },
    }));
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast/periods?farmId=farm-vil100')).toBe(true));
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/feed-forecast?farmId=farm-vil100&view=PERIOD')).toBe(true));
    const select = screen.getByLabelText('ffReportingPeriod') as HTMLSelectElement;
    expect(within(select).getByText('ffPeriodOption:{"code":"2026-09","from":"30/08/26","to":"26/09/26"}')).toBeTruthy();
    expect(screen.queryByText(/ffGeneratePeriods/)).toBeNull();
  });

  it('offers to generate the business year when the company has no periods, then reloads (Q9)', async () => {
    post.mockResolvedValue({ success: true, data: { created: ['2026-07'], skipped: [] } });
    render(<FeedForecastPanel />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByLabelText('ffView'), { target: { value: 'PERIOD' } });
    const button = await screen.findByRole('button', { name: /ffGeneratePeriods/ });
    const periodCalls = () => get.mock.calls.filter(([url]) => url.startsWith('/feed-forecast/periods')).length;
    const before = periodCalls();
    fireEvent.click(button);
    // The response's planning date (25 Sep 2026) falls in the 2026–27 business year.
    await waitFor(() => expect(post).toHaveBeenCalledWith('/reporting-period/generate', { business_year_start: 2026 }));
    await waitFor(() => expect(periodCalls()).toBeGreaterThan(before));
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm nx test web -- feed-forecast-query feed-forecast-panel 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕|Cannot find"`
Expected: FAIL — no `feed-forecast-query` module; the panel still renders 13 columns and has no view select.

- [ ] **Step 3: Query helpers** — create `feed-forecast-query.ts`:

```ts
/**
 * Feed Forecast query per view (Plan R; field specification, Report Filters)
 * and the business year a date falls in — pure, so the panel's rules can be
 * tested without rendering it. A blank field is left out and the API applies
 * its default: in particular the planning date is then today in the farm's
 * time zone (spec D16), which the browser does not know.
 */
export const FORECAST_VIEWS = ["DAILY", "WEEKLY", "PERIOD", "CUSTOM"] as const;
export type ForecastView = (typeof FORECAST_VIEWS)[number];

export interface ForecastQueryState {
  farmId: string;
  view: ForecastView;
  planningDate: string;
  from: string;
  to: string;
  periodId: string;
}

export function forecastQueryString(s: ForecastQueryState): string {
  const p = new URLSearchParams({ farmId: s.farmId, view: s.view });
  if (s.planningDate) p.set("planningDate", s.planningDate);
  if (s.view === "PERIOD") {
    // Field spec: the period's From/To "are pulled from the Reporting Period Master, not typed manually".
    if (s.periodId) p.set("periodId", s.periodId);
  } else {
    if (s.from) p.set("from", s.from);
    if (s.view === "CUSTOM" && s.to) p.set("to", s.to);
  }
  return p.toString();
}

/** The July–June business year (checkpoint 40) a date falls in, named by the calendar year it starts in. */
export function businessYearStartOf(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return m >= 7 ? y : y - 1;
}
```

- [ ] **Step 4: Panel** — replace `feed-forecast-panel.tsx` with:

```tsx
"use client";

/**
 * Inventory -> Feed Forecast. Plan A built it (docx Section 3, D1–D6, D13,
 * D14); Plan R aligns it with the client's field specification of 26 Sep
 * (spec D16–D20): an as-of Planning Date (blank = today in the farm's time
 * zone, which only the API knows), Daily / Weekly / Reporting Period / Custom
 * views, a row per batch + item + date (grouped for Weekly and Reporting
 * Period), Item No, DD/MM/YY dates and the current / next stage block. The
 * grid and the stage block are feed-forecast-grid.tsx; the query per view is
 * feed-forecast-query.ts.
 *
 * Farm scope follows the same STANDARD_USER-is-fixed rule as
 * WorkspaceScopeSwitcher (D13): a STANDARD_USER's farm is
 * user_master.farm_id and is never a choice; every other user type picks
 * from the active tenant/company's farms, defaulting to whatever is already
 * pinned (getActiveFarmId()). The shared api client only sends
 * x-active-farm-id when a farm is pinned, so `farmId` is also sent as an
 * explicit query param — otherwise an admin with no farm pinned ("All
 * farms") gets the API's 400 "Select a farm." with no way to pick one here.
 */
import { useEffect, useRef, useState } from "react";
import { api } from "@/services/api-client";
import { InlineAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getActiveFarmId, getStoredUser } from "@/hooks/useAuth";
import { useLanguage } from "@/hooks/useLanguage";
import type { TranslationKeys } from "@/utils/translations";
import { formatDateShort, todayIso, unwrap } from "./feed-format";
import { FeedForecastGrid, FeedForecastStages, ReportRow, StageBlock, wastageNote } from "./feed-forecast-grid";
import { businessYearStartOf, forecastQueryString, FORECAST_VIEWS, ForecastView } from "./feed-forecast-query";

type ForecastFlag =
  | { kind: "NO_FEED_ROW"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "OVERLAPPING_FEED_ROWS"; batchNo: string; stageCode: string; day: number; date: string }
  | { kind: "NO_SILO_HOLDS_ITEM"; shedCode: string; itemName: string }
  | { kind: "STAGE_CHANGE_PROJECTED"; batchNo: string; stageCode: string; date: string }
  | { kind: "HEADS_ASSUMED_FLAT"; batchNo: string }
  | { kind: "BATCH_SHED_UNKNOWN"; batchNo: string }
  | { kind: "AS_OF_PAST"; planningDate: string; today: string };

interface PeriodOption {
  periodId: string;
  periodCode: string;
  startDate: string;
  endDate: string;
  stockTakeDate: string;
  productionStartDate: string;
}

interface ForecastData {
  planningDate: string;
  today: string;
  timeZone: string | null;
  view: ForecastView;
  from: string;
  to: string;
  forecastFrom: string | null;
  horizonTo: string;
  period: PeriodOption | null;
  farm: { id: string; code: string; name: string };
  rows: ReportRow[];
  stages: StageBlock[];
  flags: ForecastFlag[];
}

interface FarmItem {
  location_id: string;
  location_code: string;
  location_name: string;
}

const VIEW_LABEL: Record<ForecastView, TranslationKeys> = { DAILY: "ffViewDaily", WEEKLY: "ffViewWeekly", PERIOD: "ffViewPeriod", CUSTOM: "ffViewCustom" };

const inputStyle = { backgroundColor: "var(--input-bg)", color: "var(--input-text)", borderColor: "var(--input-border)" };

/**
 * Groups consecutive/duplicate NO_FEED_ROW / OVERLAPPING_FEED_ROWS flags for
 * the same batch+stage into one range sentence, so a gap spanning several
 * days reads as one line instead of one per day.
 */
function groupDayFlags(
  flags: Array<{ batchNo: string; stageCode: string; day: number; date: string }>
): Array<{ batchNo: string; stageCode: string; dayFrom: number; dayTo: number; dateFrom: string; dateTo: string }> {
  const seen = new Set<string>();
  const deduped = flags.filter((f) => {
    const key = `${f.batchNo}:${f.stageCode}:${f.day}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const sorted = [...deduped].sort((a, b) =>
    a.batchNo !== b.batchNo ? a.batchNo.localeCompare(b.batchNo) :
    a.stageCode !== b.stageCode ? a.stageCode.localeCompare(b.stageCode) :
    a.day - b.day
  );
  const groups: Array<{ batchNo: string; stageCode: string; dayFrom: number; dayTo: number; dateFrom: string; dateTo: string }> = [];
  for (const f of sorted) {
    const last = groups[groups.length - 1];
    if (last && last.batchNo === f.batchNo && last.stageCode === f.stageCode && f.day === last.dayTo + 1) {
      last.dayTo = f.day;
      last.dateTo = f.date;
    } else {
      groups.push({ batchNo: f.batchNo, stageCode: f.stageCode, dayFrom: f.day, dayTo: f.day, dateFrom: f.date, dateTo: f.date });
    }
  }
  return groups;
}

/** Turns the flags the engine and the service emit into the plain-English sentences shown below the grid. */
function buildFlagSentences(flags: ForecastFlag[], t: (key: any, vars?: any) => string): string[] {
  const sentences: string[] = [];

  const asOf = flags.find((f): f is Extract<ForecastFlag, { kind: "AS_OF_PAST" }> => f.kind === "AS_OF_PAST");
  if (asOf) sentences.push(t("ffFlagAsOfPast", { date: formatDateShort(asOf.planningDate), today: formatDateShort(asOf.today) }));

  const noFeedRow = flags.filter((f): f is Extract<ForecastFlag, { kind: "NO_FEED_ROW" }> => f.kind === "NO_FEED_ROW");
  for (const g of groupDayFlags(noFeedRow)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagNoFeedRowSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDateShort(g.dateFrom) })
        : t("ffFlagNoFeedRowRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDateShort(g.dateFrom), dateTo: formatDateShort(g.dateTo) })
    );
  }

  const overlapping = flags.filter((f): f is Extract<ForecastFlag, { kind: "OVERLAPPING_FEED_ROWS" }> => f.kind === "OVERLAPPING_FEED_ROWS");
  for (const g of groupDayFlags(overlapping)) {
    sentences.push(
      g.dayFrom === g.dayTo
        ? t("ffFlagOverlappingSingle", { stageCode: g.stageCode, day: g.dayFrom, batchNo: g.batchNo, date: formatDateShort(g.dateFrom) })
        : t("ffFlagOverlappingRange", { stageCode: g.stageCode, dayFrom: g.dayFrom, dayTo: g.dayTo, batchNo: g.batchNo, dateFrom: formatDateShort(g.dateFrom), dateTo: formatDateShort(g.dateTo) })
    );
  }

  const noSilo = new Map<string, { shedCode: string; itemName: string }>();
  for (const f of flags) if (f.kind === "NO_SILO_HOLDS_ITEM") noSilo.set(`${f.shedCode}:${f.itemName}`, f);
  for (const f of noSilo.values()) sentences.push(t("ffFlagNoSiloHoldsItem", { shedCode: f.shedCode, itemName: f.itemName }));

  const stageChanges = new Map<string, { batchNo: string; stageCode: string; date: string }>();
  for (const f of flags) if (f.kind === "STAGE_CHANGE_PROJECTED") stageChanges.set(`${f.batchNo}:${f.stageCode}:${f.date}`, f);
  for (const f of stageChanges.values()) sentences.push(t("ffFlagStageChangeProjected", { batchNo: f.batchNo, stageCode: f.stageCode, date: formatDateShort(f.date) }));

  const shedUnknownBatches = new Set(flags.filter((f) => f.kind === "BATCH_SHED_UNKNOWN").map((f) => (f as any).batchNo));
  for (const batchNo of shedUnknownBatches) sentences.push(t("ffFlagBatchShedUnknown", { batchNo }));

  // HEADS_ASSUMED_FLAT is raised for every batch unconditionally (D11) — one sentence covers all of them.
  if (flags.some((f) => f.kind === "HEADS_ASSUMED_FLAT")) sentences.push(t("ffFlagHeadsAssumedFlat"));

  return sentences;
}

export default function FeedForecastPanel() {
  const { t } = useLanguage();
  // t() is read inside effects and handlers, but the effects must not re-run
  // just because the translation function's identity changed (the test mock
  // and some callers hand back a new `t` on every render) — the tRef pattern.
  const tRef = useRef(t);
  tRef.current = t;

  const user = getStoredUser();
  const isStandardUser = user?.userType === "STANDARD_USER";

  const [farms, setFarms] = useState<FarmItem[]>([]);
  const [selectedFarmId, setSelectedFarmId] = useState<string>(() => getActiveFarmId() || "");
  // "" = the API's default for each: planning date = the farm's today (D16), from/to = the view's own range.
  const [view, setView] = useState<ForecastView>("CUSTOM");
  const [planningDate, setPlanningDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [periodId, setPeriodId] = useState("");
  const [periods, setPeriods] = useState<PeriodOption[] | null>(null);
  const [reload, setReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Non-STANDARD_USER types pick a farm; a STANDARD_USER's farm is fixed (D13).
  // farmsLoaded/farmsFailed distinguish "still loading" from "loaded, and
  // either empty or the request itself failed" (Plan A fix round 2).
  const [farmsLoaded, setFarmsLoaded] = useState(false);
  const [farmsFailed, setFarmsFailed] = useState(false);
  useEffect(() => {
    if (isStandardUser) return;
    let cancelled = false;
    api
      .get(`/location?locationType=FARM&rootOnly=true&isActive=true`)
      .then((res) => {
        if (cancelled) return;
        const rows = unwrap<FarmItem[]>(res);
        if (Array.isArray(rows)) setFarms(rows);
        else setFarmsFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFarmsFailed(true);
      })
      .finally(() => {
        if (!cancelled) setFarmsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [isStandardUser]);

  // A failed or empty farm list, or a stale pin, falls back to no selection
  // rather than a select showing a value that matches none of its options.
  useEffect(() => {
    if (isStandardUser || !selectedFarmId || !farmsLoaded) return;
    if (farmsFailed || !farms.some((f) => f.location_id === selectedFarmId)) setSelectedFarmId("");
  }, [farms, farmsLoaded, farmsFailed]);

  const farmId = isStandardUser ? getActiveFarmId() : selectedFarmId;

  // The Reporting Period view's choices, read under the report's own grant (a farm login has no Master Data grant).
  useEffect(() => {
    if (view !== "PERIOD" || !farmId) {
      setPeriods(null);
      return;
    }
    let cancelled = false;
    api
      .get(`/feed-forecast/periods?${new URLSearchParams({ farmId }).toString()}`)
      .then((res) => {
        if (cancelled) return;
        const list = unwrap<PeriodOption[]>(res);
        setPeriods(Array.isArray(list) ? list : []);
      })
      .catch(() => {
        if (!cancelled) setPeriods([]);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, reload]);

  useEffect(() => {
    if (!farmId) {
      setData(null);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get(`/feed-forecast?${forecastQueryString({ farmId, view, planningDate, from: dateFrom, to: dateTo, periodId })}`)
      .then((res) => {
        if (cancelled) return;
        setData(unwrap<ForecastData>(res));
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || tRef.current("ffFailedToLoad"));
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [farmId, view, planningDate, dateFrom, dateTo, periodId, reload]);

  function changeView(next: ForecastView) {
    setView(next);
    setDateFrom("");
    setDateTo("");
    setPeriodId("");
  }

  // Open question Q9: an admin drafts the July–June year from the month-end-Saturday rule, then edits it in the master.
  async function generatePeriods() {
    const year = businessYearStartOf(planningDate || data?.planningDate || todayIso());
    setGenerating(true);
    try {
      await api.post("/reporting-period/generate", { business_year_start: year });
      setReload((n) => n + 1);
    } catch (err: any) {
      setError(err?.message || tRef.current("ffGenerateFailed"));
    } finally {
      setGenerating(false);
    }
  }

  // Guard every list read off the response: an envelope that failed to
  // unwrap, or a payload missing a list, renders empty rather than crashing.
  const rows = Array.isArray(data?.rows) ? data!.rows : [];
  const stages = Array.isArray(data?.stages) ? data!.stages : [];
  const flagSentences = data ? buildFlagSentences(Array.isArray(data.flags) ? data.flags : [], t) : [];
  const periodList = Array.isArray(periods) ? periods : [];
  // Q7: nothing is forecast before the planning date.
  const rangeBeforePlanning = !!data && data.forecastFrom === null;
  const businessYear = businessYearStartOf(planningDate || data?.planningDate || todayIso());

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="nf-text-caption block" htmlFor="ff-farm">{t("ffPrimaryLocation")}</label>
          {isStandardUser ? (
            <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {user?.farm
                ? `${user.farm.location_code} — ${user.farm.location_name}`
                : data?.farm
                  ? `${data.farm.code} — ${data.farm.name}`
                  : "—"}
            </p>
          ) : (
            <select
              id="ff-farm"
              aria-label={t("ffPrimaryLocation")}
              value={selectedFarmId}
              onChange={(e) => setSelectedFarmId(e.target.value)}
              className="nf-input-sm nf-select"
              style={inputStyle}
            >
              <option value="">{t("ffSelectFarm")}</option>
              {farms.map((f) => (
                <option key={f.location_id} value={f.location_id}>
                  {f.location_code} — {f.location_name}
                </option>
              ))}
            </select>
          )}
        </div>

        <div>
          <label className="nf-text-caption block" htmlFor="ff-planning">{t("ffPlanningDate")}</label>
          <input
            id="ff-planning"
            type="date"
            value={planningDate || data?.planningDate || ""}
            onChange={(e) => setPlanningDate(e.target.value)}
            className="nf-input-sm"
            style={inputStyle}
          />
          {data && (
            <p className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
              {data.timeZone ? t("ffTimeZone", { zone: data.timeZone }) : t("ffServerDay")}
            </p>
          )}
        </div>

        <div>
          <label className="nf-text-caption block" htmlFor="ff-view">{t("ffView")}</label>
          <select id="ff-view" value={view} onChange={(e) => changeView(e.target.value as ForecastView)} className="nf-input-sm nf-select" style={inputStyle}>
            {FORECAST_VIEWS.map((v) => (
              <option key={v} value={v}>{t(VIEW_LABEL[v])}</option>
            ))}
          </select>
        </div>

        {view === "PERIOD" ? (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-period">{t("ffReportingPeriod")}</label>
            <select id="ff-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className="nf-input-sm nf-select" style={inputStyle}>
              <option value="">{t("ffPeriodCovering")}</option>
              {periodList.map((p) => (
                <option key={p.periodId} value={p.periodId}>
                  {t("ffPeriodOption", { code: p.periodCode, from: formatDateShort(p.startDate), to: formatDateShort(p.endDate) })}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-from">
              {t(view === "DAILY" ? "ffDate" : view === "WEEKLY" ? "ffWeekStart" : "ffDateFrom")}
            </label>
            <input
              id="ff-from"
              type="date"
              value={dateFrom || data?.from || ""}
              onChange={(e) => setDateFrom(e.target.value)}
              className="nf-input-sm"
              style={inputStyle}
            />
          </div>
        )}

        {view === "CUSTOM" && (
          <div>
            <label className="nf-text-caption block" htmlFor="ff-to">{t("ffDateTo")}</label>
            <input
              id="ff-to"
              type="date"
              value={dateTo || data?.to || ""}
              onChange={(e) => setDateTo(e.target.value)}
              className="nf-input-sm"
              style={inputStyle}
            />
          </div>
        )}
      </div>

      {view === "PERIOD" && !!farmId && periods !== null && periodList.length === 0 && (
        <InlineAlert variant="info">
          <span className="mr-3">{t("ffNoPeriods")}</span>
          <Button variant="outline" onClick={generatePeriods} disabled={generating}>
            {t("ffGeneratePeriods", { year: businessYear })}
          </Button>
        </InlineAlert>
      )}

      {error && <InlineAlert>{error}</InlineAlert>}

      {rangeBeforePlanning && !error && (
        <InlineAlert variant="info">{t("ffNoteRangeBeforePlanning", { date: formatDateShort(data!.planningDate) })}</InlineAlert>
      )}

      {error ? null : !farmId ? (
        <InlineAlert variant="info">{t("ffPickFarmPrompt")}</InlineAlert>
      ) : (
        <>
          <FeedForecastGrid rows={rows} loading={loading} horizonTo={data?.horizonTo ?? null} t={t} />
          {rows.length > 0 && !loading && (
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{wastageNote(rows, t)}</p>
          )}
          {!loading && <FeedForecastStages stages={stages} t={t} />}
        </>
      )}

      {flagSentences.length > 0 && (
        <div className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: "var(--border)", backgroundColor: "var(--surface)" }}>
          <p className="nf-text-caption mb-2">{t("ffNotesTitle")}</p>
          <ul className="list-disc space-y-1 pl-4 text-xs" style={{ color: "var(--text-secondary)" }}>
            {flagSentences.map((sentence, idx) => (
              <li key={idx}>{sentence}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Translations** — in `translations.ts` `en`, Feed Forecast panel block, change `ffNoteRangeBeforePlanning` to `"Nothing is forecast before the planning date ({{date}}). Move the planning date back to see those days."` and add:

```ts
    ffView: "View",
    ffViewDaily: "Daily",
    ffViewWeekly: "Weekly",
    ffViewPeriod: "Reporting Period",
    ffViewCustom: "Custom",
    ffDate: "Date",
    ffWeekStart: "Week Start",
    ffReportingPeriod: "Reporting Period",
    ffPeriodCovering: "Period covering the planning date",
    ffPeriodOption: "{{code}} ({{from}} – {{to}})",
    ffNoPeriods: "No reporting periods are set up for this company yet.",
    ffGeneratePeriods: "Generate July–June periods from July {{year}}",
    ffGenerateFailed: "Could not generate the reporting periods.",
    ffTimeZone: "Farm time zone: {{zone}}",
    ffServerDay: "No time zone is set for this company; today is the server's date.",
    ffFlagAsOfPast: "Balances are as of {{date}}. Batches, head counts and stages are today's ({{today}}) — the forecast has no head-count history to go back to.",
```

- [ ] **Step 6: Run to verify they pass**

Run: `pnpm nx test web -- feed-forecast 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Tests:|✕"` → PASS (query, grid, panel).
Run: `pnpm nx run-many -t typecheck -p api,web` → PASS.
Run: `pnpm nx lint web 2>&1 | grep -c " error "` → not above the Task 9 Step 0 count.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/console/inventory/feed-forecast-query.ts apps/web/specs/feed-forecast-query.spec.ts apps/web/src/components/console/inventory/feed-forecast-panel.tsx apps/web/specs/feed-forecast-panel.spec.tsx apps/web/src/utils/translations.ts
git commit -m "feat(web): feed forecast planning date, views and reporting periods

The panel showed a fixed planning date (the server's today) and a typed
From/To. The field specification makes the Planning Date an as-of choice
and the Range one of Daily, Weekly, Reporting Period or Custom, with a
period's dates taken from the Reporting Period Master. The panel now sends
only what the user picked, so the default planning date is the farm's
today (D16), lists the farm's periods, offers to generate a July-June year
when there are none, and renders the new grid and stage block.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 11: Prove it in MySQL by driving the API; record

The project rule: a number is proven by producing it through the running API and checking it against MySQL, not by a green suite. Everything below runs against `nf_devco`, through `http://localhost:2877/api/v1`, on one farm — VIL100 unless it has no silo holding feed, in which case the first farm that does (Plan B's verification used VIL100). Keep every command and its output; they go into the verification document. Do not start the web dev server or a browser; the page is Rishi's to look at in Brave.

**Files:**
- Create: `docs/VERIFICATION-2026-09-26-feed-forecast-r.md`
- Modify: `docs/decisions.md` (Plan R entry)

- [ ] **Step 1: Suites, migrations, build, restart.**
`pnpm nx test api --maxWorkers=2`, `pnpm nx test web --maxWorkers=2`, `pnpm nx run-many -t typecheck -p api,web` → all PASS; `pnpm nx lint web` → error count not above Task 9 Step 0's. `pnpm nx run api:db-migrate-all-tenants`. `pnpm nx run api:build`; restart the API by the PID from `lsof -ti :2877` (never `pkill`). Then:

```sql
SHOW COLUMNS FROM nf_devco.location_master LIKE 'feed_lead_time_days';            -- Default 2
SELECT feed_lead_time_days, COUNT(*) FROM nf_devco.location_master WHERE location_type='FARM' GROUP BY 1;  -- all 2
SHOW TABLES FROM nf_devco LIKE 'reporting_period';                                -- one table
```

- [ ] **Step 2: Session.** Credentials and scope headers are in `docs/HANDOFF-2026-09-14.md` §8 (company admin); do not paste the password into the verification document.

```bash
API=http://localhost:2877/api/v1
TOKEN=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -r '.data.accessToken // .data.access_token // .accessToken')
H=(-H "Authorization: Bearer $TOKEN" -H "x-tenant-id: $TENANT" -H "x-active-company-id: $COMPANY" -H "x-workspace-scope: COMPANY" -H 'Content-Type: application/json')
FARM=$(mysql … -N -e "SELECT location_id FROM nf_devco.location_master WHERE location_code='VIL100' AND location_type='FARM'")
```

- [ ] **Step 3: Planning date in the farm time zone (D16).**
`curl -s "$API/feed-forecast?farmId=$FARM&view=DAILY" "${H[@]}" | jq '.data | {planningDate, today, timeZone, from, to, horizonTo}'` → `timeZone` = `Africa/Harare`, `planningDate` = `today` = `TZ=Africa/Harare date +%F`, `from` = `to` = that day, `horizonTo` = that day + 45.

- [ ] **Step 4: Reporting Period Master (D20, Q9, Q10).**
`curl -s -X POST $API/reporting-period/generate "${H[@]}" -d '{"business_year_start":2026}'` → `created` has 12 codes (fewer only if periods already existed — record which). Then:

```sql
SELECT period_code, business_year, start_date, end_date, stock_take_date, production_start_date, DAYNAME(end_date) AS end_day
FROM nf_devco.reporting_period WHERE company_id = '<COMPANY>' ORDER BY start_date;
```

Expected: 2026-07 … 2027-06, each `end_day` Saturday, each `start_date` the day after the previous `end_date`, `2026-09` = 2026-08-30 → 2026-09-26, stock take 2026-09-26, production start 2026-09-27, business year 2026-27. Run the generate call again → `created: []`, twelve `already exists`, and the SELECT count unchanged.
Refusals: `POST $API/reporting-period` with `{"period_code":"VERIFY-FRI","start_date":"2030-01-06","end_date":"2030-02-22"}` → 400 "End Date must be a Saturday …" and no row (`SELECT COUNT(*) … WHERE period_code='VERIFY-FRI'` → 0); with `"period_code":"VERIFY-OVL","start_date":"2026-09-20","end_date":"2026-10-03"` → 409 naming `2026-09`.

- [ ] **Step 5: Current Inventory, intake and days of stock by hand (Q6, D17, D18).** Pick a silo of the farm that holds feed and has demand today:

```bash
curl -s "$API/feed-forecast?farmId=$FARM&view=DAILY" "${H[@]}" | jq '.data.rows[] | select(.sourceType=="SILO") | {batchNo, itemNo, sourceCode, currentInventoryKg, heads, perDayIntakeKg, wastagePct, demandKg, daysOfStock, sharedBatchCount, indicative, runDownDate, refillDate, requiredOn, overdue}'
```

Call the silo `$SILO` (its `location_id`) and its item `$ITEM`. From the ledger:

```sql
-- Opening System Balance of the planning date (everything posted before it) …
SELECT SUM(quantity) FROM nf_devco.inventory_ledger
WHERE warehouse_id='$SILO' AND item_id='$ITEM' AND entry_type IN ('POSITIVE','NEGATIVE') AND posting_date < '<planningDate>';
-- … plus today's posted non-feeding movements (receipts, transfers, adjustments), which are that day's incoming:
SELECT SUM(quantity) FROM nf_devco.inventory_ledger
WHERE warehouse_id='$SILO' AND item_id='$ITEM' AND entry_type IN ('POSITIVE','NEGATIVE') AND posting_date = '<planningDate>'
  AND document_type <> 'BATCH' AND transaction_type <> 'CONSUMPTION';
-- The feed rate and wastage of the batch's diet today:
SELECT b.batch_no, b.closing_quantity, b.opening_quantity, l.feed_qty_per_head_per_day_kg, l.feed_wastage_pct
FROM nf_devco.batch_header b JOIN nf_devco.breed_lifecycle_stages l ON l.breed_id = b.breed_id AND l.feed_item_id = '$ITEM'
WHERE b.batch_no = '<batchNo>';
```

Expected: `currentInventoryKg` = first sum + second sum (NULL = 0); `perDayIntakeKg` = heads × rate (no wastage); `demandKg` = heads × rate × (1 + wastage/100); `daysOfStock` = floor(`currentInventoryKg` ÷ the sum of `demandKg` of every row with this `sourceCode` and `itemNo` today); `sharedBatchCount` = that number of rows. Write the arithmetic out.

- [ ] **Step 6: Run-down to the low level (D19, Q1).** Note `$SILO`'s `low_level_kg` (restore it at the end). `PUT $API/location/$SILO` with `low_level_kg` = today's `currentInventoryKg` − 1 × that day's silo demand (so the first day closes exactly on it) → read back `SELECT low_level_kg FROM nf_devco.location_master WHERE location_id='$SILO'`. `GET /feed-forecast?farmId=$FARM&view=CUSTOM` → the silo's `runDownDate` = the planning date (closes at the level on day one, "at or below"), `refillDate` = −2 days, `requiredOn` = −4 days (buffer 2, lead 2 from 0120), `overdue` true. Set `low_level_kg` to NULL → `runDownDate` is the first day the balance reaches zero — check it against a day-by-day subtraction of the silo's daily demand, written out.

- [ ] **Step 7: A booked transfer counts as incoming (Q2), and cancelling it takes it back out.** Note the silo's `runDownDate` (no low level) as R0. Create — do not post — a transfer from the farm's STORE into `$SILO` of `$ITEM`, dated two days after the planning date, of one day's silo demand × 3:

```bash
curl -s -X POST $API/stock-transfer "${H[@]}" -d "{\"company_id\":\"$COMPANY\",\"from_warehouse_id\":\"$STORE\",\"to_warehouse_id\":\"$SILO\",\"posting_date\":\"<planning+2>\",\"remarks\":\"Plan R verification — not to be posted\",\"lines\":[{\"item_id\":\"$ITEM\",\"quantity\":<3 x daily>,\"uom\":\"KG\"}]}"
```

`SELECT status, posting_date FROM nf_devco.stock_transfer WHERE transfer_id='<id>'` → `DRAFT`. `GET /feed-forecast?farmId=$FARM&view=CUSTOM` → `.data.sources[]` for `$SILO`: `incomingKg` = the quantity (if the date is after the planning date and within `to`), and the silo's `runDownDate` is R0 + 3 days when R0 was on or after the transfer date (earlier than that, it stays R0 — Review Focus 4). `DELETE $API/stock-transfer/<id>` → `SELECT status FROM … WHERE transfer_id='<id>'` → `CANCELLED`; the forecast returns to R0 and `incomingKg` 0. The ledger is untouched: `SELECT COUNT(*) FROM nf_devco.inventory_ledger WHERE document_no = '<transfer_no>'` → 0.

- [ ] **Step 8: Back-dated planning date (Q8).** `GET /feed-forecast?farmId=$FARM&view=DAILY&planningDate=<today−7>` → the silo row's `currentInventoryKg` = `SELECT SUM(quantity) … posting_date < '<today−7>'` plus that day's non-feeding movements (Step 5's two queries with the date changed); `.data.flags` contains `AS_OF_PAST`. `planningDate=<today−46>` → 400 "The planning date must be within 45 days of today (…)".

- [ ] **Step 9: Views never change the numbers (workbook row 20).** Take `from` = the planning date:

```bash
curl -s "$API/feed-forecast?farmId=$FARM&view=CUSTOM&from=<P>&to=<P+6>" "${H[@]}" | jq '[.data.rows[] | {k:(.batchNo+"|"+.itemNo+"|"+(.sourceCode//"")), d:.demandKg}] | group_by(.k) | map({k:.[0].k, d:(map(.d)|add)})'
curl -s "$API/feed-forecast?farmId=$FARM&view=WEEKLY&from=<P>" "${H[@]}" | jq '[.data.rows[] | {k:(.batchNo+"|"+.itemNo+"|"+(.sourceCode//"")), d:.demandKg, days}]'
```

→ the same keys and the same kilograms (to the gram); a batch whose diet changes in the week has two WEEKLY rows. `view=PERIOD` → `.data.period.periodCode` = the period covering the planning date, `from`/`to` its dates, `forecastFrom` the planning date. A period over the horizon: `POST $API/reporting-period` `{"period_code":"VERIFY-LONG","start_date":"2030-01-06","end_date":"2030-02-23"}` → 201; `GET /feed-forecast?farmId=$FARM&view=PERIOD&periodId=<its id>` → 400 "Reporting period VERIFY-LONG runs 49 days (2030-01-06 to 2030-02-23); the forecast covers at most 46."; then `DELETE $API/reporting-period/<its id>` → `SELECT is_active FROM nf_devco.reporting_period WHERE period_code='VERIFY-LONG'` → 0 (kept as evidence, inactive). `GET $API/feed-forecast/periods?farmId=$FARM` → the twelve generated periods, not VERIFY-LONG.

- [ ] **Step 10: Stage block.** `.data.stages[]` for one batch: `currentFrom` = its scheduler header's `effective_from` for the current stage (`SELECT effective_from FROM nf_devco.scheduler_header WHERE batch_id='<id>' AND stage_id='<stage>'`, else `batch_header.start_date`); `currentTo` = `currentFrom` + `stage_master.typical_duration_days` − 1; `nextStageCode` = the `next_stage_id`'s code; `stageChangeDate` = `currentTo` + 1. Write the arithmetic out.

- [ ] **Step 11: The requisition drafts the same numbers (Task 8).** `curl -s -X POST $API/feed-requisition/auto-draft "${H[@]}" -d "{\"farmId\":\"$FARM\"}"` → note `requisitionId`. `GET /feed-forecast?farmId=$FARM&view=CUSTOM` → `.data.sources[]` for one drafted silo: `shortfallKg`, `requiredOn`, `runDownDate`. Then:

```sql
SELECT d.location_code, l.unrounded_need_kg, l.recommended_qty_kg, l.first_shortage_date, l.proposed_delivery_date
FROM nf_devco.requisition_line l JOIN nf_devco.location_master d ON d.location_id = l.destination_location_id
WHERE l.requisition_id = '<id>' ORDER BY l.line_seq;
```

→ `unrounded_need_kg` = `shortfallKg`; `recommended_qty_kg` = ceil(shortfall ÷ 3000) × 3000 (BULK); `first_shortage_date` = `runDownDate`; `proposed_delivery_date` = `requiredOn`, or the planning date if `requiredOn` is earlier. `POST $API/feed-alert/evaluate` with `{"farmId":"$FARM"}` → 200 with no `forecastError`.

- [ ] **Step 12: Restore and record.** Put `$SILO`'s `low_level_kg` back to Step 6's value and read it back. Leave the generated periods (they are the farm's first draft — say so to Rishi), the cancelled transfer, the inactive VERIFY-LONG period and the requisition as evidence; list their ids. Write `docs/VERIFICATION-2026-09-26-feed-forecast-r.md`: each step's command, the SQL, its output, the hand arithmetic of Steps 5, 6, 10 and 11, and anything not exercised and why (for example: no batch changes diet within the week on this farm). Add to `docs/decisions.md` a "Feed Forecast Plan R — defaults awaiting Rishi" entry listing Q1–Q14 with the default each uses and the date.

- [ ] **Step 13: Commit**

```bash
git add docs/VERIFICATION-2026-09-26-feed-forecast-r.md docs/decisions.md
git commit -m "docs: feed forecast plan R verification against nf_devco

The planning date followed the company's Harare time zone; a July-June
year of reporting periods generated with every End on a Saturday and
regenerated without duplicates; Current Inventory, intake, days of stock
and the stage block matched the ledger and Stage Master by hand; the low
level and a booked transfer moved the run-down and cancelling the
transfer moved it back; weekly totals equalled the daily ones; the
auto-drafted requisition carried the forecast's shortfall and Required On.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec decision / source requirement | Task |
|---|---|
| D16 one row per Batch + Feed Item + date; diet change → separate rows, never blended | 3, 4 |
| D16 grouped for Weekly / Reporting Period; "Date grouping never changes underlying daily calculation" (Engine row 20, Step 6) | 4, 7 |
| D16 Planning Date selectable as-of, default today in the farm time zone (Africa/Harare) | 1, 6, 7, 10 |
| D16 views Daily, Weekly, Reporting Period, Custom (Engine row 67) | 4, 7, 10 |
| D16 Item No column; dates DD/MM/YY | 3, 6, 9 |
| D16 current / next stage block with Date of Stage Change (field spec supporting block) | 7, 9 |
| D16 Days of Stock "indicative" when a diet or rate change falls inside the window | 3, 9 |
| D17 Per Day Intake without wastage; run-down, refill and requisition with wastage; the screen states the allowance | 3, 8, 9 |
| D18 Days of Stock at silo level, floor; shared-silo count | 3, 9 |
| D19 Run-Down to Below Feed Level or zero, with confirmed incoming | 2, 6 |
| D19 Date to Refill = Run-Down − buffer (default 2); Required On = Refill − lead (default 2 — migration 0120); overdue vs the Planning Date | 1, 2, 9 |
| D19 flows to the requisition (first shortage, quantity, line date) | 2, 8 |
| D20 Reporting Period Master: Period Code, Start, End (month-end Saturday), Stock Take Date, Production Start (Sunday after), July–June year; CRUD; generate-a-year | 5, 10 |
| D20 Reporting Period view takes From/To from the master | 7, 10 |
| Checkpoint 15: 45-day horizon, validated for a Reporting Period selection | 4, 7 |
| Field spec: Current Inventory = System Balance as of the Planning Date, never "physical stock" | 6, 9 |
| Field spec: Primary Location auto for a farm user, not editable (D13) | unchanged, 10 keeps it |
| DIET_CHANGE alerts consistent with the report (same planning day, same diet-change walk) | 1, 2 |
| D1–D15 still bind (worked example numbers, D9 sources, D11 flat heads, D13 scope, D15 day ranges) | 2, 3 (Plan A/B suites kept green) |
| Batch numbering | out of scope (Rishi, 26 Sep) |
| Stock take, period close, run versions, Transfer Orders | Plans C/D — not here |
