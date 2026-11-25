import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = __dirname;
const journal = JSON.parse(readFileSync(join(directory, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; tag: string; when: number }>;
const sql = readFileSync(join(directory, '0266_semen_item.sql'), 'utf8');

describe('tenant migration 0266 — semen item', () => {
  it('is journalled after 0265 with a later date, so the migrator runs it', () => {
    const position = journal.findIndex((e) => e.tag === '0266_semen_item');
    expect(journal[position]).toMatchObject({ idx: 263, tag: '0266_semen_item' });
    expect(journal[position - 1].tag).toBe('0265_semen_requisition');
    expect(journal[position].when).toBeGreaterThan(journal[position - 1].when);
  });

  it('marks no item and sets no line by itself', () => {
    expect(sql).toContain('ALTER TABLE `item_master` ADD `is_semen` boolean DEFAULT false NOT NULL;');
    expect(sql).toContain('ALTER TABLE `breeding_line_setup` ADD `semen_item_id` varchar(36);');
    expect(sql).not.toMatch(/UPDATE /i);
  });
});
