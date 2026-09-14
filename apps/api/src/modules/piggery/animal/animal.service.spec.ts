import { Test, TestingModule } from '@nestjs/testing';
import { AnimalService, resolveAgeAtEntryWeeks } from './animal.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { transactionCls, useFarmScope } from '../../../test-utils/transaction-cls';

describe('AnimalService', () => {
  let service: AnimalService;
  let numberSeriesService: NumberSeriesService;
  let cls: ReturnType<typeof transactionCls>;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
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
      const penOnKintyre = { location_id: 'pen-k', parent: 'shed-k', farm_id: 'farm-k' };
      mockDbSelect
        .mockReturnValueOnce(found({ company_id: 'comp-1' }))
        .mockReturnValueOnce(found({ nob_id: 'nob-1' }))
        .mockReturnValueOnce(found({ lob_id: 'lob-1' }))
        .mockReturnValueOnce(found({ breed_id: 'breed-1' }))
        .mockReturnValueOnce(found({ item_id: 'item-1' }))
        .mockReturnValueOnce(found(penOnKintyre)) // current_location_id assertExists
        .mockReturnValueOnce(found(penOnKintyre)); // assertLocationOnActiveFarm -> farmOfLocation

      await expect(
        service.create({ ...baseDto, current_location_id: 'pen-k' } as any, 'tenant-1'),
      ).rejects.toThrow('Animal location is not on your active farm.');
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
    it('advances animal stage and updates destination pen/location', async () => {
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-1',
          company_id: 'comp-1',
          animal_code: 'PIG-2026-0001',
          is_active: true,
          gender: 'F',
          current_stage_id: 'st-gilt',
          current_location_id: 'loc-1',
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
          location_id: 'loc-2',
          location_name: 'Pen 2B',
        })) // destLocation check
        .mockReturnValueOnce(found({
          animal_id: 'a-1',
          current_stage_id: 'st-flush',
          current_location_id: 'loc-2',
        })); // findOne return

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const res = await service.transitionStage(
        'a-1',
        {
          to_stage_id: 'st-flush',
          to_location_id: 'loc-2',
          transition_date: '2026-03-01',
          reason: 'Service ready',
        },
        'tenant-123',
        { userId: 'user-1' }
      );

      expect(res.current_stage_id).toBe('st-flush');
      expect(res.current_location_id).toBe('loc-2');
    });

    it.each(['WEANING', 'DRY_PERIOD', 'GESTATION', 'FLUSH'])('preserves the post-farrowing parity rule for %s', async (destination) => {
      let captured: any = null;
      mockDbSelect
        .mockReturnValueOnce(found({
          animal_id: 'a-2',
          company_id: 'comp-1',
          animal_code: 'PIG-2026-0002',
          is_active: true,
          gender: 'F',
          current_stage_id: 'st-farrow',
          current_location_id: 'loc-1',
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

