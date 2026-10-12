# Feed workbook — field-by-field gap audit against `main` (100 % target)

Audited 10 Oct 2026 on `audit/workbook-100` (= GitHub `main` 214b2a9f), read-only, from the code (not old docs).
Spec: `workbook-fields.md` (every sheet/row), `docs/decisions.md` (newest wins), `common-requisition-spec.md`.
Rishi's bar: every workbook field is present, **readable** (no UUID, no raw enum code, no dash) and **linked** when it
names another record.

Branches **not on main** (counted as ON BRANCH): `feat/monthly-stock-take` (monthly count type, period close,
closed-period guard — migration 0167) and `feat/feed-scheduler-email` (email channel `IN_APP_EMAIL`, `PLAN_AVAILABLE`
event, tentative-plan schedule setting, notification log — migration 0166; **no cron job yet**).

Path shorthands: `W/` = `apps/web/src/components/console/inventory/`, `WR/` = `apps/web/src/components/console/requisitions/`,
`CFG` = `apps/web/src/modules/master-data/configs.ts`, `A/` = `apps/api/src/modules/`,
`FRS` = `A/procurement/feed-requisition/feed-requisition.service.ts`, `FRR` = `A/procurement/feed-requisition/feed-requisition.rules.ts`.

## Cross-cutting findings (read first)

1. **Linking is almost absent.** In the whole web app only two entity links exist: Dashboard Silo
   (`W/feed-silo-dashboard-cards.tsx:163`, `/master-data/location?recordId=`) and Dashboard Requisition Status (`:92`,
   `/requisitions?id=`). Every other silo, farm, shed, batch, item, BIN, requisition, transfer, shipment, consolidation,
   loading sheet and run code is plain text. Deep-link **targets** that already work: `/master-data/<key>?recordId=`
   (generic, `apps/web/src/modules/master-data/MasterDataTable.tsx:1547-1567` — covers location/item/bin/slot/period/
   alert-rule), `/requisitions?id=` (`WR/requisitions-hub.tsx:184-193`), `/inventory/feed-forecast?tab=feed-requisition&id=`
   (`W/requisitions-panel.tsx:184-198`), `/batches/entry?batchId=`, `/inventory/ledger/<id>`. **No `?id=` target exists**
   for stock transfers (`W/stock-transfer-panel.tsx`), consolidation sheets, loading sheets, forecast runs or feed plans.
2. **Feed requisition line table is mislabelled** (`W/feed-requisition-document.tsx:283-286` vs cells `:491-512`):
   the header row has *Requested Qty KG · Mill Requested KG · Mill Approved KG · Adjustment Reason* but the cells are
   *consolidation requested · mill approved · adjustment reason · editable Requested Qty*. The farm's editable quantity
   sits under "Adjustment Reason". Highest-value one-line fix.
3. **Raw codes still rendered**: consolidation status/next action via `replaceAll("_"," ")`
   (`W/feed-consolidations-panel.tsx:16`, `W/feed-requisition-document.tsx:395-396`), loading status
   (`W/feed-loading-panel.tsx:14`); transfer list `PARTIALLY_RECEIVED` (local map at `W/stock-transfer-panel.tsx:158-164`
   ignores `W/stock-transfer-status.ts`); `REQ_STATUS_LABEL` has no `IN_CONSOLIDATION` (`W/requisition-labels.ts:14-28`,
   humanised fallback only, no badge variant, not in any status filter); `labelOf()` returns "—" for null
   (`W/requisition-labels.ts:86`); alert farm "—" (`apps/web/src/components/console/production/alert-panel.tsx:181`);
   consolidation dialog "—" (`W/feed-consolidation-dialog.tsx:104`).
4. **Raw UUIDs reachable**: run author (`W/feed-forecast-run-history.tsx:79`; API `A/inventory/feed-forecast/feed-forecast-run.service.ts:197-205`
   returns `created_by` id); stock-count silo fallback `pair.siloCode ?? pair.siloId` (`W/feed-stock-count-panel.tsx:443-449`);
   API `?? row.<x>_id` fallbacks in consolidation `findOne` (`A/procurement/feed-requisition/feed-consolidation.service.ts:246-253`)
   and loading `decorate` (`A/procurement/feed-requisition/feed-loading.service.ts:178-185`); transfer panel
   `warehouseCode()`/item fallbacks (`W/stock-transfer-panel.tsx:997, 2153, 2724, 2817, 2964`).
5. **No scheduler on main.** Feed alerts are evaluated only by `POST /feed-alert/evaluate-scope` (fired when someone opens
   Alerts, `alert-panel.tsx:84`) and by postings (`stock-transfer.service.ts:1456/1773/2013`,
   `stock-adjustment.service.ts:369`, `goods-receipt.service.ts:557`, `batch-daily-data.service.ts:1008`,
   `feed-stock-count.service.ts:629`, `FRS:158/880/1105/1824`). Friday/Saturday deadline, daily diet-change and Wednesday
   tentative plan do not fire on time (decision 30 Sep: "must be automatic").
6. **Alerts master has 4 of the workbook's 9 events** (`A/system/alert-rule/alert-rule.rules.ts:6`); channel `IN_APP` only (`:31`).

---

## 1. Per-sheet tables

Status: DONE · PARTIAL · MISSING · ON BRANCH · N/A.

### Sheet: Feed Forecast (design principles)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 3 | Farm-wise segregation | DONE | `FRS` `resolveOwnFarm` (~1504), forecast `withFarmScope`; farm-scoped consolidation `feed-consolidation.service.ts:30-39` | — |
| 4 | Silo physical item vs house demand | DONE | grid Required vs Current Silo Item `W/feed-forecast-grid.tsx:431-432,459-460`; `A/inventory/silo-feed/silo-feed.service.ts:94` | — |
| 5 | Lifecycle drives dated demand | DONE | `A/inventory/feed-forecast/feed-forecast.engine.ts:680-700` | — |
| 6 | Next diet planning | DONE | engine diet changes `:888-915`; `needs_silo_changeover` `FRS:360` | changeover *task* → cp 5 |
| 7 | Tentative and actual plans | ON BRANCH | Tentative/Actual versions on main (`W/feed-plan-panel.tsx:150`); Wednesday default schedule on `feat/feed-scheduler-email` | merge branch + cron |
| 8 | Flexible forecast dates / schedule | DONE | views `W/feed-silo-dashboard.tsx:200-214`; filters removed by ruling 8 Oct | scheduled run → Engine r69 |
| 9 | NAVFarm notification master | PARTIAL | in-app only `alert-rule.rules.ts:31`; email on branch; no dispatch event | merge email branch; add MILL_DISPATCH event |
| 10 | Monthly stock take | ON BRANCH | Reporting Period master on main (`CFG` reportingPeriod); stock take on `feat/monthly-stock-take` | merge |
| 11 | Mill capacity awareness | DONE | MILL/BIN `A/master-data/location/location.service.ts:676-686`; Compare Report `W/mill-compare-panel.tsx:168-186` | — |
| 12 | Approval → consolidation → transfer → receipt; preserve requested/approved/shipped/received/outstanding per line | PARTIAL | flow on main; feed lines show requested+mill approved only (`W/feed-requisition-document.tsx:283-286`); `qty_shipped/qty_received` already in API view (`FRS` readView spreads `l.line`) | add Shipped/Received/Outstanding line columns |

### Sheet: Master Setup

**§1 Location Master — Silo**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 5 | Location Code | DONE | `CFG:62` | — |
| 6 | Location name | DONE | `CFG:67` | — |
| 7 | Location Level (=SILO) | DONE | type `CFG:64-66` | — |
| 8 | House code + silo-house mapping | PARTIAL | `attached_sheds` `CFG:220-231`; link table `location.service.ts:394` | no effective-dated batch house allocation; parent/sheds not linked on record view |
| 9 | Silo Capacity KG | DONE | `CFG:172-173` | — |
| 10 | Below Feed Level KG | DONE | `CFG:184-188` | — |
| 11 | Physical Count Date Time | DONE | `W/feed-stock-count-panel.tsx:397-421`; schedule checks `A/inventory/feed-stock-count/feed-stock-count.service.ts:183-196` | closed-period guard on branch |
| 12 | Above Threshold KG | DONE | `CFG:190-194` | — |
| 13 | Last Approved Physical Count | MISSING | not on silo record | derived read-only field (API location view + CFG) |
| 14 | System Balance KG | PARTIAL | dashboard only (`W/feed-silo-dashboard-cards.tsx:105`) | show on silo record |
| 15 | Days to First Shortage | PARTIAL | API `A/inventory/feed-forecast/feed-silo-status.ts:209-210` returns `firstShortageDate`; dashboard shows only days (`cards:107`) | show the date |
| 16 | Feed in Silo | PARTIAL | API returns `current_feed_item_code/name` (`location.service.ts:552-553,631-632,1285-1286`); not in `CFG` location; empty-silo rule enforced `silo-feed.service.ts:94-170` | add read-only field/column, linked to item |
| 17 | Available stock | MISSING | `currentItems().on_hand_qty` exists (`silo-feed.service.ts`), not exposed | expose + show |
| 18 | Blocked | DONE | generic active/blocked `MasterDataTable.tsx:126,1936-1940` | — |
| 19 | Last Feed Receipt Date | MISSING | — | derive from last posted transfer receipt to silo |
| 20 | Next Diet Change Date | PARTIAL | dashboard `nextDietDate` (`cards:84-86`), not on silo record | show on silo record |

**§2 Item Master**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 24 | Item No. | DONE | `CFG:1004,1017` | — |
| 25 | Item Description | DONE | `CFG:1019` | — |
| 26 | Item Type = Feed | PARTIAL | `CFG:1018`; lifecycle feed picker `/item` (`CFG:1280`) and BIN assignment `/item?isActive=true` (`CFG:1631`) not feed-filtered | filter pickers to feed item types |
| 27 | Base UOM KG | DONE | `CFG:1010` | — |
| 28 | Sync to NAVFarm (BC) | N/A | decision 2026-10-03 #4 (in-house, no BC) | — |
| (extra) | Diet No. | DONE | `CFG:1114` | — |

**§3 Breed Lifecycle Stage Config**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 32 | Line Code | DONE | breed `CFG:1251` | — |
| 33 | Stage Code | DONE | `CFG:1252` | — |
| 34 | Calculation Unit | DONE | `CFG:1259-1261` | — |
| 35 | Period From | DONE | `CFG:1262` | — |
| 36 | Period To | DONE | `CFG:1263` | — |
| 37 | Feed bulk/bagged | DONE | `feed_form` `CFG:1284-1287` | — |
| 38 | Feed Item No. (effective dated) | PARTIAL | `CFG:1280`; schema `apps/api/src/core/database/schema.ts:2402` has no effective dates | effective-from/to; feed-only picker |
| 39 | Feed Rate KG/day/head (farm override) | DONE | `CFG:1281`; farm-specific breed (decision 14 Sep) | — |

**§4 Alerts and Notifications Master** (`CFG:1490-1560`, `A/system/alert-rule/*`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 43 | Notification Code | DONE | `CFG:1503` | — |
| 44 | Notification Name | DONE | `CFG:1504` | — |
| 45 | Event Type | PARTIAL | 4 events `alert-rule.rules.ts:6`; PLAN_AVAILABLE on branch; no MILL_DISPATCH, RECEIPT_VARIANCE, STOCK_TAKE_DUE, plan-available on main (BC sync N/A) | add events + evaluators |
| 46 | Trigger Entity | DONE | `alert-rule.rules.ts:10`, `CFG` select | — |
| 47 | Threshold Value | DONE | `CFG` threshold_value | — |
| 48 | Threshold Reference | DONE | `alert-rule.rules.ts:19-25` | — |
| 49 | Priority Level | DONE | labelled `CFG` ALERT_PRIORITIES | — |
| 50 | Recipient Role(s) | PARTIAL | free-text `string-list` `CFG:1529`; list shows raw codes (`format: "codes"`) | Role Master multi-select, show role names |
| 51 | Delivery Channel | ON BRANCH | `IN_APP` only main (`alert-rule.rules.ts:31`, `CFG:1533`); `IN_APP_EMAIL` on branch | merge |
| 52 | Frequency | DONE | `CFG` ALERT_FREQUENCIES | — |
| 53 | Escalation After Hours | DONE | `CFG` | — |
| 54 | Escalation Recipient Role | PARTIAL | free text `CFG:1546` | Role Master lookup |
| 55 | Active | DONE | generic active/blocked | — |
| 56 | Farm Filter | DONE | `select-entity` FARM | (list column optional) |

### Sheet: Feed Forecast Engine

**§1 Physical Stock Count and forecast filters** (`W/feed-stock-count-panel.tsx`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 6 | Farm Code (auto, locked) | DONE | `:263-283` fixed farm | — |
| 7 | Farm Name | DONE | `feedFarmLabel` `:275` | — |
| 8 | Silo Code (active, farm-filtered) | PARTIAL | API filter `feed-stock-count.service.ts:135-139`; UI `pair.siloCode ?? pair.siloId` `:443`, `line.silo_code` `:477`, unlinked | drop UUID fallback; link |
| 9 | Silo Name | PARTIAL | dashboard only; count dialog none | add column |
| 10 | House Shed(s) Linked | PARTIAL | dashboard filter only | add column (linked) |
| 11 | Silo Feed Item No. | PARTIAL | `:444`, `:477` item code, unlinked | link item |
| 12 | Current Diet Description | PARTIAL | entry dialog shows code only (`:444`); saved lines show `item_name` | show description in entry |
| 13 | Silo Capacity KG | PARTIAL | dashboard only | add to count |
| 14 | Current Balance (System) | DONE | `:445`, `:478` | label → cp 37 |
| 15 | Projected Shortfall | PARTIAL | dashboard only (`cards:112`) | API entry + column |
| 16 | Next Diet Change in X Days (warn ≤7) | PARTIAL | dashboard `currentDietDaysRemaining` only | API entry + column + warning |
| 17 | Next Feed Item in range | PARTIAL | dashboard only | API entry + column |
| 18 | Save Count and Submit Variance | DONE | reason `feed-stock-count.rules.ts:103-105`, approval/post `feed-stock-count.service.ts:365-629` | — |

**§2 Calculation steps** (`A/inventory/feed-forecast/feed-forecast.engine.ts`)

| Row | Step | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 22 | Step 1 active/expected batches | DONE | flags `HEADS_ASSUMED_FLAT`, `BATCH_SHED_UNKNOWN` `:157-170` | — |
| 23 | Step 2 head count | DONE | engine input + `STAGE_CHANGE_PROJECTED` | — |
| 24 | Step 3 feed by lifecycle date | DONE | `:680-700` NO_FEED_ROW/OVERLAP | — |
| 25 | Step 4 daily demand | DONE | engine demand loop | — |
| 26 | Step 5 next diet | DONE | `:888-915` | — |
| 27 | Step 6 dated forecast | DONE | `feed-forecast.view.ts` | — |
| 28 | Step 7 stock & shortage | DONE | `:849-884`; grid receipts/transfers/planned `W/feed-forecast-grid.tsx:436-439` | — |
| 29 | Step 8 recommend refill | DONE | `FRR:129-133` | — |
| 30 | Step 9 draft requisition | DONE | `FRS:616-684` createFromRun, `FRR:288` planDraftUpsert | — |

**§3 Feed Plan** (`W/feed-plan-panel.tsx`, `A/inventory/feed-forecast/feed-plan.service.ts`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 34 | Plan Code | DONE | `:150,203` | (no `?id=` deep link) |
| 35 | Plan Type | DONE | `:150,206` | — |
| 36 | Farm Code | PARTIAL | `:164` plain | link farm |
| 37 | Plan Week | DONE | `:205` | — |
| 38 | Feed Item No. | PARTIAL | `:164,234` plain | link item |
| 39 | Tentative Qty | DONE | `:165,238` | — |
| 40 | Actual Requested | DONE | `:165,239` | — |
| 41 | Variance | DONE | `:167,241` | — |
| 42 | Mill Capacity Available | DONE | `:168` | — |
| 43 | Plan vs Mill Capacity | DONE | `:169-173` | — |
| 44 | 5-week history | DONE | `:248-266` | — |

**§4 Dashboard** (`W/feed-silo-dashboard-cards.tsx`, API `A/inventory/feed-forecast/feed-silo-status.ts`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 47 | Farm | DONE | `W/feed-silo-dashboard.tsx:184` | — |
| 48 | House Shed | PARTIAL | filter only `:185-190`; not in detail table | add linked Shed row |
| 49 | Silo Code (clickable) | DONE | `cards:163` | — |
| 50 | Current Diet Feed Item | PARTIAL | name only `cards:102,124` | add code, link item (API: item id/code) |
| 51 | Mill Loading Bin No. | PARTIAL | `cards:78-80` plain | link BIN (`binId` present) |
| 52 | Silo Capacity KG | DONE | `cards:104,128` | — |
| 53 | System Balance KG | DONE | `cards:105,129`; alerts `A/inventory/feed-alert/feed-alert.rules.ts:143-160` | — |
| 54 | Daily Requirement KG | DONE | `cards:106` | — |
| 55 | Days of Feed Remaining = first shortage date | PARTIAL | shows days number `cards:107,131`; API `firstShortageDate` (`feed-silo-status.ts:210`) not rendered | show date (decision 3 Oct #3) |
| 56 | Projected Need for range | DONE | `cards:87-89` | — |
| 57 | Current Diet Days Remaining | DONE | `cards:109`; DIET_CHANGE `feed-alert.rules.ts:162-176` | — |
| 58 | Next Diet Feed Item | PARTIAL | name+date `cards:84-86`, unlinked | link item |
| 59 | Silo Available for Next Diet Feed Type | PARTIAL | `feed-silo-status.ts:214` = next source is a SILO holding the item, not a feed-type match; no notification | feed-type rule + alert (cp 9) |
| 60 | Projected Shortfall KG | PARTIAL | value `cards:112`; no ">0" notification | alert event |
| 61 | Recommended Order Qty | PARTIAL | value `cards:113`; no "not drafted" notification | alert event |
| 62 | Farm Total Order This Cycle | PARTIAL | `cards:154`; no "approaching 30 t" notification | alert event |
| 63 | Requisition Status (link) | DONE | `cards:90-93` | — |
| 64 | Submission Deadline (+Friday CRITICAL) | PARTIAL | value `cards:116`; REQ_DEADLINE `feed-alert.rules.ts:177-196` not scheduled | scheduler |

**§5 Filters and run audit**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 67 | View and Period | DONE | `W/feed-silo-dashboard.tsx:200-214`; span `A/inventory/feed-forecast/feed-forecast.service.ts:769` | — |
| 68 | Run Date and Version | PARTIAL | run_code/version/snapshots in schema; author shown as user UUID `W/feed-forecast-run-history.tsx:79` (API `feed-forecast-run.service.ts:197-205`) | resolve author name; link run |
| 69 | Scheduled Planning (Wednesday) | ON BRANCH | schedule setting on `feat/feed-scheduler-email` (no cron yet) | merge + cron |
| 70 | Output Detail | PARTIAL | all columns present `W/feed-forecast-grid.tsx:426-444`; batch/house/silo/item/planned requisition plain `:454-467` | link each (ids exist on row: `sourceLocationId`, `itemId`, `batchId`) |

### Sheet: Requisition and Loading Sheet

**§1 Header** (`W/feed-requisition-header.tsx:47-84`, `W/feed-requisition-document.tsx:366-404`, API `FRS` readView `:2040-2298`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 5 | Requisition No. | DONE | header `:54` | — |
| 6 | Requisition Date | DONE | `:55` | — |
| 7 | Requisition Type | PARTIAL | doc shows Item (ruling 7 Oct #1); feed **list** "Type" column shows Forecast/Manual `W/requisitions-panel.tsx:294` | list: Type=Item + Source column |
| 8 | Source | DONE | `SOURCE_LABEL` | — |
| 9 | Farm Code | PARTIAL | plain `:61` and list `W/requisitions-panel.tsx:293` | link farm (`farm_id` in view) |
| 10 | Farm Name | DONE | `:62` | — |
| 11 | Silo Code (header) | N/A | decision 2026-10-07 #4/#6 (per-line Destination Silo) | — |
| 12 | Current Silo Feed Item No. | N/A | workbook REMOVED; decision 7 Oct #6 | — |
| 13 | Feed Item No. to Order | PARTIAL | `document.tsx:463` plain | link item |
| 14 | Feed Item Description | DONE | `:465` | — |
| 15 | Feed Type | DONE | `FEED_TYPE_LABEL` | — |
| 16 | Is Next Diet | DONE | header `:63`, line | — |
| 17 | Breed Lifecycle Row Reference | PARTIAL | label only `FRR:422` | link lifecycle row (`/master-data/breed-lifecycle-stage?recordId=`) |
| 18 | System Balance at Draft | DONE | line col | — |
| 19 | Daily Requirement | DONE | line col | — |
| 20 | Days Remaining at Draft | DONE | days + shortage date | — |
| 21 | Days Before Diet Change | DONE | line col | — |
| 22 | Recommended Qty | DONE | + unrounded | — |
| 23 | Bag Count | DONE | line col | — |
| 24 | Requested Qty KG | PARTIAL | editable cell renders under "Adjustment Reason" header (`document.tsx:283-286` vs `:491-512`) | move cell / fix header order |
| 25 | Requested Qty Bags | DONE | bag col | — |
| 26 | Farm Total Requested | DONE | `bulkTotalAndTrips` header `:113` | — |
| 27 | Bulk Truck Target | DONE | trips, no block | — |
| 28 | Bulk Order Multiple | DONE | `:67` | — |
| 29 | Required Delivery Date | DONE | `:68`; moved date needs remarks `FRR:227` | — |
| 30 | Supplier or Source = MILL | DONE | `SUPPLY_LABEL` | — |
| 31 | Purpose = Internal transfer | DONE | `PURPOSE_LABEL` | — |
| 32 | Mill Loading Bin No. | MISSING | not in readView header or lines; BIN resolved only at release `FRS:~2213-2233` | API: per-line BIN; web column (linked) |
| 33 | Status | PARTIAL | `REQ_STATUS_LABEL` lacks IN_CONSOLIDATION (`requisition-labels.ts:14-28`); filters `requisitions-panel.tsx:72`, `WR/requisitions-hub.tsx:83` omit it | add labels/variants/filters |
| 34 | Priority (FM may escalate) | PARTIAL | auto `FRR:231`; no escalate control | add escalate edit |
| 35 | Submission Deadline | DONE | `:73` | — |
| 36 | Remarks (>20 %) | DONE | `FRR:347-366` | — |
| 37 | Approved By | DONE | `:76` | — |
| 38 | Approval Date Time | DONE | `:77` | — |
| 39 | Linked Transfer Order No. | PARTIAL | plain `:78`; single `linked_transfer_id` though release creates one transfer per BIN/silo pair | list all transfers, linked |
| (Rishi) | Requester User ID / Department | PARTIAL | shown in feed header (`header.tsx:58-60`) but never passed (`document.tsx:373`) → always "Not yet available" | API readView + pass values |
| (extra) | Consolidation sheet / status / next action | PARTIAL | plain no., raw status, `replaceAll` (`document.tsx:393-397`), hard-coded English labels | link + label map |

**§2 Lines**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 42 | Line No. | DONE | `document.tsx` seq | — |
| 43 | Silo Code | PARTIAL | `:449` plain | link silo |
| 44 | Current Silo Feed Item No. | N/A | REMOVED | — |
| 45 | Feed Item No. to Order | PARTIAL | `:463` plain | link item |
| 46 | Feed Type | DONE | label | — |
| 47 | Is Next Diet Line | DONE | — | — |
| 48 | Days Before Diet Change | DONE | — | — |
| 49 | System Balance KG | DONE | — | — |
| 50 | Daily Requirement KG | DONE | — | — |
| 51 | Days Remaining | DONE | 1 decimal | — |
| 52 | Recommended Qty | DONE | — | — |
| 53 | Requested Qty KG | PARTIAL | misaligned column (see r24) | as r24 |
| 54 | Bag Count | DONE | — | — |
| 55 | Destination Silo | PARTIAL | same cell as r43, unlinked; no silo reservation for future diet | link; changeover → cp 5 |
| 56 | Proposed Delivery Date | DONE | — | — |
| (extra) | Batch/house breakdown | PARTIAL | `:539-541` plain batch/shed | link batch (`/batches/entry?batchId=`) and shed |

**§3 Loading Instruction Sheet** (`W/feed-loading-panel.tsx`, `A/procurement/feed-requisition/feed-loading.service.ts`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 60 | Loading Sheet No. (LOAD-ReqNo-LineNo) | PARTIAL | `LOAD-000001` `service:56` | format; deep-link target |
| 61 | Requisition No. | PARTIAL | `panel:53` plain | link `/requisitions?id=` |
| 62 | Farm Code | PARTIAL | `panel:55` plain | link |
| 63 | Farm Name | DONE | `panel:56` | — |
| 64 | Delivery Date | MISSING | `requested_delivery_date` stored (`service:63`), not shown | show |
| 65 | Feed Item No. + Diet No. | PARTIAL | item `panel:60`; Diet No not returned | API diet_no; show; link item |
| 66 | Feed Item Description | DONE | `panel:61` | — |
| 67 | Mill Loading Bin No. | PARTIAL | `panel:62` plain | link BIN |
| 68 | Silo Code at Farm | PARTIAL | `panel:57` plain | link silo |
| 69 | KG Ordered | DONE | `panel:64-65` | — |
| 70 | Compartment No. | DONE | `panel:67`; API `service:84-110` | — |
| 71 | KG Loaded | DONE | `panel:68`; API `service:82-83,111-114` | — |
| 72 | Loaded By | MISSING | stored as user id `service:117`; not shown/entered | name in decorate; show (editable) |
| 73 | Loading Date Time | MISSING | `loaded_at` stored `service:116-117`; not shown | show |
| 74 | Dispatch action (+notification) | PARTIAL | dispatch `service:121-133`; no notification | MILL_DISPATCH alert |
| 75 | Notification Status | MISSING | — | with r74 |
| 76 | Notification Content | MISSING | — | with r74 |
| 77 | Status | PARTIAL | raw code `panel:14,72` | label map |

**§4 Approval workflow**

| Row | Step | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 80 | 1 Auto-draft (+notify FM) | PARTIAL | AUTO_DRAFT `FRS:658,799`; no "auto-drafted" notification | alert event |
| 81 | 2 Diet change line | DONE | next-diet lines in one header (decision 7 Oct #4) | — |
| 82 | 3 FM reviews | DONE | document + Submit `W/feed-requisition-detail.tsx:324-328` | — |
| 83 | 4 Approve (remarks; loading sheet) | DONE | `FRS:1864-1916`; loading from consolidation (decision 9 Oct) | — |
| 84 | 5 Friday notification | PARTIAL | REQ_DEADLINE rule; not scheduled | scheduler |
| 85 | 6 Saturday notification | PARTIAL | same | scheduler |
| 86 | 7 Mill consolidation | DONE | `feed-consolidation.service.ts:145-209`, status IN_CONSOLIDATION `:206` | — |
| 87 | 8 Push to BC / TO created | N/A | decision 2026-10-03 #4; finalize + release create in-house transfer | — |
| 88 | 9 Load & dispatch (+notification) | PARTIAL | load/dispatch done; no notification; shipped qty not shown on requisition lines | r74 + line columns |
| 89 | 10 Farm posts TO receipt | PARTIAL | one posting path `FRS:1483-1503` → `stockTransfers.postReceipt`; per-line requested/approved/shipped/received/outstanding not all shown | line columns |

**§5 Consolidation Sheet** (`W/feed-consolidations-panel.tsx`, `W/feed-consolidation-dialog.tsx`, `A/procurement/feed-requisition/feed-consolidation.service.ts`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 115 | Consolidation Sheet No. | DONE | `service:183` CONS-YYYYWW-NNN | deep-link target |
| 116 | Production Week | DONE | `panel:72` | — |
| 117 | Consolidation Date | DONE | `panel:73` (ISO string) | use formatDateShort |
| 118 | Feed Mill Manager | MISSING | `created_by` id stored `service:192`; not returned as name/shown | API name + show |
| 119 | Farm Code | PARTIAL | `panel:104` plain; API UUID fallback `service:248` | link; no UUID fallback |
| 120 | Diet Feed Item No. | PARTIAL | `panel:106` plain; UUID fallback `service:252` | link |
| 121 | Diet No. | PARTIAL | create dialog only `dialog:91`; saved sheet none | API + column |
| 122 | Mill Loading Bin No. | PARTIAL | dialog only `dialog:92`; saved sheet none | API + linked column |
| 123 | Farm Requested Qty | DONE | `panel:107` | — |
| 124 | Total All Farms KG (diet) | PARTIAL | Compare Report only (`W/mill-compare-panel.tsx:175,183`) | per-diet subtotal on sheet |
| 125 | Mill Capacity Available | PARTIAL | dialog only `dialog:114-126` | show on sheet |
| 126 | Mill Approved Qty (+notify farm) | PARTIAL | `panel:108`; no farm notification | alert event |
| 127 | Adjustment Reason | DONE | enforced `service:163-165` | — |
| 128 | Consolidation Status | PARTIAL | raw `replaceAll` `panel:16,27`; REVIEWED never set; PUSHED_TO_BC N/A | label map; review step or drop |
| 129 | Push to BC | N/A | decision 2026-10-03 #4 (finalize `service:258-280`) | — |
| 130 | Transfer No. per farm | PARTIAL | transfer created at release, linked on requisition only | show linked transfer per line |

**§6 TO Receipt** (receipt panel `W/feed-requisition-detail.tsx:299-323`; shared `A/inventory/stock-transfer/stock-transfer.service.ts`)

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 135 | TO Receipt No. | PARTIAL | generated on post, not shown in feed dialog | show after post, linked |
| 136 | Requisition Slip No. | PARTIAL | receive from requisition works; transfer page shows no requisition | show requisition on transfer |
| 137 | Farm Code | DONE | farm check `FRS:1487-1489` | — |
| 138 | Destination Silo | DONE | fixed by release; item check `stock-transfer.service.ts:404` | — |
| 139 | Feed Item No. | PARTIAL | receive inputs labelled "line N" only `detail:315` | show item code (linked) |
| 140 | Feed Item Description | PARTIAL | not in receipt panel | show |
| 141 | Feed Type | PARTIAL | not in receipt panel | show |
| 142 | Farm Requested / Mill Approved | PARTIAL | in doc lines (mislabelled) only | show in receipt panel |
| 143 | Shipped Qty | PARTIAL | only as input `max` `detail:316` | show |
| 144 | Received Qty This Posting | DONE | `detail:312-321` | — |
| 145 | Variance Shipped vs Received | MISSING | — | compute + show |
| 146 | Variance Reason | MISSING | no DTO field | API + input |
| 147 | Bag Count Received | MISSING | — | API + input (BAGGED) |
| 148 | Compartment No. Received From | MISSING | loading sheet has it | show from loading sheet |
| 149 | Post Feed TO Receipt | DONE | single path `FRS:1483` → `postReceipt` `stock-transfer.service.ts:1240-1300` | — |
| 150 | Silo Balance After Receipt | MISSING | — | return + show |

**§7 Shipment and receipt control fields**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 153 | Mill Approved Qty | PARTIAL | under wrong header (`document.tsx:492`) | as r24 |
| 154 | Previously Received Qty | PARTIAL | `qty_received` in API view, not shown | line column |
| 155 | Outstanding Shipped Qty | PARTIAL | only input max | line/receipt column |
| 156 | BC TO Shipment Line ID | N/A | decision 2026-10-03 #4 (in-house shipment line ids give idempotency) | — |
| 157 | Receipt Posting Status (POSTED_PENDING_BC…) | N/A | decision 2026-10-03 #4 | — |

### Sheet: Silo Balance and Stock Take

**§1 Balance formula**

| Row | Component | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 5 | Opening approved stock | DONE | count post `feed-stock-count.service.ts` | — |
| 6 | + TO receipt received qty | DONE | `stock-transfer.service.ts:2013` | — |
| 7 | − POST Day consumed | DONE | `batch-daily-data.service.ts:939-1008` | — |
| 8 | = System Balance | DONE | ledger | label → cp 37 |
| 9 | Days of feed remaining (1 decimal) | DONE | `document.tsx` oneDecimal | dashboard shows 2 dp |
| 10 | Above threshold check | DONE | `feed-alert.rules.ts:143-160` | — |

**§2 TO Receipt fields**

| Row | Field | Status | Evidence | Fix needed |
|---|---|---|---|---|
| 13 | TO Receipt No. | PARTIAL | as Req r135 | — |
| 14 | Receipt Date | DONE | posting date `detail:253-258` | — |
| 15 | Transfer Order No. | PARTIAL | select `detail:244-251`, unlinked | link transfer |
| 16 | Source = MILL | DONE | — | — |
| 17 | Delivery Note No. | MISSING | — | API + input |
| 18 | Loading Sheet No. | MISSING | — | show/link loading sheet |
| 19 | Farm Code | DONE | — | — |
| 20 | Feed Item No. | PARTIAL | as r139 | — |
| 21 | Destination Silo | DONE | — | — |
| 22 | Feed Type | PARTIAL | as r141 | — |
| 23 | Requested Qty (locked) | DONE | not editable | — |
| 24 | Bag Count Received | MISSING | — | as r147 |
| 25 | Shipped Qty | PARTIAL | as r143 | — |
| 26 | Received Qty | DONE | — | — |
| 27 | Variance | MISSING | — | as r145 |
| 28 | Bag Count (dup) | MISSING | — | as r147 |
| 29 | Post Receipt | DONE | — | — |

**§3 Monthly Stock Take** — rows 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 48, 49: **ON BRANCH**
(`feat/monthly-stock-take`: MONTHLY count type, reporting-period link, period close/reopen, closed-period guard). Row 47
(D365BC GL Entry): **N/A** (decision 2026-10-03 #4).

### Sheet: Checkpoints and Validations

| # | Rule | Status | Enforcement (file:line) | Fix needed |
|---|---|---|---|---|
| 1 | Silo needs a house link before ACTIVE | MISSING | `A/master-data/location/location.service.ts` create sets ACTIVE (`:383`), restore `:1645-1652`; `attached_sheds` optional (`CFG:220`) | reject SILO activate/create without a shed link |
| 2 | Silo item changeover only empty/posted | DONE | `A/inventory/silo-feed/silo-feed.service.ts:94-170` | — |
| 3 | Silo↔house many-to-many | DONE | `silo_shed_link`; `silo-feed.service.ts:180-215` | — |
| 4 | Receipt item must match silo | DONE | `stock-transfer.service.ts:404` → `silo-feed.service.ts:94` | — |
| 5 | Changeover task + warn before approval | PARTIAL | flag `FRS:360`; no task, no approval warning | changeover task/warning |
| 6 | One diet per BIN per slot | DONE | `A/master-data/bin-diet-assignment/bin-diet-assignment.service.ts:152,231,235` | — |
| 7 | Next feed row read automatically | DONE | `feed-forecast.engine.ts:888-915` | — |
| 8 | No next row → notify Admin + FM | PARTIAL | `NO_FEED_ROW` flag `feed-forecast.engine.ts:691-700` shown in notes `W/feed-forecast-notes.tsx:71-72`; no notification | alert event |
| 9 | Next-diet silo by Feed Type → CRITICAL | PARTIAL | `NO_SILO_HOLDS_ITEM` `feed-forecast.engine.ts:576`; `feed-silo-status.ts:214` by item not feed type; no alert | feed-type match + alert |
| 10 | All notification config in master | DONE | `A/system/alert-rule/*`; evaluator reads rules `feed-alert.service.ts` | — |
| 11 | Single low threshold, dedupe | DONE | `feed-alert.rules.ts:143-160` (dedup key per rule+silo) | — |
| 12 | Recover and re-arm | DONE | `feed-alert.rules.ts:119-124`; triggers `stock-transfer.service.ts:2013`, `stock-adjustment.service.ts:369`, `batch-daily-data.service.ts:1008` | — |
| 13 | Above threshold INFO | DONE | `feed-alert.rules.ts:143-160` | — |
| 14 | POST Day cannot drive silo below 0 | DONE | `A/inventory/inventory-ledger/inventory-ledger.service.ts:567`; store fallback `batch-daily-data.service.ts:939` (8 Oct ruling) | — |
| 15 | From ≤ To, configurable max (45) | PARTIAL | `feed-forecast.service.ts:769`; max is constant `feed-forecast.view.ts:20` | tenant setting |
| 16 | 3,000 KG rounding; exception needs reason | PARTIAL | `FRR:129-133`; non-multiple qty within 20 % passes without reason | require reason off-multiple |
| 17 | 30 t target not a block | DONE | `FRR:20`, trips only | — |
| 18 | >20 % deviation → remarks | DONE | `FRR:141-145,352`; `FRS:1793-1806` submit, `:1903-1905` approve | — |
| 19 | FM approves own farm only | DONE | `FRS` `resolveOwnFarm` (~1504), `lockForApproval` `:1836-1862` | — |
| 20 | Friday/Saturday deadline alerts | PARTIAL | `feed-alert.rules.ts:177-196`; no scheduler (finding 5) | scheduler |
| 21 | Only consolidated plan proceeds | DONE | release gate `FRS:~1233-1258` | — |
| 22 | Production cutoff | DONE | late → remarks `FRR:362-364` | — |
| 23 | Both diet requisitions approved | DONE | one header, many lines (decision 7 Oct #4) | — |
| 24 | Compartment + KG before Dispatch | DONE | `feed-loading.service.ts:125` | — |
| 25 | No two diets per compartment | DONE | `feed-loading.service.ts:84-110` | — |
| 26 | Shipped ≠ received → reason | MISSING | no variance/reason in `stock-transfer.service.ts:1240-1300` or feed receipt DTO | API + UI |
| 27 | Bag count × bag size vs received | MISSING | — | API + UI |
| 28 | Bag reconciliation on POST Day | MISSING | — | POST Day check + alert |
| 29 | Over-receipt allowed with reason + notify mill | PARTIAL | hard-blocked `stock-transfer.service.ts:1292,1299` | allow with reason, flag, notify |
| 30 | Diet change alert 3 days, daily | PARTIAL | `feed-alert.rules.ts:162-176`; not scheduled | scheduler |
| 31 | Monthly stock take | ON BRANCH | `feat/monthly-stock-take` | merge |
| 32 | Closed period blocks POST Day | ON BRANCH | same | merge |
| 33 | Stock take variance > 2 % reason | ON BRANCH | (weekly count already requires reason for any variance `feed-stock-count.rules.ts:103-105`) | merge |
| 34 | Demand > capacity → notify | PARTIAL | consolidation blocked `A/inventory/feed-forecast/mill-capacity.service.ts:167`; Compare Report RED; no notification | alert event |
| 35 | BIN constraint | DONE | blocked at assignment (cp 6) | — |
| 36 | Wednesday tentative + notify | ON BRANCH | PLAN_AVAILABLE + schedule setting on branch, no cron | merge + cron |
| 37 | Always "SYSTEM BALANCE" | PARTIAL | dashboard/requisition OK; count dialog "System (kg)" (`fscColSystem`), balance dialog "Opening stock"/"closing stock" (`ffBalanceOpening`, `ffClosingBalanceShort` in `apps/web/src/utils/translations.ts:1914,1921,2267`) | relabel |
| 38 | Channels in-app/email | ON BRANCH | in-app on main; email on branch | merge |
| 39 | BC retries | N/A | decision 2026-10-03 #4 | — |
| 40 | Reporting period before stock take/close | ON BRANCH | `feat/monthly-stock-take` | merge |
| 41 | Consolidate only APPROVED | DONE | `feed-consolidation.service.ts:51` | — |
| 42 | Capacity check before push | DONE | `feed-consolidation.service.ts:168-173,265-277`; `mill-capacity.service.ts:167` | — |
| 43 | Shipment linked to requisition + consolidation | PARTIAL | link in data (requisition_line_id, consolidation line); transfer page shows neither | show/link on transfer |
| 44 | Requested Qty locked on receipt | DONE | not editable | — |
| 45 | Receipt silo filter / changeover | DONE | `silo-feed.service.ts:94-170` | — |
| 46 | Add received qty once | DONE | `stock-transfer.service.ts:1240-1300` | — |
| 47 | No feed GRN | PARTIAL | GRN may still land feed on a SILO `A/inventory/goods-receipt/goods-receipt.service.ts:69-89` | block FEED items to SILO via GRN |

### Rishi's common requisition list (`common-requisition-spec.md`) — reported separately

| Item | Status | Evidence | Fix needed |
|---|---|---|---|
| Header: No., Date, Requester ID/Name/Dept, Sender Dept, Type, Status, Purpose, Direct Transfer, Remarks (11) | DONE | `WR/common-requisition-document.tsx:156-207` | — |
| Header: Main/Farm Location, From Sub-Location, To Sub-Location (3) | PARTIAL | codes plain `:160,177,181` | link locations |
| Lines: Line No., Item Desc, FA/Service Desc, Qty, Qty to Ship/Shipped/to Receive/Received, Remaining, Balance (10) | DONE | `:212-253` | — |
| Lines: Item No., From Location, To Location (3) | PARTIAL | plain `:233,246-247` | link |
| Release button | PARTIAL | `WR/common-requisition-detail.tsx:146`; transfer/PO no. only in toast, not on document | show linked transfer/PO, linked |
| Transfer Shipment / Receipt buttons (2) | DONE | dept rule `A/procurement/requisition/requisition.rules.ts:599-610` | — |
| Item Tracking button | DONE | `document.tsx:269-278` | — |
| Validations: location dimension, user dept, ledger + value entry (3) | DONE | `requisition.rules.ts:599-610`; shared transfer service | — |

Common subtotal: 34 items — DONE 27, PARTIAL 7.

---

## 2. Prioritised fix list (groups disjoint by file → parallel-safe)

`apps/web/src/utils/translations.ts` is touched by most web groups: add keys **append-only, in a block named after the
group** (en dict only) and merge text-wise. Order: P1 first. Effort S ≤ ½ day, M ≈ 1–2 days, L ≥ 3 days.

### P1 — wrong or unreadable values

| Group | Files (exclusive) | Work | Effort | Scope |
|---|---|---|---|---|
| W1 Feed requisition document | `W/feed-requisition-document.tsx`, `W/feed-requisition-header.tsx` | (a) fix line column order (editable Requested Qty after Recommended; Mill Requested / Mill Approved / Adjustment under their headers) — Req r24/r53/§7 r153; (b) add Shipped / Received / Outstanding line columns from `qty_shipped`/`qty_received` already in the view — FF r12, Req r89, §7 r154-155; (c) link farm, silo, item, lifecycle row, breakdown batch (`/batches/entry?batchId=`) and shed, forecast run, consolidation no., every linked transfer; (d) consolidation status/next action via label map; t() for the hard-coded "Mill consolidation" labels; (e) render requester login/department and per-line BIN once A1 returns them | M | web-only (c, e need A1 for BIN/requester/transfer ids) |
| W3 Requisition labels + feed list | `W/requisition-labels.ts`, `W/requisitions-panel.tsx` | add IN_CONSOLIDATION, consolidation (DRAFT/REVIEWED/CONSOLIDATED) and loading (DRAFT/LOADED/DISPATCHED/RECEIVED) label maps with variants; `labelOf(null)` → explanatory text, not "—"; feed list Type=Item + Source column (Req r7); link farm; status filter adds IN_CONSOLIDATION/RELEASED/SHIPPED/RECEIVED | S | web-only |
| W9 Stock transfers | `W/stock-transfer-panel.tsx`, `W/stock-transfer-status.ts` | use `transferStatusLabelKey` (PARTIALLY_RECEIVED raw today, `:158-164`); remove UUID fallbacks (`:997,2153,2724,2817,2964`); show + link source requisition, consolidation, loading sheet (cp 43, Req r136); add `?id=` deep-link open | M | web-only (requisition no. on transfer may need A2 list join) |
| A6 Run author | `A/inventory/feed-forecast/feed-forecast-run.service.ts` + `W/feed-forecast-run-history.tsx` | return author name (join user_master) instead of id; show name; `?id=` open of a saved run | S | API-touching |

### P2 — missing receipt/loading/consolidation fields

| Group | Files (exclusive) | Work | Effort | Scope |
|---|---|---|---|---|
| A2 Transfer receipt controls | `A/inventory/stock-transfer/stock-transfer.service.ts`, `A/inventory/stock-transfer/dto/stock-transfer.dto.ts`, `A/procurement/feed-requisition/dto/feed-requisition.dto.ts`, migration | variance (shipped − received) with mandatory reason (cp 26), over-receipt allowed with reason + flag (cp 29), bag count validation for BAGGED (cp 27), delivery note no. (Silo r17), loading sheet ref (r18), return silo balance after receipt (r150) | L | API-touching |
| W2 Feed receipt panel | `W/feed-requisition-detail.tsx` | per line: item code/description/feed type, requested, mill approved, shipped, previously received, outstanding, variance, variance reason, bag count, compartment from loading sheet; receipt no. after post; label transfer/shipment selects with links (Req r135-150, Silo r13-28) | M | web (needs A2) |
| A4 Loading API | `A/procurement/feed-requisition/feed-loading.service.ts` | decorate: loaded_by name, diet_no, delivery date; no raw-id fallbacks (`:178-185`); accept loadedBy; `LOAD-<ReqNo>-<LineNo>` numbering (r60); raise MILL_DISPATCH notification on dispatch with notification status/content (r74-76) | M | API-touching (event needs A9) |
| W5 Loading panel | `W/feed-loading-panel.tsx`, `apps/web/src/app/(app)/inventory/feed-loading/page.tsx` | Delivery Date, Diet No., Loaded By, Loading Date Time, notification status; status labels (W3 map); link requisition, farm, silo, BIN, item, shipment; `?id=` deep link | M | web (needs A4) |
| A3 Consolidation API | `A/procurement/feed-requisition/feed-consolidation.service.ts` | `findOne`: Feed Mill Manager name, diet_no, BIN, capacity, per-diet all-farm total, linked transfer per line; drop UUID fallbacks (`:246-253`); notify farm when mill-approved ≠ requested (r126) | M | API-touching |
| W4 Consolidation panel | `W/feed-consolidations-panel.tsx`, `W/feed-consolidation-dialog.tsx` | show r118, r121, r122, r124, r125, r130 on the saved sheet; status labels; formatDateShort; link requisition/farm/silo/item/loading sheet; replace "—" (`dialog:104`); `?id=` deep link | M | web (needs A3) |
| A1 Feed requisition API | `FRS`, `FRR` | readView: requester login/department, per-line Mill Loading Bin (r32), all linked transfers (r39), ids for links; cp 16 reason when requested qty is off the bulk multiple; FM priority escalate (r34) | M | API-touching |

### P3 — linking and display completeness

| Group | Files (exclusive) | Work | Effort | Scope |
|---|---|---|---|---|
| W6 Dashboard | `W/feed-silo-dashboard-cards.tsx`, `W/feed-silo-dashboard.tsx` | show First Shortage Date for Days of Feed Remaining (r55); linked Shed row (r48); link BIN (r51), current/next diet item (r50, r58) | S | web (+A5 for item ids) |
| A5 Silo status | `A/inventory/feed-forecast/feed-silo-status.ts` | return current/next diet item id + code; next-diet silo by feed type (r59, cp 9) | S | API-touching |
| W7 Forecast grid | `W/feed-forecast-grid.tsx` | link batch, house, silo, required/current item, planned requisition refs (r70) | S | web-only |
| W8 + A7 Stock count | `W/feed-stock-count-panel.tsx`, `A/inventory/feed-stock-count/feed-stock-count.service.ts` | entry/lines: silo name, linked house, capacity, diet description, projected shortfall, next diet in X days (≤7 warning), next item (Engine r8-17); no `siloId` fallback; link silo/item | M | API-touching |
| W10 Feed plan + compare | `W/feed-plan-panel.tsx`, `W/mill-compare-panel.tsx` | link farm/item/BIN; `?id=` open of a plan version | S | web-only |
| W11 Alerts list | `apps/web/src/components/console/production/alert-panel.tsx`, `.../production/alerts-list.ts` | link alert subject (silo/requisition/batch) and farm; no "—" | S | web-only |
| W12 Common requisition | `WR/common-requisition-document.tsx`, `WR/common-requisition-detail.tsx` | link main/from/to locations and items; show linked transfer no. / PO no. on the document | S | web-only |
| W13 Master data configs | `CFG` (+ `A/master-data/location/location.service.ts`) | silo record read-only: Feed in Silo, Available Stock, System Balance, Last Approved Count, Last Feed Receipt, Next Diet Change (Master r13-20); cp 1 silo needs a shed before ACTIVE; feed-only item pickers for lifecycle/BIN (r26, r38); Role Master pickers for recipient/escalation roles (r50, r54); relabel count "System (kg)" etc. (cp 37) | M | API-touching |

### P4 — rules and notifications (after merging both branches)

| Group | Files (exclusive) | Work | Effort | Scope |
|---|---|---|---|---|
| Merge | `feat/feed-scheduler-email`, `feat/monthly-stock-take` | review and merge; apply migrations 0166/0167 via the tenant runner (migrate, never rebuild) | M | API-touching |
| A12 Scheduler | new `A/inventory/feed-scheduler/*` | cron: Friday/Saturday REQ_DEADLINE, daily DIET_CHANGE, Wednesday tentative plan + PLAN_AVAILABLE (cp 20, 30, 36; Engine r64, r69; Req r84-85) | L | API-touching |
| A9 Alert events | `A/system/alert-rule/alert-rule.rules.ts`, `A/inventory/feed-alert/feed-alert.rules.ts`, `A/inventory/feed-alert/feed-alert.service.ts` | events: MILL_DISPATCH, RECEIPT_VARIANCE, NO_NEXT_FEED_ROW (cp 8), NEXT_DIET_NO_SILO (cp 9), CAPACITY_EXCEEDED (cp 34), SHORTFALL / NOT_DRAFTED / TRUCK_TARGET (Dashboard r60-62), AUTO_DRAFTED (Req r80), MILL_ADJUSTED (r126), STOCK_TAKE_DUE | L | API-touching (same files as scheduler branch → after merge) |
| A10 No feed GRN | `A/inventory/goods-receipt/goods-receipt.service.ts` | refuse FEED item GRN into a SILO (cp 47) | S | API-touching |
| A11 Forecast span | `A/inventory/feed-forecast/feed-forecast.view.ts`, `A/inventory/feed-settings/*` | tenant-configurable max span, default 45 (cp 15) | S | API-touching |
| A13 Changeover + bag reconciliation | `A/inventory/silo-feed/silo-feed.service.ts`, `A/production/batch-daily-data/batch-daily-data.service.ts` | changeover task/warning before approval (cp 5); empty-bag reconciliation on POST Day (cp 28) | M | API-touching |
| A14 Lifecycle effective dates | schema + breed-lifecycle module + `CFG` (after W13) | effective-dated feed rows (Master r38) | M | API-touching |

---

## 3. Totals

| Sheet | Rows | DONE | PARTIAL | MISSING | ON BRANCH | N/A |
|---|---|---|---|---|---|---|
| Feed Forecast (principles) | 10 | 6 | 2 | 0 | 2 | 0 |
| Master Setup | 43 | 28 | 10 | 3 | 1 | 1 |
| Feed Forecast Engine | 55 | 31 | 23 | 0 | 1 | 0 |
| Requisition and Loading Sheet | 115 | 52 | 44 | 12 | 0 | 7 |
| Silo Balance and Stock Take | 40 | 13 | 5 | 5 | 16 | 1 |
| Checkpoints and Validations | 47 | 24 | 12 | 4 | 6 | 1 |
| **Workbook total** | **310** | **154** | **96** | **24** | **26** | **10** |
| Common requisition list (separate) | 34 | 27 | 7 | 0 | 0 | 0 |

Requisition and Loading Sheet breakdown: §1 35 (24/8/1/0/2), §2 15 (10/4/0/0/1), §3 18 (5/8/5/0/0), §4 10 (4/5/0/0/1),
§5 16 (5/9/1/0/1), §6 16 (4/7/5/0/0), §7 5 (0/3/0/0/2). Extra non-workbook rows (requester, consolidation block,
breakdown) are listed but not counted.

**Completion (workbook, excluding N/A = 300 rows):**
- Strict (DONE only): 154 / 300 = **51.3 %**
- With both branches merged: 180 / 300 = 60.0 %
- Weighted (PARTIAL = ½): (154 + 48) / 300 = 67.3 %

About half of the 96 PARTIAL rows fail only on linking (rule b); the P1 + P3 web groups clear most of them without API work.
