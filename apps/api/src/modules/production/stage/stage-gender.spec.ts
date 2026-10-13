import { BadRequestException } from '@nestjs/common';
import { assertStageFitsAnimal, stageFitsGender } from './stage-gender';

describe('stage applicable gender', () => {
  it('admits everyone to a stage nobody has configured', () => {
    expect(stageFitsGender({ applicable_gender: null }, 'M')).toBe(true);
    expect(stageFitsGender({}, 'F')).toBe(true);
  });

  it('admits only the configured sex', () => {
    expect(stageFitsGender({ applicable_gender: 'F' }, 'F')).toBe(true);
    expect(stageFitsGender({ applicable_gender: 'F' }, 'M')).toBe(false);
    expect(stageFitsGender({ applicable_gender: 'M' }, 'F')).toBe(false);
  });

  it('does not refuse an animal whose sex is unknown', () => {
    expect(stageFitsGender({ applicable_gender: 'F' }, null)).toBe(true);
  });

  it('names the stage, the animal and the sex in the refusal', () => {
    expect(() => assertStageFitsAnimal({ applicable_gender: 'F', stage_name: 'Gestation' }, { gender: 'M', animal_code: 'PIG-0010' }))
      .toThrow("Stage 'Gestation' is for female animals only; PIG-0010 is male.");
    expect(() => assertStageFitsAnimal({ applicable_gender: 'F', stage_name: 'Gestation' }, { gender: 'M' })).toThrow(BadRequestException);
  });
});
