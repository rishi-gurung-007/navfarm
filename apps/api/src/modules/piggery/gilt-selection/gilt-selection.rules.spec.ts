import { bufferProblem, MIN_GILT_TEATS, nextSelectionNo, weekOfYear } from './gilt-selection.rules';

describe('gilt selection rules', () => {
  const lines = [{ line_id: 'l1', gilts_selected: 2, label: 'Line 1' }, { line_id: 'l2', gilts_selected: 1, label: 'Line 2' }];
  const key = (t: string) => t.trim().toUpperCase();
  const ok = [
    { line_id: 'l1', rfid_tag: 'A1', no_of_teats: 16 }, { line_id: 'l1', rfid_tag: 'A2', no_of_teats: MIN_GILT_TEATS },
    { line_id: 'l2', rfid_tag: 'B1', no_of_teats: 18 },
  ];

  it('accepts a buffer with a row per gilt, unique tags and enough teats', () => {
    expect(bufferProblem(lines, ok, key)).toBeNull();
  });

  it('blocks a gilt under 15 teats whatever else is right', () => {
    expect(bufferProblem(lines, [ok[0], { ...ok[1], no_of_teats: 14 }, ok[2]], key)).toMatch(/14 teats.*at least 15/);
  });

  it('wants exactly the number selected on each line', () => {
    expect(bufferProblem(lines, [ok[0], ok[2]], key)).toMatch(/Line 1 selects 2 gilts, but 1 is in the buffer/);
    expect(bufferProblem(lines, [...ok, { line_id: 'l2', rfid_tag: 'B2', no_of_teats: 16 }], key)).toMatch(/Line 2 selects 1 gilt, but 2 are/);
  });

  it('refuses a repeated tag (ignoring case and spaces), a missing tag and a line that is not on the selection', () => {
    expect(bufferProblem(lines, [ok[0], { ...ok[1], rfid_tag: ' a1 ' }, ok[2]], key)).toMatch(/more than one gilt/);
    expect(bufferProblem(lines, [ok[0], { ...ok[1], rfid_tag: '  ' }, ok[2]], key)).toMatch(/needs an RFID/);
    expect(bufferProblem(lines, [...ok, { line_id: 'zz', rfid_tag: 'C1', no_of_teats: 16 }], key)).toMatch(/not on this selection/);
  });

  it('numbers selections GS-year-00001 on from the highest', () => {
    expect(nextSelectionNo('2026', null)).toBe('GS-2026-00001');
    expect(nextSelectionNo('2026', 'GS-2026-00009')).toBe('GS-2026-00010');
  });

  it('puts 1 Jan in week 1 and 8 Jan in week 2', () => {
    expect(weekOfYear('2026-01-01')).toBe(1);
    expect(weekOfYear('2026-01-08')).toBe(2);
  });
});
