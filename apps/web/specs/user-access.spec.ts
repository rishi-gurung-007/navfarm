import { assignableUserTypes, userTypeLabel } from '../src/components/console/team/user-access';

describe('team user-type access', () => {
  it('offers FARM_MANAGER below OPERATIONAL_ADMIN and labels the stored operational type Head of Farms', () => {
    expect(assignableUserTypes('OPERATIONAL_ADMIN')).toEqual(['FARM_MANAGER', 'STANDARD_USER']);
    expect(userTypeLabel('OPERATIONAL_ADMIN')).toBe('Head of Farms');
    expect(userTypeLabel('FARM_MANAGER')).toBe('Farm Manager');
  });
});
