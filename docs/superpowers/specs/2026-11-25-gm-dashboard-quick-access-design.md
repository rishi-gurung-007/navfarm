# GM Dashboard quick access — design

25 November 2026. Status: approved by Rishi, 25 November.

## Intent

Rishi: items and cards on the GM Dashboard should be clickable for quick access, and the page opened should already be
filtered to the dashboard's farm and period.

## Goals

- A click opens the page holding the records behind that figure, filtered to the dashboard's farm and dates.
- The filters that arrived are visible in the target page's own filter controls and can be changed or cleared there.
- Stage 1 ships on its own and is useful on its own.

## Not included

- Changing how any dashboard figure is calculated.
- Keeping the dashboard's farm and period when you come back to it. Today they reset; unchanged unless asked.
- A records panel on the dashboard.

## Approaches

1. **Two stages — chosen by Rishi.** Stage 1 covers the pages that already filter by farm or dates and need little
   more. Stage 2 covers the production pages, which need more filtering work.
2. All at once. One release, but much more to test, including farm filtering on Profit & Loss.
3. Records panel on the dashboard. Could match totals, but does not take you to the real pages.

## Rules for every click

| Rule | Behaviour |
|---|---|
| Month figure | The dashboard period's start date to its "to" date |
| YTD figure | The year-to-date start to the same "to" date |
| Matrix row, alert, Kg Meat | Month dates (the card's YTD figure uses YTD dates) |
| Farm chosen | That farm is passed |
| All Farms | No farm filter |
| Custom range | The chosen dates; Budget figures are not clickable (there is no budget) |
| No permission to view the target | Not clickable |
| No data (blank figure) | Still clickable; the page shows its own empty state |
| Not in this stage | No pointer, hover or link; looks as it does today |

The filters travel in the link (`farmId`, `from`, `to`, plus any page-specific ones), so a refresh keeps them. A page
opened without them behaves exactly as today. A farm in a link never widens what the user may see.

Clickable things look clickable (pointer and hover) and work from the keyboard.

## Stage 1

| Click | Opens | Work on that page |
|---|---|---|
| Pigs to Slaughter, Cost of Sales, Gross Margin and %, and the Pigs to Slaughter progress chart | Bio-Asset Ledger, sales only | Add a farm filter and a "sales only" filter; read the link |
| Avg CDM, COS $/kg CDM, Kg Meat Sold / Sow / Year | Kill Sheets | Add a date filter; read the link |
| Other and Staff Overheads | Journal | Add account and farm filters; read the link |
| Any Budget figure (cards and Kg Meat) | Budget master | Pass reporting period, farm and metric; show them as applied filters |
| Breeding rows except Farrowing Rate and Kg Meat | Farrowing Report | Read the link; run the report when farm and dates are all present |
| PBT progress chart | Profit & Loss | Read the dates; clickable only on All Farms |
| Farm heading or dot in a matrix | Same dashboard | Selects that farm, as the Farm filter does |
| A matrix row's name | The row's page above | Same row in the Slaughter & Financial table as its card |
| A Management Alert | The alert measure's page, with the alert's farm | Stage 2 measures stay unclickable |

The progress charts are year running totals, so they pass YTD dates.

### Matching the dashboard's records

- **Sales only** means what the dashboard counts: the ledger's sold-animal entries whose document has a posted sale or
  kill sheet journal, dated by that journal's posting date, farm taken from the batch. Reuse the dashboard's rule
  (`soldDisposals` in `piggery-analytics.service.ts`); do not write a second one.
- **Pigs to Slaughter** falls back to kill sheet heads when the selection has no sales. In that case the card and chart
  open Kill Sheets instead.
- **Kill Sheets dates** follow the dashboard: imported sheets whose slaughter dates overlap the range; a sheet with no
  slaughter date uses its confirmed date, else created date. Arriving from the dashboard sets status to Imported.
- **Overheads:** accounts 4600 (Other) or 4610 (Staff), posted journals, farm taken from the line's cost centre
  `CC-<farm code>`. The Journal lists whole journals that contain such a line, so a journal's own total can include
  other lines. Arriving from the dashboard sets status to Posted.
- **Farrowing Report** with All Farms: it needs one farm, so dates are filled in and you choose the farm.
- **Kg Meat Sold / Sow / Year** is an annualised figure; Kill Sheets shows the meat behind it, not the figure itself.
- **Profit & Loss** is not claimed to equal PBT.

## Stage 2

Farrowing Rate → Breeding. Weaner–Grower rows → Batches (70 day weight and gain) and Batch Records (FCE, mortality).
These pages need farm and date filtering first. Stage 2 gets its own design check before building, including whether
Batch Records can show deaths.

## Changes from the first list

- Pigs to Slaughter and its chart were listed as Kill Sheets. The figure comes from sales entries, so they open the
  Bio-Asset Ledger (kill sheets only in the fallback case above).
- Gross Margin was listed as Profit & Loss. Profit & Loss has no farm filter, and the figure comes from sales, so it
  opens the Bio-Asset Ledger.

## Verification

On local data, for one farm and All Farms, Month and YTD: click each Stage 1 item, and compare what the page lists
with the dashboard figure and with MySQL. Report every mismatch. A link-less visit to each changed page behaves as
before.

## Left to the builder

Link parameter names beyond `farmId`, `from` and `to`; hover styling; how the new filter controls sit on each page,
following that page's existing filter pattern.
