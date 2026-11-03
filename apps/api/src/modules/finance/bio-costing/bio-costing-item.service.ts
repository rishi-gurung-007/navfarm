import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { assertCompanyInScope, farmScope } from '../../../common/farm-scope';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import type { CreateItemFairValueRateDto } from './bio-costing-item.dto';

/**
 * What a biological item carries beyond its own columns for costing: the dated fair-value rates (expected weight and price per kg). A rate is never edited:
 * a change is a new row with a later date.
 */
@Injectable()
export class BioCostingItemService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db(): MySql2Database<typeof schema> {
    const db = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!db) throw new Error('Tenant database connection context not established.');
    return db;
  }

  private async loadItem(itemId: string, tenantId: string) {
    const [item] = await this.db.select().from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), eq(schema.itemMaster.tenant_id, tenantId))).limit(1);
    if (!item) throw new NotFoundException('Item not found.');
    if (item.company_id) assertCompanyInScope(farmScope(this.cls), item.company_id);
    return item;
  }

  async listRates(itemId: string, tenantId: string) {
    await this.loadItem(itemId, tenantId);
    return this.db.select().from(schema.itemFairValueRate)
      .where(eq(schema.itemFairValueRate.item_id, itemId)).orderBy(desc(schema.itemFairValueRate.effective_from));
  }

  async addRate(itemId: string, dto: CreateItemFairValueRateDto, tenantId: string, userId?: string) {
    const item = await this.loadItem(itemId, tenantId);
    if (!item.is_biological_asset || item.bio_costing_method !== 'FAIR_VALUE') {
      throw new BadRequestException(`Item ${item.item_code} is not costed by fair value, so it takes no fair-value rate. Set its FA/Bio Asset Costing Method to Fair Value first.`);
    }
    if (dto.farm_id) {
      const [farm] = await this.db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, dto.farm_id), eq(schema.locationMaster.tenant_id, tenantId),
        ...(item.company_id ? [eq(schema.locationMaster.company_id, item.company_id)] : []), isNull(schema.locationMaster.parent_location_id))).limit(1);
      if (!farm) throw new BadRequestException('That farm is not a farm of this company.');
    }
    const rate_id = randomUUID();
    await this.db.insert(schema.itemFairValueRate).values({
      rate_id, item_id: itemId, farm_id: dto.farm_id ?? null, age_week_from: dto.age_week_from ?? 0, effective_from: dto.effective_from,
      expected_weight_kg: dto.expected_weight_kg.toString(), price_per_kg: dto.price_per_kg.toString(), cdm_based: dto.cdm_based ?? false,
      costs_to_sell_pct: dto.costs_to_sell_pct?.toString() ?? null, created_by: userId ?? null,
    });
    await this.audit.log({ tenantId, companyId: item.company_id ?? undefined, userId, action: 'CREATE', entityName: 'item_fair_value_rate', entityId: rate_id, newValues: { item_id: itemId, ...dto } });
    return this.listRates(itemId, tenantId);
  }
}
