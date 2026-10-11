import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedConsolidationService } from './feed-consolidation.service';
import { FeedLoadingService } from './feed-loading.service';

// W4G1: the call sites that raise MILL_DISPATCH (Req. rows 74–76), MILL_ADJUSTED (row 126) and CAPACITY_EXCEEDED (checkpoint 34).
const makeDb = (queue: unknown[][]) => {
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  return { select: jest.fn(() => chain(queue.shift() ?? [])), insert: jest.fn(), update: jest.fn(() => ({ set: () => ({ where: async () => undefined }) })) } as any;
};
const alerts = () => ({ raiseEvent: jest.fn(async () => ({ rules: 1, raised: 1 })), raiseEventSafely: jest.fn(async () => undefined), resolveEvent: jest.fn(async () => undefined) });

describe('MILL_DISPATCH on dispatch', () => {
  const sheet = {
    loading_sheet_id: 'ls-1', loading_sheet_no: 'LOAD-REQ-1-10000', tenant_id: 't-1', company_id: 'co-1', consolidation_line_id: 'cl-1', requisition_id: 'req-1',
    requisition_line_id: 'rl-1', farm_id: 'farm-1', destination_silo_id: null, item_id: 'item-8', mill_loading_bin_id: null, compartment_no: 'C2', kg_loaded: '6000.0000',
    loaded_by: 'Loader', shipment_id: 'sh-1', status: 'LOADED',
  };
  const reads = () => [[sheet], [sheet], [{ id: 'farm-1', code: 'MUL100', name: 'Mulberry' }], [{ id: 'item-8', code: 'ITM-8', name: 'Weaner Grower Mash', diet_no: 8 }], [{ id: 'req-1', no: 'REQ-1' }], [], [], []];

  it('tells the destination farm the diet, KG and compartment', async () => {
    const a = alerts();
    const service = new FeedLoadingService(transactionCls(makeDb(reads())), a as any);
    await service.dispatch('ls-1', 't-1');
    expect(a.raiseEventSafely).toHaveBeenCalledTimes(1);
    const [ctx, input] = a.raiseEventSafely.mock.calls[0] as any[];
    expect(ctx).toEqual({ farmId: 'farm-1', companyId: 'co-1', tenantId: 't-1' });
    expect(input).toMatchObject({ eventType: 'MILL_DISPATCH', subjectType: 'LOADING_SHEET', subjectId: 'ls-1' });
    expect(input.message).toContain('diet 8 (Weaner Grower Mash)');
    expect(input.message).toContain('6,000 KG');
    expect(input.message).toContain('compartment C2');
  });
  it('raises nothing for a sheet already dispatched (dedupe at the source)', async () => {
    const a = alerts();
    const service = new FeedLoadingService(transactionCls(makeDb([[{ ...sheet, status: 'DISPATCHED' }], ...reads().slice(1)])), a as any);
    await service.dispatch('ls-1', 't-1');
    expect(a.raiseEventSafely).not.toHaveBeenCalled();
  });
});

const FORECAST = { listFarms: jest.fn(async () => [{ farmId: 'farm-1', companyId: 'co-1' }]) };

describe('MILL_ADJUSTED on finalize', () => {
  const header = { consolidation_id: 'cons-1', consolidation_no: 'CONS-1', status: 'DRAFT', company_id: 'co-1' };
  const finalizeWith = async (lines: unknown[]) => {
    const a = alerts();
    const service = new FeedConsolidationService(transactionCls(makeDb([[header], lines])), FORECAST as any, {} as any, undefined, a as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
    await service.finalize('cons-1', 't-1', {});
    return a;
  };
  it('tells a farm whose line the mill approved at a different KG, with the reason, and not a farm that matches', async () => {
    const a = await finalizeWith([
      { farm_id: 'farm-1', item_code: 'ITM-8', requested: '6050.0000', approved: '6000.0000', reason: 'Mill capacity' },
      { farm_id: 'farm-2', item_code: 'ITM-8', requested: '3000.0000', approved: '3000.0000', reason: null },
    ]);
    expect(a.raiseEvent).toHaveBeenCalledTimes(1);
    const [ctx, input] = a.raiseEvent.mock.calls[0] as any[];
    expect(ctx).toEqual({ farmId: 'farm-1', companyId: 'co-1', tenantId: 't-1' });
    expect(input).toMatchObject({ eventType: 'MILL_ADJUSTED', subjectType: 'CONSOLIDATION', subjectId: 'cons-1', dedupSuffix: 'cons-1|farm-1' });
    expect(input.message).toContain('asked 6,050 KG, mill approved 6,000 KG (Mill capacity)');
  });
  it('raises nothing when every line was approved as asked', async () => {
    expect((await finalizeWith([{ farm_id: 'farm-1', item_code: 'ITM-8', requested: '100', approved: '100', reason: null }])).raiseEvent).not.toHaveBeenCalled();
  });
});

describe('CAPACITY_EXCEEDED on the capacity check', () => {
  const header = { consolidation_id: 'cons-1', consolidation_no: 'CONS-1', status: 'DRAFT', company_id: 'co-1' };
  const lines = [{ item_id: 'item-8', item_code: 'ITM-8', farm_id: 'farm-1', production_date: '2026-10-11', requested_delivery_date: '2026-10-12', mill_approved_qty_kg: '9000' }];
  const run = async (report: { checked: any[]; breaches: any[] }) => {
    const a = alerts();
    const millCapacity = { assertConsolidationWithinCapacity: jest.fn(async (...args: any[]) => { await args[4](report); }) };
    const service = new FeedConsolidationService(transactionCls(makeDb([[header], lines, []])), FORECAST as any, {} as any, millCapacity as any, a as any);
    jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
    await service.finalize('cons-1', 't-1', {});
    return a;
  };
  it('raises for each farm asking for the breached diet on that day', async () => {
    const a = await run({ checked: [{ date: '2026-10-11', itemId: 'item-8' }], breaches: [{ date: '2026-10-11', itemId: 'item-8', itemCode: 'ITM-8', demandKg: 9000, availableKg: 6000 }] });
    expect(a.raiseEvent).toHaveBeenCalledTimes(1);
    const [ctx, input] = a.raiseEvent.mock.calls[0] as any[];
    expect(ctx.farmId).toBe('farm-1');
    expect(input).toMatchObject({ eventType: 'CAPACITY_EXCEEDED', subjectType: 'DIET_DATE', dedupSuffix: 'item-8|2026-10-11' });
    expect(a.resolveEvent).toHaveBeenCalledWith({ companyId: 'co-1', tenantId: 't-1' }, 'CAPACITY_EXCEEDED', []);
  });
  it('resolves the diet and day that now fit', async () => {
    const a = await run({ checked: [{ date: '2026-10-11', itemId: 'item-8' }], breaches: [] });
    expect(a.raiseEvent).not.toHaveBeenCalled();
    expect(a.resolveEvent).toHaveBeenCalledWith({ companyId: 'co-1', tenantId: 't-1' }, 'CAPACITY_EXCEEDED', ['item-8|2026-10-11']);
  });
  it('never fails the check because an alert could not be written; the refusal still stands', async () => {
    const a = alerts();
    a.resolveEvent.mockRejectedValueOnce(new Error('db down'));
    const millCapacity = { assertConsolidationWithinCapacity: jest.fn(async (...args: any[]) => { await args[4]({ checked: [{ date: 'd', itemId: 'i' }], breaches: [] }); throw new ConflictException('Mill capacity exceeded'); }) };
    const service = new FeedConsolidationService(transactionCls(makeDb([[header], lines])), FORECAST as any, {} as any, millCapacity as any, a as any);
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    await expect(service.finalize('cons-1', 't-1', {})).rejects.toThrow('Mill capacity exceeded');
  });
});
