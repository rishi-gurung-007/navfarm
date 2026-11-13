> **22 Oct 2026, evening: the data this guide describes was dropped.** The database was rebuilt with the costing test seed (4 sows + 4 boars in 2 batches, `pnpm seed:costing-test`); read `COSTING-TEST-REPORT-2026-10-22.md`. This guide still describes the `WALK-` / `FLOW-` seeds, which exist only as on-demand chapters (`db-costing-walkthrough`, `db-full-flow`).

# Full-flow test — one imported sow and one imported boar, from the purchase to the gilts

**What this is:** `pnpm nx run api:db-full-flow` (on demand, safe to repeat, never part of a rebuild) lives the **whole costing chain on two animals you can
follow by hand**: purchase, registration, a batch, weekly feed and overhead, health, monthly costing runs, semen, AI mating, pregnancy check, farrowing with the
litter's birth cost, gilt selection at the weaning, and the gilts' own batch. Every step goes through the application's own services, dated in order,
nothing in the future (chapter `apps/api/src/scripts/demo/chapters/15-full-flow.ts`). It sits beside the older group of `docs/TEST-GUIDE-costing-walkthrough.md`
(`WALK-…`); this one is `FLOW-…` and uses its own batches, stock and runs.

It was run on `nf_devco` on 22 Oct 2026 (after a backup) and every number below was read back from MySQL. The bio-asset reconciliation
(`pnpm nx run api:db-check-bio-asset-reconciliation`) shows no difference for any animal or batch, and no journal is unbalanced.

## 1. The two animals

| | Sow `FLOW-IMP-SOW-01` — **PIG-2025-0011** | Boar `FLOW-IMP-BOAR-01` — **PIG-2025-0012** |
|---|---|---|
| Bought | 5 Jan 2026 at **850** | 5 Jan 2026 at **1 200** |
| Born | 6 Oct 2025 (13 weeks old on arrival) | 4 Aug 2025 (22 weeks old on arrival) |
| Profile | **IMP-F** (start = birth + 33 weeks) | **IMP-M** (start = birth + 26 weeks) |
| Costing start | **25 May 2026** | **2 Feb 2026** |
| Papers | parents DK-LR-91207 / DK-LR-80455, TSI 120, grading 87, 14 teats | parents DK-DU-60118 / DK-DU-59340, TSI 127, grading 91 |

Both are in **BATCH-000008** (`FLOW-BATCH`, animal-wise, from 5 Jan). Goods receipt of the animals: reference `DEMO-FLOW-GRN`. Feed stock was received into the MUL100
store first (`DEMO-FLOW-FEED-GESTATION` 1 600 kg on 5 Jan, `DEMO-FLOW-FEED-LACTATION` 300 kg on 24 Jul, `DEMO-FLOW-FEED-GILT` 100 kg on 14 Sep): a silo holds one feed item,
the sow needs two.

## 2. What happened, in date order

| Date | Step | Where to look |
|---|---|---|
| 5 Jan | Receipt, registration, batch; profiles assigned | Goods Receipt; Animal Register; Batches |
| every Monday 5 Jan - 28 Sep | Feed per animal (boar 19.6 kg/week of gestation mash; sow 17.5 kg/week, **42 kg/week of lactation diet while she nurses**) | Batch → transactions; Inventory Ledger |
| 15th of each month | Housing/labour overhead 12.00 per animal | Batch → transactions |
| 7 / 9 Jan, 25 Mar | Dewormer and vaccine on both; PRRS vaccine on the sow | card → Health & Treatments |
| end of each month Jan - Sep | Costing run for the batch (IMP-F and IMP-M), calculated and **posted**, in order | Finance → Bio-asset costing runs |
| 10 Apr | Semen collected: 30 doses, **LOT-00006** | Breeding → Semen |
| 13 Apr | Sow inseminated by AI (2 doses); pregnancy confirmed 11 May | card → Breeding & Lifecycle |
| 7 Aug | Farrowing (116 days): **13 live, 1 stillborn**; litter lot **BATCH-000009** (`FLOW-SOW-01-LITTER`, lot LOT-00007) | Breeding → Farrowing & Litters |
| 4 Sep | **Weaning** (day 28): 12 weaned (1 piglet lost before weaning is recorded as mortality) and, in the same form, the litter's **one gilt selection: 5 gilts** (BBP: once per litter; the Select gilts button disappears once a litter is weaned) | Breeding |
| 21 Sep | The 5 gilts join **BATCH-000010** (`FLOW-GILT-BATCH`) and eat 2 kg each (capitalised) | Batches |

## 3. The numbers to check

**The boar** (costing start 2 Feb, so his first four Mondays are *capitalised*, the rest *expensed*)
- Cost 1 200.00 + capitalised feed 36.59 + overhead 12.00 = **1 248.59** book value when amortisation starts.
- Run 2026-01: skipped `NOT_STARTED`. Run 2026-02: charged **98.69** (28.93 days of 366 remaining), then 101.76, 102.09, 102.09, 102.50, 102.50, 103.06, 103.72 — his life ends **3 Feb 2027**.
- Book value after the September run: **432.17**. Eight AMORTIZATION ledger rows, each with a journal.

**The sow** (start 25 May: feed and overhead from 5 Jan to 18 May are *capitalised*, after that *expensed*)
- 850.00 + capitalised feed 163.34 + overhead 60.00 = **1 073.34**; runs Jan - Apr skipped `NOT_STARTED`; May charged **6.00** (6.77 days), June and July **26.60**, residual **307.50** (150 kg x 2.05).
- **Semen cost.** LOT-00006 costs **364.51** over 30 doses = **12.150387 a dose**: amortisation 200.45 (the boar's Feb + Mar charge), feed 128.06, overhead 36.00. It is information, the doses are in stock at no value.

**The litter**
> Seed changed on 22 Oct (after the screen was checked): the gilts are now selected **once, in the weaning form**. A database seeded before that change shows three selections (28 Aug, 4 Sep, 14 Sep); a fresh run shows one. The costs below are the same either way.

- **Birth cost 73.00** moves from the sow's ledger (`COST_ALLOCATION`, `LITTER_BIRTH_COST`, 7 Aug) into the lot: her capitalised cost from her mating (13 Apr) to the day before farrowing, **only up to 24 May** because
  her costing started on 25 May and her feed after that was expensed; 73.00 / 13 live = **5.6156 a piglet**. Journal **JE-000224**: Dr 1055 Piglets Inventory / Cr 1050 (mapping `BIO_LITTER_BIRTH`, created by the seed if missing).
- The sow's August run therefore opens at 941.14 (1 014.14 - 73.00), charged 23.88.
- **Lactation cost to the litter is nil here**: she was past her costing start, so her lactation feed was expensed (5080), nothing is "capitalised lactation cost" to move; the weaning stores no `cost_per_piglet`. This is the open "sow past start" point (see `docs/decisions.md`, open items), shown on purpose.
- Lot movements (13 head in): 4 Sep mortality 1 (5.62) and 5 gilts out (28.08); **7 head left worth 39.31**. Weaned total stored: 12.

**The five gilts** (`FLOW-GILT-01..05` = PIG-2026-0007 … -0011, BORN_ON_FARM, Local, profile LOC-F, costing start **26 Mar 2027**)
- Each carries cost **5.6156** (her share of the sow's birth cost), sire and dam of the litter, teats 16 / 15 / 16 / 17 / 15 (15 is the minimum), and after her first feed a book value of **6.7656** (+1.15 capitalised feed).

## 4. How to re-check by hand

```sql
-- the ledger of one animal, by kind
SELECT l.entry_type, l.document_type, COUNT(*) n, ROUND(SUM(l.cost_amount),2) amt
FROM bio_asset_ledger l JOIN animal_register a USING (animal_id)
WHERE a.rfid_tag IN ('FLOW-IMP-SOW-01','FLOW-IMP-BOAR-01') GROUP BY 1,2,a.rfid_tag;
-- the runs' lines
SELECT a.rfid_tag, r.period_key, l.status, l.skip_reason, l.book_value_before, l.charge, l.book_value_after
FROM bio_costing_run_line l JOIN bio_costing_run r USING (run_id) JOIN animal_register a ON a.animal_id = l.animal_id
WHERE a.rfid_tag LIKE 'FLOW-IMP%' ORDER BY a.rfid_tag, r.period_key;
```

In the app: open each animal card → **Costing & Valuation** (start date, residual, book value, ledger); *Finance → Bio-asset costing runs* (BCR-2026-00017 … 00034); *Livestock → Breeding*
(semen lot cost, farrowing, **Gilt Selections** history with parents); the Journal for the BIO_COSTING_RUN and BIO_LITTER_BIRTH entries.

## 5. Things you can still do by hand (the run stops at 30 Sep)

- Enter October's feed and run **2026-10** after 31 Oct (a run cannot be made behind a later one: reverse the later run first).
- Sell or cull the boar; record a death; register more gilts; weigh and grade the gilts; farrow the sow again (re-mate her first).
- Re-run the chapter: nothing is posted twice (animals by RFID, transactions by batch/animal/date/kind, mating by sow/date, runs by profile/period/batch).

## 6. Choices made in the seed (ours, not the client's)

Ages (sow 13 / boar 22 weeks on arrival) chosen so each animal passes through *capitalise → expense/amortise*; a weekly (not daily) feed entry on Mondays; a monthly overhead of 12.00 per animal
with no resource; the sow is served at 27 weeks (before her 33-week costing start) so that part of her pregnancy is capitalised and reaches the litter; weaning at 28 days; the weaner mash for the gilts' first feed.
