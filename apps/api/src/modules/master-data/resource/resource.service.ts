import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, isNotNull, lte } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { 
  CreateResourceDto, 
  UpdateResourceDto, 
  QueryResourceDto,
  CreateMaintenanceLogDto,
  UpdateMaintenanceLogDto
} from './dto/resource.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

@Injectable()
export class ResourceService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  // --- Resource CRUD ---

  async create(dto: CreateResourceDto, tenantId: string, userPayload?: any) {
    // 1. Verify company exists
    if (dto.company_id) {
      const [company] = await this.db
        .select()
        .from(schema.companyMaster)
        .where(and(companyCondition(schema.companyMaster.company_id, dto.company_id), isNull(schema.companyMaster.deleted_at)))
        .limit(1);

      if (!company) {
        throw new NotFoundException(`Company with ID '${dto.company_id}' not found.`);
      }
    }

    await this.numberSeriesService.ensureCompanySeries(
      tenantId,
      dto.company_id,
      { seriesCode: 'RESOURCE', seriesName: 'Resource Code', documentType: 'RESOURCE', prefix: 'RES', seqLength: 3 },
      async () => {
        const rows = await this.db.select({ code: schema.resourceMaster.resource_code }).from(schema.resourceMaster).where(and(
          eq(schema.resourceMaster.tenant_id, tenantId),
          companyCondition(schema.resourceMaster.company_id, dto.company_id),
        ));
        return rows.map((row) => row.code);
      },
    );
    const resourceCode = dto.resource_code?.trim()
      ? await this.numberSeriesService.manualCode('RESOURCE', dto.resource_code, tenantId, dto.company_id)
      : await this.numberSeriesService.generateNext('RESOURCE', tenantId, dto.company_id, undefined, dto as unknown as Record<string, unknown>);

    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). resource_master.nob_id/lob_id are nullable, so an ambiguous
    // company simply stores null rather than blocking the create.
    const resolvedNobLob = await this.nobLobResolution.resolve(tenantId, dto.company_id, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });

    const resourceId = randomUUID();
    const newResource = {
      resource_id: resourceId,
      tenant_id: tenantId,
      company_id: dto.company_id || null,
      nob_id: resolvedNobLob.nob_id,
      lob_id: resolvedNobLob.lob_id,
      resource_code: resourceCode,
      resource_name: dto.resource_name,
      resource_type: dto.resource_type,
      resource_sub_type: dto.resource_sub_type || null,
      employee_id: dto.employee_id || null,
      designation: dto.designation || null,
      capacity: dto.capacity?.toString() || null,
      capacity_uom: dto.capacity_uom || null,
      unit: dto.unit || null,
      cost_rate: dto.cost_rate?.toString() || null,
      asset_code: dto.asset_code || null,
      asset_make: dto.asset_make || null,
      asset_model: dto.asset_model || null,
      asset_serial_no: dto.asset_serial_no || null,
      purchase_date: dto.purchase_date || null,
      warranty_expiry_date: dto.warranty_expiry_date || null,
      maintenance_frequency_days: dto.maintenance_frequency_days ?? null,
      maintenance_cost_per_service: dto.maintenance_cost_per_service?.toString() || null,
      maintenance_vendor: dto.maintenance_vendor || null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.resourceMaster).values(newResource);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'resource_master',
      entityId: resourceId,
      newValues: newResource,
    });

    return this.findOne(resourceId);
  }

  async findOne(id: string) {
    const [resource] = await this.db
      .select()
      .from(schema.resourceMaster)
      .where(and(eq(schema.resourceMaster.resource_id, id), isNull(schema.resourceMaster.deleted_at)))
      .limit(1);

    if (!resource) {
      throw new NotFoundException(`Resource with ID '${id}' not found.`);
    }

    return resource;
  }

  async findAll(query: QueryResourceDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.resourceMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.resourceMaster, query.companyId));
    if (query.resourceType) {
      conditions.push(eq(schema.resourceMaster.resource_type, query.resourceType));
    }
    if (query.nobId) {
      conditions.push(eq(schema.resourceMaster.nob_id, query.nobId));
    }
    if (query.lobId) {
      conditions.push(eq(schema.resourceMaster.lob_id, query.lobId));
    }
    if (query.maintenanceDueWithinDays !== undefined) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + query.maintenanceDueWithinDays);
      conditions.push(
        and(
          isNotNull(schema.resourceMaster.next_maintenance_date),
          lte(schema.resourceMaster.next_maintenance_date, cutoff.toISOString().slice(0, 10))
        )
      );
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.resourceMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.resourceMaster.resource_code, `%${query.search}%`),
          like(schema.resourceMaster.resource_name, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.resourceMaster, query.filter));

    // Rows and the matching count together, so the pager knows how many
    // pages there really are rather than guessing from a full page.
    return runMasterList(this.db, schema.resourceMaster, conditions, query, schema.resourceMaster.resource_code);
  }

  async update(id: string, dto: UpdateResourceDto, tenantId: string, userPayload?: any) {
    const resource = await this.findOne(id);

    if (dto.resource_code && dto.resource_code.toUpperCase() !== resource.resource_code) {
      throw new ConflictException('Resource Code is generated from the company-wide RESOURCE sequence and cannot be changed.');
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;
    if (dto.resource_name !== undefined) updates.resource_name = dto.resource_name;
    if (dto.resource_type !== undefined) updates.resource_type = dto.resource_type;
    if (dto.resource_sub_type !== undefined) updates.resource_sub_type = dto.resource_sub_type;
    if (dto.employee_id !== undefined) updates.employee_id = dto.employee_id;
    if (dto.designation !== undefined) updates.designation = dto.designation;
    if (dto.capacity !== undefined) updates.capacity = dto.capacity?.toString() || null;
    if (dto.capacity_uom !== undefined) updates.capacity_uom = dto.capacity_uom;
    if (dto.unit !== undefined) updates.unit = dto.unit;
    if (dto.cost_rate !== undefined) updates.cost_rate = dto.cost_rate?.toString() || null;
    if (dto.asset_code !== undefined) updates.asset_code = dto.asset_code;
    if (dto.asset_make !== undefined) updates.asset_make = dto.asset_make;
    if (dto.asset_model !== undefined) updates.asset_model = dto.asset_model;
    if (dto.asset_serial_no !== undefined) updates.asset_serial_no = dto.asset_serial_no;
    if (dto.purchase_date !== undefined) updates.purchase_date = dto.purchase_date;
    if (dto.warranty_expiry_date !== undefined) updates.warranty_expiry_date = dto.warranty_expiry_date;
    if (dto.maintenance_frequency_days !== undefined) updates.maintenance_frequency_days = dto.maintenance_frequency_days;
    if (dto.maintenance_cost_per_service !== undefined) updates.maintenance_cost_per_service = dto.maintenance_cost_per_service?.toString() || null;
    if (dto.maintenance_vendor !== undefined) updates.maintenance_vendor = dto.maintenance_vendor;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.resourceMaster)
      .set(updates)
      .where(eq(schema.resourceMaster.resource_id, id));

    await this.auditService.log({
      tenantId,
      companyId: resource.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'resource_master',
      entityId: id,
      oldValues: resource,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const resource = await this.findOne(id);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.resourceMaster)
      .set({
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.resourceMaster.resource_id, id));

    await this.auditService.log({
      tenantId,
      companyId: resource.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'resource_master',
      entityId: id,
      oldValues: resource,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Resource '${resource.resource_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [resource] = await this.db
      .select()
      .from(schema.resourceMaster)
      .where(eq(schema.resourceMaster.resource_id, id))
      .limit(1);

    if (!resource) {
      throw new NotFoundException(`Resource with ID '${id}' not found.`);
    }

    if (!resource.deleted_at) {
      return resource;
    }

    await this.db
      .update(schema.resourceMaster)
      .set({
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      })
      .where(eq(schema.resourceMaster.resource_id, id));

    await this.auditService.log({
      tenantId,
      companyId: resource.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'resource_master',
      entityId: id,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id);
  }

  // --- Maintenance Logs ---

  async createMaintenanceLog(resourceId: string, dto: CreateMaintenanceLogDto, tenantId: string, userPayload?: any) {
    const resource = await this.findOne(resourceId);
    if (!resource.company_id) throw new BadRequestException('Maintenance is recorded against a company resource, not a tenant template.');

    const logId = randomUUID();
    const newLog = {
      log_id: logId,
      tenant_id: tenantId,
      company_id: resource.company_id,
      resource_id: resourceId,
      maintenance_date: dto.maintenance_date,
      maintenance_type: dto.maintenance_type,
      description: dto.description || null,
      cost: dto.cost?.toString() || null,
      performed_by: dto.performed_by || null,
      status: dto.status || 'COMPLETED',
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
    };

    await this.db.insert(schema.resourceMaintenanceLog).values(newLog);

    // Roll the resource's maintenance-due tracking forward from this service.
    // Mirrors the doc's intent: completing a service updates last/next dates
    // on the resource itself, so overdue equipment can be queried directly.
    if (newLog.status === 'COMPLETED') {
      const resourceUpdates: any = {
        last_maintenance_date: dto.maintenance_date,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
      };
      if (resource.maintenance_frequency_days) {
        const next = new Date(dto.maintenance_date);
        next.setDate(next.getDate() + resource.maintenance_frequency_days);
        resourceUpdates.next_maintenance_date = next.toISOString().slice(0, 10);
      }
      await this.db
        .update(schema.resourceMaster)
        .set(resourceUpdates)
        .where(eq(schema.resourceMaster.resource_id, resourceId));
    }

    await this.auditService.log({
      tenantId,
      companyId: resource.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'resource_maintenance_log',
      entityId: logId,
      newValues: newLog,
    });

    return this.findOneMaintenanceLog(logId);
  }

  async findOneMaintenanceLog(logId: string) {
    const [log] = await this.db
      .select()
      .from(schema.resourceMaintenanceLog)
      .where(and(eq(schema.resourceMaintenanceLog.log_id, logId), isNull(schema.resourceMaintenanceLog.deleted_at)))
      .limit(1);

    if (!log) {
      throw new NotFoundException(`Maintenance log with ID '${logId}' not found.`);
    }

    return log;
  }

  async findAllMaintenanceLogs(resourceId: string, tenantId: string) {
    await this.findOne(resourceId);

    return this.db
      .select()
      .from(schema.resourceMaintenanceLog)
      .where(
        and(
          eq(schema.resourceMaintenanceLog.tenant_id, tenantId),
          eq(schema.resourceMaintenanceLog.resource_id, resourceId),
          isNull(schema.resourceMaintenanceLog.deleted_at)
        )
      );
  }

  async updateMaintenanceLog(logId: string, dto: UpdateMaintenanceLogDto, tenantId: string, userPayload?: any) {
    const log = await this.findOneMaintenanceLog(logId);

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.maintenance_date !== undefined) updates.maintenance_date = dto.maintenance_date;
    if (dto.maintenance_type !== undefined) updates.maintenance_type = dto.maintenance_type;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.cost !== undefined) updates.cost = dto.cost?.toString() || null;
    if (dto.performed_by !== undefined) updates.performed_by = dto.performed_by;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    await this.db
      .update(schema.resourceMaintenanceLog)
      .set(updates)
      .where(eq(schema.resourceMaintenanceLog.log_id, logId));

    await this.auditService.log({
      tenantId,
      companyId: log.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'resource_maintenance_log',
      entityId: logId,
      oldValues: log,
      newValues: updates,
    });

    return this.findOneMaintenanceLog(logId);
  }

  async removeMaintenanceLog(logId: string, tenantId: string, userPayload?: any) {
    const log = await this.findOneMaintenanceLog(logId);
    const deletedTime = toMysqlTimestamp();

    await this.db
      .update(schema.resourceMaintenanceLog)
      .set({
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
      })
      .where(eq(schema.resourceMaintenanceLog.log_id, logId));

    await this.auditService.log({
      tenantId,
      companyId: log.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'resource_maintenance_log',
      entityId: logId,
      oldValues: log,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Maintenance log has been soft-deleted.` };
  }
}
