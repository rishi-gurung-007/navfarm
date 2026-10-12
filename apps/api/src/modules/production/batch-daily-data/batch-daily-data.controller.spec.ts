import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { BatchDailyDataController } from './batch-daily-data.controller';

/**
 * Recording a day against a scheduler is not the same act as designing the
 * scheduler, and the two have had separate resources since
 * align-production-permissions.ts: PRODUCTION/BATCH_ENTRY for the entry,
 * PRODUCTION/BATCH_SCHEDULE for the schedule. That script moved the grants and
 * default-role-seed.ts seeds them — OPERATOR holds BATCH_ENTRY view+create and
 * BATCH_SCHEDULE view only — but these three routes were never repointed, so
 * they still asked for BATCH_SCHEDULE.
 *
 * The effect, reproduced in the running app on 12 Oct 2026 as
 * mul100.entry@triplec.local (STANDARD_USER holding OPERATOR):
 *   GET  /api/v1/batch/:id/daily-data?date=…  → 200
 *   POST /api/v1/batch/:id/daily-data         → 403 Insufficient permissions
 * An operator could read the day's entries and not record one — the single
 * thing the role exists to do. Same farm, same batch, same headers; only the
 * resource on the decorator differed.
 */
describe('BatchDailyDataController authorization', () => {
  const prototype = BatchDailyDataController.prototype as any;

  it('guards recording a day on BATCH_ENTRY create, not on designing a schedule', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.postEntry)).toEqual({
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'create',
    });
  });

  it('guards reading the day on BATCH_ENTRY view', () => {
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.findForDate)).toEqual({
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'view',
    });
    expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, prototype.consumptionSource)).toEqual({
      moduleCode: 'PRODUCTION', resource: 'BATCH_ENTRY', action: 'view',
    });
  });
});
