import { BadRequestException } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { and, asc, count, desc, eq, getTableColumns, inArray, like, SQL } from 'drizzle-orm';
import { AnyMySqlColumn, AnyMySqlTable } from 'drizzle-orm/mysql-core';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../core/database/schema';

/**
 * One list contract for every master.
 *
 * Master lists used to be sorted nowhere and paginated in the browser: the
 * table asked for `limit=200`, never sent an offset, and sliced the result to
 * make pages. That holds up on demo data and falls apart on the client's:
 * MULTIPLIER's location template alone is 508 rows and Porta's 191, so the
 * Locations list would have shown 200 of 699 with no way to reach the rest —
 * and a filter applied in the browser would only ever have searched those 200.
 *
 * Of the seventeen master services, exactly one had an `orderBy`, so the order
 * rows came back in was whatever MySQL chose and could differ between two loads
 * of the same page.
 *
 * So sorting, filtering and paging all happen here, in SQL, against the whole
 * table. `total` comes back beside the rows so the pager knows how many pages
 * there really are.
 */
export class MasterListQueryDto {
  @ApiPropertyOptional({ description: 'Column to sort by. Must be a real column on this master.' })
  @IsOptional()
  @IsString()
  sort?: string;

  @ApiPropertyOptional({ description: 'Sort direction.', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  dir?: 'asc' | 'desc';

  /**
   * Per-column filters, as `filter[column]=value`. Express parses that into an
   * object, so this arrives as `{ column: 'value' }`.
   *
   * Values are matched exactly, except that a `*` suffix means "starts with"
   * and a bare `*` inside means contains — enough for the table's column
   * filters without inventing a query language. Every key is checked against
   * the table's own columns before it reaches SQL.
   */
  @ApiPropertyOptional({ description: 'Per-column filters, as filter[column]=value.' })
  @IsOptional()
  @IsObject()
  filter?: Record<string, string | string[]>;

  @ApiPropertyOptional({ description: 'Results per page.', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ description: 'Pagination offset.', default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** What a master's findAll returns. `data` stays an array so every existing
 *  caller that reads the response's `data` keeps working; `total` is new. */
export interface MasterList<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

const columnsOf = (table: AnyMySqlTable) => getTableColumns(table) as Record<string, AnyMySqlColumn>;

/**
 * Columns a caller may never filter on, because the workspace decides them.
 * Refused by name rather than dropped, for the same reason as an unknown
 * column: a filter that appears to be applied and is not is the worst outcome.
 *
 * Note these are refused for clarity, not containment — `masterScopeConditions`
 * has already pinned the scope, so an extra condition on the same column could
 * only ever narrow the result, never widen it past the workspace.
 */
const RESERVED_FILTER_COLUMNS = ['tenant_id', 'company_id'];

/**
 * Turns `filter[column]=value` into WHERE conditions.
 *
 * A key that is not a column on this table is a 400 naming the key, never a
 * silently ignored filter — a filter that quietly does nothing is worse than
 * one that fails, because the list then looks like an answer.
 *
 * That rule applies to columns the service also exposes under a camelCase name
 * of its own (`locationType` beside `location_type`). An earlier version of
 * this helper skipped those to avoid filtering twice, which meant
 * `filter[location_type]=PEN` returned every row and reported success. Applying
 * both is harmless — two identical conditions AND to the same result, and two
 * different ones narrow, which is what the caller asked for.
 */
export function listFilterConditions(
  table: AnyMySqlTable,
  filter: Record<string, string | string[]> | undefined,
): SQL[] {
  if (!filter) return [];
  const columns = columnsOf(table);
  const conditions: SQL[] = [];
  for (const [key, raw] of Object.entries(filter)) {
    if (RESERVED_FILTER_COLUMNS.includes(key)) {
      throw new BadRequestException(
        `Cannot filter by '${key}' — it is set by the active workspace.`,
      );
    }
    const column = columns[key];
    if (!column) {
      throw new BadRequestException(
        `Cannot filter by '${key}' — it is not a column on this master.`,
      );
    }
    if (raw === undefined || raw === null || raw === '') continue;
    // A multi-select filter (several types at once) arrives as an array.
    if (Array.isArray(raw)) {
      const values = raw.filter((value) => value !== '');
      if (values.length) conditions.push(inArray(column, values));
      continue;
    }
    const value = String(raw);
    // Booleans arrive as the strings a query string can carry. tinyint columns
    // reject 'true', so they are converted rather than passed through.
    if (value === 'true' || value === 'false') {
      conditions.push(eq(column, value === 'true'));
      continue;
    }
    if (value.includes('*')) {
      conditions.push(like(column, value.replace(/\*/g, '%')));
      continue;
    }
    conditions.push(eq(column, value));
  }
  return conditions;
}

/**
 * ORDER BY for a list. Falls back to the master's own code column so the
 * sequence is stable even when the caller asks for nothing — an unsorted list
 * is not merely untidy, it can hand back different rows on the same page of the
 * same query.
 */
export function listOrderBy(
  table: AnyMySqlTable,
  query: MasterListQueryDto,
  fallback: AnyMySqlColumn,
): SQL {
  const columns = columnsOf(table);
  const column = query.sort ? columns[query.sort] : undefined;
  if (query.sort && !column) {
    throw new BadRequestException(
      `Cannot sort by '${query.sort}' — it is not a column on this master.`,
    );
  }
  const target = column ?? fallback;
  return (query.dir === 'desc' ? desc(target) : asc(target)) as SQL;
}

/**
 * Runs the page query and the matching count in one place, so the two can never
 * disagree about what they are counting.
 */
export async function runMasterList<T extends Record<string, unknown>>(
  db: MySql2Database<typeof schema>,
  table: AnyMySqlTable,
  conditions: SQL[],
  query: MasterListQueryDto,
  fallbackSort: AnyMySqlColumn,
  select?: Record<string, unknown>,
): Promise<MasterList<T>> {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const where = conditions.length ? and(...conditions) : undefined;

  const rows = await (select ? db.select(select as any) : db.select())
    .from(table)
    .where(where)
    .orderBy(listOrderBy(table, query, fallbackSort))
    .limit(limit)
    .offset(offset);

  const [counted] = await db.select({ total: count() }).from(table).where(where);

  return { data: rows as T[], total: Number(counted?.total ?? 0), limit, offset };
}
