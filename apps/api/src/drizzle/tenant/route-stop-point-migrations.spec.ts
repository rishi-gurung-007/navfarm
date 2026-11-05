import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableConfig } from 'drizzle-orm/mysql-core';
import { logisticsRouteStop } from '../../core/database/schema';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{
  idx: number;
  when: number;
  tag: string;
}>;
const sql = readFileSync(join(dir, '0239_route_stop_point.sql'), 'utf8');

describe('Tenant migration 0239 — a route stop carries its own name and point', () => {
  it("is numbered and timed past Arun's unmerged 0238 on feat/system-schedulers (…106)", () => {
    const entry = journal.find((e) => e.tag === '0239_route_stop_point')!;
    expect(entry.when).toBe(1792000000107);
    expect(journal.filter((e) => e.when === entry.when)).toHaveLength(1);
    expect(Math.max(...journal.map((e) => e.when))).toBe(entry.when);
  });

  it('adds the stop name and point, and nothing else', () => {
    const added = [...sql.matchAll(/ALTER TABLE `([^`]+)` ADD `([^`]+)`/g)].map((m) => `${m[1]}.${m[2]}`);
    expect(added).toEqual([
      'logistics_route_stop.stop_name',
      'logistics_route_stop.latitude',
      'logistics_route_stop.longitude',
    ]);
  });

  // The Zone column is relaxed, never dropped: stops recorded against a zone before this must still read back.
  it('relaxes the zone rather than dropping it', () => {
    expect(sql).toMatch(/MODIFY `zone_id` varchar\(36\) NULL/);
    expect(sql).not.toMatch(/^\s*(ALTER TABLE .*)?DROP\b/im);
    const { columns } = getTableConfig(logisticsRouteStop);
    expect(columns.find((c) => c.name === 'zone_id')!.notNull).toBe(false);
  });

  it('declares the three new columns in the schema the migration creates', () => {
    const { columns } = getTableConfig(logisticsRouteStop);
    for (const name of ['stop_name', 'latitude', 'longitude']) {
      expect(columns.map((c) => c.name)).toContain(name);
    }
  });
});
