import { GeneticBand, GradingFormula, geneticLevelOf, rankBoars, RankInput } from './boar-ranking.rules';

/**
 * The figures below are the client's own boar sheets (Breeding Boars and Selection Process.pdf, the Tempo and L-Line tables): a
 * boar's TSI, his published genetic rank, his last collection's doses and morphology, and the ranks and overall grading the sheet
 * shows for him. The formula is the one the sheets follow: genetic and morphology rank equally, dose rank unused. The bands are
 * NOT the client's (the sheets give no thresholds): they are chosen here only so the sheet's levels come out.
 */
const sheetFormula: GradingFormula = { genetic_weight: 1, dose_weight: 0, morphology_weight: 1, tie_break: 'GENETIC_RANK' };
const bands: GeneticBand[] = [
  { level_name: 'Average', tsi_from: 105, tsi_to: null },
  { level_name: 'Below average', tsi_from: 99, tsi_to: 104.99 },
  { level_name: 'Low', tsi_from: 96, tsi_to: 98.99 },
  { level_name: 'Very low', tsi_from: null, tsi_to: 95.99 },
];

// code, TSI, published genetic rank, last doses, last morphology | sheet: level, dose rank, morphology rank, overall grading, overall rank
const tempo: [string, number, number, number, number, string, number, number, number, number][] = [
  ['DA3337', 116, 1, 75, 87, 'Average', 5, 5, 3.0, 1],
  ['DA3132', 113, 2, 73, 86, 'Average', 7, 10, 6.0, 4],
  ['DA3300', 113, 3, 100, 86, 'Average', 1, 11, 7.0, 5],
  ['DA4244', 113, 4, 20, 87, 'Average', 14, 6, 5.0, 3],
  ['DA4146', 110, 5, 39, 85, 'Average', 12, 14, 9.5, 11],
  ['DA4287', 110, 6, 52, 86, 'Average', 10, 12, 9.0, 9],
  ['DA4288', 110, 7, 74, 88, 'Average', 6, 2, 4.5, 2],
  ['DA4147', 109, 8, 33, 86, 'Average', 13, 13, 10.5, 13],
  ['DA1669', 102, 9, 91, 87, 'Below average', 3, 7, 8.0, 6],
  ['DA1721', 102, 10, 52, 87, 'Below average', 11, 8, 9.0, 10],
  ['DA2568', 98, 13, 91, 88, 'Low', 4, 3, 8.0, 7],
  ['DA1130', 97, 14, 97, 87, 'Low', 2, 9, 11.5, 14],
  ['CJ0211', 95, 15, 53, 90, 'Very low', 9, 1, 8.0, 8],
  ['CL3033', 93, 16, 61, 88, 'Very low', 8, 4, 10.0, 12],
];

const inputOf = ([code, tsi, rank, doses, morph]: (typeof tempo)[number]): RankInput => ({
  boar_id: code, boar_code: code, tsi, published_rank: rank, last_doses: doses, last_morphology_pct: morph,
});

describe("the client's Tempo sheet", () => {
  const out = rankBoars(tempo.map(inputOf), sheetFormula, bands);

  it.each(tempo)('%s reads as the sheet reads', (code, _tsi, rank, _d, _m, level, doseRank, morphRank, grading, overall) => {
    expect(out.find((o) => o.boar_id === code)).toEqual({
      boar_id: code,
      genetic_rank: rank,
      genetic_level: level,
      dose_rank: doseRank,
      morphology_rank: morphRank,
      overall_grading: grading,
      overall_rank: overall,
    });
  });

  it('uses the published genetic rank as given: re-ranking the 14 shown would move DA2568 from 13 to 11 and change its grading', () => {
    expect(out.find((o) => o.boar_id === 'DA2568')?.overall_grading).toBe(8.0);
  });
});

describe("the client's L-Line sheet", () => {
  // code, TSI, published rank, doses, morphology | sheet: dose rank, morphology rank, overall grading
  const sheet: [string, number, number, number | null, number | null, number | null, number | null, number | null][] = [
    ['LA1342', 103, 1, 39, 86, 3, 2, 1.5],
    ['LA0499', 100, 2, 46, 87, 2, 1, 1.5],
    ['LA0724', 97, 3, 34, 86, 4, 3, 3.0],
    ['LA0752', 97, 4, 75, 85, 1, 4, 4.0],
    ['LA0946', 97, 5, null, null, null, null, null], // never collected: the sheet shows N/A
  ];
  const out = rankBoars(
    sheet.map(([code, tsi, rank, doses, morph]) => ({ boar_id: code, boar_code: code, tsi, published_rank: rank, last_doses: doses, last_morphology_pct: morph })),
    sheetFormula,
    bands,
  );

  it.each(sheet)('%s reads as the sheet reads', (code, _t, rank, _d, _m, doseRank, morphRank, grading) => {
    const o = out.find((x) => x.boar_id === code)!;
    expect([o.genetic_rank, o.dose_rank, o.morphology_rank, o.overall_grading]).toEqual([rank, doseRank, morphRank, grading]);
  });

  it('gives a boar never collected no collection ranks and no grading, but still a genetic rank and level: N/A, never zero', () => {
    expect(out.find((o) => o.boar_id === 'LA0946')).toEqual({
      boar_id: 'LA0946', genetic_rank: 5, genetic_level: 'Low', dose_rank: null, morphology_rank: null, overall_grading: null, overall_rank: null,
    });
  });

  it('breaks the 1.5 tie between LA1342 and LA0499 to the better genetic rank (the sheet itself shows #N/A here)', () => {
    expect(out.find((o) => o.boar_id === 'LA1342')?.overall_rank).toBe(1);
    expect(out.find((o) => o.boar_id === 'LA0499')?.overall_rank).toBe(2);
  });
});

describe('rankBoars beyond the sheets', () => {
  const b = (code: string, over: Partial<RankInput> = {}): RankInput => ({ boar_id: code, boar_code: code, tsi: null, published_rank: null, last_doses: null, last_morphology_pct: null, ...over });

  it('works the genetic rank out from TSI, highest first, when it is not published for every boar', () => {
    const out = rankBoars([b('B', { tsi: 100 }), b('A', { tsi: 120, published_rank: 7 }), b('C', { tsi: 100 })], sheetFormula, []);
    expect(out.map((o) => [o.boar_id, o.genetic_rank])).toEqual([['B', 2], ['A', 1], ['C', 3]]);
  });

  it('gives a boar with no TSI no genetic rank and no level', () => {
    expect(rankBoars([b('A')], sheetFormula, bands)[0]).toMatchObject({ genetic_rank: null, genetic_level: null, overall_grading: null });
  });

  it('lets tied boars share a rank when the line says so', () => {
    const shared: GradingFormula = { ...sheetFormula, tie_break: 'SHARED' };
    const out = rankBoars([b('A', { tsi: 3, last_doses: 50 }), b('B', { tsi: 2, last_doses: 50 }), b('C', { tsi: 1, last_doses: 40 })], shared, []);
    expect(out.map((o) => o.dose_rank)).toEqual([1, 1, 3]);
  });

  it('weights the ranks as the formula says, and uses only the ones with a weight', () => {
    const inputs = [b('A', { tsi: 2, last_doses: 10, last_morphology_pct: 90 }), b('B', { tsi: 1, last_doses: 20, last_morphology_pct: 80 })];
    // genetic A1 B2, dose A2 B1, morphology A1 B2
    expect(rankBoars(inputs, { ...sheetFormula, genetic_weight: 2, dose_weight: 1, morphology_weight: 1 }, []).map((o) => o.overall_grading)).toEqual([1.25, 1.75]);
    expect(rankBoars(inputs, { ...sheetFormula, genetic_weight: null, dose_weight: 1, morphology_weight: null }, []).map((o) => o.overall_grading)).toEqual([2, 1]);
  });

  it('gives no grading at all when the line weights no rank', () => {
    const out = rankBoars([b('A', { tsi: 1, last_doses: 1, last_morphology_pct: 1 })], { ...sheetFormula, genetic_weight: null, dose_weight: null, morphology_weight: null }, []);
    expect(out[0].overall_grading).toBeNull();
    expect(out[0].overall_rank).toBeNull();
  });
});

describe('geneticLevelOf', () => {
  it('reads the band that holds the TSI, inclusive at both ends, open where an end is null', () => {
    expect(geneticLevelOf(105, bands)).toBe('Average');
    expect(geneticLevelOf(104.99, bands)).toBe('Below average');
    expect(geneticLevelOf(99, bands)).toBe('Below average');
    expect(geneticLevelOf(200, bands)).toBe('Average');
    expect(geneticLevelOf(10, bands)).toBe('Very low');
  });
  it('has no level for a TSI in no band, none held, or no bands', () => {
    expect(geneticLevelOf(null, bands)).toBeNull();
    expect(geneticLevelOf(100, [])).toBeNull();
    expect(geneticLevelOf(99.5, [{ level_name: 'X', tsi_from: 100, tsi_to: 110 }])).toBeNull();
  });
});
