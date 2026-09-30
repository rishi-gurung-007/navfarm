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

/**
 * D36 (Rishi, 28 Sep): FLUSH's latest day is 5, not the 14 Plan S's S7 set.
 * Migration 0131 moves it on system rows only where it is still 14 — written
 * here, applied to real tenants by the controller.
 */
describe('migration 0131 — FLUSH latest day 14 → 5 on system rows (D36)', () => {
  const sql = statements('0131_flush_latest_day')[0];

  it('is journalled after 0130, strictly increasing', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    expect(journal.find((e) => e.idx === 131)).toEqual({ idx: 131, version: '5', when: 1792000000000, tag: '0131_flush_latest_day', breakpoints: true });
    const whens = journal.map((e) => e.when);
    expect(whens.every((w, i) => i === 0 || w > whens[i - 1])).toBe(true);
  });

  it('updates system FLUSH stages at 14 to 5, and nothing else', () => {
    expect(statements('0131_flush_latest_day')).toHaveLength(1);
    expect(sql).toMatch(/^UPDATE `stage_master`/);
    expect(sql).toContain('`typical_duration_days` = 5');
    expect(sql).toContain('`is_system` = 1');
    expect(sql).toContain("`stage_code` = 'FLUSH'");
    expect(sql).toContain('`typical_duration_days` = 14');
    expect(sql).toContain('`deleted_at` IS NULL');
    expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
  });

  it('does not leave the demo seed writing FLUSH = 14 into fresh databases', () => {
    // The demo seed writes DEMO_STAGE_DURATIONS, so the two must agree here:
    // FLUSH is 5 (D36) and the seed's other lengths are untouched.
    expect(DEMO_STAGE_DURATIONS.FLUSH).toBe(5);
  });

  /**
   * 593d7c96 follow-up (controller brief, 28 Sep): lifecycle rows created
   * without company/nob/lob are invisible at company scope. Migration 0132
   * copies the breed's scope onto rows that have none — rows under a tenant
   * template breed (company NULL) and rows already carrying a scope are
   * untouched, and nothing else changes. Written and rehearsed here; applied
   * to real tenants by the controller.
   */
  it('migration 0132 stamps NULL-scope lifecycle rows from their breed, and nothing else', () => {
    const sql = statements('0132_lifecycle_scope_from_breed')[0];
    expect(statements('0132_lifecycle_scope_from_breed')).toHaveLength(1);
    expect(sql).toMatch(/^UPDATE `breed_lifecycle_stages` l/);
    expect(sql).toContain('JOIN `breed_master` b ON b.`breed_id` = l.`breed_id`');
    expect(sql).toContain('l.`company_id` = b.`company_id`');
    expect(sql).toContain('l.`nob_id` = b.`nob_id`');
    expect(sql).toContain('l.`lob_id` = b.`lob_id`');
    expect(sql).toContain('l.`company_id` IS NULL');
    expect(sql).toContain('b.`company_id` IS NOT NULL');
    expect(sql).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
    // Journal strictly increasing is asserted globally above (0131's entry);
    // 0132's `when` must land after 0131's.
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    expect(journal.find((e) => e.idx === 132)).toMatchObject({ idx: 132, tag: '0132_lifecycle_scope_from_breed', when: 1792000000001 });
  });
});

/**
 * D42 (Rishi, 29 Sep): a parent is not always registered in NAVFarm — a
 * purchased or imported animal arrives with its sire and dam named only on
 * paper — so the register keeps what the papers say beside the optional pickers.
 */
describe('migration 0134 — the parents\' serial numbers on animal_register (D42)', () => {
  it('is journalled after 0133, strictly increasing', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    expect(journal.find((e) => e.idx === 134)).toEqual({ idx: 134, version: '5', when: 1792000000003, tag: '0134_animal_parent_serial_no', breakpoints: true });
    const whens = journal.map((e) => e.when);
    expect(whens.every((w, i) => i === 0 || w > whens[i - 1])).toBe(true);
  });

  it('adds exactly the two nullable columns, and nothing else', () => {
    const sql = statements('0134_animal_parent_serial_no');
    expect(sql).toHaveLength(2);
    expect(sql[0]).toBe('ALTER TABLE `animal_register` ADD `sire_serial_no` varchar(100);');
    expect(sql[1]).toBe('ALTER TABLE `animal_register` ADD `dam_serial_no` varchar(100);');
    // Nullable: every existing animal keeps a row that is still valid.
    expect(sql.join(' ')).not.toMatch(/NOT NULL|DEFAULT|UPDATE|DROP/i);
  });
});

describe('Plan S data migrations (D21–D23)', () => {
  it('are journalled after 0122, a day apart', () => {
    const journal = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<{ idx: number; when: number; tag: string }>;
    // Looked up by idx, not by position: Task 20a appends 0126 after these,
    // and later work will append more.
    const at = (idx: number) => {
      const entry = journal.find((e) => e.idx === idx)!;
      return [entry.idx, entry.when, entry.tag];
    };
    expect([122, 123, 124, 125, 126].map(at)).toEqual([
      [122, 1791222000000, '0122_approval_request_farm_document'],
      [123, 1791308400000, TAGS[0]],
      [124, 1791394800000, TAGS[1]],
      [125, 1791481200000, TAGS[2]],
      [126, 1791567600000, '0126_clear_legacy_silo_storage_type'],
    ]);
    // Strictly increasing, so the migrator's order is the order intended.
    const whens = journal.map((e) => e.when);
    expect(whens.every((w, i) => i === 0 || w > whens[i - 1])).toBe(true);
  });

  it('clears the legacy silo storage type on non-silo rows only (D28, 0126)', () => {
    const sql = statements('0126_clear_legacy_silo_storage_type');
    expect(sql).toHaveLength(1);
    expect(sql[0]).toMatch(/^UPDATE /);
    expect(sql[0]).toContain("`storage_type` = 'SILO'");
    expect(sql[0]).toContain("`location_type` NOT IN ('SILO', 'STORE')");
    expect(sql[0]).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER|INSERT)\b/i);
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
    // FLUSH is excluded: 0125 is already applied and its text is historical —
    // D36 moved FLUSH to 5 in the seed and in migration 0131, not retroactively here.
    for (const [code, days] of Object.entries(DEMO_STAGE_DURATIONS)) {
      if (code === 'FLUSH') expect(durations).toContain("WHEN 'FLUSH' THEN 14");
      else expect(durations).toContain(`WHEN '${code}' THEN ${days}`);
    }
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
