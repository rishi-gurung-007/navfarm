import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { BadRequestException } from '@nestjs/common';
import { journalOrderBy } from './journal-order';

// The table prefix is not what is being tested.
const render = (orders: ReturnType<typeof journalOrderBy>) => new MySqlDialect().sqlToQuery(sql.join(orders, sql`, `)).sql.replace(/`journal_header`\./g, '');

describe('journalOrderBy', () => {
  it('is newest first by default: latest posting date, then latest entry, then highest number', () => {
    expect(render(journalOrderBy())).toBe('`posting_date` desc, `created_at` desc, `journal_no` desc');
  });

  it('sorts a chosen column either way, then falls back to newest first so ties are stable', () => {
    expect(render(journalOrderBy('total_debit', 'asc'))).toBe('`total_debit` asc, `posting_date` desc, `created_at` desc, `journal_no` desc');
    expect(render(journalOrderBy('journal_no', 'desc'))).toBe('`journal_no` desc, `posting_date` desc, `created_at` desc, `journal_no` desc');
  });

  it('does not repeat the posting date when that is the column chosen', () => {
    expect(render(journalOrderBy('posting_date', 'asc'))).toBe('`posting_date` asc, `created_at` desc, `journal_no` desc');
  });

  it('treats a chosen column as descending unless asked for ascending', () => {
    expect(render(journalOrderBy('status'))).toMatch(/^`status` desc/);
  });

  it('refuses a column it does not know, naming the ones it does', () => {
    expect(() => journalOrderBy('description')).toThrow(BadRequestException);
    expect(() => journalOrderBy('description')).toThrow(/Use one of: journal_no, posting_date/);
  });
});
