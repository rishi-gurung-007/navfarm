import { BadRequestException, ConflictException } from '@nestjs/common';
import { assertSiloLevels } from './silo-levels';

/**
 * D41 lets Feed Planning edit a silo's levels as well as the Location form, so
 * the rule lives in one place. These cases are the behaviour LocationService
 * had before the extraction, unchanged.
 */
describe('assertSiloLevels', () => {
  it('accepts a low below a high, both within capacity', () => {
    expect(() => assertSiloLevels(2000, 9000, 10000)).not.toThrow();
  });

  it('refuses a low at or above the high', () => {
    expect(() => assertSiloLevels(9000, 9000, 10000)).toThrow(ConflictException);
    expect(() => assertSiloLevels(9500, 9000, 10000)).toThrow('The low feed level must be below the high feed level.');
  });

  it('refuses either level above the capacity', () => {
    expect(() => assertSiloLevels(2000, 12000, 10000)).toThrow('The high feed level cannot exceed the silo capacity.');
    expect(() => assertSiloLevels(11000, 12000, 10000)).toThrow('The high feed level cannot exceed the silo capacity.');
    expect(() => assertSiloLevels(11000, null, 10000)).toThrow('The low feed level cannot exceed the silo capacity.');
  });

  it('checks nothing against a capacity it does not know', () => {
    expect(() => assertSiloLevels(50000, 90000, null)).not.toThrow();
  });

  it('demands both levels only when the caller says they are required', () => {
    expect(() => assertSiloLevels(2000, null, 10000)).not.toThrow();
    expect(() => assertSiloLevels(2000, null, 10000, true)).toThrow(BadRequestException);
    expect(() => assertSiloLevels(null, 9000, 10000, true)).toThrow('A silo needs both a Below Feed Level and an Above Threshold.');
    expect(() => assertSiloLevels(2000, 9000, 10000, true)).not.toThrow();
  });

  it('treats a zero level as a value, not as missing', () => {
    expect(() => assertSiloLevels(0, 9000, 10000, true)).not.toThrow();
    expect(() => assertSiloLevels(0, 0, 10000)).toThrow(ConflictException);
  });
});
