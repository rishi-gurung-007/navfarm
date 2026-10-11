import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0168 — location cost centre (additive)', () => {
  it('is journalled at idx 167, when 1792000000036, after every earlier entry', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 167)).toEqual({ idx: 167, version: '5', when: 1792000000036, tag: '0168_location_cost_centre', breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 167)) expect(1792000000036).toBeGreaterThan(e.when);
  });

  it('only adds a nullable cost_center_id column and its FK to cost_center_master', () => {
    const sql = statements('0168_location_cost_centre');
    expect(sql).toHaveLength(2);
    expect(sql[0]).toBe('ALTER TABLE `location_master` ADD `cost_center_id` varchar(36);');
    expect(sql[1]).toMatch(/FOREIGN KEY \(`cost_center_id`\) REFERENCES `cost_center_master`\(`cost_center_id`\) ON DELETE set null/);
    for (const s of sql) expect(s).not.toMatch(/\bDROP\b|\bMODIFY\b|\bRENAME\b|NOT NULL/i);
  });
});
