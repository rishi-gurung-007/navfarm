/**
 * Moves farm feed logistics into Feed Planning Settings (spec 2026-10-03 §3.2,
 * Task 8 of the feed TDD alignment).
 *
 *  1. For every FARM whose feed_bulk_multiple_kg, feed_bag_size_kg,
 *     feed_truck_target_kg or feed_production_weekday differs from what the farm
 *     would inherit (its company's active feed_planning_setting value, else the
 *     defaults 3000 / 50 / 30000 / Sunday), insert or update the farm's active
 *     feed_planning_setting row with ONLY the differing values. Equal values are
 *     not copied. A value the farm's override row already sets is kept.
 *  2. Safety stock: reported only. A NULL company safety_stock_kg means 0 and
 *     stays NULL; a farm override stays NULL unless set deliberately.
 *  3. Renumber requisition_line.line_seq of FEED requisitions to 10000-steps,
 *     in their existing order.
 *  4. Lists open AUTO_DRAFT feed requisitions by farm. They are recalculated by
 *     re-running "Draft from forecast", not by SQL: the engine is the only
 *     calculation.
 *
 * The six location_master columns are NOT dropped here (that happens at merge).
 *
 * Modes: no flag = read-only plan; --verify = run inside a transaction, print
 * the verified state, roll back; --apply = run inside a transaction and commit.
 * Optional: --tenant=<db> (default TENANT_DB or nf_devco).
 */
import mysql, { RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import {
  FarmLegacyRow, FarmOverridePlan, Logistics, LogisticsKey, planFarmOverrides, planLineRenumber,
} from './align-feed-tdd.lib';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const tenantArg = process.argv.find((a) => a.startsWith('--tenant='))?.split('=')[1];
const database = tenantArg || process.env.TENANT_DB || 'nf_devco';

const COLUMN: Record<LogisticsKey, string> = {
  bulkMultipleKg: 'bulk_multiple_kg',
  bagSizeKg: 'bag_size_kg',
  truckTargetKg: 'truck_target_kg',
  productionWeekday: 'production_weekday',
};

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const logisticsOf = (row: RowDataPacket): Logistics => ({
  bulkMultipleKg: num(row.bulk_multiple_kg), bagSizeKg: num(row.bag_size_kg),
  truckTargetKg: num(row.truck_target_kg), productionWeekday: num(row.production_weekday),
});

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  const nonFlagArgs = process.argv.slice(2).filter((a) => !a.startsWith('--tenant='));
  if (nonFlagArgs.some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only plan), --verify (dry-run transaction), or --apply (commit). Optional: --tenant=<db>');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !process.env.ALIGN_FEED_TDD_ALLOW_REMOTE) {
    throw new Error(`Refusing to run against non-local host ${host}.`);
  }
  const mode = apply ? 'APPLY' : verify ? 'VERIFY' : 'PLAN';
  console.log(`\n=== Align Feed TDD: farm logistics to Feed Planning Settings [${mode}] ===`);
  console.log(`Database: ${database} on ${host}:${port}\n`);

  const db = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [[lock]] = await db.query<RowDataPacket[]>("SELECT GET_LOCK('navfarm-align-feed-tdd', 5) acquired");
    if (Number(lock.acquired) !== 1) throw new Error('Another align-feed-tdd process is currently active.');

    // ---- read ----
    const [farmRows] = await db.query<RowDataPacket[]>(
      `SELECT location_id, tenant_id, company_id, location_code, feed_bulk_multiple_kg, feed_bag_size_kg, feed_truck_target_kg, feed_production_weekday
         FROM location_master
        WHERE location_type = 'FARM' AND parent_location_id IS NULL AND is_active = 1 AND deleted_at IS NULL AND company_id IS NOT NULL
        ORDER BY location_code`,
    );
    const farms: FarmLegacyRow[] = farmRows.map((r) => ({
      farmId: r.location_id, companyId: r.company_id, code: r.location_code,
      bulkMultipleKg: num(r.feed_bulk_multiple_kg), bagSizeKg: num(r.feed_bag_size_kg),
      truckTargetKg: num(r.feed_truck_target_kg), productionWeekday: num(r.feed_production_weekday),
    }));
    const tenantOf = new Map(farmRows.map((r) => [r.location_id as string, r.tenant_id as string]));
    const companyOf = new Map(farmRows.map((r) => [r.location_id as string, r.company_id as string]));

    const [settingRows] = await db.query<RowDataPacket[]>(
      `SELECT company_id, farm_id, safety_stock_kg, bag_size_kg, bulk_multiple_kg, truck_target_kg, production_weekday
         FROM feed_planning_setting WHERE is_active = 1`,
    );
    const companies = new Map<string, Logistics>();
    const existing = new Map<string, Logistics>();
    let companyRows = 0; let companySafetyNull = 0; let farmSafetySet = 0;
    for (const r of settingRows) {
      if (r.farm_id === null) {
        companies.set(r.company_id, logisticsOf(r)); companyRows += 1;
        if (r.safety_stock_kg === null) companySafetyNull += 1;
      } else {
        existing.set(r.farm_id, logisticsOf(r));
        if (r.safety_stock_kg !== null) farmSafetySet += 1;
      }
    }

    const plans = planFarmOverrides(farms, companies, existing);
    const [lineRows] = await db.query<RowDataPacket[]>(
      `SELECT l.requisition_id, l.line_id, l.line_seq
         FROM requisition_line l JOIN requisition r ON r.requisition_id = l.requisition_id
        WHERE r.doc_type = 'FEED'`,
    );
    const renumber = planLineRenumber(lineRows.map((r) => ({ requisitionId: r.requisition_id, lineId: r.line_id, lineSeq: Number(r.line_seq) })));
    const [drafts] = await db.query<RowDataPacket[]>(
      `SELECT r.farm_id, COALESCE(f.location_code, '(no farm)') farm_code, COUNT(*) cnt, GROUP_CONCAT(r.req_no ORDER BY r.req_no SEPARATOR ', ') req_nos
         FROM requisition r LEFT JOIN location_master f ON f.location_id = r.farm_id
        WHERE r.doc_type = 'FEED' AND r.status = 'AUTO_DRAFT' AND r.deleted_at IS NULL
        GROUP BY r.farm_id, f.location_code ORDER BY farm_code`,
    );

    // ---- plan ----
    console.log('--- 1. Farm logistics -> feed_planning_setting farm override rows ---');
    console.log(`Active farms: ${farms.length}; company rows: ${companyRows}; existing farm override rows: ${existing.size}`);
    const describe = (p: FarmOverridePlan) => {
      const vals = Object.entries(p.values).map(([k, v]) => `${COLUMN[k as LogisticsKey]}=${v}`).join(', ');
      const kept = p.keptExisting.length ? ` (kept existing override: ${p.keptExisting.map((k) => COLUMN[k]).join(', ')})` : '';
      return `${vals || '-'}${kept}`;
    };
    for (const p of plans.filter((x) => x.action !== 'none' || x.keptExisting.length)) {
      console.log(`  - ${p.action.toUpperCase().padEnd(6)} ${p.code}: ${describe(p)}`);
    }
    const inserts = plans.filter((p) => p.action === 'insert');
    const updates = plans.filter((p) => p.action === 'update');
    console.log(`Plan: ${inserts.length} insert(s), ${updates.length} update(s), ${plans.length - inserts.length - updates.length} farm(s) unchanged (value equals what the farm inherits).`);

    console.log('\n--- 2. Safety stock (reported, nothing written) ---');
    console.log(`Company rows with safety_stock_kg NULL (means 0, left NULL): ${companySafetyNull} of ${companyRows}`);
    console.log(`Farm override rows with a safety_stock_kg set: ${farmSafetySet}`);

    console.log('\n--- 3. Feed requisition line_seq to 10000-steps ---');
    const feedReqs = new Set(lineRows.map((r) => r.requisition_id)).size;
    console.log(`FEED requisitions with lines: ${feedReqs}; lines to renumber: ${renumber.length} of ${lineRows.length}`);

    console.log('\n--- 4. Open AUTO_DRAFT feed requisitions (re-run Draft from forecast to recalculate; no SQL) ---');
    if (drafts.length === 0) console.log('  none');
    for (const d of drafts) console.log(`  - ${d.farm_code}: ${d.cnt} (${d.req_nos})`);

    if (!verify && !apply) {
      console.log('\n[PLAN] Read-only plan complete. No changes made.');
      console.log('Run with --verify to test inside a rollback transaction, or --apply to commit.');
      return;
    }

    // ---- execute ----
    console.log(`\n--- Executing (${mode}) ---`);
    await db.beginTransaction();
    try {
      for (const p of [...inserts, ...updates]) {
        const keys = Object.keys(p.values) as LogisticsKey[];
        if (p.action === 'insert') {
          const cols = keys.map((k) => COLUMN[k]);
          await db.query(
            `INSERT INTO feed_planning_setting (setting_id, tenant_id, company_id, farm_id, ${cols.join(', ')}) VALUES (?, ?, ?, ?, ${cols.map(() => '?').join(', ')})`,
            [randomUUID(), tenantOf.get(p.farmId), companyOf.get(p.farmId), p.farmId, ...keys.map((k) => p.values[k])],
          );
        } else {
          await db.query(
            `UPDATE feed_planning_setting SET ${keys.map((k) => `${COLUMN[k]} = ?`).join(', ')} WHERE farm_id = ? AND is_active = 1`,
            [...keys.map((k) => p.values[k]), p.farmId],
          );
        }
      }
      console.log(`Farm override rows written: ${inserts.length} inserted, ${updates.length} updated`);
      // Two passes so a renumber never collides with a unique index on (requisition_id, line_seq), should one exist.
      for (const c of renumber) await db.query('UPDATE requisition_line SET line_seq = ? WHERE line_id = ?', [-c.to, c.lineId]);
      for (const c of renumber) await db.query('UPDATE requisition_line SET line_seq = ? WHERE line_id = ?', [c.to, c.lineId]);
      console.log(`requisition_line.line_seq renumbered: ${renumber.length}`);

      // verification inside the transaction: re-plan and expect nothing left to do
      const [vSettings] = await db.query<RowDataPacket[]>('SELECT company_id, farm_id, bag_size_kg, bulk_multiple_kg, truck_target_kg, production_weekday FROM feed_planning_setting WHERE is_active = 1');
      const vCompanies = new Map<string, Logistics>(); const vExisting = new Map<string, Logistics>();
      for (const r of vSettings) (r.farm_id === null ? vCompanies : vExisting).set(r.farm_id === null ? r.company_id : r.farm_id, logisticsOf(r));
      const remaining = planFarmOverrides(farms, vCompanies, vExisting).filter((p) => p.action !== 'none').length;
      const [vLines] = await db.query<RowDataPacket[]>(`SELECT l.requisition_id, l.line_id, l.line_seq FROM requisition_line l JOIN requisition r ON r.requisition_id = l.requisition_id WHERE r.doc_type = 'FEED'`);
      const lineRemaining = planLineRenumber(vLines.map((r) => ({ requisitionId: r.requisition_id, lineId: r.line_id, lineSeq: Number(r.line_seq) }))).length;
      console.log('Verification inside transaction:');
      console.log(`  - Farms still needing an override row: ${remaining} (expected 0)`);
      console.log(`  - FEED lines off the 10000-step: ${lineRemaining} (expected 0)`);

      if (verify) {
        await db.rollback();
        console.log('\n[VERIFY] Rolled back successfully. Database was not modified.');
      } else {
        await db.commit();
        console.log('\n[APPLY] Committed successfully. Database updated.');
      }
    } catch (error) {
      await db.rollback();
      throw error;
    }
  } finally {
    await db.query("SELECT RELEASE_LOCK('navfarm-align-feed-tdd')");
    await db.end();
  }
}

void run().catch((err) => {
  console.error('\nERROR:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
