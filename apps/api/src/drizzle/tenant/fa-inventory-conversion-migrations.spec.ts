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

describe('Tenant migration 0231 — the FA to inventory conversion request (additive)', () => {
  it('is journalled at idx 228 after the costing profile drop', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 228)!;
    expect(e.tag).toBe('0231_fa_inventory_conversion');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 227)!.when);
  });

  it('only creates one table, with one open request per animal enforced by the database', () => {
    const sql = statements('0231_fa_inventory_conversion');
    expect(sql[0]).toMatch(/^CREATE TABLE `fa_inventory_conversion`/);
    expect(sql[0]).toContain('CONSTRAINT `uq_fa_conversion_active` UNIQUE(`active_key`)');
    expect(sql[0]).toContain('`market_value` decimal(18,4)');
    expect(sql[0]).toContain('`bc_fa_ledger_entry_no` varchar(40)');
    expect(sql.filter((s) => /^CREATE TABLE/.test(s))).toHaveLength(1);
    const withoutFkActions = sql.map((s) => s.replace(/ON DELETE \w+ ON UPDATE [\w ]+;?/gi, '').replace(/ON UPDATE CURRENT_TIMESTAMP/gi, ''));
    expect(withoutFkActions.some((s) => /\bDROP\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bALTER TABLE `(?!fa_inventory_conversion)/i.test(s))).toBe(false);
  });
});
