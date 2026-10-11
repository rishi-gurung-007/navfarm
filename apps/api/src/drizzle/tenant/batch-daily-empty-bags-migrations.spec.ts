import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0169 — batch daily empty bags (additive)', () => {
  it('is journalled at idx 168, when 1792000000037, after every earlier entry', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 168)).toEqual({ idx: 168, version: '5', when: 1792000000037, tag: '0169_batch_daily_empty_bags', breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 168)) expect(1792000000037).toBeGreaterThan(e.when);
  });

  it('only adds a nullable empty_bags column to batch_daily_data', () => {
    const sql = statements('0169_batch_daily_empty_bags');
    expect(sql).toEqual(['ALTER TABLE `batch_daily_data` ADD `empty_bags` int;']);
  });
});
