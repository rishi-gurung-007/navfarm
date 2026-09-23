import { companyCondition, masterScopeConditions } from '../../../common/master-data-scope';
import { listFilterConditions, runMasterList } from '../../../common/master-list-query';
import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { alias } from 'drizzle-orm/mysql-core';
import { eq, and, like, or, isNull, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateLocationDto, UpdateLocationDto, QueryLocationDto } from './dto/location.dto';
import { AuditLogService } from '../../system/audit-log/audit-log.service';
import { NumberSeriesService } from '../../system/number-series/number-series.service';
import { generateCompositeCode } from '../../system/number-series/composite-code.util';
import { segmentFields } from '../../system/number-series/code-format.util';

/**
 * The location types a warehouse reads as. WarehouseService projects exactly
 * these types out of location_master, so the list is shared rather than typed
 * twice — a new type that inventory should hold (a tenant's own BINS, say)
 * joins this list once and both the tree and the /warehouse projection agree.
 */
export const WAREHOUSE_LOCATION_TYPES = ['STORE', 'SILO'];

const toMysqlTimestamp = (date: Date = new Date()) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

/**
 * Adds up a set of locations' areas, in one unit.
 *
 * Pure and exported so the rule can be tested without a database — the arithmetic is
 * where TDD row 138 actually lives ("the *total* of area of pens and sub locations should
 * not exceed the area of the farm location"), and it was previously spread across two
 * loops that compared one child at a time.
 *
 * Skipped, and why:
 * - no area recorded — nothing to add, and absence is not zero;
 * - a different unit — there is no tenant-wide area conversion (uom_conversion_master is
 *   scoped to an item's stock units), so adding SQFT to ACRE would give a confident wrong
 *   answer. Reported separately so a caller can say the total is partial;
 * - the location being edited, when `excludeLocationId` is given, or updating a location
 *   without changing its area would count it twice and reject a valid save.
 */
export function sumAreasInUnit(
  rows: { location_id?: string; location_code: string; area_size: string | number | null; area_unit: string | null }[],
  unit: string | null | undefined,
  excludeLocationId?: string,
): { total: number; counted: string[]; skipped: string[] } {
  let total = 0;
  const counted: string[] = [];
  const skipped: string[] = [];
  for (const row of rows) {
    if (excludeLocationId && row.location_id === excludeLocationId) continue;
    if (row.area_size == null || row.area_size === '') continue;
    if (unit && row.area_unit && unit.toUpperCase() !== row.area_unit.toUpperCase()) {
      skipped.push(row.location_code);
      continue;
    }
    const size = Number(row.area_size);
    if (!Number.isFinite(size)) continue;
    total += size;
    counted.push(row.location_code);
  }
  return { total, counted, skipped };
}

@Injectable()
export class LocationService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly numberSeriesService: NumberSeriesService,
  ) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  private async resolveLocationType(typeCode: string, tenantId: string, companyId?: string | null) {
    const conditions = [
      eq(schema.locationTypeMaster.tenant_id, tenantId),
      eq(schema.locationTypeMaster.type_code, typeCode.toUpperCase()),
      eq(schema.locationTypeMaster.is_active, true),
      isNull(schema.locationTypeMaster.deleted_at),
    ];
    conditions.push(companyCondition(schema.locationTypeMaster.company_id, companyId));
    const [type] = await this.db.select().from(schema.locationTypeMaster).where(and(...conditions))
      .orderBy(sql`${schema.locationTypeMaster.company_id} IS NULL`).limit(1);
    if (!type) throw new NotFoundException(`Location Type '${typeCode}' not found.`);
    return type;
  }

  private allowedParentTypes(value: unknown): string[] {
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') {
      try { return JSON.parse(value); } catch { return []; }
    }
    return [];
  }

  /**
   * One LOCATION series per company, not one per location type.
   *
   * There used to be a LOCATION_FARM, LOCATION_SHED, LOCATION_PEN and so on,
   * because a series held exactly one prefix and each type needed its own. A
   * series can now take the type as a segment, so one row covers every type —
   * and the list stops growing by one every time someone adds a location type.
   *
   * The old per-type rows still resolve for anyone who has them; this only
   * stops new ones being minted.
   */
  private async ensureCompanySeries(_type: typeof schema.locationTypeMaster.$inferSelect, tenantId: string, companyId?: string | null) {
    const seriesCode = 'LOCATION';
    if (!companyId) return seriesCode;
    const [series] = await this.db.select().from(schema.noSeries).where(and(
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.company_id, companyId),
      eq(schema.noSeries.code, seriesCode),
      isNull(schema.noSeries.deleted_at),
    )).limit(1);
    if (!series) {
      await this.db.insert(schema.noSeries).values({
        id: randomUUID(), tenant_id: tenantId, company_id: companyId,
        code: seriesCode, description: 'Location Code',
        document_type: 'LOCATION', prefix: null, separator: '-',
        // The shape itself: parent code, then this level's type, then a number
        // counted among the siblings sharing that stem. A first-level location
        // has no parent to name, so its code is just TYPE-001.
        code_segments: ['parent_location_id', 'location_type'],
        seq_length: 3, current_seq: 0, reset_frequency: 'NEVER', manual_nos: true,
      });
    }
    return seriesCode;
  }

  /**
   * A root location keeps the existing flat per-company counter, unchanged.
   * A location with a parent gets a hierarchical code instead:
   * `<parent code>/<TYPE>-<seq>` — the code carries its own ancestry, so
   * "the first shed of farm 1" is readable from the code alone. <seq> counts
   * only the siblings that share this exact parent, NOT a company-wide
   * counter: farm 2's first shed is FARM-002/SHED-001, never SHED-003.
   *
   * The series row is still locked (numberSeriesService.lockSeries) so two
   * concurrent creates of this type serialize on it — the same guard
   * generateNext() gives root codes — but the sequence number itself comes
   * from counting siblings under `parent`, not the row's current_seq. Pass
   * the active transaction as `executor` so the lock survives until the
   * insert this code is used for commits (mirrors batch.service.ts's
   * generateBatchNo()).
   */
  private async generateLocationCode(
    seriesCode: string,
    type: typeof schema.locationTypeMaster.$inferSelect,
    tenantId: string,
    companyId: string,
    parent: typeof schema.locationMaster.$inferSelect | undefined,
    executor: MySql2Database<typeof schema>,
  ): Promise<string> {
    if (!parent) {
      // A root location has no parent to name, so the only segment it can offer
      // is its own type. Children still take the hierarchical path below.
      return this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, executor, { location_type: type.type_code });
    }

    const series = await this.numberSeriesService.lockSeries(seriesCode, tenantId, companyId, executor);

    // Series-driven when the series says how, guaranteed when it does not.
    //
    // A LOCATION series carrying parent_location_id and location_type composes
    // the hierarchy itself, per-stem counter and all — FARM001-SHED-001, and
    // SHED-001 for a shed with no parent. That is the configured path and it is
    // the one to prefer.
    //
    // With no segments configured the composite path below still runs, because
    // a child's code carrying its ancestry is not a preference here: it is what
    // every screen, report and traceability chain reads. A tenant whose series
    // was left unconfigured would otherwise issue flat codes for locations that
    // do have parents, and nothing would say so.
    if (segmentFields(series).length) {
      return this.numberSeriesService.generateNext(seriesCode, tenantId, companyId, executor, {
        parent_location_id: parent.location_id,
        location_type: type.type_code,
      });
    }

    return generateCompositeCode({
      parentCode: parent.location_code,
      prefix: type.code_prefix,
      seqLength: series.seq_length,
      fetchSiblingCodes: () => executor
        .select({ code: schema.locationMaster.location_code })
        .from(schema.locationMaster)
        .where(and(
          eq(schema.locationMaster.tenant_id, tenantId),
          eq(schema.locationMaster.parent_location_id, parent.location_id),
          eq(schema.locationMaster.location_type, type.type_code),
        )),
    });
  }

  /**
   * Builds the location row (generating its code inside `tx`) and inserts it
   * plus its legacy mirror. Split out from `create()` so the same attempt can
   * be re-run once, unmodified, if the insert below collides on
   * `uq_location_master_tenant_company_code` (see the retry in `create()`).
   */
  private async createLocationRecord(
    tx: MySql2Database<typeof schema>,
    params: {
      seriesCode: string;
      locationType: typeof schema.locationTypeMaster.$inferSelect;
      tenantId: string;
      companyId: string;
      parent: typeof schema.locationMaster.$inferSelect | undefined;
      locationId: string;
      typeCode: string;
      locationLevel: number;
      dto: CreateLocationDto;
      userPayload?: any;
    },
  ) {
    const { seriesCode, locationType, tenantId, companyId, parent, locationId, typeCode, locationLevel, dto, userPayload } = params;

    if (typeCode === 'FARM' && !dto.location_address?.trim()) {
      throw new BadRequestException('Location Address is required for a Farm.');
    }

    // Code generation happens inside this transaction, using tx as the lock
    // executor, so the series row's SELECT ... FOR UPDATE (or, for a child
    // location, the sibling count it guards) stays locked until the insert
    // below commits — two concurrent creates cannot produce the same code.
    const locationCode = dto.location_code?.trim()
      ? await this.numberSeriesService.manualCode('LOCATION', dto.location_code, tenantId, companyId, typeCode)
      : await this.generateLocationCode(seriesCode, locationType, tenantId, companyId, parent, tx);

    // location_code is varchar(255). A deep hierarchical tree (each level
    // prepending "<parent code>/<TYPE>-<seq>") can in principle exceed that —
    // reject cleanly here rather than let the insert below fail with a raw
    // data-too-long driver error.
    if (locationCode.length > 255) {
      throw new BadRequestException(
        `Location code would exceed 255 characters at this depth ('${locationCode}', ${locationCode.length} characters).`,
      );
    }

    const location = {
      location_id: locationId,
      tenant_id: tenantId,
      company_id: companyId,
      nob_id: dto.nob_id || null,
      lob_id: dto.lob_id || null,
      // Ancestry comes from the parent chain and the derived level, not from a
      // hard-coded FARM→SHED→PEN ladder. farm_id is "the level-1 ancestor" —
      // any root type anchors a farm's subtree, so a tenant's custom root type
      // scopes its children exactly as FARM does. shed_id and warehouse_id keep
      // their type names (SHED is a fixed stage of the housing chain; the
      // warehouse projection is shared with WarehouseService), but every child
      // inherits through its parent rather than through a type ladder.
      farm_id: locationLevel === 1 ? locationId : parent ? (parent.location_level === 1 ? parent.location_id : parent.farm_id) : null,
      shed_id: typeCode === 'SHED' ? locationId : parent ? (parent.location_type === 'SHED' ? parent.location_id : parent.shed_id) : null,
      warehouse_id: WAREHOUSE_LOCATION_TYPES.includes(typeCode) ? locationId : parent ? (WAREHOUSE_LOCATION_TYPES.includes(parent.location_type) ? parent.location_id : parent.warehouse_id) : null,
      location_code: locationCode,
      location_name: dto.location_name,
      location_address: typeCode === 'FARM' ? dto.location_address!.trim() : null,
      location_level: locationLevel,
      location_type: typeCode,
      parent_location_id: dto.parent_location_id || null,
      area_size: dto.area_size?.toString() || null,
      area_unit: dto.area_unit || null,
      max_capacity: dto.max_capacity?.toString() || null,
      capacity_uom: dto.capacity_uom || null,
      current_count: dto.current_count?.toString() || '0.00',
      gps_latitude: dto.gps_latitude?.toString() || null,
      gps_longitude: dto.gps_longitude?.toString() || null,
      storage_type: dto.storage_type || null,
      is_quarantine_zone: dto.is_quarantine_zone || false,
      silo_capacity_kg: dto.silo_capacity_kg?.toString() || null,
      silo_reorder_days: dto.silo_reorder_days ?? null,
      downtime_days_required: dto.downtime_days_required ?? null,
      storage_name: dto.storage_name ?? null,
      feed_in_bags: null,
      is_active: true,
      status: 'ACTIVE',
      extension_config: dto.extension_config ? JSON.stringify(dto.extension_config) : null,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await tx.insert(schema.locationMaster).values(location);
    return location;
  }

  private async assertNoHierarchyCycle(id: string, parentId: string, tenantId: string) {
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === id) throw new ConflictException('A location cannot be moved under one of its descendants.');
      if (visited.has(cursor)) throw new ConflictException('The selected parent belongs to an invalid hierarchy cycle.');
      visited.add(cursor);
      const [row] = await this.db.select({ parent_location_id: schema.locationMaster.parent_location_id })
        .from(schema.locationMaster).where(and(
          eq(schema.locationMaster.location_id, cursor),
          eq(schema.locationMaster.tenant_id, tenantId),
        )).limit(1);
      cursor = row?.parent_location_id || null;
    }
  }

  /** SILO locations must carry both silo tracking fields. */
  private assertSiloFieldsWhenSilo(
    locationType: string | null | undefined,
    siloCapacityKg?: number | null,
    siloReorderDays?: number | null,
  ) {
    if (locationType === 'SILO' && (siloCapacityKg == null || siloReorderDays == null)) {
      throw new ConflictException(
        'A SILO location requires both silo_capacity_kg and silo_reorder_days.'
      );
    }
  }

  /**
   * Sums the area already committed by a parent's children, in the parent's unit.
   *
   * Children carrying no area are skipped, and so are children measured in a different
   * unit — there is no tenant-wide area conversion to lean on (uom_conversion_master is
   * scoped to a specific item's stock units, not a general SQM↔ACRE factor), and adding
   * SQFT to ACRE would produce a confident wrong number. Skipping is the honest choice,
   * but it does mean a mixed-unit hierarchy is only partially checked; `skipped` is
   * returned so the caller can say so rather than implying a complete answer.
   */
  private async sumChildArea(
    parentLocationId: string,
    unit: string | null | undefined,
    tenantId: string,
    excludeLocationId?: string,
  ): Promise<{ total: number; counted: string[]; skipped: string[] }> {
    const children = await this.db.select({
      location_id: schema.locationMaster.location_id,
      location_code: schema.locationMaster.location_code,
      area_size: schema.locationMaster.area_size,
      area_unit: schema.locationMaster.area_unit,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.parent_location_id, parentLocationId),
      eq(schema.locationMaster.tenant_id, tenantId),
      isNull(schema.locationMaster.deleted_at),
    ));

    return sumAreasInUnit(children, unit, excludeLocationId);
  }

  /**
   * TDD row 138: "the total of area of pens and sub locations should not exceed the area
   * of the farm location."
   *
   * The rule is about the SUM of a parent's children, not each child measured on its own.
   * Three 400 m² pens each fit inside a 1000 m² shed; together they do not. Checking them
   * one at a time — which is what this did before — accepts exactly that.
   *
   * Only checked when both this location and its parent carry an area_size, and only
   * across children sharing the parent's unit; see sumChildArea for why.
   */
  private async assertAreaFitsInParent(
    childAreaSize: number | string | null | undefined,
    childAreaUnit: string | null | undefined,
    parent: { location_id: string; area_size: string | null; area_unit: string | null; location_code: string } | undefined,
    tenantId: string,
    excludeLocationId?: string,
  ) {
    if (childAreaSize == null || childAreaSize === '' || !parent?.area_size) return;
    if (childAreaUnit && parent.area_unit && childAreaUnit.toUpperCase() !== parent.area_unit.toUpperCase()) return;
    const childSize = Number(childAreaSize);
    const parentSize = Number(parent.area_size);
    if (!Number.isFinite(childSize) || !Number.isFinite(parentSize)) return;

    const unit = parent.area_unit || childAreaUnit || null;
    const { total: siblingTotal, counted, skipped } = await this.sumChildArea(
      parent.location_id, unit, tenantId, excludeLocationId,
    );
    const combined = siblingTotal + childSize;
    if (combined > parentSize) {
      const u = unit ? ' ' + unit : '';
      const withSiblings = counted.length
        ? ` (${childSize}${u} here plus ${siblingTotal}${u} already used by ${counted.length} other location${counted.length === 1 ? '' : 's'}: ${counted.slice(0, 3).join(', ')}${counted.length > 3 ? '…' : ''})`
        : '';
      const note = skipped.length ? ` ${skipped.length} location(s) measured in another unit were not counted.` : '';
      throw new ConflictException(
        `Total area of locations under '${parent.location_code}' would be ${combined}${u}, which exceeds its ${parentSize}${u}${withSiblings}.${note}`,
      );
    }
  }

  /**
   * The other direction of the same rule: shrinking (or unit-changing) a location's own
   * area_size must not leave its children already claiming more than the new figure —
   * again as a total, not one at a time.
   *
   * Direct children only. Each child's own create/update enforced the rule one level
   * down, so every descendant already fits within its own parent.
   */
  private async assertChildTotalFitsWithinArea(
    locationId: string,
    newAreaSize: number | string | null | undefined,
    newAreaUnit: string | null | undefined,
    tenantId: string,
  ) {
    if (newAreaSize == null || newAreaSize === '') return;
    const parentSize = Number(newAreaSize);
    if (!Number.isFinite(parentSize)) return;

    const { total, counted, skipped } = await this.sumChildArea(locationId, newAreaUnit, tenantId);
    if (counted.length && total > parentSize) {
      const u = newAreaUnit ? ' ' + newAreaUnit : '';
      const note = skipped.length ? ` ${skipped.length} location(s) measured in another unit were not counted.` : '';
      throw new ConflictException(
        `Cannot set Area Size to ${parentSize}${u} — locations under it already total ${total}${u} (${counted.slice(0, 3).join(', ')}${counted.length > 3 ? '…' : ''}).${note}`,
      );
    }
  }

  /**
   * Asserts that a sub-location's max_capacity does not exceed its parent location's capacity,
   * nor does the cumulative total of all children exceed the parent.
   */
  private async assertCapacityFitsInParent(
    childCapacity: number | string | null | undefined,
    childCapacityUom: string | null | undefined,
    parent: { location_id: string; max_capacity: string | null; capacity_uom: string | null; location_code: string } | undefined,
    tenantId: string,
    excludeLocationId?: string,
  ) {
    if (childCapacity == null || childCapacity === '' || !parent?.max_capacity) return;
    if (childCapacityUom && parent.capacity_uom && childCapacityUom.toUpperCase() !== parent.capacity_uom.toUpperCase()) return;
    const childCap = Number(childCapacity);
    const parentCap = Number(parent.max_capacity);
    if (!Number.isFinite(childCap) || !Number.isFinite(parentCap)) return;

    if (childCap > parentCap) {
      const uomStr = childCapacityUom ? ` ${childCapacityUom}` : '';
      throw new BadRequestException(
        `Sub-location capacity (${childCap}${uomStr}) cannot exceed parent location '${parent.location_code}' capacity (${parentCap}${uomStr}).`,
      );
    }

    // Check sibling cumulative capacity
    const siblings = await this.db.select({
      location_id: schema.locationMaster.location_id,
      max_capacity: schema.locationMaster.max_capacity,
      capacity_uom: schema.locationMaster.capacity_uom,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.parent_location_id, parent.location_id),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ));

    let siblingTotal = 0;
    for (const sib of siblings) {
      if (excludeLocationId && sib.location_id === excludeLocationId) continue;
      if (!sib.max_capacity) continue;
      if (childCapacityUom && sib.capacity_uom && childCapacityUom.toUpperCase() !== sib.capacity_uom.toUpperCase()) continue;
      siblingTotal += Number(sib.max_capacity) || 0;
    }

    if (siblingTotal + childCap > parentCap) {
      const uomStr = parent.capacity_uom ? ` ${parent.capacity_uom}` : '';
      throw new BadRequestException(
        `Total capacity of sub-locations under '${parent.location_code}' would be ${siblingTotal + childCap}${uomStr}, which exceeds parent capacity (${parentCap}${uomStr}).`,
      );
    }
  }

  /**
   * Asserts that reducing a location's capacity does not leave its children claiming more than the new capacity.
   */
  private async assertChildTotalFitsWithinCapacity(
    locationId: string,
    newCapacity: number | string | null | undefined,
    tenantId: string,
  ) {
    if (newCapacity == null || newCapacity === '') return;
    const parentCap = Number(newCapacity);
    if (!Number.isFinite(parentCap)) return;

    const children = await this.db.select({
      max_capacity: schema.locationMaster.max_capacity,
    }).from(schema.locationMaster).where(and(
      eq(schema.locationMaster.parent_location_id, locationId),
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ));

    let childTotal = 0;
    for (const child of children) {
      childTotal += Number(child.max_capacity) || 0;
    }
    if (childTotal > parentCap) {
      throw new BadRequestException(
        `Cannot reduce parent capacity to ${parentCap}; child locations currently claim a total capacity of ${childTotal}.`,
      );
    }
  }

  /** Validates the UOM belongs to the same template/company scope. */
  private async assertUomExists(uomCode: string | null | undefined, tenantId: string, companyId?: string | null) {
    if (!uomCode) return;

    const conditions = [
      eq(schema.uomMaster.tenant_id, tenantId),
      eq(schema.uomMaster.uom_code, uomCode.toUpperCase()),
      isNull(schema.uomMaster.deleted_at),
    ];
    conditions.push(companyCondition(schema.uomMaster.company_id, companyId));

    const [uom] = await this.db
      .select()
      .from(schema.uomMaster)
      .where(and(...conditions))
      .limit(1);

    if (!uom) {
      throw new NotFoundException(`UOM code '${uomCode}' not found.`);
    }
  }

  async create(dto: CreateLocationDto, tenantId: string, userPayload?: any) {
    if (!dto.company_id) {
      throw new ConflictException('A company is required to create a location and allocate its code sequence.');
    }
    const [company] = await this.db
      .select()
      .from(schema.companyMaster)
      .where(and(
        eq(schema.companyMaster.company_id, dto.company_id),
        eq(schema.companyMaster.tenant_id, tenantId),
        isNull(schema.companyMaster.deleted_at),
      ))
      .limit(1);

    if (!company) {
      throw new NotFoundException(`Company with ID '${dto.company_id}' not found.`);
    }

    const companyId = dto.company_id;
    const locationType = await this.resolveLocationType(dto.location_type, tenantId, companyId);
    const typeCode = locationType.type_code;
    const allowedParentTypes = this.allowedParentTypes(locationType.allowed_parent_types);

    // parent_location_id is the single canonical hierarchy. Legacy ancestry
    // columns are derived below only to keep older operational flows working.
    let locationLevel = 1;
    let parent: typeof schema.locationMaster.$inferSelect | undefined;
    if (allowedParentTypes.length === 0 && dto.parent_location_id) {
      throw new ConflictException(`${locationType.type_name} is a root location and cannot have a parent.`);
    }
    if (dto.parent_location_id) {
      [parent] = await this.db.select().from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, dto.parent_location_id),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.company_id, companyId),
        isNull(schema.locationMaster.deleted_at),
      )).limit(1);
      if (!parent) throw new NotFoundException(`Parent Location '${dto.parent_location_id}' not found.`);
      if (!allowedParentTypes.includes(parent.location_type)) {
        throw new ConflictException(`${locationType.type_name} must be created under ${allowedParentTypes.join(' or ')}.`);
      }
      locationLevel = parent.location_level + 1;
    }
    if (allowedParentTypes.length > 0 && !parent) {
      throw new ConflictException(`${locationType.type_name} requires a parent location.`);
    }

    // 3.5. This location's area, plus everything already under the same parent,
    //      must fit inside that parent.
    await this.assertAreaFitsInParent(dto.area_size, dto.area_unit, parent, tenantId);
    await this.assertCapacityFitsInParent(dto.max_capacity, dto.capacity_uom, parent, tenantId);

    // 4. SILO locations must carry silo tracking fields
    if (!dto.storage_type && typeCode === 'SILO') dto.storage_type = 'SILO';
    this.assertSiloFieldsWhenSilo(dto.storage_type, dto.silo_capacity_kg, dto.silo_reorder_days);
    if (dto.storage_type !== 'SILO') {
      dto.silo_capacity_kg = undefined;
      dto.silo_reorder_days = undefined;
    }

    // 5. area_unit / capacity_uom must resolve to a real UOM
    await this.assertUomExists(dto.area_unit, tenantId, dto.company_id);
    await this.assertUomExists(dto.capacity_uom, tenantId, dto.company_id);

    const seriesCode = await this.ensureCompanySeries(locationType, tenantId, companyId);

    const locationId = randomUUID();
    const attemptParams = { seriesCode, locationType, tenantId, companyId, parent, locationId, typeCode, locationLevel, dto, userPayload };

    // uq_location_master_tenant_company_code is the guard against two
    // concurrent creates computing the same generated code (see the locking
    // doc on generateLocationCode). If that guard is ever wrong under real
    // InnoDB concurrency, the duplicate insert surfaces here as a driver
    // error (MySQL errno 1062 / ER_DUP_ENTRY) rather than a clean one. Retry
    // once with a freshly computed sequence — the whole attempt (legacy
    // mirror insert included) re-runs inside a brand-new transaction, so a
    // failed first attempt is fully rolled back before the retry starts.
    // Only if the retry also collides do we give up and surface it.
    let newLocation: Awaited<ReturnType<typeof this.createLocationRecord>>;
    try {
      newLocation = await this.db.transaction((tx) => this.createLocationRecord(tx, attemptParams));
    } catch (err) {
      if ((err as { code?: string })?.code !== 'ER_DUP_ENTRY') throw err;
      try {
        newLocation = await this.db.transaction((tx) => this.createLocationRecord(tx, attemptParams));
      } catch (retryErr) {
        if ((retryErr as { code?: string })?.code === 'ER_DUP_ENTRY') {
          throw new ConflictException('Location code collided with a concurrently created location; please retry.');
        }
        throw retryErr;
      }
    }

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'location_master',
      entityId: locationId,
      newValues: newLocation,
    });

    return this.findOne(locationId, tenantId);
  }

  async findOne(id: string, tenantId: string) {
    const [location] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, id),
        eq(schema.locationMaster.tenant_id, tenantId),
        isNull(schema.locationMaster.deleted_at),
      ))
      .limit(1);

    if (!location) {
      throw new NotFoundException(`Location with ID '${id}' not found.`);
    }

    return location;
  }

  async findAll(query: QueryLocationDto, tenantId: string) {
    // No isNull(deleted_at) filter here — remove() sets both is_active=false and deleted_at, and
    // the list view is meant to show both states (Active/Inactive toggle) so a blocked location
    // can be found again and restored, rather than vanishing from the list entirely.
    const conditions: any[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.locationMaster, query.companyId));
    if (query.nobId) {
      conditions.push(eq(schema.locationMaster.nob_id, query.nobId));
    }
    if (query.lobId) {
      conditions.push(eq(schema.locationMaster.lob_id, query.lobId));
    }
    if (query.farmId) {
      conditions.push(eq(schema.locationMaster.farm_id, query.farmId));
    }
    if (query.shedId) {
      conditions.push(eq(schema.locationMaster.shed_id, query.shedId));
    }
    if (query.warehouseId) {
      conditions.push(eq(schema.locationMaster.warehouse_id, query.warehouseId));
    }
    if (query.parentLocationId) {
      conditions.push(eq(schema.locationMaster.parent_location_id, query.parentLocationId));
    }
    if (query.locationType) {
      conditions.push(eq(schema.locationMaster.location_type, query.locationType));
    }
    // The Parent Location picker. Filtering in SQL, before the page is cut, is
    // the point: the form used to narrow the first 50 rows by type in the
    // browser, and those were all pens and sheds. The type is resolved in the
    // same company scope create() resolves it in, so the list offers exactly
    // the parents create() will accept.
    if (query.parentForType) {
      const scope = this.cls.get<{ kind?: string; companyId?: string | null }>('masterScope');
      const companyId = scope?.kind ? scope.companyId : query.companyId;
      const allowed = await this.resolveLocationType(query.parentForType, tenantId, companyId)
        .then((type) => this.allowedParentTypes(type.allowed_parent_types))
        .catch(() => [] as string[]);
      const eligibleParents = allowed.filter((t) => !['PEN', 'CAGE'].includes(t.toUpperCase()));
      conditions.push(eligibleParents.length ? inArray(schema.locationMaster.location_type, eligibleParents) : sql`1 = 0`);
    }
    if (query.rootOnly) {
      conditions.push(isNull(schema.locationMaster.parent_location_id));
    }
    if (query.isActive !== undefined) {
      conditions.push(eq(schema.locationMaster.is_active, query.isActive));
    }
    if (query.search) {
      conditions.push(
        or(
          like(schema.locationMaster.location_code, `%${query.search}%`),
          like(schema.locationMaster.location_name, `%${query.search}%`)
        )
      );
    }

    // The named filters above stay as they are — callers already use them.
    // Anything else the table has a column for comes through filter[column],
    // so the list screen can narrow on storage type, level or capacity without
    // a new query param and a new release each time.
    conditions.push(...listFilterConditions(schema.locationMaster, query.filter));

    return runMasterList(
      this.db,
      schema.locationMaster,
      conditions,
      query,
      schema.locationMaster.location_code,
    );
  }

  async update(id: string, dto: UpdateLocationDto, tenantId: string, userPayload?: any) {
    const location = await this.findOne(id, tenantId);

    if (dto.location_type !== undefined && dto.location_type !== location.location_type) {
      throw new ConflictException('Location Type cannot be changed after a location is created. Create a new location instead.');
    }
    if (dto.company_id !== undefined && dto.company_id !== location.company_id) {
      throw new ConflictException('A location cannot be moved to another company after its code is allocated.');
    }

    if (dto.company_id) {
      const [company] = await this.db
        .select()
        .from(schema.companyMaster)
        .where(and(eq(schema.companyMaster.company_id, dto.company_id), isNull(schema.companyMaster.deleted_at)))
        .limit(1);

      if (!company) {
        throw new NotFoundException(`Company with ID '${dto.company_id}' not found.`);
      }
    }

    const effectiveLocationType = dto.location_type !== undefined ? dto.location_type : location.location_type;
    const effectiveCompanyId = dto.company_id !== undefined ? dto.company_id : location.company_id;
    const locationType = await this.resolveLocationType(effectiveLocationType, tenantId, effectiveCompanyId);
    const allowedParentTypes = this.allowedParentTypes(locationType.allowed_parent_types);
    const effectiveParentId = dto.parent_location_id !== undefined ? dto.parent_location_id : location.parent_location_id;
    let parent: typeof schema.locationMaster.$inferSelect | undefined;
    let newLocationLevel: number | undefined;
    if (effectiveParentId) {
      if (effectiveParentId === id) throw new ConflictException('A location cannot be its own parent.');
      [parent] = await this.db.select().from(schema.locationMaster).where(and(
        eq(schema.locationMaster.location_id, effectiveParentId),
        eq(schema.locationMaster.tenant_id, tenantId),
        effectiveCompanyId
          ? eq(schema.locationMaster.company_id, effectiveCompanyId)
          : isNull(schema.locationMaster.company_id),
        isNull(schema.locationMaster.deleted_at),
      )).limit(1);
      if (!parent) throw new NotFoundException(`Parent Location '${effectiveParentId}' not found.`);
      if (!allowedParentTypes.includes(parent.location_type)) {
        throw new ConflictException(`${locationType.type_name} must be placed under ${allowedParentTypes.join(' or ')}.`);
      }
      await this.assertNoHierarchyCycle(id, effectiveParentId, tenantId);
      newLocationLevel = parent.location_level + 1;
    } else if (allowedParentTypes.length > 0) {
      throw new ConflictException(`${locationType.type_name} requires a parent location.`);
    } else {
      newLocationLevel = 1;
    }

    // SILO locations must carry silo tracking fields — validate against effective values so a
    // partial update that doesn't touch these fields doesn't spuriously fail.
    const effectiveSiloCapacity = dto.silo_capacity_kg !== undefined ? dto.silo_capacity_kg : location.silo_capacity_kg;
    const effectiveSiloReorderDays = dto.silo_reorder_days !== undefined ? dto.silo_reorder_days : location.silo_reorder_days;
    const effectiveStorage = dto.storage_type !== undefined ? dto.storage_type : location.storage_type || (effectiveLocationType === 'SILO' ? 'SILO' : null);
    this.assertSiloFieldsWhenSilo(effectiveStorage, effectiveSiloCapacity as any, effectiveSiloReorderDays as any);

    if (dto.area_unit !== undefined) {
      await this.assertUomExists(dto.area_unit, tenantId, dto.company_id !== undefined ? dto.company_id : location.company_id);
    }
    if (dto.capacity_uom !== undefined) {
      await this.assertUomExists(dto.capacity_uom, tenantId, dto.company_id !== undefined ? dto.company_id : location.company_id);
    }

    // This location's area must still fit inside its (possibly newly-assigned) parent's, and —
    // the other direction — shrinking its own area must not strand children that already fit
    // under the old value.
    if (dto.area_size !== undefined || dto.area_unit !== undefined || dto.parent_location_id !== undefined) {
      const effectiveAreaSize = dto.area_size !== undefined ? dto.area_size : location.area_size;
      const effectiveAreaUnit = dto.area_unit !== undefined ? dto.area_unit : location.area_unit;
      // Exclude this location from its own sibling total, or editing a location
      // without changing its area would count it twice and reject a valid save.
      await this.assertAreaFitsInParent(effectiveAreaSize, effectiveAreaUnit, parent, tenantId, id);
      if (dto.area_size !== undefined || dto.area_unit !== undefined) {
        await this.assertChildTotalFitsWithinArea(id, effectiveAreaSize, effectiveAreaUnit, tenantId);
      }
    }

    if (dto.max_capacity !== undefined || dto.capacity_uom !== undefined || dto.parent_location_id !== undefined) {
      const effectiveCapacity = dto.max_capacity !== undefined ? dto.max_capacity : location.max_capacity;
      const effectiveCapacityUom = dto.capacity_uom !== undefined ? dto.capacity_uom : location.capacity_uom;
      await this.assertCapacityFitsInParent(effectiveCapacity, effectiveCapacityUom, parent, tenantId, id);
      if (dto.max_capacity !== undefined) {
        await this.assertChildTotalFitsWithinCapacity(id, effectiveCapacity, tenantId);
      }
    }

    const updates: any = {
      updated_by: userPayload?.userId || null,
      updated_at: toMysqlTimestamp(),
    };

    if (dto.nob_id !== undefined) updates.nob_id = dto.nob_id;
    if (dto.lob_id !== undefined) updates.lob_id = dto.lob_id;
    if (dto.location_name !== undefined) updates.location_name = dto.location_name;
    if (dto.location_address !== undefined) {
      if (location.location_type === 'FARM' && !dto.location_address.trim()) {
        throw new BadRequestException('Location Address is required for a Farm.');
      }
      updates.location_address = location.location_type === 'FARM' ? dto.location_address.trim() : null;
    }
    if (dto.parent_location_id !== undefined) {
      updates.parent_location_id = dto.parent_location_id;
      updates.location_level = newLocationLevel;
      // Same level-1 derivation as create(): reparenting under any root type
      // re-anchors the subtree's farm, not just under a literal FARM row.
      updates.farm_id = newLocationLevel === 1 ? id : parent ? (parent.location_level === 1 ? parent.location_id : parent.farm_id) : null;
      updates.shed_id = location.location_type === 'SHED' ? id : parent ? (parent.location_type === 'SHED' ? parent.location_id : parent.shed_id) : null;
      updates.warehouse_id = WAREHOUSE_LOCATION_TYPES.includes(location.location_type) ? id : parent ? (WAREHOUSE_LOCATION_TYPES.includes(parent.location_type) ? parent.location_id : parent.warehouse_id) : null;
    }
    if (dto.area_size !== undefined) updates.area_size = dto.area_size?.toString() || null;
    if (dto.area_unit !== undefined) updates.area_unit = dto.area_unit;
    if (dto.max_capacity !== undefined) updates.max_capacity = dto.max_capacity?.toString() || null;
    if (dto.capacity_uom !== undefined) updates.capacity_uom = dto.capacity_uom;
    if (dto.current_count !== undefined) updates.current_count = dto.current_count?.toString() || '0.00';
    if (dto.gps_latitude !== undefined) updates.gps_latitude = dto.gps_latitude?.toString() || null;
    if (dto.gps_longitude !== undefined) updates.gps_longitude = dto.gps_longitude?.toString() || null;
    if (dto.storage_type !== undefined) updates.storage_type = dto.storage_type;
    if (dto.is_quarantine_zone !== undefined) updates.is_quarantine_zone = dto.is_quarantine_zone;
    if (dto.silo_capacity_kg !== undefined) updates.silo_capacity_kg = dto.silo_capacity_kg?.toString() || null;
    if (dto.silo_reorder_days !== undefined) updates.silo_reorder_days = dto.silo_reorder_days;
    if (effectiveStorage !== 'SILO') {
      updates.silo_capacity_kg = null;
      updates.silo_reorder_days = null;
    }
    if (dto.downtime_days_required !== undefined) updates.downtime_days_required = dto.downtime_days_required;
    if (dto.storage_name !== undefined) updates.storage_name = dto.storage_name;
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.extension_config !== undefined) updates.extension_config = JSON.stringify(dto.extension_config);

    const effective = { ...location, ...updates };
    await this.db.transaction(async (tx) => {
      await tx.update(schema.locationMaster).set(updates).where(eq(schema.locationMaster.location_id, id));
    });

    await this.auditService.log({
      tenantId,
      companyId: location.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'location_master',
      entityId: id,
      oldValues: location,
      newValues: updates,
    });

    return this.findOne(id, tenantId);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const location = await this.findOne(id, tenantId);
    const deletedTime = toMysqlTimestamp();

    const [child] = await this.db.select({
      location_id: schema.locationMaster.location_id,
      location_name: schema.locationMaster.location_name,
      location_code: schema.locationMaster.location_code,
    })
      .from(schema.locationMaster).where(and(
        eq(schema.locationMaster.parent_location_id, id),
        eq(schema.locationMaster.tenant_id, tenantId),
        eq(schema.locationMaster.is_active, true),
        isNull(schema.locationMaster.deleted_at),
      )).limit(1);
    if (child) {
      throw new ConflictException(
        `Cannot deactivate location '${location.location_name}' because it contains active child location '${child.location_name || child.location_code}'. Please deactivate child locations first.`,
      );
    }

    const updates = {
        is_active: false,
        status: 'INACTIVE',
        deleted_at: deletedTime as any,
        updated_by: userPayload?.userId || null,
        updated_at: deletedTime,
    };
    await this.db.transaction(async (tx) => {
      await tx.update(schema.locationMaster).set(updates).where(eq(schema.locationMaster.location_id, id));
    });

    await this.auditService.log({
      tenantId,
      companyId: location.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'location_master',
      entityId: id,
      oldValues: location,
      newValues: { status: 'INACTIVE', deleted_at: deletedTime },
    });

    return { success: true, message: `Location '${location.location_name}' has been soft-deleted.` };
  }

  async restore(id: string, tenantId: string, userPayload?: any) {
    const [location] = await this.db
      .select()
      .from(schema.locationMaster)
      .where(and(
        eq(schema.locationMaster.location_id, id),
        eq(schema.locationMaster.tenant_id, tenantId),
      ))
      .limit(1);

    if (!location) {
      throw new NotFoundException(`Location with ID '${id}' not found.`);
    }

    if (!location.deleted_at) {
      return location;
    }

    const updates = {
        is_active: true,
        status: 'ACTIVE',
        deleted_at: null,
        updated_by: userPayload?.userId || null,
        updated_at: toMysqlTimestamp(),
    };
    await this.db.transaction(async (tx) => {
      await tx.update(schema.locationMaster).set(updates).where(eq(schema.locationMaster.location_id, id));
    });

    await this.auditService.log({
      tenantId,
      companyId: location.company_id || undefined,
      userId: userPayload?.userId,
      action: 'RESTORE',
      entityName: 'location_master',
      entityId: id,
      oldValues: location,
      newValues: { status: 'ACTIVE', deleted_at: null },
    });

    return this.findOne(id, tenantId);
  }

  async getLocationOccupancy(tenantId: string, companyId?: string) {
    const conditions: any[] = [
      eq(schema.locationMaster.tenant_id, tenantId),
      eq(schema.locationMaster.is_active, true),
      isNull(schema.locationMaster.deleted_at),
    ];
    if (companyId) {
      conditions.push(
        or(
          eq(schema.locationMaster.company_id, companyId),
          isNull(schema.locationMaster.company_id)
        )
      );
    }

    // The parent's name comes from the parent location itself. This used to
    // left-join farm_master and shed_master and fall back farm -> shed, which
    // could not name a parent of any other type (a pen under a pen, a silo
    // under a shed) and needed two dead tables to answer one question.
    // locationMaster is self-referential, so Drizzle's alias overload widens it
    // to a table/view union under TS 5.9. It is still the same MySQL table shape;
    // keep that shape explicit so leftJoin accepts the alias.
    const parentLocation = alias(schema.locationMaster, 'parent_location') as unknown as typeof schema.locationMaster;
    const locations = await this.db
      .select({
        location: schema.locationMaster,
        parent: parentLocation,
      })
      .from(schema.locationMaster)
      .leftJoin(parentLocation as any, eq(schema.locationMaster.parent_location_id, parentLocation.location_id))
      .where(and(...conditions));

    // Get animal counts per location
    const animalConditions: any[] = [
      eq(schema.animalRegister.tenant_id, tenantId),
      eq(schema.animalRegister.is_active, true),
    ];
    if (companyId) {
      animalConditions.push(eq(schema.animalRegister.company_id, companyId));
    }

    const animals = await this.db
      .select({
        animal_id: schema.animalRegister.animal_id,
        current_location_id: schema.animalRegister.current_location_id,
        animal_type: schema.animalRegister.animal_type,
        status: schema.animalRegister.status,
      })
      .from(schema.animalRegister)
      .where(and(...animalConditions));

    // Get batch counts per location
    const batchConditions: any[] = [
      eq(schema.batchHeader.tenant_id, tenantId),
      eq(schema.batchHeader.status, 'ACTIVE'),
      isNull(schema.batchHeader.deleted_at),
    ];
    if (companyId) {
      batchConditions.push(eq(schema.batchHeader.company_id, companyId));
    }

    const batches = await this.db
      .select({
        batch_id: schema.batchHeader.batch_id,
        batch_no: schema.batchHeader.batch_no,
        location_id: schema.batchHeader.location_id,
        shed_id: schema.batchHeader.shed_id,
        opening_quantity: schema.batchHeader.opening_quantity,
      })
      .from(schema.batchHeader)
      .where(and(...batchConditions));

    // Group counts by location
    const animalCountMap: Record<string, number> = {};
    const sickQuarantineMap: Record<string, number> = {};

    for (const a of animals) {
      if (a.current_location_id) {
        animalCountMap[a.current_location_id] = (animalCountMap[a.current_location_id] || 0) + 1;
        if (a.status === 'SICK' || a.status === 'QUARANTINE') {
          sickQuarantineMap[a.current_location_id] = (sickQuarantineMap[a.current_location_id] || 0) + 1;
        }
      }
    }

    const batchCountMap: Record<string, number> = {};
    for (const b of batches) {
      const locId = b.location_id || b.shed_id;
      if (locId) {
        batchCountMap[locId] = (batchCountMap[locId] || 0) + Number(b.opening_quantity || 0);
      }
    }

    return locations.map(({ location, parent }) => {
      const animalHeadcount = animalCountMap[location.location_id] || 0;
      const batchHeadcount = batchCountMap[location.location_id] || (location.shed_id ? batchCountMap[location.shed_id] || 0 : 0);
      const totalOccupancy = animalHeadcount + batchHeadcount;
      const maxCap = location.max_capacity ? Number(location.max_capacity) : null;
      const utilizationPct = maxCap && maxCap > 0 ? Math.round((totalOccupancy / maxCap) * 100) : null;
      const isOverCapacity = maxCap != null && totalOccupancy > maxCap;
      const sickCount = sickQuarantineMap[location.location_id] || 0;

      return {
        location_id: location.location_id,
        location_code: location.location_code,
        location_name: location.location_name,
        location_type: location.location_type,
        parent_name: parent?.location_name || 'General',
        max_capacity: maxCap,
        capacity_uom: location.capacity_uom || 'HEAD',
        current_occupancy: totalOccupancy,
        animal_count: animalHeadcount,
        batch_count: batchHeadcount,
        utilization_pct: utilizationPct,
        is_over_capacity: isOverCapacity,
        biosecurity_status: sickCount > 0 ? 'QUARANTINE_ACTIVE' : 'NORMAL',
        sick_animal_count: sickCount,
        last_cleaned_date: location.last_cleaned_date || null,
        last_disinfected_date: location.last_disinfected_date || null,
      };
    });
  }
}
