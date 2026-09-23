import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, or, inArray, desc } from 'drizzle-orm';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { QueryWarehouseDto } from './dto/warehouse.dto';
import { masterScopeConditions } from '../../../common/master-data-scope';

/**
 * Read-only projection of `location_master` for the STORE and SILO types.
 *
 * `warehouse_master` used to be a real table holding a duplicate identity for
 * every store and silo. It is gone: a warehouse is a location, and its
 * `warehouse_id` was always the same UUID as its `location_id`, so the six
 * inventory screens that call `GET /warehouse` keep working unchanged — the
 * rows are simply read from the one table now and aliased back to the
 * warehouse_* field names those screens expect.
 *
 * Creating, renaming and retiring a warehouse happens through /location, which
 * is the single write path for the whole tree.
 */

const WAREHOUSE_TYPES = ['STORE', 'SILO'];

@Injectable()
export class WarehouseService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** Location row -> the warehouse_* shape the inventory screens bind to. */
  private project(row: typeof schema.locationMaster.$inferSelect) {
    return {
      warehouse_id: row.location_id,
      tenant_id: row.tenant_id,
      company_id: row.company_id,
      farm_id: row.farm_id,
      warehouse_code: row.location_code,
      warehouse_name: row.location_name,
      warehouse_type: row.storage_type || row.location_type,
      location_id: row.location_id,
      location_type: row.location_type,
      parent_location_id: row.parent_location_id,
      is_active: row.is_active,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
    };
  }

  async findAll(query: QueryWarehouseDto, tenantId: string) {
    // No deleted_at filter — the list shows Active and Inactive alike so a
    // blocked row can be found again, matching the old warehouse behaviour.
    const conditions: any[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      inArray(schema.locationMaster.location_type, WAREHOUSE_TYPES),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.locationMaster, query.companyId));
    if (query.farmId) conditions.push(eq(schema.locationMaster.farm_id, query.farmId));
    if (query.warehouseType) conditions.push(eq(schema.locationMaster.location_type, query.warehouseType));
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
      .where(and(eq(schema.locationMaster.location_id, id), inArray(schema.locationMaster.location_type, WAREHOUSE_TYPES)))
      .limit(1);

    if (!row) throw new NotFoundException(`Warehouse with ID '${id}' not found.`);
    return this.project(row);
  }
}
