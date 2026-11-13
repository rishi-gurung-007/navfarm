# The whole-project seed: 20 animals, two parities, every ledger

One script builds a herd from the goods receipt to the second weaning, through the application's own services, and a checker reads it back from MySQL against its
own arithmetic (25 checks, all passing on the run below).

```bash
pnpm seed:project
```

```bash
pnpm verify:project
```

**`pnpm seed:project` rebuilds nf_devco (it is dropped and recreated).** To keep nf_devco, point `DATABASE_HOST` / `DATABASE_PORT` at another local MySQL first.
Chapters: `02c-project-items` and `22-project-full` (`apps/api/src/scripts/demo/chapters/22-project-full.ts`); checker `verify-project-full.ts`;
`pnpm check:costing` now runs it as its sixth scenario.

## What it builds

| Step | What is posted |
|---|---|
| Items | The 12 items (imported amortised, local fair value) with the Fixed Asset sheet's terms, 22 GL accounts by the sheet's names (codes ours: 11xx, 41xx, 51xx), fair value rates |
| Stock | Goods receipts of medicines, then gestation mash every quarter, lactation diet before each round of farrowings, grower mash for the gilts |
| Animals | One receipt of 20 head (a line per item, a serial per head): 14 sows (7 imported, 7 local), 6 boars; females 20 weeks old, boars 22; registered with tattoo, breed, stage, pen |
| Batch | One Animal Wise batch, Bio Asset costing |
| Every week | Feed per animal as one ledger entry shared out per animal (lactation diet while nursing) |
| Every month | Housing and labour overhead per animal; a costing run (sow batch and gilt batch) Jan 2025 to Sep 2026 |
| Health | Dewormer and vaccine on arrival, PRRS before service |
| Semen | 24 lots: six boars on four dates, 30 doses each, four days before each round of matings |
| Parity 1 and 2 | AI with 2 doses, pregnancy check +28 days, farrowing +116, weaning +28, remating 5 days after weaning |
| Gilts | Four home-bred gilts selected at the weaning of the first litters of PF-SOW-01 and PF-SOW-03, with their own batch and fair value runs |

The two groups: **A** (7 sows) is served 24 Mar 2025, before their costing start of 7 Apr 2025. **B** (7 sows) is served 21 Apr 2025, after it.
Prices, ages, rations and litter sizes are demo facts. The 2026 fair value rate (150 kg x 2.35) is ours, added to show a rate by date. Accumulated amortisation
(1065) and write-off (5010) stand in for the two accounts the sheet does not name.

## The rules the seed shows, with its own numbers

**Capitalise before the costing start, expense from it.** Each animal's start is her birth date + the item's start weeks (females 33, boars 26). A sow's
book value at her start (PF-SOW-01, imported): 850 purchase + 106.17 feed + 36.00 overhead + 15.44 semen = **1,007.62**. Feed, overhead and semen dated on or
after 7 Apr 2025 are expensed and never enter her value (check C1, C2).

**Amortisation** (imported items). Charge = (book value - residual) x days in the run / days left to the end of life. Residual of a female = 150 kg x 2.05 =
307.50, none for a male. Days = 30 x the days she was costed in the month / the days in the month. Life ends at birth + 36 months (females) or 18 (males).
PF-SOW-01: April 2025 is 24 days (7-30 Apr) of 30, 864 days left: (1,007.62 - 307.50) x 24 / 864 = **19.45**. May: (988.17 - 307.50) x 30 / 840 = **24.31**.
Her book value is 559.02 by Sep 2026. The imported boar PF-BOAR-01 starts 3 Feb 2025 with no residual, so her 1,248.59 goes to nil in Feb 2026 when his 18-month
life ends; his next months are skipped as LIFE_COMPLETE.

**Fair value** (local items). Fair value = expected weight x price per kg; the charge is that minus the book value. PF-SOW-08 (local): 520 + 142.17 feed
and overhead = 662.17 at her start; April 2025 fair value 150 x 2.05 = 307.50, a **loss of 354.67**; no change after, until January 2026 when the rate becomes
2.35: 352.50, a **gain of 45.00**. The four gilts have only cost and feed (133.30) at their start in March 2026, so their one charge is a gain of about 219.

**Parity and the litter's cost.** Parity is 0 until the first farrowing, then 1, then 2. It does not decide cost: the costing start date does. What the litter
carries is only what the sow still had **capitalised** between her mating and the day before farrowing.
- Group A, parity 1: feed from 24 Mar to 6 Apr + the semen = 16.33 + 15.44 = **31.78** for PF-SOW-01 (25.44 for the sows served by the cheaper boar). That is
  the litter's cost at birth, spread over the piglets (about 2.9 each).
- Group B, parity 1 and every parity 2 litter: **nil**. The sow was past her start, so her feed and semen were expensed, and there was nothing capitalised to
  hand on.

So for a normal sow the litter starts at no cost. If Finance wants a sow's lactation feed to reach her litter, that is a design change (not built).

## Found by this seed

The weaning overwrote the litter's cost per piglet with nothing whenever no further cost moved at weaning, wiping the figure the litter was born with (as in
every group A litter). Fixed in `litter-cost.service.ts` (a litter that carries cost keeps it: cost at birth / piglets weaned), with a test.

## Last run (isolated MySQL, port 3399; 25/25 checks)

Posted runs: 182 (210 amortisation lines, 210 fair value lines). Account 1065 holds 6,689.84, equal to every amortisation charge. No journal is unbalanced.

## What it does not cover

Mortality, culls and the FA to inventory conversion (see `seed:costing-conv`), the Business Central push, the scheduler's own clock, and the web screens.
