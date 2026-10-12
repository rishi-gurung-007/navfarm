import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import { requisitionListFields } from './feed-requisition.service';

/**
 * Review A1 (27 Sep): the list showed "4 lines, 8,784 kg" on all three VIL100
 * requisitions against 2/1/1 lines in MySQL. The correlated subqueries must
 * name the OUTER table, or MySQL binds the column to requisition_line itself.
 * Rendered through a mock driver so the assertion is on the SQL MySQL runs.
 */
describe('feed requisition list — correlated line totals', () => {
  const sqlText = drizzle.mock().select(requisitionListFields()).from(schema.requisition).toSQL().sql;

  it('correlates the line count with the outer requisition row', () => {
    expect(sqlText).toContain('(SELECT COUNT(*) FROM requisition_line rl WHERE rl.requisition_id = `requisition`.`requisition_id`)');
  });

  it('correlates the requested total with the outer requisition row', () => {
    expect(sqlText).toContain('(SELECT COALESCE(SUM(rl.quantity), 0) FROM requisition_line rl WHERE rl.requisition_id = `requisition`.`requisition_id`)');
  });

  it('never compares the line table with itself', () => {
    expect(sqlText).not.toMatch(/rl\.requisition_id = `requisition_id`/);
  });
});

describe('A1 (10 Oct) — the list returns farm_id so the web can link the farm', () => {
  it('selects requisition.farm_id', () => {
    // Joined to location_master (which has its own farm_id) as findAll does: the column must name requisition.
    const text = drizzle.mock().select(requisitionListFields()).from(schema.requisition)
      .leftJoin(schema.locationMaster, eq(schema.locationMaster.location_id, schema.requisition.farm_id)).toSQL().sql;
    expect(text).toContain('`requisition`.`farm_id`');
  });
});
