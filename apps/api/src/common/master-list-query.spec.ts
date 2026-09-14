import { BadRequestException } from '@nestjs/common';
import * as schema from '../core/database/schema';
import { listFilterConditions, listOrderBy } from './master-list-query';

/**
 * The filter and sort keys arrive from a query string, so the only thing
 * standing between a caller and the SQL is the column check. A key that is not
 * a column must be refused by name rather than dropped: a filter that silently
 * does nothing is worse than one that fails, because the list then looks like
 * an answer to a question nobody asked.
 */
describe('master list query', () => {
  describe('listFilterConditions', () => {
    it('builds a condition per recognised column', () => {
      const conditions = listFilterConditions(schema.locationMaster, {
        location_type: 'PEN',
        storage_type: 'SILO',
      });
      expect(conditions).toHaveLength(2);
    });

    it('refuses a key that is not a column on the table', () => {
      expect(() =>
        listFilterConditions(schema.locationMaster, { dropped_table: 'x' }),
      ).toThrow(BadRequestException);
      expect(() =>
        listFilterConditions(schema.locationMaster, { dropped_table: 'x' }),
      ).toThrow(/dropped_table/);
    });

    it('refuses a column that belongs to a different master', () => {
      // item_type is a real column, but not on location_master.
      expect(() =>
        listFilterConditions(schema.locationMaster, { item_type: 'FEED' }),
      ).toThrow(BadRequestException);
    });

    it('skips empty values rather than matching on empty string', () => {
      expect(listFilterConditions(schema.locationMaster, { location_type: '' })).toHaveLength(0);
    });

    it('accepts an array for a multi-select filter', () => {
      expect(
        listFilterConditions(schema.locationMaster, { location_type: ['PEN', 'CRATE'] }),
      ).toHaveLength(1);
    });

    // Regression: these were skipped to avoid filtering twice, so
    // filter[location_type]=PEN returned all 18 locations and reported success
    // — the exact failure the unknown-column check exists to prevent.
    it('applies a column the service also exposes under its own camelCase name', () => {
      expect(
        listFilterConditions(schema.locationMaster, { location_type: 'PEN' }),
      ).toHaveLength(1);
    });

    it('refuses a column the workspace owns', () => {
      for (const key of ['tenant_id', 'company_id']) {
        expect(() => listFilterConditions(schema.locationMaster, { [key]: 'abc' }))
          .toThrow(/set by the active workspace/);
      }
    });

    it('takes no filter at all without complaint', () => {
      expect(listFilterConditions(schema.locationMaster, undefined)).toEqual([]);
    });
  });

  describe('listOrderBy', () => {
    it('sorts by the fallback column when the caller asks for nothing', () => {
      expect(listOrderBy(schema.locationMaster, {}, schema.locationMaster.location_code))
        .toBeDefined();
    });

    it('sorts by a requested column', () => {
      expect(
        listOrderBy(
          schema.locationMaster,
          { sort: 'location_name', dir: 'desc' },
          schema.locationMaster.location_code,
        ),
      ).toBeDefined();
    });

    it('refuses to sort by a key that is not a column', () => {
      expect(() =>
        listOrderBy(
          schema.locationMaster,
          { sort: 'location_code; DROP TABLE' },
          schema.locationMaster.location_code,
        ),
      ).toThrow(BadRequestException);
    });
  });
});
