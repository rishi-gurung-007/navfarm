import { lineFixtures as fixtures, BCS_SCALE_FIXTURE, COLLECTOR_CODES, Existing, planFixture } from './ai-station-fixture.lib';
import { lineSetupIssues } from '../modules/master-data/breeding-line/breeding-line.rules';

const none: Existing = { breeds: new Map([['Tempo', 'b-t'], ['L-Line', 'b-l'], ['Z-Line', 'b-z']]), setupBreedIds: new Set(), scaleScores: new Set(), collectorCodes: new Set() };
const farms = { tempoFarmIds: ['f1', 'f2'], multiplierFarmId: 'fm' };

describe('the AI Station fixture', () => {
  it('gives each line the rules its sheet states, and no more', () => {
    const [tempo, l, z] = fixtures(farms);
    expect(tempo.body).toMatchObject({ collection_mode: 'SCHEDULED', collection_weekdays: ['SUN', 'WED'], pooling_allowed: true, destination_rule: 'LIST', destination_farm_ids: ['f1', 'f2'] });
    expect(tempo.body.label_template).toBeUndefined();
    expect(tempo.body.colorant_name).toBeUndefined();
    expect(l.body).toMatchObject({ collection_weekdays: ['SUN', 'WED'], boars_per_collection_day: 2, pooling_allowed: true, colorant_name: 'Green', label_template: 'POOLL-{WEEK}' });
    expect(z.body).toMatchObject({ collection_mode: 'ON_REQUEST', pooling_allowed: false, max_boars_per_lot: 1, colorant_name: 'Red', label_template: '{BOAR_TAG}-{WEEK}', reference_required: true, destination_rule: 'ONE', destination_farm_ids: ['fm'], restrict_to_destination: 'BLOCK' });
  });

  it('puts no colorant item, no rest days, no motility floor and no genetic-level band anywhere: the documents give none', () => {
    for (const f of fixtures(farms)) {
      expect(f.body.colorant_item_id).toBeUndefined();
      expect(f.body.min_rest_days).toBeUndefined();
      expect(f.body.min_motility_pct).toBeUndefined();
    }
  });

  it('uses the sheets\' grading (genetic and morphology rank equally) for Tempo and L-Line, and none for Z-Line, whose sheet has none', () => {
    const [tempo, l, z] = fixtures(farms);
    for (const f of [tempo, l]) expect(f.body).toMatchObject({ grading_genetic_weight: 1, grading_dose_weight: 0, grading_morphology_weight: 1 });
    expect(z.body.grading_genetic_weight).toBeUndefined();
  });

  it('leaves a destination open when no farm was passed in, rather than guessing one, and says so', () => {
    const [tempo, , z] = fixtures({ tempoFarmIds: [], multiplierFarmId: null });
    expect(tempo.body).toMatchObject({ destination_rule: 'ANY' });
    expect(z.body).toMatchObject({ destination_rule: 'ANY' });
    expect(z.body.restrict_to_destination).toBeUndefined();
    expect(tempo.notes.find((n) => n.field === 'destination')).toMatchObject({ source: 'ours' });
  });

  it('is accepted by the same rules the API applies when a setup is saved', () => {
    for (const f of [...fixtures(farms), ...fixtures({ tempoFarmIds: [], multiplierFarmId: null })]) {
      expect(lineSetupIssues({ collection_mode: 'SCHEDULED', pooling_allowed: true, destination_rule: 'ANY', restrict_to_destination: 'NONE', ...(f.body as any) })).toEqual([]);
    }
  });

  it('marks what is ours: the monthly schedule is read as 30 days', () => {
    for (const f of fixtures(farms)) expect(f.notes.find((n) => n.field === 'score a boar every')).toMatchObject({ source: 'ours' });
  });

  it('holds SOP 21\'s five scores with their feed levels, actions and flags', () => {
    expect(BCS_SCALE_FIXTURE.map((r) => [r.score, r.feed_kg_per_day])).toEqual([[1, 4], [2, 3.5], [3, 3], [4, 2.5], [5, 2.3]]);
    expect(BCS_SCALE_FIXTURE.filter((r) => r.health_assessment_required).map((r) => r.score)).toEqual([1, 2]);
    expect(BCS_SCALE_FIXTURE.filter((r) => r.medication_review).map((r) => r.score)).toEqual([1]);
  });

  it('names the three collectors by their IDs, since no names were given', () => {
    expect(COLLECTOR_CODES).toEqual(['CM', 'AW', 'TA']);
  });
});

describe('planFixture', () => {
  it('creates everything on an empty company', () => {
    const plan = planFixture(none, farms);
    expect(plan.filter((a) => a.do === 'create')).toHaveLength(3 + 1 + 5 + 3);
    expect(plan.every((a) => a.do === 'create')).toBe(true);
  });

  it('leaves what exists alone, so it can be run again', () => {
    const existing: Existing = { ...none, setupBreedIds: new Set(['b-l', '']), scaleScores: new Set([1, 2, 3, 4, 5]), collectorCodes: new Set(['CM']) };
    const plan = planFixture(existing, farms);
    expect(plan.filter((a) => a.do === 'create').map((a) => a.key)).toEqual(['Tempo', 'Z-Line', 'AW', 'TA']);
    expect(plan.filter((a) => a.do === 'exists')).toHaveLength(1 + 1 + 5 + 1);
  });

  it('skips a line the company has no breed for, and says why', () => {
    const plan = planFixture({ ...none, breeds: new Map([['Tempo', 'b-t']]) }, farms);
    expect(plan.filter((a) => a.do === 'skip')).toEqual([
      { kind: 'setup', key: 'L-Line', do: 'skip', why: 'no breed "L-Line" in this company' },
      { kind: 'setup', key: 'Z-Line', do: 'skip', why: 'no breed "Z-Line" in this company' },
    ]);
  });

  it('puts the line\'s breed on its setup, and none on the company default', () => {
    const plan = planFixture(none, farms);
    expect(plan.find((a) => a.key === 'L-Line' && a.do === 'create')).toMatchObject({ body: { breed_id: 'b-l' } });
    const def = plan.find((a) => a.kind === 'default-setup');
    expect(def && def.do === 'create' && def.body.breed_id).toBeUndefined();
  });
});
