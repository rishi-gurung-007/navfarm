import { destinationVerdict, LabelContext, renderLotLabel } from './semen-lot-label.rules';

const ctx = (over: Partial<LabelContext> = {}): LabelContext => ({
  line: 'Z-Line', boarTags: ['BLXA9988'], boarCodes: ['PIG-2026-0001'], week: 45, year: 2026, date: '2026-11-04', seq: 1, ...over,
});

describe('renderLotLabel: the formats the client wrote', () => {
  it('<boar tag>-<week number> for a single boar (Z-Line: BLXA9988-<WEEK NUMBER>)', () => {
    expect(renderLotLabel('{BOAR_TAG}-{WEEK}', ctx())).toBe('BLXA9988-45');
  });

  it('POOLL-<week number> for a pooled lot, the prefix being plain text (L-Line)', () => {
    expect(renderLotLabel('POOLL-{WEEK}', ctx({ line: 'L-Line', boarTags: ['LA0499', 'LA0752'] }))).toBe('POOLL-45');
  });
});

describe('renderLotLabel: the rest', () => {
  it('fills every token, and prints anything else as typed', () => {
    expect(renderLotLabel('{LINE}/{BOAR_CODE}/{DATE}/W{WEEK}/{YEAR}/#{SEQ}', ctx())).toBe('Z-Line/PIG-2026-0001/2026-11-04/W45/2026/#1');
  });

  it('joins the tags of a pooled lot with +', () => {
    expect(renderLotLabel('{BOAR_TAG}', ctx({ boarTags: ['A1', 'B2', 'C3'] }))).toBe('A1+B2+C3');
  });

  it('gives the week as a plain number, with no leading zero', () => {
    expect(renderLotLabel('POOLL-{WEEK}', ctx({ week: 5 }))).toBe('POOLL-5');
  });

  it('adds the year when the line says so and the template does not name it', () => {
    expect(renderLotLabel('POOLL-{WEEK}', ctx(), true)).toBe('POOLL-45-2026');
    expect(renderLotLabel('POOLL-{WEEK}/{YEAR}', ctx(), true)).toBe('POOLL-45/2026');
    expect(renderLotLabel('POOLL-{WEEK}', ctx(), false)).toBe('POOLL-45');
  });

  it('uses the ISO year of a week that straddles a new year, not the date\'s', () => {
    expect(renderLotLabel('{WEEK}-{YEAR}', ctx({ week: 1, year: 2026, date: '2025-12-29' }))).toBe('1-2026');
  });

  it('tells two lots of a week apart by {SEQ}', () => {
    expect(renderLotLabel('POOLL-{WEEK}-{SEQ}', ctx({ seq: 2 }))).toBe('POOLL-45-2');
  });

  it('gives no label for no template', () => {
    expect(renderLotLabel(null, ctx())).toBeNull();
    expect(renderLotLabel('   ', ctx())).toBeNull();
    expect(renderLotLabel(undefined, ctx())).toBeNull();
  });

  it('leaves a token it does not know as typed (a template is checked when the setup is saved)', () => {
    expect(renderLotLabel('X-{WEAK}', ctx())).toBe('X-{WEAK}');
  });
});

describe('destinationVerdict', () => {
  const base = { restriction: 'BLOCK' as const, lotDestination: null, lineFarms: ['grasmere', 'porta'], targetFarm: 'grasmere' };

  it('lets semen go to a farm the line allows', () => {
    expect(destinationVerdict(base)).toEqual({ verdict: 'OK', allowed: ['grasmere', 'porta'] });
  });

  it('stops or warns on a farm it does not allow, as the line says', () => {
    expect(destinationVerdict({ ...base, targetFarm: 'elsewhere' }).verdict).toBe('BLOCK');
    expect(destinationVerdict({ ...base, restriction: 'WARN', targetFarm: 'elsewhere' }).verdict).toBe('WARN');
  });

  it('reads the destination named on the lot (the plan\'s) as the only farm, over the line\'s list', () => {
    expect(destinationVerdict({ ...base, lotDestination: 'multiplier', targetFarm: 'grasmere' })).toEqual({ verdict: 'BLOCK', allowed: ['multiplier'] });
    expect(destinationVerdict({ ...base, lotDestination: 'multiplier', targetFarm: 'multiplier' }).verdict).toBe('OK');
  });

  it('restricts nothing when the line does not, names no farm, or the target farm cannot be told', () => {
    expect(destinationVerdict({ ...base, restriction: 'NONE', targetFarm: 'elsewhere' }).verdict).toBe('OK');
    expect(destinationVerdict({ ...base, lineFarms: [], targetFarm: 'elsewhere' }).verdict).toBe('OK');
    expect(destinationVerdict({ ...base, lineFarms: null, targetFarm: 'elsewhere' }).verdict).toBe('OK');
    expect(destinationVerdict({ ...base, targetFarm: null }).verdict).toBe('OK');
  });
});
