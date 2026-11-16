> **22 Oct 2026, evening: the data this guide describes was dropped.** The database was rebuilt with the costing test seed (4 sows + 4 boars in 2 batches, `pnpm seed:costing-test`); read `COSTING-TEST-REPORT-2026-10-22.md`. This guide still describes the `WALK-` / `FLOW-` seeds, which exist only as on-demand chapters (`db-costing-walkthrough`, `db-full-flow`).

# Costing walkthrough — one imported breeding group and its first gilts, tested end to end

**What this is:** `pnpm nx run api:db-costing-walkthrough` (safe to repeat; it never runs in a rebuild) lives one imported group's life in the app through
the app's own services, dated in order, nothing in the future. It was run on a **clean `pnpm seed:costing` database on 21 Oct 2026** and every number
below was read back from MySQL after doing the step. Back up first if you re-run it on a database you care about: `mysqldump -u root nf_devco > ~/before.sql`.

## 1. What is in the data

| Step | Date | What happened | Where to see it |
|---|---|---|---|
| Purchase | 1 Mar 2026 | Goods receipt **GR-000024**: 2 imported sows at 850, 2 imported boars at 1 200 | *Inventory & Stock → Goods Receipt* |
| Registration | 1 Mar | **PIG-2025-0007, -0008** (sows), **PIG-2025-0009, -0010** (boars), `PURCHASED_IMPORTED`, with birth date, RFID (`WALK-IMP-…`), teats (14 / 15), TSI, grading, **the parents' serial numbers**, notes, expected cull date | *Livestock* (open a card: Overview, Lineage) |
| Costing profile | 1 Mar | **IMP-F** (sows) or **IMP-M** (boars); costing start = 1 Mar (she was bought older than the start age of 33 / 26 weeks) | card → Costing & Valuation |
| Batch | 1 Mar | **BATCH-000006**, animal-wise, the four animals | *Batches* |
| Feed | 1–15 Mar | 102 daily entries (feed per animal, body weights), 15 days posted **and locked** | *Batches → Data Entry*; *Inventory → Ledger* |
| Health | 3–10 Mar | Dewormer, vaccine (and PRRS vaccine for the sows) on the cards | card → Health & Treatments |
| Semen | 20 Mar, 28 Jul | Boar 1: 30 doses (**LOT-00003**); boar 2: 30 doses (LOT-00005) | *Livestock → Breeding* |
| Insemination | 22 Mar | Sow 1 inseminated by **AI** from LOT-00003; pregnancy **confirmed** 19 Apr | card → Breeding & Lifecycle |
| Litter | 16 Jul | Sow 1 farrowed (116 days): 13 live, 1 stillborn; the litter is held as **BATCH-000007** (a headcount batch) | *Batches* |
| Weaning | 6 Aug | 12 weaned at 7.0 kg: **one full parity**; sow 1's parity is 1 | card → Breeding & Lifecycle |
| Sow 2 | 1 Aug | Inseminated (AI, boar 2's lot), confirmed 29 Aug; farrowing is due **25 Nov 2026** (still ahead) | card |
| **Gilt selection** | 19 Oct | **GS-2026-00001**: 3 gilts (`WALK-GILT-01..03`, 16 / 15 / 17 teats, colour BLUE) from sow 1's litter. BATCH-000007 goes from 12 to **9** head. The gilts are **PIG-2026-0006, -0007, -0008**: born on farm, dam PIG-2025-0007, sire PIG-2025-0009, profile **LOC-F**, costing start **4 Mar 2027** (birth 16 Jul 2026 + 33 weeks) | *Livestock → Gilt Selection* (history); the three cards |
| **Gilts' batch and first feed** | 19–20 Oct | The gilts join **BATCH-000008** (animal-wise) and each eats 2 kg on 20 Oct | *Batches*; card → Costing & Valuation |

**Costs as they stand (no costing run yet):** each sow **850.00**, each boar **1 200.00**. The 15 days of feed (**39.72**, 34 journals) went to expense
(Dr 5080), not into the animals, because each animal's costing had already begun on 1 Mar. Each gilt carries **60.00**: acquisition 0.00 + 2 kg × 30.00 of
feed, which **is** capitalised (Dr 1050 / Cr 1010), because her costing start is still ahead.

**Left for you:** the days after **15 Mar** are not entered (a day cannot be posted until the one before it is); the Data Entry page opens on 16 Mar.

## 2. How to test it

1. **The starting cost is right.** Open PIG-2025-0007's card → Costing & Valuation: acquisition **850.00**, book value **850.00**, one ACQUISITION row, **no** feed rows.
   The boar: 1 200.00. The feed is in *Finance → Journal* as 34 entries Dr 5080 Bio-Asset Consumption Expense / Cr 1010, adding up to **39.72**.
2. **Preview amortisation.** *Finance → Bio-Asset Costing Runs*: pick **BATCH-000006**, the date **31/03/2026**, **Calculate**. Two runs, one for each profile.
   You can check each by hand, charge = (book value − residual) × 30 ÷ days left:

   | Animal | Book value before | Residual | Days left | Charge |
   |---|---|---|---|---|
   | PIG-2025-0007 (sow) | 850.00 | 307.50 | 823 | **19.7752** |
   | PIG-2025-0008 (sow) | 850.00 | 307.50 | 837 | **19.4444** |
   | PIG-2025-0009 (boar) | 1 200.00 | 0 | 339 | **106.1947** |
   | PIG-2025-0010 (boar) | 1 200.00 | 0 | 353 | **101.9830** |

   Days left differ because each animal's life is counted from her own birth date (36 months for a sow, 18 for a boar). The sow's residual 307.50 is the
   company setting (150 kg × 2.05); the boar has none.
3. **Post, oldest month first.** *Post all* for March, then calculate and post April ... through **September**. A month cannot be run behind a later posted
   one (the screen says so: "already posted after 2026-03"). Expected totals, sows (IMP-F) / boars (IMP-M):

   | Month | Sows | Boars |
   |---|---|---|
   | Mar | 39.2196 | 208.1777 |
   | Apr, May | 39.2688 | 208.8392 |
   | Jun, Jul | 39.3220 | 209.6625 |
   | Aug | 39.3801 | 210.7510 |
   | Sep | 39.4410 | 212.0556 |

   After September: sows **711.23** and **713.55**, boars **451.00** and **481.01**. *Finance → Journal*: one journal per run, **1 743.21** in all
   (Dr 5100 amortisation expense / Cr 1065 accumulated amortisation).
4. **The books agree.** `pnpm nx run api:db-check-bio-asset-reconciliation` reports no cache drift and no batch difference (it did here). On screen,
   *Trial Balance* and *Bio-Asset Reconciliation* (1 Mar – today): the "costing runs tied to the general ledger" rows should show a difference of 0
   (the script was run; the two screens were not re-read on this run).
5. **After her start, feed is expensed; before it, capitalised.** The sows' and boars' feed above is the first half. For the second half open
   **PIG-2026-0006** (a gilt): acquisition **0.00**, one feed row on 20 Oct for **60.00**, book value **60.00**, "start 4 Mar 2027". Enter more feed for her
   on *Data Entry* (BATCH-000008): her book value rises, and no amortisation can run for her until her costing start. **There is no Mature step for these batches:**
   the Mature button is gone from an animal-wise batch and the API refuses it.
6. **Gilt selection on the screen.** *Livestock → Gilt Selection*: choose **BATCH-000007**, *Get produced piglets*: head **9**, carrying value **0.00**,
   sow PIG-2025-0007, boar PIG-2025-0009, **3 already selected, 9 left**. Ask for 2 gilts, *Create gilts*: type an RFID and teat count for each. A
   row with **14** teats shows "A gilt needs at least 15 teats to be selected" and *Create* stays disabled; at 15 it works. After it, the lot holds 7, the history lists
   GS-2026-00002, and each new gilt opens from the result list with sire, dam, LOC-F and her start date. (This path was driven in the browser on 21 Oct against a
   different weaned litter; on this data the first selection was made by the service.)
   **The cost per head is 0.00 here, and that is correct:** the sow's feed was expensed (step 1), so there is nothing capitalised to pass to her litter.
7. **Semen cost.** The lots show `unit_cost_per_dose` = 17.5246 ÷ 30 = **0.5842**: the boar's feed for the period over the doses. The lot's *amortisation*
   part is **0** because no amortisation had been posted when it was collected. (Not re-tested: collect a lot after a month is posted and check it is no longer 0.)
8. **A death clears the accumulated amortisation.** Record a death for boar 2 (`POST /batch/<BATCH-000006 id>/mortality`, body `animal_ids`, dated after the last
   posted month). Expected: one MORTALITY row equal to his book value that day; a `BIO_ASSET_EXIT` journal (Dr 1065 / Cr 1060) for his accumulated amortisation; the card at 0.
   The two always add up to his 1 200.00 cost (on 21 Oct, with September reversed, it was 584.83 and 615.17). **A month run after his death skips him**
   ("Left the farm after this period (settled in the exit)"): his value was written off whole, with that month's amortisation inside the loss, so charging it again would take
   him below nil. Seen on a database where July had never been run: the two sows and the other boar were charged, boar 2's line was skipped, and he stayed at 0.00.
9. **Reverse.** Reverse the latest posted run (*Finance → Bio-Asset Costing Runs → open it → Reverse*): the ledger rows and journal are mirrored, the card goes back
   (a sow's 711.23 became 731.11), and the month can be run again with the same result (39.4410 / 212.0556). **A run cannot be reversed once an animal in it has
   left the herd after that period** ("PIG-2025-0010 left the herd on 2026-10-15 ... cannot be reversed"): her exit was valued with the charge in it.

## 3. What is not covered, on purpose or not yet built
- The litter's cost is 0 and its piglets and gilts are costed from their own feed only. A mature sow's lactation feed is expensed, so it never reaches the litter;
  the lactation move (sow's card down, litter up) only has something to move for an animal whose feed was capitalised. If Finance wants that feed in the
  litter's cost it needs a journal (Phase 4, open). A gilt carries the batch's average value per head, which is 0 here.
- Sale, cull and transfer of an animal post no journal yet; registration and gilt selection post no GL entry (D8).
- The imported sows' 307.50 residual is above no purchase price here (850), so none is skipped; the cheaper demo animals show the skip.
