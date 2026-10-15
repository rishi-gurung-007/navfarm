import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryFarmDto } from './dto/farm.dto';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { farmLocationScopeConditions, farmScope } from '../../../common/farm-scope';

/**
 * Read-only projection of `location_master` for the FARM type.
 *
 * `farm_master` is gone. A farm is a location whose `location_type` is FARM and
 * whose `parent_location_id` is null — the root of the tree. Its old
 * `farm_id` was always the same UUID as the location's, so callers that still
 * ask for farms keep resolving. Writes go through /location.
 */
@Injectable()
export class FarmService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private project(row: typeof schema.locationMaster.$inferSelect) {
    return {
      farm_id: row.location_id,
      tenant_id: row.tenant_id,
      company_id: row.company_id,
      farm_code: row.location_code,
      farm_name: row.location_name,
      farm_type: row.location_type,
      nob_id: row.nob_id,
      lob_id: row.lob_id,
      capacity: row.max_capacity != null ? Number(row.max_capacity) : 0,
      location_id: row.location_id,
      location_address: row.location_address,
      is_active: row.is_active,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    };
  }

  async findAll(query: QueryFarmDto, tenantId: string) {
    const conditions: any[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'FARM'),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.locationMaster, query.companyId));
    conditions.push(...farmLocationScopeConditions(farmScope(this.cls), schema.locationMaster.location_id));
    if (query.isActive !== undefined) conditions.push(eq(schema.locationMaster.is_active, query.isActive));
    if (query.search) {
      conditions.push(
        or(
          like(schema.locationMaster.location_code, `%${query.search}%`),
          like(schema.locationMaster.location_name, `%${query.search}%`),
        ),
      );
    }

    const rows = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(...conditions))
      .limit(query.limit || 50)
      .offset(query.offset || 0);

    return rows.map((r) => this.project(r));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, id), eq(schema.locationMaster.location_type, 'FARM'), ...farmLocationScopeConditions(farmScope(this.cls), schema.locationMaster.location_id)))
      .limit(1);

    if (!row) throw new NotFoundException(`Farm with ID '${id}' not found.`);
    return this.project(row);
  }
}
