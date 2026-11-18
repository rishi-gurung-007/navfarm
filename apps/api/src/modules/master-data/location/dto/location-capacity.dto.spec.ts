import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateLocationDto } from './location.dto';

/** Client, 18 Nov: a Store is saved without Max Capacity / Capacity UOM; a Shed still needs both. */
describe('CreateLocationDto capacity', () => {
  const errorsOn = async (location_type: string) => {
    const dto = plainToInstance(CreateLocationDto, { location_type, location_name: 'X' });
    return (await validate(dto)).map((e) => e.property);
  };

  it('does not ask a STORE for Max Capacity or Capacity UOM', async () => {
    const props = await errorsOn('STORE');
    expect(props).not.toContain('max_capacity');
    expect(props).not.toContain('capacity_uom');
  });

  it('still asks a SHED for both', async () => {
    const props = await errorsOn('SHED');
    expect(props).toContain('max_capacity');
    expect(props).toContain('capacity_uom');
  });
});
