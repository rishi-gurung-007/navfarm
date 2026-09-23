import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, desc } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryShedDto } from './dto/shed.dto';
import { masterScopeConditions } from '../../../common/master-data-scope';

/**
 * Read-only projection of `location_master` for the SHED type.
 *
 * `shed_master` is gone. A shed is a location whose `location_type` is SHED,
 * parented to its farm through `parent_location_id` rather than through a
 * `farm_id` column on a second table. Its `shed_id` was always the same UUID as
 * the location's, so `batch_header.shed_id` and the batch screen's shed
 * dropdown keep resolving. Writes go through /location.
 */
@Injectable()
export class ShedService {
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
      shed_id: row.location_id,
      tenant_id: row.tenant_id,
      company_id: row.company_id,
      farm_id: row.farm_id,
      shed_code: row.location_code,
      shed_name: row.location_name,
      shed_type: row.location_type,
      nob_id: row.nob_id,
      lob_id: row.lob_id,
      capacity: row.max_capacity != null ? Number(row.max_capacity) : 0,
      location_id: row.location_id,
      parent_location_id: row.parent_location_id,
      is_active: row.is_active,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    };
  }

  async findAll(query: QueryShedDto, tenantId: string) {
    const conditions: any[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'SHED'),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.locationMaster, query.companyId));
    if (query.farmId) conditions.push(eq(schema.locationMaster.farm_id, query.farmId));
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
      .orderBy(desc(schema.locationMaster.created_at))
      .limit(query.limit || 50)
      .offset(query.offset || 0);

    return rows.map((r) => this.project(r));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(eq(schema.locationMaster.location_id, id), eq(schema.locationMaster.location_type, 'SHED')))
      .limit(1);

    if (!row) throw new NotFoundException(`Shed with ID '${id}' not found.`);
    return this.project(row);
  }
}
