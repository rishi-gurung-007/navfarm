# Task 22 — Feed screens vs TDD workbook, field by field

Date: 2026-10-04. Read-only audit. Workbook: `NAVFarm_Feed forecast TDD with examples (1).xlsx`
(row numbers are the sheet's own cell rows). Code: this worktree at `5ac07a01` plus the other
session's uncommitted approval-service edits (not touched by this audit). Paths below are relative
to `apps/web/src/` unless stated.

Governing rulings: decisions.md 2026-10-03 (workbook governs feed; in-house only; BC-only fields
such as "Sync to NAVFarm" not built), 2026-10-04 x3 (where each requisition kind is created;
create/edit in a dialog; field for field, real dashboard with charts and selectors, silo code and
name on the forecast).

Live checks (browser pane, http://localhost:3002, GRA100): Dashboard tab text read; Feed
Requisition tab list read; New requisition opened (chooser shown) and closed without saving.
Physical Count had no counts for GRA100, so the count-detail finding (raw IDs) is from code.

Legend: match / mismatch / missing / extra. "Part B/C/D" = not built yet by plan, not a gap.

---

## 1. Feed Forecast (Inventory → Feed Forecast → Forecast tab)

Files: `components/console/inventory/feed-forecast-panel.tsx` (filters 219-256, Save Run 298-302),
`feed-forecast-grid.tsx` (columns 78-83, render 284-378), `feed-forecast-run-history.tsx`.

### 1a. Filters — Engine §1 rows 6-10, §5 row 67; Feed Forecast sheet row 8 (C8 lists the controls)

| Workbook | Screen label | Result | Note |
|---|---|---|---|
| Farm Code (Engine r6, auto from user, cannot change) | Farm (`ffFarm`, panel:220) | match | Fixed label for a farm user; selector for admins. Shows "CODE — Name", so Farm Name (r7) is covered. |
| Farm Name (r7) | inside Farm option text | match | |
| Silo Code filter (r8; FF r8 C8 "silo") | MISSING | missing | No silo filter. |
| House filter (FF r8 C8 "house") | MISSING | missing | |
| Batch filter (FF r8 C8 "batch") | MISSING | missing | |
| Feed item filter (FF r8 C8) | MISSING | missing | |
| Bulk / bagged filter (FF r8 C8) | MISSING | missing | |
| Plan type (FF r8 C8) | MISSING | not built (Part C) | Tentative/actual plan is Part C. |
| View and Period (Engine r67: Daily, Weekly, Reporting Period, Custom) | View (`ffView`, panel:227-230): Daily / Weekly / Reporting Period / Custom | match | Default is Custom. |
| Weekly → week start date (r67) | Week Start (panel:245) | match | |
| Reporting period → configured dates (r67) | Reporting Period select "CODE (from – to)" (panel:235-241) | match | |
| Custom → From / To (r67) | Date From / Date To (panel:245-253) | match | |
| (none) | Planning Date (panel:222) | extra | Our "as of" date; workbook's run date is r68. Keep (drives the engine). |
| Scheduled Planning (r69) | MISSING | not built (Part D) | Scheduler. |

### 1b. Run Date and Version — Engine r68

| Workbook | Screen | Result | Note |
|---|---|---|---|
| Run ID (RUN-GRS-20260923-001) | run code in Run history (run-history:65), "Saved {code} (version n)" (panel:183) | match | |
| Run version | "Version n" (run-history:67) | match | |
| As-of timestamp | MISSING | missing | `created_at` is fetched (run-history:17) but not shown. |
| Source posting cutoff | MISSING | missing | Stored (`feed_forecast_run.source_cutoff_at`, api schema.ts:339), not shown. |
| Selected filters | partial — view + from/to only | mismatch | No farm/period shown on the row (farm implied). |
| Lifecycle config version | MISSING | missing | Stored in `config_snapshot.version`, not shown. |
| Author | MISSING | missing | `created_by` stored, not shown. |

### 1c. Output detail columns — Engine r70 (and §2 steps 1-9, rows 22-30)

Grid is one row per batch + item + shed with date columns (2026-10-02 ruling 1, still standing).

| Workbook (r70 order) | Screen column (grid:287-311) | Result | Note |
|---|---|---|---|
| Farm | MISSING (in filter only) | match (filter) | One farm per view; acceptable. |
| Batch | Batch No | match | Step 1 r22. |
| House | Shed No | mismatch (label) | Workbook says House / House Shed. |
| Silo | MISSING | missing | 4 Oct ruling 4: silo code AND silo name on the rows. `sourceCode` is in the row data (grid:34) but never rendered. |
| Required feed item | Item Name, Item No | match | Step 3 r24. Two columns; order name-then-no. |
| Current silo item | MISSING | missing | r70 and Engine r11 — the physical item tag, shown separately from the required item. |
| Head count | Current No. of Pigs | match | Step 2 r23 ("date and provenance visible" — provenance not shown). |
| Rate | Per Day Intake (Kg) | mismatch | Shows heads x rate (daily KG), not the KG/head/day rate. The rate itself is missing. |
| Opening stock | System Balance (Kg) | match | Label rule Silo Balance r8 ("always SYSTEM BALANCE") met. |
| Receipts (confirmed incoming) | MISSING | missing | Step 7 r28 "confirmed incoming TO quantities". TO receipts are Part C, but the column could show 0 / in-house receipts. |
| Daily use | MISSING as a column | missing | Date columns show projected stock, not use. |
| Projected closing | date columns (stock per day/week) | match | Step 6/7. |
| Shortage date | First Shortage Date | match | 3 Oct ruling 3. |
| Recommended quantity | MISSING | missing | Step 8 r29. Only on Dashboard and requisition. |
| Delivery date | MISSING | missing | r70. |
| (ours) | Current No of Days Stock | extra | Indicative (Engine r55 says date-based; kept with "Indicative" badge). |
| Next diet (Step 5 r26, split current/next lines Step 6 r27) | separate rows per item + Stages sub-tab (grid:382-420) | match | Next item gets its own row; Stages tab shows stage change dates. |
| Destination silo flag for different item (Step 5) | MISSING | missing | Changeover flag shown only on requisition lines. |
| Notes / flags (missing lifecycle rows, Step 3 "block affected line") | Notes panel (feed-forecast-notes.tsx) | match | |
| Save Run | "Save Run" (panel:298-302) | match | |
| Dashes | grid uses "" for blanks, Stages uses "—" (grid:402,406) | mismatch | 2026-10-02 ruling 3 (no dashes); minor. |

## 2. Feed Forecast Dashboard (Inventory → Feed Forecast → Dashboard tab)

File: `components/console/inventory/feed-silo-dashboard.tsx` (columns 62-66, render 156-205);
API `apps/api/src/modules/inventory/feed-forecast/feed-silo-status.ts`, controller:101-108 (fixed
seven-day forecast).

4 Oct ruling 3: select farm, date/range or reporting period, house, silo, feed item, bulk/bagged
first; then charts and graphs with the table beneath. Screen today: Farm + Planning Date, then a
22-column table. **No charts, no range/period selector, no house/silo/item/bulk filters.**

| Workbook (Engine §4) | Screen column | Result | Note |
|---|---|---|---|
| r47 Farm (auto user, read-only) | Farm selector (dash:122) | match | |
| r48 House Shed | House | match | Label "House" vs "House Shed"; acceptable. Shown 2nd, workbook order 2nd. |
| r49 Silo Code (clickable → silo detail) | Silo (dash:167-169) | mismatch | Plain text, not a link. No silo name. |
| r50 Current Diet Feed Item (from lifecycle) | Current Diet (dash:182) | match | Item name only; "notification if diet changing within 3 days" not shown. |
| r51 Mill Loading Bin No. | MISSING | not built (Part B) | |
| r52 Silo Capacity KG | Capacity (kg) | match | |
| r53 System Balance KG | System Balance | match | Label lacks "KG"; alert column covers the CRITICAL/INFO trigger. |
| r54 Daily Requirement KG | Daily Requirement (kg) | match | |
| r55 Days of Feed Remaining (date-based) | Days Remaining + First Shortage Date | match | Both shown. Live: First Shortage blank ("—") on every GRA100 row. Below-3/below-7 colouring absent. |
| r56 Projected Need for Selected Range KG (old and next item broken out) | Projected Need (kg) | mismatch | Range is fixed 7 days (no selector); not broken out by old/next item. |
| r57 Current Diet Days Remaining | MISSING | missing | |
| r58 Next Diet Feed Item | Next Diet ("name · date") | match | |
| r59 Silo Available for Next Diet Feed Type | Silo Available for Next Diet | match | |
| r60 Projected Shortfall KG | Projected Shortfall (kg) | match | |
| r61 Recommended Order Qty KG | Recommended Order (kg) | match | "Notification if requisition not yet drafted" not shown. |
| r62 Farm Total Order This Cycle KG (vs 30 t) | MISSING | missing | Sum across silos vs truck target. |
| r63 Requisition Status (display and link) | Requisition Status (dash:191) | mismatch | Raw code ("APPROVED", "DRAFT" seen live), not the label, not a link. |
| r64 Submission Deadline | Submission Deadline | match | |
| (ours, Master Setup §1) | Feed Type, Feed in Silo, Below Feed Level, Above Threshold, Last Approved Count, Last Feed Receipt | extra | All from Location Master §1 (rows 10,12,13,16,19); useful, keep. |
| (ours) | Alert | extra | Carries r53's trigger; keep. |
| order | workbook: Farm, House, Silo, Diet, Bin, Capacity, Balance, Daily... | mismatch | Screen puts Silo first and inserts the master fields between Capacity and Balance. |
| dashes | "—" everywhere (dash:75-76) | mismatch | 2026-10-02 ruling 3. |

## 3. Physical Stock Count (Inventory → Feed Forecast → Physical Count tab)

File: `components/console/inventory/feed-stock-count-panel.tsx` (list 82, lines 83, entry 373-421,
detail 448-470).

| Workbook (Engine §1) | Screen | Result | Note |
|---|---|---|---|
| r6 Farm Code | Farm (panel:265) | match | |
| r7 Farm Name | in Farm option | match | |
| r8 Silo Code (active silos of farm) | Silo (entry 376) | match | Entry lists ledger pairs from /feed-stock-count/evidence. |
| r9 Silo Name | MISSING | missing | |
| r10 House Shed(s) Linked | MISSING | missing | |
| r11 Silo Feed Item No. | Item (entry 377) — item code | match | Required-item-by-batch shown separately: missing. |
| r12 Current Diet Description | MISSING | missing | |
| r13 Silo Capacity KG | MISSING | missing | |
| r14 Current Balance Stock (KG) | System (kg) | mismatch (label) | Workbook "Current Balance Stock (KG)"; Silo Balance r8 says label it System Balance — use "System Balance KG". |
| (Master r11) Physical Count Date Time, default now | Counted at (panel:302) | match | datetime-local, default now. |
| Physical count KG | Counted (kg) | match | |
| r15 Projected Shortfall (KG) (7-day need − count) | MISSING | missing | |
| r16 Next Diet Change in X Days (warn ≤7) | MISSING | missing | |
| r17 Next Feed Item within range | MISSING | missing | |
| r18 Save Count and Submit Variance | Save / Submit / Post (panel:425,475,480) | match | Approval in inbox; post adjustment. "Then rerun forecast" is not prompted. |
| Variance KG (Silo Balance r42) | Variance (kg) — detail only | match | |
| Variance % (SB r43) | Variance (%) — detail only | match | |
| Variance Reason (SB r44) | Reason (ReasonSelect, shown when counted ≠ system) | match | |
| Source (ours) | Source: On demand / Scheduled | extra | Engine r4 "configured schedule or on demand". Keep. |
| Count detail lines | `line.silo_id`, `line.item_id`, `line.reason_id` printed raw (panel:463-469) | mismatch (defect) | Detail shows UUIDs instead of silo code, item code and reason text. |

## 4. Feed Requisition (Feed Forecast → "Internal Feed Transfer" tab; Approvals → Requisitions; inbox)

Files: `components/console/inventory/feed-requisition-document.tsx` (header 285-324, lines
201-204 and 333-456), `requisitions-panel.tsx` (list 65, toolbar 186-203, detail in place
215-220), `requisition-new-dialog.tsx` (manual create), `feed-requisition-detail.tsx`,
`components/console/requisitions/requisitions-hub.tsx` (second entry point),
`components/console/approvals/feed-requisition-approval-detail.tsx:56` (inbox, `editable={false}`).

Entry points: both use the same `FeedRequisitionDocument` and API — match with 4 Oct ruling.
Inbox: same document, read-only — match.

Tab label: `fftTabFeedRequisition` = "Internal Feed Transfer" (translations.ts:1872). Workbook calls
the document "Feed Requisition" (sheet title r1, §1 r3); decisions say "Feed Requisition tab".
**mismatch.**

Ruling 1 (4 Oct, New = Feed automatically): live check — New opens "What is this requisition for?"
with one Feed card (`requisition-new-dialog.tsx` `useEffect(() => { if (open) setStep("choose") })`).
**Not done.**

Ruling 2 (4 Oct, create AND edit in a dialog): create is a dialog; opening an existing
requisition renders `FeedRequisitionDetail` in place of the list (requisitions-panel:215-220,
requisitions-hub:177). **Edit is not in a dialog.**

### 4a. Header — Requisition sheet §1

Screen order is the order of `ReadField`s in document:286-323.

| Workbook (row) | Screen label | Result | Note |
|---|---|---|---|
| r5 Requisition No. (REQ-FarmCode-YYYY-NNNNN) | Requisition No. | match | Live: REQ-GRA100-2026-00005. |
| r6 Requisition Date | Requisition Date | match | |
| r7 Requisition Type (FEED_FORECAST / MANUAL) | Requisition Type | match | Live list shows "From forecast"/"Manual". |
| r8 Source | Source | match | |
| r9 Farm Code | Farm Code | match | |
| r10 Farm Name | Farm Name | match | |
| r11 Silo Code | on lines | match (by design) | 3 Oct ruling: lines per silo/item; header has many silos. |
| r12 Current Silo Feed Item No. | not shown | match | Workbook says REMOVED. |
| r13 Feed Item No. to Order | on lines | match (by design) | |
| r14 Feed Item Description | on lines | match (by design) | |
| r15 Feed Type | on lines | match (by design) | |
| r16 Is Next Diet Requisition | Is Next Diet Requisition | match | Shown 7th, workbook 12th of its fields — order fine relative to neighbours. |
| r17 Breed Lifecycle Row Reference | on lines + breakdown | match (by design) | |
| r18 System Balance at Draft KG | on lines ("System Balance KG") | match (by design) | |
| r19 Daily Requirement KG | on lines | match (by design) | |
| r20 Days Remaining at Draft | on lines | match (by design) | |
| r21 Days Before Diet Change | on lines | match (by design) | |
| r22 Recommended Qty KG | on lines | match (by design) | |
| r23 Bag Count | on lines | match (by design) | |
| r24 Requested Qty KG | on lines | match (by design) | |
| r25 Requested Qty Bags | "Bagged total requested" (only when bagged lines exist) | match | |
| r26 Farm Total Requested KG | "Bulk total requested (vs truck target)" | mismatch (label) | Value "x KG of 30,000 KG target · n truck trip(s)". Use the workbook label. |
| r27 Bulk Truck Target KG | folded into r26's value | mismatch | Workbook lists it as its own field. |
| r28 Bulk Order Multiple | Bulk Order Multiple | match | |
| r29 Required Delivery Date (editable with reason) | Required Delivery Date — read-only | mismatch | Editable per line (Proposed Delivery Date) not on header; acceptable if the header is derived = earliest line. Document says so? No. |
| r30 Supplier or Source (MILL) | Supplier or Source | match | |
| r31 Requisition Purpose (INTERNAL_TRANSFER) | Requisition Purpose | match | |
| r32 Mill Loading Bin No. | MISSING | not built (Part B) | |
| r33 Status | Status (badge) | match | Order: shown 8th, workbook after r32. |
| r34 Priority (Farm Manager can escalate) | Priority — read-only | mismatch | Workbook E34 "Yes - can escalate". |
| r35 Submission Deadline | Submission Deadline | match | |
| r36 Remarks (mandatory >20 % deviation) | Remarks (editable, hint and error) | match | Also required for moved date / item exception / late — stricter than r36 (from checkpoints). |
| r37 Approved By | Approved By | match | |
| r38 Approval Date Time | Approval Date Time | match | Shown with "UTC" suffix. |
| r39 Linked Transfer Order No. | Linked Transfer Order No. | match | Empty until in-house TO (Part C). |
| (ours) | Forecast Run | extra | Engine r30 "preserve run ID". Keep. |
| Order overall | Status, Priority, Deadline, Required Date, Supplier, Purpose, Farm Total, Multiple | mismatch | Workbook order: Farm Total(26), Truck Target(27), Multiple(28), Required Date(29), Supplier(30), Purpose(31), Status(33), Priority(34), Deadline(35). Screen puts Status/Priority/Deadline first. |

### 4b. Lines — Requisition sheet §2 (document:201-204, 351-421)

| Workbook (row) | Screen column | Result | Note |
|---|---|---|---|
| r42 Line No. | Line No. | match | Shows 1,2 (workbook 10000 illustrative). |
| r43 Silo Code (lookup, editable) | Silo Code (select when editable) | match | |
| r44 Current Silo Feed Item No. | not shown | match | REMOVED. |
| r45 Feed Item No. to Order | "Feed Item No." | mismatch (label) | Add "to Order". |
| (header r14) | Feed Item Description | extra | Useful; keep. |
| r46 Feed Type | Feed Type | match | |
| r47 Is Next Diet Line | Is Next Diet Line | match | |
| r48 Days Before Diet Change | Days Before Diet Change | match | |
| (header r17) | Breed Lifecycle Row | extra | Keep (header field moved to line). |
| r49 System Balance KG | System Balance KG | match | |
| r50 Daily Requirement KG | Daily Requirement KG | match | |
| r51 Days Remaining | "Days Remaining / First Shortage Date" | match | One decimal + date. |
| r52 Recommended Qty KG (editable per E52) | Recommended Qty KG, read-only, with "need x" | match | Requested is the editable one; fine. |
| r53 Requested Qty KG | Requested Qty KG (input) | match | Capacity warning icon. |
| r54 Bag Count (requested/50) | Bag Count | match | "—" for bulk. |
| r55 Destination Silo | MISSING as its own column | mismatch | Screen merges Silo Code (r43) and Destination Silo (r55) into one column. Workbook has both; changeover flag shows under it. |
| r56 Proposed Delivery Date | Proposed Delivery Date | match | |
| Batch / house breakdown (Engine r30, 3 Oct ruling) | nested breakdown table: Batch No., House, Heads, Rate, Lifecycle Row, Demand KG | match | |

### 4c. Manual create dialog (requisition-new-dialog.tsx)

Fields: Farm, then per line "Silo or store", "Feed", "Kg", "Deliver by", "Exception reason";
Remarks. Labels are not the workbook's (r43 Silo Code, r45 Feed Item No. to Order, r53 Requested
Qty KG, r56 Proposed Delivery Date) — **mismatch (labels)**. List columns (panel:65) use short
labels too ("Requisition", "Required by", "Submit by", "Requested (kg)").

## 5. Common requisition (Item / Fixed Asset / Service) — Approvals → Requisitions

No workbook spec (Rishi's 1 Oct spec). Files: `components/console/requisitions/common-requisition-document.tsx:72-182`,
`common-requisition-detail.tsx`.

Header: Requisition No., Type, Store or Purchase, Requisition date, Main location, Requester,
Requester department, Sender department, From location (Store), To location (Store), Direct
transfer (Store), Required date, Approval, Document, Fulfilment, Integration, Approved by,
Approved at, Released by, Released at, Linked PO No. (Purchase), Linked transfer (Store),
Justification, Remarks.
Lines: Line, Item (Item) / Resource (Service), Description, Quantity, UOM, Est. rate; Store adds
From, To, Qty to ship, Shipped, Balance to ship, Qty to receive, Received, Remaining to receive.
Actions: Save, Submit, Reopen, Release, Link PO, Ship, Receive.
Ruling 2 (4 Oct): created via the chooser dialog, but opened/edited in place (requisitions-hub
renders CommonRequisitionDetail instead of the list) — **not yet a dialog**.

## 6. Masters

### 6a. Location Master — silo (Master Data → Locations, type SILO) — Master Setup §1

Files: `modules/master-data/configs.ts:43-200` (location), plus silo columns in
`components/console/inventory/feed-planning-panel.tsx` (Settings → Inventory Setup → Feed Planning).

| Workbook (row) | Screen | Result | Note |
|---|---|---|---|
| r5 Location Code (Manual, FarmCode-HouseCode-SILOx) | Code — read-only, generated from type prefix (configs:65) | mismatch | Live codes "GRA100/SILO-001". Workbook says manual and house in the code. Needs Rishi ruling before changing. |
| r6 Location name | Name | match | |
| r7 Location Level = SILO | Location Type = SILO | match | |
| r8 House Code + silo-house mapping (with effective dates / batch house allocation) | Parent Location + Attached Sheds (multi-select, configs:178-187) | mismatch | Mapping exists; no effective dates or allocation. Label "Attached Sheds" vs "House". |
| r9 Silo Capacity KG | Silo Capacity + Silo Capacity UOM (KG/TON) | match | UOM extra (client request 24 Sep). |
| r10 Below Feed Level KG | Below Feed Level KG | match | |
| r11 Physical Count Date Time | not on master | match | Lives on the count transaction (Physical Count tab). |
| r12 Above Threshold KG | Above Threshold KG | match | |
| r13 Last Approved Physical Count (KG), read-only | not on master; Dashboard "Last Approved Count (kg)" | mismatch | Shown on dashboard only, not on the silo record. |
| r14 System Balance KG | not on master; Dashboard | mismatch | Same. |
| r15 Days to First Shortage | not on master; Dashboard First Shortage Date | mismatch | Same. |
| r16 Feed in Silo | not on Location form; Feed Planning "Feed Item Code/Name", Dashboard "Feed in Silo" | mismatch | Shed record view shows "holding X" (MasterRecordView:140). |
| r17 Available stock | MISSING | missing | Dashboard System Balance is the same figure; no field so named. |
| r18 Blocked (Active/Inactive) | row Active toggle; Feed Planning "Status" | match | |
| r19 Last Feed Receipt Date | not on master; Dashboard "Last Feed Receipt" | mismatch | |
| r20 Next Diet Change Date | not on master; Dashboard "Next Diet" date | mismatch | |
| (Feed Type, FF r4 / Req r15 "from Location Master") | Feed Type on Feed Planning silo table (editable) | match | Not on the Location form itself. |
| (ours) | Refill Lead Time (days) | extra | Kept by 3 Oct ruling 6; forecast does not read it. |

Summary: r13-r20 are derived read-only fields; they exist on the Dashboard but the silo record
(Location view) shows none of them. Either add a read-only "Feed status" block to the silo
record view or accept the dashboard as their home (Rishi to say).

### 6b. Item Master — Master Setup §2 (configs.ts:916-1095)

| Workbook | Screen | Result | Note |
|---|---|---|---|
| r24 Item No. | Item No. (list) / Code (form, read-only, number series) | mismatch (label) | Form says "Code". |
| r25 Item Description | Description (list) / Name (form) | mismatch (label) | |
| r26 Item Type (FEED) | Item Type | match | |
| r27 Base UOM (KG) | Base Unit of Measure (list) / Primary UOM (form) | mismatch (label) | |
| r28 Sync to NAVFarm | not built | match | BC-only, excluded 3 Oct. |
| (§2 r22 / Loading r65) | Diet No. (1-14) | extra | Needed for Part B mill planning. |

### 6c. Breed Lifecycle Stage Config — Master Setup §3 (Breed → Lifecycle Stages tab, configs.ts:1172-1290)

| Workbook | Screen | Result | Note |
|---|---|---|---|
| r32 Line Code | Breed | mismatch (label) | Same lookup (breed/line). |
| r33 Stage Code | Stage | match | |
| r34 Calculation Unit (Week/Day/Month) | Period Unit (DAY/WEEK/MONTH) | mismatch (label) | |
| r35 Period From | Period From | match | |
| r36 Period To | Period To | match | |
| r37 feed bulk / bagged | Feed Form (Bulk/Bagged) | mismatch (label) | |
| r38 Feed Item No. (effective dated) | Feed | mismatch | Label; and no effective-date fields on the row (r38 E "Effective dated", Step 3 r24). |
| r39 Feed Rate KG per Day/Per Animal (farm override supported) | Daily Feed per Head (kg) | mismatch | Label; no farm override field. |
| order | Feed shown after Teats/Season, then rate, then Feed Form | mismatch | Workbook: Line, Stage, Unit, From, To, Bulk/Bagged, Item, Rate. |
| (ours) | Category, Season, Teats, Wastage, ADG, FCR, mortality, output, KPIs, resources, vaccination | extra | Breed template fields; keep. |

### 6d. Alerts and Notifications Master — Master Setup §4 (Master Data → Alert Rules, configs.ts:1433-1500)

| Workbook | Screen | Result | Note |
|---|---|---|---|
| r43 Notification Code (Auto) | Code — typed, required, create-only | mismatch | Workbook says auto. |
| r44 Notification Name | Name | mismatch (label) | |
| r45 Event Type (9 events) | Event Type: 4 (FEED_BELOW_L1, FEED_ABOVE, DIET_CHANGE, REQ_DEADLINE) | partial | Plan available, mill dispatch, receipt variance, stock take due: Part B/C/D. BC sync failure: excluded. |
| r46 Trigger Entity | Trigger Entity (SILO, REQUISITION, FEED_PLAN, STOCK_TAKE) | match | TO_SHIPMENT (r46 F) comes with Part C. |
| r47 Threshold Value | Threshold Value | match | |
| r48 Threshold Reference | Threshold Reference | match | Order: screen shows Reference before Value; workbook Value (47) then Reference (48). |
| r49 Priority Level | Priority Level | match | CRITICAL_FIRST_PRIORITY labelled "Urgent" — workbook says CRITICAL_FIRST_PRIORITY / "first priority"; consider "Critical — first priority" as the dashboard uses. |
| r50 Recipient Role(s) (multi-select Role Master) | Recipient Role(s) — free string list | mismatch | Not a Role Master picker. |
| r51 Delivery Channel (IN_APP, EMAIL, SMS) | Delivery Channel — In app only | partial | Email is Part D. |
| r52 Frequency | Frequency | match | |
| r53 Escalation After Hours | Escalation After Hours | match | |
| r54 Escalation Recipient Role (lookup Role Master) | free text | mismatch | |
| r55 Active | row Active toggle (generic is_active) | match | |
| r56 Farm Filter | Farm Filter (blank = ALL) | match | |

### 6e. Reporting Period Master — Feed Forecast sheet r10 (C10); Silo Balance §3 r33-37
(Settings → Reporting Periods, configs.ts:1507-1530)

| Workbook | Screen | Result | Note |
|---|---|---|---|
| Period Code (FF r10) | Code | match | |
| Start Date | Start Date | match | |
| End Date (month-end Saturday) | End Date | match | |
| Stock Take Date | Stock Take Date (blank = End Date) | match | SB r37. |
| Production Start Date (Sunday after) | Production Start Date (list, derived) | match | SB r49. |
| (ours) | Business Year, Status (draft → activate) | extra | Keep. |
| "imported from D365BC" | not built | match | BC excluded. |
| SB r33-36 Stock Take No./Type/Farm or Mill/Reporting Period | — | not built (Part D) | Monthly stock take. |

### 6f. Feed Planning Settings (ours) — Settings → Inventory Setup → Feed Planning

`components/console/inventory/feed-planning-panel.tsx`. Company row: Safety Stock KG (3 Oct ruling
2), Bag Size KG (Step 8 "bagged rounds to 50"), Bulk Multiple KG (Req r28), Truck Target KG
(Req r27), Production Weekday (Req r35 / Engine r64 cutoff). Farm override row: same five.
Silo table: Silo Code, Name, Linked Shed(s), Feed Type (editable), Feed Item Code, Feed Item Name,
Capacity (KG), Below Feed Level (KG), Above Threshold (KG), Status. No workbook page; each value
traces to a workbook row as noted. Below/Above here duplicate the Location form (two editors for
one value — acceptable, same column).

---

## GAP LIST (prioritised)

| # | Page | Field / item | Change | Workbook / ruling | Effort |
|---|---|---|---|---|---|
| 1 | Feed Requisition tab | New | Skip the chooser: open the feed form directly when `types` is just FEED | 2026-10-04 ruling 1 | S |
| 2 | Feed Forecast | Silo code + silo name | Add Silo Code and Silo Name columns (data already in `sourceCode`; API needs name) | Engine r70; 2026-10-04 ruling 4 | S |
| 3 | Physical Count | Count detail lines | Show silo code, item code and reason text instead of raw IDs (panel:463-469) | Engine r8, r11; SB r44 | S |
| 4 | Feed Forecast Dashboard | Whole page | Add selectors (range/period, house, silo, item, bulk/bagged) and charts above the table; Projected Need over the selected range, split old/next item | Engine r56; 2026-10-04 ruling 3 | L |
| 5 | Feed + common requisition | Edit/open | Open an existing requisition in a dialog (read-only when not editable), both kinds | 2026-10-04 "dialog" ruling | M |
| 6 | Feed Requisition tab | Tab label | "Internal Feed Transfer" → "Feed Requisition" | Req sheet r1/r3; decisions 4 Oct | S |
| 7 | Feed Forecast Dashboard | Requisition Status | Show the status label and make it a link to the requisition | Engine r63 | S |
| 8 | Feed Forecast Dashboard | Farm Total Order This Cycle KG; Current Diet Days Remaining | Add both (sum of recommended vs truck target; days to end of current feed row) | Engine r62, r57 | S |
| 9 | Feed Forecast | Filters | Add House, Batch, Silo, Feed Item, Bulk/Bagged filters | FF sheet r8 C8; Engine r20 | M |
| 10 | Feed Forecast | Output columns | Add Current Silo Item, Rate (KG/head/day), Receipts, Daily Use, Recommended Qty, Delivery Date | Engine r70, r11, Step 8 | M |
| 11 | Feed Forecast | Run history | Show as-of time, posting cutoff, lifecycle config version, author (all already stored) | Engine r68 | S |
| 12 | Physical Count | Entry columns | Add Silo Name, House(s), Current Diet, Capacity, Projected Shortfall, Next Diet Change in X Days, Next Feed Item; rename "System (kg)" → "System Balance KG" | Engine r9-r17; SB r8 | M |
| 13 | Feed Requisition header | Order + labels | Reorder to workbook order (Farm Total, Truck Target, Multiple, Required Date, Supplier, Purpose, Status, Priority, Deadline); label "Farm Total Requested KG"; separate "Bulk Truck Target KG" field | Req r26-r35 | S |
| 14 | Feed Requisition lines | Destination Silo | Decide: separate Destination Silo column (r55) or document that Silo Code = destination; rename "Feed Item No." → "Feed Item No. to Order" | Req r43, r45, r55 | S |
| 15 | Feed Requisition header | Priority | Let the Farm Manager escalate priority while editable | Req r34 E | S |
| 16 | Manual create dialog / list | Labels | Use workbook labels (Silo Code, Feed Item No. to Order, Requested Qty KG, Proposed Delivery Date) | Req r43-r56 | S |
| 17 | Feed Forecast Dashboard | Silo Code | Make clickable (silo detail); add Silo Name; Days Remaining colouring (<3 critical, <7 warning) | Engine r49, r55 D | S |
| 18 | Breed Lifecycle | Effective dates, farm override | Add effective from/to and optional farm on the row; engine to honour them | MS r38 E, r39 E; Engine r24 | L |
| 19 | Breed Lifecycle | Labels + order | Line Code, Stage Code, Calculation Unit, Period From/To, Feed Bulk/Bagged, Feed Item No., Feed Rate KG per Day/Per Animal | MS r32-r39 | S |
| 20 | Alert Rules | Code auto; roles | Auto-number Notification Code; Recipient Role(s) and Escalation Role as Role Master pickers; labels "Notification Code/Name" | MS r43, r44, r50, r54 | M |
| 21 | Location (silo) | Derived read-only fields | Show r13-r20 (last approved count, system balance, first shortage, feed in silo, available stock, last receipt, next diet change) on the silo record view | MS r13-r20 | M |
| 22 | Location (silo) | Code format / mapping dates | FarmCode-HouseCode-SILOx manual code; effective dates on silo-house mapping — ask Rishi first (live codes differ) | MS r5, r8 | M |
| 23 | Item Master | Labels | Form "Code/Name/Primary UOM" → "Item No./Item Description/Base UOM" | MS r24-r27 | S |
| 24 | All feed screens | Dashes | Replace "—" placeholders with real values or blanks | 2026-10-02 ruling 3 | S |

## PAGES

| Page | Where in app | Status |
|---|---|---|
| Feed Forecast | Inventory → Feed Forecast → Forecast tab | partial (5 gaps: #2, 9, 10, 11, 24) |
| Feed Forecast Dashboard | Inventory → Feed Forecast → Dashboard tab | partial (4 gaps: #4, 7, 8, 17) |
| Physical Stock Count | Inventory → Feed Forecast → Physical Count tab | partial (2 gaps: #3, 12) |
| Feed Requisition (farm entry) | Inventory → Feed Forecast → "Internal Feed Transfer" tab | partial (7 gaps: #1, 5, 6, 13, 14, 15, 16) |
| Feed Requisition (hub entry) | Approvals → Requisitions (type Feed) | partial (shares #5, 13, 14, 15) |
| Feed Requisition (inbox) | Approvals → Pending → request detail (read-only document) | done (inherits #13, 14 labels/order) |
| Common requisition (Item/FA/Service) | Approvals → Requisitions | partial (1 gap: #5 dialog) — no workbook spec |
| Location Master — silo | Master Data → Locations (type SILO); Settings → Inventory Setup → Feed Planning | partial (2 gaps: #21, 22) |
| Item Master (feed) | Master Data → Items | partial (1 gap: #23) |
| Breed Lifecycle Stage Config | Master Data → Breeds → Lifecycle Stages tab | partial (2 gaps: #18, 19) |
| Alerts & Notifications Master | Master Data → Alert Rules | partial (1 gap: #20; events/email Part B/C/D) |
| Reporting Period Master | Settings → Reporting Periods | done |
| Feed Planning Settings (ours) | Settings → Inventory Setup → Feed Planning | done (no workbook page) |
| Mill Capacity Master | — | not built (Part B) |
| Mill consolidation sheet | — | not built (Part B) |
| Loading Instruction Sheet | — | not built (Part B) |
| TO receipt (feed) | — | not built (Part C) |
| Tentative / Actual feed plan | — | not built (Part C) |
| Compare report | — | not built (Part B/C) |
| Monthly stock take / period close | — | not built (Part D) |
| Email channel / scheduler | — | not built (Part D) |
