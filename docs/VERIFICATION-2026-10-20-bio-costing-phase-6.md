# Verification — bio-asset costing, Phase 6 (existing tenants, roll-forward by profile, records)

**Date:** 21 Oct 2026 (work begun 20 Oct) · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md` Phase 6 · **Earlier:** Phases 0–5 in `docs/`
**Method:** `nf_devco` backed up first (`nf_devco-full-before-p6.sql`, session scratchpad). The backfill was run read-only, then `--verify`, then
`--apply`, then read-only again. Four costing runs were calculated and posted through the API, one animal was killed through the batch API, and
the roll-forward report and the trial balance were read back through the API and compared with MySQL. Afterwards `nf_devco` was restored.
Nothing is committed.

## 1. What was built

| Piece | What it does | Where |
|---|---|---|
| Backfill script | Read-only by default; `--verify` writes inside a transaction, reads back and rolls back; `--apply` commits. It does two things only: assigns `costing_profile_id` + `costing_start_date` to animals that have none (using the same pure rules as the API), and refreshes the cache columns that differ from the ledger. It never runs a costing period, never edits a ledger row or a journal | `scripts/backfill-bio-costing.ts`, nx target `db-backfill-bio-costing` |
| Report-only findings | Batch-level capitalised cost with no animal on it, dead animals still carrying amortisation, animals with no ledger rows. Printed, never changed | same |
| Roll-forward by profile | Opening, acquisitions, capitalised cost, amortisation, fair value, exits and closing per profile; animals with no profile and batch-level rows are shown on their own lines so the total still equals the report's closing | `bio-costing-report.rules.ts`, `financial-reports.service.ts` |
| Tie-out to the trial balance | For each GL role of the active profiles (amortisation expense, accumulated amortisation, fair-value gain/loss): the ledger's figure from costing-run rows, the GL's figure from `BIO_COSTING_RUN` journal lines, the difference | same |
| Screen | *Bio-Asset Reconciliation* gets "By costing profile" and "Costing ties to the trial balance" sections, with a variance banner | `bio-asset-roll-forward-panel.tsx`, `translations.ts` |

## 2. Backfill, proof on `nf_devco`

| # | Step | Result |
|---|---|---|
| 1 | Read-only plan (first run) | **0 of 9 assigned: a bug.** mysql2 returned `effective_from`, `dob`, `entry_date` as JS dates and the rules compare `YYYY-MM-DD` strings, so every comparison failed quietly. Fixed with `dateStrings: true` on the connection |
| 2 | Read-only plan (fixed) | 8 assigned: DLNA8228, NB0552 → IMP-F (start 2024-05-28); six local females → LOC-F. **PIG-2023-0001 (male, bought local)** has no LOC-M profile and stays unassigned: `NO_MATCHING_PROFILE`. 4 caches differ from the ledger (e.g. P25003 cache 300.00, ledger 333.00). Report-only: BATCH-000001 holds 5.00 of capitalised cost with no animal on it. `costing_runs_made: 0` |
| 3 | `--verify` | prints the same plan and "Rolled back; no changes committed." Read back from MySQL afterwards: 9 animals, 0 with a profile, cache total 659 686.80, as before |
| 4 | `--apply` | "Committed." 8 animals now carry a profile and a start date; the four stale caches equal their ledger (P25003 333.00, DLNA8228 430.30, P2975 397.50, P26302 337.50). The male is untouched |
| 5 | Plan again | assign 0, refresh 0, not assigned 1: **idempotent** |

## 3. Roll-forward against the trial balance, proof

State built through the API: IMP-F (amortisation) and LOC-F (fair value) active; runs for **Aug and Sep 2026** calculated and posted for both
(BCR-2026-00001…00004, journals JE-000022…25, ledger rows carry `run_id`); then DLNA8228 (IMP-F, accumulated amortisation 89.9525) died through
`POST /batch/:id/mortality` dated 2026-10-20.

| Check | Ledger / report | GL / trial balance | |
|---|---|---|---|
| Death write-off row | MORTALITY **−340.3475** = her derived book value after amortisation | | one row |
| Exit journal | | JE-000027 `BIO_ASSET_EXIT` Dr P8-ACCUM / Cr 1060 **89.9525** | accumulated amortisation cleared |
| Amortisation expense, 1 Aug – 20 Oct | 89.9525 | 5100 run lines 89.9525 (JE-000022 37.0870 + JE-000024 52.8655) | difference 0 |
| Accumulated amortisation, to date | 0.0000 (the dead animal is excluded) | P8-ACCUM debit 89.9525 = credit 89.9525, net 0 | difference 0 |
| Fair-value gain/loss, period | −116.5000 | 4020 run lines net −116.5000 (credit minus debit, as read back from `journal_line`) | difference 0 |
| 5100 whole account | | 108.0239 = 89.9525 run + **18.0714 batch-level** | agrees with the report's BATCH_LEVEL line −18.0714 |
| Variance is shown | JE-000024's debit raised by 5.00 by SQL | the report said **ledger 89.9525, GL 94.9525, difference 5, not reconciled**; put back, then identical to above | the tie-out can fail |

By profile (1 Aug – 20 Oct): IMP-F opening 692.80 + capitalised 37.50 − amortisation 89.9525 − exit 340.3475 = closing 300.00; LOC-F opening
1 870.00 + 168.00 − fair value 116.50 → 1 921.50 (the sign convention is the ledger's); animals with no profile 657 124.00 (PIG-2023-0001's value); batch-level −8 888.41 → 373 843.02. The four lines add up to the report's own closing carrying value.

**Restore:** `nf_devco` restored from `nf_devco-full-before-p6.sql` after the proofs (see §6).

## 4. Tests

See §6 for the final counts. New: 12 rules cases for the by-profile roll-forward and the tie-out row (including the 0.01 tolerance and the
sign of each role), the service spec for the new query, 4 panel cases (sections shown, variance banner, "not available" reason, empty state).

## 5. Departures from the plan and limits

1. **The backfill does not allocate old batch-level feed to animals.** Phase 2 §5 offered that "if the client wants it". It is not done: the split
   (per head? per day?) is the client's call, and it would change history. It is reported (BATCH-000001: 5.00; 18.0714 of batch-level amortisation
   shows on the batch-level line) and left alone.
2. **No costing is run for the past.** The backfill sets profile and start date only. The first run an animal gets is the first one a user (or the
   scheduler, once switched on) makes. The scheduler's catch-up would walk from the profile's effective date; on this tenant that is 2024-01 and would
   be three periods per pass, so before switching it on a profile's effective date should be the date the client wants costing to start.
3. **The tie-out compares what the engine wrote.** It proves the engine's ledger rows and its journals agree. It does not and cannot prove that the
   accounts hold nothing else: 5100 here also carries 18.07 from the batch path, and the report says so on the batch-level line. Accumulated
   amortisation is checked only on the dead-animal side (excluded from the ledger figure).
4. **Fixture accounts.** `P8-ACCUM` stood in for the accumulated-amortisation account that the chart lacks; restored away with the rest.
5. **The male (PIG-2023-0001)** is not costed: the client's four breeding rules have no male rule for a bought local animal (D2). He holds 657 124.00
   of book value, nearly all of `nf_devco`'s total; where that figure comes from is not established here.

## 6. Final state and test counts

`pnpm nx test api`: **286 suites, 3 649 tests, all passing.** `pnpm nx test web`: 130 of 134 suites pass; the same 4 suites fail as in Phases 1–5
(`reason-master`, `breeding-rules`, `requisitions-hub`, `requisitions-panel`; 5 tests), none touch this work. `api:typecheck`: the same 23 errors as before,
all in other people's spec files (none outside a `.spec.ts`; `batch-shed.spec` now reads "expected 11 arguments" because the batch service gained a
dependency, and that spec was already short); `web:typecheck` clean.

**Restore.** `nf_devco` was dropped and rebuilt from `nf_devco-full-before-p6.sql` after the proofs. Read back: 211 migrations, 9 animals, none with a profile,
0 profiles, 0 runs, 16 journals, `P8-ACCUM` gone, DLNA8228 ACTIVE. `nf_system` was not touched. The API was stopped; the web server was not running.
**The backfill has therefore not been applied to any database**; run `--apply` on a tenant when the client has profiles live there.
