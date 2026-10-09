# Feed Forecast Pages, Calculation and Requisition Design

**Date:** 2026-10-08

**Owner and source of truth:** Rishi

**Related design:** `2026-10-08-feed-requisition-transfer-workflow-design.md`

**Supersedes:** earlier navigation, calculation-lifecycle and feed-requisition
entry-point statements that conflict with this document. It does not supersede
the approved common-requisition field contract or the feed transfer posting
design.

## 1. Outcome

Feed forecasting becomes one operational workspace with Dashboard,
Calculation, Feed Plan, Feed Requisitions and Physical Stock Count tabs. Feed
Planning remains a company-settings page because it owns calculation policy,
not calculated results. Reporting Period is exposed through the existing
master-data framework.

A user explicitly calculates and saves one current forecast for a farm and
selected range. A saved calculation persists until the user archives it. When
the calculation has a shortage, the user may open an editable prefilled Feed
Requisition dialog. The created requisition is the same document shown in the
Feed Forecast Requisitions tab and the main Requisition page.

An approved feed requisition contributes planned incoming stock on its
proposed delivery date. Once a linked stock transfer exists, the transfer
balance replaces that planned quantity; after receipt, the inventory ledger is
the source of truth. This prevents double counting while allowing the forecast
to continue after the expected delivery.

All existing master fields and persisted master columns are preserved. This
work may add only fields that are required by the approved workflow and are
not already represented by an existing field.

## 2. Page and navigation contract

### 2.1 Feed Forecast

`/inventory/feed-forecast` contains these tabs in this order:

1. **Dashboard** — selected-silo and farm-wide forecast summaries, alerts and
   linked requisition status.
2. **Calculation** — filter selection, explicit Calculate, saved result,
   archive and requisition creation.
3. **Feed Plan** — tentative demand compared with approved requisition,
   shipment and receipt quantities.
4. **Feed Requisitions** — feed-only contextual list using the canonical feed
   requisition records and dialogs.
5. **Physical Stock Count** — physical count entry and reconciliation.

The tabs share selected Farm, planning date and date/range context where those
values are applicable. Calculation displays the complete authoritative Farm
result; it does not provide separate Shed, Silo, Batch, Feed Item or Feed Type
result filters.

### 2.2 Main Requisition page

`/requisitions` lists common and feed requisitions. It supports Type, Farm and
Status filters, including **All Farms** where the caller has scope. It can
create a manual feed requisition and opens the same feed document used by the
Feed Forecast Requisitions tab.

Feed remains a separate document shape because its workbook header and line
fields differ from the stable common-requisition schema. Sharing the list and
business records does not merge the two forms or remove fields from either.

### 2.3 Transfers and alerts

`/inventory/transfers` remains the canonical shipment and receipt list. Feed
release, shipment and receipt follow the separately approved transfer-workflow
design and the shared stock-posting path.

`/alerts` remains the canonical alert list. Feed Forecast may summarize and
link to feed alerts without owning a second alert store.

### 2.4 Settings and masters

`/company/settings/feed` owns company feed-planning defaults and optional farm
overrides. It does not display calculated Feed Plan results.

`/settings/inventory-setup` retains Number Series and existing general
inventory controls. No master field or persisted master column is deleted as
part of removing or reorganizing duplicated non-master controls. A duplicated
control may be removed only after its canonical value remains available at the
approved settings/master location and existing data is preserved.

Reporting Period is listed through `/master-data/reporting-period`. The old
development-only `/settings/reporting-periods` page and Settings navigation
entry may be removed without a redirect after the master route is verified.

The existing master framework continues to own Location, Item, Reporting
Period, Breed Lifecycle Stage, Alert Rule and Production Slot. This design
does not replace those masters with new standalone pages.

## 3. Additive-only master-data rule

Before adding a master field, implementation must map the requirement against
the existing schema, DTO, service and master-data configuration. If an
existing field has the required business meaning, reuse it even when the UI
currently exposes it in the wrong section.

The implementation must not:

- drop, rename or repurpose an existing master column;
- remove an existing master form field;
- replace an existing value with a newly invented duplicate;
- delete master data during a migration;
- seed workbook examples as universal defaults.

A new master field is permitted only when no existing field represents the
approved value. Every new field must be additive, nullable or safely defaulted
for existing rows, scoped consistently with the owning master, and covered by
API and master-form tests.

Fields labelled Code or No. display only the code/number. Name and Description
fields display only their corresponding semantic value. Search results may
show those values in separate columns.

## 4. Feed-planning configuration

Company Feed Planning provides the default values used when a farm does not
override them:

- default and maximum forecast days;
- Bulk Truck Target KG;
- Bulk Order Multiple KG;
- safety stock and warning thresholds;
- production/submission/reminder/stock-count schedules;
- other already-approved company feed-planning controls.

Each farm may optionally override at least:

- Bulk Truck Target KG;
- Bulk Order Multiple KG;

Existing approved farm override fields remain available. New override columns
are added only for required values that have no existing representation.

Resolution is deterministic:

`effective value = populated farm override, otherwise company default`

Blank means inherit the company default. A deliberate numeric zero remains a
real configured value only where the corresponding business rule permits
zero. Validation rejects non-positive order multiples and truck targets.

Every saved forecast run snapshots its effective company/farm values and their
source (`FARM_OVERRIDE` or `COMPANY_DEFAULT`). Later configuration changes do
not rewrite an existing run or linked requisition.

## 5. Calculation lifecycle

### 5.1 Initial and filter state

Calculation opens without calculated rows. The user first selects the required
Farm and date/range controls. The screen explains which required control is
missing instead of showing `NaN`, `-`, an em dash or a misleading zero.

Farm, Planning Date, View and the applicable Date/Range/Reporting Period
controls occupy one row. The action for the current calculation state is
aligned at the right end of that row.

Pressing **Calculate** runs the authoritative server engine once for the whole
selected Farm and range. The returned Farm result is displayed in full.

### 5.2 Saving and reopening

**Save calculation** persists the exact inputs, effective settings, as-of
evidence and result lines. The current saved calculation reloads after page
refresh and remains visible until archived.

There is at most one non-archived current saved calculation per Farm,
regardless of its selected range. A different Farm may have its own current
calculation. To save another calculation for the same Farm, the user first
archives that Farm's current calculation. The API enforces the rule
transactionally; browser button state alone is not sufficient.

### 5.3 Delete calculation

The user-facing action is **Delete calculation**, but it archives/discards the
run instead of physically deleting audit evidence. Archiving:

- removes the run from the current Calculation view;
- enables a new calculation;
- preserves evidence needed by an already-created requisition;
- never deletes or invalidates the requisition;
- records who archived it and when.

Archived calculations may remain available through audit/history data, but
they are not restored as the current editable calculation.

## 6. Requisition creation from calculation

A saved calculation with a positive shortage exposes **Create Feed
Requisition**. The button opens the existing feed requisition dialog with
prefilled header and line values. The user may edit fields that are editable
under the feed requisition rules before creating or submitting the document.

The requisition is linked to the exact saved run. Creation does not recompute
the forecast and does not silently save a different run. A transactional
uniqueness rule permits only one requisition for the same saved run. After
creation the action becomes **View Requisition**.

The same record appears in:

- Feed Forecast → Feed Requisitions;
- the main Requisition page.

Manual feed requisition creation remains available from both requisition
surfaces. A manual requisition has no invented forecast-run link.

If an old calculation is archived after creating a requisition, a new
calculation may be saved. The new calculation includes any eligible approved
incoming quantity. It offers another requisition only when a genuine residual
shortage remains.

## 7. Planned incoming feed and forecast roll-forward

The dated balance is calculated as:

`closing = opening + confirmed receipts + planned eligible incoming - daily use`

The next date opens with the preceding date's closing balance.

An approved feed requisition with no linked transfer contributes its
outstanding requested quantity on the line's Proposed Delivery Date. The UI
labels it **Planned feed added** or **Approved requisition due** and shows the
requisition number. It is not labelled as a confirmed receipt.

To prevent double counting, source precedence is:

1. Approved requisition with no linked transfer: planned requisition quantity.
2. Linked open transfer: outstanding transfer quantity replaces the planned
   requisition quantity.
3. Posted receipt: inventory ledger quantity is actual stock; the matching
   planned/open quantity is reduced or removed.

Draft, pending, rejected and cancelled requisitions do not add projected
stock. Partial receipts use actual posted quantity plus only the remaining
open transfer quantity. Item, destination SILO and expected date stay aligned
to the requisition/transfer line; quantities are never aggregated across a
different item or destination.

## 8. Feed Plan

Feed Plan is an operational tab, not a settings page. It presents the same
authoritative calculation and linked document quantities rather than running a
second forecast engine.

At minimum it shows Farm, period/week, Feed Item, tentative demand, approved
requisition quantity, shipped quantity, received quantity, remaining quantity
and variance. Capacity fields appear only when their required configuration
exists; missing configuration is shown as **Not available**, not zero.

## 9. Deferred scope

Mill Consolidation, Loading Instruction Sheet and a dedicated Feed Transfer
Order Receipt page remain deferred. No consolidation prerequisite is added to
the current release workflow. Normal transfer shipment and receipt continue
through the approved shared transfer workflow.

No Business Central call, reference or success status is invented.

## 10. Failure handling and concurrency

- Calculate, save, archive and requisition creation are tenant/company/farm
  scoped on the server.
- Concurrent saves cannot create two current calculations for the same
  context.
- Concurrent requisition creation cannot create duplicate documents for one
  run.
- An archive request against a stale or already-archived run is idempotent or
  returns a specific conflict without deleting data.
- Missing defaults/overrides produce a specific configuration message.
- UI dialogs remain open and preserve entered edits after an API error.

## 11. Verification

Implementation follows test-driven development and verifies:

- settings resolution and snapshotting for company defaults and farm
  overrides;
- empty initial Calculation, explicit Calculate, save, reload and archive;
- one current run and one requisition per run under concurrent requests;
- the same feed requisition appearing on both requisition surfaces;
- daily roll-forward before, on and after a proposed delivery date;
- planned requisition → open transfer → posted receipt precedence, including
  partial receipt without double counting;
- additive-only master migration/config changes and preservation of every
  existing master field;
- Reporting Period through the shared master route;
- Nx API/web tests, typechecks and production build;
- browser operation on ports 3002/2877;
- MySQL read-back after saved run, archive, requisition, transfer and receipt
  writes.

Only after the running application and database confirm the complete workflow
may the work be reported complete.
