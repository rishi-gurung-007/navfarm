# Feed Forecast and Requisition Integration Design

**Date:** 2026-10-01  
**Owner and source of truth:** Rishi  
**Status:** Approved for implementation planning; implementation not started by this package

## Sources and precedence

1. Rishi's decisions recorded in `docs/decisions.md`, including the 30 Sep and
   1 Oct feed entries.
2. `NAVFarm_Feed forecast TDD with examples(Feed Forecast Engine).csv`, rows
   1–70. Its example column is illustrative data, not a production default.
3. The requisition header, line, action and validation specification supplied
   by Rishi in chat on 1 Oct 2026.
4. The earlier feed design and completed plans under `docs/superpowers/`.

When these sources differ, this document follows Rishi's later decision. It
does not infer values that remain absent from the client material.

## Outcome

NAVFarm keeps its existing feed engine, location topology, inventory ledger,
approval engine and requisition tables. The work adds the missing transaction
and audit boundaries around them:

- configurable company and farm feed-planning settings;
- a persisted, versioned forecast run;
- dated physical silo counts with reasoned and approved stock variance;
- a Feed Requisition tab under Feed Forecast;
- a complete common requisition approval → release → fulfilment state flow;
- distinct `FARM_MANAGER`, `STANDARD_USER` and LOB-wide Head of Farms access;
- base/local currency configuration and reproducible Finance escalation;
- inactive generated Reporting Period drafts that require review;
- additive, all-tenant migrations that preserve existing tester data.

The current application remains usable during the transition. Existing URLs,
API response fields and atomic stock-transfer posting remain compatible until
their callers have moved to the new workflow.

## Settled business decisions

### People and scope

| Persona | Stored user type | Scope | Feed authority |
|---|---|---|---|
| Head of Farms | `OPERATIONAL_ADMIN` | Authorized farms in the active LOB/operational area | View all scoped farms, receive escalations, approve where permitted |
| Farm Manager | `FARM_MANAGER` | One assigned active farm | Forecast, count review, system feed-draft approval, farm requisition work |
| Farm worker | `STANDARD_USER` | One assigned active farm | Permitted data entry, count entry and Open requisition editing only |

`HEAD_OF_FARM` is not a user type. Existing alert configuration using that
string is migrated to `OPERATIONAL_ADMIN`; the UI label is **Head of Farms**.

A person may not approve a manually created requisition they created. A
Farm Manager may approve a system-generated forecast draft for their farm. A
manual requisition created by that manager goes to Head of Farms or another
authorized approver.

### Currency and Finance escalation

- Company configuration explicitly selects both base and local currency.
- Base currency remains the accounting currency used by application amounts.
- Local currency is a converted display/reporting value. It is not inferred
  from Country Master.
- For a company and currency pair, the current exchange rate is the visible
  row with the newest `rate_date`; equal dates use newest `created_at`.
- The selected `rate_id`, numeric rate, base amount and local amount are
  snapshotted on the variance decision.
- Equal base and local currencies use rate 1 without an Exchange Rate row.
- A missing required rate blocks monetary evaluation; it never becomes 0 or 1.
- Finance escalation is triggered when absolute variance percentage is
  `>= 5.00%`.
- The monetary threshold is nullable and remains unconfigured until Triple C
  supplies it. Null does not mean zero.

### Time, forecast and deadlines

- Default forecast view is 7 days; maximum custom horizon is 45 days.
- Company timezone controls schedules and displayed deadlines. Triple C's
  initial configuration is `Africa/Harare`.
- Triple C's initial critical reminder is Friday 18:00 and submission cutoff
  is Saturday 12:00. These are settings, not code constants.
- Production date includes a configurable shift/slot.
- Company owns the general schedule, horizon, truck target, bulk multiple and
  warning percentage. Farm overrides are allowed only for the fields named in
  `docs/decisions.md`.
- Capacity colours are GREEN below 90%, AMBER from 90% through 100%, and RED
  above 100%.

### Silo topology and setup

- FARM, SHED, PEN and SILO remain `location_master` rows.
- `parent_location_id` remains the hierarchy: SHED → FARM, PEN → SHED,
  SILO → FARM.
- `silo_shed_link` remains the canonical many-to-many allocation.
- A shed linked to several positive-stock silos cannot have the same feed item
  in more than one of them.
- Supported silo capacity, threshold, reorder and handling fields live on the
  SILO Location Master row. The Silo Feed Setup screen is removed from
  navigation only after field, permission and validation parity is proven.

### Requisitions

- Approval and Release are separate states and actions.
- Common requisition type is Item, Fixed Asset or Service. Store applies only
  to Item; Fixed Asset and Service use Purchase.
- Purchase release records `BC_PENDING` while Business Central is not
  connected. It never reports a successful sync.
- Store release starts an internal transfer. Partial shipment and receipt are
  allowed; over-shipment and over-receipt are rejected.
- Direct Transfer posts the selected shipment and matching receipt together
  only for a user with the explicit permission.
- Lot/serial assignment is mandatory before shipment for tracked items and is
  copied automatically to receipt.
- Department validation uses Cost Center Master rows of type `DEPARTMENT`, not
  free-text comparison.
- Feed requisition remains one farm and one submission cycle per header, with
  silo/item demand as lines. It is shown as **Internal Feed Transfer**.
- Feed stops honestly at Approved until mill execution exists. No fake mill,
  loading, dispatch or BC records are created.

### Reporting periods and counts

- Generated July–June Reporting Periods are inactive `DRAFT` rows until an
  administrator reviews and activates them.
- Physical count is a dated transaction, available on demand and from a
  configurable schedule. Triple C's initial schedule is Sunday 08:00.
- Every nonzero variance requires an existing Reason Master row.
- A stock adjustment is posted only after the required approval. Posting uses
  the existing inventory ledger and financial posting path.

## Current-state traceability

| Requirement | Source | Current state | Planned treatment |
|---|---|---|---|
| Physical silo count and variance | CSV rows 3–18 | No feed-specific count transaction | Add count header/lines, approval and ledger adjustment |
| Nine-step dated forecast | CSV rows 19–30 | Engine, stock walk, lifecycle selection and draft logic exist | Preserve; add missing run persistence, configuration and boundary tests |
| Tentative vs Actual plan | CSV rows 31–44 | Not implemented | Deferred until the mill phase; five-week and ISO-week rules remain recorded |
| Farm Manager dashboard | CSV rows 45–64 | Forecast grid, stages, alerts and requisition status partly exist | Extend without replacing the grid; add count/run/requisition links |
| Flexible views | CSV rows 66–70 | Daily, weekly, period and custom exist | Preserve; persist run filters, cutoff, version and author |
| Reporting Period Master | CSV rows 4, 67 | Master exists; generation currently creates active rows | Change generated rows to inactive drafts; explicit activation |
| Silo topology | CSV rows 8–17, 24–29 | Many-to-many link and ledger-derived item exist | Preserve and exercise all four topology shapes |
| Feed alerts | CSV rows 50–64 | In-app alerts exist | Replace `HEAD_OF_FARM` recipient code and make schedules config-driven |
| Feed requisition | CSV rows 29–30, 61–64 | Draft, manual entry, submit and approval exist | Place as Feed Forecast tab; enforce roles/self-approval; stop at Approved |
| Common requisition | Rishi's requisition specification | Basic header/lines exist; full fields and release flow do not | Additive extension plus separate approval, release and fulfilment state |
| Store transfer | Requisition specification | Stock Transfer posts shipment and receipt atomically | Add staged shipment/receipt while preserving Direct Transfer wrapper |
| Currency | Rishi, 1 Oct | Masters/tables exist; `nf_devco` has no rate/config rows | Add company selection and newest-rate resolver; do not seed a customer rate |
| Roles | Rishi, 1 Oct | `OPERATIONAL_ADMIN`/`STANDARD_USER` exist; `FARM_MANAGER` does not | Extend hierarchy, DTOs, scope, permissions and UI |

## Domain boundaries and new records

### Configuration

Use a typed company/farm feed settings record rather than spreading new values
through UI-only JSON. Existing FARM/SILO columns remain readable during the
transition. The service resolves `farm override → company setting → documented
system fallback`; it never migrates CSV example values into customer rows.

Company currency configuration has one canonical base selection and one local
selection. `company_master.base_currency_id` remains canonical for base
currency. Company Currency Config identifies local currency. Saving either is
transactional and refuses duplicate base/local selections.

### Forecast run

A forecast run header stores company, farm, creator, creation time, farm-local
planning date, view, selected dates/period, source posting cutoff, configuration
version/hash and monotonically increasing farm run version. Run lines snapshot
the dated engine output and provenance needed to reproduce the displayed
answer. A requisition line references the run and originating run line where
applicable. Re-running never rewrites an approved run.

### Physical count

The count header owns farm, count date/time, schedule source, status, creator,
approval and posting references. Each line owns silo, item, system quantity,
counted quantity, signed variance, absolute percentage, Reason Master identity,
base/local valuation snapshots and selected rate snapshot. The transaction
states are `DRAFT → PENDING_APPROVAL → APPROVED → POSTED`, with `REJECTED`
returning to correction without posting.

### Common requisition

Keep `requisition` and `requisition_line` as the shared document. Extend them
instead of creating a parallel common-requisition table. Separate three state
dimensions:

- approval: `OPEN`, `PENDING_APPROVAL`, `APPROVED`, `REJECTED`;
- document: `OPEN`, `APPROVED`, `RELEASED`, `CANCELLED`;
- integration/fulfilment: `NOT_APPLICABLE`, `BC_PENDING`, `TRANSFER_OPEN`,
  `PARTIALLY_SHIPPED`, `SHIPPED`, `PARTIALLY_RECEIVED`, `RECEIVED`.

Existing `status` remains readable during migration and is mapped to the new
dimensions. API responses continue returning it until all current callers use
the explicit states.

### Transfer execution

`stock_transfer` remains the transfer order/header. Add shipment and receipt
documents for append-only partial events. Each event line references the order
line, quantity and its lot/serial allocations. Direct Transfer calls the same
shipment service and then the same receipt service in one transaction; it is
not a second posting implementation.

## UI structure

Inventory → Feed Forecast becomes one page with these tabs:

1. **Forecast** — existing filters, grid, stages and run history.
2. **Feed Requisition** — draft/list/detail for the selected farm and cycle.
3. **Physical Count** — count entry, variance and approval/posting status.

Common Requisition remains in the existing Approvals/Requisitions area because
it serves Item, Fixed Asset and Service. Old feed-requisition URLs redirect to
the Feed Forecast page with the Feed Requisition tab selected.

## Compatibility constraints

- Do not rename or drop existing feed, requisition, approval, ledger or transfer
  columns in the first release.
- Add nullable columns first, backfill only unambiguous identities, then enforce
  new service validation.
- Preserve `/feed-forecast`, `/feed-requisition` and existing redirects.
- Preserve existing atomic stock-transfer posting as the Direct Transfer
  compatibility path, implemented through the new shared services.
- Keep business status independent of external integration status.
- Do not change animal, breeding, costing or unrelated master workflows.
- All tenant migrations are additive and data-preserving. MySQL DDL requires a
  backup because it cannot be transactionally rolled back.

## Deferred scope

These remain out of the current implementation because the required system or
approved master does not exist:

- mill consolidation and capacity allocation;
- mill loading bins and loading sheets;
- dispatch and vehicle tracking;
- Transfer Order sync from Business Central;
- real Business Central purchase integration;
- Tentative/Actual weekly plan execution that depends on mill capacity;
- SMS, email or WhatsApp notifications.

Stable IDs and integration statuses must allow these to be added later without
rewriting approved NAVFarm documents.

## Acceptance boundary

The feature is complete only when:

1. focused rule/service tests pass at every state boundary;
2. full API/web tests and typechecks pass with no new lint failures;
3. migration SQL is reviewed, rehearsed on a disposable clone and idempotency
   or safe re-run behaviour is documented;
4. the running UI is exercised for `STANDARD_USER`, `FARM_MANAGER` and
   Head of Farms across all four silo topology shapes;
5. every API write used for verification is read back from MySQL;
6. unrelated workflows retain their existing behaviour;
7. test-server application remains blocked until backups, tenant inventory and
   explicit apply approval are supplied.
