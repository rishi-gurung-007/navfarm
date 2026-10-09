import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { assertAssignmentCompatibility, feedFormFromItemType } from './bin-diet-assignment.rules';
import { BinDietAssignmentService } from './bin-diet-assignment.service';

describe('BIN Diet Assignment rules', () => {
  const bin = { location_type: 'BIN', is_active: true, bin_feed_type: 'BULK' };
  const item = { item_type: 'FEED BULK', item_type_name: 'Feed Bulk', diet_no: 4, is_active: true };

  it('derives the workbook FEED BULK / FEED BAG item-type handling form', () => {
    expect(feedFormFromItemType('FEED BULK', 'Feed')).toBe('BULK');
    expect(feedFormFromItemType('FEED BAG', 'Bagged Feed')).toBe('BAGGED');
    expect(feedFormFromItemType('FEED', 'Feed')).toBeNull();
  });

  it('requires an active FEED item with a Diet No.', () => {
    expect(() => assertAssignmentCompatibility(bin, { ...item, is_active: false })).toThrow('active Feed Item');
    expect(() => assertAssignmentCompatibility(bin, { ...item, item_type: 'MEDICINE' })).toThrow('active Feed Item');
    expect(() => assertAssignmentCompatibility(bin, { ...item, diet_no: null })).toThrow('Diet No.');
  });

  it('requires an active BIN and a matching explicit feed form', () => {
    expect(() => assertAssignmentCompatibility({ ...bin, location_type: 'SILO' }, item)).toThrow('active BIN');
    expect(() => assertAssignmentCompatibility({ ...bin, bin_feed_type: 'BAGGED' }, item)).toThrow('does not match');
    expect(() => assertAssignmentCompatibility(bin, item)).not.toThrow();
  });
});

describe('BinDietAssignmentService', () => {
  const selectQueue: unknown[][] = [];
  const chain = (rows: unknown[]) => {
    const self: any = {
      from: () => self, leftJoin: () => self, innerJoin: () => self,
      where: () => self, orderBy: () => self, offset: () => self, limit: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const values = jest.fn(async () => undefined);
  const db: any = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({ set: jest.fn(() => ({ where: jest.fn(async () => undefined) })) })),
    transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(db)),
  };
  const ledger = { getStockBalance: jest.fn<Promise<any[]>, any[]>(async () => []) };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new (BinDietAssignmentService as any)(transactionCls(db), audit, ledger);

  const activeBin = {
    location_id: 'bin-1', tenant_id: 'tenant-1', company_id: 'co-1', location_type: 'BIN',
    location_code: 'MILL-001/BIN-001', location_name: 'Bin 1', bin_feed_type: 'BULK', is_active: true,
  };
  const feedItem = {
    item_id: 'item-1', tenant_id: 'tenant-1', company_id: 'co-1', item_code: 'R4', item_name: 'Diet 4',
    item_type: 'FEED BULK', item_type_name: 'Feed Bulk', diet_no: 4, is_active: true,
  };
  const slot = { slot_id: 'slot-1', company_id: 'co-1', slot_code: 'AM', slot_name: 'Morning', start_time: '06:00:00', is_active: true };

  beforeEach(() => {
    selectQueue.length = 0;
    jest.clearAllMocks();
    ledger.getStockBalance.mockResolvedValue([]);
  });

  it('refuses the same BIN/date/slot assignment before insert', async () => {
    selectQueue.push([activeBin], [feedItem], [{ type_code: 'FEED BULK', type_name: 'Feed Bulk' }], [slot], [{ assignment_id: 'existing' }]);
    await expect(service.create({
      company_id: 'co-1', bin_location_id: 'bin-1', feed_item_id: 'item-1',
      production_date: '2026-10-05', production_slot_id: 'slot-1', diet_priority: 1,
    }, 'tenant-1')).rejects.toThrow(ConflictException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('refuses changing a BIN to an item while positive stock of another item remains', async () => {
    selectQueue.push([activeBin], [feedItem], [{ type_code: 'FEED BULK', type_name: 'Feed Bulk' }], [slot], []);
    ledger.getStockBalance.mockResolvedValue([{ item_id: 'item-old', item_code: 'OLD', on_hand_qty: 125 }]);
    await expect(service.create({
      company_id: 'co-1', bin_location_id: 'bin-1', feed_item_id: 'item-1',
      production_date: '2026-10-05', production_slot_id: 'slot-1', diet_priority: 1,
    }, 'tenant-1')).rejects.toThrow('still holds 125');
    expect(ledger.getStockBalance).toHaveBeenCalledWith({ companyId: 'co-1', warehouseId: 'bin-1' }, 'tenant-1');
  });

  it('returns the deterministic next assignment ordered by date, slot start and BIN code', async () => {
    selectQueue.push([{
      assignment_id: 'a2', bin_location_id: 'bin-2', bin_code: 'MILL-001/BIN-002', bin_name: 'Bin 2',
      production_date: '2026-10-06', production_slot_id: 'slot-am', slot_code: 'AM', slot_name: 'Morning', start_time: '06:00:00',
      feed_item_id: 'item-1', diet_priority: 1,
    }]);
    await expect(service.findNextBinAssignment({
      tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1', from: '2026-10-05',
    })).resolves.toEqual(expect.objectContaining({ binCode: 'MILL-001/BIN-002', productionDate: '2026-10-06', slotCode: 'AM' }));
  });

  it('returns null when no effective assignment exists', async () => {
    selectQueue.push([]);
    await expect(service.findNextBinAssignment({
      tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1', from: '2026-10-05',
    })).resolves.toBeNull();
  });
});
