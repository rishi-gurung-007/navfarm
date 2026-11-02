# GM Dashboard — Phase 1 design

2 Nov 2026. Replaces the "Piggery GM Executive Dashboard" tab with the GM Dashboard from Rishi's mockup, built on
the data that exists today. The financial half (Pigs to Slaughter, CDM, Cost of Sales, Gross Margin, Overheads,
PBT, every Budget figure) is Phase 2: it needs a Budget master, sales and kill-sheet records and overhead accounts
that do not exist yet.

## Decided by Rishi (2 Nov)

- The tab is renamed **GM Dashboard**, on `/dashboard` and `/livestock/analytics`.
- The new layout **replaces** the old cards (Active Herd, Active Batches, WIP Asset, Weaning Efficiency, Farrowing &
  Litters, Mating, Parity).
- It keeps the **current colour theme**. The mockup's green header and photo are not used. Status colours are the
  theme's success / warning / danger tokens.
- **Period filter from the Reporting Period master**, opening on the period that contains today. The matrices show
  the chosen period (no week picker).
- **Red / amber / green** against the breed lifecycle target (`breed_lifecycle_stages.kpi_thresholds`): green at or
  better than the target's Average Value; amber when worse but within the KPI's tolerance band, or within 10 % of
  the average when it has no tolerance; red beyond. A metric with no target is shown uncoloured.
- Phase 1 first; the financial cards come when their data exists. No placeholder cards for them.

## Filters

- **Period**: every Reporting Period of the company, grouped by business year; default = the period containing
  today (nf_ccc: 2026-11, 25 Oct – 21 Nov, business year 2026-27).
- **Month** = the chosen period. **YTD** = the first period of its business year to the end of the chosen period.
  Both stop at today, so the current period counts only the days so far.
- **Farm**: All Farms, or one farm (the farms the user may see, as R07 and R12 list them). Each farm is one column
  of the matrices, as in the mockup.

## Layout

1. Header: "GM Dashboard", Period, Farm, and the dates the period covers.
2. **Kg Meat Sold / Sow / Year** card: Month and YTD. No target exists in the lifecycle master, so it is shown
   without a status. It reads 0 in nf_ccc until sales are recorded.
3. **Breeding & Farrowing Performance** matrix: one row per metric, one column per farm, each cell a value with
   its status dot and the target on hover.
4. **Weaner-Grower Performance** matrix: same shape.
5. **Management Alerts**: every red and amber cell, red first, e.g. "GRASMERE — FCE Grower 2.71 vs target 2.40".

## Metric definitions (my calls, from the KPI workbook — please check)

Breeding & Farrowing reuses the Monthly Ops (R12) arithmetic on the period's dates, summed over the farm's sow
breeds. The target is the lifecycle KPI named in brackets; with more than one sow breed on a farm, the average of
their targets.

| Metric                    | Value                                                                                                                        | Target                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Farrowing Rate %          | Services made one gestation before the period that farrowed ÷ those services (as R12)                                        | FARROWING_RATE                      |
| Total Born / Litter       | Total born ÷ litters farrowed in the period                                                                                  | TOTAL_BORN                          |
| Born Alive / Litter       | Born alive ÷ litters farrowed                                                                                                | BORN_ALIVE                          |
| Pre-wean Mortality %      | Litters weaned in the period: (born alive + fostered in − fostered out − weaned) ÷ (born alive + fostered in − fostered out) | PRE_WEAN_MORTALITY, lower is better |
| Avg Weaned / Sow          | Piglets weaned ÷ litters weaned in the period                                                                                | WEAN_PER_SOW                        |
| Avg Wean Weight kg        | Head-weighted weaning weight of litters weaned (as R07 / R12)                                                                | WEANING_WEIGHT                      |
| Total Litter Mass kg      | Weaned head × weight, per litter weaned in the period (the workbook's 102.7 kg is per litter)                                | TOTAL_LITTER_MASS                   |
| Kg Meat Sold / Sow / Year | As R12: kg sold ÷ average sows × 365 ÷ days                                                                                  | none                                |

Weaner-Grower works on **stage exits**: a batch counts in the period in which it leaves the stage. It leaves
WEANER when it moves to the next stage (`batch_stage_log`), and leaves GROWER when it moves on or closes. That
matches the workbook, where 70-day weight is the weight at the end of the weaner stage (Triple C batches move from
WEANER to DOUBLE_STOCK at about 70 days of age). Heads, deaths and moves use the shared `batch-heads.ts` rules. Feed
is the batch's unreversed CONSUMPTION kg while in the stage. Weight is the latest posted BODY_WEIGHT entry.

| Metric               | Value                                                                                             | Target                                   |
| -------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Avg 70 Day Weight kg | Head-weighted weight at weaner exit: last weighing in the stage                                   | WEANER BODY_WEIGHT                       |
| 70 Day Gain kg       | Weaner exit weight − weaning weight of the batch's litters (first weighing in the stage if none)  | none in the lifecycle master: uncoloured |
| FCE Weaner           | Feed in the weaner stage ÷ live-weight gained (heads out × exit weight − heads in × entry weight) | WEANER FCR, lower is better              |
| Weaner Mortality %   | Deaths in the weaner stage ÷ heads that entered it                                                | WEANER MORTALITY_PCT, lower is better    |
| FCE Grower           | As FCE Weaner, for the GROWER stage; entry weight = last weighing before it entered               | GROWER FCR, lower is better              |
| Grower Mortality %   | As Weaner Mortality, for GROWER                                                                   | GROWER MORTALITY_PCT, lower is better    |

DOUBLE_STOCK (between weaner and grower) is not shown, as the mockup and workbook have no row for it.

## API

`GET /piggery/analytics/gm-dashboard?periodId=&farmId=` is rebuilt to return:

```
{ period: { period_id, period_code, business_year, start_date, end_date, ytd_from, to },
  periods: [{ period_id, period_code, business_year, start_date, end_date }],
  farms:   [{ farm_id, farm_code, farm_name }],
  kg_sold_per_sow_year: { month: { [farm_id]: number|null, all: number|null }, ytd: {...} },
  breeding: [{ key, label, unit, lower_is_better, cells: { [farm_id]: { value, target, status } } }],
  weaner_grower: [ same shape ],
  alerts: [{ farm_id, farm_name, metric, value, target, status }] }
```

`status` is `GREEN | AMBER | RED | null`. The old response fields go, along with the DTO's `dateFrom`, `dateTo`
and `businessYear`. The Monthly Ops service gains a public method for a farm's metrics over any date range, so R12
and the dashboard share one calculation.

## What the local data will show

nf_ccc's records stop on 25 Oct, so the default period (2026-11) will be almost empty; 2026-10 and earlier
show real figures. The seeded weights are uneven (one batch reads 7.6 kg on 10 Aug and 27 kg a week later), so
the FCE and gain figures will look odd until real weighings exist. Every number will be checked against MySQL
before hand-over.

## Phase 2 (not built now)

Budget master (farm × reporting period × metric); sales / slaughter disposals and the Kill Sheet (Pigs to
Slaughter, Avg CDM, Kg sold); cost-of-sales and overhead GL classification (Cost of Sales, COS $/tonne, Gross
Margin, GM %, Other and Staff Overheads, PBT); the two YTD progress charts; targets for 70 Day Gain and Kg Meat
Sold / Sow / Year.
