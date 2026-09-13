import * as mysql from 'mysql2/promise';
import { randomUUID } from 'crypto';

interface LifecycleDefinition {
  code: string;
  stageCode: string;
  calcUnit: string;
  periodFrom: number;
  periodTo: number;
  feedItemCode?: string;
  feedQtyPerDayKg?: number;
  feedWastagePct?: number;
  stdBodyWeightKg?: number;
  stdAdgGpd?: number;
  stdFcr?: number;
  stdMortalityRatePct?: number;
  outputItemCode?: string;
  outputUom?: string;
  stdOutputQty?: number;
  stdTeats?: number;
  alertSeverity: string;
  notes: string;
}

const LANDRACE_LIFECYCLE_STAGES: LifecycleDefinition[] = [
  {
    code: 'BLS-LAND-01',
    stageCode: 'QUARANTINE',
    calcUnit: 'DAY',
    periodFrom: 1,
    periodTo: 7,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 1.5,
    feedWastagePct: 5.0,
    stdBodyWeightKg: 43.0,
    stdAdgGpd: 340.0,
    stdFcr: 4.4,
    stdMortalityRatePct: 1.0,
    stdTeats: 15,
    alertSeverity: 'WARNING',
    notes: 'Quarantine health monitoring and acclimatization. Minimum 15 teats expected.'
  },
  {
    code: 'BLS-LAND-02',
    stageCode: 'GILT_GROWER',
    calcUnit: 'DAY',
    periodFrom: 8,
    periodTo: 120,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 2.2,
    feedWastagePct: 5.0,
    stdBodyWeightKg: 122.0,
    stdAdgGpd: 780.0,
    stdFcr: 2.8,
    stdMortalityRatePct: 0.5,
    stdTeats: 15,
    alertSeverity: 'WARNING',
    notes: 'Landrace gilts target service weight 120-130 kg. Minimum 15 teats required for breeding.'
  },
  {
    code: 'BLS-LAND-03',
    stageCode: 'FLUSH_SERVICE',
    calcUnit: 'DAY',
    periodFrom: 121,
    periodTo: 128,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 3.0,
    feedWastagePct: 5.0,
    stdBodyWeightKg: 125.0,
    stdMortalityRatePct: 0.2,
    stdTeats: 15,
    alertSeverity: 'INFO',
    notes: 'High farrowing rate target 87%. Confirm conception scan on Day 21.'
  },
  {
    code: 'BLS-LAND-04',
    stageCode: 'DRY_SOW_GESTATION',
    calcUnit: 'DAY',
    periodFrom: 129,
    periodTo: 242,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 2.5,
    feedWastagePct: 3.0,
    stdBodyWeightKg: 168.0,
    stdAdgGpd: 295.0,
    stdMortalityRatePct: 0.3,
    stdTeats: 15,
    alertSeverity: 'WARNING',
    notes: 'Standard gestation length 114-115 days. Maintain Body Condition Score (BCS) 3.0-3.5.'
  },
  {
    code: 'BLS-LAND-05',
    stageCode: 'FARROWING',
    calcUnit: 'DAY',
    periodFrom: 243,
    periodTo: 250,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 1.5,
    feedWastagePct: 0.0,
    stdMortalityRatePct: 0.5,
    outputItemCode: 'LVS-PIGLET',
    outputUom: 'PCS',
    stdOutputQty: 12.0,
    stdTeats: 15,
    alertSeverity: 'CRITICAL',
    notes: 'Prolific maternal line. Live born target >= 12. Record live born, weak, and stillbirths.'
  },
  {
    code: 'BLS-LAND-06',
    stageCode: 'LACTATION',
    calcUnit: 'DAY',
    periodFrom: 251,
    periodTo: 278,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 6.5,
    feedWastagePct: 3.0,
    stdBodyWeightKg: 152.0,
    stdMortalityRatePct: 0.3,
    outputItemCode: 'LVS-PIGLET',
    outputUom: 'PCS',
    stdOutputQty: 10.5,
    stdTeats: 15,
    alertSeverity: 'WARNING',
    notes: 'Ad-lib feeding to maximize milk yield. Target 10.5 weaned per litter with 6.5 kg weaning weight.'
  },
  {
    code: 'BLS-LAND-07',
    stageCode: 'WEANING',
    calcUnit: 'DAY',
    periodFrom: 279,
    periodTo: 285,
    stdBodyWeightKg: 6.5,
    stdMortalityRatePct: 0.0,
    outputItemCode: 'LVS-PIGLET',
    outputUom: 'PCS',
    stdOutputQty: 10.5,
    stdTeats: 15,
    alertSeverity: 'INFO',
    notes: 'Individual weaning weights recorded. Target sow weaning-to-service interval <= 5 days.'
  },
  {
    code: 'BLS-LAND-08',
    stageCode: 'CB_GROWER',
    calcUnit: 'DAY',
    periodFrom: 286,
    periodTo: 363,
    feedItemCode: 'LVS-PIG-FEED',
    feedQtyPerDayKg: 2.5,
    feedWastagePct: 5.0,
    stdBodyWeightKg: 112.0,
    stdAdgGpd: 770.0,
    stdFcr: 2.85,
    stdMortalityRatePct: 1.5,
    outputItemCode: 'LVS-DRESSED-PORK',
    outputUom: 'KG',
    stdOutputQty: 80.0,
    alertSeverity: 'CRITICAL',
    notes: 'Market finisher phase. Target 112 kg live weight at 77 days in grower. FCR must stay <= 2.85.'
  }
];

async function seedTenantDatabase(dbName: string, tenantId: string) {
  console.log(`\n>>> Seeding 8 Breed Lifecycle Stages in: ${dbName}`);
  const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: dbName });

  try {
    // 1. Get all Landrace breeds in this tenant (including company-specific and template)
    const [breeds] = await conn.query<any[]>(
      'SELECT breed_id, breed_code, breed_name, company_id FROM breed_master WHERE breed_code = "LANDRACE"'
    );
    if (!breeds.length) {
      console.log(`  No LANDRACE breed found in ${dbName}. Skipping.`);
      await conn.end();
      return;
    }

    // 2. Fetch stage mapping: map stage_code + company_id -> stage_id
    const [stages] = await conn.query<any[]>(
      'SELECT stage_id, stage_code, company_id FROM stage_master'
    );

    // 3. Fetch item mapping
    const [items] = await conn.query<any[]>(
      'SELECT item_id, item_code, company_id FROM item_master'
    );

    const resolveItem = (code?: string, companyId?: string | null) => {
      if (!code) return null;
      // Match company item first, then template
      const match = items.find((i) => i.item_code === code && i.company_id === companyId)
                 || items.find((i) => i.item_code === code && !i.company_id)
                 || items.find((i) => i.item_code.includes('PIG') && (i.company_id === companyId || !i.company_id));
      return match ? match.item_id : null;
    };

    const resolveStage = (stageCode: string, companyId?: string | null) => {
      // Find exact stage_code for this company, or fallback to company_id is null, or alternative code
      const match = stages.find((s) => s.stage_code === stageCode && s.company_id === companyId)
                 || stages.find((s) => s.stage_code === stageCode && !s.company_id)
                 || (stageCode === 'DRY_SOW_GESTATION' && (stages.find((s) => s.stage_code === 'GESTATION' && s.company_id === companyId) || stages.find((s) => s.stage_code === 'GESTATION' && !s.company_id)));
      return match ? match.stage_id : null;
    };

    let insertedCount = 0;
    let updatedCount = 0;

    for (const breed of breeds) {
      let companyCode = 'TPL';
      if (breed.company_id) {
        const [comp] = await conn.query<any[]>(
          'SELECT company_code FROM company_master WHERE company_id = ?',
          [breed.company_id]
        );
        if (comp.length && comp[0].company_code) {
          companyCode = comp[0].company_code;
        }
      }

      console.log(`  Processing breed: ${breed.breed_name} (${breed.breed_id}), company: ${companyCode}`);

      for (let i = 0; i < LANDRACE_LIFECYCLE_STAGES.length; i++) {
        const def = LANDRACE_LIFECYCLE_STAGES[i];
        const num = String(i + 1).padStart(2, '0');
        // Unique code per tenant and company
        const code = companyCode === 'TPL' ? `BLS-LAND-${num}` : `BLS-${companyCode.slice(0, 4)}-${num}`;

        const stageId = resolveStage(def.stageCode, breed.company_id);
        if (!stageId) {
          console.warn(`    Stage '${def.stageCode}' not found for company ${breed.company_id}. Skipping.`);
          continue;
        }

        const feedItemId = resolveItem(def.feedItemCode, breed.company_id);
        const outputItemId = resolveItem(def.outputItemCode, breed.company_id);

        // Check if a lifecycle stage already exists for this (breed_id, stage_id)
        const [existing] = await conn.query<any[]>(
          'SELECT lifecycle_id FROM breed_lifecycle_stages WHERE breed_id = ? AND stage_id = ?',
          [breed.breed_id, stageId]
        );

        if (existing.length > 0) {
          await conn.query(
            `UPDATE breed_lifecycle_stages SET
              lifecycle_code = ?,
              calc_unit = ?,
              period_from = ?,
              period_to = ?,
              feed_item_id = ?,
              feed_qty_per_head_per_day_kg = ?,
              feed_wastage_pct = ?,
              std_body_weight_kg = ?,
              std_adg_gpd = ?,
              std_fcr = ?,
              std_mortality_rate_pct = ?,
              output_item_id = ?,
              output_uom = ?,
              std_output_qty = ?,
              std_teats = ?,
              alert_severity = ?,
              notes = ?,
              is_active = 1
            WHERE lifecycle_id = ?`,
            [
              code,
              def.calcUnit,
              def.periodFrom,
              def.periodTo,
              feedItemId,
              def.feedQtyPerDayKg ?? null,
              def.feedWastagePct ?? null,
              def.stdBodyWeightKg ?? null,
              def.stdAdgGpd ?? null,
              def.stdFcr ?? null,
              def.stdMortalityRatePct ?? null,
              outputItemId,
              def.outputUom ?? null,
              def.stdOutputQty ?? null,
              def.stdTeats ?? null,
              def.alertSeverity,
              def.notes,
              existing[0].lifecycle_id,
            ]
          );
          updatedCount++;
        } else {
          await conn.query(
            `INSERT INTO breed_lifecycle_stages (
              lifecycle_id,
              tenant_id,
              breed_id,
              stage_id,
              lifecycle_code,
              calc_unit,
              period_from,
              period_to,
              feed_item_id,
              feed_qty_per_head_per_day_kg,
              feed_wastage_pct,
              std_body_weight_kg,
              std_adg_gpd,
              std_fcr,
              std_mortality_rate_pct,
              output_item_id,
              output_uom,
              std_output_qty,
              std_teats,
              alert_severity,
              notes,
              is_active,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [
              randomUUID(),
              tenantId,
              breed.breed_id,
              stageId,
              code,
              def.calcUnit,
              def.periodFrom,
              def.periodTo,
              feedItemId,
              def.feedQtyPerDayKg ?? null,
              def.feedWastagePct ?? null,
              def.stdBodyWeightKg ?? null,
              def.stdAdgGpd ?? null,
              def.stdFcr ?? null,
              def.stdMortalityRatePct ?? null,
              outputItemId,
              def.outputUom ?? null,
              def.stdOutputQty ?? null,
              def.stdTeats ?? null,
              def.alertSeverity,
              def.notes,
            ]
          );
          insertedCount++;
        }
      }
    }

    console.log(`  Done for ${dbName}: ${insertedCount} inserted, ${updatedCount} updated.`);
  } finally {
    await conn.end();
  }
}

async function main() {
  const masterDatabases = ['navfarm_dev_master', 'navfarm_master'];

  for (const masterDb of masterDatabases) {
    try {
      console.log(`\n================ Checking master DB: ${masterDb} ================`);
      const conn = await mysql.createConnection({ host: 'localhost', user: 'root', database: masterDb });
      const [tenants] = await conn.query<any[]>(
        'SELECT tenant_id, tenant_code, db_name FROM tenant_master WHERE tenant_code != "system"'
      );
      await conn.end();

      for (const t of tenants) {
        await seedTenantDatabase(t.db_name, t.tenant_id);
      }
    } catch (e: any) {
      console.log(`Master DB ${masterDb} check skipped: ${e.message}`);
    }
  }

  console.log('\nMigration completed successfully.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
