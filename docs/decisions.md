# NAVFarm — decisions record

**Rishi is the source of truth for this application.** This file is the record
of what he has decided: what he asked for, what was decided, and why. The BBP,
the TDD tracker, the master templates and the MOMs are *reference* — evidence of
what the client has said — and every one of them is incomplete, unsigned, or
contradicts another.

**Read this before planning. Add to it when a decision is made.** A decision
that only exists in a chat log gets re-asked, or quietly reversed, by whoever
works next.

Each entry: what was asked, what was decided, and the reasoning — because the
reasoning is what tells a later reader whether a new situation is covered.

---

## Standing rules

These apply to all work and are not up for re-litigation.

| Rule | Why |
|---|---|
| **Piggery only.** NOB Livestock → LOB Piggery. Sixteen LOBs exist as taxonomy; nothing else is in scope. | Other domains come after piggery is complete. Keep shared scaffolding generic so adding one later stays additive. |
| **Do not assume anything that is not clear. Ask.** | Rishi has said this repeatedly. He is explicit that he relies on the agent for piggery domain knowledge, so a confident guess is worse than a question. |
| **Never invent client data.** No placeholder companies, no example identifiers, no "typical" values presented as the client's. | Indian demo placeholders (`greenvalleyfarms.in`, `GSTIN12345`, `+91…`, `Asia/Kolkata`) shipped on a Zimbabwe piggery's screens. |
| **Review anything Arun's tooling landed.** | "he was creating a lot of difficulties… we would review anything that he adds to our branch". Also: "arun used gemini free antigravity so we have to work properly so that people do not compare us with cheap things". |
| **The eight non-English translations are deferred to the end.** English only for now; new keys fall back to English per key. | 2026-09-06. Content will be settled in English first, then translated once. |
| **Leave the dev servers running.** Close them only when memory is actually red — check `top -l 1 -n 0 \| grep PhysMem` and `sysctl vm.swapusage`. | 2026-09-07. Rishi browses the app in Brave while work happens; stopping the server pulls the page out from under him. The 8 GB machine still swaps hard, so check rather than guess. |
| **Never run `pkill`.** Kill a PID confirmed with `lsof -ti :PORT`. | A `pkill` killed an entire working session. |

---

## Master data

### Every master carries a code, from a number series
*Asked 2026-09-06 ("add code for them too"), extended 2026-09-07.*

Each master has one series. When every master has one, the "add number series"
button is hidden — there is nothing left to create. Auto-generated codes are not
editable in the form.

Still open, and Rishi's to decide: manual entry currently ignores the series
format entirely (`manualCode` checks width and uniqueness only), and ANIMAL and
LOCATION are excluded from the series picker although the Animal template says
the animal code comes from a series. Rishi deferred this: *"we would work on the
number series later"*.

### The series describes the data, or the data follows the series — per master
*Decided 2026-09-09.*

The series and the master data had never agreed. Every series read
`current_seq = 0` and `last_generated_code = NULL`: not one code in the database
had come out of the mechanism that claims to issue them. Running the real
`formatSeriesCode` over the real rows showed why that had gone unnoticed — the
definitions described codes nothing carried. SPECIES said `SPC-001` over twelve
rows coded CHICKEN, PIG, GOAT; STAGE said `STG-001` over fifteen coded
GESTATION, FARROWING, QUARANTINE.

Rishi's call is per master, not one blanket rewrite:

- **SPECIES and STAGE became "named" series** — the code is the name, sequence 0
  — which reproduces the codes already in the database exactly. Stage codes are
  matched as string literals in twelve files, `location.service.ts` and
  `animal.service.ts` among them; `STG-004` would have broken all of it. Only
  `BEE` moved, to `HONEY_BEE`, being the one species code of twelve that was not
  already its own name.
- **GL_ACCOUNT and COST_CENTER are `is_active = 0`** — defined, so the master is
  not reported as lacking a series, but never generating. A GL account's number
  *is* the chart of accounts (1000s assets, 4000s revenue, 5000s expenses) and
  BBP-1 §1.6 puts that catalog in D365BC. `GL-001` discards the only information
  the number carries. `resolveSeriesFor` filters on `is_active`, so both fall to
  their existing `createManual` paths.
- **Location codes were regenerated** from the LOCATION series — `FARM-001`,
  `FARM-001/SHED-001`, `FARM-001/SHED-001/PEN-003`. Theirs was the one case
  where the hand-written code (`PEN-AI-B2`) carried nothing the series does not,
  and the series' "/" between levels and "-" before the number exists precisely
  to express that path.
- **UOM and LOCATION_TYPE were left alone.** KG, ML and SHED are the standard
  symbols; no rule derives them from "Kilogram", "Millilitre" or "Shed/House".
  `SYSTEM_NO_SERIES_SEED` already documents this as what `allow_manual` is for.

`current_seq = 0` is **correct** and was not "fixed". The masters that hold
codes — location, animal, item, breed lifecycle — all use segmented series,
which count within a stem via `nextSequenceInStem` and never consult
`current_seq`; every flat series' master is either empty or holds NULL codes.
There is no counter here that is behind.

`SYSTEM_NO_SERIES_SEED` now seeds this shape for new tenants;
`db-align-master-codes-to-series` brings an existing one into line.

### Code columns widened, and item categories conformed
*Decided 2026-09-10, unblocking the above.*

Conforming ITEM_CATEGORY yields `BIOLOGICAL_ASSETS-BREEDING_STOCK`, which the
ITEM series composes into a **57-character** item code against `item_code
varchar(50)` — `assertCodeFits` rejects it and item creation stops working for
the biological-asset categories. So the column moved instead.

Migration **0082** widens six columns to `varchar(255)`, the width five master
code columns (breed, cost centre, GL account, item category, location) have
carried all along:

| Column | Was | Why |
|---|---|---|
| `item_master.item_code` | 50 | The actual overflow — 57 chars. |
| `inventory_ledger.item_code` | 50 | Denormalised snapshot; has to move with the master or a long code truncates at posting. |
| `uom_master.uom_code` | 20 | Series now derives from `uom_name`, which is prose. |
| `item_type_master.type_code` | 30 | Same — derives from `type_name`. |
| `location_type_master.type_code` | 30 | Same. |
| `item_attribute_master.attribute_code` | 50 | Same — derives from `attribute_name`. |

Every one of these already sits inside a composite unique key; at
utf8mb4 a `(tenant_id, company_id, code)` key is 1092 bytes against InnoDB's
3072-byte limit, which the five columns already at 255 had proven.

The eight item categories are now conformed (`CAT-RAW-GRAINS` →
`RAW_GRAINS_CEREALS`). Nothing referenced a category by code —
`item_master.sub_category` is the only column that could and it is NULL on every
row; everything else joins on `category_id`.

**ITEM itself is still not conformed.** Existing item codes stay
`BIO-SWINE-BOAR`; only newly created items take a series code, now that one
fits. Regenerating the 27 existing ones cascades into batch, inventory and
goods-receipt fixtures and is its own piece of work.

**A bug this caught, worth remembering.** The first version of the category seed
passed the seed's own `{key, name}` shape to a series configured on
`category_name`. `formatSeriesStem` found no matching field, returned an empty
stem, and `formatSeriesCode` fell through to the bare sequence — every category
got the code `"1"`, and the second insert died on
`uq_item_category_master_scope_code`. Tests did not catch it; running the seed
did. `seed-series-code.ts` now throws when a named series composes an empty
stem, rather than inventing a code or quietly falling back to a hand-written one.

Noticed while doing this and **not** fixed: all 29 `gl_mapping_master` rows have
`mapping_code` NULL, although a GL_MAPPING series exists and
`gl-mapping.service` calls `resolveOptionalCode`. The seed inserts them without
codes.

### Every code column is varchar(255), and the seeds generate every code
*Decided 2026-09-10.*

**Why not TEXT.** The obvious answer to "make any series combination fit" is to
make the column TEXT. It breaks two things, both demonstrated rather than
assumed:

1. MySQL refuses a unique key on TEXT outright — *"BLOB/TEXT column used in key
   specification without a key length"* — and every master code column sits in
   a composite unique key. The workaround, a prefix length, makes uniqueness
   prefix-only: with `code(20)`,
   `LIVESTOCK-BIOLOGICAL_ASSETS-BREEDING_STOCK-ITM-0001` and
   `LIVESTOCK-BIOLOGICAL_ASSETS-GROWER_FINISHER-ITM-0001` collide as duplicates.
   Codes exist to be identities; that is the one guarantee they cannot lose.
2. `assertCodeFits` reads the declared varchar length off the Drizzle column to
   reject an over-long code at generation time (Option C, decided 2026-09-08).
   TEXT has no length, `codeColumnLength()` returns undefined, and the guard
   silently disables — so an absurd code gets written instead of refused.

"Any length" is unreachable anyway: InnoDB's key limit is 3072 bytes, so at
utf8mb4 a `(tenant_id, company_id, code)` key tops out near varchar(696);
varchar(700) is rejected. **255 is the answer** — 1092 bytes in that key, and
already proven by the five columns that carried it from the start.

Migration **0083** takes the remaining 18 columns to 255: every column
`MASTER_CODE_COLUMNS` names, plus the by-value mirrors that must move with them
(`no_series_master.last_generated_code`, `batch_header.current_stage_code`,
`batch_stage_log.from/to_stage_code`, `farm_record.stage_code`,
`scheduler_parameter_line.stage_code`).

**The seeds now generate every code through the series.** `lib/seed-series-code.ts`
composes with the same formatter the API uses and persists `current_seq` /
`last_generated_code`, so the app continues where the seed stopped — verified by
creating a supplier through the API after seeding four and getting `SUP-005`.
After a full `db-seed-demo --fresh`, 11 rows out of ~300 do not match their
series, and all 11 are the deliberately-manual ones: UOM (KG, ML — standard
symbols), two ITEM_TYPEs, one LOCATION_TYPE. GL_ACCOUNT and COST_CENTER stay
inactive.

Three bugs this surfaced, none of which the tests caught:

- **`inArray` was never imported** in `seed-demo-full-coverage.ts` and
  `seed-demo-gaps.ts`. Stage 4 of `db-seed-demo` had been dying at runtime; the
  typecheck had been reporting it as part of an accepted baseline.
- **The series were seeded after the masters that need them.** Starter items and
  breed-lifecycle rows came out `LVS-PIGLET` and `LANDRACE-WEANING` — their
  fallbacks — because no series existed yet. The series block now runs first.
- **`animal_register.dob` was never populated**, so the ANIMAL series' `dob:YEAR`
  segment resolved to nothing and would have composed `PIG-0001`, while the seed
  hand-wrote `PIG-2026-0001`. The seed sets a dob now, so the series produces
  that code itself. This does not settle the open question of `PIG-` vs `ANM-`.

**Still hand-written:** nothing in the master data. Note `item_master.sub_category`
is NULL throughout, so item codes are `<type>-<category>-ITM-<seq>`; the
three-segment form only appears once a sub-category is set.

**Unrelated, and flagged not fixed:** `seed-demo-gaps.ts` still carries Indian
placeholder data on a Zimbabwe piggery — Pune/Maharashtra addresses, `+91`
phone numbers, `27AABCU…` GSTINs. Same class as the bug AGENTS.md §3 already
records. Not corrected here because inventing replacement client data is exactly
what that rule forbids; Triple C has to supply real values.

### Tenant is the draft, the company is what is used
*Decided 2026-09-10.*

Every master carries `company_id`, `nob_id` and `lob_id`. No `area_id` — one LOB
is one operational area for now, and a wider scope is later work.

- **Tenant scope** holds the draft. **Company scope** holds the copy that is
  actually used, and **operational scope shows the same rows** as company scope.
- **NOB/LOB are selectable at tenant and company scope** (added to all 23 master
  configs, with `supportsNobLobFilter`), and **hidden and auto-filled at
  operational scope** from the active area. A mismatched value is rejected.

`copy-master-templates.ts` already implemented the draft→copy mechanism, and
`no_series_master` was already one of its 22 template tables. **Nothing ever
called it** except a one-time migration script, which is the whole reason a
number series resolved to nothing at company scope: the series is a master, the
company had no copy of it, and `resolveSeriesFor` correctly found none. It now
runs as stage 3 of `db-seed-demo`, before any company data is written.

Migrations 0084/0085 add the columns, plus `company_id` on
`breed_lifecycle_stages` — the one master that had none — with its unique key
rebuilt to the `(tenant_id, coalesce(company_id,''), code)` form the other 22
use. drizzle-kit escapes the `coalesce` expression into backticks and emits
invalid SQL, so 0085 is hand-written to match 0067–0069.

Four things this broke, each found by driving the app rather than by tests:

- **The auto-fill broke every create.** `enforceMasterRequest` writes
  `body.nob_id` before the ValidationPipe runs, and `forbidNonWhitelisted`
  rejected it because the DTOs did not declare the field. 12 DTOs updated.
- **The auto-fill was then silently dropped.** The guard fills `body`, but each
  service builds its own insert object; 11 services never copied it, so the first
  "successful" create stored NULL NOB/LOB. `reason.service` was fine — it
  spreads `...dto`.
- **Template copies were planned twice.** Giving `breed_lifecycle_stages` a
  `company_id` made it a first-class template while it was still in
  `loadCompanyTemplateCopies`'s explicit child list — which existed *because* it
  had none. Every row was planned twice and the second insert died on the scope
  key. Removed from the child list.
- **Item attributes were invisible at company scope.** They are seeded at stage 6,
  after adoption at stage 3, so a tenant-only row never got a copy. They are
  written per company now.

`seriesCodeFor` prefers the company's series over the draft
(`ORDER BY company_id IS NULL`), mirroring `generateNext` — without it a code
could be composed from the draft while the app read the company's row.

**Field completeness.** After a full reseed, 9 of 23 masters have every column
populated. The rest leave optional columns NULL — GPS coordinates, warranty and
licence expiry, bank details, disposal and amortisation fields on live animals,
KPI thresholds. Those are deliberately empty: filling them means inventing Triple
C's data, which §3 forbids. Two are genuine gaps and neither is ours to close:
`reason_master` is **empty** (47 reason codes were promised, none exist), and
`item_master.sub_category` is NULL throughout, so item codes are
`<type>-<category>-ITM-<seq>` and the three-segment form never appears.

### Medicine is not a master — it is an item
*Decided 2026-09-06.*

Removed and folded into Item. No separate tab, module or master: an item has a
type, and medicine is one of those types. BBP-1 §1.5 only ever calls medicine an
item, and no document asks for a Medicine master; the table was added by Arun in
July.

### Items, GL Accounts and Cost Centers stay locally editable, with a notice
*Decided 2026-09-06.*

BBP-1 §1.5 and §1.6 say these are created in D365BC only. No BC connector
exists, so locking the screens would block all work. They remain editable and
each screen states both halves: where the records are meant to come from, and
that they are local records today. Each master supplies its own citation via
`bcNote` — one hardcoded sentence would be wrong on every other screen.

### Array and JSON fields are edited as rows, not as JSON
*Asked 2026-09-06: "ask for the input fields and a button to add it and then option to delete it and a add more button".*

No user types raw JSON. Row editor with Add / Remove / Add more.

### The item form cascades: type → category → sub-category
*Asked 2026-09-06.*

Category appears only when an item type is chosen **and** that type has
categories. Sub-category appears only when a category is chosen.

### UOM conversion is looked up, and captured once if missing
*Asked 2026-09-06.*

Primary UOM is what the item is bought in, secondary is what it is used in.
The item form does not re-ask for a conversion factor that UOM Conversion
already holds — it shows it. If none exists, it is captured there and written to
UOM Conversion.

Extended 2026-09-08: neither UOM picker offers the unit the other already holds,
and the capture now runs on edit as well as create. It used to run on create
only, so an item edited to add a secondary unit wrote the factor to its own row
and nowhere else, and the next item over the same pair was asked again with
nothing to stop a different answer.

### Item tracking is one three-way choice, over the two columns that already exist
*Asked 2026-09-08: "one switch for tracking then one for lot/serial and then an
input and in backend two booleans for lot and serial".*

TDD row 11 wants LOT, SERIAL or neither. The table has `is_lot_tracked` and
`is_serial_tracked` as independent flags, which can both be ticked — a state the
requirement has no name for. **The columns stay as they are; the form is what
changes.** A tracking switch, then a segmented Lot/Serial choice, then the
number series — the three in one card, in the order they are decided.

Segmented rather than a two-position switch, because a switch cannot label its
own "off": between "Tracking: on" and the series picker, an unlabelled toggle
cannot say whether off means Lot or Serial.

Turning tracking off also clears `tracking_series_id`, in the API rather than
the form. A number left standing on an untracked item reads as configuration
still in force.

Amended 2026-09-08: the number was briefly made **typed, not picked**, because
the picker offered BREED and CUSTOMER — series with nothing to do with lot
numbers.

Reversed the same day. The complaint was right and the fix was not: the picker
was unfiltered and no lot or serial series existed, which is a missing filter
and two missing rows, not a reason to store a number here. An item has many lots
— FEED_STARTER takes one in March and another in April — so no single lot number
is a property of the item, and the numbers already have homes per transaction on
`goods_receipt_line.lot_no`, `inventory_ledger.lot_no`, `bio_asset_ledger.lot_no`
and `qr_code_master.lot_no`. TDD row 12 names the field "No. **Series**", and the
BC field already in the item's `bcFields` is "Lot Nos.", which in BC is a series.

Row 12's trailing "(manual)" is `no_series_master.allow_manual` — whether a
number may be typed rather than generated is a property of the series, and it is
set on both new rows.

So: the picker is back, filtered. `db-seed-item-tracking-series` adds ITEM_LOT
and ITEM_SERIAL in every scope that already carries an ITEM series, with
`document_type` LOT / SERIAL so the segmented Tracked By control passes its own
value straight through as `?documentType=`. The foreign key is restored. The
card grouping, the segmented control and the clear-on-untrack all stay.

The GRN being BC-owned does not change this: the item names the series, the
receipt records the number, and `goods-receipt-panel` already captures `lot_no`
per line — locally until BC connects, like every other BC-owned record.

### The two GL accounts are read in the record, not typed in the form
*Asked 2026-09-08: "Inventory GL Account (BC) + COGS GL Account (BC) should be
shown in the detail with a text/chip saying from BC".*

Both are listed in the item's `bcFields`, which puts them in the record view's
Business Central panel under a From BC chip and takes them out of the create and
edit form. Narrower than the 2026-09-06 rule above, which keeps BC-owned masters
editable: that rule is about whole catalogs — an item still has to be creatable
here. These two fields are BC's answer, and until the connector exists they read
as a dash rather than as a local guess.

### Stock-control fields hang off the inventory flag; the withdrawal period does not
*Asked 2026-09-08.*

Min, max and reorder levels, lead time, shelf life and both storage
temperatures appear only when Inventoriable is on — a non-inventoried item has
no balance for them to describe.

Withdrawal Period is the exception: it shows when Inventoriable is on **or** the
item type is MEDICINE/VACCINE. It is a food-safety block that animal disposal
reads before allowing a slaughter, so a medicine that happens not to be
inventoried still has to carry one. Capped at two digits (99), per TDD row 21 —
in the form and in the DTO, so the form refuses what the API would reject.

---

## Animal Register

### The Active column is dropped for animals
*Decided 2026-09-07, after being asked whether the switch should work.*

An animal is not deactivated, it is **disposed**. Breed has `@Delete(':id')` and
`@Patch(':id/restore')`, which is what its switch calls; Animal has neither, only
`@Patch(':id/dispose')` — and `dispose()` blocks until every administered
medicine's withdrawal period has elapsed, computes gain/loss against book value,
and records the disposal date, type and value. A plain toggle would skip all of
it.

**Consequence to watch:** `dispose()` maps SOLD/SLAUGHTERED/DIED onto the status,
but TRANSFERRED maps to nothing — a transferred-out animal keeps its old status
and only `is_active` flips. With the column gone, that animal reads as ACTIVE.
The client's template lists ten statuses and TRANSFERRED is not among them, so
representing it is a question for Triple C.

### Status renders as a chip; Active is a switch elsewhere
*Asked 2026-09-07: "status and active are different thing right? so switches for the active and the statuses in chips".*

They are different facts — status is the master's own state, Active is whether
the record is live at all. Colour on the status chip says whether the record is
still in play, not a colour per value: a ten-value column painted ten ways is a
chart, not a table.

### Disposal statuses cannot be set through the plain edit path
*Enforced 2026-09-07 after the hole was demonstrated.*

`PUT /animal/:id` with `{status:'SLAUGHTERED'}` returned **200** and left the
animal SLAUGHTERED with `is_active` still 1, no disposal record, and the
withdrawal-period check never run. It now returns 400. CULLED is refused too,
but with a different message: `DISPOSAL_TYPES` is SOLD/SLAUGHTERED/DIED/
TRANSFERRED, so Dispose cannot set CULLED either — the cull flow (out-of-
production date, cull date, reason, weight, write-off) is not built.

### Clicking an animal opens a detail panel; four tabs
*Asked 2026-09-07, refined the same day.*

The list narrows and a panel opens beside it. Tabs: Animal data, Breeding
details, Traceability, and Location traceability and History are to be added —
Rishi chose to keep the genealogy timeline as well rather than replace it.

*Attribution corrected 2026-09-08.* This entry used to credit the two new tabs
to "TDD row 6". It should not: Excel row 6 (S.No. 5) asks only for a clickable
list page, an animal card and an RHS overview pane. The tracker never mentions
a History tab or a Location traceability tab, and neither do the master
templates, BBP-1 or the MOMs — searched, not assumed. The tabs and their
columns are **Rishi's**, recorded below.

Traceability is a **timeline of cards, newest first, each expanding in place**
— not a dialog, and opening one closes the other. Steps with no table are named
as unmodelled rather than drawn as empty cards, because an empty card implies
the record is merely missing.

The panel header shows the **animal code only**. Type, gender and status live in
the Animal data tab; the code stays in the header because it is the one fact
that must hold on every tab.

### TDD row numbers in this repo mean Excel row numbers
*Established 2026-09-08, after a misattribution traced back to it.*

The tracker has a `S.No.` column that runs one behind the spreadsheet's own row
numbers, because row 1 is the header. When Rishi says "row 12" he means Excel
row 12, which is S.No. 11. Quote it as "Excel row N (S.No. N-1)" so the next
reader can find it either way. Getting this wrong is what credited the History
and Location traceability tabs to a row about a list page.

### Age at Entry Weeks is computed whenever DOB is known
*Asked 2026-09-08, from TDD tracker Excel row 12 (S.No. 11).*

The two documents specify different triggers. The tracker says "auto computed
as per DOB of BORN ON FARM animals and MANUAL ENTRY if animals are IMPORTED" —
keying off entry type. The Animal Register Master Template's column G says
"Computed from dob and entry_date. Manual entry if imported and DOB unknown" —
keying off whether a date of birth exists.

**Rishi chose the template's rule.** An imported animal that arrives with a
birth date should not have its age typed in when the dates already say it.

Consequences, all enforced in `resolveAgeAtEntryWeeks()`:

- A value supplied alongside a DOB is **discarded, not merged**. A row holding
  both a DOB and a contradicting age has no reading that is true.
- A DOB after the entry date is a 400, not a zero. The animal cannot have
  arrived before it was born, and silently flooring it hides bad data.
- Hand-typed ages are capped at 520 weeks. That is a **typo guard, not a client
  figure** — ten years is past any pig's productive life, so a larger number is
  a birth year typed into a weeks box. Computed ages are never capped: if the
  dates say the animal is older, the dates are the record.
- Animals with no DOB and no typed age stay NULL. The backfill leaves them and
  reports them rather than inventing a "typical" age.

The template's own example row contradicts itself here (DOB 2024-10-01, entry
2025-01-15 is ~15 weeks, but the example value is 3, and entry_type is
PURCHASED_IMPORTED with a DOB filled in anyway). Flagged, not followed.

### The History and Location traceability tabs are ours
*Decided 2026-09-08, replacing a false citation to the TDD tracker.*

No client document specifies them. Rishi specified them:

- **HISTORY** — columns LAST DATE / BATCH / CURRENT DATE / ENTRY NO. / STAGE.
  One row per **transition event**: LAST DATE is the previous move's date,
  CURRENT DATE is this move's, STAGE and BATCH are what was moved *into*, and
  ENTRY NO. is the source document's number.
- **LOCATION TRACEABILITY** — PURCHASE / OUTPUT / TRANSFER / MORTALITY / CULLS
  with a Location column.

Both read one append-only `animal_movement_log` rather than two tables, so the
two tabs cannot disagree about the same move. CULLS has no source — the cull
flow is not built and `dispose()` refuses CULLED — so it is **named as
unmodelled**, matching how Traceability already treats the Kill Sheet and DOA.
An empty card implies the record is merely missing.

Present the tabs as ours when talking to the client. They are a reasonable
reading of what a farm needs; they are not something Triple C has asked for in
writing.

### Parity counts completed pregnancies, post weaning
*TDD row 27, implemented 2026-09-07.*

A sow whose current litter is still on her has not reached that parity yet, so
her count is one behind the litter number. Rolled up onto the animal from the
farrowing records — BBP: "Parity incremented on weaning POST".

---

## Stages

### The stage master follows the TDD's names and the BBP's durations
*Decided 2026-09-08: "didn't we made the stages to be dynamic so just update them".*

TDD row 24 governs the vocabulary; §1.7 governs every duration and range. Ranges
stay ranges — no invented midpoint is presented as a client-approved figure.

- Renamed: `GILT_REARING→GILT_GROWER`, `DRY_PERIOD→DRY_SOW`,
  `SLAUGHTER→SLAUGHTERED`, `DISPOSED→DEAD`.
- Activated: `WEANING`, `BOAR_AI` (both already existed, switched off).
- Added: `PRODUCTIVE_SOW`, `CULLED`, `SOLD`.
- `BBP_STAGE_RENAMES` was inverted — it used to normalise GILT_GROWER *to*
  GILT_REARING, which would have undone this on the next alignment run.

### LACTATION and WEANING both stay
*Decided 2026-09-08.*

Lactation is a ~28-day period the BBP gives feed standards and a duration to;
weaning is the event that ends it. An event does not replace a period.
INSEMINATION is likewise kept although the TDD omits it — the blueprint
specifies it and the flush → gestation path runs through it.

### FLUSH_SERVICE and CB_GROWER stay inactive
*Decided 2026-09-08.*

Named in neither document. A disabled stage costs nothing; deleting one cannot
be undone if something ever referenced it.

---

## Company settings

### Settings is not a copy of the setup wizard
*Asked 2026-09-07: "the settings should not be the copy of the setup".*

The sections live in the console's own sub-sidebar, each is a route, and there
is no modal, no step wording and no Edit gate — the fields are simply there,
with `canEditCompany` gating them. Team Management was removed: settings is not
where people are managed, `/users` is.

The page H1 is the **section name**, matching the highlighted sub-sidebar item.
"Company settings" is the main-sidebar item, one level up.

### No "Back to All Companies" button
*Asked 2026-09-07: "when we are in a company scope and already have a switch to change the scope".*

The sidebar scope switcher already offers tenant scope ("Consolidated metrics &
all companies"), every company, and every operational area — on every screen. A
second, weaker way out of the scope is a control the user has to read before
ignoring.

---

## Finance

### Currency follows the company config; entries are in base currency
*Asked 2026-09-06.*

Residual value is a **rate that computes an amount**, not a stored figure, so
`breed_master.residual_value_pct` stays a rate. Exchange rates are a dated table
so a past period can be restated with the rate that applied at the time, and the
entry UI is company-scoped and lives in Finance.

### Currency master lives in master data; rates are quoted against USD
*Decided 2026-09-11.*

`currency_master` and `exchange_rate` had existed since the first schema, with
endpoints and no screen — which is why `exchange_rate` held zero rows and
`currency_master` held three, one of them the Indian Rupee. Currencies are now
a master under Finance, reachable from master data only, with Exchange Rates as
a tab beneath them (the `uom` / `uom-conversion` pattern).

Four decisions inside that:

- **Rates are anchored to USD and read "1 USD = rate".** The tab asks only for
  the quoted currency; `from_currency_id` defaults to the USD row in the
  service. Entering ZWL as `36.25` rather than `0.027586` is how the rate is
  actually quoted, and small decimals invite typos. This settles the *rate
  anchor* only — it does not answer the open question about the reporting
  currency, which is still ZWL-vs-USD and still Triple C's.
- **A currency records its countries, not its country.** `currency_master`
  gained `country_codes`, a JSON array of ISO alpha-2 codes, because one country
  could express neither fact that matters: the euro spans Germany, France and
  the Netherlands, and the US dollar is legal tender in Zimbabwe as well as the
  United States. Codes in a JSON array rather than a join table follows
  `location_type_master.allowed_parent_types` and `reason_master.applicable_stages`.
  `country_master.default_currency_id` answers the opposite direction — one
  country's default — and neither is derived from the other.
- **A small, real currency set, not the full ISO 4217 register.** The seed
  covers the currencies of the 25 countries already seeded: 24 rows, up from 3.
  Twenty-two of those countries previously had no default currency at all.
  `lib/currency-seed-data.ts` holds the list, shared by `bootstrap-database.ts`
  and `sync-currency-master.ts` so a fresh database and an existing one cannot
  drift.
- **Retiring a currency deactivates it.** `DELETE /currency/:id` sets
  `is_active = false` rather than deleting: `exchange_rate` cascades on delete,
  so a hard delete took the whole rate history with it, and
  `company_currency_config` restricts, so the same call raised a raw FK error
  for any currency a company had configured. `PATCH /:id/restore` is the other
  half.

`is_system_default` stays false on every row, preserving the 2026-09-09 decision
that there is no system-wide default currency.

ZWG (the ZiG) is seeded alongside ZWL so both exist and the client can choose;
the open question below is unchanged by that.

---

### Master codes stay unique; the tenant_id in their unique index is redundant
*Decided 2026-09-11.*

Allowing duplicate master codes behind a per-series switch was considered and
rejected. The code is not display-only in this schema: `item.uom_primary` and
`uom_secondary` hold `KG`/`PCS`/`ML`, `location.location_type` holds a
`type_code`, `uom_conversion.from_uom`/`to_uom` hold codes, and
`location.service.ts` resolves a UOM with `eq(uomMaster.uom_code, ...)`. Two rows
sharing a code would make those references ambiguous and silently resolve to
whichever row MySQL returned first. Enforcement is also a database UNIQUE index
across 18 tables, which a per-series flag cannot conditionally disable.

If codes are ever to be duplicable, the code-valued references above have to
become UUID foreign keys first, in that order.

Separately, and not acted on: `uq_<table>_scope_code` is
`(tenant_id, company_id, code)`, but each tenant has its own database and every
master row in it carries the same `tenant_id`, so the first column is a
constant. Harmless, but it leaves a small hole — a row written with a wrong or
null `tenant_id` would slip past a duplicate-code check. Not worth rewriting 18
indexes for no behaviour change; recorded so the next person does not assume the
column is doing work.

---

---

## Deployment

### Windows test deployment keeps API and MySQL private behind the web origin
*Decided 2026-09-10.*

The initial Windows RDP test URL is `http://103.234.185.14:3002`. Next.js binds
explicitly to `0.0.0.0:3002`; browser requests remain same-origin under
`/api/v1` and Next proxies them to the API on `127.0.0.1:2877`. MySQL remains
local on 3306/33060. Only web port 3002 needs a NAVFarm inbound firewall rule.

Production startup does not share the generic `PORT` variable between apps.
The API production target runs the built Node entry directly, without Nx's
debug-by-default Node executor, and the web target passes its hostname and port
on the `next start` command line. Redis is not used and is not introduced for
deployment.

---

## Master data lookup controls

### Entity-backed selections use a searchable code/name lookup
*Decided 2026-09-10: "all for the selective fields we need a custom lookup popup with a search bar at top with a table below it with the name and code in 2 columns".*

Every `select-entity` field in the config-driven master-data forms opens the
same lookup dialog: search at the top, followed by Code and Name columns. This
also applies to entity selections inside editable JSON rows and to multi-value
entity fields. Fixed application choices such as status, Lot/Serial and other
enumerations remain compact selects or segmented controls because they are not
rows from a master and therefore do not have a code/name catalog to search.

### Location parent selection follows the immediate hierarchy level
*Decided 2026-09-10: "when level 1 then no parent location and when level n then only locations with level n-1".*

`parent_location_id` is the one canonical hierarchy link and `location_level`
continues to be derived by the API, never typed by the user. A root Location
Type (Farm/level 1) has an empty `allowed_parent_types` list, so its form does
not show Parent Location. A non-root type requires a parent and its searchable
lookup contains only locations whose type is configured as the immediately
preceding level: Shed offers Farms; Pen offers Sheds. Allowed Parent Types is
itself a searchable multi-select over Location Types, not a comma-separated
free-text field.

---

## Open — Triple C's to answer, not ours

| Question | Where it bites |
|---|---|
| Animal code prefix: `PIG-YYYY-SEQ` (TDD row 7 + Animal Register template) or `ANM-YYYY-NNNNN` (BBP §2.1)? | The number series, and every animal code already issued. |
| Does "weaning" mean the sow's event or the piglets' phase? | On the BBP's chain (Sow → Piglet Lot → Weaner Batch) the weaner phase belongs to a batch, not a sow. |
| Residual value: a percentage (our column) or a per-kg rate (Bio Asset BBP, 20 Aug MOM)? | Amortisation and disposal gain/loss. |
| Reporting currency: ZWL (§1.1 flowchart) or USD (§1.1 field spec)? | Every report. |
| ZWL or ZiG? | The currency master. |
| The 47 reason codes — 3 exist. Mortality alone is specified as 21. | Mortality, cull, return, scan-fail and selection entry screens. |
| Kill Sheet and DOA have **no tables**. The BBP gives the kill sheet a process (attached to the TO, carcass weights per line, invoice = Delivered Qty × Avg Carcass Weight × Price/KG) but no field specification. | Revenue, and the end of the traceability chain. |
| Location code format — the template says only "Unique code per tenant". | Our hierarchical scheme was an invention, and as of 2026-09-09 every seeded location carries it (`FARM-001/SHED-001/PEN-003`). If Triple C wants something else, the LOCATION series and `db-align-master-codes-to-series` are where it changes. |
| Is the cull flow in scope? Out-of-production date, cull date, reason, weight, write-off, and the 14-day INFO alert are all specified and none are built. | CULLED cannot be set anywhere today. |

---

## Demo data may be synthetic when it is clearly demo-only
*Decided 2026-09-10.*

The values written by the demo-only seed are not Triple C's production data.
Synthetic values are allowed there so that testers can exercise complete forms
and workflows before the client supplies its real records. They must remain
clearly identified as demo data, must not be copied into a production tenant,
and must not be described as client-provided facts or requirements. When Triple
C supplies real data, it replaces the synthetic dataset.

This does not weaken the standing rule against inventing client data: product
defaults, production seeds, migrations, and claims about Triple C still require
client evidence or Rishi's decision.

---

## Every dropdown's source master is named on the screen that uses it
*Decided 2026-09-12.*

The "Dropdown options come from" row is derived from the select-entity fields
themselves, so a field added later needs no second place to remember. Three
things it got wrong, all now fixed and covered by
`specs/master-data-lookup-chips.spec.ts`:

It read only top-level fields, so Item Attributes — reached only through Items'
Attribute Values row editor — was the one master the row never mentioned. It
truncated an endpoint at its first slash, which credits `/uom` for a reference
to `/uom/conversion`; the longest matching `apiBase` now wins. And it withheld
Business Central-owned catalogs from the row while the dialog offered those very
same masters as inline lookup cards.

**A BC-owned master is not read-only.** `readOnly` tracks administration
rights, not BC ownership, and until the Business Central integration is
connected every one of these catalogs is created and edited locally against our
own database — BC sync comes later. Items, Suppliers, GL Accounts and Cost
Centers therefore appear in the row like any other lookup; `BcOwnershipNotice`
still states the provenance. Withholding the chip while offering the card said
two different things about one catalog, and the card was the one telling the
truth.

An endpoint no master serves — `/setup/wizard/nobs`, `/costing-method`,
`/goods-receipt` — deliberately names nothing. NOB and LOB come from the setup
wizard, not from a master on the screen.

## Vaccination and medication are rows, not hand-typed JSON
*Decided 2026-09-12.*

Both were `type: "json"` textareas on Breed Lifecycle Stages — someone typing
valid JSON by hand into a form. They are now `jsonRow` row editors, the
mechanism the codebase already had for exactly this.

The Breed Master workbook (MULTIPLIER and Porta) settles the shape. Management
filled `Vaccination Schedule` in as **five repeated columns** — "1st vaccine -
farrowsure (gilt) 25 weeks", "3rd vaccination (Every pregnancy cycle) 14 weeks
preg farrowsure", "Vaccine porcillis 11 weeks pregnant every pregnancy cycle".
Five columns is a spreadsheet saying "this is a list of unknown length", so it
is a list of rows.

The triggers are not one kind of number: some count from the animal's age in
weeks, some from weeks pregnant, and some recur every pregnancy cycle. So each
row carries a `trigger_type` (AGE_WEEKS / WEEKS_PREGNANT / PER_CYCLE) beside its
value. The template's own JSON example proposed a single `age_days`, which can
express only the first of the three.

Medication is a different thing and is shaped differently. The workbook's
Medication Table is symptom-driven, not dated — Problem → Symptom → Drug → Dose
→ Repeat, grouped by Suckling Piglets / Lactating Sows / Dry Sows. It is the
treatment card a stockman reads when an animal presents, so it carries no
trigger: the problem is the trigger. Dose stays free text because the card
records it per head and per kg both ("0.5ml", "1ml /10kg").

**The master holds the plan; the scheduler holds the dated instances** — which
is what the template says of the vaccination schedule: "Auto-populates scheduler
params on batch create." `breed_master.vaccination_schedule` is a third home for
the same fact, has never been exposed on any screen, and is NULL in every row;
it is to be dropped when the next migration batch runs.

## Exchange Rates lives in Master Data only
*Decided 2026-09-12.*

The same screen was reachable at Master Data → Exchange Rates and at Finance →
Exchange Rates, over the same `/currency/rates` endpoint — one catalog under two
names. The Finance tab and its now-orphaned panel are removed.

The Finance placement rested on reading BBP-1 §1.1, which has Finance entering
the USD/ZWL rate by hand, as saying the screen belonged among the finance work.
§1.1 says who types the rate, not which menu it hangs from. The API settles it:
every rate route is gated on `MASTER_DATA`/`CURRENCY`, not on a finance
permission, so the move aligns the UI with the permission model that was already
in force.

## Shared sidebar routes keep one relative order across scopes
*Decided 2026-09-12.*

Master Data sat 4th in company scope and 10th in an operational area, Batches
7th and 2nd, Livestock 8th and 4th. Same routes, same labels, different order —
so the muscle memory built in one scope was wrong in the other. Company scope
now follows the operational spine: Dashboard, Batches, Livestock, Inventory &
Stock, Finance & Costing, Master Data, then the company's own entities.

Only the *relative* order of shared routes is locked, by
`specs/nav-scope-consistency.spec.ts`. Each scope keeps its own items and may
interleave them — Schedulers sits next to Batches in an operational area and
exists nowhere else. What a scope may not do is reshuffle the routes it has in
common with another.

Batches now carries the same icon in both scopes. It was Wheat in company scope
and Layers in an area, while Layers is also Operational Areas' icon — one item
with two icons, one icon meaning two items.

**Operational Areas and Company Settings stay top level, ungrouped.** Grouping
them under a Settings parent was proposed and rejected: a company is the entity
under the tenant, an operational area is only a scope for one LOB inside it, and
neither is the same kind of thing as the three area configuration screens that
operational scope collects under Settings.

The Notifications asymmetry is deliberate and stays: tenant and company scope
have it, an operational area does not.

## Animal Register is a master, and only a master
*Decided 2026-09-12. Not yet implemented.*

Animal Register existed twice over the same `/animal` endpoint: Master Data →
Animal Register, and Livestock → Animal Register (`/livestock`, `animal-panel`).
Master Data keeps it; the Livestock entry goes.

`animal-panel` is the richer screen — it owns stage transition and the
medications view, which the Master Data screen does not have. Those two move to
Batches → Batch Animals, where the batch context already is. `/livestock` then
redirects to `/livestock/breeding`, and `specs/livestock-sections.spec.ts` —
which asserts the register owns the module root — changes with it.

Held back from the 2026-09-12 batch deliberately: `animal-panel` is 1096 lines
and `batch-animal-assignment-panel` is 1227, and a move between two files that
size does not belong in the same change as a nav reorder.

Not duplicates, verified: Batches → Batch Stages reads `/stage` but posts
`/batch/:id/transfer-stage`, so it is operational stage transition rather than
the Stages master. The RFID scanner, batch-animal assignment and stage
transition modals write to `/animal` but are operational actions, not a second
register.

## Item Tracking stays a three-way choice; "LOT AND SERIAL" imports as LOT
*Decided 2026-09-12.*

The Item Master template's real rows use Item Tracking = "LOT AND SERIAL" on
several feed items (Creep-3 Lacto, Creep1-Lacto, Creep2-Lacto). That contradicts
the 2026-09-09 decision that TDD row 11's one three-way choice — LOT, SERIAL or
neither — is what the form may express, reconciled against the two independent
boolean columns the table carries.

The 2026-09-09 decision stands. Those items import as LOT, and the mapping is
recorded here rather than silently applied, because it is a narrowing of what
the client's sheet says.

## CRATE is a location type under SHED
*Decided 2026-09-12. Not yet implemented.*

Porta's Location Master has 89 rows of type CRATE — farrowing and service-line
crates, capacity 1 — under its houses. `location_type_master` has FARM, SHED,
PEN, SILO, STORE, CAGE and QUARANTINE, but no CRATE. CRATE is added with
`allowed_parent_types` of `["SHED"]`.

Not mapped onto CAGE, which is poultry vocabulary and would make the screens say
something the farm does not. Not mapped onto PEN either: the capacity data
separates them plainly — a crate holds 1, a pen holds 34 to 39.

---

## Open — pending Rishi, from the 2026-09-12 template review

Read only the MULTIPLIER and PortaMasterTemplates folders, as instructed. Seven
other farms (Grasmere, Lionshead, Lionshead Extensions, Learig, Richlands, Villa
Franca, AI Station) have the same four templates and were not opened.

| Question | Where it bites |
|---|---|
| Do MULTIPLIER and PORTA FARM become two top-level locations under Triple C, replacing the single `FARM-001` "Triple C Farm" placeholder? | Every location, and the farm each batch runs on. The real addresses are Grasmere Farm, Norton and Kintyre Estate, Norton. |
| The other seven farms — same treatment later, or out of scope? | Whether the location loader is written for two farms or nine. |
| The ~17 Breed Master KPI columns — `avg litter total born`, `# born dead`, `# mummified`, pre-wean mortality %, total litter mass weaned, `w/s/y`, litter index, empty days, 70-day weight and gain, weaner FCE and mortality, grower FCE, mortality and ADG, AVG CDM to Colcom. A KPI/target master, or fields on Breed? | These are performance targets, not breed genetics. `KPI Triple C Pigs_SUBMISSIONS.xlsx` exists and has not been opened. |
| `Period From`/`Period To` on the lifecycle sheets are natural language, not numbers: "from service week", "15 weeks pregnant", "Thursday day of weaning", "weekly farrow batch". `Calculation Unit` includes "Service week". Add a free-text anchor beside the numeric range, or normalise to numbers and keep the sheet text as a note? | `breed_lifecycle_stages.period_from`/`period_to` are numeric. Until this is settled the client's lifecycle data cannot be loaded. |
| Breed Lifecycle Stages rows in the templates are per **(breed, stage, location, feed silo)** — the same stage repeats once per pen, crate or house (MDS-01…16, MWH-01…06, MGH-01…10), each pinning the silo to draw feed from. Our table has neither `location_id` nor silo columns. | The same blocker as above, and the reason a single "Weaner" row cannot hold the data. |
| Location Master carries a Silo/Store name-number (`MGH1`, `PSL FS - 01`) and a "Feed in Bags" yes/no per location. Neither has a column. | Silo-level feed tracking and the bagged-vs-bulk distinction the lifecycle sheets depend on. |
| Should `masterScopeConditions` scope master data by farm? `operational_area_master.farm_id` exists and is populated, and the service joins it, but the scope function filters only on tenant, company, NOB and LOB. | Rishi: "the top level location is the location of the actual farm on which the operations would be running and the things would be according to the top level location." |

---

## Master lists are sorted, filtered and paged in SQL
*Decided 2026-09-12.*

Every master list asked the API for `limit=200`, never sent an offset, and cut
pages out of the result in the browser. Sixteen of the seventeen master services
had no `orderBy` at all, so the order rows came back in was whatever MySQL
chose and could differ between two loads of the same page — which is why the
Items list read LIVESTOCK, VACCINE, RAW_MATERIAL-0002, RAW_MATERIAL-PROTEIN.

That survives demo data and fails on the client's. MULTIPLIER's location
template is **508** rows and Porta's **191**: the Locations list would have shown
200 of 699 with no way to reach the rest, and a filter applied in the browser
would only ever have searched those 200. Adding filters on top of that window
would have made it look like it worked while hiding two thirds of the farm.

So `common/master-list-query.ts` holds one contract for every master:
`sort`, `dir`, `filter[column]`, `limit`, `offset`, with `total` returned beside
the rows. `data` stays the array it always was, so no existing caller breaks;
total/limit/offset are new siblings. Sorting falls back to the master's own code
column, so a list is never unordered even when nothing is asked for.

**Every filter and sort key is checked against the table's real columns and
refused by name if it is not one.** A filter that appears to be applied and is
not is the worst of the three outcomes, because the list then reads as an answer.
This was not theoretical: the first version of the helper skipped columns that
the service also exposed under a camelCase name of its own, to avoid filtering
twice — and `filter[location_type]=PEN` duly returned all 18 locations and
reported success. Applying both is harmless; two identical conditions AND to the
same result. Only `tenant_id` and `company_id` are refused, because the
workspace sets them.

**Express 5 was the reason bracket syntax did not arrive at all.** Nest 11 ships
Express 5, which defaults `query parser` to `simple` where Express 4 defaulted to
`extended`; `filter[location_type]=PEN` arrived as one flat key literally named
`filter[location_type]` and the whitelisting ValidationPipe rejected it as an
unknown property. `main.ts` sets the parser back to `extended`.

## Item classification is on the Item list
*Decided 2026-09-12.*

The list showed Code, Name, Type and UOM, so the category an item was filed
under could not be seen without opening it — though the type, category and
sub-category are the three questions the form asks and the three segments the
item's own code is built from. Category and Sub Category are now columns.

`item_master.category_id` holds a UUID, and a list rendering it raw shows the
reader a UUID, so `findAll` left-joins `item_category_master` for
`category_code`. Resolving it per row from the client would have been one
request per row. `sub_category` needs no join: it already stores the child
category's own code, which is what makes it readable as it stands. The join also
makes Category filterable in SQL.

## Lookup chips follow the form, not the registry
*Decided 2026-09-12.*

"Dropdown options come from" listed masters in the order they happen to sit in
`MASTER_DATA_CONFIGS`, so the Item screen read Item Categories before Item
Types — the opposite of the order the form asks, where Item Type comes first and
Category cannot be answered until it is. The row is now ordered by field
position, with any master that declares `lookupFor` without owning a field on
the screen following in registry order.

## Only MULTIPLIER and Porta are seeded
*Decided 2026-09-12.*

Nine farms submitted master templates. Only MULTIPLIER and PORTA FARM are
seeded; the other seven (Grasmere, Lionshead, Lionshead Extensions, Learig,
Richlands, Villa Franca, AI Station) are not, and their templates were not
opened.

Four decisions the seed rests on:

- **The client's own location codes**, exactly as submitted — `MUL100`,
  `MUGR1`, `MUGR1P1`, `POR100`, `PGH1`, `PSLCr1`. These are what farm staff use
  and what the sow cards reference. The LOCATION number series stops generating
  codes for seeded rows, and `decisions.md`'s open question on location code
  format closes: the templates answered it.
- **The 18 synthetic locations are replaced**, not kept alongside. "Triple C
  Farm" and its invented pens go; MULTIPLIER and PORTA FARM become the estate.
  Consistent with the standing rule that real client data replaces the synthetic
  dataset. Destructive, so the script follows the house shape — read-only by
  default, `--verify` inside a rolled-back transaction, `--apply` to commit —
  and the plan is reviewed before it commits.
- **HECTARE is added to `uom_master`; NUMBERS maps to the existing HEAD.**
  MULTIPLIER's farm area is in hectares and there is no equivalent unit, so it
  is genuinely missing. Capacity in "NUMBERS" is a headcount of animals and HEAD
  already means exactly that, so it maps rather than adding a near-duplicate.
- **CRATE, silo name and feed-in-bags are migrated first.** Porta has 89 crates
  and no CRATE type exists; the templates also carry a silo/store name-number
  (`MGH1`, `PSL FS - 01`) and a per-location "Feed in Bags" flag with no columns.
  Without them the location data would load with those fields dropped.

## The list contract reached every master by probing, not by reading
*Recorded 2026-09-12.*

Rolling the contract out across 22 master endpoints turned up two failures that
tests and typecheck both passed:

**Four masters accepted `filter[column]` and ignored it.** Their DTOs extended
the shared base, so the parameter validated; their services never applied it. So
`filter[item_type]=FEED` returned all 28 items with a 200 — the silent-ignore
failure this contract was written to prevent, reproduced by the rollout itself.
`/location-type`, `/animal`, `/item` and `/reason` were wired; `/currency` was
found the same way on the second pass.

**Every endpoint is now probed for three things, not one:** that it sorts, that a
real filter narrows the result, and that a nonsense column is refused with a 400.
The third is the one that catches a service whose DTO has run ahead of it — a
list that accepts a filter it does not apply looks like an answer. A service is
not considered wired until a bogus column returns 400 from it.

**`location_type_master` keeps its own ordering first.** Its `company_id IS NULL`
sort is a precedence rule, not a preference — the dedupe below it pairs tenant
templates against company overrides and depends on that order. A caller's sort is
applied within it rather than replacing it.

Masters not reached, deliberately: `farm`, `shed` and `warehouse` (read-only
views over `location_master`, not master-data screens), `plan` and `journal`.
Their DTOs accept the parameters but their services do not apply them, so they
must be wired before any screen offers filters over them.

---

## MULTIPLIER and Porta are loaded; 453 rows wait on Triple C
*Applied 2026-09-12 via `nx run api:db-seed-farm-locations --apply`.*

250 of the 703 submitted location rows are in `tenant_devco`: MULTIPLIER 75 of
512, Porta 175 of 191. `docs/triple-c-location-code-queries.md` lists every one
of the 453 that could not be loaded, with its code, type, SUB-LOC and the reason.

**Why so few.** Both templates require "Unique code per tenant" for Location
Code, and neither delivers it. MULTIPLIER's codes omit the parent: `MUP1` is
five pens, one in each farrowing house FH1–FH5, all named "PEN 1"; `MUWN1` is
six weaner houses with different areas (66.5, 66.5, 70.02, 70.02, 66.5, 66.5
m²), so six places under one code; `MUFHE` is five farrowing houses. Porta's
problem is different and smaller: `PGH2`, `PGH3`, `PGH4`, `PFH1` and `PFH2` are
each used once for a Porta Grower House and once for a Porta Gilt House, because
both abbreviate to PGH. Four MULTIPLIER rows have a code and a pen name but a
blank Location Type.

**The cascade is why 453 and not 232.** A duplicated shed code makes its children
unplaceable too — 221 of the blocked rows are pens and cages whose parent shed
could not be identified. Counting only the directly duplicated rows understated
it by nearly half.

Nothing was renamed, derived or guessed. Deriving `MUFH1P1` from `MUP1` + `FH1`
would be minting client identifiers, and only Triple C knows whether `MUWN1` ×6
is six houses or one house typed six times.

**What the seed does.** Parents first, keyed on `location_code`, so a re-run
updates in place rather than duplicating — the script is re-runnable the moment
corrected codes arrive. Hierarchy comes from code prefix (`MUGR1P1` under
`MUGR1`), which placed every loadable child unambiguously. It adds `HECTARE` to
`uom_master` (MULTIPLIER states its farm area in hectares and no equivalent
existed) and `CRATE` to `location_type_master`, each in both scopes, matching how
every other lookup is held here. Capacity in "NUMBERS" maps to the existing
`HEAD`.

**The synthetic farm is switched off, not deleted.** 59 rows point at it — 27
animals, 5 batches, 5 mortality records, 6 inventory ledger lines, 4 breeds, the
goods receipts and the operational area itself. A delete is blocked by those
foreign keys and forcing it would strand every one of them. All 27 animals still
resolve to a location after the run. `PIGGERY-01` now points at MULTIPLIER.

Retirement targets the demo codes specifically — `FARM-001` and
`FARM-001/%` — not "everything not in the seed", which on a second run would
switch off every location added since the first.

**`storage_name` and `feed_in_bags`** are now on the Location form, not just in
the table: the silo's own name-number (`MGH1`, `PSL FS - 01`) shown only when
Storage Location is set, and the bagged-vs-bulk flag both templates carry per
location.

MULTIPLIER's 97 housing rows are typed `CAGE` while Porta's 89 are `CRATE`. Both
types now exist. Whether the two farms mean different things by them is a
question for Triple C, not an inference for us.

---

## Resources and breeds seeded; master lists report a real total
*2026-09-13.*

**Resources and breeds.** `db-seed-farm-masters` loads 16 of 44 submitted
resource rows and 2 of 4 breeds — Z-Line-Sow to MULTIPLIER, TN-70-Sow to PORTA,
each linked to its farm. The synthetic `RES-00n` resources and the four demo
breeds are switched off, not deleted: 27 animals and 72 lifecycle-stage rows
point at those breeds.

The shortfall is the templates again. `resource_code`, `resource_name` and
`resource_type` are all mandatory and all NOT NULL; **MULTIPLIER's resource
sheet carries no codes at all**, and Porta left Resource Type blank on most
rows. "Teaser Boar" has no Breed Code on either farm.

Four values were deliberately not stored, and are questions rather than data:

- **Farrowing Rate %** — template example `85.00`, farms wrote `0.9` and `0.93`.
  A 0.9% farrowing rate is impossible and 90% is ordinary, so the cell holds a
  fraction in a percent column. Storing it would make every report quoting it
  wrong.
- **Boar Doses Per Week** — example `4.00`, farms wrote `36` and `74`. Per stud
  rather than per boar, most likely; unconfirmed.
- **Residual Value Amount** reads "accounts" — who decides it, not a number.
- **`breed_type`** is in neither template but the column is NOT NULL. Both rows
  were given `MEAT`, matching every piggery breed already here. Both are
  maternal lines and `BREEDER` exists, so this is flagged, not settled.

The Resource template's "Number" column has no field in `resource_master`. Every
row loaded is a Porta row with Number = 1, already listed individually, so
nothing was lost — but MULTIPLIER's "Heaters ×6" would need six rows or a
quantity field.

**Exact totals.** Twelve masters now return `total` beside their rows —
location, item, item-category, item-type, item-attribute, customer, disease,
feed-formula, resource, gl-account, gl-mapping, cost-center. Nine still do not
(uom, supplier, breed, species, reason, stage, number-series, currency, animal);
their list queries have shapes the shared helper does not fit — several hold more
than one list method in a file, and `item` needed a hand-written count because it
joins the category. Those nine page and filter correctly; only the pager's count
is approximate. `data` remains an array on every one of the 21, so no caller
broke.

**The API dev server had been serving a stale bundle since 00:46.** Its Nx
watcher had died, so `dist/main.js` predated hours of committed source. Two
verifications in that window passed against old code. Restarted by the PID
`lsof -ti :2877` confirmed, after stopping the orphaned `nx serve` wrapper that
still held the task lock. Worth checking `stat dist/main.js` against source
mtimes when a change appears not to take.

---

## Column filters are a set, taken behind a drawer
*Decided 2026-09-13.*

The search box in the toolbar narrows on every keystroke: it is one field over
the whole list, and typing is the interaction. Column filters are not that —
they are several decisions taken together — so they moved out of the always-on
row under the headers and into a right-hand Drawer behind a Filter button.

Nothing applies until **Apply**. The drawer edits a draft; Apply is the single
point where the draft becomes the live filter. That is what lets someone set
four columns and pay for one refetch instead of four, and back out of a
half-built filter by closing the panel. **Reset** clears everything and closes.
The button carries a badge with the number of filters actually in force, so a
narrowed list never looks like the whole list.

**One filter body, two shells, chosen by width.** At `lg` and above it is a
second grid column beside the table — the shape the Animal detail panel already
uses — so the rows being filtered stay visible and the panel stays open after
Apply to be refined. Below `lg` the same fields interrupt as a dialog, because a
340px side column would leave the table too narrow to read; there Apply closes
it and hands the list back.

Two earlier attempts were wrong. The first used `components/ui/drawer`, which
portals over a scrim and buries the rows behind the thing filtering them. The
second put the in-page column behind `xl` (1280px), so on a 1200px window the
panel silently stacked *below* the table, off screen — it looked like the button
did nothing. The breakpoint is `lg` (1024) now, matched by `useIsDesktop()` so
the grid and the shell can never disagree about which one is showing.

Rendered once, never twice: a `hidden lg:block` pair would mount both shells and
duplicate every input's id and focus trap.

The toolbar search stays where it is: common search in the main search bar,
everything else in the panel.

**Filter labels come from the field, not the column head.** A table header is
read together with the values under it, so Stages heads its sequence column "#"
and is perfectly clear; stripped of that column and put on a filter input, "#"
says nothing. The field behind it calls itself "Display Order", which is the
name the panel uses.

## Arun's branches, reviewed 2026-09-13

`origin/arun_new` is the live one — last commit 2026-09-10, 5 ahead of `neroen`
and 7 behind. It is **remote-only**, which is why a `git branch` listing misses
it. `arun.pratap` (2026-07-30), `arun.pratap1` (2026-08-13) and
`arun.pratap2` (2026-08-18) are stale and hold nothing worth recovering: their
master-data module is the ancestor of ours, their `app/console/*` tree was
replaced by `(app)/`, their Medicine master is correctly superseded by
item_type MEDICINE per BBP-1 §1.5, and their farm/shed/warehouse specs test a
`create()` those services no longer have.

**What is on `arun_new`:**

- **The scheduler is rebuilt, not adjusted.** `scheduler_master` and
  `scheduler_parameter_line` are dropped and replaced by `scheduler_header` +
  `scheduler_line`, and `batch_header.scheduler_id` goes with them. The
  semantics change: `scheduler_header` carries `batch_id` and `stage_id` NOT
  NULL, so a scheduler belongs to one batch and stage rather than being a
  reusable template. `scheduler_line.parameter_name` becomes `activity_name`.
- **An Activity master** — `/activity`, full API and UI, migration
  `0089_activity_master.sql`, a seed script, `line_type` of CONSUMPTION /
  OUTPUT / DESCRIPTIVE / OVERHEAD / RESOURCE / TRANSFER. Neither the module nor
  the table exists on our side.
- **Batch follows the scheduler** — the batch header gains `stage_id` and reads
  stages from Stage Master per LOB instead of a fixed enum; data entry is driven
  by each line's `line_type`.
- **`SearchableEntitySelect`** and a `searchable?: boolean` field flag, for
  catalogs long enough that a native dropdown stops being usable.

**The branches cannot merge cleanly.** Both forked at 0085 and both wrote an
0086 and an 0087 with different content — ours are currency and the location
columns, his are the scheduler replacement and its gap fixes. Drizzle tracks
applied migrations by tag in `_journal.json`, so one side must be renumbered and
both snapshots regenerated. Seventeen files are touched by both, including
`schema.ts`, `MasterDataTable.tsx`, `configs.ts`, `types.ts`, `translations.ts`,
`location.service.ts` and `layout.tsx`.

**Rishi's call, 2026-09-13: leave it entirely for now.** Nothing of his has been
merged or modified. The collision grows with every commit on either side, so
this is deferred, not resolved.


## Sorting was accepted and ignored on three masters
*Fixed 2026-09-13.*

Clicking a column header did nothing on Stages, Number Series and Animal
Register. The API answered 200 to `sort=stage_code&dir=desc` and returned the
same rows in the same order.

The cause was my own rollout. The script that wired the list contract skipped
any service that already had an `orderBy`, on the reasoning that it was
"already ordered" — so those three kept a hardcoded sort while their DTOs
happily accepted `sort` and `dir`. The same silent-ignore failure as the
filters, in the same week, found the same way: by asking the endpoint for
ascending and descending and noticing the answers matched.

Stage keeps `stage_sequence` as its default and Number Series keeps its
tenant-template precedence; the caller's sort is applied within those rather
than replacing them. Animal Register had no `ORDER BY` at all.

**Test sort by comparing asc against desc, never by checking for a 200.** A
sorted and an unsorted list look identical from a status code.

## A list column shows its values, not its JSON
*Fixed 2026-09-13.*

`displayValue` sent every object through `JSON.stringify`, so the Currencies
list rendered the euro's countries as `["DE","FR","NL"]` — brackets, quotes and
all — and every other multi-value column with it. Arrays now join on ", ", and
an empty one reads as "—" like any other empty cell.

---

## Countries are a master now
*Decided 2026-09-13.*

Countries could be read and never added from the console. `country_master`
holds 25 rows, `country_codes` on Currencies picks from them, and Suppliers and
Customers record a country as **free text** — the same fact chosen from a list
in one master and typed by hand in two others. Countries had no entry in
`MASTER_DATA_CONFIGS`, so no screen, and no chip in "Dropdown options come
from" either, which is what made it look unlike every other selection source.

It is a master now, under Finance, with the ISO2/ISO3 codes, name, dialing code
and flag. Its list answers the shared contract — sort, `filter[column]`,
paging, a total — where `listCountries()` previously took no query at all and
returned every active row.

**It stopped forcing `isActive`.** A master list has to show a blocked row so it
can be found and restored; the pickers that consume it pass `isActive=true`
themselves, as they already do everywhere else.

**The response is now the standard envelope, and two callers had to change.**
`/country` used to answer with a bare array — the console layout's onboarding
wizard and `/admin/masters` both assigned it straight into state. Both now take
`data` out of the envelope.

**Adding one is still `SystemAdminGuard`.** Countries were already addable, from
`/admin/masters` ("Master Registries"), which is the platform admin area rather
than the tenant console. So the new screen lists and edits nothing for a Tenant
Admin — Add will 403 until that guard is relaxed. `CountryService` reads the
**tenant** database, so a country added here would belong to this tenant alone,
which is an argument for relaxing it; that is a permissions decision, not ours.

## Eight masters have no page of their own

`MASTER_DATA_CONFIGS` holds 25 masters. Thirteen are `isPrimary` and appear in
the Master Data sub-nav; four are tabs of another master. The remaining eight —
Location Types, Item Categories, Item Types, Species, Diseases, Feed Formulas,
Customers, GL Mappings — are reachable only as a lookup card or chip inside
another master's screen. Recorded because it is not obvious from the sub-nav,
and because "why is X not listed" has now been asked twice.

## The bottom of a long list could sit under a scrollbar
*Fixed 2026-09-13.*

Scrolled to its limit, a master list's last row was not visible — there was
nothing further to scroll and the row was still underneath something.

It does not reproduce in headless Chromium, which is why an earlier check
passed it: headless overlays its scrollbars, and this only happens when macOS
is set to show them always. Then the content scroller's bar takes 15px out of
the width the moment the list is long enough to scroll, that squeeze pushes a
wide table into needing a horizontal scrollbar of its own, and that bar lands
across the last row. The list has genuinely bottomed out, so scrolling further
does nothing.

Two changes, both of which hold whichever way the setting is:

- `scrollbar-gutter: stable` on the content region, so the gutter is reserved
  whether or not the bar is showing and the table is measured against the width
  it will actually have.
- `ConsolePage` bottom padding from `pb-6` to `pb-10`, so the last row never
  finishes flush against the scroller's edge where an overlay — a horizontal
  scrollbar, the floating assistant button — can cover it.

Verified by forcing 15px classic scrollbars in the page and scrolling to the
limit: the last row and the whole pagination bar clear the bottom by 94px.

**Reproduce environment-dependent layout bugs with the environment forced.** A
headless browser is not the reader's browser, and scrollbar behaviour is one of
the places they differ most.

## Countries is a sheet of the Currencies workbook
*Corrected 2026-09-13.*

Countries was added as its own entry in the Master Data sidebar. Wrong: a
country is only ever reached through the thing that needs it — which currency
is legal tender where, which country a supplier sits in — so it is a tab beside
Exchange Rates, not a master of its own. Rishi's call.

It also shipped broken for one turn. `MasterDataTable` sends the active company
on every list request, `QueryCountryDto` did not declare `companyId`, and the
whitelisting ValidationPipe answered "property companyId should not exist" — so
the screen rendered "No countries yet" over 25 rows that were there all along.
The DTO now accepts it and documents that it is not applied: `country_master`
has no `company_id`, because countries are tenant-wide reference data, the same
list for every company under the tenant.
