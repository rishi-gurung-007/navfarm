import { linkLedgerJournals } from './animal-ledger-journal';

const row = (over: Record<string, unknown> = {}) => ({
  entry_id: 'e1', document_no: 'BATCH-1', run_id: null, posting_date: '2026-01-05', cost_amount: '10.0000', bio_asset_item_id: 'item-a', ...over,
}) as any;
const journal = (id: string, debits: Array<[string, number]>, over: Record<string, unknown> = {}) => ({
  journal_id: id, journal_no: `JE-${id}`, posting_date: '2026-01-05', source_document_no: 'BATCH-1',
  debits: debits.map(([gl_account_id, amount]) => ({ gl_account_id, amount })), ...over,
}) as any;
const accounts = new Map([['item-a', 'acq-a']]);

describe('linkLedgerJournals', () => {
  it('links a row to the one journal of its document and day', () => {
    const links = linkLedgerJournals([row()], [journal('1', [['acq-a', 50]]), journal('2', [['acq-a', 5]], { posting_date: '2026-01-06' })], new Map(), accounts);
    expect(links.get('e1')?.journal_no).toBe('JE-1');
  });

  it('with several journals on the day, takes the one that debits her own account for at least her share', () => {
    const links = linkLedgerJournals([row()], [journal('x', [['acq-b', 50]]), journal('y', [['acq-a', 3]]), journal('z', [['acq-a', 40]])], new Map(), accounts);
    expect(links.get('e1')?.journal_no).toBe('JE-z');
  });

  it('falls back to the journal with a big enough debit elsewhere, an expense journal', () => {
    const links = linkLedgerJournals([row()], [journal('x', [['acq-a', 1]]), journal('y', [['exp', 20]])], new Map(), accounts);
    expect(links.get('e1')?.journal_no).toBe('JE-y');
  });

  it('reads a costing run row by its run number, whatever the day', () => {
    const links = linkLedgerJournals(
      [row({ document_no: null, run_id: 'r1' })],
      [journal('r', [['acq-a', 9]], { source_document_no: 'BCR-1', posting_date: '2026-01-31' })],
      new Map([['r1', 'BCR-1']]),
      accounts,
    );
    expect(links.get('e1')?.journal_no).toBe('JE-r');
  });

  it('leaves a row with no journal unlinked', () => {
    expect(linkLedgerJournals([row()], [], new Map(), accounts).size).toBe(0);
  });
});

describe('linkLedgerJournals for expensed postings', () => {
  it('prefers the expense journal over one that debits her asset account', () => {
    const links = linkLedgerJournals(
      [row({ expensed: true, cost_amount: '10.0000' })],
      [journal('asset', [['acq-a', 50]]), journal('expense', [['exp', 50]])],
      new Map(),
      accounts,
    );
    expect(links.get('e1')?.journal_no).toBe('JE-expense');
  });
});
