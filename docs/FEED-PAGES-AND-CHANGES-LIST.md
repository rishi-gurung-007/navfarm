# Feed work: pages added and pages changed, with the workbook rows

Prepared 11 Oct 2026 for Rishi. Branch `wave5/wb100` (GitHub main `2beb79e3` plus the 11 Oct follow-ups). Workbook: `NAVFarm_Feed forecast TDD with examples (1).xlsx`.
"Already existed" means the page was on the test server before the workbook work (release of 28 Sep, commit `df638eb7`); it was checked in git, not assumed. Screens say Shed (House = Shed).

Sheet names used below (row numbers are the workbook's own): **Feed Forecast** = the Feed Forecast sheet (design principles); **Master Setup**; **Forecast Engine** = Feed Forecast Engine; **Requisition** = Requisition and Loading Sheet; **Silo and Stock Take** = Silo Balance and Stock Take; **Checkpoints** = Checkpoints and Validations. Checkpoint numbers in the sheet are shown here as rows (checkpoint 28 = row 31).

Items marked "(being removed)" are being taken out right now.

---

## A. New pages, tabs and dialogs

All of these sit under **Inventory > Feed Forecast**, which is one page with eight tabs: Dashboard, Calculation, Feed Plan, Compare Report, Requisition, Feed Mill Consolidation, Feed Loading Instructions, Physical Stock Count. The page itself already existed (see B1); the tabs below are new.

1. **Dashboard tab (Silo dashboard)**. Menu: Inventory > Feed Forecast > Dashboard. Sheet rows: Forecast Engine r45-r64 (section 4 Dashboard), r67; Silo and Stock Take r8, r9; Checkpoints r40.
   - Pick Farm, Shed, Silo, View, Planning Date and dates.
   - Cards: Current Diet Feed Item, Mill Loading Bin No., Silo Capacity KG, System Balance KG, Daily Requirement KG, Days of Feed Remaining (one decimal), First Shortage Date, Projected Need for Selected Range KG, Current Diet Days Remaining, Next Diet Feed Item, Silo Available for Next Diet Feed Type, Projected Shortfall KG, Recommended Order Qty KG, Farm Total Order This Cycle KG, Requisition Status (opens the requisition), Submission Deadline.

2. **Projected balance explanation dialog**. Menu: Inventory > Feed Forecast > Calculation (click a date in the grid). Sheet rows: Forecast Engine r28; Silo and Stock Take r5-r8; Checkpoints r40.
   - Shows Opening System Balance, Confirmed Receipts, Open Transfer, Planned Feed Added and the projected closing balance for that silo and date.

3. **Saved run history list**. Menu: Inventory > Feed Forecast > Calculation (Run history). Sheet row: Forecast Engine r68.
   - Each saved run: version, view, dates, saved-as-of time, posting cutoff, filters, configuration version, saved by.

4. **Feed requisition from saved calculation (preview and edit dialog)**. Menu: Inventory > Feed Forecast > Calculation > Create from saved calculation. Sheet row: Forecast Engine r30 (Step 9).
   - Editable lines: Silo Code, Feed Item No., Feed Item Description, Recommended Qty KG, Requested Qty KG, Proposed Delivery Date, Remarks.

5. **Feed Plan tab**. Menu: Inventory > Feed Forecast > Feed Plan. Sheet rows: Forecast Engine r31-r44 (section 3); Checkpoints r39; Feed Forecast r7.
   - Plan Code, Plan Type (Tentative or Actual), Farm Code, Plan Week, Feed Item No., Tentative KG, Requested KG, Variance KG, Mill Capacity Available KG, Plan vs Mill Capacity; Generate plan button.

6. **Feed plan version lines dialog and five-week consumption evidence**. Menu: Inventory > Feed Forecast > Feed Plan (open a version). Sheet rows: Forecast Engine r34-r44.
   - Lines per feed item, Plan vs Mill Capacity, and a five-week table: Wednesday-Tuesday Week, Posted Consumption KG, Lifecycle Expected KG (r44).

7. **Compare Report tab**. Menu: Inventory > Feed Forecast > Compare Report. Sheet rows: Feed Forecast r11 (names the report, no field table); Forecast Engine r42, r43; Checkpoints r37, r38.
   - Pick Mill and Production date or week, Show report. Columns: Production Date, Diet Priority, Diet No., Feed Item No. and Name, Mill Loading Bin, Feed Type, Farms, All Farms Requested KG, Mill Approved KG, Mill Capacity Available KG, Plan vs Mill Capacity (Green, Amber, Red), Total.

8. **Feed Mill Consolidation tab (sheet list and sheet view)**. Menu: Inventory > Feed Forecast > Feed Mill Consolidation. Sheet rows: Requisition r112-r130 (section 5); Checkpoints r47, r48.
   - List: Consolidation No., Production week, Date, Status (Draft, Reviewed, Consolidated), Lines, Requested KG, Approved KG.
   - Sheet view: Feed Mill Manager, per line Requisition, Farm, Destination, Feed item and Diet No., Mill loading BIN, Requested KG, Total all farms KG (diet), Mill capacity available KG, Approved KG, Adjustment reason, Transfer order, Loading sheet. Buttons Mark reviewed, Finalize consolidation.

9. **Mill Consolidation Sheet dialog (pick approved requisitions)**. Menu: Inventory > Feed Forecast > Feed Mill Consolidation > new sheet. Sheet rows: Requisition r113, r115-r127; Checkpoints r47, r48, r37.
   - Select by Requisition no. or Date range, Find approved requisitions, set Mill approved quantity and Adjustment reason per line, Create consolidation.

10. **Feed Loading Instructions tab**. Menu: Inventory > Feed Forecast > Feed Loading Instructions. Sheet rows: Requisition r57-r77 (section 3); Checkpoints r27, r28.
    - Loading sheet, Requisition, Farm / destination, Delivery date, Feed item / loading BIN (Diet N), Requested KG, Mill-approved KG, Compartment, KG loaded, Loaded by, Loading date time, Status, Estimated Arrival, Dispatch Notification (Sent or Not sent), Save and Dispatch buttons.

11. **Physical Stock Count tab**. Menu: Inventory > Feed Forecast > Physical Stock Count. Sheet rows: Forecast Engine r3-r18 (section 1); Silo and Stock Take r30-r49 (section 3); Checkpoints r34-r36, r43.
    - List: Count, Count Type (Weekly Physical Count or Monthly Stock Take), Reporting Period, Counted at, Source, Status.

12. **New count dialog (count entry per silo, approval, post)**. Menu: Inventory > Feed Forecast > Physical Stock Count > New count. Sheet rows: Forecast Engine r6-r18; Silo and Stock Take r33-r49.
    - Per silo: Silo, Silo Name, Shed(s), Feed Item No., Current Diet Description, Silo Capacity KG, System Balance KG, Counted (kg), Variance (kg), Variance (%), Reason, Projected Shortfall KG, Next Diet Change In, Next Feed Item. Buttons Save draft, Submit for approval, Post to stock.
    - After posting: Adjustment Type, GL Entry Reference, Cost Centre, Period Status After Reconciliation, Production Start Date Next Period (Silo and Stock Take r45-r49).

13. **Transfer Receipt panel inside the feed requisition document**. Menu: Inventory > Feed Forecast > Requisition > open a requisition. Sheet rows: Requisition r132-r150 (section 6), r152-r155 (section 7); Silo and Stock Take r11-r29; Checkpoints r29, r30, r50-r52.
    - Receipt, Requisition, Farm, Destination silo, Item, Requested KG (locked), Shipped KG, Receive now (KG), Variance KG and reason, Bag count, Compartment, Delivery note no. (optional), Loading sheet link, Post receipt, silo balance after receipt.

14. **BIN Diet Assignments tab**. Menu: Master Data > Location > BIN Diet Assignments. Sheet rows: Checkpoints r9, r38; Requisition r32, r67 (the file asks for one diet per loading bin and gives no field table).
    - BIN, Feed Item, Production Date, Diet Priority, Status. No Production Slot. One diet per loading BIN per production date; a second active diet for the same BIN and date is refused (Checkpoints rows 9 and 38).

15. **Feed planning tab in Company Settings**. Menu: Company Settings > Feed planning. Sheet rows: Forecast Engine r69; Feed Forecast r8; Requisition r27, r28, r35; Checkpoints r18, r23, r25, r31, r39. (Replaces the old Feed Planning tab, see B10.)
    - Default and Maximum forecast days (Checkpoints r18); Truck target (kg) and Bulk multiple (kg) (Requisition r27, r28); Production, Submission, Critical reminder, Physical-count and Tentative plan weekdays and times (Feed Forecast r8, Requisition r35, Forecast Engine r69, Checkpoints r23, r25, r39); Capacity warning (%); Bag tolerance (%) (Checkpoints r31).

---

## B. Changes to pages that already existed

### B1. Inventory > Feed Forecast (the page)
- Was one forecast screen with a Forecast and a Stages view; it is now eight tabs (Dashboard, Calculation, Feed Plan, Compare Report, Requisition, Feed Mill Consolidation, Feed Loading Instructions, Physical Stock Count). Feed Forecast r3-r12.
- Farm and forecast window are shared between Dashboard and Calculation, so the two always agree. Forecast Engine r67.
- Balances are labelled System Balance on Dashboard, Calculation, counts and requisitions. Checkpoints r40.
- The Stages view was removed (not a workbook row; see C).
- Old links `/inventory/feed-requisitions`, `/feed-loading`, `/feed-consolidations`, `/feed-alerts` now open the matching tab (see C).

### B2. Inventory > Feed Forecast > Calculation (was the "Forecast" view)
- Grid columns reshaped to the workbook's Output Detail: Batch, Stage, Shed Code, Silo Code, Silo Name, Required Feed Item, Current Silo Item, Head Count, KG/head/day Rate, Opening System Balance KG, Confirmed Receipts KG, Open Transfer KG, Planned Feed Added KG, Feed Requisition, Daily Use KG, First Shortage Date, Recommended Quantity KG, Delivery Date, plus one projected closing balance per date. Forecast Engine r22-r29, r70.
- Old columns removed: Current Inventory, Current Pigs, Per Day Intake, Days of Stock, Run Down, Date to Refill, Required On, Overdue. Forecast Engine r28, r29.
- View choices Daily, Weekly, Reporting Period and Custom with Planning Date and Date To. Forecast Engine r67; Feed Forecast r8.
- New buttons: Calculate, Save Run (Forecast Engine r68), Create from saved calculation (r30, see A4), View requisition. Delete calculation is in C.
- Notes panel now flags: missing future head counts, days with no or two feed rates, no silo holds the required diet, no next feed row. Forecast Engine r22, r23, r24, r26; Checkpoints r11.
- Recommended quantity and delivery date now come from the 9-step engine, not the old refill-days rule. Forecast Engine r29.

### B3. Inventory > Requisitions (feed requisitions), now Inventory > Feed Forecast > Requisition
The Inventory > Requisitions menu item no longer exists; the feed list and document moved into this tab.
- List: added Farm and Source columns, an All farms choice, status filter with the full status set (Auto-draft, Draft, Pending approval, Approved, Rejected, In consolidation, Released, Transfer open, Partially shipped, Shipped, Partially received, Received). Requisition r5-r10, r33.
- New Feed Requisition dialog: now a requisition header with many lines, each with Silo Code (Destination Silo), Feed Item, quantity, delivery date. Requisition r40-r56.
- Document header now shows: Requisition No., Requisition Date, Requisition Type, Source, Farm Code, Farm Name, Is Next Diet Requisition, Farm Total Requested KG, Bulk Truck Target KG (with truck trips), Bulk Order Multiple, Required Delivery Date, Supplier or Source, Requisition Purpose, Status, Priority (Farm Manager can escalate), Submission Deadline, Remarks, Approved By, Approval Date Time, Linked Transfer Order No. Requisition r5-r10, r16, r26-r39.
- Line columns now: Line No., Silo Code, Feed Item No., Feed Item Description, Feed Type, Mill Loading Bin No., Is Next Diet Line, Days Before Diet Change, Breed Lifecycle Row, System Balance KG, Daily Requirement KG, Days Remaining / First Shortage Date, Recommended Qty KG, Requested Qty KG, Bag Count, Proposed Delivery Date, Mill Approved KG, Previously received, Outstanding. Requisition r13-r25, r42-r56, r153-r155.
- Silo capacity warning on a line when order plus opening stock is over capacity. Requisition r52; Forecast Engine r62.
- Remarks are required when a quantity is more than 20 percent off the recommendation, an item is an exception, a date was moved, or the deadline has passed. Checkpoints r19, r21, r25; Requisition r83.
- Submit and Approve checks (own farm only, bulk multiple needs a reason, truck target is not a block). Checkpoints r19, r20, r22.
- Mill consolidation block on the document: Consolidation sheet, status, next action, and the mill's Requested KG and Adjustment Reason per line. Requisition r123, r126, r127.
- Auto-draft and the Draft from forecast action now raise the AUTO-DRAFTED alert and add the next-diet line to the same requisition. Requisition r80, r81.
- Reminders to unapproved drafts on Friday (REQ-REMINDER) and Saturday (REQ-OVERDUE). Requisition r84, r85; Checkpoints r23.

### B4. Alerts (main menu > Alerts)
- Feed alerts raised by the 18 default rules now appear here (low and high silo level, diet change, requisition reminder and overdue, plan available, dispatch, mill adjusted, receipt short, no next feed row, no silo for next diet, capacity exceeded, shortfall, not drafted, truck target, auto-drafted, stock take due, changeover). Master Setup r43-r56; Checkpoints r8, r9, r13-r16, r37; Requisition r74-r76, r80, r84, r85, r126.
- Alerts escalate to the next role after the configured hours and resolve when the cause clears. Master Setup r52, r53, r54; Checkpoints r15.
- A subject link column was added (see C).

### B5. Master Data > Location
**Silo form** (Master Setup r5-r20)
- Attached Sheds now has "Serves from" and "Serves until" dates per shed. Master Setup r8.
- Labels now match the file: Below Feed Level KG, Above Threshold KG. Master Setup r10, r12. Refill Lead Time (days) relabelled (not in the file; see C).
- Read-only silo facts added: Feed in Silo (opens the item), Available Stock KG, System Balance KG, Last Approved Physical Count KG and Date, Last Feed Receipt Date, First Shortage Date, Next Diet Change Date. Master Setup r13-r17, r19, r20.
- Silo can be blocked with the Active switch. Master Setup r18.
- A silo must be linked to a shed before it can be Active; a silo holds one feed item; changing the feed item needs an approved empty stock or a posted movement. Checkpoints r4, r5, r6, r7.
- Two silos on one shed cannot hold the same feed item (decision, see C).

**Farm and Mill forms**
- New Cost Centre field (cost centre every inventory journal for the farm or mill is posted against). Silo and Stock Take r47; Feed Forecast r3.

**MILL location (new variant of the Add/Edit Location dialog)**
- Mill Code, Mill Name, Daily Capacity TON, Hourly Capacity TON, Bulk Daily Allocation TON, Bagged Daily Allocation TON. The file names a Mill Capacity Master but gives no field table. Feed Forecast r11; Requisition r32, r67, r122, r125; Checkpoints r37, r38, r45.

**BIN location (new variant of the Add/Edit Location dialog)**
- Bin Code, Bin Name, Parent Mill, Bin Capacity TON, Feed Type (Bulk or Bagged). Requisition r32, r65, r67, r122; Checkpoints r9, r38.

### B6. Master Data > Item
- New Diet No. field (1 to 14), shown on loading sheets, consolidation and the compare report. Requisition r65, r67, r121 (named in the file, no row of its own).

### B7. Master Data > Breed > Lifecycle Stages
- Feed picker now lists feed items only; label Feed. Master Setup r38.
- New Feed Form (Bulk or Bagged). Master Setup r37.
- Label changed to Daily Feed per Head (kg). Master Setup r39.
- New Effective From and Effective To dates; rows for the same stage and days cannot overlap. Master Setup r30, r38.
- New Farm (override) field: a farm-specific row beats the default row. Master Setup r30, r39 (decision of 11 Oct).

### B8. Master Data > Alert Rules
- Event Type list grew from 4 to 17 events. Master Setup r45.
- Trigger Entity list grew from 4 to 8 (added Loading sheet, Consolidation, Feed receipt, Batch). Master Setup r46.
- Threshold Value help covers days-ahead and KG rules. Master Setup r47, r48.
- Recipient Role(s) and Escalation Recipient Role are now picked from the Role Master. Master Setup r50, r54.
- Delivery Channel is In app only (email deferred). Master Setup r51.
- Fields Code, Name, Priority Level, Frequency, Escalation After Hours, Active, Farm Filter follow the file's order. Master Setup r43, r44, r49, r52, r53, r55, r56.

### B9. Master Data > Reporting Periods
- Periods are generated as inactive July-June drafts and must be activated (new Status Draft or Active, Activate action). Checkpoints r43; Silo and Stock Take r36.
- New Period Status column and Close Period action; Close is refused until each farm and the mill with something to count has a posted Monthly Stock Take. Checkpoints r34; Silo and Stock Take r48.
- After close, POST Day for that period is blocked (Checkpoints r35).
- Stock Take Date and Production Start Date (Sunday after End) shown. Silo and Stock Take r37, r49.
- Reopen Period action and reopen reason: see C (being removed).

### B10. Settings > Inventory Setup
- The Feed Planning tab (per-farm lead time, bulk multiple, bag size, truck target, production weekday and, later, per-silo feed setup) was removed from this page; these settings are now on Company Settings > Feed planning (A15). Requisition r27, r28, r35.

### B11. Inventory > Transfers
- Each transfer shows its source: the requisition (feed or common), the Mill Consolidation sheet and the loading sheet(s), as links. Checkpoints r49; Silo and Stock Take r15, r18; Requisition r130, r136.
- A transfer that came from a feed requisition posts into the silo through the same shipment and receipt path as the requisition panel. Checkpoints r52.

### B12. Batches > Data Entry
- Empty bags entry on a bagged-feed consumption line, with a warning if bags times bag size differs from the quantity posted (warning only). Checkpoints r31.
- POST Day cannot take a silo below 0 KG. Checkpoints r17; Silo and Stock Take r7.
- POST Day is blocked in a closed reporting period. Checkpoints r35.
- POST Day consumption feeds the silo System Balance. Silo and Stock Take r7, r8.

### B13. Approvals > Pending / Approved / Rejected
- A feed requisition now opens as the full read-only document (header, lines, mill columns) instead of five columns; Approve takes the approver's remarks. Requisition r82, r83; Checkpoints r19, r21.

### B14. Finance > Journal
- Opening a stock count's GL Entry Reference now goes to that exact journal entry instead of the journal list. Silo and Stock Take r47.

### B15. Inventory > Goods Receipt
- A goods receipt (GRN) of feed into a silo is refused; feed arrives only by transfer receipt. Checkpoints r53; Requisition r132-r133.

---

## C. Not from the file

Reasons are from `docs/decisions.md` or Rishi's own requisition list (`common-requisition-spec.md`, 4 Oct 2026). "Unclear" means no decision explains it.

**Being removed**
1. **Reopen Period (being removed)**. Master Data > Reporting Periods action and reopen reason. Unclear: no decision found.
2. **Production shift setting (being removed)**. Company Settings > Feed planning, field "Production shift". Unclear: no decision or row.
3. **Silo Feed Setup (being removed)**. Company Settings > Feed planning, table of silos by farm (feed type, feed item, capacity, status). Decision 2026-09-30 "Stage parity, company-owned Number Series and Silo Feed Setup"; decision 2026-10-01 says remove it once the Silo record has parity.

**Screens and flows that exist because of Rishi's common requisition list or a decision**
4. **Requisition (main menu), list, New requisition dialog, document, Link PO, Reopen, Direct Transfer, Transfer Shipment, Transfer Receipt**. Rishi's common list; decisions 2026-10-04 and 2026-10-05 (own menu item, Item / Fixed Asset / Service) and 2026-10-08 "Final common requisition field and workflow contract".
5. **Item Tracking dialog (lot or serial per line)**. Rishi's list ("Item Tracking button"); decision 2026-10-05.
6. **Approvals: common requisition rows and read-only detail**. Decision 2026-10-07 "Common requisitions in Approvals".
7. **Inventory > Transfers > Receive stock page**. Shared Transfer Receipt; decision 2026-10-09 "Transfer Order and Receipt are shared".
8. **Release button and Transfer Shipment panel (Ship now KG, Post shipment, Posting date) on the feed requisition**. The workbook has Business Central ship the Transfer Order; decisions 2026-10-03 (in-house mill) and 2026-10-08 "Feed requisitions continue through in-house transfer fulfilment".
9. **Delete calculation** (archives a saved run, one current saved run per farm). Decision 2026-10-08 "Feed Forecast pages, saved calculations and planned incoming stock".
10. **Open Transfer KG, Planned Feed Added KG and Feed Requisition columns on Calculation**. Same decision 2026-10-08 (planned incoming stock). The file only asks that expected and confirmed receipts are tracked apart (Forecast Engine r28).
11. ~~**Master Data > Location > Production Slots tab**~~ (removed 11 Oct: not in the workbook). Decisions 2026-10-05 "MILL location and real loading-bin source" and 2026-10-08 "Mill BIN release setup stays in the shared master framework".
12. **Location Types: MILL and BIN rows**. Decision 2026-10-05 (makes them selectable).
13. **Department field on the Location form and Department cost centres**. Rishi's list ("User Setup defines department"); decision 2026-10-01.
14. **Team member dialog: Department and Direct Transfer right**. Rishi's list.
15. **Company Settings > Feed planning: Farm order quantity overrides** (truck target and bulk multiple per farm). Decision 2026-10-08 (item 2).
16. **Company Settings > Feed planning: Finance variance (%) and amount**. Decision 2026-10-01 (escalation at 5 percent); differs from Checkpoints r36 (2 percent).
17. **Company Settings > Feed planning: Capacity warning (%)**. Decisions 2026-09-30 and 2026-10-01 (default 90).
18. **Company Settings > Roles: new permission rows** (Feed Stock Count, BIN Diet Assignments, Stock Variance; the Production Slots row was removed 11 Oct). Supporting, for the new screens.
19. **Reason Master used for stock variance and feed-line Reason**. Decisions 2026-10-01 and 2026-10-07 (screen choice, not free text).
20. **Redirects from old feed links to the tabs and to Alerts**. Supporting; keeps bookmarks working (decision 2026-10-04).

**Extra items on screens that are in the file**
21. Dashboard: Planning Date, Shed and Silo pickers (decision 2026-10-05); charts "Projected closing balance" and "Current and next diet demand" with data tables; the Field / Value detail table (decisions 2026-10-04 and 2026-10-05); the silo Status chip (Critical under 3 days, Warning under 7 days) - Unclear.
22. Calculation: time zone line, past planning date note, Generate July-June drafts button, Stage column, Silo Name column (decisions 2026-09-27 Q8, Q9, Q14; 2026-10-06; 2026-10-04).
23. Feed Plan: Production Date input and Generate plan button (supports Forecast Engine r69 "manual rerun"); Projected Target KG, Adjustment Factor, Mill Approved KG and retained versions list (decisions 2026-10-08 "Retained weekly Feed Plan", 2026-10-09).
24. Compare Report: Diet Priority, Feed Type, Farms columns, capacity summary tiles (decision 2026-10-05); Mill and Period selectors; **Export CSV** - Unclear.
25. Requisition: Requester User ID, Requester Name, Requester Department on the feed header (Rishi's list, decision 2026-10-05); bagged total requested; line Reason; Batches and sheds breakdown per line (decision 2026-10-03); forecast Run reference; Save and Submit buttons in the dialog footer (decisions 2026-10-07, 2026-10-08).
26. Mill Consolidation: Mark reviewed and Finalize buttons, loading sheet column (decisions 2026-10-09; REVIEWED is a value of Requisition r128).
27. Loading Instructions: Estimated Arrival typed by the mill, "Shipment pending" message (decisions 2026-10-11 and 2026-10-09).
28. Physical Stock Count: Status Draft / Submitted / Approved / Posted with Open approval link, weekday and time check on a scheduled count, variance reason from the Reason Master (decisions 2026-09-30 and 2026-10-01).
29. Reporting Periods: Business Year column. Supporting.
30. Silo form: Silo Capacity UOM (KG or TON) and Refill Lead Time (days). Decision 2026-09-24 and 2026-10-03 item 6; both existed before the workbook.
31. Alerts page: Subject column linking the silo, requisition or batch, and the farm link. Rishi's "readable and linked" rule in the final audit.
32. Alert Rules master: Company (read-only scope). System field.
33. Rules the workbook does not ask for: over-receipt stays blocked (decision 2026-10-10, departs from Checkpoints r32); a silo and item can be requisitioned again only after the earlier requisition is Received; Release needs a finalized consolidation and an active BIN assignment (decisions 2026-10-09); receipt delivery note optional; no self-approval except admins; Transfer Shipment and Receipt department checks (Rishi's list; decisions 2026-10-04, 2026-10-11).
34. Scheduler run log, five-minute tick, back-off after 3 failed runs, manual run endpoint (migration 0167, supporting).

---

Counts: A = 15 new pages, tabs and dialogs. B = 15 changed pages with 60 change bullets. C = 34 entries (3 being removed).
