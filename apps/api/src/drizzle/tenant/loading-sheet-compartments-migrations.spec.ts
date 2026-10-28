import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'))
    .entries as Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;

describe('Tenant migration 0209 — loading-sheet compartment lines (additive)', () => {
  it('is journalled after the current tenant migration lineage', () => {
    const entries = journal();
    expect(entries.find((entry) => entry.idx === 206)).toEqual({
      idx: 206,
      version: '5',
      when: 1792000000077,
      tag: '0209_loading_sheet_compartments',
      breakpoints: true,
    });
  });

  it('creates child compartment rows without dropping or rewriting loading-sheet data', () => {
    expect(statements('0209_loading_sheet_compartments')).toEqual([
      [
        'CREATE TABLE `feed_loading_sheet_compartment` (',
        '\t`compartment_id` varchar(36) NOT NULL,',
        '\t`loading_sheet_id` varchar(36) NOT NULL,',
        '\t`line_no` int NOT NULL,',
        '\t`compartment_no` varchar(50) NOT NULL,',
        '\t`kg_loaded` decimal(14,4) NOT NULL,',
        '\t`loaded_by` varchar(36),',
        '\t`loaded_at` timestamp,',
        '\t`created_at` timestamp NOT NULL DEFAULT (now()),',
        '\tCONSTRAINT `feed_loading_sheet_compartment_id` PRIMARY KEY(`compartment_id`),',
        '\tCONSTRAINT `uq_feed_loading_sheet_compartment` UNIQUE(`loading_sheet_id`,`line_no`)',
        ');',
      ].join('\n'),
      'ALTER TABLE `feed_loading_sheet_compartment` ADD CONSTRAINT `feed_loading_sheet_compartment_sheet_fk` FOREIGN KEY (`loading_sheet_id`) REFERENCES `feed_loading_sheet`(`loading_sheet_id`) ON DELETE cascade ON UPDATE no action;',
      'CREATE INDEX `idx_feed_loading_sheet_compartment_sheet` ON `feed_loading_sheet_compartment` (`loading_sheet_id`);',
      'INSERT INTO `feed_loading_sheet_compartment` (`compartment_id`, `loading_sheet_id`, `line_no`, `compartment_no`, `kg_loaded`, `loaded_by`, `loaded_at`)\nSELECT UUID(), `loading_sheet_id`, 10000, `compartment_no`, `kg_loaded`, `loaded_by`, `loaded_at`\nFROM `feed_loading_sheet`\nWHERE `compartment_no` IS NOT NULL AND `kg_loaded` IS NOT NULL;',
    ]);
    expect(
      statements('0209_loading_sheet_compartments').join('\n'),
    ).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});
