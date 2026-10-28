/**
 * The bio-asset roll-forward split by costing profile, and the tie of each profile's movements to the GL accounts it posts to
 * (bio-asset costing, Phase 6). Pure: the report service loads the rows and these functions add them up.
 */
import { BOOK_VALUE_EVENTS } from '../../inventory/bio-asset-ledger/animal-book-value.service';
import type { BioEvent } from '../../inventory/bio-asset-ledger/bio-asset-ledger.types';

const CAPITALISED = new Set<BioEvent>(['CONSUMPTION', 'OVERHEAD_COST']);
// COST_ALLOCATION: a sow's lactation cost handed to her litter (negative on her, positive on the lot's batch-level row), so the total is unchanged.
const EXITS = new Set<BioEvent>(['MORTALITY', 'TRANSFORMATION', 'COST_ALLOCATION']);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface LedgerFact {
  /** The costing profile of the animal the row is on; null for an animal with no profile. */
  profile_code: string | null;
  /** False for a batch-level row (no animal on it). */
  has_animal: boolean;
  /** What the row records (bioEventOf), not its entry type, which several events share. */
  event: BioEvent | null;
  posting_date: string;
  amount: number;
}

export interface ProfileRollForward {
  key: string;
  label: 'PROFILE' | 'NO_PROFILE' | 'BATCH_LEVEL';
  profile_code: string | null;
  opening: number;
  acquisitions: number;
  capitalised: number;
  amortisation: number;
  fairValue: number;
  exits: number;
  closing: number;
}

const blank = (key: string, label: ProfileRollForward['label'], profile_code: string | null): ProfileRollForward => ({
  key, label, profile_code, opening: 0, acquisitions: 0, capitalised: 0, amortisation: 0, fairValue: 0, exits: 0, closing: 0,
});

/**
 * One row per profile, plus "animals with no profile" and "batch-level rows" (cost the ledger holds against a batch, not an animal).
 * Only the events that make up a carrying value count; a transfer or a GRN purchase row moves nothing. Movements are as the
 * ledger stores them: amortisation negative, a fair-value loss negative, an exit negative.
 */
export function rollForwardByProfile(rows: LedgerFact[], dateFrom: string, dateTo: string): ProfileRollForward[] {
  const byKey = new Map<string, ProfileRollForward>();
  for (const r of rows) {
    if (!r.event || !BOOK_VALUE_EVENTS.includes(r.event)) continue;
    if (r.posting_date > dateTo) continue;
    const key = !r.has_animal ? 'BATCH_LEVEL' : r.profile_code ? `P:${r.profile_code}` : 'NO_PROFILE';
    const row = byKey.get(key) ?? blank(key, !r.has_animal ? 'BATCH_LEVEL' : r.profile_code ? 'PROFILE' : 'NO_PROFILE', r.profile_code);
    if (r.posting_date < dateFrom) row.opening += r.amount;
    else if (r.event === 'ACQUISITION') row.acquisitions += r.amount;
    else if (CAPITALISED.has(r.event)) row.capitalised += r.amount;
    else if (r.event === 'AMORTIZATION') row.amortisation += r.amount;
    else if (r.event === 'FAIR_VALUE_ADJMT') row.fairValue += r.amount;
    else if (EXITS.has(r.event)) row.exits += r.amount;
    byKey.set(key, row);
  }
  const out = [...byKey.values()].map((x) => {
    const row = { ...x, opening: r4(x.opening), acquisitions: r4(x.acquisitions), capitalised: r4(x.capitalised), amortisation: r4(x.amortisation), fairValue: r4(x.fairValue), exits: r4(x.exits) };
    return { ...row, closing: r4(row.opening + row.acquisitions + row.capitalised + row.amortisation + row.fairValue + row.exits) };
  });
  const order = (x: ProfileRollForward) => (x.label === 'PROFILE' ? 0 : x.label === 'NO_PROFILE' ? 1 : 2);
  return out.sort((a, b) => order(a) - order(b) || (a.profile_code ?? '').localeCompare(b.profile_code ?? ''));
}

export type TieRole = 'AMORTISATION_EXPENSE' | 'ACCUMULATED_AMORTISATION' | 'FAIR_VALUE_GAIN_LOSS';
export interface TieOutRow {
  role: TieRole;
  account_code: string;
  account_name: string;
  basis: 'PERIOD' | 'TO_DATE';
  /** What the bio-asset ledger says the account should hold, in the account's normal direction (expense debit, accumulated credit, gain credit). */
  ledger: number;
  /** What the GL (the trial balance's own journal lines) holds for the account, from costing-run and exit journals. */
  gl: number;
  difference: number;
  reconciled: boolean;
}

export function tieOutRow(
  role: TieRole, account: { code: string; name: string }, basis: TieOutRow['basis'], ledger: number, gl: number, tolerance = 0.01,
): TieOutRow {
  const difference = r4(gl - ledger);
  return { role, account_code: account.code, account_name: account.name, basis, ledger: r4(ledger), gl: r4(gl), difference, reconciled: Math.abs(difference) < tolerance };
}
