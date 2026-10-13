# Batch, animal, output and inventory linkage — 9 Oct 2026

Goal: one consistent path for mortality, parity, transfers and outputs, so the batch, the scheduler,
the animal card, the Breeding screen and inventory all report the same numbers.

Source of the gap list: code and `nf_devco` review of 9 Oct 2026 (item ids A1–M7 below match that review).
Nothing here is a client requirement unless a decision row says so. Open items for Rishi are in
"Decisions needed" and must not be answered by the implementer.

Rule for every phase (AGENTS.md §3): a phase is done only when the write has been made through the
running app or API and read back in MySQL. A green unit suite is not evidence.

## Decisions needed (block the phases that name them)

| # | Question | Blocks |
|---|---|---|
| D1 | Piglets: headcount piglet lot/batch, or each piglet registered at birth? | Phase 4, J6 |
| D2 | Parity goes up at weaning post (TDD row 27, already recorded in decisions.md). Confirm. | Phase 1 (built to this) |
| D3 | Do farrowing, weaning and semen collection move into batch data entry? | Phase 4, 5 |
| D4 | Semen QR: lot-level or pack-level, and what it carries. | Phase 5 |
| D5 | Do stillborn / mummified piglets count as mortality? | Phase 4 |
| D6 | Allow headcount transfers between batch-wise batches? | Phase 2 (D1) |
| D7 | Do productive sows and boars mature automatically (bio-asset)? | Phase 3, 4 |

## Phase 1 — One mortality path, one parity rule (DONE 9 Oct — verified live, see decisions.md)

Items: F1 F2 F3 F4 (partly) C2 C3 E1 E6 G1 E2 A4.

1. `BatchService.addTransaction` becomes the single mortality write. For `MORTALITY` with an `animal_id` it
   now, in the same database transaction: validates the animal is a live member of the batch before
   anything is posted; marks it DEAD / inactive with date, `DIED`, and reason; logs a `MORTALITY`
   movement; and tags the batch-level bio-asset ledger row with the animal. For any `MORTALITY` it lowers
   the scheduler `animal_count` of the right stage header (animal's stage, or the batch's current stage).
   `mortality_detail.reason_id` is accepted, must be a MORTALITY-category reason, and fills
   `cause_of_death` when that is blank (no schema change; `batch_mortality_detail` has no reason column).
2. Data-entry "Daily Mortality Check" (DESCRIPTIVE / MORTALITY_COUNT) stops marking animals itself and
   calls `addTransaction` for each increase in deaths, so a death also creates the MORTALITY transaction,
   closing-quantity change and cost write-off. It keeps its own scheduler-count write (passes
   `skip_scheduler_count`). A *decrease* is unchanged (count only) and stays an open item.
3. `AnimalService.dispose` with `DIED` on an animal in an ACTIVE batch delegates to the same path;
   other disposals are unchanged. `AnimalModule` imports `BatchModule` (no cycle).
4. Mortality & Health panel: shows the save error, reloads from the server instead of adding a local row,
   and offers the MORTALITY reason list. New `POST /batch/:id/mortality` (all animals or none) is what it calls.
5. `POST /batch/bulk-daily-entry` goes through the same path (it already calls `addTransaction`).
6. Parity: farrowing no longer changes `parity_count`; weaning sets it to the farrow's `parity_number`
   (idempotent) and counts weaned piglets as a delta; the stage-transition increment is removed.
   `docs/decisions.md` entry added.

Not in Phase 1: write-off at the animal's own book value (F5), reversal when a count is lowered (C7).

Verify: record a death for a batch-wise batch and for an animal-wise batch through the API; read
`batch_transaction`, `batch_mortality_detail`, `batch_header.closing_quantity`, `scheduler_header.animal_count`,
`animal_register`, `animal_movement_log`, `bio_asset_ledger`, GL journal. Dispose DIED through the animal
route and read the same tables. Farrow then wean a sow and read `parity_count` after each step.

## Phase 2 — Schedulers and transfers (DONE 9 Oct, C8/D5/D7 closed — see decisions.md; sex setting is mechanism only until the client configures stages)

B1 B2 B4 D1–D6 E3 E4 A1 A2 A3 C8.
- Scheduler `animal_count` for animal-wise = live animals in that batch **and stage**; recomputed after
  mortality, dispose, transfer and stage change.
- Transfer posting becomes one transaction; animals keep their own stage unless a destination stage is
  chosen; destination gets a scheduler per stage it now holds; per-animal item on ledger legs.
- Headcount transfer / split / merge for batch-wise batches (needs D6).
- Minimum days counted from entry into the current stage (movement log), not farm entry date.
- Stage master "applies to sex" setting; checked on create, stage change and transfer (migration — one
  owner for SQL and journal numbering).
- Batch-level "Advance stage" blocked/hidden for animal-wise batches; screen stops sending remarks as an
  automatic override.

## Phase 3 — Data entry and output basics (DONE 9 Oct, A5 reopen reversal closed; A6 maturing and L1 seeded items wait on the client — see decisions.md)

C1 C4 C5 C6 C9 H2 H3 L1 A5 A6 (needs D7).
- OUTPUT lines require an item (remove the "Piglet"/LIVESTOCK fallback); seed gives each output activity
  an item.
- Output posts to a warehouse (farm store, AI station store for semen), generates lot numbers from the
  ITEM_LOT series, expiry from shelf life, and writes a `batch_output_line`.
- Body weight and BCS split into two lines. CONSUMPTION requires `item_id`.
- Reopen reverses the stage/date's postings before re-posting.

## Phase 4 — Sow output: farrowing, piglets, weaning (DONE 9 Oct to the answers on decisions 1 and 2; value of a birth waits on decision 6)

G2 G3 G4 H1 J6.
- Farrowing posts: farrowing record linked to the mating, sow LACTATING, piglet lot / litter, bio-asset
  inventory entry with generated lot, optional mortality for stillborn.
- Weaning posts: weaned piglets transferred to a weaner batch, sow to DRY_SOW, parity set, pre-weaning
  mortality recorded.

## Phase 5 — Boar output: semen lot, inventory, QR (DONE 9 Oct to the answers on decisions 2, 5 and 8; value of a dose waits on decision 6)

G5 G6 G7 G8 I1 I2 I3.
- Collection creates a semen lot with generated lot number, posts doses to the AI station store at cost
  per dose, sets `inventory_posted`, creates the lot QR (boar code/tag, breed, batch, date, doses, expiry).
- AI mating with a semen lot issues the doses and blocks on shortage; `doses_used_internal` updates.
- Cost per dose derived from the boar batch's posted costs; quality fields (volume, motility, conc.).
- Pack numbers use the number series.

## Phase 6 — Animal card and Livestock tabs (DONE 9 Oct except J6 offspring — see decisions.md)

J1–J7 K1–K4.
- Movement / History / Location tabs read `animal_movement_log` (decisions.md 8 Sep).
- Weight endpoint from BODY_WEIGHT daily data; ADG; current weight.
- Outputs (litters, semen lots), per-animal feed and medicine, mortality cause, offspring.
- Re-check Facility and Analytics numbers against the corrected counts.

## Cross-cutting

- No new schema in Phase 1. Any migration in later phases: one owner, review generated SQL, never edit
  `dist/drizzle`.
- Each phase: tests first for pure rules, shared posting path, drive the app, read MySQL, record in
  `docs/decisions.md` anything that interprets a document.

## Phase 7 — Audit fixes and output from data entry (DONE 9 Oct — verified live, see decisions.md; screen not browser-driven)

Asked by Arun: fix the audit gaps 20–23 (yes to the sow going to Dry Sow at weaning), and make data entry a
working place to take output out of a batch — the user chooses which item comes out (piglets from a sow, semen
from a boar, any item from a batch-wise batch) and the posting is the real one (piglet lot / semen lot + QR / stock).

7.1 Every stage a live animal occupies has a scheduler (gap 20). `syncAnimalWiseCounts` — the place every death,
    transfer and stage move already ends — first creates (or reopens) the batch's scheduler for any stage code its
    live animals hold and no open scheduler covers, then counts. Covers a transfer into another batch and a stage
    move inside a batch alike.
7.2 Weaning moves the sow to the Dry Sow stage (gap 21) through `AnimalService.transitionStage` (same checks and
    movement log as the card), when her batch is animal-wise and her company has a `DRY_SOW` stage. Her status stays
    ACTIVE (status `DRY` is set nowhere today and several screens count ACTIVE/PREGNANT/LACTATING — recorded in
    decisions.md as ours). No Dry Sow stage → she stays where she is and the message says so.
7.3 A batch-wise batch's closing quantity is set to its opening head when it is activated (gap 22).
7.4 A bio-asset acquisition ledger row carries the input line's lot number (gap 23).
7.5 Drafts keep what the user chose: `batch_daily_data.item_id` and `destination_batch_id` (migration 0148); both
    posting paths (batch day, stage day) pass them through. Also fixes a TRANSFER line saved as a draft losing
    its destination when the day is posted (found while planning; prove live).
7.6 Output item chosen at entry: `item_id` on the daily-data entry, OUTPUT lines only. The line's item is the
    default; an OUTPUT line no longer needs an item to be defined (the seeded output activities, L1), but an entry
    against it must name one. Any active item of the tenant (decision 8).
7.7 Data entry knows what an animal's output is: each animal in the stage view carries `output_event`
    (SEMEN / FARROWING / WEANING with its open litter: lot, head on hand) from the same rule the posting uses.
    A weaning entered in data entry may name a destination batch (the weaned head move there, as on Breeding).
7.8 Web: OUTPUT rows get an item picker (defaulting to the line's item), the animal's output label
    ("Semen collection — doses", "Farrowing — live-born piglets", "Weaning — litter 2, LOT-00006, 9 on hand"),
    a destination batch for a weaning, and the posting result (lot / QR pack / piglet batch) after posting.
7.9 Verify: tests; then through the running API — boar semen and sow farrowing → weaning from data entry with a
    chosen item, a batch-wise output with a chosen item, a draft TRANSFER posted by post-day, a transfer and a stage
    move landing on a stage with no scheduler, weaning → Dry Sow; read MySQL; restore.

## Test data and walk-through (9 Oct)

`pnpm nx run api:db-seed-output-linkage-test` (plan / `--verify` / `--apply`, `--date=`) builds a fresh, dated set of
TEST batches on MUL100 through the services — sow herd, gilt pool, boar stud, two head-count weaner batches, two open
litters as piglet lots and one semen lot — so every changed flow is one step away in the app. The step-by-step check
is `docs/TESTING-2026-10-09-batch-output-linkage.md`; each of its scenarios was run through the API on the seeded data
before it was written down, then the seeded state was restored. Applied to local `nf_devco` for 2026-10-09.

## Phase 8 — The points still not done (DONE 9 Oct — verified live, see decisions.md; screens not browser-driven)

From the audit of A1–L4: A7, C7, E5 (+ the rest of E1), F5, G7, G8, G9, H4, H5, I3, J6, L2. Order is by how much each
changes numbers today. Anything that settles a client question is built to the document that specifies it, or labelled
ours in decisions.md and left for Rishi to confirm.

8.1  A7  Real errors are no longer swallowed. The `catch {}` fallbacks in batch.service.ts were for unit-test mocks;
         they now swallow only a mock's missing method (a TypeError) and let a database or scope error through. Bulk
         daily entry no longer invents a 1-head batch when the batch is not found.
8.2  F5  A death in an animal-wise batch writes the animal's own book value out of her animal-level bio-asset ledger
         for a bio-asset batch too (it was done only for cost-accumulated batches, so a dead sow kept her 28,000).
         The batch's accumulated cost keeps its per-head share write-off. New finding, for decision: a registered
         animal stays in livestock stock after registration and nothing takes her out at death or sale.
8.3  C7  A recorded death can be reversed — the animal chosen explicitly: she is live again, the batch head, bio-asset
         state and ledgers, the write-off journal and the stage counts are put back, and the movement log says so.
         API `POST /batch/:id/mortality/:transactionId/reverse`; a Reverse action on the Mortality panel.
8.4  E1/E5 Every exit of a registered animal from an active batch (sold, slaughtered, transferred, culled) keeps the
         batch in step: head, stage counts, movement log. Culling built to BBP-1: an out-of-production date, then a
         cull date not before it, a CULL reason, the destination and the weight; the animal's book value leaves her
         ledger; an INFO alert when she has been out of production more than 14 days without being culled.
         Migration 0149. Whether culling is in scope is still Rishi's (decisions.md "Is the cull flow in scope?").
8.5  G9  A farrowing is linked to its mating: the sow's open mating is found and linked; with none, the farrowing is
         refused ("record the mating first"). The boar's litters then show through his matings.
8.6  J6  The card's offspring: a sow's litters (piglet batch, lot, head now) and any registered animal she or he is
         recorded as parent of; the sire comes through the mating.
8.7  G8  Semen quality on the collection — volume (ml), motility (%), concentration (million/ml): Breeding form, card,
         QR. Migration 0150. From data entry, a same-day SEMEN_MOTILITY reading for the boar is carried onto the lot.
8.8  G7  The period costs behind a dose are worked out from what was posted when they are not typed: the boar's own
         feed and medicine shares, his share of the batch's overheads, his posted amortisation, over the period since
         his last collection. Cost per dose = total / doses. The stock value of doses stays nil (decision 6).
8.9  I3  Pack numbers come from a QR_PACK number series, started for each company after its highest pack. Migration 0151.
8.10 H4  The DESCRIPTIVE and OVERHEAD rows stay in inventory_ledger (TDD "Transaction Ledger Structure", Row 11); every
         stock, lot, FIFO and valuation reader is checked to exclude them, and any that does not is fixed.
8.11 H5  Semen stock moved between stores by stock transfer, lot kept — proved live, fixed if not.
8.12 L2  Demo data: stage sex set for the demo (ours: sow and gilt stages female, Boar AI male), the demo boars moved out
         of Gestation to Boar AI, and the demo seed no longer puts boars in Gestation. Data script, plan/verify/apply.

Verify: unit tests for each rule; then every flow through the running API on the seeded test data, read in MySQL;
restore. The test-data script and the walk-through gain the new flows.
