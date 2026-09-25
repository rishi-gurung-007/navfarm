import { transactionCls } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { SiloFeedService } from './silo-feed.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';

/**
 * SiloFeedService is the one home for D9 (a silo holds one feed item at a
 * time; a different feed only enters an empty silo; two silos feeding the
 * same shed may not hold the same item). Modelled on stock-transfer's own
 * spec: getStockBalance is mocked directly (it is InventoryLedgerService's
 * job to compute it, not this service's), and the db mock answers by call
 * order since the sibling-lookup query is a join, not a single table scan.
 */
describe('SiloFeedService', () => {
  let service: SiloFeedService;
  let cls: ReturnType<typeof transactionCls>;

  const mockGetStockBalance = jest.fn();
  const mockDbSelect = jest.fn();
  const mockDbSelectDistinct = jest.fn();
  const mockDb = { select: mockDbSelect, selectDistinct: mockDbSelectDistinct };

  /** Awaitable at any point, so a query resolves however many links are chained on it. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      innerJoin: () => self,
      where: () => Promise.resolve(result),
    };
    return self;
  };

  beforeEach(async () => {
    mockGetStockBalance.mockReset().mockResolvedValue([]);
    mockDbSelect.mockReset();
    mockDbSelectDistinct.mockReset();
    // Every consecutive call to select()/selectDistinct() returns whatever is
    // shifted off `selectQueue` — set up per test in the exact order the
    // service is expected to issue its queries.
    mockDbSelect.mockImplementation(() => chain(selectQueue.shift() ?? []));
    mockDbSelectDistinct.mockImplementation(() => chain(selectDistinctQueue.shift() ?? []));

    cls = transactionCls(mockDb as any);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SiloFeedService,
        { provide: ClsService, useValue: cls },
        { provide: InventoryLedgerService, useValue: { getStockBalance: mockGetStockBalance } },
      ],
    }).compile();

    service = module.get<SiloFeedService>(SiloFeedService);
  });

  let selectQueue: unknown[][];
  let selectDistinctQueue: unknown[][];
  beforeEach(() => {
    selectQueue = [];
    selectDistinctQueue = [];
  });

  describe('assertCanReceive', () => {
    it('rejects two different items in one posting', async () => {
      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r1', 'item-r2'],
        }),
      ).rejects.toThrow(/holds one feed item at a time/);
      expect(mockGetStockBalance).not.toHaveBeenCalled();
    });

    it("rejects a different item into a silo that already holds one", async () => {
      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r1', item_code: 'FEED-R1', item_description: null, on_hand_qty: 100 },
      ]);

      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r2'],
        }),
      ).rejects.toThrow(/already holds 'FEED-R1'.*empty it/s);
    });

    it("reads naturally for a Goods Receipt — 'this receipt' in the two-item message, 'Goods Receipt' in both prefixes", async () => {
      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r1', 'item-r2'], documentLabel: 'Goods Receipt',
        }),
      ).rejects.toThrow(
        "Cannot post this Goods Receipt — silo 'GRS/SILO-001' holds one feed item at a time and this receipt carries 2 different items.",
      );

      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r1', item_code: 'FEED-R1', item_description: null, on_hand_qty: 100 },
      ]);
      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r2'], documentLabel: 'Goods Receipt',
        }),
      ).rejects.toThrow(
        "Cannot post this Goods Receipt — silo 'GRS/SILO-001' already holds 'FEED-R1'. A silo holds one feed item at a time; empty it before moving a different item in.",
      );
    });

    it("rejects D9: a sibling silo on a shared shed already draws the incoming item", async () => {
      // Own silo (S1) is empty.
      mockGetStockBalance.mockResolvedValueOnce([]);
      // Sibling lookup: S1 and S2 both link to shed H3.
      selectDistinctQueue.push([
        { silo_id: 'silo-2', shed_id: 'shed-3', shed_code: 'GRS/SHED-003' },
      ]);
      // currentItems(['silo-2']) resolves S2's resident item.
      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r2', item_code: 'FEED-R2', item_description: null, on_hand_qty: 50 },
      ]);
      // Silo code lookup for the sibling.
      selectQueue.push([{ location_id: 'silo-2', location_code: 'GRS/SILO-002' }]);

      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r2'],
        }),
      ).rejects.toThrow(/Shed 'GRS\/SHED-003' already draws 'FEED-R2' from silo 'GRS\/SILO-002'/);
    });

    it('accepts an item into an empty silo with no sibling conflict', async () => {
      mockGetStockBalance.mockResolvedValueOnce([]); // own silo empty
      selectDistinctQueue.push([]); // no siblings

      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r1'],
        }),
      ).resolves.toBeUndefined();
    });

    it('accepts topping up the item the silo already holds, skipping the sibling check', async () => {
      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r1', item_code: 'FEED-R1', item_description: null, on_hand_qty: 100 },
      ]);
      selectDistinctQueue.push([]); // sibling check still runs, but no siblings

      await expect(
        service.assertCanReceive({
          siloId: 'silo-1', siloName: 'GRS/SILO-001', companyId: 'co-1', tenantId: 'tenant-1',
          itemIds: ['item-r1'],
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertAttachable', () => {
    it('rejects attaching a silo to a shed whose sibling silo already holds the same item', async () => {
      // S1 holds R1.
      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r1', item_code: 'FEED-R1', item_description: null, on_hand_qty: 100 },
      ]);
      // Other silos already linked to H3: S2.
      selectQueue.push([{ silo_id: 'silo-2', shed_id: 'shed-3' }]);
      // S2's current item.
      mockGetStockBalance.mockResolvedValueOnce([
        { item_id: 'item-r1', item_code: 'FEED-R1', item_description: null, on_hand_qty: 30 },
      ]);
      // Shed code lookup, then silo code lookup.
      selectQueue.push([{ location_id: 'shed-3', location_code: 'GRS/SHED-003' }]);
      selectQueue.push([
        { location_id: 'silo-1', location_code: 'GRS/SILO-001' },
        { location_id: 'silo-2', location_code: 'GRS/SILO-002' },
      ]);

      await expect(
        service.assertAttachable({ siloId: 'silo-1', shedIds: ['shed-3'], companyId: 'co-1', tenantId: 'tenant-1' }),
      ).rejects.toThrow(/already draws 'FEED-R1'/);
    });

    it('accepts attaching an empty silo — nothing to conflict with yet', async () => {
      mockGetStockBalance.mockResolvedValueOnce([]); // S1 empty

      await expect(
        service.assertAttachable({ siloId: 'silo-1', shedIds: ['shed-3'], companyId: 'co-1', tenantId: 'tenant-1' }),
      ).resolves.toBeUndefined();
      expect(mockDbSelect).not.toHaveBeenCalled();
    });
  });
});
