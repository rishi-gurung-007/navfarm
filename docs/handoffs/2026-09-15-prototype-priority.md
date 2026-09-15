# NAVFarm prototype-priority handoff — 15 September 2026

This handoff continues `2026-09-15-2000-internal-review.md`. It records the
work done after Claude reached its limit and deliberately separates compiled
prototype changes from features that have not yet been live-proven.

## Repository state

- Workspace: `/Users/nero/Desktop/navfarm`
- Branch: `neroen`; do not merge `origin/main` or `origin/arun_new` wholesale.
- Current HEAD before these uncommitted changes: `6e6f3fc`.
- `origin/main` and `origin/arun_new` contain an older Batch animal-selection
  implementation at `6af0ff5`, but it uses the obsolete `BATCH_WISE` /
  `ANIMAL_WISE` model. Port its UI selectively to the current `REGISTERED` /
  `COUNT_ONLY` rules; do not cherry-pick it blindly.
- The worktree was already dirty with Claude's Breed, UOM, Goods Receipt,
  workspace-scope and rebuild-demo work. Preserve it. This continuation also
  touched Location, Stage, Animal, Batch Transfer, shared Master UI and
  `docs/decisions.md`.

## Implemented in this continuation

1. Location Master no longer exposes `Feed in Bags`. Farm address appears and
   is required only for `FARM`; new child locations store no repeated address.
   The API also ignores the removed feed flag and enforces the Farm rule.
2. Animal registration exposes `Current Pen` and loads only `PEN` locations.
   The API refuses direct non-Pen placement. Batch Transfer now validates its
   resolved destination as an active Pen before draft/post can repoint Animals.
3. Stage Transition Trigger exposes and accepts only `AUTO_BY_DAY` and
   `MANUAL`. Existing `EVENT_BASED` rows were not mutated silently.
4. The shared master hint is exactly `Dropdown options`.
5. The existing Animal Register right drawer remains the interaction. Its
   Breeding tab is gender-aware: males show sire services/resulting litters;
   females show services/farrowing/weaning. A male's litter outcomes are joined
   through his breeding records.
6. Traceability is a newest-first expandable lifetime timeline containing birth,
   herd entry, mating, farrowing/weaning, audited stage changes, posted Batch/Pen
   transfers and disposal. Referenced Stage/Batch/Pen IDs are resolved to labels.
7. Rishi's decisions and prototype order are recorded in `docs/decisions.md`.
8. Claude's Goods Receipt test mock received an explicit type, removing the API
   typecheck blocker without changing its behavior.

## Verification performed

- `git diff --check`: passed.
- `pnpm nx typecheck web`: passed.
- `pnpm nx typecheck api`: passed after the Goods Receipt mock typing fix.
- Live Brave inspection showed `Dropdown options`; Location Add initially had
  neither address nor `Feed in Bags`, matching conditional address behavior.
- MySQL readback: all 27 current Animals are at `PEN` locations.
- Narrow touched-service run: 131/153 tests passed. The 22 failures are mainly
  old mocks with no `location_type` or destination-Pen row, so the new invariant
  rejects before the test's former assertion point. Do not report the narrow
  suite green until fixtures are updated. Several Batch Transfer post fixtures
  also predate current service queries.

## Legacy rows deliberately not rewritten

The current database has repeated addresses on child Location rows and legacy
feed flags (102 Pens and 57 Sheds). The UI no longer exposes either field and
new writes are correct, but cleaning existing rows is a data-changing operation.
If required, add a standard read-only / `--verify` rollback / `--apply` script;
never run an ad-hoc update. There are also 22 legacy `EVENT_BASED` Stage rows and
8 `MANUAL` rows. Rishi asked for two selectable triggers, not an invented mapping
of existing event rules, so alignment remains explicit work.

## Shared master selectors and Animal history — verified 15 Sep afternoon

Commits `4038fee..d703af2` on `neroen`. Every claim below was made by driving the running app
(web `:3002`, API `:2877`, Tenant Administrator session) and reading MySQL. Nothing was written.

One consistent searchable selector now serves every single-value field in the config-driven Master
forms, with contextual creation, and the Animal Breeding tab is one timeline instead of two card lists.

### What driving it proved

- `Add Location` opens the standard shared dialog frame. The old form-bottom
  `Add one without leaving this form` cards are gone; the page-level `Dropdown options` row remains.
- Location Type shows search first, custom-rendered options, and `New` / `View All`. `View All` opens
  the full picker with `Create New Location Type`; that opens the standard Location Type form, and
  cancelling returns to the parent Location form with its values intact.
- Stage `Next Stage` is a self-reference, so it correctly offers neither action.
- The selector panel escapes the dialog's scrolling body and renders above it. At a short viewport it
  flips above the trigger rather than running off-screen.
- Options read as aligned columns — `CAGE | Cage`. Breed reads `TN-70-Sow | KINTYRE ESTATE, NORTON`.
- Static enum fields (Storage Location, Animal Type, Gender) use the same dropdown, without creation
  actions — an enum has no master behind it.
- Animal Breeding tab, against real rows: a sow reads `Served by PIG-2026-0009 / 2026-07-05 /
  AI - parity 2 - confirmed`, and every expanded value matches `breeding_record` exactly, with the NULL
  `second_mating_date` correctly producing no row. A boar reads `Served PIG-2026-0006` newest-first,
  showing Sow / Service outcome / Sow parity and correctly omitting the sow's pregnancy check.
  A farrowing reads `Farrowed 13 live / 14 born - normal`, matching `farrowing_record`.
- `SELECT lm.location_type, COUNT(*) ... GROUP BY lm.location_type` still returns `PEN 27` only.
- `pnpm nx typecheck web`, `pnpm nx typecheck api`, and the full `pnpm nx test web`
  (30 suites, 178 tests) all pass.

### Two defects this found that the tests did not

1. A create-only master opened from another form's field skipped list *loading* but still rendered the
   whole page surface — toolbar, `Dropdown options` chips, table, pager, filter aside — inside the form
   the user was filling in. Its spec passed because it only asserted the dialog appeared and that no
   fetch ran. Fixed in `ebad53d`, with the missing assertion added first.
2. Replacing the native `<select>` removed its blank option, which is how an optional field was emptied
   after a wrong pick. This affected every optional single-value field, not just the new static enums.
   Fixed in `d703af2` with a `Clear` action shown only when the field is optional and holds a value.

### Not verified

- The male `Sired a litter` title: no farrowing record in the current data is reached through a boar.
- The exact `No breeding record.` empty state: every Animal carrying a Breeding tab has a record.
- `ResizeObserver`-driven repositioning of a floating panel: jsdom does not implement it, and the
  browser pass did not resize a panel mid-open.

No breeding history was invented to close these. They need either real data or a deliberate fixture.

## Next work, in Rishi's priority order

1. Finish the wider requested Master review using the config-driven shared
   table; update the 22 affected-service mocks only where they block live proof.
2. Port/adapt Batch animal selection from `6af0ff5` into current Batch creation:
   `REGISTERED` accepts explicit existing Animals; `COUNT_ONLY` records quantity
   and must never manufacture Animal rows. Preserve Farm/Breed/Pen validation.
3. Make Schedulers operational with only `AUTO_BY_DAY` and `MANUAL`, then prove
   one scheduled action through the running app and MySQL.
4. Complete Daily Data Entry selection/posting/correction and verify inventory
   and ledger effects in MySQL.
5. Review existing Purchase Receipt, Inventory Journal and persisted Approval
   request flow; make only required prototype corrections.
6. Deepen Animal traceability if health treatments, mortality, cost ledger and
   parent/offspring links are not already represented by the returned records.
7. Build the Resource Ledger from Resource activity entries. Add Feed Forecast
   first to the Feed Activity card; dashboard reuse can follow after placement
   is confirmed.

Do not claim the full MVP complete. The requested master corrections render in
the live web app and the Animal drawer changes compile, but the revised drawer
still needs an authenticated live endpoint walkthrough. Batch selection,
Schedulers, Daily Entry, Resource Ledger and the end-to-end write proofs remain.
