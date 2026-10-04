# Feed TDD workbook — every field, page by page

Source: `NAVFarm_Feed forecast TDD with examples (1).xlsx` (main checkout root `/Users/nero/Desktop/navfarm`). Generated verbatim from the workbook on 2026-10-04 so an agent never has to re-read the xlsx. The **Example** column (workbook column F, "Illustrative example data") is EXAMPLES ONLY — never client data or defaults (AGENTS.md). Row numbers are the workbook's own; cite them as `<Sheet> row N`.

## Sheet: Feed Forecast

**Row 1:** DESIGN PRINCIPLES - FLEXIBLE AND CONFIGURABLE, NOT HARDCODED — Illustrative example data

| Row | Principle | What It Means | NAVFarm Implementation | Flexibility Level | Sample only. Replace with customer approved master data and transactions. | Example (illustrative) |
|---|---|---|---|---|---|---|
| 3 | Farm wise segregation | Each of the 10 farms runs its own independent feed forecast, silo tracking and requisition. | Feed forecast engine filters by Farm Code. Silo Master is farm-specific. Requisition raised per farm. Farm Cost Centre dimension auto applied. | HIGH - fully isolated per farm | GRS forecast and requisitions are isolated from the other nine farms. |  |
| 4 | Silo physical item and house demand | Silo Feed Item No identifies the feed physically held. Breed Lifecycle Stage Config determines the feed required by each batch and day. One silo can serve multiple houses only when allocation and diet compatibility are defined. The item tag can change after old stock is cleared or approved adjustment or transfer is posted. | Location Master holds current physical Feed Item No and Feed Type. Forecast separately calculates required item from batch lifecycle. Receipt validates item against silo tag. Upcoming diet is planned against a designated destination silo, or flagged for approved changeover before receipt. | Configurable with controlled changeover | SILO1 holds FEED-R1. SILO2 holds FEED-R2. Both serve House H3; diet need comes from batch WG-2026-38. |  |
| 5 | Breed lifecycle drives dated demand | For each forecast day and batch location, determine projected head count, line, stage and day or age, then select the effective lifecycle feed row. Split demand by feed item whenever a row or stage changes. | Calculate daily feed requirement per batch and house; aggregate by feed item and physical destination silo. Preserve old and next diet lines separately. | Configurable | 23 to 25 Sep: 1,000 pigs times 2.0 KG per day of R1. 26 to 29 Sep: 1,000 times 2.5 KG per day of R2. |  |
| 6 | Next diet planning | If a lifecycle feed period ends within the selected forecast date range, take the next effective feed row and calculate demand from its start date. The current silo item tag does not determine the next required diet. | Show next item, effective date, required quantity and proposed receiving silo. If the silo still holds another item, flag a changeover task; do not post mixed items into one silo. | Configurable | R1 ends 25 Sep. R2 begins 26 Sep. Plan R2 separately against SILO2. |  |
| 7 | Tentative and actual plans | Tentative plan uses five completed weeks of posted consumption, adjusted for future head count and diet changes. Actual plan uses approved requisitions as they arrive. Preserve run versions. | Wednesday may default for tentative generation. Actual updates on farm approvals; no Wednesday overwrite of approved quantities. | Configurable | Tentative R1 7,000 KG and R2 8,000 KG. Approved actual R1 6,000 KG and R2 9,000 KG. |  |
| 8 | Flexible forecast dates and schedule | Forecast runs for a user selected day, week, reporting period or custom From Date and To Date. Daily results underpin every view. Wednesday is a configurable scheduled run; manual rerun is available. | Controls include view, dates or reporting period, farm, house, batch, silo, feed item, bulk or bagged, and plan type. Sunday stock check is a configurable customer default, not a forecast restriction. | Configurable | Run on 23 Sep for 23 to 29 Sep, Weekly view. Reporting Period view uses configured period dates. |  |
| 9 | NAVFarm notification master | Feed alerts, mill plan request and dispatch messages are issued through NAVFarm in app and configured email channels. No NAVFarm notification dispatch integration. | NAVFarm Alerts and Notifications Master owns events, thresholds, recipient roles, channels, repeat rules and escalation. | Configurable | FEED-BELOW-L1 alerts Farm Manager in NAVFarm. TO shipment sends NAVFarm dispatch notification. |  |
| 10 | Monthly stock take - reporting period driven | One stock take per month on the defined month-end Saturday. Covers all farms and Feed Mill. Business year runs July to June. Reporting periods defined in NAVFarm or imported from D365BC. | Reporting Period Master in NAVFarm: Period Code, Start Date, End Date (month-end Saturday), Stock Take Date, Production Start Date (Sunday after month-end). Stock Take module on Farm Stock page: increase or decrease function. | HIGH - period dates configurable | September 2026 period: 23 Aug to 26 Sep; count on 26 Sep. Example dates require customer confirmation. |  |
| 11 | Mill capacity awareness | Feed Plan considers mill capacity. Highest demand diets produced first. One diet per loading bin. | Mill Capacity Master: capacity in tons per day and per hour, diet priority order, bin assignment. Compare Report: all farm demand vs mill capacity per diet. | HIGH - mill capacity configurable in master | Mill available 238,000 KG per day, with 178,000 KG bulk and 60,000 KG bagged allocation. |  |
| 12 | Farm approval, mill consolidation, BC transfer and NAVFarm receipt | Forecast creates draft feed requisition in NAVFarm. Farm Manager approves. Feed Mill Manager consolidates approved farm requests on one NAVFarm sheet, reviews capacity and approves push to BC. BC produces feed, creates and ships Transfer Orders. Shipped TO data returns to NAVFarm; farm posts received quantity against TO or linked requisition. No feed GRN. | Preserve requested, mill approved, BC shipped, farm received and outstanding quantity per requisition line. One receipt posting path and unique BC TO line reference prevent duplicates. | Configurable | Two approved farm lines of 6,000 and 9,000 KG; mill consolidation 15,000 KG; BC ships TO; farm posts actual received quantities. |  |

## Sheet: Master Setup

**Row 1:** NAVFarm TDD - Feed Forecasting: Master Data Setup - All Configuration Tables — Illustrative example data

**Row 2:** 1. LOCATION MASTER - SILO LEVEL (Farm -> House -> Silo hierarchy) — Sample only. Replace with customer approved master data and transactions.

**Row 3:** A silo is a physical stock location linked to one or more houses. Feed Item No is its currently designated physical feed, not the feed demand driver. Lifecycle rows determine required item per batch and forecast date. A silo may change its designated item after verified empty stock or approved stock movement and an authorized changeover. A house may have multiple silos.

| Row | Field Name | Type / Options | Description and Business Rule | Mandatory | Flexible | Example (illustrative) |
|---|---|---|---|---|---|---|
| 5 | Location Code | Manual | Unique code per silo. Format: FarmCode-HouseCode-SILOx. Example: GRS-H3-SILO1. | Y |  | GRS-H3-SILO1; second record GRS-H3-SILO2 |
| 6 | Location name | Text 50 | Descriptive name. Example: Grasmere Weaner House 3 Silo 1. | Yes | Free text | Grasmere H3 Silo 1; second record Grasmere H3 Silo 2 |
| 7 | Location Level | Fixed = SILO | Identifies this location record as a silo. Drives silo-specific fields. | Auto | Fixed | SILO |
| 8 | House Code and silo house mapping | Lookup plus mapping table | Parent house is shown for navigation; silo house mapping is authoritative for multiple houses. Define each batch house allocation and effective dates. | Yes | Multiple houses supported | Parent GRS-H3. Mapping rows: H3 to SILO1 and H3 to SILO2. |
| 9 | Silo Capacity KG | Decimal | Physical maximum capacity of this silo in KG. | Yes | Configurable | 12,000 KG for each silo |
| 10 | Below Feed Level KG | Decimal | Single low feed threshold for this silo and its current feed item. When posted System Balance is less than or equal to this quantity, issue the first priority low feed alert using NAVFarm Alerts and Notifications Master. | Yes | One configurable low threshold per silo | 1,000 KG for SILO1; 1,000 KG for SILO2 |
| 11 | Physical Count Date Time | Date time default now | Actual observation date and time in farm time zone. Any day is allowed with appropriate access; month end stock take uses configured reporting period end. | Yes | Cannot post before prior closed period |  |
| 12 | Above Threshold KG | Decimal | When System Balance rises above this, an INFO notification fires - over-stock, do not order. Typically 90% of silo capacity. | Yes | Configurable per silo | 10,800 KG for each silo |
| 13 | Last Approved Physical Count (KG) | Derived from stock count ledger | Read only latest approved dated stock count for the silo and item. Weekly Sunday or Saturday count is configurable; do not overwrite a master stock field. | Auto | Dated count history | SILO1 R1: 1,500 KG at approved count on 22 Sep; SILO2 R2: 1,000 KG. |
| 14 | System Balance KG | Calculated ledger balance | Opening approved stock plus posted TO receipts minus POST Day feed consumption plus or minus approved adjustments, by silo and feed item. Weekly count creates a variance for approval and does not silently reset balance. | Auto | Ledger derived | SILO1 R1 1,500 KG; SILO2 R2 1,000 KG before shipments. |
| 15 | Days to First Shortage "" | Date based calculation | Determine first shortage date from dated item level projection. Balance divided by current daily demand is indicative only when consumption changes. | Auto | Daily forecast | R1 shortage on 23 Sep without receipt; R2 shortage on 26 Sep without receipt. |
| 16 | Feed in Silo | Data Based Calculation | Last recieved item code will be updated based on the last enty of transfer recieved on that perticular silo, Validation is requried while receiving the feed throutht transfer reciept system need to check the current feed in silo feed should be zero. | Auto |  |  |
| 17 | Avilable stock | Data Based Calculation | system should check the feed item in feed in silo and featch the remaining stock from the inventroy ledger of feed in silo item. | Auto |  |  |
| 18 | Blocked | Boolean | Active and inactive | Auto | Manageable | ACTIVE |
| 19 | Last Feed Receipt Date | Date auto | Date of last posted TO receipt. No GRN for feed. | Auto | Audit | 22 Sep 2026 for prior posted TO receipt |
| 20 | Next Diet Change Date | Derived by batch | Next effective feed row date from lifecycle configuration by batch and house. Multiple dates may exist for one silo serving multiple houses. | Auto | Read only | 25 Sep 2026 for H3 batch R1 ending; R2 starts 26 Sep |

**Row 21:** 2. ITEM MASTER - FEED ITEM SETUP (Fields relevant to feed forecasting)

**Row 22:** Feed items are created in D365BC and synced to NAVFarm via Item Master sync (NavFarm Item Boolean = True). Item Type = FEED BULK or FEED BAG. Both sync to NAVFarm. Feed items are NOT tagged to silos at Location Master level. Diet for each silo is identified at runtime via: batch in linked house -> Breed Lifecycle Stage Config -> Feed Item. Item Master carries Diet No. for mill planning and Compare Report purposes.

| Row | Field Name | Type / Options | Description and Business Rule | Mandatory | Source | Example (illustrative) |
|---|---|---|---|---|---|---|
| 24 | Item No. | Text 20 | Item code from D365BC. Synced to NAVFarm. | Yes | D365BC - synced | FEED-R1; second item FEED-R2 |
| 25 | Item Description | Text 100 | Description. Example: Weaner Diet R2, Gestation Diet R1. | Yes | D365BC - synced | Weaner Diet R1; second item Weaner Diet R2 |
| 26 | Item Type | Feed | Only feed items can be selected for silo designation and feed forecasting. Feed receipts use BC Transfer Orders and NAVFarm TO receipt, not a GRN. | Yes | D365BC | FEED BULK |
| 27 | Base UOM | Text - KG | Unit of measure. All feed items in KG. | Yes | D365BC - synced | KG |
| 28 | Sync to NAVFarm | Boolean | BC feed/ item must be synchronized before tagging a silo, planning or posting a receipt. | Yes | D365BC | TRUE for FEED-R1 and FEED-R2 |

**Row 29:** 3. BREED LIFECYCLE STAGE CONFIG - Feed rate master driving all forecast calculations

**Row 30:** This is the most important master for feed forecasting. Defines: what Feed Item, what KG per head per day, from which day to which day, for each Line and Stage. The forecast engine reads this master to: (a) calculate daily feed requirement, (b) identify when the current feed period ends, (c) automatically pick the next feed item for the next period, (d) split the forecast across old and new feed items when a changeover falls within the forecast window. Farm-level override supported. Future-dated rows for advance diet change planning.

| Row | Field Name | Type / Options | Description and Business Rule | Mandatory | Flexible | Example (illustrative) |
|---|---|---|---|---|---|---|
| 32 | Line Code | Lookup - Breed/Line Master | L-LINE, Z-LINE, TN70, TEMPO. Config is per Line - different breeds have different feed rates at same stage. | Yes | Per Line | L-LINE |
| 33 | Stage Code | Lookup - Stage Master | QUARANTINE, GILT_REARING, DRY_PERIOD, GESTATION, LACTATION, FARROWING, WEANER, GROWER. | Yes | Per Stage | WEANER |
| 34 | Calculation Unit | Option field | Week, Day, Month | Yes |  |  |
| 35 | Period From | Integer | Stage at which this feed row starts. Example: Day 1 = start of stage. Day 29 = after first 28 days. | Yes | Configurable | 25 for R1 example row; 28 for R2 row |
| 36 | Period To | Integer | Stage at which this feed row ends. Example: Day 28 = end of first feeding period in gestation. | Yes | Configurable | 27 for R1 example row; 31 for R2 row |

**Row 37:** feed bulk /bagged

**Row 38:** Feed Item No. — Feed item lookup — Prescribed feed for this line, stage and inclusive day range. Determines demand for every forecast date; it is independent from the current physical silo item tag. — Yes — Effective dated — FEED-R1 for stage days 25 to 27; FEED-R2 for days 28 to 31

**Row 39:** Feed Rate KG per Day/Per Animal — Decimal — Standard feed consumption per animal per day. Daily Requirement = Head Count multiplied by this rate. Used directly in all forecast calculations. — Yes — Configurable - farm override supported — 2.0 KG per head per day for R1; 2.5 for R2

**Row 40:** 4. ALERTS AND NOTIFICATIONS MASTER - All notification rules in NAVFarm

**Row 41:** All feed notifications are configured in the NAVFarm Alerts and Notifications Master. It defines events, one low feed threshold reference, any high stock threshold, recipient roles, channels, frequency and escalation. Mill dispatch sends NAVFarm in app notification and configured email. WhatsApp is excluded.

| Row | Field Name | Type / Options | Description and Business Rule | Mandatory | Flexible | Example (illustrative) |
|---|---|---|---|---|---|---|
| 43 | Notification Code | Text 20 - Auto | Unique code per notification rule. Example: FEED-BELOW-L1, FEED-ABOVE, DIET-CHANGE, REQ-OVERDUE. | Auto | Auto | FEED-BELOW-L1 |
| 44 | Notification Name | Text 100 | Descriptive name. Example: Feed Level Below First Priority Threshold. | Yes | Free text | Low silo feed, first priority |
| 45 | Event Type | Configured code | Feed low, feed above threshold, upcoming diet, requisition deadline, plan available, mill dispatch, receipt variance, stock take due and BC synchronization failure. Only one low feed event applies per silo. | Yes | Extensible | FEED_BELOW_L1; separate MILL_DISPATCH event |
| 46 | Trigger Entity | Dropdown | SILO or REQUISITION or FEED_PLAN or STOCK_TAKE. Which entity triggers this notification. | Yes | Per entity | SILO for low stock; TO_SHIPMENT for dispatch |
| 47 | Threshold Value | Decimal or Integer or Text | The value at which this notification fires. For FEED_BELOW_L1: references Below Threshold Level 1 KG from Silo Master. For DIET_CHANGE_UPCOMING: number of days before changeover. For REQ_SUBMISSION_DEADLINE: number of days before Saturday. | Yes | Configurable per rule | 1,000 KG from SILO1 master |
| 48 | Threshold Reference | Dropdown | SILO_BELOW, SILO_ABOVE, FIXED_VALUE. SILO_BELOW reads the single Below Feed Level KG on Location Master. | Yes | Flexible - per silo or fixed | SILO_BELOW_L1 |
| 49 | Priority Level | Dropdown | CRITICAL_FIRST_PRIORITY, CRITICAL, WARNING, INFO. FEED_BELOW uses CRITICAL_FIRST_PRIORITY. Other event priorities are configured separately. | Yes | Configurable | CRITICAL_FIRST_PRIORITY |
| 50 | Recipient Role(s) | Multi-select - Role Master | Which user roles receive this notification. Example: FARM_MANAGER, HEAD_OF_FARM, SYSTEM_ADMIN, FINANCE, MILL_MANAGER. | Yes | Multiple roles selectable | FARM_MANAGER; escalation HEAD_OF_FARM |
| 51 | Delivery Channel | IN_APP, EMAIL, SMS or combination | NAVFarm in app default; email if configured. Mill to farm dispatch uses this master. NAVFarm notification is excluded. | Yes | Configured | IN_APP and EMAIL |
| 52 | Frequency | Dropdown | ONCE, DAILY, ON_EACH_OCCURRENCE, ESCALATING. ESCALATING = first notification + repeat every X hours if not acknowledged. | Yes | Configurable | ONCE until resolved; escalate after 4 hours |
| 53 | Escalation After Hours | Integer | If Frequency = ESCALATING: escalate to next recipient role after this many hours if notification not acknowledged. | Conditional | Configurable | 4 |
| 54 | Escalation Recipient Role | Lookup - Role Master | Which role gets escalation notification. Example: FEED_BELOW_L1 escalates from FARM_MANAGER to HEAD_OF_FARM after 4 hours. | Conditional | Configurable | HEAD_OF_FARM |
| 55 | Active | Boolean - default True | If False, this notification rule is disabled. Allows temporary suppression without deleting the rule. | Yes | Configurable | TRUE |
| 56 | Farm Filter | Lookup - Farm Master or ALL | If set to a specific farm, this rule applies only to that farm. ALL means rule applies to all farms. | No | Per farm or global | GRS |

## Sheet: Feed Forecast Engine

**Row 1:** NAVFarm TDD - Feed Forecast Engine: Calculation Logic, Physical Stock Count and Dashboard — Illustrative example data

**Row 2:** Feed Forecast Engine runs in NAVFarm for scheduled or user selected date ranges. Physical count is a separate dated transaction. Recalculate after POST Day, approved stock adjustment, TO receipt, or lifecycle change; preserve prior approved runs and requisitions. — Sample only. Replace with customer approved master data and transactions.

**Row 3:** SECTION 1: PHYSICAL STOCK COUNT AND FORECAST FILTERS

**Row 4:** Record a dated physical silo count on the configured schedule or on demand. Sunday is the Triple-C default only. User selects daily, weekly, reporting period or custom dates for forecast. Monthly uses defined reporting period dates, not calendar month name alone.

| Row | Page Field | Type | Description and Business Rule | Mandatory | Validation | Example (illustrative) |
|---|---|---|---|---|---|---|
| 6 | Farm Code | Auto from User Setup | Auto-filled from Farm Manager logged-in user. Cannot change to another farm. | Auto | User Setup validation |  |
| 7 | Farm Name | Auto | Auto-filled from Farm Master. | Auto |  | Grasmere |
| 8 | Silo Code | Lookup - filtered | Only ACTIVE silos belonging to this Farm Code shown. | Yes | Farm Code filter applied | GRS-H3-SILO1; separate line GRS-H3-SILO2 |
| 9 | Silo Name | Auto | From Location Master. | Auto |  | Grasmere H3 Silo 1 |
| 10 | House Shed(s) Linked | Auto | Shows which houses this silo feeds. From Silo-House mapping. | Auto |  | GRS-H3 |
| 11 | Silo Feed Item No. | From physical silo designation | Current feed item physically held in the silo. Show required feed by batch separately; these may differ before a controlled changeover. | Auto | Receipt and stock ledger | FEED-R1 on SILO1; FEED-R2 on SILO2 |
| 12 | Current Diet Description | Auto - from Item Master via Breed Lifecycle Config | Description of current feed item derived from Breed Lifecycle Stage Config. Auto-filled. | Auto |  | Weaner Diet R1 from 23 to 25 Sep; Weaner Diet R2 from 26 Sep |
| 13 | Silo Capacity KG | Auto | Read-only from Location Master. | Auto |  | 12,000 KG each |
| 14 | Current Balance Stock (KG) | Auto - display only | Current system balance before this entry. | Auto |  | SILO1 R1 1,500 KG; SILO2 R2 1,000 KG |
| 15 | Projected Shortfall (KG) | Auto - calculated on entry | 7-day forecast requirement minus Current Stock Count. Shows whether requisition will be auto-drafted. | Auto |  | R1: 6,000 minus 1,500 equals 4,500 KG. R2: 10,000 minus 1,000 equals 9,000 KG. |
| 16 | Next Diet Change in X Days | Auto - display only | Days remaining before current feed period ends for batches in linked house. Pulled from Breed Lifecycle Stage Config via batch current day in stage. | Auto | Warning if less than or equal to 7 days | R1 period ends after 25 Sep; R2 starts 26 Sep |
| 17 | Next Feed Item when change falls within selected forecast range | Auto - display only | If diet change within forecast window: shows next Feed Item No. and description. Pre-alerts Farm Manager. | Auto |  | FEED-R2 on 26 Sep |
| 18 | Save Count and Submit Variance | Action | Save dated count. If different from system balance, route variance through physical inventory approval and post stock adjustment in NAVFarm and BC. Then rerun forecast using posted ledger balance. | Required | No silent reset | Save two dated observations; no adjustment if they equal system balance |

**Row 19:** SECTION 2: FEED FORECAST CALCULATION - 9-step engine with automatic next-feed pickup

**Row 20:** Calculate per forecast date, farm, batch, house, required feed item and destination silo. View controls are daily, weekly, reporting period and custom From Date to To Date. Date grouping never changes underlying daily calculation.

| Row | Step | Calculation and Logic | Source Table | Output | Notes | Example (illustrative) |
|---|---|---|---|---|---|---|
| 22 | Step 1 Get active and expected batches | Use batch house assignments with effective dates. Apply scheduled transfers, stage transitions and recorded mortality as applicable; flag missing future assumptions. | production_batch and batch_location | Projected population by date | Do not duplicate batch heads across houses | WG-2026-38, 1,000 heads in GRS-H3 |
| 23 | Step 2 Project head count | Start with latest posted closing count per batch and house. Apply known dated movements. Show forecast assumptions when future movements are unknown. | posted daily entry and transfer records | Head count by date | Date and provenance visible | 1,000 heads on every forecast day; no known transfers or deaths |
| 24 | Step 3 Select feed by lifecycle date | Use line, stage, day or age, farm override and effective dates for each forecast date. Validate unique applicable row; missing or overlapping rows block affected line. | breed lifecycle stage config | Required item and rate by date | Current silo tag is not the diet source | Stage day 25 on 23 Sep: R1 2.0 KG. Stage day 28 on 26 Sep: R2 2.5 KG. |
| 25 | Step 4 Calculate daily demand | Head count multiplied by effective KG per head per day for each batch house and required item. Aggregate separately by diet and destination silo. | Steps 1 to 3 | Daily demand KG | No double counting shared silos | 23 to 25 Sep: 2,000 KG R1 per day. 26 to 29 Sep: 2,500 KG R2 per day. |
| 26 | Step 5 Determine next diet | When feed day range or stage changes within the selected horizon, select next effective lifecycle row and start planning new item on its effective day. Flag destination silo that holds different item. | Lifecycle config and silo stock | Next diet start and allocation | Authorized silo changeover required | FEED-R2 begins on 26 Sep; SILO2 already designated FEED-R2 |
| 27 | Step 6 Build dated forecast | Compute each day separately. Group daily demand into week, reporting period or custom range. Current and next diet remain separate lines even if both are BULK. | Daily forecast lines | Daily and grouped output | No fixed seven day engine | R1 3 days times 2,000 equals 6,000 KG; R2 4 days times 2,500 equals 10,000 KG. |
| 28 | Step 7 Project item stock and shortage | Opening ledger balance by silo and feed item plus confirmed incoming TO quantities by expected receipt date minus daily use. Track expected versus confirmed receipts separately; earliest projected negative day is shortage date. | Stock ledger and BC TO sync | Projected closing KG and shortage date | No GRN for feed | Opening SILO1 R1 1,500 KG and SILO2 R2 1,000 KG; no inbound TO at initial run. |
| 29 | Step 8 Recommend refill | Recommend quantity by item and required date using shortage, configured safety stock, silo free capacity and confirmed inbound. Bulk rounding defaults to 3000 KG per compartment; 30000 KG is truck target, not hard farm cap. Bagged rounds to 50 KG. | Forecast and configurable logistics defaults | Order KG and bags | More than one trip possible | R1 shortage 4,500 KG rounds to 6,000 KG. R2 shortage 9,000 KG stays 9,000 KG. Buffer zero in worked example. |
| 30 | Step 9 Draft requisition | Create or update linked draft lines per farm, batch, house, destination silo, item and required date. Preserve run ID and avoid duplicate drafts on rerun. Never push draft directly to BC. | Forecast run and requisition | AUTO_DRAFT | Mill consolidation after farm approval | Draft lines REQ-GRS-2026-00041-L1 R1 6,000 KG and L2 R2 9,000 KG. |

**Row 31:** SECTION 3: FEED PLAN - Tentative vs Actual (Wednesday planning cycle)

**Row 32:** Wednesday scheduled tentative plan uses five completed weeks of posted feed consumption, with known animal and diet changes shown separately. Actual plan reflects farm manager approved requisitions and updates on approval. Both retain run versions.

| Row | Field Name | Type | Description and Business Rule | Plan Type | Mandatory | Example (illustrative) |
|---|---|---|---|---|---|---|
| 34 | Plan Code | Auto | Unique plan identifier. Format: PLAN-FarmCode-YYYYWW. Example: PLAN-GRS-202638. | Both | Auto | PLAN-GRS-202639-R01 |
| 35 | Plan Type | Dropdown | TENTATIVE or ACTUAL. Both generated and stored per farm per week. | N/A | Yes | TENTATIVE; ACTUAL on separate plan version |
| 36 | Farm Code | Lookup | Which farm this plan is for. | Both | Yes | GRS |
| 37 | Plan Week YYWW | Text - Auto | Week this plan covers. Example: 2638 = year 2026 week 38. | Both | Auto | 202639; production cycle example |
| 38 | Feed Item No. | Lookup | Which diet this plan line covers. | Both | Yes | FEED-R1 line; FEED-R2 line |
| 39 | Tentative Quantity KG | Calculated | Five completed weeks of posted consumption by farm and diet, normalized to comparable days and adjusted for known projected population and lifecycle diet changes. | TENTATIVE | Auto | R1 7,000 KG; R2 8,000 KG, illustrative historic average |
| 40 | Actual Requested Quantity KG | Approved requisitions | Sum of farm approved requisition quantities by farm, diet and delivery period. Refresh on approval and mill adjustments, retaining both requested and mill approved amounts. | ACTUAL | Auto | R1 6,000 KG; R2 9,000 KG after approval |
| 41 | Variance Actual vs Tentative | Decimal - Auto | Actual minus Tentative. Positive means more ordered than history. Negative means under-ordering. | Both | Auto | R1 minus 1,000 KG; R2 plus 1,000 KG |
| 42 | Mill Capacity Available KG | Decimal - from Mill Master | Mill output available for this diet based on priority and bin assignment. | Both | Auto from Mill Capacity Master | Diet 1 allocation 20,000 KG for selected production day, illustrative |
| 43 | Plan vs Mill Capacity | Computed | GREEN if Actual is less than or equal to Mill Capacity. AMBER if Actual is 90 to 100% of capacity. RED if Actual exceeds capacity. | Both | Auto - drives Compare Report | GREEN for Diet 1 demand 12,000 of 20,000 KG |
| 44 | 5-Week History Rolling Dataset | Reference table | Rolling 5 weeks of actual daily consumption per farm per diet. Updated daily from POST Day entries. Used to generate TENTATIVE plan every Wednesday. | TENTATIVE | Auto - from POST Day | Five completed weeks of posted consumption ending 22 Sep; sample averages are illustrative |

**Row 45:** SECTION 4: FEED FORECAST DASHBOARD - Farm Manager view per farm per silo

| Row | Dashboard Field | Type | Description | Notification Trigger | Col5 | Example (illustrative) |
|---|---|---|---|---|---|---|
| 47 | Farm | Auto User | Farm Managers own farm. Read-only. |  |  | GRS |
| 48 | House Shed | Display | Which house each silo is attached to. |  |  | GRS-H3 |
| 49 | Silo Code | Display | Silo identifier. Clickable - opens Silo detail. |  |  | GRS-H3-SILO1; next row SILO2 |
| 50 | Current Diet Feed Item | Display - Auto from Breed Lifecycle Config | Current diet for batches in linked house. Derived from Breed Lifecycle Stage Config at runtime. Not a fixed tag on silo. | Notification if diet changing within 3 days |  | R1 currently prescribed; R2 begins 26 Sep |
| 51 | Mill Loading Bin No. | Display | Which mill bin this diet uses. |  |  | BIN01 for R1; BIN04 for R2 |
| 52 | Silo Capacity KG | Display | Physical maximum capacity. |  |  | 12,000 KG per silo |
| 53 | System Balance KG | Display - Auto | Calculated balance. Always labelled SYSTEM BALANCE. | CRITICAL FIRST PRIORITY if at or below the single Below Feed Level KG. INFO if at or above the separate high stock threshold. |  | R1 1,500 KG on SILO1; R2 1,000 KG on SILO2 |
| 54 | Daily Requirement KG | Display - Auto | Total daily feed need for all batches drawing from this silo. |  |  | R1 2,000 KG per day through 25 Sep; R2 2,500 KG from 26 Sep |
| 55 | Days of Feed Remaining | Date based display | Show first forecast date with stock shortage by item and silo; simple balance divided by daily rate is only an indicative display when rate changes. | Below 3 days = first priority. Below 7 days = warning. Above 7 days = normal. |  | R1 shortage on 23 Sep without receipt; show date rather than constant days rate |
| 56 | Projected Need for Selected Range KG | Display - Auto | Total daily demand over the user selected range, broken out by old and next feed item. Weekly and monthly views only group the underlying dated lines. |  |  | R1 6,000 KG plus R2 10,000 KG equals 16,000 KG demand |
| 57 | Current Diet Days Remaining | Display - Auto | Days before current feed period ends for batches in linked house. From Breed Lifecycle Stage Config. | Notification when 3 days or less |  | R1 ends 25 Sep; 3 days of R1 demand in selected week |
| 58 | Next Diet Feed Item | Display - Auto | Show each next lifecycle feed item whose start date falls within the selected range, including a monthly reporting period. | Notification when changeover detected |  | FEED-R2 from 26 Sep |
| 59 | Silo Available for Next Diet Feed Type | Display - Auto | Shows whether an ACTIVE silo at this house has Feed Type (BULK or BAGGED) matching the next diet item's feed category. If no silo with correct Feed Type available: notification fires. | NOTIFICATION if no silo with correct Feed Type at this house for next diet |  | Yes, SILO2 is active, BULK and designated FEED-R2 |
| 60 | Projected Shortfall KG | Calculated | Per item and date: demand plus safety stock minus available opening and confirmed incoming stock. Never offset next diet with stock of current diet. | Notification if greater than 0 |  | R1 4,500 KG; R2 9,000 KG |
| 61 | Recommended Order Qty KG | Display - Auto | Rounded order qty. 3-ton multiples for bulk. | Notification if requisition not yet drafted |  | R1 6,000 KG; R2 9,000 KG; total 15,000 KG |
| 62 | Farm Total Order This Cycle KG | Display - Auto | Sum of recommended order qty across all silos. Target 30 tons. | Notification if approaching 30-ton cap |  | 15,000 KG, half of usual 30,000 KG truck target |
| 63 | Requisition Status | Display and Link | Status of auto-draft requisition. Link opens requisition. | Notification based on approval deadline |  | AUTO_DRAFT, then APPROVED when Farm Manager confirms |
| 64 | Submission Deadline | Configurable display | Configured cutoff for the production date. Triple-C usually submits by Saturday for Sunday production; allow earlier event based requests. | CRITICAL notification Friday evening if still AUTO_DRAFT |  | Configured cutoff for selected production date; Saturday by default |

**Row 66:** SECTION 5: FLEXIBLE FORECAST FILTERS AND RUN AUDIT

**Row 67:** View and Period — Daily, Weekly, Reporting Period, Custom — Weekly uses selected week start date; reporting period uses configured dates, not calendar month name alone. Custom uses From and To. — Yes — Weekly weekday is scheduler setting — Weekly 23 to 29 Sep 2026; custom dates 23 to 29 Sep also available

**Row 68:** Run Date and Version — Date time and unique ID — Preserve as of timestamp, source posting cutoff, selected filters, lifecycle config version, author and run version. — Auto — Audit — RUN-GRS-20260923-001 at 09:00, version 1

**Row 69:** Scheduled Planning — Configuration — Wednesday tentative run and Sunday stock check are Triple-C defaults. Allow on demand forecast for any selected date range. — Yes — Tenant configurable — Wednesday 09:00 tentative run; manual rerun available

**Row 70:** Output Detail — Dated lines — Farm, batch, house, silo, required feed item, current silo item, head count, rate, opening stock, receipts, daily use, projected closing, shortage date, recommended quantity and delivery date. — Auto — Daily calculations — Daily rows by R1 and R2 with head count, rates, stock, shortage and delivery date

## Sheet: Requisition and Loading Sheet

**Row 1:** NAVFarm TDD - Feed Requisition: Page Fields, Loading Instruction Sheet and Approval Flow — Illustrative example data

**Row 2:** Forecast drafts a farm requisition in NAVFarm. Farm Manager approves. Feed Mill Manager consolidates all approved farms in one NAVFarm sheet and pushes an approved plan to BC. BC produces and ships Transfer Orders. NAVFarm receives the shipped TO and posts actual receipt against the TO or linked requisition through the same posting service. There is no feed GRN. — Sample only. Replace with customer approved master data and transactions.

**Row 3:** SECTION 1: REQUISITION HEADER

| Row | Field Name | Type / Source | Description and Business Rule | Mandatory | Editable by Farm Manager | Example (illustrative) |
|---|---|---|---|---|---|---|
| 5 | Requisition No. | Auto No. Series | Format: REQ-FarmCode-YYYY-NNNNN. Example: REQ-GRS-2026-00041. | Auto | No | REQ-GRS-2026-00041 |
| 6 | Requisition Date | Date - Auto | Date auto-drafted by system. | Auto | No | 23 Sep 2026 |
| 7 | Requisition Type | Dropdown | FEED_FORECAST for auto-drafted. MANUAL for Farm Manager manually raised requisition. | Auto | No | FEED_FORECAST |
| 8 | Source | Dropdown | AUTO_FORECAST or MANUAL_ENTRY or STOCK_TAKE_TRIGGERED or DIET_CHANGE_UPCOMING. | Auto | No | AUTO_FORECAST |
| 9 | Farm Code | Auto from User Setup | Farm Manager own farm. One requisition per farm per silo per feed item per submission cycle. | Auto | No | GRS |
| 10 | Farm Name | Auto | From Farm Master. | Auto | No | Grasmere |
| 11 | Silo Code | Auto from Forecast | Which silo triggered this requisition. Linked to Location Master. | Yes | No | GRS-H3-SILO1 for R1; SILO2 for R2 |
| 12 | Current Silo Feed Item No. | Lookup | Physical item currently held in destination silo. Required order item comes from lifecycle forecast and may differ for a pending authorized changeover. | N/A | REMOVED | FEED-R1 on SILO1; FEED-R2 on SILO2 |
| 13 | Feed Item No. to Order | Lookup | Required feed item for the batch house and date from lifecycle config. For manual order, validate against lifecycle or record approved exception. | Yes | Yes - can change | FEED-R1 line 1; FEED-R2 line 2 |
| 14 | Feed Item Description | Auto | Description. | Auto | No | Weaner Diet R1; Weaner Diet R2 |
| 15 | Feed Type | Auto from Location Master | BULK or BAGGED. Drives rounding and truck type. | Auto | No | BULK |
| 16 | Is Next Diet Requisition | Boolean - Auto | True if this requisition was generated for the upcoming next diet from Breed Lifecycle Config. Allows Farm Manager to identify diet-change related orders. | Auto | No | FALSE for R1; TRUE for R2 |
| 17 | Breed Lifecycle Row Reference | Lookup - Auto | Which Breed Lifecycle Stage Config row triggered this requisition. Reference for Farm Manager to verify. | Auto | No | L-LINE WEANER days 25 to 27; days 28 to 31 for R2 |
| 18 | System Balance at Draft KG | Auto - Snapshot | Balance when requisition was auto-drafted. | Auto | No | 1,500 KG for R1; 1,000 KG for R2 |
| 19 | Daily Requirement KG | Auto - Snapshot | Daily feed need at time of draft. | Auto | No | 2,000 KG R1; 2,500 KG R2 per day |
| 20 | Days Remaining at Draft | Auto - Snapshot | Days of feed remaining when draft created. | Auto | No | R1 first shortage 23 Sep; R2 first shortage 26 Sep |
| 21 | Days Before Diet Change | Auto - Snapshot | If Source = DIET_CHANGE_UPCOMING: how many days before changeover when this was drafted. | Auto if diet change | No | 3 days until R2 begins on 26 Sep |
| 22 | Recommended Qty KG | Auto from Forecast | System-recommended order qty rounded to 3-ton multiples for bulk. | Auto | Yes - editable | R1 6,000 KG; R2 9,000 KG |
| 23 | Bag Count | Auto if BAGGED | Recommended Qty divided by 50. Shown for bagged feed only. | Auto if BAGGED | Yes if qty changed | Not applicable to BULK |
| 24 | Requested Qty KG | Decimal - Editable | Farm Manager final approved qty. Defaults to Recommended Qty. | Yes | Yes | R1 6,000 KG; R2 9,000 KG approved |
| 25 | Requested Qty Bags | Auto if BAGGED | Requested Qty divided by 50. Shown for bagged feed. | Auto | No - derived | Not applicable to BULK |
| 26 | Farm Total Requested KG | Calculated | Sum of requested bulk quantities this cycle. Display versus 30000 KG normal truck target; quantity above one truck can be served by multiple trips. | Auto | No | 15,000 KG total |
| 27 | Bulk Truck Target KG | Configured default 30000 | Planning target, not an absolute farm requisition cap. Show required trips or exception and enforce actual confirmed capacity at loading. | Auto | No - hard block | 30,000 KG normal truck target; no hard cap |
| 28 | Bulk Order Multiple | Configured default 3000 KG | Default per compartment bulk rounding. Show unrounded need and proposed rounded quantity; allow approved operational exception. | Auto | No - auto-corrected | 3,000 KG default compartment multiple |
| 29 | Required Delivery Date | Date | Derived from earliest projected shortage and production cutoff. Farm Manager can edit with reason. No supplier lead time for internal feed. | Yes | Yes | 23 Sep for R1 and 26 Sep for R2, illustrative feasibility requires mill confirmation |
| 30 | Supplier or Source | Fixed = MILL (Internal) | All feed supply is from internal Mill only. No external vendor for feed. Field value always = MILL. Feed Mill Manager processes via Consolidation Sheet in NAVFarm then BC Transfer Order. | Auto | Fixed - no external purchase for feed | MILL01 |
| 31 | Requisition Purpose | Fixed = INTERNAL_TRANSFER (Mill) | All feed requisitions are internal transfers from Mill. No PURCHASE option for feed. Consolidated by Feed Mill Manager in NAVFarm. Pushed to BC. BC creates Transfer Order. Not a Purchase Order. | Auto | Fixed - always Internal Transfer | INTERNAL_FEED_TRANSFER |
| 32 | Mill Loading Bin No. | Auto from Mill Capacity Master via Diet No. | Which mill loading bin is assigned to this diet at time of production. Derived from Mill Capacity Master based on Feed Item Diet No. Not stored on silo Location Master. | Auto | No | BIN01 R1; BIN04 R2 |
| 33 | Status | Configured workflow | AUTO_DRAFT, PENDING_APPROVAL, APPROVED, IN_CONSOLIDATION, PUSHED_TO_BC, TO_SHIPPED, PART_RECEIVED, RECEIVED, CLOSED or EXCEPTION. No PO_CREATED or GRN_RAISED for feed. | Auto | No | APPROVED before mill consolidation |
| 34 | Priority | Dropdown - Auto | CRITICAL_FIRST_PRIORITY when silo System Balance is at or below its single Below Feed Level KG. Other urgency may derive from projected shortage date and required delivery date, not a second low threshold. | Auto | Yes - can escalate | CRITICAL for R1 shortage on 23 Sep; R2 warning |
| 35 | Submission Deadline | Configurable date time | Derived from production date and configured mill cutoff. Saturday is Triple-C default for Sunday production; allow earlier submission. | Auto | No | Configured cutoff before each production date |
| 36 | Remarks | Text | Mandatory if Requested Qty deviates more than 20% from Recommended Qty. | Conditional | Yes | No quantity override in example |
| 37 | Approved By | Auto on Approval | Farm Manager who approved. | Auto | No | GRS Farm Manager |
| 38 | Approval Date Time | Auto | Timestamp. | Auto | No | 23 Sep 2026 10:00 |
| 39 | Linked Transfer Order No. | Auto - synced from BC | BC Transfer Order No. returned when BC creates TO after consolidation pushed. Stored on Requisition Slip for linkage. Farm user receives against this TO in NAVFarm. | Auto after BC TO created | No | TO-MILL-GRS-0042 after BC creation |

**Row 40:** SECTION 2: REQUISITION SUB-FORM - Line detail per silo per feed item

| Row | Field Name | Type | Description and Business Rule | Mandatory | Editable | Example (illustrative) |
|---|---|---|---|---|---|---|
| 42 | Line No. | Auto | Sequential line number within requisition. | Auto | No | 10000 for R1; 20000 for R2, illustrative |
| 43 | Silo Code | Lookup | Which silo this line is for. | Yes | Yes | SILO1 line 1; SILO2 line 2 |
| 44 | Current Silo Feed Item No. | Lookup | Current physical item designation; a next diet may require approved changeover before TO receipt. | N/A | REMOVED | FEED-R1 on SILO1; FEED-R2 on SILO2 |
| 45 | Feed Item No. to Order | Lookup | Actual feed item being ordered for this line. | Yes | Yes | FEED-R1 then FEED-R2 |
| 46 | Feed Type | Auto | BULK or BAGGED. | Auto | No | BULK for both |
| 47 | Is Next Diet Line | Boolean - Auto | True if this line is for the upcoming next diet. | Auto | No | FALSE on R1; TRUE on R2 |
| 48 | Days Before Diet Change | Integer - Auto | Days remaining before this diet change takes effect. | Auto if diet change | No | R2 begins 26 Sep |
| 49 | System Balance KG | Auto - Snapshot | Balance for this silo at draft time. | Auto | No | R1 1,500 KG; R2 1,000 KG |
| 50 | Daily Requirement KG | Auto | Daily consumption for this silo. | Auto | No | R1 2,000 KG per day; R2 2,500 KG per day |
| 51 | Days Remaining | Auto | Days of feed for this silo. | Auto | No | R1 shortage 23 Sep; R2 shortage 26 Sep |
| 52 | Recommended Qty KG | Auto | Forecast-recommended qty for this line. | Auto | Yes | R1 6,000 KG; R2 9,000 KG |
| 53 | Requested Qty KG | Decimal - Editable | Farm Manager final qty for this line. | Yes | Yes | R1 6,000 KG; R2 9,000 KG |
| 54 | Bag Count | Auto if BAGGED | Requested Qty divided by 50. | Auto if BAGGED | No | Not applicable to BULK |
| 55 | Destination Silo | Lookup | Active silo linked to house and assigned item. For future diet, reserve a silo or flag approved changeover before receipt. | Yes | Yes | GRS-H3-SILO1 R1; GRS-H3-SILO2 R2 |
| 56 | Proposed Delivery Date | Date | Per-line delivery date. | Yes | Yes | 23 Sep R1; 26 Sep R2 |

**Row 57:** SECTION 3: LOADING INSTRUCTION SHEET - Generated per approved requisition

**Row 58:** Loading Instruction Sheet generated in NAVFarm when Farm Manager approves Requisition. Shared with Mill Manager in NAVFarm. Mill Manager fills in Compartment No. and KG Loaded. Daily tracking per diet: KG Ordered, KG Loaded, Compartment No. NAVFarm notification sent to Farm Manager when Mill Manager marks feed as dispatched.

| Row | Field Name | Type / Source | Description and Business Rule | Filled By | Mandatory | Example (illustrative) |
|---|---|---|---|---|---|---|
| 60 | Loading Sheet No. | Auto | Format: LOAD-ReqNo-LineNo. Linked to Requisition. | System | Auto | LOAD-REQ-GRS-2026-00041 |
| 61 | Requisition No. | Auto | Parent Requisition reference. | System | Auto | REQ-GRS-2026-00041 |
| 62 | Farm Code | Auto | From Requisition. | System | Auto | GRS |
| 63 | Farm Name | Auto | From Farm Master. | System | Auto | Grasmere |
| 64 | Delivery Date | Auto from Req | Proposed delivery date from Requisition line. | Farm Manager | Yes | 23 Sep R1; 26 Sep R2, illustrative |
| 65 | Feed Item No. Diet | Auto | Which diet. Diet number 1 to 14. | System | Auto | Diet 1 FEED-R1; Diet 4 FEED-R2 |
| 66 | Feed Item Description | Auto | Diet description. | System | Auto | Weaner Diet R1; Weaner Diet R2 |
| 67 | Mill Loading Bin No. | Auto from Mill Capacity Master via Diet No. | Which mill loading bin is assigned to this diet at time of production. Derived from Mill Capacity Master based on Feed Item Diet No. Not stored on silo Location Master. | System | Auto | BIN01 and BIN04 |
| 68 | Silo Code at Farm | Auto from Req line | Which silo at the farm this load goes to. | System | Auto | SILO1 for R1; SILO2 for R2 |
| 69 | KG Ordered | Auto from Req | Requested Qty from Requisition line. | System | Auto | 6,000 KG R1 and 9,000 KG R2 |
| 70 | Compartment No. | Text - Mill fills | Which truck compartment this diet is loaded into. No mixing of different diets in same compartment for bulk. | Mill Manager | Yes | Compartment 1 and 2 R1; compartments 3, 4 and 5 R2, subject to confirmed configuration |
| 71 | KG Loaded | Decimal - Mill fills | Actual KG loaded into truck compartment. | Mill Manager | Yes | 3,000 KG each compartment; total 15,000 KG |
| 72 | Loaded By | Text | Mill staff name confirming loading. | Mill Manager | Yes | Mill Loader 01 |
| 73 | Loading Date Time | DateTime - Mill fills | When feed was loaded at mill. | Mill Manager | Yes | 23 Sep 2026 11:00 for illustrative R1 dispatch |
| 74 | Dispatch action | Mill action | On BC TO shipment sync or confirmed dispatch, send NAVFarm notification to farm with diet, compartment, shipped KG and reference. No NAVFarm notification integration. | Mill Manager | Required to dispatch | BC shipment confirmed; NAVFarm emits dispatch event |
| 75 | NAVFarm Notification Status | Automatic | Event issued through Alerts and Notifications Master to configured farm recipients; deduplicate by BC shipment event ID. | System auto on Dispatch | Auto | SENT through IN_APP and EMAIL |
| 76 | Notification Content | Auto | Notification text: Feed for FarmName dispatched. Diet: FeedItemDescription. Compartment: CompartmentNo. KG: KGLoaded. Estimated arrival: based on route from Vehicle Management module. | System | Auto | GRS delivery dispatched: R1 6,000 KG, compartments 1 and 2, TO-MILL-GRS-0042. |
| 77 | Status | Dropdown | DRAFT then LOADED then DISPATCHED then RECEIVED. | System | Auto | DISPATCHED after BC shipment sync |

**Row 78:** SECTION 4: APPROVAL WORKFLOW - Saturday deadline enforced

| Row | Step | Who | Action | System Response | Status After | Example (illustrative) |
|---|---|---|---|---|---|---|
| 80 | 1 - Auto-draft | System | Forecast detects shortfall or upcoming diet change. Requisition(s) created with Status = AUTO_DRAFT. | NAVFarm notification to Farm Manager: requisition auto-drafted for review and approval by Saturday date. | AUTO_DRAFT | RUN-GRS-20260923-001 creates 2 draft lines |
| 81 | 2 - Diet change | Forecast creates a separate next diet line from lifecycle start date. Destination silo must hold or be cleared and approved for new item before receipt. | If diet change within 7 days: second requisition Slip AUTO_DRAFT created for next feed item. Silo identified by Feed Type (BULK or BAGGED) match at this house from Location Master - not by fixed item tag. | NAVFarm notification: two requisition slips drafted - current diet and next diet. Farm Manager to review both. | AUTO_DRAFT x2 | R2 starts 26 Sep; SILO2 already holds R2 |
| 82 | 3 - Farm Manager reviews | Farm Manager | Opens requisition slip. Reviews: Silo, Current Diet (from Breed Lifecycle Config), Feed Item to Order, Qty, Required By Date. Checks farm total vs 30-ton target. Can edit Requested Qty and Required By Date. | System shows System Balance, Days Remaining, Recommended Qty, Farm Total Order KG, Submission Deadline. | AUTO_DRAFT | Farm Manager reviews both lines and silo destinations |
| 83 | 4 - Approve | Farm Manager | Clicks Approve. If Qty deviates more than 20% from Recommended: Remarks mandatory. | Status = APPROVED. Approval stamp. Loading Instruction Sheet generated. If Purpose = PURCHASE: BC API queued. | APPROVED | Approves 6,000 KG R1 and 9,000 KG R2 |
| 84 | 5 - Friday notification | System | Friday evening: notification if any requisition still AUTO_DRAFT for this farm. | NAVFarm notification to Farm Manager: requisition not yet approved. Submission deadline Saturday date. Days remaining N. | AUTO_DRAFT | Reminder only if still draft at configured warning time |
| 85 | 6 - Saturday notification | NAVFarm master issues configured critical reminder when requisition remains unapproved by the production cutoff. | Alerts master | Do not assume fixed weekday for all tenants | AUTO_DRAFT | Reminder only if still unapproved at cutoff |
| 86 | 7 - Feed Mill Manager Consolidation | Feed Mill Manager | Feed Mill Manager opens Consolidation Sheet in NAVFarm. Reviews ALL farm requisition slips consolidated into one view (farm-wise, diet-wise). Adjusts quantities if mill capacity constraint applies. Marks as CONSOLIDATED. | Consolidation Sheet updated in NAVFarm with all farm requirements. Status on each Req Slip = CONSOLIDATED. | CONSOLIDATED | Mill manager adds GRS plus other approved farm lines |
| 87 | 8 - Mill approves and pushes to BC | After mill manager consolidates approved requisitions and capacity, approved plan goes to BC. BC creates and ships TO per farm and diet; shipped lines sync back to NAVFarm with BC references. | Consolidated requirement pushed from NAVFarm to BC. BC produces feed as per diet and quantity. BC creates Transfer Order (Mill Location to Farm Location) per farm per diet. Transfer Order No. returned to NAVFarm and linked to Requisition Slip. | BC Transfer Order created. TO No. synced back to NAVFarm. Linked Transfer Order No. field on Requisition Slip updated. | TO_CREATED in BC | Consolidation CONS-202639-001 approved then pushed to BC |
| 88 | 9 - Mill loads and dispatches | Mill Manager | Fills Loading Instruction Sheet: Compartment No., KG Loaded. Shipped Qty KG entered on Requisition Slip and Loading Sheet. Clicks Dispatch. BC Transfer Order status = SHIPPED. | NAVFarm in-app and email notification to Farm Manager: feed dispatched with diet, compartment, Shipped Qty KG, and estimated arrival details. Shipped Qty updated on Requisition Slip. | DISPATCHED | BC ships R1 6,000 KG; shipment links back to requisition |
| 89 | 10 - Farm posts TO receipt | Open synced TO or linked requisition, both invoking same receipt operation. Preserve requested, mill approved, shipped, received and outstanding quantity per line. | Receipt ledger | Partial receipt supported | RECEIVED | Farm receives 6,000 KG R1 using TO or requisition receipt action |

**Row 112:** SECTION 5: FEED MILL MANAGER CONSOLIDATION SHEET - All farms consolidated in NAVFarm

**Row 113:** Feed Mill Manager opens Consolidation Sheet in NAVFarm after all farm requisition slips are approved (Saturday). One consolidated view of ALL 10 farms' feed requirements per diet. Mill Manager reviews, adjusts for mill capacity constraints, and marks as Consolidated. Consolidated data pushed to BC. BC produces feed and creates Transfer Order per farm per diet.

| Row | Field Name | Type / Source | Description and Business Rule | Filled By | Mandatory | Example (illustrative) |
|---|---|---|---|---|---|---|
| 115 | Consolidation Sheet No. | Auto No. Series | Format: CONS-YYYY-WW-NNN. One per production week. | System | Auto | CONS-202639-001 |
| 116 | Production Week | Auto - current week | Week for which consolidation is being done. Format YYWW. | System | Auto | 202639 |
| 117 | Consolidation Date | Date - Auto | Date Feed Mill Manager created this consolidation. | System | Auto | 23 Sep 2026 |
| 118 | Feed Mill Manager | Auto from User | User who created consolidation. Must have Feed Mill Manager role. | System | Auto | Feed Mill Manager 01 |
| 119 | Farm Code | Display - one row per farm | Each of the 10 farms listed. One row per farm per diet. | System | Auto | GRS row for Diet 1 and Diet 4 |
| 120 | Diet Feed Item No. | From Requisition Slips | Which diet. Aggregated from all farm requisition slips. | System | Auto | FEED-R1 6,000 KG; FEED-R2 9,000 KG |
| 121 | Diet No. | From Item Master | Diet number 1 to 14. | System | Auto | Diet 1; Diet 4 |
| 122 | Mill Loading Bin No. | From Mill Capacity Master | Which bin produces this diet. | System | Auto | BIN01; BIN04 |
| 123 | Farm Requested Qty KG | Sum of Req Slip Requested Qty per farm | Total requested by this farm for this diet this week. | System | Auto | GRS R1 6,000 KG; R2 9,000 KG |
| 124 | Total All Farms KG (this diet) | Sum across all farms | Total requirement across all 10 farms for this diet. | System | Auto | Diet 1 total all farms 12,000 KG; Diet 4 total 9,000 KG |
| 125 | Mill Capacity Available KG | From Mill Capacity Master | Available mill output for this diet. If Total exceeds Capacity: Mill Manager adjusts farm qtys. | System | Auto | Diet 1 allocated 20,000 KG for selected day, illustrative |
| 126 | Mill Approved Qty KG | Manual with reason | Mill Manager may adjust farm allocations for capacity. Preserve original farm requested KG and record reason; notify farm of changed quantity before BC push. | Feed Mill Manager | Conditional | GRS approved R1 6,000 KG and R2 9,000 KG |
| 127 | Adjustment Reason | Text | Mandatory if Adjusted Qty differs from Requested Qty. | Feed Mill Manager | Conditional | Blank, unchanged from farm request |
| 128 | Consolidation Status | Dropdown | DRAFT then REVIEWED then CONSOLIDATED then PUSHED_TO_BC. | System | Auto | PUSHED_TO_BC after mill approval |
| 129 | Push Approved Plan to BC | Action | Only mill approved consolidated lines are sent. Use stable plan and line IDs; return BC acceptance or error. Never send farm approved lines separately. | Feed Mill Manager | Required | Push CONS-202639-001 once using unique line IDs |
| 130 | BC Transfer Order No. (per farm) | Auto - returned from BC | BC TO No. returned after BC creates Transfer Order for each farm. Linked back to each farm Requisition Slip. | System | Auto after BC push | TO-MILL-GRS-0042 |

**Row 132:** SECTION 6: TO RECEIPT IN NAVFARM - Farm user receives against Transfer Order or Requisition Slip

**Row 133:** BC TO must be shipped before receiving in NAVFarm. Shipped lines sync to the linked requisition. TO receipt page and requisition receipt action use the same posting operation and prevent duplicate posting. No separate feed GRN.

| Row | Field Name | Type / Source | Description and Business Rule | Filled By | Mandatory | Example (illustrative) |
|---|---|---|---|---|---|---|
| 135 | TO Receipt No. | Auto - synced from BC | BC Transfer Order No. synced to NAVFarm. Farm user opens this to receive feed. | System | Auto | RCPT-TO-MILL-GRS-0042-01 |
| 136 | Requisition Slip No. | Lookup | Linked Requisition Slip. Farm user can receive directly from Requisition Slip instead of TO Receipt. | System | Auto | REQ-GRS-2026-00041 |
| 137 | Farm Code | Auto | Receiving farm. From TO or Requisition Slip. | System | Auto | GRS |
| 138 | Destination Silo | Filtered lookup | Active farm silo holding this item or with approved empty silo changeover to this item; matching BULK or BAGGED alone is insufficient. | Farm Manager | Yes | GRS-H3-SILO1 for R1 |
| 139 | Feed Item No. | Auto from TO or Req Slip | Which diet being received. | System | Auto | FEED-R1 |
| 140 | Feed Item Description | Auto | Description of diet. | System | Auto | Weaner Diet R1 |
| 141 | Feed Type | Auto from Location Master via Silo | BULK or BAGGED. Drives validation. | System | Auto | BULK |
| 142 | Farm Requested Qty KG | Read only | Original approved requisition quantity. Also show mill approved quantity if adjusted. | System - Locked | Auto | 6,000 KG R1 on original farm line |
| 143 | BC Shipped Qty KG | Read only | BC TO shipped quantity by line, including partial shipments. | System - from BC TO | Auto | 6,000 KG shipped R1 |
| 144 | Received Qty This Posting KG | Editable | Positive actual receipt, limited against outstanding shipped quantity unless authorized variance. Post against unique BC shipment and receipt reference. | Farm Manager or Operator | Yes | 6,000 KG received R1 in first receipt |
| 145 | Variance Shipped vs Received KG | Auto: Shipped minus Received | Any difference between what was shipped and what arrived. If greater than 0: reason mandatory. | System | Auto | 0 KG for R1 |
| 146 | Variance Reason | Text | Mandatory if Shipped Qty does not equal Received Qty. | Farm Manager | Conditional | Blank when variance zero |
| 147 | Bag Count Received | Integer - if BAGGED | Number of bags physically received. Bag Count x 50 must match Received Qty within 1 percent. | Farm Operator | If BAGGED | Not applicable to BULK |
| 148 | Compartment No. Received From | Text | Which truck compartment this feed came from. From Loading Instruction Sheet for reference. | Auto from Loading Sheet | Auto | Compartments 1 and 2 |
| 149 | Post Feed TO Receipt | Action | Single posting service for TO and requisition entry. Posts received KG by silo and item once, updates received total and outstanding quantity, sends BC receipt or reconciliation event as defined, then refreshes forecast. No GRN. | Farm Manager | Required | Post RCPT-TO-MILL-GRS-0042-01 once |
| 150 | Silo Balance After Receipt KG | Auto - display | Updated Silo System Balance after this receipt posted. Shown for Farm Manager confirmation. | System | Auto | SILO1 R1: 1,500 plus 6,000 equals 7,500 KG before POST Day use |

**Row 152:** SECTION 7: SHIPMENT AND RECEIPT CONTROL FIELDS

**Row 153:** Mill Approved Qty KG — Read only — Preserve mill adjusted amount alongside original farm requested amount. — Auto — Consolidation line — 6,000 KG R1

**Row 154:** Previously Received Qty KG — Read only — Total receipts already posted for BC shipment line; used for partial receipt and duplicate prevention. — Auto — Posted receipt ledger — 0 KG before this receipt; 6,000 KG afterward

**Row 155:** Outstanding Shipped Qty KG — Calculated — Shipped minus previously received. Validate current receipt and record any discrepancy with reason. — Auto — Per TO line — 6,000 KG before receipt; 0 KG afterward

**Row 156:** BC TO Shipment Line ID — Read only — Unique BC company, TO, shipment and line key. Receipt posting requires this key and unique NAVFarm receipt ID. — Auto — Idempotency — BC-COMPANY-01 / TO-MILL-GRS-0042 / SHIP-01 / LINE-10000

**Row 157:** Receipt Posting Status — Read only — DRAFT, POSTED_PENDING_BC, POSTED, or EXCEPTION. Resolve failed BC acknowledgment without duplicate silo increment. — Auto — Audit — POSTED after receipt and BC acknowledgement

## Sheet: Silo Balance and Stock Take

**Row 1:** NAVFarm TDD - Silo balance, TO receipt and month end stock take — Illustrative example data

**Row 2:** System balance is ledger derived by silo and feed item. Weekly dated counts are observations and variances; approved adjustments change stock. Feed supply is received against shipped BC Transfer Orders in NAVFarm, without a feed GRN. — Sample only. Replace with customer approved master data and transactions.

**Row 3:** SECTION 1: SILO BALANCE FORMULA

| Row | Component | Formula or Source | When Updated | Notes | Col5 | Example (illustrative) |
|---|---|---|---|---|---|---|
| 5 | Opening Approved Stock KG | Opening balance or posted approved inventory count adjustment | Persist stock by silo and feed item. A weekly count is not a silent reset. | Physical observation. Only manual input in silo balance system. |  | SILO1 R1 1,500 KG at 22 Sep approved count |
| 6 | Plus TO Receipt Received Qty KG | Plus Received Qty KG from Transfer Order Receipt in NAVFarm (feed received from Mill). Posted by Farm Manager or Operator when feed physically arrives. | On TO Receipt Post - Post Receipt button in NAVFarm | Only Received Qty (not Shipped Qty). If Shipped does not equal Received: variance recorded. Received Qty updates balance. |  | R1 TO receipt 6,000 KG on 23 Sep |
| 7 | Minus POST Day Consumed KG | Minus Actual Feed Qty entered in Data Entry Block 1 for batches in linked house(s) | On POST Day button click | Actual entered by Farm Operator. Standard qty pre-filled from Breed Lifecycle Stage Config. |  | R1 POST Day use 2,000 KG on 23 Sep |
| 8 | Equals System Balance KG | After every posted ledger movement | Opening plus TO received minus POST Day consumed plus or minus approved adjustments. | Always labelled SYSTEM BALANCE in all screens. Never labelled physical stock or actual stock. |  | SILO1 R1 closes 23 Sep at 5,500 KG: 1,500 plus 6,000 minus 2,000 |
| 9 | Days of Feed Remaining | System Balance divided by Daily Requirement. Daily Requirement = Sum of (Head Count x KG per Head per Day) for all batches in linked house(s) | Recalculated on every POST Day as head count changes | Displayed to 1 decimal. Drives notification thresholds. |  | At 23 Sep end, R1 lasts about 2.75 days at 2,000 KG per day, before diet changes |
| 10 | Above Threshold Check | On TO receipt and stock adjustment | Use NAVFarm Alerts and Notifications Master. | Notification sent via NAVFarm notification system to Farm Manager. |  | Alert if balance falls below 1,000 KG or above 10,800 KG |

**Row 11:** SECTION 2: TO RECEIPT - Feed delivery and silo update (see Requisition and Loading Sheet Section 6 for full field list)

| Row | TO Receipt Field | Type | Description | Mandatory | Silo Impact | Example (illustrative) |
|---|---|---|---|---|---|---|
| 13 | TO Receipt No. | Auto No. Series | Transfer Order No. synced from BC to NAVFarm. Farm user opens to receive feed. | Auto | No direct impact | RCPT-TO-MILL-GRS-0042-01 |
| 14 | Receipt Date | Date - Auto | Date feed physically received at farm. | Auto | No direct impact | 23 Sep 2026 |
| 15 | Transfer Order No. (BC) | Lookup | BC Transfer Order No. Feed supply is always via BC Transfer Order - not Purchase Order. TO created by BC after consolidation pushed from NAVFarm. | Yes | Links to Requisition | TO-MILL-GRS-0042 |
| 16 | Source | Fixed = MILL | All feed comes from internal Mill via Transfer Order. No vendor or external purchase for feed. | Auto | No direct impact | MILL01 internal transfer |
| 17 | Delivery Note No. | Text | Supplier delivery note number. | Yes | Audit trail | MILL-DN-0042 |
| 18 | Loading Sheet No. | Lookup | Links TO Receipt to Loading Instruction Sheet. Compartment No. reference for reconciliation. | Yes | Traceability - matches Mill records | LOAD-REQ-GRS-2026-00041 |
| 19 | Farm Code | Auto from User | Receiving farm. | Auto | Identifies which farm silos to update | GRS |
| 20 | Feed Item No. | Auto from PO line | Which feed item received. From BC Transfer Order line. | Auto | Identifies which silo to update based on Feed Type match at this farm and house | FEED-R1 |
| 21 | Destination Silo | Lookup | Only active matching current item or approved empty item changeover and feed type. | Yes | This field updates Silo System Balance | GRS-H3-SILO1 |
| 22 | Feed Type | Auto from Location Master | BULK or BAGGED. | Auto | Drives bag count validation | BULK |
| 23 | Requested Qty KG | Locked - from Requisition Slip | Original quantity requested. Locked - cannot change. | Auto | Reference only | 6,000 KG requested R1 |
| 24 | Bag Count Received | Integer - for BAGGED | Number of bags received. Validation: Bag Count x 50 must equal Qty Received within 1 percent tolerance. | Yes if BAGGED | Cross-check for bagged feed accuracy | Not applicable to BULK |
| 25 | Shipped Qty KG | Auto - from BC Transfer Order | Quantity shipped by Mill as per BC Transfer Order. Cannot be changed by farm user. | Auto | Reference for variance check | 6,000 KG shipped R1 |
| 26 | Received Qty KG | Decimal - Farm user entry | Actual quantity received at farm. Entered by Farm Manager or Operator on physical receipt. | Yes | THIS amount updates Silo System Balance | 6,000 KG received R1 |
| 27 | Variance Shipped vs Received KG | Auto: Shipped minus Received | Difference between shipped and received. If not zero: variance reason mandatory. | Auto | Does not affect silo balance - informational | 0 KG |
| 28 | Bag Count Received (if BAGGED) | Integer - if BAGGED | Number of bags physically received. Bag Count x 50 must match Received Qty within 1 percent. | If BAGGED | Cross-check only | Not applicable to BULK |
| 29 | Post Receipt | Button | Single posting path from TO or requisition; enforce unique BC TO shipment line and receipt ID. Post received KG only. Partial receipts leave outstanding KG. No feed GRN. | Required | Silo balance updated on this action | Post once with BC shipment line and receipt ID |

**Row 30:** SECTION 3: MONTHLY STOCK TAKE MODULE - Month-end Saturday, all farms and Feed Mill

**Row 31:** Monthly stock take is required at configured reporting period end for farms and mill. Reporting periods can be entered in NAVFarm or imported from BC. A separate configurable weekly count can occur any day.

| Row | Field or Function | Type | Description and Business Rule | Mandatory | Notes | Example (illustrative) |
|---|---|---|---|---|---|---|
| 33 | Stock Take No. | Auto No. Series | Format: ST-FarmCode-YYYY-NNNNN or ST-MILL-YYYY-NNNNN. | Auto | One per entity per period | ST-GRS-2026-00009 |
| 34 | Stock Take Type | Dropdown | FARM or FEED_MILL. Separate stock take record for each farm and for Feed Mill. | Yes | All farms plus Mill covered each month-end | FARM; MILL on separate stock take record |
| 35 | Farm Code or Mill Code | Lookup | Which farm or Feed Mill this stock take covers. | Yes |  | GRS |
| 36 | Reporting Period | Lookup - Reporting Period Master | Which period this stock take closes. Auto-suggested from Reporting Period Master based on today date. | Yes |  | 2026-09 |
| 37 | Stock Take Date | Date - Auto = Period End Date | Month-end Saturday. Auto-filled from Reporting Period Master. | Auto | Set calendar date not necessarily last calendar day | 26 Sep 2026, illustrative period end |
| 38 | Silo Code or Location | Display - all active silos for this farm | Each silo and location listed. Stock taker enters physical count per line. | N/A | All silos for this farm listed | GRS-H3-SILO1, FEED-R1 |
| 39 | Physical Feed Item in Silo | Ledger and silo designation | Item actually held at stock take date, from silo item and transaction ledger; lifecycle item is expected demand and displayed separately. | Auto |  | FEED-R1 physically held |
| 40 | System Balance KG at Stock Take Date | Auto - Snapshot | System balance as of stock take date. | Auto | Snapshot at point of stock take | 1,500 KG system balance before count, illustrative independent stock take example |
| 41 | Physical Count KG | Decimal - Manual Entry | Actual physical stock measured in silo or storage. | Yes | Manual physical observation | 1,400 KG physical observation |
| 42 | Variance KG | Auto: Physical minus System | Positive means unexplained gain. Negative means unexplained loss. | Auto | Posted to GL if variance posted | Minus 100 KG |
| 43 | Variance Percent | Auto | Absolute Variance divided by Total Consumption in period multiplied by 100. | Auto | If greater than 2 percent: reason mandatory | 100 divided by 6,000 consumption equals 1.67 percent, illustrative |
| 44 | Variance Reason | Text | Mandatory for any nonzero variance. Finance approval if variance exceeds configured amount or percent threshold; apply shared BBP physical inventory approval. | Conditional |  | Count measurement correction, required for any nonzero variance |
| 45 | Adjustment Type | Auto from Variance | POSITIVE_ADJUSTMENT if variance greater than 0. NEGATIVE_ADJUSTMENT if variance less than 0. | Auto | Drives Item Journal entry type | NEGATIVE_ADJUSTMENT of 100 KG |
| 46 | Post Approved Stock Adjustment | Action | After Farm Manager and any required Finance approval, post variance once as physical inventory adjustment in NAVFarm and BC with same idempotency reference. Do not close period while BC posting is pending. | Required | Stock take posted equals period balanced | Farm Manager approves, then NAVFarm and BC post same 100 KG variance ID |
| 47 | D365BC GL Entry | Auto after Post | Dr or Cr Feed Variance Expense Account, Cr or Dr Inventory Account. Farm Cost Centre Dim1 applied. | Auto | Balance across entire column: all farms and Feed Mill | BC physical inventory adjustment, 100 KG times weighted average cost |
| 48 | Period Status After Reconciliation | Auto | Close only after all farm and mill counts, approved adjustments and BC reconciliation are complete. Block backdated posting per period policy. | Auto | Locks period. Next period starts Sunday. | CLOSED only after all farms, mill and BC reconciliation |
| 49 | Production Start Date Next Period | Auto - Display | Sunday after month-end Saturday. Shown for Farm Manager reference. | Auto | Production starts from this date | 27 Sep 2026 |

## Sheet: Checkpoints and Validations

**Row 1:** NAVFarm TDD - Feed Forecasting: Checkpoints, Hard Blocks, Warnings and Control Points — Illustrative example data

**Row 2:** HARD BLOCK = system prevents action regardless of user role. WARNING = notification shown, can proceed with reason. SYSTEM RULE = automatic system behaviour. NOTIFICATION = sent via NAVFarm notification system as defined in Alerts and Notifications Master. — Sample only. Replace with customer approved master data and transactions.

| Row | No. | Screen or Transaction | Checkpoint and Validation Rule | Where Enforced | Col5 | Example (illustrative) |
|---|---|---|---|---|---|---|
| 4 | 1 | Location Master - Silo | Silo must be linked to at least one House or Shed before Status = ACTIVE. Cannot activate without house link. | On Silo Status change to ACTIVE |  | PASS: SILO1 ACTIVE and linked to House H3. |
| 5 | 2 | Silo item and diet | Silo Current Feed Item No. is the physical item designation. Lifecycle selects required feed by batch and forecast date. Active silo item can be changed only with approved empty stock or posted stock movement. | Silo item changeover |  | PASS: SILO1 currently designated FEED-R1 and BULK; lifecycle selects R2 from 26 Sep. |
| 6 | 3 | Location Master - Silo | One silo can serve multiple houses. One house can have multiple silos. Managed via Silo-House Mapping sub-table. | Silo-House Mapping table |  | PASS: H3 maps to SILO1 and SILO2; another house may map to a silo with compatible feed. |
| 7 | 4 | TO receipt item match | Receiving item must match silo current item, or an authorized empty silo changeover must be completed first. Feed type match alone does not permit mixed diets. | On Post Receipt |  | PASS: 6,000 KG FEED-R1 received to SILO1, its designated item. |
| 8 | 5 | Next diet planning | Next lifecycle item is forecast separately. If no compatible designated silo exists, generate a changeover task and warn farm before requisition approval. | Forecast and receipt |  | PASS: R2 planned against SILO2; SILO1 does not need relabelling. |
| 9 | 6 | Mill Capacity Master - Loading Bin | One diet per mill loading bin at any time. System blocks assigning same bin to two different Feed Items simultaneously. | On Mill Loading Bin assignment in Mill Capacity Master |  | BLOCK: do not assign FEED-R2 to a bin already occupied by FEED-R1 for the same production slot. |
| 10 | 7 | Breed Lifecycle Stage Config | Forecast engine reads next feed row automatically when Day Range To of current row is within forecast window. No manual override of this logic. | In forecast engine Step 5 |  | PASS: lifecycle changes from R1 at day 27 to R2 at day 28. |
| 11 | 8 | Breed Lifecycle Stage Config | If no next feed row exists in Breed Lifecycle Stage Config for the current Line and Stage after Day Range To: NOTIFICATION to System Admin and Farm Manager. Forecast cannot split without next row. | In forecast engine Step 5 - next row lookup |  | PASS: R2 lifecycle row exists for stage days 28 to 31. |
| 12 | 9 | Feed Forecast Engine - Next Diet Silo | If next diet detected within 7 days and no ACTIVE silo at this house has Feed Type matching the next diet item Feed Type (BULK or BAGGED): CRITICAL NOTIFICATION to Farm Manager. System drafts requisition but flags that correct silo type is not available at this house. | In forecast engine Step 5 - silo lookup for next diet by Feed Type |  | PASS: SILO2 active and already designated R2. |
| 13 | 10 | Alerts and Notifications Master | All notification thresholds, recipient roles, delivery channels, and escalation rules must be defined in Alerts and Notifications Master before going live. No hardcoded notification logic in system. | At implementation - Alerts and Notifications Master setup |  | SETUP: FEED-BELOW-L1 has recipient Farm Manager and IN_APP channel. |
| 14 | 11 | Single low feed threshold | Issue first priority NAVFarm alert when System Balance for the silo and item is at or below its single configured Below Feed Level KG. Deduplicate until recovery. | NAVFarm alert master |  | ALERT: SILO1 R1 balance falls to or below 1,000 KG. |
| 15 | 12 | Low alert recovery and rearm | When posted System Balance rises above the configured low threshold, resolve the active low feed alert. Issue a new alert only after a later downward crossing or configured repeat interval. No second low threshold exists. | On TO receipt, POST Day, approved adjustment and alert scheduler |  | RESOLVED: SILO1 rises from 900 KG to 6,900 KG after a 6,000 KG receipt. |
| 16 | 13 | Feed Forecast - Above Threshold | INFO notification when System Balance is greater than or equal to Above Threshold KG. Over-stock - do not order. | On every TO receipt update via Alerts Master |  | INFO: trigger if SILO1 rises to or above 10,800 KG. |
| 17 | 14 | Feed Forecast Engine | POST Day blocked if actual feed consumption entry would drive Silo System Balance below 0 KG. | On POST Day - Block 1 feed entry validation |  | BLOCK per current TDD if POST Day of 2,000 KG against 1,500 KG would make stock minus 500 KG; resolve late receipt first. |
| 18 | 15 | Feed Forecast Engine | Forecast horizon is configurable and supports the full selected reporting period. Validate From Date before To Date and a tenant configurable maximum, for example 45 days. Weekly and monthly views group the daily results. | On forecast config edit |  | PASS: selected 7 day run is within configured 7 to 14 day control; this limit needs review for Monthly view. |
| 19 | 16 | Bulk multiple | Show recommended 3000 KG rounding and unrounded need. Any exception requires approved reason; check actual compartment capacity on loading. | Requisition approval |  | PASS: R1 recommendation 6,000 KG; R2 9,000 KG, both 3,000 KG multiples. |
| 20 | 17 | Farm bulk quantity | 30000 KG is a normal truck target. Larger approved requests can use multiple trips; do not block farm total solely for exceeding 30000 KG. | Requisition approval |  | PASS: 15,000 KG farm request is below usual 30,000 KG truck target. |
| 21 | 18 | Requisition - Qty Deviation | If Requested Qty deviates more than 20 percent from Recommended Qty: Remarks field mandatory before approval. | On Approve button |  | REQUIRE REMARK: changing R1 from 6,000 KG to 9,000 KG exceeds 20 percent. |
| 22 | 19 | Requisition - Farm Manager | Farm Manager can only approve requisitions for their own farm. Cross-farm approval not allowed. | On Approve - User Setup validation |  | BLOCK: Porta Farm Manager cannot approve GRS requisition. |
| 23 | 20 | Requisition - Saturday Deadline | Friday evening notification if requisition still AUTO_DRAFT. Saturday morning CRITICAL notification to Farm Manager and Head of Farm. | Friday and Saturday scheduler via Alerts Master |  | ALERT only if GRS draft remains unapproved at the configured cutoff. |
| 24 | 21 | BC push owner | Farm Manager approval makes requisition eligible for mill consolidation. Only approved mill consolidation is pushed to BC once with unique reference. | Mill approval and push |  | PASS: farm approval alone does not send BC request; CONS-202639-001 is approved first. |
| 25 | 22 | Production cutoff | Derive submission cutoff from configurable production calendar. Triple-C Sunday production requires request by Saturday; allow earlier event based requests. | Submission |  | BLOCK: Sunday production request entered after Saturday cutoff unless authorized exception. |
| 26 | 23 | Requisition - Diet Change Case | If two requisitions auto drafted (current diet and next diet): Farm Manager must approve both before Saturday. Both linked to same forecast run. | On Approve - checks both requisitions for diet-change case |  | PASS: Farm Manager reviews and approves both R1 and R2 requisition lines. |
| 27 | 24 | Loading Instruction Sheet | Compartment No. and KG Loaded mandatory before Mill Manager can click Dispatch. Cannot dispatch without completing these fields. | On Dispatch button - Loading Sheet validation |  | BLOCK: dispatch without a compartment number or KG loaded. |
| 28 | 25 | Loading Instruction Sheet - Bulk | Bulk trucks: no mixing different diets in same compartment. System blocks assigning same compartment to two different diets. | On Compartment No. assignment |  | BLOCK: R1 and R2 cannot share compartment 1 at the same time. |
| 29 | 26 | TO Receipt - Variance | If Shipped Qty does not equal Received Qty: Variance Reason mandatory before posting receipt. Variance recorded but does not block receipt. Variance posted to reconciliation log. | On Post Receipt button - variance check |  | REQUIRE REASON: 6,000 KG shipped but 5,900 KG received leaves 100 KG variance. |
| 30 | 27 | Bagged receipt | Validate bag count times configured bag size, default 50 KG, against TO Received Qty; no feed GRN. | TO receipt |  | BULK example: bag count does not apply. Separate 100 bags would equal 5,000 KG. |
| 31 | 28 | Bag reconciliation | Compare daily empty bags times configured bag size with posted consumption and alert through NAVFarm master. | POST Day |  | WARNING: 98 empty bags imply 4,900 KG versus 5,000 KG posted use; review tolerance. |
| 32 | 29 | TO Receipt - Over-receipt | If Received Qty exceeds Shipped Qty: Farm Manager must enter Variance Reason. Notification sent to Feed Mill Manager. Over-receipt posted but flagged for investigation. | On Post Receipt - Received vs Shipped validation |  | REQUIRE REASON: receiving 6,100 KG against 6,000 KG shipped. |
| 33 | 30 | Diet Change Notification | Notification fires 3 days before current feed period ends based on Breed Lifecycle Stage Config. Tells Farm Manager: next diet item, days remaining, silo status for next diet. | Daily scheduler via Alerts Master |  | WARNING on 23 Sep for R2 diet starting 26 Sep. |
| 34 | 31 | Stock Take - Monthly | One stock take per month on Reporting Period End Date Saturday. Covers all farms and Feed Mill. Cannot close period without posted stock take. | On Period Close action |  | COUNT: GRS and MILL01 each need a September 2026 period end stock take. |
| 35 | 32 | Stock Take - Period Close | After stock take posted: Period Status = CLOSED. No further POST Day entries allowed for this period. | On POST Day - period status check |  | BLOCK: POST Day dated 26 Sep after the reconciled period is closed. |
| 36 | 33 | Stock Take - Variance | Feed Variance exceeds 2 percent of total batch consumption in period: Variance Reason mandatory before posting. | On Post Stock Take button |  | REQUIRE REASON: 300 KG variance on 6,000 KG use is 5 percent. |
| 37 | 34 | Compare Report - Mill Capacity | If Total Farm Demand exceeds Mill Capacity Available for any diet: notification to Mill Manager and Head of Farm. Farm Managers notified to reduce orders. | On Feed Plan save and Compare Report generation |  | ALERT: Diet 1 total of 21,000 KG exceeds 20,000 KG allocated capacity. |
| 38 | 35 | Compare Report - Loading Bin | If loading bin constraint violated (same bin two diets same time): CRITICAL notification to Mill Manager. | On Mill Capacity Master edit and Compare Report |  | BLOCK: assigning BIN01 to Diet 1 and Diet 4 for the same slot. |
| 39 | 36 | Feed Plan - Wednesday | Tentative plan auto regenerated every Wednesday from 5 week rolling history. NAVFarm notification to Farm Managers when plan is ready for review. | Wednesday nightly scheduler |  | NOTIFY: Wednesday tentative plan version RUN-GRS-20260923-001 is available. |
| 40 | 37 | Silo Balance Label | Silo balance always labelled SYSTEM BALANCE in all UI screens. Never labelled physical stock, actual stock, or inventory. | UI field labels across all screens |  | DISPLAY: 1,500 KG is SYSTEM BALANCE, not a physical count unless verified. |
| 41 | 38 | Notifications - Channel | All notifications sent via NAVFarm notification system (in-app, email, SMS). No NAVFarm notification integration for feed module. | All notification triggers in system |  | SEND: low level and shipment events via NAVFarm IN_APP and configured email. |
| 42 | 39 | BC retries | Retry by unique transaction reference. On failure mark pending and alert roles via NAVFarm notification master; never duplicate TO or receipt posting. | Integration queue |  | RETRY: BC push CONS-202639-001 using same unique line reference to avoid duplicate TO. |
| 43 | 40 | Reporting Period | Reporting periods July to June year. Must be defined in NAVFarm or imported from D365BC before any stock take or period close can run. | On Stock Take and Period Close actions |  | BLOCK stock take if reporting period 2026-09 is missing. |
| 47 | 41 | Consolidation Sheet - Feed Mill Manager | Feed Mill Manager can only consolidate requisition slips that have Status = APPROVED. DRAFT or PENDING slips excluded from consolidation. | On Consolidation Sheet load - filter by Status = APPROVED |  | PASS: only farm approved R1 and R2 lines enter CONS-202639-001. |
| 48 | 42 | Consolidation Sheet - Mill Capacity | If total farm demand for any diet exceeds Mill Capacity Available: Mill Manager must adjust quantities before Push to BC is allowed. Cannot push infeasible plan to BC. | On Push to BC button - capacity validation |  | PASS: Diet 1 demand 12,000 KG versus allocated 20,000 KG. |
| 49 | 43 | BC TO shipment sync | BC shipment line and shipped quantity sync to NAVFarm; link each TO line to original requisition and mill consolidation. Support part shipments. | BC shipment event |  | PASS: TO-MILL-GRS-0042 shipment line syncs to requisition. |
| 50 | 44 | TO Receipt - Requested Qty | Requested Qty KG on TO Receipt is locked - derived from original Requisition Slip. Farm user cannot change. Only Received Qty is editable. | On TO Receipt page - Requested Qty field locked |  | PASS: original R1 request 6,000 KG stays locked. |
| 51 | 45 | TO receipt silo | Filter by farm, item and handling type. If next diet requires silo change, verify empty stock and approved changeover first. | TO receipt |  | PASS: SILO1 accepts FEED-R1; SILO2 accepts FEED-R2. |
| 52 | 46 | TO receipt stock posting | Add actual received quantity once to designated silo item stock. Do not add shipped amount. No feed GRN. | Receipt posting |  | PASS: 6,000 KG received added once to SILO1, not shipped quantity twice. |
| 53 | 47 | No feed GRN | Feed flow is forecast, NAVFarm requisition, NAVFarm mill consolidation, BC production and shipped TO, NAVFarm TO receipt. Both receipt entry points invoke the same operation. | System flow |  | PASS: receipt posts against BC TO from NAVFarm. No feed GRN. |

## Sheet: Worked Example

**Row 1:** Triple-C feed forecast worked example — Illustrative values only

| Row | Scenario | Grasmere Farm, House H3, batch WG-2026-38, 1,000 active pigs, L-LINE, WEANER |
|---|---|---|
| 3 | Forecast run | 23 Sep to 29 Sep 2026, 7 days, daily engine with Weekly display |
| 4 | Inventory before run | SILO1 FEED-R1 1,500 KG; SILO2 FEED-R2 1,000 KG |
| 5 | Feed periods | R1 stage days 25 to 27, 23 to 25 Sep; R2 days 28 to 31, 26 to 29 Sep |

| Row | Feed item | Days | Heads | Rate KG per head per day | Requirement KG | Opening stock KG | Unrounded shortage KG | Order KG |
|---|---|---|---|---|---|---|---|---|
| 8 | FEED-R1 | 3 | 1000 | 2 | =B8*C8*D8 | 1500 | =MAX(0,E8-F8) | =CEILING(G8,3000) |
| 9 | FEED-R2 | 4 | 1000 | 2.5 | =B9*C9*D9 | 1000 | =MAX(0,E9-F9) | =CEILING(G9,3000) |
| 10 | Total |  |  |  | =SUM(E8:E9) | =SUM(F8:F9) | =SUM(G8:G9) | =SUM(H8:H9) |

| Row | Production and receipt | Example result |
|---|---|---|
| 13 | Requisition | R1 6,000 KG to SILO1; R2 9,000 KG to SILO2. Farm Manager approves both. |
| 14 | Mill consolidation | CONS-202639-001 retains farm request; all farms Diet 1 demand 12,000 KG versus 20,000 KG allocated. |
| 15 | BC transfer | BC produces feed and ships TO-MILL-GRS-0042. The shipped line syncs to NAVFarm. |
| 16 | NAVFarm receipt | R1 requested 6,000 KG, shipped 6,000 KG, received 6,000 KG; same posting from TO or requisition. |
| 17 | SILO1 after receipt | 1,500 plus 6,000 equals 7,500 KG before consumption; after 2,000 KG POST Day use, 5,500 KG. |
| 18 | SILO2 after R2 receipt | 1,000 plus 9,000 equals 10,000 KG before R2 use; four days times 2,500 KG consumes 10,000 KG. |
| 19 | Scope note | Example assumes zero safety stock, no mortality or transfers, no already scheduled receipt, and feasible delivery dates. |
| 20 | Customer validation | Confirm production cutoff, lead time, bulk compartment capacity, bag cycle, and reporting period dates. |

