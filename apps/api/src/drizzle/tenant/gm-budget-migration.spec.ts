import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0258 — GM Dashboard Budget master', () => {
  it('is journalled last, with a `when` above every earlier entry and a contiguous idx', () => {
    const pos = journal.findIndex((e) => e.tag === '0258_gm_budget');
    expect(pos).toBeGreaterThan(0);
    const entry = journal[pos];
    expect(entry.idx).toBe(pos);
    expect(journal[pos - 1].idx).toBe(entry.idx - 1);
    expect(entry.when).toBeGreaterThan(Math.max(...journal.slice(0, pos).map((e) => e.when)));
    expect(journal.filter((e) => e.when === entry.when)).toHaveLength(1);
    expect(journal.filter((e) => e.tag.startsWith('0258_'))).toHaveLength(1);
  });

  it('only adds gm_budget with the agreed columns and a plain lookup index', () => {
    const sql = readFileSync(join(dir, '0258_gm_budget.sql'), 'utf8').replace(/^--.*$/gm, '');
    expect([...sql.matchAll(/CREATE TABLE `([^`]+)`/g)].map((m) => m[1])).toEqual(['gm_budget']);
    expect(sql).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|UPDATE)\b/i);
    for (const col of [
      'budget_id', 'tenant_id', 'company_id', 'period_id', 'farm_id', 'metric_code', 'amount_type', 'amount',
      'tolerance_pct', 'notes', 'is_active', 'created_by', 'updated_by', 'created_at', 'updated_at', 'deleted_at',
    ]) {
      expect(sql).toContain(`\`${col}\``);
    }
    expect(sql).toMatch(/`metric_code` varchar\(40\) NOT NULL/);
    expect(sql).toMatch(/`amount_type` varchar\(10\) NOT NULL/);
    expect(sql).toMatch(/`amount` decimal\(18,4\) NOT NULL/);
    expect(sql).toMatch(/`tolerance_pct` decimal\(6,2\)(?! NOT NULL)/);
    expect(sql).toMatch(/CREATE INDEX `idx_gm_budget_lookup` ON `gm_budget` \(`tenant_id`,`company_id`,`period_id`,`farm_id`\)/);
    expect(sql).not.toMatch(/UNIQUE/i);
  });
});
