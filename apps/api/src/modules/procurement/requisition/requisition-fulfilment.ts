/**
 * Part E Task 7: a linked requisition follows its transfer's events. Called by
 * StockTransferService at the end of postShipment/postReceipt inside the same
 * transaction, so a shipment posted from either screen updates the requisition.
 * A plain function (not a provider) so the inventory module does not import
 * the procurement module — the same direction transfer-execution.rules.ts
 * already uses for requisition.rules.ts.
 */
import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { fulfilmentStatusOf } from './requisition.rules';

export async function syncRequisitionFulfilment(db: MySql2Database<typeof schema>, transferId: string): Promise<void> {
  // Fix round 1, Minor: the brief's sample had no tenant_id/deleted_at guard
  // on this lookup. syncRequisitionFulfilment takes no tenantId (the brief's
  // exact signature), so tenant scoping is enforced by joining the transfer
  // itself rather than adding a parameter: a match requires the requisition's
  // own tenant_id to equal the SAME transfer row's tenant_id, not merely that
  // some requisition somewhere carries this transfer id. Also excludes a
  // soft-deleted requisition, consistent with every other query in this
  // module.
  const [commonLinked] = await db
    .select({ requisition_id: schema.requisition.requisition_id, tenant_id: schema.requisition.tenant_id })
    .from(schema.requisition)
    .innerJoin(schema.stockTransfer, eq(schema.stockTransfer.transfer_id, schema.requisition.linked_transfer_id))
    .where(and(
      eq(schema.stockTransfer.transfer_id, transferId),
      eq(schema.requisition.tenant_id, schema.stockTransfer.tenant_id),
      isNull(schema.requisition.deleted_at),
    ));
  let linked = commonLinked;
  let linkedTransferIds = [transferId];

  if (!linked) {
    const [feedLinked] = await db
      .select({ requisition_id: schema.feedRequisitionTransfer.requisition_id, tenant_id: schema.feedRequisitionTransfer.tenant_id })
      .from(schema.feedRequisitionTransfer)
      .innerJoin(schema.requisition, eq(schema.requisition.requisition_id, schema.feedRequisitionTransfer.requisition_id))
      .innerJoin(schema.stockTransfer, eq(schema.stockTransfer.transfer_id, schema.feedRequisitionTransfer.transfer_id))
      .where(and(
        eq(schema.feedRequisitionTransfer.transfer_id, transferId),
        eq(schema.feedRequisitionTransfer.tenant_id, schema.requisition.tenant_id),
        eq(schema.feedRequisitionTransfer.tenant_id, schema.stockTransfer.tenant_id),
        isNull(schema.requisition.deleted_at),
      ));
    linked = feedLinked;
    if (!linked) return;

    const transferLinks = await db
      .select({ transfer_id: schema.feedRequisitionTransfer.transfer_id })
      .from(schema.feedRequisitionTransfer)
      .where(and(
        eq(schema.feedRequisitionTransfer.requisition_id, linked.requisition_id),
        eq(schema.feedRequisitionTransfer.tenant_id, linked.tenant_id),
      ));
    linkedTransferIds = transferLinks.map((row) => row.transfer_id);
  }

  const triggeringLinks = await db
    .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id })
    .from(schema.stockTransferLine)
    .where(eq(schema.stockTransferLine.transfer_id, transferId));

  const shipped = await db
    .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: sql<string>`SUM(${schema.transferShipmentLine.quantity})` })
    .from(schema.transferShipmentLine)
    .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferShipmentLine.line_id))
    .where(inArray(schema.stockTransferLine.transfer_id, linkedTransferIds))
    .groupBy(schema.stockTransferLine.requisition_line_id);
  const received = await db
    .select({ requisition_line_id: schema.stockTransferLine.requisition_line_id, qty: sql<string>`SUM(${schema.transferReceiptLine.quantity})` })
    .from(schema.transferReceiptLine)
    .innerJoin(schema.stockTransferLine, eq(schema.stockTransferLine.line_id, schema.transferReceiptLine.line_id))
    .where(inArray(schema.stockTransferLine.transfer_id, linkedTransferIds))
    .groupBy(schema.stockTransferLine.requisition_line_id);
  // 2026-10-10 ruling (decisions.md, "Feed fulfilment measures against the
  // mill-approved quantity"): a feed line on a Mill Consolidation Sheet is
  // released at its mill_approved_qty_kg, so it is fully shipped/received
  // against that quantity, not the original request. The difference stays on
  // the consolidation line as the mill adjustment with its reason. Lines with
  // no consolidation row (every common requisition) keep their own quantities.
  // feed_consolidation_line.requisition_line_id is unique, so this join never
  // multiplies a line.
  const lines = (await db
    .select({ line_id: schema.requisitionLine.line_id, quantity: schema.requisitionLine.quantity, qty_to_ship: schema.requisitionLine.qty_to_ship, qty_to_receive: schema.requisitionLine.qty_to_receive, mill_approved_qty_kg: schema.feedConsolidationLine.mill_approved_qty_kg })
    .from(schema.requisitionLine)
    .leftJoin(schema.feedConsolidationLine, eq(schema.feedConsolidationLine.requisition_line_id, schema.requisitionLine.line_id))
    .where(eq(schema.requisitionLine.requisition_id, linked.requisition_id)))
    .map(({ mill_approved_qty_kg, ...line }) => ({ ...line, mill_approved: mill_approved_qty_kg == null ? null : { qty_to_ship: mill_approved_qty_kg, qty_to_receive: mill_approved_qty_kg } }));

  // Ownership guard (required addition, moved here from the originally
  // planned Tasks 9/12 hardening — see docs/decisions and the task brief):
  // stock_transfer_line.requisition_line_id is a bare varchar with no DB-level
  // FK or CHECK (schema.ts), and StockTransferService.update() only checks
  // the id is PRESENT on a line-replace, never that it is RIGHT. Without this
  // check, a transfer line carrying a requisition_line_id that belongs to
  // some OTHER requisition would silently never match any of THIS
  // requisition's own line ids below — dropped from its totals with no
  // record that anything was wrong. Refuse instead: this sync runs inside
  // postShipment's/postReceipt's own transaction, so throwing here rolls the
  // whole shipment/receipt back rather than letting a corrupted link's
  // quantity vanish quietly.
  const validLineIds = new Set(lines.map((l) => l.line_id));
  for (const row of [...triggeringLinks, ...shipped, ...received]) {
    if (row.requisition_line_id && !validLineIds.has(row.requisition_line_id)) {
      throw new BadRequestException(
        `Transfer ${transferId}: requisition_line_id '${row.requisition_line_id}' does not belong to requisition ${linked.requisition_id}.`,
      );
    }
  }

  const sum = (rows: Array<{ requisition_line_id: string | null; qty: string }>, id: string) => Number(rows.find((r) => r.requisition_line_id === id)?.qty ?? 0);
  const updated: Array<{ quantity: unknown; qty_to_ship: unknown; qty_to_receive: unknown; qty_shipped: number; qty_received: number }> = [];
  for (const line of lines) {
    const qtyShipped = sum(shipped, line.line_id);
    const qtyReceived = sum(received, line.line_id);
    // A mill-approved line also stores its to-ship/to-receive as that quantity,
    // so every line view reads a balance against it (no phantom adjustment).
    const { mill_approved, ...own } = line;
    await db.update(schema.requisitionLine).set({ qty_shipped: String(qtyShipped), qty_received: String(qtyReceived), ...(mill_approved ?? {}) }).where(eq(schema.requisitionLine.line_id, line.line_id));
    updated.push({ ...own, ...(mill_approved ?? {}), qty_shipped: qtyShipped, qty_received: qtyReceived });
  }
  await db.update(schema.requisition).set({ fulfilment_status: fulfilmentStatusOf(updated) }).where(eq(schema.requisition.requisition_id, linked.requisition_id));
}
