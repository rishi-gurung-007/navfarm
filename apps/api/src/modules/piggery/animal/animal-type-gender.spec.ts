import { BadRequestException } from '@nestjs/common';
import { assertTypeFitsGender } from './animal.service';

describe('assertTypeFitsGender', () => {
  it('refuses a female boar and a male sow or gilt', () => {
    expect(() => assertTypeFitsGender('BOAR', 'F')).toThrow(BadRequestException);
    expect(() => assertTypeFitsGender('SOW', 'M')).toThrow(BadRequestException);
    expect(() => assertTypeFitsGender('GILT', 'M')).toThrow(BadRequestException);
  });
  it('accepts the matching sex and leaves other types alone', () => {
    expect(() => assertTypeFitsGender('BOAR', 'M')).not.toThrow();
    expect(() => assertTypeFitsGender('SOW', 'F')).not.toThrow();
    expect(() => assertTypeFitsGender('COMMERCIAL_PIG', 'M')).not.toThrow();
    expect(() => assertTypeFitsGender(undefined, 'M')).not.toThrow();
  });
});
