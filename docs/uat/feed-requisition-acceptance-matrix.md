# Feed Requisition & Forecast Acceptance Matrix

**Audit Date:** 2026-10-09
**Worktree:** `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
**Tenant Database:** `nf_devco`

---

## 1. Acceptance Matrix

| # | Requirement & TDD Reference | Page / API / Source Files | Expected Behavior | Actual Behavior | Status | Evidence | Priority | Required Action |
|---|---|---|---|---|---|---|---|---|
| 1 | **Forecast Engine & Horizon** (TDD r1-25) | `/inventory/feed-forecast`<br>`feed-forecast.engine.ts` | Calculates 7-day to 45-day daily consumption and closing stock per silo/diet. | Calculates daily rundown and flags stage/feed rate issues accurately. | **PASS** | 88 tests passing in `feed-forecast.service.spec.ts` | - | None. |
| 2 | **Run History & Snapshot Persistence** (TDD r70) | `feed-forecast-run.service.ts`<br>`feed-forecast-run-history.tsx` | Persists exact v3 calculation snapshot; reloads read-only without recalculating. | Reproduces historical numbers exactly from DB JSON snapshot. | **PASS** | 32 tests passing in `feed-forecast-panel.spec.tsx` | - | None. |
| 3 | **Planned Incoming Stock from Approved Requisition** (Feed Forecast §2) | `feed-forecast.service.ts:126`<br>`feed-forecast.planned-incoming.spec.ts` | Approved open feed requisitions add planned incoming on expected delivery date. | Adds planned incoming on expected date; handles legacy OPEN approval statuses. | **PASS** | 5 tests passing in `feed-forecast.planned-incoming.spec.ts` | - | None. |
| 4 | **Open Transfer Incoming Timing** (Feed Forecast §2) | `feed-forecast.service.ts:2000-2290` | Released transfers inherit expected delivery date from requisition line, not transfer posting date. | Joins requisition line expected dates and clamps overdue to stock date. | **PASS** | Live API verification in `docs/uat/feed-forecast-non-to-uat.md` | - | None. |
| 5 | **Shortage to Prefilled Requisition** (TDD r8-15) | `feed-requisition-from-run-dialog.tsx`<br>`feed-requisition.service.ts` | Creates prefilled requisition from actionable shortages in saved run. | Prefills farm, silos, items, recommended quantities and delivery dates. | **PASS** | Tested in UAT (`REQ-VIL100-2026-00005`) | - | None. |
| 6 | **All Farms Default on Feed Requisitions** (UX Spec) | `/inventory/feed-requisitions`<br>`requisitions-panel.tsx` | Company users default to "All Farms" view and see all permitted farm requisitions. | Defaults to All Farms; lists farm codes and names; filters properly. | **PASS** | 26 tests passing in `requisitions-panel.spec.tsx` | - | None. |
| 7 | **Feed Mill Consolidation Selection** | `/inventory/feed-consolidations`<br>`feed-consolidation.service.ts` | Approved feed requisitions can be selected across farms and consolidated. | Eligible filter reads approved requisitions without consolidation; groups by company. | **PASS** | Tested in UAT (`CONS-202641-001`, `CONS-202641-004`) | - | None. |
| 8 | **Consolidation Mill Adjustment Reason** | `feed-consolidation.service.ts:130` | Mandatory reason required if mill approved quantity differs from requested. | Rejects save if quantity differs and adjustment reason is missing or empty. | **PASS** | Unit & UAT verified | - | None. |
| 9 | **Excessive Mill Approved Quantity** | `feed-consolidation.service.ts:128` | Prevent mill approved quantity from unreasonably exceeding requested quantity. | Only checks `approved >= 0`. Allows 3,000 KG approved for a 50 KG request with any arbitrary reason. | **PARTIAL** | Code inspection `feed-consolidation.service.ts:128` | **P2** | Add warning or cap if approved > 200% of requested. |
| 10 | **Consolidation Required for Release** | `feed-requisition.service.ts:1243` | Feed requisition release requires finalized consolidation sheet. | Rejects release with clear message if not consolidated or sheet not `CONSOLIDATED`. | **PASS** | Verified in `feed-requisition.release.spec.ts` | - | None. |
| 11 | **Release Prerequisite: Exact-Date BIN Diet Assignment** | `feed-requisition.service.ts:1300-1365` | Requires active BIN Diet Assignment matching production date and diet. | Blocks release if date has no assignment. In UAT, LEX100 failed because date was `2026-10-04` while assignments were for `2026-10-11`. | **PASS** (Config Dependent) | Tested with `REQ-GRA100-2026-00010` (released on `2026-10-11`) | **P1** | Add helper link in error message pointing to BIN Diet Assignment page. |
| 12 | **BIN Diet Assignment Configuration Screen** | `/master-data/location?tab=bin-diet-assignment`<br>`configs.ts:1609` | Admins can configure BIN diet assignments per date and slot. | Exists under Location Master tabs. Missing from `/settings/inventory-setup`. | **PASS** | UI verified | **P2** | Add navigation shortcut in `/settings/inventory-setup`. |
| 13 | **Feed Loading Sheet Creation** | `feed-loading.service.ts`<br>`/inventory/feed-loading` | Consolidation creates draft loading sheet per consolidated line. | Draft sheet created with mill approved quantities, loading BIN, and destination silo. | **PASS** | UAT verified with `LOAD-000006` | - | None. |
| 14 | **Compartment Diet Conflict Check** | `feed-loading.service.ts:71-97` | Prevent different bulk diets in same compartment on same vehicle/date. | Scoped to `(compartment_no, production_date, tenant_id)` for `LOADED`/`DISPATCHED` sheets. | **PASS** | Code verified with detailed conflict error message. | - | None. |
| 15 | **Loading Dispatch Requires Stock Transfer Shipment** | `feed-loading.service.ts:113` | Dispatch blocked until shared Stock Transfer shipment is posted. | Enforced by API; requires `shipment_id` before transitioning to `DISPATCHED`. | **PASS** | UAT verified | - | None. |
| 16 | **Loading Sheet Status after Full Receipt** | `feed-loading.service.ts:127` | Loading sheet transitions to `RECEIVED` when requisition is fully received. | Hook implemented; past UAT rows (`LOAD-000006`) remained `DISPATCHED` as pre-fix records. | **PASS** | Logic verified in code | - | None. |
| 17 | **Physical Stock Count Ledger Updates** | `feed-stock-count.service.ts`<br>`inventory-ledger.service.ts` | Physical stock count posts adjustments to ledger; updates subsequent forecast balance. | Verified: posts variance to inventory ledger; subsequent forecast uses adjusted balance. | **PASS** | 58 tests passing in `feed-stock-count` suites | - | None. |
| 18 | **Reporting Periods in Farm Operations** | `/master-data/reporting-period`<br>`configs.ts:50` | Business admin can configure and activate reporting periods. | Master data exists, activation workflow supported, forecast Period view loads periods. | **PASS** | Verified in master data specs and forecast tests | - | None. |

---

## 2. Categorized Findings Summary

### Fully Complete (PASS)
- Core Feed Forecast Engine, daily rundown, safety stock, and run horizon (7 to 45 days).
- Feed Forecast Saved Runs, JSON snapshot persistence, and read-only historical recall.
- Approved Requisition as Planned Incoming Stock on expected delivery date.
- Open Transfers arrival timing aligned with requisition line expected delivery dates.
- Create Requisition from Shortage dialog with prefilled data and approval workflow.
- All Farms default filter on both Common and Feed Requisition pages.
- Mill Consolidation eligible selection across farms and mandatory adjustment reasons.
- Consolidation prerequisite enforcement before feed requisition Release.
- Shared Stock Transfer shipment and partial/full receipt without ledger double-counting.
- Physical Stock Count variance approval and ledger posting.
- Retained weekly Feed Plan (Tentative vs Actual revisions).

### Blocked by Master Data / Test Data Configuration (Not Bugs)
- **Requisition Release Blocker:** Attempting to release a requisition whose `production_date` has no configured `bin_diet_assignment` for that exact date (e.g. date `2026-10-04`). Requisitions on configured dates (e.g. `2026-10-11`) release cleanly.
- **Mill BIN Missing:** Consolidation sheets showing `Not configured` for loading bins when the mill location does not have active children of type `BIN`. Resolved by configuring BINs under `Location Master`.

### Outdated Test Assertions Fixed During Audit
- Updated `feed-forecast.planned-incoming.spec.ts` to expect `expectedDate` property returned by `plannedIncomingFromRequisitions()`. Test now passes 100%.

---

## 3. Prioritized Codex Implementation Tasks

### Priority 0 (None — Critical Path is Intact)
All core transactions from Forecast → Requisition → Approval → Consolidation → Loading → Release → Shipment → Receipt → Ledger are working.

### Priority 1 (High Usability & Clarity)
1. **BIN Diet Assignment Link in Release Error Message:**
   - **File:** `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts` and `apps/web/src/components/console/inventory/feed-requisition-detail.tsx`
   - **Task:** When release is blocked due to missing date-specific BIN diet assignments, provide a direct link and explicit helper text: *"Configure an assignment for [Item] on [Date] in Master Data → Locations → BIN Diet Assignments"*.
2. **BIN Diet Assignment Shortcut in Inventory Setup:**
   - **File:** `apps/web/src/app/(app)/settings/inventory-setup/page.tsx`
   - **Task:** Add an informational card with a button linking to `/master-data/location?tab=bin-diet-assignment`.

### Priority 2 (Business Rule Hardening)
1. **Mill Approved Quantity Reasonability Guard:**
   - **File:** `apps/api/src/modules/procurement/feed-requisition/feed-consolidation.service.ts`
   - **Task:** Introduce a soft warning or percentage threshold (e.g. max 200% of requested quantity) in the consolidation dialog to prevent typos like allocating 3,000 KG for a 50 KG request without supervisor confirmation.
2. **Backfill Historical Loading Sheets Status:**
   - **Task:** Run an idempotent DB migration or script to update legacy pre-fix loading sheets whose linked requisitions are already `RECEIVED` to status `RECEIVED`.
