import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { BioCostingRunService } from './bio-costing-run.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { JournalService } from '../journal/journal.service';
import { GlPostingService } from '../journal/gl-posting.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { BioCostingResidualService } from './bio-costing-residual.service';

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

  const profile = {
    profile_id: 'p1', tenant_id: 't', company_id: 'c', profile_code: 'IMP-F', costing_method: 'AMORTIZATION', run_frequency: 'MONTHLY', tracking: 'INDIVIDUAL',
    status: 'ACTIVE', start_age_weeks: 33, useful_life_months: 36, acquisition_gl_id: 'g1', accum_amort_gl_id: null, amort_expense_gl_id: 'g3', fv_gain_loss_gl_id: null, writeoff_gl_id: 'g4',
  };
  const run = { run_id: 'r1', tenant_id: 't', company_id: 'c', run_no: 'BCR-2026-00001', profile_id: 'p1', method: 'AMORTIZATION', frequency: 'MONTHLY', period_key: '2026-09', period_start: '2026-09-01', period_end: '2026-09-30', status: 'CALCULATED', journal_id: null, days_enforced: null };

  beforeEach(async () => {
    queue.length = 0; writes.length = 0; jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingRunService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : k === 'tenantPostingTransaction' ? true : undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: JournalService, useValue: journals },
        { provide: GlPostingService, useValue: gl },
        { provide: AnimalBookValueService, useValue: { valuesFor: jest.fn().mockResolvedValue(new Map()), refreshCache: jest.fn() } },
        { provide: BioCostingResidualService, useValue: { settingsOf: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = moduleRef.get(BioCostingRunService);
  });

  it('costs a batch by making one run for each profile its animals carry, each restricted to the batch, and reports one that could not be made', async () => {
    queue.push([{ id: 'b1' }], [{ id: 'p1', code: 'IMP-F' }, { id: 'p2', code: 'LOC-F' }]);
    const calculate = jest.spyOn(service, 'calculate')
      .mockResolvedValueOnce({ run_no: 'BCR-2026-00001' } as any)
      .mockRejectedValueOnce(new Error('Period 2026-09 has already been run for LOC-F in this batch (BCR-2026-00002).'));
    const result = await service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c');
    expect(result.runs).toHaveLength(1);
    expect(result.failed).toEqual([{ profile_code: 'LOC-F', error: expect.stringMatching(/already been run/) }]);
    expect(calculate).toHaveBeenNthCalledWith(1, expect.objectContaining({ profile_id: 'p1', batch_id: 'b1', period_key: '2026-09' }), 't', undefined);
    expect(calculate).toHaveBeenNthCalledWith(2, expect.objectContaining({ profile_id: 'p2', batch_id: 'b1' }), 't', undefined);
  });

  it('refuses a batch that is not this company\'s, and one none of whose animals has a costing profile', async () => {
    queue.push([]);
    await expect(service.calculateBatch({ batch_id: 'nope', period_key: '2026-09' }, 't', 'c')).rejects.toThrow(/not a batch of this company/);
    queue.push([{ id: 'b1' }], []);
    await expect(service.calculateBatch({ batch_id: 'b1', period_key: '2026-09' }, 't', 'c')).rejects.toThrow(/No animal of this batch is costed/);
    expect(writes).toEqual([]);
  });

  it('refuses a period that has not ended (V4), before touching the book values', async () => {
    queue.push([profile]);
    await expect(service.calculate({ profile_id: 'p1', period_date: '2999-01-15' } as any, 't')).rejects.toThrow(/has not happened yet/);
    expect(writes).toEqual([]);
  });

  it('refuses a period key that does not fit the profile\'s frequency, and asks for a period when none is given', async () => {
    queue.push([profile]);
    await expect(service.calculate({ profile_id: 'p1', period_key: '2026-Q3' } as any, 't')).rejects.toThrow(/not a monthly period/);
    queue.push([profile]);
    await expect(service.calculate({ profile_id: 'p1' } as any, 't')).rejects.toThrow(/Give the period/);
  });

  it('refuses a draft profile and a batch-tracked one', async () => {
    queue.push([{ ...profile, status: 'DRAFT' }]);
    await expect(service.calculate({ profile_id: 'p1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/DRAFT/);
    queue.push([{ ...profile, tracking: 'BATCH' }]);
    await expect(service.calculate({ profile_id: 'p1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/batch-tracked.*individually tracked animals only/);
  });

  it('refuses a period inside a closed reporting period (V5)', async () => {
    queue.push([profile], [{ period_code: '2026-10', start_date: '2026-09-27', end_date: '2026-10-31', period_status: 'CLOSED' }]);
    await expect(service.calculate({ profile_id: 'p1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/closed/);
    expect(writes).toEqual([]);
  });

  it('refuses to run a period behind a later posted run', async () => {
    queue.push([profile], [], [{ no: 'BCR-2026-00002', key: '2026-10' }]);
    await expect(service.calculate({ profile_id: 'p1', period_key: '2026-09' } as any, 't')).rejects.toThrow(/already posted after 2026-09/);
    expect(writes).toEqual([]);
  });

  it('refuses a second run of a period that is already posted, and posts nothing twice', async () => {
    queue.push([{ ...run, status: 'POSTED' }]);
    await expect(service.post('r1', 't')).rejects.toThrow(/already posted/);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('will not post a run whose profile lacks its accounts, and writes nothing', async () => {
    queue.push([run], [profile], []); // run, its profile, then the ordering check finds no later run
    await expect(service.post('r1', 't')).rejects.toThrow(/missing GL accounts: accumulated amortisation/);
    expect(writes).toEqual([]);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('reverses only a posted run, and only the latest of its profile, and needs the reason', async () => {
    queue.push([run]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/only a posted run/);
    queue.push([{ ...run, status: 'POSTED' }], [{ no: 'BCR-2026-00002' }]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/reverse the latest run first/);
    expect(gl.reverseJournal).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('will not reverse a run whose animal has since left the herd: her exit was valued with the charge in it', async () => {
    queue.push([{ ...run, status: 'POSTED' }], [], [{ animal_id: 'a1' }], [{ code: 'PIG-2025-0010', date: '2026-10-15' }]);
    await expect(service.reverse('r1', 'typo', 't')).rejects.toThrow(/PIG-2025-0010 left the herd on 2026-10-15.*cannot be reversed/);
    expect(gl.reverseJournal).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });
});
