import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BioCostingStartService } from './bio-costing-start.service';

describe('BioCostingStartService — when an animal\'s costing begins, from her item', () => {
  const queue: unknown[][] = [];
  const updates: any[] = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = {
    select: jest.fn(() => chain(queue.shift() ?? [])),
    update: jest.fn(() => ({ set: (set: any) => ({ where: () => { updates.push(set); return Promise.resolve(); } }) })),
  };
  let service: BioCostingStartService;

  const animal = { animal_id: 'a1', animal_code: 'PIG-1', tenant_id: 't', company_id: 'c', item_id: 'i', dob: '2026-01-05', entry_date: '2026-02-01', age_at_entry_weeks: null, is_active: true, costing_start_date: null };
  const sowItem = { item_id: 'i', item_code: 'GP-Imp-F', is_biological_asset: true, bio_costing_method: 'AMORTIZATION', bio_start_age_weeks: 33, bio_start_age_days: 3 };

  beforeEach(async () => {
    queue.length = 0; updates.length = 0; jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [BioCostingStartService, { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : undefined) } }],
    }).compile();
    service = moduleRef.get(BioCostingStartService);
  });

  describe('assignAnimal', () => {
    it('stores only the date her costing starts: born 5 Jan + 33 weeks + 3 days = 27 Aug', async () => {
      queue.push([animal], [sowItem]);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ assigned: true, item_code: 'GP-Imp-F', costing_start_date: '2026-08-27' });
      expect(updates).toEqual([{ costing_start_date: '2026-08-27' }]);
    });

    it('writes nothing in a dry run', async () => {
      queue.push([animal], [sowItem]);
      expect(await service.assignAnimal('a1', 't', { dryRun: true })).toMatchObject({ assigned: false, would_assign: true, costing_start_date: '2026-08-27' });
      expect(updates).toEqual([]);
    });

    it('keeps a date she already has, and leaves a dead animal alone', async () => {
      queue.push([{ ...animal, costing_start_date: '2026-08-24' }], [sowItem]);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ assigned: false, reason: 'ALREADY_ASSIGNED' });
      queue.push([{ ...animal, is_active: false }], [sowItem]);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ assigned: false, reason: 'NOT_ACTIVE' });
      expect(updates).toEqual([]);
    });

    it('leaves her uncosted, with the reason, when her item has no costing terms', async () => {
      queue.push([animal], [{ ...sowItem, bio_costing_method: null }]);
      expect(await service.assignAnimal('a1', 't')).toEqual({ animal_id: 'a1', assigned: false, reason: 'ITEM_HAS_NO_COSTING_TERMS' });
      queue.push([animal], []);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ reason: 'ITEM_HAS_NO_COSTING_TERMS' });
      expect(updates).toEqual([]);
    });

    it('says so when the animal does not exist', async () => {
      queue.push([]);
      await expect(service.assignAnimal('nope', 't')).rejects.toThrow(NotFoundException);
    });
  });

  it('assignAnimals dates each animal that has no start, counts why the others were left, and carries on', async () => {
    queue.push([{ animal_id: 'a1' }, { animal_id: 'a2' }], [animal], [sowItem], [{ ...animal, animal_id: 'a2' }], [{ ...sowItem, bio_costing_method: null }]);
    const r = await service.assignAnimals({ dry_run: true }, 't', 'c');
    expect(r.by_reason).toEqual({ OK: 1, ITEM_HAS_NO_COSTING_TERMS: 1 });
    expect(r).toMatchObject({ dry_run: true, considered: 2 });
  });

  describe('startForNewBirthDate — the birth date moves the start, but only while nothing is booked on the old one', () => {
    const booked = (run: number, ledger: number, tx: number) => [[{ n: run }], [{ n: ledger }], [{ n: tx }]];

    it('gives the new start: born 6 Oct 2025 + 33 weeks + 3 days = 28 May 2026', async () => {
      queue.push([{ ...animal, entry_date: '2026-01-12' }], [sowItem], ...booked(0, 0, 0));
      await expect(service.startForNewBirthDate('a1', '2025-10-06', 't')).resolves.toBe('2026-05-28');
    });

    it('never starts before the day she arrived', async () => {
      queue.push([{ ...animal, entry_date: '2026-01-12' }], [sowItem], ...booked(0, 0, 0));
      await expect(service.startForNewBirthDate('a1', '2024-01-01', 't')).resolves.toBe('2026-01-12');
    });

    it.each([['a costing run line', booked(2, 0, 0)], ['a capitalised or amortised ledger row', booked(0, 3, 0)], ['a feed or overhead entry', booked(0, 0, 5)]])('refuses once %s is booked to her', async (_what, counts) => {
      queue.push([animal], [sowItem], ...counts);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).rejects.toThrow(BadRequestException);
      queue.push([animal], [sowItem], ...counts);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).rejects.toThrow(/cannot be changed once feed, medicine, overhead or a costing run/);
    });

    it('does nothing for an animal that no item costs', async () => {
      queue.push([animal], [{ ...sowItem, bio_costing_method: null }]);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).resolves.toBeNull();
      queue.push([]);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).resolves.toBeNull();
    });
  });
});
