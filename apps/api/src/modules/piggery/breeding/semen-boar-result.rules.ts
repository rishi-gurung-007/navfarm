/**
 * What each boar gave at a collection (plan 2026-11-02-ai-station-semen-collection, Phase 2). Pure, so the rules can be tested
 * without a database. The lot's doses and volume are the SUM of what its accepted boars gave; a rejected ejaculate is recorded
 * but is in none of the lot's doses, boars or costs.
 */

export interface BoarResultInput {
  boar_animal_id: string;
  collector_id?: string | null;
  volume_ml?: number | null;
  doses?: number | null;
  morphology_pct?: number | null;
  motility_pct?: number | null;
  concentration_m_per_ml?: number | null;
  /** Default true. */
  accepted?: boolean;
  reject_reason?: string | null;
}

const isAccepted = (r: BoarResultInput) => r.accepted !== false;

/**
 * What is wrong with the results of a collection, as sentences. `lotBoarIds` are the boars the lot is made from (the primary
 * and the pooled ones); every one needs an accepted result. A result for any other boar must be a rejection: he was tapped,
 * his ejaculate was not used.
 */
export function boarResultIssues(results: BoarResultInput[], lotBoarIds: string[], codeOf: (id: string) => string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (seen.has(r.boar_animal_id)) out.push(`${codeOf(r.boar_animal_id)} has two results; give each boar one.`);
    seen.add(r.boar_animal_id);
  }
  for (const id of lotBoarIds) {
    const r = results.find((x) => x.boar_animal_id === id);
    if (!r) out.push(`${codeOf(id)} is in the lot but has no result.`);
    else if (!isAccepted(r)) out.push(`${codeOf(id)}'s ejaculate was rejected, so he is not in the lot; name him in the results only.`);
  }
  for (const r of results) {
    const who = codeOf(r.boar_animal_id);
    if (isAccepted(r)) {
      if (!lotBoarIds.includes(r.boar_animal_id)) out.push(`${who} has an accepted result but is not one of the lot's boars.`);
      if (r.doses == null || !Number.isInteger(r.doses) || r.doses < 1) out.push(`${who}: doses must be a whole number, at least 1.`);
    } else if (!r.reject_reason?.trim()) {
      out.push(`${who}: say why the ejaculate was rejected.`);
    }
  }
  if (!results.some(isAccepted)) out.push('At least one boar\'s ejaculate must be accepted into the lot.');
  return out;
}

export interface LotTotals {
  /** Whole doses of the accepted boars added up. */
  doses: number;
  /** Their raw volume added up, or null unless every accepted boar gave one (a partial sum would read as the whole). */
  volume_ml: number | null;
}

export function lotTotals(results: BoarResultInput[]): LotTotals {
  const accepted = results.filter(isAccepted);
  const volumes = accepted.map((r) => r.volume_ml);
  return {
    doses: accepted.reduce((t, r) => t + (r.doses ?? 0), 0),
    volume_ml: accepted.length && volumes.every((v) => v != null) ? Math.round(volumes.reduce((t, v) => t + (v as number), 0) * 100) / 100 : null,
  };
}
