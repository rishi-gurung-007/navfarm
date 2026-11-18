/**
 * Adds the GM Dashboard sheet's other farms (Rishi, 16 Nov: "make those farm too") to a tenant database, so the
 * dashboard shows the sheet's eight columns: Grasmere, Richlands, Lions Head, Porta, Villa Franca, Multiplier, Learig
 * and LH Extension. A farm is a top-level FARM location, and the colours come from each farm's own lifecycle KPI rows
 * (`breed_lifecycle_stages.kpi_thresholds`), so each new farm gets a copy of the template farm's lifecycle rows; load the
 * sheet's red / yellow / green numbers onto them afterwards with apply-gm-dashboard-bands.ts.
 *
 *   DEV_TENANT_DATABASE=nf_ccc node --env-file-if-exists=.env --import tsx src/scripts/seed-gm-dashboard-farms.ts            (read-only)
 *   DEV_TENANT_DATABASE=nf_ccc node --env-file-if-exists=.env --import tsx src/scripts/seed-gm-dashboard-farms.ts --apply
 *
 * The farm codes and the template farm are this script's choice, not the client's; a farm whose code or name the
 * database already has is left alone, so the script is safe to run twice. A new farm has no sheds, sows or batches,
 * so its column stays empty until records are posted for it.
 */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';

const FARMS = [
  { code: 'RIC100', name: 'RICHLANDS' },
  { code: 'LIO100', name: 'LIONS HEAD' },
  { code: 'VIL100', name: 'VILLA FRANCA' },
  { code: 'MLT100', name: 'MULTIPLIER' },
  { code: 'LEA100', name: 'LEARIG' },
  { code: 'LHX100', name: 'LH EXTENSION' },
] as const;

/** The farm whose location settings and lifecycle rows the new farms copy: the sheet's own Grasmere. */
const TEMPLATE_CODE = 'MUL100';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_ccc';

/** What describes one particular farm, so a copy must not carry it. */
const FARM_SPECIFIC = ['area_size', 'area_unit', 'max_capacity', 'capacity_uom', 'location_address', 'gps_latitude', 'gps_longitude'];

async function run() {
  const apply = process.argv.includes('--apply');
  const db = await mysql.createConnection({ host, port, user, password, database });
  try {
    await db.beginTransaction();
    const [[template]] = await db.query<RowDataPacket[]>(
      `SELECT * FROM location_master WHERE location_code = ? AND location_type = 'FARM' AND parent_location_id IS NULL`,
      [TEMPLATE_CODE],
    );
    if (!template) throw new Error(`Template farm ${TEMPLATE_CODE} not found in ${database}.`);
    const [lifecycle] = await db.query<RowDataPacket[]>(`SELECT * FROM breed_lifecycle_stages WHERE farm_id = ?`, [template.location_id]);

    let farmsAdded = 0;
    let lifecycleAdded = 0;
    for (const farm of FARMS) {
      const [existing] = await db.query<RowDataPacket[]>(
        `SELECT location_id FROM location_master WHERE tenant_id = ? AND (location_code = ? OR UPPER(location_name) = ?)`,
        [template.tenant_id, farm.code, farm.name],
      );
      if (existing.length) {
        console.log(`${farm.name} (${farm.code}): already there — left alone`);
        continue;
      }
      const farmId = randomUUID();
      const row: Record<string, unknown> = { ...template };
      for (const c of FARM_SPECIFIC) row[c] = null;
      row.current_count = 0; // not nullable: a new farm holds no head yet
      Object.assign(row, {
        location_id: farmId,
        farm_id: farmId,
        location_code: farm.code,
        location_name: farm.name,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await insert(db, 'location_master', row);
      farmsAdded += 1;

      for (const l of lifecycle) {
        await insert(db, 'breed_lifecycle_stages', {
          ...l,
          lifecycle_id: randomUUID(),
          // The code is unique per tenant, so the farm's code goes in front of the template's.
          lifecycle_code: `${farm.code}-${l.lifecycle_code}`,
          farm_id: farmId,
          created_at: new Date(),
        });
        lifecycleAdded += 1;
      }
      console.log(`${farm.name} (${farm.code}): added with ${lifecycle.length} lifecycle rows`);
    }
    console.log(`${farmsAdded} farm(s) and ${lifecycleAdded} lifecycle row(s) ${apply ? 'added' : '(rolled back — pass --apply)'}`);
    if (apply) await db.commit();
    else await db.rollback();
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    await db.end();
  }
}

async function insert(db: mysql.Connection, table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row);
  const values = columns.map((c) => {
    const v = row[c];
    // JSON columns come back as parsed objects; the driver wants them as text.
    return v !== null && typeof v === 'object' && !(v instanceof Date) && !Buffer.isBuffer(v) ? JSON.stringify(v) : v;
  });
  await db.query(`INSERT INTO \`${table}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
