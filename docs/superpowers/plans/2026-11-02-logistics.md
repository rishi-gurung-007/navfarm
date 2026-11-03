# Logistics — delivery plan (2 Nov 2026)

Source: *NAVFarm TDD: Logistics Module* (15 items), Rishi 1–2 Nov. GPS and Business Central are out of scope for
now (Rishi, 2 Nov): BC is not connected (AGENTS.md), so nothing posts to or reads from BC, and no fake BC states.

## Principles

- **Additive.** New tables in a new `logistics` module; migrations add, never drop or rewrite.
- **A trip acts only when one is attached.** Existing shipment and receipt paths do nothing new — not even an extra
  read — unless a trip is passed in, so their mocked-query test suites stay valid.
- **"A trip is required to ship" is a setting, off by default,** so farms are never blocked mid-build.
- **`stock_transfer.vehicle_no` stays filled** from the trip, so Loading Instructions and every reader keep working.
- **One phase per merge,** each verified in the app and against MySQL.
- **Migration numbers:** take the next number and `when` after the highest on *any* branch
  (Arun's `feat/system-schedulers` holds 0214–0227, `when` …082–…095). Phase 1 is 0228, `when` 1792000000096.

## Where a trip attaches (verified 2 Nov)

| Trip for | Existing path | Vehicle recorded today |
|---|---|---|
| Bagged feed, store items | Stock Transfer one-step `ship` / `receive` / `post` | free text (`vehicle_no`, driver, waybill in remarks) |
| Bulk feed to silos | Feed requisition shipments/receipts → `postShipment` / `postReceipt`; Loading Sheet | none |
| Common requisitions | the same `postShipment` / `postReceipt` | none |
| Livestock between farms | Batch Transfer (cross-farm) | none |
| Pigs to Colcom | batch / animal disposal (SOLD) | none — waits on Rishi's decision |

## Phases (working days)

1. **Foundation (4–5):** masters Vehicles (+ Vehicle Documents list), Drivers, Delivery Zones, Routes (+ Route Stops
   list), Freight Rates, Service Plans, Logistics Settings (thresholds, default GL accounts, trip-required flag);
   permissions (module LOGISTICS); the masters listed in Farm Master (Rishi, 3 Nov).
2. **Trips (5–6):** trip header/lines/costs, 9 statuses, Plan Trip, Find Vehicle with exclusion reasons, capacity
   warn 95 % / block 100 %, ETA, estimate shared by weight, Trip numbering.
3. **Attach to existing flows (6–7, +1–2 for sales):** the paths above, Dispatch Board.
4. **Costs and close (4–5):** actuals, variance > 10 % to Finance (approval handler), close lock, Expense Voucher
   per farm, amount thresholds.
5. **Maintenance (3):** service plans, work orders, downtime status, overdue exclusion with override.
6. **Alerts and messages (2–3):** 6 logistics alerts, dispatch email, WhatsApp channel switched off.
7. **Reports (3):** R17 Vehicle Utilisation, Trip Register, Estimate vs Actual, Cost per Farm, Maintenance Due,
   Document Expiry.
8. **Roll-out (2–3).**

Total 29–37 days; first usable version (1–4 + dispatch email + paper expiry alerts) 20–23 days.

## Open decisions

1. Slaughter trips: from the sale (SOLD disposal) or from a transfer?
2. USD 500 approval: every Expense Voucher, or logistics costs only? Company currency?
3. Truck capacity replacing the fixed 30,000 KG bulk truck target?
4. Vehicle papers / route stops: separate lists (Phase 1 default) or tabs inside the record (+1–2 days)?
5. Which role is "Finance" for freight-rate and variance approval?

## Phase 1 detail

Tables (0228): `logistics_vehicle`, `logistics_vehicle_document`, `logistics_driver`, `logistics_delivery_zone`,
`logistics_route`, `logistics_route_stop`, `logistics_freight_rate`, `logistics_service_plan`, `logistics_setting`.
All company-scoped like every master; soft delete; audit log.

Rules in Phase 1: registration, driver licence and zone codes unique per company; a route's From and To differ;
freight rates of one carrier, route and basis may not overlap in dates; a vehicle's status is set by the system
(AVAILABLE on create — trips and maintenance move it from Phase 2); one settings record per company.
