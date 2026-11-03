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

describe('Tenant migration 0228 — item-level bio-asset costing (additive)', () => {
  it('is journalled at idx 225 after the litter-lot migration', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 225)).toEqual({ idx: 225, version: '5', when: 1792000000096, tag: '0228_item_bio_costing', breakpoints: true });
    expect(entries.find((e) => e.idx === 225)!.when).toBeGreaterThan(entries.find((e) => e.idx === 224)!.when);
  });

  it('only adds: columns on item_master and one new table, nothing dropped, altered or updated', () => {
    const sql = statements('0228_item_bio_costing');
    const columns = sql.filter((s) => s.startsWith('ALTER TABLE `item_master` ADD `bio_'));
    expect(columns).toHaveLength(17);
    expect(columns.every((s) => !s.includes('NOT NULL') || s.includes('bio_auto_post'))).toBe(true);
    // A foreign key's own "ON DELETE … ON UPDATE …" is not a data change.
    const withoutFkActions = sql.map((s) => s.replace(/ON DELETE \w+ ON UPDATE [\w ]+;?/gi, ''));
    expect(withoutFkActions.some((s) => /\bDROP\b|\bMODIFY\b|\bCHANGE\b|\bUPDATE\b|\bDELETE\b/i.test(s))).toBe(false);
    expect(sql.filter((s) => s.startsWith('CREATE TABLE'))).toEqual([expect.stringContaining('`item_fair_value_rate`')]);
  });

  it('keeps the existing profile tables untouched', () => {
    expect(statements('0228_item_bio_costing').some((s) => s.includes('bio_costing_profile'))).toBe(false);
  });
});
