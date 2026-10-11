import { transactionCls } from '../../../test-utils/transaction-cls';
import { FeedLoadingService } from './feed-loading.service';

// Workbook Requisition and Loading Sheet §3 (rows 60–77): the Loading
// Instruction Sheet. A4 of workbook-100-gaps.md.
import { resolveLoadingBinId } from './feed-requisition-transfer.rules';

describe('FeedLoadingService', () => {
  const queue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, innerJoin: () => self, leftJoin: () => self, where: () => self, orderBy: () => self, limit: () => self, for: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const inserted: unknown[] = [];
  const updated: unknown[] = [];
  const db: any = {
    select: jest.fn(() => chain(queue.shift() ?? [])),
    insert: jest.fn(() => ({ values: async (values: unknown) => { inserted.push(values); } })),
    update: jest.fn(() => ({ set: (values: unknown) => { updated.push(values); return { where: async () => undefined }; } })),
  };
  const service = new FeedLoadingService(transactionCls(db));

  const sheet = {
    loading_sheet_id: 'ls-1', loading_sheet_no: 'LOAD-REQ-MUL100-2026-00001-10000', tenant_id: 't-1', company_id: 'co-1',
    consolidation_id: 'cons-1', consolidation_line_id: 'cl-1', requisition_id: 'req-1', requisition_line_id: 'rl-1',
    farm_id: 'farm-1', destination_silo_id: 'silo-1', item_id: 'item-8', mill_loading_bin_id: 'bin-1',
    requested_qty_kg: '6050.0000', mill_approved_qty_kg: '6000.0000', scheduled_qty_kg: '6000.0000',
    requested_delivery_date: '2026-10-12', production_date: '2026-10-11', compartment_no: 'C1', kg_loaded: '6000.0000',
    loaded_by: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', loaded_at: '2026-10-11 09:30:00', shipment_id: 'sh-1', shipment_no: 'TS-0001', status: 'LOADED',
    created_at: '2026-10-10 00:00:00', updated_at: '2026-10-10 00:00:00',
  };
  /** decorate's reads, in order: locations, items, requisitions, consolidation lines, users, transfers. */
  const decorateReads = (overrides: { users?: unknown[]; locations?: unknown[]; items?: unknown[]; reqs?: unknown[]; transfers?: unknown[] } = {}) => queue.push(
    overrides.locations ?? [
      { id: 'farm-1', code: 'MUL100', name: 'Mulberry' },
      { id: 'silo-1', code: 'MUL100/SILO-01', name: 'Silo 1' },
      { id: 'bin-1', code: 'MILL-001/BIN-001', name: 'Bin 1' },
    ],
    overrides.items ?? [{ id: 'item-8', code: 'ICAT-004-ITM-0008', name: 'Weaner Grower Mash', diet_no: 8 }],
    overrides.reqs ?? [{ id: 'req-1', no: 'REQ-MUL100-2026-00001' }],
    [{ id: 'cl-1', adjustmentReason: 'Mill capacity' }],
    overrides.users ?? [{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', name: 'Mill Loader One' }],
    overrides.transfers ?? [{ requisition_line_id: 'rl-1', transfer_id: 'tr-1', transfer_no: 'TO-0001' }],
  );

  beforeEach(() => { queue.length = 0; inserted.length = 0; updated.length = 0; jest.clearAllMocks(); });

  it('numbers new loading sheets LOAD-<Req No>-<Line No> (row 60)', async () => {
    queue.push(
      [], // no sheet yet for this consolidation
      [{ no: 'CONS-202641-001', companyId: 'co-1' }],
      [
        { consolidation_line_id: 'cl-1', requisition_id: 'req-1', requisition_line_id: 'rl-1', farm_id: 'farm-1', destination_silo_id: 'silo-1', item_id: 'item-8', requested_qty_kg: '6050', mill_approved_qty_kg: '6000', requested_delivery_date: '2026-10-12', production_date: null },
        { consolidation_line_id: 'cl-2', requisition_id: 'req-1', requisition_line_id: 'rl-2', farm_id: 'farm-1', destination_silo_id: 'silo-2', item_id: 'item-8', requested_qty_kg: '3000', mill_approved_qty_kg: '3000', requested_delivery_date: '2026-10-12', production_date: null },
      ],
      [
        { line_id: 'rl-1', line_seq: 10000, req_no: 'REQ-MUL100-2026-00001' },
        { line_id: 'rl-2', line_seq: 20000, req_no: 'REQ-MUL100-2026-00001' },
      ],
    );
    await expect(service.createForConsolidation('cons-1', 't-1', { userId: 'user-1' })).resolves.toEqual({ created: 2, existing: false });
    const rows = inserted[0] as Array<{ loading_sheet_no: string }>;
    expect(rows.map((row) => row.loading_sheet_no)).toEqual(['LOAD-REQ-MUL100-2026-00001-10000', 'LOAD-REQ-MUL100-2026-00001-20000']);
  });

  it('snapshots the BIN the shared assignment lookup resolves, the one Release uses', async () => {
    const assignments = [{ assignmentId: 'a-1', itemId: 'item-8', productionDate: '2026-10-11', binLocationId: 'bin-2', productionSlotId: 'slot-1' }];
    queue.push(
      [], [{ no: 'CONS-1', companyId: 'co-1' }],
      [{ consolidation_line_id: 'cl-1', requisition_id: 'req-1', requisition_line_id: 'rl-1', farm_id: 'farm-1', destination_silo_id: 'silo-1', item_id: 'item-8', requested_qty_kg: '6050', mill_approved_qty_kg: '6000', requested_delivery_date: '2026-10-12', production_date: '2026-10-11' }],
      assignments,
      [{ line_id: 'rl-1', line_seq: 10000, req_no: 'REQ-1' }],
    );
    await service.createForConsolidation('cons-1', 't-1', { userId: 'user-1' });
    const releaseBin = resolveLoadingBinId({ itemId: 'item-8', productionDate: '2026-10-11' }, assignments);
    expect((inserted[0] as Array<{ mill_loading_bin_id: string | null }>)[0].mill_loading_bin_id).toBe(releaseBin);
    expect(releaseBin).toBe('bin-2');
  });

  it('leaves existing sheets and their numbers untouched', async () => {
    queue.push([{ id: 'ls-old' }]);
    await expect(service.createForConsolidation('cons-1', 't-1', {})).resolves.toEqual({ created: 0, existing: true });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('returns Loaded By as a name, the Diet No., the delivery date, the loading date time and the linked transfer', async () => {
    queue.push([sheet]);
    decorateReads();
    const row: any = await service.findOne('ls-1', 't-1');
    expect(row).toMatchObject({
      loaded_by_name: 'Mill Loader One', diet_no: 8, requested_delivery_date: '2026-10-12', loaded_at: '2026-10-11 09:30:00',
      requisition_no: 'REQ-MUL100-2026-00001', farm_code: 'MUL100', destination_silo_code: 'MUL100/SILO-01',
      item_code: 'ICAT-004-ITM-0008', mill_loading_bin_code: 'MILL-001/BIN-001', transfer_id: 'tr-1', transfer_no: 'TO-0001',
      adjustment_reason: 'Mill capacity',
    });
    expect(row).not.toHaveProperty('loaded_by');
  });

  it('shows a typed Loaded By name as written', async () => {
    queue.push([{ ...sheet, loaded_by: 'Mill Loader 01' }]);
    decorateReads({ users: [] });
    const row: any = await service.findOne('ls-1', 't-1');
    expect(row.loaded_by_name).toBe('Mill Loader 01');
  });

  it('never falls back to a raw id when a record is missing', async () => {
    queue.push([{ ...sheet, loaded_by: '11111111-2222-3333-4444-555555555555' }]);
    decorateReads({ users: [], locations: [], items: [], reqs: [], transfers: [] });
    const row: any = await service.findOne('ls-1', 't-1');
    expect(row).toMatchObject({
      loaded_by_name: null, requisition_no: null, farm_code: null, destination_silo_code: null, item_code: null,
      mill_loading_bin_code: null, diet_no: null, transfer_id: null, transfer_no: null,
    });
  });

  it('stores the Loaded By name the mill enters (row 72)', async () => {
    queue.push([{ ...sheet, status: 'DRAFT', compartment_no: null, kg_loaded: null, loaded_by: null, loaded_at: null }], [], [{ capacity: null }], [sheet]);
    decorateReads();
    await service.update('ls-1', { compartmentNo: 'C1', kgLoaded: 6000, loadedBy: '  Mill Loader 01 ' }, 't-1', { userId: 'user-1' });
    expect(updated[0]).toMatchObject({ loaded_by: 'Mill Loader 01', status: 'LOADED' });
  });

  it('keeps an earlier Loaded By when a later save does not name one', async () => {
    queue.push([{ ...sheet, loaded_by: 'Mill Loader 01' }], [], [{ capacity: null }], [sheet]);
    decorateReads();
    await service.update('ls-1', { compartmentNo: 'C1', kgLoaded: 6000 }, 't-1', { userId: 'user-2' });
    expect(updated[0]).toMatchObject({ loaded_by: 'Mill Loader 01' });
  });
});
