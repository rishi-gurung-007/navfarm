import { Test, TestingModule } from '@nestjs/testing';
import { CustomerService } from './customer.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { NumberSeriesService } from '../../system/number-series/number-series.service';

describe('CustomerService', () => {
  let service: CustomerService;

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
    mockGenerateNext.mockReset().mockResolvedValue('CUS-001');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerService,
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
            ensureCompanySeries: mockEnsureCompanySeries,
            generateNext: mockGenerateNext,
          },
        },
      ],
    }).compile();

    service = module.get<CustomerService>(CustomerService);
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
            customer_code: 'CUST01',
            customer_name: 'Customer 1',
            mobile: '+919876543210',
          },
          'tenant-123',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should create a customer with the per-company generated code', async () => {
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
              limit: jest.fn().mockResolvedValue([{ customer_code: 'CUS-001', customer_name: 'Customer 1' }]),
            }),
          }),
        });

      mockDbInsert.mockReturnValue({
        values: jest.fn().mockResolvedValue({}),
      });

      const result = await service.create(
        {
          company_id: 'comp-1',
          customer_name: 'Customer 1',
          mobile: '+919876543210',
        },
        'tenant-123',
        { userId: 'user-1' },
      );

      expect(mockDbInsert).toHaveBeenCalled();
      expect(mockEnsureCompanySeries).toHaveBeenCalledWith(
        'tenant-123',
        'comp-1',
        expect.objectContaining({ seriesCode: 'CUSTOMER', prefix: 'CUS', seqLength: 3 }),
        expect.any(Function),
      );
      expect(mockGenerateNext).toHaveBeenCalledWith('CUSTOMER', 'tenant-123', 'comp-1', undefined, expect.any(Object));
      expect(result.customer_code).toBe('CUS-001');
    });
  });

  describe('update', () => {
    it('should reject changes to the generated customer code', async () => {
      mockDbSelect.mockReturnValueOnce({
        from: jest.fn().mockReturnValue({ where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue([{ customer_id: 'c-1', company_id: 'comp-1', customer_code: 'CUS-001' }]) }) }),
      });

      await expect(service.update('c-1', { customer_code: 'CUS-099' }, 'tenant-123')).rejects.toThrow(ConflictException);
    });
  });
});
