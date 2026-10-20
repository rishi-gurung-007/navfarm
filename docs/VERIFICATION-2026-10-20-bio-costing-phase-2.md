# Verification — bio-asset costing, Phase 2 (ledger-derived book value; one death write-off)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` §2.3, X5 · **Earlier:** Phase 0 and 1 notes in `docs/`
**Method:** the API was rebuilt from the working tree and driven with the seed tenant admin through `POST /api/v1/auth/login`
(`preview_start api`, :2877). Every write was made through the API and read back from `nf_devco`. After the proofs the touched
tables were put back from a pre-run dump. Nothing is committed.

## 1. The defect, reproduced before any change (Phase 1 build)

One death through `POST /batch/BATCH-000002/mortality` for animal P2975 (acquisition 300.00 + 97.50 of capitalised feed = 397.50):

| | Ledger rows with her `animal_id` | Her ledger sums to | Journal | Batch carrying value | Register cache |
|---|---|---|---|---|---|
| **Before** | MORTALITY −48.75 (the batch's per-head average, 97.5 / 2) **and** MORTALITY −300.00 (the cached acquisition) | **+48.75** (a dead animal still on the books) | Dr 5010 / Cr 1050 **48.75** | 97.50 → **48.75** (half of *her* feed left with the animal still alive) | 300.00 (unchanged) |
| **After** | MORTALITY **−397.50**, one row | **0.0000** | Dr 5010 / Cr 1050 **97.50** (her own feed) | 97.50 → **0.00** | **0.00** |

So the "death can double-write" finding (plan §1.3-3) is **confirmed**, and it was worse than a double row: the batch average also
left the wrong animal's feed in the herd.

## 2. What changed

| Piece | Change | Where |
|---|---|---|
| Derived value | `AnimalBookValueService`: `valuesFor / valueOf / refreshCache`, a pure `summariseAnimalValue`. Book value = the sum of an animal's `ACQUISITION, CONSUMPTION, OVERHEAD, OVERHEAD_COST, GROWTH_ADJMT, AMORTIZATION, FAIR_VALUE_ADJMT, MORTALITY, WRITEOFF, TRANSFORMATION` rows; `PURCHASE` and `TRANSFER_IN/OUT` do not count. `hasRows` tells "nil" from "unknown" | `inventory/bio-asset-ledger/animal-book-value.*` |
| Card | `AnimalService.findOne` overlays the derived `book_value`, `total_amortised`, `current_bio_asset_value` | `animal.service.ts` |
| Locked | The three figures leave `UpdateAnimalDto` (the global pipe answers "X is not a field this form accepts") and the update path; the master form hides them | `animal.dto.ts`, `animal.service.ts`, `configs.ts` |
| Cache | Refreshed in the same request as every animal-ledger write this phase touches (consumption, overhead, death, sale/cull, day reversal) | `batch.service.ts`, `animal.service.ts`, `batch-day-reversal.service.ts` |
| Capitalised cost per animal | A pre-mature issue is written **one ledger row per share**, with `animal_id` and `document_line_id` = the issue; the single-entry CONSUMPTION and OVERHEAD paths carry `dto.animal_id`. (Before, one batch-level row with no animal: see §5) | `batch.service.ts` (`postConsumptionGroup`, `addTransactionInner`) |
| Day reversal | Mirrors those per-animal rows (found by `document_line_id`), refreshes their cache; an older issue still mirrors as one row | `batch-day-reversal.service.ts` |
| X5, death | A named animal: **one** MORTALITY row = her derived book value (carries `batch_id`); the herd and the journal give up her **own** capitalised cost, not the average (the average remains where the batch has no animal-level cost) | `batch.service.ts` |
| Other exits | `AnimalService.dispose` (sale, cull, slaughter) writes the derived value and computes gain/loss on it | `animal.service.ts` |
| Report | `db-check-bio-asset-reconciliation` (read-only): cache vs ledger per animal, departed animals not at nil, batch figure vs ledger | `scripts/check-bio-asset-reconciliation.ts`, `apps/api/package.json` |

## 3. Proof, API then MySQL

| # | Call | Result |
|---|---|---|
| 1 | `GET /animal/P2975` (cache held 300.0000) | card shows **397.5000** for `book_value` and `current_bio_asset_value` |
| 2 | `PUT /animal/P2975 {"book_value":1}`, then `{"total_amortised":5}` | each 400 "Book Value / Total Amortised is not a field this form accepts."; cache unchanged (300.0000 / 0.0000) |
| 3 | Death of P2975 via `POST /batch/BATCH-000002/mortality` | the "After" row of §1: one row −397.50, ledger sum 0.0000, JE-000022 Dr 5010 / Cr 1050 97.50, herd 97.50 → 0.00, cache 0.00, register DEAD |
| 4 | `PATCH /animal/DLNA8228/dispose` SOLD, value 500 (cache 392.80, ledger 430.30) | TRANSFORMATION **−430.30**; ledger sum 0.0000; `gain_loss_on_disposal` **69.70** (the old cache would have said 107.20); cache 0.00 |
| 5 | `POST /batch/BATCH-000001/transaction` CONSUMPTION 20 KG for P25003 | ledger row 168 **carries her `animal_id`**, cost 10.00; her ledger 333.00 → 343.00; cache **300.00 → 343.00** in the same request; herd 118 → 128 |
| 6 | `db-check-bio-asset-reconciliation` after 1–5 | departed animals not at nil: none; batches that differ: none (BATCH-000002 after the death 0 / 0, where the old death would have left 48.75 unexplained); one stale cache remains (P26302, untouched this session) |

Not driven through the API, covered by unit specs: the per-share rows of `postConsumptionGroup` (two animals, 10 and 20 kg:
rows 2 and 4, one `document_line_id`, carrying value up by the issue once; nothing for a mature herd) and the day-reversal mirror
(each animal's row negated with `source_entry_id`, cache refreshed; the legacy single-row path). Reaching them live needs a posted
daily-data day on an animal-wise batch.

**Restore:** after the proofs the 13 touched tables were restored from the pre-run dump (`phase2-before.sql`, session scratchpad).
Read back: ledger max 158, journals 16, audit 129 (the dump was taken after the login), last journal JE-000016, animals and batch
header identical to the snapshot, batch states as before, and the one permanent row from Phase 1 (GLMAP-031) still there.

## 4. Tests

`pnpm nx test api`: **278 suites, 3 549 tests, all passing** (new: summariser, derived card, five death cases, per-share consumption,
reversal mirror). `api:typecheck`: the same 23 errors in other people's spec files as before; none in files touched here
(`batch-shed.spec` now reads "expected 10 arguments" instead of 9: that spec was already one argument short). `web`: the same 4 suites
fail as in Phase 1 (`reason-master`, `breeding-rules`, `requisitions-hub`, `requisitions-panel`); none touch this change.

## 5. Corrections to earlier notes

1. **Phase 0 §C1 / plan §2.3 said capitalised cost per animal "already has `animal_id`", so no migration.** The migration is still
   not needed, but the reason was wrong: the 120 per-animal CONSUMPTION rows in `nf_devco` were written by a device-data seed script
   (`seed-porta-device-data.ts`). The live consumption paths wrote **one batch-level row with no animal**. That is fixed here for new
   postings; **rows written before this change stay batch-level**, so an animal's derived value for old live data will not include
   her old feed until someone allocates it (Phase 6 backfill, if the client wants it).
2. **The plan said the batch carrying value would become the sum of its animals' values.** It does not: the batch figure and the GL hold
   capitalised cost only, and the animals' acquisition is in neither (D8). So the invariant checked is *batch carrying value = its ledger
   rows other than ACQUISITION, plus the acquisition of animals that have left (their exit row carries it)*. Verified clean on
   `nf_devco`. The plan's V9 is reworded accordingly.
3. **The mortality-reverse endpoint described in `decisions.md` C7 is not in this branch**, so there was nothing to keep in step.

## 6. Limits and open items

- **GL.** A death's journal is the animal's *capitalised* cost only. Her acquisition cost leaves her ledger but never entered the GL,
  so it cannot leave it (D8). Until D8 is built, the loss on a sow's death in the GL is understated by her purchase price.
- **Sale, cull, slaughter** still leave the batch's carrying value and the GL untouched (`decisions.md` E1: how a leaver takes her
  share is open). Only her own ledger row and the gain/loss use the derived value.
- **Cache readers.** Transfers (`batch-transfer.service.ts`) and the financial reports still read the cache columns; they are right
  for any animal touched since this change, and stale for the rest until the backfill. `breeding.service.ts` and
  `batch-transfer.service.ts` write ledger rows this phase did not alter.
- **Old data.** P26302 and the other three animals from Phase 0 still show a stale cache; the card is already right (it reads the ledger).
- **Seeds.** The seed scripts still write per-animal feed rows directly and set cache values; they are demo data and were not changed.
