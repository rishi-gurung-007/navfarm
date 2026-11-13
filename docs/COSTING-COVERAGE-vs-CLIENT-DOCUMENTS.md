# Bio-asset costing: what is built, measured against the client's two files

**Date:** 21 Oct 2026. **Files compared:** `Amortization,Fairvalue & Bio Asset(FIXED ASSET).csv` ("the Fixed Asset sheet") and `Final TDD_V1.csv`
rows 5–11 ("the TDD"). **Built in:** Phases 1–6 of `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md`; proof in
`docs/VERIFICATION-2026-10-20-bio-costing-phase-{0..6}.md`. Phases 4–6 are not committed. The Business Central (BC) side of the TDD is not part of this work.

## 1. The flow in one picture

```
SET UP (once)                    EVERY PERIOD                              WHEN THE ANIMAL LEAVES
------------                     ------------                              ----------------------
Costing profile                  Period ends (month)                       Death: one write-off row,
 - method (amortise / fair value)   |                                        accumulated amortisation cleared
 - start week, life, residual       v                                      Sale / cull / transfer: NOT BUILT
 - 5 GL accounts                 Calculate (preview, nothing posted)
 - fair-value rate (150 kg x 2.05)  |
        |                           v
        v                        Post: one ledger row per animal
Animal gets a profile              + one journal (Dr/Cr) per run
 (at registration, or backfill)     |
 and a costing start date           v
 (birth + start weeks)           Reports: roll-forward by profile,
                                  tie-out to the trial balance
```
Book value is never typed: it is the sum of the animal's rows in the bio-asset ledger.

## 2. What was built, phase by phase

| Phase | What it gave you |
|---|---|
| 0 | Read-only evidence from the database and the client's files; corrected the plan |
| 1 | Fixes to the old batch code: no `heads x 28000` default, amortisation cannot pre-date maturity or exceed the residual, fair-value gain/loss books to the right account, closed periods respected |
| 2 | Book value derived from the ledger; one death write-off instead of two; the register's value columns are now a cache |
| 3 | The costing profile (master, rules, lock, versions); animals get a profile and a start date at registration; seeds as DRAFT |
| 4 | The run engine: Calculate, Post, Reverse; journal + ledger rows per animal; death clears accumulated amortisation; the Finance screen |
| 5 | Scheduler: runs due periods, "Due for costing" notice, calculate-and-wait or auto-post |
| 6 | Backfill for existing tenants; roll-forward by profile and tie-out to the trial balance; records |

## 3. Against the Fixed Asset sheet

| Sheet requirement | Status | Note |
|---|---|---|
| Imported = amortisation, local = fair value | Done | Enforced: the other combination is refused |
| Useful life: 36 months female, 18 months male | Done | Life counted from birth in 365-day years |
| Residual 307.50 (150 kg x 2.05), females only | Done | One of the two imported demo females (NB0552, cost 300) has a residual **above** her purchase price, so she is skipped |
| Start period 33 weeks (F) / 26 weeks (M) | Done | 17 weeks (weaners) is not built |
| Tracking: individual | Done | Batch tracking (weaners) is not built |
| Separate GL accounts per class (GGP / GP / P x Imp / Loc x F / M) | Partial | One profile per origin and gender; the sheet's numbers are identical across the classes. Per-class accounts need Finance to create them, then item/breed-scoped profiles |
| Acquisition: Dr acquisition cost / Cr vendor or cash | **Not built** | Registration posts no journal (decision D8) |
| Capitalisation: Dr acquisition cost / Cr feed, vet, med inventory | Partial | Cost is capitalised per animal in the ledger; the GL entry goes to the batch accounts 1050/1060, not the per-class accounts |
| Weaners fair value from week 17; finisher transfer | **Not built** | Needs batch-tracked profiles |
| Non-current / current classification | **Not built** | Not modelled |

## 4. Against the TDD

| TDD row | Requirement | Status | Note |
|---|---|---|---|
| Item card | "Bio-asset costing tab" on the item card | Partial | Built as one **central profile** instead of per-item fields (your instruction: central). The item flag is not written from the profile |
| 5 Purchase (GRN) | Register an animal per received head | Partial | Registration existed; it now also assigns the profile and start date. **No acquisition journal.** No BC call |
| 6 Acquisition (gilt selection) | Home-bred gilts become fixed assets | **Not built** | Home-bred animals get **no profile** until the client says whether they are "local" (D2); the gilt-selection journal is not built |
| 7 Capitalisation | Each feed / medicine issue raises the animal's book value | Done | Per animal for animal-wise batches; GL via the batch path. No BC push |
| 8 Amortisation / fair value | Request page (period, frequency, days, description), one entry per animal, Dr expense / Cr accumulated amortisation, fair-value gain and loss, due notification | Done | Formula wording still the client's (D11). "Last amortisation date / next due date" are computed, not stored on the animal. No BC push |
| 9 Consumption | Daily consumption per animal | Done | Existing path, made per-animal |
| 10 Mortality | Dr impairment loss (NBV), Dr accumulated amortisation, Cr acquisition cost | Partial | One write-off row for the animal's book value; accumulated amortisation cleared; the loss and gross-cost legs wait for D8 |
| 11 Sale / cull | FA to inventory conversion, Finance approval, three entries | **Not built** | Only the animal's ledger row and gain/loss use the derived value; no journal, no conversion record |

## 5. Tally

18 requirements above: **6 done, 7 partial, 5 not built.** The costing engine itself (profiles, calculate, post, reverse, schedule,
reports) is done. What is missing is the accounting around the animal's life: buying, selling, culling, home-bred gilts, weaners,
and the BC push.

## 6. What blocks the rest (the client's or Finance's call)

D8 (does registration post to the GL; the loss legs on death), the real accumulated-amortisation and impairment accounts, D11 (formula
wording: 10.68 on the sheet vs 93.49 from the BBP words), D2 (origin of home-bred animals), D5 (costs to sell), and the sale / cull /
transfer treatments.
