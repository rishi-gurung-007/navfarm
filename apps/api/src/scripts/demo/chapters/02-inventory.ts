/**
 * Chapter `02-inventory` — Phase 3 Task 4. Per farm — all nine, not two —
 * every document is created and posted through the application's own services
 * (Ruling 1 — no raw inserts for anything the app would post):
 *
 *   - a goods receipt of feed into each of the farm's first two silos, the
 *     diet chosen from the silo's own shed role (a farrowing house takes
 *     lactation feed, a finisher house finisher feed, and so on), and of two
 *     medicines and one vaccine into the farm's Demo Medicine Store;
 *   - one goods issue of a medicine from the Demo Medicine Store;
 *   - one stock transfer between the farm's first two silos;
 *   - one positive and one negative stock adjustment with reason text
 *     carrying DEMO.
 *
 * Rates come from `item_master.standard_cost` (plan Task 4) — the chapter
 * reads them, never invents them. Quantities are demo facts from
 * DEMO_OPERATIONS. Every document's remarks/reason carries DEMO.
 *
 * Silos are resolved from the farm's seeded sheds (`<CODE>/SHED-00n/SILO-001`),
 * not from hard-coded location codes; every seeded farm has at least two,
 * including the AI station and the grow-out site.
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
import type { GoodsReceiptLineInput } from '../../../modules/inventory/goods-receipt/dto/goods-receipt.dto';
import type { DemoChapter, DemoContext } from '../chapter';
import { silosOf, tagOf, type DemoFarm, type ShedRole } from '../farms';

/**
 * `item_master.standard_cost` is a MySQL decimal, so Drizzle hands it back as
 * a string; the document DTOs take `rate?: number`. Convert once here rather
 * than pushing a string through a numeric field.
 */
function rateOf(standardCost: string | null | undefined): number | undefined {
  return standardCost == null ? undefined : Number(standardCost);
}


/**
 * Items resolve by seed handle and item NAME, never by literal code: the ITEM
 * series composes <type>-<category>-<sub>-ITM-<seq> from the category tree,
 * so the code moves whenever the category vocabulary does and a literal here
 * went stale the moment the catalog step composed its own. Handles are local
 * to this chapter; names are the shared catalog's (scripts/lib/seed-item-catalog.ts)
 * — the one property of a seeded item code generation cannot move.
 */
const NAME_BY_HANDLE: Record<string, string> = {
  MED_ANTIBIOTIC_1: 'Penicillin G Procaine 300K IU 100ml',
  MED_ANTIBIOTIC_2: 'Tylosin Tartrate 100g Soluble Powder',
  VACCINE_BREEDING: 'Parvo-Shield L5 Swine Vaccine (50 Doses)',
  FEED_GESTATION: 'Dry Sow Gestation Mash (14% CP)',
  FEED_LACTATION: 'High-Density Lactation Diet (17.5% CP)',
  FEED_GROWER: 'Weaner Grower Mash (18% CP)',
  FEED_FINISHER: 'Finisher High-Gain Porker Feed (15.5% CP)',
};
const MED_ANTIBIOTIC_1 = 'MED_ANTIBIOTIC_1';
const MED_ANTIBIOTIC_2 = 'MED_ANTIBIOTIC_2';
const VACCINE_BREEDING = 'VACCINE_BREEDING';
const FEED_GESTATION = 'FEED_GESTATION';
const FEED_LACTATION = 'FEED_LACTATION';
const FEED_GROWER = 'FEED_GROWER';
const FEED_FINISHER = 'FEED_FINISHER';

/**
 * The diet a silo is stocked with, from the shed it hangs off. Same mapping
 * the breed lifecycles use: gestation mash for dry sows, gilts and boars,
 * lactation for farrowing, grower mash for weaners and growers, finisher feed
 * for finishers. Values are the catalog handles above, resolved to item names
 * when the item is looked up.
 */
const FEED_BY_SHED_ROLE: Record<ShedRole, string> = {
  DRY_SOW: FEED_GESTATION,
  GILT: FEED_GROWER,
  GILT_REARING: FEED_GROWER,
  BOAR: FEED_GESTATION,
  FARROWING: FEED_LACTATION,
  WEANER: FEED_GROWER,
  GROWER: FEED_GROWER,
  FINISHER: FEED_FINISHER,
};
const FEED_DEFAULT = FEED_GESTATION;

/** The demo quantities — labelled demo facts, not client data. */
const DEMO_OPERATIONS = {
  feedReceiptKgPerSilo: 2000,
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

/** How many of a farm's silos the chapter stocks. Two is enough to transfer between. */
const SILOS_STOCKED_PER_FARM = 2;

const TODAY = () => new Date().toISOString().slice(0, 10);

/**
 * Look an item up by its NAME — the one property of a seeded item that code
 * generation cannot move (see NAME_BY_HANDLE). Throws with the handle when
 * the catalog step has not run, so the failure names the missing prerequisite
 * instead of a code nothing composes any more.
 */
async function itemByHandle(db: MySql2Database<typeof schema>, handle: string) {
  const name = NAME_BY_HANDLE[handle];
  if (!name) throw new Error(`02-inventory: no item name mapped for handle '${handle}'.`);
  // Company-scoped row when present (company wins for an operational caller),
  // else the tenant row.
  const [row] = await db
    .select({ item_id: schema.itemMaster.item_id, item_code: schema.itemMaster.item_code, standard_cost: schema.itemMaster.standard_cost })
    .from(schema.itemMaster)
    .where(and(eq(schema.itemMaster.item_name, name), eq(schema.itemMaster.is_active, true), isNull(schema.itemMaster.deleted_at)))
    .orderBy(schema.itemMaster.company_id)
    .limit(1);
  if (!row) throw new Error(`02-inventory: item '${name}' (handle ${handle}) not found — run db-seed-demo-item-catalog first.`);
  return row;
}

/** The silos this chapter stocks on a farm, with the diet each one takes. */
function stockedSilos(farm: DemoFarm): Array<{ id: string; code: string; feedHandle: string }> {
  const shedBySilo = new Map(farm.sheds.filter((s) => s.siloId).map((s) => [s.siloId!, s]));
  return silosOf(farm)
    .slice(0, SILOS_STOCKED_PER_FARM)
    .map((silo) => {
      const role = shedBySilo.get(silo.id)?.role;
      return { ...silo, feedHandle: (role && FEED_BY_SHED_ROLE[role]) || FEED_DEFAULT };
    });
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

    for (const farm of ctx.demoFarms) {
      const tag = tagOf(farm);

      // The farm's Demo Medicine Store (01-stores-and-items) and its silos.
      const [store] = await db
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.parent_location_id, farm.farmId),
          eq(schema.locationMaster.location_name, 'Demo Medicine Store'),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (!store) throw new Error(`02-inventory: no Demo Medicine Store under ${farm.code} — run chapter 01-stores-and-items first.`);

      const siloIds = stockedSilos(farm);
      if (siloIds.length < 2) {
        throw new Error(`02-inventory: ${farm.code} has ${siloIds.length} silo(s); the chapter needs two to transfer between.`);
      }

      const ref = (doc: string) => `DEMO-${farm.code}-${doc}`;

      // --- 1. Feed receipts into the stocked silos (one document per silo).
      {
        const existing = await db
          .select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
          .from(schema.goodsReceipt)
          .where(eq(schema.goodsReceipt.external_reference_no, ref('SILORCP')));
        if (existing.length === 0) {
          for (const silo of siloIds) {
            const feed = await itemByHandle(db, silo.feedHandle);
            await receipts.create(
              {
                company_id: ctx.companyId,
                warehouse_id: silo.id,
                posting_date: postingDate,
                external_reference_no: ref('SILORCP'),
                remarks: `DEMO feed receipt into silo ${silo.code}`,
                lines: [
                  {
                    item_id: feed.item_id,
                    quantity: DEMO_OPERATIONS.feedReceiptKgPerSilo,
                    uom: 'KG',
                    rate: rateOf(feed.standard_cost),
                    lot_no: `DEMO-${farm.code}-${feed.item_code.split('-')[2] ?? 'FEED'}`,
                  },
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
          const storeLines: GoodsReceiptLineInput[] = [];
          for (const line of DEMO_OPERATIONS.storeReceipt) {
            const item = await itemByHandle(db, line.item_code);
            storeLines.push({ item_id: item.item_id, quantity: line.quantity, uom: line.uom, rate: rateOf(item.standard_cost), lot_no: `DEMO-${farm.code}-${item.item_code.split('-').pop()}` });
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
          const med = await itemByHandle(db, DEMO_OPERATIONS.medicineIssue.item_code);
          const created = await issues.create(
            {
              company_id: ctx.companyId,
              warehouse_id: store.location_id,
              posting_date: postingDate,
              remarks: ref('ISSUE'),
              lines: [{ item_id: med.item_id, quantity: DEMO_OPERATIONS.medicineIssue.quantity, uom: DEMO_OPERATIONS.medicineIssue.uom, remarks: 'DEMO medicine issue for routine treatment' }],
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

      // --- 4. Stock transfer between the farm's first two silos. The item is
      // the one the source silo was stocked with — the destination's own diet
      // may differ, and a transfer of feed it holds none of would be refused.
      {
        const [existing] = await db
          .select({ id: schema.stockTransfer.transfer_id, status: schema.stockTransfer.status })
          .from(schema.stockTransfer)
          .where(eq(schema.stockTransfer.remarks, ref('XSILO')))
          .limit(1);
        if (!existing) {
          const feed = await itemByHandle(db, siloIds[0].feedHandle);
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
          const posItem = await itemByHandle(db, DEMO_OPERATIONS.adjustments.positive.item_code);
          const negItem = await itemByHandle(db, DEMO_OPERATIONS.adjustments.negative.item_code);
          const created = await adjustments.create(
            {
              company_id: ctx.companyId,
              warehouse_id: store.location_id,
              posting_date: postingDate,
              reason: ref('ADJ'),
              remarks: 'DEMO positive (found stock) and negative (damaged) adjustment',
              lines: [
                { item_id: posItem.item_id, quantity: DEMO_OPERATIONS.adjustments.positive.quantity, uom: DEMO_OPERATIONS.adjustments.positive.uom, rate: rateOf(posItem.standard_cost), remarks: 'DEMO found stock' },
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
