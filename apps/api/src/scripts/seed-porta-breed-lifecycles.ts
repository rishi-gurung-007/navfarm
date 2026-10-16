/** Seeds the lifecycle data copied from nf_portatestnavfarm and matched to the Porta workbook. */
import { randomUUID } from 'node:crypto';
import mysql, { RowDataPacket } from 'mysql2/promise';
import {
  PORTA_LIFECYCLE_BREED_CODE,
  PORTA_LIFECYCLE_BREED_CODES,
  PORTA_LIFECYCLE_ITEMS,
  PORTA_LIFECYCLE_ROWS,
  PORTA_LIFECYCLE_SKIPPED,
  PORTA_LIFECYCLE_STAGES,
} from './lib/porta-breed-lifecycle-seed-data';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const database = process.env.DEV_TENANT_DATABASE || 'nf_devco';
const VERIFY_ROLLBACK = Symbol('seed-porta-breed-lifecycles:verify-rollback');

const lifecycleSequence = new Map<string, number>();

function lifecycleCode(row: { stage: string }): string {
  const stage = row.stage.replace(/\s+/g, '-');
  const next = (lifecycleSequence.get(stage) ?? 0) + 1;
  lifecycleSequence.set(stage, next);
  return `${stage}-LIFECYCLE-${String(next).padStart(3, '0')}`.toUpperCase();
}

async function run() {
  const apply = process.argv.includes('--apply');
  const verify = process.argv.includes('--verify');
  if (process.argv.slice(2).some((a) => !['--apply', '--verify'].includes(a)) || (apply && verify)) {
    throw new Error('Use no flags (read-only), --verify, or --apply.');
  }
  const write = apply || verify;
  const db = await mysql.createConnection({ host, port, user, password, database });
  try {
    await db.beginTransaction();
    const [[scope]] = await db.query<RowDataPacket[]>(
      `SELECT tenant_id, company_id, nob_id, lob_id FROM location_master
       WHERE company_id IS NOT NULL GROUP BY tenant_id, company_id, nob_id, lob_id ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    if (!scope) throw new Error('No company-scoped locations — run db-seed-farm-locations first.');

    const [farmRows] = await db.query<RowDataPacket[]>(
      `SELECT location_id FROM location_master
       WHERE tenant_id = ? AND company_id = ? AND location_code = 'POR100'
         AND location_type = 'FARM' AND is_active = 1 LIMIT 1`,
      [scope.tenant_id, scope.company_id],
    );
    const portaFarmId = farmRows[0]?.location_id as string | undefined;

    const [breeds] = await db.query<RowDataPacket[]>(
      `SELECT breed_id, breed_code FROM breed_master
       WHERE tenant_id = ? AND company_id IS NOT NULL AND is_active = 1`,
      [scope.tenant_id],
    );
    const targetBreeds = breeds.filter((b) =>
      (PORTA_LIFECYCLE_BREED_CODES as readonly string[]).some(
        (code) => code.toUpperCase() === String(b.breed_code).toUpperCase(),
      ),
    );
    if (!targetBreeds.length) throw new Error(`None of the target breeds found — run db-seed-farm-masters first.`);

    const itemIds = new Map<string, string>();
    let itemsInserted = 0;
    for (const item of PORTA_LIFECYCLE_ITEMS) {
      const [existing] = await db.query<RowDataPacket[]>(
        `SELECT item_id FROM item_master WHERE tenant_id = ? AND company_id = ? AND item_code = ? LIMIT 1`,
        [scope.tenant_id, scope.company_id, item.code],
      );
      const itemId = existing[0]?.item_id as string | undefined;
      if (itemId) {
        if (write && (item.itemType || item.uomPrimary)) {
          await db.query(
            `UPDATE item_master SET item_type = COALESCE(?, item_type), uom_primary = COALESCE(?, uom_primary),
               feed_form = ?, is_active = 1, status = 'ACTIVE', deleted_at = NULL, updated_at = NOW()
             WHERE item_id = ?`,
            [item.itemType ?? null, item.uomPrimary ?? null, item.feedForm ?? null, itemId],
          );
        }
        itemIds.set(item.code, itemId);
        continue;
      }
      const newId = randomUUID();
      if (write) {
        await db.query(
          `INSERT INTO item_master
             (item_id, tenant_id, company_id, nob_id, lob_id, item_code, item_name, item_type,
              uom_primary, feed_form, valuation_method, is_inventoriable, is_active, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 1, 1, 'ACTIVE', NOW(), NOW())`,
          [newId, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, item.code, item.name,
            item.itemType ?? 'FEED-001', item.uomPrimary ?? 'KGS', item.feedForm],
        );
      }
      itemIds.set(item.code, newId);
      itemsInserted++;
    }

    const stageIds = new Map<string, string>();
    let stagesInserted = 0;
    for (const stage of PORTA_LIFECYCLE_STAGES) {
      const [existing] = await db.query<RowDataPacket[]>(
        `SELECT stage_id FROM stage_master
         WHERE tenant_id = ? AND (company_id = ? OR company_id IS NULL) AND stage_code = ? AND is_active = 1
         ORDER BY company_id DESC LIMIT 1`,
        [scope.tenant_id, scope.company_id, stage.code],
      );
      const stageId = existing[0]?.stage_id as string | undefined;
      if (stageId) {
        stageIds.set(stage.code, stageId);
        continue;
      }
      const newId = randomUUID();
      if (write) {
        await db.query(
          `INSERT INTO stage_master
             (stage_id, tenant_id, company_id, nob_id, lob_id, stage_code, stage_name, stage_category,
              stage_sequence, typical_duration_days, min_days_before_move, transition_trigger,
              data_entry_form, scheduler_auto_create, show_on_animal_card, is_system, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, 1, NOW(), NOW())`,
          [newId, scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id, stage.code, stage.name,
            stage.category, stage.sequence, stage.typicalDays, stage.minDays, stage.trigger, stage.form],
        );
      }
      stageIds.set(stage.code, newId);
      stagesInserted++;
    }

    const plan = {
      database,
      mode: apply ? 'APPLY' : verify ? 'VERIFY' : 'READ-ONLY',
      breeds: targetBreeds.map((b) => b.breed_code),
      items: { source: PORTA_LIFECYCLE_ITEMS.length, inserted: itemsInserted },
      stages: { source: PORTA_LIFECYCLE_STAGES.length, inserted: stagesInserted },
      lifecycleRowsPerBreed: PORTA_LIFECYCLE_ROWS.length,
      lifecycleRowsSkipped: PORTA_LIFECYCLE_SKIPPED,
      farmOverride: portaFarmId ? 'POR100' : 'breed-wide (POR100 not found)',
    };
    console.log(JSON.stringify(plan, null, 2));
    if (write) {
      for (const targetBreed of targetBreeds) {
        const breedId = targetBreed.breed_id as string;
        await db.query('DELETE FROM breed_lifecycle_stages WHERE breed_id = ?', [breedId]);
        for (const row of PORTA_LIFECYCLE_ROWS) {
          const feedItemId = row.feed ? itemIds.get(row.feed) : null;
          const stageId = stageIds.get(row.stage);
          if (!stageId) throw new Error(`Unresolved lifecycle stage mapping: ${row.stage}`);
          await db.query(
            `INSERT INTO breed_lifecycle_stages
               (lifecycle_id, tenant_id, company_id, nob_id, lob_id, lifecycle_code, breed_id, stage_id,
                category, calc_unit, period_from, period_to, feed_item_id, feed_form,
                feed_qty_per_head_per_day_kg, feed_qty_per_head_per_day, feed_qty_uom, std_fcr,
                farm_id, kpi_thresholds, kpi_alert_period, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'WEEK', ?, ?, ?, ?, ?, ?, 'KGS', ?, ?, ?, 'WEEKLY', ?)`,
            [randomUUID(), scope.tenant_id, scope.company_id, scope.nob_id, scope.lob_id,
              row.code === null
                ? null
                : row.code === undefined
                  ? `${targetBreed.breed_code}-${lifecycleCode(row)}`
                  : `${targetBreed.breed_code}-${row.code}`,
              breedId, stageId, row.category, row.from, row.to, feedItemId, row.form ?? null,
              row.qty ?? null, row.qty ?? null, row.fcr ?? null, row.farmCode === 'POR100' ? portaFarmId ?? null : null,
              row.kpiThresholds ? JSON.stringify(row.kpiThresholds) : null, row.sourceNote ?? null],
          );
        }
      }
    }
    if (verify) throw VERIFY_ROLLBACK;
    await db.commit();
    console.log(apply ? 'Committed.' : 'Read-only. No changes attempted.');
  } catch (error) {
    await db.rollback();
    if (error === VERIFY_ROLLBACK) console.log('Verified and rolled back. No changes committed.');
    else throw error;
  } finally {
    await db.end();
  }
}

run().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
