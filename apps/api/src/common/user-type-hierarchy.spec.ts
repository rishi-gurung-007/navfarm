import { canAssignUserType, USER_TYPES, userTypeRank } from './user-type-hierarchy';

describe('user-type hierarchy', () => {
  it('places FARM_MANAGER between OPERATIONAL_ADMIN and STANDARD_USER', () => {
    expect(USER_TYPES).toEqual([
      'SYSTEM_ADMIN',
      'TENANT_ADMIN',
      'COMPANY_ADMIN',
      'OPERATIONAL_ADMIN',
      'FARM_MANAGER',
      'STANDARD_USER',
    ]);
    expect(userTypeRank('OPERATIONAL_ADMIN')).toBeGreaterThan(userTypeRank('FARM_MANAGER'));
    expect(userTypeRank('FARM_MANAGER')).toBeGreaterThan(userTypeRank('STANDARD_USER'));
  });

  it('lets an operational admin assign a farm manager but never lets a farm manager assign an operational admin', () => {
    expect(canAssignUserType('OPERATIONAL_ADMIN', 'FARM_MANAGER')).toBe(true);
    expect(canAssignUserType('FARM_MANAGER', 'STANDARD_USER')).toBe(true);
    expect(canAssignUserType('FARM_MANAGER', 'OPERATIONAL_ADMIN')).toBe(false);
  });
});
