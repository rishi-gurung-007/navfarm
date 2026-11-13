import { withLineLabels } from './line-label';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { CreateGeneticLevelBandDto, QueryGeneticLevelBandDto, UpdateGeneticLevelBandDto } from './genetic-level-band.dto';
import { bandIssues, overlappingBands } from './breeding-line.rules';

const table = schema.geneticLevelBand;
type Row = typeof table.$inferSelect;

const numOrNull = (v: string | number | null | undefined) => (v == null ? null : Number(v));
const decOrNull = (v: number | null | undefined) => (v === undefined ? undefined : v == null ? null : String(v));

@Injectable()
export class GeneticLevelBandService {
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
    const [row] = await this.db.select().from(table).where(and(eq(table.band_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Genetic level band is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryGeneticLevelBandDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.breedId) conditions.push(eq(table.breed_id, query.breedId));
    conditions.push(...listFilterConditions(table, query.filter));
    const list = await runMasterList(this.db, table, conditions, query, table.sort_order);
    return { ...list, data: await withLineLabels(this.db, list.data as { breed_id: string | null }[]) as any };
  }

  /**
   * The bands that govern a line in this company: the line's own bands when it has any, else the company's default bands (no
   * breed). Read by the boar selection, which runs outside the master-data workspace, so the company is passed in.
   */
  async findForLine(breedId: string | null | undefined, tenantId: string, companyId: string | null) {
    const rows = await this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.tenant_id, tenantId),
          companyId ? eq(table.company_id, companyId) : isNull(table.company_id),
          eq(table.is_active, true),
          isNull(table.deleted_at),
        ),
      )
      .orderBy(asc(table.sort_order), asc(table.tsi_from));
    const own = breedId ? rows.filter((r) => r.breed_id === breedId) : [];
    return (own.length ? own : rows.filter((r) => !r.breed_id)).map((r) => ({
      level_name: r.level_name,
      tsi_from: numOrNull(r.tsi_from),
      tsi_to: numOrNull(r.tsi_to),
    }));
  }

  /** Every active band of one line (and company) other than `exceptId`: what a new or edited band must not overlap. */
  private async siblings(breedId: string | null, tenantId: string, companyId: string | null, exceptId?: string) {
    const rows = await this.db
      .select()
      .from(table)
      .where(
        and(
          eq(table.tenant_id, tenantId),
          companyId ? eq(table.company_id, companyId) : isNull(table.company_id),
          breedId ? eq(table.breed_id, breedId) : isNull(table.breed_id),
          eq(table.is_active, true),
        ),
      );
    return rows.filter((r) => r.band_id !== exceptId).map((r) => ({ level_name: r.level_name, tsi_from: numOrNull(r.tsi_from), tsi_to: numOrNull(r.tsi_to) }));
  }

  private async assertValid(band: { level_name: string; tsi_from: number | null; tsi_to: number | null }, breedId: string | null, tenantId: string, companyId: string | null, exceptId?: string) {
    const issues = bandIssues(band);
    if (issues.length) throw new BadRequestException(issues.join(' '));
    const clashes = overlappingBands(band, await this.siblings(breedId, tenantId, companyId, exceptId));
    if (clashes.length) {
      throw new BadRequestException(`This band overlaps ${clashes.map((c) => `'${c.level_name}'`).join(', ')}. A TSI must belong to one level.`);
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id,
      companyId: row.company_id || undefined,
      userId: user?.userId,
      action,
      entityName: 'genetic_level_band',
      entityId: row.band_id,
      oldValues,
      newValues: row,
    });
    return row;
  }

  async create(dto: CreateGeneticLevelBandDto, tenantId: string, user?: any) {
    const companyId = dto.company_id ?? null;
    const level_name = dto.level_name.trim();
    const band = { level_name, tsi_from: dto.tsi_from ?? null, tsi_to: dto.tsi_to ?? null };
    await this.assertValid(band, dto.breed_id ?? null, tenantId, companyId);
    const taken = (await this.db.select({ id: table.band_id }).from(table).where(and(eq(table.tenant_id, tenantId), companyId ? eq(table.company_id, companyId) : isNull(table.company_id), dto.breed_id ? eq(table.breed_id, dto.breed_id) : isNull(table.breed_id), eq(table.level_name, level_name)))).length;
    if (taken) throw new BadRequestException(`This line already has a level named '${level_name}'. Edit it, or restore it if it was switched off.`);

    const band_id = randomUUID();
    await this.db.insert(table).values({
      ...dto,
      level_name,
      tsi_from: decOrNull(dto.tsi_from) as string | null | undefined,
      tsi_to: decOrNull(dto.tsi_to) as string | null | undefined,
      band_id,
      tenant_id: tenantId,
      created_by: user?.userId,
      updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(band_id, tenantId), user);
  }

  async update(id: string, dto: UpdateGeneticLevelBandDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.breed_id !== undefined && (dto.breed_id ?? null) !== (before.breed_id ?? null)) {
      throw new BadRequestException('The line of a band cannot be changed. Add a band for the other line instead.');
    }
    const { breed_id: _ignored, ...changes } = dto;
    const merged = {
      level_name: changes.level_name?.trim() ?? before.level_name,
      tsi_from: changes.tsi_from === undefined ? numOrNull(before.tsi_from) : changes.tsi_from,
      tsi_to: changes.tsi_to === undefined ? numOrNull(before.tsi_to) : changes.tsi_to,
    };
    await this.assertValid(merged, before.breed_id, tenantId, before.company_id, id);
    await this.db
      .update(table)
      .set({
        ...changes,
        level_name: merged.level_name,
        tsi_from: decOrNull(changes.tsi_from) as string | null | undefined,
        tsi_to: decOrNull(changes.tsi_to) as string | null | undefined,
        updated_by: user?.userId,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(and(eq(table.band_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (active) {
      const clashes = overlappingBands(
        { level_name: before.level_name, tsi_from: numOrNull(before.tsi_from), tsi_to: numOrNull(before.tsi_to) },
        await this.siblings(before.breed_id, tenantId, before.company_id, id),
      );
      if (clashes.length) throw new BadRequestException(`This band overlaps ${clashes.map((c) => `'${c.level_name}'`).join(', ')}, so it cannot be restored as it is.`);
    }
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db
      .update(table)
      .set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId })
      .where(and(eq(table.band_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}
