# The twelve biological items — figures from the Fixed Asset sheet

Source: `Amortization,Fairvalue & Bio Asset.xlsx` (Solution Documents), tab **FIXED ASSET**; fair-value inputs from tab **amortization & fv -formula** rows 70-75. Where the two tabs differ the FIXED ASSET tab is used (the formula tab's imported rows are test values).

Create each item first (Item Master, **Biological Asset** ticked), then either type the terms on its **Bio Asset Costing** tab or run

```bash
pnpm nx run api:db-apply-item-terms -- --apply --costing-from=YYYY-MM-DD
```

(read-only without flags; `--verify` rolls back; `--database=` picks the database). It creates no item or account and never overwrites an item that already has a method.

## Imported — amortised

| Item | Gender | Start (weeks) | Life (months) | Residual | Acquisition account | Amortisation account |
|---|---|---|---|---|---|---|
| GGP-Imp-F, GP-Imp-F, P-Imp-F | F | 33 | 36 | Weight x price: 150 kg x 2.05 = 307.50 | `<item> Acquisition Cost` | `<ITEM> Amortization` |
| GGP-Imp-M, GP-Imp-M, P-Imp-M | M | 26 | 18 | None | `<item> Acquisition Cost` | `<ITEM> Amortization` |

## Local — fair value (as the sheet says)

| Item | Gender | Start (weeks) | Life (months) | Rate (dated) | Acquisition account | Fair value account |
|---|---|---|---|---|---|---|
| GP-Loc-F, P-Loc-F | F | 33 | 36 | 150 kg x 2.05, CDM based No | `<item> Acquisition Cost` | `<item> Fair Value Gain/Loss` |
| GP-Loc-M, P-Loc-M | M | 26 | 18 | 150 kg x 2.05, CDM based No | `<item> Acquisition Cost` | `<item> Fair Value Gain/Loss` |

## Current assets — not costed by a run yet

| Item | Sheet says | Why not set |
|---|---|---|
| PIGLETS | Current, batch-tracked, fair value from week 17, CDM based Yes, 60 kg x 2.05 = 123; accounts "Weaners Acquisition Cost" / "Weaners Fair Value Gain/Loss" | A run costs individually tracked animals; the rule for a batch's head count is not given. The formula tab says week 18. |
| Finisher | Current, batch-tracked | No method, start week or figures given. |

## What the sheet does not give (open)

1. **Accumulated amortisation and impairment / write-off accounts** for any item: Finance must name them before a run can post.
2. **Account codes** (only names are given), so accounts are matched by name.
3. **Costing From date and run frequency**: the script takes the date from `--costing-from`; frequency is monthly / frequency days (our default; the formula tab's local rows say 30 days).
4. **Local items: fair value or amortisation?** The sheet says fair value; the dev seeds amortise them.
5. **No GGP-Loc rows**: the sheet lists local GP and P only.
6. **Weaners: week 17 or 18**, and how a batch is costed.
7. The sheet's **Classification** (Non-Current / Current) and tracking (serial / batch) are not item-costing terms; they follow from how the item is set up.
