import { BadRequestException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import * as schema from '../../../core/database/schema';
import { BatchService } from './batch.service';

/**
 * D21 (Rishi, 27 Sep): a batch with no shed has its feed drawn from the farm
 * store in the forecast, and only a user can say which shed it really stands
 * in when the data cannot. The shed must be settable on an ACTIVE batch —
 * the only edit path (PUT) is DRAFT-only.
 */
describe('BatchService.changeShed (D21, review A12)', () => {
  function harness(queue: unknown[][]) {
    const updates: Array<{ table: unknown; set: any }> = [];
    const db: any = {
      select: jest.fn(() => {
        const self: any = { from: () => self, where: () => self, limit: async () => queue.shift() ?? [] };
        return self;
      }),
      update: jest.fn((table: unknown) => ({ set: (set: any) => ({ where: async () => { updates.push({ table, set }); } }) })),
    };
    const cls = transactionCls(db);
    const audit = { log: jest.fn(async () => ({})) };
    const service = new BatchService(cls, audit as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
    return { service, updates, audit, cls };
  }
  const batch = { batch_id: 'b1', batch_no: 'BATCH-000012', status: 'ACTIVE', company_id: 'co-1', lob_id: 'lob-pig', farm_id: 'farm-vil', shed_id: null };
  const shed = { location_id: 'shed-3', location_type: 'SHED', company_id: 'co-1', farm_id: 'farm-vil', parent_location_id: 'farm-vil', is_active: true, deleted_at: null };

  it('sets the shed of an ACTIVE batch and records the change', async () => {
    const { service, updates, audit } = harness([[batch], [shed]]);
    await expect(service.changeShed('b1', 'shed-3', 'tenant-1', { userId: 'u1' } as any))
      .resolves.toEqual({ batch_id: 'b1', shed_id: 'shed-3', farm_id: 'farm-vil' });
    expect(updates).toEqual([{ table: schema.batchHeader, set: { shed_id: 'shed-3', farm_id: 'farm-vil', updated_by: 'u1' } }]);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UPDATE', entityName: 'batch_header', entityId: 'b1', oldValues: { shed_id: null }, newValues: { shed_id: 'shed-3' },
    }));
  });

  it('takes the farm from the shed when the batch has none yet', async () => {
    const { service, updates } = harness([[{ ...batch, farm_id: null }], [shed]]);
    await service.changeShed('b1', 'shed-3', 'tenant-1');
    expect(updates[0].set).toMatchObject({ farm_id: 'farm-vil' });
  });

  it('clears the shed', async () => {
    const { service, updates } = harness([[{ ...batch, shed_id: 'shed-3' }]]);
    await service.changeShed('b1', null, 'tenant-1');
    expect(updates[0].set).toMatchObject({ shed_id: null, farm_id: 'farm-vil' });
  });

  it('refuses a shed on another farm, a pen, and a closed batch, writing nothing', async () => {
    for (const [queue, message] of [
      [[[batch], [{ ...shed, farm_id: 'farm-lex', parent_location_id: 'farm-lex' }]], 'That shed is on another farm.'],
      [[[batch], [{ ...shed, location_type: 'PEN' }]], 'Choose an active shed.'],
      [[[batch], [{ ...shed, company_id: 'co-2' }]], 'That shed belongs to another company.'],
      [[[{ ...batch, status: 'CLOSED' }]], 'BATCH-000012 is closed; its shed can no longer be changed.'],
    ] as const) {
      const { service, updates } = harness(queue.map((q) => [...q]));
      await expect(service.changeShed('b1', 'shed-3', 'tenant-1')).rejects.toThrow(new BadRequestException(message));
      expect(updates).toEqual([]);
    }
  });

  it('answers not found for a batch outside the caller\'s farm scope', async () => {
    const { service, cls } = harness([[]]);
    useFarmScope(cls, { farmId: 'farm-lex', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
    await expect(service.changeShed('b1', 'shed-3', 'tenant-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
