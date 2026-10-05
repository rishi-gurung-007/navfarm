import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import * as schema from '../../../core/database/schema';
import { MasterScope, masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';
import { CreateProductionSlotDto, QueryProductionSlotDto, UpdateProductionSlotDto } from './dto/production-slot.dto';

const table = schema.productionSlotMaster;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

function normalizeTime(value: string): string {
  const trimmed = value.trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(trimmed)) {
    throw new BadRequestException('Start Time and End Time must use HH:mm or HH:mm:ss.');
  }
  return trimmed.length === 5 ? `${trimmed}:00` : trimmed;
}

function nextDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw new BadRequestException('Production Date must be a valid date.');
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

function assertDate(date: string): void {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new BadRequestException('Production Date must be a valid date.');
  }
}

/** Production Date is the calendar date on which the configured slot starts. */
export function productionSlotWindow(productionDate: string, startTime: string, endTime: string) {
  assertDate(productionDate);
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  const crossesMidnight = end <= start;
  return {
    starts_at: `${productionDate} ${start}`,
    ends_at: `${crossesMidnight ? nextDate(productionDate) : productionDate} ${end}`,
    crosses_midnight: crossesMidnight,
  };
}

@Injectable()
export class ProductionSlotService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private companyOf(requested?: string | null): string {
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    const companyId = scope?.kind ? scope.companyId : requested;
    if (!companyId) throw new BadRequestException('Company is required for a Production Slot.');
    return companyId;
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(
      eq(table.slot_id, id), eq(table.tenant_id, tenantId),
      ...masterScopeConditions(this.cls, table),
    )).limit(1);
    if (!row) throw new NotFoundException('Production Slot is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryProductionSlotDto, tenantId: string) {
    const conditions = [
      eq(table.tenant_id, tenantId),
      ...masterScopeConditions(this.cls, table, query.companyId),
    ];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions))
      .orderBy(listOrderBy(table, { ...query, sort: query.sort ?? 'start_time' }, table.start_time))
      .limit(query.limit || 50).offset(query.offset || 0);
  }

  private shape(dto: { slot_code?: string; slot_name?: string; start_time?: string; end_time?: string }) {
    const slotCode = dto.slot_code?.trim().toUpperCase();
    const slotName = dto.slot_name?.trim();
    if (!slotCode || !slotName || !dto.start_time || !dto.end_time) {
      throw new BadRequestException('Code, Name, Start Time and End Time are required for a Production Slot.');
    }
    return {
      slot_code: slotCode,
      slot_name: slotName,
      start_time: normalizeTime(dto.start_time),
      end_time: normalizeTime(dto.end_time),
    };
  }

  private async assertCodeFree(tenantId: string, companyId: string, code: string, excludeId?: string) {
    const rows = await this.db.select({ slot_id: table.slot_id }).from(table).where(and(
      eq(table.tenant_id, tenantId), eq(table.company_id, companyId), eq(table.slot_code, code), isNull(table.deleted_at),
    ));
    if (rows.some((row) => row.slot_id !== excludeId)) {
      throw new ConflictException(`Production Slot Code '${code}' already exists for this company.`);
    }
  }

  private async log(action: string, row: typeof table.$inferSelect, user?: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id, companyId: row.company_id, userId: user?.userId,
      action, entityName: 'production_slot_master', entityId: row.slot_id, oldValues, newValues: row,
    });
    return row;
  }

  async create(dto: CreateProductionSlotDto, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto.company_id);
    const shaped = this.shape(dto);
    await this.assertCodeFree(tenantId, companyId, shaped.slot_code);
    const slotId = randomUUID();
    await this.db.insert(table).values({
      slot_id: slotId, tenant_id: tenantId, company_id: companyId, ...shaped,
      is_active: true, status: 'ACTIVE', created_by: user?.userId, updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(slotId, tenantId), user);
  }

  async update(id: string, dto: UpdateProductionSlotDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const updates: Record<string, unknown> = { updated_by: user?.userId, updated_at: nowTs() };
    if (dto.slot_name !== undefined) {
      const name = dto.slot_name.trim();
      if (!name) throw new BadRequestException('Production Slot Name is required.');
      updates.slot_name = name;
    }
    if (dto.start_time !== undefined) updates.start_time = normalizeTime(dto.start_time);
    if (dto.end_time !== undefined) updates.end_time = normalizeTime(dto.end_time);
    if (dto.is_active !== undefined && dto.status !== undefined && dto.is_active !== (dto.status === 'ACTIVE')) {
      throw new BadRequestException('Active and Status must describe the same Production Slot state.');
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
      updates.status = dto.is_active ? 'ACTIVE' : 'INACTIVE';
    } else if (dto.status !== undefined) {
      updates.status = dto.status;
      updates.is_active = dto.status === 'ACTIVE';
    }
    await this.db.update(table).set(updates).where(eq(table.slot_id, id));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async deactivate(id: string, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    await this.db.update(table).set({
      is_active: false, status: 'INACTIVE', updated_by: user?.userId, updated_at: nowTs(),
    }).where(eq(table.slot_id, id));
    return this.log('DEACTIVATE', { ...before, is_active: false, status: 'INACTIVE' }, user, before);
  }

  async restore(id: string, tenantId: string, user?: any) {
    const before = await this.db.select().from(table).where(and(
      eq(table.slot_id, id), eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table),
    )).limit(1)
      .then((rows) => rows[0]);
    if (!before) throw new NotFoundException('Production Slot is not available in this workspace.');
    await this.assertCodeFree(tenantId, before.company_id, before.slot_code, id);
    await this.db.update(table).set({
      is_active: true, status: 'ACTIVE', deleted_at: null, updated_by: user?.userId, updated_at: nowTs(),
    }).where(eq(table.slot_id, id));
    return this.log('RESTORE', { ...before, is_active: true, status: 'ACTIVE', deleted_at: null }, user, before);
  }
}
