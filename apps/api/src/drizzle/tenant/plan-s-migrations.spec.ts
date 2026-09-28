import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEMO_NEXT_STAGES, DEMO_STAGE_DURATIONS, SILO_HIGH_LEVEL_PCT, SILO_LOW_LEVEL_PCT } from '../../core/database/demo-feed-defaults';

/**
 * Plan S, B2: the three data repairs run on testers' presentation data. They
 * must only fill what is empty, never delete or reshape anything, and use the
 * same values the demo seed uses. Their behaviour on real rows is proved in
 * the rehearsal (Task 21); this pins their text.
 */
const dir = __dirname;
const read = (tag: string) => readFileSync(join(dir, `${tag}.sql`), 'utf8');
const statements = (tag: string) => read(tag).split('--> statement-breakpoint').map((s) => s.replace(/^--.*$/gm, '').trim()).filter(Boolean);
const TAGS = ['0123_batch_shed_from_placement', '0124_silo_level_defaults', '0125_system_stage_timings'];

describe('Plan S data migrations (D21–D23)', () => {
  it('are journalled after 0122, a day apart', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    const tail = journal.slice(-4);
    expect(tail.map((e) => [e.idx, e.when, e.tag])).toEqual([
      [122, 1791222000000, '0122_approval_request_farm_document'],
      [123, 1791308400000, TAGS[0]],
      [124, 1791394800000, TAGS[1]],
      [125, 1791481200000, TAGS[2]],
    ]);
  });

  it('only UPDATE, and only where the column they set is still empty', () => {
    const guard: Record<string, string[]> = {
      [TAGS[0]]: ['b.`shed_id` IS NULL', 'b.`shed_id` IS NULL'],
      [TAGS[1]]: ['`high_level_kg` IS NULL', '`low_level_kg` IS NULL'],
      [TAGS[2]]: ['`typical_duration_days` IS NULL', 's.`next_stage_id` IS NULL'],
    };
    for (const tag of TAGS) {
      const list = statements(tag);
      expect(list).toHaveLength(guard[tag].length);
      list.forEach((sql, i) => {
        expect(sql).toMatch(/^UPDATE /);
        expect(sql).toContain(guard[tag][i]);
        expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
      });
    }
  });

  it('fill silo levels with the same percentages as the demo seed (D22, D27)', () => {
    const [high, low] = statements(TAGS[1]);
    expect(high).toContain(`* ${(SILO_HIGH_LEVEL_PCT / 100).toFixed(2)}`);
    expect(low).toContain(`* ${(SILO_LOW_LEVEL_PCT / 100).toFixed(2)}`);
    expect(high).toContain("`location_type` = 'SILO'");
  });

  it('fill stage timings with the same values as the demo seed (S7), on system stages only', () => {
    const [durations, next] = statements(TAGS[2]);
    for (const [code, days] of Object.entries(DEMO_STAGE_DURATIONS)) expect(durations).toContain(`WHEN '${code}' THEN ${days}`);
    for (const [code, successor] of Object.entries(DEMO_NEXT_STAGES)) expect(next).toContain(`WHEN '${code}' THEN '${successor}'`);
    expect(durations).toContain('`is_system` = 1');
    expect(next).toContain('s.`is_system` = 1');
  });

  it('set a batch shed only from a single shed, of the batch\'s own company and farm (D21)', () => {
    for (const sql of statements(TAGS[0])) {
      expect(sql).toContain('COUNT(DISTINCT');
      expect(sql).toContain("sh.`location_type` = 'SHED'");
      expect(sql).toContain('sh.`company_id` = b.`company_id`');
      expect(sql).toContain("NOT IN ('DEAD', 'SOLD', 'CULLED', 'SLAUGHTERED')");
    }
  });
});
