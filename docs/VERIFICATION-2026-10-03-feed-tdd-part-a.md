# Verification — Feed TDD alignment, Part A (Tasks 1–9), 2026-10-03

**Branch** `feat/feed-forecast-requisition-integration`, worktree
`/Users/nero/Desktop/navfarm/.worktrees/feed-forecast-requisition-integration`,
HEAD `061d5c3a`.
**Databases** local only: `nf_devco`, `nf_system` on `127.0.0.1:3306` (TiDB lines
commented out in `apps/api/.env`). The test server was never touched.
**API** `http://127.0.0.1:2877/api/v1`, rebuilt from this worktree's source and
restarted (see "The build that was not the build" below — this mattered).
**Web** `http://localhost:3002`, Next dev server started from this worktree.
**Login** `company.admin@triplec.local` (COMPANY_ADMIN), workspace scope COMPANY.

This is a verification by driving the running application and reading MySQL, as
`CLAUDE.md` and `AGENTS.md` require. Nothing below is asserted on the strength of
a passing test. Where I could not drive a path, it says so.

---

## 0. Headline

Three real defects, found only because the app was driven:

| # | Defect | Owner | Status |
|---|---|---|---|
| **D1** | `POST /feed-requisition/auto-draft` **500s** on any farm with an animal-registered batch — `requisition_line_batch.batch_id` is `varchar(36)` with an FK to `batch_header`, but the engine's row key for a stage-split batch is the 73-char composite `"<batchId>:<stageId>"`. The breakdown insert fails with `ER_DATA_TOO_LONG`. Seven of the nine demo farms cannot draft at all. | **Part A, Task 9** (migration 0143 created the table) | open |
| **D2** | `POST /feed-forecast/runs` ("Save Run") **500s** with the same `ER_DATA_TOO_LONG` on `feed_forecast_run_line.batch_id` for the same reason. Pre-existing (the composite id is from `b06441ee`, 25 Sep), but it has evidently never been exercised. | pre-Part-A | open |
| **D3** | nx replays **another tree** for `api:build` and `web:dev` too, not only `test web`/`lint web`. `pnpm nx run api:build` from inside this worktree writes the **main checkout's** `apps/api/dist`. Running the API from `apps/api/dist/main.js` therefore served a bundle that did not contain the Task 9 review fixes, and produced one false "mismatch" before I caught it. | tooling | documented, workaround below |

Plus four smaller findings (F1–F4) in §6.

All four debts Part A owed this task are **verified** (§2). The forecast and
requisition arithmetic was checked by hand against MySQL and matched exactly
(§3).

---

## 1. Gates (Step 1) — exact counts

Run in this worktree. Per the Amendments, nx was **not** used for the web suite
or lint; `tsc` was also invoked directly rather than through `nx run-many`,
because of D3.

| Gate | Command | Result |
|---|---|---|
| API unit suite | `cd apps/api && npx jest --maxWorkers=2` | **165 suites, 2011 tests, all passed** (12.5 s) |
| Web unit suite | `cd apps/web && ../../node_modules/.bin/jest --maxWorkers=2` | **81 suites, 485 tests, all passed** (6.4 s) |
| API typecheck | `cd apps/api && npx tsc --noEmit -p tsconfig.app.json` | **0 errors** |
| Web typecheck | `cd apps/web && npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| web-e2e typecheck | `cd apps/web-e2e && npx tsc --noEmit -p tsconfig.json` | **0 errors** |
| Web lint | `cd apps/web && npx eslint . --format json` | **93 errors, 925 warnings over 348 files** |

Web lint: the memory baseline is 94 errors as of 2026-09-28; this branch measures
**93**, i.e. no new errors. **Not one error is in a feed file** — the error list
is entirely pre-existing panels (`animal-panel.tsx` 11, `batch-panel.tsx` 8,
`goods-issue-panel.tsx` 6, `goods-receipt-panel.tsx` 6, …). No
`feed-forecast-*`, `feed-requisition-*`, `requisitions-panel`, `feed-planning-*`
file appears. `react-hooks/exhaustive-deps` was not touched.

Nothing in the gates failed, so nothing was routed back.

---

## 2. The four debts Part A owed this task

### Debt 1 — Task 7's `loadSiloFacts` / `loadLatestRequisitionStatuses` SQL had never run

**Verdict: VERIFIED. The SQL runs clean and its output matches MySQL by hand.**

(The brief calls the second method `loadOpenRequisitionStatuses`; in the code it
is `loadLatestRequisitionStatuses`, `feed-forecast.service.ts:1324`.)

```
GET /api/v1/feed-forecast/silo-status?farmId=<GRA100>   → 200, 6641 bytes, 8 rows
```

First row as returned:

```json
{"siloId":"86b562f4-b2c9-49d3-af58-81524764841c","siloCode":"GRA100/SILO-001",
 "houseCodes":["GRA100/SHED-001"],"capacityKg":12000,"belowFeedLevelKg":2400,
 "aboveThresholdKg":10800,"feedInSiloItemName":"Weaner Grower Mash (18% CP)",
 "feedType":"BULK","systemBalanceKg":5172,"lastApprovedCountKg":null,
 "lastFeedReceiptDate":"2026-09-28","dailyRequirementKg":6.6,"daysRemaining":783.6,
 "projectedNeedKg":46.2,"projectedShortfallKg":0,"recommendedOrderKg":0,
 "requisitionStatus":"PENDING_APPROVAL","submissionDeadline":"2026-10-03","alert":null}
```

Checked by hand against MySQL:

```sql
-- systemBalanceKg
select posting_date, entry_type, transaction_type, quantity
from inventory_ledger where warehouse_id='86b562f4-b2c9-49d3-af58-81524764841c'
order by posting_date, created_at;
-- 12 BIO_CONSUMPTION_PREMATURE rows summing to -528.00, one PURCHASE +6000.0000
-- (2026-09-28), one TRANSFER_SHIPMENT -300.0000.
-- 6000 - 300 - 528 = 5172  → matches systemBalanceKg 5172 exactly.
-- lastFeedReceiptDate: the only POSITIVE/PURCHASE row is 2026-09-28 → matches.
```

```sql
-- requisitionStatus (the loader the brief flagged)
select r.req_no, r.status, r.submission_deadline, r.deleted_at,
       l.line_seq, s.location_code
from requisition r join requisition_line l using(requisition_id)
left join location_master s on s.location_id=l.destination_location_id
where r.doc_type='FEED' and r.farm_id='91fc4563-61db-4a04-a1cb-4f78b00df1ac';
-- REQ-GRA100-2026-00001 | PENDING_APPROVAL | 2026-10-03 | NULL | 10000 | GRA100/SILO-001
```

The one GRA100 feed requisition line targets SILO-001 with
`submission_deadline = 2026-10-03`, the same deadline the API computed — and
SILO-001 is the only row in the response carrying a `requisitionStatus`; the
other seven are `null`. The join, the deadline equality, the `notInArray`
exclusion and the newest-wins reduction all behaved. Internal consistency also
holds: `5172 / 6.6 = 783.6` (one decimal), `6.6 × 7 = 46.2`.

The endpoint was additionally called for **eight further farms** (AI100, LEX100,
LEA100, LIO100, MUL100, POR100, RIC100, VIL100) — 200 on every one, 2 to 8 rows
each, no SQL error anywhere.

### Debt 2 — Task 9 had written nothing through the running app

**Verdict: VERIFIED for `requisition_line_batch`, `requisition_date`, the PUT 400
refusals and the `header` payload — on a COUNT_ONLY farm. BLOCKED by D1 on every
animal-registered farm.**

A draft was created by clicking **Draft from forecast** in the browser
(`/inventory/feed-forecast?tab=feed-requisition`, farm LEX100). MySQL
immediately after:

```sql
select * from requisition where req_no='REQ-LEX100-2026-00001'\G
--        req_no: REQ-LEX100-2026-00001        status: AUTO_DRAFT
--      doc_type: FEED                  requisition_type: FEED_FORECAST
--        source: AUTO_FORECAST                  purpose: INTERNAL_TRANSFER
-- supply_source: MILL                          priority: CRITICAL_FIRST_PRIORITY
-- requisition_date: 2026-10-03     submission_deadline: 2026-10-03
--   required_date: 2026-10-05        production_date: 2026-10-04
-- forecast_run_key: RUN-LEX100-20261003-190750
```

`requisition_date` is written on a new draft — the Task 9 column, proven by a
real write, not a fixture.

```sql
select * from requisition_line_batch\G
--     line_batch_id: fb9c8865-…        line_id: 17e0a899-…
--          batch_id: 94f5074b-1020-4441-8a5f-f8d77b725fca
--           shed_id: 346f67d2-…        heads: 120
--      feed_rate_kg: 0.800000       demand_kg: 672.0000
-- first_demand_date: 2026-10-03
```

The batch/house breakdown insert ran for real. On a second **Draft from
forecast** the row was deleted and re-inserted with a new `line_batch_id`
(`fb9c8865…` → `92640bee…`), the rerun behaviour Task 9 designed, observed live.

PUT refusals, driven from the line sub-form in the browser (item changed to
ICAT-004-ITM-0002 with no exception reason, destination left on SILO-001 which
holds Weaner Grower Mash):

```
PUT /api/v1/feed-requisition/811f4503-… → 400 Bad Request
"Line 10000: Feed item differs from the lifecycle requirement: record an exception
 reason (Requisition row 13). Line 10000: Silo holds another feed with stock: choose
 a silo holding this item or an empty one (checkpoint 4)."
```

and MySQL after the 400 showed the line **unchanged** (`item_id` still
`80f9fe4c…`, `destination_location_id` still SILO-001, `quantity_edited` 0) —
the refusal wrote nothing.

The `header` payload was read in the browser and every field cross-checked
against MySQL; the table is in §4.

### Debt 3 — migration 0144, and a one-decimal value actually landing

**Verdict: VERIFIED.** Migration state re-read independently:

```sql
select table_schema, column_type from information_schema.columns
where table_name='requisition_line' and column_name='days_remaining'
  and table_schema in ('nf_devco','nf_system');
-- nf_devco  decimal(10,1)
-- nf_system decimal(10,1)
select 'nf_devco', count(*) from nf_devco.__drizzle_migrations
union all select 'nf_system', count(*) from nf_system.__drizzle_migrations;
-- nf_devco 145 ; nf_system 145
```

A real write through the app landed a one-decimal value:

```sql
select days_remaining from requisition_line where line_seq=10000;  -- 2.7
```

`256 / 96 = 2.6666…` → stored `2.7`. The browser renders it as **2.7** in the
requisition line sub-form ("DAYS REMAINING / FIRST SHORTAGE DATE: 2.7 05/10/26")
and as **2.7** on the silo dashboard. One decimal on both sides, as the workbook
requires (Silo Balance and Stock Take row 9).

### Debt 4 — the silo/item-change blanking and the "capacity unknown" cell

**Verdict: VERIFIED — but only after the API was rebuilt correctly; see D3.**

Driven in the browser: line 10000 moved to LEX100/STORE-001, item changed to
ICAT-004-ITM-0002, exception reason "Vet instruction", Save.

```sql
select * from requisition_line … \G
--            item_id: 8f8518a2-…            description: Exception: Vet instruction
-- destination_location_id: 9d0d8f58-…(STORE-001)  source_type: STORE
--  system_balance_kg: NULL          daily_requirement_kg: NULL
--     days_remaining: NULL           first_shortage_date: NULL
-- recommended_qty_kg: NULL             unrounded_need_kg: NULL
-- exceeds_silo_capacity: 0                quantity_edited: 1
```

All six forecast-derived columns NULL, `exceeds_silo_capacity` false,
`quantity_edited` true, the reason stored with the `Exception: ` prefix.

The UI renders the unknown state, not a false "no warning":

```js
document.querySelector('[data-testid="rqd-capacity-unknown"]')
// text "—", title "Not yet calculated for this silo — rerun the forecast or
//                re-check after changing the destination or item"
```

and the row shows "—" for System Balance, Daily Requirement, Days Remaining and
Recommended Qty.

**The honest part.** On my first pass this check **failed** — all six columns
still held the old silo's numbers. That was not a code defect: the API I was
running had been built by `pnpm nx run api:build`, which wrote the *main
checkout's* dist, so `apps/api/dist/main.js` in this worktree was an 18:01
bundle from an earlier session that predates commit `061d5c3a`
(`grep -c "system_balance_kg: null" dist/main.js` → `0`). After rebuilding the
worktree properly the same UI steps produced the result above. I report the
false alarm because the tooling trap that caused it is itself a finding (D3).

---

## 3. The forecast and the draft, checked by hand (Step 3)

### Choice of farm — a deviation from the brief, stated plainly

The brief says to use "a four-farm demo farm". **The four-farm demo has never
been seeded into `nf_devco`**: `select location_code, location_name from
location_master where location_name like '%Demo Farm%'` returns nothing, and the
fixture's farms (`Demo Farm One`…`Four`,
`src/scripts/demo/four-farm-feed-fixture.ts`) do not exist. The nine seeded farms
(AI100, GRA100, LEA100, LEX100, LIO100, MUL100, POR100, RIC100, VIL100) are what
is there.

Worse, **no seeded farm has a shortage inside the 7-day window**. Calling
`silo-status` on all nine returned `recommendedOrderKg = 0` and no
`firstShortageDate` for every silo; the tightest were RIC100/SILO-002 at 15.2
days and VIL100/SILO-002 at 15.3. So "Draft from forecast" says *"Nothing to
order: stock covers the forecast."* on every farm — I drove that on RIC100 and
on LEX100 and saw exactly that message.

And the longer window is not reachable from the UI (F1 below).

So, to get a real write, I **posted a stock adjustment through the running app**
to create a genuine shortage on the one farm D1 does not block:

- `POST /stock-adjustment` + `/post` → **ADJ-000010**, LEX100/SILO-001,
  −5600 KG Weaner Grower Mash, reason VARIANCE_NEGATIVE, remarks "Task 10
  verification…". Balance 5856 → **256 KG**.
- Restored afterwards: **ADJ-000011**, +5600 KG @ 34.50 (the layer rate from the
  ledger). `select sum(quantity) … where warehouse_id='25944114-…'` → **5856.0000**,
  the original balance.

This is a parameter change to seeded data through the app's own posting path, not
an invented scenario; every rule under test (shortfall, rounding, delivery date,
safety stock, breakdown) is exercised unchanged. **It is still a deviation and
Rishi should know it was needed.**

### The forecast grid, read in the browser

LEX100/SILO-001 after the adjustment, from `GET /feed-forecast/silo-status` and
the Dashboard tab:

```
LEX100/SILO-001 | LEX100/SHED-001 | Bulk | Weaner Grower Mash (18% CP) |
capacity 15,000 | below feed level 3,000 | above threshold 13,500 |
System Balance 256 | last count — | last receipt 28/09/26 |
daily requirement 96 | days remaining 2.7 | first shortage 05/10/26 |
projected need 1,172 | projected shortfall 916 | recommended order 3,000 |
submission deadline 03/10/26 | alert "Critical — first priority"
```

The balance column is labelled **"System Balance"** throughout (cp. 37) — checked
on the dashboard header and on the requisition line sub-form.

### Line-by-line arithmetic, done by hand

Safety stock 0 (company default, `feed_planning_setting` empty for LEX100 at this
point; the API's own `settings` block returned
`{"safetyStockKg":0,"bulkMultipleKg":3000,"bagSizeKg":50}`):

| Quantity | Hand calculation | Stored in MySQL |
|---|---|---|
| daily requirement | 120 heads × 0.8 kg/head/day = **96** | `daily_requirement_kg` 96.0000 ✓ |
| window demand | 96 × 7 days = **672** | breakdown `demand_kg` 672.0000 ✓ |
| unrounded need | 672 demand + 0 safety − 256 opening − 0 confirmed incoming = **416** | `unrounded_need_kg` 416.0000 ✓ |
| recommended | CEILING(416 ÷ 3000) × 3000 = **3000** | `recommended_qty_kg` 3000.0000 ✓ |
| first shortage | close 03/10 = 160, 04/10 = 64, 05/10 would be −32 → **2026-10-05** | `first_shortage_date` 2026-10-05 ✓ |
| delivery date | = first shortage date → **2026-10-05** | `recommended_delivery_date` and `proposed_delivery_date` 2026-10-05 ✓ |
| days remaining | 256 ÷ 96 = 2.666… → **2.7** | `days_remaining` 2.7 ✓ |
| header required date | min line delivery date → **2026-10-05** | `required_date` 2026-10-05 ✓ |

Full row:

```sql
select r.req_no, r.status, r.requisition_date, r.required_date, r.forecast_run_key,
       l.line_seq, l.system_balance_kg, l.daily_requirement_kg, l.days_remaining,
       l.unrounded_need_kg, l.recommended_qty_kg, l.quantity, l.first_shortage_date,
       l.recommended_delivery_date, l.proposed_delivery_date, l.exceeds_silo_capacity,
       l.quantity_edited
from requisition r join requisition_line l using(requisition_id)
where r.farm_id='a985050d-247a-43aa-bb4c-22cb38782367';

REQ-LEX100-2026-00001 | AUTO_DRAFT | 2026-10-03 | 2026-10-05 | RUN-LEX100-20261003-190750
  | 10000 | 256.0000 | 96.0000 | 2.7 | 416.0000 | 3000.0000 | 3000.0000
  | 2026-10-05 | 2026-10-05 | 2026-10-05 | 0 | 0
```

`exceeds_silo_capacity` false is right by hand too: 256 + 3000 = 3256 against a
15,000 KG silo.

### Safety stock 0 → 500, re-draft

Set through the UI (Settings → Inventory Setup → **Silo Feed Setup** → LEX100 →
Safety Stock KG = 500 → Save). It landed:

```sql
select farm_id, safety_stock_kg, is_active, active_scope_key from feed_planning_setting;
-- a985050d-… | 500.00 | 1 | F:a985050d-…
```

**Draft from forecast** again, then MySQL:

```
REQ-LEX100-2026-00001 | 10000 | bal 256.0000 | daily 96.0000 | dr 2.7
                      | need 916.0000 | rec 3000.0000 | qty 3000.0000 | fsd 2026-10-05 | qe 0
```

**416 → 916: exactly +500**, and nothing else moved — balance, daily requirement,
days remaining, first shortage date and the recommendation are unchanged. The
silo's Below Feed Level (3,000 KG) is still nowhere in the shortfall, as the
constraints require.

(The same +500 result was produced twice: once on the first pass and once again
after the correct rebuild. Both are recorded.)

### An edited line keeps its quantity across a rerun

Requested Qty set to **6,000** in the line sub-form → Save:

```
quantity 6000.0000 | quantity_edited 1 | unrounded_need_kg 916.0000 | recommended_qty_kg 3000.0000
```

**Draft from forecast** again:

```
quantity 6000.0000 | quantity_edited 1 | unrounded_need_kg 916.0000 | recommended_qty_kg 3000.0000
```

The farm's own quantity survived the rerun untouched (Ruling M9).

---

## 4. The document, the refusals and the submit (Step 4)

### Delivery date without remarks → refused; with remarks → accepted

Proposed Delivery Date moved 05/10 → **08/10** in the sub-form and saved
(`proposed_delivery_date` 2026-10-08, `required_date` rolled to 2026-10-08,
`recommended_delivery_date` still 2026-10-05). The browser **disabled "Submit for
approval"** and showed the remarks prompt. Submitting through the API with no
remarks to see the server's own refusal:

```
POST /api/v1/feed-requisition/811f4503-…/submit  {}   → 400 Bad Request
"Line 10000 (Dry Sow Gestation Mash (14% CP)): the delivery date differs from the
 forecast's. Remarks are required (Requisition row 29).
 Line 10000 (Dry Sow Gestation Mash (14% CP)): feed item differs from the lifecycle
 requirement (exception). Remarks are required (Requisition row 36)."
```

Both Task 5's row-29 rule and the Task 9 review's row-36 rule fire, and the line
is named by its **item name**, not by the exception description — the
`linesForCheck` join fix, confirmed live.

Remarks typed into the header Remarks box, **Submit for approval** clicked in the
browser:

```sql
select req_no, status, remarks, required_date, approval_request_id,
       proposed_delivery_date, quantity, description …
-- REQ-LEX100-2026-00001 | PENDING_APPROVAL
-- | "Delivery moved to 08/10 at the mill's request; vet instructed the gestation diet for this house."
-- | 2026-10-08 | 3e699add-9905-4d5a-a159-e2819d5327ec | 2026-10-08 | 6000.0000 | Exception: Vet instruction
```

Accepted, an approval request created, and the moved date persisted.

### The item change refusals

Both drove from the UI and both refused with 400 (§2, Debt 2). The exception
reason input appeared in the row **only** once the item differed from
`required_item_id`, as Task 9 specified.

A note on coverage: the brief also asks for "a silo holding another item with
stock". At LEX100 **both** silos hold the same feed (Weaner Grower Mash), so the
cross-silo form of that rule could not be set up there. What I drove is the same
rule's other arm — the line's own destination holding a different feed with stock
— and it refused with the checkpoint-4 message. The two-lines-in-one-silo variant
added by the Task 9 review (*"a silo cannot hold two feeds at once"*) was **not**
driven; it has unit-test evidence only. See §7.

### Header and line, field by field, against MySQL

Read from the browser after submit (read-only document) and compared to the row:

| Document field | Shown | MySQL |
|---|---|---|
| Requisition No. | REQ-LEX100-2026-00001 | `req_no` same ✓ |
| Requisition Date | 03/10/26 | `requisition_date` 2026-10-03 ✓ |
| Requisition Type | From forecast | `requisition_type` FEED_FORECAST ✓ |
| Source | Forecast | `source` AUTO_FORECAST ✓ |
| Farm Code / Farm Name | LEX100 / LIONSHEAD EXTENSION | `location_master` ✓ |
| Is Next Diet Requisition | No | line `is_next_diet` 0 ✓ |
| Status | Waiting for approval | `status` PENDING_APPROVAL ✓ |
| Priority | Urgent | `priority` CRITICAL_FIRST_PRIORITY (label map) ✓ |
| Submission Deadline | 03/10/26 | `submission_deadline` 2026-10-03 ✓ |
| Required Delivery Date | 08/10/26 | `required_date` 2026-10-08 ✓ |
| Supplier or Source | Mill | `supply_source` MILL ✓ |
| Requisition Purpose | Internal Feed Transfer | `purpose` INTERNAL_TRANSFER ✓ |
| Farm Total Requested KG | **0 KG of 30,000 KG target · 0 truck trip(s)** | line `quantity` 6000.0000 — **see F2** |
| Bulk Order Multiple | 3,000 KG | settings default ✓ |
| Approved By / Approval Date Time | — / — | `approved_by` NULL, `approved_at` NULL ✓ |
| Linked Transfer Order No. | — | `linked_transfer_id` NULL ✓ |
| Forecast Run | RUN-LEX100-20261003-190928 | `forecast_run_key` same ✓ |
| Remarks | the typed text | `remarks` same ✓ |

Line columns (15, in workbook order): Line No. **10000** displayed as the
10000-step number, Silo Code LEX100/STORE-001, Feed Item No. ICAT-004-ITM-0002,
Description "Dry Sow Gestation Mash (14% CP)" with "Vet instruction" beneath,
Feed Type **Bagged** (store default), Is Next Diet Line No, Days Before Diet
Change —, Breed Lifecycle Row "Z-Line-Sow WEANER days 1–43"
(`lifecycle_ref_id` b7d9093f-…), System Balance —, Daily Requirement —, Days
Remaining / First Shortage —, Recommended Qty —, Requested Qty **6,000**, Bag
Count **120** (= 6000 ÷ 50 ✓), Proposed Delivery Date 08/10/26. The nested
breakdown table shows BATCH-000023 | LEX100/SHED-001 | 120 | 0.8 |
Z-Line-Sow WEANER days 1–43 | 672, read-only. All match the rows above.

---

## 5. The two 500s, in full

### D1 — the batch/house breakdown cannot be written for an animal-wise batch

`POST /feed-requisition/auto-draft` for RIC100 (`to=2026-11-16`) → **500**. API log:

```
Unhandled Exception: DrizzleQueryError: Failed query: insert into `requisition_line_batch`
 (`line_batch_id`, `line_id`, `batch_id`, `shed_id`, `heads`, `feed_rate_kg`,
  `lifecycle_ref_id`, `demand_kg`, `first_demand_date`, `created_at`) values (?,?,…)
  cause: Error: Data too long for column 'batch_id' at row 1   (ER_DATA_TOO_LONG, 1406)
```

Cause, traced in the source: `feed-forecast.service.ts:499`

```ts
// ANIMAL_WISE groups need distinct ids: the engine keys its rows by (batchId, item).
batchId: animalWise ? `${b.batch_id}:${g.stageId}` : b.batch_id,
```

That composite is 73 characters. `requisition_line_batch.batch_id` is
`varchar(36)` **and** carries
`requisition_line_batch_batch_id_fk  batch_id → batch_header.batch_id`, so
widening the column alone would not help: a composite id is not a batch key at
all. The breakdown needs the real `batch_id` (and, if the stage matters, its own
column).

Blast radius in the demo data: batches with `animal_tracking = 'REGISTERED'` exist
on **RIC100, GRA100, POR100, VIL100, LIO100, LEA100 and MUL100** — seven of nine
farms. Only AI100 and LEX100 can auto-draft, and only LEX100 could be made to
produce a line at all.

Rollback was clean: after the 500, `select count(*) from requisition where
doc_type='FEED'` was unchanged at 4 and `requisition_line_batch` had 0 rows.

### D2 — Save Run has the same problem on `feed_forecast_run_line`

Clicking **Save Run** on the Forecast tab for RIC100 → **500**, surfaced in the
UI as "Internal server error" beside the button. API log:

```
insert into `feed_forecast_run_line` (… `batch_id` …) values
 ('5cfb0707-…','b33b884a-…','2026-10-03',
  '1013720d-aada-4594-adc0-4297d1019a0d:5f1b226d-8f67-42e1-a5e3-2167fedb14ea', …)
  cause: Error: Data too long for column 'batch_id' at row 1
```

Reproduced from the API directly, and bisected:

```
POST /feed-forecast/runs  {farmId: AI100,  2026-10-03 … 2026-10-09} → 201
   data: {runCode:"FFR-7ce78031-4d54-42d3-a80e-6b801573471f-000001", version:1}
POST /feed-forecast/runs  {farmId: RIC100, 2026-10-03 … 2026-10-09} → 500
```

AI100 has only a COUNT_ONLY batch, RIC100 has a REGISTERED one. MySQL after the
201: one `feed_forecast_run` row, 7 `feed_forecast_run_line` rows. The composite
id predates this branch (`b06441ee`, 25 Sep), so D2 is **not** Part A's — but it
means Save Run has never worked on a farm with registered animals, which is most
of them.

---

## 6. Other findings

**F1 — "Draft from forecast" ignores the forecast window the user is looking at.**
`requisitions-panel.tsx:176` posts `{ farmId }` only; `AutoDraftFeedRequisitionDto`
accepts `to` (default planning date + 7, max + 45) and the panel never sends it.
So the draft is always a 7-day draft, however the Forecast tab's Date To is set,
and there is no way to raise a requisition for a shortage 15 or 30 days out from
the UI. This is why the brief's Step 3 could not be completed on the seeded data
without a stock adjustment.

**F2 — "Farm Total Requested KG" reads 0 KG for a 6,000 KG bagged line.**
After the line moved to a STORE its `feed_type` became BAGGED, and the header then
showed `0 KG of 30,000 KG target · 0 truck trip(s)` while the line requests 6,000
KG. The value is the *bulk* total (Task 9 report, "the bulk total … from
`resolveForFeedPlanning`), but the label says *Farm Total Requested KG*, so the
document contradicts its own line. Either the label or the computation needs a
decision from Rishi. Observed, not judged.

**F3 — the saved-run code embeds a UUID.**
`FFR-7ce78031-4d54-42d3-a80e-6b801573471f-000001`. Every other document code in
this app uses the farm *code* (`REQ-LEX100-2026-00001`, `ADJ-000010`), and the
draft's own `forecast_run_key` is `RUN-LEX100-20261003-190928`. Cosmetic, but it
will show in Run history.

**F4 — a drafted requisition does not link to a saved run.**
`requisition.feed_forecast_run_id` was NULL on every draft I made, and
`feed_forecast_run` had no LEX100 row at all; the link is carried only by the
free-text `forecast_run_key`. The document's "Forecast Run" field therefore shows
a key that matches no stored run. Consistent with how Task 9 wrote the view
(`run_code`, falling back to `forecast_run_key`), so probably by design — flagged
because an auditor following that reference will find nothing.

**D3 in detail — nx replays another tree for `api:build` and `web:dev` as well.**
- `pnpm nx run web:dev` from this worktree served the **main checkout**, which
  currently fails to compile (`Module not found: Can't resolve
  './feed-forecast-run-history'` — the file exists here and is tracked, but is
  absent from the main checkout's working tree). The Feed Forecast page 500'd
  until I started Next directly. *(Side note for Rishi: the main checkout on
  `fix/series-and-item-kinds-batch` is currently broken for that page.)*
- `pnpm nx run api:build`, with `--skip-nx-cache`, with `NX_DAEMON=false`, and
  with the worktree's own `./node_modules/.bin/nx` — all three wrote the **main
  checkout's** `apps/api/dist`. Proof: I moved this worktree's `dist/main.js`
  aside, ran the build, nx reported success, and `apps/api/dist/main.js` was
  **still absent**.
- **The workaround that works** (use it, and verify the bundle after):
  ```bash
  cd apps/api && NODE_ENV=production \
    NX_WORKSPACE_ROOT_PATH=<worktree-root> NX_TASK_TARGET_PROJECT=api \
    NX_TASK_TARGET_TARGET=build ../../node_modules/.bin/webpack-cli build
  grep -c "<a string from your newest commit>" dist/main.js   # must be ≥ 1
  ```
  Web: `cd apps/web && ../../node_modules/.bin/next dev --port 3002`.
- Running the API from source (`node --import tsx src/main.ts`) fails on
  `experimentalDecorators`; it is not an escape hatch.

---

## 7. What I could not verify, and why

- **Any auto-draft on an animal-registered farm** (RIC100, GRA100, POR100,
  VIL100, LIO100, LEA100, MUL100) — blocked by D1. Everything in §3 and §4 was
  therefore proven on **one** farm, **one** line and **one** breakdown row.
  Multi-line drafts, per-silo ordering, two lines in one requisition, and the
  truck-trip total over several lines are **not** verified by a live write.
- **Save Run on any farm with a registered batch** — blocked by D2. The one
  saved run is AI100's.
- **The two-lines-in-one-silo refusal** added by the Task 9 review
  (*"a silo cannot hold two feeds at once (checkpoint 4)"*) — needs a
  two-line requisition, which needs D1 fixed. Unit-test evidence only.
- **A capacity warning actually firing** (`exceeds_silo_capacity` true) — the one
  line I could create orders 3,000 KG into a 15,000 KG silo holding 256 KG. Not
  driven.
- **Bagged rounding to the 50 KG bag size** — the one line was BULK until it
  moved to a store, where `bag_count` 120 was computed from an already-rounded
  6,000. The bag-size rounding path itself was not driven.
- **The approval screens** (Part E) — out of scope by ruling, not touched.
- **`nx run-many -t typecheck`** — not run as such; each project's `tsc` was run
  directly because of D3. The counts in §1 are from those direct runs.

## 8. Changes this verification made to `nf_devco`

| What | Why | Reversed? |
|---|---|---|
| ADJ-000010, −5600 KG on LEX100/SILO-001 | create a 7-day shortage so a draft could be raised at all | **yes** — ADJ-000011, +5600 KG @ 34.50; balance back to 5856.0000 |
| `feed_planning_setting` row for LEX100 | the safety-stock 0 → 500 → 0 test | value back to **0.00** (the default); the row remains |
| `feed_forecast_run` FFR-…-000001 (AI100) | proving Save Run works where D2 does not bite | left in place as evidence |
| REQ-LEX100-2026-00001 (PENDING_APPROVAL) | the verification draft | left in place as evidence |
| One earlier REQ-LEX100-2026-00001 | created on the stale bundle; deleted so the rerun was clean | deleted (rows removed from `requisition`, `requisition_line`, `requisition_line_batch`) |

Screenshots: `.playwright-mcp/t10-forecast-ric100.png`,
`t10-requisition-document.png`, `t10-requisition-submitted.png`,
`t10-silo-dashboard-lex100.png` (worktree-local, not committed).

---

# Pass 2 — Part A across several farms (Task 10b), 2026-10-03 evening

**HEAD** `c9c86fc4`. **API** rebuilt from this worktree with the AGENTS.md §8.7
webpack command (`dist/main.js` 20:23). The bundle was checked before use: it
contains c9c86fc4's comment *"A current read, like the version read"* and the
`.for('update')` on the same-day run-code read, plus `RUN-${farmCode}-…`. Old
API PID 77794 was killed and the new one started from `apps/api`
(`node --env-file-if-exists=.env dist/main.js`, **PID 87670**). Web: the
existing `next dev` from `apps/web` was kept (**PID 69923**); it serves this
worktree. Login: the seed dev user (COMPANY_ADMIN) from `seed-dev-tenant.ts`,
through `POST /auth/login` for the API and the login page for the browser.
Database `nf_devco` on 127.0.0.1 only.

**Farms used:** RIC100 (REGISTERED BATCH-000007 + COUNT_ONLY 000008/000009 —
animal-wise stage groups), POR100 (same mix), LEX100 (COUNT_ONLY only — the
batch-wise farm), GRA100 (Save Run and silo-status only). With F1 fixed the
draft window can now be 30 days, so RIC100 and POR100 shortages were reachable
without touching stock; LEX100 still needed a stock adjustment (61 days of
stock > the 45-day reach).

## Headline

| Check | Verdict |
|---|---|
| 1 Auto-draft 201 + rows | **FAIL (one criterion)** — 201 on all three farms; lines, rounding, dates, breakdown (real 36-char batch ids, identity stage, one row per batch/stage/shed) all right. **But no draft links its saved run** — see P2-D1. |
| 2 Rerun | **PASS** for line_seq, moved date, no duplicates, NNN+1; but every rerun saves another run (P2-D1). |
| 3 Save Run | **PASS** — 201 on RIC100, POR100, LEX100, GRA100; run lines carry real batch ids; same-day NNN increments. |
| 4 Alert evaluate RIC100 | **PASS** — 201; DIET_CHANGE subject_id is the real 36-char batch id. |
| 5 Silo status | **PASS with finding** — ACTIVE silos only, System Balance = KG ledger sum on all 24 silos; shortage dates agree with the grid inside 7 days but the dashboard leaves First Shortage blank beyond 7 days where the grid shows a date (P2-F1). |
| 6 Requisition document | **PASS with findings** — all header fields, lines sub-form, nested batch/house rows, one-decimal days; the Forecast Run shown is the time key, not a RUN-…-NNN code (P2-D1); React duplicate-key error on the breakdown (P2-D2). |
| 7 Forecast first load | **PASS** |
| 8 Moved date + remarks | **PASS** |

## Check 1 — auto-draft

`POST /feed-requisition/auto-draft {farmId, to:"2026-11-01"}`:

| Farm | HTTP | Result |
|---|---|---|
| RIC100 | 201 | REQ-RIC100-2026-00002 created, 2 lines |
| POR100 | 201 | REQ-POR100-2026-00002 created, 1 line (SILO-002 rightly left out: REQ-POR100-2026-00001, same cycle, already orders it) |
| LEX100 (after ADJ-000014, −4000 KG) | 201 | REQ-LEX100-2026-00002 created, 1 line |

Before the RIC100 call, the stale `REQ-RIC100-2026-00001` (AUTO_DRAFT written at
19:47 by an earlier bundle, `feed_forecast_run_id` NULL) was **soft-deleted**
(`deleted_at = now()`) so the draft under test was written by this bundle.

Lines (MySQL):

```
req                  seq   dest              type   bal     daily  dr    need     rec    qty    bags fsd=rdd=pdd  xcap
REQ-RIC100-2026-00002 10000 RIC100/SILO-002  BULK   5800    382.5  15.2  4722.5   6000   6000   -    2026-10-19   0
REQ-RIC100-2026-00002 20000 RIC100/STORE-001 BAGGED 0       2.5    NULL  2.5      50     50     1    2026-10-26   0
REQ-POR100-2026-00002 10000 POR100/STORE-001 BAGGED 0       2.5    NULL  2.5      50     50     1    2026-10-26   0
REQ-LEX100-2026-00002 10000 LEX100/SILO-001  BULK   1856    96     19.3  352      3000   3000   -    2026-10-22   0
```

By hand: RIC100/SILO-002 demand over the window = 472.5 + 900 + 150 + 9000 =
10522.5 (= the saved run's line sum for that silo); 10522.5 − 5800 = **4722.5**;
CEILING(4722.5/3000)·3000 = **6000**; 382.5/day for 9 days (FLUSH ends) then
330/day → close 47.5 on 18/10, negative on **19/10**; 5800/382.5 = **15.2**.
LEX100: 96 × 23 demand days = 2208; 2208 − 1856 = **352** → **3000**;
1856/96 = 19.33 → negative on day 20 = **22/10**, **19.3**. Bagged: 2.5 KG →
one 50 KG bag. Capacity: none exceeds. `line_seq` 10000/20000.

Breakdown (`requisition_line_batch`, joined to `batch_header`/`stage_master`):

```
seq   batch_id (len)        batch        tracking    shed            stage      heads rate  demand  first
10000 1013720d-… (36)       BATCH-000007 REGISTERED  RIC100/SHED-001 FLUSH       15   3.5   472.5   2026-10-03
10000 1013720d-… (36)       BATCH-000007 REGISTERED  RIC100/SHED-001 GESTATION   12   2.5   900     2026-10-03
10000 1013720d-… (36)       BATCH-000007 REGISTERED  RIC100/SHED-001 LACTATION   10   2.5   150     2026-10-27
10000 b0dbda0c-… (36)       BATCH-000008 COUNT_ONLY  RIC100/SHED-002 GESTATION  120   2.5   9000    2026-10-03
20000 1013720d-… (36)       BATCH-000007 REGISTERED  RIC100/SHED-001 LACTATION   10   0.25  2.5     2026-10-26
POR   6dea4a3d-… (36)       BATCH-000004 REGISTERED  POR100/SHED-001 LACTATION   10   0.25  2.5     2026-10-26
LEX   94f5074b-… (36)       BATCH-000023 COUNT_ONLY  LEX100/SHED-001 WEANER     120   0.8   2208    2026-10-03
```

Real batch ids, every one 36 characters and an existing `batch_header` row.
The stage is the group's identity stage: `animal_register` for BATCH-000007
holds FLUSH 15, GESTATION 12, LACTATION 10 (+ INSEMINATION 12, FARROWING 9,
no stage 58, whose feeds had no shortage) — heads match exactly; the
LACTATION group's 27/10 demand is on its next (DRY_SOW) lifecycle row but keeps
stage LACTATION, as Task 9b ruled. One row per batch/stage/shed (4 rows, 4
distinct keys on line 10000).

**Run link — FAILED on all three farms.** Each draft *did* save a run
(`RUN-RIC100-20261003-001`, `RUN-POR100-20261003-001`,
`RUN-LEX100-20261003-001` — the new code format is right), but:

```
req_no                 feed_forecast_run_id  forecast_run_key            line feed_forecast_run_line_ids
REQ-RIC100-2026-00002  NULL                  RUN-RIC100-20261003-202605  NULL, NULL
REQ-POR100-2026-00002  NULL                  RUN-POR100-20261003-202802  NULL
REQ-LEX100-2026-00002  NULL                  RUN-LEX100-20261003-202854  NULL
```

See **P2-D1** for the cause.

## Check 2 — rerun

RIC100, same call twice more (before and after moving a date):

- Rerun 1 (unchanged): 201, `created:false`, same requisition, same line ids
  (`b0716c5c…` = 10000, `53ae2ec9…` = 20000), breakdown rewritten (5 rows
  before, 5 after), 1 live RIC100 feed requisition.
- `PUT /feed-requisition/{id}` moving line 10000 to **2026-10-17** → 200;
  `required_date` rolled to 2026-10-17, `recommended_delivery_date` stayed
  2026-10-19.
- Rerun 2: 201; line 10000 still `line_seq 10000`, `proposed_delivery_date
  2026-10-17` (kept), `recommended_delivery_date 2026-10-19`; header
  `required_date 2026-10-17`; breakdown 4 + 1 rows, 4 + 1 distinct keys; still
  one live requisition.
- Run codes the same day: `RUN-RIC100-20261003-001`, `-002`, `-003` (one per
  draft call), then `-004`, `-005` from Save Run — NNN+1 every time. **But** the
  reruns should have *reused* the first run (d418cb72: "a rerun over unchanged
  inputs … reuses the newest run rather than saving another"): `-001`/`-002`
  have identical source hash `a58ed614…` and output hash `e753d188…`, 106 lines
  each. P2-D1 again.

## Check 3 — Save Run

`POST /feed-forecast/runs {farmId, view:CUSTOM, from:2026-10-03, to:2026-10-09}`:

```
RIC100 → 201 RUN-RIC100-20261003-004 (v5)   POR100 → 201 RUN-POR100-20261003-002
LEX100 → 201 RUN-LEX100-20261003-002        GRA100 → 201 RUN-GRA100-20261003-001
RIC100 again → 201 RUN-RIC100-20261003-005 (v6)
```

Every run saved this pass, `feed_forecast_run_line` joined to `batch_header`:
`length(batch_id) > 36` = **0** and orphan ids = **0** on all ten runs;
RIC100/POR100/GRA100 runs carry their REGISTERED batch (BATCH-000007/000004/000013)
as the plain batch id. D2 is fixed.

## Check 4 — alert evaluate

`POST /feed-alert/evaluate {farmId: RIC100}` → **201** (`raised 0`). No diet
change falls within the DIET_CHANGE rule's 3 days, so to exercise the subject
the rule was widened through the app (`PUT /alert-rule/ae7333f3… {threshold_value:30}`)
and evaluated again → 201, `raised 2`:

```
event_type  subject_type subject_id (len)                         batch_no      dedup_key (keeps the composite)
DIET_CHANGE BATCH        1013720d-aada-4594-adc0-4297d1019a0d (36) BATCH-000007  …|1013720d-…:9b09d731-…|8f8518a2-…|2026-10-27
DIET_CHANGE BATCH        1013720d-aada-4594-adc0-4297d1019a0d (36) BATCH-000007  …|1013720d-…:9b09d731-…|19775aab-…|2026-10-26
```

Restored: `threshold_value` back to **3.0000** (read back), evaluated again →
`resolved 2`; both alerts RESOLVED.

## Check 5 — silo-status

`GET /feed-forecast/silo-status` for RIC100, POR100, LEX100, GRA100 → 200 each
(24 rows). Every row is an ACTIVE silo of the farm and every ACTIVE silo has a
row; the only INACTIVE silo in the database (FARM-001/SILO-001) is on a farm
the endpoint refuses (404 "Farm not found"). `systemBalanceKg` equals
`SUM(inventory_ledger.quantity)` for `uom='KG'` on **all 24 silos** (no non-KG
rows exist), e.g. RIC100/SILO-001 3913.6, LEX100/SILO-001 1856 during the
shortage and 5856 after the reversal, GRA100/SILO-008 0.

Shortage dates: at today's planning date the dashboard's `firstShortageDate` is
null on every silo (its window is 7 days), while the forecast grid's First
Shortage Date shows **19/10/26** for RIC100 and POR100 SILO-002 and **22/10/26**
for LEX100/SILO-001. With `planningDate=2026-10-17` both agree:
RIC100/SILO-002 19/10 = 19/10, POR100/SILO-002 19/10 = 19/10, LEX100/SILO-001
22/10 = 22/10. See P2-F1.

## Check 6 — requisition document (browser)

REQ-RIC100-2026-00002 opened in Feed Forecast → Internal Feed Transfer.
Header read from the page: Requisition No. REQ-RIC100-2026-00002 · Date 03/10/26
· From forecast · Source Forecast · RIC100 / RICHLANDS FARM · Is Next Diet Yes
· Draft (forecast) · Priority Info · Submission Deadline 03/10/26 · Required
Delivery Date 17/10/26 · Mill · **Internal Feed Transfer** · **Bulk total
requested (vs truck target): 6,000 KG of 30,000 KG target · 1 truck trip(s)** ·
**Bagged total requested: 50 KG · 1 bags (50 KG each)** · Bulk Order Multiple
3,000 KG · Approved By — · Linked Transfer — · **Forecast Run
RUN-RIC100-20261003-202722** (the time key, because of P2-D1) · Remarks.
All match MySQL. Lines sub-form: 15 columns in workbook order, Line No. 10000 /
20000, Days Remaining **15.2** (one decimal) over 19/10/26, Recommended 6,000
with "need 4,722.5", Bag Count 1, nested BATCH NO. / HOUSE / HEADS / RATE /
LIFECYCLE ROW / DEMAND KG rows exactly as in check 1. Line 20000's days
remaining shows "—" (stored NULL: no demand today, balance 0).

Screenshots: `.playwright-mcp/t10b-requisition-header-ric100.jpg`,
`t10b-requisition-lines-ric100.jpg`, `t10b-requisition-submitted-ric100.jpg`.

## Check 7 — forecast first load (browser)

Fresh load of `/inventory/feed-forecast`: View Custom, Date From **03/10/2026**,
Date To **09/10/2026** (From + 6). RIC100 grid headers, read from the DOM:
`BATCH NO, ITEM NAME, ITEM NO, SHED NO, SYSTEM BALANCE (KG), CURRENT NO. OF
PIGS, PER DAY INTAKE (KG), 03/10/26 … 09/10/26, CURRENT NO OF DAYS STOCK,
FIRST SHORTAGE DATE` — dates as columns. Cells that are exactly "-", "–" or
"—": **0**. Empty cells: 2 (First Shortage Date on the two rows with no
shortage). Screenshots: `t10b-forecast-first-load.jpg`,
`t10b-forecast-grid-ric100.jpg`.

## Check 8 — moved date and remarks

With line 10000 moved to 17/10 (check 2): the browser disabled **Submit for
approval**; `POST /feed-requisition/{id}/submit {}` → **400** "Line 10000 (Dry
Sow Gestation Mash (14% CP)): the delivery date differs from the forecast's.
Remarks are required (Requisition row 29)." — MySQL unchanged (AUTO_DRAFT,
remarks NULL). Remarks typed, Save, Submit in the browser → "Submitted for
approval."; MySQL: `PENDING_APPROVAL`, remarks stored, `approval_request_id
b58fa168…`, `proposed_delivery_date 2026-10-17`, `required_date 2026-10-17`.

## Defects and findings (reported, not fixed)

**P2-D1 (Part A, Task 9c F4) — auto-draft never links the run it saves, and
saves a new one on every rerun.** `feed_forecast_run_id`, line
`feed_forecast_run_line_ids` NULL and `forecast_run_key` the time key on
RIC100, POR100 and LEX100; RIC100 reruns made `-001`, `-002`, `-003` with
identical hashes. Probable cause (read from code and data, not instrumented):
`autoDraft` computes its forecast with `computeForFarm(…, { to })`, so
`horizonTo = to` (2026-11-01), while `saveRun` goes through `getForecast`, which
passes `horizonTo: reach` (planning date + 45). `horizonTo` is part of the
engine input (`feed-forecast.service.ts` loadInput, `horizonTo: opts.horizonTo`),
so the source hash can never match: every saved run's
`source_snapshot.values.engineInput.horizonTo` is `"2026-11-17"`.
`matchingPersistedRun` then returns null on its first test. Unit tests pass
because they stub both forecasts.

**P2-D2 (Part A, Task 9) — duplicate React key in the breakdown table.**
`feed-requisition-document.tsx:350` keys rows by
`` `${b.batch_id}|${b.shed_id}` ``; a registered batch has several stage groups
in one house, so the console logs "Encountered two children with the same key
… 1013720d-…|896f19de-…" (four times on REQ-RIC100-2026-00002). Rows render
today, but React may duplicate or drop them on update. The stage belongs in
the key.

**P2-F1 (decision for Rishi) — Dashboard First Shortage Date vs the grid.**
The silo dashboard leaves First Shortage Date blank for a shortage 8–45 days
out (its forecast is 7 days) while showing Days Remaining 15.2, and the
Forecast grid shows 19/10/26 for the same silo. They agree when the shortage
falls inside 7 days.

**P2-F2 (minor) — remarks error text names only two causes.** The red error
under Remarks reads "a quantity is more than 20% off the recommendation, or the
deadline has passed" even when the cause is a moved delivery date
(`rqRemarksRequired`); the hint below it (`rqdRemarksHint`) lists all four.

**Observation, not judged:** the grid's "Current No of Days Stock" is the
silo's balance on the window's *last* day divided by that row's own intake
(RIC100 FLUSH 3,505 / 52.5 = 66.8, BATCH-000008 3,505 / 300 = 11.7), so three
rows sharing one silo show 66.8, 116.8 and 11.7 days.

## Changes this pass made to `nf_devco`

| What | Reversed? |
|---|---|
| ADJ-000014 −4000 KG LEX100/SILO-001 @ 34.50 (balance 5856 → 1856) | **yes** — ADJ-000015 +4000 @ 34.50; `SUM(quantity)` read back **5856.0000**; silo-status 5856 |
| DIET_CHANGE rule threshold 3 → 30 | **yes** — back to 3.0000 (read back); the 2 alerts it raised are RESOLVED |
| REQ-RIC100-2026-00001 (stale AUTO_DRAFT from an earlier bundle) | soft-deleted (`deleted_at`) |
| REQ-RIC100-2026-00002 | left as evidence, PENDING_APPROVAL |
| REQ-POR100-2026-00002 | left as evidence, AUTO_DRAFT |
| REQ-LEX100-2026-00002 | soft-deleted by the app itself on a rerun after the stock was restored ("Nothing to order") |
| Saved runs RUN-RIC100-…-001…005, RUN-POR100-…-001/002, RUN-LEX100-…-001/002, RUN-GRA100-…-001 | left as evidence |

# Part A closure — 2026-10-03 night

Part A's task list is complete: Tasks 1–10 plus the follow-ons 7b, 8b, 9b, 9c, 9d,
each with a task review and, where a review found something, a fix round and a
scoped re-review.

## What the live evidence actually covers

Read this before treating Part A as proven, because the coverage is uneven by
accident of what was broken when.

- **Pass 1** (Task 10) reached **one farm and one line**. It could not do better:
  auto-draft returned 500 on 7 of 9 demo farms, and no farm had a 7-day shortage,
  so a stock adjustment had to be posted to produce any live write at all.
- **Pass 2** (Task 10b) reached **four farms** — RIC100, POR100, LEX100 (batch-wise)
  and GRA100 — once Task 9b fixed the 500s. Checks 2–8 passed with MySQL evidence;
  check 1 failed on run linking, which became defect D1.
- **Task 9d** closed D1, D2, F1 and F2, and **D1 is live-proven**:
  - the running bundle was proven to be the branch's own code — a fresh webpack
    build reproduced `dist/main.js` byte-for-byte and the bundle carries both of
    D1's guards (this matters: nx replays the main checkout in this worktree, and
    an earlier session chased a false failure from a stale bundle);
  - on LEX100, auto-draft returned `201 created:true` then `201 created:false`;
  - `REQ-LEX100-2026-00003.feed_forecast_run_id` resolves to
    `RUN-LEX100-20261003-003`, all 23 of its line's run-line ids belong to that run
    and none to any other, and LEX100's run count went 2 → 3 → 3, so the second
    draft saved no run. `REQ-GRA100-2026-00002` corroborates the link.
  - The three pass-2 requisitions (LEX100-00002, POR100-00002, RIC100-00002) remain
    `NULL`, so the before and after of D1 sit side by side in the data.
  - Stock: ADJ-000016 −4000 (5856 → 1856), reversed by ADJ-000017 +4000, **read back
    5856.0000**.

The requisition writer, the batch/house breakdown, `requisition_date`, the PUT
refusals, the document header, silo-status SQL (whose query had never once run
against MySQL before Task 10), and the one-decimal `days_remaining` are all proven
by writes made through the running application and read back from `nf_devco` — not
by seeded rows and not by a green suite. Part A's own history is the reason that
distinction is spelled out: a 73-character composite batch key reached a
`varchar(36)` column with a foreign key, and **all 2,011 API tests passed over it**
until a farm was driven in a browser.

## What is NOT proven, and what changed beyond the defects

- No farm in the demo data naturally carries a 7-day shortage, so every live draft
  rests on a stock adjustment made and then reversed. A farm with a genuine
  in-window shortage has never been drafted from.
- **F1 is a deliberate behaviour change wider than the defect it fixed:** every
  farm's silo dashboard now shows a First Shortage Date for shortages 8–45 days out,
  not only the case that was blank. This matches what the forecast grid already did
  and the workbook sets no window limit (Dashboard row 55 / Master Setup row 15).
- `siloStatus` now walks up to 45 days in memory per request instead of 7. Confirmed
  not a per-silo database round-trip, so bounded today — worth remembering for a
  farm with dozens of silos.
- The fix for **Save Run**'s identical composite-key 500 is on this branch but the
  defect is **pre-existing** (`b06441ee`, before this branch), so Save Run is broken
  for animal-wise farms on `main` today. It is separable into its own PR.
- A throwaway database `nf_replay_feed_tdd` was left in place from a migration
  replay; it is Rishi's to drop.

## Not yet done

The final whole-branch review has not run, and a list of deferred Minor findings
from the task reviews is waiting on it for triage. Part A should not be merged
until that review has triaged them.
