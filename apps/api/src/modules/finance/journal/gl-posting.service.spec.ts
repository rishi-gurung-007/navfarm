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

});
