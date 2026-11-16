# Manual check: Inventory Ledger, Bio Asset Ledger and animal costing

Seeded 25 Oct 2026 with `pnpm seed:ledger-check` (nf_devco, tenant `devco`, farms MUL100 and POR100).
Local test login: see `docs/MANUAL-TEST-full-flow.md` (`tenant.admin@triplec.local`).
**Restart the API on port 2877 first**: a server started before today runs the old code.

The seed is destructive. The databases before it are in `~/Desktop/navfarm-db-backups/20261025-003040`.

```bash
pnpm seed:ledger-check          # rebuild everything (several minutes)
pnpm nx run api:db-verify-ledger-types   # re-read both ledgers from MySQL
```

What it builds, in order, each part read back before the next is added:

1. The lean demo: stock receipts, a registered herd (BATCH-000001), a weaner batch (BATCH-000002), 14 days of daily entries, breeding, transfers, mortality.
2. The costing test (`CT-` names): 4 sows and 4 boars in BATCH-000003 / BATCH-000004, lived from January to September 2026, costing profiles assigned, monthly runs posted, a farrowing, a weaning, 5 gilts selected.
3. The ledger-type postings (`LT-` names): one posting of every Entry Type / Transaction Type pair the code can write.

## The allowed values

| Entry type | Transaction types that go with it |
|---|---|
| POSITIVE | PURCHASE, OUTPUT, VARIANCE_POSITIVE, TRANSFER_RECEIPT |
| NEGATIVE | CONSUMPTION, SALES, VARIANCE_NEGATIVE, TRANSFER_SHIPMENT |
| TRANSFER | TRANSFER_SHIPMENT, TRANSFER_RECEIPT |
| OVERHEAD | OVERHEAD (Inventory Ledger); CONSUMPTION (Bio Asset Ledger, capitalised feed and overhead) |
| DESCRIPTIVE | DESCRIPTIVE |

A reversal keeps the original's transaction type and flips the entry type; the Inventory Ledger marks it with `reversal_of_ledger_id`. There is no REVERSAL type.
The Bio Asset Ledger row also carries a **Document type**, which says which event it is (feed, amortisation, death, sale...).

## 1. Inventory Ledger (Inventory > Inventory Ledger)

Filter by Transaction type and check the entry type beside each:

| Transaction type | Entry type | Where to find it |
|---|---|---|
| PURCHASE | POSITIVE | the GRN and store receipts of chapter 02 |
| CONSUMPTION | NEGATIVE | daily feed entries (242 rows) |
| OUTPUT | POSITIVE | `LT-` harvest: 225 kg of dressed pork into the MUL100 store, and the 2 kg output; GL rule BIO_HARVEST / BIO_OUTPUT |
| TRANSFER_SHIPMENT | TRANSFER and NEGATIVE | stock transfer TR-000007 (shipped, received) and TR-000008 (posted in one step) |
| TRANSFER_RECEIPT | TRANSFER and POSITIVE | the same two transfers |
| VARIANCE_POSITIVE | POSITIVE | `LT-` stock adjustment +2 Penicillin vials |
| VARIANCE_NEGATIVE | NEGATIVE | `LT-` adjustment −1 vial, and the 1 DOA written off on TR-000007 |
| DESCRIPTIVE | DESCRIPTIVE | the daily observation (no stock moves; quantity is informational) |
| SALES | NEGATIVE | **not seedable**: nothing writes a sale to the Inventory Ledger yet |
| OVERHEAD | OVERHEAD | **not seedable**: needs a scheduler line of type OVERHEAD, none is configured |

Check: open one NEGATIVE CONSUMPTION row and read its costing (the FIFO layers it drew, rate and amount); the rate times quantity must equal the amount. The `GL mapping` column shows BIO_CONSUMPTION_PREMATURE / MATURE on the bio-asset feed rows, which is why one CONSUMPTION type is enough.

## 2. Bio Asset Ledger (Inventory > Bio Asset Ledger)

Columns to read: Entry type, Transaction type, Document type, Quantity, Cost amount. All rows below exist after the seed.

| Event | Entry | Transaction | Document | Example |
|---|---|---|---|---|
| Animals received on a GRN | POSITIVE | PURCHASE | GOODS_RECEIPT | `CT-` GRN-A, GRN-B |
| Batch bought | POSITIVE | PURCHASE | BATCH | LT-BATCH-A: 20 head at 150 = 3,000 |
| Batch born on the farm | POSITIVE | OUTPUT | BATCH | the piglet lots from farrowing |
| Animal registered | TRANSFER | TRANSFER_RECEIPT | ANIMAL_REGISTRATION | every animal |
| Feed capitalised | OVERHEAD | CONSUMPTION | BATCH | feed before the costing start; LT-BATCH-A 5 kg |
| Overhead capitalised | OVERHEAD | CONSUMPTION | BATCH_OVERHEAD | `CT-` overhead |
| Semen used by a mating, charged to the sow | OVERHEAD | CONSUMPTION | BREEDING_SEMEN | `CT-A-SOW-1` AI mating, 2 doses = 24.59 |
| Birth cost (sow gives / litter takes) | TRANSFER | SHIPMENT / RECEIPT | LITTER_BIRTH_COST | `CT-A-SOW-1` farrowing |
| Lactation cost (sow gives / litter takes) | TRANSFER | SHIPMENT / RECEIPT | LITTER_COST | `CT-A-SOW-1` weaning |
| Batch transfer out / in | TRANSFER | SHIPMENT / RECEIPT | BATCH_TRANSFER | the weaning move |
| Amortisation, costing run | NEGATIVE | VARIANCE_NEGATIVE | BIO_COSTING_RUN | 56 rows, Jan to Sep |
| Amortisation, batch | NEGATIVE | VARIANCE_NEGATIVE | BATCH_AMORTIZATION | LT-BATCH-A, −183.57 |
| Fair value gain / loss, batch | POSITIVE / NEGATIVE | VARIANCE_POSITIVE / NEGATIVE | BATCH_FAIR_VALUE | LT-BATCH-A: +, then −2,000 |
| Death | NEGATIVE | VARIANCE_NEGATIVE | MORTALITY | `CT-A-SOW-2`, 14 Jul |
| Gilt selected | TRANSFER | SHIPMENT | GILT_SELECTION | 5 gilts from the `CT-A-SOW-1` litter |
| Maturity marker | DESCRIPTIVE | DESCRIPTIVE | BATCH_MATURITY | LT-BATCH-A |
| Harvest | NEGATIVE | CONSUMPTION | BATCH_HARVEST | the output on LT-BATCH-A |
| Sale, batch / animal | NEGATIVE | SALES | BATCH_DISPOSAL / ANIMAL_DISPOSAL | 4 head at 260; `LT-ANIMAL-1` |
| Other exit, batch / animal | NEGATIVE | CONSUMPTION | BATCH_DISPOSAL / ANIMAL_DISPOSAL | 3 head harvested; `LT-ANIMAL-2` slaughtered |
| Manual entry | per entry | per entry | MANUAL_ENTRY | two entries (use Add entry) |

Not seedable: fair value from a costing run (BIO_FAIR_VALUE_RUN) needs a FAIR_VALUE costing profile, and none is set up.

Check on LT-BATCH-A (BATCH-000006), by hand: 20 head bought at 3,000; 5 kg premature feed at 0.575 capitalised (2.875); mature feed 3 kg expensed (1.725); head after 3 harvested and 4 sold = 13.

## 3. Costing on an animal

Open **Animals**, pick `CT-A-SOW-1`, then the book value panel. Then Finance > Bio-Asset Costing Runs.

- **Profile** (setup, editable per customer): females start at week 33 with a 36-month life, males at week 26 with 18 months. Start date = birth + start week.
- **Before the costing start**: feed is capitalised (adds to the animal's cost, ledger OVERHEAD / CONSUMPTION). **From the start**: feed is expensed (GL 5080) and the animal is amortised instead.
- **Runs**: monthly. 36 runs are posted for Jan to Sep; *Calculate* then *Post* the next month yourself. Amortisation = (book value − residual) × days ÷ remaining days. Auto-post and the scheduler (`BIO_COSTING_SCHEDULER_ENABLED=true`) are off, so nothing runs by itself.
- **Hand checks**: `CT-A-SOW-2` died 14 Jul, book value 0. `CT-A-BOAR-2` is fully written down in April (life ends 2 Apr 2026). Gilts carry the litter's cost per piglet, 5.6156, as their acquisition cost; their costing start is 26 Mar 2027, so they are not amortised yet.
- **Run a new month**: calculate for 2026-10 on the batches; the guards refuse a repeat month, a month behind a later posted one, and a month not yet ended.

## 4. Weaning with a new weaner batch

The `CT-B-SOW-2` litter (farrowed 11 Sep 2026, 11 head, litter LIT-000003) is not weaned yet. A litter is not a batch: it stays with the sow and is hidden from batch lists (it shows as "Litter of CT-B-SOW-2 ..." where a source is asked for). On Piggery > Breeding choose Wean and tick **Create a new weaner batch in stage**, pick the stage and pen, and save. Expect: a new batch copying the lot's item, company, line of business, farm and shed; the weaned head moved into it by a head-count transfer (Bio Asset Ledger BATCH_TRANSFER out and in); the lactation cost posted (LITTER_COST rows); the litter closed. The weaner batch takes the next BATCH number; litters take LIT numbers, so a farrowing no longer uses up a batch number. This changes the costing test's data, so re-run `pnpm seed:ledger-check` after.

## A litter with no cost

A litter's birth cost is the sow's *capitalised* feed, drug and overhead from the mating to the day before the farrowing. Feed from her costing start is expensed, and a sow with no feed entered in that window has none, so the litter opens at 0.00 and the gilts taken from it carry an acquisition cost of 0.00. The farrowing message and the gilt selection screen both say so. To give a litter a cost, enter the sow's feed from before the mating (in a batch that starts before it).

## Semen, animal exits and standard costing (26 Oct 2026)

- **Semen has a cost.** A collection's doses enter stock at the lot's cost per dose (boar amortisation + feed + drugs + overhead over the doses). The collection's journal and the semen stock now carry that value, not 0.00.
- **A mating charges the sow.** The doses are drawn from their own lot's receipt layer, so they cost what that lot cost. The Inventory Ledger row is named `AI <sow code>` and filed under the sow's batch. The same cost goes on the sow by the rule her feed follows: before her costing start it is **capitalised** (a Bio Asset Ledger row `BREEDING_SEMEN` on her, her batch's carrying value up, journal Dr 1050 / Cr 1030, `BIO_SEMEN_USE`) and so reaches her litter at the farrowing; from her costing start it is **expensed** (Dr 5080 / Cr 1030, `BIO_SEMEN_EXPENSE`). Either way it is a consumption on her batch against her, listed under "Feed & Medicine Consumed" on her card. Her card's Services & Matings table shows the semen lot, doses, cost per dose and the cost charged. Needs the two mappings (in the starter set); without them the doses are issued by the ordinary consumption mapping and nothing is put on her.
- **An animal's own exit posts a journal.** A sale, cull or slaughter clears what she was amortised (Dr 1065 / Cr her asset), books the proceeds (Dr 1200 / Cr 1060) and the gain or loss on her book value (Dr 1060 / Cr 4010; the opposite for a loss). A death with no batch to post it is written off to Mortality Loss at her book value. A transfer posts nothing. In the seed: `LT-ANIMAL-1` sold for 1,300 (gain 400: two journals), `LT-ANIMAL-2` slaughtered (a loss journal).
- **Standard costing posts a purchase price variance.** An item costed STANDARD goes into stock at its standard cost; what was paid above it is Dr 5030 Price Variance / Cr 2010 Payables, below it the opposite. Proven on a copy: a standard of 25, received at 30 and at 20, both stocked at 250, with variances of +50 and −50.
- **Animals are in the GL from the day they come on the books (27 Oct 2026).** A goods receipt of animals posts Dr Biological Assets (1050) / Cr Trade Payables (2010) for what it says they cost (`BIO_ACQUISITION`); an animal bought with no receipt posts the same at her registration; a gilt born on the farm posts Dr 1050 / Cr 1055 Piglets Inventory (`BIO_GILT_ACQUISITION`, switched on with the birth-cost journal). An animal that arrived on a receipt posts nothing again. A dead animal's write-off now takes out her whole book value, not only her capitalised cost. Result on your data: the GL's asset accounts net of accumulated amortisation (1065) agree with the Bio Asset Ledger to within 15.00 (the two manual entries, which have no journal), where before the GL held about 206,000 against 698,000. Animals received before this change have no acquisition journal. The roll-forward's GL reconciliation now includes 1065.
- **One asset account per class, and semen against a recovery account (27 Oct 2026).** An animal's purchase, her capitalised feed and overhead, the semen charged to her, her litter's cost leaving her, her exit and the clearing of her amortisation all move the **acquisition account of her costing profile** (1060 in your seed). Where no profile covers an animal (or the profiles that cover an item disagree), the mapping's account is used, as before. A pre-mature batch's output, harvest and sale now leave the pre-mature account (1050) instead of the mature one. Semen enters stock Dr 1030 Finished Goods / Cr **4040 Boar Cost Recovered** (`BIO_SEMEN_PRODUCTION`), so work in progress is no longer credited with nothing behind it. Result on your data: 1020 is 0.00 (was -1,007), 1060 is +10,951 (was -62,015), and the GL's 1050 + 1055 + 1060 + 1065 is 441,857.14 against 441,872.14 in the Bio Asset Ledger, the 15.00 being the two manual entries. The demo check "no biological asset account or work in progress is negative" guards this.
- **Still waiting for Finance** (shown as notes, not changed): amortising a local asset (profile screen, beside the profile); the litter cost window (stated in the farrowing message); weaner and grower profiles (a run refuses them with the reason, and the profile screen says so). The amortisation formula itself (the BBP's wording, not the workbook cell) is also Finance's to confirm.

## 5. Read-backs the seed already ran (all passed on the last run)

| Check | Result |
|---|---|
| `verify-demo-flow` on the lean flow | 23 of 23 |
| `verify-costing-test` | 109 of 109 |
| `db-verify-ledger-types` | OK, every pair present except the four listed above |

## Known gaps

- Two Inventory pairs and two Bio pairs cannot be posted (marked above).
- The costing test's gilt batch (BATCH-000005) has no scheduler line, so `verify-demo-flow` flags it if run after chapter 16; the preset runs it before.
- The web weaning form was not click-tested in a browser; the API path was proven on a scratch clone.
- Nothing is committed yet.
