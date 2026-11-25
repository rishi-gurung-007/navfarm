import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = __dirname;
const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string; when: number }>;
const sql = readFileSync(join(directory, '0265_semen_requisition.sql'), 'utf8');

describe('tenant migration 0265 — semen requisition', () => {
  it('is journalled after 0264 with a later date, so the migrator runs it', () => {
    const position = journal.findIndex((e) => e.tag === '0265_semen_requisition');
    expect(journal[position]).toMatchObject({ idx: 262, tag: '0265_semen_requisition' });
    expect(journal[position - 1].tag).toBe('0264_semen_dose_disposal');
    expect(journal[position].when).toBeGreaterThan(journal[position - 1].when);
  });

  it('leaves every existing requisition and plan as it is', () => {
    expect(sql).toContain('ALTER TABLE `requisition` ADD `breed_id` varchar(36);');
    expect(sql).toContain('ALTER TABLE `semen_collection_plan` ADD `target_doses` decimal(10,2);');
  });

  it('links each request line once, removed with its plan', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX `uq_semen_plan_requisition_line` ON `semen_plan_requisition` (`requisition_line_id`)');
    expect(sql).toMatch(/FOREIGN KEY \(`plan_id`\) REFERENCES `semen_collection_plan`\(`plan_id`\) ON DELETE cascade/);
  });
});
