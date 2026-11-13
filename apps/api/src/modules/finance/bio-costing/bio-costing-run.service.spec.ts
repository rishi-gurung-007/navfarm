import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { BioCostingRunService } from './bio-costing-run.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { JournalService } from '../journal/journal.service';
import { GlPostingService } from '../journal/gl-posting.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { BioCostingSubjectService } from './bio-costing-subject.service';
import { subjectFromItem } from './bio-costing-subject';

describe('BioCostingRunService — the controls that refuse before anything is written', () => {
  const queue: unknown[][] = [];
  const writes: string[] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, leftJoin: () => self, innerJoin: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = {
    select: jest.fn(() => chain(queue.shift() ?? [])),
    selectDistinct: jest.fn(() => chain(queue.shift() ?? [])),
    insert: jest.fn(() => ({ values: () => { writes.push('insert'); return Promise.resolve(); } })),
    update: jest.fn(() => ({ set: () => ({ where: () => { writes.push('update'); return Promise.resolve(); } }) })),
    delete: jest.fn(() => ({ where: () => { writes.push('delete'); return Promise.resolve(); } })),
  };
  let service: BioCostingRunService;
  const journals = { createAndPostSystemJournal: jest.fn() };
  const gl = { reverseJournal: jest.fn() };

  const itemRow = {
    item_id: 'i1', item_code: 'GP-Imp-F', tenant_id: 't', company_id: 'c', is_active: true, is_blocked: false, deleted_at: null, is_biological_asset: true,
    bio_costing_method: 'AMORTIZATION', bio_gender: 'F', bio_start_age_weeks: 33, bio_start_age_days: 0, bio_useful_life_months: 36, bio_residual_rule: 'NONE', bio_run_frequency: 'MONTHLY',
    bio_day_basis: 'FREQUENCY_DAYS', bio_auto_post: false, bio_effective_from: '2026-01-01', bio_acquisition_gl_id: 'g1', bio_accum_amort_gl_id: null, bio_amort_expense_gl_id: 'g3', bio_fv_gain_loss_gl_id: null, bio_writeoff_gl_id: 'g4',
  };
  const run = { run_id: 'r1', tenant_id: 't', company_id: 'c', run_no: 'BCR-2026-00001', profile_id: null, item_id: 'i1', method: 'AMORTIZATION', frequency: 'MONTHLY', period_key: '2026-09', period_start: '2026-09-01', period_end: '2026-09-30', status: 'CALCULATED', journal_id: null, days_enforced: null };
  // a run made when a costing profile costed animals: it names no item
  const legacyRun = { ...run, item_id: null };

  // What each run is made for, as the subject service loads it. `currentItem` is the item a test wants to be loaded.
  let currentItem: any;
  const subjects = {
    loadItem: jest.fn(async () => subjectFromItem(currentItem)),
    ofRun: jest.fn(async (r: { item_id: string | null }) => { if (!r.item_id) throw new Error('This run was made for a costing profile'); return subjectFromItem(currentItem); }),
    ratesOf: jest.fn().mockResolvedValue([]),
  };

  beforeEach(async () => {
    queue.length = 0; writes.length = 0; jest.clearAllMocks();
    currentItem = itemRow;
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingRunService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : k === 'tenantPostingTransaction' ? true : undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: JournalService, useValue: journals },
        { provide: GlPostingService, useValue: gl },
        { provide: AnimalBookValueService, useValue: { valuesFor: jest.fn().mockResolvedValue(new Map()), refreshCache: jest.fn() } },
        { provide: BioCostingSubjectService, useValue: subjects },
      ],
    }).compile();
    service = moduleRef.get(BioCostingRunService);
  });

  const standing = (over: Record<string, unknown>) => ({ item_id: 'i1', item_code: 'GP-Imp-F', is_bio: true, method: 'AMORTIZATION', ...over });

  it('costs a batch by making one run for each item its animals belong to, each restricted to the batch, and reports one that could not be made', async () => {
    queue.push([{ id: 'b1' }], [
      standing({ item_id: 'i2', item_code: 'GP-Loc-F' }),
      standing({ item_id: 'i1', item_code: 'GP-Imp-F' }),
    ]);
    const calculate = jest.spyOn(service, 'calculate')
      .mockResolvedValueOnce({ run_no: 'BCR-2026-00001' } as any)
      .mockRejectedValueOnce(new Error('Period 2026-09 has already been run for GP-Loc-F in this batch (BCR-2026-00002).'));
    const result = await service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c');
    expect(result.runs).toHaveLength(1);
    expect(result.failed).toEqual([{ item_code: 'GP-Loc-F', error: expect.stringMatching(/already been run/) }]);
    // in code order: GP-Imp-F first
    expect(calculate).toHaveBeenNthCalledWith(1, expect.objectContaining({ item_id: 'i1', batch_id: 'b1', period_key: '2026-09' }), 't', undefined);
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({ item_id: 'i2', batch_id: 'b1' }), 't', undefined);
  });

  it('costs only the item asked for when one is given (TDD row 8: the fixed asset filter)', async () => {
    queue.push([{ id: 'b1' }], [standing({ item_id: 'i2', item_code: 'GP-Loc-F' }), standing({ item_id: 'i1', item_code: 'GP-Imp-F' })]);
    const calculate = jest.spyOn(service, 'calculate').mockResolvedValue({ run_no: 'BCR-2026-00001' } as any);
    const result = await service.calculateBatch({ batch_id: 'b1', item_id: 'i2', period_key: '2026-09' }, 't', 'c');
    expect(result.runs).toHaveLength(1);
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(calculate).toHaveBeenCalledWith(expect.objectContaining({ item_id: 'i2' }), 't', undefined);
  });

  it('says once that the period is already costed when every item has nothing left to run', async () => {
    queue.push([{ id: 'b1' }], [standing({ item_id: 'i1', item_code: 'GP-Imp-F' }), standing({ item_id: 'i2', item_code: 'GP-Loc-F' })]);
    jest.spyOn(service, 'calculate').mockRejectedValue(new Error('Nothing to run for X in 2026-09: every animal of it is already costed.'));
    await expect(service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c')).rejects.toThrow('Nothing to run: every animal of GP-Imp-F, GP-Loc-F is already costed by a posted run for this period in this batch.');
  });

  it('leaves out an item with no costing terms, and refuses a batch that is not this company\'s or that no costed item has animals in', async () => {
    queue.push([]);
    await expect(service.calculateBatch({ batch_id: 'nope', period_key: '2026-09' }, 't', 'c')).rejects.toThrow(/not a batch of this company/);
    queue.push([{ id: 'b1' }], []);
    await expect(service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c')).rejects.toThrow(/No animal of this batch belongs to an item with costing terms/);
    queue.push([{ id: 'b1' }], [standing({ method: null })]); // an item with no costing method costs nothing
    await expect(service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c')).rejects.toThrow(/No animal of this batch belongs to an item with costing terms/);
    expect(writes).toEqual([]);
  });

  it('needs an item to run', async () => {
    await expect(service.calculate({ period_key: '2026-09' } as any, 't')).rejects.toThrow(/Name the item to run/);
  });

  it('refuses a period that has not ended (V4), before touching the book values', async () => {
    await expect(service.calculate({ item_id: 'i1', period_date: '2999-01-15' } as any, 't')).rejects.toThrow(/has not happened yet/);
    expect(writes).toEqual([]);
  });

  it('refuses a period key that does not fit the frequency, and asks for a period when none is given', async () => {
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-Q3' } as any, 't')).rejects.toThrow(/not a monthly period/);
    await expect(service.calculate({ item_id: 'i1' } as any, 't')).rejects.toThrow(/Give the period/);
  });

  it('refuses an item with no costing method, an inactive one, and one that is not a company\'s own', async () => {
    currentItem = { ...itemRow, bio_costing_method: null };
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/GP-Imp-F has no costing method/);
    currentItem = { ...itemRow, is_active: false };
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/not active/);
    currentItem = { ...itemRow, company_id: null };
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/not a company's own item/);
    expect(writes).toEqual([]);
  });

  it('refuses a period inside a closed reporting period (V5)', async () => {
    queue.push([{ period_code: '2026-10', start_date: '2026-09-27', end_date: '2026-10-31', period_status: 'CLOSED' }]);
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/closed/);
    expect(writes).toEqual([]);
  });

  it('refuses to run a period behind a later posted run', async () => {
    queue.push([], [{ no: 'BCR-2026-00003', key: '2026-10' }]);
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/already posted after 2026-09/);
    expect(writes).toEqual([]);
  });

  it('makes no preview when every animal is already dealt with by a posted run of the period, so it cannot block the item\'s next period', async () => {
    // not behind a later run; no existing run; one animal on the item, and a posted run already has a line for her
    queue.push([], [], [], [{ a: { animal_id: 'a1' }, farm_id: null }], [], [{ id: 'a1' }]);
    await expect(service.calculate({ item_id: 'i1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/Nothing to run for GP-Imp-F in 2026-09/);
    expect(writes).toEqual([]);
  });

  it('refuses a second run of a period that is already posted, and posts nothing twice', async () => {
    queue.push([{ ...run, status: 'POSTED' }]);
    await expect(service.post('r1', 't')).rejects.toThrow(/already posted/);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('will not post a run whose item lacks its accounts, and writes nothing', async () => {
    queue.push([run], []); // run, then the closed-period check finds nothing
    await expect(service.post('r1', 't')).rejects.toThrow(/Item GP-Imp-F is missing GL accounts: accumulated amortisation/);
    expect(writes).toEqual([]);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('will not post a run made for a costing profile, which no longer costs animals', async () => {
    queue.push([legacyRun]);
    await expect(service.post('r1', 't')).rejects.toThrow(/costing profile/);
    expect(writes).toEqual([]);
  });

  it('reverses only a posted run, and only the latest of its item, and needs the reason', async () => {
    queue.push([run]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/only a posted run/);
    queue.push([{ ...run, status: 'POSTED' }], [{ no: 'BCR-2026-00004' }]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/reverse the latest run first/);
    expect(gl.reverseJournal).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('still reverses an old run made for a costing profile: it needs no item, only its own rows', async () => {
    queue.push([{ ...legacyRun, status: 'POSTED' }], [{ no: 'BCR-2026-00004' }]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/reverse the latest run first/);
  });

  it('names each run by its item, and an old run that names no item by the items of the animals on its lines', async () => {
    const itemRun = { ...run, run_id: 'r-item' };
    const oldRun = { ...run, run_id: 'r-old', item_id: null };
    // the runs; the code of the item run's item; the (run, item code) pairs of the old run's lines
    queue.push([itemRun, oldRun], [{ id: 'i1', code: 'GP-Imp-F' }], [{ run_id: 'r-old', code: 'GP-Loc-M' }, { run_id: 'r-old', code: 'GP-Imp-M' }]);
    const rows = await service.findAll({} as any, 't', 'c');
    expect(rows.map((r: any) => [r.run_id, r.subject_code])).toEqual([['r-item', 'GP-Imp-F'], ['r-old', 'GP-Imp-M, GP-Loc-M']]);
  });

  it('will not reverse a run whose animal has since left the herd: her exit was valued with the charge in it', async () => {
    queue.push([{ ...run, status: 'POSTED' }], [], [{ animal_id: 'a1' }], [{ code: 'PIG-2025-0010', date: '2026-10-15' }]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/PIG-2025-0010 left the herd on 2026-10-15.*cannot be reversed/);
    expect(gl.reverseJournal).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
