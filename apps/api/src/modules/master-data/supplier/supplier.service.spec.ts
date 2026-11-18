import { Test, TestingModule } from '@nestjs/testing';
import { SupplierService } from './supplier.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { EncryptionService } from '../../system/encryption/encryption.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

describe('SupplierService', () => {
  let service: SupplierService;
  let encryptionService: EncryptionService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockEnsureCompanySeries = jest.fn();
  const mockGenerateNext = jest.fn();
  const mockEditedCode = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  };

  // The vendor master mode comes from the environment (apps/api/.env may say BC); these tests pin it explicitly.
  const envMasterSource = process.env.BC_VENDOR_MASTER_SOURCE;
  afterAll(() => {
    if (envMasterSource === undefined) delete process.env.BC_VENDOR_MASTER_SOURCE;
    else process.env.BC_VENDOR_MASTER_SOURCE = envMasterSource;
  });

  beforeEach(async () => {
    process.env.BC_VENDOR_MASTER_SOURCE = 'NAVFARM';
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockEnsureCompanySeries.mockReset().mockResolvedValue(undefined);
    mockGenerateNext.mockReset().mockResolvedValue('SUP-001');
    mockEditedCode.mockReset().mockImplementation((_master, supplied) => Promise.resolve(supplied));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn((key: string) => (key === 'tenantPostingTransaction' ? true : mockDb)),
          },
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: EncryptionService,
          useValue: {
            encrypt: jest.fn((v: string) => `enc(${v})`),
            decrypt: jest.fn((v: string) => v.replace(/^enc\(/, '').replace(/\)$/, '')),
          },
        },
        {
          provide: NumberSeriesService,
          useValue: {
            ensureCompanySeries: mockEnsureCompanySeries,
            generateNext: mockGenerateNext,
            editedCode: mockEditedCode,
          },
        },
      ],
    }).compile();

    service = module.get<SupplierService>(SupplierService);
    encryptionService = module.get<EncryptionService>(EncryptionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw NotFoundException if company does not exist', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]), // company not found
          }),
        }),
      });

      await expect(
        service.create(
          {
            company_id: 'non-existent-comp',
            supplier_code: 'SUP01',
            supplier_name: 'Supplier 1',
            email: 'info@sup1.com',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a supplier with the per-company generated code', async () => {
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
              limit: jest.fn().mockResolvedValue([]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([{ supplier_code: 'SUP-001', supplier_name: 'Supplier 1' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          company_id: 'comp-1',
          supplier_name: 'Supplier 1',
          email: 'info@sup1.com',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockEnsureCompanySeries).toHaveBeenCalledWith(
        'tenant-123',
        'comp-1',
        expect.objectContaining({ seriesCode: 'SUPPLIER', prefix: 'SUP', seqLength: 3 }),
        expect.any(Function),
      );
      expect(mockGenerateNext).toHaveBeenCalledWith('SUPPLIER', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(result.supplier_code).toBe('SUP-001');
    });

    it('should reject an ANIMAL_SUPPLIER missing health_cert_url and breeding_farm_code', async () => {
      mockDbSelect.mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) });

      await expect(
        service.create(
          {
            company_id: 'comp-1',
            supplier_name: 'Animal Supplier Co',
            vendor_type: 'ANIMAL_SUPPLIER',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should encrypt bank_account_no before insert and never store it as plaintext', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ company_id: 'comp-1' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_code: 'SUP-001', bank_account_no_enc: 'enc(1234567890)' }]) }) }) });

      let insertedValues: any;
      mockDbInsert.mockReturnValue({ values: jest.fn().mockImplementation((v) => { insertedValues = v; return Promise.resolve({}); }) });

      const result = await service.create(
        { company_id: 'comp-1', supplier_name: 'Feed Co', bank_account_no: '1234567890' },
        'tenant-123',
      );

      expect(encryptionService.encrypt).toHaveBeenCalledWith('1234567890');
      expect(insertedValues.bank_account_no_enc).toBe('enc(1234567890)');
      expect((result as any).bank_account_no_enc).toBeUndefined();
      expect(result.bank_account_last4).toBe('****7890');
    });
  });

  describe('update', () => {
    it('refuses to change the supplier code after it is created', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', supplier_code: 'SUP-001', vendor_type: 'GENERAL' }]) }) }),
      });

      await expect(service.update('s-1', { supplier_code: 'SUP-099' }, 'tenant-123')).rejects.toThrow(BadRequestException);
      expect(mockEditedCode).not.toHaveBeenCalled();
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('accepts an update that repeats the stored supplier code', async () => {
      mockDbSelect
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', supplier_code: 'SUP-001', vendor_type: 'GENERAL' }]) }) }),
        })
        .mockReturnValueOnce({
          from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', supplier_code: 'SUP-001', vendor_type: 'GENERAL' }]) }) }),
        });
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const res = await service.update('s-1', { supplier_code: 'sup-001' }, 'tenant-123');
      expect(res.supplier_code).toBe('SUP-001');
    });

    it('should re-validate vendor_type requirements against effective values', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', vendor_type: 'GENERAL', health_cert_url: null, breeding_farm_code: null }]) }) }),
      });

      await expect(
        service.update('s-1', { vendor_type: 'BREEDING_FARM' }, 'tenant-123'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('approve', () => {
    it('should set is_approved and reject re-approving an already-approved supplier', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', is_approved: true, supplier_name: 'Feed Co' }]) }) }),
      });

      await expect(service.approve('s-1', 'tenant-123')).rejects.toThrow(BadRequestException);
    });

    it('should approve a not-yet-approved supplier', async () => {
      mockDbSelect
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', is_approved: false, supplier_name: 'Feed Co' }]) }) }) })
        .mockReturnValueOnce({ from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', is_approved: true }]) }) }) });

      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

      const result = await service.approve('s-1', 'tenant-123', { userId: 'user-1' });

      const setArg = (mockDbUpdate.mock.results[0].value.set as jest.Mock).mock.calls[0][0];
      expect(setArg.is_approved).toBe(true);
      expect(setArg.approved_by).toBe('user-1');
      expect(result.is_approved).toBe(true);
    });
  });

  describe('Business Central vendors (source_system = BC)', () => {
    const bcRow = {
      supplier_id: 'sup-bc',
      supplier_code: 'VEN0001',
      supplier_name: 'IRVINE S AFRICA',
      source_system: 'BC',
      vendor_type: 'GENERAL',
      payment_terms: '14 DAYS',
      email: null,
      health_cert_url: null,
      breeding_farm_code: null,
      bank_account_no_enc: null,
      company_id: 'co-1',
      deleted_at: null,
      is_active: true,
      status: 'ACTIVE',
    };
    const selectReturns = (row: unknown) =>
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }) }),
      });
    const updateOk = () => mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue({}) }) });

    afterEach(() => {
      delete process.env.BC_VENDOR_MASTER_SOURCE;
    });

    it('marks BC rows so the form locks the BC-owned fields', async () => {
      selectReturns(bcRow);
      await expect(service.findOne('sup-bc')).resolves.toMatchObject({ bc_managed: true });
    });

    it('refuses a change to a field BC owns, naming the field', async () => {
      selectReturns(bcRow);
      await expect(service.update('sup-bc', { supplier_name: 'Renamed locally' } as any, 'tenant-1')).rejects.toThrow(
        /Fields maintained in BC: supplier_name/,
      );
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('accepts the form re-sending BC values unchanged together with a NAVFarm-owned field', async () => {
      selectReturns(bcRow);
      updateOk();
      await expect(
        service.update('sup-bc', { supplier_name: 'IRVINE S AFRICA ', payment_terms: '14 DAYS', email: '', vendor_type: 'FEED_SUPPLIER' } as any, 'tenant-1'),
      ).resolves.toBeDefined();
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it('refuses to delete a BC vendor (it is deactivated from BC instead)', async () => {
      selectReturns(bcRow);
      await expect(service.remove('sup-bc', 'tenant-1')).rejects.toThrow(/Blocked = All or untick "NavFarm Sync"/);
    });

    it('refuses local creation when BC is the only vendor source', async () => {
      process.env.BC_VENDOR_MASTER_SOURCE = 'BC';
      await expect(service.create({ supplier_name: 'Local Co' } as any, 'tenant-1')).rejects.toThrow(/created in Business Central/);
      expect(mockDbInsert).not.toHaveBeenCalled();
    });
  });

  describe('Business Central write-through (BC_VENDOR_MASTER_SOURCE=BC, integration on)', () => {
    const bcRow = {
      supplier_id: 'sup-bc',
      supplier_code: 'VEN0001',
      supplier_name: 'IRVINE S AFRICA',
      source_system: 'BC',
      bc_vendor_no: 'VEN0001',
      bc_etag: 'W/"1"',
      vendor_type: 'GENERAL',
      payment_terms: '14 DAYS',
      email: null,
      health_cert_url: null,
      breeding_farm_code: null,
      bank_account_no_enc: null,
      company_id: 'co-1',
      deleted_at: null,
      is_active: true,
      status: 'ACTIVE',
    };
    let bc: { writeThrough: boolean; createVendor: jest.Mock; updateVendor: jest.Mock; setNavfarmSync: jest.Mock };
    let wt: SupplierService;
    const selectReturns = (row: unknown) =>
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([row]) }) }),
      });
    const sets: any[] = [];
    const updateOk = () =>
      mockDbUpdate.mockReturnValue({ set: jest.fn((v) => (sets.push(v), { where: jest.fn().mockResolvedValue({}) })) });

    beforeEach(() => {
      sets.length = 0;
      process.env.BC_VENDOR_MASTER_SOURCE = 'BC';
      bc = {
        writeThrough: true,
        createVendor: jest.fn().mockResolvedValue('sup-bc'),
        updateVendor: jest.fn().mockResolvedValue(undefined),
        setNavfarmSync: jest.fn().mockResolvedValue('sup-bc'),
      };
      wt = new SupplierService(
        { get: jest.fn((key: string) => (key === 'tenantPostingTransaction' ? true : mockDb)) } as any,
        { log: jest.fn().mockResolvedValue({}) } as any,
        encryptionService,
        {} as any,
        bc as any,
      );
    });
    afterEach(() => {
      delete process.env.BC_VENDOR_MASTER_SOURCE;
    });

    it('creates the vendor in BC (without a code: BC assigns the No.) and keeps NAVFarm fields locally', async () => {
      selectReturns(bcRow);
      updateOk();
      await wt.create({ supplier_code: 'SUP-001', supplier_name: 'New Vendor', payment_terms: '14 DAYS', vendor_type: 'FEED_SUPPLIER' } as any, 'tenant-1', { userId: 'u1' });
      expect(bc.createVendor).toHaveBeenCalledWith({ supplier_name: 'New Vendor', payment_terms: '14 DAYS' }, 'tenant-1', 'u1');
      expect(sets[0]).toMatchObject({ vendor_type: 'FEED_SUPPLIER' });
      expect(mockDbInsert).not.toHaveBeenCalled(); // the row came from BC's reply, not from the form
    });

    it('sends only changed BC fields to BC, and saves NAVFarm-owned fields locally', async () => {
      selectReturns(bcRow);
      updateOk();
      await wt.update('sup-bc', { supplier_name: 'IRVINE S AFRICA', payment_terms: '30 DAYS', vendor_type: 'FEED_SUPPLIER' } as any, 'tenant-1', { userId: 'u1' });
      expect(bc.updateVendor).toHaveBeenCalledWith({ bc_vendor_no: 'VEN0001', bc_etag: 'W/"1"' }, { payment_terms: '30 DAYS' }, 'tenant-1', 'u1');
      expect(sets[0]).toMatchObject({ vendor_type: 'FEED_SUPPLIER' });
      expect(sets[0]).not.toHaveProperty('payment_terms'); // BC's value arrives through the refresh, not the form
    });

    it('does not call BC when only NAVFarm fields change', async () => {
      selectReturns(bcRow);
      updateOk();
      await wt.update('sup-bc', { supplier_name: 'IRVINE S AFRICA', vendor_type: 'SERVICES' } as any, 'tenant-1');
      expect(bc.updateVendor).not.toHaveBeenCalled();
    });

    it('deactivating unticks NavFarm Sync in BC; deleting does too (the BC vendor is never deleted)', async () => {
      selectReturns(bcRow);
      updateOk();
      await wt.update('sup-bc', { is_active: false } as any, 'tenant-1');
      expect(bc.setNavfarmSync).toHaveBeenCalledWith('VEN0001', false, 'tenant-1', undefined);
      expect(sets[0]).toMatchObject({ is_active: false, status: 'INACTIVE' });

      bc.setNavfarmSync.mockClear();
      await wt.remove('sup-bc', 'tenant-1');
      expect(bc.setNavfarmSync).toHaveBeenCalledWith('VEN0001', false, 'tenant-1', undefined);
    });

    it('marks BC rows editable in the form when write-through is on', async () => {
      selectReturns(bcRow);
      await expect(wt.findOne('sup-bc')).resolves.toMatchObject({ bc_managed: true, bc_readonly: false });
    });
  });
});
