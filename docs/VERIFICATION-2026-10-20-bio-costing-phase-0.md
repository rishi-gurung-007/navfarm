# Verification — bio-asset costing, Phase 0 (evidence, read-only)

**Date:** 20 Oct 2026 · **Plan:** `docs/superpowers/plans/2026-10-20-central-bio-asset-costing.md`
**Method:** client workbook and BBP unzipped and read; `nf_devco` queried with `SET SESSION TRANSACTION READ ONLY`.
No row was written, no code changed. `nf_devco` is small (9 animals, 6 bio-asset batches) and **no animal has been
disposed**, so anything that needs a death or a disposal could not be observed and is listed under "Not proven".

## A. What the client documents say

Files (in `OneDrive_1_04-09-2026/Solution Documents/`): `Amortization,Fairvalue & Bio Asset.xlsx` (4 sheets: *FIXED ASSET*,
*costing tdd*, *amortization & fv -formula*, *Animal Register*), `Triple-C_Bio Asset _Structure and Respective GL Entries.xlsx`,
`NAVFarm_ Business Central Bio Asset (Current -Non Current )Accounts_Finance_Costing_BBP.docx`.
**The formula sheet exists** (the earlier "not available" was wrong about the workbook; it is sheet 3).

| Topic | What the documents state | Source |
|---|---|---|
| Items / groups | 10 breeding fixed-asset items — GGP, GP, P × Imported/Local × F/M — each with its own GL names; plus PIGLETS (current asset, batch, fair value) and Finisher | FIXED ASSET sheet; GL structure |
| Imported = amortisation, Local = fair value | Yes; "Imported assets cannot use the local fair value method. Local breeding assets cannot use imported amortization rules" | BBP §Asset category; FIXED ASSET |
| Female, imported | useful life **36 months**, residual **applicable** = expected weight 150 kg × 2.05 = **307.50**, start **week 33** | FIXED ASSET; BBP S.NO.4 |
| Male, imported | useful life **18 months**, residual **not applicable**, start **week 26** | FIXED ASSET; BBP S.NO.4 |
| Local (fair value) | F 36 months / week 33; M 18 months / week 26; no residual | FIXED ASSET rows GP-Loc, P-Loc |
| Weaners / growers | batch, current asset; **cost accumulates up to week 17, fair value from week 18**, monthly | BBP S.NO.6; FIXED ASSET (17 Week) |
| Capitalisation | feed/vet/medicine capitalised into the acquisition cost **up to the start week** (33 F, 26 boar, 17 weaner) | FIXED ASSET col. M |
| Frequency in days | Weekly 7, Monthly 30, Quarterly 90, Yearly 360 | formula sheet col. F |
| Amortisation maths | BBP: "Amortizable Amount = Capitalized carrying amount minus residual value. Period amortization … configured frequency and eligible number of days." Formula sheet — see B1 | BBP; formula sheet rows 43–66 |
| Fair value | expected CDM weight × unit price per kg; adjustment = fair value − carrying value before revaluation; a "CDM Based" Yes/No flag; growers' expected weight depends on farm / week / stage (60 kg at week 18 in the example) | formula sheet rows 69–75; GL structure rows 27–33; BBP |
| GL per item | Acquisition cost; Amortization (expense); Amortization (BS account = accumulated amortisation); Fair Value Gain/Loss; WIP; Mortality/Impairment loss | GL structure |
| Mortality / disposal | Dr Mortality/Impairment loss, Dr Accumulated Amortization, Cr Acquisition Cost (write-off = remaining carrying value, "cannot exceed the carrying value"). Sale/transfer to inventory: reverse accumulated amortisation and fair-value adjustments up to the transfer date | BBP S.NO.7–8; GL structure row 24 |
| Request page | Fields: Posting Date, Main Fixed Asset, Period, **No. of Days Enforced** check box, No. of Days; button identifies due assets and runs per animal. Entry columns: posting date, animal no., tattoo no., FA item, DOB, no. of days, book value, residual, total days of amortisation, amount. Posted in the Animal Register and GL; **in BC via API as an FA G/L Journal (Depreciation / Appreciation)** | BBP; formula sheet rows 19–33, 85–89 |
| Controls | No amortisation before start; no duplicate for same asset and period; NBV not below residual; no duplicate valuation for the same asset and date; fair-value adjustment uses the carrying value immediately before. Alerts: amortisation due, batch not run, useful life completed, fully amortised, residual exceeds carrying value, failed BC posting | BBP |
| Home-bred gilts | Selected gilts leave piglet inventory and become non-current assets: **Dr Local GGP/GP/Parent Acquisition Cost / Cr Piglets Inventory**. Class by mating line: Z+Z → Local GGP, Z+L → Local GP, Z+Tempo → Local Parent | BBP S.NO.5 |
| Item-card "Costing" tab | Costing method, start period, residual value, useful life, "Residual Value Applicable (Yes/No) — Sow yes, Boar no" | costing tdd sheet |
| CDM | **Not defined in any of the three files.** | grep of all three |

### B. Conflicts and ambiguities inside the client's own files (client to resolve)

1. **The amortisation formula, as typed, does not compute what the BBP says.** Formula sheet B62/B64:
   `=B44-(B44-B58*B49/B56)` with book value 3000, residual 307.5, days 30, total period 864. Excel precedence makes this
   `Residual × days ÷ total` = **10.677**. The BBP's "carrying amount minus residual" reading, `(BV − Residual) × days ÷ total`,
   gives **93.49**. A third reading, `BV − (BV − Residual) × days ÷ total`, gives the *remaining* value, 2 906.51. The
   cell's own result (10.677) is the first. The plan uses the BBP reading; the client must confirm.
2. **Useful life is counted from date of birth in the worked example:** last date = DOB + 3 × 365 (B54), life days 1095,
   amortised days = 1095 − 231 (start days) = **864**. The BBP does not say. Also, a year is 365 days there but 360 in the
   frequency days.
3. **Male/female are swapped between tabs.** FIXED ASSET / GL structure / BBP: female 33 weeks, 36 months; male 26 weeks,
   18 months. The formula tab's example rows: *Imported M* 3 years / week 33; *Imported F* 1.5 years / week 26. The BBP and two
   tabs agree with each other; the formula tab looks mislabelled.
4. **Weaner threshold:** 17 weeks (FIXED ASSET) and 18 (formula tab). The BBP resolves it as *cost up to week 17, fair value
   from week 18* — a last-cost week and a first-fair-value week, not a conflict.
5. **Catch-up days.** The sheet's pending days = age in days − start days, so an animal bought older than its start age
   would be charged for days before it was owned. The BBP says nothing.
6. **Fair value of a Local animal with "CDM Based = No"** is `150 × 2.05 = 307.50` in the sheet — a flat figure per animal,
   equal to the imported female's residual. Whether that is intended (a local breeding animal valued at 307.50) is for the client.

## C. What MySQL shows (`nf_devco`, read-only)

**C1. `bio_asset_ledger` by type and keys**

| entry_type | animal_id | batch_id | rows | Σ cost_amount |
|---|---|---|---|---|
| ACQUISITION | yes | no | 1 | 657 124.00 |
| ACQUISITION | yes | yes | 8 | 2 562.80 |
| ACQUISITION | no | yes | 4 | 0.00 |
| CONSUMPTION | yes | yes | 120 | 205.50 |
| CONSUMPTION | no | yes | 7 | 12.50 |
| AMORTIZATION | no | yes | 1 | −18.07 |
| FAIR_VALUE_ADJMT | no | yes | 1 | 382 749.50 |
| MORTALITY | no | yes | 4 | −8 900.91 |
| PURCHASE | no | no | 5 | 1 592.80 |

*Capitalised cost per animal already exists in the ledger* (120 `CONSUMPTION` rows carry `animal_id`). Amortisation, fair
value and mortality rows are all batch-level. **Migration 0211 is not needed for animal-wise batches.**

**C2. Cache vs ledger, per animal** (9 animals). `animal_register.book_value` = acquisition cost for all nine
(Σ 659 686.80, `total_amortised` 0). Ledger sum differs for four animals by exactly their capitalised feed: DLNA8228 −37.50,
P25003 −33.00, P26302 −37.50, P2975 −97.50 (Σ 205.50). So the cache is **stale by the capitalised cost** and a
ledger-derived value is the better number.

**C3. Batch roll-up vs animals.** BATCH-000001: `nca_book_value` 113.00, six animals, their cache book value 1 912.80.
BATCH-000002: 97.50 vs 650.00. The batch state holds **only the capitalised cost**; the animals' acquisition cost was
never added to it. "Batch roll-up = Σ animals" is **not true today and was never the design**; the plan's V9 and §2.3 must
say which definition is intended.

**C4. Ledger vs GL.** `journal_line` net by account: 1050 = **5.00**, 1060 = 373 838.02, 5100 = 18.07, 5010 = 8 900.91,
4020 = −382 749.50. 1060 equals BATCH-000004's carrying value exactly. But batch states for the premature batches total
210.50 (113.00 + 97.50), against 5.00 in 1050: **205.50 of capitalised cost is in the bio-asset ledger and the batch state
and not in the GL** (the per-animal consumption in animal-wise batches). No journal exists with an animal code as its
document: **registering an animal posts nothing** — 659 686.80 of animals is in no bio-asset account. (Confirms finding 1.3-1.)

**C5. A date defect.** BATCH-000004 matured on 2026-10-19; an `AMORTIZATION` row and journal JE-000014 are dated
**2026-08-12**, before maturity. `amortizeBioAsset` does not compare the posting date to `matured_at`. (New finding.)

**C6. Flags.** `costing_method_config`: only `BIO_ASSET` has `bio_asset_support`, `fair_value_option`, `amort_option` all 1;
AVG, FIFO, STANDARD all 0. `item_master.is_biological_costing_method` is **NULL on all 31 items**, and only one item has
`is_biological_asset = 1`. Gating a profile on the item column would block everything today; populate it or do not gate on it.

**C7. Chart of accounts and mappings.** `gl_account_master` has 1050 and 1060 but **no accumulated-amortisation and no
impairment account**. All 13 `BIO_*` mappings in `gl_mapping_master` have `stage_id` NULL (no stage dimension), so a
premature fair-value posting needs its own transaction type, not a stage lookup.

**C8. The 28 000.** All six batches have a `batch_bio_asset_state` row, so `ensureBioState`'s hardcoded branch is not reached
in this database. Where it can be reached: `batch.service.ts:2120` and `:2679`. Seeds that write the state directly:
`seed-piggery-complete-data.ts:484`; `scripts/demo/chapters/08-bio-asset-exit.ts` references the state.

## D. Not proven (needs an animal death/disposal via the API — Phase 2)

- Whether a death in a bio-asset batch writes **two** `animal_id` rows (batch average and the animal's own value).
  `nf_devco` holds no disposed animal; its four `MORTALITY` rows are batch-level only.
- Whether `GlPostingService.postBatchCostEntry` can take profile-chosen accounts. Read from source: it resolves a mapping
  by transaction type and nob/lob/stage and swaps debit/credit with `reverseDirection`; it takes **no explicit accounts**.
  So the run engine needs either new transaction types per profile or a new explicit-account entry point.
