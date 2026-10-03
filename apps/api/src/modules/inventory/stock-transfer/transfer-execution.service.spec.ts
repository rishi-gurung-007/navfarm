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
import { NotFoundException } from '@nestjs/common';
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
        limit: () => self, offset: () => self, for: () => self,
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
  return { service, as, log, inserts, updateOf, ledger };
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
    const { service, as, inserts, updateOf, ledger } = setup(directQueues('4'));
    const result = await as(() => service.postDirectTransfer('tr-1', {
      posting_date: '2026-10-02', lines: [{ line_id: 'line-1', quantity: 4 }],
    }, 'tenant-1', ADMIN));
    expect(result).toMatchObject({ transfer_id: 'tr-1' });
    expect(inserts(schema.transferShipment)).toHaveLength(1);
    expect(inserts(schema.transferReceipt)).toHaveLength(1);
    expect(inserts(schema.transferReceiptLine)[0]).toMatchObject({ quantity: '4', lot_no: 'LOT-9' });
    // 4 of 10 shipped and received: the order stays a correctable draft for
    // further events — the coverage gate decides, not the event count.
    expect(updateOf(schema.stockTransfer)).toBeUndefined();
    // One leg per event: 4 out of the source at the shipment, 4 into the
    // destination at the receipt — never both legs twice.
    expect(ledger.writeTransferEntries).not.toHaveBeenCalled();
    expect(ledger.writeTransferShipment).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferShipment).toHaveBeenCalledWith(expect.objectContaining({ fromWarehouseId: 'wh-store', quantity: 4 }));
    expect(ledger.writeTransferReceipt).toHaveBeenCalledTimes(1);
    expect(ledger.writeTransferReceipt).toHaveBeenCalledWith(expect.objectContaining({ toWarehouseId: 'wh-farm', quantity: 4, rate: 2.5 }));
  });

  it('posts the legacy empty-lines payload as every line at full quantity and claims POSTED', async () => {
    const { service, as, updateOf } = setup(directQueues('10'));
    await as(() => service.postDirectTransfer('tr-1', {
      posting_date: '2026-10-02', lines: [],
    }, 'tenant-1', ADMIN));
    expect(updateOf(schema.stockTransfer)).toMatchObject({ status: 'POSTED' });
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
