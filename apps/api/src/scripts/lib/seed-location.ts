import { randomUUID } from 'node:crypto';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../../core/database/schema';
import {
  formatSeriesCode,
  formatSeriesStem,
  nextSequenceInStem,
} from '../../modules/system/number-series/code-format.util';

/**
 * Seeds one row of the location tree.
 *
 * `location_master` is the single table for farms, sheds, pens, stores, silos,
 * cages and quarantine areas — one structure, distinguished by `location_type`
 * and by whether `parent_location_id` is set. farm_master, shed_master and
 * warehouse_master are gone; farm_id/shed_id/warehouse_id are now denormalised
 * ancestor pointers back into this same table.
 *
 * Both seed scripts previously inlined their own version of this and drifted,
 * writing farms and sheds into those separate tables with fresh `randomUUID()`s
 * so no location row existed behind them, and leaving every pen with
 * `parent_location_id` NULL and a hardcoded `location_level: 3`. One helper,
 * used by both, is what stops that recurring.
 *
 * `location_code` is no longer supplied by the caller. The seeds used to hand
 * over codes they had invented — PEN-AI-B2, SHED-GEST-01, FARM-01 — none of
 * which the LOCATION series could ever have produced, so a demo database looked
 * as though the series had issued them when it had issued nothing at all. The
 * code now comes from the series, exactly as location.service.ts derives it at
 * runtime: <parent code>/<TYPE>-<seq>, counted among siblings sharing that stem.
 * Callers pass `key` instead, which is their own handle for wiring parents and
 * cross-references together and never reaches the database.
 */

export type SeedLocationType = 'FARM' | 'SHED' | 'PEN' | 'STORE' | 'SILO' | 'QUARANTINE' | 'CAGE';

export interface SeededLocation {
  id: string;
  /** The code the series produced, so a child can name it as its parent segment. */
  code: string;
  farmId: string | null;
  shedId: string | null;
  warehouseId: string | null;
  level: number;
}

export interface SeedLocationInput {
  /**
   * The seed's own handle for this location — used to look it up in the
   * script's maps and to wire children to parents. Not written to the database;
   * `location_code` is generated from the LOCATION series.
   */
  key: string;
  name: string;
  type: SeedLocationType;
  parent?: SeededLocation | null;
  capacity?: number;
  capacityUom?: string;
  /** Only meaningful for FARM/SHED mirrors, which carry a free-text subtype. */
  subType?: string;
  storageType?: 'STORE' | 'SILO';
  siloCapacityKg?: number;
  siloReorderDays?: number;
  isQuarantineZone?: boolean;
  lastCleanedDate?: string;
  lastDisinfectedDate?: string;
}

export async function seedLocation(
  db: any,
  ctx: { tenantId: string; companyId: string; nobId?: string | null; lobId?: string | null },
  loc: SeedLocationInput,
): Promise<SeededLocation> {
  // Idempotency keys on the name, not the code. The code is generated now, so
  // it is not known until after this check — and the name is what identifies
  // the same location across re-runs anyway.
  const [existing] = await db
    .select()
    .from(schema.locationMaster)
    .where(
      and(
        eq(schema.locationMaster.company_id, ctx.companyId),
        eq(schema.locationMaster.location_name, loc.name),
      ),
    )
    .limit(1);

  if (existing) {
    return {
      id: existing.location_id,
      code: existing.location_code,
      farmId: existing.farm_id,
      shedId: existing.shed_id,
      warehouseId: existing.warehouse_id,
      level: existing.location_level,
    };
  }

  const code = await generateLocationCode(db, ctx, loc);
  const id = randomUUID();
  const parent = loc.parent || null;
  // Depth is derived, never asserted. The old seeds hardcoded 3 on every pen.
  const level = parent ? parent.level + 1 : 1;
  const farmId = loc.type === 'FARM' ? id : parent?.farmId ?? null;
  const shedId = loc.type === 'SHED' ? id : parent?.shedId ?? null;
  const warehouseId = ['STORE', 'SILO'].includes(loc.type) ? id : parent?.warehouseId ?? null;

  await db.insert(schema.locationMaster).values({
    location_id: id,
    tenant_id: ctx.tenantId,
    company_id: ctx.companyId,
    nob_id: ctx.nobId ?? null,
    lob_id: ctx.lobId ?? null,
    farm_id: farmId,
    shed_id: shedId,
    warehouse_id: warehouseId,
    location_code: code,
    location_name: loc.name,
    location_level: level,
    location_type: loc.type,
    parent_location_id: parent?.id ?? null,
    max_capacity: loc.capacity != null ? loc.capacity.toString() : null,
    capacity_uom: loc.capacity != null ? loc.capacityUom || 'HEAD' : null,
    storage_type: loc.storageType ?? null,
    silo_capacity_kg: loc.siloCapacityKg != null ? loc.siloCapacityKg.toString() : null,
    silo_reorder_days: loc.siloReorderDays ?? null,
    is_quarantine_zone: loc.isQuarantineZone ?? false,
    last_cleaned_date: loc.lastCleanedDate ?? null,
    last_disinfected_date: loc.lastDisinfectedDate ?? null,
    is_active: true,
    status: 'ACTIVE',
  });

  return { id, code, farmId, shedId, warehouseId, level };
}

/**
 * The LOCATION series, applied the way location.service.ts applies it.
 *
 * The two segments the series names are references, not literals: a location's
 * `parent_location_id` contributes the parent's own code, and `location_type`
 * contributes the location type's `code_prefix` (QUARANTINE's prefix is QUAR,
 * which is what has always gone in a code). NumberSeriesService resolves both
 * through its SEGMENT_REFERENCES / SEGMENT_CODE_LOOKUPS registries; here the
 * parent is already in hand and the prefix is one lookup, so the resolved
 * values are passed straight to the formatter.
 *
 * The number counts within the stem, not across the series: the first pen of
 * shed 2 is <shed 2>/PEN-001 even when shed 1 already has three. That is what
 * `nextSequenceInStem` is for, and it is why the seed does not touch
 * `current_seq` for LOCATION — a per-stem counter has no single number to
 * advance.
 *
 * Falls back to the series' own defaults if the row is missing, so a seed run
 * against a tenant that predates the series still produces a usable code rather
 * than throwing.
 */
async function generateLocationCode(
  db: any,
  ctx: { tenantId: string; companyId: string },
  loc: SeedLocationInput,
): Promise<string> {
  const [series] = await db
    .select()
    .from(schema.noSeriesMaster)
    .where(
      and(
        eq(schema.noSeriesMaster.tenant_id, ctx.tenantId),
        eq(schema.noSeriesMaster.series_code, 'LOCATION'),
        or(eq(schema.noSeriesMaster.company_id, ctx.companyId), isNull(schema.noSeriesMaster.company_id)),
        isNull(schema.noSeriesMaster.deleted_at),
      ),
    )
    .orderBy(sql`${schema.noSeriesMaster.company_id} IS NULL`)
    .limit(1);

  const format = series ?? {
    prefix: null, separator: '/', seq_separator: '-', seq_length: 3,
    current_seq: 0, reset_frequency: 'NEVER', updated_at: new Date(),
    code_segments: ['parent_location_id', 'location_type'], prefix_position: 'END',
  };

  const [type] = await db
    .select({ prefix: schema.locationTypeMaster.code_prefix })
    .from(schema.locationTypeMaster)
    .where(
      and(
        eq(schema.locationTypeMaster.tenant_id, ctx.tenantId),
        eq(schema.locationTypeMaster.type_code, loc.type),
        or(eq(schema.locationTypeMaster.company_id, ctx.companyId), isNull(schema.locationTypeMaster.company_id)),
      ),
    )
    .orderBy(sql`${schema.locationTypeMaster.company_id} IS NULL`)
    .limit(1);

  const now = new Date();
  const segments = {
    parent_location_id: loc.parent?.code ?? null,
    location_type: type?.prefix ?? loc.type,
  };

  const stem = formatSeriesStem(format as any, now, segments);
  const siblings = await db
    .select({ code: schema.locationMaster.location_code })
    .from(schema.locationMaster)
    .where(eq(schema.locationMaster.company_id, ctx.companyId));

  const sequence = nextSequenceInStem(
    stem,
    format.seq_separator || format.separator || '-',
    siblings.map((row: { code: string }) => row.code),
  );

  return formatSeriesCode(format as any, sequence, now, segments);
}
