# Feed Forecast and Requisition Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the CSV-backed feed forecast workflow through physical-count posting and farm approval, add the supplied common requisition approval/release/transfer controls, and preserve all existing NAVFarm behaviour outside that scope.

**Architecture:** Extend the existing feed engine, approval engine, requisition document, Location Master, inventory ledger and stock-transfer posting path. New typed settings, forecast-run, stock-count and transfer-event records provide the missing audit boundaries. Compatibility fields and endpoints remain until current callers have moved; mill and real Business Central execution stay deferred.

**Tech Stack:** NestJS 11, Drizzle ORM and MySQL; Next.js 16 and React 19; Jest, Testing Library and Playwright; Nx via `pnpm nx`.

**Spec:** `docs/superpowers/specs/2026-10-01-feed-forecast-requisition-integration-design.md`

## Global Constraints

- Rishi and `docs/decisions.md` override every reference document.
- CSV example values are fixtures only. Never seed them as customer defaults.
- Piggery only. Do not add poultry, dairy or aqua screens.
- Existing feed calculations, silo topology, ledger posting and approval flows
  are preserved and extended, not replaced.
- Use `location_master` plus `silo_shed_link`; do not restore `feed_silo_id`.
- Use the shared inventory ledger and GL posting path; do not create a second
  item/value ledger.
- Business status and integration status stay independent.
- No fake mill, dispatch, Transfer Order or Business Central success state.
- New migrations are additive and data-preserving. One migration owner controls
  `apps/api/src/drizzle/tenant/*.sql` and `meta/_journal.json` for the whole plan.
- Data-changing scripts are read-only by default, `--verify` rolls back, and
  `--apply` commits.
- Do not apply migrations to the test server until every target has a verified
  backup, the tester-data inventory is reviewed and Rishi explicitly approves
  application.
- Run tests through Nx. Use at most two Jest workers on this 8 GB machine.
- Drive the running application and read MySQL after writes before claiming a
  task complete.
- Do not use `pkill`; stop only a confirmed PID.
- Do not modify unrelated animal, breeding, costing or master-data behaviour.
- Follow `apple.design.md`; use `Field`, `ReadField`, `FieldGroup`,
  `ConsolePage` and `PageHeader` rather than one-off form markup.
- Each completed task gets one focused commit and one progress-ledger entry.

## Baseline and resumability

- Starting branch observed while writing this plan:
  `fix/series-and-item-kinds-batch`.
- Starting commit: `c9886e85a26b2cfb8bd771716fb3a380cd56d7ca`.
- Latest tenant migration tag: `0134_animal_parent_serial_no`; local journal
  has 135 rows through timestamp `1792000000003`.
- Existing uncommitted decision work: `docs/decisions.md`. Preserve it.
- Progress ledger:
  `.superpowers/sdd/2026-10-01-feed-forecast-requisition-integration/progress.md`.
- Context snapshot:
  `.superpowers/sdd/2026-10-01-feed-forecast-requisition-integration/context.md`.
- Before resuming, read the spec, this plan, the handoff, the progress ledger,
  `docs/decisions.md`, `AGENTS.md`, `git status --short` and
  `git log --oneline -25`.
- A task is complete only when its ledger entry names the commit and exact test
  result. If a commit exists without a ledger entry, rerun its verification
  before recording completion.

## Review Focus

1. **Multiple rates for one pair:** current selection must use newest
   `rate_date`, then newest `created_at`, prefer the current company scope over
   a legacy tenant-wide row on an otherwise equal pair, and snapshot the result.
2. **Same person creates and approves:** manual self-approval must fail without
   changing either requisition or approval request; a system forecast draft may
   follow the explicitly allowed Farm Manager path.
3. **Partial tracked transfer:** shipment cannot exceed remaining quantity,
   receipt cannot exceed shipped quantity, and lot/serial identity must survive
   every partial event.
4. **Forecast rerun after approval:** a rerun creates a new run version and may
   update only an editable draft; it never rewrites an approved requisition or
   historical run.
5. **Missing Finance configuration:** a nonzero variance still requires a
   reason; missing local currency/rate or item value makes monetary evaluation
   visibly unavailable and blocks the Finance-dependent decision rather than
   silently treating it as zero.

## File ownership and task order

Only one agent at a time may own each row. Agents may work in parallel only
after the named producer interface has landed and only on disjoint files.

| Owner | Files/responsibility | Serial dependency |
|---|---|---|
| Access worker | user types, farm scope, auth payloads, role UI, alert-role mapping | Task 1 |
| Settings worker | feed settings, company currencies, rate resolver, reporting periods | Tasks 2–3 |
| Forecast worker | forecast run persistence and existing forecast UI/API integration | Task 4 |
| Count worker | physical count, variance, approval and ledger adjustment | Tasks 5–6 |
| Requisition worker | feed tab and common requisition states/APIs | Tasks 7–9 |
| Transfer worker | shipment/receipt events and tracking | Task 10 |
| Web integration worker | tabs, forms, permissions and compatibility redirects | Task 11 |
| Migration owner | every tenant SQL file and `_journal.json` change | Task 12 only |
| Verification owner | running app, API, MySQL and evidence document | Task 13 |

Dependency order:

`1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13`

Tasks 3 and 4 may run after Task 2 on disjoint files. Tasks 5–7 must remain
serial because they share forecast/requisition integration contracts. Tasks
8–10 remain serial because they share requisition and transfer state.

## Locked schema and API names

These names are part of the handoff contract. If an implementation constraint
requires a change, record a ruling before another task consumes it.

- `feed_planning_setting`: `setting_id`, `tenant_id`, `company_id`, nullable
  `farm_id`, `default_forecast_days`, `max_forecast_days`,
  `production_weekday`, `production_shift`, `submission_weekday`,
  `submission_time`, `reminder_weekday`, `reminder_time`,
  `physical_count_weekday`, `physical_count_time`, `truck_target_kg`,
  `bulk_multiple_kg`, `capacity_warning_pct`, `bag_tolerance_pct`,
  `finance_variance_pct`, nullable `finance_variance_amount`, `is_active`, audit
  columns. One active company row plus at most one active row per farm.
- `company_currency_config.is_local`: exactly one local currency per company;
  `company_master.base_currency_id` remains the base-currency authority.
- `feed_forecast_run`: `run_id`, `run_code`, `tenant_id`, `company_id`,
  `farm_id`, `version`, `planning_date`, `view`, `from_date`, `to_date`, nullable
  `period_id`, `source_cutoff_at`, `config_snapshot`, `created_by`,
  `created_at`. Unique `(farm_id, version)` and `(company_id, run_code)`.
- `feed_forecast_run_line`: `run_line_id`, `run_id`, `forecast_date`,
  `batch_id`, `shed_id`, `destination_location_id`, `required_item_id`,
  `current_item_id`, `head_count`, `feed_rate_kg`, `opening_stock_kg`,
  `confirmed_receipt_kg`, `daily_demand_kg`, `projected_closing_kg`, nullable
  `shortage_date`, `recommended_qty_kg`, nullable `required_on_date`, and
  `provenance_snapshot`.
- `feed_stock_count`: `count_id`, `count_no`, tenant/company/farm IDs,
  `counted_at`, `schedule_source`, `status`, nullable `approval_request_id`,
  nullable `stock_adjustment_id`, creator/approver/poster and audit timestamps.
- `feed_stock_count_line`: `count_line_id`, `count_id`, `silo_id`, `item_id`,
  `system_qty_kg`, `counted_qty_kg`, `variance_qty_kg`,
  `variance_pct_absolute`, nullable `reason_id`, nullable `unit_cost_base`,
  nullable `variance_value_base`, `base_currency_id`, `local_currency_id`,
  nullable `rate_id`, nullable `rate_snapshot`, nullable
  `variance_value_local`.
- Add to `requisition`: `requisition_date`, `main_location_id`,
  `requester_user_id`, `requester_name`, `requester_department_id`,
  `sender_department_id`, `approval_status`, `document_status`,
  `fulfilment_status`, `from_location_id`, `to_location_id`, `direct_transfer`,
  `integration_status`, `released_by`, `released_at`. Keep legacy `status` as a
  compatibility projection during this plan.
- Add to `requisition_line`: `from_location_id`, `to_location_id`,
  `qty_to_ship`, `qty_shipped`, `qty_to_receive`, `qty_received`. Compute
  Remaining to Receive and Balance to Ship; do not persist redundant totals.
  Existing `description` holds Fixed Asset/Service description.
- `transfer_shipment` and `transfer_shipment_line`: append-only partial shipment
  events linked to `stock_transfer` and `stock_transfer_line`.
- `transfer_receipt` and `transfer_receipt_line`: append-only partial receipt
  events linked to a shipment and its line.
- `stock_transfer_tracking_assignment`: pre-shipment lot/serial allocations per
  transfer line. Shipment copies assignments; receipt copies from shipment.
- API additions use existing module prefixes:
  `/feed-settings`, `/feed-forecast/runs`, `/feed-stock-count`,
  `/requisition/:id/{submit,release}`, and
  `/stock-transfer/:id/{shipment,receipt,direct-transfer}`.

---

### Task 1: Farm Manager user type and Head of Farms mapping

**Files:**

- Modify: `apps/api/src/common/user-type-hierarchy.ts`
- Modify: `apps/api/src/common/farm-scope.ts`
- Modify: `apps/api/src/modules/core/user/dto/user.dto.ts`
- Modify: `apps/api/src/modules/core/user/user.service.ts`
- Modify: `apps/api/src/modules/core/auth/auth.service.ts`
- Modify: `apps/api/src/modules/core/auth/strategies/jwt.strategy.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-alert/feed-alert.service.ts`
- Modify: `apps/api/src/modules/system/alert-rule/alert-rule.service.ts`
- Modify: `apps/web/src/hooks/useAuth.ts`
- Modify: `apps/web/src/components/console/team/user-access.ts`
- Modify: `apps/web/src/components/console/team/member-dialog.tsx`
- Test: adjacent `*.spec.ts` files plus
  `apps/web/specs/role-permissions-coverage.spec.ts`

**Interfaces:**

- Produces: `UserType` includes `FARM_MANAGER` between
  `OPERATIONAL_ADMIN` and `STANDARD_USER`.
- Produces: `resolveFarmScope` treats `FARM_MANAGER` as exactly one assigned
  farm while `OPERATIONAL_ADMIN` remains LOB/operational-area scoped.
- Produces: `normalizeFeedRecipientRole('HEAD_OF_FARM')` returns
  `OPERATIONAL_ADMIN` for legacy data reads.
- Preserves: `STANDARD_USER` stays farm-bound with no implicit management
  authority.

- [ ] Write failing hierarchy, assignment, JWT and farm-scope tests for all
      three personas and cross-farm rejection.
- [ ] Write failing alert visibility tests proving legacy `HEAD_OF_FARM`
      resolves to `OPERATIONAL_ADMIN` without creating a new user type.
- [ ] Run focused API/web tests and confirm the new expectations fail.
- [ ] Implement the hierarchy, validation, auth payload and scope changes.
- [ ] Update user-management labels so the stored value remains
      `OPERATIONAL_ADMIN` while the UI label is Head of Farms.
- [ ] Run focused tests, role-permission coverage and API/web typechecks.
- [ ] Commit and record the exact commands/results in the progress ledger.

### Task 2: Company feed settings, currencies and current-rate resolver

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Create: `apps/api/src/modules/inventory/feed-settings/feed-settings.module.ts`
- Create: `apps/api/src/modules/inventory/feed-settings/feed-settings.controller.ts`
- Create: `apps/api/src/modules/inventory/feed-settings/feed-settings.service.ts`
- Create: `apps/api/src/modules/inventory/feed-settings/feed-settings.rules.ts`
- Create: `apps/api/src/modules/inventory/feed-settings/dto/feed-settings.dto.ts`
- Create/Test: corresponding `*.spec.ts`
- Modify: `apps/api/src/modules/system/currency/currency.service.ts`
- Modify: `apps/api/src/modules/system/currency/dto/currency.dto.ts`
- Modify: `apps/api/src/modules/system/setup-wizard/setup-wizard.service.ts`
- Modify: `apps/web/src/components/console/companies/company-settings-view.tsx`
- Modify: `apps/web/src/modules/master-data/configs.ts`

**Interfaces:**

- Produces: `FeedSettingsService.resolve(companyId, farmId?)` returning the
  effective horizon, schedule, deadline, reminder, count time, capacity bands,
  percentage threshold and nullable amount threshold.
- Produces: `CurrencyService.currentRate(companyId, fromCurrencyId,
  toCurrencyId)` returning `{ rateId, rate, rateDate, createdAt, scope }` or a
  typed missing-rate result.
- Produces: transactional company currency save with canonical
  `company_master.base_currency_id` and one user-selected local currency.
- Constraint: base/local equal returns conversion rate 1 without a rate row.

- [ ] Write failing pure-rule tests for 7-day default, 45-day maximum,
      Friday 18:00, Saturday 12:00, Sunday 08:00, `Africa/Harare`, GREEN <90,
      AMBER 90–100, RED >100 and `>=5%` escalation.
- [ ] Write failing currency tests for company selection, newest `rate_date`,
      `created_at` tie-break, company-over-legacy precedence, equal currencies
      and missing rates.
- [ ] Write failing setup tests proving base and local are user-selected and
      local is not inferred from Country Master.
- [ ] Run focused tests and confirm failure.
- [ ] Add typed settings/configuration schema declarations and minimal service
      implementation. Do not write migration SQL in this task.
- [ ] Change rate creation's default source currency from hard-coded USD to the
      active company's base currency while preserving explicit from-currency.
- [ ] Add Company Settings controls using existing form primitives.
- [ ] Run focused API/web tests and typechecks.
- [ ] Commit and record the ledger entry.

### Task 3: Reporting Period drafts and explicit activation

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Modify: `apps/api/src/modules/master-data/reporting-period/reporting-period.service.ts`
- Modify: `apps/api/src/modules/master-data/reporting-period/reporting-period.dto.ts`
- Modify/Test: reporting-period rule/service specs
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`

**Interfaces:**

- Produces: generated periods with `status='DRAFT'`, `is_active=false`.
- Produces: explicit activation that validates overlaps at activation time.
- Preserves: Forecast Period lookup returns active periods only.

- [ ] Add failing tests proving generation never makes a period selectable.
- [ ] Add failing tests for review/edit then activation, overlap refusal and
      regeneration that does not duplicate drafts.
- [ ] Implement draft generation and explicit activation.
- [ ] Update web copy/actions so Generate means Generate drafts, not Activate.
- [ ] Run reporting-period and feed-forecast period tests plus web tests.
- [ ] Commit and record the ledger entry.

### Task 4: Persisted forecast runs and audit-safe reruns

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.service.ts`
- Create: `apps/api/src/modules/inventory/feed-forecast/feed-forecast-run.rules.ts`
- Create/Test: corresponding run specs
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts`
- Modify: `apps/api/src/modules/inventory/feed-forecast/dto/feed-forecast.dto.ts`
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Create: `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx`

**Interfaces:**

- Produces: immutable `feed_forecast_run` and `feed_forecast_run_line` records.
- Produces: `FeedForecastRunService.createRun(input, output, actor)` returning
  `{ runId, runCode, version }`.
- Produces: `GET /feed-forecast/runs` and
  `GET /feed-forecast/runs/:id` under existing farm scope.
- Consumes: effective settings from Task 2.
- Preserves: existing `GET /feed-forecast` response; persistence occurs through
  an explicit generate/save action so ordinary reads do not create rows.

- [ ] Add failing tests for run versioning, complete filter/cutoff snapshots,
      line provenance, farm scope and immutable approved history.
- [ ] Add a failing rerun test proving an approved requisition remains linked
      to its original run while a new editable draft may use the new run.
- [ ] Implement schema declarations and run service without migration SQL.
- [ ] Add explicit Generate/Save Run and run-history UI.
- [ ] Preserve the current read-only forecast endpoint and response fields.
- [ ] Run all feed-forecast/feed-requisition tests and typechecks.
- [ ] Commit and record the ledger entry.

### Task 5: Physical silo count transaction and variance calculation

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Create: `apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.module.ts`
- Create: `apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.controller.ts`
- Create: `apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.service.ts`
- Create: `apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.rules.ts`
- Create: `apps/api/src/modules/inventory/feed-stock-count/dto/feed-stock-count.dto.ts`
- Create/Test: corresponding `*.spec.ts`
- Modify: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts`

**Interfaces:**

- Produces: count states `DRAFT`, `PENDING_APPROVAL`, `APPROVED`, `POSTED`,
  `REJECTED`.
- Produces: `varianceFact(systemQty, countedQty, unitCost, currency)` with signed
  quantity, absolute percentage and base/local values.
- Consumes: Reason Master identity, Task 2 settings/current rate and existing
  ledger balance-as-of logic.
- Constraint: every nonzero variance requires `reason_id`; zero variance does
  not create an adjustment.

- [ ] Add failing boundary tests for zero system balance, positive/negative
      variance, exactly 5%, missing reason, missing cost, missing rate and equal
      base/local currencies.
- [ ] Add failing service tests for active farm silos only, item snapshot from
      ledger, dated/on-demand counts and duplicate count protection.
- [ ] Implement count schema declarations, rules, DTO, controller and service.
- [ ] Do not post inventory in this task.
- [ ] Run focused tests and API typecheck.
- [ ] Commit and record the ledger entry.

### Task 6: Count approval, Finance escalation and shared ledger posting

**Files:**

- Modify: `apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.service.ts`
- Modify: `apps/api/src/modules/production/approval/approval.service.ts`
- Modify: `apps/api/src/modules/production/approval/approval-posting.spec.ts`
- Modify: `apps/api/src/modules/inventory/stock-adjustment/stock-adjustment.service.ts`
- Modify: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts`
- Modify: `apps/api/src/modules/finance/journal/gl-posting.service.ts`
- Test: count, approval, stock-adjustment and ledger specs

**Interfaces:**

- Produces: `FEED_STOCK_VARIANCE` approval handler.
- Produces: idempotent `postApprovedCount(countId, actor)` that creates one
  stock adjustment and reuses existing inventory/GL posting.
- Constraint: `>=5%` requires Finance approval; below 5% requires Farm Manager
  approval. A configured monetary threshold may also require Finance later.
- Constraint: a count cannot become POSTED unless its approval path is complete.

- [ ] Add failing tests for Farm Manager versus Finance routing, exact 5%,
      self-approval, rejected correction and repeated post idempotency.
- [ ] Add a failing transaction test proving an inventory/GL error leaves the
      count approved but unposted, with no partial ledger evidence.
- [ ] Implement approval handler and posting through existing services.
- [ ] Trigger forecast invalidation/rerun availability after successful post;
      do not silently mutate an existing run.
- [ ] Run focused tests plus all approval/inventory tests.
- [ ] Commit and record the ledger entry.

### Task 7: Feed Forecast tabs and feed requisition boundary

**Files:**

- Modify: `apps/web/src/app/(app)/inventory/feed-forecast/page.tsx`
- Modify: `apps/web/src/components/console/inventory/feed-forecast-panel.tsx`
- Create: `apps/web/src/components/console/inventory/feed-forecast-tabs.tsx`
- Move/refactor: `apps/web/src/components/console/inventory/requisitions-panel.tsx`
  into a reusable feed-requisition panel without breaking its current caller
- Create: `apps/web/src/components/console/inventory/feed-stock-count-panel.tsx`
- Modify: old feed-requisition route redirects
- Modify: `apps/api/src/modules/procurement/feed-requisition/feed-requisition.service.ts`
- Modify/Test: feed requisition and web component specs

**Interfaces:**

- Produces tabs `forecast`, `feed-requisition`, `physical-count` selected by
  query parameter and preserved across redirects.
- Consumes: Tasks 4–6 APIs.
- Constraint: one header per farm/submission cycle; lines remain per silo/item.
- Constraint: no mill means an approved feed requisition stops at `APPROVED`.

- [ ] Add failing web tests for all three tabs, URL selection, shared farm
      context and preserved forecast state.
- [ ] Add failing API tests for system-draft approval by Farm Manager, manual
      self-approval rejection and approved-document immutability.
- [ ] Refactor the existing requisition panel into the new tab without
      duplicating its service or API.
- [ ] Keep old bookmarks working through redirects.
- [ ] Remove no existing route until its redirect test passes.
- [ ] Run feed forecast/requisition API and web tests plus typechecks.
- [ ] Commit and record the ledger entry.

### Task 8: Extend the common requisition document model

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Modify: `apps/api/src/modules/procurement/requisition/dto/requisition.dto.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts`
- Create: `apps/api/src/modules/procurement/requisition/requisition.rules.ts`
- Create/Test: requisition rules/service specs
- Modify: `apps/api/src/modules/core/user/dto/user.dto.ts`
- Modify: `apps/api/src/modules/core/user/user.service.ts`
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts`
- Modify: `apps/api/src/modules/master-data/location/location.service.ts`

**Interfaces:**

- Produces the supplied header fields: number/date, main/farm location,
  requester snapshots, requester/sender department IDs, type, purpose,
  from/to sub-location, direct-transfer flag and remarks.
- Produces line snapshots plus requested, to-ship, shipped, to-receive,
  received, remaining-to-receive and balance-to-ship quantities.
- Produces pure state/quantity validation functions used by Tasks 9–10.
- Consumes: Cost Center Master rows with `cost_center_type='DEPARTMENT'`.

- [ ] Add failing tests for Item/FA/Service field rules, Store/Purchase purpose,
      department identities, direct-transfer permission and derived balances.
- [ ] Add failing compatibility tests for existing FEED rows and old status
      response values.
- [ ] Implement additive schema declarations and service validation without
      migration SQL.
- [ ] Keep requester name/department as submission snapshots while retaining
      their source IDs.
- [ ] Run focused requisition, user and location tests.
- [ ] Commit and record the ledger entry.

### Task 9: Common requisition approval, release and integration status

**Files:**

- Modify: `apps/api/src/modules/procurement/requisition/requisition.service.ts`
- Modify: `apps/api/src/modules/procurement/requisition/requisition.controller.ts`
- Modify: `apps/api/src/modules/production/approval/approval.service.ts`
- Modify: `apps/api/src/modules/production/approval/dto/approval.dto.ts`
- Modify/Test: approval and requisition specs
- Modify: `apps/web/src/components/console/approvals/approvals-page-shell.tsx`
- Create: `apps/web/src/components/console/approvals/requisition-approval-detail.tsx`

**Interfaces:**

- Produces actions `submit`, `approve`, `reject`, `reopen`, `release` with
  separate approval/document/integration states.
- Produces Purchase release result `BC_PENDING` without an external call.
- Produces Store release result `TRANSFER_OPEN` and a transfer-order identity.
- Constraint: approval never implies release; release never bypasses approval.

- [ ] Add failing state-machine tests for every allowed and refused transition.
- [ ] Add failing manual self-approval tests for all user types.
- [ ] Add failing release-authorization tests for Procurement and sender
      department users.
- [ ] Implement transitions transactionally with audit history.
- [ ] Add approval-detail UI without changing unrelated approval documents.
- [ ] Run approval/requisition API and web tests.
- [ ] Commit and record the ledger entry.

### Task 10: Staged transfer shipment, receipt and Direct Transfer

**Files:**

- Modify: `apps/api/src/core/database/schema.ts`
- Create: `apps/api/src/modules/inventory/stock-transfer/transfer-execution.rules.ts`
- Create/Test: transfer-execution rule specs
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.controller.ts`
- Modify: `apps/api/src/modules/inventory/stock-transfer/dto/stock-transfer.dto.ts`
- Modify: `apps/api/src/modules/inventory/inventory-ledger/inventory-ledger.service.ts`
- Modify/Test: stock-transfer and ledger specs
- Modify: `apps/web/src/components/console/inventory/stock-transfer-panel.tsx`

**Interfaces:**

- Produces shipment and receipt event records with cumulative quantities.
- Produces `postShipment`, `postReceipt` and `postDirectTransfer` services.
- `postDirectTransfer` calls shipment then receipt in one transaction.
- Preserves the existing atomic `/stock-transfer/:id/post` route as a
  compatibility wrapper around Direct Transfer.

- [ ] Add failing tests for partial shipment/receipt, overages, department
      mismatch, lot/serial requirements, automatic receipt tracking and
      repeated-call idempotency.
- [ ] Add a failing test proving a receipt cannot precede shipment.
- [ ] Implement event schema declarations and shared posting services.
- [ ] Update UI buttons and cumulative quantity display.
- [ ] Run stock-transfer, inventory-ledger and web tests.
- [ ] Commit and record the ledger entry.

### Task 11: Permissions, navigation, copy and cross-cutting guards

**Files:**

- Modify: `apps/web/src/components/console/console-tabs/roles-tab.tsx`
- Modify: `apps/web/src/components/console/inventory/inventory-page-shell.tsx`
- Modify: `apps/web/src/utils/translations.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: relevant API controller `@RequirePermission` declarations
- Modify/Test: `apps/web/specs/role-permissions-coverage.spec.ts`
- Modify/Test: `apps/web/specs/nav-scope-consistency.spec.ts`
- Add focused component tests for persona-visible actions

**Interfaces:**

- Produces explicit grants for count entry/approve, requisition approve/release,
  shipment, receipt, Direct Transfer and Finance variance approval.
- Constraint: `STANDARD_USER` receives none of the privileged actions by user
  type alone.
- Constraint: Head of Farms visibility does not automatically grant document
  actions outside role permissions.

- [ ] Write failing guard tests for every API permission pair and UI action.
- [ ] Add role-template grants without overwriting customized tenant roles.
- [ ] Update navigation and labels, including Head of Farms and Internal Feed
      Transfer.
- [ ] Verify Silo Feed Setup is hidden only after Location/Feed Planning parity
      tests pass; otherwise leave it visible and record the blocker.
- [ ] Run all web specs and API permission coverage tests.
- [ ] Commit and record the ledger entry.

### Task 12: Author and rehearse additive tenant migrations

**Files:**

- Create: the next sequential files after
  `apps/api/src/drizzle/tenant/0134_animal_parent_serial_no.sql`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`
- Modify: current schema snapshot only through the approved Drizzle workflow;
  never edit `dist/drizzle`
- Create: focused migration/journal specs under `apps/api/src/scripts/` or the
  existing migration test location
- Update: `docs/deploy-rdp-windows.md` with preflight/postflight queries

**Interfaces:**

- Consumes all schema declarations from Tasks 2, 4, 5, 8 and 10.
- Produces reviewed SQL for settings/currency, forecast runs, physical counts,
  requisition extensions and transfer events.
- Produces data backfills only where identity is unambiguous.

- [ ] Reserve migration numbers in the progress ledger before creating files.
- [ ] Generate/review SQL and remove every destructive or unrelated statement.
- [ ] Add compatibility/backfill SQL for existing requisition/status rows and
      `HEAD_OF_FARM` alert values.
- [ ] Do not seed base/local currencies, exchange rates, monetary thresholds or
      client feed examples.
- [ ] Test migration ordering and `migrate-all-tenants` nonzero failure logic.
- [ ] Create a disposable rehearsal clone, record pre-migration row hashes,
      apply the real migrator, verify preservation and run it again safely.
- [ ] Run the new data-changing helper only in read-only and `--verify` modes on
      `nf_devco`; do not apply to any retained/test-server database.
- [ ] Commit all SQL/journal changes together and record rehearsal evidence.

### Task 13: Full verification and handoff

**Files:**

- Create: `docs/VERIFICATION-2026-10-01-feed-forecast-requisition-integration.md`
- Update: `docs/superpowers/handoffs/2026-10-01-feed-forecast-requisition-handoff.md`
- Update: `docs/decisions.md` only for implementation rulings approved by Rishi

**Interfaces:**

- Consumes all prior tasks.
- Produces final evidence; no feature code is added in this task.

- [ ] Run focused suites for access, settings/currency, reporting periods,
      forecast runs, stock counts, feed requisitions, common requisitions,
      approvals, transfers and ledger posting.
- [ ] Run `pnpm nx test api -- --maxWorkers=2 --skip-nx-cache`.
- [ ] Run `pnpm nx test web -- --maxWorkers=2 --skip-nx-cache`.
- [ ] Run `pnpm nx run-many -t typecheck -p api web web-e2e`.
- [ ] Run `pnpm nx lint web`; compare with the recorded baseline and allow no
      new errors.
- [ ] Drive the running UI at port 3002 and API at 2877 for all three personas,
      all four silo topology shapes and the state transitions in this plan.
- [ ] After every representative write, query MySQL for document, approval,
      event, ledger, journal and audit rows.
- [ ] Verify old URLs and API response fields still work.
- [ ] Record test-server migration as BLOCKED until backup, target inventory and
      explicit apply approval exist. Do not treat that block as feature failure.
- [ ] Write the verification report with PASS/FAIL/PENDING evidence and update
      the handoff to the exact next action.
- [ ] Request final code review before integration.

## Completion commands

```bash
pnpm nx test api -- --maxWorkers=2 --skip-nx-cache
pnpm nx test web -- --maxWorkers=2 --skip-nx-cache
pnpm nx run-many -t typecheck -p api web web-e2e
pnpm nx run api:build
pnpm nx run web:build
pnpm nx lint web
```

Migration verification also requires complete `db-migrate-all-tenants` output,
a search for `FAILED`, and a Drizzle-journal query for every registered tenant.
Those commands are executed only after the backup/application gate permits it.
