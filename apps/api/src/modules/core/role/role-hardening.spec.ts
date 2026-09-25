import { BadRequestException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RoleService, RoleRequester } from './role.service';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';

const COMPANY = '22222222-2222-4222-8222-222222222222';

/**
 * Deleting a role used to be two un-transacted statements — drop the
 * permission rows, then drop the role. `user_role_assignment.role_id` is a
 * RESTRICT foreign key and the guard only looked at *active* assignments, so a
 * revoked (is_active = 0) assignment let the first statement commit and the
 * second fail: the role survived, stripped of every grant, and nothing was
 * audited. Re-assigning it then handed people a role that granted nothing.
 */
describe('RoleService hardening', () => {
  let selectResults: unknown[][];
  let insertedRows: any[][];
  const selectChain: any = {};
  for (const m of ['from', 'where', 'limit', 'leftJoin', 'innerJoin', 'orderBy']) selectChain[m] = () => selectChain;
  selectChain.then = (resolve: any, reject: any) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);

  const makeWriteChain = () => {
    const chain: any = {
      set: () => chain,
      where: () => chain,
      values: (rows: any) => {
        insertedRows.push(Array.isArray(rows) ? rows : [rows]);
        return chain;
      },
      then: (resolve: any, reject: any) => Promise.resolve(undefined).then(resolve, reject),
    };
    return chain;
  };

  const db: any = {
    select: jest.fn(() => selectChain),
    insert: jest.fn(() => makeWriteChain()),
    update: jest.fn(() => makeWriteChain()),
    delete: jest.fn(() => makeWriteChain()),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  let service: RoleService;
  const as = (userType: string): RoleRequester => ({ userId: 'requester-1', userType });

  beforeEach(() => {
    selectResults = [];
    insertedRows = [];
    db.insert.mockClear();
    db.update.mockClear();
    db.delete.mockClear();
    db.transaction.mockClear();
    service = new RoleService(
      { get: () => db } as unknown as ClsService,
      { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditLogService,
    );
  });

  describe('deleteRole', () => {
    const customRole = { role_id: 'role-1', role_code: 'CUSTOM', company_id: COMPANY, is_system_role: false };

    it('drops permissions and the role in one transaction so a rejected delete cannot strip the grants', async () => {
      selectResults = [[customRole], []];

      await service.deleteRole('role-1');

      expect(db.transaction).toHaveBeenCalledTimes(1);
      // Both deletes must be inside the transaction callback, not before it.
      expect(db.delete).toHaveBeenCalledTimes(2);
      const deleteCallOrder = db.delete.mock.invocationCallOrder[0];
      expect(deleteCallOrder).toBeGreaterThan(db.transaction.mock.invocationCallOrder[0]);
    });

    it('refuses while any assignment still references the role, revoked ones included', async () => {
      selectResults = [[customRole], [{ assign_id: 'a-1', role_id: 'role-1', is_active: false }]];

      await expect(service.deleteRole('role-1')).rejects.toThrow(BadRequestException);
      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  describe('updateRole', () => {
    const systemRole = { role_id: 'role-1', role_code: 'OPERATOR', company_id: COMPANY, is_system_role: true };

    it('refuses to deactivate a system role', async () => {
      selectResults = [[systemRole]];

      await expect(service.updateRole('role-1', { isActive: false })).rejects.toThrow(BadRequestException);
      expect(db.update).not.toHaveBeenCalled();
    });
  });

  describe('updateRolePermissions', () => {
    const customRole = { role_id: 'role-1', role_code: 'CUSTOM', company_id: COMPANY, is_system_role: false };

    it('stores only grants that actually allow something', async () => {
      selectResults = [[customRole], [], []];

      await service.updateRolePermissions('role-1', as('TENANT_ADMIN'), [
        { module_code: 'MASTER_DATA', resource: 'SPECIES', can_view: true },
        { module_code: 'MASTER_DATA', resource: 'UOM' },
        { module_code: 'PRODUCTION', resource: 'BATCH', can_view: false, can_edit: false },
      ]);

      const written = insertedRows.flat();
      expect(written).toHaveLength(1);
      expect(written[0]).toMatchObject({ module_code: 'MASTER_DATA', resource: 'SPECIES', can_view: true });
    });

    it('writes nothing when every grant is empty', async () => {
      selectResults = [[customRole], [], []];

      await service.updateRolePermissions('role-1', as('TENANT_ADMIN'), [
        { module_code: 'MASTER_DATA', resource: 'SPECIES' },
      ]);

      expect(insertedRows.flat()).toHaveLength(0);
    });
  });
});

/**
 * The column widths are varchar(50) and varchar(100); without a length rule a
 * long code reached MySQL and came back as a 500 under STRICT_TRANS_TABLES —
 * and on a non-strict server it would have been silently truncated, which for
 * role_code is a uniqueness key.
 */
describe('role DTO validation', () => {
  const errorsFor = async (cls: any, payload: Record<string, unknown>) => {
    const errors = await validate(plainToInstance(cls, payload, { enableImplicitConversion: true }));
    return errors.flatMap((e) => Object.keys(e.constraints ?? {}).map((c) => `${e.property}:${c}`));
  };

  const validCreate = { companyId: COMPANY, roleCode: 'SUPERVISOR', roleName: 'Supervisor' };

  it('accepts a sane create payload', async () => {
    expect(await errorsFor(CreateRoleDto, validCreate)).toEqual([]);
  });

  it('rejects a role code longer than the column', async () => {
    const found = await errorsFor(CreateRoleDto, { ...validCreate, roleCode: 'A'.repeat(51) });
    expect(found).toContain('roleCode:maxLength');
  });

  it('rejects a role name longer than the column', async () => {
    const found = await errorsFor(CreateRoleDto, { ...validCreate, roleName: 'A'.repeat(101) });
    expect(found).toContain('roleName:maxLength');
  });

  it('rejects renaming a role to the empty string', async () => {
    const found = await errorsFor(UpdateRoleDto, { roleName: '' });
    expect(found).toContain('roleName:isNotEmpty');
  });

  it("reads the string \"false\" as false, never as activation", async () => {
    const dto = plainToInstance(UpdateRoleDto, { isActive: 'false' }, { enableImplicitConversion: true });
    expect(dto.isActive).toBe(false);
    expect(await validate(dto)).toEqual([]);
    const on = plainToInstance(UpdateRoleDto, { isActive: 'true' }, { enableImplicitConversion: true });
    expect(on.isActive).toBe(true);
    const junk = plainToInstance(UpdateRoleDto, { isActive: 'maybe' }, { enableImplicitConversion: true });
    expect((await validate(junk)).length).toBeGreaterThan(0);
  });
});

/**
 * An audit probe that called the service directly inserted a permission row
 * with no module_code and MySQL answered ER_NO_DEFAULT_FOR_FIELD (a 500). Over
 * HTTP the global ValidationPipe must stop that item before the service runs.
 */
describe('permission items through the global ValidationPipe', () => {
  const { ValidationPipe } = require('@nestjs/common');
  const { UpdatePermissionsDto } = require('./dto/role.dto');
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });
  const run = (body: unknown) => pipe.transform(body, { type: 'body', metatype: UpdatePermissionsDto });

  it('rejects an item without module_code', async () => {
    await expect(run({ permissions: [{ resource: 'SPECIES', can_view: true }] })).rejects.toThrow(BadRequestException);
  });

  it('rejects an item whose flag is not a boolean', async () => {
    await expect(run({ permissions: [{ module_code: 'MASTER_DATA', resource: 'SPECIES', can_view: 'yes' }] })).rejects.toThrow(BadRequestException);
  });

  it('accepts a well-formed item', async () => {
    await expect(run({ permissions: [{ module_code: 'MASTER_DATA', resource: 'SPECIES', can_view: true }] })).resolves.toBeDefined();
  });
});
