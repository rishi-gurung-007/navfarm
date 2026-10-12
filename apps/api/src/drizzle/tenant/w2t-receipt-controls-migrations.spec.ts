import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0165 — W2T feed TO receipt controls on the receipt line (additive)', () => {
  it('is journalled at idx 164 with a when after 0164', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 164)).toEqual({ idx: 164, version: '5', when: 1792000000033, tag: '0165_transfer_receipt_line_controls', breakpoints: true });
    expect(1792000000033).toBeGreaterThan(entries.find((e) => e.idx === 163)!.when);
  });

  it('adds six nullable columns to transfer_receipt_line and nothing else', () => {
    // Silo TO Receipt rows 17, 18, 24, 27 and Requisition rows 145-147: variance,
    // its reason, bag count, delivery note and the loading sheet the feed came on.
    expect(statements('0165_transfer_receipt_line_controls')).toEqual([
      'ALTER TABLE `transfer_receipt_line` ADD `variance_qty` decimal(18,4);',
      'ALTER TABLE `transfer_receipt_line` ADD `variance_reason` varchar(500);',
      'ALTER TABLE `transfer_receipt_line` ADD `bag_count` int;',
      'ALTER TABLE `transfer_receipt_line` ADD `delivery_note_no` varchar(80);',
      'ALTER TABLE `transfer_receipt_line` ADD `loading_sheet_id` varchar(36);',
      'ALTER TABLE `transfer_receipt_line` ADD `loading_sheet_no` varchar(80);',
    ]);
  });
});
