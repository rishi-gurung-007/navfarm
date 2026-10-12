# Unified Requisition and Feed Forecast Correction Design

**Date:** 2026-10-05  
**Owner and source of truth:** Rishi  
**Supersedes:** the navigation and boundary portions of the 4–5 Oct rulings that excluded Feed from the common
Requisition page and required feed mutations to remain on a separate document implementation.

## 1. Outcome

NAVFarm has one requisition document and one Requisition page. Approval is the decision workflow for that document,
not a second requisition list. Feed Forecast can create a prefilled requisition, and a user can request the same feed item
manually from Requisition. Both entry points read and mutate the same record through the same business rules.

Feed Forecast presents the hierarchy and projection Rishi described: Farm → Shed → Silo, dashboard KPIs/charts, daily
or weekly balances through run-down, a Physical Stock Count dialog, and the workbook's Tentative versus Actual Feed Plan.

## 2. Requisition and approval boundary

### 2.1 Canonical document

The user-facing requisition types are `ITEM`, `FA` and `SERVICE`. Feed is an Item request whose origin is
`FEED_FORECAST` or `MANUAL`. Feed-specific evidence (forecast run, batch/house allocation, destination silo, required
date, daily requirement and recommendation) extends the Item line; it does not create a second header/line model.

The top-level Requisition page:

- lists all Item, Fixed Asset and Service requisitions, including feed items;
- creates manual requisitions;
- opens one document dialog for create, edit and view;
- provides `Waiting for my approval` and status filters;
- exposes Approve / Reject when the current user may decide the pending request;
- exposes Release, Shipment and Receipt according to document/fulfilment state and permission.

Feed Forecast → Requisition is a contextual view of the same records, filtered to the selected farm/shed/silo and feed
items. `Create from forecast` supplies the forecast origin and evidence. A manually created feed Item request supplies
manual origin and must still pass destination-silo, item and farm rules.

The general Approvals inbox excludes requisitions and retains physical-count, stage, GRN and other operational sign-offs.
It may show a count/link to Requisition, but not duplicate requisition rows.

### 2.2 Independent states

- Approval: `NOT_SUBMITTED | PENDING | APPROVED | REJECTED`.
- Document: `OPEN | RELEASED`.
- Fulfilment: `NOT_STARTED | PARTIALLY_SHIPPED | SHIPPED | PARTIALLY_RECEIVED | COMPLETED`.
- Integration remains separate. Feed is in-house and never claims a BC success. Purchase keeps `BC_PENDING` until a real
  integration exists.

Approval is required before Release. Approval does not release. Rejection returns the editable document to Open while
retaining decision history.

### 2.3 Compatibility transition

Current code stores `doc_type=FEED`, excludes it from `GET /requisition?kind=common`, refuses FEED mutations through
`/requisition`, and directs them to `/feed-requisition`. Remove that split in stages:

1. Introduce a canonical requisition application service used by both routes.
2. Make `/feed-requisition` a compatibility facade and preserve old bookmarks.
3. Return existing FEED rows in the one Requisition list, mapped to user-facing Item + feed origin.
4. Migrate or normalize persisted subtype/source only after a read-only plan, `--verify`, backup gate and live read-back.
5. Remove obsolete guards/routes only after no caller depends on them.

## 3. Header dependency and edit rules

| Field | Editable rule |
|---|---|
| Requisition No. | Number Series output; read-only after allocation. |
| Requisition Date | Editable while Open and not submitted; locked afterward. |
| Main / Farm Location | Editable while Open before submission; changing it clears invalid From/To locations and lines. |
| Requester User ID / Name / Department | Derived from authenticated User Setup; always read-only. |
| Sender Department | Required and editable while Open; filters the Store source locations. |
| Requisition Type | Item / Fixed Asset / Service. Editable only before lines exist; changing it requires clearing incompatible lines. |
| Approval | Read-only workflow state. It is not the Open/Released field. |
| Status | Open / Released; read-only, changed only by Release. |
| Purpose | Store / Purchase for Item. Fixed Asset and Service force Purchase. |
| From / To Sub-Location | Visible and required only for Store. Filtered by selected Main/Farm Location and department rules. |
| Direct Transfer | Visible only for Store and enabled only when User Setup grants the right. |
| Remarks | Editable while Open or returned for correction; locked after Release. |

## 4. Line dependency and edit rules

| Field | Editable rule |
|---|---|
| Line No. | Generated; read-only. |
| Item No. | Required for Item; editable while Open. Feed items use the same picker with feed/destination validation. |
| Item Description | Derived from Item; read-only. |
| Fixed Asset or Service Description | Required and editable only for FA/Service. |
| Qty | Positive and editable while Open. |
| From / To Location | Copied from the Store header; always read-only on the line. |
| Qty to Ship | Entered by an authorized sender-department user after Release, bounded by Balance to Ship. |
| Qty Shipped | Posted total; read-only. |
| Qty to Receive | Entered by an authorized destination/requester user after shipment, bounded by Remaining to Receive. |
| Qty Received | Posted total; read-only. |
| Remaining to Receive | Calculated `Qty Shipped − Qty Received`; read-only. |
| Balance to Ship | Calculated `Qty − Qty Shipped`; read-only. |
| Item Tracking | Required before shipment for lot/serial-tracked Items; receipt inherits the shipment assignment. |

## 5. Forecast hierarchy and presentation

All Feed Forecast tabs share one selection model:

1. Farm.
2. Shed, filtered to active sheds under the farm.
3. Silo, filtered to active silos linked to the shed through `silo_shed_link`.

Changing Farm clears Shed and Silo. Changing Shed clears a Silo that is no longer valid. A Farm Manager's fixed farm is
read-only. The API performs the same scope validation; UI filtering is not security.

Dashboard order:

1. hierarchy and period filters;
2. KPI cards for system balance, daily requirement, days/date to run-down, projected need/shortfall and recommended order;
3. useful charts for projected balance over time and demand/current-versus-next diet;
4. the workbook detail table.

Charts use the API's dated projection and never recalculate business quantities in the browser.

## 6. Daily and weekly range contract

The engine's daily projection is authoritative. The view range and run-down search are no longer two contradictory
contracts.

- Daily: return one column per day from the selected date through the latest applicable run-down date of the displayed
  rows, subject to the configured maximum horizon. Each row shows its container/item projected balance for every date,
  including dates on which that particular batch does not consume. Stop that row at zero.
- Weekly: group those daily dates into consecutive seven-day buckets anchored on the selected date. Display the closing
  balance at the end of each bucket; the final bucket includes the run-down day and displays zero when stock empties.
- Explicit Custom and Reporting Period ranges remain explicit user/period ranges. They do not silently expand.
- If no displayed row runs down within the maximum horizon, show through the maximum/default rule and state that no
  run-down occurs in the horizon; do not fabricate a date.

## 7. Physical Stock Count

`New count` opens a dialog over the list. The dialog loads one server evidence snapshot and displays the workbook fields:
Farm, Silo, linked Shed(s), physical feed item, current diet, capacity, system balance, projected shortfall, next diet
change and next feed item. The user edits counted quantity and a required Reason for every nonzero variance. Saving closes
or transitions the dialog to the created document without replacing the underlying list page.

## 8. Feed Plan

Feed Planning remains configuration. Add a distinct Feed Plan view implementing workbook Engine rows 31–44:

- retained `TENTATIVE` and `ACTUAL` versions per farm/week/item;
- Tentative from five completed weeks of posted consumption, adjusted for known head-count and lifecycle changes;
- Actual from approved requisition quantities;
- variance between Actual and Tentative;
- capacity fields when Mill Capacity configuration exists; otherwise show a specific missing-configuration state rather
  than zero or invented capacity.

This brings the farm plan into scope. It does not by itself claim mill consolidation, loading or dispatch are complete.

## 9. Verification

- Pure API tests for date expansion, weekly end balances, shared/multiple silos, incoming stock, diet changes and no
  run-down within 45 days.
- API/service tests proving forecast and manual entry create the same requisition shape and approval path.
- Web tests for hierarchy resets, dependent fields, disabled/read-only states, dialog behavior and shared requisition
  links.
- Run Nx targets through `pnpm nx` for final gates.
- Drive the running app on ports 3002/2877 for company admin, Farm Manager and Standard User.
- After every write, verify requisition, approval, stock-count, transfer and ledger rows in `nf_devco`.
