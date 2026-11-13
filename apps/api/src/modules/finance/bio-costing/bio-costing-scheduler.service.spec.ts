import { Test } from '@nestjs/testing';
import { ClsService } from 'nestjs-cls';
import { BioCostingSchedulerService } from './bio-costing-scheduler.service';
import { BioCostingRunService } from './bio-costing-run.service';
import { ConnectionManagerService } from '../../../core/database/connection-manager.service';
import { MASTER_CONNECTION } from '../../../core/database/database.tokens';

describe('BioCostingSchedulerService', () => {
  const queue: unknown[][] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, orderBy: () => self, limit: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = { select: jest.fn(() => chain(queue.shift() ?? [])), selectDistinct: jest.fn(() => chain(queue.shift() ?? [])) };
  const runs = { calculate: jest.fn(), post: jest.fn(), recordFailure: jest.fn() };
  const masterSelect = jest.fn();
  let service: BioCostingSchedulerService;
  const realEnv = process.env.BIO_COSTING_SCHEDULER_ENABLED;

  // The queries, in the order the scheduler asks them: the items with animals; then, for each item, the first animal's costing start and the item's runs.
  const item = (o: object = {}) => ({
    item_id: 'i1', item_code: 'GP-Imp-F', tenant_id: 't', company_id: 'c', is_active: true, is_blocked: false, deleted_at: null, is_biological_asset: true,
    bio_costing_method: 'AMORTIZATION', bio_run_frequency: 'MONTHLY', bio_day_basis: 'FREQUENCY_DAYS', bio_auto_post: false, bio_effective_from: '2026-07-10', ...o,
  });
  const first = (date: string | null = '2026-07-01') => [{ first: date }];
  const run = (key: string, status = 'CALCULATED') => ({ run_id: `r-${key}`, run_no: `BCR-${key}`, period_key: key, status, charged_count: 2, skipped_count: 1, total_charge: '10.0000' });
  const postedFact = (key: string, end: string) => ({ status: 'POSTED', period_key: key, period_end: end, run_no: `BCR-${key}`, error_message: null });
  const byBatch = (batch: string, key: string, status = 'POSTED') => ({ status, period_key: key, period_end: `${key}-30`, run_no: `BCR-${batch}`, error_message: null, batch_id: batch });

  beforeEach(async () => {
    queue.length = 0; jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-10-20T10:00:00Z'));
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingSchedulerService,
        { provide: ClsService, useValue: { get: () => db, run: (fn: () => unknown) => fn(), set: jest.fn() } },
        { provide: MASTER_CONNECTION, useValue: { select: masterSelect } },
        { provide: ConnectionManagerService, useValue: { getTenantConnection: jest.fn().mockResolvedValue(db) } },
        { provide: BioCostingRunService, useValue: runs },
      ],
    }).compile();
    service = moduleRef.get(BioCostingSchedulerService);
  });
  afterEach(() => { jest.useRealTimers(); if (realEnv === undefined) delete process.env.BIO_COSTING_SCHEDULER_ENABLED; else process.env.BIO_COSTING_SCHEDULER_ENABLED = realEnv; });

  it('does nothing at all unless the timer is switched on', async () => {
    delete process.env.BIO_COSTING_SCHEDULER_ENABLED;
    await service.tick();
    expect(masterSelect).not.toHaveBeenCalled();
    process.env.BIO_COSTING_SCHEDULER_ENABLED = 'false';
    await service.tick();
    expect(masterSelect).not.toHaveBeenCalled();
  });

  it('calculates the oldest due period of an item and stops, leaving it waiting to be posted, when the item does not auto-post', async () => {
    queue.push([item()], first(), []);
    runs.calculate.mockResolvedValueOnce(run('2026-07'));
    const r = await service.runDueForTenant('t', {});
    expect(runs.calculate).toHaveBeenCalledTimes(1);
    expect(runs.calculate).toHaveBeenCalledWith({ item_id: 'i1', period_key: '2026-07' }, 't', undefined, 'SCHEDULED');
    expect(runs.post).not.toHaveBeenCalled();
    expect(r).toEqual([expect.objectContaining({ item_code: 'GP-Imp-F', outcome: 'CALCULATED', runs: [expect.objectContaining({ period_key: '2026-07', status: 'CALCULATED' })] })]);
  });

  it('with auto-post, posts each period and carries on through every finished period', async () => {
    queue.push([item({ bio_auto_post: true, bio_effective_from: '2026-07-10' })], first(), []);
    for (const k of ['2026-07', '2026-08', '2026-09']) { runs.calculate.mockResolvedValueOnce(run(k)); runs.post.mockResolvedValueOnce(run(k, 'POSTED')); }
    const r = await service.runDueForTenant('t', {});
    expect(runs.calculate.mock.calls.map((c) => c[0].period_key)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(runs.post).toHaveBeenCalledTimes(3);
    expect(r[0]).toMatchObject({ outcome: 'POSTED' });
  });

  it('waits behind a run that has been calculated but not posted, and runs nothing', async () => {
    queue.push([item()], first(), [{ status: 'CALCULATED', period_key: '2026-08', period_end: '2026-08-31', run_no: 'BCR-2026-00002', error_message: null }]);
    const r = await service.runDueForTenant('t', {});
    expect(runs.calculate).not.toHaveBeenCalled();
    expect(r).toEqual([{ item_code: 'GP-Imp-F', outcome: 'BLOCKED', blocked: { reason: 'WAITING_TO_POST', run_no: 'BCR-2026-00002', period_key: '2026-08' } }]);
  });

  it('reads a period costed batch by batch as done once every batch the item\'s animals stand in has its run, and not before', async () => {
    // both of the item's batches are posted for September: nothing is owed
    queue.push([item()], first(), [byBatch('b1', '2026-09'), byBatch('b2', '2026-09')], [{ batch_id: 'b1' }, { batch_id: 'b2' }]);
    expect(await service.runDueForTenant('t', {})).toEqual([{ item_code: 'GP-Imp-F', outcome: 'NOTHING_DUE' }]);
    // only one of the two batches is posted: September is not covered, so the item still owes it (from its Costing From date)
    queue.push([item()], first(), [byBatch('b1', '2026-09')], [{ batch_id: 'b1' }, { batch_id: 'b2' }]);
    runs.calculate.mockResolvedValueOnce(run('2026-07'));
    expect((await service.runDueForTenant('t', {}))[0]).toMatchObject({ outcome: 'CALCULATED' });
    // an animal outside any batch means batch runs can never cover the herd
    queue.push([item()], first(), [byBatch('b1', '2026-09')], [{ batch_id: 'b1' }, { batch_id: null }]);
    runs.calculate.mockResolvedValueOnce(run('2026-07'));
    expect((await service.runDueForTenant('t', {}))[0]).toMatchObject({ outcome: 'CALCULATED' });
  });

  it('has nothing to do when the latest finished period is already posted', async () => {
    queue.push([item()], first(), [postedFact('2026-09', '2026-09-30')]);
    expect(await service.runDueForTenant('t', {})).toEqual([{ item_code: 'GP-Imp-F', outcome: 'NOTHING_DUE' }]);
    expect(runs.calculate).not.toHaveBeenCalled();
  });

  it('a batch whose animals could not be costed yet (arrived later, or costing starts after the period) is not owed a run: the period is covered by the others', async () => {
    // batch b1 ran for 2026-08; b2 holds gilts that arrived on 2026-09-04 and start costing in 2027: no run of theirs is due for August
    queue.push([item({ bio_effective_from: '2026-08-01' })], first('2026-01-12'), [{ ...byBatch('b1', '2026-08'), period_end: '2026-08-31' }], [
      { batch_id: 'b1', entry_date: '2026-01-12', start: '2026-01-12' }, { batch_id: 'b2', entry_date: '2026-09-04', start: '2027-03-26' },
    ]);
    expect(await service.dueReport('t', 'c')).toEqual([expect.objectContaining({ due_periods: ['2026-09'] })]);
  });

  it('but a batch whose animals had started by the period is still owed its run', async () => {
    queue.push([item({ bio_effective_from: '2026-08-01' })], first('2026-01-12'), [{ ...byBatch('b1', '2026-08'), period_end: '2026-08-31' }], [
      { batch_id: 'b1', entry_date: '2026-01-12', start: '2026-01-12' }, { batch_id: 'b2', entry_date: '2026-02-01', start: '2026-03-01' },
    ]);
    expect(await service.dueReport('t', 'c')).toEqual([expect.objectContaining({ due_periods: ['2026-08', '2026-09'] })]);
  });

  it('an animal with no costing start date at all does not make her batch owed a run: the run could not charge her', async () => {
    queue.push([item({ bio_effective_from: '2026-08-01' })], first('2026-01-12'), [{ ...byBatch('b1', '2026-08'), period_end: '2026-08-31' }], [
      { batch_id: 'b1', entry_date: '2026-01-12', start: '2026-01-12' }, { batch_id: 'b2', entry_date: '2026-02-01', start: null },
    ]);
    expect(await service.dueReport('t', 'c')).toEqual([expect.objectContaining({ due_periods: ['2026-09'] })]);
  });

  it('records a period that cannot be run as a FAILED run with the reason, stops that item, and carries on to the next item', async () => {
    queue.push([item(), item({ item_id: 'i2', item_code: 'GP-Loc-F' })], first(), [], first(), []);
    runs.calculate.mockRejectedValueOnce(new Error('Reporting period 2026-07 is closed.')).mockResolvedValueOnce(run('2026-07'));
    const r = await service.runDueForTenant('t', {});
    expect(runs.recordFailure).toHaveBeenCalledWith(expect.objectContaining({ id: 'i1' }), expect.objectContaining({ key: '2026-07' }), 'Reporting period 2026-07 is closed.', 't', 'SCHEDULED');
    expect(r.map((x) => `${x.item_code}:${x.outcome}`)).toEqual(['GP-Imp-F:FAILED', 'GP-Loc-F:CALCULATED']);
  });

  it('stops retrying a period after three failures, and says so', async () => {
    const failed = (n: number) => ({ status: 'FAILED', period_key: '2026-07', period_end: '2026-07-31', run_no: `BCR-F${n}`, error_message: 'closed' });
    queue.push([item()], first(), [failed(1), failed(2), failed(3)]);
    const r = await service.runDueForTenant('t', {});
    expect(runs.calculate).not.toHaveBeenCalled();
    expect(r[0]).toMatchObject({ outcome: 'BLOCKED', blocked: { reason: 'TOO_MANY_FAILURES', attempts: 3 } });
  });

  it('lets a person retry a period the timer has given up on: a manual pass ignores the retry cap', async () => {
    const failed = (n: number) => ({ status: 'FAILED', period_key: '2026-07', period_end: '2026-07-31', run_no: `BCR-F${n}`, error_message: 'closed' });
    queue.push([item()], first(), [failed(1), failed(2), failed(3)]);
    runs.calculate.mockResolvedValueOnce(run('2026-07'));
    const r = await service.runDueForTenant('t', { trigger: 'MANUAL', userId: 'u1' });
    expect(runs.calculate).toHaveBeenCalledTimes(1);
    expect(r[0]).toMatchObject({ outcome: 'CALCULATED' });
  });

  it('reports what is due without running anything', async () => {
    queue.push([item()], first(), [postedFact('2026-07', '2026-07-31')]);
    const lines = await service.dueReport('t', 'c');
    expect(lines).toEqual([expect.objectContaining({ item_id: 'i1', item_code: 'GP-Imp-F', due_periods: ['2026-08', '2026-09'], blocked: null, note: null })]);
    expect(runs.calculate).not.toHaveBeenCalled();
  });

  it('a manual pass passes the user and the MANUAL trigger through', async () => {
    queue.push([item()], first(), []);
    runs.calculate.mockResolvedValueOnce(run('2026-07'));
    await service.runDueForTenant('t', { companyId: 'c', trigger: 'MANUAL', userId: 'u1' });
    expect(runs.calculate).toHaveBeenCalledWith({ item_id: 'i1', period_key: '2026-07' }, 't', 'u1', 'MANUAL');
  });

  it('posts by itself only when the item says so', async () => {
    queue.push([item({ bio_auto_post: true, bio_effective_from: '2026-09-01' })], first('2026-09-01'), []);
    runs.calculate.mockResolvedValueOnce(run('2026-09'));
    runs.post.mockResolvedValueOnce(run('2026-09', 'POSTED'));
    expect((await service.runDueForTenant('t', {}))[0]).toMatchObject({ outcome: 'POSTED' });
  });

  it('is not scheduled without a Costing From date, and says why; a manual run is still possible from the screen', async () => {
    queue.push([item({ bio_effective_from: null })]);
    const r = await service.runDueForTenant('t', {});
    expect(runs.calculate).not.toHaveBeenCalled();
    expect(r).toEqual([{ item_code: 'GP-Imp-F', outcome: 'NOT_SCHEDULED', reason: expect.stringMatching(/Costing From/) }]);
    queue.push([item({ bio_effective_from: null })]);
    expect(await service.dueReport('t', 'c')).toEqual([expect.objectContaining({ item_id: 'i1', due_periods: [], note: expect.stringMatching(/Costing From/) })]);
  });

  it('starts no earlier than the first of its animals begins to be costed: gilts that start in 2027 leave nothing due in 2026', async () => {
    queue.push([item({ bio_effective_from: '2026-01-01' })], first('2027-03-26'), []);
    expect(await service.dueReport('t', 'c')).toEqual([]);
    queue.push([item({ bio_effective_from: '2026-01-01' })], first('2026-08-12'), []);
    expect((await service.dueReport('t', 'c'))[0]).toMatchObject({ due_periods: ['2026-08', '2026-09'] });
  });

  it('has nothing to run while none of its animals has a costing start date, and says so', async () => {
    queue.push([item()], first(null));
    expect(await service.runDueForTenant('t', {})).toEqual([{ item_code: 'GP-Imp-F', outcome: 'NOT_SCHEDULED', reason: expect.stringMatching(/None of its animals has a costing start date/) }]);
    expect(runs.calculate).not.toHaveBeenCalled();
  });

  it('lists items in code order', async () => {
    queue.push([item(), item({ item_id: 'i2', item_code: 'GP-Loc-F' })], first(), [], first(), []);
    const lines = await service.dueReport('t', 'c');
    expect(lines.map((l) => l.item_code)).toEqual(['GP-Imp-F', 'GP-Loc-F']);
  });
});
