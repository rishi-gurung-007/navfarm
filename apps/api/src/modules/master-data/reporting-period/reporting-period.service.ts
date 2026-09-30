import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { companyCondition, masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { addDays } from '../../inventory/feed-forecast/feed-forecast.engine';
import { businessYearOf, generateBusinessYear, periodProblems, periodsOverlap } from './reporting-period.rules';
import { CreateReportingPeriodDto, GenerateReportingPeriodsDto, QueryReportingPeriodDto, UpdateReportingPeriodDto } from './reporting-period.dto';

const table = schema.reportingPeriod;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
type Row = typeof table.$inferSelect;
type Shaped = { period_code: string; start_date: string; end_date: string; stock_take_date: string; production_start_date: string; business_year: string };

/**
 * Reporting Period Master CRUD (spec D20), scoped like every other master
 * (master-data-scope.ts). A period is never deleted — Plan D's stock takes
 * will point at it — only deactivated. Active periods of one company may not
 * overlap: the forecast picks "the period covering the planning date", and
 * two would make that ambiguous.
 */
@Injectable()
export class ReportingPeriodService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private companyOf(requested?: string | null): string | null {
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    return scope?.kind ? scope.companyId : requested ?? null;
  }

  async findOne(id: string, tenantId: string): Promise<Row> {
    const [row] = await this.db.select().from(table)
      .where(and(eq(table.period_id, id), eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)))
      .limit(1);
    if (!row) throw new NotFoundException('Reporting period is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryReportingPeriodDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), isNull(table.deleted_at), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.businessYear) conditions.push(eq(table.business_year, query.businessYear));
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions))
      .orderBy(listOrderBy(table, { ...query, sort: query.sort ?? 'start_date' }, table.start_date))
      .limit(query.limit || 50).offset(query.offset || 0);
  }

  /** Every period of the company (active or not) — codes are unique across all of them, overlaps only matter among active ones. */
  private async companyRows(companyId: string | null, tenantId: string): Promise<Row[]> {
    return this.db.select().from(table)
      .where(and(eq(table.tenant_id, tenantId), companyCondition(table.company_id, companyId), isNull(table.deleted_at)));
  }

  private shape(p: { period_code: string; start_date: string; end_date: string; stock_take_date?: string | null }): Shaped {
    const period_code = p.period_code.trim().toUpperCase();
    const stock_take_date = p.stock_take_date || p.end_date; // Silo Balance and Stock Take row 37: "Auto = Period End Date"
    const problems = periodProblems({ period_code, start_date: p.start_date, end_date: p.end_date, stock_take_date });
    if (problems.length) throw new BadRequestException(problems.join(' '));
    return {
      period_code, start_date: p.start_date, end_date: p.end_date, stock_take_date,
      production_start_date: addDays(p.end_date, 1), // row 49: the Sunday after the month-end Saturday
      business_year: businessYearOf(p.end_date),
    };
  }

  private assertFree(candidate: Shaped, rows: Row[], excludeId?: string) {
    const others = rows.filter((r) => r.period_id !== excludeId);
    if (others.some((r) => r.period_code === candidate.period_code)) {
      throw new ConflictException(`Reporting period ${candidate.period_code} already exists for this company.`);
    }
    const clash = others.find((r) => r.is_active && periodsOverlap(candidate, r));
    if (clash) {
      throw new ConflictException(
        `${candidate.period_code} (${candidate.start_date} to ${candidate.end_date}) overlaps ${clash.period_code} (${clash.start_date} to ${clash.end_date}).`,
      );
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'reporting_period', entityId: row.period_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateReportingPeriodDto, tenantId: string, user?: any) {
    const shaped = this.shape(dto);
    const companyId = this.companyOf(dto.company_id);
    this.assertFree(shaped, await this.companyRows(companyId, tenantId));
    const period_id = randomUUID();
    await this.db.insert(table).values({ period_id, tenant_id: tenantId, company_id: companyId, ...shaped, created_by: user?.userId, updated_by: user?.userId });
    return this.log('CREATE', await this.findOne(period_id, tenantId), user);
  }

  async update(id: string, dto: UpdateReportingPeriodDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.period_code !== undefined && dto.period_code.trim().toUpperCase() !== before.period_code) {
      throw new BadRequestException('Period codes cannot be renamed. Deactivate the period and create a new one.');
    }
    const shaped = this.shape({
      period_code: before.period_code,
      start_date: dto.start_date ?? before.start_date,
      end_date: dto.end_date ?? before.end_date,
      // A moved End Date moves a stock take that was on the old End Date with it, unless a new one is given.
      stock_take_date: dto.stock_take_date !== undefined ? dto.stock_take_date : before.stock_take_date === before.end_date ? null : before.stock_take_date,
    });
    if (before.is_active) this.assertFree(shaped, await this.companyRows(before.company_id, tenantId), id);
    await this.db.update(table).set({ ...shaped, updated_by: user?.userId, updated_at: nowTs() }).where(eq(table.period_id, id));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active && !before.is_active) this.assertFree(before as unknown as Shaped, await this.companyRows(before.company_id, tenantId), id);
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', updated_by: user?.userId, updated_at: nowTs() }).where(eq(table.period_id, id));
    return this.log(active ? 'RESTORE' : 'DEACTIVATE', await this.findOne(id, tenantId), user, before);
  }

  /** Open question Q9: an admin's first draft of a July–June year; codes that exist, or dates an active period already covers, are skipped. */
  async generate(dto: GenerateReportingPeriodsDto, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto.company_id);
    const existing = await this.companyRows(companyId, tenantId);
    const created: Shaped[] = [];
    const skipped: { period_code: string; reason: string }[] = [];
    for (const draft of generateBusinessYear(dto.business_year_start)) {
      if (existing.some((r) => r.period_code === draft.period_code)) {
        skipped.push({ period_code: draft.period_code, reason: 'already exists' });
        continue;
      }
      const clash = existing.find((r) => r.is_active && periodsOverlap(draft, r));
      if (clash) {
        skipped.push({ period_code: draft.period_code, reason: `overlaps ${clash.period_code}` });
        continue;
      }
      created.push(draft);
    }
    if (created.length) {
      await this.db.insert(table).values(created.map((p) => ({
        period_id: randomUUID(), tenant_id: tenantId, company_id: companyId, ...p, created_by: user?.userId, updated_by: user?.userId,
      })));
      await this.audit.log({
        tenantId, companyId: companyId || undefined, userId: user?.userId, action: 'GENERATE', entityName: 'reporting_period',
        entityId: created[0].period_code, newValues: { business_year_start: dto.business_year_start, created: created.map((p) => p.period_code) },
      });
    }
    return { created: created.map((p) => p.period_code), skipped };
  }
}
