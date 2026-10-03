import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const read = (tag: string) => readFileSync(join(dir, `${tag}.sql`), 'utf8');
const statements = (tag: string) =>
  read(tag)
    .split('--> statement-breakpoint')
    .map((s) => s.replace(/^--.*$/gm, '').trim())
    .filter(Boolean);

describe('Tenant Migrations 0135–0140 (Feed Forecast, Stock Count, Requisitions, Transfers)', () => {
  const journalPath = join(dir, 'meta/_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')).entries as Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;

  it('journals 0135 through 0140 with strictly increasing timestamps and indices', () => {
    const expected = [
      { idx: 135, version: '5', when: 1792000000004, tag: '0135_feed_planning_settings', breakpoints: true },
      { idx: 136, version: '5', when: 1792000000005, tag: '0136_feed_forecast_run', breakpoints: true },
      { idx: 137, version: '5', when: 1792000000006, tag: '0137_feed_stock_count', breakpoints: true },
      { idx: 138, version: '5', when: 1792000000007, tag: '0138_common_requisition', breakpoints: true },
      { idx: 139, version: '5', when: 1792000000008, tag: '0139_transfer_execution_events', breakpoints: true },
      { idx: 140, version: '5', when: 1792000000009, tag: '0140_alert_role_normalization', breakpoints: true },
    ];

    expected.forEach((entry) => {
      const match = journal.find((e) => e.idx === entry.idx);
      expect(match).toEqual(entry);
    });

    const whens = journal.map((e) => e.when);
    expect(whens.every((w, i) => i === 0 || w > whens[i - 1])).toBe(true);

    // Contiguity is checked over 0135–0140 only (what this spec describes), not the
    // whole journal file: 0147 (Part E) deliberately leaves 0146 unjournalled for the
    // deferred feed-era drop, whose `when` must land after 0147's — see
    // part-e-migrations.spec.ts. The full-journal check held only by coincidence before.
    const indices = expected.map((entry) => entry.idx);
    expect(indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1)).toBe(true);
  });

  it('contains strictly additive statements without destructive DDL (no DROP/DELETE FROM/TRUNCATE)', () => {
    const tags = [
      '0135_feed_planning_settings',
      '0136_feed_forecast_run',
      '0137_feed_stock_count',
      '0138_common_requisition',
      '0139_transfer_execution_events',
      '0140_alert_role_normalization',
    ];

    for (const tag of tags) {
      const sqlList = statements(tag);
      expect(sqlList.length).toBeGreaterThan(0);
      for (const sql of sqlList) {
        expect(sql).not.toMatch(/^\s*(DROP\b|TRUNCATE\b|DELETE\s+FROM\b)/i);
        expect(sql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|DATABASE|INDEX)\b/i);
      }
    }
  });

  describe('migration 0135: feed planning settings and company currency config', () => {
    it('adds is_local and unique constraint to company_currency_config', () => {
      const sqlList = statements('0135_feed_planning_settings');
      expect(sqlList[0]).toMatch(/ALTER TABLE `company_currency_config` ADD `is_local` boolean NOT NULL DEFAULT false/);
      expect(sqlList[1]).toMatch(/ALTER TABLE `company_currency_config` ADD CONSTRAINT `uq_company_currency_config_company_currency` UNIQUE\(`company_id`,\s*`currency_id`\)/);
    });

    it('creates feed_planning_setting with generated active_scope_key and unique constraint', () => {
      const content = read('0135_feed_planning_settings');
      expect(content).toContain('CREATE TABLE `feed_planning_setting`');
      expect(content).toContain('`active_scope_key` varchar(38) GENERATED ALWAYS AS');
      expect(content).toContain('CONSTRAINT `uq_feed_planning_setting_active_scope` UNIQUE(`company_id`,`active_scope_key`)');
      expect(content).toContain('CREATE INDEX `idx_feed_planning_setting_company` ON `feed_planning_setting` (`company_id`)');
    });
  });

  describe('migration 0136: reporting period draft defaults and feed forecast runs', () => {
    it('alters reporting_period defaults to is_active false and status DRAFT', () => {
      const sqlList = statements('0136_feed_forecast_run');
      expect(sqlList[0]).toMatch(/ALTER TABLE `reporting_period` ALTER COLUMN `is_active` SET DEFAULT false/);
      expect(sqlList[1]).toMatch(/ALTER TABLE `reporting_period` ALTER COLUMN `status` SET DEFAULT 'DRAFT'/);
    });

    it('creates feed_forecast_run and feed_forecast_run_line with snapshots and indexes', () => {
      const content = read('0136_feed_forecast_run');
      expect(content).toContain('CREATE TABLE `feed_forecast_run`');
      expect(content).toContain('`source_snapshot` json NOT NULL');
      expect(content).toContain('`output_snapshot` json NOT NULL');
      expect(content).toContain('`config_snapshot` json NOT NULL');
      expect(content).toContain('CONSTRAINT `uq_feed_forecast_run_farm_version` UNIQUE(`farm_id`,`version`)');
      expect(content).toContain('CONSTRAINT `uq_feed_forecast_run_company_code` UNIQUE(`company_id`,`run_code`)');
      expect(content).toContain('CREATE TABLE `feed_forecast_run_line`');
      expect(content).toContain('`provenance_snapshot` json NOT NULL');
      expect(content).toContain('CREATE INDEX `idx_feed_forecast_run_line_run`');
    });
  });

  describe('migration 0137: feed stock count and cutoff index', () => {
    it('creates feed_stock_count and feed_stock_count_line', () => {
      const content = read('0137_feed_stock_count');
      expect(content).toContain('CREATE TABLE `feed_stock_count`');
      expect(content).toContain('CONSTRAINT `uq_feed_stock_count_occurrence` UNIQUE(`farm_id`,`counted_at`)');
      expect(content).toContain('CONSTRAINT `uq_feed_stock_count_company_no` UNIQUE(`company_id`,`count_no`)');
      expect(content).toContain('CREATE TABLE `feed_stock_count_line`');
      expect(content).toContain('CONSTRAINT `uq_feed_stock_count_line_silo_item` UNIQUE(`count_id`,`silo_id`,`item_id`)');
    });

    it('creates index idx_inventory_ledger_count_cutoff on inventory_ledger', () => {
      const content = read('0137_feed_stock_count');
      expect(content).toContain('CREATE INDEX `idx_inventory_ledger_count_cutoff` ON `inventory_ledger` (`tenant_id`,`company_id`,`warehouse_id`,`posting_date`,`created_at`)');
    });
  });

  describe('migration 0138: common requisition extensions and backfill', () => {
    it('adds department_id to user_master and location_master', () => {
      const content = read('0138_common_requisition');
      expect(content).toContain('ALTER TABLE `user_master` ADD `department_id` varchar(36)');
      expect(content).toContain('ALTER TABLE `location_master` ADD `department_id` varchar(36)');
    });

    it('adds header and line fields to requisition and requisition_line', () => {
      const content = read('0138_common_requisition');
      expect(content).toContain('ALTER TABLE `requisition` ADD `approval_status` varchar(30)');
      expect(content).toContain('ALTER TABLE `requisition` ADD `document_status` varchar(30)');
      expect(content).toContain('ALTER TABLE `requisition` ADD `fulfilment_status` varchar(40)');
      expect(content).toContain('ALTER TABLE `requisition` ADD `integration_status` varchar(40)');
      expect(content).toContain('ALTER TABLE `requisition` ADD `direct_transfer` boolean');
      expect(content).toContain('ALTER TABLE `requisition` ADD `feed_forecast_run_id` varchar(36)');
      expect(content).toContain('ALTER TABLE `requisition_line` ADD `feed_forecast_run_line_ids` json');
      expect(content).toContain('ALTER TABLE `requisition_line` ADD `qty_to_ship` decimal(18,4)');
      expect(content).toContain('ALTER TABLE `requisition_line` ADD `qty_shipped` decimal(18,4)');
    });

    it('backfills legacy requisition status rows into projected status dimensions', () => {
      const content = read('0138_common_requisition');
      expect(content).toContain('UPDATE `requisition` SET');
      expect(content).toContain("WHEN `status` = 'PENDING_APPROVAL' THEN 'PENDING_APPROVAL'");
      expect(content).toContain("WHEN `status` = 'APPROVED' THEN 'APPROVED'");
      expect(content).toContain("WHEN `status` = 'REJECTED' THEN 'REJECTED'");
      expect(content).toContain("`fulfilment_status` = 'NOT_APPLICABLE'");
      expect(content).toContain("`integration_status` = 'NOT_APPLICABLE'");
      expect(content).toContain('WHERE `approval_status` IS NULL');
    });
  });

  describe('migration 0139: staged transfer execution events', () => {
    it('creates tracking assignment, shipment, and receipt tables', () => {
      const content = read('0139_transfer_execution_events');
      expect(content).toContain('CREATE TABLE `stock_transfer_tracking_assignment`');
      expect(content).toContain('CREATE TABLE `transfer_shipment`');
      expect(content).toContain('CREATE TABLE `transfer_shipment_line`');
      expect(content).toContain('CREATE TABLE `transfer_receipt`');
      expect(content).toContain('CREATE TABLE `transfer_receipt_line`');
    });
  });

  describe('migration 0140: alert role normalization', () => {
    it('normalizes HEAD_OF_FARM to OPERATIONAL_ADMIN in alert_rule and feed_alert', () => {
      const content = read('0140_alert_role_normalization');
      expect(content).toContain("UPDATE `alert_rule`\n   SET `escalation_role` = 'OPERATIONAL_ADMIN'");
      expect(content).toContain("UPDATE `alert_rule`\n   SET `recipient_roles` = CAST(REPLACE(CAST(`recipient_roles` AS CHAR), '\"HEAD_OF_FARM\"', '\"OPERATIONAL_ADMIN\"') AS JSON)");
      expect(content).toContain("UPDATE `feed_alert`\n   SET `escalation_role` = 'OPERATIONAL_ADMIN'");
      expect(content).toContain("UPDATE `feed_alert`\n   SET `recipient_roles` = CAST(REPLACE(CAST(`recipient_roles` AS CHAR), '\"HEAD_OF_FARM\"', '\"OPERATIONAL_ADMIN\"') AS JSON)");
    });
  });
});
