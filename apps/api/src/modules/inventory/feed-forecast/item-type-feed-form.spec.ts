import { itemFeedForm, itemTypeFeedForm } from './feed-forecast.service';

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

describe('itemFeedForm (12 Oct)', () => {
  it('prefers the item feed_form, then the type code', () => {
    expect(itemFeedForm({ item_type: 'FEED', feed_form: 'BAGGED' })).toBe('BAGGED');
    expect(itemFeedForm({ item_type: 'FEED_BULK', feed_form: null })).toBe('BULK');
    expect(itemFeedForm({ item_type: 'FEED', feed_form: null })).toBeNull();
    expect(itemFeedForm({ item_type: 'MEDICINE', feed_form: 'BULK' })).toBeNull();
  });
});
