# Mill and Bin Location Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MILL and BIN location types, TON-based capacity fields, Production Slots and effective BIN Diet Assignments backed by BIN-level inventory locations.

**Architecture:** Extend canonical `location_master` for conditional MILL/BIN facts, add focused Production Slot and BIN Assignment tables/services, and reuse the existing location hierarchy, number series, Item Master and inventory ledger. Store capacity canonically in KG while exposing TON inputs. Do not build production output or dispatch documents in this plan.

**Tech Stack:** NestJS 11, Drizzle/MySQL, class-validator, Next.js 16/React 19, Jest, Nx.

**Spec:** `docs/superpowers/specs/2026-10-05-feed-forecast-dashboard-calculation-mill-design.md`

## Global Constraints

- `MILL` is a root Location Type; `BIN` requires a MILL parent.
- A company supports multiple Mills and multiple Bins per Mill.
- BIN, not MILL, is an inventory/warehouse location.
- Capacities are entered/displayed in TON and stored in KG at exactly 1 TON = 1,000 KG.
- No invented Mill, Bin, Slot, capacity or diet-assignment customer data.
- Data scripts are read-only by default, `--verify` rolls back and `--apply` commits.
- Recheck the next free tenant migration number immediately before generation; do not edit `dist/drizzle`.

## Review Focus

- A BIN parent from another company or a non-MILL type is refused.
- Bulk + Bagged allocation exactly equal to Daily Capacity is allowed; any amount above is refused.
- Decimal TON round-trips without multiplying twice on an untouched edit.
- A BIN with positive stock of item A cannot be assigned item B.
- Two assignments cannot use one BIN in the same date/slot, including concurrent requests.

---

### Task 1: Tenant schema and migration contract

**Files:**
- Modify: `apps/api/src/core/database/schema.ts`
- Create: `apps/api/src/drizzle/tenant/<next>_mill_bin_location_foundation.sql`
- Create: `apps/api/src/drizzle/tenant/mill-bin-location-migrations.spec.ts`
- Modify: `apps/api/src/drizzle/tenant/meta/_journal.json`

**Interfaces:**
- Produces: MILL columns `mill_daily_capacity_kg`, `mill_hourly_capacity_kg`, `mill_bulk_daily_allocation_kg`, `mill_bagged_daily_allocation_kg`; BIN columns `bin_capacity_kg`, `bin_feed_type`; tables `production_slot_master` and `bin_diet_assignment`.

- [ ] **Step 1: Write a failing migration contract test** asserting additive nullable Location columns, scoped Slot Code uniqueness, unique BIN/date/slot assignment, FKs to Location/Item/Slot and no destructive SQL.
- [ ] **Step 2: Run** `pnpm nx test api -- --runInBand apps/api/src/drizzle/tenant/mill-bin-location-migrations.spec.ts` and confirm failure because the migration is absent.
- [ ] **Step 3: Add the Drizzle schema and handwritten migration** after rechecking the free index. Keep MySQL constraints/index names under identifier limits.
- [ ] **Step 4: Run the focused migration test** and expect PASS.
- [ ] **Step 5: Commit** with the workbook rows and the prior absence of a real Mill/BIN model in the message.

### Task 2: MILL/BIN Location rules and conditional form

**Files:**
- Modify: `apps/api/src/modules/master-data/location/dto/location.dto.ts`
- Modify: `apps/api/src/modules/master-data/location/location.service.ts`
- Modify: `apps/api/src/modules/master-data/location/location.service.spec.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: `apps/web/src/modules/master-data/MasterDataTable.tsx`
- Modify: `apps/web/specs/location-parent-hierarchy.spec.ts`
- Create: `apps/web/specs/location-mill-bin-fields.spec.ts`

**Interfaces:**
- Produces: `capacityTonToKg(value): string | null`, display inverse, MILL/BIN DTO fields with `*_ton` keys, and `WAREHOUSE_LOCATION_TYPES = ['STORE', 'SILO', 'BIN']`.

- [ ] **Step 1: Write failing API tests** for TON conversion, untouched edit round-trip, allocation boundary, MILL root rule, BIN→MILL same-company parent and BIN warehouse inclusion.
- [ ] **Step 2: Run the focused API specs** and confirm the new expectations fail.
- [ ] **Step 3: Implement Location DTO/service rules** using dedicated MILL/BIN capacity keys; do not reuse general animal-count `max_capacity` or Silo fields.
- [ ] **Step 4: Write failing web specs** asserting exact approved fields and hiding generic area/count/biosecurity/Silo fields for MILL/BIN.
- [ ] **Step 5: Implement conditional config fields** with `Field`/existing MasterData primitives and dependent active-MILL parent lookup for BIN.
- [ ] **Step 6: Run focused API/web specs** and expect PASS.
- [ ] **Step 7: Commit**.

### Task 3: Production Slot Master

**Files:**
- Create: `apps/api/src/modules/master-data/production-slot/dto/production-slot.dto.ts`
- Create: `apps/api/src/modules/master-data/production-slot/production-slot.service.ts`
- Create: `apps/api/src/modules/master-data/production-slot/production-slot.controller.ts`
- Create: `apps/api/src/modules/master-data/production-slot/production-slot.module.ts`
- Create: `apps/api/src/modules/master-data/production-slot/production-slot.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: `apps/web/specs/master-data-feed-masters.spec.ts`

**Interfaces:**
- Produces: CRUD `/production-slot`; `{ slot_id, slot_code, slot_name, start_time, end_time, is_active, status }`.

- [ ] **Step 1: Write failing service tests** for scoped Code uniqueness, required fields, ordinary and overnight slots,
  Production Date as the slot-start date, active filtering and company isolation.
- [ ] **Step 2: Run the focused spec** and confirm failure.
- [ ] **Step 3: Implement the Nest module** following existing master-data scope/audit/list conventions; an End Time
  earlier than or equal to Start Time ends on the day after the Production Date.
- [ ] **Step 4: Add one config-driven Production Slot master entry** in `configs.ts`; do not add a standalone page.
- [ ] **Step 5: Run focused API/web specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 4: Effective BIN Diet Assignment

**Files:**
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/dto/bin-diet-assignment.dto.ts`
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/bin-diet-assignment.rules.ts`
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/bin-diet-assignment.service.ts`
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/bin-diet-assignment.controller.ts`
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/bin-diet-assignment.module.ts`
- Create: `apps/api/src/modules/master-data/bin-diet-assignment/bin-diet-assignment.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/web/src/modules/master-data/configs.ts`
- Modify: `apps/web/specs/master-data-feed-masters.spec.ts`

**Interfaces:**
- Produces: CRUD `/bin-diet-assignment`; `findNextBinAssignment({ tenantId, companyId, itemId, from }): Promise<NextBinAssignment | null>` ordered by date, Slot Start Time and BIN Code.

- [ ] **Step 1: Write failing pure/service tests** for active FEED item with Diet No., BIN type, feed-form match, uniqueness, positive-other-item stock refusal, deterministic next assignment and `null` when none exists.
- [ ] **Step 2: Run the focused spec** and confirm failure.
- [ ] **Step 3: Implement rules/service/controller** using the Inventory Ledger service for stock-as-of evidence; never read a cached balance field.
- [ ] **Step 4: Add the config-driven master** with Bin, Feed Item, Date, Production Slot and positive Diet Priority.
- [ ] **Step 5: Run focused API/web specs** and expect PASS.
- [ ] **Step 6: Commit**.

### Task 5: Existing-tenant Location Type alignment

**Files:**
- Create: `apps/api/src/scripts/align-mill-bin-location-types.ts`
- Create: `apps/api/src/scripts/align-mill-bin-location-types.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/scripts/seed-system-master-data.ts` or the owning system-location-type seed fixture

**Interfaces:**
- Produces: Nx target `api:db-align-mill-bin-location-types` with plan/`--verify`/`--apply` modes.

- [ ] **Step 1: Write failing script tests** for create-missing, preserve-existing, refuse-conflicting parent rules and no sample Location/Slot/Assignment creation.
- [ ] **Step 2: Implement the safe script and seed definitions** for MILL `{ parents: [] }` and BIN `{ parents: ['MILL'] }` only.
- [ ] **Step 3: Run** `pnpm nx run api:db-align-mill-bin-location-types -- --verify`, review the printed plan and confirm rollback.
- [ ] **Step 4: Run focused tests and `pnpm nx run-many -t typecheck -p api web`**.
- [ ] **Step 5: Commit**.

### Task 6: Live master and database proof

**Files:**
- Modify: `docs/superpowers/plans/feed-completion/progress.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: verified MILL→BIN hierarchy and assignment evidence for the Dashboard plan.

- [ ] **Step 1: Back up the target tenant and apply the migration** through the registered Nx migration flow; inspect output for `FAILED` and query its Drizzle journal.
- [ ] **Step 2: Run the alignment script with `--apply` only after its verified plan is accepted.**
- [ ] **Step 3: Drive Location Master on `localhost:3002`** to create a MILL and two BINs without invented client values; create a Slot and one assignment supplied/approved for test use.
- [ ] **Step 4: Query MySQL** to prove hierarchy, canonical KG capacity, scoped slot and assignment rows. If an inventory movement is exercised, prove matching Item Ledger and Value Entry rows.
- [ ] **Step 5: Update progress with commands and evidence, then commit.**
