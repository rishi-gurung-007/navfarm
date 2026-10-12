import { itemTypeFeedForm } from './feed-forecast.service';

describe('itemTypeFeedForm (Master Setup rows 22, 26)', () => {
  it('reads BULK and BAGGED from the item type', () => {
    expect(itemTypeFeedForm('FEED_BULK')).toBe('BULK');
    expect(itemTypeFeedForm('FEED BULK')).toBe('BULK');
    expect(itemTypeFeedForm('FEED_BAG')).toBe('BAGGED');
    expect(itemTypeFeedForm('feed-bagged')).toBe('BAGGED');
  });
  it('says nothing for a plain FEED or another type', () => {
    expect(itemTypeFeedForm('FEED')).toBeNull();
    expect(itemTypeFeedForm('MEDICINE')).toBeNull();
    expect(itemTypeFeedForm(null)).toBeNull();
  });
});
