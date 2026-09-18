import { Test, TestingModule } from '@nestjs/testing';
import { ItemService } from './item.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { NoSeriesService } from '../no-series/no-series.service';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

describe('ItemService', () => {
  let service: ItemService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockDbDelete = jest.fn();

  // Annotated because `transaction` hands the callback this same object,
  // which makes the type circular and otherwise implicitly `any`.
  const mockDb: any = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
    delete: mockDbDelete,
    transaction: jest.fn(async (cb) => cb(mockDb)),
  };

  const mockGenerateNext = jest.fn();

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
    mockDbDelete.mockReset();
    mockDb.transaction.mockClear();
    mockGenerateNext.mockReset();
    mockGenerateNext.mockResolvedValue('ITM-0001');
    nobLobResolution.resolve.mockReset();
    nobLobResolution.resolve.mockImplementation(async (_tenantId: string, _companyId: any, explicit: any) => ({
      nob_id: explicit?.nob_id ?? null,
      lob_id: explicit?.lob_id ?? null,
    }));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ItemService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: NumberSeriesService,
          useValue: {
            generateNext: mockGenerateNext,
            resolveSeriesFor: jest.fn().mockResolvedValue('ITEM'),
          },
        },
        {
          provide: NoSeriesService,
          useValue: {
            generateNextNumber: jest.fn().mockResolvedValue({ next_number: 'FEED-0001', series: { manual_nos: false } }),
          },
        },
        { provide: NobLobResolutionService, useValue: nobLobResolution },
      ],
    }).compile();

    service = module.get<ItemService>(ItemService);
    jest.spyOn(service as any, 'ensureCompanyItemSeries').mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should auto-generate item_code from the ITEM number series and create within a transaction', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ category_id: 'cat-1', category_name: 'Chicks' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ id: 'type-raw' }]), // item_type_master lookup
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ item_id: 'item-1', item_code: 'ITM-0001' }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          // Fetch attributes in findOne
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          company_id: 'comp-1',
          item_name: 'Item 1',
          item_type: 'RAW_MATERIAL',
          nob_id: 'nob-1',
          category_id: 'cat-1',
          uom_primary: 'PCS',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockGenerateNext).toHaveBeenCalledWith('ITEM', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(mockDb.transaction).toHaveBeenCalled();
      expect(result.item_code).toBe('ITM-0001');
    });

    it('should reject a MEDICINE item with no withdrawal_days', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'type-medicine' }]) }) }) });

      await expect(
        service.create(
          {
            company_id: 'comp-1',
            item_name: 'Amoxicillin',
            item_type: 'MEDICINE',
            nob_id: 'nob-1',
            uom_primary: 'ML',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockGenerateNext).not.toHaveBeenCalled();
    });

    // D1: the console no longer asks for NOB/LOB on create — the server derives
    // them from the company's operational areas via NobLobResolutionService.
    describe('NOB/LOB derivation (D1)', () => {
      it('stores the single NOB/LOB the company resolves to when the payload omits both', async () => {
        nobLobResolution.resolve.mockResolvedValue({ nob_id: 'nob-livestock', lob_id: 'lob-piggery' });
        mockDbSelect
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'type-raw' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'item-1', item_code: 'ITM-0001' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ leftJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) });

        let insertedValues: any;
        mockDbInsert.mockReturnValue({
          values: jest.fn().mockImplementation((v) => { insertedValues = v; return Promise.resolve({}); }),
        });

        await service.create(
          { company_id: 'comp-1', item_name: 'Starter Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' } as any,
          'tenant-123',
        );

        expect(nobLobResolution.resolve).toHaveBeenCalledWith('tenant-123', 'comp-1', { nob_id: undefined, lob_id: undefined });
        expect(insertedValues.nob_id).toBe('nob-livestock');
        expect(insertedValues.lob_id).toBe('lob-piggery');
      });

      it('stores null and still succeeds when the company spans two LOBs', async () => {
        nobLobResolution.resolve.mockResolvedValue({ nob_id: 'nob-livestock', lob_id: null });
        mockDbSelect
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'type-raw' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'item-1', item_code: 'ITM-0001' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ leftJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) });

        let insertedValues: any;
        mockDbInsert.mockReturnValue({
          values: jest.fn().mockImplementation((v) => { insertedValues = v; return Promise.resolve({}); }),
        });

        const result = await service.create(
          { company_id: 'comp-1', item_name: 'Starter Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG' } as any,
          'tenant-123',
        );

        expect(insertedValues.nob_id).toBe('nob-livestock');
        expect(insertedValues.lob_id).toBeNull();
        expect(result.item_code).toBe('ITM-0001');
      });

      it('honors an explicit nob_id on the DTO over derivation', async () => {
        mockDbSelect
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ id: 'type-raw' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ item_id: 'item-1', item_code: 'ITM-0001' }]) }) }) })
          .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ leftJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }) }) });

        let insertedValues: any;
        mockDbInsert.mockReturnValue({
          values: jest.fn().mockImplementation((v) => { insertedValues = v; return Promise.resolve({}); }),
        });

        await service.create(
          { company_id: 'comp-1', item_name: 'Starter Feed', item_type: 'RAW_MATERIAL', uom_primary: 'KG', nob_id: 'nob-explicit' } as any,
          'tenant-123',
        );

        expect(nobLobResolution.resolve).toHaveBeenCalledWith('tenant-123', 'comp-1', { nob_id: 'nob-explicit', lob_id: undefined });
        expect(insertedValues.nob_id).toBe('nob-explicit');
      });
    });
  });

  /**
   * item_master.item_type is a plain string with no FK, so nothing below the
   * service rejects a code that is not in item_type_master — the scope guard
   * only walks declared foreign keys. Seed and demo scripts write codes
   * directly, so rows carrying a code the master never had must stay readable
   * and editable; only a caller *changing* item_type is held to the master.
   */
  describe('item_type validation against item_type_master', () => {
    const rows = (result: any[]) => ({
      from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(result) }) }),
    });
    const attributeRows = (result: any[]) => ({
      from: jest.fn().mockReturnValue({ leftJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(result) }) }),
    });
    const legacyItem = {
      item_id: 'item-1', item_code: 'ITM-0001', item_name: 'Offal',
      item_type: 'BY_PRODUCT', company_id: 'comp-1', withdrawal_days: null,
    };

    it('rejects a create whose item_type is not a known type code', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([{ company_id: 'comp-1' }])) // company
        .mockReturnValueOnce(rows([])); // item_type_master: no such code

      await expect(
        service.create(
          { company_id: 'comp-1', item_name: 'Nonsense', item_type: 'BANANA_REPUBLIC', uom_primary: 'KG' } as any,
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockGenerateNext).not.toHaveBeenCalled();
      expect(mockDb.transaction).not.toHaveBeenCalled();
    });

    it('rejects an update that changes item_type to an unknown type code', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([legacyItem])) // findOne
        .mockReturnValueOnce(attributeRows([]))
        .mockReturnValueOnce(rows([])); // item_type_master: no such code

      await expect(service.update('item-1', { item_type: 'BANANA_REPUBLIC' }, 'tenant-123'))
        .rejects.toThrow(NotFoundException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('allows an update that changes item_type to a known type code', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([legacyItem])) // findOne
        .mockReturnValueOnce(attributeRows([]))
        .mockReturnValueOnce(rows([{ id: 'type-finished' }])) // item_type_master hit
        .mockReturnValueOnce(rows([{ ...legacyItem, item_type: 'FINISHED_GOOD' }])) // findOne after update
        .mockReturnValueOnce(attributeRows([]));
      const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) });
      mockDbUpdate.mockReturnValue({ set });

      const result = await service.update('item-1', { item_type: 'FINISHED_GOOD' }, 'tenant-123');

      expect(set.mock.calls[0][0].item_type).toBe('FINISHED_GOOD');
      expect(result.item_type).toBe('FINISHED_GOOD');
    });

    // A demo script wrote BY_PRODUCT straight into item_master; the console
    // resends every field on edit, so validating an unchanged item_type would
    // make such a row impossible to edit at all.
    it('lets a row whose stored item_type is unknown be edited while it resends that same item_type', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([legacyItem])) // findOne
        .mockReturnValueOnce(attributeRows([]))
        .mockReturnValueOnce(rows([{ ...legacyItem, item_name: 'Offal (chilled)' }])) // findOne after update
        .mockReturnValueOnce(attributeRows([]));
      const set = jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) });
      mockDbUpdate.mockReturnValue({ set });

      const result = await service.update('item-1', { item_name: 'Offal (chilled)', item_type: 'BY_PRODUCT' }, 'tenant-123');

      expect(set.mock.calls[0][0].item_name).toBe('Offal (chilled)');
      expect(result.item_name).toBe('Offal (chilled)');
    });

    it('still reads a row whose stored item_type is unknown', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([legacyItem]))
        .mockReturnValueOnce(attributeRows([]));

      await expect(service.findOne('item-1')).resolves.toMatchObject({ item_type: 'BY_PRODUCT' });
    });

    // findAll left-joins item_category_master so the list can show the category
    // an item is filed under by code rather than by UUID, orders by item_code so
    // the sequence is stable between loads, and runs a second query for the
    // total so the pager knows how many pages there really are.
    it('still lists rows whose stored item_type is unknown', async () => {
      const mockQueryBuilder: any = {
        leftJoin: jest.fn().mockImplementation(() => mockQueryBuilder),
        where: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnValue({
            limit: jest.fn().mockReturnValue({ offset: jest.fn().mockResolvedValue([legacyItem]) }),
          }),
        }),
      };
      const mockCountBuilder: any = {
        leftJoin: jest.fn().mockImplementation(() => mockCountBuilder),
        where: jest.fn().mockResolvedValue([{ total: 1 }]),
      };

      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue(mockQueryBuilder),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue(mockCountBuilder),
        });

      await expect(service.findAll({}, 'tenant-123')).resolves.toEqual({
        data: [legacyItem], total: 1, limit: 50, offset: 0,
      });
    });
  });

  it('does not allow the generated company-wide Item Code to be changed', async () => {
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ item_id: 'item-1', item_code: 'ITM-0001' }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          leftJoin: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue([]) }),
        }),
      });

    await expect(service.update('item-1', { item_code: 'RAW-0001' }, 'tenant-123'))
      .rejects.toThrow(ConflictException);
  });

  it('initializes one company ITEM counter after the highest existing item code', async () => {
    (service as any).ensureCompanyItemSeries.mockRestore();
    mockDbSelect
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{
              series_name: 'Item Code', document_type: 'ITEM', prefix: 'ITM', date_format: null,
              separator: '-', seq_length: 4, reset_frequency: 'NEVER',
            }]),
          }),
        }),
      })
      .mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{ code: 'ITM-0002' }, { code: 'ITM-0009' }]),
        }),
      });
    const onDuplicateKeyUpdate = jest.fn().mockResolvedValue({});
    const values = jest.fn().mockReturnValue({ onDuplicateKeyUpdate });
    mockDbInsert.mockReturnValue({ values });

    await (service as any).ensureCompanyItemSeries('tenant-123', 'comp-1');

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      company_id: 'comp-1', series_code: 'ITEM', current_seq: 9,
    }));
  });

  describe('createFromTemplate', () => {
    it('should generate draft item with next number from linked template and series', async () => {
      const templateRow = {
        id: 'tmpl-feed-1',
        template_code: 'TMPL-FEED',
        template_description: 'Standard Feed Template',
        no_series_id: 'series-feed-1',
        item_type: 'FEED',
        category: 'FEED_CAT',
        sub_category: 'BROILER',
        valuation_method: 'FIFO',
        item_tracking: 'NONE',
        inventory_type: 'INVENTORY',
        qr_code_enabled: true,
        inventory_gl_account: 'GL-1001',
        cogs_gl_account: 'GL-5001',
        is_active: true,
      };

      // 1. Template select
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([templateRow]),
          }),
        }),
      });

      // 2. Check existing item code uniqueness in item_master
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      // 3. Insert draft item
      mockDbInsert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.createFromTemplate(
        { template_id: 'tmpl-feed-1' },
        'tenant-123',
        'comp-1'
      );

      expect(result.status).toBe('DRAFT');
      expect(result.item_no).toBe('FEED-0001');
      expect(result.template_code).toBe('TMPL-FEED');
      expect(result.valuation_method).toBe('FIFO');
    });

    it('should reject when template is not found', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.createFromTemplate({ template_id: 'non-existent' }, 'tenant-123', 'comp-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when template is inactive', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ id: 'tmpl-1', is_active: false }]),
          }),
        }),
      });

      await expect(
        service.createFromTemplate({ template_id: 'tmpl-1' }, 'tenant-123', 'comp-1')
      ).rejects.toThrow(new BadRequestException('Item Template is inactive.'));
    });
  });

  describe('update draft validations', () => {
    it('should require item description when updating a draft item', async () => {
      const draftItem = {
        item_id: 'item-draft-1',
        item_code: 'FEED-0001',
        item_name: '',
        uom_primary: '',
        item_type: 'FEED',
        status: 'DRAFT',
        company_id: 'comp-1',
        is_active: false,
      };

      // findOne
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([draftItem]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(
        service.update('item-draft-1', { item_name: '' }, 'tenant-123')
      ).rejects.toThrow(new BadRequestException('Item Description is mandatory.'));
    });

    it('should require unit of measure when description is provided', async () => {
      const draftItem = {
        item_id: 'item-draft-1',
        item_code: 'FEED-0001',
        item_name: '',
        uom_primary: '',
        item_type: 'FEED',
        status: 'DRAFT',
        company_id: 'comp-1',
        is_active: false,
      };

      // findOne
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([draftItem]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      await expect(
        service.update('item-draft-1', { item_name: 'Starter Feed', uom_primary: '' }, 'tenant-123')
      ).rejects.toThrow(new BadRequestException('Unit of Measure is mandatory.'));
    });

    it('should validate inventory GL account exists in COA', async () => {
      const draftItem = {
        item_id: 'item-draft-1',
        item_code: 'FEED-0001',
        item_name: '',
        uom_primary: '',
        item_type: 'FEED',
        status: 'DRAFT',
        company_id: 'comp-1',
        is_active: false,
      };

      // findOne
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([draftItem]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]),
            }),
          }),
        });

      // assertGlAccountExists -> not found
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(
        service.update(
          'item-draft-1',
          {
            item_name: 'Starter Feed',
            uom_primary: 'KG',
            inventory_gl_account: 'INVALID-GL',
          },
          'tenant-123'
        )
      ).rejects.toThrow(new BadRequestException('Inventory GL Account not found in Chart of Accounts.'));
    });
  });
});

