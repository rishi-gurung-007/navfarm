import { createHash } from 'node:crypto';

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

export function technicalRunCode(farmId: string, version: number): string {
  return `FFR-${farmId}-${String(version).padStart(6, '0')}`;
}

export interface ForecastRunLineSnapshot {
  forecastDate: string;
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
  requiredOnDate: string | null;
  provenanceSnapshot: unknown;
}

interface ForecastRunLineInput {
  date?: string;
  batchId?: string;
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
  recommendedQtyKg?: number;
  requiredOn?: string | null;
  provenance?: unknown;
  lifecycleId?: string;
  sourceType?: string;
  sourceCode?: string | null;
  perDayIntakeKg?: number;
  daysOfStock?: number | null;
  sharedBatchCount?: number;
  indicative?: boolean;
  refillDate?: string | null;
  overdue?: boolean;
}

type ValidatedForecastRunLineInput = ForecastRunLineInput & Required<Pick<ForecastRunLineInput,
  | 'date' | 'batchId' | 'itemId' | 'heads' | 'feedRateKg' | 'openingStockKg'
  | 'confirmedReceiptKg' | 'demandKg' | 'projectedClosingKg' | 'recommendedQtyKg'
>>;

export function buildRunLineSnapshots(output: { daily: ForecastRunLineInput[] }): ForecastRunLineSnapshot[] {
  const requiredText = ['date', 'batchId', 'itemId'] as const;
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
      batchId: validated.batchId,
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
      shortageDate: line.runDownDate ?? null,
      recommendedQtyKg: validated.recommendedQtyKg,
      requiredOnDate: line.requiredOn ?? null,
      provenanceSnapshot: detached(line.provenance ?? {
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
        refillDate: line.refillDate,
        overdue: line.overdue,
      }),
    };
  });
}
