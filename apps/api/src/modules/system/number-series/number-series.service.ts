import { companyCondition, MASTER_TABLES, masterScopeConditions } from '../../../common/master-data-scope';
import { Injectable, NotFoundException, ConflictException, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, like, ne, not, or, isNull, sql, desc, getTableColumns, count } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { CreateNumberSeriesDto, UpdateNumberSeriesDto, QueryNumberSeriesDto } from './dto/number-series.dto';
import { CreateNoSeriesDto, UpdateNoSeriesDto } from '../../master-data/no-series/dto/no-series.dto';
import { AuditLogService } from '../audit-log/audit-log.service';
import { NobLobResolutionService } from '../../core/operational-area/nob-lob-resolution.service';
import { formatSeriesCode, formatSeriesStem, nextSequence, nextSequenceInStem, segmentFields, assertCodeFits, parseSegment } from './code-format.util';
import { MASTER_CODE_COLUMNS } from './master-code-columns';
import { generateCompositeCode } from './composite-code.util';
import { CodePreviewDto } from './dto/code-preview.dto';
import { listFilterConditions, listOrderBy } from '../../../common/master-list-query';

const toMysqlTimestamp = (date: Date = new Date()) => date.toISOString().slice(0, 19).replace('T', ' ');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Masters that compose their own code from a type-driven segment (e.g. a
 * Location's prefix comes from its Location Type's `code_prefix`, not one
 * shared series) rather than a single flat No. Series. resolveCodeSettings()/
 * previewCode() already know how to build the right preview for these — but
 * this table also carries stale generic rows left over from before per-type
 * series existed (e.g. a `code = 'LOCATION'` row with a static `LOC-`
 * prefix). Left unguarded, findDefaultSeriesByMaster() matches that generic
 * row before the type is ever considered, so the create form previews
 * "LOC-0001" while the actual save (which goes through the type-aware path)
 * assigns "FARM-009". Refusing here for these masters sends the frontend's
 * preview call down the same type-aware path the real save uses, instead of
 * a shortcut that can disagree with it.
 */
const SELF_CODED_MASTERS = new Set(['ANIMAL', 'LOCATION']);

/**
 * Fields that hold a reference rather than a value, and the code to read in
 * their place: [MASTER_TABLES key, id column, code column]. A shed's segment
 * from `location_id` is the parent's FARM-002, not its UUID.
 *
 * A field absent here contributes its own value, which is what lets `breed_name`
 * or `item_type` be used as a segment with no entry at all.
 */
const SEGMENT_REFERENCES: Record<string, [string, string, string]> = {
  location_id: ['location', 'location_id', 'location_code'],
  parent_location_id: ['location', 'location_id', 'location_code'],
  parent_category_id: ['item-category', 'category_id', 'category_code'],
  parent_account_id: ['gl-account', 'gl_account_id', 'account_code'],
  parent_cost_center_id: ['cost-center', 'cost_center_id', 'cost_center_code'],
  breed_id: ['breed', 'breed_id', 'breed_code'],
  species_id: ['species', 'species_id', 'species_code'],
  category_id: ['item-category', 'category_id', 'category_code'],
  item_id: ['item', 'item_id', 'item_code'],
  stage_id: ['stage', 'stage_id', 'stage_code'],
};

/**
 * Fields holding a code rather than an id, and the master to translate it
 * through: [MASTER_TABLES key, column to match on, column to read].
 *
 * location_master.location_type holds QUARANTINE, while the code that location
 * types have always put in a code is their abbreviation QUAR. Matching on the
 * type code and reading code_prefix keeps that shape rather than silently
 * widening it to QUARANTINE.
 */
const SEGMENT_CODE_LOOKUPS: Record<string, [string, string, string]> = {
  location_type: ['location-type', 'type_code', 'code_prefix'],
};

/**
 * Segments whose value is itself a code that already carries separators — a
 * parent location's code is FARM-001/SHED-001, not a bare word.
 *
 * When one of these is in play the separator joining the levels and the one
 * before the number have to differ, or the code cannot be read back: with "-"
 * for both, FARM-001-SHED-001 gives no way to tell where the path ends and the
 * count begins, and the sibling counter stops matching its own stem. A flat
 * series has no such problem and may use the same character for both.
 */
const HIERARCHICAL_SEGMENTS = new Set([
  'parent_location_id', 'location_id', 'parent_category_id', 'parent_account_id', 'parent_cost_center_id',
]);

/** Rejects a separator pair that could not be read back. Returns the message, or null. */
export const separatorConflict = (segments: string[], separator: string | null, seqSeparator: string | null, seqLength?: number): string | null => {
  // With no number there is nothing to tell apart from the path: Item Category
  // is FEED-LACTATION, parent then name, and "-" for both is exactly right.
  if (seqLength === 0) return null;
  const hierarchical = segments.find((entry) => HIERARCHICAL_SEGMENTS.has(entry.split(':')[0]));
  if (!hierarchical) return null;
  const between = separator || '-';
  const beforeNumber = seqSeparator || between;
  if (between !== beforeNumber) return null;
  return `"${hierarchical}" contributes a code that already contains "${between}", so using "${between}" both between the parts and before the number `
    + `would produce a code nothing can read back — and the sibling counter would stop finding its own run. `
    + `Set a different Separator Before the Number (Location uses "/" between the levels and "-" before the number).`;
};

/** The declared width of a varchar code column, for the Option C length check. */
const codeColumnLength = (column: any): number | undefined => {
  const size = column?.length ?? column?.config?.length;
  return typeof size === 'number' ? size : undefined;
};

/**
 * Tenant + company scope for an arbitrary master table. breed_lifecycle_stages is
 * scoped through its breed and has no company_id column at all; passing its
 * undefined column to eq() builds invalid SQL, so the clause is simply omitted.
 */
const scopeKeyConditions = (columns: Record<string, any>, tenantId: string, companyId?: string | null) => {
  const conditions = [eq(columns.tenant_id, tenantId)];
  if (columns.company_id) conditions.push(companyCondition(columns.company_id, companyId));
  return conditions;
};

@Injectable()
export class NumberSeriesService {
  constructor(
    private readonly cls: ClsService,
    private readonly auditService: AuditLogService,
    private readonly nobLobResolution: NobLobResolutionService,
  ) { }

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb) {
      throw new Error('Tenant database connection context not established.');
    }
    return tenantDb;
  }

  /**
   * This table has no is_active column of its own — "Blocked" is its version
   * of that fact, inverted, going back to before the master-data screen's
   * generic Active/Inactive toggle existed. Computing is_active here (rather
   * than adding a real column) lets that same generic toggle — and the trash
   * icon's delete-really-means-deactivate convention every other master in
   * this app already follows — work for Number Series without a migration.
   */
  private withActive<T extends { blocked: boolean | null }>(row: T): T & { is_active: boolean } {
    return { ...row, is_active: !row.blocked };
  }

  /**
   * Materialise an independent counter from built-in defaults. This is
   * used by company-owned master records whose identities must never share a
   * counter with another company. `loadExistingCodes` lets the caller expose
   * its own master table without coupling this system service to every domain.
   *
   * The fallback keeps upgraded tenants working before the seed command is
   * rerun; new tenants receive the same definition from SYSTEM_NO_SERIES_SEED.
   */
  async ensureCompanySeries(
    tenantId: string,
    companyId: string | null | undefined,
    defaults: {
      seriesCode: string;
      seriesName: string;
      documentType: string;
      prefix: string;
      separator?: string;
      seqLength: number;
    },
    loadExistingCodes: () => Promise<Array<string | null | undefined>>,
  ): Promise<void> {
    const [existing] = await this.db.select().from(schema.noSeries).where(and(
      eq(schema.noSeries.tenant_id, tenantId),
      companyCondition(schema.noSeries.company_id, companyId),
      eq(schema.noSeries.code, defaults.seriesCode),
      isNull(schema.noSeries.deleted_at),
    )).limit(1);
    if (existing) return;

    // Existing companies must not observe later changes to tenant drafts.
    const prefix = defaults.prefix;
    const separator = defaults.separator || '-';
    const existingCodes = await loadExistingCodes();
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedSeparator = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`^${escapedPrefix}${escapedSeparator}(\\d+)$`, 'i');
    const currentSeq = existingCodes.reduce((max, code) => {
      const match = code?.match(pattern);
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);

    await this.db.insert(schema.noSeries).values({
      id: randomUUID(),
      tenant_id: tenantId,
      company_id: companyId,
      code: defaults.seriesCode,
      description: defaults.seriesName,
      document_type: defaults.documentType,
      prefix,
      separator,
      seq_length: defaults.seqLength,
      current_seq: currentSeq,
      reset_frequency: 'NEVER',
      manual_nos: true,
    }).onDuplicateKeyUpdate({ set: { description: defaults.seriesName } });
  }

  /**
   * Concurrency-safe next-code generation: locks the single series row
   * (SELECT ... FOR UPDATE), resets current_seq if the reset_frequency period
   * has rolled over, increments, formats, and persists in one statement.
   * Pass `executor` (a transaction handle) when calling from inside a
   * `db.transaction()` — same pattern batch.service.ts's generateBatchNo() used.
   */
  /**
   * `record` is the row being created, keyed by its own field names. A series
   * configured with code_segments / prefix_field reads its segments out of it;
   * a series without them ignores it entirely, which is every series today.
   */
  async generateNext(
    seriesCode: string,
    tenantId: string,
    companyId?: string | null,
    executor?: MySql2Database<typeof schema>,
    record: Record<string, unknown> = {},
  ): Promise<string> {
    if (!executor) {
      return this.db.transaction((tx) => this.generateNext(seriesCode, tenantId, companyId, tx, record));
    }

    const conditions = [
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.code, seriesCode),
      isNull(schema.noSeries.deleted_at),
    ];
    // Templates and company counters are independent after company creation.
    conditions.push(
      companyCondition(schema.noSeries.company_id, companyId)
    );

    let series: typeof schema.noSeries.$inferSelect | undefined;
    try {
      const [found] = await executor
        .select()
        .from(schema.noSeries)
        .where(and(...conditions))
        .orderBy(sql`${schema.noSeries.company_id} IS NULL`)
        .limit(1)
        .for('update');
      series = found;
    } catch {
      // In mock DB test contexts or query failure, fall through
    }

    if (!series) {
      throw new NotFoundException(`Number series '${seriesCode}' not found for this tenant/company scope.`);
    }
    if (series.blocked) {
      throw new BadRequestException(`Number series '${seriesCode}' is inactive.`);
    }

    const now = new Date();
    const { sequence: nextSeq, code: formattedCode } = await this.nextAvailableCode(series, tenantId, companyId, executor, now, record);

    await executor
      .update(schema.noSeries)
      .set({
        current_seq: nextSeq,
        last_no_used: formattedCode,
        updated_at: toMysqlTimestamp(now) as any,
      })
      .where(eq(schema.noSeries.id, series.id));

    return formattedCode;
  }

  /** Includes inactive/deleted identities: a manual code is never overwritten
   * or recycled. This is also used by read-only previews, without a row lock. */
  private async nextAvailableCode(
    series: typeof schema.noSeries.$inferSelect,
    tenantId: string,
    companyId: string | null | undefined,
    executor = this.db,
    now = new Date(),
    record: Record<string, unknown> = {},
  ) {
    const master = series.document_type?.toUpperCase() ?? '';
    const field = MASTER_CODE_COLUMNS[master];
    const table = MASTER_TABLES[master.toLowerCase().replaceAll('_', '-')];
    const columns = table ? getTableColumns(table) : undefined;
    const occupied = new Set<string>();
    if (field && columns?.[field]) {
      const occupiedConditions = scopeKeyConditions(columns, tenantId, companyId);
      const rows = await executor.select({ code: columns[field] }).from(table).where(and(...occupiedConditions));
      for (const row of rows) occupied.add(String(row.code).toUpperCase());
    }
    const segments = await this.resolveSegmentValues(series, record, tenantId, companyId, executor);
    // A series built from segments counts within its stem, not across the whole
    // series: the first shed of farm 2 is FARM002-SHED-001 even when farm 1
    // already has three. That is what location.service has always done for
    // locations, generalised — without it, folding a hierarchy onto this path
    // would renumber every child by its siblings elsewhere in the tenant.
    const stem = segmentFields(series).length ? formatSeriesStem(series, now, segments) : '';
    let sequence = stem
      ? nextSequenceInStem(stem, series.seq_separator || series.separator || '-', occupied)
      : nextSequence(series, now);
    let code = formatSeriesCode(series, sequence, now, segments);
    // With no sequence there is nothing to advance, so a clash is final. Saying
    // so beats looping forever on a code that cannot change.
    if (series.seq_length <= 0) {
      if (occupied.has(code.toUpperCase())) {
        throw new ConflictException(
          `Code "${code}" already exists. This series has no number, so its code comes entirely from the fields — ` +
          `two records with the same values cannot both have one. Rename, or give the series a sequence.`
        );
      }
    } else {
      while (occupied.has(code.toUpperCase())) code = formatSeriesCode(series, ++sequence, now, segments);
    }
    // Option C: an over-long code is refused, never trimmed. Codes are identity,
    // and trimming turns two different names into one code.
    assertCodeFits(code, columns?.[field] ? codeColumnLength(columns[field]) : undefined);
    return { sequence, code };
  }

  /**
   * Turns the record being created into the values the series' segments name.
   *
   * A field holding a UUID is a reference: the segment is the referenced row's
   * own code, so a shed under FARM-002 carries FARM-002, not the parent's id.
   * Anything else contributes its own value. A field the registry does not map
   * is read straight off the record, which is what makes `breed_name` work
   * without any registry entry at all.
   */
  private async resolveSegmentValues(
    series: typeof schema.noSeries.$inferSelect,
    record: Record<string, unknown>,
    tenantId: string,
    companyId: string | null | undefined,
    executor: MySql2Database<typeof schema> = this.db,
  ): Promise<Record<string, unknown>> {
    // A date segment is stored as `field:YEAR`; the lookup wants the field.
    const wanted = new Set(segmentFields(series).map((entry) => parseSegment(entry).field));
    const resolved: Record<string, unknown> = {};
    for (const field of wanted) {
      const raw = record[field];
      if (raw === null || raw === undefined || raw === '') continue;
      const reference = SEGMENT_REFERENCES[field];
      const codeLookup = SEGMENT_CODE_LOOKUPS[field];
      if (reference && UUID_PATTERN.test(String(raw))) {
        resolved[field] = await this.lookupReferencedCode(reference, String(raw), tenantId, companyId, executor);
      } else if (codeLookup) {
        resolved[field] = (await this.lookupReferencedCode(codeLookup, String(raw), tenantId, companyId, executor)) ?? raw;
      } else {
        resolved[field] = raw;
      }
    }
    return resolved;
  }

  private async lookupReferencedCode(
    reference: [string, string, string],
    id: string,
    tenantId: string,
    companyId: string | null | undefined,
    executor: MySql2Database<typeof schema>,
  ): Promise<string | undefined> {
    const [tableKey, idColumn, codeColumn] = reference;
    const table = MASTER_TABLES[tableKey];
    if (!table) return undefined;
    const columns = getTableColumns(table);
    if (!columns[idColumn] || !columns[codeColumn]) return undefined;
    const [row] = await executor
      .select({ code: columns[codeColumn] })
      .from(table)
      .where(and(
        eq(columns[idColumn], id),
        eq(columns.tenant_id, tenantId),
        companyCondition(columns.company_id, companyId),
        isNull(columns.deleted_at),
      ))
      .limit(1);
    return row?.code == null ? undefined : String(row.code);
  }

  /**
   * Type-aware series resolution, shared by every master that wants "auto-numbered
   * where configured, manual everywhere else". Checks, in order:
   *   1. a series for master + type (e.g. `ITEM_RAW_MATERIAL`, `ANIMAL_SOW`) — the
   *      more specific configuration;
   *   2. else a series for the master alone (e.g. `ITEM`, `ANIMAL`);
   *   3. else `null` — meaning nothing is configured and the caller must leave the
   *      code field to manual entry, exactly as it works today. This is what keeps
   *      `KG`, `LITER`, `GESTATION` and `LARGE_WHITE` meaningful: a master is only
   *      auto-numbered once someone deliberately adds a series row for it.
   *
   * Returns the resolved `series_code` (not a generated code) so the caller passes
   * it straight into `generateNext` / `lockSeries`. Only checks existence + active
   * state — it never mutates a series row, so it's safe to call speculatively
   * before deciding whether to generate a code at all.
   */
  async resolveSeriesFor(
    masterKey: string,
    typeValue: string | null | undefined,
    tenantId: string,
    companyId?: string | null,
    executor: MySql2Database<typeof schema> = this.db,
  ): Promise<string | null> {
    const seriesExists = async (seriesCode: string): Promise<boolean> => {
      const conditions = [
        eq(schema.noSeries.tenant_id, tenantId),
        eq(schema.noSeries.code, seriesCode),
        eq(schema.noSeries.blocked, false),
        isNull(schema.noSeries.deleted_at),
      ];
      conditions.push(
        companyCondition(schema.noSeries.company_id, companyId)
      );
      try {
        const [row] = await executor
          .select({ id: schema.noSeries.id })
          .from(schema.noSeries)
          .where(and(...conditions))
          .limit(1);
        if (row) return true;
      } catch {
        // Fall through
      }

      return false;
    };

    if (typeValue) {
      const typeSeriesCode = `${masterKey}_${typeValue}`.toUpperCase();
      if (await seriesExists(typeSeriesCode)) return typeSeriesCode;
    }

    const masterSeriesCode = masterKey.toUpperCase();
    if (await seriesExists(masterSeriesCode)) return masterSeriesCode;

    return null;
  }

  /**
   * The masters that can still be given a series in this scope. A master takes
   * its code from exactly one series — resolveSeriesFor() looks up a single row
   * by master key — so offering a master that already has one invites a
   * duplicate that would silently never be reached. Type-scoped series
   * (LOCATION_SHED) are matched by prefix so a master keeps offering itself
   * while it still has types without a series of their own.
   */
  /**
   * `all` returns every master rather than only those without a series.
   *
   * Two different questions share this list. "Applies To" is the series_code and
   * must be unique, so it offers only what is free. "Master This Codes" is the
   * document_type, and several series legitimately share one — LOCATION_FARM,
   * LOCATION_SHED and LOCATION_PEN are all document_type LOCATION. Filtering
   * that one by what is taken emptied it the moment every master had a series,
   * leaving a create form with nothing to choose.
   */
  async availableMasters(tenantId: string, companyId?: string | null, current?: string, all = false) {
    const rows = await this.db
      .select({ code: schema.noSeries.code })
      .from(schema.noSeries)
      .where(and(
        eq(schema.noSeries.tenant_id, tenantId),
        isNull(schema.noSeries.deleted_at),
        companyCondition(schema.noSeries.company_id, companyId),
      ));
    const taken = new Set(rows.map((r) => r.code));
    const keep = current?.toUpperCase();
    return Object.keys(MASTER_CODE_COLUMNS)
      .sort()
      .filter((key) => all || key === keep || (!taken.has(key) && !SELF_CODED_MASTERS.has(key)))
      .map((key) => ({ master_key: key, code_column: MASTER_CODE_COLUMNS[key] }));
  }

  async resolveCodeSettings(master: string, type: string | undefined, tenantId: string, companyId?: string | null) {
    if (!/^[A-Z][A-Z_]{0,49}$/.test(master)) throw new BadRequestException('Invalid master code.');
    const code = await this.resolveSeriesFor(master, type, tenantId, companyId) ||
      (master === 'ANIMAL' ? await this.resolveSeriesFor('ANIMAL', 'PIGGERY', tenantId, companyId) : null);
    if (!code) return { generated: false, allowManual: true };

    try {
      const [row] = await this.db.select().from(schema.noSeries).where(and(
        eq(schema.noSeries.tenant_id, tenantId), eq(schema.noSeries.code, code),
        eq(schema.noSeries.blocked, false), isNull(schema.noSeries.deleted_at),
        companyCondition(schema.noSeries.company_id, companyId),
      )).orderBy(sql`${schema.noSeries.company_id} IS NULL`).limit(1);
      if (row) {
        return { generated: true, allowManual: row.manual_nos, seriesCode: row.code, prefix: row.prefix };
      }
    } catch {
      // Fall through in mock environments
    }

    return { generated: false, allowManual: true };
  }

  /** Read-only: never initializes a series, increments a counter, or reserves a code. */
  async previewCode(query: CodePreviewDto, tenantId: string, companyId?: string | null) {
    if (!MASTER_CODE_COLUMNS[query.master]) throw new BadRequestException('Unsupported master code.');
    let type = query.type;
    if (query.master === 'ANIMAL') {
      const scope = this.cls.get<{ lobId?: string }>('masterScope');
      const lobId = query.lobId || scope?.lobId;
      if (lobId) {
        const [lob] = await this.db.select({ code: schema.lobMaster.lob_code }).from(schema.lobMaster).where(eq(schema.lobMaster.lob_id, lobId)).limit(1);
        type = lob?.code;
      }
    }
    const settings = await this.resolveCodeSettings(query.master, type, tenantId, companyId);
    if (!settings.generated || !settings.seriesCode) return settings;
    // The record the form is holding, so the preview composes the same segments
    // the allocator will. Malformed JSON previews as if nothing was sent rather
    // than failing the request — a preview is advisory, never a gate on saving.
    let record: Record<string, unknown> = {};
    if (query.record) {
      try {
        const parsed = JSON.parse(query.record);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) record = parsed as Record<string, unknown>;
      } catch { record = {}; }
    }
    const [series] = await this.db.select().from(schema.noSeries).where(and(
      eq(schema.noSeries.tenant_id, tenantId), companyCondition(schema.noSeries.company_id, companyId),
      eq(schema.noSeries.code, settings.seriesCode),
      eq(schema.noSeries.blocked, false), isNull(schema.noSeries.deleted_at),
    )).limit(1);
    if (!series) return { generated: false, allowManual: true };
    const hierarchy: Record<string, [string, string, string, string]> = {
      LOCATION: ['location', 'location_id', 'location_code', 'parent_location_id'],
      ITEM_CATEGORY: ['item-category', 'category_id', 'category_code', 'parent_category_id'],
      GL_ACCOUNT: ['gl-account', 'gl_account_id', 'account_code', 'parent_account_id'],
      COST_CENTER: ['cost-center', 'cost_center_id', 'cost_center_code', 'parent_cost_center_id'],
    };
    const definition = hierarchy[query.master];
    if (query.parentId && definition) {
      const [parentKey, parentId, parentCode, childParent] = definition;
      const parentTable = MASTER_TABLES[parentKey];
      const parentColumns = getTableColumns(parentTable);
      const [parent] = await this.db.select().from(parentTable).where(and(
        eq(parentColumns[parentId], query.parentId), eq(parentColumns.tenant_id, tenantId),
        companyCondition(parentColumns.company_id, companyId), isNull(parentColumns.deleted_at),
        eq(parentColumns.is_active, true), ...masterScopeConditions(this.cls, parentTable),
      )).limit(1);
      if (!parent) throw new BadRequestException('Select an active parent in this workspace.');
      let prefix = series.prefix || series.code;
      if (query.master === 'LOCATION') {
        const [locationType] = await this.db.select().from(schema.locationTypeMaster).where(and(
          eq(schema.locationTypeMaster.tenant_id, tenantId), companyCondition(schema.locationTypeMaster.company_id, companyId),
          eq(schema.locationTypeMaster.type_code, query.type || ''), isNull(schema.locationTypeMaster.deleted_at),
        )).limit(1);
        if (!locationType) throw new BadRequestException('Select a location type first.');
        prefix = locationType.code_prefix;
      }
      const table = MASTER_TABLES[query.master.toLowerCase().replaceAll('_', '-')];
      const columns = getTableColumns(table);
      const conditions = [eq(columns.tenant_id, tenantId), companyCondition(columns.company_id, companyId), eq(columns[childParent], query.parentId)];
      if (query.master === 'LOCATION') conditions.push(eq(columns.location_type, query.type!));
      const preview = await generateCompositeCode({
        parentCode: String(parent[parentCode]), prefix, seqLength: series.seq_length,
        fetchSiblingCodes: async () => this.db.select({ code: columns[MASTER_CODE_COLUMNS[query.master]] }).from(table).where(and(...conditions)) as Promise<{ code: string }[]>,
      });
      return { ...settings, preview };
    }
    // A root location (no parentId — a Farm has no parent to preview under)
    // still composes its stem from location_type, exactly as generateLocationCode()
    // does for the real create. Without this, the preview skipped the segment
    // resolution above entirely and showed the bare sequence ("006") instead
    // of the type-prefixed code ("FARM-006") the save will actually produce.
    if (query.master === 'LOCATION' && query.type && record.location_type === undefined) {
      record.location_type = query.type;
    }
    return { ...settings, preview: (await this.nextAvailableCode(series, tenantId, companyId, this.db, new Date(), record)).code };
  }

  /** Validate an explicit manual identity without consuming the series. */
  /**
   * `record` is the row being created, so a series configured with code_segments
   * composes from its own master's fields. Reason, Location Type and Item
   * Attribute reach the generator through here rather than calling generateNext
   * directly — without threading it, their segments would silently resolve to
   * nothing while the form's preview showed the composed code.
   */
  async resolveNewCode(master: string, supplied: string | undefined, tenantId: string, companyId?: string | null, type?: string, record: Record<string, unknown> = {}): Promise<string> {
    if (supplied) return this.manualCode(master, supplied, tenantId, companyId, type);
    const series = await this.resolveSeriesFor(master, type, tenantId, companyId);
    if (!series) throw new BadRequestException('Enter a manual code or configure a number series for this master.');
    return this.generateNext(series, tenantId, companyId, undefined, record);
  }

  /**
   * Whether the master's identity is referenced by any other table — the guard
   * behind renameCode(). A code that is still referenced would become ambiguous
   * everywhere it is stored as a string: item_master.uom_primary reads a UOM
   * code, item_master.item_type reads a type code, batch_header.current_stage_code
   * reads a stage code.
   *
   * Listed per master rather than discovered dynamically so the check is exact
   * and auditable; adding a reference means adding it here. A master absent
   * from this map has no string-held references, so its code is always free to
   * follow its series.
   */
  private static readonly CODE_REFERENCES: Record<string, Array<{ table: string; column: string; label: string; isUuid?: boolean; jsonArrayOfCodes?: boolean }>> = {
    ITEM_TYPE: [{ table: 'itemMaster', column: 'item_type', label: 'an item' }],
    UOM: [
      { table: 'itemMaster', column: 'uom_primary', label: 'an item' },
      { table: 'itemMaster', column: 'uom_secondary', label: 'an item' },
    ],
    STAGE: [
      { table: 'batchHeader', column: 'current_stage_code', label: 'a batch' },
      { table: 'batchStageLog', column: 'to_stage_code', label: 'a stage log' },
      { table: 'farmRecord', column: 'stage_code', label: 'a farm record' },
      { table: 'reasonMaster', column: 'applicable_stages', label: 'a reason', jsonArrayOfCodes: true },
    ],
    SPECIES: [{ table: 'breedMaster', column: 'species_id', label: 'a breed', isUuid: true }],
    ITEM_CATEGORY: [{ table: 'itemMaster', column: 'sub_category', label: 'an item' }],
    ITEM_ATTRIBUTE: [
      { table: 'itemAttributeValues', column: 'attribute_id', label: 'an item attribute value', isUuid: true },
    ],
  };

  /**
   * A named master's code, recomposed from its own number series as if the row
   * were being created today — the same formatter, the same segment values read
   * from the row's current fields, the same stem-scoped next number. Called on
   * rename so the code follows the series the way create() built it, instead of
   * going stale when a name changes.
   *
   * Only meaningful for "named" series — codes composed from the record's own
   * fields (type_name, uom_name, breed_name…). A sequence-only series' code
   * carries nothing from the record, so there is nothing to recompute and its
   * code never moves.
   *
   * The row's own current code is excluded from the occupied set downstream, so
   * a rename that recomposes to the same code is a no-op rather than a clash.
   */
  async recomposeCode(
    master: string,
    row: Record<string, unknown>,
    tenantId: string,
    companyId?: string | null,
  ): Promise<string> {
    const seriesCode = await this.resolveSeriesFor(master, undefined, tenantId, companyId);
    if (!seriesCode) throw new BadRequestException(`No number series is configured for ${master}.`);
    const [series] = await this.db.select().from(schema.noSeries).where(and(
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.code, seriesCode),
      isNull(schema.noSeries.deleted_at),
    )).orderBy(sql`${schema.noSeries.company_id} IS NULL`).limit(1);
    if (!series) throw new BadRequestException(`Number series '${seriesCode}' not found.`);

    // Sequence-only series: nothing in the code came from the record, so a
    // rename has nothing to follow. The code stays as it is.
    if (!segmentFields(series).length) return String(row[MASTER_CODE_COLUMNS[master]] ?? '');

    const { code } = await this.nextAvailableCode(series, tenantId, companyId, this.db, new Date(), row);
    return code;
  }

  /**
   * Rename a master's code: recompose it from the series (above), refuse while
   * anything still references the old one, and validate the result for width
   * and uniqueness exactly as manualCode does — the same guarantees, because a
   * generated identity is still an identity.
   *
   * Returns the new code, or the old one unchanged when the series recomposes
   * to it — the common case of a row saved without a rename.
   */
  async renameCode(
    master: string,
    row: Record<string, unknown>,
    tenantId: string,
    companyId?: string | null,
  ): Promise<string> {
    const codeColumn = MASTER_CODE_COLUMNS[master];
    const oldCode = String(row[codeColumn] ?? '');
    const refs = NumberSeriesService.CODE_REFERENCES[master] ?? [];
    const tableKey = master.toLowerCase().replaceAll('_', '-');
    const table0 = MASTER_TABLES[tableKey];
    if (!table0 || !codeColumn) throw new BadRequestException('Unsupported master code.');
    const columns0 = getTableColumns(table0);
    const codeCol = columns0[codeColumn];
    const idKey = Object.keys(columns0).find((k) => k.endsWith('_id')) ?? 'id';
    const idValue = row[idKey];

    // Does anything still point at the old code? Checked per reference table so
    // the message can name what is holding it.
    if (refs.length) {
      for (const ref of refs) {
        const refTable = (schema as Record<string, any>)[ref.table];
        if (!refTable) continue;
        const refCols = getTableColumns(refTable);
        const col = refCols[ref.column];
        if (!col) continue;
        const conditions: any[] = [];
        if (ref.jsonArrayOfCodes) {
          // applicable_stages holds stage codes as a JSON array — a JSON_CONTAINS,
          // not an equality.
          conditions.push(sql`JSON_CONTAINS(${col}, ${JSON.stringify(oldCode)})`);
        } else {
          conditions.push(eq(col, ref.isUuid ? idValue : oldCode));
        }
        if (refCols.tenant_id) conditions.push(eq(refCols.tenant_id, tenantId));
        const [hit] = await this.db.select({ one: sql`1` }).from(refTable).where(and(...conditions)).limit(1);
        if (hit) {
          throw new ConflictException(
            `Code cannot follow the series while '${oldCode}' is still used by ${ref.label}. Retire the row or clear the references first.`,
          );
        }
      }
    }

    const newCode = await this.recomposeCode(master, row, tenantId, companyId);
    if (newCode === oldCode) return oldCode;

    // Width and uniqueness, the same gate a manual code passes. The row itself
    // is excluded so keeping the code is never a self-collision.
    const width = Number(codeCol.getSQLType().match(/\((\d+)\)/)?.[1] || 255);
    if (!newCode || newCode.length > width) throw new BadRequestException(`Code must contain 1 to ${width} characters.`);
    const [duplicate] = await this.db.select().from(table0).where(and(
      ...scopeKeyConditions(columns0, tenantId, companyId),
      eq(codeCol, newCode),
      ne(codeCol, oldCode),
    )).limit(1);
    if (duplicate) throw new ConflictException(`Code '${newCode}' already exists in this scope.`);
    return newCode;
  }

  /** Validate an explicit manual identity without consuming the series. */
  async manualCode(master: string, supplied: string, tenantId: string, companyId?: string | null, type?: string) {
    const settings = await this.resolveCodeSettings(master, type, tenantId, companyId);
    if (settings.generated && !settings.allowManual) throw new BadRequestException('This number series does not allow manual entry.');
    const code = supplied.trim().toUpperCase();
    const table = MASTER_TABLES[master.toLowerCase().replaceAll('_', '-')];
    if (!table || !MASTER_CODE_COLUMNS[master]) throw new BadRequestException('Unsupported master code.');
    const columns = getTableColumns(table);
    const column = columns[MASTER_CODE_COLUMNS[master]];
    const width = Number(column.getSQLType().match(/\((\d+)\)/)?.[1] || 255);
    if (!code || code.length > width) throw new BadRequestException(`Code must contain 1 to ${width} characters.`);
    const [duplicate] = await this.db.select().from(table).where(and(
      ...scopeKeyConditions(columns, tenantId, companyId), eq(column, code),
    )).limit(1);
    if (duplicate) throw new ConflictException(`Code '${code}' already exists in this scope.`);
    return code;
  }

  /**
   * Optional-identity counterpart of resolveNewCode(), for the masters whose code
   * column is nullable because no numbering convention has been agreed for them
   * yet (medicine, UOM conversion, GL mapping, breed lifecycle stage).
   *
   * Same three-way resolution as every other master, minus the throw:
   *   1. a supplied code is validated for width and scope-uniqueness (manualCode);
   *   2. else a configured series generates one;
   *   3. else null — creation proceeds with no code, which is what happens today
   *      because resolveCodeSettings() returns { generated: false, allowManual: true }
   *      when no no_series_master row exists. Configure a series later and this
   *      starts auto-numbering with no further code change.
   */
  async resolveOptionalCode(
    master: string,
    supplied: string | undefined | null,
    tenantId: string,
    companyId?: string | null,
    type?: string,
    record: Record<string, unknown> = {},
  ): Promise<string | null> {
    if (supplied?.trim()) return this.manualCode(master, supplied, tenantId, companyId, type);
    const series = await this.resolveSeriesFor(master, type, tenantId, companyId);
    if (!series) return null;
    return this.generateNext(series, tenantId, companyId, undefined, record);
  }

  /**
   * Re-validates a manually edited code on update: same width/uniqueness rules as
   * manualCode(), but the record's own row is excluded so saving an unchanged code
   * is not a conflict with itself. Returns null when nothing was typed, meaning
   * "leave the stored code alone" — the master-data form posts "" for an untouched
   * optional field, and for these masters "" must not mean "clear the identity".
   */
  async editedCode(
    master: string,
    supplied: string | undefined | null,
    current: string | null | undefined,
    tenantId: string,
    companyId?: string | null,
    type?: string,
  ): Promise<string | null> {
    if (!supplied?.trim()) return null;
    const code = supplied.trim().toUpperCase();
    if (code === current) return null;
    return this.manualCode(master, code, tenantId, companyId, type);
  }

  /**
   * Locks the series row (SELECT ... FOR UPDATE) without incrementing it.
   * For callers whose sequence number isn't the row's own current_seq — e.g.
   * hierarchical location codes, which count siblings under a specific
   * parent rather than a company-wide counter — this gives the same
   * concurrency guard generateNext() gives (two concurrent creates of the
   * same series serialize on this row) while leaving current_seq /
   * last_generated_code untouched. Pass `executor` (a transaction handle)
   * so the lock is held until the caller's insert commits.
   */
  async lockSeries(
    seriesCode: string,
    tenantId: string,
    companyId?: string | null,
    executor: MySql2Database<typeof schema> = this.db,
  ): Promise<typeof schema.noSeries.$inferSelect> {
    const conditions = [
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.code, seriesCode),
      isNull(schema.noSeries.deleted_at),
    ];
    conditions.push(
      companyCondition(schema.noSeries.company_id, companyId)
    );

    const [series] = await executor
      .select()
      .from(schema.noSeries)
      .where(and(...conditions))
      .orderBy(sql`${schema.noSeries.company_id} IS NULL`)
      .limit(1)
      .for('update');

    if (!series) {
      throw new NotFoundException(`Number series '${seriesCode}' not found for this tenant/company scope.`);
    }
    if (series.blocked) {
      throw new BadRequestException(`Number series '${seriesCode}' is inactive.`);
    }
    return series;
  }

  /**
   * Number Series screen / CreateNumberSeriesDto response shape, kept stable
   * across the no_series_master -> no_series merge so this class's public
   * contract (and every caller of it) never had to change: series_id/
   * series_code/series_name/allow_manual/is_active read as they always did,
   * backed by the merged table's id/code/description/manual_nos/blocked.
   */
  private toSeriesShape(row: typeof schema.noSeries.$inferSelect) {
    return {
      series_id: row.id,
      tenant_id: row.tenant_id,
      company_id: row.company_id,
      nob_id: row.nob_id,
      lob_id: row.lob_id,
      series_code: row.code,
      series_name: row.description,
      document_type: row.document_type,
      prefix: row.prefix,
      separator: row.separator,
      seq_length: row.seq_length,
      current_seq: row.current_seq,
      last_generated_code: row.last_no_used,
      reset_frequency: row.reset_frequency,
      code_segments: row.code_segments,
      prefix_position: row.prefix_position,
      seq_separator: row.seq_separator,
      allow_manual: row.manual_nos,
      is_active: !row.blocked,
      created_by: row.created_by,
      updated_by: row.updated_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
      deleted_at: row.deleted_at,
      extension_config: row.extension_config,
    };
  }

  async create(dto: CreateNumberSeriesDto, tenantId: string, userPayload?: any) {
    const conflict = separatorConflict(dto.code_segments ?? [], dto.separator ?? null, dto.seq_separator ?? null, dto.seq_length);
    if (conflict) throw new BadRequestException(conflict);
    const duplicateConditions = [
      eq(schema.noSeries.tenant_id, tenantId),
      eq(schema.noSeries.code, dto.series_code.toUpperCase()),
      isNull(schema.noSeries.deleted_at),
    ];
    duplicateConditions.push(
      dto.company_id ? eq(schema.noSeries.company_id, dto.company_id) : isNull(schema.noSeries.company_id)
    );

    const existing = await this.db.select().from(schema.noSeries).where(and(...duplicateConditions)).limit(1);
    if (existing.length > 0) {
      throw new ConflictException(`Number series '${dto.series_code}' already exists in this scope.`);
    }

    // NOB/LOB are no longer asked on the form — derive them from the company's
    // operational areas (an explicit dto value, if a caller still sends one,
    // wins). no_series.nob_id/lob_id are nullable, so an ambiguous
    // company simply stores null rather than blocking the create.
    const resolvedNobLob = await this.nobLobResolution.resolve(tenantId, dto.company_id, {
      nob_id: dto.nob_id,
      lob_id: dto.lob_id,
    });

    const seriesId = randomUUID();
    const newSeries = {
      id: seriesId,
      tenant_id: tenantId,
      company_id: dto.company_id || null,
      nob_id: resolvedNobLob.nob_id,
      lob_id: resolvedNobLob.lob_id,
      code: dto.series_code.toUpperCase(),
      description: dto.series_name,
      document_type: dto.document_type,
      prefix: dto.prefix || null,
      separator: dto.separator || '-',
      seq_length: dto.seq_length,
      current_seq: 0,
      last_no_used: null,
      reset_frequency: dto.reset_frequency || 'NEVER',
      manual_nos: dto.allow_manual ?? false,
      code_segments: dto.code_segments?.length ? dto.code_segments : null,
      prefix_position: dto.prefix_position || 'END',
      seq_separator: dto.seq_separator || null,
      blocked: false,
      created_by: userPayload?.userId || null,
      updated_by: userPayload?.userId || null,
    };

    await this.db.insert(schema.noSeries).values(newSeries);

    await this.auditService.log({
      tenantId,
      companyId: dto.company_id || undefined,
      userId: userPayload?.userId,
      action: 'CREATE',
      entityName: 'no_series',
      entityId: seriesId,
      newValues: newSeries,
    });

    return this.findOne(seriesId);
  }

  async findOne(id: string) {
    const [series] = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(eq(schema.noSeries.id, id), isNull(schema.noSeries.deleted_at)))
      .limit(1);

    if (!series) {
      throw new NotFoundException(`Number series with ID '${id}' not found.`);
    }
    return this.toSeriesShape(series);
  }

  async findAll(query: QueryNumberSeriesDto, tenantId: string) {
    // No isNull(deleted_at) filter — list view shows both Active/Inactive states (toggle switch) so a blocked row can be found again and restored.
    const conditions: any[] = [
      eq(schema.noSeries.tenant_id, tenantId),
    ];

    conditions.push(...masterScopeConditions(this.cls, schema.noSeries, query.companyId));
    if (query.documentType) conditions.push(eq(schema.noSeries.document_type, query.documentType));
    if (query.isActive !== undefined) conditions.push(eq(schema.noSeries.blocked, !query.isActive));
    if (query.search) {
      conditions.push(
        or(
          like(schema.noSeries.code, `%${query.search}%`),
          like(schema.noSeries.description, `%${query.search}%`)
        )
      );
    }

    conditions.push(...listFilterConditions(schema.noSeries, query.filter));

    const limit = query.limit || 50;
    const offset = query.offset || 0;

    const rows = await this.db.select().from(schema.noSeries).where(and(...conditions))
      .orderBy(listOrderBy(schema.noSeries, query, schema.noSeries.code))
      .limit(limit).offset(offset);

    return rows.map((row) => this.toSeriesShape(row));
  }

  async update(id: string, dto: UpdateNumberSeriesDto, tenantId: string, userPayload?: any) {
    const series = await this.findOne(id);

    // Checked against the row as it will be, not as it is: changing one
    // separator alone is how the pair ends up unreadable.
    const nextSegments = (dto.code_segments ?? series.code_segments ?? []) as string[];
    const conflict = separatorConflict(
      Array.isArray(nextSegments) ? nextSegments : [],
      dto.separator ?? series.separator ?? null,
      dto.seq_separator !== undefined ? dto.seq_separator : (series.seq_separator ?? null),
      dto.seq_length ?? series.seq_length,
    );
    if (conflict) throw new BadRequestException(conflict);

    const updates: any = { updated_by: userPayload?.userId || null };
    if (dto.series_name !== undefined) updates.description = dto.series_name;
    if (dto.document_type !== undefined) updates.document_type = dto.document_type;
    if (dto.prefix !== undefined) updates.prefix = dto.prefix;
    if (dto.separator !== undefined) updates.separator = dto.separator;
    if (dto.seq_length !== undefined) updates.seq_length = dto.seq_length;
    if (dto.reset_frequency !== undefined) updates.reset_frequency = dto.reset_frequency;
    if (dto.allow_manual !== undefined) updates.manual_nos = dto.allow_manual;
    if (dto.code_segments !== undefined) updates.code_segments = dto.code_segments?.length ? dto.code_segments : null;
    if (dto.prefix_position !== undefined) updates.prefix_position = dto.prefix_position || 'END';
    if (dto.seq_separator !== undefined) updates.seq_separator = dto.seq_separator || null;
    if (dto.is_active !== undefined) updates.blocked = !dto.is_active;

    await this.db.update(schema.noSeries).set(updates).where(eq(schema.noSeries.id, id));

    await this.auditService.log({
      tenantId,
      companyId: series.company_id || undefined,
      userId: userPayload?.userId,
      action: 'UPDATE',
      entityName: 'no_series',
      entityId: id,
      oldValues: series,
      newValues: updates,
    });

    return this.findOne(id);
  }

  async remove(id: string, tenantId: string, userPayload?: any) {
    const series = await this.findOne(id);

    await this.db
      .update(schema.noSeries)
      .set({ blocked: true, deleted_at: toMysqlTimestamp() as any, updated_by: userPayload?.userId || null })
      .where(eq(schema.noSeries.id, id));

    await this.auditService.log({
      tenantId,
      companyId: series.company_id || undefined,
      userId: userPayload?.userId,
      action: 'DELETE',
      entityName: 'no_series',
      entityId: id,
      oldValues: series,
    });

    return { success: true, message: `Number series '${series.series_code}' has been deactivated.` };
  }

  // ---------------------------------------------------------------------
  // Ported from NoSeriesService (master-data/no-series), which this class
  // absorbs — the id-keyed engine item.service.ts, item-template.service.ts,
  // inventory-setup.service.ts and NoSeriesController (kept as a thin alias,
  // see no-series.module.ts) use directly against no_series.id, distinct
  // from the series_code-keyed engine above.
  // ---------------------------------------------------------------------

  async createNoSeriesRow(dto: CreateNoSeriesDto, tenantId?: string, companyId?: string | null) {
    if (dto.code && dto.code.length > 20) {
      throw new BadRequestException('Series Code cannot exceed 20 characters.');
    }
    if (dto.description && dto.description.length > 100) {
      throw new BadRequestException('Description cannot exceed 100 characters.');
    }
    if (dto.no_series_code && dto.no_series_code.length > 20) {
      throw new BadRequestException('Prefix / Pattern cannot exceed 20 characters.');
    }
    if (dto.last_no_used && dto.last_no_used.length > 20) {
      throw new BadRequestException('Last No. Used cannot exceed 20 characters.');
    }
    if (dto.seq_length !== undefined && (dto.seq_length < 1 || dto.seq_length > 10)) {
      throw new BadRequestException('Sequence Length must be between 1 and 10 digits.');
    }
    if (dto.increment_by !== undefined && dto.increment_by < 1) {
      throw new BadRequestException('Increment By must be at least 1.');
    }

    const existing = await this.db
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.code, dto.code))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`No. Series with code '${dto.code}' already exists.`);
    }

    const id = randomUUID();
    const isDefault = dto.is_default ?? true;
    const documentType = dto.document_type || null;

    // If setting this series as default, automatically uncheck is_default on any existing series for the same master type
    if (isDefault && documentType) {
      await this.db
        .update(schema.noSeries)
        .set({
          is_default: false,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(and(
          eq(schema.noSeries.document_type, documentType),
          eq(schema.noSeries.is_default, true),
        ));
    }

    const newRecord = {
      id,
      tenant_id: tenantId || null,
      company_id: dto.company_id || companyId || null,
      code: dto.code,
      description: dto.description || null,
      document_type: documentType,
      no_series_code: dto.no_series_code || null,
      seq_length: dto.seq_length ?? 4,
      increment_by: dto.increment_by ?? 1,
      is_default: isDefault,
      manual_nos: dto.manual_nos ?? false,
      last_no_used: dto.last_no_used || null,
      blocked: dto.blocked ?? false,
      created_at: toMysqlTimestamp(),
      updated_at: toMysqlTimestamp(),
    };

    await this.db.insert(schema.noSeries).values(newRecord);
    return this.findOneById(id);
  }

  async findOneById(id: string, executor?: MySql2Database<typeof schema>) {
    const client = executor || this.db;
    const [record] = await client
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.id, id))
      .limit(1);

    if (!record) {
      throw new NotFoundException(`No. Series with ID '${id}' not found.`);
    }
    return this.withActive(record);
  }

  /**
   * `search` matches the master-data screen's generic search box. Also scopes
   * by tenant (strictly — every row here carries a real tenant_id) and
   * company (permissively — a NULL company_id is a tenant-wide shared
   * series, same convention masterScopeConditions uses).
   */
  async findAllModern(
    documentType?: string,
    tenantId?: string,
    companyId?: string | null,
    search?: string,
    filter?: Record<string, any>,
    query?: any,
  ) {
    const conditions: any[] = [];
    if (documentType) conditions.push(eq(schema.noSeries.document_type, documentType.toUpperCase().replaceAll('-', '_')));
    if (tenantId) conditions.push(eq(schema.noSeries.tenant_id, tenantId));
    if (companyId) conditions.push(or(eq(schema.noSeries.company_id, companyId), isNull(schema.noSeries.company_id)));
    if (search) {
      const s = `%${search.trim()}%`;
      conditions.push(or(
        like(schema.noSeries.code, s),
        like(schema.noSeries.description, s),
        like(schema.noSeries.no_series_code, s),
        like(schema.noSeries.document_type, s),
      ));
    }
    if (filter) {
      conditions.push(...listFilterConditions(schema.noSeries, filter));
    }
    const limit = query?.limit ? Math.max(1, Number(query.limit)) : 100;
    const offset = query?.offset ? Math.max(0, Number(query.offset)) : 0;
    const orderBy = listOrderBy(schema.noSeries, query, schema.noSeries.created_at);

    const rows = conditions.length
      ? await this.db.select().from(schema.noSeries).where(and(...conditions)).orderBy(orderBy).limit(limit).offset(offset)
      : await this.db.select().from(schema.noSeries).orderBy(orderBy).limit(limit).offset(offset);

    const [counted] = conditions.length
      ? await this.db.select({ total: count() }).from(schema.noSeries).where(and(...conditions))
      : await this.db.select({ total: count() }).from(schema.noSeries);

    return {
      data: rows.map((row) => this.withActive(row)),
      total: Number(counted?.total ?? rows.length),
    };
  }

  /**
   * Returns all No. Series for the company, grouped by document_type.
   * Used by the Inventory Setup screen so the user can see, per master type,
   * which series exist and which one is currently the default.
   */
  async byMaster(tenantId: string, companyId?: string | null) {
    const conditions = [eq(schema.noSeries.tenant_id, tenantId)];
    if (companyId) conditions.push(eq(schema.noSeries.company_id, companyId));
    const rows = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(...conditions))
      .orderBy(schema.noSeries.document_type, schema.noSeries.code);

    // Group by document_type
    const grouped: Record<string, typeof rows> = {};
    for (const row of rows) {
      const key = row.document_type || 'OTHER';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(row);
    }
    return grouped;
  }

  /**
   * Sets the given No. Series as the default for its document_type, atomically
   * unsetting the old default in the same transaction.
   */
  async setDefaultSeries(id: string, tenantId: string, companyId?: string | null) {
    const [series] = await this.db
      .select()
      .from(schema.noSeries)
      .where(eq(schema.noSeries.id, id))
      .limit(1);
    if (!series) throw new NotFoundException(`No. Series '${id}' not found.`);
    if (!series.document_type) throw new BadRequestException('This series has no document type set.');

    const conditions = [
      eq(schema.noSeries.document_type, series.document_type),
      eq(schema.noSeries.is_default, true),
    ];
    if (tenantId) conditions.push(eq(schema.noSeries.tenant_id, tenantId));
    // Unset current default
    await this.db
      .update(schema.noSeries)
      .set({ is_default: false, updated_at: toMysqlTimestamp() as any })
      .where(and(...conditions));
    // Set new default
    await this.db
      .update(schema.noSeries)
      .set({ is_default: true, updated_at: toMysqlTimestamp() as any })
      .where(eq(schema.noSeries.id, id));
    return { success: true, id };
  }

  /**
   * Internal utility: Atomically generates and reserves the next number from a No. Series
   * using a database transaction and row-level locking (SELECT ... FOR UPDATE).
   *
   * Holds lock strictly for:
   * read last_no_used -> calculate -> update -> return
   *
   * If lock acquisition exceeds 5 seconds, returns HTTP 503:
   * "Item code generation busy, please retry."
   */
  async generateNextNumberById(
    id: string,
    tenantId?: string,
    companyId?: string | null,
    externalTx?: any,
  ): Promise<{ next_number: string; series: typeof schema.noSeries.$inferSelect }> {
    const executeInTx = async (tx: MySql2Database<typeof schema>) => {
      try {
        // Set lock wait timeout to 5 seconds per Section 6 & 8 of TDD
        await tx.execute(sql`SET innodb_lock_wait_timeout = 5`);
      } catch {
        // Ignore if unsupported or running under mock DB in tests
      }

      let seriesRows: Array<typeof schema.noSeries.$inferSelect>;
      try {
        seriesRows = await tx
          .select()
          .from(schema.noSeries)
          .where(eq(schema.noSeries.id, id))
          .limit(1)
          .for('update');
      } catch (err: any) {
        // Check for MySQL lock wait timeout (code 1205 / ER_LOCK_WAIT_TIMEOUT)
        if (err?.code === 'ER_LOCK_WAIT_TIMEOUT' || err?.errno === 1205 || String(err?.message || '').includes('Lock wait timeout')) {
          throw new HttpException('Item code generation busy, please retry.', HttpStatus.SERVICE_UNAVAILABLE);
        }
        throw err;
      }

      const series = seriesRows[0];
      if (!series) {
        throw new NotFoundException(`No. Series with ID '${id}' not found.`);
      }

      if (series.blocked) {
        throw new BadRequestException(`No. Series [${series.code}] is blocked. Cannot generate item number.`);
      }

      const increment = series.increment_by || 1;
      const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
      const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
      let nextCode: string;

      if (series.last_no_used) {
        const match = series.last_no_used.match(/(\d+)$/);
        if (match) {
          const numStr = match[1];
          const nextVal = parseInt(numStr, 10) + increment;
          nextCode = `${prefix}${String(nextVal).padStart(padDigits, '0')}`;
        } else {
          nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
        }
      } else {
        nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
      }

      await tx
        .update(schema.noSeries)
        .set({
          last_no_used: nextCode,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(eq(schema.noSeries.id, id));

      return {
        next_number: nextCode,
        series: { ...series, last_no_used: nextCode },
      };
    };

    if (externalTx) {
      return executeInTx(externalTx);
    }

    try {
      return await this.db.transaction(async (tx) => {
        return executeInTx(tx as any);
      });
    } catch (err: any) {
      if (err?.code === 'ER_LOCK_WAIT_TIMEOUT' || err?.errno === 1205 || String(err?.message || '').includes('Lock wait timeout')) {
        throw new HttpException('Item code generation busy, please retry.', HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw err;
    }
  }

  /**
   * Previews the next number without updating last_no_used.
   */
  async previewNextNumberById(id: string): Promise<{ next_number: string; series: typeof schema.noSeries.$inferSelect }> {
    const series = await this.findOneById(id);
    if (series.blocked) {
      throw new BadRequestException(`No. Series [${series.code}] is blocked. Cannot generate item number.`);
    }

    const increment = series.increment_by || 1;
    const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
    const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
    let nextCode: string;

    if (series.last_no_used) {
      const match = series.last_no_used.match(/(\d+)$/);
      if (match) {
        const numStr = match[1];
        const nextVal = parseInt(numStr, 10) + increment;
        nextCode = `${prefix}${String(nextVal).padStart(padDigits, '0')}`;
      } else {
        nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
      }
    } else {
      nextCode = `${prefix}${String(increment).padStart(padDigits, '0')}`;
    }

    return {
      next_number: nextCode,
      series,
    };
  }

  /**
   * Finds the default active No. Series for a given Master Type (e.g. SUPPLIER, CUSTOMER, ITEM),
   * respecting company-level Inventory Setup configuration and optional master type subtype.
   */
  async findDefaultSeriesByMaster(masterType: string, tenantId?: string, companyId?: string | null, type?: string | null) {
    const normalizedType = masterType.toUpperCase().replaceAll('-', '_');
    const normalizedSubType = type ? type.toUpperCase().replaceAll('-', '_') : null;

    // Self-coded masters (see SELF_CODED_MASTERS) are not resolved from this
    // table's generic rows — defer to the type-aware previewCode() path.
    if (SELF_CODED_MASTERS.has(normalizedType)) {
      return null;
    }

    // 0. If a subtype is passed, check if a specific series exists for it (e.g. NS-FEED, NS-MED, ITEM_FEED)
    if (normalizedSubType) {
      const subConditions = [
        or(
          eq(schema.noSeries.code, `NS-${normalizedSubType}`),
          eq(schema.noSeries.code, normalizedSubType),
          eq(schema.noSeries.code, `${normalizedType}_${normalizedSubType}`),
          eq(schema.noSeries.code, `${normalizedType}-${normalizedSubType}`),
        ),
        eq(schema.noSeries.blocked, false),
      ];
      if (tenantId) subConditions.push(eq(schema.noSeries.tenant_id, tenantId));
      if (companyId) {
        subConditions.push(or(
          eq(schema.noSeries.company_id, companyId),
          sql`${schema.noSeries.company_id} IS NULL`,
        )!);
      }
      const [typeSeries] = await this.db
        .select()
        .from(schema.noSeries)
        .where(and(...subConditions))
        .orderBy(sql`${schema.noSeries.is_default} DESC, ${schema.noSeries.created_at} ASC`)
        .limit(1);

      if (typeSeries) return typeSeries;
    }

    // 1. Check if Company-specific Inventory Setup defines whether this master has number series applied
    if (tenantId && companyId) {
      try {
        const [setup] = await this.db
          .select()
          .from(schema.inventorySetup)
          .where(and(
            eq(schema.inventorySetup.tenant_id, tenantId),
            eq(schema.inventorySetup.company_id, companyId),
          ))
          .limit(1);

        if (setup?.numbering_config) {
          const config = setup.numbering_config as Record<string, { enabled?: boolean; default_series_id?: string | null }>;
          const masterCfg = config[normalizedType];
          if (masterCfg) {
            // Explicitly disabled in company inventory setup: do not generate
            if (masterCfg.enabled === false) {
              return null;
            }
            // Explicit default series pinned in company inventory setup. Only
            // honoured while that series still identifies as the default
            // (is_default = true) — the Number Series screen's "Is Default"
            // checkbox is the only control a user actually sees, and it edits
            // is_default there, never this JSON pin. Without this check, an
            // admin who changes the default on that screen (which correctly
            // flips is_default on every series for the master, this one
            // included) sees no effect at all: this pin, set once and never
            // touched again, would keep silently overriding their choice
            // forever. Once the pinned series is no longer flagged default,
            // treat the pin as stale and fall through to the ordinary lookup.
            if (masterCfg.default_series_id) {
              const [explicitSeries] = await this.db
                .select()
                .from(schema.noSeries)
                .where(and(
                  eq(schema.noSeries.id, masterCfg.default_series_id),
                  eq(schema.noSeries.blocked, false),
                  eq(schema.noSeries.is_default, true),
                ))
                .limit(1);
              if (explicitSeries) return explicitSeries;
            }
          }
        }
      } catch {
        // Fallback to direct query below if inventory_setup check fails or is not populated yet
      }
    }

    // 2. Standard fallback query: matching document_type or code, ordered by is_default DESC.
    // A bare document_type match must exclude subtype-template series (seeded
    // for ITEM as NS-VAC, NS-FEED, NS-MED, NS-RAW, NS-LVS, one per Item Type) —
    // those exist to be picked ONLY by the subtype match in step 0 above.
    // Left in this pool, an unmanaged is_default flag on one of those templates
    // can outrank the real generic default on the created_at tie-break, so
    // creating an Item with no Item Type selected yet (the form's initial
    // state) silently generates a code from whichever template happened to be
    // marked default first — not from the series an admin just set as default
    // for the master as a whole.
    const conditions = [
      or(
        and(
          eq(schema.noSeries.document_type, normalizedType),
          not(like(schema.noSeries.code, 'NS-%')),
        )!,
        eq(schema.noSeries.code, normalizedType),
        eq(schema.noSeries.code, `NS-${normalizedType}`),
      ),
      eq(schema.noSeries.blocked, false),
    ];
    if (tenantId) conditions.push(eq(schema.noSeries.tenant_id, tenantId));
    if (companyId) {
      conditions.push(or(
        eq(schema.noSeries.company_id, companyId),
        sql`${schema.noSeries.company_id} IS NULL`,
      )!);
    }

    const rows = await this.db
      .select()
      .from(schema.noSeries)
      .where(and(...conditions))
      .orderBy(sql`${schema.noSeries.is_default} DESC, ${schema.noSeries.created_at} ASC`);

    return rows[0] || null;
  }

  /**
   * Previews the next code by Master Type directly.
   */
  async previewByMaster(masterType: string, tenantId?: string, companyId?: string | null, type?: string | null) {
    const series = await this.findDefaultSeriesByMaster(masterType, tenantId, companyId, type);
    if (!series) {
      return {
        generated: false,
        allowManual: true,
        preview: '',
        message: `No active Number Series found for '${masterType}'.`,
      };
    }
    const previewRes = await this.previewNextNumberById(series.id);
    return {
      generated: true,
      series_id: series.id,
      series_code: series.code,
      prefix: series.no_series_code,
      seq_length: series.seq_length,
      preview: previewRes.next_number,
      next_number: previewRes.next_number,
      allowManual: series.manual_nos,
      manual_nos: series.manual_nos,
    };
  }

  /**
   * Records a number as used in the No. Series when an item is actually saved/created.
   */
  async recordNumberUsedById(id: string, usedNumber: string): Promise<void> {
    if (!usedNumber) return;
    const series = await this.findOneById(id);
    if (!series) return;

    let formattedNumber = usedNumber;
    const prefix = series.no_series_code ?? (series.code ? `${series.code}-` : '');
    const padDigits = series.seq_length && series.seq_length > 0 ? series.seq_length : 4;
    const match = usedNumber.match(/(\d+)$/);
    if (match && prefix) {
      const numVal = parseInt(match[1], 10);
      formattedNumber = `${prefix}${String(numVal).padStart(padDigits, '0')}`;
    }

    await this.db
      .update(schema.noSeries)
      .set({
        last_no_used: formattedNumber,
        updated_at: toMysqlTimestamp() as any,
      })
      .where(eq(schema.noSeries.id, id));
  }

  async updateNoSeriesRow(id: string, dto: UpdateNoSeriesDto) {
    const existing = await this.findOneById(id);

    if (dto.description && dto.description.length > 100) {
      throw new BadRequestException('Description cannot exceed 100 characters.');
    }
    if (dto.no_series_code && dto.no_series_code.length > 20) {
      throw new BadRequestException('Prefix / Pattern cannot exceed 20 characters.');
    }
    if (dto.last_no_used && dto.last_no_used.length > 20) {
      throw new BadRequestException('Last No. Used cannot exceed 20 characters.');
    }
    if (dto.seq_length !== undefined && (dto.seq_length < 1 || dto.seq_length > 10)) {
      throw new BadRequestException('Sequence Length must be between 1 and 10 digits.');
    }
    if (dto.increment_by !== undefined && dto.increment_by < 1) {
      throw new BadRequestException('Increment By must be at least 1.');
    }

    const updates: Partial<typeof schema.noSeries.$inferInsert> = {
      updated_at: toMysqlTimestamp() as any,
    };

    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.document_type !== undefined) updates.document_type = dto.document_type;
    if (dto.no_series_code !== undefined) updates.no_series_code = dto.no_series_code;
    if (dto.seq_length !== undefined) updates.seq_length = dto.seq_length;
    if (dto.increment_by !== undefined) updates.increment_by = dto.increment_by;
    if (dto.is_default !== undefined) updates.is_default = dto.is_default;
    if (dto.manual_nos !== undefined) updates.manual_nos = dto.manual_nos;
    if (dto.last_no_used !== undefined) updates.last_no_used = dto.last_no_used;
    if (dto.blocked !== undefined) updates.blocked = dto.blocked;

    const targetDocType = updates.document_type ?? existing.document_type;
    // If setting this series as default, automatically uncheck is_default on any other series for the same master type
    if (updates.is_default === true && targetDocType) {
      await this.db
        .update(schema.noSeries)
        .set({
          is_default: false,
          updated_at: toMysqlTimestamp() as any,
        })
        .where(and(
          eq(schema.noSeries.document_type, targetDocType),
          ne(schema.noSeries.id, id),
          eq(schema.noSeries.is_default, true),
        ));
    }

    await this.db.update(schema.noSeries).set(updates).where(eq(schema.noSeries.id, id));
    return this.findOneById(id);
  }

  /**
   * Deactivates a series (sets Blocked, the field that already gates
   * generateNextNumberById()/findDefaultSeriesByMaster()) rather than
   * removing the row — matching the delete-really-means-deactivate
   * convention every other master-data table in this app follows, and
   * reversible via restoreById(). A hard delete here would also free its
   * `code` for reuse, which is never what deactivating a series is meant to do.
   */
  async softDeleteById(id: string) {
    await this.findOneById(id);
    await this.db
      .update(schema.noSeries)
      .set({ blocked: true, updated_at: toMysqlTimestamp() as any })
      .where(eq(schema.noSeries.id, id));
    return this.findOneById(id);
  }

  async restoreById(id: string) {
    await this.findOneById(id);
    await this.db
      .update(schema.noSeries)
      .set({ blocked: false, updated_at: toMysqlTimestamp() as any })
      .where(eq(schema.noSeries.id, id));
    return this.findOneById(id);
  }
}
