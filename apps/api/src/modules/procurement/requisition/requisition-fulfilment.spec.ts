/**
 * Part E Task 7 — syncRequisitionFulfilment. A plain function (not a
 * provider), called by StockTransferService at the end of postShipment's and
 * postReceipt's own transaction body, so the inventory module imports a plain
 * function from procurement rather than going through NestJS DI — the same
 * shape transfer-execution.rules.ts already uses for requisition.rules.ts's
 * assertShipmentQty/assertReceiptQty, just the other direction.
 *
 * Read order per call (db() below queues in call order, not by table):
 *   1. the requisition linked to this transfer (if any — no-op otherwise)
 *   2. shipped quantities grouped by requisition_line_id, for this transfer
 *   3. received quantities grouped by requisition_line_id, for this transfer
 *   4. the linked requisition's own lines
 * then one update per line (qty_shipped/qty_received) and one update on the
 * requisition itself (fulfilment_status).
 */
import { syncRequisitionFulfilment } from './requisition-fulfilment';
import * as schema from '../../../core/database/schema';

function db(queues: unknown[][]) {
  const sets: Array<{ table: unknown; values: any }> = [];
  const select = jest.fn(() => {
    const rows = queues.shift() ?? [];
    const self: any = {};
    for (const m of ['from', 'where', 'innerJoin', 'leftJoin', 'groupBy', 'limit']) self[m] = () => self;
    self.then = (ok: any, err: any) => Promise.resolve(rows).then(ok, err);
    return self;
  });
  const update = jest.fn((table: unknown) => ({ set: jest.fn((values: any) => { sets.push({ table, values }); return { where: jest.fn(async () => undefined) }; }) }));
  return { db: { select, update } as any, sets };
}

describe('syncRequisitionFulfilment', () => {
  it('does nothing for a transfer no requisition links to', async () => {
    const { db: d, sets } = db([[]]);
    await syncRequisitionFulfilment(d, 'tr-x');
    expect(sets).toEqual([]);
  });

  it('writes shipped/received per requisition line and the fulfilment status', async () => {
    const { db: d, sets } = db([
      [{ requisition_id: 'req-1' }],                                                         // linked requisition
      [{ requisition_line_id: 'l1', qty: '6' }],                                             // shipped sums
      [{ requisition_line_id: 'l1', qty: '4' }],                                             // received sums
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],          // requisition lines
    ]);
    await syncRequisitionFulfilment(d, 'tr-1');
    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  /**
   * Ownership guard (the task's required addition, not in the original
   * brief): stock_transfer_line.requisition_line_id is a bare varchar with no
   * DB-level FK or CHECK, and StockTransferService.update() only checks the
   * id is PRESENT on a line-replace, never that it is RIGHT. Without this
   * check a wrong link would not fail loudly here — it would try to post one
   * requisition's shipped/received quantities as if they belonged to this
   * one. This refuses rather than silently dropping the row: the sync runs
   * inside postShipment/postReceipt's own transaction (see
   * stock-transfer.service.spec assertions), so refusing rolls the whole
   * shipment/receipt back and forces the corrupted link to be fixed, instead
   * of letting bad data accumulate unnoticed under a quiet log line.
   */
  it('refuses a shipped/received row whose requisition_line_id belongs to a different requisition', () => {
    const { db: d } = db([
      [{ requisition_id: 'req-1' }],                                                          // linked requisition
      [{ requisition_line_id: 'line-of-another-requisition', qty: '6' }],                     // shipped sums — foreign link
      [],                                                                                      // received sums
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],            // requisition lines (req-1's own)
    ]);
    return expect(syncRequisitionFulfilment(d, 'tr-1')).rejects.toThrow(
      "requisition_line_id 'line-of-another-requisition' does not belong to requisition req-1",
    );
  });

  /**
   * Fix round 1, Minor (the mixed NULL/linked regression risk named in
   * review): an ordinary hand-made transfer line with no requisition link at
   * all (requisition_line_id NULL — true for every transfer that didn't come
   * from a Store release) sits in the same grouped result set as a linked
   * line, once any one line of the transfer is linked. The ownership guard's
   * `row.requisition_line_id &&` must skip the NULL row rather than treat it
   * as a foreign link, and the NULL row's quantity must not get summed onto
   * the one real requisition line either.
   */
  it('ignores an unlinked (NULL requisition_line_id) line alongside a linked one', async () => {
    const { db: d, sets } = db([
      [{ requisition_id: 'req-1' }],                                                          // linked requisition
      [{ requisition_line_id: null, qty: '3' }, { requisition_line_id: 'l1', qty: '6' }],      // shipped sums — one unlinked, one linked
      [{ requisition_line_id: 'l1', qty: '4' }],                                               // received sums
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],             // requisition lines (req-1's own)
    ]);
    await syncRequisitionFulfilment(d, 'tr-1');
    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });
});
