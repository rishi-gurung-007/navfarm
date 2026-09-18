import { Test, TestingModule } from '@nestjs/testing';
import { SupplierService } from './supplier.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { EncryptionService } from '../../system/encryption/encryption.service';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

describe('SupplierService', () => {
  let service: SupplierService;
  let encryptionService: EncryptionService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();
  const mockEnsureCompanySeries = jest.fn();
  const mockGenerateNext = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();
    mockEnsureCompanySeries.mockReset().mockResolvedValue(undefined);
    mockGenerateNext.mockReset().mockResolvedValue('SUP-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SupplierService,
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
    it('should reject changes to the generated supplier code', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ supplier_id: 's-1', company_id: 'comp-1', supplier_code: 'SUP-001' }]) }) }),
      });

      await expect(service.update('s-1', { supplier_code: 'SUP-099' }, 'tenant-123')).rejects.toThrow(ConflictException);
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
});
