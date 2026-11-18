# Logistics Phase 3 — Attach trips to the other flows (draft for approval, 16 Nov 2026)

**Goal:** A Logistics trip can be planned for every physical movement that needs a truck, and the Dispatch Board shows
what is moving. Phase 2 did this for the Inventory Transfer Order; Phase 3 covers the rest.

**Excluded by Rishi (16 Nov):** Business Central, WhatsApp and alerts, GPS. Costs and close stay Phase 4.

## What I found (read from the code, 16 Nov)

| Flow | Today | What Phase 3 does |
|---|---|---|
| Feed requisition, common requisition | Their shipment and receipt call `StockTransferService.postShipment` / `postReceipt`, which already carry the Phase 2 trip guard. So the backend is **already covered**. | Nothing in the API. The requisition must show the shared Transfer Order dialog (decided 12 Nov); that UI is **uncommitted in the working tree** (`stock-transfer-panel.tsx`, `feed-requisition-detail.tsx`, `common-requisition-detail.tsx`, `feed-requisition-document.tsx`, and 49 lines in `docs/decisions.md`). Prove it live, then it can be committed. |
| Livestock between farms | `batch_transfer` posts in one step (DRAFT → POSTED), no shipment or receipt, no trip. `logistics_trip_line.transfer_id` is NOT NULL and points at `stock_transfer`, so it cannot hold one. | Attach a trip to a cross-farm batch transfer (below). |
| Pigs sold to Colcom | SOLD is an animal disposal, not a transfer. The decisions file says the source of a slaughter trip is **unresolved**. | **Not in Phase 3** until Rishi decides. |
| Dispatch Board | No such screen. `/logistics/trips` is a list. | Build it (below). |

## Task 1 — Prove the requisition path
- Drive a feed requisition and a common requisition through the running app: release into a TO, Plan Trip from inside the
  requisition, assign, ship, receive. Read `logistics_trip`, `logistics_trip_line`, `stock_transfer.trip_id` and the
  ledger rows in MySQL. Turn `trip_required_to_ship` on and show a shipment without a trip is refused, then restore it.
- Evidence into `docs/VERIFICATION-<date>-logistics-phase3.md`. Fix what the run finds.

## Task 2 — Trip on a cross-farm batch transfer
- **Migration** (next number and `when` after the highest on *any* branch, checked on the day): `batch_transfer.trip_id
  varchar(36) NULL` + index; `logistics_trip_line.batch_transfer_id varchar(36) NULL` + index; `transfer_id` made
  nullable. Exactly one of the two ids is set on a line. Additive, no data rewritten.
- **Rules:** a trip is only for a batch transfer whose source and destination batches are on different farms (same-farm
  moves need no truck). Load is measured in head against `capacity_head`, vehicle type LIVESTOCK, over 100% blocked, over
  the setting's warning % warned (existing rules). The vehicle and driver eligibility checks are unchanged.
- **Post:** with no trip and `trip_required_to_ship` off, `post` does nothing new (same principle as Phase 2). With the
  setting on and a cross-farm transfer, `post` without a valid trip is refused in plain words. A posted transfer moves
  its trip to IN_TRANSIT then ARRIVED (both legs post together, as Direct Transfer does).
- **Web:** the batch transfer dialog gets the same Plan Trip panel, using Find Vehicle.

## Task 3 — Dispatch Board
- `/logistics/dispatch`: trips for the next 7 days grouped by status (Planned, Confirmed, In transit, Arrived), plus a
  list of Transfer Orders and cross-farm batch transfers with no trip yet. Farm access enforced on the server. Read-only
  with a link into each trip; no new writes.

## Task 4 — Prove Tasks 2 and 3 live
- Post a cross-farm batch transfer with a trip; read the rows; check the refusal with the setting on; check the board
  against MySQL. Same evidence file.

## Done when
1. Tests pass **and** the MySQL rows from Task 1, 2 and 4 exist from writes the app made.
2. Existing stock-transfer, requisition, batch-transfer and Logistics suites pass unchanged.
3. Web lint baseline does not grow.

## Open points for Rishi
1. **The uncommitted embedded-TO work** in the working tree: is it yours to finish and commit, or should Phase 3
   take it over? I will not commit it unasked.
2. **Cross-farm only** for batch transfers: confirm same-farm moves never need a trip.
3. **Slaughter / SOLD trips** stay out of Phase 3 until the source is decided.
