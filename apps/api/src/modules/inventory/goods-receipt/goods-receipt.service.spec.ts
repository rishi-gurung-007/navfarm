import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { GoodsReceiptService } from './goods-receipt.service';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { SiloFeedService } from '../silo-feed/silo-feed.service';
import { FeedAlertService } from '../feed-alert/feed-alert.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { BadRequestException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateGoodsReceiptDto } from './dto/goods-receipt.dto';

describe('GoodsReceiptService', () => {
  let service: GoodsReceiptService;

  const numberSeriesMock = {
    generateNextNumberById: jest.fn().mockResolvedValue({ next_number: 'TEST-001' }),
    ensureCompanySeries: jest.fn().mockResolvedValue(undefined),
    seriesCodeForDocument: jest.fn().mockResolvedValue('GOODS_RECEIPT'),
    previewCode: jest.fn(),
    generateNextNumbersById: jest.fn(),
    generateNext: jest.fn().mockResolvedValue('GR-000007'),
  };

  const mockDbSelect = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbDelete = jest.fn();
  // Declared up front (not left to transaction-cls's own default) so tests
  // can assert on it directly — see the I4 "wraps ... in one transaction" spec.
  let mockDb: Record<string, jest.Mock>;
  const mockDbTransaction: jest.Mock = jest.fn((work: (tx: any) => Promise<any>) => work(mockDb));

  mockDb = {
    select: mockDbSelect,
    update: mockDbUpdate,
    insert: mockDbInsert,
    delete: mockDbDelete,
    transaction: mockDbTransaction,
  };

  const draftReceipt = {
    receipt_id: 'gr-1',
    company_id: 'comp-1',
    warehouse_id: 'wh-1',
    status: 'DRAFT',
    lines: [{ line_id: 'line-1', item_id: 'item-1', quantity: '10', uom: 'KG' }],
  };

  const createQueryChain = (resolvedValue: any) => {
    const chain: any = {
      where: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(resolvedValue),
        then: (onfulfilled: any) => Promise.resolve(resolvedValue).then(onfulfilled),
      }),
      leftJoin: jest.fn().mockImplementation(() => chain),
      limit: jest.fn().mockResolvedValue(resolvedValue),
      then: (onfulfilled: any) => Promise.resolve(resolvedValue).then(onfulfilled),
    };
    return { from: jest.fn().mockReturnValue(chain) };
  };

  const found = (row: any) => createQueryChain([row]);

  // post() re-reads the warehouse before anything else, so a warehouse taken
  // out of service after the receipt was drafted cannot receive stock. Every
  // post test queues this first.
  const activeWarehouse = () => found({ is_active: true, deleted_at: null });
  // post() re-reads the warehouse a second time for the silo item check —
  // a STORE short-circuits assertSiloDestination immediately, matching every
  // existing post test's non-silo warehouse.
  const nonSiloWarehouse = () => found({ location_id: 'wh-1', location_type: 'STORE' });
  // The other branch of the same re-read: a SILO destination routes through
  // SiloFeedService instead of short-circuiting.
  const siloWarehouse = () => found({ location_id: 'wh-1', location_type: 'SILO', location_name: 'Feed Silo 01' });
  const mockAssertCanReceive = jest.fn();
  const mockWritePositiveEntry = jest.fn();

  beforeEach(async () => {
    mockDbSelect.mockReset();
    // Posting looks up which lines are biological assets (14 Oct); unless a test says otherwise, none are.
    mockDbSelect.mockReturnValue(createQueryChain([]));
    mockDbUpdate.mockReset();
    mockAssertCanReceive.mockReset().mockResolvedValue(undefined);
    mockWritePositiveEntry.mockReset().mockResolvedValue({ entry_no: 1 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoodsReceiptService,
        { provide: ClsService, useValue: transactionCls(mockDb) },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), hasMapping: jest.fn().mockResolvedValue(false), postBatchCostEntry: jest.fn() } },
        { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
        { provide: NumberSeriesService, useValue: numberSeriesMock },
      ],
    }).compile();

    service = module.get<GoodsReceiptService>(GoodsReceiptService);
  });

  describe('post', () => {
    it('rejects posting when the ANIMAL_SUPPLIER vendor has no health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: null, supplier_name: 'Animal Farm Co' }));

      await expect(service.post('gr-1', 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    it('allows posting when the ANIMAL_SUPPLIER vendor has a health_cert_url on file', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1' } as any) // initial load
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-1', status: 'POSTED' } as any); // final return

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-1', vendor_type: 'ANIMAL_SUPPLIER', health_cert_url: 'https://certs.example.com/farm.pdf' }));
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-1', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('allows posting for a non-ANIMAL_SUPPLIER vendor regardless of health_cert_url', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2' } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: 'sup-2', status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(found({ supplier_id: 'sup-2', vendor_type: 'FEED_SUPPLIER', health_cert_url: null }));
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-2', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
    });

    it('posts a biological-asset line as a + entry in the Bio Asset Ledger, with no inventory entry (14 Oct)', async () => {
      const sowLine = { line_id: 'line-sow', item_id: 'sow-item', quantity: '5', uom: 'HEAD', rate: '1500', lot_no: null };
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, receipt_no: 'GR-000099', posting_date: '2026-10-14', supplier_id: null, lines: [sowLine] } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ item_id: 'sow-item', nob_id: 'nob-1', lob_id: 'lob-1' }]) }) });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
      const values = jest.fn().mockResolvedValue({});
      mockDbInsert.mockReturnValue({ values });

      await service.post('gr-1', 'tenant-123', { userId: 'user-1' });

      expect(mockWritePositiveEntry).not.toHaveBeenCalled();
      expect(values).toHaveBeenCalledWith(expect.objectContaining({
        entry_type: 'POSITIVE', transaction_type: 'PURCHASE', document_type: 'GOODS_RECEIPT', document_no: 'GR-000099', document_line_id: 'line-sow',
        bio_asset_item_id: 'sow-item', quantity: '5.0000', remaining_quantity: '5.0000', cost_amount: '7500.0000',
        cost_amount_each_unit: '1500.0000', warehouse_id: 'wh-1', uom: 'HEAD',
      }));
    });

    describe('the journal for animals received (Dr Biological Assets / Cr Trade Payables)', () => {
      const glMock = { postInventoryLedgerEntry: jest.fn(), hasMapping: jest.fn(), postBatchCostEntry: jest.fn(), assetAccountForItem: jest.fn() };
      const sowLine = { line_id: 'line-sow', item_id: 'sow-item', quantity: '5', uom: 'HEAD', rate: '1500', lot_no: null };

      const postAnimals = async (mapped: boolean) => {
        glMock.postInventoryLedgerEntry.mockReset();
        glMock.hasMapping.mockReset().mockResolvedValue(mapped);
        glMock.postBatchCostEntry.mockReset().mockResolvedValue({});
        glMock.assetAccountForItem.mockReset().mockResolvedValue('acct-1060');
        const module: TestingModule = await Test.createTestingModule({
          providers: [
            GoodsReceiptService,
            { provide: ClsService, useValue: transactionCls(mockDb) },
            { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
            { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
            { provide: GlPostingService, useValue: glMock },
            { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
            { provide: NumberSeriesService, useValue: numberSeriesMock },
          ],
        }).compile();
        service = module.get<GoodsReceiptService>(GoodsReceiptService);
        jest.spyOn(service, 'findOne')
          .mockResolvedValueOnce({ ...draftReceipt, receipt_no: 'GR-000099', posting_date: '2026-10-14', supplier_id: null, lines: [sowLine] } as any)
          .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);
        mockDbSelect.mockReturnValueOnce(activeWarehouse());
        mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
        mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ item_id: 'sow-item', nob_id: 'nob-1', lob_id: 'lob-1' }]) }) });
        mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
        mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
        await service.post('gr-1', 'tenant-123', { userId: 'user-1' });
      };

      it('posts what the receipt says the animals cost, recorded against the receipt, with no inventory journal', async () => {
        await postAnimals(true);
        expect(glMock.hasMapping).toHaveBeenCalledWith('tenant-123', 'comp-1', 'BIO_ACQUISITION', { nobId: 'nob-1', lobId: 'lob-1' });
        expect(glMock.postBatchCostEntry).toHaveBeenCalledWith(expect.objectContaining({
          transactionType: 'BIO_ACQUISITION', amount: 7500, documentNo: 'GR-000099', documentLineId: 'line-sow', postingDate: '2026-10-14',
          sourceDocumentType: 'GOODS_RECEIPT', nobId: 'nob-1', lobId: 'lob-1', userId: 'user-1',
          // carried in the class account the profiles that cover the item agree on
          debitAccountId: 'acct-1060',
        }));
        expect(glMock.assetAccountForItem).toHaveBeenCalledWith('tenant-123', 'comp-1', 'sow-item');
        expect(glMock.postInventoryLedgerEntry).not.toHaveBeenCalled();
      });

      it('posts no journal where the BIO_ACQUISITION mapping is not set up, as before', async () => {
        await postAnimals(false);
        expect(glMock.postBatchCostEntry).not.toHaveBeenCalled();
      });
    });

    it('allows posting when the receipt has no supplier_id at all', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockDbSelect).toHaveBeenCalledTimes(4); // warehouse-active + silo-destination + biological-asset + the line's costing reads — no supplier lookup needed
      expect(result.status).toBe('POSTED');
    });

    // The other branch of assertSiloDestination: a SILO warehouse routes
    // through SiloFeedService with the receipt's own item ids, instead of
    // short-circuiting like every test above (all of which use a STORE).
    it('routes a SILO destination through SiloFeedService.assertCanReceive before posting', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(siloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockAssertCanReceive).toHaveBeenCalledWith(
        expect.objectContaining({
          siloId: 'wh-1',
          companyId: 'comp-1',
          itemIds: ['item-1'],
          documentLabel: 'GRN',
        }),
      );
      expect(result.status).toBe('POSTED');
    });

    // 16 Oct: feed no longer has to come from the mill. A GRN of a FEED item
    // straight into a silo posts, guarded only by D9 (assertCanReceive).
    it('posts a GRN of a FEED item into a SILO, through the item-per-silo check', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(siloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(mockAssertCanReceive).toHaveBeenCalledWith(
        expect.objectContaining({ siloId: 'wh-1', itemIds: ['item-1'], documentLabel: 'GRN' }),
      );
      expect(result.status).toBe('POSTED');
      expect(mockWritePositiveEntry).toHaveBeenCalled();
    });

    it('aborts the post before the DRAFT -> POSTED claim when SiloFeedService refuses the item', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any);

      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(siloWarehouse());
      mockAssertCanReceive.mockRejectedValue(new BadRequestException(
        "Cannot post this GRN — silo 'Feed Silo 01' already holds 'FEED-GROWER'. A silo holds one feed item at a time; empty it before moving a different item in.",
      ));

      await expect(service.post('gr-3', 'tenant-123', { userId: 'user-1' })).rejects.toThrow(/already holds 'FEED-GROWER'/);

      // Refused before the status transition and before any stock movement.
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockWritePositiveEntry).not.toHaveBeenCalled();
    });
  });

  // Phase 1 access foundation, Task 7: goods receipts belong to the farm
  // holding their warehouse (common/farm-scope.ts locationOnFarm). Modelled
  // on breeding.service.spec.ts / batch-daily-data.service.spec.ts's
  // table-keyed db mock — it answers by table, not by call order, and
  // captures the last `.where()` condition so a test can render the SQL and
  // check the farm join made it in. Local to this describe because the outer
  // suite's mock answers by call order instead.
  // Ruling M6: a posting re-checks silo levels once, only after its
  // transaction has committed, and nothing that goes wrong in that re-check
  // can fail the posting it follows.
  describe('a STANDARD-costed item received at another price', () => {
    const glMock = { postInventoryLedgerEntry: jest.fn(), hasMapping: jest.fn(), postPurchasePriceVariance: jest.fn() };
    const line = (rate: string) => ({ ...draftReceipt, supplier_id: null, lines: [{ line_id: 'line-1', item_id: 'item-1', quantity: '5', uom: 'KG', rate }] });

    const postWith = async (rate: string, costing: object[], mapped = true) => {
      glMock.postInventoryLedgerEntry.mockReset().mockResolvedValue({});
      glMock.postPurchasePriceVariance.mockReset().mockResolvedValue({});
      glMock.hasMapping.mockReset().mockResolvedValue(mapped);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoodsReceiptService,
          { provide: ClsService, useValue: transactionCls(mockDb) },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
          { provide: GlPostingService, useValue: glMock },
          { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
          { provide: NumberSeriesService, useValue: numberSeriesMock },
        ],
      }).compile();
      service = module.get<GoodsReceiptService>(GoodsReceiptService);
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(line(rate) as any)
        .mockResolvedValueOnce({ ...line(rate), status: 'POSTED' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }); // no line is a bio asset
      mockDbSelect.mockReturnValueOnce(createQueryChain(costing));
      return service.post('gr-3', 'tenant-123', { userId: 'user-1' });
    };

    it('goes into stock at the standard cost, and what was paid above it is posted as a price variance', async () => {
      await postWith('12', [{ valuation_method: 'STANDARD', standard_cost: '10.000000' }]);
      expect(mockWritePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ rate: 10, quantity: 5, transactionType: 'PURCHASE' }));
      // paid 12, standard 10, 5 units: 10.00 over
      expect(glMock.postPurchasePriceVariance).toHaveBeenCalledWith(expect.anything(), 10, 'user-1');
    });

    it('a price below standard is a favourable variance (negative)', async () => {
      await postWith('8', [{ valuation_method: 'STANDARD', standard_cost: '10.000000' }]);
      expect(mockWritePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ rate: 10 }));
      expect(glMock.postPurchasePriceVariance).toHaveBeenCalledWith(expect.anything(), -10, 'user-1');
    });

    it('a price equal to the standard has no variance to post', async () => {
      await postWith('10', [{ valuation_method: 'STANDARD', standard_cost: '10.000000' }]);
      expect(glMock.postPurchasePriceVariance).not.toHaveBeenCalled();
    });

    it('an item of another method goes in at the price paid, with no variance', async () => {
      await postWith('12', [{ valuation_method: 'FIFO', standard_cost: '10.000000' }]);
      expect(mockWritePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ rate: 12 }));
      expect(glMock.postPurchasePriceVariance).not.toHaveBeenCalled();
    });

    it('goes in at the price paid when the variance mappings are not set up, so the payable is never short', async () => {
      await postWith('12', [{ valuation_method: 'STANDARD', standard_cost: '10.000000' }], false);
      expect(mockWritePositiveEntry).toHaveBeenCalledWith(expect.objectContaining({ rate: 12 }));
      expect(glMock.postPurchasePriceVariance).not.toHaveBeenCalled();
    });
  });

  describe('feed alert hook', () => {
    const postedReceipt = () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null } as any)
        .mockResolvedValueOnce({ ...draftReceipt, supplier_id: null, status: 'POSTED' } as any);
      mockDbSelect.mockReturnValueOnce(activeWarehouse());
      mockDbSelect.mockReturnValueOnce(nonSiloWarehouse());
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ affectedRows: 1 }]) }) });
    };

    const build = async (feedAlerts: unknown, cls: ClsService) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoodsReceiptService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: mockWritePositiveEntry } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), hasMapping: jest.fn().mockResolvedValue(false), postBatchCostEntry: jest.fn() } },
          { provide: SiloFeedService, useValue: { assertCanReceive: mockAssertCanReceive } },
          { provide: NumberSeriesService, useValue: numberSeriesMock },
          { provide: FeedAlertService, useValue: feedAlerts },
        ],
      }).compile();
      service = module.get<GoodsReceiptService>(GoodsReceiptService);
    };

    it('re-checks the receipt location once, after the transaction has committed', async () => {
      const cls = transactionCls(mockDb);
      let committed = false;
      mockDbTransaction.mockImplementationOnce(async (work: (tx: any) => Promise<any>) => {
        const result = await work(mockDb);
        committed = true;
        return result;
      });
      const seen: Array<{ committed: boolean; inTx: unknown }> = [];
      const feedAlerts = { evaluateLevelsSafely: jest.fn(async () => { seen.push({ committed, inTx: cls.get('tenantPostingTransaction') }); }) };
      await build(feedAlerts, cls);
      postedReceipt();

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(feedAlerts.evaluateLevelsSafely).toHaveBeenCalledTimes(1);
      expect(feedAlerts.evaluateLevelsSafely).toHaveBeenCalledWith(['wh-1'], 'tenant-123');
      expect(seen).toEqual([{ committed: true, inTx: undefined }]);
    });

    it('still posts when the re-check itself throws', async () => {
      const cls = transactionCls(mockDb);
      const feedAlerts = new FeedAlertService(cls, {} as any, {} as any, {} as any);
      const warn = jest.spyOn((feedAlerts as any).logger, 'warn').mockImplementation(() => undefined);
      await build(feedAlerts, cls);
      postedReceipt();
      // The biological-asset lookup of the post itself (14 Oct): no line is one.
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) });
      // The line's costing lookup (valuation method and standard cost): an ordinary item.
      mockDbSelect.mockReturnValueOnce(createQueryChain([]));
      // The hook's own read of the receipt warehouse fails: the receipt is already posted and must stay posted.
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockRejectedValue(new Error('alert_rule is locked')),
        }),
      });

      const result = await service.post('gr-3', 'tenant-123', { userId: 'user-1' });

      expect(result.status).toBe('POSTED');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('alert_rule is locked'));
    });
  });

  describe('farm scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    let cls: ReturnType<typeof transactionCls>;
    const rows = new Map<unknown, unknown[]>();
    let capturedWhere: unknown;

    /** Awaitable at any point, so .where(), .limit() and .offset() all resolve. */
    const chain = (result: unknown[]) => {
      const self: any = {
        from: () => self,
        where: (cond: unknown) => { capturedWhere ??= cond; return self; },
        limit: () => self,
        offset: () => self,
        orderBy: () => self,
        for: () => self,
        then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
      };
      return self;
    };

    const renderedWhere = () => new MySqlDialect().sqlToQuery(capturedWhere as any).sql;

    const validReceiptDto = {
      company_id: 'co-1',
      warehouse_id: 'wh-1',
      posting_date: '2026-01-01',
      lines: [{ item_id: 'item-1', quantity: 10, uom: 'KG' }],
    };

    beforeEach(async () => {
      rows.clear();
      capturedWhere = undefined;
      rows.set(schema.goodsReceipt, []);
      rows.set(schema.goodsReceiptLine, []);
      rows.set(schema.locationMaster, []);

      mockDbSelect.mockReset();
      mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));

      cls = transactionCls(mockDb);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          GoodsReceiptService,
          { provide: ClsService, useValue: cls },
          { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
          { provide: InventoryLedgerService, useValue: { writePositiveEntry: jest.fn().mockResolvedValue({ entry_no: 1 }) } },
          { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue({}), hasMapping: jest.fn().mockResolvedValue(false), postBatchCostEntry: jest.fn() } },
          { provide: SiloFeedService, useValue: { assertCanReceive: jest.fn().mockResolvedValue(undefined) } },
          { provide: NumberSeriesService, useValue: numberSeriesMock },
        ],
      }).compile();

      service = module.get<GoodsReceiptService>(GoodsReceiptService);
    });

    it('lists only receipts into locations on the active farm', async () => {
      useFarmScope(cls, grasmere);
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('puts the active-farm condition on receipt detail reads', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'grn-1' }]);
      await service.findOne('grn-1');
      expect(renderedWhere()).toContain('location_master lf');
    });

    it('bounds receipts by company when an operational admin selects no farm', async () => {
      useFarmScope(cls, { ...grasmere, farmId: null });
      await service.findAll({} as any, 'tenant-1');
      expect(renderedWhere()).toContain('`goods_receipt`.`company_id` = ?');
    });

    it('refuses a receipt into a location on another farm', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [{ location_id: 'store-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' }]);
      await expect(service.create({ ...validReceiptDto, warehouse_id: 'store-k' } as any, 'tenant-1'))
        .rejects.toThrow('Location is not on your active farm.');
    });

    // Item 2: an inactive/soft-deleted warehouse must not accept new stock.
    // assertLocationOnActiveFarm only checks the warehouse is on the right
    // farm/company/LOB, so these rows are on-farm (pass that check) but
    // is_active: false — before the fix, create/update/post never looked at
    // is_active at all and would have proceeded.
    it('refuses to create a receipt into an inactive location', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.locationMaster, [
        { location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', is_active: false, deleted_at: null },
      ]);
      await expect(service.create({ ...validReceiptDto, warehouse_id: 'wh-1' } as any, 'tenant-1'))
        .rejects.toThrow('The selected location is inactive.');
    });

    // The GRN number comes from the company's Goods Receipt number series, drawn inside the
    // insert transaction; it used to be MAX(receipt_no)+1 and ignored the Number Series master.
    describe('GRN numbering', () => {
      let values: jest.Mock;

      beforeEach(() => {
        useFarmScope(cls, grasmere);
        rows.set(schema.locationMaster, [
          { location_id: 'wh-1', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', is_active: true, deleted_at: null },
        ]);
        values = jest.fn().mockResolvedValue(undefined);
        mockDbInsert.mockReset();
        mockDbInsert.mockReturnValue({ values });
        Object.values(numberSeriesMock).forEach((fn) => fn.mockClear());
        numberSeriesMock.seriesCodeForDocument.mockResolvedValue('GOODS_RECEIPT');
        jest.spyOn(service as any, 'insertLines').mockResolvedValue(undefined);
        jest.spyOn(service, 'findOne').mockResolvedValue({ receipt_id: 'x' } as any);
      });

      it('asks for the company\'s Goods Receipt series, then draws from it inside the insert transaction', async () => {
        await service.create(validReceiptDto as any, 'tenant-1');

        expect(numberSeriesMock.seriesCodeForDocument).toHaveBeenCalledWith(
          'tenant-1', 'co-1', expect.objectContaining({ seriesCode: 'GOODS_RECEIPT', documentType: 'GOODS_RECEIPT', prefix: 'GR', seqLength: 6 }), expect.any(Function));
        expect(numberSeriesMock.generateNext).toHaveBeenCalledWith('GOODS_RECEIPT', 'tenant-1', 'co-1', mockDb);
        expect(values).toHaveBeenCalledWith(expect.objectContaining({ receipt_no: 'GR-000007' }));
      });

      it('draws from the series configured on the Number Series master, whatever code it has', async () => {
        numberSeriesMock.seriesCodeForDocument.mockResolvedValue('NS-GRN');

        await service.create(validReceiptDto as any, 'tenant-1');

        expect(numberSeriesMock.generateNext).toHaveBeenCalledWith('NS-GRN', 'tenant-1', 'co-1', mockDb);
      });
    });

    it('refuses to move a draft receipt into an inactive location on update', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'gr-1', status: 'DRAFT', company_id: 'co-1', warehouse_id: 'wh-1' }]);
      rows.set(schema.locationMaster, [
        { location_id: 'wh-2', parent: 'farm-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', is_active: false, deleted_at: null },
      ]);
      await expect(service.update('gr-1', { warehouse_id: 'wh-2' } as any, 'tenant-1'))
        .rejects.toThrow('The selected location is inactive.');
    });

    it('refuses to post a draft receipt whose location was deactivated after the draft was created', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.goodsReceipt, [{ receipt_id: 'gr-1', status: 'DRAFT', company_id: 'co-1', warehouse_id: 'wh-1' }]);
      rows.set(schema.locationMaster, [{ location_id: 'wh-1', is_active: false, deleted_at: null }]);
      await expect(service.post('gr-1', 'tenant-1')).rejects.toThrow('The selected location is inactive.');
    });
  });

  // C1: main.ts's global ValidationPipe runs whitelist + forbidNonWhitelisted,
  // so any property UpdateGoodsReceiptDto does not declare 400s the request
  // instead of being silently dropped. A unit test that calls service.update()
  // directly (as the tests above do) never goes through that pipe, so it
  // cannot see this — hence exercising the DTO itself the same way Nest does.
  describe('UpdateGoodsReceiptDto whitelist (regression for the edit-panel PUT 400)', () => {
    it('rejects a payload carrying company_id, the property the edit panel used to send', async () => {
      const instance = plainToInstance(UpdateGoodsReceiptDto, {
        company_id: 'co-1',
        warehouse_id: 'wh-1',
        posting_date: '2026-09-01',
        lines: [],
      });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors.some((e) => e.property === 'company_id')).toBe(true);
    });

    it('accepts the same payload once company_id is dropped, as the fixed edit panel now sends', async () => {
      // The warehouse and item ids must themselves satisfy the DTO's UUID
      // constraints, which the warehouse-integrity work tightened.
      const instance = plainToInstance(UpdateGoodsReceiptDto, {
        warehouse_id: '55555555-5555-4555-8555-555555555555',
        posting_date: '2026-09-01',
        supplier_id: undefined,
        external_reference_no: undefined,
        remarks: undefined,
        lines: [{ item_id: '11111111-1111-4111-8111-111111111111', quantity: 10, uom: 'KG' }],
      });
      const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
      expect(errors).toHaveLength(0);
    });
  });

  describe('serial number consolidation on receipt lines', () => {
    it('creates a single line with comma-separated serial numbers when receiving serial-tracked item', async () => {
      const insertedRows: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((val) => {
          if (Array.isArray(val)) {
            insertedRows.push(...val);
          } else {
            insertedRows.push(val);
          }
          return Promise.resolve([{ insertId: 1 }]);
        }),
      });

      // Item lookup returning serial-tracked item
      mockDbSelect.mockReturnValueOnce(found({
        item_id: 'item-ser-1',
        is_serial_tracked: true,
        is_lot_tracked: false,
      }));
      // Check existing serials returning none
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await (service as any).insertLines(
        'receipt-1',
        [
          {
            item_id: 'item-ser-1',
            quantity: 3,
            uom: 'PCS',
            serial_no: 'SN001, SN002, SN003',
          },
        ],
        'tenant-1',
        'comp-1',
      );

      // Verify that exactly 1 line was inserted with quantity 3 and comma-separated serials
      expect(insertedRows).toHaveLength(1);
      expect(insertedRows[0].quantity).toBe('3');
      expect(insertedRows[0].serial_no).toBe('SN001, SN002, SN003');
    });
  });

  describe('numbers taken from the item tracking series', () => {
    const capture = () => {
      const insertedRows: any[] = [];
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((val) => {
          insertedRows.push(...(Array.isArray(val) ? val : [val]));
          return Promise.resolve([{ insertId: 1 }]);
        }),
      });
      return insertedRows;
    };

    beforeEach(() => numberSeriesMock.generateNextNumbersById.mockReset());

    it('takes an automatic lot number from the series inside the save, rather than previewing it', async () => {
      const rows = capture();
      numberSeriesMock.generateNextNumbersById.mockResolvedValue({ next_number: 'LOT-00007', numbers: ['LOT-00007'] });
      mockDbSelect.mockReturnValueOnce(found({ item_id: 'item-lot', item_code: 'LOTITEM', is_lot_tracked: true, is_serial_tracked: false, tracking_series_id: 'ts-lot' }));

      await (service as any).insertLines('receipt-1', [{ item_id: 'item-lot', quantity: 5, uom: 'KG' }], 'comp-1', 'tenant-1', mockDb);

      expect(numberSeriesMock.generateNextNumbersById).toHaveBeenCalledWith('ts-lot', 1, 'tenant-1', 'comp-1', mockDb);
      expect(rows[0].lot_no).toBe('LOT-00007');
    });

    it('takes all of a receipt\'s automatic serial numbers in one allocation', async () => {
      const rows = capture();
      numberSeriesMock.generateNextNumbersById.mockResolvedValue({ next_number: 'SN-00021', numbers: ['SN-00021', 'SN-00022', 'SN-00023'] });
      mockDbSelect.mockReturnValueOnce(found({ item_id: 'item-ser', item_code: 'SERITEM', is_lot_tracked: false, is_serial_tracked: true, tracking_series_id: 'ts-ser' }));

      await (service as any).insertLines('receipt-1', [{ item_id: 'item-ser', quantity: 3, uom: 'PCS' }], 'comp-1', 'tenant-1', mockDb);

      expect(numberSeriesMock.generateNextNumbersById).toHaveBeenCalledTimes(1);
      expect(numberSeriesMock.generateNextNumbersById).toHaveBeenCalledWith('ts-ser', 3, 'tenant-1', 'comp-1', mockDb);
      expect(rows[0].serial_no).toBe('SN-00021, SN-00022, SN-00023');
    });

    it('does not take a number for a lot the user typed', async () => {
      capture();
      mockDbSelect.mockReturnValueOnce(found({ item_id: 'item-lot', item_code: 'LOTITEM', is_lot_tracked: true, tracking_series_id: 'ts-lot' }));
      await (service as any).insertLines('receipt-1', [{ item_id: 'item-lot', quantity: 5, uom: 'KG', lot_no: 'SUPPLIER-LOT-9' }], 'comp-1', 'tenant-1', mockDb);
      expect(numberSeriesMock.generateNextNumbersById).not.toHaveBeenCalled();
    });

    it('refuses a serial the ledger already holds, as it does when the receipt posts', async () => {
      mockDbSelect.mockReturnValueOnce(createQueryChain([{ serial_no: 'SN-00021, SN-00022' }]));
      await expect((service as any).assertSerialsNotReceived(mockDb, 'tenant-1', 'item-ser', 'SERITEM', ['SN-00022']))
        .rejects.toThrow(/already been received for item 'SERITEM'/);
    });

    it('lets a serial through when the ledger holds only a longer one that contains it (SN-1 vs SN-10)', async () => {
      mockDbSelect.mockReturnValueOnce(createQueryChain([{ serial_no: 'SN-10' }]));
      await expect((service as any).assertSerialsNotReceived(mockDb, 'tenant-1', 'item-ser', 'SERITEM', ['SN-1'])).resolves.toBeUndefined();
    });
  });
});
