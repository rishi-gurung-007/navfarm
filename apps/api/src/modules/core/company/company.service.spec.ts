import { Test, TestingModule } from '@nestjs/testing';
import { CompanyService } from './company.service';
import { ClsService } from 'nestjs-cls';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { MASTER_CONNECTION } from '../../../core/database/database.module';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

describe('CompanyService', () => {
  let service: CompanyService;

  const mockDbSelect = jest.fn();
  const mockDbInsert = jest.fn();
  const mockDbUpdate = jest.fn();

  const mockDb = {
    select: mockDbSelect,
    insert: mockDbInsert,
    update: mockDbUpdate,
  };

  const tenantAdmin = { userId: 'user-ta', userType: 'TENANT_ADMIN', tenantId: 'tenant-123', companyId: 'company-123' };
  const companyAdmin = { userId: 'user-ca', userType: 'COMPANY_ADMIN', tenantId: 'tenant-123', companyId: 'company-123' };
  const companyRow = { company_id: 'company-123', tenant_id: 'tenant-123', company_name: 'Company', is_active: true, deleted_at: null };
  const rows = (value: unknown[]) => ({
    from: jest.fn().mockReturnValue({
      where: jest.fn().mockReturnValue({ limit: jest.fn().mockResolvedValue(value) }),
    }),
  });
  const createDto = {
    company_code: 'GREENVALLEY',
    company_name: 'Green Valley Farms',
    company_type: 'PROPRIETORSHIP',
    industry_type: 'POULTRY',
    base_currency_id: 'curr-1',
    default_language_id: 'lang-1',
    default_timezone_id: 'UTC',
    country_id: 'IND',
  };

  beforeEach(async () => {
    mockDbSelect.mockReset();
    mockDbInsert.mockReset();
    mockDbUpdate.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CompanyService,
        {
          provide: ClsService,
          useValue: {
            get: jest.fn().mockReturnValue(mockDb),
          },
        },
        {
          provide: MASTER_CONNECTION,
          useValue: mockDb,
        },
        {
          provide: AuditLogService,
          useValue: {
            log: jest.fn().mockResolvedValue({}),
          },
        },
      ],
    }).compile();

    service = module.get<CompanyService>(CompanyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should throw ConflictException if company code or name already exists', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([{ company_code: 'GREENVALLEY' }]),
          }),
        }),
      });

      await expect(service.create(createDto, 'tenant-123', tenantAdmin)).rejects.toThrow(ConflictException);
    });

    // COMPANY_ADMIN bypasses role_permissions, so the 'create' decorator alone let it through.
    it('forbids a COMPANY_ADMIN from creating a company before touching the database', async () => {
      await expect(service.create(createDto, 'tenant-123', companyAdmin)).rejects.toThrow(ForbiddenException);
      expect(mockDbSelect).not.toHaveBeenCalled();
    });

    it('forbids a caller with no user context', async () => {
      await expect(service.create(createDto, 'tenant-123')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('remove', () => {
    it('forbids a COMPANY_ADMIN from deleting a company', async () => {
      await expect(service.remove('company-123', 'tenant-123', companyAdmin)).rejects.toThrow(ForbiddenException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('lets a TENANT_ADMIN delete a company', async () => {
      mockDbSelect.mockReturnValue(rows([companyRow]));
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) });
      await expect(service.remove('company-123', 'tenant-123', tenantAdmin)).resolves.toMatchObject({ success: true });
      expect(mockDbUpdate).toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('forbids a COMPANY_ADMIN from restoring a company', async () => {
      await expect(service.restore('company-123', 'tenant-123', companyAdmin)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    const updateReturns = () =>
      mockDbUpdate.mockReturnValue({ set: jest.fn().mockReturnValue({ where: jest.fn().mockResolvedValue(undefined) }) });

    it('lets a COMPANY_ADMIN edit their own home company', async () => {
      mockDbSelect.mockReturnValue(rows([companyRow]));
      updateReturns();
      await expect(service.update('company-123', { company_display_name: 'Shown' }, 'tenant-123', companyAdmin)).resolves.toBeDefined();
      expect(mockDbUpdate).toHaveBeenCalled();
    });

    it('forbids a COMPANY_ADMIN from editing a company they are not assigned to', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([{ ...companyRow, company_id: 'company-999' }]))
        .mockReturnValueOnce(rows([])); // no user_company_assignments row
      await expect(service.update('company-999', { company_display_name: 'x' }, 'tenant-123', companyAdmin)).rejects.toThrow(ForbiddenException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });

    it('lets a COMPANY_ADMIN edit a company they hold an active assignment to', async () => {
      mockDbSelect
        .mockReturnValueOnce(rows([{ ...companyRow, company_id: 'company-456' }]))
        .mockReturnValueOnce(rows([{ id: 'assign-1' }]))
        .mockReturnValue(rows([{ ...companyRow, company_id: 'company-456' }]));
      updateReturns();
      await expect(service.update('company-456', { company_display_name: 'x' }, 'tenant-123', companyAdmin)).resolves.toBeDefined();
    });

    it('forbids a COMPANY_ADMIN from deactivating their company through update', async () => {
      mockDbSelect.mockReturnValue(rows([companyRow]));
      await expect(service.update('company-123', { is_active: false }, 'tenant-123', companyAdmin)).rejects.toThrow(ForbiddenException);
      expect(mockDbUpdate).not.toHaveBeenCalled();
    });
  });

  describe('findOne', () => {
    it('should throw NotFoundException if company not found or soft deleted', async () => {
      mockDbSelect.mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([]),
          }),
        }),
      });

      await expect(service.findOne('company-123')).rejects.toThrow(NotFoundException);
    });
  });
});
