import { Test, TestingModule } from '@nestjs/testing';
import { NumberSeriesService } from './number-series.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';

describe('NumberSeriesService', () => {
  let service: NumberSeriesService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    transaction: jest.fn((work: (tx: any) => Promise<any>): Promise<any> => work(mockDb)),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NumberSeriesService,
        { provide: ClsService, useValue: { get: jest.fn().mockReturnValue(mockDb) } },
        { provide: AuditLogService, useValue: { log: jest.fn().mockResolvedValue({}) } },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<NumberSeriesService>(NumberSeriesService);
  });

  describe('manualCode', () => {
    it('normalizes a manual code without incrementing its number series', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: true, allowManual: true });
      mockDbSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) });
      await expect(service.manualCode('ITEM', ' custom-01 ', 'tenant', 'company')).resolves.toBe('CUSTOM-01');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('rejects manual entry when the series forbids it', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: true, allowManual: false });
      await expect(service.manualCode('ITEM', 'CUSTOM', 'tenant', 'company')).rejects.toThrow(BadRequestException);
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('rejects an existing identity without consuming a number', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      mockDbSelect.mockReturnValue({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'existing' }]) }) }) });
      await expect(service.manualCode('ITEM', 'CUSTOM', 'tenant', 'company')).rejects.toThrow(ConflictException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  /**
   * medicine, UOM conversion, GL mapping and breed lifecycle stage have a code
   * column but no configured series — the client owes us its numbering
   * conventions, so no no_series_master row was created for any of them. These
   * cover the "nothing configured" path that every one of their creates takes
   * today, and the "series added later" path that must then just work.
   */
  describe('resolveOptionalCode', () => {
    const noRows = () => mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });

    it('returns null when nothing is typed and no series is configured', async () => {
      jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue(null);
      await expect(service.resolveOptionalCode('GL_MAPPING', undefined, 'tenant', 'company')).resolves.toBeNull();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('treats the form\'s empty string as "no code", not as a blank identity', async () => {
      jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue(null);
      await expect(service.resolveOptionalCode('GL_MAPPING', '   ', 'tenant', 'company')).resolves.toBeNull();
    });

    it('keeps and normalizes a manually typed code while no series exists', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      noRows();
      await expect(service.resolveOptionalCode('GL_MAPPING', ' map-001 ', 'tenant', 'company')).resolves.toBe('MAP-001');
    });

    it('rejects a manual code already used in the same scope', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ mapping_id: 'existing' }] }) }) });
      await expect(service.resolveOptionalCode('GL_MAPPING', 'MAP-001', 'tenant', 'company')).rejects.toThrow(ConflictException);
    });

    it('starts generating the moment a series is configured, with no other change', async () => {
      jest.spyOn(service, 'resolveSeriesFor').mockResolvedValue('GL_MAPPING');
      const generate = jest.spyOn(service, 'generateNext').mockResolvedValue('MAP-007');
      await expect(service.resolveOptionalCode('GL_MAPPING', undefined, 'tenant', 'company')).resolves.toBe('MAP-007');
      expect(generate).toHaveBeenCalledWith('GL_MAPPING', 'tenant', 'company', undefined, {});
    });

    it('scopes breed_lifecycle_stages on tenant alone — that table has no company_id column', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      noRows();
      await expect(service.resolveOptionalCode('BREED_LIFECYCLE_STAGE', 'bls-001', 'tenant', null)).resolves.toBe('BLS-001');
    });
  });

  describe('editedCode', () => {
    it('leaves the stored code alone when the field comes back blank', async () => {
      await expect(service.editedCode('GL_MAPPING', '', 'MAP-001', 'tenant', 'company')).resolves.toBeNull();
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('is not a conflict with itself when the code is resubmitted unchanged', async () => {
      await expect(service.editedCode('GL_MAPPING', ' map-001 ', 'MAP-001', 'tenant', 'company')).resolves.toBeNull();
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('validates a genuinely changed code for scope uniqueness', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [{ mapping_id: 'other' }] }) }) });
      await expect(service.editedCode('GL_MAPPING', 'MAP-002', 'MAP-001', 'tenant', 'company')).rejects.toThrow(ConflictException);
    });

    it('names a NULL-coded legacy row as changed, so it can finally be given a code', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: false, allowManual: true });
      mockDbSelect.mockReturnValue({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
      await expect(service.editedCode('GL_MAPPING', 'map-001', null, 'tenant', 'company')).resolves.toBe('MAP-001');
    });
  });

  describe('read-only preview', () => {
    const returning = (rows: any[]) => {
      const builder: any = { from: () => builder, where: () => builder, limit: async () => rows, then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject) };
      return builder;
    };
    const series = { series_code: 'ITEM', document_type: 'ITEM', prefix: 'ITM', seq_length: 3, current_seq: 0,
      date_format: null, separator: '-', reset_frequency: 'NEVER', updated_at: new Date().toISOString() };

    it('returns the next unoccupied code without writes or locks', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: true, allowManual: true, seriesCode: 'ITEM' } as any);
      mockDbSelect.mockReturnValueOnce(returning([series])).mockReturnValueOnce(returning([{ code: 'ITM-001' }]));
      await expect(service.previewCode({ master: 'ITEM' }, 'tenant', 'company')).resolves.toMatchObject({ preview: 'ITM-002' });
      expect(mockDbUpdate).not.toHaveBeenCalled();
      expect(mockDbInsert).not.toHaveBeenCalled();
    });

    it('uses the BREED field series, matching create — Breed has no farm/parent to preview under', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: true, allowManual: true, seriesCode: 'BREED' } as any);
      mockDbSelect.mockReturnValueOnce(returning([{
        ...series,
        series_code: 'BREED',
        document_type: 'BREED',
        prefix: null,
        seq_length: 0,
        code_segments: ['breed_name'],
      }]))
        .mockReturnValueOnce(returning([{ code: 'LARGE_WHITE' }]));
      await expect(service.previewCode({
        master: 'BREED',
        record: JSON.stringify({ breed_name: 'Yorkshire' }),
      }, 'tenant', 'company')).resolves.toMatchObject({ preview: 'YORKSHIRE' });
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('rejects inaccessible parents rather than exposing their codes', async () => {
      jest.spyOn(service, 'resolveCodeSettings').mockResolvedValue({ generated: true, allowManual: true, seriesCode: 'LOCATION' } as any);
      mockDbSelect.mockReturnValueOnce(returning([{ ...series, series_code: 'LOCATION', document_type: 'LOCATION' }])).mockReturnValueOnce(returning([]));
      await expect(service.previewCode({ master: 'LOCATION', parentId: 'other-company-farm' }, 'tenant', 'company')).rejects.toThrow('active parent in this workspace');
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  describe('generateNext', () => {
    const mockLockedSelect = (row: any) => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                for: jest.fn().mockResolvedValue(row ? [row] : []),
              }),
            }),
          }),
        }),
      });
    };

    it('skips occupied manual identities without changing those records', async () => {
      mockLockedSelect({ id: 'series-1', document_type: 'ITEM', current_seq: 0, seq_length: 3,
        prefix: 'ITM', date_format: null, separator: '-', reset_frequency: 'NEVER', blocked: false, updated_at: new Date().toISOString() });
      mockDbSelect.mockReturnValueOnce({ from: () => ({ where: async () => [{ code: 'ITM-001' }, { code: 'itm-002' }, { code: 'MANUAL' }] }) });
      const set = jest.fn(() => ({ where: async () => ({}) }));
      mockDbUpdate.mockReturnValue({ set });
      await expect(service.generateNext('ITEM', 'tenant', 'company')).resolves.toBe('ITM-003');
      expect(mockDbUpdate).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith(expect.objectContaining({ current_seq: 3, last_no_used: 'ITM-003' }));
    });

    it('formats prefix + zero-padded sequence and increments current_seq', async () => {
      mockLockedSelect({
        id: 'series-1',
        current_seq: 4,
        seq_length: 6,
        prefix: 'BATCH',
        date_format: null,
        separator: '-',
        reset_frequency: 'NEVER',
        blocked: false,
        updated_at: new Date().toISOString(),
      });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const code = await service.generateNext('BATCH', 'tenant-123', 'comp-1');

      expect(code).toBe('BATCH-000005');
      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.current_seq).toBe(5);
      expect(setArg.last_no_used).toBe('BATCH-000005');
    });

    // Was date_format: 'YYYY', which stamped the year the record was created.
    // ANIMAL_PIGGERY now takes the year off the animal's own dob, so an animal
    // entered late carries the year it was born rather than the year of typing.
    it('inserts the date segment between prefix and sequence, from the record', async () => {
      mockLockedSelect({
        id: 'series-1',
        current_seq: 20,
        seq_length: 4,
        prefix: 'PIG',
        prefix_position: 'START',
        code_segments: ['dob:YEAR'],
        separator: '-',
        reset_frequency: 'NEVER',
        blocked: false,
        updated_at: new Date().toISOString(),
      });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const code = await service.generateNext('ANIMAL_PIGGERY', 'tenant-123', 'comp-1', undefined, { dob: '2019-04-02' });

      // 0001, not 0021: a segmented series counts within its own stem, so
      // animals born in 2019 number separately from those born in 2020. For the
      // live data this is continuous — PIG-2026-0026 exists, so the next 2026
      // animal is 0027 — while a late-entered 2019 animal starts its own run
      // instead of being stamped with this year.
      expect(code).toBe('PIG-2019-0001');
    });

    it('resets current_seq to 0 before incrementing when the YEARLY period has rolled over', async () => {
      const lastYear = new Date();
      lastYear.setFullYear(lastYear.getFullYear() - 1);

      mockLockedSelect({
        id: 'series-1',
        current_seq: 42,
        seq_length: 4,
        prefix: 'ITEM',
        date_format: null,
        separator: '-',
        reset_frequency: 'YEARLY',
        blocked: false,
        updated_at: lastYear.toISOString(),
      });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const code = await service.generateNext('ITEM', 'tenant-123', null);

      expect(code).toBe('ITEM-0001');
    });

    it('throws NotFoundException when the series does not exist in scope', async () => {
      mockLockedSelect(null);

      await expect(service.generateNext('BOGUS', 'tenant-123', null)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the series is inactive', async () => {
      mockLockedSelect({
        id: 'series-1',
        current_seq: 0,
        seq_length: 4,
        prefix: 'X',
        separator: '-',
        reset_frequency: 'NEVER',
        blocked: true,
        updated_at: new Date().toISOString(),
      });

      await expect(service.generateNext('X', 'tenant-123', null)).rejects.toThrow(BadRequestException);
    });
  });

  describe('lockSeries', () => {
    const mockLockedSelect = (row: any) => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockReturnValue({
                for: jest.fn().mockResolvedValue(row ? [row] : []),
              }),
            }),
          }),
        }),
      });
    };

    it('returns the locked row without incrementing it', async () => {
      mockLockedSelect({ id: 'series-1', current_seq: 4, seq_length: 3, blocked: false });

      const series = await service.lockSeries('LOCATION_SHED', 'tenant-123', 'comp-1');

      expect(series.id).toBe('series-1');
      expect(series.current_seq).toBe(4); // untouched — this is a lock, not a generator
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the series does not exist in scope', async () => {
      mockLockedSelect(null);

      await expect(service.lockSeries('BOGUS', 'tenant-123', null)).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when the series is inactive', async () => {
      mockLockedSelect({ id: 'series-1', current_seq: 0, seq_length: 3, blocked: true });

      await expect(service.lockSeries('X', 'tenant-123', null)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ensureCompanySeries', () => {
    it('creates a company counter after the highest matching existing code', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{
                description: 'Customer Code', document_type: 'CUSTOMER', prefix: 'CUS',
                separator: '-', seq_length: 3, date_format: null, reset_frequency: 'NEVER',
              }]),
            }),
          }),
        });

      let insertedValues: any;
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((values) => {
          insertedValues = values;
          return { onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) };
        }),
      });

      await service.ensureCompanySeries(
        'tenant-123',
        'comp-1',
        { seriesCode: 'CUSTOMER', seriesName: 'Customer Code', documentType: 'CUSTOMER', prefix: 'CUS', seqLength: 3 },
        async () => ['CUS-002', 'LEGACY-A', 'cus-017'],
      );

      expect(insertedValues).toEqual(expect.objectContaining({
        tenant_id: 'tenant-123', company_id: 'comp-1', code: 'CUSTOMER', current_seq: 17,
      }));
    });

    it('uses the built-in definition when an upgraded tenant has no template yet', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
        });

      let insertedValues: any;
      mockDbInsert.mockReturnValue({
        values: jest.fn().mockImplementation((values) => {
          insertedValues = values;
          return { onDuplicateKeyUpdate: jest.fn().mockResolvedValue({}) };
        }),
      });

      await service.ensureCompanySeries(
        'tenant-123',
        'comp-1',
        { seriesCode: 'RESOURCE', seriesName: 'Resource Code', documentType: 'RESOURCE', prefix: 'RES', seqLength: 3 },
        async () => [],
      );

      expect(insertedValues).toEqual(expect.objectContaining({ prefix: 'RES', seq_length: 3, current_seq: 0 }));
    });
  });

  describe('create', () => {
    it('rejects a duplicate series_code in the same scope', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ series_code: 'BATCH' }]),
          }),
        }),
      });

      await expect(
        service.create(
          { series_code: 'BATCH', series_name: 'Batch Number', document_type: 'BATCH', seq_length: 6 },
          'tenant-123',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('resolveSeriesFor', () => {
    // Queues one select().from().where().limit() result: a hit means a matching,
    // active no_series_master row exists in scope; a miss means it doesn't.
    const seedExists = (exists: boolean) => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue(exists ? [{ series_id: 'series-1' }] : []),
          }),
        }),
      });
    };

    it('prefers the master+type series over the master series', async () => {
      seedExists(true); // ITEM_RAW_MATERIAL exists

      const result = await service.resolveSeriesFor('ITEM', 'RAW_MATERIAL', 'tenant-123', 'comp-1');

      expect(result).toBe('ITEM_RAW_MATERIAL');
      expect(mockDbSelect).toHaveBeenCalledTimes(1); // short-circuits before checking the master-alone series
    });

    it('falls back to the master series when no type series exists', async () => {
      seedExists(false); // ITEM_CONSUMABLE missing
      seedExists(true); // ITEM exists

      const result = await service.resolveSeriesFor('ITEM', 'CONSUMABLE', 'tenant-123', 'comp-1');

      expect(result).toBe('ITEM');
    });

    it('returns null when nothing is configured, so the code stays manual', async () => {
      seedExists(false); // UOM_WEIGHT missing
      seedExists(false); // UOM missing

      const result = await service.resolveSeriesFor('UOM', 'WEIGHT', 'tenant-123', 'comp-1');

      expect(result).toBeNull();
    });

    it('skips the master+type tier entirely when no typeValue is given', async () => {
      seedExists(true); // ITEM_CATEGORY exists

      const result = await service.resolveSeriesFor('ITEM_CATEGORY', null, 'tenant-123', 'comp-1');

      expect(result).toBe('ITEM_CATEGORY');
      expect(mockDbSelect).toHaveBeenCalledTimes(1);
    });

    it('is case-insensitive on the type value when building the master+type series code', async () => {
      seedExists(true); // ITEM_RAW_MATERIAL exists

      const result = await service.resolveSeriesFor('item', 'raw_material', 'tenant-123', 'comp-1');

      expect(result).toBe('ITEM_RAW_MATERIAL');
    });
  });
});
