import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  MasterScope,
  masterScopeConditions,
} from '../../../common/master-data-scope';
import {
  CreateParameterDto,
  UpdateParameterDto,
  QueryParameterDto,
} from './dto/parameter.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';

@Injectable()
export class ParameterService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  /** The workspace's company for a new row; a tenant template only from the tenant workspace. */
  private workspaceCompany(requested?: string | null): string | null {
    const scope = this.cls.get<MasterScope>('masterScope');
    return scope?.kind ? scope.companyId : requested || null;
  }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateParameterDto, tenantId: string, userPayload?: any) {
    const existing = await this.db
      .select()
      .from(schema.parameterMaster)
      .where(
        and(
          eq(schema.parameterMaster.tenant_id, tenantId),
          eq(
            schema.parameterMaster.parameter_code,
            dto.parameter_code.toUpperCase(),
          ),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(
        `Parameter code '${dto.parameter_code}' already exists.`,
      );
    }

    const parameterId = randomUUID();

    await this.db.insert(schema.parameterMaster).values({
      parameter_id: parameterId,
      tenant_id: tenantId,
      company_id: this.workspaceCompany(dto.company_id),
      nob_id: dto.nob_id || null,
      lob_id: dto.lob_id || null,
      parameter_code: dto.parameter_code.toUpperCase(),
      parameter_name: dto.parameter_name,
      parameter_type: dto.parameter_type,
      item_id: dto.item_id || null,
      resource_id: dto.resource_id || null,
      default_uom: dto.default_uom || null,
      qty_method: dto.qty_method,
      default_qty_per_unit: dto.default_qty_per_unit?.toString() || null,
      default_qty_per_batch: dto.default_qty_per_batch?.toString() || null,
      description: dto.description || null,
      is_mandatory: dto.is_mandatory ?? false,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || '',
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'parameter_master',
      entityId: parameterId,
      newValues: dto,
    });

    return this.findOne(parameterId);
  }

  async findOne(id: string) {
    const [parameter] = await this.db
      .select()
      .from(schema.parameterMaster)
      // A company reads and changes only its own rows (Rishi, 20 Oct): never a tenant template or another company's.
      .where(
        and(
          eq(schema.parameterMaster.parameter_id, id),
          ...masterScopeConditions(this.cls, schema.parameterMaster),
        ),
      )
      .limit(1);

    if (!parameter) {
      throw new NotFoundException(`Parameter with ID '${id}' not found.`);
    }

    return parameter;
  }

  async findAll(query: QueryParameterDto, tenantId: string) {
    const conditions: any[] = [eq(schema.parameterMaster.tenant_id, tenantId)];

    conditions.push(
      ...masterScopeConditions(
        this.cls,
        schema.parameterMaster,
        query.companyId,
      ),
    );
    if (query.nobId)
      conditions.push(eq(schema.parameterMaster.nob_id, query.nobId));
    if (query.lobId)
      conditions.push(eq(schema.parameterMaster.lob_id, query.lobId));
    if (query.parameterType)
      conditions.push(
        eq(schema.parameterMaster.parameter_type, query.parameterType),
      );
    if (query.search) {
      conditions.push(
        or(
          like(schema.parameterMaster.parameter_code, `%${query.search}%`),
          like(schema.parameterMaster.parameter_name, `%${query.search}%`),
        )!,
      );
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.parameterMaster)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  async update(
    id: string,
    dto: UpdateParameterDto,
    tenantId: string,
    userPayload?: any,
  ) {
    const parameter = await this.findOne(id);

    await this.db
      .update(schema.parameterMaster)
      .set({
        parameter_name: dto.parameter_name ?? parameter.parameter_name,
        item_id: dto.item_id !== undefined ? dto.item_id : parameter.item_id,
        resource_id:
          dto.resource_id !== undefined
            ? dto.resource_id
            : parameter.resource_id,
        default_uom: dto.default_uom ?? parameter.default_uom,
        qty_method: dto.qty_method ?? parameter.qty_method,
        default_qty_per_unit:
          dto.default_qty_per_unit !== undefined
            ? dto.default_qty_per_unit.toString()
            : parameter.default_qty_per_unit,
        default_qty_per_batch:
          dto.default_qty_per_batch !== undefined
            ? dto.default_qty_per_batch.toString()
            : parameter.default_qty_per_batch,
        description: dto.description ?? parameter.description,
        is_mandatory: dto.is_mandatory ?? parameter.is_mandatory,
        is_active: dto.is_active ?? parameter.is_active,
      })
      .where(eq(schema.parameterMaster.parameter_id, id));

    await this.auditService.log({
      tenantId,
      companyId: parameter.company_id || '',
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'parameter_master',
      entityId: id,
      oldValues: parameter,
      newValues: dto,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const parameter = await this.findOne(id);

    await this.db
      .update(schema.parameterMaster)
      .set({ is_active: false })
      .where(eq(schema.parameterMaster.parameter_id, id));

    await this.auditService.log({
      tenantId,
      companyId: parameter.company_id || '',
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'parameter_master',
      entityId: id,
      oldValues: parameter,
    });

    return {
      success: true,
      message: `Parameter '${parameter.parameter_code}' has been deactivated.`,
    };
  }
}
