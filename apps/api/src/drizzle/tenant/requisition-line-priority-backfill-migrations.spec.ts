import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
const sql = (tag: string) => readFileSync(join(dir, `${tag}.sql`), 'utf8');

describe('Tenant migration 0216 — feed lines drafted from a saved calculation take their priority', () => {
  it('journals after 0215 with a later `when`', () => {
    const at = (tag: string) => journal.find((e) => e.tag === tag)!;
    expect(at('0216_requisition_line_priority_backfill').idx).toBe(at('0215_accounting_period').idx + 1);
    expect(at('0216_requisition_line_priority_backfill').when).toBeGreaterThan(at('0215_accounting_period').when);
  });

  it('fills only feed lines with no priority, by requisitionPriority against the run planning date', () => {
    const fill = sql('0216_requisition_line_priority_backfill');
    expect(fill).toMatch(/UPDATE `requisition_line` rl/);
    expect(fill).toContain('JOIN `feed_forecast_run` fr ON fr.`run_id` = r.`feed_forecast_run_id`');
    expect(fill).toContain("r.`doc_type` = 'FEED'");
    expect(fill).toContain('rl.`priority` IS NULL');
    // Below the silo's low level first, then days to the first shortage: < 3 Critical, < 7 Warning, else Info.
    expect(fill).toMatch(/lm.`location_type` <> 'STORE' AND lm.`low_level_kg` IS NOT NULL AND rl.`system_balance_kg` <= lm.`low_level_kg` THEN 'CRITICAL_FIRST_PRIORITY'/);
    expect(fill).toContain("WHEN rl.`first_shortage_date` IS NULL THEN 'INFO'");
    expect(fill).toContain("DATEDIFF(rl.`first_shortage_date`, fr.`planning_date`) < 3 THEN 'CRITICAL'");
    expect(fill).toContain("DATEDIFF(rl.`first_shortage_date`, fr.`planning_date`) < 7 THEN 'WARNING'");
    expect(fill).toContain("ELSE 'INFO'");
    expect(fill).not.toMatch(/\b(DROP|DELETE FROM|TRUNCATE|ALTER)\b/i);
  });
});
