import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const tag = '0150_mill_bin_location_foundation';
const read = () => readFileSync(join(dir, `${tag}.sql`), 'utf8');
const statements = () => read()
  .split('--> statement-breakpoint')
  .map((statement) => statement.replace(/^--.*$/gm, '').trim())
  .filter(Boolean);

describe('Tenant migration 0150 — MILL/BIN location foundation', () => {
  it('uses the next free journal index and a timestamp after 0149', () => {
    const entries = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<Record<string, unknown>>;
    expect(entries.find((entry) => entry.idx === 150)).toEqual({
      idx: 150,
      version: '5',
      when: 1792000000019,
      tag,
      breakpoints: true,
    });
    expect(entries.find((entry) => entry.idx === 146)).toBeUndefined();
  });

  it('adds nullable canonical-KG MILL and BIN columns without destructive SQL', () => {
    const sql = read();
    for (const column of [
      'mill_daily_capacity_kg',
      'mill_hourly_capacity_kg',
      'mill_bulk_daily_allocation_kg',
      'mill_bagged_daily_allocation_kg',
      'bin_capacity_kg',
    ]) {
      expect(sql).toContain(`ALTER TABLE \`location_master\` ADD \`${column}\` decimal(14,2)`);
    }
    expect(sql).toContain('ALTER TABLE `location_master` ADD `bin_feed_type` varchar(10)');
    for (const statement of statements()) {
      expect(statement).not.toMatch(/^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b)/i);
      expect(statement).not.toMatch(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i);
    }
  });

  it('creates company-scoped Production Slots with scoped Code uniqueness', () => {
    const sql = read();
    expect(sql).toContain('CREATE TABLE `production_slot_master`');
    expect(sql).toContain('`slot_code` varchar(50) NOT NULL');
    expect(sql).toContain('`slot_name` varchar(100) NOT NULL');
    expect(sql).toContain('`start_time` time NOT NULL');
    expect(sql).toContain('`end_time` time NOT NULL');
    expect(sql).toContain('CONSTRAINT `uq_prod_slot_scope_code` UNIQUE(`tenant_id`,`company_id`,`slot_code`)');
    expect(sql).toContain('FOREIGN KEY (`company_id`) REFERENCES `company_master`(`company_id`)');
  });

  it('creates effective BIN Diet Assignments with exact uniqueness and required foreign keys', () => {
    const sql = read();
    expect(sql).toContain('CREATE TABLE `bin_diet_assignment`');
    expect(sql).toContain('CONSTRAINT `uq_bin_diet_date_slot` UNIQUE(`bin_location_id`,`production_date`,`production_slot_id`)');
    expect(sql).toContain('FOREIGN KEY (`bin_location_id`) REFERENCES `location_master`(`location_id`)');
    expect(sql).toContain('FOREIGN KEY (`feed_item_id`) REFERENCES `item_master`(`item_id`)');
    expect(sql).toContain('FOREIGN KEY (`production_slot_id`) REFERENCES `production_slot_master`(`slot_id`)');
  });
});
