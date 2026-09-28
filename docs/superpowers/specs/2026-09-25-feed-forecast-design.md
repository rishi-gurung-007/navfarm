# Feed Forecast — Design

**Date:** 2026-09-25 · **Owner:** Rishi · **Status:** approved decisions, plans pending approval

**Sources, in authority order:**
1. Rishi's answers in session, 2026-09-24/25 (quoted below).
2. `Feed_Forecast_ Reportv1_0.docx` — the report (Section 3 column table).
3. `NAVFarm_Feed forecast TDD with examples.xlsx` — seven sheets: Feed Forecast,
   Master Setup, Feed Forecast Engine, Requisition and Loading Sheet, Silo
   Balance and Stock Take, Checkpoints and Validations, Worked Example.

Where the docx and the workbook disagree, the decision column below records
which one won and why.

## Decisions

| # | Question | Decision |
|---|---|---|
| D1 | Days of inventory left | `floor(balance ÷ today's demand)`. Rishi's corrected sample: 525 kg ÷ 100 kg/day = **5**. (The docx sample shows 500 → 6; that sample is wrong.) |
| D2 | Run-down date | First forecast day on which the silo cannot supply that day's full demand (balance reaches 0 or falls below the day's intake). |
| D3 | Date to Refill / Required On | Date to Refill = run-down date − **refill buffer days** (per farm, default **2**). Required On = Date to Refill − **lead time days** (per farm, default **0**). Required On earlier than the planning date = **overdue**. Reason: the docx columns 10 and 11 both say "−2 before empty" while column 11's description subtracts a lead time, and the workbook (Requisition sheet row 29) says internal feed has no supplier lead time. Both offsets are configurable so either reading can be set. |
| D4 | Source of the item and rate | Breed Lifecycle Stage Config (`breed_lifecycle_stages`), not the KPI master. |
| D5 | Wastage | Daily demand = heads × kg/head/day × (1 + `feed_wastage_pct` ÷ 100). |
| D6 | Sheds without a silo | Included. Their feed comes from the farm STORE, shown as the source. |
| D7 | Silo ↔ shed | **Many-to-many.** A shed may have several silos; a silo may feed several sheds. Replaces 24 Sep's "a shed draws from exactly one silo" and the greyed-out Attached Sheds rows. |
| D8 | Silo feed item | A silo holds **one** feed item. Its current item is **read from inventory** (the item with a positive ledger balance in that silo), not typed. An empty silo has no item. Controlled changeover now: a different item may only enter once the silo is empty (already enforced for stock transfers; extended to goods receipts). |
| D9 | Two silos, same shed, same item | **Blocked.** No two silos attached to the same shed may hold the same feed item — checked when a silo is attached and when stock enters a silo. So daily entry draws from exactly one silo: the one attached to the shed that holds the posted item. |
| D10 | Low / high level | New per-silo `low_level_kg` and `high_level_kg`, **alongside** Silo Reorder Days. |
| D11 | Head count | Workbook Steps 1–2 (Feed Forecast Engine rows 22–23): start from the latest posted closing count; apply only **known dated movements** (scheduled stage transitions; recorded mortality is already inside the closing count); where nothing is scheduled the count stays flat and the row says so. **No standard mortality projection** — the workbook does not ask for one. Docx column 6 ("latest posted closing head count") is the starting point of this. |
| D12 | Scope | Steps 1–4, built together, subagents where possible. D365BC parts (mill push, Transfer Orders, shipment sync) are built **inside NAVFarm** as documents and statuses; the BC connection comes later. |
| D13 | Who sees it | Farm users see their own farm; tenant and company admins can switch farms. The nine `*.manager` logins' missing role is left as is for now. |
| D14 | Menu | Inventory → Feed Forecast. |
| D15 | Diet changes within a stage | The forecast and the scheduler both use every lifecycle feed row of the stage by its `period_from`–`period_to` day range (workbook Master Setup rows 35–39). Today the scheduler reads only the first row per stage (`scheduler-header.service.ts:113`, `.limit(1)`), so data entry could never switch R1 → R2 mid-stage. Both must use the same rule or the forecast and the posting disagree. |
| D16 | Report field specification (26 Sep) | `NAVFarm_Feed_Forecast_Report_Field_Specification.docx` governs the report screen: one row per Batch + Feed Item + forecast date (grouped for Weekly / Reporting Period views; a diet change inside the range gives separate old/new item rows); Planning Date selectable as an "as of" date, default today in the farm time zone (Africa/Harare); views Daily, Weekly, Reporting Period, Custom; Item No column; dates DD/MM/YY; current / next stage block with Date of Stage Change; Days of Stock flagged "indicative" when a diet or rate change falls inside the window. Batch numbering is out of scope (Rishi, 26 Sep). |
| D17 | Wastage (supersedes the display part of D5) | Per Day Intake column = heads × feed rate (no wastage), as the specification says. Run-down, refill dates and requisition quantities use heads × rate × (1 + wastage %), because wasted feed still leaves the silo. The screen states the wastage allowance used. (Rishi, 26 Sep.) |
| D18 | Days of Stock | Silo level: floor(silo balance ÷ everything that silo feeds per day), whole days (525 ÷ 100 = 5). A row on a shared silo says how many batches share it. (Rishi, 26 Sep.) |
| D19 | Run-down, refill, required on (refines D2–D3) | Run-Down = first date the projected balance falls to the silo's Below Feed Level (`low_level_kg`), or to zero when none is set; projection adds confirmed incoming transfers. Date to Refill = Run-Down − refill buffer (per farm, default 2). Required On = Date to Refill − lead time (per farm, default changed from 0 to 2). Overdue when Required On is before the Planning Date. (Rishi, 26 Sep.) |
| D20 | Reporting Period Master | Built now (pulled forward from Plan D, master only): Period Code, Start Date, End Date (month-end Saturday), Stock Take Date, Production Start Date (Sunday after), business year July–June, entered in NAVFarm (BC import later). The Reporting Period view takes From/To from it. Stock take and period close stay in Plan D. (Rishi, 26 Sep.) |
| D21 | Batch shed for existing data (Rishi, 27 Sep) | A migration sets `batch_header.shed_id` only where it is certain: every live animal of the batch sits in pens (or crates) of one shed, or the batch's scheduler headers name one shed / a pen of one shed. Anything ambiguous is left alone and keeps the "no shed on record" note; batch create/edit must let the user set the shed. |
| D22 | Silo levels required (Rishi, 27 Sep; supersedes the Plan B Q8 default) | `low_level_kg` and `high_level_kg` are required when a silo is created or updated. The demo seed sets them; a migration fills existing silos where empty with High = 90 % of capacity (workbook Master Setup §1 row 12) and Low = 20 % of capacity (our default, to be confirmed by the farm), editable afterwards. |
| D23 | Stage master gaps on existing data (Rishi, 27 Sep) | A migration fills only EMPTY values on system (seeded) stages — typical duration, next stage — and never overwrites a tester's value. Feed-row gaps inside a stage are fixed in the demo seed; on existing data they stay visible as a note for the farm to fix in Breed Lifecycle Stage Config. |
| D24 | Feed alerts live in the one Alerts page (Rishi, 27 Sep) | Feed alerts (FEED_BELOW_L1, FEED_ABOVE, DIET_CHANGE, REQ_DEADLINE) are shown in the sidebar **Alerts** page together with the existing batch alerts, with a type/farm filter; acknowledge works there. The separate Inventory → Feed Alerts tab is removed. Opening the Alerts page runs the feed-alert evaluation for the farms in the user's scope (there is still no scheduler). |
| D25 | Feed requisitions are approved in the Approvals inbox (Rishi, 27 Sep; supersedes the Plan B one-step approve on the requisition screen) | The requisition screen drafts and edits and has **Submit for approval**; submitting raises a PENDING approval request that appears in the sidebar **Approvals** inbox for the farm's own approvers (farm-level users included — the inbox must scope a farm-level document by its farm, not only by batch). Approve / reject there updates the requisition; the 20 % deviation and past-deadline remarks rules still apply at approval. |
| D26 | One Requisitions screen (Rishi, 27 Sep) | Inventory → **Requisitions** (renamed from Feed Requisitions) with a type filter (Feed now; other types later); drafted from the forecast or entered by hand. |
| D27 | Silo low level default for existing data (Rishi, 27 Sep; confirms D22) | Low = 20 % of capacity, High = 90 % of capacity, where empty; editable. |
| D28 | Legacy silo storage type on non-silo locations (Rishi, 27 Sep) | 248 PEN/SHED/CRATE rows carry `storage_type = 'SILO'` from the old location template, so every save of them demands silo fields and fails. Fix in Plan S: silo-field checks key on the location TYPE (SILO), never on storage_type; a migration clears `storage_type` on rows whose location type is not SILO or STORE (only where it is 'SILO'), touching nothing else. Feed-requisition approval in the Approvals inbox needs both the inbox approve grant and the requisition approve grant (S5). FLUSH is 14 days (S7). |
| D29 | Refill dates when nothing runs down in the window (Rishi, 28 Sep) | When a source does not reach its low level (a silo) or zero (a store) inside the forecast window, Date to Refill and Required On read "Not due by <window end>" instead of "—", and Run Down keeps "After <window end>". |
| D30 | Stores (Rishi, 28 Sep) | A store keeps running down to zero; no store low/high levels (one store holds several feeds). Nothing to migrate. |
| D31 | Demo breeding sheds (Rishi, 28 Sep) | The demo's breeding batch is placed in a shed whose silos hold the sow diets it eats (gestation, lactation), so its forecast draws from silos, not the farm store. Seed and chapter change only; takes effect on the next demo rebuild. |
| D32 | Where per-farm feed settings are edited (Rishi, 28 Sep) | The six feed settings (refill buffer, lead time, bulk order multiple, bag size, bulk truck target, production weekday) stay **per farm**, stored where they are (location_master columns on the FARM row; no migration). They are removed from the Add/Edit Location form — they describe how a farm's feed is ordered, not the farm — and edited on one **Settings → Inventory Setup → Feed Planning** screen: a table of the company's farms, one row per farm, the six values editable, blanks meaning the client defaults (2, 2, 3000, 50, 30000, Sunday). Production weekday is a Sunday–Saturday dropdown. The redundant "Silo Name" / "Store Name" field is removed from the Location form too (column kept). |
| D33 | Grid columns (Rishi, 28 Sep; supersedes the extra columns of Plan R/S) | The report grid shows exactly the field specification's 12 columns: Batch No, Item Name, Item No, Shed No, Planning Date, Current Inventory (Kg), Current No. of Pigs, Per Day Intake (Kg), Current No of Days Stock, Scale of Silo Level (Run Down), Date to Refill, Required On Date. "Source" and "Feed incl. Wastage (Kg)" are removed. |
| D34 | Wastage dropped (Rishi, 28 Sep; supersedes D5 and D17) | Neither client document has wastage. The forecast uses heads × feed rate everywhere — per day intake, run-down, refill dates, requisition quantities. `feed_wastage_pct` stays on the breed feed rows, unused by the forecast; the screen's wastage note is removed. |
| D35 | Days of Stock (Rishi, 28 Sep; supersedes D18) | As the specification defines it: Current Inventory ÷ Per Day Intake of that row's batch; indicative when a diet or rate change falls inside the window. Empty when the intake is 0. |
| D36 | Stage length as a range (Rishi, 28 Sep; supersedes the FLUSH = 14 of S7/D28) | The client documents give event-based stages a range (DRY_PERIOD/DRY_SOW 4–7, FLUSH 3–5, INSEMINATION 2), because the real change happens when the sow shows heat/is served. The stage master already holds both ends: `min_days_before_move` = earliest day, `typical_duration_days` = latest day. FLUSH's latest day is 5 (not 14). A posted stage move is a fact and always wins. Before it is posted the forecast plans the change on the **latest** day (the current diet never runs short), shows the window (earliest–latest) on the Stages tab, and marks grid rows inside the window as indicative. Existing data: system FLUSH stages still at 14 become 5; nothing a tester changed is touched. |
| D37 | Demo breeding herd (controller's choice, Rishi 28 Sep: "you choose") | In the demo, registered gilts stay on the gilt-grower batch and registered sows go on the sow (gestation) batch, so each batch's head count equals its animals. Demo seed only. |

## Scope — four plans

**Plan A — silo model, diet rows, forecast engine and report** (detailed plan:
`docs/superpowers/plans/2026-09-25-feed-forecast-a-silo-and-report.md`).
Everything else reads what this creates.
- `silo_shed_link` table replacing `location_master.feed_silo_id` (D7).
- Silo current item from inventory (D8); the one-item and D9 rules at transfer,
  goods receipt and attach time.
- Daily entry draws from the shed's silo holding the posted item (D9).
- Scheduler: one feed line per lifecycle row, by day range (D15).
- Per-farm refill buffer and lead time (D3).
- Forecast engine (pure function) + `GET /feed-forecast` + Inventory → Feed
  Forecast page with the docx columns (D1–D6, D11, D13, D14).

**Plan B — thresholds, alerts, requisition** (written after Plan A lands).
- Silo `low_level_kg`, `high_level_kg` (D10) on the silo form.
- Alert rules master (workbook Master Setup section 4: code, event type,
  trigger entity, threshold reference, priority, recipient roles, channel,
  frequency, escalation, farm filter) and in-app alerts for FEED_BELOW_L1,
  FEED_ABOVE, DIET_CHANGE (3 days), REQ_DEADLINE; recover-and-rearm (checkpoints 11–12).
- Requisition extended for feed: type FEED_FORECAST/MANUAL, purpose
  INTERNAL_TRANSFER, source MILL, lines per silo and item, snapshots, next-diet
  flag, rounding (bulk 3,000 kg multiples, bagged 50 kg bags), >20 % deviation
  needs remarks, own-farm approval only, auto-draft from a forecast run without
  duplicate drafts, submission deadline from a production calendar (Saturday
  default). First web screen for requisitions.

**Plan C — mill, internal transfer orders, receipt** (after Plan B).
- Mill location and Mill Capacity Master (capacity per day and hour, diet
  priority, loading bins, one diet per bin).
- Consolidation sheet (approved farm requisitions only, per diet, capacity
  check, mill-approved quantity with reason), status up to PUSHED (internal).
- Loading instruction sheet (compartment, kg loaded, no two diets in one
  compartment), dispatch → in-app notification.
- Internal Transfer Order per farm per diet with shipped quantity; farm receipt
  against the TO or the requisition through one posting path; shipped vs
  received variance with reason; partial receipts; idempotent posting.
- Outbox rows marking what will be sent to D365BC later (D12).

**Plan D — planning cycle and stock take** (after Plan C).
- Forecast run versions (run ID, as-of, filters, lifecycle version).
- Wednesday tentative plan from five completed weeks of posted consumption vs
  actual (approved requisitions), variance, plan vs mill capacity (GREEN / AMBER
  / RED).
- Reporting Period Master (July–June year, month-end Saturday) and monthly stock
  take for farms and mill: physical count, variance, reason over 2 %, approved
  adjustment, period close blocking later posting.

## Out of scope until asked
Real D365BC calls; SMS/WhatsApp; vehicle-management arrival estimates; a
standard-mortality head-count projection.
