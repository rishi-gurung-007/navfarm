import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BreedingService } from './breeding.service';
import * as schema from '../../../core/database/schema';

/**
 * Phase 1 access foundation, Task 6: breeding records hang off a sow or boar
 * in animal_register, so their farm is the animal's farm (common/farm-scope.ts
 * animalOnFarm/animalScopeConditions). Modelled on
 * batch-daily-data.service.spec.ts's table-keyed db mock (lines 19-89) — the
 * mock answers by table, not by call order, and captures the last `.where()`
 * condition so a test can render the SQL and check the farm join made it in.
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
