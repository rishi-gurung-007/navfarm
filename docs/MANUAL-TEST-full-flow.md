> **22 Oct 2026, evening: the data this guide describes was dropped.** The database was rebuilt with the costing test seed (4 sows + 4 boars in 2 batches, `pnpm seed:costing-test`); read `COSTING-TEST-REPORT-2026-10-22.md`. This guide still describes the `WALK-` / `FLOW-` seeds, which exist only as on-demand chapters (`db-costing-walkthrough`, `db-full-flow`).

# Manual test — the full flow, module by module

Data: the `FLOW-…` seed (`pnpm nx run api:db-full-flow`), described in `docs/TEST-GUIDE-full-flow.md`. Sow **PIG-2025-0011**, boar **PIG-2025-0012**, batch
**BATCH-000008**, litter lot **BATCH-000009**, gilts **PIG-2026-0007 … -0011** in **BATCH-000010**. Everything is dated 5 Jan - 21 Sep 2026.
Tick each box only when what you see on screen matches the **Expected** line.

**Before you start**
- API on `http://127.0.0.1:2877`, web app open, tenant `devco` (local test login `tenant.admin@triplec.local` / `12345678`). Restart the API if it was started before today's code changes.
- Back up first if you will try the "break it" steps in section 10: `mysqldump -u root nf_devco > ~/before-manual.sql`. To go back:
  `grep -v GTID_PURGED ~/before-manual.sql | mysql -u root nf_devco`.
- Dates in filters: use 1 Jan 2026 to today, or the list will look empty.

---

## 1. Finance → Bio-Asset Costing Setup (the rules the runs follow)
1. Open **Finance → Bio-Asset Costing Setup**.
2. [ ] Profiles **IMP-F**, **IMP-M**, **LOC-F**, **LOC-M** are ACTIVE. IMP-F/LOC-F: start age **33 weeks**, life **36 months**; IMP-M/LOC-M: start age **26 weeks**.
3. [ ] Residual setting: female **150 kg × 2.05 = 307.50**, male **none**, effective from 1 Jan 2026.
4. [ ] Each profile has its GL accounts (asset, amortisation expense 5100, accumulated amortisation 1065, fair value, write-off).

## 2. Inventory → Goods Receipt, Ledger, Balance
1. **Inventory → Goods Receipt**: find reference **DEMO-FLOW-GRN** (5 Jan 2026), POSTED.
   - [ ] Two lines: *Mature Parity Breeding Sow* 1 HEAD @ **850**, *Mature Herd Sire Boar* 1 HEAD @ **1 200**.
2. Same screen, references **DEMO-FLOW-FEED-GESTATION** (1 600 kg, 5 Jan), **DEMO-FLOW-FEED-LACTATION** (300 kg, 24 Jul), **DEMO-FLOW-FEED-GILT** (100 kg, 14 Sep). [ ] All POSTED, into the MUL100 store.
3. **Inventory → Ledger**: item *Dry Sow Gestation Mash (14% CP)*.
   - [ ] One receipt in (1 600 kg), then one consumption out every Monday for the boar and the sow (19.6 kg and 17.5 kg).
4. **Inventory → Balance**: [ ] gestation mash and lactation diet in the MUL100 store are lower than received (the seed drew from them); the weaner mash is **10 kg** lower than the 100 kg received (5 gilts × 2 kg).
5. **Inventory → Bio Asset Ledger**: [ ] the purchase rows for the sow and the boar; piglet-lot rows for the litter.

## 3. Livestock → Animal Register (the two cards)
Open the **sow PIG-2025-0011** (RFID `FLOW-IMP-SOW-01`):
1. [ ] Entry type *Purchased - Imported*, entry date 5 Jan 2026, born 6 Oct 2025, 14 teats, TSI 120, grading 87, parents' serials DK-LR-91207 / DK-LR-80455, linked to the GRN.
2. **Costing & Valuation** tab:
   - [ ] Profile **IMP-F**, costing start **25 May 2026** (born + 33 weeks), residual **307.50**.
   - [ ] Ledger: ACQUISITION 850.00; CONSUMPTION rows (20, every Monday 5 Jan - 18 May) and OVERHEAD rows (5, 15 Jan - 15 May) = capitalised **223.34**; COST_ALLOCATION **−73.00** (7 Aug, litter birth cost); AMORTIZATION May - Sep **−107.00**.
   - [ ] Book value **893.35** (850 + 163.34 + 60 − 73 − 107).
3. [ ] **Health & Treatments**: dewormer 7 Jan, vaccine 9 Jan, PRRS vaccine 25 Mar.
4. [ ] **Breeding & Lifecycle**: mating 13 Apr (AI), pregnancy confirmed 11 May, farrowing 7 Aug, weaning 4 Sep; parity 1.

Open the **boar PIG-2025-0012** (`FLOW-IMP-BOAR-01`):
5. [ ] Profile **IMP-M**, costing start **2 Feb 2026**, residual none. Ledger: ACQUISITION 1 200.00; CONSUMPTION 4 rows (5 - 26 Jan) 36.59 and OVERHEAD 12.00 (15 Jan); 8 AMORTIZATION rows (Feb - Sep) **−816.42**. Book value **432.17**.
6. [ ] Semen section lists lot **LOT-00006**.

## 4. Batches → batch BATCH-000008 (feed and overhead per animal)
1. **Batches → Batches**: [ ] BATCH-000008 ACTIVE, animal-wise, from 5 Jan 2026, two animals.
2. Open it → transactions (or **Batches → Records**).
   - [ ] Weekly CONSUMPTION for each animal; the sow's lines switch to the *High-Density Lactation Diet* (42 kg) from 10 Aug to 31 Aug.
   - [ ] Monthly OVERHEAD (12.00) on the 15th.
3. **The capitalise/expense switch** (the key rule): compare a sow line on **18 May** with one on **25 May**.
   - [ ] 18 May: capitalised (a CONSUMPTION row in her bio-asset ledger, GL debit 1050). 25 May: expensed (no row in her ledger; GL debit 5080 *Bio-Asset Consumption Expense* in **Finance → Journal**).
   - [ ] Same for the boar: 26 Jan capitalised, 2 Feb expensed.
4. [ ] There is **no Mature button** on this animal-wise batch.
5. Open **BATCH-000009** (litter lot, headcount): [ ] opened 7 Aug with **13** head, now **7** head, carrying value **39.31**. **BATCH-000010**: [ ] 5 gilts, carrying value **5.75**.

## 5. Finance → Bio-Asset Costing Runs (monthly amortisation)
Open **Finance → Bio-Asset Costing Runs**, filter batch **BATCH-000008**. [ ] 18 runs, all POSTED (BCR-2026-00017 … 00034), two per month (IMP-F, IMP-M).

| Month | Boar (IMP-M) | Sow (IMP-F) |
|---|---|---|
| Jan | skipped, *not started* | skipped, *not started* |
| Feb | charged **98.69** (28.93 days of 366) | skipped |
| Mar | **101.76** | skipped |
| Apr | **102.09** | skipped |
| May | **102.09** | **6.00** (6.77 days) |
| Jun | **102.50** | **26.60** |
| Jul | **102.50** | **26.60** |
| Aug | **103.06** | **23.88** (starts from 941.14: the birth cost left her book value) |
| Sep | **103.72** | **23.91** |

Open one run (e.g. the boar's **2026-02**): [ ] the line shows book value before 1 248.59, residual 0, days 28.93, remaining days 366, charge 98.69, book value after 1 149.90, life end **3 Feb 2027**, and a journal.
Hand check of the sow's May line: charge = (1 073.34 − 307.50) × 6.77 ÷ 864 days remaining ≈ **6.00**.

## 6. Livestock → Breeding (semen, mating, pregnancy, farrowing, weaning)
1. **Semen** tab: lot **LOT-00006**, collected 10 Apr 2026, boar PIG-2025-0012, **30 doses**, 240 ml, motility 86 %, 310 M/ml.
   - [ ] Cost period 5 Jan - 10 Apr: amortisation **200.45** (= the boar's Feb 98.69 + Mar 101.76), feed 128.06, overhead 36.00, running cost **364.51**, **12.1504 a dose**.
   - [ ] Doses are in stock; 2 were used for the mating (28 left).
2. **Mating** tab: [ ] 13 Apr, sow PIG-2025-0011, type AI, lot LOT-00006, 2 doses, expected farrowing **7 Aug 2026**; pregnancy check 11 May, ultrasound, CONFIRMED.
3. **Farrowing & Litters** tab: [ ] 7 Aug, born alive **13**, stillborn **1**, weaned **12** (10 at weaning + 2 selected before), weaning date 4 Sep; lot LOT-00007 = BATCH-000009. The litter shows its cost **5.6156** a piglet at birth.
4. **Birth cost in the books** (Finance → Journal, 7 Aug): [ ] **JE-000224** "Litter LOT-00007 born to PIG-2025-0011: cost per piglet 5.6156": Dr 1055 Piglets Inventory **73.00** / Cr 1050 **73.00**.
5. **Why only 73.00 and not more?** [ ] It is her capitalised cost from mating (13 Apr) to 24 May only: from 25 May her feed was expensed, so there was nothing capitalised to pass on. This is the open Finance question, not a bug.

## 7. Gilt Selection (inside Breeding → Farrowing & Litters, and the Gilt Selections tab)
Rule (BBP, as the client says): gilts are selected **once per litter, after week 4, before the litter is weaned**. After weaning the **Select gilts** button is gone.
1. **Farrowing & Litters**: [ ] on this weaned litter (PIG-2025-0011, 7 Aug) there is **no Select gilts button**, only "Weaned". Same for the other two weaned litters.
2. **Gilt Selections** tab (history): [ ] the selection(s) of this litter with the sow (dam), boar (sire) and per-gilt teats. A database seeded before 22 Oct shows three (GS-2026-00003 / -00004 / -00005); a fresh seed shows one (all 5 gilts, at the weaning).
   (GS-2026-00001 cancelled and GS-2026-00002 belong to earlier tests of the WALK group.)
3. [ ] Gilts `FLOW-GILT-01 … 05` = PIG-2026-0007 … -0011: teats **16, 15, 16, 17, 15**; entry type *Born on farm*; profile **LOC-F**; costing start **26 Mar 2027**; acquisition **5.6156**; sire/dam from the litter.
4. [ ] One gilt's card: book value **6.7656** = 5.6156 birth cost + 1.15 first feed (2 kg of weaner mash, 21 Sep, capitalised).
5. [ ] Lot BATCH-000009: 7 head left after the gilts and one loss.
6. **Try a new litter** (needs a farrowing: record a mating, pregnancy check and farrowing in section 6 first, see section 10): on its row **Select gilts** is shown while the litter is unweaned; the dialog shows dam, sire, lot, age, week-4 date, head in the lot, cost per pig. A gilt with **14** teats is blocked (15 is the minimum). After saving, **Select gilts is gone from that row** (one selection per litter) and the weaning form no longer offers the gilt step.
7. **Week 4 alert**: a litter still on the sow at day 28 shows the banner *Select gilts / Wean all piglets*; once gilts were selected the banner goes and only the weaning remains.

## 8. Finance → Journal, Trial Balance, Bio-Asset Reconciliation
1. **Journal**, filter 1 Jan - 30 Sep 2026: [ ] **13** journals from these runs (source BIO_COSTING_RUN: 8 for the boar Feb - Sep, 5 for the sow May - Sep; the empty Jan - Apr runs post nothing), together **923.41** (boar 816.42 + sow 107.00): Dr 5100 amortisation expense / Cr 1065 accumulated amortisation. Weekly feed and overhead after each animal's start are Dr 5080 (source BATCH); **JE-000224** is the birth. [ ] Every journal debit = credit.
2. **Trial Balance** 1 Jan - today: [ ] 1055 Piglets Inventory carries 73.00 less nothing mapped out yet (known: gilt-selection and loss legs are not mapped, decision D8); 1065 accumulated amortisation grows by the posted runs.
3. **Bio-Asset Reconciliation**: [ ] the "costing runs tied to the ledger" and batch rows show difference **0**.
4. Terminal check: `pnpm nx run api:db-check-bio-asset-reconciliation` → [ ] `cache_differs_from_ledger: []`, `batches_that_differ: []`; BATCH-000008 carrying value **198.93**, BATCH-000009 **39.31**, BATCH-000010 **5.75**.

## 9. Alerts and approvals (light touch)
1. **Alerts**: [ ] a *Gilt Week 4 Selection Due* alert exists only for a litter still on its sow at day 28; this litter was weaned on day 28, so none is expected for it. To see one, farrow a sow and wait or back-date (needs a new mating: see section 10).

## 10. Break it on purpose (rules that must refuse) — back up first
| Try | Expected |
|---|---|
| Costing Runs: calculate **2026-08** for BATCH-000008 again | "already been run" (one run per profile, period and batch) |
| Costing Runs: calculate an earlier month after a later one is posted (reverse Jan - Aug first, then try Jan) | "a period cannot be run behind a later one" |
| Costing Runs: calculate **2026-10** | "has not ended yet" (until 1 Nov) |
| Reverse the latest run (2026-09) | ledger rows and journal mirrored, boar back to 535.89 and sow to 917.26; run again to re-post |
| Weaning the sow's litter again | "already weaned … cannot be weaned again" |
| Select a gilt with 14 teats | blocked, 15 is the minimum |
| Select gilts again on a litter that already has a selection, or on a weaned litter (API call `POST /piggery/gilt-selection`) | refused: "already selected from this litter" / "already been weaned" |
| Select more gilts than the lot holds | refused |
| Batches: Mature on BATCH-000008 | not offered; the API refuses it |
| Enter feed for the sow dated **before 5 Jan** | expected to be refused (before the batch started); not checked yet - tell me what you see |
| Record the boar's death (Batches → mortality), then run **2026-10** after 31 Oct | one MORTALITY row for his book value, accumulated amortisation cleared (journal Dr 1065 / Cr 1060); the later run skips him ("left the farm after this period") |

## 11. Quick sign-off table
| Module | Pass? |
|---|---|
| 1 Costing setup | |
| 2 Inventory (GRN, ledger, balance) | |
| 3 Animal register cards | |
| 4 Batches (feed, overhead, capitalise vs expense) | |
| 5 Costing runs | |
| 6 Breeding (semen, mating, farrowing, birth cost) | |
| 7 Gilt selection | |
| 8 Journal / trial balance / reconciliation | |
| 10 Rules that refuse | |

Report any line that does not match with: the screen, the animal code, the date and what you saw against what is written here.
