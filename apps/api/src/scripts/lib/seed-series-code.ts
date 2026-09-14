import { and, eq, isNull, or, sql } from 'drizzle-orm';
import * as schema from '../../core/database/schema';
import {
  formatSeriesCode,
  formatSeriesStem,
  nextSequenceInStem,
  nextSequence,
  segmentFields,
} from '../../modules/system/number-series/code-format.util';

/**
 * The code a number series would issue for a record the seed is about to
 * insert — the same formatter the API uses, so seeded codes and codes typed
 * into the app come out identical.
 *
 * The seeds used to invent codes the series could never have produced
 * (CAT-RAW-GRAINS against a series that composes the category's own name), so
 * a demo database looked as though the series had issued them when nothing had.
 *
 * `occupied` is the codes already present in the same scope. For a series with
 * segments the number counts within its stem — the first pen of shed 2 is
 * <shed 2>/PEN-001 even when shed 1 has three — and for a series with none it
 * comes off the row's own counter. A named series (seq_length 0) ignores the
 * number entirely; its code IS the composed stem.
 *
 * Returns null if the series is missing or inactive, which is the caller's cue
 * to fall back to whatever it did before rather than fail the whole seed.
 */
export async function seriesCodeFor(
  db: any,
  ctx: { tenantId: string; companyId?: string | null },
  seriesCode: string,
  record: Record<string, unknown>,
  occupied: Iterable<string> = [],
): Promise<string | null> {
  // Prefer the company's own series over the tenant draft.
  //
  // Once a company adopts the tenant templates there are two rows per series —
  // the draft (company_id NULL) and the company's copy — and the company's is
  // the one actually in use. Without the ordering this picked whichever the
  // engine returned first and advanced that row's counter, so a code could come
  // off the draft while the app read the company's.
  // Mirrors NumberSeriesService.generateNext's `ORDER BY company_id IS NULL`.
  const [series] = await db
    .select()
    .from(schema.noSeriesMaster)
    .where(
      and(
        eq(schema.noSeriesMaster.tenant_id, ctx.tenantId),
        eq(schema.noSeriesMaster.series_code, seriesCode),
        eq(schema.noSeriesMaster.is_active, true),
        isNull(schema.noSeriesMaster.deleted_at),
        ctx.companyId
          ? or(eq(schema.noSeriesMaster.company_id, ctx.companyId), isNull(schema.noSeriesMaster.company_id))
          : isNull(schema.noSeriesMaster.company_id),
      ),
    )
    .orderBy(sql`${schema.noSeriesMaster.company_id} IS NULL`)
    .limit(1);

  if (!series) return null;

  const now = new Date();
  const stem = formatSeriesStem(series, now, record);

  // A UUID never belongs in a code. NumberSeriesService resolves reference
  // fields (category_id, parent_location_id, breed_id...) to the referenced
  // row's own code before composing; this helper does not carry that registry,
  // so the caller must pass the code. Caught the hard way: the item seed passed
  // `category_id` straight through and produced
  // FEED-54424D87-96DA-442A-8669-DDD153069999-ITM-0001.
  const uuidSegment = Object.entries(record).find(
    ([, v]) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
  if (uuidSegment) {
    throw new Error(
      `Series '${seriesCode}' was given a UUID for segment '${uuidSegment[0]}'. ` +
      `Pass the referenced record's own code instead — a UUID in a business code is never intended.`,
    );
  }

  // A named series (no sequence) whose stem came out empty means `record` did
  // not carry the fields the series names — and formatSeriesCode would then
  // fall through to the bare sequence and hand back "1". That is not a code,
  // and the second row gets "1" too and collides on the scope-code unique key.
  //
  // Caught exactly this way: the item-category seed passed its own {key, name}
  // shape to a series configured on `category_name`, and every category came
  // out as "1". A seed writing identities has to fail loudly here rather than
  // invent one or quietly fall back to a hand-written code the series never
  // produced.
  if (series.seq_length <= 0 && !stem) {
    throw new Error(
      `Series '${seriesCode}' composes its code from ${JSON.stringify(segmentFields(series))}, ` +
      `but the record passed to seriesCodeFor() has none of those fields (got ${JSON.stringify(Object.keys(record))}). ` +
      `Pass the record keyed by the field names the series names.`,
    );
  }

  const sequence = stem
    ? nextSequenceInStem(stem, series.seq_separator || series.separator || '-', occupied)
    : nextSequence(series, now);

  const code = formatSeriesCode(series, sequence, now, record);

  // Advance the counter exactly as NumberSeriesService.generateNext() does.
  //
  // Without this every caller re-reads current_seq = 0 and composes the same
  // code: all four suppliers come out SUP-001 and the second insert dies on the
  // scope-code unique key. `occupied` alone would carry a single seeding run,
  // but the series row would still read "never issued a code" afterwards, which
  // is exactly the state this whole exercise started from.
  if (series.seq_length > 0) {
    await db
      .update(schema.noSeriesMaster)
      .set({ current_seq: sequence, last_generated_code: code })
      .where(eq(schema.noSeriesMaster.series_id, series.series_id));
  }

  return code;
}

/**
 * seriesCodeFor() with the bookkeeping every caller was repeating: read the
 * codes already taken in this scope, generate, and fall back to the seed's own
 * key if the master has no active series (GL_ACCOUNT and COST_CENTER are
 * deliberately inactive, and a tenant seeded before the series existed has
 * none at all).
 *
 * `record` only matters for a series with segments — a named series composes
 * from it, a flat SUP-001 series ignores it entirely.
 */
export async function seedCode(
  db: any,
  tenantId: string,
  companyId: string | null,
  seriesCode: string,
  table: any,
  codeColumn: any,
  fallback: string,
  record: Record<string, unknown> = {},
): Promise<string> {
  const rows = await db.select({ code: codeColumn }).from(table).where(
    companyId
      ? and(eq(table.tenant_id, tenantId), eq(table.company_id, companyId))
      : and(eq(table.tenant_id, tenantId), isNull(table.company_id)),
  );
  const occupied = rows.map((r: { code: string | null }) => r.code).filter(Boolean) as string[];
  return (await seriesCodeFor(db, { tenantId, companyId }, seriesCode, record, occupied)) ?? fallback;
}
