import { resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { eq, and, sql, isNull, ne } from 'drizzle-orm';
import * as mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import * as master from '../core/database/master-schema';
import * as tenant from '../core/database/schema';

/**
 * Standard Activity Master Seed Catalog
 * Covers all 6 line types with smart defaults for piggery and shared verticals.
 */
export const STANDARD_ACTIVITY_SEEDS = [
  // ── CONSUMPTION ──
  {
    activity_code: 'MORN_FEED',
    activity_name: 'Morning Feed',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: true,
    default_occurrence: 'DAILY',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: true,
    default_lot_required: false,
    description: 'Primary morning ration feed distribution.',
  },
  {
    activity_code: 'EVE_FEED',
    activity_name: 'Evening Feed',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: true,
    default_occurrence: 'DAILY',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: true,
    default_lot_required: false,
    description: 'Secondary evening ration feed distribution.',
  },
  {
    activity_code: 'CREEP_FEED',
    activity_name: 'Creep Feed',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: true,
    default_occurrence: 'DAILY',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: false,
    default_lot_required: false,
    description: 'High-nutrient starter feed for suckling piglets.',
  },
  {
    activity_code: 'BOOSTER_VAC',
    activity_name: 'Booster Vaccine',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: false,
    default_occurrence: 'ONCE',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: true,
    default_lot_required: true,
    description: 'Scheduled booster vaccination for herd immunity.',
  },
  {
    activity_code: 'IRON_INJ',
    activity_name: 'Iron Injection (Day 3)',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: true,
    default_lot_required: true,
    description: 'Iron dextran injection for newborn piglets to prevent anaemia.',
  },
  {
    activity_code: 'DEWORM_DOSE',
    activity_name: 'Deworming Dose',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: false,
    default_occurrence: 'MONTHLY',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: false,
    default_lot_required: true,
    description: 'Anthelmintic dewormer for internal parasite control.',
  },
  {
    activity_code: 'VIT_SUPPL',
    activity_name: 'Vitamin & Mineral Supplement',
    line_type: 'CONSUMPTION' as const,
    is_piggery_specific: false,
    default_occurrence: 'WEEKLY',
    default_qty_basis: 'PER_HEAD',
    default_is_mandatory: false,
    default_lot_required: false,
    description: 'Water-soluble or feed-top electrolyte/vitamin booster mix.',
  },

  // ── OUTPUT ──
  {
    activity_code: 'PIGLET_OUTPUT',
    activity_name: 'Piglet Output (Live Born)',
    line_type: 'OUTPUT' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_output_basis: 'PER_SOW',
    default_is_mandatory: true,
    description: 'Record live piglet count and birth weight from farrowing.',
  },
  {
    activity_code: 'WEAN_OUTPUT',
    activity_name: 'Weaner Pig Output',
    line_type: 'OUTPUT' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_output_basis: 'PER_SOW',
    default_is_mandatory: true,
    description: 'Harvest weaner pigs at end of lactation stage.',
  },
  {
    activity_code: 'FINISHER_OUTPUT',
    activity_name: 'Finisher Pig Output',
    line_type: 'OUTPUT' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_output_basis: 'PER_PEN',
    default_is_mandatory: true,
    description: 'Market-weight finishers ready for sale or slaughter transfer.',
  },
  {
    activity_code: 'SEMEN_HARVEST',
    activity_name: 'Boar Semen Collection',
    line_type: 'OUTPUT' as const,
    is_piggery_specific: true,
    default_occurrence: 'WEEKLY',
    default_output_basis: 'PER_HEAD',
    default_is_mandatory: false,
    description: 'AI stud boar semen harvest doses.',
  },
  {
    activity_code: 'MANURE_OUTPUT',
    activity_name: 'Organic Compost / Manure',
    line_type: 'OUTPUT' as const,
    is_piggery_specific: false,
    default_occurrence: 'MONTHLY',
    default_output_basis: 'PER_BATCH',
    default_is_mandatory: false,
    description: 'Collected solid manure / compost by-product output.',
  },

  // ── DESCRIPTIVE ──
  {
    activity_code: 'DAILY_MORTALITY_CHECK',
    activity_name: 'Daily Mortality Check',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: false,
    default_occurrence: 'DAILY',
    default_kpi_metric: 'MORTALITY_COUNT',
    default_capture_per: 'TOTAL',
    default_is_mandatory: true,
    description: 'Daily headcount inspection to record animal deaths and causes.',
  },
  {
    activity_code: 'WEEKLY_BODY_WEIGHT',
    activity_name: 'Weekly Body Weight Check',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: false,
    default_occurrence: 'WEEKLY',
    default_kpi_metric: 'BODY_WEIGHT',
    default_capture_per: 'AVERAGE',
    default_is_mandatory: false,
    description: 'Sample pen weighing to evaluate ADG and FCR trajectory.',
  },
  {
    activity_code: 'BCS_EVAL',
    activity_name: 'Body Condition Score (BCS)',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: true,
    default_occurrence: 'WEEKLY',
    default_kpi_metric: 'BCS',
    default_capture_per: 'AVERAGE',
    default_is_mandatory: false,
    description: 'Visual and palpation scoring of sow fatness (1 to 5 scale).',
  },
  {
    activity_code: 'HEAT_CHECK',
    activity_name: 'Estrus / Heat Detection Check',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: true,
    default_occurrence: 'DAILY',
    default_kpi_metric: 'HEAT_SCORE',
    default_capture_per: 'PER_HEAD',
    default_is_mandatory: false,
    description: 'Twice-daily boar-run estrus detection for artificial insemination.',
  },
  {
    activity_code: 'PREG_CHECK',
    activity_name: 'Pregnancy Ultrasound Check',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_kpi_metric: 'PREGNANCY_STATUS',
    default_capture_per: 'PER_HEAD',
    default_is_mandatory: true,
    description: 'Ultrasound confirmation of pregnancy at 28-35 days post-mating.',
  },
  {
    activity_code: 'TEMP_HUMID_LOG',
    activity_name: 'Barn Temperature & Humidity',
    line_type: 'DESCRIPTIVE' as const,
    is_piggery_specific: false,
    default_occurrence: 'DAILY',
    default_kpi_metric: 'TEMPERATURE_C',
    default_capture_per: 'AVERAGE',
    default_is_mandatory: false,
    description: 'Environmental climate monitoring inside rearing sheds.',
  },

  // ── OVERHEAD ──
  {
    activity_code: 'ELECTRICITY_COST',
    activity_name: 'Electricity Consumption',
    line_type: 'OVERHEAD' as const,
    is_piggery_specific: false,
    default_occurrence: 'MONTHLY',
    default_overhead_category: 'UTILITIES',
    default_gl_account: '7200',
    default_is_mandatory: false,
    description: 'Power charges for barn ventilation, lighting, and heating lamps.',
  },
  {
    activity_code: 'WATER_UTILITY',
    activity_name: 'Water Utility Expense',
    line_type: 'OVERHEAD' as const,
    is_piggery_specific: false,
    default_occurrence: 'MONTHLY',
    default_overhead_category: 'UTILITIES',
    default_gl_account: '7210',
    default_is_mandatory: false,
    description: 'Clean water supply for animal drinking nipples and barn washdowns.',
  },
  {
    activity_code: 'BEDDING_MATERIAL',
    activity_name: 'Straw / Bedding Replenishment',
    line_type: 'OVERHEAD' as const,
    is_piggery_specific: true,
    default_occurrence: 'WEEKLY',
    default_overhead_category: 'SUPPLIES',
    default_gl_account: '7300',
    default_is_mandatory: false,
    description: 'Clean wood shavings or straw replacement for farrowing pens.',
  },
  {
    activity_code: 'FACILITY_MAINT',
    activity_name: 'Barn & Pen Maintenance',
    line_type: 'OVERHEAD' as const,
    is_piggery_specific: false,
    default_occurrence: 'MONTHLY',
    default_overhead_category: 'MAINTENANCE',
    default_gl_account: '7400',
    default_is_mandatory: false,
    description: 'Repairs to gates, drinkers, feeders, and slat flooring.',
  },

  // ── RESOURCE ──
  {
    activity_code: 'FARM_WORKER_ROUND',
    activity_name: 'Farm Worker Round',
    line_type: 'RESOURCE' as const,
    is_piggery_specific: false,
    default_occurrence: 'DAILY',
    default_is_mandatory: false,
    description: 'General daily feeding, pen scrap-down, and bedding upkeep labor hours.',
  },
  {
    activity_code: 'VET_VISIT',
    activity_name: 'Veterinary Health Inspection',
    line_type: 'RESOURCE' as const,
    is_piggery_specific: false,
    default_occurrence: 'WEEKLY',
    default_is_mandatory: false,
    description: 'Professional herd health inspection and treatment by farm veterinarian.',
  },
  {
    activity_code: 'DISINFECT_CREW',
    activity_name: 'Deep Disinfection Crew',
    line_type: 'RESOURCE' as const,
    is_piggery_specific: false,
    default_occurrence: 'ONCE',
    default_is_mandatory: false,
    description: 'All-in-all-out terminal pressure washing and chemical sanitization.',
  },
  {
    activity_code: 'FARROW_ATTEND',
    activity_name: 'Farrowing Supervision',
    line_type: 'RESOURCE' as const,
    is_piggery_specific: true,
    default_occurrence: 'DAILY',
    default_is_mandatory: false,
    description: 'Dedicated midwife supervision during active farrowing batches.',
  },

  // ── TRANSFER ──
  {
    activity_code: 'TRANSFER_TO_NEXT_STAGE',
    activity_name: 'Transfer to Next Stage Batch',
    line_type: 'TRANSFER' as const,
    is_piggery_specific: false,
    default_occurrence: 'ONCE',
    default_is_mandatory: true,
    description: 'Standard transition advancing animals to the next stage in sequence.',
  },
  {
    activity_code: 'WEAN_TRANSFER',
    activity_name: 'Weaning Transfer to Nursery',
    line_type: 'TRANSFER' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_is_mandatory: true,
    description: 'Batch movement of weaned piglets from farrowing to nursery.',
  },
  {
    activity_code: 'GROW_TRANSFER',
    activity_name: 'Transfer to Grow-Finish Pens',
    line_type: 'TRANSFER' as const,
    is_piggery_specific: true,
    default_occurrence: 'ONCE',
    default_is_mandatory: true,
    description: 'Batch movement of feeder pigs from nursery to grow-finish barn.',
  },
];

const host = process.env.DATABASE_HOST || 'localhost';
const port = Number(process.env.DATABASE_PORT || 3306);
const user = process.env.DATABASE_USERNAME || 'root';
const password = process.env.DATABASE_PASSWORD || '';
const ssl = process.env.DATABASE_SSL === 'true'
  ? { minVersion: 'TLSv1.2' as const, rejectUnauthorized: true }
  : undefined;
const masterDatabase = process.env.DATABASE_NAME || 'navfarm_master';

export async function seedActivitiesForTenant(tenantDb: any, tenantId: string) {
  // Resolve LIVESTOCK NOB and LVS_PIGGERY LOB
  const [pigNob] = await tenantDb.select().from(tenant.nobMaster).where(eq(tenant.nobMaster.nob_code, 'LIVESTOCK')).limit(1);
  const [pigLob] = await tenantDb.select().from(tenant.lobMaster).where(eq(tenant.lobMaster.lob_code, 'LVS_PIGGERY')).limit(1);

  const companies = await tenantDb.select().from(tenant.companyMaster).where(ne(tenant.companyMaster.company_code, 'PLACEHOLDER'));
  const targets: Array<{ companyId: string | null; label: string }> = [
    { companyId: null, label: 'Tenant Template' },
    ...companies.map((c: any) => ({ companyId: c.company_id, label: c.company_name })),
  ];

  let inserted = 0;
  let updated = 0;

  for (const target of targets) {
    const existing = await tenantDb.select().from(tenant.activityMaster).where(
      and(
        eq(tenant.activityMaster.tenant_id, tenantId),
        target.companyId ? eq(tenant.activityMaster.company_id, target.companyId) : isNull(tenant.activityMaster.company_id),
      ),
    );
    const existingCodes = new Set(existing.map((e: any) => e.activity_code));

    for (const s of STANDARD_ACTIVITY_SEEDS) {
      const nobId = s.is_piggery_specific ? (pigNob?.nob_id || null) : null;
      const lobId = s.is_piggery_specific ? (pigLob?.lob_id || null) : null;

      if (!existingCodes.has(s.activity_code)) {
        await tenantDb.insert(tenant.activityMaster).values({
          activity_id: randomUUID(),
          tenant_id: tenantId,
          company_id: target.companyId,
          nob_id: nobId,
          lob_id: lobId,
          activity_code: s.activity_code,
          activity_name: s.activity_name,
          line_type: s.line_type,
          description: s.description,
          default_occurrence: s.default_occurrence || null,
          default_qty_basis: (s as any).default_qty_basis || null,
          default_output_basis: (s as any).default_output_basis || null,
          default_kpi_metric: (s as any).default_kpi_metric || null,
          default_capture_per: (s as any).default_capture_per || null,
          default_overhead_category: (s as any).default_overhead_category || null,
          default_gl_account: (s as any).default_gl_account || null,
          default_is_mandatory: s.default_is_mandatory,
          default_lot_required: (s as any).default_lot_required || false,
          is_active: true,
        });
        inserted++;
      } else {
        // Update description / defaults if already created
        await tenantDb.update(tenant.activityMaster).set({
          activity_name: s.activity_name,
          line_type: s.line_type,
          description: s.description,
          default_occurrence: s.default_occurrence || null,
          default_qty_basis: (s as any).default_qty_basis || null,
          default_output_basis: (s as any).default_output_basis || null,
          default_kpi_metric: (s as any).default_kpi_metric || null,
          default_capture_per: (s as any).default_capture_per || null,
          default_overhead_category: (s as any).default_overhead_category || null,
          default_gl_account: (s as any).default_gl_account || null,
          default_is_mandatory: s.default_is_mandatory,
          default_lot_required: (s as any).default_lot_required || false,
        }).where(and(
          eq(tenant.activityMaster.tenant_id, tenantId),
          target.companyId ? eq(tenant.activityMaster.company_id, target.companyId) : isNull(tenant.activityMaster.company_id),
          eq(tenant.activityMaster.activity_code, s.activity_code),
        ));
        updated++;
      }
    }
  }

  return { inserted, updated, total: STANDARD_ACTIVITY_SEEDS.length * targets.length };
}

async function run() {
  const masterPool = mysql.createPool({ host, port, user, password, database: masterDatabase, ssl });
  const masterDb = drizzle(masterPool, { schema: master, mode: 'default' });

  try {
    const tenants = await masterDb.select().from(master.tenantMaster);
    console.log(`Found ${tenants.length} tenant(s) in ${masterDatabase}.`);

    for (const t of tenants) {
      const tenantPool = mysql.createPool({
        host: t.db_host || host,
        port: t.db_port || port,
        user: t.db_user || user,
        password: t.db_password || password,
        database: t.db_name,
        ssl,
      });
      const tenantDb = drizzle(tenantPool, { schema: tenant, mode: 'default' });

      try {
        const result = await seedActivitiesForTenant(tenantDb, t.tenant_id);
        console.log(`  [${t.tenant_code}] Seeded activities: ${result.inserted} inserted, ${result.updated} updated (total catalog: ${result.total}).`);
      } catch (err) {
        console.error(`  [${t.tenant_code}] FAILED:`, err instanceof Error ? err.message : err);
      } finally {
        await tenantPool.end();
      }
    }

    console.log('Finished seeding activities.');
  } finally {
    await masterPool.end();
  }
}

if (process.argv[1]?.includes('seed-activity-master')) {
  void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
