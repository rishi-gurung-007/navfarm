/**
 * Loads the GM Dashboard sheet's red / yellow / green cut-offs (Rishi, 16 Nov: "GM dashboard colour code" sheet)
 * onto each farm's lifecycle KPI entries (`breed_lifecycle_stages.kpi_thresholds`) as `red_at`, `yellow_at` and
 * `green_at`. The number under a colour is where that colour is reached (gm-dashboard.metrics.ts bandStatus).
 *
 *   DEV_TENANT_DATABASE=nf_ccc pnpm exec ts-node apps/api/src/scripts/apply-gm-dashboard-bands.ts            (read-only)
 *   DEV_TENANT_DATABASE=nf_ccc pnpm exec ts-node apps/api/src/scripts/apply-gm-dashboard-bands.ts --apply
 *
 * Farms are matched by a word in the location name; a farm the tenant does not have is reported and skipped. Safe
 * to run twice. 70 Day Gain has no KPI entry of its own, so it is added (metric GAIN_70_DAY) beside the weaner
 * stage's other KPIs.
 */
import mysql, { RowDataPacket } from 'mysql2/promise';

type Triple = [number, number, number] | null; // red, yellow, green

/** Sheet column per farm, then each metric's [red, yellow, green]; null where the sheet is blank. */
const FARMS = ['GRASMERE', 'RICHLANDS', 'LION', 'PORTA', 'VILLA', 'MULTIPLIER', 'LEARIG', 'EXTENSION'] as const;

const METRICS: Array<{ label: string; stage: string; metric: string; lowerIsBetter: boolean; cells: Triple[] }> = [
  {
    label: 'Farrowing Rate',
    stage: 'FARROWING',
    metric: 'FARROWING_RATE',
    lowerIsBetter: false,
    cells: [[87, 89, 92], [88, 90, 92], [87, 90, 92], [87.4, 89.7, 92], [90.25, 92, 95], [85, 88, 90], null, null],
  },
  {
    label: 'Total Born / Litter',
    stage: 'FARROWING',
    metric: 'TOTAL_BORN',
    lowerIsBetter: false,
    cells: [[15, 15.8, 16.1], [15.8, 16.2, 16.7], [15.7, 16.1, 16.5], [16.38, 16.81, 17.24], [15.2, 15.5, 16], [15, 15.5, 16], null, null],
  },
  {
    label: 'Born Alive / Litter',
    stage: 'FARROWING',
    metric: 'BORN_ALIVE',
    lowerIsBetter: false,
    cells: [[14, 14.55, 15], [14.7, 15.1, 15.5], [14.7, 15.11, 15.5], [15.51, 15.92, 16.33], [14.7, 15, 15.5], [14, 14.5, 15], null, null],
  },
  {
    label: 'Pre-wean Mortality',
    stage: 'FARROWING',
    metric: 'PRE_WEAN_MORTALITY',
    lowerIsBetter: true,
    cells: [[10, 8, 7.5], [10, 9, 8], [4.75, 4.88, 5], [6.6, 6.3, 6], [7, 6, 5], [10, 9, 8], null, null],
  },
  {
    label: 'Avg Weaned / Sow',
    stage: 'FARROWING',
    metric: 'WEAN_PER_SOW',
    lowerIsBetter: false,
    cells: [[12.6, 13.4, 13.9], [13.6, 13.8, 14.3], [13.6, 13.9, 14.3], [14.58, 14.97, 15.35], [14, 14.4, 14.7], [12.6, 13.2, 13.8], null, null],
  },
  {
    label: 'Avg Wean Weight',
    stage: 'FARROWING',
    metric: 'WEANING_WEIGHT',
    lowerIsBetter: false,
    cells: [[7, 7.2, 7.5], [6.8, 7, 7.2], [6.84, 7.02, 7.2], [7.6, 7.8, 8], [7, 7.3, 7.5], [7, 7.2, 7.5], null, null],
  },
  {
    label: 'Total Litter Mass',
    stage: 'FARROWING',
    metric: 'TOTAL_LITTER_MASS',
    lowerIsBetter: false,
    cells: [[88, 96.5, 104], [92, 96, 103], [97.85, 100, 103], [116.67, 119.74, 122.81], [104, 106, 110], [88, 95, 104], null, null],
  },
  {
    label: 'Avg 70 Day Weight',
    stage: 'WEANER',
    metric: 'BODY_WEIGHT',
    lowerIsBetter: false,
    cells: [[26.6, 27.2, 28], [26.6, 27.3, 28], [25.7, 26.3, 27], [27.55, 28.28, 29], [27, 27.8, 28.8], [26.6, 27.2, 28], [26.6, 27.3, 28], [26.6, 27.3, 28]],
  },
  {
    label: '70 Day Gain',
    stage: 'WEANER',
    metric: 'GAIN_70_DAY',
    lowerIsBetter: false,
    cells: [[19.5, 19.9, 20.5], [19.8, 20.3, 20.8], [18.8, 19.3, 19.8], [19.95, 20.48, 21], [20, 20.5, 21.33], [19.4, 19.8, 20.5], [19.95, 20.475, 21], [19.95, 20.5, 21]],
  },
  {
    label: 'FCE Weaner',
    stage: 'WEANER',
    metric: 'FCR',
    lowerIsBetter: true,
    cells: [[1.52, 1.5, 1.45], [1.62, 1.58, 1.55], [1.43, 1.5, 1.5], [1.65, 1.58, 1.5], [1.7, 1.6, 1.5], [1.6, 1.55, 1.5], [1.554, 1.517, 1.48], [1.41, 1.44, 1.48]],
  },
  {
    label: 'Weaner Mortality',
    stage: 'WEANER',
    metric: 'MORTALITY_PCT',
    lowerIsBetter: true,
    cells: [[1, 0.7, 0.5], [1.5, 1.3, 1], [0.76, 0.78, 0.8], [1.1, 1.05, 1], [2, 1.56, 1], [2, 1.5, 1.2], [0.63, 0.62, 0.6], [0.57, 0.59, 0.6]],
  },
  {
    label: 'FCE Grower',
    stage: 'GROWER',
    metric: 'FCR',
    lowerIsBetter: true,
    cells: [[2.52, 2.47, 2.4], [2.5, 2.46, 2.42], [2.28, 2.34, 2.4], [2.67, 2.54, 2.42], [2.5, 2.4, 2.37], [2.5, 2.45, 2.4], [2.52, 2.46, 2.4], [2.28, 2.34, 2.4]],
  },
  {
    label: 'Grower Mortality',
    stage: 'GROWER',
    metric: 'MORTALITY_PCT',
    lowerIsBetter: true,
    cells: [[2, 1.8, 1.6], [2.2, 2, 1.8], [1.9, 1.95, 2], [2.21, 2.1, 2], [2.2, 2.1, 2], [3, 2.5, 2], [1.58, 1.54, 1.5], [1, 1.46, 1.5]],
  },
];

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_ccc';

const consistent = (t: [number, number, number], lower: boolean) =>
  lower ? t[0] >= t[1] && t[1] >= t[2] : t[0] <= t[1] && t[1] <= t[2];

async function run() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({ host, port, user, password, database });
  try {
    await db.beginTransaction();
    const [locations] = await db.query<RowDataPacket[]>(
      `SELECT location_id, location_name FROM location_master WHERE location_type = 'FARM' AND is_active = 1`,
    );
    let updatedRows = 0;
    for (const [col, word] of FARMS.entries()) {
      const matches = locations.filter((l) => String(l.location_name).toUpperCase().includes(word));
      if (!matches.length) {
        console.log(`${word}: no such farm in ${database} — skipped`);
        continue;
      }
      for (const farm of matches) {
        for (const m of METRICS) {
          const triple = m.cells[col];
          if (!triple) continue;
          if (!consistent(triple, m.lowerIsBetter))
            console.log(
              `WARN ${farm.location_name} ${m.label}: ${triple.join(' / ')} runs against the metric — loaded, but the dashboard will not use it`,
            );
          const [rows] = await db.query<RowDataPacket[]>(
            `SELECT l.lifecycle_id AS id, l.kpi_thresholds AS kpi FROM breed_lifecycle_stages l
             JOIN stage_master s ON s.stage_id = l.stage_id
             WHERE l.farm_id = ? AND s.stage_code = ? AND JSON_LENGTH(l.kpi_thresholds) > 0`,
            [farm.location_id, m.stage],
          );
          for (const row of rows) {
            const list: any[] = typeof row.kpi === 'string' ? JSON.parse(row.kpi) : row.kpi;
            let entry = list.find((e) => e?.metric === m.metric);
            if (!entry) {
              if (m.metric !== 'GAIN_70_DAY') continue;
              entry = { metric: m.metric, uom: 'KG', kpi_period: 'WEEKLY', severity: 'INFO' };
              list.push(entry);
            }
            [entry.red_at, entry.yellow_at, entry.green_at] = triple;
            await db.query(`UPDATE breed_lifecycle_stages SET kpi_thresholds = CAST(? AS JSON) WHERE lifecycle_id = ?`, [
              JSON.stringify(list),
              row.id,
            ]);
            updatedRows += 1;
          }
        }
        console.log(`${farm.location_name}: done`);
      }
    }
    console.log(`${updatedRows} lifecycle row updates ${apply ? 'applied' : '(rolled back — pass --apply)'}`);
    if (apply) await db.commit();
    else await db.rollback();
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    await db.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
