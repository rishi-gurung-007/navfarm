import { ConflictException } from '@nestjs/common';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { assertAssignmentCompatibility, feedFormFromItemType } from './bin-diet-assignment.rules';
import { resolveItemFeedForm } from '../../../common/feed-form';
import { BinDietAssignmentService } from './bin-diet-assignment.service';

describe('BIN Diet Assignment rules', () => {
  const bin = { location_type: 'BIN', is_active: true, bin_feed_type: 'BULK' };
  const item = { item_type: 'FEED BULK', item_type_name: 'Feed Bulk', diet_no: 4, is_active: true };

  it('derives the workbook FEED BULK / FEED BAG item-type handling form', () => {
    expect(feedFormFromItemType('FEED BULK', 'Feed')).toBe('BULK');
    expect(feedFormFromItemType('FEED BAG', 'Bagged Feed')).toBe('BAGGED');
    expect(feedFormFromItemType('FEED', 'Feed')).toBeNull();
    // 12 Oct: item type CODES use underscores; the name alone must not be needed.
    expect(feedFormFromItemType('FEED_BULK', 'Feed')).toBe('BULK');
    expect(feedFormFromItemType('FEED_BAG', null)).toBe('BAGGED');
    expect(feedFormFromItemType('FEED-BAGGED', '')).toBe('BAGGED');
  });

  it('uses the item feed_form first, then falls back to the type code (12 Oct)', () => {
    const plain = { item_type: 'FEED', item_type_name: 'Feed', diet_no: 4, is_active: true };
    expect(resolveItemFeedForm({ ...plain, feed_form: 'BULK' })).toBe('BULK');
    expect(resolveItemFeedForm({ ...plain, feed_form: 'BAGGED' })).toBe('BAGGED');
    expect(resolveItemFeedForm({ ...plain, feed_form: null })).toBeNull();
    expect(resolveItemFeedForm({ item_type: 'FEED_BAG', feed_form: null })).toBe('BAGGED');
    // the item's own choice beats a conflicting type code
    expect(resolveItemFeedForm({ item_type: 'FEED_BAG', feed_form: 'BULK' })).toBe('BULK');
    // non-feed types never carry a form
    expect(resolveItemFeedForm({ item_type: 'MEDICINE', feed_form: 'BULK' })).toBeNull();
    expect(() => assertAssignmentCompatibility(bin, { ...plain, feed_form: 'BULK' })).not.toThrow();
    expect(() => assertAssignmentCompatibility(bin, { ...plain, feed_form: 'BAGGED' })).toThrow('does not match');
    expect(() => assertAssignmentCompatibility(bin, plain)).toThrow('active Feed Item');
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

  beforeEach(() => {
    selectQueue.length = 0;
    jest.clearAllMocks();
    ledger.getStockBalance.mockResolvedValue([]);
  });

  it('refuses a second diet for the same BIN and production date before insert', async () => {
    selectQueue.push([activeBin], [feedItem], [{ type_code: 'FEED BULK', type_name: 'Feed Bulk' }], [{ assignment_id: 'existing' }]);
    await expect(service.create({
      company_id: 'co-1', bin_location_id: 'bin-1', feed_item_id: 'item-1',
      production_date: '2026-10-05', diet_priority: 1,
    }, 'tenant-1')).rejects.toThrow(ConflictException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('allows the same BIN on a different production date (no active row on that date)', async () => {
    const created = { assignment_id: 'new', bin_location_id: 'bin-1', production_date: '2026-10-06' };
    selectQueue.push([activeBin], [feedItem], [{ type_code: 'FEED BULK', type_name: 'Feed Bulk' }], [], [created]);
    await expect(service.create({
      company_id: 'co-1', bin_location_id: 'bin-1', feed_item_id: 'item-1',
      production_date: '2026-10-06', diet_priority: 1,
    }, 'tenant-1')).resolves.toEqual(created);
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(values.mock.calls[0][0]).not.toHaveProperty('production_slot_id');
  });

  it('refuses changing a BIN to an item while positive stock of another item remains', async () => {
    selectQueue.push([activeBin], [feedItem], [{ type_code: 'FEED BULK', type_name: 'Feed Bulk' }], []);
    ledger.getStockBalance.mockResolvedValue([{ item_id: 'item-old', item_code: 'OLD', on_hand_qty: 125 }]);
    await expect(service.create({
      company_id: 'co-1', bin_location_id: 'bin-1', feed_item_id: 'item-1',
      production_date: '2026-10-05', diet_priority: 1,
    }, 'tenant-1')).rejects.toThrow('still holds 125');
    expect(ledger.getStockBalance).toHaveBeenCalledWith({ companyId: 'co-1', warehouseId: 'bin-1' }, 'tenant-1');
  });

  it('returns the deterministic next assignment ordered by date and BIN code', async () => {
    selectQueue.push([{
      assignment_id: 'a2', bin_location_id: 'bin-2', bin_code: 'MILL-001/BIN-002', bin_name: 'Bin 2',
      production_date: '2026-10-06',
      feed_item_id: 'item-1', diet_priority: 1,
    }]);
    await expect(service.findNextBinAssignment({
      tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1', from: '2026-10-05',
    })).resolves.toEqual(expect.objectContaining({ binCode: 'MILL-001/BIN-002', productionDate: '2026-10-06'}));
  });

  it('returns null when no effective assignment exists', async () => {
    selectQueue.push([]);
    await expect(service.findNextBinAssignment({
      tenantId: 'tenant-1', companyId: 'co-1', itemId: 'item-1', from: '2026-10-05',
    })).resolves.toBeNull();
  });
});
