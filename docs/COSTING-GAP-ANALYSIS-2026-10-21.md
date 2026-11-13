# Bio-asset costing — the flow end to end, and the gaps (21 Oct 2026)

Method: code read for each stage (file named), and `nf_devco` read back for the walkthrough group (`docs/TEST-GUIDE-costing-walkthrough.md`). "Built" means
it runs and was seen; "Gap" means it is missing or wrong against the TDD / BBP / Fixed Asset sheet or against itself. Items marked **decision** need the
client or Finance before anyone builds them.

## 0. When amortisation starts on the sow and the boar

Two ideas have been mixed:

| | Starts | Where it is | Status |
|---|---|---|---|
| **A. By age (per animal)** | Her costing start date = the later of **birth + 33 weeks** (sow) / **26 weeks** (boar) and her entry date. The first run is the month that holds it. | Central costing run (`bio-costing.rules.ts: costingStartDate`) | **Built. This is the client's sheet** ("Amortization / Fair Value Start Period: 33 Week / 26 Week") |
| **B. When the batch is made Mature** | The day the Mature button is pressed; the batch then amortises its carrying value over a life | Batch screen, headcount batches (`matureBioAsset`, `amortizeBioAsset`) | Built for the old headcount path only; **refused** for a batch whose animals have a costing profile |

The sow's start age is **33 weeks** (36 is her useful life in *months*). Option A does not depend on the Mature button, on mating, pregnancy or farrowing.
Option B is the wrong trigger for individually registered breeding stock: one switch for a batch of animals of different ages, and after it new feed is
expensed instead of capitalised. **Recommendation: A for animals, B only for headcount batches (weaners, growers).**

## 1. The flow, stage by stage

| # | Stage | What exists | Gap |
|---|---|---|---|
| 1 | **Biological asset item** (TDD "Item Card") | Item flag `is_biological_asset`, item type LIVING_ASSET, standard cost; 6 items in `nf_devco` | The TDD's **Bio Asset Costing tab on the item card** (method, start weeks, residual, life, residual-applicable gender) is not built: costing is a central profile instead, and `is_biological_costing_method` is never set (NULL). Sow and boar items are **not serial-tracked** (TDD: Serial No.). No Gender field on the item. |
| 2 | **GRN of the animals** | A bio GRN posts a PURCHASE row in the Bio Asset Ledger (quantity, rate); each animal registered takes one from it | **No GL journal at all** for a bio-asset GRN (by design, Rishi 14 Oct): the TDD's Dr FA Acquisition / Cr Vendor never posts (**D8, decision**). Cost is the GRN rate only: no freight, duty or quarantine cost. No PO link, no Business Central push or child fixed asset no. |
| 3 | **Animal register** | One animal per head: cost read off the GRN line, birth date, RFID, teats, TSI, grading, parents' serial numbers, costing profile + start date assigned automatically | The TDD check "register count must equal receipt quantity before post" is not enforced (a GRN can stay part-registered). **Main / child FA numbers** absent. |
| 4 | **Acquisition cost** | ACQUISITION row per animal in her ledger; book value derived from the ledger, never typed | Not in the GL (see 2). |
| 5 | **Residual value** | Company setting by sex and date (female 150 kg x 2.05 = 307.50, male none), animal override with reason, shown on the card | Figures need Finance's confirmation. The profile's own residual is now a legacy fallback. |
| 6 | **Capitalisation (feed, drugs)** | Per animal, for animal-wise batches, while the batch is pre-mature | Maturity is a **batch** switch: for a batch of mixed ages it flips every animal at once (see 0). GL goes to the batch accounts 1050/1060, not per-class accounts. |
| 7 | **Amortisation** | Monthly run per batch/profile; local animals now amortised too; ledger + journal; reversal; tie-out to the trial balance | D11 (formula wording) open; no stored "last/next amortisation date" on the animal; scheduler off by default; no BC push; per-class GL accounts (GGP/GP/Parent) not modelled. |
| 8 | **Breeding: semen** | Collection, lot with QR, doses in store; the lot records its cost per dose, **including the boar's period amortisation** | Doses enter stock **at no value**; the cost per dose is information only. **The semen used for an AI mating is not charged to the sow or her litter.** |
| 9 | **Mating, pregnancy check** | Built, back-dated safely, expected farrowing from the breed's gestation days | No cost is taken for the mating or the pregnancy period. |
| 10 | **Farrowing, litter** | Litter held as a piglet lot (a headcount bio-asset batch), parity raised, `cost_per_piglet` field | **The lot opens at nil value** (the code says births have none "until the accounting for births is decided"); the item's standard cost (58.33) and the TDD's "piglet at standard cost" are not used (**decision**). |
| 11 | **Weaning: sow's cost to the piglets** | The sow's lactation-period **feed, drugs and overhead** (farrowing to weaning) move to the piglet lot, spread over the piglets weaned (`allocateLactationCost`) | **Her amortisation is not included**, nor her pregnancy-period cost, nor the semen. **The move is made on the sow's *batch* value only:** the sow's own animal ledger is not reduced, so the same feed stays in her book value and is also in the litter (counted twice at animal level). No GL entry. (From the code; not run.) |
| 12 | **Gilt selection** (TDD row 6 event 2) | **Nothing.** | No selection screen, no "get produced piglets", no buffer page to assign RFID/birth date, no "Create Gilts". Selected gilts are **not** deducted from the piglet lot, not **registered automatically**, no card opens, **no cost / lineage (sire, dam, TSI of sow) carries over**, no GL (Dr Local Acquisition / Cr Piglets). The only way in is the animal master form: entry type BORN_ON_FARM + source batch + a **hand-typed** cost. The BBP's teat count of 15 as a hard block on selection is not enforced anywhere. |
| 13 | **Home-bred animal costing** | — | A BORN_ON_FARM / TRANSFERRED_IN animal gets **no costing profile**, so she is never amortised (**D2, decision**: is she "Local"?). |
| 14 | **Death, sale, cull** | Death writes one write-off and clears accumulated amortisation | Loss and gross-cost legs and all GL (D8); sale/cull/transfer post nothing and the conversion record / Finance approval is not built. |
| 15 | **Reports** | Roll-forward by profile, tie-out to GL, reconciliation script | Piglet lots and home-bred animals sit in "no profile / batch-level" lines. |

## 2. The gap list, in the order I would close them

**A. Wrong numbers today (fix first)**
1. **Lactation allocation double-counts** (row 11): reduce the sow's own animal-level book value when her lactation cost moves to the litter.
2. **Litter opens at nil** and **the semen used is never charged** (rows 8, 10): the litter's cost misses what the sow and the boar cost.

**B. Missing flow (the client's documents ask for it)**
3. **Gilt selection and the automatic animal card** (row 12): select from the weaned piglets, assign RFID/birth date/teats, create the animal with sire/dam/TSI from the litter, deduct the piglets, and **carry the cost per head from the sow's costing**; open the new card.
4. **A costing profile for home-bred animals** (row 13) once the client says what they are (D2).
5. **Per-animal maturity** for animal-wise batches (rows 0 and 6): decide capitalisation by each animal's start date, not by the batch button.

**C. Accounting (needs Finance)**
6. **GL for the purchase** (D8) and the **loss legs on death**, and **piglet / gilt acquisition entries**.
7. **Sow amortisation in the litter's cost**: which window (lactation or whole parity) and the journal that moves the expense to the piglets (otherwise it is double-counted).
8. **Real accumulated-amortisation and impairment accounts**; per-class accounts.

**D. Design points to confirm with the client**
9. Item-card Bio Asset Costing tab vs the central profile; serial tracking on the sow/boar items; Gender on the item.
10. D11 (amortisation formula wording), D5 (costs to sell), residual 150 kg x 2.05.
11. Sale / cull / transfer treatments; Business Central pushes (not part of this build).
