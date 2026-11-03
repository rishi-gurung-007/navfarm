import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { ClsService } from 'nestjs-cls';
import { randomUUID } from 'node:crypto';
import * as schema from '../../../core/database/schema';
import { masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import {
  CreateBreedingLineSetupDto,
  QueryBreedingLineSetupDto,
  UpdateBreedingLineSetupDto,
} from './breeding-line-setup.dto';
import { editedSetupValues, effectiveSetup, lineSetupIssues, LineSetupValues, newSetupValues } from './breeding-line.rules';

const table = schema.breedingLineSetup;
type Row = typeof table.$inferSelect;

/** A stored row as the plain values the rules read (decimals come back from MySQL as strings). */
const valuesOf = (row: Row): LineSetupValues => ({
  ...row,
  colorant_qty_per_lot: row.colorant_qty_per_lot == null ? null : Number(row.colorant_qty_per_lot),
  min_motility_pct: row.min_motility_pct == null ? null : Number(row.min_motility_pct),
  grading_genetic_weight: row.grading_genetic_weight == null ? null : Number(row.grading_genetic_weight),
  grading_dose_weight: row.grading_dose_weight == null ? null : Number(row.grading_dose_weight),
  grading_morphology_weight: row.grading_morphology_weight == null ? null : Number(row.grading_morphology_weight),
});

/** The weights go to MySQL as decimals; undefined stays untouched on an edit and null clears. */
const weightsOf = (v: { grading_genetic_weight?: number | null; grading_dose_weight?: number | null; grading_morphology_weight?: number | null }) => {
  const dec = (n: number | null | undefined) => (n === undefined ? undefined : n == null ? null : String(n));
  return {
    grading_genetic_weight: dec(v.grading_genetic_weight),
    grading_dose_weight: dec(v.grading_dose_weight),
    grading_morphology_weight: dec(v.grading_morphology_weight),
  };
};

@Injectable()
export class BreedingLineSetupService {
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
    const [row] = await this.db.select().from(table).where(and(eq(table.setup_id, id), ...this.scope(tenantId))).limit(1);
    if (!row) throw new NotFoundException('Breeding line setup is not available in this workspace.');
    return row;
  }

  async findAll(query: QueryBreedingLineSetupDto, tenantId: string) {
    const conditions = [eq(table.tenant_id, tenantId), ...masterScopeConditions(this.cls, table, query.companyId)];
    if (query.isActive !== undefined) conditions.push(eq(table.is_active, query.isActive));
    if (query.breedId) conditions.push(eq(table.breed_id, query.breedId));
    conditions.push(...listFilterConditions(table, query.filter));
    return runMasterList(this.db, table, conditions, query, table.created_at);
  }

  /**
   * The rule row that governs a boar of this breed in this company: the line's own row, else the company default, else
   * null. Read by the collection itself, which runs outside the master-data workspace, so the company is passed in.
   */
  async findEffective(breedId: string | null | undefined, tenantId: string, companyId: string | null) {
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
      );
    return effectiveSetup(rows, breedId);
  }

  private async assertFarms(ids: string[] | null | undefined, tenantId: string, companyId: string | null) {
    if (!ids?.length) return;
    const rows = await this.db
      .select({ id: schema.locationMaster.location_id })
      .from(schema.locationMaster)
      .where(
        and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.location_type, 'FARM'),
          eq(schema.locationMaster.is_active, true),
          inArray(schema.locationMaster.location_id, ids),
          companyId ? eq(schema.locationMaster.company_id, companyId) : isNull(schema.locationMaster.company_id),
        ),
      );
    if (ids.some((id) => !rows.some((r) => r.id === id))) {
      throw new BadRequestException('Select active farms of this company as the destination.');
    }
  }

  private assertValid(values: LineSetupValues) {
    const issues = lineSetupIssues(values);
    if (issues.length) throw new BadRequestException(issues.join(' '));
  }

  private async assertLineFree(breedId: string | null, tenantId: string, companyId: string | null, exceptId?: string) {
    const rows = await this.db
      .select({ id: table.setup_id })
      .from(table)
      .where(
        and(
          eq(table.tenant_id, tenantId),
          companyId ? eq(table.company_id, companyId) : isNull(table.company_id),
          breedId ? eq(table.breed_id, breedId) : isNull(table.breed_id),
        ),
      );
    if (rows.some((r) => r.id !== exceptId)) {
      throw new BadRequestException(
        breedId
          ? 'This line already has a setup. Edit it, or restore it if it was switched off.'
          : 'The company default already exists. Edit it, or restore it if it was switched off.',
      );
    }
  }

  private async log(action: string, row: Row, user: any, oldValues?: unknown) {
    await this.audit.log({
      tenantId: row.tenant_id,
      companyId: row.company_id || undefined,
      userId: user?.userId,
      action,
      entityName: 'breeding_line_setup',
      entityId: row.setup_id,
      oldValues,
      newValues: row,
    });
    return row;
  }

  async create(dto: CreateBreedingLineSetupDto, tenantId: string, user?: any) {
    const companyId = dto.company_id ?? null;
    this.assertValid(newSetupValues(dto as Partial<LineSetupValues>));
    await this.assertFarms(dto.destination_farm_ids, tenantId, companyId);
    await this.assertLineFree(dto.breed_id ?? null, tenantId, companyId);

    const setup_id = randomUUID();
    await this.db.insert(table).values({
      ...dto,
      colorant_qty_per_lot: dto.colorant_qty_per_lot == null ? null : String(dto.colorant_qty_per_lot),
      min_motility_pct: dto.min_motility_pct == null ? null : String(dto.min_motility_pct),
      ...weightsOf(dto),
      selection_columns: dto.selection_columns?.length ? dto.selection_columns : null,
      collection_weekdays: dto.collection_weekdays?.length ? dto.collection_weekdays : null,
      destination_farm_ids: dto.destination_farm_ids?.length ? dto.destination_farm_ids : null,
      setup_id,
      tenant_id: tenantId,
      created_by: user?.userId,
      updated_by: user?.userId,
    });
    return this.log('CREATE', await this.findOne(setup_id, tenantId), user);
  }

  async update(id: string, dto: UpdateBreedingLineSetupDto, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    if (dto.breed_id !== undefined && (dto.breed_id ?? null) !== (before.breed_id ?? null)) {
      throw new BadRequestException('The line of a setup cannot be changed. Add a setup for the other line instead.');
    }
    // An edit that sends a field replaces it; one that leaves it out keeps it. Rules are read on the merged row.
    const { breed_id: _ignored, ...changes } = dto;
    this.assertValid(editedSetupValues(valuesOf(before), changes as Partial<LineSetupValues>));
    if (changes.destination_farm_ids !== undefined) await this.assertFarms(changes.destination_farm_ids, tenantId, before.company_id);

    await this.db
      .update(table)
      .set({
        ...changes,
        colorant_qty_per_lot: changes.colorant_qty_per_lot === undefined ? undefined : changes.colorant_qty_per_lot == null ? null : String(changes.colorant_qty_per_lot),
        min_motility_pct: changes.min_motility_pct === undefined ? undefined : changes.min_motility_pct == null ? null : String(changes.min_motility_pct),
        ...weightsOf(changes),
        selection_columns: changes.selection_columns === undefined ? undefined : changes.selection_columns?.length ? changes.selection_columns : null,
        collection_weekdays: changes.collection_weekdays === undefined ? undefined : changes.collection_weekdays?.length ? changes.collection_weekdays : null,
        destination_farm_ids: changes.destination_farm_ids === undefined ? undefined : changes.destination_farm_ids?.length ? changes.destination_farm_ids : null,
        updated_by: user?.userId,
        updated_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      .where(and(eq(table.setup_id, id), ...this.scope(tenantId)));
    return this.log('UPDATE', await this.findOne(id, tenantId), user, before);
  }

  async setActive(id: string, active: boolean, tenantId: string, user?: any) {
    const before = await this.findOne(id, tenantId);
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await this.db
      .update(table)
      .set({ is_active: active, status: active ? 'ACTIVE' : 'INACTIVE', deleted_at: active ? null : now, updated_at: now, updated_by: user?.userId })
      .where(and(eq(table.setup_id, id), ...this.scope(tenantId)));
    return this.log(active ? 'RESTORE' : 'DELETE', await this.findOne(id, tenantId), user, before);
  }
}
