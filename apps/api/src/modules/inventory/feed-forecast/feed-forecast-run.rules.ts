import { createHash } from 'node:crypto';
import type { BatchPk } from './feed-forecast.engine';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

function detached<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildConfigSnapshot<T>(settings: T) {
  const values = canonical(detached(settings)) as T;
  const hash = createHash('sha256').update(JSON.stringify(values)).digest('hex');
  return { version: `sha256:${hash}`, hash, values };
}

/** Exact detached calculation inputs, sufficient to rerun the pure engine. */
export function buildSourceSnapshot<T>(sources: T) {
  return buildConfigSnapshot(sources);
}

export function technicalRunCode(farmId: string, version: number): string {
  return `FFR-${farmId}-${String(version).padStart(6, '0')}`;
}

/** Engine §5 row 68: RUN-<FarmCode>-<YYYYMMDD>-<NNN>; this is the part up to the sequence. */
export function runCodePrefix(farmCode: string, date: string): string {
  return `RUN-${farmCode}-${date.slice(0, 10).replace(/-/g, '')}-`;
}

/**
 * Engine §5 row 68 ("RUN-GRS-20260923-001"): the run code is the farm code,
 * the date, and a three-digit number per farm per day. `existingCodes` are the
 * codes already saved for that prefix; the next number follows the highest.
 * Older FFR-<farm>-<version> codes never match a prefix and are left as they are.
 */
export function runCodeFor(farmCode: string, date: string, existingCodes: readonly string[]): string {
  const prefix = runCodePrefix(farmCode, date);
  let highest = 0;
  for (const code of existingCodes) {
    if (!code.startsWith(prefix)) continue;
    const tail = code.slice(prefix.length);
    if (/^\d{3,}$/.test(tail)) highest = Math.max(highest, Number(tail));
  }
  return `${prefix}${String(highest + 1).padStart(3, '0')}`;
}

export interface ForecastRunLineSnapshot {
  forecastDate: string;
  /** The genuine batch_header PK — never the engine's `<batch_id>:<stageId>` composite (D1, 3 Oct: ER_DATA_TOO_LONG). */
  batchId: string;
  shedId: string | null;
  destinationLocationId: string | null;
  requiredItemId: string;
  currentItemId: string | null;
  headCount: number;
  feedRateKg: number;
  openingStockKg: number;
  confirmedReceiptKg: number;
  dailyDemandKg: number;
  projectedClosingKg: number;
  shortageDate: string | null;
  recommendedQtyKg: number;
  provenanceSnapshot: unknown;
}

/**
 * Stable material-output contract for forecast run evidence.
 *
 * v1 hashed the canonical, order-independent multiset of every
 * ForecastRunLineSnapshot field. Database row IDs, creation timestamps and
 * run header identity are deliberately outside the material line type and
 * therefore outside the hash.
 *
 * v2 (Task 4, 3 Oct ruling): ForecastRunLineSnapshot dropped requiredOnDate —
 * refill buffer, lead time, required-on and overdue are superseded by the
 * 3 Oct rulings (engine.ts, Task 3). That changes the hashed contract's
 * shape, so the version bumps with it: a v1 saved run and a v2 one must never
 * compare equal just because their hashes happen to collide on a changed
 * field set. A pre-existing v1 run's staleness check (feed-requisition's
 * matchingRun) now answers null for it — detaching its provenance, correctly,
 * rather than silently matching a line shape it no longer produces.
 */
export const FORECAST_RUN_OUTPUT_HASH_VERSION = 'forecast-run-lines:v2';

export interface ForecastRunOutputSnapshot {
  version: typeof FORECAST_RUN_OUTPUT_HASH_VERSION;
  hash: string;
  lineCount: number;
}

export function buildOutputSnapshot(lines: ForecastRunLineSnapshot[]): ForecastRunOutputSnapshot {
  const material = lines
    .map((line) => canonical(detached(line)))
    .sort((left, right) => {
      const leftJson = JSON.stringify(left);
      const rightJson = JSON.stringify(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  const hash = createHash('sha256')
    .update(`${FORECAST_RUN_OUTPUT_HASH_VERSION}\n${JSON.stringify(material)}`)
    .digest('hex');
  return { version: FORECAST_RUN_OUTPUT_HASH_VERSION, hash, lineCount: material.length };
}

interface ForecastRunLineInput {
  date?: string;
  /** The engine's own composite aggregation key for an ANIMAL_WISE/REGISTERED batch — display/grouping only, never persisted. */
  batchId?: string;
  /** The genuine batch_header PK — this is what gets written to feed_forecast_run_line.batch_id (D1, 3 Oct). Branded: the composite `batchId` does not type-check here. */
  realBatchId?: BatchPk;
  batchNo?: string;
  shedId?: string;
  shedCode?: string;
  stageCode?: string;
  destinationLocationId?: string | null;
  itemId?: string;
  itemNo?: string;
  itemName?: string;
  currentItemId?: string | null;
  heads?: number;
  feedRateKg?: number;
  openingStockKg?: number;
  confirmedReceiptKg?: number;
  demandKg?: number;
  projectedClosingKg?: number;
  runDownDate?: string | null;
  shortageDate?: string | null;
  recommendedQtyKg?: number;
  provenance?: unknown;
  lifecycleId?: string;
  sourceType?: string;
  sourceCode?: string | null;
  perDayIntakeKg?: number;
  daysOfStock?: number | null;
  sharedBatchCount?: number;
  indicative?: boolean;
}

type ValidatedForecastRunLineInput = ForecastRunLineInput & Required<Pick<ForecastRunLineInput,
  | 'date' | 'realBatchId' | 'itemId' | 'heads' | 'feedRateKg' | 'openingStockKg'
  | 'confirmedReceiptKg' | 'demandKg' | 'projectedClosingKg' | 'recommendedQtyKg'
>>;

export function buildRunLineSnapshots(output: { daily: ForecastRunLineInput[] }): ForecastRunLineSnapshot[] {
  // D1 (3 Oct): validate realBatchId, the genuine batch_header PK — never the engine's composite `batchId`
  // (display/grouping key only), which is a `<batch_id>:<stageId>` string for an ANIMAL_WISE/REGISTERED batch
  // and is never a valid batch_header PK at any column width.
  const requiredText = ['date', 'realBatchId', 'itemId'] as const;
  const requiredNumbers = [
    'heads', 'feedRateKg', 'openingStockKg', 'confirmedReceiptKg', 'demandKg',
    'projectedClosingKg', 'recommendedQtyKg',
  ] as const;

  return output.daily.map((line, index) => {
    for (const key of requiredText) {
      if (typeof line[key] !== 'string' || line[key].length === 0) {
        throw new Error(`Forecast run line ${index + 1} is missing ${key}.`);
      }
    }
    for (const key of requiredNumbers) {
      if (typeof line[key] !== 'number' || !Number.isFinite(line[key])) {
        throw new Error(`Forecast run line ${index + 1} is missing ${key}.`);
      }
    }
    // The checks above are deliberately data-driven; make their resulting
    // type explicit because TypeScript cannot narrow several indexed fields
    // on the containing object across those loops.
    const validated = line as ValidatedForecastRunLineInput;

    return {
      forecastDate: validated.date,
      batchId: validated.realBatchId,
      shedId: line.shedId ?? null,
      destinationLocationId: line.destinationLocationId ?? null,
      requiredItemId: validated.itemId,
      currentItemId: line.currentItemId ?? null,
      headCount: validated.heads,
      feedRateKg: validated.feedRateKg,
      openingStockKg: validated.openingStockKg,
      confirmedReceiptKg: validated.confirmedReceiptKg,
      dailyDemandKg: validated.demandKg,
      projectedClosingKg: validated.projectedClosingKg,
      shortageDate: line.shortageDate ?? null,
      recommendedQtyKg: validated.recommendedQtyKg,
      provenanceSnapshot: {
        ...(line.provenance && typeof line.provenance === 'object' && !Array.isArray(line.provenance)
          ? detached(line.provenance) as Record<string, unknown>
          : detached({
        batchNo: line.batchNo,
        shedCode: line.shedCode,
        stageCode: line.stageCode,
        itemNo: line.itemNo,
        itemName: line.itemName,
        lifecycleId: line.lifecycleId,
        sourceType: line.sourceType,
        sourceCode: line.sourceCode,
        perDayIntakeKg: line.perDayIntakeKg,
        daysOfStock: line.daysOfStock,
        sharedBatchCount: line.sharedBatchCount,
        indicative: line.indicative,
          })),
        runDownDate: line.runDownDate ?? null,
      },
    };
  });
}
