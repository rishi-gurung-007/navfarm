/**
 * TDD row 11 (Sale of Fixed Asset / Cull): the rules of an FA to Inventory conversion, pure. A culled breeding animal becomes inventory only through a request
 * that Finance approves, then posts: the animal leaves the herd (CONVERTED_INV), her book value is relieved and she is received into inventory at the market value
 * Finance entered; the difference from her book value is the gain or loss on the conversion.
 */
import { BadRequestException } from '@nestjs/common';

export const CONVERSION_STATUSES = ['REQUESTED', 'APPROVED', 'REJECTED', 'POSTED', 'CANCELLED'] as const;
export const OPEN_STATUSES = ['REQUESTED', 'APPROVED'] as const;
/** The one inventory item every converted animal is received as. Lot-tracked: the lot is the animal's code. */
export const CONVERSION_ITEM_CODE = 'CULLED-BREEDING-ASSET';
export const CONVERSION_ITEM_NAME = 'Culled Breeding Asset';

const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function assertRequestable(a: { animal_code: string; is_active: boolean; costing_start_date: string | null; out_of_production_date: string | null }): void {
  if (!a.is_active) throw new BadRequestException(`${a.animal_code} has already left the herd.`);
  if (!a.costing_start_date) {
    throw new BadRequestException(`${a.animal_code} is not a costed breeding asset (no costing start date), so she has no fixed asset to convert; dispose of her as usual.`);
  }
  if (!a.out_of_production_date) {
    throw new BadRequestException(`Record ${a.animal_code}'s out-of-production date first; a conversion request starts from it.`);
  }
}

/** Finance approves, and not the person who raised the request. */
export function assertApprover(requestedBy: string | null | undefined, approverId: string | null | undefined): void {
  if (!approverId) throw new BadRequestException('Finance approval needs a signed-in approver.');
  if (requestedBy && requestedBy === approverId) {
    throw new BadRequestException('A conversion request cannot be approved by the person who raised it; another Finance user must approve it.');
  }
}

export function assertConversionDate(date: string, outOfProductionDate: string, today: string): void {
  if (date > today) throw new BadRequestException(`The conversion date ${date} is in the future.`);
  if (date < outOfProductionDate) {
    throw new BadRequestException(`The conversion date ${date} is before the out-of-production date ${outOfProductionDate}; it cannot come before it.`);
  }
}

/** Market value less her net book value: above nil is a gain, below a loss. */
export function conversionGainLoss(marketValue: number, netBookValue: number): number {
  return r4(marketValue - Math.max(0, netBookValue));
}
