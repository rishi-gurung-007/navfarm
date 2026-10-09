import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0155 — WP1c direct-transfer right and requisition line tracking (additive)', () => {
  it('is journalled at idx 154 with a when after 0153', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 154)).toEqual({ idx: 154, version: '5', when: 1792000000023, tag: '0155_wp1c_direct_transfer_and_tracking', breakpoints: true });
    expect(1792000000023).toBeGreaterThan(entries.find((e) => e.idx === 153)!.when);
  });

  it('adds three columns, all additive, nothing destructive', () => {
    expect(statements('0155_wp1c_direct_transfer_and_tracking')).toEqual([
      'ALTER TABLE `user_master` ADD `direct_transfer_allowed` boolean DEFAULT false NOT NULL;',
      'ALTER TABLE `requisition_line` ADD `lot_no` varchar(50);',
      'ALTER TABLE `requisition_line` ADD `serial_no` varchar(100);',
    ]);
  });
});

describe('Tenant migration 0156 — WP1c addendum: FA/Service lines carry no unit (relaxing MODIFY)', () => {
  it('is journalled at idx 155 with a when after 0154', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 155)).toEqual({ idx: 155, version: '5', when: 1792000000024, tag: '0156_requisition_line_uom_nullable', breakpoints: true });
    expect(1792000000024).toBeGreaterThan(entries.find((e) => e.idx === 154)!.when);
  });

  it('only relaxes requisition_line.uom — nothing dropped, nothing narrowed', () => {
    // Rishi, 5 Oct: "follow the file shared" — his list makes an FA/Service
    // line Description + Qty only, so those lines carry no unit. Widening a
    // NOT NULL column to nullable is the 0142 pattern: no data is lost and
    // every existing row stays valid.
    expect(statements('0156_requisition_line_uom_nullable')).toEqual([
      'ALTER TABLE `requisition_line` MODIFY COLUMN `uom` varchar(20);',
    ]);
  });
});
