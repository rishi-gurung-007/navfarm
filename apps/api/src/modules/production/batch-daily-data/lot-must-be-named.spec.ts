import { lotMustBeNamed } from './batch-daily-data.service';

describe('lotMustBeNamed — which daily entries must name their lot (Rishi, 14 Oct)', () => {
  it('asks a lot-tracked feed for its lot', () => {
    expect(lotMustBeNamed('CONSUMPTION', 'feed-1', { lot: true, serial: false, item_type: 'FEED' })).toBe(true);
    expect(lotMustBeNamed('CONSUMPTION', 'feed-2', { lot: true, serial: false, item_type: 'FEED_BULK' })).toBe(true);
  });

  it('still asks a lot-tracked vaccine or medicine for its lot', () => {
    expect(lotMustBeNamed('CONSUMPTION', 'vac-1', { lot: true, serial: false, item_type: 'VACCINE' })).toBe(true);
    expect(lotMustBeNamed('CONSUMPTION', 'med-1', { lot: true, serial: false, item_type: 'MEDICINE' })).toBe(true);
  });

  it('still asks a serial-tracked item, feed or not, for its serials', () => {
    expect(lotMustBeNamed('CONSUMPTION', 'feed-3', { lot: false, serial: true, item_type: 'FEED' })).toBe(true);
  });

  it('asks nothing of an untracked item, and refuses a line with no item', () => {
    expect(lotMustBeNamed('CONSUMPTION', 'feed-4', { lot: false, serial: false, item_type: 'FEED' })).toBe(false);
    expect(lotMustBeNamed('CONSUMPTION', null, undefined)).toBe(true);
  });
});
