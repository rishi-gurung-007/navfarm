import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BioCostingExitService } from './bio-costing-exit.service';
import { JournalService } from '../journal/journal.service';

describe('BioCostingExitService.clearOnDeath', () => {
  const queue: unknown[][] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = { select: jest.fn(() => chain(queue.shift() ?? [])) };
  const journals = { createAndPostSystemJournal: jest.fn() };
  let service: BioCostingExitService;

  const animal = { animal_id: 'a1', animal_code: 'DLNA8228', company_id: 'c', nob_id: 'n', lob_id: 'l', costing_profile_id: 'p1' };
  const profile = { profile_id: 'p1', profile_code: 'IMP-F', costing_method: 'AMORTIZATION', accum_amort_gl_id: 'g-accum', acquisition_gl_id: 'g-acq' };

  beforeEach(async () => {
    queue.length = 0; jest.clearAllMocks();
    journals.createAndPostSystemJournal.mockResolvedValue({ journal_id: 'j1', journal_no: 'JE-000030' });
    const moduleRef = await Test.createTestingModule({
      providers: [BioCostingExitService, { provide: ClsService, useValue: { get: () => db } }, { provide: JournalService, useValue: journals }],
    }).compile();
    service = moduleRef.get(BioCostingExitService);
  });

  it('posts Dr accumulated amortisation / Cr acquisition cost for what she was amortised, on the death date and her business line', async () => {
    queue.push([animal], [profile], [], [{ total: '-89.9525' }], []); // animal, profile, no earlier clearing, the amortisation rows (stored negative), no closed period
    const r = await service.clearOnDeath('a1', '2026-10-20', 't', 'u1');
    expect(r).toMatchObject({ cleared: 89.9525, journal_no: 'JE-000030' });
    const call = journals.createAndPostSystemJournal.mock.calls[0][0];
    expect(call).toMatchObject({ postingDate: '2026-10-20', sourceDocumentType: 'BIO_ASSET_EXIT', sourceDocumentNo: 'DLNA8228' });
    expect(call.lines).toEqual([
      expect.objectContaining({ glAccountId: 'g-accum', debitAmount: 89.9525, creditAmount: 0, nobId: 'n', lobId: 'l' }),
      expect.objectContaining({ glAccountId: 'g-acq', debitAmount: 0, creditAmount: 89.9525 }),
    ]);
  });

  it('does nothing for an animal no profile costs, one costed by fair value, or one never amortised', async () => {
    queue.push([{ ...animal, costing_profile_id: null }]);
    expect(await service.clearOnDeath('a1', '2026-10-20', 't')).toEqual({ cleared: 0, reason: 'NO_PROFILE' });
    queue.push([animal], [{ ...profile, costing_method: 'FAIR_VALUE' }]);
    expect(await service.clearOnDeath('a1', '2026-10-20', 't')).toEqual({ cleared: 0, reason: 'NOT_AMORTISED' });
    queue.push([animal], [profile], [], [{ total: '0' }]);
    expect(await service.clearOnDeath('a1', '2026-10-20', 't')).toEqual({ cleared: 0, reason: 'NOTHING_AMORTISED' });
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('clears once only: a retry finds the first journal and posts nothing', async () => {
    queue.push([animal], [profile], [{ id: 'j-earlier' }]);
    expect(await service.clearOnDeath('a1', '2026-10-20', 't')).toEqual({ cleared: 0, reason: 'ALREADY_CLEARED' });
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('will not leave the credit standing silently when the profile lacks the accounts to clear it', async () => {
    queue.push([animal], [{ ...profile, accum_amort_gl_id: null }], [], [{ total: '-10' }]);
    await expect(service.clearOnDeath('a1', '2026-10-20', 't')).rejects.toThrow(BadRequestException);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });

  it('refuses a death date inside a closed reporting period', async () => {
    queue.push([animal], [profile], [], [{ total: '-10' }], [{ period_code: 'P', start_date: '2026-10-01', end_date: '2026-10-31', period_status: 'CLOSED' }]);
    await expect(service.clearOnDeath('a1', '2026-10-20', 't')).rejects.toThrow(/closed/);
    expect(journals.createAndPostSystemJournal).not.toHaveBeenCalled();
  });
});
