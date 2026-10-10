import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedConsolidationService } from './feed-consolidation.service';

// Workbook Requisition and Loading Sheet r122/r125 and Checkpoints and
// Validations r48 (checkpoint 42) on the Mill Consolidation Sheet.
describe('FeedConsolidationService mill capacity', () => {
  const line = {
    requisition_id: 'req-1', req_no: 'REQ-MUL100-2026-00001', requisition_date: '2026-10-10', production_date: '2026-10-11',
    company_id: 'co-1', created_at: '2026-10-10', farm_id: 'farm-1', farm_code: 'MUL100', farm_name: 'Mulberry',
    line_id: 'line-1', item_id: 'item-8', item_code: 'ICAT-004-ITM-0008', item_name: 'Weaner Grower Mash', diet_no: 8,
    quantity: '6050', destination_silo_id: null, proposed_delivery_date: '2026-10-12', feed_type: 'BULK',
  };
  const queue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const db: any = { select: jest.fn(() => chain(queue.shift() ?? [])), insert: jest.fn(), update: jest.fn() };
  const forecast = { listFarms: jest.fn(async () => [{ farmId: 'farm-1', companyId: 'co-1' }]) };
  const capacity = {
    itemId: 'item-8', state: 'AVAILABLE', demandKg: 6_050, availableKg: 150_000, status: 'GREEN', priority: 1,
    millId: 'mill-1', millCode: 'MILL-001', binId: 'bin-1', binCode: 'MILL-001/BIN-001', feedForm: 'BULK',
  };
  const millCapacity = {
    approvedDemand: jest.fn(async () => ({ lines: [{ productionDate: '2026-10-11', farmId: 'farm-1', itemId: 'item-8', requestedKg: 6_050, millApprovedKg: null }], diets: new Map() })),
    allocateOn: jest.fn(async () => new Map([['item-8', capacity]])),
    assertConsolidationWithinCapacity: jest.fn(async () => undefined),
  };
  const service = new FeedConsolidationService(transactionCls(db), forecast as any, {} as any, millCapacity as any);

  beforeEach(() => { queue.length = 0; jest.clearAllMocks(); });

  it('shows the assigned loading BIN and Mill Capacity Available for each eligible line', async () => {
    queue.push([line], [
      { location_id: 'bin-2', location_code: 'MILL-001/BIN-002', location_name: 'Bin 2', bin_capacity_kg: '30000.00' },
      { location_id: 'bin-1', location_code: 'MILL-001/BIN-001', location_name: 'Bin 1', bin_capacity_kg: '30000.00' },
    ]);
    const [row] = await service.eligible({}, 'tenant-1', { userType: 'TENANT_ADMIN' });
    expect(millCapacity.approvedDemand).toHaveBeenCalledWith('tenant-1', { companyIds: ['co-1'] }, '2026-10-11', '2026-10-11');
    expect(row).toMatchObject({
      loading_bin: 'MILL-001/BIN-001', loading_bin_name: 'Bin 1', available_mill_output_kg: 150_000,
      mill_capacity_state: 'AVAILABLE', mill_capacity_status: 'GREEN', mill_demand_kg: 6_050,
    });
  });

  it('names no BIN and no capacity when the diet has no BIN assignment that day', async () => {
    millCapacity.allocateOn.mockResolvedValueOnce(new Map());
    queue.push([line], [{ location_id: 'bin-1', location_code: 'MILL-001/BIN-001', location_name: 'Bin 1', bin_capacity_kg: '30000.00' }]);
    const [row] = await service.eligible({}, 'tenant-1', { userType: 'TENANT_ADMIN' });
    expect(row).toMatchObject({ loading_bin: null, available_mill_output_kg: null, mill_capacity_state: 'NOT_CONFIGURED' });
  });

  it('refuses to create a sheet above Mill Capacity Available before writing anything', async () => {
    jest.spyOn(service, 'eligible').mockResolvedValueOnce([{ ...line, loading_bin: null } as any]);
    millCapacity.assertConsolidationWithinCapacity.mockRejectedValueOnce(new ConflictException('Mill capacity exceeded'));
    await expect(service.create({ lines: [{ requisitionLineId: 'line-1', millApprovedQtyKg: 6_000, adjustmentReason: 'Mill capacity' }] } as any, 'tenant-1', { userId: 'u-1' }))
      .rejects.toThrow('Mill capacity exceeded');
    expect(millCapacity.assertConsolidationWithinCapacity).toHaveBeenCalledWith('tenant-1', 'co-1', [
      { productionDate: '2026-10-11', itemId: 'item-8', itemCode: 'ICAT-004-ITM-0008', millApprovedKg: 6_000 },
    ]);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('checks the sheet again on finalize, excluding its own lines from the existing demand', async () => {
    queue.push(
      [{ consolidation_id: 'cons-1', consolidation_no: 'CONS-202641-001', status: 'DRAFT', company_id: 'co-1' }],
      [{ item_id: 'item-8', item_code: 'ICAT-004-ITM-0008', production_date: '2026-10-11', requested_delivery_date: '2026-10-12', mill_approved_qty_kg: '6000.0000' }],
    );
    millCapacity.assertConsolidationWithinCapacity.mockRejectedValueOnce(new ConflictException('Mill capacity exceeded'));
    await expect(service.finalize('cons-1', 'tenant-1', {})).rejects.toThrow('Mill capacity exceeded');
    expect(millCapacity.assertConsolidationWithinCapacity).toHaveBeenCalledWith('tenant-1', 'co-1', [
      { productionDate: '2026-10-11', itemId: 'item-8', itemCode: 'ICAT-004-ITM-0008', millApprovedKg: 6_000 },
    ], 'cons-1');
    expect(db.update).not.toHaveBeenCalled();
  });
});
