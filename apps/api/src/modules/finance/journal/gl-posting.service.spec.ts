import { Test, TestingModule } from '@nestjs/testing';
import { GlPostingService } from './gl-posting.service';
import { JournalService } from './journal.service';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BadRequestException } from '@nestjs/common';

describe('GlPostingService', () => {
  let service: GlPostingService;

  const mockDbSelect = jest.fn();
  const mockDb = { select: mockDbSelect };
  const mockJournalService = { createAndPostSystemJournal: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };

  const itemLookup = (row: any) => ({
    from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(row ? [row] : []) }) }),
  });
  const mappingLookup = (rows: any[]) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }) });

  const baseLedgerEntry = {
    ledger_id: 'ledg-1',
    tenant_id: 'tenant-1',
    company_id: 'comp-1',
    item_id: 'item-1',
    item_code: 'ITEM-001',
    transaction_type: 'PURCHASE',
    category_id: null,
    nob_id: 'nob-1',
    lob_id: 'lob-1',
    document_type: 'GOODS_RECEIPT',
    document_no: 'GRN-001',
    posting_date: '2026-06-01',
    amount: '100.0000',
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockJournalService.createAndPostSystemJournal.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GlPostingService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: JournalService, useValue: mockJournalService },
      ],
    }).compile();

    service = module.get<GlPostingService>(GlPostingService);
  });

  it('resolves an existing wildcard-only mapping exactly as before (regression guard)', async () => {
    mockDbSelect
      .mockReturnValueOnce(itemLookup({ valuation_method: null }))
      .mockReturnValueOnce(mappingLookup([
        { item_category_id: null, nob_id: null, lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-dr', credit_gl_account_id: 'gl-cr' },
      ]));

    await service.postInventoryLedgerEntry(baseLedgerEntry as any);

    expect(mockJournalService.createAndPostSystemJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: expect.arrayContaining([expect.objectContaining({ glAccountId: 'gl-dr' })]),
      }),
    );
  });

  it('prefers a nob_id-specific mapping over a wildcard one for the same transaction type', async () => {
    mockDbSelect
      .mockReturnValueOnce(itemLookup({ valuation_method: null }))
      .mockReturnValueOnce(mappingLookup([
        { item_category_id: null, nob_id: null, lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-wildcard-dr', credit_gl_account_id: 'gl-wildcard-cr' },
        { item_category_id: null, nob_id: 'nob-1', lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-specific-dr', credit_gl_account_id: 'gl-specific-cr' },
      ]));

    await service.postInventoryLedgerEntry(baseLedgerEntry as any);

    expect(mockJournalService.createAndPostSystemJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        lines: expect.arrayContaining([expect.objectContaining({ glAccountId: 'gl-specific-dr' })]),
      }),
    );
  });

  it('posts under gl_mapping_type when a row names one, and under its transaction type otherwise', async () => {
    const resolve = jest.spyOn(service as any, 'resolveMapping').mockResolvedValue({ debit_gl_account_id: 'gl-dr', credit_gl_account_id: 'gl-cr' });
    mockDbSelect.mockReturnValue(itemLookup({ valuation_method: null }));

    await service.postInventoryLedgerEntry({ ...baseLedgerEntry, transaction_type: 'CONSUMPTION', gl_mapping_type: 'BIO_CONSUMPTION_PREMATURE' } as any);
    await service.postInventoryLedgerEntry({ ...baseLedgerEntry, transaction_type: 'CONSUMPTION', gl_mapping_type: null } as any);

    expect(resolve.mock.calls.map((c) => c[2])).toEqual(['BIO_CONSUMPTION_PREMATURE', 'CONSUMPTION']);
  });

  it('throws when no mapping matches at all', async () => {
    mockDbSelect
      .mockReturnValueOnce(itemLookup({ valuation_method: null }))
      .mockReturnValueOnce(mappingLookup([]));

    await expect(service.postInventoryLedgerEntry(baseLedgerEntry as any)).rejects.toThrow(BadRequestException);
  });

  it('postBatchCostEntry resolves using only nob_id/lob_id (no item context)', async () => {
    mockDbSelect.mockReturnValueOnce(mappingLookup([
      { item_category_id: null, nob_id: 'nob-1', lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-dr', credit_gl_account_id: 'gl-cr' },
    ]));

    await service.postBatchCostEntry({
      tenantId: 'tenant-1',
      companyId: 'comp-1',
      transactionType: 'MORTALITY',
      amount: 50,
      documentNo: 'BATCH-001',
      postingDate: '2026-06-01',
      nobId: 'nob-1',
    });

    expect(mockDbSelect).toHaveBeenCalledTimes(1); // no item lookup for postBatchCostEntry
    expect(mockJournalService.createAndPostSystemJournal).toHaveBeenCalled();
  });
  it('does not constrain dimensions omitted by batch costs, but retains supplied dimensions', async () => {
    let query: any;
    mockDbSelect.mockReturnValueOnce({ from: () => ({ where: (condition: any) => {
      query = new MySqlDialect().sqlToQuery(condition);
      return [{ debit_gl_account_id: 'gl-dr', credit_gl_account_id: 'gl-cr' }];
    } }) });
    await service.postBatchCostEntry({ tenantId: 'tenant-1', companyId: 'comp-1',
      transactionType: 'OVERHEAD', amount: 50, documentNo: 'BATCH-001',
      postingDate: '2026-06-01', nobId: 'nob-1' });
    expect(query.sql).not.toMatch(/valuation_method|item_category_id|stage_id|lob_id/);
    expect(query.sql).toContain('`nob_id` = ?');
    expect(query.sql).toContain('`nob_id` is null');
    expect(query.params).toContain('nob-1');
  });


  // Each farm has its own cost centre (decisions, 11 Oct).
  describe('an animal\'s own asset account', () => {
    const mapping = (over: object = {}) => mappingLookup([{ item_category_id: null, nob_id: null, lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-1050', credit_gl_account_id: 'gl-1010', ...over }]);
    const lines = () => (mockJournalService.createAndPostSystemJournal.mock.calls[0][0] as any).lines as Array<{ glAccountId: string; debitAmount: number; creditAmount: number }>;

    it('puts the whole debit of an inventory entry on the account named, and leaves the credit with the mapping', async () => {
      mockDbSelect.mockReturnValueOnce(itemLookup({ valuation_method: null })).mockReturnValueOnce(mapping());
      await service.postInventoryLedgerEntry(baseLedgerEntry as any, 'u1', { debitAccountId: 'gl-1060' });
      expect(lines().map((l) => [l.glAccountId, l.debitAmount, l.creditAmount])).toEqual([['gl-1060', 100, 0], ['gl-1010', 0, 100]]);
    });

    it('splits the debit of an entry between accounts in proportion to the parts, rescaled to the entry (the rounding on the last), the mapping taking a part with no account', async () => {
      mockDbSelect.mockReturnValueOnce(itemLookup({ valuation_method: null })).mockReturnValueOnce(mapping());
      // 3 parts of a 100.00 entry: 1 kg to class A, 1 kg to class A, 1 kg to an animal with no profile
      await service.postInventoryLedgerEntry(baseLedgerEntry as any, 'u1', { debitSplit: [{ accountId: 'gl-1060', amount: 1 }, { accountId: 'gl-1060', amount: 1 }, { accountId: null, amount: 1 }] });
      const l = lines();
      expect(l.filter((x) => x.debitAmount > 0).map((x) => [x.glAccountId, x.debitAmount])).toEqual([['gl-1060', 66.6667], ['gl-1050', 33.3333]]);
      expect(l.reduce((n, x) => n + x.debitAmount, 0)).toBeCloseTo(100, 4);
      expect(l.reduce((n, x) => n + x.creditAmount, 0)).toBeCloseTo(100, 4);
    });

    it('swaps the overridden accounts as the mapping\'s are for an unfavourable posting (the asset side stays the asset side)', async () => {
      mockDbSelect.mockReturnValue(mapping({ debit_gl_account_id: 'gl-1060', credit_gl_account_id: 'gl-4010' }));
      await service.postBatchCostEntry({ tenantId: 't', companyId: 'c', transactionType: 'BIO_DISPOSAL_SOLD', amount: 50, documentNo: 'A', postingDate: '2026-06-01', debitAccountId: 'gl-1065x', reverseDirection: true });
      expect(lines().map((l) => [l.glAccountId, l.debitAmount, l.creditAmount])).toEqual([['gl-4010', 50, 0], ['gl-1065x', 0, 50]]);
    });

    it('carries an animal in the acquisition account of her profile, and none for an animal with no profile', async () => {
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ innerJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([{ animal_id: 'a-1', account: 'gl-1060' }, { animal_id: 'a-2', account: null }]) }) }) });
      const accounts = await service.animalAssetAccountIds(['a-1', 'a-2', 'a-3']);
      expect(accounts.get('a-1')).toBe('gl-1060');
      expect(accounts.has('a-2')).toBe(false);
      expect(accounts.has('a-3')).toBe(false);
    });

    it('names an account for an item only where the active profiles that cover it agree on one', async () => {
      const profiles = (accounts: Array<string | null>) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(accounts.map((account) => ({ account }))) }) });
      mockDbSelect.mockReturnValueOnce(profiles(['gl-1060', 'gl-1060', 'gl-1060']));
      await expect(service.assetAccountForItem('t', 'c', 'item-1')).resolves.toBe('gl-1060');
      mockDbSelect.mockReturnValueOnce(profiles(['gl-1060', 'gl-1065']));
      await expect(service.assetAccountForItem('t', 'c', 'item-1')).resolves.toBeUndefined();
      mockDbSelect.mockReturnValueOnce(profiles([]));
      await expect(service.assetAccountForItem('t', 'c', 'item-1')).resolves.toBeUndefined();
    });
  });

  describe('farm cost centre on inventory journals', () => {
    const locLookup = (row: any) => ({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(row ? [row] : []) }) }),
    });
    const mapping = () => mappingLookup([
      { item_category_id: null, nob_id: null, lob_id: null, valuation_method: null, debit_gl_account_id: 'gl-dr', credit_gl_account_id: 'gl-cr' },
    ]);
    const postWith = async (locations: any[]) => {
      mockDbSelect.mockReturnValueOnce(itemLookup({ valuation_method: null })).mockReturnValueOnce(mapping());
      for (const l of locations) mockDbSelect.mockReturnValueOnce(locLookup(l));
      await service.postInventoryLedgerEntry({ ...baseLedgerEntry, location_id: 'silo-1' } as any);
      return mockJournalService.createAndPostSystemJournal.mock.calls[0][0].lines;
    };

    it("puts the owning farm's cost centre on both lines, walking up from a silo", async () => {
      const lines = await postWith([
        { location_type: 'SILO', parent_location_id: 'farm-1', farm_id: 'farm-1', cost_center_id: null },
        { location_type: 'FARM', parent_location_id: null, farm_id: null, cost_center_id: 'cc-farm' },
      ]);
      expect(lines.map((l: any) => l.costCenterId)).toEqual(['cc-farm', 'cc-farm']);
    });

    it('uses the mill for a bin under a mill', async () => {
      const lines = await postWith([
        { location_type: 'BIN', parent_location_id: 'mill-1', farm_id: null, cost_center_id: null },
        { location_type: 'MILL', parent_location_id: null, farm_id: null, cost_center_id: 'cc-mill' },
      ]);
      expect(lines[0].costCenterId).toBe('cc-mill');
    });

    it('leaves the cost centre undefined (NULL) when the farm has none, and still posts', async () => {
      const lines = await postWith([{ location_type: 'FARM', parent_location_id: null, farm_id: null, cost_center_id: null }]);
      expect(lines.map((l: any) => l.costCenterId)).toEqual([undefined, undefined]);
    });

    it('does not look anything up for a ledger row with no location', async () => {
      mockDbSelect.mockReturnValueOnce(itemLookup({ valuation_method: null })).mockReturnValueOnce(mapping());
      await service.postInventoryLedgerEntry(baseLedgerEntry as any);
      expect(mockDbSelect).toHaveBeenCalledTimes(2);
    });
  });
});
