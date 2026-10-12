import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0170 — lifecycle effective dates (additive)', () => {
  it('is journalled at idx 169, when 1792000000038, after every earlier entry', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 169)).toEqual({ idx: 169, version: '5', when: 1792000000038, tag: '0170_lifecycle_effective_dates', breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 169)) expect(1792000000038).toBeGreaterThan(e.when);
  });

  it('only adds two nullable date columns to breed_lifecycle_stages', () => {
    expect(statements('0170_lifecycle_effective_dates')).toEqual([
      'ALTER TABLE `breed_lifecycle_stages` ADD `effective_from` date;',
      'ALTER TABLE `breed_lifecycle_stages` ADD `effective_to` date;',
    ]);
  });
});
