import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBreedingLineSetupDto, QueryBreedingLineSetupDto } from './breeding-line-setup.dto';
import { QueryGeneticLevelBandDto } from './genetic-level-band.dto';

// The same options as the API's global ValidationPipe (main.ts): implicit conversion turns the text 'false' into true
// (Boolean('false')) before a transform sees it, so a transform that tests that value never reads 'false'.
const asTheApiDoes = { enableImplicitConversion: true };

describe("a boolean sent as text ('true' / 'false')", () => {
  it.each([
    ['QueryBreedingLineSetupDto', QueryBreedingLineSetupDto],
    ['QueryGeneticLevelBandDto', QueryGeneticLevelBandDto],
  ])('is read as the boolean it says on %s.isActive', (_name, cls) => {
    expect((plainToInstance(cls as any, { isActive: 'false' }, asTheApiDoes) as any).isActive).toBe(false);
    expect((plainToInstance(cls as any, { isActive: 'true' }, asTheApiDoes) as any).isActive).toBe(true);
    expect((plainToInstance(cls as any, {}, asTheApiDoes) as any).isActive).toBeUndefined();
  });
});

describe('what the setup form no longer takes', () => {
  // The same options as the API's global ValidationPipe (main.ts).
  const refused = async (body: object) =>
    (await validate(plainToInstance(CreateBreedingLineSetupDto, body, asTheApiDoes) as object, { whitelist: true, forbidNonWhitelisted: true })).length;

  it.each([
    ['the table column layout', { selection_columns: [{ key: 'boar', label: 'A', visible: true }] }],
    ['the tie rule', { rank_tie_break: 'SHARED' }],
    ['the week basis', { week_basis: 'ISO' }],
    ['add-the-year', { include_year: true }],
    ['the colorant stock item', { colorant_item_id: '00000000-0000-4000-8000-000000000001' }],
    ['the colorant quantity per lot', { colorant_qty_per_lot: 1 }],
    ['the minimum rest days', { min_rest_days: 3 }],
    ['the motility floor', { min_motility_pct: 70 }],
    ['the rule enforcement', { rule_enforcement: 'BLOCK' }],
    ['the dose rank weight', { grading_dose_weight: 1 }],
    ['the body condition days of grace', { bcs_grace_days: 3 }],
    ['the body condition days of notice', { bcs_reminder_days: 5 }],
  ])('refuses %s, which was taken out', async (_name, body) => {
    expect(await refused(body)).toBeGreaterThan(0);
  });

  it('still takes the grading weights', async () => {
    expect(await refused({ grading_genetic_weight: 1, grading_morphology_weight: 1 })).toBe(0);
  });
});
