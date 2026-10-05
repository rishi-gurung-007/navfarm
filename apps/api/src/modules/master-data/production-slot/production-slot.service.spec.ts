import { BadRequestException, ConflictException } from '@nestjs/common';
import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { transactionCls } from '../../../test-utils/transaction-cls';
import { ProductionSlotService, productionSlotWindow } from './production-slot.service';

describe('ProductionSlotService', () => {
  const selectQueue: unknown[][] = [];
  const conditions: unknown[] = [];
  const chain = (rows: unknown[]) => {
    let condition: unknown;
    const self: any = {
      from: () => self,
      where: (next: unknown) => { condition = next; conditions.push(next); return self; },
      orderBy: () => self,
      offset: () => self,
      limit: () => self,
      then: (resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(rows).then(resolve, reject),
    };
    return self;
  };
  const values = jest.fn(async () => undefined);
  const set = jest.fn(() => ({ where: jest.fn(async () => undefined) }));
  const db: any = {
    select: jest.fn(() => chain(selectQueue.shift() ?? [])),
    insert: jest.fn(() => ({ values })),
    update: jest.fn(() => ({ set })),
  };
  const audit = { log: jest.fn(async () => undefined) };
  const service = new (ProductionSlotService as any)(transactionCls(db), audit);

  beforeEach(() => {
    selectQueue.length = 0;
    conditions.length = 0;
    jest.clearAllMocks();
  });

  it('uses Production Date as the start date for an ordinary slot', () => {
    expect(productionSlotWindow('2026-10-05', '06:00:00', '14:00:00')).toEqual({
      starts_at: '2026-10-05 06:00:00',
      ends_at: '2026-10-05 14:00:00',
      crosses_midnight: false,
    });
  });

  it('ends on the next date when End Time is earlier than or equal to Start Time', () => {
    expect(productionSlotWindow('2026-10-05', '22:00:00', '06:00:00')).toEqual({
      starts_at: '2026-10-05 22:00:00',
      ends_at: '2026-10-06 06:00:00',
      crosses_midnight: true,
    });
    expect(productionSlotWindow('2026-10-05', '08:00:00', '08:00:00').ends_at)
      .toBe('2026-10-06 08:00:00');
  });

  it('requires Code, Name, Start Time, End Time and company scope', async () => {
    await expect(service.create({ slot_code: '', slot_name: '', start_time: '', end_time: '' }, 'tenant-1'))
      .rejects.toThrow(BadRequestException);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('normalizes Code and refuses a duplicate only in the same tenant/company scope', async () => {
    selectQueue.push([{ slot_id: 'slot-existing', slot_code: 'AM' }]);
    await expect(service.create({
      company_id: 'co-1', slot_code: ' am ', slot_name: 'Morning', start_time: '06:00', end_time: '14:00',
    }, 'tenant-1')).rejects.toThrow(ConflictException);

    const sql = new MySqlDialect().sqlToQuery(conditions[0] as any);
    expect(sql.sql).toMatch(/`tenant_id` = .*`company_id` = .*`slot_code` =/);
    expect(sql.params).toEqual(['tenant-1', 'co-1', 'AM']);
  });

  it('creates a slot in the requested company without inventing any slot defaults', async () => {
    selectQueue.push([], [{
      slot_id: 'slot-1', tenant_id: 'tenant-1', company_id: 'co-2', slot_code: 'NIGHT', slot_name: 'Night',
      start_time: '22:00:00', end_time: '06:00:00', is_active: true, status: 'ACTIVE',
    }]);
    const result = await service.create({
      company_id: 'co-2', slot_code: ' night ', slot_name: 'Night', start_time: '22:00', end_time: '06:00',
    }, 'tenant-1', { userId: 'user-1' });

    expect(values).toHaveBeenCalledWith(expect.objectContaining({
      tenant_id: 'tenant-1', company_id: 'co-2', slot_code: 'NIGHT', slot_name: 'Night',
      start_time: '22:00:00', end_time: '06:00:00', is_active: true, status: 'ACTIVE',
    }));
    expect(result.company_id).toBe('co-2');
  });

  it('filters active slots inside the exact company workspace', async () => {
    selectQueue.push([]);
    await service.findAll({ companyId: 'co-2', isActive: true }, 'tenant-1');
    const sql = new MySqlDialect().sqlToQuery(conditions[0] as any);
    expect(sql.sql).toMatch(/`tenant_id` = .*`company_id` = .*`is_active` =/);
    expect(sql.params).toEqual(['tenant-1', 'co-2', true]);
  });
});
