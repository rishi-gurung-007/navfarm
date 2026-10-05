# Feed Forecast Dashboard and Calculation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Feed Forecast Dashboard and Calculation pages with approved selection behavior, workbook fields, charts and correct Daily/Weekly run-down displays.

**Architecture:** One shared React context owns Farm and forecast window. The API computes the whole Farm once per request; Dashboard and Calculation reshape/filter that result without a second engine pass. Dashboard resolves one required Shed/Silo and supplements selected-Silo facts with explicitly labelled farm totals and the next Mill BIN assignment.

**Tech Stack:** NestJS 11, Drizzle/MySQL, Next.js 16, React 19, Recharts 3, Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-10-05-feed-forecast-dashboard-calculation-mill-design.md`

**Order:** Tasks 1–6 are the top priority and run first with a nullable `millLoadingBin` contract that truthfully renders
`Not scheduled`. Then execute `docs/superpowers/plans/2026-10-05-mill-bin-location-foundation.md`; Task 7 connects and
live-verifies the real assignment before the Dashboard is declared fully complete.

## Global Constraints

- Default is Custom from Farm-local today through +6 days, seven dates inclusive.
- Daily/Weekly without explicit `to` run through run-down, capped by the configured 45-day horizon.
- Custom and Reporting Period never silently expand beyond their explicit dates.
- Dashboard loads only with valid Farm → Shed → Silo; Calculation computes Farm-wide and optional filters only affect display.
- Every required Dashboard field remains visible even when a chart visualises it.
- Remove the Stages sub-tab/response, not the engine's stage/diet-change logic.
- Use `Field`, `StatRow`, `StatCard`, `Card`, `ScrollTable`, `ConsolePage` and existing design tokens.

## Review Focus

- A parent change cannot flash data from the previous Shed/Silo.
- A shared Silo feeding several Sheds must be selected only through valid links, without double-counting its stock.
- A Farm with no run-down within 45 days shows the full horizon and no false zero.
- Multiple batches sharing one Silo/item must not duplicate the balance series or farm order total.
- Missing Mill assignment displays `Not scheduled`; it never chooses an arbitrary BIN.

---

### Task 1: Shared forecast context and seven-day default

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-forecast-context.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-tabs.tsx`
- Modify: `apps/web/src/components/console/inventory/use-feed-farm.ts`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Create: `apps/web/specs/feed-forecast-context.spec.tsx`
- Modify: `apps/web/specs/feed-forecast-tabs.spec.tsx`

**Interfaces:**
- Produces: `FeedForecastContextValue` with `farmId`, `planningDate`, `view`, `from`, `to`, `periodId` and setters; `view` defaults to `CUSTOM` and dates hydrate from API Farm-local dates.

- [ ] **Step 1: Write failing context/tab tests** for shared core state, Custom default, exact seven dates, state retained across Dashboard/Calculation and no duplicate farm-list request.
- [ ] **Step 2: Run** `pnpm nx test web -- --runInBand apps/web/specs/feed-forecast-context.spec.tsx` and confirm failure.
- [ ] **Step 3: Implement the provider** around mounted panels. Keep Requisition/Physical Count behavior unchanged.
- [ ] **Step 4: Convert Calculation to consume shared core values** without changing its output yet.
- [ ] **Step 5: Run focused web specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 2: Dashboard query contract, hierarchy and one-compute response

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-silo-status.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.silo-status.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-silo-status.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.spec.ts`

**Interfaces:**
- Consumes initially: nullable `NextBinAssignment` provider returning `null`; after the Mill/BIN plan,
  `findNextBinAssignment(...)` supplies the same shape.
- Produces: `GET /feed-forecast/silo-status` accepting View/Range plus optional bootstrap `shedId`, `siloId`; incomplete
  hierarchy returns ordered child options and `silo: null`, while complete selection returns
  `{ selection, silo, balanceSeries, demandSeries, farmTotalOrderKg }`.

- [ ] **Step 1: Write failing service tests** for Farm-only/Shed-only bootstrap responses with zero engine calls,
  ordered options, complete-selection membership checks, one `computeForFarm` call, selected-Silo facts, pre-filter
  farm total, deduplicated series, current/next need split and next BIN/`Not scheduled`.
- [ ] **Step 2: Run the focused API specs** and confirm failure.
- [ ] **Step 3: Extend DTO/window resolution** by reusing `resolveViewRange`; do not copy date logic.
- [ ] **Step 4: Implement one-pass response shaping** from existing engine sources/daily rows and `buildSiloStatus`.
- [ ] **Step 5: Run focused API specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 3: Dashboard selector and required field layout

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-silo-dashboard.tsx`
- Create: `apps/web/src/components/console/inventory/feed-silo-dashboard-cards.tsx`
- Modify: `apps/web/specs/feed-silo-dashboard.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: Task 1 context and Task 2 dashboard response.
- Produces: required Farm→Shed→Silo selector, KPI/detail cards, linked Requisition status and workbook table.

- [ ] **Step 1: Write failing web tests** for first valid code-ordered defaults, parent-change reselection, no fetch/render before complete selection, stale-data suppression and all 15 required labels/values.
- [ ] **Step 2: Run the focused spec** and confirm failure.
- [ ] **Step 3: Implement the filter bar and cards** using shared primitives. Keep previous valid render dimmed during same-context reload; clear it immediately when hierarchy becomes invalid.
- [ ] **Step 4: Rebuild the detail table in workbook order** with Silo Code linking to Location detail, Requisition status linking to the requisition and Farm Total explicitly labelled.
- [ ] **Step 5: Run focused web specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 4: Dashboard charts

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-silo-dashboard-charts.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-silo-dashboard.tsx`
- Create: `apps/web/specs/feed-silo-dashboard-charts.spec.tsx`

**Interfaces:**
- Consumes: `balanceSeries`, `demandSeries` from Task 2.
- Produces: accessible projected-balance LineChart and current/next diet demand BarChart.

- [ ] **Step 1: Write failing chart-data/render tests** for chronological points, threshold/capacity lines, zero run-down marker, current/next legend and unavailable empty state.
- [ ] **Step 2: Run the focused spec** and confirm failure.
- [ ] **Step 3: Implement Recharts components** with design-token colours, visible legends/tooltips, text equivalents and responsive containers.
- [ ] **Step 4: Run focused specs** and expect PASS.
- [ ] **Step 5: Commit**.

### Task 5: Calculation report contract and optional filters

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.sources.spec.ts`

**Interfaces:**
- Produces: report rows with stable Farm/Batch/House/Silo/Item IDs plus current Silo item, KG/head/day rate, opening balance, confirmed receipts, daily use, projected closing, recommended quantity and delivery date; removes public `stages`.

- [ ] **Step 1: Write failing API tests** for every Engine row 70 field, source balance on no-demand days, shared-source deduplication, existing Daily/Weekly/Custom/PERIOD rules and unchanged requisition aggregates.
- [ ] **Step 2: Run the focused API specs** and confirm only the new contract assertions fail.
- [ ] **Step 3: Expose existing engine evidence** without recalculating it; add no UI filters to engine inputs.
- [ ] **Step 4: Remove the `stages` response contract** while retaining internal stage/diet-change projection.
- [ ] **Step 5: Run focused API specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 6: Calculation filters, grid and run evidence

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx`
- Modify: `apps/web/specs/feed-forecast-panel.spec.tsx`
- Modify: `apps/web/specs/feed-forecast-grid.spec.tsx`
- Modify: `apps/web/specs/feed-forecast-run-history.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: Task 5 report rows.
- Produces: optional `All` filters for Shed/Silo/Batch/Feed Item/Bulk-Bagged and the exact workbook detail grid; no Stages tab.

- [ ] **Step 1: Write failing web tests** for optional filter options/cascading validity, unchanged source rows, exact row-70 columns, daily/weekly closing balances and Stages removal.
- [ ] **Step 2: Run focused web specs** and confirm failure.
- [ ] **Step 3: Implement client-side result filtering** over the returned whole-Farm rows and rebuild the pivot using source balance points for no-demand days.
- [ ] **Step 4: Add missing run-history evidence** already stored: as-of time, posting cutoff, selected filters, config version and author.
- [ ] **Step 5: Run focused web specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 7: Gates and live proof

**Files:**
- Modify: `docs/superpowers/plans/feed-completion/progress.md`
- Modify: `docs/superpowers/plans/2026-10-04-feed-master-completion-plan.md`

**Interfaces:**
- Consumes: Tasks 1–6 and the Mill/BIN foundation.
- Produces: verified Dashboard/Calculation delivery evidence.

- [ ] **Step 1: Run** `pnpm nx test api`, `pnpm nx test web`, and `pnpm nx run-many -t typecheck -p api web web-e2e`; record counts/output.
- [ ] **Step 2: Run** `pnpm nx lint web`, compare with the accepted baseline and prove no new errors.
- [ ] **Step 3: Rebuild/restart API by confirmed PID and leave web on port 3002.** Never use `pkill`.
- [ ] **Step 4: Drive two real Farms** covering at least 1:1 and shared-Silo topology. Verify Dashboard defaults, all fields, charts, tab-shared context, Calculation optional filters, Daily, Weekly, Custom and no Stages.
- [ ] **Step 5: After the Mill/BIN foundation, connect `findNextBinAssignment(...)`; compare representative balances** to MySQL Item Ledger plus confirmed movements and verify saved-run evidence plus a real next BIN assignment.
- [ ] **Step 6: Update progress/master plan with evidence and remaining later-phase work, then commit.**
