# Costing test — report of 22 Oct 2026

**What was asked:** check the code and the SQL schema at every level, drop all the previous data, seed again with **only 4 sows and 4 boars in 2 batches**, run every costing case,
and report which cases were performed. **Result:** 109 of 109 checks read back from MySQL pass, the guards all refuse as they should, and the testing found **three real defects, now fixed**.
Nothing is committed. Backups of everything dropped: `before-costing-test-nf_master/nf_system/nf_devco.sql` in the session scratchpad (the golden copy of the new seed is `nf_devco-costing-test-golden.sql`).

Run it again: `pnpm seed:costing-test` (drops and rebuilds `nf_master`, `nf_system`, `nf_devco`; about 3 minutes; the API must be restarted afterwards).
Re-check without rebuilding: `pnpm nx run api:db-verify-costing-test`. Chapter only, on a database that has the masters: `pnpm nx run api:db-costing-test`.

## 1. The check of the code and the schema, before the seed was written

| Level | What was read | Finding |
|---|---|---|
| Engine (`bio-costing.engine.ts`) | amortisation formula, part-months, life end, residual floor, skip reasons, fair value | Formula is the BBP's `(book value - residual) x days / remaining days`; D11 (the sheet's own cell) stays open. Life is counted **from birth** (36 months sow, 18 boar), so a boar costed from 26 weeks is amortised over about 12 months, not 18. Not a bug: the client's sheet says so. |
| Run service | calculate, post, reverse, the guards, the V9 tie (lines = ledger = journal), the exit date skip | Sound. Reverse refuses an animal that left after the period. |
| Exit service | death: clears accumulated amortisation | A sale, cull or transfer posts nothing (known, not built). |
| Book value | derived from the animal's own ledger rows, register column is a cache | Sound; `PURCHASE` rows are excluded there. |
| Scheduler / due notice | `runFacts`, `dueReport` | **Defect 1** (below). |
| Roll-forward report | `getBiologicalAssetRollForward` | **Defect 2**. |
| Animal update | `dob` edit | **Defect 3**. |
| SQL schema | `schema.ts` against `nf_devco`, all 151 tables, column by column; the keys of the costing tables | **No drift in any costing table.** Unique keys are there: one live run per profile+period+batch (`uq_bio_costing_run_active`), one charge per animal+method+period (`uq_bio_costing_run_line_active`), one active profile per scope, one residual per company+sex+date, unique run numbers. Only drift: 8 extra database columns in `feed_stock_count` and `approval_request` (not costing; not touched). |
| Reset chain | `rebuild-demo` | The locale sync step prints `FAILED ... insert into country_master` on every rebuild. It does not stop the seed and has nothing to do with costing; listed under follow-ups. |

## 2. The seed (`pnpm seed:costing-test`, chapter `16-costing-test`)

Two animal-wise batches, nothing else (the demo herd, the walkthrough group and the earlier full-flow animals are gone). Prices: the GRN price is each animal's cost.

| Tag | Code | Batch | Profile | Born | Arrived | Costing start | Why this animal |
|---|---|---|---|---|---|---|---|
| CT-A-SOW-1 | PIG-2025-0001 | A imported, 5 Jan | IMP-F | 6 Oct 2025 | 5 Jan | **25 May** (by age) | capitalise, then expense; AI-mated, farrows 7 Aug, 5 gilts at weaning |
| CT-A-SOW-2 | PIG-2024-0001 | A | IMP-F | 2 Dec 2024 | 5 Jan | **5 Jan** (arrival) | expensed from day one; **dies 14 Jul** |
| CT-A-BOAR-1 | PIG-2025-0002 | A | IMP-M | 4 Aug 2025 | 5 Jan | **2 Feb** (by age) | semen on 10 Apr, after two amortisation runs |
| CT-A-BOAR-2 | PIG-2024-0002 | A | IMP-M | 1 Oct 2024 | 5 Jan | 5 Jan | **life ends 2 Apr 2026**: last run takes him to nil, then LIFE_COMPLETE |
| CT-B-SOW-1 | PIG-2025-0003 | B local, 12 Jan | LOC-F | 3 Nov 2025 | 12 Jan | **22 Jun** | capitalised for 23 weeks; mid-month start |
| CT-B-SOW-2 | PIG-2025-0004 | B | LOC-F | 3 Feb 2025 | 12 Jan | 12 Jan | **own residual 400** from 25 Jun; mated 18 May, farrows 11 Sep (still on her sow: week-4 case) |
| CT-B-BOAR-1 | PIG-2025-0005 | B | LOC-M | 1 Sep 2025 | 12 Jan | **2 Mar** | |
| CT-B-BOAR-2 | PIG-2025-0006 | B | LOC-M | 3 Mar 2025 | 12 Jan | 12 Jan | semen on 11 May; life ends 2 Sep |

Plus the five gilts `CT-GILT-01..05` (PIG-2026-0001..0005) born from CT-A-SOW-1 and their batch `CT-GILT-BATCH`.
Feed: each batch's Monday feed is **one group issue** (so a mixed group is split), lactation diet while a sow nurses; a 12.00 monthly overhead per animal; dewormer and vaccines costed as medicine drawn against each animal. The company's female residual changes on 1 Jul (150 -> 160 kg x 2.05). One run per batch and profile after every month, Jan to Sep, in order; batch B's September runs are reversed and made again.

## 3. The test cases performed

Read back from MySQL by `verify-costing-test.ts`, each against **its own arithmetic** (not numbers copied from a run). 109 checks, grouped:

| Id | Case | Result |
|---|---|---|
| S1 S2 | The herd is 4 sows + 4 boars (+ the gilts), 13 animals in the register; 2 animal-wise batches of 2 sows + 2 boars | pass |
| P1 | Each animal has one ACQUISITION row at her GRN price (850 / 1 200 imported, 700 / 900 local) x 8 | pass |
| P2 | Profile from origin and sex: IMP-F, IMP-M, LOC-F, LOC-M x 8 | pass |
| P3 | Costing start = later of (birth + 33 / 26 weeks) and arrival x 8 (four by age, four on arrival) | pass |
| C1 C2 C3 | Capitalise before the start, expense from it: nothing capitalised on or after her start; what was capitalised = the cost of every entry before it; animals that start on arrival have nothing capitalised x 8 | pass |
| C4 | One group issue holding animals on both sides of their starts is split (27 Apr: four ate, only CT-A-SOW-1 capitalised) | pass |
| C5 C6 | Expensed feed (account 5080) and overhead (5090) equal exactly the entries dated on or after each start | pass |
| R0 | 70 posted lines, 52 charged | pass |
| R1 | Every charged line recomputed: (book value - residual) x days / remaining days, or the whole of it in the last period | 52 of 52 |
| R2 R3 | book value after = before - charge; and = her own ledger as of the period end | pass |
| R4 | Months chain: each book value before = the last after + the cost booked in between | pass |
| R5 | Residual: 307.50 to June, 328.00 from 1 July, CT-B-SOW-2 her own 400 from June (the run after her override), males none | pass |
| R6 | Life end = birth + months x 365/12 days | pass |
| R7 | Nobody charged before her start; NOT_STARTED only where the period ended before it | pass |
| R8 R9 | Part-months count 30 x days in her window / days in the month (8 first charges) | pass |
| E1 E2 E3 | CT-A-BOAR-2: last run takes him to nil; every later run LIFE_COMPLETE; life end 2 Apr 2026 | pass |
| X1 X2 X3 X4 | Death of CT-A-SOW-2 (14 Jul): one MORTALITY write-off, book value nil, her accumulated amortisation (137.30) cleared once (Dr 1065 / Cr acquisition), no run charges her after (July skips her, later runs leave her out) | pass |
| M1-M7 | Semen, both boars: 2 lots; amortisation part = the boar's amortisation up to the collection (201.05 / 421.69); cost per dose = (amortisation + feed + drug + overhead) / doses (12.2961 / 25.5242); feed, drug and overhead parts equal what was posted against him; **drugs are costed** (3.77); 2 doses used per mating | pass |
| L1-L6 | Farrowing 116 days after mating (13/1 and 11/1); the sow's capitalised cost from mating to the day before farrowing (73.00) moves to the litter lot (5.6156 a piglet), journal Dr 1055 / Cr 1050 = 73.00; the lot: 13 - 1 lost - 5 gilts = 7 head worth 39.31; weaned 12 | pass |
| G1 G2 G3 | One gilt selection for the weaned litter (POSTED, 5 gilts), none else; each gilt born on farm, LOC-F, dam and sire, 15 teats or more, start = birth + 33 weeks (26 Mar 2027), acquisition = 5.6156 | pass |
| I1 | Every posted run: ledger = - total charge = journal debit (36 runs) | pass |
| I2 I3 | No journal unbalanced; every journal's lines add up to its header | pass |
| I4 I5 I6 | The register's cached book value = each animal's ledger; no negative book value; no charge below the residual | pass |
| I7 I8 I9 | One posted run per profile+period+batch; no calculated-but-unposted run left; the 2 reversed runs are mirrored to nil and their month was posted again | pass |
| I10 I11 | 5100 amortisation expense = all amortisation in the ledger; 1065 = that less what the death cleared | pass |
| I12 H1 | Residual settings and the animal's own; health records (19) | pass |

Guards, tried at seed time (the refusal is the pass): **G1** run the same month twice; **G2** a month behind a later posted one; **G3** a month that has not ended; **G4** a period that does not fit the frequency;
**G5** reverse a run that is not the latest; **G6** post a run that is already posted; **G7** select gilts again from a weaned litter; **G8** a gilt with 14 teats; **G9** a second selection while one is open;
**G10** change the birth date of an animal that has feed and runs booked (and G10b: the refused edit left her dates untouched); **R1** reverse the latest runs of a batch and run the month again. All pass.

Also performed, outside the 109: the bio-asset reconciliation script (13 animals, 5 batches, **no difference**); the roll-forward report through the API and on the Finance screen (costing runs tied to the ledger: 5100, 1065 and 4020 reconciled);
the Bio-Asset Costing Runs screen (38 runs; the due notice, see defect 1); the API suites (3 745 pass) and the web suites (the same 5 unrelated failures as before: Reason master, two checkMating cases, two requisition approvals).

## 4. Defects the testing found, and the fix

1. **"Due for costing" was wrong when a batch of animals not yet costable existed.** After batch A and B were run for January to September, the Finance screen still said LOC-F was due for 2026-01..03, and *Run due now* would have tried whole-herd runs behind posted ones and left FAILED runs. Cause: a period counted as covered only if **every** batch holding the profile's animals had a run, including the gilt batch whose animals arrived in September and start costing in 2027.
   Fix: a batch is owed a run for a period only if one of its animals had arrived and could start by the period's end (`bio-costing-scheduler.service.ts`, `runFacts`), with two specs. Proved live: the due report went from `LOC-F: 2026-01, 02, 03` to nothing.
2. **The IAS 41 roll-forward counted every purchased animal twice.** Acquisitions read 14 701 against a true 7 328 and the closing carrying value 10 607 against 3 307 (the sum of the profile rows and of the animals + lot), because the goods receipt's `PURCHASE` row and each animal's own `ACQUISITION` row were both added.
   Fix: only the part of a receipt not yet registered is counted (`financial-reports.service.ts`), with a spec. Proved live: closing 3 307.09 = the profile rows = animals 3 267.78 + lot 39.31.
3. **An animal's birth date could be edited after costing had started, leaving her costing start, her capitalised feed and her amortisation on the old date.** Proved live (start stayed 22 Jun after moving the birth date to June 2025).
   Fix: the birth date of a costed animal moves her start only while nothing is booked on her (no run line, no capitalised or amortised ledger row, no feed or overhead entry); otherwise it is refused with the reason (`startForNewBirthDate`, `animal.service.ts`), with specs and the guard G10. Proved live: refused, dates unchanged.

## 5. Not defects, not built, or not tested (so nobody assumes)

- **GL does not tie to the ledger, by design (D8):** the roll-forward still shows a variance of **2 801.38** (ledger 3 307.09, GL 505.71). The purchase of an animal posts no journal, so the asset accounts hold only capitalised cost, the birth-cost move and the death clearing. Consequences you will see: **1060 is negative (-137.30)** after the death (the clearing credits an account the purchase never debited) and **1055 keeps 73.00** though the litter's lot is worth 39.31 and the gilts' 28.08 is nowhere in the GL.
- **A sow already past her costing start hands her litter almost nothing** (CT-B-SOW-2's lot opened at nil; CT-A-SOW-1's carries only 14 days' cost): the open Finance point.
- **Not built:** sale, cull, slaughter and transfer-out of an amortised animal post nothing; fair-value method (covered by the engine's unit tests only, not run live: the active scopes are amortised); the auto-run scheduler's timer (its logic is unit-tested, the timer is off).
- **Not tested live:** moving an animal from one batch to another between runs; whole-herd runs beside batch runs; back-dated feed after a month was run; the daily-entry path for feed (the seed posts through the batch services).
- **Unrelated, found on the way:** the locale sync in the reset prints `FAILED ... country_master`; 8 database columns in `feed_stock_count` / `approval_request` are not in `schema.ts`; 5 web specs already failed before.

## 6. What to look at in the app (10 minutes)

*Finance > Bio-Asset Costing Runs*: 38 runs, none due; open BCR-2026-00002 (the old boar's first part-month) and BCR-2026-00014 (his last charge, book value after 0.00). *Bio-Asset Reconciliation* 1 Jan to today: closing 3 307.09, 5100 and 1065 reconciled, GL variance 2 801.38 (D8).
*Livestock > Animal Register*: PIG-2025-0001 (start 25 May, capitalised 223.34, birth cost -73.00), PIG-2024-0001 (dead, nil), PIG-2025-0004 (own residual 400); try changing PIG-2025-0003's birth date: it is refused.
*Livestock > Breeding*: LOT-00001 (12.2961 a dose, amortisation 201.05), the litter of PIG-2025-0004 (born 11 Sep, 41 days on the sow: the week-4 banner), the one gilt selection (5 gilts).
