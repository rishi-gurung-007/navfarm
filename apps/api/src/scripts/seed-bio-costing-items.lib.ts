/**
 * The costing terms the costing seeds put on the demo catalog's biological items (item-level costing; the TDD Item Card's Bio Asset Costing tab).
 * Pure data. Every figure is read from the workbook "Amortization,Fairvalue & Bio Asset.xlsx" (FIXED ASSET tab) and the Bio Asset BBP (S.NO.4-5):
 * a female starts at week 33 and is amortised over 36 months to an assumed 150 kg x 2.05; a male starts at week 26 over 18 months to nothing. What those
 * documents do NOT say is marked [ours] and awaits confirmation:
 *   - the demo catalog has one sow, one boar and one gilt item, not the twelve; GGP, GP and Parent carry the same numbers in the sheet, so each
 *     catalog item takes the numbers of its sex. The twelve items are created by the user (their own figures), not by a seed;
 *   - local animals are amortised like imported ones (Arun, 21 Oct 2026), although the sheet gives local assets fair value;
 *   - the frequency is MONTHLY and auto-post is off [ours].
 */
export interface SeedItemTerms {
  /** The demo catalog's item name. */
  item_name: string;
  bio_gender: 'F' | 'M';
  bio_start_age_weeks: number;
  bio_useful_life_months: number;
  bio_residual_rule: 'NONE' | 'WEIGHT_X_PRICE';
  bio_residual_weight_kg: number | null;
  bio_residual_price_per_kg: number | null;
}

const FEMALE = { bio_gender: 'F' as const, bio_start_age_weeks: 33, bio_useful_life_months: 36, bio_residual_rule: 'WEIGHT_X_PRICE' as const, bio_residual_weight_kg: 150, bio_residual_price_per_kg: 2.05 };
const MALE = { bio_gender: 'M' as const, bio_start_age_weeks: 26, bio_useful_life_months: 18, bio_residual_rule: 'NONE' as const, bio_residual_weight_kg: null, bio_residual_price_per_kg: null };

export const SHEET_ITEM_TERMS: SeedItemTerms[] = [
  { item_name: 'Mature Parity Breeding Sow', ...FEMALE },
  { item_name: 'Replacement Breeding Gilt', ...FEMALE },
  { item_name: 'Mature Herd Sire Boar', ...MALE },
];
