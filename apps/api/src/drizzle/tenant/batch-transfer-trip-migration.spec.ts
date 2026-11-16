import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
const sql = readFileSync(join(dir, '0257_batch_transfer_trip.sql'), 'utf8');

describe('Tenant migration 0257 — a trip for a cross-farm batch transfer', () => {
  it('is journalled past every earlier entry and shares its number with nothing', () => {
    const entry = journal.find((e) => e.tag === '0257_batch_transfer_trip')!;
    expect(entry).toBeDefined();
    expect(entry.when).toBe(1792000000125);
    expect(journal.filter((e) => e.tag !== entry.tag).every((e) => e.when < entry.when)).toBe(true);
    expect(journal.filter((e) => e.tag.startsWith('0257_'))).toHaveLength(1);
    journal.forEach((e, i) => expect(e.idx).toBe(i));
  });

  it('adds a nullable batch_transfer.trip_id and trip-line batch_transfer_id, and frees transfer_id', () => {
    expect(sql).toMatch(/ALTER TABLE `batch_transfer` ADD `trip_id` varchar\(36\) NULL/);
    expect(sql).toMatch(/ALTER TABLE `logistics_trip_line` ADD `batch_transfer_id` varchar\(36\) NULL/);
    expect(sql).toMatch(/ALTER TABLE `logistics_trip_line` MODIFY COLUMN `transfer_id` varchar\(36\) NULL/);
  });

  it('only adds: no drop, no delete, no rewrite of existing rows', () => {
    expect(sql).not.toMatch(/DROP |DELETE |UPDATE |TRUNCATE /i);
  });
});
