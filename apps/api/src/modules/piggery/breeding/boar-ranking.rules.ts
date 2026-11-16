/**
 * Boar ranking for the AI Station's selection table (plan 2026-11-02-ai-station-semen-collection, Phase 3). Pure: the table's
 * ranks, genetic level and overall grading come from the boars' figures, the line's genetic-level bands and its grading
 * formula, none of which is a constant here.
 *
 * What the client's sheets show, and what this reproduces:
 *  - Genetic rank is the herd-wide rank published with a boar's TSI (it has gaps on a sheet that lists a part of the herd), and
 *    is used as given. Where no published rank is held it is worked out from TSI, highest first.
 *  - Dose rank and morphology rank are ranked among the boars shown that have a last collection: more doses, and a higher
 *    morphology, rank better. A boar with no collection on record has no figure and no rank, never zero.
 *  - Overall grading is the weighted average of the ranks the line's formula uses (the sheets' is genetic and morphology rank,
 *    equally, with dose rank unused); lower is better. Overall rank orders the grading, lowest first.
 *  - Where two boars tie, the sheets give the better genetic rank the better place, so every rank is a distinct number; the line
 *    can instead let tied boars share a rank.
 */

export type TieBreak = 'GENETIC_RANK' | 'SHARED';

export interface GradingFormula {
  /** Relative weights of the ranks in the overall grading. Null or 0 = that rank is not used. */
  genetic_weight: number | null;
  dose_weight: number | null;
  morphology_weight: number | null;
  tie_break: TieBreak;
}

/** A genetic level is a band of TSI, inclusive at both ends; a null end is open. */
export interface GeneticBand {
  level_name: string;
  tsi_from: number | null;
  tsi_to: number | null;
}

export interface RankInput {
  boar_id: string;
  boar_code: string;
  tsi: number | null;
  /** The herd-wide rank published with the TSI, when one was given. */
  published_rank: number | null;
  /** The doses of the boar's last accepted collection, null when there is none. */
  last_doses: number | null;
  last_morphology_pct: number | null;
}

export interface RankOutput {
  boar_id: string;
  genetic_rank: number | null;
  genetic_level: string | null;
  dose_rank: number | null;
  morphology_rank: number | null;
  overall_grading: number | null;
  overall_rank: number | null;
}

/** The level whose band holds this TSI. Bands that overlap give the first listed; a TSI in no band, or none at all, has no level. */
export function geneticLevelOf(tsi: number | null, bands: GeneticBand[]): string | null {
  if (tsi == null) return null;
  return bands.find((b) => (b.tsi_from == null || tsi >= b.tsi_from) && (b.tsi_to == null || tsi <= b.tsi_to))?.level_name ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Ranks `items` by `value` (most first when `higherIsBetter`). Items with no value get no rank. A tie goes to whoever comes
 * first in `listOrder` (the better genetic rank), or is shared when `shared`: 1, 2, 2, 4.
 */
function rankBy<T extends { boar_id: string }>(
  items: T[],
  value: (t: T) => number | null,
  higherIsBetter: boolean,
  listOrder: Map<string, number>,
  shared: boolean,
): Map<string, number> {
  const ranked = items
    .filter((t) => value(t) != null)
    .sort((a, b) => {
      const d = (value(a) as number) - (value(b) as number);
      return (higherIsBetter ? -d : d) || (listOrder.get(a.boar_id) as number) - (listOrder.get(b.boar_id) as number);
    });
  const out = new Map<string, number>();
  ranked.forEach((t, i) => {
    const same = shared && i > 0 && value(ranked[i - 1]) === value(t);
    out.set(t.boar_id, same ? (out.get(ranked[i - 1].boar_id) as number) : i + 1);
  });
  return out;
}

export function rankBoars(inputs: RankInput[], formula: GradingFormula, bands: GeneticBand[]): RankOutput[] {
  const shared = formula.tie_break === 'SHARED';

  // Genetic rank: as published when every boar with a TSI has one (a mix would collide), else worked out from TSI.
  const withTsi = inputs.filter((b) => b.tsi != null);
  const publishedAll = withTsi.length > 0 && withTsi.every((b) => b.published_rank != null);
  const geneticRank = new Map<string, number>();
  if (publishedAll) {
    for (const b of withTsi) geneticRank.set(b.boar_id, b.published_rank as number);
  } else {
    [...withTsi]
      .sort((a, b) => (b.tsi as number) - (a.tsi as number) || a.boar_code.localeCompare(b.boar_code))
      .forEach((b, i, all) => {
        const same = shared && i > 0 && all[i - 1].tsi === b.tsi;
        geneticRank.set(b.boar_id, same ? (geneticRank.get(all[i - 1].boar_id) as number) : i + 1);
      });
  }

  // The list order a tie is broken by: the better genetic rank first, then the code. A boar with no TSI comes last.
  const listOrder = new Map(
    [...inputs]
      .sort(
        (a, b) =>
          (geneticRank.get(a.boar_id) ?? Number.MAX_SAFE_INTEGER) - (geneticRank.get(b.boar_id) ?? Number.MAX_SAFE_INTEGER) ||
          a.boar_code.localeCompare(b.boar_code),
      )
      .map((b, i) => [b.boar_id, i] as const),
  );

  const doseRank = rankBy(inputs, (b) => b.last_doses, true, listOrder, shared);
  const morphologyRank = rankBy(inputs, (b) => b.last_morphology_pct, true, listOrder, shared);

  const parts = [
    [formula.genetic_weight, geneticRank],
    [formula.dose_weight, doseRank],
    [formula.morphology_weight, morphologyRank],
  ] as const;
  const grading = new Map<string, number>();
  for (const b of inputs) {
    const used = parts.filter(([w]) => w != null && w > 0);
    if (!used.length) continue;
    const ranks = used.map(([w, ranksOf]) => [w as number, ranksOf.get(b.boar_id)] as const);
    if (ranks.some(([, r]) => r == null)) continue;
    const totalWeight = ranks.reduce((t, [w]) => t + w, 0);
    grading.set(b.boar_id, round2(ranks.reduce((t, [w, r]) => t + w * (r as number), 0) / totalWeight));
  }
  const overallRank = rankBy(inputs, (b) => grading.get(b.boar_id) ?? null, false, listOrder, shared);

  return inputs.map((b) => ({
    boar_id: b.boar_id,
    genetic_rank: geneticRank.get(b.boar_id) ?? null,
    genetic_level: geneticLevelOf(b.tsi, bands),
    dose_rank: doseRank.get(b.boar_id) ?? null,
    morphology_rank: morphologyRank.get(b.boar_id) ?? null,
    overall_grading: grading.get(b.boar_id) ?? null,
    overall_rank: overallRank.get(b.boar_id) ?? null,
  }));
}
