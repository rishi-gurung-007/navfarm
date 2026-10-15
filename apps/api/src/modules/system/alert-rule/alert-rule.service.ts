import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { farmScope, nullableFarmScopeConditions } from '../../../common/farm-scope';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';
import { AuditLogService } from '../audit-log/audit-log.service';
import { alertRuleProblems } from './alert-rule.rules';
import { CreateAlertRuleDto, QueryAlertRuleDto, UpdateAlertRuleDto } from './alert-rule.dto';

const table = schema.alertRule;
const nowTs = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** HEAD_OF_FARM is alert-rule legacy configuration, never a stored user type. */
export const normalizeFeedRecipientRole = (role: string): string =>
  role === 'HEAD_OF_FARM' ? 'OPERATIONAL_ADMIN' : role;

/**
 * The rules the feed workbook itself seeds (first five) per company (0118's own
 * INSERT, verbatim): FEED-BELOW-L1 (§4 column F, CRITICAL_FIRST_PRIORITY,
 * escalating after 4h to HEAD_OF_FARM), FEED-ABOVE (checkpoint 13, INFO),
 * DIET-CHANGE (checkpoint 30, 3 days, WARNING), REQ-REMINDER (Q6's Friday
 * reminder) and REQ-OVERDUE (checkpoint 20's Saturday CRITICAL). Kept here,
 * not only in the migration, so ensureDefaultRules (M8) can insert the same
 * rows for a company created after 0118 ran.
 */
const DEFAULT_RULES: Array<{
  notification_code: string; notification_name: string; event_type: string; trigger_entity: string;
  threshold_reference: string; threshold_value: number | null; priority_level: string; recipient_roles: string[];
  delivery_channel: string; frequency: string; escalation_after_hours: number | null; escalation_role: string | null;
}> = [
  { notification_code: 'FEED-BELOW-L1', notification_name: 'Low silo feed, first priority', event_type: 'FEED_BELOW_L1', trigger_entity: 'SILO', threshold_reference: 'SILO_BELOW', threshold_value: null, priority_level: 'CRITICAL_FIRST_PRIORITY', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ESCALATING', escalation_after_hours: 4, escalation_role: 'HEAD_OF_FARM' },
  { notification_code: 'FEED-ABOVE', notification_name: 'Silo feed above high level, do not order', event_type: 'FEED_ABOVE', trigger_entity: 'SILO', threshold_reference: 'SILO_ABOVE', threshold_value: null, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'DIET-CHANGE', notification_name: 'Diet change within 3 days', event_type: 'DIET_CHANGE', trigger_entity: 'FEED_PLAN', threshold_reference: 'FIXED_VALUE', threshold_value: 3, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'REQ-REMINDER', notification_name: 'Requisition not yet approved', event_type: 'REQ_DEADLINE', trigger_entity: 'REQUISITION', threshold_reference: 'FIXED_VALUE', threshold_value: 1, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'REQ-OVERDUE', notification_name: 'Requisition deadline reached', event_type: 'REQ_DEADLINE', trigger_entity: 'REQUISITION', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'CRITICAL', recipient_roles: ['FARM_MANAGER', 'HEAD_OF_FARM'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'PLAN-AVAILABLE', notification_name: 'Feed plan available', event_type: 'PLAN_AVAILABLE', trigger_entity: 'FEED_PLAN', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  // W4G1 (11 Oct). The days in threshold_value are the look-ahead window for the two evaluated events; the pushed ones ignore it.
  { notification_code: 'MILL-DISPATCH', notification_name: 'Feed dispatched from the mill', event_type: 'MILL_DISPATCH', trigger_entity: 'LOADING_SHEET', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'MILL-ADJUSTED', notification_name: 'Mill approved a different quantity', event_type: 'MILL_ADJUSTED', trigger_entity: 'CONSOLIDATION', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'RECEIPT-VARIANCE', notification_name: 'Feed receipt short of shipment', event_type: 'RECEIPT_VARIANCE', trigger_entity: 'RECEIPT', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'WARNING', recipient_roles: ['HEAD_OF_FARM', 'MILL_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'NO-NEXT-FEED-ROW', notification_name: 'No next feed row for a batch', event_type: 'NO_NEXT_FEED_ROW', trigger_entity: 'BATCH', threshold_reference: 'FIXED_VALUE', threshold_value: 7, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'NEXT-DIET-NO-SILO', notification_name: 'No silo for the next diet', event_type: 'NEXT_DIET_NO_SILO', trigger_entity: 'FEED_PLAN', threshold_reference: 'FIXED_VALUE', threshold_value: 7, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'CAPACITY-EXCEEDED', notification_name: 'Approved demand exceeds mill capacity', event_type: 'CAPACITY_EXCEEDED', trigger_entity: 'CONSOLIDATION', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'CRITICAL', recipient_roles: ['MILL_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  // W5A (11 Oct). SHORTFALL / NOT_DRAFTED / TRUCK_TARGET are evaluated (Engine rows 60-62; threshold = kg that must be exceeded, 0 = any);
  // AUTO_DRAFTED (Req. row 80), STOCK_TAKE_DUE (Master row 45; threshold = days before the stock take date) and CHANGEOVER (checkpoint 5) are pushed.
  { notification_code: 'SHORTFALL', notification_name: 'Projected shortfall in a silo', event_type: 'SHORTFALL', trigger_entity: 'SILO', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'NOT-DRAFTED', notification_name: 'Shortfall with no requisition drafted', event_type: 'NOT_DRAFTED', trigger_entity: 'SILO', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'TRUCK-TARGET', notification_name: 'Farm order below the truck target', event_type: 'TRUCK_TARGET', trigger_entity: 'FEED_PLAN', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'AUTO-DRAFTED', notification_name: 'Requisition auto-drafted for review', event_type: 'AUTO_DRAFTED', trigger_entity: 'REQUISITION', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'INFO', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'STOCK-TAKE-DUE', notification_name: 'Monthly stock take due', event_type: 'STOCK_TAKE_DUE', trigger_entity: 'STOCK_TAKE', threshold_reference: 'FIXED_VALUE', threshold_value: 3, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER', 'HEAD_OF_FARM'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
  { notification_code: 'CHANGEOVER', notification_name: 'Silo changeover needed before approval', event_type: 'CHANGEOVER', trigger_entity: 'REQUISITION', threshold_reference: 'FIXED_VALUE', threshold_value: 0, priority_level: 'WARNING', recipient_roles: ['FARM_MANAGER'], delivery_channel: 'IN_APP', frequency: 'ONCE', escalation_after_hours: null, escalation_role: null },
];

/** The recipient and escalation codes the default rules use: user types, not Role Master rows (decisions 11 Oct). */
const DEFAULT_RULE_USER_TYPES: string[] = [...new Set(DEFAULT_RULES.flatMap((r) => [...r.recipient_roles, ...(r.escalation_role ? [r.escalation_role] : [])]))];

/**
 * Alerts and Notifications Master CRUD (Master Setup §4). Scoped like every
 * other master (master-data-scope.ts). A rule is never deleted: deactivating
 * it is §4 row 55's "temporary suppression without deleting the rule", and the
 * evaluator then resolves its open alerts (Task 6, reason RULE_OFF).
 */
@Injectable()
export class AlertRuleService {
  constructor(private readonly cls: ClsService, private readonly audit: AuditLogService) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private scope(tenantId: string) {
    return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table), ...nullableFarmScopeConditions(farmScope(this.cls), table.farm_id)];
  }

  /**
   * M8: the migration seeds these five rows per company that existed when
   * 0118 ran; a company created afterwards has none. Called at the start of
   * findAll (and again by Task 6 before evaluating) so the gap never shows —
   * idempotent, inserting only the codes this company is missing.
   *
   * Fix round 1: the read-then-insert above is not itself atomic, so two
   * concurrent callers can both see a code as missing and both try to insert
   * it. `ON DUPLICATE KEY UPDATE` on the row's own unique key (tenant,
   * company, notification_code) turns the loser's insert into a no-op —
   * setting a column to itself changes nothing but still counts as the
   * "duplicate" branch, so MySQL never raises ER_DUP_ENTRY here. Any other
   * failure (a bad FK, a full disk, …) is a different error class and still
   * throws, same as an unguarded insert would.
   */
  async ensureDefaultRules(companyId: string, tenantId: string): Promise<void> {
    const existing = await this.db.select({ code: table.notification_code }).from(table).where(and(
      eq(table.tenant_id, tenantId), eq(table.company_id, companyId),
      inArray(table.notification_code, DEFAULT_RULES.map((rule) => rule.notification_code)),
    ));
    const have = new Set(existing.map((row) => row.code));
    const missing = DEFAULT_RULES.filter((rule) => !have.has(rule.notification_code));
    if (!missing.length) return;
    await this.db.insert(table).values(missing.map((rule) => ({
      rule_id: randomUUID(), tenant_id: tenantId, company_id: companyId,
      notification_code: rule.notification_code, notification_name: rule.notification_name,
      event_type: rule.event_type, trigger_entity: rule.trigger_entity, threshold_reference: rule.threshold_reference,
      threshold_value: rule.threshold_value == null ? null : String(rule.threshold_value),
      priority_level: rule.priority_level, recipient_roles: rule.recipient_roles, delivery_channel: rule.delivery_channel,
      frequency: rule.frequency, escalation_after_hours: rule.escalation_after_hours, escalation_role: rule.escalation_role,
    }))).onDuplicateKeyUpdate({ set: { notification_code: sql`${table.notification_code}` } });
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.rule_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Alert rule is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryAlertRuleDto, tenantId: string) {
    // L15/M8: the caller's company — the active workspace scope if one is set,
    // otherwise the query's own companyId — gets its defaults ensured before
    // the list reads back, so a company created after 0118 still sees them.
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    const companyId = scope?.kind ? scope.companyId : query.companyId;
    // Rishi, 12 Oct: no default rules are created on read — a new company's Alert Rules start blank.
    void companyId;
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.eventType) conditions.push(eq(table.event_type, query.eventType));
    conditions.push(...listFilterConditions(table, query.filter));
    return this.db.select().from(table).where(and(...conditions)).orderBy(listOrderBy(table, query, table.notification_code)).limit(query.limit || 50).offset(query.offset || 0);
  }

  private assertShape(rule: Parameters<typeof alertRuleProblems>[0]) {
    const problems = alertRuleProblems(rule);
    if (problems.length) throw new BadRequestException(problems.join(' '));
  }

  /** Row 56: a farm filter must be a top-level FARM of the rule's company. */
  private async assertFarm(farmId: string | null | undefined, companyId: string | null | undefined, tenantId: string) {
    const scope = farmScope(this.cls);
    if (scope.farmBound && !farmId) throw new BadRequestException('A Farm Filter is required for your assigned farm.');
    if (scope.farmId && farmId && scope.farmId !== farmId) throw new BadRequestException('Farm Filter is outside the active farm.');
    if (scope.farmBound && farmId !== scope.farmId) throw new BadRequestException('Farm Filter is outside your assigned farm.');
    if (!farmId) return;
    const [farm] = await this.db.select({ id: schema.locationMaster.location_id }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.location_id, farmId), eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.location_type, 'FARM'), isNull(schema.locationMaster.deleted_at),
      ...(companyId ? [eq(schema.locationMaster.company_id, companyId)] : []),
    )).limit(1);
    if (!farm) throw new BadRequestException('Farm Filter must be a farm of this company.');
  }

  /**
   * Row 45: "Only one low feed event applies per silo" — one active
   * FEED_BELOW_L1 rule per company and farm filter.
   *
   * Fix round 1: this was asymmetric. A farm-specific rule (farm_id set)
   * correctly checked "same farm OR a company-wide rule" — a company-wide
   * rule applies to every farm, so it always clashes. But a company-wide new
   * rule (farm_id null) only checked other farm_id-IS-NULL rows, missing any
   * already-active farm-specific rule it would also cover. A company-wide
   * rule must clash with ANY other active FEED_BELOW_L1 rule of the company,
   * so no farm filter is added at all in that case — every farm_id, null or
   * not, is a candidate clash.
   */
  private async assertSingleLowRule(rule: { event_type: string; company_id: string | null; farm_id: string | null; is_active: boolean }, tenantId: string, excludeId?: string) {
    if (rule.event_type !== 'FEED_BELOW_L1' || !rule.is_active) return;
    // Final review minor 1: a tenant-wide rule (company_id NULL) is evaluated
    // for every company's farms (feed-alert loadRules), so it is the same
    // event as any company's low rule. A new tenant-wide rule therefore
    // clashes with every active low rule of the tenant, and a company rule
    // clashes with its own company's (farm-filtered as above) or with any
    // active tenant-wide one.
    const scope = rule.company_id
      ? [or(
          and(eq(table.company_id, rule.company_id), ...(rule.farm_id ? [or(eq(table.farm_id, rule.farm_id), isNull(table.farm_id))!] : [])),
          isNull(table.company_id),
        )!]
      : [];
    const [clash] = await this.db.select({ rule_id: table.rule_id, notification_code: table.notification_code }).from(table).where(and(
      eq(table.tenant_id, tenantId), eq(table.event_type, 'FEED_BELOW_L1'), eq(table.is_active, true),
      ...scope,
      ...(excludeId ? [ne(table.rule_id, excludeId)] : []),
    )).limit(1);
    if (clash) throw new ConflictException(`Only one low feed rule applies per silo; ${clash.notification_code} already covers these farms.`);
  }

  /**
   * Rows 50 and 54 (W4G2): recipient and escalation roles are Role Master codes
   * of the rule's company (every company of the tenant for a tenant-wide rule).
   * A code the rule already stores is left alone, so a legacy free-text value
   * that was working keeps working; only a code being added is checked.
   */
  async roleOptions(tenantId: string, companyId?: string | null) {
    const R = schema.roleMaster;
    const scope = this.cls.get<MasterScope | undefined>('masterScope');
    const company = companyId ?? (scope?.kind ? scope.companyId : null);
    const rows = await this.db.select({ role_code: R.role_code, role_name: R.role_name }).from(R)
      .innerJoin(schema.companyMaster, eq(schema.companyMaster.company_id, R.company_id))
      .where(and(eq(schema.companyMaster.tenant_id, tenantId), eq(R.is_active, true), ...(company ? [eq(R.company_id, company)] : [])));
    const byCode = new Map<string, { role_code: string; role_name: string }>();
    for (const row of rows) if (!byCode.has(row.role_code)) byCode.set(row.role_code, row);
    // Decisions 11 Oct: the user types the default rules send to are valid recipients too; a Role Master row of the same code wins.
    for (const code of DEFAULT_RULE_USER_TYPES) if (!byCode.has(code)) byCode.set(code, { role_code: code, role_name: code.split('_').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') });
    return [...byCode.values()].sort((a, b) => a.role_code.localeCompare(b.role_code));
  }

  private async assertRoles(
    next: { recipient_roles?: string[] | null; escalation_role?: string | null },
    stored: { recipient_roles?: string[] | null; escalation_role?: string | null } | null,
    companyId: string | null | undefined,
    tenantId: string,
  ) {
    const keep = new Set([...(stored?.recipient_roles ?? []), stored?.escalation_role].filter(Boolean).map((c) => String(c).toUpperCase()));
    const asked = [...(next.recipient_roles ?? []), next.escalation_role].filter(Boolean).map((c) => String(c).toUpperCase());
    const added = [...new Set(asked.filter((code) => !keep.has(code)))];
    if (!added.length) return;
    const known = new Set((await this.roleOptions(tenantId, companyId)).map((r) => r.role_code.toUpperCase()));
    const unknown = added.filter((code) => !known.has(code));
    if (unknown.length) {
      throw new BadRequestException(`Role code ${unknown.join(', ')} is not in the Role Master for this company. Pick the recipient roles from the Role Master.`);
    }
  }

  private async log(action: string, row: typeof table.$inferSelect, user: any, oldValues?: unknown) {
    await this.audit.log({ tenantId: row.tenant_id, companyId: row.company_id || undefined, userId: user?.userId, action, entityName: 'alert_rule', entityId: row.rule_id, oldValues, newValues: row });
    return row;
  }

  async create(dto: CreateAlertRuleDto, tenantId: string, user?: any) {
    const code = dto.notification_code.trim().toUpperCase();
    this.assertShape({ ...dto, recipient_roles: dto.recipient_roles ?? [] });
    await this.assertSingleLowRule({ event_type: dto.event_type, company_id: dto.company_id ?? null, farm_id: dto.farm_id ?? null, is_active: true }, tenantId);
    await this.assertFarm(dto.farm_id, dto.company_id, tenantId);
    await this.assertRoles({ recipient_roles: dto.recipient_roles, escalation_role: dto.escalation_role }, null, dto.company_id, tenantId);
    const rule_id = randomUUID();
    await this.db.insert(table).values({
      rule_id, tenant_id: tenantId, company_id: dto.company_id ?? null, notification_code: code,
      notification_name: dto.notification_name.trim(), event_type: dto.event_type, trigger_entity: dto.trigger_entity,
      threshold_reference: dto.threshold_reference, threshold_value: dto.threshold_value == null ? null : String(dto.threshold_value),
      priority_level: dto.priority_level, recipient_roles: dto.recipient_roles, delivery_channel: dto.delivery_channel,
      frequency: dto.frequency, escalation_after_hours: dto.escalation_after_hours ?? null, escalation_role: dto.escalation_role ?? null,
      farm_id: dto.farm_id ?? null, created_by: user?.userId, updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(rule_id, tenantId), user);
  }

  async update(id: string, dto: UpdateAlertRuleDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.notification_code !== undefined && dto.notification_code.trim().toUpperCase() !== before.notification_code) {
      throw new BadRequestException('Notification codes cannot be renamed. Deactivate the rule and create a new one.');
    }
    const merged = {
      event_type: dto.event_type ?? before.event_type,
      trigger_entity: dto.trigger_entity ?? before.trigger_entity,
      threshold_reference: dto.threshold_reference ?? before.threshold_reference,
      threshold_value: dto.threshold_value !== undefined ? dto.threshold_value : before.threshold_value == null ? null : Number(before.threshold_value),
      priority_level: dto.priority_level ?? before.priority_level,
      recipient_roles: dto.recipient_roles ?? (before.recipient_roles as string[]),
      delivery_channel: dto.delivery_channel ?? before.delivery_channel,
      frequency: dto.frequency ?? before.frequency,
      escalation_after_hours: dto.escalation_after_hours !== undefined ? dto.escalation_after_hours : before.escalation_after_hours,
      escalation_role: dto.escalation_role !== undefined ? dto.escalation_role : before.escalation_role,
      farm_id: dto.farm_id !== undefined ? dto.farm_id : before.farm_id,
    };
    this.assertShape(merged);
    await this.assertSingleLowRule({ event_type: merged.event_type, company_id: before.company_id, farm_id: merged.farm_id ?? null, is_active: before.is_active }, tenantId, id);
    await this.assertFarm(merged.farm_id, before.company_id, tenantId);
    await this.assertRoles(
      { recipient_roles: dto.recipient_roles, escalation_role: dto.escalation_role },
      { recipient_roles: before.recipient_roles as string[], escalation_role: before.escalation_role },
      before.company_id, tenantId,
    );
    await this.db.update(table).set({
      notification_name: dto.notification_name?.trim() ?? before.notification_name,
      ...merged,
      threshold_value: merged.threshold_value == null ? null : String(merged.threshold_value),
      farm_id: merged.farm_id ?? null,
      updated_by: user?.userId, updated_at: nowTs(),
    }).where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active) await this.assertSingleLowRule({ event_type: before.event_type, company_id: before.company_id, farm_id: before.farm_id, is_active: true }, tenantId, id);
    const now = nowTs();
    await this.db.update(table).set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId })
      .where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}
