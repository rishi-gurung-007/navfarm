/**
 * Part E Task 7 — syncRequisitionFulfilment. A plain function (not a
 * provider), called by StockTransferService at the end of postShipment's and
 * postReceipt's own transaction body, so the inventory module imports a plain
 * function from procurement rather than going through NestJS DI — the same
 * shape transfer-execution.rules.ts already uses for requisition.rules.ts's
 * assertShipmentQty/assertReceiptQty, just the other direction.
 *
 * Read order per common call (db() below queues in call order, not by table):
 *   1. common requisition link
 *   2. triggering transfer's requisition-line references
 *   3. shipped quantities grouped by requisition_line_id
 *   4. received quantities grouped by requisition_line_id
 *   5. the linked requisition's own lines
 * Feed calls first miss the common lookup, then resolve the feed link and read
 * every transfer id linked to the same requisition before the remaining reads.
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
    const { db: d, sets } = db([[], []]);
    await syncRequisitionFulfilment(d, 'tr-x');
    expect(sets).toEqual([]);
  });

  it('writes shipped/received per requisition line and the fulfilment status', async () => {
    const { db: d, sets } = db([
      [{ requisition_id: 'req-1' }],                                                         // linked requisition
      [{ requisition_line_id: 'l1' }],                                                       // triggering transfer links
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
      [{ requisition_line_id: 'line-of-another-requisition' }],                               // triggering transfer links
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
      [{ requisition_line_id: null }, { requisition_line_id: 'l1' }],                         // triggering transfer links
      [{ requisition_line_id: null, qty: '3' }, { requisition_line_id: 'l1', qty: '6' }],      // shipped sums — one unlinked, one linked
      [{ requisition_line_id: 'l1', qty: '4' }],                                               // received sums
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],             // requisition lines (req-1's own)
    ]);
    await syncRequisitionFulfilment(d, 'tr-1');
    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  it('aggregates two feed-linked transfers contributing to the same requisition line', async () => {
    const { db: d, sets } = db([
      [],                                                                                     // no common link
      [{ requisition_id: 'feed-req-1' }],                                                     // feed link
      [{ transfer_id: 'tr-1' }, { transfer_id: 'tr-2' }],                                     // all feed transfers
      [{ requisition_line_id: 'l1' }],                                                        // triggering transfer links
      [{ requisition_line_id: 'l1', qty: '10' }],                                            // aggregate shipped across both
      [{ requisition_line_id: 'l1', qty: '7' }],                                             // aggregate received across both
      [{ line_id: 'l1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }],
    ]);

    await syncRequisitionFulfilment(d, 'tr-2');

    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([
      { qty_shipped: '10', qty_received: '7' },
    ]);
    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  it('keeps feed fulfilment open until every line across every linked transfer is received', async () => {
    const { db: d, sets } = db([
      [],
      [{ requisition_id: 'feed-req-1' }],
      [{ transfer_id: 'tr-1' }, { transfer_id: 'tr-2' }],
      [{ requisition_line_id: 'l2' }],
      [{ requisition_line_id: 'l1', qty: '5' }, { requisition_line_id: 'l2', qty: '8' }],
      [{ requisition_line_id: 'l1', qty: '5' }, { requisition_line_id: 'l2', qty: '6' }],
      [
        { line_id: 'l1', quantity: '5', qty_to_ship: '5', qty_to_receive: '5' },
        { line_id: 'l2', quantity: '8', qty_to_ship: '8', qty_to_receive: '8' },
      ],
    ]);

    await syncRequisitionFulfilment(d, 'tr-2');

    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  it('marks a feed requisition received after every line across its linked transfers is received', async () => {
    const { db: d, sets } = db([
      [],
      [{ requisition_id: 'feed-req-1' }],
      [{ transfer_id: 'tr-1' }, { transfer_id: 'tr-2' }],
      [{ requisition_line_id: 'l2' }],
      [{ requisition_line_id: 'l1', qty: '5' }, { requisition_line_id: 'l2', qty: '8' }],
      [{ requisition_line_id: 'l1', qty: '5' }, { requisition_line_id: 'l2', qty: '8' }],
      [
        { line_id: 'l1', quantity: '5', qty_to_ship: '5', qty_to_receive: '5' },
        { line_id: 'l2', quantity: '8', qty_to_ship: '8', qty_to_receive: '8' },
      ],
    ]);

    await syncRequisitionFulfilment(d, 'tr-2');

    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'RECEIVED' });
  });
  /**
   * 2026-10-10 ruling (decisions.md, "Feed fulfilment measures against the
   * mill-approved quantity"): the mill approved 6,000 of a 6,050 KG request and
   * release moved 6,000. Receiving that 6,000 must close the line and the
   * requisition (RECEIVED) — lockCycle only frees a silo+item once the prior
   * requisition is RECEIVED, so measuring against 6,050 deadlocked it forever.
   */
  it('marks a feed line RECEIVED once its mill-approved quantity (not the request) is received', async () => {
    const { db: d, sets } = db([
      [],
      [{ requisition_id: 'feed-req-1' }],
      [{ transfer_id: 'tr-1' }],
      [{ requisition_line_id: 'l1' }],
      [{ requisition_line_id: 'l1', qty: '6000' }],
      [{ requisition_line_id: 'l1', qty: '6000' }],
      [{ line_id: 'l1', quantity: '6050', qty_to_ship: '6050', qty_to_receive: '6050', mill_approved_qty_kg: '6000.0000' }],
    ]);

    await syncRequisitionFulfilment(d, 'tr-1');

    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'RECEIVED' });
    // No phantom 50 KG: the line's stored to-ship/to-receive are the mill-approved quantity,
    // so every line view (feed read model, common lineBalances) shows a zero balance.
    expect(sets.filter((s) => s.table === schema.requisitionLine).map((s) => s.values)).toEqual([
      { qty_shipped: '6000', qty_received: '6000', qty_to_ship: '6000.0000', qty_to_receive: '6000.0000' },
    ]);
  });

  it('keeps a mill-adjusted feed line PARTIALLY_RECEIVED until the mill-approved quantity is received', async () => {
    const { db: d, sets } = db([
      [],
      [{ requisition_id: 'feed-req-1' }],
      [{ transfer_id: 'tr-1' }],
      [{ requisition_line_id: 'l1' }],
      [{ requisition_line_id: 'l1', qty: '6000' }],
      [{ requisition_line_id: 'l1', qty: '3000' }],
      [{ line_id: 'l1', quantity: '6050', qty_to_ship: '6050', qty_to_receive: '6050', mill_approved_qty_kg: '6000.0000' }],
    ]);

    await syncRequisitionFulfilment(d, 'tr-1');

    expect(sets.find((s) => s.table === schema.requisition)!.values).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });
});
