# Verification — bio-asset costing, Phase 4, part 1 (the run engine: Calculate, Post, Reverse)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` §2.2, §2.4, §2.5 · **Earlier:** Phases 0–3 (committed as `e829e1be`)
**Method:** migration 0210 applied to both tenants after full backups; API rebuilt and driven with the seed tenant admin through `POST /api/v1/auth/login`; every
write made through the API and read back from `nf_devco`. Afterwards `nf_devco` was restored from the pre-migration backup and migrated again: it holds the new empty
tables and none of the test data. Nothing in this phase is committed.

**What this part is, and is not.** It is the engine: tables, arithmetic, validations, the journal and the ledger rows, and the API. It is **not** the Finance page, the
batch endpoints becoming wrappers, the death/sale entries that clear accumulated amortisation, or the registration posting; those are listed in §5.

## 1. What was built

| Piece | What it does | Where |
|---|---|---|
| Tables (0210) | `bio_costing_run` (header: profile, period, status, totals, journal), `bio_costing_run_line` (per animal: days, book value before / after, residual, charge, why skipped), `bio_asset_ledger.run_id` | `drizzle/tenant/0210_*.sql`, `schema.ts` |
| Engine (pure) | `periodFor / periodOfKey` (ISO weeks, months, quarters, years), `amortisationLine`, `fairValueLine`, `pickRate`, `amortisationAmount` (**D11 is this one function**) | `finance/bio-costing/bio-costing.engine.ts` |
| Service | `calculate`, `post`, `reverse`, `findAll`, `findOne` | `bio-costing-run.service.ts` |
| API | `POST /bio-costing/runs/calculate`, `POST /runs/:id/post`, `POST /runs/:id/reverse`, `GET /runs`, `GET /runs/:id`; permission `FINANCE / JOURNAL` | `bio-costing-run.controller.ts` |

How a run works: **Calculate** builds a line for every animal costed by the profile (book value from her own ledger as at the period end) and writes nothing to the
ledger or the GL; repeating it replaces its own preview. **Post** recalculates on the books as they stand, writes one ledger row per charged animal, posts one journal
(grouped by business line), checks that lines, ledger and journal are the same number, and only then commits. **Reverse** mirrors the ledger rows, reverses the journal and
frees the period.

## 2. Proof, API then MySQL

Profiles used: the client's imported female (week 33, 36 months, 150 kg × 2.05, females only) and local female (fair value, 150 kg × 2.05), activated through the API with
a stand-in `P4-ACCUM` account (the chart has no accumulated-amortisation account).

| # | Call | Result |
|---|---|---|
| 1 | Calculate IMP-F, September 2026 | DLNA8228: book value as at 30 Sep **411.55** (her feed dated October is not in it), residual 307.50, 30 days over **38** remaining, charge **82.1447** = (411.55 − 307.50) × 30 ÷ 38. NB0552 (cost 300.00): `RESIDUAL_EXCEEDS_COST`. **Ledger max 158, journals 16, ledger rows with a run id 0: a preview writes nothing** |
| 2 | Post it | line **82.1447**, ledger `AMORTIZATION` **−82.1447** (no `batch_id`), JE-000022 **Dr 5100 / Cr P4-ACCUM 82.1447**, register cache 430.30 → 348.1553 (all-time), `total_amortised` 82.1447, the line holds `animal\|AMORTIZATION\|2026-09`. One number in four places |
| 3 | Same period again · post the posted run again | 400 "already been run for IMP-F (BCR-2026-00001)" · 400 "already posted"; nothing written |
| 4 | October (ends 31 Oct) · a date in 2027 | 400 "has not happened yet" (V4) |
| 5 | A period behind a posted later one · a key that is not monthly · an unknown profile | 400 "a period cannot be run behind a later one" · 400 "not a monthly period" · 404 |
| 6 | August with a CLOSED reporting period over it (created through the API, closed by SQL) | 400 "Reporting period P4-PROOF … is closed" (V5) |
| 7 | Reverse with no reason · with one · again | 400 "Reason is required" · REVERSED: ledger rows −82.1447 and +82.1447 (net **0.0000**), JE-000023 "Reversal of JE-000022", the period freed (0 lines claiming it), cache back to 430.30 · 400 "only a posted run can be reversed" |
| 8 | Calculate the freed period again | new run BCR-2026-00002 |
| 9 | August then September, posted in order | August: (392.80 − 307.50) × 30 ÷ 69 = **37.0870** ✓. September: book value before **374.463** (392.80 + 18.75 feed − 37.087), (374.463 − 307.50) × 30 ÷ 38 = **52.8655** ✓. The preview had said 82.1447: **Post recalculates**, so the posted number is the one from that moment |
| 10 | Reverse August while September stands | 400 "reverse the latest run first"; then September, then August: both nets 0.0000 |
| 11 | Fair value, LOC-F, September | five losses against 150 × 2.05 = **307.50** (−42.50, −12.50, −9.00, −11.25, −41.25); Q-TN70-01 `NOT_STARTED` (her week 33 is 18 Oct). Ledger `FAIR_VALUE_ADJMT` rows total **−116.50**; JE-000026 **Dr 4020 / Cr 1060 116.50** |
| 12 | `db-check-bio-asset-reconciliation` after the runs | cache differs from ledger: none; departed not at nil: none; batches that differ: none |
| 13 | Bypass the service: insert a second line for the same animal, method and period; a second header for the same profile and period | MySQL 1062 on `uq_bio_costing_run_line_active` and `uq_bio_costing_run_active` |
| 14 | Calculate September with `days_enforced: 45` | 45 days over 38 remaining would be 150.05; the charge is held at **104.05** so DLNA8228 lands exactly on the 307.50 residual |

Restore: pre-0210 backup reloaded, 0210 re-applied; read back 210 migrations, 0 runs, 0 profiles, ledger max 158, 16 journals, `P4-ACCUM` gone, 0 reporting periods,
GLMAP-031 still present.

## 3. Tests

`pnpm nx test api`: **282 suites, 3 612 tests, all passing** (new: 22 engine cases including the client's worked example, 8 run-service guard cases). The client's example
reproduces under the BBP's reading: born 2025-10-05, start +231 days, life +1095 days, **864 days**, (3000 − 307.50) × 30 ÷ 864 = **93.4896**; the workbook's own cell
(residual × days ÷ total = 10.68) is kept as a test so D11 stays visible. `api:typecheck`: the same 23 spec-file errors as before, none in this phase's files.

## 4. Choices made, and what to watch

1. **Life is counted from birth in 365-day years** (36 months = 1095 days, the sheet's `B54 = B43 + 1095`), not in calendar months; this reproduces 864 exactly. Non-whole years round (18 months = 548 days). The plan said calendar months; the sheet is the only statement.
2. **The 30-day basis drifts slightly.** A month counts 30 days against a remainder measured in real days, so each charge is a little larger than the last (the second month is within 1% of the first) and the last period takes whatever is left. `ACTUAL` is exactly constant per day. This is the sheet's own mixed basis (30 / 360 frequency days, 365-day life); it is D11 territory.
3. **The ledger rows carry no `batch_id`.** The batch figure and the GL hold capitalised cost only (D8); amortisation of the purchase price must not reduce them. The reconciliation script therefore never sees run rows in its batch check.
4. **Posting date = the last day of the period.** Run numbers are `BCR-YYYY-NNNNN` (no number series yet). Scheduled runs will use the same service with `trigger = SCHEDULED`.
5. **A period cannot be run behind a later posted one** (book values carry forward). Ours; the documents are silent.
6. **A profile's real data raises a client question.** The residual 307.50 is larger than the purchase price of most animals in `nf_devco` (300 each; NB0552 is skipped for it). With the BBP's own control ("residual value exceeds carrying amount") those animals never amortise. The documents' 150 kg × 2.05 is the "current working formula"; whether it should apply to an animal bought for less is for the client.

## 5. Not done in Phase 4 (next parts)

- **The Finance page** (Calculate, review the lines and skips, Post, Reverse).
- **Batch endpoints** `/batch/:id/amortize` and `/fair-value` as one-batch wrappers over this engine; costs-to-sell exposure on the old fair-value call (D5).
- **Death and sale clearing accumulated amortisation** (BBP S.NO.7–8: Dr accumulated amortisation on a write-off; reverse amortisation and fair-value adjustments to the transfer date). Until then an animal that leaves keeps a credit in the accumulated-amortisation account.
- **Registration posting to the GL and the accumulated-amortisation / impairment accounts (D8, Finance).** Until the gross cost is in the GL, the net asset in the GL is not meaningful, as the plan said.
- **An animal that leaves mid-period** is charged the whole period or none (`NOT_ACTIVE` only if gone before the period began); the BBP wants amortisation to the transfer date.
- **Batch-tracked profiles** (weaners, growers) are refused by the run; they need the batch engine.
- **Not exercised live:** the "does not reconcile" abort in Post (the three figures are computed from the same lines, so it did not occur) and the weekly, quarterly and yearly period keys (unit-tested only).

---

## 6. Part 2 — clearing accumulated amortisation when an animal dies

**Why.** The runs credit an accumulated-amortisation account. The BBP's death entry for a breeding asset (S.NO.7) is *Dr Mortality / Impairment Loss, Dr Accumulated
Amortization where applicable, Cr Acquisition Cost*. The death journal that already existed is the loss leg (the animal's capitalised cost). The accumulated-amortisation leg
was missing, so an animal that died kept her credit in the account for ever.

**What was built.** `BioCostingExitService.clearOnDeath` (called from the death path, after her single ledger write-off): finds the animal's profile, sums what the runs have
amortised her to the death date, and posts **Dr accumulated amortisation / Cr acquisition cost** for that amount, on her business line, dated the death, source document type
`BIO_ASSET_EXIT`. It does nothing for an animal no profile costs, one costed by fair value, or one never amortised; a retry finds the first journal and posts nothing; a
death inside a closed reporting period is refused; a profile that has amortised her but lacks the accounts raises an error instead of leaving the credit standing silently.
The entry leaves the net asset unchanged (the contra and the gross fall together).

**Proof (API then MySQL).** IMP-F active, August and September posted for DLNA8228 (37.0870 + 52.8655): account `P5-ACCUM` (a stand-in; the chart has none) at a **89.9525
credit**.

| Step | Result |
|---|---|
| Control: NB0552 dies (never amortised, cost 300 under the 307.50 residual) | no exit journal, journal count unchanged (18): nothing to clear |
| DLNA8228 dies via `POST /batch/BATCH-000001/mortality` | JE-000024 (the existing leg) Dr 5010 / Cr 1050 **37.50** (her own feed); **JE-000025 `BIO_ASSET_EXIT` Dr P5-ACCUM / Cr 1060 89.9525**, dated 2026-10-20 |
| The account afterwards | credit balance **0.0000** (was 89.9525); her ledger book value 0.0000, register cache 0.0000 |
| Exit journals in the database | exactly 1 |

Restored from the pre-run backup afterwards: 210 migrations, 9 animals alive, ledger max 158, 16 journals, no exit journals, no fixture account.
Tests: `pnpm nx test api` 283 suites, **3 618 tests**, all passing (new: five exit-service cases, one death-path case); typecheck at the baseline of 23 spec-file errors.

**Not done, and why.**
- **A sale, cull, slaughter or transfer.** Three different entries are in the client's documents: BBP S.NO.8 reverses the amortisation to the transfer date (Dr accumulated amortisation / Cr amortisation expense) when an animal goes to inventory; the GL-structure sheet's "Sale to customer" clears it against cost of sales (Dr accumulated amortisation / Cr cost of sales); a death absorbs it into the loss, as above. `AnimalService.dispose` posts **no journal at all** for a sale today, so these need the sale posting built, a cost-of-sales account, and the client to say which route a sold breeding animal takes.
- **Fair-value adjustments at an exit.** BBP S.NO.8 reverses them on transfer to inventory so that stock is recognised at cost; a death writes off the carrying value including them. Left with the sale entries.
- **The loss on the acquisition cost** and the credit to the acquisition account for the gross cost wait for the registration posting (D8). Until then the death's loss in the GL is the capitalised cost only, and Cr acquisition carries the amortisation clearing alone.
- **A death on the plain register path** (`AnimalService.dispose` DIED with no active batch) posts no mortality journal either, so it clears nothing; it should be given the whole BBP entry together.
- **An animal that dies mid-period** is not amortised for the days before death: after her death her book value is nil, so the run skips her. *Correction (see §7):* the BBP asks for amortisation "up to the transfer date" only for a transfer to inventory or a sale (S.NO.8); for a death (S.NO.7) it writes off the carrying value as it stands, so this is consistent with the BBP for deaths.


---

## 7. Part 3 — the Finance screen and the batch path (Phase 4 completed as far as the client allows)

**The screen.** *Finance > Bio-Asset Costing Runs* (`/finance/bio-costing-runs`): choose a profile and any date in the period (the profile's frequency decides the period), optionally
enforce a number of days, **Calculate**; read every animal's line with each skip said in words (before the start age, residual exceeds book value, fully amortised, no rate, and so
on); **Post** (after a confirmation that says Post recalculates on the books as they stand); **Reverse** (needs a reason). A runs list opens any earlier run. It does no arithmetic;
it shows what the API answers, and the API's refusals appear in the toast. Buttons are disabled without `FINANCE / JOURNAL / create`. It sits in the Finance section list, the
sidebar's Finance flyout and the shell's title branch; the `finance-sections` guard spec lists it. English strings only (the other languages fall back to English).

**The batch path.** `POST /batch/:id/amortize` and `/fair-value` now refuse a registered-animal herd when any of its animals has a costing profile, naming the screen to use. Without this
the same animals would be charged twice, once by the batch path (which credits the mature asset account directly) and once by the runs (which credit accumulated amortisation).
Count-only herds, and registered herds with no profiled animal, are untouched. I called this "wrappers" in the plan; it is a guard, because the batch path holds a herd's value in
`batch_bio_asset_state` and the engine holds it per animal: there is nothing to wrap.

**Proof.** API: with IMP-F active and two animals assigned, BATCH-000001's amortise and fair-value calls each return 400 "its animals are costed one by one by their costing profiles. Use
Finance > Bio-Asset Costing Runs, so no animal is charged twice"; ledger max 158 and 16 journals unchanged; BATCH-000004 (count-only) still reaches its own rule ("cannot be dated before the
batch matured"). Browser (the real app on :3002, API on :2877): logged in as the seed tenant admin, opened the page, the profile preselected and the date defaulting to the last finished
month, **Calculate** showed BCR-2026-00001 *Calculated*, 2 animals, 1 charged, 1 skipped ("Residual exceeds book value"), total amortisation 82.14, DLNA8228 411.55 before, 30 days, 38 left;
MySQL showed no ledger rows with a run id and 16 journals (a preview writes nothing). **Post** opened the confirmation; confirming gave the toast "Run BCR-2026-00001 posted", the badge
*Posted* and a Reverse button; MySQL: status POSTED, ledger −82.1447, journal Dr 5100 82.1447 / Cr the accumulated-amortisation account 82.1447. **Reverse**: the dialog's button was
disabled with no reason and enabled once one was typed; the toast "Run BCR-2026-00001 reversed", the badge *Reversed* and the reason on the page; MySQL: REVERSED, the reason stored, ledger net
0.0000, one reversal journal, period freed. A Calculate for October (unfinished) sent the request and the API answered 400 (the app's toast lasts a second; I confirmed the 400 in the network log, not the toast on screen).
`nf_devco` was then restored from a backup taken just before.

**Tests.** `pnpm nx test api`: **283 suites, 3 621 tests**; `pnpm nx test web`: 6 new panel cases and the updated finance-sections guard pass; the same 4 pre-existing web suites fail (`reason-master`,
`breeding-rules`, `requisitions-hub`, `requisitions-panel`); `web:typecheck` clean; `lint web` at its accepted baseline of 85 errors, none new; `api:typecheck` at the 23 spec-file errors.

### What Phase 4 still cannot finish, and who holds the key

| Item | Blocked on |
|---|---|
| Sale, cull, slaughter, transfer entries | The client: which of three routes a sold breeding animal takes (reverse amortisation to the transfer date / clear against cost of sales / write off), a cost-of-sales account, and building the animal sale posting itself, which does not exist |
| Fair-value adjustments reversed at a sale (BBP S.NO.8) | The same |
| Registration posting to the GL, and the loss/gross legs of a death | D8 (client and Finance): how the existing 659 686.80 is brought in |
| The real accumulated-amortisation and impairment accounts | Finance; every profile so far used a stand-in account |
| The amortisation formula's final form | D11; one function in `bio-costing.engine.ts` |
| Costs to sell | D5; the field already exists on a fair-value rate row |
| Batch-tracked profiles (weaners, growers) | A separate build: they need the piglet item and a batch engine |
| The page in other languages | Translation, not engineering |
