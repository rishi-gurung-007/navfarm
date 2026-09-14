import { BatchController } from './batch.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';

/**
 * OPERATOR holds PRODUCTION/BATCH edit so it can record work, and every
 * lifecycle action below was gated by edit too — so the least-privileged role
 * could close, dispose or revalue a batch. The seed's own intent for OPERATOR is
 * "records work, approves nothing".
 */
describe('BatchController permissions', () => {
  const permission = (name: string) => Reflect.getMetadata(REQUIRE_PERMISSION_KEY, (BatchController.prototype as any)[name]);

  it.each(['close', 'mature', 'amortize', 'fairValue', 'dispose', 'transferStage'])(
    '%s requires approve', (name) => {
      expect(permission(name)).toEqual({ moduleCode: 'PRODUCTION', resource: 'BATCH', action: 'approve' });
    });

  it.each(['bulkDailyEntry', 'addTransaction'])('%s is recorded under BATCH_ENTRY create', (name) => {
    expect(permission(name)).toEqual({ moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'create' });
  });
});
