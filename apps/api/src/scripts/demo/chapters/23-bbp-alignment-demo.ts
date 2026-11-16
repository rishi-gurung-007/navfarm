/**
 * Chapter `23-bbp-alignment-demo` — demo data for the 13 Nov 2026 BBP alignment work, on top of the project seed (`pnpm seed:project`), run on demand:
 *
 *   pnpm nx run api:db-bbp-alignment-demo
 *
 * Through the application's own services, it shows each of the new features with figures you can read back:
 *   1. GL switches: the opt-in BIO_LOT_WIP and BIO_SLAUGHTER_* mappings, with the project chart's accounts (as db-enable-lot-wip-gl / db-enable-slaughter-gl add them).
 *   2. Gilt Class Rules: the herd's dam line x sire line gives GP-LOC-F.
 *   3. Lot fair value: the litter lots' item (Suckling Live Piglet) is given fair value terms from week 17, the PIGLETS item's accounts, and DEMO rates by age band.
 *   4. Lot WIP: feed on two weaner lots on 15 Oct 2026 goes to WIP Weaners; the September and October lot runs recognise it and value the lots.
 *   5. Slaughter Transfer Orders: DEMO-BBP-1 run to CLOSED (two lines, one DOA, kill sheet, invoice); DEMO-BBP-2 dispatched and still in transit.
 * The sow-feed-to-litter change (Phase F) needs no step here: the project seed's farrowings and weanings already go through it.
 *
 * DEMO FIGURES, NOT CLIENT DATA: the weights by age (70 / 90 / 105 kg at weeks 17 / 21 / 25), the price (2.35 per kg), the feed quantity, the head on the
 * Transfer Orders, the carcass weights (82 / 85 kg) and the abattoir price (2.60 per kg). Resume-safe: every step looks for what it already did.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { GiltClassRuleService } from '../../../modules/master-data/breeding-line/gilt-class-rule.service';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { LotFairValueService } from '../../../modules/production/batch/lot-fair-value.service';
import { SlaughterTransferService } from '../../../modules/production/slaughter/slaughter-transfer.service';
import type { DemoChapter, DemoContext } from '../chapter';

const TAG = 'DEMO-BBP';
const LOT_ITEM = 'Suckling Live Piglet (0-4 Wks)';
const DEMO_RATES = [ // DEMO: weight by age band, one price; not client figures
  { age_week_from: 17, expected_weight_kg: 70, price_per_kg: 2.35 },
  { age_week_from: 21, expected_weight_kg: 90, price_per_kg: 2.35 },
  { age_week_from: 25, expected_weight_kg: 105, price_per_kg: 2.35 },
];
const FEED_DATE = '2026-10-15';
const TO_DATE = '2026-11-05';

export const bbpAlignmentDemoChapter: DemoChapter = {
  name: '23-bbp-alignment-demo',
  async run(ctx: DemoContext) {
    const db = ctx.app.get(ClsService).get<MySql2Database<typeof schema>>('tenantDb')!;
    const { tenantId, companyId } = ctx;
    const actor = ctx.actor as any;
    const accountOf = async (code: string) => {
      const [a] = await db.select().from(schema.glAccountMaster).where(and(eq(schema.glAccountMaster.company_id, companyId), eq(schema.glAccountMaster.account_code, code))).limit(1);
      if (!a) throw new Error(`23-bbp-alignment-demo: the chart has no account ${code} - run the project seed first.`);
      return a.gl_account_id;
    };

    // 1. The GL switches.
    const switches: Array<[string, string, string]> = [
      ['BIO_LOT_WIP', '160400', '170400'],
      ['BIO_SLAUGHTER_DISPATCH', '170900', '170400'], ['BIO_SLAUGHTER_DOA', '610400', '170900'],
      ['BIO_SLAUGHTER_SALE', '120100', '410100'], ['BIO_SLAUGHTER_COGS', '510100', '170900'],
    ];
    for (const [type, dr, cr] of switches) {
      const [have] = await db.select({ id: schema.glMappingMaster.mapping_id }).from(schema.glMappingMaster)
        .where(and(eq(schema.glMappingMaster.company_id, companyId), eq(schema.glMappingMaster.transaction_type, type), isNull(schema.glMappingMaster.deleted_at))).limit(1);
      if (have) continue;
      await db.insert(schema.glMappingMaster).values({ mapping_id: randomUUID(), tenant_id: tenantId, company_id: companyId, transaction_type: type, debit_gl_account_id: await accountOf(dr), credit_gl_account_id: await accountOf(cr) } as any);
      ctx.log(`  GL mapping ${type}: Dr ${dr} / Cr ${cr}`);
    }

    // 2. A gilt class rule for the herd's own pairing: the dam line and sire line of its litters.
    const [pair] = await db
      .select({ dam: sql<string>`sow.breed_id`, sire: sql<string>`boar.breed_id`, n: sql<string>`COUNT(*)` })
      .from(schema.farrowingRecord)
      .innerJoin(sql`animal_register sow`, sql`sow.animal_id = ${schema.farrowingRecord.sow_animal_id}`)
      .innerJoin(schema.breedingRecord, eq(schema.breedingRecord.breeding_id, schema.farrowingRecord.breeding_id))
      .innerJoin(sql`animal_register boar`, sql`boar.animal_id = ${schema.breedingRecord.boar_animal_id}`)
      .where(eq(schema.farrowingRecord.tenant_id, tenantId))
      .groupBy(sql`sow.breed_id`, sql`boar.breed_id`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(1);
    const [gpLocF] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), like(schema.itemMaster.item_code, 'GP-LOC-F%'))).limit(1);
    if (pair?.dam && pair?.sire && gpLocF) {
      const rules = ctx.app.get(GiltClassRuleService);
      const existing = await rules.resolve(pair.dam, pair.sire, tenantId, companyId);
      if (!existing) {
        await rules.create({ company_id: companyId, dam_breed_id: pair.dam, sire_breed_id: pair.sire, gilt_item_id: gpLocF.item_id }, tenantId, actor);
        ctx.log(`  Gilt Class Rule: the herd's dam line x sire line -> ${gpLocF.item_code}`);
      }
    } else ctx.log('  Gilt Class Rule: skipped (no litter with a known sire, or no GP-LOC-F item)');

    // 3. The litter lots' item gets fair value terms, the PIGLETS accounts, and DEMO rates.
    const [lotItem] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.item_name, LOT_ITEM))).limit(1);
    const [piglets] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), eq(schema.itemMaster.item_code, 'PIGLETS'))).limit(1);
    if (!lotItem) throw new Error(`23-bbp-alignment-demo: no item "${LOT_ITEM}".`);
    if (lotItem.bio_costing_method !== 'FAIR_VALUE') {
      await db.update(schema.itemMaster).set({
        bio_costing_method: 'FAIR_VALUE', bio_start_age_weeks: 17, bio_start_age_days: 0, bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS',
        bio_acquisition_gl_id: piglets?.bio_acquisition_gl_id ?? (await accountOf('170400')),
        bio_fv_gain_loss_gl_id: piglets?.bio_fv_gain_loss_gl_id ?? (await accountOf('720100')),
        bio_fv_loss_gl_id: piglets?.bio_fv_loss_gl_id ?? (await accountOf('820100')),
        bio_writeoff_gl_id: piglets?.bio_writeoff_gl_id ?? (await accountOf('610400')),
      } as any).where(eq(schema.itemMaster.item_id, lotItem.item_id));
      ctx.log(`  ${LOT_ITEM}: FAIR_VALUE from week 17, gain / loss to the weaner fair value accounts`);
    }
    const [hasRates] = await db.select({ n: sql<string>`COUNT(*)` }).from(schema.itemFairValueRate).where(eq(schema.itemFairValueRate.item_id, lotItem.item_id));
    if (!Number(hasRates?.n)) {
      await db.insert(schema.itemFairValueRate).values(DEMO_RATES.map((r) => ({
        rate_id: randomUUID(), item_id: lotItem.item_id, farm_id: null, age_week_from: r.age_week_from, effective_from: '2025-01-01',
        expected_weight_kg: String(r.expected_weight_kg), price_per_kg: String(r.price_per_kg), cdm_based: false, costs_to_sell_pct: null,
      })) as any);
      ctx.log(`  DEMO fair value rates: ${DEMO_RATES.map((r) => `week ${r.age_week_from}+ ${r.expected_weight_kg} kg`).join(', ')} at 2.35 per kg`);
    }

    // The weaner lots, oldest first, with head.
    const lots = await db
      .select({ b: schema.batchHeader, s: schema.batchBioAssetState })
      .from(schema.batchHeader)
      .innerJoin(schema.batchBioAssetState, eq(schema.batchBioAssetState.batch_id, schema.batchHeader.batch_id))
      .where(and(eq(schema.batchHeader.tenant_id, tenantId), eq(schema.batchHeader.status, 'ACTIVE'), eq(schema.batchHeader.is_litter_lot, true), sql`${schema.batchBioAssetState.current_quantity} >= 5`))
      .orderBy(asc(schema.batchHeader.start_date), asc(schema.batchHeader.batch_no));
    if (lots.length < 4) throw new Error('23-bbp-alignment-demo: four weaner lots with at least 5 head are needed.');

    // 4. The September run, then feed on two lots in October (to WIP), then the October run. In date order: the lot run values a lot against its
    //    carrying value as it stands when the run is made, so a month must be run before later-dated postings reach the lot.
    const runs = ctx.app.get(LotFairValueService);
    const runMonth = async (period: string) => {
      const r = await runs.post({ period_key: period }, tenantId, actor);
      const posted = r.lines.filter((l) => l.posted).length;
      const wip = r.lines.filter((l) => l.wip_recognised).reduce((n, l) => n + l.wip_balance, 0);
      ctx.log(`  Lot run ${period}: ${posted} lots revalued, ${wip.toFixed(2)} of WIP recognised, ${r.lines.length - posted} not revalued`);
    };
    await runMonth('2026-09');
    const [feed] = await db.select().from(schema.itemMaster).where(and(eq(schema.itemMaster.tenant_id, tenantId), like(schema.itemMaster.item_name, '%Grower%'), eq(schema.itemMaster.is_biological_asset, false))).limit(1);
    const batches = ctx.app.get(BatchService);
    for (const lot of lots.slice(0, 2)) {
      const [done] = await db.select({ id: schema.batchTransaction.transaction_id }).from(schema.batchTransaction)
        .where(and(eq(schema.batchTransaction.batch_id, lot.b.batch_id), eq(schema.batchTransaction.remarks, TAG))).limit(1);
      if (done || !feed) continue;
      await batches.addTransaction(lot.b.batch_id, { transaction_date: FEED_DATE, transaction_type: 'CONSUMPTION', item_id: feed.item_id, quantity: 20, uom: feed.uom_primary ?? 'KG', remarks: TAG } as any, tenantId, actor);
      ctx.log(`  Feed: 20 ${feed.uom_primary ?? 'KG'} of ${feed.item_name} on ${lot.b.batch_no}, ${FEED_DATE} (to WIP Weaners)`);
    }
    await runMonth('2026-10');

    // 5. Two slaughter Transfer Orders on the farm of the lots.
    const tos = ctx.app.get(SlaughterTransferService);
    const farmId = lots[0].b.farm_id!;
    const sameFarm = lots.filter((l) => l.b.farm_id === farmId);
    const existingTo = async (ref: string) => (await db.select().from(schema.slaughterTransferOrder).where(and(eq(schema.slaughterTransferOrder.tenant_id, tenantId), eq(schema.slaughterTransferOrder.ho_approval_ref, ref))).limit(1))[0];

    let to1: any = await existingTo(`${TAG}-1`);
    if (!to1) {
      to1 = await tos.create({ to_date: TO_DATE, farm_id: farmId, ho_approval_ref: `${TAG}-1`, destination: 'Abattoir (demo)', vehicle_no: 'DEMO-01', driver_name: 'Demo driver',
        lines: [{ batch_id: sameFarm[2].b.batch_id, head_count: 3, avg_live_weight_kg: 108 }, { batch_id: sameFarm[3].b.batch_id, head_count: 2, avg_live_weight_kg: 104 }] } as any, tenantId, actor);
      ctx.log(`  ${to1.to_no}: drafted (3 head from ${sameFarm[2].b.batch_no}, 2 from ${sameFarm[3].b.batch_no})`);
    }
    to1 = await tos.findOne(to1.to_id, tenantId);
    if (to1.status === 'DRAFT') to1 = await tos.confirm(to1.to_id, tenantId, actor);
    if (to1.status === 'CONFIRMED') to1 = await tos.pod(to1.to_id, { pod_date: TO_DATE, received_by: 'Abattoir (demo)', lines: to1.lines.map((l: any, i: number) => ({ line_id: l.line_id, doa_head: i === 0 ? 1 : 0 })) } as any, tenantId, actor);
    if (to1.status === 'RECEIVED') {
      to1 = await tos.killSheet(to1.to_id, { kill_sheet_ref: `${TAG}-KS-1`, kill_sheet_date: TO_DATE, invoice_no: `${TAG}-INV-1`,
        lines: to1.lines.map((l: any, i: number) => ({ line_id: l.line_id, avg_carcass_weight_kg: i === 0 ? 82 : 85, price_per_kg: 2.6 })) } as any, tenantId, actor);
    }
    if (to1.status === 'RECONCILED') to1 = await tos.close(to1.to_id, tenantId, actor);
    ctx.log(`  ${to1.to_no}: ${to1.status}, invoice ${Number(to1.invoice_amount ?? 0).toFixed(2)}`);

    let to2: any = await existingTo(`${TAG}-2`);
    if (!to2 && sameFarm[4]) {
      to2 = await tos.create({ to_date: TO_DATE, farm_id: farmId, ho_approval_ref: `${TAG}-2`, destination: 'Abattoir (demo)', lines: [{ batch_id: sameFarm[4].b.batch_id, head_count: 4, avg_live_weight_kg: 106 }] } as any, tenantId, actor);
    }
    if (to2) {
      to2 = await tos.findOne(to2.to_id, tenantId);
      if (to2.status === 'DRAFT') to2 = await tos.confirm(to2.to_id, tenantId, actor);
      ctx.log(`  ${to2.to_no}: ${to2.status} (4 head in transit)`);
    }
  },
};
