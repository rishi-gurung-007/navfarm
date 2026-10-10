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

export interface CountBin {
  location_id: string;
  item_id: string | null;
  is_active: boolean;
}

export interface MonthlyLineDraft {
  silo_id: string;
  item_id: string;
  system_qty_kg: number;
  counted_qty_kg: number | null;
}

/**
 * Lines for ALL active silos/bins of the farm or mill, each with the system
 * balance at the stock-take date (r37). A bin with no ledger balance gets 0, not
 * a missing line. A bin with no feed item cannot be counted and is reported.
 */
export function buildMonthlyLines(
  bins: CountBin[],
  balanceAt: (locationId: string, itemId: string) => number,
): { lines: MonthlyLineDraft[]; skipped: string[] } {
  const lines: MonthlyLineDraft[] = [];
  const skipped: string[] = [];
  for (const bin of bins.filter((b) => b.is_active)) {
    if (!bin.item_id) { skipped.push(bin.location_id); continue; }
    lines.push({ silo_id: bin.location_id, item_id: bin.item_id, system_qty_kg: Number(balanceAt(bin.location_id, bin.item_id) ?? 0), counted_qty_kg: null });
  }
  return { lines, skipped };
}

/** r45: the approved adjustment is posted exactly once. */
export function assertPostableOnce(count: { status: string; stock_adjustment_id: string | null }): void {
  if (count.status === 'POSTED' || count.stock_adjustment_id) {
    throw new BadRequestException('This stock take has already been posted; its adjustment cannot be posted twice.');
  }
  if (count.status !== 'APPROVED') {
    throw new BadRequestException(`Only an approved stock take can be posted (current status ${count.status}).`);
  }
}

export interface CloseLocation { location_id: string; code: string }
export interface CloseTake { farm_id: string; count_type: string; reporting_period_id: string | null; status: string }

/** r31: every farm and mill in the company needs a POSTED monthly stock take for the period. */
export function periodCloseBlockers(periodId: string, locations: CloseLocation[], takes: CloseTake[]): CloseLocation[] {
  const posted = new Set(
    takes.filter((t) => t.count_type === 'MONTHLY' && t.reporting_period_id === periodId && t.status === 'POSTED').map((t) => t.farm_id),
  );
  return locations.filter((l) => !posted.has(l.location_id));
}

export function assertPeriodCanClose(
  period: StockTakePeriod,
  locations: CloseLocation[],
  takes: CloseTake[],
): void {
  if (period.period_status === 'CLOSED') throw new BadRequestException(`Reporting period ${period.period_code} is already closed.`);
  const missing = periodCloseBlockers(period.period_id, locations, takes);
  if (missing.length) {
    throw new BadRequestException(
      `Reporting period ${period.period_code} cannot close: no posted monthly stock take for ${missing.map((m) => m.code).join(', ')}.`,
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
