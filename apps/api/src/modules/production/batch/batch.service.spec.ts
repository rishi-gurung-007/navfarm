import { transactionCls } from '../../../test-utils/transaction-cls';
import { Test, TestingModule } from '@nestjs/testing';
import { BatchService } from './batch.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { GlPostingService } from '../../finance/journal/gl-posting.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { SchedulerHeaderService } from '../scheduler-header/scheduler-header.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import * as schema from '../../../core/database/schema';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { FarmScope } from '../../../common/farm-scope';

describe('BatchService', () => {
  let service: BatchService;
  let numberSeriesService: NumberSeriesService;
  let module: TestingModule;
  let clsService: ClsService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbTransaction = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: mockDbTransaction,
  };

  const activeBatch = {
    batch_id: 'batch-1',
    tenant_id: 'tenant-123',
    company_id: 'comp-1',
    lob_id: 'lob-piggery',
    status: 'ACTIVE',
    current_stage_code: null,
    sub_location_id: null,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDb.select = mockDbSelect;
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbTransaction.mockReset();
    mockDbTransaction.mockImplementation(async work => work(mockDb));

    module = await Test.createTestingModule({
      providers: [
        BatchService,
        { provide: ClsService, useValue: transactionCls(mockDb) },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: InventoryLedgerService, useValue: {} },
        { provide: GlPostingService, useValue: {} },
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn().mockResolvedValue('BATCH-000001') } },
        { provide: SchedulerHeaderService, useValue: { createForStage: jest.fn().mockResolvedValue({}), generateForBatchCurrentStage: jest.fn().mockResolvedValue({}) } },
      ],
    }).compile();

    const originalSelect = mockDb.select;
    mockDb.select = ((projection?: any) => {
      if (projection && Object.keys(projection).length === 1 && projection.batch_id) {
        return { from: () => ({ where: () => ({ for: async () => [{ batch_id: 'batch-1' }] }) }) };
      }
      return originalSelect(projection);
    }) as any;
    service = module.get<BatchService>(BatchService);
    numberSeriesService = module.get<NumberSeriesService>(NumberSeriesService);
    clsService = module.get<ClsService>(ClsService);
  });

  /** Layers a farm scope onto the CLS `get` the running test's ClsService instance
   * already answers 'tenantDb' from (transactionCls) — same wrapping style as
   * batch-daily-data.service.spec's table-keyed mock, applied to CLS instead of db. */
  const useFarmScope = (scope: FarmScope) => {
    const cls = clsService as any;
    const base = cls.get.bind(cls);
    cls.get = ((key?: string) => (key === 'farmScope' ? scope : base(key))) as typeof cls.get;
  };

  describe('create', () => {
    const query = (result: unknown[]) => ({
      from: jest.fn().mockReturnValue({
        where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(result) }),
      }),
    });

    const validDto = {
      company_id: 'comp-1',
      lob_id: 'lob-piggery',
      farm_id: 'farm-1',
      animal_tracking: 'COUNT_ONLY',
      stage_id: 'stage-1',
      costing_method: 'FIFO',
      start_date: '2026-01-01',
      opening_quantity: 100,
      uom: 'HEAD',
      input_lines: [] as unknown[],
    };

    const primeCreate = (options: {
      farm?: Record<string, unknown> | null;
      stage?: Record<string, unknown> | null;
      placements?: Array<Record<string, unknown> | null>;
      breed?: Record<string, unknown> | null;
    } = {}) => {
      const farm = options.farm === undefined ? {
        location_id: 'farm-1', tenant_id: 'tenant-123', company_id: 'comp-1',
        lob_id: 'lob-piggery', location_type: 'FARM', parent_location_id: null,
        farm_id: 'farm-1', is_active: true, deleted_at: null,
      } : options.farm;
      const stage = options.stage === undefined ? {
        stage_id: 'stage-1', tenant_id: 'tenant-123', company_id: 'comp-1',
        lob_id: 'lob-piggery', stage_code: 'ENTRY', is_active: true, deleted_at: null,
      } : options.stage;
      mockDbSelect
        .mockReturnValueOnce(query([{ nob_id: 'nob-1', lob_name: 'Piggery', costing_method_allowed: 'FIFO,BIO_ASSET' }]))
        .mockReturnValueOnce(query(stage ? [stage] : []))
        .mockReturnValueOnce(query(farm ? [farm] : []));
      for (const placement of options.placements ?? []) {
        mockDbSelect.mockReturnValueOnce(query(placement ? [placement] : []));
      }
      if (options.breed !== undefined) {
        mockDbSelect.mockReturnValueOnce(query(options.breed ? [options.breed] : []));
      }
      mockDbInsert.mockImplementation(() => ({ values: jest.fn().mockResolvedValue({}) }));
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...activeBatch, batch_no: 'BATCH-000001' } as any);
    };

    it('delegates batch_no generation to NumberSeriesService and persists the result', async () => {
      primeCreate();

      const result = await service.create(
        validDto as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(numberSeriesService.generateNext).toHaveBeenCalledWith('BATCH', 'tenant-123', 'comp-1', mockDb);
      expect(result.batch_no).toBe('BATCH-000001');
    });

    it('stores the explicitly selected farm, tracking mode, and initial stage', async () => {
      primeCreate();
      const inserted: Array<{ table: unknown; value: any }> = [];
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn(async (value: unknown) => { inserted.push({ table, value }); return {}; }),
      }));

      await service.create(validDto as any, 'tenant-123', { userId: 'user-1' });

      expect(inserted.find((entry) => entry.table === schema.batchHeader)?.value).toMatchObject({
        farm_id: 'farm-1', animal_tracking: 'COUNT_ONLY', stage_id: 'stage-1', current_stage_code: 'ENTRY',
      });
    });

    it('refuses creation without an explicit farm before writing', async () => {
      primeCreate();
      await expect(service.create({ ...validDto, farm_id: undefined } as any, 'tenant-123'))
        .rejects.toThrow('Select the farm this batch runs on.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses creation without an initial stage before writing', async () => {
      primeCreate();
      await expect(service.create({ ...validDto, stage_id: undefined } as any, 'tenant-123'))
        .rejects.toThrow('Select the initial stage for this batch.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses creation without an explicit tracking mode before writing', async () => {
      primeCreate();
      await expect(service.create({ ...validDto, animal_tracking: undefined } as any, 'tenant-123'))
        .rejects.toThrow('Select how this batch tracks animals.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('requires the selected LOB to be configured for the tenant and company', async () => {
      let capturedCondition: any;
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation((condition: any) => {
            capturedCondition = condition;
            return { limit: jest.fn().mockResolvedValue([]) };
          }),
        }),
      });

      await expect(service.create(validDto as any, 'tenant-123'))
        .rejects.toThrow(/not configured for this company/i);
      const rendered = new MySqlDialect().sqlToQuery(capturedCondition);
      expect(rendered.sql).toContain('operational_area_master');
      expect(rendered.params).toEqual(expect.arrayContaining(['tenant-123', 'comp-1', 'lob-piggery']));
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it.each([
      ['inactive', { is_active: false }],
      ['nested', { parent_location_id: 'another-farm' }],
      ['non-farm', { location_type: 'SHED' }],
      ['another company', { company_id: 'comp-2' }],
    ])('refuses an %s farm before writing', async (_label, farmOverride) => {
      primeCreate({ farm: {
        location_id: 'farm-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery',
        location_type: 'FARM', parent_location_id: null, farm_id: 'farm-1', is_active: true,
        deleted_at: null, ...farmOverride,
      } });
      await expect(service.create(validDto as any, 'tenant-123')).rejects.toThrow('Select the farm this batch runs on.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('validates both supplied placement references against the batch farm', async () => {
      primeCreate({ placements: [
        { location_id: 'pen-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery', farm_id: 'farm-1', is_active: true, deleted_at: null },
        { location_id: 'shed-2', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery', farm_id: 'farm-2', is_active: true, deleted_at: null },
      ] });
      await expect(service.create({ ...validDto, location_id: 'pen-1', shed_id: 'shed-2' } as any, 'tenant-123'))
        .rejects.toThrow("Batch shed is not on the batch's farm.");
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it.each([
      ['company', { company_id: 'comp-2' }],
      ['line of business', { lob_id: 'lob-poultry' }],
    ])('refuses a location from another %s even when its farm id matches', async (_label, override) => {
      primeCreate({ placements: [{
        location_id: 'pen-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery',
        location_type: 'PEN', parent_location_id: 'shed-1', farm_id: 'farm-1', is_active: true,
        deleted_at: null, ...override,
      }] });
      await expect(service.create({ ...validDto, location_id: 'pen-1' } as any, 'tenant-123'))
        .rejects.toThrow("Batch location is not on the batch's farm.");
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it.each([
      ['farm-less', { breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery', location_id: null, is_active: true, deleted_at: null }],
      ['another-farm', { breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery', location_id: 'farm-2', is_active: true, deleted_at: null }],
      ['another-LOB', { breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-poultry', location_id: 'farm-1', is_active: true, deleted_at: null }],
    ])('refuses a %s operational breed profile', async (_label, breed) => {
      primeCreate({ breed });
      await expect(service.create({ ...validDto, breed_id: 'breed-1' } as any, 'tenant-123'))
        .rejects.toThrow('The breed profile belongs to another farm.');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it.each(['COUNT_ONLY', 'REGISTERED'])('%s creation never invents Animal Register rows', async (animalTracking) => {
      primeCreate({ breed: {
        breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery',
        location_id: 'farm-1', is_active: true, deleted_at: null,
      } });
      const insertedTables: unknown[] = [];
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn(async () => { insertedTables.push(table); return {}; }),
      }));

      await service.create({ ...validDto, animal_tracking: animalTracking, breed_id: 'breed-1' } as any, 'tenant-123');

      expect(insertedTables).not.toContain(schema.animalRegister);
    });

    it('rejects animal_ids when animal_tracking is COUNT_ONLY', async () => {
      primeCreate({ breed: {
        breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery',
        location_id: 'farm-1', is_active: true, deleted_at: null,
      } });

      await expect(service.create({ ...validDto, animal_tracking: 'COUNT_ONLY', animal_ids: ['a-1'] } as any, 'tenant-123'))
        .rejects.toThrow('Count-only batches track headcount only and cannot link individual registered animals.');
    });

    it('links existing animals when animal_tracking is REGISTERED and animal_ids are provided', async () => {
      primeCreate({ breed: {
        breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1', lob_id: 'lob-piggery',
        location_id: 'farm-1', is_active: true, deleted_at: null,
      } });

      // Mock finding assigned animals
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([
            { animal_id: 'a-1', current_batch_id: null, breed_id: 'breed-1' },
            { animal_id: 'a-2', current_batch_id: null, breed_id: 'breed-1' },
          ]),
        }),
      });

      const updatedTables: unknown[] = [];
      mockDbUpdate.mockImplementation((table: unknown) => ({
        set: jest.fn().mockReturnValue({
          where: jest.fn(async () => { updatedTables.push(table); return {}; }),
        }),
      }));

      await service.create({ ...validDto, animal_tracking: 'REGISTERED', breed_id: 'breed-1', animal_ids: ['a-1', 'a-2'] } as any, 'tenant-123');

      expect(updatedTables).toContain(schema.animalRegister);
    });
  });

  describe('transferStage', () => {
    it('sets stage_id when a matching stage_master row exists for the batch LOB', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any) // initial load
        .mockResolvedValueOnce({ ...activeBatch, current_stage_code: 'QUARANTINE', stage_id: 'stage-quarantine' } as any); // final return

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-quarantine' }]),
            }),
          }),
        }) // stage_master lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]),
          }),
        }); // in-step animals (none on this bare fixture)
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage('batch-1', { to_stage_code: 'QUARANTINE' }, 'tenant-123', { userId: 'user-1' });

      expect(mockDbUpdate).toHaveBeenCalled();
      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.stage_id).toBe('stage-quarantine');
      expect(result.stage_id).toBe('stage-quarantine');
    });

    it('leaves stage_id null when no stage_master row matches the code for this LOB', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({ ...activeBatch, current_stage_code: 'CUSTOM_STAGE', stage_id: null } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([]), // no matching stage_master row
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }), // LOB has no stages configured
        });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage('batch-1', { to_stage_code: 'CUSTOM_STAGE' }, 'tenant-123', { userId: 'user-1' });

      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.stage_id).toBeNull();
      expect(result.stage_id).toBeNull();
    });

    const gestatingBatch = { ...activeBatch, current_stage_code: 'DRY_SOW_GESTATION', stage_id: 'stage-gestation' };

    it('cascades the new stage to the animals that were in step with the batch', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(gestatingBatch as any)
        .mockResolvedValueOnce({ ...gestatingBatch, current_stage_code: 'LACTATION', stage_id: 'stage-lactation' } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-lactation' }]),
            }),
          }),
        }) // stage_master lookup
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ animal_id: 'a-1' }, { animal_id: 'a-2' }]),
          }),
        }); // animals still standing at the batch's previous stage

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage('batch-1', { to_stage_code: 'LACTATION' }, 'tenant-123', { userId: 'user-1' });

      // First update is batch_header; second repoints in-step animals; third completes prior scheduler.
      expect(mockDbUpdate).toHaveBeenCalledTimes(3);
      expect(mockDbUpdate.mock.calls[1][0]).toBe(schema.animalRegister);
      const setMock = mockDbUpdate.mock.results[0].value.set as jest.Mock;
      expect(setMock.mock.calls[1][0].current_stage_id).toBe('stage-lactation');
    });

    it('leaves animals that have diverged from the batch stage where they are', async () => {
      // A few head held back in a hospital pen at an earlier stage: they are in
      // this batch but not at its stage, so a batch-level move must not drag
      // them along.
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(gestatingBatch as any)
        .mockResolvedValueOnce({ ...gestatingBatch, current_stage_code: 'LACTATION', stage_id: 'stage-lactation' } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ stage_id: 'stage-lactation' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]), // nobody is in step
          }),
        });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage('batch-1', { to_stage_code: 'LACTATION' }, 'tenant-123', { userId: 'user-1' });

      // batch_header and prior stage scheduler_header are updated — no animal write at all.
      expect(mockDbUpdate).toHaveBeenCalledTimes(2);
    });

    it('does not touch animals when no stage_master row matches the code', async () => {
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({ ...activeBatch, current_stage_code: 'CUSTOM_STAGE', stage_id: null } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }), // LOB has no stages configured
        });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.transferStage('batch-1', { to_stage_code: 'CUSTOM_STAGE' }, 'tenant-123', { userId: 'user-1' });

      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    });

    it('rejects a stage code that matches nothing for a LOB that has stages configured', async () => {
      // The batch-stages screen once posted its own display codes (ST-01..ST-08)
      // instead of domain codes, writing "ST-05" into current_stage_code and
      // leaving stage_id null. Accepting an unmatched code silently is what let
      // that corrupt a batch.
      jest.spyOn(service, 'findOne').mockResolvedValueOnce(gestatingBatch as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        }) // no stage_master row matches 'ST-05'
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ stage_code: 'DRY_SOW_GESTATION' }]),
          }),
        }); // ...but this LOB does have stages configured

      await expect(
        service.transferStage('batch-1', { to_stage_code: 'ST-05' }, 'tenant-123', { userId: 'u' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('still allows a free-text stage for a LOB with no stage master data', async () => {
      // Stages are LOB-defined; a line of business that has configured none must
      // keep working with hand-entered codes.
      jest.spyOn(service, 'findOne')
        .mockResolvedValueOnce(activeBatch as any)
        .mockResolvedValueOnce({ ...activeBatch, current_stage_code: 'CUSTOM', stage_id: null } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // LOB has no stages at all
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.transferStage('batch-1', { to_stage_code: 'CUSTOM' }, 'tenant-123', { userId: 'u' });

      expect(result.current_stage_code).toBe('CUSTOM');
    });

    it('rejects transferring a non-ACTIVE batch', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...activeBatch, status: 'DRAFT' } as any);

      await expect(
        service.transferStage('batch-1', { to_stage_code: 'QUARANTINE' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('addTransaction — clinical detail', () => {
    const treatment = { transaction_date: '2026-09-14', transaction_type: 'CONSUMPTION',
      item_id: 'medicine-id', quantity: 1, uom: 'ML', treatment_detail: { diagnosis: 'Treatment' } };

    it.each([
      { item_id: undefined }, { quantity: 0 }, { quantity: -1 }, { quantity: NaN }, { uom: undefined },
    ])('refuses incomplete or nonpositive consumption before choosing an item: %j', async (invalid) => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...activeBatch, costing_method: 'BIO_ASSET' } as any);
      await expect(service.addTransaction('batch-1', { ...treatment, ...invalid } as any, 'tenant-123'))
        .rejects.toThrow(/explicit item_id, positive quantity and uom/);
      expect(mockDbSelect).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses treatments that do not resolve to an active company medicine or vaccine', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(activeBatch as any);
      let query: any;
      mockDbSelect.mockReturnValue({ from: () => ({ where: (condition: any) => {
        query = new MySqlDialect().sqlToQuery(condition);
        return { limit: async () => [] };
      } }) });
      await expect(service.addTransaction('batch-1', treatment as any, 'tenant-123')).rejects.toThrow(/active medicine or vaccine/);
      expect(query.sql).toContain('`company_id` = ?');
      expect(query.sql).toContain('`is_active` = ?');
      expect(query.params).toEqual(expect.arrayContaining(['comp-1', 'MEDICINE', 'VACCINE']));
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses a dose count when the medicine is stocked in a different unit', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(activeBatch as any);
      mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ uom_primary: 'ML' }] }) }) });
      await expect(service.addTransaction('batch-1', { ...treatment, uom: 'DOSES' } as any, 'tenant-123'))
        .rejects.toThrow(/stock unit ML/);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses a selected animal outside the active batch and company', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(activeBatch as any);
      let animalQuery: any;
      mockDbSelect.mockReturnValue({ from: (table: unknown) => ({ where: (condition: any) => {
        if (table === schema.animalRegister) animalQuery = new MySqlDialect().sqlToQuery(condition);
        return { limit: async () => [{ uom_primary: 'ML' }], for: async () => [] };
      } }) });
      await expect(service.addTransaction('batch-1', { ...treatment, animal_id: 'animal-id' } as any, 'tenant-123'))
        .rejects.toThrow(/active member of this batch/);
      expect(animalQuery.sql).toContain('`current_batch_id` = ?');
      expect(animalQuery.sql).toContain('`company_id` = ?');
      expect(animalQuery.sql).toContain('`tenant_id` = ?');
      expect(animalQuery.sql).toContain('`is_active` = ?');
      expect(animalQuery.params).toEqual(expect.arrayContaining(['animal-id', 'batch-1', 'comp-1', 'tenant-123']));
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('issues the selected vaccine to an active batch member using its stock unit', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...activeBatch, batch_no: 'batch' } as any);
      mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({
        limit: async () => [{ uom_primary: 'ML' }], for: async () => [{ animal_id: 'animal-id' }],
      }) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });
      const ledger = module.get<InventoryLedgerService>(InventoryLedgerService);
      const gl = module.get<GlPostingService>(GlPostingService);
      ledger.writeNegativeEntry = jest.fn().mockResolvedValue({ ledger_id: 'ledger', rate: '2', amount: '-2' });
      gl.postInventoryLedgerEntry = jest.fn().mockResolvedValue({});
      await service.addTransaction('batch-1', { ...treatment, item_id: 'vaccine-id', animal_id: 'animal-id' } as any, 'tenant-123');
      expect(ledger.writeNegativeEntry).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'vaccine-id', quantity: 1, uom: 'ML' }));
      expect(mockDbInsert).toHaveBeenCalledWith(schema.batchTreatmentDetail);
    });

    // The guards run before any write, so a mismatched detail must leave
    // nothing behind — not a transaction row with an orphaned narrative.
    it('refuses mortality_detail on a transaction that is not a death', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...activeBatch, costing_method: 'STANDARD' } as any);

      await expect(
        service.addTransaction('batch-1', {
          transaction_date: '2026-08-01',
          transaction_type: 'CONSUMPTION',
          quantity: 10,
          mortality_detail: { cause_of_death: 'Lameness' },
        } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses treatment_detail on a transaction that does not issue medicine', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValueOnce({ ...activeBatch, costing_method: 'STANDARD' } as any);

      await expect(
        service.addTransaction('batch-1', {
          transaction_date: '2026-08-01',
          transaction_type: 'OVERHEAD',
          quantity: 4,
          treatment_detail: { withdrawal_days: 28 },
        } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);

      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('addTransaction — bio-asset OUTPUT leaves a ledger movement', () => {
    // Harvesting from a matured bio-asset herd reduces
    // batch_bio_asset_state.nca_book_value. Without a matching bio_asset_ledger
    // row the IAS 41 roll-forward shows the carrying value fall with nothing to
    // explain it — every other bio-asset movement (acquisition, consumption,
    // mortality, overhead, maturation, amortisation, fair value, disposal)
    // writes one.
    it('writes a bio_asset_ledger row when OUTPUT is recorded on a matured bio-asset batch', async () => {
      const bioBatch = {
        ...activeBatch,
        batch_no: 'BATCH-000001',
        costing_method: 'BIO_ASSET',
        nob_id: 'nob-1',
        input_lines: [{ item_id: 'item-piglet' }],
        transactions: [],
      };
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '50000.0000',
              },
            ]),
          }),
        }),
      });

      (service as any).ledgerService = {
        writePositiveEntry: jest.fn().mockResolvedValue({
          ledger_id: 'led-1', rate: '1200.000000', amount: '12000.0000',
        }),
      };
      (service as any).glPostingService = {
        postInventoryLedgerEntry: jest.fn().mockResolvedValue({}),
        postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }),
      };

      const inserted: Array<{ table: unknown; values: any }> = [];
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn((v: any) => { inserted.push({ table, values: v }); return Promise.resolve({}); }),
      }));
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await service.addTransaction(
        'batch-1',
        {
          transaction_date: '2026-08-20',
          transaction_type: 'OUTPUT',
          item_id: 'item-weaner',
          quantity: 10,
          uom: 'HEAD',
        } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      const ledgerRow = inserted.find((i) => i.table === schema.bioAssetLedger);
      expect(ledgerRow).toBeDefined();
      // TRANSFORMATION is the entry type the IAS 41 roll-forward maps to its
      // harvest-transfers bucket, which is otherwise always zero.
      expect(ledgerRow!.values.entry_type).toBe('TRANSFORMATION');
      expect(ledgerRow!.values.batch_id).toBe('batch-1');
      // The movement must equal the reduction in carrying value.
      expect(Number(ledgerRow!.values.cost_amount)).toBe(-12000);
    });
  });

  describe('findAll', () => {
    it('reports accumulated cost as wip_value so the dashboard tile is not structurally zero', async () => {
      // The console's WIP tile reads b.wip_value. Nothing in the API ever
      // returned that field, so Number(undefined) || 0 made the tile read
      // "₹ 0" no matter how much cost a batch had accumulated.
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  { ...activeBatch, batch_id: 'b1', total_cost: null, closing_quantity: '20.0000' },
                ]),
              }),
            }),
          }),
        }) // batch rows
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { batch_id: 'b1', transaction_type: 'CONSUMPTION', amount: '1232.0000' },
              { batch_id: 'b1', transaction_type: 'OVERHEAD', amount: '3300.0000' },
              { batch_id: 'b1', transaction_type: 'MORTALITY', amount: '0.0000' },
            ]),
          }),
        }); // cost-bearing transactions

      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');

      expect(rows[0].wip_value).toBe(4532);
    });

    it('prefers the posted total_cost once a batch is closed', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                offset: jest.fn().mockResolvedValue([
                  { ...activeBatch, batch_id: 'b2', status: 'CLOSED', total_cost: '999999.0000' },
                ]),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([
              { batch_id: 'b2', transaction_type: 'CONSUMPTION', amount: '10.0000' },
            ]),
          }),
        });

      const rows = await service.findAll({ limit: 50 } as any, 'tenant-123');

      expect(rows[0].wip_value).toBe(999999);
    });
  });

  describe('getDataEntry', () => {
    const scheduledBatch = {
      ...activeBatch,
      stage_id: 'stage-gest',
      start_date: '2026-07-01',
      opening_quantity: '20.0000',
      current_stage_code: 'GESTATION',
    };

    const schedulerHeader = {
      scheduler_id: 'sched-1',
      batch_id: 'batch-1',
      stage_id: 'stage-gest',
      effective_from: '2026-09-01',
      animal_count: '20.0000',
    };

    const feedLine = {
      line_id: 'line-feed',
      line_type: 'CONSUMPTION',
      parameter_name: 'Mid Gestation Ration',
      item_id: 'item-feed',
      resource_id: null,
      qty_basis: 'PER_HEAD',
      // kilograms per head per day — a quantity, emphatically not a price
      standard_qty: '2.2000',
      occurrence: 'DAILY',
      kpi_uom: null,
    };

    // Every getDataEntry query in order: same-day transactions, same-day
    // batch_daily_data entries, item rows, resource rows, uom conversions.
    const setup = (line: any, itemRow: any | null) => {
      jest.spyOn(service, 'findOne').mockResolvedValue(scheduledBatch as any);
      jest.spyOn(service as any, 'loadActiveScheduleLines').mockResolvedValue([{ header: schedulerHeader, line }]);
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // same-day transactions
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // same-day daily-data entries
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(itemRow ? [itemRow] : []) }) }) // item rows
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) // resource rows
        .mockReturnValueOnce({ from: jest.fn().mockResolvedValue([]) }); // uom conversions
    };

    it('reports the item standard cost as the line rate', async () => {
      setup(feedLine, {
        item_id: 'item-feed',
        item_code: 'FEED-GEST-SOW',
        item_name: 'Dry Sow Gestation Mash',
        item_type: 'FEED',
        standard_cost: '28.000000',
        uom_primary: 'KG',
      });

      const result = await service.getDataEntry('batch-1', '2026-09-01');

      // 28/kg, not 2.2 — the per-head quantity was being surfaced as a price,
      // so the data-entry screen costed 6 labour hours at ₹6.
      expect(result.lines[0].std_rate).toBe(28);
      // 2.2 kg/head * 20 animals (scheduler_header.animal_count)
      expect(result.lines[0].expected_qty).toBe(44);
    });

    // The old model's uom_override — dosing in ML from stock priced per VIAL —
    // is gone: the new scheduler_line schema (Master Templates/
    // Schedule_master_template.xlsx) marks `uom` CALC, auto-flowing from
    // item_master.uom_primary with no per-line override, so a line's unit is
    // now always its item's stock unit and the conversion branch in
    // getDataEntry's standardRate() is unreachable for CONSUMPTION/OUTPUT.

    it('reports no rate rather than a quantity when the line has no item or resource', async () => {
      setup(
        { ...feedLine, line_id: 'line-labour', line_type: 'DESCRIPTIVE', item_id: null, qty_basis: null, standard_qty: null, kpi_uom: 'HRS' },
        null,
      );

      const result = await service.getDataEntry('batch-1', '2026-09-01');

      expect(result.lines[0].std_rate).toBeNull();
    });
  });

  describe('matureBioAsset', () => {
    const bioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      breed_id: 'breed-1',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('transitions PREMATURE batch to MATURE, calculates amortization rate, and posts BIO_TRANSFORMATION', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      const mockGlService = { postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).glPostingService = mockGlService;

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  state_id: 'state-1',
                  batch_id: 'batch-1',
                  stage: 'PREMATURE',
                  current_quantity: '10.0000',
                  nca_book_value: '50000.0000',
                },
              ]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ breed_id: 'breed-1', productive_life_months: 24 }]),
            }),
          }),
        });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.matureBioAsset(
        'batch-1',
        { residual_value_per_unit: 500, productive_life_months: 24 },
        'tenant-123',
        { userId: 'user-1' },
      );

      // ncaValue: 50000, residualTotal: 500 * 10 = 5000
      // monthlyRate: (50000 - 5000) / 24 / 10 = 187.5
      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_TRANSFORMATION',
          amount: 50000,
        }),
      );

      expect(mockDbUpdate).toHaveBeenCalled();
      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setCall.stage).toBe('MATURE');
      expect(Number(setCall.monthly_amortization_rate)).toBeCloseTo(187.5);
    });

    it('rejects maturing a batch that is already MATURE', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(bioBatch as any);

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '50000.0000',
              },
            ]),
          }),
        }),
      });

      await expect(
        service.matureBioAsset('batch-1', { residual_value_per_unit: 500 }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('amortizeBioAsset', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('posts BIO_AMORTIZATION and reduces nca_book_value', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockGlService = { postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).glPostingService = mockGlService;

      // 1. getBioAssetState
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '45000.0000',
                monthly_amortization_rate: '187.500000',
              },
            ]),
          }),
        }),
      });
      // 2. existingEntries check
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([]),
        }),
      });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.amortizeBioAsset('batch-1', { posting_date: '2026-02-15' }, 'tenant-123', { userId: 'user-1' });

      // 187.5 * 10 = 1875
      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_AMORTIZATION',
          amount: 1875,
          postingDate: '2026-02-15',
        }),
      );

      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(Number(setCall.nca_book_value)).toBeCloseTo(43125);
    });

    it('rejects duplicate amortization for the same month', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '45000.0000',
                monthly_amortization_rate: '187.500000',
              },
            ]),
          }),
        }),
      });
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ posting_date: '2026-02-01', entry_type: 'AMORTIZATION' }]),
        }),
      });

      await expect(
        service.amortizeBioAsset('batch-1', { posting_date: '2026-02-28' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordFairValue', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('posts BIO_FAIR_VALUE with reverseDirection for fair value loss', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockGlService = { postBatchCostEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).glPostingService = mockGlService;

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '10.0000',
                nca_book_value: '40000.0000', // 4000/unit
              },
            ]),
          }),
        }),
      });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      // Fair value drops to 3500/unit -> loss of 500 * 10 = 5000
      await service.recordFairValue('batch-1', { fair_value_per_unit: 3500, posting_date: '2026-03-01' }, 'tenant-123', { userId: 'user-1' });

      expect(mockGlService.postBatchCostEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_FAIR_VALUE',
          amount: 5000,
          reverseDirection: true,
        }),
      );

      const setCall = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(Number(setCall.nca_book_value)).toBeCloseTo(35000);
    });
  });

  describe('disposeBioAsset', () => {
    const matureBioBatch = {
      ...activeBatch,
      batch_no: 'BATCH-000001',
      costing_method: 'BIO_ASSET',
      input_lines: [{ item_id: 'item-piglet' }],
    };

    it('auto-closes the batch when the last animals are disposed', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(matureBioBatch as any);

      const mockLedgerService = { writePositiveEntry: jest.fn().mockResolvedValue({ ledger_id: 'l-1' }) };
      const mockGlService = { postInventoryLedgerEntry: jest.fn().mockResolvedValue({ journal_id: 'j-1' }) };
      (service as any).ledgerService = mockLedgerService;
      (service as any).glPostingService = mockGlService;

      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([
              {
                state_id: 'state-1',
                batch_id: 'batch-1',
                stage: 'MATURE',
                current_quantity: '5.0000',
                nca_book_value: '20000.0000',
              },
            ]),
          }),
        }),
      }).mockReturnValueOnce({
        // The harvest warehouse must sit on the batch's company and LOB (I4).
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ location_id: 'wh-1', company_id: 'comp-1', lob_id: 'lob-piggery', parent: 'farm-1', farm_id: 'farm-1' }]),
          }),
        }),
      });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      await service.disposeBioAsset(
        'batch-1',
        {
          disposal_type: 'HARVEST',
          quantity: 5,
          posting_date: '2026-04-01',
          output_item_id: 'item-dressed-pork',
          output_uom: 'KG',
          output_quantity: 400,
          warehouse_id: 'wh-1',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockLedgerService.writePositiveEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionType: 'BIO_HARVEST',
          quantity: 400,
          rate: 50, // 20000 / 400
        }),
      );

      // Verify that batchHeader was updated to CLOSED
      const setMock = mockDbUpdate.mock.results[0].value.set as jest.Mock;
      const allSetCalls = setMock.mock.calls.map((call) => call[0]);
      const batchHeaderCloseCall = allSetCalls.find((call) => call.status === 'CLOSED');
      expect(batchHeaderCloseCall).toBeDefined();
      expect(batchHeaderCloseCall.status).toBe('CLOSED');
    });
  });

  describe('bulkAddDailyTransactions', () => {
    it('iterates rows and dispatches addTransaction for feed, mortality, and temperature', async () => {
      const addTxSpy = jest.spyOn(service, 'addTransaction').mockResolvedValue({ transaction_id: 'tx-1' } as any);

      const res = await service.bulkAddDailyTransactions(
        {
          company_id: 'comp-1',
          entry_date: '2026-08-19',
          entries: [
            {
              batch_id: 'b-1',
              feed_item_id: 'item-feed',
              feed_qty: 450,
              mortality_count: 2,
              temperature: 24.5,
              water_qty: 1200,
              remarks: 'Normal routine',
            },
            {
              batch_id: 'b-2',
              feed_item_id: 'item-feed',
              feed_qty: 600,
              mortality_count: 0,
            },
          ],
        },
        'tenant-123',
        { userId: 'user-1' }
      );

      expect(res.totalEntries).toBe(2);
      expect(res.successCount).toBe(5); // 4 for b-1 (feed, mort, water, temp) + 1 for b-2 (feed)
      expect(res.errorCount).toBe(0);
      expect(addTxSpy).toHaveBeenCalledTimes(5);
    });
  });

  describe('generateSchedulerForBatch', () => {
    // The heavy lifting (breed lifecycle lookup, line generation) now lives in
    // SchedulerHeaderService.generateForBatchCurrentStage() — see
    // scheduler-header.service.spec.ts. This is a thin delegator, so the only
    // thing worth asserting here is that the delegation happens.
    it('delegates to SchedulerHeaderService.generateForBatchCurrentStage', async () => {
      const schedulerHeaderService = module.get<SchedulerHeaderService>(SchedulerHeaderService);
      const spy = jest.spyOn(schedulerHeaderService, 'generateForBatchCurrentStage').mockResolvedValue({ scheduler_id: 'sched-1' } as any);

      const res = await service.generateSchedulerForBatch('b-1', 'tenant-123', { userId: 'user-1' });

      expect(spy).toHaveBeenCalledWith('b-1', 'tenant-123', { userId: 'user-1' });
      expect(res).toEqual({ scheduler_id: 'sched-1' });
    });
  });

  describe('getBatchPerformanceCurves', () => {
    it('returns structured standard curves vs actual metrics', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        batch_id: 'b-1',
        batch_no: 'BATCH-2026-0001',
        start_date: new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10),
        initial_quantity: 100,
        current_quantity: 98,
      } as any);

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue([
                  {
                    tx: {
                      transaction_date: new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10),
                      transaction_type: 'CONSUMPTION',
                      quantity: '120.00',
                    },
                    item: { item_type: 'FEED' },
                  },
                  {
                    tx: {
                      transaction_date: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10),
                      transaction_type: 'MORTALITY',
                      quantity: '2.00',
                    },
                    item: null,
                  },
                ]),
              }),
            }),
          }),
        }) // batch transactions
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }); // scheduler_header rows for this batch — none, so schedulerLines is never queried

      const res = await service.getBatchPerformanceCurves('b-1', 'tenant-123');

      expect(res.batch.batch_no).toBe('BATCH-2026-0001');
      expect(res.curves.length).toBeGreaterThan(0);
      expect(res.summary.totalActFeedKg).toBe(120);
      expect(res.summary.totalMortality).toBe(2);
    });
  });

  describe('farm scope', () => {
    const grasmere: FarmScope = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };

    // Table-keyed db double, modelled on batch-daily-data.service.spec.ts —
    // needed here because create() -> findOne() fans out into many unrelated
    // selects (input lines, transactions, attachments, ...) that a
    // call-order-sequenced mock can't accommodate.
    const rows = new Map<unknown, unknown[]>();
    const insertedByTable = new Map<unknown, unknown>();

    const chain = (result: unknown[]) => {
      const self: any = {
        from: () => self,
        where: (condition?: any) => {
          if (!condition || !result.some((row: any) => row?.location_id)) return self;
          const params = new MySqlDialect().sqlToQuery(condition).params;
          const matchingIds = new Set(params.filter((param): param is string => typeof param === 'string'));
          const filtered = result.filter((row: any) => !row?.location_id || matchingIds.has(row.location_id));
          return chain(filtered.length ? filtered : result);
        },
        limit: () => self,
        for: () => self,
        orderBy: () => self,
        leftJoin: () => self,
        innerJoin: () => self,
        then: (ok: any, err: any) => Promise.resolve(result).then(ok, err),
      };
      return self;
    };

    const insertedValues = (table: unknown) => insertedByTable.get(table);

    const validCreateDto = {
      company_id: 'co-1',
      lob_id: 'lob-pig',
      farm_id: 'farm-g',
      animal_tracking: 'COUNT_ONLY',
      stage_id: 'stage-1',
      costing_method: 'FIFO',
      start_date: '2026-01-01',
      opening_quantity: 100,
      uom: 'HEAD',
      input_lines: [] as unknown[],
    };

    beforeEach(() => {
      rows.clear();
      insertedByTable.clear();
      rows.set(schema.lobMaster, [{ nob_id: 'nob-1', lob_name: 'Piggery', costing_method_allowed: 'FIFO,STANDARD' }]);
      rows.set(schema.stageMaster, [{
        stage_id: 'stage-1', tenant_id: 'tenant-1', company_id: 'co-1', lob_id: 'lob-pig',
        stage_code: 'ENTRY', is_active: true, deleted_at: null,
      }]);
      rows.set(schema.locationMaster, [{
        location_id: 'farm-g', tenant_id: 'tenant-1', company_id: 'co-1', lob_id: 'lob-pig',
        location_type: 'FARM', parent_location_id: null, farm_id: 'farm-g', is_active: true, deleted_at: null,
      }]);
      rows.set(schema.batchHeader, [{ ...activeBatch }]);

      mockDbSelect.mockReset();
      mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => chain(rows.get(table) ?? []) }));
      mockDb.select = mockDbSelect;

      mockDbInsert.mockReset();
      mockDbInsert.mockImplementation((table: unknown) => ({
        values: jest.fn((v: unknown) => { insertedByTable.set(table, v); return Promise.resolve({}); }),
      }));

      mockDbTransaction.mockReset();
      mockDbTransaction.mockImplementation(async (work: any) => work(mockDb));
    });

    it('answers 404 for a batch on another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.batchHeader, []); // the scoped query finds nothing
      await expect(service.findOne('batch-on-kintyre')).rejects.toThrow(NotFoundException);
    });

    it('stamps the farm derived from the batch location on create', async () => {
      useFarmScope(grasmere);
      rows.set(schema.locationMaster, [
        { location_id: 'farm-g', tenant_id: 'tenant-1', parent_location_id: null, farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', location_type: 'FARM', is_active: true, deleted_at: null },
        { location_id: 'pen-1', tenant_id: 'tenant-1', parent_location_id: 'shed-1', farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', location_type: 'PEN', is_active: true, deleted_at: null },
      ]);
      await service.create({ ...validCreateDto, location_id: 'pen-1' } as any, 'tenant-1', { userId: 'u-1' } as any);
      expect(insertedValues(schema.batchHeader)).toMatchObject({ farm_id: 'farm-g' });
    });

    /**
     * Recovery review follow-ups on the batch lifecycle. The batch below runs
     * on Grasmere; every Kintyre id must be refused before anything is written.
     */
    const grasmereBatch = {
      ...activeBatch, company_id: 'co-1', lob_id: 'lob-pig', farm_id: 'farm-g', batch_no: 'B-G-1',
      costing_method: 'FIFO', input_lines: [], transactions: [],
    };
    const kintyreWarehouse = { location_id: 'wh-k', parent: 'farm-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig' };
    const consumption = { transaction_date: '2026-09-14', transaction_type: 'CONSUMPTION', item_id: 'feed-1', quantity: 100, uom: 'KG' };

    it('M3: answers not-found for an out-of-scope batch without taking the row lock', async () => {
      useFarmScope(grasmere);
      rows.set(schema.batchHeader, []); // the batch exists on Kintyre; scoped reads find nothing
      const locked: unknown[] = [];
      mockDbSelect.mockImplementation(() => ({ from: (table: unknown) => {
        const c = chain(rows.get(table) ?? []);
        c.for = () => { locked.push(table); return c; };
        return c;
      } }));

      await expect(service.addTransaction('batch-on-kintyre', consumption as any, 'tenant-1'))
        .rejects.toThrow(NotFoundException);
      // Before the fix the FOR UPDATE on batch_header ran first, then findOne refused.
      expect(locked).toEqual([]);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("I3: refuses consumption whose stock exists only in another farm's warehouse, with no ledger write", async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(grasmereBatch as any);
      rows.set(schema.inventoryLedger, [{ warehouse_id: 'wh-k', remaining_quantity: '500', on_farm: 0 }]);
      let projection: any;
      mockDbSelect.mockImplementation((p?: any) => {
        if (p?.on_farm) projection = p;
        return { from: (table: unknown) => chain(rows.get(table) ?? []) };
      });
      const writeNegativeEntry = jest.fn();
      (service as any).ledgerService = { writeNegativeEntry };

      await expect(service.addTransaction('batch-1', consumption as any, 'tenant-1'))
        .rejects.toThrow("Stock must come from a warehouse on the batch's farm.");
      // Before the fix nothing checked the layers: the ledger drew company-wide.
      expect(writeNegativeEntry).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
      const onFarm = new MySqlDialect().sqlToQuery(projection.on_farm);
      expect(onFarm.sql).toContain('lf.farm_id = ?');
      expect(onFarm.params).toContain('farm-g');
    });

    it("I3: bounds the ledger's FIFO draw to the batch farm's warehouse when an older layer sits off the farm", async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(grasmereBatch as any);
      rows.set(schema.inventoryLedger, [
        { warehouse_id: 'wh-k', remaining_quantity: '500', on_farm: 0 }, // oldest, Kintyre
        { warehouse_id: 'wh-g', remaining_quantity: '300', on_farm: 1 },
      ]);
      const writeNegativeEntry = jest.fn().mockRejectedValue(new Error('stop after the ledger call'));
      (service as any).ledgerService = { writeNegativeEntry };

      await expect(service.addTransaction('batch-1', consumption as any, 'tenant-1')).rejects.toThrow('stop after the ledger call');
      // Before the fix warehouseId was never passed, so FIFO would take Kintyre's layer.
      expect(writeNegativeEntry).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'feed-1', warehouseId: 'wh-g' }));
    });

    it("I4: refuses a stage transfer into a location on another farm, before any write", async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(grasmereBatch as any);
      rows.set(schema.locationMaster, [kintyreWarehouse]);

      await expect(service.transferStage('batch-1', { to_stage_code: 'GROWER', to_location_id: 'wh-k' } as any, 'tenant-1'))
        .rejects.toThrow("Stage location is not on the batch's farm.");
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("I4: refuses closing with an output warehouse on another farm, before any stock posts", async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue(grasmereBatch as any);
      rows.set(schema.locationMaster, [kintyreWarehouse]);
      const writePositiveEntry = jest.fn();
      (service as any).ledgerService = { writePositiveEntry };

      await expect(service.close('batch-1', {
        output_lines: [{ item_id: 'pork', quantity: 10, uom: 'KG', cost_split_pct: 100, warehouse_id: 'wh-k' }],
      } as any, 'tenant-1')).rejects.toThrow(ForbiddenException);
      expect(writePositiveEntry).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it("I4: refuses a harvest disposal into a warehouse on another farm, before any stock posts", async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({ ...grasmereBatch, costing_method: 'BIO_ASSET' } as any);
      rows.set(schema.batchBioAssetState, [{ batch_id: 'batch-1', stage: 'MATURE', current_quantity: '5', nca_book_value: '20000' }]);
      rows.set(schema.locationMaster, [kintyreWarehouse]);
      const writePositiveEntry = jest.fn();
      (service as any).ledgerService = { writePositiveEntry };

      await expect(service.disposeBioAsset('batch-1', {
        disposal_type: 'HARVEST', quantity: 5, posting_date: '2026-09-14',
        output_item_id: 'pork', output_uom: 'KG', output_quantity: 400, warehouse_id: 'wh-k',
      } as any, 'tenant-1')).rejects.toThrow("Harvest warehouse is not on the batch's farm.");
      expect(writePositiveEntry).not.toHaveBeenCalled();
    });

    it('refuses creating a batch on a location of another farm', async () => {
      useFarmScope(grasmere);
      rows.set(schema.locationMaster, [
        { location_id: 'farm-g', tenant_id: 'tenant-1', parent_location_id: null, farm_id: 'farm-g', company_id: 'co-1', lob_id: 'lob-pig', location_type: 'FARM', is_active: true, deleted_at: null },
        { location_id: 'pen-k', tenant_id: 'tenant-1', parent_location_id: 'shed-k', farm_id: 'farm-k', company_id: 'co-1', lob_id: 'lob-pig', location_type: 'PEN', is_active: true, deleted_at: null },
      ]);
      await expect(service.create({ ...validCreateDto, location_id: 'pen-k' } as any, 'tenant-1', { userId: 'u-1' } as any))
        .rejects.toThrow("Batch location is not on the batch's farm.");
    });
  });
});
