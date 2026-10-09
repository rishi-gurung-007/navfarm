/**
 * Chapter `09-costing-scenarios` — stock for the four costing test items, so every costing path can be
 * driven by hand: FIFO and Average, each with and without lot tracking (items are in
 * lib/seed-item-catalog.ts, COSTING_TEST_ITEMS).
 *
 * Per farm, three goods receipts into the farm's Demo Medicine Store, dated three, two and one day back, so
 * the receipt order is unambiguous:
 *
 *            receipt 1     receipt 2     receipt 3
 *   rate     ₹20           ₹30           ₹40            (500 kg each)
 *   lot      LOT-1 (far)   LOT-2 (near)  LOT-3 (middle)  tracked items only
 *
 * The lots are set so the lot with the nearest expiry is NOT the oldest receipt. That is the case worth
 * checking: the picker offers LOT-2 first (nearest expiry), while the price still follows the item's
 * costing method — FIFO prices from receipt 1 (₹20) whichever lot the stock leaves, Average prices at the
 * running average of everything held. Untracked items have no lot to choose, so only the method prices them.
 *
 * Rates and quantities are labelled demo facts, not client data. Resume-safe: each receipt is found by its
 * external reference (DEMO-<farm>-COSTING-<n>) — absent -> create + post, DRAFT -> post, POSTED -> skip.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { GoodsReceiptService } from '../../../modules/inventory/goods-receipt/goods-receipt.service';
import * as schema from '../../../core/database/schema';
import type { GoodsReceiptLineInput } from '../../../modules/inventory/goods-receipt/dto/goods-receipt.dto';
import { COSTING_TEST_ITEMS } from '../../lib/seed-item-catalog';
import type { DemoChapter, DemoContext } from '../chapter';
import { tagOf } from '../farms';

const STORE_NAME = 'Demo Medicine Store';
const KG_PER_RECEIPT = 500;

/** Days before today the receipt is dated, its rate, and the lot (tracked items) with that lot's days to expiry. */
export const COSTING_RECEIPTS = [
  { n: 1, daysBack: 3, rate: 20, lot: 'LOT-1', expiresInDays: 365 },
  { n: 2, daysBack: 2, rate: 30, lot: 'LOT-2', expiresInDays: 45 },
  { n: 3, daysBack: 1, rate: 40, lot: 'LOT-3', expiresInDays: 180 },
] as const;

const dayOffset = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export const costingScenariosChapter: DemoChapter = {
  name: '09-costing-scenarios',

  async run(ctx: DemoContext) {
    const receipts = ctx.app.get(GoodsReceiptService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('09-costing-scenarios: tenantDb is not set — run through the harness.');

    const items = await db
      .select({ item_id: schema.itemMaster.item_id, item_name: schema.itemMaster.item_name, is_lot_tracked: schema.itemMaster.is_lot_tracked })
      .from(schema.itemMaster)
      .where(and(
        inArray(schema.itemMaster.item_name, COSTING_TEST_ITEMS.map((i) => i.name)),
        eq(schema.itemMaster.company_id, ctx.companyId),
        isNull(schema.itemMaster.deleted_at),
      ));
    if (items.length !== COSTING_TEST_ITEMS.length) {
      throw new Error(`09-costing-scenarios: found ${items.length} of ${COSTING_TEST_ITEMS.length} costing test items — run db-seed-demo-item-catalog --apply first.`);
    }
    // In the catalog's order, so the receipt lines read A, B, C, D.
    const ordered = COSTING_TEST_ITEMS.map((c) => items.find((i) => i.item_name === c.name)!);

    for (const farm of ctx.demoFarms) {
      const tag = tagOf(farm);
      const [store] = await db
        .select({ location_id: schema.locationMaster.location_id })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.parent_location_id, farm.farmId),
          eq(schema.locationMaster.location_name, STORE_NAME),
          isNull(schema.locationMaster.deleted_at),
        ))
        .limit(1);
      if (!store) throw new Error(`09-costing-scenarios: no ${STORE_NAME} under ${farm.code} — run chapter 01-stores-and-items first.`);

      for (const r of COSTING_RECEIPTS) {
        const ref = `DEMO-${farm.code}-COSTING-${r.n}`;
        const [existing] = await db
          .select({ id: schema.goodsReceipt.receipt_id, status: schema.goodsReceipt.status })
          .from(schema.goodsReceipt)
          .where(eq(schema.goodsReceipt.external_reference_no, ref))
          .limit(1);
        if (existing?.status === 'POSTED') {
          ctx.log(`${tag} costing receipt ${r.n} already posted — skipped`);
          continue;
        }
        if (existing) {
          await receipts.post(existing.id, ctx.tenantId);
          ctx.log(`${tag} costing receipt ${r.n} posted`);
          continue;
        }
        const lines: GoodsReceiptLineInput[] = ordered.map((item) => ({
          item_id: item.item_id,
          quantity: KG_PER_RECEIPT,
          uom: 'KG',
          rate: r.rate,
          ...(item.is_lot_tracked ? { lot_no: r.lot, expiry_date: dayOffset(r.expiresInDays) } : {}),
        }));
        const created = await receipts.create(
          {
            company_id: ctx.companyId,
            warehouse_id: store.location_id,
            posting_date: dayOffset(-r.daysBack),
            external_reference_no: ref,
            remarks: `DEMO costing scenarios receipt ${r.n}: ${KG_PER_RECEIPT} kg of each costing test item at ₹${r.rate}`,
            lines,
          },
          ctx.tenantId,
        );
        await receipts.post(created.receipt_id, ctx.tenantId);
        ctx.log(`${tag} costing receipt ${r.n} posted (${KG_PER_RECEIPT} kg × 4 items @ ₹${r.rate})`);
      }
    }
  },
};
