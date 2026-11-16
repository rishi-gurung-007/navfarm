# Plan — closing the gaps between `Final TDD_V1.csv` and the code

**Date:** 28 Oct 2026 · **Asked by:** Arun, after the row-by-row review of the TDD against `apps/api` (this session)
**Sources:** `Final TDD_V1.csv` (item card + rows 1–12), `AGENTS.md` §7–§9, `docs/decisions.md` to 28 Oct, `docs/COSTING-GAP-ANALYSIS-2026-10-21.md` (partly stale, see Phase 1).
**Method of the review:** code and documents read. Nothing was run: no app, no MySQL, no tests. Phase 0 exists to fix that before anything is built on it.
**Rules that apply (AGENTS.md):** Rishi is the source of truth and the TDD is reference. Record a decision in `docs/decisions.md` *before* building its interpretation.
A phase is done when the write has been made through the app and read back from MySQL. Business Central is **not connected**: no fake BC calls, references or success states.

## 1. Where the TDD stands (from the review)

| TDD row | State | Phase |
|---|---|---|
| Item card | Partial — no NavFarm-Item flag, no Gender on item, no Fixed-Asset flag, no costing tab (central profile instead) | 2 |
| 1 Dimensions | Partial — `cost_center_master` only; no Dimension 1/2 setup or values | 2 |
| 2 Vendor | Partial — no contact name, purchaser code or sync status | 1 |
| 3 Requisition | Built (BC push is the only part missing) | 5 |
| 4 Purchase Order | **Not built** — no PO table; `linked_po_no` is typed by hand | 2 / 5 |
| 5 GRN | Partial — no "animals registered = qty" rule, no child/main FA numbers, no Value Entry / Adj. Entry | 2 / 5 |
| 6 Gilt selection | Built; cost basis and GL classing differ from the TDD | 3 |
| 7 Capitalization | Built; GL goes to batch accounts, not per-class | 3 |
| 8 Amortization / FV | Built; profiles are DRAFT; formula open; last/next date not stored | 1 / 3 |
| 9 Consumption | Built | — |
| 10 Mortality | Built; journals only post where mapped | 1 / 3 |
| 11 Cull / sale | Partial — no conversion record, Finance approval, inventory receipt, transfer-order line | 4 |
| 12 Piglet output | Built; born-dead / mummified are counts only; lot number format differs | 2 |

## 2. Decisions that gate the work — ask before building

Per AGENTS.md §7 these are the sheet's. The plan records what each answer would unblock, not an answer.

| ID | Question | Who | Blocks |
|---|---|---|---|
| G1 | Is the Business Central push in scope for this build, and from when? | Rishi | All of Phase 5; PO model; FA numbers; Value Entry |
| G2 | Real accounts for accumulated amortisation and impairment (and per-class GGP/GP/Parent if wanted) | Finance | Activating the four DRAFT costing profiles; the loss legs on death |
| G3 | D8: should registration, gilt creation and the sale/death legs post to the GL, and from which date? (journals today post only where a mapping exists) | Finance | Phase 3 journals; making the mapping check a hard block |
| G4 | D11: amortisation formula wording (the sheet gives 10.68, the BBP words give 93.49 for the same example) | Finance | Closing row 8; the live-date for the scheduler |
| G5 | Piglet / gilt cost basis: TDD says standard cost; BBP Finance says the sow's accumulated WIP; should the sow's amortisation and expensed feed reach the litter? | Finance | Row 6/12 accounting; a mature sow's litter opening near nil |
| G6 | D2: are `TRANSFERRED_IN` animals "Local"? | Rishi | Costing profile for those animals |
| G7 | Cull / sale treatment — the BBP gives three. Is Finance approval before conversion required, and is the animal converted to inventory first? | Finance / Rishi | Phase 4 |
| G8 | D5 costs to sell; batch-tracked weaner profiles (fair value from week 17); current / non-current split | Finance / Rishi | Phase 4 |
| G9 | Born-dead and mummified piglets: TDD says mortality records only. Create them? Under which reason codes (3 of the promised 47 exist; mortality alone is specified as 21)? | Rishi | Row 12 completion |
| G10 | Must the animal-register count equal the GRN quantity before the GRN posts? (Rishi, 14 Oct: each registration takes one from the receipt; a receipt may stay part-registered) | Rishi | GRN rule |
| G11 | Piglet lot number: keep the `ITEM_LOT` series, or `PIGLET-[SowBatch]-[Tattoo]-[Date]` as the TDD says? | Rishi | Row 12 detail |
| G12 | Do the item-card fields (NavFarm Item, Gender, Fixed Asset) and Dimension 1/2 setup earn their place while BC is absent? Animal code prefix (`PIG-` vs `ANM-`) is also still open. | Rishi | Item card, row 1 |

## 3. Phases, in order

### Phase 0 — Verify what was only read (no decision needed)
Drive the running app and read MySQL for the flows the review only code-read, on a clean `pnpm seed:costing` database:
GRN of bio-asset animals → register → capitalise → costing run → death → cull, and a store transfer (is stock held IN_TRANSIT between ship and receive, and what does the ledger show).
Also check: sow/boar items are **not** serial-tracked (21 Oct doc; not re-checked), and which BIO_* mappings the demo tenant actually has.
**Done when:** a short `docs/VERIFICATION-<date>-tdd-gap-closure-phase-0.md` lists each claim as held / did not hold.

### Phase 1 — Build now (no decision needed)
1. **Posting-readiness check.** Journals for acquisition, gilt, mortality, sale and litter birth are silently skipped when a mapping is absent, so ledger and GL drift apart. Add a read-only report on the Finance setup screen listing missing `BIO_*` mappings, and a notice at the point a skipped journal would have posted. *Ours, not a TDD row;* it makes G3 visible.
2. **Last / next amortisation date on the animal** (TDD row 8: Animal Register "Last Amort Date, Next Due Date"). Today computed, not stored. Keep the ledger as the record; store as cache, refreshed in the request that writes the ledger row.
3. **Vendor fields** (row 2): contact name, purchaser code, sync status. Check the supplier master template first; do not add a field the template does not have.
4. **Stale documents.** `AGENTS.md` §8 says a Purchase release records `BC_PENDING`; the code sets `NOT_APPLICABLE` after Rishi's 12 Oct ruling (`requisition.rules.ts:421`), and the schema comments at `schema.ts:6643` / `:8429` repeat the old text. Refresh the gap analysis for gilt selection, litter birth cost, purchase journal and exit journals, which now exist.
5. **Mortality journals** already exist for the animal path; add a test and a live read-back that a mapped death posts both legs and an unmapped one reports it (depends on 1).

### Phase 2 — Needs a quick answer from Rishi, then small builds
- **G9 →** born-dead and mummified piglets create mortality records (row 12).
- **G10 →** if yes, block GRN post until registered count equals quantity, otherwise record the decision that it does not.
- **G11 →** lot number format.
- **G12 →** NavFarm-Item flag, Gender and Fixed-Asset flag on the item; Dimension 1/2 setup. Only if wanted before BC exists.
- **Purchase Order (row 4) without BC:** decide whether NAVFarm holds a PO record at all (Expected Receipt, "Qty to Receive only", GRN linked to a PO) or keeps `linked_po_no`. This is a design question under G1; do not build a table until it is answered.

### Phase 3 — Needs Finance (G2–G5), then the accounting
1. **G2 first.** It is the single largest blocker: until Finance gives the accumulated-amortisation and impairment accounts the four profiles stay DRAFT and nothing costs live. Then activate profiles, run `db-backfill-bio-costing --verify` and read the plan.
2. **G4** then closes the formula; only then switch the scheduler on for a tenant (its effective date must be the date costing should start).
3. **G3** then decides which journals become mandatory; turn Phase 1's notice into a block where Finance says so.
4. **G5** then fixes the litter / gilt cost basis and any change to the sow's amortisation in the litter (this changes numbers; re-run the costing test seed and its 109 checks).
5. Per-class accounts and gilt classing by mating line (Z+Z, Z+L, Z+Tempo) once Finance creates the accounts. Item/breed-scoped profiles already resolve most-specific-wins.

### Phase 4 — Needs Finance and Rishi (G6–G8)
- **Cull as FA → inventory conversion** (row 11): conversion record with out-of-production date separate from disposal date, Finance approval before it posts, CONVERTED_INV status, inventory receipt, transfer-order line. Build to whichever of the BBP's three treatments is chosen. The Kill Sheet has no tables (Rishi, 20 Oct) and stays out unless he brings it in.
- `TRANSFERRED_IN` profile (G6), batch-tracked weaner profiles with fair value from week 17 and the current / non-current split (G8).

### Phase 5 — Only if G1 says yes
Do not start without a written design. Preserve stable IDs and keep `integration_status` separate from business status (AGENTS.md §8).
- Outbox for the APIs: PO and vendor and dimension in; GRN, store-transfer journals, gilt/child FA, consumption and capitalization, amortization / FV, mortality, cull out.
- Returned keys on NAVFarm rows: child / main FA No., FA Ledger Entry No., BC Item Ledger Entry No.; a Value Entry copy with the Adj. Entry flag.
- Resolve the TDD's own conflicts first: "Appreciation" is used both for capitalization (row 7) and fair-value gain (row 8); rows 7 and 9 share the Consumption entry type, so BC cannot tell capitalised from expensed; credit-Vendor-at-GRN leaves no accrual.

## 4. Order of work, in one line
Phase 0 and 1 now. Ask G2 and G3 of Finance and G9–G12 of Rishi the same day. Phase 3 item 1 starts the moment G2 is answered. Phases 4 and 5 wait on Finance, Rishi and G1.

## 5. What this plan does not claim
Row statuses come from reading code, not from running it. Whether sow/boar items are serial-tracked, the supplier template's field list, and the in-transit stock treatment are unchecked and are Phase 0 / Phase 1 items.
