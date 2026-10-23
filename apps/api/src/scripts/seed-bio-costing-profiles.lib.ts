/**
 * The client's bio-asset costing rules as DRAFT profiles (bio-asset costing, Phase 3). Pure data: every figure here is read from the
 * client's workbook "Amortization,Fairvalue & Bio Asset.xlsx" (FIXED ASSET tab, rows 6-29), the GL-structure workbook and the Bio Asset
 * BBP (S.NO.4-5). What those documents do NOT say is marked [ours] and is awaiting the client:
 *   - GGP, GP and Parent carry the same numbers in the sheet, so one profile per origin and gender covers all three classes.
 *   - The run frequency is MONTHLY [ours]; the sheet's example rows show every frequency, as test values.
 *   - Dated from the day the script is applied [ours]: the documents give no effective date.
 *   - No GL account is set: the chart of accounts has no accumulated-amortisation or impairment account (Finance chooses them), so
 *     every profile stays a DRAFT until accounts are assigned and it is activated through the API.
 *   - The weaners / growers (fair value from week 18, batch tracking) are not seeded: they need the piglet item, and the batch engine is Phase 4.
 */
export interface DraftProfile {
  profile_code: string;
  name: string;
  origin: 'IMPORTED' | 'LOCAL';
  gender: 'F' | 'M';
  costing_method: 'AMORTIZATION' | 'FAIR_VALUE';
  start_age_weeks: number;
  useful_life_months: number;
  residual_rule: 'NONE' | 'WEIGHT_X_PRICE';
  residual_weight_kg: number | null;
  residual_price_per_kg: number | null;
  residual_applies_gender: 'F' | null;
  /** Fair value only: the sheet's expected (CDM) weight and unit price per kg, "CDM Based: No". */
  rate: { expected_weight_kg: number; price_per_kg: number; cdm_based: boolean } | null;
}

export const CLIENT_DRAFT_PROFILES: DraftProfile[] = [
  { profile_code: 'IMP-F', name: 'Imported female (GGP / GP / Parent)', origin: 'IMPORTED', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
    residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null, rate: null },
  { profile_code: 'IMP-M', name: 'Imported male (GGP / GP / Parent)', origin: 'IMPORTED', gender: 'M', costing_method: 'AMORTIZATION', start_age_weeks: 26, useful_life_months: 18,
    residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null, rate: null },
  // Local animals are amortised like the imported ones (21 Oct 2026, Arun's instruction), with the same start age, life and residual as
  // their imported counterparts. The client's sheet and the BBP give local assets the fair value method, so this is awaiting the client's
  // and Finance's sign-off. Going back is one change here (FAIR_VALUE, residual NONE, the rate below).
  { profile_code: 'LOC-F', name: 'Local female (GGP / GP / Parent)', origin: 'LOCAL', gender: 'F', costing_method: 'AMORTIZATION', start_age_weeks: 33, useful_life_months: 36,
    residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null, rate: null },
  { profile_code: 'LOC-M', name: 'Local male (GGP / GP / Parent)', origin: 'LOCAL', gender: 'M', costing_method: 'AMORTIZATION', start_age_weeks: 26, useful_life_months: 18,
    residual_rule: 'NONE', residual_weight_kg: null, residual_price_per_kg: null, residual_applies_gender: null, rate: null },
];

/**
 * The residual value is set once for the company (Finance > Bio-Asset Costing Setup), not on each profile, so the four profiles above carry none.
 * The client's sheet: a female is written down to an assumed 150 kg x 2.05 = 307.50, a male to nothing. The rule and its figures are the client's.
 */
export const CLIENT_RESIDUALS = [
  { gender: 'F' as const, residual_rule: 'WEIGHT_X_PRICE' as const, residual_weight_kg: 150, residual_price_per_kg: 2.05, note: 'Fixed Asset sheet: assumed 150 kg x 2.05' },
  { gender: 'M' as const, residual_rule: 'NONE' as const, residual_weight_kg: null, residual_price_per_kg: null, note: 'Fixed Asset sheet: no residual for a male' },
];
