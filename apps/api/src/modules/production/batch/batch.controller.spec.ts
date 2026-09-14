import { BatchController } from './batch.controller';
import { REQUIRE_PERMISSION_KEY } from '../../../common/decorators/require-permission.decorator';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateBatchDto } from './dto/batch.dto';

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

describe('CreateBatchDto', () => {
  const valid = {
    company_id: '11111111-1111-4111-8111-111111111111',
    lob_id: 'lob-piggery',
    farm_id: '22222222-2222-4222-8222-222222222222',
    animal_tracking: 'COUNT_ONLY',
    stage_id: '33333333-3333-4333-8333-333333333333',
    costing_method: 'FIFO',
    start_date: '2026-09-15',
    opening_quantity: 10,
    uom: 'HEAD',
    input_lines: [{
      item_id: '44444444-4444-4444-8444-444444444444',
      quantity: 10,
      uom: 'HEAD',
    }],
  };

  const invalidProperties = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(CreateBatchDto, body))).map((error) => error.property);

  it.each(['farm_id', 'animal_tracking', 'stage_id'])(
    'rejects a create request without explicit %s',
    async (property) => {
      const body = { ...valid } as Record<string, unknown>;
      delete body[property];
      await expect(invalidProperties(body)).resolves.toContain(property);
    },
  );

  it('rejects an unknown animal tracking mode', async () => {
    await expect(invalidProperties({ ...valid, animal_tracking: 'INDIVIDUAL' }))
      .resolves.toContain('animal_tracking');
  });
});
