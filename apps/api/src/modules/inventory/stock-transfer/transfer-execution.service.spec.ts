/**
 * Task 10 — staged transfer execution through StockTransferService (recording
 * database, per feed-requisition.submit.spec.ts's pattern).
 *
 * Read model: every db.select() pops the next row-set keyed by the FROM table
 * (for a join, the table the query is `from`). The queues below therefore list
 * row-sets in exact call order per table. Written event rows are pushed back
 * onto their queues by the insert handler — merged with a `qty` alias, the
 * shape the cumulative joins project — so a later read inside the same
 * transaction (the receipt binding to the shipment it follows, the POSTED
 * claim recounting coverage) sees what this call wrote.
 *
 * The flow per staged call is:
 *   loadForMutation      → stockTransfer, stockTransferLine
 *   assertWarehouses     → locationMaster ×2 (assertLocationOnActiveFarm)
 *   assertSiloDestination→ locationMaster ×1 (shipment/direct paths only;
 *                          postReceipt has no silo guard)
 *   shippedQuantities    → transferShipmentLine (join, from-table pops)
 *   receivedQuantities   → transferReceiptLine (join, from-table pops)
 *   postReceipt only     → transferShipment (the shipment being received),
 *                          transferShipmentLine (its lines)
 *   nextEventNo          → transferShipment/transferReceipt (numbering read)
 * The old atomic post's own spec pins the compatibility wrapper; this spec
 * covers what the wrapper adds — partial events, bounds, event identity.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FARM_SCOPE_KEY, type FarmScope } from '../../../common/farm-scope';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { UomService } from '../../master-data/uom/uom.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { StockTransferService } from './stock-transfer.service';

const SCOPE: FarmScope = { farmId: null, companyId: 'co-1', restricted: false, lobId: null };
const ADMIN = { userId: 'u-admin', userType: 'COMPANY_ADMIN' };

const TRANSFER = {
  transfer_id: 'tr-1', tenant_id: 'tenant-1', company_id: 'co-1', transfer_no: 'TR-2026-0001',
  posting_date: '2026-10-02', from_warehouse_id: 'wh-store', to_warehouse_id: 'wh-farm',
  remarks: null, status: 'DRAFT', posted_at: null, posted_by: null,
  created_by: 'u-admin', updated_by: null, created_at: '2026-10-01 08:00:00', updated_at: '2026-10-01 08:00:00', deleted_at: null,
};
const LINE = {
  line_id: 'line-1', transfer_id: 'tr-1', line_no: 1, item_id: 'item-1',
  quantity: '10', uom: 'EA', lot_no: 'LOT-9', serial_no: null, remarks: null,
};

// One row-set per location read, in call order: source, destination, silo
// guard (type FARM → early return). farmId is null in SCOPE, so the guard
// checks company only; the silo row carries no company because the read is
// projected to identity columns alone.
const LOCATIONS = [
  [{ location_id: 'wh-store', location_type: 'STORE', company_id: 'co-1', lob_id: null, parent: 'farm-a', farm_id: 'farm-a' }],
  [{ location_id: 'wh-farm', location_type: 'FARM', company_id: 'co-1', lob_id: null, parent: null, farm_id: null }],
  [{ location_id: 'wh-farm', location_name: 'Farm store', location_type: 'FARM', silo_capacity_kg: null }],
];

const SHIPMENT = {
  shipment_id: 'sh-1', tenant_id: 'tenant-1', transfer_id: 'tr-1', shipment_no: 'SH-2026-0001',
  shipment_date: '2026-10-02', status: 'POSTED', created_by: 'u-admin', created_at: '2026-10-01 09:00:00', deleted_at: null,
};
const SHIPMENT_LINE = {
  shipment_line_id: 'sl-1', shipment_id: 'sh-1', line_id: 'line-1',
  quantity: '6', uom: 'EA', lot_no: 'LOT-9', serial_no: null,
};

function recordingDb(queues: Map<unknown, unknown[][]>) {
  const log: Array<{ op: string; table: unknown; values?: any; set?: any }> = [];
  const db: any = {
    select: jest.fn(() => {
      const entry: { op: string; table: unknown } = { op: 'select', table: undefined };
      log.push(entry);
      const self: any = {
        from: (t: unknown) => { entry.table = t; return self; },
        innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self,
        limit: () => self, offset: () => self, for: () => self, groupBy: () => self,
        then: (ok: any, err: any) => Promise.resolve().then(() => queues.get(entry.table)?.shift() ?? []).then(ok, err),
      };
      return self;
    }),
    insert: jest.fn((table: unknown) => ({
      values: jest.fn(async (v: any) => {
        log.push({ op: 'insert', table, values: v });
        // Read-your-writes inside the transaction: a written event row becomes
        // readable by the next query on its table (the receipt binding to the
        // shipment header it follows, the POSTED coverage recount). The `qty`
        // alias mirrors what the cumulative joins project (qty: quantity).
        const bucket = queues.get(table);
        if (bucket && v && typeof v === 'object' && ('shipment_id' in v || 'receipt_id' in v || 'line_id' in v)) {
          bucket.push([{ ...v, qty: v.quantity }]);
        }
      }),
    })),
    update: jest.fn((table: unknown) => ({
      set: jest.fn((v: any) => {
        log.push({ op: 'update', table, set: v });
        // MySqlRawQueryResult is an array ([ResultSetHeader, ...]); the
        // service destructures the claim out of it.
        return { where: jest.fn(async () => [{ affectedRows: 1 }]) };
      }),
    })),
  };
  return { db, log };
}

/** Base queues: enough reads for ONE staged call (shipment or receipt). */
function baseQueues(): Map<unknown, unknown[][]> {
  return new Map<unknown, unknown[][]>([
    [schema.stockTransfer, [[{ ...TRANSFER }]]],
    [schema.stockTransferLine, [[{ ...LINE }]]],
    [schema.locationMaster, LOCATIONS.map((l) => [...l])],
    [schema.transferShipment, []],
    [schema.transferShipmentLine, []],
    [schema.transferReceipt, []],
    [schema.transferReceiptLine, []],
    // Part E Task 7: syncRequisitionFulfilment's first read — no row means no
    // requisition links this transfer, so the sync no-ops and every existing
    // test above stays exactly as it was.
    [schema.requisition, [[]]],
  ]);
}

function setup(queues: Map<unknown, unknown[][]>) {
  const ref = {} as { cls: ClsService };
  const { db, log } = recordingDb(queues);
  const cls = (ref.cls = transactionCls(db));
  const ledger = {
    // Resolves like the real one, so a regression fails on the call assertion below, not a TypeError.
    writeTransferEntries: jest.fn().mockResolvedValue({ shipment: {}, receipt: {} }),
    writeTransferShipment: jest.fn().mockResolvedValue({ ledger_id: 'led-sh' }),
    writeTransferReceipt: jest.fn().mockResolvedValue({ ledger_id: 'led-rc' }),
    transferShipmentRate: jest.fn().mockResolvedValue(2.5),
    transferShipmentRemainingValue: jest.fn().mockResolvedValue(15),
  };
  const service = new StockTransferService(
    cls,
    { log: jest.fn().mockResolvedValue({}) } as unknown as AuditLogService,
    ledger as unknown as InventoryLedgerService,
    { postInventoryLedgerEntry: jest.fn() } as unknown as GlPostingService,
    { resolveConversionFactor: jest.fn().mockResolvedValue(1) } as unknown as UomService,
    { assertCanReceive: jest.fn().mockResolvedValue(undefined) } as unknown as SiloFeedService,
  );
  const as = <T>(work: () => Promise<T>) => cls.run(async () => { cls.set(FARM_SCOPE_KEY, SCOPE); return work(); });
  const inserts = (table: unknown) => log.filter((e) => e.op === 'insert' && e.table === table).map((e) => e.values);
  const updateOf = (table: unknown) => log.find((e) => e.op === 'update' && e.table === table)?.set;
  const updatesOf = (table: unknown) => log.filter((e) => e.op === 'update' && e.table === table).map((e) => e.set);
  return { service, as, log, inserts, updateOf, updatesOf, ledger };
}

describe('postShipment — partial events against a DRAFT order', () => {
  it('posts a partial shipment with the line identity copied to the event', async () => {
    const { service, as, inserts } = setup(baseQueues());
    const result = await as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(result.shipment_no).toMatch(/^SH-\d{4}-0001$/);
    expect(result.lines).toEqual([{ line_id: 'line-1', qty_shipped: 4 }]);
    expect(inserts(schema.transferShipmentLine)[0]).toMatchObject({ quantity: '4', lot_no: 'LOT-9', serial_no: null });
    expect(inserts(schema.transferShipment)[0].status).toBe('POSTED');
  });

  it('refuses an over-shipment beyond the ordered quantity', async () => {
    const { service, as } = setup(baseQueues());
    await expect(as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 11 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Shipment quantity exceeds the remaining balance to ship.');
  });

  it('counts prior events: a second shipment beyond the balance is refused', async () => {
    const queues = baseQueues();
    // The cumulative-shipped join reads transferShipmentLine AFTER
    // loadForMutation's line read; {line_id, qty} is the join's projection
    // shape, not the raw line row.
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '10' }]]);
    const { service, as } = setup(queues);
    await expect(as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 1 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Shipment quantity exceeds the remaining balance to ship.');
  });

  it('refuses an unknown transfer line', async () => {
    const { service, as } = setup(baseQueues());
    await expect(as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-x', quantity: 1 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('is not part of TR-2026-0001');
  });
});

describe('postReceipt — bound to its shipment', () => {
  /** Read order: loadForMutation, warehouses ×2, shipment header, shipped-join,
   *  received-join, shipment's own lines. */
  function receiptQueues(): Map<unknown, unknown[][]> {
    const queues = baseQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [
      [{ line_id: 'line-1', qty: '6' }],   // shippedQuantities join
      [{ ...SHIPMENT_LINE }],              // the shipment's own lines
    ]);
    queues.set(schema.transferReceiptLine, [[]]); // receivedQuantities join: nothing received yet
    return queues;
  }

  it('receives part of what shipped and copies identity from the shipment line', async () => {
    const { service, as, inserts } = setup(receiptQueues());
    const result = await as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(result.receipt_no).toMatch(/^RC-\d{4}-0001$/);
    expect(inserts(schema.transferReceiptLine)[0]).toMatchObject({ quantity: '4', lot_no: 'LOT-9', shipment_line_id: 'sl-1' });
  });

  it('refuses a receipt of more than shipped (over-receipt)', async () => {
    const { service, as } = setup(receiptQueues());
    await expect(as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 7 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Receipt quantity exceeds the remaining quantity to receive.');
  });

  it('refuses a receipt naming a line the shipment never carried (receipt before shipment)', async () => {
    const queues = receiptQueues();
    // The transfer carries a second line that the shipment did not.
    queues.set(schema.stockTransferLine, [[{ ...LINE }, { ...LINE, line_id: 'line-2', line_no: 2 }]]);
    const { service, as } = setup(queues);
    await expect(as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-2', quantity: 1 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('a receipt cannot precede its shipment');
  });

  it('refuses a shipment that does not belong to the transfer', async () => {
    const { service, as } = setup(baseQueues());
    await expect(as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-other', lines: [{ line_id: 'line-1', quantity: 1 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow(NotFoundException);
  });

  /**
   * Fix round 1, Important 1 (second instance): the over-receipt bound here
   * compares input.quantity against alreadyShipped - alreadyReceived with NO
   * tolerance, while its sibling bound three lines below it (against the
   * shipment's own remaining value) already carries +1e-9. shippedByLine sums
   * two real shipment events (0.6 + 0.7 = 1.2999999999999998 in IEEE754) —
   * closing the order's last 0.7 then fails this bound even though nothing
   * was actually over-received. This is the exact scenario the brief names
   * (ordered 1.3, shipped 0.6+0.7, received 0.6+0.7 → POSTED) and it 400s
   * here before transferStatusFor ever runs, so the status-tolerance fix
   * alone cannot deliver that live outcome without this one too.
   */
  it('a float-summed shipment (0.6+0.7) does not refuse the receipt that closes it (ordered 1.3)', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransferLine, [[{ ...LINE, quantity: '1.3' }]]);
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [
      [{ line_id: 'line-1', qty: '0.6' }, { line_id: 'line-1', qty: '0.7' }], // shippedQuantities: 1.2999999999999998
      [{ ...SHIPMENT_LINE, quantity: '0.7' }],                                 // this shipment carried 0.7
    ]);
    queues.set(schema.transferReceiptLine, [
      [{ line_id: 'line-1', qty: '0.6' }], // receivedQuantities: 0.6 already received
      [],                                   // nothing received against THIS shipment yet
    ]);
    const { service, as } = setup(queues);
    const result = await as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 0.7 }],
    }, 'tenant-1', ADMIN));
    expect(result.lines).toEqual([{ line_id: 'line-1', qty_received: 0.7 }]);
  });
});

describe('postDirectTransfer — one shipment plus its matching receipt', () => {
  /**
   * Direct transfer runs shipment then receipt in ONE transaction, and every
   * nested call re-reads the model: loadForMutation, warehouses, silo guard,
   * the cumulative joins, nextEventNo. Pops per table for the whole flow:
   *   stockTransfer / stockTransferLine ×4 (three loadForMutation + findOne)
   *   locationMaster ×8 (3 + 3 + 2 — postReceipt has no silo guard)
   *   transferShipmentLine: outer join, postShipment's join, postReceipt's
   *     join, the shipment's own lines, then the POSTED recount — the fourth
   *     is fed by read-your-writes (the shipment line insert pushes back).
   *   transferReceiptLine: outer join, postReceipt's join, the recount.
   * `qty` is the staged event quantity; it must match what the nested calls
   * ship so the receipt's bounds hold.
   */
  function directQueues(qty: string): Map<unknown, unknown[][]> {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER }], [{ ...TRANSFER }], [{ ...TRANSFER }], [{ ...TRANSFER }]]);
    queues.set(schema.stockTransferLine, [[{ ...LINE }], [{ ...LINE }], [{ ...LINE }], [{ ...LINE }]]);
    queues.set(schema.locationMaster, [...LOCATIONS.map((l) => [...l]), ...LOCATIONS.map((l) => [...l]), LOCATIONS[0], LOCATIONS[1]]);
    queues.set(schema.transferShipment, [[]]);
    queues.set(schema.transferShipmentLine, [
      [],                                       // outer shippedQuantities
      [],                                       // postShipment's shippedQuantities
      [{ line_id: 'line-1', qty }],             // postReceipt's shippedQuantities
      [{ ...SHIPMENT_LINE, quantity: qty }],    // the shipment's own lines
      // the POSTED recount is fed by the insert push-back
    ]);
    queues.set(schema.transferReceipt, [[]]);
    queues.set(schema.transferReceiptLine, [
      [],                                       // outer receivedQuantities
      [],                                       // postReceipt's receivedQuantities
      // the POSTED recount is fed by the insert push-back
    ]);
    return queues;
  }

  it('writes both events and leaves the order open when coverage is partial', async () => {
    const { service, as, inserts, updatesOf, ledger } = setup(directQueues('4'));
    const result = await as(() => service.postDirectTransfer('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(result).toMatchObject({ transfer_id: 'tr-1' });
    expect(inserts(schema.transferShipment)).toHaveLength(1);
    expect(inserts(schema.transferReceipt)).toHaveLength(1);
    expect(inserts(schema.transferReceiptLine)[0]).toMatchObject({ quantity: '4', lot_no: 'LOT-9' });
    // 4 of 10 shipped and received: the order stays open for further events
    // (Part E Task 4b) — IN_TRANSIT after the shipment, PARTIALLY_RECEIVED
    // after the receipt, never POSTED and never stamped.
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['IN_TRANSIT', 'PARTIALLY_RECEIVED']);
    expect(updatesOf(schema.stockTransfer).some((u) => 'posted_at' in u)).toBe(false);
    // One leg per event: 4 out of the source at the shipment, 4 into the
    // destination at the receipt — never both legs twice.
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferShipment).toHaveBeenCalledWith(expect.objectContaining({ fromWarehouseId: 'wh-store', quantity: 4 }));
    expect(ledger.writeTransferReceipt).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ toWarehouseId: 'wh-farm', quantity: 4, rate: 2.5 }));
  });

  it('posts the legacy empty-lines payload as every line at full quantity and claims POSTED', async () => {
    const { service, as, updatesOf } = setup(directQueues('10'));
    await as(() => service.postDirectTransfer('tr-1', {
      posting_date: '2026-10-02', lines: [],
    }, 'tenant-1', ADMIN));
    const updates = updatesOf(schema.stockTransfer);
    expect(updates.map((u) => u.status)).toEqual(['IN_TRANSIT', 'POSTED']);
    expect(updates[1]).toMatchObject({ posted_by: 'u-admin', posted_at: expect.any(String) });
  });
});

describe('Part E Task 4 — one ledger leg per event (cp. 46: received KG posted once)', () => {
  it('a shipment takes the quantity out of the source only', async () => {
    const { service, as, ledger } = setup(baseQueues());
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 6 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferReceipt).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferShipment).toHaveBeenCalledWith(expect.objectContaining({ fromWarehouseId: 'wh-store', quantity: 6, documentLineId: 'line-1', lotNo: 'LOT-9' }));
  });

  it('a receipt puts the quantity into the destination only, at the shipment rate', async () => {
    const queues = baseQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[]]);
    const { service, as, ledger } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
    expect(ledger.transferShipmentRate).toHaveBeenCalledWith({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1' });
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ toWarehouseId: 'wh-farm', quantity: 4, rate: 2.5, lotNo: 'LOT-9', amount: undefined }));
    // 4 of the shipment's 6: not the closing receipt, so no remaining-value read.
    expect(ledger.transferShipmentRemainingValue).not.toHaveBeenCalled();
  });
});

describe('Part E Task 4 fix round 1 — a receipt is bounded by its own shipment', () => {
  /** Two shipments on line-1: SH-1 carried 4 (this one), SH-2 carried 6. */
  function twoShipmentQueues(priorOnSh1: Array<{ shipment_line_id: string; qty: string; receipt_no: string }> = []) {
    const queues = baseQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [
      [{ line_id: 'line-1', qty: '4' }, { line_id: 'line-1', qty: '6' }], // shippedQuantities: 10 on the line
      [{ ...SHIPMENT_LINE, quantity: '4' }],                               // SH-1's own lines
    ]);
    const priorOnLine = priorOnSh1.map((r) => ({ line_id: 'line-1', qty: r.qty }));
    queues.set(schema.transferReceiptLine, [priorOnLine, priorOnSh1]); // receivedQuantities, receivedAgainstShipment
    return queues;
  }

  it('refuses 10 against SH-1 although the line has shipped 10 in all', async () => {
    const { service, as, ledger, inserts } = setup(twoShipmentQueues());
    await expect(as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 10 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Receipt quantity exceeds what shipment SH-2026-0001 has left to receive on this line (4).');
    expect(ledger.writeTransferReceipt).not.toHaveBeenCalled();
    expect(inserts(schema.transferReceiptLine)).toHaveLength(0);
  });

  it('accepts 4 against SH-1, and as the closing receipt values it at the line\'s remaining value', async () => {
    const { service, as, ledger } = setup(twoShipmentQueues());
    await as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(ledger.transferShipmentRemainingValue).toHaveBeenCalledWith({ tenantId: 'tenant-1', shipmentNo: 'SH-2026-0001', lineId: 'line-1', receiptNos: [] });
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ quantity: 4, amount: 15 }));
  });

  it('counts receipts already posted against the same shipment line', async () => {
    const prior = [{ shipment_line_id: 'sl-1', qty: '3', receipt_no: 'RC-2026-0001' }];
    const refused = setup(twoShipmentQueues(prior));
    await expect(refused.as(() => refused.service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 2 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('has left to receive on this line (1).');

    const closing = setup(twoShipmentQueues(prior));
    await closing.as(() => closing.service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 1 }],
    }, 'tenant-1', ADMIN));
    expect(closing.ledger.transferShipmentRemainingValue).toHaveBeenCalledWith(expect.objectContaining({ receiptNos: ['RC-2026-0001'] }));
  });
});

describe('Part E Task 4 fix round 1 — one event names a line once', () => {
  it('refuses a shipment that repeats a line id, before writing anything', async () => {
    const { service, as, inserts, ledger } = setup(baseQueues());
    await expect(as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 6 }, { line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Line line-1 appears more than once in this shipment');
    expect(inserts(schema.transferShipment)).toHaveLength(0);
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
  });

  it('refuses a receipt that repeats a line id, before writing anything', async () => {
    const queues = baseQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[], []]);
    const { service, as, inserts, ledger } = setup(queues);
    await expect(as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }, { line_id: 'line-1', quantity: 2 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('Line line-1 appears more than once in this receipt');
    expect(inserts(schema.transferReceipt)).toHaveLength(0);
    expect(ledger.writeTransferReceipt).not.toHaveBeenCalled();
  });
});

/**
 * Part E Task 4b, requirement 1: the transfer's status follows its events,
 * written in the same transaction as each event. Before this only
 * postDirectTransfer set POSTED, and a transfer moved through /shipment and
 * /receipt stayed DRAFT (TR-000010, TR-000014 on nf_devco).
 */
describe('Part E Task 4b — status follows the events', () => {
  it('the first shipment moves a DRAFT to IN_TRANSIT, unstamped', async () => {
    const { service, as, updatesOf } = setup(baseQueues());
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 6 }] }, 'tenant-1', ADMIN));
    const updates = updatesOf(schema.stockTransfer);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'IN_TRANSIT', updated_by: 'u-admin' });
    expect(updates[0].posted_at).toBeUndefined();
  });

  it('a further shipment on an IN_TRANSIT transfer is accepted, not refused as "already IN_TRANSIT"', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'IN_TRANSIT' }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }]]);
    const { service, as, updatesOf, ledger } = setup(queues);
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['IN_TRANSIT']);
  });

  it('a shipment after a receipt keeps the transfer PARTIALLY_RECEIVED', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'PARTIALLY_RECEIVED' }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }]]);
    queues.set(schema.transferReceiptLine, [[{ line_id: 'line-1', qty: '4' }]]);
    const { service, as, updatesOf } = setup(queues);
    await as(() => service.postShipment('tr-1', { posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 2 }] }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.stockTransfer).map((u) => u.status)).toEqual(['PARTIALLY_RECEIVED']);
  });

  it('a receipt of part of what shipped moves IN_TRANSIT to PARTIALLY_RECEIVED (ordered 10, shipped 6, received 4)', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'IN_TRANSIT' }]]);
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '6' }], [{ ...SHIPMENT_LINE }]]);
    queues.set(schema.transferReceiptLine, [[], []]);
    const { service, as, updatesOf } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    const updates = updatesOf(schema.stockTransfer);
    expect(updates.map((u) => u.status)).toEqual(['PARTIALLY_RECEIVED']);
    expect(updates[0].posted_at).toBeUndefined();
  });

  it('the receipt that completes every line claims POSTED with the direct-transfer stamping', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'PARTIALLY_RECEIVED' }]]);
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [[{ line_id: 'line-1', qty: '10' }], [{ ...SHIPMENT_LINE, quantity: '10' }]]);
    queues.set(schema.transferReceiptLine, [
      [{ line_id: 'line-1', qty: '6' }],                                       // receivedQuantities
      [{ shipment_line_id: 'sl-1', qty: '6', receipt_no: 'RC-2026-0001' }],    // receivedAgainstShipment
    ]);
    const { service, as, updatesOf } = setup(queues);
    await as(() => service.postReceipt('tr-1', { posting_date: '2026-10-04', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    const updates = updatesOf(schema.stockTransfer);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'POSTED', posted_by: 'u-admin', posted_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) });
  });

  it('refuses a shipment or a receipt against a POSTED transfer', async () => {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status: 'POSTED' }], [{ ...TRANSFER, status: 'POSTED' }]]);
    queues.set(schema.stockTransferLine, [[{ ...LINE }], [{ ...LINE }]]);
    const { service, as, ledger } = setup(queues);
    await expect(as(() => service.postShipment('tr-1', { posting_date: '2026-10-03', lines: [{ line_id: 'line-1', quantity: 1 }] }, 'tenant-1', ADMIN)))
      .rejects.toThrow('already POSTED');
    await expect(as(() => service.postReceipt('tr-1', { posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 1 }] }, 'tenant-1', ADMIN)))
      .rejects.toThrow('already POSTED');
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
    expect(ledger.writeTransferReceipt).not.toHaveBeenCalled();
  });
});

/**
 * Part E Task 4b, requirement 2: once stock has moved, the order is fixed.
 * Before, update() (assertDraft only) replaced the lines with new ids —
 * orphaning shipment/receipt lines — or changed the destination after the
 * stock had left, and remove() cancelled a transfer whose stock sat in In
 * Transit with no reversal. A DRAFT row that already has a shipment (written
 * before requirement 1) must be refused too, so the guard reads the events,
 * not only the status.
 */
describe('Part E Task 4b — no edit, cancel or one-step post once stock has shipped', () => {
  function shippedQueues(status: string) {
    const queues = baseQueues();
    queues.set(schema.stockTransfer, [[{ ...TRANSFER, status }]]);
    queues.set(schema.transferShipment, [[{ shipment_no: 'SH-2026-0001' }]]);
    return queues;
  }

  it.each(['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'])('update() refuses a %s transfer that has a shipment, writing nothing', async (status) => {
    const { service, as, log } = setup(shippedQueues(status));
    await expect(as(() => service.update('tr-1', { to_warehouse_id: 'wh-other', lines: [{ item_id: 'item-1', quantity: 1, uom: 'EA' }] } as any, 'tenant-1', ADMIN)))
      .rejects.toThrow('Stock Transfer TR-2026-0001 cannot be edited — stock has already shipped on SH-2026-0001.');
    expect(log.filter((e) => e.op === 'update' || e.op === 'insert')).toHaveLength(0);
  });

  it.each(['DRAFT', 'IN_TRANSIT', 'PARTIALLY_RECEIVED'])('remove() refuses a %s transfer that has a shipment, writing nothing', async (status) => {
    const { service, as, log } = setup(shippedQueues(status));
    await expect(as(() => service.remove('tr-1', 'tenant-1', ADMIN)))
      .rejects.toThrow('Stock Transfer TR-2026-0001 cannot be cancelled — stock has already shipped on SH-2026-0001.');
    expect(log.filter((e) => e.op === 'update' || e.op === 'insert')).toHaveLength(0);
  });

  it('the refusals are 400s', async () => {
    const { service, as } = setup(shippedQueues('IN_TRANSIT'));
    await expect(as(() => service.remove('tr-1', 'tenant-1', ADMIN))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('post() (the one-step whole-order post) refuses a DRAFT that already has a shipment, with a clear message', async () => {
    const { service, as, ledger } = setup(shippedQueues('DRAFT'));
    await expect(as(() => service.post('tr-1', 'tenant-1', ADMIN)))
      .rejects.toThrow('Stock Transfer TR-2026-0001 cannot be posted in one step — it already has shipment SH-2026-0001.');
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
  });

  it('post() refuses a transfer that is no longer DRAFT', async () => {
    const { service, as, ledger } = setup(shippedQueues('PARTIALLY_RECEIVED'));
    await expect(as(() => service.post('tr-1', 'tenant-1', ADMIN)))
      .rejects.toThrow('Stock Transfer TR-2026-0001 cannot be posted in one step — it is already PARTIALLY_RECEIVED.');
    expect(ledger.writeTransferShipment).not.toHaveBeenCalled();
  });

  it('a partial Direct Transfer naming its lines is still allowed on an open transfer (decisions.md 1 Oct)', async () => {
    const queues = baseQueues();
    const open = { ...TRANSFER, status: 'IN_TRANSIT' };
    queues.set(schema.stockTransfer, [[open], [open], [{ ...open }], [{ ...open }]]);
    queues.set(schema.stockTransferLine, [[{ ...LINE }], [{ ...LINE }], [{ ...LINE }], [{ ...LINE }]]);
    queues.set(schema.locationMaster, [...LOCATIONS.map((l) => [...l]), ...LOCATIONS.map((l) => [...l]), LOCATIONS[0], LOCATIONS[1]]);
    queues.set(schema.transferShipmentLine, [
      [{ line_id: 'line-1', qty: '6' }],                                   // outer shipped
      [{ line_id: 'line-1', qty: '6' }],                                   // postShipment's shipped
      [{ line_id: 'line-1', qty: '6' }, { line_id: 'line-1', qty: '4' }],  // postReceipt's shipped
      [{ ...SHIPMENT_LINE, shipment_id: 'new', quantity: '4' }],          // the new shipment's lines
    ]);
    const { service, as, ledger } = setup(queues);
    await as(() => service.postDirectTransfer('tr-1', { posting_date: '2026-10-04', lines: [{ line_id: 'line-1', quantity: 4 }] }, 'tenant-1', ADMIN));
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferReceipt).toHaveBeenCalledTimes(1);
  });
});

describe('Part E Task 7 — a linked requisition follows the transfer events', () => {
  /** Read order after the usual shipment reads: linked requisition, shipped-
   *  by-requisition-line, received-by-requisition-line, the requisition's own
   *  lines. The first transferShipmentLine/transferReceiptLine entry in each
   *  queue is still postShipment's own shippedQuantities/receivedQuantities
   *  call; the second is syncRequisitionFulfilment's own query on the same
   *  table. */
  function withRequisitionQueues(): Map<unknown, unknown[][]> {
    const queues = baseQueues();
    queues.set(schema.requisition, [[{ requisition_id: 'req-1' }]]);
    queues.set(schema.transferShipmentLine, [[], [{ requisition_line_id: 'r1', qty: '6' }]]);
    queues.set(schema.transferReceiptLine, [[], [{ requisition_line_id: 'r1', qty: '4' }]]);
    queues.set(schema.requisitionLine, [[{ line_id: 'r1', quantity: '10', qty_to_ship: '10', qty_to_receive: '10' }]]);
    return queues;
  }

  it('writes the linked requisition line and header after a shipment posts', async () => {
    const { service, as, updateOf, updatesOf } = setup(withRequisitionQueues());
    await as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.requisitionLine)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(updateOf(schema.requisition)).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  it('writes the linked requisition line and header after a receipt posts too', async () => {
    const queues = withRequisitionQueues();
    queues.set(schema.transferShipment, [[{ ...SHIPMENT }]]);
    queues.set(schema.transferShipmentLine, [
      [{ line_id: 'line-1', qty: '6' }],                  // shippedQuantities join
      [{ ...SHIPMENT_LINE }],                              // the shipment's own lines
      [{ requisition_line_id: 'r1', qty: '6' }],           // sync's own shipped-by-requisition-line query
    ]);
    queues.set(schema.transferReceiptLine, [
      [],                                                  // receivedQuantities join: nothing received yet
      [],                                                  // receivedAgainstShipment: nothing against this shipment yet
      [{ requisition_line_id: 'r1', qty: '4' }],            // sync's own received-by-requisition-line query
    ]);
    const { service, as, updateOf, updatesOf } = setup(queues);
    await as(() => service.postReceipt('tr-1', {
      posting_date: '2026-10-03', shipment_id: 'sh-1', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(updatesOf(schema.requisitionLine)).toEqual([{ qty_shipped: '6', qty_received: '4' }]);
    expect(updateOf(schema.requisition)).toEqual({ fulfilment_status: 'PARTIALLY_RECEIVED' });
  });

  /**
   * Ownership guard: a stock_transfer_line.requisition_line_id that does not
   * belong to the requisition linked to this transfer must refuse rather than
   * silently drop. The throw happens inside postShipment's own
   * withTenantTransaction callback (this.db is the open tx, confirmed by
   * reading drizzle-orm's mysql2 session.js: `transaction()` wraps the
   * callback in BEGIN/COMMIT and issues ROLLBACK from its catch block before
   * rethrowing — node_modules/drizzle-orm/mysql2/session.js, the version
   * pinned by this repo's lockfile), so the whole shipment (its ledger
   * entries and status update included) rolls back with it rather than the
   * event posting while the requisition's own bookkeeping silently misses it.
   */
  it('refuses a shipment whose transfer line carries another requisition\'s line id', async () => {
    const queues = withRequisitionQueues();
    queues.set(schema.transferShipmentLine, [[], [{ requisition_line_id: 'line-of-another-requisition', qty: '6' }]]);
    const { service, as } = setup(queues);
    await expect(as(() => service.postShipment('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN))).rejects.toThrow('does not belong to requisition req-1');
  });
});
