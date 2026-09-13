import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { and, eq, getTableColumns, isNull, or, SQL } from 'drizzle-orm';
import { AnyMySqlColumn, AnyMySqlTable, getTableConfig } from 'drizzle-orm/mysql-core';
import { ClsService } from 'nestjs-cls';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

export const MASTER_TABLES: Record<string, AnyMySqlTable> = {
  // farm, warehouse and shed are not tables — they are location_master rows
  // filtered by location_type, served read-only by their own controllers. They
  // map to locationMaster so scope checks on those routes still resolve.
  farm: schema.locationMaster, warehouse: schema.locationMaster, shed: schema.locationMaster,
  location: schema.locationMaster, 'location-type': schema.locationTypeMaster,
  stage: schema.stageMaster, 'number-series': schema.noSeriesMaster, animal: schema.animalRegister,
  item: schema.itemMaster, 'item-type': schema.itemTypeMaster, 'item-category': schema.itemCategoryMaster,
  'item-attribute': schema.itemAttributeMaster, uom: schema.uomMaster,
  // Two keys, one table: 'uom/conversion' is the controller route enforceMasterRequest
  // matches; 'uom-conversion' is what the UOM_CONVERSION master key resolves to in
  // NumberSeriesService. Consumers dedupe by table object, so the alias is free.
  'uom/conversion': schema.uomConversionMaster, 'uom-conversion': schema.uomConversionMaster,
  species: schema.speciesMaster,
  breed: schema.breedMaster, 'breed-lifecycle-stage': schema.breedLifecycleStages,
  reason: schema.reasonMaster, disease: schema.diseaseMaster, 'feed-formula': schema.feedFormulaMaster,
  activity: schema.activityMaster,
  supplier: schema.supplierMaster, customer: schema.customerMaster, resource: schema.resourceMaster,
  'gl-account': schema.glAccountMaster, 'gl-mapping': schema.glMappingMaster, 'cost-center': schema.costCenterMaster,
};

export interface MasterScope {
  kind: 'TENANT' | 'COMPANY' | 'OPERATIONAL';
  tenantId: string;
  companyId: string | null;
  nobId?: string;
  lobId?: string;
}

export const companyCondition = (column: AnyMySqlColumn, companyId?: string | null): SQL =>
  companyId ? eq(column, companyId) : isNull(column);

/** Used before pagination, including by lookup queries. Templates are never
 * unioned into a company's independently owned catalog. Null LOB means shared
 * company reference data (e.g. UOM), not a separate operational-area copy. */
export function masterScopeConditions(cls: ClsService, table: AnyMySqlTable, requestedCompany?: string): SQL[] {
  const candidate = cls.get<MasterScope>('masterScope');
  const scope = candidate?.kind ? candidate : undefined;
  const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>;
  const companyId = scope ? scope.companyId : requestedCompany;
  const conditions: SQL[] = [];
  if (scope && columns.tenant_id) conditions.push(eq(columns.tenant_id, scope.tenantId));
  if (columns.company_id && (scope || requestedCompany)) {
    conditions.push(companyId ? eq(columns.company_id, companyId) : isNull(columns.company_id));
  }
  if (scope?.kind === 'OPERATIONAL') {
    if (columns.nob_id && scope.nobId) conditions.push(or(eq(columns.nob_id, scope.nobId), isNull(columns.nob_id))!);
    if (columns.lob_id && scope.lobId) conditions.push(or(eq(columns.lob_id, scope.lobId), isNull(columns.lob_id))!);
  }
  return conditions;
}

/** Called after RolesGuard validates the workspace assignments. Controller
 * scope is explicit; unrelated operational endpoints retain their own rules. */
export async function enforceMasterRequest(cls: ClsService, request: any, controllerPath: string): Promise<void> {
  const conversion = controllerPath === 'uom' && (request.route?.path || request.path || '').includes('conversion');
  const table = MASTER_TABLES[conversion ? 'uom/conversion' : controllerPath];
  if (!table) return;
  const user = request.user;
  const area = cls.get<{ area_id: string; nob_id: string; lob_id: string }>('activeOperationalArea');
  const activeArea = area?.area_id ? area : undefined;
  const kind = request.headers['x-workspace-scope'] || (activeArea ? 'OPERATIONAL' : request.headers['x-active-company-id'] ? 'COMPANY' : ['TENANT_ADMIN', 'SYSTEM_ADMIN'].includes(user.userType) ? 'TENANT' : 'COMPANY');
  if (!['TENANT', 'COMPANY', 'OPERATIONAL'].includes(kind)) throw new BadRequestException('Invalid workspace scope.');
  if (kind === 'TENANT' && !['TENANT_ADMIN', 'SYSTEM_ADMIN'].includes(user.userType)) throw new ForbiddenException('Tenant templates require tenant administration access.');
  const companyId = kind === 'TENANT' ? null : (request.headers['x-active-company-id'] || user.companyId);
  if (kind !== 'TENANT' && !companyId) throw new BadRequestException('Select a company workspace first.');
  if (kind === 'OPERATIONAL' && !activeArea) throw new BadRequestException('Select an operational area first.');
  if (kind !== 'OPERATIONAL' && activeArea) throw new BadRequestException('Area context conflicts with workspace scope.');
  const scope: MasterScope = { kind, companyId, tenantId: request.tenantId || user.tenantId, nobId: activeArea?.nob_id, lobId: activeArea?.lob_id };
  cls.set('masterScope', scope);
  for (const supplied of [request.query?.companyId, request.query?.company_id, request.body?.company_id]) {
    if (supplied && supplied !== companyId) throw new ForbiddenException('Master company must match the workspace.');
  }
  const db = cls.get<MySql2Database<typeof schema>>('tenantDb');
  const columns = getTableColumns(table) as Record<string, AnyMySqlColumn>;
  const checkRecord = async (target: AnyMySqlTable, column: AnyMySqlColumn, value: unknown, field?: string) => {
    // This runs inside a guard, which NestJS executes BEFORE the ValidationPipe —
    // so @IsUUID() has not run and `value` is whatever the caller sent. Passing a
    // non-scalar to eq() builds `col = 1, 'uuid'`, which MySQL rejects with
    // ER_OPERAND_COLUMNS: a 500 carrying the SQL, instead of a 400 naming the field.
    if (typeof value !== 'string' || value.trim() === '') {
      throw new BadRequestException(`'${field ?? column.name}' must be a single identifier.`);
    }
    const constraints = masterScopeConditions(cls, target);
    const targetColumns = getTableColumns(target) as Record<string, AnyMySqlColumn>;
    if (targetColumns.tenant_id) constraints.push(eq(targetColumns.tenant_id, scope.tenantId));
    const [row] = await db.select().from(target).where(and(eq(column, value), ...constraints)).limit(1);
    if (!row) throw new NotFoundException('Master record is not available in this workspace.');
    return row;
  };
  const id = request.params?.id;
  if (id) {
    const primary = Object.values(columns).find((column) => column.primary);
    if (primary) {
      const row = await checkRecord(table, primary, id);
      if (table === schema.breedLifecycleStages && typeof row.breed_id === 'string') await checkRecord(schema.breedMaster, schema.breedMaster.breed_id, row.breed_id);
    }
  }
  if (request.method !== 'POST' && request.method !== 'PUT' && request.method !== 'PATCH') return;
  const body = request.body || {};
  const isCreate = request.method === 'POST' && !id && (!request.route?.path || request.route.path.replace(/\/$/, '').endsWith(`/${conversion ? 'uom/conversion' : controllerPath}`));
  if (isCreate && columns.company_id) {
    if (!companyId && columns.company_id.notNull) throw new BadRequestException('This record requires a company workspace.');
    if (companyId) body.company_id = companyId;
  }
  if (kind === 'OPERATIONAL') {
    for (const [key, value] of [['nob_id', scope.nobId], ['lob_id', scope.lobId]] as const) {
      if (body[key] && body[key] !== value) throw new BadRequestException('NOB/LOB must match the operational area.');
      // Classification is fixed on create; updates need not accept these DTO fields.
      if (isCreate && columns[key]) body[key] = value;
    }
  }
  // Validate submitted master FKs as well as the edited record. A caller cannot
  // attach a company-owned record to another company's item, breed or location.
  for (const fk of getTableConfig(table).foreignKeys) {
    const reference = fk.reference();
    if (!Object.values(MASTER_TABLES).includes(reference.foreignTable)) continue;
    for (let i = 0; i < reference.columns.length; i++) {
      const value = body[reference.columns[i].name];
      if (value) await checkRecord(reference.foreignTable, reference.foreignColumns[i], value, reference.columns[i].name);
    }
  }
  if (table === schema.itemMaster && Array.isArray(body.attributes)) {
    for (const attribute of body.attributes) {
      if (attribute.attribute_id) await checkRecord(schema.itemAttributeMaster, schema.itemAttributeMaster.attribute_id, attribute.attribute_id, 'attributes[].attribute_id');
    }
  }
  if (table === schema.feedFormulaMaster && Array.isArray(body.ingredients)) {
    for (const ingredient of body.ingredients) {
      if (ingredient.item_id) await checkRecord(schema.itemMaster, schema.itemMaster.item_id, ingredient.item_id, 'ingredients[].item_id');
    }
  }
}
