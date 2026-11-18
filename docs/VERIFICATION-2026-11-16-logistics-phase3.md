# Logistics Phase 3 (batch transfers and the Dispatch Board) — live verification, 16 Nov 2026

Driven through the running app (API served from `feat/monthly-ops-report`, tenant `nf_ccc`, signed in as
`tenant.admin@ccc.com`) and read back from local MySQL. Not a test-suite result.

## Setup
- `nf_ccc` was dropped, recreated and its migrations replayed (254), then its rows reloaded (159 tables, identical row
  counts) after origin/main was merged; migration `0257_batch_transfer_trip` was then applied to `nf_ccc` only (255 in
  the journal, last `when` …125). `SHOW COLUMNS` read back `batch_transfer.trip_id` (NULL) and
  `logistics_trip_line.batch_transfer_id` (NULL), `transfer_id` now NULL.
- Route `VER-R1` (to a Colcom zone), driver `VER Test Driver`, and two new LIVESTOCK trucks `VER-LV01` / `VER-LV02`
  (100 head, insurance to 2027-12-31). `VER-LV01` was made without a company by mistake (assign said "Vehicle is not
  available in this company"), so `VER-LV02` was made with the company and used.
- Batches: BATCH-000321 (Grasmere, 32 head) to BATCH-000214 (Porta, 11 head). Different farms.

## What was proven
| Check | Result |
|---|---|
| Create a 3-head transfer as a draft | `BTR-0580`, DRAFT |
| Plan a trip from it (`POST /logistics/trip/plan-batch-transfer`) | `TRP-000005`, DRAFT, load 3.00 HEAD; the transfer shows the trip; one trip line with `batch_transfer_id` set and `transfer_id` NULL |
| Assign `VER-LV02` and the test driver | trip PLANNED, capacity 3.00 % |
| Post the transfer on a trip to Colcom with no HQ reference | 400 "A trip to Colcom needs the HQ approval reference before it is confirmed."; transfer stayed DRAFT, **batches unchanged (32 / 11)** |
| Confirm the trip with `HQ-TEST-P3`, then post | transfer POSTED; heads moved **32 → 29 and 11 → 14**; trip ARRIVED with `actual_departure` and `actual_arrival` stamped |
| `trip_required_to_ship` on, create a cross-farm transfer with the default (post at once) | `BTR-0581` left as a DRAFT, not refused |
| Post it with no trip | 400 "This transfer moves head between farms and needs a planned trip before it can post."; heads unchanged (29 / 14) |
| Cancel that draft; setting back to off | CANCELLED; setting read back `0` |
| Dispatch Board with a draft cross-farm transfer | `BTR-0582` Grasmere → Porta listed under "waiting for a trip", beside the four stock TOs |
| UI, `/batches/transfers`, open the draft | Trip panel with "No trip planned" and **Plan Trip**, and a **Post transfer** button |

## Requisition path (feed requisition REQ-MUL100-2026-00003, TO TR-000063, shipped through `POST /feed-requisition/:id/shipments`)
Feed and common requisitions post their shipment and receipt through `StockTransferService.postShipment/postReceipt`, so
they share the Phase 2 trip guard. Checked through the requisition's own endpoint (API, not the unfinished embedded screen):

| Check | Result |
|---|---|
| `trip_required_to_ship` on, ship 100 kg with no trip | 400 "This transfer needs a planned trip before it can ship."; nothing posted |
| Plan a BULK_FEED trip for TR-000063 (`TRP-000006`) and assign the test truck and driver | assign refused: "VER Test Driver: Already on trip TRP-000005 until 2026-11-16 18:00." (time-clash rule) |
| Ship on that DRAFT trip | 400 "Trip TRP-000006 is DRAFT; a transfer can only ship on a planned, confirmed or in-transit trip." |
| Cancel it, plan `TRP-000007` for tomorrow 08:00, assign (capacity 10.00 %), confirm with HQ ref `HQ-TEST-P3R`, ship | **the trip guard passed**; the shipment then stopped on an unrelated rule: "silo 'MDST3' holds 13767.06 KG of a 14000 KG capacity, and this transfer of 3000 KG would overfill it". Trip stayed CONFIRMED, nothing posted |
| Cancel the trip, setting back off | TR-000063 DRAFT with no trip; `trip_required_to_ship` 0 |

So a requisition ship that completes on a trip (trip IN_TRANSIT, `vehicle_no` copied) was **not** driven: the only open
requisition TO is blocked by the silo capacity rule. The same `postShipment` code did that for an Inventory TO on 12 Nov.

## Requisition screen (embedded Transfer Order dialog, finished 16 Nov)
Rishi chose to keep the feed receipt checks. The embedded Transfer Order dialog now carries them for a FEED requisition's
receipt: a variance reason on every short receipt, a whole bag count within 1 percent of the KG received on a BAGGED line,
an optional delivery note (`feed-receipt-checks.ts`, 12 unit tests). The old stacked posting dialogs were removed from the
feed and common requisition screens, and a post in the embedded dialog now refreshes the requisition (and shows the feed
receipt's per-line variance and silo balance, as before).

| Check | Result |
|---|---|
| UI, `/requisitions`, REQ-MUL100-2026-00003, press **Transfer Shipment** | a second dialog "Transfer Order — TR-000063" opens over the requisition with the source requisition and loading sheet links, the **Trip** panel with **Plan Trip**, and **Ship Outbound**; the old "Post shipment" form is gone |
| Specs | feed requisition detail 16, common requisition detail 26, feed requisition document 33, feed receipt checks 12 — all pass |

Not driven live: the feed receipt checks block itself (it shows only on an IN_TRANSIT Transfer Order, and the only open
requisition TO is blocked by the silo capacity rule), and a requisition shipment completing on a trip.

## Not proven live
- A transfer **inside one farm** (the "needs no truck" refusal, and posting with the setting on and no trip) — unit-tested.
- The post response showing the trip as ARRIVED — fixed after the run (the transfer is read again after the trip moves)
  and covered by a unit test; the stored state above was read from MySQL.
- Animal-wise batch transfers (the trip counts their head from `batch_transfer.head_count`; only a headcount transfer was driven).
- Cancel of a draft on a live trip is refused ("cancel the trip first") — unit-tested, not driven.

## Calls made without asking (change if wrong)
- The trip **arrives when the transfer posts**: a batch transfer moves its head at once, so the trip goes PLANNED →
  CONFIRMED → IN_TRANSIT → ARRIVED together, as a Direct Transfer's does.
- With the setting on, creating a cross-farm transfer **leaves it a draft** instead of refusing it, so the planner can
  add the trip; `post` then refuses until one is planned.
- A scheduler-posted cross-farm transfer is subject to the same rule when the setting is on.

## Data left in `nf_ccc`
- `BTR-0580` POSTED (3 head BATCH-000321 → BATCH-000214, trip `TRP-000005` ARRIVED, HQ ref `HQ-TEST-P3`);
  `BTR-0581` and `BTR-0582` cancelled drafts; `TRP-000004` cancelled (Dispatch Board check).
- `VER-LV01` and `VER-LV02` deactivated. `logistics_setting.trip_required_to_ship` is back to **off**.
