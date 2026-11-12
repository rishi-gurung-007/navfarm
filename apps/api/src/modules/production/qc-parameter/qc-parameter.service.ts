import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, isNull, ne } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import {
  MasterScope,
  masterScopeConditions,
} from '../../../common/master-data-scope';
import {
  CreateQcParameterDto,
  UpdateQcParameterDto,
  QueryQcParameterDto,
} from './dto/qc-parameter.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { qcRangeError } from './qc-parameter.rules';
import {
  specLineFromParameter,
  specRowsToStore,
} from '../../inventory/qc-inspection/qc-inspection.rules';

const decimalOrNull = (v: number | string | null | undefined) =>
  v === null || v === undefined ? null : v.toString();

@Injectable()
export class QcParameterService {
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

  /** Unit and Min / Max / Target belong to a NUMERIC parameter only; they must agree as Min ≤ Target ≤ Max. */
  private measurement(
    type: string,
    v: { uom?: string | null; min?: number | string | null; max?: number | string | null; target?: number | string | null },
  ) {
    if (type !== 'NUMERIC') {
      return { uom: null, min_value: null, max_value: null, target_value: null };
    }
    const error = qcRangeError(v.min, v.target, v.max);
    if (error) throw new BadRequestException(error);
    return {
      uom: v.uom || null,
      min_value: decimalOrNull(v.min),
      max_value: decimalOrNull(v.max),
      target_value: decimalOrNull(v.target),
    };
  }

  /**
   * The item QC specification lines taken from this parameter (0248) keep the item's own Description, Unit, Min / Max / Target and Mandatory:
   * an item's values may differ from the master's. What follows the master is Active, and a change of QC Type, which resets the item's line to
   * the master's values because a range kept for the other type would not mean anything. Inspections already raised keep their copy.
   */
  private async syncSpecLines(paramId: string, userId?: string | null) {
    const [param] = await this.db
      .select()
      .from(schema.qcParameterMaster)
      .where(eq(schema.qcParameterMaster.param_id, paramId))
      .limit(1);
    if (!param) return;
    const [row] = specRowsToStore([specLineFromParameter(param)], {
      tenantId: param.tenant_id,
      companyId: param.company_id,
      itemId: '',
      userId,
      newId: () => '',
    });
    await this.db
      .update(schema.itemQcSpecLine)
      .set({
        measurement_description: row.measurement_description,
        sampling_type: row.sampling_type,
        uom: row.uom,
        min_value: row.min_value,
        max_value: row.max_value,
        target_value: row.target_value,
        acceptance_text: row.acceptance_text,
        is_mandatory: row.is_mandatory,
        updated_by: userId ?? null,
      })
      .where(
        and(
          eq(schema.itemQcSpecLine.param_id, paramId),
          ne(schema.itemQcSpecLine.sampling_type, row.sampling_type),
        ),
      );
    await this.db
      .update(schema.itemQcSpecLine)
      .set({ is_active: row.is_active, updated_by: userId ?? null })
      .where(eq(schema.itemQcSpecLine.param_id, paramId));
  }

  async create(dto: CreateQcParameterDto, tenantId: string, userPayload?: any) {
    const companyId = this.workspaceCompany(dto.company_id);
    const code = dto.param_code.trim().toUpperCase();

    // QC Code is unique per company (uq_qc_parameter_company_code; a tenant template has no company, so it is checked here).
    const existing = await this.db
      .select({ param_id: schema.qcParameterMaster.param_id })
      .from(schema.qcParameterMaster)
      .where(
        and(
          eq(schema.qcParameterMaster.tenant_id, tenantId),
          companyId
            ? eq(schema.qcParameterMaster.company_id, companyId)
            : isNull(schema.qcParameterMaster.company_id),
          eq(schema.qcParameterMaster.param_code, code),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`QC Code '${code}' already exists.`);
    }

    const paramId = randomUUID();

    await this.db.insert(schema.qcParameterMaster).values({
      param_id: paramId,
      tenant_id: tenantId,
      company_id: companyId,
      lob_id: null,
      param_code: code,
      param_name: dto.param_name.trim(),
      param_type: dto.param_type,
      ...this.measurement(dto.param_type, {
        uom: dto.uom,
        min: dto.min_value,
        max: dto.max_value,
        target: dto.target_value,
      }),
      is_mandatory: dto.is_mandatory ?? true,
      is_active: dto.is_active ?? true,
      created_by: userPayload?.userId || null,
    });

    await this.auditService.log({
      tenantId,
      companyId: companyId || '',
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'qc_parameter_master',
      entityId: paramId,
      newValues: dto,
    });

    return this.findOne(paramId);
  }

  async findOne(id: string) {
    const [param] = await this.db
      .select()
      .from(schema.qcParameterMaster)
      // A company reads and changes only its own rows (Rishi, 20 Oct): never a tenant template or another company's.
      .where(
        and(
          eq(schema.qcParameterMaster.param_id, id),
          ...masterScopeConditions(this.cls, schema.qcParameterMaster),
        ),
      )
      .limit(1);

    if (!param) {
      throw new NotFoundException(`QC parameter with ID '${id}' not found.`);
    }

    return param;
  }

  async findAll(query: QueryQcParameterDto, tenantId: string) {
    const conditions: any[] = [
      eq(schema.qcParameterMaster.tenant_id, tenantId),
    ];

    conditions.push(
      ...masterScopeConditions(
        this.cls,
        schema.qcParameterMaster,
        query.companyId,
      ),
    );
    // A parameter without a line of business applies to every line.
    if (query.lobId)
      conditions.push(
        or(
          eq(schema.qcParameterMaster.lob_id, query.lobId),
          isNull(schema.qcParameterMaster.lob_id),
        )!,
      );
    if (query.isActive !== undefined)
      conditions.push(
        eq(schema.qcParameterMaster.is_active, query.isActive === 'true'),
      );
    if (query.search) {
      conditions.push(
        or(
          like(schema.qcParameterMaster.param_code, `%${query.search}%`),
          like(schema.qcParameterMaster.param_name, `%${query.search}%`),
        )!,
      );
    }

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.qcParameterMaster)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  async update(
    id: string,
    dto: UpdateQcParameterDto,
    tenantId: string,
    userPayload?: any,
  ) {
    const param = await this.findOne(id);
    const type = dto.param_type ?? param.param_type;
    const pick = <A, B>(given: A | undefined, current: B): A | B =>
      given !== undefined ? given : current;

    await this.db
      .update(schema.qcParameterMaster)
      .set({
        param_name: dto.param_name?.trim() || param.param_name,
        param_type: type,
        // A GRADE row from before 0247 keeps its scale until its type is changed.
        ...(type === 'GRADE'
          ? {}
          : this.measurement(type, {
              uom: pick(dto.uom, param.uom),
              min: pick(dto.min_value, param.min_value),
              max: pick(dto.max_value, param.max_value),
              target: pick(dto.target_value, param.target_value),
            })),
        is_mandatory: dto.is_mandatory ?? param.is_mandatory,
        is_active: dto.is_active ?? param.is_active,
      })
      .where(eq(schema.qcParameterMaster.param_id, id));
    await this.syncSpecLines(id, userPayload?.userId);

    await this.auditService.log({
      tenantId,
      companyId: param.company_id || '',
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'qc_parameter_master',
      entityId: id,
      oldValues: param,
      newValues: dto,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const param = await this.findOne(id);

    await this.db
      .update(schema.qcParameterMaster)
      .set({ is_active: false })
      .where(eq(schema.qcParameterMaster.param_id, id));
    await this.syncSpecLines(id, userPayload?.userId);

    await this.auditService.log({
      tenantId,
      companyId: param.company_id || '',
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'qc_parameter_master',
      entityId: id,
      oldValues: param,
    });

    return {
      success: true,
      message: `QC parameter '${param.param_code}' has been deactivated.`,
    };
  }
}
