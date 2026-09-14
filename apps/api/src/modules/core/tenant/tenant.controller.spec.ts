import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

describe('TenantController tenant read scoping', () => {
  const own = { tenant_id: 'tenant-own', tenant_code: 'own', plan_id: 'PLAN' };
  const other = { tenant_id: 'tenant-other', tenant_code: 'other', plan_id: 'PLAN' };
  const findOne = jest.fn();
  const findByCode = jest.fn();
  let controller: TenantController;

  const req = (userType: string) => ({ user: { userId: 'user-1', userType, tenantId: 'tenant-own', companyId: 'company-1' } });

  beforeEach(() => {
    findOne.mockReset();
    findByCode.mockReset();
    controller = new TenantController({ findOne, findByCode } as unknown as TenantService);
  });

  describe('GET /tenant/:id', () => {
    it('lets an ordinary user read their own tenant', async () => {
      findOne.mockResolvedValue(own);
      await expect(controller.findOne('tenant-own', req('STANDARD_USER'))).resolves.toBe(own);
    });

    it.each(['STANDARD_USER', 'COMPANY_ADMIN', 'TENANT_ADMIN'])('forbids a %s from reading another tenant', async (type) => {
      await expect(controller.findOne('tenant-other', req(type))).rejects.toThrow(ForbiddenException);
      expect(findOne).not.toHaveBeenCalled();
    });

    it('lets a SYSTEM_ADMIN read any tenant', async () => {
      findOne.mockResolvedValue(other);
      await expect(controller.findOne('tenant-other', req('SYSTEM_ADMIN'))).resolves.toBe(other);
    });
  });

  describe('GET /tenant/code/:code', () => {
    it('lets an ordinary user read their own tenant by code', async () => {
      findByCode.mockResolvedValue(own);
      await expect(controller.findByCode('own', req('STANDARD_USER'))).resolves.toBe(own);
    });

    it('forbids reading another tenant by code', async () => {
      findByCode.mockResolvedValue(other);
      await expect(controller.findByCode('other', req('TENANT_ADMIN'))).rejects.toThrow(ForbiddenException);
    });

    // A distinct 404 would tell any logged-in user which tenant codes exist.
    it('answers an unknown code with the same 403 as a foreign one', async () => {
      findByCode.mockRejectedValue(new NotFoundException('nope'));
      await expect(controller.findByCode('missing', req('STANDARD_USER'))).rejects.toThrow(ForbiddenException);
    });

    it('still gives a SYSTEM_ADMIN the real 404', async () => {
      findByCode.mockRejectedValue(new NotFoundException('nope'));
      await expect(controller.findByCode('missing', req('SYSTEM_ADMIN'))).rejects.toThrow(NotFoundException);
    });
  });
});
