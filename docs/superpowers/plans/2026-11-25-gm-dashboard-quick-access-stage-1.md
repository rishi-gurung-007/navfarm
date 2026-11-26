# GM Dashboard Quick Access (Stage 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stage 1 items on the GM Dashboard open the page holding their records, filtered to the dashboard's farm and dates.

**Architecture:** One pure module builds every dashboard link; widgets only receive hrefs. Each target page reads its filters from the link into its own existing filter state. Where a page cannot yet filter that way, its list API gains the filter, reusing the dashboard's own rule.

**Tech Stack:** Nx monorepo; Next.js app router (`apps/web`); NestJS + Drizzle + MySQL (`apps/api`); Jest.

**Spec:** `docs/superpowers/specs/2026-11-25-gm-dashboard-quick-access-design.md`

## Global Constraints

- Month = period `start_date`..`to`; YTD = `ytd_from`..`to`. Matrix rows, alerts and the Kg Meat main figure use Month.
- All Farms passes no farm filter. Custom range passes the chosen dates and has no Budget links.
- No view permission (`canOpen(user, href)` in `apps/web/src/utils/nav-permissions.ts`) means no link. Blank figures stay clickable.
- Stage 2 items (Farrowing Rate and every Weaner–Grower row, and their alerts) look as they do today: no pointer, hover or link.
- Link parameters: `farmId`, `from`, `to`; plus `salesOnly=true` (Bio-Asset Ledger), `status=IMPORTED` (Kill Sheets), `status=POSTED` and `accounts=4600|4610` (Journal), `filter[period_code]`, `filter[farm_name]`, `filter[metric_label]` (Budget).
- Arrived filters show in the page's own controls and can be changed or cleared. A visit without parameters behaves as today. A farm in a link never widens API scope.
- No change to how any dashboard figure is calculated. New UI strings go in the `en` dictionary only (`apps/web/src/utils/translations.ts`).
- Do not commit or push unless Rishi asks. Leave the unrelated working-tree changes (zip deletion, untracked files) alone.
- Run nx as `env -u NX_WORKSPACE_ROOT_PATH pnpm nx …`, with `--maxWorkers=2`.
- Known failures before this work: 2 in `feed-forecast-panel.spec.tsx`, 2 `checkMating` web tests, 1 breeding-controller permission test (API). Add none.

## Review Focus

1. Opening a target by in-app click: the **first** list request already carries the filters; no unfiltered request lands afterwards and replaces the rows (Tasks 4–7).
2. Clearing a filter on a target page: it stays cleared and the link does not re-apply it (Task 4).
3. A farm-restricted user opening a link with another farm's id: sees nothing extra (Tasks 3–5).
4. A hand-edited link (`from=abc`, unknown account): the bad value is ignored and the page works (Task 1).
5. Overheads on All Farms: the dashboard counts only lines on its farms' cost centres, but the Journal with no farm filter also lists other overhead entries. Expected: Task 9 measures and reports the difference; no silent claim that totals match.

---

### Task 1: Link builder and link reader

**Files:**
- Create: `apps/web/src/components/console/piggery/gm-drill-links.ts`
- Create: `apps/web/src/hooks/useDrillParams.ts`
- Test: `apps/web/specs/gm-drill-links.spec.ts`

**Interfaces (produces):**
```ts
export type Span = 'month' | 'ytd';
export interface DrillFarm { farm_id: string; farm_name: string }
export interface DrillContext {
  period: { period_code: string; start_date: string; ytd_from: string; to: string };
  custom: boolean;
  /** Whether the dashboard has sales figures for this farm (null = all farms) and span. */
  hasSales: (span: Span, farmId: string | null) => boolean;
}
export function drillHref(key: string, span: Span, ctx: DrillContext, farm: DrillFarm | null): string | null;
export function budgetHref(key: string, span: Span, ctx: DrillContext, farm: DrillFarm | null): string | null;
export function profitLossHref(ctx: DrillContext, farm: DrillFarm | null): string | null;

export interface DrillParams { farmId: string; from: string; to: string; status: string; salesOnly: boolean; accounts: string[] }
export function parseDrillParams(q: { get(name: string): string | null }): DrillParams; // invalid -> '' / false / []
export function useDrillParams(): DrillParams; // parseDrillParams(useSearchParams()), frozen at first render
```

`drillHref` routes, by dashboard key:

| Keys | Route and extras |
|---|---|
| `pigs_to_slaughter`, when `hasSales` | `/inventory/bio-asset-ledger?salesOnly=true` |
| `pigs_to_slaughter`, otherwise | `/batches/kill-sheets?status=IMPORTED` |
| `cost_of_sales`, `gross_margin`, `gross_margin_pct` | `/inventory/bio-asset-ledger?salesOnly=true` |
| `avg_cdm`, `cos_per_tonne`, `kg_sold_per_sow_year` | `/batches/kill-sheets?status=IMPORTED` |
| `other_overheads` / `staff_overheads` | `/finance/journal?status=POSTED&accounts=4600` / `4610` |
| `total_born_per_litter`, `born_alive_per_litter`, `pre_wean_mortality_pct`, `weaned_per_sow`, `avg_wean_weight_kg`, `litter_mass_kg` | `/reports/farrowing` |
| anything else | `null` |

`budgetHref` → `/master-data/budget` for the nine keys that are budget metrics (all card keys plus `kg_sold_per_sow_year`), `null` when `custom`. `filter[metric_label]` uses the API's labels (`budget-metrics.ts`): Pigs to Slaughter, Avg CDM, Cost of Sales, **COS per tonne**, Gross Margin, Gross Margin %, Other Overheads, Staff Overheads, Kg Meat Sold / Sow / Year. A YTD budget is a sum of several periods' lines, so span `ytd` omits `filter[period_code]`.

- [ ] **Step 1: Write the failing tests** (`ctx` = period `2026-11`, start `2026-10-25`, ytd_from `2026-06-28`, to `2026-11-21`; `hasSales` true)

```ts
const q = (href: string) => Object.fromEntries(new URL(href, 'http://x').searchParams);
const path = (href: string) => new URL(href, 'http://x').pathname;
it('passes month or ytd dates and the farm; All Farms passes none', () => {
  expect(q(drillHref('cost_of_sales', 'month', ctx, { farm_id: 'g', farm_name: 'G' })!))
    .toEqual({ salesOnly: 'true', farmId: 'g', from: '2026-10-25', to: '2026-11-21' });
  expect(q(drillHref('cost_of_sales', 'ytd', ctx, null)!))
    .toEqual({ salesOnly: 'true', from: '2026-06-28', to: '2026-11-21' });
});
it('sends pigs to kill sheets only without sales', () => {
  expect(path(drillHref('pigs_to_slaughter', 'month', ctx, null)!)).toBe('/inventory/bio-asset-ledger');
  expect(path(drillHref('pigs_to_slaughter', 'month', { ...ctx, hasSales: () => false }, null)!)).toBe('/batches/kill-sheets');
});
it('gives stage 2 measures no link', () => {
  for (const k of ['farrowing_rate_pct','weight_70_day','gain_70_day','fce_weaner','weaner_mortality','fce_grower','grower_mortality'])
    expect(drillHref(k, 'month', ctx, null)).toBeNull();
});
it('filters the budget by period, farm and metric; ytd drops the period; custom range has none', () => {
  expect(q(budgetHref('cos_per_tonne', 'month', ctx, { farm_id: 'g', farm_name: 'MULTIPLIER (Triple C)' })!))
    .toEqual({ 'filter[period_code]': '2026-11', 'filter[farm_name]': 'MULTIPLIER (Triple C)', 'filter[metric_label]': 'COS per tonne' });
  expect(q(budgetHref('avg_cdm', 'ytd', ctx, null)!)).toEqual({ 'filter[metric_label]': 'Avg CDM' });
  expect(budgetHref('avg_cdm', 'month', { ...ctx, custom: true }, null)).toBeNull();
});
it('opens profit and loss only on All Farms, with ytd dates', () => {
  expect(q(profitLossHref(ctx, null)!)).toEqual({ from: '2026-06-28', to: '2026-11-21' });
  expect(profitLossHref(ctx, { farm_id: 'g', farm_name: 'G' })).toBeNull();
});
it('ignores bad link values', () => {
  expect(parseDrillParams(new URLSearchParams('from=abc&to=2026-02-30&accounts=4600,drop&salesOnly=yes&status=a%20b')))
    .toEqual({ farmId: '', from: '', to: '', status: '', salesOnly: false, accounts: ['4600'] });
});
```
Valid values: dates are real `YYYY-MM-DD`; accounts match `^\d{3,10}$`; status matches `^[A-Z_]+$`; farmId matches `^[A-Za-z0-9-]{1,36}$`.

- [ ] **Step 2: Run** `env -u NX_WORKSPACE_ROOT_PATH pnpm nx test web --testPathPatterns=gm-drill-links --maxWorkers=2` — FAIL, module not found.
- [ ] **Step 3: Implement** both files to the interfaces above.
- [ ] **Step 4: Run again** — PASS.

### Task 2: Alerts carry the metric key

**Files:** Modify `apps/api/src/modules/piggery/analytics/gm-dashboard.metrics.ts` (`Alert` and `FarmAlert` builders), the service's own alert push near line 910 if it builds one, and web types in `gm-dashboard-widgets.tsx`. Test: `gm-dashboard.metrics.spec.ts`.

**Interfaces (produces):** `Alert.metric_key: string`, `FarmAlert.metric_key: string` — the row's `key`.

- [ ] **Step 1:** Add to the existing alert and `farmAlerts` specs: `expect(out[0].metric_key).toBe(row.key)` (use each test's own row).
- [ ] **Step 2:** Run `… nx test api --testPathPatterns=gm-dashboard.metrics --maxWorkers=2` — FAIL (`undefined`).
- [ ] **Step 3:** Set `metric_key: row.key` in every builder.
- [ ] **Step 4:** Run again — PASS.

### Task 3: Bio-Asset Ledger — farm and sales only

**Files:**
- Create: `apps/api/src/modules/inventory/bio-asset-ledger/sold-documents.sql.ts`
- Modify: `apps/api/src/modules/piggery/analytics/piggery-analytics.service.ts` (`soldDisposals`, ~line 1070), `bio-asset-ledger.service.ts` (`entries`), `dto/bio-asset-ledger.dto.ts` (`QueryBioAssetLedgerEntriesDto`; export DTO inherits or gets the same two fields)
- Modify: `apps/web/src/components/console/inventory/bio-asset-ledger-panel.tsx`
- Test: `bio-asset-ledger.service.spec.ts`; create `apps/web/specs/bio-asset-ledger-drill.spec.tsx`

**Interfaces:**
- Consumes: `useDrillParams()`.
- Produces: `saleDocumentsSql(tenantId: string, companyId: string | undefined, from?: string, to?: string): SQL` — the `p` subquery now inside `soldDisposals` (`doc_key, d, proceeds`; same source types, `POSTED`, description rule, grouping), with each date bound optional. Query fields `farmId?: string` (UUID), `salesOnly?: 'true' | 'false'`.

Behaviour of `entries` (and therefore export):
- `farmId`: only rows whose batch (`bio_asset_ledger.batch_id` → `batch_header.farm_id`) is on that farm. Added on top of `scopeConditions()`, never instead.
- `salesOnly=true`: events = `TRANSFORMATION` only (today's event list excludes it, so the page shows no sales at all now); only rows whose `document_no` is in `saleDocumentsSql`; `dateFrom`/`dateTo` bound the **sale journal date**, not `posting_date`.

- [ ] **Step 1: Failing API tests**, rendering the captured WHERE with `MySqlDialect` as the existing spec does: (a) `entries({ farmId })` → SQL contains `batch_header` and `farm_id`, params contain the id, and for a restricted scope the existing company/LOB predicates are still present; (b) `entries({ salesOnly: 'true', dateFrom: '2026-10-25', dateTo: '2026-11-21' })` → SQL contains `journal_header` and `SLAUGHTER_TO`'s bound value, and contains no `` `bio_asset_ledger`.`posting_date` >= ``; (c) `entries({})` → no `journal_header`.
- [ ] **Step 2:** Run `… --testPathPatterns='bio-asset-ledger.service|piggery-analytics' ` on api — the new tests FAIL.
- [ ] **Step 3:** Extract `saleDocumentsSql`, use it in `soldDisposals` (analytics tests must stay green), then add the two filters.
- [ ] **Step 4:** Run again — PASS.
- [ ] **Step 5: Failing web test:** with `useSearchParams` returning `salesOnly=true&farmId=f1&from=2026-10-25&to=2026-11-21`, the first `/bio-asset-ledger/entries` call contains all four (`dateFrom`, `dateTo`); the farm and "Sales only" controls show them; turning "Sales only" off re-requests without `salesOnly`.
- [ ] **Step 6:** Implement: state initialised from `useDrillParams()`; add a Farm field (farms from `/location?locationType=FARM&rootOnly=true&isActive=true`) and a "Sales only" checkbox beside the existing filters; include both in `filterParams`, effect dependencies, "has active filters" and clear.
- [ ] **Step 7:** Run — PASS.

### Task 4: Kill Sheets — dates

**Files:** Create `apps/api/src/modules/production/kill-sheets/kill-sheet-window.ts`; modify `kill-sheets.dto.ts`, `kill-sheets.service.ts` (`list`), `piggery-analytics.service.ts` (`slaughterByFarm`, ~line 980), `apps/web/src/app/(app)/batches/kill-sheets/page.tsx`. Tests: `kill-sheets.service.spec.ts`; create `apps/web/specs/kill-sheets-drill.spec.tsx`.

**Interfaces (produces):** `killSheetWindow(from?: string, to?: string): SQL | undefined`; query fields `date_from?`, `date_to?` (`@IsDateString`).

Rule (moved from `slaughterByFarm`): with `slaughter_from`: `slaughter_from <= to 23:59:59` and `coalesce(slaughter_to, slaughter_from) >= from 00:00:00`; without it: `coalesce(confirmed_at, created_at)` within those bounds. One bound alone applies only its own side. `slaughterMetrics` (~line 1475) has its own variant and is **not** changed.

- [ ] **Step 1:** Failing API tests: `list({ date_from, date_to })` WHERE contains `slaughter_from`, `confirmed_at` and both bounds in params, for **both** the rows and the count query; `list({})` has neither. A farm-scoped caller passing another `farm_id` still has the scope's farm predicate.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement; point `slaughterByFarm` at the helper. **Step 4:** Run api `kill-sheets|piggery-analytics` — PASS.
- [ ] **Step 5:** Failing web tests: with `status=IMPORTED&farmId=f1&from=2026-10-25&to=2026-11-21`, the first `/kill-sheets?` call has `status=IMPORTED&farm_id=f1&date_from=…&date_to=…`; every later call keeps them until changed; after **Clear Filters** the next call has none of them and none returns after a further re-render.
- [ ] **Step 6:** Implement: initial state from `useDrillParams()`; two `DateInput`s ("Slaughtered from/to"); include them in the request, dependencies, page reset, Clear Filters and the empty-state condition.
- [ ] **Step 7:** Run — PASS.

### Task 5: Journal — farm and overhead accounts

**Files:** Modify `finance/journal/dto/journal.dto.ts`, `journal.service.ts` (`findAll`), `components/console/finance/journal-panel.tsx`. Tests: create `journal-list-filters.spec.ts` beside the service; create `apps/web/specs/journal-panel-drill.spec.tsx`.

**Interfaces (produces):** `QueryJournalDto.accountCodes?: string` (comma list of `^\d{3,10}$`), `farmId?: string` (UUID).

Behaviour: a journal matches when **one line** satisfies both: its GL account code is in `accountCodes` (if given) and its cost centre code is `CC-<location_code of farmId>` (if given) — one `EXISTS` over `journal_line`. Header filters (tenant, company, deleted, status, dates) stay. An unknown `farmId` returns no rows, not all rows.

- [ ] **Step 1:** Failing API tests on the rendered WHERE: both filters in a single `exists`; each alone; neither → no `exists`; unknown farm → empty result.
- [ ] **Step 2:** Run api `journal` — FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Failing web test: with `status=POSTED&accounts=4600&farmId=f1&from=…&to=…`, the first `/journal?` call has `status=POSTED&accountCodes=4600&farmId=f1&dateFrom=…&dateTo=…`; choosing "All accounts" and "All farms" drops them. Keep `journal-panel-open-by-no.spec.tsx` green.
- [ ] **Step 6:** Implement: initial state from `useDrillParams()` (`?no=` handling unchanged); a Farm select and an Account select (All accounts, 4600, 4610, shown with names from the loaded GL accounts) beside Status.
- [ ] **Step 7:** Run — PASS.

### Task 6: Budget master — column filters from the link

**Files:** Modify `apps/web/src/modules/master-data/MasterDataTable.tsx` (state ~line 718 and the `config.key` reset effect ~line 1140). Test: create `apps/web/specs/master-data-link-filters.spec.tsx`.

**Interfaces (produces):** `linkColumnFilters(params: URLSearchParams, config: MasterDataConfig): Record<string, string>` — `filter[<key>]` entries whose key is one of `config.columns`; exported from a new small file `modules/master-data/link-filters.ts`.

The reset effect runs on mount and would wipe the filters: set both `colFilters` and `filterDraft` to `linkColumnFilters(...)` there instead of `{}`. Apply this only for the master the link arrived on; switching to another master starts empty.

- [ ] **Step 1:** Failing tests: render with `BUDGET_CONFIGS[0]` and the three parameters → first `/piggery/budget?` call has all three (decoded); the filter drawer shows them; Reset removes them from the next call; an unknown `filter[nope]` is not sent.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS, plus `budget-configs.spec.ts` and `… --testPathPatterns=master-data`.

### Task 7: Farrowing Report and Profit & Loss read the link

**Files:** Modify `reports/farrowing-report-panel.tsx`, `finance/profit-loss-panel.tsx`. Tests: extend `farrowing-report-panel.spec.tsx`; create `apps/web/specs/profit-loss-drill.spec.tsx`.

- [ ] **Step 1:** Failing tests: (a) farm + dates in the link → one `/reports/farrowing?farmId=f1&dateFrom=…&dateTo=…` request without pressing Generate; (b) dates only → dates filled, farm **empty** (not the active farm), no report request; choosing a farm does not auto-run; (c) no link → today's defaults; (d) P&L: first `/financial-reports/profit-loss` call uses the link dates, and only that one call is made.
- [ ] **Step 2:** Run — FAIL.
- [ ] **Step 3:** Implement. When the link has `from`/`to`, the farm starts as the link's `farmId` or empty; auto-run once, only when all three arrived. The panel's farm-change effect clears the report, so run after it (a one-shot ref).
- [ ] **Step 4:** Run — PASS.

### Task 8: Make the dashboard clickable

**Files:** Modify `gm-dashboard-widgets.tsx`, `piggery-gm-dashboard.tsx`, `translations.ts`. Test: extend `apps/web/specs/piggery-gm-dashboard.spec.tsx`.

**Interfaces:** consumes Tasks 1–2. New optional widget props:
```ts
interface FigureLinks { month?: string | null; ytd?: string | null; monthBudget?: string | null; ytdBudget?: string | null }
KpiCard: links?: FigureLinks; SubKpi.links?: FigureLinks
KgMeatCard: links?: FigureLinks
Matrix: rowHref?: (key: string) => string | null; onFarm?: (farmId: string) => void
FarmMatrix: rowHref?: (key: string) => string | null
ProgressChart: href?: string | null
AlertsPanel / FarmAlertsPanel: alertHref?: (a: { metric_key: string; farm_id?: string }) => string | null
```

- Use `next/link`. A figure block is a stretched link under its content; its Budget link sits above it. Never nest links.
- Matrix farm heading and each farm dot are buttons calling `onFarm` (the page's `chooseFarm`); the measure name is the link.
- A chart's title is its link (the plot keeps its tooltip). An alert row with an href is a link; without one it renders as today, chevron included.
- Dashboard: build one `DrillContext`; `hasSales(span, id)` = `data.financial[span][id ?? 'all'] != null`. Wrap every href as `href && canOpen(user, href) ? href : null`, `user = getStoredUser()`.
- Progress charts: pigs → `drillHref('pigs_to_slaughter','ytd',…)`; PBT → `profitLossHref(…)`. Farm-view Kg Meat shows a YTD figure, so it links with `ytd`.
- Accessible names: `gmdOpenRecords: 'Open records for {name}'`, `gmdOpenBudget: 'Open budget for {name}'`, `gmdShowFarm: 'Show {name}'`.

- [ ] **Step 1:** Failing tests with the spec's existing two-farm fixture: Cost of Sales month link has the period dates and no `farmId`; after choosing a farm it has `farmId`; custom range renders no `/master-data/budget` link; the Farrowing Rate row name and the whole Weaner–Grower matrix contain no link; clicking a farm heading re-requests with `farmId`; a user without `FINANCE/JOURNAL` view gets no overhead link but keeps the others; no `<a>` contains another `<a>`; a Stage 2 alert is not a link.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** PASS, existing dashboard tests included.

### Task 9: Verify in the running app

- [x] **Step 1:** Scoped to the files this plan touches (not a full-suite rerun): `… nx test web --testPathPatterns='gm-drill-links|piggery-gm-dashboard|bio-asset-ledger-drill|kill-sheets-drill|journal-panel-drill|master-data-link-filters|farrowing-report-panel|profit-loss-drill' --maxWorkers=2` → 8 suites / 89 tests passed. `… nx test api --testPathPatterns='bio-asset-ledger.service|kill-sheets.service|piggery-analytics|journal-list-filters|gm-dashboard.metrics' --maxWorkers=2` → 5 suites / 77 tests passed. (26 Nov 2026)
- [ ] **Step 2:** Not rerun this session — no source was changed, only verified. `nx build api`/`nx build web` and the typecheck/lint sweep were not repeated.
- [x] **Step 3:** Done 26 Nov 2026 on `nf_cccshow`, both as All Farms and farm-scoped (GRASMERE FARM NORTON), Month and YTD. Every Stage 1 link enumerated via the accessibility tree and a sample clicked through with a MySQL/page-data cross-check. Link-less visits to bio-asset-ledger, kill-sheets, journal, budget, farrowing-report and profit-loss all confirmed clean (no stale filters). Phone width (375px) checked. See `docs/decisions.md`, "26 Nov 2026 — Task 9 run: full GM Dashboard quick-access verification" for the complete record.
- [x] **Step 4:** No mismatches found. Two things worth telling Rishi, written up in decisions.md: (1) the PBT progress chart's own figure (Revenue − COGS − Overheads) will not match the Net Income the P&L drill-link lands on, since the P&L page sums every GL account including unrelated Inventory Adjustment Gain/Loss entries; (2) Review Focus 5 (Overheads on All Farms) was measured directly — in this dataset the unfiltered Journal total exactly equals the sum of the two farms' figures, no silent gap. Not tested: a farm-restricted user opening another farm's link (no such test user existed on this tenant).

## Limits to tell Rishi

- The Bio-Asset Ledger shows heads and cost of animals sold. It has **no revenue column**, so Gross Margin's revenue is not visible there.
- A YTD budget link shows each period's line for that farm and measure (including future periods), not one YTD total.
- Kill Sheets lists 25 per page and the Journal at most 200 entries, as today.
