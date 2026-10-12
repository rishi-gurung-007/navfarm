import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from '../../core/database/schema';

const dir = __dirname;
const tag = '0159_feed_requisition_transfers';
const read = () => readFileSync(join(dir, `${tag}.sql`), 'utf8');

describe('Tenant migration 0152 — feed requisition transfer links', () => {
  it('journals the next migration after feed requisition reasons', () => {
    const entries = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8')).entries as Array<Record<string, unknown>>;
    expect(entries.find((entry) => entry.idx === 158)).toEqual({
      idx: 158,
      version: '5',
      when: 1792000000027,
      tag,
      breakpoints: true,
    });
  });

  it('creates an additive link table with the three required foreign keys', () => {
    const sql = read();
    expect(sql).toContain('CREATE TABLE `feed_requisition_transfer`');
    expect(sql).toContain('FOREIGN KEY (`requisition_id`) REFERENCES `requisition`(`requisition_id`) ON DELETE cascade');
    expect(sql).toContain('FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfer`(`transfer_id`) ON DELETE restrict');
    expect(sql).toContain('FOREIGN KEY (`bin_assignment_id`) REFERENCES `bin_diet_assignment`(`assignment_id`) ON DELETE restrict');
    expect(sql).not.toMatch(/\b(DROP|TRUNCATE|DELETE\s+FROM|INSERT\s+INTO|UPDATE)\b/i);
  });

  it('indexes requisition and assignment lookup and forbids duplicate transfer links', () => {
    const sql = read();
    expect(sql).toContain('CONSTRAINT `uq_feed_req_transfer_transfer` UNIQUE(`transfer_id`)');
    expect(sql).toContain('CONSTRAINT `uq_feed_req_transfer_pair` UNIQUE(`requisition_id`,`transfer_id`)');
    expect(sql).toContain('CREATE INDEX `idx_feed_req_transfer_tenant_requisition` ON `feed_requisition_transfer` (`tenant_id`,`requisition_id`)');
    expect(sql).toContain('CREATE INDEX `idx_feed_req_transfer_assignment` ON `feed_requisition_transfer` (`bin_assignment_id`)');
  });

  it('exposes the link through the Drizzle schema', () => {
    expect((schema as Record<string, unknown>).feedRequisitionTransfer).toBeDefined();
  });
});
