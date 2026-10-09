import { ForbiddenException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedRequisitionService } from './feed-requisition.service';

function harness(queues: unknown[][]) {
  const inserted: Array<{ table: unknown; values: any }> = [];
  const updated: Array<{ table: unknown; values: any }> = [];
  const locks: unknown[] = [];
  const select = jest.fn(() => {
    const result = queues.shift() ?? [];
    const chain: any = {};
    for (const method of ['from', 'innerJoin', 'leftJoin', 'where', 'limit', 'orderBy', 'groupBy']) chain[method] = () => chain;
    chain.for = (mode: unknown) => { locks.push(mode); return chain; };
    chain.then = (ok: any, fail: any) => Promise.resolve(result).then(ok, fail);
    return chain;
  });
  const db: any = {
    select,
    insert: jest.fn((table: unknown) => ({ values: jest.fn(async (values: any) => { inserted.push({ table, values }); }) })),
    update: jest.fn((table: unknown) => ({ set: jest.fn((values: any) => {
      updated.push({ table, values });
      return { where: jest.fn(async () => [{ affectedRows: 1 }]) };
    }) })),
  };
  db.transaction = async (work: (tx: unknown) => Promise<unknown>) => work(db);
  const cls = transactionCls(db);
  const forecast = { withFarmScope: jest.fn((_farm: string, _company: string, work: () => unknown) => work()) };
  const stockTransfers = { createForFeedRelease: jest.fn()
    .mockResolvedValueOnce({ transfer_id: 'tr-1', transfer_no: 'TR-000001' })
    .mockResolvedValueOnce({ transfer_id: 'tr-2', transfer_no: 'TR-000002' }) };
  const service = new FeedRequisitionService(
    cls, forecast as any, { registerDocumentHandler: jest.fn() } as any, {} as any, {} as any, {} as any, {} as any, stockTransfers as any,
  );
  jest.spyOn(service as any, 'resolveOwnFarm').mockResolvedValue({ farmId: 'farm-1', companyId: 'co-1' });
  jest.spyOn(service as any, 'assertMayDecide').mockResolvedValue(undefined);
  jest.spyOn(service as any, 'readView').mockResolvedValue({ requisition_id: 'req-1', document_status: 'RELEASED' });
  return { service, stockTransfers, inserted, updated, locks };
}

const approved = {
  requisition_id: 'req-1', tenant_id: 'tenant-1', company_id: 'co-1', farm_id: 'farm-1', main_location_id: 'farm-1',
  req_no: 'REQ-GRA100-2026-00001', doc_type: 'FEED', status: 'APPROVED', approval_status: 'APPROVED',
  document_status: 'OPEN', fulfilment_status: 'NOT_APPLICABLE', production_date: '2026-10-10', feed_consolidation_id: 'cons-1', deleted_at: null,
};

describe('FeedRequisitionService.release', () => {
  it('locks Approved/Open, resolves exact-date assignments, creates every group and links them atomically', async () => {
    const { service, stockTransfers, inserted, updated, locks } = harness([
      [approved],                                                                 // locked requisition
      [{ status: 'CONSOLIDATED', consolidation_no: 'CONS-2026-W41-001' }],          // finalized mill consolidation
      [],                                                                         // no existing links
      [                                                                            // requisition lines
        { line_id: 'line-1', item_id: 'feed-a', item_code: 'FEED-A', destination_location_id: 'silo-1', quantity: '5000', mill_approved_qty_kg: '5000' },
        { line_id: 'line-2', item_id: 'feed-b', item_code: 'FEED-B', destination_location_id: 'silo-2', quantity: '3000', mill_approved_qty_kg: '3000' },
      ],
      [                                                                            // exact-date active assignments
        { assignment_id: 'as-1', feed_item_id: 'feed-a', production_date: '2026-10-10', bin_location_id: 'bin-1', production_slot_id: 'slot-1' },
        { assignment_id: 'as-2', feed_item_id: 'feed-b', production_date: '2026-10-10', bin_location_id: 'bin-2', production_slot_id: 'slot-1' },
      ],
      [                                                                            // destination SILOs
        { location_id: 'silo-1', location_type: 'SILO', farm_id: 'farm-1', parent_location_id: 'farm-1', is_active: true, status: 'ACTIVE', deleted_at: null },
        { location_id: 'silo-2', location_type: 'SILO', farm_id: 'farm-1', parent_location_id: 'farm-1', is_active: true, status: 'ACTIVE', deleted_at: null },
      ],
    ]);

    await service.release('req-1', 'tenant-1', { userId: 'u-1', userType: 'COMPANY_ADMIN' });

    expect(locks).toContain('update');
    expect(stockTransfers.createForFeedRelease).toHaveBeenCalledTimes(2);
    expect(stockTransfers.createForFeedRelease).toHaveBeenNthCalledWith(1, expect.objectContaining({
      from_warehouse_id: 'bin-1', to_warehouse_id: 'silo-1',
      lines: [{ item_id: 'feed-a', quantity: 5000, uom: 'KG', requisition_line_id: 'line-1' }],
    }), 'tenant-1', expect.objectContaining({ userId: 'u-1' }));
    expect(inserted).toHaveLength(2);
    expect(updated.at(-1)?.values).toEqual(expect.objectContaining({ document_status: 'RELEASED', fulfilment_status: 'TRANSFER_OPEN' }));
  });

  it('requires requisition approval permission before locking or writing', async () => {
    const { service, stockTransfers } = harness([]);
    jest.spyOn(service as any, 'assertMayDecide').mockRejectedValue(new ForbiddenException('not allowed'));
    await expect(service.release('req-1', 'tenant-1', { userId: 'u-1' })).rejects.toThrow('not allowed');
    expect(stockTransfers.createForFeedRelease).not.toHaveBeenCalled();
  });

  it('returns the released view without creating duplicates when a concurrent caller already released it', async () => {
    const { service, stockTransfers } = harness([[{ ...approved, document_status: 'RELEASED', fulfilment_status: 'TRANSFER_OPEN' }]]);
    await expect(service.release('req-1', 'tenant-1', { userId: 'u-1' })).resolves.toEqual(expect.objectContaining({ document_status: 'RELEASED' }));
    expect(stockTransfers.createForFeedRelease).not.toHaveBeenCalled();
  });
});
