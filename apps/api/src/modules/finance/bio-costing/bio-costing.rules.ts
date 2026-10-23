/**
 * Pure rules of the central bio-asset costing profile (bio-asset costing, Phase 3). No database here: the service
 * loads the rows and these functions decide. What is "ours" rather than the client's is marked, as in the plan.
 */

export const COSTING_METHODS = ['AMORTIZATION', 'FAIR_VALUE'] as const;
export const RESIDUAL_RULES = ['NONE', 'FIXED', 'WEIGHT_X_PRICE'] as const;
export const RUN_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY'] as const;
export const DAY_BASES = ['FREQUENCY_DAYS', 'ACTUAL'] as const;
export const TRACKINGS = ['INDIVIDUAL', 'BATCH'] as const;
export const ORIGINS = ['IMPORTED', 'LOCAL'] as const;

/** The client's frequency days (formula sheet column F): weekly 7, monthly 30, quarterly 90, yearly 360. */
export const FREQUENCY_DAYS: Record<(typeof RUN_FREQUENCIES)[number], number> = { WEEKLY: 7, MONTHLY: 30, QUARTERLY: 90, YEARLY: 360 };

/** Terms that must not change once an animal is costed by the profile (plan V8). Fair-value rate rows are not among them. */
export const LOCKED_FIELDS = [
  'item_id', 'breed_id', 'gender', 'origin', 'costing_method', 'start_age_weeks', 'useful_life_months',
  'residual_rule', 'residual_fixed_amount', 'residual_weight_kg', 'residual_price_per_kg', 'residual_applies_gender',
  'run_frequency', 'day_basis', 'tracking', 'acquisition_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id',
  'fv_gain_loss_gl_id', 'writeoff_gl_id', 'effective_from',
] as const;

export interface ProfileTerms {
  item_id?: string | null;
  breed_id?: string | null;
  gender?: string | null;
  origin?: string | null;
  costing_method: string;
  start_age_weeks: number;
  useful_life_months?: number | null;
  residual_rule?: string | null;
  residual_fixed_amount?: number | string | null;
  residual_weight_kg?: number | string | null;
  residual_price_per_kg?: number | string | null;
  residual_applies_gender?: string | null;
  run_frequency?: string | null;
  day_basis?: string | null;
  tracking?: string | null;
}

export interface MethodFlags { bio_asset_support: boolean; amort_option: boolean; fair_value_option: boolean }

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const oneOf = (list: readonly string[], v: unknown) => typeof v === 'string' && list.includes(v);

/** What is wrong with the terms of a profile, as messages; empty when they hold together. */
export function validateTerms(t: ProfileTerms, flags: MethodFlags | null): string[] {
  const e: string[] = [];
  if (!oneOf(COSTING_METHODS, t.costing_method)) e.push(`Costing method must be one of ${COSTING_METHODS.join(', ')}.`);
  if (!Number.isInteger(t.start_age_weeks) || t.start_age_weeks < 0) e.push('Start age (weeks) must be a whole number, 0 or more.');
  if (t.gender != null && !['F', 'M'].includes(t.gender)) e.push('Gender must be F or M.');
  if (t.origin != null && !oneOf(ORIGINS, t.origin)) e.push(`Origin must be ${ORIGINS.join(' or ')}.`);
  if (t.residual_applies_gender != null && !['F', 'M'].includes(t.residual_applies_gender)) e.push('Residual applies to gender must be F or M.');
  if (t.run_frequency != null && !oneOf(RUN_FREQUENCIES, t.run_frequency)) e.push(`Run frequency must be one of ${RUN_FREQUENCIES.join(', ')}.`);
  if (t.day_basis != null && !oneOf(DAY_BASES, t.day_basis)) e.push(`Day basis must be ${DAY_BASES.join(' or ')}.`);
  if (t.tracking != null && !oneOf(TRACKINGS, t.tracking)) e.push(`Tracking must be ${TRACKINGS.join(' or ')}.`);
  if (!t.item_id && !t.breed_id && !t.gender && !t.origin) e.push('A profile needs a scope: an item, or at least one of breed, gender and origin.');

  const rule = t.residual_rule ?? 'NONE';
  if (!oneOf(RESIDUAL_RULES, rule)) e.push(`Residual rule must be one of ${RESIDUAL_RULES.join(', ')}.`);
  if (rule === 'FIXED' && !(num(t.residual_fixed_amount) !== null && num(t.residual_fixed_amount)! >= 0)) e.push('A fixed residual needs an amount of 0 or more.');
  if (rule === 'WEIGHT_X_PRICE' && !(num(t.residual_weight_kg)! > 0 && num(t.residual_price_per_kg)! > 0)) e.push('A weight-times-price residual needs a weight and a price per kg, both above 0.');
  if (rule === 'NONE' && (t.residual_fixed_amount != null || t.residual_weight_kg != null || t.residual_price_per_kg != null)) e.push('Residual amounts were given but the residual rule is NONE.');

  if (t.costing_method === 'AMORTIZATION') {
    if (!(Number.isInteger(t.useful_life_months) && (t.useful_life_months as number) > 0)) e.push('Amortisation needs a useful life in whole months, above 0.');
  } else if (t.costing_method === 'FAIR_VALUE') {
    // The client's setup lists a useful life (36 / 18 months) for local fair-value assets too (FIXED ASSET tab, BBP S.NO.5). The
    // fair-value run does not use it; it is kept as stated and may be left empty.
    if (rule !== 'NONE') e.push('Fair value has no residual; set the residual rule to NONE.');
  }

  // BBP control: "Imported assets cannot use the local fair value method." The BBP's second half, "Local breeding assets cannot use imported
  // amortization rules", is NOT enforced (21 Oct 2026, Arun's instruction): a local asset may be amortised as well as fair-valued. Awaiting
  // the client's and Finance's sign-off, because the BBP and the Fixed Asset sheet give local assets the fair value method.
  if (t.origin === 'IMPORTED' && t.costing_method === 'FAIR_VALUE') e.push('An imported asset cannot be costed by fair value (BBP).');

  // The costing_method_config row for BIO_ASSET is what says the tenant supports the method at all.
  if (flags) {
    if (!flags.bio_asset_support) e.push('Biological-asset costing is not enabled for this tenant (costing method BIO_ASSET).');
    if (t.costing_method === 'AMORTIZATION' && !flags.amort_option) e.push('Amortisation is not enabled for biological assets (costing method BIO_ASSET).');
    if (t.costing_method === 'FAIR_VALUE' && !flags.fair_value_option) e.push('Fair value is not enabled for biological assets (costing method BIO_ASSET).');
  }
  return e;
}

export interface ActivationFacts {
  /** GL accounts of the profile that exist and belong to the tenant and company, by column. */
  glPresent: Record<string, boolean>;
  rateRows: number;
}

/** The GL columns each method needs before a profile can be activated. */
export const REQUIRED_GL: Record<string, Array<{ column: string; label: string }>> = {
  AMORTIZATION: [
    { column: 'acquisition_gl_id', label: 'acquisition cost' }, { column: 'accum_amort_gl_id', label: 'accumulated amortisation' },
    { column: 'amort_expense_gl_id', label: 'amortisation expense' }, { column: 'writeoff_gl_id', label: 'mortality / impairment loss' },
  ],
  FAIR_VALUE: [
    { column: 'acquisition_gl_id', label: 'acquisition cost' }, { column: 'fv_gain_loss_gl_id', label: 'fair value gain / loss' },
    { column: 'writeoff_gl_id', label: 'mortality / impairment loss' },
  ],
};

/** Plan V7 and the GL rule: a profile goes live only with its accounts and, for fair value, an input to value by. */
export function validateActivation(t: ProfileTerms, facts: ActivationFacts): string[] {
  const e: string[] = [];
  for (const g of REQUIRED_GL[t.costing_method] ?? []) {
    if (!facts.glPresent[g.column]) e.push(`The ${g.label} GL account is not set.`);
  }
  if (t.costing_method === 'FAIR_VALUE' && facts.rateRows < 1) e.push('Fair value needs at least one rate (expected weight and price per kg) before the profile can be activated.');
  return e;
}

export function scopeKey(companyId: string, t: Pick<ProfileTerms, 'item_id' | 'breed_id' | 'gender' | 'origin'>): string {
  return [companyId, t.item_id ?? '-', t.breed_id ?? '-', t.gender ?? '-', t.origin ?? '-'].join('|');
}

/**
 * PURCHASED_IMPORTED is imported; PURCHASED_LOCAL is local. BORN_ON_FARM is local too (21 Oct, Phase 5): the BBP makes a selected gilt "a Local asset"
 * (Local GGP / GP / Parent by her mating line). Transferred in is not named by any document (D2): null.
 */
export function originOf(entryType: string | null | undefined): 'IMPORTED' | 'LOCAL' | null {
  if (entryType === 'PURCHASED_IMPORTED') return 'IMPORTED';
  if (entryType === 'PURCHASED_LOCAL' || entryType === 'BORN_ON_FARM') return 'LOCAL';
  return null;
}

export interface ResolvableProfile extends ProfileTerms {
  profile_id: string;
  profile_code: string;
  status: string;
  effective_from: string;
  supersedes_profile_id?: string | null;
}
export interface AnimalFacts { item_id?: string | null; breed_id?: string | null; gender?: string | null; origin?: string | null }

/**
 * The profile an animal is costed by: among the profiles in force (ACTIVE, or SUPERSEDED but not yet replaced on that date) whose every pinned dimension (item, breed, gender, origin) matches
 * and which are in effect on `onDate`, the one that pins most. A profile that pins the item beats any group profile. Two that pin
 * the same number of dimensions and both match are ambiguous: the setup is wrong and nothing is guessed.
 */
export function resolveProfile<P extends ResolvableProfile>(
  profiles: P[], animal: AnimalFacts, onDate: string,
): { profile: P | null; ambiguous: P[] } {
  // A superseded profile still governs the dates before its successor takes effect; only from then on does the new version.
  const successorStart = new Map<string, string>();
  for (const p of profiles) if (p.supersedes_profile_id) successorStart.set(p.supersedes_profile_id, p.effective_from);
  const inForce = (p: P) =>
    p.effective_from <= onDate
    && (p.status === 'ACTIVE' || (p.status === 'SUPERSEDED' && (successorStart.get(p.profile_id) ?? '') > onDate));
  const matching = profiles
    .filter(inForce)
    .filter((p) => (!p.item_id || p.item_id === animal.item_id) && (!p.breed_id || p.breed_id === animal.breed_id)
      && (!p.gender || p.gender === animal.gender) && (!p.origin || p.origin === animal.origin))
    .map((p) => ({ p, score: (p.item_id ? 100 : 0) + [p.breed_id, p.gender, p.origin].filter(Boolean).length }))
    .sort((a, b) => b.score - a.score);
  if (!matching.length) return { profile: null, ambiguous: [] };
  const top = matching.filter((m) => m.score === matching[0].score);
  if (top.length > 1) return { profile: null, ambiguous: top.map((m) => m.p) };
  return { profile: top[0].p, ambiguous: [] };
}

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * The date an animal's costing begins: her birth date plus the start age (the client's formula sheet counts the start from the
 * date of birth), but never before she was on the books (ours, D4: no charge for days before the entry date). Without a birth date
 * her age at entry stands in: she was that many weeks old on her entry date. With neither there is no honest date: null.
 */
export function costingStartDate(
  a: { dob?: string | null; entry_date: string; age_at_entry_weeks?: number | null }, startAgeWeeks: number,
): string | null {
  let birth: string | null = a.dob ?? null;
  if (!birth && a.age_at_entry_weeks != null) birth = addDays(a.entry_date, -7 * a.age_at_entry_weeks);
  if (!birth) return null;
  const reached = addDays(birth, 7 * startAgeWeeks);
  return reached > a.entry_date ? reached : a.entry_date;
}

/** The residual an animal carries under a profile: the per-kg rule only for the gender it applies to (the client: females only). */
export function residualFor(t: ProfileTerms, gender: string | null | undefined): number {
  const rule = t.residual_rule ?? 'NONE';
  if (rule === 'NONE') return 0;
  if (t.residual_applies_gender && t.residual_applies_gender !== gender) return 0;
  if (rule === 'FIXED') return Math.round((num(t.residual_fixed_amount) ?? 0) * 1e4) / 1e4;
  return Math.round((num(t.residual_weight_kg) ?? 0) * (num(t.residual_price_per_kg) ?? 0) * 1e4) / 1e4;
}

// ---- the company's residual value setting -------------------------------------------------------------------------------

/**
 * The residual an animal is written down to is set once for the company (per sex, from a date) rather than on every profile, and an animal
 * may carry her own. Order of use: the animal's own residual, else the company setting in force on the day, else (an old tenant that has
 * no setting yet) the profile's own residual, which is how every residual was held before 21 Oct 2026.
 */
export interface ResidualSetting {
  gender: string;
  residual_rule: string;
  residual_fixed_amount?: string | number | null;
  residual_weight_kg?: string | number | null;
  residual_price_per_kg?: string | number | null;
  effective_from: string;
}
export type ResidualSource = 'ANIMAL' | 'COMPANY' | 'PROFILE';

export function validateResidualSetting(s: ResidualSetting): string[] {
  const e: string[] = [];
  if (!['F', 'M'].includes(s.gender)) e.push('Gender must be F or M.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.effective_from ?? '')) e.push('Give the date the setting takes effect from (YYYY-MM-DD).');
  if (!oneOf(RESIDUAL_RULES, s.residual_rule)) e.push(`Residual rule must be one of ${RESIDUAL_RULES.join(', ')}.`);
  if (s.residual_rule === 'FIXED' && !(num(s.residual_fixed_amount) !== null && num(s.residual_fixed_amount)! >= 0)) e.push('A fixed residual needs an amount of 0 or more.');
  if (s.residual_rule === 'WEIGHT_X_PRICE' && !(num(s.residual_weight_kg)! > 0 && num(s.residual_price_per_kg)! > 0)) e.push('A weight-times-price residual needs a weight and a price per kg, both above 0.');
  if (s.residual_rule === 'NONE' && (num(s.residual_fixed_amount) || num(s.residual_weight_kg) || num(s.residual_price_per_kg))) e.push('Amounts were given but the residual rule is NONE.');
  return e;
}

/** What one setting works out to: 0, the fixed amount, or weight x price. */
export function settingResidual(s: ResidualSetting): number {
  if (s.residual_rule === 'FIXED') return Math.round((num(s.residual_fixed_amount) ?? 0) * 1e4) / 1e4;
  if (s.residual_rule === 'WEIGHT_X_PRICE') return Math.round((num(s.residual_weight_kg) ?? 0) * (num(s.residual_price_per_kg) ?? 0) * 1e4) / 1e4;
  return 0;
}

/** The setting for this sex in force on the date: the latest one that took effect on or before it. */
export function pickResidualSetting<T extends ResidualSetting>(settings: T[], gender: string | null | undefined, onDate: string): T | null {
  const fit = settings.filter((x) => x.gender === gender && x.effective_from <= onDate);
  fit.sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
  return fit[0] ?? null;
}

export function resolveResidual(i: { animalOverride?: string | number | null; settings: ResidualSetting[]; profile: ProfileTerms; gender: string | null | undefined; onDate: string }): { value: number; source: ResidualSource } {
  const own = num(i.animalOverride);
  if (own !== null) return { value: Math.max(0, Math.round(own * 1e4) / 1e4), source: 'ANIMAL' };
  const setting = pickResidualSetting(i.settings, i.gender, i.onDate);
  if (setting) return { value: settingResidual(setting), source: 'COMPANY' };
  return { value: residualFor(i.profile, i.gender), source: 'PROFILE' };
}

/** The locked fields a change would alter, comparing the stored profile to the requested values. */
export function changedLockedFields(stored: Record<string, unknown>, change: Record<string, unknown>): string[] {
  const same = (a: unknown, b: unknown) => {
    if ((a ?? null) === (b ?? null)) return true;
    if (a == null || b == null) return false;
    // MySQL hands decimals back as strings ("2.050000"); the request may send 2.05.
    const x = Number(a), y = Number(b);
    return Number.isFinite(x) && Number.isFinite(y) && String(a).trim() !== '' && String(b).trim() !== '' ? x === y : String(a) === String(b);
  };
  return LOCKED_FIELDS.filter((f) => f in change && !same(stored[f], change[f]));
}
