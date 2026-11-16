import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;

describe('Tenant migration 0245 — death destination and book value at death (additive)', () => {
  it('is journalled at idx 242, after the semen collector migrations', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 242)!;
    expect(e.tag).toBe('0245_death_destination_and_book_value');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 241)!.when);
  });

  it('adds two nullable columns, then fills the book value of deaths already posted from their ledger write-off', () => {
    const sql = statements('0245_death_destination_and_book_value');
    expect(sql).toHaveLength(3);
    expect(sql[0]).toBe('ALTER TABLE `batch_mortality_animal` ADD `disposal_destination` varchar(100);');
    expect(sql[1]).toBe('ALTER TABLE `animal_register` ADD `book_value_at_death` decimal(18,4);');
    expect(sql[0] + sql[1]).not.toMatch(/NOT NULL|DEFAULT/);
    expect(sql[2]).toMatch(/^UPDATE `animal_register`/);
    expect(sql[2]).toContain("`document_type` = 'MORTALITY'");
    expect(sql[2]).toContain('`book_value_at_death` IS NULL');
  });
});
