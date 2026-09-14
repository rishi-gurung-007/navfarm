import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryAlertDto } from './dto/alert.dto';
import { batchReferenceScopeConditions, farmScope } from '../../../common/farm-scope';

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

  async findAll(query: QueryAlertDto, tenantId: string) {
    const conditions: any[] = [eq(schema.notificationAlertLog.tenant_id, tenantId)];
    conditions.push(...batchReferenceScopeConditions(farmScope(this.cls), schema.notificationAlertLog.batch_id));

    if (query.companyId) conditions.push(eq(schema.notificationAlertLog.company_id, query.companyId));
    if (query.batchId) conditions.push(eq(schema.notificationAlertLog.batch_id, query.batchId));
    if (query.severity) conditions.push(eq(schema.notificationAlertLog.severity, query.severity));
    if (query.isRead !== undefined) conditions.push(eq(schema.notificationAlertLog.is_read, query.isRead));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    return this.db
      .select()
      .from(schema.notificationAlertLog)
      .where(and(...conditions))
      .orderBy(desc(schema.notificationAlertLog.created_at))
      .limit(limit)
      .offset(offset);
  }

  // Scoped by company_id, not just alert_id: within one tenant's physical DB,
  // alerts span every company the tenant has — without this check a user
  // could mark another company's alert read just by guessing/enumerating IDs.
  async markRead(id: string, companyId: string, userPayload?: any) {
    const conditions = [
      eq(schema.notificationAlertLog.alert_id, id),
      eq(schema.notificationAlertLog.company_id, companyId),
      ...batchReferenceScopeConditions(farmScope(this.cls), schema.notificationAlertLog.batch_id),
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
