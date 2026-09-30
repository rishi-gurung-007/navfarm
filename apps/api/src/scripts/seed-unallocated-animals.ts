/**
 * Additive-only demo seed: 20 unallocated GILT animals (current_batch_id
 * left NULL), so there is a real pool of unassigned animals to pick from
 * when creating a new ANIMAL_WISE batch through the app's Batch Create UI
 * (apps/web/.../batch-panel.tsx, its "unassigned animal candidates" picker
 * filters strictly on `current_batch_id IS NULL`, then on lob_id/breed_id).
 *
 * Mirrors the exact animal_register shape and conventions already used by
 * the breeding-stock block in seed-clean-e2e.ts (same columns, same
 * PURCHASED_LOCAL/ACTIVE pattern, current_batch_id intentionally omitted
 * from the INSERT so it stays NULL) — this script only replicates that one
 * block additively, without touching seed-clean-e2e.ts's destructive
 * TRUNCATE-everything path, so it's safe to run against a database that
 * already has real batches/inventory/schedulers in it.
 *
 * Idempotent: tagged with notes = 'DEMO-UNALLOCATED-BATCH-SEED' and skips
 * entirely if 20 such animals already exist.
 *
 * Usage:
 *   pnpm nx run api:db-seed-unallocated-animals
 */
import { randomUUID } from 'node:crypto';
import * as mysql from 'mysql2/promise';

const host = process.env.DATABASE_HOST || '127.0.0.1';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;

const tenantCode = (process.env.DEV_TENANT_CODE || 'devco').toLowerCase();
const tenantDatabase = process.env.DEV_TENANT_DATABASE || `tenant_${tenantCode}`;

const SEED_TAG = 'DEMO-UNALLOCATED-BATCH-SEED';
const COUNT = 20;

// Same two breeds and cost/tsi/grading conventions seed-clean-e2e.ts already
// uses for GILT rows — alternated so a new batch can be created against
// either breed.
const BREED_CODES = ['TN-70-Sow', 'Z-Line-Sow'];
const GRADINGS = ['GGP', 'GP', 'PS'];

export async function seedUnallocatedAnimals() {
  console.log('================================================================');
  console.log('🐖 SEEDING 20 UNALLOCATED GILT ANIMALS (additive only)');
  console.log('================================================================');
  console.log(`Database: ${tenantDatabase}`);

  const conn = await mysql.createConnection({ host, port, user, password, database: tenantDatabase, ssl });

  try {
    // 1. Resolve company & tenant
    const [companies] = await conn.query<mysql.RowDataPacket[]>(
      'SELECT company_id, tenant_id FROM company_master LIMIT 1',
    );
    if (!companies.length) {
      throw new Error('No company found. Run the base setup/seed scripts first.');
    }
    const { company_id: companyId, tenant_id: tenantId } = companies[0];

    // 2. Idempotency check
    const [existing] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) as c FROM animal_register WHERE company_id = ? AND notes = ?`,
      [companyId, SEED_TAG],
    );
    if (existing[0].c >= COUNT) {
      console.log(`   ↷ ${existing[0].c} tagged unallocated animals already exist — nothing to do.`);
      console.log('================================================================');
      console.log('✅ ALREADY SEEDED');
      console.log('================================================================');
      return;
    }

    // 3. Resolve operational area / nob / lob (same source as other scripts this session)
    const [areas] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT area_id, nob_id, lob_id FROM operational_area_master WHERE is_active = 1 LIMIT 1`,
    );
    if (!areas.length) throw new Error('No active operational area found.');
    const { area_id: areaId, nob_id: nobId, lob_id: lobId } = areas[0];

    // 4. Resolve the two breeds
    const [breedRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT breed_id, breed_code FROM breed_master WHERE breed_code IN (?, ?)`,
      BREED_CODES,
    );
    const breedByCode = new Map(breedRows.map((b) => [b.breed_code, b.breed_id]));
    const breedIds = BREED_CODES.map((c) => breedByCode.get(c)).filter(Boolean) as string[];
    if (!breedIds.length) throw new Error(`None of the breeds ${BREED_CODES.join(', ')} found.`);

    // 5. Resolve the GILT bio-asset item ("Replacement Breeding Gilt")
    const [giltItems] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT item_id FROM item_master WHERE company_id = ? AND item_name LIKE '%Replacement Breeding Gilt%' AND is_biological_asset = 1 LIMIT 1`,
      [companyId],
    );
    if (!giltItems.length) throw new Error('Replacement Breeding Gilt bio-asset item not found.');
    const giltItemId = giltItems[0].item_id;

    // 6. Resolve GILT_GROWER stage (prefer company-scoped, fallback to tenant-scoped)
    const [stageRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT stage_id FROM stage_master WHERE stage_code = 'GILT_GROWER' AND lob_id = ? AND (company_id = ? OR company_id IS NULL) AND is_active = 1 ORDER BY company_id DESC LIMIT 1`,
      [lobId, companyId],
    );
    if (!stageRows.length) throw new Error('GILT_GROWER stage not found for this LOB.');
    const stageId = stageRows[0].stage_id;

    // 7. Resolve pens to spread the new animals across
    const [penRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT location_id FROM location_master WHERE location_code LIKE 'MUL100/%' AND location_type = 'PEN' AND is_active = 1 ORDER BY location_code`,
    );
    if (!penRows.length) throw new Error('No pens found under MUL100.');

    // 8. Next animal_code / rfid_tag numbers, continuing the existing sequence
    const [codeRows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT MAX(CAST(SUBSTRING(animal_code, 10) AS UNSIGNED)) as max_code FROM animal_register WHERE animal_code LIKE 'PIG-2026-%' AND company_id = ?`,
      [companyId],
    );
    let nextCode = (codeRows[0].max_code || 0) + 1;

    console.log(`\n1️⃣  Inserting ${COUNT} unallocated GILT animals starting at PIG-2026-${String(nextCode).padStart(4, '0')}...`);

    const entryDate = new Date().toISOString().slice(0, 10);
    const today = new Date();

    for (let i = 0; i < COUNT; i++) {
      const breedId = breedIds[i % breedIds.length];
      const breedCode = BREED_CODES[i % breedIds.length];
      const pen = penRows[i % penRows.length];
      const grading = GRADINGS[i % GRADINGS.length];
      const cost = breedCode === 'TN-70-Sow' ? 320.0 : 340.0;
      const ageWeeks = 22 + (i % 10); // spread 22-31 weeks, same range as existing gilts
      const dob = new Date(today.getTime() - ageWeeks * 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);
      const code = `PIG-2026-${String(nextCode).padStart(4, '0')}`;
      const rfid = `9820004128800${String(nextCode).padStart(2, '0')}`.slice(-15);
      const earTag = `GLT-${breedCode === 'TN-70-Sow' ? 'TN' : 'ZL'}-${String(nextCode).padStart(3, '0')}`;
      const tsi = (120 + ((i * 3.7) % 8)).toFixed(2);
      const animalId = randomUUID();

      await conn.query(
        `INSERT INTO animal_register (
          animal_id, tenant_id, company_id, nob_id, lob_id, operational_area_id,
          animal_code, animal_type, breed_id, gender, dob, age_at_entry_weeks,
          entry_type, entry_date, item_id, ear_tag, rfid_tag, acquisition_cost,
          total_opening_asset_value, current_bio_asset_value, book_value, total_amortised,
          parity_count, total_piglets_born_live, total_piglets_weaned,
          current_stage_id, current_location_id, no_of_teats, tsi, grading,
          status, is_active, notes
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, 'GILT', ?, 'F', ?, ?,
          'PURCHASED_LOCAL', ?, ?, ?, ?, ?,
          ?, ?, ?, 0.0000,
          0, 0, 0,
          ?, ?, 16, ?, ?,
          'ACTIVE', 1, ?
        )`,
        [
          animalId, tenantId, companyId, nobId, lobId, areaId,
          code, breedId, dob, ageWeeks,
          entryDate, giltItemId, earTag, rfid, cost,
          cost, cost, cost,
          stageId, pen.location_id, tsi, grading,
          SEED_TAG,
        ],
      );
      nextCode++;
    }

    // 9. Keep the ANIMAL number series consistent with what was just inserted
    await conn.query(
      `UPDATE no_series SET current_seq = ?, last_no_used = ? WHERE code = 'ANIMAL' AND company_id = ?`,
      [nextCode - 1, `PIG-2026-${String(nextCode - 1).padStart(4, '0')}`, companyId],
    );

    console.log(`   ✔ Inserted ${COUNT} unallocated GILT animals (PIG-2026-${String(nextCode - COUNT).padStart(4, '0')} .. PIG-2026-${String(nextCode - 1).padStart(4, '0')}), current_batch_id = NULL`);
    console.log('================================================================');
    console.log('🎉 UNALLOCATED ANIMALS SEED COMPLETED');
    console.log('================================================================');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seedUnallocatedAnimals().catch((err) => {
    console.error('❌ Failed to seed unallocated animals:', err.message || err);
    process.exitCode = 1;
  });
}
