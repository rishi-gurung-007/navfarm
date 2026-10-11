import { and, eq, inArray, isNull } from 'drizzle-orm';
import { MySql2Database } from 'drizzle-orm/mysql2';
import * as schema from '../../../core/database/schema';
import type { FeedBinAssignmentInput } from './feed-requisition-transfer.rules';

/**
 * The one lookup of active mill BIN Diet Assignments for feed items on
 * production dates. Release, the Mill Loading Sheet, the Consolidation Sheet
 * and the requisition read model all feed it to resolveLoadingBinId /
 * groupFeedTransferLines, so they can never name different BINs.
 */
export async function activeBinAssignments(
  db: MySql2Database<typeof schema>,
  companyId: string,
  productionDates: Array<string | null | undefined>,
  itemIds: string[],
  tenantId: string,
): Promise<FeedBinAssignmentInput[]> {
  const dates = [...new Set(productionDates.filter((date): date is string => !!date))];
  if (!dates.length || !itemIds.length) return [];
  return db.select({
    assignmentId: schema.binDietAssignment.assignment_id,
    itemId: schema.binDietAssignment.feed_item_id,
    productionDate: schema.binDietAssignment.production_date,
    binLocationId: schema.binDietAssignment.bin_location_id,
  }).from(schema.binDietAssignment).where(and(
    eq(schema.binDietAssignment.tenant_id, tenantId),
    eq(schema.binDietAssignment.company_id, companyId),
    inArray(schema.binDietAssignment.production_date, dates),
    inArray(schema.binDietAssignment.feed_item_id, [...new Set(itemIds)]),
    eq(schema.binDietAssignment.is_active, true),
    eq(schema.binDietAssignment.status, 'ACTIVE'),
    isNull(schema.binDietAssignment.deleted_at),
  ));
}
