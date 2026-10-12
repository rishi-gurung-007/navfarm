# Feed Requisition Transfer Workflow Design

**Date:** 2026-10-08

**Owner and source of truth:** Rishi

**Supersedes:** the feed-workflow boundary in the 2026-10-08 final common
requisition decision and earlier decisions that stopped feed requisitions at
Approved.

## 1. Outcome

The Feed Forecast Requisition dialog remains a feed-specific document with its
workbook header and line fields, but it gains the operational header workflow
needed to fulfil an approved request:

`Approve → Release → Transfer Shipment → Transfer Receipt`

Release resolves every feed line to the active mill BIN assignment for that
line's feed item/diet and production date. Because one requisition may be
supplied by several BINs and may deliver to several farm SILOs, release creates
separate stock transfers for different source-assignment/destination pairs.
Shipment and receipt continue through the existing shared stock-transfer
posting service so inventory and valuation are posted only once and feed
fulfilment is calculated from posted quantities.

Mill Consolidation remains out of scope for this change. No Business Central
call or fake integration success is added. The current fulfilment mode remains
`IN_HOUSE`.

## 2. Dialog action placement and lifecycle

The feed document header always renders these workflow buttons:

- **Release**
- **Transfer Shipment**
- **Transfer Receipt**

They remain visible but disabled when the document state, missing source data,
or caller authority does not permit the action. The API returns the allowed
actions and blocking reasons; the browser does not infer authority from role
names.

Draft **Save** and **Submit for approval** remain in the fixed dialog footer.
Approval **Reject / Approve** also remains in the fixed footer. Header workflow
actions do not replace either footer workflow.

The state dimensions stay independent:

- Approval: `NOT_SUBMITTED | PENDING | APPROVED | REJECTED`
- Document: `OPEN | RELEASED`
- Fulfilment: `NOT_STARTED | TRANSFER_OPEN | PARTIALLY_SHIPPED | SHIPPED |
  PARTIALLY_RECEIVED | RECEIVED`
- Integration: unchanged and independent from all three

Release requires Approval = `APPROVED` and Document = `OPEN`. A successful
release changes Document to `RELEASED` and Fulfilment to `TRANSFER_OPEN`; it
does not rewrite the approval decision. Shipment and receipt update only the
transfer and fulfilment dimensions. Fulfilment becomes `RECEIVED` only when
every requested feed quantity has been received.

## 3. Exact display-value contract

The feed document follows the settled semantic-field rule:

- a field or column labelled **Code** displays only its code;
- a field or column labelled **No.** displays only its number;
- a field or column labelled **Name** displays only its name;
- a field or column labelled **Description** displays only its description;
- a generic entity field displays the entity name.

Search dialogs may show Code and Name/Description as separate columns and may
search both. They must not concatenate those values in the closed field.

In particular:

- **Silo Code** shows only the SILO code, never `code — name`;
- **Feed Item No.** shows only the item number;
- **Feed Item Description** shows only the item description;
- the forecast exception/reason is moved to its own **Reason** column and shows
  the reason name only. It is not rendered as a second line under Item
  Description;
- the API exposes reason code and reason name separately instead of requiring
  the UI to parse a combined label.

Unavailable values retain the settled human-readable text (`Not available`,
`No shortage projected`, or `No delivery required`, according to meaning).

## 4. Release source resolution

Release performs all validation and creation in one database transaction and
locks the requisition before checking state. Repeating Release after a
successful release returns the already-linked transfers and does not create
duplicates.

For each positive-quantity line, the service requires:

1. a feed item;
2. a destination SILO belonging to the requisition farm and still active;
3. the requisition production date;
4. an active BIN/diet assignment for that feed item on that exact production
   date;
5. an active BIN whose location type is `BIN` and whose parent is an active
   `MILL` location.

The service must not silently use a later assignment. If any line has no exact
active assignment, release fails atomically with the affected line number,
item number and a human-readable explanation. If more than one active
assignment matches the same item/date and the requisition does not identify a
production slot, release also fails as ambiguous instead of choosing a BIN
silently. No transfer is left behind.

Validated lines are grouped by `(bin assignment, destination silo)`. One stock
transfer is created per group:

- source warehouse/location = assigned mill BIN;
- destination warehouse/location = requested farm SILO;
- source record = the feed requisition;
- transfer line quantity = requested feed quantity;
- each stock-transfer line retains its originating requisition-line ID.

The link between a feed requisition and its one-or-more transfers is explicit
and tenant scoped. It records the requisition, transfer and source BIN
assignment so the release decision remains auditable if master data changes
later. The existing singular common-requisition transfer link is not reused or
weakened.

## 5. Shipment and receipt

The feed detail response includes its linked transfer summaries and line
balances. When more than one transfer is actionable, the shipment/receipt
panel requires the user to choose a transfer; it never posts multiple transfer
documents behind one ambiguous click.

**Transfer Shipment** posts selected outstanding quantities through the shared
stock-transfer shipment service. The service retains the existing stock,
tracking and posting-date validation. **Transfer Receipt** posts against a
specific posted shipment and carries lot/serial assignments from that
shipment. Quantity controls use the existing balance rules and do not permit
over-shipment or over-receipt.

Feed workflow authorization is permission and scope based, not a hard-coded
role-name check:

- Release requires the server-side feed-requisition release authority and
  access to the requisition company/farm.
- Shipment requires stock-transfer posting authority and source mill/BIN
  scope.
- Receipt requires stock-transfer receipt authority and destination farm/SILO
  scope.

The existing public stock-transfer create endpoint is not relaxed. Feed
release calls a dedicated internal creation path after validating the mill BIN
and farm SILO topology.

## 6. API contract

The feed-requisition API adds commands equivalent to:

- `POST /feed-requisition/:id/release`
- `POST /feed-requisition/:id/shipments`
- `POST /feed-requisition/:id/receipts`

Shipment and receipt payloads identify the transfer (and the shipment for a
receipt) plus line quantities and posting date. Every command returns the
refreshed feed requisition detail so the dialog updates button states,
quantities and Fulfilment without client-side reconstruction.

The detail response adds:

- independent approval, document and fulfilment states;
- allowed header actions and blocking reasons;
- a list of linked transfer summaries, not one invented singular transfer;
- separately named code/name/description/reason values.

## 7. Failure handling and concurrency

- Release, shipment and receipt commands are tenant scoped and reject stale or
  invalid state transitions.
- Release is idempotent under repeated clicks and concurrent requests.
- Missing assignment, wrong location type/topology, inactive locations,
  insufficient stock, missing tracking, excess quantity and unauthorized scope
  all produce specific user-facing errors.
- Transfer posting and requisition fulfilment synchronization occur in the
  same transaction where the current shared posting service supports it; a
  partial failure must not report success.
- The UI keeps the dialog open, preserves entered posting values and displays
  the server error near the action panel.

## 8. Migration and verification

Schema changes use a reviewed tenant migration. Migration/application checks
must cover every registered tenant and the Drizzle journal. No example BIN,
MILL, assignment or feed data is inserted by the migration.

Required verification includes:

- service tests for missing/exact assignments, multiple BINs, multiple SILOs,
  grouping, idempotent/concurrent release and authorization;
- posting tests proving quantities, inventory ledger/value fields and aggregate
  fulfilment across several linked transfers;
- web tests proving all three header buttons remain visible, their disabled
  reasons are truthful, the fixed footer is unchanged and each semantic field
  displays only its promised value;
- Nx test, typecheck and production-build gates;
- running-app checks on ports 3002/2877 through approve, release, shipment and
  receipt;
- direct MySQL read-back of requisition links, transfer lines, shipments,
  receipts, inventory ledger rows and final `RECEIVED` fulfilment.
