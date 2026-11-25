import { sourceScope } from './requisition.service';

describe('sourceScope', () => {
  const scope = { farmId: 'POR100', restricted: true, companyId: 'C1', lobId: 'PIG' };

  it('lets a semen requisition take its source from another farm of the company', () => {
    expect(sourceScope(scope, 'breed-1', 'STORE')).toEqual({ ...scope, farmId: null });
  });

  it('keeps every other requisition source on the active farm', () => {
    expect(sourceScope(scope, null, 'STORE')).toBe(scope);
    expect(sourceScope(scope, undefined, 'STORE')).toBe(scope);
    expect(sourceScope(scope, 'breed-1', 'CONSUMPTION')).toBe(scope);
  });
});
