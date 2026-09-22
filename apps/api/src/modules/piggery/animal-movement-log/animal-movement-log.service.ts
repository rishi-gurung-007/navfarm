import { Injectable, NotFoundException } from '@nestjs/common';
import { MySql2Database } from 'drizzle-orm/mysql2';
import { eq, and, asc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { randomUUID } from 'crypto';
import { ClsService } from 'nestjs-cls';
import * as schema from '../../../core/database/schema';
import { farmScope, animalScopeConditions } from '../../../common/farm-scope';

/**
 * Append-only per-animal movement history — the single source both the
 * animal-detail HISTORY tab and LOCATION TRACEABILITY tab read (Rishi's
 * decision, 2026-09-08). Every existing write path that changes an animal's
 * batch/stage/location calls record() here; nothing here is ever updated or
 * deleted, and nothing here derives from animal_register's current_* columns
 * (those are current state only — this table is what "where has this animal
 * been" actually reads).
 */
@Injectable()
export class AnimalMovementLogService {
  constructor(private readonly cls: ClsService) {}

  private get db(): MySql2Database<typeof schema> {
    const tenantDb = this.cls.get<MySql2Database<typeof schema>>('tenantDb');
    if (!tenantDb)
      throw new Error('Tenant database connection context not established.');
    return tenantDb;
  }

  async record(params: {
    tenantId: string;
    companyId?: string | null;
    animalId: string;
    movementType:
      | 'PURCHASE'
      | 'ASSIGN'
      | 'TRANSFER'
      | 'STAGE_CHANGE'
      | 'RELOCATE'
      | 'UNASSIGN'
      | 'MORTALITY'
      | 'OUTPUT'
      | 'CULL';
    eventDate: string;
    fromBatchId?: string | null;
    toBatchId?: string | null;
    fromStageId?: string | null;
    toStageId?: string | null;
    fromLocationId?: string | null;
    toLocationId?: string | null;
    entryNo?: string | null;
    reason?: string | null;
    remarks?: string | null;
    userId?: string;
  }) {
    const movementId = randomUUID();
    await this.db.insert(schema.animalMovementLog).values({
      movement_id: movementId,
      tenant_id: params.tenantId,
      company_id: params.companyId || null,
      animal_id: params.animalId,
      movement_type: params.movementType,
      event_date: params.eventDate,
      from_batch_id: params.fromBatchId || null,
      to_batch_id: params.toBatchId || null,
      from_stage_id: params.fromStageId || null,
      to_stage_id: params.toStageId || null,
      from_location_id: params.fromLocationId || null,
      to_location_id: params.toLocationId || null,
      entry_no: params.entryNo || null,
      reason: params.reason || null,
      remarks: params.remarks || null,
      created_by: params.userId || null,
    });
    return movementId;
  }

  /**
   * Full timeline for one animal, oldest first — "LAST DATE" on the HISTORY
   * tab is the previous row's event_date, computed here rather than stored,
   * so it can never disagree with the log itself. Joined-in batch/stage/
   * location labels save both animal-detail tabs (HISTORY, LOCATION
   * TRACEABILITY) from re-fetching every master list just to turn this row's
   * UUIDs into something a farmer can read.
   */
  async findForAnimal(animalId: string, tenantId: string) {
    const scope = farmScope(this.cls);
    const [animal] = await this.db
      .select({ animal_id: schema.animalRegister.animal_id })
      .from(schema.animalRegister)
      .where(
        and(
          eq(schema.animalRegister.animal_id, animalId),
          eq(schema.animalRegister.tenant_id, tenantId),
          ...animalScopeConditions(scope),
        ),
      )
      .limit(1);
    if (!animal) throw new NotFoundException(`Animal '${animalId}' not found.`);

    const toBatch = alias(schema.batchHeader, 'to_batch');
    const toStage = alias(schema.stageMaster, 'to_stage');
    const fromStage = alias(schema.stageMaster, 'from_stage');
    const toLocation = alias(schema.locationMaster, 'to_location');
    const fromLocation = alias(schema.locationMaster, 'from_location');

    const rows = await this.db
      .select({
        log: schema.animalMovementLog,
        to_batch_no: toBatch.batch_no,
        to_stage_code: toStage.stage_code,
        from_stage_code: fromStage.stage_code,
        to_location_name: toLocation.location_name,
        from_location_name: fromLocation.location_name,
      })
      .from(schema.animalMovementLog)
      .leftJoin(
        toBatch as any,
        eq(schema.animalMovementLog.to_batch_id, toBatch.batch_id),
      )
      .leftJoin(
        toStage as any,
        eq(schema.animalMovementLog.to_stage_id, toStage.stage_id),
      )
      .leftJoin(
        fromStage as any,
        eq(schema.animalMovementLog.from_stage_id, fromStage.stage_id),
      )
      .leftJoin(
        toLocation as any,
        eq(schema.animalMovementLog.to_location_id, toLocation.location_id),
      )
      .leftJoin(
        fromLocation as any,
        eq(schema.animalMovementLog.from_location_id, fromLocation.location_id),
      )
      .where(
        and(
          eq(schema.animalMovementLog.animal_id, animalId),
          eq(schema.animalMovementLog.tenant_id, tenantId),
        ),
      )
      .orderBy(
        asc(schema.animalMovementLog.event_date),
        asc(schema.animalMovementLog.created_at),
      );

    let lastDate: string | null = null;
    return rows.map(({ log, ...labels }) => {
      const withLastDate = { ...log, ...labels, last_date: lastDate };
      lastDate = log.event_date;
      return withLastDate;
    });
  }
}
