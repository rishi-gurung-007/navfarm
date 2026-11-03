/**
 * The AI Station set-up the client's documents describe, as data (plan 2026-11-02-ai-station-semen-collection, Phase 7): the rules of
 * the Tempo, L-Line and Z-Line (Breeding Boars and Selection Process.pdf), the Collector IDs on its sheets, and the five-point boar
 * body condition scale (SOP 21, Boar Body Condition Scoring, issue 01).
 *
 * NAMED FIXTURE, NOT DEFAULTS. Nothing in the application assumes these values; this is one customer's documented set-up, applied on
 * request and editable afterwards. Where the documents say nothing the field is left empty, not filled in:
 *  - genetic-level thresholds (the sheets show levels, not the TSI bands behind them)  -> no bands
 *  - the Tempo label, rest days, motility floor, collector names, destination farms     -> not given
 * What is OURS, not the client's, is marked [ours] in the plan the script prints.
 */

export type Provenance = 'client' | 'ours';

export interface LineFixture {
  /** The breed code of the line. */
  breed_code: string;
  /** The setup body as POST /breeding-line-setup takes it (breed_id is added by the script). */
  body: Record<string, unknown>;
  /** What each field rests on, for the printed plan. */
  notes: { field: string; source: Provenance; text: string }[];
}

export interface FarmChoices {
  /** The farms Tempo semen is for (Grasmere, Porta, Richlands, LionHead, Villa Franca on the client's sheet): given by id, never guessed. */
  tempoFarmIds: string[];
  /** The Multiplier farm Z-Line semen is for. */
  multiplierFarmId: string | null;
}

/** The sheets' own overall grading: genetic rank and morphology rank equally, dose rank not used (checked against every row of both sheets). */
const SHEET_GRADING = { grading_genetic_weight: 1, grading_dose_weight: 0, grading_morphology_weight: 1 };
/** SOP 21 asks for a monthly assessment: read here as every 30 days. */
const MONTHLY = { bcs_frequency_days: 30 };

export function lineFixtures(farms: FarmChoices): LineFixture[] {
  const tempoFarms = farms.tempoFarmIds.length > 0;
  return [
    {
      breed_code: 'Tempo',
      body: {
        collection_mode: 'SCHEDULED',
        collection_weekdays: ['SUN', 'WED'],
        pooling_allowed: true,
        ...(tempoFarms ? { destination_rule: 'LIST', destination_farm_ids: farms.tempoFarmIds } : { destination_rule: 'ANY' }),
        ...SHEET_GRADING,
        ...MONTHLY,
      },
      notes: [
        { field: 'collection days', source: 'client', text: 'Tapped on a fixed weekly schedule every Sunday and Wednesday.' },
        { field: 'pooling', source: 'client', text: 'Semen is pooled into dedicated batches.' },
        { field: 'grading', source: 'client', text: 'Overall grading on the sheet = genetic rank and morphology rank equally.' },
        { field: 'destination', source: tempoFarms ? 'client' : 'ours', text: tempoFarms ? 'Commercial growing stock farms (the farms passed in).' : 'Not set: no farms were passed in (--tempo-farms); semen may go to any farm.' },
        { field: 'label / colorant', source: 'client', text: 'None stated for Tempo: left empty.' },
        { field: 'score a boar every', source: 'ours', text: 'SOP 21 says monthly; read as 30 days.' },
      ],
    },
    {
      breed_code: 'L-Line',
      body: {
        collection_mode: 'SCHEDULED',
        collection_weekdays: ['SUN', 'WED'],
        boars_per_collection_day: 2,
        pooling_allowed: true,
        colorant_name: 'Green',
        label_template: 'POOLL-{WEEK}',
        destination_rule: 'ANY',
        ...SHEET_GRADING,
        ...MONTHLY,
      },
      notes: [
        { field: 'collection days', source: 'client', text: 'Tapped every Sunday and Wednesday; exactly 2 boars per collection day.' },
        { field: 'pooling / label', source: 'client', text: 'Pooled and labelled POOLL-<WEEK NUMBER>.' },
        { field: 'colorant', source: 'client', text: 'A green colorant is added to the pooled semen. No stock item is named, so it is recorded, not issued.' },
        { field: 'destination', source: 'client', text: 'Not stated for L-Line: left open.' },
        { field: 'score a boar every', source: 'ours', text: 'SOP 21 says monthly; read as 30 days.' },
      ],
    },
    {
      breed_code: 'Z-Line',
      body: {
        collection_mode: 'ON_REQUEST',
        pooling_allowed: false,
        max_boars_per_lot: 1,
        colorant_name: 'Red',
        label_template: '{BOAR_TAG}-{WEEK}',
        reference_required: true,
        reference_label: 'Breeding Web reference',
        ...(farms.multiplierFarmId
          ? { destination_rule: 'ONE', destination_farm_ids: [farms.multiplierFarmId], restrict_to_destination: 'BLOCK' }
          : { destination_rule: 'ANY' }),
        ...MONTHLY,
      },
      notes: [
        { field: 'collection', source: 'client', text: 'Tapped strictly as needed, asked by the Multiplier Unit and guided by Breeding Web.' },
        { field: 'pooling', source: 'client', text: 'Never pooled: one boar per batch, sachets belong to one boar.' },
        { field: 'label / colorant', source: 'client', text: 'Labelled <boar tag>-<WEEK NUMBER>; a red colorant per boar (recorded, not issued).' },
        { field: 'reference', source: 'client', text: 'Collected for the Multiplier Farm as recommended by Breeding Web: its reference is required.' },
        { field: 'destination', source: farms.multiplierFarmId ? 'client' : 'ours', text: farms.multiplierFarmId ? 'Exclusively for the Multiplier Farm (the farm passed in): other uses are blocked.' : 'Not set: no farm was passed in (--multiplier-farm).' },
        { field: 'grading', source: 'client', text: 'The Z-Line sheet has dose and morphology ranks only, no overall grading: none is set.' },
        { field: 'score a boar every', source: 'ours', text: 'SOP 21 says monthly; read as 30 days.' },
      ],
    },
  ];
}

/** The company default: any line without a setup of its own reads this. It only carries the body condition schedule. */
export const COMPANY_DEFAULT_SETUP = { collection_mode: 'ON_REQUEST', ...MONTHLY } as const;

/** The collectors on the client's sheets. Their names are not given: each is named by its own ID until someone renames it. */
export const COLLECTOR_CODES = ['CM', 'AW', 'TA'] as const;

export interface BcsScaleFixture {
  score: number;
  score_name: string;
  indicators: string;
  required_action: string | null;
  feed_kg_per_day: number;
  health_assessment_required: boolean;
  medication_review: boolean;
  sop_reference: string;
}

/** SOP 21, "Boar Body Score Guide and Required Action". */
export const BCS_SCALE_FIXTURE: BcsScaleFixture[] = [
  { score: 1, score_name: 'Very thin', indicators: 'Very thin; hips, ribs and backbone are highly prominent.', required_action: 'Assess health status. Possible medication requirement', feed_kg_per_day: 4, health_assessment_required: true, medication_review: true, sop_reference: 'Doc 21, Issue 01' },
  { score: 2, score_name: 'Below normal', indicators: 'Below normal; inadequate fat cover.', required_action: 'Assess health status', feed_kg_per_day: 3.5, health_assessment_required: true, medication_review: false, sop_reference: 'Doc 21, Issue 01' },
  { score: 3, score_name: 'Normal / ideal', indicators: 'Normal/ideal; balanced muscling and fat cover.', required_action: null, feed_kg_per_day: 3, health_assessment_required: false, medication_review: false, sop_reference: 'Doc 21, Issue 01' },
  { score: 4, score_name: 'Overfat', indicators: 'Overfat; excess cover over frame.', required_action: null, feed_kg_per_day: 2.5, health_assessment_required: false, medication_review: false, sop_reference: 'Doc 21, Issue 01' },
  { score: 5, score_name: 'Obese', indicators: 'Obese; poor body balance and excess fat.', required_action: null, feed_kg_per_day: 2.3, health_assessment_required: false, medication_review: false, sop_reference: 'Doc 21, Issue 01' },
];

export interface Existing {
  /** breed_code -> breed id, for the company's own breeds. */
  breeds: Map<string, string>;
  /** Breed ids that already have a setup row, and whether the company default does (key ''). */
  setupBreedIds: Set<string>;
  scaleScores: Set<number>;
  collectorCodes: Set<string>;
}

export type Action =
  | { kind: 'setup' | 'default-setup' | 'scale' | 'collector'; key: string; do: 'create'; path: string; body: Record<string, unknown>; notes?: LineFixture['notes'] }
  | { kind: 'setup' | 'default-setup' | 'scale' | 'collector'; key: string; do: 'exists' | 'skip'; why: string };

/** What the script would do, given what is already there: anything that exists is left alone, a line with no breed is skipped and said so. */
export function planFixture(existing: Existing, farms: FarmChoices): Action[] {
  const out: Action[] = [];
  for (const line of lineFixtures(farms)) {
    const breedId = existing.breeds.get(line.breed_code);
    if (!breedId) out.push({ kind: 'setup', key: line.breed_code, do: 'skip', why: `no breed "${line.breed_code}" in this company` });
    else if (existing.setupBreedIds.has(breedId)) out.push({ kind: 'setup', key: line.breed_code, do: 'exists', why: 'the line already has a setup' });
    else out.push({ kind: 'setup', key: line.breed_code, do: 'create', path: '/breeding-line-setup', body: { breed_id: breedId, ...line.body }, notes: line.notes });
  }
  out.push(
    existing.setupBreedIds.has('')
      ? { kind: 'default-setup', key: 'company default', do: 'exists', why: 'the company default setup already exists' }
      : { kind: 'default-setup', key: 'company default', do: 'create', path: '/breeding-line-setup', body: { ...COMPANY_DEFAULT_SETUP } },
  );
  for (const row of BCS_SCALE_FIXTURE) {
    out.push(
      existing.scaleScores.has(row.score)
        ? { kind: 'scale', key: `score ${row.score}`, do: 'exists', why: 'the default scale already has this score' }
        : { kind: 'scale', key: `score ${row.score}`, do: 'create', path: '/bcs-scale', body: { ...row } },
    );
  }
  for (const code of COLLECTOR_CODES) {
    out.push(
      existing.collectorCodes.has(code)
        ? { kind: 'collector', key: code, do: 'exists', why: 'the collector already exists' }
        : { kind: 'collector', key: code, do: 'create', path: '/semen-collector', body: { collector_code: code, collector_name: code } },
    );
  }
  return out;
}
