import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateSchedulerLineDto, QTY_BASES } from './scheduler-header.dto';

describe('scheduler line quantity basis', () => {
  it('is per head or per batch, nothing else', () => {
    expect([...QTY_BASES]).toEqual(['PER_HEAD', 'TOTAL_BATCH']);
  });

  const problems = async (qty_basis: string) => {
    const dto = plainToInstance(CreateSchedulerLineDto, { qty_basis });
    return (await validate(dto, { skipMissingProperties: true })).filter((e) => e.property === 'qty_basis');
  };

  it.each(['PER_HEAD', 'TOTAL_BATCH'])('accepts %s', async (basis) => {
    expect(await problems(basis)).toHaveLength(0);
  });

  it.each(['PER_PEN', 'FIXED'])('refuses the retired %s', async (basis) => {
    expect(await problems(basis)).toHaveLength(1);
  });
});
