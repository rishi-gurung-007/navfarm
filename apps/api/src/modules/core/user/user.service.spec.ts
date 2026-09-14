import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UserService, RequestingUser } from './user.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UserDirectoryService } from '../../../core/database/user-directory.service';

const TENANT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const FARM = '44444444-4444-4444-8444-444444444444';

describe('UserService user-type hierarchy', () => {
  // Every select resolves the next queued row set; writes resolve nothing.
  let selectResults: unknown[][];
  const set = jest.fn();
  const values = jest.fn();
  const selectChain: any = {};
  for (const m of ['from', 'where', 'limit', 'innerJoin', 'offset']) selectChain[m] = () => selectChain;
  selectChain.then = (resolve: any, reject: any) => Promise.resolve(selectResults.shift() ?? []).then(resolve, reject);
  const writeChain: any = {
    set: (v: unknown) => { set(v); return writeChain; },
    values: (v: unknown) => { values(v); return writeChain; },
    where: () => writeChain,
    then: (resolve: any, reject: any) => Promise.resolve(undefined).then(resolve, reject),
  };
  const db: any = {
    select: jest.fn(() => selectChain),
    insert: jest.fn(() => writeChain),
    update: jest.fn(() => writeChain),
    transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  };

  let service: UserService;

  const requester = (userType: string, userId = 'requester-1'): RequestingUser => ({ userId, tenantId: TENANT, userType });
  const target = (user_type: string, user_id = 'target-1') => ({ user_id, user_type, tenant_id: TENANT, company_id: COMPANY, is_active: true });
  /** findById does two selects: the user row, then its roles. */
  const queueUser = (row: object) => selectResults.push([row], []);

  const createDto = (user_type?: string): CreateUserDto => ({
    company_id: COMPANY,
    tenant_id: TENANT,
    full_name: 'New User',
    email: 'new.user@example.test',
    password: 'longenough1',
    ...(!user_type || user_type === 'STANDARD_USER' ? { farm_id: FARM } : {}),
    ...(user_type ? { user_type } : {}),
  });

  beforeEach(() => {
    selectResults = [];
    set.mockReset();
    values.mockReset();
    db.select.mockClear();
    db.update.mockClear();
    service = new UserService(
      { get: () => db } as unknown as ClsService,
      { index: jest.fn().mockResolvedValue(undefined) } as unknown as UserDirectoryService,
    );
  });

  describe('DTO', () => {
    it('rejects a user_type outside the five known types', async () => {
      const create = await validate(plainToInstance(CreateUserDto, { ...createDto(), user_type: 'SUPERUSER' }));
      expect(create.map((e) => e.property)).toContain('user_type');
      const update = await validate(plainToInstance(UpdateUserDto, { user_type: 'STAFF' }));
      expect(update.map((e) => e.property)).toContain('user_type');
    });

    it('accepts a known user_type', async () => {
      const errors = await validate(plainToInstance(UpdateUserDto, { user_type: 'OPERATIONAL_ADMIN' }));
      expect(errors).toHaveLength(0);
    });
  });

  describe('create', () => {
    it.each(['TENANT_ADMIN', 'SYSTEM_ADMIN', 'COMPANY_ADMIN'])('forbids a COMPANY_ADMIN from creating a %s', async (type) => {
      await expect(service.create(createDto(type), requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(db.select).not.toHaveBeenCalled();
    });

    it('forbids a TENANT_ADMIN from creating a SYSTEM_ADMIN or another TENANT_ADMIN', async () => {
      await expect(service.create(createDto('SYSTEM_ADMIN'), requester('TENANT_ADMIN'))).rejects.toThrow(ForbiddenException);
      await expect(service.create(createDto('TENANT_ADMIN'), requester('TENANT_ADMIN'))).rejects.toThrow(ForbiddenException);
    });

    it.each(['OPERATIONAL_ADMIN', 'STANDARD_USER'])('lets a COMPANY_ADMIN create a %s', async (type) => {
      if (type === 'STANDARD_USER') selectResults.push([{ location_id: FARM }]);
      selectResults.push([]); // no existing email
      queueUser(target(type, 'created'));
      await expect(service.create(createDto(type), requester('COMPANY_ADMIN'))).resolves.toMatchObject({ user_type: type });
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ user_type: type }));
    });

    it('defaults an omitted user_type to STANDARD_USER, not the legacy STAFF', async () => {
      selectResults.push([{ location_id: FARM }]);
      selectResults.push([]);
      queueUser(target('STANDARD_USER', 'created'));
      await service.create(createDto(), requester('OPERATIONAL_ADMIN'));
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ user_type: 'STANDARD_USER' }));
    });

    it('forbids a STANDARD_USER from creating anyone', async () => {
      await expect(service.create(createDto('STANDARD_USER'), requester('STANDARD_USER'))).rejects.toThrow(ForbiddenException);
    });

    it('forbids creating a user in another tenant', async () => {
      const dto = { ...createDto('STANDARD_USER'), tenant_id: '33333333-3333-4333-8333-333333333333' };
      await expect(service.create(dto, requester('TENANT_ADMIN'))).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update', () => {
    it('forbids a COMPANY_ADMIN from promoting themselves', async () => {
      queueUser(target('COMPANY_ADMIN', 'requester-1'));
      await expect(service.update('requester-1', { user_type: 'TENANT_ADMIN' }, requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(set).not.toHaveBeenCalled();
    });

    it('still lets a user edit their own profile when the form echoes their unchanged type', async () => {
      queueUser(target('COMPANY_ADMIN', 'requester-1'));
      queueUser(target('COMPANY_ADMIN', 'requester-1'));
      await service.update('requester-1', { full_name: 'Renamed', user_type: 'COMPANY_ADMIN' }, requester('COMPANY_ADMIN'));
      expect(set).toHaveBeenCalledWith({ full_name: 'Renamed' });
    });

    it('forbids a COMPANY_ADMIN from editing a TENANT_ADMIN', async () => {
      queueUser(target('TENANT_ADMIN'));
      await expect(service.update('target-1', { full_name: 'x' }, requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(set).not.toHaveBeenCalled();
    });

    it('forbids a COMPANY_ADMIN from deactivating a TENANT_ADMIN', async () => {
      queueUser(target('TENANT_ADMIN'));
      await expect(service.update('target-1', { is_active: false }, requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(set).not.toHaveBeenCalled();
    });

    it('forbids a COMPANY_ADMIN from editing a peer COMPANY_ADMIN', async () => {
      queueUser(target('COMPANY_ADMIN'));
      await expect(service.update('target-1', { full_name: 'x' }, requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
    });

    it('forbids a COMPANY_ADMIN from promoting a STANDARD_USER above OPERATIONAL_ADMIN', async () => {
      queueUser(target('STANDARD_USER'));
      await expect(service.update('target-1', { user_type: 'COMPANY_ADMIN' }, requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(set).not.toHaveBeenCalled();
    });

    it('lets a COMPANY_ADMIN move a STANDARD_USER to OPERATIONAL_ADMIN', async () => {
      queueUser(target('STANDARD_USER'));
      queueUser(target('OPERATIONAL_ADMIN'));
      await service.update('target-1', { user_type: 'OPERATIONAL_ADMIN' }, requester('COMPANY_ADMIN'));
      expect(set).toHaveBeenCalledWith({ user_type: 'OPERATIONAL_ADMIN' });
    });

    it('lets a TENANT_ADMIN deactivate a COMPANY_ADMIN', async () => {
      queueUser(target('COMPANY_ADMIN'));
      queueUser(target('COMPANY_ADMIN'));
      await service.update('target-1', { is_active: false }, requester('TENANT_ADMIN'));
      expect(set).toHaveBeenCalledWith({ is_active: false });
    });

    it('still refuses self-deactivation', async () => {
      queueUser(target('TENANT_ADMIN', 'requester-1'));
      await expect(service.update('requester-1', { is_active: false }, requester('TENANT_ADMIN'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('remove', () => {
    it('forbids a COMPANY_ADMIN from deleting a TENANT_ADMIN', async () => {
      queueUser(target('TENANT_ADMIN'));
      await expect(service.remove('target-1', requester('COMPANY_ADMIN'))).rejects.toThrow(ForbiddenException);
      expect(db.update).not.toHaveBeenCalled();
    });

    it('lets a COMPANY_ADMIN delete a STANDARD_USER', async () => {
      queueUser(target('STANDARD_USER'));
      await expect(service.remove('target-1', requester('COMPANY_ADMIN'))).resolves.toEqual({ deleted: true, user_id: 'target-1' });
    });
  });
});
