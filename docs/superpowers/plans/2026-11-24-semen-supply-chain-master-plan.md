# Plan — Semen supply chain: requisition, AI Station dashboard, 4-day QC, farm receipt QC

**Date:** 24 Nov 2026 · **Asked by:** the client (via Arun) · **Status:** DRAFT for Arun's go-ahead. Nothing built. This replaces the point-by-point notes in `2026-11-23-semen-qc-rounds-and-farm-receipt.md`, which stays as the detailed QC design (Phases 1 and 2 below point to it).

## The client's four points, in Arun's words

1. One farm raises a **requisition** for semen to another farm; the semen-collection farm **plans** the boar collection from the requests; a user can also **collect semen stand-alone**.
2. An **AI Station dashboard** with every figure and filters, including the mini report: *Requested 100, Received 90, Used 70, Destroyed 20*.
3. **Semen QC over collection day + 4 days**, set up for the semen item only.
4. When a farm **receives** semen it is **QC'd again** before insemination; a **transfer receipt applies QC whenever the item has the QC flag on**.

## What the code already gives us (read 24 Nov)

| Need | Already there | Gap |
|---|---|---|
| Requisition between farms | Common requisition, purpose `STORE`: from/to location, lines, approval, **release creates a stock transfer** (`procurement/requisition/requisition.service.ts`). Fulfilment status NOT_APPLICABLE → RECEIVED. | Nothing semen-specific: no line (breed) on it, no need-by-date meaning, no link to a collection plan. Consolidation exists for **feed only** (`feed_consolidation`). |
| Plan a collection | `semen_collection_plan` (line, date, boars, collectors, destination farm, status). Boar Selection tab. Line setup decides if a plan is mandatory (Z-Line is). | No target dose count, no link to the requests it serves. |
| Collect stand-alone | `POST /piggery/breeding/semen-collection` works with or without a plan, unless the line's setup requires a plan. | Nothing to do beyond confirming it (Phase 0). |
| Send semen to a farm | Stock transfer; `SemenDestinationService` enforces where a line's semen may go. | — |
| QC at transfer receipt | `stock-transfer.service.ts`: both receipt paths call `qcInspections.raise()` **when the item has `is_qc_required`** (`TRANSFER_RECEIPT`, `TRANSFER_EVENT`); stock is posted only on acceptance; rejected goes back to the sender. | Point 4's second half is **already built** for every item. Need to prove it for a semen lot, and add the semen gate below. |
| Block use of unreleased semen | `assertNotHeldByQc` in `semen-lot.service.ts`: reads the **collection** inspection only. | It does not look at the **farm receipt** inspection, so a lot received at a farm but not yet QC'd there may still be insemination-eligible. Real gap. |
| Doses used / sold | `semen_batch.doses_used_internal`, `doses_sold`; inventory ledger issues by lot. | No "destroyed" anywhere. Per-farm "used" is not on the lot (it is global): derive from ledger issues at the farm's store. |
| Semen item identity | The line setup names the output item. **No "is semen" flag on the item.** | So "QC for 4 days only for semen" must be a setting on the item's QC setup, not a hard-coded rule. |
| AI Station screen | `/livestock/ai-station` = `breeding-panel.tsx` with tabs Semen Collection, Boar Selection, Boar Condition; four tiles above the list. | No dashboard, no filters beyond search. |

## Point 3: how the 4-day QC is set up (answer to "how to QC setup 4 days only for the semen item")

Principle: nothing about semen is written into code (AGENTS.md §10: nothing the client gave is a constant). It is a setting on the item.

1. **Item master → QC Specification tab** (already holds the checks for a QC item). Add one field there: **QC rounds** (a number, default 1 = today's behaviour). For the semen item set it to **5** (collection day + 4 days). Every other QC item stays at 1 and is untouched.
2. **Each check line gets a "Stage"** (it already has a `stage` column that nothing reads): `COLLECTION` (applies on every round), `FARM_RECEIPT` (applies only when the lot reaches a farm). Optionally "from round / to round" if some checks happen only on day 0 or day 4. Recommended default: every collection check repeats on every round.
3. **When a semen lot is collected**, one inspection is raised with 5 dated rounds (day 0 to day 4). The inspector records readings round by round; the **QC Inspection list gets a "Due today / overdue" filter** so nobody forgets day 3.
4. **Result:** all five rounds pass → clear pass, stock posted (or released, see Q1). Any mandatory failure → whole lot rejected (fully accepted or fully rejected, as already decided).
5. **The shelf-life risk:** boar semen is short-lived. If doses can only be used after day 4, what is left of `shelf_life_days`? The screen should show "clear pass on <date>, expires <date>" so it is obvious. This is Q1 for the client and decides whether Phase 3 (release early, recall on failure) is needed.

## Point 1: requisition → consolidation → collection plan → send

**Reuse, do not rebuild.** A semen request is a Store requisition (purpose `STORE`): from = the collection farm's store, to = the requesting farm's store, one line = semen item, quantity in doses.

- Add on the requisition: the **breeding line (breed)** and a **needed-by date** (semen-type requisitions only), and a `requisition_type = 'SEMEN'` so it is listed apart from feed. Normal approval flow is unchanged.
- **Consolidation** (new, modelled on feed consolidation, but small): an AI Station **Requests** tab lists approved, un-served semen requisitions grouped by line and needed-by date, with the total doses per line. "Plan collection" opens the existing Plan dialog **pre-filled** (line, date, destination, target doses) and writes `semen_collection_plan.target_doses` plus a link table `semen_plan_requisition` (plan, requisition line, doses).
- **After collection and QC clear**, "Allocate & send": the lot's doses are split across the linked requisitions (earliest need-by first, any shortfall shown), and one **stock transfer per requesting farm** is created through the existing release path, so `SemenDestinationService` and the farm-receipt QC run as they do today.
- **Stand-alone collection** stays as is: no plan, no requests; the lot goes to the collection farm's stock and can later be allocated to a request or sent by an ordinary transfer. A line whose setup requires a plan (Z-Line) keeps refusing a collection without one; that is the client's own rule, not changed.

## Point 2: AI Station dashboard

A new **Dashboard** tab (first tab) on `/livestock/ai-station`, backed by one endpoint `GET /piggery/ai-station/dashboard`.

- **Filters:** date range, collection farm, requesting farm, breeding line, boar, lot no., requisition status, QC state (pending / passed / failed), semen item.
- **Tiles:** Requested, Received, Used, Destroyed, On hand, QC pending, QC failed, Average cost per dose.
- **Mini report (per requisition, per farm, per lot, switchable):** `Requested 100 · Received 90 · Used 70 · Destroyed 20` with the check *Received = Used + Destroyed + On hand* and a Short-shipped figure (Requested − Received).
  - Requested: requisition lines.
  - Received: posted transfer receipts (accepted into stock).
  - Used: ledger issues of the lot at the receiving farm's store (matings), not the lot-wide counter.
  - Destroyed: **new** `semen_dose_disposal` document (lot, farm, doses, reason, date) plus automatic rows when a farm-receipt QC rejects the lot or an inspection fails. Expiry write-offs use the same document.
- Rows link to the requisition, the lot, the QC inspection (reuse `QcLink`), and the traceability page.
- Export to CSV like other lists.

## Point 4: farm receipt QC

1. **Prove first** (Phase 0): collect a semen lot of a QC item, send it by transfer to a farm, receive it, read MySQL: confirm a `TRANSFER_RECEIPT` inspection is raised, stock is held at the farm store, and a rejection returns to the sender.
2. **Use the farm-receipt checks:** `raise()` picks the spec lines by stage, so the farm sees the `FARM_RECEIPT` checks (for example motility under the microscope), not the 5-round collection set. One round.
3. **Gate insemination:** extend `assertNotHeldByQc` so a lot that was transferred to the sow's farm needs a passed farm-receipt inspection there. A lot with no QC item behaves exactly as before.
4. **Rejected doses:** go back to the sender (existing rule) or are scrapped, and show as **Destroyed** on the dashboard.

## Phases and order

0. **Verify, no code.** Collect → transfer → receive → mate; stand-alone collection; read MySQL at each step; note what raised an inspection and what blocked. (Half a day.)
1. **QC rounds** (point 3): migration (rounds table, `qc_rounds` on item, stage on lines), `raise()`/`complete()`, dialog round tabs, Due filter. Detailed design in the 23 Nov plan.
2. **Farm receipt QC** (point 4): stage-aware `raise()`, the insemination gate, proof through the API.
3. **Destroyed doses**: `semen_dose_disposal`, auto-rows from rejections, a small entry dialog.
4. **Semen requisition + consolidation** (point 1): requisition type and fields, Requests tab, plan pre-fill, allocation and transfers.
5. **Dashboard** (point 2): endpoint, filters, tiles, mini report, export. Built last because it reads everything above.
6. **Optional, only if the client says so (Q1):** release on day 0, recall on a failed round.

Each phase is proved by posting real documents through the API and reading MySQL, then driving the web screen (CLAUDE.md: a green suite is not evidence). Cleanup by tag only.

## Phase 1 as built (24 Nov): QC rounds

- **Migration `0263_qc_inspection_rounds`:** `item_master.qc_rounds` (default 1), `qc_inspection.rounds` (default 1), `qc_inspection_line.round_no` (default 0), table `qc_inspection_round` (one row per round: due date, PENDING/DONE/CANCELLED, PASS/FAIL, who and when). Additive: every existing item and inspection stays a single check with no round rows. Applied to nf_devco and nf_system (both "complete (263 recorded)"), backups first.
- **Setting:** Item card → Inventory → **QC Rounds** (shown when QC Required is on, 1 to 10). The semen item `ITM-0004` on nf_devco is set to **5**. A transfer receipt is always one round (`roundsFor`).
- **Raising:** one set of the item's checks per round; round N is due on the collection/receipt date + N days.
- **Recording:** `POST /qc-inspection/:id/rounds/:roundNo` records one round (in order, on or after its due date, never the last). Nothing is posted.
- **Completing:** the last round's readings come with `complete`, once every other round is recorded and the last is due. All pass → stock posted then. A failed round lets the inspection be completed at once as a rejection; the rounds still to come are CANCELLED. The lot stays unusable for matings until the clear pass (`assertNotHeldByQc`, unchanged).
- **List:** "Due today" filter (`?due=DUE`: open inspections with a round due today or overdue) and "Rounds 2/5 · next due" under the status. **Dialog:** a strip of the rounds (date and Pass/Fail/Due/Overdue/Cancelled), one round's checks at a time, "Record Day N", and "Complete inspection" on the last round or after a failure.
- **Pure rules** `roundsFor`, `roundDueDate`, `roundToRecordProblem`, `completionPlan`, `roundResult` in `qc-inspection.rules.ts`, tested in `qc-inspection.rounds.spec.ts`; migration guard `qc-inspection-rounds-migration.spec.ts`. The 0262 spec now finds its entry by tag (it assumed it was the last migration).
- **Proof through the API, read back from MySQL** (all lots tagged `PHASE1-VERIFY`, boar PIG-2024-0016):
  - Case A, `LOT-00059` / `QC-000008`, collected 16 Nov: days 0 to 3 recorded, day 4 refused on its own, completed with day 4 → CLOSED/PASS, 5 rounds DONE/PASS, one OUTPUT of 3 doses posted on completion.
  - Case B, `LOT-00058` / `QC-000007`, collected 23 Nov: completing first refused; day 2 before day 0 refused; day 0 twice refused; day 1 FAIL recorded; day 2 after the failure refused; mating refused while open; completed → CLOSED/FAIL, rounds 2 to 4 CANCELLED, **no ledger row**.
  - Case C, `LOT-00060` / `QC-000009`, collected 23 Nov: day 0 recorded and **left open** (day 1 due today); it is the only row in the Due list.
  - Older inspections (QC-000001, 005, 006) still have `rounds = 1` and no round rows.
- **Not verified in the browser:** the web app on 3002 runs `nx run web:start` (a production build), so it shows none of this until it is restarted (which rebuilds it). The dev port is fixed at 3002, so no second server was started.
- **Open:** Q1 (may doses be used before the clear pass?) is still the client's. A collection before the lot's 4-day window is complete holds stock that long; check the semen's shelf life against it.

## Phase 5 as built (24 Nov): AI Station dashboard

- **`GET /piggery/ai-station/dashboard`** (read only, no migration): tiles, the client's one-line report, the report **by request, by farm and by lot**, under one set of filters: from / to (a request's needed-by date, a lot's collection date), AI Station farm (where it was collected and sent from), requesting farm, line, boar, lot no., item, request status (Open / Shipped / Received / Cancelled), lot QC (pending / passed / failed / none). A farm filter narrows the lots to those sent to that farm's requests; a farm-bound user sees only requests to or from their farm.
- **What each figure is** (`ai-station-report.rules.ts`, pure, tested): Requested = the request line's doses. **Received = doses that landed in the farm's store**: posted TRANSFER_RECEIPT entries of the request's transfer lines, i.e. after the farm's receipt QC accepted them (this answers the Phase 4 note). Pending QC = held by that QC. Rejected = refused by it (back to the sender). Used = matings (CONSUMPTION, BREEDING) of the lot at that store. Destroyed = the lot written off there (Phase 3). On hand = received − used − destroyed. Short = requested − received − pending − rejected. Requests sharing a lot at one store share its use and destruction, earliest needed first, each up to what it received. The client's example gives exactly "Requested: 100, Received: 90, Used: 70, Destroyed: 20" (spec).
- **Lots:** collected, allocated to requests, used, sold, destroyed (written off + QC scrap), on hand (ledger, every store), cost per dose, collection QC state.
- **Tiles:** Requested, Received, Used, Destroyed, Pending QC, Short, On hand (+ lots), QC (lots pending / failed, farm checks open), cost per dose (lot costs ÷ doses collected).
- **Web:** AI Station → **Dashboard**, now the first tab (`ai-station-dashboard.tsx`): the filters, the tiles, the one-line report, By request / By farm / By lot with totals, **Export CSV** of the table shown, and a note on what each figure means. Not seen in a browser (3002 still serves the old build).
- **Tests:** `ai-station-report.rules.spec.ts` (5); the dashboard controller added to `farm-scope-coverage.spec.ts`. Breeding suites pass except the old controller route count; the web piggery specs pass except `breeding-rules.spec.ts` (checkMating), whose files are not changed here.
- **Proof, read back from MySQL** (`PHASE5-VERIFY`): `QC-000012` (REQ-2026-0001's farm receipt) passed; 1 dose of LOT-00063 destroyed at POR100 (`SD-000004`); a second mating of PIG-2024-0004 refused (she has an open service), so nothing is used. The dashboard then reads **"Requested: 2, Received: 2, Used: 0, Destroyed: 1"**, REQ-2026-0001 on hand 1, short 0, and every figure matches MySQL: received 2 (TRANSFER_RECEIPT on the request's transfer line), 1 dose of LOT-00063 at POR100, on hand 738 across all semen lots, destroyed 5 (written off + QC scrap), 841 doses collected in 33 lots, 11.42 a dose. Filters checked: requesting farm POR100 → 1 request, LOT-00063; lot QC failed → LOT-00060/55/58 and no requests; lot LOT-00063; from 27 Nov → nothing; boar PIG-2024-0020 → its lots and the request served by LOT-00063; request status Received → REQ-2026-0001.

## Phase 4 as built (24 Nov): semen requisition, consolidation, allocation

- **No new document.** A semen request is an ordinary **Store requisition** (AI Station store → farm store, the semen item, doses, needed-by = `required_date`) that names the breeding line: new column `requisition.breed_id` (Store only, breed checked; kept when omitted on update). Approval, release (which creates the transfer), shipping and receiving are the requisition's own, unchanged; receiving raises the farm's receipt QC (Phase 2).
- **Migration `0265_semen_requisition`:** `requisition.breed_id`, `semen_collection_plan.target_doses`, table `semen_plan_requisition` (plan, requisition line, doses, the lot allocated, when; one link per request line). Applied to nf_devco and nf_system ("complete (265 recorded)"), backups first.
- **Requests:** `GET /piggery/semen-requests` (OPEN: approved, not cancelled, not fully received; or ALL), each line with farm, stores, line, needed-by, doses, status, plan, lot, shipped/received.
- **Consolidation:** `POST /piggery/collection-plans` takes `requisition_line_ids`: they must be approved requests of the plan's line not planned elsewhere (all reasons given at once); the plan's `target_doses` is their sum and the links are written in the plan's transaction. The plan's detail lists its requests.
- **Allocation:** `POST /piggery/semen-requests/allocate {semen_batch_id, requisition_line_ids?}` (default: the requests linked to the lot's plan). Refused until the lot is stock (QC accepted). Free doses = the lot at its collection store less doses already promised to unshipped requests. Earliest needed first, each request **whole** (never split), while doses last; skipped with the reason: not released, from another store, already has a lot, too few doses left, another line or item. Each allocation calls the requisition's own **Item Tracking** (`assignTracking`), so the lot lands on the requisition line and its transfer line.
- **Rules + tests:** `semen-request.rules.ts` (`planRequestProblems`, `allocationPlan`), `semen-request.rules.spec.ts`; migration guard `semen-requisition-migration.spec.ts`; both new controllers added to `farm-scope-coverage.spec.ts`. API suites: 675 of 676 (the old breeding-controller route count). The farm-scope coverage spec still lists `fa-conversion` and `kill-sheets` controllers as unclassified; that predates this work.
- **Web:** AI Station → **Requests** tab (`semen-requests-panel.tsx`): open/all and line filters, requested / planned / allocated totals, the list with status, **New request** (raises and submits the Store requisition), **Plan collection** (ticked approved requests of one line: day, boars of the line; target = their doses), **Allocate lot** (a lot that passed QC; shows what was allocated and what was skipped and why). Compiles; the 15 failing web spec files are about other screens (posting group, date formats, requisition dialogs, GM dashboard) and none names a file changed here. **Not seen in a browser** (3002 still serves the old build).
- **Proof through the API, read back from MySQL** (`PHASE4-VERIFY`):
  - `REQ-2026-0001`: POR100 asks for 2 doses of Z-Line-Sow from MUL100/STORE-001 to POR100/STORE-001, needed 26 Nov. Created and submitted as tenant.admin (the farm user `por100.entry` was refused "Select an operational area first": the app needs the area the web sends), approved and released as company.admin → transfer created, listed as an open request.
  - Plan `CP-20261128-02` (28 Nov, PIG-2024-0016) from it: `target_doses` 2, linked. A second plan with the same request: refused "already planned in another collection".
  - Stand-alone lot `LOT-00063` (PIG-2024-0020, 15 Nov, 4 doses): allocation before QC refused; 5 QC rounds passed (`QC-000011`); allocated → REQ-2026-0001 line and its transfer line carry LOT-00063, link records the lot, 2 doses left free; a second allocation skipped it ("already has lot LOT-00063").
  - Shipped (`SH-2026-0001`, -2 at MUL100) and received through the requisition: requisition RECEIVED, and the receipt raised `QC-000012` (TRANSFER_EVENT, 1 round, the one Farm-receipt check) at POR100, nothing posted there until it passes.
- **For the dashboard (Phase 5):** a requisition counts as Received when the receipt is posted, before the farm QC accepts it. The mini report's "Received" should probably be the accepted quantity; to confirm with the client.

## Phase 3 as built (24 Nov): destroyed doses

- **Migration `0264_semen_dose_disposal`:** table `semen_dose_disposal` (number `SD-nnnnnn` from its own series, lot, store, farm, doses, date, reason, source, QC inspection, ledger entry, cost) and `semen_batch.doses_destroyed` (default 0). Applied to nf_devco and nf_system ("complete (264 recorded)"), backups first.
- **Destroying doses** (`POST /piggery/semen-disposal/:lotId`): written off **where they are**, as a `VARIANCE_NEGATIVE` entry (document `SEMEN_DISPOSAL`) on that store, costed from the lot's own layer there, with its journal (Inventory Adjustment Loss / Inventory); counted in `doses_destroyed`. The store is asked for only when several hold the lot. Reasons: Expired, Damaged or spoiled, Failed QC, Other (Other needs remarks). Refused: more than the store holds, a future date, a date before collection, a lot still held by its QC ("reject it there instead"). `GET /piggery/semen-disposal` lists them (by lot, farm, dates); `GET /piggery/semen-disposal/stock/:lotId` says where a lot's doses are.
- **QC scrap rows:** when a semen collection's QC rejects doses with disposition **Scrap** (on completion, on a refused deviation, or when a held rejection is settled), a disposal row is written automatically (`QC_REJECTION`, reason Failed QC, the inspection linked). No ledger entry (they were never stock) and `doses_destroyed` untouched (the inspection already took them off `doses_collected`). A transfer receipt's rejection goes back to the sender, as before, so it records nothing.
- **Doses left** everywhere = collected − used − sold − destroyed: the mating check (`issueDoses`), the lot page and the AI Station tile. Two additive lines in `breeding.service.ts` (the costing session's file; it was told).
- **Web:** the semen lot page has a "Destroyed" figure, a "Destroyed doses" table (number, date, where, doses, reason with the QC inspection, cost, note) and a **Destroy doses** dialog (store only when needed, doses with what the store holds, date, reason, remarks).
- **Tests:** `semen-disposal.rules.spec.ts`, migration guard `semen-dose-disposal-migration.spec.ts`; 442 of 443 pass across breeding, QC and migrations (the one failure is the old breeding-controller route count).
- **Proof through the API, read back from MySQL** (`PHASE3-VERIFY`):
  - Refused: 5 doses of LOT-00059 where POR100 holds 2; a date tomorrow; Other without remarks; LOT-00060 while held by QC.
  - `SD-000001`: 1 expired dose of LOT-00059 at POR100/STORE-001, entry 261 (VARIANCE_NEGATIVE, 0.00: the lot carries no cost, see the costing session), `doses_destroyed` 0 → 1.
  - `QC-000006` (LOT-00057's POR100 receipt) passed, then `SD-000002`: 1 damaged dose at POR100, entry 263 costed **11.98** from the receipt layer (47.93 / 4); journal `JE-000916` Dr 830100 Inventory Adjustment Loss 11.98 / Cr 170200 Inventory 11.98.
  - `QC-000009` (LOT-00060): day 1 recorded as a fail, inspection rejected with Scrap → `SD-000003`, 2 doses, Failed QC, `QC_REJECTION`, linked to QC-000009, **no ledger row**, `doses_destroyed` unchanged.
- **Not seen in the browser:** the web app on 3002 still serves the old build.

## Phase 2 as built (24 Nov): farm receipt QC and D1

- **D1 fixed: semen is used where it is.** `SemenLotService.issueDoses` now takes the doses from a store **on the sow's farm** that holds the lot (`doseStore`, pure rule `semen-dose-source.rules.ts`). The collection store comes first when the sow is on the collection farm; the lot's own layer there is the collection OUTPUT, on another farm its TRANSFER_RECEIPT. A sow with no location keeps the old rule (collection store). Lots collected before semen was stock (counter only) are unchanged.
- **The farm gate.** When her farm holds none of the lot, the mating is refused with the reason: waiting for that farm's receipt QC (names the inspection), rejected by it, too few doses there, or never sent there ("Send it there by stock transfer first"). Stock an accepted receipt brought in can be used while a later receipt of the same lot is still being inspected.
- **Farm-receipt checks.** Each check on an item's QC Specification has **Applies at**: Collection / receipt (`INCOMING`, the lot's own QC, every round) or Farm receipt (`FARM_RECEIPT`). A transfer receipt takes the item's Farm-receipt checks, or all of them when it has none (as before); any other source takes all but the Farm-receipt ones (`specLinesForSource`). The same parameter may be listed once per stage. Any other stage is refused. No migration: `item_qc_spec_line.stage` already existed.
- **Tests:** `semen-dose-source.rules.spec.ts` (9), two new cases in `semen-lot.service.spec.ts` (issued from the POR100 store's receipt layer; refused while the farm QC is open), `qc-inspection.stages.spec.ts`. 754 of 755 tests pass across breeding, QC, stock transfer, item, item QC spec and migrations; the one failure is `breeding.controller.spec.ts` expecting 10 routes where the controller has 12, which neither change touched.
- **Proof through the API, read back from MySQL** (`PHASE2-VERIFY`):
  - A sow on MUL100 (PIG-2024-0004) with `LOT-00057`, whose 4 doses were all shipped to POR100: **refused**, "has no doses at MUL100 (GRASMERE FARM NORTON). Send it there by stock transfer first." No breeding row written. Before the fix this mating would have been issued from MUL100.
  - `ITM-0004` given one Farm-receipt check (111, motility, 21 to 432, mandatory) beside its two collection checks.
  - `LOT-00059` (case A, passed its 5 rounds) sent to POR100 by `TR-000004`: the receipt raised `QC-000010` with **1 round and only the Farm-receipt check**, nothing posted at POR100. Completed as a pass: a TRANSFER_RECEIPT layer of 3 doses at POR100/STORE-001, the layer a mating there draws from.
- **Farm-side mating, driven (Arun's go-ahead, 24 Nov):** a location move across farms is refused ("transfer it to a batch there") and POR100 had no batch, so `BATCH-000003` was created on POR100 (shed PDS01, BIO_ASSET, activated, no inputs) and PIG-2024-0004 was transferred into it by `BTR-0001` (posted, carrying value 567.87 moved). Then:
  - with `LOT-00057` (its POR100 receipt `QC-000006` still OPEN): **refused**, "waiting for its QC inspection at POR100 (KINTYRE ESTATE, NORTON) (QC-000006)"; no breeding row;
  - with `LOT-00059` (POR100 receipt `QC-000010` passed): **accepted**, breeding `5259c554…`; the issue is entry 260, CONSUMPTION `AI PIG-2024-0004` of 1 dose **at POR100/STORE-001**, drawn from the lot's TRANSFER_RECEIPT layer there (remaining 3 → 2); `doses_used_internal` 0 → 1.
  These records are permanent (matings and batch transfers have no delete); all tagged `PHASE2-VERIFY`.
- **Seen, not caused here:** LOT-00059's value is 0.00. Its `running_cost_period` is 0 after the costing session's boar-period change; that session owns it.

## Phase 0 findings (24 Nov, driven through the API on nf_devco, read back from MySQL)

All data written is tagged `PHASE0-VERIFY` and left in place: lot `LOT-00057` (PIG-2024-0016, 4 doses of `ITM-0004 SEMEN`, collected 2026-11-23), `QC-000005` (collection, passed), `TR-000001` (MUL100/STORE-001 to POR100/STORE-001, received), `QC-000006` (transfer receipt, OPEN), pack `PACK-000029`. No mating was posted.

**Before anything ran:** `nf_devco` and `nf_system` were behind the code. 0259 to 0262 were not applied, and 0257 `logistics_masters` and 0258 `route_stop_point` were skipped because two journal rows with the same `when` but other hashes (another branch's migrations) were already recorded. **Every stock transfer returned 500** (`Unknown column 'trip_id'`, then `logistics_setting doesn't exist`). Fixed with `db-migrate-all-tenants` and then `db-reconcile-tenant-migrations --apply`; both tenants now report "complete (262 recorded)". Backups taken first, in the session scratchpad.

| Step | Result | Proved by |
|---|---|---|
| Stand-alone collection (no plan) of a QC item | Works. Lot created, `QC-000005` raised, **no ledger row**, `inventory_posted = 0`, message says the lot is held. The line's weekday rule still applies (a Tuesday was refused). | API + MySQL |
| AI mating with the held lot | **Refused:** "waiting for its QC inspection (QC-000005)". | API |
| Collection QC passed | Inspection CLOSED/PASS, one OUTPUT row of 4 doses at MUL100/STORE-001, `inventory_posted = 1`. | API + MySQL |
| Transfer to the farm, ship, receive | Shipment row at MUL100 (-4). On receipt **`QC-000006` (`TRANSFER_RECEIPT`) is raised at POR100/STORE-001 and nothing is posted there**. Point 4's "transfer receipt applies QC when the item has QC on" is already built and working. | API + MySQL |
| AI mating while the farm QC is open | **Would be allowed** (not posted: matings cannot be voided). The gate reads only the collection QC (CLOSED, posted); the lot counter shows 4 left; `issueDoses` issues from the **lot's collection store** (MUL100), whose lot layer still shows 4 remaining though MUL100 holds 0 of the lot. | Code + MySQL, not driven |

### Defects found (not caused by this work)

1. **D1, insemination ignores where the semen is.** `semen-lot.service.ts issueDoses` always issues from `semen_batch.warehouse_id` (the collection store). Semen sent to a farm is never issued from the farm's store, so the farm-receipt QC cannot gate it and per-farm "Used" cannot be measured. **Must be fixed before Phase 2 and the dashboard.** Also: all sows in nf_devco are at MUL100, the same farm as the semen store, so a cross-farm mating cannot be tested until a sow is at POR100.
2. **D2, a boar's cost is charged to every lot of the period.** LOT-00055, LOT-00056 and LOT-00057 each carry the same 1,199.23 for 2025-09-14 to 2026-11-23: a lot still held by QC (or failed) does not move the boar's costing period on, so the next collection counts the same costs again. 4 doses came out at 299.81 a dose.
3. **D3, a transfer of a semen lot is costed from another lot.** The shipment of LOT-00057 was valued at 47.93 (about 11.98 a dose, LOT-00053's cost), not 1,199.23. The lot's own OUTPUT layer still shows `remaining_quantity = 4`. The shipment draws FIFO across the item, not from the lot's layer, so lot costs drift and the lot layer is left open.

### What this changes in the phases

- **Phase 2 grows:** fix D1 first (issue from the store at the sow's farm, by lot), then the farm-receipt gate.
- **D2 and D3 are costing defects** that should be fixed or at least confirmed with Rishi before more semen lots are collected with QC on. They are separate from the client's four points; suggested as their own task.
- Stand-alone collection needs no work.

## Questions for the client (needed before the phases they affect)

1. **Q1 (blocks Phase 1):** may doses be used or sent before the 4-day clear pass, or only after? What shelf life does the semen have?
2. "4 parts for 4 days": five checks (collection day + 4) or four? Same parameters every day?
3. Does a failed day-2 check reject doses already sent to farms (recall)?
4. Farm QC: what is checked, by whom, and does a failure need approval before the doses are destroyed?
5. Requisition: per farm per week or ad hoc? Who decides the split when supply is short? Does a farm see only its own requests?
6. Dashboard: which farms/roles see which figures? Which of the filters are must-haves?
7. Is an expired-but-unused dose counted as Destroyed or as On hand?

## Risks

- Posting stock at the last round moves the posting date; check costing and expiry (from collection date).
- Per-farm "Used" depends on matings issuing by lot at the farm store. Phase 0 must confirm that, or the number is wrong.
- Existing open inspections have no rounds: they run as a single round.
- A foreign-key name clash stopped a migration half-way once (6 Nov); keep to the guard in `foreign-key-names-unique.spec.ts`.
