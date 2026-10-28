/**
 * PORTA's own production figures, from the three lifecycle sheets of
 * `Porta Breed Master_REVIEWED BY MANAGEMENT-DRAFT-FOR-SUBMISSION.xlsx`.
 *
 * DO NOT EDIT BY HAND. Regenerated from the workbook (24 Oct 2026).
 *
 * The Porta workbook is the MULTIPLIER template filled in for Porta: the same stage wording and bands, with
 * Porta's figures. So Porta's standards are MULTIPLIER's rows (multiplier-lifecycle-seed-data.ts) scoped to
 * POR100, each carrying the figures below where Porta's sheet gives one, keyed by the client's stage wording.
 * As there, the leading number of a cell is the figure ("28 (range 27 to 29)" is 28), a body weight is the
 * weight at the end of the band, and cells that begin with words carry no number. Mortality is stored as a
 * percent, as MULTIPLIER's is.
 */
export const PORTA_LIFECYCLE_FIGURES: Record<
  string,
  {
    feedQtyKg?: number;
    stdBodyWeightKg?: number;
    stdAdg?: number;
    stdFcr?: number;
    stdMortalityPct?: number;
  }
> = {
  'gilt rearing 10 weeks': {
    feedQtyKg: 1.4,
    stdBodyWeightKg: 35,
    stdAdg: 1,
    stdFcr: 1.4,
  },
  'gilt rearing 11 weeks': {
    feedQtyKg: 1.5,
    stdBodyWeightKg: 41,
    stdAdg: 0.8571,
    stdFcr: 1.75,
  },
  'gilt rearing 12 weeks': {
    feedQtyKg: 1.6,
    stdBodyWeightKg: 48,
    stdAdg: 1,
    stdFcr: 1.6,
  },
  'gilt rearing 13 weeks': {
    feedQtyKg: 1.7,
    stdBodyWeightKg: 55,
    stdAdg: 1,
    stdFcr: 1.7,
  },
  'gilt rearing 14 weeks': {
    feedQtyKg: 1.8,
    stdBodyWeightKg: 61,
    stdAdg: 0.8571,
    stdFcr: 2.1,
  },
  'gilt rearing 15 weeks': {
    feedQtyKg: 1.9,
    stdBodyWeightKg: 68,
    stdAdg: 1,
    stdFcr: 1.9,
  },
  'gilt rearing 16 weeks': {
    feedQtyKg: 2,
    stdBodyWeightKg: 75,
    stdAdg: 1,
    stdFcr: 2,
  },
  'gilt rearing 17 weeks': {
    feedQtyKg: 2.2,
    stdBodyWeightKg: 82,
    stdAdg: 1,
    stdFcr: 2.2,
  },
  'gilt rearing 18 weeks': {
    feedQtyKg: 2.3,
    stdBodyWeightKg: 89,
    stdAdg: 1,
    stdFcr: 2.3,
  },
  'gilt rearing 19 weeks': {
    feedQtyKg: 2.4,
    stdBodyWeightKg: 96,
    stdAdg: 1,
    stdFcr: 2.4,
  },
  'gilt rearing 20 weeks': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 103,
    stdAdg: 1,
    stdFcr: 2.5,
  },
  'gilt rearing 21 weeks': {
    feedQtyKg: 2.6,
    stdBodyWeightKg: 110,
    stdAdg: 1,
    stdFcr: 2.6,
  },
  'gilt rearing 22 weeks': {
    feedQtyKg: 2.7,
    stdBodyWeightKg: 117,
    stdAdg: 1,
    stdFcr: 2.7,
  },
  'gilt rearing 23 weeks': {
    feedQtyKg: 2.8,
    stdBodyWeightKg: 124,
    stdAdg: 1,
    stdFcr: 2.8,
  },
  'gilt rearing 24 weeks': {
    feedQtyKg: 2.9,
    stdBodyWeightKg: 130,
    stdAdg: 0.8571,
    stdFcr: 3.3833,
  },
  'gilt rearing 25 weeks': {
    feedQtyKg: 3,
    stdBodyWeightKg: 137,
    stdAdg: 1,
    stdFcr: 3,
  },
  'gilt rearing 26 weeks': {
    feedQtyKg: 3.3,
    stdBodyWeightKg: 144,
    stdAdg: 1,
    stdFcr: 3.3,
  },
  'gilt rearing 27 weeks': {
    feedQtyKg: 3.5,
    stdBodyWeightKg: 150,
    stdAdg: 0.8571,
    stdFcr: 4.0833,
  },
  'gilt rearing gilt to Service line (28 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 159,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line (29 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 167,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line (30 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 174,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line (31 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 180,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line(32 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 187,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line (33 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 193,
    stdAdg: 0.893,
  },
  'gilt rearing gilt to Service line (34 weeks)': {
    feedQtyKg: 2.5,
    stdBodyWeightKg: 200,
    stdAdg: 0.893,
  },
  'Gilt service line': {
    feedQtyKg: 4.5,
    stdBodyWeightKg: 175,
    stdAdg: 0.893,
  },
  'Gilt in gestation': {
    stdBodyWeightKg: 236,
  },
  'Gilts farrowing': {
    stdBodyWeightKg: 189,
  },
  'gilt weaning': {
    stdBodyWeightKg: 189,
  },
  '2nd parity service line': {
    stdBodyWeightKg: 189,
  },
  '2nd parity gestation': {
    stdBodyWeightKg: 254,
  },
  '2nd parity farrowing': {
    stdBodyWeightKg: 210,
  },
  '2nd parity weaning': {
    stdBodyWeightKg: 210,
  },
  '3rd parity plus service line': {
    stdBodyWeightKg: 189,
  },
  Weaner: {
    stdBodyWeightKg: 29,
    stdAdg: 0.55,
    stdFcr: 1.5,
    stdMortalityPct: 0.9,
  },
  'Double stock': {
    stdBodyWeightKg: 48,
    stdAdg: 0.7,
    stdFcr: 2,
    stdMortalityPct: 0.15,
  },
  Grower: {
    stdBodyWeightKg: 118,
    stdAdg: 1.1,
    stdFcr: 2.4,
    stdMortalityPct: 2,
  },
};
