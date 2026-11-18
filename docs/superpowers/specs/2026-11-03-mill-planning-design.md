# Mill Planning — design

Date: 3 Nov 2026. Owner: Rishi. Replaces the Feed Plan tab of Inventory → Feed Forecast.

## Why

The mill manager has to produce feed **before** the farms' requisitions arrive,
so the feed is ready to ship on time. Today every Feed Forecast tab works on one
farm at a time; nothing shows the mill what all farms will need over the coming
week. Rishi was asked (meeting, 2 Nov) to turn the feed plan into **mill
planning**: a forecast across all farms, by shed and silo, with the diet
changes, from which the mill manager plans production.

Reference: the "Feed Mill Planner" mockup shown in that meeting (screenshots in
the conversation of 3 Nov). The mockup is the target layout; its figures are
invented and none of them are to be copied.

## What it is

A tab named **Mill Planning** in Inventory → Feed Forecast, in the place of
Feed Plan. The user sets filters, clicks **Generate**, and the page builds a
one-week forecast for every selected farm and adds it up for the mill.

Nothing is computed until Generate is clicked (Rishi). Changing a filter after
generating does not recompute; the user clicks Generate again.

## Goals

1. Filters: **Week of** (start date), **Farms** (all, or some), **Feed Types**
   (all, or some), and **Mill**. Then **Generate**.
2. A horizon of **one week**, seven day columns, as in the mockup (Rishi).
3. Every number comes from NAVFarm data: the forecast engine, the MILL
   location's capacity and BIN Diet Assignments, silo and store stock, open
   requisitions and transfers.
4. Show, for the mill manager, everything needed per farm, shed and silo,
   including the diet changes (Rishi).

## The page, top to bottom

1. **Filter bar** — Week of, Farms, Feed Types, Mill, Generate; Collapse all /
   Expand all for the grid.
2. **Mill capacity strip** — per day: planned production ÷ the mill's daily
   capacity (`mill_daily_capacity_kg` of the MILL location), with a warning
   mark when a day is at or above `capacity_warning_pct` from Feed Planning
   Settings and a block mark above 100 % *(builder's call, settled in review)*.
   Per-feed-type capacity (bulk / bagged pools and the day's BIN Diet
   Assignments, the existing `allocateMillCapacity` rule) is shown as a status
   on each row of the production table, so a feed type with no BIN that day
   reads "not scheduled" there.
3. **Summary cards** — total week requirement (t); farms in the plan (with sheds
   and silos counted); feed types this week; diet changes this week; days near
   or over capacity; silos running out within the week. No "vs prior week"
   figure (it is not computed anywhere today; mockup only).
4. **Production by feed type** (not in the mockup; added because the mill makes
   feed by feed type, not by shed) — one row per feed item, one column per day:
   what the mill must make that day. It is the sum of two parts (Rishi, 3 Nov):
   - **Approved requisitions not yet produced**, on their production date
     (the demand `MillCapacityService.approvedDemand` already reads for the
     Compare Report).
   - **The forecast's net need still to come**: the engine's
     `recommendedQtyKg` per source, which already subtracts stock on the farm
     and feed requisitioned, transferred or planned incoming, so nothing is
     counted twice.
   The mill produces **daily** (Rishi, 3 Nov): net need is placed on the day
   it must be delivered (the engine's `deliveryDate`), not gathered onto the
   Production Weekday. The table may show the two parts as separate figures
   so the manager sees how much is already ordered.
5. **Diet changes this week** — one line per change: farm / shed, batch, the
   date, from feed → to feed, head count. From the engine's `DietChange` list,
   with heads joined from the daily forecast rows (DietChange carries none).
6. **Farm × shed × day grid** — as in the mockup:
   - A mill-total row per day at the top.
   - One collapsible group per farm with its farm total per day.
   - One row per shed (per batch line where a shed holds more than one): shed
     name, the feed type chip (two chips joined by an arrow on a diet change),
     head count. (Not average age: the forecast's daily rows carry no age;
     found while planning, 3 Nov.) Cells show **what the animals eat that day**
     (the engine's daily intake), in tonnes.
   - The cell on a diet-change day is highlighted.
   - **Silo rows** under each farm (not in the mockup; asked for by Rishi as
     "silo wise"): one row per silo/store feeding that farm, showing opening
     stock, then the projected closing balance per day, with the run-out day
     highlighted.

## Removing Feed Plan (Rishi: "Screen and background")

- The Feed Plan table and its saved-versions list leave the screen.
- The scheduled **Tentative plan** job (`TENTATIVE_PLAN` in `FEED_JOBS`) goes,
  including its manual "Run now"; its day / time fields leave Feed Planning
  Settings.
- Approving a feed requisition no longer writes an **Actual** plan version
  (`refreshActualPlanAfterApproval`; found while planning, 3 Nov).
- The **"plan available"** alert (`PLAN_AVAILABLE`) is no longer raised. The
  ones open at release are closed once (Rishi, 3 Nov); their rows stay.
- The endpoints `GET /feed-forecast/feed-plan`,
  `GET/POST /feed-forecast/feed-plan/versions` and
  `GET /feed-forecast/feed-plan/versions/:id` go.
- **Nothing is deleted from the database.** The `feed_plan` tables and their
  rows stay. Places that read them for history keep working: forecast run
  history still shows a plan code where one exists, and a run used by a saved
  plan still cannot be deleted permanently.
- The uncommitted feed-plan edits of 3 Nov (patch in the session scratchpad)
  are not applied.

## Non-goals

- No saving of a Mill Planning result. It is computed on Generate and shown.
- No new production orders, consolidations or requisitions from this screen;
  Mill Consolidation and Mill Production stay as they are.
- No change to the forecast engine's rules.
- No horizon other than one week.
- No "vs prior week" comparison.

## Anti-goals

- Any figure that is not from NAVFarm data (the mockup's 120 t/day, +4.2 %,
  farm names).
- Running the forecast on every filter change or on page load.
- Deleting saved feed plan rows.

## Constraints

- Follow AGENTS.md: piggery only; English-only new strings; verify by driving
  the app and reading MySQL, not by tests alone.
- Reports export to Excel only (house rule, e23a4258) — if an export is added,
  Excel.
- Permission: the same as the Feed Forecast tabs (`INVENTORY` / `LEDGER` /
  `view`).
- Farm scope: a user sees only the farms they are scoped to.
- The engine is per farm (`computeForFarm`/`getForecast`). Running ten farms
  in one request must stay within the 8 GB dev machine's limits.

## Mill filter *(builder's call, settled in review)*

No table links a farm to a mill; mills belong to a company. The Mill filter
picks whose capacity is shown and limits the Farms list to farms of that mill's
company. It defaults to the first mill, as the Compare Report does.

## Left to the builder

- Whether the API gets one new endpoint (`GET /feed-forecast/mill-plan`) that
  loops the engine over the farms, or the web calls the per-farm forecast in
  turn. A single endpoint is preferred so the totals are computed once.
- Exact card and chip styling, matching the existing Feed Forecast tabs.
