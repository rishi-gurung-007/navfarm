import { entryVerdict, EntryRequest, todayIn, todayAtOffset } from './entry-window';

const req = (over: Partial<EntryRequest> = {}): EntryRequest => ({
  entryDate: '2026-09-13',
  today: '2026-09-13',
  exists: false,
  mayEditAnyDay: false,
  earlierPending: [],
  ...over,
});

describe('entryVerdict', () => {
  it('lets a worker record today', () => {
    expect(entryVerdict(req())).toEqual({ allowed: true });
  });

  it('lets a worker change what they entered today', () => {
    expect(entryVerdict(req({ exists: true }))).toEqual({ allowed: true });
  });

  // Clearing the backlog is the thing the backlog rule demands; fencing it
  // would leave the worker unable to comply.
  it('lets a worker fill in a day they still owe', () => {
    expect(entryVerdict(req({ entryDate: '2026-09-11', exists: false }))).toEqual({ allowed: true });
  });

  it('stops a worker changing a day already recorded in the past', () => {
    const v = entryVerdict(req({ entryDate: '2026-09-11', exists: true }));
    expect(v).toMatchObject({ allowed: false, code: 'PAST_EDIT' });
  });

  it('lets a supervisor change any day', () => {
    expect(entryVerdict(req({ entryDate: '2026-06-01', exists: true, mayEditAnyDay: true })))
      .toEqual({ allowed: true });
  });

  it('holds today back while an earlier day is incomplete', () => {
    const v = entryVerdict(req({ earlierPending: ['2026-09-11'] }));
    expect(v).toMatchObject({ allowed: false, code: 'BACKLOG' });
    expect((v as any).message).toContain('2026-09-11');
  });

  it('names the oldest owed day and counts the rest', () => {
    const v = entryVerdict(req({ earlierPending: ['2026-09-10', '2026-09-11', '2026-09-12'] }));
    expect((v as any).message).toContain('2026-09-10');
    expect((v as any).message).toContain('2 later days');
  });

  // A supervisor fixing an old entry must not be blocked by a backlog that is
  // not theirs to clear.
  it('does not hold a supervisor back for a backlog', () => {
    expect(entryVerdict(req({ mayEditAnyDay: true, earlierPending: ['2026-09-01'] })))
      .toEqual({ allowed: true });
  });

  it('refuses a future day to everyone', () => {
    expect(entryVerdict(req({ entryDate: '2026-09-14' })))
      .toMatchObject({ allowed: false, code: 'FUTURE' });
    expect(entryVerdict(req({ entryDate: '2026-09-14', mayEditAnyDay: true })))
      .toMatchObject({ allowed: false, code: 'FUTURE' });
  });
});

describe('todayIn', () => {
  // 23:30 UTC on the 13th is already 01:30 on the 14th in Harare, and the farm
  // is what decides which day a shift belongs to.
  it('uses the farm\'s calendar day, not the server\'s', () => {
    const at = new Date('2026-09-13T23:30:00Z');
    expect(todayIn('Africa/Harare', at)).toBe('2026-09-14');
    expect(todayIn('UTC', at)).toBe('2026-09-13');
  });

  it('returns null for a value that is not a timezone', () => {
    expect(todayIn('e3b0c442-98fc-1c14-9afb-f4c8996fb924')).toBeNull();
    expect(todayIn(null)).toBeNull();
    expect(todayIn('')).toBeNull();
  });
});

describe('todayAtOffset', () => {
  it('shifts by whole minutes', () => {
    const at = new Date('2026-09-13T23:30:00Z');
    expect(todayAtOffset(120, at)).toBe('2026-09-14');
    expect(todayAtOffset(0, at)).toBe('2026-09-13');
    expect(todayAtOffset(-330, at)).toBe('2026-09-13');
  });
});
