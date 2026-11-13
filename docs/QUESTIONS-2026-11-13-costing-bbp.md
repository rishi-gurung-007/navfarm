# Questions on bio-asset costing: for Rishi, Finance and Triple C (13 Nov 2026)

We compared the build with the Bio Asset BBP (BBP-2), BBP-1 and the TDD tracker. Most of it matches. These eight questions are what stops us finishing the rest; each one is a decision, not a technical matter.
Please answer in the "Answer" line under each. Anything left blank stays as it is today.

**What is already done and needs nothing from you:** the amortisation and fair value arithmetic, the start ages and lives, the gilt, purchase and death journals, piglet, weaner and grower lots no longer being matured or amortised, a registered batch showing what its animals are worth, and a Gilt Class Rules master (empty until you fill it).

## For Finance

### 1. Does a mature sow's feed go to her litter, or is it expensed?

- **BBP-2:** the sow's accumulated WIP cost, including feed, medicine and vet, is divided across the live piglets born (Dr Piglets Inventory / Cr WIP).
- **TDD rows 7 and 9:** feed is capitalised during the WIP period and expensed once the animal is in production.
- **Today:** a sow's feed is capitalised until her costing start date (birth plus 33 weeks) and expensed after. A mature sow therefore has nothing in WIP, so her litter opens at nil. Of 29 litters on the demo company, 22 opened at nil, and the gilts selected from them carry almost no cost.
- **Options:** (a) keep as is; (b) a mature sow's feed from mating to farrowing also goes to the litter (a journal from the feed expense to the piglet account); (c) both mating-to-farrowing and lactation.
- **What the BBP rules out either way:** the sow's amortisation is never part of the litter's cost.
- **Answer (13 Nov, from the project owner, awaiting Finance's confirmation):** yes, it goes to the litter: her feed from mating to the day before farrowing at birth, and her lactation feed (farrowing to weaning) at weaning. Her amortisation stays out. Built as a reclass journal from the feed expense to the piglet account, so her own book value and amortisation are untouched (see the plan, Phase F).

### 2. Quarantine cost: capitalised until stage release, or until the costing start date?

- **BBP-1:** an imported animal's feed, medicine and vet cost during quarantine is capitalised to the fixed asset (FA WIP) and moved to FA cost when the stage is released.
- **Today:** cost is capitalised until the animal's costing start date (birth plus 33 weeks for a sow, 26 for a boar), whatever stage she is in.
- **Why it matters:** an imported animal bought past her start age capitalises nothing from the day she arrives, so her book value stays at purchase price.
- **Answer:**

### 3. The fair value calendar for weaners and growers

BBP-2 S.NO.6: cost-based to week 17, fair value from week 18, monthly, per batch. For each lot the fair value is expected weight × approved price per kg.

- **We need:** the expected weight (kg) and the price per kg, by stage and by effective date, from week 18. Also whether fair value applies per lot or per cost centre.
- **We will not invent figures.** The week-18 run is not built until you give these.
- **Answer (13 Nov, from the project owner):** the calendar is a central setup the user customises, not fixed in code. It already exists as the *Fair Value Rates* on the biological item (farm or every farm, from which week of age, expected weight, price per kg, effective date, costs to sell), so it is edited in Master Data, not in code. What is missing is the monthly run that applies it to a weaner or grower lot (see the plan, Phase C). The client still has to enter the figures.

### 4. Accounts for separate Weaner and Grower WIP and inventory

BBP-2 asks for separate WIP accounts for weaners and growers, tracked per batch and per cost centre, with a step that recognises inventory from WIP. Today each piglet lot sits in one account (170400 Weaners Inventory).

- **We need:** the account for WIP Weaner, WIP Grower, Weaner inventory and Grower inventory, and whether the WIP-to-inventory step happens on a date, a week, or at the Weaner-to-Grower move.
- **Answer:**

## For Triple C (through Rishi)

### 5. Which item is "Local GGP"?

BBP-2 says a Z + Z gilt becomes a Local GGP. The company has no Local GGP item: only GP-Loc-F, GP-Loc-M, P-Loc-F and P-Loc-M. BBP-1's ten animal categories do not list GGP Local either.

- **Options:** (a) add a GGP-Loc-F item (and a male one if needed) with its accounts and costing terms; (b) treat Z + Z as Local GP.
- **Answer:**

### 6. The gilt class pairs

The class a gilt takes depends on her dam's line and her sire's line. The Gilt Class Rules master (Master Data, Piggery) is built and empty. A line is a breed (Z-Line, L-Line, Tempo, and the sow breeds such as Z-Line-Sow).

- **We need:** each dam breed and sire breed pair, and the item a gilt of that pair is registered as. The BBP gives Z + Z, Z + L and Z + Tempo as examples; the real list may be longer (for example, are the dam breeds Z-Line-Sow or Z-Line?).
- **Answer:**

## For Rishi

### 7. Transfer Order, kill sheet and DOA: build now?

Deferred on 20 Oct. BBP-1 describes the process (a Transfer Order line per batch per house, DOA posted back to the original batch, invoice = delivered quantity × average carcass weight × price per kg, revenue to the supplying farm) but gives no field specification. Until it is built, pigs leave a lot by the Dispose screen at average book value.

- **We need:** a yes or no, and if yes the fields for each document.
- **Answer:**

### 8. Boar amortisation inside the semen cost per dose

The BBP says amortisation never goes into WIP or finished-goods cost. The cost per dose of semen includes the boar's amortisation for the period. It does no harm today because doses enter stock at no value and are not charged to a sow or litter.

- **Options:** (a) leave it as information only; (b) take amortisation out of the dose cost now, so it cannot leak into a litter later.
- **Answer:**

## What each answer unlocks

| Question | Unlocks |
|---|---|
| 1 | Why litters open at nil; whether gilts carry a real cost |
| 2 | Cost basis of imported animals |
| 3, 4 | Week-18 fair value run and separate WIP accounts for weaners and growers |
| 5, 6 | Filling in the Gilt Class Rules, including Z + Z |
| 7 | The slaughter exit |
| 8 | Whether semen cost needs changing |

Questions 1 and 3 change the piglet and weaner numbers the most.
