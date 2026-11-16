import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0256 — Logistics Phase 2 trips', () => {
  it('is journalled at a `when` past every earlier entry, and shares its number with nothing', () => {
    const entry = journal.find((e) => e.tag === '0256_logistics_trips')!;
    expect(entry).toBeDefined();
    expect(entry.when).toBe(1792000000124);
    // Past every migration numbered before it (0257 follows it on this branch).
    const earlier = journal.filter((e) => e.idx < entry.idx);
    expect(earlier.every((e) => e.when < entry.when)).toBe(true);
    expect(journal.filter((e) => e.tag.startsWith('0256_'))).toHaveLength(1);
  });

  it('is numbered after every other branch: journal idx is contiguous', () => {
    journal.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it('creates the three trip tables with a unique (tenant_id, company_id, trip_no)', () => {
    const sql = readFileSync(join(dir, '0256_logistics_trips.sql'), 'utf8');
    const created = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    expect(created).toEqual(['logistics_trip', 'logistics_trip_line', 'logistics_trip_cost']);
    expect(sql).toMatch(/UNIQUE\(`tenant_id`,`company_id`,`trip_no`\)/);
  });

  it('adds nullable stock_transfer.trip_id and an index, and destroys nothing', () => {
    const sql = readFileSync(join(dir, '0256_logistics_trips.sql'), 'utf8');
    expect(sql).toMatch(/ALTER TABLE `stock_transfer` ADD `trip_id` varchar\(36\) NULL/);
    expect(sql).toMatch(/CREATE INDEX `idx_stock_transfer_trip` ON `stock_transfer` \(/);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|UPDATE)\b/i);
  });
});
