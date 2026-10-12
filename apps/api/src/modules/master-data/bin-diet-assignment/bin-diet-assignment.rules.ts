import { BadRequestException } from '@nestjs/common';
import { feedFormFromItemType, resolveItemFeedForm, type FeedForm } from '../../../common/feed-form';

type BinLike = {
  location_type?: string | null;
  is_active?: boolean | null;
  bin_feed_type?: string | null;
};

type ItemLike = {
  item_type?: string | null;
  item_type_name?: string | null;
  feed_form?: string | null;
  diet_no?: number | null;
  is_active?: boolean | null;
};

export type { FeedForm };
export { feedFormFromItemType };

export function assertAssignmentCompatibility(bin: BinLike, item: ItemLike): FeedForm {
  if (bin.location_type !== 'BIN' || bin.is_active !== true) {
    throw new BadRequestException('BIN Diet Assignment requires an active BIN location.');
  }

  const feedForm = resolveItemFeedForm(item);
  if (item.is_active !== true || !feedForm) {
    throw new BadRequestException('BIN Diet Assignment requires an active Feed Item with an explicit Bulk or Bagged type.');
  }
  if (item.diet_no === null || item.diet_no === undefined) {
    throw new BadRequestException('The selected Feed Item must have a Diet No.');
  }
  if (bin.bin_feed_type !== feedForm) {
    throw new BadRequestException(`The BIN feed form '${bin.bin_feed_type ?? 'Not available'}' does not match the Feed Item form '${feedForm}'.`);
  }
  return feedForm;
}
