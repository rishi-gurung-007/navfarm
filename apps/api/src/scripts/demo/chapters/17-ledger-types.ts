/**
 * Chapter `17-ledger-types` — one posting of every kind the two ledgers can hold, so each Entry Type / Transaction Type pair can be read back
 * from MySQL and checked (`pnpm nx run api:db-verify-ledger-types`). Additive: it adds its own records (every one marked LT- in its remarks or
 * code) on top of whatever the tenant already holds, and each step looks for what it already did, so it can be run again.
 *
 *   Inventory Ledger   stock adjustment (+ and -)                  VARIANCE_POSITIVE, VARIANCE_NEGATIVE
 *                      stock transfer, shipped and received        TRANSFER_SHIPMENT, TRANSFER_RECEIPT as TRANSFER, and a DOA write-off
 *                      stock transfer posted in one step           TRANSFER_SHIPMENT, TRANSFER_RECEIPT as NEGATIVE / POSITIVE
 *                      a bio-asset batch's feed, premature + mature CONSUMPTION (GL rule BIO_CONSUMPTION_PREMATURE / _MATURE)
 *                      a harvest, and an output on a mature batch   OUTPUT (GL rule BIO_HARVEST / BIO_OUTPUT)
 *                      a daily observation                          DESCRIPTIVE
 *   Bio Asset Ledger   a bought batch, its feed, maturity, amortisation, fair value gain and loss, a harvest and a sale,
 *                      two registered animals (one sold, one slaughtered), and a manual entry.
 *
 * Not seeded, and why (the verify script lists them): SALES in the Inventory Ledger (nothing writes it yet), OVERHEAD in it (no scheduler
 * line of type OVERHEAD is configured), a costing run's fair-value rows (needs a FAIR_VALUE costing profile), and the lactation cost
 * (it is posted when a litter is weaned — wean the pending litter on the Breeding screen).
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=17-ledger-types
 */
import { and, eq, like, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { BatchService } from '../../../modules/production/batch/batch.service';
import { BatchDailyDataService } from '../../../modules/production/batch-daily-data/batch-daily-data.service';
import { StockAdjustmentService } from '../../../modules/inventory/stock-adjustment/stock-adjustment.service';
import { StockTransferService } from '../../../modules/inventory/stock-transfer/stock-transfer.service';
import { AnimalService } from '../../../modules/piggery/animal/animal.service';
import { CustomerService } from '../../../modules/master-data/customer/customer.service';
import { BioAssetLedgerService } from '../../../modules/inventory/bio-asset-ledger/bio-asset-ledger.service';
import type { DemoChapter, DemoContext } from '../chapter';
import { createItemLookup } from '../batch-helpers';

const TOKEN = 'LT-';
const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

type Db = MySql2Database<typeof schema>;

export const ledgerTypesChapter: DemoChapter = {
  name: '17-ledger-types',

  async run(ctx: DemoContext): Promise<void> {
    const cls = ctx.app.get(ClsService);
    const db = cls.get<Db>('tenantDb');
    if (!db) throw new Error('17-ledger-types: tenantDb is not set — run through the harness.');
    const batches = ctx.app.get(BatchService);
    const dailyData = ctx.app.get(BatchDailyDataService);
    const adjustments = ctx.app.get(StockAdjustmentService);
    const transfers = ctx.app.get(StockTransferService);
    const animals = ctx.app.get(AnimalService);
    const customers = ctx.app.get(CustomerService);
    const bioLedger = ctx.app.get(BioAssetLedgerService);
    const item = createItemLookup(db, ctx.companyId);

    const failures: string[] = [];
    /** Runs one step; a step that fails is reported and the chapter goes on, so one missing precondition does not hide the rest. */
    const step = async (label: string, work: () => Promise<string | void>) => {
      try {
        const note = await work();
        ctx.log(`  ✔ ${label}${note ? ` — ${note}` : ''}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${label}: ${message}`);
        ctx.log(`  ✘ ${label} — ${message}`);
      }
    };

    const storeOf = async (code: string) => {
      const [row] = await db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(eq(schema.locationMaster.location_code, code)).limit(1);
      if (!row) throw new Error(`location '${code}' not found`);
      return row.id;
    };
    const remarksOf = (what: string) => `${TOKEN}${what}`;

    // ───────────────────────── Inventory Ledger: adjustments and transfers ─────────────────────────
    const penicillin = await item('Penicillin G Procaine 300K IU 100ml');
    const mulStore = await storeOf('MUL100/STORE-001');
    const porStore = await storeOf('POR100/STORE-001');

    await step('Stock adjustment: +2 and -1 vials (VARIANCE_POSITIVE, VARIANCE_NEGATIVE)', async (): Promise<string | void> => {
      const [done] = await db.select({ id: schema.stockAdjustment.adjustment_id }).from(schema.stockAdjustment).where(eq(schema.stockAdjustment.remarks, remarksOf('ADJUSTMENT'))).limit(1);
      if (done) return 'already posted';
      const created: any = await adjustments.create(
        {
          company_id: ctx.companyId, warehouse_id: mulStore, posting_date: today(), reason: 'COUNT_CORRECTION', remarks: remarksOf('ADJUSTMENT'),
          lines: [
            { item_id: penicillin.item_id, quantity: 2, uom: 'VIAL', rate: 12 },
            { item_id: penicillin.item_id, quantity: -1, uom: 'VIAL' },
          ],
        } as any,
        ctx.tenantId,
        ctx.actor,
      );
      await adjustments.post(created.adjustment_id, ctx.tenantId, ctx.actor);
      return created.adjustment_no;
    });

    const transferToPor = async (kind: 'STEPS' | 'ONE-STEP', quantity: number, doa = 0) => {
      const token = remarksOf(`TRANSFER ${kind}`);
      const [done] = await db.select({ id: schema.stockTransfer.transfer_id, no: schema.stockTransfer.transfer_no, status: schema.stockTransfer.status }).from(schema.stockTransfer).where(like(schema.stockTransfer.remarks, `${token}%`)).limit(1); // shipping appends the vehicle details to the remarks
      if (done) return `${done.no} already ${done.status}`;
      const created: any = await transfers.create(
        { company_id: ctx.companyId, from_warehouse_id: mulStore, to_warehouse_id: porStore, posting_date: daysAgo(1), remarks: token,
          lines: [{ item_id: penicillin.item_id, quantity, uom: 'VIAL', remarks: token }] },
        ctx.tenantId,
        ctx.actor,
      );
      if (kind === 'ONE-STEP') {
        await transfers.post(created.transfer_id, ctx.tenantId, ctx.actor);
        return `${created.transfer_no} posted in one step`;
      }
      await transfers.ship(created.transfer_id, { posting_date: daysAgo(1), vehicle_no: 'LT-TRK', driver_name: 'LT driver', waybill_ref: 'LT-WB', remarks: token } as any, ctx.tenantId, ctx.actor);
      const detail: any = await transfers.findOne(created.transfer_id);
      const lines = (detail.lines ?? []).map((l: any) => ({
        line_id: l.line_id, received_quantity: quantity - doa, ...(doa ? { doa_quantity: doa, doa_remarks: 'Damaged in transit (LT)' } : {}),
      }));
      await transfers.receive(created.transfer_id, { posting_date: today(), remarks: token, lines } as any, ctx.tenantId, ctx.actor);
      return `${created.transfer_no} shipped and received (${quantity - doa} good, ${doa} DOA)`;
    };
    await step('Stock transfer shipped and received, 1 vial DOA (TRANSFER, VARIANCE_NEGATIVE)', () => transferToPor('STEPS', 6, 1));
    await step('Stock transfer posted in one step (NEGATIVE / POSITIVE legs)', () => transferToPor('ONE-STEP', 3));

    // ───────────────────────── Bio-asset batch: the whole life ─────────────────────────
    const [template] = await db
      .select()
      .from(schema.batchHeader)
      .where(and(eq(schema.batchHeader.costing_method, 'BIO_ASSET'), eq(schema.batchHeader.tracking_mode, 'BATCH_WISE'), eq(schema.batchHeader.status, 'ACTIVE'), eq(schema.batchHeader.is_litter_lot, false), sql`${schema.batchHeader.remarks} NOT LIKE ${TOKEN + '%'}`))
      .limit(1);
    const piglet = await item('Weaned Feeder Piglet (7-10kg)');
    const feed = await item('Weaner Grower Mash (18% CP)');
    const carcass = await item('Dressed Pork Carcass (Wholesale Cut)');

    const lifeBatch = async () => {
      const [existing] = await db.select().from(schema.batchHeader).where(eq(schema.batchHeader.remarks, remarksOf('BATCH-A'))).limit(1);
      return existing;
    };
    let batchId = '';
    await step('Bio-asset batch bought and activated: 20 head at 150 (batch receipt PURCHASE)', async (): Promise<string | void> => {
      const existing = await lifeBatch();
      if (existing) { batchId = existing.batch_id; return `${existing.batch_no} already exists`; }
      if (!template) throw new Error('no ACTIVE batch-wise bio-asset batch to copy the placement from');
      const created: any = await batches.create(
        {
          company_id: template.company_id, lob_id: template.lob_id, costing_method: 'BIO_ASSET', tracking_mode: 'BATCH_WISE', breed_id: template.breed_id ?? undefined,
          stage_id: template.stage_id ?? undefined, shed_id: template.shed_id ?? undefined, location_id: template.location_id ?? undefined,
          operational_area_id: template.operational_area_id ?? undefined, start_date: daysAgo(3), uom: 'HEAD', opening_quantity: 20,
          input_lines: [{ item_id: piglet.item_id, quantity: 20, uom: 'HEAD', rate: 150 }], remarks: remarksOf('BATCH-A'),
        } as any,
        ctx.tenantId,
        ctx.actor,
      );
      await batches.activate(created.batch_id, ctx.tenantId, ctx.actor);
      batchId = created.batch_id;
      return created.batch_no;
    });

    const bioStage = async () => {
      const [state] = await db.select().from(schema.batchBioAssetState).where(eq(schema.batchBioAssetState.batch_id, batchId)).limit(1);
      return state;
    };
    const feedRows = async (gl: string) => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.batch_no, (await lifeBatch())?.batch_no ?? ''), eq(schema.inventoryLedger.gl_mapping_type, gl)));
      return Number(row?.n ?? 0);
    };
    const feedBatch = async (quantity: number, when: string) =>
      batches.addTransaction(batchId, { transaction_date: when, transaction_type: 'CONSUMPTION', item_id: feed.item_id, quantity, uom: 'KG' } as any, ctx.tenantId, ctx.actor);

    await step('Feed while premature: 5 kg capitalised (CONSUMPTION, GL BIO_CONSUMPTION_PREMATURE)', async (): Promise<string | void> => {
      if (await feedRows('BIO_CONSUMPTION_PREMATURE')) return 'already posted';
      await feedBatch(5, daysAgo(2));
    });
    await step('Matured: 12-month life, residual 40 a head (maturity marker DESCRIPTIVE)', async (): Promise<string | void> => {
      if ((await bioStage())?.stage === 'MATURE') return 'already mature';
      await batches.matureBioAsset(batchId, { residual_value_per_unit: 40, productive_life_months: 12 } as any, ctx.tenantId, ctx.actor);
    });
    await step('Feed once mature: 3 kg expensed (CONSUMPTION, GL BIO_CONSUMPTION_MATURE)', async (): Promise<string | void> => {
      if (await feedRows('BIO_CONSUMPTION_MATURE')) return 'already posted';
      await feedBatch(3, today());
    });
    await step('Amortisation for the month (batch amortisation, VARIANCE_NEGATIVE)', async (): Promise<string | void> => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.batch_id, batchId), eq(schema.bioAssetLedger.document_type, 'BATCH_AMORTIZATION')));
      if (Number(row?.n)) return 'already run';
      await batches.amortizeBioAsset(batchId, { posting_date: today() } as any, ctx.tenantId, ctx.actor);
    });
    await step('Fair value up, then down (VARIANCE_POSITIVE, VARIANCE_NEGATIVE)', async (): Promise<string | void> => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.batch_id, batchId), eq(schema.bioAssetLedger.document_type, 'BATCH_FAIR_VALUE')));
      if (Number(row?.n)) return 'already recorded';
      await batches.recordFairValue(batchId, { posting_date: today(), fair_value_per_unit: 400 } as any, ctx.tenantId, ctx.actor);
      await batches.recordFairValue(batchId, { posting_date: today(), fair_value_per_unit: 300 } as any, ctx.tenantId, ctx.actor);
    });
    await step('Harvest 3 head into the store as 225 kg of dressed pork (OUTPUT, GL BIO_HARVEST)', async (): Promise<string | void> => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.inventoryLedger).where(and(eq(schema.inventoryLedger.gl_mapping_type, 'BIO_HARVEST'), eq(schema.inventoryLedger.batch_no, (await lifeBatch())?.batch_no ?? '')));
      if (Number(row?.n)) return 'already harvested';
      await batches.disposeBioAsset(batchId, { disposal_type: 'HARVEST', quantity: 3, posting_date: today(), output_item_id: carcass.item_id, output_uom: 'KG', output_quantity: 225, warehouse_id: mulStore } as any, ctx.tenantId, ctx.actor);
    });

    // A customer to sell to: the dev tenant has none.
    let customerId = '';
    await step('Customer LT-CUSTOMER for the sales', async (): Promise<string | void> => {
      const [existing] = await db.select({ id: schema.customerMaster.customer_id }).from(schema.customerMaster).where(like(schema.customerMaster.customer_name, `${TOKEN}%`)).limit(1);
      if (existing) { customerId = existing.id; return 'already exists'; }
      const created: any = await customers.create({ company_id: ctx.companyId, customer_name: 'LT-CUSTOMER (ledger type check)', mobile: '9000000001' } as any, ctx.tenantId, ctx.actor);
      customerId = created.customer_id;
    });
    await step('Sale of 4 head at 260 each (SALES)', async (): Promise<string | void> => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.batch_id, batchId), eq(schema.bioAssetLedger.transaction_type, 'SALES')));
      if (Number(row?.n)) return 'already sold';
      await batches.disposeBioAsset(batchId, { disposal_type: 'SOLD', quantity: 4, posting_date: today(), sale_proceeds: 1040, customer_id: customerId } as any, ctx.tenantId, ctx.actor);
    });

    await step('Output recorded on the mature batch: 2 head as 2 kg of dressed pork (OUTPUT, GL BIO_OUTPUT; harvest row in the Bio Asset Ledger)', async (): Promise<string | void> => {
      const [row] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.inventoryLedger)
        .where(and(eq(schema.inventoryLedger.gl_mapping_type, 'BIO_OUTPUT'), eq(schema.inventoryLedger.batch_no, (await lifeBatch())?.batch_no ?? '')));
      if (Number(row?.n)) return 'already recorded';
      await batches.addTransaction(batchId, { transaction_date: today(), transaction_type: 'OUTPUT', item_id: carcass.item_id, quantity: 2, uom: 'KG', rate: 6 } as any, ctx.tenantId, ctx.actor);
    });

    await step('A daily observation (DESCRIPTIVE)', async (): Promise<string | void> => {
      const [done] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.inventoryLedger).where(and(eq(schema.inventoryLedger.entry_type, 'DESCRIPTIVE'), eq(schema.inventoryLedger.batch_no, (await lifeBatch())?.batch_no ?? '')));
      if (Number(done?.n)) return 'already posted';
      await batches.generateSchedulerForBatch(batchId, ctx.tenantId, ctx.actor);
      const [line] = await db
        .select({ line_id: schema.schedulerLine.line_id, name: schema.schedulerLine.activity_name })
        .from(schema.schedulerLine)
        .innerJoin(schema.schedulerHeader, eq(schema.schedulerHeader.scheduler_id, schema.schedulerLine.scheduler_id))
        .where(and(eq(schema.schedulerHeader.batch_id, batchId), eq(schema.schedulerLine.line_type, 'DESCRIPTIVE')))
        .limit(1);
      if (!line) throw new Error('the batch has no DESCRIPTIVE scheduler line to post against');
      await dailyData.postEntry(batchId, { line_id: line.line_id, entry_date: (await lifeBatch())!.start_date as any, entered_value: 12.5 } as any, ctx.tenantId, ctx.actor);
      return line.name;
    });

    // ───────────────────────── Registered animals: registration, sale, slaughter ─────────────────────────
    await step('Two animals registered; one sold, one slaughtered (registration, SALES, CONSUMPTION)', async (): Promise<string | void> => {
      const [done] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.animalRegister).where(like(schema.animalRegister.rfid_tag, `${TOKEN}%`));
      if (Number(done?.n) >= 2) return 'already registered';
      const [sample] = await db.select().from(schema.animalRegister).where(and(eq(schema.animalRegister.entry_type, 'PURCHASED_LOCAL'), eq(schema.animalRegister.gender, 'F'))).limit(1);
      if (!sample) throw new Error('no PURCHASED_LOCAL female animal to copy the placement from');
      const make = (n: number) => animals.create(
        {
          company_id: sample.company_id, nob_id: sample.nob_id ?? undefined, lob_id: sample.lob_id ?? undefined, animal_type: sample.animal_type, breed_id: sample.breed_id,
          gender: 'F', dob: daysAgo(300), entry_type: 'PURCHASED_LOCAL', entry_date: daysAgo(2), item_id: sample.item_id, rfid_tag: `${TOKEN}ANIMAL-${n}`,
          acquisition_cost: 900, current_stage_id: sample.current_stage_id, current_location_id: sample.current_location_id ?? undefined, no_of_teats: 16,
        } as any,
        ctx.tenantId,
        ctx.actor,
      ) as Promise<any>;
      const [a, b] = [await make(1), await make(2)];
      await animals.dispose(a.animal_id, { disposal_type: 'SOLD', disposal_date: today(), disposal_value: 1300, customer_id: customerId } as any, ctx.tenantId, ctx.actor);
      await animals.dispose(b.animal_id, { disposal_type: 'SLAUGHTERED', disposal_date: today(), exit_weight_kg: 110 } as any, ctx.tenantId, ctx.actor);
      return `${a.animal_code} sold, ${b.animal_code} slaughtered`;
    });

    await step('Manual Bio Asset Ledger entries (MANUAL_ENTRY)', async (): Promise<string | void> => {
      const [done] = await db.select({ n: sql<number>`COUNT(*)` }).from(schema.bioAssetLedger).where(and(eq(schema.bioAssetLedger.document_type, 'MANUAL_ENTRY'), like(schema.bioAssetLedger.document_no, `${TOKEN}%`)));
      if (Number(done?.n)) return 'already recorded';
      const base = { company_id: ctx.companyId, bio_asset_item_id: piglet.item_id, posting_date: today(), quantity: 0, costing_method: 'COST_ACCUMULATION' };
      await bioLedger.create({ ...base, entry_type: 'POSITIVE', transaction_type: 'VARIANCE_POSITIVE', document_no: `${TOKEN}MANUAL-1`, cost_amount: 25 } as any, ctx.tenantId, ctx.actor);
      await bioLedger.create({ ...base, entry_type: 'NEGATIVE', transaction_type: 'VARIANCE_NEGATIVE', document_no: `${TOKEN}MANUAL-2`, cost_amount: -10 } as any, ctx.tenantId, ctx.actor);
    });

    if (failures.length) throw new Error(`17-ledger-types: ${failures.length} step(s) failed:\n  - ${failures.join('\n  - ')}`);
  },
};
