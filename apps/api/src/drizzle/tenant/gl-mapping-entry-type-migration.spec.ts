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

describe('Tenant migration 0232 — GL mapping entry type (additive)', () => {
  it('is journalled at idx 229, after the FA conversion table', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 229)!;
    expect(e.tag).toBe('0232_gl_mapping_entry_type');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 228)!.when);
  });

  it('adds one nullable column to gl_mapping_master and nothing else, so every existing mapping keeps matching any entry type', () => {
    const sql = statements('0232_gl_mapping_entry_type');
    expect(sql).toEqual(['ALTER TABLE `gl_mapping_master` ADD `entry_type` varchar(20);']);
    expect(sql[0]).not.toMatch(/NOT NULL|DEFAULT/);
  });
});
