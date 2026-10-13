/**
 * Chapter `11-stock-transfers` — stock moving between farms, through the whole transfer life
 * (`StockTransferService`: create → ship → receive), all dated in the last days of the window. Chapter 02
 * only posted a one-step silo-to-silo move; this is the in-transit flow the Transfer and Receipts screens read.
 *
 *   MED-FULL   Penicillin, MUL100 store → POR100 store: shipped yesterday, received in full today.
 *   MED-DOA    Iron dextran, POR100 store → RIC100 store: 10 shipped, 8 arrive good and 2 are written off as
 *              DOA — the receipt carries the DOA and the write-off is posted against it.
 *   SEMEN      Semen lot, MUL100 store → AI100 store (POR100 in the lean seed): the lot number travels with the doses (a lot-tracked item
 *              must name its lot), shipped yesterday and received today.
 *   PENDING    PRRS vaccine, RIC100 store → VIL100 store: shipped and left IN_TRANSIT, so a pending receipt is
 *              waiting on the destination farm.
 *
 * Quantities are demo facts. The unit of each line is the unit the source store already holds the item in.
 *
 * Resume semantics: a transfer is located by the DEMO token in its remarks, then taken as far as its scenario
 * goes — absent: create; DRAFT: ship; IN_TRANSIT: receive (except PENDING); anything later: skipped.
 *
 *   pnpm nx run api:db-demo-chapters -- --apply --chapter=11-stock-transfers
 */
import { and, eq, sql } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import { StockTransferService } from '../../../modules/inventory/stock-transfer/stock-transfer.service';
import * as schema from '../../../core/database/schema';
import type { DemoChapter, DemoContext } from '../chapter';
import { createItemLookup } from '../batch-helpers';

interface Scenario {
  key: string;
  from: string;
  to: string;
  item: string;
  quantity: number;
  /** Doses/vials that arrive dead or damaged; the rest arrive good. */
  doa?: number;
  /** Take the semen lot number off the source's stock. */
  lotTracked?: boolean;
  /** Leave the transfer IN_TRANSIT after shipping. */
  leaveInTransit?: boolean;
  why: string;
}

const SCENARIOS: Scenario[] = [
  { key: 'MED-FULL', from: 'MUL100', to: 'POR100', item: 'Penicillin G Procaine 300K IU 100ml', quantity: 5, why: 'received in full' },
  { key: 'MED-DOA', from: 'POR100', to: 'RIC100', item: 'Iron Dextran 100mg/ml 100ml Injection', quantity: 10, doa: 2, why: '8 good, 2 DOA' },
  { key: 'SEMEN', from: 'MUL100', to: 'AI100', item: 'BOAR semen', quantity: 12, lotTracked: true, why: 'semen lot kept' },
  { key: 'PENDING', from: 'RIC100', to: 'VIL100', item: 'Ingelvac PRRS MLV Swine Vaccine (50 Doses)', quantity: 4, leaveInTransit: true, why: 'left IN_TRANSIT' },
];

/** The same four stories on the two farms of the lean seed (the AI station and the other farms are not there). */
const LEAN_SCENARIOS: Scenario[] = [
  SCENARIOS[0],
  { ...SCENARIOS[1], from: 'POR100', to: 'MUL100' },
  { ...SCENARIOS[2], to: 'POR100' },
  { ...SCENARIOS[3], from: 'POR100', to: 'MUL100' },
];

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export const stockTransfersChapter: DemoChapter = {
  name: '11-stock-transfers',

  async run(ctx: DemoContext): Promise<void> {
    const transfers = ctx.app.get(StockTransferService);
    const cls = ctx.app.get(ClsService);
    const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('11-stock-transfers: tenantDb is not set — run through the harness.');
    const item = createItemLookup(db, ctx.companyId);
    const farmByCode = new Map(ctx.demoFarms.map((f) => [f.code as string, f]));
    const shipDate = dateDaysAgo(1);
    const receiveDate = dateDaysAgo(0);

    for (const s of ctx.lean ? LEAN_SCENARIOS : SCENARIOS) {
      const from = farmByCode.get(s.from);
      const to = farmByCode.get(s.to);
      if (!from?.storeId || !to?.storeId) {
        ctx.log(`${s.key}: ${s.from} or ${s.to} has no store — skipped`);
        continue;
      }
      const row = await item(s.item);
      const token = `DEMO XFER ${s.key} — ${s.why}`;

      // The unit and, for a lot-tracked item, the lot the source store really holds.
      const [held] = await db
        .select({ uom: schema.inventoryLedger.uom, lot_no: schema.inventoryLedger.lot_no })
        .from(schema.inventoryLedger)
        .where(and(
          eq(schema.inventoryLedger.warehouse_id, from.storeId),
          eq(schema.inventoryLedger.item_id, row.item_id),
          s.lotTracked ? sql`${schema.inventoryLedger.lot_no} IS NOT NULL` : sql`1 = 1`,
          sql`${schema.inventoryLedger.quantity} > 0`,
        ))
        .limit(1);
      if (!held) throw new Error(`11-stock-transfers: ${s.from}'s store holds no '${s.item}' to transfer.`);

      let [transfer] = await db
        .select({ id: schema.stockTransfer.transfer_id, no: schema.stockTransfer.transfer_no, status: schema.stockTransfer.status })
        .from(schema.stockTransfer)
        .where(eq(schema.stockTransfer.remarks, token))
        .limit(1);

      if (!transfer) {
        const created: any = await transfers.create(
          {
            company_id: ctx.companyId,
            from_warehouse_id: from.storeId,
            to_warehouse_id: to.storeId,
            posting_date: shipDate,
            remarks: token,
            lines: [{
              item_id: row.item_id,
              quantity: s.quantity,
              uom: held.uom,
              ...(s.lotTracked ? { lot_no: held.lot_no ?? undefined } : {}),
              remarks: 'DEMO stock transfer between farm stores',
            }],
          },
          ctx.tenantId,
          ctx.actor,
        );
        transfer = { id: created.transfer_id, no: created.transfer_no, status: created.status ?? 'DRAFT' };
      }

      if (transfer.status === 'DRAFT') {
        await transfers.ship(
          transfer.id,
          { posting_date: shipDate, vehicle_no: 'DEMO-TRK-01', driver_name: 'Demo driver', waybill_ref: `WB-${s.key}`, remarks: token },
          ctx.tenantId,
          ctx.actor,
        );
        transfer.status = 'IN_TRANSIT';
        ctx.log(`${s.from} → ${s.to}: ${transfer.no} shipped ${shipDate} — ${s.quantity} × ${s.item}`);
      }

      if (transfer.status === 'IN_TRANSIT' && !s.leaveInTransit) {
        const detail: any = await transfers.findOne(transfer.id);
        const lines = (detail.lines ?? []).map((l: any) => ({
          line_id: l.line_id,
          received_quantity: s.quantity - (s.doa ?? 0),
          ...(s.doa ? { doa_quantity: s.doa, doa_remarks: 'Damaged in transit (DEMO)' } : {}),
        }));
        await transfers.receive(transfer.id, { posting_date: receiveDate, remarks: token, lines }, ctx.tenantId, ctx.actor);
        ctx.log(`${s.from} → ${s.to}: ${transfer.no} received ${receiveDate} — ${s.why}`);
      } else if (s.leaveInTransit) {
        ctx.log(`${s.from} → ${s.to}: ${transfer.no} left IN_TRANSIT — a pending receipt for ${s.to}`);
      } else {
        ctx.log(`${s.from} → ${s.to}: ${transfer.no} already ${transfer.status} — skipped`);
      }
    }
  },
};
