# Costing discussion — 19 Oct 2026

Scope: fixed assets, living (biological) assets, fair value, amortisation.
Source: reading the code and `docs/decisions.md`. Nothing here was run against MySQL.

## 1. Where we are

| Area | State |
|---|---|
| Inventory costing (FIFO / Average / Standard) | Built. Variances post to 5030–5060. |
| Biological assets (BIO_ASSET batches) | Built: acquisition → capitalised growth cost → maturity → amortisation → fair value → harvest / sale. |
| Animal-level amortisation fields | Columns exist on the animal register (`total_amortised`, `amortisation_monthly`, `book_value`). |
| Fixed assets | **Not built.** Requisition type only; no register, no depreciation. |

## 2. Lifecycle in one view

| Step | Journal |
|---|---|
| Acquire | Dr 1050 Bio Assets Pre-mature / Cr 2010 Payables |
| Feed, drug, overhead while premature | Dr 1050 (capitalised) |
| Mature | 1050 → 1060 (`BIO_TRANSFORMATION`); rate fixed |
| Feed, overhead while mature | Dr 5080 / 5090 (expensed) |
| Monthly amortisation | Dr 5100 / Cr 1060 |
| Fair value gain (loss reverses) | Dr 1060 / Cr 4020 |
| Death | Dr 5010 / Cr 1050 or 1060, at average carrying value per head |
| Harvest | Dr 1030 / Cr 1060 |
| Sale | Dr 1200 / Cr 1060 for proceeds; gain or loss to 4010 |

Amortisation: `(carrying value − residual × heads) ÷ life months ÷ heads` per head per month, then × heads alive each run.

## 3. Decisions needed

| # | Question | Why it matters | Proposed default (ours, awaiting client) |
|---|---|---|---|
| 1 | Fixed assets: do we build a register and depreciation? Method: SLM, WDV or units-of-production? | Sheds, mills and vehicles are uncosted. `depreciation_method` is stored on the company but nothing reads it. | SLM, monthly run, same pattern as bio-asset amortisation. |
| 2 | Residual value: percentage of cost (our column) or per-kg rate (Bio Asset BBP, 20 Aug MOM)? | Drives the amortisation rate and disposal gain/loss. | Keep percentage until the client confirms. |
| 3 | After a fair value change, recompute the amortisation rate? | `recordFairValue` does not touch the stored rate, so charges keep following the old cost basis. | Recompute from the new carrying value over remaining life. |
| 4 | Stop amortising at end of productive life or at residual? | `amortizeBioAsset` has no life-elapsed check; floor is zero, not residual. | Stop at residual. |
| 5 | Fair value less costs to sell (IAS 41)? | No costs-to-sell field exists. | Add an optional costs-to-sell input to the fair value entry. |
| 6 | Fair value on a premature batch: post to 1050, not 1060? | The `BIO_FAIR_VALUE` mapping debits 1060 regardless of stage. | Post to the account matching the stage. |
| 7 | Death write-off: batch average carrying value or the animal's own book value? | In `nf_devco`, 943 written off for a sow booked at 28 000. | Decide which ledger is of record. |
| 8 | Value of farm-produced stock: batch cost, standard, or NRV? | Output posted with no rate shows on hand at zero value. | Batch cost. |
| 9 | Reporting currency: ZWL or USD (ZiG)? | Every report. | Client to answer. |

## 4. Code to fix once decided

- `batch.service.ts:2079` — `ensureBioState` sets a Mature batch's opening carrying value to `heads × 28000`. Looks like a demo value; replace with the real figure or refuse.
- `batch.service.ts` `amortizeBioAsset` — add the end-of-life / residual guard (decision 4).
- `batch.service.ts` `recordFairValue` — rate recompute (decision 3), costs to sell (5), stage account (6).

## 5. Evidence rule

Any change above is proved by posting through the API and reading MySQL, not by a green test suite (see `AGENTS.md`).
