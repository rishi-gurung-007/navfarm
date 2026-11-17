import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0257 — Logistics Phase 1 masters', () => {
  // Not "it is the newest" any more — 0258 follows it. What has to hold is that it sits past
  // origin's 0214–0253 (…121; renumbered from 0228 when origin/main was merged, 16 Nov) and shares its number and `when` with nothing else on any branch.
  it('is journalled at a `when` past origin\'s 0214–0253 (…121), and shares it with nothing', () => {
    const entry = journal.find((e) => e.tag === '0257_logistics_masters')!;
    expect(entry.when).toBe(1792000000125);
    expect(journal.filter((e) => e.when === entry.when)).toHaveLength(1);
    expect(journal.filter((e) => e.tag.startsWith('0257_'))).toHaveLength(1);
  });

  it('only adds the nine logistics tables', () => {
    const sql = readFileSync(join(dir, '0257_logistics_masters.sql'), 'utf8');
    const created = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    expect(created).toEqual([
      'logistics_vehicle', 'logistics_vehicle_document', 'logistics_driver', 'logistics_delivery_zone', 'logistics_route',
      'logistics_route_stop', 'logistics_freight_rate', 'logistics_service_plan', 'logistics_setting',
    ]);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|UPDATE)\b/i);
  });
});
