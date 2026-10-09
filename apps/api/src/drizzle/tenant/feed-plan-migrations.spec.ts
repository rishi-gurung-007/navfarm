import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationsDir = join(__dirname);
const tag = '0154_feed_plan_versions';

describe('Tenant migration 0154 — retained weekly Feed Plan versions', () => {
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'));

  it('is journalled after the feed forecast archive migration', () => {
    const entry = journal.entries.find((candidate: { tag: string }) => candidate.tag === tag);
    expect(entry).toMatchObject({ idx: 154, tag });
    expect(journal.entries.find((candidate: { tag: string }) => candidate.tag === '0153_feed_forecast_run_archive')).toBeTruthy();
  });

  it('adds retained plan headers and item lines without modifying existing tables', () => {
    expect(sql).toContain('CREATE TABLE `feed_plan`');
    expect(sql).toContain('CREATE TABLE `feed_plan_line`');
    expect(sql).toContain('`plan_type` varchar(20) NOT NULL');
    expect(sql).toContain('`history_snapshot` json NOT NULL');
    expect(sql).not.toMatch(/^\s*(?:ALTER|DROP|DELETE|TRUNCATE)\b/im);
  });
});

describe('Tenant migration 0155 — feed mill consolidation', () => {
  const tag = '0155_feed_mill_consolidation';
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'));

  it('is journalled after the retained Feed Plan migration', () => {
    expect(journal.entries.find((candidate: { tag: string }) => candidate.tag === tag)).toMatchObject({ idx: 155, tag });
  });

  it('adds consolidation headers and lines without destructive statements', () => {
    expect(sql).toContain('CREATE TABLE `feed_consolidation`');
    expect(sql).toContain('CREATE TABLE `feed_consolidation_line`');
    expect(sql).toContain('ALTER TABLE `requisition` ADD `feed_consolidation_id`');
    expect(sql).not.toMatch(/^(?:\s*)(?:DROP|DELETE|TRUNCATE)\b/im);
  });
});

describe('Tenant migration 0156 — consolidation line source snapshots', () => {
  const tag = '0156_feed_consolidation_line_snapshots';
  const sql = readFileSync(join(migrationsDir, `${tag}.sql`), 'utf8');
  const journal = JSON.parse(readFileSync(join(migrationsDir, 'meta/_journal.json'), 'utf8'));

  it('is journalled after the consolidation migration', () => {
    expect(journal.entries.find((candidate: { tag: string }) => candidate.tag === tag)).toMatchObject({ idx: 156, tag });
  });

  it('preserves silo and date references without destructive statements', () => {
    expect(sql).toContain('ADD `destination_silo_id`');
    expect(sql).toContain('ADD `requested_delivery_date`');
    expect(sql).toContain('ADD `production_date`');
    expect(sql).not.toMatch(/^(?:\s*)(?:DROP|DELETE|TRUNCATE)\b/im);
  });
});
