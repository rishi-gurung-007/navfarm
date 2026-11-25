import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = __dirname;
const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string; when: number }>;
const sql = readFileSync(join(directory, '0263_qc_inspection_rounds.sql'), 'utf8');

describe('tenant migration 0263 — QC inspection rounds', () => {
  it('is journalled after 0262 with a later date, so the migrator runs it', () => {
    const position = journal.findIndex((e) => e.tag === '0263_qc_inspection_rounds');
    expect(journal[position]).toMatchObject({ idx: 260, tag: '0263_qc_inspection_rounds' });
    expect(journal[position - 1].tag).toBe('0262_kill_sheets');
    expect(journal[position].when).toBeGreaterThan(journal[position - 1].when);
  });

  it('defaults every existing item and inspection to a single round', () => {
    expect(sql).toContain('ALTER TABLE `item_master` ADD `qc_rounds` int NOT NULL DEFAULT 1');
    expect(sql).toContain('ALTER TABLE `qc_inspection` ADD `rounds` int NOT NULL DEFAULT 1');
    expect(sql).toContain('ALTER TABLE `qc_inspection_line` ADD `round_no` int NOT NULL DEFAULT 0');
  });

  it('keeps one row per round of an inspection, removed with the inspection', () => {
    expect(sql).toContain('CREATE TABLE `qc_inspection_round`');
    expect(sql).toMatch(/FOREIGN KEY \(`inspection_id`\) REFERENCES `qc_inspection`\(`inspection_id`\) ON DELETE cascade/);
    expect(sql).toContain('CREATE UNIQUE INDEX `uq_qc_inspection_round_no` ON `qc_inspection_round` (`inspection_id`,`round_no`)');
  });
});
