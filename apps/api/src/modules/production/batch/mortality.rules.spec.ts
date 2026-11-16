import { assertDeathNotes, assertDeathWeight } from './mortality.rules';

describe('death rules (TDD row 10)', () => {
  const sow = { animal_code: 'PF-SOW-01', costing_start_date: '2025-04-07' };

  it('needs the weight at death for a costed breeding asset', () => {
    expect(() => assertDeathWeight(sow, undefined)).toThrow(/weight at death/);
    expect(() => assertDeathWeight(sow, 0)).toThrow(/weight at death/);
    expect(() => assertDeathWeight(sow, '182.5')).not.toThrow();
  });

  it('asks nothing of an animal that is not costed', () => {
    expect(() => assertDeathWeight({ animal_code: 'P1', costing_start_date: null }, undefined)).not.toThrow();
  });

  it('needs a note when the reason is Other or Unknown, however it is cased', () => {
    expect(() => assertDeathNotes('OTHER', [undefined, '  '])).toThrow(/needs a note/);
    expect(() => assertDeathNotes('Unknown cause', [])).toThrow(/needs a note/);
    expect(() => assertDeathNotes('OTHER', [undefined, 'Found dead at feeding'])).not.toThrow();
  });

  it('asks for no note on a named cause', () => {
    expect(() => assertDeathNotes('SCOURS', [])).not.toThrow();
    expect(() => assertDeathNotes(undefined, [])).not.toThrow();
  });
});
