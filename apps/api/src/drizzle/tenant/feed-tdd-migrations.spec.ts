import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Feed TDD alignment (spec 2026-10-03): 0141 adds the workbook's columns; 0142
 * drops the feed-era columns the workbook does not have. Columns that existed
 * before the feed forecast (silo_reorder_days, feed_wastage_pct) are kept.
 */
const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;

describe('Tenant migration 0141 — feed TDD alignment (additive)', () => {
  it('is journalled at idx 141 after 0140', () => {
    expect(journal().find((e) => e.idx === 141)).toEqual({
      idx: 141, version: '5', when: 1792000000010, tag: '0141_feed_tdd_alignment', breakpoints: true,
    });
  });

  it('adds exactly the workbook columns and nothing destructive', () => {
    const sql = statements('0141_feed_tdd_alignment');
    expect(sql).toEqual([
      'ALTER TABLE `feed_planning_setting` ADD `safety_stock_kg` decimal(14,2);',
      'ALTER TABLE `feed_planning_setting` ADD `bag_size_kg` decimal(14,2);',
      'ALTER TABLE `item_master` ADD `diet_no` int;',
      'ALTER TABLE `breed_lifecycle_stages` ADD `feed_form` varchar(10);',
      'ALTER TABLE `requisition` ADD `linked_transfer_id` varchar(36);',
      'ALTER TABLE `requisition_line` ADD `mill_approved_qty_kg` decimal(18,4);',
      'ALTER TABLE `requisition_line` ADD `recommended_delivery_date` date;',
      'ALTER TABLE `requisition_line` ADD `exceeds_silo_capacity` boolean NOT NULL DEFAULT false;',
      'ALTER TABLE `requisition` ADD CONSTRAINT `requisition_linked_transfer_fk` FOREIGN KEY (`linked_transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE set null ON UPDATE no action;',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});

/**
 * 0137 created feed_stock_count with columns the service never writes
 * (total_silos NOT NULL …) and without the workflow columns it does write
 * (submitted_by, approved_by, posted_by and their timestamps), so a stock
 * count could not be saved on a freshly migrated tenant. 0142 brings that
 * lineage to the shape schema.ts and the service use, without dropping data.
 */
describe('Tenant migration 0142 — reconcile feed_stock_count with the code', () => {
  it('is journalled at idx 142', () => {
    expect(journal().find((e) => e.idx === 142)).toEqual({
      idx: 142, version: '5', when: 1792000000011, tag: '0142_reconcile_feed_stock_count', breakpoints: true,
    });
  });

  it('adds the workflow columns and relaxes the unused NOT NULLs, nothing destructive', () => {
    const sql = statements('0142_reconcile_feed_stock_count');
    expect(sql).toEqual([
      'ALTER TABLE `feed_stock_count` ADD `submitted_by` varchar(36);',
      'ALTER TABLE `feed_stock_count` ADD `submitted_at` timestamp;',
      'ALTER TABLE `feed_stock_count` ADD `approved_by` varchar(36);',
      'ALTER TABLE `feed_stock_count` ADD `approved_at` timestamp;',
      'ALTER TABLE `feed_stock_count` ADD `posted_by` varchar(36);',
      'ALTER TABLE `feed_stock_count` ADD `posted_at` timestamp;',
      'ALTER TABLE `feed_stock_count` MODIFY COLUMN `total_silos` int;',
      'ALTER TABLE `feed_stock_count` MODIFY COLUMN `max_variance_pct` decimal(12,6);',
      'ALTER TABLE `feed_stock_count` MODIFY COLUMN `total_variance_kg` decimal(18,4);',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});

/**
 * Task 9 (B1, B2): a feed requisition order line is one destination silo and
 * item (Engine Step 8 rounds per compartment); its batch/house breakdown —
 * "raised on the basis of Per Batch, Per House, and Per Silo" (MOM Feed and
 * Logistic, 21 Aug 2026; Engine Step 9) — is a child table. Days Remaining is
 * "Displayed to 1 decimal" (Silo Balance row 9), so the INT column widens.
 */
describe('Tenant migration 0143 — requisition line batch breakdown (additive)', () => {
  it('is journalled at idx 143 after 0142', () => {
    expect(journal().find((e) => e.idx === 143)).toEqual({
      idx: 143, version: '5', when: 1792000000012, tag: '0143_requisition_line_batch', breakpoints: true,
    });
  });

  it('creates requisition_line_batch, widens days_remaining, nothing destructive', () => {
    const sql = statements('0143_requisition_line_batch');
    expect(sql).toEqual([
      [
        'CREATE TABLE `requisition_line_batch` (',
        '\t`line_batch_id` varchar(36) NOT NULL,',
        '\t`line_id` varchar(36) NOT NULL,',
        '\t`batch_id` varchar(36) NOT NULL,',
        '\t`shed_id` varchar(36),',
        '\t`heads` int,',
        '\t`feed_rate_kg` decimal(18,6),',
        '\t`lifecycle_ref_id` varchar(36),',
        '\t`demand_kg` decimal(18,4) NOT NULL,',
        '\t`first_demand_date` date,',
        '\t`created_at` timestamp NOT NULL DEFAULT (now()),',
        '\tCONSTRAINT `requisition_line_batch_line_batch_id` PRIMARY KEY(`line_batch_id`),',
        '\tCONSTRAINT `uq_requisition_line_batch` UNIQUE(`line_id`,`batch_id`,`shed_id`)',
        ');',
      ].join('\n'),
      'ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_line_id_fk` FOREIGN KEY (`line_id`) REFERENCES `requisition_line`(`line_id`) ON DELETE cascade ON UPDATE no action;',
      'ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_batch_id_fk` FOREIGN KEY (`batch_id`) REFERENCES `batch_header`(`batch_id`) ON DELETE no action ON UPDATE no action;',
      'ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_shed_id_fk` FOREIGN KEY (`shed_id`) REFERENCES `location_master`(`location_id`) ON DELETE set null ON UPDATE no action;',
      'ALTER TABLE `requisition_line` MODIFY COLUMN `days_remaining` decimal(6,1);',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});
