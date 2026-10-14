import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PigletLotService } from '../../production/batch/piglet-lot.service';
import { BatchService } from '../../production/batch/batch.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { BatchTransferService } from '../../production/batch/batch-transfer.service';
import { SemenLotService } from './semen-lot.service';
import { AnimalService } from '../animal/animal.service';
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

  const pigletLots = { createLot: jest.fn() };
  const batchService = { recordMortality: jest.fn(), transferStage: jest.fn() };
  const batchTransfers = { create: jest.fn() };
  const semenLots = { postCollection: jest.fn(), issueDoses: jest.fn() };
  const animals = { transitionStage: jest.fn() };

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
    rows.set(schema.animalRegister, [{ animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', parity_count: 0, current_batch_id: null, total_piglets_born_live: 0, total_piglets_weaned: 0 }]);
    // Every litter comes from a mating (G9): the sow's open one, found when the farrowing names none.
    rows.set(schema.breedingRecord, [{ breeding_id: 'br-open', mating_date: '2026-01-01' }]);
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
        { provide: PigletLotService, useValue: pigletLots },
        { provide: BatchService, useValue: batchService },
        { provide: InventoryLedgerService, useValue: { writeNegativeEntry: jest.fn().mockResolvedValue({ ledger_id: 'led-1', amount: '-100' }) } },
        { provide: GlPostingService, useValue: { postInventoryLedgerEntry: jest.fn().mockResolvedValue(undefined) } },
        { provide: BatchTransferService, useValue: batchTransfers },
        { provide: SemenLotService, useValue: semenLots },
        { provide: AnimalService, useValue: animals },
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
      rows.set(schema.animalRegister, [{ animal_id: 'sow-1', company_id: 'comp-1', animal_code: 'SOW-001', gender: 'F', parity_count: 1, breed_id: null }]);
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
      rows.set(schema.animalRegister, [{ animal_id: 'sow-1', company_id: 'comp-1', animal_code: 'SOW-001', gender: 'F', parity_count: 1, breed_id: 'breed-large-white' }]);
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

  // Parity counts completed pregnancies, post weaning (decisions.md, TDD row 27): farrowing
  // numbers the litter, weaning completes it. Farrowing used to add one itself, the stage move
  // out of farrowing added another, and weaning added none.
  describe('parity completes at weaning', () => {
    it('does not move parity_count at farrowing, and numbers the litter parity + 1', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1', company_id: 'comp-1', animal_type: 'SOW', status: 'PREGNANT',
        parity_count: 2, total_piglets_born_live: 24,
      }]);

      const result = await service.recordFarrowing(
        { sow_animal_id: 'sow-1', farrowing_date: '2026-06-23', piglets_born_live: 12 },
        'tenant-1',
      );

      const setArgs = mockDbUpdate.mock.results[0].value.set.mock.calls[0][0];
      expect(result.parity_number).toBe(3);
      expect(setArgs).not.toHaveProperty('parity_count');
      expect(setArgs.status).toBe('LACTATING');
      expect(setArgs.total_piglets_born_live).toBe(36);
    });

    it('refuses a second farrowing while the last litter is not weaned (litter number above parity_count)', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1', company_id: 'comp-1', animal_code: 'SOW-001', status: 'LACTATING',
        parity_count: 2, total_piglets_born_live: 24,
      }]);
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-3', parity_number: 3 }]);

      await expect(
        service.recordFarrowing({ sow_animal_id: 'sow-1', farrowing_date: '2026-06-23', piglets_born_live: 9 }, 'tenant-1'),
      ).rejects.toThrow('not weaned yet');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('does not trust the sow status alone: LACTATING with no unweaned litter on record can farrow', async () => {
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1', company_id: 'comp-1', animal_code: 'SOW-001', status: 'LACTATING',
        parity_count: 2, total_piglets_born_live: 24,
      }]);

      const result = await service.recordFarrowing(
        { sow_animal_id: 'sow-1', farrowing_date: '2026-06-23', piglets_born_live: 9 },
        'tenant-1',
      );
      expect(result.parity_number).toBe(3);
    });

    it('sets parity_count to the litter number at weaning and counts weaned piglets', async () => {
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-1', sow_animal_id: 'sow-1', parity_number: 3, piglets_weaned: 0, notes: null }]);
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1', company_id: 'comp-1', status: 'LACTATING', parity_count: 2, total_piglets_weaned: 20,
      }]);

      const result = await service.recordWeaning('f-1', { weaning_date: '2026-07-21', piglets_weaned: 11 } as any, 'tenant-1');

      const sowSet = mockDbUpdate.mock.results[0].value.set.mock.calls[1][0];
      expect(sowSet).toMatchObject({ parity_count: 3, total_piglets_weaned: 31, status: 'ACTIVE' });
      expect(result.parity_count).toBe(3);
    });

    it('does not count the litter or its piglets twice when the same weaning is posted again', async () => {
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-1', sow_animal_id: 'sow-1', parity_number: 3, piglets_weaned: 11, notes: null }]);
      rows.set(schema.animalRegister, [{
        animal_id: 'sow-1', company_id: 'comp-1', status: 'ACTIVE', parity_count: 3, total_piglets_weaned: 31,
      }]);

      await service.recordWeaning('f-1', { weaning_date: '2026-07-21', piglets_weaned: 11 } as any, 'tenant-1');

      const sowSet = mockDbUpdate.mock.results[0].value.set.mock.calls[1][0];
      expect(sowSet).toMatchObject({ parity_count: 3, total_piglets_weaned: 31 });
    });

    // Agreed 9 Oct: a weaned sow goes to Dry Sow, by the ordinary stage move.
    const weanedSow = { animal_id: 'sow-1', company_id: 'co-1', nob_id: 'nob-1', lob_id: 'lob-1', status: 'LACTATING', parity_count: 2, total_piglets_weaned: 0, current_batch_id: 'b-sows', current_stage_id: 'st-lact' };
    const weanIt = () => service.recordWeaning('f-1', { weaning_date: '2026-11-06', piglets_weaned: 10 } as any, 'tenant-1');

    it('moves a weaned sow of an animal-wise batch to the Dry Sow stage through the stage move', async () => {
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-1', sow_animal_id: 'sow-1', parity_number: 3, piglets_weaned: 0, notes: null }]);
      rows.set(schema.animalRegister, [weanedSow]);
      rows.set(schema.batchHeader, [{ tracking_mode: 'ANIMAL_WISE' }]);
      rows.set(schema.stageMaster, [{ stage_id: 'st-dry' }]);

      const result: any = await weanIt();

      expect(animals.transitionStage).toHaveBeenCalledWith(
        'sow-1',
        expect.objectContaining({ to_stage_id: 'st-dry', transition_date: '2026-11-06', reason: 'Weaned litter 3' }),
        'tenant-1',
        undefined,
      );
      expect(renderedWhere()).toContain('`stage_code` = ?');
      expect(result.message).toContain('moved to Dry Sow');
    });

    it('leaves the sow where she is when there is no Dry Sow stage, or her batch is not animal-wise', async () => {
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-1', sow_animal_id: 'sow-1', parity_number: 3, piglets_weaned: 0, notes: null }]);
      rows.set(schema.animalRegister, [weanedSow]);
      rows.set(schema.batchHeader, [{ tracking_mode: 'ANIMAL_WISE' }]);
      rows.set(schema.stageMaster, []);
      expect((await weanIt() as any).message).toContain('no Dry Sow stage is set up');

      rows.set(schema.batchHeader, [{ tracking_mode: 'BATCH_WISE' }]);
      rows.set(schema.stageMaster, [{ stage_id: 'st-dry' }]);
      await weanIt();
      expect(animals.transitionStage).not.toHaveBeenCalled();
    });
  });

  // G9: a litter is linked to the mating it came from, so the boar's litters show through his matings.
  describe('the mating a litter comes from', () => {
    const sow = { animal_id: 'sow-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', status: 'PREGNANT', parity_count: 0 };
    const farrow = (over: object = {}) =>
      service.recordFarrowing({ sow_animal_id: 'sow-1', farrowing_date: '2026-10-09', piglets_born_live: 9, ...over } as any, 'tenant-1');

    it('links the sow\'s open mating when the farrowing names none', async () => {
      rows.set(schema.animalRegister, [sow]);
      await farrow();
      const values = mockDbInsert.mock.results.map((r) => (r.value.values as jest.Mock).mock.calls[0]?.[0]).find((v: any) => v?.farrow_id);
      expect(values).toMatchObject({ breeding_id: 'br-open' });
    });

    it('refuses a farrowing when no mating is recorded', async () => {
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, []);
      await expect(farrow()).rejects.toThrow('No open mating is recorded for SOW-001');
    });

    it('refuses a named mating that already farrowed, or is dated after the farrowing', async () => {
      rows.set(schema.animalRegister, [sow]);
      rows.set(schema.breedingRecord, [{ breeding_id: 'br-1', mating_date: '2026-06-01', farrow_id: 'f-old' }]);
      await expect(farrow({ breeding_id: 'br-1' })).rejects.toThrow('already farrowed');
      rows.set(schema.breedingRecord, [{ breeding_id: 'br-1', mating_date: '2026-10-20', farrow_id: null }]);
      await expect(farrow({ breeding_id: 'br-1' })).rejects.toThrow('dated after this farrowing');
    });
  });

  // Decision of 9 Oct: the piglets of a litter are a lot of the piglet bio-asset item in a batch-wise batch, moved on by
  // transfer to whatever stage or batch is wanted.
  describe('the piglet lot', () => {
    const sow = { animal_id: 'sow-1', company_id: 'co-1', animal_code: 'SOW-001', animal_type: 'SOW', status: 'PREGNANT', parity_count: 1, total_piglets_born_live: 10, total_piglets_weaned: 9 };

    it('holds a farrowing’s piglets as a lot — born live plus fostered in, less fostered out — and keeps the batch on the record', async () => {
      rows.set(schema.animalRegister, [sow]);
      pigletLots.createLot.mockResolvedValue({ batch_id: 'b-pig', batch_no: 'BATCH-000010', lot_no: 'LOT-00009' });

      const result: any = await service.recordFarrowing(
        { sow_animal_id: 'sow-1', farrowing_date: '2026-10-09', piglets_born_live: 11, foster_received: 2, fostered_out: 1, piglet_item_id: 'item-piglet', piglet_stage_id: 'st-1' } as any,
        'tenant-1',
      );

      expect(pigletLots.createLot).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 12, item_id: 'item-piglet', stage_id: 'st-1', farrowing_date: '2026-10-09' }),
        'tenant-1',
        undefined,
      );
      expect(result).toMatchObject({ piglet_batch_id: 'b-pig', piglet_lot_no: 'LOT-00009', piglet_batch_no: 'BATCH-000010' });
      expect(result.message).toContain('12 piglets held as lot LOT-00009 in batch BATCH-000010');
    });

    it('records the litter alone, and says so, when no piglet item is chosen', async () => {
      rows.set(schema.animalRegister, [sow]);
      const result: any = await service.recordFarrowing({ sow_animal_id: 'sow-1', farrowing_date: '2026-10-09', piglets_born_live: 11 } as any, 'tenant-1');
      expect(pigletLots.createLot).not.toHaveBeenCalled();
      expect(result.piglet_batch_id).toBeNull();
      expect(result.message).toContain('No piglet lot was created');
    });

    it('makes no lot for a litter with nothing born alive', async () => {
      rows.set(schema.animalRegister, [sow]);
      await service.recordFarrowing({ sow_animal_id: 'sow-1', farrowing_date: '2026-10-09', piglets_born_live: 0, piglets_stillborn: 4, piglet_item_id: 'item-piglet' } as any, 'tenant-1');
      expect(pigletLots.createLot).not.toHaveBeenCalled();
    });

    const litter = (over: object = {}) => {
      rows.set(schema.farrowingRecord, [{ farrow_id: 'f-1', company_id: 'co-1', sow_animal_id: 'sow-1', parity_number: 2, piglets_weaned: 0, piglet_batch_id: 'b-pig', piglet_lot_no: 'LOT-00009', notes: null, ...over }]);
      rows.set(schema.animalRegister, [{ ...sow, status: 'LACTATING' }]);
      rows.set(schema.batchBioAssetState, [{ current_quantity: '12' }]);
    };
    const wean = (dto: object) => service.recordWeaning('f-1', { weaning_date: '2026-11-06', piglets_weaned: 10, ...dto } as any, 'tenant-1');

    it('records what the lot lost before weaning as mortality, and moves the weaned head to the chosen batch', async () => {
      litter();
      const result: any = await wean({ move_to_batch_id: 'b-weaner' });

      expect(batchService.recordMortality).toHaveBeenCalledWith('b-pig', expect.objectContaining({ transaction_date: '2026-11-06', quantity: 2 }), 'tenant-1', undefined);
      expect(batchTransfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ to_batch_id: 'b-weaner', quantity: 10, transfer_type: 'PARTIAL', reason: 'WEANING' }),
        'tenant-1',
        'b-pig',
        undefined,
      );
      expect(result.message).toContain('2 lost before weaning');
      expect(result.message).toContain('10 moved to the destination batch');
    });

    it('moves the lot on to a stage instead when a stage is chosen', async () => {
      litter();
      await wean({ move_to_stage_code: 'WEANER' });
      expect(batchService.transferStage).toHaveBeenCalledWith('b-pig', expect.objectContaining({ to_stage_code: 'WEANER', transfer_date: '2026-11-06' }), 'tenant-1', undefined);
      expect(batchTransfers.create).not.toHaveBeenCalled();
    });

    it('records no loss when every piglet was weaned', async () => {
      litter();
      await wean({ piglets_weaned: 12 });
      expect(batchService.recordMortality).not.toHaveBeenCalled();
    });

    it('refuses more weaned than the lot holds, a batch and a stage together, and a move for a litter with no lot', async () => {
      litter();
      await expect(wean({ piglets_weaned: 13 })).rejects.toThrow('holds 12 piglets; 13 cannot have been weaned');
      await expect(wean({ move_to_batch_id: 'b', move_to_stage_code: 'WEANER' })).rejects.toThrow('a batch or on to a stage, not both');
      litter({ piglet_batch_id: null });
      await expect(wean({ move_to_batch_id: 'b-weaner' })).rejects.toThrow('has no piglet lot to move');
      expect(batchTransfers.create).not.toHaveBeenCalled();
    });

    it('does not move the same piglets twice when a weaning is posted again', async () => {
      litter({ piglets_weaned: 10 });
      await wean({});
      expect(batchService.recordMortality).not.toHaveBeenCalled();
      expect(batchTransfers.create).not.toHaveBeenCalled();
      await expect(wean({ move_to_batch_id: 'b-weaner' })).rejects.toThrow('already weaned');
    });
  });

  // Decision of 9 Oct: a collection naming an item is a lot of it in stock, with a lot-level QR; a mating that names the
  // lot uses its doses.
  describe('semen as stock', () => {
    const boar = { animal_id: 'boar-1', company_id: 'co-1', animal_code: 'BOAR-1', animal_type: 'BOAR', gender: 'M', current_batch_id: 'b-boar' };
    const collection = (over: object = {}) => ({ boar_animal_id: 'boar-1', collection_date: '2026-10-09', doses_collected: 40, ...over }) as any;

    it('posts a collection that names an item as a lot of it, and keeps the lot, its store and its QR on the record', async () => {
      rows.set(schema.animalRegister, [boar]);
      semenLots.postCollection.mockResolvedValue({ lot_no: 'LOT-00011', expiry_date: '2026-11-08', warehouse_id: 'store-1', qr_id: 'qr-1', pack_no: 'PACK-000007' });

      const result: any = await service.recordSemenCollection(collection({ output_item_id: 'item-semen' }), 'tenant-1');

      expect(semenLots.postCollection).toHaveBeenCalledWith(
        expect.objectContaining({ boarBatchId: 'b-boar', collectionDate: '2026-10-09', doses: 40, itemId: 'item-semen' }),
        'tenant-1',
        undefined,
      );
      expect(result).toMatchObject({ inventory_posted: true, lot_no: 'LOT-00011', expiry_date: '2026-11-08', warehouse_id: 'store-1', qr_id: 'qr-1', qr_pack_no: 'PACK-000007' });
      expect(result.message).toContain('Posted to inventory as lot LOT-00011 (expires 2026-11-08), QR PACK-000007');
    });

    it('records a collection with no item as before, and says it is not stock', async () => {
      rows.set(schema.animalRegister, [boar]);
      const result: any = await service.recordSemenCollection(collection(), 'tenant-1');
      expect(semenLots.postCollection).not.toHaveBeenCalled();
      expect(result).toMatchObject({ inventory_posted: false, lot_no: null, qr_id: null });
      expect(result.message).toContain('Not posted to inventory');
    });

    it('takes the doses out of the lot a mating names, and refuses the mating if the lot cannot supply them', async () => {
      const sow = { animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', parity_count: 0, current_batch_id: null };
      rows.set(schema.animalRegister, [sow]);
      jest.spyOn(service as any, 'resolveSowAndBoar').mockResolvedValue({ sow, companyId: 'co-1', boarAnimalId: 'boar-1' });
      const lot = { semen_batch_id: 'sb-1', boar_animal_id: 'boar-1', company_id: 'co-1', tenant_id: 'tenant-1', doses_collected: '40', doses_used_internal: '0', doses_sold: '0', lot_no: 'LOT-1' };
      rows.set(schema.semenBatch, [lot]);

      await service.recordMating({ sow_animal_id: 'sow-1', boar_animal_id: 'boar-1', semen_lot_id: 'sb-1', mating_type: 'AI', mating_date: '2026-10-09', semen_dose_qty: 2 } as any, 'tenant-1');
      expect(semenLots.issueDoses).toHaveBeenCalledWith(lot, 2, expect.any(String), '2026-10-09', 'tenant-1', undefined);

      semenLots.issueDoses.mockRejectedValueOnce(new BadRequestException('The semen lot LOT-1 has 1 dose left; 2 cannot be used.'));
      await expect(
        service.recordMating({ sow_animal_id: 'sow-1', boar_animal_id: 'boar-1', semen_lot_id: 'sb-1', mating_type: 'AI', mating_date: '2026-10-09', semen_dose_qty: 2 } as any, 'tenant-1'),
      ).rejects.toThrow('1 dose left');
    });

    // Pooled semen: one lot mixed from the ejaculates of several boars.
    describe('pooled from several boars', () => {
      const boar2 = { animal_id: 'boar-2', company_id: 'co-1', animal_code: 'BOAR-2', animal_type: 'BOAR', gender: 'M', is_active: true, current_batch_id: 'b-boar' };
      const insertedRows = () => mockDbInsert.mock.results.flatMap((r: any) => r.value.values.mock.calls.map((c: any[]) => c[0]));

      it('makes ONE lot of the boars together, names every boar on it, and splits the typed cost between them', async () => {
        rows.set(schema.animalRegister, [boar, boar2]);
        semenLots.postCollection.mockResolvedValue({ lot_no: 'LOT-00020', expiry_date: '2026-10-14', warehouse_id: 'store-1', qr_id: 'qr-2', pack_no: 'PACK-000008' });

        const result: any = await service.recordSemenCollection(
          collection({ output_item_id: 'item-pooled', pool_boar_animal_ids: ['boar-2'], feed_cost_period: 80, overhead_cost_period: 20 }),
          'tenant-1',
        );

        // one posting to stock, with the other boar named so the QR can list him
        expect(semenLots.postCollection).toHaveBeenCalledTimes(1);
        expect(semenLots.postCollection.mock.calls[0][0].poolBoars).toEqual([boar2]);
        // the lot's cost is the whole mix over its doses
        expect(result).toMatchObject({ lot_no: 'LOT-00020', pooled_boars: ['BOAR-1', 'BOAR-2'], running_cost_period: '100.0000', unit_cost_per_dose: '2.500000' });
        expect(result.message).toContain('one pooled lot from 2 boars (BOAR-1, BOAR-2)');
        // the lot record, then one contributor row per boar in the order chosen
        const [lot, contributors] = insertedRows();
        expect(lot.boar_animal_id).toBe('boar-1');
        expect(contributors).toEqual([
          expect.objectContaining({ semen_batch_id: lot.semen_batch_id, boar_animal_id: 'boar-1', sort_order: 0, cost_share: '50.0000' }),
          expect.objectContaining({ semen_batch_id: lot.semen_batch_id, boar_animal_id: 'boar-2', sort_order: 1, cost_share: '50.0000' }),
        ]);
      });

      it('is an ordinary single-boar lot when the only boar named is the primary, and writes no contributor rows', async () => {
        rows.set(schema.animalRegister, [boar]);
        const result: any = await service.recordSemenCollection(collection({ pool_boar_animal_ids: ['boar-1', 'boar-1'] }), 'tenant-1');
        expect(result.pooled_boars).toBeUndefined();
        expect(insertedRows()).toHaveLength(1);
      });

      it('refuses to pool an animal that is not a boar, one that is inactive, or one that does not exist', async () => {
        rows.set(schema.animalRegister, [boar, { ...boar2, gender: 'F' }]);
        await expect(service.recordSemenCollection(collection({ pool_boar_animal_ids: ['boar-2'] }), 'tenant-1')).rejects.toThrow('BOAR-2 is not a boar');

        rows.set(schema.animalRegister, [boar, { ...boar2, is_active: false }]);
        await expect(service.recordSemenCollection(collection({ pool_boar_animal_ids: ['boar-2'] }), 'tenant-1')).rejects.toThrow('no longer active');

        rows.set(schema.animalRegister, [boar]);
        await expect(service.recordSemenCollection(collection({ pool_boar_animal_ids: ['boar-ghost'] }), 'tenant-1')).rejects.toThrow(NotFoundException);
        expect(semenLots.postCollection).not.toHaveBeenCalled();
      });

      it('records no single sire for an AI service from a pooled lot, and refuses a boar that is not one of the pool', async () => {
        const sow = { animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', parity_count: 0, current_batch_id: null };
        rows.set(schema.animalRegister, [sow]);
        rows.set(schema.semenBatch, [{ semen_batch_id: 'sb-pool', boar_animal_id: 'boar-1' }]);
        rows.set(schema.semenBatchBoar, [{ boar_animal_id: 'boar-1' }, { boar_animal_id: 'boar-2' }]);

        const pooled = await (service as any).resolveSowAndBoar({ sow_animal_id: 'sow-1', semen_lot_id: 'sb-pool', mating_type: 'AI' }, 'tenant-1');
        expect(pooled.boarAnimalId).toBeNull();

        await expect(
          (service as any).resolveSowAndBoar({ sow_animal_id: 'sow-1', semen_lot_id: 'sb-pool', boar_animal_id: 'boar-9', mating_type: 'AI' }, 'tenant-1'),
        ).rejects.toThrow('not one of the boars this pooled semen lot was mixed from');
      });

      it('still names the one boar behind a lot from a single boar', async () => {
        const sow = { animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', parity_count: 0, current_batch_id: null };
        rows.set(schema.animalRegister, [sow, { ...boar }]);
        rows.set(schema.semenBatch, [{ semen_batch_id: 'sb-1', boar_animal_id: 'boar-1' }]);
        rows.set(schema.semenBatchBoar, []);
        const lot = await (service as any).boarOfSemenLot('sb-1', 'co-1', 'tenant-1');
        expect(lot).toEqual({ boarId: 'boar-1', poolBoarIds: [] });
      });
    });

    it('uses no doses for a mating that names no lot', async () => {
      const sow = { animal_id: 'sow-1', tenant_id: 'tenant-1', company_id: 'co-1', animal_code: 'SOW-001', gender: 'F', parity_count: 0, current_batch_id: null };
      rows.set(schema.animalRegister, [sow]);
      jest.spyOn(service as any, 'resolveSowAndBoar').mockResolvedValue({ sow, companyId: 'co-1', boarAnimalId: 'boar-1' });
      await service.recordMating({ sow_animal_id: 'sow-1', mating_type: 'NATURAL_MATING', boar_animal_id: 'boar-1', mating_date: '2026-10-09' } as any, 'tenant-1');
      expect(semenLots.issueDoses).not.toHaveBeenCalled();
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
