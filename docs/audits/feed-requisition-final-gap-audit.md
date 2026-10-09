# NAVFarm — Final Feed Forecast & Requisition Gap Audit

**Date:** 2026-10-09
**Worktree:** `/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`
**Branch:** `feat/feed-forecast-requisition-integration`
**HEAD Commit:** `429d2e82`
**Tenant Database:** `nf_devco`
**Status:** Complete evidence-based audit across source code, database schemas, unit/integration suites, and UAT write-paths.

---

## 1. Executive Summary

The core Feed Forecast, Feed Requisition, Common Requisition, Mill Consolidation, Loading Instruction Sheet, and Stock Transfer/Receipt workflows are **substantially implemented and functional in this worktree**.

Earlier assumptions that migrations 155–157 were unapplied were disproved by live database inspection:
- Tenant database `nf_devco` has migrations `0154`, `0155`, and `0156` recorded in `__drizzle_migrations`, and table `feed_loading_sheet` exists in MySQL.
- Consolidation sheets (`feed_consolidation`, `feed_consolidation_line`) and loading sheets (`feed_loading_sheet`) are actively created and queried.
- Real end-to-end UAT write-paths (`REQ-GRA100-2026-00010` → `CONS-202641-004` → `LOAD-000006` → `TR-000048` → `SH-2026-0039` → receipts `RC-2026-0044`/`RC-2026-0045`) executed cleanly without double-counting.

However, several real gaps and blocks exist that explain why operations failed during manual testing:

1. **Feed Requisition Release Prerequisite Block (CONFIGURATION / MASTER DATA):**
   - Release requires an active `bin_diet_assignment` row matching the exact requisition `production_date`, company, and feed item.
   - For example, requisition `REQ-LEX100-2026-00003` has `production_date = '2026-10-04'`. Existing assignments in `nf_devco` are only configured for `2026-10-11`.
   - The UI correctly displays this actionable prerequisite block, but users without awareness of the date-specific BIN diet master data perceive this as a broken Release button.
2. **BIN Diet Assignment UI Discoverability (UX / CONFIGURATION):**
   - The BIN Diet Assignment configuration exists under `Master Data → Locations → Tab "BIN Diet Assignments"` (`/master-data/location?tab=bin-diet-assignment`), not under `/settings/inventory-setup`.
   - Operators looking in Inventory Setup cannot find where to configure BIN diet assignments.
3. **Loading Sheet Final Receipt Lifecycle (MINOR DEFECT):**
   - In `feed-loading.service.ts:127`, `markReceivedForRequisition()` is wired, but historically existing loading sheets (e.g. `LOAD-000006`) remained in `DISPATCHED` if created before the latest hook updates. Fresh runs update to `RECEIVED` when all linked requisition lines are received.
4. **Mill Approved vs Requested Quantity (BUSINESS RULE VALIDATION):**
   - The mill consolidation service (`feed-consolidation.service.ts:130`) strictly requires an `adjustmentReason` whenever `millApprovedQtyKg !== requestedQtyKg`.
   - However, it currently does **not** enforce an upper limit on how much the mill can exceed requested quantities (e.g., mill can approve 3,000 KG for a 50 KG request as long as any reason string is provided).
5. **Reporting Periods vs Feed Forecast (SCOPE / INTEGRATION):**
   - Reporting Periods exist in `Master Data → Farm Operations → Reporting Periods` (`/master-data/reporting-period`).
   - Feed Forecast has a "Period" view that successfully reads periods covering the planning date up to the 45-day horizon. Monthly stock-take requirements remain linked to physical count schedules.

---

## 2. Requirement-by-Requirement Audit & Status

### Area 1: Feed Forecast Calculation, Dashboard & Run History
- **TDD Reference:** Rows 1–25, 60–75 (Feed Forecast Calculation, Run-down, Safety Stock)
- **Files:** `feed-forecast.engine.ts`, `feed-forecast.service.ts`, `feed-forecast-panel.tsx`, `feed-forecast-run.service.ts`
- **Current Behavior:**
  - Forecast computes batch lifecycle consumption, daily rundown, opening balance from ledger, and safety stock.
  - Run history persists and reproduces exact v3 JSON snapshots without recalculation.
  - Notes and Run History are rendered via dedicated accessible dialog modals.
- **Status:** **PASS**
- **Evidence:** Tested with 88 passing tests in `feed-forecast.service.spec.ts`, 32 tests in `feed-forecast-panel.spec.tsx`.

### Area 2: Incoming Stock from Approved Requisitions & Open Transfers
- **TDD Reference:** Feed Forecast §2 (Planned Incoming Stock)
- **Files:** `feed-forecast.service.ts:126-156`, `feed-forecast.service.ts:2000-2290`
- **Current Behavior:**
  - Approved feed requisitions with no linked transfer add planned incoming on their expected delivery date (`proposed_delivery_date ?? recommended_delivery_date ?? required_date`).
  - Open transfers (`loadDraftTransfers`) inherit the requisition line's expected delivery date rather than clamping incorrectly to transfer creation date.
  - Released transfers exclude posted ledger movements to prevent double-counting.
- **Status:** **PASS**
- **Evidence:** Tested with `feed-forecast.planned-incoming.spec.ts` (all 5 tests passing).

### Area 3: Shortage → Prefilled Requisition → Approval
- **TDD Reference:** TDD Rows 8–15
- **Files:** `feed-requisition.service.ts:previewFromRun()`, `createFromRun()`, `feed-requisition-from-run-dialog.tsx`
- **Current Behavior:**
  - A saved run with an actionable shortage enables "Create Feed Requisition".
  - Dialog opens prefilled with farm, silos, items, recommended quantities, and shortage dates.
  - After submission, approval workflow in `ApprovalService` transitions status to `APPROVED`.
- **Status:** **PASS**
- **Evidence:** Verified in UAT (`RUN-VIL100-20261009-001` → `REQ-VIL100-2026-00005`).

### Area 4: Common & Feed Requisition List & All Farms Filtering
- **TDD Reference:** TDD Requisition Header & Listing
- **Files:** `requisitions-panel.tsx`, `requisitions-hub.tsx`, `feed-farm-select.tsx`
- **Current Behavior:**
  - Both Common and Feed Requisition pages default to `All Farms` for authorized company-level users.
  - Feed list shows Location Master farm codes (`farm.code`) and names.
  - Feed-only actions (Consolidate) appear conditionally when eligible rows exist.
- **Status:** **PASS**
- **Evidence:** 26 passing tests in `requisitions-panel.spec.tsx`, 24 passing in `common-requisition-detail.spec.tsx`.

### Area 5: Mill Consolidation Selection, Adjustments & History
- **TDD Reference:** Mill Consolidation Sheet
- **Files:** `feed-consolidation.service.ts`, `feed-consolidation-dialog.tsx`, `/inventory/feed-consolidations`
- **Current Behavior:**
  - Shows eligible approved feed requisitions across permitted farms.
  - Enforces mandatory adjustment reasons for differences between requested and mill-approved KG.
  - Assigns weekly sheet numbers (`CONS-<YYYYWW>-<SEQ>`).
  - Finalizes sheet to `CONSOLIDATED` state.
- **Status:** **PASS**
- **Evidence:** UAT write-paths `CONS-202641-001` and `CONS-202641-004` verified in `nf_devco`.

### Area 6: Loading Instruction Sheets & Compartment Rules
- **TDD Reference:** Feed Loading Sheet
- **Files:** `feed-loading.service.ts`, `apps/web/src/app/(app)/inventory/feed-loading/page.tsx`
- **Current Behavior:**
  - Draft loading sheet created automatically upon consolidation creation.
  - Requisition lines, mill-approved quantities, loading BINs, and destination silos are linked.
  - Requires compartment number and KG loaded before dispatch.
  - Prevents different bulk diets in the same compartment on the same vehicle/operation date.
  - Requires a posted shared Stock Transfer shipment before dispatch.
- **Status:** **PASS**
- **Evidence:** Tested with `LOAD-000001`, `LOAD-000002`, and `LOAD-000006`.

### Area 7: Release → Stock Transfer → Shipment → Receipt
- **TDD Reference:** Requisition Fulfilment & Stock Transfer
- **Files:** `feed-requisition.service.ts:release()`, `stock-transfer.service.ts`
- **Current Behavior:**
  - Feed release generates BIN-to-SILO Stock Transfers using `mill_approved_qty_kg`.
  - Blocked if requisition is not in a finalized consolidation.
  - Blocked if exact-date `bin_diet_assignment` is missing for the production date.
  - Partial shipment and partial receipts post accurately to Inventory Ledger without over-receipt.
- **Status:** **PASS** (with prerequisite configuration)
- **Evidence:** 41 passing tests in `stock-transfer.service.spec.ts`, 3 passing in `feed-requisition.release.spec.ts`.

### Area 8: Feed Plan (Tentative vs Actual)
- **TDD Reference:** Retained Weekly Feed Plan
- **Files:** `feed-plan.service.ts`, `feed-plan-panel.tsx`
- **Current Behavior:**
  - Persists weekly versions `PLAN-<FarmCode>-<YYYYWW>-R<seq>`.
  - Tentative plan generated from saved forecast; Actual plan generated from approved requisition lines.
  - Mill-approved quantities reflect consolidation allocations.
- **Status:** **PASS**
- **Evidence:** Tested with `PLAN-VIL100-202643-R02` in `nf_devco`.

### Area 9: Physical Stock Count & Ledger Updates
- **TDD Reference:** Physical Stock Take & Variance Posting
- **Files:** `feed-stock-count.service.ts`, `feed-stock-count-panel.tsx`
- **Current Behavior:**
  - Reads active silo balances, records physical counts, requires variance reasons.
  - Approved count posts variance to Inventory Ledger via `StockAdjustmentService`.
  - Subsequent forecast begins immediately from adjusted balance.
- **Status:** **PASS**
- **Evidence:** 58 passing tests in `feed-stock-count.service.spec.ts` and `feed-stock-count.approval.spec.ts`.

---

## 3. Confirmed Root Causes of User Testing Issues

| Reported Issue | Actual Root Cause | Bug vs Config | Required Action |
|---|---|---|---|
| **"Valid consolidated requisition cannot Release"** | Requisition `production_date` (e.g. `2026-10-04` on LEX100) has no active `bin_diet_assignment` row for that exact date and diet. Existing assignments were seeded for `2026-10-11`. Release requires this date-specific assignment by design. | **CONFIGURATION / DATA** | Either create assignments for the historical test dates or set requisition production dates to configured dates (`2026-10-11`). Clarify message in UI. |
| **"Cannot find where to configure BIN/diet assignment"** | BIN Diet Assignment was registered under Location master tab (`/master-data/location?tab=bin-diet-assignment`), not in Inventory Setup (`/settings/inventory-setup`). | **UX / DISCOVERABILITY** | Add a direct link or embedded card in `/settings/inventory-setup` pointing to BIN Diet Assignments. |
| **"Mill approved quantity greatly exceeds requested quantity"** | The API only checks `approved >= 0` and requires `adjustmentReason` when different. It does not enforce a percentage or multiple ceiling (e.g. approving 3,000 KG on a 50 KG request). | **VALIDATION GAP** | Add configurable or sensible upper bounds (e.g. warning or block if > 200% of requested). |
| **"Loading Sheet final status after receipt"** | `markReceivedForRequisition()` was implemented, but old test records created before the hook remained in `DISPATCHED`. | **DATA / TEST ARTIFACT** | Working for new flows; historical test records remain as audit evidence. |
| **"Compartment conflict validation scope"** | Validation correctly checks `(compartment_no, production_date, tenant_id)` where status is `LOADED` or `DISPATCHED` across other loading sheets. | **WORKING AS DESIGNED** | Provide clear error indicating conflicting sheet and diet. |

---

## 4. Work Remaining for Codex

See [`docs/uat/feed-requisition-acceptance-matrix.md`](./feed-requisition-acceptance-matrix.md) for the complete acceptance matrix and prioritized tasks.
