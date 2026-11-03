# Plan — bio-asset costing moves from the costing profile onto the Item (TDD "Bio Asset Costing" tab)

**Date:** 28 Oct 2026 · **Asked by:** Arun · **Status:** design for approval; nothing built.
**Sources:** `Final TDD_V1.csv` — Item Card customization block and row 8 (Item Card Fair Value Setup / Amortization Setup, request page "Calculate Amortization"); `docs/superpowers/plans/2026-10-28-tdd-gap-closure.md` (rows 8, Item card, Phase 3).
**Supersedes:** Arun's 21 Oct choice to keep the costing profile "with a screen" (decisions.md, "The residual value is a company setting…"). Record the reversal in `docs/decisions.md` before Phase 1 is merged.
**Rule:** a phase is done when a run has been posted through the API and read back from MySQL. Existing tenants' data is not destroyed until the last phase.

## The instruction
- Each class of animal is an **Item** with Bio Asset = true: GGP-Imp-F, GGP-Imp-M, GP-Imp-F, GP-Imp-M, P-Imp-F, P-Imp-M, GP-Loc-F, GP-Loc-M, P-Loc-F, P-Loc-M, PIGLETS, Finisher.
- All costing parameters live on the item (TDD Item Card → Bio Asset Costing tab). There is no costing profile.
- The costing run costs **animals**: it reads each animal's item for its terms.

## What the TDD puts on the item
Bio Asset (bool) · Fixed Asset Item (bool) · NavFarm Item (bool) · Tracking (Lot / Serial) · Gender (F / M; drives Residual Applicable) · Fixed Asset Costing Method (Amortization / Fair Value) · Item Costing Method (Standard / FIFO / Avg; normal costing method un-editable for a bio asset) · Amortization / Fair Value Start Period (weeks, days) · Residual Value · Useful Life (months) · Frequency (weekly…yearly) · Last Run / Due Date · Fair Value setup: expected CDM × unit cost per kg, start week/days.
Not in the TDD but needed by the engine today and kept on the item: day basis, auto-post, the five GL accounts (acquisition, accumulated amortisation, amortisation expense, fair-value gain/loss, write-off), residual as weight × price per kg (Rishi, 20 Oct).

## Phases
1. **Item fields (additive).** Migration: costing columns on `item_master`; `item_fair_value_rate` (replaces `bio_costing_profile_rate`); rules for validating terms and for locking them once an animal of the item has a posted charge; Item master form gets the tab, shown only when Bio Asset is true; normal costing method locked for a bio asset. The profile is untouched and still runs.
2. **Engine reads the item.** `bio_costing_run.item_id` (nullable, then backfilled); run, scheduler, exit clearing, `animalAssetAccountId` / `assetAccountForItem`, the roll-forward report and the batch guard read the item. Costing start date is computed from the item's start weeks and the animal's birth date. A run is one item and one period (+ optional batch or animals) — the TDD request page's "Main Fixed Asset No." filter.
3. **Data move.** Read-only plan first (`--verify`, then `--apply`, as the other `db-*` scripts): copy each profile's terms to the item(s) its animals carry; report any profile that spans several items or none, and any item that would receive two different sets of terms. Re-point existing runs to items. Nothing dropped.
4. **Remove the profile.** Delete the profile controller, service, DTO, setup page and company residual setting screen; the Finance runs page is filtered by item. Seeds, scripts and tests move to items.
5. **Drop (separate, later migration, after a backup).** `animal_register.costing_profile_id`, `bio_costing_run.profile_id`, `bio_costing_profile`, `bio_costing_profile_rate`, `bio_costing_residual_setting`.
6. **Seed and prove.** The twelve items with the sheet's values only (read the Fixed Asset sheet; do not invent figures); re-run `seed:costing-test` (109 checks) and the walkthrough; compare run totals before and after the move.

## Not done by this plan
PIGLETS and Finisher carry the same fields but are **not run**: the engine refuses batch-tracked costing, and the rule has not been given for a batch's head count (weaners from week 17, finisher transfer). The Business Central push, the cull conversion and the formula wording (D11) are unchanged.

## Defaults to confirm (Arun)
1. Existing databases are migrated, not reset (history kept until Phase 5).
2. The five GL accounts sit on the item — this also gives the Fixed Asset sheet's per-class accounts.
3. Residual is on the item (weight × price); the company residual setting is retired; an animal's own override stays.
4. Origin, breed and gender scoping disappear; gender comes from the item.
5. Terms are locked once an animal of the item has a posted charge; a later change needs a decision on dated terms.
6. The run's scope is item + period, optionally narrowed to a batch or to chosen animals.
