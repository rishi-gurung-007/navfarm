# Task 22 — Proposed task list from the field audit

Date: 2026-10-04. Read-only analysis of `task-22-audit.md` against the live code at this
worktree's current HEAD. Governing: decisions.md 2026-10-03/04 (workbook governs feed field
names/order/content, page by page). No source file touched; no commit made.

## What the four in-flight tasks already consume

Checked against the audit's own gap list (24 rows) and `task-18-brief.md` / `task-19-brief.md` /
`task-20-brief.md` / `task-21-brief.md`:

| Gap # | Field / item | Absorbed by |
|---|---|---|
| 1 | Feed Requisition tab New skips the chooser | Task 19 |
| 2 | Feed Forecast silo code + silo name on rows | Task 20 |
| 4 | Dashboard whole page: selectors + charts | Task 21 |
| 5 | Requisition edit in a dialog (feed + common) | Task 18 |
| 7 | Dashboard Requisition Status link | Task 21 (explicit) |
| 8 | Dashboard Farm Total Order This Cycle + Current Diet Days Remaining | Task 21 (explicit) |

That is **6 gap rows fully absorbed**. One row is **split**, and I did not find it claimed in
full by any of the four — see the flag immediately below before the task list, because it is the
one that would otherwise fall between two tasks.

### Flag: gap #17 is only half-covered

Gap #17 (Feed Forecast Dashboard, Engine r49/r55D) asks for three things on the Silo Code column:
(a) add Silo Name, (b) make the code clickable to the silo detail, (c) colour Days Remaining
(<3 critical, <7 warning). Task 20's brief says plainly "the silo dashboard ... show both
[code and name] too where they show a silo" — so **(a) is Task 20's job**. Task 20's brief does
**not** mention a link or colouring, and Task 21's brief (which rewrites this exact table —
point 4, "every workbook column above") also never mentions a link or colouring — it lists
columns and charts, not interaction or conditional styling on existing columns.
**(b) and (c) are not claimed by any of the four tasks.** They are small, but this file
(`feed-silo-dashboard.tsx`) is about to be substantially rewritten by Task 21, so a standalone
task touching it now would likely be clobbered or produce a merge fight. I am **not** proposing a
separate task for (b)/(c) — I'm flagging it so whoever scopes Task 21 adds "silo code links to
the silo's Location record; Days Remaining shows critical/warning colour" to that task's
acceptance criteria, or opens a tiny follow-up once Task 21 has landed and the table's shape is
settled.

### Query Rishi, not a task: gap #22

Location code format (`FarmCode-HouseCode-SILOx`, manual) and silo-house mapping effective dates.
The audit itself says "needs Rishi ruling before changing", and the brief for this document
repeats the standing ruling: silo codes keep the location Number Series
(`GRA100/SILO-001`) because one silo can serve several houses — the workbook's format is an
example, not a spec. **Do not build this.** The mapping-effective-dates half (who was attached to
which silo, from when) may be worth asking Rishi about separately — it's a real workbook field
(MS r8) with no code-format baggage — but I'd ask before scoping it; it is not obviously needed for
piggery MVP.

---

## Proposed tasks

### Task 23 — Feed Forecast: add House/Batch/Silo/Item/Bulk-Bagged filters
**Closes:** gap #9 — FF sheet r8 C8; Engine r20.
**Page:** Inventory → Feed Forecast → Forecast tab.
**Files:** `apps/web/src/components/console/inventory/feed-forecast-panel.tsx` (filter row,
219-256), `feed-forecast-grid.tsx` (`ReportRow`, 24-47) for client-side filtering by
`shedCode`/`batchId`/`sourceCode`/`itemId`; API `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts`
(`ReportRow`) and `feed-forecast.engine.ts` for Bulk/Bagged only.
**API or web:** Mostly **web-only** — House, Batch, Silo and Feed Item are already on every
`ReportRow` (`shedCode`, `batchId`/`batchNo`, `sourceCode`, `itemId`/`itemNo`), so those four
filters can be client-side against rows already fetched. **Bulk/Bagged needs API work**: no
`feed_form`/feed-type field exists anywhere on `ReportRow` or `ForecastSource` today — it has to
be threaded from `breed_lifecycle_stages.feed_form` (already selected elsewhere in
`feed-forecast.service.ts` around line 1836-1850 for the demand query, just not carried into the
row the grid renders) through the engine into the view.
**Effort:** M — four filters are cheap; the fifth needs a real (if small) field addition through
engine → view → grid.
**Depends on:** none of the four excluded tasks touch this file's filter row.
**Risk:** none significant; this is additive UI state, not a data-shape change for the four
client-side filters.

### Task 24 — Feed Forecast: add missing output columns
**Closes:** gap #10 — Engine r70, r11, Step 8.
**Page:** Inventory → Feed Forecast → Forecast tab.
**Files:** `apps/api/src/modules/inventory/feed-forecast/feed-forecast.view.ts` (`ReportRow`
interface, `groupRows`), `feed-forecast.engine.ts`/`.service.ts` (source of the per-head rate and
current silo item), `feed-silo-status.ts` (`SiloFact.feedInSiloItemId/Name` — same concept,
already computed for the dashboard, reusable rather than recomputed), `apps/web/src/components/console/inventory/feed-forecast-grid.tsx` (columns 78-83, render 284-378).
**API or web:** **Mixed, API-heavy.**
- *Daily Use* is nearly free: `ReportRow.intakeKg` is already computed per date cell
  (`feed-forecast.view.ts:87,126,136`) and already flows to the grid's `dateMap`
  (`feed-forecast-grid.tsx:116,212,215`) — it is aggregated but never rendered as a column. This
  one is web-only.
- *Rate (KG/head/day)* needs API work: the engine already selects
  `feed_qty_per_head_per_day_kg` per lifecycle row (service.ts:1839) but never carries the
  per-head figure into `ReportRow` — only the heads×rate total (`perDayIntakeKg`) survives.
- *Current Silo Item* needs API work: `SiloFact.feedInSiloItemId/Name` exists for the dashboard
  but nothing joins it onto the forecast grid's rows.
- *Receipts*, *Recommended Qty*, *Delivery Date* need new fields end to end — none exist on
  `ReportRow` today. Receipts tracks real in-house feed receipts only (Part C TO receipts stay
  out of scope); Recommended Qty and Delivery Date already exist on the dashboard/requisition —
  same reuse opportunity as Current Silo Item.
**Effort:** M — six sub-items, one free, three reuse existing calculations, two are small genuine
additions.
**Depends on:** touches `ReportRow` — coordinate with Task 20 (which also adds `sourceName` to
the same interface) so both land on the same shape rather than conflicting on the same file.
**Risk:** none of this is a recompute — every field either already exists elsewhere in the
engine or needs a one-column addition. The risk is purely merge ordering with Task 20.

### Task 25 — Feed Forecast: show run metadata already stored
**Closes:** gap #11 — Engine r68.
**Page:** Inventory → Feed Forecast → Forecast tab (run history).
**Files:** `apps/web/src/components/console/inventory/feed-forecast-run-history.tsx` (the
`ForecastRunSummary` interface, 10-18, and the row render, 63-69); API
`apps/api/src/modules/inventory/feed-forecast/feed-forecast.controller.ts` (`runs` endpoint,
line 45) and `feed-forecast-run.service.ts`.
**API or web:** **Both, but small.** `feed_forecast_run.source_cutoff_at`, `config_snapshot`
and `created_by` are already written on save (`feed-forecast-run.service.ts:139,141`) — they
just aren't selected into the `runs` list response, and `ForecastRunSummary` on the web side
doesn't declare them. As-of timestamp is `created_at`, already fetched but not shown
(`run-history.tsx:17`).
**Effort:** S — every value is already in the database; this is "select it, type it, print it."
**Depends on:** none.
**Risk:** low. `config_snapshot.version` and `created_by` (a user id) will need a label/name
lookup for display — check whether `created_by` resolves to a user name anywhere nearby before
printing a raw UUID (the same class of defect as gap #3).

### Task 26 — Cross-page: replace dash placeholders with real values or blanks
**Closes:** gap #24 — 2026-10-02 ruling 3 (no dashes).
**Pages:** all feed screens — this is the one gap that is explicitly cross-cutting, not
page-scoped (the audit's own pages table files it under Feed Forecast, but its grid list goes
further: Stages sub-tab, the Dashboard, Physical Count).
**Files:** `feed-forecast-grid.tsx` (402, 406 — Stages tab uses "—" where the grid uses ""),
`feed-silo-dashboard.tsx` (75-76, and most `kg()`/`day()` null-renders through the table),
`feed-stock-count-panel.tsx` (the `kg()` helper and raw-ID cells once Task "Physical Count" below
fixes those), `feed-requisition-document.tsx` (several `??  "—"` fallbacks).
**API or web:** web-only — this is a rendering-convention fix, not a data fix.
**Effort:** S — mechanical, but touches every feed file, so the PR will be large even though each
change is trivial. Still S per-change; flagging the fan-out as the reason it reads bigger than it
is.
**Depends on:** do this **last** among the Feed Forecast/Dashboard/Physical Count work, so it
sweeps up the final column set rather than being redone after Tasks 23-25/Physical Count land new
columns with their own "—" fallbacks.
**Risk:** low, but a global find of `"—"` will also touch cells where a dash is the *correct*
empty-state (e.g., "no next diet" is genuinely blank) — needs a human pass, not a blind replace.

### Task 27 — Feed Requisition tab: rename "Internal Feed Transfer" → "Feed Requisition"
**Closes:** gap #6 — Req sheet r1/r3; decisions 4 Oct.
**Page:** Inventory → Feed Forecast → Feed Requisition tab.
**Files:** `apps/web/src/utils/translations.ts:1872` (`fftTabFeedRequisition`),
`apps/web/src/components/console/inventory/feed-forecast-tabs.tsx:34` (the only other reference).
**API or web:** web-only, `en` dictionary only.
**Effort:** S — confirmed `fftTabFeedRequisition` and the literal string "Internal Feed Transfer"
appear nowhere else in `apps/web/src` (no test hardcodes it), so this is a one-line value change
with no fallout.
**Depends on:** none — safe to do any time, including before Task 18/19 land.
**Risk:** none found.

### Task 28 — Physical Count: resolve raw IDs in count detail lines
**Closes:** gap #3 — Engine r8, r11; SB r44.
**Page:** Inventory → Feed Forecast → Physical Count tab.
**Files:** `apps/web/src/components/console/inventory/feed-stock-count-panel.tsx` (`CountLine`
interface ~line 50-58, render 459-469); API
`apps/api/src/modules/inventory/feed-stock-count/feed-stock-count.service.ts` (count detail /
list query) and `.controller.ts`.
**API or web:** **API work required.** Confirmed `CountLine` on the web side only carries
`silo_id`, `item_id`, `reason_id` — no code/name/text fields at all — and the panel prints them
raw (`panel.tsx:461,462,467`). The sibling "entry" view (`pairs`, same file, ~376-391) already
resolves `siloCode`/`itemCode` from a different endpoint (`/feed-stock-count/evidence`), so the
join pattern exists in the codebase — it just isn't applied to the detail-line query.
**Effort:** S — one join (silo, item, reason) added to one existing query, one render change.
**Depends on:** none of the four excluded tasks touch this file.
**Risk:** low. Do this **together with** Task 29 below (same file, same kind of enrichment) —
see "cheaper done together."

### Task 29 — Physical Count: add missing entry columns, fix one label
**Closes:** gap #12 — Engine r9-r17; SB r8.
**Page:** Inventory → Feed Forecast → Physical Count tab.
**Files:** same two as Task 28, plus `feed-silo-status.ts` (`buildSiloStatus`) as a reuse source.
**API or web:** **API work required**, and this is the one I'd flag as larger than its stated M —
see below. Silo Name, House(s) and Capacity are plain joins off `location_master`
(low risk, genuinely small). But **Projected Shortfall** and **Next Diet Change in X Days** are
not new calculations — they are the same numbers `buildSiloStatus` already computes for the
Dashboard (`projectedShortfallKg`, `change?.changeDate`, `feed-silo-status.ts:63,76-78`). The
cheap-looking path is to reimplement a 7-day-need-minus-count and a diet-change lookup directly
inside `feed-stock-count.service.ts`; the correct path is to have both read the same
`buildSiloStatus` (or a shared helper under it) so the Dashboard and Physical Count never drift
into reporting two different shortfall numbers for the same silo. Label fix: "System (kg)" →
"System Balance KG" is a one-line rename.
**Effort:** M as scoped, but **flag: this is L if it reimplements the shortfall/diet-change
logic instead of sharing it with `feed-silo-status.ts`.** The audit sized the fields; it did not
size "don't duplicate buildSiloStatus."
**Depends on:** do after Task 28 (same file, same PR is reasonable).
**Risk:** the shared-calculation risk above is the main one. Secondary: `buildSiloStatus` expects
a farm-wide `ForecastResult`, and Physical Count operates per-count-event — check whether the
inputs it needs (sources, dietChanges) are cheaply available at the point a count is being
entered, or whether this forces an extra forecast computation on every count-entry screen load.

### Task 30 — Feed Requisition document: header order/labels, Destination Silo column, Priority editable
**Closes:** gaps #13, #14, #15 — Req r26-35, r43/r45/r55, r34.
**Page:** Inventory → Feed Forecast → Feed Requisition tab; Approvals → Requisitions (same
component); inbox (read-only, inherits automatically).
**Files:** `apps/web/src/components/console/inventory/feed-requisition-document.tsx` (header
285-324, `LINE_COLUMNS` 201-204, line render 333-421).
**API or web:** mostly **web-only** for order/labels (reordering `ReadField`s, splitting the
folded "Farm Total ... of 30,000 KG target" string into two fields using data the component
already has — `header.truck_target_kg` is already read at line 271). The **Destination Silo as
its own column** (gap #14) needs a decision, not just a column: right now the single cell at
lines 353-361 is *already* the destination picker (`onLineEdit?.(line.line_id, { destinationId
})`) — the workbook's r43 "Silo Code" and r55 "Destination Silo" may genuinely be the same value
in this design (source silo = destination silo for a requisition), in which case this is a
one-line label clarification, not a new column. Confirm which before building — see risk.
**Priority editable** (gap #15) needs the `ReadField` at line 295-296 to become an editable
control gated on role (workbook says "Farm Manager can escalate") — check whether a
Farm-Manager-specific edit permission already exists anywhere in this document's `editable`/
`canEdit` plumbing, or whether this is new RBAC wiring.
**Effort:** M — three related fixes, one file, but the Priority permission-gating could be its
own small surprise if no "Farm Manager can edit this field, nobody else" pattern exists yet.
**Depends on — hard dependency:** **Task 18.** Task 18's brief explicitly reuses
`FeedRequisitionDocument` inside its new create/edit dialog. Editing header order, line columns
and field permissions in this file while Task 18 is mid-flight on the same file is a near-certain
merge conflict. **Sequence this after Task 18 lands.**
**Risk:** the Destination Silo question above; the merge-timing risk with Task 18; and this
component is shared by the hub entry point and the read-only inbox view, so a column/order change
here is seen in three places at once (which is good — no separate inbox fix needed — but means a
mistake here is seen in three places too).

### Task 31 — Manual create dialog + list: workbook labels — hold for reassessment after Task 18
**Closes:** gap #16 — Req r43-r56 (dialog fields); list column labels have no direct workbook row.
**Page:** Inventory → Feed Forecast → Feed Requisition tab (New dialog); requisitions list.
**Files:** `apps/web/src/components/console/inventory/requisition-new-dialog.tsx` (labels
`rqNewDestination`/`rqNewItem`/`rqNewKg`/`rqNewDate`, 191-208), `requisitions-panel.tsx` (list
columns, line 65 area).
**API or web:** web-only, `en` dictionary only.
**Effort:** S as a pure label change — **but I am not recommending building it now.** Task 18's
brief says New opens "ONE large dialog holding the document's header fields and its lines
sub-form (reuse ... FeedRequisitionDocument editable)". The `RequisitionNewDialog`'s own
hand-rolled line-entry UI (the `Draft`-based grid at lines 184-225, with exactly the mislabeled
fields this gap flags) is the part of this file Task 18 is most likely to delete outright, in
favour of rendering an empty `FeedRequisitionDocument` in edit mode inside the dialog. If that
happens, this gap is resolved as a side effect of Task 18 plus Task 30 above, with no standalone
work needed — building it first would be thrown away.
**Depends on:** Task 18 landing, then **re-audit this file** before deciding whether any work
remains. The list-column labels ("Requisition", "Required by", "Submit by", "Requested (kg)")
have no workbook row behind them at all — the audit's own mismatch note cites Req r43-r56, which
are document field names, not list headers. I'd confirm with Rishi whether the list even needs to
match before touching it.
**Risk:** building this before Task 18 is wasted work; this is the clearest "wait and see" item
on the list.

### Task 32 — Location Master (silo): show the derived read-only fields on the record
**Closes:** gap #21 — MS r13-r20.
**Page:** Master Data → Locations (type SILO).
**Files:** `apps/web/src/modules/master-data/configs.ts` (`location` config, 43-202, and
`MasterRecordView.tsx` rendering), reading from the same sources the Dashboard already reads
(`feed-silo-status.ts` / `SiloFact`) for Last Approved Count, System Balance, Days to First
Shortage, Feed in Silo, Available Stock, Last Feed Receipt, Next Diet Change.
**API or web:** **API work required** to expose these on the location record response (or a
sibling endpoint) — they currently live only in the Dashboard's per-request computation, not on
the location itself. The audit's own note (end of its §6a) already flags the open question:
"Either add a read-only 'Feed status' block to the silo record view or accept the dashboard as
their home (Rishi to say)." I'd raise that question rather than build blind — if Rishi says "the
Dashboard is the home for these, the Location record doesn't need them," this task shrinks to
nothing.
**Effort:** M, contingent on that answer. If built: reuse `buildSiloStatus`'s existing
per-silo computation rather than adding a third place that computes System Balance / Days
Remaining (first was the Dashboard, a second risk already flagged in Task 29).
**Depends on:** a Rishi decision first; otherwise independent of the four excluded tasks.
**Risk:** the same shared-calculation risk as Task 29 — three places (Dashboard, Physical Count,
Location record) computing the same silo numbers is a real drift risk if each is implemented
separately.

### Task 33 — Item Master: workbook labels on the editable form
**Closes:** gap #23 — MS r24-r27.
**Page:** Master Data → Items (type FEED, but the config is shared by every item type).
**Files:** `apps/web/src/modules/master-data/configs.ts` (`item` config, 916-1095 — specifically
the `fields` array's `item_code`/`item_name`/`uom_primary` labels at 962-964, 992, and the
`columns` array at 948-956).
**API or web:** web-only, label strings only.
**Effort:** S. Confirmed this config already carries a separate `bcFields` array (920-932) with
the *correct* workbook labels ("Item No.", "Description", "Base Unit of Measure") shown read-only
in a "Business Central" section of the record view (`MasterRecordView.tsx:105-112) — so the
workbook's wording already exists in the file, just in the wrong section. This is a rename of the
editable form's three labels plus two list-column labels, not new UI.
**Depends on:** none.
**Risk:** `item` is BC-owned (`owner: "BC"`, line 918) — confirm the editable `fields` section is
still shown/used for anything real in this tenant's flow before spending time on it; if items are
fully BC-synced and this form is rarely if ever opened, this drops in priority (worth asking
Rishi, not blocking).

### Task 34 — Breed Lifecycle Stage Config: workbook labels and field order
**Closes:** gap #19 — MS r32-r39.
**Page:** Master Data → Breeds → Lifecycle Stages tab.
**Files:** `apps/web/src/modules/master-data/configs.ts` (`breedLifecycleStage` config,
1172-1330ish — `breed_id`→"Line Code", `stage_id`→already "Stage" (matches, just confirm),
`calc_unit`→"Period Unit" should read "Calculation Unit", `feed_item_id`→"Feed" should read
"Feed Item No.", `feed_qty_per_head_per_day_kg`→"Daily Feed per Head (kg)" should read "Feed Rate
KG per Day/Per Animal", `feed_form`→"Feed Form" should read workbook wording, and reordering
fields/columns to Line, Stage, Unit, From, To, Bulk/Bagged, Item, Rate).
**API or web:** web-only, label and field-order changes.
**Effort:** S.
**Depends on:** do this **before** Task 35 below, so the new effective-date/farm-override fields
land in the already-corrected order rather than needing a second reshuffle.
**Risk:** low — pure config changes, no schema or engine touch.

### Task 35 — Breed Lifecycle Stage Config: effective dates and farm override
**Closes:** gap #18 — MS r38 E, r39 E; Engine r24.
**Page:** Master Data → Breeds → Lifecycle Stages tab.
**Files:** `apps/api/src/core/database/schema.ts` (`breedLifecycleStages`, 2264-2330 — new
columns + migration), `apps/api/src/modules/inventory/feed-forecast/feed-forecast.service.ts`
(the lifecycle-row query around 1830-1865, which currently has no date filter and no farm
override — only a `company_id` nullable-fallback pattern to model the farm override on),
`apps/web/src/modules/master-data/configs.ts` (two new fields on the form).
**API or web:** **substantial API work**, confirmed by reading the schema and the query:
`breed_lifecycle_stages` has no `farm_id`, no effective-from/to columns today, and the existing
query only resolves `company_id` nulls (the pattern a farm override would copy), with no notion
of calendar time at all — `period_from`/`period_to` are *age-based* periods (days/weeks/months
from a stage start), a completely different axis from "this feed item is effective from this
calendar date." Engine 4 spec files already pin down diet-change-date behaviour
(`feed-forecast.engine.spec.ts`, `.daily.spec.ts`, `.walk.spec.ts`, `.sources.spec.ts`) and would
need new cases for a row effective-dated mid-flight.
**Effort:** **flag — larger than the audit's own L.** The audit sized "add effective from/to and
optional farm on the row; engine to honour them" as one L item. Having read the resolution logic,
I'd split it:
  - *(a) Farm override alone* — copy the existing `company_id`-nullable-fallback pattern
    (`isNull(...) OR eq(..., companyId)`) for a new nullable `farm_id`. This is genuinely L-sized,
    bounded, and low-risk because the pattern already exists in the same query.
  - *(b) Calendar effective-dating of the feed item within a stage* — a second temporal axis
    overlaid on the existing age-based period, which changes "which row applies" from a pure
    lookup into a two-dimensional resolution (age bracket AND calendar date), and that
    resolution sits directly upstream of every diet-change date the engine, dashboard,
    requisition and physical-count screens all show. This is the piece that is bigger than
    stated — realistically closer to the size of (a) again, not a rounding error on top of it.
  I'd recommend doing (a) alone first and asking Rishi whether (b) is actually needed for piggery
  MVP before committing to it — the workbook row (r38 "effective dated") doesn't by itself say how
  often a feed item's effective date actually changes mid-lifecycle in practice for this client.
**Depends on:** Task 34 (field order), loosely; otherwise independent.
**Risk:** the four engine spec files above; any downstream screen that displays a diet-change
date (Dashboard, Feed Forecast grid, Requisition breakdown) is a consumer of this resolution and
needs re-verification, not just the lifecycle config form.

### Task 36 — Alert Rules Master: auto-numbered code, Role Master pickers
**Closes:** gap #20 — MS r43, r44, r50, r54.
**Page:** Master Data → Alert Rules.
**Files:** `apps/api/src/modules/system/alert-rule/alert-rule.service.ts` (create path),
`alert-rule.dto.ts` (relax `notification_code` from required); `apps/web/src/modules/master-data/configs.ts`
(`alertRule` config, 1433-1497 — `notification_code` field 1446, `recipient_roles` 1472,
`escalation_role` 1489).
**API or web:** **small API work for the auto-code; web-only for the role pickers.**
`resolveOptionalCode()` (the number-series helper already used by `breed.service.ts`,
`uom.service.ts`, `gl-mapping.service.ts`) is not yet called from `alert-rule.service.ts` — this
needs that call wired in, plus the DTO/field relaxed from required. For the role pickers:
confirmed `GET /role/company/:companyId` already exists
(`apps/api/src/modules/core/role/role.controller.ts:61`) and `alert-rule`'s config already carries
`company_id` as a hidden field (1445) to `dependsOn` — so `recipient_roles` (currently
`type: "string-list"`, free text) and `escalation_role` (currently plain `text`) can become
`select-entity` (multiple for recipients) against that existing endpoint with no new API route.
Also fix label order (Value before Reference, matching workbook) and the
`notification_code`/`notification_name` labels.
**Effort:** M.
**Depends on:** none of the four excluded tasks touch this page.
**Risk:** check whether a number series master row for "alert-rule" exists yet — if not, this
task includes creating one, which is a small addition but should be called out rather than
discovered mid-build.

---

## Recommended order

1. **No-dependency, no-conflict small items first** (can run in parallel, different engineers
   even): Task 27 (tab rename), Task 33 (Item labels), Task 34 (Breed Lifecycle labels/order),
   Task 25 (run history fields), Task 36 (Alert Rules).
2. **Physical Count pair together**: Task 28 then Task 29 (same file, same enrichment pattern;
   confirm the shared-calculation approach with whoever owns `feed-silo-status.ts` before writing
   Task 29's shortfall/diet-change fields).
3. **Feed Forecast forecast-tab trio**: Task 23 (filters), Task 24 (output columns) — coordinate
   Task 24 with Task 20 since both touch `ReportRow` — then Task 26 (dashes) last, after every
   other column addition on this tab has landed, so the dash sweep is final, not redone.
4. **Hold Task 30 and Task 31 until Task 18 ships.** Do not start either earlier — Task 30 edits
   the exact file Task 18 is restructuring; Task 31 may turn out to need no work at all once
   Task 18 lands. Re-audit `requisition-new-dialog.tsx` after Task 18 before deciding Task 31's
   scope.
5. **Task 32 (Location derived fields)** — raise the "Dashboard vs Location record" question with
   Rishi before scoping; do in parallel with the above since it touches neither requisition files
   nor the forecast tab.
6. **Task 35 (Breed Lifecycle effective dates) last.** It's the largest, it benefits from Task 34
   already having cleaned up the form, and its scope (farm override vs calendar effective-dating)
   should be narrowed with Rishi before estimating a date.
7. **Gap #17's remainder (silo link + Days Remaining colouring)** rides inside Task 21 — raise it
   with whoever picks up Task 21, don't schedule separately.

## Total effort estimate

14 tasks: 7 S, 6 M, 1 L (Task 35, flagged as possibly needing to be split and may run longer than
a single L once the calendar-effective-dating half is scoped). Rough order of magnitude at
S ≈ 0.5 day, M ≈ 1.5 days, L ≈ 4 days: **~17-20 engineer-days (roughly 3.5-4 weeks for one
person)**, with Task 35 the main source of variance — a decision to defer its calendar-dating
half to a later phase would bring the total down by several days; building it in full could push
the total past 20 days.

---

## Not worth doing as scoped / query Rishi first

- **Gap #22** (silo code format, mapping effective dates) — do not build; ask Rishi. Already
  covered above.
- **Task 32** (Location derived fields) — the audit itself frames this as an open question
  ("Rishi to say") rather than a settled requirement. Ask before building.
- **Task 35, part (b)** (calendar effective-dating of the feed item within a lifecycle stage) —
  ask whether this is actually operationally needed before committing the engine-touching half of
  the work; part (a), the farm override, is cheap and uncontroversial on its own.
- **Task 31's list-column labels** — no workbook row supports a specific list-header wording;
  confirm with Rishi whether the list needs to match the document's field names at all before
  touching it.

## Larger than the audit's own S/M/L

- **Task 35** (gap #18) — audit says L; I'd call it two L-sized pieces, not one, once the
  age-based-period vs calendar-effective-date distinction is accounted for. See Task 35 above.
- **Task 29** (gap #12) — audit says M; it's M only if Projected Shortfall and Next Diet Change
  reuse `buildSiloStatus` rather than reimplementing the calculation a second time. Flagged as
  the kind of consequence the audit's per-field sizing wouldn't have caught.
- **Task 32** (gap #21) — same shared-calculation risk as Task 29, a third implementation of the
  same silo numbers if not architected to share.

## Cheaper done together (even across pages)

- **Task 31 and Task 18** — not really two separate pieces of work. Once Task 18 reuses
  `FeedRequisitionDocument` for manual create, the mislabeled hand-rolled line UI that Task 31
  targets is likely deleted outright. Re-audit before scoping Task 31 at all.
- **Task 28 and Task 29** — same file, same class of fix (resolve an ID to a display value via a
  join). Proposed as two tasks for reviewability, but there's no reason not to land them in one
  PR if the same person does both back to back.
- **Task 24 and Task 20** — both add fields to `ReportRow`/the forecast API response in the same
  sitting; sequencing them together (rather than two separate round trips through the same
  interface) avoids a needless second review of the same file.
- **Task 27 and Task 30** — both are "terminology" fixes on the same tab (one trivial, one
  waiting on Task 18); no technical reason to pair them, but a reviewer doing a terminology sweep
  of the Feed Requisition tab could reasonably take both in one sitting once Task 18 has landed.
