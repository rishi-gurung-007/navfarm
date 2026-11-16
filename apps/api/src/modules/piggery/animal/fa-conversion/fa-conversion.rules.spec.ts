import { BadRequestException } from '@nestjs/common';
import { assertApprover, assertConversionDate, assertRequestable, conversionGainLoss } from './fa-conversion.rules';

const animal = { animal_code: 'PIG-1', is_active: true, costing_start_date: '2026-01-05', out_of_production_date: '2026-09-15' };

describe('FA to inventory conversion rules', () => {
  it('takes a live, costed animal that has an out-of-production date', () => {
    expect(() => assertRequestable(animal)).not.toThrow();
  });
  it('refuses one that has left, is not costed, or has no out-of-production date, saying which', () => {
    expect(() => assertRequestable({ ...animal, is_active: false })).toThrow('has already left the herd');
    expect(() => assertRequestable({ ...animal, costing_start_date: null })).toThrow('not a costed breeding asset');
    expect(() => assertRequestable({ ...animal, out_of_production_date: null })).toThrow('out-of-production date first');
  });
  it('lets another Finance user approve, and refuses the requester and a missing approver', () => {
    expect(() => assertApprover('u1', 'u2')).not.toThrow();
    expect(() => assertApprover('u1', 'u1')).toThrow(BadRequestException);
    expect(() => assertApprover('u1', 'u1')).toThrow('another Finance user');
    expect(() => assertApprover('u1', undefined)).toThrow('signed-in approver');
  });
  it('dates the conversion on or after the out-of-production date and not in the future', () => {
    expect(() => assertConversionDate('2026-09-15', '2026-09-15', '2026-10-29')).not.toThrow();
    expect(() => assertConversionDate('2026-09-14', '2026-09-15', '2026-10-29')).toThrow('before the out-of-production date');
    expect(() => assertConversionDate('2026-11-01', '2026-09-15', '2026-10-29')).toThrow('in the future');
  });
  it('is a gain when the market value is above book value and a loss when below; a nil book value is all gain', () => {
    expect(conversionGainLoss(450, 300)).toBe(150);
    expect(conversionGainLoss(600, 680.1234)).toBe(-80.1234);
    expect(conversionGainLoss(100, -5)).toBe(100);
  });
});
