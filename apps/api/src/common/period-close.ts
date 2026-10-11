import { BadRequestException } from '@nestjs/common';
import { and, eq, gte, isNull, lte, or } from 'drizzle-orm';
import * as schema from '../core/database/schema';

/**
 * Period close guard (workbook "Checkpoints and Validations" r32): a CLOSED
 * Reporting Period blocks every posting dated inside it — POST Day, receipts,
 * shipments, transfers and stock adjustments. This is the ONE place the rule
 * lives; every posting path calls `assertPostingPeriodOpen`.
 */
export interface PeriodWindow {
  period_code: string;
  start_date: string;
  end_date: string;
  period_status: string;
}

const day = (value: string | Date): string =>
  (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);

export function closedPeriodFor(periods: PeriodWindow[], postingDate: string | Date): PeriodWindow | null {
  const d = day(postingDate);
  return periods.find((p) => p.period_status === 'CLOSED' && day(p.start_date) <= d && d <= day(p.end_date)) ?? null;
}

export function assertPeriodWindowOpen(periods: PeriodWindow[], postingDate: string | Date): void {
  const closed = closedPeriodFor(periods, postingDate);
  if (closed) {
    throw new BadRequestException(
      `Reporting period ${closed.period_code} (${day(closed.start_date)} to ${day(closed.end_date)}) is closed. `
      + `Nothing dated ${day(postingDate)} can be posted into a closed period.`,
    );
  }
}

type Reader = { select: (...args: any[]) => any };

export async function assertPostingPeriodOpen(
  db: Reader,
  params: { tenantId: string; companyId: string | null | undefined; postingDate: string | Date },
): Promise<void> {
  const d = day(params.postingDate);
  const P = schema.reportingPeriod;
  const rows: PeriodWindow[] = await db
    .select({ period_code: P.period_code, start_date: P.start_date, end_date: P.end_date, period_status: P.period_status })
    .from(P)
    .where(and(
      eq(P.tenant_id, params.tenantId),
      params.companyId ? or(eq(P.company_id, params.companyId), isNull(P.company_id)) : isNull(P.company_id),
      eq(P.period_status, 'CLOSED'),
      isNull(P.deleted_at),
      lte(P.start_date, d),
      gte(P.end_date, d),
    ));
  assertPeriodWindowOpen(Array.isArray(rows) ? rows : [], d);
}
