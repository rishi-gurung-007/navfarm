import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { ReportingPeriodController } from './reporting-period.controller';

describe('ReportingPeriodController authorization', () => {
  it('separates draft editing from activation approval on both activation routes', () => {
    const prototype = ReportingPeriodController.prototype as any;

    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.generate)).toEqual({
      moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD', action: 'create',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.activate)).toEqual({
      moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD', action: 'approve',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.restore)).toEqual({
      moduleCode: 'MASTER_DATA', resource: 'REPORTING_PERIOD', action: 'approve',
    });
  });
});
