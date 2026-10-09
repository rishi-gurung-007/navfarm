import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { InventoryLedgerService } from '../../inventory/inventory-ledger/inventory-ledger.service';
import { assertAssignmentCompatibility } from './bin-diet-assignment.rules';
import { MasterScope, masterScopeConditions } from '../../../common/master-data-scope';
import { QueryBinDietAssignmentDto, UpdateBinDietAssignmentDto } from './dto/bin-diet-assignment.dto';

export interface CreateBinDietAssignment {
  company_id?: string;
  bin_location_id: string;
  feed_item_id: string;
  production_date: string;
  production_slot_id: string;
  diet_priority: number;
}

@Injectable()
export class BinDietAssignmentService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
    private readonly ledger: InventoryLedgerService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private companyOf(requested?: string | null): string {
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    const companyId = scope?.kind ? scope.companyId : requested;
    if (!companyId) throw new BadRequestException('Company is required for a BIN Diet Assignment.');
    return companyId;
  }

  private selection() {
    return {
      assignment_id: schema.binDietAssignment.assignment_id,
      tenant_id: schema.binDietAssignment.tenant_id,
      company_id: schema.binDietAssignment.company_id,
      bin_location_id: schema.binDietAssignment.bin_location_id,
      bin_code: schema.locationMaster.location_code,
      bin_name: schema.locationMaster.location_name,
      feed_item_id: schema.binDietAssignment.feed_item_id,
      feed_item_no: schema.itemMaster.item_code,
      feed_item_description: schema.itemMaster.item_name,
      production_date: schema.binDietAssignment.production_date,
      production_slot_id: schema.binDietAssignment.production_slot_id,
      slot_code: schema.productionSlotMaster.slot_code,
      slot_name: schema.productionSlotMaster.slot_name,
      diet_priority: schema.binDietAssignment.diet_priority,
      is_active: schema.binDietAssignment.is_active,
      status: schema.binDietAssignment.status,
      created_at: schema.binDietAssignment.created_at,
      updated_at: schema.binDietAssignment.updated_at,
      deleted_at: schema.binDietAssignment.deleted_at,
    };
  }

  private joinedQuery() {
    return this.db.select(this.selection()).from(schema.binDietAssignment)
      .innerJoin(schema.locationMaster, eq(schema.binDietAssignment.bin_location_id, schema.locationMaster.location_id))
      .innerJoin(schema.itemMaster, eq(schema.binDietAssignment.feed_item_id, schema.itemMaster.item_id))
      .innerJoin(schema.productionSlotMaster, eq(schema.binDietAssignment.production_slot_id, schema.productionSlotMaster.slot_id));
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.joinedQuery().where(and(
      eq(schema.binDietAssignment.assignment_id, id),
      eq(schema.binDietAssignment.tenant_id, tenantId),
      ...masterScopeConditions(this.cls, schema.binDietAssignment),
    )).limit(1);
    if (!row) throw new NotFoundException('BIN Diet Assignment is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryBinDietAssignmentDto, tenantId: string) {
    const conditions = [
      eq(schema.binDietAssignment.tenant_id, tenantId),
      ...masterScopeConditions(this.cls, schema.binDietAssignment, query.companyId),
    ];
    if (query.isActive !== undefined) conditions.push(eq(schema.binDietAssignment.is_active, query.isActive));
    if (query.filter) {
      const needle = `%${query.filter}%`;
      conditions.push(sql`(${schema.locationMaster.location_code} LIKE ${needle} OR ${schema.itemMaster.item_code} LIKE ${needle} OR ${schema.itemMaster.item_name} LIKE ${needle} OR ${schema.productionSlotMaster.slot_code} LIKE ${needle})` as any);
    }
    return this.joinedQuery().where(and(...conditions))
      .orderBy(asc(schema.binDietAssignment.production_date), asc(schema.productionSlotMaster.start_time), asc(schema.locationMaster.location_code))
      .limit(query.limit || 50).offset(query.offset || 0);
  }

  async create(dto: CreateBinDietAssignment, tenantId: string, user?: { userId?: string }) {
    const companyId = this.companyOf(dto.company_id);
    if (!Number.isInteger(dto.diet_priority) || dto.diet_priority < 1) {
      throw new BadRequestException('Diet Priority must be a positive whole number.');
    }

    const [bin] = await this.db.select().from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, dto.bin_location_id),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, companyId),
      isNull(schema.locationMaster.deleted_at),
    )).limit(1);
    if (!bin) throw new NotFoundException('The selected BIN is not available in this company.');

    const [item] = await this.db.select().from(schema.itemMaster).where(and(
      eq(schema.itemMaster.item_id, dto.feed_item_id),
      eq(schema.itemMaster.tenant_id, tenantId),
      eq(schema.itemMaster.company_id, companyId),
      isNull(schema.itemMaster.deleted_at),
    )).limit(1);
    if (!item) throw new NotFoundException('The selected Feed Item is not available in this company.');

    const [itemType] = await this.db.select().from(schema.itemTypeMaster).where(and(
      eq(schema.itemTypeMaster.tenant_id, tenantId),
      eq(schema.itemTypeMaster.type_code, item.item_type),
      eq(schema.itemTypeMaster.is_active, true),
      isNull(schema.itemTypeMaster.deleted_at),
    )).limit(1);

    const [slot] = await this.db.select().from(schema.productionSlotMaster).where(and(
      eq(schema.productionSlotMaster.slot_id, dto.production_slot_id),
      eq(schema.productionSlotMaster.tenant_id, tenantId),
      eq(schema.productionSlotMaster.company_id, companyId),
      eq(schema.productionSlotMaster.is_active, true),
      isNull(schema.productionSlotMaster.deleted_at),
    )).limit(1);
    if (!slot) throw new NotFoundException('The selected Production Slot is not active in this company.');

    assertAssignmentCompatibility(bin, {
      ...item,
      item_type_name: itemType?.type_name ?? null,
    });

    const duplicates = await this.db.select({ assignment_id: schema.binDietAssignment.assignment_id })
      .from(schema.binDietAssignment).where(and(
        eq(schema.binDietAssignment.tenant_id, tenantId),
        eq(schema.binDietAssignment.company_id, companyId),
        eq(schema.binDietAssignment.bin_location_id, dto.bin_location_id),
        eq(schema.binDietAssignment.production_date, dto.production_date),
        eq(schema.binDietAssignment.production_slot_id, dto.production_slot_id),
        isNull(schema.binDietAssignment.deleted_at),
      ));
    if (duplicates.length) {
      throw new ConflictException('This BIN already has a diet assignment for the selected Production Date and Slot.');
    }

    const balances = await this.ledger.getStockBalance({
      companyId,
      warehouseId: dto.bin_location_id,
    }, tenantId);
    const incompatible = balances.find((row) => row.item_id !== dto.feed_item_id && Number(row.on_hand_qty) > 0);
    if (incompatible) {
      throw new ConflictException(
        `BIN ${bin.location_code} still holds ${Number(incompatible.on_hand_qty).toLocaleString('en-US')} KG of ${incompatible.item_code}; clear that stock before assigning another diet.`,
      );
    }

    const assignmentId = randomUUID();
    const row = {
      assignment_id: assignmentId,
      tenant_id: tenantId,
      company_id: companyId,
      bin_location_id: dto.bin_location_id,
      feed_item_id: dto.feed_item_id,
      production_date: dto.production_date,
      production_slot_id: dto.production_slot_id,
      diet_priority: dto.diet_priority,
      is_active: true,
      status: 'ACTIVE',
      created_by: user?.userId,
      updated_by: user?.userId,
    };
    await this.db.insert(schema.binDietAssignment).values(row);
    await this.audit.log({
      tenantId,
      companyId,
      userId: user?.userId,
      action: 'CREATE',
      entityName: 'bin_diet_assignment',
      entityId: assignmentId,
      newValues: row,
    });
    return this.findOne(assignmentId, tenantId);
  }

  async update(id: string, dto: UpdateBinDietAssignmentDto, tenantId: string, user?: { userId?: string }) {
    const before = await this.findOne(id, tenantId);
    const next = {
      company_id: before.company_id,
      bin_location_id: dto.bin_location_id ?? before.bin_location_id,
      feed_item_id: dto.feed_item_id ?? before.feed_item_id,
      production_date: dto.production_date ?? before.production_date,
      production_slot_id: dto.production_slot_id ?? before.production_slot_id,
      diet_priority: dto.diet_priority ?? before.diet_priority,
    };
    if (!Number.isInteger(next.diet_priority) || next.diet_priority < 1) {
      throw new BadRequestException('Diet Priority must be a positive whole number.');
    }
    const [bin] = await this.db.select().from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, next.bin_location_id), eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.company_id, next.company_id), isNull(schema.locationMaster.deleted_at),
    )).limit(1);
    const [item] = await this.db.select().from(schema.itemMaster).where(and(
      eq(schema.itemMaster.item_id, next.feed_item_id), eq(schema.itemMaster.tenant_id, tenantId),
      eq(schema.itemMaster.company_id, next.company_id), isNull(schema.itemMaster.deleted_at),
    )).limit(1);
    const [itemType] = item ? await this.db.select().from(schema.itemTypeMaster).where(and(
      eq(schema.itemTypeMaster.tenant_id, tenantId), eq(schema.itemTypeMaster.type_code, item.item_type),
      eq(schema.itemTypeMaster.is_active, true), isNull(schema.itemTypeMaster.deleted_at),
    )).limit(1) : [];
    const [slot] = await this.db.select().from(schema.productionSlotMaster).where(and(
      eq(schema.productionSlotMaster.slot_id, next.production_slot_id), eq(schema.productionSlotMaster.tenant_id, tenantId),
      eq(schema.productionSlotMaster.company_id, next.company_id), eq(schema.productionSlotMaster.is_active, true),
      isNull(schema.productionSlotMaster.deleted_at),
    )).limit(1);
    if (!bin || !item || !slot) throw new BadRequestException('The selected BIN, Feed Item and Production Slot must be active in this company.');
    assertAssignmentCompatibility(bin, { ...item, item_type_name: itemType?.type_name ?? null });
    const duplicates = await this.db.select({ assignment_id: schema.binDietAssignment.assignment_id }).from(schema.binDietAssignment).where(and(
      eq(schema.binDietAssignment.tenant_id, tenantId), eq(schema.binDietAssignment.company_id, next.company_id),
      eq(schema.binDietAssignment.bin_location_id, next.bin_location_id), eq(schema.binDietAssignment.production_date, next.production_date),
      eq(schema.binDietAssignment.production_slot_id, next.production_slot_id), isNull(schema.binDietAssignment.deleted_at),
    ));
    if (duplicates.some((row) => row.assignment_id !== id)) throw new ConflictException('This BIN already has a diet assignment for the selected Production Date and Slot.');
    if (next.feed_item_id !== before.feed_item_id || next.bin_location_id !== before.bin_location_id) {
      const balances = await this.ledger.getStockBalance({ companyId: next.company_id, warehouseId: next.bin_location_id }, tenantId);
      const incompatible = balances.find((row) => row.item_id !== next.feed_item_id && Number(row.on_hand_qty) > 0);
      if (incompatible) throw new ConflictException(`BIN ${bin.location_code} still holds ${Number(incompatible.on_hand_qty).toLocaleString('en-US')} KG of ${incompatible.item_code}; clear that stock before assigning another diet.`);
    }
    const updates = {
      ...next,
      ...(dto.is_active === undefined ? {} : { is_active: dto.is_active, status: dto.is_active ? 'ACTIVE' : 'INACTIVE' }),
      updated_by: user?.userId,
      updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    };
    await this.db.update(schema.binDietAssignment).set(updates).where(eq(schema.binDietAssignment.assignment_id, id));
    await this.audit.log({ tenantId, companyId: next.company_id, userId: user?.userId, action: 'UPDATE', entityName: 'bin_diet_assignment', entityId: id, oldValues: before, newValues: updates });
    return this.findOne(id, tenantId);
  }

  async deactivate(id: string, tenantId: string, user?: { userId?: string }) {
    return this.setActive(id, false, tenantId, user);
  }

  async restore(id: string, tenantId: string, user?: { userId?: string }) {
    return this.setActive(id, true, tenantId, user);
  }

  private async setActive(id: string, active: boolean, tenantId: string, user?: { userId?: string }) {
    const before = await this.findOne(id, tenantId);
    const updates = { is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: null, updated_by: user?.userId, updated_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    await this.db.update(schema.binDietAssignment).set(updates).where(eq(schema.binDietAssignment.assignment_id, id));
    await this.audit.log({ tenantId, companyId: before.company_id, userId: user?.userId, action: active ? 'RESTORE' : 'DEACTIVATE', entityName: 'bin_diet_assignment', entityId: id, oldValues: before, newValues: updates });
    return { ...before, ...updates };
  }

  async findNextBinAssignment(args: { tenantId: string; companyId: string; itemId: string; from: string }) {
    const [row] = await this.db.select({
      assignment_id: schema.binDietAssignment.assignment_id,
      bin_location_id: schema.binDietAssignment.bin_location_id,
      bin_code: schema.locationMaster.location_code,
      bin_name: schema.locationMaster.location_name,
      production_date: schema.binDietAssignment.production_date,
      production_slot_id: schema.binDietAssignment.production_slot_id,
      slot_code: schema.productionSlotMaster.slot_code,
      slot_name: schema.productionSlotMaster.slot_name,
      start_time: schema.productionSlotMaster.start_time,
      feed_item_id: schema.binDietAssignment.feed_item_id,
      diet_priority: schema.binDietAssignment.diet_priority,
    }).from(schema.binDietAssignment)
      .innerJoin(schema.locationMaster, eq(schema.binDietAssignment.bin_location_id, schema.locationMaster.location_id))
      .innerJoin(schema.productionSlotMaster, eq(schema.binDietAssignment.production_slot_id, schema.productionSlotMaster.slot_id))
      .where(and(
        eq(schema.binDietAssignment.tenant_id, args.tenantId),
        eq(schema.binDietAssignment.company_id, args.companyId),
        eq(schema.binDietAssignment.feed_item_id, args.itemId),
        eq(schema.binDietAssignment.is_active, true),
        gte(schema.binDietAssignment.production_date, args.from),
        isNull(schema.binDietAssignment.deleted_at),
      ))
      .orderBy(
        asc(schema.binDietAssignment.production_date),
        asc(schema.productionSlotMaster.start_time),
        asc(schema.locationMaster.location_code),
      ).limit(1);

    if (!row) return null;
    return {
      assignmentId: row.assignment_id,
      binId: row.bin_location_id,
      binCode: row.bin_code,
      binName: row.bin_name,
      productionDate: row.production_date,
      slotId: row.production_slot_id,
      slotCode: row.slot_code,
      slotName: row.slot_name,
      feedItemId: row.feed_item_id,
      dietPriority: row.diet_priority,
    };
  }
}
