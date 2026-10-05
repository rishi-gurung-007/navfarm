import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0148 — WP1c direct-transfer right and requisition line tracking (additive)', () => {
  it('is journalled at idx 148 with a when after 0147, leaving 146 for the deferred drop', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 148)).toEqual({ idx: 148, version: '5', when: 1792000000017, tag: '0148_wp1c_direct_transfer_and_tracking', breakpoints: true });
    expect(entries.find((e) => e.idx === 146)).toBeUndefined();
    expect(1792000000017).toBeGreaterThan(entries.find((e) => e.idx === 147)!.when);
  });

  it('adds three columns, all additive, nothing destructive', () => {
    expect(statements('0148_wp1c_direct_transfer_and_tracking')).toEqual([
      'ALTER TABLE `user_master` ADD `direct_transfer_allowed` boolean DEFAULT false NOT NULL;',
      'ALTER TABLE `requisition_line` ADD `lot_no` varchar(50);',
      'ALTER TABLE `requisition_line` ADD `serial_no` varchar(100);',
    ]);
  });
});
