import { planFeedLineRefresh, type ExistingFeedLine, type WantedFeedLine } from './refresh-scheduler-feed';

const line = (id: string, start: number, end: number, item: string, qty: number, last = 0, ref = 'old'): ExistingFeedLine =>
  ({ lineId: id, startDay: start, endDay: end, itemId: item, qty, lastEnteredDay: last, lifecycleRefId: ref });
const want = (id: string, from: number, to: number, item: string, qty: number): WantedFeedLine =>
  ({ lifecycleId: id, fromDay: from, toDay: to, itemId: item, qty });

describe('planFeedLineRefresh (schedulers follow a stage feed change, Rishi 13 Oct)', () => {
  it('a split after 14 entered days: the entered line keeps its feed and carries on to day 20, the new feed starts day 21', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 43, 'mash', 0.8, 14)], [want('R1', 1, 20, 'mash', 0.8), want('R2', 21, 43, 'finisher', 1.2)]);
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 20, lifecycleId: 'R1' }]);
    expect(plan.remove).toEqual([]);
    expect(plan.insert).toEqual([want('R2', 21, 43, 'finisher', 1.2)]);
  });

  it('a different feed from today: the entered line ends at the last entered day and the new feed covers the rest', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 43, 'mash', 0.8, 14)], [want('R1', 1, 43, 'grower', 1.0)]);
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 14 }]);
    expect(plan.insert).toEqual([want('R1', 15, 43, 'grower', 1.0)]);
  });

  it('a new rate for the same feed counts as a different feed: past days keep the old rate', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 43, 'mash', 0.8, 5)], [want('R1', 1, 43, 'mash', 0.9)]);
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 5 }]);
    expect(plan.insert).toEqual([want('R1', 6, 43, 'mash', 0.9)]);
  });

  it('nothing entered yet: the old lines go and the new ones come in whole', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 43, 'mash', 0.8)], [want('R1', 1, 20, 'mash', 0.8), want('R2', 21, 43, 'finisher', 1.2)]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual(['L1']);
    expect(plan.insert).toEqual([want('R1', 1, 20, 'mash', 0.8), want('R2', 21, 43, 'finisher', 1.2)]);
  });

  it('nothing changed: no writes', () => {
    const plan = planFeedLineRefresh(
      [line('L1', 1, 20, 'mash', 0.8, 14, 'R1'), line('L2', 21, 43, 'finisher', 1.2, 0, 'R2')],
      [want('R1', 1, 20, 'mash', 0.8), want('R2', 21, 43, 'finisher', 1.2)],
    );
    expect(plan).toEqual({ update: [], remove: [], insert: [] });
  });

  it('lines wholly in the entered past are left as they are', () => {
    const plan = planFeedLineRefresh(
      [line('L1', 1, 8, 'starter', 0.5, 8), line('L2', 9, 43, 'mash', 0.8, 12)],
      [want('R1', 1, 43, 'mash', 0.8)],
    );
    expect(plan.update).toEqual([{ lineId: 'L2', endDay: 43, lifecycleId: 'R1' }]);
    expect(plan.insert).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it('the stage feed removed: lines not entered go, entered ones stop at the last entered day', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 20, 'mash', 0.8, 10), line('L2', 21, 43, 'finisher', 1.2)], []);
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 10 }]);
    expect(plan.remove).toEqual(['L2']);
    expect(plan.insert).toEqual([]);
  });

  it('an unchanged line not entered yet only follows the new lifecycle row id', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 43, 'mash', 0.8, 0, 'old')], [want('R1', 1, 43, 'mash', 0.8)]);
    expect(plan).toEqual({ update: [{ lineId: 'L1', endDay: 43, lifecycleId: 'R1' }], remove: [], insert: [] });
  });

  it('a scheduler that had no feed gets the stage feed', () => {
    expect(planFeedLineRefresh([], [want('R1', 1, 28, 'mash', 2)]).insert).toEqual([want('R1', 1, 28, 'mash', 2)]);
  });
});

/**
 * The same plan serves a feed edit made on the scheduler itself (Rishi, 14 Oct). Such a line
 * belongs to the scheduler, not to a lifecycle row, so it carries no lifecycleId — and the
 * history rule has to hold exactly as it does for a stage change, because the days already
 * entered were posted against the line they are about to lose.
 */
const userWant = (from: number, to: number, item: string, qty: number): WantedFeedLine =>
  ({ lifecycleId: null, fromDay: from, toDay: to, itemId: item, qty });

describe('planFeedLineRefresh — a feed edit made on the scheduler', () => {
  it('keeps the entered days on their own line and starts the new rate the day after', () => {
    // BLANKTST SCH-000006 as it stands: 1-20 mash 0.8 with 14 days posted, 21-43 finisher 1.2.
    const plan = planFeedLineRefresh(
      [line('L1', 1, 20, 'mash', 0.8, 14), line('L2', 21, 43, 'finisher', 1.2)],
      [userWant(1, 20, 'mash', 0.95), userWant(21, 43, 'finisher', 1.2)],
    );
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 14 }]);
    expect(plan.insert).toEqual([userWant(15, 20, 'mash', 0.95)]);
    // The untouched line is left exactly alone rather than rewritten.
    expect(plan.remove).toEqual([]);
  });

  it('does not strip the lifecycle reference off the line it keeps for history', () => {
    const plan = planFeedLineRefresh([line('L1', 1, 20, 'mash', 0.8, 14, 'R1')], [userWant(1, 20, 'mash', 0.95)]);
    // endDay only: nulling lifecycle_ref_id would rewrite what a posted day was entered against.
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 14 }]);
  });

  it('restores the original rate by extending the entered line, leaving no stray line behind', () => {
    // The revert: 800 GRAM is 0.8 kg, so the entered line simply carries on to day 20 again.
    const plan = planFeedLineRefresh(
      [line('L1', 1, 14, 'mash', 0.8, 14), line('L2', 15, 20, 'mash', 0.95, 0, null), line('L3', 21, 43, 'finisher', 1.2)],
      [userWant(1, 20, 'mash', 0.8), userWant(21, 43, 'finisher', 1.2)],
    );
    expect(plan.update).toEqual([{ lineId: 'L1', endDay: 20 }]);
    expect(plan.remove).toEqual(['L2']);
    expect(plan.insert).toEqual([]);
  });

  it('a line the user wrote is seen by a later stage change, so no second line covers its days', () => {
    // lifecycleRefId null is what a user edit leaves; the plan must still manage that line.
    const plan = planFeedLineRefresh(
      [line('L1', 15, 20, 'mash', 0.95, 0, null)],
      [want('R1', 15, 20, 'mash', 0.8)],
    );
    expect(plan.insert).toEqual([want('R1', 15, 20, 'mash', 0.8)]);
    expect(plan.remove).toEqual(['L1']);
  });
});
