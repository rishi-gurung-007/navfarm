# Bio-asset costing: close the differences from the BBP (13 Nov 2026)

Source: the Bio Asset BBP (BBP-2, "Business Central Bio Asset (Current - Non Current) Accounts, Finance, Costing"), BBP-1 and the TDD tracker, read against the code and `nf_devco` on 13 Nov 2026.
Rishi is the source of truth (AGENTS.md section 2); the BBP is reference. Every phase below that changes an interpretation is written to `docs/decisions.md` first.

What already matches and must not be redone: amortisation formula, start ages (33 / 26 weeks), lives (36 / 18 months), residual 150 kg x 2.05, run journal, one charge per animal and period,
imported = amortisation / local = fair value, no sow or boar amortisation in a litter's cost, litter birth cost, deaths relieved from the lot.

## The 13 differences, and the phase that closes each

| # | Difference | Phase | Needs a decision from |
|---|---|---|---|
| 6 | Piglet / weaner / grower lots can be matured and amortised; data-entry OUTPUT is blocked until Mature | **A (built 13 Nov)** | none (BBP S.NO.6: never amortised) |
| 13 | Batch carrying value ignores animal runs | **A2 (built 13 Nov)** | Rishi said yes; display only |
| 2 | Gilt class by mating line (Z+Z GGP, Z+L GP, Z+Tempo Parent) not built | **B (built 13 Nov)**: Gilt Class Rules master, by dam line and sire line | The client enters the pairs; Z+Z has no Local GGP item to map to |
| 1 | ~~Gilt selection posts no journal~~ **Wrong: built.** Registering a gilt posts Dr her item's acquisition account / Cr 170400 Weaners Inventory (BIO_GILT_ACQUISITION). Seen on nf_devco: JE-000285 to JE-000289, Dr 151100 GP-Loc-F / Cr 170400. | none, nothing to build |
| 4 | No week-18 monthly fair value for weaner / grower lots | **C (built 13 Nov, API only)**: the item's Fair Value Rates are the central setup the user customises | The client enters the figures and puts fair value terms on the item its lots are made of |
| 3 | No separate WIP and inventory account per lot and cost centre | C | Finance (accounts) |
| 7 | Transfer Order, kill sheet, DOA: no tables | D | Rishi (deferred 20 Oct; field specification missing) |
| 8, 9 | ~~No journal for purchase or death~~ **Wrong: built.** A goods receipt posts Dr class acquisition / Cr Trade Payables (JE-000004 to 000009); a death posts Dr Mortality Loss / Cr acquisition, and clears accumulated amortisation (JE-000761, JE-000762). | none, nothing to build |
| 5 | A mature sow's feed is expensed, so most litters open at nil | **F (built 13 Nov)**: her feed from mating to weaning goes to the litter by a reclass journal | Finance to confirm the window |
| 10 | Quarantine cost is capitalised to the costing start date, not to stage release | not built | Rishi |
| 11 | Boar amortisation sits inside semen cost per dose | not built | Finance (harmless while doses carry no value) |
| 12 | Business Central not connected | out of scope | AGENTS.md section 8 |

## Phase A. Piglet lots are never matured or amortised (BBP S.NO.6)

- **Rule.** A head-count lot of a litter (`is_litter_lot`) or a head-count batch in the Weaner, Grower or Finisher stage is a current biological asset. It accumulates cost and leaves by sale, harvest or output at its carrying value. It never takes the Mature step and is never amortised.
- **Code.** `BatchService.isCurrentBioLot`; `matureBioAsset` and `amortizeBioAsset` refuse such a lot; the OUTPUT line no longer needs Mature for it (it is credited to the pre-mature account as before); the web hides Mature and Run Amortization for it.
- **Proof.** Unit tests for the three paths, then the running API against `nf_devco`: mature refused, amortise refused, an OUTPUT line accepted on a LIT lot, the lot's carrying value and the journal agreeing, then undone.
- **Not changed.** Registered-animal batches (already refused), other head-count herds that are not piglet stages (poultry and the like keep Mature).

## Phase A2. The batch screen shows what its animals are worth

Runs and registrations carry no batch id (D8), so a registered batch's carrying value is capitalised cost only. Show the sum of the animals' book values (from the ledger) on the batch screen for registered batches, labelled as such, and leave the stored figure and the GL alone. Ask Rishi before building.

## Phase B. Gilt class by mating line (the journal itself already exists)

Correction of 13 Nov, found by reading `animal.service.ts` and the journals in `nf_devco` before building: differences 1, 8 and 9 in the first draft of this table were wrong. AGENTS.md section 9 ("registration posting to the GL and the loss legs on a death ... not built") is out of date. What is left of B is the class by mating line, item 1 below.

1. Mating line to class (BBP table). Config on the breeding line master, not a constant in code. The client's line-to-class mapping is theirs to give.
2. The journal: built (BIO_GILT_ACQUISITION, opt-in mapping, switched on in nf_devco). The debit is the gilt item's own acquisition account, so the class is whichever item the user names: that is why item 1 matters.
3. Proof when item 1 is built: select gilts from litters of each mating line through the API and read which item and which account each used.

## Phase C. Weaner and grower valuation

Monthly per-lot fair value from week 18 (cost before it), through the same one-run-per-period controls the engine has, plus separate WIP and inventory accounts per lot and cost centre. Needs the fair value calendar (expected weight, price per kg by stage) from the client. Do not seed figures.

## Phase D. Slaughter exit

Transfer Order, kill sheet, DOA to the original batch, invoice = delivered quantity x average carcass weight x price per kg. Deferred by Rishi on 20 Oct; the BBP gives the process but no field specification. Ask before starting.

## Phase E. Purchase and death journals

Built. Nothing to do (see the correction above).

## Order

A done; A2 and B1 (class by mating line) once Rishi answers; C and D after Rishi and Finance. E needs nothing. Each phase is proved by posting through the API and reading MySQL, not by the unit suite.

## Phase F. A mature sow's feed goes to her litter (decided 13 Nov: mating to farrowing, and lactation; her amortisation stays out)

Today a sow past her costing start has her feed and overhead expensed (Dr consumption expense, nothing on her ledger), so nothing is left in her WIP for the litter.

**Design (recommended): a reclass, not a change to her book value.**
- Capitalising her feed into her own book value would make it part of the carrying amount the amortisation engine charges against, and the BBP says amortisation stays out of WIP. So leave her book value and her amortisation alone.
- At farrowing (window mating date to the day before) and at weaning (farrowing to weaning), total the sow's expensed feed and overhead for the window from her batch transactions (animal_id, CONSUMPTION and OVERHEAD, not already on her bio-asset ledger as capitalised). Move that into the litter's lot: a positive COST_ALLOCATION row on the lot (new document types so the capitalised and expensed parts are never double-counted) and the journal Dr the lot's account (170400) / Cr the consumption expense account the feed was charged to.
- The lot's cost per piglet and each gilt's cost then include it. The sow's amortisation is never included.
- Idempotent per window like the existing moves: each run moves only what has not been moved.
- Proof: post feed for a mature sow, farrow and wean through the API, read `bio_asset_ledger`, `journal_line` and the lot's carrying value, then undo.

## Phase C. Weaner and grower lot fair value (central setup)

The calendar is the item's existing Fair Value Rates (farm or every farm, age band from week, expected weight, price per kg, effective date): the user edits it in Master Data. Phase C adds the run: for each weaner or grower lot, on the period end, age in weeks from the lot's birth date, pick the rate, fair value = head x expected weight x price per kg, adjustment against the lot's carrying value, posted Dr or Cr the lot's account / the item's fair value gain or loss account, with the same one-run-per-period controls as the animal runs. Cost-based before week 18 (the item's start age).
