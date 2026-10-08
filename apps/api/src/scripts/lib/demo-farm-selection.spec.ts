import { ALL_DEMO_FARM_CODES, selectDemoFarmCodes } from './demo-farm-selection';

describe('demo farm selection', () => {
  it('covers all nine farms when unset or empty', () => {
    expect(selectDemoFarmCodes(undefined)).toEqual(ALL_DEMO_FARM_CODES);
    expect(selectDemoFarmCodes('  ')).toEqual(ALL_DEMO_FARM_CODES);
  });

  it('keeps the canonical order and ignores case and spacing', () => {
    expect(selectDemoFarmCodes('por100, mul100')).toEqual(['MUL100', 'POR100']);
  });

  it('refuses an unknown farm and a set without the two the chapters are written around', () => {
    expect(() => selectDemoFarmCodes('MUL100,POR100,XYZ999')).toThrow('unknown farm(s) XYZ999');
    expect(() => selectDemoFarmCodes('MUL100,GRA100')).toThrow('must include POR100');
  });
});
