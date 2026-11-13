import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { masterScopeConditions, MasterScope } from '../../../common/master-data-scope';
import { CreateGlPostingGroupDto, QueryGlPostingGroupDto, UpdateGlPostingGroupDto } from './dto/gl-posting-group.dto';
import {
  ACCOUNT_FIELDS, ACCOUNT_LABELS, accountsOfKind, changedAccounts, fieldsOfKind, GroupAccounts, groupFitsItem, itemColumnsFromGroup, validateGroup,
} from './gl-posting-group.rules';

type Group = typeof schema.glPostingGroup.$inferSelect;

@Injectable()
export class GlPostingGroupService {
  constructor(private readonly cls: ClsService, private readonly auditService: AuditLogService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  private companyOf(dto: { company_id?: string }): string {
    const scope = this.cls.get<MasterScope>('masterScope');
    const company = scope?.companyId ?? dto.company_id;
    if (!company) throw new BadRequestException('Choose the company the posting group belongs to.');
    return company;
  }

  async findOne(id: string): Promise<Group> {
    const [group] = await this.db.select().from(schema.glPostingGroup).where(eq(schema.glPostingGroup.posting_group_id, id)).limit(1);
    if (!group) throw new NotFoundException(`Posting group '${id}' not found.`);
    return group;
  }

  /** Every account given must be a live account of the company: an inactive or deleted one would break the first posting. */
  private async assertAccountsUsable(companyId: string, tenantId: string, accounts: GroupAccounts) {
    const ids = [...new Set(ACCOUNT_FIELDS.map((f) => accounts[f]).filter((v): v is string => !!v))];
    if (!ids.length) return;
    const rows = await this.db.select().from(schema.glAccountMaster).where(inArray(schema.glAccountMaster.gl_account_id, ids));
    for (const f of ACCOUNT_FIELDS) {
      const id = accounts[f];
      if (!id) continue;
      const row = rows.find((r) => r.gl_account_id === id);
      if (!row || row.tenant_id !== tenantId || row.company_id !== companyId || row.deleted_at) throw new BadRequestException(`${ACCOUNT_LABELS[f]}: select an account of this company.`);
      if (row.is_active === false) throw new BadRequestException(`${ACCOUNT_LABELS[f]}: ${row.account_code} is inactive.`);
    }
  }

  private itemsOf(groupId: string) {
    return this.db
      .select()
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.posting_group_id, groupId), isNull(schema.itemMaster.deleted_at)));
  }

  /** Items of the group whose animals a costing run has charged: the group's accounts are then fixed. */
  private async chargedItems(itemIds: string[]): Promise<string[]> {
    if (!itemIds.length) return [];
    const rows = await this.db
      .selectDistinct({ id: schema.animalRegister.item_id })
      .from(schema.bioCostingRunLine)
      .innerJoin(schema.animalRegister, eq(schema.animalRegister.animal_id, schema.bioCostingRunLine.animal_id))
      .where(and(inArray(schema.animalRegister.item_id, itemIds), eq(schema.bioCostingRunLine.status, 'CHARGED')));
    return rows.map((r) => r.id as string);
  }

  async create(dto: CreateGlPostingGroupDto, tenantId: string, user?: any) {
    const companyId = this.companyOf(dto);
    const code = dto.group_code.trim().toUpperCase();
    const accounts = accountsOfKind(dto.kind, dto as GroupAccounts);
    const problems = validateGroup(dto.kind, code, dto.group_name, dto as GroupAccounts);
    if (problems.length) throw new BadRequestException(problems);
    await this.assertAccountsUsable(companyId, tenantId, accounts);
    const [dup] = await this.db
      .select({ id: schema.glPostingGroup.posting_group_id })
      .from(schema.glPostingGroup)
      .where(and(eq(schema.glPostingGroup.tenant_id, tenantId), eq(schema.glPostingGroup.company_id, companyId), eq(schema.glPostingGroup.group_code, code)))
      .limit(1);
    if (dup) throw new ConflictException(`A posting group with code ${code} already exists.`);

    const row = { posting_group_id: randomUUID(), tenant_id: tenantId, company_id: companyId, group_code: code, group_name: dto.group_name.trim(), kind: dto.kind, ...accounts, created_by: user?.userId ?? null };
    await this.db.insert(schema.glPostingGroup).values(row);
    await this.auditService.log({ tenantId, companyId, userId: user?.userId, action: 'CREATE', entityName: 'gl_posting_group', entityId: row.posting_group_id, newValues: row });
    return this.findOneDetailed(row.posting_group_id);
  }

  async update(id: string, dto: UpdateGlPostingGroupDto, tenantId: string, user?: any) {
    const group = await this.findOne(id);
    if (group.deleted_at) throw new BadRequestException(`${group.group_code} is retired; restore it before changing it.`);
    const sent = dto as GroupAccounts;
    const merged: GroupAccounts = { ...pick(group), ...Object.fromEntries(Object.entries(sent).filter(([k, v]) => (ACCOUNT_FIELDS as readonly string[]).includes(k) && v !== undefined)) };
    const name = dto.group_name?.trim() ?? group.group_name;
    const problems = validateGroup(group.kind, group.group_code, name, merged);
    if (problems.length) throw new BadRequestException(problems);

    const items = await this.itemsOf(id);
    if (dto.is_active === false && items.length) throw new BadRequestException(`${group.group_code} is used by ${items.length} item(s); move them to another group first.`);

    const changed = changedAccounts(pick(group), merged);
    if (changed.length) {
      await this.assertAccountsUsable(group.company_id, tenantId, merged);
      // An item of the group must keep what its costing method needs.
      const next = { ...group, ...merged } as Group;
      for (const item of items) {
        const why = groupFitsItem(next, item as any);
        if (why) throw new BadRequestException(`${item.item_code}: ${why}`);
      }
      const charged = group.kind === 'BIOLOGICAL' ? await this.chargedItems(items.map((i) => i.item_id)) : [];
      if (charged.length) {
        const codes = items.filter((i) => charged.includes(i.item_id)).map((i) => i.item_code).join(', ');
        throw new BadRequestException(`The accounts of ${group.group_code} cannot be changed (${changed.map((f) => ACCOUNT_LABELS[f].toLowerCase()).join(', ')}): animals of ${codes} have been charged by a costing run.`);
      }
    }

    const columns = itemColumnsFromGroup({ kind: group.kind, ...merged });
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.glPostingGroup)
        .set({ group_name: name, ...accountsOfKind(group.kind, merged), ...(dto.is_active !== undefined ? { is_active: dto.is_active, status: dto.is_active ? 'ACTIVE' : 'INACTIVE' } : {}), updated_by: user?.userId ?? null, updated_at: new Date() })
        .where(eq(schema.glPostingGroup.posting_group_id, id));
      if (changed.length && items.length) {
        await tx.update(schema.itemMaster).set(columns as any).where(and(eq(schema.itemMaster.posting_group_id, id), isNull(schema.itemMaster.deleted_at)));
      }
    });
    await this.auditService.log({ tenantId, companyId: group.company_id, userId: user?.userId, action: 'UPDATE', entityName: 'gl_posting_group', entityId: id, oldValues: pick(group), newValues: { ...merged, group_name: name, items_updated: changed.length ? items.length : 0 } });
    return this.findOneDetailed(id);
  }

  async remove(id: string, tenantId: string, user?: any) {
    const group = await this.findOne(id);
    if (group.deleted_at) return;
    const items = await this.itemsOf(id);
    if (items.length) throw new BadRequestException(`${group.group_code} is used by ${items.length} item(s) (${items.slice(0, 5).map((i) => i.item_code).join(', ')}); move them to another group first.`);
    await this.db.update(schema.glPostingGroup).set({ deleted_at: new Date(), is_active: false, status: 'INACTIVE', updated_by: user?.userId ?? null }).where(eq(schema.glPostingGroup.posting_group_id, id));
    await this.auditService.log({ tenantId, companyId: group.company_id, userId: user?.userId, action: 'DELETE', entityName: 'gl_posting_group', entityId: id, oldValues: group });
  }

  async restore(id: string, tenantId: string, user?: any) {
    const group = await this.findOne(id);
    if (!group.deleted_at) return this.findOneDetailed(id);
    await this.db.update(schema.glPostingGroup).set({ deleted_at: null, is_active: true, status: 'ACTIVE', updated_by: user?.userId ?? null }).where(eq(schema.glPostingGroup.posting_group_id, id));
    await this.auditService.log({ tenantId, companyId: group.company_id, userId: user?.userId, action: 'RESTORE', entityName: 'gl_posting_group', entityId: id });
    return this.findOneDetailed(id);
  }

  /** Every account of the rows as `code - name`, keyed by account id. */
  private async accountLabels(groups: Group[]): Promise<Map<string, string>> {
    const ids = [...new Set(groups.flatMap((g) => ACCOUNT_FIELDS.map((f) => g[f]).filter((v): v is string => !!v)))];
    if (!ids.length) return new Map();
    const rows = await this.db.select().from(schema.glAccountMaster).where(inArray(schema.glAccountMaster.gl_account_id, ids));
    return new Map(rows.map((r) => [r.gl_account_id, `${r.account_code} - ${r.account_name}`]));
  }

  private shape(g: Group, labels: Map<string, string>, itemCount: number) {
    const lines = fieldsOfKind(g.kind).map((f) => ({ field: f, label: ACCOUNT_LABELS[f], account_id: g[f] ?? null, account: g[f] ? labels.get(g[f] as string) ?? null : null }));
    return { ...g, item_count: itemCount, accounts: lines, accounts_text: lines.filter((l) => l.account).map((l) => `${l.label}: ${l.account}`).join('\n') };
  }

  async findOneDetailed(id: string) {
    const group = await this.findOne(id);
    const items = await this.itemsOf(id);
    const labels = await this.accountLabels([group]);
    return { ...this.shape(group, labels, items.length), locked: group.kind === 'BIOLOGICAL' ? (await this.chargedItems(items.map((i) => i.item_id))).length > 0 : false, items: items.map((i) => ({ item_id: i.item_id, item_code: i.item_code, item_name: i.item_name })) };
  }

  async findAll(query: QueryGlPostingGroupDto, tenantId: string) {
    // Retired groups are listed too (the list shows them as inactive) so one can be found and restored.
    const conditions: any[] = [eq(schema.glPostingGroup.tenant_id, tenantId)];
    conditions.push(...masterScopeConditions(this.cls, schema.glPostingGroup, query.companyId));
    if (query.kind) conditions.push(eq(schema.glPostingGroup.kind, query.kind));
    if (query.isActive !== undefined) conditions.push(eq(schema.glPostingGroup.is_active, query.isActive));
    conditions.push(...listFilterConditions(schema.glPostingGroup, query.filter));
    const page = await runMasterList(this.db, schema.glPostingGroup, conditions, query, schema.glPostingGroup.group_code);
    const rows = page.data as Group[];
    const labels = await this.accountLabels(rows);
    const counts = rows.length
      ? await this.db
          .select({ id: schema.itemMaster.posting_group_id, n: sql<string>`COUNT(*)` })
          .from(schema.itemMaster)
          .where(and(inArray(schema.itemMaster.posting_group_id, rows.map((r) => r.posting_group_id)), isNull(schema.itemMaster.deleted_at)))
          .groupBy(schema.itemMaster.posting_group_id)
      : [];
    const byGroup = new Map(counts.map((c) => [c.id as string, Number(c.n)]));
    return { ...page, data: rows.map((g) => this.shape(g, labels, byGroup.get(g.posting_group_id) ?? 0)) };
  }
}

const pick = (g: Group): GroupAccounts => Object.fromEntries(ACCOUNT_FIELDS.map((f) => [f, g[f] ?? null])) as GroupAccounts;
