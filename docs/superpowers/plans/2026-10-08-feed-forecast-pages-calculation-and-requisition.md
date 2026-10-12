# Feed Forecast Pages, Calculation and Requisition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Feed Forecast page structure, explicit saved-calculation lifecycle, farm planning overrides, saved-run requisition creation, and dated planned-incoming roll-forward without removing any existing master field.

**Architecture:** The existing forecast engine remains authoritative. Saved runs gain an archive lifecycle and retain an exact display snapshot in the existing `output_snapshot` JSON; the service locks the Farm row so only one current run can exist per Farm. Feed requisitions are created from that exact saved run, while the forecast classifies approved requisitions, open transfers and posted ledger movements as separate dated inputs with strict precedence.

**Tech Stack:** NestJS 11, Drizzle/MySQL, Next.js 16, React 19, Jest/Testing Library, Nx/pnpm.

**Spec:** `docs/superpowers/specs/2026-10-08-feed-forecast-pages-calculation-and-requisition-design.md`

**Prerequisite plan:** Complete `docs/superpowers/plans/2026-10-08-feed-requisition-transfer-workflow.md` first. Its explicit feed-to-transfer links are required to replace planned requisition quantities with open-transfer quantities without double counting.

## Global Constraints

- Work only in `.worktrees/feed-forecast-requisition-integration`; preserve the existing dirty changes and inspect each pre-existing diff before editing or staging it.
- Do not delete, rename, hide or repurpose any existing master field or persisted master column.
- Add a field only after proving the existing schema, DTO, service and master configuration do not already represent the required value.
- Reuse the existing `feed_planning_setting.truck_target_kg` and `bulk_multiple_kg` company/farm rows; do not create duplicate settings.
- Workbook example values are illustrative. Do not seed `30,000` or `3,000` as client truth in new migrations or master rows.
- Feed remains `IN_HOUSE`; do not add Business Central calls, references or success states.
- Mill Consolidation, Loading Instruction and a dedicated Feed TO Receipt page remain deferred.
- The user-facing **Delete calculation** action archives evidence; it never physically deletes a saved run or linked requisition.
- Code/No., Name and Description fields continue to show only the semantic value promised by their label.
- Run tasks through `pnpm nx`; web remains on port 3002 and API on 2877.
- Add every settled rule to `docs/decisions.md` before the product code that depends on it.

## Review Focus

- Two concurrent saves for one Farm must leave exactly one current run and must not consume a second run version; Task 3 tests the Farm-row lock and conflict.
- An approved requisition whose delivery date is before the forecast stock date must appear as overdue planned incoming on the stock date, not disappear; Task 5 tests the clamp and reference label.
- Once any linked transfer exists, no quantity from that requisition may also enter as planned requisition stock; Task 5 tests transfer precedence and partial receipts.
- Archiving a run linked to a requisition must preserve both records and allow a new current run; Tasks 3 and 6 test the linked case.
- Moving settings and Reporting Period navigation must preserve every existing Location and Reporting Period field; Task 2 adds explicit field-set regression tests.

---

### Task 1: Record the approved page and calculation decisions

**Files:**
- Modify: `docs/decisions.md`

**Interfaces:**
- Produces: the source-of-truth decision for page placement, additive-only master changes, one current calculation per Farm, saved-run requisition creation and planned incoming precedence.

- [ ] **Step 1: Append the 2026-10-08 decision** using the approved spec's exact boundaries: Feed Plan is a Feed Forecast tab; Feed Planning is settings; Truck Target and Bulk Multiple use company defaults plus nullable Farm overrides; master fields are preserved; Delete archives; requisitions use exact saved runs; approved requisitions add planned stock until a transfer replaces them.
- [ ] **Step 2: Check the decision against later existing entries** and remove no earlier history; state explicitly which conflicting navigation/calculation statements are superseded.
- [ ] **Step 3: Run** `git diff --check -- docs/decisions.md`; expect no whitespace errors.
- [ ] **Step 4: Commit only the reviewed decision hunk**, preserving earlier dirty hunks in the file.

### Task 2: Put configuration and Reporting Period on their approved pages

**Files:**
- Create: `apps/web/src/components/console/company/feed-farm-overrides.tsx`
- Create: `apps/web/specs/feed-farm-overrides.spec.tsx`
- Modify: `apps/web/src/components/console/console-tabs/company-tab.tsx`
- Modify: `apps/web/src/app/(app)/settings/inventory-setup/page.tsx`
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Modify: `apps/web/specs/feed-planning-panel.spec.tsx`
- Modify: `apps/web/specs/master-data-feed-masters.spec.ts`
- Modify: `apps/web/specs/location-form-feed-settings-removed.spec.ts`
- Delete: `apps/web/src/app/(app)/settings/reporting-periods/page.tsx`

**Interfaces:**
- Consumes: existing `GET /feed-forecast/farm-settings`, `GET/PUT /feed-settings`, and `PUT /feed-settings/farm` contracts.
- Produces: `FeedFarmOverrides({ companyId }: { companyId: string })`; Reporting Period in `MASTER_DATA_NAV_ORDER`; company/farm settings remain stored in existing columns.

- [ ] **Step 1: Add failing page-placement tests** asserting Company Settings → Feed renders editable Farm override rows for `truckTargetKg` and `bulkMultipleKg`, blank clears to inheritance, and Inventory Setup no longer renders the duplicate Feed Planning tab.
- [ ] **Step 2: Add failing master-preservation tests** that snapshot the existing Location field keys and Reporting Period field keys, then assert Reporting Period is primary Master navigation and absent from Settings navigation.
- [ ] **Step 3: Run** `pnpm nx test web -- --testPathPatterns='feed-farm-overrides|feed-planning-panel|master-data-feed-masters|location-form-feed-settings-removed'`; expect the new placement assertions to fail.
- [ ] **Step 4: Implement `FeedFarmOverrides`** using existing override fields and endpoints. Show each Farm's override and effective source; send `null` for an intentionally cleared override and reject non-positive configured values.
- [ ] **Step 5: Render the override component in the Company Feed section**, remove only the duplicate Inventory Setup tab/control, and leave the Location Master fields and API columns untouched.
- [ ] **Step 6: Move Reporting Period's config to `group: "Farm Operations"`, `isPrimary: true`, add it to `MASTER_DATA_NAV_ORDER`, remove the Settings link/page, and preserve its complete field and draft-activation contracts.
- [ ] **Step 7: Re-run the focused web tests**; expect PASS.
- [ ] **Step 8: Commit the page-placement and regression-test changes**, staging only reviewed hunks from already-dirty files.

### Task 3: Add the current saved-run and archive lifecycle

**Files:**
- Create: `apps/api/src/drizzle/tenant/0153_feed_forecast_run_archive.sql`
- Create: `apps/api/src/drizzle/tenant/feed-forecast-run-archive-migrations.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`
- Modify: `apps/api/src/core/database/schema.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.spec.ts`

**Interfaces:**
- Schema adds `feed_forecast_run.archived_at timestamp NULL`, `archived_by varchar(36) NULL`, and index `(tenant_id, farm_id, archived_at)`.
- Schema adds unique index `uq_requisition_feed_forecast_run` on nullable `requisition.feed_forecast_run_id` after a migration assertion proves existing non-null links are unique.
- Produces `FeedForecastRunService.findCurrent(farmId, companyId, tenantId)` and `archiveRun(runId, tenantId, actor)`.
- Produces `GET /feed-forecast/runs/current?farmId=...` and `DELETE /feed-forecast/runs/:id`.
- `output_snapshot` advances to a versioned shape containing the exact persisted Calculation display snapshot; historical v1/v2 snapshots remain readable as history.

- [ ] **Step 1: Add a failing additive-only migration spec** asserting only the two run columns, lookup index and requisition uniqueness index are added; assert no master table/column is dropped or renamed.
- [ ] **Step 2: Add failing run-service tests** for no current run, one current run, a second save conflict under the Farm lock, different Farms saving independently, archive evidence, repeated archive, and archive of a run linked to a requisition.
- [ ] **Step 3: Add failing snapshot-rule tests** proving the stored display snapshot preserves rows, source balances, filters and effective setting sources without mutating the computed response. Task 5 extends this assertion for the three incoming-stock classifications.
- [ ] **Step 4: Run** `pnpm nx test api -- --testPathPatterns='feed-forecast.(run|current-run)|feed-forecast-run-archive-migrations'`; expect the new tests to fail.
- [ ] **Step 5: Add the reviewed migration/schema fields** and extend the existing output snapshot JSON contract rather than adding duplicate result columns.
- [ ] **Step 6: Implement current-run creation and archive under the existing locked Farm row**. The current-run check occurs before version/code allocation, and archive never deletes run lines or requisitions.
- [ ] **Step 7: Add the controller routes before `runs/:id`**, protecting archive with the same create authority as Save because archive is the prerequisite for a replacement calculation.
- [ ] **Step 8: Re-run the focused API tests**; expect PASS.
- [ ] **Step 9: Commit the migration, lifecycle and tests**, respecting the prerequisite plan's reserved migration `0152`.

### Task 4: Make Calculation explicit, persistent and replaceable

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx`
- Modify: `apps/web/specs/feed-forecast-panel.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: Task 3 current-run, save-run and archive routes.
- Produces: `CalculationState = EMPTY | CALCULATED | SAVED`; saved display comes from the persisted snapshot, not a fresh GET.

- [ ] **Step 1: Replace auto-load expectations with failing interaction tests**: initial filters show no result; Calculate makes one GET; filter edits do not calculate; Save persists the displayed result; refresh/farm re-entry loads the current run; Delete archives and returns to empty; a linked run can still be archived.
- [ ] **Step 2: Add failing permission/error tests** for Calculate without save permission, archive without authority, stale-current conflict, preserved displayed data after save/archive failure, and human text instead of `NaN`, `-` or an em dash.
- [ ] **Step 3: Run** `pnpm nx test web -- --testPathPatterns=feed-forecast-panel`; expect failures against auto-fetch and history-only behavior.
- [ ] **Step 4: Refactor the panel into the three explicit states**. On Farm change, request only `runs/current`; enable Calculate only when required Farm/range controls are complete and no current run exists.
- [ ] **Step 5: Render current saved-run metadata and actions**, keep archived runs in history, and share the saved Farm/window with the other Feed Forecast tabs.
- [ ] **Step 6: Re-run the focused web tests**; expect PASS.
- [ ] **Step 7: Commit the Calculation lifecycle UI and tests**.

### Task 5: Add approved requisitions as separately labelled planned incoming feed

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.daily.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.walk.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.stock.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.planned-incoming.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.spec.ts`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`
- Modify: `apps/web/specs/feed-forecast-grid.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- `IncomingFeed` adds `kind: 'CONFIRMED_LEDGER' | 'OPEN_TRANSFER' | 'PLANNED_REQUISITION'` and optional `{ referenceId, referenceNo, overdue }`.
- `SourceBalancePoint` adds `openTransferMovementKg`, `plannedIncomingKg` and their references; `confirmedReceiptKg` contains posted ledger movement only.
- Produces `loadPlannedFeedRequisitions(farmId, companyId, tenantId, stockDate, horizonTo): Promise<IncomingFeed[]>`.

- [ ] **Step 1: Add failing pure-engine tests** for `opening + confirmed ledger + open transfer + planned requisition - use`, next-day opening, multiple planned requisitions on one date, and separate totals/references for all three sources.
- [ ] **Step 2: Add failing service tests** for approved feed only; pending/rejected/cancelled exclusion; destination/item/date mapping; a past-due date clamped to stock date with `overdue=true`; and out-of-horizon exclusion.
- [ ] **Step 3: Add failing precedence tests** proving any explicit `feed_requisition_transfer` link suppresses requisition-planned input, an open transfer supplies only its outstanding quantity, and posted/partial receipts use ledger plus remaining transfer without duplicating the requisition.
- [ ] **Step 4: Run** `pnpm nx test api -- --testPathPatterns='feed-forecast.(engine|stock|planned-incoming|view)'`; expect failures for the new input classification.
- [ ] **Step 5: Implement typed incoming aggregation**. Mark posted ledger movements `CONFIRMED_LEDGER`, outstanding stock-transfer movements `OPEN_TRANSFER`, and approved unlinked requisitions `PLANNED_REQUISITION`; aggregate them without merging their labels.
- [ ] **Step 6: Extend the view and Calculation grid** with **Planned Feed Added KG** and the requisition number/reference on the delivery date; keep Confirmed Receipt separate.
- [ ] **Step 7: Run** `pnpm nx test api -- --testPathPatterns='feed-forecast.(engine|stock|planned-incoming|view)'` and `pnpm nx test web -- --testPathPatterns=feed-forecast-grid`; expect PASS.
- [ ] **Step 8: Commit the planned-incoming calculation and display changes**.

### Task 6: Create one editable feed requisition from the exact saved run

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/dto/feed-requisition.dto.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.controller.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.from-run.spec.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`

**Interfaces:**
- Produces `FeedRequisitionService.previewFromRun(runId, tenantId, user): Promise<FeedRequisitionDocumentView>`.
- Produces `FeedRequisitionService.createFromRun(runId, dto: CreateFeedRequisitionFromRunDto, tenantId, user): Promise<FeedRequisitionDocumentView>`.
- Produces `GET /feed-requisition/from-run/:runId/preview` and `POST /feed-requisition/from-run/:runId`.
- `CreateFeedRequisitionFromRunDto` carries only editable header/line values; the server reattaches run IDs, recommended quantities and provenance from the saved run.

- [ ] **Step 1: Add failing preview tests** proving the preview uses the persisted run snapshot without calling `getForecast`, groups lines by destination/item, applies the run's snapped order multiple/truck target, and returns editable requested quantity/date fields.
- [ ] **Step 2: Add failing create tests** for one requisition per run, concurrent duplicate refusal, archived-run eligibility, tampered destination/item/run-line refusal, no-shortage refusal, and preserved manual creation with no run link.
- [ ] **Step 3: Run** `pnpm nx test api -- --testPathPatterns='feed-requisition.(from-run|service)'`; expect failure because the routes/service methods do not exist.
- [ ] **Step 4: Implement preview from the stored snapshot** and final transactional creation. Lock the Farm/run, revalidate scope and uniqueness, preserve allowed user edits, and never recalculate or silently save another run.
- [ ] **Step 5: Retire `autoDraft` as a UI entry point** without deleting historical endpoint support until all callers/tests have migrated; no new caller may use it.
- [ ] **Step 6: Re-run focused feed-requisition tests**; expect PASS.
- [ ] **Step 7: Commit the saved-run requisition API and tests**.

### Task 7: Connect both requisition surfaces to the saved-run workflow

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-requisition-from-run-dialog.tsx`
- Create: `apps/web/specs/feed-requisition-from-run-dialog.spec.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Modify: `apps/web/src/components/console/inventory/requisitions-panel.tsx`
- Modify: `apps/web/src/components/console/requisitions/requisitions-hub.tsx`
- Modify: `apps/web/specs/requisitions-panel.spec.tsx`
- Modify: `apps/web/specs/requisitions-hub.spec.tsx`
- Modify: `apps/web/specs/requisition-new-dialog.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: Task 6 preview/create routes and the existing `FeedRequisitionDetail`/document components.
- Produces: one shared editable from-run dialog; after creation the Calculation action changes from **Create Feed Requisition** to **View Requisition**.

- [ ] **Step 1: Add failing dialog tests** for loading preview, editing allowed fields, creating once, preserving edits on API failure, and opening the created document.
- [ ] **Step 2: Replace `Draft from forecast` tests** with saved-current-run tests. The Feed Requisitions tab offers manual **New** and **Create from saved calculation** only when an unlinked current run with shortage exists.
- [ ] **Step 3: Add failing main-hub tests** for common and feed rows in one list, Feed in the creation picker, Farm/All Farms filtering, and the shared feed dialog; remove the obsolete `kind=common` request assertion.
- [ ] **Step 4: Run** `pnpm nx test web -- --testPathPatterns='feed-requisition-from-run-dialog|requisitions-panel|requisitions-hub|requisition-new-dialog'`; expect failure.
- [ ] **Step 5: Implement the shared from-run dialog and actions** on Calculation and Feed Requisitions. Reuse the existing feed document editor and final create endpoint; do not duplicate form fields.
- [ ] **Step 6: Correct the main Requisition query/filter UI** so its canonical list includes feed and common requisitions and filters by Farm where authorized; keep feed/common document shapes separate after selection.
- [ ] **Step 7: Re-run the focused web tests**; expect PASS.
- [ ] **Step 8: Commit the unified requisition entry-point changes**.

### Task 8: Add the operational Feed Plan tab

**Files:**
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-plan.rules.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-plan.rules.spec.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-plan.service.spec.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts`
- Create: `apps/web/src/components/console/inventory/feed-plan-panel.tsx`
- Create: `apps/web/specs/feed-plan-panel.spec.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-tabs.tsx`
- Modify: `apps/web/specs/feed-forecast-tabs.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Produces `GET /feed-forecast/feed-plan?farmId=...&from=...&to=...`.
- Produces plan rows `{ farm, period, item, tentativeKg, approvedRequisitionKg, shippedKg, receivedKg, remainingKg, varianceKg, capacityKg: number | null }` from the current saved run and canonical requisition/transfer postings.
- Produces Feed Forecast tab key `feed-plan` between `forecast` and `feed-requisition`.

- [ ] **Step 1: Add failing pure-rule tests** for tentative/approved/shipped/received/remaining/variance quantities, item/date grouping, partial fulfilment and missing capacity returning `null` rather than zero.
- [ ] **Step 2: Add failing service tests** proving the plan reads the current saved run and canonical documents, returns no invented result without a saved run, and obeys Farm/company scope.
- [ ] **Step 3: Add failing tab/panel tests** for the five-tab order, shared Farm/range context, loading/empty/error states and human-readable unavailable capacity.
- [ ] **Step 4: Run** `pnpm nx test api -- --testPathPatterns='feed-plan'` and `pnpm nx test web -- --testPathPatterns='feed-plan-panel|feed-forecast-tabs'`; expect failure.
- [ ] **Step 5: Implement the server aggregation and Feed Plan panel** without invoking a second forecast calculation.
- [ ] **Step 6: Re-run focused API/web tests**; expect PASS.
- [ ] **Step 7: Commit the Feed Plan API, tab and tests**.

### Task 9: Verify the complete application and database workflow

**Files:**
- Modify: `docs/superpowers/plans/2026-10-08-feed-requisition-transfer-workflow.md`
- Modify: `docs/superpowers/plans/2026-10-08-feed-forecast-pages-calculation-and-requisition.md`

**Interfaces:**
- Produces: verified schema, API, UI and MySQL evidence; no new product behavior.

- [ ] **Step 1: Run focused suites** for feed settings, forecast run, engine/view/planned incoming, feed requisition/from-run, requisition hub, Feed Plan and transfer fulfilment; expect PASS.
- [ ] **Step 2: Run full gates:** `pnpm nx test api`, `pnpm nx test web`, `pnpm nx run-many -t typecheck -p api,web,web-e2e`, `pnpm nx build web`, and `git diff --check`; expect no new failures.
- [ ] **Step 3: Run the tenant migration workflow in verify mode**, inspect every tenant and journal entry, then apply only to the confirmed local development database. Query the new archive columns/indexes and requisition uniqueness constraint afterward.
- [ ] **Step 4: Drive the running app on 3002/2877** through Company/Farm setting resolution, empty Calculate, Save, refresh, Delete/archive, replacement calculation, editable requisition creation from both surfaces, approval, release, partial/final shipment and receipt, and Feed Plan updates.
- [ ] **Step 5: Verify the dated roll-forward in the UI** before delivery, on delivery (`previous + planned/confirmed incoming - use`) and after delivery; confirm requisition, transfer and receipt are never counted together.
- [ ] **Step 6: Query MySQL after every write** for settings, saved/archived runs, run lines/snapshots, requisition linkage, feed-transfer linkage, shipment/receipt events, inventory ledger and final fulfilment.
- [ ] **Step 7: Confirm every pre-existing master field still appears and persists**, including Location silo fields and all Reporting Period fields.
- [ ] **Step 8: Run the verification-before-completion skill**, record exact evidence in both plans, and commit only reviewed implementation hunks.

## Implementation and verification evidence — 2026-10-08

- Tasks 1–8 are implemented. The final UI has Dashboard, Calculation, Feed
  Plan, Requisition and Physical Stock Count; the main Requisition list no
  longer sends `kind=common` and offers All Farms/Farm filtering.
- The saved-run requisition dialog is shared by Calculation, Feed Requisition
  and the main Requisition hub. A no-shortage preview hides the create action;
  an existing link changes it to View Requisition.
- Migration 0153 now archives legacy v1/v2 snapshots during upgrade. They are
  retained as history but cannot masquerade as a current v3 display snapshot.
  Before local application, both tenant databases were backed up to
  `/tmp/navfarm-feed-migrations.vuqx5R/tenants-before-0152-0153.sql` (SHA-256
  `b0ac1756193d93779d69140ead03979947e2f067bd18dbc23c018e7bce761d88`).
  The repository runner has no verify-only mode, so SQL, referenced tables and
  saved-run uniqueness were inspected read-only first; then migrations 0152
  and 0153 were applied to `nf_system` and `nf_devco`. Both journals report
  153 and the archive/link/uniqueness indexes were queried from
  `information_schema` afterward.
- Running-app proof used headless Playwright against ports 3002/2877 because
  the computer-use browser surface was unavailable. It verified the five tabs,
  Feed Plan empty state, canonical Requisition request without `kind=common`,
  All Farms plus Farm options, explicit Calculate → Save, refresh, Delete
  archive, and replacement Save. MySQL showed AI100 v3 archived and replacement
  v4 current, both `forecast-run-display:v3`, while legacy v2 rows stayed
  archived. The live Feed Plan and from-run preview endpoints also returned
  through the running API.
- Final fresh gates: API **198 suites / 2,549 tests passed**; Web **98 suites /
  727 tests passed**; API, Web and Web-E2E typechecks passed; the Web production
  build completed all 76 routes; `git diff --check` produced no errors.
- Completion audit added saved-run duplicate-line rejection, snapped order-
  multiple rounding and a service-boundary Feed Plan empty-state/scope test.
  It also completed the existing-master setup needed by feed Release: Location
  now exposes Production Slot and BIN Diet Assignment tabs, backed by a
  company-scoped CRUD API. No setup rows or workbook examples were seeded.
- Running-app proof opened `REQ-GRA100-2026-00007` from the shared Requisition
  page. Release, Transfer Shipment and Transfer Receipt were all visible in
  the header. Release was disabled with the exact missing-assignment reason for
  line 10000/date 2026-10-11; Shipment and Receipt showed their preceding-state
  blockers. The new master tab loaded through the live API and showed the
  truthful empty state.
- Final re-run after the audit: API **199 suites / 2,553 tests passed**; Web
  **98 suites / 729 tests passed**; API, Web and Web-E2E typechecks passed; the
  Web production build completed all 76 routes; `git diff --check` passed.
  A posted live Release/Shipment/Receipt was intentionally not fabricated:
  `nf_devco` has no real BIN, Production Slot or exact-date assignment yet.

### Continuation audit correction — 2026-10-08

- The earlier statement that Tasks 1–8 were complete was too broad. The
  operational Feed Plan tab exists, but its Tentative quantity currently comes
  from the saved forecast recommendation. Workbook Engine rows 31–44 require
  retained farm/week/item TENTATIVE and ACTUAL versions, with Tentative based
  on five completed Wednesday–Tuesday weeks of posted consumption and adjusted
  for known population/diet changes. Task 8 remains partial until that model is
  implemented and verified.
- Feed Plan now distinguishes a saved calculation with no positive order from
  the absence of a saved calculation. Saved Physical Stock Count documents now
  return and display silo code, feed item number/name and reason name instead
  of internal IDs.
- The existing Silo Feed Setup was moved from Inventory Setup into Company
  Settings → Feed Planning without removing any Location/master field. Its API
  list now accepts a company filter in addition to the caller's scope.
- Feed screens changed missing/invalid display values from `NaN` or an em dash
  to explanatory unavailable text. Focused verification passed: API 24/24
  company-scope/controller tests and 225/225 forecast/run/plan/requisition
  tests; Web 10/10 settings tests, 15/15 semantic-fallback tests, 26/26
  requisition-panel tests, and 135/135 focused workflow tests.
- Feed Plan no longer mislabels destination-silo storage capacity as mill
  production capacity. Until the deferred mill-capacity setup exists, the
  workbook capacity field is returned as unavailable; the focused Feed Plan
  suite passes 10/10 tests.
- The retained workbook Feed Plan gap is now implemented. Migration 0154 adds
  additive `feed_plan` and `feed_plan_line` documents; no master table or field
  was removed. Plan codes use the ISO production week and retain Tentative and
  Actual revisions. Each line snapshots five completed Wednesday–Tuesday
  weeks of posted consumption and lifecycle/scheduler expectation, the
  normalization factor, saved target-week demand, requested quantity and
  variance. Mill Approved and mill capacity remain explicitly unavailable.
- Running API proof generated `PLAN-VIL100-202641-R01` from VIL100's current
  saved calculation. MySQL read-back found three item lines, 2,919 KG projected
  and tentative demand, and exactly five history periods per line. Both
  registered tenant journals reached migration 154. The live check also found
  and removed an unnecessary current-run filesort that exhausted MySQL's sort
  buffer when selecting JSON snapshots.
- Final retained-plan verification: API **201 suites / 2,568 tests passed**;
  Web **99 suites / 740 tests passed**; API and Web typechecks passed; API and
  Web production builds passed, with all 76 Web routes generated. The running
  services were rebuilt on ports 2877 and 3002.

### Approval refresh continuation — 2026-10-09

- Approved run-linked feed requisitions now trigger an Actual Feed Plan revision
  after the approval transaction commits. Rejections do not trigger a plan
  revision, and a refresh failure is logged without rolling back approval.
- Focused approval/feed requisition verification passes **2 suites / 68 tests**.
- Automatic Wednesday scheduling is not added because this API has no existing
  durable job scheduler; the existing configurable production weekday remains
  the Feed Plan generation rule and the UI/API generation action remains the
  safe trigger. Mill Consolidation, Loading and dedicated TO Receipt remain
  deferred by scope.
