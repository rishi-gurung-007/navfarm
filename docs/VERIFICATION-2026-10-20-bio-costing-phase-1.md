# Verification — bio-asset costing, Phase 1 (X1, X2, X3, X4)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` §3 · **Phase 0:** `docs/VERIFICATION-2026-10-20-bio-costing-phase-0.md`
**Method:** API built from the working tree (`pnpm nx build api`, bundle grepped for the new strings), started with
`preview_start api` on :2877, logged in as the seed tenant admin through `POST /api/v1/auth/login`. Every write was made
through the API and read back from `nf_devco`. Nothing is committed.

## What changed

| Fix | Change | File |
|---|---|---|
| X1 | `ensureBioState` opens a MATURE herd at the sum of its `bio_asset_ledger.cost_amount`; with nothing there it refuses (400) and creates no state row. The `heads x 28000` is gone. Pre-mature still opens at nil | `batch.service.ts` (`ensureBioState`) |
| X2 | `amortizeBioAsset` refuses a date before `matured_at`, refuses once the useful life is used up (calendar month index >= `productive_life_months`), caps the charge at carrying value minus residual (a residual below 0 reads as 0), refuses when nothing is left; journal, ledger row and state use the same capped, rounded figure (the `max(0, ...)` floor is gone) | `batch.service.ts` |
| X3 | `recordFairValue`: pre-mature herd posts transaction type `BIO_FAIR_VALUE_PREMATURE` (Dr 1050 / Cr 4020); a mature herd's `monthly_amortization_rate` is recomputed as `(new carrying - residual x head) / runs left / head`, runs left = life - AMORTIZATION ledger rows; negative fair value refused (DTO `@Min(0)` + service guard); gain/loss rounded once and used for journal, ledger and state | `batch.service.ts`, `batch.dto.ts` |
| X4 | `assertPostingPeriodOpen` on mature, amortise, fair value, dispose and the bio-asset mortality branch | `batch.service.ts` (`assertBioPeriodOpen`) |
| data | `BIO_FAIR_VALUE_PREMATURE` added to the starter GL seed, the GL-mapping API enum, the master-data picker and the guard spec; script `db-align-bio-fair-value-premature` (read-only by default, `--verify`, `--apply`) adds it to an existing tenant, taking the debit from the same scope's `BIO_TRANSFORMATION` credit | `starter-master-data.seed-data.ts`, `gl-mapping.dto.ts`, `configs.ts`, `scripts/align-bio-fair-value-premature*.ts`, `apps/api/package.json` |

`--apply` was run on `nf_devco` (one row, GLMAP-031, Dr 1050 / Cr 4020; a second run reports "already has a pre-mature
mapping"). **That row is the only permanent change to the database.**

## Proof, API then MySQL (batch ids: B4 = BATCH-000004 mature, 42 head; B2 = BATCH-000002 pre-mature; B3 = BATCH-000003)

| # | Call | Result | Rows written |
|---|---|---|---|
| X2a | `POST /batch/B4/amortize` dated 2026-09-30 (batch matured 2026-10-19) | 400 "Amortization cannot be dated 2026-09-30 - the batch matured on 2026-10-19." | none (ledger max 158, journals 16) |
| X2b | same, dated 2028-07-31 | 400 "The useful life of 21 months from 2026-10-19 is complete" | none |
| X2c | same, dated 2026-10-20 | 201. State 373 838.0233 -> 373 813.5394; ledger -24.4839; JE-000017 Dr 5100 / Cr 1060 24.4839 (= 0.582949 x 42) | one number in three places |
| X2d | fixture: residual/unit set to 8 899.9 (room = 17.7394), run dated 2026-11-30 | 201. Charge **17.7394**, not the scheduled 24.4839; state 373 795.8000 = residual x 42 exactly; ledger and JE-000018 the same | one number in three places |
| X2e | same, dated 2026-12-31 | 400 "Nothing to amortize - the carrying value is already at the residual value." | none |
| X3a | fixture reverted; `POST /batch/B4/fair-value` 9 000/unit | 201. State 373 795.8 -> 378 000; **rate 0.582949 -> 500.000000** (= 378 000 / (21 - 3 runs) / 42); ledger +4 204.2; JE-000019 Dr 1060 / Cr 4020 | |
| X3b | `POST /batch/B2/fair-value` 60/unit (pre-mature, 2 head, 97.5 -> 120) | 201. JE-000020 **Dr 1050 / Cr 4020 22.5** | rate stays NULL |
| X3c | same at 40/unit (120 -> 80) | 201. JE-000021 **Dr 4020 / Cr 1050 40.0** (loss, reversed direction); state 80.0000 | |
| X3d | `fair_value_per_unit: -5` | 400 "Fair Value Per Unit must be 0 or more." | none |
| X4 | two reporting periods created via `POST /reporting-period`, set CLOSED by SQL (see below); amortise, fair value, dispose and mortality dated 2026-09-15; mature on 2026-10-20 | each 400 "Reporting period ... is closed. Nothing dated ... can be posted into a closed period." | none (ledger 163, journals 21 unchanged across all five) |
| X1a | fixture: B3 (no state row, no ledger rows) stage set to GESTATION; `POST /batch/B3/transaction` OBSERVATION | 400 "Batch BATCH-000003 has no carrying value on its bio-asset ledger, so its mature herd cannot be opened." | no state row |
| X1b | fixture: one ACQUISITION ledger row of 25 000.5 for B3; same call | 201. State created **MATURE, qty 1, nca 25 000.5000** (the old code writes 28 000) | |

**Fixtures, all reverted by SQL afterwards:** the residual change (X2d), the two closed periods (closing through the app needs
a posted stock take for every farm, which is not what this phase tests), B3's stage and its ledger row, and everything the
calls wrote (journals JE-000017..21 and their lines, ledger entries 159..164, the B3 state row, one OBSERVATION and the
scheduler header it auto-created, the audit rows, the journal number series back to JE-000016, B2 and B4 state back to
their stored values). Read back after the revert: ledger max 158, journals 16, audit 128, `reporting_period` 0 rows, B2
97.5, B4 373 838.0233 / rate 0.582949 / residual -12, B3 no state row and stage NULL. A pre-run dump of the touched tables
is in the session scratchpad (`phase1-before.sql`).

## Tests (support only, not evidence)

`pnpm nx test api`: 277 suites, 3 535 tests, all passing; new specs for X1, X2, X3, the residual floor, and the planner
for the mapping script. `pnpm nx run api:typecheck`: 23 errors, all in other people's spec files, none in files touched here.
`pnpm nx test web`: 4 suites fail (`reason-master`, `breeding-rules`, `requisitions-hub`, `requisitions-panel`); they do
not touch GL mappings and the only web edit is one picker option.

## Findings and limits

1. **BATCH-000004 carries a residual per unit of -12.** Nothing stops `matureBioAsset` accepting a negative residual. The new
   code reads it as nil; the input itself is not validated yet (V6 territory, Phase 3/4).
2. The pre-existing JE-000014 (12 Aug, before maturity) is untouched: Phase 1 prevents a new one, it does not repair history.
3. `monthsBetween` counts calendar months, so a herd matured on the 31st gets the same number of runs as one matured on the 1st.
4. The fair-value rate uses AMORTIZATION ledger rows as "runs done"; a skipped month is therefore still owed, not forgiven.
5. Not touched, as planned: death double-write (Phase 2), costs to sell (D5), the 205.50 ledger-not-in-GL gap (Phase 4b).
6. Tenants other than `nf_devco` need `pnpm nx run api:db-align-bio-fair-value-premature -- --database=<name> --apply`
   before a pre-mature fair-value entry will post; without the mapping it is refused with the existing "No GL mapping" message.
