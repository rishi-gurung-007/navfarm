import { birthDate } from '../../finance/bio-costing/bio-costing.engine';

/**
 * 25 Nov: the age in days of the animals a batch row stands for, on a given date. An animal-wise stage group reads
 * its animals' birth dates. A count-only batch has no birth date of its own, so it ages from the litters behind it:
 * the farrowings of the lot, or the head each source batch moved into it. With neither on record, the age is
 * estimated from the stages the pigs have passed through (Rishi, 25 Nov).
 */
export interface LitterFact {
  batchId: string;
  farrowingDate: string;
  piglets: number;
}
export interface MoveFact {
  fromBatchId: string;
  toBatchId: string;
  heads: number;
  date: string;
}
export interface AnimalAgeFact {
  batchId: string;
  stageId: string | null;
  dob: string | null;
  entryDate: string;
  ageAtEntryWeeks: number | null;
}

const dayNumber = (date: string) =>
  Date.parse(`${date.slice(0, 10)}T00:00:00Z`) / 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

type Parts = Array<{ birthDay: number; weight: number }>;
const weightedBirthDay = (parts: Parts): number | null => {
  const weight = parts.reduce((sum, p) => sum + p.weight, 0);
  return weight > 0
    ? parts.reduce((sum, p) => sum + p.birthDay * p.weight, 0) / weight
    : null;
};

/** Batch id -> average age in days; a batch with no farrowing anywhere behind it has no entry. */
export function lineageAges(args: {
  batchIds: string[];
  asOf: string;
  farrowings: LitterFact[];
  transfers: MoveFact[];
}): Map<string, number> {
  const { batchIds, asOf, farrowings, transfers } = args;
  const asOfDay = dayNumber(asOf);
  const birthDayOf = (batchId: string, seen: Set<string>): number | null => {
    if (seen.has(batchId)) return null;
    const path = new Set(seen).add(batchId);
    const parts: Parts = farrowings
      .filter((f) => f.batchId === batchId && dayNumber(f.farrowingDate) <= asOfDay)
      .map((f) => ({ birthDay: dayNumber(f.farrowingDate), weight: f.piglets }));
    for (const move of transfers) {
      if (move.toBatchId !== batchId || dayNumber(move.date) > asOfDay) continue;
      const birthDay = birthDayOf(move.fromBatchId, path);
      if (birthDay !== null) parts.push({ birthDay, weight: move.heads });
    }
    return weightedBirthDay(parts);
  };
  const ages = new Map<string, number>();
  for (const batchId of batchIds) {
    const birthDay = birthDayOf(batchId, new Set());
    if (birthDay !== null) ages.set(batchId, round1(asOfDay - birthDay));
  }
  return ages;
}

/** "batchId:stageId" (the forecast's id for an animal-wise row) -> average age in days of its animals. */
export function animalAgesByGroup(
  asOf: string,
  animals: AnimalAgeFact[],
): Map<string, number> {
  const groups = new Map<string, number[]>();
  for (const animal of animals) {
    const born = birthDate({
      dob: animal.dob,
      entry_date: animal.entryDate,
      age_at_entry_weeks: animal.ageAtEntryWeeks,
    });
    if (!born) continue;
    const key = `${animal.batchId}:${animal.stageId}`;
    groups.set(key, [...(groups.get(key) ?? []), dayNumber(asOf) - dayNumber(born)]);
  }
  return new Map(
    [...groups].map(([key, ages]) => [
      key,
      round1(ages.reduce((sum, age) => sum + age, 0) / ages.length),
    ]),
  );
}

export interface AgeStage {
  stageId: string;
  stageCode: string;
  durationDays: number | null;
  nextStageId: string | null;
  lobId: string;
  companyId: string | null;
}

/**
 * Estimated age on day `stageDay` of a growing stage: the suckling days (Lactation — the sow's stage, which leads back
 * to the sow cycle rather than into Weaner, so it is added on its own), each earlier stage back to Weaner, and the
 * days gone in this one. Null for any stage that does not lead back to Weaner, or when a duration is not set.
 */
export function stageAgeDays(
  stageId: string,
  stageDay: number,
  stages: AgeStage[],
): number | null {
  let stage = stages.find((s) => s.stageId === stageId);
  let days = stageDay - 1;
  const seen = new Set<string>();
  while (stage && stage.stageCode !== 'WEANER') {
    seen.add(stage.stageId);
    const into: string = stage.stageId;
    const earlier = stages.filter((s) => s.nextStageId === into);
    if (earlier.length !== 1 || seen.has(earlier[0].stageId)) return null;
    stage = earlier[0];
    if (!stage.durationDays) return null;
    days += stage.durationDays;
  }
  if (!stage) return null;
  const weaner = stage;
  const suckling = stages.find(
    (s) =>
      s.stageCode === 'LACTATION' &&
      s.lobId === weaner.lobId &&
      s.companyId === weaner.companyId,
  )?.durationDays;
  return suckling ? days + suckling : null;
}
