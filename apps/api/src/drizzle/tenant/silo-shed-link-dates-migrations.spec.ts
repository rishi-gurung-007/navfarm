import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0173 — silo_shed_link effective dates (additive)', () => {
  it('is journalled at idx 171, when 1792000000040', () => {
    expect(journal().find((e) => e.idx === 171)).toEqual({ idx: 171, version: '5', when: 1792000000040, tag: '0172_silo_shed_link_dates', breakpoints: true });
  });

  it('only adds two nullable date columns', () => {
    expect(statements('0172_silo_shed_link_dates')).toEqual([
      'ALTER TABLE `silo_shed_link` ADD `effective_from` date;',
      'ALTER TABLE `silo_shed_link` ADD `effective_to` date;',
    ]);
  });
});
