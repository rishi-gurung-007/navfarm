import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0154 — requisition line on the transfer line (Part E, additive)', () => {
  it('is journalled at idx 153 with a when after 0152', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 153)).toEqual({ idx: 153, version: '5', when: 1792000000022, tag: '0154_stock_transfer_line_requisition_line', breakpoints: true });
    expect(1792000000022).toBeGreaterThan(entries.find((e) => e.idx === 152)!.when);
  });

  it('adds one nullable column, its FK and an index — nothing destructive', () => {
    expect(statements('0154_stock_transfer_line_requisition_line')).toEqual([
      'ALTER TABLE `stock_transfer_line` ADD `requisition_line_id` varchar(36);',
      'ALTER TABLE `stock_transfer_line` ADD CONSTRAINT `stock_transfer_line_requisition_line_fk` FOREIGN KEY (`requisition_line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE set null ON UPDATE no action;',
      'CREATE INDEX `idx_stock_transfer_line_requisition_line` ON `stock_transfer_line` (`requisition_line_id`);',
    ]);
  });
});
