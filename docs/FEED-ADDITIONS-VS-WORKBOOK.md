# What the feed work added to NAVFarm, mapped to Rishi's workbook

Prepared 11 Oct 2026 for Rishi (client owner). Read-only inventory of branch `wave5/wb100` (equal to GitHub main `2beb79e3`). Nothing was run; it is built from the code, `docs/decisions.md` and the final workbook audit.

**Sources.** The workbook `NAVFarm_Feed forecast TDD with examples (1).xlsx` (310 rows over six sheets, plus the Worked Example sheet, which is illustrative figures only and has no fields); Rishi's rulings in `docs/decisions.md`; his own common requisition list of 4 Oct 2026; the final audit `workbook-100-final.md`; the code.

**How to read it.** Row numbers are the workbook's own (`Master r8` = Master Setup row 8; `Req` = Requisition and Loading Sheet; `Silo` = Silo Balance and Stock Take; `Engine` = Feed Forecast Engine; `Principles` = the Feed Forecast sheet). Status words are the final audit's: **DONE**, **PARTIAL**, **N/A**. "Not in the file" means no workbook row asks for it. Where the reason is a ruling, the decisions.md date and title are given. **Unclear** means no workbook row or decision explains it; those are the questions for Rishi.

**Status.** All 299 applicable workbook rows are DONE (the last two, Req r76 and Silo r47, were finished in commits `b8268e8d` and `b8f7b25a` after the 99.3% recount and proven live).

## 1. Pages and tabs

One row per page, tab or dialog added or reshaped for the feed work. A row counts as "in the file" when at least one workbook row is implemented by it.

| # | Menu path in the app | Name | Workbook sheet and rows it implements | If not in the file: reason |
|---|---|---|---|---|
| 1 | Inventory > Feed Forecast | Feed Forecast page (container with 8 tabs) | Feed Forecast r3-r12; Engine title and sections 1-5 | - |
| 2 | Inventory > Feed Forecast > Dashboard | Dashboard tab (Silo dashboard) | Engine r45-r64 (section 4), r67; Silo r8, r9 | - |
| 3 | Inventory > Feed Forecast > Calculation | Calculation tab (farm forecast grid) | Engine r19-r30 (section 2 steps 1-9), r66-r70 (section 5); Worked Example r3-r20 | - |
| 4 | Inventory > Feed Forecast > Calculation | Notes panel under the grid | Engine r22, r23, r24, r26 (flag missing future assumptions, missing or overlapping lifecycle rows, silo that holds a different item) | - |
| 5 | Inventory > Feed Forecast > Calculation | Projected balance explanation dialog (click a date) | Engine r28 (expected versus confirmed receipts), Silo r5-r8, Checkpoints 37 (SYSTEM BALANCE label) | - |
| 6 | Inventory > Feed Forecast > Calculation | Saved run history list | Engine r68 (run date, version, author, filters, cut-off, lifecycle configuration version) | - |
| 7 | Inventory > Feed Forecast > Calculation | Create Feed Requisition from saved calculation (preview and edit dialog) | Engine r30 (Step 9 draft requisition from the run) | - |
| 8 | Inventory > Feed Forecast > Calculation | Delete calculation (archives the saved run; one current saved run per farm) | Not in the file | Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" (items 4 and 5) |
| 9 | Inventory > Feed Forecast > Feed Plan | Feed Plan tab (Tentative versus Actual, retained versions) | Engine r31-r44 (section 3); Checkpoints 36; Feed Forecast r7 | - |
| 10 | Inventory > Feed Forecast > Feed Plan | Feed plan version lines dialog and five-week consumption evidence | Engine r34-r44 | - |
| 11 | Inventory > Feed Forecast > Compare Report | Compare Report tab (diet demand versus mill capacity) | Checkpoints 34, 35; Engine r42, r43; Feed Forecast r11 (the file names this report but has no field table for it) | - |
| 12 | Inventory > Feed Forecast > Requisition | Feed Requisition list | Req r5-r10, r26, r29, r33-r35 (list columns); Engine r63 (status link) | - |
| 13 | Inventory > Feed Forecast > Requisition | New Feed Requisition dialog | Req r3-r56 (sections 1 and 2) | - |
| 14 | Inventory > Feed Forecast > Requisition | Feed requisition document dialog (view, edit, submit, approve or reject) | Req r5-r56, r78-r83 (sections 1, 2 and 4); Checkpoints 16-19, 22, 23 | - |
| 15 | Inventory > Feed Forecast > Requisition | Transfer Receipt panel inside the requisition dialog | Req r132-r150 (section 6), r152-r155 (section 7); Silo r11-r29 (TO receipt); Checkpoints 26, 27, 44-46 | - |
| 16 | Inventory > Feed Forecast > Requisition | Release and Transfer Shipment panels inside the requisition dialog | Not in the file | Workbook has Business Central create and ship the Transfer Order; decisions 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" (in-house only) and 2026-10-08 "Feed requisitions continue through in-house transfer fulfilment" make NAVFarm release and ship it |
| 17 | Inventory > Feed Forecast > Mill Consolidation | Mill Consolidation tab (sheet list and sheet view) | Req r112-r130 (section 5); Checkpoints 41, 42 | - |
| 18 | Inventory > Feed Forecast > Mill Consolidation | Create consolidation dialog (pick approved requisitions) | Req r113, r115-r127; Checkpoints 41, 42, 34 | - |
| 19 | Inventory > Feed Forecast > Loading Instructions | Loading Instructions tab (loading sheets) | Req r57-r77 (section 3); Checkpoints 24, 25 | - |
| 20 | Inventory > Feed Forecast > Physical Stock Count | Physical Stock Count tab (weekly count and monthly stock take list) | Engine r3-r18 (section 1); Silo r30-r49 (section 3); Checkpoints 31-33, 40 | - |
| 21 | Inventory > Feed Forecast > Physical Stock Count | New count dialog (count entry per silo, approval, post) | Engine r6-r18; Silo r33-r49 | - |
| 22 | Old links /inventory/feed-requisitions, /feed-loading, /feed-consolidations, /feed-alerts | Redirects to the Feed Forecast tabs and to Alerts | Not in the file | Supporting screen: keeps bookmarks working after the tabs moved (decisions 2026-10-04 "Page and tab names follow the workbook": routes and tab keys unchanged) |
| 23 | Requisition | Requisition list (Item, Fixed Asset, Service; filters, Waiting for my approval) | Not in the file | Rishi's common requisition list (2026-10-04 "Common requisition field and button list"); own menu item per 2026-10-05 "Requisition is its own menu item, common kinds only; FA/Service lines are Description + Qty" and 2026-10-05 "One requisition document; approval is its decision workflow" |
| 24 | Requisition | New requisition dialog (type and purpose picker, then document) | Not in the file | Rishi's common requisition list; created in a dialog per 2026-10-04 "Requisitions are created and edited in a dialog" |
| 25 | Requisition | Common requisition document (Release, Link PO, Reopen, Transfer Shipment, Transfer Receipt, Direct Transfer) | Not in the file | Rishi's common requisition list; flow per 2026-10-08 "Final common requisition field and workflow contract" |
| 26 | Requisition | Item Tracking dialog (lot or serial per line) | Not in the file | Rishi's common requisition list ("Item tracking button"); who assigns it after release: 2026-10-05 "Item Tracking after release, and four readings of Rishi's list" |
| 27 | Approvals > Pending / Approved / Rejected | Requisition rows and read-only requisition detail | Not in the file | Decision 2026-10-07 "Common requisitions in Approvals and scoped admin self-approval": a common requisition must be approvable from both Requisition and Approvals |
| 28 | Inventory > Transfers | Transfer Orders list and view (shows the requisition and consolidation behind each transfer) | Checkpoints 43; Silo r15 (Transfer Order No.); Req r130 (transfer per farm) | - |
| 29 | Batches > Data Entry | Empty bags entry on the daily feed line | Checkpoints 28 (bag reconciliation on POST Day) | - |
| 30 | Alerts | Alerts page (Feed type filter, farm filter, open or all) | Master r51 and Checkpoints 38 (in-app channel); Checkpoints 10-13 | - |
| 31 | Master Data > Alert Rules | Alert Rules master | Master r43-r56 (section 4) | - |
| 32 | Master Data > Locations | Silo form (Attached Sheds with dates, thresholds, read-only silo facts) | Master r5-r20 (section 1) | - |
| 33 | Master Data > Locations | MILL and BIN forms (capacity in TON, Parent Mill, Feed Type) | The file names a Mill Capacity Master (Req r32, r67, r122, r125; Checkpoints 6, 34, 35, 42) but gives no field table; fields chosen by decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" | - |
| 34 | Master Data > Locations | Farm and Mill forms: Cost Centre field | Silo r47 and Feed Forecast r3 ("Farm Cost Centre") | - |
| 35 | Master Data > Items | Item form: Diet No. | Named by the file at Req r67 and r121 ("via Diet No."), no row of its own; Master r24-r27 (item fields) | - |
| 36 | Master Data > Breed Lifecycle Stages | Lifecycle feed rows (feed item, rate, form, dates, farm override) | Master r32-r39 (section 3) | - |
| 37 | Master Data > Reporting Periods | Reporting Periods master (generate, activate, close, reopen) | Silo r36, r37, r49; Checkpoints 31, 32, 40 (the file names a Reporting Period Master, no field table) | - |
| 38 | Master Data > Production Slots | Production Slots master | Not in the file | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" (slots are controlled master data, not free text) and 2026-10-08 "Mill BIN release setup stays in the shared master framework" |
| 39 | Master Data > BIN Diet Assignments | BIN Diet Assignments master | Checkpoints 6, 35; Req r32, r67 (the file wants a loading bin per diet and slot, no field table) | - |
| 40 | Master Data > Reasons | Reason Master used by feed (variance and exception reasons) | Not in the file | Decisions 2026-10-01 "Feed integration, common requisition controls and farm personas" (stock variance uses the Reason Master) and 2026-10-07 "Requisition form contract and feed-line Reason Master" (feed-line Reason) |
| 41 | Master Data > Cost Centers | Department type cost centres used for department checks | Not in the file | Rishi's common requisition list ("User Setup defines department", location dimension) and 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| 42 | Master Data > Location Types | MILL and BIN location types | Not in the file | Supporting screen: makes MILL and BIN selectable, decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" |
| 43 | Company Settings > Feed | Feed Planning Settings (forecast days, schedule, truck target, bulk multiple, thresholds) | Engine r69; Feed Forecast r8; Req r27, r28, r35; Checkpoints 15, 20, 22, 28, 36 | - |
| 44 | Company Settings > Feed | Farm order quantity overrides (truck target, bulk multiple per farm) | Not in the file | Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" (item 2); farm override of schedule per 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| 45 | Company Settings > Feed | Silo Feed Setup (silos by farm: feed type, feed item, capacity) | Not in the file | Decision 2026-09-30 "Stage parity, company-owned Number Series and Silo Feed Setup". 2026-10-01 "Feed integration, common requisition controls and farm personas" says it is removed once the Silo record has parity, but the screen is still present: Unclear whether Rishi still wants it |
| 46 | Team > member dialog | User Setup: Department and Direct Transfer right | Not in the file | Rishi's common requisition list ("Requester Department (auto from User Setup)", "Direct Transfer ... needs right in User Setup") |

Pages counted: 46 (31 in the file, 15 not in the file).

## 2. Fields

### 2.1 Every workbook field, by page

Each workbook row appears once, under the page where the user sees it. Status is from the final audit. Rows the workbook lists for a sheet's rules (Principles and Checkpoints) are in Section 3.

**Master Data > Locations (Silo form)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Master r5 | Location Code | Code | DONE |  |
| Master r6 | Location name | Name | DONE |  |
| Master r7 | Location Level | Location Type = SILO (Hierarchy Level) | DONE |  |
| Master r8 | House Code and silo house mapping | Attached Sheds, with From and To dates per shed | DONE |  |
| Master r9 | Silo Capacity KG | Silo Capacity (+ Silo Capacity UOM, KG or TON) | DONE |  |
| Master r10 | Below Feed Level KG | Below Feed Level KG | DONE |  |
| Master r12 | Above Threshold KG | Above Threshold KG | DONE |  |
| Master r13 | Last Approved Physical Count (KG) | Last Approved Physical Count KG and Date (read-only) | DONE |  |
| Master r14 | System Balance KG | System Balance KG (read-only) | DONE |  |
| Master r15 | Days to First Shortage | First Shortage Date (read-only) | DONE |  |
| Master r16 | Feed in Silo | Feed in Silo (read-only, opens the item) | DONE |  |
| Master r17 | Available stock | Available Stock KG (read-only) | DONE |  |
| Master r18 | Blocked | Active / Blocked status switch | DONE |  |
| Master r19 | Last Feed Receipt Date | Last Feed Receipt Date (read-only) | DONE |  |
| Master r20 | Next Diet Change Date | Next Diet Change Date (read-only) | DONE |  |

**Feed Forecast > Physical Stock Count (Counted at)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Master r11 | Physical Count Date Time | Counted at (date and time of the count) | DONE |  |

**Master Data > Items**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Master r24 | Item No. | Item No. | DONE |  |
| Master r25 | Item Description | Description | DONE |  |
| Master r26 | Item Type | Item Type | DONE |  |
| Master r27 | Base UOM | Base UOM | DONE |  |
| Master r28 | Sync to NAVFarm | (not shown) | N/A | Business Central sync; the feed pipeline is built in-house (decisions 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline") |

**Master Data > Breed Lifecycle Stages**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Master r32 | Line Code | Breed (the line) | DONE |  |
| Master r33 | Stage Code | Stage | DONE |  |
| Master r34 | Calculation Unit | Period Unit | DONE |  |
| Master r35 | Period From | Period From | DONE |  |
| Master r36 | Period To | Period To | DONE |  |
| Master r37 | Feed bulk / bagged | Feed Form (Bulk or Bagged) | DONE |  |
| Master r38 | Feed Item No. | Feed (item), with Effective From and To | DONE |  |
| Master r39 | Feed Rate KG per Day / Per Animal | Daily Feed per Head (kg), with Farm (override) | DONE |  |

**Master Data > Alert Rules**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Master r43 | Notification Code | Code | DONE |  |
| Master r44 | Notification Name | Name | DONE |  |
| Master r45 | Event Type | Event Type | DONE |  |
| Master r46 | Trigger Entity | Trigger Entity | DONE |  |
| Master r47 | Threshold Value | Threshold Value | DONE |  |
| Master r48 | Threshold Reference | Threshold Reference | DONE |  |
| Master r49 | Priority Level | Priority Level | DONE |  |
| Master r50 | Recipient Role(s) | Recipient Role(s) | DONE |  |
| Master r51 | Delivery Channel | Delivery Channel (IN_APP only for now) | DONE |  |
| Master r52 | Frequency | Frequency | DONE |  |
| Master r53 | Escalation After Hours | Escalation After Hours | DONE |  |
| Master r54 | Escalation Recipient Role | Escalation Recipient Role | DONE |  |
| Master r55 | Active | Active switch | DONE |  |
| Master r56 | Farm Filter | Farm Filter | DONE |  |

**Feed Forecast > Physical Stock Count (new count dialog and list)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Engine r6 | Farm Code | Farm | DONE |  |
| Engine r7 | Farm Name | Farm | DONE |  |
| Engine r8 | Silo Code | Silo | DONE |  |
| Engine r9 | Silo Name | Silo Name | DONE |  |
| Engine r10 | House Shed(s) Linked | Shed(s) | DONE |  |
| Engine r11 | Silo Feed Item No. | Feed Item No. | DONE |  |
| Engine r12 | Current Diet Description | Current Diet Description | DONE |  |
| Engine r13 | Silo Capacity KG | Silo Capacity KG | DONE |  |
| Engine r14 | Current Balance Stock (KG) | System Balance KG | DONE |  |
| Engine r15 | Projected Shortfall (KG) | Projected Shortfall KG | DONE |  |
| Engine r16 | Next Diet Change in X Days | Next Diet Change In (warns at 7 days or fewer) | DONE |  |
| Engine r17 | Next Feed Item when change falls within selected forecast range | Next Feed Item | DONE |  |
| Engine r18 | Save Count and Submit Variance | Save draft, Submit for approval, Post to stock | DONE |  |

**Feed Forecast > Calculation**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Engine r22 | Step 1 Get active and expected batches | Notes: Head counts, Expected stage changes | DONE |  |
| Engine r23 | Step 2 Project head count | Head Count column, Notes: Head counts stay at the last posted count | DONE |  |
| Engine r24 | Step 3 Select feed by lifecycle date | Required Feed Item and KG/head/day Rate columns; Notes: days with no or two feed rates | DONE |  |
| Engine r25 | Step 4 Calculate daily demand | Daily Use KG | DONE |  |
| Engine r26 | Step 5 Determine next diet | Required Feed Item versus Current Silo Item; Notes: No silo holds the diet | DONE |  |
| Engine r27 | Step 6 Build dated forecast | Daily, Weekly, Reporting Period and Custom views; date columns | DONE |  |
| Engine r28 | Step 7 Project item stock and shortage | Opening System Balance, Confirmed Receipts, Open Transfer, Planned Feed Added, Projected Closing Balance per date, First Shortage Date | DONE |  |
| Engine r29 | Step 8 Recommend refill | Recommended Quantity KG, Delivery Date | DONE |  |
| Engine r30 | Step 9 Draft requisition | Create Feed Requisition from saved calculation | DONE |  |
| Engine r67 | View and Period | View, Planning Date, Date To, Reporting Period (also on the Dashboard) | DONE |  |
| Engine r68 | Run Date and Version | Run history list (Save Run) | DONE |  |
| Engine r69 | Scheduled Planning | Calculate on any dates here; schedule is set in Company Settings > Feed and run by the scheduler | DONE |  |
| Engine r70 | Output Detail | Grid columns listed in the row (+ extras below) | DONE |  |

**Feed Forecast > Feed Plan**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Engine r34 | Plan Code | Plan Code (PLAN-farm-YYYYWW-Rnn) | DONE |  |
| Engine r35 | Plan Type | Plan Type (Tentative or Actual) | DONE |  |
| Engine r36 | Farm Code | Farm Code | DONE |  |
| Engine r37 | Plan Week YYWW | Plan Week | DONE |  |
| Engine r38 | Feed Item No. | Feed Item No. | DONE |  |
| Engine r39 | Tentative Quantity KG | Tentative KG | DONE |  |
| Engine r40 | Actual Requested Quantity KG | Requested KG | DONE |  |
| Engine r41 | Variance Actual vs Tentative | Variance KG | DONE |  |
| Engine r42 | Mill Capacity Available KG | Mill Capacity Available KG | DONE |  |
| Engine r43 | Plan vs Mill Capacity | Plan vs Mill Capacity (in the version lines) | DONE |  |
| Engine r44 | 5-Week History Rolling Dataset | Five-week consumption evidence table | DONE |  |

**Feed Forecast > Dashboard**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Engine r47 | Farm | Farm | DONE |  |
| Engine r48 | House Shed | Shed | DONE |  |
| Engine r49 | Silo Code | Silo | DONE |  |
| Engine r50 | Current Diet Feed Item | Current Diet Feed Item | DONE |  |
| Engine r51 | Mill Loading Bin No. | Mill Loading Bin No. | DONE |  |
| Engine r52 | Silo Capacity KG | Silo Capacity KG | DONE |  |
| Engine r53 | System Balance KG | System Balance KG | DONE |  |
| Engine r54 | Daily Requirement KG | Daily Requirement KG | DONE |  |
| Engine r55 | Days of Feed Remaining | Days of Feed Remaining (one decimal) with First Shortage Date | DONE |  |
| Engine r56 | Projected Need for Selected Range KG | Projected Need for Selected Range KG | DONE |  |
| Engine r57 | Current Diet Days Remaining | Current Diet Days Remaining | DONE |  |
| Engine r58 | Next Diet Feed Item | Next Diet Feed Item | DONE |  |
| Engine r59 | Silo Available for Next Diet Feed Type | Silo Available for Next Diet Feed Type | DONE |  |
| Engine r60 | Projected Shortfall KG | Projected Shortfall KG | DONE |  |
| Engine r61 | Recommended Order Qty KG | Recommended Order Qty KG | DONE |  |
| Engine r62 | Farm Total Order This Cycle KG | Farm Total Order This Cycle KG | DONE |  |
| Engine r63 | Requisition Status | Requisition Status (opens the requisition) | DONE |  |
| Engine r64 | Submission Deadline | Submission Deadline | DONE |  |

**Feed Forecast > Requisition (document header)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r5 | Requisition No. | Requisition No. | DONE |  |
| Req r6 | Requisition Date | Requisition Date | DONE |  |
| Req r7 | Requisition Type | Requisition Type (Item) | DONE |  |
| Req r8 | Source | Source | DONE |  |
| Req r9 | Farm Code | Farm Code | DONE |  |
| Req r10 | Farm Name | Farm Name | DONE |  |
| Req r11 | Silo Code | (not shown) | N/A | Header Silo Code removed: one header holds many lines, each with its own Destination Silo (2026-10-07 "Feed requisition Type, Source and document boundary") |
| Req r12 | Current Silo Feed Item No. | (not shown) | N/A | Removed; the line Destination Silo is the one silo column (2026-10-07 "Feed requisition Type, Source and document boundary", item 6) |
| Req r13 | Feed Item No. to Order | Feed Item No. (per line) | DONE |  |
| Req r14 | Feed Item Description | Feed Item Description (per line) | DONE |  |
| Req r15 | Feed Type | Feed Type (per line) | DONE |  |
| Req r16 | Is Next Diet Requisition | Is Next Diet Requisition | DONE |  |
| Req r17 | Breed Lifecycle Row Reference | Breed Lifecycle Row (per line) | DONE |  |
| Req r18 | System Balance at Draft KG | System Balance KG (per line) | DONE |  |
| Req r19 | Daily Requirement KG | Daily Requirement KG (per line) | DONE |  |
| Req r20 | Days Remaining at Draft | Days Remaining / First Shortage Date (per line) | DONE |  |
| Req r21 | Days Before Diet Change | Days Before Diet Change (per line) | DONE |  |
| Req r22 | Recommended Qty KG | Recommended Qty KG (per line) | DONE |  |
| Req r23 | Bag Count | Bag Count (per line) | DONE |  |
| Req r24 | Requested Qty KG | Requested Qty KG (per line) | DONE |  |
| Req r25 | Requested Qty Bags | Bag Count (requested, bagged feed) | DONE |  |
| Req r26 | Farm Total Requested KG | Farm Total Requested KG | DONE |  |
| Req r27 | Bulk Truck Target KG | Bulk Truck Target KG (with truck trips) | DONE |  |
| Req r28 | Bulk Order Multiple | Bulk Order Multiple | DONE |  |
| Req r29 | Required Delivery Date | Required Delivery Date | DONE |  |
| Req r30 | Supplier or Source | Supplier or Source | DONE |  |
| Req r31 | Requisition Purpose | Requisition Purpose | DONE |  |
| Req r32 | Mill Loading Bin No. | Mill Loading Bin No. (per line) | DONE |  |
| Req r33 | Status | Status | DONE |  |
| Req r34 | Priority | Priority (Farm Manager can escalate) | DONE |  |
| Req r35 | Submission Deadline | Submission Deadline | DONE |  |
| Req r36 | Remarks | Remarks | DONE |  |
| Req r37 | Approved By | Approved By | DONE |  |
| Req r38 | Approval Date Time | Approval Date Time | DONE |  |
| Req r39 | Linked Transfer Order No. | Linked Transfer Order No. (all transfers listed) | DONE |  |

**Feed Forecast > Requisition (document lines)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r42 | Line No. | Line No. | DONE |  |
| Req r43 | Silo Code | Silo Code | DONE |  |
| Req r44 | Current Silo Feed Item No. | (not shown) | N/A | Removed; the workbook itself marks it REMOVED, Destination Silo is the one silo column (2026-10-07 "Feed requisition Type, Source and document boundary") |
| Req r45 | Feed Item No. to Order | Feed Item No. | DONE |  |
| Req r46 | Feed Type | Feed Type | DONE |  |
| Req r47 | Is Next Diet Line | Is Next Diet Line | DONE |  |
| Req r48 | Days Before Diet Change | Days Before Diet Change | DONE |  |
| Req r49 | System Balance KG | System Balance KG | DONE |  |
| Req r50 | Daily Requirement KG | Daily Requirement KG | DONE |  |
| Req r51 | Days Remaining | Days Remaining / First Shortage Date | DONE |  |
| Req r52 | Recommended Qty KG | Recommended Qty KG | DONE |  |
| Req r53 | Requested Qty KG | Requested Qty KG | DONE |  |
| Req r54 | Bag Count | Bag Count | DONE |  |
| Req r55 | Destination Silo | Silo Code (Destination Silo) | DONE |  |
| Req r56 | Proposed Delivery Date | Proposed Delivery Date | DONE |  |

**Feed Forecast > Loading Instructions**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r60 | Loading Sheet No. | Loading sheet (LOAD-ReqNo-LineNo) | DONE |  |
| Req r61 | Requisition No. | Requisition | DONE |  |
| Req r62 | Farm Code | Farm / destination | DONE |  |
| Req r63 | Farm Name | Farm / destination | DONE |  |
| Req r64 | Delivery Date | Delivery date | DONE |  |
| Req r65 | Feed Item No. Diet | Feed item / loading BIN (with Diet N) | DONE |  |
| Req r66 | Feed Item Description | Feed item / loading BIN | DONE |  |
| Req r67 | Mill Loading Bin No. | Feed item / loading BIN | DONE |  |
| Req r68 | Silo Code at Farm | Farm / destination | DONE |  |
| Req r69 | KG Ordered | Requested KG and Mill-approved KG | DONE |  |
| Req r70 | Compartment No. | Compartment | DONE |  |
| Req r71 | KG Loaded | KG loaded | DONE |  |
| Req r72 | Loaded By | Loaded by | DONE |  |
| Req r73 | Loading Date Time | Loading date time | DONE |  |
| Req r74 | Dispatch action | Dispatch button | DONE |  |
| Req r75 | NAVFarm Notification Status | Dispatch Notification (Sent or Not sent, with time) | DONE |  |
| Req r76 | Notification Content | Dispatch Notification text, Estimated Arrival | DONE | Audit: PARTIAL. The text carries farm, diet, KG and compartment and shows on the loading sheet; the route-based arrival estimate needs a Vehicle Management module that does not exist. After the audit, commit b8268e8d added a typed Estimated arrival the mill enters at dispatch (Rishi, 11 Oct). Not yet recounted. |
| Req r77 | Status | Status | DONE |  |

**Approval steps (requisition document, scheduler, alerts)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r80 | 1 - Auto-draft | Auto-draft; AUTO-DRAFTED alert to Farm Manager | DONE |  |
| Req r81 | 2 - Diet change | Next-diet line in the same requisition | DONE |  |
| Req r82 | 3 - Farm Manager reviews | Farm Manager edits the document | DONE |  |
| Req r83 | 4 - Approve | Approve button (remarks over 20 percent) | DONE |  |
| Req r84 | 5 - Friday notification | REQ-REMINDER alert (scheduler) | DONE |  |
| Req r85 | 6 - Saturday notification | REQ-OVERDUE alert (scheduler) | DONE |  |
| Req r86 | 7 - Feed Mill Manager Consolidation | Mill Consolidation tab | DONE |  |
| Req r87 | 8 - Mill approves and pushes to BC | (not shown) | N/A | Push to Business Central; in-house only (2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline") |
| Req r88 | 9 - Mill loads and dispatches | Loading Instructions: Save and Dispatch | DONE |  |
| Req r89 | 10 - Farm posts TO receipt | Transfer Receipt panel | DONE |  |

**Feed Forecast > Mill Consolidation**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r115 | Consolidation Sheet No. | Consolidation No. (CONS-YYYYWW-NNN) | DONE |  |
| Req r116 | Production Week | Production week | DONE |  |
| Req r117 | Consolidation Date | Date | DONE |  |
| Req r118 | Feed Mill Manager | Feed Mill Manager | DONE |  |
| Req r119 | Farm Code | Farm | DONE |  |
| Req r120 | Diet Feed Item No. | Feed item | DONE |  |
| Req r121 | Diet No. | Diet N | DONE |  |
| Req r122 | Mill Loading Bin No. | Mill loading BIN | DONE |  |
| Req r123 | Farm Requested Qty KG | Requested KG | DONE |  |
| Req r124 | Total All Farms KG (this diet) | Total all farms KG (diet) | DONE |  |
| Req r125 | Mill Capacity Available KG | Mill capacity available KG | DONE |  |
| Req r126 | Mill Approved Qty KG | Approved KG | DONE |  |
| Req r127 | Adjustment Reason | Adjustment reason | DONE |  |
| Req r128 | Consolidation Status | Status (Draft, Reviewed, Consolidated) | DONE |  |
| Req r129 | Push Approved Plan to BC | (not shown) | N/A | Push to Business Central; in-house only (2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline") |
| Req r130 | BC Transfer Order No. (per farm) | Transfer order (per line) | DONE |  |

**Feed Forecast > Requisition (Transfer Receipt panel)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r135 | TO Receipt No. | Receipt (number shown after posting) | DONE |  |
| Req r136 | Requisition Slip No. | Requisition | DONE |  |
| Req r137 | Farm Code | Farm | DONE |  |
| Req r138 | Destination Silo | Destination silo | DONE |  |
| Req r139 | Feed Item No. | Item | DONE |  |
| Req r140 | Feed Item Description | Item description | DONE |  |
| Req r141 | Feed Type | Feed type | DONE |  |
| Req r142 | Farm Requested Qty KG | Requested KG | DONE |  |
| Req r143 | BC Shipped Qty KG | Shipped KG | DONE |  |
| Req r144 | Received Qty This Posting KG | Receive now (KG) | DONE |  |
| Req r145 | Variance Shipped vs Received KG | Variance KG | DONE |  |
| Req r146 | Variance Reason | Variance reason | DONE |  |
| Req r147 | Bag Count Received | Bag count | DONE |  |
| Req r148 | Compartment No. Received From | Compartment | DONE |  |
| Req r149 | Post Feed TO Receipt | Post receipt button | DONE |  |
| Req r150 | Silo Balance After Receipt KG | Silo balance after receipt (result line) | DONE |  |

**Feed Forecast > Requisition (line columns)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Req r153 | Mill Approved Qty KG | Mill Approved KG | DONE |  |
| Req r154 | Previously Received Qty KG | Previously received KG | DONE |  |
| Req r155 | Outstanding Shipped Qty KG | Outstanding KG | DONE |  |
| Req r156 | BC TO Shipment Line ID | (not shown) | N/A | Business Central shipment line id; in-house shipment lines carry their own ids (2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline") |
| Req r157 | Receipt Posting Status | (not shown) | N/A | Business Central posting status; in-house only (2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline") |

**Dashboard, Calculation grid, ledger (balance formula)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Silo r5 | Opening Approved Stock KG | Opening System Balance (approved count posts as adjustment) | DONE |  |
| Silo r6 | Plus TO Receipt Received Qty KG | Confirmed Receipts KG | DONE |  |
| Silo r7 | Minus POST Day Consumed KG | POST Day consumption (Daily Data Entry) | DONE |  |
| Silo r8 | Equals System Balance KG | System Balance KG (label) | DONE |  |
| Silo r9 | Days of Feed Remaining | Days of Feed Remaining (one decimal) | DONE |  |
| Silo r10 | Above Threshold Check | FEED-ABOVE alert on receipt and adjustment | DONE |  |

**Feed Forecast > Requisition (Transfer Receipt panel, TO receipt block)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Silo r13 | TO Receipt No. | Receipt number | DONE |  |
| Silo r14 | Receipt Date | Posting date | DONE |  |
| Silo r15 | Transfer Order No. (BC) | Transfer (opens the transfer) | DONE |  |
| Silo r16 | Source | Source (MILL) | DONE |  |
| Silo r17 | Delivery Note No. | Delivery note no. (optional) | DONE |  |
| Silo r18 | Loading Sheet No. | Loading sheet (opens it) | DONE |  |
| Silo r19 | Farm Code | Farm | DONE |  |
| Silo r20 | Feed Item No. | Item (opens it) | DONE |  |
| Silo r21 | Destination Silo | Destination silo | DONE |  |
| Silo r22 | Feed Type | Feed type | DONE |  |
| Silo r23 | Requested Qty KG | Requested KG (read-only) | DONE |  |
| Silo r24 | Bag Count Received | Bag count | DONE |  |
| Silo r25 | Shipped Qty KG | Shipped KG | DONE |  |
| Silo r26 | Received Qty KG | Receive now (KG) | DONE |  |
| Silo r27 | Variance Shipped vs Received KG | Variance KG | DONE |  |
| Silo r28 | Bag Count Received (if BAGGED) | Bag count | DONE |  |
| Silo r29 | Post Receipt | Post receipt button | DONE |  |

**Feed Forecast > Physical Stock Count (monthly stock take)**

| Sheet and row | Workbook field | Shown in the app as | Status | Note |
|---|---|---|---|---|
| Silo r33 | Stock Take No. | Count (number) | DONE |  |
| Silo r34 | Stock Take Type | Count Type (Weekly Physical Count or Monthly Stock Take) | DONE |  |
| Silo r35 | Farm Code or Mill Code | Farm Code or Mill Code | DONE |  |
| Silo r36 | Reporting Period | Reporting Period | DONE |  |
| Silo r37 | Stock Take Date | Stock Take Date | DONE |  |
| Silo r38 | Silo Code or Location | Silo (all active silos of the farm, or bins of the mill) | DONE |  |
| Silo r39 | Physical Feed Item in Silo | Feed Item No. | DONE |  |
| Silo r40 | System Balance KG at Stock Take Date | System Balance KG | DONE |  |
| Silo r41 | Physical Count KG | Counted (kg) | DONE |  |
| Silo r42 | Variance KG | Variance (kg) | DONE |  |
| Silo r43 | Variance Percent | Variance (%) | DONE |  |
| Silo r44 | Variance Reason | Reason | DONE |  |
| Silo r45 | Adjustment Type | Adjustment Type | DONE |  |
| Silo r46 | Post Approved Stock Adjustment | Post to stock button | DONE |  |
| Silo r47 | D365BC GL Entry | GL Entry Reference (opens the journal entry), Cost Centre | DONE | Audit: PARTIAL (the link opened the journal list, not one entry; cost centre not shown). After the audit, commit b8f7b25a made each journal reference open the exact entry and shows the farm/mill cost centre. Not yet recounted. |
| Silo r48 | Period Status After Reconciliation | Period Status After Reconciliation | DONE |  |
| Silo r49 | Production Start Date Next Period | Production Start Date Next Period | DONE |  |

Field rows listed above: 253 (DONE 243, PARTIAL 2, N/A 8).

### 2.2 Extra fields shown that are not workbook rows

Kind: **Decision** = a ruling by Rishi in decisions.md; **Rishi's list** = his 4 Oct common requisition list; **Supporting/System** = needed to make a screen work or an audit/system column; **Unclear** = no row and no decision found; **Named only** = the file mentions it but gives no row of its own (not counted as extra).

**Rishi's common requisition list (34 items, a separate source from the workbook; all DONE per the final audit)**

| Group | Items | Reason |
|---|---|---|
| Header (14) | Requisition No. (number series), Requisition Date, Main / Farm Location, Requester User ID, Requester Name, Requester Department, Sender Department, Requisition Type (Item / Fixed Asset / Service), Status (Open / Released), Purpose (Store / Purchase), From Sub-Location, To Sub-Location, Direct Transfer, Remarks | Not in the file. Rishi's list; 2026-10-04 "Common requisition field and button list" |
| Lines (13) | Line No., Item No., Item Description, Fixed Asset or Service Description, Qty, From Location, To Location, Qty to Ship, Qty Shipped, Qty to Receive, Qty Received, Remaining to Receive, Balance to Ship | Not in the file. Rishi's list; always shown, with "Not applicable" where a field does not apply (2026-10-07 "Stable visible schema for every common requisition") |
| Buttons (4) | Release, Transfer Shipment, Transfer Receipt, Item Tracking | Not in the file. Rishi's list; 2026-10-08 "Final common requisition field and workflow contract" |
| Validations (3) | Location dimension, user department, Item Ledger and Value Entry on shipment and receipt | Not in the file. Rishi's list; posted once through the shared transfer path (2026-10-08 "Final common requisition field and workflow contract") |

**Master Data > Locations (Silo)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Silo Capacity UOM (KG or TON) | Decision | Decision 2026-09-24 "A silo hangs off the farm, feeds many sheds, and holds real stock": capacity is typed in KG or TON and stored in KG. |
| Refill Lead Time (days) | Decision | Existed before 25 Sep; kept by 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" item 6 (the forecast no longer uses it). |
| Storage Location | Supporting/System | Pre-existing location field; not touched by the feed work. |
| Downtime Days Required | Supporting/System | Pre-existing location field; not touched by the feed work. |

**Master Data > Locations (MILL form)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Mill Code, Mill Name (generated code) | Decision | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" (approved minimum field set). |
| Daily Capacity TON, Hourly Capacity TON, Bulk Daily Allocation TON, Bagged Daily Allocation TON | Decision | Same decision. The file names a Mill Capacity Master (Req r32, r67, r122, r125; Checkpoints 34, 35, 42) but gives no field list; bulk plus bagged may not exceed daily capacity. |

**Master Data > Locations (BIN form)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Bin Code, Bin Name, Parent Mill, Bin Capacity TON, Feed Type (Bulk or Bagged) | Decision | Same decision; each BIN is also the stock location of produced feed. |

**Master Data > Production Slots**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Code, Name, Start Time, End Time, Status | Decision | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope": slots are controlled master data (may cross midnight); 2026-10-08 "Mill BIN release setup stays in the shared master framework". |

**Master Data > BIN Diet Assignments**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| BIN, Feed Item No., Feed Item Description, Production Date, Production Slot, Diet Priority, Status | Decision | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" (assignment by date and slot); 2026-10-08 "Mill BIN release setup stays in the shared master framework". The file only requires one diet per bin at a time (Checkpoints 6, 35). |

**Master Data > Reporting Periods**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Business Year | Supporting/System | Supporting: groups the July to June periods (Checkpoints 40 says July to June year). |
| Status (Draft or Active) | Decision | Decision 2026-10-01 "Feed integration, common requisition controls and farm personas": generated July-June periods stay inactive drafts until an administrator activates them. |
| Generate July-June periods button | Decision | Decision 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" Q9 (nothing is seeded; End = last Saturday of the month). |
| Reopen Period action (and reopen reason) | Unclear | No decision found; supporting action beside Close Period (Checkpoints 31, 32). Needs Rishi to confirm. |

**Master Data > Items**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Diet No. | Named only | Named in the file (Req r67, r121 "via Diet No.", "From Item Master") but with no row of its own. |

**Master Data > Breed Lifecycle Stages**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Feed Wastage (%) | Decision | Existed before 25 Sep; kept by 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" item 6 (the forecast no longer uses it). |

**Master Data > Alert Rules**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Trigger Entities LOADING_SHEET, CONSOLIDATION, RECEIPT, BATCH (the file lists SILO, REQUISITION, FEED_PLAN, STOCK_TAKE) | Supporting/System | Needed by the dispatch, mill-adjusted, receipt-variance and no-next-feed-row alerts the file does ask for (Req r74-r76, r126; Checkpoints 8, 26). |
| Company (read-only scope) | Supporting/System | System field (tenant and company scope). |

**Master Data (all feed masters)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Created At, Updated At, Created By, Tenant, Company scope | Supporting/System | System fields (audit and scope). |

**Master Data > Locations (Farm and Mill)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Cost Centre | Named only | Named by the file ("Farm Cost Centre", Feed Forecast r3 and Silo r47); field itself decided in 2026-10-11 "Each farm has its own cost centre". |

**Feed Forecast > Dashboard**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Planning Date | Decision | Decisions 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" (the report runs from a planning date) and 2026-10-05 "Feed Forecast display and interaction correction". |
| Shed and Silo selectors (Farm > Shed > Silo picked in order) | Decision | Decision 2026-10-05 "Feed Forecast display and interaction correction" (hierarchical selection; first valid child chosen automatically). |
| Status chip on the silo (Critical under 3 days, Warning under 7 days, 7 days or more) | Unclear | No decision found; a display aid on Days of Feed Remaining (Engine r55). Needs Rishi to confirm. |
| Chart: Projected closing balance (with Below Feed Level, Above Threshold, Capacity and Run-down lines) | Decision | Decisions 2026-10-04 "Feed screens follow the workbook field for field; a real dashboard" item 3 and 2026-10-05 "Feed Forecast display and interaction correction" (approved layout). |
| Chart: Current and next diet demand | Decision | Same decisions. |
| Chart data tables ("Projected balance data", "Diet demand data") | Supporting/System | Supporting: text equivalent of each chart. |
| Field / Value detail table "Silo dashboard" | Decision | Decision 2026-10-05 "Feed Forecast display and interaction correction" (the detailed table stays beneath the cards). |

**Feed Forecast > Calculation**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Calculate, Save Run, Delete calculation, Create from saved calculation, View requisition buttons | Decision | Decisions 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" and 2026-10-08 "Feed Forecast Calculation uses one control row and no result filters". |
| Time zone line under Planning Date | Decision | Decision 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" Q14 (whose time zone "today" is). |
| Generate July-June drafts button (when no periods exist) | Decision | Decision 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" Q9. |
| Stage column | Decision | Decision 2026-10-06 "Feed Forecast dates and balances are scoped to each calculation line" (a row is Batch + Stage + Feed Item; the Engine r5 text names stage, r70 does not list it as a column). |
| Silo Name column | Decision | Decision 2026-10-04 "Feed screens follow the workbook field for field; a real dashboard" item 4 (show silo number and silo name). |
| Open Transfer KG, Planned Feed Added KG, Feed Requisition columns | Decision | Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" item 7 (planned incoming stock, never double counted); Engine r28 only asks that expected and confirmed receipts are tracked separately. |
| Past planning date note ("Stock as of ...") | Decision | Decision 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" Q8. |
| Notes line "No shed recorded (fed from the store)" | Supporting/System | Supporting: explains a row with no shed; store fallback per 2026-09-24 "A silo hangs off the farm, feeds many sheds, and holds real stock". |

**Feed Forecast > Feed Plan**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Production Date input and Generate plan button | Supporting/System | Supporting: on-demand run; Engine r69 says "manual rerun available". |
| Projected Target KG and Adjustment Factor | Decision | Decision 2026-10-08 "Retained weekly Feed Plan calculation (implementation interpretation)" (how the five-week evidence is applied). |
| Mill Approved KG (version line) | Decision | Decisions 2026-10-08 "Retained weekly Feed Plan calculation (implementation interpretation)" and 2026-10-09 "Approved feed requisitions create an Actual Feed Plan revision" (Actual revision after approval). |
| Retained versions list (Rnn) | Decision | Decision 2026-10-08 "Retained weekly Feed Plan calculation (implementation interpretation)" (old versions stay queryable); Engine r68 asks for run versions. |

**Feed Forecast > Compare Report**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Diet Priority, Feed Type, Farms (count) columns | Decision | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" (Diet Priority on BIN assignment; mill allocations are split bulk and bagged). |
| Mill and Period (day or week) selectors, Show report | Supporting/System | Supporting: chooses what the report covers. |
| Mill capacity summary tiles (daily capacity, bulk and bagged split, totals) | Decision | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" (mill capacity per day with bulk and bagged allocation). |
| Export CSV | Unclear | No decision found; supporting. Needs Rishi to confirm. |

**Feed Forecast > Requisition (list and new dialog)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Show filter (status), Lines count, KG total columns | Supporting/System | Supporting list controls and totals. |
| Farm selector with All farms | Decision | Decision 2026-10-09 "Feed Mill Consolidation is the next feed-requisition gate" (all-farms view for company-scope users so they can consolidate). |
| New requisition button (opens the feed form directly) | Decision | Decision 2026-10-04 "Feed screens follow the workbook field for field; a real dashboard" item 1 and 2026-10-04 "Where each requisition kind is created". |
| Requester User ID, Requester Name, Requester Department | Rishi's list | Rishi's common list header carried onto the feed header (2026-10-05 "Common requisition: requester, Service lines, receipt and release"); not workbook rows. |
| Bagged total requested (KG and bags) | Decision | Decision 2026-10-07 "Feed requisition Type, Source and document boundary" item 5 (farm total is bulk only, so bagged is shown separately). |
| Forecast Run reference | Named only | Named in the file ("Preserve run ID", Engine r30) with no row of its own. |
| Line Reason (selected from the Reason Master) | Decision | Decision 2026-10-07 "Requisition form contract and feed-line Reason Master" item 3 (feed alone carries a line Reason). |
| Batches and sheds breakdown under each line: Batch No., Stage, Shed, Heads, Rate, Lifecycle Row, Demand KG | Decision | Decision 2026-10-03 "Feed requisition lines per batch, house, silo and item; common requisition kept" (Engine r30 names batch and house lines; the detail columns are ours). |
| Mill consolidation block: Consolidation sheet, Consolidation status, Next action | Decision | Decisions 2026-10-09 "Feed Mill Consolidation is the next feed-requisition gate" and 2026-10-09 "Consolidation is required before feed Release" (consolidation gates release). |
| Mill Requested KG, Adjustment Reason line columns | Named only | Named by Req r123 and r127 (consolidation); shown here so the farm sees the mill's change. |
| Save and Submit for approval buttons in the dialog footer | Decision | Decisions 2026-10-07 "Requisition form contract and feed-line Reason Master" item 7 and 2026-10-08 "Common and feed draft actions use the dialog footer". |
| Forecast exception reason when the item differs from the lifecycle | Named only | Named by Checkpoints 16 (exception needs approved reason). |

**Feed Forecast > Requisition (Release, Shipment, Receipt panels)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Release button | Decision | Decision 2026-10-08 "Feed requisitions continue through in-house transfer fulfilment" (release resolves each line to its mill BIN and creates linked transfers). |
| Transfer Shipment panel: Ship now KG per line, Post shipment, Posting date | Decision | Decisions 2026-10-08 "Feed requisitions continue through in-house transfer fulfilment" and 2026-10-09 "Transfer Order and Receipt are shared; Mill Consolidation is feed-only" (shipment is posted in NAVFarm; the file has Business Central ship). |
| Links to the transfer and shipment documents | Named only | Named by Checkpoints 43 (link each transfer line to its requisition). |
| Receipt result line ("Line n: x KG received, variance y KG, silo balance after receipt z KG") | Named only | Shows Req r145 and r150 after posting. |

**Feed Forecast > Mill Consolidation**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Select by Requisition no. or Date range, Find approved requisitions | Decision | Decision 2026-10-09 "Feed Mill Consolidation is the next feed-requisition gate" (select by requisition number or a date range). |
| Mark reviewed and Finalize consolidation buttons | Decision | Decisions 2026-10-09 "Feed Mill Consolidation is the next feed-requisition gate" and 2026-10-09 "Consolidation is required before feed Release" (finalize before release); REVIEWED is a value of Req r128. |
| Loading sheet column per line | Decision | Decision 2026-10-09 "Feed loading instructions are generated from consolidation" (loading sheets are generated from the consolidation). |
| Lines count column | Supporting/System | Supporting list summary. |

**Feed Forecast > Loading Instructions**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Estimated Arrival (optional, typed by the mill) | Decision | Decision 2026-10-11 "Dispatch notice carries a typed estimated arrival" (Rishi, 11 Oct, on Req r76). |
| Requested KG, Mill-approved KG, Adjustment reason columns | Decision | Decisions 2026-10-09 "Feed loading instructions are generated from consolidation" and 2026-10-09 "Consolidation-approved quantity is authoritative at release" (loading uses the consolidation-approved quantity). |
| "Shipment pending" message and Save button | Decision | Decision 2026-10-09 "Feed loading instructions are generated from consolidation" (a posted shipment must be linked before dispatch). |

**Feed Forecast > Physical Stock Count**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Status (Draft, Submitted, Approved, Posted) and Open approval link | Decision | Decision 2026-09-30 "Feed Forecast Engine CSV follow-up: stock count enters scope; mill and feed plan stay later" (every nonzero variance follows approval before posting). |
| Source (Scheduled or On demand) | Named only | Named in Engine r4 ("configured schedule or on demand"). |
| Counted-at weekday and time check message | Decision | Decision 2026-10-01 "Feed integration, common requisition controls and farm personas" (Sunday 08:00 starting schedule, configurable). |
| Variance reason chosen from the Reason Master (not free text) | Decision | Decisions 2026-10-01 "Feed integration, common requisition controls and farm personas" (stock variance uses the Reason Master). |

**Company Settings > Feed**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Default forecast days, Max forecast days | Named only | Named by Checkpoints 15 (configurable maximum, e.g. 45). |
| Production weekday, Production shift | Unclear | Weekday is named (Feed Forecast r8, Req r35). Production shift has no decision or workbook row; needs Rishi to confirm. |
| Capacity warning percentage (default 90) | Decision | Decisions 2026-09-30 "Feed Forecast Engine CSV follow-up: stock count enters scope; mill and feed plan stay later" and 2026-10-01 "Feed integration, common requisition controls and farm personas" (approaching-truck warning at a configurable 90 percent). |
| Finance variance percentage (default 5) and Finance variance amount | Decision | Decision 2026-10-01 "Feed integration, common requisition controls and farm personas" (escalation at 5 percent or more). Differs from Checkpoints 33, which says 2 percent for requiring a reason. |
| Bag size KG and Safety stock KG (stored in the settings table; no edit field found in this screen) | Unclear | Named by Req r23 and Engine r29 ("configured"); decision 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" item 2 sets safety stock default 0. Unclear where users edit them. |
| Farm order quantity overrides (Truck target, Bulk multiple per farm) | Decision | Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" item 2. |
| Silo Feed Setup table (farm, silo, shed(s), feed type, feed item, capacity, status) | Decision | Decision 2026-09-30 "Stage parity, company-owned Number Series and Silo Feed Setup" ; to be removed once the silo record has parity (2026-10-01 "Feed integration, common requisition controls and farm personas"): Unclear if still wanted. |

**Team > member dialog**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Department | Rishi's list | Rishi's common list ("User Setup defines department"). |
| Direct Transfer right (checkbox) | Rishi's list | Rishi's common list ("user needs right in User Setup to tick"). |

**Batches > Data Entry**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Empty bags (bagged feed lines) | Named only | Named by Checkpoints 28 (daily empty bags times bag size). |

**Requisition (common list, beyond Rishi's list)**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Source column, Approval / Document / Fulfilment status columns | Decision | Decision 2026-10-01 "Common requisition approval precedes release" and 2026-10-07 "Stable visible schema for every common requisition" (approval, document and fulfilment states are separate). |
| Farm and Required date columns | Supporting/System | Supporting list columns. |
| Waiting for my approval filter | Decision | Decisions 2026-10-04 "Tenant and Company admins approve every requisition; one Requisitions page" and 2026-10-07 "Common requisitions in Approvals and scoped admin self-approval". |
| Link PO, PO No., Linked PO No. | Decision | Decision 2026-10-08 "Final common requisition field and workflow contract" (Purchase uses Release then Link PO; no Business Central claim). |
| Reopen, Posting date, Linked transfer | Decision | Decisions 2026-10-07 "Requisition form contract and feed-line Reason Master" and 2026-10-08 "Common and feed draft actions use the dialog footer". |
| Approved By / Approval time / Released By | Decision | Decision 2026-10-07 "Stable visible schema for every common requisition" (workflow information, not form fields). |
| Lot and serial numbers shown after assignment | Rishi's list | Rishi's common list (Item Tracking: lot or serial assigned before shipment). |

**Alerts page**

| Extra field or control | Not in the file: kind | Reason |
|---|---|---|
| Type filter (Feed or Batch performance), Farm filter, Open or All | Supporting/System | Supporting list filters. |

Extras listed: 87 in the table above (Decision 54, Rishi's list 4, Supporting/System 14, Unclear 5, Named only 10), plus the 34 items of Rishi's common list.

## 3. Other things

### 3.1 Design principles (Feed Forecast sheet, rows 3-12)

| Sheet and row | Principle | How the app delivers it | Status |
|---|---|---|---|
| Principles r3 | Farm-wise segregation | Forecast, requisitions and consolidation are filtered by farm; a Farm Manager sees only their farm. | DONE |
| Principles r4 | Silo physical item versus house demand | Calculation grid shows Required Feed Item and Current Silo Item side by side; silo item changes only by an approved changeover. | DONE |
| Principles r5 | Breed lifecycle drives dated demand | Forecast engine picks the lifecycle feed row for each day, batch and shed. | DONE |
| Principles r6 | Next diet planning | Next diet is a separate line; Dashboard shows Next Diet Feed Item; CHANGEOVER alert when no compatible silo. | DONE |
| Principles r7 | Tentative and actual plans | Feed Plan tab (Tentative, then Actual after approval); Wednesday scheduler job. | DONE |
| Principles r8 | Flexible forecast dates and schedule | Daily, Weekly, Reporting Period and Custom views; schedule set in Company Settings > Feed. | DONE |
| Principles r9 | NAVFarm notification master | Alert Rules master and the feed alert evaluator; in-app delivery. | DONE |
| Principles r10 | Monthly stock take (reporting period driven) | Reporting Periods master plus the monthly Stock Take in Physical Stock Count; period close. | DONE |
| Principles r11 | Mill capacity awareness | MILL and BIN locations, Compare Report, capacity check on Mill Consolidation. | DONE |
| Principles r12 | Approval, mill consolidation, transfer and receipt | Requisition, approval, Mill Consolidation, Loading Instructions, in-house transfer, Transfer Receipt. | DONE |

### 3.2 Rules and validations (Checkpoints and Validations sheet)

| Checkpoint | Sheet row | Rule in plain words | Where the app enforces it | Status |
|---|---|---|---|---|
| 1 | Checkpoints r4 | Silo must be linked to a house (shed) before it is ACTIVE | Location service refuses an active silo with no attached shed | DONE |
| 2 | Checkpoints r5 | Silo item changes only after approved empty stock or a posted movement | Silo changeover check in the silo-feed service | DONE |
| 3 | Checkpoints r6 | A silo can serve many houses; a house can have many silos | silo_shed_link table; Attached Sheds on the silo form | DONE |
| 4 | Checkpoints r7 | Receipt item must match the silo item | Checked when a receipt is posted | DONE |
| 5 | Checkpoints r8 | Next diet with no compatible silo: changeover task and warning before approval | Warning on the requisition line and CHANGEOVER alert | DONE |
| 6 | Checkpoints r9 | One diet per mill loading bin at a time | BIN Diet Assignment service blocks a second diet in the same slot | DONE |
| 7 | Checkpoints r10 | Engine reads the next feed row automatically | Forecast engine | DONE |
| 8 | Checkpoints r11 | No next feed row: notify System Admin and Farm Manager | NO-NEXT-FEED-ROW alert plus a note on the Calculation tab | DONE |
| 9 | Checkpoints r12 | Next diet in 7 days with no silo of that feed type: CRITICAL to Farm Manager | NEXT-DIET-NO-SILO alert | DONE |
| 10 | Checkpoints r13 | All alert settings live in the Alerts and Notifications Master | Alert Rules master; evaluator reads the rules | DONE |
| 11 | Checkpoints r14 | Single low-feed threshold, one alert until recovery | FEED-BELOW-L1 rule with de-duplication | DONE |
| 12 | Checkpoints r15 | Recovery and re-arm of the low alert | Resolved on receipt, POST Day, approved adjustment and by the scheduler | DONE |
| 13 | Checkpoints r16 | Above-threshold INFO alert | FEED-ABOVE rule | DONE |
| 14 | Checkpoints r17 | POST Day cannot take a silo below 0 KG | Inventory ledger posting check | DONE |
| 15 | Checkpoints r18 | Forecast span: From before To, configurable maximum (45 days) | Forecast service; maximum in Company Settings > Feed | DONE |
| 16 | Checkpoints r19 | 3,000 KG bulk multiple; an exception needs a reason | Requisition rules: off-multiple quantity needs remarks | DONE |
| 17 | Checkpoints r20 | 30,000 KG is a truck target, not a block | Requisition shows truck trips only | DONE |
| 18 | Checkpoints r21 | More than 20 percent from Recommended: remarks mandatory | Submit and Approve checks | DONE |
| 19 | Checkpoints r22 | Farm Manager approves only their own farm | Own-farm check on approve | DONE |
| 20 | Checkpoints r23 | Friday evening and Saturday critical reminders for unapproved drafts | REQ-REMINDER and REQ-OVERDUE rules; REQ_REMINDER and REQ_CUTOFF scheduler jobs | DONE |
| 21 | Checkpoints r24 | Only an approved mill consolidation proceeds | Release gate: requisition must be on a finalized consolidation | DONE |
| 22 | Checkpoints r25 | Production cutoff from the production calendar | Late request needs remarks; cutoff from Company Settings > Feed | DONE |
| 23 | Checkpoints r26 | Diet-change case: both requisitions approved together | One requisition header holds the current and next diet lines | DONE |
| 24 | Checkpoints r27 | Compartment and KG Loaded mandatory before Dispatch | Loading sheet dispatch check | DONE |
| 25 | Checkpoints r28 | No two diets in one compartment | Loading sheet compartment check | DONE |
| 26 | Checkpoints r29 | Shipped not equal to received: variance reason mandatory | A reason is required on every short receipt (Rishi, 11 Oct) | DONE |
| 27 | Checkpoints r30 | Bag count times bag size must match received KG | Within 1 percent; shown on the receipt | DONE |
| 28 | Checkpoints r31 | Empty bags times bag size compared with posted consumption | Warning only at POST Day; bag tolerance in Company Settings | DONE |
| 29 | Checkpoints r32 | Over-receipt allowed with reason | Not built by ruling: over-receipt stays blocked (Rishi, 10 Oct) | N/A |
| 30 | Checkpoints r33 | Diet change alert 3 days before | DIET-CHANGE rule; DIET_CHANGE scheduler job (daily) | DONE |
| 31 | Checkpoints r34 | One stock take per month; period cannot close without it | Period Close in Reporting Periods; farms or mills with nothing countable are listed, not blocked (Rishi, 11 Oct) | DONE |
| 32 | Checkpoints r35 | After the stock take the period is CLOSED; no more POST Day | Closed-period guard on POST Day | DONE |
| 33 | Checkpoints r36 | Variance over 2 percent needs a reason | Stock count needs a reason on every nonzero variance (stricter than the file) | DONE |
| 34 | Checkpoints r37 | Demand above mill capacity: notify Mill Manager and Head of Farms | CAPACITY-EXCEEDED alert; Compare Report; consolidation check | DONE |
| 35 | Checkpoints r38 | Loading bin constraint violated: CRITICAL to Mill Manager | Blocked at assignment (as checkpoint 6); Compare Report | DONE |
| 36 | Checkpoints r39 | Wednesday tentative plan regenerated; notify Farm Managers | TENTATIVE_PLAN scheduler job; PLAN-AVAILABLE rule | DONE |
| 37 | Checkpoints r40 | Balance always labelled SYSTEM BALANCE | Labels on Dashboard, Calculation dialog, counts, requisition | DONE |
| 38 | Checkpoints r41 | Notifications through NAVFarm in-app, email, SMS | In-app is built; email deferred and SMS not built (Rishi, 11 Oct) | N/A |
| 39 | Checkpoints r42 | Business Central retries by unique reference | Not built: no Business Central connector (decision 3 Oct) | N/A |
| 40 | Checkpoints r43 | Reporting period must exist before stock take or close | Checked on Stock Take and Period Close | DONE |
| 41 | Checkpoints r47 | Only APPROVED requisitions are consolidated | Eligible list on the consolidation dialog | DONE |
| 42 | Checkpoints r48 | Infeasible plan cannot be pushed | Capacity check before finalizing a consolidation | DONE |
| 43 | Checkpoints r49 | Transfer lines link to requisition and consolidation | Transfer line carries the requisition line; Transfer Orders page shows the source | DONE |
| 44 | Checkpoints r50 | Requested Qty locked on receipt | Receipt panel: read-only | DONE |
| 45 | Checkpoints r51 | Receipt silo filtered by item and feed type | Silo-feed check on receipt | DONE |
| 46 | Checkpoints r52 | Received KG added once | Shared transfer posting path | DONE |
| 47 | Checkpoints r53 | No feed GRN | Goods Receipt refuses feed into a silo | DONE |

Checkpoints 29 (over-receipt allowed) is N/A by Rishi's ruling of 10 Oct; 38 is N/A because email is deferred and SMS is not built; 39 is N/A because there is no Business Central connector.

**Rules the app enforces that the workbook does not ask for**

| Rule | Not in the file: reason |
|---|---|
| A silo holds one feed item; a transfer that would exceed silo capacity or carry a different item is refused | Decision 2026-09-24 "A silo hangs off the farm, feeds many sheds, and holds real stock" |
| Two silos on one shed may not hold the same feed item | Decision "2026-09-30 Feed examples are seed fixtures; four farms exercise the silo topology" |
| BIN parent must be a MILL; MILL bulk plus bagged allocation cannot exceed daily capacity; a BIN cannot change diet while it holds stock | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" |
| A feed silo and item can be requisitioned again only after the earlier requisition is Received | Decision 2026-10-09 "Feed Mill Consolidation is the next feed-requisition gate" |
| Release needs a finalized consolidation covering every line and an active BIN assignment for the production date | Decisions 2026-10-09 "Consolidation is required before feed Release", 2026-10-09 "Consolidation-approved quantity is authoritative at release", 2026-10-08 "Mill BIN release setup stays in the shared master framework" |
| Dispatch needs a posted shipment linked to the loading sheet | Decision 2026-10-09 "Feed loading instructions are generated from consolidation" |
| Shipped and received are measured against the mill-approved quantity; full receipt sets Status to Received | Decisions 2026-10-10 "Feed fulfilment measures against the mill-approved quantity" and 2026-10-11 "Rishi's answers on the open interpretations" |
| Over-receipt blocked (departs from Checkpoints 29) | Decision 2026-10-10 "TO receipt: over-receipt stays blocked" |
| Delivery note on a feed receipt is optional | Decision 2026-10-11 "Rishi's answers on the open interpretations" |
| No self-approval, except Tenant and Company Admin (and Operational Admin where permitted); admins approve any requisition | Decisions 2026-10-01 "Feed integration, common requisition controls and farm personas", 2026-10-04 "Tenant and Company admins approve every requisition; one Requisitions page", 2026-10-07 "Common requisitions in Approvals and scoped admin self-approval" |
| Transfer Shipment by the From department, Transfer Receipt by the requester in the To department, no admin bypass; Direct Transfer has no department check | Rishi's common list; decisions 2026-10-04 "Feed Forecast tab names; Stages removed; admins keep department checks" and 2026-10-11 "Rishi's answers on the open interpretations" |
| Lot or serial mandatory before shipment; serial lines ship whole; a transfer may take stock from other stores of the company | Rishi's common list; decisions 2026-10-05 "Item Tracking after release, and four readings of Rishi's list" and 2026-10-11 "Rishi's answers on the open interpretations" |
| Weekly count: every nonzero variance needs a Reason Master reason and approval; scheduled counts must match the configured day and time; escalation at 5 percent or more | Decisions 2026-09-30 "Feed Forecast Engine CSV follow-up: stock count enters scope; mill and feed plan stay later" and 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| Period close needs a posted take only from farms and mills with something to count | Decision 2026-10-11 "Period close needs counts only where something can be counted" |
| Requisition visibility follows the farm's line of business | Decision "2026-10-04 Requisition LOB scope uses the farm's LOB; merge GitHub main locally for lot/serial" |
| Lifecycle feed rows: overlap check within the same farm scope; farm row beats default row | Decision 2026-10-11 "Lifecycle feed rows support a farm-level override" |
| Scheduler: one run per job, farm and period; stops retrying a job after 3 failures in a period; timer off unless enabled; manual run endpoint | Not in the file: supporting (feed_schedule_log, migration 0167) |
| Action messages (save, approve, release, post...) appear as the common toast | Decision 2026-10-10 "Action messages use the common toast notification" |
| Lot-tracked items default to the nearest-expiry lot; expired medicine blocked, expired feed warned (defaults awaiting Rishi) | Decision "8 Oct 2026 Lot required only for tracked items; tracked items default to nearest expiry (defaults, awaiting Rishi)" |

### 3.3 Alerts and notifications

The app ships 18 default alert rules (17 event types; the requisition deadline has two rules). Every one maps to a workbook row. Delivery is in-app only: the email channel is deferred (Rishi, 11 Oct).

| Rule code | What it says | Workbook rows |
|---|---|---|
| FEED-BELOW-L1 | Low silo feed, first priority | Master r45, r48, r49; Checkpoints 11, 12 |
| FEED-ABOVE | Silo feed above high level | Master r45; Checkpoints 13 |
| DIET-CHANGE | Diet change within 3 days | Master r45, r47; Checkpoints 30 |
| REQ-REMINDER | Requisition not yet approved (Friday) | Req r84; Checkpoints 20 |
| REQ-OVERDUE | Requisition deadline reached (Saturday) | Req r85; Checkpoints 20 |
| PLAN-AVAILABLE | Feed plan available | Feed Forecast r9; Checkpoints 36 |
| MILL-DISPATCH | Feed dispatched from the mill | Req r74-r76, r88 |
| MILL-ADJUSTED | Mill approved a different quantity | Req r126 (notify farm) |
| RECEIPT-VARIANCE | Feed receipt short of shipment | Master r45 (receipt variance); Checkpoints 26 |
| NO-NEXT-FEED-ROW | No next feed row for a batch | Checkpoints 8 |
| NEXT-DIET-NO-SILO | No silo for the next diet | Checkpoints 9 |
| CAPACITY-EXCEEDED | Approved demand exceeds mill capacity | Checkpoints 34 |
| SHORTFALL | Projected shortfall in a silo | Engine r60 |
| NOT-DRAFTED | Shortfall with no requisition drafted | Engine r61 |
| TRUCK-TARGET | Farm order below the truck target (part load) | Engine r62 |
| AUTO-DRAFTED | Requisition auto-drafted for review | Req r80 |
| STOCK-TAKE-DUE | Monthly stock take due | Master r45 |
| CHANGEOVER | Silo changeover needed before approval | Checkpoints 5 |

| Other notification behaviour | Sheet and row, or reason |
|---|---|
| Alerts escalate to the next role after the configured hours and resolve when the cause clears | Master r52, r53, r54; Checkpoints 12 |
| Action messages use the common toast (top right) instead of inline text | Not in the file: 2026-10-10 "Action messages use the common toast notification" |
| Alerts are visible to Head of Farms and Farm Managers inside their scope | Not in the file: 2026-09-30 "Feed Forecast Engine CSV follow-up: stock count enters scope; mill and feed plan stay later" |
| Dispatch notice, status (Sent or Not sent) and text shown on the loading sheet | Req r74, r75, r76 |

### 3.4 Scheduler jobs

A single timer ticks every five minutes and runs the due jobs once per farm and period. It is **off unless the server is started with FEED_SCHEDULER_ENABLED=true**. Email is not sent.

| Job | When | Workbook rows |
|---|---|---|
| TENTATIVE_PLAN | Weekly, at the configured day and time (Triple-C default Wednesday) | Engine r69; Feed Forecast r7, r8; Checkpoints 36 |
| REQ_REMINDER | Weekly, configured day and time (Friday evening) | Req r84; Checkpoints 20 |
| REQ_CUTOFF | Weekly, configured day and time (Saturday) | Req r85; Checkpoints 20 |
| DIET_CHANGE | Daily | Checkpoints 30 |
| ESCALATION | Hourly | Master r52, r53, r54 (escalate after N hours) |
| STOCK_TAKE_DUE | Daily | Master r45 (stock take due); Checkpoints 31 |

The run log, the five-minute tick, the back-off after 3 failed runs and the manual run endpoint are not in the file (supporting; migration 0167).

### 3.5 Migrations 0141 to 0173

| No. | What it adds | Workbook rows | If not in the file: reason |
|---|---|---|---|
| 0141 | inventory_ledger_line: one ledger entry can issue stock from several lots or serials | Not in the file | Lot and serial costing, decision 8 Oct 2026 "Costing follows the item's method; one ledger entry per activity" |
| 0142 | feed_planning_setting (forecast days, schedule, truck target, bulk multiple, thresholds); is_local flag on company currency | Engine r69, Req r27, r28, Checkpoints 15, 20, 22, 28 | Local-currency flag is not in the file (decisions 2026-10-01 "Feed integration, common requisition controls and farm personas", 2026-10-09 "Base Currency is sufficient for stock-count valuation") |
| 0143 | feed_forecast_run and run lines; reporting periods now default to inactive Draft | Engine r68 (run date and version) | Draft default: 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| 0144 | feed_stock_count and lines; ledger index for count cut-off | Engine r3-r18; Silo r5 | - |
| 0145 | Common requisition: header and line fields, approval/document/fulfilment states, department links on user and location, forecast run link | Not in the file (Engine r30 for the run link) | Rishi's common list; 2026-10-01 "Common requisition approval precedes release" |
| 0146 | Transfer shipment and receipt events, tracking assignments | Req r132-r150; Silo r13-r29 (receipt events) | Shipment events and item tracking: Rishi's common list, 2026-10-08 "Final common requisition field and workflow contract" |
| 0147 | HEAD_OF_FARM alert recipients become OPERATIONAL_ADMIN | Master r50, r54 (recipient roles) | Decision 2026-10-01 "Feed integration, common requisition controls and farm personas" (Head of Farms is OPERATIONAL_ADMIN) |
| 0148 | Safety stock, bag size, Diet No., feed form, linked transfer, mill-approved qty, recommended delivery date, exceeds-capacity flag | Engine r29; Req r23, r25, r39, r153; Master r37 | Safety stock default: 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" |
| 0149 | Adds the approval and posting columns the stock count service writes | Engine r18 (save, submit, post) | Repair of 0137; supporting |
| 0150 | requisition_line_batch (batch and shed under each line); Days Remaining to one decimal | Engine r30; Silo r9 | Batch lines: 2026-10-03 "Feed requisition lines per batch, house, silo and item; common requisition kept" |
| 0151 | Widens Days Remaining so large values do not overflow | Silo r9 | Review fix; supporting |
| 0152 | Adds stage to the batch lines | Engine r30 | Bug fix (auto-draft failed on stage-wise batches); supporting |
| 0153 | No migration with this number exists | - | - |
| 0154 | Stock transfer line points at its requisition line | Checkpoints 43; Req r89 | - |
| 0155 | Direct Transfer right on the user; lot and serial on requisition lines | Not in the file | Rishi's common list |
| 0156 | Requisition line unit of measure may be empty | Not in the file | Rishi's common list (FA and Service: Description + Qty), 2026-10-05 "Requisition is its own menu item, common kinds only; FA/Service lines are Description + Qty" |
| 0157 | MILL and BIN fields on locations; bin_diet_assignment; production_slot_master | Checkpoints 6, 35; Req r32, r67 (by name) | Fields and slots: 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" |
| 0158 | Reason on a requisition line | Not in the file | Decision 2026-10-07 "Requisition form contract and feed-line Reason Master" |
| 0159 | feed_requisition_transfer (requisition linked to its transfers) | Req r39, r89 | Decision 2026-10-08 "Feed requisitions continue through in-house transfer fulfilment" |
| 0160 | Saved calculation can be archived | Not in the file | Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock" (Delete calculation) |
| 0161 | feed_plan and feed_plan_line (versioned plans) | Engine r34-r44 | - |
| 0162 | feed_consolidation and lines; requisition points at its consolidation | Req r115-r130 | - |
| 0163 | Consolidation line keeps destination silo, production date and delivery date | Req r64, r68 | Snapshots: 2026-10-09 "Consolidation is required before feed Release" |
| 0164 | feed_loading_sheet | Req r60-r77 | - |
| 0165 | Receipt line: bag count, delivery note, loading sheet, variance qty and reason | Req r145-r148; Silo r17, r18, r24, r27, r28; Checkpoints 26, 27 | - |
| 0166 | Stock count type (weekly or monthly), reporting period link, stock take type; reporting period status, closed and reopened details | Silo r33-r49; Checkpoints 31, 32, 40 | Reopen details are not in the file (Unclear) |
| 0167 | Tentative plan weekday and time in settings; feed_schedule_log (one run per job, farm and period) | Engine r69; Checkpoints 36 | Run log is supporting |
| 0168 | Cost centre on FARM and MILL locations | Silo r47; Feed Forecast r3 | Decision 2026-10-11 "Each farm has its own cost centre" |
| 0169 | Empty bags on the daily data entry | Checkpoints 28 | - |
| 0170 | Effective-from and effective-to on lifecycle feed rows | Master r30, r38 | - |
| 0171 | Farm (override) on lifecycle feed rows | Master r30, r39 | Decision 2026-10-11 "Lifecycle feed rows support a farm-level override" |
| 0172 | Effective dates on the silo to shed link | Master r8 | - |
| 0173 | Estimated arrival on the loading sheet | Req r76 | Decision 2026-10-11 "Dispatch notice carries a typed estimated arrival" |

### 3.6 Data scripts (all follow plan, `--verify`, `--apply`; local databases)

| Script | What it does | Workbook rows | If not in the file: reason |
|---|---|---|---|
| align-feed-tdd | Moves farm feed logistics (bulk multiple, bag size, truck target, production weekday) into Feed Planning Settings | Req r27, r28; Engine r69 | Decision 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" |
| align-requisition-demo-data | Demo departments, locations, users and lot or serial items for the common requisition | Not in the file | Rishi's common list; demo data only |
| align-requisition-permissions | Grants requisition permissions to the demo Farm Manager, Head of Farms and Standard User roles | Not in the file | Decision 2026-10-05 "Demo roles get requisition permissions" |
| backfill-feed-forecast-requisition | Pre-check and fill of requisition states and legacy alert roles before the 0145 and 0147 changes | Not in the file | Supporting: migration helper |
| fix-feed-requisition-received | Sets fully received feed requisitions to RECEIVED | Req r33, r89 | Decision 2026-10-11 "Rishi's answers on the open interpretations" |
| fix-requisition-farm | Fills the farm on requisitions that have none, from their Main / Farm Location | Not in the file | Decision "2026-10-04 Requisition LOB scope uses the farm's LOB" |
| fill-service-line-descriptions | Copies the Resource name into an empty Service line description | Not in the file | Rishi's common list (Service: Description + Qty) |
| recompute-transfer-status | Corrects stock transfer status from its shipment and receipt events | Req r89 | Supporting repair of older rows |
| seed-feed-mill-location-types | Creates or aligns MILL and BIN location types | Not in the file | Decision 2026-10-05 "MILL location and real loading-bin source enter the Feed Forecast scope" |
| seed-four-farm-feed-demo, demo/four-farm-feed-fixture, demo chapter 07-feed-planning | Four-farm demo masters and feed planning demo data | Not in the file | Decision "2026-09-30 Feed examples are seed fixtures; four farms exercise the silo topology"; example values are not defaults |
| seed-documented-reasons | Loads the 57 documented Reason Master rows used for variance reasons | Not in the file | Decision "2026-09-21 Reason Master built from the client's own template" |
| align-inventory-application-series, verify-costing-scenarios, demo chapter 09-costing-scenarios, split-comma-serial-layers | Costing series, costing rehearsal and lot or serial data repair | Not in the file | Lot and serial costing work: 8 Oct 2026 "Costing follows the item's method; one ledger entry per activity" |

### 3.7 Permissions and roles

| Permission or role | Where it applies | Workbook rows, or reason |
|---|---|---|
| PROCUREMENT > REQUISITION: view, create, edit, submit, approve | Feed and common requisition list, document, submit, approve, release, consolidation (approve), loading sheet save (approve) | Req r82, r83, r86; Checkpoints 19, 41. Roles: Farm Manager and Head of Farms get all five; Standard User gets all but approve (2026-10-05 "Demo roles get requisition permissions") |
| INVENTORY > STOCK_TRANSFER: view, create, edit, delete | Transfer shipment, dispatch and receipt posting | Req r88, r89 (dispatch, receipt) |
| INVENTORY > STOCK_COUNT: view, create, edit, approve | Physical Stock Count and monthly stock take | Engine r18; Silo r46 |
| INVENTORY > LEDGER: view, create | Feed forecast, plan and alert endpoints read the ledger permission | Engine r45-r64 |
| MASTER_DATA > REPORTING_PERIOD: view, create, edit, delete, approve (close and reopen) | Reporting Periods master | Checkpoints 31, 32, 40 |
| MASTER_DATA > PRODUCTION_SLOT and BIN_DIET_ASSIGNMENT: view, create, edit, delete | Production Slots and BIN Diet Assignments | Not in the file: 2026-10-08 "Mill BIN release setup stays in the shared master framework" |
| NOTIFICATION > ALERT_RULE: view, create, edit, delete | Alert Rules master | Master r43-r56 |
| Direct Transfer right on the user (not a role permission) | Direct Transfer on a Store requisition | Not in the file: Rishi's common list; no department check (2026-10-11 "Rishi's answers on the open interpretations") |
| User department (Cost Center Master, type DEPARTMENT) | Transfer Shipment and Transfer Receipt department checks | Not in the file: Rishi's common list; no admin bypass (2026-10-04 "Feed Forecast tab names; Stages removed; admins keep department checks") |
| User types: FARM_MANAGER (own farm), OPERATIONAL_ADMIN = Head of Farms, STANDARD_USER (farm worker); Tenant and Company Admin approve any requisition | Who may approve, release and see which farm | Checkpoints 19; Master r50. Decisions 2026-10-01 "Feed integration, common requisition controls and farm personas", 2026-10-04 "Tenant and Company admins approve every requisition; one Requisitions page", 2026-10-07 "Common requisitions in Approvals and scoped admin self-approval" |
| Feed Mill Manager | There is no Feed Mill Manager role or user type; consolidation and loading use the REQUISITION approve permission. MILL_MANAGER exists only as an alert recipient code. | Req r118 (Feed Mill Manager). Unclear whether Rishi wants a separate role |

### 3.8 Settings

| Setting | Workbook rows, or reason |
|---|---|
| Company Settings > Feed: default and maximum forecast days (7, 45) | Checkpoints 15 |
| Production weekday and shift, submission weekday and time, reminder weekday and time | Req r35; Feed Forecast r8; Checkpoints 20, 22 (shift is Unclear) |
| Physical count weekday and time; tentative plan weekday and time | Engine r69; Checkpoints 36 |
| Truck target KG, bulk order multiple (company, with per-farm override) | Req r27, r28 (per-farm override: decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock") |
| Capacity warning percentage (90), bag tolerance percentage | Engine r62 (approaching cap); Checkpoints 28 |
| Finance variance percentage (5) and amount | Not in the file: 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| Bag size KG and safety stock KG (settings table; no edit field found) | Req r23, Engine r29 (Unclear where edited) |
| Base and local currency flags for stock count valuation | Not in the file: 2026-10-01 "Feed integration, common requisition controls and farm personas", 2026-10-09 "Base Currency is sufficient for stock-count valuation" |
| Reporting Periods (July to June, Draft until activated) | Checkpoints 40; Silo r36 |
| Number formats: CONS-YYYYWW-NNN, LOAD-ReqNo-LineNo, PLAN-farm-YYYYWW-Rnn; requisition number series (common and feed separate) | Req r115, r60; Engine r34; series: 2026-10-01 "Feed integration, common requisition controls and farm personas" |
| Server switch FEED_SCHEDULER_ENABLED=true (scheduler is off unless set) | Not in the file: deployment setting; the final audit notes it must be switched on |
| Company time zone used for "today" and cut-offs | Not in the file: 2026-09-27 "Feed Forecast Plan R: the defaults the report runs on, awaiting Rishi" Q14 |
| Alert recipients accept Role Master codes or user types | Master r50, r54; 2026-10-11 "Alert recipients accept Role Master codes and the user types the defaults use" |

## 4. Summary counts

| Measure | Count |
|---|---|
| Pages, tabs and dialogs listed | 46 |
| In the file (implement at least one workbook row) | 31 |
| Extra (Not in the file) | 15 |
| Workbook rows covered | 310 of 310: 299 DONE, 0 PARTIAL, 11 N/A (field rows 253 in 2.1; design principles 10 and checkpoints 47 in Section 3) |
| Field rows in 2.1 | 253: DONE 245, PARTIAL 0, N/A 8 |
| Extra fields and controls (Not in the file) | 111 = 77 in 2.2 tables + 34 in Rishi's common list |
| of which from a Rishi decision | 54 |
| of which from Rishi's own common requisition list | 38 (34 list items + 4 placed on other pages) |
| of which supporting or system | 14 |
| of which Unclear (need Rishi) | 5 |
| Named in the file but with no row of their own (not counted as extra) | 10 |
| Alert rules / scheduler jobs / migrations | 18 rules (17 events) / 6 jobs / 32 files (0153 does not exist) |
| Rules the app enforces that the file does not ask for | 19 |

### Open questions for Rishi (the Unclear items)

- Master Data > Reporting Periods: Reopen Period action (and reopen reason). No decision found; supporting action beside Close Period (Checkpoints 31, 32). Needs Rishi to confirm.
- Feed Forecast > Dashboard: Status chip on the silo (Critical under 3 days, Warning under 7 days, 7 days or more). No decision found; a display aid on Days of Feed Remaining (Engine r55). Needs Rishi to confirm.
- Feed Forecast > Compare Report: Export CSV. No decision found; supporting. Needs Rishi to confirm.
- Company Settings > Feed: Production weekday, Production shift. Weekday is named (Feed Forecast r8, Req r35). Production shift has no decision or workbook row; needs Rishi to confirm.
- Company Settings > Feed: Bag size KG and Safety stock KG (stored in the settings table; no edit field found in this screen). Named by Req r23 and Engine r29 ("configured"); decision 2026-10-03 "Feed TDD workbook governs feed; in-house mill pipeline" item 2 sets safety stock default 0. Unclear where users edit them.
- Feed Mill Manager role: consolidation and loading use the requisition approve permission; Req r118 names a Feed Mill Manager but no such role exists.
- Silo Feed Setup (Company Settings > Feed) is still present; the 1 Oct ruling says to remove it once the silo record has parity.
