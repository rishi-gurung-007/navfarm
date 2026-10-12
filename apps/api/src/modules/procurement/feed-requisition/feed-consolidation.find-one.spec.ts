import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedConsolidationService } from './feed-consolidation.service';

// Workbook Requisition and Loading Sheet §5 (rows 115–130): the saved Mill
// Consolidation Sheet. A3 of workbook-100-gaps.md.
describe('FeedConsolidationService.findOne', () => {
  const queue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const db: any = { select: jest.fn(() => chain(queue.shift() ?? [])) };
  const capacity = {
    itemId: 'item-8', state: 'AVAILABLE', demandKg: 9_000, availableKg: 150_000, status: 'GREEN', priority: 1,
    // A schedule BIN that differs from the assignment: findOne must not take it.
    millId: 'mill-1', millCode: 'MILL-001', binId: 'bin-9', binCode: 'MILL-001/BIN-009', feedForm: 'BULK',
  };
  const millCapacity = {
    approvedDemand: jest.fn(async () => ({ lines: [], diets: new Map() })),
    allocateOnDates: jest.fn(async () => new Map([['2026-10-11', new Map([['item-8', capacity]])]])),
  };
  const service = new FeedConsolidationService(transactionCls(db), {} as any, {} as any, millCapacity as any);

  const header = { consolidation_id: 'cons-1', consolidation_no: 'CONS-202641-001', tenant_id: 't-1', company_id: 'co-1', production_week: '202641', consolidation_date: '2026-10-10', created_by: 'user-1', status: 'DRAFT' };
  const line = (n: number, farm: string, qty: string) => ({
    consolidation_line_id: `cl-${n}`, consolidation_id: 'cons-1', requisition_id: `req-${n}`, requisition_line_id: `rl-${n}`,
    farm_id: farm, item_id: 'item-8', destination_silo_id: `silo-${n}`, requested_delivery_date: '2026-10-12', production_date: '2026-10-11',
    requested_qty_kg: qty, mill_approved_qty_kg: qty, adjustment_reason: null, bc_to_no: null,
  });
  const assignment = { assignmentId: 'a-1', itemId: 'item-8', productionDate: '2026-10-11', binLocationId: 'bin-2' };
  /** Reads in order: header, lines, loading sheets, BIN assignments, locations, items, requisitions, transfers, Feed Mill Manager. */
  const reads = (o: { loading?: unknown[]; assignments?: unknown[]; locations?: unknown[]; items?: unknown[]; reqs?: unknown[]; transfers?: unknown[]; users?: unknown[] } = {}) => queue.push(
    [header],
    [line(1, 'farm-1', '6000.0000'), line(2, 'farm-2', '3000.0000')],
    o.loading ?? [{ consolidation_line_id: 'cl-1', loading_sheet_id: 'ls-1', loading_sheet_no: 'LOAD-REQ-1-10000', mill_loading_bin_id: 'bin-1' }],
    o.assignments ?? [assignment],
    o.locations ?? [
      { id: 'farm-1', code: 'MUL100', name: 'Mulberry' }, { id: 'farm-2', code: 'GRS', name: 'Green Ridge' },
      { id: 'silo-1', code: 'MUL100/SILO-01', name: 'Silo 1' }, { id: 'silo-2', code: 'GRS/SILO-01', name: 'Silo 1' },
      { id: 'bin-1', code: 'MILL-001/BIN-001', name: 'Bin 1' }, { id: 'bin-2', code: 'MILL-001/BIN-002', name: 'Bin 2' },
    ],
    o.items ?? [{ id: 'item-8', code: 'ICAT-004-ITM-0008', name: 'Weaner Grower Mash', diet_no: 8 }],
    o.reqs ?? [{ id: 'req-1', no: 'REQ-MUL100-2026-00001' }, { id: 'req-2', no: 'REQ-GRS-2026-00001' }],
    o.transfers ?? [{ requisition_line_id: 'rl-1', transfer_id: 'tr-1', transfer_no: 'TO-0001' }],
    o.users ?? [{ id: 'user-1', name: 'Feed Mill Manager One' }],
  );

  beforeEach(() => { queue.length = 0; jest.clearAllMocks(); });

  it('names the Feed Mill Manager (r118)', async () => {
    reads();
    const sheet: any = await service.findOne('cons-1', 't-1', {});
    expect(sheet.feed_mill_manager_name).toBe('Feed Mill Manager One');
  });

  it('gives each line its Diet No., BIN, mill capacity, all-farms diet total, transfer and loading sheet (r121, r122, r124, r125, r130)', async () => {
    reads();
    const sheet: any = await service.findOne('cons-1', 't-1', {});
    expect(millCapacity.approvedDemand).toHaveBeenCalledWith('t-1', { companyIds: ['co-1'] }, '2026-10-11', '2026-10-11');
    expect(sheet.lines[0]).toMatchObject({
      requisition_no: 'REQ-MUL100-2026-00001', farm_code: 'MUL100', destination_silo_code: 'MUL100/SILO-01', item_code: 'ICAT-004-ITM-0008',
      diet_no: 8,
      // The loading sheet's BIN snapshot wins over today's assignment.
      mill_loading_bin_id: 'bin-1', mill_loading_bin_code: 'MILL-001/BIN-001',
      available_mill_output_kg: 150_000, mill_capacity_state: 'AVAILABLE', mill_capacity_status: 'GREEN',
      total_all_farms_kg: 9_000,
      transfer_id: 'tr-1', transfer_no: 'TO-0001',
      loading_sheet_id: 'ls-1', loading_sheet_no: 'LOAD-REQ-1-10000',
    });
    expect(sheet.lines[1]).toMatchObject({
      farm_code: 'GRS', mill_loading_bin_id: 'bin-2', mill_loading_bin_code: 'MILL-001/BIN-002', total_all_farms_kg: 9_000,
      transfer_id: null, transfer_no: null, loading_sheet_id: null, loading_sheet_no: null,
    });
  });

  it('names the same BIN Release and the loading sheet resolve, not the capacity schedule BIN (r122)', async () => {
    const { resolveLoadingBinId } = jest.requireActual('./feed-requisition-transfer.rules');
    reads({ loading: [] });
    const sheet: any = await service.findOne('cons-1', 't-1', {});
    const releaseBin = resolveLoadingBinId({ itemId: 'item-8', productionDate: '2026-10-11' }, [assignment]);
    expect(releaseBin).toBe('bin-2');
    expect(sheet.lines.map((l: any) => l.mill_loading_bin_id)).toEqual([releaseBin, releaseBin]);
  });

  it('never falls back to a raw id when a record is missing', async () => {
    millCapacity.allocateOnDates.mockResolvedValueOnce(new Map());
    reads({ loading: [], assignments: [], locations: [], items: [], reqs: [], transfers: [], users: [] });
    const sheet: any = await service.findOne('cons-1', 't-1', {});
    expect(sheet.feed_mill_manager_name).toBeNull();
    expect(sheet.lines[0]).toMatchObject({
      requisition_no: null, farm_code: null, destination_silo_code: null, item_code: null, diet_no: null,
      mill_loading_bin_id: null, mill_loading_bin_code: null, available_mill_output_kg: null, mill_capacity_state: 'NOT_CONFIGURED',
    });
  });
});
