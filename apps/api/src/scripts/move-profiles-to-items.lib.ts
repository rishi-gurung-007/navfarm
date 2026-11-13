/**
 * The plan for moving costing terms from the costing profile onto the biological Item (item-level costing, Phase 3). Pure: the script reads the
 * rows and this decides. It only ever proposes terms for an item that has none yet, and it refuses to guess: an item whose animals carry profiles
 * that disagree is reported as a conflict and left alone unless a person names the profile to take (`--pick=ITEM=PROFILE`).
 *
 * What the item takes from a profile is what the profile way would have charged her:
 *   - the method, start age, life, frequency, day basis, auto-post, the five GL accounts and the effective date, as the profile has them;
 *   - the residual the profile way READS: the company's residual setting in force today for the item's sex, else the profile's own rule;
 *   - the item's gender: that of its animals when they are all one sex, else the profile's.
 */
import { missingBioGl, validateItemBioCosting } from '../modules/master-data/item/item-bio-costing.rules';

export interface MoveItem { item_id: string; item_code: string; company_id: string | null; is_biological_asset: boolean | number; bio_costing_method: string | null }
export interface MoveAnimal { item_id: string; gender: string | null; costing_profile_id: string | null }
export interface MoveProfile {
  profile_id: string; profile_code: string; company_id: string; status: string; gender: string | null; costing_method: string; start_age_weeks: number; useful_life_months: number | null;
  residual_rule: string | null; residual_fixed_amount: string | number | null; residual_weight_kg: string | number | null; residual_price_per_kg: string | number | null; residual_applies_gender: string | null;
  run_frequency: string; day_basis: string; tracking: string; auto_post: boolean | number; effective_from: string;
  acquisition_gl_id: string | null; accum_amort_gl_id: string | null; amort_expense_gl_id: string | null; fv_gain_loss_gl_id: string | null; writeoff_gl_id: string | null;
}
export interface MoveSetting { company_id: string; gender: string; residual_rule: string; residual_fixed_amount: string | number | null; residual_weight_kg: string | number | null; residual_price_per_kg: string | number | null; effective_from: string }
export interface MoveRate { profile_id: string; farm_id: string | null; age_week_from: number; effective_from: string; expected_weight_kg: string | number; price_per_kg: string | number; cdm_based: boolean | number; costs_to_sell_pct: string | number | null }
export interface Pick { item_code: string; profile_code: string }

export interface ItemTerms {
  is_biological_asset: true;
  bio_costing_method: string; bio_gender: string | null; bio_start_age_weeks: number; bio_start_age_days: number; bio_useful_life_months: number | null;
  bio_residual_rule: string; bio_residual_fixed_amount: number | null; bio_residual_weight_kg: number | null; bio_residual_price_per_kg: number | null;
  bio_run_frequency: string; bio_day_basis: string; bio_effective_from: string; bio_auto_post: boolean;
  bio_acquisition_gl_id: string | null; bio_accum_amort_gl_id: string | null; bio_amort_expense_gl_id: string | null; bio_fv_gain_loss_gl_id: string | null; bio_writeoff_gl_id: string | null;
}
export interface ItemMove {
  item_id: string; item_code: string; from_profiles: string[]; animals: number; terms: ItemTerms; rates: Array<Omit<MoveRate, 'profile_id'>>; notes: string[]; missing_gl: string[];
}
export type SkipReason =
  | 'ALREADY_HAS_TERMS' | 'NO_PROFILE_ON_ANIMALS' | 'BATCH_TRACKED' | 'CONFLICT_TERMS' | 'CONFLICT_ACCOUNTS' | 'MIXED_GENDER_RESIDUAL' | 'INVALID_TERMS' | 'PICK_NOT_FOUND';
export interface Skip { item_code: string; reason: SkipReason; detail: string }
export interface MovePlan { moves: ItemMove[]; skipped: Skip[] }

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const TERM_FIELDS = ['costing_method', 'start_age_weeks', 'useful_life_months', 'residual_rule', 'residual_fixed_amount', 'residual_weight_kg', 'residual_price_per_kg', 'residual_applies_gender', 'run_frequency', 'day_basis', 'tracking', 'auto_post', 'effective_from'] as const;
const GL_FIELDS = ['acquisition_gl_id', 'accum_amort_gl_id', 'amort_expense_gl_id', 'fv_gain_loss_gl_id', 'writeoff_gl_id'] as const;
const norm = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'number' || /^-?\d+(\.\d+)?$/.test(String(v)) ? Number(v) : String(v));

const differing = (a: MoveProfile, b: MoveProfile, fields: readonly (keyof MoveProfile)[]) => fields.filter((f) => norm(a[f]) !== norm(b[f]));

/** The residual a profile-costed animal of this sex is written down to today: the company setting in force, else the profile's own rule. */
function residualOf(profile: MoveProfile, gender: string | null, settings: MoveSetting[], today: string): { rule: string; fixed: number | null; kg: number | null; price: number | null; notes: string[] } | { conflict: string } {
  const own = settings.filter((s) => s.company_id === profile.company_id && s.effective_from <= today);
  const notes: string[] = [];
  if (own.length && gender) {
    const mine = own.filter((s) => s.gender === gender).sort((a, b) => (a.effective_from < b.effective_from ? 1 : -1));
    if (mine.length) {
      const s = mine[0];
      const figures = new Set(mine.map((m) => `${m.residual_rule}|${norm(m.residual_fixed_amount)}|${norm(m.residual_weight_kg)}|${norm(m.residual_price_per_kg)}`));
      if (figures.size > 1) notes.push(`The company residual setting changed over time for this sex; the item takes the one in force today (from ${s.effective_from}). Runs already posted keep the residual they recorded.`);
      return { rule: s.residual_rule, fixed: num(s.residual_fixed_amount), kg: num(s.residual_weight_kg), price: num(s.residual_price_per_kg), notes };
    }
  } else if (own.length && !gender) {
    const latest = new Map<string, MoveSetting>();
    for (const s of own) { const k = s.gender; if (!latest.has(k) || latest.get(k)!.effective_from < s.effective_from) latest.set(k, s); }
    const figures = new Set([...latest.values()].map((m) => `${m.residual_rule}|${norm(m.residual_fixed_amount)}|${norm(m.residual_weight_kg)}|${norm(m.residual_price_per_kg)}`));
    if (figures.size > 1) return { conflict: 'The item\'s animals are of both sexes and the company\'s residual differs by sex; one item cannot carry two residuals.' };
    const s = [...latest.values()][0];
    return { rule: s.residual_rule, fixed: num(s.residual_fixed_amount), kg: num(s.residual_weight_kg), price: num(s.residual_price_per_kg), notes };
  }
  // no company setting for her sex: the profile's own rule, for the sex it applies to
  const applies = !profile.residual_applies_gender || profile.residual_applies_gender === gender;
  const rule = applies ? profile.residual_rule ?? 'NONE' : 'NONE';
  if (rule === 'NONE') return { rule: 'NONE', fixed: null, kg: null, price: null, notes };
  return { rule, fixed: num(profile.residual_fixed_amount), kg: num(profile.residual_weight_kg), price: num(profile.residual_price_per_kg), notes };
}

export function planMove(input: { items: MoveItem[]; animals: MoveAnimal[]; profiles: MoveProfile[]; settings: MoveSetting[]; rates: MoveRate[]; picks: Pick[]; today: string }): MovePlan {
  const moves: ItemMove[] = [];
  const skipped: Skip[] = [];
  const byId = new Map(input.profiles.map((p) => [p.profile_id, p]));

  for (const item of input.items.filter((i) => !!i.is_biological_asset).sort((a, b) => a.item_code.localeCompare(b.item_code))) {
    if (item.bio_costing_method) { skipped.push({ item_code: item.item_code, reason: 'ALREADY_HAS_TERMS', detail: `already ${item.bio_costing_method}; nothing is overwritten` }); continue; }
    const animals = input.animals.filter((a) => a.item_id === item.item_id);
    const carried = [...new Set(animals.map((a) => a.costing_profile_id).filter((x): x is string => !!x))].map((id) => byId.get(id)).filter((p): p is MoveProfile => !!p);
    const pick = input.picks.find((p) => p.item_code === item.item_code);

    let chosen: MoveProfile | undefined;
    if (pick) {
      chosen = input.profiles.find((p) => p.profile_code === pick.profile_code && (!item.company_id || p.company_id === item.company_id));
      if (!chosen) { skipped.push({ item_code: item.item_code, reason: 'PICK_NOT_FOUND', detail: `no profile ${pick.profile_code} in this company` }); continue; }
    } else if (!carried.length) {
      skipped.push({ item_code: item.item_code, reason: 'NO_PROFILE_ON_ANIMALS', detail: `${animals.length} animal(s), none carries a costing profile` }); continue;
    } else {
      const first = carried[0];
      const termDiffs = [...new Set(carried.slice(1).flatMap((p) => differing(first, p, TERM_FIELDS)))];
      const glDiffs = [...new Set(carried.slice(1).flatMap((p) => differing(first, p, GL_FIELDS)))];
      const names = carried.map((p) => p.profile_code).join(', ');
      if (termDiffs.length) { skipped.push({ item_code: item.item_code, reason: 'CONFLICT_TERMS', detail: `its animals carry ${names}, which differ in: ${termDiffs.join(', ')}. Name one with --pick=${item.item_code}=<profile>` }); continue; }
      if (glDiffs.length) { skipped.push({ item_code: item.item_code, reason: 'CONFLICT_ACCOUNTS', detail: `its animals carry ${names}: same terms, but different GL accounts (${glDiffs.join(', ')}). One item has one set of accounts; name one with --pick=${item.item_code}=<profile>` }); continue; }
      chosen = first;
    }
    if (chosen.tracking !== 'INDIVIDUAL') { skipped.push({ item_code: item.item_code, reason: 'BATCH_TRACKED', detail: `${chosen.profile_code} is batch-tracked; a run costs individually tracked animals only, so nothing is moved` }); continue; }

    const sexes = [...new Set(animals.map((a) => a.gender).filter((g): g is string => !!g))];
    const gender = sexes.length === 1 ? sexes[0] : chosen.gender;
    const notes: string[] = [];
    if (sexes.length > 1) notes.push(`its animals are of both sexes (${sexes.join(', ')}); the item takes gender ${gender ?? 'none'}`);
    if (carried.length > 1) notes.push(`merged ${carried.map((p) => p.profile_code).join(' + ')}: identical terms and accounts`);
    if (chosen.status === 'DRAFT') notes.push(`${chosen.profile_code} is a DRAFT profile; the item takes its terms but cannot run until its GL accounts are set`);
    // An item of both sexes can carry one residual only if the company's is the same for both.
    const res = residualOf(chosen, sexes.length > 1 ? null : gender, input.settings, input.today);
    if ('conflict' in res) { skipped.push({ item_code: item.item_code, reason: 'MIXED_GENDER_RESIDUAL', detail: res.conflict }); continue; }
    notes.push(...res.notes);

    const terms: ItemTerms = {
      is_biological_asset: true,
      bio_costing_method: chosen.costing_method, bio_gender: gender ?? null, bio_start_age_weeks: chosen.start_age_weeks, bio_start_age_days: 0,
      bio_useful_life_months: chosen.useful_life_months, bio_residual_rule: res.rule, bio_residual_fixed_amount: res.fixed, bio_residual_weight_kg: res.kg, bio_residual_price_per_kg: res.price,
      bio_run_frequency: chosen.run_frequency, bio_day_basis: chosen.day_basis, bio_effective_from: String(chosen.effective_from).slice(0, 10), bio_auto_post: !!chosen.auto_post,
      bio_acquisition_gl_id: chosen.acquisition_gl_id, bio_accum_amort_gl_id: chosen.accum_amort_gl_id, bio_amort_expense_gl_id: chosen.amort_expense_gl_id,
      bio_fv_gain_loss_gl_id: chosen.fv_gain_loss_gl_id, bio_writeoff_gl_id: chosen.writeoff_gl_id,
    };
    const problems = validateItemBioCosting(terms);
    if (problems.length) { skipped.push({ item_code: item.item_code, reason: 'INVALID_TERMS', detail: `${chosen.profile_code}'s terms do not pass the item's checks: ${problems.join(' ')}` }); continue; }
    const rates = input.rates.filter((r) => r.profile_id === chosen!.profile_id).map(({ profile_id: _p, ...r }) => r);
    moves.push({ item_id: item.item_id, item_code: item.item_code, from_profiles: (pick ? [chosen] : carried).map((p) => p.profile_code), animals: animals.length, terms, rates, notes, missing_gl: missingBioGl(terms) });
  }
  return { moves, skipped };
}
