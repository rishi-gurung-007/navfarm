import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAnimalDto, UpdateAnimalDto } from './dto/animal.dto';

/**
 * Grading is a whole number 0–99 (Freebuff task-3, item 2). The column is
 * varchar(20) — the number is stored as text, no migration — so the bound
 * lives only in the DTO, matching the web form's Grading field.
 */
describe('Animal grading — integer 0–99', () => {
  const ofCreate = async (grading: unknown) => {
    const dto = plainToInstance(CreateAnimalDto, {
      company_id: '11111111-1111-1111-1111-111111111111',
      animal_type: 'BOAR',
      breed_id: '22222222-2222-2222-2222-222222222222',
      gender: 'M',
      entry_type: 'BORN_ON_FARM',
      entry_date: '2026-09-29',
      item_id: '33333333-3333-3333-3333-333333333333',
      grading,
    });
    return validate(dto);
  };

  it('accepts every whole number 0–99, including 0 (no longer falsy-dropped)', async () => {
    for (const grading of [0, 1, 42, 99]) {
      const errors = await ofCreate(grading);
      const gradingErrors = errors.find((e) => e.property === 'grading');
      expect(gradingErrors).toBeUndefined();
    }
  });

  it('refuses fractions and out-of-range values', async () => {
    for (const grading of [1.5, -1, 100, 999]) {
      const errors = await ofCreate(grading);
      expect(errors.find((e) => e.property === 'grading')).toBeDefined();
    }
  });

  it('refuses non-numeric text (the old three-option select had string values)', async () => {
    // Number() semantics, same as the web form's parse: whitespace-padded
    // digits ('2 ') convert cleanly, but letters never do — they arrive as
    // NaN and the DTO refuses them.
    for (const grading of ['A', 'gold', '3abc']) {
      const errors = await ofCreate(grading);
      expect(errors.find((e) => e.property === 'grading')).toBeDefined();
    }
    const padded = await ofCreate('2 ');
    expect(padded.find((e) => e.property === 'grading')).toBeUndefined();
  });

  it('stays optional on create and update', async () => {
    const createErrors = await ofCreate(undefined);
    expect(createErrors.find((e) => e.property === 'grading')).toBeUndefined();

    const update = plainToInstance(UpdateAnimalDto, { grading: 100 });
    const updateErrors = await validate(update);
    expect(updateErrors.find((e) => e.property === 'grading')).toBeDefined();

    const ok = plainToInstance(UpdateAnimalDto, { grading: 0 });
    expect((await validate(ok)).find((e) => e.property === 'grading')).toBeUndefined();
  });
});
