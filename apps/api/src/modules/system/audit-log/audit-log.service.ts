import { Injectable } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, desc, gte, lte, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService, CLS_REQ } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';

/**
 * Column names whose values never belong in an audit row. `findById` style
 * reads return the whole user_master row, so a caller passing it as oldValues
 * would otherwise copy a password hash into a table every admin can read.
 */
const SECRET_KEY = /(password|secret|token|api_key|apikey|private_key)/i;

function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 6) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === 'function') continue;
      out[key] = SECRET_KEY.test(key) ? (v === null || v === undefined ? v ?? null : '[redacted]') : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /** The HTTP request of the current call, when there is one (seeds and jobs have none). */
  private request(): any {
    try {
      return this.cls.get(CLS_REQ as any) ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Who and where come from the validated request when the caller does not say.
   * Before this, a service that forgot `userId` (role creation, tenant changes)
   * wrote a row the ledger showed as "System" even though a person made it.
   */
  async log(
    params: {
      tenantId?: string;
      companyId?: string;
      userId?: string;
      action: string;
      entityName: string;
      entityId: string;
      oldValues?: any;
      newValues?: any;
      ipAddress?: string;
      userAgent?: string;
    },
    tx?: any,
  ) {
    const dbClient = tx || this.db;
    const req = this.request();
    const requestUser = req?.user;
    const auditId = randomUUID();
    const userAgent = params.userAgent || (typeof req?.headers?.['user-agent'] === 'string' ? req.headers['user-agent'] : null);
    await dbClient
      .insert(schema.auditLog)
      .values({
        audit_id: auditId,
        tenant_id: params.tenantId || requestUser?.tenantId || this.cls.get<string>('tenantId'),
        // A key passed as undefined means "no company" (a tenant template); only
        // a caller that never mentions the company inherits the actor's.
        company_id: params.companyId || ('companyId' in params ? null : requestUser?.companyId || null),
        user_id: params.userId || requestUser?.userId || null,
        action: params.action,
        entity_name: params.entityName,
        entity_id: params.entityId,
        old_values: params.oldValues ? redact(params.oldValues) : null,
        new_values: params.newValues ? redact(params.newValues) : null,
        ip_address: params.ipAddress || (req?.ip ? String(req.ip).slice(0, 50) : null),
        user_agent: userAgent,
      });

    const [entry] = await dbClient
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.audit_id, auditId))
      .limit(1);
    return entry;
  }

  /**
   * The before/after form of `log`, for a service that has the row in hand on
   * both sides of a write. Two things it does that a raw `log` call site kept
   * forgetting: it always carries `oldValues` (a restore used to record only
   * the new state, so the ledger could not say what was restored from), and it
   * never lets a failed audit write abort the business write that succeeded.
   */
  async recordChange(params: {
    action: string;
    entityName: string;
    entityId: string;
    before?: Record<string, any> | null;
    after?: Record<string, any> | null;
    tenantId?: string;
    companyId?: string;
    userId?: string;
  }) {
    const row = params.after ?? params.before ?? null;
    try {
      await this.log({
        tenantId: params.tenantId || (row?.tenant_id as string | undefined),
        companyId: params.companyId || (row?.company_id as string | undefined) || undefined,
        userId: params.userId,
        action: params.action,
        entityName: params.entityName,
        entityId: params.entityId,
        oldValues: params.before ?? undefined,
        newValues: params.after ?? undefined,
      });
    } catch (e) {
      console.error(`Failed to write ${params.action} audit row for ${params.entityName} ${params.entityId}:`, e);
    }
  }

  /**
   * A human handle for the row the entry is about, read out of the values the
   * entry already carries — the ledger stores only an id, and an admin reading
   * it should not have to look up which disease `9f3a…` was.
   */
  private entityLabel(values: unknown): { code: string | null; name: string | null } {
    if (!values || typeof values !== 'object' || Array.isArray(values)) return { code: null, name: null };
    const row = values as Record<string, unknown>;
    const pick = (suffix: string) => {
      for (const [key, v] of Object.entries(row)) {
        if (key.endsWith(suffix) && typeof v === 'string' && v.trim()) return v;
      }
      return null;
    };
    // `full_name` on a user snapshot ends in _name too, so one pass covers both.
    return { code: pick('_code'), name: pick('_name') };
  }

  async findLogs(filters: {
    tenantId?: string;
    companyId?: string;
    userId?: string;
    action?: string;
    entityName?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  }) {
    const conditions: any[] = [];

    if (filters.tenantId) {
      conditions.push(eq(schema.auditLog.tenant_id, filters.tenantId));
    }
    if (filters.companyId) {
      conditions.push(eq(schema.auditLog.company_id, filters.companyId));
    }
    if (filters.userId) {
      conditions.push(eq(schema.auditLog.user_id, filters.userId));
    }
    if (filters.action) {
      conditions.push(eq(schema.auditLog.action, filters.action));
    }
    if (filters.entityName) {
      conditions.push(eq(schema.auditLog.entity_name, filters.entityName));
    }
    if (filters.startDate) {
      conditions.push(gte(schema.auditLog.created_at, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(schema.auditLog.created_at, filters.endDate));
    }

    const limit = Math.min(filters.limit || 50, 500);
    const offset = filters.offset || 0;

    const rows = await this.db
      .select({
        audit_id: schema.auditLog.audit_id,
        tenant_id: schema.auditLog.tenant_id,
        company_id: schema.auditLog.company_id,
        company_name: schema.companyMaster.company_name,
        user_id: schema.auditLog.user_id,
        action: schema.auditLog.action,
        entity_name: schema.auditLog.entity_name,
        entity_id: schema.auditLog.entity_id,
        old_values: schema.auditLog.old_values,
        new_values: schema.auditLog.new_values,
        ip_address: schema.auditLog.ip_address,
        user_agent: schema.auditLog.user_agent,
        created_at: schema.auditLog.created_at,
        user_name: schema.userMaster.full_name,
        user_email: schema.userMaster.email,
        user_type: schema.userMaster.user_type,
      })
      .from(schema.auditLog)
      .leftJoin(schema.userMaster, eq(schema.auditLog.user_id, schema.userMaster.user_id))
      .leftJoin(schema.companyMaster, eq(schema.auditLog.company_id, schema.companyMaster.company_id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schema.auditLog.created_at))
      .limit(limit)
      .offset(offset);

    // The actor's assigned role names, read once for the page rather than per row.
    const userIds = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => Boolean(id)))];
    const rolesByUser = new Map<string, string[]>();
    if (userIds.length > 0) {
      const assignments = await this.db
        .select({ user_id: schema.userRoleAssignment.user_id, role_name: schema.roleMaster.role_name })
        .from(schema.userRoleAssignment)
        .innerJoin(schema.roleMaster, eq(schema.userRoleAssignment.role_id, schema.roleMaster.role_id))
        .where(and(inArray(schema.userRoleAssignment.user_id, userIds), eq(schema.userRoleAssignment.is_active, true)));
      for (const a of assignments) {
        rolesByUser.set(a.user_id, [...(rolesByUser.get(a.user_id) ?? []), a.role_name]);
      }
    }

    return rows.map((r) => {
      // Prefer the after state's handle; a delete has only the before state.
      const after = this.entityLabel(r.new_values);
      const before = this.entityLabel(r.old_values);
      return {
        ...r,
        user_roles: r.user_id ? rolesByUser.get(r.user_id) ?? [] : [],
        entity_code: after.code ?? before.code,
        entity_label: after.name ?? before.name,
      };
    });
  }
}
