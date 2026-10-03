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

/**
 * Review finding (Important 1, Task 9): decimal(6,1) caps at 99,999.9 where the
 * old INT held up to 2,147,483,647 — a range regression, not just a precision
 * gain. dec() (feed-requisition.service.ts) stringifies without clamping, so an
 * out-of-range value raises under MySQL strict mode and rolls back the whole
 * auto-draft transaction. 0143 is already applied to nf_devco and nf_system, so
 * this amends forward rather than editing it. Widening only — no clamp in the
 * writer, which would silently distort a number the workbook displays.
 */
describe('Tenant migration 0144 — widen requisition_line.days_remaining range (additive)', () => {
  it('is journalled at idx 144 after 0143', () => {
    expect(journal().find((e) => e.idx === 144)).toEqual({
      idx: 144, version: '5', when: 1792000000013, tag: '0144_widen_requisition_line_days_remaining', breakpoints: true,
    });
  });

  it('widens days_remaining to decimal(10,1), nothing destructive', () => {
    const sql = statements('0144_widen_requisition_line_days_remaining');
    expect(sql).toEqual([
      'ALTER TABLE `requisition_line` MODIFY COLUMN `days_remaining` decimal(10,1);',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE)\b/i);
  });
});

/**
 * Task 9b (D1, 3 Oct): auto-draft 500'd on 7 of 9 demo farms —
 * buildInputBatches keys an ANIMAL_WISE/REGISTERED batch as
 * `<batch_id>:<stage_id>` (73 chars), and that composite flowed straight
 * into requisition_line_batch.batch_id, a varchar(36) NOT NULL FK to
 * batch_header.batch_id: ER_DATA_TOO_LONG, whole transaction rolled back.
 * Widening batch_id would not help — a composite is never a batch_header
 * key. The fix carries the real batch_id and stage_id as two values; this
 * migration adds stage_id (additive, nullable) and rebuilds the unique
 * index to include it, since otherwise two stage groups of the same batch
 * feeding the same shed collide on (line_id, batch_id, shed_id).
 */
describe('Tenant migration 0145 — requisition_line_batch carries the real batch id and its own stage (additive)', () => {
  it('is journalled at idx 145 after 0144', () => {
    expect(journal().find((e) => e.idx === 145)).toEqual({
      idx: 145, version: '5', when: 1792000000014, tag: '0145_requisition_line_batch_stage', breakpoints: true,
    });
  });

  it('adds stage_id and widens the unique index to include it via a safe add-then-swap (MySQL refuses to drop the sole index an existing FK depends on), nothing destructive', () => {
    const sql = statements('0145_requisition_line_batch_stage');
    expect(sql).toEqual([
      'ALTER TABLE `requisition_line_batch` ADD COLUMN `stage_id` varchar(36);',
      'ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `requisition_line_batch_stage_id_fk` FOREIGN KEY (`stage_id`) REFERENCES `stage_master`(`stage_id`) ON DELETE set null ON UPDATE no action;',
      'ALTER TABLE `requisition_line_batch` ADD CONSTRAINT `uq_requisition_line_batch_v2` UNIQUE(`line_id`,`batch_id`,`stage_id`,`shed_id`);',
      'ALTER TABLE `requisition_line_batch` DROP INDEX `uq_requisition_line_batch`;',
      'ALTER TABLE `requisition_line_batch` RENAME INDEX `uq_requisition_line_batch_v2` TO `uq_requisition_line_batch`;',
    ]);
    expect(sql.join('\n')).not.toMatch(/\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i);
  });
});
