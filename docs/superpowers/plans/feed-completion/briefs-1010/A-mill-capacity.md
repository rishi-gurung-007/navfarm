# Brief A: Mill Capacity Master, then Compare Report

## Workbook rows (read them in workbook-fields.md)
- Sheet "Feed Forecast" row 11, Mill capacity awareness: "Feed Plan considers mill capacity. Highest demand diets
  produced first. One diet per loading bin." "Mill Capacity Master: capacity in tons per day and per hour, diet
  priority order, bin assignment." "Compare Report: all farm demand vs mill capacity per diet."
  Example: "Mill available 238,000 KG per day, with 178,000 KG bulk and 60,000 KG bagged allocation."
- Sheet "Feed Forecast Engine" Section 3 (rows 31–44), especially r42 "Mill Capacity Available KG — Decimal — from Mill
  Master — Mill output available for this diet based on priority and bin assignment" and r43 "Plan vs Mill Capacity —
  GREEN <= capacity, AMBER 90–100%, RED > capacity".
- Sheet "Requisition and Loading Sheet" rows 32 and 67: Mill Loading Bin No. "Auto from Mill Capacity Master via Diet No."
- Sheet "Checkpoints and Validations": the mill capacity checkpoints (search "capacity", e.g. rows 34–35, 42).

## What exists (reuse it)
- Location types MILL and BIN (BIN under MILL). Demo MILL-001 has BIN-001/002.
- BIN Diet Assignment master (`modules/master-data/bin-diet-assignment`): diet per BIN per date and slot. This IS the
  workbook's "bin assignment". Do not duplicate it.
- Feed Plan (Tentative vs Actual, `feed-plan.service.ts`) and Consolidation (`feed-consolidation.service.ts`). Both
  have a capacity concept that is currently unavailable or absent.

## Build
1. **Mill Capacity Master** (one header per MILL location, effective-dated):
   - Mill (MILL location), Effective From;
   - Capacity KG per Day, Capacity KG per Hour;
   - Bulk Allocation KG per Day, Bagged Allocation KG per Day (bulk + bagged <= per day, validated);
   - lines: Diet Priority Order. One row per diet item: Priority rank (1 = highest), Diet item (feed item with diet_no).
     No duplicate diet, no duplicate rank.
   - Active.
   Use migration 0165_mill_capacity_master, idx 164, when 1792000000033. Expose it as a master page under Farm Master
   or Master Data via configs.ts if it fits; otherwise a focused page. Company-scoped like the other feed masters.
   Seed illustrative values for MILL-001 through the API (238,000 / hour derived / 178,000 bulk / 60,000 bagged;
   priorities for the diets that have diet_no).
2. **Mill Capacity Available KG per diet** (r42). Allocate the day's capacity by diet priority: highest demand first,
   per r11, using the priority order. Keep it in ONE pure function, used by:
   - Feed Plan: fill its "Mill Capacity Available" and "Plan vs Mill Capacity" GREEN/AMBER/RED (r42–43). Where no
     master exists, keep showing "Not configured", never 0;
   - Consolidation: warn on, or refuse, approving above capacity, following the checkpoint rows. Quote the row you follow.
3. **Compare Report** (r11), page "Compare Report" under Feed Forecast (new tab after Feed Plan) or Reports. For a
   selected production date or week: per diet, all farms' requested KG (approved feed requisitions) vs mill-approved KG
   vs Mill Capacity Available KG, with status colour and a total row. Filters: Mill, date or week. Export CSV if the app
   has a shared export helper.

Live proof:
- Create the master for MILL-001.
- Open Feed Plan and see the capacity and status.
- Open Compare Report for the week of REQ-MUL100-2026-00001/00002 and see the numbers match MySQL.
- Screenshot to the scratchpad /private/tmp/claude-501/-Users-nero-Desktop-navfarm/15d96eb3-b69c-4856-88ea-870d6d0de605/scratchpad/A/.
