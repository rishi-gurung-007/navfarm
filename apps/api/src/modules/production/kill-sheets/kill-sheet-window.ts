import { and, or, sql, SQL } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';

/**
 * The kill sheets of a date window (YYYY-MM-DD, either side optional): those whose slaughter dates overlap it, and,
 * for a report with no slaughter date, those confirmed (or else uploaded) inside it.
 */
export function killSheetWindow(from?: string, to?: string): SQL | undefined {
  if (!from && !to) return undefined;
  const sheet = schema.killSheetImport;
  const start = from ? `${from} 00:00:00` : null;
  const end = to ? `${to} 23:59:59` : null;
  const recorded = sql`coalesce(${sheet.confirmed_at}, ${sheet.created_at})`;
  return or(
    and(
      sql`${sheet.slaughter_from} IS NOT NULL`,
      end ? sql`${sheet.slaughter_from} <= ${end}` : undefined,
      start ? sql`coalesce(${sheet.slaughter_to}, ${sheet.slaughter_from}) >= ${start}` : undefined,
    ),
    and(
      sql`${sheet.slaughter_from} IS NULL`,
      start ? sql`${recorded} >= ${start}` : undefined,
      end ? sql`${recorded} <= ${end}` : undefined,
    ),
  );
}
