import { activityStates, dayState } from './entry-history-state';

describe('dayState', () => {
  const today = '2026-09-15';
  it('is NOT_DUE with no required lines', () => {
    expect(dayState({ date: today, today, required: 0, posted: 0, drafts: 0 })).toBe('NOT_DUE');
  });
  it('is COMPLETE when every required line is posted', () => {
    expect(dayState({ date: '2026-09-14', today, required: 3, posted: 3, drafts: 0 })).toBe('COMPLETE');
  });
  it('is MISSING for a past day with a required line unposted, even with drafts', () => {
    expect(dayState({ date: '2026-09-14', today, required: 3, posted: 2, drafts: 1 })).toBe('MISSING');
  });
  it('is IN_PROGRESS today once anything is saved', () => {
    expect(dayState({ date: today, today, required: 3, posted: 1, drafts: 0 })).toBe('IN_PROGRESS');
  });
  it('is NOT_STARTED today with nothing saved', () => {
    expect(dayState({ date: today, today, required: 3, posted: 0, drafts: 0 })).toBe('NOT_STARTED');
  });
});

describe('activityStates', () => {
  it('groups by line type and keeps a parent in progress until every required sub-card posts', () => {
    const lines = [
      { line_id: 'f1', line_type: 'CONSUMPTION', line_seq: 1, is_mandatory: true, status: 'POSTED' as const },
      { line_id: 'f2', line_type: 'CONSUMPTION', line_seq: 2, is_mandatory: true, status: null },
      { line_id: 'm1', line_type: 'DESCRIPTIVE', line_seq: 3, is_mandatory: false, status: 'DRAFT' as const },
    ];
    expect(activityStates(lines)).toEqual([
      { line_type: 'CONSUMPTION', state: 'IN_PROGRESS', required: 2, posted: 1, drafts: 0, line_ids: ['f1', 'f2'] },
      { line_type: 'DESCRIPTIVE', state: 'COMPLETE', required: 0, posted: 0, drafts: 1, line_ids: ['m1'] },
    ]);
  });
});
