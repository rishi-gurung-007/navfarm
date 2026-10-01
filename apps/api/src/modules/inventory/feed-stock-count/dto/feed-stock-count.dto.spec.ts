import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateFeedStockCountDto } from './feed-stock-count.dto';

const input = (countedAt: string) => plainToInstance(CreateFeedStockCountDto, {
  companyId: '11111111-1111-4111-8111-111111111111',
  farmId: '22222222-2222-4222-8222-222222222222',
  countedAt,
  scheduleSource: 'ON_DEMAND',
  lines: [{
    siloId: '33333333-3333-4333-8333-333333333333',
    itemId: '44444444-4444-4444-8444-444444444444',
    countedQtyKg: 10,
  }],
});

describe('CreateFeedStockCountDto countedAt', () => {
  it.each(['2026-10-01T08:15:00.000Z', '2026-10-01T10:15:00+02:00'])
    ('accepts an offset-bearing instant %s', async (countedAt) => {
      await expect(validate(input(countedAt))).resolves.toEqual([]);
    });

  it('rejects an offsetless local timestamp', async () => {
    const errors = await validate(input('2026-10-01T08:15:00'));
    expect(errors.some((error) => error.property === 'countedAt')).toBe(true);
  });
});
