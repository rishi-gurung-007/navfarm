import { dataEntryStrip } from '../src/components/console/production/data-entry-stage-strip';

// BATCH-000001 after its six boars moved out on 10 Nov 2026 (read from the running API).
const onFirstPendingDate = [
  { stage_code: 'QUARANTINE', animal_count: 6, current_animal_count: 0 },
  { stage_code: 'INSEMINATION', animal_count: 14, current_animal_count: 12 },
];
const today = [
  { stage_code: 'QUARANTINE', animal_count: 0, current_animal_count: 0 },
  { stage_code: 'INSEMINATION', animal_count: 12, current_animal_count: 12 },
];

describe('the animal-wise data-entry stage strip', () => {
  it('drops a stage with no animals on the posting date and none now (QUARANTINE today)', () => {
    expect(dataEntryStrip(today).map((s) => [s.stage.stage_code, s.head, s.onDateOnly])).toEqual([['INSEMINATION', 12, false]]);
  });

  it("keeps a stage that had animals on the posting date, with that day's count (the boars on 06/01/25)", () => {
    expect(dataEntryStrip(onFirstPendingDate).map((s) => [s.stage.stage_code, s.head, s.onDateOnly])).toEqual([
      ['QUARANTINE', 6, true],
      ['INSEMINATION', 12, false],
    ]);
  });

  it('shows the head count now when there is one, and reads animal_count when no current count is sent', () => {
    expect(dataEntryStrip([{ stage_code: 'FARROWING', animal_count: 4, current_animal_count: 5 }])[0].head).toBe(5);
    expect(dataEntryStrip([{ stage_code: 'FARROWING', animal_count: 3 }])[0].head).toBe(3);
    expect(dataEntryStrip([])).toEqual([]);
  });
});
