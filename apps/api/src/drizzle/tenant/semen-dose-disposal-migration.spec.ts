import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = __dirname;
const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string; when: number }>;
const sql = readFileSync(join(directory, '0264_semen_dose_disposal.sql'), 'utf8');

describe('tenant migration 0264 — semen dose disposal', () => {
  it('is journalled after 0263 with a later date, so the migrator runs it', () => {
    const position = journal.findIndex((e) => e.tag === '0264_semen_dose_disposal');
    expect(journal[position]).toMatchObject({ idx: 261, tag: '0264_semen_dose_disposal' });
    expect(journal[position - 1].tag).toBe('0263_qc_inspection_rounds');
    expect(journal[position].when).toBeGreaterThan(journal[position - 1].when);
  });

  it('counts no destroyed doses on any existing lot', () => {
    expect(sql).toContain("ALTER TABLE `semen_batch` ADD `doses_destroyed` decimal(10,2) NOT NULL DEFAULT '0'");
  });

  it('keeps each disposal on its lot, numbered once per company', () => {
    expect(sql).toContain('CREATE TABLE `semen_dose_disposal`');
    expect(sql).toMatch(/FOREIGN KEY \(`semen_batch_id`\) REFERENCES `semen_batch`\(`semen_batch_id`\) ON DELETE restrict/);
    expect(sql).toContain('CREATE UNIQUE INDEX `uq_semen_dose_disposal_no` ON `semen_dose_disposal` (`tenant_id`,`company_id`,`disposal_no`)');
  });
});
