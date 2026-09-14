import { BadRequestException, ForbiddenException, SetMetadata } from '@nestjs/common';
import { and, eq, isNull, sql, SQL } from 'drizzle-orm';
import { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import * as schema from '../core/database/schema';

/**
 * Farm scope — the second access boundary beside company/area.
 *
 * An operational area is a line of business across all of a company's farms,
 * never a farm (decided 2026-09-14), so `operational_area_master.farm_id` is not
 * read here. A farm is a top-level Location Master row; a location belongs to a
 * farm when it is that row or its `farm_id` names it.
 */

export const FARM_SCOPE_KEY = 'farmScope';
export const FARM_SCOPED_KEY = 'farmScoped';

/** User types whose operational reads are bounded by LOB and, for a standard user, one farm. */
export const RESTRICTED_USER_TYPES = ['OPERATIONAL_ADMIN', 'STANDARD_USER'];

export interface FarmScope {
  /** The one farm in force, or null for every farm the company scope allows. */
  farmId: string | null;
  restricted: boolean;
  companyId: string | null;
  /** The validated active area's LOB — restricted users only. */
  lobId: string | null;
}

export const UNRESTRICTED_FARM_SCOPE: FarmScope = { farmId: null, restricted: false, companyId: null, lobId: null };

/** Marks a controller or route whose records belong to a farm. The coverage spec requires it. */
export const FarmScoped = () => SetMetadata(FARM_SCOPED_KEY, true);

/**
 * The scope the guard resolved for this request. Unset means an internal caller
 * (a seed, a job) outside any HTTP request — those run unrestricted by design,
 * and every operational HTTP route is proven marked by farm-scope-coverage.spec.
 */
export function farmScope(cls: ClsService): FarmScope {
  return cls.get<FarmScope>(FARM_SCOPE_KEY) ?? UNRESTRICTED_FARM_SCOPE;
}

export interface ResolveFarmScopeInput {
  user: { userId: string; tenantId: string; companyId: string | null; userType: string; farmId?: string | null };
  headers: Record<string, string | string[] | undefined>;
  activeArea?: { area_id: string; company_id: string; lob_id: string };
  activeCompanyId?: string;
  tenantId: string;
}

type Db = MySql2Database<typeof schema>;

async function activeFarmOfCompany(db: Db, farmId: string, companyId: string | undefined, tenantId: string): Promise<boolean> {
  if (!companyId) return false;
  const [row] = await db
    .select({ location_id: schema.locationMaster.location_id })
    .from(schema.locationMaster)
    .where(and(
      eq(schema.locationMaster.location_id, farmId),
      isNull(schema.locationMaster.parent_location_id),
      eq(schema.locationMaster.company_id, companyId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ))
    .limit(1);
  return Boolean(row);
}

export async function resolveFarmScope(db: Db, input: ResolveFarmScopeInput): Promise<FarmScope> {
  const { user, headers, activeArea, activeCompanyId, tenantId } = input;
  const restricted = RESTRICTED_USER_TYPES.includes(user.userType);
  const requested = typeof headers['x-active-farm-id'] === 'string' ? (headers['x-active-farm-id'] as string) : undefined;

  // Before 14 September the area header was validated only when sent, so a
  // restricted user who omitted it read every operational record.
  if (restricted && !activeArea) throw new BadRequestException('Select an operational area first.');

  // Company-bound users must never become tenant-wide merely because a client
  // omitted the active-company header. Tenant/system admins legitimately have
  // no fixed company and remain unbounded until they select one.
  const assignedCompanyId = ['COMPANY_ADMIN', 'OPERATIONAL_ADMIN', 'STANDARD_USER'].includes(user.userType)
    ? user.companyId
    : null;
  const companyId = activeArea?.company_id ?? activeCompanyId ?? assignedCompanyId ?? null;
  const lobId = restricted ? activeArea!.lob_id : null;

  if (user.userType === 'STANDARD_USER') {
    if (!user.farmId) throw new ForbiddenException('No farm is assigned to this user.');
    if (requested && requested !== user.farmId) throw new ForbiddenException('Not authorized for this farm.');
    if (!(await activeFarmOfCompany(db, user.farmId, companyId ?? undefined, tenantId))) {
      throw new ForbiddenException('Your assigned farm is not an active farm of this company.');
    }
    return { farmId: user.farmId, restricted, companyId, lobId };
  }

  if (requested && !(await activeFarmOfCompany(db, requested, companyId ?? undefined, tenantId))) {
    throw new ForbiddenException('Not authorized for this farm.');
  }
  return { farmId: requested ?? null, restricted, companyId, lobId };
}

/** `column` holds a location on `farmId`: the farm row itself, or a row whose farm_id names it. */
export function locationOnFarm(column: AnyMySqlColumn, farmId: string): SQL {
  return sql`${column} IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ${farmId} OR lf.farm_id = ${farmId})`;
}

/** Scope a row whose only operational boundary is a location/warehouse id. */
export function locationReferenceScopeConditions(scope: FarmScope, locationIdColumn: AnyMySqlColumn): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(locationOnFarm(locationIdColumn, scope.farmId));
  if (scope.companyId) {
    conditions.push(sql`${locationIdColumn} IN (SELECT ls.location_id FROM location_master ls WHERE ls.company_id = ${scope.companyId})`);
  }
  if (scope.restricted && scope.lobId) {
    conditions.push(sql`${locationIdColumn} IN (SELECT ls.location_id FROM location_master ls WHERE ls.lob_id = ${scope.lobId})`);
  }
  return conditions;
}

/** `column` holds a batch whose farm is `farmId`. */
export function batchOnFarm(batchIdColumn: AnyMySqlColumn, farmId: string): SQL {
  return sql`${batchIdColumn} IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ${farmId})`;
}

/** Scope a row that carries a batch id but no direct farm/LOB boundary of its own. */
export function batchReferenceScopeConditions(scope: FarmScope, batchIdColumn: AnyMySqlColumn): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(batchOnFarm(batchIdColumn, scope.farmId));
  if (scope.restricted && scope.lobId) {
    conditions.push(sql`${batchIdColumn} IN (SELECT br.batch_id FROM batch_header br WHERE br.lob_id = ${scope.lobId})`);
  }
  // A selected company is a boundary for company admins as well as restricted
  // operational users. Only the LOB subquery is restricted-user-specific.
  if (scope.companyId) {
    conditions.push(sql`${batchIdColumn} IN (SELECT br.batch_id FROM batch_header br WHERE br.company_id = ${scope.companyId})`);
  }
  return conditions;
}

/** `column` holds an animal standing on `farmId`: by its location, or by its batch when it has none. */
export function animalOnFarm(animalIdColumn: AnyMySqlColumn, farmId: string): SQL {
  return sql`${animalIdColumn} IN (
    SELECT af.animal_id FROM animal_register af
    WHERE af.current_location_id IN (SELECT lf.location_id FROM location_master lf WHERE lf.location_id = ${farmId} OR lf.farm_id = ${farmId})
       OR (af.current_location_id IS NULL AND af.current_batch_id IN (SELECT bf.batch_id FROM batch_header bf WHERE bf.farm_id = ${farmId}))
  )`;
}

/**
 * The selected-company and restricted-LOB half of a caller's scope. Every
 * farm-scoped surface needs it because farmId may legitimately be null. Pass
 * whichever of the two columns the table actually has.
 */
export function restrictedScopeConditions(
  scope: FarmScope,
  columns: { companyId?: AnyMySqlColumn; lobId?: AnyMySqlColumn },
): SQL[] {
  const conditions: SQL[] = [];
  // A selected/assigned company is a boundary for company admins too; only the
  // LOB boundary is specific to operationally restricted users.
  if (columns.lobId && scope.lobId) conditions.push(eq(columns.lobId, scope.lobId));
  if (columns.companyId && scope.companyId) conditions.push(eq(columns.companyId, scope.companyId));
  return conditions;
}

export function assertCompanyInScope(scope: FarmScope, companyId: string): void {
  if (scope.companyId && companyId !== scope.companyId) {
    throw new ForbiddenException('Not authorized for this company.');
  }
}

export function assertLobInScope(scope: FarmScope, lobId: string | null | undefined): void {
  if (scope.restricted && scope.lobId && lobId !== scope.lobId) {
    throw new ForbiddenException('Not authorized for this line of business.');
  }
}

/** For queries on batch_header itself. */
export function batchScopeConditions(scope: FarmScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(eq(schema.batchHeader.farm_id, scope.farmId));
  conditions.push(...restrictedScopeConditions(scope, {
    companyId: schema.batchHeader.company_id,
    lobId: schema.batchHeader.lob_id,
  }));
  return conditions;
}

/** For queries on animal_register itself. */
export function animalScopeConditions(scope: FarmScope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.farmId) conditions.push(animalOnFarm(schema.animalRegister.animal_id, scope.farmId));
  conditions.push(...restrictedScopeConditions(scope, {
    companyId: schema.animalRegister.company_id,
    lobId: schema.animalRegister.lob_id,
  }));
  return conditions;
}

/** The farm a location belongs to, or null if the location does not exist. */
export async function farmOfLocation(db: Db, locationId: string): Promise<string | null> {
  const [row] = await db
    .select({ location_id: schema.locationMaster.location_id, parent: schema.locationMaster.parent_location_id, farm_id: schema.locationMaster.farm_id })
    .from(schema.locationMaster)
    .where(eq(schema.locationMaster.location_id, locationId))
    .limit(1);
  if (!row) return null;
  return row.parent === null ? row.location_id : row.farm_id;
}

/** A create or update naming a location must stay on the active farm. Locations are visible masters, so this is a 403, not a 404. */
export async function assertLocationOnActiveFarm(db: Db, scope: FarmScope, locationId: string | null | undefined, label: string): Promise<void> {
  if (!locationId) return;
  if (!scope.farmId && !scope.companyId && !scope.lobId) return;
  const [row] = await db.select({
    company_id: schema.locationMaster.company_id,
    lob_id: schema.locationMaster.lob_id,
    location_id: schema.locationMaster.location_id,
    parent: schema.locationMaster.parent_location_id,
    farm_id: schema.locationMaster.farm_id,
  }).from(schema.locationMaster).where(eq(schema.locationMaster.location_id, locationId)).limit(1);
  const actualFarm = row ? (row.parent === null ? row.location_id : row.farm_id) : null;
  if (!row || (scope.companyId && row.company_id !== scope.companyId) ||
      (scope.restricted && scope.lobId && row.lob_id && row.lob_id !== scope.lobId) ||
      (scope.farmId && actualFarm !== scope.farmId)) {
    throw new ForbiddenException(`${label} is not on your active farm.`);
  }
}
