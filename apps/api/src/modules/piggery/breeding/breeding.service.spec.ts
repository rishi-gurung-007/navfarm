import {
  transactionCls,
  useFarmScope,
} from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PigletLotService } from '../../production/batch/piglet-lot.service';
import { BatchService } from '../../production/batch/batch.service';
import { BatchTransferService } from '../../production/batch/batch-transfer.service';
import { SemenLotService } from './semen-lot.service';
import { AnimalService } from '../animal/animal.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { LitterCostService } from '../litter-cost/litter-cost.service';
import { GiltSelectionService } from '../gilt-selection/gilt-selection.service';
import { AnimalBookValueService } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { BreedingService } from './breeding.service';
import * as schema from '../../../core/database/schema';
import {
  MatingType,
  PregCheckMethod,
  ConceptionResult,
} from './dto/breeding.dto';
import { bioEventOf } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

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

  /**
   * Breeding is recorded in an active, animal-wise batch the animal stands in, and only for a live animal. Every animal
   * fixture is therefore in 'batch-1' and live unless a test says otherwise (current_batch_id: null, is_active: false).
   */
  const rows = new (class extends Map<unknown, unknown[]> {
    override set(key: unknown, value: unknown[]) {
      return super.set(
        key,
        key === schema.animalRegister
          ? value.map((a) => ({
              is_active: true,
              current_batch_id: 'batch-1',
              ...(a as object),
            }))
          : value,
      );
    }
  })();
  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  };

  let capturedWhere: unknown;

  const pigletLots = { createLot: jest.fn(), createWeanerBatch: jest.fn() };
  const batchService = { recordMortality: jest.fn(), transferStage: jest.fn() };
  const batchTransfers = { create: jest.fn() };
  const semenLots = { postCollection: jest.fn(), issueDoses: jest.fn() };
  const animals = { transitionStage: jest.fn() };
  const animalBookValue = { refreshCache: jest.fn() };
  const giltSelection = { selectAtWeaning: jest.fn() };

  /** Awaitable at any point, so .where(), .limit() and .orderBy() all resolve. */
  const chain = (result: unknown[]) => {
    const self: any = {
      from: () => self,
      where: (cond: unknown) => {
        capturedWhere = cond;
        return self;
      },
      limit: () => self,
      for: () => self,
      orderBy: () => self,
      groupBy: () => self,
      innerJoin: () => self,
      leftJoin: () => self,
      then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
    };
    return self;
  };

  const renderedWhere = () =>
    new MySqlDialect().sqlToQuery(capturedWhere as any).sql;

  beforeEach(async () => {
    rows.clear();
    capturedWhere = undefined;
    pigletLots.createLot.mockReset();
    batchService.recordMortality.mockReset().mockResolvedValue({});
    batchService.transferStage.mockReset().mockResolvedValue({});
    batchTransfers.create.mockReset().mockResolvedValue({});
    semenLots.postCollection.mockReset();
    semenLots.issueDoses.mockReset().mockResolvedValue(undefined);
    animals.transitionStage.mockReset().mockResolvedValue({});
    // gender and animal_code are read by the resolveSowAndBoar guard: a fixture
    // without them reads as a non-female animal and refuses before the test's
    // own assertion point.
    rows.set(schema.animalRegister, [
      {
        animal_id: 'sow-1',
        tenant_id: 'tenant-1',
        company_id: 'co-1',
        animal_code: 'SOW-001',
        gender: 'F',
        parity_count: 0,
        total_piglets_born_live: 0,
        total_piglets_weaned: 0,
      },
    ]);
    // Every litter comes from a mating (G9): the sow's open one, found when the farrowing names none.
    rows.set(schema.breedingRecord, [
      { breeding_id: 'br-open', mating_date: '2026-01-01' },
    ]);
    rows.set(schema.farrowingRecord, []);
    rows.set(schema.batchHeader, [
      {
        batch_id: 'batch-1',
        batch_no: 'BATCH-1',
        tracking_mode: 'ANIMAL_WISE',
        status: 'ACTIVE',
        farm_id: null,
      },
    ]);
    rows.set(schema.semenBatch, []);
    rows.set(schema.breedMaster, []);

    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbSelect.mockImplementation(() => ({
      from: (table: unknown) => chain(rows.get(table) ?? []),
    }));
    mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
    mockDbUpdate.mockReturnValue({
      set: jest
        .fn()
        .mockReturnValue({ where: jest.fn().mockResolvedValue({}) }),
    });

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BreedingService,
        { provide: ClsService, useValue: cls },
        { provide: PigletLotService, useValue: pigletLots },
        { provide: BatchService, useValue: batchService },
        { provide: BatchTransferService, useValue: batchTransfers },
        { provide: SemenLotService, useValue: semenLots },
        { provide: AnimalService, useValue: animals },
        { provide: AnimalBookValueService, useValue: animalBookValue },
        { provide: GiltSelectionService, useValue: giltSelection },
        LitterCostService,
        {
          provide: GlPostingService,
          useValue: { postBatchCostEntry: jest.fn() },
        },
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
      rows.set(schema.breedingRecord, []);
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 1,
          breed_id: null,
        },
      ]);
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
      rows.set(schema.breedingRecord, []);
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 1,
          breed_id: 'breed-large-white',
        },
      ]);
      rows.set(schema.breedMaster, [
        { breed_id: 'breed-large-white', gestation_days: 113 },
      ]);

      jest
        .spyOn(service as any, 'assertLotUsable')
        .mockResolvedValue({ semen_batch_id: 'sb-1' });
      jest
        .spyOn(service as any, 'boarOfSemenLot')
        .mockResolvedValue({ boarId: null, poolBoarIds: [] });
      const result = await service.recordMating(
        {
          sow_animal_id: 'sow-1',
          semen_lot_id: 'sb-1',
          mating_type: MatingType.AI,
          mating_date: '2026-03-01',
        },
        'tenant-1',
      );

      expect(result.expected_farrowing_date).toBe('2026-06-22'); // 2026-03-01 + 113 days, from the breed
    });
  });

  describe('recordPregnancyCheck', () => {
    it('updates sow status to PREGNANT on pregnancy confirmation', async () => {
      rows.set(schema.breedingRecord, [
        {
          breeding_id: 'breed-1',
          sow_animal_id: 'sow-1',
          preg_check_date: '2026-03-29',
          preg_check_method: 'ULTRASOUND',
        },
      ]);

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
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          parity_count: 2,
          total_piglets_born_live: 24,
        },
      ]);

      const result = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-06-23',
          piglet_item_id: 'item-piglet',
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
      rows.set(schema.animalRegister, [
        {
          animal_id: 'gilt-1',
          company_id: 'comp-1',
          animal_type: 'GILT',
          parity_count: 0,
          total_piglets_born_live: 0,
        },
      ]);

      await service.recordFarrowing(
        {
          sow_animal_id: 'gilt-1',
          farrowing_date: '2026-06-23',
          piglet_item_id: 'item-piglet',
          piglets_born_live: 10,
        },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(setArgs.animal_type).toBe('SOW');
    });

    it('leaves an already-SOW animal_type alone on a later farrowing', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_type: 'SOW',
          parity_count: 1,
          total_piglets_born_live: 12,
        },
      ]);

      await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-06-23',
          piglet_item_id: 'item-piglet',
          piglets_born_live: 10,
        },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(setArgs.animal_type).toBeUndefined();
    });
  });

  // Parity counts completed pregnancies, post weaning (decisions.md, TDD row 27): farrowing
  // numbers the litter, weaning completes it. Farrowing used to add one itself, the stage move
  // out of farrowing added another, and weaning added none.
  describe('parity rises at farrowing', () => {
    it('raises parity_count to the litter number at farrowing', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_type: 'SOW',
          status: 'PREGNANT',
          parity_count: 2,
          total_piglets_born_live: 24,
        },
      ]);

      const result = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-06-23',
          piglet_item_id: 'item-piglet',
          piglets_born_live: 12,
        },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(result.parity_number).toBe(3);
      expect(setArgs.parity_count).toBe(3);
      expect(setArgs.status).toBe('LACTATING');
      expect(setArgs.total_piglets_born_live).toBe(36);
    });

    it('refuses a second farrowing while the last litter is not weaned (an unweaned litter on record)', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_code: 'SOW-001',
          status: 'LACTATING',
          parity_count: 2,
          total_piglets_born_live: 24,
        },
      ]);
      rows.set(schema.farrowingRecord, [
        { farrow_id: 'f-3', parity_number: 3 },
      ]);

      await expect(
        service.recordFarrowing(
          {
            sow_animal_id: 'sow-1',
            farrowing_date: '2026-06-23',
            piglet_item_id: 'item-piglet',
            piglets_born_live: 9,
          },
          'tenant-1',
        ),
      ).rejects.toThrow('not weaned yet');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('does not trust the sow status alone: LACTATING with no unweaned litter on record can farrow', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          animal_code: 'SOW-001',
          status: 'LACTATING',
          parity_count: 2,
          total_piglets_born_live: 24,
        },
      ]);

      const result = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-06-23',
          piglet_item_id: 'item-piglet',
          piglets_born_live: 9,
        },
        'tenant-1',
      );
      expect(result.parity_number).toBe(3);
    });

    it('sets parity_count to the litter number at weaning and counts weaned piglets', async () => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f-1',
          sow_animal_id: 'sow-1',
          parity_number: 3,
          piglets_weaned: 0,
          notes: null,
        },
      ]);
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          status: 'LACTATING',
          parity_count: 2,
          total_piglets_weaned: 20,
        },
      ]);

      const result = await service.recordWeaning(
        'f-1',
        { weaning_date: '2026-07-21', piglets_weaned: 11 } as any,
        'tenant-1',
      );

      const sowSet = mockDbUpdate.mock.results[0].value.set.mock.calls[1][0];
      expect(sowSet).toMatchObject({
        parity_count: 3,
        total_piglets_weaned: 31,
        status: 'ACTIVE',
      });
      expect(result.parity_count).toBe(3);
    });

    it('refuses to wean a litter that was already weaned, leaving the sow and piglets untouched', async () => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f-1',
          sow_animal_id: 'sow-1',
          parity_number: 3,
          piglets_weaned: 11,
          weaning_date: '2026-07-21',
          notes: null,
        },
      ]);
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'comp-1',
          status: 'ACTIVE',
          parity_count: 3,
          total_piglets_weaned: 31,
        },
      ]);

      await expect(
        service.recordWeaning(
          'f-1',
          { weaning_date: '2026-07-22', piglets_weaned: 11 } as any,
          'tenant-1',
        ),
      ).rejects.toThrow('already weaned');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    // Agreed 9 Oct: a weaned sow goes to Dry Sow, by the ordinary stage move.
    const weanedSow = {
      animal_id: 'sow-1',
      company_id: 'co-1',
      nob_id: 'nob-1',
      lob_id: 'lob-1',
      status: 'LACTATING',
      parity_count: 2,
      total_piglets_weaned: 0,
      current_batch_id: 'b-sows',
      current_stage_id: 'st-lact',
    };
    const weanIt = () =>
      service.recordWeaning(
        'f-1',
        { weaning_date: '2026-11-06', piglets_weaned: 10 } as any,
        'tenant-1',
      );

    it('moves a weaned sow of an animal-wise batch to the Dry Sow stage through the stage move', async () => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f-1',
          sow_animal_id: 'sow-1',
          parity_number: 3,
          piglets_weaned: 0,
          notes: null,
        },
      ]);
      rows.set(schema.animalRegister, [weanedSow]);
      rows.set(schema.batchHeader, [{ tracking_mode: 'ANIMAL_WISE' }]);
      rows.set(schema.stageMaster, [{ stage_id: 'st-dry' }]);

      const result: any = await weanIt();

      expect(animals.transitionStage).toHaveBeenCalledWith(
        'sow-1',
        expect.objectContaining({
          to_stage_id: 'st-dry',
          transition_date: '2026-11-06',
          reason: 'Weaned litter 3',
        }),
        'tenant-1',
        undefined,
      );
      expect(renderedWhere()).toContain('`stage_code` = ?');
      expect(result.message).toContain('moved to Dry Sow');
    });

    it('leaves the sow where she is when there is no Dry Sow stage, or her batch is not animal-wise', async () => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f-1',
          sow_animal_id: 'sow-1',
          parity_number: 3,
          piglets_weaned: 0,
          notes: null,
        },
      ]);
      rows.set(schema.animalRegister, [weanedSow]);
      rows.set(schema.batchHeader, [{ tracking_mode: 'ANIMAL_WISE' }]);
      rows.set(schema.stageMaster, []);
      expect(((await weanIt()) as any).message).toContain(
        'no Dry Sow stage is set up',
      );

      rows.set(schema.batchHeader, [{ tracking_mode: 'BATCH_WISE' }]);
      rows.set(schema.stageMaster, [{ stage_id: 'st-dry' }]);
      await weanIt();
      expect(animals.transitionStage).not.toHaveBeenCalled();
    });
  });

  // G9: a litter is linked to the mating it came from, so the boar's litters show through his matings.
  describe('the mating a litter comes from', () => {
    const sow = {
      animal_id: 'sow-1',
      company_id: 'co-1',
      animal_code: 'SOW-001',
      gender: 'F',
      status: 'PREGNANT',
      parity_count: 0,
    };
    const farrow = (over: object = {}) =>
      service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-10-09',
          piglet_item_id: 'item-piglet',
          piglets_born_live: 9,
          ...over,
        } as any,
        'tenant-1',
      );

    it("links the sow's open mating when the farrowing names none", async () => {
      rows.set(schema.animalRegister, [sow]);
      await farrow();
      const values = mockDbInsert.mock.results
        .map((r) => (r.value.values as jest.Mock).mock.calls[0]?.[0])
        .find((v: any) => v?.farrow_id);
      expect(values).toMatchObject({ breeding_id: 'br-open' });
    });

    it('refuses a farrowing when no mating is recorded', async () => {
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, []);
      await expect(farrow()).rejects.toThrow(
        'No open mating is recorded for SOW-001',
      );
    });

    it('refuses a named mating that already farrowed, or is dated after the farrowing', async () => {
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-1', mating_date: '2026-06-01', farrow_id: 'f-old' },
      ]);
      await expect(farrow({ breeding_id: 'br-1' })).rejects.toThrow(
        'already farrowed',
      );
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-1', mating_date: '2026-10-20', farrow_id: null },
      ]);
      await expect(farrow({ breeding_id: 'br-1' })).rejects.toThrow(
        'dated on or after this farrowing',
      );
    });
  });

  // Decision of 9 Oct: the piglets of a litter are a lot of the piglet bio-asset item in a batch-wise batch, moved on by
  // transfer to whatever stage or batch is wanted.
  describe('the piglet lot', () => {
    const sow = {
      animal_id: 'sow-1',
      company_id: 'co-1',
      animal_code: 'SOW-001',
      animal_type: 'SOW',
      status: 'PREGNANT',
      parity_count: 1,
      total_piglets_born_live: 10,
      total_piglets_weaned: 9,
    };

    it('holds a farrowing’s piglets as a lot — born live plus fostered in, less fostered out — and keeps the batch on the record', async () => {
      rows.set(schema.animalRegister, [sow]);
      pigletLots.createLot.mockResolvedValue({
        batch_id: 'b-pig',
        batch_no: 'BATCH-000010',
        lot_no: 'LOT-00009',
      });

      const result: any = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-10-09',
          piglets_born_live: 11,
          foster_received: 2,
          fostered_out: 1,
          piglet_item_id: 'item-piglet',
          piglet_stage_id: 'st-1',
        } as any,
        'tenant-1',
      );

      expect(pigletLots.createLot).toHaveBeenCalledWith(
        expect.objectContaining({
          quantity: 12,
          item_id: 'item-piglet',
          stage_id: 'st-1',
          farrowing_date: '2026-10-09',
        }),
        'tenant-1',
        undefined,
      );
      expect(result).toMatchObject({
        piglet_batch_id: 'b-pig',
        piglet_lot_no: 'LOT-00009',
        piglet_batch_no: 'BATCH-000010',
      });
      expect(result.message).toContain('12 piglets stay with');
      expect(result.message).toContain(
        'as litter LOT-00009; no batch is made until the weaning',
      );
      expect(result.message).not.toContain('in batch');
    });

    describe('the week 4 alert (BBP: Gilt Week 4 Selection Due)', () => {
      const recent = new Date(Date.now() - 10 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const old = new Date(Date.now() - 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const row = (over: object) => ({
        farrow_id: 'f1',
        farrowing_date: old,
        piglets_weaned: 0,
        piglets_born_live: 10,
        foster_received: 0,
        fostered_out: 0,
        piglet_batch_id: 'b-pig',
        piglet_lot_no: 'LOT-1',
        sow_code: 'SOW-1',
        ...over,
      });

      it('flags a litter still on its sow at 28 days or more, with the head in its lot, and raises one alert for it', async () => {
        rows.set(schema.farrowingRecord, [
          row({}),
          row({ farrow_id: 'f2', farrowing_date: recent }),
          row({ farrow_id: 'f3', piglets_weaned: 9 }),
        ]);
        rows.set(schema.batchHeader, [
          {
            batch_id: 'b-pig',
            batch_no: 'BATCH-8',
            tenant_id: 'tenant-1',
            company_id: 'co-1',
            lob_id: 'lob-1',
            head: '10',
          },
        ]);
        const list: any[] = await service.getFarrowingRecords('tenant-1');
        const by = Object.fromEntries(list.map((f) => [f.farrow_id, f]));
        expect([by.f1.week4_due, by.f2.week4_due, by.f3.week4_due]).toEqual([
          true,
          false,
          false,
        ]);
        expect(by.f1.piglets_in_lot).toBe(10);
        expect(by.f3.piglets_in_lot).toBeNull();
        const alerts = mockDbInsert.mock.results
          .flatMap((r) =>
            (r.value.values as jest.Mock).mock.calls.map(([v]) => v),
          )
          .filter((v) => v?.alert_type === 'GILT_WEEK4');
        expect(alerts).toHaveLength(1);
        expect(alerts[0]).toMatchObject({
          severity: 'CRITICAL',
          batch_id: 'b-pig',
          title: 'Gilt Week 4 Selection Due — SOW-1, lot LOT-1',
        });
      });
    });

    it("says how many of a litter's weaned piglets were kept as gilts", async () => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f1',
          farrowing_date: '2026-09-11',
          piglets_weaned: 11,
          piglets_born_live: 11,
          foster_received: 0,
          fostered_out: 0,
          piglet_batch_id: null,
        },
        {
          farrow_id: 'f2',
          farrowing_date: '2026-08-07',
          piglets_weaned: 12,
          piglets_born_live: 13,
          foster_received: 0,
          fostered_out: 0,
          piglet_batch_id: null,
        },
      ]);
      rows.set(schema.giltSelectionGilt, [{ farrow_id: 'f1', n: '1' }]);
      const list: any[] = await service.getFarrowingRecords('tenant-1');
      expect(
        Object.fromEntries(list.map((f) => [f.farrow_id, f.gilts_selected])),
      ).toEqual({ f1: 1, f2: 0 });
    });

    it("opens the litter at the sow's cost over the piglets born alive, records it as the litter's cost per piglet, and says so", async () => {
      rows.set(schema.animalRegister, [sow]);
      pigletLots.createLot.mockResolvedValue({
        batch_id: 'b-pig',
        batch_no: 'BATCH-000010',
        lot_no: 'LOT-00009',
      });
      const birth = jest
        .spyOn((service as any).litterCost, 'allocateAtBirth')
        .mockResolvedValue({
          note: ' Litter cost at birth 16.50 moved.',
          perPiglet: '1.650000',
          moved: 16.5,
          journal: 'JE-000140',
        });
      const result: any = await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-10-09',
          piglets_born_live: 10,
          piglet_item_id: 'item-piglet',
        } as any,
        'tenant-1',
      );
      expect(birth).toHaveBeenCalledWith(
        expect.objectContaining({
          piglet_batch_id: 'b-pig',
          farrowing_date: '2026-10-09',
        }),
        expect.anything(),
        10,
        'tenant-1',
        undefined,
      );
      const sets = mockDbUpdate.mock.results.flatMap((r) =>
        (r.value.set as jest.Mock).mock.calls.map(([v]) => v),
      );
      expect(
        sets.find((v) => v && v.cost_per_piglet === '1.650000'),
      ).toBeDefined();
      expect(result.cost_per_piglet).toBe('1.650000');
      expect(result.message).toContain(
        'Litter cost at birth 16.50 moved. Journal JE-000140 posted (Dr Piglets Inventory / Cr Biological Asset WIP)',
      );
    });

    it('refuses a farrowing with live piglets and no piglet item, so no litter goes without a ledger entry', async () => {
      rows.set(schema.animalRegister, [sow]);
      await expect(
        service.recordFarrowing(
          {
            sow_animal_id: 'sow-1',
            farrowing_date: '2026-10-09',
            piglets_born_live: 11,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow('Choose the piglet item');
      expect(pigletLots.createLot).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('makes no lot for a litter with nothing born alive', async () => {
      rows.set(schema.animalRegister, [sow]);
      await service.recordFarrowing(
        {
          sow_animal_id: 'sow-1',
          farrowing_date: '2026-10-09',
          piglets_born_live: 0,
          piglets_stillborn: 4,
          piglet_item_id: 'item-piglet',
        } as any,
        'tenant-1',
      );
      expect(pigletLots.createLot).not.toHaveBeenCalled();
    });

    const litter = (over: object = {}) => {
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'f-1',
          company_id: 'co-1',
          sow_animal_id: 'sow-1',
          parity_number: 2,
          piglets_weaned: 0,
          piglet_batch_id: 'b-pig',
          piglet_lot_no: 'LOT-00009',
          notes: null,
          ...over,
        },
      ]);
      rows.set(schema.animalRegister, [{ ...sow, status: 'LACTATING' }]);
      rows.set(schema.batchBioAssetState, [{ current_quantity: '12' }]);
    };
    const wean = (dto: object) =>
      service.recordWeaning(
        'f-1',
        { weaning_date: '2026-11-06', piglets_weaned: 10, ...dto } as any,
        'tenant-1',
      );

    it('records what the lot lost before weaning as mortality, and moves the weaned head to the chosen batch', async () => {
      litter();
      const result: any = await wean({ move_to_batch_id: 'b-weaner' });

      expect(batchService.recordMortality).toHaveBeenCalledWith(
        'b-pig',
        expect.objectContaining({
          transaction_date: '2026-11-06',
          quantity: 2,
        }),
        'tenant-1',
        undefined,
      );
      expect(batchTransfers.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to_batch_id: 'b-weaner',
          quantity: 10,
          transfer_type: 'PARTIAL',
          reason: 'WEANING',
        }),
        'tenant-1',
        'b-pig',
        undefined,
      );
      expect(result.message).toContain('2 lost before weaning');
      expect(result.message).toContain('10 moved to the destination batch');
    });

    describe('a new weaner batch at weaning', () => {
      beforeEach(() => {
        pigletLots.createWeanerBatch
          .mockReset()
          .mockResolvedValue({ batch_id: 'b-new', batch_no: 'BATCH-000050' });
      });

      it('creates the batch from the lot with the stage and pen of the form, then moves the weaned head into it', async () => {
        litter();
        const result: any = await wean({
          new_batch_stage_code: 'WEANER',
          new_batch_pen_id: 'pen-7',
        });

        expect(pigletLots.createWeanerBatch).toHaveBeenCalledWith(
          expect.objectContaining({
            lot_batch_id: 'b-pig',
            stage_code: 'WEANER',
            pen_id: 'pen-7',
            start_date: '2026-11-06',
          }),
          'tenant-1',
          undefined,
        );
        expect(batchTransfers.create).toHaveBeenCalledWith(
          expect.objectContaining({
            to_batch_id: 'b-new',
            quantity: 10,
            transfer_type: 'PARTIAL',
            reason: 'WEANING',
          }),
          'tenant-1',
          'b-pig',
          undefined,
        );
        expect(result.message).toContain(
          '10 moved to the new weaner batch BATCH-000050',
        );
        // the batch exists before the transfer that fills it
        expect(
          pigletLots.createWeanerBatch.mock.invocationCallOrder[0],
        ).toBeLessThan(batchTransfers.create.mock.invocationCallOrder[0]);
      });

      it('works without a pen, and moves only what is left after the losses and the gilts', async () => {
        giltSelection.selectAtWeaning.mockReset().mockResolvedValue({
          selection_no: 'GS-1',
          created: [{ animal_code: 'PIG-1' }, { animal_code: 'PIG-2' }],
        });
        litter({ farrowing_date: '2026-10-09' });
        await wean({
          new_batch_stage_code: 'WEANER',
          gilts: [
            { rfid_tag: 'G1', no_of_teats: 16 },
            { rfid_tag: 'G2', no_of_teats: 15 },
          ],
        });
        expect(pigletLots.createWeanerBatch).toHaveBeenCalledWith(
          expect.objectContaining({ pen_id: undefined }),
          'tenant-1',
          undefined,
        );
        expect(batchTransfers.create).toHaveBeenCalledWith(
          expect.objectContaining({ quantity: 8, to_batch_id: 'b-new' }),
          'tenant-1',
          'b-pig',
          undefined,
        );
      });

      it('creates no empty batch when every weaned piglet became a gilt', async () => {
        giltSelection.selectAtWeaning.mockReset().mockResolvedValue({
          selection_no: 'GS-1',
          created: [{ animal_code: 'PIG-1' }, { animal_code: 'PIG-2' }],
        });
        litter({ farrowing_date: '2026-10-09' });
        const result: any = await wean({
          piglets_weaned: 2,
          new_batch_stage_code: 'WEANER',
          gilts: [
            { rfid_tag: 'G1', no_of_teats: 16 },
            { rfid_tag: 'G2', no_of_teats: 15 },
          ],
        });
        expect(pigletLots.createWeanerBatch).not.toHaveBeenCalled();
        expect(batchTransfers.create).not.toHaveBeenCalled();
        expect(result.message).toContain('no weaner batch was created');
      });

      it('refuses a new batch together with an existing batch or a stage, and a pen with no stage — before anything is written', async () => {
        litter();
        await expect(
          wean({ new_batch_stage_code: 'WEANER', move_to_batch_id: 'b' }),
        ).rejects.toThrow('choose one');
        await expect(
          wean({
            new_batch_stage_code: 'WEANER',
            move_to_stage_code: 'NURSERY',
          }),
        ).rejects.toThrow('choose one');
        await expect(wean({ new_batch_pen_id: 'pen-7' })).rejects.toThrow(
          'needs its stage',
        );
        expect(pigletLots.createWeanerBatch).not.toHaveBeenCalled();
        expect(batchService.recordMortality).not.toHaveBeenCalled();
      });

      it('does not make a second batch when a weaning is posted again', async () => {
        litter({ piglets_weaned: 10 });
        await expect(wean({ new_batch_stage_code: 'WEANER' })).rejects.toThrow(
          'already weaned',
        );
        expect(pigletLots.createWeanerBatch).not.toHaveBeenCalled();
      });
    });

    describe('fostering', () => {
      const foster = (over: object = {}, dto: object = {}) => {
        litter({
          company_id: 'co-1',
          farrowing_date: '2026-10-01',
          fostered_out: 0,
          foster_received: 0,
          ...over,
        });
        rows.set(schema.batchBioAssetState, [{ current_quantity: '12' }]);
        batchTransfers.create.mockResolvedValue({ transfer_no: 'BTR-1' });
        return service.fosterPiglets(
          'f-1',
          {
            to_farrow_id: 'f-2',
            quantity: 3,
            foster_date: '2026-10-05',
            ...dto,
          } as any,
          'tenant-1',
        );
      };

      it('moves the head between the two piglet lots, updates both litters and links them', async () => {
        const result: any = await foster();

        expect(batchTransfers.create).toHaveBeenCalledWith(
          expect.objectContaining({
            to_batch_id: 'b-pig',
            quantity: 3,
            reason: 'FOSTERING',
            transfer_type: 'PARTIAL',
          }),
          'tenant-1',
          'b-pig',
          undefined,
        );
        const sets = mockDbUpdate.mock.results.flatMap((r) =>
          (r.value.set as jest.Mock).mock.calls.map(([v]) => v),
        );
        expect(sets).toEqual(
          expect.arrayContaining([{ fostered_out: 3 }, { foster_received: 3 }]),
        );
        const link = mockDbInsert.mock.results
          .flatMap((r) =>
            (r.value.values as jest.Mock).mock.calls.map(([v]) => v),
          )
          .find((v) => v?.from_farrow_id === 'f-1');
        expect(link).toMatchObject({
          to_farrow_id: 'f-2',
          quantity: 3,
          transfer_no: 'BTR-1',
        });
        expect(result.message).toContain('3 piglets fostered');
      });

      it('refuses the same litter, a weaned litter, more piglets than the lot holds, and a date before the farrowing', async () => {
        await expect(
          service.fosterPiglets(
            'f-1',
            {
              to_farrow_id: 'f-1',
              quantity: 1,
              foster_date: '2026-10-05',
            } as any,
            'tenant-1',
          ),
        ).rejects.toThrow('different litter');
        await expect(foster({ piglets_weaned: 9 })).rejects.toThrow(
          'already weaned',
        );
        await expect(foster({}, { quantity: 13 })).rejects.toThrow(
          'holds 12 piglets',
        );
        await expect(foster({}, { foster_date: '2026-09-30' })).rejects.toThrow(
          'before',
        );
        expect(batchTransfers.create).not.toHaveBeenCalled();
      });
    });

    describe("the sow's lactation cost passes to the litter (Phase 3)", () => {
      const setup = (held: { own: number; shared: number }, nca = '100') => {
        animalBookValue.refreshCache.mockClear();
        litter({ batch_id: 'b-sows', farrowing_date: '2026-10-09' });
        rows.set(schema.batchBioAssetState, [
          { current_quantity: '12', nca_book_value: nca, stage: 'PREMATURE' },
        ]);
        rows.set(schema.batchHeader, [
          {
            batch_id: 'b-sows',
            batch_no: 'BATCH-000001',
            company_id: 'co-1',
            nob_id: 'n1',
            lob_id: 'l1',
          },
        ]);
        rows.set(schema.bioAssetLedger, [{ item_id: 'item-piglet' }]);
        jest
          .spyOn((service as any).litterCost, 'capitalisedLactationCost')
          .mockResolvedValue(held);
      };
      const allocation = () =>
        mockDbInsert.mock.results
          .flatMap((r) =>
            (r.value.values as jest.Mock).mock.calls.map(([v]) => v),
          )
          .find(
            (v) => Array.isArray(v) && bioEventOf(v[0]) === 'COST_ALLOCATION',
          );

      it("writes the sow's own part against HER ledger, her batch's share against the batch, and the whole to the lot", async () => {
        setup({ own: 60, shared: 15 });
        const result: any = await wean({});

        const rowsWritten = allocation();
        expect(
          rowsWritten.map((e: any) => [e.animal_id, Number(e.cost_amount)]),
        ).toEqual([
          ['sow-1', -60],
          [null, -15],
          [null, 75],
        ]);
        expect(
          rowsWritten.reduce(
            (n: number, e: any) => n + Number(e.cost_amount),
            0,
          ),
        ).toBe(0); // nothing created or lost
        expect(animalBookValue.refreshCache).toHaveBeenCalledWith(['sow-1']);
        const farrowSet = mockDbUpdate.mock.results
          .flatMap((r) => (r.value.set as jest.Mock).mock.calls.map(([v]) => v))
          .find((v) => v && 'cost_per_piglet' in v);
        expect(Number(farrowSet.cost_per_piglet)).toBeCloseTo(7.5); // 75 over 10 weaned
        expect(result.message).toContain('Lactation cost 75.00 moved');
      });

      it('has nothing to take from her when it was all expensed, so a sow past her costing start hands nothing over', async () => {
        setup({ own: 0, shared: 0 });
        const result: any = await wean({});
        expect(allocation()).toBeUndefined();
        expect(animalBookValue.refreshCache).not.toHaveBeenCalled();
        expect(result.message).not.toContain('Lactation cost');
      });

      it('gives in proportion when her batch carries less than the two parts', async () => {
        setup({ own: 60, shared: 40 }, '50');
        await wean({});
        expect(
          allocation().map((e: any) => [e.animal_id, Number(e.cost_amount)]),
        ).toEqual([
          ['sow-1', -30],
          [null, -20],
          [null, 50],
        ]);
      });

      it('moves nothing when the sow batch carries nothing', async () => {
        setup({ own: 60, shared: 0 }, '0');
        const result: any = await wean({});
        expect(allocation()).toBeUndefined();
        expect(result.message).not.toContain('Lactation cost');
      });
    });

    it("counts gilts already selected before the weaning in the litter's weaned total, and spreads the cost over them too", async () => {
      litter({ farrowing_date: '2026-10-09' });
      rows.set(schema.giltSelectionGilt, [{ n: '3' }]);
      const allocate = jest
        .spyOn((service as any).litterCost, 'allocate')
        .mockResolvedValue({ note: '', perPiglet: null, moved: 0 });
      const result: any = await wean({ piglets_weaned: 9 });
      expect(allocate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { asOf: '2026-11-06', divisor: 12 },
        'tenant-1',
        undefined,
      );
      expect(result.piglets_weaned).toBe(12);
      expect(result.message).toContain(
        '12 piglets weaned (3 already selected as gilts)',
      );
      const farrowSet = mockDbUpdate.mock.results
        .flatMap((r) => (r.value.set as jest.Mock).mock.calls.map(([v]) => v))
        .find((v) => v && 'cost_per_piglet' in v);
      expect(farrowSet.piglets_weaned).toBe(12);
    });

    describe('gilts selected in the weaning form (one event)', () => {
      const gilts = [
        { rfid_tag: 'G1', no_of_teats: 16 },
        { rfid_tag: 'G2', no_of_teats: 15 },
      ];
      beforeEach(() => {
        giltSelection.selectAtWeaning.mockReset().mockResolvedValue({
          selection_no: 'GS-2026-00001',
          created: [{ animal_code: 'PIG-1' }, { animal_code: 'PIG-2' }],
        });
      });

      it('takes the gilts from the weaned piglets first, and moves only the rest to the destination batch', async () => {
        litter({ farrowing_date: '2026-10-09' });
        const result: any = await wean({ move_to_batch_id: 'b-weaner', gilts });

        expect(giltSelection.selectAtWeaning).toHaveBeenCalledWith(
          { farrow_id: 'f-1', piglet_batch_id: 'b-pig' },
          gilts,
          expect.objectContaining({ date: '2026-11-06' }),
          'tenant-1',
          undefined,
        );
        expect(batchTransfers.create).toHaveBeenCalledWith(
          expect.objectContaining({ quantity: 8, reason: 'WEANING' }),
          'tenant-1',
          'b-pig',
          undefined,
        );
        expect(result.message).toContain(
          '2 gilts selected (GS-2026-00001): PIG-1, PIG-2',
        );
        expect(result.message).toContain('8 moved to the destination batch');
      });

      it('moves nothing when every weaned piglet was selected as a gilt', async () => {
        litter({ farrowing_date: '2026-10-09' });
        await wean({ piglets_weaned: 2, move_to_batch_id: 'b-weaner', gilts });
        expect(batchTransfers.create).not.toHaveBeenCalled();
      });

      it('refuses a gilt under 15 teats, and more gilts than piglets weaned, before anything is written', async () => {
        litter({ farrowing_date: '2026-10-09' });
        await expect(
          wean({ gilts: [{ rfid_tag: 'G1', no_of_teats: 14 }] }),
        ).rejects.toThrow(/14 teats.*at least 15/);
        await expect(wean({ piglets_weaned: 1, gilts })).rejects.toThrow(
          /2 gilts cannot be selected from 1 weaned/,
        );
        expect(giltSelection.selectAtWeaning).not.toHaveBeenCalled();
        expect(batchService.recordMortality).not.toHaveBeenCalled();
      });
    });

    it('leaves an emptied piglet lot open for a user to close (Rishi, 19 Oct), and says so', async () => {
      const closed = () =>
        mockDbUpdate.mock.results.some((r) =>
          (r.value.set as jest.Mock).mock.calls.some(
            ([v]) => v?.status === 'CLOSED',
          ),
        );
      litter();
      await wean({ piglets_weaned: 12 }); // stays in the lot: 12 still on hand
      expect(closed()).toBe(false);

      mockDbUpdate.mockClear();
      litter();
      batchTransfers.create.mockImplementation(async () => {
        rows.set(schema.batchBioAssetState, [{ current_quantity: '0' }]);
        return {};
      });
      const result: any = await wean({
        piglets_weaned: 12,
        move_to_batch_id: 'b-weaner',
      });
      expect(closed()).toBe(false);
      expect(result.message).toContain(
        'piglet lot is now empty; close it from the batch',
      );
    });

    it('moves the lot on to a stage instead when a stage is chosen', async () => {
      litter();
      await wean({ move_to_stage_code: 'WEANER' });
      expect(batchService.transferStage).toHaveBeenCalledWith(
        'b-pig',
        expect.objectContaining({
          to_stage_code: 'WEANER',
          transfer_date: '2026-11-06',
        }),
        'tenant-1',
        undefined,
      );
      expect(batchTransfers.create).not.toHaveBeenCalled();
    });

    it('records no loss when every piglet was weaned', async () => {
      litter();
      await wean({ piglets_weaned: 12 });
      expect(batchService.recordMortality).not.toHaveBeenCalled();
    });

    it('refuses more weaned than the lot holds, a batch and a stage together, and a move for a litter with no lot', async () => {
      litter();
      await expect(wean({ piglets_weaned: 13 })).rejects.toThrow(
        'holds 12 piglets; 13 cannot have been weaned',
      );
      await expect(
        wean({ move_to_batch_id: 'b', move_to_stage_code: 'WEANER' }),
      ).rejects.toThrow('choose one');
      litter({ piglet_batch_id: null });
      await expect(wean({ move_to_batch_id: 'b-weaner' })).rejects.toThrow(
        'has no piglet lot to move',
      );
      expect(batchTransfers.create).not.toHaveBeenCalled();
    });

    it('does not move the same piglets twice when a weaning is posted again', async () => {
      litter({ piglets_weaned: 10 });
      await expect(wean({})).rejects.toThrow('already weaned');
      await expect(wean({ move_to_batch_id: 'b-weaner' })).rejects.toThrow(
        'already weaned',
      );
      expect(batchService.recordMortality).not.toHaveBeenCalled();
      expect(batchTransfers.create).not.toHaveBeenCalled();
    });
  });

  // Decision of 9 Oct: a collection naming an item is a lot of it in stock, with a lot-level QR; a mating that names the
  // lot uses its doses.
  describe('semen as stock', () => {
    const boar = {
      animal_id: 'boar-1',
      company_id: 'co-1',
      animal_code: 'BOAR-1',
      animal_type: 'BOAR',
      gender: 'M',
      current_batch_id: 'b-boar',
    };
    const collection = (over: object = {}) =>
      ({
        boar_animal_id: 'boar-1',
        collection_date: '2026-10-09',
        doses_collected: 40,
        ...over,
      }) as any;

    it('posts a collection that names an item as a lot of it, and keeps the lot, its store and its QR on the record', async () => {
      rows.set(schema.animalRegister, [boar]);
      semenLots.postCollection.mockResolvedValue({
        lot_no: 'LOT-00011',
        expiry_date: '2026-11-08',
        warehouse_id: 'store-1',
        qr_id: 'qr-1',
        pack_no: 'PACK-000007',
      });

      const result: any = await service.recordSemenCollection(
        collection({ output_item_id: 'item-semen' }),
        'tenant-1',
      );

      expect(semenLots.postCollection).toHaveBeenCalledWith(
        expect.objectContaining({
          boarBatchId: 'b-boar',
          collectionDate: '2026-10-09',
          doses: 40,
          itemId: 'item-semen',
        }),
        'tenant-1',
        undefined,
      );
      expect(result).toMatchObject({
        inventory_posted: true,
        lot_no: 'LOT-00011',
        expiry_date: '2026-11-08',
        warehouse_id: 'store-1',
        qr_id: 'qr-1',
        qr_pack_no: 'PACK-000007',
      });
      expect(result.message).toContain(
        'Posted to inventory as lot LOT-00011 (expires 2026-11-08), QR PACK-000007',
      );
    });

    it('records a collection with no item as before, and says it is not stock', async () => {
      rows.set(schema.animalRegister, [boar]);
      const result: any = await service.recordSemenCollection(
        collection(),
        'tenant-1',
      );
      expect(semenLots.postCollection).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        inventory_posted: false,
        lot_no: null,
        qr_id: null,
      });
      expect(result.message).toContain('Not posted to inventory');
    });

    it('takes the doses out of the lot a mating names, and refuses the mating if the lot cannot supply them', async () => {
      const sow = {
        animal_id: 'sow-1',
        tenant_id: 'tenant-1',
        company_id: 'co-1',
        animal_code: 'SOW-001',
        gender: 'F',
        parity_count: 0,
        is_active: true,
        current_batch_id: 'batch-1',
      };
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, []);
      jest
        .spyOn(service as any, 'resolveSowAndBoar')
        .mockResolvedValue({ sow, companyId: 'co-1', boarAnimalId: 'boar-1' });
      const lot = {
        semen_batch_id: 'sb-1',
        boar_animal_id: 'boar-1',
        company_id: 'co-1',
        tenant_id: 'tenant-1',
        doses_collected: '40',
        doses_used_internal: '0',
        doses_sold: '0',
        lot_no: 'LOT-1',
      };
      rows.set(schema.semenBatch, [lot]);

      await service.recordMating(
        {
          sow_animal_id: 'sow-1',
          boar_animal_id: 'boar-1',
          semen_lot_id: 'sb-1',
          mating_type: 'AI',
          mating_date: '2026-10-09',
          semen_dose_qty: 2,
        } as any,
        'tenant-1',
      );
      expect(semenLots.issueDoses).toHaveBeenCalledWith(
        lot,
        2,
        expect.any(String),
        '2026-10-09',
        'tenant-1',
        undefined,
        {
          sow: expect.objectContaining({ animal_id: expect.any(String) }),
          batchId: expect.anything(),
        },
      );

      semenLots.issueDoses.mockRejectedValueOnce(
        new BadRequestException(
          'The semen lot LOT-1 has 1 dose left; 2 cannot be used.',
        ),
      );
      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            boar_animal_id: 'boar-1',
            semen_lot_id: 'sb-1',
            mating_type: 'AI',
            mating_date: '2026-10-09',
            semen_dose_qty: 2,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow('1 dose left');
    });

    // Pooled semen: one lot mixed from the ejaculates of several boars.
    describe('pooled from several boars', () => {
      const boar2 = {
        animal_id: 'boar-2',
        company_id: 'co-1',
        animal_code: 'BOAR-2',
        animal_type: 'BOAR',
        gender: 'M',
        is_active: true,
        current_batch_id: 'b-boar',
      };
      const insertedRows = () =>
        mockDbInsert.mock.results.flatMap((r: any) =>
          r.value.values.mock.calls.map((c: any[]) => c[0]),
        );

      it('makes ONE lot of the boars together, names every boar on it, and splits the typed cost between them', async () => {
        rows.set(schema.animalRegister, [boar, boar2]);
        semenLots.postCollection.mockResolvedValue({
          lot_no: 'LOT-00020',
          expiry_date: '2026-10-14',
          warehouse_id: 'store-1',
          qr_id: 'qr-2',
          pack_no: 'PACK-000008',
        });

        const result: any = await service.recordSemenCollection(
          collection({
            output_item_id: 'item-pooled',
            pool_boar_animal_ids: ['boar-2'],
            feed_cost_period: 80,
            overhead_cost_period: 20,
          }),
          'tenant-1',
        );

        // one posting to stock, with the other boar named so the QR can list him
        expect(semenLots.postCollection).toHaveBeenCalledTimes(1);
        expect(semenLots.postCollection.mock.calls[0][0].poolBoars).toEqual([
          boar2,
        ]);
        // the lot's cost is the whole mix over its doses
        expect(result).toMatchObject({
          lot_no: 'LOT-00020',
          pooled_boars: ['BOAR-1', 'BOAR-2'],
          running_cost_period: '100.0000',
          unit_cost_per_dose: '2.500000',
        });
        expect(result.message).toContain(
          'one pooled lot from 2 boars (BOAR-1, BOAR-2)',
        );
        // the lot record, then one contributor row per boar in the order chosen
        const [lot, contributors] = insertedRows();
        expect(lot.boar_animal_id).toBe('boar-1');
        expect(contributors).toEqual([
          expect.objectContaining({
            semen_batch_id: lot.semen_batch_id,
            boar_animal_id: 'boar-1',
            sort_order: 0,
            cost_share: '50.0000',
          }),
          expect.objectContaining({
            semen_batch_id: lot.semen_batch_id,
            boar_animal_id: 'boar-2',
            sort_order: 1,
            cost_share: '50.0000',
          }),
        ]);
      });

      it('is an ordinary single-boar lot when the only boar named is the primary, and writes no contributor rows', async () => {
        rows.set(schema.animalRegister, [boar]);
        const result: any = await service.recordSemenCollection(
          collection({ pool_boar_animal_ids: ['boar-1', 'boar-1'] }),
          'tenant-1',
        );
        expect(result.pooled_boars).toBeUndefined();
        expect(insertedRows()).toHaveLength(1);
      });

      it('refuses to pool an animal that is not a boar, one that is inactive, or one that does not exist', async () => {
        rows.set(schema.animalRegister, [boar, { ...boar2, gender: 'F' }]);
        await expect(
          service.recordSemenCollection(
            collection({ pool_boar_animal_ids: ['boar-2'] }),
            'tenant-1',
          ),
        ).rejects.toThrow('BOAR-2 is not a boar');

        rows.set(schema.animalRegister, [boar, { ...boar2, is_active: false }]);
        await expect(
          service.recordSemenCollection(
            collection({ pool_boar_animal_ids: ['boar-2'] }),
            'tenant-1',
          ),
        ).rejects.toThrow('no longer active');

        rows.set(schema.animalRegister, [boar]);
        await expect(
          service.recordSemenCollection(
            collection({ pool_boar_animal_ids: ['boar-ghost'] }),
            'tenant-1',
          ),
        ).rejects.toThrow(NotFoundException);
        expect(semenLots.postCollection).not.toHaveBeenCalled();
      });

      it('records no single sire for an AI service from a pooled lot, and refuses a boar that is not one of the pool', async () => {
        const sow = {
          animal_id: 'sow-1',
          tenant_id: 'tenant-1',
          company_id: 'co-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 0,
          current_batch_id: null,
        };
        rows.set(schema.animalRegister, [sow]);
        rows.set(schema.semenBatch, [
          { semen_batch_id: 'sb-pool', boar_animal_id: 'boar-1' },
        ]);
        rows.set(schema.semenBatchBoar, [
          { boar_animal_id: 'boar-1' },
          { boar_animal_id: 'boar-2' },
        ]);

        const pooled = await (service as any).resolveSowAndBoar(
          {
            sow_animal_id: 'sow-1',
            semen_lot_id: 'sb-pool',
            mating_type: 'AI',
          },
          'tenant-1',
        );
        expect(pooled.boarAnimalId).toBeNull();

        await expect(
          (service as any).resolveSowAndBoar(
            {
              sow_animal_id: 'sow-1',
              semen_lot_id: 'sb-pool',
              boar_animal_id: 'boar-9',
              mating_type: 'AI',
            },
            'tenant-1',
          ),
        ).rejects.toThrow(
          'not one of the boars this pooled semen lot was mixed from',
        );
      });

      it('still names the one boar behind a lot from a single boar', async () => {
        const sow = {
          animal_id: 'sow-1',
          tenant_id: 'tenant-1',
          company_id: 'co-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 0,
          current_batch_id: null,
        };
        rows.set(schema.animalRegister, [sow, { ...boar }]);
        rows.set(schema.semenBatch, [
          { semen_batch_id: 'sb-1', boar_animal_id: 'boar-1' },
        ]);
        rows.set(schema.semenBatchBoar, []);
        const lot = await (service as any).boarOfSemenLot(
          'sb-1',
          'co-1',
          'tenant-1',
        );
        expect(lot).toEqual({ boarId: 'boar-1', poolBoarIds: [] });
      });
    });

    it('uses no doses for a mating that names no lot', async () => {
      const sow = {
        animal_id: 'sow-1',
        tenant_id: 'tenant-1',
        company_id: 'co-1',
        animal_code: 'SOW-001',
        gender: 'F',
        parity_count: 0,
        is_active: true,
        current_batch_id: 'batch-1',
      };
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, []);
      jest
        .spyOn(service as any, 'resolveSowAndBoar')
        .mockResolvedValue({ sow, companyId: 'co-1', boarAnimalId: 'boar-1' });
      await service.recordMating(
        {
          sow_animal_id: 'sow-1',
          mating_type: 'NATURAL_MATING',
          boar_animal_id: 'boar-1',
          mating_date: '2026-10-09',
        } as any,
        'tenant-1',
      );
      expect(semenLots.issueDoses).not.toHaveBeenCalled();
    });
  });

  describe('recordSemenCollection', () => {
    it('calculates unit cost per dose from period running costs', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'boar-1',
          company_id: 'comp-1',
          animal_code: 'BOAR-1',
          gender: 'M',
        },
      ]);

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
    const grasmere = {
      farmId: 'farm-g',
      restricted: true,
      companyId: 'co-1',
      lobId: 'lob-pig',
    };

    it('stores the sow company, never the body company', async () => {
      rows.set(schema.breedingRecord, []);
      jest
        .spyOn(service as any, 'assertLotUsable')
        .mockResolvedValue({ semen_batch_id: 'sb-1' });
      jest
        .spyOn(service as any, 'boarOfSemenLot')
        .mockResolvedValue({ boarId: null, poolBoarIds: [] });
      const result = await service.recordMating(
        {
          sow_animal_id: 'sow-1',
          semen_lot_id: 'sb-1',
          mating_type: MatingType.AI,
          mating_date: '2026-03-01',
        } as any,
        'tenant-1',
      );
      expect(result.company_id).toBe('co-1');
    });

    it('refuses an AI service that names no semen lot', async () => {
      rows.set(schema.breedingRecord, []);
      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            mating_type: MatingType.AI,
            mating_date: '2026-03-01',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow('needs the semen lot');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses a body company_id that differs from the sow company, before any insert', async () => {
      // Without the fix the record was inserted under 'co-other'.
      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            company_id: 'co-other',
            mating_type: MatingType.AI,
            mating_date: '2026-03-01',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.recordFarrowing(
          {
            sow_animal_id: 'sow-1',
            company_id: 'co-other',
            farrowing_date: '2026-06-23',
            piglet_item_id: 'item-piglet',
            piglets_born_live: 8,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.recordSemenCollection(
          {
            boar_animal_id: 'sow-1',
            company_id: 'co-other',
            collection_date: '2026-04-01',
            doses_collected: 10,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a batch_id outside the caller scope, through the batch scope conditions', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.batchHeader, []); // exists on Kintyre, so the scoped query finds nothing

      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            batch_id: 'batch-kintyre',
            mating_type: MatingType.AI,
            mating_date: '2026-03-01',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow("Batch with ID 'batch-kintyre' not found.");
      expect(renderedWhere()).toContain('`batch_header`.`farm_id` = ?');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a farrowing batch_id outside the caller scope', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.batchHeader, []);

      await expect(
        service.recordFarrowing(
          {
            sow_animal_id: 'sow-1',
            batch_id: 'batch-kintyre',
            farrowing_date: '2026-06-23',
            piglet_item_id: 'item-piglet',
            piglets_born_live: 8,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('answers not-found for a semen lot outside the caller scope', async () => {
      useFarmScope(cls, grasmere);
      rows.set(schema.semenBatch, []);

      await expect(
        service.recordMating(
          {
            sow_animal_id: 'sow-1',
            semen_lot_id: 'lot-kintyre',
            mating_type: MatingType.AI,
            mating_date: '2026-03-01',
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow("Semen lot with ID 'lot-kintyre' not found.");
      expect(renderedWhere()).toContain('animal_register af');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('farm scope', () => {
    it('lists only matings of sows on the active farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: false,
        companyId: 'co-1',
        lobId: null,
      });

      await service.getMatingRecords('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it('lists only farrowings of sows on the active farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: false,
        companyId: 'co-1',
        lobId: null,
      });

      await service.getFarrowingRecords('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it('lists only semen batches of boars on the active farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: false,
        companyId: 'co-1',
        lobId: null,
      });

      await service.getSemenBatches('tenant-1');

      expect(renderedWhere()).toContain('animal_register af');
    });

    it.each([
      ['matings', () => service.getMatingRecords('tenant-1')],
      ['farrowings', () => service.getFarrowingRecords('tenant-1')],
      ['semen batches', () => service.getSemenBatches('tenant-1')],
    ])(
      'bounds %s by company and LOB when an operational admin selected no farm',
      async (_label, run) => {
        useFarmScope(cls, {
          farmId: null,
          restricted: true,
          companyId: 'co-1',
          lobId: 'lob-pig',
        });

        await run();

        const where = renderedWhere();
        expect(where).toContain('`animal_register`.`company_id` = ?');
        expect(where).toContain('`animal_register`.`lob_id` = ?');
      },
    );

    it('answers 404 when recording a mating for a sow on another farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: true,
        companyId: 'co-1',
        lobId: 'lob-pig',
      });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordMating(
          { sow_animal_id: 'sow-k', mating_date: '2026-09-01' } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when recording a farrowing for a sow on another farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: true,
        companyId: 'co-1',
        lobId: 'lob-pig',
      });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordFarrowing(
          {
            sow_animal_id: 'sow-k',
            farrowing_date: '2026-09-01',
            piglet_item_id: 'item-piglet',
            piglets_born_live: 8,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 when recording a semen collection for a boar on another farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: true,
        companyId: 'co-1',
        lobId: 'lob-pig',
      });
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordSemenCollection(
          {
            boar_animal_id: 'boar-k',
            collection_date: '2026-09-01',
            doses_collected: 10,
          } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a pregnancy check on a breeding record whose sow is on another farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: true,
        companyId: 'co-1',
        lobId: 'lob-pig',
      });
      rows.set(schema.breedingRecord, [
        {
          breeding_id: 'breed-1',
          tenant_id: 'tenant-1',
          sow_animal_id: 'sow-k',
          preg_check_date: '2026-09-01',
          preg_check_method: 'ULTRASOUND',
          notes: null,
        },
      ]);
      // The sow exists tenant-wide but not on this active farm.
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordPregnancyCheck(
          'breed-1',
          { pregnancy_confirmed: true } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('answers 404 for a weaning on a farrowing record whose sow is on another farm', async () => {
      useFarmScope(cls, {
        farmId: 'farm-g',
        restricted: true,
        companyId: 'co-1',
        lobId: 'lob-pig',
      });
      rows.set(schema.farrowingRecord, [
        {
          farrow_id: 'farrow-1',
          tenant_id: 'tenant-1',
          sow_animal_id: 'sow-k',
          notes: null,
        },
      ]);
      // The sow exists tenant-wide but not on this active farm.
      rows.set(schema.animalRegister, []);

      await expect(
        service.recordWeaning(
          'farrow-1',
          { weaning_date: '2026-09-29', piglets_weaned: 7 } as any,
          'tenant-1',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
  /**
   * Breeding is recorded batch by batch: the animal must stand in an active, animal-wise batch, be live and of the right
   * kind, and the dates, doses and lot must make sense. Each rule below was open before (a mating, farrowing or semen
   * collection was filed under any batch, or none, for any animal of the right sex).
   */
  describe('batch-first breeding rules', () => {
    const mate = (over: object = {}) =>
      ({
        sow_animal_id: 'sow-1',
        mating_type: MatingType.AI,
        mating_date: '2026-03-01',
        ...over,
      }) as any;
    const farrow = (over: object = {}) =>
      ({
        sow_animal_id: 'sow-1',
        farrowing_date: '2026-06-24',
        piglets_born_live: 12,
        ...over,
      }) as any;
    const collect = (over: object = {}) =>
      ({
        boar_animal_id: 'boar-1',
        collection_date: '2026-10-09',
        doses_collected: 40,
        ...over,
      }) as any;
    const boar = {
      animal_id: 'boar-1',
      company_id: 'co-1',
      animal_code: 'BOAR-1',
      animal_type: 'BOAR',
      gender: 'M',
    };
    beforeEach(() => rows.set(schema.breedingRecord, []));

    it('refuses a sow or boar that is in no batch, and one that is in a different batch from the one chosen', async () => {
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'co-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 0,
          current_batch_id: null,
        },
      ]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'not in a batch',
      );
      await expect(
        service.recordFarrowing(farrow(), 'tenant-1'),
      ).rejects.toThrow('not in a batch');
      rows.set(schema.animalRegister, [{ ...boar, current_batch_id: null }]);
      await expect(
        service.recordSemenCollection(collect(), 'tenant-1'),
      ).rejects.toThrow('not in a batch');
      rows.set(schema.animalRegister, [
        {
          animal_id: 'sow-1',
          company_id: 'co-1',
          animal_code: 'SOW-001',
          gender: 'F',
          parity_count: 0,
          current_batch_id: 'batch-2',
        },
      ]);
      await expect(
        service.recordMating(mate({ batch_id: 'batch-1' }), 'tenant-1'),
      ).rejects.toThrow("is not in batch 'BATCH-1'");
    });

    it('refuses a batch that is not animal-wise or not active', async () => {
      rows.set(schema.batchHeader, [
        {
          batch_id: 'batch-1',
          batch_no: 'BATCH-1',
          tracking_mode: 'BATCH_WISE',
          status: 'ACTIVE',
          farm_id: null,
        },
      ]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'not animal-wise',
      );
      rows.set(schema.batchHeader, [
        {
          batch_id: 'batch-1',
          batch_no: 'BATCH-1',
          tracking_mode: 'ANIMAL_WISE',
          status: 'CLOSED',
          farm_id: null,
        },
      ]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'closed, not active',
      );
    });

    it('files the mating, the litter and the collection under the batch the animal stands in', async () => {
      jest
        .spyOn(service as any, 'assertLotUsable')
        .mockResolvedValue({ semen_batch_id: 'sb-1' });
      jest
        .spyOn(service as any, 'boarOfSemenLot')
        .mockResolvedValue({ boarId: null, poolBoarIds: [] });
      const mating: any = await service.recordMating(
        mate({ semen_lot_id: 'sb-1' }),
        'tenant-1',
      );
      expect(mating.batch_id).toBe('batch-1');
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-open', mating_date: '2026-01-01' },
      ]);
      const litter: any = await service.recordFarrowing(
        farrow({ piglet_item_id: 'item-piglet' }),
        'tenant-1',
      );
      expect(litter.batch_id).toBe('batch-1');
      rows.set(
        schema.animalRegister,
        [boar].map((b) => ({ ...b, current_batch_id: 'batch-1' })),
      );
      const lot: any = await service.recordSemenCollection(
        collect(),
        'tenant-1',
      );
      expect(lot.boar_batch_id).toBe('batch-1');
    });

    it('refuses to serve a sow that already has an open service, is pregnant, is nursing, or is not live', async () => {
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-1', mating_date: '2026-02-01' },
      ]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'already has an open service',
      );
      rows.set(schema.breedingRecord, []);
      const sow = {
        animal_id: 'sow-1',
        company_id: 'co-1',
        animal_code: 'SOW-001',
        gender: 'F',
        parity_count: 0,
      };
      rows.set(schema.animalRegister, [{ ...sow, status: 'PREGNANT' }]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'PREGNANT',
      );
      rows.set(schema.animalRegister, [{ ...sow, status: 'LACTATING' }]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'nursing',
      );
      rows.set(schema.animalRegister, [{ ...sow, is_active: false }]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'no longer active',
      );
      rows.set(schema.animalRegister, [{ ...sow, animal_type: 'BOAR' }]);
      await expect(service.recordMating(mate(), 'tenant-1')).rejects.toThrow(
        'not a SOW or GILT',
      );
    });

    it('refuses a boar who is inactive or not a boar on a service, and a semen lot on a natural mating', async () => {
      const sow = {
        animal_id: 'sow-1',
        company_id: 'co-1',
        animal_code: 'SOW-001',
        gender: 'F',
        parity_count: 0,
      };
      // The table mock answers every animal lookup with the first row, so look the two up by id.
      let animalsById: Record<string, object> = {};
      jest
        .spyOn(service as any, 'findScopedAnimal')
        .mockImplementation(async (id: any) => animalsById[id]);
      const live = { is_active: true, current_batch_id: 'batch-1' };
      animalsById = {
        'sow-1': { ...sow, ...live },
        'boar-1': { ...boar, ...live, is_active: false },
      };
      await expect(
        service.recordMating(
          mate({
            mating_type: MatingType.NATURAL_MATING,
            boar_animal_id: 'boar-1',
          }),
          'tenant-1',
        ),
      ).rejects.toThrow('no longer active');
      animalsById = {
        'sow-1': { ...sow, ...live },
        'boar-1': { ...boar, ...live },
      };
      await expect(
        service.recordMating(
          mate({
            mating_type: MatingType.NATURAL_MATING,
            boar_animal_id: 'boar-1',
            semen_lot_id: 'sb-1',
          }),
          'tenant-1',
        ),
      ).rejects.toThrow('AI service, not a natural mating');
    });

    it('refuses future dates, a second insemination out of range, and part doses', async () => {
      await expect(
        service.recordMating(mate({ mating_date: '2999-01-01' }), 'tenant-1'),
      ).rejects.toThrow('cannot be in the future');
      await expect(
        service.recordMating(
          mate({ second_mating_date: '2026-02-28' }),
          'tenant-1',
        ),
      ).rejects.toThrow('cannot be before the first');
      await expect(
        service.recordMating(
          mate({ second_mating_date: '2026-03-20' }),
          'tenant-1',
        ),
      ).rejects.toThrow('within a week');
      await expect(
        service.recordMating(mate({ semen_dose_qty: 1.5 }), 'tenant-1'),
      ).rejects.toThrow('whole number');
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-open', mating_date: '2026-01-01' },
      ]);
      await expect(
        service.recordFarrowing(
          farrow({ farrowing_date: '2999-01-01' }),
          'tenant-1',
        ),
      ).rejects.toThrow('cannot be in the future');
    });

    it('refuses an expired semen lot, and one collected after the mating', async () => {
      rows.set(schema.semenBatch, [
        {
          semen_batch_id: 'sb-1',
          boar_animal_id: 'boar-1',
          company_id: 'co-1',
          tenant_id: 'tenant-1',
          collection_date: '2026-02-20',
          expiry_date: '2026-02-25',
          doses_collected: '40',
          lot_no: 'LOT-1',
        },
      ]);
      jest.spyOn(service as any, 'resolveSowAndBoar').mockResolvedValue({
        sow: rows.get(schema.animalRegister)![0],
        companyId: 'co-1',
        boarAnimalId: 'boar-1',
      });
      await expect(
        service.recordMating(mate({ semen_lot_id: 'sb-1' }), 'tenant-1'),
      ).rejects.toThrow('expired on 2026-02-25');
      rows.set(schema.semenBatch, [
        {
          semen_batch_id: 'sb-1',
          boar_animal_id: 'boar-1',
          company_id: 'co-1',
          tenant_id: 'tenant-1',
          collection_date: '2026-03-02',
          doses_collected: '40',
          lot_no: 'LOT-1',
        },
      ]);
      await expect(
        service.recordMating(mate({ semen_lot_id: 'sb-1' }), 'tenant-1'),
      ).rejects.toThrow('after this mating');
      expect(semenLots.issueDoses).not.toHaveBeenCalled();
    });

    it('refuses a farrowing from a mating recorded as FAILED or REPEAT, an empty litter, part piglets and more fostered out than there are', async () => {
      rows.set(schema.breedingRecord, [
        {
          breeding_id: 'br-open',
          mating_date: '2026-01-01',
          conception_result: 'REPEAT',
          farrow_id: null,
        },
      ]);
      await expect(
        service.recordFarrowing(farrow({ breeding_id: 'br-open' }), 'tenant-1'),
      ).rejects.toThrow('recorded as REPEAT');
      rows.set(schema.breedingRecord, [
        { breeding_id: 'br-open', mating_date: '2026-01-01' },
      ]);
      await expect(
        service.recordFarrowing(farrow({ piglets_born_live: 0 }), 'tenant-1'),
      ).rejects.toThrow('at least one piglet');
      await expect(
        service.recordFarrowing(
          farrow({ piglets_born_live: 11.5 }),
          'tenant-1',
        ),
      ).rejects.toThrow('whole numbers');
      await expect(
        service.recordFarrowing(farrow({ fostered_out: 13 }), 'tenant-1'),
      ).rejects.toThrow('Fostered out (13)');
      await expect(
        service.recordFarrowing(
          farrow({ foster_received: 2, fostered_out: 14 }),
          'tenant-1',
        ),
      ).resolves.toBeDefined();
    });

    it('refuses a collection from a boar who is not male or inactive, doses that are not whole, used + sold over collected, a future or pre-entry date, and a pooled boar from another batch', async () => {
      const inBatch = { ...boar, current_batch_id: 'batch-1' };
      rows.set(schema.animalRegister, [{ ...inBatch, gender: 'F' }]);
      await expect(
        service.recordSemenCollection(collect(), 'tenant-1'),
      ).rejects.toThrow('not male');
      rows.set(schema.animalRegister, [{ ...inBatch, is_active: false }]);
      await expect(
        service.recordSemenCollection(collect(), 'tenant-1'),
      ).rejects.toThrow('no longer active');
      rows.set(schema.animalRegister, [
        { ...inBatch, entry_date: '2026-10-10' },
      ]);
      await expect(
        service.recordSemenCollection(collect(), 'tenant-1'),
      ).rejects.toThrow('entered on 2026-10-10');
      rows.set(schema.animalRegister, [inBatch]);
      await expect(
        service.recordSemenCollection(
          collect({ collection_date: '2999-01-01' }),
          'tenant-1',
        ),
      ).rejects.toThrow('cannot be in the future');
      await expect(
        service.recordSemenCollection(
          collect({ doses_collected: 10.5 }),
          'tenant-1',
        ),
      ).rejects.toThrow('whole number');
      await expect(
        service.recordSemenCollection(
          collect({ doses_used_internal: 30, doses_sold: 11 }),
          'tenant-1',
        ),
      ).rejects.toThrow('cannot be more than the doses collected');
      rows.set(schema.animalRegister, [
        inBatch,
        {
          ...boar,
          animal_id: 'boar-2',
          animal_code: 'BOAR-2',
          is_active: true,
          current_batch_id: 'batch-9',
        },
      ]);
      await expect(
        service.recordSemenCollection(
          collect({ pool_boar_animal_ids: ['boar-2'] }),
          'tenant-1',
        ),
      ).rejects.toThrow('not in the same batch');
    });
  });
});
