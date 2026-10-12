export type FeedForm = 'BULK' | 'BAGGED';

export const isFeedForm = (v: unknown): v is FeedForm => v === 'BULK' || v === 'BAGGED';

/** An item type is a feed type when its code contains FEED (FEED, FEED-001, FEED_BULK, FEED BAG). */
export function isFeedTypeCode(code?: string | null): boolean {
  return (code ?? '').trim().toUpperCase().includes('FEED');
}

/** The form a feed item type's own code or name states (FEED_BULK / FEED_BAG); any other type says nothing. */
export function feedFormFromItemType(code?: string | null, name?: string | null): FeedForm | null {
  if (!isFeedTypeCode(code)) return null;
  // '_' is a word character, so FEED_BULK never matched \bBULK\b; treat _ and - as separators (12 Oct).
  const value = `${(code ?? '').trim().toUpperCase()} ${(name ?? '').trim().toUpperCase()}`.replace(/[_-]+/g, ' ');
  if (/\bBULK\b/.test(value)) return 'BULK';
  if (/\bBAG(?:GED)?\b/.test(value)) return 'BAGGED';
  return null;
}

/**
 * Bulk or Bagged for an item: the item's own Feed Form wins (Rishi, 12 Oct);
 * otherwise what its item type code or name says. Non-feed types give null.
 */
export function resolveItemFeedForm(item: { feed_form?: string | null; item_type?: string | null; item_type_name?: string | null }): FeedForm | null {
  if (!isFeedTypeCode(item.item_type)) return null;
  const own = (item.feed_form ?? '').trim().toUpperCase();
  if (isFeedForm(own)) return own;
  return feedFormFromItemType(item.item_type, item.item_type_name);
}
