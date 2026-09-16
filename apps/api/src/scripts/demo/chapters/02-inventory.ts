/**
 * Chapter `02-inventory` — Phase 3 Task 4. Per farm, every document is
 * created and posted through the application's own services (Ruling 1 — no
 * raw inserts for anything the app would post):
 *
 *   - a goods receipt of gestation feed and grower feed into the farm's two
 *     feed silos, and of two medicines and one vaccine into the farm's
 *     Demo Medicine Store (Task 3 chapter);
 *   - one goods issue of a medicine from the Demo Medicine Store;
 *   - one stock transfer between the farm's two silos;
 *   - one positive and one negative stock adjustment with reason text
 *     carrying DEMO.
 *
 * Rates come from `item_master.standard_cost` (plan Task 4) — the chapter
 * reads them, never invents them. Quantities are demo facts from
 * DEMO_OPERATIONS. Every document's remarks/reason carries DEMO.
 *
 * Resume semantics, not skip-on-existence: each document is located by its
 * DEMO reference (external_reference_no on receipts; remarks/reason token on
 * issue/transfer/adjustment, which have no reference column), then
 *   absent  -> create (+post),
 *   DRAFT   -> post (an interrupted earlier run left it unposted),
 *   POSTED  -> skip.
 * A crash between create and post therefore heals on the next run instead of
 * wedging the demo (a DRAFT store receipt once starved the issue of stock —
 * FIFO refused it, which is the engine working, but the run could never
 * complete).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import { GoodsIssueService } from '../../../modules/inventory/goods-issue/goods-issue.service';
import { StockTransferService } from '../../../modules/inventory/stock-transfer/stock-transfer.service';
import { StockAdjustmentService } from '../../../modules/inventory/stock-adjustment/stock-adjustment.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';

/** Medicine/vaccine items (company-scoped codes from the Triple C template). */
const MED_ANTIBIOTIC_1 = 'MEDICINE-VETERINARY_MEDICINES_ANTIBIOTICS-ANTIBIOTIC-ITM-0001'; // Penicillin G
const MED_ANTIBIOTIC_2 = 'MEDICINE-VETERINARY_MEDICINES_ANTIBIOTICS-ANTIBIOTIC-ITM-0002'; // Tylosin
const VACCINE_BREEDING = 'VACCINE-SWINE_IMMUNIZATION_VACCINES-BREEDING-ITM-0001'; // Parvo-Shield L5
/** Feed items receipted into silos. */
const FEED_GESTATION = 'FEED-FINISHED_SWINE_FEEDS_DIETS-GESTATION-ITM-0001';
const FEED_GROWER = 'FEED-FINISHED_SWINE_FEEDS_DIETS-GROWER-ITM-0001';

/** The demo quantities — labelled demo facts, not client data. */
const DEMO_OPERATIONS = {
  feedReceipt: { gestationKgPerSilo: 2000, growerKgPerSilo: 1500 },
  storeReceipt: [
    { item_code: MED_ANTIBIOTIC_1, quantity: 20, uom: 'PCS' },
    { item_code: MED_ANTIBIOTIC_2, quantity: 15, uom: 'PCS' },
    { item_code: VACCINE_BREEDING, quantity: 10, uom: 'PCS' },
  ],
  medicineIssue: { item_code: MED_ANTIBIOTIC_1, quantity: 4, uom: 'PCS' },
  siloTransferKg: 300,
  adjustments: {
    positive: { item_code: MED_ANTIBIOTIC_2, quantity: 2, uom: 'PCS' },
    negative: { item_code: MED_ANTIBIOTIC_1, quantity: -1, uom: 'PCS' },
  },
} as const;

/** Grasmere's two feed silos (grower houses), from location_master. */
const GRASMERE_SILO_CODES = ['MUGR1', 'MUGR2'];
/** Kintyre's two feed silos (weaner houses), from location_master. */
const KINTYRE_SILO_CODES = ['PWH01', 'PWH02'];

const TODAY = () => new Date().toISOString().slice(0, 10);

async function itemByCode(db: MySql2Database<typeof schema>, code: string) {
  // Company-scoped row when present (company wins for an operational caller),
  // else the tenant row.
  const [row] = await db
    .select({ item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, standard_cost: schema.itemMaster.standard_cost })
    .from(schema.itemMaster)
    .where(and(eq(schema.itemMaster.item_code, code), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
    .orderBy(schema.itemMaster.company_id)
    .limit(1);
  if (!row) throw new Error(`02-inventory: item '${code}' not found — the master stages must load it before this chapter.`);
  return row;
}

export const inventoryChapter: DemoChapter = {
  name: '02-inventory',

  async run(ctx: DemoContext) {
    const receipts = ctx.app.get(GoodsReceiptService);
    const issues = ctx.app.get(GoodsIssueService);
    const transfers = ctx.app.get(StockTransferService);
    const adjustments = ctx.app.get(StockAdjustmentService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('02-inventory: tenantDb is not set — run through the harness.');

    const postingDate = TODAY();

    for (const [farmKey, farmId] of [
      ['grasmere', ctx.farms.grasmere],
      ['kintyre', ctx.farms.kintyre],
    ] as const) {
      const [farm] = await db
        .select({ location_code: schema.locationMaster.location_code })
        .from(schema.locationMaster)
        .where(eq(schema.locationMaster.location_id, farmId))
        .limit(1);

      // The farm's Demo Medicine Store (created by 01-stores-and-items) and
      // its two feed silos.
      const [store] = await db
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.parent_location_id, farmId),
          eq(schema.locationMaster.location_name, 'Demo Medicine Store'),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (!store) throw new Error(`02-inventory: no Demo Medicine Store under ${farm.location_code} — run chapter 01-stores-and-items first.`);

      const siloCodes = farmKey === 'grasmere' ? GRASMERE_SILO_CODES : KINTYRE_SILO_CODES;
      const farmChildren = await db
        .select({ location_id: schema.locationMaster.location_id, location_code: schema.locationMaster.location_code })
        .from(schema.locationMaster)
        .where(and(eq(schema.locationMaster.parent_location_id, farmId), isNull(schema.locationMaster.deleted_at)));
      const siloByCode = new Map(farmChildren.map((s) => [s.location_code, s.location_id]));
      const siloIds = siloCodes.map((code) => {
        const id = siloByCode.get(code);
        if (!id) throw new Error(`02-inventory: silo '${code}' not found under ${farm.location_code}.`);
        return { code, id };
      });

      const ref = (doc: string) => `DEMO-${farm.location_code}-${doc}`;
      const tag = `  ${farm.location_code}:`;

      // --- 1. Feed receipts into the two silos (one document per silo).
      {
        const existing = await db
          .select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
          .from(schema.goodsReceipt)
          .where(eq(schema.goodsReceipt.external_reference_no, ref('SILORCP')));
        if (existing.length === 0) {
          const gest = await itemByCode(db, FEED_GESTATION);
          const grow = await itemByCode(db, FEED_GROWER);
          for (const silo of siloIds) {
            await receipts.create(
              {
                company_id: ctx.companyId,
                warehouse_id: silo.id,
                posting_date: postingDate,
                external_reference_no: ref('SILORCP'),
                remarks: `DEMO feed receipt into silo ${silo.code}`,
                lines: [
                  { item_id: gest.item_id, quantity: DEMO_OPERATIONS.feedReceipt.gestationKgPerSilo, uom: 'KG', rate: gest.standard_cost ?? undefined, lot_no: `DEMO-GEST-${silo.code}` },
                  { item_id: grow.item_id, quantity: DEMO_OPERATIONS.feedReceipt.growerKgPerSilo, uom: 'KG', rate: grow.standard_cost ?? undefined, lot_no: `DEMO-GROW-${silo.code}` },
                ],
              },
              ctx.tenantId,
            );
            ctx.log(`${tag} feed receipt into ${silo.code} created`);
          }
        }
        for (const doc of existing.length > 0 ? existing : await db
          .select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
          .from(schema.goodsReceipt)
          .where(eq(schema.goodsReceipt.external_reference_no, ref('SILORCP')))) {
          if (doc.status === 'DRAFT') {
            await receipts.post(doc.id, ctx.tenantId);
            ctx.log(`${tag} feed receipt ${doc.id} posted`);
          }
        }
      }

      // --- 2. Store receipt: two medicines + one vaccine into the store.
      {
        const [existing] = await db
          .select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
          .from(schema.goodsReceipt)
          .where(eq(schema.goodsReceipt.external_reference_no, ref('STORERCP')))
          .limit(1);
        if (!existing) {
          const storeLines = [];
          for (const line of DEMO_OPERATIONS.storeReceipt) {
            const item = await itemByCode(db, line.item_code);
            storeLines.push({ item_id: item.item_id, quantity: line.quantity, uom: line.uom, rate: item.standard_cost ?? undefined, lot_no: `DEMO-${line.item_code.split('-').pop()}` });
          }
          const created = await receipts.create(
            {
              company_id: ctx.companyId,
              warehouse_id: store.location_id,
              posting_date: postingDate,
              external_reference_no: ref('STORERCP'),
              remarks: 'DEMO medicine and vaccine receipt into Demo Medicine Store',
              lines: storeLines,
            },
            ctx.tenantId,
          );
          await receipts.post(created.receipt_id, ctx.tenantId);
          ctx.log(`${tag} store receipt posted`);
        } else if (existing.status === 'DRAFT') {
          await receipts.post(existing.id, ctx.tenantId);
          ctx.log(`${tag} store receipt posted`);
        } else {
          ctx.log(`${tag} store receipt already posted — skipped`);
        }
      }

      // --- 3. Goods issue of one medicine from the store.
      {
        const [existing] = await db
          .select({ id: schema.goodsIssue.issue_id, status: schema.goodsIssue.status })
          .from(schema.goodsIssue)
          .where(eq(schema.goodsIssue.remarks, ref('ISSUE')))
          .limit(1);
        if (!existing) {
          const med = await itemByCode(db, DEMO_OPERATIONS.medicineIssue.item_code);
          const created = await issues.create(
            {
              company_id: ctx.companyId,
              warehouse_id: store.location_id,
              posting_date: postingDate,
              remarks: ref('ISSUE'),
              lines: [{ item_id: med.item_id, quantity: DEMO_OPERATIONS.medicineIssue.quantity, uom: DEMO_OPERATIONS.medicineIssue.uom, remarks: 'DEMO medicine issue for routine sow treatment' }],
            },
            ctx.tenantId,
          );
          await issues.post(created.issue_id, ctx.tenantId);
          ctx.log(`${tag} medicine issue posted`);
        } else if (existing.status === 'DRAFT') {
          await issues.post(existing.id, ctx.tenantId);
          ctx.log(`${tag} medicine issue posted`);
        } else {
          ctx.log(`${tag} medicine issue already posted — skipped`);
        }
      }

      // --- 4. Stock transfer between the farm's two silos.
      {
        const [existing] = await db
          .select({ id: schema.stockTransfer.transfer_id, status: schema.stockTransfer.status })
          .from(schema.stockTransfer)
          .where(eq(schema.stockTransfer.remarks, ref('XSILO')))
          .limit(1);
        if (!existing) {
          const feed = await itemByCode(db, FEED_GESTATION);
          const created = await transfers.create(
            {
              company_id: ctx.companyId,
              from_warehouse_id: siloIds[0].id,
              to_warehouse_id: siloIds[1].id,
              posting_date: postingDate,
              remarks: ref('XSILO'),
              lines: [{ item_id: feed.item_id, quantity: DEMO_OPERATIONS.siloTransferKg, uom: 'KG', remarks: 'DEMO stock transfer between feed silos' }],
            },
            ctx.tenantId,
          );
          await transfers.post(created.transfer_id, ctx.tenantId);
          ctx.log(`${tag} silo transfer posted`);
        } else if (existing.status === 'DRAFT') {
          await transfers.post(existing.id, ctx.tenantId);
          ctx.log(`${tag} silo transfer posted`);
        } else {
          ctx.log(`${tag} silo transfer already posted — skipped`);
        }
      }

      // --- 5. One positive and one negative adjustment, DEMO reason.
      {
        const [existing] = await db
          .select({ id: schema.stockAdjustment.adjustment_id, status: schema.stockAdjustment.status })
          .from(schema.stockAdjustment)
          .where(eq(schema.stockAdjustment.reason, ref('ADJ')))
          .limit(1);
        if (!existing) {
          const posItem = await itemByCode(db, DEMO_OPERATIONS.adjustments.positive.item_code);
          const negItem = await itemByCode(db, DEMO_OPERATIONS.adjustments.negative.item_code);
          const created = await adjustments.create(
            {
              company_id: ctx.companyId,
              warehouse_id: store.location_id,
              posting_date: postingDate,
              reason: ref('ADJ'),
              remarks: 'DEMO positive (found stock) and negative (damaged) adjustment',
              lines: [
                { item_id: posItem.item_id, quantity: DEMO_OPERATIONS.adjustments.positive.quantity, uom: DEMO_OPERATIONS.adjustments.positive.uom, rate: posItem.standard_cost ?? undefined, remarks: 'DEMO found stock' },
                { item_id: negItem.item_id, quantity: DEMO_OPERATIONS.adjustments.negative.quantity, uom: DEMO_OPERATIONS.adjustments.negative.uom, remarks: 'DEMO damaged vial' },
              ],
            },
            ctx.tenantId,
          );
          await adjustments.post(created.adjustment_id, ctx.tenantId);
          ctx.log(`${tag} adjustments posted`);
        } else if (existing.status === 'DRAFT') {
          await adjustments.post(existing.id, ctx.tenantId);
          ctx.log(`${tag} adjustments posted`);
        } else {
          ctx.log(`${tag} adjustments already posted — skipped`);
        }
      }
    }
  },
};
