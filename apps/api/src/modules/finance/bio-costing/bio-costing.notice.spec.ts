import { dueNotices, type DueLineFacts } from './bio-costing.notice';

const line = (over: Partial<DueLineFacts> = {}): DueLineFacts => ({ item_id: 'i1', item_code: 'IMP-F', auto_post: false, due_periods: [], blocked: null, ...over });

describe('dueNotices', () => {
  it('says nothing when nothing is due, nothing waits and nothing fails', () => {
    expect(dueNotices([line()])).toEqual([]);
  });

  it('warns that periods are due when a person must run them, naming the span and where to go', () => {
    const [n] = dueNotices([line({ due_periods: ['2026-07', '2026-08', '2026-09'] })]);
    expect(n.severity).toBe('WARNING');
    expect(n.title).toBe('Costing run due: IMP-F 2026-07 to 2026-09');
    expect(n.message).toContain('Bio-Asset Costing Runs');
    expect(n.message).toContain('2026-07, 2026-08, 2026-09');
  });

  it('names a single period plainly, and tells an auto-post item only as information', () => {
    const [n] = dueNotices([line({ auto_post: true, due_periods: ['2026-09'] })]);
    expect(n.severity).toBe('INFO');
    expect(n.title).toBe('Costing run due: IMP-F 2026-09');
    expect(n.message).toContain('posts automatically');
    expect(n.message).toContain('Bio-Asset Costing Runs');
  });

  it('warns that a calculated run waits to be posted and that the item is paused', () => {
    const [n] = dueNotices([line({ blocked: { reason: 'WAITING_TO_POST', run_no: 'BCR-2026-00007', period_key: '2026-09' } })]);
    expect(n.severity).toBe('WARNING');
    expect(n.title).toBe('Costing run waiting to be posted: IMP-F 2026-09');
    expect(n.message).toContain('BCR-2026-00007');
    expect(n.message).toContain('paused');
  });

  it('is critical when a period keeps failing, with the count and the reason', () => {
    const [n] = dueNotices([line({ blocked: { reason: 'TOO_MANY_FAILURES', period_key: '2026-08', attempts: 3, error: 'Reporting period is closed.' } })]);
    expect(n.severity).toBe('CRITICAL');
    expect(n.message).toContain('3 times');
    expect(n.message).toContain('Reporting period is closed.');
  });

  it('gives each item its own notice, and a waiting run hides the periods behind it', () => {
    const notices = dueNotices([
      line({ item_id: 'a', item_code: 'A', due_periods: ['2026-09'] }),
      line({ item_id: 'b', item_code: 'B', due_periods: ['2026-08'], blocked: { reason: 'WAITING_TO_POST', run_no: null, period_key: '2026-07' } }),
    ]);
    expect(notices.map((n) => n.item_id)).toEqual(['a', 'b']);
    expect(notices[1].title).toBe('Costing run waiting to be posted: B 2026-07');
    expect(notices[1].message).toContain('The run for B');
  });
});
