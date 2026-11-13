# Plan — litter costing and gilt selection (bio-asset costing, part 2)

**Date:** 21 Oct 2026 · **Asked by:** Arun, after the end-to-end review in `docs/COSTING-GAP-ANALYSIS-2026-10-21.md`
**Sources:** `Final TDD_V1.csv` rows 6 (Acquisition, New-born GP and Parent), 7 (Capitalization), 9 (Consumption), 10 (Mortality), 12 (Output of piglet);
`Amortization,Fairvalue & Bio Asset(FIXED ASSET).csv` (the Loc rows: "Debit: GP/P Local Acquisition Cost, Credit: WIP Local / Weaners", PIGLETS: fair value from week 17).
**Rule of the project (AGENTS.md):** a phase is done when the write has been made through the app and read back from MySQL. A green suite is not evidence.

## What the TDD says about gilt selection (row 6, Event 2: "GILT SELECTION, UI in NAVFarm")
- **Header:** farm (main location), farm name, batch no., sub-location, sub-sub-location, production week.
- **Sub-form line:** select, piglet item, lineage sow / parity, lineage boar no., colour coding, no. of piglets produced, TSI of the sow, no. of gilts selected.
- **Buttons:** *Get Produced Piglets* (fetches the piglets of this batch from the inventory ledger, entry type Output, and fills the lines with their lots);
  *Create Gilts* (opens a temporary buffer page).
- **Buffer page:** original batch no., lot no., sow no., boar no., **RFID no. (manual, the operator assigns it to each gilt)**, date of birth, batch week, item no.
  (the item with Bio Asset = true, fetched from the original batch).
- **On confirm, NAVFarm creates:** an inventory register entry for the piglet item (**negative**, the piglets are reduced by the number of gilts), an inventory register
  entry for the fixed-asset item (**positive**), **one animal register row per selected gilt**, and a general register entry.
- **Accounting:** *Dr GP/P-Local Acquisition Cost / Cr Weaners Inventory* (the piglets leave), and in BC *Dr FA Acquisition / Cr WIP-Local*.
- **BBP (S.NO.5):** the selected gilt becomes a Local asset at "the accumulated eligible carrying amount transferred from the current biological asset / WIP account";
  classed by the mating line (Z+Z = Local GGP, Z+L = Local GP, Z+Tempo = Local Parent); below 15 teats is a hard block on gilt selection whatever the TSI.

## Phases

### Phase 1 — A batch of registered animals has no herd Mature step — **DONE 21 Oct, uncommitted**
The Mature Herd button, and Run Amortization / Record Fair Value after it, are removed from an animal-wise batch's card, which says where costing is done instead.
The API refuses `matureBioAsset` for an animal-wise batch. **Proof:** the batch card of BATCH-000001 (animal-wise) shows no Mature button; `POST /batch/:id/mature` returns 400;
a headcount batch still shows it. **Open:** see Phase 2: without a Mature step something else must say when an animal's feed stops being capitalised.

### Phase 2 — Per animal, feed is capitalised until her costing start date — **DONE 21 Oct, uncommitted; consequence awaiting Finance**
Today an animal-wise batch stays PREMATURE for ever, so every feed entry is added to the animals' value and keeps raising it after amortisation has begun. TDD rows 7 and 9: cost
**capitalised in the WIP period** (before the start age: 33 weeks sow, 26 boar), **expensed in production** (after it). Change the capitalise-or-expense choice from the batch's stage to
**each animal's costing start date**: a feed line for an animal dated before her start is capitalised; on or after it, expensed to the consumption account; an animal with no start date is
capitalised as now. **Decision for Arun/Finance:** an animal bought already past her start age (the walkthrough group) then capitalises nothing, and her book value stays at her purchase
price. Files: `batch.service.ts` (`postConsumptionGroup`, `addTransactionInner`, overhead), `batch-day-reversal.service.ts`. **Proof:** two animals in one batch, one before and one after her start;
one posted day; the ledger shows a CONSUMPTION row for one and an expense journal for the other.

**Done:** `BatchService.postConsumptionGroup` (a mixed group becomes two entries, `splitLots`) and `addTransactionInner` (consumption and overhead) decide by `animalsPastCostingStart`; no change to `batch-day-reversal.service.ts` (it keys on each entry's type). **Proof (nf_devco, API on a separate port, DB restored afterwards):** BATCH-000002, feed dated 20 Aug 2026 for PIG-2026-0004 (start 24 Aug) and PIG-2025-0005 (start 17 Aug): PIG-2026-0004 got a `BIO_CONSUMPTION_PREMATURE` entry, a CONSUMPTION row on her bio-asset ledger (1.8334) and her card rose 650.0000 -> 651.8334 (JE Dr 1050 / Cr 1010); PIG-2025-0005 got `BIO_CONSUMPTION_MATURE`, no ledger row, card unchanged at 850.0000 (JE Dr 5080 / Cr 1010). **Not run live:** the group path (a day post with several animals); covered by three specs only. **Open:** the walkthrough group is bought past her start age, so nothing is capitalised for her; the walkthrough and its guide need a young animal to show capitalisation (Phase 7).

### Phase 3 — The lactation allocation stops double-counting — **DONE 21 Oct, uncommitted**
`allocateLactationCost` moves the sow's lactation feed, drugs and overhead from her **batch's** value to the litter's but leaves it in **her own** book value. Write the negative row against the
sow (animal-level) as well, keep the batch-level pair, and record the cost per piglet. **Proof:** weaned litter: the sow's card falls by the amount, the litter's lot rises by it, the two sum to
what they did before; `cost_per_piglet` = amount / weaned. Files: `breeding.service.ts`, `animal-book-value.service.ts`.

**Done:** `allocateLactationCost` writes the sow's own part against her ledger, the rest at batch level, the whole to the lot (`capitalisedLactationCost` reads what is capitalised from the ledger); `COST_ALLOCATION` counts in the animal's derived value, the roll-forward and `check-bio-asset-reconciliation`. **Proof (nf_devco, separate API port, DB restored afterwards):** PIG-2025-0008 (start date cleared for the test, so her feed was capitalised): three feeds of 6 kg in lactation, farrowed 5 Oct (10 born), weaned 19 Oct (9; 1 lost). Her card 809.7821 -> 793.2815 (-16.5006); her batch BATCH-000006 NCA 58.5503 -> 42.0497; the lot BATCH-000008 0 -> 16.5006; cost_per_piglet 1.8334 = 16.5006 / 9; ledger rows -16.5006 (sow) and +16.5006 (lot); the reconciliation script reported no cache drift and no batch difference. **Consequence:** a sow past her costing start has her feed expensed (Phase 2), so nothing passes to her litter by this route (decisions.md, 21 Oct).

### Phase 4 — What a litter is worth: birth value, semen, and the sow's amortisation — **needs Finance**
- **Value at birth.** The lot opens at nil ("until the accounting for births is decided"). Options: the item's standard cost (TDD row 6: "Piglet item cost = Standard Cost"), or nil with the whole
  cost arriving at weaning.
- **Semen.** The doses used for an AI mating enter stock at no value; the cost per dose on the lot (feed, drugs, overhead, the boar's amortisation) is information only. Charge each mating's
  dose cost (doses x the lot's cost per dose) to the sow's parity so it reaches her litter.
- **The sow's amortisation** in the parity (lactation only, or mating to weaning) moved to the litter: a real journal (Dr piglet asset / Cr amortisation expense), otherwise it is counted twice.
Each is a setting on the company costing setup, off until Finance answers, so nothing changes silently. **Proof:** a parity run with each switch on, the litter's cost per piglet, and the
journals read back.

### Phase 5 — Gilt selection, the engine (API and data) — **DONE 21 Oct, uncommitted (API only; screen is Phase 6)**
- **Tables (migration):** `gilt_selection` (header: farm, batch, sub-location, production week, status DRAFT/POSTED) and `gilt_selection_line` (piglet item, farrowing/lot, sow, parity, boar,
  colour code, piglets produced, TSI of sow, gilts selected), plus the per-gilt buffer rows (RFID, date of birth, batch week, teats).
- **Get Produced Piglets:** read the batch's litters (farrowing records / piglet lots) and fill the lines.
- **Create Gilts (one transaction):** refuse a gilt with fewer than **15 teats** and refuse a duplicate RFID; reduce the piglet lot by the number selected (the TDD's negative piglet entry); register each
  gilt (`BORN_ON_FARM`, source batch = the litter's lot, sire from the mating, dam = the sow, TSI of the sow, birth date from the farrowing, an Animal Wise batch if named); **carry the cost**: the lot's
  carrying value per head moves to each gilt as her acquisition cost (the cost that came from the sow's lactation, Phase 3); the registration hook gives her a costing profile (**Local**, decision D2).
- **GL:** *Dr Local Acquisition / Cr Piglets* is **ledger-only until Finance settles D8**; the animal and lot ledgers carry both sides.
**Proof:** weaned litter of the walkthrough sow -> select 3 gilts -> lot 12 -> 9; three new cards with sire/dam/TSI, cost per head, a profile and a start date; the ledgers and MySQL agree.

**Done:** migration 0215 (`gilt_selection`, `_line`, `_gilt`), `modules/piggery/gilt-selection` (service, controller, DTOs, rules), `BatchService.releaseHeadToAnimals`, BORN_ON_FARM -> Local in `originOf`. **Proof (nf_devco, separate API port, DB restored afterwards, migration 0215 left applied):** sow PIG-2025-0008 farrowed 5 Oct (10 born), weaned 9 with 16.5006 lactation cost on the lot BATCH-000008. *Get Produced Piglets* -> head 9, value 16.5006, 1.8334 per head, boar PIG-2025-0010, sow TSI 121. Refusals: 10 of 9 ("holds 9 piglets"), a gilt with 14 teats (nothing moved: lot still 9 / 16.5006, no animal). Create Gilts with 16/15/17 teats -> POSTED (GS-2026-00001), lot 9 -> 6 head and 16.5006 -> 11.0004, one TRANSFORMATION row -3 / -5.5002, three cards PIG-2026-0006..8 (GILT, BORN_ON_FARM, dam PIG-2025-0008, sire PIG-2025-0010, source BATCH-000008, ACQUISITION 1.8334 each = 5.5002, LOC-F, costing start 2027-05-24 = birth + 33 weeks), buffer rows with RFID / teats / batch week 43; the piglets endpoint then shows 3 selected, 6 left; the reconciliation script: no drift, no batch difference. The first live attempt failed (farm scope needs a placement) and rolled back cleanly; fixed by defaulting the gilts to the piglets' location. **Not run live:** the animal-wise-batch placement and a litter reached through a WEANING transfer (specs only).

### Phase 6 — Gilt selection, the screen, and the card that opens — **DONE 21 Oct, uncommitted**
*Livestock > Gilt Selection* (or under Batches): the header, "Get produced piglets", the lines, "Create gilts" with the buffer form for the RFID / birth date, the teat check shown per gilt,
and, when it posts, the new cards open (a list of the gilts with a link to each). **Proof:** driven in the browser end to end; the new animal card shows her lineage, cost, profile and
start date.

**Done:** `/livestock/gilt-selection` (Livestock sidebar > Gilt Selection, hidden for Dairy; `gilt-selection-panel.tsx`, rules in `gilt-selection-rules.ts`): batch, date, production week, animal-wise batch to join; *Get produced piglets* (head, value, value per head, litters with sow / parity / boar / TSI / lot / born alive / weaned / already selected / left); gilts per litter and a colour code; *Create gilts* opens the buffer (RFID, teats, birth date defaulting to the farrowing date) with the 15-teat and duplicate-RFID blocks shown inline; on success the gilts are listed and each opens its card; a history of selections. **Proof (browser on a second web instance and API, DB restored afterwards):** signed in, Piggery area, Livestock > Gilt Selection; BATCH-000008 -> 9 piglets, 16.50, 1.83 per head, sow PIG-2025-0008, boar PIG-2025-0010, TSI 121; 3 gilts from the litter (colour BLUE); a 14-teat row showed "A gilt needs at least 15 teats to be selected." and disabled Create, cleared at 15; Create 3 gilts -> GS-2026-00001 posted, "3 piglets left the batch, carrying 5.50", links PIG-2026-0006/8/7; the card of PIG-2026-0006 shows RFID UI-G1, GILT, born on farm, sire PIG-2025-0010, dam PIG-2025-0008, acquisition 1.83, one ACQUISITION posting, residual 307.50 (company setting); MySQL agrees (lot 9 -> 6 head, 16.5006 -> 11.0004; LOC-F, start 2027-05-24); no console errors. **Not done:** the card's "Source batch" shows the batch's id rather than its number (existing card behaviour); a mobile-width pass; the animal-wise-batch placement and a litter reached through a weaning transfer, not driven live.

### Phase 7 — The walkthrough, the guide, and the records — **DONE 21 Oct, uncommitted**
Extend `db-costing-walkthrough` (sow 1's litter -> gilts), update the test guide, `decisions.md`, `AGENTS.md`. **Proof:** the guide run from a clean database.

**Done:** chapter 14 gains step 6 (gilt selection, the gilts' batch and first feed) and is re-runnable; the costing seed's effective dates start 1 Jan 2026; the guide is rewritten from a clean `pnpm seed:costing` database with every number read back (see decisions.md, "The walkthrough ends with gilt selection"). The clean run found a reversal defect and a late-run-after-death defect, both fixed (see decisions.md). `nf_devco` was restored afterwards. The residual and profile dates were corrected by SQL on the clean database rather than by a second rebuild.

### Phase 8 — Blocked on Finance and the client
GL for the purchase receipt, the loss legs on death, gilt/piglet acquisition entries (D8); real accumulated-amortisation and impairment accounts; per-class accounts (GGP/GP/Parent);
the item card's Bio Asset Costing tab and serial tracking on the sow/boar items (TDD "Item Card Customization"); sale, cull and transfer; D2, D5, D11.

## Order and gates
1 (done) -> 2 (decision) -> 3 -> 5 -> 6 -> 7; 4 and 8 wait on Finance and can run in parallel with 5-6 once answered. Phase 5 needs Phase 3 (the cost it carries).
