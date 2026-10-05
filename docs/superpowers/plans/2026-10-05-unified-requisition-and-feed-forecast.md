# Unified Requisition and Feed Forecast Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the common/feed requisition split with one requisition document and correct Feed Forecast hierarchy,
run-down views, stock-count entry and Feed Plan.

**Architecture:** Keep one canonical requisition application service and document UI, with Feed Forecast acting as a
prefilled contextual entry point. Keep the forecast engine's daily projection authoritative; API view builders select and
group that projection for Daily/Weekly displays. Build Stock Count and Feed Plan as focused views over existing posting and
forecast evidence services.

**Tech Stack:** NestJS 11, Drizzle/MySQL, Next.js 16, React 19, Jest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-05-unified-requisition-and-feed-forecast-design.md`

## Global Constraints

- Rishi and `docs/decisions.md` override every older plan or workbook interpretation.
- Scope remains Triple C Piggery.
- Feed fulfilment is in-house; never claim BC success.
- Preserve `parent_location_id` and `silo_shed_link` topology, including 1:1, 1:N, N:1 and N:N.
- Data scripts are read-only by default, `--verify` rolls back and `--apply` commits.
- Tests are written failing first; final tasks run through `pnpm nx` and are verified in the UI and MySQL.

## Review Focus

- An existing stored FEED row remains readable/decidable while the canonical service transition is incomplete.
- Changing Farm, Shed, Purpose or Type cannot retain incompatible hidden IDs or lines.
- A shared silo balance is not subtracted once per batch, and weekly values use the actual daily closing series.
- An incoming delivery before/after run-down changes only the dates it should; no blank days or fabricated zeroes.
- Approve, Release, Ship and Receive remain distinct authorization and state transitions.

---

### Task 1: Lock compatibility and state contracts with failing tests

**Files:**
- Modify: `apps/api/src/modules/procurement/requisition/requisition.rules.spec.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition.feed-guard.spec.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.spec.ts`
- Modify: `apps/web/specs/requisition-navigation.spec.ts`
- Modify: `apps/web/specs/requisitions-hub.spec.tsx`

**Interfaces:**
- Produces: canonical user-facing types `ITEM | FA | SERVICE`, origins `MANUAL | FEED_FORECAST`, and independent
  approval/document/fulfilment state expectations.

- [ ] Write failing tests showing existing FEED rows in the one Requisition list and both manual/forecast entry points
  resolving to the same document shape and approval endpoints.
- [ ] Add assertions that the general Approvals inbox excludes requisition rows but links to the Requisition pending count.
- [ ] Run the targeted API/web Jest suites and confirm failures describe the current split guards/routes.
- [ ] Commit the contract tests.

### Task 2: Introduce the canonical requisition application service

**Files:**
- Create: `apps/api/src/modules/procurement/requisition/requisition-application.service.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Modify: both controllers and modules under those directories
- Test: corresponding service/controller specs

**Interfaces:**
- Consumes: the state/origin contract from Task 1.
- Produces: `create`, `update`, `submit`, `decide`, `release`, `ship`, `receive` commands shared by manual and forecast
  entry points; `/feed-requisition` becomes a compatibility facade.

- [ ] Add failing service tests for one Item/feed request created manually and from forecast.
- [ ] Implement the canonical command service by moving orchestration, not duplicating rules.
- [ ] Route both controllers through it and preserve existing URLs/responses during transition.
- [ ] Run targeted API tests and typecheck.
- [ ] Commit the service boundary.

### Task 3: Normalize persisted feed origin safely

**Files:**
- Modify: `apps/api/src/core/database/schema.ts`
- Create: next tenant migration and journal entry
- Create: `apps/api/src/scripts/normalize-feed-requisition-origin.ts`
- Modify: API project targets
- Test: migration and script specs

**Interfaces:**
- Produces: explicit request origin and compatibility mapping for existing `doc_type=FEED` rows.

- [ ] Write failing schema/script tests for plan, verify rollback, apply, idempotency and refusal on unsafe hosts.
- [ ] Add only the minimum additive columns/constraints required for origin and forecast evidence.
- [ ] Print the exact existing-row normalization plan; do not apply automatically.
- [ ] Run `--verify`, review the plan, then apply only to approved local tenants and query every changed row/table.
- [ ] Commit migration and script separately.

### Task 4: Build one Requisition document and dependent-field matrix

**Files:**
- Modify: `apps/web/src/components/console/requisitions/requisitions-hub.tsx`
- Modify: `apps/web/src/components/console/requisitions/common-requisition-document.tsx`
- Modify: `apps/web/src/components/console/requisitions/common-requisition-detail.tsx`
- Modify: `apps/web/src/components/console/requisitions/requisition-decision.tsx`
- Retire through compatibility wrappers: feed-specific document/header components
- Test: requisition hub/document specs

**Interfaces:**
- Consumes: canonical API from Task 2 and origin fields from Task 3.
- Produces: one list/dialog with the header and line rules in design §§3–4.

- [ ] Write failing component tests for every dependency reset and disabled/read-only field.
- [ ] Add feed items to Item requests without exposing a fourth user-facing type.
- [ ] Show origin once and render forecast evidence only when present.
- [ ] Preserve Approve/Reject, Release, Shipment, Receipt and Item Tracking against their independent states.
- [ ] Run targeted web tests, typecheck and lint.
- [ ] Commit the unified document UI.

### Task 5: Make Feed Forecast create/open the canonical document

**Files:**
- Modify: Feed Forecast requisition panel/dialog components
- Modify: forecast auto-draft API callers and specs
- Modify: old URL redirects/navigation specs

**Interfaces:**
- Produces: `Create requisition` prefilled with farm, shed, silo, item, required date, quantity and forecast evidence.

- [ ] Write failing tests that forecast creation and common-page manual creation return documents readable in both views.
- [ ] Replace feed-only mutation calls with the canonical commands while keeping the old route facade operational.
- [ ] Verify permissions and self-approval rules for Company Admin, Farm Manager and Standard User.
- [ ] Commit the contextual entry point.

### Task 6: Correct Daily and Weekly display horizons

**Files:**
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.engine.ts` only if projection exposure is required
- Modify: `apps/web/src/components/console/inventory/feed-forecast-grid.tsx`
- Test: view, engine, service and web grid specs

**Interfaces:**
- Produces: dated balances from selected date through latest displayed run-down; weekly end-of-bucket balances.

- [ ] Add the VIL100-shaped failing case: selected 5 Oct, run-down 21 Oct; Daily includes every date through 21 Oct and
  Weekly includes consecutive 7-day groups through the group containing 21 Oct.
- [ ] Add shared-silo, incoming, diet-change and no-run-down-within-horizon cases.
- [ ] Separate projection horizon from explicit Custom/Period display windows; do not expand those views.
- [ ] Render each row through its own zero date without inventing demand or subtracting stock per batch.
- [ ] Run targeted API/web tests and commit.

### Task 7: Add shared Farm → Shed → Silo selection and dashboard visuals

**Files:**
- Create: `apps/web/src/components/console/inventory/use-feed-location-selection.ts`
- Modify: `feed-forecast-tabs.tsx`, dashboard, calculation, requisition and count panels
- Modify: feed forecast DTO/controller/service option endpoints
- Test: selection and dashboard specs

**Interfaces:**
- Produces: one persisted selection shared by all Feed Forecast tabs and validated server-side.

- [ ] Write failing tests for parent filtering and invalid-child clearing.
- [ ] Add scoped shed/silo options based on `parent_location_id` and `silo_shed_link`.
- [ ] Add KPI cards and charts backed by API dated values; keep the workbook detail table below.
- [ ] Confirm many-to-many silo/shed examples do not assume a primary silo.
- [ ] Commit hierarchy and dashboard.

### Task 8: Move New Physical Stock Count into a dialog

**Files:**
- Create: `apps/web/src/components/console/inventory/feed-stock-count-dialog.tsx`
- Modify: `feed-stock-count-panel.tsx`
- Modify: feed stock count evidence response only for missing workbook fields
- Test: feed stock count specs

**Interfaces:**
- Produces: dialog input over the retained count list using one server evidence snapshot.

- [ ] Write failing tests that New opens a dialog and Cancel/Save returns to the unchanged list context.
- [ ] Add the workbook evidence fields and require a Reason for every nonzero variance.
- [ ] Keep approval/posting outside the entry dialog and on the created document.
- [ ] Run web/API tests and commit.

### Task 9: Implement Feed Plan Tentative versus Actual

**Files:**
- Create: focused API module under `apps/api/src/modules/inventory/feed-plan/`
- Create: focused web panel under `apps/web/src/components/console/inventory/`
- Modify: Feed Forecast tabs/navigation
- Create: additive migration for versioned plan header/lines if existing run tables cannot represent the contract
- Test: pure calculation, service and component specs

**Interfaces:**
- Produces: versioned weekly `TENTATIVE` and `ACTUAL` plan lines per farm/item.

- [ ] Write failing tests for five completed weeks, known population/diet adjustment, approved-requisition Actual and
  Actual-minus-Tentative variance.
- [ ] Implement versioned generation without overwriting approved/history rows.
- [ ] Show capacity as unavailable when configuration is absent; never substitute zero.
- [ ] Add comparison KPIs/chart/table and provenance links to source runs/requisitions.
- [ ] Run targeted tests and commit.

### Task 10: End-to-end verification and plan ledger

**Files:**
- Modify: `docs/superpowers/plans/feed-completion/progress.md`
- Modify: relevant verification document

**Interfaces:**
- Consumes: Tasks 1–9.

- [ ] Run `pnpm nx test api`, `pnpm nx test web`, affected typechecks and the no-new-lint gate.
- [ ] Drive ports 3002/2877 through manual and forecast-created requisitions, approval, release and permitted fulfilment.
- [ ] Verify every write in `nf_devco`, including approval history, requisition lines, stock counts, transfer/ledger/value
  evidence and saved forecast/plan versions.
- [ ] Exercise daily/weekly views on 1:1, 1:N, N:1 and N:N silo topologies.
- [ ] Append exact commits, commands and live/database evidence to the progress ledger.
- [ ] Commit the verification record.

## Execution order and estimate

Tasks 1–5 are the requisition convergence and must finish before Tasks 6–9. Tasks 6, 8 and 9 are independently
reviewable after the canonical document is stable; Task 7 supplies shared selection used by their final UI pass.

- Canonical requisition convergence and dependent forms: 10–14 agent hours.
- Forecast horizon, hierarchy and dashboard: 8–12 agent hours.
- Physical Count dialog and Feed Plan: 7–10 agent hours.
- Whole-scope review, running-app and database verification: 4–6 agent hours.
- Total for this correction plan: **29–42 agent hours**, normally **4–6 focused working days** on this machine.
