import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { ReplaceItemQcSpecDto } from '../../inventory/qc-inspection/dto/qc-inspection.dto';
import { specProblems, specRowsToStore } from '../../inventory/qc-inspection/qc-inspection.rules';
import { linesFromQcParameters } from './qc-parameter-lines';

/** The QC Specification tab of the Item card: what an incoming lot of a QC-required item is checked against. */
@Injectable()
export class ItemQcSpecService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  /** The item, if it is inside the workspace's company; the same record check every master gets. */
  private async scopedItem(itemId: string) {
    const [item] = await this.db
      .select({ item_id: schema.itemMaster.item_id, company_id: schema.itemMaster.company_id, item_code: schema.itemMaster.item_code, is_biological_asset: schema.itemMaster.is_biological_asset })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), isNull(schema.itemMaster.deleted_at), ...masterScopeConditions(this.cls, schema.itemMaster)))
      .limit(1);
    if (!item) throw new NotFoundException(`Item '${itemId}' not found.`);
    return item;
  }

  async list(itemId: string) {
    await this.scopedItem(itemId);
    return this.db
      .select()
      .from(schema.itemQcSpecLine)
      .where(eq(schema.itemQcSpecLine.item_id, itemId))
      .orderBy(asc(schema.itemQcSpecLine.line_no));
  }

  /** Saves the item's whole specification. Inspections already raised keep the copy they were raised with. */
  async replace(itemId: string, dto: ReplaceItemQcSpecDto, tenantId: string, user?: { userId?: string }) {
    const item = await this.scopedItem(itemId);
    const lines = await linesFromQcParameters(this.db, dto.lines, { tenantId, companyId: item.company_id });
    const problems = specProblems(lines);
    if (problems.length) throw new BadRequestException(problems.join(' '));

    await this.db.transaction(async (tx) => {
      await tx.delete(schema.itemQcSpecLine).where(eq(schema.itemQcSpecLine.item_id, itemId));
      if (!lines.length) return;
      await tx.insert(schema.itemQcSpecLine).values(
        specRowsToStore(lines, { tenantId, companyId: item.company_id, itemId, userId: user?.userId, newId: randomUUID }),
      );
    });

    await this.auditService.log({
      tenantId,
      companyId: item.company_id ?? undefined,
      userId: user?.userId,
      action: 'UPDATE',
      entityName: 'item_qc_spec_line',
      entityId: itemId,
      newValues: { item_code: item.item_code, lines: dto.lines.length },
    });
    return this.list(itemId);
  }
}
