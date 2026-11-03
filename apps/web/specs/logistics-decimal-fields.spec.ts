import { readFileSync } from 'fs';
import { resolve } from 'path';
import { LOGISTICS_CONFIGS } from '@/modules/master-data/logistics-configs';

/**
 * The master form treats a number field with no `step` as whole numbers only,
 * so a freight rate of 2.50 or a latitude of -17.8272 could not be typed.
 * Every logistics number field whose column is decimal(p,s) with s > 0 states
 * a step with s decimals — read from migration 0228 itself, so the form and
 * the table cannot drift apart.
 */
const sql = readFileSync(resolve(__dirname, '../../api/src/drizzle/tenant/0228_logistics_masters.sql'), 'utf8');

function decimalScales(): Map<string, number> {
  const scales = new Map<string, number>();
  for (const block of sql.split('CREATE TABLE').slice(1)) {
    const table = /`(\w+)`/.exec(block)![1];
    for (const m of block.matchAll(/`(\w+)` decimal\(\d+,(\d+)\)/g)) scales.set(`${table}.${m[1]}`, Number(m[2]));
  }
  return scales;
}

const stepDecimals = (step: unknown) => (String(step ?? '').split('.')[1] ?? '').length;

describe('logistics number fields', () => {
  const scales = decimalScales();
  const cases = LOGISTICS_CONFIGS.flatMap((config) => {
    const table = `logistics_${config.apiBase.replace('/logistics/', '').replace(/-/g, '_')}`;
    return config.fields
      .filter((f) => f.type === 'number' && (scales.get(`${table}.${f.key}`) ?? 0) > 0)
      .map((f) => [`${table}.${f.key}`, f.step, scales.get(`${table}.${f.key}`)!] as const);
  });

  it('finds the decimal columns', () => {
    expect(cases.length).toBeGreaterThan(10);
  });

  it.each(cases)('%s takes as many decimals as its column', (_column, step, scale) => {
    expect(stepDecimals(step)).toBe(scale);
  });
});
