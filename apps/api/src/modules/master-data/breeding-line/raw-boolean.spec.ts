import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBreedingLineSetupDto, QueryBreedingLineSetupDto, SelectionColumnDto, UpdateBreedingLineSetupDto } from './breeding-line-setup.dto';
import { QueryGeneticLevelBandDto } from './genetic-level-band.dto';
import { QuerySemenCollectorDto } from './semen-collector.dto';

// The same options as the API's global ValidationPipe (main.ts): implicit conversion turns the text 'false' into true
// (Boolean('false')) before a transform sees it, so a transform that tests that value never reads 'false'.
const asTheApiDoes = { enableImplicitConversion: true };

describe("a boolean sent as text ('true' / 'false')", () => {
  it.each([
    ['QuerySemenCollectorDto', QuerySemenCollectorDto],
    ['QueryBreedingLineSetupDto', QueryBreedingLineSetupDto],
    ['QueryGeneticLevelBandDto', QueryGeneticLevelBandDto],
  ])('is read as the boolean it says on %s.isActive', (_name, cls) => {
    expect((plainToInstance(cls as any, { isActive: 'false' }, asTheApiDoes) as any).isActive).toBe(false);
    expect((plainToInstance(cls as any, { isActive: 'true' }, asTheApiDoes) as any).isActive).toBe(true);
    expect((plainToInstance(cls as any, {}, asTheApiDoes) as any).isActive).toBeUndefined();
  });

  it("is read as the boolean it says on a selection column's Shown / Hidden dropdown, and a real boolean is left alone", () => {
    const col = (visible: unknown) => plainToInstance(SelectionColumnDto, { key: 'boar', label: '', visible }, asTheApiDoes).visible;
    expect(col('false')).toBe(false);
    expect(col('true')).toBe(true);
    expect(col(false)).toBe(false);
    expect(col(true)).toBe(true);
  });
});

describe('the selection column layout, as the API validates it', () => {
  // The same options as the API's global ValidationPipe (main.ts).
  const validateAsTheApiDoes = (cls: any, body: object) =>
    validate(plainToInstance(cls, body, asTheApiDoes) as object, { whitelist: true, forbidNonWhitelisted: true });
  const layout = [{ key: 'boar', label: 'A', visible: 'true' }, { key: 'dose_rank', label: '', visible: 'false' }];

  it('is accepted on create', async () => {
    expect(await validateAsTheApiDoes(CreateBreedingLineSetupDto, { selection_columns: layout })).toEqual([]);
  });

  it('is accepted on edit too: the columns keep their type through the derived update DTO', async () => {
    expect(await validateAsTheApiDoes(UpdateBreedingLineSetupDto, { selection_columns: layout })).toEqual([]);
    const edited = plainToInstance(UpdateBreedingLineSetupDto, { selection_columns: layout }, asTheApiDoes);
    expect(edited.selection_columns?.map((c) => c.visible)).toEqual([true, false]);
  });

  it('still refuses a column that does not exist, on edit', async () => {
    const errors = await validateAsTheApiDoes(UpdateBreedingLineSetupDto, { selection_columns: [{ key: 'colour', label: '', visible: true }] });
    expect(errors).toHaveLength(1);
  });
});
