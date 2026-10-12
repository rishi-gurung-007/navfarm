import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 0144 repairs the one mislabel the seeded BCS activity produced. It must only update, must name the exact
 * rows it means (the 'BCS' code, lines still called after the activity on BODY_WEIGHT), and be journalled
 * strictly after 0143. Its effect on real rows is proved against MySQL, not here.
 */
const sql = readFileSync(join(__dirname, '0144_bcs_metric_repair.sql'), 'utf8');
const statements = sql.split('--> statement-breakpoint').map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);

describe('migration 0144 — BCS metric repair', () => {
  it('is journalled after 0143, strictly increasing', () => {
    const journal = JSON.parse(readFileSync(join(__dirname, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    const entry = journal.find((e) => e.idx === 144);
    expect(entry?.tag).toBe('0144_bcs_metric_repair');
    expect(journal.map((e) => e.when).every((w, i, all) => i === 0 || w > all[i - 1])).toBe(true);
  });

  it('only updates, and only the exact mislabel', () => {
    expect(statements).toHaveLength(3);
    for (const s of statements) {
      expect(s).toMatch(/^UPDATE `/);
      expect(s).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
    }
    expect(statements[0]).toContain("`default_kpi_metric` = 'BCS'");
    for (const s of statements.slice(1)) {
      expect(s).toContain("`activity_name` = 'Body Condition Score (BCS)'");
      expect(s).toContain("`kpi_metric` = 'BODY_WEIGHT'");
      expect(s).toContain("`kpi_metric` = 'BCS_SCORE', `kpi_uom` = 'SCORE'");
    }
  });
});
