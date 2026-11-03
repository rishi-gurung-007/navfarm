import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0228 — Logistics Phase 1 masters', () => {
  it('is journalled after every other migration, at a `when` past Arun\'s unmerged 0214–0227 (…095)', () => {
    const entry = journal.find((e) => e.tag === '0228_logistics_masters')!;
    expect(entry.when).toBe(1792000000096);
    expect(Math.max(...journal.map((e) => e.when))).toBe(entry.when);
  });

  it('only adds the nine logistics tables', () => {
    const sql = readFileSync(join(dir, '0228_logistics_masters.sql'), 'utf8');
    const created = [...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1]);
    expect(created).toEqual([
      'logistics_vehicle', 'logistics_vehicle_document', 'logistics_driver', 'logistics_delivery_zone', 'logistics_route',
      'logistics_route_stop', 'logistics_freight_rate', 'logistics_service_plan', 'logistics_setting',
    ]);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|UPDATE)\b/i);
  });
});
