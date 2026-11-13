import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, getTableColumns, isNull, or, type SQL } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryAlertDto } from './dto/alert.dto';
import { batchOnFarm, batchReferenceScopeConditions, farmScope } from '../../../common/farm-scope';
import { BIO_COSTING_ALERT_TYPE } from '../../finance/bio-costing/bio-costing.notice';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class AlertService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * Who sees which alert. A batch alert is seen through its batch: the farm and business line of the user's scope. A costing notice (BIO_COSTING_DUE) belongs to a
   * company, not a batch, so it is seen by anyone whose scope is that company, but not by a user held to one farm.
   */
  private scopeCondition(): SQL | undefined {
    const col = schema.notificationAlertLog.batch_id;
    const scope = farmScope(this.cls);
    const viaBatch = batchReferenceScopeConditions(scope, col);
    if (!viaBatch.length) return undefined;
    if (scope.farmId) return and(...viaBatch);
    const companyWide = and(
      isNull(col), eq(schema.notificationAlertLog.alert_type, BIO_COSTING_ALERT_TYPE),
      ...(scope.companyId ? [eq(schema.notificationAlertLog.company_id, scope.companyId)] : []),
    );
    return or(and(...viaBatch), companyWide);
  }

  async findAll(query: QueryAlertDto, tenantId: string) {
    const conditions: any[] = [eq(schema.notificationAlertLog.tenant_id, tenantId)];
    const visible = this.scopeCondition();
    if (visible) conditions.push(visible);

    if (query.companyId) conditions.push(eq(schema.notificationAlertLog.company_id, query.companyId));
    if (query.batchId) conditions.push(eq(schema.notificationAlertLog.batch_id, query.batchId));
    if (query.farmId) conditions.push(batchOnFarm(schema.notificationAlertLog.batch_id, query.farmId));
    if (query.severity) conditions.push(eq(schema.notificationAlertLog.severity, query.severity));
    if (query.isRead !== undefined) conditions.push(eq(schema.notificationAlertLog.is_read, query.isRead));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    // D24: the batch number and farm travel with each row, so the one Alerts
    // list can name the batch and filter by farm without a second read.
    return this.db
      .select({
        ...getTableColumns(schema.notificationAlertLog),
        batch_no: schema.batchHeader.batch_no,
        farm_id: schema.batchHeader.farm_id,
      })
      .from(schema.notificationAlertLog)
      .leftJoin(schema.batchHeader, eq(schema.batchHeader.batch_id, schema.notificationAlertLog.batch_id))
      .where(and(...conditions))
      .orderBy(desc(schema.notificationAlertLog.created_at))
      .limit(limit)
      .offset(offset);
  }

  // Scoped by company_id, not just alert_id: within one tenant's physical DB,
  // alerts span every company the tenant has — without this check a user
  // could mark another company's alert read just by guessing/enumerating IDs.
  async markRead(id: string, companyId: string, userPayload?: any) {
    const visible = this.scopeCondition();
    const conditions: SQL[] = [
      eq(schema.notificationAlertLog.alert_id, id),
      eq(schema.notificationAlertLog.company_id, companyId),
      ...(visible ? [visible] : []),
    ];
    const [alert] = await this.db
      .select()
      .from(schema.notificationAlertLog)
      .where(and(...conditions))
      .limit(1);

    if (!alert) {
      throw new NotFoundException(`Alert with ID '${id}' not found.`);
    }

    await this.db
      .update(schema.notificationAlertLog)
      .set({ is_read: true, read_by: userPayload?.userId || null, read_at: toMysqlTimestamp() as any })
      .where(and(eq(schema.notificationAlertLog.alert_id, id), eq(schema.notificationAlertLog.company_id, companyId)));

    return { ...alert, is_read: true };
  }
}
