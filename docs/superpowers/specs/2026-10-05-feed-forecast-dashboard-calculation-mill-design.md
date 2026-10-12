# Feed Forecast Dashboard, Calculation, Mill and Bin Design

**Date:** 2026-10-05  
**Decision owner:** Rishi  
**Workbook reference:** `NAVFarm_Feed forecast TDD with examples (1).xlsx`

## 1. Scope

This design completes `Inventory → Feed Forecast → Dashboard` and `Calculation`, and adds the minimum Mill/Bin
master-data foundation needed to show a real Mill Loading Bin. It does not implement Feed Plan, consolidation,
production output entry, loading/dispatch, transfer creation or receipt; those remain later work.

Dashboard and Calculation are implemented first. Their initial contract permits `millLoadingBin = null` and displays
`Not scheduled`. The Mill/BIN foundation follows and connects the real assignment; final completion is claimed only
after that integration is live-verified.

The implementation reuses the existing daily forecast engine. Dashboard summaries, charts, Calculation views and
saved runs must not introduce a second forecast calculation.

## 2. Provenance

### Workbook requirements

- Feed Forecast row 8: Daily, Weekly, Reporting Period and Custom controls; Farm, House, Batch, Silo, Feed Item and
  Bulk/Bagged filters.
- Feed Forecast row 11: mill capacity per day/hour, diet priority and loading-bin assignment; one diet per bin.
- Feed Forecast Engine rows 20 and 67–70: daily calculation under every grouped view; dated output detail.
- Feed Forecast Engine rows 47–64: the required Dashboard fields.
- Checkpoints and Validations rows 9 and 38: one diet per loading bin in a production slot.

Examples in workbook column F are illustrative only. They are not defaults or Triple C production data.

### Rishi decisions

- Dashboard requires Farm → Shed → Silo. Initial selection is the first valid Farm, its first Shed and that Shed's
  first linked Silo. Data is not shown until all three are valid.
- Farm, Planning Date and View/Range are shared between Dashboard and Calculation.
- Default view is Custom: Farm-local current date through current date + 6 days, seven dates inclusive.
- Calculation runs for the whole Farm. Shed, Silo, Batch, Feed Item and Bulk/Bagged are optional display filters.
- Dashboard shows selected-Silo values plus clearly labelled farm-wide values.
- `MILL` and `BIN` are Location Types. A company may have several Mills; each Mill may have several child Bins.
- A BIN is an inventory location. Feed stock and movements are auditable at BIN level.
- BIN diet assignments vary by production date and configurable Production Slot.
- Capacity is entered/displayed in TON and converted at exactly 1 TON = 1,000 KG for calculations.

### NAVFarm design needed to fulfil the requirements

- Deterministic “first” ordering is ascending Location Code, then Location Name, then ID.
- MILL has no parent. BIN requires a MILL parent. Existing Farm/Shed/Silo hierarchy remains unchanged.
- Capacity is stored canonically in KG and returned to the master-data form in TON. This follows the existing Silo
  conversion pattern and prevents every downstream caller from repeating unit conversion.
- `Not scheduled` is an unavailable state, not a fake BIN value.

## 3. Mill and Bin masters

### 3.1 Location hierarchy

```text
Company
├── FARM (root)
│   └── SHED
│       └── ...
└── MILL (root)
    └── BIN
```

`location_type_master` adds system types:

- `MILL`: code prefix `MILL`, allowed parent types `[]`.
- `BIN`: code prefix `BIN`, allowed parent types `["MILL"]`.

Existing hierarchical number-series behavior generates `MILL-001/BIN-001`-shaped identities.

### 3.2 MILL conditional Location fields

- Mill Code — generated `location_code`.
- Mill Name — `location_name`.
- Daily Capacity TON.
- Hourly Capacity TON.
- Bulk Daily Allocation TON.
- Bagged Daily Allocation TON.
- Status.

Rules:

- Every capacity/allocation is non-negative.
- Bulk Daily Allocation + Bagged Daily Allocation cannot exceed Daily Capacity.
- MILL is company-scoped and has no `parent_location_id`.
- Generic area, animal-count capacity, biosecurity and Silo fields do not appear for MILL.

### 3.3 BIN conditional Location fields

- Bin Code — generated `location_code`.
- Bin Name — `location_name`.
- Parent Mill — required `parent_location_id`, filtered to active MILL rows in the same company.
- Bin Capacity TON.
- Feed Type — `BULK` or `BAGGED`.
- Status.

Rules:

- BIN is included in inventory/warehouse locations; MILL is not.
- Generic area, animal-count capacity, biosecurity and Silo fields do not appear for BIN.
- A BIN diet cannot change while the BIN holds a positive balance of another Feed Item.

### 3.4 Production Slot Master

- Slot ID — internal UUID.
- Slot Code — required, unique in tenant/company scope.
- Slot Name — required.
- Start Time — required.
- End Time — required. Slots may cross midnight; an End Time earlier than or equal to Start Time ends on the following
  date. Production Date always means the slot's start date.
- Active/Status and standard audit fields.

No slot names or times are seeded as Triple C data.

### 3.5 BIN Diet Assignment

- Assignment ID.
- BIN Location.
- Feed Item/Diet; item must be an active FEED item with a Diet No.
- Production Date.
- Production Slot.
- Diet Priority; positive integer, lower number means earlier priority.
- Standard audit fields.

Rules:

- Unique `(bin_location_id, production_date, production_slot_id)`.
- One BIN cannot have two Feed Items in one date/slot.
- The assignment's Feed Type must match the BIN's Feed Type.
- Creating/changing an assignment is refused when the BIN has positive stock of a different item.
- Dashboard resolves the next assignment for the current diet on or after Planning Date, ordered by production date,
  Slot Start Time and BIN Code. It displays BIN Code, Production Date and Slot; otherwise `Not scheduled`.

## 4. Shared forecast context

`FeedForecastTabs` owns one provider containing:

- `farmId`
- `planningDate`
- `view`
- `from`
- `to`
- `periodId`

Dashboard and Calculation consume the same values. Changing them in either tab updates the other. Default Custom
dates use the selected Farm's time zone returned by the API, not the browser's time zone.

Dashboard owns `shedId` and `siloId`. Calculation owns optional `shedId`, `siloId`, `batchId`, `itemId` and `feedType`
filters. These optional filters filter already-computed result rows and never change the farm calculation or saved-run
evidence.

## 5. Dashboard

### 5.1 Selection

The filter bar contains Farm, Shed, Silo, Planning Date and View/Range. Shed options belong to the selected Farm. Silo
options are the active Silos linked to the selected Shed through `silo_shed_link`. Parent changes synchronously discard
stale child data and select the first valid child by deterministic code order.

### 5.2 Required displayed fields

For the selected Farm → Shed → Silo, show all fields explicitly. Charts do not replace their values:

1. Current Diet Feed Item
2. Mill Loading Bin No. with Production Date and Slot, or `Not scheduled`
3. Silo Capacity KG
4. System Balance KG
5. Daily Requirement KG
6. Days of Feed Remaining
7. Projected Need for Selected Range KG, split current/next item where both exist
8. Current Diet Days Remaining
9. Next Diet Feed Item
10. Silo Available for Next Diet Feed Type
11. Projected Shortfall KG
12. Recommended Order Qty KG
13. Farm Total Order This Cycle KG — explicitly farm-wide
14. Requisition Status — label and link
15. Submission Deadline

### 5.3 Layout

- Primary KPI cards: Current Diet, Silo Capacity, System Balance, Daily Requirement, Days Remaining, Recommended Order.
- Forecast details: Projected Need, Current Diet Days Remaining, Next Diet, next-diet Silo availability, Shortfall.
- Fulfilment details: Mill Loading Bin, Requisition Status, Submission Deadline.
- Separate farm-wide card: Farm Total Order This Cycle.
- Chart 1: projected closing balance across the selected range, with Below Feed Level, Above Threshold/capacity and
  run-down markers.
- Chart 2: selected-range demand split between current and next diet.
- Detailed workbook table beneath the summary, using exact workbook labels and System Balance terminology.

Selected-Silo data and farm-wide data must never share an unlabelled total.

## 6. Calculation

Calculation controls are Farm, Planning Date, View/Range plus optional Shed, Silo, Batch, Feed Item and Bulk/Bagged
result filters. Default filters are `All`.

The grid follows Feed Forecast Engine row 70:

- Batch; House; Silo Code and Name; Required Feed Item; Current Silo Item; Head Count; KG/head/day Rate;
  Opening System Balance; confirmed Receipts; Daily Use; dated Projected Closing Balance; First Shortage Date;
  Recommended Quantity; Delivery Date.

Daily shows every date from the selected date through the source's run-down date, capped at 45 days. Weekly groups
consecutive seven-day buckets from the selected date and shows the closing balance at the bucket end, with zero in the
run-down bucket. Explicit Custom and Reporting Period ranges remain bounded by the selected dates.

The non-workbook `Stages` sub-tab and response block are removed. Stage/diet-change calculation remains internal to the
engine and appears through current/next item rows and notes.

Saved runs retain farm computation evidence; optional UI filters are stored as display metadata only if the saved-run
contract already supports it, not as altered quantities.

## 7. API shape

Extend `QuerySiloStatusDto` with the same View/Range inputs as `QueryFeedForecastDto` plus optional bootstrap `shedId`
and `siloId`. A Farm-only request returns ordered Shed options and no Dashboard facts. Farm+Shed returns linked ordered
Silo options and no facts. Only Farm+Shed+Silo resolves the window, calls the existing farm computation once and returns:

- `selection`: ordered Shed/Silo options and selected identities.
- `silo`: the 15 selected-Silo/farm fields.
- `balanceSeries`: selected Silo/item closing balances by daily source date.
- `demandSeries`: current/next item demand over the resolved range.
- `farmTotalOrderKg` and requisition linkage.

Extend forecast report rows with the missing workbook detail and stable IDs needed for optional filtering. Do not filter
engine inputs by optional UI filters.

## 8. Empty, error and loading states

- No Farms: explain that none are available.
- Farm/Shed has no valid child: show the missing relationship; do not display previous data.
- API failure: retain previous valid render at reduced opacity and show Retry.
- Missing Mill assignment: `Not scheduled`.
- Missing confirmed incoming receipt: zero only when the source query confirms none; unavailable remains unavailable.

## 9. Verification

- Pure tests for TON→KG conversion, capacity allocation, parent rules, slot uniqueness, item change with positive stock,
  deterministic assignment selection and farm-local seven-day defaults.
- Service tests prove one forecast compute per request and that optional filters do not change quantities.
- Web tests prove shared core state, required hierarchy defaults, stale-child clearing, all required fields, chart data,
  optional Calculation filtering and Stages removal.
- Nx API/web tests and typechecks.
- Apply the tenant migration only after `--verify`; inspect every tenant migration result and Drizzle journal.
- Drive `localhost:3002` on two farms and at least two topology shapes. After every inventory write, verify MySQL Item
  Ledger and Value Entry rows.
