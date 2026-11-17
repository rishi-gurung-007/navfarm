import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateGiltClassRuleDto, QueryGiltClassRuleDto, UpdateGiltClassRuleDto } from './gilt-class-rule.dto';
import { giltItemIssues, pickGiltRule } from './gilt-class-rule.rules';

const table = schema.giltClassRule;
type Row = typeof table.$inferSelect;
const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

@Injectable()
export class GiltClassRuleService {
  constructor(
    private readonly cls: ClsService,
    private readonly audit: AuditLogService,
  ) {}

  private get db() {
    return this.cls.get<MySql2Database<typeof schema>>('tenantDb');
  }

  private scope(tenantId: string) {
    return [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table)];
  }

  async findOne(id: string, tenantId: string) {
    const [row] = await this.db.select().from(table).where(and(eq(table.rule_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Gilt class rule is not available in this workspace.');
    return row;
  }

  /** Rows with the readable names of the two lines and the item, for the list. */
  private async labelled(rows: Row[]) {
    const breeds = await this.db.select({ id: schema.breedMaster.breed_id, code: schema.breedMaster.breed_code, name: schema.breedMaster.breed_name }).from(schema.breedMaster);
    const items = await this.db.select({ id: schema.itemMaster.item_id, code: schema.itemMaster.item_code, name: schema.itemMaster.item_name }).from(schema.itemMaster);
    const breedLabel = (id: string) => { const b = breeds.find((x) => x.id === id); return b ? (b.name && b.name !== b.code ? `${b.code} — ${b.name}` : b.code) : 'Unknown line'; };
    return rows.map((r) => {
      const item = items.find((i) => i.id === r.gilt_item_id);
      return { ...r, dam_line_label: breedLabel(r.dam_breed_id), sire_line_label: breedLabel(r.sire_breed_id), gilt_item_label: item ? `${item.code} — ${item.name}` : 'Unknown item' };
    });
  }

  async findAll(query: QueryGiltClassRuleDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    conditions.push(...listFilterConditions(table, query.filter));
    const list = await runMasterList(this.db, table, conditions, query, table.created_at);
    return { ...list, data: (await this.labelled(list.data as Row[])) as any };
  }

  /**
   * The item a gilt of this dam and sire is registered as, or null when no rule covers the pair (the user then names it). Read by gilt selection,
   * which runs outside the master-data workspace, so the company is passed in.
   */
  async resolve(damBreedId: string | null | undefined, sireBreedId: string | null | undefined, tenantId: string, companyId: string | null) {
    if (!damBreedId || !sireBreedId) return null;
    const rows = await this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.tenant_id, tenantId),
          eq(table.dam_breed_id, damBreedId),
          eq(table.sire_breed_id, sireBreedId),
          eq(table.is_active, true),
          isNull(table.deleted_at),
          companyId ? or(isNull(table.company_id), eq(table.company_id, companyId)) : isNull(table.company_id),
        ),
      );
    return pickGiltRule(rows, damBreedId, sireBreedId, companyId);
  }

  private async assertItem(itemId: string, tenantId: string) {
    const [item] = await this.db
      .select({
        item_code: schema.itemMaster.item_code,
        is_active: schema.itemMaster.is_active,
        is_biological_asset: schema.itemMaster.is_biological_asset,
        bio_gender: schema.itemMaster.bio_gender,
        bio_costing_method: schema.itemMaster.bio_costing_method,
      })
      .from(schema.itemMaster)
      .where(and(eq(schema.itemMaster.item_id, itemId), eq(schema.itemMaster.tenant_id, tenantId)))
      .limit(1);
    const issues = giltItemIssues(item);
    if (issues.length) throw new BadRequestException(issues.join(' '));
  }

  private async assertBreeds(ids: string[], tenantId: string) {
    for (const id of ids) {
      const [b] = await this.db.select({ id: schema.breedMaster.breed_id }).from(schema.breedMaster).where(and(eq(schema.breedMaster.breed_id, id), eq(schema.breedMaster.tenant_id, tenantId))).limit(1);
      if (!b) throw new BadRequestException('A breeding line (breed) named in the rule is not available.');
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id,
      companyId: row.company_id || undefined,
      userId: user?.userId,
      action,
      entityName: 'gilt_class_rule',
      entityId: row.rule_id,
      oldValues,
      newValues: row,
    });
    return row;
  }

  async create(dto: CreateGiltClassRuleDto, tenantId: string, user?: any) {
    const companyId = dto.company_id ?? null;
    await this.assertBreeds([dto.dam_breed_id, dto.sire_breed_id], tenantId);
    await this.assertItem(dto.gilt_item_id, tenantId);
    const taken = await this.db
      .select({ id: table.rule_id, active: table.is_active })
      .from(table)
      .where(and(eq(table.tenant_id, tenantId), companyId ? eq(table.company_id, companyId) : isNull(table.company_id), eq(table.dam_breed_id, dto.dam_breed_id), eq(table.sire_breed_id, dto.sire_breed_id)));
    if (taken.length) throw new BadRequestException(taken.some((t) => t.active) ? 'A rule for this dam line and sire line already exists. Edit it.' : 'A rule for this dam line and sire line exists but is switched off. Restore it.');
    const rule_id = randomUUID();
    await this.db.insert(table).values({ ...dto, rule_id, tenant_id: tenantId, created_by: user?.userId, updated_by: user?.userId });
    return this.log('CREATE', await this.findOne(rule_id, tenantId), user);
  }

  async update(id: string, dto: UpdateGiltClassRuleDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if ((dto.dam_breed_id && dto.dam_breed_id !== before.dam_breed_id) || (dto.sire_breed_id && dto.sire_breed_id !== before.sire_breed_id)) {
      throw new BadRequestException('The dam line and sire line of a rule cannot be changed. Add a rule for the other pair instead.');
    }
    if (dto.gilt_item_id) await this.assertItem(dto.gilt_item_id, tenantId);
    await this.db
      .update(table)
      .set({ gilt_item_id: dto.gilt_item_id ?? before.gilt_item_id, updated_by: user?.userId, updated_at: now() })
      .where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active) await this.assertItem(before.gilt_item_id, tenantId);
    const stamp = now();
    await this.db
      .update(table)
      .set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : stamp, updated_at: stamp, updated_by: user?.userId })
      .where(and(eq(table.rule_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}
