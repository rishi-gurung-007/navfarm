import { BadRequestException, ForbiddenException } from '@nestjs/common';

/**
 * Monthly Stock Take and Period Close rules (Brief C; workbook "Silo Balance and
 * Stock Take" s3 r30-49; "Checkpoints and Validations" r31, r32, r40).
 * Variance, reason and approval routing are NOT restated here: a monthly take is
 * a feed_stock_count row with count_type MONTHLY, so it reuses varianceFact,
 * assertVarianceReason and approvalRoute from feed-stock-count.rules.ts.
 */
export type CountType = 'WEEKLY' | 'MONTHLY';
export type StockTakeType = 'FARM' | 'FEED_MILL';

/** r30: ST-FarmCode-YYYY-NNNNN for a farm, ST-MILL-YYYY-NNNNN for the feed mill. */
export function stockTakeNo(type: StockTakeType, farmCode: string, year: number, seq: number): string {
  const middle = type === 'FEED_MILL' ? 'MILL' : farmCode;
  if (!middle) throw new BadRequestException('A farm stock take needs the farm code for its number.');
  return `ST-${middle}-${year}-${String(seq).padStart(5, '0')}`;
}

export interface StockTakePeriod {
  period_id: string;
  period_code: string;
  stock_take_date: string;
  end_date?: string | null;
  period_status: string;
  is_active?: boolean;
  deleted_at?: string | null;
}

/** r40: refused when the period does not exist; a closed period cannot take a new count. */
export function assertStockTakePeriod(period: StockTakePeriod | null | undefined): StockTakePeriod {
  if (!period || period.deleted_at) {
    throw new BadRequestException('The reporting period does not exist. Define it in the Reporting Period Master before taking stock.');
  }
  if (period.period_status === 'CLOSED') {
    throw new BadRequestException(`Reporting period ${period.period_code} is closed; reopen it before taking stock.`);
  }
  return period;
}

/**
 * r35: a MONTHLY count is dated on the period's Stock Take Date (the period end
 * when that is not set). `countedDate` is the farm-local calendar day of counted_at.
 */
export function assertStockTakeDate(
  period: { period_code: string; stock_take_date?: string | null; end_date?: string | null },
  countedDate: string,
): void {
  const expected = String(period.stock_take_date ?? period.end_date ?? '').slice(0, 10);
  if (expected && expected !== countedDate) {
    throw new BadRequestException(
      `A monthly stock take for period ${period.period_code} must be dated ${expected} (the Stock Take Date); this count is dated ${countedDate}.`,
    );
  }
}

/** `countable` = has at least one active SILO (farm) or BIN (mill) a count can use; omitted means countable. */
export interface CloseLocation { location_id: string; code: string; countable?: boolean }
export interface CloseTake { farm_id: string; count_type: string; reporting_period_id: string | null; status: string }

/** Controller reading of r31 (awaiting Rishi): a farm or mill with nothing to count owes no take. */
export function nothingToCount(locations: CloseLocation[]): CloseLocation[] {
  return locations.filter((l) => l.countable === false);
}

/** r31: every farm and mill that has something to count needs a POSTED monthly stock take for the period. */
export function periodCloseBlockers(periodId: string, locations: CloseLocation[], takes: CloseTake[]): CloseLocation[] {
  const posted = new Set(
    takes.filter((t) => t.count_type === 'MONTHLY' && t.reporting_period_id === periodId && t.status === 'POSTED').map((t) => t.farm_id),
  );
  return locations.filter((l) => l.countable !== false && !posted.has(l.location_id));
}

export function assertPeriodCanClose(
  period: StockTakePeriod,
  locations: CloseLocation[],
  takes: CloseTake[],
): void {
  if (period.period_status === 'CLOSED') throw new BadRequestException(`Reporting period ${period.period_code} is already closed.`);
  const missing = periodCloseBlockers(period.period_id, locations, takes);
  const empty = nothingToCount(locations);
  if (missing.length) {
    throw new BadRequestException(
      `Reporting period ${period.period_code} cannot close: no posted monthly stock take for ${missing.map((m) => m.code).join(', ')}.`
      + (empty.length ? ` Nothing to count (not required): ${empty.map((m) => m.code).join(', ')}.` : ''),
    );
  }
}

/** Reopen is admin-only and needs a reason. */
export function reopenPatch(
  period: StockTakePeriod,
  actor: { userId: string; isAdmin: boolean },
  reason: string | null | undefined,
  now: string,
) {
  if (!actor.isAdmin) throw new ForbiddenException('Only an administrator can reopen a closed reporting period.');
  if (period.period_status !== 'CLOSED') throw new BadRequestException(`Reporting period ${period.period_code} is not closed.`);
  const text = (reason ?? '').trim();
  if (!text) throw new BadRequestException('A reason is required to reopen a closed reporting period.');
  return { period_status: 'OPEN', reopened_by: actor.userId, reopened_at: now, reopen_reason: text.slice(0, 500) };
}
