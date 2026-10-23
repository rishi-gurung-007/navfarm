import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { BioCostingProfileService } from './bio-costing-profile.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import * as schema from '../../../core/database/schema';

describe('BioCostingProfileService', () => {
  const queue: unknown[][] = [];
  const updates: Array<{ table: unknown; set: any }> = [];
  const chain = (result: unknown[]) => {
    const self: any = { from: () => self, where: () => self, limit: () => self, orderBy: () => self, then: (ok: any, err: any) => Promise.resolve(result).then(ok, err) };
    return self;
  };
  const db = {
    select: jest.fn(() => chain(queue.shift() ?? [])),
    update: jest.fn((table: unknown) => ({ set: (set: any) => ({ where: () => { updates.push({ table, set }); return Promise.resolve(); } }) })),
    insert: jest.fn(() => ({ values: () => Promise.resolve() })),
  };
  let service: BioCostingProfileService;

  const importedFemale = {
    profile_id: 'p1', tenant_id: 't', company_id: 'c', profile_code: 'IMP-F', name: 'Imported female', item_id: null, breed_id: null, gender: 'F', origin: 'IMPORTED',
    costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36, residual_rule: 'WEIGHT_X_PRICE', residual_fixed_amount: null,
    residual_weight_kg: '150.000', residual_price_per_kg: '2.050000', residual_applies_gender: 'F', run_frequency: 'MONTHLY', day_basis: 'FREQUENCY_DAYS',
    tracking: 'INDIVIDUAL', auto_post: false, acquisition_gl_id: 'g1', accum_amort_gl_id: 'g2', amort_expense_gl_id: 'g3', fv_gain_loss_gl_id: null, writeoff_gl_id: 'g4',
    effective_from: '2026-01-01', status: 'ACTIVE', active_scope_key: 'c|-|-|F|IMPORTED', supersedes_profile_id: null,
  };
  const flags = { bio_asset_support: true, amort_option: true, fair_value_option: true };

  beforeEach(async () => {
    queue.length = 0; updates.length = 0; jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        BioCostingProfileService,
        { provide: ClsService, useValue: { get: (k: string) => (k === 'tenantDb' ? db : undefined) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();
    service = moduleRef.get(BioCostingProfileService);
  });

  describe('update — the terms lock once an animal is costed by the profile (V8)', () => {
    it('refuses a change to the useful life and names the locked field, writing nothing', async () => {
      queue.push([importedFemale], [{ n: '3' }]); // the profile, the animals costed by it
      await expect(service.update('p1', { useful_life_months: 18 } as any, 't')).rejects.toThrow(/locked \(useful_life_months\)/);
      expect(updates).toEqual([]);
    });

    it('still lets the name and the auto-post flag change, and treats a re-sent identical term as no change', async () => {
      queue.push([importedFemale], [{ n: '3' }], [flags], [importedFemale], [], [{ n: '3' }]);
      await service.update('p1', { name: 'Imported female (GGP/GP/P)', auto_post: true, useful_life_months: 36, residual_price_per_kg: 2.05 } as any, 't');
      expect(updates[0].set).toMatchObject({ name: 'Imported female (GGP/GP/P)', auto_post: true });
    });

    it('lets every term change while no animal is costed by it', async () => {
      queue.push([importedFemale], [{ n: '0' }], [flags], [importedFemale], [], [{ n: '0' }]);
      await service.update('p1', { useful_life_months: 18 } as any, 't');
      expect(updates[0].set).toMatchObject({ useful_life_months: 18 });
    });

    it('still refuses terms that no longer hold together, such as removing the useful life from an amortisation profile', async () => {
      queue.push([importedFemale], [{ n: '0' }], [flags]);
      await expect(service.update('p1', { useful_life_months: null } as any, 't')).rejects.toThrow(BadRequestException);
      expect(updates).toEqual([]);
    });
  });

  describe('activate — a profile goes live only with its accounts (and, for fair value, a rate)', () => {
    it('lists the missing GL accounts and stays a draft', async () => {
      queue.push([{ ...importedFemale, status: 'DRAFT', accum_amort_gl_id: null, writeoff_gl_id: null }], [{ id: 'g1' }, { id: 'g3' }], [{ n: '0' }], [flags]);
      const error: any = await service.activate('p1', 't').catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().message).toEqual(['The accumulated amortisation GL account is not set.', 'The mortality / impairment loss GL account is not set.']);
      expect(updates).toEqual([]);
    });
  });

  describe('assignAnimal — frozen to the profile that fits her', () => {
    const animal = { animal_id: 'a1', tenant_id: 't', company_id: 'c', item_id: 'i', breed_id: 'b', gender: 'F', entry_type: 'PURCHASED_IMPORTED', dob: '2026-01-05', entry_date: '2026-02-01', age_at_entry_weeks: null, is_active: true, costing_profile_id: null };

    it('assigns the imported-female profile and works out the start date (born 5 Jan + 33 weeks = 24 Aug)', async () => {
      queue.push([animal], [importedFemale]);
      const r = await service.assignAnimal('a1', 't');
      expect(r).toMatchObject({ assigned: true, profile_code: 'IMP-F', costing_start_date: '2026-08-24' });
      expect(updates[0].set).toEqual({ costing_profile_id: 'p1', costing_start_date: '2026-08-24' });
    });

    it('writes nothing in a dry run', async () => {
      queue.push([animal], [importedFemale]);
      const r = await service.assignAnimal('a1', 't', { dryRun: true });
      expect(r).toMatchObject({ assigned: false, would_assign: true });
      expect(updates).toEqual([]);
    });

    it('leaves an animal no profile fits uncosted, with the reason, and keeps one she already has', async () => {
      queue.push([{ ...animal, entry_type: 'BORN_ON_FARM' }], [importedFemale]);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ assigned: false, reason: 'NO_MATCHING_PROFILE' });
      queue.push([{ ...animal, costing_profile_id: 'p9' }]);
      expect(await service.assignAnimal('a1', 't')).toMatchObject({ assigned: false, reason: 'ALREADY_ASSIGNED', profile_id: 'p9' });
      expect(updates).toEqual([]);
    });

    it('reports two equally specific profiles instead of choosing one', async () => {
      queue.push([animal], [importedFemale, { ...importedFemale, profile_id: 'p2', profile_code: 'ANY-F', origin: null, gender: 'F', breed_id: 'b' }]);
      // IMP-F pins origin+gender (2); ANY-F pins breed+gender (2): equally specific
      await expect(service.assignAnimal('a1', 't')).rejects.toThrow(/fits equally/);
    });
  });

  it('assignAnimals reports an animal the setup cannot resolve and carries on with the next', async () => {
    const mk = (id: string, breed: string) => ({ animal_id: id, tenant_id: 't', company_id: 'c', item_id: 'i', breed_id: breed, gender: 'F', entry_type: 'PURCHASED_IMPORTED', dob: '2026-01-05', entry_date: '2026-02-01', age_at_entry_weeks: null, is_active: true, costing_profile_id: null });
    const tie = { ...importedFemale, profile_id: 'p2', profile_code: 'BRD-F', origin: null, breed_id: 'b-tie' };
    queue.push([{ animal_id: 'a1' }, { animal_id: 'a2' }], [mk('a1', 'b-tie')], [importedFemale, tie], [mk('a2', 'b-other')], [importedFemale, tie]);
    const r = await service.assignAnimals({ dry_run: true }, 't', 'c');
    expect(r.by_reason).toEqual({ AMBIGUOUS_PROFILES: 1, OK: 1 });
    expect(r.animals.find((x: any) => x.reason === 'AMBIGUOUS_PROFILES')).toMatchObject({ animal_id: 'a1' });
  });

  describe('startForNewBirthDate — the birth date moves the costing start, but only while nothing is booked on the old one', () => {
    const animal = { animal_id: 'a1', animal_code: 'PIG-1', costing_profile_id: 'p1', entry_date: '2026-01-12', age_at_entry_weeks: 10 };

    it('gives the new start (birth + 33 weeks, never before arrival) when nothing has been booked', async () => {
      queue.push([animal], [importedFemale], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]);
      await expect(service.startForNewBirthDate('a1', '2025-10-06', 't')).resolves.toBe('2026-05-25');
    });

    it('never starts before the day she arrived', async () => {
      queue.push([animal], [importedFemale], [{ n: 0 }], [{ n: 0 }], [{ n: 0 }]);
      await expect(service.startForNewBirthDate('a1', '2024-01-01', 't')).resolves.toBe('2026-01-12');
    });

    it.each([['a costing run line', [{ n: 2 }, { n: 0 }, { n: 0 }]], ['a capitalised or amortised ledger row', [{ n: 0 }, { n: 3 }, { n: 0 }]], ['a feed or overhead entry', [{ n: 0 }, { n: 0 }, { n: 5 }]]])('refuses once %s is booked to her', async (_what, counts) => {
      queue.push([animal], [importedFemale], [counts[0]], [counts[1]], [counts[2]]);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).rejects.toThrow(/cannot be changed once feed, medicine, overhead or a costing run/);
    });

    it('does nothing for an animal with no costing profile', async () => {
      queue.push([{ ...animal, costing_profile_id: null }]);
      await expect(service.startForNewBirthDate('a1', '2025-06-01', 't')).resolves.toBeNull();
    });
  });

  it('knows the schema it writes to', () => {
    expect(Object.keys(schema.bioCostingProfile)).toEqual(expect.arrayContaining(['profile_id', 'active_scope_key', 'costing_method']));
  });
});
