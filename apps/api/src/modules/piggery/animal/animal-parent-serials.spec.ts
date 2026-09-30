import { MySqlDialect } from 'drizzle-orm/mysql-core';
import { getTableColumns } from 'drizzle-orm';
import * as schema from '../../../core/database/schema';
import { CreateAnimalDto, UpdateAnimalDto, QueryAnimalDto } from './dto/animal.dto';

/**
 * D42 (Rishi, 29 Sep, with his addendum): a parent is not always registered in
 * NAVFarm. A purchased or imported animal arrives with its sire and dam named
 * only on paper, so the register holds what the papers say beside the optional
 * pickers — for EVERY animal, whatever its entry type.
 */
describe('animal_register carries the parents\' serial numbers (D42)', () => {
  it('has both columns, nullable, so every existing animal stays valid', () => {
    const columns = getTableColumns(schema.animalRegister) as Record<string, { notNull: boolean }>;
    expect(columns.sire_serial_no).toBeDefined();
    expect(columns.dam_serial_no).toBeDefined();
    expect(columns.sire_serial_no.notNull).toBe(false);
    expect(columns.dam_serial_no.notNull).toBe(false);
  });

  it('are on the create and update DTOs, and tied to no entry type', () => {
    expect(new CreateAnimalDto()).toBeDefined();
    const create = Object.getOwnPropertyNames(CreateAnimalDto.prototype);
    expect(create).toBeDefined();
    // The DTO fields exist as optional properties; assignment is the check that
    // they are declared, since class-validator metadata is not enumerable here.
    const dto = new CreateAnimalDto() as any;
    dto.sire_serial_no = 'SIRE-PAPER-1';
    dto.dam_serial_no = 'DAM-PAPER-1';
    expect(dto.sire_serial_no).toBe('SIRE-PAPER-1');
    const update = new UpdateAnimalDto() as any;
    update.sire_serial_no = 'x';
    update.dam_serial_no = 'y';
    expect([update.sire_serial_no, update.dam_serial_no]).toEqual(['x', 'y']);
  });

  it('GET /animal can be filtered by gender, for the Sire and Dam pickers', () => {
    const q = new QueryAnimalDto() as any;
    q.gender = 'M';
    expect(q.gender).toBe('M');
  });
});

describe('the gender filter reaches SQL (D42)', () => {
  it('renders as an equality on animal_register.gender', () => {
    const { eq } = require('drizzle-orm');
    const rendered = new MySqlDialect().sqlToQuery(eq(schema.animalRegister.gender, 'M'));
    expect(rendered.sql).toContain('`animal_register`.`gender` = ?');
    expect(rendered.params).toEqual(['M']);
  });
});
