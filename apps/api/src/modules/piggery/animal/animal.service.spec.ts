import { Test, TestingModule } from '@nestjs/testing';
import { AnimalService, resolveAgeAtEntryWeeks } from './animal.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';

describe('AnimalService', () => {
  let service: AnimalService;
  let numberSeriesService: NumberSeriesService;
  let cls: ReturnType<typeof transactionCls>;

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

  const found = (row: any) => ({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(row ? [row] : []), for: jest.fn().mockResolvedValue(row ? [row] : []) }) }) });
  const joinedTreatmentRows = (rows: any[]) => ({ from: () => ({
    innerJoin: jest.fn().mockReturnThis(), where: jest.fn().mockResolvedValue(rows),
  }) });

  const baseDto = {
    company_id: 'comp-1',
    nob_id: 'nob-1',
    lob_id: 'lob-1',
    animal_type: 'GILT',
    breed_id: 'breed-1',
    gender: 'F',
    entry_type: 'TRANSFERRED_IN',
    entry_date: '2026-01-01',
    item_id: 'item-1',
    acquisition_cost: 2857.57,
    landing_cost: 200,
  };

  const nobLobResolution = {
    resolve: jest.fn(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    })),
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockDbTransaction.mockReset();
    mockDbTransaction.mockImplementation(async (work) => work(mockDb));
    nobLobResolution.resolve.mockReset();
    nobLobResolution.resolve.mockImplementation(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    }));

    cls = transactionCls(mockDb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnimalService,
        { provide: ClsService, useValue: cls },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NumberSeriesService, useValue: { generateNext: jest.fn().mockResolvedValue('PIG-2026-0001') } },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<AnimalService>(AnimalService);
    numberSeriesService = module.get<NumberSeriesService>(NumberSeriesService);
  });

  describe('create', () => {
    it('rejects a PURCHASED_LOCAL entry missing source_receipt_id', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }));

      await expect(
        service.create({ ...baseDto, entry_type: 'PURCHASED_LOCAL' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a BORN_ON_FARM entry missing source_batch_id', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }));

      await expect(
        service.create({ ...baseDto, entry_type: 'BORN_ON_FARM' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('computes total_opening_asset_value and generates animal_code via NumberSeriesService', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' })) // generateAnimalCode resolves the series prefix from the LOB
        .mockReturnValueOnce(found({ animal_id: 'a-1', animal_code: 'PIG-2026-0001', total_opening_asset_value: '3057.57' })); // findOne

      const insertedRecords: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { insertedRecords.push(v); return Promise.resolve({}); }) });

      const result = await service.create(baseDto as any, 'tenant-123', { userId: 'user-1' });

      expect(numberSeriesService.generateNext).toHaveBeenCalledWith('ANIMAL_PIGGERY', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      const animalInsert = insertedRecords[0];
      expect(animalInsert.total_opening_asset_value).toBe('3057.57');
      expect(animalInsert.animal_code).toBe('PIG-2026-0001');
      expect(result.animal_code).toBe('PIG-2026-0001');
      const ledgerInsert = insertedRecords[1];
      expect(ledgerInsert.entry_type).toBe('ACQUISITION');
      expect(ledgerInsert.cost_amount).toBe('3057.57');
    });

    it('runs number issuance, Animal insert, and opening ledger insert in one transaction', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }));
      mockDbInsert
        .mockReturnValueOnce({ values: jest.fn().mockResolvedValue({}) })
        .mockReturnValueOnce({ values: jest.fn().mockRejectedValue(new Error('ledger unavailable')) });

      await expect(service.create(baseDto as any, 'tenant-123')).rejects.toThrow('ledger unavailable');
      expect(mockDbTransaction).toHaveBeenCalledTimes(1);
    });

    it('rejects a duplicate rfid_tag within the tenant', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ animal_id: 'existing-animal' }));

      await expect(
        service.create({ ...baseDto, rfid_tag: 'RFID-001' }, 'tenant-123'),
      ).rejects.toThrow(ConflictException);
    });

    it('refuses to create an Animal row in a Count Only Batch', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({
          batch_id: 'count-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1',
          breed_id: 'breed-1', animal_tracking: 'COUNT_ONLY',
        }));

      await expect(service.create({
        ...baseDto,
        current_batch_id: 'count-1',
        current_stage_id: 'stage-1',
      } as any, 'tenant-123')).rejects.toThrow(/Count Only/i);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(numberSeriesService.generateNext).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects sire_animal_id equal to the animal itself', async () => {
      mockDbSelect.mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1' }));

      await expect(
        service.update('a-1', { sire_animal_id: 'a-1' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects dam_animal_id equal to the animal itself', async () => {
      mockDbSelect.mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1' }));

      await expect(
        service.update('a-1', { dam_animal_id: 'a-1' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['batch', { current_batch_id: 'batch-other' }],
      ['location', { current_location_id: 'pen-other' }],
      ['stage', { current_stage_id: 'stage-other' }],
    ])('does not let the ordinary edit path change the animal %s', async (_field, change) => {
      mockDbSelect.mockReturnValueOnce(found({
        animal_id: 'a-1',
        company_id: 'comp-1',
        current_batch_id: 'batch-1',
        current_location_id: 'pen-1',
        current_stage_id: 'stage-1',
      }));

      await expect(service.update('a-1', change as any, 'tenant-123'))
        .rejects.toThrow(/transfer|stage transition/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('does not let the ordinary edit path clear placement', async () => {
      mockDbSelect.mockReturnValueOnce(found({
        animal_id: 'a-1',
        company_id: 'comp-1',
        current_batch_id: 'batch-1',
        current_location_id: 'pen-1',
        current_stage_id: 'stage-1',
      }));

      await expect(service.update('a-1', { current_batch_id: null } as any, 'tenant-123'))
        .rejects.toThrow(/transfer/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  // Phase 1 access foundation, Task 6: animals belong to the farm holding
  // their current_location_id (or, absent one, their current_batch_id's
  // farm) — see common/farm-scope.ts. A restricted user or an admin with an
  // active farm must not read, nor place an animal onto, another farm.
  describe('farm scope', () => {
    it('answers 404 for an animal on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      // findOne's own select answers empty — as it would once the farm
      // condition excludes a row that exists but sits on another farm.
      mockDbSelect.mockReturnValueOnce(found(null));

      await expect(service.findOne('animal-on-kintyre')).rejects.toThrow(NotFoundException);
    });

    it('refuses placing an animal on another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      // location_type matters since the pen-only placement rule: a non-Pen row
      // is refused before the farm assertion this test exists to exercise.
      const penOnKintyre = { location_id: 'pen-k', parent: 'shed-k', farm_id: 'farm-k', location_type: 'PEN' };
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found(penOnKintyre)) // current_location_id assertExists
        .mockReturnValueOnce(found(penOnKintyre)); // assertLocationOnActiveFarm -> farmOfLocation

      await expect(
        // In the caller's own company and LOB, so only the location is at fault.
        service.create({ ...baseDto, company_id: 'co-1', lob_id: 'lob-pig', current_location_id: 'pen-k' } as any, 'tenant-1'),
      ).rejects.toThrow('Animal placement is not on your active farm.');
    });

    it('refuses a location-only placement when the Breed belongs to another farm', async () => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' });
      const penOnGrasmere = {
        location_id: 'pen-g', parent_location_id: 'shed-g', farm_id: 'farm-g', location_type: 'PEN',
        tenant_id: 'tenant-1', company_id: 'co-1', nob_id: 'nob-1', lob_id: 'lob-pig',
        is_active: true, deleted_at: null,
      };
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'co-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-pig' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-k' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found(penOnGrasmere))
        .mockReturnValueOnce(found({ ...penOnGrasmere, location_id: 'farm-g', location_type: 'FARM', parent_location_id: null }))
        .mockReturnValueOnce(found(null));

      await expect(
        service.create({ ...baseDto, company_id: 'co-1', lob_id: 'lob-pig', breed_id: 'breed-k', current_location_id: 'pen-g' } as any, 'tenant-1'),
      ).rejects.toThrow(/Breed.*not available.*farm/i);
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(numberSeriesService.generateNext).not.toHaveBeenCalled();
    });
  });

  /**
   * Recovery review C2: create wrote the caller's company_id and lob_id
   * unchecked (the row landed, then the read-back 404'd), and every secondary
   * reference was a tenant-wide existence check — an oracle for other farms.
   */
  describe('create is bounded by the caller scope before anything is written', () => {
    const grasmereOperator = { farmId: 'farm-g', restricted: true, companyId: 'co-1', lobId: 'lob-pig' };
    const penOnGrasmere = { location_id: 'pen-g', parent: 'shed-g', parent_location_id: 'shed-g', farm_id: 'farm-g', company_id: 'co-1', lob_id: null, location_type: 'PEN' };
    const recordInserts = () => mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

    it("refuses another LOB's lob_id before any insert", async () => {
      useFarmScope(cls, grasmereOperator);
      // The full happy path is mocked, so without the LOB assertion the create
      // would reach the insert (the reviewer's exploit) and this test would fail.
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'co-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-other' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found(penOnGrasmere))
        .mockReturnValueOnce(found(penOnGrasmere))
        .mockReturnValueOnce(found({ lob_code: 'OTHER' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));
      recordInserts();

      await expect(
        service.create({ ...baseDto, company_id: 'co-1', lob_id: 'lob-other', current_location_id: 'pen-g' } as any, 'tenant-1'),
      ).rejects.toThrow('Not authorized for this line of business.');
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(numberSeriesService.generateNext).not.toHaveBeenCalled();
    });

    it("refuses a company admin's create in a company other than the selected one, before any insert", async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'co-2' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));
      recordInserts();

      await expect(service.create({ ...baseDto, company_id: 'co-2' } as any, 'tenant-1')).rejects.toThrow(ForbiddenException);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('refuses a restricted user who names neither a location nor a batch', async () => {
      useFarmScope(cls, grasmereOperator);

      await expect(service.create({ ...baseDto, company_id: 'co-1', lob_id: 'lob-pig' } as any, 'tenant-1'))
        .rejects.toThrow(new BadRequestException('Choose where this animal is: a batch or a location on your farm.'));
      // Before the fix this animal was created on no farm at all.
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('also refuses a company admin who names neither a location nor a batch', async () => {
      useFarmScope(cls, { farmId: null, restricted: false, companyId: 'co-1', lobId: null });

      await expect(service.create({ ...baseDto, company_id: 'co-1' } as any, 'tenant-1'))
        .rejects.toThrow('Choose where this animal is');
      expect(mockDbInsert).not.toHaveBeenCalled();
      expect(numberSeriesService.generateNext).not.toHaveBeenCalled();
    });

    it('refuses a restricted user whose batch resolves to no farm', async () => {
      useFarmScope(cls, { ...grasmereOperator, farmId: null });
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'co-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-pig' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({
          batch_id: 'b-legacy', tenant_id: 'tenant-1', company_id: 'co-1',
          nob_id: 'nob-1', lob_id: 'lob-pig', breed_id: 'breed-1',
          animal_tracking: 'REGISTERED', farm_id: null,
        }));

      await expect(
        service.create({ ...baseDto, company_id: 'co-1', lob_id: 'lob-pig', current_batch_id: 'b-legacy' } as any, 'tenant-1'),
      ).rejects.toThrow('Batch has no farm');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    // Each reference that exists on another farm must answer exactly as a
    // missing id does, and must be looked up through the caller's scope. The
    // mocked query returns nothing either way, so the discriminating assertion
    // is the rendered WHERE: before the fix it carried no scope at all.
    it.each([
      ['source batch', { source_batch_id: 'b-k' }, "Batch with ID 'b-k' not found.", '`batch_header`.`farm_id` = ?'],
      ['current batch', { current_batch_id: 'b-k' }, "Current Batch with ID 'b-k' not found.", '`batch_header`.`company_id` = ?'],
      ['sire', { sire_animal_id: 'sire-k' }, "Sire animal with ID 'sire-k' not found.", 'animal_register af'],
      ['dam', { dam_animal_id: 'dam-k' }, "Dam animal with ID 'dam-k' not found.", 'animal_register af'],
      ['source receipt', { entry_type: 'PURCHASED_LOCAL', source_receipt_id: 'grn-k' }, "Goods receipt with ID 'grn-k' not found.", 'lf.farm_id = ?'],
    ])('answers an out-of-scope %s with the missing-id not-found', async (_label, reference, message, scopeSql) => {
      useFarmScope(cls, { farmId: 'farm-g', restricted: false, companyId: 'co-1', lobId: null });
      let captured: any;
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'co-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValue({ from: () => ({ where: (condition: any) => {
          captured = condition;
          return { limit: async () => [] };
        } }) });

      await expect(service.create({ ...baseDto, company_id: 'co-1', current_location_id: 'pen-g', ...reference } as any, 'tenant-1'))
        .rejects.toThrow(new NotFoundException(message));
      const rendered = new MySqlDialect().sqlToQuery(captured);
      expect(rendered.sql).toContain(scopeSql);
      expect(rendered.params).toContain('co-1');
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  // BBP §6: "teat count < 15 is a hard block at selection" — regardless of TSI score. There is
  // no dedicated gilt-selection endpoint in this codebase yet, so the guard sits on every path
  // that can carry no_of_teats onto a GILT: create() and update().
  describe('teat count guard (BBP §6)', () => {
    it('refuses to update a gilt with a teat count below 15, regardless of TSI', async () => {
      mockDbSelect.mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'GILT' }));

      await expect(
        service.update('a-1', { no_of_teats: 14, tsi: 99.9 }, 'tenant-123'),
      ).rejects.toThrow(/teat/i);
    });

    it('allows updating a gilt whose teat count is 15 or above', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'GILT' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1', no_of_teats: 15 }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await expect(
        service.update('a-1', { no_of_teats: 15 }, 'tenant-123'),
      ).resolves.toBeDefined();
    });

    it('does not apply the teat-count block to non-gilt animal types', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'SOW' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1', no_of_teats: 10 }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await expect(
        service.update('a-1', { no_of_teats: 10 }, 'tenant-123'),
      ).resolves.toBeDefined();
    });

    it('refuses to create a gilt with a teat count below 15', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }));

      await expect(
        service.create({ ...baseDto, animal_type: 'GILT', no_of_teats: 14 } as any, 'tenant-123'),
      ).rejects.toThrow(/teat/i);
    });
  });

  /**
   * TDD tracker Excel row 12 (S.No. 11): "Age at entry week, should be auto
   * computed as per DOB of BORN ON FARM animals and MANUAL ENTRY if animals
   * are IMPORTED." The Animal Register Master Template's column G is the
   * narrower rule Rishi chose on 2026-09-08: computed whenever DOB is known,
   * typed only when it is not.
   */
  /**
   * A purchased animal's cost is a fact on the receipt it arrived on, not a
   * number somebody retypes into the register. Rishi, 2026-09-08.
   */
  describe('acquisition cost from the source receipt', () => {
    const purchased = {
      ...baseDto,
      entry_type: 'PURCHASED_LOCAL',
      source_receipt_id: 'grn-1',
      acquisition_cost: 999,
    };

    const receiptFound = () => found({ receipt_id: 'grn-1' });
    const line = (rate: string | null) => ({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(rate === null ? [] : [{ rate, amount: rate }]) }) }),
    });

    it('takes the cost from the receipt line, ignoring what the caller sent', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(receiptFound())
        .mockReturnValueOnce(line('1500.0000'))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.create(purchased as any, 'tenant-123');

      expect(inserted[0].acquisition_cost).toBe('1500');
    });

    it('refuses when the receipt carries no line for this animal item', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(receiptFound())
        .mockReturnValueOnce(line(null));

      await expect(service.create(purchased as any, 'tenant-123')).rejects.toThrow(/receipt/i);
    });

    it('accepts a purchased entry that sends no cost at all', async () => {
      // The form cannot send it: the field is readOnly for purchased animals,
      // and readOnly fields are stripped from the payload. The receipt is the
      // source, so its absence is correct rather than an error.
      const { acquisition_cost, ...noCost } = purchased;
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(receiptFound())
        .mockReturnValueOnce(line('1500.0000'))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.create(noCost as any, 'tenant-123');

      expect(inserted[0].acquisition_cost).toBe('1500');
      expect(inserted[0].total_opening_asset_value).toBe('1700');
    });

    it('refuses a non-purchased entry that sends no cost, since nothing can supply it', async () => {
      const { acquisition_cost, ...noCost } = baseDto as any;
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }));

      await expect(service.create(noCost, 'tenant-123')).rejects.toThrow(/acquisition cost/i);
    });

    it('leaves a non-purchased entry cost exactly as entered', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      const inserted: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { inserted.push(v); return Promise.resolve({}); }) });

      await service.create({ ...baseDto, acquisition_cost: 2857.57 } as any, 'tenant-123');

      expect(inserted[0].acquisition_cost).toBe('2857.57');
    });
  });

  describe('age at entry weeks (TDD row 12)', () => {
    it('computes whole weeks between dob and entry_date', () => {
      expect(resolveAgeAtEntryWeeks('2025-12-04', '2026-01-01', undefined)).toBe(4);
    });

    it('floors a partial week rather than rounding it up', () => {
      // 27 days is three weeks and six days. The animal has not lived a fourth week.
      expect(resolveAgeAtEntryWeeks('2025-12-05', '2026-01-01', undefined)).toBe(3);
    });

    it('is zero for an animal born on the day it entered the register', () => {
      expect(resolveAgeAtEntryWeeks('2026-01-01', '2026-01-01', undefined)).toBe(0);
    });

    it('ignores a client-supplied value when dob is known', () => {
      // Otherwise the stored age and the stored dob can disagree, and the row
      // stops being self-consistent.
      expect(resolveAgeAtEntryWeeks('2025-12-04', '2026-01-01', 99)).toBe(4);
    });

    it('keeps the typed value when dob is unknown', () => {
      expect(resolveAgeAtEntryWeeks(null, '2026-01-01', 12)).toBe(12);
    });

    it('is null when dob is unknown and nothing was typed', () => {
      expect(resolveAgeAtEntryWeeks(null, '2026-01-01', undefined)).toBeNull();
    });

    it('rejects a dob after the entry date', () => {
      expect(() => resolveAgeAtEntryWeeks('2026-02-01', '2026-01-01', undefined)).toThrow(/before/i);
    });

    it('rejects a negative typed age', () => {
      expect(() => resolveAgeAtEntryWeeks(null, '2026-01-01', -1)).toThrow(/age at entry/i);
    });

    it('rejects a typed age beyond the typo guard', () => {
      expect(() => resolveAgeAtEntryWeeks(null, '2026-01-01', 521)).toThrow(/age at entry/i);
    });

    it('rejects a bad age before the number series issues a code', async () => {
      // A rejected create must not burn a sequence. Driving the real API showed
      // it did: a create refused for age 521 still consumed PIG-2026-0022, and
      // the register jumped 0021 -> 0023 with nothing in between.
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }));

      await expect(
        service.create({ ...baseDto, age_at_entry_weeks: 521 } as any, 'tenant-123'),
      ).rejects.toThrow(/age at entry/i);

      expect(numberSeriesService.generateNext).not.toHaveBeenCalled();
    });

    it('stores the computed age on create when dob is given', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      const insertedRecords: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { insertedRecords.push(v); return Promise.resolve({}); }) });

      await service.create({ ...baseDto, dob: '2025-12-04', age_at_entry_weeks: 99 } as any, 'tenant-123');

      expect(insertedRecords[0].age_at_entry_weeks).toBe(4);
    });

    it('stores the typed age on create when dob is omitted', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found({ lob_code: 'PIGGERY' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      const insertedRecords: any[] = [];
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { insertedRecords.push(v); return Promise.resolve({}); }) });

      await service.create({ ...baseDto, age_at_entry_weeks: 12 } as any, 'tenant-123');

      expect(insertedRecords[0].age_at_entry_weeks).toBe(12);
    });

    it('recomputes the age when dob is edited', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'SOW', dob: null, entry_date: '2026-01-01' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      let updated: any;
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockImplementation((v) => { updated = v; return { where: jest.fn().mockResolvedValue({}) }; }) });

      await service.update('a-1', { dob: '2025-12-04' } as any, 'tenant-123');

      expect(updated.age_at_entry_weeks).toBe(4);
    });

    it('leaves the age untouched when the update names neither dob nor the age', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'SOW', dob: '2025-12-04', entry_date: '2026-01-01' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      let updated: any;
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockImplementation((v) => { updated = v; return { where: jest.fn().mockResolvedValue({}) }; }) });

      await service.update('a-1', { grading: 'A' } as any, 'tenant-123');

      expect(updated).not.toHaveProperty('age_at_entry_weeks');
    });

    it('refuses a typed age on update when the animal has a dob', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', animal_type: 'SOW', dob: '2025-12-04', entry_date: '2026-01-01' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1' }));

      let updated: any;
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockImplementation((v) => { updated = v; return { where: jest.fn().mockResolvedValue({}) }; }) });

      await service.update('a-1', { age_at_entry_weeks: 99 } as any, 'tenant-123');

      // The dob still governs — the typed value is discarded, not merged.
      expect(updated.age_at_entry_weeks).toBe(4);
    });
  });

  describe('dispose', () => {
    it('computes gain_loss_on_disposal when book_value is set', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', is_active: true, book_value: '3000.00', animal_code: 'PIG-2026-0001' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1', is_active: false, disposal_type: 'SOLD', status: 'SOLD', gain_loss_on_disposal: '200.00' }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });
      mockDbInsert.mockReturnValue({ values: jest.fn().mockResolvedValue({}) });

      const result = await service.dispose(
        'a-1',
        { disposal_type: 'SOLD', disposal_date: '2026-06-01', disposal_value: 3200 },
        'tenant-123',
        { userId: 'user-1' },
      );


      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.gain_loss_on_disposal).toBe('200');
      expect(setArg.is_active).toBe(false);
      expect(setArg.status).toBe('SOLD');
      expect(result.is_active).toBe(false);
    });

    it('leaves gain_loss_on_disposal null when book_value is not set', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', is_active: true, book_value: null, animal_code: 'PIG-2026-0002' }))
        .mockReturnValueOnce(found({ animal_id: 'a-1', is_active: false }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      await service.dispose('a-1', { disposal_type: 'DIED', disposal_date: '2026-06-01' }, 'tenant-123');

      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.gain_loss_on_disposal).toBeNull();
      expect(setArg.status).toBe('DEAD');
    });

    it('rejects disposing an already-disposed animal', async () => {
      mockDbSelect.mockReturnValueOnce(found({ animal_id: 'a-1', is_active: false, animal_code: 'PIG-2026-0003' }));

      await expect(
        service.dispose('a-1', { disposal_type: 'SOLD', disposal_date: '2026-06-01' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    const joinedMedicationRows = (rows: any[]) => ({
      from: jest.fn().mockReturnValue({
        innerJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(rows) }),
      }),
    });

    it('blocks SLAUGHTERED disposal when a medicine withdrawal period has not elapsed', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', is_active: true, book_value: null, animal_code: 'PIG-2026-0004' }))
        .mockReturnValueOnce(joinedMedicationRows([
          { item_id: 'item-med', item_name: 'Amoxicillin', item_type: 'MEDICINE', withdrawal_days: 10, administered_date: '2026-06-05' },
        ]))
        .mockReturnValueOnce(joinedTreatmentRows([]));

      await expect(
        service.dispose('a-1', { disposal_type: 'SLAUGHTERED', disposal_date: '2026-06-10' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows SLAUGHTERED disposal once the withdrawal period has elapsed', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', is_active: true, book_value: null, animal_code: 'PIG-2026-0005' }))
        .mockReturnValueOnce(joinedMedicationRows([
          { item_id: 'item-med', item_name: 'Amoxicillin', item_type: 'MEDICINE', withdrawal_days: 10, administered_date: '2026-05-01' },
        ]))
        .mockReturnValueOnce(joinedTreatmentRows([]))
        .mockReturnValueOnce(found({ animal_id: 'a-1', is_active: false, status: 'SLAUGHTERED' }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const result = await service.dispose('a-1', { disposal_type: 'SLAUGHTERED', disposal_date: '2026-06-10' }, 'tenant-123');

      expect(result.status).toBe('SLAUGHTERED');
    });

    it('allows SLAUGHTERED disposal when no medication has ever been logged', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', company_id: 'comp-1', is_active: true, book_value: null, animal_code: 'PIG-2026-0006' }))
        .mockReturnValueOnce(joinedMedicationRows([]))
        .mockReturnValueOnce(joinedTreatmentRows([]))
        .mockReturnValueOnce(found({ animal_id: 'a-1', is_active: false, status: 'SLAUGHTERED' }));

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const result = await service.dispose('a-1', { disposal_type: 'SLAUGHTERED', disposal_date: '2026-06-10' }, 'tenant-123');

      expect(result.status).toBe('SLAUGHTERED');
    });
  });

  describe('getBioAssetLedger', () => {
    it('returns ledger entries ordered by posting_date', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({ animal_id: 'a-1', animal_code: 'PIG-2026-0001' })) // findOne check
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([
                { entry_id: 'e-1', entry_type: 'ACQUISITION', cost_amount: '3000.0000', posting_date: '2026-01-01' },
                { entry_id: 'e-2', entry_type: 'DISPOSAL', cost_amount: '-3000.0000', posting_date: '2026-06-01' },
              ]),
            }),
          }),
        });

      const entries = await service.getBioAssetLedger('a-1');
      expect(entries).toHaveLength(2);
      expect(entries[0].entry_type).toBe('ACQUISITION');
      expect(entries[1].entry_type).toBe('DISPOSAL');
    });
  });

  describe('lookupByTag', () => {
    it('resolves an animal matching RFID tag and returns active withdrawal checks', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnValue({
                leftJoin: jest.fn().mockReturnValue({
                  where: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue([
                      {
                        animal: {
                          animal_id: 'a-1',
                          rfid_tag: 'RFID-12345',
                          animal_code: 'PIG-2026-0001',
                        },
                        breed: { breed_name: 'Yorkshire' },
                        stage: { stage_name: 'Gilt' },
                        batch: { batch_no: 'BATCH-01' },
                      },
                    ]),
                  }),
                }),
              }),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce(joinedTreatmentRows([]));

      const res = await service.lookupByTag('RFID-12345', 'tenant-123');

      expect(res.animal_id).toBe('a-1');
      expect(res.breed_name).toBe('Yorkshire');
      expect(res.stage_name).toBe('Gilt');
      expect(res.hasActiveWithdrawal).toBe(false);
    });

    it('rejects an empty tag string', async () => {
      await expect(service.lookupByTag('   ', 'tenant-123')).rejects.toThrow(BadRequestException);
    });
  });

  describe('transitionStage', () => {
    it('refuses an animal with no Batch or physical location before writing', async () => {
      mockDbSelect.mockReturnValueOnce(found({
        animal_id: 'a-unplaced', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-1',
        breed_id: 'breed-1', animal_code: 'PIG-2026-0099', is_active: true,
        current_stage_id: null, current_batch_id: null, current_location_id: null,
      }));

      await expect(service.transitionStage(
        'a-unplaced', { to_stage_id: 'stage-2', transition_date: '2026-09-15' }, 'tenant-123',
      )).rejects.toThrow(/Registered Animals Batch/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it.each([
      ['location', { to_location_id: 'pen-other-farm' }],
      ['Batch', { to_batch_id: 'batch-other-farm' }],
    ])('does not let stage transition move an animal to another %s', async (_field, destination) => {
      mockDbSelect.mockReturnValueOnce(found({
        animal_id: 'a-1', company_id: 'comp-1', animal_code: 'PIG-2026-0001', is_active: true,
        current_batch_id: 'batch-1', current_location_id: 'pen-1', current_stage_id: 'stage-1',
      }));

      await expect(service.transitionStage('a-1', {
        to_stage_id: 'stage-2', ...destination, transition_date: '2026-09-15',
      }, 'tenant-123')).rejects.toThrow(/transfer/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses an animal attached to a Count Only Batch', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-1',
          breed_id: 'breed-1', animal_code: 'PIG-2026-0001', is_active: true,
          current_stage_id: null, current_batch_id: 'batch-count', current_location_id: null,
        }))
        .mockReturnValueOnce(found({
          stage_id: 'stage-2', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', is_active: true,
        }))
        .mockReturnValueOnce(found({
          batch_id: 'batch-count', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', breed_id: 'breed-1',
          animal_tracking: 'COUNT_ONLY',
        }));

      await expect(service.transitionStage(
        'a-1', { to_stage_id: 'stage-2', transition_date: '2026-09-15' }, 'tenant-123',
      )).rejects.toThrow(/Count Only/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('refuses a Batch and location that resolve to different farms', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-1',
          breed_id: 'breed-1', animal_code: 'PIG-2026-0001', is_active: true,
          current_stage_id: null, current_batch_id: 'batch-1', current_location_id: 'pen-2',
        }))
        .mockReturnValueOnce(found({
          stage_id: 'stage-2', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', is_active: true,
        }))
        .mockReturnValueOnce(found({
          batch_id: 'batch-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', breed_id: 'breed-1',
          animal_tracking: 'REGISTERED',
        }))
        .mockReturnValueOnce(found({
          location_id: 'pen-2', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-2', parent_location_id: 'shed-2',
          location_type: 'PEN',
        }));

      await expect(service.transitionStage(
        'a-1', { to_stage_id: 'stage-2', transition_date: '2026-09-15' }, 'tenant-123',
      )).rejects.toThrow(/same farm/i);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('requires the destination Stage to match the animal company, NOB and LOB', async () => {
      let captured: any;
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig',
          breed_id: 'breed-1', animal_code: 'PIG-2026-0001', is_active: true,
          current_stage_id: null, current_batch_id: 'batch-1', current_location_id: null,
        }))
        .mockReturnValueOnce({ from: () => ({ where: (condition: any) => {
          captured = condition;
          return { limit: async () => [] };
        } }) });

      await expect(service.transitionStage(
        'a-1', { to_stage_id: 'stage-other-lob', transition_date: '2026-09-15' }, 'tenant-123',
      )).rejects.toThrow(NotFoundException);

      const rendered = new MySqlDialect().sqlToQuery(captured);
      expect(rendered.params).toEqual(expect.arrayContaining(['tenant-123', 'comp-1', 'nob-1', 'lob-pig']));
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('requires the Breed profile to match the animal farm, company, NOB and LOB', async () => {
      let captured: any;
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1', company_id: 'comp-1', nob_id: 'nob-1', lob_id: 'lob-pig',
          breed_id: 'breed-other-lob', animal_code: 'PIG-2026-0001', is_active: true,
          current_stage_id: null, current_batch_id: 'batch-1', current_location_id: null,
        }))
        .mockReturnValueOnce(found({
          stage_id: 'stage-2', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-pig', is_active: true,
        }))
        .mockReturnValueOnce(found({
          batch_id: 'batch-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-pig', farm_id: 'farm-1',
          breed_id: 'breed-other-lob', animal_tracking: 'REGISTERED',
        }))
        .mockReturnValueOnce(found({
          location_id: 'farm-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-pig', location_type: 'FARM',
          parent_location_id: null, is_active: true,
        }))
        .mockReturnValueOnce({ from: () => ({ where: (condition: any) => {
          captured = condition;
          return { limit: async () => [] };
        } }) });

      await expect(service.transitionStage(
        'a-1', { to_stage_id: 'stage-2', transition_date: '2026-09-15' }, 'tenant-123',
      )).rejects.toThrow(/Breed/);

      const rendered = new MySqlDialect().sqlToQuery(captured);
      expect(rendered.params).toEqual(expect.arrayContaining([
        'breed-other-lob', 'tenant-123', 'comp-1', 'nob-1', 'lob-pig', 'farm-1',
      ]));
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('advances an animal stage while preserving its validated placement', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1',
          company_id: 'comp-1',
          nob_id: 'nob-1',
          lob_id: 'lob-1',
          breed_id: 'breed-1',
          animal_code: 'PIG-2026-0001',
          is_active: true,
          gender: 'F',
          current_stage_id: 'st-gilt',
          current_location_id: 'loc-1',
          current_batch_id: 'batch-1',
          parity_count: 0,
          entry_date: '2026-01-01',
        })) // findOne
        .mockReturnValueOnce(found({
          stage_id: 'st-flush',
          stage_code: 'FLUSH_SERVICE',
          stage_name: 'Flush and Service',
        })) // destStage check
        .mockReturnValueOnce(found({
          stage_id: 'st-gilt',
          min_days_before_move: 10,
          stage_name: 'Gilt Grower',
        })) // currentStage check
        .mockReturnValueOnce(found({
          batch_id: 'batch-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', breed_id: 'breed-1',
          animal_tracking: 'REGISTERED',
        })) // effective Batch
        .mockReturnValueOnce(found({
          location_id: 'loc-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', parent_location_id: 'shed-1',
          location_type: 'PEN',
        })) // effective location
        .mockReturnValueOnce(found({
          location_id: 'farm-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', location_type: 'FARM',
          parent_location_id: null, is_active: true,
        })) // active farm
        .mockReturnValueOnce(found({
          breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', location_id: 'farm-1', is_active: true,
        })) // farm-specific breed profile
        .mockReturnValueOnce(found({
          animal_id: 'a-1',
          current_stage_id: 'st-flush',
          current_location_id: 'loc-1',
        })); // findOne return

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const res = await service.transitionStage(
        'a-1',
        {
          to_stage_id: 'st-flush',
          transition_date: '2026-03-01',
          reason: 'Service ready',
        },
        'tenant-123',
        { userId: 'user-1' }
      );

      expect(res.current_stage_id).toBe('st-flush');
      expect(res.current_location_id).toBe('loc-1');
    });

    it.each(['WEANING', 'DRY_PERIOD', 'GESTATION', 'FLUSH'])('preserves the post-farrowing parity rule for %s', async (destination) => {
      let captured: any = null;
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-2',
          company_id: 'comp-1',
          nob_id: 'nob-1',
          lob_id: 'lob-1',
          breed_id: 'breed-1',
          animal_code: 'PIG-2026-0002',
          is_active: true,
          gender: 'F',
          current_stage_id: 'st-farrow',
          current_location_id: 'loc-1',
          current_batch_id: 'batch-1',
          parity_count: 2,
          entry_date: '2026-01-01',
        })) // findOne — no current_stage: animal_register has no such column
        .mockReturnValueOnce(found({
          stage_id: 'st-wean',
          stage_code: destination,
          stage_name: 'Weaning',
        })) // destStage
        .mockReturnValueOnce(found({
          stage_id: 'st-farrow',
          stage_code: 'FARROWING',
          stage_name: 'Farrowing',
          min_days_before_move: 1,
        })) // currentStage
        .mockReturnValueOnce(found({
          batch_id: 'batch-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', breed_id: 'breed-1',
          animal_tracking: 'REGISTERED',
        }))
        .mockReturnValueOnce(found({
          location_id: 'loc-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', farm_id: 'farm-1', parent_location_id: 'shed-1',
          location_type: 'PEN',
        }))
        .mockReturnValueOnce(found({
          location_id: 'farm-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', location_type: 'FARM',
          parent_location_id: null, is_active: true,
        }))
        .mockReturnValueOnce(found({
          breed_id: 'breed-1', tenant_id: 'tenant-123', company_id: 'comp-1',
          nob_id: 'nob-1', lob_id: 'lob-1', location_id: 'farm-1', is_active: true,
        }))
        .mockReturnValueOnce(found({ animal_id: 'a-2', parity_count: 3 })); // findOne return

      mockDbUpdate.mockReturnValue({
        set: jest.fn((v: any) => {
          captured = v;
          return { where: jest.fn().mockResolvedValue({}) };
        }),
      });

      await service.transitionStage(
        'a-2',
        { to_stage_id: 'st-wean', transition_date: '2026-06-01' },
        'tenant-123',
        { userId: 'user-1' }
      );

      expect(captured.parity_count).toBe(3);
    });

    it('moves every selected animal in one bulk call', async () => {
      // Tail-enders left behind by a batch move are a routine group, not a
      // one-off: moving them meant opening the modal once per animal.
      const single = jest.spyOn(service, 'transitionStage').mockResolvedValue({ animal_id: 'ok' } as any);

      const result = await service.bulkTransitionStage(
        { animal_ids: ['a-1', 'a-2', 'a-3'], to_stage_id: 'st-flush', transition_date: '2026-09-01' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(single).toHaveBeenCalledTimes(3);
      expect(result.moved).toBe(3);
      expect(result.failed).toHaveLength(0);
    });

    it('reports the animals it could not move without blocking the rest', async () => {
      // One animal short of its minimum days must not stop the others.
      jest.spyOn(service, 'transitionStage')
        .mockResolvedValueOnce({ animal_id: 'a-1' } as any)
        .mockRejectedValueOnce(new BadRequestException('Minimum duration of 90 days required'))
        .mockResolvedValueOnce({ animal_id: 'a-3' } as any);

      const result = await service.bulkTransitionStage(
        { animal_ids: ['a-1', 'a-2', 'a-3'], to_stage_id: 'st-flush', transition_date: '2026-09-01' } as any,
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(result.moved).toBe(2);
      expect(result.failed).toEqual([
        { animal_id: 'a-2', reason: 'Minimum duration of 90 days required' },
      ]);
    });

    it('rejects an empty selection rather than silently doing nothing', async () => {
      await expect(
        service.bulkTransitionStage({ animal_ids: [], to_stage_id: 'st-flush', transition_date: '2026-09-01' } as any, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transition of disposed animals', async () => {
      mockDbSelect.mockReturnValueOnce(found({
        animal_id: 'a-1',
        animal_code: 'PIG-2026-0001',
        is_active: false,
        status: 'SOLD',
      }));

      await expect(
        service.transitionStage('a-1', { to_stage_id: 'st-2', transition_date: '2026-03-01' }, 'tenant-123')
      ).rejects.toThrow(BadRequestException);
    });
  });
});
