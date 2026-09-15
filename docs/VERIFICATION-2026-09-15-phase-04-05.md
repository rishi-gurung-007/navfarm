# Verification — Phases 4 and 5, 15 September 2026

Phase 4 (quick fixes) and Phase 5 (farm context in the web) were implemented by
the 15 September lanes A, B and C. This records what was proved and how, and
names what is still unproved. Tests are a gate, not proof: every claim below
was made against the running API on port 2877 and read back from MySQL, except
where the row says otherwise.

Company: Triple C (`tenant_devco`), actor `company.admin@triplec.local`.
API bundle rebuilt from the commit under test and restarted by exact PID.

## Phase 4 — quick fixes

| # | Item | Result | Evidence |
|---|---|---|---|
| 1 | Scheduler header + lines in one transaction | Not live-probed | Unit tests only; rollback proven by mocks. Live probe owed |
| 2 | `DELETE /scheduler-header/:id` for unused schedulers | **Verified** | Deleted a scheduler with no entries: header and all 4 lines gone (both counts 0). Deleted one that has a recorded entry: 409 `This scheduler has recorded entries and cannot be deleted.`, header and its 3 lines intact |
| 3 | `MONTHLY` and `CUSTOM` due-date rules | Not live-probed | Unit tests only, incl. the 31st in a 30-day month |
| 4 | Create a scheduler through the UI | **Verified** | Create Scheduler modal at 1440px, batch PIG-BAT-2026-0003, stage Quarantine, count 2 → MySQL row `e3cba572` DRAFT with 4 auto-generated lines, notes carried. Deleted again afterwards. The stage list renders "Gestation (116 days)", so item 11 is visible on screen |
| 5 | "Forgot password" reworded; MFA hidden | Not live-probed | Component test asserts no network call |
| 6 | Sort and filter on UOM Conversions | **Verified** | `sort=conversion_code&dir=asc` → CONV-001..005; `dir=desc` → CONV-007..003; `total` 7 both ways |
| 6 | Sort and filter on Breed Lifecycle Stages | **Verified** | `sort=lifecycle_code` asc → DUROC-BOAR_AI-001 first, desc → YORKSHIRE-WEANING-001 first; `search=Farrow` → 4 with matching total; `search=Yorkshire` → 9 |
| 6 | Column filters narrow | **Verified** | `filter[from_uom]=KG` → 1 row, CONV-003 KG→GRAM |
| 6 | Master search no longer 400s | **Verified** | `?search=BAG` → HTTP 200, 1 row (was HTTP 400 under `forbidNonWhitelisted`) |
| 7 | Indian placeholders removed | Partially verified | Seed sources and web configs cleaned; the seeds have not been re-run, so MySQL still holds the old demo values until Phase 3 |
| 8 | Goods receipt: inactive warehouse refused on create | **Verified** | POST with the inactive silo → 400 `The selected warehouse is inactive.`; active warehouse, same payload → 201 GR-000007 |
| 8 | …on update | **Verified** | PUT pointing a draft at the inactive silo → 400, same message |
| 8 | …on post, after the warehouse was retired | **Verified** | Warehouse deactivated after drafting → POST `/post` → 400, same message. The warehouse was restored (`is_active=1` confirmed) |
| 8 | Draft editable from the panel | Not live-probed | Component test: Edit appears on DRAFT only and saves via `PUT /goods-receipt/:id` |
| 9 | Ledger reversal in the same time base | Not live-probed | Unit test asserts the insert carries no `created_at`, so the column default applies |
| 10 | Inventory journal: positive adjustment posted | **Verified** | ADJ-000003, 5 KG @ 12.50. `inventory_ledger`: POSITIVE / VARIANCE_POSITIVE, qty 5.0000, amount 62.5000, remaining 5.0000. `journal_header` JE-000022 POSTED, total debit = total credit = 62.5000. Legs: 1010 Raw Material Inventory Dr 62.50, 4030 Inventory Adjustment Gain Cr 62.50 |
| 11 | Gestation 114 → 116 | Code verified, not live-probed | `breeding.service.ts` defaults to 116 and prefers the breed's `gestation_days`; the web strings now say so |
| 12 | GILT → SOW on first farrowing | Not live-probed | Unit test only |

## Phase 5 — farm context in the web

Every item is implemented and unit-tested; **none has had its browser pass**,
which is what this phase's gate actually requires.

The browser pass has now been done, at 1440px, 834px and 390px, as a tenant admin.
It found three defects that no unit test could have caught. **The API is correct in
all three cases** — every one is in the web layer.

| # | Item | Result |
|---|---|---|
| 1 | `api-client` sends `x-active-farm-id` for admins, never for a standard user | Component test only |
| 2 | Switcher: fixed farm label for a standard user, picker + "All farms" for admins | **Renders**, but see F1-F3 below |
| 3 | Data entry shows "Recording for: &lt;farm&gt;" | **Verified** — "Recording for: MUL100 — GRASMERE FARM NORTON" renders on `/batches/entry` at all three widths and wraps legibly at 390px |
| 4 | Entry always has an explicit farm | Enforced by the Phase 1 farm scope, proved there |

### Defects the browser pass found

**F1 — the farm picker offers a farm that cannot be selected.** The Farms list
includes `FARM-001` "Triple C Farm", whose `location_master.is_active` is 0.
Phase 1 requires `x-active-farm-id` to name an *active* top-level location, and
the API enforces it: `GET /batch` with that farm answers
`403 Not authorized for this farm.` The control with active `MUL100` answers 200
with one batch. So the picker offers a choice that is guaranteed to fail.

**F2 — the resulting 403 is swallowed.** After picking that farm the dashboard
renders 0 Active Herd, 0 Batches In View, 0 WIP and "No batches recorded yet."
rather than surfacing the refusal. A user reads that as "my data is gone", not
"wrong farm" — the opposite of what this project means by a screen that does not
pretend.

**F3 — the active farm is never named.** After selecting a farm the collapsed
switcher still reads "AREA · PIGGERY / Piggery / Triple C Farm Operations". There
is no indication of which farm is in scope and no visible way back; "All farms" is
something the user has to know to look for.

A fourth, found by the wave review rather than the browser: switching company
leaves `active_farm_id` pointing at the previous company's farm, after which every
farm-scoped request 403s with nothing on screen explaining why.

## Suite and gate state at the time of writing

| Check | Result |
|---|---|
| `pnpm nx test api --runInBand --watchman=false` | 81 suites / 1031 tests passed |
| `pnpm nx test web --runInBand --watchman=false` | 28 suites / 165 tests passed |
| `pnpm nx run-many -t typecheck -p api web web-e2e` | passed (after fixing a type error that had been failing since the lane A commit) |
| `pnpm nx build api --configuration=development` | passed; known Express dynamic-dependency warning only |
| `pnpm nx lint web` | 80 errors against the frozen 88 baseline — no new errors |
| API `/health` | 200 |

## What is NOT verified

- Every row above still marked "Not live-probed".
- Seed placeholder cleanup in MySQL — the scripts are clean, the database is
  not, and will not be until the Phase 3 rebuild runs.
- A standard user's fixed-farm label in the switcher: the pass was run as a
  tenant admin, and the standard-user path has only its component test.

**Phase 4** is otherwise done: its last unproved item, the inventory journal, is
verified above, and items 2 and 4 were proved live during the browser pass.

**Phase 5 is not closed.** F1, F2 and F3 are open defects in the work this phase
delivered, and the phase cannot be called done while its own switcher offers a
farm that 403s and hides the refusal when it happens.

## Demo rows this verification created

Both are labelled DEMO VERIFICATION and belong to Phase 3 to replace:

- `GR-000007` — goods receipt, created as the active-warehouse control, then
  cancelled. Wrote no inventory ledger rows.
- `ADJ-000003` / `JE-000022` — the positive adjustment above, left posted
  because it is the evidence.
