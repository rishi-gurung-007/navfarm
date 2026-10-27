import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string }>;
const sql = (tag: string) => readFileSync(join(dir, `${tag}.sql`), 'utf8');

describe('Tenant migrations 0212–0213 — priority moves from the requisition to its lines', () => {
  it('journals the copy before the drop, after 0211', () => {
    const tags = journal.map((e) => e.tag);
    const at = (tag: string) => tags.indexOf(tag);
    expect(at('0212_requisition_line_priority')).toBe(at('0211_stock_transfer_vehicle_no') + 1);
    expect(at('0213_drop_requisition_priority')).toBe(at('0212_requisition_line_priority') + 1);
  });

  it('adds the line column and copies every requisition\'s priority onto its lines, never overwriting one already set', () => {
    const copy = sql('0212_requisition_line_priority');
    expect(copy).toContain('ALTER TABLE `requisition_line` ADD `priority` varchar(30);');
    expect(copy).toMatch(/UPDATE `requisition_line` rl\s+JOIN `requisition` r ON r.`requisition_id` = rl.`requisition_id`\s+SET rl.`priority` = r.`priority`/);
    expect(copy).toContain('rl.`priority` IS NULL');
    expect(copy).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });

  it('drops only the header column, once 0212 has copied it', () => {
    const drop = sql('0213_drop_requisition_priority');
    expect(drop.replace(/^--.*$/gm, '').trim()).toBe('ALTER TABLE `requisition` DROP COLUMN `priority`;');
  });
});
