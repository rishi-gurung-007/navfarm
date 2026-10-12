# Task 21 design — Feed Forecast Dashboard becomes a dashboard

Read-only design. No source file touched, no commit made. Written against the worktree at
`5ac07a01`-ish (task-22-audit.md's base) plus whatever the other session has landed since; re-check
`feed-silo-status.ts` / `feed-forecast.service.ts` line numbers before implementing if time has
passed.

Scope: `Inventory → Feed Forecast → Dashboard` tab
(`apps/web/src/components/console/inventory/feed-silo-dashboard.tsx`), its API
(`GET /feed-forecast/silo-status`, service method `FeedForecastService.siloStatus`,
`buildSiloStatus` in `feed-silo-status.ts`), per Rishi's 4 Oct ruling 3 and the brief
`task-21-brief.md`. Folds in audit gaps #4, #7, #8, #17.

---

## 1. The data question

This is the load-bearing section: it decides whether Task 21 ships web-only or needs API work.
Short answer: **it needs API work, but all of it is additive reshaping of numbers the engine
already computes — nothing here requires a new calculation.** `buildSiloStatus` and
`computeForFarm` already carry (in memory) almost everything the four charts and the three missing
tiles need; they just don't surface it yet.

### KPI tiles

| Tile | Fields needed | Status |
|---|---|---|
| Silos at/below Below Feed Level (CRITICAL) | count of rows where `alert === 'CRITICAL_FIRST_PRIORITY'` | **Exists.** `SiloStatusRow.alert` is already computed (`feed-silo-status.ts:82-85`). Pure client-side count. |
| Silos at/above Above Threshold (INFO) | count of rows where `alert === 'INFO'` | **Exists.** Same field. |
| Earliest first-shortage date | `min(firstShortageDate)` across rows | **Exists.** `SiloStatusRow.firstShortageDate` is already returned. Pure client-side min. |
| Farm total recommended order vs 30,000 KG truck target | `sum(recommendedOrderKg)` over **every** farm silo (not just the filtered subset) + `truckTargetKg` | **Partially exists.** Each row's `recommendedOrderKg` is already computed; the *sum* and the *truck target* are not in the response. `settings.truckTargetKg` is already resolved inside `siloStatus()` (via `toFarmFeedSettings`) but never sent back. This is Audit gap #8's first half (r62). **API: add `farmTotals: { recommendedOrderKg, truckTargetKg }`, computed once over the unfiltered row set — see §5 on why it must be unfiltered.** |
| Requisition status / deadline | per-silo `requisitionStatus` (code) + a requisition id to link to; top-level `submissionDeadline` | **Partially exists.** `submissionDeadline` is already top-level. `requisitionStatus` is a raw code with **no id** — `loadLatestRequisitionStatuses` (`feed-forecast.service.ts` ~1350) selects only `destination, status, created_at`, not `requisition_id`. This is Audit gap #7 (r63): the status needs its id to become a link. **API: add `requisition_id` to that select and to the map/row shape.** |

### Three missing workbook fields (the four audit items)

| Workbook row | Field | Status |
|---|---|---|
| r62 Farm Total Order This Cycle KG (vs 30t) | farm-wide sum, see above | Same as the KPI tile above — one API addition serves both the tile and the table/workbook column. |
| r57 Current Diet Days Remaining | days from `planningDate` to the current diet's end | **Derivable, not present.** `buildSiloStatus` already computes a local `change` (the next `DietChange` this silo is party to) and already exposes `change?.changeDate` as `nextDietDate`. "Current Diet Days Remaining" is `diffDays(planningDate, nextDietDate)` when a change exists, else null (no scheduled change in the window). `diffDays` is already exported from `feed-forecast.engine.ts` and already imported by `feed-forecast.view.ts`. **The only gap is that `buildSiloStatus` is not currently given `planningDate`** (its args are `{ silos, result, requisitionStatusBySilo, submissionDeadline, settings }` — no date). Threading it through and adding one field is a few lines, not a new calculation. |
| r56 Projected Need split old item / next item | per-item demand split by `ForecastSource.isNextDiet` | **Fully derivable, not exposed.** `ForecastSource` already carries `itemId`, `walkDemandKg`, `safetyStockKg`, and **`isNextDiet: boolean`** (`feed-forecast.engine.ts:828`). `buildSiloStatus` currently *sums across all sources* into one `projectedNeedKg` (`feed-silo-status.ts:63`): `sources.reduce((sum, s) => sum + s.walkDemandKg + s.safetyStockKg, 0)`. Splitting into `projectedNeedCurrentKg` / `projectedNeedNextKg` is the same reduce, filtered on `isNextDiet`, run twice. No new math — this is literally the brief's "reuse computeForFarm/engine output, no second calculation" sentence, verified against the actual code. |

### The four charts

| Chart | Fields needed | Status |
|---|---|---|
| (a) Balance vs capacity per silo, with Below Feed Level / Above Threshold lines | `capacityKg`, `belowFeedLevelKg`, `aboveThresholdKg`, `systemBalanceKg`, `alert` — all per silo | **Fully exists today.** Every field is already on `SiloStatusRow`/`SiloFact` and already in the current response. This chart is **100% web-only** (given the filter/range plumbing below is in place). |
| (b) Projected closing balance by date per silo/item, shortage point marked | a (silo/item, date) → balance series over the selected range, plus the shortage date | **Computed internally, not returned.** `computeForFarm` already produces `forecast.daily: DailyForecastRow[]` — one row per *batch*, item, date — and each row's `currentInventoryKg` is the **container's** opening balance that day, not a per-batch number (confirmed by reading the walk: `daily` is built from `openingByKey.get(e.key)?.get(e.date)`, where `key` is the same per-(source,item) key used for `sources`/`projectionByKey` — every batch drawing on the same silo+item+date reads the identical value, per the engine's own doc comment "Current Inventory is the container's opening that day (Ruling M7)"). So a per-(sourceCode, itemId, date) series is a **de-duplication of `daily`**, not a new walk. `siloStatus()` calls `computeForFarm` already but only returns `{planningDate, farm, submissionDeadline, itemNames, rows}` — `forecast.daily` is sitting in memory, unused. **API: dedupe `daily` by `(sourceCode, itemId, date)` → `{date, balanceKg: currentInventoryKg, shortageDate}` and return it.** This is the single largest piece of new API work in this task — not because the math is new, but because the reshaping (dedup + filtering to the right silos/items/range) wants its own tested function, not an inline map. |
| (c) Demand by feed item over the range, current vs next diet | `itemName`, `walkDemandKg` (+ `safetyStockKg`), `isNextDiet` — per `ForecastSource` | **Computed, not returned.** Same situation as r56: `forecast.sources` has every field this chart needs, already grouped by (source, item). `siloStatus()` never sends `sources` back. **API: return the (filtered) `sources` array, or an item-grouped aggregate of it** — same addition that answers r56, reused for this chart. |
| (d) Shortfall vs recommended order per silo/item | `projectedShortfallKg`, `recommendedOrderKg` per silo (already on `SiloStatusRow`); per-item breakdown needs `ForecastSource.shortfallKg` | **Per-silo: exists today, web-only.** Per-silo/item (finer-grained, if a silo has two active sources): needs the same `sources` exposure as chart (c). Recommend starting per-silo (web-only) and upgrading to per-item once `sources` is exposed for (c)/r56 anyway. |

### Filters (the brief's "select first") — Daily/Weekly/Reporting Period/Custom, house, silo, item, bulk/bagged

**This is real, not-yet-existing API work**, but it is precedented, not invented:

- **View/range selector.** The Forecast tab's report endpoint (`FeedForecastService`'s other method, ~line 620) already has the full Daily/Weekly/Reporting Period/Custom machinery: `ForecastView`, `resolveViewRange`, a `/feed-forecast/periods` lookup, `query.periodId`. The Dashboard's `siloStatus()` currently **hardcodes** `to = defaultWindowEnd(planningDate)` (fixed 7 days) and accepts only `{ farmId, planningDate }` — no `view`, `from`, `to`, or `periodId`. Fixing this is: thread the same four query params through, call `resolveViewRange` the same way the report method does, and pass the resolved `from/to` into the same `computeForFarm` call `siloStatus()` already makes. No new range logic — a second call site for logic that exists.
- **House / silo / item / bulk-bagged filters.** Audit gap #9 shows these are missing from the *Forecast* tab too, so there's no existing filter implementation to copy. But the filtering itself is trivial once the per-silo rows exist, because every field needed is already on `SiloStatusRow`: `houseCodes: string[]`, `siloId`, `currentDietItemId`/`nextDietItemId`, `feedType: 'BULK'|'BAGGED'`. **Recommend filtering the already-computed `rows` array (and, once added, `sources`/the daily series) rather than filtering `silos` before calling `buildSiloStatus`** — that keeps `buildSiloStatus` running once over the full farm (needed anyway for `farmTotals`), and the filter becomes a plain `.filter()` on the output, not a second engine pass.
- **Open question to flag, not resolve:** when a feed-item filter is applied, does it (a) show only silos whose current-or-next item matches, with that silo's full numbers (simplest, recommended), or (b) re-aggregate demand to just that item inside a silo that serves two? The audit and brief don't say. Pick (a) unless told otherwise — (b) would require filtering `sources` before summing, not just filtering rows.

### requisitionStatus → link (r63, gap #7) — the one cross-cutting piece

Making the status a working link needs more than the id. Today `/inventory/feed-requisitions`
redirects to `/inventory/feed-forecast?tab=feed-requisition`, and that tab's panel
(`requisitions-panel.tsx` / `FeedRequisitionPanel`) has **no support for reading an id from the URL
and auto-opening the detail dialog** — `feed-requisition-detail.tsx` is opened by local state today,
not a route param. So this one gap needs three small pieces, not one:
1. API: add `requisition_id` to `loadLatestRequisitionStatuses`'s select (as above).
2. Dashboard tile/table cell: render `<a href="/inventory/feed-forecast?tab=feed-requisition&open={id}">` with the label from the already-existing `REQ_STATUS_LABEL` map (`requisition-labels.ts`) instead of the raw code.
3. `requisitions-panel.tsx`: read `?open=` via `useSearchParams` and open `feed-requisition-detail` for that id on mount. This file is shared with the common requisition flow's audit gap #5 (the "open in a dialog" ruling) — check whether that other in-flight work already adds `useSearchParams` here before duplicating it.

---

## 2. Chart form choices (dataviz skill)

Recharts version actually declared: `apps/web/package.json` → `"recharts": "^3.10.1"` — but it is
**not currently resolved under this worktree's `node_modules`** (checked; absent). First build-order
item is confirming `pnpm install` has actually synced it (consistent with the worktree's own
standing nx/stale-bundle caution) before writing a line of chart code against it. 3.10 is new enough
that `ComposedChart`, `ReferenceLine`, `Scatter`, `stackId` and `layout="vertical"` are all stable —
design to that, not to anything older.

### (a) Balance vs capacity per silo, with level lines

**Form: horizontal two-segment stacked bar (a "meter"), one row per silo, plus a tick-mark
overlay for the thresholds.**

Per `choosing-a-form.md`, "a single ratio against a limit" is a **meter** job, and here it repeats
once per silo — a list of meters, not one. The two numbers per silo (balance, capacity) are not two
independent series to compare (that would invite a grouped bar, which misreads as "which is bigger"
when the real question is "how full is this tank"), so:

- `ComposedChart`, `layout="vertical"` (recharts' name for bars that grow horizontally), Y axis =
  silo code (category), X axis = KG, domain `[0, max(capacityKg)]` across the visible silos.
- **Bar, `stackId="meter"`, two segments:** segment 1 = `systemBalanceKg` (the fill, colored by
  `alert` — see §3), segment 2 = `max(capacityKg - systemBalanceKg, 0)` (the track, a muted
  neutral). Stacking two segments to a fixed total is exactly the track-plus-fill meter idiom from
  `marks-and-anatomy.md`, and it is simple recharts (`stackId` sums in place — no custom shape
  needed).
- **Level lines are per-silo values (`belowFeedLevelKg`, `aboveThresholdKg` differ by silo), so a
  global `<ReferenceLine>` is the wrong tool** — it draws one X position for the *whole* chart, not
  per category. Use a `<Scatter>` layer sharing the same axes, plotted at
  `(belowFeedLevelKg, siloCode)` and `(aboveThresholdKg, siloCode)`, rendered as a small vertical tick
  (custom `shape`) in `--danger` / `--info` respectively — this is the correct per-row equivalent of a
  "level line" in a small-multiples-by-row chart.
- **Why not a plain single bar + axis gridlines for the thresholds:** gridlines are chart-wide too,
  same problem as `ReferenceLine`; a tick per row is the only form that respects "the thresholds vary
  by silo."
- **Series cap:** this uses `alert`'s three states as **status color**, not categorical identity
  (see §3) — no series-count ladder applies here, it's one bar per silo colored by state.
  Direct-label the balance value at the bar's far (right) end per `marks-and-anatomy.md`'s "value at
  the tip" rule; capacity is implied by the X-axis domain and the track's length, so it does not also
  need a number stamped on it (would be the dashes-everywhere mistake in numeric form — redundant
  ink).
- **Many silos:** if a farm has more than ~10-12 silos this becomes a long scroll, which is fine for
  a horizontal list (unlike a wide chart, a tall one scrolls naturally) — no pagination needed at
  farm scale, but confirm against a farm with the most silos in seed data before assuming.

### (b) Projected closing balance by date per silo/item, shortage point marked

**Form: multi-line chart, X = date, Y = balance KG, one line per (silo, item) in the current
selection; the shortage date marked with a status-colored point, not a second axis.**

This is squarely `choosing-a-form.md`'s "trend over time" → line, "tell distinct series apart" →
categorical color, because the reader's job is literally "watch this/these lines fall and see where
they'd cross zero." It is **not** an area chart: area implies a single cumulative quantity (stock as
area-under-curve reads as "amount consumed," which is not the story — the story is "level over
time," a line).

- `LineChart`, `type="monotone"`, 2px stroke (per mark spec), `dot={{r:4}}` only at data points
  actually present (daily granularity in Daily/Custom view; weekly/period views have fewer points,
  so don't force daily density).
- **Series-count ladder applies directly** (`choosing-a-form.md`): 1-3 silos selected → color alone
  is fine, direct-label the line ends; 4 → direct labels become mandatory and this is also exactly
  where the categorical palette's 4th slot (yellow beside orange) starts needing that labeling,
  which the skill flags as a real cost, not decoration; past ~4-6, this chart should **not** try to
  show every matching silo — cap the legend/line count (soft cap 5-6) and push the rest to the table,
  or require a silo filter to narrow before this chart renders (consistent with "select first").
- **Shortage point:** a `<Scatter>` (or `ReferenceDot`) marker at `(shortageDate, balanceKg)` for each
  line that has one, in `--danger`, with a visible icon/label on hover (status color, never alone —
  same rule as the KPI tiles). If **one** silo/item is selected, a single vertical `ReferenceLine` at
  the shortage date is also legitimate here (unlike chart (a), this chart's X axis is shared across
  every line in the SAME range, so one shortage date per line, marked per line, is correct; a single
  global vertical line is only right when exactly one line is shown, otherwise it's ambiguous which
  line it belongs to — prefer the per-line Scatter marker in the multi-line case).
- **Why not small multiples:** with the series cap above (≤5-6 lines), one shared chart stays
  readable and lets the reader compare silos directly, which the brief's framing ("per silo/item over
  the selected range") wants. Small multiples would be the right call only past that cap, which
  should not happen if the filter bar is doing its job (farm manager picks a house/silo before this
  gets busy).

### (c) Demand by feed item over the range — current vs next diet

**Form: grouped vertical bar, X = feed item name, two series (Current diet, Next diet), categorical
color.**

`choosing-a-form.md`: "tell distinct series apart" → grouped bar → categorical. Two series, well
within the 1-3 "color alone is comfortable" band — still direct-label both bars' values at the cap
per the mark spec, since there are typically only a handful of items on screen.

- `BarChart`, X = item name (category), two `<Bar>` per item: `dataKey="currentDemandKg"`,
  `dataKey="nextDemandKg"`, **not stacked** (`stackId` omitted — these are two comparable
  magnitudes, not parts of one whole; stacking would visually sum them into a number that means
  nothing, "total demand across two different diets is not an addable quantity the reader wants").
  Grouped (side-by-side) bars are the correct unstacked form here.
- This chart is the **primary visual home of the r56 split** — see §6.
- An item that only has a Current bar or only a Next bar (the common case: most items are not
  mid-change) should simply omit the missing bar rather than draw a zero-height one with a label —
  avoids the "0.00 everywhere" clutter the 2 Oct no-dashes ruling was reacting to in a different
  form.

### (d) Shortfall vs recommended order per silo/item

**Form: grouped horizontal or vertical bar, X/category = silo (or silo+item), two series (Shortfall,
Recommended order), categorical color — not status color.**

This was the one case worth second-guessing against the obvious instinct. Shortfall *reads* as "a
problem" and recommended order as "the fix," which tempts reaching for status color
(critical/good). **That would be wrong per `color-formula.md`'s collision rule**: "when a series
*means* good/bad it wears status tokens; when it's just series 4 it wears categorical — never
both in one chart." Here the two numbers are not a state (there is no "this silo is in a good
state and that one is in a bad state" reading) — they are two comparable magnitudes the reader
wants side by side to judge *whether the recommended order actually covers the shortfall* (it
should, by construction — `roundOrderKg` rounds up from the shortfall per silo/item — so the real
reading is "is the order bar at least as tall as the shortfall bar," a magnitude comparison, not a
status readout). Categorical color (slot 1 = Recommended order, slot 2 = Shortfall, consistent
ordering with chart (c) if both appear on screen together) is the right call; reserve `--danger` for
the *alert badges and the tiles*, where a value genuinely is a state.

- `BarChart`, grouped (not stacked, same reasoning as (c): these are not parts of a whole).
- Direct-label both bar tips; legend present (2 series).
- Per-silo is enough to ship first (data already exists); per-silo+item (needs `sources`) is the
  natural upgrade once that API surface exists for (c)/r56 anyway — don't build it twice.

---

## 3. Colour system

The app's own design tokens (`apps/web/src/app/global.css`) give a single accent hue plus a fixed
four-step status set (`--danger`, `--warning`, `--success`, `--info`) — **no 8-hue categorical
ramp, no sequential ramp, no diverging pair.** So: reuse the app's existing status tokens for every
state/severity encoding (they already theme correctly light/dark and already drive `Badge` and
`StatCard`'s `tone`), and add the dataviz skill's validated 8-hue categorical set as new chart-only
tokens for identity encoding (diet/item, shortfall-vs-order), since nothing in the app currently
fills that role. Do not invent a third system — two is already the minimum that covers "state" and
"identity" as distinct jobs, per the skill's own collision rule.

### Status (state) — reuse the app's existing tokens, not the skill's status hex

| Role | Light | Dark | Used for |
|---|---|---|---|
| critical | `var(--danger)` (`#b7293e` / `#f0616f`) | same var | alert = CRITICAL_FIRST_PRIORITY (chart a fill, tiles, badges) |
| info | `var(--info)` (`#4e6e9e` / `#7996c2`) | same var | alert = INFO (chart a fill, tiles, badges) |
| normal/good | `var(--success)` or `var(--accent)` | same var | chart (a) fill when balance is between the two thresholds |
| track (meter) | `var(--border-strong)` or `var(--surface-secondary)` | same var | chart (a) unfilled segment |

These already flip correctly between light and dark because they're CSS custom properties resolved
per-theme by the app's existing `[data-theme]`/`prefers-color-scheme` rules (confirmed in
`global.css` lines ~19-71 light, ~1596-1639 dark) — no new validation needed for *reuse* of a
token the app already ships; I did check their contrast against the app's actual chart/card surface
(`--surface`: light `#ffffff`, dark `#272932`) using the skill's own `contrast()` helper, since the
skill's validator only judges *categorical* palettes, not a lone status color:

```
good(success)    #0ca30c-style check N/A — using var(--success)/var(--danger) etc. directly, not the skill's fixed status hex
--danger  on #ffffff: 4.80   on #272932: 3.02   (both ≥3:1 — fine for a fill with a label, which this always has)
--warning on #ffffff: not used here (not part of this chart's 3-state alert)
--info    on #ffffff: contrast not separately re-run — reuse of an already-shipped, already-audited token
```

Every status-colored mark in this design ships with a legend/label (never color alone), satisfying
the skill's "status always icon+label" rule regardless of the exact contrast number.

### Categorical (identity) — the skill's validated default palette, first three slots

The app has no categorical ramp, so this introduces one, as new CSS variables (not raw hex inline),
following `palette.md`'s pattern of swapping in the system's own values — here there are none to
swap, so the skill's defaults stand as-is:

| Slot | Role in this dashboard | Light | Dark |
|---|---|---|---|
| 1 (blue) | "Current diet" (chart c) / "Recommended order" (chart d) / silo line 1 (chart b) | `#2a78d6` | `#3987e5` |
| 2 (orange) | "Next diet" (chart c) / "Shortfall" (chart d) / silo line 2 (chart b) | `#eb6834` | `#d95926` |
| 3 (aqua) | silo line 3 (chart b), only when a 3rd line is shown | `#1baf7a` | `#199e70` |

**Validated, not assumed** — ran the skill's validator against the app's real chart surfaces
(`--surface`: `#ffffff` light / `#272932` dark), not the skill's generic placeholder surface:

```
LIGHT, 8 slots, adjacent (surface #ffffff): PASS lightness · PASS chroma · PASS CVD (worst adjacent ΔE 9.1)
  · PASS normal-vision floor (19.6) · WARN contrast (3 slots <3:1 — relief required: direct labels + table, both already planned)
DARK,  8 slots, adjacent (surface #272932): PASS lightness · PASS chroma · PASS CVD (worst adjacent ΔE 8.4)
  · PASS normal-vision floor (19.3) · WARN contrast (1 slot <3:1 — same relief)
LIGHT, first 3 slots, --pairs all (surface #ffffff): ALL PASS including contrast
DARK,  first 3 slots, --pairs all (surface #272932): ALL PASS including contrast
```

Chart (b) can carry crossing lines (any two could be adjacent at any point), so it is held to the
**all-pairs** cap of 3 slots (validated clean above) — this is why the series-count ladder in §2's
chart (b) caps at ~5-6 only as a *soft* legend cap; the *colour* cap for a scenario where lines can
cross is 3 before folding/faceting, and the design should treat 3 as the point to add a filter nudge
("narrow to fewer silos"), not silently degrade to a 4th hue. Charts (c)/(d) use only slots 1-2 under
the easier *adjacent* rule (grouped bars, not crossing), already proven PASS above with the full
8-slot order.

**Define once, as roles, not inline hex** — add to `global.css` (or a scoped block in the dashboard
component, matching how `apps/web/src/app/(app)/dashboard/page.tsx` already does `CHART_COLORS` as a
local const, though that file mixes CSS vars and raw hex; this design recommends proper
light/dark-aware custom properties instead, since this dashboard needs the *dark* variant correct too
and `CHART_COLORS`'s raw hex entries (`"#8a6fd6"`, `"#4fb0a5"`) do **not** flip for dark — don't copy
that part of the existing pattern):

```css
:root { --chart-series-1: #2a78d6; --chart-series-2: #eb6834; --chart-series-3: #1baf7a; }
:root:not([data-theme="light"]) { @media (prefers-color-scheme: dark) {
  --chart-series-1: #3987e5; --chart-series-2: #d95926; --chart-series-3: #199e70;
} }
:root[data-theme="dark"] { --chart-series-1: #3987e5; --chart-series-2: #d95926; --chart-series-3: #199e70; }
```

### Sequential / diverging

**Not used in this design.** None of the four charts has a continuous-magnitude-on-a-grid or
polarity-vs-baseline job that isn't better served by the forms above (checked each against
`choosing-a-form.md`'s table before settling on bar/meter/line). If a future heatmap (e.g. silo
fill % across the whole farm as a grid) is wanted, that would pull in the skill's single-hue
sequential blue ramp (`palette.md`) — not needed for Task 21 as scoped.

---

## 4. KPI tiles

Reuse `StatRow`/`StatCard` from `apps/web/src/components/ui/stat-row.tsx` (already the farm's shared
"KPI strip" primitive — it already supports `tone` (default/success/warning/danger, matching the
app's own status tokens) and `href` (exactly what the Requisition Status tile needs) and already
distinguishes a "card with an opinion" (`tone` alone) from "a card that IS a status indicator"
(`emphasis`), which is the same distinction the dataviz skill draws between a plain metric and a
status encoding — convenient, pre-existing alignment; do not invent a parallel tile component.

| # | Label (workbook/brief) | Value | `tone`/`emphasis` | `href` |
|---|---|---|---|---|
| 1 | Silos below Below Feed Level | count, CRITICAL | `tone="danger" emphasis` (it IS a status indicator) | — |
| 2 | Silos above Above Threshold | count, INFO | `tone="warning"` or a new info tone if `StatCard` is extended — check: today's `tone` enum is default/success/warning/danger only, **no `info`**; either add one (small, S) or use `default` with an info-colored icon | — |
| 3 | Earliest first shortage | date (dayShort format, existing `day()` helper) | `tone="danger"` if within the farm's reorder-sensitive window, else `default` | — |
| 4 | Farm Total Order This Cycle (r62) | `{farmTotals.recommendedOrderKg} / {farmTotals.truckTargetKg} kg` | `tone="warning"` once ≥90% of target (the existing "approaching-truck" 90% configurable warning per decisions.md) | — |
| 5 | Requisition status / deadline | status label (via `REQ_STATUS_LABEL`) + `submissionDeadline` | `tone` per status (reuse `REQ_STATUS_LABEL`'s `variant` → `StatCard`'s `tone`, they already share the same vocabulary: success/warning/danger/neutral) | yes — to the requisition, once the id/open-param work in §1 lands |

Row 2's missing `info` tone is a one-line gap in `stat-row.tsx` worth flagging to the implementer —
small, but don't improvise a one-off style instead of extending the shared primitive.

---

## 5. Filter bar behaviour

Order per the brief: **farm, view/period, house, silo, feed item, bulk/bagged.**

- **Farm.** Fixed (label only) for a Farm Manager; a selector for anyone scoped wider — reuse
  `FeedFarmSelect`/`useFeedFarm`, already shared across every feed tab (do not re-implement).
- **View/period.** Daily / Weekly / Reporting Period / Custom From–To, **default 7 days** per the
  global constraint. Reuse `FORECAST_VIEWS`/the Forecast tab's exact widget pattern
  (`feed-forecast-panel.tsx` lines ~219-256): a `<select>` for the view, conditionally a Reporting
  Period `<select>` (fetches `/feed-forecast/periods`) or a From/To date pair for Custom. Daily
  view = `from = to = date`; Weekly = `from..from+6`; these are exactly `resolveViewRange`'s existing
  branches.
- **House.** Dependent on farm (the farm's own houses); independent of silo/item. Populate from the
  already-loaded `SiloStatusRow.houseCodes` superset, or a lightweight `/location`-style lookup if
  one already exists for houses — check before adding a new endpoint.
- **Silo.** Dependent on farm, **and narrowed by house** once a house is chosen (a silo whose
  `houseCodes` doesn't include the selected house drops out of the silo dropdown's options) —
  this is the one real "dependent filter" relationship in the bar. Not dependent on item (silo
  identity doesn't change with item selection).
- **Feed item.** Dependent on farm; options = the distinct `currentDietItemId`/`nextDietItemId` names
  seen across the farm's rows (or, once `sources`/`itemNames` is exposed more fully, every item name
  in that map). Not dependent on house/silo — a farm manager may want "show me every silo currently
  on Starter Mash" across houses.
- **Bulk/bagged.** Independent toggle/select (`BULK`/`BAGGED`/both), filters on `SiloStatusRow.feedType`.
- **Defaults** so the page is never empty (brief: "nothing heavy loads until the selection is made
  (sensible default selection allowed)"): farm = the Farm Manager's fixed farm (or first available),
  view = Weekly/default-7-days, house/silo/item = "All", bulk/bagged = "All". This matches "select
  first" without actually forcing an empty state — the farm+default-range selection alone is enough
  to fetch something meaningful on first load, same as the Forecast tab does today.
- **Empty selection (house/silo/item cleared to "All"):** show the full farm's rows/charts — "All"
  is a valid, non-empty selection, not a blocked state. The brief's "select first" is about not
  loading **before any farm/range context exists at all**, not about demanding every filter be set.
- **Refetch behaviour:** per `interaction.md`, filters scope everything below them in one request
  cycle, and a reload should hold the previous render at reduced opacity rather than flashing a
  skeleton — straightforward to add given the panel already has a `loading` boolean; currently it
  blanks `data` to `null` on every `load()` call (`feed-silo-dashboard.tsx`'s `load` sets
  `setData(null)` immediately) — that line should change to **not** clear data until the new response
  lands, to get the "hold previous render" behaviour the skill asks for.

---

## 6. The r56 split — where it appears

Old item / next item demand over the range shows in **three places**, not one, each for a different
reader need:

1. **Chart (c)** is the primary visual home — grouped bars, X = item, one bar per diet-role
   (Current/Next), per §2. This is the "see it at a glance across every item" view.
2. **The workbook table** gets the split as two columns (or Projected Need plus a "of which, next
   diet" column) rather than the single combined `fsdColNeed` it has today — the workbook explicitly
   lists the split at r56, and the table is the page's source-of-record view, not just the charts'
   backing data. Recommend two numeric columns: "Projected Need — Current Item (kg)" and "Projected
   Need — Next Item (kg)", both using the existing `kg()` formatter.
3. **Not a KPI tile** — a single-number KPI tile would have to pick one side of the split or sum it
   back into one number, defeating the point; leave this to the chart and the table.

---

## 7. Build order and effort estimate

Smallest-risk-first. Each API piece explicitly reuses existing engine/service output per the
analysis in §1 — flagged again here only where that's easy to get wrong.

| # | Piece | Risk / why this order | Effort |
|---|---|---|---|
| 0 | Confirm `recharts` is actually resolved in `apps/web/node_modules` (declared in `package.json`, not found installed as of this audit) | Zero-risk check, but blocks everything chart-related; this worktree has a documented history of nx/stale-bundle traps — verify the real artifact, not the declared version | S |
| 1 | API: thread `view`/`from`/`to`/`periodId` into `siloStatus()`, reusing `resolveViewRange` exactly as the report method does | Mechanical copy of an existing, tested pattern; main risk is the default-7-days fallback when nothing is passed | S |
| 2 | API: house/silo/item/bulk-bagged filters as a post-`buildSiloStatus` `.filter()` on `rows` (and `farmTotals` computed from the **pre**-filter set) | All fields already present; the only subtlety is computing `farmTotals` before filtering, not after | S/M |
| 3 | API: `requisition_id` added to `loadLatestRequisitionStatuses`; r57 (`currentDietDaysRemaining`, needs `planningDate` threaded into `buildSiloStatus`); r56 split (`projectedNeedCurrentKg`/`projectedNeedNextKg`, filter the existing `sources.reduce` by `isNextDiet`); r62 (`farmTotals`) | Four small, independent, well-understood additions to `buildSiloStatus`/`siloStatus()` — bundle as one PR, they touch the same functions | S |
| 4 | API: expose `sources` (filtered to the selection) in the Dashboard response — feeds chart (c), chart (d)'s per-item upgrade, and is the data source for r56's chart placement | Reshaping, not new math, but the first piece that changes the response *shape* (a new array, not just new scalar fields) — write its test first | M |
| 5 | API: by-date balance series for chart (b) — dedupe `forecast.daily` by `(sourceCode, itemId, date)` | The one piece worth being careful with: confirm in a real test that two batches sharing a silo+item+date really do carry identical `currentInventoryKg` before trusting the dedup (the code comment says so; verify it, per this project's own "prove it, don't assume it" rule) | M |
| 6 | Web: filter bar (farm/view/period/house/silo/item/bulk) wired to the above | Mostly copying `feed-forecast-panel.tsx`'s existing widgets; the dependent silo↔house relationship is the only new logic | M |
| 7 | Web: KPI tiles via `StatRow`/`StatCard`, including the `info` tone gap in `stat-row.tsx` if not already extended | Small, well-understood primitive reuse | S |
| 8 | Web: chart (a) — meter bars + threshold ticks | New recharts composition (stacked segments + Scatter tick overlay) not used elsewhere in the codebase yet — budget time for the overlay, not just the bar | M |
| 9 | Web: chart (c) and (d) — grouped bars | Standard recharts grouped-bar, closely matches existing patterns in `(app)/dashboard/page.tsx` | S/M each |
| 10 | Web: chart (b) — multi-line with shortage markers | New: per-line Scatter markers, series cap enforcement, "fold to table past N silos" | M |
| 11 | Web: table — split r56 columns, Requisition Status as a link+label, dash cleanup on touched columns | Mechanical once the API fields exist | S |
| 12 | Cross-cutting: `requisitions-panel.tsx` reads `?open=` and opens the detail dialog | Touches a file the other in-flight session (common requisition dialog work, gap #5) may also be touching — **check for collision before writing**, don't duplicate the `useSearchParams` wiring | S, but coordinate first |
| 13 | Tests (per the brief: API filters + series; web renders filter bar, tiles, charts mount, table) | Write alongside each numbered piece above, not at the end | spread across all of the above |

**Total: roughly one M-heavy task — call it 2 L-days of API work (pieces 1-5) plus 3-4 L-days of web
work (pieces 6-11), S glue (0, 3, 7, 12-13).** The audit's own gap list called the whole page "L" and
gaps #7/#8/#17 "S" each; this breakdown agrees with that at the aggregate level but shows the
estimate does **not** come from new forecasting logic anywhere — it comes entirely from (a) plumbing
view/range/filters through an endpoint that never had them, (b) reshaping two already-computed
in-memory structures (`sources`, `daily`) into HTTP response shapes, and (c) four net-new recharts
compositions this codebase hasn't built before (meter+ticks, multi-line+per-line markers).

### What should split into its own task

- **Piece 12 (requisitions-panel `?open=` support)** should be confirmed against — or merged with —
  whatever the "requisitions open in a dialog" work (audit gap #5, the 4 Oct dialog ruling) is
  already doing to that file. If that work is in flight, Task 21 should depend on it rather than
  duplicate it, not build a second way to open the same dialog.
- **Chart (b)'s per-silo dedup of `daily` (piece 5)** is the one piece with real technical risk (an
  unverified assumption about shared `currentInventoryKg` across batches) and genuinely new response
  shape. If the dispatch wants a hard size cap per task, this is the one piece that could reasonably
  be split out and landed first, on its own, before the rest of the dashboard is built on top of it —
  everything else in this design is additive and low-risk by comparison.
- **The `info` tone gap in `StatCard`/`stat-row.tsx`** (§4) is tiny but touches a shared primitive
  used elsewhere in the app — worth its own one-line PR rather than folding a shared-component change
  into a feature PR, consistent with this project's general caution about touching shared code
  incidentally.
