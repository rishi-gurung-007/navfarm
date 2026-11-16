/**
 * The twelve biological items and their costing figures, exactly as the workbook gives them: "Amortization,Fairvalue & Bio Asset.xlsx"
 * (docs source: OneDrive_1_04-09-2026/Solution Documents), tab FIXED ASSET (rows 6-37) for the class, method, life, start week and residual, and tab
 * "amortization & fv -formula" (rows 70-75) for the fair-value inputs. Pure data: every value is the sheet's; what the sheet does NOT say is left empty and is
 * marked [open]. Nothing here is a default of ours, so that nothing invented is ever presented as the sheet's.
 *
 * Read the workbook, then these rows: the tab FIXED ASSET lists GP and P local items only (no GGP-Loc), and the "formula" tab's example rows are test values
 * (its useful lives and start weeks for the imported rows are swapped against the FIXED ASSET tab); the FIXED ASSET tab wins where they differ.
 */
export interface FixedAssetItem {
  /** Column A of the FIXED ASSET tab; the Item No. */
  item_code: string;
  /** FIXED ASSET column "Classification". */
  classification: 'NON_CURRENT' | 'CURRENT';
  /** FIXED ASSET column "Tracking": an animal is tracked by her tattoo, weaners and finishers by batch. */
  tracking: 'INDIVIDUAL' | 'BATCH';
  /** FIXED ASSET column "Costing Method". Null where the sheet gives none (Finisher). */
  costing_method: 'AMORTIZATION' | 'FAIR_VALUE' | null;
  gender: 'F' | 'M' | null;
  /** "Amortization/ Fair Value Start Period" in weeks. */
  start_weeks: number | null;
  /** "Useful Live" in months; the sheet gives one for local fair-value items too. */
  life_months: number | null;
  /** FIXED ASSET "Residual Value": Yes with the assumed 150 kg x 2.05 = 307.50 for an imported female, No for every male. */
  residual: { rule: 'WEIGHT_X_PRICE'; weight_kg: number; price_per_kg: number } | { rule: 'NONE' };
  /** Formula tab, fair value setup: CDM based, expected weight and unit price per kg. */
  fair_value: { cdm_based: boolean; expected_weight_kg: number; price_per_kg: number } | null;
  /**
   * The G/L names the sheet gives: FIXED ASSET columns B and C (acquisition, and amortisation or fair value gain/loss), and from V1.3 the accumulated
   * amortisation its Amortization column credits ("Credit: Accumulated Amortization — GP-Imp-F"), one per amortised item. Null where it names none.
   */
  accounts: { acquisition: string | null; result: string | null; accumulated: string | null };
  /** True where a run costs individually tracked animals of the item. PIGLETS and Finisher are batch-tracked and are not run (the rule for a batch's head count is open). */
  runnable: boolean;
  /** What is open or differs between the tabs for this item. */
  open: string[];
}

const FEMALE_RESIDUAL = { rule: 'WEIGHT_X_PRICE' as const, weight_kg: 150, price_per_kg: 2.05 };
const NO_RESIDUAL = { rule: 'NONE' as const };
const FV_SETUP = { cdm_based: false, expected_weight_kg: 150, price_per_kg: 2.05 };

const imported = (code: string, gender: 'F' | 'M', amortisation: string): FixedAssetItem => ({
  item_code: code, classification: 'NON_CURRENT', tracking: 'INDIVIDUAL', costing_method: 'AMORTIZATION', gender,
  start_weeks: gender === 'F' ? 33 : 26, life_months: gender === 'F' ? 36 : 18, residual: gender === 'F' ? FEMALE_RESIDUAL : NO_RESIDUAL, fair_value: null,
  accounts: { acquisition: `${code} Acquisition Cost`, result: amortisation, accumulated: `${code} Accumulated Amortization` }, runnable: true,
  // V1.3, GGP-Imp-F only: its Amortization column reads "Debit: WIP GP-IMP F Account / Credit: Acquisition Amortization Account", against every other
  // imported row's "Debit: Amortization Expense / Credit: Accumulated Amortization". Read as the same entry as the others.
  open: code === 'GGP-Imp-F' ? ['V1.3 words the amortisation entry for GGP-Imp-F differently from the other five (WIP / Acquisition Amortization Account); it is posted like the others.'] : [],
});

const local = (code: string, gender: 'F' | 'M'): FixedAssetItem => ({
  item_code: code, classification: 'NON_CURRENT', tracking: 'INDIVIDUAL', costing_method: 'FAIR_VALUE', gender,
  start_weeks: gender === 'F' ? 33 : 26, life_months: gender === 'F' ? 36 : 18, residual: NO_RESIDUAL, fair_value: FV_SETUP,
  accounts: { acquisition: `${code} Acquisition Cost`, result: `${code} Fair Value Gain/Loss`, accumulated: null }, runnable: true,
  open: ['The sheet gives fair value for local animals; the dev seeds amortise them (Arun, 21 Oct 2026) pending confirmation.'],
});

export const FIXED_ASSET_ITEMS: FixedAssetItem[] = [
  imported('GGP-Imp-F', 'F', 'GGP-IMP-F Amortization'),
  imported('GGP-Imp-M', 'M', 'GGP-IMP-M Amortization'),
  imported('GP-Imp-F', 'F', 'GP-IMP-F Amortization'),
  imported('GP-Imp-M', 'M', 'GP-IMP-M Amortization'),
  imported('P-Imp-F', 'F', 'P-IMP-F Amortization'),
  imported('P-Imp-M', 'M', 'P-IMP-M Amortization'),
  local('GP-Loc-F', 'F'),
  local('GP-Loc-M', 'M'),
  local('P-Loc-F', 'F'),
  local('P-Loc-M', 'M'),
  {
    item_code: 'PIGLETS', classification: 'CURRENT', tracking: 'BATCH', costing_method: 'FAIR_VALUE', gender: null, start_weeks: 17, life_months: null,
    residual: NO_RESIDUAL, fair_value: { cdm_based: true, expected_weight_kg: 60, price_per_kg: 2.05 },
    accounts: { acquisition: 'Weaners Acquisition Cost', result: 'Weaners Fair Value Gain/Loss', accumulated: null }, runnable: false,
    open: ['Batch-tracked: a run costs individually tracked animals only, and the rule for a batch\'s head count is not given.', 'The FIXED ASSET tab says fair value from week 17; the formula tab says 18.'],
  },
  {
    item_code: 'Finisher', classification: 'CURRENT', tracking: 'BATCH', costing_method: null, gender: null, start_weeks: null, life_months: null,
    residual: NO_RESIDUAL, fair_value: null,
    // V1.3 FIXED ASSET columns B and C name both accounts for Finisher.
    accounts: { acquisition: 'Finisher Closing Stock', result: 'Finisher Fair Value Gain/Loss', accumulated: null }, runnable: false,
    open: ['The sheet gives a classification (Current), its two accounts and the entry (Dr Finisher Closing Stock / Cr Weaners Acquisition or Fair Value account), but no method, start week or figures.'],
  },
];

/** What the sheet leaves for Finance, said once: it says "Impairment Loss" for a death but names no account for it on any item. */
export const ACCOUNTS_NOT_IN_THE_SHEET = ['mortality / impairment loss'] as const;
