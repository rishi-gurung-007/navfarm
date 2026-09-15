import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BreedingService } from './breeding.service';
import * as schema from '../../../core/database/schema';
import { MatingType, PregCheckMethod, ConceptionResult } from './dto/breeding.dto';

/**
 * The `recordMating`/`recordPregnancyCheck`/`recordFarrowing`/
 * `recordSemenCollection` describes below predate Phase 1 access foundation
 * and cover the breeding business logic (gestation/preg-check date math,
 * litter totals, unit cost) independent of farm scoping.
 *
 * The `farm scope` describe is Phase 1 access foundation, Task 6: breeding
 * records hang off a sow or boar in animal_register, so their farm is the
 * animal's farm (common/farm-scope.ts animalOnFarm/animalScopeConditions).
 *
 * Both share one table-keyed db mock modelled on
 * batch-daily-data.service.spec.ts (lines 19-89) — the mock answers by
 * table, not by call order, and captures the last `.where()` condition so a
 * test can render the SQL and check the farm join made it in.
 */
describe('BreedingService', () => {
  let service: BreedingService;
  let cls: ReturnType<typeof transactionCls>;

  const rows = new Map<unknown, unknown[]>();
  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = { select: mockDbSelect, insert: mockDbInsert, update: mockDbUpdate };

  let capturedWhere: unknown;

  /** Awaitable at any point, so .where(), .limit() and .orderBy() all resolve. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      where: (cond: unknown) => { capturedWhere = cond; return self; },
      limit: () => self,
      for: () => self,
      orderBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const renderedWhere = () => new MySqlDialect().sqlToQuery(capturedWhere as any).sql;

  beforeEach(async () => {
    rows.clear();
    capturedWhere = undefined;
    rows.set(schema.animalRegister, [{ animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', parity_count: 0, current_batch_id: null, total_piglets_born_live: 0, total_piglets_weaned: 0 }]);
    rows.set(schema.breedingRecord, []);
    rows.set(schema.farrowingRecord, []);
    rows.set(schema.semenBatch, []);
    rows.set(schema.breedMaster, []);

    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BreedingService,
        { provide: ClsService, useValue: cls },
      ],
    }).compile();

    service = module.get<BreedingService>(BreedingService);
  });

  describe('recordMating', () => {
    it('throws NotFoundException if sow is not found', async () => {
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordMating(
          {
            sow_animal_id: 'non-existent',
            mating_type: MatingType.AI,
            mating_date: '2026-03-01',
          },
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if NATURAL_MATING is missing boar_animal_id', async () => {
      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            mating_type: MatingType.NATURAL_MATING,
            mating_date: '2026-03-01',
          },
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('defaults to 116 days expected farrowing date when the sow has no breed, and 28 days preg check date', async () => {
      rows.set(schema.animalRegister, [{ animal_id: 'sow-1', company_id: 'comp-1', parity_count: 1, breed_id: null }]);
      // The lot is validated against the sow's company and the boar's farm scope (M4).
      rows.set(schema.semenBatch, [{ semen_batch_id: 'SEM-LOT-01' }]);

      const result = await service.recordMating(
        {
          sow_animal_id: 'sow-1',
          mating_type: MatingType.AI,
          mating_date: '2026-03-01',
          semen_lot_id: 'SEM-LOT-01',
        },
        'tenant-1',
      );

      expect(result.expected_farrowing_date).toBe('2026-06-25'); // 2026-03-01 + 116 days (BBP §1.7 default)
      expect(result.preg_check_date).toBe('2026-03-29'); // 2026-03-01 + 28 days
      expect(result.parity_number).toBe(2);
      expect(result.conception_result).toBe(ConceptionResult.PENDING);
    });

    // Without the fix, recordMating always added 114 days regardless of the
    // sow's own breed — this is the write that decided 2026-09-14/15 replaced.
    it("uses the sow's breed gestation_days over the 116-day default", async () => {
      rows.set(schema.animalRegister, [{ animal_id: 'sow-1', company_id: 'comp-1', parity_count: 1, breed_id: 'breed-large-white' }]);
      rows.set(schema.breedMaster, [{ breed_id: 'breed-large-white', gestation_days: 113 }]);

      const result = await service.recordMating(
        { sow_animal_id: 'sow-1', mating_type: MatingType.AI, mating_date: '2026-03-01' },
        'tenant-1',
      );

      expect(result.expected_farrowing_date).toBe('2026-06-22'); // 2026-03-01 + 113 days, from the breed
    });
  });

  describe('recordPregnancyCheck', () => {
    it('updates sow status to PREGNANT on pregnancy confirmation', async () => {
      rows.set(schema.breedingRecord, [{
        breeding_id: 'breed-1',
        sow_animal_id: 'sow-1',
        preg_check_date: '2026-03-29',
        preg_check_method: 'ULTRASOUND',
      }]);

      const result = await service.recordPregnancyCheck(
        'breed-1',
        {
          pregnancy_confirmed: true,
          preg_check_method: PregCheckMethod.ULTRASOUND,
        },
        'tenant-1',
      );

      expect(result.pregnancy_confirmed).toBe(true);
      expect(result.conception_result).toBe(ConceptionResult.CONFIRMED);
    });
  });

  describe('recordFarrowing', () => {
    it('records live piglets, computes total litter born, and sets sow to LACTATING', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1',
        company_id: 'comp-1',
        parity_count: 2,
        total_piglets_born_live: 24,
      }]);

      const result = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-06-23',
          piglets_born_live: 12,
          piglets_stillborn: 1,
          piglets_mummified: 0,
          avg_birth_weight_kg: 1.45,
        },
        'tenant-1',
      );

      expect(result.piglets_born_total).toBe(13);
      expect(result.piglets_born_live).toBe(12);
      expect(result.total_litter_weight_kg).toBe('17.4'); // 12 * 1.45
      expect(result.parity_number).toBe(3);
    });

    // Without the fix, a GILT's first farrowing left animal_type untouched —
    // she stayed a GILT forever, including on every later farrowing.
    it('promotes a GILT to SOW on her first farrowing', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'gilt-1',
        company_id: 'comp-1',
        animal_type: 'GILT',
        parity_count: 0,
        total_piglets_born_live: 0,
      }]);

      await service.recordFarrowing(
        { sow_animal_id: 'gilt-1', farrowing_date: '2026-06-23', piglets_born_live: 10 },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(setArgs.animal_type).toBe('SOW');
    });

    it('leaves an already-SOW animal_type alone on a later farrowing', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1',
        company_id: 'comp-1',
        animal_type: 'SOW',
        parity_count: 1,
        total_piglets_born_live: 12,
      }]);

      await service.recordFarrowing(
        { sow_animal_id: 'sow-1', farrowing_date: '2026-06-23', piglets_born_live: 10 },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(setArgs.animal_type).toBeUndefined();
    });
  });

  describe('recordSemenCollection', () => {
    it('calculates unit cost per dose from period running costs', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'boar-1',
        company_id: 'comp-1',
      }]);

      const result = await service.recordSemenCollection(
        {
          boar_animal_id: 'boar-1',
          collection_date: '2026-04-01',
          amortisation_period: 100,
          feed_cost_period: 250,
          drug_cost_period: 50,
          overhead_cost_period: 100,
          doses_collected: 50,
        },
        'tenant-1',
      );

      // Running cost = 100 + 250 + 50 + 100 = 500
      // Unit cost = 500 / 50 = 10
      expect(result.running_cost_period).toBe('500.0000');
      expect(result.unit_cost_per_dose).toBe('10.000000');
    });
  });

  /**
   * Recovery review M4: breeding create paths stamped the body's company_id,
   * batch_id and semen_lot_id as sent. The company now comes from the scoped
   * animal and every referenced id must itself be in scope.
   */
  describe('breeding references are bound to the animal and the caller scope', () => {
    const grasmere = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    it('stores the sow company, never the body company', async () => {
      const result = await service.recordMating(
        { sow_animal_id: 'sow-1', mating_type: MatingType.AI, mating_date: '2026-03-01' } as any,
        'tenant-1',
      );
      expect(result.company_id).toBe('co-1');
    });

    it('refuses a body company_id that differs from the sow company, before any insert', async () => {
      // Without the fix the record was inserted under 'co-other'.
      await expect(service.recordMating(
        { sow_animal_id: 'sow-1', company_id: 'co-other', mating_type: MatingType.AI, mating_date: '2026-03-01' } as any,
        'tenant-1',
      )).rejects.toThrow(BadRequestException);
      await expect(service.recordFarrowing(
        { sow_animal_id: 'sow-1', company_id: 'co-other', farrowing_date: '2026-06-23', piglets_born_live: 8 } as any,
        'tenant-1',
      )).rejects.toThrow(BadRequestException);
      await expect(service.recordSemenCollection(
        { boar_animal_id: 'sow-1', company_id: 'co-other', collection_date: '2026-04-01', doses_collected: 10 } as any,
        'tenant-1',
      )).rejects.toThrow(BadRequestException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a batch_id outside the caller scope, through the batch scope conditions', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.batchHeader, []); // exists on Kintyre, so the scoped query finds nothing

      await expect(service.recordMating(
        { sow_animal_id: 'sow-1', batch_id: 'batch-kintyre', mating_type: MatingType.AI, mating_date: '2026-03-01' } as any,
        'tenant-1',
      )).rejects.toThrow("Batch with ID 'batch-kintyre' not found.");
      expect(renderedWhere()).toContain('`batch_header`.`farm_id` = ?');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a farrowing batch_id outside the caller scope', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.batchHeader, []);

      await expect(service.recordFarrowing(
        { sow_animal_id: 'sow-1', batch_id: 'batch-kintyre', farrowing_date: '2026-06-23', piglets_born_live: 8 } as any,
        'tenant-1',
      )).rejects.toThrow(NotFoundException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a semen lot outside the caller scope', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.semenBatch, []);

      await expect(service.recordMating(
        { sow_animal_id: 'sow-1', semen_lot_id: 'lot-kintyre', mating_type: MatingType.AI, mating_date: '2026-03-01' } as any,
        'tenant-1',
      )).rejects.toThrow("Semen lot with ID 'lot-kintyre' not found.");
      expect(renderedWhere()).toContain('animal_register af');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('farm scope', () => {
    it('lists only matings of sows on the active farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });

      await service.getMatingRecords('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it('lists only farrowings of sows on the active farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });

      await service.getFarrowingRecords('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it('lists only semen batches of boars on the active farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });

      await service.getSemenBatches('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it.each([
      ['matings', () => service.getMatingRecords('tenant-1')],
      ['farrowings', () => service.getFarrowingRecords('tenant-1')],
      ['semen batches', () => service.getSemenBatches('tenant-1')],
    ])('bounds %s by company and LOB when an operational admin selected no farm', async (_label, run) => {
      useFarmScope(cls, { farmId: null, restricted: true, companyId: 'co-1', lobId: 'lob-pig' });

      await run();

      const where = renderedWhere();
      expect(where).toContain('`animal_register`.`company_id` = ?');
      expect(where).toContain('`animal_register`.`lob_id` = ?');
    });

    it('answers 404 when recording a mating for a sow on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordMating({ sow_animal_id: 'sow-k', mating_date: '2026-09-01' } as any, 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when recording a farrowing for a sow on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordFarrowing({ sow_animal_id: 'sow-k', farrowing_date: '2026-09-01', piglets_born_live: 8 } as any, 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when recording a semen collection for a boar on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordSemenCollection({ boar_animal_id: 'boar-k', collection_date: '2026-09-01', doses_collected: 10 } as any, 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a pregnancy check on a breeding record whose sow is on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      rows.set(schema.breedingRecord, [{ breeding_id: 'breed-1', tenant_id: 'tenant-1', sow_animal_id: 'sow-k', preg_check_date: '2026-09-01', preg_check_method: 'ULTRASOUND', notes: null }]);
      // The sow exists tenant-wide but not on this active farm.
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordPregnancyCheck('breed-1', { pregnancy_confirmed: true } as any, 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a weaning on a farrowing record whose sow is on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      rows.set(schema.farrowingRecord, [{ farrow_id: 'farrow-1', tenant_id: 'tenant-1', sow_animal_id: 'sow-k', notes: null }]);
      // The sow exists tenant-wide but not on this active farm.
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordWeaning('farrow-1', { weaning_date: '2026-09-29', piglets_weaned: 7 } as any, 'tenant-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
