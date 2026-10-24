import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = __dirname;
const journal = JSON.parse(
  readFileSync(join(dir, 'meta/_journal.json'), 'utf8'),
).entries as Array<{
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}>;

describe('Tenant migration 0211 — stock transfer vehicle identity', () => {
  it('is journalled after the GRN repair migration', () => {
    expect(journal.find((entry) => entry.idx === 208)).toEqual({
      idx: 208,
      version: '5',
      when: 1792000000079,
      tag: '0211_stock_transfer_vehicle_no',
      breakpoints: true,
    });
  });

  it('adds the vehicle identity without destructive operations', () => {
    const sql = readFileSync(
      join(dir, '0211_stock_transfer_vehicle_no.sql'),
      'utf8',
    );
    expect(sql).toContain(
      'ALTER TABLE `stock_transfer` ADD `vehicle_no` varchar(80);',
    );
    expect(sql).not.toMatch(/\b(DROP TABLE|DELETE FROM|TRUNCATE)\b/i);
  });
});
