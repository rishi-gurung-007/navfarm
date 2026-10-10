# Brief C: Monthly Stock Take and Period Close

## Workbook rows (read them in workbook-fields.md)
- Sheet "Silo Balance and Stock Take" Section 3, MONTHLY STOCK TAKE MODULE (rows 30–49), all fields in order: Stock
  Take No. (ST-FarmCode-YYYY-NNNNN / ST-MILL-YYYY-NNNNN), Stock Take Type (FARM / FEED_MILL), Farm or Mill Code,
  Reporting Period, Stock Take Date (= period end Saturday), Silo Code or Location, Physical Feed Item, System Balance KG
  at the date, Physical Count KG, Variance KG, Variance Percent, Variance Reason, Adjustment Type, Post Approved Stock
  Adjustment, GL entry, Period Status After Reconciliation (r48), Production Start Date Next Period.
- Sheet "Feed Forecast" r10. Sheet "Checkpoints and Validations" r31 (one per month; cannot close the period without it),
  r32 (closed period blocks postings dated in it), r40 (stock take refused if the period does not exist).
- decisions.md 1 Oct: Finance escalation at >=5% variance; the monetary threshold stays null until Triple C supplies it.

## What exists (reuse it)
- The weekly Physical Stock Count (`modules/inventory/feed-stock-count`, the `feed_stock_count` table, with approval and
  posting to the ledger). Reporting Period Master. The stock adjustment posting path. Extend the stock count with a
  count type WEEKLY/MONTHLY, a stock take type and reporting_period_id, and allow a mill location, rather than building
  a second counting module. Reuse its variance, approval and posting rules.

## Build
1. Monthly Stock Take: create for a reporting period (farm or mill), lines for ALL active silos/bins with the system
   balance at the stock-take date, count entry, variance and %, a reason required for any nonzero variance, approval
   (Finance when >=5%), and posting of the approved adjustment through the existing path, exactly once.
2. Period Close on the Reporting Period: Close is allowed only when every farm and mill in the company has a POSTED
   monthly stock take for that period (r31). A CLOSED period blocks POST Day, receipts, shipments and adjustments
   dated in it (r32). Find the posting entry points and add ONE shared guard. Reopen is admin-only with a reason.
3. UI: a "Monthly Stock Take" view in the Physical Stock Count tab (a type switch), plus Close/Reopen on the Reporting
   Period page.
Migration 0167_monthly_stock_take_period_close, idx 166, when 1792000000035 (or the next free number after merging
A and B; the controller will tell you).
