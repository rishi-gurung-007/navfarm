import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0166 — monthly stock take and period close (additive)', () => {
  it('is journalled at idx 165, when 1792000000034, after every earlier entry', () => {
    const entries = journal();
    const entry = entries.find((e) => e.idx === 165);
    expect(entry).toEqual({ idx: 165, version: '5', when: 1792000000034, tag: '0166_monthly_stock_take_period_close', breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 165)) expect(1792000000034).toBeGreaterThan(e.when);
  });

  it('only adds columns and one unique index — nothing dropped, nothing narrowed', () => {
    const sql = statements('0166_monthly_stock_take_period_close');
    expect(sql).toEqual([
      "ALTER TABLE `feed_stock_count` ADD `count_type` varchar(10) DEFAULT 'WEEKLY' NOT NULL;",
      'ALTER TABLE `feed_stock_count` ADD `stock_take_type` varchar(20);',
      'ALTER TABLE `feed_stock_count` ADD `reporting_period_id` varchar(36);',
      'CREATE UNIQUE INDEX `uq_feed_stock_count_period_location` ON `feed_stock_count` (`farm_id`,`reporting_period_id`);',
      "ALTER TABLE `reporting_period` ADD `period_status` varchar(10) DEFAULT 'OPEN' NOT NULL;",
      'ALTER TABLE `reporting_period` ADD `closed_by` varchar(36);',
      'ALTER TABLE `reporting_period` ADD `closed_at` timestamp NULL;',
      'ALTER TABLE `reporting_period` ADD `reopened_by` varchar(36);',
      'ALTER TABLE `reporting_period` ADD `reopened_at` timestamp NULL;',
      'ALTER TABLE `reporting_period` ADD `reopen_reason` varchar(500);',
    ]);
    for (const s of sql) expect(s).not.toMatch(/\bDROP\b|\bMODIFY\b|\bRENAME\b/i);
  });
});
