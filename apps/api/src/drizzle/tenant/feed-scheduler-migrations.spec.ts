import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const tag = '0167_feed_scheduler';
const sql = () => readFileSync(join(dir, `${tag}.sql`), 'utf8');
const statements = () =>
  sql()
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () => JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;

describe('Tenant migration 0167 — feed scheduler settings and run log (additive)', () => {
  it('is journalled at idx 166 with when 1792000000035, after every earlier entry', () => {
    const entries = journal();
    expect(entries.find((e) => e.tag === tag)).toEqual({ idx: 166, version: '5', when: 1792000000035, tag, breakpoints: true });
    for (const e of entries.filter((x) => x.idx < 166)) expect(1792000000035).toBeGreaterThan(e.when);
  });

  it('adds the tentative-plan schedule to Feed Planning Settings as nullable columns (no default day or time)', () => {
    expect(statements().slice(0, 2)).toEqual([
      'ALTER TABLE `feed_planning_setting` ADD `tentative_plan_weekday` int;',
      'ALTER TABLE `feed_planning_setting` ADD `tentative_plan_time` varchar(5);',
    ]);
  });

  it('creates feed_schedule_log with a unique run key, and nothing is dropped or narrowed', () => {
    expect(sql()).toContain('CREATE TABLE `feed_schedule_log`');
    expect(sql()).toContain('CONSTRAINT `uq_feed_schedule_log_run_key` UNIQUE(`run_key`)');
    expect(sql().replace(/^--.*$/gm, '')).not.toMatch(/\b(?:DROP|DELETE|TRUNCATE|MODIFY|RENAME)\b/i);
  });
});
