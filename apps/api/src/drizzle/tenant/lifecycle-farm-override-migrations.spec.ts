import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0171 — lifecycle farm override (additive)', () => {
  it('is journalled at idx 170, when 1792000000039, after every earlier entry', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 170)).toEqual({ idx: 170, version: '5', when: 1792000000039, tag: '0171_lifecycle_farm_override', breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 170)) expect(1792000000039).toBeGreaterThan(e.when);
  });

  it('only adds a nullable farm_id with a short-named foreign key to location_master', () => {
    const s = statements('0171_lifecycle_farm_override');
    expect(s).toEqual([
      'ALTER TABLE `breed_lifecycle_stages` ADD `farm_id` varchar(36);',
      'ALTER TABLE `breed_lifecycle_stages` ADD CONSTRAINT `bls_farm_fk` FOREIGN KEY (`farm_id`) REFERENCES `location_master`(`location_id`) ON DELETE RESTRICT;',
    ]);
  });
});
