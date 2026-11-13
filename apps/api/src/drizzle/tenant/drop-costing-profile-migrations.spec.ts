import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const statements = (tag: string) =>
  readFileSync(join(dir, `${tag}.sql`), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);
const journal = () =>
  JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;

describe('Tenant migration 0230 — the costing profile is dropped (guarded)', () => {
  const sql = statements('0230_drop_costing_profile');

  it('is journalled at idx 227 after the run-item migration', () => {
    const entries = journal();
    expect(entries.find((e) => e.idx === 227)).toEqual({ idx: 227, version: '5', when: 1792000000098, tag: '0230_drop_costing_profile', breakpoints: true });
    expect(entries.find((e) => e.idx === 227)!.when).toBeGreaterThan(entries.find((e) => e.idx === 226)!.when);
  });

  it('starts with a guard that fails, before anything is dropped, while a live animal is costed only by a profile or an old profile run waits to be posted', () => {
    const firstDrop = sql.findIndex((s, i) => i > 0 && /^(ALTER TABLE|DROP TABLE `bio_|DROP INDEX)/.test(s));
    const guard = sql.slice(0, firstDrop);
    expect(guard.some((s) => /^CREATE TABLE `_costing_profile_drop_guard` \(`run_db_move_profiles_to_items_first` int NOT NULL\)/.test(s))).toBe(true);
    const inserts = guard.filter((s) => s.startsWith('INSERT INTO `_costing_profile_drop_guard` SELECT NULL'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0]).toContain('a.`costing_profile_id` IS NOT NULL');
    expect(inserts[0]).toContain('i.`bio_costing_method` IS NULL');
    expect(inserts[1]).toContain("`status` = 'CALCULATED' AND `item_id` IS NULL");
    expect(guard[guard.length - 1]).toBe('DROP TABLE `_costing_profile_drop_guard`;');
  });

  it('then drops exactly the two columns (with their keys and index) and the three tables, and touches no data', () => {
    expect(sql).toEqual(expect.arrayContaining([
      'ALTER TABLE `animal_register` DROP FOREIGN KEY `fk_animal_costing_profile`;',
      'ALTER TABLE `animal_register` DROP INDEX `fk_animal_costing_profile`;',
      'ALTER TABLE `animal_register` DROP COLUMN `costing_profile_id`;',
      'ALTER TABLE `bio_costing_run` DROP FOREIGN KEY `fk_bcr_profile`;',
      'DROP INDEX `idx_bio_costing_run_profile` ON `bio_costing_run`;',
      'ALTER TABLE `bio_costing_run` DROP COLUMN `profile_id`;',
      'DROP TABLE `bio_costing_profile_rate`;',
      'DROP TABLE `bio_costing_profile`;',
      'DROP TABLE `bio_costing_residual_setting`;',
    ]));
    expect(sql.some((s) => /^(UPDATE|DELETE|TRUNCATE)\b/i.test(s))).toBe(false);
  });

  it('drops the rate table before the profile it points at', () => {
    expect(sql.indexOf('DROP TABLE `bio_costing_profile_rate`;')).toBeLessThan(sql.indexOf('DROP TABLE `bio_costing_profile`;'));
  });
});
