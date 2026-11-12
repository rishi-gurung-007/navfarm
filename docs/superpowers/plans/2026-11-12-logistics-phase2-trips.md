# Logistics Phase 2 — Trips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Logistics **Trip** (one vehicle + one driver, built from Transfer Order lines) that is planned from any Inventory Transfer Order, checked for eligibility and capacity, estimated, and moved through its statuses by hand.

**Architecture:** New `logistics_trip`, `logistics_trip_line`, `logistics_trip_cost` tables and a nullable `stock_transfer.trip_id`, all added by one migration (0250). Pure rules (status machine, capacity, ETA, cost estimate, eligibility) live in two spec-tested files; a `LogisticsTripService` does the queries; the existing stock-transfer ship paths act only when `trip_id` is set. The web adds a Trips screen and a **Plan Trip** panel inside the shared Inventory TO dialog — so requisition TOs get it for free.

**Tech Stack:** NestJS + Drizzle (MySQL, tenant migrations), Jest, Next.js/React. Run through `pnpm nx`; strip `NX_WORKSPACE_ROOT_PATH` first (memory: nx-always-runs-in-main-checkout). Cap jest workers (8 GB machine).

**Spec:** `NAVFarm TDD: Logistics Module` items 6, 7, 10 and the estimate half of 8; `docs/superpowers/plans/2026-11-02-logistics.md` (Phase 2); `docs/decisions.md` 12 Nov 2026 (four Logistics entries).

## Global Constraints

- **No GPS, no Business Central** (Rishi, 12 Nov: "no need for the real gps"; BC not connected). Departure, arrival and proof of delivery are **entered by hand**. No position log, no zone-radius arrival, no BC columns, no fake BC states.
- **Additive migrations only.** Next number is **0250**, `when` **1792000000118** — Arun's `origin/feat/system-schedulers` holds 0249 / …117; this branch's last is 0239 / …107. Re-check every remote journal on the day (memory: migration-number-across-branches).
- **A trip acts only when attached.** Stock-transfer `ship`, `postShipment`, `receive`, `postReceipt`, `postDirectTransfer` do nothing new — not even an extra read — when `trip_id` is null and the setting is off.
- **`trip_required_to_ship`** (company setting, default off) makes a shipment without a valid trip fail with a plain-words 400.
- **`stock_transfer.vehicle_no` stays filled** from the trip's vehicle so Loading Instructions keep working.
- **Truck capacity is the vehicle's own** (Rishi, 12 Nov). Bulk Truck Target is a planning target inside it, not a cap. Measure by type: LIVESTOCK = `capacity_head`, BULK_FEED = `capacity_kg`, BAGGED_FEED = `capacity_bags` (`CAPACITY_BY_VEHICLE_TYPE` in `logistics.rules.ts`).
- **Capacity:** load over **100%** = hard block; over `capacity_warning_pct` (default **95**) = warning. Both from `logistics_setting`, never hard-coded.
- **Trip statuses (9):** DRAFT, PLANNED, CONFIRMED, IN_TRANSIT, ARRIVED, POD_RECEIVED, RETURNED, CLOSED, CANCELLED. A CLOSED trip is locked.
- **Trip No.:** `TRP-000001`, row-locked generator in the style of `generateTransferNo`.
- **Permissions:** module `LOGISTICS`, new resource `TRIP`; farm access enforced on the server; every override needs a reason.
- **Verify by driving the running app and reading MySQL.** A green suite is not evidence (CLAUDE.md).

## Review Focus

- A TO with **no lines weighing anything** (zero KG) — share-by-weight must not divide by zero; each line gets an equal share and a warning.
- **Two TOs on one trip** going to different farms — each farm's cost share must sum to the trip estimate to the cent.
- A truck whose **insurance expires the day before the return date** — excluded with that reason, though valid today.
- A **vehicle or driver already on an overlapping trip** — excluded; a trip ending exactly when the next begins is *not* a clash.
- A **cancelled trip's TO** — becomes plannable again; a closed trip's TO does not.
- **Rate lookup finds nothing** — the trip still plans, the estimate is `null` with the reason "No approved freight rate", never 0.
- **`trip_required_to_ship` on, TO attached to a CANCELLED trip** — shipment refused.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/drizzle/tenant/0250_logistics_trips.sql` + journal entry | three trip tables, `stock_transfer.trip_id` |
| `apps/api/src/core/database/schema.ts` | `logisticsTrip`, `logisticsTripLine`, `logisticsTripCost`, `stockTransfer.trip_id` |
| `apps/api/src/modules/logistics/trip.rules.ts` (+ `.spec.ts`) | pure: status machine, capacity, ETA, estimate, weight share |
| `apps/api/src/modules/logistics/trip-eligibility.ts` (+ `.spec.ts`) | pure: why a vehicle/driver is excluded |
| `apps/api/src/modules/logistics/logistics-trip.service.ts` | queries: plan, find vehicle, assign, status moves |
| `apps/api/src/modules/logistics/logistics-trip.controller.ts` | `/logistics/trip` routes |
| `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` | trip guard + vehicle_no copy in ship paths |
| `apps/web/src/modules/logistics/` | Trips list/detail, Find Vehicle dialog, Plan Trip panel |
| `apps/web/src/components/console/inventory/stock-transfer-panel.tsx` | Plan Trip section inside the TO dialog |
| `apps/web/src/components/console/console-tabs/roles-tab.tsx` | `TRIP` resource in the role matrix |

---

### Task 1: Trip tables and the TO link

**Files:**
- Create: `apps/api/src/drizzle/tenant/0250_logistics_trips.sql`, `apps/api/src/drizzle/tenant/logistics-trips-migration.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json` (idx 216, `when` 1792000000118, tag `0250_logistics_trips`), `apps/api/src/core/database/schema.ts` (after `logisticsSetting`; `stockTransfer` gets `trip_id`)

**Interfaces:**
- Produces: `schema.logisticsTrip { trip_id, tenant_id, company_id, trip_no, vehicle_id, driver_id, route_id, carrier_supplier_id, status, planned_departure, estimated_arrival, actual_departure, actual_arrival, pod_received_at, returned_at, load_value, load_unit, capacity_pct, estimated_cost, estimate_note, hq_approval_ref, cancel_reason, closed_at, remarks + audit columns }`; `schema.logisticsTripLine { trip_line_id, trip_id, transfer_id, transfer_line_id, weight_kg, head_count, bag_count, share_pct, estimated_cost_share }`; `schema.logisticsTripCost { cost_id, trip_id, cost_type, amount, is_estimate, remarks }`; `schema.stockTransfer.trip_id: string | null`.

- [ ] **Step 1: Write the failing test** `logistics-trips-migration.spec.ts` in the style of `logistics-masters-migration.spec.ts`: asserts the journal has an entry tagged `0250_logistics_trips` with `when` greater than every earlier entry, the SQL creates the three tables with a unique `(tenant_id, company_id, trip_no)`, and adds nullable `stock_transfer.trip_id` plus an index. Also `it('is numbered after every other branch')` reading nothing from git — just asserts `idx` is contiguous.
- [ ] **Step 2: Run** `pnpm nx test api --testPathPattern=logistics-trips-migration` — Expected: FAIL (no file).
- [ ] **Step 3: Write the SQL** (CREATE TABLE ×3, `ALTER TABLE stock_transfer ADD COLUMN trip_id varchar(36) NULL`, index `idx_stock_transfer_trip`), the journal entry, and the Drizzle tables. Soft delete, `is_active`, audit columns exactly as the Phase 1 tables.
- [ ] **Step 4: Run the spec again** — Expected: PASS. Then `pnpm nx run api:typecheck` — clean.
- [ ] **Step 5: Apply to a dev tenant** with the project's tenant-migrate command and read back `SHOW CREATE TABLE logistics_trip` (not just the spec).
- [ ] **Step 6: Commit** `feat: Logistics trip tables and stock_transfer.trip_id`.

### Task 2: Trip rules (pure)

**Files:**
- Create: `apps/api/src/modules/logistics/trip.rules.ts`, `apps/api/src/modules/logistics/trip.rules.spec.ts`

**Interfaces:**
- Produces:
  - `TRIP_STATUSES` (the nine, as a const tuple) and `canMove(from: TripStatus, to: TripStatus): string | null` — `null` when allowed, otherwise the reason. Allowed: DRAFT→PLANNED→CONFIRMED→IN_TRANSIT→ARRIVED→POD_RECEIVED→RETURNED→CLOSED; any status before IN_TRANSIT → CANCELLED; CLOSED and CANCELLED move nowhere.
  - `capacityCheck(load: number, capacity: number, warnPct: number): { pct: number; level: 'OK' | 'WARN' | 'BLOCK'; message: string | null }`
  - `estimateArrival(departure: Date, route: { distance_km; speed_kmh; loading_minutes; offloading_minutes; break_minutes }): Date` — departure + loading + (km ÷ speed) + breaks + offloading.
  - `pickRate(rates: RateRow[], q: { carrierId; routeId; on: string }): RateRow | null` — approved only, date window covers `on`, route-specific before carrier-general, latest `valid_from` wins.
  - `baseFreight(rate: RateRow, route: { distance_km; return_leg_charged }, load: { tonnes; head }): number` — by `rate_basis` (KM, TONNE, TONNE_KM, TRIP, HEAD), `max(minimum_charge)`, `+ fuel_surcharge_pct` of base, `+ route.tolls`.
  - `shareByWeight(total: number, weights: number[]): number[]` — cents-exact (largest-remainder), equal split when all weights are 0.

- [ ] **Step 1: Write failing tests**, each with the spec's values:
  - `capacityCheck(30000, 30000, 95)` → `WARN` (exactly 100% is allowed, only a warning); `capacityCheck(30001, 30000, 95)` → `BLOCK`, message "Load is 100.0% of capacity — over the limit."; `capacityCheck(28500, 30000, 95)` → `WARN` (95.0%); `capacityCheck(28499, 30000, 95)` → `OK`.
  - `estimateArrival(2026-11-12T06:00, {distance_km:120, speed_kmh:60, loading_minutes:30, offloading_minutes:20, break_minutes:15})` → 09:05 (30 + 120 + 15 + 20 min).
  - `pickRate` ignores DRAFT/PENDING/REJECTED; prefers a route-specific over a carrier-general rate; returns `null` when none covers the date.
  - `baseFreight` KM rate 2/km, 100 km, minimum 250, surcharge 10%, tolls 15 → `max(200,250)=250 ×1.10 + 15 = 290`; `return_leg_charged` doubles the km for KM and TONNE_KM only.
  - `shareByWeight(100, [1,1,1])` → `[33.34, 33.33, 33.33]`; `shareByWeight(100, [0,0])` → `[50, 50]`.
  - `canMove('CLOSED','CANCELLED')` and `canMove('IN_TRANSIT','CANCELLED')` return a reason; `canMove('DRAFT','CONFIRMED')` returns a reason (steps may not be skipped).
- [ ] **Step 2: Run** `pnpm nx test api --testPathPattern=trip.rules` — Expected: FAIL.
- [ ] **Step 3: Implement** the six functions with the signatures above; no database access, no `Date.now()`.
- [ ] **Step 4: Run** — Expected: PASS. Commit `feat: trip rules (status, capacity, ETA, rate, estimate)`.

### Task 3: Eligibility — why a truck is excluded (pure)

**Files:**
- Create: `apps/api/src/modules/logistics/trip-eligibility.ts`, `apps/api/src/modules/logistics/trip-eligibility.spec.ts`

**Interfaces:**
- Consumes: `capacityCheck` (Task 2), `CAPACITY_BY_VEHICLE_TYPE`.
- Produces: `vehicleExclusions(v: VehicleFacts, trip: { type: VehicleType; load: number; departure: string; returnDate: string }, busy: Interval[]): string[]` and `driverExclusions(d: DriverFacts, trip: { departure: string; returnDate: string; licenceClass?: string }, busy: Interval[]): string[]`. Each string is one plain-words reason; empty = eligible.

- [ ] **Step 1: Failing tests** — one per reason, each naming the reason text the user will see:
  - status not AVAILABLE → "Vehicle is In maintenance." (uses the status label);
  - wrong type → "Vehicle is a Bulk feed truck; this load needs a Livestock truck.";
  - insurance expiring **before the return date** (valid today) → "Insurance expires 2026-11-13, before the return on 2026-11-14.";
  - licence/fitness likewise; no insurance document at all → "No insurance on file.";
  - load > capacity → "Load 30,001 KG is over the 30,000 KG capacity.";
  - overlapping trip → "Already on trip TRP-000007 until 2026-11-12 14:00."; back-to-back trips (end == start) → no reason;
  - driver licence expired by return date, or class not matching → hard reasons.
- [ ] **Step 2: Run** `--testPathPattern=trip-eligibility` — FAIL.
- [ ] **Step 3: Implement** both functions; service-due and BC-blocked-carrier reasons are **not** here (Phases 5 / BC).
- [ ] **Step 4: Run** — PASS. Commit `feat: vehicle and driver eligibility reasons`.

### Task 4: Trip service and routes

**Files:**
- Create: `apps/api/src/modules/logistics/logistics-trip.service.ts`, `logistics-trip.controller.ts`, `logistics-trip.service.spec.ts`
- Modify: `apps/api/src/modules/logistics/logistics.module.ts` (provide/export), `apps/web/src/components/console/console-tabs/roles-tab.tsx` (add resource `TRIP`)

**Interfaces:**
- Consumes: rules from Tasks 2–3; `schema.logisticsTrip*`.
- Produces (all under `/logistics/trip`, guarded `RequirePermission('LOGISTICS','TRIP', …)`):
  - `POST /plan` body `{ transfer_ids: string[]; planned_departure: string; route_id: string; carrier_supplier_id?: string }` → creates a DRAFT trip, one line per TO line with `weight_kg`/`head_count`/`bag_count`, returns the trip with `estimated_cost` and per-farm shares.
  - `GET /:id/find-vehicle` → `{ eligible: Vehicle[]; excluded: { vehicle; reasons: string[] }[]; drivers: { eligible; excluded }}`.
  - `PUT /:id/assign` body `{ vehicle_id; driver_id }` → re-runs eligibility; capacity `BLOCK` = 400, `WARN` stored in `estimate_note`; sets status PLANNED.
  - `POST /:id/move` body `{ to: TripStatus; reason?: string; hq_approval_ref?: string; at?: string }` → `canMove`; manual timestamps for IN_TRANSIT / ARRIVED / POD_RECEIVED / RETURNED.
  - `POST /:id/cancel` body `{ reason }` (required) — frees the TOs (`stock_transfer.trip_id = null`).
  - `LogisticsTripService.assertTripFor(transferId, tenantId): Promise<{ trip_id; vehicle_no } | null>` for Task 5.

- [ ] **Step 1: Failing tests** (mocked-query style like the repo's service specs): `plan` rejects a TO already on an open trip; rejects TOs of different companies; `assign` with a 30,001 KG load against a 30,000 KG truck throws with the "over the limit" message; `assign` of an excluded vehicle throws listing every reason; `move` DRAFT→CONFIRMED throws; `cancel` without a reason throws; a CLOSED trip refuses `assign`, `move` and `cancel` ("This trip is closed and locked."); slaughter-type trips (zone type COLCOM) require `hq_approval_ref` before CONFIRMED.
- [ ] **Step 2: Run** `--testPathPattern=logistics-trip.service` — FAIL.
- [ ] **Step 3: Implement** the service and controller. Numbering: copy the `generateTransferNo` pattern (row-locked MAX, `TRP-` prefix, inside one transaction with the insert). Weight: reuse the stock-transfer service's kilogram conversion for each line; bag count = KG ÷ `bag_size_kg` of the item. Farm share: group lines by destination farm and apply `shareByWeight`. Audit-log every write like the masters.
- [ ] **Step 4: Run** — PASS; `pnpm nx run api:typecheck` — clean.
- [ ] **Step 5: Commit** `feat: Logistics trips — plan, find vehicle, assign, status moves`.

### Task 5: Attach to the Inventory TO

**Files:**
- Modify: `apps/api/src/modules/inventory/stock-transfer/stock-transfer.service.ts` (`ship` ~2590, `postShipment` ~1675, `postReceipt` ~1953, `postDirectTransfer` ~2277), `stock-transfer.controller.ts` (`GET :id` includes `trip` summary)
- Test: `apps/api/src/modules/inventory/stock-transfer/transfer-trip.spec.ts`

**Interfaces:**
- Consumes: `LogisticsTripService.assertTripFor`.
- Produces: `findOne(id)` returns `trip: { trip_id, trip_no, status, vehicle_no, driver_name, estimated_arrival } | null`.

- [ ] **Step 1: Failing tests:** (a) with `trip_required_to_ship` **off** and `trip_id` null, `ship` makes **no** logistics query (assert the mocked db was not asked); (b) setting **on**, no trip → 400 "This transfer needs a planned trip before it can ship."; (c) trip CANCELLED or CLOSED → same refusal; (d) trip PLANNED/CONFIRMED → ship succeeds, `vehicle_no` = the trip vehicle's registration, trip status moves to IN_TRANSIT; (e) `postReceipt` completing the TO moves the trip to ARRIVED; (f) `postDirectTransfer` follows the same required-trip rule.
- [ ] **Step 2: Run** `--testPathPattern=transfer-trip` — FAIL.
- [ ] **Step 3: Implement** the guard as one private method called at the top of the four paths: it returns immediately when the transfer has no `trip_id` and the setting read (one cached read, only inside this method) says off.
- [ ] **Step 4: Run** the new spec **and** the existing stock-transfer specs (`--testPathPattern=stock-transfer`) — all PASS (principle: old suites untouched).
- [ ] **Step 5: Commit** `feat: Inventory TO carries a Logistics trip`.

### Task 6: Web — Trips screen and Plan Trip

**Files:**
- Create: `apps/web/src/modules/logistics/trips-screen.tsx`, `find-vehicle-dialog.tsx`, `plan-trip-panel.tsx`; route under the Logistics area
- Modify: `apps/web/src/components/console/inventory/stock-transfer-panel.tsx` (replace the free-text vehicle/driver block with `PlanTripPanel` when a trip exists or the setting is on; keep free text when off), the requisition detail screens need **no change** — they embed this dialog
- Test: Jest component specs next to each file

**Interfaces:**
- Consumes: Task 4 endpoints.
- Produces: `PlanTripPanel({ transfer, onChanged })` — shows trip no., status, vehicle, driver, ETA, estimate, capacity %; buttons **Plan Trip**, **Find Vehicle**, **Cancel Trip**.

- [ ] **Step 1: Failing tests:** panel shows "No trip planned" and a Plan Trip button for a TO without one; Find Vehicle lists excluded trucks **with their reasons**; a `BLOCK` capacity result shows the server message and does not close the dialog; panel inside the requisition-embedded TO dialog renders the same.
- [ ] **Step 2: Run** `pnpm nx test web --testPathPattern=plan-trip` — FAIL.
- [ ] **Step 3: Implement** the three components; labels through the English dictionary only.
- [ ] **Step 4: Run** — PASS; `pnpm nx run web:typecheck` — clean; web lint baseline must not grow (memory: web-lint-baseline-frozen).
- [ ] **Step 5: Commit** `feat: Trips screen and Plan Trip on the Transfer Order`.

### Task 7: Prove it in the running app

**Files:**
- Create: `docs/VERIFICATION-2026-11-<day>-logistics-phase2.md`

- [ ] **Step 1:** Restart API and web cleanly (`nx serve` does not rebuild — memory); apply 0250 to the dev tenant; confirm tables with `SHOW TABLES LIKE 'logistics_trip%'`.
- [ ] **Step 2:** Seed **through the API** one vehicle (30,000 KG BULK_FEED, insurance valid), one with insurance expiring tomorrow, one driver with an expired licence, one valid driver, one route and an APPROVED KM rate.
- [ ] **Step 3:** Create a feed TO from a requisition; from **inside the requisition's TO dialog** click Plan Trip → Find Vehicle. Confirm the expiring-insurance truck and expired-licence driver appear under "excluded" with reasons.
- [ ] **Step 4:** Assign the good pair; read `logistics_trip`, `logistics_trip_line`, `stock_transfer.trip_id` in MySQL. Try a 31,000 KG load — refused. Ship — trip becomes IN_TRANSIT and `stock_transfer.vehicle_no` is the registration. Receive — ARRIVED. Move by hand to CLOSED; try to edit — refused.
- [ ] **Step 5:** Turn `trip_required_to_ship` on; ship a TO without a trip — refused with the plain-words message.
- [ ] **Step 6:** Write the evidence (screens, rows) into the verification file. Commit `docs: Logistics Phase 2 verification`.

---

## Done when

1. All seven tasks' tests pass, **and** Task 7's rows exist in MySQL from writes the app made.
2. A trip can be planned from an Inventory TO **and from the same dialog inside a feed and a common requisition**.
3. Every Review Focus line has a passing test or a recorded live check.
4. Existing stock-transfer, requisition and Logistics-master suites still pass unchanged.

## Out of scope (named so they are not lost)

Actual costs, variance > 10 % to Finance, close gating and the USD 500 logistics approval (Phase 4); work orders and service-due exclusion (Phase 5); alerts and dispatch email (Phase 6); reports (Phase 7); batch-transfer and slaughter attachment (Phase 3); BC and GPS (deferred — GPS is not planned at all for now).

## Open points to settle before Task 4

1. **Bags for BAGGED_FEED:** plan uses KG ÷ `bag_size_kg`. Confirm the item field is populated for bagged feed in the data.
2. **`return_leg_charged`:** plan doubles distance for KM and TONNE_KM bases only. Confirm with Rishi.
3. **Who sees HQ approval ref** on slaughter trips — a plain text field now; real HO approval comes with the slaughter decision.
