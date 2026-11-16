import { BadRequestException } from '@nestjs/common';
import { asc, desc, SQL } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';

const SORTABLE = {
  journal_no: schema.journalHeader.journal_no,
  posting_date: schema.journalHeader.posting_date,
  source: schema.journalHeader.source,
  total_debit: schema.journalHeader.total_debit,
  total_credit: schema.journalHeader.total_credit,
  status: schema.journalHeader.status,
  created_at: schema.journalHeader.created_at,
} as const;

/**
 * The order a journal list comes back in. With no `sort` it is newest first: the latest posting date, then the latest entry made on that
 * date, then the highest number. (It used to have no ORDER BY at all, so the first 50 or 200 rows were whichever MySQL chose.) A chosen
 * column sorts either way, and ties always fall back to newest first so a page never shuffles between loads.
 */
export function journalOrderBy(sort?: string, dir?: 'asc' | 'desc'): SQL[] {
  const newestFirst = [desc(schema.journalHeader.posting_date), desc(schema.journalHeader.created_at), desc(schema.journalHeader.journal_no)];
  if (!sort) return newestFirst;
  const column = SORTABLE[sort as keyof typeof SORTABLE];
  if (!column) throw new BadRequestException(`Cannot sort journals by '${sort}'. Use one of: ${Object.keys(SORTABLE).join(', ')}.`);
  return [(dir === 'asc' ? asc(column) : desc(column)) as SQL, ...newestFirst.filter((_, i) => !(sort === 'posting_date' && i === 0))];
}
