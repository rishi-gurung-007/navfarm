import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { companyCondition, masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { accountingCalendar, type AccountingMonth } from './accounting-period.rules';
import { CreateAccountingPeriodDto, QueryAccountingPeriodDto, UpdateAccountingPeriodDto } from './accounting-period.dto';

const table = schema.accountingPeriod;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
type Row = typeof table.$inferSelect;

/**
 * Accounting Period Master CRUD, scoped like every other master (master-data-scope.ts). A period has no
 * end date of its own: it ends the day before the next one starts, so two rows may not share a Starting Date.
 */
@Injectable()
export class AccountingPeriodService {
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
      .where(and(eq(table.accounting_period_id, id), eq(table.tenant_id, tenantId), isNull(table.deleted_at), ...masterScopeConditions(this.cls, table)))
      .limit(1);
    if (!row) throw new NotFoundException('Accounting period is not available in this workspace.');
    return row;
  }

  /** The list, each row with the Ending Date and Fiscal Year the calendar gives it. */
  async findAll(query: QueryAccountingPeriodDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), isNull(table.deleted_at), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    conditions.push(...listFilterConditions(table, query.filter));
    const page = await runMasterList<Row>(this.db, table, conditions, { ...query, sort: query.sort ?? 'starting_date' }, table.starting_date);
    const calendar = await this.calendar(this.companyOf(query.companyId), tenantId);
    const byId = new Map(calendar.map((m) => [m.accountingPeriodId, m]));
    return {
      ...page,
      data: page.data.map((row) => ({
        ...row,
        ending_date: byId.get(row.accounting_period_id)?.endDate ?? null,
        fiscal_year: byId.get(row.accounting_period_id)?.fiscalYear ?? null,
      })),
    };
  }

  /** The company's active periods with their dates resolved — what a report reads. */
  async calendar(companyId: string | null, tenantId: string): Promise<AccountingMonth[]> {
    const rows = await this.db.select().from(table)
      .where(and(eq(table.tenant_id, tenantId), companyCondition(table.company_id, companyId), isNull(table.deleted_at), eq(table.is_active, true)));
    return accountingCalendar(rows);
  }

  private async assertStartFree(companyId: string | null, startingDate: string, tenantId: string, exceptId?: string) {
    const [clash] = await this.db.select({ id: table.accounting_period_id }).from(table)
      .where(and(eq(table.tenant_id, tenantId), companyCondition(table.company_id, companyId), isNull(table.deleted_at), eq(table.starting_date, startingDate)))
      .limit(1);
    if (clash && clash.id !== exceptId) throw new ConflictException(`An accounting period already starts on ${startingDate}.`);
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'accounting_period', entityId: row.accounting_period_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateAccountingPeriodDto, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto.company_id);
    await this.assertStartFree(companyId, dto.starting_date, tenantId);
    const id = randomUUID();
    await this.db.insert(table).values({
      accounting_period_id: id, tenant_id: tenantId, company_id: companyId,
      starting_date: dto.starting_date, name: dto.name.trim(),
      new_fiscal_year: dto.new_fiscal_year ?? false, closed: dto.closed ?? false,
      date_locked: dto.date_locked ?? false, inventory_period_closed: dto.inventory_period_closed ?? false,
      created_by: user?.userId, updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(id, tenantId), user);
  }

  async update(id: string, dto: UpdateAccountingPeriodDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.starting_date && dto.starting_date !== before.starting_date) await this.assertStartFree(before.company_id, dto.starting_date, tenantId, id);
    await this.db.update(table).set({
      ...(dto.starting_date !== undefined ? { starting_date: dto.starting_date } : {}),
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.new_fiscal_year !== undefined ? { new_fiscal_year: dto.new_fiscal_year } : {}),
      ...(dto.closed !== undefined ? { closed: dto.closed } : {}),
      ...(dto.date_locked !== undefined ? { date_locked: dto.date_locked } : {}),
      ...(dto.inventory_period_closed !== undefined ? { inventory_period_closed: dto.inventory_period_closed } : {}),
      updated_by: user?.userId, updated_at: nowTs(),
    }).where(eq(table.accounting_period_id, id));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    await this.db.update(table).set({ is_active: active, updated_by: user?.userId, updated_at: nowTs() }).where(eq(table.accounting_period_id, id));
    return this.log(active ? 'RESTORE' : 'DEACTIVATE', await this.findOne(id, tenantId), user, before);
  }
}
