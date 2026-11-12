# Logistics Phase 2 (Trips) — live verification, 12 Nov 2026

Driven through the running app (API + web served from the feature branch, tenant `nf_ccc`, signed in as
`tenant.admin@ccc.com`) and read back from local MySQL. Not a test-suite result.

## Setup
- Migration `0250_logistics_trips` applied with `db-migrate-all-tenants`. That script has no tenant filter, so it
  applied to **all 7 local tenants** (system, triplec, tcdemo, portatestnavfarm, ccc, devco, frtest). It is additive.
- `SHOW TABLES LIKE 'logistics_trip%'` in `nf_ccc`: `logistics_trip`, `logistics_trip_cost`, `logistics_trip_line`;
  `stock_transfer.trip_id` is `varchar(36) NULL`. The company FK resolved.
- Existing Phase 1 masters reused: truck `VER-T01` (bulk feed, own, 30,000 KG, insurance to 2026-12-31), driver
  `VER Test Driver` (class EC, licence to 2027-06-30), route `VER-R1` (120 km at 60 km/h, to a Colcom zone), one freight
  rate in DRAFT.

## What was proven
| Check | Result |
|---|---|
| Plan a trip from a 100 KG TO (TR-000100) | `TRP-000001`, DRAFT, load 100 KG, arrival 08:00 for a 06:00 departure (2 h drive), note "Assign a vehicle to estimate cost." |
| Find Vehicle with an expired-insurance truck and an expired-licence driver | Both listed as excluded: "Insurance expires 2026-11-12, before the return on 2026-11-13." and "Licence expires 2026-11-01, before the return on 2026-11-13." |
| Assign the excluded truck or driver | 400 with the same reasons, nothing written |
| Assign the valid pair | PLANNED, capacity 0.30 %, estimate null with "No approved freight rate." (the only rate is DRAFT — never 0) |
| Skip a step (PLANNED -> IN_TRANSIT) | 400 "A trip cannot go from PLANNED to IN_TRANSIT." |
| Ship while the trip goes to Colcom with no HQ reference | 400 "A trip to Colcom needs the HQ approval reference before it is confirmed."; TO stayed DRAFT, trip PLANNED, **no ledger rows** |
| Confirm with `HQ-TEST-1`, then ship | TO IN_TRANSIT, trip IN_TRANSIT, `stock_transfer.vehicle_no` = `VER-T01`, `actual_departure` stamped |
| Receive the TO fully | TO RECEIVED, trip ARRIVED (`actual_arrival` stamped) |
| Move by hand to POD_RECEIVED, RETURNED, CLOSED, then assign / cancel / move | all three refused "This trip is closed and locked." |
| 31,000 KG TO on the 30,000 KG truck | 400 "VER-T01: Load is 103.3% of capacity — over the limit.", trip stays DRAFT, no vehicle |
| Cancel without a reason | 400 "A reason is required to cancel a trip."; with a reason CANCELLED and the TO's `trip_id` cleared |
| Untripped 10 KG TO (TR-000102), setting off | ships and receives exactly as before; free-text `vehicle_no` `FREE-TEXT-1` kept; no trip rows |
| `trip_required_to_ship` on (waited out the 60 s cache), ship with no trip | 400 "This transfer needs a planned trip before it can ship."; TO stayed DRAFT |
| Setting restored to off | confirmed by reading it back |
| Audit | `logistics_trip` rows in `audit_log`: counts when read back mid-run: CREATE 2, STATUS_CHANGE 6, ASSIGN 1, CANCEL 1 |
| UI, Inventory TO dialog | Plan Trip form (route, departure, truck type), toast "Trip TRP-000003 planned", trip panel, Find Vehicle dialog with excluded reasons, Assign; departure typed 06:00 gave arrival 08:00 (no time-zone shift) |
| UI, `/logistics/trips` | lists TRP-000003 / 000002 / 000001 with status, route, vehicle, driver, departure, estimate |

MySQL read-back after the run: `TRP-000001` CLOSED (HQ ref `HQ-TEST-1`), `TRP-000002` CANCELLED, one
`TRANSFER_SHIPMENT` (-100) and one `TRANSFER_RECEIPT` (+100) for TR-000100 and the same for TR-000102 (10 KG) — the
refused shipments left no rows.

## Not proven / observed
- **Cost estimate with an approved rate**: the only freight rate is DRAFT, and rate approval is not built (Phase 4),
  so a priced estimate was not exercised live (it is covered by unit tests).
- **Two TOs on one trip, per-farm shares**: unit-tested, not driven live.
- **Pig-line unit (HEAD)** and **bagged-feed bag size**: not exercised — no livestock TO exists, and the TOs used were
  KG bulk lines.
- Capacity shows `0.00 %` for a 10 KG load on 30,000 KG (the true value is 0.03 %, rounded to one decimal) — cosmetic.
- The TO dialog's Source / Destination pickers are blank in this session (it uses the zero company id, so the
  warehouse list returns 403). That was true before this branch.
- `localNow()` stamps (`actual_departure` / `actual_arrival`) use the server's clock; planned times are the typed wall
  clock.

## Data left in `nf_ccc`
- `TRP-000001` (closed), `TRP-000002` and `TRP-000003` (cancelled); TR-000100 and TR-000102 posted (net 110 KG of
  FEED000009, lot LOT-2026-06-17-FEED000009, moved MST1 -> PST1); TR-000101, TR-000103 and TR-000104 cancelled drafts (the capacity, trip-required and UI checks).
- Test masters `VER-T02`, `VER-T03` and two `VER … Driver` records, all deactivated (soft delete). `VER-T01` and
  `VER Test Driver` were already there.
- `logistics_setting.trip_required_to_ship` is back to **off**.
