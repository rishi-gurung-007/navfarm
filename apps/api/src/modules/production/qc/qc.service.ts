import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateQcDto, QueryQcDto } from './dto/qc.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { batchReferenceScopeConditions, batchScopeConditions, farmScope } from '../../../common/farm-scope';

@Injectable()
export class QcService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  async create(dto: CreateQcDto, tenantId: string, userPayload?: any) {
    const [batch] = await this.db
      .select()
      .from(schema.batchHeader)
      .where(and(
        eq(schema.batchHeader.batch_id, dto.source_batch_id),
        eq(schema.batchHeader.tenant_id, tenantId),
        ...batchScopeConditions(farmScope(this.cls)),
      ))
      .limit(1);
    if (!batch) {
      throw new NotFoundException(`Batch with ID '${dto.source_batch_id}' not found.`);
    }
    if (dto.company_id !== batch.company_id) throw new BadRequestException('QC record company must match the batch company.');
    if (dto.output_line_id) {
      const [outputLine] = await this.db.select({ line_id: schema.batchOutputLine.line_id })
        .from(schema.batchOutputLine)
        .where(and(
          eq(schema.batchOutputLine.line_id, dto.output_line_id),
          eq(schema.batchOutputLine.batch_id, batch.batch_id),
        )).limit(1);
      if (!outputLine) throw new BadRequestException('The output line does not belong to the source batch.');
    }

    // Resolve each param and auto-determine PASS/FAIL.
    let anyMandatoryFailed = false;
    const resolvedResults: Array<{ result_id: string; param_id: string; actual_value: string; result_status: string; grade_assigned: string | null; notes: string | null }> = [];

    for (const r of dto.results) {
      const [param] = await this.db
        .select()
        .from(schema.qcParameterMaster)
        .where(and(
          eq(schema.qcParameterMaster.param_id, r.param_id),
          eq(schema.qcParameterMaster.tenant_id, tenantId),
          eq(schema.qcParameterMaster.company_id, batch.company_id),
          or(isNull(schema.qcParameterMaster.lob_id), eq(schema.qcParameterMaster.lob_id, batch.lob_id)),
        ))
        .limit(1);
      if (!param) {
        throw new BadRequestException(`QC parameter with ID '${r.param_id}' not found.`);
      }

      let resultStatus = 'PASS';
      if (param.param_type === 'NUMERIC') {
        const actual = Number(r.actual_value);
        if (Number.isNaN(actual)) {
          throw new BadRequestException(`Parameter '${param.param_name}' expects a numeric value.`);
        }
        const belowMin = param.min_value !== null && actual < Number(param.min_value);
        const aboveMax = param.max_value !== null && actual > Number(param.max_value);
        resultStatus = belowMin || aboveMax ? 'FAIL' : 'PASS';
      } else if (param.param_type === 'BOOLEAN') {
        resultStatus = r.actual_value === 'true' ? 'PASS' : 'FAIL';
      } else if (param.param_type === 'GRADE') {
        resultStatus = 'PASS'; // grading isn't a binary pass/fail — it just records grade_assigned
      }

      if (resultStatus === 'FAIL' && param.is_mandatory) {
        anyMandatoryFailed = true;
      }

      resolvedResults.push({
        result_id: randomUUID(),
        param_id: r.param_id,
        actual_value: r.actual_value,
        result_status: resultStatus,
        grade_assigned: r.grade_assigned || null,
        notes: r.notes || null,
      });
    }

    const overallResult = anyMandatoryFailed ? 'FAIL' : 'PASS';
    const qcId = randomUUID();

    await this.db.insert(schema.qcBatchDetail).values({
      qc_id: qcId,
      tenant_id: tenantId,
      company_id: batch.company_id,
      source_batch_id: dto.source_batch_id,
      output_line_id: dto.output_line_id || null,
      qc_date: dto.qc_date,
      inspector_id: userPayload?.userId || null,
      total_qty_received: dto.total_qty_received.toString(),
      pass_qty: (dto.pass_qty ?? 0).toString(),
      fail_qty: (dto.fail_qty ?? 0).toString(),
      hold_qty: (dto.hold_qty ?? 0).toString(),
      grade_a_qty: dto.grade_a_qty?.toString() || null,
      grade_b_qty: dto.grade_b_qty?.toString() || null,
      grade_c_qty: dto.grade_c_qty?.toString() || null,
      overall_result: overallResult,
      disposition: dto.disposition,
      qc_notes: dto.qc_notes || null,
      created_by: userPayload?.userId || null,
    });

    await this.db.insert(schema.qcParamResult).values(
      resolvedResults.map((r) => ({ ...r, qc_id: qcId }))
    );

    await this.auditService.log({
      tenantId,
      companyId: batch.company_id,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'qc_batch_detail',
      entityId: qcId,
      newValues: { ...dto, overall_result: overallResult },
    });

    return this.findOne(qcId);
  }

  async findOne(id: string) {
    const scope = farmScope(this.cls);
    const [qc] = await this.db
      .select()
      .from(schema.qcBatchDetail)
      .where(and(eq(schema.qcBatchDetail.qc_id, id), ...batchReferenceScopeConditions(scope, schema.qcBatchDetail.source_batch_id)))
      .limit(1);
    if (!qc) {
      throw new NotFoundException(`QC record with ID '${id}' not found.`);
    }
    const results = await this.db.select().from(schema.qcParamResult).where(eq(schema.qcParamResult.qc_id, id));
    return { ...qc, results };
  }

  async findAll(query: QueryQcDto, tenantId: string) {
    const conditions: any[] = [eq(schema.qcBatchDetail.tenant_id, tenantId)];
    conditions.push(...batchReferenceScopeConditions(farmScope(this.cls), schema.qcBatchDetail.source_batch_id));
    if (query.companyId) conditions.push(eq(schema.qcBatchDetail.company_id, query.companyId));
    if (query.sourceBatchId) conditions.push(eq(schema.qcBatchDetail.source_batch_id, query.sourceBatchId));
    if (query.outputLineId) conditions.push(eq(schema.qcBatchDetail.output_line_id, query.outputLineId));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.qcBatchDetail)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }
}
