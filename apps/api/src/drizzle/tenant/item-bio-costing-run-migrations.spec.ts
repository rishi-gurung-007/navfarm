import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;

describe('Tenant migration 0229 — a costing run can belong to an item (additive)', () => {
  it('is journalled at idx 226 after the item costing migration', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 226)).toEqual({ idx: 226, version: '5', when: 1792000000097, tag: '0229_bio_costing_run_item', breakpoints: true });
    expect(entries.find((e) => e.idx === 226)!.when).toBeGreaterThan(entries.find((e) => e.idx === 225)!.when);
  });

  it('adds an item to the run and a costing-from date to the item, and only relaxes the run\'s profile to optional', () => {
    const sql = statements('0229_bio_costing_run_item');
    expect(sql).toContain('ALTER TABLE `item_master` ADD `bio_effective_from` date;');
    expect(sql).toContain('ALTER TABLE `bio_costing_run` ADD `item_id` varchar(36);');
    expect(sql).toContain('ALTER TABLE `bio_costing_run` MODIFY `profile_id` varchar(36) NULL;');
    const withoutFkActions = sql.map((s) => s.replace(/ON DELETE \w+ ON UPDATE [\w ]+;?/gi, ''));
    expect(withoutFkActions.some((s) => /\bDROP\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b/i.test(s))).toBe(false);
  });
});
