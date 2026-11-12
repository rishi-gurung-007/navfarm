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

describe("Tenant migration 0247 — the client's QC Parameter Master fields (additive)", () => {
  it('is journalled at idx 244, after the fair value loss account migration', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 244)!;
    expect(e.tag).toBe('0247_qc_parameter_client_fields');
    expect(e.breakpoints).toBe(true);
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 243)!.when);
  });

  it('adds Target Value, lets Line of Business be empty and makes QC Code unique per company', () => {
    expect(statements('0247_qc_parameter_client_fields')).toEqual([
      'ALTER TABLE `qc_parameter_master` ADD `target_value` decimal(18,4);',
      'ALTER TABLE `qc_parameter_master` MODIFY `lob_id` varchar(36);',
      'CREATE UNIQUE INDEX `uq_qc_parameter_company_code` ON `qc_parameter_master` (`tenant_id`,`company_id`,`param_code`);',
    ]);
  });
});

describe('Tenant migration 0248 — item QC specification lines taken from the QC Parameter Master (additive)', () => {
  it('is journalled at idx 245, after 0247', () => {
    const entries = journal();
    const e = entries.find((x) => x.idx === 245)!;
    expect(e.tag).toBe('0248_item_qc_spec_from_parameter');
    expect(e.when).toBeGreaterThan(entries.find((x) => x.idx === 244)!.when);
  });

  it('links a spec line to its parameter and carries the Target Value to the spec and inspection lines', () => {
    expect(statements('0248_item_qc_spec_from_parameter')).toEqual([
      'ALTER TABLE `item_qc_spec_line` ADD `param_id` varchar(36);',
      'ALTER TABLE `item_qc_spec_line` ADD `target_value` decimal(18,4);',
      'ALTER TABLE `item_qc_spec_line` ADD CONSTRAINT `fk_iqsl_qc_param` FOREIGN KEY (`param_id`) REFERENCES `qc_parameter_master`(`param_id`) ON DELETE restrict ON UPDATE no action;',
      'ALTER TABLE `qc_inspection_line` ADD `target_value` decimal(18,4);',
    ]);
  });
});
