# Feed Requisition Transfer Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working Release, Transfer Shipment and Transfer Receipt header actions to feed requisitions, backed by exact mill-BIN assignments, one-to-many transfer links and aggregate fulfilment, while displaying one semantic value per feed field.

**Architecture:** Feed remains a separate requisition document. Release runs in one tenant transaction, resolves every line against an exact active BIN assignment, groups by assignment and destination SILO, and creates linked stock transfers through a restricted internal stock-transfer path. Existing shipment/receipt posting remains authoritative; its requisition synchronizer is extended to aggregate all transfers linked to the feed requisition.

**Tech Stack:** NestJS 11, Drizzle/MySQL, Jest, Next.js 16, React 19, Testing Library, Nx/pnpm.

**Spec:** `docs/superpowers/specs/2026-10-08-feed-requisition-transfer-workflow-design.md`

## Global Constraints

- Work only in `.worktrees/feed-forecast-requisition-integration`; preserve unrelated dirty changes.
- Feed remains `IN_HOUSE`; do not add Business Central calls or success states.
- Mill Consolidation remains out of scope.
- Header workflow buttons are always visible and server authority/state determines whether they are enabled.
- Save/Submit and Reject/Approve remain in the fixed dialog footer.
- Code/No./Name/Description fields display only the value promised by their label; Reason is its own column.
- Release requires one unambiguous active assignment on the exact requisition `production_date`; no later-date fallback.
- All transfer posting goes through `StockTransferService`; do not write inventory ledger rows from the feed service.
- Run tasks through `pnpm nx`; web remains on 3002 and API on 2877.
- Do not seed MILL, BIN, assignment or feed examples in a migration.

## Review Focus

- Two simultaneous Release requests must create one transfer set, not duplicates; Task 4 adds a concurrent/idempotent release test.
- One requisition using two BINs or SILOs must retain independent transfer balances while Fulfilment aggregates them; Tasks 3–5 test this.
- Multiple exact assignments for one item/date without a selected slot must block all transfer creation; Task 4 tests atomic refusal.
- A shipment/receipt caller outside the source/destination scope must be refused even when the dialog was readable; Tasks 3 and 5 test service enforcement.
- A legacy common requisition with `linked_transfer_id` must keep its existing fulfilment behavior; Task 2 retains and extends the common-transfer tests.

---

### Task 1: Persist explicit feed requisition transfer links

**Files:**
- Create: `apps/api/src/drizzle/tenant/0152_feed_requisition_transfers.sql`
- Create: `apps/api/src/drizzle/tenant/feed-requisition-transfer-migrations.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`
- Modify: `apps/api/src/core/database/schema.ts`

**Interfaces:**
- Produces: `schema.feedRequisitionTransfer` with `link_id`, `tenant_id`, `requisition_id`, `transfer_id`, `bin_assignment_id`, `created_by`, `created_at`; unique `transfer_id` and unique `(requisition_id, transfer_id)`.

- [ ] **Step 1: Write the failing migration spec** asserting journal index `152`, additive-only SQL, all three foreign keys, tenant/requisition and assignment indexes, and both uniqueness constraints.
- [ ] **Step 2: Run** `pnpm nx test api -- --testPathPatterns=feed-requisition-transfer-migrations`; expect failure because migration/schema are absent.
- [ ] **Step 3: Add the Drizzle table and reviewed migration**. Use `ON DELETE CASCADE` for requisition links, `ON DELETE RESTRICT` for transfer and assignment evidence, and no data inserts.
- [ ] **Step 4: Re-run the focused migration spec**; expect PASS.
- [ ] **Step 5: Commit** the migration, journal, schema and spec with a message explaining that feed release can own several transfers while common requisitions retain `linked_transfer_id`.

### Task 2: Aggregate requisition fulfilment across linked transfers

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition-fulfilment.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition-fulfilment.spec.ts`

**Interfaces:**
- Consumes: `schema.feedRequisitionTransfer` from Task 1.
- Produces: unchanged `syncRequisitionFulfilment(db, transferId): Promise<void>`, now resolving either a common singular link or a feed multi-link and summing all posted events for that requisition.

- [ ] **Step 1: Add failing tests** for two feed-linked transfers contributing to one line, different lines on different transfers, final `RECEIVED` only after every line is received, a foreign requisition-line link rolling the posting back, and the existing common singular link remaining unchanged.
- [ ] **Step 2: Run** `pnpm nx test api -- --testPathPatterns=requisition-fulfilment`; expect the multi-transfer cases to fail.
- [ ] **Step 3: Extend the synchronizer** to locate the requisition through either link shape, validate the triggering transfer's requisition-line ownership, aggregate shipment/receipt events by all lines belonging to that requisition, then update line totals and `fulfilment_status` once.
- [ ] **Step 4: Re-run the focused suite**; expect PASS.
- [ ] **Step 5: Commit** the synchronizer and tests.

### Task 3: Add the restricted mill-BIN transfer creation path

**Files:**
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.spec.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.requisition-guard.spec.ts`

**Interfaces:**
- Produces: `createForFeedRelease(dto: CreateStockTransferDto, tenantId: string, userPayload?: { userId?: string; userType?: string; email?: string }): Promise<{ transfer_id: string; transfer_no: string }>`.
- Contract: callable only from a tenant transaction; source must be an active `BIN` whose parent is an active `MILL` in the same company, destination must be an active `SILO` on the resolved requisition farm, and every line must carry `requisition_line_id`.

- [ ] **Step 1: Add failing service tests** for valid BIN→SILO creation, BIN without MILL parent, inactive/wrong-company source or destination, destination outside the requisition farm scope, a line without `requisition_line_id`, and sequential transfer-number allocation for two groups.
- [ ] **Step 2: Run** `pnpm nx test api -- --testPathPatterns='stock-transfer.(service|requisition-guard)'`; expect the new interface tests to fail.
- [ ] **Step 3: Refactor the existing insert/number/audit core into a private shared method**, retaining public `create()` validation unchanged, then implement `createForFeedRelease()` with the stricter topology checks and transaction join.
- [ ] **Step 4: Re-run the focused suites**; expect PASS and no weakening of manual-transfer guards.
- [ ] **Step 5: Commit** the internal creation path and tests.

### Task 4: Implement atomic feed Release

**Files:**
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition-transfer.rules.ts`
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition-transfer.rules.spec.ts`
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.release.spec.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.module.ts`

**Interfaces:**
- Produces: `groupFeedTransferLines(lines, assignments): FeedTransferPlan[]` keyed by `(assignmentId, destinationLocationId)`.
- Produces: `FeedRequisitionService.release(id, tenantId, user): Promise<FeedRequisitionView>`.
- Consumes: `StockTransferService.createForFeedRelease()` and `schema.feedRequisitionTransfer`.

- [ ] **Step 1: Add failing pure-rule tests** for grouping same assignment/destination, splitting different BIN assignments or SILOs, preserving requisition line IDs and KG quantities, and refusing missing/ambiguous assignments.
- [ ] **Step 2: Add failing service tests** proving Release locks the feed requisition, requires Approved/Open plus approve permission, queries active exact-date assignments, validates destination SILOs, creates and links every plan in one transaction, writes `document_status='RELEASED'` and `fulfilment_status='TRANSFER_OPEN'`, and is idempotent/concurrency safe.
- [ ] **Step 3: Run** `pnpm nx test api -- --testPathPatterns='feed-requisition.(transfer.rules|release)'`; expect failure.
- [ ] **Step 4: Implement the pure planner and transactional service method**. A missing production date, no assignment, or multiple matching assignments must name the affected line/item and abort before any transfer survives.
- [ ] **Step 5: Import `StockTransferModule` in the feed module and re-run the focused tests**; expect PASS.
- [ ] **Step 6: Commit** feed Release and its tests.

### Task 5: Add feed shipment/receipt commands and transfer-rich read model

**Files:**
- Modify: `apps/api/src/modules/procurement/feed-requisition/dto/feed-requisition.dto.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.controller.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Create: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.transfer-execution.spec.ts`
- Modify: `apps/api/src/common/farm-scope-coverage.spec.ts`

**Interfaces:**
- Produces `FeedRequisitionEventLineDto { requisition_line_id: string; quantity: number }`, `FeedRequisitionShipmentDto { transfer_id, posting_date, lines: FeedRequisitionEventLineDto[] }`, and `FeedRequisitionReceiptDto extends FeedRequisitionShipmentDto { shipment_id }`.
- Produces routes `POST /feed-requisition/:id/release`, `/:id/shipments`, `/:id/receipts`.
- Produces view members `approval_status`, `document_status`, `fulfilment_status`, `actions`, and `transfers[]` with transfer lines, cumulative balances and open shipments.
- `actions` shape: `{ release: { enabled, reason }, shipment: { enabled, reason }, receipt: { enabled, reason } }`.

- [ ] **Step 1: Add failing execution/read-model tests** for selecting only a transfer linked to this feed requisition, mapping requisition line IDs to transfer line IDs, posting through `StockTransferService`, refreshed view return, multiple linked transfers, partial balances, receipt tied to its shipment, and source/destination scope refusal.
- [ ] **Step 2: Run** `pnpm nx test api -- --testPathPatterns='feed-requisition.(transfer-execution|service)'`; expect failure.
- [ ] **Step 3: Add validated DTOs and controller routes** using `PROCUREMENT/REQUISITION/approve` for Release, `INVENTORY/STOCK_TRANSFER/edit` for Shipment, and `PROCUREMENT/REQUISITION/view` plus server destination checks for Receipt.
- [ ] **Step 4: Implement service posting and read-model queries**. Map each payload requisition-line ID to the selected transfer's own line ID, return independent states, all linked transfers/event balances, separately named reason values, and enabled/blocked actions from server permission, state and exact-assignment preflight.
- [ ] **Step 5: Re-run focused API tests and `farm-scope-coverage`**; expect PASS.
- [ ] **Step 6: Commit** the API commands and read model.

### Task 6: Correct feed line semantic values

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-requisition-document.tsx`
- Modify: `apps/web/specs/feed-requisition-document.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: API `reason_code` and `reason_name` from Task 5.
- Produces: a separate `Reason` table column; closed Silo Code and Feed Item No. controls show only code/number while lookup rows expose separate code and name/description columns.

- [ ] **Step 1: Replace the old code-plus-name expectations with failing semantic-field tests**: read-only Silo Code contains only code; Item Description has no reason text; Reason shows only reason name; selected controls show only code/number; lookup remains searchable by both values.
- [ ] **Step 2: Run** `pnpm nx test web -- --testPathPatterns=feed-requisition-document`; expect failure against the current combined labels.
- [ ] **Step 3: Update view types and line markup**, add `rqdColReason`, stop using `locationLabel()` in Silo Code, configure `SearchableSelect` selected labels/columns correctly, and keep `ReasonSelect` in the new Reason cell while editable.
- [ ] **Step 4: Re-run the focused web suite**; expect PASS.
- [ ] **Step 5: Commit** the semantic display correction.

### Task 7: Render and operate feed header workflow controls

**Files:**
- Modify: `apps/web/src/components/console/inventory/feed-requisition-detail.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-requisition-document.tsx`
- Modify: `apps/web/specs/feed-requisition-detail.spec.tsx`
- Modify: `apps/web/src/utils/translations.ts`

**Interfaces:**
- Consumes: Task 5 `actions` and `transfers` view shape.
- Produces: fixed `DialogHeaderActions` with Release, Transfer Shipment and Transfer Receipt; transfer-aware shipment/receipt panels; existing fixed `DialogFooterActions` unchanged.

- [ ] **Step 1: Add failing component tests** proving all three header buttons remain visible for Draft, Pending, Approved, Released and Received views; only server-enabled actions can run; footer Save/Submit remains fixed; blockers are exposed as tooltips/text.
- [ ] **Step 2: Add failing interaction tests** for Release refresh, selecting one of multiple transfers, bounded shipment quantities, selecting an open shipment for receipt, posting correct payloads, refreshed balances, and preserved panel input after an API error.
- [ ] **Step 3: Run** `pnpm nx test web -- --testPathPatterns=feed-requisition-detail`; expect failure because no header action bar exists.
- [ ] **Step 4: Implement the header action bar and panels** by adapting the common requisition interaction pattern without moving draft/approval footer controls. Use server action states rather than role-name inference.
- [ ] **Step 5: Re-run focused feed document/detail suites**; expect PASS.
- [ ] **Step 6: Commit** the feed dialog workflow UI.

### Task 8: Full verification, migration check and running-app proof

**Files:**
- Modify: `docs/decisions.md` only if implementation reveals a correction to the approved decision.
- Modify: `docs/superpowers/plans/2026-10-08-feed-requisition-transfer-workflow.md` to check completed steps and record exact evidence.

**Interfaces:**
- Produces: verified schema, API, UI and database evidence; no new product behavior.

- [ ] **Step 1: Run focused suites**: `pnpm nx test api -- --testPathPatterns='feed-requisition|requisition-fulfilment|stock-transfer|feed-requisition-transfer-migrations'` and `pnpm nx test web -- --testPathPatterns='feed-requisition'`; expect PASS.
- [ ] **Step 2: Run full gates**: `pnpm nx test api`, `pnpm nx test web`, `pnpm nx run-many -t typecheck -p api,web,web-e2e`, `pnpm nx build web`, and `git diff --check`; expect no new failures.
- [ ] **Step 3: Run the tenant migration workflow read-only/verify first**, inspect every tenant result and Drizzle journal, then apply only to the local development database after confirming the target. Query `feed_requisition_transfer` and its constraints afterward.
- [ ] **Step 4: Drive the running app on 3002/2877** through Approved → Release → partial Shipment → partial/final Receipt with at least two transfer groups. Confirm buttons/states, semantic field values and error recovery visually.
- [ ] **Step 5: Query MySQL after each write** for requisition states, feed-transfer links, stock transfer lines, shipment/receipt events, inventory ledger quantity/rate/amount and final `RECEIVED` fulfilment.
- [ ] **Step 6: Run the verification-before-completion skill, record results in this plan, and commit only the files owned by this implementation.**

## Verification carry-forward — 2026-10-08

The transfer implementation remains covered by the final branch-wide gates:
API **198 suites / 2,549 tests**, Web **98 suites / 727 tests**, all three
typechecks and the production Web build passed. Migrations 0152 and 0153 were
applied to both local tenant databases after backup and read-only inspection;
the feed-requisition transfer table, foreign/unique indexes and saved-run
archive/uniqueness indexes were verified directly in MySQL. The new Feed Plan
reads the same canonical requisition line, linked transfer, shipment and receipt
tables, so it does not introduce a second fulfilment state or posting path.

The completion audit added the missing operational setup surface through the
shared Location master tabs (Production Slots and BIN Diet Assignments), with
no seeded example data. The live approved feed document now renders all three
header actions and disables Release with its exact item/date assignment
blocker instead of allowing a predictably failing click. Final gates were API
**199 suites / 2,553 tests**, Web **98 suites / 729 tests**, all typechecks and
the 76-route production build. A live posting chain remains data-dependent:
the local tenant has no real BIN/slot/assignment, and verification did not
invent one.

## Verification carry-forward — 2026-10-09

Feed Mill Consolidation is now implemented as the next feed-only workflow
step: approved, unlinked requisitions are queried across permitted farms; the
UI offers requisition-number multi-select or a required date range; and
creation writes a weekly consolidation header/lines and marks the requisitions
`IN_CONSOLIDATION`. Diet No. comes from Item Master. Loading-bin and available
mill-output values remain `Not configured` until those masters are configured.
The cycle guard permits a new silo/item request after `RECEIVED` and keeps
blocking partial/open fulfilment. BC push, Loading and TO Receipt remain
deferred. API/web typechecks, focused API suites (86 tests), focused web suites
(62 tests), migration checks (4 tests), and `git diff --check` passed; tenant
migration application could not connect to the configured master database.
