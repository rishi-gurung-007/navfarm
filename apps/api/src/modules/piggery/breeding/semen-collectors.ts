import { BadRequestException } from '@nestjs/common';
import { and, asc, eq, isNull, or, gt, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';

/** The role whose holders are the AI Station's collectors. Collectors are users (User Management), not a master. */
export const SEMEN_COLLECTOR_ROLE_CODE = 'SEMEN_COLLECTOR';

type Db = MySql2Database<typeof schema>;

/** The Collector ID shown on the sheets (CM, AW, TA): the user's Employee ID, else the name. */
export const collectorCodeOf = (u: { employee_id: string | null; full_name: string }) => u.employee_id?.trim() || u.full_name;

/** The same code in SQL, for the joins that show who collected. */
export const collectorCodeSql = sql<string | null>`coalesce(nullif(trim(${schema.userMaster.employee_id}), ''), ${schema.userMaster.full_name})`;

/** Active, undeleted users of `companyId` who hold the Semen Collector role now. */
export async function listCollectors(db: Db, tenantId: string, companyId: string | null) {
  const rows = await db
    .select({
      user_id: schema.userMaster.user_id,
      full_name: schema.userMaster.full_name,
      employee_id: schema.userMaster.employee_id,
    })
    .from(schema.userMaster)
    .innerJoin(schema.userRoleAssignment, eq(schema.userRoleAssignment.user_id, schema.userMaster.user_id))
    .innerJoin(schema.roleMaster, eq(schema.roleMaster.role_id, schema.userRoleAssignment.role_id))
    .where(
      and(
        eq(schema.userMaster.tenant_id, tenantId),
        eq(schema.userMaster.is_active, true),
        isNull(schema.userMaster.deleted_at),
        eq(schema.userRoleAssignment.is_active, true),
        or(isNull(schema.userRoleAssignment.expires_at), gt(schema.userRoleAssignment.expires_at, sql`now()`)),
        eq(schema.roleMaster.role_code, SEMEN_COLLECTOR_ROLE_CODE),
        eq(schema.roleMaster.is_active, true),
        ...(companyId ? [eq(schema.roleMaster.company_id, companyId)] : []),
      ),
    )
    .orderBy(asc(schema.userMaster.full_name));
  const users = [...new Map(rows.map((u) => [u.user_id, u])).values()];
  return users.map((u) => ({ ...u, collector_id: u.user_id, collector_code: collectorCodeOf(u), collector_name: u.full_name }));
}

/** Every collector named must be an active holder of the Semen Collector role in the company. */
export async function assertCollectors(db: Db, ids: (string | null | undefined)[], tenantId: string, companyId: string | null) {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return;
  const have = new Set((await listCollectors(db, tenantId, companyId)).map((c) => c.user_id));
  if (wanted.some((id) => !have.has(id))) {
    throw new BadRequestException('Select active users with the Semen Collector role.');
  }
}
