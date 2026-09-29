import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUomDto, UpdateUomDto } from './dto/uom.dto';

/**
 * UOM master bounds (Freebuff task-3, item 7): UOM Name takes letters and
 * spaces only. Mirrored by the pattern on the uom config's uom_name field so
 * the form refuses what the API would reject. Every existing uom_master row
 * already satisfies the pattern, so nothing in the register is stranded.
 */
const base = {
  uom_type: 'WEIGHT',
};

const ofCreate = async (extra: Record<string, unknown>) =>
  validate(plainToInstance(CreateUomDto, { ...base, ...extra }));

describe('UOM DTO — uom_name letters and spaces only', () => {
  it('accepts plain and multi-word unit names', async () => {
    for (const uom_name of ['Kilogram', 'Square Meter', 'Metric Tonne', 'Kilowatt Hour']) {
      const errors = await ofCreate({ uom_name });
      expect(errors.find((e) => e.property === 'uom_name')).toBeUndefined();
    }
  });

  it('refuses digits, punctuation and mixed input', async () => {
    for (const uom_name of ['Kilo-gram', 'm2', 'No.1', 'Bag(s)', 'Kilogram 2']) {
      const errors = await ofCreate({ uom_name });
      expect(errors.find((e) => e.property === 'uom_name')).toBeDefined();
    }
  });

  it('still requires a name on create', async () => {
    const errors = await ofCreate({ uom_name: '' });
    expect(errors.find((e) => e.property === 'uom_name')).toBeDefined();
  });

  it('applies the same rule on update', async () => {
    const bad = await validate(plainToInstance(UpdateUomDto, { uom_name: 'Kilo-gram' }));
    expect(bad.find((e) => e.property === 'uom_name')).toBeDefined();

    const ok = await validate(plainToInstance(UpdateUomDto, { uom_name: 'Kilogram' }));
    expect(ok.find((e) => e.property === 'uom_name')).toBeUndefined();
  });

  it('leaves the name optional on update — absent passes', async () => {
    const errors = await validate(plainToInstance(UpdateUomDto, {}));
    expect(errors.find((e) => e.property === 'uom_name')).toBeUndefined();
  });
});
